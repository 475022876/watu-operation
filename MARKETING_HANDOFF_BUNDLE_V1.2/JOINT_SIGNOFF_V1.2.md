# JOINT_SIGNOFF_V1.2 —— 联合验收签署页（**签署栏留空，本侧不代签**）

> 依据：`VFIB_MarketingOS_Remediation_V1.2/B_Marketing_OS` Phase B3
> 「对 INT-01～INT-14 每项列 PASS/CONDITIONAL/BLOCKED/FAIL、真实/模拟、日志/截图路径、
> 两端 commit、缺口责任、**双方签署栏（不代签）**」
> 日期：**2026-10-13**｜逐项判定正文见仓库根 [`JOINT_ACCEPTANCE_REPORT_V1.2.md`](../JOINT_ACCEPTANCE_REPORT_V1.2.md)

---

## 0. 本页性质声明（**必读**）

1. 本页是**待签文件**，由本侧（运营中台）起草并提交。**本侧不代签任何一方**，
   不预填结论，不代填日期，不代填姓名/职务。
2. 当前**全部签署栏均为空白**（`⬜ 待签`）。在双方完成真实签署之前，
   联合验收结论只能是 **`CONDITIONAL`**（见 C 包「不得提前宣称」）。
3. 本轮全部测试身份均为**合成身份**（`d6.*`），**只证明控制机制有效**，
   **不代表真人授权、不代表真人验收**。真人授权的确认**只能**由真人签署完成。
4. 结论 `FAIL 0` **不构成通过**：3 项 BLOCKED 均因**外部输入未到**，须实际补齐后才可解除。

---

## 1. 版本与基线确认（双方各自核对后勾选）

| 项 | 本侧（Marketing OS） | 提供方（企业资料库） | 确认 |
| --- | --- | --- | --- |
| 应用版本 | **0.1.1**（基线 0.1.0） | 工作区 `1.1.8`；其 V1.2 `RELEASE_REGISTER.md` 自述**本轮发布 1.1.7** | ⬜ |
| 接口契约版本 | **1.0（未变）** | 1.0（未变） | ⬜ |
| 数据 schema 版本 | **v5（未变，无迁移）** | 由其自行登记 | ⬜ |
| 整改执行包编号 | `VFIB_MarketingOS_Remediation_V1.2`（B 包 + C 包） | 同名 | ⬜ |
| OpenAPI SHA256 | `cd3cc198a9c568192dbec76429fb9a6dbc836f5e738377249bc14f73d8e825e3` | 同值（**四方逐字节一致**） | ⬜ |
| Git 提交 | 基线 `259a91d` → **发布提交 `2fe3841`**（标签 `v0.1.1`，见 `docs/RELEASE_REGISTER.md` §1） | HEAD `4cbfeef`（+ 3 个**未提交**代码文件的如实声明，见 `CONSUMER_BASELINE.md` §2.1） | ⬜ |
| 运行环境 | **Staging / 本地隔离实例**，端口 MOS `9564` / Provider `9765` | 同批隔离实例 | ⬜ |

> ⚠ **版本口径待双方确认**：提供方 V1.2 `RELEASE_REGISTER.md` 记「本轮实际发布 1.1.7」，
> 而其工作区 `package.json` / `lib/config.js` 已为 `1.1.8`。**该差异属提供方内部登记问题，本侧不强判**，
> 请提供方在签署时给出**权威取值**（见 §3 第 4 项）。

---

## 2. 逐项结论（摘要；明细见 `JOINT_ACCEPTANCE_REPORT_V1.2.md`）

