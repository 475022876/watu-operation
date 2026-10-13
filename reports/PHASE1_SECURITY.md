# PHASE 1｜P0 安全与一致性修复报告

对应执行包：`VFIB_Marketing_OS_V0.1_Comprehensive_Remediation_V1.0`
整改条目：**F-01（P0）** 为主，含 **F-02 / F-03 / F-04** 的验证与补测
分支：`feat/v0.1-remediation`　日期：2026-10-13

---

## 1. 结论摘要

| 项 | 结果 |
|---|---|
| 全量自检 | **332/332 通过**（Phase 0 基线 311/311 → 净增 21 项断言，**零回归**） |
| 新增套件 | `sec`（出站安全，17 断言），已接入 `tools/run-mos-tests.sh` |
| 单元断言 | 39 → **43**（删除 1 项空壳假通过，新增 5 项安全断言） |
| 新发现的产品缺陷 | **1 个真实 P0 绕过面**（IPv4-mapped IPv6 十六进制形式绕过地址拦截），已修复并留回归断言 |
| P0 阻断问题 | 无。**可进入 Phase 2。** |

**复现命令**

```bash
cd /d/运营系统/VFIB-Marketing-OS
node tools/mos-unit-test.js            # 43/43
node tools/mos-security-egress-test.js # 17/17
bash tools/run-mos-tests.sh all        # 332/332，EXIT=0
```

---

## 2. F-01 出站采集安全（核心）

### 2.1 修复前的问题（Phase 0 已定位）

| ID | 问题 | 影响 |
|---|---|---|
| P0-B01 | `tools/mos-unit-test.js` 存在**空壳测试** `t('U-07b …', async () => {})` | 假通过，虚增断言数 |
| P0-B02 | U-07b 依赖公网 DNS 解析 `bis.org` | 受限网络环境下必然失败（即审计包记录的「38/39」） |
| P0-B03 | **TOCTOU**：`assertEgressAllowed` 解析出 IP，`fetchOnce` 却用 `hostname` **重新解析**后连接 | 校验过的 IP 与真实连接对象不一致 → DNS 重绑定可绕过 |
| P0-B04 | 重定向**一律拒绝** | fail closed 但不满足「逐跳审查」要求，且合法同源跳转不可用 |
| P0-B05 | 未校验 URL 内嵌凭据 / 端口 / 非标准主机 | 凭据泄露与解析歧义面 |
| P0-B06 | 未处理响应压缩编码 | 只按压缩后字节限长 → 解压膨胀炸弹面 |
| P0-B07 | 未声明代理环境行为 | 行为不可预期 |
| P0-B08 | `MOS_EGRESS_ALLOW_LOOPBACK` 无生产闸门 | 生产可能被误开 |

### 2.2 修复内容（`lib/mos/adapters/source.js`、`lib/mos/config.js`）

| 修复 | 实现 |
|---|---|
| **校验→连接绑定** | `assertEgressAllowed()` 返回 `{ip, family, addresses}`；`fetchOnce()` 通过 `lookup: pinnedLookup(addresses)` 把**已校验 IP 固定绑定**到 socket，同时保留 `servername`（TLS SNI）与 Host 头 → 证书校验不变，DNS 重绑定失效 |
| **跳转逐跳校验** | 新增 `fetchWithRedirects()`：每跳重新执行 白名单 / SSRF / 协议 / 端口 / 凭据 校验；`egress.maxRedirects`（默认 3）防重定向环；单跳不合规即 `REDIRECT_BLOCKED` |
| **URL 形态** | 内嵌凭据 → `CREDENTIALS_IN_URL`；主机名含空白/斜杠 → `BAD_HOST` |
| **端口收紧** | 新增 `egress.allowedPorts`（默认 `[443]`）；**生产模式一律强制**该表 |
| **压缩防膨胀** | 请求携带 `Accept-Encoding: identity`；上游仍返回非 identity 编码 → `UNSUPPORTED_ENCODING`（不解压）；额外校验 `Content-Length` 声明值 |
| **代理** | 明确不读取 `HTTP_PROXY/HTTPS_PROXY`、不挂代理 agent，按已校验 IP 直连（写入模块头注释与 `status()`） |
| **生产闸门** | 新增 `isProductionMode()`（`MOS_PRODUCTION=1` 或 `NODE_ENV=production`）；生产模式下 `MOS_EGRESS_ALLOW_HTTP` / `MOS_EGRESS_ALLOW_LOOPBACK` **一律失效** |
| **测试接缝** | `_setResolverForTest()` / `_resetResolverForTest()` 允许注入解析器以验证绑定（仅测试使用） |

