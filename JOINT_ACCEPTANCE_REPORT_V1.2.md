# JOINT_ACCEPTANCE_REPORT_V1.2.md —— 双系统联合验收报告（V1.2）

> 交付包：`MARKETING_HANDOFF_BUNDLE_V1.2/`
> 依据：`VFIB_MarketingOS_Remediation_V1.2/C_Shared_Contract/01_SHARED_ACCEPTANCE_AND_VERSIONING_V1.2.md`
> （**共享 14 项补证矩阵**）+ `.../B_Marketing_OS/01_MARKETING_CODEX_REMEDIATION_V1.2.md` Phase B3
> 由联调牵头方（Marketing OS / **消费方**）汇总；**结论需双方确认，本侧不代签**
> 报告日期：**2026-10-13**
> **总结论：`CONDITIONAL`** —— **PASS 7 / CONDITIONAL 4 / BLOCKED 3 / FAIL 0 / NOT_RUN 0**
> 上一版：[`JOINT_ACCEPTANCE_REPORT.md`](JOINT_ACCEPTANCE_REPORT.md)（V1.1，PASS 5 / CONDITIONAL 6 / BLOCKED 3）

---

## 0. 本版相对 V1.1 的结论变化（一句话）

| ID | V1.1 | **V1.2** | 变化原因 |
| --- | --- | --- | --- |
| INT-02 | CONDITIONAL | **PASS** | 新增 `build06` 双进程**真实 HTTP** 负例：过期 / 未来时间戳 / nonce 重放 / 服务账号撤销 / 公钥轮换 + **服务端审计 6/6** |
| INT-03 | CONDITIONAL | **PASS** | 新增 `build06` 真实跨品牌（×3 路径）与高密级（**两面向**）负例，含 `internal` 正向对照 |
| 其余 12 项 | — | 不变 | 见 §3 逐项 |

> **INT-02 / INT-03 的晋级只依赖本侧可完成的证据。** 仍为 CONDITIONAL/BLOCKED 的 7 项
> 全部卡在**外部输入或真人动作**（原件 / Skill 生效 / 密钥 / 真人签认 / 双方互认），
> **本侧不做任何替代性"证明"**（见 §7）。

---

## 1. 基础信息（`INT-14` 输入）

| 项 | Marketing OS（消费方） | 企业资料库（提供方） |
| --- | --- | --- |
| 仓库 | `475022876/watu-operation`（`main`） | `D:\企业数据后台\oa-system-20261004\oa-system` |
| 本轮代码基线 | **`259a91d`**（应用版本 `0.1.0`） | HEAD **`4cbfeef`**（`feat(v1.2): A 包 …` 链） |
| 本轮发布提交 | 本文件所在提交（`git log -1 --format=%H` 复核；同时登记于 `docs/RELEASE_REGISTER.md` §1） | — |
| 应用版本 | **`0.1.1`**（基线 `0.1.0`） | 工作区 `package.json` = `1.1.8`；其 V1.2 `RELEASE_REGISTER.md` 自述**本轮实际发布 `1.1.7`** ⚠ |
| 契约版本 | **`1.0`（未变）** | `POLICY_VERSION = '1.0'`（未变） |
| OpenAPI SHA256 | **`cd3cc198a9c568192dbec76429fb9a6dbc836f5e738377249bc14f73d8e825e3`** | **同值**（**四方逐字节一致**，见 `CONSUMER_BASELINE.md` §3） |
| schema 版本 | **v5（未变：无新集合、无迁移）** | 由其自行登记 |
| 部署状态 | ⛔ **未部署生产**（用户明令禁止） | ⛔ 未部署 |
| 本侧自检 | **`all` 546/546**（11 套件）；`build06` 61/61；`joint` 64/64；**聚合 671/671** | Provider 自有回归（**自述，本侧未代跑**） |

### 1.1 提供方工作区状态（**如实记录，本侧零改动**）

本套件运行时，提供方工作区存在**未提交**改动（由 A 包侧产生，**非本侧所为**）：
`lib/config.js`（`1.1.7→1.1.8`）、`package.json`（同）、`lib/integration/service-accounts.js`
（`rotatePublicKey` 增加"已撤销账户不可再轮换"终态校验）、`public/app.html`（版本显示）。

**对结论的影响**：该改动**不削弱**任何负例——`D6-18` 的公钥轮换负例使用的是**未撤销**账户（`SA3`）。
`D6-56` 仅证明**本侧未改**提供方源码（`server.js` mtime Δ=0ms），**不代表**提供方工作区干净。
测试时刻 5 个关键文件 SHA256 见 `CONSUMER_BASELINE.md` §2.1。

