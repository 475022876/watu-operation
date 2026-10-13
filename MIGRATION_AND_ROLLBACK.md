# 数据迁移与回滚 — VFIB Marketing OS V0.1.2

## 1. Schema 演进（本版）

**v5（0.1.0 基线）→ v6（Phase A）→ v7（Phase B）；Phase C 零新集合。**

| 版本 | 变更 | 性质 |
| --- | --- | --- |
| v6 | `users[].prefs = { locale: null, lastTaskId: null }` | 只增字段，不改旧数据 |
| v7 | 新增 5 集合：`research_reports` / `research_findings` / `source_evidence` / `topic_proposals` / `research_jobs` | 只增集合，不改旧集合 |

实现：`lib/mos/store.js` `migrate()` —— `MOS_SCHEMA_VERSION=7`；
加载时 BASE_SHAPE 兜底 + v6/v7 迁移块**显式补齐**；**幂等**（重复执行零副作用）；**只增不改**（不删不改任何既有字段/集合）。

- 已 v7 的库**不会**被重复迁移（priorVersion 判断短路）。
- `MOS_DATA_DIR` 隔离强依赖 `getConfig()`（A-09 修复）：任何先触碰 store 的脚本/实例都不会写进真实 `data/`。

## 2. 迁移验证

- 单测 U-19 系列：v5 数据文件加载 → 自动升 v7，既有数据逐字节保留。
- 调度套件 SCH-01、集成套件 GOV-06 同步断言 v7。
- research/editorial 两个真实 HTTP 套件：空目录首启 → v7 直建；复启幂等。
- 升版 0.1.2 后全量回归 773/773（含全部迁移断言）。

## 3. 回滚路径

### 3.1 应用回滚（推荐）

1. 停服（Windows 下注意 **60ms 防抖**：硬杀前给 600ms 落盘窗口）。
2. 用 V0.1.1 源码包（`VFIB_MARKETING_OS_V0.1.1_REMEDIATED_SOURCE.zip`，或 git 标签 `v0.1.1`）替换代码目录（**保留 `data/` 与 `config.json`**）。
3. 重启。**v7 数据可被 0.1.1 安全读取**：v6/v7 只增不改，旧代码按未知集合忽略、`prefs` 字段不触碰；
   `users[].prefs` 对旧代码透明。业务数据（任务/计划/发布/审计）零丢失。
4. 回滚后新增的研究域数据（报告/提案）保留在 `data/mos.json` 中不参与旧功能，重新升版时直接复用。

### 3.2 Schema 显式降级（仅当需要让旧代码「看见干净 v5」）

不提供自动降级脚本——**设计上不需要**（只增不改 ⇒ 向后兼容）。若确需删减，
必须先停服并备份后人工编辑 `data/mos.json`（删 5 个研究域集合键、`users[].prefs`、`MOS_SCHEMA_VERSION` 改回 5），
并在 staging 验证。禁止对生产数据直接手工编辑。

### 3.3 备份纪律

- 升级前：`cp data/mos.json data/backup-mos-<date>.json`（用户自管，不入 Git）。
- 单文件原子落盘（tmp+rename），不存在半写状态。

## 4. 版本一致性（REL-01）

| 处 | 值 |
| --- | --- |
| `package.json` version | 0.1.2 |
| `lib/config.js` appVersion | 0.1.2 |
| `lib/mos/config.js` MOS_VERSION | 0.1.2 |
| UI 侧栏 `versionText` | v0.1.2 |
| CHANGELOG / RELEASE_REGISTER | 0.1.2（登记提交见 RELEASE_REGISTER） |
| Schema | v7 |
| API 契约 | 1.0（未变） |
