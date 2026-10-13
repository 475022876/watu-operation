# SERVICE_AUTH_HANDOFF.md — 服务认证与密钥交接（全部脱敏）

> 交接对象：VFIB Marketing OS（Consumer）。
> **本文不含任何私钥、共享密钥、token、真实口令或生产地址。**
> 所有示例值要么是**结构性占位**，要么是**可公开的指纹**（指纹不可用于冒充）。

---

## 0. 一句话模型

调用受控集成接口需要**两把不同的东西同时成立**：

| | 凭据 | 回答的问题 | 由谁保管机密 | 服务端存什么 |
|---|---|---|---|---|
| ① | **服务身份**：Ed25519 请求签名（4 个头） | 是**哪个服务账户**在调用 | **Consumer** 保管私钥 | 只存**公钥 PEM** + SHA256 指纹 |
| ② | **用户上下文**：受限签名票据（1 个头） | 这次调用**替哪个真实员工** | 由 Provider 签发 | HMAC 密钥（部署注入） |

> ★ 关键安全属性：**Provider 侧数据库里不存在任何可以冒充 Consumer 的机密**。
> 即使 `db.json` 全量泄露，攻击者也无法伪造签名（拿到公钥没有用），
> 也无法伪造票据（票据 HMAC 密钥只在服务端进程/环境变量中）。

---

## 1. 服务身份：Ed25519 请求签名

### 1.1 请求头（四件套，缺一不可）

```
x-vfib-key-id    : svc_xxxxxxxxxxxxxxxx      服务端登记的 keyId
x-vfib-timestamp : 1791892881                Unix 秒
x-vfib-nonce     : <每次唯一的随机串，建议 12 字节 hex>
x-vfib-signature : <base64(Ed25519 签名)>
```

可选：`x-vfib-correlation-id: <调用方请求 ID>` —— 服务端**原样回填**为响应 `request_id`，
用于贯穿双方日志。未提供时服务端生成 `req_*`。

### 1.2 被签名的内容 `canonicalString`

**7 段、以 `\n` 连接、逐字节一致**（顺序不可换）：

```
v1
<keyId>
<METHOD 大写>
<pathname 不含 query string>
<timestamp>
<nonce>
<sha256(请求体原始字节) 的 hex>
```

签名算法：

```js
const sig = crypto.sign(null, Buffer.from(canonicalString, 'utf8'), privateKey).toString('base64');
```

### 1.3 三个最容易写错的地方（写错必得 `401 BAD_SIGNATURE`）

