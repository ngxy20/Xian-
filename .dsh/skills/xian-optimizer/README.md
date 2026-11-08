# Xian优化器（xian-optimizer）

> 先理解项目，再定位代码，最后把一句话需求改写成 AI 能直接执行的任务书。

Xian优化器是一个 DSH Skill，同时附带一个可选的 DSH Web 输入框按钮。它解决的不是「把提示词写长」，而是三件更具体的事：

1. **理解项目框架**：识别语言、框架、包管理、入口、命令、目录分层、文档、Git 变更。
2. **准确定位代码**：把需求映射到 `文件:行` 与符号，区分「要改的 / 要参考的 / 要补测试的 / 要改配置的」。
3. **规范化提示词**：输出目标、范围、代码位置、关键证据、约束、步骤、验收标准、验证命令和待确认项。

整个过程离线、确定性、只读扫描；不调用 LLM，不上传代码。

---

## 目录

- [30 秒上手](#30-秒上手)
- [它如何工作](#它如何工作)
- [作为 Skill 安装](#作为-skill-安装)
- [CLI 用法](#cli-用法)
- [安装输入框按钮（可选）](#安装输入框按钮可选)
- [输出示例](#输出示例)
- [文件结构](#文件结构)
- [设计原则](#设计原则)
- [安全与隐私](#安全与隐私)
- [开发与测试](#开发与测试)
- [已知限制](#已知限制)
- [故障排查](#故障排查)

---

## 30 秒上手

在项目根目录执行：

```bash
node .dsh/skills/xian-optimizer/scripts/xian.mjs optimize \
  --prompt "给登录页面加一个记住我复选框，并调整登录按钮样式" \
  --root .
```

输出是一份 Markdown 提示词，可直接粘贴给任意 coding agent。常用选项：

```bash
# 结构化 JSON（含 files / confidence / warnings）
node .../scripts/xian.mjs optimize --prompt "修复上传 413" --root . --json --quiet

# 只做项目体检
node .../scripts/xian.mjs doctor --root .

# 写入文件
node .../scripts/xian.mjs optimize --prompt "..." --root . --out .xian/prompt.md
```

Windows PowerShell 中路径和引号：

```powershell
node ".dsh\skills\xian-optimizer\scripts\xian.mjs" optimize `
  --prompt '给登录页加记住我' `
  --root "E:\my-project" `
  --json --quiet
```

---

## 它如何工作

```
用户原话
   │
   ├─ 1. 扫描项目（scan.mjs）
   │     ├─ 跳过 node_modules / dist / build / 缓存 / 二进制
   │     ├─ 读 package.json、锁文件、框架配置、README
   │     ├─ 提取符号、导入、路由、测试、Git 变更
   │     └─ 建立文件级导入/被导入图
   │
   ├─ 2. 理解需求（score.mjs）
   │     ├─ 中英文分词、中文 bigram、同义词扩展
   │     ├─ 意图识别：功能 / bug / 重构 / 测试 / 文档 / 配置 / UI / API / DB / 性能 / 安全
   │     ├─ 路径、文件名、符号、内容、导入、Git 变更加权
   │     └─ 沿导入图扩展邻居，区分 primary / likely / reference / test / config
   │
   └─ 3. 渲染任务书（render.mjs）
         ├─ 项目框架 + 可用命令
         ├─ 规范化需求 + 范围 + 不在范围
         ├─ 文件:行 定位表 + 关键代码片段
         ├─ 约束 + 步骤 + 验收标准 + 验证命令
         └─ 待确认 + 给执行 AI 的提示
```

索引缓存只在进程内存中保留 **30 秒**，不写项目目录；`--refresh` 可强制重扫。

---

## 作为 Skill 安装

DSH 的 skill 名必须是 kebab-case，所以内部名是 `xian-optimizer`；「Xian优化器」是显示名。在 `/` 菜单中会看到 `xian-optimizer`，也可以直接输入 `/xian-optimizer`。

### 方式 A：项目级（推荐，随仓库走）

把本目录放到项目的：

```text
<项目根>/.dsh/skills/xian-optimizer/
  SKILL.md
  ...
```

DSH 会自动发现，无需重启（文件监听会刷新 catalog）。

### 方式 B：用户级（所有项目可用）

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-skill.ps1
```

默认复制到 `$env:DSH_HOME\skills\xian-optimizer`。加 `-Link` 可创建目录联接，源目录更新后立即生效：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-skill.ps1 -Link
```

### 验证

在 DSH 输入 `/`，应看到 `xian-optimizer`；或直接问：

> 用 Xian优化器 帮我定位「给登录页加记住我」需要改哪些文件

---

## CLI 用法

```text
node scripts/xian.mjs optimize --prompt "<需求>" [选项]
node scripts/xian.mjs index [选项]
node scripts/xian.mjs doctor [--root <目录>]
```

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `--root <目录>` | 从 cwd 向上找 `.git`，否则 cwd | 项目根 |
| `--prompt <文本>` | — | 需求；传 `-` 从 stdin 读取 |
| `--max-files <3-15>` | 8 | 最多定位多少个文件 |
| `--max-chars <4000-40000>` | 16000 | 提示词长度上限 |
| `--out <文件>` | — | 写入文件；`--json` 时写 JSON |
| `--json` | 关 | 输出结构化 JSON |
| `--refresh` | 关 | 绕过 30 秒索引缓存 |
| `--quiet` | 关 | 不输出 stderr 摘要 |

`optimize --json` 的关键字段：

```jsonc
{
  "ok": true,
  "confidence": "高",
  "intent": "feature",
  "prompt": "# 任务：…",
  "files": [
    {
      "path": "src/pages/LoginPage.tsx",
      "line": 7,
      "symbol": "LoginPage",
      "role": "primary",
      "roleLabel": "首选修改点",
      "reasons": ["符号 LoginPage", "内容命中：登录、login"],
      "score": 74.5
    }
  ],
  "project": { "name": "my-app", "commands": [], "frameworks": [] },
  "warnings": []
}
```

---

## 安装输入框按钮（可选）

按钮位于输入框右侧、模型选择器之前：**角色头像 + Xian优化**。点击后读取当前草稿和会话 `cwd`，通过 `POST /api/xian/optimize-stream` 流式获取进度，在右下角浮窗里显示角色、当前阶段、文件数和「理解深度」，完成后打开预览窗；你可以先核对代码路径，再选择「复制提示词」或「替换输入框」。

> 默认不直接替换输入框：优化结果通常有数千字，直接写入会让输入框突然变高、影响阅读。预览窗把长文本放进独立滚动区域，确认后再替换。

### 进度浮窗

扫描/优化期间，右下角会出现角色浮窗（挂件）：

- **角色**：侧视 `assets/side.webp` 扫描阶段，正视 `assets/front.webp` 深度理解阶段；带轻微浮动动画。
- **阶段**：连接宿主 → 扫描项目目录 → 解析符号/导入/路由 → 构建导入图 → 识别技术栈/入口/命令 → 匹配代码位置 → 提取证据 → 生成提示词。
- **进度**：顶部百分比 + 渐变进度条；扫描时显示 `已发现 N 个文件 · M 个目录`。
- **理解深度**：独立的青色/紫色深度条，按文件覆盖、符号覆盖、导入图、框架、入口、命令、测试、置信度综合计算（0–100%）。
- **完成**：浮窗消失，自动打开结果预览；预览标题旁保留 `理解深度 N%`。
- **降级**：宿主不支持流式路由时自动回退到普通 `/api/xian/optimize`，浮窗显示「普通模式」。

浮窗是只读的，不会阻挡输入框或按钮；预览/关闭等操作仍在结果弹窗里完成。

### 安装

1. 关闭 DSH（避免运行中的进程覆盖配置）。
2. 在技能目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-ui.ps1
```

脚本会：

- 把本包复制到 `$env:DSH_PROFILE_DIR\node_modules\@xian\optimizer`；
- 在 profile `package.json` 的 `dependencies` 中登记 `file:` 依赖；
- 在 `cordis.patch.yml` 追加 insert 行：

```yaml
- insert:
    - id: xian-optimizer
      name: "@xian/optimizer"
```

> 新插件必须放在 `insert` 列表里。直接写 `- id: xian-optimizer` 会被 Cordis 当成“覆盖一个已存在的条目”，启动时提示 `entry "xian-optimizer" not found`，按钮不会加载。

3. 重新启动 DSH。
4. 打开任意项目会话，输入一句话，点击 **✦ Xian优化**。

> 只有宿主插件加载后，客户端 bundle 才会进入 `__DSH_BOOT__`；所以「复制文件」和「patch 条目」必须同时存在。

### 验证

在已登录的 DSH 页面 DevTools Console 执行（会带上浏览器 cookie）：

```js
await (await fetch('/api/xian/health')).json()
// { ok: true, name: "@xian/optimizer", version: "1.0.0", ... }
```

未登录的 `curl http://127.0.0.1:65108/api/xian/health` 返回 `401`，也说明 `/api` 路由在工作；它不会返回健康 JSON。

### 卸载

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-ui.ps1 -Uninstall
```

然后重启 DSH。

### 常驻角色挂件

安装后，输入框右下方会出现角色挂件（默认展开，可收起）：

- **收起态**：圆形头像 + 理解程度百分比环；点击展开。
- **展开态**：
  - 项目名、文件/目录/体积、语言、框架、入口
  - 文件数、符号数、测试数、导入数
  - 符号覆盖率、导入覆盖率
  - **理解深度**：初步了解 / 结构理解 / 深入理解
  - **优化深度**四档：快速 / 标准 / 深度 / 极致
  - 「重新理解」按钮：重新扫描当前项目
- **主动加载**：打开会话后自动请求 `POST /api/xian/insight`，不需要先点优化按钮。
- **扫描中**：挂件切换为侧视角色，显示阶段、文件数、进度条和实时理解深度；完成后切回正视角色并刷新指标。
- 状态保存在 `localStorage`：`xian-widget-open`、`xian-depth`。

| 优化深度 | 定位位置 | 提示词上限 | 全文兜底 |
| --- | ---: | ---: | --- |
| 快速 | 4 | 6,000 | 关闭 |
| 标准 | 8 | 16,000 | 低置信度时 |
| 深度 | 12 | 20,000 | 强制 |
| 极致 | 15 | 26,000 | 强制 |

### 按钮行为

| 状态 | 表现 |
| --- | --- |
| 空闲 | `✦ Xian优化` |
| 扫描中 | `扫描中…`，按钮禁用；右下角角色浮窗显示阶段、文件数、进度与理解深度 |
| 成功 | `已生成`，浮窗关闭并打开预览：可滚动查看、复制，或点「替换输入框」写回 |
| 替换后 | 预览关闭，输入框变为完整任务书；可继续编辑或发送 |
| 失败 | `重试`，悬停显示错误原因 |
| 空输入 | 提示「先在输入框写一句需求」 |
| 已是优化词 | 提示「当前内容已经是优化后的提示词」 |
| 宿主未装 | 提示 404 / 无法连接，CLI 仍可用 |

---

## 输出示例

输入：

> 给登录页面加一个记住我复选框，并调整登录按钮样式

输出（节选）：

```markdown
# 任务：给登录页面加一个记住我复选框，并调整登录按钮样式

> Xian优化器生成 · 置信度：高 · 项目：xian-fixture · 8 个文件 / 4.1 KB

## 0. 执行摘要
- **需求类型**：功能开发 / 增量实现（兼：界面 / 交互调整）
- **定位置信度**：高；首选 `src/pages/LoginPage.tsx:7`
- **技术栈**：TypeScript 83% · CSS 17%

## 3. 代码定位（按优先级）
| # | 位置 | 角色 | 依据 | 建议动作 |
| --- | --- | --- | --- | --- |
| 1 | `src/pages/LoginPage.tsx:7` | 首选修改点 | 文件名包含关键词；符号 LoginPage；内容命中：登录、login、button | 优先阅读并修改 |
| 2 | `src/components/LoginButton.tsx:6` | 可能修改点 | 符号 LoginButton；内容命中：登录、button | 确认是否承载该逻辑 |
| 3 | `src/styles/login.css:1` | 可能修改点 | 文件名精确命中；样式文件 | 确认是否承载该逻辑 |

## 6. 验收标准
- [ ] 核心路径可用，用户能完成需求描述中的操作。
- [ ] 空态、加载态、错误态至少各有一个明确表现，不出现白屏或静默失败。
- [ ] 新增逻辑有对应的测试或可复现的手动验证步骤。
- [ ] 如果改动涉及视觉，附一张修改前/后的截图或明确说明无法截图。

## 7. 验证命令
```bash
npm run test
npm run typecheck
git diff --stat
```
```

---

## 文件结构

```text
xian-optimizer/
├─ SKILL.md                     # Skill 指令（DSH 加载）
├─ README.md
├─ package.json                 # 同时是 DSH 插件包
├─ assets/
│  ├─ face.webp                 # 输入框按钮头像
│  ├─ side.webp                 # 扫描阶段角色（侧视）
│  └─ front.webp                # 深度理解/完成阶段角色（正视）
├─ lib/
│  ├─ core.mjs                  # 缓存、snippet、公开 API
│  ├─ scan.mjs                  # 项目扫描 / 符号 / 导入图
│  ├─ score.mjs                 # 需求理解 / 同义词 / 排序
│  ├─ render.mjs                # 提示词模板
│  ├─ host.js                   # DSH 宿主路由
│  └─ client.js                 # 输入框按钮（浏览器 bundle）
├─ scripts/
│  ├─ xian.mjs                  # CLI
│  ├─ install-skill.ps1         # 安装到用户级 skills
│  ├─ install-ui.ps1            # 安装/卸载 UI 插件
│  └─ build-client.mjs          # 校验 client bundle（开发用）
├─ references/
│  └─ prompt-contract.md        # 提示词契约
└─ test/
   ├─ run-tests.mjs             # 无依赖测试
   └─ fixture/                  # React 示例项目
```

---

## 设计原则

- **离线优先**：不调用 LLM、不联网、不上传代码。
- **确定性**：同样输入产生稳定输出，便于比较和回归。
- **证据优先**：每个定位都带路径、行号、符号或内容命中依据。
- **角色分离**：primary（要改）/ likely（待确认）/ reference（参考）/ test（测试）/ config（配置）。
- **诚实**：低置信度、索引截断、无匹配都会写入 `warnings`。
- **最小侵入**：不写项目文件、不改配置、不执行项目代码。

---

## 安全与隐私

- 扫描器只读取项目内文本文件，跳过依赖、构建产物、缓存、二进制和符号链接。
- 不执行项目代码，不安装依赖，不写项目目录。
- 生成的提示词会包含候选文件的少量代码片段；其中可能含密钥、token、个人数据。使用前请检查并删除。
- UI 路由由 DSH 的 owner 认证保护，仅本机已认证的浏览器/API 可调用。
- `cwd` 必须是绝对路径且存在；不会接受相对路径或越界路径。

---

## 开发与测试

无外部依赖，Node 20+。

```bash
# 全量测试（扫描、排序、CLI、宿主路由、客户端 bundle）
node test/run-tests.mjs

# 只跑 fixture
node scripts/xian.mjs doctor --root test/fixture
node scripts/xian.mjs optimize --prompt "给登录页加记住我" --root test/fixture
```

测试覆盖：

- fixture 扫描：文件数、语言、React、命令。
- 中文 UI 需求：primary 命中 `LoginPage.tsx`，包含 `LoginButton.tsx` 与 `login.css`。
- 英文 UI 需求：同样命中登录相关文件。
- 无匹配 bug：0 个文件、低置信度、有 warning。
- 配置/文档需求：命中 `package.json` / `README.md`。
- `findProjectRoot` 识别 `.git`。
- 宿主路由：health、成功、空 prompt、错误 content-type、非法 cwd。
- 客户端 bundle：模块 id、`inject`、slot 注册。

---

## 已知限制

- **不调用 LLM**：不会真正「理解」复杂业务语义；它靠路径、符号、内容、导入图和同义词做确定性定位。极模糊的需求仍需要用户补一个锚点。
- **中文分词是 bigram**：没有词典级分词；同义词表覆盖常见研发词，生僻业务词可能漏匹配。
- **索引有上限**：默认 6000 个文件、单文件 512 KB；超大 monorepo 可能截断（会写 warning）。
- **行号是索引快照**：文件被编辑后行号会漂移；执行前必须重新读文件。
- **UI 按钮需要重启 DSH**：客户端 bundle 在启动时组合进 `__DSH_BOOT__`，热装不会立即生效。
- **不替代代码审查**：它是定位与提示词工具，不是正确性保证。

---

## 故障排查

| 现象 | 原因 / 处理 |
| --- | --- |
| `/` 菜单没有 `xian-optimizer` | 确认 `SKILL.md` 在 `.dsh/skills/xian-optimizer/` 或 `$DSH_HOME/skills/xian-optimizer/`；frontmatter 的 `name` 必须是 kebab-case |
| `项目路径不存在` | `--root` 写错；Windows 路径用引号 |
| 结果为空 | 需求太短；补模块名/页面名/函数名，或先用 `grep` 找锚点 |
| 按钮 404 | 宿主插件未加载：检查 `cordis.patch.yml`、profile `node_modules`，然后重启 |
| 按钮显示但点击报错 | 打开 DevTools Console 看 `/api/xian/optimize` 响应；检查会话是否绑定了工作区 |
| 端口不是 65108 | 用当前 DSH Web GUI 的实际地址访问 `/api/xian/health` |
| 扫描很慢 | 缩小 `--root`；确认没有把多仓库父目录当根；检查 network drive |

---

## License

MIT。可自由修改、分发；保留出处即可。
