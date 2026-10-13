# E2E_TEST_REPORT.md —— P1—P4 端到端业务路径测试报告

> 对应 `02_MARKETING_OS_CODEX_TASK.md` **Phase M3**。
> 基线提交 `3c19e79` ｜ 执行时间 **2026-10-13 19:51–19:53（GMT+8）** ｜ 环境：本机隔离实例（非生产）
> 执行命令：`bash tools/run-mos-tests.sh all` → **478/478 全通过**（10 套件，exit 0）
> 证据：`TEST_EVIDENCE_MOS_BUILD01|02|03/`、`UI_EVIDENCE_MOS_BUILD01/`

---

## 0. 本轮测试的执行口径（**必读**）

| 项 | 说明 |
|---|---|
| 测试对象 | **Marketing OS 单侧**（本仓库），使用**Mock 资料库网关**与**未配置的 Provider** |
| 真实资料库 | **未接入**（`LIBRARY_HANDOFF_BUNDLE` 未交付）→ 凡依赖「真实资料库服务」的步骤一律 **BLOCKED** |
| 真实模型 | **未调用**（无凭据）→ 凡依赖「真实 AI 模型」的步骤一律 **BLOCKED** |
| 认证方式 | 真实 HTTP + HttpOnly Cookie 会话 + CSRF + RBAC/ABAC（**非** Mock 鉴权） |
| 数据库 | 独立临时数据目录（`data-mos-*`），不触碰 `data/` |
| 浏览器 | 真实 headless Chrome（CDP），`tools/mos-ui-check.js`，97/97 通过 |
| 声明 | 本报告**不声称**任何真实跨系统联调通过；`MOCK`/`NOT_CONFIGURED` 项**一律不记为 PASS** |

## 1. 逐套件结果

| 套件 | 命令 | 断言 | 结果 |
|---|---|---|---|
| smoke | `run-mos-tests.sh smoke` | 13/13 | ✅ |
| unit | `run-mos-tests.sh unit` | 69/69 | ✅ |
| sec（出站安全） | `run-mos-tests.sh sec` | 17/17 | ✅ |
| sched（采集调度） | `run-mos-tests.sh sched` | 20/20 | ✅ |
| provider（Provider 契约） | `run-mos-tests.sh provider` | 21/21 | ✅ |
| **workspace（企业资料库契约）** | `run-mos-tests.sh workspace` | **36/36**（原 30，本轮 +6） | ✅ |
| e2e（BUILD-01 主链） | `run-mos-tests.sh e2e` | 48/48 | ✅ |
| e2e02（BUILD-02 创作/传播） | `run-mos-tests.sh e2e02` | 63/63 | ✅ |
| e2e03（BUILD-03 资产治理/分析） | `run-mos-tests.sh e2e03` | 94/94 | ✅ |
| ui（真实浏览器） | `run-mos-tests.sh ui` | 97/97 | ✅ |
| **合计** | | **478/478** | ✅ **exit 0** |

## 2. 执行包 M3 五条流程逐条结果

### 流程 1｜外部合规资讯 → 来源记录 → MasterTopic → 月计划/营销项目

| 步骤 | 结果 | 证据（断言名） |
|---|---|---|
| 来源登记（默认「待核验」） | ✅ REAL（本侧） | `UI 验证来源登记表展示采集频率与「不自动」标识` |
| 未核验来源 **拒绝抓取**（fail closed） | ✅ REAL | `E2E-01b 未核验来源拒绝抓取（fail closed）`、`SCH-API-05 未核验来源的手工采集被阻断` |
| 采集失败**留作业记录**、不伪造成功 | ✅ REAL | `SCH-API-06 被阻断的采集同样留下作业记录（BLOCKED + 失败码，可审计）` |
| 条目保存 canonical/published/fetched/许可 | ✅ REAL | `E2E-01e 情报条目保存 canonical/published/fetched/license` |
| 由情报创建 Master Topic | ✅ REAL | `E2E-01h` |
| Topic **可回溯 SourceItem**（含原文链接/许可/采集时间） | ✅ REAL | `E2E-01i Topic 可回溯 SourceItem` |
| 停用来源后拒绝采集 | ✅ REAL | `E2E-01j` |
| → 月计划 / PlanItem / Campaign 关联 | ✅ REAL | `E2E-02a`…`E2E-02d`、`E2E-02e`、`E2E-02g`、`E2E-02j` |
| **对真实公网来源的实际抓取** | ⛔ **BLOCKED** | 来源**许可（robots/条款/授权）未获业务确认**；本轮未对公网来源做实时抓取回归；`scheduler` 默认关闭 |

### 流程 2｜Campaign/Topic → ContentTask → AI 草稿/图像 → 专业审核 → 发布审批

