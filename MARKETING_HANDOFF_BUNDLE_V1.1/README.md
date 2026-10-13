# MARKETING_HANDOFF_BUNDLE_V1.1 —— 运营中台（消费方）联调交付包

> 依据：`VFIB_Dual_Project_Integration_Three_Pack_V1.1/B_MarketingOS_Consumer/03_HANDOFF_AND_REPORT.md`
> 对应验收：C 包 `04_E2E_ACCEPTANCE_AND_EVIDENCE.md` 的 **INT-01 … INT-14**
> 日期：**2026-10-13**
> **总结论：`CONDITIONAL`**（PASS 5 / CONDITIONAL 6 / BLOCKED 3 / FAIL 0）

---

## 0. 重要：本侧身份与红线

| 项 | 内容 |
|---|---|
| 本项目身份 | **接口消费方（Consumer） + 联调牵头方** |
| 唯一改动方 | ✅ 仅 Marketing OS（`D:\运营系统\VFIB-Marketing-OS`） |
| **不改** | ❌ 企业资料库 / OA 源码（本侧实测 `D4-00` / `D4-45` 双证） |
| **不开发** | ❌ S05 客户增长 / 品牌声誉专项 / 营销线索移交与闭环 / 代理 / 自动发布（**保持 MARK**） |
| **不部署** | ❌ 未经用户批准，不得部署生产环境 |

---

## 1. 交付清单（12 项，逐项对应 B 包要求）

| # | 文件 | B 包要求 | 内容 |
|---|---|---|---|
| 1 | [`CONSUMER_BASELINE.md`](CONSUMER_BASELINE.md) | 双方 Git/应用/合同版本、SHA256 | 版本三元组、Git 基线 `286fe5b`、20/20 SHA 校验、**三方契约逐字节一致**、端口表、自检基线、诚实边界 |
| 2 | [`CONTRACT_DIFF_SIGNED.md`](CONTRACT_DIFF_SIGNED.md) | D-00 至 D-10 双侧决定、仍未确认项（**不能伪签**） | D-00…D-10 逐条（提供方答复 / 本侧实测核验 / 本侧决定 / 双侧确认 / 状态）+ CCR-2026-002…005 + **本侧自查缺陷披露** + 6 项未确认 + **空签署区** |
| 3 | [`ADMISSION_FIELDS_UI_DATA_MIGRATION.md`](ADMISSION_FIELDS_UI_DATA_MIGRATION.md) | 三项字段、历史迁移/回滚和表单截图 | 四层核对、三条「不猜测」规则、`reviews[]`、幂等/重试/失败查询、**v4→v5 迁移与回滚**、UI 断言 |
| 4 | [`AUTH_AND_EVENTS_REPORT.md`](AUTH_AND_EVENTS_REPORT.md) | 签名票据、轮询、截断、撤回、fail-closed 及测试命令 | 双重身份、签名三个坑、票据生命周期、**三重闭合**、事件消费六约束、7 事件动作表、fail closed 表、测试命令 + 双系统对照 |
| 5 | [`REAL_HTTP_E2E_EVIDENCE.md`](REAL_HTTP_E2E_EVIDENCE.md) | 两端 requestId、时间、响应摘要、状态、环境；脱敏日志 | runTag `5d00f4e0`、**64/64**、5 个真实 `requestId`、Phase A—H 逐条、**阴性对照**、脱敏说明、复现命令 |
| 6 | [`PUBLISHED_CONTENT_ISOLATION.md`](PUBLISHED_CONTENT_ISOLATION.md) | 归档快照与 Provider 无镜像证据 | 三重证据（代码结构 / 能力声明 / 双系统实测）；`D4-54` `0→0`、`D4-55` `0`、`D4-56` 母版独立申请；双权威边界表 |
| 7 | [`SKILL_AND_DICTIONARY_STATUS.md`](SKILL_AND_DICTIONARY_STATUS.md) | 正式文件/批准状态、未核验项 | `INT-09` `BLOCKED`（41/41 待核验）、`INT-10` `BLOCKED`（机制就绪、对象未到）；**禁止做**清单 |
| 8 | [`AI_PROVIDER_REAL_MOCK_STATUS.md`](AI_PROVIDER_REAL_MOCK_STATUS.md) | 真调用与 mock 独立标识 | 三态设计（`none`/`mock`/真实）、MOCK 与 REAL **结构性分离**、密钥硬约束、`INT-11` `BLOCKED` |
| 9 | [`UI_BROWSER_EVIDENCE/`](UI_BROWSER_EVIDENCE/README.md) | P1–P4 及审批/失败场景 | **22 张本次运行截图**（真实 Chrome + CDP）+ 索引 `README.md`（含 `B1-38-admission-dialog.png`） |
| 10 | [`SECURITY_REGRESSION.md`](SECURITY_REGRESSION.md) | 全量测试 + 安全回归与备份恢复 | **610/610**、`sec 17/17`、SSRF/注入逐条、**备份与恢复**（原子落盘 / 迁移前备份 / 损坏重建 / 口令重置）、隔离性证明 |
| 11 | [`JOINT_ACCEPTANCE_REPORT.md`](JOINT_ACCEPTANCE_REPORT.md) | 共享 14 项矩阵逐项 PASS/FAIL/BLOCKED/NOT_RUN，由双方确认 | `INT-01`…`INT-14` 逐项（方法 / 证据 / 运行时间 / 参与进程 / 版本 / 阻断责任）+ 阴性对照总表 + 门槛自检 + **空签署区** |
| 12 | [`CHANGELOG.md`](CHANGELOG.md) | 修改清单、未完成项、部署与回滚 | `git diff --stat`、按 B0—B8 的变更清单、schema v4→v5、测试基线变化、**未完成项**、**部署与回滚**、红线自检 |

