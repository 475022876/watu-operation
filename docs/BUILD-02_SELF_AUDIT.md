# Marketing OS V0.1 — BUILD-02 自审报告（交付前审计）

> 审计时间：2026-10-12
> 范围：BUILD-02 全部新增/修改代码、前端页面、测试证据与对外宣称口径。
> 结论：**BUILD-02 达成 Gate B 目标；200/200 断言通过；无 Mock/Real 混淆；可进入下一阶段。**

## 1. 交付范围对照（09 §3 BUILD-02 要求）

| 规范要求 | 交付物 | 状态 |
|---|---|---|
| ContentVersion 锁定 + ReviewCase | `lib/mos/routes/content.js`、`reviews.js`、`manifest.js`、`reviewlib.js`；schema v2 新增 16 集合 | ✅ |
| 文案编辑（C/N/V 规范 + 证据引用） | 内容编辑器三栏；`pillarCode`/`narrativeCode` 来自任务，`evidenceRefIds` 品牌一致性服务端强制 | ✅ |
| Skill Loader + 模板选择（至少一个 Provider） | `lib/mos/skill.js`（Brand Rule Engine）+ `adapters/image.js`、`adapters/text.js`；`mock` 模式可真实产出 | ✅ |
| WorkingAsset / GenerationJob / QA / 预算 | `routes/creative.js`；预算闸门先于外部调用；幂等键；QA 判定固定 `NEEDS_HUMAN_REVIEW` | ✅ |
| Video Workspace（脚本/分镜） | `routes/video.js` + 前端工作区；状态由服务端按实际内容推导 | ✅ |
| Channel / Calendar / Queue / 人工发布 / Published Archive | `routes/channels.js`、`publishing.js` + 前端发布中心四视图 | ✅ |
| E2E-03 / E2E-04 | `tools/mos-e2e-build02.js`，63 断言 | ✅ |
| **必须可操作**（用 Task 编辑/送审冻结→审核→排期→实际发布登记→完整档案） | 浏览器内真实走通：新建草稿→写正文→保存→刷新仍在→冻结只读→审核单出现→排期→登记发布→快照落盘→更正/指标 | ✅ |

## 2. 「真实操作及持久化」核查（用户硬性要求）

> 用户指令：所有页面必须具备真实操作及持久化能力，不允许仅制作展示界面。

| 页面 | 真实写操作 | 持久化验证方式 |
|---|---|---|
| Content Editor | 新建版本 / 编辑保存 / 冻结送审 / 派生新版本 | 浏览器内保存后 **Page.reload**，版本列表仍含该版本（`ui-check` 断言） |
| Visual Studio | 受控提示词预览（真实调用 Brand Rule Engine）/ 上传素材 / 生成作业 | 生成的素材为真实落盘文件，`sha256` 入库；`GET /api/mos/assets/:id/content` 可回读 |
| Video Workspace | 保存 Brief/脚本/分镜/字幕 | 浏览器内保存后 reload，分节标题从 `<input>.value` 读回 |
| Publishing | 登记渠道 / 排期 / 改期 / 登记发布 / 更正 / 指标 | 发布后 `data/uploads/published/<id>/content.md` 与 `manifest.json` 物理存在 |
| My Reviews | 审核裁决（开始/批准/退回/驳回/取消） | 决策 append-only 落 `review_decisions`，并在审计留痕 |

**没有任何页面是纯展示。** 所有写操作都打到真实 API 并落 `mos.json`（或物理快照文件）。

## 3. Mock / Real 边界核查

| 检查项 | 结论 |
|---|---|
| 集成矩阵是否为唯一权威来源 | 是，`lib/mos/config.js` `DEFAULT.integrations`；本次改动已同步 `docs/MOCK_REAL_MATRIX.md` |
| 无 Key 时是否伪造输出 | 否。文本/图像作业落 `NOT_CONFIGURED`；E2E03-15 断言 |
| Mock 产物是否可冒充真实输出 | 否。Mock SVG 在**图像内容内**嵌「MOCK 生成图 · 非真实模型输出」与提示词快照；文本 Mock 首行标注「（MOCK · 非模型输出）」 |
| Mock 资料库是否产生正式资产 | 否。`searchApproved()` 恒空；`verifyFinalAuthorization()` 只返回 `MOCK_APPROVED`（BUILD-01 边界保持不变） |
| 未批准 Skill 是否可能正式输出 | 否。且本次修复了**失效开放**漏洞（见 §5 A-11），未识别 `outputIntent` 一律阻断 |
| 是否存在自动发布 | 否。代码库内**无定时器**；E2E04-14 以等待 2.6s 验证状态与归档均不变 |

