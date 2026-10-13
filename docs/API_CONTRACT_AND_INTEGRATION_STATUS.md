# API 契约与集成状态（V0.1 · Phase 0—4 完成后）

> - 全部端点在 `/api/mos/*` 下，**统一鉴权**（HttpOnly Cookie 会话 + CSRF 头 + RBAC/ABAC）。
> - **跨品牌访问返回 404**（不是 403）—— 防止通过状态码枚举品牌数据是否存在。
> - 响应为 **JSON**；失败形如 `{ ok:false, code:'XXX', message:'…' }`（HTTP 状态与 `code` 语义一致）。
> - 「集成状态」列如实标注 **REAL / MOCK / NOT_CONFIGURED / NOT_VERIFIED / BLOCKED**，**未接通不得伪装**。
> - 权威集成矩阵见 `docs/MOCK_REAL_MATRIX.md`。

---

## 1. 认证与会话

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/mos/auth/login` | 公开（限速） | 登录；创建会话（**创建即同步落盘**） |
| POST | `/api/mos/auth/logout` | 已登录 | 登出；会话失效同步落盘 |
| GET | `/api/mos/auth/me` | 已登录 | 当前主体、角色、可见品牌、集成状态 |
| POST | `/api/mos/auth/change-password` | 已登录 | 改密闸门（首次登录强制） |
| GET | `/api/mos/identity/status` | 已登录 | 身份适配器状态 → 当前 **MOCK** |

## 2. 元信息 / 字典 / 集成状态

| 方法 | 路径 | 说明 | 集成状态 |
|---|---|---|---|
| GET | `/api/mos/meta` | schema 版本、字典、集成矩阵 | — |
| GET | `/api/mos/dictionaries/verification` | 待核验项登记表 + 汇总 + 覆盖审计（F-07） | — |
| POST | `/api/mos/dictionaries/verify` | 登记一次核验（缺证据 → 400） | — |
| GET | `/api/mos/content-dictionaries` | 内容侧字典 | — |
| GET | `/api/mos/knowledge/search` | 正式术语检索 | **MOCK**（返回 `sandbox:true, mock:true`） |
| GET | `/api/mos/library/approved` | 已批准可复用资产检索 | **MOCK**（恒空，不伪造正式资产） |
| GET | `/api/mos/providers/health` | 文本/图像 Provider 契约探针（A-05） | **NOT_CONFIGURED**（无密钥） |
| GET | `/api/mos/workspace/status` | 企业资料库适配层状态（A-06） | **NOT_CONFIGURED / NOT_VERIFIED** |
| GET | `/api/mos/brand/:code/overview` | 品牌概览（含已批准资产卡） | — |

## 3. 计划 / 主题 / 任务（Planning Center）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/mos/plans` | 月度计划列表 / 新建 |
| GET/PUT | `/api/mos/plans/:id` | 计划详情 / 更新 |
| POST | `/api/mos/plans/:id/items` | 增加 PlanItem |
| POST | `/api/mos/plans/:id/transition` | 计划状态迁移（状态机强制） |
| PUT | `/api/mos/plan-items/:id` | 调整排期（**保留 revision + 追加式审计**） |
| GET | `/api/mos/calendar` | 统一日历（**PlanItem / PublishingSchedule 的投影**，不另建内容表） |
| GET/POST | `/api/mos/topics` | Master Topic 列表 / 新建 |
| GET/PUT | `/api/mos/topics/:id` | 详情（Research / Narrative / Deliverables / Reuse） |
| POST | `/api/mos/topics/:id/evidence` | 挂证据引用 |
| POST | `/api/mos/topics/:id/create-task` | 由 Topic 生成内容任务（预填 `topicId`） |
| GET | `/api/mos/topics/:id/reuse` | 复用视图（真实聚合；`libraryAssets` MOCK 下恒空并标注） |
| GET/POST | `/api/mos/tasks` | **All Tasks** 综合视图（支持 `campaignId` / `topicId` 过滤） |
| GET/PUT | `/api/mos/tasks/:id` | 任务详情 / 更新 |
| POST | `/api/mos/tasks/:id/transition` | 任务状态迁移 |
| POST | `/api/mos/tasks/ad-hoc` | 临时任务（无 Campaign/Topic 上下文） |
| GET/POST | `/api/mos/campaigns` | Campaign 列表 / 新建 |
| GET/PUT | `/api/mos/campaigns/:id` | 详情（含 `marketingBrief` + `progress`）/ 更新 |
| POST | `/api/mos/campaigns/:id/{link,unlink}-plan` | 关联 / 解除计划 |
| POST | `/api/mos/campaigns/:id/{link,unlink}-topic` | 关联 / 解除 Topic |
| GET | `/api/mos/campaigns/:id/results` | 结果聚合（**仅真实数据**；渠道表现 `available:false` + `missing[]`） |
| GET | `/api/mos/marketing/brief-templates` | Marketing Brief 模板（按品牌；**不含任何产品宣称**） |
| GET/POST | `/api/mos/plans`… | 见上 |
| GET | `/api/mos/my-work` · `/api/mos/active-projects` | Workspace 快捷入口 |

