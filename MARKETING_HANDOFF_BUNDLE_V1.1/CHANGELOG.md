# CHANGELOG.md —— V1.1 三包整改变更清单

> 交付包：`MARKETING_HANDOFF_BUNDLE_V1.1/`
> 依据：B 包 `03_HANDOFF_AND_REPORT.md` 第 12 项
> 版本：**V1.1（三包整改）**
> 日期：**2026-10-13**
> **代码基线：`286fe5bd729f48fd953ba825e17d9772c7018fd8`**（本轮改动**未提交**，见 §6）

---

## 1. 一句话摘要

以 `286fe5b` 为基线，**仅在运营中台仓库**完成 B0—B8 连续整改：
新增 **4 个后端模块**（`workspace-client` / `eventconsumer` + 配套）、**2 个测试套件**
（`dual` 51、`joint` 64）、**1 套双系统真实 HTTP 联调**（64/64）、schema **v4 → v5**；
**零删除**、**零改动 OA 源码**；全量回归 **610/610**。

---

## 2. 变更统计（`git diff --stat`）

```
 README.md                           |   4 +
 docs/CURRENT_ARCHITECTURE.md        |  16 +-
 lib/mos/admissionlib.js             | 226 ++++++++++++++++-
 lib/mos/config.js                   |  85 ++++++-
 lib/mos/routes/admissions.js        | 482 +++++++++++++++++++++++++++++++++++-
 lib/mos/routes/meta.js              | 249 +++++++++++++++++++
 lib/mos/store.js                    |  57 ++++-
 lib/mos/workspace-contract.js       | 154 +++++++++++-
 lib/util.js                         |  16 +-
 public/mos/js/modules/governance.js | 160 ++++++++++++-
 server.js                           |   9 +-
 tools/mos-e2e-build03.js            |  39 ++-
 tools/mos-scheduler-test.js         |   5 +-
 tools/mos-ui-check.js               |  63 ++++-
 tools/mos-unit-test.js              | 174 +++++++++++--
 tools/run-mos-tests.sh              |  13 +-
 16 files changed, 1681 insertions(+), 71 deletions(-)
```

**新增（未跟踪）文件**：

| 文件 | 约行数 | 职责 |
|---|---|---|
| `lib/mos/workspace-client.js` | — | 服务身份签名 + 受限票据 + 准入三步 + 检索 + 事件 + 出站收敛 |
| `lib/mos/eventconsumer.js` | ~500 | 变更事件轮询、游标、失效登记、fail closed、对账位 |
| `tools/mos-dual-identity-test.js` | — | B2/B3 专项（**51/51**） |
| `tools/mos-e2e-build04-dual.js` | ~1000 | 双系统真实 HTTP 端到端（**64/64**） |
| `docs/integration_three_pack_v1.1/` | — | B 包 + C 包逐字节副本（15 份） |
| `MARKETING_HANDOFF_BUNDLE_V1.1/` | — | 本交付包（12 项） |

**删除**：**无**（零删除）。

---

## 3. 按 B 包任务的变更清单

### B0 —— 基线契约差异比对

| 变更 | 说明 |
|---|---|
| `docs/integration_three_pack_v1.1/`（新增） | B+C 包逐字节纳入（20/20 SHA256 校验一致） |
| `lib/mos/workspace-contract.js` | OpenAPI 基线 SHA 校验 + `errorCodeCount` 暴露 |
| 交付物 | `CONTRACT_DIFF_SIGNED.md`（D-00…D-10 逐条） |

### B1 —— 资产准入三项必填字段（**全链路**）

| 文件 | 变更 |
|---|---|
| `lib/mos/admissionlib.js` | 新增 `PROVIDER_REQUIRED_ENTITY_FIELDS`、`reuseScopeUsable()`、`licenseAdmissionGate()`；`precheck()` **新增 2 项检查**（`reuse_scope_usable` / `license_admissible`）；`toProviderAdmissionInput()` 的 `fileName` 兜底 |
| `lib/mos/workspace-client.js` | `pushAdmission()` 新增**两道出站前预检**（缺 `fileName` → `MISSING_FILE_NAME`；`reuseScope` 不过 → `rs.reason`）；新增 `SUBMIT_BLOCKING_STATES` **诚实分支** |
| `lib/mos/routes/admissions.js` | `runRealSync()` 新增 **reuseScope 零出站拦截**；新增 `admissionFieldErrorDetails()`；补齐 `providerState` / `providerProblems` |
| `lib/mos/store.js` | **schema v4 → v5**：新增 4 集合 + 对既有 `asset_admissions` **保守回填** |
| `public/mos/js/modules/governance.js` | `reuseOpts` **不再预选 `none`**；新增 D-06.5 / D-06.4 警示 callout；**前端同构拦截** |
| 交付物 | `ADMISSION_FIELDS_UI_DATA_MIGRATION.md` |

