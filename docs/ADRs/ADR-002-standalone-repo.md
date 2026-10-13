# ADR-002｜从企业 OA 仓库剥离为独立工程

- 状态：**Accepted**
- 日期：2026-10-11
- 取代：ADR-001 中关于「放在企业 OA 仓库内」的部署形态决策（ADR-001 的**技术栈选择仍然有效**）
- 决策人：业务方（明确指示「不要和企业资料库混和一起」）

---

## 背景

ADR-001 阶段（BUILD-01）把 Marketing OS 作为**增量内嵌子系统**落在企业 OA 仓库内，理由是复用已验证的零依赖栈与安全基座、风险最小、可快速交付 Gate A。

BUILD-01 交付后业务方明确要求：**运营中台的代码必须与企业资料库/企业 OA 的代码物理分离**，不得混在同一工程内。

这与 ADR-001 的部署形态结论冲突，因此需要新决策。

---

## 决策

将 Marketing OS 的全部代码从 `企业数据后台/oa-system-*` 仓库**整体迁出**，成为独立工程：

```
D:\运营系统\VFIB-Marketing-OS\
```

并满足以下约束：

1. **零第三方依赖不变**（ADR-001 的技术栈选择继续有效）：仍是原生 `node:http` + 自定义路由 + JSON 原子落盘 + 原生 ES Module 前端。
2. **不新建 npm 工程、不引入 Next.js/PostgreSQL**：只在文件系统层面独立，工程规模与技术复杂度不变。
3. **自持安全基座**：`util.js` / `net.js` / `security.js` / `password.js` / `static.js` 在新工程内**各有一份**，不跨仓库引用。
4. **命名空间完全自持**：环境变量 `MOS_*`、会话 Cookie `mos_sid`、CSRF Cookie `mos_csrf` / 头 `x-mos-csrf`、路由前缀 `/api/mos/*`、数据文件 `data/mos.json`。
5. **独立版本库**：新工程 `git init`，不再位于 OA 仓库的工作树内。

### 目录形状刻意保持不变

新工程沿用 `lib/mos/**`、`public/mos*` 的原目录形状，并把共享件放到 `lib/` 下与之相同的相对位置。
结果是 **`lib/mos/**` 内部所有 `require('../…')` / `require('../../…')` 路径无需任何修改**即可正确解析
（例如 `lib/mos/routes/auth.js` 的 `require('../../security')` 依然指向 `lib/security.js`）。

这大幅降低了搬迁风险：**业务代码零改动**，只有进程入口、配置、命名空间三类外围内容是新写的。

---

## 具体改动清单

| 类别 | 内容 |
|---|---|
| 整体搬迁（不改内容） | `lib/mos/**`、`public/mos.html`、`public/mos/**`、`public/favicon.svg`、`tools/mos-*`、`tools/run-mos-tests.sh`、`docs/**`、测试证据目录 |
| 复制共享件 | `lib/{util,net,security,password,static}.js`（逐字复制，保证行为一致） |
| 新写 | `server.js`（独立入口）、`lib/config.js`（独立配置）、`package.json`、`.gitignore`、`.env.example`、`config.example.json`、`README.md` |
| 命名空间改名 | `MOS_*` → `MOS_*`；`OA_DATA_DIR/OA_PORT/OA_HOST/OA_ADMIN_PASSWORD` → `MOS_*`；`oa_csrf` → `mos_csrf`；`x-oa-csrf` → `x-mos-csrf`；`oa_sid` → `mos_sid` |
| 代码简化 | `lib/mos/routes/auth.js` 中「先按 OA Cookie 名构造再 replace 成 mos_sid」的两处冗余逻辑删除（新配置直接给出正确 Cookie 名） |
| 注释订正 | 去掉已不成立的「与 OA 同源/复用 OA 模块」表述；**保留**产品层面的诚实声明（如「企业 OA 接口尚未接通」） |
| 默认端口 | 改为 **9080**，并把自检端口整体挪到 **9500-9699** 独立区段。**这不是洁癖，是迁移中实际踩了两次坑**：先选 8090 → 撞 OA 回归统一入口的隔离实例（出现 4 处假失败）；再选 8091 → 撞 OA 安全套件 `PORTS.proxy`（出现 14 处假失败，全部表现为「应 403 却 200」，因为请求打到了本工程这个不做该限制的服务上）。原因是两个仓库同机运行，**端口表必须显式互斥** |

### 母仓库侧的清理（同样重要）

- 删除：`lib/mos/`、`public/mos.html`、`public/mos/`、`tools/mos-*`、`tools/run-mos-tests.sh`、`docs/`、MOS 测试证据目录、`data-test/preview/mos.json`。
- 回退：`server.js` 的 MOS 挂载行、`.gitignore` 与 `README.md` 中的 MOS 条目、`.env.example` 的 MOS 段。
- **保留**：`lib/store.js` 的落盘竞态修复 —— 那是母仓库自身的生产级缺陷修复（异步 `rename` 可能用旧快照覆盖新快照），与 MOS 无关，不属于迁移范围。**迁移不得顺带回退这个修复。**

---

## 后果

**正面**

- 两套系统物理隔离：各自独立演进、独立发布、独立打包、独立版本库。
- 运营中台的交付物不再夹带企业资料库源码，满足「不要混在一起」的要求。
- 集成状态（Mock/Real）边界更干净：本工程只声明自己的集成，不背负母仓库的配置面。

**负面 / 需要接受**

- **共享安全基座出现多份拷贝**（母仓库一份、本工程一份）。修复一处安全缺陷需要**人工同步到另一处**。
  → 新增风险 **R-07：安全基座双份漂移**（登记于 `../history/ARCHITECTURE_AUDIT.md`）。缓解措施：两侧的
  `lib/{util,net,security,password}.js` 顶部注释互相标注来源，安全类改动必须在提交信息中写明是否需要同步。
- 母仓库原有的 `tools/secret-scan-v113.js` 等自检不再覆盖本工程 → 本工程内置 `tools/secret-scan.js`。

**中性**

- 数据迁移量为零：迁移时 MOS 仅有 DEMO 种子数据，无生产数据需要搬运。

---

## 回滚方案

将本工程目录移回母仓库对应位置，并在 `server.js` 中恢复 MOS 挂载（`require('./lib/mos/routes')` 与 `/api/mos/` 分流），
同时把命名空间改回 `MOS_*`。由于目录形状与母仓库时期完全一致，回滚同样不需要改动 `lib/mos/**` 内部代码。

---

## 验证

搬迁后在本工程执行 `bash tools/run-mos-tests.sh all`，四套件（smoke 13 + unit 25 + e2e 47 + ui 32 = 117）**全部通过**，
证明搬迁与命名空间改名未引入行为回归；同时在母仓库执行 `bash tools/run-tests-v113.sh all` 确认 `EXIT=0`，证明移除 MOS 未破坏母仓库。
