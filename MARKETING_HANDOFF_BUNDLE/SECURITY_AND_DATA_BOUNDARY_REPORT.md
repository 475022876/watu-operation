# SECURITY_AND_DATA_BOUNDARY_REPORT.md —— 安全与数据边界报告

> 对应 `02_MARKETING_OS_CODEX_TASK.md` **Phase M4** 交付项，并覆盖 `03_SHARED_CONTRACT_AND_ACCEPTANCE.md` **INT-12**。
> 基线提交 `3c19e79` ｜ 观测时间 **2026-10-13 19:5x（GMT+8）** ｜ 环境：本机隔离实例（非生产）

---

## 1. 认证与会话（实测）

| 项 | 实现 | 证据 |
|---|---|---|
| 凭据载体 | **HttpOnly Cookie `mos_sid`**；令牌**绝不**出现在响应体 | `lib/mos/routes/auth.js` 头部注释与实现 |
| 会话有效期 | `maxAge = 12 * 3600`（12 小时） | `lib/mos/routes/auth.js:20` |
| CSRF | **双提交令牌**：Cookie `mos_csrf` 必须与请求头 `x-mos-csrf` **定时安全比较**一致 | `lib/security.js:215-225`（`timingSafeEqual`） |
| Cookie 属性 | `HttpOnly` / `SameSite` / `Secure`（`auto\|always\|never`，默认 `auto`） | `lib/security.js:234`、`lib/config.js:44-50` |
| 登录限速 | **20 次 / 10 分钟**（服务端强制） | `lib/mos/routes/auth.js:75` |
| 口令存储 | **scrypt + 16 字节随机盐**，定时安全比较；**不可逆推** | `lib/password.js:11-20` |
| 口令基线 | **「至少 8 位」三处一致强制**：重置工具、登录改密、新建账号 | `tools/mos-reset-password.js`、`identity.changePassword()`、`identity.upsertUser()` |
| 首登强制改密 | 存在闸门 | `ui` 断言 + `02-force-password.png` |
| 会话落盘 | **创建即同步落盘**（不依赖合并窗口） | `ENV-06 ★会话在登录后立即落盘` |

## 2. 授权模型

| 项 | 实现 | 证据 |
|---|---|---|
| RBAC | 角色 → 权限集；`assertCan(principal, perm, brandCode, …)` | `lib/mos/rbac.js` |
| 品牌级 ABAC | `assertBrand` / `assertSameBrand` | `lib/mos/rbac.js` |
| **跨品牌一律 404**（非 403） | 防止通过状态码枚举品牌数据是否存在 | `AN-02`、`SEC-03`、`GOV-03`、`GOV-04` |
| 无角色账号 | **默认拒绝（fail closed）** | `无角色账号默认拒绝（fail closed）` |
| 越权留痕 | 每次越权尝试写 append-only 审计 | `SEC-01-d`、`E2E-02m2` |
| 审计不可改写 | `db.audit_events.push(...)` 仅追加；metadata 已脱敏 | `lib/mos/audit.js`、`GOV-05` |

## 3. 三条独立审批链与分权（INT-04）

| 链 | 权限 | 关键分权断言 |
|---|---|---|
| `PROFESSIONAL_REVIEW` 专业审核 | 审核链权限 | `E2E03-06`、`E2E03-08` |
| `PUBLICATION_APPROVAL` 发布审批 | 发布链权限 | `E2E03-09`、`E2E03-11` |
| `ASSET_ADMISSION` 资产入库最终审批 | **`library.asset.approve.final`（独立特权）** | `SEC-01-a`（无该权限 → 403）、`SEC-01-b`（资产预检员被拒）、**`SEC-01-c`（技术管理员 `MOS_ADMIN` 不自动获得该特权 → 403）**、`SEC-01-d`（留痕） |
| 职责分离 | 提交人不能批自己的申请 | `SEC-01-e`（403）+ `SEC-01-e2`（正向对照） |

> **结论**：`admin` / `P1` / 服务身份**均不能**绕过最终入库审批（`INT-04` 的本侧部分 **PASS**）。
> **但**：资料库侧的最终批准**必须由真实授权用户交互完成**，本侧 Mock 下**无法验证跨系统实际入库**（`INT-05` BLOCKED）。

## 4. 出站安全（SSRF 加固，`sec` 17/17）

| 防护 | 断言 |
|---|---|
| 出站拒绝矩阵：**回环 / 私网 / 云元数据 / IPv6（含 IPv4-mapped）/ 非白名单 / `http` / 非标准端口** 全部拒绝 | `SEC-11` |
| **DNS 重绑定**：连接固定绑定**已校验 IP**，解析器不再被二次调用 | `SEC-12` |
| **逐跳重定向校验**：同源合法跳转放行；非白名单 / 云元数据 / 私网 / 超次数一律拒绝 | `SEC-13a…13e` |
| 压缩炸弹：不解压，直接拒绝 | `SEC-16a` |
| 体积上限：超限即截断拒绝 | `SEC-16b` |
| 上游 5xx：**如实返回失败**（`ok=false, items=[]`），不伪造成功 | `SEC-14a` |
| 私网端点：**判定阻断，不发起任何请求** | `SEC-14b` |
| **提示注入**：外部网页中的指令文本按**普通数据**处理，进入条目但不产生任何指令副作用；URL 追踪参数被剥离 | `SEC-15a/b/c` |
| **生产模式**：测试放行开关（`MOS_EGRESS_ALLOW_HTTP` / `MOS_EGRESS_ALLOW_LOOPBACK`）**一律失效** | `SEC-11b`、`SEC-11c` |

