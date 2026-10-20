# 发布登记（Release Register）— VFIB Marketing OS（运营中台）

本文件是**应用版本发布**的唯一登记处。任何一次对外可交付的版本变化都必须在此登记一行，并写明
系统版本、契约版本、数据 schema 版本、Git 提交、测试证据与回滚版本。

> 三条版本轴线务必分清（详见 `CHANGELOG.md` 开头）：
> 1. **应用版本**（`package.json` / `lib/mos/config.js` 的 `MOS_VERSION`）—— 本文件登记。
> 2. **接口契约版本**（当前 **1.0**）—— 由 `docs/integration_three_pack_v1.1/C_Shared_Contract/`
>    冻结，应用版本升级**不**自动改动契约版本。
> 3. **资料库（Workspace）应用版本**（Provider 侧，当前 **1.1.7**）—— 非本仓库管理，仅登记兼容目标。

---

## 1. 当前登记（0.1.4）

> 本表是**应用版本 0.1.4** 的登记；0.1.3 及更早见 §2 历史版本。

| 字段 | 值 |
| --- | --- |
| 系统名称 | VFIB Marketing OS（运营中台） |
| 应用版本（本版） | **0.1.4** |
| 上一版本 / 回滚目标 | **0.1.3**（标签 `v0.1.3`，提交 `b5412cc`） |
| 基线 Git 提交 | `1ed4d28`（`main`，应用版本 0.1.3，schema v7） |
| **发布 Git 提交** | 见 §1.4（提交后回填） |
| 发布标签 | **`v0.1.4`**（annotated，指向发布提交） |
| 分支 | `main`（远端 `475022876/watu-operation`） |
| 接口契约版本 | **1.0**（未变；未改共享契约、未改资料库源码） |
| 数据 schema 版本 | **v8**（v7 → v8：**仅新增** `provider_calls`、`video_render_jobs`，既有集合零改写、迁移幂等；见 `docs/MIGRATION_AND_ROLLBACK.md` §2.1） |
| 资料库（Workspace）兼容目标 | **1.1.7**（本侧未变）｜⚠ 实际 Provider 源码已升至 **1.1.9** → 见 §1.5 阻塞项 |
| 本版主题 | **真实接入与运行治理**：供应商配置中心 / 真实 LLM 五类产出 / 真实图像与视频 / 密钥·权限·超时重试·费用·外发·日志六件事 |
| 是否新增业务中心 | **否**（8 大工作中心与全部模块 id 不变；新增"系统接入"为 `aux` 导航组，仅管理员可见） |
| 交付形态 | **Staging / 本地隔离实例**；**未部署生产**（须另行批准） |
| 发布日期 | 2026-10-20 |

### 1.1 测试证据

| 套件 | 结果 | 证据路径 |
| --- | --- | --- |
| 全量回归 `bash tools/run-mos-tests.sh all`（**17 套件**） | **865/865 通过** | `TEST_EVIDENCE_MOS_BUILD01/summary.json` → `ran` |
| └ `provideradmin`（**本版新增**） | **55/55 通过** | `TEST_EVIDENCE_MOS_V014_PROVIDER/provider-admin-result.json` |
| └ `ui`（真实浏览器 CDP；新增 `SET-01…SET-12`） | **135/135 通过** | `TEST_EVIDENCE_MOS_BUILD01/ui-check-result.json` + `UI_EVIDENCE_MOS_BUILD07/SET-*.png` |
| └ `unit`（`U-19*` 升至 v8 + 新增 `U-19a`） | **76/76 通过** | `TEST_EVIDENCE_MOS_BUILD01/unit-result.json` |
| └ `provider`（契约与就绪度语义） | **26/26 通过** | `TEST_EVIDENCE_MOS_BUILD01/provider-contract-result.json` |
| └ `smoke` / `sec` / `sched` | 15/15 · 17/17 · 20/20 | `TEST_EVIDENCE_MOS_BUILD01/` |
| └ `workspace` / `dual` / `e2e` / `e2e02` / `e2e03` | 36/36 · 51/51 · 48/48 · 63/63 · 96/96 | 同上（`e2e02/03` 在 BUILD02/03 目录） |
| └ `research` / `editorial` / `studio` / `research013` / `i18n` | 55/55 · 43/43 · 29/29 · 79/79 · 21/21 | `TEST_EVIDENCE_MOS_V0*/` |
| **简化口径**：`summary.json` 的 `ran` 字段 | **865/865** | 推荐引用这一档 |
| 证据目录全量（含 `joint` / `build06` 历史证据） | **962/992**（30 条失败） | 见 §1.5，属 Provider 侧阻塞，非本版回归 |
| 双系统正向联调 `joint`（显式运行） | **54/66**（12 条失败） | `TEST_EVIDENCE_MOS_BUILD04/dual-e2e-result.json` |
| 双系统安全负例 `build06`（显式运行） | **43/61**（18 条失败） | `TEST_EVIDENCE_MOS_BUILD06/dual-security-result.json` |
| 系统接入页浏览器证据 | `UI_EVIDENCE_MOS_BUILD07/SET-60…62`（4 张：四卡概览 / P2 无入口 / P2 直链被拒） | — |

