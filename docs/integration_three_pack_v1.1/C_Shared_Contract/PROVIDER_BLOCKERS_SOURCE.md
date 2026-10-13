# PROVIDER_BLOCKERS.md — 阻断项、外部依赖与待人工决策

> 严格遵循 `03_SHARED_CONTRACT_AND_ACCEPTANCE.md` §3。
> **凡缺真实依赖，一律输出阻断，不得伪称通过。**
> 本文只登记**未被伪造填充**的真实缺口，不掩盖、不美化。

---

## 0. 分级说明

| 级别 | 含义 | 处理 |
|---|---|---|
| **P0 阻断** | 缺外部依赖 / 人工作业 / 权限，本项**无法**由 Provider 单方推进 | 需 User 或 Consumer 行动 |
| **P1 待配合** | 需 Consumer 配合才能闭合的联合验收项 | 需双方协调 |
| **P2 已知限制** | 影响范围有限、有明确规避方式或已有替代证据 | 记录并披露 |
| **P3 环境观察** | 不影响交付结论的事实性观察 | 仅记录 |

---

## P0-1：SPECIAL-01 正式原件未入库（→ INT-09 `BLOCKED`）

| 项 | 内容 |
|---|---|
| **状态** | `BLOCKED` |
| **事实** | 企业资料库中**不存在** SPECIAL-01 的正式原件。代码侧已**如实披露**该事实：`lib/asset-policy.js` 导出 `provisional: { marketingCategories: true, licenseStatuses: true, reuseScopes: true }`。 |
| **为何不能自行解决** | 规格明文要求「缺原件不得填充虚构规则，也不得把文件存在等同于正式批准」。Provider **不得**凭推测把 A01—A08、许可状态、复用范围标为 VERIFIED。 |
| **影响** | 验收矩阵 INT-09 无法标记 VERIFIED；Consumer 若依赖这些枚举做业务判定，需知道它们**当前是临时口径**。 |
| **当前可用口径（临时）** | 资产类别 A01—A08；许可状态 `cleared / pending / restricted / expired / unknown`；复用范围 `none / internal_reference / brand_kit / campaign_reuse / unrestricted`。 |
| **需要谁做什么** | **User**：提供 SPECIAL-01 正式原件（或授权来源），由具备审批权的人完成正式入库与批准。 |
| **Provider 侧已完成的部分** | 系统具备承载正式原件与审批的**全部机制**（Skill 版本三道门 + 准入状态机 + 独立授权）；仅**缺材料**。 |

---

## P0-2：Visual Brand Guardian Skill V1.2 未入库（→ INT-14 部分 `BLOCKED`）

| 项 | 内容 |
|---|---|
| **状态** | `BLOCKED`（材料缺失）/ 机制 `REAL_VERIFIED` |
| **事实** | V1.2 正式原件未入库。Provider 侧**已具备**承载它的能力并已实测：登记 → 批准 → 生效三道门，生效瞬间服务端冻结 `hash` 作为规则快照引用（`L1-11.5`）。 |
| **为何不能自行解决** | Skill 的 `EFFECTIVE` 需经**人为批准**，且 `effective_at` 必须已到达。Provider **不得**自动批准。 |
| **需要谁做什么** | **User**：提供 V1.2 原件；由持有 `library.skill.approve.effective` 独立钥匙的人批准并使其生效。 |
| **替代验证** | 已用**合成 Skill** 完整验证版本与授权通道（`L1-11.1`~`L1-11.9`），但合成件**不得**被视为正式权威材料。 |

---

## P0-3：正式身份最终授权必须由真人完成（→ INT-04 的「人工」部分）

| 项 | 内容 |
|---|---|
| **状态** | 机制 `REAL_VERIFIED`，**人工动作待办** |
| **事实** | `library.asset.approve.final` 默认**无人持有**（`L1-1.1` 实测 `hasFinalApprover=false`）。本轮为验证机制，由管理员**显式授予**了合成夹具身份。 |
| **规格要求** | 「正式身份最终授权（用户本人）须明确人工完成并留下可核实审计；**不要写死某个姓名、账号或使用虚假授权**」。 |
| **需要谁做什么** | **User**：明确指定**真实的授权责任人**（按职务/团队身份描述，而非写死某个人名），由系统管理员在**联调环境**授予，并在治理审计中留下可核实记录。 |
| **Provider 不做的事** | ❌ 不使用超级管理员口令替代最终审批<br>❌ 不预置任何人的授权<br>❌ 不在文档中写死姓名/账号 |

---

## P0-4：真实 Marketing OS 未参与本轮（→ INT-01/07/13 联合项 `REAL_NOT_VERIFIED`）

