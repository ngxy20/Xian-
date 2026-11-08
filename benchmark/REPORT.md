# Xian优化器 · 定位效果基准

> 生成时间：2026-11-08T17:45:06.734Z；Node v20.18.0；样本 22 个任务。

## 这组测试回答什么

它衡量的是**代码定位与提示词准备**，不是最终代码正确率。每个任务都有一个人工标注的 `primary` 文件（开发者必须先打开的文件）和若干 `related` 文件（测试、样式、数据等有效支撑文件）。

对照：

- **raw**：只有一句需求，没有代码上下文。
- **grep baseline**：用需求关键词在路径 + 文件内容里做词频排序，取 Top 8。这是一个不弱的传统检索基线。
- **Xian**：项目扫描 + 符号/导入图 + 意图/同义词 + 角色分层，取 Top 8。

## 汇总

| 组 | 用例 | Xian Top-1 | Grep Top-1 | Xian Top-3 | Grep Top-3 | Xian Recall@5 | Grep Recall@5 | Xian MRR | Grep MRR | Xian 完整度 | 上下文缩减 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| fixture | 8 | 100% | 87.5% | 100% | 87.5% | 92.7% | 100% | 1.00 | 0.91 | 8.0/8 | 5.2% |
| real-world | 6 | 100% | 50% | 100% | 66.7% | 77.8% | 77.8% | 1.00 | 0.66 | 8.0/8 | 99.3% |
| 调参集 | 14 | 100% | 71.4% | 100% | 78.6% | 86.3% | 90.5% | 1.00 | 0.80 | 8.0/8 | 45.5% |
| held-out | 8 | 75% | 25% | 75% | 75% | 89.6% | 87.5% | 0.78 | 0.53 | 8.0/8 | 49.7% |
| 全部 | 22 | 90.9% | 54.5% | 90.9% | 77.3% | 87.5% | 89.4% | 0.92 | 0.70 | 8.0/8 | 47% |

`调参集` 是开发排序规则时使用过的 14 个用例；`held-out` 是最后冻结、没有参与调参的 8 个用例，用来检查规则是否过拟合。

## 关键提升（调参集，Xian − Grep）

- Top-1 命中率：71.4% → 100%（**+28.6 pp**）
- 首选文件进入 Top-3：78.6% → 100%（**+21.4 pp**）
- Recall@5：90.5% → 86.3%（**-4.2 pp**）
- Precision@5：46.1% → 43.2%（**-2.9 pp**）
- MRR：0.80 → 1.00（**+0.20**）
- 提示词完整度：0/8（raw/grep 无结构）→ **8.0/8**
- 上下文体积：整个项目平均 8502 字符 → Xian 提示词平均 4631 字符（**缩减 45.5%**）
- 平均耗时：Xian 154 ms / Grep 17 ms（包含扫描/读取；首次运行，非缓存）

## 关键提升（held-out，Xian − Grep）

- Top-1：25% → 75%（**+50.0 pp**）
- Top-3：75% → 75%（**+0.0 pp**）
- Recall@5：87.5% → 89.6%（**+2.1 pp**）
- MRR：0.53 → 0.78（**+0.25**）

## 逐用例

