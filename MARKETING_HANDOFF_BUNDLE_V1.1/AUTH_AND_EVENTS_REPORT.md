# AUTH_AND_EVENTS_REPORT.md —— 双重身份认证 与 变更事件消费

> 交付包：`MARKETING_HANDOFF_BUNDLE_V1.1/`
> 依据：B 包 B2（双重身份）+ B3（事件消费）+ `03_HANDOFF_AND_REPORT.md` 第 4 项
> 对应验收：`INT-02`、`INT-03`、`INT-04`、`INT-07`
> 日期：**2026-10-13**

---

## 1. 双重身份模型（为什么是「两把钥匙」）

| 身份 | 载体 | 作用 | 可否代签最终审批 |
|---|---|---|---|
| **① 服务身份** | Ed25519 四头签名<br>`x-vfib-key-id` / `x-vfib-timestamp` / `x-vfib-nonce` / `x-vfib-signature` | 证明「是哪个系统在调用」；对应服务账户与 `serviceScope` | ❌ **不可** |
| **② 用户上下文** | 受限 HMAC 票据 `x-vfib-ticket` | 证明「代表哪个真实员工在做事」；票据**绑人**、有 scope、有 TTL | 分 `kind` |

**为什么必须两把**：服务账户是**机器**身份，无法代表人作出授权决策。
Provider 的最终审批要求 `kind === 'session'`（本人会话票据），因此**服务身份在结构上无法伪造通过**。

---

## 2. 签名实现（与 Provider `lib/integration/service-accounts.js` 同构）

### 2.1 canonicalString（7 段）

```js
['v1', keyId, METHOD, pathname, timestamp, nonce, sha256(body原始字节)].join('\n')
```

**易踩坑（本侧实测踩中并修正）**：

| 坑 | 后果 | 本侧处置 |
|---|---|---|
| **`pathname` 不含 query** | 把查询串拼进 `pathname` 签名 → `401 BAD_SIGNATURE` | `signedHeaders()` 只用无 query 的 pathname；url query 单独拼接（D4-37 实测 410 正确返回） |
| **时间戳单位是秒** | 传毫秒 → `401 TIMESTAMP_OUT_OF_WINDOW` | `Math.floor(Date.now()/1000)`；Provider 窗口 `±300s`（`signatureWindowSeconds`） |
| **无体请求的 bodyHash** | 必须 `sha256('')`，不是空字符串 | `EMPTY_BODY_HASH` 常量 |

### 2.2 密钥存储（**硬约束**）

| 规则 | 实现 |
|---|---|
| 私钥**绝不**出现在浏览器 | 私钥只经环境变量注入 Node 进程；前端零接触 |
| 私钥**绝不**出现在日志 | 证据脱敏正则（`SECRET_KEY_RE`）覆盖 `privateKey` / `signingKey` / `ticket` / `authorization` / `cookie` / `password` / `apiKey`；长 base64 串再兜底一层 |
| 用户凭据**绝不**落盘 | MOS 侧只存口令 scrypt 哈希；**不存**任何资料库用户凭据 |
| 票据密文只在内存 | 落盘只存**非机密元数据**（`ticketKey` / `expiresAt` / `scopes`），明文票据在内存 Map |

**证据**：`dual` 套件 `D-14` 断言落盘文件中**不含**票据明文，且元数据行无 `ticket` 字段。

---

## 3. 受限用户票据

### 3.1 生命周期

| 环节 | 实现 |
|---|---|
| 换取 | `POST /tickets`（服务签名 + `tickets.issue` 服务 scope） |
| 缓存键 | `keyId|brandId|userId` —— **跨账户、跨品牌绝不复用**（`D-13`） |
| TTL | `ticketTtlSeconds = 300` |
| 临期刷新 | `ticketRefreshSkewSeconds = 60` |
| **并发单飞** | 同 key 并发请求只发**一次**换票出站（`D-12`：5 并发 → 1 次出站、4 次 coalesced） |
| 丢弃 | `dropTicket()` / `dropAllTickets()`；`cachedTicket()` 立即失效（`D-15`） |
| **401 回退** | `TICKET_*` / `SCOPE_NOT_GRANTED` → 丢弃 + 重新换票 + **只重试一次**（`D-18`）；签名/账户类 401 **不重试**（`D-19`） |
| 票据密钥未配置 | Provider 侧进程内随机 → 重启后全失效 → `401 TICKET_BAD_SIGNATURE`。**这是可恢复事件，不是服务故障**（提供方 P2-1 / D-09.4） |

