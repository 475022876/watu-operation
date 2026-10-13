# PHASE 0｜基线审计与差异清单

对应执行包：`VFIB_Marketing_OS_V0.1_Comprehensive_Remediation_V1.0`
整改分支：`feat/v0.1-remediation`　基线分支：`main`
审计日期：2026-10-13　执行人：Codex（自动整改）

---

## 1. 环境与基线记录（Gate 0）

| 项目 | 值 |
|---|---|
| 仓库 | `D:\运营系统\VFIB-Marketing-OS`（远端 `https://github.com/475022876/watu-operation`） |
| 基线 commit | `567de9caf3a7f69e7b930164cc236d23a19d047e`（`feat: BUILD-02 + BUILD-03 交付…`） |
| 分支 | 基线 `main` → 整改分支 `feat/v0.1-remediation` |
| `package.json` version | `0.1.0` |
| `lib/mos/config.js` MOS_VERSION | `0.1.0` |
| `mosSchemaVersion` | **3** |
| Node | v22.22.2（engines 声明 `>=18`） |
| 依赖 | **零第三方依赖**（`dependencies: {}`），仅 Node 内置模块 |
| 受版本控制文件数 | 94 |

**配置脱敏摘要**（`config.json`，已 gitignore，不入库）：

```
mos.integrations = { identity: mock, knowledge: mock, library: mock,
                     sourceIngest: real, textProvider: none, imageProvider: none }
mos.egress       = { allowedHosts: [bis/imf/fsb/fatf/swift 共10条], allowHttp: false,
                     fetchTimeoutMs: 12000, maxBytes: 2097152, maxItemsPerRun: 40 }
auth             = { cookieName: mos_sid, csrfCookieName: mos_csrf,
                     csrfHeader: x-mos-csrf, secureCookies: auto,
                     allowedOrigins: [https://vfib-marketing-os.app.workbuddy.host] }
budget           = { brandMonthlyUsd: 0, perJobUsdMax: 0 }
```
> 本报告不复制任何口令、令牌、密钥；上述均为非敏感配置项。

---

## 2. 版本识别结论

- 执行包所述基线 `watu-operation-main.zip` 与本仓库**为同一份代码**（无需重新导入）。
- 版本定位确认为 **V0.1 原型**：`package.json 0.1.0`，`docs/MOCK_REAL_MATRIX.md` 自述为 sandbox 原型。
- 既有交付阶段：BUILD-01 / BUILD-02 / BUILD-03 已交付；**BUILD-04 未开工**（本轮整改不冠以 BUILD-04，按执行包定位为「V0.1 综合整改」）。

---

## 3. 与执行包所述内容的不符之处（重要）

执行包 00 §1 记录：「既有测试日志显示：smoke、BUILD-01/02/03 E2E 通过；**unit 38/39**，存在 **U-07b SSRF 相关失败**；**UI 因 Chrome/Edge 环境缺失未运行**；**汇总 237/238、全量失败**」。

**独立复跑结论：该记录是「审计环境受限」的结果，不是产品缺陷的完整画像。** 差异如下：

| 项 | 执行包记录 | 本次独立复跑 | 判定 |
|---|---|---|---|
| unit | 38/39（U-07b 失败） | **39/39** | 差异，见 §3.1 |
| ui | 未运行（缺浏览器） | **73/73** | 环境差异，本机有 Chrome 154.0.8037.93 |
| 汇总 | 237/238（失败） | **311/311（全绿）** | 238 = 扣掉 ui 套件的断言总数（13+39+48+63+75） |

### 3.1 U-07b 失败的根因（已定位）

`tools/mos-unit-test.js:159` 的 U-07b 用例最后一项断言为：

```js
source.assertEgressAllowed('https://bis.org/press')  →  期望 ok === true
```

该断言**依赖公网 DNS 解析 `bis.org`**。在无外网/受限 DNS 的审计环境中必然得到 `DNS_FAILED`，从而失败。**这是测试隔离缺陷，不是 SSRF 判定缺陷**——SSRF 判定本身的正向/反向用例全部通过。

执行包 F-01 已明确要求「补充**不依赖公网DNS**的测试」，本项列入 Phase 1。

### 3.2 审计包未记录、但确实存在的问题