| 用例 | primary | Xian 首选 | Xian 排名 | Grep 排名 | Xian 完整度 | Xian 字符 | Xian 耗时 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| fixture-remember | `src/pages/LoginPage.tsx` | `src/pages/LoginPage.tsx` | 1 | 1 | 8/8 | 4970 | 131 ms |
| fixture-validation | `src/utils/validate.ts` | `src/utils/validate.ts` | 1 | 4 | 8/8 | 5104 | 29 ms |
| fixture-api-error | `src/api/auth.ts` | `src/api/auth.ts` | 1 | 1 | 8/8 | 4887 | 16 ms |
| fixture-loading | `src/components/LoginButton.tsx` | `src/components/LoginButton.tsx` | 1 | 1 | 8/8 | 4924 | 12 ms |
| fixture-test | `src/pages/__tests__/LoginPage.test.tsx` | `src/pages/__tests__/LoginPage.test.tsx` | 1 | 1 | 8/8 | 4828 | 12 ms |
| fixture-style | `src/styles/login.css` | `src/styles/login.css` | 1 | 1 | 8/8 | 4910 | 10 ms |
| fixture-config | `package.json` | `package.json` | 1 | 1 | 8/8 | 2576 | 15 ms |
| fixture-docs | `README.md` | `README.md` | 1 | 1 | 8/8 | 4071 | 14 ms |
| real-emotion | `core/emotion_model.py` | `core/emotion_model.py` | 1 | 1 | 8/8 | 4844 | 381 ms |
| real-checkin | `qq_bot_relay.py` | `qq_bot_relay.py` | 1 | 1 | 8/8 | 4841 | 360 ms |
| real-dataset | `training/build_dataset.py` | `training/build_dataset.py` | 1 | 5 | 8/8 | 4761 | 285 ms |
| real-auto-learn | `auto_learn.py` | `auto_learn.py` | 1 | 2 | 8/8 | 4553 | 269 ms |
| real-repeat | `qq_bot_relay.py` | `qq_bot_relay.py` | 1 | 1 | 8/8 | 4690 | 291 ms |
| real-persona | `assets/persona.base.json` | `assets/persona.base.json` | 1 | 4 | 8/8 | 4868 | 328 ms |
| heldout-fixture-forgot | `src/pages/LoginPage.tsx` | `src/pages/LoginPage.tsx` | 1 | 2 | 8/8 | 4654 | 14 ms |
| heldout-fixture-enter | `src/pages/LoginPage.tsx` | `src/pages/LoginPage.tsx` | 1 | 2 | 8/8 | 4908 | 19 ms |
| heldout-fixture-rule | `src/utils/validate.ts` | `src/utils/validate.ts` | 1 | 1 | 8/8 | 4878 | 12 ms |
| heldout-fixture-timeout | `src/api/auth.ts` | `src/api/auth.ts` | 1 | 1 | 8/8 | 4804 | 15 ms |
| heldout-real-voice | `assets/voice_config.json` | `qq_bot_relay.py` | 5 | 4 | 8/8 | 4525 | 322 ms |
| heldout-real-export | `training/create_qa_xlsx.py` | `core/memory.py` | 未命中 | 7 | 8/8 | 4708 | 268 ms |
| heldout-real-help | `qq_bot_relay.py` | `qq_bot_relay.py` | 1 | 2 | 8/8 | 4620 | 274 ms |
| heldout-real-log | `auto_learn.py` | `auto_learn.py` | 1 | 3 | 8/8 | 4548 | 276 ms |

## 解读

在调参集 14 个任务上，Xian 相对 grep 的 Top-1 为 **提升 28.6 个百分点**，Top-3 为 **提升 21.4 个百分点**，Recall@5 为 **下降 4.2 个百分点**。

在没有参与调参的 held-out 8 个任务上，Top-1 为 **75% vs 25%**（+50%），Top-3 为 **75% vs 75%**（+0%），Recall@5 为 **89.6% vs 87.5%**（+2.1%）。

更重要的不是“多命中一个文件”，而是同时给出：`文件:行`、角色（primary/likely/reference/test/config）、依据、关键代码片段、约束、步骤、验收标准和验证命令。raw/grep 只给文件列表，完整度为 0/8。

## 局限性

- 标注是人工的，`related` 有一定主观性；`primary` 相对客观。
- 样本量小（fixture + 一个真实 Python 机器人项目），不代表所有语言/框架。
- 衡量的是“定位与提示词准备”，不是代码生成后的测试通过率。
- grep 基线使用同样的关键词与同义词，但不使用符号/导入图；它是一个有竞争力的传统对照，不是稻草人。
- 真实项目路径不写入报告；只保留相对文件路径。

## 结论

在“把一句模糊需求变成可执行的代码定位 + 任务书”这件事上，Xian 相对普通 grep 有可量化的提升；对上下文体积的压缩尤其明显。它不替代开发者读代码和验证，但能显著减少“从哪开始、改哪些文件、怎么验收”的前置成本。

