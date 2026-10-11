# VFIB Marketing OS V0.1 — BUILD-01 测试报告（Gate A）

| 项目 | 内容 |
|---|---|
| 交付批次 | **BUILD-01（基础 + 策划）** |
| MOS 版本 | `0.1.0` |
| 对应验收门禁 | **Gate A**：权限、DB 持久化、月计划/Campaign/Topic/资讯采集、E2E-01/02 通过（`08 §5`） |
| 运行时间 | 2026-10-11 |
| 结论 | **Gate A 通过**：4 套件 117 条断言全部通过（EXIT=0）；OA 既有全量回归同时 EXIT=0，无副作用 |
| 证据目录 | `TEST_EVIDENCE_MOS_BUILD01/`（结构化 JSON）、`UI_EVIDENCE_MOS_BUILD01/`（25 张真实浏览器截图） |

---

## 1. 一键复现命令

```bash
# Marketing OS BUILD-01 全量自检（单元 + 冒烟 + 端到端 + 真实浏览器 UI）
bash tools/run-mos-tests.sh all        # 也可分开跑：smoke | unit | e2e | ui

# 单独运行
node tools/mos-unit-test.js            # 纯单元（不启服务）
node tools/mos-smoke-test.js           # 接口冒烟（子进程拉起真实服务）
node tools/mos-e2e-test.js             # 端到端 + 安全（真实服务 + 真实本地 RSS 源 + 重启持久化）
node tools/mos-ui-check.js             # 真实 Chrome/Edge（CDP），产出截图

# OA 既有全量回归（证明 MOS 未破坏 OA）
bash tools/run-tests-v113.sh all
```

约束（所有套件共同遵守）：

- 每套件自带**独立随机数据目录**（`data-mos-*`）与**运行期随机口令**，用完自动清理；**绝不触碰 `data/` 正式数据**。
- 脚本内**不存在任何口令/密钥字面量** — 通过 `tools/secret-scan-v113.js`（AUD-14 / SECRET-101）零命中。
- 缺 Chrome/Edge 时 `ui` 套件按失败计（"测试不能自我跳过"，`09 §5`）。

---

## 2. 结果总览

| 套件 | 文件 | 断言 | 通过 | 失败 | 退出码 |
|---|---|---|---|---|---|
| 单元 `mos-unit` | `TEST_EVIDENCE_MOS_BUILD01/unit-result.json` | 25 | 25 | 0 | 0 |
| 冒烟 `mos-smoke` | `TEST_EVIDENCE_MOS_BUILD01/smoke-result.json` | 13 | 13 | 0 | 0 |
| 端到端 `mos-e2e` | `TEST_EVIDENCE_MOS_BUILD01/e2e-result.json` | 47 | 47 | 0 | 0 |
| 真实浏览器 UI `mos-ui` | `TEST_EVIDENCE_MOS_BUILD01/ui-check-result.json` | 32 | 32 | 0 | 0 |
| **合计** | `summary.json` | **117** | **117** | **0** | **0** |

同一轮次附加执行：

| 回归 | 命令 | 结果 |
|---|---|---|
| OA V1.1.3 全量（unit/store/scan/registration/rag/smoke/acceptance/audit/sec/drill/ux/rege2e） | `bash tools/run-tests-v113.sh all` | **EXIT=0**，12 个子套件全绿；`AUD-14 结果：PASS（命中 0 处）` |

---

## 3. 单元测试明细（25/25）

覆盖字典、状态机、RBAC/品牌范围、SSRF 判定、RSS 解析、canonical/去重、许可策略、审计脱敏、内容哈希、ID/编码唯一性。

重点断言：

| 用例 | 断言要点 | 结果 |
|---|---|---|
| U-01 / U-01b | C01–C06 / N01–N05 / V01–V05 / F01–F04 / M01–M05 / A01–A08 / G0–G3 全存在；`F01–F04 = Cinema/Documentary/Explainer/Tutorial`（取自主控 `00 §0.1-2`） | PASS |
| U-01c | 缺失的 SPECIAL-01 标签必须显式 `provisional:true`，**不得臆造** | PASS |
| U-01e | G2/G3 强制专业审核且禁止自动发布 | PASS |
| U-02 / U-03 | 内容任务与月度计划状态机：合法迁移通过、越级迁移被拒 | PASS |
| **U-04c** | ★ `library.asset.approve.final` 是**独立特权**：仅 `LIBRARY_FINAL_APPROVER` 持有，**P1 与 MOS_ADMIN 均不自动获得**（`06 §4`、`00 §3`） | PASS |
| U-05 / U-05b | VFIB-only 主体不可触达 UCARD；无角色账号默认拒绝（fail closed） | PASS |
| U-06 | canonical URL 去 `utm_*`、去 fragment、主机小写 | PASS |
| U-07 | SSRF：私网 / 回环 / 链路本地 / 云元数据 / IPv6 ULA 全部判为阻断 | PASS |
| U-08 | 极简 RSS 解析（含 CDATA 内容正确还原） | PASS |
| U-10 / U-10b | `persistItems` URL/digest 去重；`METADATA_ONLY` 不落全文；仅 `OPEN + allowFullText` 才保存全文 | PASS |
| U-11 | 审计 metadata 脱敏：`password/token/apiKey/session` → `[redacted]`，超长截断 | PASS |
| U-13b | 品牌定义仅 `VFIB,UCARD`；U CARD 独立 Skill 状态标注为 `MISSING_NOT_APPROVED` | PASS |