### 2.3 ★ 新发现的真实缺陷：IPv4-mapped IPv6 绕过（P0-B09）

**问题**：`isBlockedIp()` 只识别 IPv4-mapped 的**十进制定点**写法 `::ffff:10.0.0.1`，但 WHATWG URL 解析器会把 `https://[::ffff:10.0.0.1]/` 规范化为 **十六进制**写法 `[::ffff:a00:1]`。旧实现对该形式返回 `false`（未阻断）→ **攻击者可把私网/回环地址写成十六进制 IPv4-mapped IPv6 绕过 SSRF 判定**。

**修复**：新增 `expandIpv6()`（完整展开 8 组，含内嵌 IPv4 解析），并据此识别：
`IPv4-mapped (::ffff:0:0/96)`、`IPv4-compatible`、`NAT64 (64:ff9b::/96)`、`6to4 (2002::/16)`、`Teredo (2001::/32)`、
`ULA (fc00::/7)`、`链路本地 (fe80::/10)`、`组播 (ff00::/8)`、`文档段 (2001:db8::/32)`、`回环 (::1)`。
`isLoopbackIp()` 同步覆盖十六进制 mapped 写法。

**回归断言**：`U-07g`（单元）＋ `SEC-11` 矩阵中的「IPv4-mapped 十六进制写法·绕过面回归」与「NAT64 内嵌私网」两例。

### 2.4 验收矩阵对照

| ID | 验收动作 | 结果 | 断言 |
|---|---|---|---|
| SEC-11 | 非 allowlist 源、localhost/私网/元数据 IPv4&IPv6、IPv4-mapped IPv6 | **全部拒绝** | `SEC-11`（16 例）、`SEC-11b/c` |
| SEC-12 | DNS 重绑定 / 解析后改 IP | **连接固定已校验 IP**（注入解析器仅被调用 1 次，连接未被改指） | `SEC-12` |
| SEC-13 | 302 跳转到私网/别域名/HTTP/异端口 | **每跳重新验证**；合法同源跳转可跟随；超限拒绝 | `SEC-13a…13e` |
| SEC-14 | 采集失败 / 重试与去重 | 5xx 如实返回失败（`ok:false, items:[]`），**不伪造成功** | `SEC-14a/b`（去重见基线 `E2E-01d2/01g`） |
| SEC-15 | 外部 RSS 嵌入「忽略此前指令」 | 仅作为**数据**解析；canonical 化正常；无指令副作用 | `SEC-15a/b/c` |
| — | 压缩膨胀 / 体积上限 | `UNSUPPORTED_ENCODING` / `RESPONSE_TOO_LARGE` | `SEC-16a/b` |
| — | 端口收紧、URL 内嵌凭据 | `PORT_NOT_ALLOWED` / `CREDENTIALS_IN_URL` | `SEC-11`、`U-07c` |

### 2.5 测试隔离改进

- **全部 SSRF 用例改为不依赖公网 DNS**：使用字面量 IP 与本地 HTTP 服务（`127.0.0.1:<随机端口>`）。
- 新套件自带**本地模拟 HTTP 服务与故障注入**：正常 RSS、相对跳转、外域跳转、元数据跳转、私网跳转、跳转环、gzip 编码、超大响应、5xx。
- 删除空壳测试 `U-07b 非白名单主机被拒（fail closed）`（无断言、恒 PASS）。

---

## 3. F-02 / F-03 / F-04 验证（基线已具备，本轮补强不变量）

