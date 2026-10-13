# CONTRACT_DIFF.md —— 双方契约差异表（**待双方签署**）

> 依据 `03_SHARED_CONTRACT_AND_ACCEPTANCE.md` §2：
> 「差异先形成双方签署的 `CONTRACT_DIFF.md`，**不得各自凭猜测调整**。」
> 本文件由 **Marketing OS（Consumer）** 起草。**未经资料库侧确认前，所有条目状态为 `PENDING_PROVIDER_CONFIRM`。**
> 起草日期：2026-10-13 ｜ 基线提交：`3c19e79`

---

## 0. 本表的证据等级（先读）

本表基于对**本机存在的 Workspace 源码副本**（`D:\企业数据后台\oa-system-20261004\oa-system`，
`package.json` version **1.1.7**）的**只读静态核验**得出，**不是**真实联调证据。
资料库侧交付 `LIBRARY_HANDOFF_BUNDLE`（尤其 `PROVIDER_API_OPENAPI.yaml` / `PROVIDER_BASELINE.md`）后，
本表须以**该产物**为准重核并双方签署。

> ⚠ 执行包 `00_README` 记载资料库上传基线为 `watu-oa-feat-v1.1.3 (1).zip`，
> 而本机副本与契约文档自述均为 **V1.1.7**。**这两者孰为权威必须先由资料库侧澄清**（见 D-00）。

---

## D-00｜版本基线不一致（**阻塞级**）

| 项 | 提供方（待确认） | 消费方预期 | 解决方案 | Owner | 状态 |
|---|---|---|---|---|---|
| 权威应用版本 | 执行包记载上传基线 `watu-oa-feat-v1.1.3`；本机源码 `package.json` = `1.1.7`；契约文档自述 `V1.1.7` | 与本侧 `WORKSPACE_APP_VERSION='1.1.7'` 对齐 | 资料库侧在 `PROVIDER_BASELINE.md` 中给出**唯一权威版本 + 提交号**；本侧据此调整 `WORKSPACE_APP_VERSION` | Library | `PENDING_PROVIDER_CONFIRM` |

## D-01｜契约版本号

| 项 | 提供方实取 | 消费方预期 | 解决方案 | Owner | 状态 |
|---|---|---|---|---|---|
| 策略/契约版本 | `lib/asset-policy.js` → `POLICY_VERSION = '1.0'`，随每个响应回带 | `CONTRACT_VERSION = '1.0'` | 一致，无需变更 | — | ✅ 一致 |

## D-02｜事件类型字面量（**已由本侧修正自身 bug，请确认**）

| 项 | 提供方实取（`lib/integration/events.js`） | 消费方原实现 | 处置 | Owner | 状态 |
|---|---|---|---|---|---|
| 服务账户变更 | `service_account.changed`（**下划线**） | `service.account.changed`（点号） | **本侧已按源码修正**（属本侧常量表笔误，不改变共享契约） | MOS | `FIXED_BY_CONSUMER` |
| Skill 版本变更 | `skill.version.changed`（§F：批准/生效/废止/撤回） | **缺失** | **本侧已补** | MOS | `FIXED_BY_CONSUMER` |
| 其余 5 类 | `policy.version.changed` / `admission.state.changed` / `asset.revoked` / `asset.deprecated` / `permission.changed` | 同 | 一致 | — | ✅ |

> 请资料库侧确认：**事件类型字面量集合是否即为以上 7 条且冻结**；若后续新增事件类型，本侧需要一份**枚举变更通知机制**（当前靠人工比对）。

## D-03｜错误码表（**已由本侧补齐，请确认完整性**）

| 项 | 说明 | 处置 | 状态 |
|---|---|---|---|
| `BAD_ADMISSION_INPUT`(400) | `normalizeAdmissionInput()` 校验失败 | 本侧已补入错误码表 | `FIXED_BY_CONSUMER` |
| `USER_NOT_FOUND`(404) | `POST /tickets` 的 userId 不存在/停用 | 同上 | `FIXED_BY_CONSUMER` |
| `ERROR`(500) | `respond()` 兜底码 | 同上（属"未被契约归类"信号） | `FIXED_BY_CONSUMER` |
| `BAD_PUBLIC_KEY` / `BAD_SCOPES` / `BAD_NAME`(400) | 服务账户登记面 `POST /api/integration-accounts`（运维一次性动作） | 同上 | `FIXED_BY_CONSUMER` |

> **请提供方确认**：契约 §3 错误码表是否为**闭合枚举**？若非闭合，请提供 `error.code` 的**稳定清单 + 新增策略**；
> 否则消费方无法可靠区分「不可重试」与「可重试」（本侧现依赖 `ERROR_CODES` 表，未识别的码一律按**不可重试**处理，属 fail-safe）。

