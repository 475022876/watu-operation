# Marketing OS V0.1 — BUILD-03 自审报告（交付前审计）

> 审计时间：2026-10-12
> 范围：BUILD-03 全部新增/修改代码、前端页面、测试证据与对外宣称口径。
> 结论：**BUILD-03 达成 Gate C 目标；311/311 断言通过；Mock 与真实集成边界清晰；无"纯展示页面"。**

## 1. 交付范围对照（09 §4 BUILD-03 要求）

| 规范要求（09 §4） | 交付物 | 状态 |
|---|---|---|
| 三条审核链 + 最终权威 | `lib/mos/routes/reviews.js`（`PERM_BY_TYPE` 三链分离）+ 新增 `ASSET_ADMISSION` 链 | ✅ |
| AssetAdmission + LibraryGateway Mock + 幂等 | `lib/mos/routes/admissions.js`（9 条路由）、`lib/mos/admissionlib.js`、`lib/mos/adapters/library.js`（重写） | ✅ |
| 仅在授权 Mock / 真实库测试条件下做"已批准检索"，且显式标注 MOCK | `searchApproved()` 恒空；沙盒条目与正式库条目**分列**；`libraryIntegrationMode` 如实返回 | ✅ |
| Analytics 真实聚合（未接指标显示为"缺失"） | `lib/mos/routes/analytics.js`（四段 + `missing[]`）+ 前端 `modules/analytics.js` | ✅ |
| 权限 / 审计 / 失败恢复 | 独立特权 `library.asset.approve.final`；全部拒绝写审计；`retry-sync` 幂等恢复 | ✅ |
| E2E-05 与 SEC 全量 | `tools/mos-e2e-build03.js`，75 断言 | ✅ |
| **必须可操作**（不允许仅制作展示界面） | 见 §2：全部 17 个导航页面均为真实读写 | ✅ |

## 2. 「真实操作及持久化」核查（用户硬性要求）

> 用户指令：所有页面必须具备真实操作及持久化能力，不允许仅制作展示界面。

BUILD-03 交付/升级的两个页面（原本是占位页）：

| 页面 | 真实写操作 | 持久化验证方式 |
|---|---|---|
| **Analytics（运营分析）** | 录入渠道指标（写 `publication_metrics`，带来源与统计时点） | 前端提交后重新拉取 `GET /api/mos/analytics` 反映真实聚合；无数据时显示「缺失」而非 0 |
| **Governance & Assets（治理与资产）** | 新建入库申请 / 执行预检 / 提交最终审批 / 批准 / 驳回 / 同步 / 失败重试 | 浏览器内点击「执行预检」后列表状态变为 `PRECHECK`；`Page.reload` 后申请与预检结果仍在（B03-UI 断言）；后端落 `asset_admissions` / `library_asset_refs` |

同时**清理了两个历史遗留的"展示型"实现**（见 §5 A-25 / A-26 及以下）：

| 位置 | 原状 | 现状 |
|---|---|---|
| `GET /api/mos/topics/:id/reuse` | `contentVersions`/`publications` 为硬编码空数组（注释"BUILD-02 填充"），从未实现 | 按 Topic → ContentTask → ContentVersion → PublicationRecord 真实聚合；前端渲染真实表格 |
| `public/mos/js/modules/{campaigns,tasks,topics,guidelines}.js` | 多处「…将在 BUILD-02 交付」的失实占位文案（BUILD-02 已交付） | 改为指向真实入口（内容编辑器 / 发布中心 / 内容任务），不再承诺已交付的能力 |
| `public/mos/js/modules/stage.js` | Analytics / Governance 的占位页模块 | **已删除**，`app.js` 改为加载真实模块 |

**结论：没有任何页面是纯展示。** 所有写操作都打到真实 API 并落 `mos.json`（或物理快照文件）。

## 3. Mock / Real 边界核查

