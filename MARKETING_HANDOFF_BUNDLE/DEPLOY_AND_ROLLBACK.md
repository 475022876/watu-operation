# DEPLOY_AND_ROLLBACK.md —— 非生产部署、备份与回滚

> 对应 `02_MARKETING_OS_CODEX_TASK.md` **Phase M4** 交付项。
> **本文件描述的是一次「隔离测试环境」部署，不是生产部署。**
> **未经业务方明确批准，禁止部署生产**（用户主指令原文）。
> 基线提交 `3c19e79`

---

## 1. 前置约束（不可绕过）

1. **未获批准不部署生产**。
2. 本系统与 OA / 企业资料库**同机运行**，因此**端口表必须互斥**：
   - MOS 默认 **9080**；自测占用 **9500–9699**；e2e03 使用 **9700+**。
   - OA 侧占用 `8080-8082 / 8090-8097 / 8101-8104 / 8121-8122 / 8866 / 8899 / 9223 / 9333-9336 / 9999` —— **MOS 不得使用**。
3. 上传/发布**不遵守 `.gitignore`**：`data/`、`config.json` 会进沙箱 →
   **每次重新发布都会用本地 `data/` 覆盖线上数据**，线上新产生的数据会在下次发布时丢失。发布前必须确认。

## 2. 隔离测试环境部署步骤

```bash
# 1) 取源
git clone https://github.com/475022876/watu-operation.git && cd watu-operation
git checkout 3c19e79            # 本轮验收锁定的提交

# 2) 配置（示例见 config.example.json；凭证不得入库）
cp config.example.json config.json
#   - mos.workspace.*        ← 待资料库侧交付 SERVICE_AUTH_HANDOFF.md 后填写（非生产地址）
#   - mos.text/apiKey、mos.image/apiKey ← 待取得合法模型凭据后填写

# 3) 数据隔离（强烈建议：测试环境使用独立数据目录，避免污染）
export MOS_DATA_DIR=/srv/mos-test-data
export MOS_DEMO_SEED=0          # 测试环境不写 DEMO 种子

# 4) 启动
node server.js                  # 默认 127.0.0.1:9080
#   托管环境：注入通用 PORT/HOST 时会自动适配（见 lib/config.js）

# 5) 健康检查
curl -s http://127.0.0.1:9080/api/health
```

> 零第三方依赖：**无 `npm install`**，仅需 Node.js ≥ 18。

### 2.1 反代/托管注意事项（已落库，勿回退）

| 现象 | 原因 | 处置 |
|---|---|---|
| 浏览器请求被 `checkOrigin()` 误杀 | 反代会改写 `Host` → 依赖 `Origin` 与 `Host` 同源 | 在 `config.json` 的 `auth.allowedOrigins` **放行对外域名** |
| 服务端口不生效 | 托管环境注入通用 `PORT` | `lib/config.js` 已支持 `MOS_PORT`→`PORT`、`MOS_HOST`→`HOST`→`0.0.0.0`（仅当注入通用 `PORT` 时） |

## 3. 自检（部署后必跑）

```bash
bash tools/run-mos-tests.sh all      # 10 套件，期望 478/478，exit 0
```
本轮实测：**478/478 通过**（smoke 13 / unit 69 / sec 17 / sched 20 / provider 21 / workspace 36 / e2e 48 / e2e02 63 / e2e03 94 / ui 97）。

## 4. 备份

| 项 | 做法 |
|---|---|
| 备份对象 | `data/mos.json`（业务数据，schema v4）+ `data/uploads/`（素材与发布快照）+ `config.json` |
| 备份时机 | ① 部署前 ② **口令/账号变更前** ③ schema 迁移前 |
| 本轮既有备份 | `data/mos.json.bak-20261011-214010`、`-215314`、`-20261012074459`、`-20261013-173859` |
| 原子性 | 写入采用**唯一 tmp 文件 + `renameSync`** → 中断不会产生半写文件 |
| 敏感项 | 口令只存 **scrypt 哈希**，备份文件同样不含明文；备份文件**不得**提交版本库 |

## 5. 回滚

### 5.1 代码回滚

```bash
git checkout <上一个已验证提交>     # 本轮基线：3c19e79
# 重启进程
```

本轮变更**零删除**：未删除任何业务代码/路由；`git mv` 归档 2 份过时文档至 `docs/history/`（内容保留）。
因此**代码回滚无数据兼容风险**。

### 5.2 数据回滚（**有损，谨慎**）

```bash
# 停服 → 覆盖 → 启动
systemctl stop mos          # 或 kill 进程
cp data/mos.json.bak-<时间戳> data/mos.json
systemctl start mos
```
⚠ **回滚会丢失备份时间点之后的全部写入**（含发布记录、审计事件）。生产回滚前必须导出增量并评估。

### 5.3 schema 回滚

- 迁移 **v1→v4 只增不改、幂等**：旧代码读取含新集合的 JSON **不会崩溃**（多出的键被忽略）。
- 因此**通常不需要 schema 回滚**；若必须降级，见 `docs/CURRENT_ARCHITECTURE.md` §5。
- ⚠ 已迁移（`priorVersion>=2`）的库**绝不复活** Skill/模板/渠道种子（避免用户清空后被写回）。

## 6. 集成开关的**安全回退**（重要）

| 开关 | 回退动作 | 效果 |
|---|---|---|
| 企业资料库集成 | `mos.workspace.enabled = false`（或清空 `baseUrl`/`keyId`/私钥） | 所有方法恒 `INTEGRATION_NOT_CONFIGURED`，**零出站**（fail closed） |
| 文本/图像 Provider | `mos.integrations.textProvider/imageProvider = "none"` | 作业置 `NOT_CONFIGURED`，**不产出任何内容** |
| 采集调度 | `mos.scheduler.enabled = false` | 停止自动采集；**默认即为关闭** |
| 出站测试开关 | `MOS_EGRESS_ALLOW_HTTP=false`、`MOS_EGRESS_ALLOW_LOOPBACK=false` | **生产必须为 false**（默认已关闭） |
| Mock 故障注入 | `MOS_LIBRARY_MOCK_FAULT=none` | **生产必须为 none**（默认已关闭） |

> 上述开关的"关闭即安全"特性由代码强制（`sec` 套件 `SEC-11b/11c` 断言生产模式下测试放行开关一律失效）。

## 7. 本轮**未执行**的部署动作（诚实清单）

| 动作 | 状态 |
|---|---|
| 生产部署 | ⛔ **未执行**（未获批准） |
| 生产级备份/恢复演练 | ⛔ **未执行**（无生产环境） |
| 多实例部署 | ⛔ 不适用（单 JSON 文件存储 → **只支持单实例**，第二实例会被心跳锁拒绝并如实上报） |
| 生产数据库 | ⛔ 不适用（当前为单文件存储；多实例/生产数据库为后续阶段议题） |
