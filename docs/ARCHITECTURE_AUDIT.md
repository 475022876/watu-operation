# ARCHITECTURE_AUDIT.md — 现有仓库诊断（VFIB Marketing OS V0.1 · 步骤0）

**审计对象**：`D:/企业数据后台/oa-system-20261004/oa-system`（VFIB Enterprise Workspace v1.1.5）
**审计时间**：2026-10-11
**审计人**：Codex（主工程师）
**依据**：`00_MASTER_BUILD_SPEC.md` §2/§0.1-5、`09_CODEX_EXECUTION_PLAN.md` §1、`11_SPEC_CHECKLIST.md` 开工前

> 结论先行：本仓库是**已运行的企业 OA / 企业资料库**，不是 Marketing OS 源码。
> Marketing OS V0.1 属于**新增子系统**，须复用既有技术栈与安全基座，**不得**按建议栈静默重建。
> 详见 `ADRs/ADR-001-tech-stack.md`。

---

## 1. 文件树 / 包管理器

| 项 | 现状 |
|---|---|
| 包管理器 | npm（`package.json`），但 **`dependencies: {}` —— 零第三方依赖** |
| 入口 | `server.js`（`node:http` 原生服务器）；`npm start` = `node server.js` |
| 引擎 | `engines.node >= 18`（本机运行 22.22.2） |
| 目录 | `lib/`（后端 30+ 文件）、`public/`（前端 SPA）、`tools/`（测试/脚本）、`data/`（运行数据）、`docs/`（本子系统文档）、根级大量 `*.md`（版本化交付文档） |
| 分支 | `feat/v1.1.3` → 远端 `origin`（github 475022876/watu-oa） |

**依据（package.json）**：
```json
"description": "...零第三方依赖。",
"dependencies": {}
```

## 2. 框架 / 运行时

- **无 Web 框架**：`server.js` 手工 `http.createServer` → `lib/router.js` 自建路由表（支持 `/api/x/:id` 路径参数 + 声明式 `roles`）。
- **前端无框架**：原生 ES module SPA。`public/app.html` 为唯一外壳，`public/js/app.js` 维护模块注册表：
  - `NAV_GROUPS`（导航分组）+ `MODULES`（模块清单，含 `loader: () => import('./modules/xxx.js')`）。
  - 模块契约：`export default { async mount(container), unmount() }`。
  - 请求统一走 `public/js/api.js`（`credentials: same-origin` + 双提交 CSRF 头 `x-oa-csrf`）。
- **样式**：单一 `public/css/app.css`（84KB），设计令牌与 VFIB 官网一致（navy/gold/暖白）。

## 3. 数据库 / 对象存储

- **无数据库**：`lib/store.js` = **内存对象 + JSON 文件原子落盘**。
  - 落盘：唯一临时名 + `rename` 原子替换；`writeSeq/appliedSeq` 防旧快照回退（V1.1.3 P1-02 修复）。
  - 文件：`data/db.json`；上传：`data/uploads/`。
  - 规模边界：单表单万级、数十~数百人规模。
  - `BASE_SHAPE.version = 3`；`migrate()` 实现 V1→V3 迁移，**新库与老库同源**（seed 后也跑 migrate）。
- **对象存储**：无 S3；文件落本机 `data/uploads/`，私有目录 + 服务端鉴权下载。

**这就是"数据自持 / 内网无 npm 源"的既定工程选择**（store.js 顶部注释原文：「内网服务器常常无法访问 npm 源，无法安装 sqlite/mysql 驱动，因此本系统零第三方依赖」）。

## 4. 现有登录与权限

| 层 | 文件 | 要点 |
|---|---|---|
| 会话 | `lib/auth.js` | HttpOnly Cookie `oa_sid`；绝对过期 + 空闲过期；登录轮换防固定；账号+IP 双维度限流 |
| 角色 | `lib/auth.js` | 系统角色 `admin/manager/employee`；**另有独立的资料库角色** `libRole`（employee/member/owner/reviewer/executive/admin） |
| 权限 | `lib/permissions.js` | 集中式判定；资料库按 4 级密级 + 目录继承；**fail-closed**（密级缺失按最严处理）；AI Policy：Restricted 以上禁送外部 AI |
| 路由鉴权 | `lib/router.js` | 每路由 `auth` + `roles`；未授权返回 403 并写日志 |
| 数据边界 | `lib/registration.js` | 申请 ≠ 账号（`registrations` 与 `users` 分离）——与 MOS「审批 ≠ 资产」同源思想 |

## 5. 安全基座（可复用，MOS 必须继承）

