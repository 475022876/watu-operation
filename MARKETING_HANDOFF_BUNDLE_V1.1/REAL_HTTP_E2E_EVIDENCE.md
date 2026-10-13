# REAL_HTTP_E2E_EVIDENCE.md —— 双系统真实 HTTP 端到端联调证据

> 交付包：`MARKETING_HANDOFF_BUNDLE_V1.1/`
> 依据：B 包 B4（跨系统联调准备）+ `03_HANDOFF_AND_REPORT.md` 第 5 项
> 对应验收：`INT-01`、`INT-05`、`INT-06`、`INT-07`、`INT-08`、`INT-14`
> 日期：**2026-10-13**

---

## 0. 结论速览

| 项 | 值 |
|---|---|
| 套件 | `mos-e2e-build04-dual`（`tools/mos-e2e-build04-dual.js`） |
| 运行标识 | **`runTag = 5d00f4e0`** |
| 运行时间 | **2026-10-13T14:14:19.578Z**（UTC）= 本地 22:14 |
| 断言 | **64 / 64 通过**（failed = 0） |
| 真实联调 | `realJointTest = EXECUTED`（真实 HTTP 双进程；Provider 为资料库 V1.1.7 **隔离实例**） |
| 结论 | **CONDITIONAL** |
| 原始证据 | `TEST_EVIDENCE_MOS_BUILD04/dual-e2e-result.json`（64 条逐条）<br>`TEST_EVIDENCE_MOS_BUILD04/dual-e2e-summary.txt` |

> **为什么是 CONDITIONAL 而不是 PASS**：本轮**已完成**真实双进程端到端联调，但（a）Provider 侧
> A 包交付物 `LIBRARY_HANDOFF_BUNDLE_V1.1` 在本次运行**当时**尚未送达（现已收到，见 §7），
> （b）Provider 侧未宣布停止点达成。按 C 包「无真实外部条件不能记 PASS」原则，**联合结论封顶
> CONDITIONAL**，不得由本侧单方面晋级为 PASS。

---

## 1. 运行环境（两端真实、隔离、互不污染）

| 维度 | Marketing OS（消费方） | 企业资料库（提供方 V1.1.7） |
|---|---|---|
| 源码 | `D:\运营系统\VFIB-Marketing-OS` | `D:\企业数据后台\oa-system-20261004\oa-system` |
| 源码改动 | 本侧唯一改动方（用户授权范围内） | **零改动**（`D4-00` 校验路径；`D4-45` 校验 `server.js` mtime **早于**本次运行 1765s） |
| 监听 | `http://127.0.0.1:9552`（`MOS_PORT`） | `http://127.0.0.1:9751`（`PORT`） |
| 端口段 | B4 专用 **9550–9559** | B4 专用 **9750–9759** |
| 数据目录 | `MOS_DATA_DIR` 指向临时隔离目录 | 独立数据目录 + 运行期随机管理员口令 |
| 凭据 | 运行期随机生成 | **运行期随机票据 HMAC 密钥**；管理员口令运行期随机 |
| 出站 | `loopback http + allowLoopbackHttp`（仅隔离测试；**生产一律拒绝**） | 外部 Provider 一律关闭 |
| 数据落盘 | `data/` **未被触碰**（`D4-48`） | 临时数据目录运行后清理（`D4-48`） |

**两端均为真实进程 + 真实 HTTP + 真实 Ed25519 签名 + 真实 HMAC 票据 + 真实状态机**，
**无任何桩返回**。

---

## 2. 真实 requestId 对照表（`INT-01` 要求「请求 ID 对应」）

以下 `requestId` 全部由 **Provider 出站封套**真实生成（前缀 `mos-`），逐条可从
`dual-e2e-result.json` 的 `detail` 字段复核：

