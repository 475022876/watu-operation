# CONTRACT_DIFF_SIGNED.md —— 逐条契约差异与双侧决定

> 交付包：`MARKETING_HANDOFF_BUNDLE_V1.1/`
> 依据：B 包 `01_CONSUMER_TASKS.md` B0 + `03_HANDOFF_AND_REPORT.md` 第 2 项
> 对方答复来源：`LIBRARY_HANDOFF_BUNDLE_V1.1/CONTRACT_DECISIONS_SIGNOFF.md`（Provider，2026-10-13）
> 与 `LIBRARY_HANDOFF_BUNDLE_V1.1/BLOCKERS.md`
> 日期：**2026-10-13**

---

## 0. 状态取值与证据等级（先读）

**状态值**（C 包 `04_E2E_ACCEPTANCE_AND_EVIDENCE.md` 统一口径）：
`CONFIRMED` / `CONFIRMED_WITH_CORRECTION` / `CONFIRMED_WITH_CHANGE` / `BLOCKED` / `NOT_RUN`。

**签署纪律**（重要）：
- 本文件由**消费方**逐条作出「本侧决定与处置」，**不代替提供方签字**；
- 「已双侧确认」一栏只有在**提供方已在其 `CONTRACT_DECISIONS_SIGNOFF.md` 明确作答**时才可标 ✅；
- 凡本侧**已修正自身缺陷**的条目，一律保留「缺陷原文 + 修正方式 + 回归证据」，不粉饰。

**基线一致性**：C 包 `PROVIDER_API_OPENAPI_BASELINE.yaml` 与 Provider 交付包 `PROVIDER_API_OPENAPI.yaml`
**逐字节一致**（SHA256 `cd3cc198…`，实测）。因此**不存在「双侧契约基线不同」的 D-00 类问题**。

---

## D-00｜版本基线不一致（原为**阻塞级**）

| 项 | 内容 |
|---|---|
| **本侧原提问** | A 包 README 记录的基线名 `watu-oa-feat-v1.1.3` 与源码自述 `1.1.7` 不一致 → 无法判定应以哪个为准 |
| **提供方答复** | `CONFIRMED_WITH_CORRECTION`：**文件名沿用旧版本号，代码是 1.1.7**。见 `PROVIDER_BASELINE.md` §1 |
| **核验方式（本侧实测）** | 直接读取 `D:/企业数据后台/oa-system-20261004/oa-system/package.json` → `1.1.7`；`POLICY_VERSION = '1.0'`；schema `3`；分支名 `feat/v1.1.3` |
| **本侧决定** | ✅ 接受。**判定版本一律以运行时自述字段为准，不按分支名/文件名推断** |
| **双侧确认** | ✅（提供方已书面答复 + 本侧独立实测一致） |
| **状态** | `CONFIRMED_WITH_CORRECTION` —— **原阻塞解除** |

> ⚠ 遗留提醒：分支名仍是 `feat/v1.1.3`，后续任何自动化脚本**不得**用它判定版本。

---

## D-01｜契约版本号

| 项 | 内容 |
|---|---|
| **提供方答复** | `CONFIRMED`：`policy_version = '1.0'`，随**每个**集成响应回带 |
| **本侧实现** | 封套解析断言 `policy_version` 存在且为 `'1.0'`；D4-16 实测 `data.policyVersion === '1.0'` |
| **状态** | `CONFIRMED` ✅ |

---

## D-02｜事件类型字面量

| 项 | 内容 |
|---|---|
| **提供方答复** | `CONFIRMED_WITH_CHANGE`（CCR-2026-005）：7 条字面量**与消费方所列完全一致**并冻结；但**修复了一个严重的「枚举谎报」**：修复前 7 条中 **4 条从未发出**（`asset.revoked` / `asset.deprecated` / `policy.version.changed` / `service_account.changed`） |
| **风险（提供方原文）** | 若消费方只监听 `asset.revoked`，会**静默漏掉撤回**。这不是理论风险 |
| **本侧原实现** | 已监听全部 7 条；但**仅对 4 类品牌业务事件做品牌过滤**——与提供方修正后的口径**恰好一致** |
| **本侧本轮新增（对齐 D-02 消费方约定 ②）** | 未识别事件类型 → **不得静默忽略** → 置位 `reconcileRequired`（**要求一次全量对账**），并写入 `unhandledTypes` 供审计。**不**因此清空既有失效登记（事件窗口不完整 vs 认知不完整，两者语义不同） |
| **回归证据** | `dual` 套件 `E-06`（推进 seq 不卡死游标）、`E-06b`（置位全量对账）、`E-10b`（全量对账完成后清位）；双系统实测 D4-38 真实消费到 `asset.revoked` |
| **双侧确认** | ✅ |
| **状态** | `CONFIRMED_WITH_CHANGE` ✅ |