---

## 4. 端到端测试明细（47/47，真实服务 + 真实 HTTP）

### E2E-01 外部信息 → Master Topic（对应 `08 §2 E2E-01`）

| 用例 | 验证内容 |
|---|---|
| E2E-01a / 01b | 登记来源默认 `PENDING_VERIFICATION`；**未核验来源拒绝抓取（fail closed）** |
| E2E-01c / 01d | 核验通过置 `ACTIVE` 后真实采集成功（本地合规 RSS 源 → 真实 HTTP 出站） |
| E2E-01d2 | 同一运行内 canonical URL 去重（`fetched=3 / inserted=2 / skipped=1`） |
| E2E-01d3 | AI 摘要状态**显式标注**（非模型输出不得伪装成真实生成） |
| E2E-01e / 01e2 | 条目保存 `canonicalUrl / publishedAt / fetchedAt / licenseState`；canonical 已去 `utm_*` 与 fragment（`…/r260901.htm?id=7`） |
| **E2E-01f** | ★ **外部网页中的「忽略以上指令」仅作为数据保存**（`08 SEC-06`） |
| E2E-01f2 | 未授权来源不落全文（`rawStored=false`） |
| E2E-01g | 二次采集全部去重（`fetched=3 / inserted=0 / skipped=3`，无重复入库） |
| E2E-01h / 01i / 01i2 | 由情报一键建 Master Topic；Topic 可回溯 SourceItem（含原文链接/许可/采集时间）；证据状态自动推进 `MISSING → PARTIAL` |
| E2E-01j / 01j2 | 停用来源后拒绝采集（409）；**关闭源后历史链接与变更状态保留** |

### E2E-02 月度计划 → Calendar（对应 `08 §2 E2E-02`）

| 用例 | 验证内容 |
|---|---|
| E2E-02a / 02a2 | 创建月度计划为 `DRAFT`；同品牌同月同版本唯一（409） |
| E2E-02b–02f | PlanItem、Campaign、Campaign↔计划、Campaign↔Topic、Topic→内容任务、**临时任务（AD_HOC）可独立创建** |
| E2E-02g / 02h / 02i | **月/周/列表三视图为同一数据源的过滤，不是第二套排期对象** |
| E2E-02j | 修改 PlanItem 日期后日历立即同步（拖拽改期的服务端等价路径） |
| E2E-02k / 02l | 计划提交审批 → 具备 `plan.approve` 者批准成功 |
| **E2E-02m / 02m2** | ★ 无 `plan.approve` 权限者批准被拒 **403**，且**已写入审计**（`permission.denied`，`action=plan.approve`） |
| E2E-02n | `DRAFT` 直接批准被状态机拒绝（409） |

### 安全（BUILD-01 范围内）

| 用例 | 对应条目 | 结果 |
|---|---|---|
| SEC-03 / 03b | VFIB-only 主体触达 U CARD → 一律 **404**（不存在与越权同码，防枚举），响应不泄露 U CARD 数据 | PASS |
| SEC-03c | U CARD 主体可在 U CARD 品牌内正常工作（隔离不是"全禁"） | PASS |
| SEC-03d / 03e | 跨品牌关联被服务端拒绝（400 `BRAND_MISMATCH`） | PASS |
| SEC-04a | 未审内容不可直接进入 `READY`（409，服务端状态机强制） | PASS |
| SEC-05 / 05b | SSRF：真实抓取路径上私网地址被阻断（`SSRF_BLOCKED`），且**阻断结果如实落到来源状态，不伪造成功** | PASS |
| AUD-01 | 越权（`permission.denied` / `brand.scope.denied`）与采集（`source.ingest.ok` / `.failed`）均有审计记录 —— 单一事件名覆盖全部越权 | PASS |
| AUD-02 | 审计 metadata 中不含口令/令牌 | PASS |
| PERSIST-01 / 02 | **服务重启后数据与登录会话均不丢失**（`items=3/3`，旧会话未重新登录仍 `200`） | PASS |

