/**
 * Xian优化器 — shared utilities.
 *
 * Pure helpers only. No I/O side effects beyond reading a bounded text file.
 */

export const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
  '.vue', '.svelte', '.astro',
  '.py', '.pyi',
  '.go',
  '.rs',
  '.java', '.kt', '.kts', '.scala', '.groovy',
  '.cs', '.fs',
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx',
  '.php', '.rb', '.swift', '.dart', '.lua', '.r', '.jl',
  '.sql', '.sh', '.bash', '.ps1', '.psm1',
  '.css', '.scss', '.sass', '.less', '.styl',
  '.html', '.htm', '.xml', '.svg',
]);

export const TEXT_EXTENSIONS = new Set([
  ...CODE_EXTENSIONS,
  '.md', '.mdx', '.txt', '.rst', '.adoc',
  '.json', '.jsonc', '.json5', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.env', '.example', '.properties', '.gradle', '.graphql', '.gql', '.proto',
]);

/** Extensions treated as data/config/markup rather than a code language. */
export const NON_CODE_EXTENSIONS = new Set([
  '.json', '.jsonc', '.json5', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.env', '.example', '.properties', '.gradle', '.graphql', '.gql', '.proto',
  '.md', '.mdx', '.txt', '.rst', '.adoc', '.svg', '.html', '.htm', '.xml',
  '.css', '.scss', '.sass', '.less', '.styl',
]);

export const SKIP_DIRS = new Set([
  '.git', '.hg', '.svn', '.idea', '.vscode', '.vs',
  'node_modules', 'bower_components', 'jspm_packages',
  'vendor', 'vendors', 'third_party', 'third-party',
  'dist', 'build', 'out', 'output', 'release', 'releases',
  'coverage', '.nyc_output', '.coverage',
  '.next', '.nuxt', '.svelte-kit', '.output', '.turbo', '.cache', '.parcel-cache',
  '.pytest_cache', '.mypy_cache', '.ruff_cache', '__pycache__',
  '.venv', 'venv', 'env', 'virtualenv', 'site-packages',
  'target', 'bin', 'obj', 'Pods', 'DerivedData', 'Carthage',
  'tmp', 'temp', '.tmp', 'logs', 'log',
  'playwright-report', 'test-results', 'cypress/videos', 'cypress/screenshots',
]);

export const STOPWORDS = new Set(`
a an the and or but if then else for while of to in on at by with from into over under
is are was were be been being do does did done have has had having can could should would may might must
this that these those it its as not no yes all any each every some such only also than too very just
i you he she we they me him her us them my your his their our
what which who whom whose when where why how
const let var function return import export default class new async await yield of from as type interface enum extends implements public private protected static readonly void null undefined true false
string number boolean object array promise error event props state use usestate useeffect react
`.trim().split(/\s+/));

export const CJK_STOP_BIGRAMS = new Set(`
一个 这个 那个 我们 你们 他们 她们 它们 可以 需要 帮我 请问 一下 怎么 如何 什么 现在 已经 就是 不是 没有 以及 或者 但是 因为 所以 如果 然后 进行 实现 功能 问题 地方 代码 项目 文件 页面 一些 这些 那些 还是 可能 应该 能够 希望 麻烦 时候 的话 之后 之前 里面 一个 目前 通过 使用 支持 相关 对应 这样 那样 知道 觉得 看到
`.trim().split(/\s+/));

/** Windows-safe relative path with forward slashes. */
export function toPosix(value) {
  return String(value).replace(/\\/g, '/');
}

/** Relative POSIX path, never escaping the root. */
export function relativePosix(root, file) {
  const r = toPosix(root).replace(/\/+$/, '');
  const f = toPosix(file);
  if (f === r) return '.';
  if (f.startsWith(r + '/')) return f.slice(r.length + 1);
  return f;
}

/** Split camelCase, PascalCase, snake_case and kebab-case into lowercase parts. */
export function splitIdentifier(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.toLowerCase())
    .filter(Boolean);
}

/** Lowercase, punctuation-trimmed ASCII words from a short text. */
export function asciiWords(text) {
  return (String(text).match(/[A-Za-z][A-Za-z0-9_$.-]{1,}/g) ?? [])
    .map((word) => word.toLowerCase().replace(/^[._-]+|[._-]+$/g, ''))
    .filter((word) => word.length >= 2);
}

/** True for a CJK character. */
export function isCjk(char) {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(char);
}

/** Extract Chinese bigrams that are useful for matching. */
export function cjkBigrams(text) {
  const chars = Array.from(String(text));
  const out = [];
  for (let i = 0; i < chars.length - 1; i += 1) {
    const a = chars[i];
    const b = chars[i + 1];
    if (!isCjk(a) || !isCjk(b)) continue;
    const gram = a + b;
    if (!CJK_STOP_BIGRAMS.has(gram)) out.push(gram);
  }
  return out;
}

