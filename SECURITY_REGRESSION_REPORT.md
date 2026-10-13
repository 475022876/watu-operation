# 安全回归报告 — VFIB Marketing OS V0.1.2

> 结论：**无未关闭的 P0/P1 安全回归**。V0.1.2 三个阶段的新增面（导航/i18n、研究域、编辑域 Saga）
> 均按「服务端强制 + fail-closed + 负例覆盖」实施，并通过真实 HTTP 隔离实例回归。

## 1. 回归范围与结果

| 套件 | 内容 | 结果 |
| --- | --- | --- |
| `sec`（mos-security-egress） | 出站 SSRF/白名单/降级诚实性 | **17/17** |
| `research`（mos-e2e-v012-research） | Phase B 安全负例（见 §2） | **55/55** |
| `editorial`（mos-e2e-v012-editorial） | Phase C 安全负例（见 §3） | **43/43** |
| `build06`（双系统真实 HTTP 安全负例） | 双重身份/越权/撤销传播 | **61/61** |
| 全量 `run-mos-tests.sh all` | 13 套件 | **773/773**（升版 0.1.2 后复跑仍全绿） |

## 2. Phase B 新增安全面（research 套件实证）

| 控制点 | 实现 | 负例 |
| --- | --- | --- |
| SSRF 字面校验 | `websearch.assertSafeUrl()`：仅 https / 拒私网、环回、保留段 / 拒内网主机名 / 仅 443 | SS 系列 7 项全拒 |
| Web 研究诚实性 | 无凭据一律 `{blocked:true, code:'NOT_CONFIGURED'}`，零伪造发现 | WB 系列：BLOCKED 如实落库且报告不含编造发现 |
| RBAC 研究权限 | `research.create`（P1/P2/P4）+ `editorial.approve`（仅 P1），默认拒绝+越权审计 | P2 决策 → 403；无权限 → 403（审计 `rbac.denied`） |
| 品牌隔离 | `rbac.assertBrand()`；越权与「不存在」同形（**404 防枚举**，SEC-03 沿用） | UCARD 用户读 VFIB 报告/建 VFIB 提案/审核 VFIB → 404（+`brand.scope.denied` 审计） |
| 不可信内容处理 | prompt injection 字符串**按纯数据存储**（不执行、不解释）；XSS 原样落库、渲染层转义 | XA 系列：`ignore previous instructions…`、`<script>` 标题安全落库 |
| 事实诚实性 | 发现无证据强制 NEEDS_VERIFICATION（fail-closed，不得 VERIFIED） | FV 系列 |
| 审计落盘 | 停服前 `sleep(600)` 等防抖落盘，直读 `data/mos.json` 验证审计行存在 | AU 系列 |
| 状态机 | `PROPOSAL_TRANSITIONS` 白名单；非法迁移 `409 BAD_TRANSITION` | ST 系列非法迁移全拒 |

## 3. Phase C 新增安全面（editorial 套件实证）

| 控制点 | 实现 | 负例 |
| --- | --- | --- |
| 幂等 Saga | fail-fast **全量校验**→内存原子变更→单次落盘；`idempotencyKey` 全局唯一，重放返回快照**零新增** | 重放同 key：无重复 Topic/PlanItem/Task（SG 系列） |
| 校验前置 | 平台/负责人/日期非法 → **4xx 且零写入**（不出现「审批成功但派工缺半」） | 非法平台/负责人 → 400，库内零变化 |
| 编辑权限 | 批准入池/批准并安排/决策 均 `editorial.approve`（服务端强制） | P2 尝试 → 403 |
| 品牌范围 | Saga 与视图端点均过 `assertBrand` | 跨品牌 → 404 防枚举 |
| 继续锚点越权 | `PUT /my-work/continue` 校验任务归属（Phase A，承前） | 他人任务 → 403 + 审计 |

## 4. 既有安全基座复核（未回退）

- `lib/{util,net,security,password}.js` 双侧基座本轮**零改动**（无同步负担）。
- 口令策略：至少 8 位全局基线三处强制（重置工具 / changePassword / upsertUser）——未放宽。
- 会话：HttpOnly Cookie、登录限速、吊销机制未动。
- 正式输出门禁 `formalguard.js`（V0.1.1）继续生效；TEXT 类型校验 `outputIntent` 的修复未回退。
- `Published Archive` 结构性独立（publishing 路由零引用 workspace/library 适配器）——未变。

## 5. 已知边界（非回归缺陷）

- Web Research / 文本·图像 Provider 无凭据 → 功能 BLOCKED（见 PROVIDER_REAL_MOCK_MATRIX.md），**不构成安全风险**（fail-closed 方向）。
- 41 项 provisional 字典项待 SPECIAL-01 原件核验。