| ID | 问题 | 证据 |
|---|---|---|
| P0-B01 | **空壳测试**（假通过）：`tools/mos-unit-test.js:158` `t('U-07b 非白名单主机被拒（fail closed）', async () => {})` —— 无任何断言，却会显示 PASS | 源码行 |
| P0-B02 | **测试依赖公网 DNS**：U-07b 末项断言要求 `bis.org` 可解析 | 同上 §3.1 |
| P0-B03 | **SSRF 校验与连接未绑定（TOCTOU）**：`source.js:82 assertEgressAllowed()` 解析出 `ip` 但 `fetchOnce()` 用 `hostname` 重新解析并连接，校验过的 IP 未固定；源码注释 §16 行亦自认「已知残留风险」 | `lib/mos/adapters/source.js:132,144-147` |
| P0-B04 | **重定向一律拒绝**，未实现「逐跳重新校验」：`fetchOnce()` 遇 3xx 直接 `REDIRECT_BLOCKED`（fail closed 但不符合 F-01/SEC-13 的逐跳审查要求） | `lib/mos/adapters/source.js:156-160` |
| P0-B05 | **未校验 URL 内嵌凭据**（`https://user:pass@host/`）与**非标准端口/主机形态** | `assertEgressAllowed()` 无相关分支 |
| P0-B06 | **未处理响应压缩膨胀**：请求未发 `Accept-Encoding`，但若上游仍返回 `Content-Encoding: gzip`，`maxBytes` 只限制**压缩后**字节，存在解压炸弹面 | `lib/mos/adapters/source.js:166-181` |
| P0-B07 | **未考虑代理环境**：本机常驻系统代理（`HTTP_PROXY/HTTPS_PROXY` 已设），Node `http.request` 不自动走代理，但环境不一致时行为不可预期，需显式声明并拒绝 | 环境变量 |
| P0-B08 | **`MOS_EGRESS_ALLOW_LOOPBACK` 未在生产环境强制拒绝**：`source.js:119` 只读环境变量，无「生产禁用」闸门 | `lib/mos/adapters/source.js:119-126` |

> 说明：P0-B01…B08 均属 F-01（P0）范围，将在 Phase 1 修复并补测。

---

## 4. 源码路径核对（执行包 02 §1 vs 实际仓库）

| 执行包声明 | 实际 | 结论 |
|---|---|---|
| 后端 `lib/mos/routes/{plans,campaigns,topics,tasks,content,creative,video,publishing,reviews,admissions,analytics,sources,channels}.js` | 全部存在 | ✅ 一致 |
| 领域与策略 `lib/mos/{dict,rbac,reviewlib,admissionlib,skill,store,config}.js` | 全部存在 | ✅ 一致 |
| 适配 `lib/mos/adapters/{identity,knowledge,library,source,text,image}.js` | 全部存在 | ✅ 一致 |
| 前端 `public/mos/js/modules/{workspace,planning,campaigns,topics,tasks,content,visual,video,publishing,reviews,governance,brand,reference,analytics,intelligence}.js` | 全部存在 | ✅ 一致 |
| 测试 `tools/run-mos-tests.sh`、`mos-unit-test.js`、`mos-ui-check.js` 及 E2E 脚本 | 全部存在 | ✅ 一致 |

**实际仓库中执行包未列出的文件**（属正常，非缺失）：

- 路由额外：`admin.js`、`auth.js`、`helpers.js`、`index.js`、`meta.js`
- 领域额外：`audit.js`、`ids.js`、`manifest.js`、`router.js`、`seed.js`
- 前端额外：`guidelines.js`、`projects.js`
- 测试额外：`mos-e2e-build02.js`、`mos-e2e-build03.js`、`mos-smoke-build02.js`、`mos-seed-build02.js`、`mos-reset-password.js`、`secret-scan.js`

**结论：无路径缺失，不存在「凭空改写不存在的模块」的风险。**

---

## 5. 全量测试独立复跑（Phase 0 强制项）

命令：`bash tools/run-mos-tests.sh all`
执行时间：2026-10-13　退出码：**0**　耗时：约 119s