| 项 | 内容 |
|---|---|
| **状态** | `REAL_NOT_VERIFIED` |
| **事实** | 本轮只运行了 Provider。执行包 `00_README` 规定的顺序是「资料库项目先行」，Consumer 随后适配。因此**跨系统跑通**这一事实尚未发生。 |
| **严禁** | 不得把 Provider 侧 `REAL_VERIFIED` 当作「联调 PASS」。 |
| **Provider 侧已交付** | 真实契约（`PROVIDER_API_OPENAPI.yaml`）、认证交接（`SERVICE_AUTH_HANDOFF.md`）、夹具说明（`TEST_FIXTURES.md`）、可复现证据（74 断言）。Consumer 可据此实现适配器。 |
| **需要谁做什么** | **Consumer**：按契约实现适配器；由 Consumer 牵头跑 E2E；Provider 核对服务端授权与审计。 |
| **收敛路径** | 见 `JOINT_ACCEPTANCE_REPORT.md` 与 `CONTRACT_DIFF.md`（若实测发现差异）。 |

---

## P0-5：真实 AI 模型未配置（→ INT-11 `BLOCKED`）

| 项 | 内容 |
|---|---|
| **状态** | `BLOCKED` |
| **事实** | 本轮**刻意**未配置任何外部模型密钥（`DEEPSEEK_API_KEY` 置空、`OA_RAG_OCR_PROVIDER=none`、`OA_RAG_EMBEDDING_PROVIDER=none`）。 |
| **为何刻意** | 规格 §G 要求「外部模型所需文本必须先过 AI 出口策略；禁止整篇批量外送」。在**未完成** AI 出口链路的跨系统验证前，贸然接真实模型会引入客户隐私外发风险。 |
| **额外事实** | Provider 的**集成侧**检索强制 `useVector=false` / `useIntent=false`，**设计上就不触达外部服务** —— 因此 INT-11 对 Provider 集成路径而言**不适用**；它属于 Consumer 的生成链路。 |
| **需要谁做什么** | **Consumer**：在其生成链路中配置模型密钥并完成一次真实文字 + 图片调用；无授权则记 `BLOCKED`。 |

---

## P1-1：线上 TLS / SSO 未验证（→ INT-01 的部署形态部分）

| 项 | 内容 |
|---|---|
| **状态** | `NOT_CONFIGURED` |
| **事实** | 本轮为**同机回环（127.0.0.1）明文 HTTP**。Provider 进程本身不终结 TLS（由前置反向代理承担），本轮未验证任何证书链/SNI/客户端证书配置。 |
| **影响** | 跨主机联调**必须**经 TLS 终结且开启证书校验；在此之前不得假定传输层安全已成立。 |
| **需要谁做什么** | **User / 运维**：提供联调环境的域名与证书，或明确允许在受控内网以明文进行联调（并承担该决定）。 |

---

## P1-2：Consumer 侧回归与适配器 E2E 未跑（→ INT-13 部分）

| 项 | 内容 |
|---|---|
| **状态** | `REAL_NOT_VERIFIED` |
| **事实** | Provider 侧 16 套件 / 945 断言 `REAL_EXIT=0`，原 OA 业务无破坏性回归。**Consumer 侧回归与 E2E 属其职责**，Provider 无法代跑。 |
| **Provider 可提供的支持** | 契约、认证交接、夹具说明、隔离环境搭建指导（均在本包内）。 |

---

## P1-3：`CONTRACT_DIFF.md` 尚未产生

| 项 | 内容 |
|---|---|
| **状态** | 待办 |
| **事实** | Provider 已按**当前真实代码**推导出契约。依据 `03_SHARED_CONTRACT_AND_ACCEPTANCE.md` §2，若 Consumer 实测发现与其余基线（`INTEGRATION_API_CONTRACT.md` 或 Consumer 侧 `docs/INTEGRATION_WORKSPACE_CONTRACT.md`）不一致，须形成**双方签署**的 `CONTRACT_DIFF.md`，**先协调，不得单方面更改双方契约**。 |
| **本轮已发现的一处契约盲区（Provider 主动披露）** | 原契约文档未描述「**票据与签发它的服务账户绑定**」这一属性（实测 `L1-14.5` 返回 `403 TICKET_ACCOUNT_MISMATCH`）。已补入 `SERVICE_AUTH_HANDOFF.md` §2.5，并在此登记为**契约补充项**，请 Consumer 确认。 |

---

## P1-4：`JOINT_ACCEPTANCE_REPORT.md` 归属联调牵头方

| 项 | 内容 |
|---|---|
| **状态** | 待办（`CONDITIONAL`） |
| **事实** | 按 `03_SHARED_CONTRACT_AND_ACCEPTANCE.md` §6，该报告由**联调牵头方（Consumer）**汇总，结论仅可为 `PASS_FOR_PILOT / CONDITIONAL / FAIL`，且**不能凭开发自审宣布生产级合规认证**。 |
| **Provider 侧立场** | 提供本包作为 Provider 部分的输入；**不代填** Consumer 侧内容，**不代签**联合结论。 |

---

## P2-1：票据密钥未配置时的重启语义

