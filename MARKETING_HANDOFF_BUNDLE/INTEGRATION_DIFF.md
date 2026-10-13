# INTEGRATION_DIFF.md —— 与资料库真实契约的逐项对应情况

> 对应 `02_MARKETING_OS_CODEX_TASK.md` **Phase M4** 交付项；
> 覆盖 `03_SHARED_CONTRACT_AND_ACCEPTANCE.md` §2「必须共同固定的契约」全部条目。
> 基线提交 `3c19e79` ｜ 编制日期 2026-10-13

---

## 0. 证据等级

| 等级 | 说明 | 本轮状态 |
|---|---|---|
| **A. 静态源码交叉核验** | 只读比对 Workspace 源码副本（V1.1.7）与本侧实现 | ✅ 已做（逐项见下） |
| **B. 离线契约自检** | 本侧桩服务按契约复刻验签/防重放/封套，36 断言 | ✅ 全通过 |
| **C. 真实网络联调** | 双方分进程运行 + 真实权限上下文 + 可复现证据 | ❌ **BLOCKED**（`LIBRARY_HANDOFF_BUNDLE` 未交付） |

> 下表「对应情况」列中的 ✅/⚠/❌ 均指 **A/B 级**结论；**任何一项都不构成 C 级联调通过**。

## 1. 契约要素逐项对应表