1. **无请求体视作空字节。** 不是 `'{}'`、不是 `'null'`，是零字节：
   `sha256('')` = `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
2. **`pathname` 不含 query string。** 服务端取的是 `url.pathname`。
   `?brandId=VFIB&version=V1.0` 必须出现在 URL 上，但**不参与签名**。
   （这是我们在自己的联调探针里真实踩过的坑：把 query 签进去 → 全线 401。）
3. **不得重新序列化 JSON。** 对**发出的原始字节**做哈希。键顺序、空格、
   Unicode 转义（如 `\u4e2d` vs 中文字面）任何差异都会导致验签失败。
   如果 HTTP 库会改写 body，请在签名前**固定**序列化结果并复用同一份字节。

### 1.4 服务端验签五步（顺序即语义）

```
① 集成总开关 enabled === true        → 否则 503 INTEGRATION_DISABLED
② 账户存在且未撤销                    → 否则 401 BAD_SERVICE_ACCOUNT
③ |now - timestamp| ≤ 300s            → 否则 401 TIMESTAMP_OUT_OF_WINDOW
④ Ed25519 验签                        → 否则 401 BAD_SIGNATURE / MISSING_SIGNATURE / BAD_SIGNATURE_FORMAT
⑤ nonce 未用过（时间窗内）             → 否则 401 NONCE_REPLAY
⑥ 按账户限流（默认 240 次/分钟）        → 否则 429 RATE_LIMITED
```

**「账户不存在」与「账户已撤销」返回同一个响应**（`401 BAD_SERVICE_ACCOUNT`）
—— 不提供枚举服务账户的信号。

### 1.5 公钥登记格式（三选一）

`POST /api/integration-accounts` 的 `publicKey` 字段接受：

| 形式 | 说明 |
|---|---|
| SPKI PEM 字符串 | 必须包含 `-----BEGIN`；结构如下（示例 body 已打码） |
| 32 字节裸公钥的 **hex** | 匹配 `^[0-9a-f]{64}$`（大小写不敏感） |
| 32 字节裸公钥的 **base64 / base64url** | `-` `_` 会被规范化为 `+` `/` |

PEM 结构（**示例，`...` 为占位，非真实密钥**）：

```
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA<32 字节 Ed25519 公钥的 base64，共 43 字符>
-----END PUBLIC KEY-----
```

非法输入**一律拒绝**（`400 BAD_PUBLIC_KEY`），不做宽容解析。

### 1.6 公钥指纹

```
keyFingerprint = sha256( SPKI DER 字节 ).hex.slice(0, 16)     // 16 个 hex 字符
```

本次联调实例登记的示例指纹（**可公开，不可用于冒充**）：

```
keyId           : svc_xxxxxxxxxxxxxxxx（见证据文件 serviceIdentity.keyId）
keyFingerprint  : 056381af8b7eccb4
keyType         : Ed25519
```

> 指纹用于**双方对账**（确认登记的是同一把公钥），它不是密钥、不能用于签名。

---

## 2. 用户上下文：受限签名票据

### 2.1 传输

```
x-vfib-ticket: <base64url(payload)> . <base64url(HMAC-SHA256(payload, serverKey))>
```

### 2.2 payload 字段

```json
{
  "v": 1,
  "kind": "service",          // "session" | "service"
  "sid": "svc_xxx",           // 签发该票据的服务账户（service 票据才有）
  "uid": "u_xxx",             // ★ 真实员工内部 id —— 后续所有权限判定的主体
  "brand": "VFIB",            // 品牌上下文
  "purpose": "…",             // 用途（进审计）
  "scopes": ["knowledge.search", "…"],
  "iat": 1791892881,
  "exp": 1791893181,
  "jti": "<票据唯一 id>",
  "corr": "<关联请求 id>"
}
```

### 2.3 票据的两种来源（这是权限隔离的核心）

| 来源 | 取得方式 | 能拿到 `admission.final.decision` 吗 |
|---|---|---|
| **session** | 员工本人登录后调 `POST /api/asset-admission/tickets` | **能**（且必须本人持有 `library.asset.approve.final`） |
| **service** | 服务账户调 `POST /api/integrations/marketing/tickets` | **永远不能** —— 经 `serviceGrantable()` 静默剔除 |

因此「服务身份代签最终审批」在**结构上不可达**，不是流程约定。

### 2.4 范围计算（三重收敛）

```
最终生效范围 =  请求范围  ∩  服务账户已授予范围
              ↓ 再经 serviceGrantable() 剔除 SESSION_ONLY_SCOPES
              = 不含 admission.final.decision
