/**
 * Xian优化器 — query understanding and code-location scoring.
 */

import path from 'node:path';

import {
  NON_CODE_EXTENSIONS,
  asciiWords,
  cjkBigrams,
  cleanPrompt,
  normalizeGoal,
  splitIdentifier,
  stripFiller,
  titleFromPrompt,
  toPosix,
  truncate,
} from './util.mjs';

const SYNONYM_GROUPS = [
  ['login', 'signin', 'auth', '登录', '登陆', '登入'],
  ['register', 'signup', '注册'],
  ['logout', 'signout', '退出'],
  ['button', 'btn', '按钮'],
  ['page', 'view', 'screen', '页面', '视图'],
  ['modal', 'dialog', 'popup', '弹窗', '对话框'],
  ['form', '表单'],
  ['checkbox', 'check', '复选框', '勾选'],
  ['remember', 'persist', '记住', '保持登录'],
  ['list', 'table', '列表', '表格'],
  ['search', 'filter', 'query', '搜索', '筛选', '查询'],
  ['upload', '上传'],
  ['download', '下载'],
  ['file', 'files', '文件'],
  ['size', 'limit', '大小', '限制'],
  ['request', '请求'],
  ['response', '响应'],
  ['status', '状态码'],
  ['api', 'endpoint', 'route', 'controller', '接口', '路由', '控制器'],
  ['server', 'backend', '服务端', '后端'],
  ['client', 'frontend', '前端'],
  ['database', 'db', 'sql', '数据库', '数据表'],
  ['model', 'schema', 'entity', '模型', '实体'],
  ['style', 'css', 'scss', 'theme', 'color', '样式', '颜色', '主题'],
  ['error', 'exception', 'bug', '报错', '错误', '异常', '崩溃'],
  ['fix', 'repair', '修复'],
  ['test', 'spec', 'coverage', '测试', '覆盖'],
  ['docs', 'documentation', 'readme', '文档', '注释'],
  ['config', 'configuration', 'env', '配置', '环境变量'],
  ['permission', 'role', 'acl', '权限', '角色', '授权'],
  ['user', 'account', '用户', '账号'],
  ['performance', 'cache', 'speed', '性能', '缓存', '优化'],
  ['layout', 'responsive', '布局', '响应式'],
  ['validate', 'validation', '校验', '验证'],
  ['notify', 'notification', 'toast', '提示', '通知'],
  ['loading', 'spinner', '加载', '骨架屏'],
  ['pagination', 'page', '分页'],
  ['state', 'store', '状态', '状态管理'],
  ['hook', 'composable', '钩子'],
  ['component', 'widget', '组件'],
  ['service', 'usecase', 'business', '服务', '业务'],
  ['middleware', 'interceptor', '中间件', '拦截器'],
  ['deploy', 'build', 'ci', 'docker', '部署', '构建'],
  ['i18n', 'locale', 'translation', '国际化', '多语言'],
];

const INTENT_RULES = [
  ['bug', /(bug|fix|修复|报错|错误|异常|崩溃|不工作|失败|error|exception|broken|regression)/i],
  ['feature', /(加|新增|添加|实现|支持|能够|想要|add|create|implement|feature|new|build)/i],
  ['refactor', /(重构|优化|整理|拆分|重命名|refactor|cleanup|rename|extract)/i],
  ['test', /(测试|test|spec|覆盖|coverage|e2e)/i],
  ['docs', /(文档|readme|注释|doc|documentation)/i],
  ['config', /(配置|config|env|部署|deploy|构建|build|ci|docker)/i],
  ['ui', /(页面|按钮|样式|颜色|布局|ui|css|theme|component|modal|弹窗|表单|button|checkbox|hover|style|layout|color|form)/i],
  ['api', /(接口|api|路由|请求|endpoint|controller|server|后端)/i],
  ['db', /(数据库|db|sql|表|字段|migration|model|schema)/i],
  ['perf', /(性能|慢|卡顿|optimize|cache|memory|speed|优化)/i],
  ['security', /(安全|权限|认证|授权|auth|permission|role|xss|csrf|injection)/i],
];

/**
 * Domain words that should pull the ranking toward the file that owns that
 * concern (validation utilities, emotion model, dataset builder, ...).
 * These are deliberately small and explicit; they complement, not replace,
 * path/symbol/content matching.
 */
