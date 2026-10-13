# CONSUMER_BASELINE.md —— 运营中台（Consumer / Marketing OS）基线声明

> 交付包：`MARKETING_HANDOFF_BUNDLE_V1.1/`
> 依据：V1.1 B 包 `03_HANDOFF_AND_REPORT.md` 第 1 项 + C 包 `05_CHANGE_CONTROL_AND_RELEASE.md`
> 日期：**2026-10-13**
> 原则：**只陈述可复现的事实。凡未验证的项目一律显式标注，不以推断代替证据。**

---

## 1. 版本三元组（严格区分，不可互相替代）

| 维度 | 取值 | 说明 |
|---|---|---|
| 整改工作包版本 | `V1.1` | A/B/C 三包的文件包版本。**不代表已部署**，也不代表双方已签署 |
| 应用版本 | `0.1.0` | `package.json` → `version` |
| API 实施版本（集成） | 无独立版本号；以 **契约基线 SHA256** 标识 | 见 §3 |
| 数据库 schema 版本 | **`5`** | 本轮由 `4` → `5`，新增 4 个集成态集合（只增不改） |
| 自检基线 | **见 §5** | |

---

## 2. Git 基线

| 项 | 值 |
|---|---|
| 仓库 | `475022876/watu-operation`（**独立仓库**，与 `watu-oa` 严格分离；业务方要求两套系统代码不得混编） |
| 分支 | `main` |
| **本轮起始提交（代码基线）** | `286fe5bd729f48fd953ba825e17d9772c7018fd8`（2026-10-13） |
| 本轮交付提交 | 见 §2.1（确定性查询，避免自我指涉） |
| 工作区状态 | 本轮结束时**干净**（无未提交改动） |

### 2.1 交付提交号如何精确取得（避免自我指涉）

把「本包对应的提交号」写进包内文件会导致**自指不可解**：写进去，提交号就变了。
因此不写死数字，而给出**确定性查询方式**：

```bash
git log -1 --format='%H %ci %s' -- MARKETING_HANDOFF_BUNDLE_V1.1/CONSUMER_BASELINE.md
```

本轮交付提交的 **parent** 即代码基线 `286fe5b`。

### 2.2 目录与端口（与 Provider 互斥，见 `README.md` 端口表）

| 用途 | 本侧端口 |
|---|---|
| Marketing OS 正常服务 | `9080` |
| 自检占用段 | `9500–9699` |
| 浏览器 UI 自检（CDP） | `9600+` |
| e2e03 套件 | `9690+` |
| **双系统真实联调：本侧 MOS 实例** | **`9550–9559`** |
| **双系统真实联调：资料库隔离实例** | **`9750–9759`** |

---

## 3. 共享契约一致性检查（A0 要求）

对 C 包 `SHA256_MANIFEST.md` 所列 **20 个文件**逐项复算：**20/20 全部匹配**（实测）。

| 文件 | SHA-256 | 一致性 |
|---|---|---|
| `C_Shared_Contract/PROVIDER_API_OPENAPI_BASELINE.yaml`（C 包，**冻结基线**） | `cd3cc198a9c568192dbec76429fb9a6dbc836f5e738377249bc14f73d8e825e3` | — |
| `LIBRARY_HANDOFF_BUNDLE_V1.1/PROVIDER_API_OPENAPI.yaml`（Provider 交付包） | `cd3cc198a9c568192dbec76429fb9a6dbc836f5e738377249bc14f73d8e825e3` | ✅ **逐字节一致** |
| 本侧 `lib/mos/workspace-contract.js → OPENAPI_SHA256` | 同上（运行时断言） | ✅ 由 D4-15 实测比对 |

> **结论：三方（C 包 / Provider 交付包 / 本侧常量）逐字节一致，无契约基线差异。**
> 本侧将该 YAML **原样纳入** `docs/integration_three_pack_v1.1/`，**未做任何改写**。

### 3.1 入站材料入库位置

A/B/C 三包已按用户指令「上传到运营中台项目」，**逐字节原样**存放于：

```
docs/integration_three_pack_v1.1/
├── 00_MASTER_README_请先阅读.md
├── SHA256_MANIFEST.md
├── B_MarketingOS_Consumer/   （5 份）
└── C_Shared_Contract/        （10 份）
```

- 该目录是**入站指令材料**，不是产品源码。
- B 包（Consumer 任务书）按用户指令整体收入；C 包 10 份全收；A 包（Provider 任务书）按 B 包实际需要只读引用，未复制。

---

## 4. 本轮新增/修改的模块（Git 可验证）

### 4.1 新增

