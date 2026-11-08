/**
 * Xian优化器 — deterministic prompt renderer.
 *
 * The output is a ready-to-paste brief for a coding agent. It is intentionally
 * explicit about evidence, uncertainty and verification.
 */

import path from 'node:path';

import { acceptanceFor, executionHints, explainItem } from './score.mjs';
import { formatBytes, tableCell, truncate } from './util.mjs';

const INTENT_LABEL = {
  feature: '功能开发 / 增量实现',
  bug: '缺陷修复',
  refactor: '重构 / 整理',
  test: '测试补充',
  docs: '文档更新',
  config: '配置 / 构建 / 部署',
  ui: '界面 / 交互调整',
  api: '接口 / 服务端逻辑',
  db: '数据模型 / 数据库',
  perf: '性能优化',
  security: '权限 / 安全',
};

function intentLabel(query) {
  const primary = INTENT_LABEL[query.primaryIntent] ?? '代码修改';
  const extra = query.intents.filter((item) => item !== query.primaryIntent).map((item) => INTENT_LABEL[item]).filter(Boolean);
  return extra.length > 0 ? `${primary}（兼：${extra.slice(0, 2).join('、')}）` : primary;
}

function fenceFor(code) {
  return code.includes('```') ? '~~~~' : '```';
}

function actionFor(item) {
  switch (item.role) {
    case 'primary': return '优先阅读并修改';
    case 'likely': return '确认是否承载该逻辑';
    case 'test': return '补充 / 调整测试';
    case 'config': return '核对命令与配置';
    default: return '参考其实现模式';
  }
}

function scopeBullets(index, ranked, query) {
  const actionItems = ranked.items.filter((item) => item.role === 'primary' || item.role === 'likely');
  const layers = new Set(actionItems.map((item) => item.layer));
  if (layers.size === 0 && ranked.items[0]) layers.add(ranked.items[0].layer);
  const map = {
    ui: 'UI 层：组件、页面、样式与交互状态',
    api: '接口层：路由、控制器、请求校验与错误响应',
    domain: '业务层：服务、用例与领域规则',
    data: '数据层：模型、仓储、迁移与查询',
    state: '状态层：store、hooks 与数据流',
    util: '工具层：共享函数与类型',
    tests: '测试层：单元、集成或端到端测试',
    config: '配置层：构建、环境变量与脚本',
    docs: '文档层：README、使用说明与示例',
    source: '业务源码',
  };
  const bullets = [...layers].map((layer) => map[layer]).filter(Boolean);
  if (bullets.length === 0) bullets.push('待定位：请先确认承载该需求的模块');
  if (query.wantsUi && !layers.has('ui')) bullets.push('可能涉及 UI 层：请在定位后补充组件/样式文件');
  if (query.wantsApi && !layers.has('api')) bullets.push('可能涉及接口层：请补充路由/控制器位置');
  return bullets.slice(0, 5);
}

function commandRows(index) {
  return (index.stack.commands ?? []).slice(0, 8);
}

function frameworkLine(index) {
  const stack = index.stack;
  const parts = [];
  if (stack.frameworks.length > 0) parts.push(stack.frameworks.map((item) => item.name).join('、'));
  if (stack.packageManagers.length > 0) parts.push(`包管理：${stack.packageManagers.join('、')}`);
  return parts.join(' · ') || '未识别到框架，按现有目录结构执行';
}

function languageLine(index) {
  return index.stack.languages.slice(0, 5).map((item) => `${item.name} ${item.pct}%`).join(' · ') || '未识别';
}

function buildEvidence(ranked, snippets, budget) {
  const blocks = [];
  let used = 0;
  for (const raw of ranked.items.slice(0, 5)) {
    const item = explainItem(raw, { tokens: raw.matched.map((token) => ({ token })) });
    const snippet = snippets.get(item.path);
    if (!snippet) continue;
    const label = snippet.symbol ? ` · ${snippet.symbol}` : '';
    const header = `#### \`${item.path}:${snippet.line}\`${label}\n`;
    const fence = fenceFor(snippet.code);
    const block = `${header}${fence}${snippet.lang || ''}\n${snippet.code}\n${fence}\n`;
    if (used + block.length > budget && blocks.length > 0) break;
    blocks.push(block);
    used += block.length;
  }
  return { text: blocks.join('\n'), used };
}

