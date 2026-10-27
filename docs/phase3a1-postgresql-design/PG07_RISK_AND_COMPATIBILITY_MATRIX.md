# PG07 风险及API兼容性矩阵

设计日期：2026-10-27。唯一分析基线：`7f05078614a789b94a040f67b18e462f2284f063`，分支 `baseline/consolidation-phase2`，仓库 `475022876/watu-operation`。开始时HEAD、origin远程分支及干净工作树一致。应用0.1.6、mosSchemaVersion=8保持不变。

本轮是 **Phase 3A-1设计**：没有导入应用store、启动业务服务、读取生产JSON内容、安装依赖/PostgreSQL、执行SQL、迁移数据或修改任何业务源码。Phase 2的990项记录是既有隔离证据，本轮只核对源码及证据，不将其说成PostgreSQL测试通过。SQL是待评审草案，未在数据库解析或执行；本轮静态检查不能代替下一阶段迁移/约束/RLS验收。

|编号/级别|风险|当前证据/未知|兼容与处置方案|验收/批准门禁|
|---|---|---|---|---|
|R01|High / 阻断|同步全局getDb和可变数组与PG异步事务结构冲突|30个直接消费者/155直接端点仅为静态下界|域Repository+显式UoW+DTO codec；禁止全库JSONB/Promise伪装store|PG版全路由与故障回归；0业务源码改动发生于本轮|
|R02|High / 阻断|H05版本引用遍历字段不一致|routes/content.js用contentTaskId；workspace-ai-policy.js按v.taskId，静态可见|先用真实版本构造负例验证漏查，单独授权修复，FK映射严格content_task_id|任务仅经版本素材引用受限资料时仍阻断外发；本轮未复现运行攻击/未修复|
|R03|High / 阻断|无品牌/多态/外部ID，机械一对一会扩权或断引用|source_evidence无brand，报告brandScope、plan_items从父级推导、libraryId外部ID|报告证据授权边+复合品牌FK+排他审核主体CHECK；未知归属隔离|跨品牌/未知归属/全局撤权负例；0无解释孤儿|
|R04|High / 阻断|预算口径/历史账本不足|31天汇总与自然月/UTC实现并存；provider_calls滚动2000|先人工决定期间/币种/期初/UNKNOWN策略，再事务预留与去重结算|预算责任人签署期初核对；不虚造费用或把NULL置0|
|R05|High / 阻断|冻结hash/JSONB序列化/历史批准不一致|manifest使用JS stableStringify，SQL jsonb文本不等价|保留原canonical/hash；冻结文件版本；审批case绑定准确主体/hash|旧批准指纹100%核对；无法重建者不能自动批准|
|R06|High / 阻断|时间类型/API数值变化|无偏移plannedAt/actualAt，排期另有timezone；pg numeric/bigint输出可为字符串|显式DTO/时区/精度codec；不依部署机器时区推断|DST/日期级/epoch/null/大数/六位小数golden测试|
|R07|High / 阻断|不可重复外部操作及跨存储非原子|准入多步推送、模型计费、文件落盘与PG分离|Outbox/Inbox、稳定幂等、租约fencing、UNKNOWN对账；不宣称exactly-once|超时/429/远端成功本地失败/重复回执/租约过期负例|
|R08|High / 阻断|RLS信任来源、全局表、bootstrap及权限漂移|共享DB角色可SET GUC，global auth需读取受限字段|服务端验证session，参数化SQL，非owner/NOBYPASSRLS；guard限定函数；RBAC仍动作权威|空ctx/伪actor/连接池复用/角色撤销/全局审计读取负例|
|R09|High / 阻断|PG首写后回旧JSON丢失数据|新预算预留/Outbox状态不完全可表达为schema8|停写全量切换；首写后优先PG修复，回JSON需逆向验证且无UNKNOWN在途|含新PG写和外部副作用的恢复演练，而非只git checkout|
|R10|High / 阻断|素材缺失、可变文件与PITR不同时点|objectKey和published物理副本；PG不备份文件|file_object/version、READY门禁、hash清单、隔离孤儿、同点备份|冻结/发布引用均有对应字节与SHA；不自动删除旧素材|
|R11|Medium→High / 未知|生产容量/孤儿/非法UTF8/NUL/坏日期/重复键|本轮未读生产记录，不能给通过结论|授权快照profiling，字段完全分类，拒绝清单，禁止静默清洗|关键未解决拒绝数0；74表映射重跑确定|
|R12|High / 阻断|恢复密钥和基础设施选择未完成|旧备份DPAPI同用户；PG未部署|托管KMS/独立恢复责任+PITR/文件演练；密钥只引用|RPO/RTO实测达标、异机或独立故障域恢复可用|
|R13|Medium / 阻断执行|SQL草案未经过数据库验证|本轮只文本构造/静态检查，不安装PG|Phase3A-2补全append-only/冻结触发器、全局GRANT/策略、证据写入函数并在隔离PG执行|真实建表/外键/状态/鉴权/回滚测试后才形成可执行migration|
|R14|Medium|过度JSONB/索引与保留治理|legacy_extra易变成隐形整行存储，FK索引可能重复|字段schema登记；JSONB仅有界文档；基于EXPLAIN合并索引；清理有批准|无未知字段静默落extras、无预算/关系藏JSONB、旧审计不丢|
|R15|High / 未验证|真实Workspace/模型供应商能力|Phase2真实外部服务/生产未验收|继续保持H04/H05拒绝策略，另行授权最低预算/测试账户验证|缺元数据/撤权/未知密级仍拒绝，不修改正式契约绕过|

