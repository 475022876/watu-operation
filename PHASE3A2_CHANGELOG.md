# Phase 3A-2 变更与交付记录

日期：2026-10-28；应用版本保持 V0.1.6。独立分支：`feature/postgresql-phase3a2`。

## 基线与保护

执行前核实本地及远程 `baseline/consolidation-phase2` 均为 `bbd365816bfef20f4c5425816a5e4b5675bc516c`，原工作树无业务修改；从该提交创建独立 managed worktree。main、Phase 1、Phase 2 和历史提交保留。未读取生产配置、密钥或业务 JSON；测试仅使用新建临时集群、合成账号和合成业务数据。未改生产数据库、Enterprise Workspace 或正式双系统 API。

## 提交与变更

- `5cd6a33`：H05 内容版本引用从错误 `taskId` 改为实际 `contentTaskId`，附修复前后安全负例。
- `64195fb`：首批 PostgreSQL 18 隔离环境、四个 Migration、签名 RLS 上下文、Repository/UoW 及实际数据库测试检查点。
- 后续本分支提交：第五个兼容性/不可变约束 Migration、总事务期限、迁移源摘要、环境准备和受控清理工具、最终测试证据及本组报告。准确最终提交见 `git log bbd3658..HEAD`，避免报告自引用提交散列。

新增 `lib/mos/pg/` 为显式启用的基础组件，没有被业务启动链导入。`pg@8.23.1`、开发依赖 `node-pg-migrate@9.0.0` 固定版本，安装禁用 lifecycle scripts；本轮 npm audit 为 0 漏洞。JSON 应用 Node 要求仍为 >=18，PG 开发工具需要 >=20.11，本机实际 Node 24.19.0。

## 结果

真实隔离 PostgreSQL 18.6：100/100；原有 17 套业务回归：880/880；Phase 1：57/57；Phase 2：53/53；新增 H05：12/12。共 1102 项本轮检查通过，另有受控清理工具 2/2。生产/真实 Workspace/收费模型/社交发布均未执行，不作为通过项。

历史证据文件由旧测试脚本生成后已恢复，当前输出另存 `TEST_EVIDENCE_PHASE3A2/`。原 Phase 2 的 990 项不计入本轮。

## 回滚与未完成项

详见 PHASE3A3_READINESS.md。未切换业务存储、未双写、未迁移生产数据、未升级应用、未自动进入下一阶段。基础 Repository 不等于全部业务路由已迁移；TX01—TX10 业务事务仍需后续授权实施。
