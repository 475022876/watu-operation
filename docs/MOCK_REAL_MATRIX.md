# Marketing OS V0.1 — Mock / Real 集成矩阵（BUILD-01）

> 单一权威来源：`lib/mos/config.js` 的 `DEFAULT.integrations`（可被 `config.json` 的 `mos.integrations` 与环境变量 `OA_MOS_*` 覆盖）。
> **任何一处从 `mock` 改成 `real`，都必须同步更新本文件并补充验证证据。**
> 依据：`00_MASTER_BUILD_SPEC.md` §0.1-5、§3；`06_INTEGRATION_SECURITY.md` §1/§6；`08_TEST_AND_ACCEPTANCE.md` §5 Gate A/D。

## 1. 当前状态总表

| # | 能力 | 适配器 / 位置 | 当前状态 | UI/API 如何如实呈现 | 切到 real 的前置条件 |
|---|---|---|---|---|---|
| 1 | 身份与登录（IdentityGateway） | `lib/mos/adapters/identity.js` → **MockIdentityGateway** | `mock` | 顶栏集成条显示「身份：MOCK/mock」；`GET /api/mos/identity/status` 返回 `mode:"mock"` | 真实 SSO/MFA 接入 + 06 §6 生产阻断清单（真实 SSO+MFA、渗透测试、监控告警等）逐项通过 |
| 2 | 企业知识检索（KnowledgeGateway） | `lib/mos/adapters/knowledge.js` → **MockKnowledgeGateway** | `mock` | 返回沙盒条目并带 `sandbox:true`；检索结果不得当作正式制度/知识 | 企业资料库/知识库源码与 API 审计完成；按来源权限过滤可用性验证 |
| 3 | 企业资料库入库/检索（LibraryGateway） | `lib/mos/adapters/library.js` → **MockLibraryGateway** | `mock` | 回执/资产 ID 一律 `MOCK_` 前缀 + `mode:'mock'`；`searchApproved` **恒返回空**；最终授权校验只能得到 `MOCK_APPROVED` | 真实库 API 审计 + 幂等回执持久化验证 + **生产集成 Gate D**（不得以 Mock 通过替代） |
| 4 | 外部情报采集（SourceRegistry） | `lib/mos/adapters/source.js` | **`real`**（真实 HTTP 抓取） | 采集是真实出站请求；受 `egress.allowedHosts` allowlist + DNS/IP 解析拦截（SSRF）+ 超时/体积上限约束；失败**如实**写入来源状态与错误，不伪造成功 | 已可用；生产需确认来源许可（robots/服务条款/授权）与法务清单 |
| 5 | 文本模型（摘要/文案） | `lib/mos/adapters/text.js` | `none` | 状态显式区分 `NOT_CONFIGURED` / `MOCK` / `INTEGRATION_PENDING` / `BLOCKED`；**绝不假装真实生成** | 供应商 DPA/数据地域/训练使用条款确认 + 数据分级策略（Restricted 默认拒发）+ Key 注入 |
| 6 | 图像模型 | 未实现（BUILD-02 范围） | `none` | 无密钥/未接入 → 显示「尚未配置」，不产出任何图像 | BUILD-02 落地 Skill Loader 与 Provider 后单独评估 |
| 7 | OA 企业系统接口 | 未接通 | `未接通` | 顶栏集成条固定显示「OA 接口：未接通」；`INTEGRATION_PENDING` 标记 | 最新 OA 源码/API 审计 + 身份/权限/版本/回执/撤回逐项校验 |

## 2. 关键诚实性边界（代码级）

以下边界由代码**强制**，不依赖文档约定：

1. **资料库 Mock 不会产生正式资产**
   `submitAdmission()` 返回 `assetId: null`、`state: 'MOCK_SYNC_COMPLETED'`；
   `verifyFinalAuthorization()` 只返回 `MOCK_APPROVED`，不可能得到 `APPROVED`。
   → 因此任何「已入库/可正式复用」的结论在 Mock 下都不成立。

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

## 3. 环境变量覆盖（仅用于隔离自检与灰度）

| 变量 | 作用 | 默认 |
|---|---|---|
| `OA_MOS_ENABLED` | 关闭整个子系统 | `true` |
| `OA_MOS_DEMO_SEED` | 是否写入 DEMO 种子数据 | `true` |
| `OA_MOS_IDENTITY` / `OA_MOS_KNOWLEDGE` / `OA_MOS_LIBRARY` | 覆盖集成状态 | `mock` |
| `OA_MOS_SOURCE_INGEST` | 采集开关 | `real` |
| `OA_MOS_TEXT_PROVIDER` / `OA_MOS_IMAGE_PROVIDER` | 模型 Provider | `none` |
| `OA_MOS_EGRESS_ALLOWED_HOSTS` | 出站 allowlist（逗号分隔） | 内置 10 个公开机构域名 |
| `OA_MOS_EGRESS_ALLOW_HTTP` | 允许明文 http（**仅本地验证**） | `false` |
| `OA_MOS_EGRESS_ALLOW_LOOPBACK` | 允许回环（**仅本地验证**） | `false` |

> ⚠ `OA_MOS_EGRESS_ALLOW_HTTP` / `OA_MOS_EGRESS_ALLOW_LOOPBACK` 只供本机端到端测试使用，
> 生产环境必须保持关闭（默认已关闭，即 https-only + 私网/回环一律阻断）。

## 4. Gate 对应关系

| 状态 | 含义 | 当前是否达成 |
|---|---|---|
| **Gate A（BUILD-01）** | 权限、DB 持久化、月计划/Campaign/Topic/资讯采集与 E2E-01/02 通过 | 见 `BUILD-01_TEST_REPORT.md` |
| **Gate D（生产集成）** | 真实 OA/Library/身份/Provider/许可/实际入库与撤回验证 | **未开始** — 必须等 06 §6 阻断清单逐项通过 |

**结论：V0.1 当前为 sandbox 原型。除「外部情报采集」为真实出站请求外，身份、知识库、资料库、模型均未接通真实系统；对外不得宣称生产可用或已具备合规认证。**