### 3.2 用户映射（**绝不猜测**）

`workspace.userMap`（MOS `userId` → 资料库真实 `userId`）。
`resolveProviderUser()` 是**单一事实来源**；未映射时：

- **如实拒绝**，返回 `NO_PROVIDER_USER_MAPPING`；
- **零出站**；
- **绝不**用服务身份顶替，**绝不**猜测。

**证据**：双系统 D4-26（未映射用户同步 → `NO_PROVIDER_USER_MAPPING`）；`D4-13b`（四个合成身份登录基线）。

> ⚠ 本侧实测修正：`asset-usage-check` 与事件轮询早期把 **MOS 的 `user.id` 直接当作 Provider 用户 ID** 发出去
> → Provider 返回 `404 USER_NOT_FOUND`，**极易被误读成「资产不存在」**。现已统一走 `resolveProviderUser()`。

---

## 4. 最终审批的**三重闭合**（不可代签）

| 层 | 措施 |
|---|---|
| ① **出站前剔除** | `serviceGrantable()` 把 `admission.final.decision` 从服务票据的可授予 scope 中**剔除**；`ensureTicket()` 在**出站前**即剥离并记入 `strippedScopes`（`D-10` 断言出站请求的 `scopes` 里没有它） |
| ② **Provider 侧兜底** | 端点强制 `kind === 'session'`；用常规服务票据打该端点 → **`403 TICKET_KIND_MISMATCH`**（双系统 D4-30 实测） |
| ③ **本侧结构性恒拒** | `workspace-client.finalDecision()` **不提供**服务身份代签路径，直接 `ok=false / httpStatus=403`（`D4-30b` 实测） |

**双系统实测**：D4-30 同时验证「索取 `admission.final.decision` 被剔除」**且**「用服务票据打最终审批 → 403」；
最终审批只能由**被显式授权的本人会话**完成（D4-31 签票 → D4-32 `FINAL_APPROVED`）。

---

## 5. 变更事件消费（B3）

### 5.1 六条硬约束

| # | 约束 | 实现 |
|---|---|---|
| ① | **独立轮询作业** | `eventconsumer`，单实例锁（`ownerId/pid/heartbeatAt`，10 分钟陈旧即让位），默认**关闭**（需显式开启） |
| ② | **持久化 seq 游标** | `db.library_event_cursors`（按品牌）；进程重启**续传**，不从 0 重放 |
| ③ | **断线重试** | 有界重试；连续失败 **≥2 → `degraded=true`** |
| ④ | **事件幂等** | 按 `(brandId, seq)` 去重（`processedSeqs` 滚动窗口） |
| ⑤ | **按品牌处理** | 4 类品牌业务事件只作用于该品牌；3 类全局事件作用于全部品牌 |
| ⑥ | **`truncated:true` 全量重验** | 清空事件累积的失效登记 + 游标重置到 `oldestCursor` + 清空重放集合 + 清「需对账」位 |

### 5.2 事件类型与处理动作（7 条字面量全部实现）

| 事件 | 本侧动作 |
|---|---|
| `asset.revoked` / `asset.deprecated` | 登记失效 + **本地引用置 `INVALIDATED`** |
| `skill.version.changed` | 登记失效（旧版本缓存不得再用） |
| `permission.changed` | **丢弃全部票据**（scope 可能已变）+ 该品牌全部引用失效 |
| `service_account.changed`（**下划线**） | **丢弃全部票据**（票据与签发账户绑定） |
| `policy.version.changed` | 记录版本号（供对账） |
| `admission.state.changed` | 记录申请 ID（供对账） |
| **未识别类型** | 置位 `reconcileRequired`（**要求一次全量对账**）+ 记入 `unhandledTypes`；**不静默忽略**（提供方 D-02 约定） |

### 5.3 fail closed

