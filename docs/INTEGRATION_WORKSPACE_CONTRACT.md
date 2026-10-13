# Marketing OS ↔ Enterprise Workspace 集成适配说明（A-06）

> 本文件描述 **Marketing OS 侧**对企业资料库（Enterprise Workspace）集成契约的**实现与启用方式**。
> 契约权威在 Workspace 侧：`INTEGRATION_API_CONTRACT.md`（契约版本 `1.0`，应用版本 **V1.1.7**）。
> 本侧实现：`lib/mos/workspace-contract.js`（逐字节契约）+ `lib/mos/adapters/workspace.js`（调用方适配器）。

## 0. 诚实性声明（务必先读）

| 项 | 状态 |
|---|---|
| 契约常量 / 签名算法 / 错误码表 / 封套解析 | **已实现并离线自检通过**（`tools/mos-workspace-contract-test.js`，**36** 断言） |
| 请求形成正确性（GET query 不参与签名、原始字节哈希、票据头、防重放 nonce） | **已通过本地桩 Workspace 验证**（桩按契约逐条复刻验签流程） |
| **与真实 Enterprise Workspace 的联调** | **NOT_VERIFIED** — 无可用服务与凭据，**未发生任何真实调用** |
| 服务账户能否产生最终审批 | **不可能**（契约 §1.2 双重闭合；本适配器 `finalDecision()` 恒拒绝并被自检断言） |

> 按整改 A-06 原文：「没有可用服务时只交付可测适配器和 Mock，**禁止声称联调成功**」。
> 上述 `NOT_VERIFIED` 项在交付报告中保持原状，不做粉饰。

### 0.1 2026-10-13 按 Workspace V1.1.7 实取源码做的符合性修正（6 项）

| 编号 | 修正 | 说明 |
|---|---|---|
| C-01 | 事件类型 `service.account.changed` → **`service_account.changed`** | `events.js` 用下划线，原实现永远失配 |
| C-02 | 补事件类型 **`skill.version.changed`** | §F 正式 Skill 版本变更事件；缺失会静默忽略 Skill 版本变化 |
| C-03 | 错误码表补 **6 项**（`BAD_ADMISSION_INPUT` / `USER_NOT_FOUND` / `BAD_PUBLIC_KEY` / `BAD_SCOPES` / `BAD_NAME` / `ERROR`） | 此前落 `unknown`，可重试性判断失真 |
| C-04 | 新增枚举常量（A01–A08 / 01–07 资料区 / 四级密级 / 许可状态 / 复用范围 / AI 策略） | 逐字对齐 `asset-policy.js`、`library-nav.js` |
| C-05 | `knowledgeSearch` 改发 **`topK`**（`limit` 保留为兼容别名） | 服务端读取 `body.topK`，**不读 `limit`** |
| C-06 | `assetsSearch` 支持 **`offset`** 与 `categoryId`/`subcategoryId`/`marketingCategory`；`createAdmission` 增加**出站前同构预校验** | 服务端以 `body.offset` 分页；准入必填字段缺失时**本地拒绝、零出站** |

> 上述均为**本侧对既有契约的符合性修正**，**未改动共享契约语义**。
> 与资料库侧的任何语义分歧记录在 `MARKETING_HANDOFF_BUNDLE/CONTRACT_DIFF.md`（**待双方签署**）。

## 1. 为什么是「两层认证」

Marketing OS 是**受控调用方**，不是平等的联合系统。一次调用必须同时通过：

1. **服务身份**：Ed25519 请求签名（私钥只在 Marketing OS 一侧；Workspace 只登记公钥 → 库泄露也无法冒充）。
2. **用户身份**：`x-vfib-ticket` 受限票据（回答「这次操作是替**哪个真实用户**做的」）。

所有业务权限判定**一律以票据解析出的真实用户为主体**；服务账户的 scope **只**决定「能不能进这个门」。
因此「给 Marketing OS 服务账户授过权」**不会**自动变成「给其背后每个用户授过权」。

## 2. `canonicalString`（必须逐字节一致）

```
v1\n<keyId>\n<METHOD 大写>\n<pathname>\n<timestamp>\n<nonce>\n<sha256(body) 小写 hex>
```

三个必须注意的点（契约 §1.1，均已在本侧实现并被自检覆盖）：

| 点 | 说明 | 本侧处理 |
|---|---|---|
| ① | **GET / 无体请求** body 视作空 → `sha256('')`（不是 `sha256('{}')`） | `bodyHashOf('')`；常量 `EMPTY_BODY_HASH` 已断言 |
| ② | **`pathname` 不含 query string** | `signedHeaders()` 遇到 `?` **直接报错**（不静默截断） |
| ③ | **不重新序列化 JSON**：服务端哈希的是收到的**原始字节** | 签名与发送使用同一份字符串字节（`sendBody`） |

