# 最终验收报告 —— VFIB Marketing OS V0.1.3

> 执行包：`VFIB_Marketing_OS_V0.1.3_AI_Research_UX_Remediation_Codex`（7 文件 + `SHA256_MANIFEST.txt`，逐文件核验一致）
> 基线：应用版本 **0.1.2**（提交 `7001475`，schema v7，契约 1.0）
> 本版：应用版本 **0.1.3**；**契约仍 1.0**；**schema 仍 v7（零迁移）**
> 报告日期：2026-10-14 ｜ 交付形态：**Staging / 本地隔离实例，未部署生产**

---

## 0. 结论速览

| 口径 | 结果 |
| --- | --- |
| 全量回归 `bash tools/run-mos-tests.sh all`（**16 套件**） | **797/797 通过** |
| 双系统真实 HTTP 正向端到端 `joint`（显式运行） | **66/66 通过** |
| 双系统真实 HTTP 安全负例 `build06`（显式运行） | **61/61 通过** |
| **汇总（`summary.json` 扫描全部证据目录 = 18 套件）** | **924/924 通过** |
| 真实浏览器 UI（Chromium 155.0.8059.79，CDP） | **123/123 通过**（含双语保护 LANG-01a…l 12 条） |
| 验收矩阵（执行包 06 §验收矩阵，17 项） | **PASS 12 / PASS(受限) 3 / BLOCKED 2 / FAIL 0 / NOT_TESTED 0** |
| **联合验收终裁** | **CONDITIONAL**（未获批准 → **不部署生产**；无任何 `PASS_REAL`） |

> **口径纪律（三档不可混用）**：`all` = 797/797（16 套件）；`joint` = 66/66；`build06` = 61/61；
> `summary.json` 汇总 = 924/924（18 套件，含显式运行的 `joint`/`build06`）。

---

## 1. 交付范围（是否重建业务架构？否）

| 项 | 结论 |
| --- | --- |
| 是否新增功能中心 | **否**。8 大业务中心与全部模块 id **零变更**（`public/mos/js/app.js` 的 `CENTERS` 仍为 8） |
| 是否改动企业资料库（Workspace）源码 | **否**。Provider 只以 `server.js` + 环境变量装配隔离实例（`D4-45` 断言 mtime 未变） |
| 是否改动双系统 API 契约 | **否**。契约版本 **1.0**，`openapiSha256` 与 C 包冻结快照逐字节一致（`D4-15`） |
| 是否部署生产 | **否**（用户明令；且无生产部署授权） |
| schema 变更 | **无新增集合，无数据迁移**（v7 保持不变，仅新增可选字段） |

**版本三轴线**：应用版本 `0.1.2 → 0.1.3`；**接口契约 1.0（不变）**；Workspace 兼容目标 1.1.7（不变，仍 `NOT_VERIFIED`）。

---

## 2. 验收矩阵（逐项判定）

判定词表：`PASS` / `FAIL` / `BLOCKED` / `NOT_TESTED`；**`BLOCKED` 一律不记 `PASS`**。

