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
| 应用版本（本版） | **0.1.2** |
| 上一版本 / 回滚目标 | **0.1.1** |
| 基线 Git 提交 | `2fe3841`（`main`，应用版本 0.1.1） |
| 阶段提交链 | `ee6383d`(Phase 0) → `9fca396`(Phase A) → `3a372e3`(Phase B) → `035e959`(Phase C) → 本发布提交 |
| **发布 Git 提交** | **本文件随发布提交入库；确切 SHA256 由紧随其后的文档提交回填至此（Git 历史可查）** |
| 发布标签 | **`v0.1.2`**（annotated，指向发布提交） |
| 交付源码包 | `VFIB_MARKETING_OS_V0.1.2_SOURCE.zip`（由发布提交源码树生成；`*.zip` 与 `dist/` 已 gitignore，可由 `tools/package-mos-source.sh` 重生成；SHA256 见仓库根 `dist/SHA256SUMS.txt`） |
| 分支 | `main`（远端 `475022876/watu-operation`） |
| 接口契约版本 | **1.0**（未变） |
| 数据 schema 版本 | **v7**（v5→v6：`users[].prefs`；v6→v7：新增研究域 5 集合；只增不改、幂等，见 `MIGRATION_AND_ROLLBACK.md`） |
| 资料库（Workspace）兼容目标 | 1.1.7（适配层未变，仍 NOT_VERIFIED——`LIBRARY_HANDOFF_BUNDLE` 未交付） |
| 执行包 | `VFIB_Marketing_OS_V0.1.2_AI_Intelligence_Task_Driven_UX_Codex_Pack`（8 文件 SHA256 全部核验一致） |
| 交付形态 | **Staging / 本地隔离实例**；**未部署生产**（须另行批准） |
| 发布日期 | 2026-10-14 |

### 1.1 测试证据

| 套件 | 结果 | 证据路径 |
| --- | --- | --- |
| 全量回归 `bash tools/run-mos-tests.sh all`（**13 套件**） | **773/773 通过** | `TEST_EVIDENCE_MOS_BUILD01/summary.json` |
| └ 含 `ui`（真实浏览器 CDP） | **110/110 通过**（28 截图） | `UI_SCREENSHOTS/`（与 `UI_EVIDENCE_MOS_BUILD01/` 同源） |
| └ **`research`（本版新增，Phase B）** | **55/55 通过** | `TEST_EVIDENCE_MOS_V012_RESEARCH/` |
| └ **`editorial`（本版新增，Phase C）** | **43/43 通过** | `TEST_EVIDENCE_MOS_V012_EDITORIAL/` |
| 双系统真实 HTTP 安全负例 `build06` | **61/61 通过** | `TEST_EVIDENCE_MOS_BUILD06/dual-security-result.json` |
| 双系统真实 HTTP 正向端到端 `joint` | **64/64 通过** | `TEST_EVIDENCE_MOS_BUILD04/dual-e2e-result.json` |

> 运行日志详见 `E2E_RUN_LOG.md`；安全负例明细见 `SECURITY_REGRESSION_REPORT.md`。

### 1.2 本版是否含应用代码变更

**是（大规模）。** 执行包 V0.1.2 四阶段全部落地：
- Phase A：五主+两辅导航（模块 id 不变）、中英双语（服务端偏好持久化）、员工任务工作台（继续锚点/本周待发布）；schema v6。
- Phase B：AI 情报研究（TRUSTED_DAILY 真实汇编 / WEB_RESEARCH 无凭据 BLOCKED / 证据链 / 提案状态机 / P1 一屏审核）；schema v7。
- Phase C：批准入池 / 批准并安排幂等 Saga（idempotencyKey 全局防重）/ 日周月同源视图 / 任务工作空间四标签。
- 新增权限 `research.create`、`editorial.approve`；新增端点组 `/api/mos/research/*`、`/api/mos/topic-proposals*`、`/api/mos/editorial/*`。

### 1.3 发布前置条件（本版逐条状态）

| 条件 | 状态 |
| --- | --- |
| 全量回归通过 | ✅ 773/773（13 套件，升版后复跑） |
| 新增套件通过 | ✅ research 55/55；editorial 43/43 |
| 真实浏览器 UI 复测通过 | ✅ 110/110 |
| 变更日志（`CHANGELOG.md`）已更新 | ✅ |
| 系统版本显示已同步（UI + `lib/config.js` + `lib/mos/config.js` + `package.json`） | ✅ |
| 迁移与回滚文档 | ✅ `MIGRATION_AND_ROLLBACK.md`（schema v7 向后兼容 0.1.1） |
| 诚实性矩阵 / SPECIAL-01 映射 / 安全回归报告 / E2E 日志 | ✅ 四份交付文档齐备 |
| **发布审批（人工签署）** | ⬜ **未完成**（须由获得授权的正式身份签署） |
| **生产部署授权** | ⬜ **未完成** —— 本轮**不部署生产** |

---

## 2. 历史版本

| 应用版本 | 日期 | 基线提交 | 契约版本 | schema | 摘要 |
| --- | --- | --- | --- | --- | --- |
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
