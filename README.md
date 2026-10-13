# VFIB Marketing OS V0.1

智能品牌传播与市场运营中台 —— **独立运行的零第三方依赖 Node 应用**。

不是 PPT 展示页，不是 OA 替代品，不是企业资料库副本。所有页面都具备真实操作与持久化能力。

- 版本：`0.1.0`（`lib/mos/config.js` 的 `MOS_VERSION`，单一来源）
- 数据 schema：`mosSchemaVersion = 3`（v1→v2→v3 只增不改，见 `lib/mos/store.js` `migrate()`）
- 当前阶段：**BUILD-01（基础 + 策划）、BUILD-02（AI 创作 + 传播）、BUILD-03（资产入库 + 分析 + 治理）已交付**；BUILD-04 未开工

> ⚠ **本工程尚未接通任何外部真实系统**。企业资料库、SSO、模型 Provider、真实金融数据源均未完成源码级集成审计。
> 凡标注 `MOCK` 的能力**不代表已打通**，详见 [docs/MOCK_REAL_MATRIX.md](docs/MOCK_REAL_MATRIX.md)。
> **当前不构成生产可用结论。**

---

## 快速开始

```bash
# 依赖：Node.js >= 18（无需 npm install —— 零第三方依赖）
node server.js
```

启动后控制台会打印访问地址与集成状态。默认 `http://127.0.0.1:9080`。

**首次初始化会打印一次账号口令**（仅终端输出，不落盘）：

| 账号 | 角色 | 说明 |
|---|---|---|
| `mosadmin` | 引导管理员 | 口令取 `MOS_ADMIN_PASSWORD`，未设置则随机生成；**首登强制改密** |
| `demo.p1` / `demo.p2` / `demo.p3` | P1 / P2 / P3+发布审批 | DEMO 演示身份，共享一个随机口令 |
| `demo.reviewer` | 专业复核 | 同上 |
| `demo.lfa` | 资料库最终授权 | 同上 |

口令遗失：停服后删除 `data/mos.json` 重新初始化（会丢失全部业务数据）。

```
访问入口：http://127.0.0.1:9080/        系统外壳
健康检查：http://127.0.0.1:9080/api/health
业务接口：http://127.0.0.1:9080/api/mos/*
```

---

## 目录结构

```
├── server.js                  # 独立入口：http / 静态资源 / CSP / 优雅关闭
├── package.json
├── config.example.json        # 复制为 config.json（已 gitignore）
├── .env.example               # 环境变量样例（只列变量名，不含凭据）
├── lib/
│   ├── config.js              # 进程级配置（端口 / 数据目录 / 网络安全）
│   ├── util.js                # HTTP 请求体、响应封装、MIME、上传魔数校验
│   ├── net.js                 # CIDR / IP 逐位比较（SSRF 与白名单基座）
│   ├── security.js            # Origin 校验 + CSRF 双提交 + Cookie 构造
│   ├── password.js            # scrypt 口令哈希
│   ├── static.js              # 静态资源服务（目录穿越防护）
│   └── mos/                   # ★ 业务主体
│       ├── config.js          #   集成状态矩阵（Mock/Real 唯一权威来源）
│       ├── dict.js            #   品牌 / 权限点 / 角色 / C·N·V·F·M·A·G 字典
│       ├── ids.js             #   业务编码（计划号 / 任务号 / 内容版本号）/ 内容哈希
│       ├── store.js           #   原子落盘 + schema 迁移 + 首启一次性口令
│       ├── seed.js            #   引导账号 + DEMO 身份与业务数据
│       ├── audit.js           #   append-only 审计 + 敏感键脱敏
│       ├── rbac.js            #   RBAC + 品牌级 ABAC
│       ├── router.js          #   路由表 + CSRF/限流/强制改密闸门
│       ├── adapters/          #   identity / knowledge / library / source / text 适配器
│       └── routes/            #   auth / meta / plans / campaigns / topics / tasks / sources / admin
├── public/
│   ├── mos.html               # 系统外壳（登录门 / 改密门 / 8 中心导航 / 品牌切换 / 集成条）
│   └── mos/                   # app.css + js/（原生 ES Module，零 CDN）
├── tools/                     # 自检脚本（含统一入口与真实浏览器 UI 回归）
├── docs/                      # 架构审计、ADR、测试报告、自审报告、Mock/Real 矩阵
└── data/                      # 运行时数据（mos.json + uploads），已 gitignore
```

