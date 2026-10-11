# Marketing OS V0.1 — BUILD-01 自审报告

> 格式严格遵循 `09_CODEX_EXECUTION_PLAN.md` §7「Codex 每轮自审格式」：
> ①本轮功能与实际界面 ②改动文件 ③迁移操作与回滚 ④测试命令与通过结果 ⑤Mock/Real 状态 ⑥安全检查 ⑦未完成/阻断 ⑧下轮范围。

| 项 | 内容 |
|---|---|
| 批次 | BUILD-01（基础 + 策划） |
| 版本 | MOS `0.1.0`；OA 主库 schema 仍为 `3`（未变） |
| 对应门禁 | Gate A |
| 前置文档 | `ARCHITECTURE_AUDIT.md`、`ADRs/ADR-001-tech-stack.md`、`MOCK_REAL_MATRIX.md`、`BUILD-01_TEST_REPORT.md` |

---

## ① 本轮功能与实际界面

按 `09 §2` 的六项要求逐条交付，**全部为可操作 + 可持久化，无纯展示页**。

### 1) 项目初始化 / Auth Mock / Brand Scope
- 采用**增量内嵌子系统**而非新建工程（ADR-001）：物理隔离为 `<OA 数据目录>/mos.json` + `/api/mos/*` + `mos_sid` Cookie，OA 完全不受影响。
- 独立路由表（Origin/Referer 校验 + 双提交 CSRF + 限速 + 首登强制改密闸门），与 OA 路由互不干扰。
- `MockIdentityGateway`：本地隔离身份，scrypt 口令哈希、12h 会话、登录失败锁定。
- **品牌范围（ABAC）**：`VFIB` / `UCARD`；越权与非存在品牌**返回同一 404**，防品牌枚举。

### 2) UI Shell / 8 个工作中心入口 / 状态页面
侧边导航严格按主控命名（`00 §1`），**`Marketing Center` 未改名为 Growth Center**：

| 工作中心 | 本批次状态 |
|---|---|
| **Workspace** | ✅ My Work、Active Projects（真实数据） |
| **Brand Center** | ✅ Brand Overview、Visual & Creative Guidelines（读字典）、Reference Library（读资料库 Mock 状态） |
| **Planning Center** | ✅ Monthly Planning：计划 CRUD + 审批状态机 + PlanItem CRUD + **统一日历（月/周/列表同一数据源）** |
| **Creative Studio** | ⏳ 状态页（BUILD-02 范围，明确标注） |
| **Publishing Center** | ⏳ 状态页（BUILD-02 范围） |
| **Marketing Center** | ✅ Campaigns：CRUD + 关联计划/Topic（跨品牌拒绝） |
| **Analytics Center** | ⏳ 状态页（BUILD-03 范围，真实数据缺失时显示缺失） |
| **Governance & Assets** | ⏳ 状态页（BUILD-03 范围，含三条审核链占位说明） |

并含：Master Topics、Content Tasks、Intelligence（来源登记 + 采集 + 条目 + 建题）等模块页。

UI 必备状态（`11 §每阶段开发`）均落实：`Loading`（骨架屏）/ `Empty` / `Error` / `NoPermission` / `IntegrationPending`。

### 3) MonthlyPlan / PlanItem / Campaign / MasterTopic / ContentTask 关系
- 月度计划（含版本号、`code` 如 `VFIB-2026-11-v1`）→ PlanItem（日期/优先级/AD_HOC）→ ContentTask。
- Campaign ↔ 月度计划、Campaign ↔ MasterTopic（多对多）；Task 可关联 Topic/PlanItem，也可独立创建。
- **同一数据源日历**：月/周/列表三视图仅是对同一组 entries 的过滤，**不存在第二套排期对象**。

### 4) SourceRegistry / SourceItem 与最小采集器
- 来源登记默认 `PENDING_VERIFICATION`，**登记 ≠ 可用**；核验后方可 `ACTIVE`。
- **真实 HTTP 采集**（RSS 极简解析）：canonical URL 归一（去 `utm_*`/fragment/主机小写）+ digest 双重去重 + 许可门禁（`METADATA_ONLY` 不落全文）。
- 失败**如实降级**并写入来源 `lastError` 与审计；不伪造成功。

