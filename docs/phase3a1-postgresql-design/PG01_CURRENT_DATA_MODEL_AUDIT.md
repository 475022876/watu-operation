# PG01 当前schema8数据模型审计

设计日期：2026-10-27。唯一分析基线：`7f05078614a789b94a040f67b18e462f2284f063`，分支 `baseline/consolidation-phase2`，仓库 `475022876/watu-operation`。开始时HEAD、origin远程分支及干净工作树一致。应用0.1.6、mosSchemaVersion=8保持不变。

本轮是 **Phase 3A-1设计**：没有导入应用store、启动业务服务、读取生产JSON内容、安装依赖/PostgreSQL、执行SQL、迁移数据或修改任何业务源码。Phase 2的990项记录是既有隔离证据，本轮只核对源码及证据，不将其说成PostgreSQL测试通过。SQL是待评审草案，未在数据库解析或执行；本轮静态检查不能代替下一阶段迁移/约束/RLS验收。

## 结论与计数

`lib/mos/store.js`的BASE_SHAPE精确包含 **43个数组集合**，包括品牌/身份/会话与业务/审计；另有`settings`、`seq`两个持久化对象，共45个数据分组。`mosSchemaVersion`是元数据，`_initialPasswordOnce`为初始化临时字段，不计业务集合，不迁移该临时明文。不能把43说成生产实库已有43个非空集合：本轮未读取生产数据，实库行数、容量、孤儿和重复率均为Unknown。

30个MOS模块直接require store；路由目录静态识别155条直接字面量注册（GET71、POST65、PUT15、DEL4，不包括动态/其他注册方式）。这说明需内部异步Repository改造，不能只更换一条数据库连接。清单见SOURCE_ANALYSIS.json。

## 43集合完整映射

