#!/usr/bin/env node
/**
 * Validate the hand-written browser bundle without a bundler.
 *
 * The DSH client loader expects a CJS-shaped factory registered on
 * window.__ModuleLoader__. This script evaluates the bundle in a VM with a
 * minimal React stub and asserts the composer registration.
 *
 * Run: node scripts/build-client.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, '..', 'lib', 'client.js');
const code = await fs.readFile(FILE, 'utf8');

assert.ok(code.includes('window.__ModuleLoader__.load'), 'missing __ModuleLoader__.load');
assert.ok(code.includes('id: "@xian/optimizer"'), 'module id must be @xian/optimizer');

let loaded;
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  Fragment: Symbol('Fragment'),
  useState: (value) => [value, () => {}],
  useEffect: () => {},
  useRef: (value) => ({ current: value }),
};
const ReactDOM = {
  createPortal: (node, container) => ({ portal: node, container }),
};
const sandbox = {
  window: { __ModuleLoader__: { load(entry) { loaded = entry; } } },
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
  fetch: async () => { throw new Error('fetch must not run at load time'); },
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: FILE });

assert.ok(loaded, 'loader was not called');
assert.equal(loaded.id, '@xian/optimizer');
const exportsObj = loaded.factory(sandbox.require);
assert.equal(exportsObj.inject.join(','), 'slots');
assert.equal(typeof exportsObj.apply, 'function');

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

console.log(`ok — ${path.relative(process.cwd(), FILE)} registers conversation.input.right#xian-optimizer`);