> **口径说明（勿混用）**：
> - **`all` = 17 套件 865/865** —— 这是"本次运行"口径，`summary.json` 的 `ran` 字段与之对应；
> - **`summary.json` 全量 = 962/992** —— 因为它还会扫描 `joint` / `build06` 证据目录，而二者**不在 `all` 内**，
>   且当前被 Provider 侧变更阻塞（§1.5）；
> - 引用任何数字时**必须写明是哪一档**。

### 1.2 本版是否含应用代码变更

**是（大规模新增，零业务改动）。**

- **新增后端**：`lib/mos/provideradmin.js`、`secrets.js`、`egress.js`、`providerlog.js`、`adapters/video.js`、`routes/settings.js`。
- **重写**：`adapters/text.js`（五类任务 + 五步闸门）、`adapters/image.js`（闸门 + 尺寸映射 + 两种返回）。
- **改**：`adapters/websearch.js`（配置改由 provideradmin 权威、provideradmin 惰性 require）、
  `providercontract.js`（`providerConfig` 单一来源 + `withRetry`）、`research-fetch.js`（校验路径不再加载数据库）、
  `store.js`（schema v8）、`routes/{video,helpers,index}.js`、`dict.js`（`settings.manage`）。
- **新增前端**：`public/mos/js/modules/settings.js` + `app.js` 导航组「系统接入」+ i18n 78 键。
- **零删除**；**未改**：8 大业务中心结构、模块 id、共享契约、资料库源码。

### 1.3 发布前置条件（本版逐条状态）

| 条件 | 状态 |
| --- | --- |
| 全量回归通过 | ✅ **`all` 17 套件 865/865**（升版后复跑） |
| 新增套件通过 | ✅ `provideradmin` 55/55；`ui` 新增 `SET-01…12` 全通过（135/135） |
| 密钥不以明文出现（接口 / DOM / 库文件） | ✅ `SET-04/05/06/07` + `provideradmin` C 段共同证明（库文件仅存 `iv/tag/ct/kf`） |
| 权限在服务端兜底 | ✅ `SET-09/10/11`（P2 无入口、直链拿不到数据、接口 403） |
| 费用诚实性（只认回执） | ✅ 账本 `cost.amount` 仅在回执时非空；`unknownCount` 单列；无单价推算 |
| 失败项逐一解决或说明阻断 | ✅ 本版新增失败 0 条；`joint`/`build06` 30 条已定位为 Provider 1.1.9 行为变更（§1.5） |
| 变更日志 | ✅ `CHANGELOG.md` `[0.1.4]` 段（A—I 九节） |
| 版本一致（五处 + 测试元数据） | ✅ `VER-01/VER-02` 断言 = 0.1.4 |
| 迁移与回滚文档 | ✅ `docs/MIGRATION_AND_ROLLBACK.md`（v7 → v8 纯追加） |
| 接入手册 | ✅ `docs/PROVIDER_INTEGRATION_GUIDE.md`（配置/密钥/五类任务/错误码/限额） |
| 生产网络默认关闭、未自动出站 | ✅ 未部署生产；调度默认关闭（`D4-46` / Phase3 断言） |
| **发布审批（人工签署）** | ⬜ **未完成**（须由获得授权的正式身份签署） |
| **生产部署授权** | ⬜ **未完成** —— 本轮**不部署生产** |

### 1.4 提交回填

