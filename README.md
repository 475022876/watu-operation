# VFIB Marketing OS V0.1

智能品牌传播与市场运营中台 —— **独立运行的零第三方依赖 Node 应用**。

不是 PPT 展示页，不是 OA 替代品，不是企业资料库副本。所有页面都具备真实操作与持久化能力。

- 版本：`0.1.0`（`lib/mos/config.js` 的 `MOS_VERSION`，单一来源）
- 数据 schema：`mosSchemaVersion = 1`
- 当前阶段：**BUILD-01（基础 + 策划）已交付**；BUILD-02 / BUILD-03 未开工

> ⚠ **本工程尚未接通任何外部真实系统**。企业资料库、SSO、模型 Provider、真实金融数据源均未完成源码级集成审计。
> 凡标注 `MOCK` 的能力**不代表已打通**，详见 [docs/MOCK_REAL_MATRIX.md](docs/MOCK_REAL_MATRIX.md)。
> **当前不构成生产可用结论。**

---

## 快速开始

```bash
# 依赖：Node.js >= 18（无需 npm install —— 零第三方依赖）
node server.js
```

启动后控制台会打印访问地址与集成状态。默认 `http://127.0.0.1:8090`。

**首次初始化会打印一次账号口令**（仅终端输出，不落盘）：

| 账号 | 角色 | 说明 |
|---|---|---|
| `mosadmin` | 引导管理员 | 口令取 `MOS_ADMIN_PASSWORD`，未设置则随机生成；**首登强制改密** |
| `demo.p1` / `demo.p2` / `demo.p3` | P1 / P2 / P3+发布审批 | DEMO 演示身份，共享一个随机口令 |
| `demo.reviewer` | 专业复核 | 同上 |
| `demo.lfa` | 资料库最终授权 | 同上 |

口令遗失：停服后删除 `data/mos.json` 重新初始化（会丢失全部业务数据）。

```
访问入口：http://127.0.0.1:8090/        系统外壳
健康检查：http://127.0.0.1:8090/api/health
业务接口：http://127.0.0.1:8090/api/mos/*
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
bash tools/run-mos-tests.sh unit    # 只跑某一套：smoke | unit | e2e | ui
```

| 套件 | 覆盖内容 | 断言数 |
|---|---|---|
| `unit` | 字典 / 状态机 / RBAC / SSRF / RSS 解析 / 去重 / 脱敏 / 内容哈希 / 业务编码 | 25 |
| `smoke` | 接口可用性与鉴权闭环（登录、改密闸门、字典、日历、审计） | 13 |
| `e2e` | E2E-01 外部信息→Master Topic、E2E-02 月度计划→Calendar、跨品牌越权、SSRF、审计、**重启后数据与会话不丢失** | 47 |
| `ui` | **CDP 驱动本机真实 Chrome**：页面内完成写操作 → `Page.reload` → 数据仍在 | 32 |

- 每套自带**随机数据目录**（`data-mos-*`）与**运行期随机口令**，跑完自动清理，绝不触碰 `data/`。
- 结果落 `TEST_EVIDENCE_MOS_BUILD01/`（含 `summary.json`），UI 截图落 `UI_EVIDENCE_MOS_BUILD01/`。
- 任一断言失败 → 退出码非 0，可直接接入 CI。

---

## 集成状态（Mock / Real）

**唯一权威来源**是 `lib/mos/config.js` 的 `integrations`，可用 `config.json → mos` 或 `MOS_*` 环境变量覆盖。

| 能力 | 当前状态 | 说明 |
|---|---|---|
| 身份认证 | `mock` | 本地隔离测试身份，非企业 SSO/OIDC |
| 知识库检索 | `mock` | 沙盒数据 |
| 企业资料库 | `mock` | 回执强制 `MOCK_` 前缀、检索恒返回空、最终授权只能得 `MOCK_APPROVED` |
| 外部情报采集 | `real` | 真实 HTTP 出站，受域名白名单 + DNS/IP 拦截 + 超时/体积上限约束 |
| 文本模型 | `none` | 摘要四态：`NOT_CONFIGURED` / `MOCK` / `INTEGRATION_PENDING` / `BLOCKED` |
| 图像模型 | `none` | BUILD-02 才接入 |
| 企业 OA 接口 | 未接通 | — |

> **任何 `mock` → `real` 的变更，必须同步更新 `docs/MOCK_REAL_MATRIX.md` 并写明验证方式。**

代码层的诚实性硬边界（不要削弱）：资料库回执 `MOCK_` 前缀、`searchApproved` 恒空、最终授权只能 `MOCK_APPROVED`；
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
- 常用：`MOS_PORT`（默认 8090）、`MOS_HOST`、`MOS_DATA_DIR`、`MOS_ADMIN_PASSWORD`、
  `MOS_SOURCE_INGEST`、`MOS_EGRESS_ALLOWED_HOSTS`、`MOS_TRUSTED_PROXIES`、`MOS_ALLOWED_CLIENT_CIDRS`。

---

## 已知边界与未完成事项

- **未接通**：企业资料库真实 API、企业 SSO、文本/图像模型 Provider、真实金融数据源。
- **字典为临时口径**：`SPECIAL-01 手册` 与 Visual Brand Guardian 文件包尚未提供，C/N/V/F/M/A/G 字典由代码内置并统一标
  `provisional: true`（**不臆造标签**）。拿到正式材料后经 `config.json → mos.dictionaries` 覆盖。
- **明确不做**（规格标注 MARK/DEFERRED）：客户增长、品牌声誉监测、线索交接、CRM、代理后台、卡交易、自动社媒发布。
- **DEMO 种子**的月度计划使用固定月份，跨月后不在「当月」，仅影响演示观感。
- BUILD-02 / BUILD-03 页面为占位页，会明确标注所属阶段，不假装可用。

## 文档索引

| 文档 | 内容 |
|---|---|
| [docs/ARCHITECTURE_AUDIT.md](docs/ARCHITECTURE_AUDIT.md) | 架构审计与风险登记 |
| [docs/ADRs/ADR-001-tech-stack.md](docs/ADRs/ADR-001-tech-stack.md) | 技术栈决策（复用零依赖栈，不引 Next.js/PostgreSQL） |
| [docs/ADRs/ADR-002-standalone-repo.md](docs/ADRs/ADR-002-standalone-repo.md) | 从企业 OA 仓库剥离为独立工程 |
| [docs/MOCK_REAL_MATRIX.md](docs/MOCK_REAL_MATRIX.md) | Mock / Real 集成矩阵 |
| [docs/BUILD-01_TEST_REPORT.md](docs/BUILD-01_TEST_REPORT.md) | BUILD-01 测试报告（含 10 项调试过程） |
| [docs/BUILD-01_SELF_AUDIT.md](docs/BUILD-01_SELF_AUDIT.md) | BUILD-01 自审报告 |
