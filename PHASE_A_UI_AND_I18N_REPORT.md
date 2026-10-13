# PHASE_A_UI_AND_I18N_REPORT.md —— V0.1.2 Phase A 交付报告

> 日期：2026-10-14 ｜ 基线：Phase 0（`ee6383d`） ｜ 状态：**已完成，回归全绿**

## 1. 交付内容

### 1.1 五主 + 两辅导航（UX-01）

`public/mos/js/app.js CENTERS` 重构（模块 id 全部不变 → 旧深链接/收藏天然兼容）：

| 入口 | 子页 |
|---|---|
| 主1 工作台 Workspace | 我的工作（升级版工作台）、进行中项目 |
| 主2 策划与情报 Planning & Intelligence | 情报资讯、专题内容包、月度计划、营销活动、VFIB 银行营销、U CARD 营销 |
| 主3 内容制作 Content Production | 全部任务、内容编辑器、视觉工作室、视频工作区 |
| 主4 发布管理 Publishing | 发布管理（日历/队列/渠道/发布归档） |
| 主5 运营分析 Analytics | 运营分析 |
| 辅1 品牌与素材 Brand & Assets | 品牌总览、视觉与规范、参考资料库 |
| 辅2 审批与管理 Review & Administration | 我的审核、治理与资产 |

- **辅2 按权限可见**：`P1/P3/PROFESSIONAL_REVIEWER/PUBLISHING_APPROVER/ASSET_REVIEWER/LIBRARY_FINAL_APPROVER` 之一（或 MOS_ADMIN）才渲染；服务端 RBAC 不受影响（隐藏按钮不代替鉴权）。
- 辅助入口与主导航之间有视觉分隔（`.nav-group.aux`）。
- 所有 20 个既有模块 100% 可达（ui-check visits 逐页断言页头）。

### 1.2 中英双语（I18N-01）

- 新增 `public/mos/js/i18n.js`：中文为源语言，en-US 走**精确匹配字典**；品牌专名/用户输入/草稿/AI 正文不翻译；内部状态码/API 字段不翻译。
- 顶栏新增语言切换按钮（`#langBtn`，中文⇄English），**无损实时切换**：导航即时重建，模块经 remount + MutationObserver 翻译异步渲染内容。
- **偏好服务端持久化**：`PUT /api/mos/auth/preferences {locale}` → `users[].prefs.locale`（zh-CN/en-US 白名单校验 + `user.prefs.updated` 审计）；`GET /api/mos/auth/me` 返回 `prefs`；重新登录仍有效。localStorage 仅作未登录临时记忆，不是权威。
- 字典覆盖：8 工作中心、20 导航条目、页头、面包屑（分段翻译）、常见按钮/状态/徽标/空态。

### 1.3 员工任务工作台（UX-02）

`GET /api/mos/my-work` 扩展 + `public/mos/js/modules/workspace.js`：

- **继续上次工作**：新端点 `PUT /api/mos/my-work/continue {taskId}`（服务端 `users[].prefs.lastTaskId`，越权 403/不存在 404/审计落盘）；工作台顶部常驻「继续上次」条，一键 `#/content-editor?task=<id>` 直达并预选任务（content.js 支持深链接参数）；**不依赖 localStorage 作为任务权威**。
- **本周待发布**：与发布管理**同一数据源**（`publishing_schedules`，SCHEDULED，未来 7 天，品牌过滤），空态明确说明「排期≠已发布」。
- 卡片语义对齐规格：我的任务（今日待办）、待我审核、待我推进的计划、本周待发布、继续上次；无数据均有清晰空态文案。

### 1.4 Schema v5 → v6（只增不改）

`lib/mos/store.js`：v6 迁移仅给缺 `prefs` 的用户补 `{locale:null,lastTaskId:null}`，幂等、不覆盖既有值；无新集合。测试断言同步（unit U-19 系列、sched SCH-01、e2e03 GOV-06 更新至 v6 并新增 v6 字段断言）。

## 2. 测试证据

| 套件 | 结果 |
|---|---|
| `bash tools/run-mos-tests.sh all`（11 套件） | **675/675 通过**（smoke13/unit75/sec17/sched20/provider21/workspace36/dual51/e2e48/e2e02 63/e2e03 96/**ui 110**） |
| `ui`（真实浏览器 CDP） | **110/110**（新增 4 项双语断言：语言按钮存在 / 切 EN 后主导航为英文 / **偏好持久化 en-US 服务端实测** / 切回中文导航恢复） |
| 截图 | `UI_EVIDENCE_MOS_BUILD01/`（30 张，中文界面 + 全流程） |

修复过程中发现并解决：新导航曾遗漏 marketing-vfib/ucard 两个入口（ui-check 抓住）→ 已补入「策划与情报」；残留测试进程导致的一次 dual 挂起为环境问题（单跑 51/51 正常）。

## 3. 已知边界（诚实声明）

- en-US 字典当前覆盖**系统级高频文案**（导航/页头/面包屑/按钮/状态/空态）；各模块**长描述段落**（ph-desc、callout 说明文）尚未逐条入字典，en-US 下保留中文原文（不影响操作与数据，Phase B/C 随页面改造逐步补齐）。
- 「继续」深链接到内容编辑器时，若任务品牌与当前品牌上下文不一致，任务下拉不会命中该任务（品牌过滤使然）；工作台「继续」按钮不自动切换品牌上下文——属**有意保守行为**（避免静默改品牌），后续在任务工作空间（Phase C 四标签页）中根治。

## 4. Phase A 结论

**通过**。5 主 + 2 辅导航、双语无损切换（服务端持久化）、员工工作台（继续上次 + 本周待发布）全部落地；原功能零丢失；回归 675/675。可以进入 Phase B。