**关键修正（本侧自查缺陷，已披露）**：`routes/admissions.js collectProviderReviews()` 原按
`d.decision||d.outcome` + `d.reviewerId||d.actorId` 读取，**实际决策行字段为 `action` + `actorId` + `remarks`**
→ 恒判 `fail` → Provider 判 `REVISION_REQUIRED` → **申请永久卡死**。修正后 `providerProblems=[]`、
`steps=[SUBMITTED,PRECHECK,REVIEWING,FINAL_APPROVAL_PENDING]`。

### B2 —— 双重身份（服务签名 + 受限用户票据）

| 文件 | 变更 |
|---|---|
| `lib/mos/config.js` | 新增 `workspace.brands` / `ticketScopes` / `ticketTtlSeconds` / `ticketRefreshSkewSeconds` / `allowedHosts` / `allowLoopbackHttp` / `userMap` / `serviceUserId` + 对应 `MOS_*` 环境变量 |
| `lib/mos/workspace-client.js`（新增） | Ed25519 四头签名（canonicalString **7 段**、时间戳**秒级**、pathname **不含 query**）；票据缓存（键 `keyId|brand|user`）+ **并发单飞** + 401 换票**只重试一次**；`resolveProviderUser()` 单一事实来源；`egressGuard()` 出站收敛；`finalDecision()` **结构性恒拒** |
| `lib/mos/workspace-contract.js` | `OPENAPI_ERROR_CODE_ENUM` 保持 **71 项**（冻结）；`ERROR_CODES` 补入 Provider 声明的 2 项 → 运行时 **73 项**；新增 `PROVIDER_DECLARED_ADDITIONS` |
| `server.js` | 挂载 `eventconsumer.start()` / `stop()`（**默认关闭**） |
| 交付物 | `AUTH_AND_EVENTS_REPORT.md` |

### B3 —— 变更事件消费

| 文件 | 变更 |
|---|---|
| `lib/mos/eventconsumer.js`（新增） | 7 条事件字面量；**未知类型 fail-safe** → 置 `reconcileRequired`（**不静默忽略**）；`markReconcileNeeded()` / `clearReconcileNeeded()`；`truncated=true` 全量重验；`degraded` 连续失败 ≥2；`asset.not_found` **单列一类**（与撤回分开） |
| `lib/mos/routes/meta.js` | `POST /api/mos/integration/events/tick` 改传 `userId: ctx.user.id`（由 eventconsumer 映射） |

### B4 —— 跨系统联调准备（**真实 HTTP 双系统**）

| 文件 | 变更 |
|---|---|
| `tools/mos-e2e-build04-dual.js`（新增，~1000 行） | Phase A—H 共 **64 条**断言；`signedOaRequest` 支持 `o.query`；`ticketFor()` 辅助 |
| `tools/run-mos-tests.sh` | 新增 `dual` / `joint` 套件入口（`joint` **不纳入 `all`**） |
| 交付物 | `REAL_HTTP_E2E_EVIDENCE.md` |

### B5 —— 归档隔离（并入 B4 套件 Phase H）

| 文件 | 变更 |
|---|---|
| `tools/mos-e2e-build04-dual.js` | Phase H：`D4-49`…`D4-56`（发布链身份 / 冻结送审 / 审批 / 真实 URL / 快照回放 / 资产总数不变 / 事件零新增 / 母版独立申请） |
| `lib/mos/routes/publishing.js` | **未修改** —— 对 `adapters/workspace|library` **零引用**（结构性独立，已 grep 验证） |
| 交付物 | `PUBLISHED_CONTENT_ISOLATION.md` |

### B6 / B7 —— 专业字典 / 真实 AI

| 文件 | 变更 |
|---|---|
| — | **未修改** —— 本轮**未获得** SPECIAL-01 原件与 AI 凭据 → **如实记 `BLOCKED`**，未做任何「填空式开发」 |
| 交付物 | `SKILL_AND_DICTIONARY_STATUS.md`、`AI_PROVIDER_REAL_MOCK_STATUS.md` |

### B8 —— 浏览器与安全回归

