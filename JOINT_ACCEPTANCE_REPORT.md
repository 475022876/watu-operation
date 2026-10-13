# JOINT_ACCEPTANCE_REPORT.md —— 双系统联合验收报告（V1.1）

> 交付包：`MARKETING_HANDOFF_BUNDLE_V1.1/`
> 依据：C 包 `04_E2E_ACCEPTANCE_AND_EVIDENCE.md`（**共享 14 项矩阵**）+ B 包 `03_HANDOFF_AND_REPORT.md`
> 由联调牵头方（Marketing OS / 消费方）汇总；**结论需双方确认，本侧不代签**
> 报告日期：**2026-10-13**
> **总结论：`CONDITIONAL`** —— PASS 5 / CONDITIONAL 6 / BLOCKED 3 / FAIL 0 / NOT_RUN 0

---

## 1. 基础信息（`INT-14` 输入）

| 项 | Marketing OS（消费方） | 企业资料库（提供方） |
|---|---|---|
| 仓库 | `475022876/watu-operation` | `20b1cb52018a2eb2ed52c0bfbc0e9b76af3d282e`（Provider 自述） |
| 本轮代码基线 | **`286fe5bd729f48fd953ba825e17d9772c7018fd8`**（+ 本轮未提交工作区变更） | 同上（**本侧零改动**） |
| 应用版本 | `package.json` `0.1.0` | `1.1.7` |
| 契约版本 | **`1.0`** | `POLICY_VERSION = '1.0'` |
| OpenAPI SHA256 | **`cd3cc198a9c568192dbec76429fb9a6dbc836f5e738377249bc14f73d8e825e3`** | **同值**（`LIBRARY_HANDOFF_BUNDLE_V1.1/PROVIDER_API_OPENAPI.yaml`） |
| schema 版本 | **v5**（`library_tickets` / `library_event_cursors` / `library_invalidations` / `library_admission_jobs`） | 纯增量，除 `db.lastPolicyVersion` 外无集合/字段变更 |
| 部署版本 | ⛔ **未部署**（用户明令禁止） | ⛔ **未部署** |
| 本侧自检 | **`610 / 610`** | Provider 侧 `TEST_REPORT.md`（92 断言，**自述**） |

**三方契约一致性**：执行包 C 包 `PROVIDER_API_OPENAPI_BASELINE.yaml` ≡ Provider 交付包 `PROVIDER_API_OPENAPI.yaml` ≡ 本侧基线 —— **逐字节相同**。

---

## 2. 统一结果值说明

| 值 | 含义（本报告口径） |
|---|---|
| **PASS** | 已具备 C 包要求的**全部证据**，且**不依赖尚未具备的真实外部条件** |
| **CONDITIONAL** | 核心机制已实测通过，但**某项 PASS 判据**依赖未完成的真实外部条件 / 双方互认 |
| **BLOCKED** | **外部材料或凭据未到**，无法执行（**不是**本侧失败） |
| **NOT_RUN** | 本轮未执行（含用户明令禁止项） |
| **NOT_APPLICABLE** | 与本项目无关 |

**规则遵守**：① 无真实外部条件**不记 PASS**；② `MOCK` / `UNVERIFIED` **一律不记为真实通过**；
③ **「失败数为零」不等于通过** —— 每项均要求**阴性对照真实触发**（§4）。

---

## 3. 联合验收矩阵（`INT-01` … `INT-14`）

### `INT-01` 双进程 / 独立数据目录 与 真实 HTTP —— ✅ **PASS**

| 项 | 内容 |
|---|---|
| **方法** | 两套**独立服务**同时运行：MOS `http://127.0.0.1:9552` ↔ Provider `http://127.0.0.1:9751`；各自**独立数据目录**（MOS 临时目录 + Provider 隔离实例）；**真实 HTTP** 互调 |
| **证据** | `TEST_EVIDENCE_MOS_BUILD04/dual-e2e-result.json`（runTag `5d00f4e0`）；两端启动日志（`D4-01`/`D4-09` 均 200）；**URL 脱敏**（全回环）；**5 个真实 `requestId` 对应**（`mos-e77abecb62fa` / `mos-43c295f64398` / `mos-790446b1d0b9` / `mos-ff4fcfee403a` / `mos-08a5205f177f`） |
| **运行时间** | 2026-10-13T14:14:19.578Z |
| **参与进程** | Provider（资料库 V1.1.7 隔离实例）+ Consumer（MOS 9552） |
| **阻断责任** | — |

