# 变更文件清单与删除清单（V0.1 综合整改 Phase 0—4）

- **基线（唯一开发基线）**：`watu-operation` — 本地 `D:\运营系统\VFIB-Marketing-OS`，远端 `475022876/watu-operation`。
- **基线起点**：`567de9c feat: BUILD-02 + BUILD-03 交付（AI 创作/传播、资产入库、真实分析、治理视图）`
- **整改提交**：`943eb73`（Phase 0/1）→ `0a63590`（Phase 2）→ `62a26b8`（Phase 3）→ Phase 4（本文档所在提交）。
- **口径**：**未重新创建系统**；所有改动为**增量**。

---

## 1. 删除清单（DELETE）

> 整改主控 D-01 / D-02 要求：「只删除真正冗余且无依赖的实现」「废弃的旧 UI 组件仅在确认不再被路由引用时移除；**输出被删文件列表及原因**」。

### 1.1 结论：**本轮未删除任何文件（零删除）**

验证命令与结果：

```bash
git diff --diff-filter=D --name-only 567de9c HEAD
# → 输出为空（无任何文件被删除）
```

**为什么零删除**——逐项核对 D-01 / D-02 / D-03：

| 检查 | 结果 |
|---|---|
| 重复的前端业务规则判断（D-01） | Phase 2 改用**共享组件套件**（`components/*.js`）**消除重复**，但**未删除**任何业务实体或 API（`ContentTask` / `ReviewCase` / `LibraryAssetReference` 全部保留） |
| 废弃的旧 UI 组件（D-02） | 全仓引用检索显示：**路由引用的模块数 18 === 模块文件数 18**，无孤儿模块 → 无可删除项 |
| 历史审计 / 自测 / ADRs（D-03） | **禁止删除** → 改为**迁移归档**（见下） |

### 1.2 归档（迁移，非删除）

依 D-03「将过时材料按历史档案迁移至 `docs/history/`，保留 git 追踪/链接」，采用 **`git mv`**（历史连续，`git log --follow` 可追溯）：

| 原路径 | 新路径 | 归档原因 |
|---|---|---|
| `docs/ARCHITECTURE_AUDIT.md` | `docs/history/ARCHITECTURE_AUDIT.md` | 被 `docs/CURRENT_ARCHITECTURE.md` 取代（整改前 → 整改后） |
| `docs/BUILD-02_PLAN.md` | `docs/history/BUILD-02_PLAN.md` | BUILD-02 已交付，计划已消费 |
| `docs/BUILD-03_PLAN.md` | `docs/history/BUILD-03_PLAN.md` | BUILD-03 已交付，计划已消费 |

引用同步更新：`README.md`、`docs/ADRs/ADR-001-tech-stack.md`、`docs/ADRs/ADR-002-standalone-repo.md`、`docs/BUILD-01_SELF_AUDIT.md`。
归档策略与索引：`docs/history/README.md`。

### 1.3 明确**未**删除（KEEP）

`My Reviews`、正式审核中心、视频策划、Published Archive、**Mock adapter**（真实集成成功前不得删除）、
全部 ADRs、全部历史测试报告与自审报告。

---

## 2. 新增文件（ADD · 34 个）

### Phase 1（`943eb73`）

| 文件 | 用途 |
|---|---|
| `tools/mos-security-egress-test.js` | 出站采集安全套件（`sec`，17 断言） |

### Phase 2（`0a63590`）

| 文件 | 用途 |
|---|---|
| `public/mos/js/components/reviewkit.js` | 审核列表/详情/动作共享组件（M-01） |
| `public/mos/js/components/assetkit.js` | 已批准资产检索/展示共享组件（M-02） |
| `public/mos/js/components/taskkit.js` | 内容任务共享组件（M-03） |
| `public/mos/js/components/campaignkit.js` | Campaign Brief/Deliverables/进展组件（F-05 / A-02） |
| `public/mos/js/modules/marketing.js` | 品牌营销工作区参数化模块（F-05：VFIB / U CARD 复用） |
| `lib/mos/brieflib.js` | Marketing Brief 结构 + **服务端**宣称核验（A-02） |
| `reports/PHASE2_UX.md` | Phase 2 交付报告 |

### Phase 3（`62a26b8`）

| 文件 | 用途 |
|---|---|
| `lib/mos/ingest.js` | 共享采集引擎（A-01） |
| `lib/mos/scheduler.js` | 轻量调度器：间隔 / 作业 / 去重 / 退避 / 锁（A-01） |
| `lib/mos/dictverify.js` | 字典 provisional 核验门禁（F-07） |
| `lib/mos/providercontract.js` | Provider 统一契约面（A-05） |
| `lib/mos/workspace-contract.js` | 企业资料库**逐字节**契约（A-06） |
| `lib/mos/adapters/workspace.js` | 企业资料库调用方适配器（A-06） |
| `tools/mos-scheduler-test.js` | 调度套件（`sched`，20 断言） |
| `tools/mos-provider-contract-test.js` | Provider 契约套件（`provider`，21 断言） |
| `tools/mos-workspace-contract-test.js` | 资料库契约套件（`workspace`，30 断言） |
| `docs/INTEGRATION_WORKSPACE_CONTRACT.md` | 集成适配说明 + 启用步骤 |
| `reports/PHASE3_INTEGRATIONS.md` | Phase 3 交付报告 |

### Phase 4（本提交）

