# Phase 0 — 源码影响核验与基线（VFIB Marketing OS V0.1.2 → V0.1.3）

- 执行包：`D:/企业数据后台/VFIB_Marketing_OS_V0.1.3_AI_Research_UX_Remediation_Codex/VFIB_Marketing_OS_V0.1.3_Codex_Execution_Pack`（7 文件 + SHA256 清单）
- **执行包完整性**：`sha256sum -c SHA256_MANIFEST.txt` → **7/7 OK**
- 源码基线：`66a23e5`（`main`）；`package.json` **0.1.2**；schema **v7**；双系统契约 **1.0**
- 基线日期：2026-10-14
- 唯一改动仓库：`D:/运营系统/VFIB-Marketing-OS`（**企业资料库 `oa-system` 零改动**）
- 目录约定：V0.1 综合整改期的 `reports/*.md` 已按零删除约定 `git mv` 归档至 `reports/v0.1-remediation/`，
  本轮 V0.1.3 交付占用 `REPORTS/`（Windows 大小写不敏感，二者为同一目录）。

---

## 1. 逐条核实执行包「现状」陈述 vs 实际源码

> 规则：冲突以实际源码为准（00 README §项目及版本边界）。

| # | 执行包陈述 | 实际源码 | 判定 |
| --- | --- | --- | --- |
| 1 | 源码已含 `lib/mos/adapters/websearch.js` | ✅ 存在（79 行）。`providerStatus()` / `isConfigured()` / `assertSafeUrl()` / `search()` | **一致** |
| 2 | 开发方报告仍称 Web Search BLOCKED | ✅ 一致，但**比陈述更严重**：未配置 → `BLOCKED/NOT_CONFIGURED`；**已配置 → `PROVIDER_NOT_IMPLEMENTED`**（真实通道仅是注释占位，`search()` 无任何网络请求）。「只打开配置开关冒充实现」在此代码上不可能发生，但**有 Key 仍然不可用** | **差异（P0 实现缺口）** |
| 3 | 已有 `research_reports / research_findings / source_evidence / topic_proposals` 对象 | ✅ v7 已建（实际为 5 集合，另含 `research_jobs`） | **一致** |
| 4 | i18n 依赖 `public/mos/js/i18n.js` 的**全局 DOM 字符串匹配**翻译 | ✅ 一致：`applyDom()` 用 `TreeWalker` 精确匹配中文键 + `MutationObserver` 异步补译（133 行），**无资源文件/key** | **一致（须改 key-based）** |
| 5 | 「Visuals & Video」「Review & Delivery」存在**跳转旧独立中心**的体验缺口 | ✅ **已实证**（Phase 0 真实浏览器）：点这两个标签后 `location.hash` 由 `content-editor` 变为 `visual-studio` / `my-reviews`，**离开任务上下文** | **一致（P0 缺口）** |
| 6 | 一站式任务工作空间 | ❌ 现状：`content.js` 为三栏编辑器；视觉/视频/审核在**其他模块**（`video_artifacts` 由独立 `video-workspace` 维护） | **缺口（P0）** |
| 7 | 视频需支持脚本/分镜/字幕/关键帧/素材上传 | ✅ **后端已实现**：`GET/PUT /api/mos/video/:taskId`，支持 `script / storyboard(≤120 shot) / subtitles / keyframeAssetIds / finalUpload` | **可复用为内嵌组件** |
| 8 | SSRF 须在 DNS 解析/连接层屏蔽私网 | ⚠️ **采集侧已达标**：`lib/mos/adapters/source.js` 已实现 `pinnedLookup`（DNS 解析固定 IP + TOCTOU 修复）+ 白名单 + 重定向复核；**研究侧 `websearch.js` 只有 URL 字面正则，无连接层防护** | **差异（P0 缺口）** |
| 9 | 文本 Provider | `text.js` 已实现 **deepseek 非流式真实通道**（`draft()`；无密钥 → `INTEGRATION_PENDING`）；`mock` 为确定性骨架并显式标注 | **可用**；当前 `config.json` `textProvider:"none"` |
| 10 | 预算与费用门禁 | `config.json` 已有 `mos.budget={brandMonthlyUsd:0,perJobUsdMax:0}`，但**未接入**研究/生成链路（无预算实体、无用量累计） | **缺口（P0）** |
| 11 | 异步研究 job、进度、取消、幂等重试 | ⚠️ `research_jobs` 仅记录**一次**调用结果（无状态机/进度/取消/轮询端点）；`generation-jobs` 有同步幂等键 | **缺口（P0）** |
| 12 | 8 大业务中心归属不得改变 | ✅ 后端路由域与集合归属未变；前端 5 主 + 2 辅（模块 id 未变） | **一致** |
| 13 | `text.js` 注释引用的 `lib/deepseek.js` | ❌ **该文件不存在**（注释过时）；真实调用直接用 `providercontract.fetchWithTimeout` 打 `api.deepseek.com` | **文档过时（非功能缺陷）** |
| 14 | 普通员工无需理解技术对象 | ⚠️ 现状：内容编辑器右栏直接暴露 `textProvider/imageProvider` 模式、Skill 版本与状态、`rowVersion`/`textHash`；卡片展示 `Manifest 哈希` 等 | **缺口（P1 减法）** |