|JSON集合|目标主表|品牌隔离|拆分/迁移特别规则|
|---|---|---|---|
|brands|brands|全局身份/受控配置|PK取code；保持VFIB/UCARD，不推断其他品牌授权|
|users|users|全局身份/受控配置|lower(username)唯一；密码散列/盐原样保留，明文和真实值不进入设计包|
|user_roles|user_role_grants|全局身份/受控配置|brandScope拆到role_brand_scopes；*映射all_brands而非伪造*品牌|
|sessions|auth_sessions|全局身份/受控配置|历史会话仅留原加密快照，目标会话表初始为空，切换重新登录，须人工批准|
|monthly_plans|monthly_plans|brand_code + 复合FK|保留原ID、业务编码、状态及可验证时间；标量与文档字段见SQL/字段目录|
|plan_items|plan_items|brand_code + 复合FK|原行无brandCode，须从plan推导并与任务品牌一致|
|campaigns|campaigns|brand_code + 复合FK|Brief保留版本化结构快照，LIBRARY引用投影到campaign_library_refs|
|monthly_campaign_links|monthly_campaign_links|brand_code + 复合FK|无id行用集合+稳定自然键生成迁移ID，DTO不新增id字段|
|master_topics|master_topics|brand_code + 复合FK|保留原ID、业务编码、状态及可验证时间；标量与文档字段见SQL/字段目录|
|campaign_topic_links|campaign_topic_links|brand_code + 复合FK|保留原ID、业务编码、状态及可验证时间；标量与文档字段见SQL/字段目录|
|content_tasks|content_tasks|brand_code + 复合FK|保留原ID、业务编码、状态及可验证时间；标量与文档字段见SQL/字段目录|
|source_registry|source_registry|brand_code + 复合FK|域名相同不当然重复，不添加未经验证的domain唯一约束|
|source_items|source_items|brand_code + 复合FK|URL和摘要原字节语义保留；URL以sha256辅助定位并比对原URL，避免超长URL的B-tree键大小风险；去重规则核对后才升级唯一键|
|evidence_references|evidence_references|brand_code + 复合FK|从topic/version/sourceItem推导品牌，全部已知父级必须一致|
|skill_versions|skill_versions|brand_code + 复合FK|保留原ID、业务编码、状态及可验证时间；标量与文档字段见SQL/字段目录|
|creative_templates|creative_templates|brand_code + 复合FK|生成记录templateVersionId的id@vN须解析并核对，不把它直接当FK|
|content_versions|content_versions|brand_code + 复合FK|真正字段contentTaskId；不可用taskId映射；冻结正文、清单和素材版本须不可覆盖|
|review_cases|review_cases|brand_code + 复合FK|三种审核类型保留；多态subject必须通过排他CHECK和强类型FK约束|
|review_decisions|review_decisions|brand_code + 复合FK|追加记录；主体与hash必须与所属case一致，历史actor缺失只保留actor_ref，不造账号|
|working_assets|working_assets|brand_code + 复合FK|projectRef拆三条FK；正文二进制不进JSONB；校验objectKey/哈希后关联file_versions|
|generation_jobs|generation_jobs|brand_code + 复合FK|outputAssetIds拆表；referenceIds语义需逐项分类，不把任意字符串当素材FK|
|video_artifacts|video_artifacts|brand_code + 复合FK|分镜拆行，关键帧拆关系；脚本字幕可保持有界有序文档|
|channels|channels|brand_code + 复合FK|仍仅官方账号元数据，不引入社媒Token|
|publishing_schedules|publishing_schedules|brand_code + 复合FK|原行含timezone（默认Asia/Shanghai），先按每行有效IANA区解析；缺失/歧义/无效时停入隔离，不从部署机器时区推断|
|publication_records|publication_records|brand_code + 复合FK|每排期是否仅一条正式回执，先核实历史，SQL草案不擅加唯一并丢弃重复|
|published_artifacts|published_artifacts|brand_code + 复合FK|保留独立不可变归档文件；不得改成对可变工作素材的快捷链接|
|publication_corrections|publication_corrections|brand_code + 复合FK|追加式更正；不改旧发布快照|
|publication_metrics|publication_metrics|brand_code + 复合FK|当前是一行一个metric/amount/asOf/sourceKind，保持标量；仅未来平台扩展用JSONB，不能改API形状|
|asset_admissions|asset_admissions|brand_code + 复合FK|最终批准、同步和可复用三个维度不合并；历史字段版本admissionFieldsSchema保留兼容余项|
|library_asset_refs|library_asset_refs|brand_code + 复合FK|外部libraryId不是MOS主键；不以数据库缓存代替Workspace权威|
|ingest_jobs|ingest_jobs|brand_code + 复合FK|有效dedupeKey局部唯一需核对重试是否复用同键，不能直接锁死历史重试|
|research_reports|research_reports|brand_code + 复合FK|brandScope[0]为现有可访问品牌；有序完整scope子表不自动扩权|
|research_findings|research_findings|brand_code + 复合FK|evidenceIds拆关系；FACT无有效证据不得升级VERIFIED|
|source_evidence|source_evidence|报告关系授权，禁止全局开放|原对象无品牌且可被多报告引用，单份对象保留全局id；访问必须经report_evidence的已授权报告，不能作为公开全局表|
|topic_proposals|topic_proposals|brand_code + 复合FK|sourceFindingIds拆表；dispatch快照保留用于精确幂等重放|
|research_jobs|research_jobs|brand_code + 复合FK|保留原ID、业务编码、状态及可验证时间；标量与文档字段见SQL/字段目录|
|provider_calls|provider_calls|品牌或明确全局记录|NULL费用与0严格区分；管理探针允许全局brandNULL，仅管理员可见；追加事实，不凭估价记实付|
|video_render_jobs|video_render_jobs|brand_code + 复合FK|保留原ID、业务编码、状态及可验证时间；标量与文档字段见SQL/字段目录|
|library_tickets|library_ticket_cache|brand_code + 复合FK|源集合只有票据元数据；真实ticket在进程Map，不新增明文ticket列；迁移后过期/重新换取|
|library_event_cursors|library_event_cursors|brand_code + 复合FK|brandId转brand_code；processedSeqs投影到inbox元数据，不凭空重放外部事件|
|library_invalidations|library_invalidations|品牌或明确全局记录|旧key仅kind+targetId且可无brand；缺品牌保守全局失效，不能静默缩小撤权范围|
|library_admission_jobs|library_admission_jobs|brand_code + 复合FK|同一准入申请稳定远程幂等键及多步回执，禁止重新生成键后盲重试|
|audit_events|audit_events|品牌或明确全局记录|原timestamp保留，所有现存事件逐条迁移；不伪造已被旧20000条上限淘汰的历史|

