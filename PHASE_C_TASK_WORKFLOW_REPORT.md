# PHASE C —— 编辑域：批准入池 / 幂等派工 / 任务工作空间 交付报告（V0.1.2）

> 执行包：03（编辑计划与派工）/ 04（制作·发布·品牌）/ 06（实施）/ 07（验收）
> 基线：Phase B（schema v7）→ **Phase C（无 schema 变更：复用既有 master_topics / monthly_plans / plan_items / content_tasks，零新集合）**
> 日期：2026-10-13　|　测试口径：`editorial` 套件 43/43（新增）；全量回归见 §7

---

## 1. 交付范围

### 1.1 批准入池（APPROVE_TO_POOL）—— `POST /api/mos/topic-proposals/:id/approve-to-pool`

- 仅 `PENDING_EDITORIAL_REVIEW` 可批（AI_RECOMMENDED 直接批 → 409，提示先提审）；`editorial.approve` 权限（仅 P1/管理员）。
- 创建**正式 Master Topic**：`state=APPROVED_UNSCHEDULED`（topics.js 状态机新增 APPROVED_UNSCHEDULED→PLANNED→ASSIGNED 三态，与既有四态并存，不覆盖旧状态）；栏目 = 提案 primaryCategory（C01—C06 直通）；叙事默认 N01（可传）；风险等级沿用提案。
- **溯源回链**：Topic 记 `sourceProposalId` / `sourceReportId`；提案记 `topicId` 与 `dispatch{kind:'POOL'}`。
- **证据链接（No Evidence No Claim）**：仅可回溯到真实 `source_items` 的研究发现才建立 `evidence_references`；其余如实计入 `evidence.skipped`，绝不伪造证据。
- 幂等：同 idempotencyKey 重放返回首次结果；状态机保证重复批准 → 409（不重复建题）。

### 1.2 批准并安排（APPROVE_AND_SCHEDULE，幂等 Saga）—— `POST /api/mos/topic-proposals/:id/approve-and-schedule`

一个事务性业务操作 = 批准候选 + 选定/自动创建 Monthly Plan + 唯一 Topic（→ASSIGNED）+ **每平台交付物一个独立 ContentTask** + 每任务一个 PlanItem（同挂该计划）+ 证据引用。

**原子性方案（03 §「不得审批成功但派工缺半」）**——单文件 JSON 存储的事务等价物：
1. **fail-fast 全量校验先行**（idempotencyKey 必填、交付物 1—10 个、平台合法且不重复、负责人必须真实在职用户、制作期限必填、日期格式、计划归属/状态）——校验失败**零副作用**（SC-07 实证：6 个负例后提案仍 PENDING）；
2. 内存中完成全部对象变更后**一次性 `save()`**（原子落盘）——进程在 save() 前崩溃 = 全部未发生（天然回滚），save() 本身原子替换；
3. **全局幂等**：idempotencyKey 在所有提案的 dispatch 中唯一索引；重放返回首次结果快照（`replay:true`），零新增对象（SG-05/06 实证）。

派工口径（03 §）：派工必填真实员工账号 + 交付类型 + 制作期限；计划发布日期可空；一个 Topic → 多 Task → 各 Task 独立状态/审核/交付；**绝不**一个选题不同平台复制成多个正式 Topic。自动创建计划时审计 `plan.created` 带 `autoBySaga:true`。

### 1.3 日 / 周 / 月同源视图 —— `GET /api/mos/editorial/views`

- **零新数据源**：只有同一组 MonthPlan/PlanItem/Task，视图是过滤与聚合（`counts.total/byStatus` + items + scheduled）；`/api/mos/calendar` 同步新增 `day` 视图（同一 PlanItem/Task 过滤）。
- 周一为一周起点；范围计算 UTC；展示层负责时区换算（note 已声明）。
- 空时段如实为 0（VW-05）；跨品牌 404 防枚举（VW-06）。

### 1.4 任务工作空间四标签（04 §）—— `content-editor` 页头

`任务要求 Brief`（本页左栏锚点滚动）｜`内容制作 Content`（本页正文/版本编辑器）｜`图片与视频 Visuals & Video`（→ 视觉工作室）｜`审核与交付 Review & Delivery`（→ 我的审核）。Brief 与 Content 为本页既有两栏，**不复制第二套功能**；Visuals/Review 跳转既有专用模块。

### 1.5 平台任务独立退回/推进