| 情形 | 本侧行为 |
|---|---|
| 集成未配置 / 出站守卫不放行 | **零出站**拒绝（`tick` 直接 `skipped`） |
| 事件流连续失败 ≥2 | `authoritativeUsable(brand).usable = false` → **拒绝新的权威授权调用** |
| degraded 下的使用前验证 | **不出站即拒**（`EVENT_STREAM_DEGRADED`）——**绝不静默沿用过期 Approved 缓存** |
| `410 ASSET_GONE` | 立即登记 `asset.revoked` + 失效本地引用 |
| `404 NOT_FOUND`（非治理身份视角） | 立即登记 **`asset.not_found`**（单列一类，**不与撤回混记**）+ 失效本地引用 |
| 60s 轮询间隔 | **只是建议刷新间隔，不是撤回时延 SLA**；关键动作一律走 `verifyAssetUsable()` 实时重验 |

---

## 6. 测试命令与证据

```bash
bash tools/run-mos-tests.sh dual       # B2/B3 专项（离线桩，51/51）
bash tools/run-mos-tests.sh sec        # 安全套件
node tools/mos-e2e-build04-dual.js     # 双系统真实 HTTP（64/64）
```

| 分组 | 断言 | 覆盖 |
|---|---|---|
| `L1` 出站收敛 | `D-01`–`D-06` | 非回环必须 https；白名单留空即拒绝；回环明文需显式开关且**生产一律拒绝** |
| `L2/L3` 票据与重试 | `D-07`–`D-20` | 缓存、单飞、跨账户不复用、落盘脱敏、429 有界重试、401 换票只重试一次、签名类不重试 |
| `L4` 准入三步 | `D-21`–`D-24e` | 未配置零出站；`create>submit>artifact` 严格顺序；`reviews[]` 真实携带；缺 `fileName`/`reuseScope` 零出站拒绝；检索参数落在 body |
| `L5` 最终审批边界 | 结构性 | `finalDecision()` 恒拒、scope 出站前剥离 |
| `L6` 事件消费 | `E-01`–`E-21` | 幂等、失效、游标、`truncated`、`degraded`、未知类型对账位、410 即时失效 |
| `L7` 轮询作业 | `E-17`–`E-21` | 默认关闭、单实例锁、状态不外泄机密 |

**双系统实测对照（`INT-02` / `INT-03` / `INT-07`）**：

| 断言 | 结果 |
|---|---|
| D4-06 本侧签名被 Provider 真实验签通过 | ✅ 200 |
| D4-07 **伪造签名**被拒 | ✅ `401 BAD_SIGNATURE`（证明 D4-06 不是桩返回） |
| D4-08 能力声明不夸大（`publishedContentArchive=false`） | ✅ |
| D4-30 服务票据越权 → 双重拒绝 | ✅ 剔除 + `403 TICKET_KIND_MISMATCH` |
| D4-31/32 本人会话最终审批 | ✅ 签票 200 → `FINAL_APPROVED` |
| D4-35 使用前重新验证 | ✅ `PROVIDER_VERIFIED` |
| D4-37 / 37b 撤回后两种视角 | ✅ 治理 `410 ASSET_GONE` / 普通 `404 NOT_FOUND` |
| D4-38/39 事件轮询 + 失效登记 | ✅ `items=14`，`asset.revoked:VFIB-ASSET-2026-0001` |
| D4-40 撤回后使用前验证 | ✅ `INVALIDATED_LOCALLY`，**零出站** |

---

## 7. 未完成 / 未验证

| 项 | 状态 | 说明 |
|---|---|---|
| 跨主机 TLS 终结 | `NOT_RUN` | 本轮为回环直连（`allowLoopbackHttp` 显式开启，且**生产一律拒绝**） |
| 线上域名反代下 `Origin`/`Host` 同源 | `NOT_RUN` | 需真实域名环境（`auth.allowedOrigins` 已有配置位） |
| 服务账户轮换实操 | `NOT_RUN` | 机制已实现（`service_account.changed` 会丢弃票据），本轮未做真实轮换演练 |
| 票据吊销（Provider 侧主动吊销） | `NOT_RUN` | Provider 未提供主动吊销端点；本侧依赖 `401 TICKET_*` 或 `service_account.changed` 事件 |