**本侧固化的事件类型常量**（`lib/mos/workspace-contract.js → EVENT_TYPES`）：

```
policy.version.changed / admission.state.changed / asset.revoked / asset.deprecated
skill.version.changed / permission.changed / service_account.changed
```

> 注意 `service_account.changed` 用**下划线**（不是 `service-account.changed`），本侧已固化并断言。

---

## D-03｜错误码表

| 项 | 内容 |
|---|---|
| **提供方答复** | `CONFIRMED`，并**明确：`error.code` 是「稳定但非闭合」枚举，不承诺封版** |
| **提供方策略** | ① 新增码只增不改（既有码含义与 HTTP 状态不变）；② `ERROR`/`INTERNAL_ERROR` 是「未被契约归类」的信号，**可重试 + 需人工留痕**，不得当业务失败；③ 消费方「按现有表处理 + 未识别码一律不可重试」的做法**被确认正确**；④ 建议补入 `BAD_REVIEW_OUTCOME`、`TOO_MANY_REVIEWS` |
| **本侧原实现** | 71 项，⊇ 冻结 OpenAPI 枚举；未识别码 → `layer:'unknown'` + `retryable:false`（与提供方确认的做法一致） |
| **本侧本轮修正** | 拆成两层：<br>① `OPENAPI_ERROR_CODE_ENUM` = **71 项**（C 包冻结快照，**逐字节不动的基线**）；<br>② `ERROR_CODES`（运行时表）= 71 + `PROVIDER_DECLARED_ADDITIONS`（`BAD_REVIEW_OUTCOME` / `TOO_MANY_REVIEWS`）= **73 项**；<br>③ 契约端点回带 `errorCodePolicy` 明文声明「非闭合」 |
| **回归证据** | 双系统 D4-15（冻结枚举 71 项 + SHA 一致）、D4-15b（运行时 73 项 + 两项新增码 + 非闭合声明） |
| **本侧签署立场** | ✅ **接受「提供方不承诺码集封版」**。本侧以「表 + fail-safe 兜底」应对，不以闭合枚举假设编码 |
| **状态** | `CONFIRMED` ✅ |

---

## D-04｜检索入参与 `filters` schema

| 子项 | 提供方答复 | 本侧处置 | 状态 |
|---|---|---|---|
| D-04.1 `topK` 语义 | `CONFIRMED_WITH_CORRECTION`：确认消费方修正正确（`knowledge/search` 读 **`body.topK`**，**不**分页） | 已修正；本轮进一步修正一处**静默失配**（见下） | ✅ |
| D-04.2 `filters` 可接受 schema | 已冻结 | 本侧只透传，不构造 | ✅ |

### ⚠ 本侧本轮发现的**真实缺陷**（自查，非提供方指出）

`searchKnowledge()` / `searchAssets()` 早期实现把检索参数摊在调用参数上，**未构造 POST body**。
后果是**静默失配**：

- `assets/search` 的全部参数都是可选的 → HTTP 200 + **恒空结果**，看起来"成功"；
- `knowledge/search` 的 `query` 必填 → **400 `MISSING_QUERY`**。

**修正**：新增 `searchKnowledgeBody()` / `searchAssetsBody()`，显式构造 POST body（`query`/`brandId`/`topK`/`limit`/`offset`/`categoryId`/`subcategoryId`/`marketingCategory`），
并确保 **url query 不参与本端点**。

**证据**：`dual` 套件 `D-24c`（断言 body 内容正确且 url 无 query）；双系统 D4-18（`knowledge.search` 真实命中 2 条且正文一律扣留）。