### 5) Workspace / Planning / Brand 只读配置
Brand Overview 暴露品牌 Skill 激活状态并**阻断官方产出**（U CARD 独立 Skill 未批准 → `MISSING_NOT_APPROVED`）；Visual & Guidelines 直接读取 C/N/V/F/M/A/G 字典并标注 `provisional`。

### 6) Unit + E2E-01/02 + 品牌隔离
见 ④。共 117 条断言全绿。

### 实际界面截图（真实 Chrome 渲染）
`UI_EVIDENCE_MOS_BUILD01/`：登录门、强制改密、My Work、8 中心各页、统一日历（月/周）、情报来源与来源详情，以及
**`22/23` 与 `24/25` 两组"页面操作 → 刷新后仍在"的对照截图**。

---

## ② 改动文件

### 新增 — 后端（23 个）
```
lib/mos/config.js            # 子系统配置单一来源（版本/集成矩阵/出站策略/字典覆盖/预算）
lib/mos/dict.js              # 品牌、权限点、P1–P4 等角色、C/N/V/F/M/A/G 字典（缺失项标 provisional）
lib/mos/ids.js               # uid / 业务编码（计划号、任务号、版本号）/ sha256 / 内容哈希
lib/mos/store.js             # 独立 mos.json、schema v1、原子落盘、migrate、首启口令一次性输出
lib/mos/seed.js              # 引导管理员 + 5 个 DEMO 身份 + DEMO 业务数据（全部标 demo）
lib/mos/audit.js             # append-only 审计 + 敏感键脱敏 + 长度截断
lib/mos/rbac.js              # RBAC + 品牌 ABAC：can/assertCan/assertBrand/visibleBrands
lib/mos/router.js            # 独立路由表 + Origin/CSRF/限速/强制改密闸门
lib/mos/adapters/identity.js # MockIdentityGateway（mos_sid / scrypt / 12h / 锁定）
lib/mos/adapters/knowledge.js# MockKnowledgeGateway
lib/mos/adapters/library.js  # MockLibraryGateway（幂等回执、MOCK_ 前缀、检索恒空、仅 MOCK_APPROVED）
lib/mos/adapters/source.js   # 真实抓取 + allowlist + DNS/IP 拦截 + canonical + 去重 + 许可门禁
lib/mos/adapters/text.js     # 摘要：NOT_CONFIGURED / MOCK / INTEGRATION_PENDING / BLOCKED
lib/mos/routes/{index,auth,meta,helpers,plans,campaigns,topics,tasks,sources,admin}.js
```

### 新增 — 前端（16 个）
```
public/mos.html                     # 外壳：登录门 / 强制改密门 / 8 中心导航 / 品牌切换 / 集成条 / 弹窗抽屉 toast
public/mos/app.css                  # 设计 Token（#071D49 / #C78B27 / #FCFBF7 / #E6D8BD）+ 响应式断点
public/mos/js/{api,ui,app}.js       # CSRF 透传、组件库、8 中心注册表与路由（hash）
public/mos/js/modules/{workspace,projects,brand,guidelines,reference,planning,topics,tasks,campaigns,intelligence,stage}.js
```

### 新增 — 测试与证据工具（5 个）
```
tools/mos-unit-test.js      # 25 条单元断言
tools/mos-smoke-test.js     # 13 条接口冒烟
tools/mos-e2e-test.js       # 47 条端到端 + 安全（含重启持久化）
tools/mos-ui-check.js       # 32 条真实浏览器（CDP）断言 + 25 张截图
tools/run-mos-tests.sh      # 统一入口，产出 TEST_EVIDENCE_MOS_BUILD01/summary.json
```

### 新增 — 文档与配置（4 个）
```
docs/marketing-os/ARCHITECTURE_AUDIT.md      # 步骤 0 仓库诊断（含风险登记 R-01…R-06）
docs/marketing-os/ADRs/ADR-001-tech-stack.md # 技术栈 ADR（Accepted）
docs/marketing-os/MOCK_REAL_MATRIX.md        # Mock/Real 矩阵（含代码级诚实性边界）
docs/marketing-os/BUILD-01_TEST_REPORT.md    # 本批次测试报告
.env.example                                  # OA + MOS 环境变量模板（无任何凭据字面量）
```