const FOCUS_RULES = [
  { test: /(校验|验证|格式|validate|validation|schema)/i, terms: ['validate', 'validation', 'validator', 'schema', '校验', '验证', '格式'], weight: 24 },
  { test: /(签到|checkin|奖励|连续签到)/i, terms: ['checkin', '签到', '奖励', '连续'], weight: 18 },
  { test: /(情绪|情感|emotion|mood)/i, terms: ['emotion', 'mood', '情绪', '情感'], weight: 10 },
  { test: /(训练|数据集|打标|dataset|training)/i, terms: ['training', 'dataset', '数据集', '训练', '打标'], weight: 16 },
  { test: /(自动学习|auto.?learn|学习脚本)/i, terms: ['auto_learn', 'auto-learn', 'learn', '学习'], weight: 20 },
  { test: /(人设|persona|角色)/i, terms: ['persona', '人设', '角色'], weight: 36 },
  { test: /(重复回复|重复|reply|message)/i, terms: ['reply', 'message', '回复', '消息', '重复'], weight: 12 },
  { test: /(挂件|浮窗|悬浮|按钮|界面|UI|widget|component|panel)/i, terms: ['client', 'widget', '挂件', '浮窗'], weight: 18 },
  { test: /(样式|style|css|scss|hover|颜色|圆角)/i, terms: ['style', 'css', 'scss', 'hover', 'color', '样式', '颜色', '圆角'], weight: 25 },
];

const ACCEPTANCE_BY_INTENT = {  feature: [
    '核心路径可用，用户能完成需求描述中的操作。',
    '新增逻辑有对应的测试或可复现的手动验证步骤。',
    '相邻路径（同类调用方、错误分支）不被本次改动破坏。',
  ],
  bug: [
    '能按复现步骤稳定触发原问题，修复后同一路径不再失败。',
    '补充一个回归测试，覆盖本次根因而不是只覆盖表象。',
    '相邻路径（同类调用方、错误分支）不被修复改坏。',
  ],
  refactor: [
    '对外行为保持不变，现有测试全部通过。',
    '职责边界更清晰，重复逻辑被收敛，没有引入新的循环依赖。',
    '公共 API 的签名、类型与错误语义保持兼容，除非明确说明破坏性变更。',
  ],
  test: [
    '新增测试能在修复前失败、修复后通过（或明确标注为快照/契约测试）。',
    '覆盖成功、失败和边界输入，不只覆盖 happy path。',
    '测试不依赖真实网络、真实时间和未固定的随机值。',
  ],
  docs: [
    '文档中的命令、路径、示例与实际代码一致。',
    '补充必要的限制、前置条件和失败排查说明。',
    '不复制实现细节作为文档结论，关键行为有对应代码位置的引用。',
  ],
  config: [
    '默认配置下项目可构建、可启动、可测试。',
    '新增配置有默认值、校验和失败提示，不破坏旧配置。',
    '敏感信息不写入仓库，示例使用占位符。',
  ],
  ui: [
    '目标页面在常见视口下布局正确，不溢出、不遮挡。',
    '交互有 hover/focus/disabled/loading 状态，键盘可操作。',
    '颜色与间距复用现有设计变量，不硬编码新的视觉体系。',
  ],
  api: [
    '入参校验覆盖缺失、类型错误和越界值，返回稳定的错误结构。',
    '成功与失败路径都有测试，状态码与错误码符合现有约定。',
    '不泄露内部实现细节或敏感数据。',
  ],
  db: [
    '迁移可正向执行、可回滚，不破坏已有数据。',
    '查询有必要的索引和边界保护，避免 N+1 或全表扫描。',
    '字段命名、类型和约束与现有模型一致。',
  ],
  perf: [
    '先给出可复现的基线测量，再给出优化后的对比数据。',
    '优化不改变可观察行为，缓存有失效策略。',
    '不为未证明的瓶颈引入复杂度。',
  ],
  security: [
    '权限检查在服务端执行，不能只依赖前端隐藏。',
    '失败默认拒绝，错误信息不泄露凭据或内部路径。',
    '补充越权、未登录、过期凭据的测试。',
  ],
};

