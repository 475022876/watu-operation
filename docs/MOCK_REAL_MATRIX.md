# Marketing OS V0.1 — Mock / Real 集成矩阵（BUILD-01 + BUILD-02 + BUILD-03）

> 单一权威来源：`lib/mos/config.js` 的 `DEFAULT.integrations`（可被 `config.json` 的 `mos.integrations` 与环境变量 `MOS_*` 覆盖）。
> **任何一处从 `mock` 改成 `real`，都必须同步更新本文件并补充验证证据。**
> 依据：`00_MASTER_BUILD_SPEC.md` §0.1-5、§3；`06_INTEGRATION_SECURITY.md` §1/§6；`08_TEST_AND_ACCEPTANCE.md` §5 Gate A/D。

## 1. 当前状态总表

| # | 能力 | 适配器 / 位置 | 当前状态 | UI/API 如何如实呈现 | 切到 real 的前置条件 |
|---|---|---|---|---|---|
| 1 | 身份与登录（IdentityGateway） | `lib/mos/adapters/identity.js` → **MockIdentityGateway** | `mock` | 顶栏集成条显示「身份：MOCK/mock」；`GET /api/mos/identity/status` 返回 `mode:"mock"` | 真实 SSO/MFA 接入 + 06 §6 生产阻断清单（真实 SSO+MFA、渗透测试、监控告警等）逐项通过 |
| 2 | 企业知识检索（KnowledgeGateway） | `lib/mos/adapters/knowledge.js` → **MockKnowledgeGateway** | `mock` | 返回沙盒条目并带 `sandbox:true`；检索结果不得当作正式制度/知识 | 企业资料库/知识库源码与 API 审计完成；按来源权限过滤可用性验证 |
| 3 | 企业资料库入库/检索（LibraryGateway） | `lib/mos/adapters/library.js` → **MockLibraryGateway** | `mock` | 回执/资产 ID 一律 `MOCK_` 前缀 + `mode:'mock'`；回执固定 `permissionValid:false` + `assetState:'MOCK_SANDBOX'`（**因此 `AVAILABLE` 结构性不可达**）；`searchApproved` **恒返回空**；最终授权校验只能得到 `MOCK_APPROVED`（`formalApproved:false`）；治理页把"正式库检索"与"沙盒条目"**分列展示** | 真实库 API 审计 + 幂等回执持久化验证 + **生产集成 Gate D**（不得以 Mock 通过替代） |
| 4 | 外部情报采集（SourceRegistry） | `lib/mos/adapters/source.js` | **`real`**（真实 HTTP 抓取） | 采集是真实出站请求；受 `egress.allowedHosts` allowlist + DNS/IP 解析拦截（SSRF）+ 超时/体积上限约束；失败**如实**写入来源状态与错误，不伪造成功 | 已可用；生产需确认来源许可（robots/服务条款/授权）与法务清单 |
| 5 | 文本模型（摘要 **+ BUILD-02 文案草稿**） | `lib/mos/adapters/text.js` | `none`（默认）／`mock`／`deepseek` | 摘要沿用 BUILD-01 状态；新增 `draft()` 用于文案草稿：`none` → `NOT_CONFIGURED`（作业落 NOT_CONFIGURED，**不伪造输出**）；`mock` → 输出确定性骨架稿并在正文首行标注「（MOCK · 非模型输出）」；`deepseek` → 有 Key 才真实调用，否则 `INTEGRATION_PENDING`；`internal_restricted` → `BLOCKED` | 供应商 DPA/数据地域/训练使用条款确认 + 数据分级策略（Restricted 默认拒发）+ Key 注入 |
| 6 | 图像模型（BUILD-02） | `lib/mos/adapters/image.js` | `none`（默认）／`mock`／`openai` | `none` → `NOT_CONFIGURED`，作业显式失败，**不产出任何图像**；`mock` → 确定性 SVG（中性白底，画面内嵌「MOCK 生成图 · 非真实模型输出」与提示词快照）；`openai` → 有 Key 才真实调用 `/v1/images/generations`，Key 只在服务端；真实产出不做像素级审核，QA 判定固定 `NEEDS_HUMAN_REVIEW` | 供应商 DPA/数据地域/训练使用条款确认 + **品牌 Skill APPROVED**（未批准一律阻断 FORMAL）+ Key 注入 |
| 7 | OA 企业系统接口 | 未接通 | `未接通` | 顶栏集成条固定显示「OA 接口：未接通」；`INTEGRATION_PENDING` 标记 | 最新 OA 源码/API 审计 + 身份/权限/版本/回执/撤回逐项校验 |
| 8 | 视频自动渲染 / 配音 / 剪辑 | **明确不实现**（04 §2 首期范围） | 不适用 | 视频工作区仅支持 Brief/脚本/分镜/字幕/关键帧/成片上传；界面明示「不提供自动渲染」 | 待后续阶段立项评估 |
| 9 | 平台指标 API（BUILD-03 Analytics） | 未接通 | `未接通` | Analytics 不使用任何占位数字：无数据来源的指标一律显示「缺失」并附原因（`missing[]`）；渠道指标只能人工/导入登记（带来源与统计时点） | 平台开放 API + 授权 + 指标口径确认；在此之前不得以 0 或示例值填充 |
| 10 | 获客成本 / 漏斗 / 行为归因（CAC 等） | **明确不在本期范围**（MARK-S05） | 不适用 | Analytics 的 `scopeNote` 显式排除；前后端均无菜单、无数据、无入口 | 待后续阶段立项评估 |

