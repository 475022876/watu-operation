# PG04 确定性迁移、核对与回滚计划

设计日期：2026-10-27。唯一分析基线：`7f05078614a789b94a040f67b18e462f2284f063`，分支 `baseline/consolidation-phase2`，仓库 `475022876/watu-operation`。开始时HEAD、origin远程分支及干净工作树一致。应用0.1.6、mosSchemaVersion=8保持不变。

本轮是 **Phase 3A-1设计**：没有导入应用store、启动业务服务、读取生产JSON内容、安装依赖/PostgreSQL、执行SQL、迁移数据或修改任何业务源码。Phase 2的990项记录是既有隔离证据，本轮只核对源码及证据，不将其说成PostgreSQL测试通过。SQL是待评审草案，未在数据库解析或执行；本轮静态检查不能代替下一阶段迁移/约束/RLS验收。

## 方案选择

建议分批实现、使用隔离环境反复迁移演练；生产以一次停写窗口切换一个权威存储。现阶段不推荐按集合分别让JSON和PG同时生产写入：审核、版本、任务、文件与预算存在跨集合事务，混存会延续TX风险。**不采用生产双写**。源JSON保留只读、可追溯和历史恢复用途，不继续发展为生产存储。

JSON源无可靠变更日志/CDC、无统一updatedAt或删除墓碑，不能声称比较几个时间戳即可得到最终增量。优先停写后重新导入完整最终快照；初次演练若证明体积太大，再单独设计按完整记录hash比较的新增/更新/删除清单并验证，不先引入未经验证的双写。

## 十步迁移流程与验收闸门

|步骤|计划操作（本轮均不执行）|验收条件/失败处理|
|---|---|---|
|1 只读源快照|停止所有JSON写者/调度/worker，确认文件写入结束；同点保护mos.json、配置、密钥引用、uploads/published；加密、逐文件hash、写者fencing|前后摘要一致；备份认证解密/恢复条件验证；变化即重做，不开始迁移|
|2 结构/引用profiling|严格解析schema8；43数组+2对象；主键、时间、枚举、品牌推导、refs、hash、文件/权限验证|行数与字段登记完整，0未解释数据缺陷；问题只写脱敏拒绝清单，源文件不修|
|3 建表/约束初始化|在专用空PG测试库执行经批准的migration，owner与运行账号分离，RLS先拒绝，外发关闭|所有PK/FK/唯一/状态/冻结约束和权限负例通过；当前草案不能直接执行|
|4 确定性映射|用锁定tool commit+mapping_version导入staging→typed表/子表；保留外部ID、原业务编号、状态/rowVersion、数组ordinal|同一snapshot SHA+版本重跑得到相同逻辑结果；冲突不靠ON CONFLICT DO NOTHING掩盖|
|5 隔离迁移演练|只用授权副本/合成数据，Provider和Workspace真实出站关闭，所有job保持HOLD|演练环境不连生产账号/社媒；不因导入QUEUED/RUNNING而自动重发|
|6 前后核对|逐集合/品牌/状态统计、金额NULL/0/确认状态、canonical DTO摘要、引用图、文件SHA、批准hash、历史审计|核心不变量100%，每条源记录有目标映射或明确批准的安全归档处理；无静默缺失|
|7 业务回归|17原套件、Phase1/2专项在PG隔离实现上运行；两后端DTO golden对比|此前880+57+53是旧后端证据，PG必须重新取得证据；0新增失败|
|8 并发/故障注入|双进程编辑/审核/最后预算、worker租约、断连提交、磁盘/主库故障、回执重复/乱序、文件崩溃点|见PG03 TX逐项负例，RLS池上下文泄漏0，未知外部结果不盲重放|
|9 停写及最终切换|公告维护窗口，禁写/禁外发/禁worker；最终快照完整导入并对账；PG只读抽验；人工批准才开放PG写入|记录最终JSON摘要与PG迁移run；所有旧写者停且fenced；无两边同时写，失败保持维护|
|10 回滚与恢复|按首次PG业务提交前/后分别处理；文件/密钥/配置同点验证|不能用旧JSON丢弃新PG交易；未满足逆向验证条件只允许PG内修复/恢复，继续停写|

## 确定性映射规则