- `lib/security.js`：Origin/Referer 校验 + 双提交 CSRF + 可信代理解析 + Secure Cookie 策略。
- `lib/net.js`：逐位 CIDR 匹配（可信代理 / 客户端白名单）→ **MOS 采集器可复用做 SSRF 白名单**。
- `server.js`：CSP `default-src 'self'`（禁一切外部资源）、`X-Frame-Options`、HSTS（仅确认 HTTPS）、启动期网络配置 **fail-closed**（非法即拒绝启动）。
- `lib/util.js`：上传扩展名白名单 + **魔数签名校验**（伪装文件拒绝）、原子 `uid()`。
- 凭据一律不回显、不落日志；自检脚本运行期随机生成口令（`tools/secret-scan-v113.js` 会扫描字面量）。

## 6. 测试命令

- `bash tools/run-tests-v113.sh all` 为全量回归入口（自研零依赖脚本，非 jest）。
- 测试一律使用**独立数据目录**（`OA_DATA_DIR=data-xxx`），结束自动清理；OCR 默认关闭（`OA_RAG_OCR_PROVIDER=none`）。
- 证据落 `TEST_EVIDENCE_V1.1.3/`，要求 `EXIT=0`。

## 7. 与主控文件的冲突识别

| 主控建议（00 §2） | 本仓库现状 | 处置 |
|---|---|---|
| TypeScript 全栈 Next.js + React | 原生 JS，无构建步骤 | **不采用**（见 ADR-001） |
| PostgreSQL + Prisma/Drizzle | JSON 文件原子落盘 | **不采用**（见 ADR-001） |
| 受控 S3 对象存储 | 本地私有目录 | 保留本地目录，抽象 `storage` 接口 |
| 后台作业队列 | 无队列（同步/定时器） | 建**轻量进程内队列**（MOS 采集/AI 任务），幂等键 |
| Auth 适配器（OIDC/SSO） | 本地会话 + 角色 | 保留本地身份，MOS 用 **MockIdentityGateway** 包装，未来换真 OIDC/SSO |
| Docker Compose 隔离测试 | 无 Docker 依赖 | 用 `OA_DATA_DIR` + 独立端口隔离（既有口径） |

> 主控 00 §2 明确：「若现有 OA 源码显示更加适合的既有技术栈，Codex 须先输出 ADR 说明再修改，**不得静默替换**」。
> 09 §7 亦明确：「如现有仓库已有组织结构，**需优先兼容，不必强制覆盖**」。

## 8. 可复用基础组件（直接沿用）

`lib/router.js`（路由）、`lib/auth.js`（会话）、`lib/security.js`（CSRF/代理）、`lib/net.js`（CIDR/SSRF 白名单）、`lib/password.js`、`lib/util.js`（uid/原子写/上传校验）、`lib/store.js` 的原子落盘模式、`lib/static.js`（静态服务，`/mos` 自动映射 `mos.html`）、`public/js/api.js` + `ui.js`（前端请求/组件）、`tools/run-tests-*.sh`（测试骨架）。

## 9. 集成风险登记

| 风险 | 说明 | 当前处置 |
|---|---|---|
| R-01 数据混装 | MOS 与 OA 若共用 `db.json` 会污染 OA 名录/权限口径，且 OA 自检断言 `version===3` | **MOS 使用独立存储 `data/mos.json`**，独立 schema 版本，**不改**`lib/store.js` 的 BASE_SHAPE 与版本号 |
| R-02 无真实 OA/Library API | 本轮无源码级接口审计 | 全部走 **Mock Adapter**，UI/API 显式 `MOCK`/`INTEGRATION_PENDING` |
| R-03 外网采集不可达 | 沙箱/内网可能无出口 | 采集器失败即降级为 `INTEGRATION_PENDING` + 保留 DEMO 种子；**不伪造**"采集成功" |
| R-04 出站 SSRF | 采集器会抓外部 URL | 复用 `lib/net.js` 做 allowlist + 拒绝内网/云元数据 IP |
| R-05 范围蔓延 | 易误建 S05/CRM/代理后台 | 以 `10_TRACEABILITY` 的 MARK 清单为红线，菜单/接口/表一律不建 |
| R-06 破坏既有 OA | 新增路由可能影响既有自检 | 仅**追加** `require('./lib/mos/routes')` 一行；MOS 路由前缀 `/api/mos/`，与既有 `/api/*` 不冲突 |

## 10. 结论与建议栈

**结论**：不重建，**增量内建**。Marketing OS 作为仓库内**物理隔离的子系统**（`lib/mos/` + `public/mos/` + `data/mos.json`）落地，复用既有零依赖栈与安全基座。

**拟采用栈**：Node.js 原生 HTTP + 自建路由 + JSON 原子持久化 + 原生 ES module 前端（**与既有 OA 完全一致**）。

**Phase 1（BUILD-01）工作清单**：见 `BUILD-01_TEST_REPORT.md` §1 与 `09_CODEX_EXECUTION_PLAN.md` §2。