---

## D-05｜三种分页/游标语义

| 端点 | 提供方口径 | 本侧实现 | 状态 |
|---|---|---|---|
| `knowledge/search` | **不分页**，`body.topK` | 不传分页参数 | ✅ |
| `assets/search` | `body.offset` + `body.limit`；`nextCursor` 为**字符串** | 已对齐（D4-17 实测 `nextCursor` 类型） | ✅ |
| `changes` | **单调整数 `seq`**；`MAX_EVENTS=5000`；`limit ≤ 200` | 完全对齐（`CHANGES_MAX_RETAINED=5000`，`pollLimit=200`） | ✅ |

**提供方原文**：「这是有意设计，不是遗漏」。本侧**不试图统一三种语义**。

---

## D-06｜三个准入必填字段与枚举、默认/人工映射

提供方答复：`CONFIRMED_WITH_CORRECTION`。逐项对照：

| 字段 | 提供方权威口径 | 本侧原状态 | 本侧现状 | 状态 |
|---|---|---|---|---|
| `libraryPrimaryCategory` | **必填**，七大资料区 `01`–`07` | **不存在** | 已新增到实体 + 持久化 + 表单 + 校验 + 接口映射 | ✅ |
| `classification` | **必填**，`open/internal/restricted/executive`，**只升不降** | **不存在** | 已新增；**未设默认值**（不得猜测降级） | ✅ |
| `licenseStatus` | **必填**，`cleared/pending/restricted/expired/unknown` | 只有自由文本（如 `INTERNAL_DRAFT`） | 已新增枚举字段；自由文本**保守转 `unknown`** + `licenseNeedsManualReview=true`；**绝不映射 `cleared`** | ✅ |
| `reuseScope` | 可选（缺省 `none`）—— **但见 D-06.5，缺省不可用于准入** | 不存在 | 已新增，且**强制非 `none`**（见下） | ✅ |
| `aiReusePolicy` / `externalAiTransferPolicy` | 可选（缺省 `blocked`） | 不存在 | 取缺省 `blocked`（提供方确认**可接受**：预检不检查它们） | ✅ |
| `originSystem` | 服务端**强制覆写** `marketing_os` | — | 本侧**从不发送**该字段 | ✅ |

### D-06.2 七大资料区准入门槛（回答本侧问题 1）

提供方答复：**7 个区全部对营销侧开放提交**，无区级封锁。两条与区相关的硬门槛：
① `06.05`（融资与资本）最低密级 = `executive`（低于则 `REVISION_REQUIRED`）；
② 二级目录必须落在所选一级目录下（否则 400）。

**本侧落库**：`LIBRARY_CATEGORIES`（7 区 × 43 子目录）逐条内建；`normalizeProviderFields()` 校验二级目录归属。

### D-06.3 密级默认映射（回答本侧问题 2）

提供方答复：**不提供「资产类型 → 密级」默认映射，也不做自动推断**（自动映射等于替业务方决定可见面，误判不可逆）。
**本侧落库**：`classification` **无默认值** → 缺省即 `missing[]` → 400 `BAD_ADMISSION_INPUT`；UI 首项为「请选择密级（不得猜测降级）」。

### D-06.4 遗留自由文本许可的权威映射表（回答本侧问题 3）

| 遗留文本 | 提供方权威处置 | 本侧实现 |
|---|---|---|
| `INTERNAL_DRAFT`（及任何非枚举值） | **400 拒绝**，不映射、不猜语义 | ✅ 本侧转 `unknown` + 标记需人工核定（更保守） |
| 语义=「内部草稿/未定稿」 | 建议映射 `pending`（**不是** `cleared`） | ✅ 本侧**不自动建议**，只要求人工显式选定 |
| 语义=「仅内部使用」 | 建议 `restricted` + `reuseScope: internal_reference` | 同上（人工选定） |
| 无法判定 | `unknown` —— 但 `unknown` **阻断入库** | ✅ 见下 |