| ID | 关键测试 | 结论 | 证据 |
| --- | --- | --- | --- |
| **UX-01** | 中文 P1 从已生成报告批选题并派两个平台，≤5 主要确认动作 | **PASS**（功能）⚠ | `editorial` SG-01/02/03：`approve-and-schedule` 一次确认产出 **2 个平台任务**（LINKEDIN + X，编号不同）+ 自动建月度计划。流程推导确认动作 = **2 次**（一屏审核 + 派工确认）。**未单独录屏计数**（见 §5） |
| **UX-02** | P2 首页 ≤2 步打开制作，正文/图/视频脚本/提交审核全程任务上下文一致 | **PASS** | `UI_EVIDENCE/PHASEA/steps.json`（18 步，`jumpOutTabs: 0`、`p2ActionsToEditor: 2`）：切「视频/图片/审核」页签**均不跳出任务**；P2 落地页 → 正文可编辑 = **2 个主要动作**（目标 ≤2）；控制台错误 0；**17 张截图** |
| **UX-03** | P3 见到获批正确版本，发布后**附真实链接**才生成 Published Archive | **PASS** | `joint` D4-50→D4-53：冻结送审 → 审批人分离 → `APPROVED` → 人工登记真实 URL → 归档快照落盘（`TEXT_SNAPSHOT` + `MANIFEST`，正文可只读回放）；D4-42 `total=1`（归档面真实存在） |
| **UX-04** | P4 从官方产品 Brief 直接派工，不强制先做研究 | **PASS** | `studio` 29/29：从 Brief 直接建任务/变体，研究非前置；`ui` 覆盖直达制作路径 |
| **RES-01** | 固定来源真实增量汇编与去重，原始链接有效 | **PASS** | `research013` 79/79（TRUSTED_DAILY 汇编 + `contentHash` 去重 + 真实链接）；`research` 55/55 |
| **RES-02** | **真实授权 Web 搜索 API** 返回结果，无伪造 URL | **BLOCKED_NOT_CONFIGURED** | 本环境**无搜索供应商凭据、无费用授权** → 零出站。适配器（`searxng/brave/bing/google/tavily` 注册表）已实现并通过契约替身；**不记 PASS** |
| **RES-03** | 多来源 AI 研究，FACT 挂来源，矛盾/证据不足有提示 | **PASS**（适配器/契约替身）⚠ | `research013`：FACT 无证据**强制降级**为 INTERPRETATION、矛盾列示、`EV-n` 句柄；真实**商业模型**未联调 → 商业供应商侧 `BLOCKED_NOT_CONFIGURED` |
| **RES-04** | AI 候选推荐 C01–C06 有理由，特殊栏目有事实核验门禁 | **PASS**（含负例）⚠ | 提案状态机 + 理由/依据字段；`needsVerification` 门禁生效。**SPECIAL-01 原件仍未交付** → 41 项字典项恒「待核验」 |
| **RES-05** | Provider 未配置/超时/费用封顶时**正确失败关闭**、可恢复手工操作 | **PASS** | `research013` 负例：未配置 → `BLOCKED` + 零发现零证据；预算封顶 → 零出站；超时/429/5xx 退避；取消幂等；手工路径保留 |
| **ED-01** | 非授权/跨品牌审批被拒，审批有版本审计 | **PASS** | `build06` 61/61（真实双进程 HTTP 负例）+ `joint` D4-30（`TICKET_KIND_MISMATCH`）/D4-32（本人会话最终审批）；版本审计随裁决落库 |
| **ED-02** | 幂等键跨账号跨提案重放不能获得他人结果，并发不重复 | **PASS** | `editorial` SG-04…（幂等重放 `deduplicated:true` 零新增）；`joint` 证明 Provider 侧 `idempotencyKey` 覆盖 |
| **PLAN-01** | 一题多平台任务批量派工，全部成功或全部回滚，日周月同源 | **PASS** | `editorial` SG-01/02/03 + VW-01…04（月/日/周视图**同源过滤非复制**） |
| **PROD-01** | 文字内容、图片版本、视频分镜/关键帧/素材操作**内嵌任务** | **PASS** | `studio` 29/29；PHASEA 浏览器证据（三页签任务内渲染） |
| **PROD-02** | 正式 OA Skill 未生效 / 资产撤回**禁止正式输出** | **PASS** | `formalguard` 为正式输出唯一权威；`build06`（B1 正式输出门禁）+ `joint` D4-37/39/40（撤回 → 本地引用 `INVALIDATED` → 使用前验证拒绝、零出站） |
| **LANG-01** | 中/英切换完整，**用户输入/来源/草稿不被误翻译** | **PASS**（含边界）⚠ | `ui` LANG-01a…l **12/12**（真实浏览器，含 `__langProbe` 逐节点探针）+ `i18n` 21/21；历史长尾文案见 §5 边界 |
| **SEC-01** | 服务端权限、SSRF、prompt injection、机密数据外发负例通过 | **PASS** | `sec` 17/17、`build06` 61/61、`dual` 51/51；连接层 SSRF（DNS 全解析 + `pinnedLookup` 防 rebinding）+ 不可信内容边界包裹实测 |
| **REL-01** | 代码 0.1.3 版本一致，完整回归、Schema 升级、可回滚 | **PASS** | `VER-01`（五处版本一致）+ `VER-02`（=0.1.3）；全量 797/797；`docs/MIGRATION_AND_ROLLBACK.md`（**0.1.3 无需迁移**，回滚目标 0.1.2） |

