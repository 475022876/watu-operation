# 发布登记（Release Register）— VFIB Marketing OS（运营中台）

本文件是**应用版本发布**的唯一登记处。任何一次对外可交付的版本变化都必须在此登记一行，并写明
系统版本、契约版本、数据 schema 版本、Git 提交、测试证据与回滚版本。

> 三条版本轴线务必分清（详见 `CHANGELOG.md` 开头）：
> 1. **应用版本**（`package.json` / `lib/mos/config.js` 的 `MOS_VERSION`）—— 本文件登记。
> 2. **接口契约版本**（当前 **1.0**）—— 由 `docs/integration_three_pack_v1.1/C_Shared_Contract/`
>    冻结，应用版本升级**不**自动改动契约版本。
> 3. **资料库（Workspace）应用版本**（Provider 侧，当前 **1.1.7**）—— 非本仓库管理，仅登记兼容目标。

---

## 1. 当前登记

| 字段 | 值 |
| --- | --- |
| 系统名称 | VFIB Marketing OS（运营中台） |
| 应用版本（本版） | **0.1.3** |
| 上一版本 / 回滚目标 | **0.1.2** |
| 基线 Git 提交 | `7001475`（`main`，应用版本 0.1.2，schema v7） |
| 阶段提交链 | `6df37ba`(Phase 0) → `31d292a`(Phase A) → `b9edea8`(Phase B) → `ab2af8b`(Phase C) → 本发布提交 |
| **发布 Git 提交** | **见 §1.4「提交回填」**（提交后回填全量 SHA；提交信息 `release(v0.1.3): …`） |
| 发布标签 | **`v0.1.3`**（annotated，指向发布提交） |
| 交付源码包 | 由发布提交源码树生成，命令 `bash tools/package-mos-source.sh`；包内 `PACKAGE_MANIFEST.txt` 记录 `git: <发布提交>`。`*.zip` 与 `dist/` 已 gitignore，可随时重生成（见 §1.4） |
| 分支 | `main`（远端 `475022876/watu-operation`） |
| 接口契约版本 | **1.0**（未变） |
| 数据 schema 版本 | **v7**（**本版零新集合、零迁移**：仅在既有集合上新增可选字段，如 `research_jobs.blockedEvent`、`users[].prefs`。见 `MIGRATION_AND_ROLLBACK.md`） |
| 资料库（Workspace）兼容目标 | 1.1.7（适配层未变，仍 NOT_VERIFIED——`LIBRARY_HANDOFF_BUNDLE` 未交付） |
| 执行包 | `VFIB_Marketing_OS_V0.1.3_AI_Research_UX_Remediation_Codex`（执行包 7 文件 + `SHA256_MANIFEST.txt` 全部核验一致） |
| 交付形态 | **Staging / 本地隔离实例**；**未部署生产**（须另行批准） |
| 发布日期 | 2026-10-14 |

> ⚠ **0.1.2 登记行的证据勘误（诚实性回填，不篡改历史）**：0.1.2 登记行曾引用
> `TEST_EVIDENCE_MOS_BUILD04/dual-e2e-result.json` 记 `joint 64/64 通过`。经本版复核，
> **该 JSON 是由更早一版测试脚本生成的陈旧证据**（其 `D4-15` 明细为 `codes=71`，而提交入库的脚本
> 明细为 `openapiEnum=`，且其中**不含** `D4-15b`），**不能作为入库脚本的通过证据**。
> 在入库脚本下重跑，实际暴露出 4 条断言问题（详见 §1.3 与 `reports/FINAL_ACCEPTANCE_V0.1.3.md` §5），
> 现已全部修正并复跑为 **`joint 66/66 通过`**。0.1.2 的结论以本版修正后的口径为准。

### 1.1 测试证据

