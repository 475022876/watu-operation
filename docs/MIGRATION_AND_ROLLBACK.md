# 迁移与回滚（Migration & Rollback）— VFIB Marketing OS

适用版本：**0.1.3**（上一版本 0.1.2）
数据 schema：**v7（未变）** ｜ 接口契约：**1.0（未变）**
最后更新：2026-10-14

---

## 1. 版本与 schema 的关系（务必分清）

| 轴线 | 0.1.2 → 0.1.3 是否变化 | 说明 |
|---|---|---|
| 应用版本（`package.json` / `MOS_VERSION`） | **0.1.2 → 0.1.3** | 本文件与 `RELEASE_REGISTER.md` 的主轴 |
| 数据 schema | **v7 → v7（无迁移）** | 本版**零新集合**，仅在既有集合上增可选字段 |
| 接口契约版本 | **1.0 → 1.0（不变）** | 由 `docs/integration_three_pack_v1.1/C_Shared_Contract/` 冻结 |
| 资料库（Workspace）兼容目标 | 1.1.7（未变，适配层仍 `NOT_VERIFIED`） | 非本仓库管理 |

**结论：0.1.3 不需要数据迁移脚本。** 从 0.1.2 升级只需替换代码并重启；从更早版本升级则由
`lib/mos/store.js migrate()` 一次性补齐（见 §3）。

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

> `lib/mos/store.js` 的迁移**只增不改、幂等**；`priorVersion<2` 且开启 demoSeed 时才补种演示数据，
> **已是 v7 的库绝不复活**（避免用户清空后被写回）。

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
| **v7 → v7** | **无（本版）** | — | — |

校验 schema 版本：

```bash
curl -s http://127.0.0.1:9080/api/mos/meta | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).schemaVersion))"
# 期望：7
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
