# JOINT_ACCEPTANCE_REPORT.md —— 双系统联合验收报告

> 依据 `03_SHARED_CONTRACT_AND_ACCEPTANCE.md` §4（联合验收矩阵）与 §6（联合交付清单）。
> **由联调牵头方（Marketing OS）汇总**。
> 报告日期 **2026-10-13** ｜ 结论：**CONDITIONAL**（**不可**凭开发自审宣布生产级合规认证）

---

## 1. 基础信息

| 项 | 值 |
|---|---|
| Marketing OS 仓库 | `475022876/watu-operation` |
| Marketing OS 提交 | **`3c19e79`**（+ 本轮 M0 契约符合性修正，未提交时为工作区变更） |
| Marketing OS 版本 | `package.json` `0.1.0`；契约 `1.0`；schema **v4** |
| Enterprise Workspace 提交 | ⛔ **未提供**（`PROVIDER_BASELINE.md` 未交付） |
| Enterprise Workspace 版本 | ⚠ 执行包记载 `feat/v1.1.3`；本机源码副本 `package.json` = **1.1.7** —— **不一致，待 Provider 澄清**（`CONTRACT_DIFF.md` D-00） |
| 测试环境标识 | 本机回环 `127.0.0.1:9080`（隔离数据目录 `data-mos-*`，端口段 9600+/9700+ 用于自测）—— **非生产** |
| 资料库测试地址 | ⛔ **未提供** |
| 真实服务 | ⛔ **未启动**（资料库服务不存在） |
| 完成日期 | 2026-10-13 |
| 责任项目 | 双方按团队身份；**未写死个人姓名** |

## 2. 测试数据声明

| 项 | 说明 |
|---|---|
| MOS 侧数据 | 全部为**隔离实例内的合成数据**（`MOS_DEMO_SEED`，临时数据目录，跑完自清）；**未触碰** `data/` 生产库 |
| 资料库侧数据 | ⛔ **无**（未交付测试夹具 `TEST_FIXTURES.md`） |
| 真实客户/隐私数据 | **未使用**，且本轮**未发生**任何客户数据外发（AI 外发一律 fail closed） |
| 真实凭据 | **全程未使用**任何真实服务账户私钥、票据或模型密钥 |
| 生产状态 | **未被改动**（`sec` 套件断言生产模式下测试放行开关一律失效） |

## 3. 验收矩阵逐项结果

> 状态词严格取自 `03` §3。**`MOCK` 与 `REAL_NOT_VERIFIED` 一律不记为 PASS。**
> `PASS` 仅用于「**不依赖真实资料库即可完整自证**」的项；凡跨系统部分未验证者记为 `CONDITIONAL`。

