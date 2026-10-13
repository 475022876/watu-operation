# LIBRARY_HANDOFF_REQUEST.md —— 致企业资料库项目的交接请求

> **本文件是 Marketing OS（Consumer，联调牵头方）向 Enterprise Workspace（Provider）发出的正式请求。**
> 依据 `01_WORKSPACE_CODEX_TASK.md` Phase L0—L3 与 `03_SHARED_CONTRACT_AND_ACCEPTANCE.md` §6。
> 发出时间 **2026-10-13** ｜ 本侧基线提交 `3c19e79`
>
> **当前状态：`LIBRARY_HANDOFF_BUNDLE` 尚未收到**（本机全域检索无产物）。
> 在收到之前，本侧**已完成**：Phase M0 预检、契约静态交叉核验、8 项契约差异清单、适配层符合性修正；
> **全部真实联调项标记 `BLOCKED`**，不以 Mock 冒充 REAL。

---

## 1. 请资料库侧交付的产物（`LIBRARY_HANDOFF_BUNDLE/`）

| # | 产物 | 用途 | 收到前本侧能否推进 |
|---|---|---|---|
| 1 | `PROVIDER_BASELINE.md` | 真实版本/提交、运行命令、测试隔离方式 | ❌ 不能确定"对齐哪个版本" |
| 2 | `PROVIDER_API_OPENAPI.yaml`（**由真实路由推导**，非手写） | 机器可校验的端点契约 | ❌ 不能做契约一致性自动比对 |
| 3 | `SERVICE_AUTH_HANDOFF.md` | 安全认证方式、**非敏感配置键名**、密钥协商与轮换、**脱敏**请求样例 | ❌ 无法配置签名与票据 |
| 4 | `TEST_FIXTURES.md` | 合成测试身份/权限矩阵、品牌、样本资产与 Skill | ❌ 无法构造正/反例 |
| 5 | `PROVIDER_TEST_REPORT.md` | 命令、断言、失败/跳过、证据路径 | ❌ 无法合并双方结论 |
| 6 | `PROVIDER_BLOCKERS.md` | 待本侧配合事项、需人工批准项、外部依赖 | ❌ 无法分工 |
| 7 | `CHANGELOG.md` + 仅本仓库源码交付 | 版本可追溯 | ❌ — |

> **禁止项**（`01_WORKSPACE_CODEX_TASK.md`）：交接包**不得**包含私钥、token、真实密码。
> 本侧只需要**公钥指纹/公开密钥**、**非敏感配置键名**、**测试服务地址**与**测试主体标识**。

## 2. 本侧需要的**具体**非敏感项（可直接照填）

```text
[ ] 测试环境 Base URL（仅测试环境；建议 https）
[ ] 服务账户标识（keyId / serviceAccountId）
[ ] 该服务账户已授予的 scope 清单（应为 8 项之一或多个，不含 admission.final.decision）
[ ] 服务账户验签公钥（PEM 或指纹）—— 用于本侧自检互通
[ ] 签名算法的**时间窗**（秒）与 nonce 保留策略/上限
[ ] 限流配额（rateLimitPerMinute）与配额窗口定义
[ ] 票据 TTL 默认值（ticketMaxSeconds）与**重取语义**（过期后是否可直接重签）
[ ] 分页上限（maxPageSize）与片段上限（maxSnippetChars）
[ ] 最终审批授权身份的**角色/范围标识**（不含姓名/账号）：即 "library.asset.approve.final" 由谁持有
[ ] changes 游标的**建议轮询间隔**与**撤回生效的最大容忍时延**
[ ] 网络不可用时，Provider 对已撤回资产的处理保证（是否仍会签发/放行）
```

## 3. 请资料库侧**回答**的 8 个契约问题（对应 `CONTRACT_DIFF.md`）

