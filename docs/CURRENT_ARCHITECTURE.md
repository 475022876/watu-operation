# VFIB Marketing OS V0.1 —— 当前架构与状态清单

> **本文件描述整改后（Phase 0—4 完成）的现状**，取代已归档的 `docs/history/ARCHITECTURE_AUDIT.md`（整改前诊断）。
> 生成时间：2026-10-13。基线：`watu-operation`（本地 `D:\运营系统\VFIB-Marketing-OS`，远端 `475022876/watu-operation`）。
> 阶段报告：`reports/PHASE0_BASELINE.md`、`PHASE1_SECURITY.md`、`PHASE2_UX.md`、`PHASE3_INTEGRATIONS.md`、`FINAL_AUDIT.md`。

---

## 1. 技术栈与运行形态（未变）

| 项 | 现状 |
|---|---|
| 运行时 | **零第三方依赖 Node.js**（仅 `node:*` 内置模块）。`package.json` 无 `dependencies` |
| 存储 | **单文件 JSON**（`data/mos.json`），schema 版本化 + 原子落盘（唯一 tmp + `renameSync` + 写序号防回滚） |
| 写入策略 | 60ms 写合并（`schedule()` / `flush()`）；安全关键写入（登录/登出会话）走 `saveNow()` **创建即同步落盘** |
| 服务端口 | 默认 **9080**；自检占 **9500-9699**；与 OA 侧端口段互斥（见 README 端口表） |
| 前端 | **ESM，无框架**。`public/mos/js/{app.js,api.js,ui.js}` + `modules/*.js`（按路由动态 `import()`）+ **`components/*.js` 共享套件** |
| 路由 | **哈希路由 + 深链接** `#/<route>?k=v`（`parseHash()` / `buildQuery()` / `applyRoute()`），点导航 = 干净入口（不带参数） |
| 隔离 | 每个自检套件使用随机 `data-mos-*` 目录，跑完自清，**绝不触碰 `data/`** |

## 2. 八大工作中心与导航映射

整改**保留八个一级工作中心**（KEEP 项）。Phase 2 的导航收敛：

| # | 中心 | 导航项（当前） | Phase 2 变化 |
|---|---|---|---|
| 1 | **Workspace** | My Work / My Reviews / Active Projects | 新增「打开 All Tasks」快捷入口 |
| 2 | **Brand Center** | Brand Overview / Visual & Guidelines / Reference Library | Brand Overview 新增「本品牌已批准资产」卡（复用 assetkit，M-02） |
| 3 | **Planning Center** | Monthly Planning / Master Topics / Intelligence / **All Tasks** | `Content Tasks` → **`All Tasks`**（M-03：跨中心共享综合视图） |
| 4 | **Creative Studio** | Content Editor / Visual Studio / Video Workspace | 未变 |
| 5 | **Publishing Center** | Publishing（日历 / 队列 / 渠道 / Published Archive） | 未变 |
| 6 | **Marketing Center** | **VFIB Banking Marketing** / **U CARD Marketing** / Campaigns | **新增两个品牌工作区**（F-05），复用同一 Campaign API，无重复后端 |
| 7 | **Analytics Center** | Analytics | 未变（真实聚合，缺失即 `available:false` + `missing[]`） |
| 8 | **Governance & Assets** | Governance & Assets | 三条审批链统一组件（M-01） |

**导航映射（旧 → 新）**：`Content Tasks` → `All Tasks`；`Marketing Center` 由单页扩展为
`VFIB Banking Marketing` + `U CARD Marketing` + `Campaigns`；模块 **id/路由未改名**（深链接向后兼容），
仅**标签**变更。所有入口基于**同一 ID 与同一 API**，支持深链接返回来源上下文（`?campaignId=` / `?topicId=` / `?create=1`）。

## 3. 关键不变量（不得破坏）

| 不变量 | 落地位置 |
|---|---|
| **三条独立审批链**（专业审核 / 发布审批 / 资产入库），无单一 `approved` 标志 | `lib/mos/routes/reviews.js`、`admissionlib.js` |
| **`library.asset.approve.final` 为独立特权**（P1/MOS_ADMIN 不持有） | `lib/mos/rbac.js`、`lib/mos/routes/admissions.js` |
| **AssetAdmission 双字段互不推导**；`reuseEligibility` 为**计算**属性，Mock 下结构性不可达 | `lib/mos/admissionlib.js` |
| **任务 / 内容版本分离**；发布审批绑定不可变 `ContentVersion` + hash | `lib/mos/routes/content.js`、`publishing.js` |
| **Published Content 只归档在 Marketing OS**（资料库侧 `publishedContentArchive` 恒 `false`） | `lib/mos/routes/publishing.js`；`adapters/workspace.js` |
| **正式复用资产由资料库单一权威管理** | `admissionlib.js` + `adapters/library.js` |
| **品牌级 ABAC**：跨品牌访问返回 **404**（防枚举） | `lib/mos/rbac.js` |
| **风险 G0–G3**；G3 需**提升授权**角色（可配置，不写死姓名） | `lib/mos/skill.js`、`config.publishingApprovalElevatedRoles` |
| **结果诚实性**：真实聚合或 `available:false` + `missing[]`；不 0 填充、不估算 | `lib/mos/routes/analytics.js` |
| **不把未配置接口改成 REAL** | `docs/MOCK_REAL_MATRIX.md` + 各适配器 fail closed |

## 4. 数据模型（schema v4）

`MOS_SCHEMA_VERSION = 4`。集合共 **19 个**：

