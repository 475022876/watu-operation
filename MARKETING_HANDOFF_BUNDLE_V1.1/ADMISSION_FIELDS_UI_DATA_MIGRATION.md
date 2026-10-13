# ADMISSION_FIELDS_UI_DATA_MIGRATION.md —— 三项准入字段：UI / 领域 / 持久化 / 迁移与回滚

> 交付包：`MARKETING_HANDOFF_BUNDLE_V1.1/`
> 依据：B 包 `01_CONSUMER_TASKS.md` B1 + `03_HANDOFF_AND_REPORT.md` 第 3 项
> 对应验收：`INT-05`（资产准入端到端）
> 日期：**2026-10-13**

---

## 1. 三项必填字段的完整落点（「必须完整存在」的四层核对）

B1 要求：`libraryPrimaryCategory`、`classification`、`licenseStatus` 必须在
**提交申请 UI → 后台领域对象 → 持久化 → 校验和接口映射**中**完整存在**。

| 层 | 落点 | 具体实现 |
|---|---|---|
| **① UI** | `public/mos/js/modules/governance.js → newAdmissionDialog()` | 三个必填 `<select>`（首项均为「请选择…」，**无默认值**）；资料区→二级目录**联动**；前端预检拦截；错误回显 `missing[]` / `fieldErrors[]` |
| **② 领域对象** | `lib/mos/admissionlib.js` | `PROVIDER_REQUIRED_ENTITY_FIELDS`；`normalizeProviderFields()` 归一化；`providerFieldsComplete()` 判定 |
| **③ 持久化** | `lib/mos/store.js`（schema **5**） | `asset_admissions.{libraryPrimaryCategory, librarySubcategory, classification, licenseStatus, licenseLegacyText, licenseNeedsManualReview, reuseScope, aiReusePolicy, externalAiTransferPolicy, admissionFieldsSchema}` |
| **④ 校验与接口映射** | `lib/mos/routes/admissions.js` + `lib/mos/workspace-client.js` | 建单时归一化（非法 → 400 + `missing[]`/`fieldErrors[]`/`suggested`）；出站前 `toProviderAdmissionInput()` 逐字段映射；缺必填 → **零出站**拒绝 |

### 1.1 枚举一律引用提供方权威口径（本侧不自创编号）

| 字段 | 权威枚举 | 本侧常量 |
|---|---|---|
| `libraryPrimaryCategory` | 七大资料区 `01`–`07`（43 个子目录） | `LIBRARY_PRIMARY_CATEGORIES` / `LIBRARY_CATEGORIES` |
| `classification` | `open` / `internal` / `restricted` / `executive`（rank 1–4，**只升不降**） | `CLASSIFICATIONS` / `CLASSIFICATION_META` |
| `licenseStatus` | `cleared` / `pending` / `restricted` / `expired` / `unknown` | `LICENSE_STATUSES` |
| `reuseScope` | `none` / `internal_reference` / `brand_kit` / `campaign_reuse` / `unrestricted` | `REUSE_SCOPES` |
| `aiReusePolicy` / `externalAiTransferPolicy` | `blocked` / `allowed` | `AI_REUSE_POLICIES` / `EXTERNAL_AI_TRANSFER_POLICIES` |

前端**不硬编码**任何枚举：通过 `GET /api/mos/integration/contract` 拉取，`ui` 套件逐项断言
`下拉选项 === 契约枚举`。

---

## 2. 三条「不猜测」硬规则（B1 明文要求）

| 规则 | 实现 | 证据 |
|---|---|---|
| 密级**不得猜测降级** | `classification` **无默认值**；缺失即 `missing[]`；UI 首项为「请选择密级（不得猜测降级）」 | `unit` `U-16b2` |
| 历史自由文本许可**不得视作 `cleared`** | 非枚举值 → `errors[]` + **保守转 `unknown`** + `licenseNeedsManualReview=true`；绝不映射 `cleared` | `unit` `U-16b3`、`e2e03` `E2E05-04c`（回传 `suggested.licenseStatus='unknown'`） |
| `reuseScope` **不得缺省 `none`**（提供方 D-06.5） | 缺失 → `MISSING_REUSE_SCOPE`；`none` → `REUSE_SCOPE_NONE`；**零出站拒绝** | `unit` `U-16b4`、`dual` `D-24d/D-24e` |

### 2.1 `licenseStatus=unknown/expired` 是「人工确认闸门」

提供方 D-06.4 原文：`unknown` **会阻断入库**，是**显式的人工确认闸门**，不是「先放着」。
本侧据此在 **UI 提交前**与**预检**两处都阻止，并给出明确文案，避免运营建出一份永远无法准入的申请。

---

## 3. `reviews[]` 严格使用 Provider schema，真实审核人，不伪造通过

| 要求 | 实现 |
|---|---|
| 使用 Provider schema | `pushAdmission()` 发送 `body.reviews[{reviewerUserId, outcome, note}]` |
| **真实审核人** | `collectProviderReviews()` 从**本侧真实审核链**（`review_decisions`）推导；**不自动生成** |
| **不伪造通过** | 只把 `action === 'APPROVE'` 映射为 `pass`；其余动作（含 `REQUEST_REVISION`/`REJECT`/`CANCEL`）一律 `fail`；已撤销/作废的裁决行**跳过** |
| 复核人必须是资料库真实用户 | 每个 `reviewerUserId` 经 `resolveProviderUser()` 映射；**未映射即不计入**（记入 `missing[]`），**绝不用服务身份顶替** |
| 上限 | 从不超过 10 条（Provider 上限），不需要触发 `TOO_MANY_REVIEWS` |

