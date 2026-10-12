# BUILD-02 审计结论与开发计划

**版本：** VFIB Marketing OS V0.1 · BUILD-02
**日期：** 2026-10-12
**依据：** `VFIB_Marketing_OS_V0.1_Codex_Build_Specification/`（00 主控、01 IA、02 数据模型、03 工作流、04 AI、05 发布、06 集成安全、07 UI、08 测试门槛、09 执行指导、11 检查表）
**结论口径：** 本工程仍是**沙盒原型**，未接通任何真实企业系统；凡 MOCK 均不代表已打通。

---

## 1. 现有工程结构审计（BUILD-01 交付面）

### 1.1 分层与职责

| 层 | 文件 | 职责 | 审计结论 |
|---|---|---|---|
| 进程入口 | `server.js` | HTTP 服务、静态资源、CSP、访问白名单、优雅关闭 | 结构清晰；fail-closed 启动校验（非法 CIDR/ Cookie 策略拒绝启动）已实现 |
| 进程配置 | `lib/config.js` | 端口/目录/网络安全 | 已支持 `MOS_PORT`→`PORT`、`MOS_HOST`→`HOST`→托管自动 `0.0.0.0` |
| 安全基座 | `lib/{net,security,password,util,static}.js` | CIDR 逐位比较、Origin/CSRF、scrypt、MIME/魔数、静态穿越防护 | 与 OA 侧双份，**修改需人工同步** |
| 业务主体 | `lib/mos/*` | 字典、RBAC、路由、审计、存储、种子、适配器 | 单一数据文件 `data/mos.json`；原子落盘 + 写序号防回退 |
| 前端 | `public/mos.html` + `public/mos/js/**` | 原生 ES Module 外壳 + 模块化页面 | 零 CDN；五态组件齐备（`ui.js` stateBlock） |
| 自检 | `tools/*.js` + `run-mos-tests.sh` | unit(25) / smoke(13) / e2e(47) / ui(32) | 每套独立数据目录与随机口令，绝不触碰 `data/` |

### 1.2 已实现的业务能力（BUILD-01 / Gate A）

- **品牌与权限**：2 品牌（VFIB / UCARD）严格隔离；RBAC + 品牌 ABAC；`assertCan` 拒绝即写 `permission.denied` 审计；越权与不存在同样返回 404 防枚举。
- **策划**：MonthlyPlan（含状态机与版本）/ PlanItem / Campaign / MasterTopic / ContentTask，跨品牌关联一律 400/404。
- **情报**：SourceRegistry（等级/许可/频率/白名单）+ 真实 RSS/JSON 采集（SSRF 白名单 + DNS/IP 复检 + 超时/体积上限）+ 去重 + 证据引用 + 一键建 Topic。
- **日历**：`/api/mos/calendar` 统一月视图（PlanItem 与 PublishingSchedule 共享）。
- **审计**：append-only，敏感键自动脱敏，超长值截断，上限 20000 条滚动。

### 1.3 预置但未启用（BUILD-01 留下的空壳，本次必须做实）

`data/mos.json` 中以下集合在 BUILD-01 已占位为空数组，属于 BUILD-02 的落点：
`content_versions`、`review_cases`、`review_decisions`、`working_assets`、`generation_jobs`。
前端 `Creative Studio` / `Publishing Center` 目前一律指向 `modules/stage.js` 阶段说明页（**明确不做假按钮**，符合 07 §7）。

### 1.4 审计发现的问题与风险登记

| 编号 | 发现 | 级别 | 处置 |
|---|---|---|---|
| A-01 | `imageProvider` 仅返回固定文案，无适配器文件 | 阻断 BUILD-02 | 本次新建 `adapters/image.js` |
| A-02 | `adapters/text.js` 的 deepseek 分支恒返回 `INTEGRATION_PENDING` | 阻断 BUILD-02 | 本次补齐一次性生成通道（无 Key 时仍显式 pending） |
| A-03 | 无 Skill / 模板加载器，`dict.visuals`、`motions` 全为 `provisional` | 阻断 BUILD-02 | 新建 `lib/mos/skill.js`；未批准 Skill 一律阻断正式输出 |
| A-04 | 无文件上传通道（`util.uploadMagicIssue` 已备好但无路由） | 阻断 BUILD-02 | 本次新增原始流上传路由 + 魔数校验 |
| A-05 | `my-work` 的 `pendingReviews` 恒为空数组 | 影响 BUILD-02 | 本次接入真实 ReviewCase 队列 |
| A-06 | 无 Channels / PublishingSchedule / PublicationRecord 集合 | 阻断 BUILD-02 | 本次新增（含 schema 迁移） |
| A-07 | 托管发布时反代会改写 `Host`，`checkOrigin` 只比对 `req.headers.host` | 已修复（10-11） | 用 `auth.allowedOrigins` 放行对外域名；**任何新端点都不得绕开该层** |
| A-08 | 上传目录 `data/uploads` 无对外读取通道 | 阻断 BUILD-02 | 新增受鉴权+品牌范围的资产内容端点（不暴露裸路径） |