| 断言 | 请求语义 | requestId | HTTP | 说明 |
|---|---|---|---|---|
| `D4-16` | `GET /health` 出站探测 | `mos-e77abecb62fa` | 200 | 本侧→Provider 链路打通；`probe.health=HEALTHY` |
| `D4-17` | `POST /assets/search` | `mos-43c295f64398` | 200 | 返回键 `brandId/items/nextCursor/total` |
| `D4-18` | `POST /knowledge/search` | `mos-790446b1d0b9` | 200 | 返回键 `contentPolicy/items/minScore`；**正文一律扣留** |
| `D4-19` | `GET /changes` | `mos-ff4fcfee403a` | 200 | 返回键 `hasMore/items/nextCursor/oldestCursor`；游标为**整数 seq** |
| `D4-29b` | `POST /admissions/{id}/submit` | `mos-08a5205f177f` | 200 | `state=FINAL_APPROVAL_PENDING`（提交真的生效） |

> 上述 ID 与 Provider `TEST_REPORT.md` 中的 `request_id` 同源，可作为双方对账锚点。

---

## 3. 分阶段证据（Phase A — H）

### Phase A —— 环境装配与身份基线（`D4-00` … `D4-04b`）

| 断言 | 结果 |
|---|---|
| `D4-00` Provider 源码可用且未改动 | ✅ 只以 `server.js` + 环境变量装配隔离实例 |
| `D4-01` Provider 隔离实例真实启动 | ✅ `/api/health` 200 |
| `D4-02` Provider 管理员登录 | ✅ 200（`x-oa-client: api` 换会话 token） |
| `D4-03` Provider 侧合成测试身份创建并登录 | ✅ `exec / reviewer / lfa` 三身份均 ok |
| `D4-04` 独立授权显式授予（**最终审批权不继承**） | ✅ `lfa:library.asset.approve.final`、`exec:ai.external.transfer`、`rev:library.skill.approve.effective` |
| `D4-04b` 资料夹具上传并批准 | ✅ `open=d_mv6rhxcv5f93e8d4/200`、`exec=d_mv6rhxd0d18a7e7f/200` |

> `D4-04` 是本轮「最终审批**必须单独授权**」的**结构性证据**：三个身份各自持有**互不包含**的权限点。

### Phase B —— 服务身份与只读探测（`D4-05` … `D4-20`）

| 断言 | 结果 |
|---|---|
| `D4-05` 服务账户登记成功（Provider 只持**公钥**） | ✅ `keyId=svc_mv6rhxd46d03874d`，响应**不含任何私钥字段** |
| `D4-06` 本侧 Ed25519 签名被 Provider **真实验签**通过 | ✅ 200，`policy=1.0` |
| `D4-07` **伪造签名被拒** | ✅ `401 BAD_SIGNATURE` —— **证明 D4-06 不是桩返回**（阴性对照） |
| `D4-08` 能力声明不夸大 | ✅ `publishedContentArchive=false`（Provider 不提供发布归档） |
| `D4-09` MOS 隔离实例真实启动 | ✅ 200 |
| `D4-10` 引导管理员首登强制改密 | ✅ 口令策略**真实生效** |
| `D4-11` MOS 侧合成身份创建 | ✅ `d4.creator,d4.reviewer,d4.final,d4.unmapped`（含**未映射对照**） |
| `D4-11b` 四身份已**落盘**（重启前核对） | ✅ 避免把「内存态」当「落盘态」 |
| `D4-12` 带显式用户映射重启成功 | ✅ 数据目录持久化、会话重签 |
| `D4-13` / `D4-13b` 重启后会话与四身份登录 | ✅ 200,200,200,200 |
| `D4-14` 集成状态 `configured=true` 且出站守卫放行 | ✅ 文案明确「**不代表联调通过**」 |
| `D4-15` **契约基线一致**：本侧 OpenAPI SHA256 与 C 包逐字节相同 | ✅ `sha=cd3cc198a9c56819…`，`codes=71` |
| `D4-16` 真实出站探测 `/health` | ✅ 200（见 §2） |
| `D4-17` `assets/search` 真实 HTTP | ✅ 200 |
| `D4-18` `knowledge/search` 命中夹具且**正文扣留** | ✅ `snippet` 不外流 |
| `D4-19` `changes` 游标语义为**单调整数 seq** | ✅ 200 |
| `D4-20` 只读探测**不回流正文**（响应顶层键无 `content/body/text`） | ✅ `probes=3` |