- 保留43集合原业务ID字符串；没有id的关系按集合名+稳定自然键生成sha256迁移ID；没有自然键的历史明细按snapshot SHA+集合+原ordinal生成。派生id只供内部使用，不加入旧DTO。快照不同则有独立run，不把不同快照记录无条件混写。
- UTC ISO、有效日期和毫秒epoch显式解析；publication plannedAt用原timezone，actualAt是否继承schedule区须批准；日期级精度不造00:00精确时刻；非法日期、DST歧义、无区/无父级入拒绝清单，保留原串。
- source_evidence无品牌通过报告finding/evidenceIds/sources构建授权边，非空/空引用都核对；evidence_references/plan_items/link从父级推导品牌。跨品牌不一致、无父级、unknown品牌不能默认VFIB/全局开放。
- user_roles保留grant ID、scope顺序/内容，*保留通配语义；source状态、三条审核链、准入finalApprovalStatus/syncStatus/approvalMode各自不变。MOCK引用不转REAL、不变permissionValid=true。
- `generation_jobs.templateVersionId = template.id + '@v' + version`须解析到正确模板版本并保留原串；字段`contentTaskId`、`taskId`、`projectRef.taskId`、`brandScope`、`brandId`逐域映射，禁止全局同名替换。
- refAssetIds/channelIds/evidenceRefIds/sourceFindingIds/outputAssetIds/keyframeAssetIds/history/storyboard保持有序关系。已有反向缓存数组与正向FK不一致时以事实审阅决议为准，不能择一悄悄丢弃。
- null、缺省、空字符串、false、0、未知费用的语义需codec保留。IP无效历史值保留ip_raw，不强制所有审计字符串转inet。文本NUL/不合法UTF8、数值越界、原JSON非法或未来schema默认阻断，不能靠去字符/四舍五入通过。
- manifest和文件SHA按原算法验证；jsonb格式化不参与批准摘要。原canonical文本存在则原样保留；无原文且重算不一致的历史批准不能自动重签。
- 用户salt/hash保留，禁止重置/重新散列已有密码；sessions切换失效，ticket元数据过期后以现有真实用户映射换取，需人工批准会话重登策略。真实票据没有落在旧集合，不应虚构导入。
- 迁移Provider密文要检查原密钥引用可恢复；不能在本轮读取/解密实际配置，也不能默认换机器后DPAPI可用。演示/测试标记与原审计/入库资格原样保留。
- 审计/Provider/采集滚动截断的历史无法凭空找回；迁移报告写明覆盖时间与数量。预算期初确认账单、UNKNOWN占额与自然月口径未定不能开放计费任务。

## 对账口径

每条源数组记录记录source collection/key/ordinal/hash→目标PK/子关系映射；目标按旧DTO重建并用源端同一canonical codec比较。关系拆分后不能要求所有表行数等于集合行数；应分别比较主记录、边数、关系顺序和缺省值。安全缓存的批准失效处理单列`source = migrated_active + archived_ephemeral + quarantined`，所有差异有原因/批准人；关键业务记录未解决quarantined数量必须为0才能正式切换。

金额对账按品牌/期间/币种/confirmed和unknown分组，用Decimal读原数值词元并按原API小数政策校验，不能直接累加JS浮点后当财务精确值。权限按每用户品牌实际permission集合比对，不能只比角色数量。文件核对逻辑引用→objectKey/storage version→字节数/SHA256，并核对每个冻结/发布快照。

## 两种回滚情形

**PG尚未开放写入或任何业务写提交前**：停止PG候选，保持worker/外发关闭；确认原JSON停写点、配置/素材/密钥配套且健康，按批准步骤恢复原Phase2代码与原数据。Phase2 H06必须保留，不能回到会自动播种的第一阶段加载器。仅代码配置切回也先确认没有PG副作用。

**PG已有写入/外部副作用后**：旧JSON已过期，禁止直接切回。优先PG内前滚修复；若确需回JSON，需另行授权、停止所有PG写者和worker，对PG一致性快照做已经验证的schema8逆向export，包含所有新增业务、配置、素材和审批事实，与外部回执对账。新Outbox/UNKNOWN预算/撤权游标/租约无法无损表达于schema8时，须确认已完成/对账并可安全等价表示，否则回JSON不可行，继续维护并修复PG。

PITR恢复也可能回退到已发生外部请求之前，故恢复后先HOLD作业并重查供应商/Workspace已接受事实，不能直接重新发送。原只读JSON保留作历史证据，不作为PG运行时自动兜底或未来生产发展线。

## 双写比较与窗口估算

停写切换有明确单写权威和简单核对，代价为维护窗口；源JSON没有变更日志，双写方案目前不满足一致性/删除/重放保证。若未来提出双写，必须先有单一提交日志、事务Outbox、逐事件序号/幂等、权威冲突规则、双端对账和回放恢复，并独立比较复杂度，不能在本轮默认采用。

维护窗口时长未知：须测量最终全量导入、约束验证、文件清单核对和抽验耗时，预留至少测得P95的2倍作为规划起点，由业务批准窗口；本轮没有生产体积/带宽/IOPS测量，不能承诺分钟级零停机。
