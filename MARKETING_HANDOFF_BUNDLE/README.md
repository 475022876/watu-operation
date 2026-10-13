# MARKETING_HANDOFF_BUNDLE —— 运营中台（Marketing OS）交接包

> 身份：**Integration Consumer（接口消费方）+ 跨系统联调牵头方**
> 执行包：《VFIB 双系统真实联调与最终验收执行包 V1.0》→ `02_MARKETING_OS_CODEX_TASK.md`
> 基线提交 **`3c19e79`** ｜ 交付日期 **2026-10-13**
> 总结论：**CONDITIONAL**（见仓库根 `JOINT_ACCEPTANCE_REPORT.md`）

---

## ⚠ 先读这一句

**`LIBRARY_HANDOFF_BUNDLE` 尚未收到。** 按执行包 Phase M0-2 的规定，本侧已完成
**预检 + 契约映射**，并把**全部真实联调项标记为 `BLOCKED`**——
**没有臆造资料库 API，也没有把 Mock 结果冒充为联调通过。**

## 目录

| 文件 | 对应执行包要求 | 内容 |
|---|---|---|
| `CONSUMER_BASELINE.md` | M4 交付项 1（前半） | 真实版本/提交、运行方式、集成现状、**以 Workspace V1.1.7 实取源码做的静态交叉核验证据** |
| `INTEGRATION_DIFF.md` | M4 交付项 1（后半） | 与资料库真实契约**逐项对应**（27 个契约要素）+ 本侧 7 项已知缺口 |
| `REAL_MOCK_STATUS.md` | M4 交付项 2 | 逐服务能力 + **实际结果 + 版本 + 时间** + 本轮"未发生真实调用"清单 |
| `E2E_TEST_REPORT.md` | M4 交付项 3 | P1—P4 五条端到端流程逐条结果 + 额外要求项 + 失败/跳过/阻断汇总 |
| `UI_TEST_EVIDENCE/` | M4 交付项 4 | 可复现浏览器测试脚本 + 27 张截图 + 逐条结果（**不暴露凭证**） |
| `AI_PROVIDER_AND_SKILL_REPORT.md` | M4 交付项 5 | 真实与模拟**严格区分**；含"解除阻断所需"的具体键名 |
| `SECURITY_AND_DATA_BOUNDARY_REPORT.md` | M4 交付项 6 | 认证/授权/出站/AI 外发/密钥边界/备份恢复 |
| `DEPLOY_AND_ROLLBACK.md` | M4 交付项 7 | 非生产部署、备份、还原、回滚、集成开关安全回退 |
| `CHANGELOG.md` | M4 交付项 8 | 本轮全部变更（**零删除**）+ 影响评估 |
| `CONTRACT_DIFF.md` | `03` §2 要求 | **待双方签署**的契约差异表（D-00…D-10） |
| `LIBRARY_HANDOFF_REQUEST.md` | `03` §6 协作 | 致资料库项目的**交接请求**（含 8 个必答契约问题） |

## 快速事实

| 项 | 值 |
|---|---|
| 全量回归 | `bash tools/run-mos-tests.sh all` → **478/478 全通过**（10 套件，exit 0） |
| 企业资料库契约自检 | **36/36**（原 30，本轮 +6） |
| 真实浏览器检查 | **97/97**（headless Chrome / CDP） |
| 集成现状 | 资料库 `NOT_CONFIGURED`、文本/图像 `NOT_CONFIGURED`、采集 `REAL`、调度**默认关闭** |
| 联合验收 | PASS 4 / CONDITIONAL 4 / BLOCKED 6 / FAILED 0 |
| 生产部署 | **未执行**（未获批准） |
