# Marketing OS V0.1 — BUILD-03 测试报告（Gate C）

> 运行时间：2026-10-12
> 运行入口：`bash tools/run-mos-tests.sh all`
> 结论：**311/311 断言通过，0 失败**；BUILD-01 / BUILD-02 回归无破坏。
> 本轮新增：`e2e03`（75 断言）与 UI 检查的 BUILD-03 段落（21 断言）。

## 1. 总体结果

| 套件 | 断言 | 结果 | 证据文件 |
|---|---|---|---|
| smoke（BUILD-01 冒烟） | 13 | 13/13 | `TEST_EVIDENCE_MOS_BUILD01/smoke-result.json` |
| unit（BUILD-01/02/03 单元） | 39 | 39/39 | `TEST_EVIDENCE_MOS_BUILD01/unit-result.json` |
| e2e（BUILD-01 E2E-01/02） | 48 | 48/48 | `TEST_EVIDENCE_MOS_BUILD01/e2e-result.json` |
| e2e02（BUILD-02 E2E-03/04） | 63 | 63/63 | `TEST_EVIDENCE_MOS_BUILD02/e2e-build02-result.json` |
| **e2e03（BUILD-03 E2E-05 + SEC 全量）** | **75** | **75/75** | `TEST_EVIDENCE_MOS_BUILD03/e2e-build03-result.json` |
| ui（真实 Chrome CDP，含 B03 段落） | 73 | 73/73 | `TEST_EVIDENCE_MOS_BUILD01/ui-check-result.json` |
| **合计** | **311** | **311/311** | `TEST_EVIDENCE_MOS_BUILD01/summary.json` |

单元套件由 25 → 39：新增 U-14…U-19b（入库状态机、可复用判定、预检、数据分级、Mock 网关幂等、schema v3 迁移）。
e2e 套件由 47 → 48：新增 PERSIST-00（重启前置条件：确认会话已落盘）。
UI 套件由 52 → 73：新增 B03-UI 段落（Analytics 四段与缺失语义、Governance 三标签与 MOCK 边界、页面内真实写操作 + 刷新持久化）。

## 2. E2E-05 资产入库全流程（E2E05-01 … E2E05-18）

隔离数据目录 + 运行期随机口令；结束后清理，**不触碰 `data/`**。

| 断言 | 验证点 |
|---|---|
| E2E05-01 | 上传工作素材：魔数校验通过、真实落盘、返回 `sha256` |
| E2E05-01b | 伪装成图片的脚本被魔数校验拒绝 → `400` |
| E2E05-02 | 创建入库申请 → `SUBMITTED`；**双字段初始为 `PENDING` / `NOT_STARTED`** |
| E2E05-03 | 同一 `idempotencyKey` 重复提交不重复创建（返回同一申请） |
| E2E05-04 | 非法资产分类被拒（A01–A08 字典强制）→ `400 BAD_CATEGORY` |
| E2E05-05 | 无 `asset.review` 权限者不能执行预检 → `403` |
| E2E05-06 | 预检通过（`PASS`）并记录 8 项检查，状态进入 `PRECHECK` |
| E2E05-07 | 提交最终审批 → 开 **`ASSET_ADMISSION` 审核单（第三条独立链）** |
| E2E05-07b | 职责分离用例前置：预检 `PASS` 且审核单确已开立 |
| E2E05-08 | 最终审批未过时不能提交同步 → `409 NOT_APPROVED` |
| E2E05-09/10 | 最终审批人批准 → `FINAL_APPROVAL_GRANTED`；`finalApprovalStatus=APPROVED` 且**授权来源如实记录为 `MOCK`** |
| E2E05-11 | 批准后仍未同步：`syncStatus` 独立保持 `NOT_STARTED`（**双字段不互相推导**） |
| E2E05-12 | 资料库同步成功并返回 `MOCK_ASSET_*` 资产 ID；`state=SYNC_COMPLETED` |
| E2E05-13 | 重复同步被幂等拦截（`deduplicated`），未重复调用资料库 |
| E2E05-14 | Approved Assets：**正式库检索恒为空**，沙盒条目分列（`gateway=0, sandbox=1`） |
| E2E05-15/16 | 可复用资产数为 0；列表汇总不含任何 `AVAILABLE` / 可复用条目 |
| E2E05-17 | **同内容重复入库被预检明确拒绝**（`not_duplicate=FAIL`） |
| E2E05-18 | 预检未通过的申请不能提交最终审批 → `409`，状态保持 `PRECHECK` |