| 条目 | 现状 | 证据（本轮复跑） |
|---|---|---|
| **F-02** 发布审批绑定不可变 ContentVersion+hash | 已实现：冻结时固化 Manifest 哈希；裁决前重算比对 | `SEC-02-a…g`（含**直接改盘篡改后被拒** `MANIFEST_CHANGED`）、`E2E04-05`（无真实 URL/证据不能登记发布） |
| F-02 手工发布仅真实证据创建 PublicationRecord；快照不可覆盖 | 已实现 | `E2E04-06/07/08/09`（物理快照落盘、只读可读）、`E2E04-10/11`（更正为 append-only，原件保留） |
| F-02 系统无自动发布 | 已实现（全仓无 `setInterval`） | `E2E04-14`（到期后状态与归档均不变） |
| **F-03** AssetAdmission 三态独立、Mock 不可转为正式 Approved | 已实现 | `E2E05-02/10/11`（双字段独立）、`SEC-09-a/b/c`（Mock 下 `AVAILABLE` 结构性不可达）、`U-15/U-15b` |
| F-03 `MOS_ADMIN` / P1 不自动获得 `library.asset.approve.final` | 已实现（A-16 修复保留） | `SEC-01-a/b/c/d`（含审计留痕）、`U-04c` |
| F-03 真实 Library 接口不使用无边界超级令牌 | 属性保持：Mock 回执 `permissionValid:false`、`searchApproved` 恒空；真实接口未接通（`Mock`，不宣称联调） | `E2E05-14/15/16`、`U-18b` |
| **F-04** 每种状态在 UI 显式区分 MOCK/NONE/REAL | 已实现 | UI：集成状态提示条「身份：MOCK / 资料库：mock / 文本模型：none / OA：未接通」；`B03-UI` 治理页明确标注 MOCK |
| F-04 缺模型提示配置而非模拟内容 | 已实现 | `E2E03-15`（`NOT_CONFIGURED`）、`SEC-07-b`（`hasServerKey=false`） |
| F-04 数据缺失显示 Unavailable，禁止假 KPI | 已实现 | `AN-03/04/05`、`B03-UI 运营分析：缺失态` |

> 说明：F-02/F-03/F-04 在 Phase 0 已确认实现完备，本轮**只做独立复跑验证**，未作破坏性改动，避免违反 KEEP 边界。

---

## 4. 变更文件清单

**产品代码（3 个）**

| 文件 | 变更 |
|---|---|
| `lib/mos/adapters/source.js` | 重写 SSRF 判定（`expandIpv6` / `isBlockedV4` / `isLoopbackIp`）、URL 形态校验、端口表、`pinnedLookup`、`fetchWithRedirects`、编码与体积防御、解析器测试接缝、模块头安全口径改写 |
| `lib/mos/config.js` | `egress` 新增 `allowedPorts` / `maxRedirects`；新增 `isProductionMode()`；环境变量 `MOS_EGRESS_ALLOWED_PORTS` / `MOS_EGRESS_MAX_REDIRECTS` |
| `.env.example` | 新增上述环境变量说明与生产模式说明 |

**测试与脚本（3 个）**

| 文件 | 变更 |
|---|---|
| `tools/mos-security-egress-test.js` | **新增**（17 断言，本地 HTTP 服务 + 故障注入 + 解析器注入） |
| `tools/mos-unit-test.js` | 删除 1 项空壳测试；U-07b 改为 DNS 无关；新增 U-07c/d/e/f/g |
| `tools/run-mos-tests.sh` | 新增 `sec` 套件；汇总归并 `security-egress-result.json`；build 标识更新 |

**新增证据**

- `TEST_EVIDENCE_MOS_BUILD01/security-egress-result.json`

---

## 5. 未解决 / 已知限制（如实记录）

| 项 | 状态 | 说明 |
|---|---|---|
| 真实资料库 / SSO / Provider 联调 | **`MOCK` / `NOT_CONFIGURED`** | 无真实服务与凭据，**不得**改配置冒充 `REAL`（执行包 04 全局停止条件） |
| TLS 层证书固定（certificate pinning） | 未实现 | V0.1 依赖系统 CA；生产化需另行立项（P2） |
| 出站请求的多实例并发去重 | 未实现 | 当前为**单实例 JSON 存储**（既有约束），A-01 调度将显式声明单实例限制 |
| 「采集失败重试与去重」的调度侧断言 | 待 Phase 3 | 当前仅验证**手动采集**路径的失败与去重；自动调度的失败退避/重启行为属 A-01 |

---

## 6. Phase 1 门禁判定

- ✅ 无 P0 失败
- ✅ 全量 332/332 通过，基线 311 项**零回归**
- ✅ 审计包所述「U-07b 失败」根因已消除（测试不再依赖公网 DNS）
- ✅ 新发现 1 个真实绕过面（IPv4-mapped IPv6）已修复并留回归断言
- ✅ 无 P0 阻断问题 → **继续执行 Phase 2**
