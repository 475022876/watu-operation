# 发布登记（Release Register）— VFIB Marketing OS（运营中台）

本文件是**应用版本发布**的唯一登记处。任何一次对外可交付的版本变化都必须在此登记一行，并写明
系统版本、契约版本、数据 schema 版本、Git 提交、测试证据与回滚版本。

> 三条版本轴线务必分清（详见 `CHANGELOG.md` 开头）：
> 1. **应用版本**（`package.json` / `lib/mos/config.js` 的 `MOS_VERSION`）—— 本文件登记。
> 2. **接口契约版本**（当前 **1.0**）—— 由 `docs/integration_three_pack_v1.1/C_Shared_Contract/`
>    冻结，应用版本升级**不**自动改动契约版本。
> 3. **资料库（Workspace）应用版本**（Provider 侧，当前 **1.1.7**）—— 非本仓库管理，仅登记兼容目标。

---

## 1. 当前登记（0.1.5）

> 本表是**应用版本 0.1.5** 的登记；0.1.4 及更早见 §2 历史版本。

| 字段 | 值 |
| --- | --- |
| 系统名称 | VFIB Marketing OS（运营中台） |
| 应用版本（本版） | **0.1.5** |
| 上一版本 / 回滚目标 | **0.1.4**（标签 `v0.1.4`，发布提交 `15e7e9d`） |
| 基线 Git 提交 | `15e7e9d`（`v0.1.4`，应用版本 0.1.4，schema v8） |
| **发布 Git 提交** | `1993991`（`feat(v0.1.5): 打通火山方舟视频模式…`） |
| 发布标签 | **`v0.1.5`**（annotated，指向发布提交） |
| 分支 | `main`（远端 `475022876/watu-operation`） |
| 接口契约版本 | **1.0**（未变；未改共享契约、未改资料库源码） |
| 数据 schema 版本 | **v8（未变）**；本版**未新增集合**，无迁移 |
| 资料库（Workspace）兼容目标 | **1.1.7**（本侧未变）｜⚠ 实际 Provider 源码为 **1.1.9** → 见 §1.5 阻塞项 |
| 本版主题 | **视频供应商可达性修复**：Sora 2 API 已停服 → 新增火山方舟 `volcengine` 模式；顺带修 `generic` 路径失效与 `rawStatus` 丢失 |
| 是否新增业务中心 | **否**（8 大工作中心与全部模块 id 不变） |
| 交付形态 | **Staging / 本地隔离实例**；**未部署生产**（须另行批准） |
| 发布日期 | 2026-10-20 |

### 1.1 测试证据

| 套件 | 结果 | 证据路径 |
| --- | --- | --- |
| 全量回归 `bash tools/run-mos-tests.sh all`（**17 套件**） | **870/870 通过** | `TEST_EVIDENCE_MOS_BUILD01/summary.json` → `ran` |
| └ `provideradmin`（**本版 +5 条**） | **60/60 通过** | `TEST_EVIDENCE_MOS_V014_PROVIDER/provider-admin-result.json` |
| └ `ui`（真实浏览器 CDP，含 `SET-01…12`） | 135/135 | `TEST_EVIDENCE_MOS_BUILD01/ui-check-result.json` |
| └ `unit` | 76/76 | `TEST_EVIDENCE_MOS_BUILD01/unit-result.json` |
| └ `provider` | 26/26 | `TEST_EVIDENCE_MOS_BUILD01/provider-contract-result.json` |
| └ `smoke` / `sec` / `sched` | 15/15 · 17/17 · 20/20 | `TEST_EVIDENCE_MOS_BUILD01/` |
| └ `workspace` / `dual` / `e2e` / `e2e02` / `e2e03` | 36/36 · 51/51 · 48/48 · 63/63 · 96/96 | 同上 |
| └ `research` / `editorial` / `studio` / `research013` / `i18n` | 55/55 · 43/43 · 29/29 · 79/79 · 21/21 | `TEST_EVIDENCE_MOS_V0*/` |
| 双系统 `joint` / `build06`（显式运行，**不纳入 `all`**） | 54/66 · 43/61 | 见 §1.5，属 Provider 侧阻塞 |

> **口径说明**：`all` = 本次运行口径（`summary.json` 的 `ran` 字段）；
> 顶层 `total` 会额外扫描 `joint` / `build06` 的历史证据，二者当前被 Provider 1.1.9 阻塞。
> 引用数字必须写明口径。

### 1.2 本版是否含应用代码变更

**是（小范围，零业务改动）。**

- **新增能力**：`lib/mos/adapters/video.js` 增加 `volcengine` 模式
  （创建体改写为 `content` 数组、`size→ratio` 翻译、从 `content.video_url` 下载、未完成拒绝下载）。
- **修缺陷**：`provideradmin.effective()` 补齐 `createPath/statusPath/contentPath`（`generic` 模式此前路径配置不生效）；
  `video.normalize()` 补 `extra.rawStatus`（失败分支状态码此前恒空）。
