# MARKETING_HANDOFF_BUNDLE_V1.2 —— 运营中台（消费方）联调交付包

> 依据：`VFIB_MarketingOS_Remediation_V1.2/B_Marketing_OS/01_MARKETING_CODEX_REMEDIATION_V1.2.md`
> 约束：`VFIB_MarketingOS_Remediation_V1.2/C_Shared_Contract/01_SHARED_ACCEPTANCE_AND_VERSIONING_V1.2.md`
> 日期：**2026-10-13**
> **总结论：`CONDITIONAL`**（PASS 7 / CONDITIONAL 4 / BLOCKED 3 / FAIL 0）
> 逐项判定见仓库根 [`JOINT_ACCEPTANCE_REPORT_V1.2.md`](../JOINT_ACCEPTANCE_REPORT_V1.2.md)

---

## 0. 本侧身份与红线（逐条自证）

| 项 | 内容 | 自证 |
| --- | --- | --- |
| 本项目身份 | **接口消费方（Consumer）+ 联调牵头方** | — |
| 唯一改动方 | ✅ 仅运营中台 `D:\运营系统\VFIB-Marketing-OS` | `git status`（本仓库） |
| **不改** | ❌ 企业资料库 / OA 源码 | `evidence/dual-security-result.json` → `providerSourceUnchanged: true`（`server.js` mtime 双证 `D6-56`） |
| **不开发** | ❌ S05 客户增长 / 品牌声誉专项 / 营销线索移交与闭环 / 代理 / 自动发布（**保持 MARK**） | `D6-57`：`/api/mos/meta` 权限表 20 项，MARK 类命中 **0** |
| **不部署** | ❌ 未经批准不部署生产 | 本包仅登记 **Staging / 本地隔离实例** |
| **不代签** | ❌ 不代签任何人工审批 | `JOINT_SIGNOFF_V1.2.md` 签署栏**留空** |

---

## 1. 交付清单

| # | 文件 | B 包要求 | 内容 |
| --- | --- | --- | --- |
| 1 | [`CONSUMER_BASELINE.md`](CONSUMER_BASELINE.md) | Phase B0 基线锁定 | 版本四元组、两端 commit、**三方 OpenAPI SHA256 一致**、端口表、自检基线、V1.1→V1.2 差异 |
| 2 | [`REAL_HTTP_SECURITY_NEGATIVE_EVIDENCE.md`](REAL_HTTP_SECURITY_NEGATIVE_EVIDENCE.md) | Phase B1①：真实 HTTP 安全负例（**不得用单元测试冒充**） | INT-02 / INT-03 逐条：请求条件、**脱敏 requestId**、期望/实际码、**服务端审计证据**（Provider `db.json` 的 `integration-call` 行）、复现命令 |
| 3 | [`FORMAL_OUTPUT_GATE.md`](FORMAL_OUTPUT_GATE.md) | Phase B1②：Revoked/Deprecated/权限撤销/Skill 失效**不得生成新正式作品** | 门禁判定模型、四类阻断码、生成端点同源、端到端证据（撤回 → 传递 → 失效 → 409）、真实缺陷修正说明 |
| 4 | [`EVENT_FAILCLOSED_AND_ADMISSION_FIELDS.md`](EVENT_FAILCLOSED_AND_ADMISSION_FIELDS.md) | Phase B1②③：7 类事件 fail-closed；准入三必填字段 | 7 类事件动作表、未知事件/断线/截断 fail-closed、三字段 Provider 枚举校验、幂等与历史 |
| 5 | [`BLOCKED_ITEMS_V1.2.md`](BLOCKED_ITEMS_V1.2.md) | Phase B2：外部输入与授权（**如实 BLOCKED**） | SPECIAL-01 字典原件、正式 Skill V1.2、真实 AI Provider —— 三项逐条如实阻断说明 |
| 6 | [`UI_BROWSER_EVIDENCE/`](UI_BROWSER_EVIDENCE/) | Phase B2：P1—P4 真实浏览器复测 | 28 张真实浏览器截图（CDP 驱动，非模拟）+ `README.md` 对照表 |
| 7 | [`TEST_EVIDENCE_INDEX.md`](TEST_EVIDENCE_INDEX.md) | 证据归档 | 证据清单 + SHA256 + 复现命令 |
| 8 | [`PUBLISHED_ARCHIVE_ISOLATION.md`](PUBLISHED_ARCHIVE_ISOLATION.md) | Phase B1④：Published Archive 只在**中台**权威归档 | 结构性隔离证据（路由对 `adapters/workspace|library` 零引用） |
| 9 | [`JOINT_SIGNOFF_V1.2.md`](JOINT_SIGNOFF_V1.2.md) | Phase B3：双方签署栏（**不代签**） | 空签署区 + 待确认清单 |
| 10 | [`README.md`](README.md) | — | 本文件 |

---

## 2. 本轮相对 V1.1 的变化（一句话）

- **INT-02 / INT-03 由 CONDITIONAL → PASS**：新增 **61/61** 双进程**真实 HTTP** 安全负例
  （`tools/mos-e2e-build06-dual.js`），并附**服务端审计证据** 6/6（不再依赖单元测试）。
- **新增正式输出门禁**：`lib/mos/formalguard.js` + `POST /api/mos/formal-output-check`，
  并在 `POST /api/mos/generation-jobs` 同源执行（**TEXT 与 IMAGE 一视同仁**）。
- **应用版本 0.1.0 → 0.1.1**（确有应用代码变更）：`package.json` / `lib/config.js` / `lib/mos/config.js` /
  UI 版本显示 / `CHANGELOG.md` / `docs/RELEASE_REGISTER.md` 六处同步。
- **INT-09 / INT-10 / INT-11 仍 BLOCKED**：外部输入未到，**不臆造、不冒充**（见 `BLOCKED_ITEMS_V1.2.md`）。

---

## 3. 版本四元组（详见 `CONSUMER_BASELINE.md`）

| 轴 | 值 |
| --- | --- |
| 应用版本 | **0.1.1**（基线 0.1.0） |
| 接口契约版本 | **1.0**（**未变**） |
| 数据 schema 版本 | **v5**（**未变**；无新集合、无迁移） |
| 整改执行包编号 | **V1.2**（≠ API 版本） |

---

## 4. 测试基线

| 套件 | 结果 |
| --- | --- |
| `bash tools/run-mos-tests.sh all`（11 套件） | **546/546** |
| └ `ui`（真实浏览器 CDP） | **106/106** |
| `bash tools/run-mos-tests.sh build06` | **61/61**（`PASS_EVIDENCE_COMPLETE`） |
| `bash tools/run-mos-tests.sh joint`（V1.1 建立，本轮回归） | **64/64** |

> `build06` / `joint` 需要同机存在企业资料库源码，故**不纳入 `all`**，按需显式运行。
>
> **口径说明**：`run-mos-tests.sh` 打印的「汇总」会扫描**全部**证据目录，
> 因此在 `joint`（64）与 `build06`（61）证据同时存在时显示 **671/671**；
> `all` **自身**的 11 个套件合计为 **546/546**。两者 `failed` 均为 **0**。