## 3. 适配器能力（`lib/mos/adapters/workspace.js`）

| 方法 | 契约端点 | 票据 kind | 说明 |
|---|---|---|---|
| `health()` | `GET /health` | — | 能力与限制声明；未接入返回 503（区分「关闭」与「故障」） |
| `issueServiceTicket()` | `POST /tickets` | — | 签发票据；**本地即剔除 `admission.final.decision`** 并可审计 |
| `knowledgeSearch()` | `POST /knowledge/search` | service | `snippet` 逐文档判定，可能被扣留并给出 `withholdReason` |
| `assetsSearch()` | `POST /assets/search` | service | 仅「可复用 + 有效 + 对该主体授权」的元数据 |
| `getAsset()` | `GET /assets/:id` | service | 不可探测（不存在/无权同响应 404）；已失效返回 410 |
| `createAdmission()` | `POST /admissions` | service | 幂等键；**申请 ≠ 资产** |
| `submitAdmission()` | `POST /admissions/:id/submit` | service | **必须带 `reviews[]`**，不接受「提交即通过」 |
| `pushArtifact()` | `POST /admissions/:id/artifact` | service | 未最终审批时如实返回 `409 FINAL_APPROVAL_REQUIRED` |
| `getAdmission()` | `GET /admissions/:id` | service | 脱敏 `publicView` |
| `getSkill()` | `GET /skills/:id` | service | 契约文档 §4.1 未列出，但**源码注册表存在**，故一并实现 |
| `changes()` | `GET /changes` | service | 游标为单调 `seq`；`truncated=true` 显式标志，不静默丢事件 |
| `finalDecision()` | — | **session** | **结构性恒拒绝**：服务账户无最终审批权 |

### 3.1 明确不提供的能力

- **`finalDecision`**（服务侧）：最终审批**只能**由用户在 Workspace 侧以**本人会话票据**完成。
- **Published Content 归档 / 发布成品镜像**：只在 Marketing OS（契约 §8；`capabilities.publishedContentArchive` 恒为 `false`）。

## 4. 启用步骤（运维）

1. 在 Workspace 侧登记服务账户：`POST /api/integration-accounts`（`name` / `publicKey`(PEM) / `scopes[]`）。
   - 建议最小 scope：`knowledge.search`、`assets.search`、`assets.read`、`admissions.write`、`admissions.read`、`changes.read`、`skills.read`、`tickets.issue`。
   - **不要**期望该账户获得 `admission.final.decision` —— 该范围不在服务账户 scope 表内。
2. 在 Marketing OS 侧配置（`config.json` 的 `mos.workspace` 或环境变量）：

   ```jsonc
   "workspace": {
     "enabled": true,
     "baseUrl": "https://workspace.internal",
     "keyId": "svc_xxxxxxxx",
     "privateKeyPath": "/etc/vfib-mos/workspace-ed25519.pem",  // 或 privateKeyPem
     "ticket": "<由 Workspace 签发的服务票据>",
     "timeoutMs": 15000
   }
   ```

   ⚠ `privateKeyPem` / `privateKeyPath` / `ticket` **只在服务端**；不得提交进版本库、不得写入日志/导出物。
3. 自检：`node tools/mos-workspace-contract-test.js`（离线，永远可通过）；
   `bash tools/run-mos-tests.sh workspace` 纳入统一入口。
4. 观察运行状态：`GET /api/mos/workspace/status`（**只读，零出站，不回传凭据**）。

## 5. 失败处理原则（调用方）

- 判 `error.code`（稳定），**不要**判 `error.message`（措辞可变）。
- `error.data` 在失败时恒为 `null`；若看到非 null 的 `data`，说明封套被破坏 → 视为不可信。
- 可重试：`RATE_LIMITED`、`TICKET_EXPIRED`、`FINAL_APPROVAL_REQUIRED`（审批完成后重推）、超时/网络错误。
- **不可**重试：`BAD_SIGNATURE`、`BRAND_MISMATCH`、`SCOPE_NOT_GRANTED`、`TICKET_KIND_MISMATCH`、
  `ASSET_IMMUTABLE`（母版版本演进必须走**新的**准入申请 + 重新独立最终审批）。
- 收到 `410 ASSET_GONE` → 营销侧立即清缓存。

## 6. 权威文件索引（Workspace 侧）

| 主题 | 文件 |
|---|---|
| 契约正文 | `INTEGRATION_API_CONTRACT.md` |
| 请求签名与票据 | `lib/integration/service-accounts.js`、`lib/integration/tickets.js` |
| 变更事件流 | `lib/integration/events.js` |
| 集成端点 | `lib/routes/integrations.js` |
| 准入状态机 | `lib/asset-policy.js`、`lib/asset-admission.js` |
| 自检 | `tools/integration-test.js` |