```

若请求了范围但**一个都没批下来** → `403 SCOPE_NOT_GRANTED`。

### 2.5 票据与签发账户绑定

拿 **A 服务账户**签发的票据，去配 **B 服务账户**的签名使用 →
在所有业务端点得到 **`403 TICKET_ACCOUNT_MISMATCH`**（而不是静默降级或提权）。

> 这条已经写进联调断言（`L1-14.5`），Consumer 侧适配器**不要**在多个账户间复用票据。

### 2.6 有效期

| 项 | 默认 | 上限 | 行为 |
|---|---|---|---|
| 票据 TTL | 300s | 900s（`OA_INTEGRATION_TICKET_MAX_SECONDS`） | 请求 `ttlSeconds` 超上限被**钳制** |
| 过期后 | — | — | `401 TICKET_EXPIRED` |

**服务端重启**：若未配置 `OA_INTEGRATION_SIGNING_KEY`，票据 HMAC 使用进程内随机兜底密钥，
**重启后全部既有票据失效**（`401 TICKET_BAD_SIGNATURE`）。这是刻意的 fail-closed 取舍。
Consumer 应当把「票据失效」当作正常可恢复事件（重新取票），而**不是**当作服务故障。

可通过 `GET /health` → `signing.ticketKeySource` **主动探测**当前状态：

- `configured` — 已配置稳定密钥（生产应有此值）
- `ephemeral-random-per-boot` — 进程内随机（联调/临时环境；重启即失效）

---

## 3. Scope 矩阵

**服务账户可授予（8 项）**：

| Scope | 允许的端点 |
|---|---|
| `tickets.issue` | `POST /tickets` |
| `knowledge.search` | `POST /knowledge/search` |
| `assets.search` | `POST /assets/search` |
| `assets.read` | `GET /assets/{id}` |
| `admissions.write` | `POST /admissions`、`/admissions/{id}/submit`、`/admissions/{id}/artifact` |
| `admissions.read` | `GET /admissions/{id}`、`POST /admissions/{id}/final-decision` |
| `skills.read` | `GET /skills/{id}` |
| `changes.read` | `GET /changes` |

**票据专有（第 9 项，仅 session 可得）**：

| Scope | 说明 |
|---|---|
| `admission.final.decision` | 仅 `POST /admissions/{id}/final-decision`，且须本人持有独立钥匙 |

> ⚠ **两层 scope 是「与」关系**：服务账户必须有该 scope **且** 票据必须含该 scope。
> 参考 `POST /admissions/{id}/final-decision` 只要求服务账户侧 `admissions.read`，
> 但**用户身份**侧必须是 session 票据 —— 这就是「服务身份不可代签」的双重闭合。

**三个业务谓词独立于 scope**，票据范围对了也可能被业务谓词拒绝：

| 谓词 | 独立钥匙（`lib/permission-grants.js`） | 默认 | 继承 |
|---|---|---|---|
| `canApproveMarketingAdmission` | `library.asset.approve.final` | **无人持有** | **不继承任何角色**（admin 也没有） |
| `canSendToExternalAI` | `ai.external.transfer` | **无人持有** | 不继承 |
| `canApproveSkill`（生效） | `library.skill.approve.effective` | **无人持有** | 不继承 |

三把钥匙**互不蕴含**，且撤销**即时生效**（需管理员经治理端操作）。

---

## 4. 密钥轮换与账户生命周期

### 4.1 登记（Provider 管理员执行）

```
POST /api/integration-accounts            （系统管理员会话 + CSRF）
{ "name": "…", "publicKey": "<PEM|hex|base64>", "scopes": ["…"], "description": "…" }
→ 200 { ok:true, item:{ id, keyId, name, scopes, keyFingerprint, active:true, … } }
```

返回**只有** `id` / `keyId` / `keyFingerprint` —— **响应里没有也不可能有私钥**。
可能的失败：`400 BAD_NAME`（名称必填 ≤80 字）、`400 BAD_PUBLIC_KEY`、`400 BAD_SCOPES`（至少 1 个）。

### 4.2 轮换公钥（私钥疑似泄露时的应急动作）

```
PUT /api/integration-accounts/{id}/public-key      （系统管理员）
{ "publicKey": "<新 PEM>" }
→ 200 { message: "公钥已轮换，旧公钥立即失效" }
```

**旧公钥立即失效**，不需要重启，也不改变 `keyId`。

### 4.3 撤销账户

```
DELETE /api/integration-accounts/{id}              （系统管理员）
→ 200 { message: "服务账户已撤销，后续请求立即被拒绝" }
```

**实测行为（务必对齐 Consumer 的容错预期）**：

- 撤销**同一进程内立即生效，无需重启**。
- 撤销后，即使签名与票据**都完全合法且未过期**，也返回 `401 BAD_SERVICE_ACCOUNT`。
- 已撤销的 `keyId` **不会自动复活**；重新登记同一把公钥会得到**新的 `keyId`**（新账户）。

> 这些都有断言锁定：`L1-14.1 / 14.2 / 14.3 / 14.4 / 14.5`（见 `PROVIDER_TEST_REPORT.md`）。

### 4.4 推荐的轮换流程（不停机）

1. Consumer 生成**新密钥对**，把**新公钥**交给 Provider 登记 → 得到 `keyId_new`。
2. Consumer 适配器切到 `keyId_new`（旧 `keyId_old` 仍在有效期内可用，可灰度）。
3. 确认新链路稳定后，Provider `DELETE /api/integration-accounts/{keyId_old}`。
4. 双方核对审计日志中的 `serviceAccountId` 切换时间点。

---

## 5. 非敏感配置键名（**仅键名与含义，值不在此文档**）

### 5.1 Provider 侧（由 Provider 运维持有）

| 环境变量 | 含义 | 建议 |
|---|---|---|
| `OA_INTEGRATION_ENABLED` | 集成总开关 | 联调环境设 `1`；**默认 `false`** |
| `OA_INTEGRATION_SIGNING_KEY` | 票据 HMAC 密钥 | **生产必须显式注入**；未设则进程内随机（重启失效）。值**绝不出现在本文档/版本库** |
| `OA_INTEGRATION_ALLOWED_BRANDS` | 允许的品牌上下文白名单 | 联调建议 `VFIB,UCARD`；留空 = 不限但每次仍须显式给 `brandId` |
| `OA_INTEGRATION_RATE_LIMIT_PER_MINUTE` | 每服务账户每分钟请求上限 | 默认 240 |
| `OA_INTEGRATION_TICKET_MAX_SECONDS` | 票据最大有效期（秒） | 默认 900 |

### 5.2 Consumer 侧需要知道的（键名，非密钥）

| 键 | 示例值 | 说明 |
|---|---|---|
| `baseUrl` | `http://<provider-host>:<port>` | 由 Provider 提供；**仅测试环境** |
| `keyId` | `svc_xxxxxxxx` | 登记后由 Provider 提供 |
| `privateKeyPath` | 本地路径 | **私钥只存在于 Consumer 侧**，不进任何交接包 |
| `brandId` | `VFIB` / `UCARD` | 每次取票与调用都必须与签名主体一致 |
| `correlationIdHeader` | `x-vfib-correlation-id` | 贯穿双方日志 |
| `pollIntervalSeconds` | `60` | 与 `/health` 的 `pollIntervalHintSeconds` 对齐 |

