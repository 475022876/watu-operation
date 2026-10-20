# 迁移与回滚（Migration & Rollback）— VFIB Marketing OS

适用版本：**0.1.4**（上一版本 0.1.3）
数据 schema：**v8**（v7 → v8：仅新增 2 个集合，零改写） ｜ 接口契约：**1.0（未变）**
最后更新：2026-10-20

---

## 1. 版本与 schema 的关系（务必分清）

| 轴线 | 0.1.3 → 0.1.4 是否变化 | 说明 |
|---|---|---|
| 应用版本（`package.json` / `MOS_VERSION`） | **0.1.3 → 0.1.4** | 本文件与 `RELEASE_REGISTER.md` 的主轴 |
| 数据 schema | **v7 → v8** | 新增 `provider_calls`（调用账本）、`video_render_jobs`（AI 成片作业）；**只增不改** |
| 接口契约版本 | **1.0 → 1.0（不变）** | 由 `docs/integration_three_pack_v1.1/C_Shared_Contract/` 冻结 |
| 资料库（Workspace）兼容目标 | 1.1.7（未变，适配层仍 `NOT_VERIFIED`） | 非本仓库管理 |

**结论：0.1.4 的迁移是"纯追加"，无需数据搬运脚本。** 从 0.1.3 升级时 `migrate()` 只会把
`mosSchemaVersion` 从 7 改成 8 并补两个空数组，**既有集合逐字节不变**（`U-19a` 断言覆盖）。
从更早版本升级则由同一次调用一次性补齐（见 §3）。

---

## 2. 0.1.3 对存储的实际增量（向后兼容字段）

均为**新增可选字段**，旧版本读到时忽略即可，因此**回滚 0.1.3 → 0.1.2 不会丢数据**：

| 集合 | 新增字段 | 用途 |
|---|---|---|
| `research_jobs` | `blockedEvent` | 同步 `/research/web` 入口沿用历史审计事件名 `research.web_blocked` |
| `research_reports` | `completion` / `sources` / `executiveSummary` / `industryImplications` / `vfibRelevance` / `editorialOpportunities` / `unresolvedClaims` / `conflictDetection` / `modelRun` / `cost` / `refreshState` / `reverifyDue` / `evidenceIds` / `jobId`（Phase B 引入） | 报告契约 13 字段；降级与完成度**同源**标记 |
| `research_jobs` | `stage` / `progress` / `budget` / `log` / `attempts` / `cancelRequested` / `payloadHash` / `idempotencyKey` / `searchOk` | 异步作业可观测性与幂等 |
| `source_evidence` | `availability` / `contentHash` / `retrievedAt` / `licenseState` | 证据可追溯性与"搜索返回≠证据有效" |
| `users[].prefs` | `locale`（v6 起）/ `lastTaskId`（v6 起） | 语言偏好与「继续上次工作」；本版仅**使用**，未改结构 |

### 2.1 v8 新增的两个集合（0.1.4）

| 集合 | 结构（要点） | 用途 | 回滚安全性 |
|---|---|---|---|
| `provider_calls` | `id / at / kind / provider / keyFingerprint / op / ok / state / errorCode / latencyMs / attempts / tokens{in,out} / cost{amount,currency,confirmed,source} / brandCode / actorId / taskId / note` | 每次供应商调用的**账本**（成功与失败都记）。`REAL` 就绪度的唯一证据来源；P50/P95、错误率、费用汇总都从它来 | 0.1.3 读到该集合会**忽略**；删除该集合只影响就绪度显示（回落到 `CONFIGURED_NOT_TESTED`），不影响业务数据 |
| `video_render_jobs` | `id / brandCode / state(QUEUED\|RENDERING\|READY\|FAILED) / providerJobId / prompt / durationSec / output{path,bytes,sha256} / errorCode / attempts / createdAt / updatedAt` | AI 成片异步作业（start→check→download 三步的状态机） | 同上；回滚后已成片文件仍在 `data/uploads/generated/`，可直接手工取用 |

> **两个集合都不含密钥明文与业务正文**：密钥只以 `keyFingerprint`（sha256 前 12 位）出现；
> 账本的 `note` 在落库前统一经 `secrets.redactText()` 脱敏。

> `lib/mos/store.js` 的迁移**只增不改、幂等**；`priorVersion<2` 且开启 demoSeed 时才补种演示数据，
> **已是 v8 的库绝不复活**（避免用户清空后被写回）。