ContentTask 本就一平台一任务（Saga 保证），状态迁移 `/api/mos/tasks/:id/transition` 按任务独立生效；实证 TK-01/02/03：LinkedIn → IN_PRODUCTION 后 X 仍 PLANNED，视图聚合真实反映。

### 1.6 前端（选题建议抽屉）

PENDING 提案的 P1 操作区固定为：**批准入池 / 批准并安排 / 退回·暂缓·拒绝** 三个入口，对应 03 §一屏审核固定操作；「批准并安排」弹窗按平台逐行填写 `平台, 负责人, 制作期限`，idempotencyKey 自动生成。

## 2. 审批分离（红线复核）

`editorial.approve`（选题审批）≠ `content.professional_review` / `content.publish_approve`（内容/发布审核，沿用既有 ReviewCase 流程）≠ `library.asset.approve.final`（资料库最终审批，未受本阶段影响）。排期 ≠ 已发布；本阶段未触碰 publishing.js、未实现任何自动社媒发布。

## 3. API 一览（新增 3 端点 + calendar day 视图）

| 端点 | 权限 | 说明 |
|---|---|---|
| `POST /api/mos/topic-proposals/:id/approve-to-pool` | editorial.approve | 入池：正式 Topic（APPROVED_UNSCHEDULED）+ 证据链接 |
| `POST /api/mos/topic-proposals/:id/approve-and-schedule` | editorial.approve | 幂等 Saga：计划+Topic+多平台任务+PlanItem |
| `GET /api/mos/editorial/views` | 品牌范围 | day/week/month 同源过滤聚合 |
| `GET /api/mos/calendar?view=day` | 既有 | 统一日历日视图 |

## 4. 测试证据（`tools/mos-e2e-v012-editorial.js`，43/43）

- **A 入池**：AI 直批 409；正常入池（state/pillar/narrative 正确）；证据如实 linked=0/skipped=0；重复批准 409 且 Topic 恰 1 条；P2 403；跨品牌 404。
- **B Saga 负例**：缺 key / 无交付物 / 非法平台 / 虚假负责人 / 缺制作期限 / 坏日期 → 全部 400 且**提案状态零触碰**（fail-fast 实证）。
- **C Saga 正向**：Topic ASSIGNED + 2 平台任务 PLANNED（编号不同）+ 自动建月计划（VFIB-2026-11-v1）+ 2 PlanItem；同 key 重放 `replay:true` 返回首次快照且 Topic 仍 1 条；换 key 再派工 409；P2 403。
- **D 同源视图**：月/日/周三视图同源一致；范围正确；空时段如实 0；跨品牌 404。
- **E 平台独立**：单任务推进不影响兄弟任务；视图聚合随状态真实更新。
- **F 审计**：`editorial.approve_to_pool` / `editorial.saga_completed` / `plan.created(autoBySaga)` / `proposal.decision` 全部落盘（停服后直读 mos.json 验证）。

证据：`TEST_EVIDENCE_MOS_V012_EDITORIAL/v012-editorial-result.json`（已注册进 run-mos-tests.sh 汇总）。

## 5. 已知边界（如实声明）

| 项 | 状态 | 说明 |
|---|---|---|
| 证据链接数 | 本地测试环境为 0 | 采集依赖真实外网来源；无真实来源条目时 linked=0 如实计数，不伪造证据 |
| 站内通知 | 以任务列表触达 | Saga 不做站外推送；负责人在其工作台「我的任务」看到派工（note 已声明，不冒充推送） |
| 视觉生成/Skill 授权 | 沿用 V1.2 既有门禁 | formalguard fail-closed 未改动；未批准 Skill 不得当正式模板的口径不变 |
| 日历拖拽 | 未实现 | 03 §允许不支持；如后续支持必须更新同一服务端对象并可审计 |
| YouTube | 仅脚本/分镜/素材上传 | 未扩展全链路视频模型生产（红线） |

## 6. 红线复核（零违反）

- ❌ 未修改企业资料库源码；未改共享 API V1.0。
- ❌ 未建平行账本：Saga 复用既有 Topic/Plan/Task 集合，**schema 仍为 v7，零新集合**。
- ❌ 四类审批未合并；未实现自动平台发布；S05 / MARK 系列未建设。
- ❌ 未部署生产。
- ✅ 模拟发布不能生成真实 Published 条目的既有约束未被触碰。