---

## 6. 请求样例（**已脱敏**）

### 6.1 取票据（服务账户身份）

```http
POST /api/integrations/marketing/tickets HTTP/1.1
Host: <provider-host>
Content-Type: application/json
x-vfib-key-id: svc_xxxxxxxx
x-vfib-timestamp: 1791892881
x-vfib-nonce: 3f9c1a7b2e5d8046a1c3e2f7
x-vfib-signature: <REDACTED — base64 Ed25519 签名>
x-vfib-correlation-id: mos-run-2026-10-13-0001

{ "userId": "u_xxxxxxxx", "brandId": "VFIB",
  "purpose": "月度内容任务：素材检索",
  "scopes": ["knowledge.search","assets.search","assets.read"] }
```

### 6.2 检索（携带票据）

```http
POST /api/integrations/marketing/knowledge/search?nocache=1 HTTP/1.1
Content-Type: application/json
x-vfib-key-id: svc_xxxxxxxx
x-vfib-timestamp: 1791893002
x-vfib-nonce: 8b41d0c6f2a93e77b5c1d408
x-vfib-signature: <REDACTED>
x-vfib-ticket: <REDACTED — base64url(payload).base64url(HMAC)>

{ "query": "品牌主视觉规范", "topK": 10 }
```

> 注意 URL 上的 `?nocache=1`：它**参与 URL** 但**不参与签名**（见 §1.3 第 2 点）。
> 被签名的 `pathname` 只是 `/api/integrations/marketing/knowledge/search`。