## 2. 关键诚实性边界（代码级）

以下边界由代码**强制**，不依赖文档约定：

1. **资料库 Mock 不会产生正式资产**
   `submitAdmission()` 的成功回执固定为：`assetId: 'MOCK_ASSET_*'`（**不是**正式资料库 ID）、
   `state: 'SYNC_COMPLETED'`、`assetState: 'MOCK_SANDBOX'`、`permissionValid: false`；
   `verifyFinalAuthorization()` 只返回 `MOCK_APPROVED` 且 `formalApproved: false`，不可能得到 `APPROVED`。
   失败回执为 `state: 'SYNC_FAILED'` + 明确 `errorCode`（`MISSING_DIGEST` / `MISSING_CATEGORY` /
   `LICENSE_UNVERIFIED` / `MOCK_TRANSIENT_TIMEOUT`），且**失败不生成引用**。
   → 因此任何「已入库/可正式复用」的结论在 Mock 下都不成立：
   `reuseEligibility` 要求 `approvalMode === 'REAL'` **且** `permissionValid` **且** `assetState === 'ACTIVE'`，
   在 Mock 下**结构性恒为 false**，`AVAILABLE` 不可达。

2. **正式检索在 Mock 下为空**
   `searchApproved()` 恒返回 `items: []` 并附 `note`，避免把模拟结果冒充企业正式资产（08 §SEC-09）。

3. **摘要状态必须显式**
   情报条目上带 `aiSummaryState`，取值集合固定为
   `NOT_CONFIGURED`（无 Key）/ `MOCK`（演示摘要）/ `INTEGRATION_PENDING`（有 Key 但厂商适配待完成）/ `BLOCKED`（数据分级禁止外发）。
   UI 不得把 `MOCK` 渲染成「AI 已生成」。

4. **采集失败即降级，不伪造**
   未核验来源 → `SOURCE_PENDING_VERIFICATION`（fail closed，不发起请求）；
   主机不在 allowlist → `HOST_NOT_ALLOWLISTED`；
   命中受限 IP → `SSRF_BLOCKED`；以上均写入来源 `lastError` 与审计。

5. **采集内容一律视为数据**
   外部网页/RSS 中的「忽略以上指令」等文本只作为字符串保存与展示（08 §SEC-06），不进入任何指令通道。

### BUILD-02 新增边界（代码级）

6. **未批准 Skill 不得用于正式输出**
   `skill.buildPrompt()`：`usability()` 只有 `APPROVED` 才 `formalUsable`；
   `REFERENCE_ONLY` 仅允许生成显式标注的测试草稿；`MISSING_NOT_APPROVED` 全部阻断。
   **且 `outputIntent` 为失效关闭（fail-closed）**：未识别取值一律按未授权阻断，绝不静默降级为测试草稿
   （BUILD-02 修复 A-11：旧实现任何非 `'FORMAL'` 字符串都会绕过正式输出门禁）。

7. **模型未配置时不伪造输出**
   `generation-jobs` 在 Provider 未配置时把作业状态置为 `NOT_CONFIGURED` 并返回给前端，
   不产出任何"看起来像 AI 生成"的内容。Mock 产物在**文件内容内**嵌 MOCK 标记与提示词快照，
   不是仅靠 UI 角标。

8. **预算闸门先于任何外部调用**
   `budgetCheck()` 在调用 Provider 之前执行；超限即 `BUDGET_EXCEEDED`，不发起出站请求。

9. **发布只能是人工登记**
   系统内**不存在任何定时器**；到期不自动发布。`PUBLISHED` 只能由人工提交真实 URL 或证据引用产生，
   产生瞬间把正文/清单/资产物理快照进 `data/uploads/published/<pubId>/`，此后不可编辑。
   Mock 下**不存在**"自动发布成功"这种结果。

10. **发布归档 ≠ 资料库入库**
    已发布内容**不会**自动进入企业资料库（00 §1）；Mock 资料库也不可能给出 `APPROVED` 资产资格。

### BUILD-03 新增边界（代码级）

11. **最终入库许可是独立特权，且不复用预检权限**
    `reviews.js` 的 `PERM_BY_TYPE.ASSET_ADMISSION = 'library.asset.approve.final'`；
    资产预检员（`asset.review`）与 `MOS_ADMIN` **均不持有**该权限（实测 403 并写审计）。
    第三条链（`ASSET_ADMISSION`）只能通过审核链裁决，**没有**"直接置为已批准"的接口。