## 4. 情报（Intelligence）与采集调度（A-01）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET/POST | `/api/mos/sources` | `source.manage` | 来源登记 / 列表（新登记默认「待核验」，不自动抓取） |
| PUT | `/api/mos/sources/:id` | `source.manage` | 更新来源（许可核验、状态） |
| POST | `/api/mos/sources/:id/ingest` | `source.manage` | 单来源采集（**统一走 `ingest` 引擎**，未核验 fail closed） |
| GET | `/api/mos/source-items` · `/:id` | 品牌可见 | 采集条目 |
| POST | `/api/mos/source-items/:id/create-topic` | 任务权限 | 由情报条目创建 Topic |
| GET | `/api/mos/ingest/scheduler` | `source.manage` | 调度状态 + 限额 + 到期预览（**只读**） |
| POST | `/api/mos/ingest/scheduler` | `source.manage` | 开关自动调度（非法取值 400 `BAD_ENABLED`） |
| POST | `/api/mos/ingest/scheduler/tick` | `source.manage` | 手工巡检一轮 |
| GET | `/api/mos/ingest/jobs` | 品牌可见 | 采集作业历史（失败理由原样返回） |

**采集链路状态**：来源抓取 = **REAL**（真实 HTTP，受 allowlist + SSRF 约束）；AI 摘要 =
**NOT_CONFIGURED**（未配置模型时不生成）；**调度默认关闭**。

## 5. 创作（Creative Studio）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/mos/content-versions` | 内容版本列表 / 新建 |
| GET/PUT | `/api/mos/content-versions/:id` | 详情 / 更新（有未保存修改时**必须**显式提示） |
| POST | `/api/mos/content-versions/:id/lock` | **送审冻结**（绑定不可变版本 + hash，正文变只读） |
| POST | `/api/mos/content-versions/:id/revise` | 从冻结版本派生新版本（**不继承旧审批**） |
| GET | `/api/mos/skills` | Skill 清单（`REFERENCE_ONLY` 明示，不得伪装 Approved） |
| GET | `/api/mos/templates` | 视觉模板 |
| POST | `/api/mos/prompt-preview` | 受控提示词预览（返回生效规则哈希） |
| POST | `/api/mos/generation-jobs` | 创建生成作业（图像/文本） |
| GET | `/api/mos/generation-jobs` · `/:id` | 作业列表（含 spend + capability.health）/ 详情 |
| POST | `/api/mos/assets/upload` | 上传工作素材（魔数校验 + sha256） |
| GET | `/api/mos/assets` · `/:id/content` | 素材列表 / 内容 |
| GET/PUT | `/api/mos/video/:taskId` | 视频工作区（Brief/脚本/分镜/字幕/关键帧）—— **不提供自动渲染** |

**Provider 状态**：文本/图像 = **NOT_CONFIGURED**（默认）；`mock` 模式产出**明确标注 MOCK**；
`deepseek`/`openai` 有服务端密钥才真实调用。契约面（A-05）见 `reports/PHASE3_INTEGRATIONS.md` §4。

## 6. 审核（三条独立审批链）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/mos/review-cases` · `/:id` | 审核单列表 / 详情（按类型过滤：专业 / 发布 / 入库） |
| POST | `/api/mos/review-cases/:id/decision` | 决策（需备注的动作强制备注；**作者本人被职责分离过滤**） |
| GET | `/api/mos/review-history` | 审核历史（追加式） |