## 外部契约修改数量

计划修改现有业务API契约0项、双系统正式契约0项。这里“0”是约束目标，不是已经做过PG响应差异测试。当前仅静态识别155个直接字面量路由；下一阶段要补动态注册、错误路径和间接调用者清单，再逐个golden对照。内部路由服务需要await Repository并改变事务边界，数量远大于0。

必须保持：API仍用camelCase、原ID/业务号、number/null及空/缺省语义、三条审核链和既有状态/错误码；`contentTaskId`是存储/返回字段，创建请求的`taskId`不能据此全局改名；时间原格式、数组原序、MOCK标记和成本confirmed事实也保持。

|兼容点|原语义/结构|新内部实现|不允许的捷径|
|---|---|---|---|
|多品牌角色|brandScope含*；当前用户有效权限|grant/scope表+epoch+RBAC+RLS|将*当新品牌或只靠RLS代替专业审批权限|
|内容版本|contentTaskId、number、rowVersion、manifestHash|content_task_id、CAS、固定文件版本|将所有taskId统一替换，重算hash让旧批准继续生效|
|审核|case.type/subjectType/subjectId/versionHash/policyVersion|强类型FK、snapshot及append-only决策|一个approved布尔代替三条链；迁移即批量批准|
|准入|finalApprovalStatus/syncStatus/approvalMode独立|本地短事务+远端幂等作业|本地入库记录即视为Workspace正式批准|
|预算/账本|unknown/null与0、confirmed/estimated有别|numeric列+预留/未知占额+账本|JSONB塞整个账本或根据估价造真实支出|
|时间/指标|timezone与原时间字符串；metric/amount/sourceKind/asOf逐行|date/timestamptz/原串codec、标量指标|丢时区、丢精度、把number全改字符串或改成新metrics对象|
|文件/归档|working objectKey、独立published副本|storage ref+不可变file version|搬/删素材、归档变可变原图链接、base64入JSONB|
|全局安全状态|无brand的撤权/探针/审计|显式全局策略和限定通道|默认补PUBLIC/VFIB或授予所有普通用户全局读取|
|同步接口|当前同步返回/超时行为|等待事务外作业、原结构返回|未审批就新加202/新枚举/新必填字段|
|存储失败|H06 Fail Closed；H03成功须持久|PG提交/幂等确认，不自动fallback|PG故障自动使用旧JSON形成两套权威|

## SQL草案限制的明确说明

SQL包含74张typed表、外键/唯一/状态约束及RLS示例，但没有声称所有生产触发器和角色GRANT均已实现。特别是：追加/冻结保护、资产准入subject快照、global/nullable-brand策略、源证据受限写入、真实用户会话bootstrap和文件READY联动要在获授权的Phase3A-2补齐；当前默认无运行GRANT，不能通过放宽权限把草案“跑通”。

未来测试必须在真实隔离PostgreSQL证明这些条件，当前静态计数/字段匹配检查只能发现文本级遗漏。数据库migration工具元数据表不计入74张业务/支撑表；若补充方案需要新增业务表，先更新目录、DDL、映射和计数并审阅，而不是悄悄改变范围。

## 本轮停止点

仅设计文件与文档生成/静态校验资料发生变化；业务源码、生产数据/配置/密钥、历史JSON、应用版本、Enterprise Workspace和正式双系统契约均保留。尚未形成生产迁移批准，也未进入Phase3A-2；人工审阅PG06列出的决策后才能授权下一步。