---

## 自检

```bash
bash tools/run-mos-tests.sh all     # 全部套件
bash tools/run-mos-tests.sh e2e03   # 只跑某一套：smoke | unit | sec | sched | provider | workspace | e2e | e2e02 | e2e03 | ui
```

| 套件 | 覆盖内容 | 断言数 |
|---|---|---|
| `smoke` | 接口可用性与鉴权闭环（登录、改密闸门、字典、日历、审计） | 13 |
| `unit` | 字典 / 状态机 / RBAC / SSRF / RSS 解析 / 去重 / 脱敏 / 内容哈希 / 业务编码 / 入库状态机 · 可复用判定 · 预检 · 数据分级 · Mock 网关幂等 · schema v4 迁移 · S04 Marketing Brief 核验 · **F-07 字典核验门禁 · A-05 Provider 契约 · A-06 资料库契约** | 69 |
| `sec` | **出站采集安全**：SSRF 拦截矩阵、重定向逐跳、DNS 重绑定、压缩/体积上限、生产闸门（不依赖公网 DNS） | 17 |
| `sched` | **A-01 轻量来源调度**：默认关闭、可调度判定、真实抓取、时间桶幂等、跨重启不补发、退避与有界重试、永久失败、单实例锁、fail closed、schema v4 | 20 |
| `provider` | **A-05 Provider 统一契约**：离线诚实性（未配置→NOT_CONFIGURED、零出站、密钥不外泄）、本地桩验证 invoke/timeout/rateLimit/costReceipt/errorCode、真实端到端（有凭据时；否则按 BLOCKED 如实记录） | 21 |
| `workspace` | **A-06 企业资料库适配层契约**：canonicalString/封套/错误码表对齐 Workspace V1.1.7；Ed25519 签名互通与篡改检测；本地桩验签+防重放+GET query 不参与签名；fail closed；服务账户无最终审批权 | 30 |
| `e2e` | E2E-01 外部信息→Master Topic、E2E-02 月度计划→Calendar、跨品牌越权、SSRF、审计、**重启后数据与会话不丢失（含落盘前置条件）** | 48 |
| `e2e02` | **E2E-03 AI 创作与审核链、E2E-04 排期/人工发布/归档**、SEC-02 真实改盘篡改、SEC-04 未批准不得发布、预算闸门、幂等、无自动发布 | 63 |
| `e2e03` | **E2E-05 资产入库全流程**（申请→预检→最终审批→资料库同步→失败恢复）、SEC-01/02/07/08/09/10 全量、Analytics 真实聚合与缺失语义、治理收口、**调度 API / 字典核验 API / Provider 与资料库状态** | 94 |
| `ui` | **CDP 驱动本机真实 Chrome**：页面内完成写操作 → `Page.reload` → 数据仍在（含 BUILD-02 五个页面、**BUILD-03 运营分析 / 治理与资产**、**Phase 2 Campaign Marketing Brief / Deliverables / All Tasks 深链接 / VFIB·U CARD 营销工作区**、**Phase 3 情报页采集调度面板**） | 97 |

- 每套自带**随机数据目录**（`data-mos-*`）与**运行期随机口令**，跑完自动清理，绝不触碰 `data/`。
- 结果落 `TEST_EVIDENCE_MOS_BUILD01/`（含 `summary.json`）；BUILD-02 / BUILD-03 端到端证据分落 `TEST_EVIDENCE_MOS_BUILD02/`、`TEST_EVIDENCE_MOS_BUILD03/`；UI 截图分落 `UI_EVIDENCE_MOS_BUILD01|02|03|04|05/`。
- 任一断言失败 → 退出码非 0，可直接接入 CI。
- 当前全绿：**472/472**（Phase 3 完成时）。
- **无凭据即 BLOCKED，不阻断本地构建**：`provider` 套件在无密钥时仍全绿（真实端到端如实记 BLOCKED）；
  `workspace` 套件为纯离线契约自检（真实联调 `NOT_VERIFIED`）。

---