### `INT-02` Ed25519 签名 / 重放 / 失效服务账号 —— ⚠ **CONDITIONAL**

| 判据 | 结果 |
|---|---|
| 正常成功 | ✅ `D4-06` 本侧签名被 Provider **真实验签**通过（`/health` 200 合法封套） |
| **无效签名** | ✅ `D4-07` `401 BAD_SIGNATURE`（**阴性对照真实触发** → 证明 `D4-06` 不是桩返回） |
| 过期（`TIMESTAMP_OUT_OF_WINDOW`） | ⚠ **未在双系统实测中逐项断言**（本侧离线套件 `WC-30` 覆盖签名不匹配；时间窗错误码已实现） |
| nonce 重放（`NONCE_REPLAY`） | ⚠ **同上**（`WC-13`/`WC-29` 验证 nonce 唯一性；真实重放注入未执行） |
| 吊销服务账号 | ⚠ **未执行**（详见 `AUTH_AND_EVENTS_REPORT.md` §7；Provider 未提供主动吊销端点） |
| **为何不记 PASS** | C 包 `INT-02` 明文要求「无效签名、**过期、nonce 重放、吊销**一律拒绝」四项**全部**具备证据 |
| **解除条件** | 在隔离环境补跑「过期 / 重放 / 吊销」三类**真实负例**（本侧已具备注入能力，缺的是一次显式执行与证据归档） |

### `INT-03` 受限用户票据 及 品牌 / 密级 —— ⚠ **CONDITIONAL**

| 判据 | 结果 |
|---|---|
| **实际用户作用域内成功** | ✅ `D4-31` 本人会话签票 200（`kind=session`）→ `D4-32` `FINAL_APPROVED` |
| **跨品牌 / 高密级失败** | ✅ `D-13` 票据缓存键含 `keyId|brand|user` → **跨账户、跨品牌绝不复用**；`D4-30` 服务票据越权 → `403 TICKET_KIND_MISMATCH`；`D4-18` 高密级内容**正文扣留**（`snippet` 不外流） |
| **提供方审计 ID** | ✅ 每个出站均有 Provider `requestId`（见 `INT-01`） |
| 跨品牌「真实负例」在双系统套件中 | ⚠ 以**离线**套件为主（`D-09`/`D-13`）；双系统侧未再构造一份跨品牌真实请求 |
| **为何不记 PASS** | 「跨品牌 / 高密级失败」的真实 HTTP 负例证据链尚不完整 |
| **解除条件** | 补一组双系统真实跨品牌 / 高密级负例 |

### `INT-04` 最终特殊审批 —— ⚠ **CONDITIONAL**

| 判据 | 结果 |
|---|---|
| **普通 P1 / 管理员无权** | ✅ 权限表 `forbidden=[]`、`perms=20`（`D4-43`）；`library.asset.approve.final` 为**独立特权不继承**（`D4-04` 三身份权限**互不包含**） |
| **由独立权限主体批准** | ✅ `D4-25` MOS 侧授权主体批准 → `D4-32` Provider `FINAL_APPROVED`；**三重不可代签**闭合（`D4-30` 剔除 + `403` / `D4-30b` 结构性恒拒） |
| **Mock 身份不得计正式通过** | ✅ 本侧**未**以任何 MOCK 结果计入（`D4-28` 明确「不伪造成功」：`libraryId=null`） |
| **未满足项** | 「由**真实授权人**批准」在**生产 / 真实身份**条件下 `NOT_RUN` —— Provider `BLOCKERS.md` 明载：用户**禁止**向真实账号授予 `library.asset.approve.final`（Provider `B-3` / §附「故意未做」） |
| **为何不记 PASS** | 本轮批准主体为**隔离环境内持真实权限的合成身份**；授权**机制**真实验证，但「真实人」环节未执行 |
| **解除条件** | 双方会同，在 Staging 由**真实持权人**完成一次批准（Provider `B-3`） |