**提供方原文（必须遵守）**：「`unknown` 不是『先放着，以后再说』，而是**显式的人工确认闸门**。」
**本侧落库**：`licenseAdmissionGate()` —— `licenseStatus ∈ {expired, unknown}` 在**预检即 FAIL**、且 UI 在提交前就阻止并说明「该状态无法完成准入，需补充许可信息」。

### D-06.5 ⚠ 本侧原假设与现实不符的一处（**已按提供方要求修正**）

**提供方原文**：
> `reuseScope` 缺省 `none` **不可接受**。预检把 `reuseScope=none` 判为「无复用意义」→ 落 `REVISION_REQUIRED`，
> 申请**永远无法**推进到最终审批。请消费方把 D-06 表中该项从 `⚠ 缺省可用` 改为 `❌ BLOCKED(缺省不可用)`。

**本侧决定**：✅ **完全接受，并已把该纠正落到代码与 UI，而非只改文档。**

| 落地点 | 实现 |
|---|---|
| 合同表 | 本文件即已改为 `❌ 缺省不可用`（见 D-06 表 + 本节） |
| 领域层 | `admissionlib.reuseScopeUsable()` → 缺失 = `MISSING_REUSE_SCOPE`；`none` = `REUSE_SCOPE_NONE`（**两者区分**，便于运维定位） |
| 预检 | 新增检查项 `reuse_scope_usable`（FAIL 即不可提交最终审批） |
| 出站前 | `workspace-client.pushAdmission()` **零出站拒绝**（绝不发出一份注定卡死的申请） |
| 同步入口 | `runRealSync()` 在**零出站**阶段拦下，并在回执中给出恢复路径 |
| UI | 下拉**不再预选 `none`**，首项为「请选择复用范围」，且前端同构拦截 `none` |
| 恢复路径（B-4 联动） | 回执明文：修正后须以**新的 `idempotencyKey` 新建申请**（`REVISION_REQUIRED` **无重提入口**） |
| 回归证据 | `unit` `U-16b4`；`dual` `D-24d` / `D-24e` |

### D-06.6 三项是否需要独立审批才能写入（回答本侧问题 4）

提供方答复：**写入本身不需要独立审批**（受 `admissions.write` + 票据约束）；
**但「写入 ≠ 可用」** —— 要变成可复用资产必须再经**本人会话签发的最终审批**（`library.asset.approve.final`）。
服务端专有字段（`state` / `libraryAssetId` / `finalApproverUserId` / `policyVersion`）在 `SERVER_OWNED_FIELDS` 白名单内，**一律忽略调用方输入**。

**本侧实现**：三重闭合（无服务身份代签）—— 见 `AUTH_AND_EVENTS_REPORT.md` §4。

---

## D-07｜`admissions/:id/submit` 的 `reviews[]` 契约

提供方答复：`CONFIRMED_WITH_CHANGE`（CCR-2026-003 / 004）。

| 子项 | 提供方口径 | 本侧处置 | 状态 |
|---|---|---|---|
| D-07.1 逐字段 schema | 已冻结（`reviewerUserId` / `outcome` ∈ `pass\|fail` / `note`） | 已按 schema 构造 | ✅ |
| D-07.2 fail-open 修正 | ① 拼错/大小写不符的 `outcome` 原被**静默记成 pass** → 现 400 `BAD_REVIEW_OUTCOME`；② `reviews` 超 10 条原被**静默截断** → 现 400 `TOO_MANY_REVIEWS` | 本侧**从不发送**非法 `outcome`、**从不超过** 10 条；两项新码已补入错误码表 | ✅ |
| D-07.3 契约缺口（B-4） | `REVISION_REQUIRED → SUBMITTED` 状态机允许，但 `/submit` **无对应分支**；同 `idempotencyKey` 重提**原样返回既有申请**（无法修正） | 本侧**不实现**「改字段后重提」；收到 `REVISION_REQUIRED` 后**不再发起第③步**，带回 `problems` 并提示以**新幂等键**新建 | ✅ |

### ⚠ 本侧本轮自查发现并修正的**严重缺陷**（关联 D-07）

**症状**：双系统真实联调中申请被 Provider 判 `REVISION_REQUIRED`，`problems = ["存在未通过的复核记录"]`。