---

## 3. 从更早版本升级（由旧到新的一次性迁移）

| 迁移 | 内容 | 幂等 | 回滚 |
|---|---|---|---|
| v1 → v2 | BUILD-02 新集合（Skill/模板/渠道等 16 个） | 是 | 见 §4 |
| v2 → v3 | 资产入库与资料库网关 | 是 | 见 §4 |
| v3 → v4 | `ingest_jobs`（采集作业） | 是 | 见 §4 |
| v4 → v5 | BUILD-03/04 相关集合 | 是 | 见 §4 |
| v5 → v6 | `users[].prefs = {locale, lastTaskId}`（V0.1.2 Phase A） | 是 | 删字段即可 |
| v6 → v7 | 研究域集合（V0.1.2 Phase B） | 是 | 见 §4 |
| **v7 → v8** | **新增 `provider_calls` / `video_render_jobs`（0.1.4）**；既有集合零改写 | 是 | 见 §4 |

校验 schema 版本：

```bash
curl -s http://127.0.0.1:9080/api/mos/meta | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).schemaVersion))"
# 期望：8
```

---

## 4. 回滚流程（0.1.3 → 0.1.2）

### 4.1 前置：备份（**必做**）

```bash
# 1) 停服（Windows 上为硬终止，须等待 60ms 防抖落盘）
kill <MOS_PID>            # 或 taskkill //F //PID <pid>
sleep 1
# 2) 备份数据文件与上传目录（data/ 为单文件 JSON + uploads）
cp -r data "data.backup-$(date +%Y%m%d-%H%M%S)"
```

> `data/mos.json` 采用 60ms 防抖原子落盘；**必须停服后再复制**，否则可能复制到未落盘状态。

### 4.2 回滚代码

回滚**不涉及数据库降级**（0.1.3 未改 schema、只增字段）：

```bash
git checkout 7001475      # 0.1.2 的发布提交（标签 v0.1.2）
# 或：git checkout v0.1.2
node server.js            # 重新启动
```

### 4.3 回滚后校验

```bash
curl -s http://127.0.0.1:9080/api/mos/meta   # schemaVersion 仍为 7；mosVersion 变为 0.1.2
bash tools/run-mos-tests.sh all              # 期望回到 0.1.2 的 773/773 基线
```

### 4.4 已知回滚影响（如实记录）

| 项 | 影响 |
|---|---|
| 0.1.3 期间产生的 `research_jobs.stage/progress/budget`、报告 13 字段 | 0.1.2 代码**忽略**这些字段；报告抽屉可能显示为空，**数据不丢** |
| 0.1.3 期间新增的 `task/version/asset` | 0.1.2 可正常读取（无 schema 变化） |
| i18n 语言资源 | 0.1.2 使用旧的 `applyDom()` 全局匹配，**不可翻译保护缺失**（回滚即失去该保护，属已知降级） |
| `research.web_blocked` 审计 | 0.1.2 同样记录该事件，无影响 |
| 前端静态资源缓存 | 回滚后请强制刷新（`Ctrl+F5`），避免旧 `i18n.js` 被缓存 |

---

## 5. 安全与一致性检查（每次发布前后各跑一次）

```bash
# 1) 全量回归（15 套件）
bash tools/run-mos-tests.sh all

# 2) 双系统真实 HTTP 联调（需同机存在资料库源码）
bash tools/run-mos-tests.sh joint      # 正向端到端
bash tools/run-mos-tests.sh build06    # 安全负例 + 正式输出门禁

# 3) 国际化与不可翻译保护
node tools/mos-i18n-check.js

# 4) 密钥泄漏扫描
node tools/secret-scan.js
```

- **配置与数据不入库**：`data/`、`config.json`、`*.zip`、`dist/` 均被 `.gitignore` 排除；
  但**上传到托管沙箱时不遵守 `.gitignore`** —— 每次都需确认是否要用本地 `data/` 覆盖线上数据。
- **口令**：只存 scrypt 哈希，不可逆推；丢失口令的唯一正解是用 `tools/mos-reset-password.js` 重置（先停服）。

---

## 6. 本版（0.1.3）明确不做的事（避免误判为"应迁移"）

- 未新增/删除任何数据集合；
- 未改动双系统契约 1.0 的任何端点/字段名/错误码；
- 未部署生产（发布形态为 **Staging / 本地隔离实例**），生产部署须另行批准。