### `INT-05` 资产准入端到端 —— ✅ **PASS**

| 判据 | 结果 |
|---|---|
| **三必填字段** | ✅ `D4-22` 建单即带 `libraryPrimaryCategory` / `classification` / `licenseStatus`（`complete=true`）；出站前同构预校验（缺字段 → `BAD_ADMISSION_INPUT + missing[]`、**零出站**） |
| **复核记录** | ✅ `D4-23` 独立预检员 PASS → `D4-24` 产生 `ASSET_ADMISSION` 审核单（**提交人不得自批**）；`reviews[]` 真实携带**审核人**与结论 |
| **稳定幂等键** | ✅ `idempotencyKey` 贯穿三步；同键重试**不重复创建** |
| **入库返回真实 Asset ID / version** | ✅ `D4-33` `assetId=VFIB-ASSET-2026-0001`、`version=VFIB-ASSET-2026-0001-V1.0`（**由真实 Provider 逻辑颁发**） |
| **失败不可复用** | ✅ `D4-27` 未完成最终审批 → `409 FINAL_APPROVAL_REQUIRED`；`D4-28` `libraryId=null`、`syncStatus=FAILED`、**未建立可复用引用** |
| **恢复路径** | ✅ 授权后重试同步成功（`D4-31/32/33/34`）；`resubmit` 缺失（Provider `B-4`）已按「新 `idempotencyKey` 新建」实现并在 UI/文档提示 |

### `INT-06` 检索与版本 —— ⚠ **CONDITIONAL**

| 判据 | 结果 |
|---|---|
| **Approved 资产查得且受权** | ✅ `D4-17` `assets/search` 真实 200（`offset` + 字符串 `nextCursor`）；`D4-35` 使用前解析 `PROVIDER_VERIFIED` |
| **知识查得且受权** | ✅ `D4-18` `knowledge/search` 真实 200，命中夹具**且正文扣留**（`topK` 语义，不可翻页） |
| **Skill 当前版本查得** | ⛔ **BLOCKED** —— 官方 Skill V1.2 **未入库**（Provider `B-2`），`INT-10` 同因 |
| **历史 Skill 只读不可直接新复用** | ⚠ 机制已实现（非 `APPROVED` 阻断正式输出 + 未生效 `410`），但**无真实对象可验** |
| **为何不记 PASS** | Skill 版本子项 `BLOCKED` |

### `INT-07` 撤回与事件 —— ✅ **PASS**

| 判据 | 结果 |
|---|---|
| **Provider 撤回 → Consumer 收到事件** | ✅ `D4-36` 撤回 200 → `D4-38` 轮询真实消费到 `asset.revoked`（`items=14`，游标推进） |
| **缓存失效** | ✅ `D4-39` 本地引用置 `INVALIDATED`（可审计：`kind` + `targetId` + `seq`） |
| **后续调用被拒** | ✅ `D4-40` `INVALIDATED_LOCALLY`，**零出站**，**绝不沿用旧 Approved 结论** |
| **断线与截断恢复** | ✅ `E-10`（`truncated=true` → 全量重验 + 游标重置）、`E-12`（连续失败 ≥2 → `degraded`）、`E-13`（degraded 下不出站即拒）、`E-14`（恢复复位）、`E-10b`（清「待对账」位） |
| **两种视角分离** | ✅ `D4-37` 治理主体 → `410 ASSET_GONE`；`D4-37b` 非治理主体 → `404 NOT_FOUND`（**不得据此判可用**） |

### `INT-08` Published Archive 不镜像 —— ✅ **PASS**

| 判据 | 结果 |
|---|---|
| **发布快照在 MOS 留存** | ✅ `D4-53` `TEXT_SNAPSHOT` + `MANIFEST` 真实落盘 `published/<pubId>/`；`archivedBodyAvailable=true`，正文可只读回放 |
| **资料库无自动新增** | ✅ `D4-54` 资产总数 `before=0 after=0`；`D4-55` 事件流 `newItems=0`；`D4-41` `publishedContentArchive=false` |
| **提取母版须另行独立申请** | ✅ `D4-56` 母版申请 `providerAdmissionId` 与首发**不同**，且同样 `FINAL_APPROVAL_REQUIRED` |
| 详见 | `PUBLISHED_CONTENT_ISOLATION.md` |

