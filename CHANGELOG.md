# CHANGELOG — VFIB Marketing OS（运营中台）

本文件记录**应用版本**（`package.json` / `lib/mos/config.js` 的 `MOS_VERSION`）的变更。
接口契约版本（当前 **1.0**）与整改执行包编号（V1.2 等）是**另外两条轴线**，不随应用版本变动。

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
