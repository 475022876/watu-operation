# PHASE B —— AI 情报研究与候选选题 交付报告（V0.1.2）

> 执行包：《VFIB Marketing OS V0.1.2 — AI Intelligence & Task-Driven UX Codex》02（研究）/ 03（编辑）/ 06（实施）/ 07（验收）
> 基线：V0.1.1（schema v5）→ Phase A（v6）→ **Phase B（schema v7）**
> 日期：2026-10-13　|　测试口径：`research` 套件 55/55（新增）；全量回归见 §6

---

## 1. 交付范围

执行包 Phase B 要求的「AI 情报研究、可信来源、授权全网研究、结构化报告、证据链、AI 选题建议及上级审核」全部落地：

| 能力 | 实现 | 诚实性口径 |
|---|---|---|
| 可信来源每日汇编（TRUSTED_DAILY） | `POST /api/mos/research/daily` 从**真实采集**的 `source_items` 生成结构化报告 + SourceEvidence（含内容哈希）+ FACT 发现 | 采集条目是 real → 报告可 REAL；空库时**如实空报告**，绝不编造发现 |
| 全网研究（WEB_RESEARCH） | `POST /api/mos/research/web` → `lib/mos/adapters/websearch.js` | **无凭据 → 整体 BLOCKED（NOT_CONFIGURED）**，零网络请求、零伪造发现；真实 Provider 接入点已留（`PROVIDER_NOT_IMPLEMENTED`） |
| SSRF / 抓取安全 | `assertSafeUrl()`：仅 https、拒绝环回/私网/链路本地/保留段、内网主机名、非 443 端口 | 字面校验层；真实实现须连接期 IP 复核（已在代码注释声明） |
| 证据链 | `source_evidence`（URL/机构/发布日/抓取日/quote/contentHash/digest）逐条绑定发现 | 发现无证据 → 强制 `NEEDS_VERIFICATION`（fail-closed，不得 VERIFIED） |
| 结构化报告 | `research_reports`（mode/status/provider/costUsd/blockedReason/findings）+ `research_jobs` 留痕 | BLOCKED 也是一等状态并落审计 `research.web_blocked` |
| AI 选题建议 | `POST /api/mos/topic-proposals`（source=AI → `AI_RECOMMENDED`） | AI 建议只是候选，**绝不平行建正式 Topic** |
| 上级审核 | `POST /api/mos/topic-proposals/:id/decision`（`editorial.approve`，仅 P1/管理员）+ 一屏决策 + 人工改动 `editDiff` 落审计 | **不代替** `library.asset.approve.final`；批准 ≠ 可入库 |
| SPECIAL-01 栏目适配 | `checkCategory()`：C06 缺公告授权 / C01、C03 缺正式依据 → `needsVerification=true` 且批准后**不洗白** | 无规定处保留「待确认」，不自创规范 |

## 2. 数据模型（schema v7，只增不改）

新增 5 个集合（Phase A v6 → v7 迁移幂等，`load()` 用 BASE_SHAPE 兜底 + 迁移显式补齐）：

- `research_reports`（RS-xxxx 编号，`db.seq.research`）
- `research_findings`（FACT / INTERPRETATION / RECOMMENDATION）
- `source_evidence`（contentHash = sha256(content 或 url|title)，digest = evidenceDigest）
- `topic_proposals`（TP-xxxx 编号；状态机见 §3）
- `research_jobs`（搜索通道调用留痕，含 BLOCKED 原因）

**为何现有模型不能承载（05 §先证明再新增）**：`source_items` 是采集原始条目、`evidence_references` 是 Topic 级证据引用，二者均不承载「报告→发现→逐条证据→候选选题」的前置阶段与状态机，故新增轻量集合；不复制、不双写旧集合。

新增权限（`lib/mos/dict.js`）：`research.create`（P1/P2/P4）、`editorial.approve`（仅 P1）。

## 3. Proposal 状态机（03 §）

```
AI_RECOMMENDED ──submit──▶ PENDING_EDITORIAL_REVIEW ──decision──▶ APPROVED | REVISION_REQUESTED | ON_HOLD | REJECTED
                              ▲       │                                   │
                              └───────┴──── REVISION_REQUESTED / ON_HOLD ──┘（修订重提，revision+1，保留版本）
APPROVED / REJECTED = 终态（再决策 → 409 BAD_TRANSITION）
```

- 决策端点支持一屏修改：标题 / 角度 / 栏目 / 平台 / 交付物 / 风险；修改后**重过 SPECIAL-01 校验**，`editDiff`（from→to）落审计 `metadata`。
- 获批（APPROVED）仅表示「编辑批准入池」；正式 Master Topic 由 **Phase C** 建立（本阶段未动 `master_topics`）。

## 4. API 一览（全部经 rbac 品牌范围 + 权限校验，默认拒绝）