**根因**：`collectProviderReviews()` 按 `d.decision || d.outcome` + `d.reviewerId || d.actorId` 读取本侧决策行；
而本侧决策行的**真实字段名是 `action` + `actorId`**（`lib/mos/reviewlib.appendDecision`）。
取不到值 → `''.toUpperCase() !== 'APPROVE'` → **每一条真实「通过」都被映射成 `fail`**。

**影响等级**：若不修，**任何**真实准入申请都会在 Provider 侧被退回修订，且因 B-4 无重提入口而**永久卡死**。

**修正**：按真实字段名读取（`action` / `actorId` / `remarks`），只把 `APPROVE` 视为 `pass`，其余动作一律 `fail`；
并跳过已撤销/作废的裁决行。

**同时新增诚实分支**：Provider 的 `/submit` 对「不可由本端点推进」的状态**仍返回 HTTP 200**（`progressed:false`）。
若不识别，就会把「预检未过」**误报成「等待最终审批」**。现显式拦截为 `PROVIDER_REVISION_REQUIRED`（stage=submit），
带回 `problems`，**不再发起第③步**。

**证据**：双系统 D4-29b（Provider 侧状态实测推进到 `FINAL_APPROVAL_PENDING`，`problems=[]`，`steps=[SUBMITTED,PRECHECK,REVIEWING,FINAL_APPROVAL_PENDING]`）。

---

## D-08｜`skills/:id` 的对外字段与 410 语义

| 项 | 提供方答复 | 本侧处置 | 状态 |
|---|---|---|---|
| `publicView` 字段清单 | 已冻结（不含操作人/审批备注） | 已按只读面消费 | ✅ |
| 历史版本 `?version=` | 可解任意历史版本，只读 | 已支持透传 | ✅ |
| 当前生效版本被撤回/废止 | **410 `ASSET_GONE`**；历史版本 200 但 `usable=false` | 已按 `ASSET_GONE` → 清缓存 | ✅ |
| 权威生效条件 | `EFFECTIVE` 且 `effective_at` 已到达；**`approved` ≠ 可引用** | 本侧**不把 approved 当可引用** | ✅ |

> **未验证部分**：本侧**没有**在真实链路上取到官方 Skill 的 `EFFECTIVE` 版本 ——
> Provider 侧 Visual Brand Guardian Skill **V1.2 未入库**（其 `BLOCKERS.md` B-2）。
> 因此 `INT-10` 只能记 **`BLOCKED`**（机制就绪 / 权威生效待人工）。见 `SKILL_AND_DICTIONARY_STATUS.md`。

---

## D-09｜`changes` 游标、品牌过滤与撤回时延

提供方答复：`CONFIRMED_WITH_CHANGE`（CCR-2026-002）。

| 子项 | 提供方口径 | 本侧处置 | 状态 |
|---|---|---|---|
| D-09.1 游标与上限 | 单调 `seq`；`MAX_EVENTS=5000`；`limit ≤ 200`；溢出回 `truncated:true` + `oldestCursor` | 完全对齐 | ✅ |
| D-09.2 品牌过滤 | 修正了**跨品牌泄漏**：4 类品牌业务事件全部纳入过滤；缺 `brandId` **不下发**（fail closed）；3 类**全局事件**（`policy.version.changed` / `permission.changed` / `service_account.changed`）对所有调用方可见但**不含品牌业务内容** | 本侧对齐：4 类品牌事件按品牌处理；全局事件作用于全部品牌 | ✅ |
| **D-09.3 撤回时延** | **不存在「等轮询」这回事**：服务端撤回**即时强制**。<br>非治理身份 → **404 `NOT_FOUND`**；治理身份（持 `library.asset.approve.final`）→ **410 `ASSET_GONE`**；检索面立即消失。<br>**规则：`410` → 立即清缓存；`404` → 视为不存在。消费方须按自己票据的视角决定动作（两种响应不同）** | ✅ 已按两种视角**分别**处理：<br>· `410` → 登记 `asset.revoked`；<br>· `404` → 登记 **`asset.not_found`**（**单列一类**，不与撤回混记，否则审计会失真）<br>两者都导致 `usable=false` 且立即失效本地引用 | ✅ |
| D-09.4 故障回退 | `truncated` → 全量对账；未知事件 → 全量对账；`CHANGES` 长时间不可达 → **拒绝新的权威授权调用且不静默沿用过期缓存**；收到 `410` → 立即清；`401 TICKET_*` → **可恢复事件**，重新取票 | ✅ 全部实现：`truncated` 清登记 + 游标重置 + 清对账位；未知事件置对账位；连续失败 ≥2 → `degraded` → `authoritativeUsable=false`；`401 TICKET_*` → 丢弃换票**只重试一次** | ✅ |