| 检查项 | 结论 |
|---|---|
| 集成矩阵是否为唯一权威来源 | 是（`lib/mos/config.js` `DEFAULT.integrations`）；本次已同步更新 `docs/MOCK_REAL_MATRIX.md` |
| **Mock 下 `AVAILABLE` 是否可能达成** | **不可能**。`reuseEligibility` 为**计算**判定，要求 `approvalMode=REAL` + `libraryId` 非空 + `permissionValid` + `ACTIVE`；Mock 回执固定 `permissionValid=false` / `assetState=MOCK_SANDBOX` / `libraryId=MOCK_*` | 
| 正式库检索是否可能返回伪造资产 | 否。`searchApproved()` 恒返回 `items: []`；沙盒条目单独分区展示 |
| 入库审批是否可以绕过第三条链 | 否。`PERM_BY_TYPE.ASSET_ADMISSION` 为独立特权；预检员（`asset.review`）与 `MOS_ADMIN` 均 403 |
| 是否存在自动发布 / 自动入库 | 否。入库同步**只能**由已批准申请 + 人工触发；发布仍为人工登记，代码库内无定时器 |
| 受限资料是否可能外发模型 | 否。`RESTRICTED` 在**调用 Provider 之前**阻断（fail closed），未知分级一律 400 |
| 同步失败恢复是否可靠 | 是。`SYNC_FAILED → LIBRARY_SYNC_PENDING` 为状态机合法边；重试复用同一 `idempotencyKey`，且先按回执对账，不产生双资产 |
| 故障注入是否污染生产语义 | 否。`MOS_LIBRARY_MOCK_FAULT` 默认关闭、仅 Mock 读取、瞬时故障不入缓存 |

## 4. 架构与安全不变量复核

| 不变量 | 实现位置 | 复核结论 |
|---|---|---|
| 三条审批链独立（无单一 `approved` 标志） | `reviews.js` 按 `type` 分离权能与主体；`reviews.decideCapability` | ✅ SEC-01-a…e |
| **最终入库许可为独立特权** | `PERM_BY_TYPE.ASSET_ADMISSION = 'library.asset.approve.final'`；`ASSET_REVIEWER` 刻意不含该权限 | ✅ A-16 修复后可验证 |
| 职责分离 | `decideCapability()`：提交人不可裁决自己的入库申请 | ✅ SEC-01-e + 正向对照 e2 |
| 审批绑定冻结内容 | `admissions.bindingHash()` 冻结于审核单；决策时比对不符即 `409 ASSET_CHANGED` | ✅ SEC-02-x |
| 双字段互不推导 | `finalApprovalStatus` 与 `syncStatus` 独立；批准后 `syncStatus` 仍为 `NOT_STARTED` | ✅ E2E05-11 |
| 可复用资格只计算不存储 | `admissionlib.reuseEligibility()` 纯函数；无任何接口可写入该字段 | ✅ U-15/15b、SEC-09-b |
| 幂等（申请 / 同步） | 同 `idempotencyKey` 返回同一结果；同内容摘要返回既有回执 `deduplicated` | ✅ E2E05-03/13、SEC-08-c/d、U-18 |
| 数据分级闸门先于外部调用 | `creative.js` 在预算闸门之前判定 `dataClass` | ✅ SEC-10-a/b/c |
| RBAC + 品牌级 ABAC | 服务端 `assertCan` / `assertBrand`；越界返回 **404** 防枚举 | ✅ GOV-03/04、AN-02 |
| 审计完整且脱敏 | 所有拒绝与失败均写 `audit`；metadata 脱敏 | ✅ SEC-01-d、SEC-08-e、GOV-05 |
| **安全关键写入立即持久化** | `identity.createSession/destroySession` 改用 `saveNow()` | ✅ ENV-06（A-26 修复后） |
| 口径范围外能力不出现 | Analytics `scopeNote` 显式排除 CAC / 漏斗 / 归因；前后端均无入口 | ✅ AN-01/13 + 代码复核 |

## 5. 本次审计发现与处置