## 4. 架构与安全不变量复核

| 不变量 | 实现位置 | 复核结论 |
|---|---|---|
| 冻结版本不可覆盖 | `content.js` `EDITABLE_STATES=['DRAFT']` + `409 VERSION_IMMUTABLE` | ✅ SEC-02-a |
| 批准绑定 Manifest | `manifest.js` 冻结时固化，决策时重算比对 | ✅ SEC-02-f（真实改盘篡改后批准被拒） |
| 三条审批链独立 | `REVIEW_TYPES` 三类共用表但权能按 `type` 分离；无单一 `approved` 标志位 | ✅ |
| 职责分离 | `decideCapability()` 作者不可裁决自己 | ✅ E2E03-07 + UI 断言 |
| G3 需提升授权 | `publishingApprovalElevatedRoles`（角色代码可配置，非角色名） | ✅ 代码复核 |
| 未批准内容不得发布 | `readyGate()`：版本须 `APPROVED` 且渠道 `ENABLED`；排期只能落 `BLOCKED` | ✅ SEC-04-b/c |
| 归档不可编辑 | 发布即物理快照，更正/下架为 append-only 事件 | ✅ E2E04-11 |
| 渠道不存凭据 | `rejectSecrets()` 显式拒绝密码/令牌/OAuth/Cookie 键 | ✅ SEC-04-d |
| RBAC + 品牌级 ABAC | 服务端 `assertCan`/`assertBrand`，拒绝写入审计 | ✅ E2E03-08 |
| CSRF 双提交 + Origin 校验 | 未改动 BUILD-01 逻辑 | ✅ 全部 POST/PUT 在测试中走此路径 |

## 5. 本次审计发现与处置（含遗留）

| # | 发现 | 严重度 | 处置 |
|---|---|---|---|
| A-09 | `MOS_DATA_DIR` 隔离可被绕过（先触碰 store 的入口会写真实 `data/`） | 高 | **已修复**：`getMosConfig()` 先执行 `getConfig()`；回归验证隔离目录生效 |
| A-10 | v1→v2 升级不补种演示集合，升级库发布页不可操作 | 中 | **已修复**：`migrate()` 按版本边界补种；已 v2 的库不复活；另提供独立补种工具 |
| A-11 | Skill 正式输出门禁失效开放（非 `'FORMAL'` 一律降级为测试草稿） | **高（合规）** | **已修复**：别名表 + 未识别取值阻断；E2E03-19 回归 |
| A-12 | UI 检查"模块渲染"断言过弱，路由失效时误判通过 | 中 | **已修复**：断言期望页头 |
| A-13 | 内容编辑器冻结 toast 恒显示 0 张审核单（读错响应字段） | 低 | **已修复** |
| A-14 | `openai`/`deepseek` Provider 真实调用路径**无密钥未验证** | 中（遗留） | **如实标注**：矩阵与报告均写明"代码就绪、未验证"，不宣称已打通。进入下一阶段前不构成阻断 |
| A-15 | 单文件 `mos.json` 存储在万级记录以上会有性能上限 | 低（遗留） | 设计已声明（`store.js` 头注释），上生产需替换真实 DB；原型阶段不阻断 |

## 6. 对外宣称口径（红线）

- 可以说：**"BUILD-02 已交付 AI 创作与传播的完整可操作闭环（sandbox），200/200 自检断言通过。"**
- 不可以说："已接入 AI 生成能力" / "已对接企业资料库或 OA" / "已具备发布自动化" / "已通过合规认证"。
- 原因：文本/图像模型均无密钥（`NOT_CONFIGURED` 或显式 MOCK）；资料库/OA/SSO 未接通；发布为人工登记，无自动化。

## 7. 下一阶段（BUILD-03）前置条件

1. 本报告与 `BUILD-02_TEST_REPORT.md` 经确认后方可启动 BUILD-03。
2. BUILD-03（Analytics / Governance & Assets / 资产入库）依赖的BUILD-02 能力已全部就绪。
3. 建议优先项：若需验证真实模型路径，先注入 Provider Key 并补齐供应商合规评估（数据分级/DPA/训练条款）。