| 项 | 值 |
| --- | --- |
| **发布提交** | 见本表下方"回填"说明（提交后写入） |
| 发布标签 | `v0.1.4`（annotated） |
| 源码包 | `bash tools/package-mos-source.sh` 可随时重生成（`*.zip` / `dist/` 已 gitignore） |

> 回填说明：提交后把 `git rev-parse HEAD` 与标签校验值写入本表；**不得**在提交实际发生前预填。

### 1.5 已知阻塞：Provider（企业资料库）版本已升到 1.1.9

| 项 | 事实 |
| --- | --- |
| 本侧契约基线 | 资料库 **1.1.7**（`docs/INTEGRATION_WORKSPACE_CONTRACT.md`，逐字节实现，状态 `NOT_VERIFIED`） |
| 实际 Provider 源码 | `D:/企业数据后台/oa-system-20261004/oa-system`，`package.json` = **1.1.9**，HEAD `afe7a16`（新增"岗位职责三层映射 G/C/E"） |
| 现象 | `joint` 54/66（`D4-04/04b/31…40` 失败）、`build06` 43/61（`D6-04/06/08/22…51` 失败）；集中在 Provider 侧「审批人登记」「资料夹具批准」「`admission.final.decision` 票据签发」返回 **403** |
| 是否本版回归 | **否**。已用 `git worktree` 在基线提交 `1ed4d28`（未含本版任何改动）复跑，失败断言集合**逐条一致** |
| 处置 | 待资料库侧确认 1.1.9 的授权模型（G/C/E 三层映射）对集成接口的影响；**在确认前不修改共享契约、不改资料库源码、不把 `joint`/`build06` 记为通过** |

---

## 2. 历史版本

| 应用版本 | 日期 | 基线提交 | 契约版本 | schema | 摘要 |
| --- | --- | --- | --- | --- | --- |
| **0.1.3** | 2026-10-14 | `7001475`（发布提交 `b5412cc`，标签 `v0.1.3`） | 1.0 | v7（无迁移） | V0.1.3 五阶段：一站式任务空间、真实 AI 研究与证据链、key-based 中英双语与不可翻译保护、品牌减法、Provider 就绪度。`all` 16 套件 797/797 |
| **0.1.2** | 2026-10-14 | `7001475`（发布提交） | 1.0 | v5→**v7** | V0.1.2 四阶段：任务驱动 UX + 中英双语、AI 情报研究与候选选题、编辑域派工与制作空间。⚠ 其 `joint` 证据经复核为**陈旧脚本产物**，实际口径以本版修正后的 `joint 66/66` 为准（见 §1 勘误） |
| **0.1.1** | 2026-10-13 | `259a91d` | 1.0 | v5 | V1.2 整改：真实 HTTP 安全负例 + 正式输出门禁（`formalguard`） |
| 0.1.0 | 2026-10-11 → 2026-10-12 | — | 1.0 | v5 | BUILD-01/02/03 + V0.1 综合整改（Phase 0—4）+ V1.1 三包整改（B0—B8） |

---

## 3. 回滚指引

1. 回滚**应用版本**：检出标签 `v0.1.3`（或 `b5412cc`）；保留 `data/` 与 `config.json`。
2. **数据无需回滚**：v8 相对 v7 只新增两个集合，0.1.3 代码读到 `provider_calls` / `video_render_jobs` 会忽略。
   唯一影响：回滚后供应商配置页不存在，**已加密的密钥仍留在库里但无人能通过界面读取**（密文与主密钥均保留，
   回滚再回来即可继续用）。详见 `MIGRATION_AND_ROLLBACK.md` §4.4。
3. 回滚后需重新执行 `bash tools/run-mos-tests.sh all` 确认回归通过（0.1.3 基线为 797/797）。
4. **契约不变**：回滚不影响 `/api/integrations/marketing/*`（该前缀由资料库侧提供，本仓库不改）。

---

## 4. 登记纪律

- 每次应用版本变更，必须同时更新：`package.json`、`lib/config.js`（`appVersion`）、
  `lib/mos/config.js`（`MOS_VERSION`）、UI 版本显示、`CHANGELOG.md`、**本文件**。
- **不得**在没有真实证据的情况下登记"已发布"；未部署生产时一律标注 `Staging / 未部署生产`。
- **不得**代签任何人工审批栏。