| ID | 项目 | 状态 | 核心成功条件达成情况 | 证据 |
|---|---|---|---|---|
| **INT-01** | 两套服务真实独立启动 | ⛔ **BLOCKED** | 仅 MOS 可证（`/api/health` 正常、版本/日志/持久化隔离可证）；**资料库服务不存在**，无法证明"两套独立启动" | `ENV-01`、`ENV-06`；资料库侧无证据 |
| **INT-02** | 服务身份签名（正确通过；伪造/重放/过期/撤销被拒） | ⛔ **BLOCKED** | 本侧签名/验签**已用与 Provider 同构的 `crypto.verify` 离线验证**；`BAD_SIGNATURE`/`NONCE_REPLAY` 反例在**本地桩**通过。**未对真实服务验证** | `WC-11`…`WC-13`、`WC-29`、`WC-30` |
| **INT-03** | 用户受限票据（按用户/密级/品牌验证；服务身份不能越权） | ⛔ **BLOCKED** | 本侧已实现票据获取与**本地剔除 `admission.final.decision`**；跨品牌由票据品牌强校验。**未对真实票据链验证** | `WC-25`、`WC-07`；`TICKET_*` 错误码分层 |
| **INT-04** | 最终审批（仅特别授权主体能批准；admin/P1/service 不能绕过） | ⚠ **CONDITIONAL** | **MOS 侧完全验证 PASS**：`library.asset.approve.final` 为独立特权，资产预检员/`MOS_ADMIN` 均 403 并留痕；提交人不能批自己的申请；服务账户结构性无该能力。**跨系统"实际入库批准"未验证** | `SEC-01-a`…`SEC-01-e2`、`WC-26` |
| **INT-05** | 资产入库及幂等（正式 Asset ID、版本、权限可见；重试不重复生成） | ⚠ **CONDITIONAL** | **幂等与重试 PASS**（同 `idempotencyKey` 不重复创建、重试不产生双资产、失败仅生成 1 条引用）；**"资料库返回正式 Asset ID/版本" = BLOCKED**（Mock 恒 `MOCK_` 前缀；且本侧缺 2 个必填字段 → 真实申请无法合法构造，见 `CONTRACT_DIFF.md` D-06） | `E2E05-03`、`E2E05-13`、`SEC-08-a`…`SEC-08-f` |
| **INT-06** | 撤回与缓存（撤回后新检索/生成拒绝，fail closed） | ⛔ **BLOCKED** | 本侧**尚无** `changes` 轮询调度器与授权缓存 TTL；且在**网络不可用时不静默使用过期 Approved 缓存**这一策略**未落地实现**。需真实 `GET /changes` + 真实撤回事件 | `INTEGRATION_DIFF.md` T-05/T-06 |
| **INT-07** | Published Archive 独立（MOS 历史成品完整，Library 无自动镜像） | ✅ **PASS** | 归档为**物理快照**（正文+清单+哈希）落 `uploads/published/<pubId>/`，仅追加、不可覆盖；`publishing.js` 对资料库适配器**零引用**；`publishedContentArchive` 契约恒 `false` | `E2E04-06/07/08/09/11`、`A06-02`、实测 grep |
| **INT-08** | 生效 Skill（正式授权生效版本可读取、生成日志可追溯） | ⛔ **BLOCKED** | 无官方 Skill 原件、无真实 `GET /skills/:id`。本侧已实现：非 `APPROVED` 一律阻断正式输出、跨品牌不得套用、`outputIntent` **失效关闭** | `E2E03-18`、`WC-27`；官方原件未提供 |
| **INT-09** | 专业字典（与 SPECIAL-01 原件逐条对照，有证据才 VERIFIED） | ✅ **PASS**（负向合规） | **原件未随包提供 → 全部项保持 `UNVERIFIED`**；无证据的核验请求被 400 拒绝；不存在伪造的官方名称；`providedToDev:false` 如实声明 | `DV-01`…`DV-04` |
| **INT-10** | 真人浏览器工作路径（P1—P4 关键操作可完成，截图/脚本可复现） | ✅ **PASS** | **真实 headless Chrome（CDP）97/97**；八工作中心逐页断言（含页头文案比对）；无页面级异常、无 console error；**UI 创建后刷新仍存在**（非前端假象）；脚本与截图可复现 | `UI_TEST_EVIDENCE/`（27 张截图 + `mos-ui-check.js` + `ui-check-result.json`） |
| **INT-11** | 真实 AI 模型（一次实际文字+图片调用；无授权则 BLOCKED） | ⛔ **BLOCKED**（**规范允许**） | **无合法取得的模型凭据** → 按规范记 `BLOCKED`；**未以 Mock 冒充 REAL**；`PC-L1/L2` 显式 SKIP | `AI_PROVIDER_AND_SKILL_REPORT.md` §2.1、`provider` 21/21 |
| **INT-12** | 数据、恢复与安全（权限/SSRF/CSRF/AI外发/备份恢复/回滚均测） | ⚠ **CONDITIONAL** | **权限（RBAC+品牌 ABAC+跨品牌 404）/SSRF（含 DNS 重绑定、逐跳重定向、压缩炸弹、提示注入）/CSRF（双提交+定时安全比较）/AI 外发分级阻断：全部 PASS**；**生产级备份恢复演练：NOT_VERIFIED**（无生产环境）；撤回缓存失效路径 BLOCKED | `sec` 17/17、`SEC-01-*`、`SEC-10-*`、`GOV-05` |
| **INT-13** | 双方回归测试（原 OA 业务与 MOS 业务无破坏性回归） | ⚠ **CONDITIONAL** | **MOS 侧 PASS**：478/478 全绿、零回归。**OA/资料库侧回归结果未提供**（需 `PROVIDER_TEST_REPORT.md`，含 ACL/密级/Session-CSRF/可信代理/RAG 授权/AI 外发/资产审批/签名票据/文件版本/备份） | `TEST_EVIDENCE_MOS_BUILD*/` |
| **INT-14** | 官方 Skill 与正式审批（未经人为批准不得自动标记 EFFECTIVE） | ✅ **PASS** | 系统内**不存在**任何"自动置为 EFFECTIVE"的入口；配置覆盖**只改显示名**、不洗成正式；最终入库审批为独立人工特权 | `DV-04`、`SEC-01-a/b/c`、`skill.usability()` |

### 3.1 统计