**结论：** BUILD-01 的分层与安全基座可以直接支撑 BUILD-02，不需要重构。BUILD-02 是**在同一骨架上的增量扩建**。

---

## 2. BUILD-02 范围（09 §3，逐条对齐）

| 序号 | 规格要求 | 本次交付物 | 验收断言 |
|---|---|---|---|
| 1 | ContentVersion 锁定与 ReviewCase | `routes/content.js`、`routes/reviews.js` | 冻结后正文不可改；变更须新版本 |
| 2 | 文案编辑、C/N/V 规范与证据引用 | Content Editor（三栏）+ `evidence_references` 挂载到版本 | 引用可回溯 SourceItem |
| 3 | Skill Loader 与模板选择，至少一个 Provider 可接入 | `lib/mos/skill.js`、`adapters/image.js`、`adapters/text.js` | 无 Key 时 `NOT_CONFIGURED`，与 `MOCK` 状态分离 |
| 4 | WorkingAsset / GenerationJob / 基础 QA 与预算 | `routes/creative.js` | 超预算返回 `BUDGET_EXCEEDED`；产物真实落盘 |
| 5 | Video Workspace 脚本 / 分镜 | `routes/video.js` + 前端页 | F01–F04 / M01–M05 字典校验 |
| 6 | 渠道 / Calendar / Queue / 人工发布 / Published Archive | `routes/channels.js`、`routes/publishing.js` | 归档快照不可覆盖；到期不自动 PUBLISHED |
| 7 | E2E-03 / E2E-04 | `tools/mos-e2e-build02.js` | 全绿且可接入 CI |

**必须可操作（09 §3 原文）：** 用 Task 编辑 → 送审冻结 → 审核 → 排期 → 实际发布登记 → 完整档案；
生成图像要**真实保存产出**或**明确显示模拟**。

### 2.1 明确不做（沿用主控禁令，不得越界）

S05 客户增长、品牌声誉/风险登记专项、营销线索移交与闭环、CRM、代理后台、佣金、KYC、银行卡与资金交易、
社交平台自动发布、客户私信机器人、云端视频全自动渲染。
**Asset Admission 与 Analytics 属 BUILD-03**，本次只保留阶段说明页，不建假接口。

---

## 3. 数据模型增量（schema v1 → v2，只增不改）

新增集合（`lib/mos/store.js` 的 `BASE_SHAPE`）：

| 集合 | 关键字段 | 约束 |
|---|---|---|
| `skill_versions` | brandCode, skillCode, version, checksum, approvalRef, state | 非 `APPROVED` 不得用于正式输出 |
| `creative_templates` | brandCode, skillVersionId, platform, mode, templateCode, version, config | 版本锁定 |
| `content_versions` | contentTaskId, number, code, body, hash, manifestHash, channelIds, disclosures, authorId, state | 冻结后不可改 |
| `review_cases` | type, subjectType, subjectId, versionHash, policyVersion, riskGrade, state | 目标冻结 |
| `review_decisions` | caseId, actorId, action, remarks, actingAuthority | append-only |
| `working_assets` | objectKey, sha256, mime, bytes, origin, license, visibility | 默认 PRIVATE |
| `generation_jobs` | provider, modelId, promptSnapshot, status, cost, currency, qaResult, idemKey | ID 幂等 |
| `video_artifacts` | taskId, videoType, motionCode, brief, script, storyboard, subtitles, keyframeAssetIds | — |
| `channels` | platform, handle, url, state, ownerId | **不存密码** |
| `publishing_schedules` | contentVersionId, channelId, plannedAt, state, revision | 修改只影响排期 |
| `publication_records` | scheduleId, actualAt, url, operatorId, evidenceRef, status | 必须有真实发布确认 |
| `published_artifacts` | immutableObjectKey, sha256, kind, manifestHash | 不可覆盖 |
| `publication_corrections` | publicationId, kind, reason, newPublicationId | 追加式 |
| `publication_metrics` | metric, amount, sourceKind, asOf, proofRef | 带来源与时间 |

**迁移与回滚：** `migrate()` 对缺失集合补空数组（v1 库直接升级，不动既有数据）；
回滚 = 停服 → 删除新增集合字段或还原 `mos.json` 备份（`data/mos.json.bak-*`）。

### 3.1 状态机（服务端强制）

- `ContentVersion`：`DRAFT → LOCKED_FOR_REVIEW → (APPROVED | REVISION_REQUIRED) → SUPERSEDED`
- `ReviewCase`：`SUBMITTED → IN_REVIEW → (APPROVED | REVISION_REQUIRED | REJECTED) | CANCELLED`
- `PublishingSchedule`：`DRAFT | BLOCKED → READY → SCHEDULED`（`CANCELLED` 旁路）
- `PublicationRecord`：`PUBLISHED → CORRECTED | REMOVED`（**只追加**）

### 3.2 审批 Manifest