## 7. 发布（Publishing Center）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/mos/channels` · PUT `/:id` | 渠道登记（**不存密码**） |
| GET/POST | `/api/mos/publishing/schedules` · PUT `/:id` | 排期 |
| GET | `/api/mos/publishing/calendar` | 发布日历（`PublishingSchedule` 投影） |
| GET/POST | `/api/mos/publications` · GET `/:id` | 实际发布记录（**仅人工登记后创建**） |
| POST | `/api/mos/publications/:id/corrections` | 更正 / 替换 / 撤回（**追加式**，快照不可覆盖） |
| POST | `/api/mos/publications/:id/metrics` | 渠道表现指标（带来源与统计时点） |

> **无任何自动发布**（MARK-AUTOPOST 未建设）；`PUBLISHED` 只能人工登记并产生**物理快照**。

## 8. 资产入库与治理（Governance & Assets）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/mos/asset-admissions` | 入库申请列表 / 创建 |
| GET | `/api/mos/asset-admissions/:id` | 申请详情 |
| POST | `/api/mos/asset-admissions/:id/precheck` | 预检（八项检查，结果如实落库） |
| POST | `/api/mos/asset-admissions/:id/submit-final` | 请求**独立最终审批** |
| POST | `/api/mos/asset-admissions/:id/sync` | 资料库同步 | **MOCK**（回执强制 `MOCK_` 前缀 + `permissionValid:false`） |
| POST | `/api/mos/asset-admissions/:id/retry-sync` | 同步失败重试（状态机强制：仅 `SYNC_FAILED` 可重试） |
| GET | `/api/mos/library-asset-refs` | 资料库引用（Mock 条目一律 `MOCK_` 前缀） |
| GET | `/api/mos/assets` … | 见创作章 |

## 9. 分析与审计

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/mos/analytics` | **真实聚合**；无数据来源的指标 → `available:false` + `missing[]`（**不 0 填充**） |
| GET | `/api/mos/audit` | 审计事件（追加式，不可改写） |

## 10. 导出面（本系统**不提供**）

| 端点为 | 依据 |
|---|---|
| Published Content 归档 / 发布成品镜像 | 契约 §8：入库资产为母版（`documentLevel='MASTER'`），不含 `publishedContent` 等任何字段 |
| 任何 `publish` / `archive` 端点 | Workspace 侧 `capabilities.publishedContentArchive` 恒 `false`；Marketing OS 侧 Published Archive 为**唯一**归档处 |
| S05 客户增长 / 品牌声誉专项 / 营销线索移交 / 代理后台 / 社媒自动发布 | 用户主指令与 MARK-* 清单明令禁止 |

---

## 11. 集成状态总表（诚实性）

| 集成 | 状态 | 数据来源 | 证据 |
|---|---|---|---|
| 身份 | `MOCK` | `adapters/identity.js` | `GET /api/mos/identity/status` |
| 知识库检索 | `MOCK` | `adapters/knowledge.js` | 响应带 `sandbox:true, mock:true` |
| 企业资料库（沙盒） | `MOCK` | `adapters/library.js` | `MOCK_` 前缀 + `permissionValid:false`；`AVAILABLE` 不可达 |
| 外部情报采集 | `REAL` | `adapters/source.js` | `sched` 20 断言 + `sec` 17 断言 |
| 文本 / 图像模型 | `NOT_CONFIGURED`（默认） | `adapters/text.js` / `image.js` | `provider` 21 断言（真实端到端 **BLOCKED：无凭据**） |
| 企业资料库真实集成 | `NOT_CONFIGURED` | `adapters/workspace.js` | `workspace` 30 断言（真实联调 **NOT_VERIFIED**） |
| 来源自动调度 | 默认**关闭** | `scheduler.js` | `sched` 20 断言（**单实例限制**已声明） |
| 专业字典 provisional | 全部**待核验** | `dictverify.js` | `unit` U-21 系列 + `e2e03` DV-01…04 |
| 平台指标 API | 未接通 | — | Analytics 显示「缺失」+ 原因 |
