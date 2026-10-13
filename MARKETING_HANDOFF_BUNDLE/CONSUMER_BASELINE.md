# CONSUMER_BASELINE.md —— 消费方（Marketing OS）基线

> 执行包：《VFIB 双系统真实联调与最终验收执行包 V1.0》
> 本文件对应 `02_MARKETING_OS_CODEX_TASK.md` **Phase M0-1**。
> 身份：**Integration Consumer（接口消费方）+ 跨系统联调牵头方**。
> 编制日期：2026-10-13

---

## 1. 真实版本与提交（实取，非引用）

| 项 | 实测值 | 取证方式 |
|---|---|---|
| 仓库 | `475022876/watu-operation` | `git remote -v` |
| 分支 | `main` | `git rev-parse --abbrev-ref HEAD` |
| 基线提交 | `3c19e79e0e90b3feb26b024678f3765769ea866b` | `git rev-parse HEAD` |
| 提交主题 | `feat(tools): 口令重置工具新增 --rename（改名不改 ID，保留角色授权）` | `git log --oneline -1` |
| `package.json` version | `0.1.0` | `package.json` |
| 运行时 | Node.js（零第三方依赖，`dependencies: {}`） | `package.json` |
| 监听端口 | 9080（自测 9500–9699；e2e03 9700+） | `lib/config.js` |
| 数据 schema | `MOS_SCHEMA_VERSION = 4` | `lib/mos/store.js` |
| 数据文件 | 单 JSON（`data/mos.json`），原子写入（唯一 tmp + `renameSync`） | `lib/mos/store.js` |

> **诚实性提示**：历史审计材料曾称「Marketing OS V0.1 整改版」。本文件以**当前仓库 `package.json`、实际提交与运行代码**为准；
> 上面的提交号即为本轮全部结论所绑定的基线。

## 2. 运行方式（可复现）

```bash
# 本地启动（127.0.0.1:9080）
node server.js

# 全量回归（10 套件，结果落 TEST_EVIDENCE_MOS_BUILD*/ 与 UI_EVIDENCE_MOS_BUILD*/）
bash tools/run-mos-tests.sh all

# 仅企业资料库契约离线自检（无需服务、无需凭据）
bash tools/run-mos-tests.sh workspace
```

## 3. 集成现状实取（`config.json` → `mos.*`）

```
integrations: { identity:"mock", knowledge:"mock", library:"mock",
                sourceIngest:"real", textProvider:"none", imageProvider:"none" }
workspace:    {}      ← 未配置（无 baseUrl / keyId / 私钥）→ NOT_CONFIGURED，fail closed，零出站
text:         {}      ← 无凭据 → NOT_CONFIGURED
image:        {}      ← 无凭据 → NOT_CONFIGURED
scheduler:    {}      ← 默认关闭（enabled=false）
```

## 4. 消费方适配层现状（Phase M0-1 检查对象）

| 文件 | 作用 | 现状 |
|---|---|---|
| `lib/mos/workspace-contract.js` | 与 Workspace 契约的**逐字节对齐实现**（常量表/签名/封套/错误码/事件类型/准入入参校验） | 已实现；36 断言离线自检通过 |
| `lib/mos/adapters/workspace.js` | 受控调用方适配器（11 业务方法 + 结构性拒绝的 `finalDecision`） | 已实现；未配置即 fail closed |
| `lib/mos/adapters/library.js` | 资料库**沙盒**适配器（MockLibraryGateway） | `mock`：回执恒 `MOCK_` 前缀、`permissionValid:false`、`AVAILABLE` 结构性不可达 |
| `lib/mos/adapters/knowledge.js` | 企业知识检索（MockKnowledgeGateway） | `mock`：返回带 `sandbox:true` 的沙盒条目 |
| `lib/mos/adapters/identity.js` | 身份与登录（MockIdentityGateway） | `mock` |
| `lib/mos/adapters/text.js` / `image.js` | 文本 / 图像 Provider 契约面 | `none` → `NOT_CONFIGURED` |

## 5. 本轮新增的契约符合性修正（2026-10-13）

以本机存在的 Workspace **V1.1.7** 源码做**只读静态交叉核验**，发现并修正 5 处**本侧对既有契约的符合性缺陷**（**未改动共享契约本身**，详见 `CONTRACT_DIFF.md`）：

| 编号 | 缺陷 | 影响 | 处理 |
|---|---|---|---|
| C-01 | `EVENT_TYPES` 写成 `service.account.changed`，实际为 `service_account.changed` | 事件类型判定永远失配 | 已按源码修正 |
| C-02 | `EVENT_TYPES` 缺 `skill.version.changed` | **Skill 生效版本变化被静默忽略**（INT-06/INT-08 相关） | 已补 |
| C-03 | 错误码表缺 `BAD_ADMISSION_INPUT` / `USER_NOT_FOUND` / `ERROR` 等 | 失败分层落 `unknown`，重试判定失真 | 已补（含 2 个运维登记面码） |
| C-04 | `knowledgeSearch` 发 `limit`，服务端实际读取 `body.topK` | 服务端忽略入参并回落到默认 10 条 | 改发 `topK`（`limit` 保留为兼容别名） |
| C-05 | `assetsSearch` 未暴露 `offset` 与三类过滤 | 无法翻页（服务端以 `body.offset` 分页） | 已支持 offset/categoryId/subcategoryId/marketingCategory |
| C-06 | `createAdmission` 只发 7 个字段，其中**缺 2 个服务端必填**（`libraryPrimaryCategory`、`licenseStatus`） | **发出一份必然被 400 拒绝的请求** | 改为出站前同构预校验，缺字段即 `BAD_ADMISSION_INPUT` + `missing[]`，**零出站**（fail closed） |