const EXECUTION_HINTS = [
  '先读取“代码定位”中的文件，确认符号、行号和现有实现，再开始修改；索引只用于缩小范围，不是事实来源。',
  '沿“入口 → 路由/组件 → 服务 → 数据”追一遍调用链，优先复用现有模式，不新建平行实现。',
  '保持 diff 最小：只改与目标直接相关的文件；需要扩大范围时先说明原因。',
  '修改后运行“验证命令”，并在回复中给出实际命令、结果和剩余风险。',
];

function normalizeToken(token) {
  return String(token)
    .toLowerCase()
    .replace(/^[._-]+|[._-]+$/g, '')
    .trim();
}

function addToken(map, token, weight) {
  const value = normalizeToken(token);
  if (!value || value.length < 2) return;
  const previous = map.get(value) ?? 0;
  if (weight > previous) map.set(value, weight);
}

function promptContains(prompt, word) {
  if (/[\u3400-\u9fff]/.test(word)) return prompt.includes(word);
  return new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(prompt);
}

/**
 * Resolve a rough request into weighted search tokens, intent and flags.
 *
 * @param {string} prompt
 * @returns {object}
 */
export function resolveQuery(prompt) {
  const cleaned = cleanPrompt(prompt);
  const tokens = new Map();
  const direct = [...asciiWords(cleaned), ...cjkBigrams(cleaned), ...(cleaned.match(/\b\d{3,4}\b/g) ?? [])];
  for (const token of direct) addToken(tokens, token, 1.2);
  for (const group of SYNONYM_GROUPS) {
    if (group.some((word) => promptContains(cleaned, word))) {
      for (const word of group) {
        if (/[\u3400-\u9fff]/.test(word)) continue;
        addToken(tokens, word, 0.85);
      }
    }
  }
  for (const part of asciiWords(cleaned)) {
    for (const piece of splitIdentifier(part)) addToken(tokens, piece, 1);
  }

  const intents = INTENT_RULES.filter(([, regex]) => regex.test(cleaned)).map(([name]) => name);
  if (intents.length === 0) intents.push(cleaned.length <= 12 ? 'feature' : 'feature');
  const focus = FOCUS_RULES
    .filter((rule) => rule.test.test(cleaned))
    .map((rule) => ({ terms: rule.terms, weight: rule.weight }));
  const primaryIntent = intents[0];
  const wantsTest = intents.includes('test') || /(测试|test|spec|覆盖)/i.test(cleaned);
  const wantsDocs = intents.includes('docs');
  const wantsConfig = intents.includes('config');
  const wantsUi = intents.includes('ui');
  const wantsApi = intents.includes('api');
  const wantsDb = intents.includes('db');
  const isBug = intents.includes('bug');
  const isFeature = intents.includes('feature');
  const isRefactor = intents.includes('refactor');
  const isQuestion = /(怎么|如何|为什么|是什么|能否|how|why|what|哪里|哪个)/i.test(cleaned);

  return {
    text: cleaned,
    rewritten: normalizeGoal(stripFiller(cleaned)),
    title: titleFromPrompt(cleaned),
    tokens: [...tokens.entries()].map(([token, weight]) => ({ token, weight })),
    intents,
    primaryIntent,
    focus,
    wantsTest,
    wantsDocs,
    wantsConfig,
    wantsUi,
    wantsApi,
    wantsDb,
    isBug,
    isFeature,
    isRefactor,
    isQuestion,
    language: /[\u3400-\u9fff]/.test(cleaned) ? 'zh' : 'en',
  };
}