### 2.1 两条硬规则（08 §Gate C）

1. **入库审批 APPROVED ≠ 可复用**
   `reuseEligibility` 由服务端**计算**（从不存储、从不由人工置真）：
   `finalApprovalStatus=APPROVED` **AND** `syncStatus=COMPLETED` **AND** 权限核验有效 **AND** 资产 `ACTIVE` **AND** `approvalMode=REAL`。
   断言：SEC-09-b（判定为 `false` 且给出 ≥3 条阻塞原因）、E2E05-15/16。
2. **Mock 下 `AVAILABLE` 结构性不可达**
   Mock 回执固定 `permissionValid=false` + `assetState=MOCK_SANDBOX` + `libraryId` 为 `MOCK_*`，
   因此第 1 条中的两个与门恒为假。断言：SEC-09-a（`state=SYNC_COMPLETED`，永不为 `AVAILABLE`，且带 `availableBlockedReason`）。

## 3. 安全断言（SEC 全量）

| 断言组 | 验证点 | 结果 |
|---|---|---|
| **SEC-01-a** | 无 `library.asset.approve.final` 者执行最终入库 → `403 FORBIDDEN` | ✅ |
| **SEC-01-b** | 资产预检员（`asset.review`）**不能**执行最终入库审批（分权）→ `403` | ✅ |
| **SEC-01-c** | 技术管理员（`MOS_ADMIN`）**不自动获得**最终入库特权 → `403` | ✅ |
| **SEC-01-d** | 每次越权尝试都写入审计事件（append-only） | ✅ |
| **SEC-01-e** | 职责分离：提交人即使持有最终特权也不能审批自己的入库申请 → `403 职责分离…` | ✅ |
| **SEC-01-e2** | 正向对照：非提交人的最终审批人可正常裁决（证明上条 403 源自职责分离而非权限不足） | ✅ |
| SEC-02-x | 入库审批绑定哈希（`bindingHash`）已冻结并对外可见；决策时比对不符即 `409 ASSET_CHANGED` | ✅ |
| SEC-07-a/b | 前端 bundle 与 API 响应不含密钥字面量；适配器无密钥时不宣称已配置 | ✅ |
| **SEC-08-00/01** | 故障注入模式重启；独立审批人批准入库（前置） | ✅ |
| **SEC-08-a** | 同步失败 → `SYNC_FAILED`，保留 `lastSyncError=MOCK_TRANSIENT_TIMEOUT` | ✅ |
| **SEC-08-b** | 同步失败的申请**不可复用**（未生成引用） | ✅ |
| **SEC-08-c** | **幂等重试成功**（复用同一 `idempotencyKey`，`syncAttempts=2`） | ✅ |
| **SEC-08-d** | 重试未产生双资产（该申请只有 1 条引用） | ✅ |
| **SEC-08-e** | 同步失败写入审计事件（失败不静默） | ✅ |
| **SEC-08-f** | 已成功的申请再重试被拒 → `409 NOT_FAILED`（状态机强制） | ✅ |
| **SEC-09-a/b/c** | Mock 不得冒充正式入库；可复用判定为计算且为 false；沙盒引用带 MOCK 标记 | ✅ |
| **SEC-10-a** | `RESTRICTED` 作业在**调用 Provider 之前**被阻断 → `BLOCKED` | ✅ |
| **SEC-10-b** | 未发生任何外部调用（无 `providerJobId`、无产物） | ✅ |
| **SEC-10-c** | 未知数据分级被拒绝（fail closed，不静默降级）→ `400 BAD_DATA_CLASS` | ✅ |

### 3.1 SEC-08 的故障注入说明（诚实性要求）

真实企业资料库未接通，**无法自然制造**瞬时超时。为此在 Mock 网关内引入**仅 Mock 生效、默认关闭**的开关
`MOS_LIBRARY_MOCK_FAULT=once-per-key`：每个幂等键的首次提交返回 `SYNC_FAILED`（`MOCK_TRANSIENT_TIMEOUT`），
且该瞬时故障**不写入回执缓存**，因此同键重试语义与真实环境一致。

- 该开关只在 `library=mock` 下被读取（`faultMode()`），real 模式下忽略；
- 失败原因由网关引擎返回（`MISSING_DIGEST` / `MISSING_CATEGORY` / `LICENSE_UNVERIFIED` 为**真实合规前置**，不是测试后门，见 U-18c）；
- 证据：`SEC-08-a … SEC-08-f` 全部通过。