| 套件 | 断言 | 结果 | 证据文件 |
|---|---|---|---|
| smoke | 13 | 13/13 | `TEST_EVIDENCE_MOS_BUILD01/smoke-result.json` |
| unit | 39 | 39/39 | `TEST_EVIDENCE_MOS_BUILD01/unit-result.json` |
| e2e（BUILD-01） | 48 | 48/48 | `TEST_EVIDENCE_MOS_BUILD01/e2e-result.json` |
| e2e02（BUILD-02） | 63 | 63/63 | `TEST_EVIDENCE_MOS_BUILD02/e2e-build02-result.json` |
| e2e03（BUILD-03） | 75 | 75/75 | `TEST_EVIDENCE_MOS_BUILD03/e2e-build03-result.json` |
| ui（真实 Chrome CDP） | 73 | 73/73 | `TEST_EVIDENCE_MOS_BUILD01/ui-check-result.json` |
| **合计** | **311** | **311/311** | `TEST_EVIDENCE_MOS_BUILD01/summary.json` |

**精确失败清单：0 项。跳过清单：0 项。**（`ui` 套件在本机**未跳过**，Chrome 154.0.8037.93 可用。）

> 所有套件均使用随机端口（9500-9699）与随机独立数据目录（`data-mos-*`），跑完自动清理，不触碰 `data/`。

---

## 6. 已有实现确认（避免重复开发）

| 执行包条目 | 当前状态 | 结论 |
|---|---|---|
| 三独立审核链（Professional / Publication / AssetAdmission） | 已实现（`reviews.js` + `PERM_BY_TYPE`） | 保留，不重建 |
| `library.asset.approve.final` 独立特权 | 已实现（A-16 已修）；P1/MOS_ADMIN 不自动获得 | 保留 |
| AssetAdmission 双字段 + 计算式 `reuseEligibility` | 已实现（`admissionlib.js`） | 保留 |
| Mock 资料库结构上不可产生 `AVAILABLE` | 已实现 | 保留 |
| Published Archive 仅在中台 + 物理快照 + 更正 append-only | 已实现（`publishing.js`） | 保留 |
| Analytics 真实聚合 + `missing[]`（无假 KPI） | 已实现（`analytics.js`） | 保留 |
| 数据分级 RESTRICTED 外发阻断（SEC-10） | 已实现（`creative.js`） | 保留 |
| 八工作中心（Workspace/Brand/Planning/Creative/Publishing/Marketing/Analytics/Governance & Assets） | 已实现，UI 套件已校验 | 保留 |
| `docs/MOCK_REAL_MATRIX.md` | 已存在，10 行集成矩阵 | 更新而非重建 |

**尚未实现 / 需新增：**

- **无任何定时调度器**（全仓无 `setInterval`）→ A-01 需新增轻量来源调度。
- **`source.js` SSRF 硬绑定与逐跳校验**（P0-B03/B04/B05/B06/B07/B08）→ Phase 1。
- **Marketing Center 的 VFIB / U CARD 双品牌营销工作区 + Campaign Brief/Deliverables** → Phase 2（F-05/A-02）。
- **`docs/CURRENT_ARCHITECTURE.md`、`docs/API_CONTRACT_AND_INTEGRATION_STATUS.md`** → Phase 4。
- **企业资料库真实集成适配契约（与 Enterprise Workspace 最新源码一致）** → Phase 3（A-06）。

**已确认的边界（不得触碰）：**

- S05 客户增长、品牌声誉专项、营销线索移交闭环、代理后台、社媒自动发布 → **MARK，不开发**。
- 不重构企业资料库、不重开发 OA、不接真实银行生产凭据。

---

## 7. Phase 0 结论

1. **基线可信**：commit `567de9c`，零依赖，schema v3，311/311 全绿（含真实浏览器 UI）。
2. **执行包所述「237/238 全量失败」不成立**——其中 1 项失败源于测试的公网 DNS 依赖，73 项 UI 断言源于审计环境缺浏览器。**产品侧无 P0 级失败**。
3. **但确实存在真实 P0 问题**：空壳测试（假通过）、SSRF 校验与连接未绑定、重定向未逐跳校验、URL 凭据/端口未校验、解压膨胀面、环回开关未在生产禁用。→ 全部进入 Phase 1。
4. **无阻断性环境缺失**：Chrome 可用，UI 套件可运行，无需标记 `BLOCKED`。
5. 继续执行 Phase 1，不停止。

---

## 附：Phase 0 复现命令

```bash
cd /d/运营系统/VFIB-Marketing-OS
node -v                                   # v22.22.2
git rev-parse HEAD                        # 567de9c...
bash tools/run-mos-tests.sh all           # EXIT=0，311/311
```