| 步骤 | 结果 | 证据 |
|---|---|---|
| 由 Topic 生成内容任务 | ✅ REAL | `E2E-02e 由 Topic 生成内容任务` |
| **AI 草稿 / 图像生成** | ⛔ **BLOCKED** | `A05-02 未配置供应商时如实为 NOT_CONFIGURED（不含任何密钥字段）`、`SEC-07-b hasServerKey=false`、`AN-06 作业带数据分级并如实落 NOT_CONFIGURED` |
| 分级 `RESTRICTED` 在**调用 Provider 之前**阻断 | ✅ REAL | `SEC-10-a/b/c`（无 `providerJobId`、无产物、未知分级 `400`） |
| 两条**独立**审核链（专业 / 发布） | ✅ REAL | `E2E03-06 G2 内容自动生成「专业审核 + 发布审批」两条独立链`、`E2E03-08 无审核权限者被拒绝（403）` |
| 专业审核未过 → 发布审批被阻塞 | ✅ REAL | `E2E03-09 PROFESSIONAL_REVIEW_PENDING` |
| 两链都完成 → 版本 `APPROVED` | ✅ REAL | `E2E03-11` |
| 审核拒绝 / 重提 | ✅ REAL | `SEC-02-f 批准被篡改的底稿被拒绝（MANIFEST_CHANGED）`、`SEC-02-g 被拒绝后审核单未被改动` |
| **真实模型产出** | ⛔ **BLOCKED** | 见 `AI_PROVIDER_AND_SKILL_REPORT.md` |

### 流程 3｜PublishingSchedule → 人工发布登记 → PublicationRecord → Published Archive

| 步骤 | 结果 | 证据 |
|---|---|---|
| 排期状态机（越级/非法迁移被拒） | ✅ REAL | `E2E04-03 ILLEGAL_TRANSITION` |
| **无真实 URL/证据不能登记发布** | ✅ REAL | `E2E04-05` |
| 人工登记发布成功 → 归档记录 | ✅ REAL | `E2E04-06` |
| 归档带**正文哈希 + 清单哈希** | ✅ REAL | `E2E04-07`（可追溯批准对象） |
| 快照**物理落盘**（正文 + 清单） | ✅ REAL | `E2E04-08` |
| 归档正文**只读**（从快照读，非工作副本） | ✅ REAL | `E2E04-09` |
| 更正后**原快照仍保留**（仅追加、不可编辑） | ✅ REAL | `E2E04-11` |
| **系统不存在自动发布**（到期状态与归档均不变） | ✅ REAL | `E2E04-13`、`E2E04-14` |
| 渠道登记拒绝任何密码/令牌；URL 强制 HTTPS | ✅ REAL | `SEC-04-d SECRET_NOT_ALLOWED`、`SEC-04-e` |
| 日历与排期**同一数据源** | ✅ REAL | `PUB-01`、`PUB-02` |
| **OA/资料库侧无自动镜像** | ✅ REAL（结构性） | `lib/mos/routes/publishing.js` 对 `adapters/workspace`、`adapters/library` **零引用**（实测 grep）；`A06-02` 断言 `publishedContentArchive=false` |
| **测试渠道沙盒** | ⛔ **BLOCKED** | 未提供任何外部渠道测试账号；登记流程为**人工登记**（本侧按设计即人工），**未发生对真实渠道的发布** |

### 流程 4｜WorkingAsset → 申请入库 → 前审 → **实际授权审批人**最终批准 → 资料库正式 ID/版本 → 授权复用

| 步骤 | 结果 | 证据 |
|---|---|---|
| 上传工作素材（魔数 + sha256） | ✅ REAL | `E2E05-01`、`E2E05-01b 伪装成图片的脚本被魔数校验拒绝` |
| 创建申请 → `SUBMITTED`，双字段初始 `PENDING`/`NOT_STARTED` | ✅ REAL | `E2E05-02` |
| 幂等：同 `idempotencyKey` 不重复创建 | ✅ REAL | `E2E05-03` |
| 资产分类 `A01–A08` 字典强制 | ✅ REAL | `E2E05-04` |
| 无 `asset.review` 不能预检（403） | ✅ REAL | `E2E05-05` |
| 预检通过并记录检查项 | ✅ REAL | `E2E05-06`、`E2E05-17 同内容重复入库被预检拒绝`、`E2E05-18 预检未过不能提交最终审批` |
| 第三条**独立**审批链 `ASSET_ADMISSION` | ✅ REAL | `E2E05-07`、`E2E05-08` |
| **只有本人专属授权身份能做最终批准** | ✅ REAL | `SEC-01-a 无 library.asset.approve.final 者被拒（403）`、`SEC-01-b 资产预检员被拒`、**`SEC-01-c 技术管理员（MOS_ADMIN）不自动获得最终入库特权（403）`** |
| 每次越权尝试**写审计** | ✅ REAL | `SEC-01-d` |
| 职责分离（提交人不能批自己的申请） | ✅ REAL | `SEC-01-e`、`SEC-01-e2 正向对照` |
| 批准后 `syncStatus` **独立保持** `NOT_STARTED` | ✅ REAL | `E2E05-11`（双字段不互相推导） |
| **资料库返回正式 Asset ID/版本** | ⛔ **BLOCKED** | Mock 下回执恒 `MOCK_ASSET_*` + `MOCK_SANDBOX`（`E2E05-12`）；**真实库未接入** |
| **Mock 下不得出现 AVAILABLE / 可复用** | ✅ REAL（负向） | `SEC-09-a`、`SEC-09-b`、`E2E05-15`、`E2E05-16`、`E2E05-14 正式库检索恒空，沙盒条目分列` |
| 同步失败 → 幂等重试不产生双资产 | ✅ REAL | `SEC-08-a`…`SEC-08-f`（故障注入仅 Mock 生效） |