| ID | 本侧判定 | 真实/模拟 | 解除条件（C 包） | 尚未满足的部分 |
| --- | --- | --- | --- | --- |
| INT-01 | **PASS** | 真实（双进程真实 HTTP） | 保留双独立进程 HTTP 证据 | 跨主机 TLS 属独立部署验收，本轮不含 |
| INT-02 | **PASS** | **真实**（过期/重放/撤销，含服务端审计 6/6） | 已在 `build06` 实测 | — |
| INT-03 | **PASS** | **真实**（跨品牌 ×3、高密级 ×2 面向） | 已在 `build06` 实测 | — |
| INT-04 | **CONDITIONAL** | **合成** | 真实授权最终审批人于 Staging 签认 | **真人签认未完成**（本页 §4） |
| INT-05 | **PASS** | 真实 + 回归 | 准入必填/幂等/Asset ID/失败不可复用 | — |
| INT-06 | **CONDITIONAL** | 真实（仅负向） | 正式 Skill 已批准生效、历史版不可新引用 | **无 EFFECTIVE 正式 Skill 可正向验证** |
| INT-07 | **PASS** | **真实**（撤回 → 事件 → 失效） | 继续验证撤回→事件→失效/重对账 | — |
| INT-08 | **PASS** | 结构性证据（代码级 + Provider `/health` 实测） | Published Archive 保留于 MOS、不镜像 | — |
| INT-09 | **BLOCKED** | —（无原件，不可测） | SPECIAL-01 正式原件逐项核验 | **原件未到**，41 项保持 PROVISIONAL |
| INT-10 | **BLOCKED** | —（仅负向证据） | Skill V1.2 正式登记、真人审批、生效及引用 | **真人批准与 EFFECTIVE 未到** |
| INT-11 | **BLOCKED** | —（0 次真实调用） | 授权条件下真实文字/图像调用 | **无真实密钥与费用授权** |
| INT-12 | **PASS** | **真实**（CDP 驱动浏览器 + 28 张截图） | 独立浏览器复验、证据归档 | — |
| INT-13 | **CONDITIONAL** | 本侧真实 | 双方完整回归、数据恢复、权限负例互认 | **提供方全量回归与数据恢复演练本侧未复跑** |
| INT-14 | **CONDITIONAL** | — | 双方真实签署、Release Register 与运行环境确认 | **双方签署未完成**（本页 §3 §4） |

**合计：PASS 7 / CONDITIONAL 4 / BLOCKED 3 / FAIL 0 → 联合验收 `CONDITIONAL`。**

---

## 3. 双方待确认清单（逐项勾选后方可签署）

| # | 事项 | 责任方 | 状态 |
| --- | --- | --- | --- |
| 1 | 确认 OpenAPI 四方 SHA256 一致（`cd3cc198…`），契约 1.0 冻结 | 双方 | ⬜ |
| 2 | 确认本轮**仅运营中台**被修改（本侧 `D6-56`：Provider `server.js` mtime Δ=0ms） | 双方 | ⬜ |
| 3 | 确认 `build06` **真实 HTTP** 安全负例 61/61 及服务端审计 6/6 可复核 | 提供方复核 | ⬜ |
| 4 | 提供方给出**权威应用版本取值**（`1.1.7` 与工作区 `1.1.8` 的口径统一） | **提供方** | ⬜ |
| 5 | 提供方确认 `LIBRARY_HANDOFF_BUNDLE_V1.2` 为**最终**输入（含 `PROVIDER_API_OPENAPI.yaml`） | **提供方** | ⬜ |
| 6 | 提供方确认其工作区 3 个**未提交**代码文件（`lib/config.js` / `lib/integration/service-accounts.js` / `package.json`）的处置与最终形态 | **提供方** | ⬜ |
| 7 | 提供方补交 **SPECIAL-01 V1.1 正式原件**（解除 INT-09） | **提供方** | ⬜ |
| 8 | 提供方完成 **Skill V1.2 真人审批 + EFFECTIVE** 并提供审批记录/版本/hash（解除 INT-10） | **提供方** | ⬜ |
| 9 | 用户明确**授权费用**并提供**真实供应商非生产密钥**（解除 INT-11） | **用户** | ⬜ |
| 10 | 提供方**全量回归结果**与**数据恢复演练记录**交付，双方互认权限负例 | **提供方** | ⬜ |
| 11 | 双方书面确认 **Staging 运行环境**标识与本轮证据可复现性 | 双方 | ⬜ |
| 12 | 用户明确**批准生产部署**（本轮**不做**） | **用户** | ⬜ |

---

## 4. 真实授权最终审批人签认（INT-04 —— **仅真人可签**）

> 本轮 `D6-44` 由**合成**授权主体走通全链，仅证明控制机制有效。
> 下表须由**真实授权人**在 Staging 环境亲自签署，**不得代签、不得由 AI 或本侧填写**。