## 集成状态（Mock / Real）

**唯一权威来源**是 `lib/mos/config.js` 的 `integrations`，可用 `config.json → mos` 或 `MOS_*` 环境变量覆盖。

| 能力 | 当前状态 | 说明 |
|---|---|---|
| 身份认证 | `mock` | 本地隔离测试身份，非企业 SSO/OIDC |
| 知识库检索 | `mock` | 沙盒数据 |
| 企业资料库 | `mock` | 回执强制 `MOCK_` 前缀、`permissionValid:false`、`assetState:MOCK_SANDBOX`、检索恒返回空、最终授权只能得 `MOCK_APPROVED`；**`AVAILABLE`（可复用）结构性不可达** |
| 外部情报采集 | `real` | 真实 HTTP 出站，受域名白名单 + DNS/IP 拦截 + 超时/体积上限约束 |
| 文本模型 | `none` | 摘要四态：`NOT_CONFIGURED` / `MOCK` / `INTEGRATION_PENDING` / `BLOCKED` |
| 图像模型 | `none` | 代码就绪（`mock` / `openai`），无 Key 未验证 |
| 平台指标 API | 未接通 | Analytics 无数据来源的指标一律显示「缺失」，**不用 0 或示例值填充** |
| 企业 OA 接口 | 未接通 | — |

> **任何 `mock` → `real` 的变更，必须同步更新 `docs/MOCK_REAL_MATRIX.md` 并写明验证方式。**

代码层的诚实性硬边界（不要削弱）：资料库回执 `MOCK_` 前缀 + `permissionValid:false`、`searchApproved` 恒空、最终授权只能 `MOCK_APPROVED`、
可复用资格由服务端**计算**（Mock 下恒为 `false`）、分析指标无来源即显示「缺失」；
外部网页内容**只当数据、绝不当指令**（防提示注入）；采集失败或来源未核验一律 fail closed，不伪造成功。

---

## 安全基线

- **访问控制由后端强制**：能力判定不依赖前端隐藏（`lib/mos/rbac.js`，`assertCan` 拒绝时写审计）。
- **CSRF**：Origin/Referer 校验 + 双提交令牌（Cookie `mos_csrf` ↔ 头 `x-mos-csrf`），令牌不进响应体、不进 localStorage。
- **会话**：HttpOnly + SameSite=Strict Cookie `mos_sid`，12 小时有效，登录失败锁定。
- **SSRF 防御**：出站域名白名单 + DNS 解析后 IP 复检 + 拦截回环/私网/链路本地/云元数据（`169.254.169.254`）/CGNAT/ULA。
  白名单为空 = **拒绝一切真实出站**（fail closed）。
- **落盘原子性**：唯一临时名 + 回调内同步 `renameSync` + 写入序号防回退。
- **审计**：append-only，敏感键（password / token / apiKey 等）自动脱敏，超长值截断。
- **fail closed 启动校验**：非法 CIDR / 非法 Cookie 策略 → 拒绝启动，不静默降级。
- **零外发**：CSP `default-src 'self'`，无任何 CDN 依赖，离线环境可完整运行。

### 关于「技术管理员」
`MOS_ADMIN` **不含** `library.asset.approve.final` —— 技术管理员不自动获得业务特权，需独立授权。

---

## 配置

优先级：**内置默认 < `config.json` < 环境变量（`MOS_*`）**。

- `config.json` 由 `config.example.json` 复制而来，含本地配置，**已 gitignore，不要提交**。
- **所有变量名见 [.env.example](.env.example)**（只列变量名，不含任何凭据）。
- 常用：`MOS_PORT`（默认 9080）、`MOS_HOST`、`MOS_DATA_DIR`、`MOS_ADMIN_PASSWORD`、
  `MOS_SOURCE_INGEST`、`MOS_EGRESS_ALLOWED_HOSTS`、`MOS_TRUSTED_PROXIES`、`MOS_ALLOWED_CLIENT_CIDRS`。

### 端口约定（与本工程同机部署的其他系统必须互斥）

| 用途 | 端口 |
|---|---|
| 本工程默认 | **9080** |
| 本工程自检 | **9500-9699**（随机分配；UI 套件的 CDP 从 9600 起） |
| 企业 OA 侧已占用（**不要用**） | 8080-8082、8090-8097、8101-8104、8121-8122、8866、8899、9223、9333-9336、9999 |