| 套件 | 结果 | 证据路径 |
| --- | --- | --- |
| 全量回归 `bash tools/run-mos-tests.sh all`（**16 套件**） | **797/797 通过** | `TEST_EVIDENCE_MOS_BUILD01/summary.json` |
| └ `ui`（**真实浏览器 CDP**，Chromium 155.0.8059.79） | **123/123 通过**（含 LANG-01a…l 12 条双语保护） | `TEST_EVIDENCE_MOS_BUILD01/ui-check-result.json` + `UI_EVIDENCE/` |
| └ `studio`（本版新增，Phase A） | **29/29 通过** | `TEST_EVIDENCE_MOS_V013_STUDIO/v013-studio-result.json` |
| └ `research013`（本版新增，Phase B） | **79/79 通过** | `TEST_EVIDENCE_MOS_V013_RESEARCH/v013-research-result.json` |
| └ `i18n`（本版新增，Phase C） | **21/21 通过** | `TEST_EVIDENCE_MOS_V013_I18N/i18n-check-result.json` |
| └ `provider`（Phase C 新增 PC-06a…e 就绪度） | **26/26 通过** | `TEST_EVIDENCE_MOS_BUILD01/provider-contract-result.json` |
| 双系统真实 HTTP 正向端到端 `joint`（**显式运行**，需本机资料库源码） | **66/66 通过** | `TEST_EVIDENCE_MOS_BUILD04/dual-e2e-result.json` |
| 双系统真实 HTTP 安全负例 `build06`（**显式运行**） | **61/61 通过** | `TEST_EVIDENCE_MOS_BUILD06/dual-security-result.json` |
| **汇总（`summary.json` 扫描全部证据目录：16 + `joint` + `build06`）** | **924/924 通过（18 套件）** | `TEST_EVIDENCE_MOS_BUILD01/summary.json` |
| 真实浏览器操作证据（三阶段） | `UI_EVIDENCE/PHASE0`（16 图 / 17 步）· `PHASEA`（17 图 / 18 步）· `PHASEC`（24 图 / 23 步，0 控制台错误） | 各目录 `steps.json` |
| AI 接口调用证据（脱敏） | `REAL_PROVIDER_EVIDENCE/`（作业 trace + 契约日志） | 见 `reports/PHASE_B_REAL_RESEARCH.md` §证据 |

> **口径说明（勿混用）**：`all` 自身 = **16 套件 797/797**；`joint` = **66/66**；`build06` = **61/61**；
> `summary.json` 汇总 = **924/924（18 套件）**。引用时必须写明是哪一档口径。

### 1.2 本版是否含应用代码变更

**是（大规模）。** 执行包 V0.1.3 五阶段全部落地（**未新增任何功能中心，8 大业务中心与全部模块 id 不变**）：
- **Phase 0**：源码影响核验与基线（执行包「现状」描述逐条比对，输出差异表）。
- **Phase A**：`content-editor` 升级为**一站式制作工作台**（任务头 + Brief/已审研究/上级备注 + 正文｜图片｜视频｜审核**任务内切页** + 交付物/下一步），不跳出任务；新增 `lib/mos/routes/studio.js` 与 `public/mos/js/modules/studio.js`。
- **Phase B**：**真实 AI 研究**——可配置供应商注册表（不写死供应商）、受限网页读取（复用 SSRF 防护 + 不可信内容边界）、异步研究作业（进度/取消/重试/幂等）、证据链、无证据 FACT 强制降级、MOCK 通道拒绝产出结论。
- **Phase C**：**key-based 中英双语**（`zh-CN.js`/`en-US.js` 各 451 键）+ **不可翻译节点保护**（用户输入/已保存正文/AI 原文/URL/文件名/日志）+ `ApiError` 单点错误码映射 + **品牌减法**（配图对话框只留用途/视觉类型/画面说明 + 实时预览）+ **Provider 就绪度**（MOCK 不计为 REAL；视频 AI = NOT_IMPLEMENTED）。
- **Phase D**：全量回归、迁移/回滚文档、版本统一升 **0.1.3**、发布登记与最终验收报告。
- **无新增权限、无新增集合、无契约变更**（schema 仍 v7，契约仍 1.0）。

### 1.3 发布前置条件（本版逐条状态）