**仓库根另有** [`JOINT_ACCEPTANCE_REPORT.md`](../JOINT_ACCEPTANCE_REPORT.md)（同一份，便于单独取用）。

---

## 2. 验收矩阵速览（详见 #11）

| ID | 场景 | 结果 |
|---|---|---|
| `INT-01` | 双进程 / 独立数据目录 与 真实 HTTP | ✅ **PASS** |
| `INT-02` | Ed25519 签名 / 重放 / 失效服务账号 | ⚠ CONDITIONAL |
| `INT-03` | 受限用户票据 及 品牌 / 密级 | ⚠ CONDITIONAL |
| `INT-04` | 最终特殊审批 | ⚠ CONDITIONAL |
| `INT-05` | 资产准入端到端 | ✅ **PASS** |
| `INT-06` | 检索与版本 | ⚠ CONDITIONAL |
| `INT-07` | 撤回与事件 | ✅ **PASS** |
| `INT-08` | Published Archive 不镜像 | ✅ **PASS** |
| `INT-09` | SPECIAL-01 正式字典 | ⛔ **BLOCKED** |
| `INT-10` | 正式 Skill | ⛔ **BLOCKED** |
| `INT-11` | 真实文字 / 图片 AI | ⛔ **BLOCKED** |
| `INT-12` | P1–P4 浏览器实际操作 | ✅ **PASS** |
| `INT-13` | 两边完整回归、安全 及 备份 | ⚠ CONDITIONAL |
| `INT-14` | 版本 和 共同签署 | ⚠ CONDITIONAL |

**合计：PASS 5 / CONDITIONAL 6 / BLOCKED 3 / FAIL 0 / NOT_RUN 0 → `CONDITIONAL`**

---

## 3. 一键复现

```bash
cd D:/运营系统/VFIB-Marketing-OS

# ① 本侧全量回归（11 套件，不含 joint）
bash tools/run-mos-tests.sh all

# ② 双系统真实 HTTP 端到端（需同机存在资料库源码，只读不修改）
bash tools/run-mos-tests.sh joint
#   或： node tools/mos-e2e-build04-dual.js
```

**证据落盘**：

| 路径 | 内容 |
|---|---|
| `TEST_EVIDENCE_MOS_BUILD01/summary.json` | 全量汇总（`610/610`） |
| `TEST_EVIDENCE_MOS_BUILD04/dual-e2e-result.json` | 双系统 64 条逐条 |
| `TEST_EVIDENCE_MOS_BUILD04/dual-e2e-summary.txt` | 双系统结论摘要 |

---

## 4. 阻断事项（**如实报告，不伪签**）

| # | 阻断项 | 级别 | 影响 | 责任方 |
|---|---|---|---|---|
| `B-1` | SPECIAL-01 字典**原件未入库** | P0 | `INT-09` | 业务方 |
| `B-2` | Visual Brand Guardian Skill **V1.2 未入库** | P0 | `INT-10` | 业务方 |
| `B-3` | 真实**持权人**最终审批未执行 | P0 | `INT-04`/`13`/`14` | 双方会同 |
| `B-4` | Provider `resubmit`（重提）能力缺失 | P1 | 消费方恢复路径 | Provider |
| `B-5` | 跨主机 **TLS 终结**未验证 | P1 | 部署形态 | 环境 |
| `B-6` | 线上**部署**未验证 | P1 | 交付验收 | 用户（**明令禁止**） |
| `B-7` | 真实**外部 AI** 未跑 | P1 | `INT-11` | 凭据 |

---

## 5. 需要对方配合的动作（**本侧不代签**）

| # | 动作 | 由谁 |
|---|---|---|
| 1 | 在 `CONTRACT_DIFF_SIGNED.md` 签署 D-00…D-10 双侧决定 | 双方 |
| 2 | 双方 `request_id` 逐条互认（本侧 5 个锚点已在 #5 §2） | 双方 |
| 3 | 在 `JOINT_ACCEPTANCE_REPORT.md` 签署最终结论 | 双方 |
| 4 | 提供 SPECIAL-01 原件 / Skill V1.2 材料 | 业务方 |
| 5 | 提供真实 AI 凭据（如要解除 `INT-11`） | 业务方 |
| 6 | 会同执行一次**真实持权人**最终审批 | 双方（Staging） |
