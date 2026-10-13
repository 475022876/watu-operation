# PHASE 3 —— 资讯、Skill、AI 与真实集成准备

- **对应**：《VFIB Marketing OS V0.1 综合审计整改与架构优化执行包 V1.0》→ `04_PHASED_EXECUTION_AND_HANDOFF.md` §Phase 3
- **整改项**：A-01（轻量来源调度）、F-07（SPECIAL-01 字典核验）、A-05（真实 Provider 契约测试）、A-06（企业资料库适配层）
- **基线**：`watu-operation`（本地 `D:\运营系统\VFIB-Marketing-OS`，远端 `475022876/watu-operation`）
- **完成时间**：2026-10-13
- **结论**：4 项**全部 DONE**；新增 3 个自检套件（20 + 21 + 30 断言）+ 单元 18 断言 + E2E 5 断言；
  真实联调（Provider / Workspace）**如实记 BLOCKED（NOT_VERIFIED）**，未做任何粉饰。

---

## 1. 汇总

| 整改项 | 交付 | 状态 | 关键证据 |
|---|---|---|---|
| **A-01** 轻量来源调度 | `lib/mos/ingest.js`（采集引擎）、`lib/mos/scheduler.js`（调度器）、schema v4 `ingest_jobs`、调度/作业 API、情报页调度面板 | **DONE** | `tools/mos-scheduler-test.js` **20/20**；`e2e03` SCH-API-01…09 |
| **F-07** 字典 provisional 核验 | `lib/mos/dictverify.js`（核验登记 + 覆盖门禁）、`GET /api/mos/dictionaries/verification`、`POST /api/mos/dictionaries/verify` | **DONE** | `unit` U-21…U-21h（8 断言）；`e2e03` DV-01…04 |
| **A-05** 真实 Provider 契约测试 | `lib/mos/providercontract.js`（统一契约面）、text/image 适配器补齐、`GET /api/mos/providers/health`、契约自检套件 | **DONE（离线全过；真实 E2E BLOCKED：无凭据）** | `tools/mos-provider-contract-test.js` **21/21**；`unit` U-22…U-22d |
| **A-06** 企业资料库适配层 | `lib/mos/workspace-contract.js`（逐字节契约）、`lib/mos/adapters/workspace.js`（Ed25519 签名 + 票据 + 11 端点）、`GET /api/mos/workspace/status`、`docs/INTEGRATION_WORKSPACE_CONTRACT.md` | **DONE（离线契约全过；真实联调 NOT_VERIFIED）** | `tools/mos-workspace-contract-test.js` **30/30**；`unit` U-23…U-23e |

**未把任何 MOCK 改成 REAL**；`docs/MOCK_REAL_MATRIX.md` 的 mock/real 边界保持不变。
**未新增任何 MARK 类能力**（S05 客户增长 / 品牌声誉专项 / 营销线索移交 / 视频渲染 / 社媒自动发布）。

---

## 2. A-01 轻量来源调度

### 2.1 设计约束（对应整改原文）

| 原文要求 | 实现 |
|---|---|
| 服务端可配置 cron-like 间隔 | `config.scheduler.intervalMinutes`（默认 60，可经 `MOS_SCHEDULER_INTERVAL_MINUTES` 覆盖） |
| 任务记录 | 新集合 `ingest_jobs`（每个来源每次执行一条；含 `status/startedAt/finishedAt/failureCode/failureReason/nextRunAt/backoffMs/bucketKey`） |
| 失败退避 | 指数退避 `base * 2^(n-1)`，上限 `backoffCapMs`；**并有 `maxFailures` 硬上限**（达到即停自动重试并置来源 `ERROR`） |
| 去重 | ① 时间桶幂等（同来源同桶只执行一次，**跨进程重启仍生效**，桶键随作业持久化）；② 内容级去重（`canonicalUrl` + 内容 digest） |
| 开关 | `config.scheduler.enabled`（**默认 false**）+ 运行时 `POST /api/mos/ingest/scheduler {enabled}`（需 `source.manage`） |
| 锁 | `db.settings.ingestLock` 心跳锁；检测到**他实例新鲜心跳**时本轮拒绝执行并如实上报 `LOCK_HELD_BY_OTHER_INSTANCE` |
| 默认手动或保守频率 | 默认 **关闭**；开启后仅调度 `ACTIVE` + 频率非 `MANUAL` + 域名在出站白名单内的来源 |
| 仅授权 allowlist 来源 | 复用 Phase 1 的 `egress.allowedHosts`；白名单外主机一律 `HOST_NOT_ALLOWLISTED`（永久失败，不重试） |
| 多实例必须避免重复执行 / 若架构不支持则明确单实例限制 | 本系统为**单文件 JSON 存储 → 明确只支持单实例**：心跳锁阻止第二实例同时采集；`config.scheduler` 注释与 README 均**显式声明单实例限制**，不假装支持多实例 |

