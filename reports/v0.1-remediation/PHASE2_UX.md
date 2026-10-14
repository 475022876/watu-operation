# PHASE 2｜架构降重与 S04 产品营销修补报告

对应执行包：`VFIB_Marketing_OS_V0.1_Comprehensive_Remediation_V1.0`
整改条目：**M-01 / M-02 / M-03 / M-04、D-01 / D-02、（部分）D-03、F-05 / F-06 / F-09、A-02**
分支：`feat/v0.1-remediation`　日期：2026-10-13

---

## 1. 结论摘要

| 项 | 结果 |
|---|---|
| 全量自检 | **357/357 通过**（Phase 1 收口 332/332 → 净增 **+25** 断言，**零回归**） |
| 单元断言 | 43 → **51**（新增 U-20 系列 8 项：Marketing Brief 核验、模板约束、共享组件契约） |
| 浏览器断言 | 73 → **90**（新增 BUILD-04 系列 17 项：真实浏览器 + 真实写操作 + 刷新持久化） |
| 共享组件 | 新增 `public/mos/js/components/` 四个 kit（reviewkit / assetkit / taskkit / campaignkit，共 **910 行**），被 **6 个页面**复用 |
| 新增页面 | `VFIB Banking Marketing` / `U CARD Marketing`（**同一模块参数化**，不复制 Campaign API） |
| 被删文件 | **0 个**（见 §5：无孤儿页面，冗余规则为「合并」而非「删除文件」） |
| 数据库迁移 | **无需迁移**（schema 保持 v3；新增字段为可选子字段，旧代码读取安全） |
| P0 阻断问题 | 无。**可进入 Phase 3。** |

**复现命令**

```bash
cd /d/运营系统/VFIB-Marketing-OS
node tools/mos-unit-test.js           # 51/51
node tools/mos-ui-check.js            # 90/90（真实 Chrome，含 BUILD-04 段）
bash tools/run-mos-tests.sh all       # 357/357，EXIT=0
```

---

## 2. 六个「工作中心」边界未被破坏（KEEP 校验）

一级导航仍为 **8 个工作中心**，仅在同一中心内**重排/新增条目**：

| 中心 | Phase 2 前 | Phase 2 后 | 变化 |
|---|---|---|---|
| Workspace | my-work / my-reviews / active-projects | 同前 | 不变（My Work 增加「打开 All Tasks」稳定跳转） |
| Brand Center | brand-overview / brand-guidelines / brand-library | 同前 | Brand Overview 增加「本品牌已批准资产」卡片（复用 M-02 组件） |
| Planning Center | planning / topics / intelligence / **tasks** | planning / topics / intelligence / **tasks(All Tasks)** | 仅**改名 + 收敛语义**（M-03 / F-06），路由与 API 不变 |
| Creative Studio | content-editor / visual-studio / video-workspace | 同前 | 不变 |
| Publishing Center | publishing | 同前 | 不变（M-04 由后端投影已满足） |
| **Marketing Center** | campaigns | **marketing-vfib / marketing-ucard / campaigns** | **F-05 新增两个品牌工作区** |
| Analytics Center | analytics | 同前 | 不变 |
| Governance & Assets | governance | 同前 | 标签页不变，内部改为复用共享组件 |

**Published Content 只在运营中台归档**：Phase 2 未触碰 `published_artifacts` / `publication_records` 的归属逻辑；新增的 Campaign「Progress & Results」只**读取**发布记录做聚合展示，不新增归档通路。

---

## 3. MERGE｜架构降重（M-01 ~ M-04）

### M-01 审核列表 / 详情 / 动作组件与 API client 合一 → DONE

- 新增 `public/mos/js/components/reviewkit.js`（227 行）：
  `REVIEW_TYPES` / `caseTypeLabel` / `ACTION_META` / `REMARKS_REQUIRED_ACTIONS` / `decisionButtons` /
  `reviewSummaryCards` / `reviewFiltersHtml` / `bindReviewFilters` / `reviewCard` / `reviewListHtml` /
  `reviewHistoryTable` / `admissionStateBadge` / `fetchReviewCases` / `fetchReviewCaseDetail` /
  `submitReviewDecision` / `fetchReviewHistory` / `openReviewCase` / `decideReviewCase`。
