# Phase 3A-1 PostgreSQL设计交付

阅读顺序：PG01→PG02（结合SQL/ER/字段目录）→PG03→PG04→PG05→PG06→PG07。

7份PG文档是主交付；POSTGRESQL_SCHEMA_DRAFT.sql是74表设计草案；TABLE_CATALOG.json为字段/约束目录；JSON_TO_PG_MAPPING.md、KEY_ENTITY_RELATIONSHIPS.mmd和TX01_TX10_MAPPING.md是映射/图/事务附件。SOURCE_ANALYSIS.json记录只读基线/文件摘要和静态路由清单；DESIGN_VALIDATION.json明确本轮只静态检查，未执行SQL或迁移。

本轮仅设计，不能将SQL草案直接当作生产migration。全局/nullable-brand授权、冻结/追加触发器及RLS真实测试等门禁见PG07。源码中新增发现的H05字段覆盖疑点仅记录，未改业务代码。

已验证基线7f05078614a789b94a040f67b18e462f2284f063；应用0.1.6/schema8保持。生产容量/真实数据质量/外部服务/PG性能与恢复结果未知。完成后等待人工批准，不自动进入Phase3A-2。

_build_design.py仅用Python标准库生成文档和SQL文本，读取受版本控制源码，无应用/SQL连接入口；不是迁移工具。运行它会覆盖本设计目录生成文件，应仅在审阅后用于重新生成。


## Phase 3A-2 实施校正（2026-10-28）

实际执行入口为 migrations/postgresql 的五个版本，字段目录 implementation 记录实际约束统计。74 张表、181 个外键保持；84 个被主键/唯一索引/前缀索引覆盖的冗余索引省略，实际 307 个索引。61 张表启用 FORCE RLS。原始草案在隔离 PostgreSQL 18.6 实际执行时因函数所有者转移缺少 schema CREATE 权限而失败（42501），事务回滚；修正版临时授权后收回。RLS 改为绑定 actor/brand/backend/transaction/expiry 的 HMAC 上下文，并以当前授权再次校验；未签名 GUC 不构成信任。新增不可变审核/审计、冻结内容/文件及审批状态触发器；不删除业务字段或正式 API。具体以 PHASE3A2_SCHEMA_VALIDATION.md 和实际 Migration 为准。历史草案不是当前初始化入口，旧生成器不得覆盖已审查的 Migration。
