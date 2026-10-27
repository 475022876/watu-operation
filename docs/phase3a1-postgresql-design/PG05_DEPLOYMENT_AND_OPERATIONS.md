# PG05 PostgreSQL部署与运维设计

设计日期：2026-10-27。唯一分析基线：`7f05078614a789b94a040f67b18e462f2284f063`，分支 `baseline/consolidation-phase2`，仓库 `475022876/watu-operation`。开始时HEAD、origin远程分支及干净工作树一致。应用0.1.6、mosSchemaVersion=8保持不变。

本轮是 **Phase 3A-1设计**：没有导入应用store、启动业务服务、读取生产JSON内容、安装依赖/PostgreSQL、执行SQL、迁移数据或修改任何业务源码。Phase 2的990项记录是既有隔离证据，本轮只核对源码及证据，不将其说成PostgreSQL测试通过。SQL是待评审草案，未在数据库解析或执行；本轮静态检查不能代替下一阶段迁移/约束/RLS验收。

## 版本与部署建议

建议生产主版本 **PostgreSQL 18**，实施时使用该主版本最新安全小版本。2026-10-27官方版本页显示18.6受支持至2030-11-14；17.11受支持至2029-11-08，可作为托管平台尚未验证18时的备选。官方主版本通常支持5年；14接近2026-11-12结束支持，不作新生产基线。版本与日期来自[PostgreSQL版本支持政策](https://www.postgresql.org/support/versioning/)，实际安装日前再次核实。19的预发布不作为此方案生产基线。

优先选择团队可维护的托管PostgreSQL：单个MOS数据库/应用schema，备份、PITR和监控由受控托管能力支撑；可用性需要及预算经批准后配置同地域高可用standby。若资料驻留或现有运维政策要求自建Linux实例，需明确DBA责任、物理备份与恢复演练后再定。当前没有容量实测，不提供采购规格或费用承诺。

保持Marketing OS应用及现有worker逻辑，一个PG权威存储；Outbox先以同代码库worker轮询执行，可独立进程，服务仍共享相同Repository/规则。初期不需要Kafka、Redis、Kubernetes、新CMS、向量数据库或第三方发布系统。大型媒体先保留现有文件存储，外置对象存储另行评审，不搭乘数据库迁移自动搬素材。

## 环境和账号

开发、CI/测试、预生产、生产使用独立数据库实例或至少独立受隔离服务，独立账号/密钥/存储前缀；生产备份不得直接作为开发数据。测试使用合成或经批准脱敏副本，Provider/Workspace/社媒出站默认关闭。CI后续可用短生命周期PG环境做迁移/约束验证，本阶段没有安装或启动任何实例。

|角色|权限设计|禁止|
|---|---|---|
|mos_owner|NOLOGIN，schema/表所有者|不作应用连接账号|
|migration runner|受控CI/运维临时承担owner权限，执行审签migration|应用进程自动执行迁移、持久保存高权限凭据|
|mos_app|登录、必要连接/schema usage、按表最小DML或限定函数；非owner/NOBYPASSRLS|建库/建表/关RLS/全库读取/审计删除|
|mos_worker|仅队列、任务、预算、结果、审计和必要读；原actor/品牌上下文|根据消息自报身份扩权或无品牌全扫|
|mos_guard|NOLOGIN，限定SECURITY DEFINER函数所有者，只读安全元数据|拥有业务表或superuser/BYPASSRLS|
|backup/restore运维身份|托管物理备份或经过审批的恢复通道，审计所有使用|暴露到应用或前端|
|readonly auditor|审批后的品牌视图/脱敏审计|读取密文主密钥、口令散列或跨品牌业务|

global users/sessions/role metadata和nullable-brand表不能直接套通用brand RLS。认证函数读取受限凭据字段且只返回可信principal给服务端；管理settings与全局探针限定MOS_ADMIN；全局撤权登记在所有相关品牌使用前查询。普通用户不能把brand=''解释为管理模式。详细GRANT和安全函数须在下一阶段完整实现并测试，SQL草案默认不开放这些通道。

## 连接池与超时

未来选node-postgres(pg)的Pool；每个请求/事务仅占同一client，finally释放；错误连接销毁。先拟每web进程max10、worker进程max5，举例2web+2worker共30，另给受控迁移/监控5及至少20管理保留；以实例连接上限/压测重新核算，不为每个员工开连接，也不设置无限连接。[官方连接池说明](https://node-postgres.com/features/pooling)。

连接获取超时初拟3秒，事务statement5秒/锁1秒/idle事务10秒，后台导入专用角色另设批量窗口；这些为待验证起点。等待外部API必须释放DB事务/连接。先用应用Pool；只有连接数和并发测量证明必要时再评审PgBouncer，transaction pooling与SET LOCAL、prepared语句、连接上下文兼容必须单独验证。

数据库连接TLS校验CA及主机名；禁止rejectUnauthorized=false或只加密不验证身份。libpq场景使用verify-full等价策略，Node使用对应CA与主机校验；两者配置不能机械混用。[PostgreSQL SSL说明](https://www.postgresql.org/docs/18/libpq-ssl.html)。服务端只允许应用所在受控网络，私网PG连接不放宽H04模型HTTP的私网禁令。

## Schema Migration工具

建议node-pg-migrate承载有序、审签的schema版本和SQL迁移；SQL草案将来拆成可测试migration，仓库Review后由独立runner执行。[官方项目文档](https://salsita.github.io/node-pg-migrate/)。未来在Phase3A-2授权后审查并锁定pg/工具版本、Node engines、许可证、lockfile与依赖安全；当前package仍零依赖，不安装任何包。

采用expand→backfill/校验→validate→contract步骤；破坏性drop/rename不与首次切换捆绑。普通建表变更按工具支持事务运行；不能放事务的CREATE INDEX CONCURRENTLY等单列步骤及失败清理，不把整个迁移标成已回滚而留下未知状态。幂等迁移按版本/校验摘要，不用大量IF NOT EXISTS掩盖不符合预期的旧结构。schema8是源数据协议，PG schema迁移版本另设，不擅自把应用版本或API升到0.1.7。

## 备份、PITR与恢复

建议生产每日受控基础备份+连续WAL归档/PITR，逻辑pg_dump用于可移植逻辑副本及专项核对。PITR必须有一致基础备份和完整WAL链，单纯pg_dump不能提供物理WAL回放；依据[PostgreSQL PITR文档](https://www.postgresql.org/docs/18/continuous-archiving.html)。恢复演练验证目标时刻、权限/RLS、账本、素材清单和外部作业不重复，不能只看backup命令exit0。

初拟RPO≤5分钟、RTO≤60分钟为业务审批目标，不是已达到指标；需托管服务承诺/预算、WAL间隔、数据量与实际恢复计时确认。文件/对象存储版本、配置与密钥也要同点保护，PG PITR不恢复磁盘媒体和外部供应商副作用。恢复后作业HOLD，先重查远端已执行事实，避免重复计费/入库/发布。

备份加密、访问审计、异地/独立故障域副本、恢复账户与密钥轮换单独管理；至少月度隔离恢复演练、重大migration前后加做。旧AESGCM+DPAPI备份仅证明同Windows账户恢复，不能当作PG跨机灾备；需要独立可恢复密钥托管方案，未经授权不改当前密钥。

## 密钥与数据保护

DSN密码/主密钥通过部署环境安全注入或受控secret manager引用，不写Git、不出现在migration命令行/日志或报告。Provider保留现有sealed密文/secret_ref，密钥在应用或专用密钥系统中，不能把解密主密钥与密文同行存PG。迁移密文是否可跨环境解开需授权后在安全环境校验，不在本轮操作真实密钥。TLS保护传输；磁盘/备份加密由托管KMS或主机磁盘加密实现，不能声称普通PG数据文件天然已加密。

日志记录SQL模板/耗时/关联ID/错误码，不记参数、Authorization、票据、prompt正文或数据库连接密码；慢SQL监控需在具体版本验证关闭参数记录的设置。审计metadata延续现有sanitize，并区分业务审计与DB运维审计，DB查询日志不能替代专业/发布审核事实。

## 监控、保留与扩容

监控连接池等待/耗尽、DB连接数、查询P95、长事务、锁等待/死锁、40001/断连提交未知、磁盘/WAL增长、WAL归档延迟、备份时效/恢复可用性、vacuum/dead tuples、索引命中及副本延迟；业务告警包括预算UNKNOWN、Outbox最老年龄/重试死信、失效游标落后、缺文件/孤儿及批准hash不一致。阈值在容量演练确定，安全阻断必须可见，不能自动空库重启。

历史审计、审核、发布归档保留期由企业资料治理和业务责任人批准；本阶段不设置自动删除。旧provider_calls/ingest/audit的展示上限仍可LIMIT分页，但不再用数组splice作为PG物理清理。会话/票据过期、Outbox已完成、临时上传清理均先制定保留/审计规则，提供dry-run清单，孤儿素材必须人工授权后才删除。

先建与访问路径匹配的B-tree/FK索引，不给每个JSONB无差别GIN；根据真实EXPLAIN与体积去重索引。草案FK索引和业务索引存在可合并空间，下一阶段评审再收敛。日志/审计量达到必要规模时再按时间分区，评估唯一键/外键/分区维护；读副本只用于容忍延迟分析，当前授权、批准与预算必须主库读取。先纵向扩容和查询优化，不为未测量的容量引入分片/多主。