| 项 | 内容 |
| --- | --- |
| 签认事项 | 确认真实授权最终审批人（持 `library.asset.approve.final`）已完成 Staging 最终审批签认 |
| 环境 | ⬜ 待填（Staging 环境标识 / 地址） |
| 对象 | ⬜ 待填（Asset ID / version） |
| 日期 | ⬜ 待签 |
| 姓名 / 职务 | ⬜ 待签 |
| 签名 | ⬜ 待签 |

---

## 5. 双方签署栏（**留空**）

### 5.1 提供方（企业资料库 / Workspace）

| 项 | 内容 |
| --- | --- |
| 系统 / 版本 | 企业资料库 `⬜ 待填` |
| Git 提交 | `⬜ 待填` |
| 确认范围 | INT-01～INT-14 中**由提供方负责**的项（INT-09 / INT-10 / INT-13 等） |
| 结论 | ⬜ PASS / ⬜ CONDITIONAL / ⬜ 不通过 |
| 签署人 / 职务 | ⬜ 待签 |
| 日期 | ⬜ 待签 |

### 5.2 消费方（VFIB Marketing OS / 运营中台）

| 项 | 内容 |
| --- | --- |
| 系统 / 版本 | VFIB Marketing OS **0.1.1** |
| Git 提交 | **`2fe3841dc2c7a96bf264b42f08704f8e695293cc`**（标签 `v0.1.1`） |
| 确认范围 | INT-01～INT-14 中**由消费方负责**的项 |
| 结论 | ⬜ PASS / ⬜ CONDITIONAL / ⬜ 不通过 |
| 签署人 / 职务 | ⬜ 待签 |
| 日期 | ⬜ 待签 |

### 5.3 生产部署授权（**独立于上述验收**）

| 项 | 内容 |
| --- | --- |
| 授权事项 | 批准将本版本部署至生产环境 |
| 状态 | ⬜ **未授权** —— 本轮**不部署生产** |
| 授权人 / 日期 | ⬜ 待签 |

---

## 6. 不代签声明（本侧正式声明）

- 本侧**未**代填、**未**代签上述任何签署栏；全部签署栏保持空白。
- 本侧**未**将合成身份的测试结果表述为真人验收（证据文件中均显式标注 `syntheticIdentities`）。
- 本侧**未**在任何文件中宣称"已通过联合验收"；当前结论统一为 **`CONDITIONAL`**。
- 本侧**未**部署生产环境，**未**申请或使用生产凭据。

> 依据 C 包「不得提前宣称」：任一 P0 真实授权或正式 Skill/字典未满足，联合验收只能
> CONDITIONAL/BLOCKED；**测试合成用户只能证明控制机制，不能代替真人授权**。

---

## 7. 关联证据索引

| 内容 | 路径 |
| --- | --- |
| 逐项判定正文 | [`../JOINT_ACCEPTANCE_REPORT_V1.2.md`](../JOINT_ACCEPTANCE_REPORT_V1.2.md) |
| 基线锁定 | [`CONSUMER_BASELINE.md`](CONSUMER_BASELINE.md) |
| 真实 HTTP 安全负例 | [`REAL_HTTP_SECURITY_NEGATIVE_EVIDENCE.md`](REAL_HTTP_SECURITY_NEGATIVE_EVIDENCE.md) |
| 正式输出门禁 | [`FORMAL_OUTPUT_GATE.md`](FORMAL_OUTPUT_GATE.md) |
| 事件 fail-closed / 准入字段 | [`EVENT_FAILCLOSED_AND_ADMISSION_FIELDS.md`](EVENT_FAILCLOSED_AND_ADMISSION_FIELDS.md) |
| 阻断项 | [`BLOCKED_ITEMS_V1.2.md`](BLOCKED_ITEMS_V1.2.md) |
| 证据索引（含 SHA256） | [`TEST_EVIDENCE_INDEX.md`](TEST_EVIDENCE_INDEX.md) |
| 发布登记 | [`../docs/RELEASE_REGISTER.md`](../docs/RELEASE_REGISTER.md) |
