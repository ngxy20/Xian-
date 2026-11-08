/**
 * Xian优化器 — public core API.
 *
 * Used by:
 *  - the `xian` CLI in scripts/xian.mjs
 *  - the DSH host plugin in lib/host.js
 *
 * The optimizer is deterministic and offline: it scans the project, ranks
 * candidate locations, and renders a normalized prompt. It never calls an LLM
 * and never writes into the scanned project.
 */

import fs from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

import { scanProject, summarizeIndex } from './scan.mjs';
import { anchorFor, rankFiles, resolveQuery } from './score.mjs';
import { renderPrompt, renderResult } from './render.mjs';
import { NON_CODE_EXTENSIONS, cleanPrompt, redactSecrets, relativePosix, toPosix } from './util.mjs';

const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ROOTS = 8;
const cache = new Map();
const inFlight = new Map();

/** User-selectable prompt optimization depth. */
export const DEPTH_PRESETS = Object.freeze({
  fast: { label: '快速', maxFiles: 4, maxChars: 6000, contentFallback: false, hint: '只定位 4 个位置，不启用全文兜底' },
  standard: { label: '标准', maxFiles: 8, maxChars: 16000, contentFallback: null, hint: '8 个位置；低置信度时启用全文兜底' },
  deep: { label: '深度', maxFiles: 12, maxChars: 20000, contentFallback: true, hint: '12 个位置，强制全文兜底' },
  max: { label: '极致', maxFiles: 15, maxChars: 26000, contentFallback: true, hint: '15 个位置 + 更长证据，适合大型项目' },
});

/** Normalize a depth id from the UI/API. */
export function resolveDepth(depth) {
  return typeof depth === 'string' && DEPTH_PRESETS[depth] ? depth : 'standard';
}

/** Too generic to justify the low-confidence full-text fallback on its own. */
const GENERIC_FALLBACK_TOKENS = new Set([
  '错误', '异常', '问题', '功能', '修改', '调整', '增加', '实现', '支持', '优化',
  '文件', '内容', '信息', '数据', '代码', '项目', '页面', '测试', '规则', '逻辑',
  'error', 'exception', 'bug', 'file', 'files', 'code', 'page', 'test', 'tests',
  'feature', 'update', 'change', 'support', 'message', 'reply',
]);

export class XianError extends Error {
  constructor(message, code = 'xian/error') {
    super(message);
    this.name = 'XianError';
    this.code = code;
  }
}

/** Walk up from `start` to the nearest directory containing `.git`. */
export function findProjectRoot(start = process.cwd()) {
  let current = path.resolve(start);
  try {
    const stat = statSync(current);
    if (stat.isFile()) current = path.dirname(current);
  } catch {
    // keep the resolved path
  }
  const candidates = [];
  let cursor = current;
  while (true) {
    candidates.push(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, '.git'))) return candidate;
  }
  return current;
}

async function ensureDirectory(root) {
  const absolute = path.resolve(root);
  let stat;
  try {
    stat = await fs.stat(absolute);
  } catch {
    throw new XianError(`项目路径不存在：${absolute}`, 'xian/path-not-found');
  }
  if (!stat.isDirectory()) throw new XianError(`项目路径不是目录：${absolute}`, 'xian/not-a-directory');
  return fs.realpath(absolute).catch(() => absolute);
}

/**
 * Build (or reuse) an index for a project root.
 *
 * @param {string} root
 * @param {object} [options]
 * @param {boolean} [options.refresh] - bypass the short-lived cache.
 * @param {number} [options.maxFiles]
 * @returns {Promise<object>}
 */