/**
 * Render the optimized prompt.
 *
 * @param {object} input
 * @param {object} input.index
 * @param {object} input.query
 * @param {{items: object[], confidence: string, warnings: string[]}} input.ranked
 * @param {Map<string, {line: number, code: string, lang: string}>} input.snippets
 * @param {object} [options]
 * @returns {{prompt: string, files: object[], warnings: string[], confidence: string}}
 */
export function renderPrompt(input, options = {}) {
  const { index, query, ranked, snippets } = input;
  const maxChars = Number.isFinite(options.maxChars) ? options.maxChars : 16000;
  const items = ranked.items.map((item) => explainItem(item, query));
  const primary = items[0];
  const confidence = ranked.confidence;
  const warnings = [...(ranked.warnings ?? [])];
  const title = query.title || '代码修改任务';

  const lines = [];
  lines.push(`# 任务：${title}`);
  lines.push('');
  lines.push(`> Xian优化器生成 · 置信度：${confidence} · 项目：${index.name} · ${index.stats.files} 个文件 / ${index.stats.totalSize}`);
  lines.push('');

  lines.push('## 0. 执行摘要');
  lines.push('');
  lines.push(`- **需求类型**：${intentLabel(query)}`);
  lines.push(`- **定位置信度**：${confidence}${primary ? `；首选 \`${primary.path}:${primary.line}\`` : '；暂未定位到明确文件'}`);
  lines.push(`- **技术栈**：${languageLine(index)}`);
  lines.push(`- **框架 / 包管理**：${frameworkLine(index)}`);
  if (index.git?.isGit) {
    lines.push(`- **Git 状态**：${index.git.changed.length > 0 ? `${index.git.changed.length} 个未提交变更（已参与排序）` : '工作区干净'}`);
  }
  lines.push('');

  lines.push('## 1. 项目框架（先读）');
  lines.push('');
  lines.push('### 1.1 技术栈与入口');
  lines.push('');
  lines.push(`- 语言：${languageLine(index)}`);
  lines.push(`- 框架：${index.stack.frameworks.map((item) => item.name).join('、') || '未识别'}`);
  lines.push(`- 入口：${index.stack.entrypoints.length > 0 ? index.stack.entrypoints.map((item) => `\`${item}\``).join('、') : '未识别'}`);
  lines.push(`- 包管理：${index.stack.packageManagers.join('、') || '未识别'}`);
  lines.push('');

  const commands = commandRows(index);
  if (commands.length > 0) {
    lines.push('### 1.2 可用命令');
    lines.push('');
    lines.push('| 用途 | 命令 | 来源 |');
    lines.push('| --- | --- | --- |');
    for (const command of commands) {
      lines.push(`| ${tableCell(command.name)} | \`${tableCell(command.command)}\` | ${tableCell(command.source)} |`);
    }
    lines.push('');
  }

  if (index.architecture.groups.length > 0) {
    lines.push('### 1.3 关键目录');
    lines.push('');
    lines.push('| 目录 | 职责 | 文件数 | 示例 |');
    lines.push('| --- | --- | --- | --- |');
    for (const group of index.architecture.groups.slice(0, 8)) {
      lines.push(`| \`${tableCell(group.path)}\` | ${tableCell(group.label)} | ${group.files} | ${group.examples.slice(0, 2).map((example) => `\`${tableCell(example)}\``).join('<br>')} |`);
    }
    lines.push('');
  }

  if (index.architecture.docs.length > 0) {
    lines.push('### 1.4 项目文档');
    lines.push('');
    for (const doc of index.architecture.docs.slice(0, 4)) {
      lines.push(`- \`${doc.path}\`${doc.title ? ` — ${doc.title}` : ''}`);
    }
    lines.push('');
  }

  lines.push('## 2. 需求（规范化）');
  lines.push('');
  lines.push(`**目标**：${query.rewritten || query.text}`);
  lines.push('');
  lines.push('**范围（按定位结果收敛）**：');
  for (const bullet of scopeBullets(index, ranked, query)) lines.push(`- ${bullet}`);
  lines.push('');
  lines.push('**不在范围**：');
  lines.push('- 不修改与目标无关的模块，不做顺手重构。');
  lines.push('- 不升级依赖、不改构建链，除非需求必须且已说明理由。');
  lines.push('- 不改变现有公开 API / 数据契约；如必须破坏性变更，先列出影响面。');
  lines.push('');

  lines.push('## 3. 代码定位（按优先级）');
  lines.push('');
  if (items.length === 0) {
    lines.push('> 未找到明确匹配。请先用 `glob` / `grep` 找到承载该需求的模块，再按同样格式补充代码路径。');
    lines.push('');
  } else {
    lines.push('| # | 位置 | 角色 | 依据 | 建议动作 |');
    lines.push('| --- | --- | --- | --- | --- |');
    items.forEach((item, indexInList) => {
      lines.push(`| ${indexInList + 1} | \`${tableCell(item.path)}:${item.line}\` | ${tableCell(item.roleLabel)} | ${tableCell(item.reasonText)} | ${tableCell(actionFor(item))} |`);
    });
    lines.push('');
    lines.push('> 行号来自索引与符号匹配。动手前必须打开文件确认；若行号漂移，以实际内容为准。');
    lines.push('');
  }

  const overhead = lines.join('\n').length + 2400;
  const evidenceBudget = Math.max(1800, Math.min(5200, maxChars - overhead));
  const evidence = buildEvidence(ranked, snippets, evidenceBudget);
  if (evidence.text) {
    lines.push('### 3.1 关键代码证据');
    lines.push('');
    lines.push(evidence.text);
    lines.push('');
  }

  lines.push('## 4. 实施约束');
  lines.push('');
  lines.push(`- 遵循现有 ${index.stack.languages[0]?.name ?? '项目'} 代码风格、目录分层、命名和错误处理方式。`);
  lines.push('- 复用已有的组件、服务、类型、请求封装和样式变量，不新建平行实现。');
  lines.push('- 新增逻辑必须有明确的所有权：放在最接近现有职责的模块，而不是塞进入口文件。');
  lines.push('- 改动保持最小；如果必须扩大范围，先在回复中说明原因和影响面。');
  if (query.wantsUi) lines.push('- UI 改动复用现有设计 token / 组件；补齐 hover、focus、disabled、loading 与空态。');
  if (query.wantsApi) lines.push('- 接口改动保持现有鉴权、入参校验、错误结构和响应包装。');
  if (query.wantsDb) lines.push('- 数据改动提供可回滚迁移，并说明对既有数据的影响。');
  if (query.isBug) lines.push('- 先写清根因和失败路径，再改代码；不要用吞异常或加延时掩盖问题。');
  lines.push('');

  lines.push('## 5. 实施步骤');
  lines.push('');
  const primaryLocation = primary ? `\`${primary.path}:${primary.line}\`` : '相关模块';
  lines.push(`1. 阅读${primaryLocation}${primary ? `（${primary.symbol || primary.roleLabel}）` : ''}及其直接依赖，确认现有调用链。`);
  if (items.length > 1) lines.push(`2. 对照 ${items.slice(1, 4).map((item) => `\`${item.path}\``).join('、')}，确认哪些是修改点、哪些只是参考。`);
  else lines.push('2. 用 `grep` 搜索同类实现，确认项目内已有模式后再动手。');
  lines.push('3. 先实现最小可用路径，再补错误处理、边界条件和加载/空态。');
  if (query.wantsTest || query.isBug) lines.push('4. 补一个能在修改前失败、修改后通过的测试；覆盖失败路径。');
  else lines.push('4. 补充或更新与改动直接相关的测试；没有测试框架时给出可复现的手动验证步骤。');
  lines.push('5. 运行“验证命令”，检查 diff，只保留与目标相关的改动。');
  lines.push('');

  lines.push('## 6. 验收标准');
  lines.push('');
  for (const criterion of acceptanceFor(query)) lines.push(`- [ ] ${criterion}`);
  lines.push('');

  lines.push('## 7. 验证命令');
  lines.push('');
  const verifyCommands = commands.filter((command) => !['开发', '启动'].includes(command.name));
  const commandsToRun = verifyCommands.length > 0 ? verifyCommands : commands;
  if (commandsToRun.length > 0) {
    lines.push('```bash');
    for (const command of commandsToRun) lines.push(`# ${command.name}\n${command.command}`);
    lines.push('git diff --stat');
    lines.push('```');
  } else {
    lines.push('> 未识别到测试/构建命令。请向用户确认项目使用的命令，或从 README / CI 配置中补齐。');
  }
  lines.push('');

  const questions = [];
  if (confidence === '低') questions.push('需求较短或未命中明确模块：请补充目标页面/模块名、期望交互，以及是否允许新增依赖。');
  if (items.length === 0) questions.push('请提供项目根目录，或指出一个相关文件/函数名。');
  if (query.isQuestion) questions.push('原需求是提问句式：请确认是要“解释现状”还是“直接修改代码”。');
  if (questions.length > 0) {
    lines.push('## 8. 待确认');
    lines.push('');
    for (const question of questions) lines.push(`- ${question}`);
    lines.push('');
  } else {
    lines.push('## 8. 待确认');
    lines.push('');
    lines.push('- 无阻塞性问题。按上述范围与假设执行；若实现时发现与现状冲突，先说明再调整。');
    lines.push('');
  }

  lines.push('## 9. 给执行 AI 的提示');
  lines.push('');
  for (const hint of executionHints(query)) lines.push(`- ${hint}`);
  lines.push('- 回复结构：结论 → 改动文件 → 验证结果 → 剩余风险；不要粘贴大段无关代码。');
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('**原始需求（保留原意，供对照）**');
  lines.push('');
  lines.push('```text');
  lines.push(query.text);
  lines.push('```');

  let prompt = lines.join('\n');
  if (prompt.length > maxChars) {
    const cut = prompt.lastIndexOf('\n', maxChars - 200);
    const head = prompt.slice(0, Math.max(0, cut));
    const fences = (head.match(/^```/gm) ?? []).length;
    const tildes = (head.match(/^~~~/gm) ?? []).length;
    prompt = `${head}${fences % 2 === 1 ? '\n```' : ''}${tildes % 2 === 1 ? '\n~~~' : ''}\n\n> 提示词已按长度上限截断；优先保留代码定位与验收标准。`;
    warnings.push(`输出超过 ${maxChars} 字符，已截断。`);
  }

  return {
    prompt,
    confidence,
    warnings: [...new Set(warnings)],
    files: items.map((item) => ({
      path: item.path,
      line: item.line,
      symbol: item.symbol,
      role: item.role,
      roleLabel: item.roleLabel,
      layer: item.layer,
      score: item.score,
      reasons: item.reasons,
      matched: item.matched,
      isTest: item.isTest,
      isConfig: item.isConfig,
    })),
  };
}

/** Compact JSON result for the UI and for `--json`. */
export function renderResult(input, rendered) {
  const { index, query, ranked } = input;
  return {
    ok: true,
    title: query.title,
    confidence: rendered.confidence,
    intent: query.primaryIntent,
    intents: query.intents,
    root: index.root,
    project: {
      name: index.name,
      languages: index.stack.languages,
      frameworks: index.stack.frameworks,
      packageManagers: index.stack.packageManagers,
      entrypoints: index.stack.entrypoints,
      commands: index.stack.commands,
      git: {
        isGit: index.git?.isGit === true,
        changed: index.git?.changed?.length ?? 0,
      },
    },
    stats: index.stats,
    files: rendered.files,
    warnings: rendered.warnings,
    prompt: rendered.prompt,
    promptChars: rendered.prompt.length,
    generatedAt: new Date().toISOString(),
  };
}

/** One-line human summary for CLI stderr. */
export function oneLineSummary(result) {
  const first = result.files?.[0];
  return `${result.project?.name ?? '项目'} · 置信度 ${result.confidence} · ${first ? `${first.path}:${first.line}` : '未定位'} · ${formatBytes(result.promptChars ?? 0)} 提示词`;
}

/** Keep only the part before the first H1 when embedding. */
export function stripTitle(prompt) {
  const index = String(prompt).indexOf('\n## ');
  return index > 0 ? String(prompt).slice(index + 1) : String(prompt);
}

/** Relative display path. */
export function displayPath(root, file) {
  return path.posix.relative(root.replace(/\\/g, '/'), file.replace(/\\/g, '/'));
}

/** Shorten a prompt for logs. */
export function preview(prompt, max = 160) {
  return truncate(String(prompt).replace(/\s+/g, ' '), max);
}