### `INT-09` SPECIAL-01 正式字典 —— ⛔ **BLOCKED**

| 项 | 内容 |
|---|---|
| **事实** | SPECIAL-01 正式**原件从未提供**（`providedToDev=false`） |
| **本侧处置** | **全部 41 条**相关字典项保持 `provisional` / 「**待核验**」；`verified=0`；**不臆造、不标 VERIFIED、不据此声称通过** |
| **阻断责任** | **业务方未提供原件**（Provider `BLOCKERS.md` `B-1`） |
| **解除条件** | 业务方提供原件 → Provider 逐条核对并移除 `provisional` → 本侧重跑契约与字典套件 |
| 详见 | `SKILL_AND_DICTIONARY_STATUS.md` |

### `INT-10` 正式 Skill —— ⛔ **BLOCKED**

| 项 | 内容 |
|---|---|
| **事实** | Visual Brand Guardian Skill **V1.2 未入库**；本侧当前为 `REFERENCE_ONLY` |
| **本侧处置** | **机制**已就绪（登记→批准→生效三态闭环、`outputIntent` 失效关闭、非 `APPROVED` 阻断正式输出、未生效 `410`）；**不擅自置 `EFFECTIVE`**、**不用合成 Skill 冒充** |
| **阻断责任** | **业务方未提供材料**（Provider `BLOCKERS.md` `B-2`） |
| **解除条件** | 材料到位 → 登记 → **真人**批准并生效 → 本侧记录生效 `hash` 与生成快照 |
| 详见 | `SKILL_AND_DICTIONARY_STATUS.md` |

### `INT-11` 真实文字 / 图片 AI —— ⛔ **BLOCKED**

| 项 | 内容 |
|---|---|
| **事实** | 本侧**刻意未配置**任何外部模型密钥（`MOS_TEXT_PROVIDER=none`、`MOS_IMAGE_PROVIDER=none`） |
| **本侧处置** | MOCK 与 REAL **结构性分离**（`state` + `mock` 双字段 + 产物内嵌 MOCK 标记 + `costReceipt.source='mock-local'`）；**绝不以 Mock 冒充 REAL** |
| **阻断责任** | **无凭据**（用户 / Provider `B-7` 同项） |
| **解除条件** | 提供真实模型凭据 → 隔离环境执行一次真实调用 → 记录供应商响应 / 模型 ID / 脱敏日志 / 结果落盘 / 计费 |
| 详见 | `AI_PROVIDER_REAL_MOCK_STATUS.md` |

### `INT-12` P1–P4 浏览器实际操作 —— ✅ **PASS**

| 判据 | 结果 |
|---|---|
| **真实浏览器** | ✅ 真实 Chrome / Edge，经 **CDP** 驱动（`tools/mos-ui-check.js`） |
| **屏幕截图** | ✅ **22 张本次运行截图**（`UI_BROWSER_EVIDENCE/`，含索引 `README.md`） |
| **关键点击** | ✅ 登录 / 强制改密 / 八工作中心逐页 / 规划·议题·情报·战役**经 UI 创建后刷新仍存在**（非前端假象）/ **准入对话框**（`B1-38`） |
| **失败路径** | ✅ 前端同构拦截（`reuseScope` 空 / `none`、`licenseStatus` 为 `unknown`/`expired` → toast 阻断）；浏览器缺失时**按失败计**（不静默跳过） |
| **断言质量** | ✅ 断言**比对期望页头**（`navigate()` 对未知路由静默早返回，只查「有标题」会误判通过） |
| **断言数** | **106 / 106** |

### `INT-13` 两边完整回归、安全 及 备份 —— ⚠ **CONDITIONAL**