| 文件 | 用途 |
|---|---|
| `docs/CURRENT_ARCHITECTURE.md` | A-03：当前架构 + 状态清单 + 导航映射 + 迁移/回滚 |
| `docs/API_CONTRACT_AND_INTEGRATION_STATUS.md` | A-03：API 契约与集成状态 |
| `docs/DELETION_AND_CHANGE_LIST.md` | 本文档 |
| `docs/history/README.md` | 归档策略与索引（D-03） |
| `reports/FINAL_AUDIT.md` | 总复审报告 |
| `reports/OPEN_ITEMS.md` | 尚未完成事项清单 |
| `tools/package-mos-source.sh` | 源码交付包打包脚本 |
| `reports/PHASE0_BASELINE.md` / `PHASE1_SECURITY.md` | （Phase 0/1 报告，随本提交归档展示） |

---

## 3. 修改文件（MODIFY · 20 个）

| 文件 | 阶段 | 变更摘要 |
|---|---|---|
| `lib/mos/adapters/source.js` | 1 | SSRF 加固：`expandIpv6` / `pinnedLookup` / `fetchWithRedirects` / 生产测试开关失效（F-01，含 **IPv4-mapped IPv6 十六进制形** 绕过修复） |
| `lib/mos/config.js` | 1/3 | Phase 1 增 `egress.allowedPorts`/`maxRedirects`/`isProductionMode()`；Phase 3 增 `scheduler`/`text`/`image`/`workspace` 段与对应 `MOS_*` 环境变量 |
| `lib/mos/store.js` | 3 | schema **v3 → v4**：新增空集合 `ingest_jobs`（只增不改） |
| `lib/mos/routes/sources.js` | 3 | 采集改走统一 `ingest` 引擎；新增调度与作业端点 |
| `lib/mos/routes/helpers.js` | 3 | `dictionaries()` 改走 `dictverify.applyOverrides()`（**封堵"一行配置洗成正式"**）；`integrationStatus()` 增企业资料库项 |
| `lib/mos/routes/meta.js` | 3 | 新增字典核验、Provider 契约探针、资料库状态端点 |
| `lib/mos/adapters/text.js` | 3 | Provider 契约补齐：`health`/`invoke`/硬超时/错误码/限流/费用回执 |
| `lib/mos/adapters/image.js` | 3 | 同上（图像侧） |
| `lib/mos/routes/creative.js` | 3 | `capability` 追加 `imageHealth`/`textHealth` |
| `server.js` | 3 | 挂载采集调度器 + 启动自述新增调度行 |
| `public/mos/js/modules/intelligence.js` | 3 | 情报页新增「采集调度」卡片 + 来源作业历史 |
| `public/mos/js/ui.js` | 3 | 集成条新增「企业资料库」状态（如实显示 NOT_CONFIGURED） |
| `lib/mos/dict.js` | 2 | 新增 Marketing Brief 模板（仅框架字段，**不含任何产品宣称**） |
| `lib/mos/routes/campaigns.js` | 2 | `marketingBrief` + `progress`；新增 brief-templates / results 端点 |
| `lib/mos/routes/tasks.js` | 2 | 支持 `campaignId` / `topicId` 过滤 |
| `lib/mos/routes/topics.js` | 2 | Topic 详情任务走 `tasks.serialize` 统一形状 |
| `public/mos/js/app.js` | 2 | `CENTERS.marketing` 三入口；`tasks` → **All Tasks**；深链接路由（`parseHash`/`applyRoute`/`navigate`/`setBrand`）；a11y |
| `public/mos/js/modules/{reviews,governance,reference,brand,campaigns,tasks,topics,workspace}.js` | 2 | 改用共享组件套件；精简行数（如 `reviews.js` 186→74、`governance.js` 417→335、`campaigns.js` 192→58） |
| `tools/mos-unit-test.js` | 2/3 | 51 → **69** 断言（S04 Brief、F-07 字典核验、A-05 Provider 契约、A-06 资料库契约、schema v4） |
| `tools/mos-e2e-build03.js` | 3 | 88 → **94** 断言（调度 API、字典核验 API、Provider/资料库状态） |
| `tools/mos-ui-check.js` | 2/3 | 90 → **97** 断言；新增 `UI_EVIDENCE_MOS_BUILD05/` 证据目录路由 |
| `tools/run-mos-tests.sh` | 1/3 | 套件入口增 `sec` / `sched` / `provider` / `workspace`；汇总表同步 |
| `README.md` | 3/4 | 测试表、文档索引、启动与启用说明更新 |
| `.env.example` / `config.example.json` | 3 | 新增调度 / Provider / 资料库配置样例（**不含任何真实凭据**） |
| `docs/MOCK_REAL_MATRIX.md` | 3/4 | 新增第 11–13 行（企业资料库 / 采集调度 / 字典核验） |
| `docs/ADRs/*.md`、`docs/BUILD-01_SELF_AUDIT.md` | 4 | 归档路径引用同步 |

---

## 4. 提交统计

| 提交 | 阶段 | 文件数 | 变更行数 |
|---|---|---|---|
| `943eb73` | Phase 0 + 1 | 8 | +1071 / −82 |
| `0a63590` | Phase 2 | 23 | +2096 / −577 |
| `62a26b8` | Phase 3 | 30 | +4394 / −150 |
| Phase 4（本提交） | Phase 4 | 见 `git show --stat` | 文档与打包为主 |

**整改期合计**：`git diff --name-only 567de9c HEAD` → **54 个文件**（其中**新增 34**、**修改 20**、**删除 0**）。

---

## 5. 复现验证

```bash
cd D:/运营系统/VFIB-Marketing-OS
git diff --diff-filter=D --name-only 567de9c HEAD      # 删除清单：应为空
git diff --name-status 567de9c HEAD                    # 完整变更清单
git log --oneline 567de9c..HEAD                        # 整改提交序列
bash tools/run-mos-tests.sh all                        # 全量回归（应 472/472）
```
