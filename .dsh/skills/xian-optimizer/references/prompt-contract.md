# 提示词契约（Prompt Contract）

本文件是 Xian优化器输出格式的“接口文档”。修改 `lib/render.mjs`、`lib/score.mjs` 或下游消费者前先读它。

## 1. 不变量

生成的提示词必须满足：

1. **保留原意**：`## 2` 的目标来自用户原话，只做口语规范化，不新增产品行为。
2. **代码位置可执行**：每个 `primary` / `likely` 都给出 `path:line`，并说明依据。
3. **角色明确**：`primary` 要改；`likely` 待确认；`reference` 只参考；`test` 补测试；`config` 改配置。
4. **证据可核对**：至少给出符号、路由或内容命中；行号必须提醒读者复核。
5. **约束可执行**：最小 diff、复用现有模式、不无故升级依赖。
6. **验收可验证**：每条验收标准都能通过测试、命令或明确的手工步骤判断。
7. **命令来自项目**：`## 7` 的命令来自 `package.json` / 锁文件 / 框架配置，不硬编码。
8. **诚实**：低置信度、索引截断、无匹配、输出截断都必须出现在 `warnings` 或 `## 8`。

## 2. 章节顺序

| 章节 | 必填 | 内容 |
| --- | --- | --- |
| 标题 | 是 | `# 任务：<title>` |
| 元信息 | 是 | 置信度、项目名、文件数、体积 |
| 0. 执行摘要 | 是 | 类型、置信度、首选位置、技术栈、Git |
| 1. 项目框架 | 是 | 语言、框架、入口、命令、目录、文档 |
| 2. 需求（规范化） | 是 | 目标、范围、不在范围 |
| 3. 代码定位 | 是 | 表格 + 复核提醒 |
| 3.1 关键代码证据 | 有候选时 | 2–5 段代码片段 |
| 4. 实施约束 | 是 | 通用 + 意图专项 |
| 5. 实施步骤 | 是 | 阅读 → 实现 → 测试 → 验证 |
| 6. 验收标准 | 是 | 可勾选清单 |
| 7. 验证命令 | 是 | 项目真实命令 |
| 8. 待确认 | 是 | 无问题也要显式写“无阻塞问题” |
| 9. 给执行 AI 的提示 | 是 | 先读后改、最小 diff、回复结构 |
| 原始需求 | 是 | 原话 fenced block |

## 3. JSON 结果契约

`optimizePrompt()` 返回：

```ts
interface XianResult {
  ok: true
  title: string
  confidence: '高' | '中' | '低'
  intent: string
  intents: string[]
  root: string
  project: {
    name: string
    languages: { name: string; files: number; pct: number }[]
    frameworks: { name: string; evidence: string }[]
    packageManagers: string[]
    entrypoints: string[]
    commands: { name: string; command: string; source: string }[]
    git: { isGit: boolean; changed: number }
  }
  stats: { files: number; directories: number; totalBytes: number; totalSize: string; truncated: boolean }
  files: Array<{
    path: string
    line: number
    symbol: string
    role: 'primary' | 'likely' | 'reference' | 'test' | 'config'
    roleLabel: string
    layer: string
    score: number
    reasons: string[]
    matched: string[]
    isTest: boolean
    isConfig: boolean
  }>
  warnings: string[]
  prompt: string
  promptChars: number
  generatedAt: string
  query: { rewritten: string; tokens: string[]; intents: string[] }
  index: { summary: string; files: number; truncated: boolean; groups: unknown[]; entrypoints: string[]; commands: unknown[] }
}
```

## 4. 评分权重（`lib/score.mjs`）

| 信号 | 近似权重 | 说明 |
| --- | --- | --- |
| 文件名精确 | 22 | `login.css` 命中 `login` |
| 文件名包含 | 13 | `LoginButton.tsx` 命中 `button` |
| 目录命中 | 9 | `src/api` 命中 `api` |
| 路径包含 | 5 | 兜底 |
| 符号精确 / 拆分 | 17 | `LoginButton`、`login-button` |
| 符号包含 | 10 | 弱命中 |
| 内容词频 | 1–7 | `1 + log2(count + 1)`，封顶 7 |
| 导入名 | 3 | `@/api/auth` |
| 入口 | 5 | 仅已有匹配时 |
| Git 未提交 | 10 | 仅已有匹配时 |
| 测试 | +8 / -2 | 仅测试/bug 意图且已有匹配时 |
| 配置 | +9 / -4 | 配置意图 |
| 文档 | +9 / -3 | 文档意图 |
| 样式文件 | +9 | UI 意图且已有匹配时 |
| UI 目录 | +3 | UI 意图且已有匹配时 |
| 生成物 | -30 | dist、min、map |

**重要约束**：所有“加分”只在 `score > 0`（至少一个 token 命中）时生效。否则任意测试文件、入口文件、Git 变更都会变成候选，导致低质量定位。

导入图扩展：对 top 3 seed 的直接依赖/被依赖项加 `max(3, seed.score * 0.35)`，并记录 `与 X 有直接导入关系`。

角色阈值：

- 第 1 个：`primary`
- 测试文件：`test`
- 配置文件：`config`
- `score >= topScore * 0.55` 或（UI 意图 + 样式文件）：`likely`
- 其余：`reference`