## 4. Analytics 真实聚合与「缺失」语义（AN-01 … AN-13）

| 断言 | 验证点 |
|---|---|
| AN-01 | `GET /api/mos/analytics` 可用，返回 content / channels / operations / aiCost 四段 |
| AN-02 | 跨品牌请求分析数据被拒 → `404`（不泄露对象存在性） |
| AN-03 | 无指标数据时渠道指标显示「缺失」而非 `0` |
| AN-04 | 无生成作业时 AI 成本显示「缺失」，**不显示估算金额** |
| AN-05 | 缺失项被显式汇总（前端据此展示，不用占位数字）——5 条 |
| AN-06 | 生成作业带 `dataClass` 字段并如实落到 `NOT_CONFIGURED` |
| AN-07 | 作业写入后 AI 成本段反映真实作业数（`byKind.TEXT`） |
| AN-08 | Operations 段可用且含计划 / 任务维度 |
| AN-09 | 渠道指标真实落盘（带来源与统计时点） |
| AN-10 | 指标录入后渠道段由「缺失」转为真实聚合 |
| AN-11 | 渠道段同时反映发布数（真实聚合，不是占位数字） |
| AN-12 | 审核耗时按审核链分组统计（含 `ASSET_ADMISSION`） |
| AN-13 | 未知分析分段被拒绝 → `400` |

**明确不做**（`scopeNote` 显式排除，界面与 API 均无入口）：CAC、获客漏斗、行为归因（= 规范中的 MARK-S05 范围外项）。

## 5. Governance 收口（GOV-01 … GOV-06）

| 断言 | 验证点 |
|---|---|
| GOV-01 | 审核历史 append-only 可查（含 `ASSET_ADMISSION` 决策，4 条） |
| GOV-02 | P4 因持有 `library.asset.read` 可读资产引用（权限判定如实） |
| GOV-03 | 跨品牌读取资产引用被拒 → `404` |
| GOV-04 | 跨品牌读取入库申请被拒 → `404` |
| GOV-05 | 审计事件 metadata 已脱敏（不含 `password` / `token` 明文） |
| GOV-06 | schema 版本已推进到 **v3**（只增不改） |

### 5.1 Topic 复用视图（REUSE-01 … REUSE-04，审计修正 A-25）

| 断言 | 验证点 |
|---|---|
| REUSE-01 | `GET /api/mos/topics/:id/reuse` 返回**真实计数**（`tasks>=2`） |
| REUSE-02 | 已授权资产检索恒为空，并如实标注 `libraryIntegrationMode=mock`（不伪造正式资产） |
| REUSE-03 | 新建内容版本后复用视图计数**随之增长**（证明是聚合而非硬编码空数组） |
| REUSE-04 | 复用条目带状态与风险等级（只外显安全字段） |

### 5.2 会话落盘可靠性（ENV-06，审计修正 A-26）

| 断言 | 验证点 |
|---|---|
| ENV-06 | ★8 个身份登录后，其会话令牌**立即出现在数据文件中**（不依赖 60ms 写入合并窗口） |
| PERSIST-00（e2e 套件） | 重启前置条件：显式轮询确认会话已落盘后再重启，使 PERSIST-02 只检验「落盘后的会话是否跨重启有效」 |

## 6. UI 检查（真实 Chrome CDP，B03 段落 21 断言）

非模拟 DOM。B03 段落验证的是**真实写操作 + 刷新后持久化**，不是"打开页面看一眼"。