## settings、seq及源形状补充

- settings.providers → provider_configs：kind/mode/baseUrl/model/timeout/retry及选项；原sealed密文与密钥引用在后续授权迁移中处理，设计包无真实值。env > 管理配置 > config文件的优先级保留。
- settings.providerBudget → provider_budget_policies；预算实际使用与预留 → budget_periods/budget_reservations；不把账本塞回settings。settings.egressPolicy为白名单版本化system_settings配置，须保持H04/H05安全约束。
- providerTestAt落provider_configs.last_test_at；字典核验/调度enabled等有界设置落system_settings；进程锁和心跳不按历史锁状态复活，改数据库租约。未知settings键必须列入迁移发现报告，人工决定后保留，不默认忽略。
- seq每个key落code_counters，校验现存业务编号下界；保留全局任务号和品牌Campaign号原有作用域，不改为每品牌任务号。序号回滚产生空号可接受，重用既有号不可接受。
- 用户prefs适合JSONB；角色brandScope拆出scope关系；sessions源中存token，目标只存digest且切换需重新登录。library_tickets源本来只存元数据，真正票据在workspace-client的进程Map；不设计持久化明文ticket。

## 源码证据及结构性冲突

|证据|现状|迁移含义|
|---|---|---|
|store.js:386、446、451、461|同步getDb+数组原地修改，save防抖，atomicMutation仅同步且特定路径|不能用Promise替代getDb而不改调用方；不能在PG中保存整库JSONB|
|ids.js uid/nextSeq/stableStringify|ID是前缀+base36时间+随机串，非标准UUID|所有历史业务ID用text保持；全局业务计数器显式更新；不强制转换UUID|
|routes/content.js:170及manifest.js|内容行contentTaskId、冻结manifest含素材哈希/渠道/语言|DB content_task_id，DTO仍contentTaskId；不把请求body.taskId误当存储字段|
|workspace-ai-policy.js:31附近|按v.taskId查版本，实际内容行为contentTaskId|新增静态发现H05引用覆盖疑点，高优先级阻断实施验收；未在本轮执行利用/负例，也未修复|
|research-engine.js:159、488及routes/research.js:90|报告brandScope；source_evidence没有brand，关系由发现/报告数组承接|源证据必须经报告关系授权，禁止随意补PUBLIC或默认VFIB|
|routes/publishing.js:157、375|plannedAt/actualAt无偏移原串；排期另有timezone默认Asia/Shanghai；实际发布时间缺独立区|保留原串+精度+有效区；优先使用原timezone，实际时间继承规则需人工确认|
|routes/publishing.js:568|指标是metric/amount/sourceKind/asOf逐行标量|保持此模型，不能改成仅一个metrics JSONB对象使API改变|
|provideradmin.js budget/monthSpend 与research-engine.js brandMonthSpend|有31天汇总与自然月/UTC口径差异，且账本滚动2000条|预算起算点与历史缺口须决策，不能以旧有限账本声称已恢复全部费用|
|audit.js:60、ingest.js、providerlog.js|审计20000、采集500、Provider2000滚动上限|只迁移可得历史，保留截断事实，不补造早期事件|

## 事实、未知和下一步

已证实：源集合定义、关键构造字段、关系、文件路径语义、Phase2防护代码及既有测试证据存在。未知：生产逐行数据质量、容量、媒体可读性、冻结hash一致性、真实Workspace元数据及外部API能力。下一阶段获授权后必须先对一致性只读快照做实数profiling；发现问题进入拒绝清单，不能静默改数据解决约束冲突。
