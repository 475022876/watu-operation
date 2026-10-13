# PHASE0_BASELINE_AND_IMPACT.md —— V0.1.2 基线清点与影响分析

> 日期：2026-10-14 ｜ 执行包：`VFIB_Marketing_OS_V0.1.2_AI_Intelligence_Task_Driven_UX_Codex_Pack`（8 文件 SHA256 全部与清单一致）
> 性质：**只审计、未改业务代码**（本日 i18n 汉化与 UI 微调提交为先期独立改动，见 §1）。

---

## 1. Git / 版本 / Schema 基线

| 项 | 实测值 |
|---|---|
| 本地 HEAD | `7458cf6`（工作区 clean） |
| 远端 `origin/main` | `5a74767`（本地领先 6 个本地提交：Skill 待审批登记 2 + start.cmd + 汉化 2 + 本报告前基线） |
| 应用版本 | **0.1.1**（`package.json` / `lib/config.js` / `lib/mos/config.js` 三处同源；UI `v0.1.1`） |
| Schema | **v5**（41 个集合，`lib/mos/store.js BASE_SHAPE`） |
| 共享 API Contract | **1.0**（本轮不改动；新增能力全部走 MOS 内部端点） |
| 目标版本 | **0.1.2**（仅在全阶段回归+验收通过后统一升版） |
| 测试基线 | 今日实测：`all` 546/546 + `joint` 64/64 + `build06` 61/61（汇总 671/671）；`ui` 106/106（28 张中文界面截图，`UI_EVIDENCE_MOS_BUILD01/`，作为**改造前基线截图**） |

**今日先期改动（已提交，非本轮 Phase A—C 内容）**：界面全面汉化（`6e2ae63`/`7458cf6`，导航/页头/面包屑/环境标识）、侧边栏滚动条隐藏（`3ee470b`）、`start.cmd`（`d630158`）、Skill 待审批登记工具（`ebd2c29`）。

## 2. 现有功能与导航映射（原 8 中心 → 新 5 主 + 2 辅）

### 2.1 现有导航（`public/mos/js/app.js CENTERS/MODULES`，20 个模块全部真实可用）

| 现中心 | 模块（id 保持不变） |
|---|---|
| 工作台 | my-work / active-projects / my-reviews |
| 品牌中心 | brand-overview / brand-guidelines / brand-library |
| 计划中心 | planning / topics / intelligence / tasks |
| 创意工作室 | content-editor / visual-studio / video-workspace |
| 发布中心 | publishing |
| 营销中心 | marketing-vfib / marketing-ucard / campaigns |
| 运营分析 | analytics |
| 治理与资产 | governance |

### 2.2 新导航映射（Phase A 实施；**所有模块 id/路由不变 → 深链接与收藏天然兼容**）

| 新入口 | 承载模块（原有，不新建平行账本） |
|---|---|
| 主1 工作台 Workspace | my-work（升级：今日待办/我的任务/待我审核/本周待发布/继续上次）+ my-reviews + active-projects |
| 主2 策划与情报 Planning & Intelligence | intelligence（升级：今日情报/AI 专题研究）+ topics（升级：选题建议→正式选题池）+ planning（日/周/月同源视图）+ campaigns |
| 主3 内容制作 Content Production | tasks（制作任务列表）+ content-editor / visual-studio / video-workspace |
| 主4 发布管理 Publishing | publishing（日历/队列/渠道/Published Archive） |
| 主5 运营分析 Analytics | analytics |
| 辅1 品牌与素材 Brand & Assets | brand-overview / brand-guidelines / brand-library（次导航或用户菜单） |
| 辅2 审批与管理 Review & Administration | my-reviews / governance / admin（**按权限可见**：`content.professional_review` / `content.publish_approve` / `plan.approve` / `asset.review` / `library.asset.*` / `MOS_ADMIN` 之一） |

## 3. 现有 API / 数据模型 / 权限清点

- **API**：约 100 个 MOS 端点（`lib/mos/routes/`：auth/admin/meta/plans/campaigns/topics/tasks/content/creative/video/reviews/publishing/sources/analytics/admissions/channels 等）。关键复用点：
  - `GET /api/mos/my-work`（工作台聚合，已有）→ Phase A 扩展「本周待发布」「继续上次」；
  - `sources` + `source-items` + `ingest/scheduler`（可信来源登记与采集，**已真实落地**：白名单 5 域、HTTPS-only、fail-closed）→ Phase B Trusted Sources 引擎复用；
  - `topics/:id/evidence` + `evidence_references` 集合（已有证据模型雏形）→ Phase B SourceEvidence 扩展；
  - `plans`/`plan-items` + `calendar`（同一组 MonthPlan/PlanItem）→ Phase C 日/周/月同源视图直接聚合，**不存在 3 套计划**；
  - `topics/:id/create-task` + `tasks/ad-hoc`（派工雏形）→ Phase C 批准并安排的原子 Saga 需新建（idempotencyKey）；
  - `review-cases`/`review_decisions` + G0—G3 → 审核链保持不变；
  - `publications`/`published_artifacts`（**Published Archive 仅 MOS**，`publishing.js` 对适配层零引用）→ 不动。