| 断言 | 验证点 |
|---|---|
| B03-UI 运营分析渲染 / 标签 | 四段标签渲染且名称正确（`content,channels,operations,aiCost`） |
| B03-UI 缺失语义 | 无回执时「可核费用」显示缺失且明示「不做估算」；无指标时显示「渠道指标缺失」并说明不会用 0 填充 |
| B03-UI 写入路径前置 | 没有发布记录时**不显示**「录入指标」按钮（拒绝伪造可写入口） |
| B03-UI 治理渲染 / 标签 | 三标签渲染且名称正确（`admission,assets,history`） |
| B03-UI MOCK 边界 | 页面明示「资料库为 MOCK」且说明不会变为可复用；可复用资产计数可见 |
| B03-UI 前置（页面内同源请求） | 上传工作素材成功（真实落盘、带 sha256）；创建入库申请成功（`SUBMITTED`） |
| B03-UI 真实 UI 操作 | 新申请的表格行真实渲染；点击「处理」打开抽屉；抽屉含预检 / 回执 / 可复用资格 / 流程历史 |
| B03-UI 真实写操作 | 抽屉内点击「执行预检」→ 列表状态更新为 `PRECHECK` |
| B03-UI 持久化 | `Page.reload` 后入库申请与预检结果依然存在 |
| B03-UI Approved Assets | 明确「正式库检索恒为空」，不伪造正式资产；展示可复用判定公式（含「授权来源为 REAL」） |
| B03-UI Review History | 审核历史视图渲染（append-only 说明可见） |
| B03-UI 端点真实性 | Analytics / Governance 端点真实可用；治理端点返回非空 `availableBlockedReason` |
| 无页面级异常 | `pageErrors` 与 `console.error` 均为 0 |

截图证据：`UI_EVIDENCE_MOS_BUILD03/B03-29 … B03-37`（8 张）。

## 7. 单元测试新增覆盖（U-14 … U-19b，14 条）

| 断言 | 验证点 |
|---|---|
| U-14 | 入库状态机自洽：迁移表覆盖全部状态、无悬空目标、`REJECTED`/`AVAILABLE` 为终态、失败恢复边存在 |
| U-14b | `assertTransition`：合法放行 / 非法阻断并给出中文原因 |
| U-15 | ★Mock 下 `reuseEligibility` 结构性为 `false`，并逐项给出阻塞原因 |
| U-15b | 仅当 REAL 回执 + 权限核验 + `ACTIVE` + 审批通过 + 同步完成 才可复用；`null` 申请 fail closed |
| U-16/16b/16c | 预检只在可确定判断上给出结论：重复内容 / `license=UNVERIFIED` / 摘要不匹配 一律 `FAIL` |
| U-17/17b | 数据分级字典与 `sendAllowed`；`dataClasses` 纳入统一字典校验（未知分级不可静默降级） |
| U-18/18b/18c | Mock 网关：同摘要去重返回既有资产；回执 `permissionValid=false` + `MOCK_SANDBOX`；缺摘要/缺分类/许可未核验为引擎级拒绝 |
| U-19/19b | `MOS_SCHEMA_VERSION=3`；v2 文档迁移补齐 v3 形状且**不注入**任何已批准资产 |

## 8. 本次发现并修复的缺陷

