# 正式输出门禁（B1）—— 失效对象不得生成新正式作品

> 需求：B 包 Phase B1 第 2 条
> 「Revoked / Deprecated / 权限撤销 / Skill 失效**不得继续生成新正式作品**」
> 实现：`lib/mos/formalguard.js`（唯一权威判定）+ `POST /api/mos/formal-output-check`（只判定）
> 证据：`evidence/dual-security-result.json` 的 `D6-48…D6-53`

---

## 1. 为什么需要它（本轮发现的**真实缺陷**）

门禁上线之前，`POST /api/mos/generation-jobs` **只对 `kind: 'IMAGE'` 走 `skill.buildPrompt()`**，
而 `kind: 'TEXT'` **从不校验 `outputIntent`** —— 也就是说：

> **正式（FORMAL）文字作品可以完全绕过品牌 Skill 门禁与资料库引用校验。**

这不是"防御不足"，而是**正式输出链路上的一个真实缺口**。本轮已修复，
并将判定收敛到**单一权威实现**（`lib/mos/formalguard.js`），供
「只判定」端点与「真生成」端点共用，杜绝"门禁放行、生成阻断"的不一致。

---

## 2. 判定模型

```
evaluate(db, { brandCode, task, skillCode, outputIntent, libraryRefIds })
  → { intent, formal, allowed, blockers[], advisories[], detail }
```

| 步骤 | 规则 |
| --- | --- |
| 1 · 归一化意图 | 复用 `skill.normalizeIntent()`（**单一来源**，`lib/mos/skill.js` 导出）。**未识别的 `outputIntent` 一律 fail-closed**（不猜测为草稿） |
| 2 · 是否正式 | `intent === 'FORMAL'` 才进入阻断判定；非正式（如 `TEST_DRAFT`）转为 `advisories`（**提示但不阻断**，且不得对外发布） |
| 3 · Skill | `skill.usability()`：正式输出必须落在**已批准生效**（EFFECTIVE）的品牌 Skill 上 |
| 4 · Brief | 关联 Campaign 的 Marketing Brief `readyForOfficialUse !== false` |
| 5 · 引用可复用 | 复用 `admissionlib.reuseEligibility()`（**不重复实现**可复用规则） |
| 6 · 引用已失效 | 命中 `db.library_invalidations` 中的**阻断类**失效记录 |

### 四类阻断码

| 阻断码 | 含义 |
| --- | --- |
| `SKILL_NOT_EFFECTIVE` | 无可用 EFFECTIVE Skill（含 `REFERENCE_ONLY` / 草稿 / 未批准） |
| `BRIEF_NOT_READY` | Brief 存在未核验宣称/引用，不得正式输出 |
| `LIBRARY_REF_NOT_REUSABLE` | 引用资产当前不可复用（已撤回 / 已废止 / 权限撤销 / 非 ACTIVE / 未核验通过 / 品牌不符） |
| `LIBRARY_REF_INVALIDATED` | 该引用已被**事件消费**登记为本地失效 |
| `LIBRARY_REF_NOT_FOUND` | 引用在本侧未登记（**不猜测、不放行**） |

**阻断类失效事件**（`BLOCKING_INVALIDATION_KINDS`）：
`asset.revoked`、`asset.deprecated`、`asset.not_found`、`skill.version.changed`、`permission.changed`。

---

## 3. 两个入口，同一份判定

| 入口 | 行为 |
| --- | --- |
| `POST /api/mos/formal-output-check` | **只判定**：不出站、不落盘、不产出；返回 `intent/formal/allowed/blockers/advisories/detail` |
| `POST /api/mos/generation-jobs` | **真生成**：在幂等判定与 Provider 模式解析之后、**任何出站与落盘之前**执行门禁；阻断即 `409 FORMAL_OUTPUT_BLOCKED` |

阻断响应体（经 `lib/util.js:sendError()` 白名单透传，仅 `code/note/refId/libraryId/skillState`，长度受限，**不含机密**）：

```json
{ "ok": false, "code": "FORMAL_OUTPUT_BLOCKED",
  "error": "正式输出被门禁阻断：…",
  "intent": "FORMAL",
  "blockers": [ { "code": "SKILL_NOT_EFFECTIVE", "note": "…", "skillState": "REFERENCE_ONLY" },
                { "code": "LIBRARY_REF_INVALIDATED", "note": "…", "refId": "…" },
                { "code": "LIBRARY_REF_NOT_REUSABLE", "note": "…", "refId": "…" } ] }
```

---

## 4. 端到端证据（**真实双进程**，非模拟）

链路：`MOS 上传工作素材 → 建准入单 → 独立预检员预检 → 送审（独立审核链）→ 授权主体最终审批 → 首次同步被拦 → 重试同步取得正式 Asset ID → 建立可复用引用 → Provider 撤回 → 事件消费 → 本地引用失效 → 正式生成被阻断`