| 文件 | 变更 |
|---|---|
| `tools/mos-ui-check.js` | 新增 B1 断言块（准入对话框）+ `B1-38-admission-dialog.png` 截图（**106/106**） |
| `tools/mos-unit-test.js` | `ADM_FIELDS` 加 `reuseScope`；新增 `U-16b4`（缺省/`none` 必须 FAIL）、`U-16b5`（`unknown`/`expired` 必须 FAIL）（**75/75**） |
| `tools/mos-e2e-build03.js` | 3 处准入创建补 `reuseScope`（**96/96**） |
| `tools/mos-scheduler-test.js` | 小幅调整 |
| `lib/util.js` | `sendError()` / `httpError()` 支持**结构化详情**（`missing[]` / `fieldErrors[]` / `suggested` / `note`） |
| 交付物 | `SECURITY_REGRESSION.md`、`UI_BROWSER_EVIDENCE/` |

---

## 4. Schema 变更（v4 → v5）

| 项 | 内容 |
|---|---|
| **新增集合（4）** | `library_tickets`（票据非机密元数据，**密文只在内存**）<br>`library_event_cursors`（按品牌持久化游标）<br>`library_invalidations`（失效登记）<br>`library_admission_jobs`（入库作业幂等/重试） |
| **保守回填**（既有 `asset_admissions`） | `libraryPrimaryCategory = null`（**不猜**）<br>`classification = null`（**绝不猜测降级**）<br>`licenseStatus = 'unknown'`（自由文本**绝不**映射为 `cleared`）<br>`licenseLegacyText` 保留原文供人工核定<br>`needsManualReview = true` + `manualReviewReasons[]` |
| **幂等** | 已带 `admissionFieldsSchema = 5` 的行 **零改写**；二次 `migrate()` 报告「无变更」 |
| **回滚** | 停服 → 还原 `data/mos.json.bak-*`；或删除 4 集合字段 + `mosSchemaVersion` 改回 **4**（v4 代码不读新键，可直接运行） |
| 详见 | `docs/CURRENT_ARCHITECTURE.md` §5、`ADMISSION_FIELDS_UI_DATA_MIGRATION.md` §5 |

---

## 5. 测试基线变化

| 套件 | 上一版 | **本版** | 变化 |
|---|---|---|---|
| smoke | 13 | **13** | — |
| unit | 69 | **75** | +6 |
| sec | 17 | **17** | — |
| sched | 20 | **20** | — |
| provider | 21 | **21** | — |
| workspace | 30 | **36** | +6 |
| **dual** | — | **51** | **新增套件** |
| e2e | 48 | **48** | — |
| e2e02 | 63 | **63** | — |
| e2e03 | 94 | **96** | +2 |
| ui | 97 | **106** | +9 |
| **joint** | — | **64** | **新增套件（双系统真实 HTTP）** |
| **合计** | **472** | **610** | **+138** |

---

## 6. 未完成项（诚实清单）

| # | 项 | 状态 | 影响 | 责任方 |
|---|---|---|---|---|
| `B-1` | SPECIAL-01 字典原件未入库 | `BLOCKED` | `INT-09` | 业务方 |
| `B-2` | Visual Brand Guardian Skill V1.2 未入库 | `BLOCKED` | `INT-10`、`INT-06`（Skill 子项） | 业务方 |
| `B-3` | 真实持权人最终审批未执行 | `BLOCKED` | `INT-04`、`INT-13`、`INT-14` | 双方会同 |
| `B-4` | Provider `resubmit`（重提）能力缺失 | `BLOCKED` | 消费方恢复路径（现用「新 `idempotencyKey` 新建」） | Provider（产品决策） |
| `B-5` | 跨主机 TLS 终结未验证 | `NOT_RUN` | 部署形态 | 环境 |
| `B-6` | 线上部署未验证 | `NOT_RUN` | 交付验收 | 用户（**明令禁止**） |
| `B-7` | 真实外部 AI 未跑 | `BLOCKED` | `INT-11` | 凭据 |
| — | `INT-02` 过期 / 重放 / 吊销 双系统负例 | `NOT_RUN` | `INT-02` 未记 PASS | 本侧（可补跑） |
| — | `INT-03` 跨品牌 / 高密级 双系统负例 | `NOT_RUN` | `INT-03` 未记 PASS | 本侧（可补跑） |
| — | 备份**定时任务** / **离线恢复演练** | `NOT_RUN` | `INT-13` 子项 | 运维（需批准后） |
| — | 双方 `request_id` 逐条互认 | `NOT_RUN` | `INT-14` | 双方会同 |
| — | `CONTRACT_DIFF_SIGNED.md` 签署 | **空** | `INT-14` | 双方签署 |