### 6.3 成功响应

```json
{
  "ok": true,
  "data": { "query": "品牌主视觉规范", "items": [ /* … */ ], "total": 3 },
  "error": null,
  "request_id": "mos-run-2026-10-13-0001",
  "policy_version": "1.0"
}
```

### 6.4 失败响应（形状不同，注意 `error.code`）

```json
{
  "ok": false,
  "data": null,
  "error": { "code": "TICKET_ACCOUNT_MISMATCH", "message": "票据不是由当前服务账户签发" },
  "request_id": "req_mv6mr83mf5e9742c",
  "policy_version": "1.0"
}
```

⚠ **不要**照搬本仓库普通 OA 路由的形状（`{ok:false, error:"消息", code:"CODE"}`，
`code` 在**顶层**）。集成侧一律 `error.code`。

---

## 7. 安全连通指导

1. **不外网裸露。** 集成接口设计前提是内网/专线可达。Provider 侧只监听内网地址；
   Consumer 侧适配器应配置**出站白名单**只允许 `<provider-host>:<port>`。
2. **TLS。** 本版本 Provider 进程本身**不终结 TLS**（由前置反向代理承担）。
   跨主机联调必须经 TLS 终结；证书校验**必须开启**。**同机回环（127.0.0.1）为明文 HTTP。**
   > ⚠ 这一点属**未验证项**：本包未验证任何线上 TLS/证书配置，见 `PROVIDER_BLOCKERS.md` B-05。
3. **时钟。** 签名时间窗 ±300s。双方须启用 NTP；时钟漂移超过窗口会得到
   `401 TIMESTAMP_OUT_OF_WINDOW`（不是签名错误，别误判为密钥问题）。
4. **nonce 管理。** 每次请求必须唯一；不要用递增计数器替代（会与重放窗口冲突）。
   重试**必须重新签名并换 nonce**。
5. **重试策略。** 已知可安全重试：`503`、`429`（按 `Retry-After` 或指数退避）。
   `401` / `403` 重试无意义（应先刷新票据或修正 scope）。
   `409` 需按错误码分支（`REVIEW_REQUIRED` 补复核、`ASSET_CONFLICT` 转人工）。
   **入库推送（`/artifact`）用同一 `idempotencyKey` 幂等重试，绝不换键。**
6. **故障时的 fail-closed。** 网络不可用时 Consumer **必须拒绝新的权威授权调用**，
   **不得**静默沿用本地缓存的「上一次 Approved 结果」。撤回/Skill 失效必须以
   `410 ASSET_GONE` 为准立即清缓存。
7. **审计关联。** 所有调用请带 `x-vfib-correlation-id`；Provider 侧审计记录含
   `serviceAccountId / endpoint / status / userId / brandId / purpose`，
   可按该 ID 双向对账。

---

## 8. 交接包内**没有**的东西（明确声明）

本交接包**绝不包含**：

- ❌ 任何私钥（Ed25519 私钥、TLS 私钥）
- ❌ `OA_INTEGRATION_SIGNING_KEY` 的值（票据 HMAC 密钥）
- ❌ 任何真实用户口令、会话 cookie、Bearer token
- ❌ 生产地址、生产数据库、生产日志

本包**包含**：

- ✅ 公钥指纹（`056381af8b7eccb4`）—— 仅用于对账
- ✅ 协议与头名、`canonicalString` 契约、错误码语义
- ✅ 脱敏后的请求/响应样例
- ✅ 合成测试身份与夹具说明（见 `TEST_FIXTURES.md`）