**统计**：`PASS` 12（UX-01…04、RES-01/05、ED-01/02、PLAN-01、PROD-01/02、SEC-01、REL-01 中 12 项）；`PASS（受限，带 ⚠ 备注）` 3（RES-03、RES-04、LANG-01）；`BLOCKED` 2（RES-02 与 RES-03/RES-04 的**商业供应商侧**统一为 `BLOCKED_NOT_CONFIGURED`）；`FAIL` 0；`NOT_TESTED` 0（长尾项另列 §5）。

---

## 3. 真实 AI 功能的证据与诚实边界

### 3.1 已实现且可验证（适配器 + 契约替身，真实 HTTP）

| 能力 | 实现 | 证据 |
| --- | --- | --- |
| 供应商注册表（**不写死供应商**） | `lib/mos/adapters/websearch.js` | `providerStatus().readiness`；`research013` |
| 受限网页读取（SSRF 复用 + 体积/超时上限 + 不可信边界） | `lib/mos/research-fetch.js` | `<<<UNTRUSTED_EXTERNAL_CONTENT …>>>` 包裹实测 |
| 异步研究作业（进度/取消/重试/**幂等**） | `lib/mos/research-engine.js` | `QUEUED(0)→SEARCHING(10)→FETCHING(35)→VERIFYING(55)→ANALYZING(75)→DONE(100)`；取消后终态不被覆盖 |
| 文本/图像生成 | `lib/mos/adapters/text.js`、`image.js` | Provider 契约自检 `provider` 26/26（成功/429/5xx/超时/空响应） |

### 3.2 未达成的部分（**不得标为 PASS / REAL**）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| **商业搜索 API 真实调用**（RES-02 核心） | **BLOCKED_NOT_CONFIGURED** | 无凭据、无费用授权 → 零出站。配置 `websearch.*` 后代码无需改动即可用 |
| **商业模型真实调用**（多来源 AI 研究） | **BLOCKED_NOT_CONFIGURED** | 同上（`integrations.textProvider` + 密钥） |
| **AI 视频成片** | **NOT_IMPLEMENTED** | `image.videoStatus()` 如实声明；本轮只提供 `SCRIPT/STORYBOARD/KEYFRAME/ASSET_UPLOAD/FINAL_CUT_UPLOAD`，**不宣称 AI 生成成片** |
| **MOCK 通道** | 不计为 REAL | `provider` PC-06b 断言：Mock **不**被标为 `REAL`；`readiness=NOT_CONFIGURED` + `simulated:true` |
| **SPECIAL-01 原件** | **BLOCKED** | 原件未随包交付 → 41 项字典项恒「待核验」；`C01/C03/C06` 批准**不洗白** |

> **没有任何**商业供应商凭据，因此本次交付**不存在** `PASS_REAL`。所有涉及外部真实供应商的条目按
> `BLOCKED_NOT_CONFIGURED` / `NOT_IMPLEMENTED` 记录，**未把 Mock 或契约替身冒充为真实供应商**。

---

## 4. 员工操作体验（交互减法）

| 项 | 0.1.2 基线 | 0.1.3 实测 | 目标 |
| --- | --- | --- | --- |
| 任务内切「视频/图片/审核」是否跳出任务 | **跳出** | **不跳出**（面板内渲染） | 不跳出 ✅ |
| P2 落地页 → 正文可编辑 | 1 点击但**不可编辑** | **2 个主要动作**直达可编辑 | ≤2 ✅ |
| 配图对话框暴露的字段 | 含 Prompt/色号/供应商/模板 | **用途 / 视觉类型 / 画面说明**（+ 折叠的「高级」模板）+ **实时效果预览** | 品牌减法 ✅ |
| 语言切换是否丢失未保存编辑 | 会重渲染丢状态 | **保留编辑**（`hasUnsaved()` 判定，仅写 `PUT /auth/preferences`） | 不丢 ✅ |
| 用户内容是否被误翻译 | 字典全局替换 → **会误翻** | **不会**（`data-notranslate` + 9 类受保护节点，逐节点且向下继承） | 不误翻 ✅ |

真实浏览器证据：`UI_EVIDENCE/PHASE0/`（16 图 / 17 步基线，`jumpOutTabs: 2`、`p2ActionsToEditor: 1`）、
`PHASEA/`（17 图 / 18 步）、`PHASEC/`（24 图 / 23 步 / **0 控制台错误**）。
Chromium 版本 **155.0.8059.79** 已记录，交互回归由真实浏览器完成（**未以 DOM 单元测试替代**）。

---

## 5. 失败项处置（本轮 4 项，**逐一解决，无跳过、无隐瞒**）

`joint` 套件在本轮首次以**入库脚本**重跑，暴露 4 条失败断言。定位与处置如下：

| # | 断言 | 失败现象 | 根因判定 | 处置 |
| --- | --- | --- | --- | --- |
| 1 | `D4-15` 契约基线一致（冻结枚举 71 项） | `openapiEnum=undefined` | **测试断言读错端点**：`OPENAPI_ERROR_CODE_ENUM` / `PROVIDER_DECLARED_ADDITIONS` 在 `/api/mos/integration/contract`，而断言从 `/api/mos/integration/workspace` 的 contract 读取（该端点只暴露 sha256 + 端点摘要） | 改为读权威端点 `/api/mos/integration/contract`，并**同时校验两个端点的 `openapiSha256` 一致** |
| 2 | `D4-15b` 错误码表 71 + 2（非闭合枚举） | `additions=undefined` | 同上（端点错误） | 同上；实测 `errorCodeCount=73`、`providerDeclaredAdditions=["BAD_REVIEW_OUTCOME","TOO_MANY_REVIEWS"]`、`errorCodePolicy` 含「非闭合」 |
| 3 | `D4-26` 未映射用户同步如实拒绝 | `code=undefined`，`syncHTTP=409 NOT_APPROVED`，`pre=FAIL` | **测试夹具缺陷**：`a2` 建单时**漏了原生 Provider 必填的 `reuseScope`/`externalAiTransferPolicy`** → 预检 FAIL → 送审 409 → 审核单不产生 → 审批链走不完 → 用例**根本到不了**目标代码路径（假失败） | 补齐夹具必填字段；**新增 `D4-26a` 夹具完整性守卫**（先证明"该走到的路径真的走到了"），产出 `code=NO_PROVIDER_USER_MAPPING` |
| 4 | `D4-44` schema 已升到 v5 | `schemaVersion=7` | **遗留硬编码断言**：v5 是 BUILD-04 时代的集成态基线，此后 v5→v6（用户偏好）、v6→v7（研究域）均为**只增不改** | 改为校验「**不低于集成态基线 v5** 且 接口值 = 模块常量」，避免每次升版假失败 |

**同时发现并修正的两处证据链缺陷**（属本版真实缺陷，非断言问题）：

| # | 缺陷 | 影响 | 处置 |
| --- | --- | --- | --- |
| 5 | `studio` 套件证据文件名 `studio-result.json` 与汇总器期望的 `v013-studio-result.json` **不一致** | **29 条断言被静默漏统计**（全量汇总少算 29） | 统一为 `v013-studio-result.json`；全量 895 → **924** |
| 6 | `summary.json` 头部元数据仍写 `V0.1.1` / `mosVersion 0.1.1` | 违反 REL-01「测试元数据 = 0.1.3」 | 改为 `V0.1.3` / `0.1.3`，并同步 runner 头注释 |

### 5.1 证据勘误（对 0.1.2 登记行的诚实回填）

0.1.2 登记行曾引用 `TEST_EVIDENCE_MOS_BUILD04/dual-e2e-result.json` 记 **`joint 64/64 通过`**。
本轮复核发现：**该 JSON 由更早一版测试脚本生成，是陈旧证据** ——

- 其 `D4-15` 明细为 `sha=… codes=71`，而入库脚本的明细为 `sha=… openapiEnum=…`（**明细串不同**）；
- 其中**不含** `D4-15b` 用例（入库脚本含）。

即：**陈旧证据不是入库脚本的通过证据**。以入库脚本重跑即暴露上表 4 条问题。现已全部修正，复跑 **`joint 66/66`**。
0.1.2 的联合验收结论以本版修正后的口径为准。**未删除、未改写任何历史证据文件**。

---

## 6. 交付物清单

| 类别 | 文件 |
| --- | --- |
| 阶段报告 | `reports/PHASE0_BASELINE.md`、`PHASE_A_UX.md`、`PHASE_B_REAL_RESEARCH.md`、`PHASE_C_CONTENT_I18N.md` |
| 最终验收 / 遗留项 | `reports/FINAL_ACCEPTANCE_V0.1.3.md`（本文件）、`reports/OPEN_ITEMS_V0.1.3.md` |
| 变更日志 | `CHANGELOG.md`（新增 `[0.1.3]` 段，五阶段逐条） |
| 发布登记 | `docs/RELEASE_REGISTER.md`（0.1.3 登记行 + 0.1.2 勘误） |
| 迁移与回滚 | `docs/MIGRATION_AND_ROLLBACK.md`（结论：**0.1.3 无需数据迁移**） |
| 测试证据 | `TEST_EVIDENCE_MOS_BUILD01/summary.json`（924/924）、`TEST_EVIDENCE_MOS_V013_{STUDIO,RESEARCH,I18N}/`、`TEST_EVIDENCE_MOS_BUILD04/`、`TEST_EVIDENCE_MOS_BUILD06/` |
| 浏览器证据 | `UI_EVIDENCE/{PHASE0,PHASEA,PHASEC}/`（截图 + `steps.json`，0 控制台错误） |
| AI 接口调用证据（脱敏） | `REAL_PROVIDER_EVIDENCE/{provider-contract-log-sanitized.json, research-job-trace-sanitized.json}` |
| 源码包 | `bash tools/package-mos-source.sh` 生成（`*.zip` 已 gitignore，可重生成） |

---

## 7. 终裁

| 项 | 结论 |
| --- | --- |
| 应用侧（本仓库）验收 | **PASS** —— 全量 797/797；`joint` 66/66；`build06` 61/61；汇总 924/924；失败项 0 |
| **联合验收（跨系统）** | **CONDITIONAL** —— Provider 侧 `LIBRARY_HANDOFF_BUNDLE` 未交付；无商业供应商凭据；`SPECIAL-01` 原件未提供；Skill 未获真人批准 |
| 生产部署 | **未执行** —— 需另行书面授权 |
| 人工签署 | **未完成** —— 不得代签 |

**不得将本报告解释为"AI 全网研究已真实可用"或"生产可上线"。** 真实商业搜索/模型的启用条件仅为
「配置凭据 + 授权费用」，代码侧无需改动；在此之前一律 `BLOCKED_NOT_CONFIGURED`。
