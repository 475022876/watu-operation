# CHANGELOG — VFIB Marketing OS（运营中台）

本文件记录**应用版本**（`package.json` / `lib/mos/config.js` 的 `MOS_VERSION`）的变更。
接口契约版本（当前 **1.0**）与整改执行包编号（V1.2 等）是**另外两条轴线**，不随应用版本变动。

---

## [0.1.3] — 2026-10-14 — Real AI Research & Employee UX Remediation（执行包五阶段）

**基线**：`7001475`（应用版本 0.1.2，schema v7）
**目标/实际版本**：`0.1.3`（执行包 `VFIB_Marketing_OS_V0.1.3_AI_Research_UX_Remediation_Codex`，7 文件 + SHA256_MANIFEST 核验一致）
**schema**：**仍为 v7** —— 本版**零新集合**，只在既有集合上增字段（`research_jobs` 增 `blockedEvent` 等）
**接口契约**：**1.0 不变**

### Phase 0 — 源码影响核验与基线（`6df37ba`）

- `reports/PHASE0_BASELINE.md`：逐条核实执行包「现状」描述与源码是否一致，输出差异表；
  导航/路由/权限/研究适配器/任务-审核-发布关系的基线截图与点击路径统计（`UI_EVIDENCE/PHASE0/`）。

### Phase A — 一站式任务空间与交互减法（`31d292a`）

- `content-editor` 由「内容编辑器」升级为**制作工作台**（模块 id 不变 → 深链接与既有测试零破坏）：
  顶部固定任务头（标题/品牌/平台/状态/保存状态/截止）、左栏 Brief+已审研究+上级备注、
  中间「正文｜图片｜视频｜审核」**在任务内**切换、右栏交付物与下一步；不再跳出任务重新选主题。
- 新后端 `lib/mos/routes/studio.js`；新前端 `lib/mos/modules/studio.js`。
- 新套件 `studio`（`tools/mos-e2e-v013-studio.js`）**29/29**；`ui` 套件 110→**111**；
  证据 `UI_EVIDENCE/PHASEA/`（17 截图 + steps.json，18 步）；报告 `reports/PHASE_A_UX.md`。

### Phase B — 真实授权搜索、受限网页读取、证据链与结构化研究作业（`b9edea8`）

- **`lib/mos/adapters/websearch.js` 重写**：供应商注册表（`none/searxng/brave/bing/google/tavily`），
  **不写死供应商**；`providerStatus()` 输出 `readiness`；预算门禁、429/5xx 退避重试、脱敏 trace。
- **`lib/mos/research-fetch.js`（新）**：受限网页读取——复用连接层 SSRF、二进制拒绝、体积/超时上限、
  不可信内容边界包裹（`<<<UNTRUSTED_EXTERNAL_CONTENT …>>>`）。