| # | 契约项（§2 原文） | Workspace 侧实际 | 本侧实现 | 对应情况 | 备注 |
|---|---|---|---|---|---|
| 1 | Base URL（仅测试环境） | 由 Provider 配置下发 | `mos.workspace.baseUrl` | ⏳ `NOT_CONFIGURED` | **等 Provider 提供测试地址** |
| 2 | paths / methods | 12 端点（见 `CONSUMER_BASELINE.md` §7） | 12 端点一一对应 | ✅ | 含文档 §4.1 未列出的 `GET /skills/:id` |
| 3 | Content-Type | `application/json`（带体请求） | 有体请求即设 `application/json` | ✅ | |
| 4 | 版本号 | `policy_version: '1.0'` 每响应回带 | 解析并保留 `policyVersion` | ✅ | |
| 5 | schema 与错误码 | 见 `CONTRACT_DIFF.md` D-03 | 错误码表 + 分层 + 可重试判定 | ⚠ | 已补 5 类码；**是否闭合枚举待确认** |
| 6 | `correlation_id` 贯穿双方日志 | 请求头 `x-vfib-correlation-id` + 响应 `request_id` | 每请求生成 `mos-<12hex>`，保留 `requestIdHeader` | ✅ | 本侧审计与响应均落 `requestId` |
| 7 | 服务账户身份与 scope | 8 个 scope（`service-accounts.js SCOPES`） | 同 8 个常量 | ✅ | |
| 8 | 签名算法 / 时钟窗口 / nonce / 重放防护 | Ed25519；`v1\n…`；时间窗 + nonce 集合去重 | 同构实现（`signedHeaders`）+ 本地同构验签 | ✅ | 本侧 `retryable` 按码判定（`NONCE_REPLAY`/`BAD_SIGNATURE` 不可重试） |
| 9 | 用户受限票据的获取/校验/过期/撤销 | `POST /tickets` 签发；`TICKET_EXPIRED` 可重试；`TICKET_KIND_MISMATCH` 不可重试 | `issueServiceTicket()` 本地即剔除 `admission.final.decision` | ✅ | **票据刷新策略未实现**（见 §3 待办 T-03） |
| 10 | 入库幂等键 / 重复提交语义 | 同源同幂等键 → 返回**同一申请**（`created:false`） | 透传 `idempotencyKey` | ✅ | |
| 11 | 409 冲突 | `ASSET_CONFLICT`（内容 hash 撞既有母版，回既有 Asset ID） | 归 `business` / 不可重试 | ✅ | |
| 12 | 429 限流 | `RATE_LIMITED` | 归 `service` / **可重试** | ✅ | 本侧未实现退避调度（见 T-04） |
| 13 | 403 / 404 / 410 / 503 | `TICKET_KIND_MISMATCH`/`SCOPE_NOT_GRANTED`/`BRAND_MISMATCH`/`FINAL_APPROVAL_FORBIDDEN`；`NOT_FOUND`（不可探测）；`ASSET_GONE`；`INTEGRATION_DISABLED` | 逐码分层；`ASSET_GONE` → 清缓存 | ✅ | |
| 14 | 分页 / cursor | `knowledge` 不分页；`assets` offset+`nextCursor`；`changes` seq cursor | 三种语义分别处理 | ⚠ | 见 `CONTRACT_DIFF.md` D-05 |
| 15 | 重试策略 | 由 `retryable` 语义界定 | 按 `ERROR_CODES` 表判定；**未识别码一律不可重试**（fail-safe） | ⚠ | 需双方确认闭合性 |
| 16 | `brand_id` | `brand_id` 必填；`BRAND_MISMATCH`(403) 拒绝跨品牌 | 透传 `brandId` | ✅ | 本侧 8 工作中心为品牌隔离前置 |
| 17 | `source_object_id` | `originObjectId`（必填） | 由工作素材 ID 派生 | ✅ | |
| 18 | `source_version_id` | `originVersionId`（可选） | 由内容版本 ID 派生 | ✅ | |
| 19 | hash | `contentHash`（可选但强校验：64 位小写 hex） | 由 `working_assets.sha256` 直供 | ✅ | |
| 20 | 资产类别 A01—A08 | `MARKETING_CATEGORIES` | 已有 `categoryCode` | ✅ | |
| 21 | 许可 / 复用 / 外部 AI 策略 | `licenseStatus`(必填) / `reuseScope` / `aiReusePolicy` / `externalAiTransferPolicy` | **三项缺失** | ❌ | 见 `CONTRACT_DIFF.md` D-06 → **阻塞项** |
| 22 | 权限 | 以票据解析出的**真实用户**为主体判定 | 本侧不代判；仅透传票据 | ✅ | 服务账户 scope 只决定"能否进门" |
| 23 | 正式 Asset ID 与版本字段 | `libraryAssetId` / `libraryVersionId` / `documentId` / `version` | 回执字段直存 | ✅ | Mock 下恒 `MOCK_` 前缀 |
| 24 | Approved vs Effective vs Revoked vs Deprecated | `ABSENT → FINAL_APPROVED → ADMISSION_PENDING → ADMITTED`，`REVOKED`/`DEPRECATED` 终态 | 状态机常量已对齐（13 态） | ✅ | |
| 25 | `final approved` vs `admitted/available` | **双字段互不推导**；`isReusable` 需 `admitted` 完成 | 本侧 `reuseEligibility` 同样"只计算、不存储" | ✅ | |
| 26 | 撤回/Skill 生效版本变化的事件方式 | 增量轮询（`GET /changes`，seq 游标）；**无 webhook** | `changes()` 已实现 | ⚠ | **轮询调度器未实现**（T-05）；容忍时延未约定 |
| 27 | 网络不可用时拒绝新授权调用 | — | 本侧原则：不静默使用过期缓存 | ⚠ | **本侧尚未落地"缓存 TTL + fail closed"**（T-06）；且当前无缓存层 |

## 2. 消费方**已达成**的能力（A/B 级证据）