- **注册**：`provideradmin.KINDS.video.modes` 新增 `volcengine`（默认端点 `ark.cn-beijing.volces.com/api/v3`）。
- **测试**：`provideradmin` +5 条（`PB-17a…17e`）。
- **文档**：新增 `docs/PROVIDER_SELECTION.md`；`PROVIDER_INTEGRATION_GUIDE.md` §5.4 重写。
- **零删除**；**未改**：8 大业务中心、模块 id、共享契约、资料库源码、schema。

### 1.3 发布前置条件（本版逐条状态）

| 条件 | 状态 |
| --- | --- |
| 全量回归通过 | ✅ **`all` 17 套件 870/870**（升版后复跑） |
| 新增断言通过 | ✅ `PB-17a…17e` 全通过 |
| 视频协议形状与真实端点一致 | ✅ 依火山方舟官方文档逐字段对齐（创建 `content[]`、查询 `content.video_url`） |
| 下载不绕过安全校验 | ✅ 仍走 `egress.assertProviderUrl`（`PB-17d` 覆盖） |
| 不伪造产物 | ✅ 未完成时 `NOT_READY` 拒绝下载；未配置时 `NOT_CONFIGURED` |
| 密钥不以明文出现 | ✅ 沿用 0.1.4 的 `secrets` 链路，本版未触碰 |
| 版本一致（五处 + 测试元数据） | ✅ `VER-01/VER-02` 断言 = 0.1.5 |
| 变更日志 | ✅ `CHANGELOG.md` `[0.1.5]` |
| 生产网络默认关闭、未自动出站 | ✅ 未部署生产 |
| **发布审批（人工签署）** | ⬜ **未完成** |
| **生产部署授权** | ⬜ **未完成** —— 本轮**不部署生产** |

### 1.4 提交回填

| 项 | 值 |
| --- | --- |
| **发布提交全量 SHA** | **`19939916831dc11aa24f26884f8e2fe0b13fedd5`** |
| 变更规模 | 22 个文件，+712 / −164（含新增文档 1 个、源码 2 个、测试 1 个） |
| 发布标签 | `v0.1.5`（annotated） |
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
| **0.1.4** | 2026-10-20 | `1ed4d28`（发布提交 `15e7e9d`，标签 `v0.1.4`） | 1.0 | v8（+`provider_calls`/`video_render_jobs`） | 真实供应商接入与运行治理：配置单一权威、AES-256-GCM 密钥、真实 LLM 五类产出、图像与视频异步接入、分级/预算/重试/账本六件事、系统接入页。`all` 17 套件 865/865；`provideradmin` 55 |
| **0.1.3** | 2026-10-14 | `7001475`（发布提交 `b5412cc`，标签 `v0.1.3`） | 1.0 | v7（无迁移） | V0.1.3 五阶段：一站式任务空间、真实 AI 研究与证据链、key-based 中英双语与不可翻译保护、品牌减法、Provider 就绪度。`all` 16 套件 797/797 |
| **0.1.2** | 2026-10-14 | `7001475`（发布提交） | 1.0 | v5→**v7** | V0.1.2 四阶段：任务驱动 UX + 中英双语、AI 情报研究与候选选题、编辑域派工与制作空间。⚠ 其 `joint` 证据经复核为**陈旧脚本产物**，实际口径以本版修正后的 `joint 66/66` 为准（见 §1 勘误） |
| **0.1.1** | 2026-10-13 | `259a91d` | 1.0 | v5 | V1.2 整改：真实 HTTP 安全负例 + 正式输出门禁（`formalguard`） |
| 0.1.0 | 2026-10-11 → 2026-10-12 | — | 1.0 | v5 | BUILD-01/02/03 + V0.1 综合整改（Phase 0—4）+ V1.1 三包整改（B0—B8） |

---

## 3. 回滚指引

1. 回滚**应用版本**：检出标签 `v0.1.4`（或 `15e7e9d`）；保留 `data/` 与 `config.json`。
   ⚠ 回滚到 0.1.4 会失去 `volcengine` 视频模式（视频只剩已停服的 `openai` 模式），
   但**不影响任何已有数据**——本版未改 schema。
2. **数据无需回滚**：0.1.5 与 0.1.4 同为 schema v8，**零迁移**。
   唯一影响：回滚后供应商配置页不存在，**已加密的密钥仍留在库里但无人能通过界面读取**（密文与主密钥均保留，
   回滚再回来即可继续用）。详见 `MIGRATION_AND_ROLLBACK.md` §4.4。
3. 回滚后需重新执行 `bash tools/run-mos-tests.sh all` 确认回归通过（0.1.4 基线为 865/865）。
4. **契约不变**：回滚不影响 `/api/integrations/marketing/*`（该前缀由资料库侧提供，本仓库不改）。

---

## 4. 登记纪律

- 每次应用版本变更，必须同时更新：`package.json`、`lib/config.js`（`appVersion`）、
  `lib/mos/config.js`（`MOS_VERSION`）、UI 版本显示、`CHANGELOG.md`、**本文件**。
- **不得**在没有真实证据的情况下登记"已发布"；未部署生产时一律标注 `Staging / 未部署生产`。
- **不得**代签任何人工审批栏。
