#!/usr/bin/env node
/**
 * Push the current workspace to GitHub through the Git Data API.
 *
 * This exists because github.com:443 can be blocked while api.github.com works,
 * and because the local Git credential may not be usable for API calls.
 *
 * Usage:
 *   $env:GH_TOKEN = '<fine-grained token with Contents: read/write>'
 *   node scripts/push-github.mjs
 *
 * Optional:
 *   $env:GH_OWNER = 'ngxy20'
 *   $env:GH_REPO  = 'Xian-'
 *   $env:GH_BRANCH = 'main'
 *   node scripts/push-github.mjs --dry-run
 *
 * The token is read from the environment and never printed or written.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OWNER = process.env.GH_OWNER || 'ngxy20';
const REPO = process.env.GH_REPO || 'Xian-';
const BRANCH = process.env.GH_BRANCH || 'main';
const TOKEN = process.env.GH_TOKEN || '';
const DRY = process.argv.includes('--dry-run');
const COMMIT_MESSAGE = process.env.GH_COMMIT_MESSAGE || 'feat: Xian优化器 — project-aware prompt optimizer, mascot progress UI, benchmark';

if (!TOKEN) {
  console.error('缺少 GH_TOKEN。请设置一个有 Contents: read/write 权限的 GitHub token。');
  process.exit(1);
}

function api(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = https.request({
      hostname: 'api.github.com',
      path: apiPath,
      method,
      headers: {
        'User-Agent': 'XianOptimizer',
        Accept: 'application/vnd.github+json',
        Authorization: `token ${TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* non-JSON error page */ }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
        else reject(Object.assign(new Error(`GitHub API ${res.statusCode}: ${json?.message ?? text.slice(0, 300)}`), { status: res.statusCode, json }));
      });
    });
    req.on('error', reject);
    req.setTimeout(45000, () => req.destroy(new Error('GitHub API timeout')));
    if (data) req.write(data);
    req.end();
  });
}

async function loadIgnore(root) {
  let text = '';
  try {
    text = await fs.readFile(path.join(root, '.gitignore'), 'utf8');
  } catch {
    return () => false;
  }
  const rules = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const directoryOnly = line.endsWith('/');
    if (directoryOnly) line = line.replace(/\/+$/, '');
    const anchored = line.startsWith('/');
    if (anchored) line = line.slice(1);
    if (!line) continue;
    const glob = line
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/\u0000/g, '.*');
    rules.push({
      directoryOnly,
      regex: new RegExp(anchored || line.includes('/') ? `^${glob}(?:/|$)` : `(?:^|/)${glob}(?:/|$)`),
    });
  }
  return (rel, isDirectory) => rules.some((rule) => (!rule.directoryOnly || isDirectory) && rule.regex.test(rel));
}

async function collectFiles(dir, prefix = '', ignore = () => false) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.tmp' || entry.name.startsWith('.tmp-')) continue;
    if (entry.name.endsWith('.bak') || entry.name.includes('.bak-')) continue;
    if (prefix === 'benchmark' && entry.name === '.cache') continue;
    if (ignore(rel, entry.isDirectory())) continue;
    if (entry.isDirectory()) out.push(...await collectFiles(path.join(dir, entry.name), rel, ignore));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

function modeFor(file) {
  return file.endsWith('.ps1') || file.endsWith('.sh') ? '100755' : '100644';
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main() {
  const repoInfo = await api('GET', `/repos/${OWNER}/${REPO}`);
  console.log(`repo: ${repoInfo.full_name} (private=${repoInfo.private}, default=${repoInfo.default_branch})`);

  const ignore = await loadIgnore(ROOT);
  const files = (await collectFiles(ROOT, '', ignore)).sort();
  console.log(`files: ${files.length}`);
  if (DRY) {
    for (const file of files) console.log(`  ${file}`);
    console.log('dry-run: no API writes performed');
    return;
  }

  let parent = null;
  try {
    const ref = await api('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
    parent = ref.object.sha;
  } catch (error) {
    if (error.status !== 404 && error.status !== 409) throw error;
    // Git Data API refuses to create blobs in a completely empty repository.
    // Seed the default branch with one tiny file, then replace the tree.
    console.log('empty repository: creating initial commit');
    await api('PUT', `/repos/${OWNER}/${REPO}/contents/.xian-init`, {
      message: 'chore: initialize repository',
      content: Buffer.from('Xian优化器\n', 'utf8').toString('base64'),
      branch: BRANCH,
    });
    const ref = await api('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
    parent = ref.object.sha;
  }

  const blobs = await mapLimit(files, 4, async (file, index) => {
    const body = await fs.readFile(path.join(ROOT, file));
    const blob = await api('POST', `/repos/${OWNER}/${REPO}/git/blobs`, {
      content: body.toString('base64'),
      encoding: 'base64',
    });
    if ((index + 1) % 10 === 0 || index + 1 === files.length) console.log(`  blobs ${index + 1}/${files.length}`);
    return { path: file, mode: modeFor(file), type: 'blob', sha: blob.sha };
  });

  const tree = await api('POST', `/repos/${OWNER}/${REPO}/git/trees`, { tree: blobs });
  console.log(`tree: ${tree.sha}`);

  const commit = await api('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
    message: COMMIT_MESSAGE,
    tree: tree.sha,
    parents: parent ? [parent] : [],
  });
  console.log(`commit: ${commit.sha}`);

  if (parent) {
    await api('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: true });
  } else {
    await api('POST', `/repos/${OWNER}/${REPO}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: commit.sha });
  }
  console.log(`pushed: https://github.com/${OWNER}/${REPO}/commit/${commit.sha}`);
}

main().catch((error) => {
  console.error(error.message);
  if (error.json) console.error(JSON.stringify(error.json));
  process.exitCode = 1;
});
