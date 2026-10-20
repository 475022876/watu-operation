# 发布登记（Release Register）— VFIB Marketing OS（运营中台）

本文件是**应用版本发布**的唯一登记处。任何一次对外可交付的版本变化都必须在此登记一行，并写明
系统版本、契约版本、数据 schema 版本、Git 提交、测试证据与回滚版本。

> 三条版本轴线务必分清（详见 `CHANGELOG.md` 开头）：
> 1. **应用版本**（`package.json` / `lib/mos/config.js` 的 `MOS_VERSION`）—— 本文件登记。
> 2. **接口契约版本**（当前 **1.0**）—— 由 `docs/integration_three_pack_v1.1/C_Shared_Contract/`
>    冻结，应用版本升级**不**自动改动契约版本。
> 3. **资料库（Workspace）应用版本**（Provider 侧，当前 **1.1.7**）—— 非本仓库管理，仅登记兼容目标。

---

## 1. 当前登记（0.1.6）

> 本表是**应用版本 0.1.6** 的登记；0.1.5 及更早见 §2 历史版本。

| 字段 | 值 |
| --- | --- |
| 系统名称 | VFIB Marketing OS（运营中台） |
| 应用版本（本版） | **0.1.6** |
| 上一版本 / 回滚目标 | **0.1.5**（标签 `v0.1.5`，发布提交 `1993991`） |
| 基线 Git 提交 | `v0.1.5` 发布后 `main`（应用版本 0.1.5，schema v8） |
| **发布 Git 提交** | 见 §1.4（提交后回填） |
| 发布标签 | **`v0.1.6`**（annotated，指向发布提交） |
| 分支 | `main`（远端 `475022876/watu-operation`） |
| 接口契约版本 | **1.0**（未变；未改共享契约、未改资料库源码） |
| 数据 schema 版本 | **v8（未变）**；本版**未新增集合**，无迁移 |
| 资料库（Workspace）兼容目标 | **1.1.7**（本侧未变）｜⚠ 实际 Provider 源码为 **1.1.9** → 见 §1.5 |
| 本版主题 | **零付费试用路径**：把智谱 / 百炼 / 硅基流动三家免费档做成一级接入方式（文本 + 图像），免费档信息作为元数据下发页面 |
| 是否新增业务中心 | **否**（8 大工作中心与全部模块 id 不变） |
| 交付形态 | **Staging / 本地隔离实例**；**未部署生产**（须另行批准） |
| 发布日期 | 2026-10-20 |

### 1.1 测试证据

| 套件 | 结果 | 证据路径 |
| --- | --- | --- |
| 全量回归 `bash tools/run-mos-tests.sh all`（**17 套件**） | **880/880 通过** | `TEST_EVIDENCE_MOS_BUILD01/summary.json` → `ran` |
| └ `provideradmin`（**本版 +10 条 `PF-01…10`，纯离线**） | **70/70 通过** | `TEST_EVIDENCE_MOS_V014_PROVIDER/provider-admin-result.json` |
| └ `ui`（真实浏览器 CDP，含 `SET-01…12`） | 135/135 | `TEST_EVIDENCE_MOS_BUILD01/ui-check-result.json` |
| └ `unit` | 76/76 | `TEST_EVIDENCE_MOS_BUILD01/unit-result.json` |
| └ `provider` | 26/26 | `TEST_EVIDENCE_MOS_BUILD01/provider-contract-result.json` |
| └ `smoke` / `sec` / `sched` | 15/15 · 17/17 · 20/20 | `TEST_EVIDENCE_MOS_BUILD01/` |
| └ `workspace` / `dual` / `e2e` / `e2e02` / `e2e03` | 36/36 · 51/51 · 48/48 · 63/63 · 96/96 | 同上 |
| └ `research` / `editorial` / `studio` / `research013` / `i18n` | 55/55 · 43/43 · 29/29 · 79/79 · 21/21 | `TEST_EVIDENCE_MOS_V0*/` |
| 双系统 `joint` / `build06`（显式运行，**不纳入 `all`**） | 54/66 · 43/61 | 见 §1.5，属 Provider 侧阻塞；证据目录全量口径 = 977/1007 |