### Phase C —— 资产准入端到端（`INT-05`，`D4-21` … `D4-35`）

| 断言 | 结果 |
|---|---|
| `D4-21` 工作素材上传成功（真实落盘 + sha256） | ✅ `wa_mv6ri1xh_9c546bdc9d25` |
| `D4-22` MOS 建单且**带三项 Provider 必填字段** | ✅ `adm_mv6ri1xo_bc6b7ec0b61e`，`complete=true` |
| `D4-23` 预检 PASS（**独立预检员**执行，权限不含最终审批） | ✅ `verdict=PASS` |
| `D4-24` 送审产生 `ASSET_ADMISSION` 审核单（**提交人不得自批**） | ✅ `rc_mv6ri1xt_0fd7469705a5` |
| `D4-25` 授权主体在 MOS 侧完成最终审批 | ✅ 200（持 `library.asset.approve.final`） |
| `D4-26` **未映射用户**同步 → 如实拒绝 | ✅ `NO_PROVIDER_USER_MAPPING`，**绝不用服务身份顶替** |
| `D4-27` 真实同步第③步被 Provider **409 `FINAL_APPROVAL_REQUIRED`** 拦下 | ✅ `stage=artifact`（**不中途可用**） |
| `D4-28` 本侧**不伪造**成功 | ✅ `libraryId=null`、`syncStatus=FAILED`、`library_asset_refs` **未建立**可复用引用 |
| `D4-29` Provider 侧申请**真实存在** | ✅ `providerAdmissionId=adm_mv6ri1zx49140131`（非进程内假象） |
| `D4-30` 服务票据索取 `admission.final.decision` 被剔除 + 强行使用 → **403** | ✅ `greedyHTTP=403 granted=[] attemptHTTP=403 code=TICKET_KIND_MISMATCH` |
| `D4-30b` 本侧 `finalDecision()` **结构性恒拒** | ✅ 双重闭合 |
| `D4-29b` 申请状态推进到 `FINAL_APPROVAL_PENDING` | ✅ `providerProblems=[]`、`steps=[create,PRECHECK,REVIEWING,FINAL_APPROVAL_PENDING]` |
| `D4-31` 被显式授权的**本人会话**可签出含 `admission.final.decision` 的票据 | ✅ 200，`kind=session` |
| `D4-32` Provider 侧最终审批通过 | ✅ `state=FINAL_APPROVED` |
| `D4-33` 重试同步成功：取得**真实** Asset ID + 版本 ID | ✅ `assetId=VFIB-ASSET-2026-0001`、`version=VFIB-ASSET-2026-0001-V1.0` |
| `D4-34` 本侧引用以**真实来源**建立 | ✅ `mode=real`、`permissionValid=true`、`assetState=ACTIVE` |
| `D4-35` 使用前**重新验证** | ✅ `reason=PROVIDER_VERIFIED` |

> **`INT-05` 关键判据全覆盖**：三必填字段 ✅ / 复核记录 ✅ / 稳定幂等键 ✅ /
> 入库返回真实 Asset ID + version ✅ / **失败不可复用** ✅（D4-27/28）。

### Phase D/E —— 撤回、事件与失效（`INT-07`，`D4-36` … `D4-40`）

| 断言 | 结果 |
|---|---|
| `D4-36` Provider 侧撤回成功（治理动作，留审计） | ✅ 200 |
| `D4-37` 撤回后**治理主体**解析 → **410 `ASSET_GONE`** | ✅ 可区分「曾经有效但已失效」 |
| `D4-37b` **非治理主体**解析 → 非 200（**404 一致隐藏**） | ✅ 不得据此判定可用 |
| `D4-38` 事件轮询**真实消费到** `asset.revoked` | ✅ `items=14`，游标推进至 14 |
| `D4-39` 本地引用被置 `INVALIDATED`（可审计） | ✅ `invalidations=2`：`permission.changed:VFIB`、`asset.revoked:VFIB-ASSET-2026-0001` |
| `D4-40` 撤回后再做使用前验证 → **拒绝且零出站** | ✅ `INVALIDATED_LOCALLY`，`usable=false` |