### 2.2 失败分类（自审 B06-01 修正后）

- **永久失败**（不自动重试）：`SSRF_BLOCKED`、`HOST_NOT_ALLOWLISTED`、`PORT_NOT_ALLOWED`、
  `PROTOCOL_NOT_ALLOWED`、`BAD_URL`、`MANUAL_ONLY`、`NO_ENDPOINT`、`NO_EGRESS_ALLOWLIST`、
  `SOURCE_DISABLED`、`SOURCE_PENDING_VERIFICATION`、`INTEGRATION_PENDING`。
- **瞬时失败**（进入退避）：`TIMEOUT`、`FETCH_FAILED`、`PARSE_FAILED`、`HTTP_ERROR`、
  `BODY_TOO_LARGE`、`DNS_FAILED`、`RATE_LIMITED`。
- **未知失败码**：按**瞬时**处理（避免把可恢复问题误判为永不再试），
  但受 `maxFailures` 约束 → **重试有界，不可能无限重试**。这一取舍已写入代码注释与本节。

### 2.3 新增/变更 API

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `GET` | `/api/mos/ingest/scheduler` | `source.manage` | 调度状态 + 限额 + 到期预览（**只读，不触发任何执行**） |
| `POST` | `/api/mos/ingest/scheduler` | `source.manage` | 开关自动调度（非法取值 400 `BAD_ENABLED`，不做宽松解析） |
| `POST` | `/api/mos/ingest/scheduler/tick` | `source.manage` | 手工触发一轮巡检（同一套锁/去重/退避） |
| `GET` | `/api/mos/ingest/jobs` | 品牌可见 | 采集作业历史（失败理由原样返回） |
| `POST` | `/api/mos/sources/:id/ingest` | `source.manage` | 单来源采集（**改走统一 `ingest` 引擎**；未核验来源 fail closed） |

### 2.4 UI

情报页新增「采集调度」卡片：状态 / 间隔 / 单轮上限 / 连续失败上限 / 本轮巡检次数 / 最近巡检时间 /
到期预览；提供「开启/关闭」「立即巡检」按钮；来源详情增加「作业历史」表（`status` 徽标 + 失败码 + 退避时间）。
调度失败的文案**原样展示**，不美化。

---

## 3. F-07 字典 provisional 核验

### 3.1 问题（自审 B06-04，Phase 2 遗留）

Phase 2 之前，`config.json` 只要给一个字符串标签，`helpers.dictionaries()` 就把该条目写成
`provisional:false / source:'config'` —— 等于**用一行配置把「待核验」洗成「正式」**，
正是整改主控明令禁止的「不能凭 AI 创作/猜测填成正式标签」。

### 3.2 修正

新增 `lib/mos/dictverify.js`：

- **登记表**：`provisional` 项逐一登记（键、码、归属权威原件、状态）。
- **覆盖门禁 `applyOverrides()`**：配置覆盖**只改显示名**，条目**仍为 `provisional:true`**；
  缺 `sourceVersion` + `evidenceRef` 一律**拒绝**，并把拒绝原因写进覆盖审计。
- **运行时核验 `verify()`**：必须同时提供 `sourceVersion`（如 `SPECIAL-01@V1.1`）与 `evidenceRef`（证据引用）
  才可把条目置为 `VERIFIED`；核验记录写入 `db.settings.dictionaryVerifications`，可汇总、可撤销。
- **两个权威原件**（SPECIAL-01 V1.1、Visual Skill V1.2）在本轮**未随包提供** → 登记表
  `providedToDev:false` **如实声明**，全部条目保持 `UNVERIFIED`，标签显示「待核验」。

