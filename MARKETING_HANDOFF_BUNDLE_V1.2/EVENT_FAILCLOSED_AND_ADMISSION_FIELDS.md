# 事件 fail-closed 与准入三必填字段（B1②③）

> 需求：B 包 Phase B1 第 2、3 条
> 实现：`lib/mos/eventconsumer.js`、`lib/mos/admissionlib.js`、`lib/mos/workspace-contract.js`
> 证据：`evidence/dual-security-result.json`（`D6-41…D6-53`）+ 全量回归 `all` 546/546

---

## 1. 7 类事件：类型字面量与动作

事件类型是**冻结枚举**，必须与 Provider `lib/integration/events.js` 的 `EVENT_TYPES`
**逐字节一致**（`lib/mos/workspace-contract.js:EVENT_TYPES`，7 项）：

| # | 事件类型 | 本侧动作 | 是否阻断正式输出 |
| --- | --- | --- | --- |
| 1 | `asset.revoked` | 登记失效 + **本地引用置 `INVALIDATED` / `permissionValid=false` / `assetState=REVOKED`** | ✅ 阻断 |
| 2 | `asset.deprecated` | 同上（停用） | ✅ 阻断 |
| 3 | `skill.version.changed` | 登记 Skill 版本失效（正式输出必须落在 EFFECTIVE 版本） | ✅ 阻断 |
| 4 | `permission.changed` | **丢弃全部票据**（强制重新换票）+ 本品牌引用全部失效 | ✅ 阻断 |
| 5 | `service_account.changed` | **丢弃全部票据**（票据与签发账户绑定） | —（间接） |
| 6 | `policy.version.changed` | 记录策略版本变化（供对账） | — |
| 7 | `admission.state.changed` | 记录准入状态变化（供对账） | — |

**易踩坑（已固化）**：`service_account.changed` 是**下划线**，不是 `service.account.changed`；
`skill.version.changed` 属 §F 正式 Skill 批准/生效/废止/撤回事件，**必须**在枚举内。

### 幂等

`applyEvent()` 按 `(brandId, seq)` 去重：重复投递返回 `DUPLICATE_SEQ` 且**无副作用**；
`processedSeqs` 有上限（滚动裁剪），游标 `lastSeq` 单调递增。

---

## 2. fail-closed：三种"不确定"的处理（**各不相同，勿混**）

| 情形 | 语义 | 本侧动作 | 关键设计 |
| --- | --- | --- | --- |
| **未知事件类型** | 认知不完整（可能有未实现的契约变更） | `markReconcileNeeded()`：置位 `reconcileRequired` + 记录 `reconcileReason=UNKNOWN_EVENT_TYPE:…` + 留痕 `unhandledTypes`（保留最近 20 条），效果串 `unhandled:<type>:reconcile_required` | **不静默忽略**，但**不**因此清空既有失效登记 —— 未知事件不代表既有结论作废 |
| **`truncated=true`** | 事件窗口**不完整**（游标落后于保留窗口），增量已不可信 | 清空事件累积的失效登记（`clearInvalidations`）+ 清空 `processedSeqs` + 游标重置到 `oldestCursor`，并顺带 `clearReconcileNeeded` | 这是一次**真正的全量对账** |
| **断线 / 连续失败** | Provider 不可用或拒绝 | `consecutiveFailures ≥ 2` → `degraded = true`，逐条返回 `ok:false` + `errorCode` | **不缓存结论**：使用前必须重新验证（`/integration/asset-usage-check`），Provider 不可用时 fail-closed |

### 未映射用户 = **零出站**

`pollBrand()` 首先调用 `client.resolveProviderUser(userId)`：

- 未配置 / 未映射 → 立即 `ok:false` 且 **不发起任何出站**
  （`errorCode: NO_PROVIDER_USER_MAPPING`），连续 2 次即 `degraded`。
- **绝不**用服务身份或匿名身份顶替 —— Provider 的票据是**绑人**的，冒用会污染审计轨迹。

`D6-39` 实测：未映射身份触发探测 → `probes=0`（零出站），如实拒绝。

---

## 3. 准入三必填字段（Provider 定义枚举，本侧只映射与校验）

| 字段 | 取值来源 | 本侧规则 |
| --- | --- | --- |
| `libraryPrimaryCategory` | Provider 资料区 `01–07` | **必须人工选择**，缺失即预检失败；**不得猜测** |
| `classification` | `open / internal / restricted / executive` | **必须人工核定**；**不得猜测降级** |
| `licenseStatus` | `cleared / pending / restricted / expired / unknown` | 历史自由文本保守转 `unknown` 并置 `needsManualReview`，须人工核定后才可入库 |

