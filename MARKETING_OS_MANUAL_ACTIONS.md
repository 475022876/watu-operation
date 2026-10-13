# MARKETING_OS_MANUAL_ACTIONS —— V0.1.1 受控试运行需人工执行的动作清单

> 配套：[`MARKETING_OS_PILOT_READINESS_REPORT.md`](MARKETING_OS_PILOT_READINESS_REPORT.md) §9、
> [`MARKETING_OS_DEPLOYMENT_CHECKLIST.md`](MARKETING_OS_DEPLOYMENT_CHECKLIST.md)
> 原则：**以下各项均无法由本侧单方完成**（需要口令、凭据、授权或真人判断）；
> 在完成前，系统保持"不出站"受控状态，相关功能如实呈现 BLOCKED / NOT_CONFIGURED / 待核验。
> 日期：2026-10-14

---

## A-1 账号与口令（试运行开始前，必做）

| # | 动作 | 执行人 | 要点 |
| --- | --- | --- | --- |
| 1 | 确认 `admin` 初始口令已更换 | 运营管理员 | 初始口令仅首启打印一次；若丢失：停服 → `node tools/mos-reset-password.js`（保留业务数据） |
| 2 | 创建试运行**真人**账号并分配角色 | 运营管理员 | `POST /api/mos/admin/users`；口令 ≥8 位、**避免符号**（IME 全角/空格会导致登录失败）；勾选 `mustChangePassword` 让本人首次登录自改 |
| 3 | 按**最小权限**分配 brandScope | 运营管理员 | 例如：P1/P3 仅 VFIB；`LIBRARY_FINAL_APPROVER` 仅授予真人审批人；**不得**默认双品牌 |
| 4 | 决定 `demo.*` 演示账号的存留 | 业务方 | 演示账号只用于演示，**不得**计入真人验收证据 |

## A-2 企业资料库真实联通（需要资料库侧配合）

| # | 动作 | 责任方 | 要点 |
| --- | --- | --- | --- |
| 1 | 签发**服务账户**（keyId + Ed25519 公钥登记） | **资料库方** | 集成账户管理端点登记公钥；本侧持私钥文件 |
| 2 | 明确服务账户 `allowedBrands` 与 scope | 资料库方 | 决定 VFIB/UCARD 可用范围；scope 决定可调用端点 |
| 3 | 交付 `LIBRARY_HANDOFF_BUNDLE`（对齐本轮 V1.1/V1.2 契约） | 资料库方 | OpenAPI SHA256 必须仍为 `cd3cc198…`（契约 1.0 冻结） |
| 4 | 提供双方确认的**用户映射表** | 双方 | `MOS_WORKSPACE_USER_MAP=mosUserId=providerUserId,…`；未映射用户零出站 |
| 5 | 配置并启用 | 本侧运维 | `MOS_LIBRARY=real` + `MOS_WORKSPACE_BASE_URL/KEY_ID/PRIVATE_KEY_PATH/BRANDS/ALLOWED_HOSTS` + `MOS_WORKSPACE_POLL_ENABLED=1`；随后 `integration/probe` 验证 |
| 6 | 授权真人最终审批 | 业务方 | Staging 环境由**真实持权人**完成一次最终审批签认（解除 INT-04 的真人条件） |
| 7 | 确认版本口径 | **资料库方** | 其 `RELEASE_REGISTER.md` 记 1.1.7 vs 工作区 1.1.8 不一致，需给权威值；并处置工作区 3 个未提交代码文件 |

## A-3 真实 AI Provider（需要密钥与费用授权）