## D-04｜检索入参：`topK` vs `limit`（**已由本侧修正，属本侧 bug**）

| 项 | 提供方实取（`knowledge/search`） | 消费方原实现 | 处置 | 状态 |
|---|---|---|---|---|
| 返回条数 | `Number(body.topK) \|\| 10`，clamp 至 `maxPageSize`；**不读 `limit`** | 发送 `limit` | 服务端忽略 → 恒回默认 10 条。**本侧已改发 `topK`**，`limit` 保留为兼容别名 | `FIXED_BY_CONSUMER` |
| 过滤 | 支持 `body.filters`（透传 retriever） | 未暴露 | 待 M1 按需补充 | `OPEN` |

> **请提供方确认** `filters` 的**可接受 schema**（键名与取值域），否则本侧无法安全使用。

## D-05｜资产检索分页：`offset/limit` + `nextCursor`（**已由本侧修正**）

| 项 | 提供方实取（`assets/search`） | 消费方原实现 | 处置 | 状态 |
|---|---|---|---|---|
| 分页 | `body.offset` + `body.limit`（clamp 到 `maxPageSize`）；返回 `nextCursor` = 字符串形式的下一 offset | 只发 `limit`，无 `offset` | **本侧已支持 `offset`** | `FIXED_BY_CONSUMER` |
| 过滤 | `body.categoryId` / `body.subcategoryId` / `body.marketingCategory` | 未暴露 | **本侧已支持** | `FIXED_BY_CONSUMER` |
| 语义差异 | `knowledge/search` 返回 `nextCursor: null`（**不分页**），`assets/search` 返回**字符串 offset**，`changes` 返回**单调 seq 整数** | — | 本侧按端点分别处理；**请确认这是有意设计而非遗漏** | `PENDING_PROVIDER_CONFIRM` |

## D-06｜准入申请必填字段（**阻塞级：本侧模型尚不能提供**）

提供方实取（`lib/asset-policy.js normalizeAdmissionInput()`）：

| 字段 | 提供方要求 | 消费方现状 | 处置 | Owner | 状态 |
|---|---|---|---|---|---|
| `idempotencyKey` | **必填**，`^[A-Za-z0-9_.:-]{1,120}$` | 已有（`asset_admissions.idempotencyKey`） | 可直供 | MOS | ✅ |
| `originObjectId` | **必填**，同格式 | 可由工作素材 ID 派生 | 可直供 | MOS | ✅ |
| `brandId` | **必填**（路由缺省取票据品牌） | 已有（`brandCode`） | 可直供 | MOS | ✅ |
| `title` | **必填** ≤180 | 已有（`submissionMetadata.title`） | 可直供 | MOS | ✅ |
| `libraryPrimaryCategory` | **必填**，必须是七大资料区 `01–07` | **完全不存在** | 需**新增**到准入实体 + 表单 | Library+MOS | ❌ `BLOCKED` |
| `classification` | **必填**，四级密级 `open/internal/restricted/executive` | **完全不存在** | 需**新增** | Library+MOS | ❌ `BLOCKED` |
| `licenseStatus` | **必填**，`cleared/pending/restricted/expired/unknown` | 仅有自由文本 `submissionMetadata.license`（如 `INTERNAL_DRAFT`），**枚举不同** | 需**新增枚举化字段 + 迁移映射规则** | Library+MOS | ❌ `BLOCKED` |
| `reuseScope` | 可选，缺省 `none` | 不存在 | 取缺省 `none`（可接受） | MOS | ⚠ 缺省可用 |
| `aiReusePolicy` / `externalAiTransferPolicy` | 可选，缺省 `blocked` | 不存在 | 取缺省 `blocked`（保守，可接受） | MOS | ⚠ 缺省可用 |
| `marketingCategory` | 可选 `A01–A08` | 已有（`categoryCode`） | 可直供 | MOS | ✅ |
| `contentHash` | 可选，64 位小写 hex | 已有（`working_assets.sha256`） | 可直供 | MOS | ✅ |
| `originVersionId` | 可选 | 可由内容版本 ID 派生 | 可直供 | MOS | ✅ |
| `originSystem` | 服务端**强制覆写** `'marketing_os'` | — | 调用方不得指定（本侧已确保不发） | — | ✅ |

**消费方当前处置（fail closed）**：`createAdmission()` 在**出站之前**执行与服务端同构的预校验；
缺必填字段即返回 `BAD_ADMISSION_INPUT` + `missing[]`，**零出站**，绝不发出一份必然被拒的请求（WC-33 已断言）。