- **数据集合（41）**：brands, users, user_roles, sessions, monthly_plans, plan_items, campaigns, monthly_campaign_links, master_topics, campaign_topic_links, content_tasks, source_registry, source_items, evidence_references, skill_versions, creative_templates, content_versions, review_cases, review_decisions, working_assets, generation_jobs, video_artifacts, channels, publishing_schedules, publication_records, published_artifacts, publication_corrections, publication_metrics, asset_admissions, library_asset_refs, ingest_jobs, library_tickets, library_event_cursors, library_invalidations, library_admission_jobs, audit_events, seq, settings 等。
- **RBAC（服务端强制，`lib/mos/rbac.js` + `dict.js ROLES`）**：P1（plan.approve/topic.manage/campaign.manage…）、P2（content.edit/content.submit…）、P3（content.publish_approve/publication.schedule…）、P4（含 source.manage）、PROFESSIONAL_REVIEWER、PUBLISHING_APPROVER、ASSET_REVIEWER、LIBRARY_FINAL_APPROVER（`library.asset.approve.final` 独立特权，**不得被选题审批代替**）、MOS_ADMIN。默认拒绝 + 越权写审计。
- **门禁**：`formalguard.js`（正式输出 fail-closed，TEXT/IMAGE 同源校验）、`eventconsumer`（七类事件 fail-closed）、`dictverify`（SPECIAL-01）。

## 4. 外部能力现状（决定 BLOCKED 边界）

| 能力 | 现状 | V0.1.2 处置 |
|---|---|---|
| 文本/图像 LLM | `MOS_TEXT/IMAGE_PROVIDER=none`，无凭据 | Phase B/C 一键 AI 草稿等显示 **NOT_CONFIGURED/BLOCKED**；接口落地、Mock 仅显式标注；**不冒充真实** |
| Web Search Provider | 不存在 | Phase B 新建抽象（Provider + 白名单 + 预算/限额 + SSRF 防护）；未配置即 BLOCKED |
| 可信来源采集 | **真实可用**（source_registry 白名单 5 域；bis.org PENDING_VERIFICATION fail-closed；调度器默认关） | 复用；INTEL-01 可记 REAL（真实 HTTP 抓取 bis/imf/fsb/fatf/swift 公开页） |
| 企业资料库 | `library=mock`（零出站）；真实联通能力由 build06 61/61 + joint 64/64 证明 | 保持；BRAND-01 按 Skill 门禁实测（PENDING_APPROVAL → fail-closed） |
| SPECIAL-01 字典 | **41 项全部 provisional/UNVERIFIED**（原件未随包提供） | 维持 provisional；`SPECIAL01_SOURCE_MAPPING.md` 如实记录；**不得改标 VERIFIED** |
| 正式品牌 Skill | `skv_vfib_guardian_12_pa1` = **PENDING_APPROVAL**（等 `library.asset.approve.final` 真人审批） | 未批准 → 正式输出门禁继续阻断（正确行为）；BRAND-01 证据=门禁负例+审批入口 |

## 5. Schema 迁移策略（v5 → v6，只增不改）

拟新增集合（先行论证：现有模型不能安全承载）：
- `research_reports`（ResearchReport：mode/query/timeWindow/provider/status/cost/…）
- `research_findings`（Finding：kind FACT/INTERPRETATION/RECOMMENDATION、核查状态、证据绑定）
- `source_evidence`（URL/哈希/许可/抓取日/定位——独立集合以便跨报告引用；现 `evidence_references` 偏 Topic 证据，扩展而不混用）
- `topic_proposals`（Candidate TopicProposal 全状态机 + 审核 diff）
- `research_jobs`（Web Research 作业：幂等、预算、超时）
- 用户偏好：`users[].prefs.locale`（向后兼容：缺省 zh-CN）
迁移规则沿用既有 migrate() 模式：幂等、只增、备份 + dry-run + 回滚说明；旧记录字段零改动。

## 6. 风险与红线（贯穿 A/B/C）

1. **不建平行账本**：Proposal→Topic→Task 全部落到既有 `master_topics`/`content_tasks`；新集合只承载「研究/候选」前置阶段。
2. **审批四分离**：选题审批（新 editorial.approve）≠ 内容审核 ≠ 发布审核 ≠ `library.asset.approve.final`。
3. **原子派工**：批准并安排 = 单事务语义（JSON 存储用可恢复原子写 + idempotencyKey 幂等 Saga），杜绝「批准成功派工缺半」。
4. **品牌隔离/权限不松动**：所有新端点走 `resolveBrand→assertBrand` + `assertCan`；负例入回归。
5. **外部数据不可信**：研究报告渲染层防注入（不执行抓取页脚本/不注入系统指令）、SSRF/重定向/大小/MIME/超时限制；内网地址拒绝。
6. **BLOCKED 如实**：无真实凭据/批准 → NOT_CONFIGURED/BLOCKED 醒目标识；fixture 仅显式标注的测试预览。
7. **不部署生产**；OA 源码零改动；共享 API 1.0 不变。

## 7. 实施次序（获批后执行）

1. **Phase A**（先行）：i18n 框架 + 语言偏好持久化 → 5+2 导航重构（旧路由零破坏）→ 工作台升级（本周待发布/继续上次，服务端存储）→ 角色个性化 → 双语回归 + 截图。
2. **Phase B**：schema v6 迁移 → 研究域后端（reports/findings/evidence/proposals + 审批端点）→ Web Research 适配器（BLOCKED 态）→ 前端页面 → 负例与 e2e。
3. **Phase C**：派工 Saga + 选题池/计划视图 → 任务四标签制作空间 → 平台独立退回 → 发布衔接 → e2e 全链路浏览器证据。
4. **收口**：全量回归 + 安全回归 + 0.1.2 升版 + 13 项交付文件 + FINAL_ACCEPTANCE_V0.1.2.md。

## 8. Phase 0 结论

基线健康（671/671 全绿、工作区 clean、边界机制完整）。**可以进入 Phase A**。复用度高：约 70% 后端能力已存在，Phase A 以前端编排为主，Phase B/C 新增研究域与派工 Saga（均有清晰挂载点）。