**本侧额外诚实说明**：本侧**从不**把 60s 轮询当作「撤回生效时延」。
关键动作（新创作/下载/复用）**一律走 `verifyAssetUsable()` 实时重新验证**，Provider 不可用即 fail closed。

**回归证据**：`dual` `E-01…E-21`；双系统 D4-35（`PROVIDER_VERIFIED`）、D4-37（治理视角 410）、D4-37b（普通视角 404）、D4-38/39（事件消费 + 失效登记）、D4-40（撤回后拒绝且零出站）。

---

## D-10｜对外字段命名

提供方答复：`CONFIRMED`（camelCase 冻结）+ ⚠ snake_case 边界修正。

| 子项 | 提供方口径 | 本侧处置 | 状态 |
|---|---|---|---|
| D-10.1 对外 JSON | **一律 camelCase**（冻结） | 完全对齐 | ✅ |
| D-10.2 准入**入参**的 snake_case 别名 | **并非全字段支持**：`classification` / `title` / `idempotencyKey` / `note` **只认 camelCase**（`V11-C.10` / `C.10b`） | 本侧**全部以 camelCase 发送**，不依赖任何别名 | ✅ |

---

## CCR 变更请求登记（提供方本轮）

| CCR | 内容 | 对本侧的影响 | 本侧处置 |
|---|---|---|---|
| CCR-2026-002 | `/changes` 跨品牌泄漏修正 | **正向**（曾泄漏他品牌资产 ID） | 已对齐品牌过滤口径 |
| CCR-2026-003 | `reviews[]` 两处 fail-open 修正（`BAD_REVIEW_OUTCOME` / `TOO_MANY_REVIEWS`） | 收紧校验，本侧原调用不受影响 | 两项新码已入表 |
| CCR-2026-004 | `/submit` 响应真实性（`progressed` / `problems`） | 本侧据此新增 `PROVIDER_REVISION_REQUIRED` 诚实分支 | ✅ |
| CCR-2026-005 | 事件类型「只声明、从未发出」补齐（`asset.revoked` 等 4 条） | **消除了静默漏撤回风险** | 本侧已实测消费到 `asset.revoked` |

---

## 仍未确认 / 本侧无法单方面关闭的项

| # | 项 | 状态 | 责任方 | 说明 |
|---|---|---|---|---|
| 1 | `resubmit`（重提）能力 | **未实现**（提供方 B-4，产品决策） | Library（产品） | 本侧已按「新建申请 + 新幂等键」实现恢复路径；**不擅自扩展状态机** |
| 2 | 官方 Skill V1.2 入库并权威生效 | `BLOCKED` | 业务方（提供材料） | 本侧机制就绪，未见原件 |
| 3 | SPECIAL-01 专业字典正式原件 | `BLOCKED` | 业务方（提供原件） | 全部相关枚举保持 `PROVISIONAL`，**未核验** |
| 4 | 跨主机 TLS 终结 | `NOT_RUN` | 环境 | 本轮为回环直连（`allowLoopbackHttp` 显式开启且**仅限非生产**） |
| 5 | 真实外部 AI 供应商 | `BLOCKED` | 业务方（凭据） | 无凭据，**不从 mock 推 REAL** |
| 6 | 线上部署/可达性 | `NOT_RUN` | 用户 | 用户明令禁止部署生产 |

---

## 签署区

> **本区留空，不得由任何自动化工具代填。** 需双方授权人**人工**签署。

| 角色 | 姓名 | 日期 | 意见 |
|---|---|---|---|
| 消费方（Marketing OS）授权人 | | | |
| 提供方（企业资料库）授权人 | | | |