---

## 2. 统一结果值说明与引用口径

| 值 | 含义（本报告口径） |
| --- | --- |
| **PASS** | 已具备 C 包要求的**全部证据**，且**不依赖尚未具备的真实外部条件** |
| **CONDITIONAL** | 核心机制已实测通过，但某项 PASS 判据**依赖未完成的真实外部条件 / 真人动作 / 双方互认** |
| **BLOCKED** | **外部材料或凭据未到**，无法执行（**不是**本侧失败） |
| **FAIL** | 已实测且**不符合**契约预期 |
| **NOT_RUN** | 本轮未执行（含用户明令禁止项） |

**规则遵守**：① 无真实外部条件**不记 PASS**；② `MOCK / UNVERIFIED / REFERENCE_ONLY` **一律不记为真实通过**；
③ **「失败数为零」不等于通过** —— 关键项均要求**阴性对照真实触发**（§5）；④ 合成身份**不代替**真人授权。

**真实 / 模拟标注口径**：

| 标注 | 含义 |
| --- | --- |
| **真实** | 双**独立进程**真实启动 + 真实 TCP/HTTP + 真实 Ed25519 签名 + 真实受限票据（`build06` / `joint`） |
| **真实（结构性）** | 以代码级零引用 + 对端 `/health` 能力字段实测为依据 |
| **合成** | 由**合成身份**驱动，**只证明控制机制**，不代表真人授权 |
| **—** | 因外部输入未到而**无法执行**，故无真实性可言 |

**断言语义数口径（避免误引）**：`run-mos-tests.sh` 的汇总器**扫描全部证据目录**，
故 `joint`(64) 与 `build06`(61) 证据同时存在时显示 **671/671**；
`all` **自身** 11 套件合计为 **546/546**。两者 `failed` 均为 **0**，但**口径不同**。

---

## 3. 联合验收矩阵（`INT-01` … `INT-14`）

### `INT-01` 双独立进程 / 真实 HTTP —— ✅ **PASS**

| 项 | 内容 |
| --- | --- |
| **真实/模拟** | **真实** |
| **方法** | 两套**独立服务**同时 `spawn`：MOS `127.0.0.1:9564` ↔ Provider `127.0.0.1:9765`；各自**独立临时数据目录**；真实 TCP/HTTP 互调 |
| **证据** | `TEST_EVIDENCE_MOS_BUILD06/dual-security-result.json`（`D6-00/01/31`）；`TEST_EVIDENCE_MOS_BUILD04/dual-e2e-result.json`（V1.1 建立，本轮回归） |
| **日志/截图路径** | `TEST_EVIDENCE_MOS_BUILD06/dual-security-summary.txt`；`MARKETING_HANDOFF_BUNDLE_V1.2/evidence/dual-security-result.json` |
| **未覆盖** | 跨主机 **TLS**（属资料库侧部署验收，Provider `TLS_STAGING_CHECKLIST.md`） |
| **缺口责任** | 环境（非本侧） |
| **双方 commit** | 消费方 `259a91d`→发布提交；提供方 `4cbfeef` |

### `INT-02` 身份类拒绝（**过期 / nonce 重放 / 服务账号撤销**）—— ✅ **PASS**（V1.1 为 CONDITIONAL）

| 判据 | 结果 |
| --- | --- |
| **过期签名** | ✅ `D6-14` 真实 `401 TIMESTAMP_OUT_OF_WINDOW`（`timestamp = now − 3600s`） |
| **未来时间戳** | ✅ `D6-15` 真实 `401 TIMESTAMP_OUT_OF_WINDOW`（`now + 3600s`） |
| **nonce 重放** | ✅ `D6-16` **首次 200 → 原样重放 401 NONCE_REPLAY**（首次 200 是该结论成立的**前提**） |
| **服务账号撤销** | ✅ `D6-17` 撤销前 `200` / `DELETE` 撤销 `200` / 撤销后 `401 BAD_SERVICE_ACCOUNT` |
| **公钥轮换** | ✅ `D6-18` 旧签 `401 BAD_SIGNATURE`、新签 `200` |
| **阴性对照** | ✅ `D6-19` 伪造签名 `401 BAD_SIGNATURE` —— 证明上面的 401 发生在**验签**环节，非"整体拒绝" |
| **服务端审计证据** | ✅ `D6-29` 直接读 Provider 隔离实例 `db.json` 的 `integration-call` 行，按 `correlationId` 逐条对号 **6/6**（同时校验 `code` + `status` + `ok===false`）；`D6-30` 被拒请求**不留任何 2xx** |
| **真实/模拟** | **真实**（**不是**单元测试；证据读的是**被调用方自己写的审计**） |
| **日志/截图路径** | `TEST_EVIDENCE_MOS_BUILD06/dual-security-result.json`（含脱敏 `requestId`：`d6-bd499b20-5/6/8/10/12`）；`MARKETING_HANDOFF_BUNDLE_V1.2/REAL_HTTP_SECURITY_NEGATIVE_EVIDENCE.md` §2 §4 |
| **缺口责任** | — |
| **复现** | `bash tools/run-mos-tests.sh build06` |

