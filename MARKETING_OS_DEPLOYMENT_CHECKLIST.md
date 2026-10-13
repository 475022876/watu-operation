# MARKETING_OS_DEPLOYMENT_CHECKLIST —— VFIB Marketing OS V0.1.1 受控试运行部署清单

> 配套：[`MARKETING_OS_PILOT_READINESS_REPORT.md`](MARKETING_OS_PILOT_READINESS_REPORT.md)（判定依据）、
> [`MARKETING_OS_MANUAL_ACTIONS.md`](MARKETING_OS_MANUAL_ACTIONS.md)（需人工执行的项）
> 用法：逐项勾选；**任何 ⛔ 项未完成不得进入对应阶段**。
> 日期：2026-10-14｜基线：`2fe3841`（标签 `v0.1.1`）

---

## 阶段 0 —— 基线与包完整性

- [ ] 检出 `main` @ **`2fe3841`**（标签 `v0.1.1`），`git status` clean
- [ ] 交付源码包校验：`VFIB_MARKETING_OS_V0.1.1_REMEDIATED_SOURCE.zip`
      SHA256 `6d0eec406a2928e538398ef97bf602bda9677a19fd6060790d7ed6107f8dca2f`（310 条目）
- [ ] 版本三处同源核对：`package.json` = `lib/config.js:appVersion` = `lib/mos/config.js:MOS_VERSION` = **0.1.1**
- [ ] Schema v5 确认：`lib/mos/store.js` `MOS_SCHEMA_VERSION = 5`（无迁移，回滚不涉数据变更）
- [ ] 契约 1.0 确认：OpenAPI SHA256 `cd3cc198a9c568192dbec76429fb9a6dbc836f5e738377249bc14f73d8e825e3`
- [ ] 回归基线确认：`bash tools/run-mos-tests.sh all` → 546/546（`all` 11 套件；汇总器口径 671/671）

## 阶段 1 —— 运行环境（本机受控实例）

- [ ] Node 运行时就绪（零第三方依赖，无 `npm install` 步骤）
- [ ] **端口 9080** 未被占用；未使用 OA 侧占用段（8080-8082 / 8090-8097 / 8101-8104 / 8121-8122 / 8866 / 8899 / 9223 / 9333-9336 / 9999）
- [ ] `config.json` 就位（**不入库**，gitignore）：`mos.enabled=true`；端口/主机正确
- [ ] `auth.secureCookies`：本机 HTTP 用 `auto`；对外 HTTPS 才用 `always`
- [ ] `auth.allowedOrigins` 与实际访问域名一致（当前仅托管域）
- [ ] `data/` 目录可写且**已备份**（首次启动前快照 `data/mos.json`）
- [ ] 启动后核对启动横幅版本 `v0.1.1` 与 `/api/mos/meta` 的 `mosVersion/mosSchemaVersion`

## 阶段 2 —— 账号与权限（⛔ 未完成不得开始试运行）

- [ ] **`admin` 初始口令已更换**（首启仅打印一次；丢失用 `tools/mos-reset-password.js` 重置，先停服）
- [ ] 试运行**真人账号**已创建（`POST /api/mos/admin/users`），口令 ≥8 位且**避免符号**
- [ ] 角色与品牌作用域按最小权限分配（参考：P1 计划 / P2 内容 / P3 发布 / ASSET_REVIEWER 预检 /
      `LIBRARY_FINAL_APPROVER` 最终审批 / `PUBLISHING_APPROVER` 发布审批）
- [ ] **未**向任何真实账号授予超出试运行所需的 `library.asset.approve.final`
- [ ] 演示账号（`demo.*`）仅用于演示，不记入真人验收证据

## 阶段 3 —— 中台内部流程（MOCK 集成模式即可开始）

- [ ] 八个工作中心逐页可访问（对照 `UI_EVIDENCE_MOS_BUILD01/` 28 张截图）
- [ ] 月度计划 → Campaign → Master Topic → 内容任务 创建/编辑/版本锁定 走通
- [ ] 专业审核 → 发布审批 走通（提交人不得自批、ROW_VERSION_CONFLICT 409 复现路径明确）
- [ ] 发布排期 → `POST /api/mos/publications` 归档（快照 + MANIFEST 落盘）→ 修正 / 指标登记
- [ ] 品牌隔离抽查：VFIB 专用账号访问 UCARD 上下文被拒（403/404，不泄露存在性）
- [ ] 正式输出门禁抽查：FORMAL 无 EFFECTIVE Skill 时被阻断（`SKILL_NOT_EFFECTIVE`，fail-closed 属正确表现）
- [ ] 字典页如实显示「待核验」（41 项 provisional；**不得**手工置 VERIFIED）

