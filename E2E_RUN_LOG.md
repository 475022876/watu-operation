# E2E 运行日志 — VFIB Marketing OS V0.1.2

## 最终全量回归（升版 0.1.2 之后，发布前最后一次）

- 命令：`bash tools/run-mos-tests.sh all`
- 日期：2026-10-14（本地，UTC+8）
- 结果：**汇总 773/773 断言通过（全部套件通过）**，fail=0，skip=0
- 套件（13）：smoke unit sec sched provider workspace dual e2e e2e02 e2e03 ui research editorial
- 证据根：`TEST_EVIDENCE_MOS_BUILD01/summary.json` + 各 `TEST_EVIDENCE_MOS_*/` 目录

| 套件 | 断言 | 备注 |
| --- | --- | --- |
| smoke | 13/13 | 版本元数据 0.1.2 |
| unit | 75/75 | 含 schema v7 迁移断言（U-19 系列） |
| sec | 17/17 | 出站 SSRF/白名单 |
| sched | 20/20 | 含 v7 断言 |
| provider | 21/21 | Provider 契约（凭据缺失负例） |
| workspace | 36/36 | 资料库契约 V1.1.7 适配（NOT_VERIFIED 口径不变） |
| dual | 51/51 | 双重身份/越权/撤销 |
| e2e | 48/48 | BUILD-01 主链路 |
| e2e02 | 63/63 | BUILD-02 |
| e2e03 | 96/96 | BUILD-03（含 GOV-06 schema v7） |
| ui | 110/110 | 真实浏览器 CDP，截图 28 张 → `UI_SCREENSHOTS/` |
| **research**（本版新增） | **55/55** | Phase B：BLOCKED 诚实性 / SSRF 负例 / 提案状态机 / RBAC / 审计落盘 |
| **editorial**（本版新增） | **43/43** | Phase C：幂等 Saga / 校验前置零写入 / 同源视图 / 独立平台推进 |

## 本版各阶段测试轨迹

| 阶段 | 提交 | 当次回归 | 专项套件 |
| --- | --- | --- | --- |
| Phase 0 基线 | `ee6383d` | — | — |
| Phase A | `9fca396` | 675/675 → 修复 v6 断言后全绿 | ui 106→110 |
| Phase B | `3a372e3` | 730/730（12 套件） | research 55/55 |
| Phase C | `035e959` | 773/773（13 套件） | editorial 43/43 |
| 收口升版 0.1.2 | 本发布 | **773/773 复跑全绿** | — |

## 浏览器工作流（ui 套件，CDP 真实 Chrome）

- 登录/强制改密/岗位工作台/继续上次任务锚点、五主+两辅导航 7 项断言、双语切换 4 项断言
  （langBtn 存在 → 切 EN → 服务端偏好生效 → 切回 zh-CN 恢复）、日历视图、内容编辑器四标签条。
- 截图证据：`UI_SCREENSHOTS/01-login.png … 28-*.png`（与 `UI_EVIDENCE_MOS_BUILD01/` 同源）。

## 已知 BLOCKED（非测试失败）

- Web Research（无凭据）→ 套件内如实断言 BLOCKED，不算失败。
- 文本/图像 Provider（无凭据）→ provider 套件负例断言 NOT_CONFIGURED。
- 企业资料库真实联调 → workspace 套件按契约适配验证，NOT_VERIFIED 口径不变。
