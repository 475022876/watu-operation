# REAL_MOCK_STATUS.md —— 逐服务能力真实/模拟状态

> 对应 `02_MARKETING_OS_CODEX_TASK.md` **Phase M4** 交付项。
> 状态词严格采用 `03_SHARED_CONTRACT_AND_ACCEPTANCE.md` §3 的定义：
> `REAL_VERIFIED` / `REAL_NOT_VERIFIED` / `MOCK` / `NOT_CONFIGURED` / `BLOCKED` / `FAILED`。
> **不得把 `MOCK` 或 `REAL_NOT_VERIFIED` 记为联调 PASS。**
>
> 基线提交 `3c19e79` ｜ 观测时间 **2026-10-13 19:5x（GMT+8）** ｜ 观测环境：本机 `127.0.0.1:9080`，非生产

---

## 1. 总表

| # | 能力 | 实现位置 | **状态** | 版本 / 标识 | 观测时间 | 证据 | 阻断原因 |
|---|---|---|---|---|---|---|---|
| 1 | 企业资料库真实集成（A-06） | `lib/mos/adapters/workspace.js` + `workspace-contract.js` | **`NOT_CONFIGURED`**（未配置）；真实联调 **`BLOCKED`** | 契约 `1.0`；目标 Workspace `1.1.7`（未确认） | 2026-10-13 | 离线契约自检 36/36；`GET /api/mos/workspace/status` → `configured:false`、`realJointTest:"NOT_VERIFIED"` | ① `LIBRARY_HANDOFF_BUNDLE` 未交付 ② 无测试服务地址 ③ 无服务账户 keyId/私钥 ④ 无测试票据 |
| 2 | 企业资料库（沙盒/Mock 网关） | `lib/mos/adapters/library.js` | **`MOCK`** | 回执恒 `MOCK_` 前缀、`assetState:'MOCK_SANDBOX'`、`permissionValid:false` | 2026-10-13 | `e2e03` 套件（94 断言） | — 仅证明**工作流**可跑，**不证明**入库能力 |
| 3 | 企业知识检索 | `lib/mos/adapters/knowledge.js` | **`MOCK`** | 响应带 `sandbox:true, mock:true` | 2026-10-13 | `GET /api/mos/knowledge/search` | 未接真实知识库 |
| 4 | 身份与登录 | `lib/mos/adapters/identity.js` | **`MOCK`** | `mode:"mock"` | 2026-10-13 | `GET /api/mos/identity/status` | 无真实 SSO/MFA |
| 5 | 文本模型（摘要 + 文案草稿） | `lib/mos/adapters/text.js` | **`NOT_CONFIGURED`** | provider `none`（`deepseek` 可配置） | 2026-10-13 | `GET /api/mos/providers/health`；`provider` 套件 21 断言 | **无合法取得的模型凭据** → 真实端到端 `BLOCKED` |
| 6 | 图像模型 | `lib/mos/adapters/image.js` | **`NOT_CONFIGURED`** | provider `none`（`openai` 可配置） | 2026-10-13 | 同上 | 同上 |
| 7 | 外部情报采集（真实出站） | `lib/mos/adapters/source.js` | **`REAL`**（HTTP 抓取路径真实） | — | 2026-10-13 | `sec` 17 断言（SSRF/allowlist/限制） | ⚠ **生产可用性取决于来源许可**（robots/条款），需法务确认；本轮未对公网来源做真实抓取回归 |
| 8 | 情报采集调度（A-01） | `lib/mos/scheduler.js` + `ingest.js` | **`REAL_NOT_VERIFIED`**（代码可用，**默认关闭**） | `scheduler.enabled=false` | 2026-10-13 | `sched` 20 断言（时间桶幂等/退避/有界失败/心跳锁） | 未在真实长期运行下验证；**单实例限制**未解决 |
| 9 | 平台指标 API | 未接通 | **`NOT_CONFIGURED`** | — | 2026-10-13 | Analytics 返回 `available:false` + `missing[]` | 无平台开放 API 授权 |
| 10 | 专业字典（SPECIAL-01） | `lib/mos/dictverify.js` | **`MOCK`→实为"全部待核验"** | 全部 `provisional:true` | 2026-10-13 | `unit` U-21 系列 + `e2e03` DV-01…04 | **权威原件未随包提供** → 保持 `UNVERIFIED` |
| 11 | 品牌 Visual Skill V1.2 | `lib/mos/skill.js` | **`NOT_CONFIGURED`** | 无 APPROVED 版本 | 2026-10-13 | `skill.usability()`：非 `APPROVED` 一律阻断正式输出 | 官方 Skill 原件未提供；**未经人为批准不得标 EFFECTIVE** |
| 12 | OA/资料库「发布成品镜像」 | **明确不提供** | 不适用 | `capabilities.publishedContentArchive=false` | 2026-10-13 | `workspace` WC-27 断言 | 契约 §8：归档只在 Marketing OS |

