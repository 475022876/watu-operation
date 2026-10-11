# ADR-001｜技术栈决策：在既有 OA 仓库内增量内建 Marketing OS（复用零依赖栈）

- **状态**：Accepted（**技术栈选择仍有效**）；其中「放在企业 OA 仓库内」的部署形态已被 [ADR-002](ADR-002-standalone-repo.md) 取代
- **日期**：2026-10-11
- **决策人**：Codex（主工程师）
- **依据**：`00_MASTER_BUILD_SPEC.md` §2、§0.1-5；`09_CODEX_EXECUTION_PLAN.md` §1、§7；`11_SPEC_CHECKLIST.md`

## 1. 背景（Context）

`00_MASTER_BUILD_SPEC.md` §2 建议默认方案为 **TypeScript 全栈（Next.js App Router + React + PostgreSQL + Prisma/Drizzle + S3 + 作业队列）**，
但同时明确规定：

> 「若现有 OA 源码显示更加适合的既有技术栈，Codex 须先输出 ADR 说明再修改，**不得静默替换**。本建议不是声称现有系统已采用这些技术。」

`09_CODEX_EXECUTION_PLAN.md` §7 亦规定：

> 「如现有仓库已有组织结构，**需优先兼容，不必强制覆盖**。」

仓库诊断（见 `ARCHITECTURE_AUDIT.md`）显示：目标运行环境为**内网 / 无 npm 源**，现有 OA 已确立
**Node.js 原生 HTTP + 自建路由 + JSON 原子持久化 + 原生 ES module 前端**的零依赖技术栈，
并已建成可复用的会话/CSRF/CIDR/上传校验等安全基座。

## 2. 决策（Decision）

**采纳方案 A**：在既有 `oa-system` 仓库内**增量内建 Marketing OS**，复用既有零依赖栈，物理隔离为子系统：

```
lib/mos/                     # 后端子系统（不修改 OA 既有 lib/*.js 语义）
  config.js  store.js  seed.js  rbac.js  audit.js  ids.js
  dict.js                    # C01-C06 / N01-N05 / V01-V05 / F01-F04 / M01-M05 / G0-G3
  adapters/  identity.js  knowledge.js  library.js  source.js
  routes/    meta.js plans.js campaigns.js topics.js tasks.js sources.js audit.js
public/mos.html              # 子系统外壳（/mos 自动映射）
public/mos/  app.css? js/…
docs/           # 本子系统文档（架构/ADR/报告/矩阵）
data/mos.json                # 独立数据文件（运行时生成，gitignore）
```

**不采纳方案 B**（Next.js + PostgreSQL + Prisma 重建）：目标环境无 npm 源、无 Docker/PG，
会产生两套运行时、破坏既有部署与打包流程、且与"优先兼容既有仓库"的指令冲突。

**不采纳方案 C**（把 MOS 数据塞进 OA `data/db.json`）：会污染 OA 员工名录/权限口径，
并可能触发 OA 既有自检对 `version===3` 的断言，违反系统边界。

## 3. 理由（Rationale）

1. **环境约束**：内网无 npm 源，`dependencies: {}` 是既有工程选择而非疏忽；引入 Next/PG 会直接无法部署。
2. **兼容优先**：指令明确要求优先兼容既有仓库，不强制覆盖。
3. **安全基座复用**：既有 CSRF/会话/CIDR/上传魔数校验经多轮审计（V1.1.1—V1.1.5），重建等于把已验证的安全面推倒重来。
4. **风险最小**：对外只增加 1 行 `require('./lib/mos/routes')`，路由前缀 `/api/mos/` 与既有 `/api/*` 不冲突，OA 回归不受影响。
5. **边界清晰**：独立 `data/mos.json` + 独立 schema 版本，满足主控对"Marketing OS / Library / OA 三系统边界"的要求。

## 4. 影响（Consequences）

**正面**
- 零新增依赖，零构建步骤，`node server.js` 即可运行，符合"可运行、可持久化、可测试、可操作"。
- 复用既有安全基座，MOS 天然继承 CSP / CSRF / 代理白名单 / 上传校验。

**负面 / 取舍**
- 无 ORM：以 `lib/mos/store.js` 提供受限的集合访问 + 服务端校验兜底（含复合外键式品牌一致性校验）。
- 无强类型：以 `lib/mos/dict.js` 集中字典 + 运行期校验替代 TS 编译期检查。
- 规模上限：与 OA 同为"单表单万级"，符合 V0.1 原型定位（非生产合规系统）。

**回滚**：删除 `lib/mos/`、`public/mos*`、`docs/`、`data/mos.json`，并移除 `server.js` 中的 1 行 `require`。OA 主库不受影响。

## 5. 待开发负责人确认项

1. 是否同意在既有 OA 仓库内增量内建（方案 A），而非独立新仓库？
2. 是否同意 V0.1 阶段以 Mock Adapter 跑通 OA/资料库/供应商接口（方案 A 前置条件）？
3. 是否同意 MOS 使用独立数据文件 `data/mos.json`（与 OA 主库物理隔离）？

> 在获得确认前，本 ADR 处于 `Proposed → Accepted(待复核)`；开发已按方案 A 推进 BUILD-01，以便业务方尽早在可运行界面上做 UI 审计。