---

## 2. 现状架构速览（Phase A—C 改动锚点）

### 2.1 后端路由（`lib/mos/routes/`，19 文件）

| 域 | 文件（行数） | 关键端点 |
| --- | --- | --- |
| 研究 | `research.js`（341） | `POST /research/daily`、`POST /research/web`、`GET /research/reports[/:id]`、`GET /research/provider-status`；`topic-proposals` 创建/列表/`submit`/`decision` |
| 编辑派工 | `editorial.js`（405） | `approve-to-pool`、`approve-and-schedule`（幂等 Saga）、`GET /editorial/views` |
| 内容版本 | `content.js`（459） | `content-versions` CRUD、`/lock` 冻结送审、`/revise` 派生 |
| 视频 | `video.js` | `GET/PUT /video/:taskId`（脚本/分镜/字幕/关键帧/成片上传） |
| 创作 | `creative.js`（727） | `prompt-preview`、`formal-output-check`、`generation-jobs`、`assets/upload` |
| 审核 | `reviews.js`（461） | `review-cases[/:id]`、`:id/decision`、`review-history` |
| 发布 | `publishing.js`（588） | `schedules`、`calendar`、`publications`（仅人工登记）、`corrections`、`metrics` |
| 其他 | `tasks/plans/topics/sources/admin/auth/meta/analytics/channels/campaigns/admissions` | — |

### 2.2 适配器（`lib/mos/adapters/`）

`websearch`（**待实现**）、`text`（deepseek/mock/none，含 data-class 闸门）、`image`、`source`（**含连接层 SSRF**）、`library`、`workspace`（契约 1.0 逐字节实现）、`identity`、`knowledge`。

### 2.3 数据（schema v7）

`users[].prefs` · `content_versions` · `review_cases/decisions` · `video_artifacts` · `generation_jobs` · `working_assets` · `source_registry/items` · `research_reports/findings/source_evidence/topic_proposals/research_jobs` · `master_topics/plan_items/content_tasks` · `publishing_schedules/publication_records/published_artifacts`。

### 2.4 前端（`public/mos/js/`）

`app.js`(452 导航/路由) · `i18n.js`(133 DOM 匹配) · `ui.js` · `api.js` · `components/{taskkit,reviewkit,campaignkit,assetkit}.js` · `modules/*`(19)。关键：`content.js`(563 内容编辑器) · `intelligence.js`(822 情报/AI 研究/选题建议) · `video.js`(358) · `visual.js`(270)。

---

## 3. Phase 0 真实浏览器基线（证据 `UI_EVIDENCE/PHASE0/`）

- 真实浏览器：**Chrome/155.0.8059.79**（CDP；`tools/mos-ux-evidence.js`；隔离数据目录，未触碰 `data/`）
- 台账：`UI_EVIDENCE/PHASE0/steps.json`（17 步，**控制台错误 0 条**）；截图 16 张

**已量化基线事实：**

