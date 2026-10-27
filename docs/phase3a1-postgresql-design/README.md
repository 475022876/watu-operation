# Phase 3A-1 PostgreSQL设计交付

阅读顺序：PG01→PG02（结合SQL/ER/字段目录）→PG03→PG04→PG05→PG06→PG07。

7份PG文档是主交付；POSTGRESQL_SCHEMA_DRAFT.sql是74表设计草案；TABLE_CATALOG.json为字段/约束目录；JSON_TO_PG_MAPPING.md、KEY_ENTITY_RELATIONSHIPS.mmd和TX01_TX10_MAPPING.md是映射/图/事务附件。SOURCE_ANALYSIS.json记录只读基线/文件摘要和静态路由清单；DESIGN_VALIDATION.json明确本轮只静态检查，未执行SQL或迁移。

本轮仅设计，不能将SQL草案直接当作生产migration。全局/nullable-brand授权、冻结/追加触发器及RLS真实测试等门禁见PG07。源码中新增发现的H05字段覆盖疑点仅记录，未改业务代码。

已验证基线7f05078614a789b94a040f67b18e462f2284f063；应用0.1.6/schema8保持。生产容量/真实数据质量/外部服务/PG性能与恢复结果未知。完成后等待人工批准，不自动进入Phase3A-2。

_build_design.py仅用Python标准库生成文档和SQL文本，读取受版本控制源码，无应用/SQL连接入口；不是迁移工具。运行它会覆盖本设计目录生成文件，应仅在审阅后用于重新生成。