**阻断解除条件（需资料库侧回答）**：
1. `libraryPrimaryCategory` 的七大资料区语义与**准入门槛**（哪些区允许营销侧提交？是否需额外授权？）
2. `classification` 与营销侧资产类型的**默认映射建议**（谁有权升级密级？）
3. `licenseStatus` 与既有文本许可（如 `INTERNAL_DRAFT`）的**权威映射表**
4. 上述三项是否需要**独立审批**才能写入（若需，请给出审批动作与责任人角色）

## D-07｜`admissions/:id/submit` 的 `reviews[]` 契约

| 项 | 提供方实取 | 消费方现状 | 处置 | 状态 |
|---|---|---|---|---|
| 复核记录 | **必填 `reviews[]`**，每条须给 `reviewerUserId`，服务端校验为真实且启用的员工；**不允许"提交即通过"**；任一 `fail` → `REVISION_REQUIRED` | 适配器已支持透传 `reviews[]`，但不构造 | 需资料库侧给出 `reviews[]` **逐字段 schema**（`reviewerUserId` / `conclusion` 取值 / `comment` 长度等） | `PENDING_PROVIDER_CONFIRM` |

> 请提供方给出 **`reviews[]` 元素的确切字段名与枚举**；本侧现有实现只做了"数组透传"，未经 schema 校验。

## D-08｜`skills/:id` 的对外字段

| 项 | 提供方实取 | 消费方现状 | 状态 |
|---|---|---|---|
| 历史版本 | `?version=` 可解**任意历史版本**（含已废止/撤回），只读；省略则返回当前生效版本 | 已支持透传 `version` | ✅ |
| 撤回语义 | 当前生效版本被撤回/废止 → **410 `ASSET_GONE`**；历史版本仍 200 但 `usable=false` | 已按 `ASSET_GONE` → 清缓存 | ✅ |
| 字段 | 仅 `publicView`（不含操作人/审批备注） | 未做字段级断言 | 需资料库侧提供 `publicView` **字段清单**以固化断言 | `PENDING_PROVIDER_CONFIRM` |

## D-09｜`changes` 游标语义与延时容忍

| 项 | 提供方实取 | 消费方现状 | 处置 | 状态 |
|---|---|---|---|---|
| 游标 | **单调递增 `seq`**（非时间戳）；`MAX_EVENTS=5000`；超限裁最旧并回 `truncated:true` | 完全对齐（`CHANGES_MAX_RETAINED=5000`） | — | ✅ |
| 轮询建议 | `pollIntervalHintSeconds: 60` | `CHANGES_POLL_HINT_SECONDS=60` | — | ✅ |
| 品牌隔离 | `admission.state.changed` / `skill.version.changed` 按票据品牌过滤；全局类事件对所有调用方可见 | 未做品牌过滤断言 | 需资料库侧确认「全局类事件不含任何品牌业务内容」的**保证边界** | `PENDING_PROVIDER_CONFIRM` |
| 延时上限 | **未定义** | — | 需双方约定「撤回生效 → 下游拒绝」的**最大容忍时延**（建议 ≤60s）与**故障回退**（见下） | `PENDING_PROVIDER_CONFIRM` |
| 网络不可用 | — | 本侧原则：**拒绝新的权威授权调用，不静默使用过期 Approved 缓存** | 需资料库侧确认在 `CHANGES` 不可达时**不会**继续签发已撤回资产 | `PENDING_PROVIDER_CONFIRM` |

## D-10｜`assets/search` 返回字段命名

| 项 | 提供方实取（`assetMeta()`） | 消费方现状 | 状态 |
|---|---|---|---|
| 命名风格 | **camelCase**：`libraryAssetId` / `libraryVersionId` / `externalAiTransferPolicy` / `aiReusePolicy` / `documentLevel` / `admissionState` / `isReusable` / `approvedAt` / `policyVersion` / `originSystem` | 消费方文档曾以 `external_ai_transfer_policy`（snake_case）表述 | **需统一为 camelCase**（本侧文档已按此更正） |

> 请资料库侧确认**对外 JSON 一律 camelCase**（例外：准入申请入参侧同时接受 snake_case 别名）。

---

## 签署区（双方填写）

| 项目 | 代表（按团队身份，不写个人姓名） | 结论 | 日期 | 备注 |
|---|---|---|---|---|
| Enterprise Workspace（Provider） | | ☐ 全部确认 ☐ 有异议（见备注） | | |
| Marketing OS（Consumer） | | ☐ 全部确认 ☐ 有异议（见备注） | | |

**未完成签署前**：所有 `PENDING_PROVIDER_CONFIRM` 条目**不得**由任一方单方面据以调整实现；
本侧已自行修正的 5 项（D-02/D-03/D-04/D-05 中标注 `FIXED_BY_CONSUMER` 的部分）**仅限本侧常量表与请求构造**，
**未改动任何共享契约语义**，且已通过离线契约自检（36/36）与全量回归。