| # | 断言 | 结果 |
| --- | --- | --- |
| `D6-40` | 工作素材上传成功（真实落盘 + sha256） | ✅ `200`，`wa_mv6v49up_18fc408df59b` |
| `D6-41` | 建单携带三项 Provider 必填字段（`libraryPrimaryCategory` / `classification` / `licenseStatus`） | ✅ `200` |
| `D6-42` | 预检 PASS（由**独立**预检员执行；`ASSET_REVIEWER` **不含**最终审批权） | ✅ `verdict=PASS fail=[]` |
| `D6-43` | 送审产生 `ASSET_ADMISSION` 审核单（**提交人不得自批**） | ✅ `rc_mv6v49x6_c8765eb98eaa` |
| `D6-44` | 授权主体完成最终审批（须持有 `library.asset.approve.final`） | ✅ `200` |
| `D6-45` | **首次同步被拦**：申请 ≠ 资产，不中途可用 | ✅ `syncStatus=FAILED libraryId=null` |
| `D6-46` | 重试同步取得 Provider 正式 Asset ID，适配层记为 **REAL（非 MOCK）** | ✅ `COMPLETED / approvalMode=REAL / VFIB-ASSET-2026-0002` |
| `D6-47` | 建立真实可复用引用（`permissionValid=true`，`assetState=ACTIVE`，`mock=false`） | ✅ |
| `D6-48` | **撤回前**：引用可复用，阻断项中**不含** `LIBRARY_REF_*`（证明引用本身不是问题） | ✅ `blockers=["SKILL_NOT_EFFECTIVE"]` |
| `D6-49` | **撤回传播**：Provider 撤回 → 事件消费 → 本地引用 `permissionValid=false` | ✅ `revoke=200 tick.ok=true totalItems=30 invalidations=3 permissionValid=false` |
| `D6-50` ★ | **撤回后**：FORMAL 被阻断，且出现 `LIBRARY_REF_INVALIDATED` / `LIBRARY_REF_NOT_REUSABLE` | ✅ `blockers=["SKILL_NOT_EFFECTIVE","LIBRARY_REF_INVALIDATED","LIBRARY_REF_NOT_REUSABLE"]` |
| `D6-51` ★ | **生成端点同源门禁**：FORMAL 生成被 `409 FORMAL_OUTPUT_BLOCKED`（含引用失效明细） | ✅ `409`，`blockers` 同上 |
| `D6-52` | **对照**：同一引用在 `TEST_DRAFT` 下**不阻断**（草稿允许，但不得对外发布） | ✅ `200` |
| `D6-53` | **INT-10 关联**：正式输出要求**已批准生效** Skill；`REFERENCE_ONLY` 一律阻断（**不用草稿冒充**） | ✅ `skillState=REFERENCE_ONLY` |

> `D6-48` 与 `D6-50` 是**配对**断言：先证明"引用本身没问题时不会误伤"，再证明"撤回后确实被阻断"。
> 只做后者无法排除"门禁对任何引用都阻断"的假阳性。

---

## 5. 服务账号撤销后的本侧行为（**不得静默降级为"成功"**）

| # | 断言 | 结果 |
| --- | --- | --- |
| `D6-54` | 服务账号被撤销后：MOS 探测**全部失败且无一条 `ok=true`** | ✅ `probes=3, ok 数=0, codes=["BAD_SERVICE_ACCOUNT","BAD_SERVICE_ACCOUNT","BAD_SERVICE_ACCOUNT"]` |
| `D6-55` | 本侧**如实记录**安全类拒绝（`securityRejections` 按码计数，**不含任何凭据材料**） | ✅ `byCode={"BAD_SERVICE_ACCOUNT":3}`，`last` 仅含 `code/httpStatus/endpoint/requestId/at` |

`securityRejections` 由 `lib/mos/workspace-client.js` 的 `SECURITY_REJECTION_CODES`（28 项）驱动，
经 `GET /api/mos/integration/workspace` 的 `status.securityRejections` 暴露，
**进程内计数、重启清零**，并显式标注不含凭据材料。

---

## 6. 明确的边界

- `TEST_DRAFT` **不阻断**（`D6-52`），但草稿**不得对外发布**——发布链路由 `P3` / `PUBLISHING_APPROVER`
  独立把关，且 Published Content 只在中台归档（见 `PUBLISHED_ARCHIVE_ISOLATION.md`）。
- 门禁**不**替代 Provider 侧准入；它只回答"本侧此刻是否允许把该对象写进**正式**作品"。
- 无 EFFECTIVE Skill 时门禁**必然**阻断（`D6-53`）——这是 **fail-closed 的正确表现**，
  也意味着 INT-06 的正向验证仍待 Skill V1.2 正式生效（见 `BLOCKED_ITEMS_V1.2.md`）。