- `modules/reviews.js`（186 → **74 行**）与 `modules/governance.js`（417 → **335 行**）改为消费该 kit。
  两处**不再各自维护**动作文案、原因必填规则、不可裁决原因展示、Manifest 冻结/实时比对面板。
- 治理页的「批准入库 / 驳回」改由 `decideReviewCase` 驱动（`extraBody.approvalRef` 传递入库申请号），
  原先散落的内联 `window.prompt` 与自建裁决弹窗已移除。
- Workspace 仍保留「我的审核队列」快捷入口（KEEP：双入口，单一逻辑）。

### M-02 已批准资产浏览合一（Brand 仅加品牌过滤）→ DONE

- 新增 `public/mos/js/components/assetkit.js`（131 行）：
  `fetchApprovedAssets` / `fetchLibraryAssetRefs` / `reuseBadge` / `gatewaySection` / `sandboxRefsTable` /
  `reuseLegend` / `governanceAssetsHtml` / `brandReferenceHtml` / `bindAssetSearch`。
- `modules/governance.js` 的 Approved Assets 标签页 → `governanceAssetsHtml`；
  `modules/reference.js`（53 → **42 行**）→ `brandReferenceHtml`（**带品牌过滤行**，其余展示完全一致）；
  `modules/brand.js`（89 → **121 行**）新增「本品牌已批准资产」卡片，复用同一检索与 MOCK 空态渲染。
- **不伪造正式资料库结果**：三处的正式库检索段在 MOCK 下恒为空，并显式标注 MOCK / 说明原因（回归断言覆盖）。

### M-03 ContentTask 共享对象 + All Tasks 综合视图 + 创建预填 → DONE

- 新增 `public/mos/js/components/taskkit.js`（183 行）：
  `TASK_STATUSES` / `fetchTasks` / `fetchTaskDetail` / `createTask` / `taskRelation` / `taskTable` /
  `bindTaskRows` / `openTaskDetail` / `openCreateTaskDialog`（**支持品牌 + 关联 ID 预填**）。
- 使用方：`modules/tasks.js`（All Tasks，168 → **148 行**）、`modules/topics.js`（Deliverables 表 + 生成任务）、
  `components/campaignkit.js`（Campaign Deliverables 标签页）、`modules/workspace.js`（同对象跳转）。
- 后端配套（**不新增实体**）：
  - `GET /api/mos/tasks` 新增 `campaignId` / `topicId` 过滤（同一端点服务 Deliverables 与 All Tasks）；
  - `lib/mos/routes/tasks.js` 导出 `serialize`，`lib/mos/routes/topics.js` 的 Topic 详情用它返回
    **同一形状**的 Deliverables（此前只返回 `{id,code,title,status}`，导致 Topic 内交付表信息缺失）。
- 创建按钮预填：Campaign 详情 → 交付任务（预填 `campaignId`）；Topic 详情 → 生成任务（预填 `topicId` +
  栏目/叙事/风险）；All Tasks 深链接 `#/tasks?campaignId=…` / `?topicId=…` / `?create=1` → 预填并自动开窗。

### M-04 日历为统一投影、调期保留变更历史 → DONE（核验 + 补证）

- 后端**已满足**：`GET /api/mos/calendar` 是 `plan_items` + `content_tasks` 日期标记的**投影**；
  `GET /api/mos/publishing/calendar` 是 `publishing_schedules` + `plan_items` 的**投影**。
  两者都不存在独立「内容表」。
- 调期历史：`PUT /api/mos/publishing/schedules/:id` 改期时递增 `revision` 并写 `publishing_schedule.updated`
  审计（append-only），且明确**不触碰** `actual_publish_at`。
- Phase 2 于 Campaign 详情新增文字化说明（Schedule 标签页），避免用户误认为日历是第二份数据源。

---

## 4. MODIFY / ADD｜S04 产品营销与交互（F-05 / F-06 / F-09 / A-02）

### F-05 Marketing Center 品牌工作区 → DONE

