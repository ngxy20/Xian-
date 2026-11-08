#!/usr/bin/env node
/**
 * Xian优化器 — dependency-free test runner.
 *
 * Run: node test/run-tests.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { findProjectRoot, optimizePrompt } from '../lib/core.mjs';
import { scanProject } from '../lib/scan.mjs';
import { resolveQuery } from '../lib/score.mjs';
import { redactSecrets } from '../lib/util.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FIXTURE = path.join(HERE, 'fixture');

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed += 1;
    failures.push({ name, error });
    console.log(`FAIL  ${name}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

function includes(haystack, needle, message) {
  assert.ok(String(haystack).includes(needle), message ?? `expected to include ${needle}`);
}

async function evalClient(fetchImpl = async () => { throw new Error('fetch should not run during load'); }, overrides = {}) {  const code = await fs.readFile(path.join(ROOT, 'lib', 'client.js'), 'utf8');
  const React = overrides.React ?? {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: Symbol('Fragment'),
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
  };
  const ReactDOM = overrides.ReactDOM ?? {
    createPortal: (node, container) => ({ portal: node, container }),
  };
  let loaded;
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(entry) { loaded = entry; },
      },
    },
    require(id) {
      if (id === 'react') return React;
      if (id === 'react-dom') return ReactDOM;
      throw new Error(`unexpected require(${id})`);
    },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    TextDecoder,
    TextEncoder,
    document: {
      body: {},
      addEventListener() {},
      removeEventListener() {},
    },
    fetch: fetchImpl,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'lib/client.js' });
  assert.ok(loaded, 'client.js did not call __ModuleLoader__.load');
  const exportsObj = loaded.factory(sandbox.require);
  return { loaded, exportsObj, sandbox, React };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    body: null,
    async json() { return payload; },
  };
}

function ndjsonResponse(events, status = 200) {
  const chunks = events.map((event) => new TextEncoder().encode(`${JSON.stringify(event)}\n`));
  let index = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/x-ndjson' },
    body: {
      getReader() {
        return {
          async read() {
            if (index >= chunks.length) return { value: undefined, done: true };
            return { value: chunks[index++], done: false };
          },
        };
      },
    },
    async json() { return {}; },
  };
}

function composerButton(element) {
  if (element && element.props && element.props['data-xian-optimizer']) return element;
  return (element && element.children ? element.children : []).find((child) => child && child.props && child.props['data-xian-optimizer']);
}

section('scan');
await test('fixture is indexed with React, TypeScript and commands', async () => {
  const index = await scanProject(FIXTURE, { refresh: true });
  assert.ok(index.stats.files >= 8, `expected >= 8 files, got ${index.stats.files}`);
  assert.ok(index.stack.frameworks.some((item) => item.name === 'React'), 'React not detected');
  assert.ok(index.stack.languages.some((item) => item.name === 'TypeScript'), 'TypeScript not detected');
  assert.ok(index.stack.commands.some((item) => item.command.includes('test')), 'test command not detected');
});

await test('symbol lines point at declarations', async () => {
  const index = await scanProject(FIXTURE, { refresh: true });
  const login = index.files.find((file) => file.path === 'src/pages/LoginPage.tsx');
  const symbol = login.symbols.find((item) => item.name === 'LoginPage');
  assert.ok(symbol, 'LoginPage symbol missing');
  assert.equal(symbol.line, 7);
});

section('query understanding');
await test('Chinese filler is normalized without adding requirements', () => {
  const query = resolveQuery('帮我加个登录按钮吧');
  includes(query.rewritten, '新增登录按钮');
  assert.equal(query.wantsUi, true);
});

await test('English UI intent is recognized', () => {
  const query = resolveQuery('Add a remember-me checkbox to the login page and improve button hover style');
  assert.equal(query.wantsUi, true);
  assert.ok(query.tokens.some((row) => row.token === 'login'));
});

await test('credential-looking values are redacted from snippets', () => {
  const redacted = redactSecrets("const apiKey = 'supersecret123';\nconst header = 'Bearer abcdefghijklmnop';");
  assert.ok(!redacted.includes('supersecret123'), 'api key leaked');
  assert.ok(!redacted.includes('abcdefghijklmnop'), 'bearer token leaked');
  includes(redacted, '<redacted>');
});

section('optimization');
await test('Chinese UI request locates login files', async () => {
  const result = await optimizePrompt('给登录页面加一个记住我复选框，并调整登录按钮样式', {
    root: FIXTURE,
    refresh: true,
    maxFiles: 8,
  });
  assert.equal(result.confidence, '高');
  assert.equal(result.files[0].path, 'src/pages/LoginPage.tsx');
  const paths = result.files.map((file) => file.path);
  includes(paths.join('\n'), 'src/components/LoginButton.tsx');
  includes(paths.join('\n'), 'src/styles/login.css');
  includes(result.prompt, '## 3. 代码定位');
  includes(result.prompt, '## 8. 待确认');
  includes(result.prompt, '原始需求');
});

await test('English UI request locates the same area', async () => {
  const result = await optimizePrompt('Add a remember-me checkbox to the login page and improve the login button hover style', {
    root: FIXTURE,
    refresh: true,
  });
  const paths = result.files.map((file) => file.path).join('\n');
  includes(paths, 'LoginPage.tsx');
  includes(paths, 'LoginButton.tsx');
});

await test('a request with no matching code is honest', async () => {
  const result = await optimizePrompt('修复上传大文件时报 413 错误', { root: FIXTURE, refresh: true });
  assert.equal(result.confidence, '低');
  assert.ok(result.warnings.length > 0);
  assert.ok(
    result.files.every((file) => file.isConfig || file.path.endsWith('README.md')),
    'no unrelated code file should be promoted for an unmatched request',
  );
});

await test('config request targets package.json', async () => {
  const result = await optimizePrompt('给项目加 eslint 配置并补 lint 命令', { root: FIXTURE, refresh: true });
  assert.equal(result.files[0].path, 'package.json');
});

await test('docs request targets README', async () => {
  const result = await optimizePrompt('更新 README，补充启动方式和测试说明', { root: FIXTURE, refresh: true });
  assert.equal(result.files[0].path, 'README.md');
});

await test('output respects maxChars', async () => {
  const result = await optimizePrompt('给登录页面加一个记住我复选框，并调整登录按钮样式', {
    root: FIXTURE,
    refresh: true,
    maxChars: 4000,
  });
  assert.ok(result.prompt.length <= 4100, `prompt length ${result.prompt.length}`);
});

section('roots');
await test('findProjectRoot walks to .git', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'xian-root-'));
  try {
    await fs.mkdir(path.join(temp, '.git'));
    await fs.mkdir(path.join(temp, 'a', 'b'), { recursive: true });
    assert.equal(findProjectRoot(path.join(temp, 'a', 'b')), temp);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

await test('project-local skill sources are indexed', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'xian-skill-'));
  try {
    const skillDir = path.join(temp, '.dsh', 'skills', 'demo');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: demo\ndescription: demo\n---\n', 'utf8');
    await fs.writeFile(path.join(skillDir, 'plugin.js'), 'export function widget() { return "xian"; }\n', 'utf8');
    const index = await scanProject(temp, { refresh: true });
    assert.ok(index.files.some((file) => file.path === '.dsh/skills/demo/plugin.js'));
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

section('host route');
await test('health and optimize routes work through a mock connection', async () => {
  const routes = new Map();
  const ctx = {
    connection: {
      fetch: {
        register(route) {
          routes.set(route.path, route);
          return () => {};
        },
      },
    },
  };
  const host = await import('../lib/host.js');
  host.apply(ctx);
  assert.ok(routes.has('/api/xian/health'));
  assert.ok(routes.has('/api/xian/optimize'));
  assert.ok(routes.has('/api/xian/optimize-stream'));
  assert.ok(routes.has('/api/xian/insight'));
  assert.ok(routes.has('/api/xian/asset'));
  assert.ok([...routes.keys()].every((key) => key.startsWith('/api/')), 'exact routes must live under /api');

  const health = await routes.get('/api/xian/health').fetch(new Request('http://xian.local/api/xian/health'));
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.ok, true);

  const asset = await routes.get('/api/xian/asset').fetch(new Request('http://xian.local/api/xian/asset?name=front'));
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('content-type'), 'image/webp');
  const assetBytes = await asset.arrayBuffer();
  assert.ok(assetBytes.byteLength > 5000, `mascot asset too small: ${assetBytes.byteLength}`);
  const face = await routes.get('/api/xian/asset').fetch(new Request('http://xian.local/api/xian/asset?name=face'));
  assert.equal(face.status, 200);
  assert.ok((await face.arrayBuffer()).byteLength > 1000);

  const insightResponse = await routes.get('/api/xian/insight').fetch(new Request('http://xian.local/api/xian/insight', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cwd: FIXTURE, refresh: true }),
  }));
  assert.equal(insightResponse.status, 200);
  const insightBody = await insightResponse.json();
  assert.equal(insightBody.ok, true);
  assert.ok(insightBody.profile.files >= 8);
  assert.ok(insightBody.profile.symbols > 0);
  assert.ok(insightBody.profile.understanding > 0);
  assert.ok(Array.isArray(insightBody.profile.languages));

  const streamed = await routes.get('/api/xian/optimize-stream').fetch(new Request('http://xian.local/api/xian/optimize-stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: '给登录页面加一个记住我复选框，并调整登录按钮样式',
      cwd: FIXTURE,
      depth: 'fast',
      refresh: true,
    }),
  }));
  assert.equal(streamed.status, 200);
  includes(streamed.headers.get('content-type') || '', 'ndjson');
  const streamText = await streamed.text();
  const streamEvents = streamText.trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(streamEvents.some((event) => event.type === 'progress' && event.stage === 'scan'));
  const finalEvent = streamEvents.find((event) => event.type === 'result');
  assert.ok(finalEvent, 'stream did not end with a result event');
  assert.equal(finalEvent.ok, true);
  assert.ok(Number.isFinite(finalEvent.understanding));
  assert.equal(finalEvent.depth, 'fast');
  assert.equal(finalEvent.depthLabel, '快速');
  assert.ok(finalEvent.files.length <= 5, `fast depth returned too many files: ${finalEvent.files.length}`);
  includes(finalEvent.prompt, 'src/pages/LoginPage.tsx');

  const response = await routes.get('/api/xian/optimize').fetch(new Request('http://xian.local/api/xian/optimize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: '给登录页面加一个记住我复选框，并调整登录按钮样式',
      cwd: FIXTURE,
      refresh: true,
    }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  includes(body.prompt, 'src/pages/LoginPage.tsx');

  const empty = await routes.get('/api/xian/optimize').fetch(new Request('http://xian.local/api/xian/optimize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: '   ', cwd: FIXTURE }),
  }));
  assert.equal(empty.status, 400);

  const badType = await routes.get('/api/xian/optimize').fetch(new Request('http://xian.local/api/xian/optimize', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: 'hello',
  }));
  assert.equal(badType.status, 415);

  const badCwd = await routes.get('/api/xian/optimize').fetch(new Request('http://xian.local/api/xian/optimize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'test', cwd: 'relative/path' }),
  }));
  assert.equal(badCwd.status, 400);
});

section('client bundle');
await test('client bundle registers the composer button', async () => {
  const { loaded, exportsObj } = await evalClient();
  assert.equal(loaded.id, '@xian/optimizer');
  assert.equal(exportsObj.inject.join(','), 'slots');
  const registrations = [];
  const ctx = {
    slots: {
      inject(key, callback) {
        assert.equal(key, 'conversation.input.right');
        return callback();
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      },
    },
  };
  const disposer = exportsObj.apply(ctx);
  assert.equal(typeof disposer, 'function');
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].options.name, 'conversation.input.right');
  assert.equal(registrations[0].options.id, 'xian-optimizer');
  assert.equal(registrations[0].options.order, 50);
  assert.equal(typeof registrations[0].component, 'function');
});

await test('persistent widget renders project metrics and depth controls', async () => {
  const { exportsObj } = await evalClient();
  let registration;
  const ctx = {
    slots: {
      inject(key, callback) { return callback(); },
      register(options, component) {
        registration = { options, component };
        return () => {};
      },
    },
  };
  exportsObj.apply(ctx);
  const props = {
    useInput(selector) { return selector({ draft: '', phase: 'plain' }); },
    useSessions(selector) { return selector({ byId: { s1: { cwd: FIXTURE } } }); },
    inputActions: { setDraft() {} },
    sessionId: 's1',
  };
  const element = registration.component(props);
  const widgetPortal = element.children.find((child) => child && child.portal && child.portal.type && child.portal.type.name === 'XianWidget');
  assert.ok(widgetPortal, 'persistent widget portal missing');
  assert.equal(widgetPortal.portal.props.open, true);
  const widget = widgetPortal.portal.type(widgetPortal.portal.props);
  const nodes = [];
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node !== 'object') return;
    if (node.props) nodes.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(widget);
  const depthButtons = nodes.filter((node) => node.props && node.props['data-xian-depth']);
  assert.deepEqual(depthButtons.map((node) => node.props['data-xian-depth']), ['fast', 'standard', 'deep', 'max']);
  assert.ok(nodes.some((node) => node.props && node.props['data-xian-mascot'] === 'widget'));
  const miniPortal = widgetPortal.portal.type({ ...widgetPortal.portal.props, open: false });
  assert.equal(miniPortal.props['data-xian-mascot'], 'mini');
});

await test('composer button posts the draft without replacing it immediately', async () => {
  const calls = [];
  const { exportsObj } = await evalClient(async (url, init) => {
    calls.push({ url, init });
    return ndjsonResponse([
      { type: 'progress', stage: 'scan', percent: 12, depth: 20, label: '扫描项目目录', detail: '12 个文件' },
      { type: 'progress', stage: 'rank', percent: 70, depth: 80, label: '匹配相关代码位置', detail: '8 个候选' },
      {
        type: 'result',
        ok: true,
        prompt: 'OPTIMIZED PROMPT',
        confidence: '高',
        files: [{ path: 'src/pages/LoginPage.tsx' }],
        promptChars: 16,
        understanding: 82,
        warnings: [],
      },
    ]);
  });
  let registration;
  const ctx = {
    slots: {
      inject(key, callback) { return callback(); },
      register(options, component) {
        registration = { options, component };
        return () => {};
      },
    },
  };
  exportsObj.apply(ctx);
  const writes = [];
  const element = registration.component({
    useInput(selector) { return selector({ draft: '给登录页加记住我', phase: 'plain' }); },
    useSessions(selector) { return selector({ byId: { s1: { cwd: FIXTURE } } }); },
    inputActions: { setDraft(text) { writes.push(text); } },
    sessionId: 's1',
  });
  await composerButton(element).props.onClick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/xian/optimize-stream');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.prompt, '给登录页加记住我');
  assert.equal(body.cwd, FIXTURE);
  assert.equal(body.depth, 'standard');
  assert.equal(writes.length, 0, 'the draft must not be replaced before the user confirms');
  const code = await fs.readFile(path.join(ROOT, 'lib', 'client.js'), 'utf8');
  includes(code, '替换输入框');
  includes(code, '复制提示词');
  includes(code, 'data-xian-mascot');
  includes(code, 'data-xian-depth');
  includes(code, '优化深度');
  includes(code, '理解深度');
});

await test('successful optimization opens a preview dialog with copy and replace actions', async () => {
  const state = [];
  const refs = [];
  let cursor = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: Symbol('Fragment'),
    useState(initial) {
      const index = cursor;
      cursor += 1;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], (value) => { state[index] = value; }];
    },
    useEffect() { cursor += 1; },
    useRef(initial) {
      const index = cursor;
      cursor += 1;
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index];
    },
  };
  const ReactDOM = { createPortal: (node, container) => ({ portal: node, container }) };
  const { exportsObj } = await evalClient(async () => ndjsonResponse([
    { type: 'progress', stage: 'scan', percent: 40, depth: 50, label: '解析符号与导入', detail: '20/39 个文件' },
    {
      type: 'result',
      ok: true,
      prompt: '# 任务：测试\n\n## 3. 代码定位\n\n- src/pages/LoginPage.tsx:7',
      confidence: '高',
      files: [{ path: 'src/pages/LoginPage.tsx' }],
      promptChars: 42,
      understanding: 88,
      warnings: ['测试 warning'],
    },
  ]), { React, ReactDOM });
  let registration;
  const ctx = {
    slots: {
      inject(key, callback) { return callback(); },
      register(options, component) {
        registration = { options, component };
        return () => {};
      },
    },
  };
  exportsObj.apply(ctx);
  const props = {
    useInput(selector) { return selector({ draft: '给登录页加记住我', phase: 'plain' }); },
    useSessions(selector) { return selector({ byId: { s1: { cwd: FIXTURE } } }); },
    inputActions: { setDraft() {} },
    sessionId: 's1',
  };
  cursor = 0;
  const first = registration.component(props);
  await composerButton(first).props.onClick();
  cursor = 0;
  const second = registration.component(props);
  const portal = second.children.find((child) => child && child.portal && child.portal.type && child.portal.type.name === 'XianPreview');
  assert.ok(portal, 'preview portal was not created');
  const previewElement = portal.portal;
  assert.equal(typeof previewElement.type, 'function');
  const dialogRoot = previewElement.type(previewElement.props);
  const dialog = (() => {
    let found;
    const visit = (node) => {
      if (!node || found) return;
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (typeof node !== 'object') return;
      if (node.props && node.props['data-xian-preview'] === 'dialog') { found = node; return; }
      for (const child of node.children ?? []) visit(child);
    };
    visit(dialogRoot);
    return found;
  })();
  assert.ok(dialog, 'dialog section was not found');
  assert.equal(dialog.props['data-xian-preview'], 'dialog');
  const nodes = [];
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) { for (const child of node) walk(child); return; }
    if (typeof node !== 'object') return;
    if (node.props) nodes.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(dialog);
  const actions = nodes.map((node) => node.props && node.props['data-xian-preview']).filter(Boolean);
  assert.ok(actions.includes('copy'), 'copy action missing');
  assert.ok(actions.includes('replace'), 'replace action missing');
  assert.ok(nodes.some((node) => node.type === 'pre' && String(node.children[0]).includes('src/pages/LoginPage.tsx')));
});

await test('loading state exposes the character widget with live progress and depth', async () => {
  const state = [];
  const refs = [];
  let cursor = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: Symbol('Fragment'),
    useState(initial) {
      const index = cursor;
      cursor += 1;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], (value) => { state[index] = value; }];
    },
    useEffect() { cursor += 1; },
    useRef(initial) {
      const index = cursor;
      cursor += 1;
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index];
    },
  };
  const ReactDOM = { createPortal: (node, container) => ({ portal: node, container }) };

  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const progressChunk = new TextEncoder().encode(`${JSON.stringify({
    type: 'progress',
    percent: 42,
    depth: 55,
    label: '解析符号与导入',
    detail: '20/39 个文件',
  })}\n`);
  const resultChunk = new TextEncoder().encode(`${JSON.stringify({
    type: 'result',
    ok: true,
    prompt: 'RESULT PROMPT',
    confidence: '中',
    files: [{ path: 'a.ts' }],
    promptChars: 13,
    understanding: 77,
    warnings: [],
  })}\n`);
  let readCount = 0;
  const response = {
    ok: true,
    status: 200,
    headers: { get: () => 'application/x-ndjson' },
    body: {
      getReader() {
        return {
          read() {
            readCount += 1;
            if (readCount === 1) return Promise.resolve({ value: progressChunk, done: false });
            if (readCount === 2) return pending;
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    },
  };
  const { exportsObj } = await evalClient(async () => response, { React, ReactDOM });
  let registration;
  const ctx = {
    slots: {
      inject(key, callback) { return callback(); },
      register(options, component) {
        registration = { options, component };
        return () => {};
      },
    },
  };
  exportsObj.apply(ctx);
  const props = {
    useInput(selector) { return selector({ draft: '给登录页加记住我', phase: 'plain' }); },
    useSessions(selector) { return selector({ byId: { s1: { cwd: FIXTURE } } }); },
    inputActions: { setDraft() {} },
    sessionId: 's1',
  };
  cursor = 0;
  const first = registration.component(props);
  const running = composerButton(first).props.onClick();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  cursor = 0;
  const loading = registration.component(props);
  const mascot = loading.children.find((child) => child && child.portal && child.portal.type && child.portal.type.name === 'XianWidget');
  assert.ok(mascot, 'character widget portal was not created');
  assert.equal(mascot.portal.props.phase, 'loading');
  assert.equal(mascot.portal.props.progress.percent, 42);
  assert.equal(mascot.portal.props.progress.depth, 55);
  includes(JSON.stringify(mascot.portal.props.progress), '解析符号与导入');
  release({ value: resultChunk, done: false });
  await running;
});

section('summary');
console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const failure of failures) {
    console.error(`\n${failure.name}\n${failure.error?.stack ?? failure.error}`);
  }
  process.exitCode = 1;
}