| 状态 | 数量 | 明细 |
|---|---|---|
| ✅ **PASS** | **4** | INT-07、INT-09、INT-10、INT-14 |
| ⚠ **CONDITIONAL** | **4** | INT-04、INT-05、INT-12、INT-13 |
| ⛔ **BLOCKED** | **6** | INT-01、INT-02、INT-03、INT-06、INT-08、INT-11 |
| ❌ **FAILED** | **0** | — |

## 4. 联调阻断与停止条件检查（`03` §5）

触发以下任一条件即须**立即停止联调**并标记 `BLOCKED/FAILED`：

| 触发条件 | 本轮是否出现 |
|---|---|
| 越权读取高密级 | ❌ 未出现（本侧跨品牌/越权一律 404/403 并留痕） |
| 伪造最终批准 | ❌ 未出现（服务账户结构性无该能力） |
| 无 ID 仍开放复用 | ❌ 未出现（Mock 下 `reuseEligibility` **结构性恒 false**） |
| 失效资产继续授权 | ❌ 本轮未发生（**也未能验证**——无真实撤回事件） |
| 客户隐私外发 | ❌ 未出现（`RESTRICTED` 在调用 Provider 前阻断） |
| 丢失正式发布历史 | ❌ 未出现（归档快照仅追加、不可覆盖） |
| 生产库被误改 | ❌ 未出现（生产未部署、未触碰） |

> **本轮未触发任何停止条件**。真实联调为 `BLOCKED`（外部依赖缺失），**不是** `FAILED`。

## 5. 未决问题与责任分工

| # | 未决问题 | 责任项目 | 下一动作 | 阻塞的 INT |
|---|---|---|---|---|
| 1 | `LIBRARY_HANDOFF_BUNDLE` 未交付（7 项产物全缺） | **Library** | 按 `LIBRARY_HANDOFF_REQUEST.md` §1 交付 | INT-01/02/03/06/08/11 |
| 2 | 权威应用版本不一致（1.1.3 vs 1.1.7） | **Library** | 澄清并给出提交号 | D-00 |
| 3 | 七大资料区语义与准入门槛（`libraryPrimaryCategory`） | **Library** | 回答 Q6 | INT-05 |
| 4 | 密级/许可映射规则（`classification` / `licenseStatus`） | **Library** | 回答 Q7 | INT-05 |
| 5 | `reviews[]` 逐字段 schema；`skills/:id` 的 `publicView` 字段清单 | **Library** | 回答 Q8 | INT-05/08 |
| 6 | 错误码是否闭合枚举；事件类型是否冻结 | **Library** | 回答 Q2/Q3 | INT-02/06 |
| 7 | `knowledge/search` 的 `filters` schema | **Library** | 回答 Q4 | — |
| 8 | 撤回生效的最大容忍时延与网络不可用保证 | **双方** | 约定并签署 | INT-06 |
| 9 | 准入表单补齐 `libraryPrimaryCategory`/`classification`/枚举化 `licenseStatus`（T-01） | **MOS** | 收到 Q6/Q7 答案后实现 | INT-05 |
| 10 | `changes` 轮询调度器 + 授权缓存 TTL（T-05/T-06） | **MOS** | 收到时延约定后实现 | INT-06 |
| 11 | 票据刷新（T-03）与限流退避（T-04） | **MOS** | 收到 TTL/配额后实现 | INT-03 |
| 12 | 合法模型凭据（文本+图像） | **业务方/用户** | 提供合法取得且已配置的凭据 | INT-11 |
| 13 | 官方 Skill V1.2 与 SPECIAL-01 原件 | **业务方/资料库** | 提供原件 + 本人授权批准记录 | INT-08/09 |
| 14 | 公网资讯来源许可（robots/条款/授权） | **业务方** | 法务确认来源白名单 | — |
| 15 | OA/资料库侧回归测试结果 | **Library** | 提供 `PROVIDER_TEST_REPORT.md` | INT-13 |
| 16 | `CONTRACT_DIFF.md` 双方签署（D-00…D-10） | **双方** | 逐条确认 | INT-01…14 |

## 6. 交付产物（§6 清单）

### 6.1 Marketing OS 侧（本次提交）