- 新增 `public/mos/js/modules/marketing.js`（124 行）：**一个模块按 `ctx.module.id` 参数化**，
  注册两条路由 `marketing-vfib`（期望品牌 VFIB）与 `marketing-ucard`（期望品牌 UCARD），
  **不复制 Campaign API / 不复制详情页**（详情复用 `campaignkit.openCampaignDetail`）。
- 内容：品牌 Campaign 列表、任务进展聚合、**Brief 待核验宣称计数**、品牌 Brief 模板卡片、新建 Campaign（带模板）。
- 品牌一致性：当 `ctx.brand` 与工作区期望品牌不一致时显示「品牌不匹配」提示 + 一键切换（`ctx.setBrand`）。
- **不含**获客漏斗 / CAC / 生命周期 / CRM / 线索移交（MARK-S05 / MARK-LEAD 保持 MARK，未开发）。

### A-02 结构化 Marketing Brief（嵌入 Campaign）→ DONE

- 新增 `lib/mos/brieflib.js`（领域逻辑，独立成 lib 便于单测与复用）：
  `verifyRef` / `evaluateClaims` / `evaluateRefs` / `defaultMarketingBrief` / `normalizeMarketingBrief`。
- Campaign 新增 `marketingBrief` 结构化字段：`objectives[] / audience / coreMessage /
  productClaims[] / productRefs[] / regionComplianceNote / executors[] / startAt / endAt / templateCode`。
- **产品宣称必须关联已核准知识/来源**，且核验状态**由服务端计算**（客户端不可写）：
  - `EVIDENCE` → 仅当引用证据 `verificationState === 'VERIFIED'` 才 `VERIFIED`；
  - `LIBRARY` → 复用 `admissionlib.reuseEligibility`（Mock 下恒不可用）；
  - `KNOWLEDGE` → 知识库为 MOCK，一律 `UNVERIFIED` 并给出原因；
  - 任一未核验 → `readyForOfficialUse = false`（「不得以模拟结果冒充正式功能」）。
- 按品牌切换模板：`lib/mos/dict.js` 新增 `MARKETING_BRIEF_TEMPLATES`（VFIB → `VFIB_BANKING`，
  UCARD → `UCARD_MARKETING`），模板**只含框架字段与合规提醒，绝不预置任何产品宣称**；
  新增 `GET /api/mos/marketing/brief-templates`。
- 新增 `GET /api/mos/campaigns/:id/results`：只聚合中台真实数据（任务状态分布、发布记录计数），
  **渠道绩效显式 `available:false` + `missing[]` + NOT CONFIGURED**，不 0 填充、不估算。

### F-06 Planning 职责收敛 → DONE

- W03 = Monthly Planning / Master Topics / Intelligence（+ 共享的 All Tasks）；
  W06 = VFIB Banking Marketing / U CARD Marketing / Campaigns。职责按 02 §2 划清。
- 跨中心少重复填写：任务创建三处均走 `openCreateTaskDialog`，品牌/关联自动带入；
  Topic 详情新增 **Narrative** 段（栏目/叙事/风险）并标注 provisional 口径。

### F-09 导航与可达性 → DONE

- 8 中心保留；品牌切换确认（`hasUnsaved` 闸门）沿用；
- 新增**深链接路由**：`#/<route>?k=v`（`parseHash` / `buildQuery` / `applyRoute`），
  点导航 = 进入干净页面，粘贴/刷新深链接 = 保留参数（可预测且稳定）；
- 导航项补 `aria-label` + `type="button"`；`aria-current` 沿用；全局 `:focus-visible` 与
  `table-wrap{overflow-x:auto}` 保证键盘/窄屏可操作（既有）；
- Campaign 详情抽屉为**右侧抽屉短路径**，五个标签键盘可达。

---

## 5. DELETE｜D-01 / D-02 / D-03