| 判据 | 结果 |
|---|---|
| **本侧完整回归** | ✅ **`610 / 610`**（12 套件；`summary.json → ok: true`） |
| **本侧安全回归** | ✅ `sec` **`17 / 17`**（SSRF 全类目 / DNS 重绑定 / 逐跳重定向 / 压缩炸弹 / 提示注入 / 生产模式开关失效） |
| **备份与恢复** | ✅ 机制已验证：原子落盘（同步 `renameSync` + 序号防回退）、迁移前 `mos.json.bak-*`、损坏自动备份重建、口令重置工具（保留业务数据） |
| **Provider 侧回归报告** | ✅ **已提供**（`LIBRARY_HANDOFF_BUNDLE_V1.1/TEST_REPORT.md`，92 断言，**Provider 自述**） |
| **未满足项** | C 包明文「**不得只引用单方报告**」→ 需**双方会同互认**；本侧**未代跑** Provider 套件、**未代签** |
| **其它 NOT_RUN** | 跨主机 TLS 下安全回归；生产部署态验证；备份**定时任务**；**离线恢复演练** |
| **为何不记 PASS** | 联合互认与交叉复核未执行 |
| 详见 | `SECURITY_REGRESSION.md` |

### `INT-14` 版本 和 共同签署 —— ⚠ **CONDITIONAL**

| 判据 | 结果 |
|---|---|
| **两方 Commit** | ✅ MOS `286fe5bd729f48fd953ba825e17d9772c7018fd8`；Provider `20b1cb52018a2eb2ed52c0bfbc0e9b76af3d282e` |
| **OpenAPI hash** | ✅ 三方**逐字节相同**（`cd3cc198…`） |
| **部署版本** | ⛔ `NOT_RUN` —— 用户明令**不得部署生产**（Provider `B-6`） |
| **测试清单** | ✅ 12 套件 + 逐套件证据文件（见 `CONSUMER_BASELINE.md` §6） |
| **联合报告双方确认** | ⛔ **待确认** —— `CONTRACT_DIFF_SIGNED.md` 签署区**为空**；本侧**不代签** |
| **为何不记 PASS** | 「共同签署」这一动作**尚未发生** |

---

## 4. 阴性对照总表（「失败数为零」不等于通过）

| 类别 | 断言 | 期望失败 | 结果 |
|---|---|---|---|
| 签名伪造 | `joint D4-07` | `401 BAD_SIGNATURE` | ✅ |
| 服务身份越权最终审批 | `joint D4-30` | 剔除 + `403 TICKET_KIND_MISMATCH` | ✅ |
| 本侧结构性恒拒代签 | `joint D4-30b` | 恒 `ok=false` | ✅ |
| 未映射用户 | `joint D4-26` | `NO_PROVIDER_USER_MAPPING`（零出站） | ✅ |
| 跳过最终审批 | `joint D4-27` | `409 FINAL_APPROVAL_REQUIRED` | ✅ |
| 失败后伪造复用 | `joint D4-28` | `libraryId=null` / 无可复用引用 | ✅ |
| 撤回后沿用旧结论 | `joint D4-40` | `INVALIDATED_LOCALLY`（零出站） | ✅ |
| 非治理身份看已撤回资产 | `joint D4-37b` | 非 200（404） | ✅ |
| 缺 `fileName` | `dual D-24b` | 零出站 | ✅ |
| `reuseScope` 缺失 / `none` | `dual D-24d` | 零出站 | ✅ |
| 许可 `expired` / `unknown` | `unit U-16b5` | 预检 FAIL | ✅ |
| 未知事件类型 | `dual E-06/E-06b` | 置 `reconcileRequired`（**不静默忽略**） | ✅ |
| 未批准 Skill 正式输出 | `unit` | `outputIntent` 失效关闭 | ✅ |
| 跨品牌票据复用 | `dual D-13` | 拒绝 | ✅ |
| SSRF 全类目 | `sec SEC-11/13b–13e/14b` | 全拒 | ✅ |
| 提示注入 | `sec SEC-15a` | 无副作用 | ✅ |

---

## 5. 统计