> **口径说明**：`all` = 本次运行口径（`summary.json` 的 `ran` 字段）；
> 顶层 `total` 会额外扫描 `joint` / `build06` 的历史证据，二者当前被 Provider 1.1.9 阻塞。
> 引用数字必须写明口径。

### 1.2 本版是否含应用代码变更

**是（小范围新增，零业务改动）。**

- `lib/mos/provideradmin.js`：文本新增 `zhipu` / `dashscope` / `siliconflow` 三个模式（含默认端点、
  默认模型、`freeTier` 元数据、说明与文档链接）；图像新增 `zhipu`（CogView）；
  `publicView()` 下发 `freeTier`（`effective()` 刻意**不**返回）。
- `lib/mos/adapters/text.js`：`IMPLEMENTED_MODES` 扩至 6 个；`defaultBaseUrl` / `defaultModel` 补三家。
- `lib/mos/adapters/image.js`：`zhipu` 与 `openai` 共用同一分支；端点/模型按模式回退。
- `public/mos/js/modules/settings.js`：下拉项标注「有免费额度」；模式说明追加免费档；
  切换接入方式**就地**更新占位符与提示（不整页重渲染）。
- `tools/mos-provider-admin-test.js`：新增 `partFree()`（`PF-01…10`，零出站）。
- **零删除**；**未改**：8 大业务中心、模块 id、共享契约、资料库源码、schema。
- 新增文档：`docs/FREE_TIER_TESTING.md`。

### 1.3 发布前置条件（本版逐条状态）

| 条件 | 状态 |
| --- | --- |
| 全量回归通过 | ✅ **`all` 17 套件 880/880**（升版后复跑） |
| 新增断言通过 | ✅ `PF-01…PF-10` 全通过（`provideradmin` 70/70） |
| 三家免费端点拼接正确 | ✅ 断言覆盖 `/chat/completions`、`Bearer`、尾斜杠归一化（`PF-04…08`） |
| 免费档不污染调用路径 | ✅ `PF-10`：`effective().freeTier === undefined` |
| 不伪造"已验证可用" | ✅ 全部断言零出站；真实调用仍由用户在页面点出，就绪度只认账本 |
| 密钥不以明文出现 | ✅ 沿用 0.1.4 链路，本版未触碰 |
| 版本一致（五处 + 测试元数据） | ✅ `VER-01/VER-02` 断言 = 0.1.6 |
| 变更日志 | ✅ `CHANGELOG.md` `[0.1.6]` |
| 生产网络默认关闭、未自动出站 | ✅ 未部署生产 |
| **发布审批（人工签署）** | ⬜ **未完成** |
| **生产部署授权** | ⬜ **未完成** —— 本轮**不部署生产** |

### 1.4 提交回填

| 项 | 值 |
| --- | --- |
| **发布提交** | 提交后回填（**先提交、后回填**，不得预填） |
| 发布标签 | `v0.1.6`（annotated） |
| 源码包 | `bash tools/package-mos-source.sh` 可随时重生成（`*.zip` / `dist/` 已 gitignore） |

### 1.5 已知阻塞：Provider（企业资料库）版本为 1.1.9

| 项 | 事实 |
| --- | --- |
| 本侧契约基线 | 资料库 **1.1.7**（`docs/INTEGRATION_WORKSPACE_CONTRACT.md`，状态 `NOT_VERIFIED`） |
| 实际 Provider 源码 | `D:/企业数据后台/oa-system-20261004/oa-system`，`package.json` = **1.1.9**（新增"岗位职责三层映射 G/C/E"） |
| 现象 | `joint` 54/66、`build06` 43/61；集中在 Provider 侧「审批人登记」「资料夹具批准」「`admission.final.decision` 票据」返回 **403** |
| 是否本版回归 | **否**。已在 V0.1.3 基线 `1ed4d28` 用独立 worktree 复跑，失败断言集合**逐条一致** |
| 处置 | 待资料库侧确认 1.1.9 授权模型影响；**确认前不改共享契约、不改资料库源码、不把二者记为通过** |

