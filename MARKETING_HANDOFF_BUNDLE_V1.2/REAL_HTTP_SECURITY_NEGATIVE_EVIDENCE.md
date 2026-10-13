# 真实 HTTP 安全负例证据（INT-02 / INT-03）

> 套件：`tools/mos-e2e-build06-dual.js`（`bash tools/run-mos-tests.sh build06`）
> 证据：`evidence/dual-security-result.json`（SHA256 `1df58372…`）+ `evidence/dual-security-summary.txt`
> 本次 runId：**`bd499b20`**（证据文件内的 `runId` 字段为权威值；每次运行随机）
> 端口：MOS `9564` / Provider `9765`（隔离数据目录，运行期随机；用后自动清理）
> 结果：**61/61 通过**，`verdict = PASS_EVIDENCE_COMPLETE`

**这不是单元测试。** 套件以 `spawn` 启动**两个真实进程**（MOS 隔离实例 + Provider 隔离实例，
`Provider` 侧只以 `server.js` + 环境变量装配，**不改一行资料库源码**），
经真实 TCP/HTTP 发包、真实 Ed25519 签名、真实受限票据、真实 `x-vfib-correlation-id`，
并在最后**直接读取 Provider 隔离实例自己的 `db.json`** 逐条核对服务端审计行。

---

## 1. 环境与隔离声明

| 项 | 值 |
| --- | --- |
| Provider 源码目录 | `D:\企业数据后台\oa-system-20261004\oa-system`（`providerSourceDir`） |
| Provider 源码未被本次联调修改 | ✅ `providerSourceUnchanged: true`（`D6-56`：`server.js` mtime Δ=0ms） |
| 数据隔离 | 两侧各自独立临时数据目录（运行期 random），**不触碰任何 `data/`** |
| 凭据隔离 | 服务账户私钥、签名密钥、引导口令全部**运行期随机生成，仅在内存**；不落盘、不进证据 |
| 脱敏 | 证据只保留 `correlationId` / `code` / `status` / `ok` / 端点名；**不含**私钥、口令、正文 |

### 合成身份（**明确标注**）

| 侧 | 身份 | 用途 |
| --- | --- | --- |
| Provider | `d6.exec`（member）/ `d6.exe`（executive）/ `d6.rev`（reviewer）/ `d6.lfa`（owner） | 权限与密级测试 |
| MOS | `d6.creator`（P2）/ `d6.precheck`（ASSET_REVIEWER）/ `d6.final`（LIBRARY_FINAL_APPROVER）/ `d6.ops`（P1）/ `d6.unmapped`（未映射对照） | 独立审批链与门禁 |

> ⚠ **合成身份只证明控制机制有效，不代表真人授权或真人验收。** 真人签认见 `JOINT_SIGNOFF_V1.2.md`（留空）。

---

## 2. INT-02 —— 身份类拒绝（真实 HTTP）

| # | 请求条件 | 期望 | 实际 | 脱敏 requestId |
| --- | --- | --- | --- | --- |
| `D6-14` | `GET /health`，`x-vfib-timestamp = now − 3600s`（**过期签名**） | `401 TIMESTAMP_OUT_OF_WINDOW` | ✅ `401/TIMESTAMP_OUT_OF_WINDOW` | `d6-bd499b20-5` |
| `D6-15` | 同上，`timestamp = now + 3600s`（**未来时间戳**） | `401 TIMESTAMP_OUT_OF_WINDOW` | ✅ `401/TIMESTAMP_OUT_OF_WINDOW` | `d6-bd499b20-6` |
| `D6-16` | `POST /assets/search`，**同一 nonce 原样重放**（首次 200 → 立即重放） | 首次 `200`，重放 `401 NONCE_REPLAY` | ✅ 首次 `200` → 重放 `401/NONCE_REPLAY` | `d6-bd499b20-8` |
| `D6-17` | **服务账号撤销**：撤销前请求 / `DELETE /api/integration-accounts/:id` / 撤销后再请求 | 撤销前 `200`；撤销 `200`；撤销后 `401 BAD_SERVICE_ACCOUNT` | ✅ `200 / 200 / 401 BAD_SERVICE_ACCOUNT` | `d6-bd499b20-10` |
| `D6-18` | **公钥轮换**：轮换前旧签 / `PUT .../public-key` / 旧签再发 / 新签 | 轮换前 `200`；旧签 `401 BAD_SIGNATURE`；新签 `200` | ✅ `200 / 200 / 401 / 200` | `d6-bd499b20-12` |
| `D6-19` | **对照**：伪造 `x-vfib-signature`（证明上面的 401 并非"一律拒绝"） | `401 BAD_SIGNATURE` | ✅ `401/BAD_SIGNATURE` | — |

**阴性对照的意义**：`D6-19` 是"反向对照"——若服务端把所有请求一律拒绝，前五项也会"通过"。
伪造签名与合法签名被**同码拒绝**说明判定发生在**验签**环节，而非"未配置/未启用"导致的整体拒绝。
同理 `D6-16` 的"首次 200"证明 nonce 重放的 401 来自**重放检测**而不是其他原因。

---

## 3. INT-03 —— 跨品牌 / 高密级拒绝（真实 HTTP）