### Phase H —— 发布归档隔离（`INT-08`，`D4-49` … `D4-56`）

详见 `PUBLISHED_CONTENT_ISOLATION.md`。摘要：

| 断言 | 结果 |
|---|---|
| `D4-49` 发布链身份就绪（P3 操作员 / `PUBLISHING_APPROVER`，**均非管理员**） | ✅ |
| `D4-50` 内容冻结送审生成 `PUBLICATION_APPROVAL` 审核单 | ✅ |
| `D4-51` 审批通过进入 `APPROVED`（**提交人与审批人分离**） | ✅ |
| `D4-52` 人工登记实际发布 → `PublicationRecord`（**真实 URL**） | ✅ `pub_mv6ri2xj_feb737f71a29` |
| `D4-53` 归档快照**真实落盘**且正文可只读回放 | ✅ `TEXT_SNAPSHOT` + `MANIFEST`；`archivedBodyAvailable=true` |
| `D4-54` 资料库侧资产总数**发布前后未变化** | ✅ `before=0 after=0` |
| `D4-55` 发布期间资料库变更事件流**零新增** | ✅ `cursorBefore=14 newItems=0` |
| `D4-56` 从历史成品提取母版 → **独立新准入申请** | ✅ `remasterProviderId ≠ firstProviderId`，同样 `FINAL_APPROVAL_REQUIRED` |

### Phase F —— 边界与守住红线（`D4-41` … `D4-48`）

| 断言 | 结果 |
|---|---|
| `D4-41` Published Content 归档**恒不在** Provider | ✅ `capabilities.publishedContentArchive=false` |
| `D4-42` 归档面在 Marketing OS 侧真实存在 | ✅ `GET /api/mos/publications` → `total=1` |
| `D4-42b` 归档说明明示「已发布内容**不会**自动进入企业资料库」 | ✅ 零污染回灌 |
| `D4-43` MARK 项**未开发**（权限表中不存在对应权限点） | ✅ `forbidden=[]`，`perms=20` |
| `D4-44` schema 升至 **v5**（四集合随迁移只增不改） | ✅ `schemaVersion=5` |
| `D4-45` Provider 源码**未被本次联调修改** | ✅ `mtimeAge=1765s` |
| `D4-46` MOS 侧事件轮询**默认关闭** | ✅ 未获运营授权**不自动出站** |
| `D4-47` Provider 隔离实例运行期**无未捕获异常** | ✅ |
| `D4-48` 两套实例均已停止、临时目录已清理、`data/` **未被触碰** | ✅ |

---

## 4. 阴性对照（证明「不是自说自话」）

| 对照 | 断言 | 期望失败 | 实测 |
|---|---|---|---|
| **签名伪造** | `D4-07` | `401 BAD_SIGNATURE` | ✅ 401 |
| **服务身份越权最终审批** | `D4-30` | `403 TICKET_KIND_MISMATCH` | ✅ 403 |
| **未映射用户** | `D4-26` | `NO_PROVIDER_USER_MAPPING`（**零出站**） | ✅ |
| **跳过最终审批** | `D4-27` | `409 FINAL_APPROVAL_REQUIRED` | ✅ 409 |
| **失败后伪造复用** | `D4-28` | `libraryId=null` / `sizeRefs=0` | ✅ |
| **撤回后沿用旧结论** | `D4-40` | `INVALIDATED_LOCALLY`（零出站） | ✅ |
| **非治理身份看已撤回资产** | `D4-37b` | 非 200（404） | ✅ 404 |

