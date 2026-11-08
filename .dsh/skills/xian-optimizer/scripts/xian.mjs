#!/usr/bin/env node
/**
 * Xian优化器 CLI.
 *
 * Usage:
 *   node scripts/xian.mjs index   [--root <dir>] [--out <file>] [--json]
 *   node scripts/xian.mjs optimize --prompt "<需求>" [--root <dir>] [--json] [--out <file>]
 *   node scripts/xian.mjs doctor  [--root <dir>]
 *
 * No external dependencies. Works on Node 20+.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  XianError,
  buildProjectIndex,
  findProjectRoot,
  inspectProject,
  optimizePrompt,
} from '../lib/core.mjs';
import { formatBytes } from '../lib/util.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  return `Xian优化器 — 把简短需求改写成带代码路径的可执行提示词

用法:
  node scripts/xian.mjs optimize --prompt "<需求>" [选项]
  node scripts/xian.mjs index [选项]
  node scripts/xian.mjs doctor [--root <目录>]

选项:
  --root <目录>       项目根目录；默认从当前目录向上找 .git
  --prompt <文本>     需求文本；传 "-" 时从 stdin 读取
  --max-files <n>     最多定位多少个文件（3-15，默认 8）
  --max-chars <n>     提示词长度上限（默认 16000）
  --out <文件>        写入文件；optimize 默认只打印到 stdout
  --json              输出 JSON（optimize 包含 prompt 字段）
  --refresh           忽略 30 秒索引缓存
  --quiet             不输出摘要到 stderr
  -h, --help          显示帮助

示例:
  node scripts/xian.mjs optimize --prompt "给登录页加记住我，并调整按钮样式" --root .
  node scripts/xian.mjs optimize --prompt "修复上传大文件时报 413" --json --out .xian/prompt.json
  node scripts/xian.mjs index --out .xian/project-index.json
`;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const [key, inline] = token.slice(2).split('=', 2);
    const name = key.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (['json', 'refresh', 'quiet', 'help'].includes(name)) {
      args[name] = true;
      continue;
    }
    const value = inline ?? argv[i + 1];
    if (value === undefined || (inline === undefined && value.startsWith('--'))) {
      throw new XianError(`参数 --${key} 需要一个值。`, 'xian/bad-args');
    }
    args[name] = value;
    if (inline === undefined) i += 1;
  }
  return args;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function writeOut(file, content) {
  const absolute = path.resolve(file);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content, 'utf8');
  return absolute;
}

function numberOption(value, fallback, min, max) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

async function cmdIndex(args) {
  const root = args.root ?? findProjectRoot(process.cwd());
  const index = await buildProjectIndex(root, {
    refresh: args.refresh === true,
    maxFiles: numberOption(args.maxFiles, undefined, 50, 20000),
  });
  if (!args.quiet) {
    console.error(`已索引 ${index.stats.files} 个文件 · ${formatBytes(index.stats.totalBytes)} · ${index.root}`);
  }
  if (args.out) {
    const target = await writeOut(args.out, `${JSON.stringify(index, null, 2)}\n`);
    if (!args.quiet) console.error(`索引已写入 ${target}`);
  }
  if (args.json) process.stdout.write(`${JSON.stringify(index, null, 2)}\n`);
  else if (!args.out) {
    console.log(`${index.name} · ${index.stats.files} 个文件 · ${index.stats.totalSize}`);
    console.log(`语言：${index.stack.languages.map((item) => `${item.name} ${item.pct}%`).join('、') || '未知'}`);
    console.log(`框架：${index.stack.frameworks.map((item) => item.name).join('、') || '未识别'}`);
    console.log(`入口：${index.stack.entrypoints.join('、') || '未识别'}`);
    console.log(`命令：${index.stack.commands.map((item) => `${item.name}=${item.command}`).join(' | ') || '未识别'}`);
    console.log('加 --json 输出完整索引，或加 --out <文件> 写入 JSON。');
  }
  return 0;
}

async function cmdOptimize(args) {
  const prompt = args.prompt === '-' ? await readStdin() : args.prompt;
  if (!prompt) throw new XianError('缺少 --prompt。可传 --prompt "-" 从 stdin 读取。', 'xian/missing-prompt');
  const result = await optimizePrompt(prompt, {
    root: args.root,
    maxFiles: numberOption(args.maxFiles, 8, 3, 15),
    maxChars: numberOption(args.maxChars, 16000, 4000, 40000),
    refresh: args.refresh === true,
  });
  if (args.out && !args.json) {
    const target = await writeOut(args.out, result.prompt.endsWith('\n') ? result.prompt : `${result.prompt}\n`);
    if (!args.quiet) console.error(`提示词已写入 ${target}`);
  }
  if (args.json) {
    if (args.out) {
      const target = await writeOut(args.out, `${JSON.stringify(result, null, 2)}\n`);
      if (!args.quiet) console.error(`JSON 已写入 ${target}`);
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(result.prompt.endsWith('\n') ? result.prompt : `${result.prompt}\n`);
  }
  if (!args.quiet) {
    const first = result.files?.[0];
    console.error(
      `置信度 ${result.confidence} · ${result.files.length} 个位置 · ${first ? `${first.path}:${first.line}` : '未定位'} · ${result.promptChars} 字符`,
    );
    for (const warning of result.warnings.slice(0, 3)) console.error(`注意：${warning}`);
  }
  return 0;
}

async function cmdDoctor(args) {
  const root = args.root ?? findProjectRoot(process.cwd());
  const node = process.version;
  const info = await inspectProject(root, { refresh: args.refresh === true });
  const index = info.index;
  console.log(`Xian优化器 doctor`);
  console.log(`  Node        ${node}`);
  console.log(`  项目根      ${index.root}`);
  console.log(`  项目名      ${index.name}`);
  console.log(`  文件数      ${index.stats.files}（截断：${index.stats.truncated ? '是' : '否'}）`);
  console.log(`  总体积      ${index.stats.totalSize}`);
  console.log(`  语言        ${index.stack.languages.map((item) => `${item.name} ${item.pct}%`).join('、') || '未知'}`);
  console.log(`  框架        ${index.stack.frameworks.map((item) => item.name).join('、') || '未识别'}`);
  console.log(`  Git         ${index.git.isGit ? `是（${index.git.changed.length} 个变更）` : '否'}`);
  console.log(`  入口        ${index.stack.entrypoints.join('、') || '未识别'}`);
  console.log(`  命令        ${index.stack.commands.map((item) => `${item.name}=${item.command}`).join(' | ') || '未识别'}`);
  console.log(`  缓存        ${index.stats.files > 0 ? '可用（30 秒）' : '空'}`);
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return 0;
  }
  const command = args._[0] ?? 'optimize';
  if (command === 'optimize') return cmdOptimize(args);
  if (command === 'index') return cmdIndex(args);
  if (command === 'doctor') return cmdDoctor(args);
  if (command === 'help') {
    process.stdout.write(usage());
    return 0;
  }
  throw new XianError(`未知命令：${command}\n\n${usage()}`, 'xian/unknown-command');
}

main()
  .then((code) => {
    process.exitCode = code ?? 0;
  })
  .catch((error) => {
    const message = error instanceof XianError ? error.message : error?.stack ?? String(error);
    console.error(`Xian优化器错误：${message}`);
    process.exitCode = 1;
  });