## 5. 密钥与凭据边界（**关键**）

| 规则 | 实现与证据 |
|---|---|
| 资料库私钥/票据**只在服务端** | `adapters/workspace.js` 仅服务端模块；`status()` 只报布尔与主机名；`WC-28` 断言序列化不含 PEM/票据原文 |
| 前端**无**任何资料库凭据或直连代码 | `public/mos/js/**` 无 workspace 适配器引用 |
| 模型密钥只在服务端 | `PC-05`、`PC-06`；`SEC-07-a` 断言 bundle 与 API 响应不含密钥字面量 |
| **`privateKeyPem` / `privateKeyPath` / `ticket` 不入版本库、不入日志、不入导出物** | `docs/INTEGRATION_WORKSPACE_CONTRACT.md` §4 明示；`.gitignore` 覆盖 `data/`、`config.json` |
| 渠道登记**拒绝任何密码/令牌字段** | `SEC-04-d SECRET_NOT_ALLOWED` |
| 渠道 URL **强制 HTTPS** | `SEC-04-e` |
| 审计 metadata 脱敏 | `GOV-05 不含 password/token 明文` |

## 6. AI 外发数据边界（fail closed）

| 规则 | 断言 |
|---|---|
| `RESTRICTED` **在调用 Provider 之前**阻断 | `SEC-10-a`（作业 `BLOCKED`）、`SEC-10-b`（无 `providerJobId`、无产物） |
| 未知数据分级 → `400 BAD_DATA_CLASS`，不静默降级 | `SEC-10-c` |
| 阅读权 ≠ 外发授权（资料库侧同构：`canSendToExternalAI()` 独立授权） | 契约 `assets/search` 返回 `externalAiTransferPolicy`；本侧**不得**强制把 Approved 视为可外发 |
| 检索正文扣留 | `WC-23`：`snippet=null` + `contentWithheld=true` + `withholdReason`；整篇外送被禁 |

## 7. 数据边界（业务红线，代码级）

| 边界 | 状态 | 证据 |
|---|---|---|
| **Published Content 只在 Marketing OS 归档** | ✅ | `publishing.js` 对资料库适配器**零引用**；快照落 `uploads/published/<pubId>/`；`A06-02` 断言 `publishedContentArchive=false` |
| 资料库**不自动镜像**本侧发布成品 | ✅（结构性） | 同上；契约 §8 |
| 「发布归档 ≠ 资料库入库」 | ✅ | `docs/MOCK_REAL_MATRIX.md` §2 第 10 条；`SEC-09-a` |
| VFIB / U CARD **分离** | ✅ | `SEC-03`、`SEC-03b/c/d/e`、`E2E03-18` |
| **八工作中心保留** | ✅ | `app.js CENTERS` = 8；`ui` 逐中心断言 |
| S05 / 品牌声誉 / 线索移交 / 代理佣金 / 自动社媒发布 **未建设** | ✅ | 全仓库检索：相关词仅出现在「明确排除」声明；**无菜单、无数据、无入口** |
| 未批准 Skill 不得 `EFFECTIVE`、不得正式输出 | ✅ | `E2E03-18`；`outputIntent` 失效关闭 |

## 8. 备份与恢复（演练）

| 项 | 说明 |
|---|---|
| 数据形态 | **单一 JSON 文件** `data/mos.json`（schema v4） |
| 写入原子性 | **唯一 tmp 文件 + `renameSync`** → 进程中断不会产生半写文件 |
| 既有备份 | `data/mos.json.bak-20261011-214010`、`-215314`、`-20261012074459`、`-20261013-173859`（口令变更前备份） |
| 恢复方式 | 停服 → 用 `.bak` 覆盖 `data/mos.json` → 启动（**回滚会丢失备份之后的写入**） |
| 迁移 | v1→v4 **只增不改**、幂等；已迁移集合**绝不复活**（避免用户清空后被写回） |
| **未演练** | ⚠ 本轮**未**做「生产级」备份恢复演练（无生产环境）；仅验证了本地备份文件存在与格式可读 |

## 9. 本轮新增的安全相关变更

| 变更 | 性质 | 说明 |
|---|---|---|
| 准入入参**出站前同构预校验** | 加固 | 缺必填字段即本地拒绝 + `missing[]`，**零出站**（避免向服务端发送必然被拒的请求，减少无效出站面） |
| 事件类型 / 错误码表按实源码修正 | 正确性 | 使「撤回 / Skill 版本变化」事件可被正确识别 → 支撑 INT-06 的 fail-closed 前提 |
| `knowledgeSearch` 改发 `topK`；`assetsSearch` 支持 `offset`/过滤 | 正确性 | 消除"服务端忽略入参"的静默语义偏差 |

## 10. 未完成的安全依赖（BLOCKED）

| 项 | 阻断原因 |
|---|---|
| 服务账户签名/票据的真实**伪造 / 重放 / 过期 / 撤销**测试（INT-02/03） | 无真实服务与凭据 |
| 资产**撤回后 fail closed**（INT-06） | 需真实 `GET /changes` + 真实撤回事件；本侧尚无轮询调度器与缓存 TTL（`INTEGRATION_DIFF.md` T-05/T-06） |
| 生产级渗透测试 / 监控告警 | 未部署生产，且**未经批准不得部署** |
| 备份恢复**演练**（生产级） | 无生产环境 |