| 项 | 结论 | 证据 |
|---|---|---|
| D-01 移除重复的前端业务规则判断 | **DONE（合并式）** | 审批动作/原因必填/不可裁决展示 → 仅存于 `reviewkit.js`；资产浏览/MOCK 空态/可复用徽标 → 仅存于 `assetkit.js`；任务表/创建/详情 → 仅存于 `taskkit.js`。**未删除** ContentTask / ReviewCase / LibraryAssetReference 实体或 API。 |
| D-02 废弃 UI 组件（确认无路由引用后移除） | **DONE（无对象）** | 脚本核验：18 个 `modules/*.js` 与 app.js 的路由表**一一对应**，`ORPHAN = (none)`、`MISSING = (none)`。故无文件可删。 |
| D-03 历史材料归档 | **PARTIAL（本阶段只做只增不改）** | Phase 2 未删除任何历史审计/自测/ADR；`docs/CURRENT_ARCHITECTURE.md` 与 `docs/history/` 归档按计划在 **Phase 4** 交付。 |

**被删文件清单：无。**

**文件级增减（行数）**

| 文件 | 前 | 后 | 说明 |
|---|---|---|---|
| `modules/reviews.js` | 186 | 74 | 逻辑迁移至 reviewkit |
| `modules/governance.js` | 417 | 335 | 审核历史/资产浏览迁移至 reviewkit + assetkit |
| `modules/reference.js` | 53 | 42 | 迁移至 assetkit |
| `modules/campaigns.js` | 192 | 58 | 迁移至 campaignkit |
| `modules/tasks.js` | 168 | 148 | 收敛为 All Tasks + 共享 taskkit |
| `modules/brand.js` | 89 | 121 | 新增共享资产卡片（净增） |
| 新增 `components/*.js` | — | 910 | 4 个共享 kit |
| 新增 `modules/marketing.js` | — | 124 | F-05 品牌工作区 |
| 新增 `lib/mos/brieflib.js` | — | 123 | A-02 Brief 领域逻辑 |

---

## 6. 数据库迁移与回滚

**本阶段不需要迁移。**

- `mosSchemaVersion` 保持 **3**；未新增顶级集合、未改写既有集合的字段语义。
- 新增的 `campaigns[].marketingBrief` 是**可选子字段**：
  - 旧数据缺失时由 `brieflib.defaultMarketingBrief()` 在序列化时**惰性回落**为模板默认（不批量改写历史数据）；
  - 回滚到 Phase 1 代码后，多余字段被忽略，**历史 Campaign / Topic / 任务 / 发布 / 审核数据零丢失**。
- 市场模板为**静态配置**（`lib/mos/dict.js`），不落库，因此回滚即恢复旧模板行为。
- 回滚步骤：`git revert <Phase2 commit>`（或 `git reset --hard 943eb73`）后重启服务即可；若曾用真实数据，
  仍建议先 `cp data/mos.json data/mos.json.bak-$(date +%s)`（本项目一贯做法，Phase 4 会给出正式迁移/回滚文档）。

---

## 7. 测试与证据

### 7.1 单元测试（43 → 51）

| 用例 | 覆盖 |
|---|---|
| U-20 | 品牌 Brief 模板存在，且 **productClaims 字段不预置** + 合规提醒必须显式「禁止/不得」 |
| U-20b | 未关联来源的宣称一律 `UNVERIFIED` 且 `readyForOfficialUse=false`；空行清理 |
| U-20c | 仅真实 `VERIFIED` 证据可核验；LIBRARY(KNOWLEDGE/Mock) 恒 UNVERIFIED；非法 kind 拒绝 |
| U-20d | `productRefs` 同样由服务端计算；空 `refId` 丢弃并给出原因 |
| U-20e | 全部核验时 `readyForOfficialUse=true`（可达性；Mock 下不可达） |
| U-20f | `defaultMarketingBrief` 按品牌回落模板且不带任何宣称 |
| U-20g | campaigns / tasks 路由导出统一序列化器（M-03 / F-05 同源） |
| U-20h | 4 个共享组件文件存在且导出契约齐备（M-01 / M-02 / M-03） |

### 7.2 真实浏览器（Chrome 154，CDP）新增 17 项（73 → 90）

关键断言（全部为**真实写操作 + 刷新/重算后校验**，非「打开看一眼」）：

1. UI 创建 Campaign 并入列；服务端存在且 **模板按品牌预填**（`VFIB_BANKING`）。
2. Campaign 详情**五段式**（Brief / Deliverables / Schedule / Assets / Results）。
3. 写入一条**无来源**产品宣称 → UI 显示「受阻」，服务端 `readyForOfficialUse=false`、
   `claimSummary.unverified>=1`。