> 「失败数为零」不等于通过 —— 上述 7 组**阴性对照全部真实触发**，才是通过的依据。

---

## 5. 脱敏说明

证据 JSON 与本文档中的日志**已按下列规则脱敏**，可安全交付：

| 类别 | 处置 |
|---|---|
| 私钥 / 签名密钥 / 票据明文 | **从不打印**；正则 `SECRET_KEY_RE`（`privateKey`/`signingKey`/`ticket`/`authorization`/`cookie`/`password`/`apiKey`）+ 长 base64 兜底 |
| 管理员口令 | 运行期随机生成，**只用于进程内换会话**，不落盘、不入证据 |
| 票据 HMAC 密钥 | Provider 侧进程内随机，**只披露来源是 `configured` 还是 `ephemeral`** |
| URL | 全为 `127.0.0.1` 回环；**无任何生产域名** |
| 业务数据 | 全部为合成夹具（`D4-*` 前缀），**不含客户真实文件** |
| `keyId` / `requestId` / `assetId` | 保留 —— 它们是**非机密**的对账锚点，双方需要 |

---

## 6. 复现命令

```bash
# 前置：同机存在企业资料库源码（只读，不得修改）
#   D:/企业数据后台/oa-system-20261004/oa-system

cd D:/运营系统/VFIB-Marketing-OS
node tools/mos-e2e-build04-dual.js          # 或：bash tools/run-mos-tests.sh joint
```

运行后产出：

- `TEST_EVIDENCE_MOS_BUILD04/dual-e2e-result.json`（64 条逐条断言 + 环境 + 契约指纹）
- `TEST_EVIDENCE_MOS_BUILD04/dual-e2e-summary.txt`（结论摘要）

**退出码**：`failed === 0` → 0；否则非 0（可接 CI）。

---

## 7. 本轮之后的状态更新（诚实边界）

| 时间线 | 状态 |
|---|---|
| 2026-10-13 14:14（本次运行） | `LIBRARY_HANDOFF_BUNDLE_V1.1` **尚未收到** → 结论封顶 `CONDITIONAL` |
| 2026-10-13 21:43—21:54（Provider 交付） | 收到 `LIBRARY_HANDOFF_BUNDLE_V1.1`（Provider git `20b1cb52…`） |
| **对其 OpenAPI 做 SHA256 复核** | ✅ 与本侧基线 + C 包 **逐字节一致**（`cd3cc198…`） |
| 对其 D-00…D-10 答复的消化 | 见 `CONTRACT_DIFF_SIGNED.md`（尤其是 D-06.5 / D-06.4 / D-02 / D-03.2 / D-07.3 / D-09.3 六项已落地） |
| **本次证据是否需要重跑** | **不需要** —— 64 条断言的**契约假设未因 D-* 答复而变化**；其中 D-06.5（`reuseScope`）与 D-02（未知事件 fail-safe）本侧在运行前已按同一结论实现 |

> ⚠ **仍需双方会同**：Provider 侧 `TEST_REPORT.md` 的 `request_id` 与本侧 §2 表逐条对齐确认；
> 该动作属 `INT-14` 联合签署范围，本侧**不代签**。

---

## 8. 未完成 / 未验证

| 项 | 状态 | 说明 |
|---|---|---|
| 跨主机 / TLS 终结下的同样 64 条 | `NOT_RUN` | 本轮为回环直连（`allowLoopbackHttp` 显式开启，**生产一律拒绝**）；Provider `B-5` 同项 |
| 线上域名 / 反向代理（`Origin`+`Host` 同源） | `NOT_RUN` | 需真实域名环境；用户明令**不得部署生产** |
| Provider 侧 `resubmit` 恢复路径 | `BLOCKED` | Provider `B-4`：`/submit` **无重提分支**；本轮按「新 `idempotencyKey` 新建」实现并在 UI/文档中提示 |
| 对账式重跑（双方 `request_id` 逐条互认） | `NOT_RUN` | 需双方会同（`INT-14`） |