> ⚠ 本侧曾因**字段名读错**（按 `decision`/`reviewerId` 读，实际是 `action`/`actorId`）导致
> **每一条真实「通过」都被映射成 `fail`**，申请被 Provider 退回 `REVISION_REQUIRED` 且无法重提。
> 已在联调中实测暴露并修正。详见 `CONTRACT_DIFF_SIGNED.md` D-07。

---

## 4. 幂等提交 / 重试 / 失败查询（B1 要求补充）

| 能力 | 实现 | 说明 |
|---|---|---|
| **幂等提交** | `idempotencyKey`（`^[A-Za-z0-9_.:-]{1,120}$`） | 幂等判定**先于**字段校验：同键重复提交返回既有申请 |
| **有界重试** | `workspace-client.withRetry()`：`maxAttempts=3`，指数退避 `baseDelayMs=300 → capDelayMs=4000` | 只重试**可重试**错误（传输失败 / 429 / 5xx）；未识别码 fail-safe **不重试** |
| **失败查询（不重复建单）** | `queryAdmissionState(providerAdmissionId)` | 契约 §2 原文：「无法确定提交结果 → **先查询状态**，不能直接生成新的申请」；本侧**绝不**凭幂等键猜 ID 建新单 |
| **作业记录** | `db.library_admission_jobs`（schema 5 新增集合） | 每次同步落一条：`attempts` / `log[]`（含 `create`/`submit`/`artifact` 三步）/ `lastErrorCode` / `providerAdmissionId` / `reviewsSent` / `reviewsMissingMapping` |
| **恢复路径** | Provider `REVISION_REQUIRED` **无重提入口**（提供方 B-4） | 回执明文提示：以**新的 `idempotencyKey`** 新建申请 |
| **失败不伪造成功** | 只有 Provider 返回 `isReusable=true` **且**给出正式 Asset ID 才建立本地引用 | `e2e03` 断言：无 `libraryId`、无回执、`library_assets_refs` 未建立可复用引用 |

---

## 5. 历史数据迁移：v4 → v5（保守，**只增不改**）

### 5.1 迁移规则（`lib/mos/store.js migrate()`）

对 `priorVersion > 0 && priorVersion < 5` 且 `asset_admissions` 为数组的库执行**保守回填**：

| 字段 | 回填值 | 理由 |
|---|---|---|
| `libraryPrimaryCategory` | `null` | **不猜**资料区 |
| `classification` | `null` | **不猜**密级（不得猜测降级） |
| `licenseStatus` | `'unknown'` | 历史自由文本**绝不映射 `cleared`** |
| `licenseLegacyText` | 保留原自由文本 | 供人工核定 |
| `licenseNeedsManualReview` | `true` | 标记需人工处理 |
| `needsManualReview` | `true` | 预检会 FAIL，**不可直接入库** |
| `admissionFieldsSchema` | `5` | 幂等标记 |

**幂等性**：已带 `admissionFieldsSchema === 5` 的行**零改写**（`unit` `U-19d` 断言）。

### 5.2 已 v2+ 的库绝不复活

`migrate()` 只在 `priorVersion < 2` 且 `demoSeed` 开启时补种 Skill/模板/渠道。
**已迁移过的库不会被写回**（避免用户清空后被重新种回）。

### 5.3 回滚

| 目标 | 操作 | 代价 |
|---|---|---|
| 回到 v4 代码 | `git revert` 到 `286fe5b` | **新集合数据会保留但不被读取**（`library_tickets` / `library_event_cursors` / `library_invalidations` / `library_admission_jobs`）；三项新字段不被读取 |
| 数据回滚 | 用发布前 `data/mos.json` 备份覆盖 | 会**丢失**迁移后新产生的准入/事件数据 —— **需人工确认** |
| 迁移不可逆点 | 无 | 迁移**只增字段、不删字段**；旧代码读新库不会崩（多余字段被忽略） |

> 详细回滚步骤见 `docs/CURRENT_ARCHITECTURE.md` §5。

---

## 6. UI 截图与断言

- **截图**：`UI_BROWSER_EVIDENCE/B1-38-admission-dialog.png`
- **断言**（`tools/mos-ui-check.js`）：
  - 对话框渲染，六个下拉存在；
  - 资料区 / 密级 / 许可 / 复用 / AI 下拉选项 **=== 契约端点枚举**（逐项 `sameArr`）；
  - 二级目录**联动**且选项数 > 1 且均属所选一级区；
  - 缺必填 → 前端拦截（对话框不关 + toast 文案匹配）；取消后**无残留遮罩**；
  - 复用范围**不预选**（首项为空，防止误用 `none` 造成永久卡死）。

---

## 7. 未完成 / 未验证

| 项 | 状态 | 说明 |
|---|---|---|
| `resubmit`（改字段后重提同一申请） | **未实现** | 提供方 B-4；本侧按「新建申请」实现恢复路径 |
| `A01–A08` 营销分类码 | **PROVISIONAL** | SPECIAL-01 原件未提供，保持 provisional，**未核验** |
| 三大资料区（含 43 子目录）的**业务语义**逐条人工复核 | **未做** | 本侧只做结构校验（归属关系），语义由业务方核定 |