> 同机运行两个仓库时端口表必须显式互斥。迁移过程中曾**两次**因端口重叠导致对方自检出现「假失败」
> （请求打到了另一套服务上），详见 [ADR-002](docs/ADRs/ADR-002-standalone-repo.md)。

---

## 已知边界与未完成事项

- **未接通**：企业资料库真实 API、企业 SSO、文本/图像模型 Provider、真实金融数据源。
  BUILD-02 的模型适配器（`mock` / `openai` / `deepseek`）为**代码就绪但无密钥未验证**，不宣称已打通。
- **字典为临时口径**：`SPECIAL-01 手册` 与 Visual Brand Guardian 文件包尚未提供，C/N/V/F/M/A/G 字典由代码内置并统一标
  `provisional: true`（**不臆造标签**）。拿到正式材料后经 `config.json → mos.dictionaries` 覆盖。
- **明确不做**（规格标注 MARK/DEFERRED）：客户增长、品牌声誉监测、线索交接、CRM、代理后台、卡交易、自动社媒发布、视频自动渲染/配音/剪辑。
- **DEMO 种子**的月度计划使用固定月份，跨月后不在「当月」，仅影响演示观感。
- **发布为人工登记**：系统内无任何定时器，到期不自动发布；`PUBLISHED` 只能由人工提交真实 URL/证据产生。
- **资产入库证据链**：最终入库许可 `library.asset.approve.final` 为**独立特权**，不复用预检权限；
  入库申请的双字段（最终审批 / 同步）互不推导；Mock 资料库下 `AVAILABLE` 不可达（UI 与 API 均如实说明）。
- **Windows 平台注意**：`kill('SIGTERM')` 为硬终止，服务端优雅关停分支不会执行。
  因此安全关键写入（登录/登出会话）已改为**创建即同步落盘**，不依赖关停兜底（见 `docs/BUILD-03_SELF_AUDIT.md` A-26）。

## 文档索引

| 文档 | 内容 |
|---|---|
| [docs/ARCHITECTURE_AUDIT.md](docs/ARCHITECTURE_AUDIT.md) | 架构审计与风险登记 |
| [docs/ADRs/ADR-001-tech-stack.md](docs/ADRs/ADR-001-tech-stack.md) | 技术栈决策（复用零依赖栈，不引 Next.js/PostgreSQL） |
| [docs/ADRs/ADR-002-standalone-repo.md](docs/ADRs/ADR-002-standalone-repo.md) | 从企业 OA 仓库剥离为独立工程 |
| [docs/MOCK_REAL_MATRIX.md](docs/MOCK_REAL_MATRIX.md) | Mock / Real 集成矩阵 |
| [docs/BUILD-01_TEST_REPORT.md](docs/BUILD-01_TEST_REPORT.md) | BUILD-01 测试报告（含 10 项调试过程） |
| [docs/BUILD-01_SELF_AUDIT.md](docs/BUILD-01_SELF_AUDIT.md) | BUILD-01 自审报告 |
| [docs/BUILD-02_PLAN.md](docs/BUILD-02_PLAN.md) | BUILD-02 代码审计与开发计划 |
| [docs/BUILD-02_TEST_REPORT.md](docs/BUILD-02_TEST_REPORT.md) | BUILD-02 测试报告（E2E-03/04 + SEC-02 真实篡改路径） |
| [docs/BUILD-02_SELF_AUDIT.md](docs/BUILD-02_SELF_AUDIT.md) | BUILD-02 自审报告（含 A-09…A-15 缺陷处置） |
| [docs/BUILD-03_PLAN.md](docs/BUILD-03_PLAN.md) | BUILD-03 代码审计与开发计划 |
| [docs/BUILD-03_TEST_REPORT.md](docs/BUILD-03_TEST_REPORT.md) | BUILD-03 测试报告（E2E-05 + SEC 全量 + Analytics 缺失语义） |
| [docs/BUILD-03_SELF_AUDIT.md](docs/BUILD-03_SELF_AUDIT.md) | BUILD-03 自审报告（含 A-16…A-27 缺陷处置） |
