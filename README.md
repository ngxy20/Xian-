# Xian优化器（`xian-optimizer`）

> 先理解项目，再定位代码，最后把一句话需求改写成 AI 能直接执行的任务书。

Xian优化器是一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Skill，同时附带一个可选的 DSH Web 输入框按钮与常驻角色挂件。它把「给登录页加个记住我」这类简短需求，转换成带精确代码路径、约束、步骤、验收标准和验证命令的提示词。

- 仓库：<https://github.com/ngxy20/Xian-.git>
- Skill 名：`xian-optimizer`（DSH 要求 kebab-case；中文名「Xian优化器」用于显示）
- 许可证：MIT

## 功能

1. **项目扫描**：语言、框架、包管理、入口、命令、目录分层、符号、导入图、路由、测试、Git 变更。
2. **代码定位**：把需求映射到 `文件:行` 与符号，并区分 `primary` / `likely` / `reference` / `test` / `config`。
3. **提示词规范化**：目标、范围、代码位置、关键代码证据、约束、实施步骤、验收标准、验证命令、待确认项。
4. **常驻角色挂件**：自动显示项目理解程度、文件/符号/导入/测试覆盖率、框架与入口；可展开并切换快速/标准/深度/极致四档优化深度。
5. **扫描/优化进度**：执行时挂件切换为侧视角色，流式显示阶段、文件数、进度和实时理解深度。
6. **结果预览**：默认不直接替换输入框；先预览，再选择复制或替换，避免长文本撑坏会话布局。
7. **离线、只读**：不调用 LLM、不联网、不执行项目代码、不写项目目录。

## 快速开始

### 作为项目级 Skill

把本仓库的 `.dsh/skills/xian-optimizer/` 放到目标项目的：

```text
<project-root>/.dsh/skills/xian-optimizer/
```

DSH 会自动发现。之后在对话中输入 `/xian-optimizer`，或直接说：

> 用 Xian优化器 帮我定位「给登录页加记住我」需要改哪些文件

### 作为全局 Skill

```powershell
powershell -ExecutionPolicy Bypass -File .\.dsh\skills\xian-optimizer\scripts\install-skill.ps1
```

默认复制到 `$env:DSH_HOME\skills\xian-optimizer`。加 `-Link` 可创建目录联接，源目录更新后即时生效。

### CLI

```powershell
node .\.dsh\skills\xian-optimizer\scripts\xian.mjs optimize `
  --prompt '给登录页面加一个记住我复选框，并调整登录按钮样式' `
  --root '<project-root>' `
  --json --quiet
```

常用命令：

```powershell
# 项目体检
node .\.dsh\skills\xian-optimizer\scripts\xian.mjs doctor --root .

# 输出结构化 JSON
node .\.dsh\skills\xian-optimizer\scripts\xian.mjs optimize --prompt '修复上传 413' --root . --json --quiet

# 运行测试
node .\.dsh\skills\xian-optimizer\test\run-tests.mjs
```

## 输入框按钮（可选）

按钮位于输入框右侧、模型选择器之前，使用角色头像。点击后：

1. 读取当前草稿和会话 `cwd`。
2. 调用 `POST /api/xian/optimize-stream`，以 NDJSON 流式接收扫描/优化进度。
3. 右下角常驻角色挂件会主动展示项目理解程度、文件/符号/导入/测试覆盖率、框架与入口。
4. 扫描/优化时挂件切换为侧视角色，实时展示阶段、文件数、进度和理解深度。
5. 完成后打开预览窗；可复制提示词，或确认后替换输入框。

挂件展开后可以调节**优化深度**（下次优化生效）：

| 深度 | 定位位置 | 提示词上限 | 全文兜底 |
| --- | ---: | ---: | --- |
| 快速 | 4 | 6,000 | 关闭 |
| 标准 | 8 | 16,000 | 低置信度时 |
| 深度 | 12 | 20,000 | 强制 |
| 极致 | 15 | 26,000 | 强制 |

挂件状态保存在 `localStorage`：`xian-widget-open`、`xian-depth`。

安装：

```powershell
powershell -ExecutionPolicy Bypass -File .\.dsh\skills\xian-optimizer\scripts\install-ui.ps1
```

然后完全退出并重启 DSH。卸载：

```powershell
powershell -ExecutionPolicy Bypass -File .\.dsh\skills\xian-optimizer\scripts\install-ui.ps1 -Uninstall
```

> 客户端 bundle 在 DSH 启动时组合进 `__DSH_BOOT__`，所以安装/更新后必须重启 DSH；当前页面不会热更新。

## 基准结果

详细报告：[benchmark/REPORT.md](benchmark/REPORT.md)

复现命令：

```powershell
# 只跑 fixture（CI 默认）
node benchmark/run.mjs