### 3.3 新增 API

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/mos/dictionaries/verification` | 待核验项登记表 + 汇总 + 覆盖审计 |
| `POST` | `/api/mos/dictionaries/verify` | 登记一次核验（缺证据 → 400 `MISSING_SOURCE_VERSION` / `MISSING_EVIDENCE_REF`） |

**绝不臆造官方标签**：未取得原件前，UI/API 一律显示「待核验」。

---

## 4. A-05 真实 Provider 契约测试

### 4.1 契约面（04 §6）

新增 `lib/mos/providercontract.js`，把文本与图像 Provider 收敛到**同一套字段名**：

| 契约面 | 实现 |
|---|---|
| `status()` | 离线只读配置：provider / mode / configured / hasServerKey / timeoutMs（**不含密钥**） |
| `health()` | 未配置 → `NOT_CONFIGURED`（零出站）；mock → `MOCK`；真实供应商无密钥 → `NOT_CONFIGURED` |
| `invoke()` | 统一入口（文本 `summarize`/`draft`；图像 `generate`）；未知 op **明确报错**，不静默降级 |
| `timeout` | `AbortController` 硬超时（`text.timeoutMs` / `image.timeoutMs`）→ 归类 `PROVIDER_TIMEOUT` |
| `rateLimit` | 从响应头解析 `x-ratelimit-*` / `retry-after`；缺失一律 `null`（**不臆测配额**） |
| `costReceipt` | 只认供应商**显式回执**；无回执 → `amount:null, confirmed:false`（**不做换汇/单价推算**） |
| `errorCode` | `PROVIDER_NOT_CONFIGURED / TIMEOUT / RATE_LIMITED / HTTP_ERROR / BAD_REQUEST / NETWORK_ERROR / EMPTY_RESPONSE / BLOCKED_DATA_CLASS / UNKNOWN_MODE`，并给出 `retryable` |

### 4.2 三层自检（`tools/mos-provider-contract-test.js`，21 断言）

| 层 | 内容 | 是否依赖真实凭据 |
|---|---|---|
| **L1 离线诚实性** | 未配置 → `NOT_CONFIGURED` 且**零出站**；密钥不外泄；契约纯函数正确；MOCK 产物醒目标注；受限内容拒发 | 否（始终运行） |
| **L2 本地桩契约验证** | 指向**本机桩服务**，逐条验证成功路径 / 429 / 5xx / 超时 / 空响应 / usage / rateLimit / costReceipt 的**真实行为** | 否（始终运行） |
| **L3 真实端到端** | 仅当 `MOS_PROVIDER_LIVE=1` **且**提供 `MOS_REAL_TEXT_API_KEY` / `MOS_REAL_IMAGE_API_KEY` 时调用真实供应商并落原始回执 | **是** |

> **当前状态**：L1 + L2 全过（21/21）；**L3 未执行** —— 无供应商凭据/授权，
> 证据文件 `provider-contract-result.json` 中如实记录 `liveRequested:false` 与
> `notes: ["L3 未执行……**未对任何真实供应商做过端到端验证**（BLOCKED：无凭据/未授权）"]`。
> **不阻断纯本地原型构建**：无凭据时套件仍全绿。

### 4.3 新增 API 与配置

| 项 | 说明 |
|---|---|
| `GET /api/mos/providers/health` | 文本/图像 Provider 的 status + health + 错误码表（**不含任何密钥**） |
| `config.mos.text` / `config.mos.image` | `apiKey` / `baseUrl` / `model` / `timeoutMs`（支持自托管网关与离线契约测试） |
| `GET /api/mos/generation-jobs` 的 `capability` | 追加 `imageHealth` / `textHealth` |

---

## 5. A-06 企业资料库适配层

### 5.1 契约来源（**与最新版源码一致**）

| 契约要素 | 来源（Enterprise Workspace V1.1.7） |
|---|---|
| 签名与规范串 | `lib/integration/service-accounts.js` → `canonicalString()` / `sha256Hex()` / `SCOPES` |
| 票据与 scope 剔除 | `lib/integration/tickets.js` → `SCOPES` / `SESSION_ONLY_SCOPES` / `serviceGrantable()` |
| 端点与统一封套 | `lib/routes/integrations.js` → `respond()` / 12 个 `integ(...)` 注册项 |
| 契约正文 | `INTEGRATION_API_CONTRACT.md`（契约 `1.0`） |

### 5.2 交付物

- **`lib/mos/workspace-contract.js`**：`canonicalString()`（逐字节）、`sha256Hex()`、`EMPTY_BODY_HASH`、
  `signedHeaders()`、`verifySigned()`、封套校验/解析、**49 条错误码表**（分层 + 可重试）、
  12 端点表、scope 表、事件流常量、准入状态机常量、「不做」边界。
  其中 `signedHeaders()` **遇到 `pathname` 含 `?` 直接报错**（契约 §1.1 第 2 点的结构性防线）。
- **`lib/mos/adapters/workspace.js`**：Ed25519 签名 + 受限票据 + 11 个业务方法 + `issueServiceTicket`；
  `finalDecision()` **结构性恒拒绝**（服务账户无最终审批权）；
  `status()` 只报布尔与主机名（**绝不回传私钥/票据**）；未配置 → 一切方法
  `INTEGRATION_NOT_CONFIGURED` 且**零出站**（fail closed）。
- **`docs/INTEGRATION_WORKSPACE_CONTRACT.md`**：契约要点、启用步骤、失败处理、诚实性声明。
- **`GET /api/mos/workspace/status`**：只读状态 + 能力声明（`realJointTest: NOT_VERIFIED`）。

### 5.3 离线契约自检（`tools/mos-workspace-contract-test.js`，30 断言）

| 层 | 关键断言 |
|---|---|
| L1 契约常量 | WC-01 规范串格式；WC-02 `sha256('')` 固定值；WC-03 query 不参与签名（报错）；WC-04 禁止重新序列化；WC-05 错误码表；WC-06 端点数 12（含源码中 `skills/:id`）；WC-07/08 scope 与剔除；WC-09/10 封套 |
| L2 签名互通 | WC-11 本侧签名可由**服务端同构** `crypto.verify(null,…)` 通过；WC-12 任一要素变化即验签失败；WC-13 nonce 唯一 |
| fail closed | WC-14/15/16 未配置或私钥非法 → `configured:false`、**桩零命中**、恒 `INTEGRATION_NOT_CONFIGURED` |
| L3 本地桩 | WC-17…WC-30：真实桩**重建规范串并验签**、防重放；GET query 不参与签名；`410 ASSET_GONE` / `404 NOT_FOUND` / `409 FINAL_APPROVAL_REQUIRED` / `401 BAD_SIGNATURE` 的分层与可重试映射；票据剔除；密钥/票据不外泄 |

**诚实性**：证据文件 `workspace-contract-result.json` 中 `realJointTest: "NOT_VERIFIED"`，
并注明「**未与真实 Enterprise Workspace 发生任何联调**」。

---

## 6. 数据库迁移与回滚

### 6.1 迁移（schema v3 → v4）

- **新增 1 个顶级集合**：`ingest_jobs: []`（其余 16 个集合与全部既有字段**零改写**）。
- `store.migrate()` 对 `mosSchemaVersion < 4` 的库补空数组并推进版本号；**幂等**（二次迁移报告无变更）。
- **不预置任何作业记录**（不伪造历史）。`ingest_jobs` 为空是正常初始状态。

### 6.2 回滚

停服后二者任选其一：

1. 还原 `data/mos.json.bak-*`（系统自动备份）；
2. 编辑 `data/mos.json`：删除 `ingest_jobs` 字段，并把 `mosSchemaVersion` 改回 `3`。

v3 代码不引用 `ingest_jobs`，可继续读取该库（`settings.dictionaryVerifications` 亦为可选子字段，
缺失时字典回落到「全部待核验」语义）。**不需要**任何额外的数据修复脚本。

---

## 7. 测试与证据

### 7.1 新增套件

| 套件 | 文件 | 断言 | 证据 |
|---|---|---|---|
| `sched` | `tools/mos-scheduler-test.js` | 20 | `TEST_EVIDENCE_MOS_BUILD01/scheduler-result.json` |
| `provider` | `tools/mos-provider-contract-test.js` | 21 | `TEST_EVIDENCE_MOS_BUILD01/provider-contract-result.json` |
| `workspace` | `tools/mos-workspace-contract-test.js` | 30 | `TEST_EVIDENCE_MOS_BUILD01/workspace-contract-result.json` |

统一入口：`bash tools/run-mos-tests.sh {sched|provider|workspace|all}`。

### 7.2 存量套件增补

| 套件 | 增补 |
|---|---|
| `unit` | U-19 系列更新为 schema v4；U-21 系列（F-07，8 断言）；U-22 系列（A-05，4 断言）；U-23 系列（A-06，5 断言） → **69** 断言 |
| `e2e03` | SCH-API-05…09（调度 API + RBAC）；DV-01…04（字典核验）；A05-01/02、A06-01…04 → **94** 断言 |
| `ui` | 情报页调度面板渲染与「立即巡检」结果保留 → **97** 断言（`UI_EVIDENCE_MOS_BUILD05/`） |

### 7.3 全量回归（Phase 3 收口）

```
汇总：472/472 断言通过（全部套件通过）
[run-mos-tests] 全部套件通过：smoke unit sec sched provider workspace e2e e2e02 e2e03 ui
```

各套件：smoke 13、unit 69、sec 17、sched 20、provider 21、workspace 30、
e2e 48、e2e02 63、e2e03 94、ui 97 —— **零回归**（Phase 2 的 357 断言全部保留且通过）。

---

## 8. 自审缺陷日志（本阶段发现并修复）

| 编号 | 缺陷 | 影响 | 修复 |
|---|---|---|---|
| **B06-01** | `ingest.js` 的失败码白/黑名单不完整，未列出的码会被**误分类**（把可恢复问题当永久、或反之） | 可能导致永久失败被无限重试，或瞬时失败永不重试 | 改为**未知码按瞬时处理**（安全侧），并新增 `maxFailures` 有界约束；分类逻辑与注释同步 |
| **B06-02** | `ingest.js` 的 `nextRunAt` 使用 `Date.now()` 墙上时钟，而调度器自身走**注入时钟** | 测试可见的时间语义不一致（退避与巡检判定基准不同源） | 统一改用注入的 `now` 时钟 |
| **B06-03** | 阻断路径把 `status='ERROR'` 的来源**误报**为「许可待核验」 | 运维被误导（真实原因其实是出站被拒） | 按 `source.status` 分派准确失败码与文案 |
| **B06-04** | `helpers.dictionaries()` 允许**一行配置把「待核验」洗成正式标签** | 违反「不得凭猜测填成正式标签」红线（Phase 2 遗留） | 走 `dictverify.applyOverrides()`：无证据只改显示名、保持 `provisional:true`，并写入拒绝审计 |
| **B06-05** | 情报页「立即巡检」成功后又调用整体 `renderSources()`，**抹掉了自己的结果提示** | 用户看不到巡检结果（误以为没执行） | 结果写入独立的 `#schedOut`，不再触发整体重渲染 |
| **B06-06** | `e2e03` 的 GOV-06 仍断言 schema `v3` | 迁移到 v4 后该断言必然失败 | 更新为断言 `v4`（只增不改的版本推进） |
| **B06-07** | 新增的 SCH-API-09 断言前提**错误**：`NOBODY` 账号实际持有 P4（含 `source.manage`） | 断言必然失败，且误导「权限边界已测」 | 改用真正不含该权限的 `cPublisher` 主体 |
| **B06-08** | A05-01 断言写成 `errorCodes.PROVIDER_TIMEOUT`（把**值**当**键**） | 断言恒失败 | 改为 `errorCodes.TIMEOUT === 'PROVIDER_TIMEOUT'` |