| # | 缺陷 | 严重度 | 修复 | 回归证据 |
|---|---|---|---|---|
| A-16 | **第三条审批链的独立特权失效开放**：`ASSET_ADMISSION` 使用了 `asset.review`，任何资产预检员都能执行**最终入库**，违背 03 §2.4「最终入库许可是独立特权」 | **高（合规）** | `PERM_BY_TYPE.ASSET_ADMISSION` 改为 `library.asset.approve.final`；新增 `ASSET_REVIEWER` 角色只承载 `asset.review`，**刻意不含**最终审批权 | SEC-01-a/b/c/d |
| A-17 | **失败恢复路径实际不可用**：`retry-sync` 先把状态置为 `PRECHECK`，而状态机不允许 `PRECHECK → LIBRARY_SYNC_PENDING`，导致重试必然 `409 ILLEGAL_TRANSITION` | **高** | 保持 `SYNC_FAILED`，由 `runSync` 走状态机本就允许的 `SYNC_FAILED → LIBRARY_SYNC_PENDING` | SEC-08-c/d/f |
| A-18 | 服务**无法启动**：`dict.js` 中 `DICTIONARIES.dataClasses = DATA_CLASSES` 早于 `const DATA_CLASSES` 声明（TDZ） | **高（构建期暴露）** | 将 `DATA_CLASSES` 声明上移至字典索引构建之前，并加注释说明顺序约束 | 全部套件（服务可启动） |
| A-19 | 单元测试框架缺陷：`t()` 不支持 `async`，异步断言**静默通过**；且并发 `await` 会让用例互相清空共享表 | **高（测试可信度）** | `t()` 改为**串行链**：用例体在链上依次执行并 `await`，杜绝并发交叉与静默通过 | 39/39（U-18 由假通过转为真通过） |
| A-20 | e2e 用例复用同字节素材，触发产品侧**正确**的 `not_duplicate` 预检失败，把「拿不到审核单」伪装成 404/异常 | 中 | 每次上传生成唯一内容；并新增 E2E05-17/18 把「同内容重复入库被拒」固化为断言 | E2E05-17/18 |
| A-21 | e2e 用例选角错误：P2 不含 `asset.review`；且用提交人自批（被职责分离拦截），导致 `case=undefined` → 404 | 中 | 预检改由资产预检员执行、提交人仍为 `dual`；补正向对照 SEC-01-e2 | SEC-01-e / E2E05-07b |
| A-22 | 文档漂移：`MOCK_REAL_MATRIX.md` 仍称 Mock 回执 `assetId:null` / `state:MOCK_SYNC_COMPLETED`，与实现（`MOCK_ASSET_*` / `SYNC_COMPLETED` + `permissionValid:false`）不符 | 中 | 同步更新矩阵（含新增 BUILD-03 边界 11–14） | 本报告 §3 |
| A-23 | `submitAdmission` 回执表在**进程内**，跨重启幂等依赖 MOS 侧持久化的 `receipt` | 低（遗留） | 已在代码头注释与本报告显式声明；真实实现应由资料库侧持久化 | SEC-08-c（同进程）；跨重启由 `getAdmissionStatus` 对账 |
| A-24 | 提交人**不能撤回**自己的入库申请（`CANCEL` 属最终审批人权限） | 低（设计取舍） | 维持现状并显式记录：撤回属审核链动作而非申请人自助动作 | SEC-01-e 反向验证 |
| A-25 | **展示型空壳接口**：`GET /api/mos/topics/:id/reuse` 的 `contentVersions` / `publications` 是硬编码空数组 + 「BUILD-02 填充」注释，从未实现；前端固定显示「暂无可复用记录」，属于「看起来可用、实际无数据」 | **中（违背"页面必须真实可操作"）** | 后端按真实链路聚合（Topic → ContentTask → ContentVersion → PublicationRecord）；前端渲染真实表格，未接通部分（资料库资产）单独如实标注 | REUSE-01…04 |
| A-26 | **安全关键写入依赖写入合并窗口**：`createSession` / `destroySession` 使用 `save()`（60ms 合并 + 异步 rename）。在窗口内进程被硬终止会丢写：登录后可能立刻掉线，**注销后会话可能在重启后"复活"** | **高（安全）** | 登录 / 登出改为 `saveNow()` 同步落盘；另修正 e2e 用例缺少「落盘前置条件」的问题（PERSIST-00） | ENV-06 + PERSIST-00/02；定向探针：0/20/80ms 延迟下均可靠落盘（修复前 0/20/80ms 全部丢失） |

> **A-26 的定位说明（重要）**：本机为 Windows，`child.kill('SIGTERM')` 是**硬终止**，服务端的
> `[exit] 收到 SIGTERM` 优雅关停分支不会执行（已在探针中确认日志无该行）。因此「关停时落盘」在
> Windows 上不可依赖；这也说明把会话这类安全关键状态放进合并窗口本身就是设计缺陷。
> 生产（Linux + pm2/systemd）会正常投递 SIGTERM，但即便如此，依赖关停兜底也不如创建时即持久化可靠。

## 9. 已知未验证 / 明确不做

- **真实企业资料库、OA、SSO、知识库仍未接通**（Gate D 未开始）。因此：
  - 正式库检索恒空；入库回执一律 `MOCK_*`；`AVAILABLE` 结构性不可达；
  - 「同步失败恢复」依赖 Mock 故障注入开关验证，**不等于**已在真实资料库上验证。
- 文本 / 图像 Provider 仍为**代码就绪、无密钥未验证**（`NOT_CONFIGURED` 或显式 MOCK）。
- Analytics 的平台指标 API 未接通：指标只能人工 / 导入登记，无数据即显示「缺失」。
- CAC / 获客漏斗 / 行为归因明确不在本期范围。
- 视频自动渲染 / 配音 / 剪辑明确不实现。

## 10. 复现方式

```bash
# 全量（smoke + unit + e2e + e2e02 + e2e03 + ui）
bash tools/run-mos-tests.sh all

# 仅 BUILD-03 端到端
bash tools/run-mos-tests.sh e2e03

# 仅真实浏览器 UI（需本机 Chrome/Edge）
bash tools/run-mos-tests.sh ui
```

> ui 套件需要本机 Chrome/Edge（通过 CDP 驱动真实浏览器），缺失时按失败计。
> 所有套件自带独立数据目录与运行期随机口令，互不干扰，也不触碰 `data/`。
