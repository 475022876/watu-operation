# CHANGELOG.md —— Marketing OS 本轮变更

> 范围：`02_MARKETING_OS_CODEX_TASK.md` 执行期间（2026-10-13）的全部代码变更。
> 上一基线：`3c19e79`（V0.1 综合整改 Phase 0—4 收口 + 口令重置工具 `--rename`）
> 本轮：M0 阶段「契约符合性修正」，**零删除**

---

## 1. 变更总览

| 文件 | 变更 | 行数 |
|---|---|---|
| `lib/mos/workspace-contract.js` | 契约常量表与准入入参校验 | +153 / −1 |
| `lib/mos/adapters/workspace.js` | 请求构造符合性 + 出站前预校验 | +71 / −11 |
| `tools/mos-workspace-contract-test.js` | 新增 6 条契约对齐断言（30 → 36） | +55 / −1 |
| `MARKETING_HANDOFF_BUNDLE/**` | 新增交付物（文档 + UI 证据 + 可复现脚本） | 新增 |

> **删除**：无。**路由/业务逻辑/前端架构**：无改动。**schema**：仍为 **v4**（未变更）。

## 2. 详细变更

### 2.1 `lib/mos/workspace-contract.js`

| 编号 | 变更 | 原因（实取 Workspace V1.1.7 源码） |
|---|---|---|
| C-01 | `EVENT_TYPES`：`service.account.changed` → **`service_account.changed`** | `lib/integration/events.js` 使用**下划线**；原实现永远失配 |
| C-02 | `EVENT_TYPES`：**补 `skill.version.changed`** | 同上，§F 正式 Skill 批准/生效/废止/撤回事件；缺失会**静默忽略 Skill 版本变更** |
| C-03 | 错误码表补 6 项：`BAD_ADMISSION_INPUT`(400) / `USER_NOT_FOUND`(404) / `BAD_PUBLIC_KEY`(400) / `BAD_SCOPES`(400) / `BAD_NAME`(400) / `ERROR`(500) | 原实现会把这些失败分层判为 `unknown`，导致可重试性判断失真 |
| C-04 | 新增枚举常量：`MARKETING_CATEGORIES`(A01–A08)、`LIBRARY_PRIMARY_CATEGORIES`(01–07)、`CLASSIFICATIONS`(open/internal/restricted/executive)、`LICENSE_STATUSES`、`REUSE_SCOPES`、`AI_REUSE_POLICIES`、`EXTERNAL_AI_TRANSFER_POLICIES` | 逐字对齐 `lib/asset-policy.js` 与 `lib/library-nav.js` |
| C-05 | 新增 `ID_RE`/`CONTENT_HASH_RE`/`BRAND_ID_MAX`、`ADMISSION_REQUIRED_FIELDS`、`ADMISSION_OPTIONAL_FIELDS` | 对齐 `normalizeAdmissionInput()` 的必填项与格式约束 |
| C-06 | 新增 **`validateAdmissionInput()`** | 与服务端**同构**的本地预校验（**不替代**服务端校验） |

### 2.2 `lib/mos/adapters/workspace.js`

| 编号 | 变更 | 原因 |
|---|---|---|
| C-07 | `createAdmission()` **重写**：出站前执行 `validateAdmissionInput()`；不足即返回 `BAD_ADMISSION_INPUT` + `missing[]` + `fieldErrors[]`，**零出站** | 原实现只发 7 个字段，**缺 2 个服务端必填**（`libraryPrimaryCategory`、`licenseStatus`）→ **必被 400 拒绝** |
| C-08 | `createAdmission()` 调整为**未配置优先**返回 `INTEGRATION_NOT_CONFIGURED` | 保持「未配置时所有方法恒 `INTEGRATION_NOT_CONFIGURED`」这一不变量（WC-15） |
| C-09 | `knowledgeSearch()`：改发 **`body.topK`**（`limit` 保留为兼容别名） | 服务端读取 `body.topK`，**不读 `limit`**；原实现会被忽略并回落到默认 10 条 |
| C-10 | `assetsSearch()`：新增 **`offset`** 与 `categoryId`/`subcategoryId`/`marketingCategory` | 服务端以 `body.offset` 分页并返回字符串 `nextCursor`；原实现无法翻页 |

### 2.3 `tools/mos-workspace-contract-test.js`

| 编号 | 新增断言 |
|---|---|
| WC-31 | 事件类型表与 `events.js` 一致（下划线 + `skill.version.changed`） |
| WC-32 | 补齐的错误码可正确分层（不再落 `unknown`） |
| WC-33 | 准入入参缺必填字段 → `BAD_ADMISSION_INPUT` + `missing[]`，且**桩零命中（真的没出站）** |
| WC-34 | 字段齐备 → 放行且请求体含 `libraryPrimaryCategory`/`classification`/`licenseStatus`；`originSystem` **不由调用方指定** |
| WC-35 | `knowledgeSearch` 以 `topK` 传参 |
| WC-36 | `assetsSearch` 支持 `offset` 与 `marketingCategory` |

桩服务同步增加 `body` 记录以便断言请求体（测试专用）。

## 3. 变更影响评估

| 维度 | 影响 |
|---|---|
| 共享契约 | **未改动**。仅修正本侧对既有契约的**符合性**（常量表与请求构造），未新增/删除/重命名任何字段语义 |
| Provider 侧 | **零影响**（未修改 Workspace 任何源码；本侧只读交叉核验） |
| 业务逻辑 / 前端 | **零影响**（未改路由、状态机、页面） |
| 数据 schema | **未变更**（仍 v4） |
| 既有测试 | **零回归**：478/478 全通过（`workspace` 30 → 36） |
| 风险 | 低。所有改动均在适配层与常量表；`workspace` 未配置时不产生任何出站行为 |

## 4. 回归证据

```
bash tools/run-mos-tests.sh all
→ 汇总：478/478 断言通过（全部套件通过）
→ 套件：smoke unit sec sched provider workspace e2e e2e02 e2e03 ui
→ UI 检查：97/97 通过
```

## 5. 待办（**依赖资料库侧交付，本轮未做**）

见 `INTEGRATION_DIFF.md` §3（T-01…T-07）与 `CONTRACT_DIFF.md`（D-00…D-10）。
其中 **T-01（准入表单补齐 `libraryPrimaryCategory`/`classification`/枚举化 `licenseStatus`）为阻塞级**：
不补齐则真实入库申请**无法合法构造**，`library.asset.approve.final` 之后的实际入库链路**不可能完成**。