> 说明：B06-01/02/03/05 是**本轮新代码自身的真实缺陷**（被自检捕获），B06-04 是 Phase 2 遗留的真实缺陷，
> B06-06/07/08 是**测试自身的缺陷**。全部已修复并回归通过。

---

## 9. 未完成 / BLOCKED 事项

| 项 | 状态 | 说明 |
|---|---|---|
| 真实文本/图像 Provider 端到端调用 | **BLOCKED** | 无供应商凭据与授权。契约面与本地桩验证已完成；启用方式见 `.env.example` 与 §4.3 |
| 与真实 Enterprise Workspace 联调 | **NOT_VERIFIED** | 无可用服务与凭据。适配层与**离线契约自检**已完成；启用方式见 `docs/INTEGRATION_WORKSPACE_CONTRACT.md` |
| SPECIAL-01 V1.1 / Visual Skill V1.2 原件核验 | **BLOCKED** | 两份权威原件**未随包提供**；登记表已如实声明，全部条目保持「待核验」 |
| 多实例采集 | **NOT_APPLICABLE（本轮）** | 单文件 JSON 存储 → **明确单实例**；心跳锁阻止并发采集；多实例属生产化议题 |
| 生产部署 | **未执行** | 遵循「未经批准不得部署生产环境」 |