> **正向结论（诚实）**：「入库并进行授权复用」这条链路在**真实资料库接入前不可能完成**——
> 本侧已把这一点做成了**结构性不可达**（`reuseEligibility` 在 Mock 下恒 `false`），而非静默放行。

### 流程 5｜资产撤回 / Skill 变更 / 权限取消 → 中台缓存与授权同步

| 步骤 | 结果 | 证据 |
|---|---|---|
| 变更事件流方法（seq 游标、`truncated` 显式） | ✅ 代码就绪（离线自检） | `WC-24 变更事件流：游标语义为 seq` |
| 未批准 Skill 不得用于正式输出 | ✅ REAL | `E2E03-18 U CARD 未批准 Skill 时正式输出被阻塞（不得套用 VFIB 规则）` |
| **资产撤回 → 中台停止检索/新调用** | ⛔ **BLOCKED** | 需真实 `GET /changes` + 真实撤回事件 |
| **轮询调度器 / 授权缓存 TTL** | ⛔ **未实现** | `INTEGRATION_DIFF.md` T-05 / T-06；且**契约容忍时延未与 Provider 约定** |
| 已有发布历史按留存政策保持 | ✅ REAL | `E2E04-11`（快照仅追加，不因撤回而消失） |

## 3. 执行包额外要求项

| 要求 | 结果 | 证据 |
|---|---|---|
| VFIB / U CARD 切换与隔离 | ✅ REAL | `SEC-03 VFIB-only 主体触达 U CARD 一律 404`、`SEC-03b/c/d/e`、`E2E03-18` |
| P1—P4 权限 | ✅ REAL | `E2E-02l P1 批准计划`、`E2E-02m 无 plan.approve 权限者批准被拒（403 + 审计）`、`ENV-05 角色目录含 ASSET_REVIEWER 与 LIBRARY_FINAL_APPROVER`、`SEC-01-a…e2` |
| 月度日历联动 | ✅ REAL | `E2E-02g 月视图包含 PlanItem 与任务节点`、`E2E-02j 修改 PlanItem 日期后日历立即同步`、`PUB-01 日历与排期为同一数据源` |
| 审核拒绝 / 重提 | ✅ REAL | `E2E03-09`、`SEC-02-f`、`SEC-02-g`、`E2E05-18` |
| 同步中断与幂等重试 | ✅ REAL（Mock 故障注入） | `SEC-08-00`…`SEC-08-f` |
| 八工作中心完整性 | ✅ REAL | `ui` 套件逐中心导航断言 97/97；`app.js CENTERS` = 8 个中心 |
| S05 与三个 MARK 边界 | ✅ REAL（无越界入口） | 全仓库检索：`S05`/`CAC`/漏斗/归因**仅出现在"明确排除"声明**中；无菜单、无数据、无入口 |
| Published Archive **独立**归档 | ✅ REAL | `publishing.js` 零引用资料库适配器；快照落 `uploads/published/<pubId>/` |

## 4. 失败 / 跳过 / 阻断汇总

| 类别 | 数量 | 明细 |
|---|---|---|
| 自动断言**失败** | **0** | — |
| 自动断言**跳过** | **0** | — |
| **BLOCKED**（依赖外部） | **7** | ① 真实资料库服务 ② 真实服务账户凭据/测试票据 ③ 真实文本模型凭据 ④ 真实图像模型凭据 ⑤ 真实渠道沙盒账号 ⑥ 公网来源许可 ⑦ 官方 Skill / SPECIAL-01 原件 |
| **NOT_VERIFIED** | 2 | 企业资料库真实集成（A-06）、采集调度长期运行行为 |

## 5. 结论

- **本侧（Marketing OS）业务链路、权限模型、状态机、归档独立性、fail-closed 行为**：**全部通过**（478/478）。
- **跨系统真实联调**：**BLOCKED**，根因是 `LIBRARY_HANDOFF_BUNDLE` 未交付 + 无测试服务/凭据。
- **真实 AI 创作**：**BLOCKED**，根因是无合法取得的模型凭据。
- 依 `03_SHARED_CONTRACT_AND_ACCEPTANCE.md` §4，`INT-01`…`INT-14` 结果为：
  **4 项 PASS**（INT-07/09/10/14）、**4 项 CONDITIONAL**（INT-04/05/12/13）、**6 项 BLOCKED**（INT-01/02/03/06/08/11）、**0 项 FAILED**；
  详见 `JOINT_ACCEPTANCE_REPORT.md`，总结论为 **CONDITIONAL**。
- 依 §3「不得把 `MOCK` 或 `REAL_NOT_VERIFIED` 记为联调 PASS」，本报告**不宣布**任何真实联调通过。