`manifestHash = sha256(stable({ contentVersionId, textHash, refAssetIds+versions, channelIds, locale, disclosures }))`
在冻结时固化、审批时**重新计算比对**，不一致即 409 —— 对应 SEC-02「批准后正文或引用图像修改 → 原批准不能用于新 manifest」。

---

## 4. 路由清单（本次新增）

```
# 内容与版本
GET    /api/mos/content-versions?taskId=&brand=
POST   /api/mos/content-versions                       # 新建草稿
GET    /api/mos/content-versions/:id
PUT    /api/mos/content-versions/:id                   # 仅 DRAFT/REVISION_REQUIRED 可改
POST   /api/mos/content-versions/:id/lock              # 冻结 + 建 ReviewCase
POST   /api/mos/content-versions/:id/revise            # 派生新版本（旧版 SUPERSEDED）

# 审核（两条链）
GET    /api/mos/review-cases?type=&state=&mine=
GET    /api/mos/review-cases/:id
POST   /api/mos/review-cases/:id/decision              # APPROVE/REVISION_REQUIRED/REJECT
GET    /api/mos/review-history?subjectId=

# 创作 / 视觉 / 生成
GET    /api/mos/skills?brand=
GET    /api/mos/templates?brand=&platform=&mode=
GET    /api/mos/assets?brand=&taskId=
POST   /api/mos/assets/upload                          # 原始字节 + 魔数校验
GET    /api/mos/assets/:id/content                     # 受鉴权读取
POST   /api/mos/generation-jobs                        # 提交生成（幂等）
GET    /api/mos/generation-jobs?taskId=&brand=
GET    /api/mos/generation-jobs/:id

# 视频
GET    /api/mos/video/:taskId
PUT    /api/mos/video/:taskId

# 发布
GET    /api/mos/channels?brand=
POST   /api/mos/channels
PUT    /api/mos/channels/:id
GET    /api/mos/publishing/calendar?brand=&from=&to=
GET    /api/mos/publishing/schedules?brand=&state=
POST   /api/mos/publishing/schedules
PUT    /api/mos/publishing/schedules/:id               # 改期/状态迁移
POST   /api/mos/publications                           # 人工发布登记
GET    /api/mos/publications?brand=&q=
GET    /api/mos/publications/:id
POST   /api/mos/publications/:id/corrections           # 更正/撤回（追加）
POST   /api/mos/publications/:id/metrics
```

---

## 5. 页面清单（01 §2 对齐）

| 中心 | 页面 | 模块文件 | 阶段 |
|---|---|---|---|
| Creative Studio | W04-01 Content Editor | `modules/creative.js` | BUILD-02 |
| Creative Studio | W04-02 Visual Studio | `modules/visual.js` | BUILD-02 |
| Creative Studio | W04-03 Video Workspace | `modules/video.js` | BUILD-02 |
| Publishing Center | W05-01/02 Editorial Calendar + Queue | `modules/publishing.js` | BUILD-02 |
| Publishing Center | W05-03 Channels | `modules/channels.js` | BUILD-02 |
| Publishing Center | W05-04 Published Archive | `modules/archive.js` | BUILD-02 |
| Governance & Assets | W08-01/02 My Reviews + Review History | `modules/reviews.js` | BUILD-02 |
| Analytics / Governance(入库) | — | `modules/stage.js`（保留） | BUILD-03 |

每页必须实现 Loading / Empty / Error / Access Denied / Integration Pending 五态（01 §4）。

---

## 6. 测试计划（Gate B）

| 套件 | 新增断言 |
|---|---|
| unit | manifest hash 稳定性与敏感性、四套状态机迁移表、预算判定、魔数拒绝、排期门禁 |
| smoke | 上述全部新端点可达性 + 未登录 401 + 跨品牌 404 |
| e2e-03 | Task → 草稿 → 生成图像（MOCK 真实落盘）→ 冻结 → 专业审核 → 发布审核 → **改已批正文必须 409** |
| e2e-04 | 已批版本 → READY → SCHEDULED → **到期不自动 PUBLISHED** → 人工登记 → 不可覆盖快照 → 改项目文件不改归档 → 更正保留旧档 → 未入库 |
| SEC-02 / SEC-04 | 纳入 e2e-03 / e2e-04 断言 |

命令：`bash tools/run-mos-tests.sh all`（新增 `e2e02` 套件并纳入 all）。

---

## 7. 执行顺序与风险

1. 数据模型 + 迁移 → 2. 适配器与 Skill → 3. 内容/审核后端 → 4. 创作/生成 → 5. 视频 →
6. 发布/归档 → 7. 前端 → 8. 测试 → 9. 报告。

**已知风险：**
- **真实图像 Provider 无密钥**：无法端到端验证，只能保证代码路径存在且在无 Key 时返回 `NOT_CONFIGURED`；报告中将列为**未验证**。
- **SPECIAL-01 手册与 Visual Brand Guardian 文件包仍未提供**：C/N/V/F/M/A/G 字典标签保持 `provisional:true`，不臆造。
- **单文件 JSON 存储**：发布归档快照会增长 `data/` 体积，需在报告中提示容量边界（单表万级以内）。