### `INT-03` 跨品牌 / 高密级拒绝 —— ✅ **PASS**（V1.1 为 CONDITIONAL）

| 判据 | 结果 |
| --- | --- |
| **体/票据品牌不一致** | ✅ `D6-20` `403 BRAND_MISMATCH` |
| **品牌不在服务端允许清单** | ✅ `D6-21` `403 BRAND_NOT_ALLOWED` |
| **跨品牌资产不可复用** | ✅ `D6-25` VFIB `200` vs UCARD `403 NOT_REUSABLE_FOR_SUBJECT` |
| **跨品牌检索隔离** | ✅ `D6-26` VFIB `items=1` / UCARD `items=0`（**不含**目标资产） |
| **高密级（executive）拒绝** | ✅ `D6-27` 普通身份 `hits=0`；高管身份 `hits=1` |
| **正向对照（证明检索链路本身有效）** | ✅ `D6-28` `internal` 资料对普通身份 `hits=1` |
| **三重闭合** | ✅ `D6-22` 本人会话可签 `admission.final.decision`；`D6-23` **服务票据拿不到该范围** → `403 TICKET_KIND_MISMATCH` |
| **真实/模拟** | **真实** |
| **日志/截图路径** | 同上；`REAL_HTTP_SECURITY_NEGATIVE_EVIDENCE.md` §3 §4 |
| **缺口责任** | — |

### `INT-04` 最终特殊审批（**真实授权人 Staging 签认**）—— ⚠ **CONDITIONAL**

| 判据 | 结果 |
| --- | --- |
| **普通身份无权** | ✅ 权限表 `forbidden=[]`、`perms=20`；`library.asset.approve.final` 为**独立特权不继承** |
| **由独立授权主体批准** | ✅ `D6-43` 送审产生 `ASSET_ADMISSION` 审核单（**提交人不得自批**）→ `D6-44` 授权主体最终审批 `200` |
| **服务身份不可代签** | ✅ `D6-23`（见 INT-03） |
| **Mock 不得计正式通过** | ✅ 本侧**未**以任何 MOCK 结果计入（`D6-45` `libraryId=null`） |
| **真实/模拟** | **合成** —— 批准主体是隔离环境内**持真实权限的合成身份** |
| **未满足项** | 「由**真实授权人**在 Staging 签认」**尚未发生** |
| **日志/截图路径** | `dual-security-result.json`（`D6-42/43/44/45`）；真实浏览器路径见 `UI_BROWSER_EVIDENCE/README.md` |
| **缺口责任** | **双方会同 + 真人**（不可由本侧单方解除） |
| **签署栏** | ⬜ 见 `MARKETING_HANDOFF_BUNDLE_V1.2/JOINT_SIGNOFF_V1.2.md` §4（**留空**） |

### `INT-05` 资产准入端到端（必填 / 幂等 / Asset ID / 失败不可复用）—— ✅ **PASS**