| 项 | 内容 |
|---|---|
| **状态** | 已知限制（设计取舍） |
| **事实** | 未配置 `OA_INTEGRATION_SIGNING_KEY` 时，票据 HMAC 使用**进程内随机密钥**，服务端**重启后既有票据全部失效**。 |
| **为何如此** | fail closed：宁可让 Consumer 重新取票，也不使用可预测的兜底密钥。 |
| **Consumer 应对** | 把 `401 TICKET_BAD_SIGNATURE` / `TICKET_EXPIRED` 当作**可恢复事件**（重新取票），而非服务故障。<br>启动时读 `/health` → `signing.ticketKeySource`：若为 `ephemeral-random-per-boot`，应预期重启后重取票据。 |
| **生产建议** | 部署时**必须**显式注入该密钥（值不进版本库、不进交接包）。 |

---

## P2-2：事件流为内存环形缓冲（上限 5000）

| 项 | 内容 |
|---|---|
| **状态** | 已知限制 |
| **事实** | `lib/integration/events.js` 的 `MAX_EVENTS = 5000`，单实例内存计数。溢出时 `truncated=true` 并给出 `oldestCursor`。 |
| **影响** | 长时间离线或高频变更的 Consumer 可能丢失中间事件。 |
| **Consumer 应对** | 收到 `truncated=true` 时**全量对账**（重新拉取资产/Skill 现状），不能只依赖增量。 |
| **另注** | 限流（`rateLimitPerMinute`）亦为**单实例内存计数**，多实例部署下实际上限会按实例数放大 —— 联调环境为单实例，无影响。 |

---

## P2-3：集成侧检索不做向量/意图增强

| 项 | 内容 |
|---|---|
| **状态** | 设计取舍 |
| **事实** | 集成路径强制 `useVector=false` / `useIntent=false`，仅走本地关键词（BM25）。 |
| **原因** | 避免集成调用触发对外部服务（向量/意图）的依赖，避免集成链路因外部故障而变慢或失败。 |
| **影响** | 集成侧检索召回可能低于员工端（员工端可用档位 B 混合检索）。 |
| **若 Consumer 需要** | 属契约变更，须先协商（见 P1-3）。 |

---

## P3-1：沙箱内 `reg.exe` 被安全策略阻断

| 项 | 内容 |
|---|---|
| **状态** | 环境观察（**无实质影响**） |
| **事实** | 本机沙箱的 Program Blacklist 拦截了 `reg.exe`，无法读取系统凭据库。 |
| **影响** | 无。本任务全程未依赖系统凭据库；Git 推送已走通 SSH 通道。 |
| **记录原因** | 供后续审计区分「未测」与「测不了」 —— 这一条属于后者。 |

---

## 汇总表

| 编号 | 项 | 级别 | 状态 | 需要谁 |
|---|---|---|---|---|
| P0-1 | SPECIAL-01 正式原件未入库 | P0 | `BLOCKED` | **User** |
| P0-2 | Visual Brand Guardian Skill V1.2 未入库 | P0 | `BLOCKED` | **User** |
| P0-3 | 正式身份最终授权需真人完成 | P0 | 人工待办 | **User** |
| P0-4 | 真实 Marketing OS 未参与 | P0 | `REAL_NOT_VERIFIED` | **Consumer** |
| P0-5 | 真实 AI 模型未配置 | P0 | `BLOCKED` | **Consumer** |
| P1-1 | 线上 TLS / SSO 未验证 | P1 | `NOT_CONFIGURED` | **User / 运维** |
| P1-2 | Consumer 侧回归未跑 | P1 | `REAL_NOT_VERIFIED` | **Consumer** |
| P1-3 | `CONTRACT_DIFF.md` 未产生 | P1 | 待办 | 双方 |
| P1-4 | `JOINT_ACCEPTANCE_REPORT.md` 未产生 | P1 | `CONDITIONAL` | **Consumer**（牵头） |
| P2-1 | 票据密钥未配置则重启失效 | P2 | 已知限制 | 部署时配置 |
| P2-2 | 事件流内存上限 5000 | P2 | 已知限制 | Consumer 处理 `truncated` |
| P2-3 | 集成检索不做向量增强 | P2 | 设计取舍 | 如需变更先协商 |
| P3-1 | 沙箱 `reg.exe` 被阻断 | P3 | 环境观察 | — |

---

## 明确不受阻断的能力（Provider 侧已可交付）

以下**不因上述阻断而受影响**，Consumer 可立即基于本包开始适配：

✅ 12 个集成端点的真实契约（含错误码全集与统一封套）
✅ Ed25519 请求签名 + 受限票据的完整认证交接（含 `canonicalString` 契约与三个易错点）
✅ 服务账户登记 / 轮换 / 撤销流程与**即时生效**特性
✅ 独立授权（三把钥匙）的授予与撤销机制
✅ 准入闭环（申请 → 复核 → 本人最终审批 → 入库 → 撤回）的状态语义
✅ Skill 三道门与 `hash` 冻结语义
✅ 变更事件轮询（cursor）与品牌隔离规则
✅ §J 边界实证：资料库**不存在**发布档案端点