## 5. 扩展点

### 新增同义词

编辑 `SYNONYM_GROUPS`：

```js
['invoice', 'billing', '账单', '发票'],
```

中文词不参与 token 权重（只用于触发整组），英文词会加入搜索 token。

### 新增意图

1. 在 `INTENT_RULES` 加正则。
2. 在 `INTENT_LABEL` 加显示名。
3. 在 `ACCEPTANCE_BY_INTENT` 加验收标准。
4. 在 `scopeBullets` 的 layer 映射里按需补充。

### 新增语言

1. `lib/util.mjs` 的 `CODE_EXTENSIONS` / `TEXT_EXTENSIONS` 加扩展名。
2. `lib/scan.mjs` 的 `LANGUAGE_BY_EXT`、`parseSymbols`、`parseImports`、`parseRoutes` 加分支。
3. `lib/core.mjs` 的 `SNIPPET_LANG` 加代码围栏语言。
4. 在 `test/fixture` 或新 fixture 加样本。

### 新增 UI 挂载点

客户端插件的挂载点在 `lib/client.js`：

```js
ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
  name: "conversation.input.right",
  id: "xian-optimizer",
  order: 50,
}, XianButton));
```

`conversation.input.right` 是 `list`、`session` scope，标准 props 含 `useInput`、`useSessions`、`inputActions`。不要改成 `single` 或替换现有按钮。

### 流式进度契约

`POST /api/xian/optimize-stream` 返回 `application/x-ndjson`，每行一个 JSON：

```json
{"type":"progress","stage":"scan","percent":24,"depth":32,"label":"文件清单完成","detail":"39 个文件 · 12 个目录","files":39,"dirs":12,"at":1760000000000}
{"type":"result","ok":true,"prompt":"# 任务：…","confidence":"高","files":[],"understanding":86,"promptChars":3711,"at":1760000000001}
```

- `progress.percent`：0–100，UI 进度条。
- `progress.depth`：0–100，「理解深度」条。
- `stage` 建议值：`prepare`、`scan`、`parse`、`graph`、`understand`、`rank`、`snippets`、`render`、`cache`、`done`。
- `type:"error"` 时携带 `error.message`，客户端直接展示。
- 无流式路由时客户端回退到 `POST /api/xian/optimize`。

`GET /api/xian/asset?name=side|front` 返回角色 WebP；`GET /api/xian/health` 返回路由清单。

### 常驻挂件与优化深度

`POST /api/xian/insight` 接收 `{ cwd, refresh? }`，返回指标型 profile（不含源码/绝对路径）：

```json
{
  "ok": true,
  "profile": {
    "name": "my-project",
    "files": 39,
    "directories": 12,
    "size": "674.2 KB",
    "languages": [{ "name": "Python", "files": 15, "pct": 100 }],
    "frameworks": [{ "name": "PyTorch", "evidence": "import torch" }],
    "entrypoints": ["qq_bot_relay.py"],
    "commands": [{ "name": "测试", "command": "python -m pytest", "source": "Python 项目" }],
    "symbols": 120,
    "imports": 240,
    "tests": 0,
    "symbolCoverage": 80,
    "importCoverage": 70,
    "understanding": 79,
    "truncated": false,
    "generatedAt": "2026-11-08T..."
  }
}
```

`optimize` / `optimize-stream` 接受 `depth`：

| depth | maxFiles | maxChars | 全文兜底 |
| --- | ---: | ---: | --- |
| `fast` | 4 | 6000 | 关闭 |
| `standard` | 8 | 16000 | 低置信度自动 |
| `deep` | 12 | 20000 | 强制 |
| `max` | 15 | 26000 | 强制 |

客户端把 `depth` 存入 `localStorage` 的 `xian-depth`，挂件展开/收起状态存 `xian-widget-open`。

### 新增宿主能力

`lib/host.js` 使用 `ctx.connection.fetch.register` 注册精确路由：

```js
ctx.connection.fetch.register({
  path: "/api/xian/optimize",
  methods: ["POST"],
  requestBody: "buffered",
  fetch: async (request) => { ... },
});
```

- 路由仅 owner peer 可访问（`dsh-client-connection` 已做）。
- 请求体上限由 carrier 控制；本插件另外限制 prompt ≤ 20,000 字符。
- 返回值必须是 `Response`；不要返回裸对象。

## 6. 测试义务

修改以下内容必须同步测试：

- 评分权重 / 角色阈值 → `test/run-tests.mjs` 的中英文 UI、bug、config、docs 用例。
- 模板章节 → 检查 `## 8` 始终存在、`原始需求` 保留。
- 宿主路由 → health、普通 optimize、stream、insight、asset、空 prompt、错误 content-type、非法 cwd。
- 客户端 bundle → 模块 id、`inject`、slot 名称/id/order、流式进度解析、预览/替换/复制、角色浮窗、常驻理解挂件、深度设置。

## 7. 兼容性

- Node 20+；DSH 自带 Node 24。
- 无第三方依赖，不依赖 `fetch` 以外的浏览器 API（客户端只用 `fetch` / React）。
- Windows 路径统一转 POSIX 存储，输出给用户时保留原始分隔符语义（`toPosix` 仅用于索引键）。