| 判据 | 结果 |
| --- | --- |
| **三必填字段由 Provider 枚举校验** | ✅ `D6-41` 建单携带 `libraryPrimaryCategory` / `classification` / `licenseStatus`；缺失 → `BAD_ADMISSION_INPUT + missing[]`、**零出站** |
| **复核记录（独立预检 + 送审）** | ✅ `D6-42` 独立预检员 `verdict=PASS fail=[]`；`D6-43` 审核单 `reviews[]` 真实携带审核人与结论 |
| **幂等键** | ✅ `idempotencyKey` 贯穿三步；同键重试不重复创建、**历史与审计不丢** |
| **入库返回真实 Asset ID / version** | ✅ `D6-46` `VFIB-ASSET-2026-0002`、`approvalMode=REAL`（**非 MOCK**） |
| **失败不可复用** | ✅ `D6-45` 未完成最终审批 → `syncStatus=FAILED` / `libraryId=null` / **无可复用引用** |
| **拒绝错误状态** | ✅ `ILLEGAL_STATE` / `PRECHECK_REQUIRED` / `BAD_ADMISSION_INPUT`；**未配置优先**（`INTEGRATION_NOT_CONFIGURED`，零出站，保持 WC-15 不变量） |
| **真实/模拟** | **真实** |
| **日志/截图路径** | `dual-security-result.json`；`EVENT_FAILCLOSED_AND_ADMISSION_FIELDS.md` §3 §4；UI 路径 `UI_BROWSER_EVIDENCE/` |
| **缺口责任** | — |

### `INT-06` 正式 Skill 已批准生效 / 历史版不可新引用 —— ⚠ **CONDITIONAL**

| 判据 | 结果 |
| --- | --- |
| **正式输出必须落在 EFFECTIVE Skill** | ✅ 门禁 `skill.usability()`；`D6-53` `REFERENCE_ONLY` 一律 `SKILL_NOT_EFFECTIVE` **阻断** |
| **未识别 `outputIntent` fail-closed** | ✅ 未知取值 → **阻断**（不猜测为草稿） |
| **历史版本不可新引用** | ✅ 机制就绪：`skill.version.changed` 事件 → 登记失效 → 正式输出阻断（`BLOCKING_INVALIDATION_KINDS`） |
| **正向证据（真实 EFFECTIVE Skill 被引用并产出正式作品）** | ❌ **不存在**（系统中无 EFFECTIVE 正式 Skill） |
| **真实/模拟** | **真实（仅负向）** —— 不得以"负例通过"冒充"该项通过" |
| **日志/截图路径** | `dual-security-result.json`（`D6-48/50/51/52/53`）；`FORMAL_OUTPUT_GATE.md` §4 |
| **缺口责任** | **提供方**（Skill V1.2 真人审批与生效；同 INT-10） |
| **解除条件** | Provider 侧真人批准 + EFFECTIVE + 提供版本/hash/审批记录 → 本侧正向验证 |

### `INT-07` 撤回 → 事件 → 失效 / 重对账 —— ✅ **PASS**

| 判据 | 结果 |
| --- | --- |
| **撤回传播** | ✅ `D6-49` Provider 撤回 → 事件轮询 `tick.ok=true totalItems=30` → 本地引用 `permissionValid=false` / `assetState=REVOKED` / `invalidations=3` |
| **失效后不得生成新正式作品** | ✅ `D6-50` 只判定端点：`blockers=[SKILL_NOT_EFFECTIVE, LIBRARY_REF_INVALIDATED, LIBRARY_REF_NOT_REUSABLE]`；`D6-51` 真生成端点 `409 FORMAL_OUTPUT_BLOCKED`（**两端同源**） |
| **配对阴性对照** | ✅ `D6-48` 撤回**前**阻断项**不含** `LIBRARY_REF_*`（证明引用本身没问题、门禁不误伤）；`D6-52` `TEST_DRAFT` **不阻断** |
| **未知事件 / 断线 / 截断 fail-closed** | ✅ 未知事件 → `reconcileRequired`（**不静默忽略**）；`truncated=true` → 全量对账 + 游标重置；连续失败 ≥2 → `degraded` 且**不缓存结论**；未映射用户 → **零出站**（`D6-39` `probes=0`） |
| **真实/模拟** | **真实** |
| **日志/截图路径** | `dual-security-result.json`；`FORMAL_OUTPUT_GATE.md` §4；`EVENT_FAILCLOSED_AND_ADMISSION_FIELDS.md` §2 §4 |
| **缺口责任** | — |

### `INT-08` Published Archive 只在 MOS 归档 / 不镜像 —— ✅ **PASS**

| 判据 | 结果 |
| --- | --- |
| **发布路由对集成层零引用** | ✅ `grep` `lib/mos/routes/publishing.js` → **无输出**（结构性隔离，**无代码路径**可触发镜像） |
| **双方能力声明一致** | ✅ 本侧 `publishedContentArchive: false`（`adapters/workspace.js`）；Provider `/health` 实测 `false`（`D6-13b`） |
| **正式复用走独立准入链** | ✅ `D6-40…D6-47`（上传 → 建单 → 预检 → 送审 → 最终审批 → 首次同步被拦 → 重试取得 Asset ID） |
| **真实/模拟** | **真实（结构性证据）** |
| **日志/截图路径** | `PUBLISHED_ARCHIVE_ISOLATION.md`；`dual-security-result.json`（`D6-13b`） |
| **缺口责任** | — |