/** Count tokens in file content, keeping ASCII and Chinese terms separately. */
export function collectTerms(text, limit = 80) {
  const ascii = new Map();
  const cjk = new Map();
  const bump = (map, token) => {
    if (!token || token.length < 2 || STOPWORDS.has(token)) return;
    map.set(token, (map.get(token) ?? 0) + 1);
  };

  for (const raw of String(text).match(/[A-Za-z][A-Za-z0-9_$.-]{1,}/g) ?? []) {
    const word = raw.toLowerCase().replace(/^[._-]+|[._-]+$/g, '');
    bump(ascii, word);
    if (/[a-z][A-Z]|[A-Z]{2,}/.test(raw)) {
      for (const part of splitIdentifier(raw)) bump(ascii, part);
    }
  }
  for (const gram of cjkBigrams(text)) bump(cjk, gram);

  const top = (map, count) => [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count);
  // Chinese bigrams are the only signal for comments/docs and for large files
  // whose top ASCII terms are dominated by generic code words.
  const cjkLimit = Math.max(12, Math.round(limit * 0.4));
  const asciiLimit = Math.max(8, limit - cjkLimit);
  return Object.fromEntries([...top(ascii, asciiLimit), ...top(cjk, cjkLimit)]);
}

/** Read at most `maxBytes` of a UTF-8 text file, returning null for binary data. */
export async function readTextBounded(fs, file, maxBytes) {
  let handle;
  try {
    handle = await fs.open(file, 'r');
    const stat = await handle.stat();
    if (stat.size > maxBytes) {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
      const slice = buffer.subarray(0, bytesRead);
      if (slice.includes(0)) return null;
      return slice.toString('utf8');
    }
    const buffer = await handle.readFile();
    if (buffer.includes(0)) return null;
    return buffer.toString('utf8');
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/** 1-based line number containing a character offset. */
export function lineAt(text, index) {
  if (!Number.isFinite(index) || index < 0) return 1;
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

/** First 1-based line whose lowercase content contains `needle`. */
export function findLine(text, needle) {
  if (!needle) return 0;
  const lines = String(text).split(/\r?\n/);
  const lower = String(needle).toLowerCase();
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].toLowerCase().includes(lower)) return i + 1;
  }
  return 0;
}

/** Clamp a string to a maximum length without splitting a surrogate pair. */
export function truncate(value, max) {
  const text = String(value ?? '');
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)) + '…';
}

/** Escape a literal for use inside a regular expression. */
export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Format bytes for human-facing summaries. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** exp).toFixed(exp === 0 ? 0 : 1)} ${units[exp]}`;
}

/** Stable, short hash for cache keys. */
export function hashString(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/** Deduplicate by key while keeping first occurrence order. */
export function uniqueBy(items, key) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const id = key(item);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

/** Safe JSON parse. */
export function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Pick the most common value. */
export function mostCommon(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best;
  let bestCount = -1;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** Normalize a user prompt without changing its meaning. */
export function cleanPrompt(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Strip common Chinese/English filler prefixes from a request. */
export function stripFiller(text) {
  let value = String(text).trim();
  const prefixes = [
    /^(?:请|麻烦|帮我|帮忙|劳驾|我想|我要|我需要|能不能|可不可以|可以|能否)\s*/u,
    /^(?:please|can you|could you|would you|i want to|i need to|help me)\s+/i,
  ];
  for (let i = 0; i < 4; i += 1) {
    let changed = false;
    for (const prefix of prefixes) {
      const next = value.replace(prefix, '');
      if (next !== value) {
        value = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return value.trim();
}

/** Normalize colloquial Chinese request wording without adding requirements. */
export function normalizeGoal(text) {
  return String(text)
    .replace(/^(?:加个|加一个|添加个|新增个)\s*/u, '新增')
    .replace(/(?:搞个|弄个|做个)\s*/gu, '实现')
    .replace(/(?:改一下|调整一下)/gu, '调整')
    .replace(/(?:修一下|修复一下)/gu, '修复')
    .replace(/(?:看看|看一下)/gu, '排查')
    .replace(/[吧呢啊呀]\s*$/u, '')
    .trim();
}

/** Redact common credential assignments from a code snippet. */
export function redactSecrets(text) {
  return String(text)
    .replace(/((?:api[_-]?key|secret|token|password|passwd|authorization|private[_-]?key)\s*[:=]\s*['"`])([^'"`\n]{4,})(['"`])/gi, '$1<redacted>$3')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1<redacted>');
}

/** A short title from the request. */
export function titleFromPrompt(text, fallback = '代码修改任务') {
  const cleaned = stripFiller(cleanPrompt(text)).replace(/\s+/g, ' ');
  if (!cleaned) return fallback;
  return truncate(cleaned, 48);
}

/** Quote a Markdown table cell. */
export function tableCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
