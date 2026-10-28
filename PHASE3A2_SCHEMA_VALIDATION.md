# Phase 3A-2 Schema 实测报告

日期：2026-10-28。基线 bbd3658；实现检查点 64195fb；最终修订见本分支后续提交。命令均在独立工作树根目录，以 Node 24.19.0 执行。

## 执行入口与统计

```powershell
./tools/phase3a2/prepare-pg18.ps1
node tools/phase3a2/migration-manifest.cjs
node tools/phase3a2/migration-probe.cjs
node tools/phase3a2/run-foundation.cjs
```

上述均实际执行通过。环境为独立 PostgreSQL 18.6，随机 loopback 端口、SCRAM、临时目录、合成数据；没有 Windows 服务或生产连接。环境来源及摘要见 `TEST_EVIDENCE_PHASE3A2/dependency-review.json`。EDB 官方 HTTPS 二进制 ZIP 已校验捕获的 SHA256；postgres.exe Authenticode 为 NotSigned，不能声称独立厂商签名已验证。

| 数据库对象 | 实际数量 |
|---|---:|
| 业务表（不含独立迁移元数据） | 74 |
| 主键 | 74 |
| 外键（含复合品牌外键） | 181 |
| 唯一约束 | 113 |
| CHECK | 103 |
| NOT NULL | 659 |
| 索引 | 307 |
| ENABLE + FORCE RLS 表 | 61 |

直接数据库证据：`schema-inventory.json`、`migration-probe.json`、`foundation.json`。字段目录、关系图及集合映射仍在 `docs/phase3a1-postgresql-design/`；TABLE_CATALOG.json 的 implementation 已同步实际结果。无业务字段删除，无大型 JSONB 单表替代。

## 五个版本

1. schema：74 表及关系约束；省略 84 个被已有主键、唯一或索引前缀覆盖的冗余索引，未删除 PK/FK/唯一约束，见 index-review.json。
2. security：pgcrypto、受保护签名密钥、身份/品牌/连接/事务/期限签名上下文及当前授权校验。
3. policies：运行角色权限、强制 RLS、身份/全局配置专用读取路径、来源证据受控写入。
4. integrity：审计/审核/回执不可变、内容冻结、文件 hash/READY 与引用一致性。
5. compatibility-integrity：按既有状态机修正 DRAFT→SUPERSEDED；保护版本作者、审核提交者和终态、最终入库批准、发布文件元数据。

每个版本使用 CJS wrapper 加 SQL。MANIFEST.json 按 UTF-8/LF 规范化源摘要做执行前验证，禁止静默改写已审查源。node-pg-migrate 单事务、版本记录和 advisory lock；重复运行无待执行项。摘要是源码防漂移，不代表已实现对任意人工数据库 DDL 漂移的检测。

## 修复前证据与安全恢复

原 bbd3658 SQL 原样在隔离库执行：实际 FAIL，42501，mos schema CREATE 权限不足；ROLLBACK 后无残留业务 schema，见 original-draft-validation.json。修正版仅在函数所有者转移期间临时授权，随后收回；RLS 不再信任任意 GUC 品牌字符串。

故障第六迁移先建表再除零：实际失败并回滚整个新批次，版本登记 0、mos schema 不存在；重新执行完整五版本通过。原始 loader 原型曾重复读 SQL，已修正匹配 CJS；首轮失败证据保留。禁止用删除约束掩盖失败。

不可变保护经普通角色和隔离测试 owner 的 UPDATE/DELETE 验证。冻结内容、引用文件、审核版本摘要绑定均有正反例。Schema 子组 42/42；其余安全/事务子组见相应报告。

## 回滚及待办

Migration down 显式拒绝自动破坏性降级。失败批次自动回滚；成功初始化的临时库用受控工具停止并清理。未来生产变更须有另行审批的备份恢复/前向修订方案，不能直接套用测试销毁流程。生产迁移、长时间负载、远程 TLS、PITR 未执行。