### `INT-09` SPECIAL-01 正式字典逐项核验 —— ⛔ **BLOCKED**

| 项 | 内容 |
| --- | --- |
| **事实** | 权威原件《VFIB 全球社交媒体运营与内容生产指导手册》**V1.1 未随包提供**（`providedToDev === false`） |
| **本侧处置** | **41 项全部** `provisional: true` / `status: 'UNVERIFIED'`（实测 `registry()` 条目数 = 41，**无一被核验**）；**不臆造、不设 VERIFIED** |
| **交付的是"防伪造机制"** | `applyOverrides()` 规则：仅给 `label` → **仅改显示名，仍 provisional**；须 `{label, sourceVersion, evidenceRef, verifiedBy}` 齐备才可标核验；`verify()` 缺证据返回 `EVIDENCE_REQUIRED` |
| **真实/模拟** | —（无原件，不可测） |
| **日志/截图路径** | `BLOCKED_ITEMS_V1.2.md` §1 |
| **缺口责任** | **提供方 / 业务方**（原件未提供） |
| **解除条件** | 取得原件 → **逐条**录入证据链（`label`+`sourceVersion`+`evidenceRef`+`verifiedBy`）→ 本侧重跑字典与契约套件；Visual 类 4 组另需 Skill V1.2 生效 |

### `INT-10` Skill V1.2 正式登记 / 真人审批 / 生效及引用 —— ⛔ **BLOCKED**

| 项 | 内容 |
| --- | --- |
| **事实** | 《VFIB Visual Brand Guardian Skill》**V1.2 未在资料库正式批准/生效**；本侧系统中为 `REFERENCE_ONLY`；**真人审批记录未提供** |
| **本侧已做到** | 门禁要求 Skill **必须 EFFECTIVE**，`REFERENCE_ONLY` 一律阻断（`D6-53`）；fail-closed 是**正确表现** |
| **为何不记 PASS** | 本侧**只有负向证据**（引用态被阻断），**没有**正向证据（真实 EFFECTIVE Skill 被成功引用并产出正式作品） |
| **真实/模拟** | —（仅负向证据） |
| **日志/截图路径** | `BLOCKED_ITEMS_V1.2.md` §2；`dual-security-result.json`（`D6-53`） |
| **缺口责任** | **提供方 / 真人审批人** |
| **解除条件** | 真人批准 + EFFECTIVE + 版本/hash/审批记录 → 本侧验证当前有效版本、历史快照、生成时授权（`skill.version.changed` 后旧版不得再被新引用） |

### `INT-11` 真实文字 / 图像模型调用 —— ⛔ **BLOCKED**

| 项 | 内容 |
| --- | --- |
| **事实** | `MOS_TEXT_PROVIDER = none`、`MOS_IMAGE_PROVIDER = none`；**真实调用次数 = 0**；无真实供应商非生产密钥、无费用授权 |
| **本侧处置（诚实）** | 未配置时如实返回 `status: NOT_CONFIGURED`（`D6-52` 同批），**不伪造成功、不以模拟成品冒充真实产出**；`MOCK / REAL` 语义在 `docs/MOCK_REAL_MATRIX.md` 逐项登记 |
| **不得混用声明** | `D6-46` 的 `approvalMode=REAL` 是**准入同步**的真实标记，与"AI 生成是否为真实调用"**是两件事** |
| **真实/模拟** | —（0 次真实调用） |
| **日志/截图路径** | `BLOCKED_ITEMS_V1.2.md` §3 |
| **缺口责任** | **用户**（密钥 + 费用授权） |
| **解除条件** | 提供非生产密钥 + 明确授权费用 → 授权条件下完成真实文字与图像调用，记录 Provider / model ID / **成本** / 敏感资料外发控制（`canSendToExternalAI` 三重闸门）/ 错误恢复；**不得**以 MOCK 冒充 REAL |

### `INT-12` P1–P4 真实浏览器复验，证据归档 —— ✅ **PASS**