## 阶段 4 —— 金融资讯采集与定时任务

- [ ] `mos.egress.allowedHosts` 白名单确认（仅 bis/imf/fsb/fatf/swift 5 家；`allowHttp=false`）
- [ ] `bis.org` 人工核验完成后置 ACTIVE（核验前 fail-closed，**不抓取**）
- [ ] 手工触发单次采集验证：条目落库、失败降级如实上报
- [ ] 定时调度**默认关闭确认**（`mos.scheduler.enabled=false`）；开启属授权动作（见手工动作 A-4）
- [ ] 开启后确认：单实例锁生效（第二实例被拒）、间隔与失败上限符合登记值

## 阶段 5 —— 企业资料库真实联通（⛔ 未经 A-2 完成不得执行）

- [ ] 资料库侧已签发**服务账户**（keyId + Ed25519 私钥）并完成**真人**审批链授权
- [ ] 环境变量：`MOS_LIBRARY=real`、`MOS_WORKSPACE_BASE_URL / KEY_ID / PRIVATE_KEY_PATH / BRANDS / ALLOWED_HOSTS`
- [ ] `MOS_WORKSPACE_USER_MAP`（`mosUserId=providerUserId`）已配置；未映射用户确认**零出站**
- [ ] `POST /api/mos/integration/probe` 探测通过（health / 检索 / 知识 / 事件）
- [ ] 事件轮询开启（`MOS_WORKSPACE_POLL_ENABLED=1`）且 7 类事件 fail-closed 回归通过
- [ ] 首笔真实准入走通：三必填字段 → 预检 → 送审 → **真人**最终审批 → 重试同步取得 Asset ID
- [ ] 私钥**只存服务端环境**（不进 config.json 入库物、不进日志、不进证据）

## 阶段 6 —— AI Provider（⛔ 未经 A-3 完成不得执行）

- [ ] 非生产密钥已注入 `MOS_TEXT_API_KEY` / `MOS_IMAGE_API_KEY`（**仅服务端**；不入库、不回传）
- [ ] `mos.budget.brandMonthlyUsd / perJobUsdMax` 已设为**批准额度**（0/0 = 只允许 MOCK）
- [ ] 用户**明确费用授权**已书面记录（Provider / model ID / 预计成本）
- [ ] 敏感数据闸门确认：`internal_restricted` 内容拒发外部模型；外部内容防注入提示词在位
- [ ] 首次真实调用记录：Provider、model ID、成本、错误恢复行为（不得以 MOCK 冒充 REAL）

## 阶段 7 —— 安全与运维

- [ ] `sec` 套件 17/17（SSRF / DNS 重绑定 / 逐跳重定向 / 压缩炸弹 / 提示注入）
- [ ] 日志与证据**不含**密钥/口令/正文（证据只留 correlationId / code / status / 计数）
- [ ] 备份策略：`data/mos.json` 定期快照；迁移前自动 `mos.json.bak-*` 已知悉
- [ ] 恢复演练：从备份恢复一次并核对 `mosSchemaVersion=5`
- [ ] 审计可查：`audit_events` 记录关键动作（登录/改密/审批/发布/阻断）
- [ ] 停机规程：**先 `sleep` 等待 60ms 防抖落盘再终止进程**（Windows 为硬终止）

## 阶段 8 —— 红线与放行

- [ ] **S05 客户增长 / 品牌声誉专项 / 营销线索移交与闭环：保持 MARK，无任何开发痕迹**
      （`/api/mos/meta` 权限表 MARK 类命中 0；CENTERS = 8 未增减）
- [ ] Published Archive 仅本中台归档（`publishing.js` 对集成层零引用；`publishedContentArchive=false`）
- [ ] 三类 BLOCKED（SPECIAL-01 / Skill V1.2 / 真实 AI）**未**以任何方式冒充解除
- [ ] **生产部署授权：未获得 → 本清单不含生产上线步骤**；生产须用户另行书面批准
- [ ] 试运行放行签署（真人签署，不代签）：＿＿＿＿＿＿ 日期：＿＿＿＿＿＿

---

## 回滚

| 场景 | 动作 |
| --- | --- |
| 应用回滚 | `git checkout 259a91d`（0.1.0 基线）或 `git revert`；schema v5 未变，**数据无需回滚** |
| 配置回滚 | 还原 `config.json`（`library=mock`、providers `none`、`scheduler.enabled=false`、预算 0/0 即回到"不出站"受控态） |
| 集成回滚 | 撤销 `MOS_WORKSPACE_*` 与 `MOS_LIBRARY`，重启即恢复零出站；已建立的 `library_asset_refs` 按事件失效机制处理 |