| 端点 | 说明 |
|---|---|
| `GET /api/mos/research/provider-status` | Web Search Provider 状态（未登录 401） |
| `POST /api/mos/research/daily` | TRUSTED_DAILY 汇编（research.create） |
| `POST /api/mos/research/web` | WEB_RESEARCH（无凭据 BLOCKED） |
| `GET /api/mos/research/reports[/:id]` | 报告列表/详情（品牌范围过滤） |
| `POST /api/mos/topic-proposals` | 创建候选选题（AI / EMPLOYEE 两路） |
| `GET /api/mos/topic-proposals[/:id]` | 列表/详情（含 canDecide） |
| `POST /api/mos/topic-proposals/:id/submit` | 提交审核（状态机校验，非法 → 409） |
| `POST /api/mos/topic-proposals/:id/decision` | 一屏审核（editorial.approve；editDiff 落审计） |

## 5. 前端（情报资讯模块新增两页签）

`public/mos/js/modules/intelligence.js`：

- **AI 研究**页签：报告列表（模式/状态/发现数/关联选题数）、「汇编每日情报」、「发起 Web 研究」（BLOCKED 原因如实展示 + 顶部通道状态 callout）、报告详情抽屉（发现 + 证据链接 + 内容指纹 + 核验规则说明）。
- **选题建议**页签：状态筛选、新建候选选题（员工 → 待审）、详情抽屉（SPECIAL-01 提示、支撑发现、人工改动 diff）、`AI_RECOMMENDED` 一键提审、P1 一屏审核弹窗（可改标题/角度，四态决策 + 意见）。
- 不可信内容一律 `esc()` 转义展示；无凭据状态明示「不伪造」。

## 6. 测试证据

### 6.1 新增套件 `tools/mos-e2e-v012-research.js`（`run-mos-tests.sh research`，**55/55 通过**）

真实服务器 + 真实 HTTP + 隔离数据目录（9660-9667 区段），覆盖：

- **A 鉴权**：未登录 401；provider-status 未配置（configured=false）。
- **B TRUSTED_DAILY**：COMPLETED、RS 编号自增、发现数=实际数（空库如实 0）。
- **C WEB_RESEARCH**：BLOCKED + NOT_CONFIGURED 原因、零发现、注入字符串按纯数据存储。
- **D 报告**：列表/详情/404；跨品牌 → **404 防枚举**（SEC-03，与不存在同形）。
- **E SPECIAL-01**：C99 → 400；C06 无授权 / C01 无依据 → needsVerification=true；C02 → false；XSS/prompt-injection 原样存储；跨品牌创建 → 404。
- **F 状态机/RBAC**：P2 审核 → **403**（editorial.approve 默认拒绝 + 审计）；AI→提交→批准（editDiff 精确记录）；重复提交/终态再决策/非法决策 → 409；退回修订 revision+1 → 重提；C06 缺授权被批准后 needsVerification **不洗白**。
- **G SSRF 负例**：http 明文/环回/169.254.169.254/10.x/.local/.internal/8443 全拒，正常 https 放行。
- **H 审计落盘**：停服后直读 `mos.json`——`research.daily_completed`、`research.web_blocked`、`proposal.created/submitted/decision` 全部持久化（29 条事件）。

证据：`TEST_EVIDENCE_MOS_V012_RESEARCH/v012-research-result.json`（已注册进 run-mos-tests.sh 汇总）。

### 6.2 全量回归

见 `summary.json`（`bash tools/run-mos-tests.sh all`）：smoke/unit/sec/sched/provider/workspace/dual/e2e/e2e02/e2e03/ui/**research** 共 12 套件全绿。

## 7. 已知边界与 BLOCKED（如实声明，不冒充）

| 项 | 状态 | 说明 |
|---|---|---|
| Web Research 真实通道 | **BLOCKED（NOT_CONFIGURED）** | 无 MOS_WEBSEARCH_PROVIDER / API_KEY；接口形状已按真实 Provider 设计，凭据+授权+费用批准后接入；期间零伪造发现 |
| LLM 生成发现 | **NOT_CONFIGURED** | 文本/图像 Provider 无凭据（沿用 V1.2 口径）；发现仅来自真实采集条目 |
| SPECIAL-01 原件 | 41 项 provisional | 栏目约束按正式 V1.1 手册既有判定实现，等待原件核对（沿用既有待办） |
| 越权响应码 | 404（设计） | 品牌越权与不存在同形 404（SEC-03 防枚举），并落 `brand.scope.denied` 审计；「无权限但资源可见」场景返回 403 |

## 8. 红线复核（零违反）

- ❌ 未修改企业资料库源码；未改共享 API V1.0。
- ❌ 未建平行正式账本：APPROVED 提案未生成任何 `master_topics`（Phase C 职责）。
- ❌ 未把 Mock 冒充真实：无凭据通道全部 BLOCKED 并落审计。
- ❌ 未部署生产；S05 / MARK 系列未建设。
- ✅ 审批分离：`editorial.approve` ≠ `library.asset.approve.final` ≠ 内容审核 ≠ 发布审核。