| 状态 | 数量 | 明细 |
|---|---|---|
| ✅ **PASS** | **5** | `INT-01`、`INT-05`、`INT-07`、`INT-08`、`INT-12` |
| ⚠ **CONDITIONAL** | **6** | `INT-02`、`INT-03`、`INT-04`、`INT-06`、`INT-13`、`INT-14` |
| ⛔ **BLOCKED** | **3** | `INT-09`、`INT-10`、`INT-11` |
| ❌ **FAIL** | **0** | — |
| ⏸ **NOT_RUN** | **0** | （各项内的 `NOT_RUN` 子项已在对应表格列明） |
| **合计** | **14** | — |

---

## 6. 验收门槛自检（B 包 `03` 末段）

| 门槛 | 结果 |
|---|---|
| 所有 P0 场景具备**真实 HTTP 日志** | ✅ 64 条断言 + 5 个真实 `requestId`（`REAL_HTTP_E2E_EVIDENCE.md`） |
| **无未经授权资产可复用** | ✅ `D4-27`/`D4-28`/`D4-34`：未完成最终审批即 `libraryId=null`、无可复用引用 |
| **无发布成品镜像** | ✅ `D4-54` `before=0 after=0`、`D4-55` `newItems=0` |
| **无普通管理员绕过最终审批** | ✅ `D4-04` 权限互不包含 + `D4-30` `403` + `D4-30b` 结构性恒拒 |
| **所有关键外部阻断如实报告** | ✅ `INT-09`/`INT-10`/`INT-11` 三项 `BLOCKED`，责任方标明（业务方原件 / 材料 / 凭据） |
| **未经批准不得上线生产** | ✅ **本轮未做任何部署动作**；`D4-48` 校验实例已停止、临时目录已清理、`data/` 未被触碰 |

---

## 7. 阻断事项汇总（`BLOCKED` 明细与责任）

| # | 阻断项 | 级别 | 影响 | 责任方 | 可否单方解除 |
|---|---|---|---|---|---|
| `B-1` | SPECIAL-01 字典**原件未入库** | P0 | `INT-09` | **业务方** | ❌ |
| `B-2` | Visual Brand Guardian Skill **V1.2 未入库** | P0 | `INT-10`、`INT-06`（Skill 子项） | **业务方** | ❌ |
| `B-3` | 真实**持权人**最终审批未执行 | P0 | `INT-04`、`INT-13`、`INT-14` | **双方会同** | ❌ |
| `B-4` | Provider `resubmit`（重提）能力缺失 | P1 | 消费方恢复路径 | Provider（产品决策） | ✅ |
| `B-5` | 跨主机 **TLS 终结**未验证 | P1 | `INT-01` 部署形态、`INT-13` | 环境 | ❌ |
| `B-6` | 线上**部署**未验证 | P1 | 交付验收 | 用户（**明令禁止**） | ❌ |
| `B-7` | 真实**外部 AI** 未跑 | P1 | `INT-11` | 凭据 | ❌ |

> 详细描述见 `CONTRACT_DIFF_SIGNED.md` §「阻断事项」与 Provider `BLOCKERS.md`。

---

## 8. 本侧**未自行**判定为 PASS 的说明（诚实边界）

| 项 | 为何不自行晋级 |
|---|---|
| `INT-02` | 四项拒绝判据中「过期 / 重放 / 吊销」缺**双系统**真实负例证据 |
| `INT-03` | 「跨品牌 / 高密级失败」缺**双系统**真实负例证据 |
| `INT-04` | 「真实授权人」环节未执行（权限由用户明令禁止授予真实账号） |
| `INT-06` | Skill 版本子项受 `INT-10` 阻断 |
| `INT-13` | 「不得只引用单方报告」→ 需双方会同互认 |
| `INT-14` | 「共同签署」动作尚未发生 |

**总结论：`CONDITIONAL`。**
**不得**凭开发自审宣布生产级合规认证；**不得**代替用户本人的试运行决策；
**未经用户批准，不得部署生产环境。**

---

## 9. 双方确认（**留空，待真实签署**）

| 角色 | 项目 | 签署人 | 日期 | 结论 |
|---|---|---|---|---|
| 消费方（Marketing OS） | `475022876/watu-operation` |  |  |  |
| 提供方（企业资料库） | `20b1cb52…` |  |  |  |

> ⚠ 本侧**不代签**、**不伪签**。空白即「未确认」。