| 指标 | V0.1.2 基线实测 | V0.1.3 目标 |
| --- | --- | --- |
| 任务内点「图片与视频」是否跳出任务 | **跳出**（`content-editor → visual-studio`） | 不跳出（UX-02） |
| 任务内点「审核与交付」是否跳出任务 | **跳出**（`content-editor → my-reviews`） | 不跳出（UX-02） |
| P2 落地页 → 内容编辑器 | 1 次点击；但编辑器**初始未选中版本**（无正文可编辑），需再选/建版本 | ≤2 动作直达可编辑（UX-02） |
| 一级导航 | 5 主 + 2 辅（模块 id 未变） | 维持 |
| 首屏技术参数条数（内容编辑器右栏） | Provider 模式 + Skill 版本/状态 + rowVersion + textHash ≥4 条 | ≤0（收纳进高级设置） |

---

## 4. 现有测试口径（基线）

`bash tools/run-mos-tests.sh all` → **773/773**，13 套件：`smoke · unit · sec · sched · provider · workspace · dual · e2e · e2e02 · e2e03 · ui · research(55) · editorial(43)`；`ui` 110/110（真实 Chrome）。独立：`joint` 64/64、`build06` 61/61。证据：`TEST_EVIDENCE_MOS_BUILD01..06`、`TEST_EVIDENCE_MOS_V012_{RESEARCH,EDITORIAL}`。

---

## 5. 本轮改动边界（红线，零违反承诺）

- ✅ 不改企业资料库源码；✅ 不改双系统 API 契约 1.0（`adapters/workspace.js` 保持）
- ✅ 不重建 8 大业务中心；不重造 OA 数据库；不改 Published Archive 权威归属
- ✅ 不改最终资产审批权限（`library.asset.approve.final` 仅真实身份；选题审批不可代替）
- ✅ 不擅自自动发布社媒；不偷加 S05/CRM/代理佣金
- ✅ 不把 Mock 标为 REAL；未核验银行能力不作宣传；未获批准不部署生产
- ✅ 保留**无 AI 时的手工完成全链路**（防 API 失效导致业务瘫痪）

---

## 6. 实施次序（对齐执行包 00 §执行节奏）

| 阶段 | 目标 | 交付 |
| --- | --- | --- |
| **A** | 一站式任务空间（内嵌正文/图片/视频脚本分镜/审核提交，不跳出任务）+ 信息层级减法；先保证**无 AI 也可全链路完成** | `REPORTS/PHASE_A_UX.md` + `UI_EVIDENCE/PHASEA/` |
| **B** | 真实授权搜索 Provider（可配置/不写死）+ 连接层 SSRF + 文档获取 + 证据链 + LLM 结构化研究 + 栏目推荐 + 异步 job/预算/取消 | `REPORTS/PHASE_B_REAL_RESEARCH.md` + `REAL_PROVIDER_EVIDENCE/` |
| **C** | key-based 双语（`zh-CN`/`en-US` 资源 + `t(key,params)` + 状态/错误码映射）+ 品牌减法 + 响应式/无障碍 | `REPORTS/PHASE_C_CONTENT_I18N.md` |
| **D** | 全量回归 + 双系统联调 + 迁移/安全/回滚 + 升版 **0.1.3** | `REPORTS/FINAL_ACCEPTANCE_V0.1.3.md` + `OPEN_ITEMS.md` + 源码包 |

---

## 7. Phase 0 结论

- 执行包对现状的描述**基本准确**；核实发现 **3 处需修正**：
  1. Web Search 不只是「BLOCKED 待密钥」——**真实通道未实现**（`PROVIDER_NOT_IMPLEMENTED`），属**实现缺口**而非配置问题；
  2. 研究域**缺异步 job 状态机/进度/取消/预算门禁**；
  3. `text.js` 注释引用的 `lib/deepseek.js` **不存在**（文档过时）。
- 两项 P0 体验缺口的**真实浏览器实证已取得**（跳出现象 2/2，截图 16 张，零控制台错误）。
- 结论：**可按 A→B→C→D 连续实施**，无需先修复环境问题。