| 文件 | 职责 |
|---|---|
| `lib/mos/workspace-client.js` | **双重身份出站客户端**：Ed25519 服务签名 + 受限用户票据；出站收敛（egressGuard）、有界重试、401 换票回退、准入三步推送、撤回失效登记 |
| `lib/mos/eventconsumer.js` | **变更事件消费**：持久化 seq 游标、幂等、品牌隔离、`truncated` 全量重验、撤回/停用/权限变更缓存失效、fail closed 权威可用性判定 |
| `adapters/workspace.js` | 资料库适配层（Acquire V1.1.7 逐字节实现） |
| `tools/mos-dual-identity-test.js` | B2/B3 专项自检（离线桩，**51/51**） |
| `tools/mos-e2e-build04-dual.js` | **B4/B5 双系统真实 HTTP 端到端联调**（两套独立进程，**64/64**） |

### 4.2 修改（关键）

| 文件 | 变化 |
|---|---|
| `lib/mos/workspace-contract.js` | 权威契约常量层：错误码 71 项（冻结枚举）+ 2 项提供方声明新增码；七大资料区/四级密级/许可/复用/AI 策略枚举；canonicalString 与签名头 |
| `lib/mos/admissionlib.js` | 三项必填字段归一化、`reuseScopeUsable()`（D-06.5）、`licenseAdmissionGate()`（D-06.4）、预检新增 3 项检查 |
| `lib/mos/routes/admissions.js` | 出站前同构预校验；`collectProviderReviews()` 按**真实字段名**（`action`/`actorId`）推导 `reviews[]`；`PROVIDER_REVISION_REQUIRED` 诚实分支 |
| `lib/mos/routes/meta.js` | 只读联调探测 `probe`、契约摘要、使用前重新验证、事件 tick |
| `lib/mos/store.js` | schema `4 → 5`；保守回填（不猜密级、自由文本许可不映射 `cleared`、幂等） |
| `public/mos/js/modules/governance.js` | 准入表单六下拉 + 前端同构预检 |
| `README.md` | 端口表新增双系统联调行 |
| `docs/CURRENT_ARCHITECTURE.md` | v4→v5 迁移与回滚表 |

---

## 5. 自检基线（可复现命令）

```bash
bash tools/run-mos-tests.sh all      # 全部套件
node tools/mos-e2e-build04-dual.js   # 双系统真实 HTTP 联调（需本机资料库源码）
```

| 套件 | 命令 | 结果（本轮实测） |
|---|---|---|
| smoke | `run-mos-tests.sh smoke` | 通过 |
| unit | `run-mos-tests.sh unit` | 通过 |
| sec | `run-mos-tests.sh sec` | 通过 |
| sched | `run-mos-tests.sh sched` | 通过 |
| provider | `run-mos-tests.sh provider` | 通过 |
| workspace | `run-mos-tests.sh workspace` | 通过 |
| **dual（B2/B3 双重身份 + 事件消费）** | `run-mos-tests.sh dual` | **51/51** |
| e2e | `run-mos-tests.sh e2e` | 通过 |
| e2e02 | `run-mos-tests.sh e2e02` | 63/63 |
| e2e03 | `run-mos-tests.sh e2e03` | 通过 |
| ui（真实 Chrome + CDP） | `run-mos-tests.sh ui` | **106/106** |
| **`all` 汇总** | `run-mos-tests.sh all` | **见 `SECURITY_REGRESSION.md`** |
| **joint（双系统真实 HTTP）** | `node tools/mos-e2e-build04-dual.js` | **64/64** |

> `joint` 套件**刻意不纳入 `all`**：它需要本机存在资料库源码（`OA_SOURCE_DIR`）。
> 若源码不存在，脚本会**如实记 `BLOCKED` 并退出码 2**，不会"跳过即通过"。

---

## 6. 证据目录

| 目录 | 内容 |
|---|---|
| `TEST_EVIDENCE_MOS_BUILD01/` | 全量回归证据 |
| `TEST_EVIDENCE_MOS_BUILD04/` | `dual-e2e-result.json`（64 条断言全量结构化记录）、`dual-e2e-summary.txt` |
| `UI_EVIDENCE_MOS_BUILD01/` | 真实浏览器截图（27 张） |
| `MARKETING_HANDOFF_BUNDLE_V1.1/UI_BROWSER_EVIDENCE/` | 本包内截图索引与关键图 |

---

## 7. 明确**未做**的事（诚实边界）

| # | 事项 | 原因 |
|---|---|---|
| 1 | ❌ 未部署生产环境 | 用户明令「未经批准，不得部署生产环境」 |
| 2 | ❌ 未调用真实外部 AI 供应商 | 无凭据（`INT-11` = `BLOCKED`） |
| 3 | ❌ 未把 MOCK 回执标记为正式入库 | 红线：`approvalMode` 只允许 `REAL` 才可复用 |
| 4 | ❌ 未开发 S05 客户增长 / 品牌声誉专项 / 营销线索移交 / 代理控制台 / 自动发布 | 用户明令「保持 MARK」 |
| 5 | ❌ 未修改资料库（OA）源码 | 用户明令「只允许修改运营中台仓库」 |
| 6 | ❌ 未把 `Published Archive` 迁往资料库 | 红线：归档**只在运营中台** |