| # | 动作 | 责任方 | 要点 |
| --- | --- | --- | --- |
| 1 | 提供**非生产**密钥 | 用户/业务方 | 仅注入 `MOS_TEXT_API_KEY` / `MOS_IMAGE_API_KEY`（或 config 的 `mos.text|image.apiKey`，**该文件不入库**）；密钥绝不写入日志/证据/前端 |
| 2 | 设定预算额度 | 用户/业务方 | `mos.budget.brandMonthlyUsd` 与 `perJobUsdMax`（当前 0/0 = 只允许零成本 MOCK）；额度即授权上限 |
| 3 | 书面费用授权 | **用户** | 记录 Provider、model ID、预计成本与结算方式 |
| 4 | 核对敏感外发范围 | 业务方 + 本侧 | `internal_restricted` 默认拒发；确认可外发内容级别（`canSendToExternalAI` 三重闸门保持开启） |
| 5 | 首次真实调用留证 | 本侧 | Provider / model ID / 成本 / 错误恢复；**不得以 MOCK 冒充 REAL** |

## A-4 金融资讯定时采集（需要授权动作）

| # | 动作 | 责任方 | 要点 |
| --- | --- | --- | --- |
| 1 | 人工核验 `bis.org` 来源 | 业务方 | 当前 `PENDING_VERIFICATION` → fail-closed 不抓取；核验后置 ACTIVE |
| 2 | 决定白名单是否扩充 | 业务方 | 当前仅 bis/imf/fsb/fatf/swift 5 家；扩充需同时满足 HTTPS 与合规要求 |
| 3 | 授权开启定时调度 | 业务方 | `mos.scheduler.enabled=true` + `intervalMinutes`；默认关闭是**设计行为**（未授权不自动出站） |
| 4 | 明确单实例运行约定 | 运维 | `ingestLock` 单实例锁：同一时刻只允许一个实例执行调度 |

## A-5 网络与对外访问（如需跨主机访问）

| # | 动作 | 责任方 | 要点 |
| --- | --- | --- | --- |
| 1 | 反向代理 / TLS 终结 | 运维 | 本机当前回环 HTTP；对外须 TLS（`auth.secureCookies=always`） |
| 2 | 追加 `auth.allowedOrigins` | 运维 | 新域名加入白名单（当前仅托管域）；跨主机 TLS 属独立部署验收项 |
| 3 | 确认端口规划 | 运维 | MOS 9080；自检 9500–9699；**不占用 OA 侧端口段** |

## A-6 外部输入（解除 BLOCKED 的唯一途径，本侧不可替代）

| # | 动作 | 责任方 | 解除项 |
| --- | --- | --- | --- |
| 1 | 提供《VFIB 全球社交媒体运营与内容生产指导手册》**V1.1 原件** | 业务方/资料库 | INT-09：41 项字典逐条核对（`label`+`sourceVersion`+`evidenceRef`+`verifiedBy`，不得由 AI 填充） |
| 2 | 完成 Skill V1.2 **真人批准 + EFFECTIVE** 并提供版本/hash/审批记录 | 资料库方（真人） | INT-10：正式输出门禁方有正向验证对象 |
| 3 | 数据恢复演练与全量回归互认 | 双方 | INT-13：C 包要求"不得只引用单方报告" |
| 4 | 双方签署 `JOINT_SIGNOFF_V1.2.md` | 双方 | INT-14：签署栏当前**留空**，本侧不代签 |
| 5 | 生产部署书面批准 | **用户** | 当前未授权；批准前只做受控内部试运行 |

---

## 明确不做（红线，勿列为待办）

| 项 | 说明 |
| --- | --- |
| S05 客户增长 | **保持 MARK，不开发** |
| 品牌声誉专项 | **保持 MARK，不开发** |
| 营销线索移交与闭环 | **保持 MARK，不开发** |
| 把 Published Content 同步/镜像到资料库 | 结构性禁止（`publishedContentArchive=false` 双侧一致） |
| 修改企业资料库源码 | 本项目身份为接口消费方，零改动 |
| 未经批准上线生产 | 须用户另行书面批准 |
| 手工把字典条目标成 VERIFIED / 把 Skill 置 EFFECTIVE | 无原件/无真人审批记录，一律禁止 |