4. Deliverables 标签页创建任务时 **Campaign 关联已预填**（= 该 Campaign id），创建后出现在交付表。
5. Results 标签页出现 **NOT CONFIGURED**/不可用，**不出现虚构绩效数字**。
6. `#/tasks?campaignId=…` 深链接过滤生效；`GET /api/mos/tasks?campaignId=` 返回同一任务（同源）。
7. VFIB / U CARD 工作区渲染、品牌不匹配提示与一键切换、切换后使用对应品牌模板。
8. Reference Library 复用共享资产浏览组件（M-02）。

无页面级未捕获异常、无控制台 error。

### 7.3 截图证据（12 张）

`UI_EVIDENCE_MOS_BUILD04/`：
`B04-38-marketing-vfib.png`、`B04-39-marketing-ucard.png`、`B04-40-campaigns-list.png`、
`B04-41-campaign-brief.png`、`B04-42-campaign-brief-blocked.png`、`B04-43-campaign-deliverables.png`、
`B04-44-campaign-results.png`、`B04-45-all-tasks-deeplink.png`、`B04-46-marketing-vfib.png`、
`B04-47-marketing-ucard-mismatch.png`、`B04-48-marketing-ucard.png`、`B04-49-brand-reference-shared.png`

---

## 8. 过程中发现并修复的自身缺陷（自审记录）

| # | 现象 | 根因 | 处置 |
|---|---|---|---|
| B04-01 | 营销工作区整页崩溃（mount 异常） | `campaignkit.campaignProgressHtml` 内残留 `void cls;`，引用了已移出作用域的形参 | 移除该语句与多余形参；浏览器断言覆盖 |
| B04-02 | 「受阻」判定偶发失败 | 断言在服务端回填**之前**就读取（新宣称行默认显示 UNVERIFIED，构成假阳性就绪信号） | 改为等待**仅保存成功后才会出现**的核验原因文本 |
| B04-03 | All Tasks 深链接过滤未生效 | 测试先改 hash 又点导航项，导航按设计覆盖为无参路由 | 确认「点导航=干净进入」是正确行为，改为只改 hash 即触发路由 |
| B04-04 | UCARD 模板断言偶发失败 | 「品牌不匹配提示消失」早于数据渲染完成，被当作完成信号 | 改为等待模板代码真正渲染 |
| B04-05 | `Illegal return statement` 中断整段 UI 流程 | 两处 `Runtime.evaluate` 表达式含顶层 `return` | 包进 `(function(){…})()` |

> 这些均为**测试/实现自身问题**，非产品缺陷；已全部修复并留回归断言（避免同类竞态再犯）。

---

## 9. 尚未完成事项（转入 Phase 3 / Phase 4）

| 事项 | 归属 | 状态 |
|---|---|---|
| 轻量资讯自动采集调度（cron-like / 任务记录 / 退避 / 去重 / 锁 / 单实例声明） | Phase 3（A-01） | 待做 |
| SPECIAL-01 字典 `provisional` 项核验（F-07） | Phase 3 | 待做 |
| 真实文本 / 图像 Provider 契约测试（A-05，无凭据则 NOT_CONFIGURED） | Phase 3 | 待做 |
| 企业资料库适配层 + 契约测试（A-06，与 Workspace 最新版对齐） | Phase 3 | 待做 |
| `docs/CURRENT_ARCHITECTURE.md`、`docs/history/` 归档、`MOCK_REAL_MATRIX.md` 更新、源码 ZIP、`reports/FINAL_AUDIT.md` | Phase 4 | 待做 |
| 正式迁移/回滚文档（本阶段无迁移，仍需成文） | Phase 4 | 待做 |
| Campaign Brief 模板若需**运营可配**（当前为 dict 静态配置） | 后续（需批准） | 未做（本轮不引入无据配置面） |
| S05 客户增长 / 品牌声誉专项 / 营销线索移交闭环 / 社媒自动发布 | **MARK（禁止）** | 未开发 |