12. **入库申请的双字段互不推导**
    `finalApprovalStatus`（PENDING/APPROVED/REJECTED）与 `syncStatus`（NOT_STARTED/PENDING/COMPLETED/FAILED）
    彼此独立：批准后 `syncStatus` 仍为 `NOT_STARTED`，同步完成也不会回写审批状态。

13. **可复用资格只计算、不存储、不可人工置真**
    `reuseEligibility = APPROVED AND syncStatus=COMPLETED AND permissionValid AND assetState=ACTIVE AND approvalMode=REAL`。
    任何接口都无法写入该字段；Mock 下必然为 `false`，并返回逐项阻塞原因（`reuseBlocking`）。

14. **同步失败恢复是幂等的**
    `SYNC_FAILED → LIBRARY_SYNC_PENDING` 为状态机合法边；重试复用同一 `idempotencyKey`，
    重试前先按回执对账（`getAdmissionStatus`），成功只生成 **1 条**引用，绝不产生双资产。
    故障注入开关 `MOS_LIBRARY_MOCK_FAULT=once-per-key` **仅 Mock 生效、默认关闭**，瞬时故障不入回执缓存。

15. **AI 外发前先判数据分级（fail closed）**
    `RESTRICTED` 在**调用任何 Provider 之前**阻断（作业 `BLOCKED`、`providerJobId` 为空）；
    未知分级一律 `400 BAD_DATA_CLASS`，不静默降级。

16. **分析指标不得用 0 或示例值填充**
    Analytics 每个指标要么是真实聚合值，要么是 `available:false` + `missing[]` 原因；
    成本只取供应商确认回执，无回执即「缺失」，不做估算、不做汇率换算。

## 3. 环境变量覆盖（仅用于隔离自检与灰度）

| 变量 | 作用 | 默认 |
|---|---|---|
| `MOS_ENABLED` | 关闭整个子系统 | `true` |
| `MOS_DEMO_SEED` | 是否写入 DEMO 种子数据 | `true` |
| `MOS_IDENTITY` / `MOS_KNOWLEDGE` / `MOS_LIBRARY` | 覆盖集成状态 | `mock` |
| `MOS_SOURCE_INGEST` | 采集开关 | `real` |
| `MOS_TEXT_PROVIDER` / `MOS_IMAGE_PROVIDER` | 模型 Provider | `none` |
| `MOS_EGRESS_ALLOWED_HOSTS` | 出站 allowlist（逗号分隔） | 内置 10 个公开机构域名 |
| `MOS_EGRESS_ALLOW_HTTP` | 允许明文 http（**仅本地验证**） | `false` |
| `MOS_EGRESS_ALLOW_LOOPBACK` | 允许回环（**仅本地验证**） | `false` |
| `MOS_LIBRARY_MOCK_FAULT` | **仅 Mock** 的资料库故障注入：`once-per-key` 表示每个幂等键首次提交返回瞬时超时（验证失败恢复用）；`real` 模式下忽略 | `none` |

> ⚠ `MOS_EGRESS_ALLOW_HTTP` / `MOS_EGRESS_ALLOW_LOOPBACK` 只供本机端到端测试使用，
> 生产环境必须保持关闭（默认已关闭，即 https-only + 私网/回环一律阻断）。
> ⚠ `MOS_LIBRARY_MOCK_FAULT` 只用于验证「同步失败 → 幂等重试不产生双资产」，生产环境必须保持 `none`。

## 4. Gate 对应关系

| 状态 | 含义 | 当前是否达成 |
|---|---|---|
| **Gate A（BUILD-01）** | 权限、DB 持久化、月计划/Campaign/Topic/资讯采集与 E2E-01/02 通过 | 见 `BUILD-01_TEST_REPORT.md` |
| **Gate B（BUILD-02）** | AI 创作 + 传播：内容版本冻结/三条审核链/生成作业/排期/人工发布登记/归档，E2E-03/04 通过 | 见 `BUILD-02_TEST_REPORT.md` |
| **Gate C（BUILD-03）** | 资产入库（第三条链）+ 真实运营分析 + 治理与资产视图，E2E-05 与 SEC 全量通过 | 见 `BUILD-03_TEST_REPORT.md`（2026-10-12，e2e03 75/75 + UI 73/73，全量 311/311） |
| **Gate D（生产集成）** | 真实 OA/Library/身份/Provider/许可/实际入库与撤回验证 | **未开始** — 必须等 06 §6 阻断清单逐项通过 |

**结论：V0.1 当前为 sandbox 原型。除「外部情报采集」为真实出站请求外，身份、知识库、资料库、文本模型、图像模型、平台指标 API 均未接通真实系统；对外不得宣称生产可用或已具备合规认证。BUILD-02/03 的 AI 与入库能力在无 Key / Mock 环境下全部为 `NOT_CONFIGURED`、显式 MOCK 或缺失态，不伪造输出，`AVAILABLE`（可复用）结构性不可达。**