function layerOf(file) {
  if (file.isTest) return 'tests';
  if (file.isConfig) return 'config';
  if (file.isDoc) return 'docs';
  const lower = file.path.toLowerCase();
  if (/(^|\/)(components|ui|views|pages|screens|widgets|layouts|styles?)\//.test(lower) || ['.css', '.scss', '.sass', '.less'].includes(file.ext)) return 'ui';
  if (/(^|\/)(api|routes?|controllers?|handlers?|endpoints?|resolvers?)\//.test(lower)) return 'api';
  if (/(^|\/)(db|database|models?|entities|repositories|migrations?|schema)\//.test(lower)) return 'data';
  if (/(^|\/)(services?|domain|use-?cases?|business|core)\//.test(lower)) return 'domain';
  if (/(^|\/)(store|state|hooks?|composables?)\//.test(lower)) return 'state';
  if (/(^|\/)(utils?|lib|helpers?|shared|common)\//.test(lower)) return 'util';
  return 'source';
}

function scoreOne(file, query, changed, contentScores) {
  const tokens = query.tokens;
  const pathLower = toPosix(file.path).toLowerCase();
  const baseName = path.posix.basename(pathLower, file.ext);
  const dirs = new Set(pathLower.split('/').slice(0, -1));
  const symbolRows = (file.symbols ?? []).map((symbol) => ({
    ...symbol,
    lower: symbol.name.toLowerCase(),
    parts: splitIdentifier(symbol.name),
  }));
  const importText = (file.importSpecs ?? []).join(' ').toLowerCase();
  const reasons = [];
  const matched = [];
  const contentTokens = [];
  let pathReason = '';
  let symbolReason = '';
  let importReason = false;
  let score = 0;

  for (const { token, weight } of tokens) {
    let hit = 0;
    if (baseName === token) {
      hit += 22;
      if (!pathReason) pathReason = '文件名精确命中';
    } else if (baseName.includes(token)) {
      hit += 13;
      if (!pathReason) pathReason = '文件名包含关键词';
    } else if (dirs.has(token)) {
      hit += 9;
      if (!pathReason) pathReason = '目录命中';
    } else if (pathLower.includes(token)) {
      hit += 5;
      if (!pathReason) pathReason = '路径命中';
    }
    const symbol = symbolRows.find((row) => row.lower === token || row.parts.includes(token) || row.lower.includes(token));
    if (symbol) {
      hit += symbol.lower === token || symbol.parts.includes(token) ? 17 : 10;
      if (!symbolReason) symbolReason = `符号 ${symbol.name}`;
    }
    const termCount = file.terms?.[token] ?? 0;
    if (termCount > 0) {
      hit += Math.min(7, 1 + Math.log2(termCount + 1));
      if (!contentTokens.includes(token)) contentTokens.push(token);
    }
    if (importText.includes(token)) {
      hit += 3;
      importReason = true;
    }
    if (hit > 0) {
      score += hit * weight;
      matched.push(token);
    }
  }

  if (pathReason) reasons.push(pathReason);
  if (symbolReason) reasons.push(symbolReason);
  if (contentTokens.length > 0) reasons.push(`内容命中：${contentTokens.slice(0, 5).join('、')}`);
  if (importReason) reasons.push('依赖/导入名命中');

  const fallbackScore = contentScores?.get(file.path);
  if (fallbackScore > 0) {
    score += fallbackScore;
    reasons.push('全文关键词命中');
  }

  if (score > 0 && file.isEntry) {
    score += 5;
    reasons.push('入口文件');
  }
  if (file.isGenerated) {
    score -= 30;
  }
  if (score > 0 && changed.has(file.path)) {
    score += 10;
    reasons.push('Git 未提交变更');
  }
  if (file.isTest) {
    if ((query.wantsTest || query.isBug) && score > 0) {
      score += 8;
      reasons.push('测试文件');
    } else if (!query.wantsTest && !query.isBug) {
      score -= 2;
    }
  }
  if (file.isConfig) {
    score += query.wantsConfig ? 9 : -4;
    if (query.wantsConfig) reasons.push('配置文件');
  }
  if (file.isDoc) {
    score += query.wantsDocs ? 9 : -3;
    if (query.wantsDocs) reasons.push('文档');
  }
  if (score > 0 && query.wantsUi && ['.css', '.scss', '.sass', '.less'].includes(file.ext)) {
    score += 9;
    reasons.push('样式文件');
  }
  if (score > 0 && query.wantsUi && /(^|\/)(components|ui|views|pages|screens|widgets|layouts)\//.test(file.path.toLowerCase())) {
    score += 3;
  }
  if (score > 0 && query.focus && query.focus.length > 0) {
    for (const rule of query.focus) {
      const weight = Number.isFinite(rule.weight) ? rule.weight : 10;
      const terms = (rule.terms ?? []).map((term) => String(term).toLowerCase());
      const pathTerm = terms.find((term) => baseName.includes(term) || pathLower.includes(term));
      if (pathTerm) {
        score += file.isDoc ? weight * 0.3 : weight;
        reasons.push(`领域词命中：${pathTerm}`);
        if (baseName.includes(pathTerm) && !file.isDoc) score += weight * 0.5;
        continue;
      }
      const symbolMatch = terms.find((term) => symbolRows.some((row) => row.lower.includes(term) || row.parts.includes(term)));
      if (symbolMatch) {
        score += file.isDoc ? weight * 0.2 : weight * 0.65;
        reasons.push(`领域符号：${symbolMatch}`);
        continue;
      }
      const contentMatch = terms.find((term) => file.terms?.[term]);
      if (contentMatch) {
        score += file.isDoc ? weight * 0.15 : weight * 0.35;
        reasons.push(`领域内容：${contentMatch}`);
      }
    }
  }
  const layer = layerOf(file);
  const layerBoost = score > 0
    ? {
      ui: query.wantsUi ? 4 : 0,
      api: query.wantsApi ? 4 : 0,
      data: query.wantsDb ? 4 : 0,
      tests: query.wantsTest ? 3 : 0,
      config: query.wantsConfig ? 3 : 0,
      docs: query.wantsDocs ? 3 : 0,
    }[layer] ?? 0
    : 0;
  score += layerBoost;
  if (score > 0 && file.lines > 3000) score -= 2;

  return {
    file,
    path: file.path,
    score: Math.round(score * 10) / 10,
    matched: [...new Set(matched)],
    reasons: [...new Set(reasons)].slice(0, 6),
    layer,
    via: undefined,
  };
}

/**
 * Rank candidate files for a query, expanding through the import graph.
 *
 * @param {object} index
 * @param {object} query
 * @param {object} [options]
 * @returns {{items: object[], topScore: number, confidence: string, warnings: string[]}}
 */
export function rankFiles(index, query, options = {}) {
  const maxFiles = Math.max(3, Math.min(15, options.maxFiles ?? 8));
  const changed = new Set(index.git?.changed ?? []);
  const scored = index.files.map((file) => scoreOne(file, query, changed, options.contentScores));
  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const byPath = new Map(scored.map((item) => [item.path, item]));
  const seeds = scored.filter((item) => item.score > 0).slice(0, 3);
  for (const seed of seeds) {
    const graph = index.graph?.[seed.path] ?? { deps: [], dependents: [] };
    for (const neighbor of [...(graph.deps ?? []), ...(graph.dependents ?? [])]) {
      if (neighbor === seed.path) continue;
      const item = byPath.get(neighbor);
      if (!item) continue;
      const bonus = Math.max(3, seed.score * 0.35);
      if (bonus > item.score * 0.5) {
        item.score = Math.round((item.score + bonus) * 10) / 10;
        item.reasons = [...new Set([...item.reasons, `与 ${seed.path} 有直接导入关系`])].slice(0, 6);
        item.via = seed.path;
      }
    }
  }
  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const selected = [];
  const seenDirs = new Map();
  const push = (item) => {
    if (!item || selected.some((row) => row.path === item.path)) return;
    selected.push(item);
  };

  for (const item of scored) {
    if (item.score <= 0) break;
    const dir = path.posix.dirname(item.path);
    const count = seenDirs.get(dir) ?? 0;
    if (count >= 2 && selected.length >= Math.min(4, maxFiles)) continue;
    seenDirs.set(dir, count + 1);
    push(item);
    if (selected.length >= maxFiles) break;
  }

  if (query.wantsTest || query.isBug) {
    const bestTest = scored.find((item) => item.file.isTest && item.matched.length > 0 && !selected.some((row) => row.path === item.path));
    if (bestTest) push(bestTest);
  }
  if (query.wantsConfig) {
    const config = scored.find((item) => item.path === 'package.json' && item.score > 0);
    if (config) push(config);
  }

  const topScore = selected[0]?.score ?? 0;
  const confidence = topScore >= 26 && selected.length >= 2 ? '高' : topScore >= 12 ? '中' : '低';
  const warnings = [];
  if (index.stats?.truncated) warnings.push('项目文件数达到索引上限，结果可能遗漏部分文件。');
  if (topScore === 0) warnings.push('没有找到与需求直接匹配的文件，建议补充模块名、页面名或函数名。');
  if (selected.length === 0) warnings.push('未能定位到候选文件；将生成通用提示词。');
  if (index.git?.unavailable) warnings.push('检测到 .git，但 git 命令不可用（可能被沙箱限制），未利用未提交变更做加权。');
  else if (!index.git?.isGit) warnings.push('项目未检测到 .git，无法利用未提交变更做加权。');

  const items = selected.map((item, indexInList) => {
    const file = item.file;
    const isStyle = ['.css', '.scss', '.sass', '.less'].includes(file.ext);
    const isDocOrData = file.isDoc || NON_CODE_EXTENSIONS.has(file.ext);
    const role = indexInList === 0
      ? 'primary'
      : file.isTest
        ? 'test'
        : file.isConfig
          ? 'config'
          : item.score >= topScore * 0.55 && !isDocOrData || (query.wantsUi && isStyle && item.score > 0)
            ? 'likely'
            : 'reference';
    return {
      path: item.path,
      score: item.score,
      role,
      layer: item.layer,
      matched: item.matched,
      reasons: item.reasons,
      via: item.via,
      isTest: file.isTest,
      isConfig: file.isConfig,
      isDoc: file.isDoc,
      isEntry: file.isEntry,
      symbols: file.symbols ?? [],
      routes: file.routes ?? [],
      lines: file.lines,
      size: file.size,
    };
  });

  const roleOrder = { primary: 0, likely: 1, reference: 2, config: 3, test: 4 };
  items.sort((a, b) => (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9) || b.score - a.score);

  return { items, topScore, confidence, warnings };
}

/** Choose a line to anchor a candidate file. */
export function anchorFor(item, query) {
  const tokens = new Set(query.tokens.map((row) => row.token));
  const symbols = item.symbols ?? [];
  const symbolHit = symbols.find((symbol) => {
    const lower = symbol.name.toLowerCase();
    return tokens.has(lower) || splitIdentifier(symbol.name).some((part) => tokens.has(part));
  });
  if (symbolHit) return { line: symbolHit.line, symbol: symbolHit.name, kind: 'symbol' };
  const route = (item.routes ?? [])[0];
  if (route) return { line: route.line, symbol: `${route.method} ${route.path}`, kind: 'route' };
  const first = symbols[0];
  if (first) return { line: first.line, symbol: first.name, kind: 'symbol', fallback: true };
  return { line: 1, symbol: '', kind: 'file' };
}

/** Build the search explanation for one item. */
export function explainItem(item, query) {
  const anchor = anchorFor(item, query);
  const roleLabel = {
    primary: '首选修改点',
    likely: '可能修改点',
    reference: '参考实现',
    test: '测试参考',
    config: '配置参考',
  }[item.role] ?? item.role;
  const reasons = [...(item.reasons ?? [])];
  if (anchor.fallback) reasons.push('锚点为该文件首个函数，仅代表入口，需在文件内进一步定位');
  return {
    ...item,
    ...anchor,
    roleLabel,
    reasonText: reasons.length > 0 ? reasons.join('；') : '综合路径与符号相似度',
    summary: truncate(`${roleLabel}：${item.path}${anchor.symbol ? ` · ${anchor.symbol}` : ''}`, 120),
  };
}

/** Acceptance criteria for the primary intent. */
export function acceptanceFor(query) {
  const base = ACCEPTANCE_BY_INTENT[query.primaryIntent] ?? ACCEPTANCE_BY_INTENT.feature;
  const extra = [];
  if (query.wantsUi) extra.push('空态、加载态、错误态至少各有一个明确表现，不出现白屏或静默失败。');
  if (query.wantsUi) extra.push('如果改动涉及视觉，附一张修改前/后的截图或明确说明无法截图。');
  if (query.wantsApi) extra.push('在回复中列出新增/变更的接口、请求参数与响应示例。');
  if (query.wantsDb) extra.push('说明迁移顺序、回滚方式和数据影响范围。');
  if (query.isBug) extra.push('写明根因，而不是只描述“已修复”。');
  return [...base, ...extra].slice(0, 7);
}

/** Execution hints, optionally narrowed by intent. */
export function executionHints(query) {
  const hints = [...EXECUTION_HINTS];
  if (query.isBug) hints.splice(1, 0, '先用最小复现确认失败路径，再定位最早产生错误状态的位置。');
  if (query.wantsTest) hints.splice(2, 0, '优先补测试再改实现；测试要能在修复前失败。');
  if (query.wantsUi) hints.push('复用现有组件与设计 token，不另起一套样式体系。');
  if (query.wantsApi) hints.push('保持现有错误结构、鉴权中间件和响应包装不变。');
  return hints.slice(0, 6);
}