```
品牌/身份：brands · users · user_roles · sessions
计划/主题：monthly_plans · plan_items · campaigns · monthly_campaign_links
           master_topics · campaign_topic_links · content_tasks
情报：    source_registry · source_items · evidence_references
创作：    skill_versions · creative_templates · content_versions
          review_cases · review_decisions · working_assets · generation_jobs · video_artifacts
发布：    channels · publishing_schedules · publication_records · published_artifacts
          publication_corrections · publication_metrics
入库：    asset_admissions · library_asset_refs
调度：    ingest_jobs                ← v4 新增（A-01）
审计：    audit_events
```

### 版本历史（**只增不改**）

| 版本 | 变更 | 回滚 |
|---|---|---|
| v1 → v2 | 新增 16 个空集合（创作/发布/入库域） | 删除新增集合字段，版本号改回 1 |
| v2 → v3 | 不新增集合，仅固定 `asset_admissions` / `library_asset_refs` 形状 | 版本号改回 2 |
| **v3 → v4** | **新增 1 个空集合 `ingest_jobs`** | 删除 `ingest_jobs` 字段，版本号改回 3 |

**迁移幂等**：`store.migrate()` 二次调用报告「无变更」。
**不预置任何业务数据**（不伪造历史、不预置「已批准资产」）。
可选子字段 `settings.dictionaryVerifications`（F-07 运行时核验登记）缺失时语义回落为「全部待核验」。

## 5. 迁移与回滚

### 5.1 正常升级

1. **停服**（Windows 下 `SIGTERM` 为硬终止，务必先停）。
2. 备份 `data/mos.json`（系统亦自动生成 `mos.json.bak-*`）。
3. 启动新版本 → `store.load()` 自动执行 `migrate()` 并落盘（v3→v4 增空集合，既有数据零改写）。
4. 验证：`GET /api/mos/meta` 的 `schemaVersion === 4`。

### 5.2 回滚

| 场景 | 操作 |
|---|---|
| 快速回滚 | 停服 → 还原 `data/mos.json.bak-*` → 装回旧版本 |
| 就地降级 | 停服 → 编辑 `data/mos.json`：删除 `ingest_jobs` 字段、`mosSchemaVersion` 改回 `3` → 装回 v3 代码 |
| 调度数据 | `ingest_jobs` 为审计日志，删除不影响业务；采集条目在 `source_items`，**保留** |
| 字典核验 | 删除 `settings.dictionaryVerifications` → 字典回落为「全部待核验」（不会产生错误标签） |

> 回滚**不丢业务数据**：v3 代码不引用 `ingest_jobs` 与 `dictionaryVerifications`，可直接读取同库。

## 6. 安全边界（Phase 1 加固后）

| 边界 | 实现 |
|---|---|
| **出站 SSRF 防御** | 主机 allowlist + https-only + 端口 allowlist + IPv4/IPv6 私网段拦截（含 IPv4-mapped IPv6 十六进制形）+ DNS 重绑定防御（`pinnedLookup`）+ 逐跳重定向重校验 + `Accept-Encoding: identity` + 生产下测试开关失效 |
| **装配顺序** | `MOS_DATA_DIR` 隔离**必须**先经 `lib/config.js getConfig()`（`getMosConfig()` 首行强制），否则任何先触碰 store 的入口会写进真实 `data/`（A-09，**勿回退**） |
| **Skill 门禁** | 未识别的 `outputIntent` **一律阻断**；`REFERENCE_ONLY` Skill 不得经配置伪装为正式 Approved（A-11，**勿回退**） |
| **凭据** | 口令仅存 scrypt 哈希（不可逆推）；初始口令只在首启打印一次，不落盘不落日志；Provider/资料库私钥只在服务端 |
| **AI 外发分级** | `RESTRICTED` 在任何外部调用**之前**阻断；外部网页/RSS 一律视为不可信数据，提示词显式防注入 |

## 7. 当前状态清单（集成诚实性）

| 能力 | 状态 | 备注 |
|---|---|---|
| 身份 / 知识库 / 资料库（沙盒） | `mock` | 见 `docs/MOCK_REAL_MATRIX.md` |
| 外部情报采集 | `real` | 真实 HTTP 出站，受 allowlist + SSRF 约束 |
| 文本 / 图像模型 | `none`（默认） | **未配置即 NOT_CONFIGURED**（A-05 契约面已就绪，见 `reports/PHASE3_INTEGRATIONS.md`） |
| 企业资料库真实集成 | `not_configured` | 适配层已完成；**真实联调 NOT_VERIFIED** |
| 来源自动调度 | **默认关闭** | 开启后仅授权白名单来源；**明确单实例限制** |
| 专业字典 provisional | **全部待核验** | 权威原件未随包提供，不臆造正式标签 |
| 平台指标 API / CAC 漏斗 | 未接通 / 不在本期 | MARK-S05 未建设 |

## 8. 代码地图（后端）

```
server.js                        # HTTP 入口 + MOS 挂载 + 采集调度器挂载 + 启动自述
lib/config.js                    # 主配置（端口/路径/信任代理/安全开关）
lib/mos/
  config.js  dict.js  store.js   # 子系统配置 / 业务字典 / 单文件存储（schema 迁移）
  rbac.js  audit.js  ids.js      # RBAC+ABAC / 审计 / ID 与摘要
  skill.js  brieflib.js          # Brand Rule Engine / Marketing Brief 核验
  admissionlib.js  dictverify.js # 入库资格计算 / 字典核验门禁（F-07）
  ingest.js  scheduler.js        # 采集引擎 / 轻量调度（A-01）
  providercontract.js            # Provider 统一契约（A-05）
  workspace-contract.js          # 企业资料库逐字节契约（A-06）
  router.js  seed.js
  routes/                        # 18 个路由模块（按域拆分）
  adapters/                      # identity/knowledge/library/source/text/image/workspace
```