| # | 问题 | 阻塞的能力 |
|---|---|---|
| Q1 | 权威应用版本与提交号究竟是 **V1.1.3 还是 V1.1.7**？（执行包记载与源码自述不一致） | D-00 |
| Q2 | 事件类型字面量是否即为那 **7 条**且**冻结**？后续新增如何通知？ | INT-06 / INT-08 |
| Q3 | `error.code` 是否为**闭合枚举**？新增策略是什么？ | 重试策略正确性 |
| Q4 | `knowledge/search` 的 `body.filters` 可接受 **schema** 是什么？ | 检索精确度 |
| Q5 | 三种分页语义（`knowledge` 不分页 / `assets` 字符串 offset / `changes` 整数 seq）是**有意设计**还是遗漏？ | 翻页与游标 |
| Q6 | **`libraryPrimaryCategory` 的七大资料区语义与准入门槛**：哪些区允许营销侧提交？是否需额外授权？ | **INT-05（阻塞）** |
| Q7 | **`classification` 与 `licenseStatus` 的权威映射**：营销侧资产类型的默认密级？既有文本许可（如 `INTERNAL_DRAFT`）如何映射到 `cleared/pending/restricted/expired/unknown`？谁有权升级密级？ | **INT-05（阻塞）** |
| Q8 | `admissions/:id/submit` 的 **`reviews[]` 逐字段 schema**（`reviewerUserId` / 结论取值 / 备注长度）与 `skills/:id` 的 `publicView` 字段清单 | INT-05 / INT-08 |

> 本侧对 Q6/Q7 的回答**不做任何猜测**：`createAdmission()` 已改为**出站前预校验**，
> 缺字段即本地拒绝（`BAD_ADMISSION_INPUT` + `missing[]`，零出站），**绝不发出一份必然被拒的请求**。

## 4. 请资料库侧准备联调所需的最小环境

| # | 项 | 说明 |
|---|---|---|
| 1 | 独立**测试**实例（非生产） | 与生产库/生产配置隔离；不得改动生产状态 |
| 2 | 已登记的 Marketing OS 服务账户 | scope 建议：`knowledge.search` / `assets.search` / `assets.read` / `admissions.write` / `admissions.read` / `skills.read` / `changes.read` / `tickets.issue` |
| 3 | 合成测试身份矩阵 | 至少含：普通员工、资产预检员、**持有 `library.asset.approve.final` 的本人授权身份**、无权限用户 |
| 4 | 合成品牌与样本资产 | VFIB / U CARD 两品牌；含**高密级**、**已撤回**、**已过期**样本（用于反向验证拒绝路径） |
| 5 | 合成 Skill（含过期/撤回版本） | 用于验证"未经人为批准不得 EFFECTIVE"与历史版本只读 |
| 6 | `INTEGRATION_DISABLED=on` 场景 | 用于验证 503 `INTEGRATION_DISABLED` 与"未授权接入默认关闭" |

## 5. 资料库侧**不得**做的事（双方责任分界，`03` §1）

- 不得开发 Marketing OS 页面、发布日历或 Published Archive；
- 不得改写普通 OA 审批业务定义；
- 不得把全部 Approved 文档默认为营销可复用资产；
- 不得以超级管理员口令替代最终审批；
- 不得直接向本侧开放 `db.json`、文件夹或内网未授权路由。

## 6. 收到交接包后，本侧将立即执行的步骤

1. 用 `PROVIDER_API_OPENAPI.yaml` **自动比对**本侧 `workspace-contract.js` 的端点/字段/错误码 → 更新 `INTEGRATION_DIFF.md`。
2. 双方签署 `CONTRACT_DIFF.md` 的 D-00…D-10。
3. 按 `SERVICE_AUTH_HANDOFF.md` 配置测试环境（**私钥只在服务端**，不入库不入日志）。
4. 补齐本侧阻塞项 **T-01**（准入表单新增 `libraryPrimaryCategory` / `classification` / 枚举化 `licenseStatus`）与 T-02…T-07。
5. 在**同一隔离测试环境**执行 `INT-01`…`INT-14` 全部联合验收用例，产出 `JOINT_ACCEPTANCE_REPORT.md` 终版。
6. 仅当验收矩阵全绿，才提出**试运行建议**；**生产部署仍需业务方单独批准**。

---

**请将 `LIBRARY_HANDOFF_BUNDLE` 放置位置告知本侧**（建议与本执行包同级目录），本侧收到后立即进入 Phase M1。