- **`lib/mos/research-engine.js`（新）**：异步研究作业 `QUEUED→SEARCHING→FETCHING→VERIFYING→ANALYZING→DONE`；
  jobId/进度/**取消**/重试/**幂等（actor+brand+payloadHash，冲突 409）**；`EV-n` 证据句柄解析。
- **诚实性红线（不得回退）**：`RETRIEVAL_ONLY` 与 `AI_RESEARCH_COMPLETE` 同源写入、降级**绝不**冒充完成；
  计费型供应商无预算 → **零出站**；MOCK 通道**拒绝**产出研究结论；FACT 无证据强制降级为 INTERPRETATION。
- 同步 `/api/mos/research/web` 改走同一作业管线，并保留既有 `research.web_blocked` 审计事件。
- 新套件 `research013`（`tools/mos-e2e-v013-research.js`）**79/79**；证据 `TEST_EVIDENCE_MOS_V013_RESEARCH/`、
  `REAL_PROVIDER_EVIDENCE/`；报告 `reports/PHASE_B_REAL_RESEARCH.md`。

### Phase C — key-based 双语、不可翻译保护、品牌减法与 Provider 就绪度（`ab2af8b`）

- **i18n 重写为 key-based**：新增 `public/mos/i18n/zh-CN.js` / `en-US.js`（**各 451 键，一一对应**）；
  `t(key, params)` 支持 `{name}` 插值；11 个统一映射函数（状态/错误码/就绪度/完成度/作业阶段/
  证据缺口/结论类型/网页可读性/交付物/用途/视觉类型）；`bindDom()` 取代全局 DOM 文本匹配。
- **不可翻译节点保护（V0.1.2 完全缺失的真实缺陷）**：`data-notranslate` + `input/textarea/select/option/
  pre/code/script/style/samp/kbd/contenteditable`，逐节点判定且**向下继承**——用户输入、已保存正文、
  AI 原始研究结果、引用原文、URL、上传文件名、日志在英文界面保持原样（真实浏览器 LANG-01a…l **12/12**）。
- `ApiError.message` 经统一错误码映射（服务端原文保留在 `rawMessage`），既有 122 处调用点单点生效；
  `ui.js` 的重复中文状态表改为委托 i18n 资源。
- 语言切换按 `hasUnsaved()` 决定是否重渲染 → **不丢编辑状态**，且只写账户偏好接口。
- **品牌减法**：配图对话框只暴露 品牌/平台/用途/视觉类型/画面说明 + **实时效果预览**；
  模板收进折叠「高级」，无 `#rrggbb` 色号、无 Prompt/供应商输入项。
- **Provider 就绪度**：`image.status().readiness`（MOCK **不计为 REAL**）+ 新 `videoStatus()` =
  `NOT_IMPLEMENTED`（本轮**不做** AI 成片）；集成矩阵新增 `videoProvider`。
- 新套件 `i18n`（`tools/mos-i18n-check.js`）**21/21**；`ui` 111→**123**；`provider` 新增 PC-06a…e。
- 证据 `UI_EVIDENCE/PHASEC/`（24 图 / 23 步、0 控制台错误）；报告 `reports/PHASE_C_CONTENT_I18N.md`。
- 本阶段首次真实浏览器证据即抓到真实缺陷：`studio.js` 使用 `purposeLabel()` 却未导入
  （`node --check` 无法发现，仅浏览器报 `ReferenceError`），修复后固化为 `I18N-16` 断言。

### Phase D — 全量回归、迁移/安全/回滚与 0.1.3 版本登记（本提交）

- 应用版本统一升级 **0.1.3**：`package.json`、`lib/mos/config.js`（`MOS_VERSION`）、`lib/config.js`
  （`appVersion`）、`public/mos.html`（侧栏显示）、`/api/mos/meta`、测试元数据。
  新增 `VER-01/VER-02` 断言强制五处版本一致（禁止"只改包名"或"改了包名不改显示"）。
- **零迁移**：schema 仍 v7（`docs/MIGRATION_AND_ROLLBACK.md` 结论：**0.1.3 无需数据迁移**）。
- **`joint` 4 项失败断言逐一处置（无跳过、无隐瞒）**：
  - `D4-15`/`D4-15b`：原断言从 `/api/mos/integration/workspace` 读枚举明细，但该端点只暴露
    sha256 + 端点摘要 → 改为读权威端点 `/api/mos/integration/contract`，并交叉校验两端点 sha256 一致。
  - `D4-26`：**测试夹具缺陷**（漏了 Provider 必填的 `reuseScope`/`externalAiTransferPolicy`）导致
    预检 FAIL → 送审 409 → 用例**到不了目标代码路径**的假失败；补齐夹具并新增 **`D4-26a` 夹具完整性守卫**。
  - `D4-44`：遗留硬编码 `schemaVersion===5`（v5 是 BUILD-04 时代基线）→ 改为「不低于集成态基线 v5
    且 接口值 = 模块常量」，避免每次升版假失败。
  - 复跑：**`joint 66/66`**。
- **修复两处证据链缺陷**（本版真实缺陷）：① `studio` 证据文件名与汇总器不一致 → **29 条断言被静默漏统计**
  （全量 895 → **924**）；② `summary.json` 头部元数据仍写 0.1.1 → 已改 0.1.3。
- **0.1.2 登记行证据勘误**：其 `joint 64/64` 引用的是**更早一版脚本产出的陈旧证据**（明细串不同且缺
  `D4-15b`），已在 `docs/RELEASE_REGISTER.md` 如实回填，**未删改历史证据文件**。
- 最终口径：`all` **16 套件 797/797** ｜ `joint` **66/66** ｜ `build06` **61/61** ｜ 汇总 **924/924（18 套件）**。
- 交付 `reports/FINAL_ACCEPTANCE_V0.1.3.md`、`reports/OPEN_ITEMS_V0.1.3.md`（**BLOCKED 一律不记 PASS**；
  终裁 **CONDITIONAL**，**不部署生产**，无任何 `PASS_REAL`）。


**基线**：`2fe3841`（应用版本 0.1.1，schema v5）
**目标/实际版本**：`0.1.2`（执行包 `VFIB_Marketing_OS_V0.1.2_AI_Intelligence_Task_Driven_UX_Codex_Pack`，8 文件 SHA256 核验一致）
**schema**：v5 → **v7**（只增不改、幂等迁移）

### Phase 0 — 基线与影响分析（`ee6383d`）

- `PHASE0_BASELINE_AND_IMPACT.md`：导航映射（旧 8 中心→新 5+2，**模块 id 全部不变**→深链接零破坏）、
  ~100 API 端点盘点、迁移策略、6 条红线、BLOCKED 边界（LLM 无凭据 / Web Search 未接凭据 /
  SPECIAL-01 原件未随包 / Skill 待真人审批）。

### Phase A — 任务驱动 UX 与中英双语（`9fca396`）

- **导航重构**：5 主（工作台/策划与情报/内容制作/发布管理/运营分析）+ 2 辅（品牌与素材/审批与管理，按角色可见）；
  20 个模块 id 不变。
- **i18n**：`public/mos/js/i18n.js`——中文为源语言，en-US 精确字典；`t()/applyDom()` + MutationObserver
  异步翻译；语言偏好**服务端持久化**（`PUT /api/mos/auth/preferences`，白名单 zh-CN/en-US）。
- **员工任务工作台**：`my-work` 扩展 `dueThisWeek`/`continueTask`；
  `PUT /api/mos/my-work/continue {taskId}` 服务端继续锚点（越权 403+审计）；`#/content-editor?task=<id>` 深链接。
- schema v6：`users[].prefs = {locale, lastTaskId}`。
- ui 套件 106→**110**（7 项导航断言 + 4 项双语断言）。

### Phase B — AI 情报研究与候选选题（`3a372e3`）

- schema v7：新增 `research_reports` / `research_findings` / `source_evidence` / `topic_proposals` / `research_jobs`。
- **`lib/mos/adapters/websearch.js`（新）**：无凭据一律 `{blocked:true, code:'NOT_CONFIGURED'}`——
  **零伪造发现**；`assertSafeUrl()` SSRF 字面校验（仅 https / 拒私网环回保留段 / 拒内网主机名 / 仅 443）。
- **TRUSTED_DAILY 每日汇编**：从**真实采集** `source_items` 汇编（白名单出站），生成 SourceEvidence
  （contentHash 可追溯）+ FACT 发现（UNVERIFIED 起步）；空库如实空报告。
- **Proposal 状态机**：`AI_RECOMMENDED→PENDING_EDITORIAL_REVIEW→APPROVED/REVISION_REQUESTED/ON_HOLD/REJECTED`；
  新权限 `research.create`（P1/P2/P4）、`editorial.approve`（仅 P1）；P1 一屏审核（6 字段可改，
  editDiff 落审计）；**发现无证据强制 NEEDS_VERIFICATION（fail-closed）**；
  SPECIAL-01 适配：C06 缺公告授权 / C01、C03 缺正式依据 → 待核验且**批准不洗白**。
- 前端情报资讯新增「AI 研究」「选题建议」页签（BLOCKED 如实展示 / 报告证据抽屉 / P1 审核弹窗）。
- 新套件 `research`（tools/mos-e2e-v012-research.js）**55/55**。

### Phase C — 编辑域派工与制作空间（`035e959`）

- **批准入池** `POST /api/mos/topic-proposals/:id/approve-to-pool`：正式 Master Topic
  （`APPROVED_UNSCHEDULED`，与既有四态并存）+ 证据如实链接（不可回溯的发现计入 skipped，不伪造）。
- **批准并安排** `POST /api/mos/topic-proposals/:id/approve-and-schedule`：**幂等 Saga**——
  fail-fast 全量校验（平台/负责人/日期）→ 内存原子变更 → **单次落盘**（绝不出现「审批成功但派工缺半」）；
  `idempotencyKey` 全局唯一（重放返回快照，零新增）；自动创建月度计划（`autoBySaga` 审计）；
  每平台独立 ContentTask + PlanItem。
- **同源视图** `GET /api/mos/editorial/views?view=day|week|month`：同一 PlanItem/Task 数据源过滤聚合，
  不存在第二套计划；`/api/mos/calendar` 新增 `day` 视图。
- Topic 状态机新增 `APPROVED_UNSCHEDULED→PLANNED→ASSIGNED`。
- 前端：提案抽屉三固定操作；内容编辑器四标签工作空间条（Brief/Content/Visuals/Review）。
- 新套件 `editorial`（tools/mos-e2e-v012-editorial.js）**43/43**。

### 全量回归

- **773/773**（13 套件：smoke unit sec sched provider workspace dual e2e e2e02 e2e03 ui research editorial），升版后复跑全绿。
- 交付文档：`PHASE0_BASELINE_AND_IMPACT.md`、`PHASE_A_UI_AND_I18N_REPORT.md`、
  `PHASE_B_AI_INTELLIGENCE_REPORT.md`、`PHASE_C_TASK_WORKFLOW_REPORT.md`、
  `SPECIAL01_SOURCE_MAPPING.md`、`PROVIDER_REAL_MOCK_MATRIX.md`、`SECURITY_REGRESSION_REPORT.md`、
  `E2E_RUN_LOG.md`、`MIGRATION_AND_ROLLBACK.md`、`FINAL_ACCEPTANCE_V0.1.2.md`、`UI_SCREENSHOTS/`。

### 边界与红线（未变）

- 未改企业资料库源码；共享契约 1.0 未动；未建平行账本；四类审批分离；
  S05/声誉专项/线索闭环/U CARD 代理后台**不建设**；**未部署生产**。
- Web Research / 文本·图像 Provider 无凭据 → BLOCKED，不以 Mock 冒充真实；
  41 项 provisional 字典项待 SPECIAL-01 原件核验。

---

## [0.1.1] — 2026-10-13 — V1.2 整改（真实 HTTP 安全负例 + 正式输出门禁）

**基线**：`259a91d`（应用版本 0.1.0，schema v5）
**目标/实际版本**：`0.1.1`（本版**确有应用代码变更**，非仅测试变更，故按 V1.2 要求升版）

### 新增（应用代码）

- **`lib/mos/formalguard.js`（新增，约 200 行）** —— 正式输出门禁的**唯一权威判定**。
  实现 V1.2 B1「Revoked / Deprecated / 权限撤销 / Skill 失效**不得继续生成新正式作品**」：
  - `SKILL_NOT_EFFECTIVE`：正式输出必须落在**已批准生效**的品牌 Skill 上；
    `REFERENCE_ONLY` 只允许测试草稿，不得冒充正式依据。
  - `BRIEF_NOT_READY`：关联 Campaign 的 Marketing Brief 存在未核验宣称/引用时不得正式输出。
  - `LIBRARY_REF_NOT_REUSABLE`：引用的资料库资产当前不可复用
    （已撤回 / 已废止 / 权限撤销 / 非 ACTIVE / 权限未核验通过）。
  - `LIBRARY_REF_INVALIDATED`：该引用已被事件消费登记为**本地失效**。
  - `LIBRARY_REF_NOT_FOUND`：引用在本侧未登记（不猜测、不放行）。
  判定复用 `admissionlib.reuseEligibility()` 与 `skill.usability()`，**不重复实现**可复用规则。

- **`POST /api/mos/formal-output-check`（新增端点）** —— 只判定、不产出、不出站、不落盘；
  与生成端点**共用同一份** `formalguard.evaluate()`，避免「门禁放行、生成阻断」不一致。

- **`lib/mos/workspace-client.js`：安全类拒绝的可观测性**
  - 新增 `SECURITY_REJECTION_CODES`（28 项）与 `securityRejections` 计数；
  - `status().securityRejections` 暴露 `total / byCode / last`（进程内；**不含任何凭据材料**）；
  - `callWithTicket()` / `ensureTicket()` / `health()` 全部纳入记录。

### 修改（应用代码）

- **`lib/mos/routes/creative.js`** —— `POST /api/mos/generation-jobs` 在**任何出站与落盘之前**
  执行正式输出门禁：
  - **TEXT 与 IMAGE 一视同仁**。此前只有 IMAGE 走 `skill.buildPrompt()`，
    **TEXT 的 `outputIntent` 从未被校验** —— 正式文字作品可越过 Skill 门禁（真实缺陷）；
  - 阻断返回 `409 FORMAL_OUTPUT_BLOCKED`，并附结构化 `blockers[]`；
  - 未识别/空 `outputIntent` 一律 fail-closed 阻断（与 `skill.normalizeIntent()` 同源）。
- **`lib/mos/skill.js`** —— 导出 `normalizeIntent` / `INTENT_ALIASES`（**单一来源**，
  供门禁复用，杜绝第二处实现产生的不一致）。**行为未变**。
- **`lib/util.js`** —— `sendError()` 结构化详情新增 `blockers[]` / `intent` 白名单透传
  （仅 code/note/refId/libraryId/skillState，长度受限，不含机密）。
- **版本三处同源升级**：`package.json`、`lib/config.js` 的 `appVersion`、
  `lib/mos/config.js` 的 `MOS_VERSION`；UI 侧 `public/mos.html` 与 `public/mos/js/app.js`
  的回退字面量同步。

### 新增（测试与证据）

- **`tools/mos-e2e-build06-dual.js`（新增，约 960 行）** —— 双进程**真实 HTTP** 安全负例：
  - **INT-02**：过期签名（±窗口两侧）、**nonce 原样重放**、**服务账号撤销**（撤销前 200 → 撤销后 401）、
    公钥轮换后旧私钥立即失效、伪造签名对照；
  - **INT-03**：跨品牌（体/票据不一致 → 403 `BRAND_MISMATCH`；票据品牌不在允许清单 → 403 `BRAND_NOT_ALLOWED`;
    同一资产 VFIB 可解析 / UCARD 403 `NOT_REUSABLE_FOR_SUBJECT`;跨品牌检索结果隔离）、
    高密级资料（executive）对非提权主体不可见 + 高管身份可见的**两面向**验证；
  - **服务端审计证据**：直接读取 **Provider 隔离实例自己的 `db.json`**，
    逐条核对 `integration-call` 审计行的 `code` / `status` / `ok=false`；
  - **B1 端到端门禁**：MOS 侧真实准入 → 取得正式 Asset ID → Provider 撤回 →
    事件消费 → 本地引用失效 → **FORMAL 生成被 409 阻断、TEST_DRAFT 不阻断**；
  - **服务账号撤销后的 MOS 侧**：探测**全部失败且无一条 `ok=true`**（不静默成功）。
- **`tools/run-mos-tests.sh`** —— 新增 `build05` 套件入口。

### 未变更（明确保持）

- **接口契约 1.0 未变**：`PROVIDER_API_OPENAPI_BASELINE.yaml` 三方 SHA256 仍为
  `cd3cc198a9c568192dbec76429fb9a6dbc836f5e738377249bc14f73d8e825e3`（逐字节一致）。
- **数据 schema 仍为 v5**：本版**无**新增集合、**无**迁移。
- 八个工作中心、Published Archive 只在中台归档、S05/声誉/线索/自动发布保持 MARK。

---

## [0.1.0] — 2026-10-11 起累计（历史）

- 0.1.0 期间完成 BUILD-01/02/03 与 V0.1 综合整改（Phase 0—4）、
  V1.1 三包整改（B0—B8：资产准入三必填字段、双重身份票据、事件消费、撤回失效、
  正式资产检索、双系统真实 HTTP 联调、归档隔离）。
- schema v2 → v3 → v4 → v5（只增不改、幂等、可回滚）。
- 详细记录：`docs/BUILD-0*_TEST_REPORT.md`、`docs/CURRENT_ARCHITECTURE.md`、
  `MARKETING_HANDOFF_BUNDLE_V1.1/`、`docs/history/JOINT_ACCEPTANCE_REPORT_V1.1.md`。
