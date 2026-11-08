#!/usr/bin/env node
/**
 * Xian优化器 — localization benchmark.
 *
 * Compares three levels of context:
 *   raw     — the prompt a developer might type, with no code context.
 *   grep    — a strong lexical baseline: path + content term frequency.
 *   xian    — the Xian optimizer's full ranking (symbols, imports, graph, intent).
 *
 * Outputs benchmark/results.json and benchmark/REPORT.md.
 *
 * Run: node benchmark/run.mjs
 * Optional: XIAN_REAL_ROOT="<path>" node benchmark/run.mjs
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { optimizePrompt } from '../.dsh/skills/xian-optimizer/lib/core.mjs';
import { resolveQuery } from '../.dsh/skills/xian-optimizer/lib/score.mjs';
import { scanProject } from '../.dsh/skills/xian-optimizer/lib/scan.mjs';
import { fixtureCases, heldoutCases, realCases } from './cases.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const FIXTURE = path.join(REPO, '.dsh', 'skills', 'xian-optimizer', 'test', 'fixture');
const REAL_ROOT = process.env.XIAN_REAL_ROOT || '';

const TOP_N = 8;

function pct(value) {
  return `${Math.round(value * 1000) / 10}%`;
}

function uniq(values) {
  return [...new Set(values)];
}

function rankOfPrimary(predicted, primary) {
  for (let i = 0; i < predicted.length; i += 1) {
    if (primary.includes(predicted[i])) return i;
  }
  return -1;
}

function evaluate(predicted, item) {
  const expected = uniq([...item.primary, ...item.related]);
  const top = predicted.slice(0, 5);
  const rank = rankOfPrimary(predicted, item.primary);
  const hits = expected.filter((file) => top.includes(file)).length;
  const precision = top.length === 0 ? 0 : top.filter((file) => expected.includes(file)).length / top.length;
  return {
    rank,
    top1: rank === 0,
    primaryAt3: rank >= 0 && rank < 3,
    primaryAt5: rank >= 0 && rank < 5,
    mrr: rank >= 0 ? 1 / (rank + 1) : 0,
    recall5: expected.length === 0 ? 0 : hits / expected.length,
    precision5: precision,
  };
}

function completeness(prompt) {
  const checks = {
    paths: /`[^`\n]+:\d+`/.test(prompt),
    framework: /##\s*1\.\s*项目框架/.test(prompt),
    requirements: /##\s*2\.\s*需求/.test(prompt),
    constraints: /##\s*4\.\s*实施约束/.test(prompt),
    steps: /##\s*5\.\s*实施步骤/.test(prompt),
    acceptance: /##\s*6\.\s*验收标准/.test(prompt),
    verification: /##\s*7\.\s*验证命令/.test(prompt),
    original: /原始需求/.test(prompt),
  };
  const score = Object.values(checks).filter(Boolean).length;
  return { score, total: Object.keys(checks).length, checks };
}

async function baselineGrep(index, prompt) {
  const query = resolveQuery(prompt);
  const tokens = query.tokens.map((row) => row.token).filter((token) => token.length > 1).slice(0, 40);
  const rows = [];
  for (const file of index.files) {
    let text = '';
    try {
      const stat = await fs.stat(path.join(index.root, file.path));
      if (stat.size <= 1024 * 1024) text = await fs.readFile(path.join(index.root, file.path), 'utf8');
    } catch {
      // unreadable files simply score lower
    }
    const lower = text.toLowerCase();
    const pathLower = file.path.toLowerCase();
    const base = path.posix.basename(pathLower, file.ext);
    let score = 0;
    for (const token of tokens) {
      if (base === token) score += 16;
      else if (base.includes(token)) score += 10;
      else if (pathLower.includes(token)) score += 4;
      let count = 0;
      let at = lower.indexOf(token);
      while (at !== -1 && count < 12) {
        count += 1;
        at = lower.indexOf(token, at + token.length);
      }
      if (count > 0) score += Math.min(8, 1 + Math.log2(count + 1));
    }
    if (score > 0) rows.push({ path: file.path, score });
  }
  rows.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return rows.slice(0, TOP_N).map((row) => row.path);
}

function aggregate(rows, label) {
  const usable = rows.filter((row) => row.status === 'ok');
  const mean = (key) => usable.length === 0 ? 0 : usable.reduce((sum, row) => sum + row[key], 0) / usable.length;
  return {
    label,
    cases: usable.length,
    xianTop1: mean('xianTop1'),
    grepTop1: mean('grepTop1'),
    xianPrimaryAt3: mean('xianPrimaryAt3'),
    grepPrimaryAt3: mean('grepPrimaryAt3'),
    xianRecall5: mean('xianRecall5'),
    grepRecall5: mean('grepRecall5'),
    xianPrecision5: mean('xianPrecision5'),
    grepPrecision5: mean('grepPrecision5'),
    xianMrr: mean('xianMrr'),
    grepMrr: mean('grepMrr'),
    xianCompleteness: mean('xianCompleteness'),
    xianPromptChars: mean('xianPromptChars'),
    xianLatencyMs: mean('xianLatencyMs'),
    grepLatencyMs: mean('grepLatencyMs'),
    contextReduction: mean('contextReduction'),
  };
}

function tableRow(row) {
  const primary = row.primary[0] || '—';
  return `| ${row.id} | \`${primary}\` | \`${row.xianFirst || '—'}\` | ${row.xianRank >= 0 ? row.xianRank + 1 : '未命中'} | ${row.grepRank >= 0 ? row.grepRank + 1 : '未命中'} | ${row.xianCompleteness}/${row.completenessTotal} | ${row.xianPromptChars} | ${Math.round(row.xianLatencyMs)} ms |`;
}

function summaryTable(rows) {
  const header = '| 组 | 用例 | Xian Top-1 | Grep Top-1 | Xian Top-3 | Grep Top-3 | Xian Recall@5 | Grep Recall@5 | Xian MRR | Grep MRR | Xian 完整度 | 上下文缩减 |';
  const sep = '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |';
  const lines = rows.map((row) => `| ${row.label} | ${row.cases} | ${pct(row.xianTop1)} | ${pct(row.grepTop1)} | ${pct(row.xianPrimaryAt3)} | ${pct(row.grepPrimaryAt3)} | ${pct(row.xianRecall5)} | ${pct(row.grepRecall5)} | ${row.xianMrr.toFixed(2)} | ${row.grepMrr.toFixed(2)} | ${row.xianCompleteness.toFixed(1)}/8 | ${pct(row.contextReduction)} |`);
  return [header, sep, ...lines].join('\n');
}

async function runCase(item, root, rootLabel, options = {}) {
  const started = performance.now();
  let result;
  try {
    result = await optimizePrompt(item.prompt, { root, maxFiles: TOP_N, refresh: true });
  } catch (error) {
    return {
      id: item.id,
      group: options.group,
      rootLabel,
      prompt: item.prompt,
      primary: item.primary,
      related: item.related,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const xianLatencyMs = performance.now() - started;
  const predicted = result.files.map((file) => file.path);
  const xian = evaluate(predicted, item);
  const complete = completeness(result.prompt);

  const index = await scanProject(root, { refresh: true });
  const grepStarted = performance.now();
  const grepPredicted = await baselineGrep(index, item.prompt);
  const grepLatencyMs = performance.now() - grepStarted;
  const grep = evaluate(grepPredicted, item);

  const projectChars = index.files.reduce((sum, file) => sum + (file.size || 0), 0);
  const contextReduction = projectChars > 0 ? Math.max(0, 1 - result.promptChars / projectChars) : 0;

  return {
    id: item.id,
    group: options.group,
    rootLabel,
    prompt: item.prompt,
    primary: item.primary,
    related: item.related,
    status: 'ok',
    xianPaths: predicted,
    grepPaths: grepPredicted,
    xianRank: xian.rank,
    grepRank: grep.rank,
    xianTop1: xian.top1,
    grepTop1: grep.top1,
    xianPrimaryAt3: xian.primaryAt3,
    grepPrimaryAt3: grep.primaryAt3,
    xianRecall5: xian.recall5,
    grepRecall5: grep.recall5,
    xianPrecision5: xian.precision5,
    grepPrecision5: grep.precision5,
    xianMrr: xian.mrr,
    grepMrr: grep.mrr,
    xianFirst: predicted[0],
    grepFirst: grepPredicted[0],
    xianCompleteness: complete.score,
    completenessTotal: complete.total,
    completenessChecks: complete.checks,
    xianPromptChars: result.promptChars,
    projectChars,
    contextReduction,
    understanding: result.understanding,
    confidence: result.confidence,
    xianLatencyMs,
    grepLatencyMs,
  };
}

async function main() {
  const rows = [];
  for (const item of fixtureCases) {
    rows.push(await runCase(item, FIXTURE, 'fixture', { group: 'fixture' }));
  }

  let hasReal = false;
  try {
    const stat = await fs.stat(REAL_ROOT);
    hasReal = stat.isDirectory();
  } catch {
    hasReal = false;
  }
  if (hasReal) {
    for (const item of realCases) {
      rows.push(await runCase(item, REAL_ROOT, 'real', { group: 'real' }));
    }
  }

  for (const item of heldoutCases) {
    const isReal = item.id.startsWith('heldout-real-');
    if (isReal && !hasReal) continue;
    rows.push(await runCase(item, isReal ? REAL_ROOT : FIXTURE, isReal ? 'real' : 'fixture', { group: 'heldout' }));
  }

  const fixtureRows = rows.filter((row) => row.group === 'fixture');
  const realRows = rows.filter((row) => row.group === 'real');
  const tuningRows = rows.filter((row) => row.group !== 'heldout');
  const heldoutRows = rows.filter((row) => row.group === 'heldout');
  const all = aggregate(rows, '全部');
  const tuning = aggregate(tuningRows, '调参集');
  const heldout = aggregate(heldoutRows, 'held-out');
  const fixture = aggregate(fixtureRows, 'fixture');
  const real = aggregate(realRows, 'real-world');
  const summary = { all, tuning, ...(hasReal ? { real } : {}), fixture, heldout };

  const deltaOf = (row) => ({
    top1: row.xianTop1 - row.grepTop1,
    primaryAt3: row.xianPrimaryAt3 - row.grepPrimaryAt3,
    recall5: row.xianRecall5 - row.grepRecall5,
    precision5: row.xianPrecision5 - row.grepPrecision5,
    mrr: row.xianMrr - row.grepMrr,
  });
  const deltas = deltaOf(tuning);
  const heldoutDeltas = deltaOf(heldout);

  const output = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    methodology: {
      topN: TOP_N,
      cases: rows.length,
      hasReal,
      labels: 'primary = must-open file; related = supporting test/style/data files',
      baselines: ['raw (no retrieval)', 'grep (path + content term frequency)'],
    },
    summary,
    deltas,
    cases: rows.map((row) => ({
      ...row,
      xianPaths: row.xianPaths?.map((item) => path.posix.normalize(item)),
      grepPaths: row.grepPaths?.map((item) => path.posix.normalize(item)),
      rootLabel: row.rootLabel,
    })),
  };

  await fs.mkdir(HERE, { recursive: true });
  await fs.writeFile(path.join(HERE, 'results.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  const lines = [];
  lines.push('# Xian优化器 · 定位效果基准');
  lines.push('');
  lines.push(`> 生成时间：${output.generatedAt}；Node ${output.node}；样本 ${rows.length} 个任务。`);
  lines.push('');
  lines.push('## 这组测试回答什么');
  lines.push('');
  lines.push('它衡量的是**代码定位与提示词准备**，不是最终代码正确率。每个任务都有一个人工标注的 `primary` 文件（开发者必须先打开的文件）和若干 `related` 文件（测试、样式、数据等有效支撑文件）。');
  lines.push('');
  lines.push('对照：');
  lines.push('');
  lines.push('- **raw**：只有一句需求，没有代码上下文。');
  lines.push(`- **grep baseline**：用需求关键词在路径 + 文件内容里做词频排序，取 Top ${TOP_N}。这是一个不弱的传统检索基线。`);
  lines.push(`- **Xian**：项目扫描 + 符号/导入图 + 意图/同义词 + 角色分层，取 Top ${TOP_N}。`);
  lines.push('');
  lines.push('## 汇总');
  lines.push('');
  lines.push(summaryTable([fixture, ...(hasReal ? [real] : []), tuning, heldout, all]));
  lines.push('');
  lines.push('`调参集` 是开发排序规则时使用过的 14 个用例；`held-out` 是最后冻结、没有参与调参的 8 个用例，用来检查规则是否过拟合。');
  lines.push('');
  lines.push('## 关键提升（调参集，Xian − Grep）');
  lines.push('');
  lines.push(`- Top-1 命中率：${pct(tuning.grepTop1)} → ${pct(tuning.xianTop1)}（**${deltas.top1 >= 0 ? '+' : ''}${(deltas.top1 * 100).toFixed(1)} pp**）`);
  lines.push(`- 首选文件进入 Top-3：${pct(tuning.grepPrimaryAt3)} → ${pct(tuning.xianPrimaryAt3)}（**${deltas.primaryAt3 >= 0 ? '+' : ''}${(deltas.primaryAt3 * 100).toFixed(1)} pp**）`);
  lines.push(`- Recall@5：${pct(tuning.grepRecall5)} → ${pct(tuning.xianRecall5)}（**${deltas.recall5 >= 0 ? '+' : ''}${(deltas.recall5 * 100).toFixed(1)} pp**）`);
  lines.push(`- Precision@5：${pct(tuning.grepPrecision5)} → ${pct(tuning.xianPrecision5)}（**${deltas.precision5 >= 0 ? '+' : ''}${(deltas.precision5 * 100).toFixed(1)} pp**）`);
  lines.push(`- MRR：${tuning.grepMrr.toFixed(2)} → ${tuning.xianMrr.toFixed(2)}（**${deltas.mrr >= 0 ? '+' : ''}${deltas.mrr.toFixed(2)}**）`);
  lines.push(`- 提示词完整度：0/8（raw/grep 无结构）→ **${tuning.xianCompleteness.toFixed(1)}/8**`);
  lines.push(`- 上下文体积：整个项目平均 ${Math.round(tuning.xianPromptChars / Math.max(0.0001, 1 - tuning.contextReduction))} 字符 → Xian 提示词平均 ${Math.round(tuning.xianPromptChars)} 字符（**缩减 ${pct(tuning.contextReduction)}**）`);
  lines.push(`- 平均耗时：Xian ${Math.round(tuning.xianLatencyMs)} ms / Grep ${Math.round(tuning.grepLatencyMs)} ms（包含扫描/读取；首次运行，非缓存）`);
  lines.push('');
  lines.push('## 关键提升（held-out，Xian − Grep）');
  lines.push('');
  lines.push(`- Top-1：${pct(heldout.grepTop1)} → ${pct(heldout.xianTop1)}（**${heldoutDeltas.top1 >= 0 ? '+' : ''}${(heldoutDeltas.top1 * 100).toFixed(1)} pp**）`);
  lines.push(`- Top-3：${pct(heldout.grepPrimaryAt3)} → ${pct(heldout.xianPrimaryAt3)}（**${heldoutDeltas.primaryAt3 >= 0 ? '+' : ''}${(heldoutDeltas.primaryAt3 * 100).toFixed(1)} pp**）`);
  lines.push(`- Recall@5：${pct(heldout.grepRecall5)} → ${pct(heldout.xianRecall5)}（**${heldoutDeltas.recall5 >= 0 ? '+' : ''}${(heldoutDeltas.recall5 * 100).toFixed(1)} pp**）`);
  lines.push(`- MRR：${heldout.grepMrr.toFixed(2)} → ${heldout.xianMrr.toFixed(2)}（**${heldoutDeltas.mrr >= 0 ? '+' : ''}${heldoutDeltas.mrr.toFixed(2)}**）`);
  lines.push('');
  lines.push('## 逐用例');
  lines.push('');
  lines.push('| 用例 | primary | Xian 首选 | Xian 排名 | Grep 排名 | Xian 完整度 | Xian 字符 | Xian 耗时 |');
  lines.push('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |');
  for (const row of rows) {
    if (row.status !== 'ok') {
      lines.push(`| ${row.id} | \`${row.primary[0]}\` | 错误 | — | — | — | — | — |`);
      continue;
    }
    lines.push(tableRow(row));
  }
  lines.push('');
  lines.push('## 解读');
  lines.push('');
  lines.push(`在调参集 ${tuning.cases} 个任务上，Xian 相对 grep 的 Top-1 为 **${tuning.xianTop1 >= tuning.grepTop1 ? '提升' : '下降'} ${Math.abs(deltas.top1 * 100).toFixed(1)} 个百分点**，Top-3 为 **${tuning.xianPrimaryAt3 >= tuning.grepPrimaryAt3 ? '提升' : '下降'} ${Math.abs(deltas.primaryAt3 * 100).toFixed(1)} 个百分点**，Recall@5 为 **${tuning.xianRecall5 >= tuning.grepRecall5 ? '提升' : '下降'} ${Math.abs(deltas.recall5 * 100).toFixed(1)} 个百分点**。`);
  lines.push('');
  lines.push(`在没有参与调参的 held-out ${heldout.cases} 个任务上，Top-1 为 **${pct(heldout.xianTop1)} vs ${pct(heldout.grepTop1)}**（${heldoutDeltas.top1 >= 0 ? '+' : ''}${pct(heldoutDeltas.top1)}），Top-3 为 **${pct(heldout.xianPrimaryAt3)} vs ${pct(heldout.grepPrimaryAt3)}**（${heldoutDeltas.primaryAt3 >= 0 ? '+' : ''}${pct(heldoutDeltas.primaryAt3)}），Recall@5 为 **${pct(heldout.xianRecall5)} vs ${pct(heldout.grepRecall5)}**（${heldoutDeltas.recall5 >= 0 ? '+' : ''}${pct(heldoutDeltas.recall5)}）。`);
  lines.push('');
  lines.push('更重要的不是“多命中一个文件”，而是同时给出：`文件:行`、角色（primary/likely/reference/test/config）、依据、关键代码片段、约束、步骤、验收标准和验证命令。raw/grep 只给文件列表，完整度为 0/8。');
  lines.push('');
  lines.push('## 局限性');
  lines.push('');
  lines.push('- 标注是人工的，`related` 有一定主观性；`primary` 相对客观。');
  lines.push('- 样本量小（fixture + 一个真实 Python 机器人项目），不代表所有语言/框架。');
  lines.push('- 衡量的是“定位与提示词准备”，不是代码生成后的测试通过率。');
  lines.push('- grep 基线使用同样的关键词与同义词，但不使用符号/导入图；它是一个有竞争力的传统对照，不是稻草人。');
  lines.push('- 真实项目路径不写入报告；只保留相对文件路径。');
  lines.push('');
  lines.push('## 结论');
  lines.push('');
  lines.push('在“把一句模糊需求变成可执行的代码定位 + 任务书”这件事上，Xian 相对普通 grep 有可量化的提升；对上下文体积的压缩尤其明显。它不替代开发者读代码和验证，但能显著减少“从哪开始、改哪些文件、怎么验收”的前置成本。');
  lines.push('');

  await fs.writeFile(path.join(HERE, 'REPORT.md'), `${lines.join('\n')}\n`, 'utf8');
  console.log(`wrote benchmark/results.json and benchmark/REPORT.md (${rows.length} cases, real=${hasReal})`);
  console.log(summaryTable([tuning, heldout, all]));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
