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
| 应用版本（本版） | **0.1.1** |
| 上一版本 / 回滚目标 | **0.1.0** |
| 基线 Git 提交 | `259a91d`（`main`，应用版本 0.1.0） |
| **发布 Git 提交** | **`2fe3841dc2c7a96bf264b42f08704f8e695293cc`**（应用代码与交付物首次成形于此提交） |
| 发布标签 | **`v0.1.1`**（annotated，指向发布提交 `2fe3841`） |
| 交付源码包 | `VFIB_MARKETING_OS_V0.1.1_REMEDIATED_SOURCE.zip`（**由发布提交 `2fe3841` 的源码树生成**；SHA256 `6d0eec406a2928e538398ef97bf602bda9677a19fd6060790d7ed6107f8dca2f`，310 条目 15,968,180 字节；包内 `PACKAGE_MANIFEST.txt` 记录 `git: 2fe3841`。`*.zip` 与 `dist/` 已 gitignore，可由 `tools/package-mos-source.sh` 重生成） |
| 分支 | `main`（远端 `475022876/watu-operation`） |
| 接口契约版本 | **1.0**（未变） |
| OpenAPI SHA256 | `cd3cc198a9c568192dbec76429fb9a6dbc836f5e738377249bc14f73d8e825e3`（三方逐字节一致） |
| 数据 schema 版本 | **v5**（本版**未变**：无新增集合、无迁移） |
| 资料库（Workspace）兼容目标 | 1.1.7（目标 1.1.8；资料库侧 V1.2 包本轮未交付） |
| 整改执行包 | `VFIB_MarketingOS_Remediation_V1.2`（B 包 + C 包） |
| 交付形态 | **Staging / 本地隔离实例**；**未部署生产**（须另行批准） |
| 发布日期 | 2026-10-13 |

### 1.1 测试证据

| 套件 | 结果 | 证据路径 |
| --- | --- | --- |
| 全量回归 `bash tools/run-mos-tests.sh all`（**11 套件**） | **546/546 通过** | `TEST_EVIDENCE_MOS_BUILD01/summary.json` |
| └ 含 `ui`（真实浏览器 CDP） | **106/106 通过** | `UI_EVIDENCE_MOS_BUILD01/` |
| 双系统真实 HTTP 安全负例 `build06` | **61/61 通过**（verdict `PASS_EVIDENCE_COMPLETE`） | `TEST_EVIDENCE_MOS_BUILD06/dual-security-result.json` |
| 双系统真实 HTTP 正向端到端 `joint`（V1.1 建立，本轮回归） | **64/64 通过** | `TEST_EVIDENCE_MOS_BUILD04/dual-e2e-result.json` |
| **聚合口径**（`all` + 保留的双系统证据目录 `joint`/`build06`） | **671/671 通过** | `TEST_EVIDENCE_MOS_BUILD01/summary.json`（`total: 671 / passed: 671 / failed: 0 / mosVersion: "0.1.1"`） |

> **断言语义数口径说明（重要）**：`run-mos-tests.sh` 的汇总器会**扫描全部证据目录**，因此
> 当 `joint` 与 `build06` 的产物与 `all` 自身 11 套件同处仓库时，`summary.json` 的
> `total` 显示为 **671**（`all` 11 套件 546 + `joint` 64 + `build06` 61）。
> 两个数字**都是真实的**，只是口径不同：`546/546` 指 `all` 单次运行的 11 套件合计，
> `671/671` 指仓库当前全部证据的聚合。引用时请写明口径，避免把 671 误当成单次运行结果。

- `build06` 服务端审计证据：6/6 类拒绝在 Provider 隔离实例 `db.json` 的 `integration-call`
  审计行中逐条核对通过（`code` + `status` + `ok=false`，按 `correlationId` 对号）。
- `build06` 全程**未改动资料库源码**：以 `server.js` mtime 双证（`providerSourceUnchanged: true`）。

### 1.2 本版是否含应用代码变更

**是。** 新增 `lib/mos/formalguard.js` 与 `POST /api/mos/formal-output-check`，
并修正 `POST /api/mos/generation-jobs` 对 `TEXT` 类型**从不校验 `outputIntent`** 的真实缺陷
（正式文字作品可绕过 Skill 门禁）。故按 V1.2 要求将应用版本由 `0.1.0` 升至 `0.1.1`。
详见 `CHANGELOG.md`。

### 1.3 发布前置条件（本版逐条状态）

| 条件 | 状态 |
| --- | --- |
| 全量回归通过 | ✅ 546/546（`all` 11 套件；仓库聚合 671/671） |
| 双系统真实 HTTP 安全负例通过 | ✅ 61/61 |
| 真实浏览器 UI 复测通过 | ✅ 106/106 |
| 变更日志（`CHANGELOG.md`）已更新 | ✅ |
| 系统版本显示已同步（UI + `/api/mos/meta`） | ✅ |
| 发布登记（本文件）已更新 | ✅ |
| **发布审批（人工签署）** | ⬜ **未完成** —— 见 `MARKETING_HANDOFF_BUNDLE_V1.2/JOINT_SIGNOFF_V1.2.md` |
| **生产部署授权** | ⬜ **未完成** —— 本轮**不部署生产** |

---

## 2. 历史版本

| 应用版本 | 日期 | 基线提交 | 契约版本 | schema | 摘要 |
| --- | --- | --- | --- | --- | --- |
| **0.1.1** | 2026-10-13 | `259a91d` | 1.0 | v5 | V1.2 整改：真实 HTTP 安全负例 + 正式输出门禁（`formalguard`） |
| 0.1.0 | 2026-10-11 → 2026-10-12 | — | 1.0 | v5 | BUILD-01/02/03 + V0.1 综合整改（Phase 0—4）+ V1.1 三包整改（B0—B8） |

---

## 3. 回滚指引

1. 回滚**应用版本**：`git revert <发布提交>` 或检出 `259a91d`。
2. **数据无需回滚**：本版 schema 仍为 v5，未做迁移，`data/mos.json` 结构前后兼容。
3. 回滚后需重新执行 `bash tools/run-mos-tests.sh all` 确认 **546/546**（`all` 11 套件）。
4. **契约不变**：回滚不影响 `/api/integrations/marketing/*`（该前缀由资料库侧提供，本仓库不改）。

---

## 4. 登记纪律

- 每次应用版本变更，必须同时更新：`package.json`、`lib/config.js`（`appVersion`）、
  `lib/mos/config.js`（`MOS_VERSION`）、UI 版本显示、`CHANGELOG.md`、**本文件**。
- **不得**在没有真实证据的情况下登记"已发布"；未部署生产时一律标注 `Staging / 未部署生产`。
- **不得**代签任何人工审批栏。
