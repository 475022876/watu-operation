# docs/history —— 历史档案

> 归档原则（整改主控 **D-03**）：**禁止删除**历史审计、自测或 ADRs。
> 过时材料迁移到本目录，**保留 git 追踪**（一律用 `git mv`，`git log --follow` 可追溯原文），
> 并在文首标注归档原因与「取代者」。当前现状见 [`../CURRENT_ARCHITECTURE.md`](../CURRENT_ARCHITECTURE.md)。

## 1. 本轮迁入（2026-10-13 · Phase 4）

| 归档文件 | 原路径 | 归档原因 | 取代者 |
|---|---|---|---|
| `ARCHITECTURE_AUDIT.md` | `docs/ARCHITECTURE_AUDIT.md` | 步骤 0 的**整改前**仓库诊断与风险登记（R-01…R-07） | `docs/CURRENT_ARCHITECTURE.md` |
| `BUILD-02_PLAN.md` | `docs/BUILD-02_PLAN.md` | BUILD-02 已交付，计划已消费 | `docs/BUILD-02_TEST_REPORT.md`、`docs/BUILD-02_SELF_AUDIT.md` |
| `BUILD-03_PLAN.md` | `docs/BUILD-03_PLAN.md` | BUILD-03 已交付，计划已消费 | `docs/BUILD-03_TEST_REPORT.md`、`docs/BUILD-03_SELF_AUDIT.md` |

迁移方式：`git mv`（**非**复制删除）→ git 历史连续，`git log --follow docs/history/ARCHITECTURE_AUDIT.md` 可回溯。
所有指向旧路径的引用**已同步更新**（`README.md`、`docs/ADRs/ADR-001-tech-stack.md`、`docs/ADRs/ADR-002-standalone-repo.md`、`docs/BUILD-01_SELF_AUDIT.md`）。

## 2. 刻意**不**归档（仍为现行材料）

| 文件 | 理由 |
|---|---|
| `docs/ADRs/ADR-001-tech-stack.md`、`ADR-002-standalone-repo.md` | ADR 为长效架构决策记录；D-03 明令禁止删除，且其中决策**仍有效**（零依赖技术栈、独立仓库） |
| `docs/BUILD-01_TEST_REPORT.md`、`BUILD-01_SELF_AUDIT.md` | 交付证据（D-03：自测不得删除）；仍作为 BUILD-01 验收凭据 |
| `docs/BUILD-02_*`、`BUILD-03_*`（TEST_REPORT / SELF_AUDIT） | 同上：交付证据 |
| `docs/MOCK_REAL_MATRIX.md` | **活的**边界矩阵，随集成状态更新 |
| `docs/INTEGRATION_WORKSPACE_CONTRACT.md` | 现行集成契约说明（A-06） |

## 3. 阶段报告（不归档）

整改各阶段报告固定在 `reports/`，**不**迁入本目录（它们是本次交付的正式产物，而非过时材料）：

| 报告 | 内容 |
|---|---|
| `reports/PHASE0_BASELINE.md` | 基线审计与差异清单 |
| `reports/PHASE1_SECURITY.md` | P0 安全与一致性修复（SSRF 加固） |
| `reports/PHASE2_UX.md` | 架构降重与 S04 产品营销修补 |
| `reports/PHASE3_INTEGRATIONS.md` | 资讯调度、Skill、AI 与真实集成准备 |
| `reports/FINAL_AUDIT.md` | ① 总复审与交付清单 |
| `reports/OPEN_ITEMS.md` | 尚未完成事项清单 |