---

## 7. 部署与回滚

### 7.1 部署（**本轮未执行**）

> **用户明令：未经批准，不得部署生产环境。** 本轮**未做任何部署动作**。

若日后获批，建议顺序：

| # | 步骤 |
|---|---|
| 1 | **停服**（Windows 下 `SIGTERM` 为硬终止；必须等 **≥1s** 让 60ms 防抖落盘） |
| 2 | 备份 `data/mos.json`（系统亦自动生成 `mos.json.bak-*`） |
| 3 | 配置 `config.json → mos.workspace`（`baseUrl` / `allowedHosts` / `userMap` / `allowedOrigins`）与**服务账户私钥**（经**环境变量**注入，**绝不**入库） |
| 4 | 启动新版本 → `store.load()` 自动 `migrate()`（v4→v5）并落盘 |
| 5 | 验证：`GET /api/mos/meta` → `schemaVersion === 5` |
| 6 | 冒烟：`GET /api/mos/integration/status`（`configured=true`）+ `POST /api/mos/integration/probe` |
| 7 | **事件轮询保持关闭**，直到运营显式授权（`pollEnabled`） |

**托管沙箱注意**（沿用既有结论，勿回退）：
- 需监听通用 `PORT` 并绑 `0.0.0.0`（`lib/config.js` 已支持 `MOS_PORT`→`PORT`）；
- 反代会改写 `Host` → 需在 `config.json` 的 `auth.allowedOrigins` 放行对外域名；
- 上传**不遵守 `.gitignore`** → `data/`、`config.json` 都会进沙箱 → **每次重新发布会用本地 `data/` 覆盖线上数据**。

### 7.2 回滚

| 场景 | 操作 |
|---|---|
| **快速回滚** | 停服 → 还原 `data/mos.json.bak-*` → 装回旧版本 |
| **就地降级** | 停服 → 编辑 `data/mos.json`：删除 `library_tickets` / `library_event_cursors` / `library_invalidations` / `library_admission_jobs`，`mosSchemaVersion` 改回 **4** → 装回 v4 代码 |
| **集成态数据影响** | `library_event_cursors` 丢失 = 下轮从 0 重放（**幂等，安全**）；`library_invalidations` 丢失 = 下一轮轮询或 `verifyAssetUsable()` 时重建；票据元数据丢失**无影响**（密文本就只在内存） |
| **保守回填的影响** | 降级后 `classification = null` 的行仍可读（v4 不识别这些键）；**但不要**在 v5 环境下把 `needsManualReview` 当噪音忽略 |

> 回滚**不丢业务数据**。

### 7.3 交付打包

```bash
bash tools/package-mos-source.sh
# → VFIB_MARKETING_OS_V0.1_REMEDIATED_SOURCE.zip
```

**打包坑（勿重踩）**：
- ZIP 由零依赖 `tools/mos-zip.js` 生成，**必须正斜杠路径**；
- JS `0o100644 << 16` 是**有符号**运算会溢出为负 → 必须 `>>> 0` 再 `writeUInt32LE`；
- Git Bash **没有 `zip`**；PowerShell `Compress-Archive` 写**反斜杠**条目（**违反 ZIP 规范**），**勿用**。

---

## 8. 红线遵守自检

| 红线 | 结果 |
|---|---|
| **只改运营中台仓库** | ✅ 本侧为唯一改动方；OA 源码**零改动**（`D4-00` / `D4-45` 双证） |
| **Published Archive 只在 Marketing OS 归档** | ✅ `D4-54` `before=0 after=0`、`D4-55` `newItems=0`、grep 零引用 |
| **正式资产由企业资料库权威管理** | ✅ Asset ID / version 只能由 Provider 颁发（`D4-33`）；本侧不得自造 |
| **S05 / 声誉 / 线索 / 代理 / 自动发布 保持 MARK** | ✅ `D4-43` `forbidden=[]`，权限表中**不存在**对应权限点 |
| **不把 MOCK 标成 REAL** | ✅ `state` + `mock` 双字段 + 产物内嵌 MOCK 标记 + `costReceipt.source='mock-local'` |
| **未经批准不部署生产** | ✅ 本轮**零部署动作** |
| **不改共享契约** | ✅ C 包 `OPENAPI_ERROR_CODE_ENUM` 保持 71 项**逐字节不动**；本侧 6 处符合性修正**只在本侧**（已披露） |