### 修改 — 既有文件（**仅 4 处，均为增量/缺陷修复**）
| 文件 | 改动 | 说明 |
|---|---|---|
| `server.js` | +3 处挂载：`/api/mos/` 路由分流、启动时加载 MOS 库、关闭时 `saveNow()`；横幅 +1 行 | 不改既有路由与中间件顺序 |
| `lib/store.js` | `flush()` 中异步 `fs.rename` → **`fs.renameSync`** | **修复既有数据丢失竞态**（详见 ③ 与 ⑦） |
| `.gitignore` | 增加 `data-mos-*/`、`UI_EVIDENCE_MOS_BUILD01/` | 隔离测试产物 |
| 新增 `lib/mos/**`、`public/mos/**`、`tools/mos-*`、`docs/marketing-os/**`、`.env.example` | — | 见上 |

> **未新增任何业务模块**：S05 客户增长、品牌声誉/风险专项、营销线索移交与闭环、CRM、代理后台、卡交易、自动社媒发布
> **均无菜单、无 API、无数据库集合、无假流程**（`00 §0.1-6 / §3`、`11 §已冻结的 MARK`）。

---

## ③ 迁移操作与回滚

### 迁移（自动、幂等）
| 项 | 内容 |
|---|---|
| 新增数据文件 | `<OA 数据目录>/mos.json`（默认 `data/mos.json`） |
| MOS schema 版本 | `mosSchemaVersion: 1`（**与 OA 的 `version: 3` 完全独立**） |
| 首次启动行为 | 建空库 → `migrate()` → 写入 DEMO 种子 → 打印一次性管理员口令与 DEMO 口令（**打印后立即从内存删除，不落盘**） |
| 对 OA 主库的影响 | **无**。`db.json` 结构与 `version` 均未改动；OA 的 `version === 3` 断言保持成立 |
| 新库与老库同源 | `load()` 在 seed 之后同样执行 `migrate()`，保证"首启库"与"历史库升级"得到完全一致的形状 |
| 环境变量开关 | `OA_MOS_ENABLED=false` 可整体关闭子系统（关闭后不创建 mos.json、不挂载路由） |

### 回滚（三步，可完整还原）
```bash
# 1) 关闭子系统（立即生效，无需改动代码）
export OA_MOS_ENABLED=false

# 2) 若要彻底移除代码（可选）
git rm -r lib/mos public/mos public/mos.html public/mos/app.css tools/mos-*.js tools/run-mos-tests.sh docs/marketing-os .env.example
# 并还原 server.js 的 3 处挂载

# 3) 删除 MOS 数据文件（OA 数据完全不受影响）
rm -f data/mos.json
```
**回滚不需要任何数据迁移**：MOS 数据与 OA 数据物理分离，删除 `mos.json` 不触及 `db.json`。

---

## ④ 测试命令与通过结果

```bash
bash tools/run-mos-tests.sh all        # ⇒ EXIT=0
bash tools/run-tests-v113.sh all       # ⇒ EXIT=0（OA 无回归）
```

| 套件 | 断言 | 通过 | 失败 |
|---|---|---|---|
| `mos-unit`（字典/状态机/RBAC/SSRF/RSS/去重/脱敏/哈希） | 25 | 25 | 0 |
| `mos-smoke`（接口冒烟） | 13 | 13 | 0 |
| `mos-e2e`（E2E-01 + E2E-02 + SEC-03/04/05 + 审计 + 重启持久化） | 47 | 47 | 0 |
| `mos-ui`（真实 Chrome/CDP，含页面级操作 + 刷新持久化） | 32 | 32 | 0 |
| **合计** | **117** | **117** | **0** |

OA 侧同时：`bash tools/run-tests-v113.sh all` → **EXIT=0**，12 个子套件全绿，`AUD-14 结果：PASS（命中 0 处）`。

明细与失败修复记录见 `BUILD-01_TEST_REPORT.md`（含 10 项调试过程，**失败用例一律记录在案，不包装成通过**）。

