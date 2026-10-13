# TEST_EVIDENCE_INDEX —— 证据索引（含 SHA256 与复现命令）

> 日期：2026-10-13｜本侧：VFIB Marketing OS **0.1.1**
> 所有证据均由命令**可复现**；证据目录本身在 `.gitignore`（`TEST_EVIDENCE_MOS_BUILD*/`、`UI_EVIDENCE_MOS_BUILD*/`），
> 但本包内的**副本**随包交付并记录哈希。

---

## 1. 包内证据（`evidence/`）

| 文件 | 内容 | SHA256 |
| --- | --- | --- |
| `dual-security-result.json` | **BUILD-06 双进程真实 HTTP 安全负例**（61/61，`verdict=PASS_EVIDENCE_COMPLETE`，含 6/6 服务端审计对号、合成身份声明、版本登记） | `1df58372bed26b20a6aac820286e67e293d736d779407ca0d0eb2e9a17637434` |
| `dual-security-summary.txt` | 同上的机器可读摘要 | `cd218b261609dd044743bd9f1b9f25a5229e1fcd12c44b2083140c807f38f09c` |
| `regression-summary.json` | **证据汇总**（671/671；= `all` 546 + `joint` 64 + `build06` 61；含各套件 `total/passed/failed` 与 `mosVersion`；本次 `ranAt = 2026-10-13T16:04:35.723Z`） | `4289705e74878903c15e06a2d1fa10a9328fdc4c08bdfd946a228637208e2905` |
| `joint-v1.1-dual-e2e-result.json` | V1.1 建立的双系统真实 HTTP **正向**端到端（64/64），本轮随全量回归复跑 | `3ae36a75a4609d0455c7dd127b92c14505044bee5bf38540cd04f9d5b8096850` |
| `PROVIDER_API_OPENAPI_BASELINE.yaml` | 冻结契约副本（**四方一致**，见 `CONSUMER_BASELINE.md` §3） | `cd3cc198a9c568192dbec76429fb9a6dbc836f5e738377249bc14f73d8e825e3` |

## 2. 包内 UI 证据（`UI_BROWSER_EVIDENCE/`）

28 张真实浏览器截图（CDP 驱动 Chrome/Edge）+ `README.md` 清单，对应 `ui` 套件 **106/106**。

---

## 3. 仓库内原始证据路径（可重新生成）

| 套件 | 命令 | 原始证据路径 |
| --- | --- | --- |
| 全量回归 | `bash tools/run-mos-tests.sh all` | `TEST_EVIDENCE_MOS_BUILD01/summary.json` |
| └ UI（真实浏览器） | （含在 `all`） | `TEST_EVIDENCE_MOS_BUILD01/ui-check-result.json` + `UI_EVIDENCE_MOS_BUILD01/*.png` |
| 双系统**安全负例** | `bash tools/run-mos-tests.sh build06` | `TEST_EVIDENCE_MOS_BUILD06/dual-security-result.json` |
| 双系统**正向**端到端 | `bash tools/run-mos-tests.sh joint` | `TEST_EVIDENCE_MOS_BUILD04/dual-e2e-result.json` |

> `build06` / `joint` 需要**同机存在企业资料库源码**，故刻意**不纳入 `all`**。
> 可选：`OA_SOURCE_DIR`（资料库源码路径）、`D6_KEEP=1`（保留隔离数据目录以便取证）、`D6_DBG=1`（附原始响应片段）。

---

## 4. 各套件断言数（本轮实测）

| 套件 | 断言 |
| --- | --- |
| smoke | 13 |
| unit | 75 |
| sec | 17 |
| sched | 20 |
| provider | 21 |
| workspace | 36 |
| dual（身份） | 51 |
| e2e | 48 |
| e2e02 | 63 |
| e2e03 | 96 |
| ui | 106 |
| **`all` 合计（11 套件）** | **546** |
| joint（双系统正向，需资料库源码） | 64 |
| build06（双系统安全负例，需资料库源码） | 61 |
| **证据汇总（`summary.json`）** | **671** |

> ⚠ **数字口径说明**：`run-mos-tests.sh` 打印的「汇总」会扫描**全部**证据目录，
> 因此在 `joint`（BUILD04）与 `build06`（BUILD06）的证据同时存在时显示 **671/671**；
> `all` **自身**的 11 个套件合计为 **546/546**。两者都不含失败项（failed 均为 0）。

---

## 5. 证据的诚实性说明

- 证据文件中的 `syntheticIdentities` 明示：全部测试身份为**合成身份**，
  「只用于证明控制机制；**不代表真人授权或真人验收**」。
- 证据中**不含**任何私钥、口令、共享密钥或资料库正文；
  只保留 `correlationId` / `code` / `status` / `ok` / 端点名 / 计数。
- 服务端审计证据读的是**Provider 隔离实例自己写的 `db.json`**，
  而非调用方的观测，可排除"自述偏差"。