---

## 2. 历史版本

| 应用版本 | 日期 | 基线提交 | 契约版本 | schema | 摘要 |
| --- | --- | --- | --- | --- | --- |
| **0.1.5** | 2026-10-20 | `15e7e9d`（发布提交 `1993991`，标签 `v0.1.5`） | 1.0 | v8（无迁移） | 视频可达性修复：Sora 2 API 已停服 → 新增火山方舟 `volcengine` 模式（创建体改写 + 从 `content.video_url` 下载 + 未完成拒绝下载）；顺带修 `effective()` 漏返回路径模板、`normalize()` 丢 `rawStatus`。`all` 870/870；`provideradmin` 60 |
| **0.1.4** | 2026-10-20 | `1ed4d28`（发布提交 `15e7e9d`，标签 `v0.1.4`） | 1.0 | v8（+`provider_calls`/`video_render_jobs`） | 真实供应商接入与运行治理：配置单一权威、AES-256-GCM 密钥、真实 LLM 五类产出、图像与视频异步接入、分级/预算/重试/账本六件事、系统接入页。`all` 17 套件 865/865；`provideradmin` 55 |
| **0.1.3** | 2026-10-14 | `7001475`（发布提交 `b5412cc`，标签 `v0.1.3`） | 1.0 | v7（无迁移） | V0.1.3 五阶段：一站式任务空间、真实 AI 研究与证据链、key-based 中英双语与不可翻译保护、品牌减法、Provider 就绪度。`all` 16 套件 797/797 |
| **0.1.2** | 2026-10-14 | `7001475`（发布提交） | 1.0 | v5→**v7** | V0.1.2 四阶段：任务驱动 UX + 中英双语、AI 情报研究与候选选题、编辑域派工与制作空间。⚠ 其 `joint` 证据经复核为**陈旧脚本产物**，实际口径以本版修正后的 `joint 66/66` 为准（见 §1 勘误） |
| **0.1.1** | 2026-10-13 | `259a91d` | 1.0 | v5 | V1.2 整改：真实 HTTP 安全负例 + 正式输出门禁（`formalguard`） |
| 0.1.0 | 2026-10-11 → 2026-10-12 | — | 1.0 | v5 | BUILD-01/02/03 + V0.1 综合整改（Phase 0—4）+ V1.1 三包整改（B0—B8） |

---

## 3. 回滚指引

1. 回滚**应用版本**：检出标签 `v0.1.5`（或 `1993991`）；保留 `data/` 与 `config.json`。
   ⚠ 回滚到 0.1.5 会失去 `zhipu` / `dashscope` / `siliconflow` 三个接入方式与 CogView 图像模式；
   若库里已按这些模式保存，旧版会读到未知模式 → 就绪度变 `NOT_IMPLEMENTED`（**不会崩**，但接入会失效）。
2. **数据无需回滚**：0.1.6 与 0.1.5 同为 schema v8，**零迁移**。
   唯一影响：回滚后供应商配置页不存在，**已加密的密钥仍留在库里但无人能通过界面读取**（密文与主密钥均保留，
   回滚再回来即可继续用）。详见 `MIGRATION_AND_ROLLBACK.md` §4.4。
3. 回滚后需重新执行 `bash tools/run-mos-tests.sh all` 确认回归通过（0.1.5 基线为 870/870）。
4. **契约不变**：回滚不影响 `/api/integrations/marketing/*`（该前缀由资料库侧提供，本仓库不改）。

---

## 4. 登记纪律

- 每次应用版本变更，必须同时更新：`package.json`、`lib/config.js`（`appVersion`）、
  `lib/mos/config.js`（`MOS_VERSION`）、UI 版本显示、`CHANGELOG.md`、**本文件**。
- **不得**在没有真实证据的情况下登记"已发布"；未部署生产时一律标注 `Staging / 未部署生产`。
- **不得**代签任何人工审批栏。