| 条件 | 状态 |
| --- | --- |
| 全量回归通过 | ✅ **`all` 16 套件 797/797**（升版后复跑） |
| 新增套件通过 | ✅ studio 29/29；research013 79/79；i18n 21/21 |
| 真实浏览器 UI 复测通过 | ✅ **ui 123/123**（含 LANG-01a…l 12 条） |
| 双系统跨系统联调（最新版口径） | ✅ **joint 66/66**；**build06 61/61** |
| 失败项逐一解决或说明阻断 | ✅ 4 项已定位并修正（3 项测试断言陈旧/端点错误 + 1 项夹具缺陷），**无隐瞒、无跳过** |
| 变更日志（`CHANGELOG.md`）已更新 | ✅ 新增 `[0.1.3]` 段（五阶段逐条） |
| 系统版本一致（`package.json` + `lib/config.js` + `lib/mos/config.js` + 页面显示 + `/api/mos/meta` + 测试元数据） | ✅ 由 `VER-01/VER-02` 强制断言五处一致且 = 0.1.3 |
| 迁移与回滚文档 | ✅ `docs/MIGRATION_AND_ROLLBACK.md`（**结论：0.1.3 无需数据迁移**；schema v7 只增不改） |
| 阶段报告 + 最终验收 + OPEN_ITEMS | ✅ `reports/PHASE0_BASELINE/PHASE_A_UX/PHASE_B_REAL_RESEARCH/PHASE_C_CONTENT_I18N.md`、`reports/FINAL_ACCEPTANCE_V0.1.3.md`、`OPEN_ITEMS.md` |
| 生产网络默认关闭、仅受控 Staging 验证 | ✅ 未部署生产、未启用自动出站轮询（`D4-46` 断言） |
| **发布审批（人工签署）** | ⬜ **未完成**（须由获得授权的正式身份签署） |
| **生产部署授权** | ⬜ **未完成** —— 本轮**不部署生产** |

### 1.4 提交回填（发布后填写）

| 项 | 值 |
| --- | --- |
| 发布提交全量 SHA | ⬜ 提交后回填 |
| 发布标签 | `v0.1.3` |
| 交付源码包名 / SHA256 / 条目数 | ⬜ 打包后回填（`bash tools/package-mos-source.sh`） |

---

## 2. 历史版本

| 应用版本 | 日期 | 基线提交 | 契约版本 | schema | 摘要 |
| --- | --- | --- | --- | --- | --- |
| **0.1.2** | 2026-10-14 | `7001475`（发布提交） | 1.0 | v5→**v7** | V0.1.2 四阶段：任务驱动 UX + 中英双语、AI 情报研究与候选选题、编辑域派工与制作空间。⚠ 其 `joint` 证据经复核为**陈旧脚本产物**，实际口径以本版修正后的 `joint 66/66` 为准（见 §1 勘误） |
| **0.1.1** | 2026-10-13 | `259a91d` | 1.0 | v5 | V1.2 整改：真实 HTTP 安全负例 + 正式输出门禁（`formalguard`） |
| 0.1.0 | 2026-10-11 → 2026-10-12 | — | 1.0 | v5 | BUILD-01/02/03 + V0.1 综合整改（Phase 0—4）+ V1.1 三包整改（B0—B8） |

---

## 3. 回滚指引

1. 回滚**应用版本**：检出标签 `v0.1.1`（或 `2fe3841`）；保留 `data/` 与 `config.json`。
2. **数据无需回滚**：schema v7 只增不改，0.1.1 代码可安全读取 v7 数据（研究域集合被旧代码忽略）。详见 `MIGRATION_AND_ROLLBACK.md`。
3. 回滚后需重新执行 `bash tools/run-mos-tests.sh all` 确认回归通过（0.1.1 基线为 546/546）。
4. **契约不变**：回滚不影响 `/api/integrations/marketing/*`（该前缀由资料库侧提供，本仓库不改）。

---

## 4. 登记纪律

- 每次应用版本变更，必须同时更新：`package.json`、`lib/config.js`（`appVersion`）、
  `lib/mos/config.js`（`MOS_VERSION`）、UI 版本显示、`CHANGELOG.md`、**本文件**。
- **不得**在没有真实证据的情况下登记"已发布"；未部署生产时一律标注 `Staging / 未部署生产`。
- **不得**代签任何人工审批栏。