---

## ⑤ Mock / Real 状态

完整矩阵见 `MOCK_REAL_MATRIX.md`，此处摘要（唯一权威来源为 `lib/mos/config.js`）：

| 能力 | 状态 | 诚实性保障 |
|---|---|---|
| 身份 / 登录 | **mock** | 顶栏与 `/api/mos/identity/status` 显式 `mode:"mock"` |
| 企业知识库 | **mock** | 返回 `sandbox:true` |
| 企业资料库（入库/检索） | **mock** | 回执/ID 一律 `MOCK_` 前缀；`searchApproved` **恒返回空**；最终授权只能得 `MOCK_APPROVED`；**不产生 `AVAILABLE`** |
| 外部情报采集 | **real** | 真实出站 HTTP，受 allowlist + SSRF 拦截 + 超时/体积上限；失败如实落 `lastError` |
| 文本模型 | **none** | 摘要状态显式四态（`NOT_CONFIGURED/MOCK/INTEGRATION_PENDING/BLOCKED`） |
| 图像模型 | **none** | BUILD-02 范围；无密钥时显示"尚未配置"，不产出图像 |
| OA 企业接口 | **未接通** | 顶栏固定显示，`INTEGRATION_PENDING` |

> 任何从 `mock` → `real` 的变更都必须同步更新矩阵文档并附验证证据（已写入 `config.js` 注释作为硬约束）。

---

## ⑥ 安全检查

| 项 | 措施 | 验证 |
|---|---|---|
| 认证 | scrypt 口令哈希、`HttpOnly + SameSite` Cookie、首登强制改密、登录失败锁定 | smoke / UI 用例 |
| 会话 | 独立 `mos_sid`（与 `oa_sid` 互不影响）、12h 过期、登出即失效、**重启后仍有效** | E2E PERSIST-02 |
| CSRF | 双提交令牌 + Origin/Referer 校验 | 所有写接口 |
| 授权 | 服务端 RBAC + 品牌 ABAC；**默认拒绝**；**授权先于状态判定**（403 不泄露对象状态） | U-04/05/05b；E2E-02m/02m2 |
| 品牌隔离 | 越权与不存在同码 404；跨品牌关联 400 | SEC-03/03b/03c/03d/03e |
| SSRF | allowlist + DNS 解析 + 私网/回环/链路本地/云元数据(169.254.169.254)/CGNAT/IPv6 ULA 拦截；默认 https-only；失败 fail closed | U-07；SEC-05/05b |
| Prompt 注入 | 外部网页内容**只作数据**，绝不进入指令通道 | U-08；E2E-01f |
| 审计 | append-only；`password/token/apiKey/session` 自动脱敏；值长度截断；越权统一 `permission.denied` | AUD-01/AUD-02；U-11 |
| 密钥管理 | 无任何硬编码凭据；口令运行期随机；`.env.example` 只列变量名 | `secret-scan-v113.js`（AUD-14）**零命中** |
| 数据落盘 | 原子写（临时文件 + `rename`），**同步收口避免旧快照覆盖新快照** | U-10；PERSIST-01 |
| 输出安全 | 全站 `esc()` 转义、CSP `default-src 'self'` | UI 无控制台 error / 无未捕获异常 |
| 特权独立 | `library.asset.approve.final` **不随 P1 / MOS_ADMIN 自动授予** | **U-04c** |

> ⚠ 本批次**尚不构成生产安全结论**：真实 SSO/MFA、渗透测试、监控告警、资料库实际入库/撤回验证等均未进行（`06 §6` 阻断清单）。

---

## ⑦ 未完成 / 阻断