| # | 发现 | 严重度 | 处置 |
|---|---|---|---|
| A-16 | `ASSET_ADMISSION` 审批误用 `asset.review`，最终入库特权失效开放 | **高（合规）** | **已修复**：改为 `library.asset.approve.final`；新增 `ASSET_REVIEWER` 角色；SEC-01-b/c/d 回归 |
| A-17 | `retry-sync` 置 `PRECHECK` 导致非法迁移，失败恢复路径**实际不可用** | **高** | **已修复**：保持 `SYNC_FAILED`，走状态机合法边；SEC-08-c/d/f 回归 |
| A-18 | `dict.js` 声明顺序错误（TDZ）导致服务**无法启动** | **高（构建期暴露）** | **已修复**：`DATA_CLASSES` 上移并加顺序约束注释 |
| A-19 | 单元测试框架不支持 `async`，异步断言**静默通过**；并发用例互相清表 | **高（测试可信度）** | **已修复**：`t()` 改为串行链 | 
| A-20 | e2e 复用同字节素材，触发正确的 `not_duplicate` 拒绝，掩盖真实断言 | 中 | **已修复**：每次上传唯一内容；新增 E2E05-17/18 固化该行为 |
| A-21 | e2e 选角错误（P2 无 `asset.review`；提交人自批被拦截）导致 404 而非预期断言 | 中 | **已修复**：预检由资产预检员执行；补正向对照 SEC-01-e2 |
| A-22 | `MOCK_REAL_MATRIX.md` 与实现漂移（Mock 回执字段名/状态） | 中 | **已修复**：矩阵同步更新，并新增 BUILD-03 边界 11–14 |
| A-23 | `submitAdmission` 回执表在进程内，跨重启幂等依赖 MOS 侧持久化 receipt | 低（遗留） | **如实声明**（代码头注释 + 测试报告 §3.1）；真实实现应由资料库侧持久化 |
| A-24 | 提交人不能撤回自己的入库申请 | 低（设计取舍） | **维持并记录**：撤回属审核链动作，不是申请人自助动作 |
| A-25 | **展示型空壳接口**：Topic 复用视图的版本/发布恒为空数组，前端固定显示"暂无记录" | **中** | **已修复**：后端真实聚合 + 前端真实渲染；REUSE-01…04 回归 |
| A-26 | **安全关键写入依赖 60ms 合并窗口**：登录/登出在窗口内被硬终止会丢写（注销的会话可能在重启后"复活"） | **高（安全）** | **已修复**：改用 `saveNow()`；ENV-06 回归 + 定向探针（修复前 0/20/80ms 延迟全部丢失，修复后均落盘）|
| A-27 | 单文件 `mos.json` 在万级记录以上存在性能上限 | 低（遗留） | **设计已声明**（`store.js` 头注释）；上生产需替换真实 DB；原型阶段不阻断 |

### 5.1 关于 A-26 的平台事实（必须记录）

本机为 Windows，`child.kill('SIGTERM')` 是**硬终止**，服务端的优雅关停分支
（`[exit] 收到 SIGTERM … saveNow()`）**不会执行** —— 已在定向探针中确认日志无该行。
因此：**Windows 上"关停时兜底落盘"不可依赖**。这既解释了历史 e2e 抖动，也说明把会话这类
安全关键状态放进写入合并窗口本身就是设计缺陷，修复方向（创建即持久化）比依赖关停兜底更正确。

## 6. 对外宣称口径（红线）

- 可以说：**"BUILD-03 已交付资产入库（第三条审批链）、真实运营分析与治理视图的完整可操作闭环（sandbox），311/311 自检断言通过。"**
- 不可以说：
  - "已对接企业资料库 / 完成真实入库"（**未接通**，回执一律 `MOCK_*`，`AVAILABLE` 结构性不可达）；
  - "资产已可复用"（Mock 下可复用数恒为 0，且为服务端计算判定）；
  - "已接入 OA / SSO / 知识库"（均为 `未接通`）；
  - "已接通平台指标 API"（未接通，指标只能人工/导入登记，无数据即显示「缺失」）；
  - "已具备 CAC / 获客漏斗 / 行为归因"（明确在范围外）。
- 原因：`docs/MOCK_REAL_MATRIX.md` §1 中身份、知识库、资料库、文本模型、图像模型均未接通真实系统；
  仅"外部情报采集"为真实出站请求。

## 7. 下一阶段（BUILD-04）前置条件

1. 本报告与 `docs/BUILD-03_TEST_REPORT.md` 经确认后方可启动 BUILD-04。
2. BUILD-04（后续阶段）所依赖的资产入库、分析聚合、治理视图能力已就绪。
3. 建议优先项（按风险排序）：
   - **A-23**：真实资料库接通后，回执幂等必须由资料库侧持久化并做跨重启对账验证；
   - **A-14**：如需验证真实模型路径，先注入 Provider Key 并补齐供应商合规评估（数据分级 / DPA / 训练条款）；
   - **A-27**：进入正式环境前替换单文件存储为真实数据库。