| 判据 | 结果 |
| --- | --- |
| **真实浏览器** | ✅ 真实 Chrome / Edge，经 **CDP** 驱动（`tools/mos-ui-check.js`） |
| **截图归档** | ✅ **28 张本次运行截图**（`UI_EVIDENCE_MOS_BUILD01/*.png`，副本 `MARKETING_HANDOFF_BUNDLE_V1.2/UI_BROWSER_EVIDENCE/` + `README.md` 对照表） |
| **关键路径** | ✅ 登录 / 强制改密 / 八工作中心逐页 / **高风险审核** / **内容版本** / **用户权限** 路径；创建后刷新仍存在（非前端假象） |
| **断言质量** | ✅ 断言**比对期望页头**（`navigate()` 对未知路由静默早返回，只查"有标题"会误判通过） |
| **UI 不可用时的处置** | ✅ 浏览器缺失即**按失败计**（不静默跳过）——**未**用"跳过"冒充 PASS |
| **断言数** | **106 / 106** |
| **日志/截图路径** | `TEST_EVIDENCE_MOS_BUILD01/ui-check-result.json` + `UI_EVIDENCE_MOS_BUILD01/` |
| **缺口责任** | — |

### `INT-13` 双方完整回归 / 数据恢复 / 权限负例互认 —— ⚠ **CONDITIONAL**

| 判据 | 结果 |
| --- | --- |
| **本侧完整回归** | ✅ **`all` 546/546**（11 套件，`summary.json → ok: true`） |
| **本侧双系统回归** | ✅ `build06` **61/61**（`verdict=PASS_EVIDENCE_COMPLETE`）+ `joint` **64/64**（V1.1 建立，本轮复跑） |
| **本侧安全回归** | ✅ `sec` **17/17**（SSRF 全类目 / DNS 重绑定 / 逐跳重定向 / 压缩炸弹 / 提示注入 / 生产模式开关失效） |
| **本侧权限负例** | ✅ `D6-20…D6-28`（跨品牌 ×3、高密级 ×2 面向）、`D6-23`（服务票据越权）、`D6-54`（撤销后探测全失败且无 `ok=true`）、`D6-55`（如实记录 `securityRejections`，不含凭据） |
| **数据恢复** | ✅ 机制已验证（原子落盘 + 序号防回退、迁移前备份、损坏自动备份重建、口令重置保留业务数据）；**离线恢复演练未做** |
| **提供方全量回归** | ⚠ **本侧未代跑**；C 包明文"不得只引用单方报告" → 需双方会同互认 |
| **真实/模拟** | 本侧**真实** |
| **日志/截图路径** | `MARKETING_HANDOFF_BUNDLE_V1.2/evidence/regression-summary.json`（671/671，SHA256 `7d851282…`）；`TEST_EVIDENCE_INDEX.md` |
| **缺口责任** | **双方会同**（提供方交付回归结果与恢复演练记录） |

### `INT-14` 双方真实签署 / Release Register / 运行环境确认 —— ⚠ **CONDITIONAL**

| 判据 | 结果 |
| --- | --- |
| **本侧 Release Register** | ✅ 已出（[`docs/RELEASE_REGISTER.md`](docs/RELEASE_REGISTER.md)）：应用 0.1.1 / 回滚 0.1.0 / 契约 1.0 / schema v5 / **Staging 未部署生产** |
| **版本号与 CHANGELOG** | ✅ `package.json` / `lib/config.js` / `lib/mos/config.js` / UI 版本显示 / `CHANGELOG.md` / 发布登记 **六处同步** |
| **OpenAPI hash** | ✅ **四方逐字节一致**（`cd3cc198…`） |
| **提供方版本口径** | ⚠ **待提供方确认**：其 V1.2 `RELEASE_REGISTER.md` 记"本轮实际发布 1.1.7"，而工作区 `package.json`/`lib/config.js` 已为 `1.1.8` |
| **运行环境（Staging）确认** | ⬜ **待双方书面确认** |
| **双方真实签署** | ⬜ **未发生** —— 签署栏**留空**，本侧**不代签** |
| **部署版本** | ⛔ **NOT_RUN** —— 用户明令**不得部署生产** |
| **真实/模拟** | —（签署为真人动作） |
| **日志/截图路径** | `JOINT_SIGNOFF_V1.2.md`（§1 版本确认 / §3 待确认清单 / §5 签署栏） |
| **缺口责任** | **双方 + 用户**（生产授权） |

---

## 4. 统计