## 2. 本轮**未发生**的真实调用（诚实清单）

| 类别 | 是否发生真实调用 | 说明 |
|---|---|---|
| 向真实 Enterprise Workspace 发起任何 HTTP 请求 | **否** | 适配器 `configured=false` → 所有方法**零出站**（WC-15/16 断言桩零命中） |
| 调用真实文本/图像模型 | **否** | 无凭据；`NOT_CONFIGURED`，不产出任何"看起来像 AI 生成"的内容 |
| 向真实企业知识库检索 | **否** | `identity/knowledge/library` 均为 `mock` |
| 对公网资讯来源的实时抓取回归 | **否**（本轮） | `sec` 套件的出站用例使用本地隔离桩；生产来源许可未确认 |
| 真实 SSO 登录 | **否** | `MockIdentityGateway` |

## 3. 关键诚实性边界（代码级强制，非文档约定）

1. **Mock 资料库不可能产出正式资产**：`submitAdmission()` 回执固定 `assetId:'MOCK_ASSET_*'` + `assetState:'MOCK_SANDBOX'` + `permissionValid:false`；
   `reuseEligibility` 要求 `approvalMode==='REAL'` **且** `permissionValid` **且** `assetState==='ACTIVE'` → Mock 下**结构性恒 false**，`AVAILABLE` 不可达。
2. **正式检索在 Mock 下恒空**：`searchApproved()` 返回 `items: []` + `note`，不冒充企业正式资产。
3. **未批准 Skill 不得用于正式输出**：`outputIntent` 为**失效关闭**——未识别取值一律阻断，绝不静默降级为测试草稿。
4. **模型未配置时不伪造输出**：作业置 `NOT_CONFIGURED` 并显式失败，不产出任何内容；Mock 产物在**文件内容内**嵌 MOCK 标记。
5. **发布只能是人工登记**：系统内**不存在任何定时器**；`PUBLISHED` 只能由人工提交真实 URL/证据产生，产生瞬间物理快照到 `published/<pubId>/`。
6. **发布归档 ≠ 资料库入库**：`lib/mos/routes/publishing.js` 对 `adapters/workspace`、`adapters/library` **零引用**（已实测 grep）。
7. **服务账户永不可产生最终审批**：`finalDecision()` 结构性恒拒绝，可被自检断言。
8. **AI 外发前先判数据分级**：`RESTRICTED` 在**调用任何 Provider 之前**阻断；未知分级 `400 BAD_DATA_CLASS`，不静默降级。

## 4. 与 `docs/MOCK_REAL_MATRIX.md` 的一致性

本文件与仓库内 `docs/MOCK_REAL_MATRIX.md` **互为印证**，差异仅在于本文件补充了
「本轮新增的 5 项契约符合性修正」（见 `CHANGELOG.md`）与「本机 Workspace 源码静态交叉核验」证据。
**两文件均未将任何 `MOCK`/`NOT_VERIFIED` 项标记为真实联调通过。**
