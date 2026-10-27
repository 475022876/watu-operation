# schema8集合与PostgreSQL映射

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

settings/seq及临时字段规则见PG01；关系表/字段类型与外键见PG02和SQL。所有映射为计划，未执行导入。