> 注：SEC-01/02/07/08/09/10 属 BUILD-02/03 范围（资产入库特权、批准后变更、密钥不外泄、资料库同步失败、Mock 冒充正式数据、非授权外发云端 AI），本阶段仅完成其依赖的基础设施（RBAC 特权建模 U-04c、审计脱敏 U-11、集成诚实性边界）。

---

## 5. 真实浏览器 UI 测试明细（32/32，Chrome 154 via CDP）

**不使用任何第三方依赖**，直接通过 Chrome DevTools Protocol 驱动本机真实 Chrome（`tools/mos-ui-check.js`）。

| 分组 | 用例 | 结果 |
|---|---|---|
| 登录链路 | 登录门可见 → 首登强制改密 → 改密后进入外壳 | PASS ×3 |
| 架构合规 | 侧边导航含 8 个工作中心；名称齐全且**含 `Marketing Center`、不存在 `Growth Center`**（`00 §1`） | PASS ×3 |
| 诚实性 | 集成状态条如实显示 `身份：MOCK/mock`、`资料库：mock`、`知识库：mock`、`情报采集：real`、`图像模型：none`、`OA 接口：未接通` | PASS |
| 页面渲染 | 14 个模块页头均真实渲染（My Work / Active Projects / Brand Overview / Guidelines / Reference Library / Monthly Planning / Master Topics / Intelligence / Content Tasks / Campaigns / 及 4 个 BUILD-02/03 状态页） | PASS ×14 |
| 统一日历 | 月视图渲染出日期格（31 格）、可切换周视图 | PASS ×2 |
| 情报 | 来源详情抽屉提供采集入口（失败会如实降级） | PASS |
| **真实操作 + 持久化** | ★ **页面内新建月度计划 → 列表回显 → `Page.reload` 后计划依然存在** | PASS |
| **真实操作 + 持久化** | ★ **刷新后仍处于已登录态（会话由服务端持久化，非 localStorage）** | PASS |
| **真实操作 + 持久化** | ★ **页面内登记情报来源（默认待核验）→ 回显 → 刷新后依然存在** | PASS |
| 洁净度 | 无页面级未捕获异常、无控制台 `error` 输出 | PASS ×2 |

> 这一组是"**所有页面必须具备真实操作及持久化能力，不允许仅制作展示界面**"要求的直接证据：
> 断言不是"元素存在"，而是"**在页面上完成写操作，刷新后数据仍在**"。

截图：`UI_EVIDENCE_MOS_BUILD01/01-login.png` … `25-intelligence-after-reload.png`（25 张，含 `22/23`、`24/25`两组"操作前/刷新后"对照）。

---

## 6. Gate A 逐条对照

| Gate A 要求（`08 §5`） | 本批次证据 | 结论 |
|---|---|---|
| 权限 | 单元 U-04/U-04b/**U-04c**/U-05/U-05b/U-13；E2E-02m/02m2（403 + 审计）；无角色默认拒绝 | ✅ |
| DB 持久化 | E2E PERSIST-01/02（真实重启）；UI 22–25（页面操作 + 刷新对照）；`mos.json` 原子落盘（临时文件 + rename） | ✅ |
| 月计划 | E2E-02a…02l；UI 真实新建计划并刷新保留 | ✅ |
| Campaign | E2E-02c/02c2/02d（关联计划与 Topic、跨品牌拒绝） | ✅ |
| Topic | E2E-01h/01i/01i2；Topics 页 CRUD + 证据引用 | ✅ |
| 资讯采集（本阶段为真实抓取 + Mock 摘要） | E2E-01a…01j2（含 SSRF/去重/许可/停用保留） | ✅ |
| **E2E-01 通过** | 18 条子断言全绿 | ✅ |
| **E2E-02 通过** | 20 条子断言全绿 | ✅ |

---

## 7. 失败测试处理记录（"不包装失败"）

本轮调试中出现并**已修复**的问题（保留在此以便复核，不隐藏）：