1. **签名与防重放**：Ed25519 同构签名/验签；`NONCE_REPLAY`、`BAD_SIGNATURE`、`TIMESTAMP_OUT_OF_WINDOW` 均按 `service` 层不可重试处理。
2. **封套严格性**：`isEnvelope()` 强制 `{ok,data,error,request_id,policy_version}`；**失败时 `data` 非 null 即判不可信**（可检测封套被破坏）。
3. **不可探测**：`assets/:id` 的 404 与"无权"同响应；本侧不做存在性推断。
4. **零出站 fail closed**：未配置凭据时 `status().configured=false`、所有方法恒 `INTEGRATION_NOT_CONFIGURED`、桩零命中（WC-15/16/33 断言）。
5. **结构性拒绝最终审批**：`finalDecision()` 恒返回 `TICKET_KIND_MISMATCH`，不可被配置绕过（WC-26）。
6. **密钥不外泄**：`status()`/`capabilities()`/响应序列化均不含私钥 PEM 或票据原文（WC-28 断言）。
7. **不走浏览器**：适配器仅存在于 `lib/mos/adapters/workspace.js`（服务端）；前端 `public/mos/js/**` 中**无**任何资料库凭据或直连代码。

## 3. 本侧已知缺口（**联调前须补齐**）

| 编号 | 缺口 | 依据 | 形成条件 |
|---|---|---|---|
| T-01 | 准入表单/实体缺 `libraryPrimaryCategory`、`classification`、枚举化 `licenseStatus` | §2 第 21 项 / D-06 | 需 Provider 回答语义后新增字段与表单 |
| T-02 | `admissions/:id/submit` 的 `reviews[]` 未做 schema 校验（仅透传） | §2 第 21 项 / D-07 | 需 Provider 给出逐字段 schema |
| T-03 | 票据**刷新**（`TICKET_EXPIRED` 后自动重取）未实现 | §2 第 9 项 | 需 Provider 给出 `ttlSeconds` 策略与重取语义 |
| T-04 | `RATE_LIMITED` 退避调度未实现（仅标记可重试） | §2 第 15 项 | 需 Provider 给出 `rateLimitPerMinute` 与配额窗口 |
| T-05 | `GET /changes` **轮询调度器**未实现（方法可用，无定时轮询） | §2 第 26 项 | 需约定容忍时延（建议 ≤60s）与失败回退 |
| T-06 | 授权缓存层（TTL + 网络不可用 fail closed）未实现 | §2 第 27 项 | 需与 Provider 约定 TTL 与"撤回 → 拒绝"的最大时延 |
| T-07 | `knowledge/search` 的 `filters` 未暴露 | D-04 | 需 Provider 给出 filters schema |

> 上述 7 项**均以「资料库侧契约确认」为前置**。在 `LIBRARY_HANDOFF_BUNDLE` 未交付前实现它们
> 属于**凭猜测调整**，为 `03_SHARED_CONTRACT_AND_ACCEPTANCE.md` §2 明令禁止。

## 4. 反向核验：Provider 侧尚缺的产物

本机全域检索**未发现**以下应由资料库项目交付的产物（`01_WORKSPACE_CODEX_TASK.md` 要求）：

| 产物 | 状态 |
|---|---|
| `LIBRARY_HANDOFF_BUNDLE/PROVIDER_BASELINE.md` | ❌ 不存在 |
| `.../PROVIDER_API_OPENAPI.yaml`（由真实路由推导） | ❌ 不存在 |
| `.../SERVICE_AUTH_HANDOFF.md`（非敏感配置键名/公钥指纹/协商方式） | ❌ 不存在 |
| `.../TEST_FIXTURES.md`（合成测试身份/权限矩阵/样本资产与 Skill） | ❌ 不存在 |
| `.../PROVIDER_TEST_REPORT.md` | ❌ 不存在 |
| `.../PROVIDER_BLOCKERS.md` | ❌ 不存在 |
| `.../CHANGELOG.md` | ❌ 不存在 |

**结论**：由于上述产物缺失，本侧**无法**完成 M1 的真实接入、也**无法**取得测试服务身份与凭证 →
M1/M2/M3 的真实联调部分全部 **BLOCKED**（详 `REAL_MOCK_STATUS.md` 与 `JOINT_ACCEPTANCE_REPORT.md`）。