| 产物 | 路径 | 状态 |
|---|---|---|
| `MARKETING_HANDOFF_BUNDLE/` | 见下 | ✅ 已交付 |
| ├ `CONSUMER_BASELINE.md` | 消费方基线（版本/提交/接口现状/静态交叉核验证据） | ✅ |
| ├ `INTEGRATION_DIFF.md` | 与资料库真实契约逐项对应（27 项契约要素） | ✅ |
| ├ `REAL_MOCK_STATUS.md` | 逐服务能力 + 实际结果 + 版本 + 时间 | ✅ |
| ├ `E2E_TEST_REPORT.md` | 实际环境/身份/用例/正反例/证据/跳过/阻断 | ✅ |
| ├ `UI_TEST_EVIDENCE/` | 可复现脚本 + 27 张截图 + 逐条结果（**不含凭证**） | ✅ |
| ├ `AI_PROVIDER_AND_SKILL_REPORT.md` | 真实与模拟严格区分 | ✅ |
| ├ `SECURITY_AND_DATA_BOUNDARY_REPORT.md` | 权限/SSRF/CSRF/AI 外发/数据边界 | ✅ |
| ├ `DEPLOY_AND_ROLLBACK.md` | 非生产部署、备份、还原、回滚 | ✅ |
| ├ `CHANGELOG.md` | 本轮全部变更（零删除） | ✅ |
| ├ `CONTRACT_DIFF.md` | **待双方签署**的契约差异表 | ⏳ 待签 |
| └ `LIBRARY_HANDOFF_REQUEST.md` | 致 Provider 的交接请求（含 8 个问题） | ✅ |
| 完整源码 | 本仓库（零依赖，`package.json` `dependencies:{}`） | ✅ |
| 全量回归 | `bash tools/run-mos-tests.sh all` → **478/478** | ✅ |

### 6.2 Library 侧（**未交付**）

`LIBRARY_HANDOFF_BUNDLE/` 的 7 项产物**全部缺失**（`PROVIDER_BASELINE.md`、`PROVIDER_API_OPENAPI.yaml`、
`SERVICE_AUTH_HANDOFF.md`、`TEST_FIXTURES.md`、`PROVIDER_TEST_REPORT.md`、`PROVIDER_BLOCKERS.md`、`CHANGELOG.md`）。

## 7. 结论

### **CONDITIONAL**（有条件通过；**不是** PASS_FOR_PILOT，**不是** FAIL）

**判定依据：**

1. **本侧（Marketing OS）自身全部可自证项 100% 通过且零回归**：478/478 自动断言、真实浏览器 97/97、
   八工作中心完整、MARK 边界未被突破、Published Archive 独立、权限与 SSRF/CSRF/AI 外发边界全部 fail-closed。
2. **跨系统真实联调未发生**：`LIBRARY_HANDOFF_BUNDLE` 未交付、无测试服务/地址/凭据 →
   `INT-01/02/03/06/08/11` 为 **BLOCKED**，`INT-04/05/12/13` 跨系统部分为 **CONDITIONAL**。
3. **不存在任何 FAILED 项**，**未触发任何联调停止条件**。
4. 依 `03` §3「**不得把 `MOCK` 或 `REAL_NOT_VERIFIED` 记为联调 PASS**」，本报告**不宣布**任何真实联调通过。

### 转为 PASS_FOR_PILOT 的前置条件（全部满足后方可提出试运行建议）

- [ ] Library 交付 `LIBRARY_HANDOFF_BUNDLE` 全部 7 项产物
- [ ] 双方签署 `CONTRACT_DIFF.md`（D-00…D-10）
- [ ] MOS 补齐 T-01…T-07（尤其**准入表单三字段**）
- [ ] 在**同一隔离测试环境**跑通 `INT-01`…`INT-06`、`INT-08`、`INT-11`
- [ ] 提供合法模型凭据完成 `INT-11` 的**一次真实文字 + 一次真实图片**调用
- [ ] 提供官方 Skill V1.2 与 SPECIAL-01 原件，完成 `INT-08/09` 的逐条核验
- [ ] 提供 OA/资料库侧回归结果（`INT-13`）
- [ ] 完成**非生产**环境的备份/恢复/回滚演练（`INT-12`）

### 需用户（业务方）人工决策的事项

1. **是否向资料库项目正式发出本交接请求**（`LIBRARY_HANDOFF_REQUEST.md`）并指定交付位置。
2. **是否为真实 AI 联调提供合法取得的模型凭据**（文本 + 图像）；不提供则 `INT-11` 永久 `BLOCKED`。
3. **公网资讯来源许可**（robots/服务条款/授权）——本侧不得规避网站许可，需业务/法务确认来源白名单。
4. **暂停或继续等待**：在 `LIBRARY_HANDOFF_BUNDLE` 交付前，本侧**不再假设对方 API**推进任何跨系统实现。
5. **生产部署批准**：本报告**不含**任何生产部署建议；如需试运行，须在 §7 前置条件全绿后**另行书面批准**。

---

**报告结束** ｜ 汇总方：Marketing OS（联调牵头方） ｜ 日期：2026-10-13