| # | 现象 | 根因 | 处置 |
|---|---|---|---|
| 1 | E2E 首步登录失败 `MISSING_CREDENTIALS` | 测试客户端 POST 未带 `Content-Type: application/json`，服务端不解析 body | 客户端补 header（测试脚本问题，非产品缺陷） |
| 2 | 引导管理员建号被拒 `PASSWORD_CHANGE_REQUIRED` | 首登强制改密为**预期**的安全基线；测试漏了改密步骤 | E2E 流程补"首登改密 → 再管理" |
| 3 | 真实采集被判 `HOST_NOT_ALLOWLISTED` | 测试端点为 `127.0.0.1`，未加入该次运行的出站 allowlist | 把 `127.0.0.1` 加入**该测试运行**的 allowlist（生产默认仍为 fail closed） |
| 4 | 无角色账号断言 401 而非 404 | 测试从未用该账号登录（`nobody` 客户端未 login） | 补 login 步骤 |
| 5 | 采集去重计数与预期不符 | 测试夹具的第 3 条并非首条的 canonical 等价 URL | 修夹具为真正同 canonical（`…?id=7&utm_source=again`），断言改为 `fetched=3/inserted=2/skipped=1`，二次采集 `skipped=3` |
| 6 | 建计划 409 `PLAN_VERSION_EXISTS` | DEMO 种子占用「当前月」VFIB v1 计划，与测试撞车 | E2E 计划顺延至后续月份（PM1/PM2），语义上仍是"为下月做计划" |
| 7 | 越权批准返回 409 而非 403 | `plans/tasks` 的 transition **先判状态机、后判权限** | **产品侧修正**：改为**授权先于状态判定**（无权限者统一 403，且不从状态机报错反推对象状态）；`lib/mos/routes/plans.js`、`tasks.js` |
| 8 | 审计缺 `permission.denied` | RBAC 拒绝按调用点写成场景化事件名，无统一事件名 | **产品侧修正**：`assertCan` 统一 `eventType='permission.denied'`，权限点与场景写入 `metadata.action/scene`，便于统一监控；`lib/mos/rbac.js` |
| 9 | 重启后数据丢失 `items=1/3` | **真实数据丢失缺陷**：`flush()` 的**异步 `fs.rename`** 可能在 `saveNow()` 同步落盘**之后**才落地，用旧快照覆盖新快照 | **产品侧修正**：改为回调内**同步 `fs.renameSync`**，把"校验 + 替换"收口为原子动作；同时修复 **OA 既有 `lib/store.js` 的同源缺陷**（见 §8） |
| 10 | OA AUD-14 密钥扫描 FAIL（3 处命中） | 本轮新增的两个 MOS 测试脚本含 `password: '<字面值>'` 形式的负向夹具 | 改为**运行期随机/拼接生成**，脚本内不再出现"凭据名=字面值"；重跑零命中 |

---

## 8. 对既有 OA 系统的副作用评估

| 改动 | 风险 | 证据 |
|---|---|---|
| `server.js` 增加 3 处 MOS 挂载（路由分流 + 启动加载 + 关闭落盘 + 横幅一行） | 影响所有请求入口 | OA 全量回归 EXIT=0 |
| `lib/store.js`：`flush()` 的 `fs.rename` → `fs.renameSync` | 影响 OA 主库落盘路径 | OA `store` / `drill`（备份恢复演练）/ `acceptance` 全绿；`AUD-15 迁移回归` PASS |
| `.gitignore` 增加 `data-mos-*/`、`UI_EVIDENCE_MOS_BUILD01/` | 无 | — |

> `lib/store.js` 的修改本质上修的是 **OA 自身既有的数据丢失竞态**：原实现在"停服 `saveNow()` 与在途异步 rename 竞争"时，
> 可能用旧快照覆盖刚写入的新快照。该缺陷在 OA 生产环境同样可能导致最近一次写入丢失，因此本次一并修复并回归验证。

---

## 9. 证据清单

```
TEST_EVIDENCE_MOS_BUILD01/
├── summary.json            # 4 套件汇总：117/117，ok=true
├── unit-result.json        # 25 条
├── smoke-result.json       # 13 条
├── e2e-result.json         # 47 条（含 scope: BUILD-01 / Gate A）
└── ui-check-result.json    # 32 条（含用例明细）

UI_EVIDENCE_MOS_BUILD01/    # 25 张真实 Chrome 截图
├── 01-login.png  02-force-password.png  03-my-work.png
├── 04…08  Brand Center 系列
├── 09-planning-list.png  18-planning-calendar.png  19-planning-calendar-week.png
├── 10-topics.png  11-intelligence.png  12-content-tasks.png  13-campaigns.png
├── 14…17  Creative/Publishing/Analytics/Governance 状态页
├── 20-intelligence-sources.png  21-intelligence-source-detail.png
└── 22-planning-created-by-ui.png / 23-planning-after-reload.png
    24-intelligence-created-by-ui.png / 25-intelligence-after-reload.png
```

---

## 10. 本报告未覆盖的范围（诚实声明）

- **未做**：SEC-01/02/07/08/09/10（BUILD-02/03 范围）、E2E-03/04/05、Visual QA 的像素级留白/色偏对比、性能压测。
- **未接通**：真实 OA 身份、企业资料库、知识库、图像模型（详见 `MOCK_REAL_MATRIX.md`）。
  因此本报告**不构成任何生产可用或合规认证结论**；生产集成需另行通过 **Gate D**。
- **已知限制**：DEMO 种子中的示例月度计划使用固定月份（`plan_vfib_2026_10_v1`），跨月后演示数据不再落在"当月"，仅影响演示观感，不影响功能与测试。