| 状态 | 数量 | 明细 |
| --- | --- | --- |
| ✅ **PASS** | **7** | `INT-01`、`INT-02`、`INT-03`、`INT-05`、`INT-07`、`INT-08`、`INT-12` |
| ⚠ **CONDITIONAL** | **4** | `INT-04`、`INT-06`、`INT-13`、`INT-14` |
| ⛔ **BLOCKED** | **3** | `INT-09`、`INT-10`、`INT-11` |
| ❌ **FAIL** | **0** | — |
| ⏸ **NOT_RUN** | **0** | （各项内的 `NOT_RUN` 子项已在对应表格列明） |
| **合计** | **14** | — |

> **总结论：`CONDITIONAL`。** `FAIL 0` **不构成通过** —— 3 项 BLOCKED 全部源于**外部输入未到**。

---

## 5. 阴性对照总表（「失败数为零」不等于通过）

| 类别 | 断言 | 期望失败 | 结果 |
| --- | --- | --- | --- |
| 过期 / 未来时间戳 | `build06 D6-14/15` | `401 TIMESTAMP_OUT_OF_WINDOW` | ✅ |
| nonce 重放（**首次必须 200**） | `build06 D6-16` | 重放 `401 NONCE_REPLAY` | ✅ |
| 服务账号撤销 | `build06 D6-17` | 撤销后 `401 BAD_SERVICE_ACCOUNT` | ✅ |
| 公钥轮换后旧签 | `build06 D6-18` | `401 BAD_SIGNATURE` | ✅ |
| 签名伪造（反面对照） | `build06 D6-19` | `401 BAD_SIGNATURE` | ✅ |
| 跨品牌（体/票据不一致） | `build06 D6-20` | `403 BRAND_MISMATCH` | ✅ |
| 跨品牌（不在允许清单） | `build06 D6-21` | `403 BRAND_NOT_ALLOWED` | ✅ |
| 服务身份越权最终审批 | `build06 D6-23` | 剔除 scope + `403 TICKET_KIND_MISMATCH` | ✅ |
| 跨品牌资产复用 | `build06 D6-25` | `403 NOT_REUSABLE_FOR_SUBJECT` | ✅ |
| 高密级检索 | `build06 D6-27` | 普通身份 `hits=0` | ✅ |
| 被拒请求不得留 2xx | `build06 D6-30` | 审计全为 4xx | ✅ |
| 跳过最终审批 | `build06 D6-45` | `libraryId=null` / 无可复用引用 | ✅ |
| 撤回后沿用旧结论 | `build06 D6-50/51` | `409 FORMAL_OUTPUT_BLOCKED` | ✅ |
| `REFERENCE_ONLY` Skill 正式输出 | `build06 D6-53` | 阻断（`SKILL_NOT_EFFECTIVE`） | ✅ |
| 撤销服务账号后探测 | `build06 D6-54` | 全失败且 `ok=true` 数为 **0** | ✅ |
| 未映射用户 | `build06 D6-39` | `NO_PROVIDER_USER_MAPPING`（**零出站**） | ✅ |
| 缺 `fileName` / `reuseScope` 非法 | `dual D-24b/D-24d` | 零出站 | ✅ |
| 许可 `expired` / `unknown` | `unit U-16b5` | 预检 FAIL | ✅ |
| 未知事件类型 | `dual E-06/E-06b` | 置 `reconcileRequired`（**不静默忽略**） | ✅ |
| SSRF 全类目 / 提示注入 | `sec SEC-11…15` | 全拒 / 无副作用 | ✅ |

---

## 6. 验收门槛自检

| 门槛 | 结果 |
| --- | --- |
| 所有 P0 场景具备**真实 HTTP 日志** | ✅ `build06` 61/61（双独立进程）+ `joint` 64/64（V1.1 复跑） |
| **不得用单元测试冒充真实调用** | ✅ `build06` 为双进程真实 HTTP，并读取**被调用方自己的审计**（6/6 对号） |
| **安全负例必须有服务端审计证据** | ✅ `D6-29` 6/6 命中（`code`+`status`+`ok=false`）；`D6-30` 无 2xx 残留 |
| **失效对象不得生成新正式作品** | ✅ `D6-50/51` 端到端；且为**唯一权威判定**（门禁与生成同源） |
| **无未经授权资产可复用** | ✅ `D6-45`/`D6-47`：未完成最终审批即 `libraryId=null` |
| **无发布成品镜像** | ✅ `publishing.js` 零引用 + 双方 `false` 声明 + Provider `/health` 实测 |
| **无普通管理员绕过最终审批** | ✅ 权限互不包含 + `D6-23` `403` + 服务票据恒无该 scope |
| **三个准入字段由 Provider 枚举定义** | ✅ `D6-41`；本侧只映射与校验，**未改**共享契约 |
| **所有关键外部阻断如实报告** | ✅ `INT-09/10/11` 三项 BLOCKED，责任方标明（原件 / Skill 生效 / 密钥与费用） |
| **未改资料库源码** | ✅ `D6-56`：Provider `server.js` mtime Δ=0ms |
| **八个工作中心保留** | ✅ `public/mos/js/app.js CENTERS` = 8；UI 套件逐页覆盖 |
| **S05 / 声誉专项 / 线索闭环保持 MARK** | ✅ `D6-57`：`/api/mos/meta` 权限表 20 项，MARK 类命中 **0** |
| **未经批准不得上线生产** | ✅ 本轮**未做任何部署动作**；隔离实例用后停止、临时目录清理、`data/` 未被触碰 |