export async function buildProjectIndex(root, options = {}) {
  const resolved = await ensureDirectory(root);
  const key = toPosix(resolved).toLowerCase();
  const now = Date.now();
  if (!options.refresh) {
    const hit = cache.get(key);
    if (hit && now - hit.time < (options.cacheTtlMs ?? CACHE_TTL_MS)) {
      options.onProgress?.({
        stage: 'cache',
        percent: 62,
        depth: 72,
        label: '复用最近索引',
        detail: '30 秒内已扫描过该项目',
      });
      return hit.index;
    }
    const pending = inFlight.get(key);
    if (pending) return pending;
  }
  const promise = scanProject(resolved, options)
    .then((index) => {
      cache.set(key, { time: Date.now(), index });
      if (cache.size > CACHE_MAX_ROOTS) {
        const oldest = [...cache.entries()].sort((a, b) => a[1].time - b[1].time)[0];
        if (oldest) cache.delete(oldest[0]);
      }
      return index;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, promise);
  return promise;
}

/** Invalidate one project's cached index. */
export function invalidateProjectIndex(root) {
  cache.delete(toPosix(path.resolve(root)).toLowerCase());
}

/** Clear the whole in-memory index cache. */
export function clearProjectIndexCache() {
  cache.clear();
}

const SNIPPET_LANG = new Map([
  ['.ts', 'ts'], ['.tsx', 'tsx'], ['.mts', 'ts'], ['.cts', 'ts'],
  ['.js', 'js'], ['.jsx', 'jsx'], ['.mjs', 'js'], ['.cjs', 'js'],
  ['.vue', 'vue'], ['.svelte', 'svelte'], ['.astro', 'astro'],
  ['.py', 'python'], ['.pyi', 'python'], ['.go', 'go'], ['.rs', 'rust'],
  ['.java', 'java'], ['.kt', 'kotlin'], ['.kts', 'kotlin'], ['.scala', 'scala'],
  ['.cs', 'csharp'], ['.fs', 'fsharp'], ['.c', 'c'], ['.cc', 'cpp'], ['.cpp', 'cpp'],
  ['.h', 'c'], ['.hpp', 'cpp'], ['.php', 'php'], ['.rb', 'ruby'], ['.swift', 'swift'],
  ['.dart', 'dart'], ['.lua', 'lua'], ['.sql', 'sql'], ['.sh', 'bash'],
  ['.css', 'css'], ['.scss', 'scss'], ['.html', 'html'], ['.xml', 'xml'],
  ['.json', 'json'], ['.yaml', 'yaml'], ['.yml', 'yaml'], ['.toml', 'toml'],
]);

async function snippetFor(index, item, query) {
  const anchor = anchorFor(item, query);
  const absolute = path.join(index.root, item.path);
  let text;
  try {
    const stat = await fs.stat(absolute);
    if (stat.size > 512 * 1024) return undefined;
    text = await fs.readFile(absolute, 'utf8');
    if (text.includes('\0')) return undefined;
  } catch {
    return undefined;
  }
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return undefined;
  const anchorLine = Math.max(1, Math.min(lines.length, anchor.line || 1));
  const before = anchorLine <= 2 ? 2 : 4;
  const after = 7;
  let start = Math.max(0, anchorLine - 1 - before);
  let end = Math.min(lines.length, anchorLine + after);
  if (start === end) return undefined;
  let code = lines.slice(start, end).join('\n');
  if (code.length > 1800) {
    code = `${code.slice(0, 1800)}\n// … 片段已截断`;
  }
  code = redactSecrets(code);
  return {
    line: anchorLine,
    code,
    lang: SNIPPET_LANG.get(path.extname(item.path).toLowerCase()) ?? '',
    symbol: anchor.symbol,
  };
}

async function buildSnippets(index, ranked, query) {
  const map = new Map();
  const targets = ranked.items.slice(0, 6);
  for (const item of targets) {
    const snippet = await snippetFor(index, item, query);
    if (snippet) map.set(item.path, snippet);
  }
  return map;
}

/**
 * Query-aware fallback for the case where the index's top terms are generic
 * (common in very large files). Only called for low-confidence rankings, and
 * bounded so a huge monorepo cannot turn this into a full-text scan of disk.
 */
async function scanContentMatches(index, query) {
  const tokens = query.tokens
    .filter((row) => row.token.length >= 2)
    .slice(0, 36);
  if (tokens.length === 0) return new Map();
  const scores = new Map();
  let bytes = 0;
  let read = 0;
  for (const file of index.files) {
    if (read >= 1500 || bytes >= 80 * 1024 * 1024) break;
    if (!file.size || file.size > 512 * 1024) continue;
    let text;
    try {
      text = await fs.readFile(path.join(index.root, file.path), 'utf8');
    } catch {
      continue;
    }
    bytes += file.size;
    read += 1;
    if (text.includes('\0')) continue;
    const lower = text.toLowerCase();
    let score = 0;
    let specificHits = 0;
    for (const { token, weight } of tokens) {
      let count = 0;
      let at = lower.indexOf(token);
      while (at !== -1 && count < 20) {
        count += 1;
        at = lower.indexOf(token, at + token.length);
      }
      if (count > 0) {
        score += Math.min(8, 1 + Math.log2(count + 1)) * weight;
        if (!GENERIC_FALLBACK_TOKENS.has(token)) specificHits += 1;
      }
    }
    if (score > 0 && specificHits > 0) {
      const pathLower = file.path.toLowerCase();
      for (const { token } of tokens) {
        if (pathLower.includes(token)) score += 3;
      }
      scores.set(file.path, Math.round(score * 4 * 10) / 10);
    }
  }
  return new Map([...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60));
}

/**
 * Project-level profile for the always-on mascot widget.
 * Contains metrics only — never source code or absolute paths.
 */
export function projectProfile(index) {
  const codeFiles = (index.files ?? []).filter((file) => !file.isConfig && !file.isDoc && !NON_CODE_EXTENSIONS.has(file.ext));
  const total = Math.max(1, codeFiles.length);
  const withSymbols = codeFiles.filter((file) => (file.symbols?.length ?? 0) > 0);
  const withImports = codeFiles.filter((file) => (file.importSpecs?.length ?? 0) > 0);
  const symbols = codeFiles.reduce((sum, file) => sum + (file.symbols?.length ?? 0), 0);
  const imports = codeFiles.reduce((sum, file) => sum + (file.importSpecs?.length ?? 0), 0);
  const tests = (index.files ?? []).filter((file) => file.isTest).length;
  const understanding = understandingDepth(index, { confidence: '中' });
  return {
    name: index.name,
    files: index.stats.files,
    directories: index.stats.directories,
    size: index.stats.totalSize,
    totalBytes: index.stats.totalBytes,
    truncated: index.stats.truncated,
    languages: index.stack.languages,
    frameworks: index.stack.frameworks,
    packageManagers: index.stack.packageManagers,
    entrypoints: index.stack.entrypoints,
    commands: index.stack.commands,
    tests,
    symbols,
    imports,
    symbolCoverage: Math.round((withSymbols.length / total) * 100),
    importCoverage: Math.round((withImports.length / total) * 100),
    understanding,
    git: { isGit: index.git?.isGit === true, changed: index.git?.changed?.length ?? 0, unavailable: index.git?.unavailable === true },
    generatedAt: index.generatedAt,
  };
}

/**
 * A 0–100 heuristic for how much of the project the scan actually understood.
 * It is intentionally about coverage, not about correctness of the final prompt.
 */
export function understandingDepth(index, ranked) {
  const codeFiles = (index.files ?? []).filter((file) => !file.isConfig && !file.isDoc && !NON_CODE_EXTENSIONS.has(file.ext));
  const total = Math.max(1, codeFiles.length);
  const withSymbols = codeFiles.filter((file) => (file.symbols?.length ?? 0) > 0).length;
  const withImports = codeFiles.filter((file) => (file.importSpecs?.length ?? 0) > 0).length;
  const tests = (index.files ?? []).filter((file) => file.isTest).length;
  let score = 8;
  score += Math.min(12, total * 0.6);
  score += Math.round((withSymbols / total) * 22);
  score += Math.round((withImports / total) * 14);
  score += Math.min(12, (index.stack?.frameworks?.length ?? 0) * 3);
  score += Math.min(10, (index.stack?.commands?.length ?? 0) * 2);
  score += (index.stack?.entrypoints?.length ?? 0) > 0 ? 8 : 0;
  score += tests > 0 ? 5 : 0;
  score += index.git?.isGit ? 3 : 0;
  score += ranked?.confidence === '高' ? 12 : ranked?.confidence === '中' ? 7 : 3;
  return Math.max(8, Math.min(97, Math.round(score)));
}

/**
 * Optimize a rough user request into a normalized, project-aware prompt.
 *
 * @param {string} prompt
 * @param {object} [options]
 * @param {string} [options.root] - project root; defaults to the nearest `.git` ancestor of cwd.
 * @param {number} [options.maxFiles] - maximum number of code locations (3–15, default 8).
 * @param {number} [options.maxChars] - prompt length cap (default 16000).
 * @param {boolean} [options.refresh] - rebuild the index instead of using the cache.
 * @param {object} [options.index] - prebuilt index (advanced).
 * @param {(event: object) => void} [options.onProgress] - streaming progress callback.
 * @returns {Promise<object>}
 */
export async function optimizePrompt(prompt, options = {}) {
  const report = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const text = cleanPrompt(prompt);
  if (!text) throw new XianError('需求不能为空。', 'xian/empty-prompt');
  if (text.length > 20000) throw new XianError('需求过长（超过 20,000 字符）。', 'xian/prompt-too-long');

  report({ stage: 'prepare', percent: 1, depth: 4, label: '解析需求', detail: '提取意图与关键词' });
  const root = await ensureDirectory(options.root ?? findProjectRoot(process.cwd()));
  const index = options.index ?? await buildProjectIndex(root, { ...options, onProgress: report });
  const query = resolveQuery(text);
  report({ stage: 'rank', percent: 70, depth: 80, label: '匹配相关代码位置', detail: `${index.stats.files} 个已索引文件` });
  let ranked = rankFiles(index, query, { maxFiles: options.maxFiles });
  const wantsContentFallback = options.contentFallback === true
    || (options.contentFallback !== false && (ranked.confidence === '低' || ranked.items.length < 3));
  if (wantsContentFallback) {
    report({ stage: 'content', percent: 78, depth: 83, label: '全文关键词兜底', detail: '索引词不足，扫描文件内容补充定位' });
    const contentScores = await scanContentMatches(index, query);
    if (contentScores.size > 0) {
      ranked = rankFiles(index, query, { maxFiles: options.maxFiles, contentScores });
    }
  }
  report({ stage: 'snippets', percent: 84, depth: 86, label: '提取代码证据', detail: `${ranked.items.length} 个候选位置` });
  const snippets = await buildSnippets(index, ranked, query);
  report({ stage: 'render', percent: 92, depth: 91, label: '生成规范化提示词', detail: `置信度 ${ranked.confidence}` });
  const rendered = renderPrompt({ index, query, ranked, snippets }, { maxChars: options.maxChars });
  const understanding = understandingDepth(index, ranked);
  const result = renderResult({ index, query, ranked }, rendered);
  result.understanding = understanding;
  report({
    stage: 'done',
    percent: 100,
    depth: understanding,
    label: '优化完成',
    detail: `${rendered.files.length} 个代码位置 · 理解深度 ${understanding}%`,
  });
  result.query = {
    rewritten: query.rewritten,
    tokens: query.tokens.map((row) => row.token).slice(0, 40),
    intents: query.intents,
  };
  result.index = {
    summary: summarizeIndex(index),
    files: index.stats.files,
    truncated: index.stats.truncated,
    groups: index.architecture.groups.slice(0, 8),
    entrypoints: index.stack.entrypoints,
    commands: index.stack.commands,
  };
  return result;
}

/** Scan and summarize without generating a prompt. */
export async function inspectProject(root, options = {}) {
  const resolved = await ensureDirectory(root ?? findProjectRoot(process.cwd()));
  const index = await buildProjectIndex(resolved, options);
  return {
    ok: true,
    root: index.root,
    summary: summarizeIndex(index),
    index,
  };
}

/** Metrics-only project profile for the always-on mascot widget. */
export async function inspectProjectProfile(root, options = {}) {
  const resolved = await ensureDirectory(root ?? findProjectRoot(process.cwd()));
  const index = await buildProjectIndex(resolved, options);
  return {
    ok: true,
    profile: projectProfile(index),
    summary: summarizeIndex(index),
  };
}

/** Relative path helper re-exported for callers. */
export { relativePosix, summarizeIndex };