### A. 阻断（需外部条件，非本批次可解）
| # | 阻断项 | 影响 | 解除条件 |
|---|---|---|---|
| B-01 | 真实 OA / SSO / 身份接口未审计接通 | 只能用 Mock 身份 | OA 最新源码/API 审计 + OIDC/SSO 对接 |
| B-02 | 企业资料库 API 未审计接通 | 入库/检索只能 Mock，**不得宣称可复用** | 资料库 API 审计 + 幂等回执持久化验证 + Gate D |
| B-03 | 企业知识库未接通 | 知识检索为沙盒数据 | 同 B-02 |
| B-04 | `SPECIAL-01` 手册与 `Visual Brand Guardian Skill V1.2` 文件包未提供 | C/N/V/F/M/A/G 字典由代码内置并统一标注 `provisional:true`（**不臆造标签**） | 收到文件后经 `config.json → mos.dictionaries` 覆盖为正式标签 |
| B-05 | 文本/图像模型 Provider 未接入 | 摘要与视觉产出必须显示未配置 | 供应商 DPA/数据地域/训练条款确认 + Key 注入 |
| B-06 | 外部资讯许可（robots/服务条款/法务）未确认 | 采集能力已具备，但**生产启用前须法务放行** | 许可清单确认 |

### B. 本阶段已知限制（可接受，记录在案）
| # | 限制 | 影响面 | 计划 |
|---|---|---|---|
| L-01 | DEMO 种子月度计划使用**固定月份** `plan_vfib_2026_10_v1` | 跨月后演示数据不在"当月"，仅影响观感 | BUILD-02 转为"当前月"动态生成 |
| L-02 | 外部采集目前仅 RSS 全量拉取，无增量游标/定时任务 | 需人工点"采集" | BUILD-02 引入 jobs + 锁 + 幂等 |
| L-03 | 统一日历仅展示计划/任务节点，无拖拽落库的前端手势 | 已具备等价的服务端改期路径（E2E-02j 验证） | BUILD-02 补拖拽交互 |
| L-04 | 前端 hash 路由，无服务端渲染 | 不影响功能 | 不在 V0.1 范围 |

### C. 本批次**未做**（属 BUILD-02/03，非遗漏）
内容版本冻结与 ReviewCase、文案/视觉 Studio、Skill Loader、WorkingAsset/GenerationJob、发布日历/Queue/Published Archive、
三条审核链与最终入库特权落地、Analytics 真实聚合、E2E-03/04/05、SEC-01/02/07/08/09/10。

---

## ⑧ 下轮范围（BUILD-02：AI 创作 + 传播）

依据 `09 §3`，下轮必须完成并**可操作性验收**：

1. **ContentVersion 锁定与 ReviewCase**：版本冻结后正文/引用图像变更必须产生新版本并重审（为 SEC-02 铺路）。
2. **文案编辑器**：证据侧栏、C/N/V 规范校验、证据引用落库。
3. **Skill Loader 与模板选择**：至少一个 Provider **真实接入**；无 Key 时 Mock 与实接状态分离展示。
4. **WorkingAsset / GenerationJob**：记录 Skill / 模型 / Prompt / 费用 / 文件；基础 QA 与预算上限（超限 `BUDGET_EXCEEDED`）。
5. **Video Workspace**：脚本 / 分镜 / 字幕草案。
6. **渠道与发布**：Calendar → Queue → **人工发布登记**（URL/证据/时间）→ **不可覆盖的 Published Archive 快照**。
   —— 到期**不得**自动标 `PUBLISHED`；纠正/撤回保留旧档；未导入企业资料库。
7. **E2E-03 / E2E-04 通过**，并补 SEC-02 / SEC-04 全量。

### 下轮开工前需要业务方确认的事项
| # | 待确认 | 选项 |
|---|---|---|
| Q-01 | 图片 Provider 选型（首个真实接入的 Provider） | 供应商 / 模型 / 数据地域 / 是否需要国内节点 |
| Q-02 | 文本 Provider 是否复用现有 DeepSeek 配置 | 复用 / 另配 |
| Q-03 | `SPECIAL-01` 与 Visual Guardian 文件包何时提供 | 用于把 `provisional` 字典替换为正式标签 |
| Q-04 | 来源采集的许可清单与允许域名范围 | 是否扩充/收窄默认 allowlist（当前 10 个公开机构域名） |

> **本批次不构成生产可用结论。** 8 个中心中 4 个为状态页、4 个具备可操作能力；未接通的集成全部显式标注，
> 不存在"看起来成功"的伪实现。BUILD-01 交付后建议由业务方开展 UI 审计（`09 §7`），审计通过后再进入 BUILD-02。