---

## 7. 阻断与缺口汇总（责任方逐条）

| # | 项 | 级别 | 影响 INT | 责任方 | 可否本侧单方解除 |
| --- | --- | --- | --- | --- | --- |
| `B-1` | SPECIAL-01 **原件未提供** | P0 | INT-09（连带 INT-06 负向） | **提供方 / 业务方** | ❌ |
| `B-2` | Skill V1.2 **未真人批准 / 未 EFFECTIVE** | P0 | INT-10、INT-06（正向） | **提供方 + 真人审批人** | ❌ |
| `B-3` | **真实授权人**最终审批 Staging 签认未执行 | P0 | INT-04、INT-13、INT-14 | **双方会同 + 真人** | ❌ |
| `B-4` | 真实 AI **密钥与费用授权缺失** | P1 | INT-11 | **用户** | ❌ |
| `B-5` | 提供方**应用版本口径不一**（`1.1.7` vs 工作区 `1.1.8`） | P1 | INT-14 | **提供方** | ❌ |
| `B-6` | 提供方工作区存在**未提交代码改动** | P1 | 基线可复现性 | **提供方** | ❌ |
| `B-7` | 提供方**全量回归 / 数据恢复演练**未交叉互认 | P1 | INT-13 | **双方会同** | ❌ |
| `B-8` | 跨主机 **TLS** 未验证 | P2 | INT-01 部署形态 | 环境（部署阶段） | ❌ |
| `B-9` | 线上**部署**未验证 | P2 | 交付验收 | **用户（明令禁止）** | ❌ |

> **本侧未把任何 `BLOCKED` 记为 `CONDITIONAL`，也未把任何 `CONDITIONAL` 记为 `PASS`。**

---

## 8. 本侧未自行判定为 PASS 的说明（诚实边界）

| 项 | 为何不自行晋级 |
| --- | --- |
| `INT-04` | 「由**真实**授权人批准」这一**真人动作**尚未发生（合成身份只证明机制） |
| `INT-06` | 只有"引用态被阻断"的负向证据，**无 EFFECTIVE Skill 的正向验证** |
| `INT-13` | C 包明文「不得只引用单方报告」→ 需双方会同互认 |
| `INT-14` | 「共同签署」与「运行环境确认」动作**尚未发生**，且提供方版本口径待统一 |
| `INT-09/10/11` | 外部输入（原件 / Skill 生效 / 密钥与费用授权）**未到**，不臆造、不冒充 |

**总结论：`CONDITIONAL`。**
**不得**凭开发自审宣布生产级合规认证；**不得**代替用户本人的试运行决策；
**未经用户批准，不得部署生产环境。**

---

## 9. 双方确认（**留空，待真实签署**）

| 角色 | 项目 / 版本 | 本轮提交 | 签署人 | 日期 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 消费方（VFIB Marketing OS） | `475022876/watu-operation` · **0.1.1** | 基线 `259a91d` → 发布提交 | ⬜ **待签** | ⬜ | ⬜ |
| 提供方（企业资料库） | `4cbfeef` · 版本口径待确认 | `4cbfeef`（+ 3 个未提交文件） | ⬜ **待签** | ⬜ | ⬜ |
| 生产部署授权 | — | — | ⬜ **未授权** | ⬜ | **本轮不部署** |

> ⚠ 本侧**不代签**、**不伪签**。空白即「未确认」。完整签署页与待确认清单见
> [`MARKETING_HANDOFF_BUNDLE_V1.2/JOINT_SIGNOFF_V1.2.md`](MARKETING_HANDOFF_BUNDLE_V1.2/JOINT_SIGNOFF_V1.2.md)。