回归结果：`workspace` 套件由 30 → **36 断言全通过**；全量回归见 `E2E_TEST_REPORT.md`。

## 6. 契约核验的**证据等级声明**（重要）

上述交叉核验的对象是本机 `D:\企业数据后台\oa-system-20261004\oa-system`（`package.json` version **1.1.7**，分支名 `feat/v1.1.3` 已过时）。
它**不是**执行包所要求的 `LIBRARY_HANDOFF_BUNDLE`，也**不是**任何真实网络联调。

| 等级 | 含义 | 本轮是否达成 |
|---|---|---|
| 静态源码交叉核验 | 只读比对双方源码常量/字段/路由 | **已达成**（证据见 §5 与本文件 §7） |
| `REAL_VERIFIED` | 双方真实分进程运行、真实权限上下文、可复现运行证据 | **未达成**（见 `REAL_MOCK_STATUS.md`） |

## 7. 静态交叉核验证据（实取 Workspace V1.1.7）

| 契约要素 | Workspace 侧实取 | Marketing OS 侧 | 一致性 |
|---|---|---|---|
| 路由前缀 | `/api/integrations/marketing` （`lib/routes/integrations.js`） | 同 | ✅ |
| `canonicalString` | `['v1', keyId, METHOD, pathname, timestamp, nonce, bodyHash].join('\n')` | 同 | ✅ |
| 服务 scope（8 项） | `knowledge.search / assets.search / assets.read / admissions.write / admissions.read / skills.read / changes.read / tickets.issue` | 同 | ✅ |
| 票据 scope | 上述 8 项 + `admission.final.decision` | 同 | ✅ |
| 会话专属范围 | `SESSION_ONLY_SCOPES = ['admission.final.decision']` | 同 | ✅ |
| 策略版本 | `policy.POLICY_VERSION = '1.0'` | `CONTRACT_VERSION = '1.0'` | ✅ |
| 响应封套 | `{ok, data, error, request_id, policy_version}`；失败 `data` 恒 `null` | 同（`isEnvelope()` 强制） | ✅ |
| 端点注册表 | 12 条（health/tickets/knowledge.search/assets.search/assets\:id/admissions/admissions\:id/submit/admissions\:id/artifact/admissions\:id/admissions\:id/final-decision/skills\:id/changes） | 12 条一一对应 | ✅ |
| 事件类型 | 7 条（含 `skill.version.changed`、`service_account.changed`） | 修正后一致 | ✅（修正前 ❌） |
| 准入必填字段 | `idempotencyKey / originObjectId / brandId / libraryPrimaryCategory / classification / licenseStatus / title`（`normalizeAdmissionInput()`） | 已建同构校验 | ✅（修正前缺字段） |
| 资产类别 | `MARKETING_CATEGORIES = A01…A08` | 同 | ✅ |
| 资料区 | `CATEGORIES id = 01…07` | 已建 `LIBRARY_PRIMARY_CATEGORIES` | ✅ |
| 密级 | `open / internal / restricted / executive` | 已建 `CLASSIFICATIONS` | ✅ |
| 许可状态 | `cleared / pending / restricted / expired / unknown` | 同 | ✅ |
| 复用范围 | `none / internal_reference / brand_kit / campaign_reuse / unrestricted` | 同 | ✅ |
| 外部 AI 策略 | `blocked / allowed`（缺省 `blocked`） | 同 | ✅ |
| 最终审批 | 端点强制 `kind=session` + `canApproveMarketingAdmission(user)` | 适配器 `finalDecision()` 结构性恒拒绝 | ✅ |
| Published Content 归档 | `capabilities.publishedContentArchive = false` | 归档只在 Marketing OS | ✅ |

## 8. 结论

- 消费方**接口层已就绪**，且已按 Workspace V1.1.7 **实取源码**完成符合性修正。
- **真实联调未发生**：`LIBRARY_HANDOFF_BUNDLE` 未交付（本机全域检索无产物），Workspace 侧亦无 `PROVIDER_BASELINE.md` / `PROVIDER_API_OPENAPI.yaml` / `SERVICE_AUTH_HANDOFF.md` / `TEST_FIXTURES.md`。
- 因此本轮全部 `REAL_*` 项为 **BLOCKED / NOT_VERIFIED**，结论见 `JOINT_ACCEPTANCE_REPORT.md`。