| # | 请求条件 | 期望 | 实际 | 脱敏 requestId |
| --- | --- | --- | --- | --- |
| `D6-20` | **体/票据品牌不一致**：用 VFIB 票据访问 UCARD 上下文（`body.brandId=UCARD`） | `403 BRAND_MISMATCH` | ✅ `403/BRAND_MISMATCH` | `d6-bd499b20-15` |
| `D6-21` | 票据品牌**不在服务端允许清单**（`allowedBrands` 未包含该品牌） | `403 BRAND_NOT_ALLOWED` | ✅ `403/BRAND_NOT_ALLOWED` | `d6-bd499b20-16` |
| `D6-22` | 单独授权的本人会话可签出 `admission.final.decision` 票据（`kind=session`） | `200` | ✅ `200` | — |
| `D6-23` | **反例**：服务票据索取 `admission.final.decision` → 被剔除；以该票据打最终审批 | 签发 scopes 不含该范围；审批 `403 TICKET_KIND_MISMATCH` | ✅ `scopes=["admissions.read"]` → `403/TICKET_KIND_MISMATCH` | — |
| `D6-24` | 准入链路真实走通（create / submit / final-decision / artifact）取得正式 Asset ID | 四步均 `200` 且有 `libraryAssetId` | ✅ `200/200/200/200`，`assetId=VFIB-ASSET-2026-0001` | — |
| `D6-25` | **同一资产**：VFIB 票据解析 vs UCARD 票据解析 | VFIB `200`；UCARD `403 NOT_REUSABLE_FOR_SUBJECT` | ✅ `200 / 403 NOT_REUSABLE_FOR_SUBJECT` | `d6-bd499b20-24` |
| `D6-26` | **跨品牌检索隔离**：同一 query 分别用 VFIB / UCARD 票据检索 | VFIB 命中该资产；UCARD 结果**不含**该资产 | ✅ `VFIB items=1 / UCARD items=0`（UCARD 含目标=false） | — |
| `D6-27` | **高密级（executive）资料**：普通身份检索 vs 高管身份检索 | 普通身份 **0 命中**；高管身份**命中** | ✅ `hits=0（含目标=false）` / `hits=1（含目标=true）` | `d6-bd499b20-28` |
| `D6-28` | **对照**：internal 资料对普通身份可见（证明检索链路本身有效） | 普通身份**命中** | ✅ `hits=1（含目标=true）` | `d6-bd499b20-30` |

**两面向验证（关键）**：`D6-27` 与 `D6-28` 一起构成"**不是检索坏了**"的证据：
同一链路下 internal 可见、executive 对普通身份不可见、executive 对高管可见 —— 三者同批通过。

**`D6-23` 的三重闭合**：服务身份**不可**代签最终审批（服务票据永远拿不到 `admission.final.decision`），
且 `kind` 不匹配时以 `403 TICKET_KIND_MISMATCH` 拒绝，构成"服务身份 / 用户票据 / 最终审批"三重分离。

---

## 4. 服务端审计证据（**不是只看 HTTP 响应**）

套件在全部拒绝用例执行后，直接读取 **Provider 隔离实例自己的 `db.json`**，
筛出 `action === 'integration-call'` 的审计行，按 `x-vfib-correlation-id` **逐条对号**：

| 拒绝类别 | correlationId | 期望 `code/status` | 审计行实际 | 命中 |
| --- | --- | --- | --- | --- |
| 过期签名 | `d6-bd499b20-5` | `TIMESTAMP_OUT_OF_WINDOW/401` | 同 | ✅ |
| nonce 重放 | `d6-bd499b20-8` | `NONCE_REPLAY/401` | 同 | ✅ |
| 服务账号撤销 | `d6-bd499b20-10` | `BAD_SERVICE_ACCOUNT/401` | 同 | ✅ |
| 跨品牌（体/票据不一致） | `d6-bd499b20-15` | `BRAND_MISMATCH/403` | 同 | ✅ |
| 跨品牌（不在允许清单） | `d6-bd499b20-16` | `BRAND_NOT_ALLOWED/403` | 同 | ✅ |
| 跨品牌资产不可复用 | `d6-bd499b20-24` | `NOT_REUSABLE_FOR_SUBJECT/403` | 同 | ✅ |

- `D6-29`：命中 **6/6**（审计行总数 29）。每条同时校验 `code` + `status` + **`ok === false`**。
- `D6-30`：被拒请求在审计中**不得**留下任何 2xx 记录 → 实测**全部为 4xx**（不允许"拒绝看起来像成功"）。

> 因为读取的是**被调用方自己写的审计**（而非调用方的观测），故可排除"调用方自述"的偏差。

---

## 5. 复现命令

```bash
cd D:/运营系统/VFIB-Marketing-OS
bash tools/run-mos-tests.sh build06      # 需同机存在企业资料库源码
# 证据：TEST_EVIDENCE_MOS_BUILD06/dual-security-result.json
```

可选环境变量：`OA_SOURCE_DIR`（资料库源码绝对路径）、`D6_KEEP=1`（保留隔离数据目录以便取证）、
`D6_DBG=1`（在失败明细中附原始响应片段，便于排障）。

---

## 6. 未覆盖 / 边界（如实声明）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 跨主机 TLS | ❌ 未覆盖 | 本机回环 HTTP；跨主机 TLS 属资料库侧部署验收（Provider `TLS_STAGING_CHECKLIST.md`） |
| 真实人员授权 | ❌ 未覆盖 | 全部为**合成身份**；真人签认见 `JOINT_SIGNOFF_V1.2.md`（留空） |
| 生产环境 | ❌ 未覆盖 | 未部署、未访问生产 |
| Provider 全量回归 | ❌ 本侧未复跑 | 本侧只跑本套件；Provider 自有回归由其自行报告（INT-13 因此为 CONDITIONAL） |