### 预检（`admissionlib.precheck()`）逐项

| check id | 判定 |
| --- | --- |
| `asset_exists` | 工作素材存在 |
| `digest_matches` | 素材 `sha256` 与建单时一致（被替换则须重提） |
| `origin_known` | 来源 ∈ `UPLOADED / GENERATED` |
| `brand_consistent` | 素材与申请同品牌 |
| `mock_labeled` | MOCK 产物**可入库演示但不得对外发布** |
| `category_present` | 已选 A01–A08 资产分类 |
| `library_primary_category` | 三必填字段之一 |
| `classification_declared` | 三必填字段之一 |
| `license_status_declared` | 三必填字段之一 |
| `license_not_guessed` | 许可非"自由文本猜来的 unknown" |
| `no_manual_review_flag` | 无历史迁移遗留的补齐标记 |
| `provider_fields_complete` | 三必填字段**汇总**检查（避免只看单项漏判） |
| `reuse_scope_usable` | `reuseScope` 不得为 `none`/缺失（否则 Provider 预检必然卡死） |
| `license_admissible` | `expired/unknown` 会被 Provider 预检阻断，**提前告知** |
| `not_duplicate` | 同品牌同内容指纹未在库（重复按幂等处理） |

`verdict = checks.every(ok) ? 'PASS' : 'FAIL'`；**未 PASS 不得提交最终审批**（`409 PRECHECK_REQUIRED`）。

### 错误状态与幂等

- 字段缺失 / 状态非法 → 明确错误码（如 `ILLEGAL_STATE`、`PRECHECK_REQUIRED`、`BAD_ADMISSION_INPUT`），
  并返回 `missing[]`。
- **未配置优先**：未配置集成时先返回 `INTEGRATION_NOT_CONFIGURED`（**零出站**），
  再做参数校验 —— 保证 WC-15 不变量（不因本地校验把"未配置"变成"参数错"）。
- 建单幂等键 `idempotencyKey`：重复提交返回同一申请，**历史记录与审计不丢**。

---

## 4. 端到端证据（真实双进程）

| # | 断言 | 结果 |
| --- | --- | --- |
| `D6-41` | 建单携带三必填字段（`libraryPrimaryCategory` / `classification` / `licenseStatus`） | ✅ `200` |
| `D6-42` | 预检 PASS（**独立**预检员执行；`ASSET_REVIEWER` 不含最终审批权） | ✅ `verdict=PASS fail=[]` |
| `D6-43` | 送审产生 `ASSET_ADMISSION` 审核单（**提交人不得自批**） | ✅ |
| `D6-44` | 授权主体完成最终审批（持有 `library.asset.approve.final`） | ✅ `200` |
| `D6-45` | 首次同步被拦：申请 ≠ 资产（**不中途可用**） | ✅ `syncStatus=FAILED libraryId=null` |
| `D6-46` | 重试同步取得正式 Asset ID，适配层记为 **REAL**（非 MOCK） | ✅ `approvalMode=REAL` |
| `D6-47` | 引用 `permissionValid=true` / `assetState=ACTIVE` / `mock=false` | ✅ |
| `D6-49` | 撤回 → 事件消费 → 本地引用失效（**可审计**） | ✅ `tick.ok=true totalItems=30 invalidations=3 permissionValid=false` |
| `D6-50/51` | 失效后 FORMAL 被阻断（只判定 + 真生成两端一致） | ✅ `blockers=[SKILL_NOT_EFFECTIVE, LIBRARY_REF_INVALIDATED, LIBRARY_REF_NOT_REUSABLE]` |
| `D6-52` | `TEST_DRAFT` 不阻断（草稿允许） | ✅ `200` |
| `D6-53` | `REFERENCE_ONLY` Skill 一律阻断（**不用草稿冒充**） | ✅ |

### 7 类事件的**回归覆盖**

7 类事件的逐类型行为由既有套件覆盖并在本轮**全量回归**中通过：

| 套件 | 覆盖 |
| --- | --- |
| `workspace`（36 断言） | 契约符合性、事件类型字面量、错误码表 |
| `provider`（21 断言） | Provider 契约与枚举 |
| `e2e02` / `e2e03`（含事件消费、截断、未知事件、重对账、撤回传播） | 事件 fail-closed 路径 |
| `build06` `D6-49` | **真实 HTTP** 撤回 → 事件 → 失效 |

> 本轮**未新增**事件类型、**未改**共享契约；`EVENT_TYPES` 仍为 7 项字面量冻结枚举。