# 加入一个本地真实项目（路径不会写入报告）
$env:XIAN_REAL_ROOT = '<local-project>'
node benchmark/run.mjs
```

测试集：14 个用于调参的用例 + 8 个最后冻结的 held-out 用例；覆盖一个小型 React fixture 与一个真实 Python QQ 机器人项目。对比基线为「路径 + 内容词频」的 grep 检索。

| 组 | 用例 | Xian Top-1 | Grep Top-1 | Xian Top-3 | Grep Top-3 | Xian MRR | Grep MRR | 提示词完整度 | 上下文缩减 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 调参集 | 14 | 100% | 71.4% | 100% | 78.6% | 1.00 | 0.80 | 8/8 | 45.5% |
| held-out | 8 | **75%** | **25%** | 75% | 75% | 0.78 | 0.52 | 8/8 | 49.7% |
| 全部 | 22 | 90.9% | 54.5% | 90.9% | 77.3% | 0.92 | 0.70 | 8/8 | 47% |

要点：

- **held-out Top-1：25% → 75%（+50 pp）**；全部用例 Top-1：54.5% → 90.9%（+36.4 pp）。
- held-out Top-3 与 grep 持平（75% vs 75%）；Top-1 和 MRR（0.52 → 0.78）提升明显。
- held-out Recall@5 为 **89.6% vs 87.5%**，略高于 baseline；不同用例仍有漏检。
- 提示词完整度：raw/grep 没有结构（0/8），Xian 为 **8/8**。
- 真实项目上提示词约 4.8 KB，项目全文约 690 KB，上下文缩减 **99.3%**。
- 平均耗时约 110 ms（fixture）/ 230 ms（真实项目），包含扫描；grep 基线更快，但只给文件列表。

> 这是定位与提示词准备基准，不是代码生成后的测试通过率；样本量小，标注有主观性，不应外推为通用准确率。

## 目录结构

```text
.
├─ .dsh/skills/xian-optimizer/
│  ├─ SKILL.md                  # Skill 指令
│  ├─ README.md                 # 插件/CLI 详细说明
│  ├─ package.json              # DSH 插件包
│  ├─ assets/                   # face / side / front 角色 WebP
│  ├─ lib/
│  │  ├─ core.mjs               # 公开 API、缓存、进度、理解深度
│  │  ├─ scan.mjs               # 项目扫描 / 符号 / 导入图
│  │  ├─ score.mjs              # 需求理解 / 同义词 / 排序
│  │  ├─ render.mjs             # 提示词模板
│  │  ├─ host.js                # DSH 宿主路由
│  │  └─ client.js              # 按钮 / 角色浮窗 / 预览 / 流式解析
│  ├─ scripts/                  # CLI、安装脚本、bundle 校验
│  ├─ references/               # 提示词/进度契约
│  └─ test/                     # 19 项无依赖测试 + fixture
├─ benchmark/
│  ├─ cases.mjs                 # 调参集 + held-out 用例
│  ├─ run.mjs                   # 基准执行器
│  ├─ results.json              # 原始结果
│  └─ REPORT.md                 # 可读报告
├─ README.md
└─ LICENSE
```

## 设计原则

- **证据优先**：每个定位都带路径、行号、符号或内容命中依据。
- **角色分离**：primary 要改、likely 待确认、reference 参考、test 补测试、config 改配置。
- **诚实**：低置信度、无匹配、索引截断、held-out 失败都写进 `warnings` 或报告。
- **最小侵入**：不写项目文件、不改配置、不执行项目代码；索引缓存只在内存保留 30 秒。
- **可降级**：流式路由不可用时回退普通接口；角色图加载失败时回退 ✦。

## 已知限制

- 中文分词是 bigram + 同义词表，没有 LLM 语义理解；极模糊需求仍需补一个模块名/页面名/函数名。
- 默认索引上限 6000 文件、单文件 512 KB；超大 monorepo 可能截断。
- 行号是扫描快照，执行前必须重新读文件确认。
- 基准中的 held-out 仍有失败：`voice_config.json` 排第 6、`create_qa_xlsx.py` 未进 Top 8，说明领域词表仍不完整。
- UI 按钮需要重启 DSH；不同 DSH 版本的 slot/样式可能有差异。

## 测试

```powershell
node .\.dsh\skills\xian-optimizer\test\run-tests.mjs
node .\.dsh\skills\xian-optimizer\scripts\build-client.mjs
```

测试覆盖：扫描、符号行号、中英文需求、同义词、凭据脱敏、无匹配、配置/文档定位、输出截断、Git 识别、宿主普通/流式/资源路由、客户端注册、流式解析、角色浮窗、预览/复制/替换。

## License

MIT，见 [LICENSE](LICENSE)。
