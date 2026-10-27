from pathlib import Path
import re,json,hashlib,subprocess,collections
ROOT=Path.cwd();OUT=ROOT/'docs/phase3a1-postgresql-design';OUT.mkdir(exist_ok=True)
BASE='7f05078614a789b94a040f67b18e462f2284f063'
assert subprocess.run(['git','merge-base','--is-ancestor',BASE,'HEAD']).returncode==0
assert subprocess.run(['git','diff','--quiet',BASE,'--','.',':!docs/phase3a1-postgresql-design']).returncode==0
# Design-only generation: no store module, application, SQL client or database is executed.
tables=[]
def table(name,cols,source=None,scope='brand',group='core',unique=(),note='',indexes=()):
 tables.append(dict(name=name,columns=cols,source=source,scope=scope,group=group,unique=list(unique),note=note,indexes=list(indexes)))
# Each line is a typed relational projection; bounded document columns are deliberately named by purpose.
table('brands','code text PRIMARY KEY|name text NOT NULL|legacy_id text', 'brands','global',note='PK取code；保持VFIB/UCARD，不推断其他品牌授权')
table('users','username text NOT NULL|display_name text|status text NOT NULL|external_identity_id text|identity_source text|dept text|title text|password_hash text|password_salt text|must_change_password boolean|authz_epoch bigint NOT NULL DEFAULT 1|prefs jsonb NOT NULL DEFAULT \'{}\'::jsonb|last_login_at timestamptz|password_changed_at timestamptz','users','global',note='lower(username)唯一；密码散列/盐原样保留，明文和真实值不进入设计包')
table('user_role_grants','user_id text NOT NULL|role_code text NOT NULL|all_brands boolean NOT NULL DEFAULT false|granted_at timestamptz|revoked_at timestamptz|valid_until timestamptz','user_roles','global',note='brandScope拆到role_brand_scopes；*映射all_brands而非伪造*品牌')
table('auth_sessions','user_id text NOT NULL|token_digest text NOT NULL|expires_at timestamptz NOT NULL|last_seen_at timestamptz|ip inet|user_agent text|revoked_at timestamptz','sessions','global',unique=['token_digest'],note='历史会话仅留原加密快照，目标会话表初始为空，切换重新登录，须人工批准')
table('monthly_plans','year integer NOT NULL CHECK (year BETWEEN 2020 AND 2100)|month integer NOT NULL CHECK (month BETWEEN 1 AND 12)|version integer NOT NULL CHECK (version > 0)|code text NOT NULL|title text NOT NULL|owner_id text|supersedes_id text|status text NOT NULL|objectives jsonb|review_note text|approved_at timestamptz|approved_by_ref text','monthly_plans',unique=['brand_code,year,month,version','brand_code,code'])
table('plan_items','plan_id text NOT NULL|content_task_id text|title text NOT NULL|priority text|work_date date NOT NULL|ad_hoc boolean','plan_items',note='原行无brandCode，须从plan推导并与任务品牌一致',indexes=['brand_code,work_date'])
table('campaigns','code text NOT NULL|title text NOT NULL|brief text|owner_id text|start_at timestamptz|end_at timestamptz|state text NOT NULL|marketing_brief jsonb','campaigns',unique=['brand_code,code'],note='Brief保留版本化结构快照，LIBRARY引用投影到campaign_library_refs')
table('monthly_campaign_links','plan_id text NOT NULL|campaign_id text NOT NULL','monthly_campaign_links',unique=['brand_code,plan_id,campaign_id'],note='无id行用集合+稳定自然键生成迁移ID，DTO不新增id字段')
table('master_topics','title text NOT NULL|pillar_code text|narrative_code text|risk_grade text|evidence_status text|summary text|owner_id text|state text NOT NULL','master_topics')
table('campaign_topic_links','campaign_id text NOT NULL|topic_id text NOT NULL','campaign_topic_links',unique=['brand_code,campaign_id,topic_id'])
table('content_tasks','code text NOT NULL|title text NOT NULL|type text|platform text|pillar_code text|narrative_code text|risk_grade text|owner_id text|campaign_id text|topic_id text|parent_task_id text|status text NOT NULL|production_due date|review_due date|planned_publish_at_raw text|planned_publish_at_utc timestamptz|business_basis jsonb|deliverables jsonb','content_tasks',unique=['code'],indexes=['brand_code,owner_id,status','brand_code,production_due'])
table('source_registry','domain text NOT NULL|name text|tier text|method text|endpoint text|license_policy text|license_note text|allow_full_text boolean|retention_days integer|frequency text|retry_policy text|owner_id text|status text NOT NULL|last_ok_at timestamptz|next_run_at timestamptz|schedule_config jsonb','source_registry',indexes=['brand_code,status,next_run_at'],note='域名相同不当然重复，不添加未经验证的domain唯一约束')
table('source_items','source_id text NOT NULL|canonical_url text NOT NULL|title text|summary text|full_text text|content_digest text|license_state text|published_at timestamptz|published_at_raw text|fetched_at timestamptz|ai_summary text|ai_summary_state text|fetch_metadata jsonb','source_items',indexes=['brand_code,source_id,fetched_at','brand_code,canonical_url'],note='URL和摘要原字节语义保留；URL以sha256辅助定位并比对原URL，避免超长URL的B-tree键大小风险；去重规则核对后才升级唯一键')
table('evidence_references','source_item_id text|topic_id text|content_version_id text|claim_locator text|verification_state text NOT NULL','evidence_references',note='从topic/version/sourceItem推导品牌，全部已知父级必须一致')
table('skill_versions','skill_code text NOT NULL|version text NOT NULL|checksum text|approval_ref text|state text NOT NULL|activated_at timestamptz|note text','skill_versions',unique=['brand_code,skill_code,version'])
table('creative_templates','skill_version_id text|template_code text NOT NULL|version integer NOT NULL|platform text|mode text|display text|label text|state text NOT NULL|aspects text[]|config jsonb|note text','creative_templates',unique=['brand_code,template_code,version'],note='生成记录templateVersionId的id@vN须解析并核对，不把它直接当FK')
table('content_versions','content_task_id text NOT NULL|number integer NOT NULL CHECK (number > 0)|code text NOT NULL|title text|body text|format text|pillar_code text|narrative_code text|risk_grade text|locale text|state text NOT NULL|author_id text|supersedes_id text|superseded_by_id text|manifest_hash text|manifest_canonical_text text|manifest_payload jsonb|disclosures jsonb|approved_at timestamptz|approved_by_ref text|revise_reason text','content_versions',unique=['brand_code,content_task_id,number','code'],note='真正字段contentTaskId；不可用taskId映射；冻结正文、清单和素材版本须不可覆盖')
table('review_cases','type text NOT NULL|subject_type text NOT NULL|subject_id text NOT NULL|content_version_id text|asset_admission_id text|version_hash text NOT NULL|policy_version text NOT NULL|risk_grade text|state text NOT NULL|submitted_by text|submitted_at timestamptz|decided_by_ref text|decided_at timestamptz|requirements jsonb|note text','review_cases',indexes=['brand_code,state,type'],note='三种审核类型保留；多态subject必须通过排他CHECK和强类型FK约束')
table('review_decisions','case_id text NOT NULL|content_version_id text|asset_admission_id text|type text NOT NULL|version_hash text NOT NULL|actor_id text|actor_ref text|actor_name text|action text NOT NULL|previous_state text|acting_authority jsonb|remarks text','review_decisions',note='追加记录；主体与hash必须与所属case一致，历史actor缺失只保留actor_ref，不造账号')
table('working_assets','file_version_id text|file_name text|mime text|bytes bigint CHECK (bytes >= 0)|sha256 text|object_key_legacy text|owner_id text|task_id text|campaign_id text|topic_id text|generation_job_id text|origin text|license text|visibility text NOT NULL DEFAULT \'PRIVATE\'|mock boolean|prompt_snapshot jsonb','working_assets',note='projectRef拆三条FK；正文二进制不进JSONB；校验objectKey/哈希后关联file_versions')
table('generation_jobs','task_id text|kind text NOT NULL|data_class text NOT NULL|provider text|model_id text|skill_version_id text|template_id text|template_version_raw text|status text NOT NULL|provider_job_id text|prompt_snapshot jsonb|provider_usage jsonb|cost jsonb|qa_result jsonb|idempotency_key text|requested_by text|error_code text|error_message text|started_at timestamptz|finished_at timestamptz','generation_jobs',indexes=['brand_code,status,created_at'],note='outputAssetIds拆表；referenceIds语义需逐项分类，不把任意字符串当素材FK')
table('video_artifacts','task_id text NOT NULL|video_type text|motion_code text|brief text|script jsonb|subtitles jsonb|final_asset_id text|state text NOT NULL','video_artifacts',unique=['brand_code,task_id'],note='分镜拆行，关键帧拆关系；脚本字幕可保持有界有序文档')
table('channels','platform text NOT NULL|handle text|url text|label text|state text NOT NULL|publish_mode text|owner_id text|last_verified_at timestamptz','channels',note='仍仅官方账号元数据，不引入社媒Token')
table('publishing_schedules','content_version_id text NOT NULL|channel_id text NOT NULL|planned_at_raw text NOT NULL|planned_at_local timestamp|planned_at_utc timestamptz|time_zone text|time_precision text|state text NOT NULL|manifest_hash text|operator_id text','publishing_schedules',indexes=['brand_code,planned_at_utc,state'],note='历史无偏移时间不得擅自按UTC或上海时区解释；保留原字符串供API')
table('publication_records','schedule_id text NOT NULL|content_version_id text NOT NULL|channel_id text NOT NULL|actual_at_raw text|actual_at_local timestamp|actual_at_utc timestamptz|time_zone text|time_precision text|url text|operator_id text|evidence_ref text|status text NOT NULL|text_hash text|manifest_hash text|approved_at timestamptz|approved_by_ref text|notes text','publication_records',note='每排期是否仅一条正式回执，先核实历史，SQL草案不擅加唯一并丢弃重复')
table('published_artifacts','publication_id text NOT NULL|file_version_id text|kind text NOT NULL|object_key_legacy text|sha256 text|bytes bigint|mime text|file_name text|manifest_hash text|immutable boolean NOT NULL DEFAULT true|preserved_at timestamptz|snapshot_metadata jsonb','published_artifacts',note='保留独立不可变归档文件；不得改成对可变工作素材的快捷链接')
table('publication_corrections','publication_id text NOT NULL|type text NOT NULL|reason text|replacement_publication_id text|actor_id text|before_snapshot jsonb|after_snapshot jsonb','publication_corrections',note='追加式更正；不改旧发布快照')
table('publication_metrics','publication_id text NOT NULL|channel_id text|measured_at timestamptz|source text|metrics jsonb|operator_id text','publication_metrics',indexes=['brand_code,publication_id,measured_at'],note='平台指标结构变化用JSONB；常用筛选字段独立列，不补造数值')
table('asset_admissions','working_asset_id text NOT NULL|asset_sha256 text|origin_object_id text NOT NULL|origin_version_id text|category_code text|library_primary_category text|library_subcategory text|classification text|license_status text|reuse_scope text|ai_reuse_policy text|external_ai_transfer_policy text|state text NOT NULL|final_approval_status text NOT NULL|sync_status text NOT NULL|approval_mode text NOT NULL|library_id text|library_version text|idempotency_key text NOT NULL|submitted_by text|submitted_at timestamptz|decided_by_ref text|decided_at timestamptz|submission_metadata jsonb|precheck jsonb|receipt jsonb|manual_review_reasons jsonb','asset_admissions',note='最终批准、同步和可复用三个维度不合并；历史字段版本admissionFieldsSchema保留兼容余项')
table('library_asset_refs','admission_id text|working_asset_id text|library_id text|library_version text|permission_valid boolean NOT NULL DEFAULT false|permission_scope text[]|asset_state text|state text|mock boolean|source_kind text|source_ref text|source_digest text|last_verified_at timestamptz','library_asset_refs',indexes=['brand_code,library_id'],note='外部libraryId不是MOS主键；不以数据库缓存代替Workspace权威')
table('ingest_jobs','source_id text NOT NULL|trigger text|status text NOT NULL|dedupe_key text|attempt integer|started_at timestamptz|finished_at timestamptz|next_run_at timestamptz|failure_code text|retryable boolean|counts jsonb|lease_owner text|lease_until timestamptz|lease_token bigint NOT NULL DEFAULT 0','ingest_jobs',indexes=['brand_code,status,next_run_at'],note='有效dedupeKey局部唯一需核对重试是否复用同键，不能直接锁死历史重试')
table('research_reports','code text NOT NULL|requester_id text|mode text|query text|title text|objective text|status text NOT NULL|completion text|job_id text|executive_summary text|industry_implications text|vfib_relevance text|time_window jsonb|period jsonb|sources_snapshot jsonb|editorial_opportunities jsonb|unresolved_claims jsonb|model_run jsonb|cost jsonb|refresh_state text|conflict_detection text|reverify_due jsonb|started_at timestamptz|completed_at timestamptz','research_reports',unique=['code'],note='brandScope[0]为现有可访问品牌；有序完整scope子表不自动扩权')
table('research_findings','report_id text NOT NULL|ordinal integer|statement text|kind text NOT NULL|verification_state text NOT NULL|source_item_id text|as_of_raw text|conflict_note text|origin text|needs_verification boolean|confidence_rationale text|notes jsonb','research_findings',note='evidenceIds拆关系；FACT无有效证据不得升级VERIFIED')
table('source_evidence','url text NOT NULL|final_url text|source_id text|title text|source_name text|published_at timestamptz|published_at_raw text|retrieved_at timestamptz|quote text|excerpt text|content_hash text|access_state text|license_state text|availability text|http_status integer|provider text|provider_rank integer|redirect_chain jsonb|retrieval_metadata jsonb','source_evidence','linked',note='原对象无品牌且可被多报告引用，单份对象保留全局id；访问必须经report_evidence的已授权报告，不能作为公开全局表')
table('topic_proposals','code text NOT NULL|report_id text|report_version bigint|suggested_title_en text|summary_zh text|angle text|primary_category text|risk_grade text|status text NOT NULL|source text|ai_generated boolean|needs_verification boolean|created_by_id text|reviewer_id text|reviewed_at timestamptz|review_comments text|revision integer|topic_id text|dispatch_snapshot jsonb|fact_check_needs jsonb|recommendation jsonb|edit_diff jsonb','topic_proposals',unique=['code'],note='sourceFindingIds拆表；dispatch快照保留用于精确幂等重放')
table('research_jobs','code text NOT NULL|report_id text|kind text|actor_id text|query text|status text NOT NULL|stage text|progress integer CHECK (progress BETWEEN 0 AND 100)|provider text|provider_trace_id text|idempotency_key text|payload_hash text|attempts integer|cancel_requested boolean|filters jsonb|budget_snapshot jsonb|log jsonb|error_code text|started_at timestamptz|completed_at timestamptz|lease_owner text|lease_until timestamptz|lease_token bigint NOT NULL DEFAULT 0','research_jobs',unique=['code'])
table('provider_calls','kind text NOT NULL|op text|provider text|model text|state text NOT NULL|error_code text|http_status integer|latency_ms bigint|attempts integer|actor_id text|request_id text|invocation_key text|confirmed_amount numeric(20,6)|currency text|cost_confirmed boolean NOT NULL DEFAULT false|prompt_tokens bigint|completion_tokens bigint|total_tokens bigint|note text|receipt_metadata jsonb','provider_calls','optional',indexes=['brand_code,created_at','provider,state,created_at'],note='NULL费用与0严格区分；管理探针允许全局brandNULL，仅管理员可见；追加事实，不凭估价记实付')
table('video_render_jobs','task_id text NOT NULL|actor_id text|status text NOT NULL|status_raw text|progress integer|provider text|model text|provider_job_id text|prompt text|duration_sec numeric|size text|file_version_id text|file_path_legacy text|bytes bigint|error_code text|note text|lease_owner text|lease_until timestamptz|lease_token bigint NOT NULL DEFAULT 0','video_render_jobs')
table('library_ticket_cache','ticket_key text NOT NULL|key_id text NOT NULL|provider_user_id text NOT NULL|scopes text[]|issued_at timestamptz|expires_at timestamptz|status text|purpose text|refresh_count integer|stripped_scopes text[]','library_tickets',unique=['ticket_key'],note='源集合只有票据元数据；真实ticket在进程Map，不新增明文ticket列；迁移后过期/重新换取')
table('library_event_cursors','cursor_value bigint NOT NULL DEFAULT 0|next_cursor bigint|last_seq bigint|truncated_count integer|degraded boolean|reconcile_required boolean|last_poll_at timestamptz|last_event_at timestamptz|consumer_state jsonb','library_event_cursors',unique=['brand_code'],note='brandId转brand_code；processedSeqs投影到inbox元数据，不凭空重放外部事件')
table('library_invalidations','kind text NOT NULL|target_id text NOT NULL|at timestamptz|seq bigint|detail jsonb','library_invalidations','optional',unique=['brand_code,kind,target_id'],note='旧key仅kind+targetId且可无brand；缺品牌保守全局失效，不能静默缩小撤权范围')
table('library_admission_jobs','admission_id text NOT NULL|idempotency_key text NOT NULL|provider_admission_id text|status text NOT NULL|attempts integer|next_retry_at timestamptz|last_error_code text|request_snapshot jsonb|response_snapshot jsonb|lease_owner text|lease_until timestamptz|lease_token bigint NOT NULL DEFAULT 0','library_admission_jobs',unique=['brand_code,admission_id'],note='同一准入申请稳定远程幂等键及多步回执，禁止重新生成键后盲重试')
table('audit_events','actor_user_id text|actor_ref text|event_type text NOT NULL|object_type text|object_id text|old_state jsonb|new_state jsonb|correlation_id text|outcome text|ip_raw text|metadata jsonb|occurred_at timestamptz','audit_events','optional',indexes=['brand_code,occurred_at','correlation_id'],note='原timestamp保留，所有现存事件逐条迁移；不伪造已被旧20000条上限淘汰的历史')
# 15 relationship/detail tables.
rels=[
('role_brand_scopes','grant_id text NOT NULL|scope_brand_code text NOT NULL','global',['grant_id,scope_brand_code'],'brandScope数组逐项保留，*不在本表'),
('task_library_refs','task_id text NOT NULL|library_ref_id text NOT NULL|ordinal integer NOT NULL','brand',['brand_code,task_id,library_ref_id'],'任务显式资料引用'),
('content_version_assets','content_version_id text NOT NULL|asset_id text NOT NULL|file_version_id text|ordinal integer NOT NULL|asset_sha256 text','brand',['brand_code,content_version_id,asset_id'],'冻结后固定文件版本及hash'),
('content_version_channels','content_version_id text NOT NULL|channel_id text NOT NULL|ordinal integer NOT NULL','brand',['brand_code,content_version_id,channel_id'],'有序渠道引用'),
('content_version_evidence','content_version_id text NOT NULL|evidence_reference_id text NOT NULL|ordinal integer NOT NULL','brand',['brand_code,content_version_id,evidence_reference_id'],'有序证据引用'),
('generation_job_outputs','job_id text NOT NULL|asset_id text NOT NULL|ordinal integer NOT NULL','brand',['brand_code,job_id,asset_id'],'输出不可丢关联'),
('video_storyboard_shots','video_artifact_id text NOT NULL|ordinal integer NOT NULL|duration_sec numeric|asset_id text|shot_document jsonb NOT NULL','brand',['brand_code,video_artifact_id,ordinal'],'资产FK独立列；镜头描述结构JSONB'),
('research_finding_evidence','finding_id text NOT NULL|report_id text NOT NULL|evidence_id text NOT NULL|ordinal integer NOT NULL','brand',['brand_code,finding_id,evidence_id'],'须属于该报告获授权的证据集合'),
('topic_proposal_findings','proposal_id text NOT NULL|finding_id text NOT NULL|ordinal integer NOT NULL','brand',['brand_code,proposal_id,finding_id'],'不允许跨品牌引用发现'),
('proposal_dispatch_tasks','proposal_id text NOT NULL|task_id text NOT NULL|plan_item_id text|ordinal integer NOT NULL','brand',['brand_code,proposal_id,task_id'],'从dispatch.taskIds/planItemIds成对恢复，不依赖数组按时间排序'),
('asset_admission_history','admission_id text NOT NULL|ordinal integer NOT NULL|event_at timestamptz|actor_id text|event_type text|event_document jsonb','brand',['brand_code,admission_id,ordinal'],'内嵌history全部追加恢复'),
('research_report_brands','report_id text NOT NULL|visible_brand_code text NOT NULL|ordinal integer NOT NULL','brand',['brand_code,report_id,ordinal'],'完整保存scope列表；本期仅主品牌可读'),
('video_keyframe_assets','video_artifact_id text NOT NULL|asset_id text NOT NULL|ordinal integer NOT NULL','brand',['brand_code,video_artifact_id,ordinal'],'关键帧有序FK，不把ID留JSONB'),
('campaign_library_refs','campaign_id text NOT NULL|library_ref_id text NOT NULL|claim_path text NOT NULL|ordinal integer NOT NULL','brand',['brand_code,campaign_id,claim_path,ordinal'],'Brief源kind为LIBRARY才抽取，JSONB快照保持原样'),
('research_report_evidence','report_id text NOT NULL|evidence_id text NOT NULL|ordinal integer NOT NULL','brand',['brand_code,report_id,evidence_id'],'从report.evidenceIds、finding.evidenceIds及sources引用并集确定，保留原列表顺序元数据')]
for n,c,s,u,note in rels:table(n,c,scope=s,group='relation',unique=u,note=note)
# 16 persistence/operations tables; migration-tool bookkeeping is not included.
ops=[
('file_objects','storage_backend text NOT NULL|bucket_ref text|object_key text NOT NULL|legacy_path text|state text NOT NULL|owner_id text|visibility text|retention_until timestamptz','brand',['brand_code,storage_backend,bucket_ref,object_key'],'仅元数据，不搬文件；桶/后端命名空间属于存储身份'),
('file_versions','object_id text NOT NULL|version_no integer NOT NULL|storage_version text|sha256 text NOT NULL|byte_length bigint NOT NULL CHECK (byte_length >= 0)|mime text|upload_state text NOT NULL|verified_at timestamptz|immutable boolean NOT NULL DEFAULT false','brand',['brand_code,object_id,version_no'],'文件内容哈希，不以ETag代替SHA256'),
('upload_sessions','object_id text NOT NULL|file_version_id text|expected_sha256 text|expected_bytes bigint|status text NOT NULL|expires_at timestamptz|owner_id text','brand',[],'暂存、校验、READY提交与孤儿对账'),
('provider_configs','kind text NOT NULL|mode text NOT NULL|base_url text|model text|timeout_ms integer|retry_limit integer|secret_ref text|secret_ciphertext text|secret_key_id text|nonsecret_options jsonb|last_test_at timestamptz','global',['kind'],'现有全局配置及env>DB>file优先级保留；凭据不放自由JSONB'),
('provider_budget_policies','scope_key text NOT NULL|kind text NOT NULL|brand_monthly_usd numeric(20,6)|per_job_usd_max numeric(20,6)|budget_timezone text|effective_at timestamptz|policy_document jsonb','global',['scope_key,kind'],'全局默认及品牌策略模板，0含义须按原接口保留'),
('budget_periods','policy_id text NOT NULL|period_start timestamptz NOT NULL|period_end timestamptz NOT NULL|confirmed_usd numeric(20,6) NOT NULL DEFAULT 0|reserved_usd numeric(20,6) NOT NULL DEFAULT 0|unknown_usd numeric(20,6) NOT NULL DEFAULT 0','brand',['brand_code,policy_id,period_start'],'锁定行防并发超预算，费用未知不能当零'),
('budget_reservations','period_id text NOT NULL|invocation_key text NOT NULL|amount_usd numeric(20,6) NOT NULL CHECK (amount_usd >= 0)|status text NOT NULL|receipt_key text|expires_at timestamptz|job_ref text','brand',['brand_code,invocation_key'],'超时不自动释放结果未知的预留'),
('outbox_events','aggregate_type text NOT NULL|aggregate_id text NOT NULL|event_type text NOT NULL|dedupe_key text NOT NULL|actor_id text|actor_authz_epoch bigint|payload jsonb NOT NULL|status text NOT NULL|available_at timestamptz NOT NULL|lease_owner text|lease_until timestamptz|lease_token bigint NOT NULL DEFAULT 0|attempts integer NOT NULL DEFAULT 0|last_error_code text','brand',['brand_code,dedupe_key'],'事务内排队，事务外出站；无原始Token/正文自由日志'),
('inbox_events','provider text NOT NULL|event_key text NOT NULL|stream_key text NOT NULL|provider_seq bigint|received_at timestamptz|processed_at timestamptz|status text NOT NULL|sanitized_payload jsonb','brand',['brand_code,provider,stream_key,event_key'],'与游标和撤权变更同一事务提交'),
('idempotency_requests','actor_id text NOT NULL|operation text NOT NULL|proposal_id text|resource_key text NOT NULL|idempotency_key text NOT NULL|normalized_digest text NOT NULL|response_snapshot jsonb|state text NOT NULL|completed_at timestamptz','brand',['brand_code,actor_id,operation,resource_key,idempotency_key'],'H01作用域和标准化算法保持；同键不同digest返回409'),
('migration_runs','source_sha256 text NOT NULL|source_schema integer NOT NULL|mapping_version text NOT NULL|tool_commit text NOT NULL|status text NOT NULL|counts jsonb|file_manifest_sha256 text|approved_by_ref text|approved_at timestamptz','global',['source_sha256,mapping_version'],'只设计；无迁移执行'),
('migration_rejections','run_id text NOT NULL|source_collection text NOT NULL|source_key text NOT NULL|source_ordinal bigint|reason_code text NOT NULL|source_record_hash text NOT NULL|resolution_ref text|sanitized_detail jsonb','global',[],'完整原文仅在加密只读源快照，拒绝表不复制密钥/资料正文'),
('system_settings','setting_key text NOT NULL|schema_version integer NOT NULL|value jsonb NOT NULL','global',['setting_key'],'仅白名单有界配置；不把全部mos.json或预算账本放此表'),
('code_counters','counter_key text NOT NULL|last_value bigint NOT NULL CHECK (last_value >= 0)','global',['counter_key'],'从seq各键及现存业务编码最大值校验后恢复，不回退重用编号'),
('role_definitions','role_code text NOT NULL|label text|kind text|policy_version text NOT NULL','global',['role_code'],'由现有dict受控导入，不扩大角色权能'),
('role_permissions','role_code text NOT NULL|permission_code text NOT NULL|policy_version text NOT NULL','global',['role_code,permission_code'],'与代码RBAC策略版本一致，防数据库与字典双权威漂移')]
for n,c,s,u,note in ops:table(n,c,scope=s,group='ops',unique=u,note=note)
assert len(tables)==74,(len(tables),collections.Counter(t['group'] for t in tables))
assert len([t for t in tables if t['source']])==43
by={t['name']:t for t in tables}
by['publication_corrections']['columns']='publication_id text NOT NULL|kind text NOT NULL|reason text|replacement_publication_id text|previous_status text|actor_id text|before_snapshot jsonb|after_snapshot jsonb'
by['publication_metrics']['columns']='publication_id text NOT NULL|channel_id text|metric text NOT NULL|amount numeric(28,6) NOT NULL|source_kind text NOT NULL|as_of date NOT NULL|proof_ref text|platform_extensions jsonb'
by['publication_metrics']['indexes']=['brand_code,publication_id,as_of']
by['publication_metrics']['note']='当前是一行一个metric/amount/asOf/sourceKind，保持标量；仅未来平台扩展用JSONB，不能改API形状'
by['source_items']['columns']+='|raw_stored boolean NOT NULL DEFAULT false|canonical_url_hash text'
by['source_items']['indexes']=['brand_code,source_id,fetched_at','brand_code,canonical_url_hash']

# Additional columns are explicit because approval facts and original formatting must not be reconstructed heuristically.
by['review_cases']['columns']+='|subject_snapshot jsonb|subject_canonical_text text'
by['publishing_schedules']['note']='原行含timezone（默认Asia/Shanghai），先按每行有效IANA区解析；缺失/歧义/无效时停入隔离，不从部署机器时区推断'
fks=[]
def fk(child,col,parent,pcol='id',scoped=True):
 a,b=by[child],by[parent]
 if scoped and a['scope'] in ['brand','optional'] and b['scope'] in ['brand','optional']:
  fks.append((child,'brand_code,'+col,parent,'brand_code,'+pcol))
 else:fks.append((child,col,parent,pcol))
for t in tables:
 if t['scope'] in ['brand','optional']:fk(t['name'],'brand_code','brands','code',False)
for name,col in [('user_role_grants','user_id'),('auth_sessions','user_id'),('monthly_plans','owner_id'),('campaigns','owner_id'),('master_topics','owner_id'),('content_tasks','owner_id'),('source_registry','owner_id'),('content_versions','author_id'),('working_assets','owner_id'),('generation_jobs','requested_by'),('channels','owner_id'),('research_reports','requester_id'),('topic_proposals','created_by_id'),('research_jobs','actor_id'),('video_render_jobs','actor_id'),('review_decisions','actor_id'),('asset_admission_history','actor_id'),('audit_events','actor_user_id')]:fk(name,col,'users',scoped=False)
fk('user_role_grants','role_code','role_definitions','role_code',False);fk('role_permissions','role_code','role_definitions','role_code',False)
for n,c,p in [
('monthly_plans','supersedes_id','monthly_plans'),('plan_items','plan_id','monthly_plans'),('plan_items','content_task_id','content_tasks'),
('monthly_campaign_links','plan_id','monthly_plans'),('monthly_campaign_links','campaign_id','campaigns'),('campaign_topic_links','campaign_id','campaigns'),('campaign_topic_links','topic_id','master_topics'),
('content_tasks','campaign_id','campaigns'),('content_tasks','topic_id','master_topics'),('content_tasks','parent_task_id','content_tasks'),('source_items','source_id','source_registry'),
('evidence_references','source_item_id','source_items'),('evidence_references','topic_id','master_topics'),('evidence_references','content_version_id','content_versions'),('creative_templates','skill_version_id','skill_versions'),
('content_versions','content_task_id','content_tasks'),('content_versions','supersedes_id','content_versions'),('content_versions','superseded_by_id','content_versions'),
('review_cases','content_version_id','content_versions'),('review_cases','asset_admission_id','asset_admissions'),('review_decisions','case_id','review_cases'),
('working_assets','task_id','content_tasks'),('working_assets','campaign_id','campaigns'),('working_assets','topic_id','master_topics'),('working_assets','generation_job_id','generation_jobs'),('working_assets','file_version_id','file_versions'),
('generation_jobs','task_id','content_tasks'),('generation_jobs','skill_version_id','skill_versions'),('generation_jobs','template_id','creative_templates'),
('video_artifacts','task_id','content_tasks'),('video_artifacts','final_asset_id','working_assets'),('publishing_schedules','content_version_id','content_versions'),('publishing_schedules','channel_id','channels'),
('publication_records','schedule_id','publishing_schedules'),('publication_records','content_version_id','content_versions'),('publication_records','channel_id','channels'),
('published_artifacts','publication_id','publication_records'),('published_artifacts','file_version_id','file_versions'),('publication_corrections','publication_id','publication_records'),('publication_corrections','replacement_publication_id','publication_records'),
('publication_metrics','publication_id','publication_records'),('publication_metrics','channel_id','channels'),('asset_admissions','working_asset_id','working_assets'),
('library_asset_refs','admission_id','asset_admissions'),('library_asset_refs','working_asset_id','working_assets'),('ingest_jobs','source_id','source_registry'),
('research_reports','job_id','research_jobs'),('research_jobs','report_id','research_reports'),('research_findings','report_id','research_reports'),('research_findings','source_item_id','source_items'),
('topic_proposals','report_id','research_reports'),('topic_proposals','topic_id','master_topics'),('video_render_jobs','task_id','content_tasks'),('video_render_jobs','file_version_id','file_versions'),
('library_admission_jobs','admission_id','asset_admissions'),('role_brand_scopes','grant_id','user_role_grants'),('task_library_refs','task_id','content_tasks'),('task_library_refs','library_ref_id','library_asset_refs'),
('content_version_assets','content_version_id','content_versions'),('content_version_assets','asset_id','working_assets'),('content_version_assets','file_version_id','file_versions'),
('content_version_channels','content_version_id','content_versions'),('content_version_channels','channel_id','channels'),('content_version_evidence','content_version_id','content_versions'),('content_version_evidence','evidence_reference_id','evidence_references'),
('generation_job_outputs','job_id','generation_jobs'),('generation_job_outputs','asset_id','working_assets'),('video_storyboard_shots','video_artifact_id','video_artifacts'),('video_storyboard_shots','asset_id','working_assets'),
('research_finding_evidence','finding_id','research_findings'),('research_finding_evidence','report_id','research_reports'),('research_finding_evidence','evidence_id','source_evidence'),
('topic_proposal_findings','proposal_id','topic_proposals'),('topic_proposal_findings','finding_id','research_findings'),('proposal_dispatch_tasks','proposal_id','topic_proposals'),('proposal_dispatch_tasks','task_id','content_tasks'),('proposal_dispatch_tasks','plan_item_id','plan_items'),
('asset_admission_history','admission_id','asset_admissions'),('research_report_brands','report_id','research_reports'),('video_keyframe_assets','video_artifact_id','video_artifacts'),('video_keyframe_assets','asset_id','working_assets'),
('campaign_library_refs','campaign_id','campaigns'),('campaign_library_refs','library_ref_id','library_asset_refs'),('research_report_evidence','report_id','research_reports'),('research_report_evidence','evidence_id','source_evidence'),
('file_versions','object_id','file_objects'),('upload_sessions','object_id','file_objects'),('upload_sessions','file_version_id','file_versions'),('budget_periods','policy_id','provider_budget_policies'),('budget_reservations','period_id','budget_periods'),('migration_rejections','run_id','migration_runs'),('idempotency_requests','proposal_id','topic_proposals')]:fk(n,c,p)
fk('role_brand_scopes','scope_brand_code','brands','code',False);fk('research_report_brands','visible_brand_code','brands','code',False);fk('source_evidence','source_id','source_registry',scoped=False)
# Strong approval binding, supplement simple FKs with exact version/hash and report/evidence membership.
for parent,cols in [('content_versions','brand_code,id,manifest_hash'),('review_cases','brand_code,id,version_hash'),('review_cases','brand_code,id,content_version_id'),('review_cases','brand_code,id,asset_admission_id'),('research_findings','brand_code,id,report_id')]:by[parent]['unique'].append(cols)
fks += [('review_cases','brand_code,content_version_id,version_hash','content_versions','brand_code,id,manifest_hash'),('review_decisions','brand_code,case_id,version_hash','review_cases','brand_code,id,version_hash'),('review_decisions','brand_code,case_id,content_version_id','review_cases','brand_code,id,content_version_id'),('review_decisions','brand_code,case_id,asset_admission_id','review_cases','brand_code,id,asset_admission_id'),('research_finding_evidence','brand_code,finding_id,report_id','research_findings','brand_code,id,report_id'),('research_finding_evidence','brand_code,report_id,evidence_id','research_report_evidence','brand_code,report_id,evidence_id')]
sql=['-- PHASE 3A-1 DESIGN DRAFT ONLY. DO NOT EXECUTE. No database has validated this file.', '-- Baseline '+BASE, '-- Requires approved roles mos_owner / mos_app / mos_worker / mos_guard provisioned separately.', '-- Missing production gates are enumerated in PG07; this is not an executable migration release.', 'CREATE SCHEMA mos;']
for t in tables:
 cs=[]
 if t['name']!='brands':cs.append('id text PRIMARY KEY')
 if t['scope'] in ['brand','optional']:cs.append('brand_code text'+(' NOT NULL' if t['scope']=='brand' else ''))
 cs+=t['columns'].split('|')
 cs += ['row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0)','created_at timestamptz','recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP','updated_at timestamptz','created_by_ref text','updated_by_ref text','demo boolean NOT NULL DEFAULT false',"legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb"]
 if t['scope'] in ['brand','optional']:cs.append('UNIQUE (brand_code,id)')
 for u in t['unique']:cs.append('UNIQUE '+('NULLS NOT DISTINCT ' if t['name'] in ['library_invalidations','file_objects'] else '')+'('+u+')')
 sql+=['','-- '+t['group']+' / source '+str(t['source'])+' / '+t['note'],'CREATE TABLE mos.'+t['name']+' (\n  '+',\n  '.join(cs)+'\n);']
for i,(c,cols,p,pcols) in enumerate(fks,1):sql.append(f'ALTER TABLE mos.{c} ADD CONSTRAINT fk_{i:03d} FOREIGN KEY ({cols}) REFERENCES mos.{p} ({pcols}) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;')
sql += ["CREATE UNIQUE INDEX users_username_ci ON mos.users (lower(username));", "CREATE INDEX outbox_ready ON mos.outbox_events (available_at,id) WHERE status IN ('PENDING','RETRY');", "CREATE INDEX outbox_leased ON mos.outbox_events (lease_until) WHERE status='LEASED';", "CREATE INDEX session_expiry ON mos.auth_sessions (expires_at);", "CREATE INDEX ticket_expiry ON mos.library_ticket_cache (expires_at);", "CREATE INDEX invalidation_target ON mos.library_invalidations (kind,target_id);", "CREATE INDEX file_integrity ON mos.file_versions (brand_code,sha256,byte_length);"]
for t in tables:
 for i,idx in enumerate(t['indexes']):sql.append('CREATE INDEX ix_'+t['name']+'_'+str(i)+' ON mos.'+t['name']+' ('+idx+');')
# Index all FK lookup sides unless already covered; reviewed consolidation later prevents redundant indexes.
for i,(c,cols,_,_) in enumerate(fks,1):sql.append(f'CREATE INDEX fk_lookup_{i:03d} ON mos.{c} ({cols});')
checks={
'review_cases':"((subject_type='content_version' AND content_version_id IS NOT NULL AND asset_admission_id IS NULL AND subject_id=content_version_id AND type IN ('PROFESSIONAL_REVIEW','PUBLICATION_APPROVAL')) OR (subject_type='asset_admission' AND asset_admission_id IS NOT NULL AND content_version_id IS NULL AND subject_id=asset_admission_id AND type='ASSET_ADMISSION'))",
'review_decisions':'((content_version_id IS NOT NULL)::integer + (asset_admission_id IS NOT NULL)::integer = 1)',
'budget_periods':'confirmed_usd >= 0 AND reserved_usd >= 0 AND unknown_usd >= 0 AND period_end > period_start',
'provider_calls':"(cost_confirmed=false OR confirmed_amount IS NOT NULL) AND (confirmed_amount IS NULL OR confirmed_amount >= 0)",
'file_versions':"upload_state <> 'READY' OR verified_at IS NOT NULL"}
for t,ck in checks.items():sql.append(f'ALTER TABLE mos.{t} ADD CONSTRAINT ck_{t} CHECK ({ck});')
dicts=[('content_tasks','status','TASK_STATUSES'),('monthly_plans','status','PLAN_STATUSES'),('content_versions','state','CONTENT_VERSION_STATES'),('review_cases','state','REVIEW_CASE_STATES'),('publishing_schedules','state','SCHEDULE_STATES'),('publication_records','status','PUBLICATION_STATUSES'),('asset_admissions','state','ADMISSION_STATES'),('asset_admissions','final_approval_status','ADMISSION_APPROVAL_STATUSES'),('asset_admissions','sync_status','ADMISSION_SYNC_STATUSES'),('generation_jobs','status','GENERATION_JOB_STATUSES'),('video_artifacts','state','VIDEO_ARTIFACT_STATES'),('channels','state','CHANNEL_STATES'),('skill_versions','state','SKILL_STATES')]
s=Path('lib/mos/dict.js').read_text(encoding='utf-8');s=re.sub(r'/\*[\s\S]*?\*/|//[^\n]*','',s)
for t,col,var in dicts:
 m=re.search(r'const '+var+r'\s*=\s*\[([^\]]*)\]',s)
 assert m,var
 vals=re.findall(r"'([^']+)'",m.group(1));sql.append(f'ALTER TABLE mos.{t} ADD CONSTRAINT state_{t}_{col} CHECK ({col} IN ('+','.join("'"+v+"'" for v in vals)+'));')
sql += ['','-- RLS is defense in depth. Trusted server identity/RBAC remains mandatory; settings are NOT user assertions.', '''CREATE FUNCTION mos.brand_member(b text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog,mos
AS $$ SELECT EXISTS (
 SELECT 1 FROM mos.users u JOIN mos.user_role_grants g ON g.user_id=u.id
 WHERE u.id=nullif(current_setting('mos.actor_id',true),'') AND u.status='active'
 AND g.revoked_at IS NULL AND (g.valid_until IS NULL OR g.valid_until > CURRENT_TIMESTAMP)
 AND (g.all_brands OR EXISTS (SELECT 1 FROM mos.role_brand_scopes s WHERE s.grant_id=g.id AND s.scope_brand_code=b))
) $$;
ALTER FUNCTION mos.brand_member(text) OWNER TO mos_guard;
REVOKE ALL ON FUNCTION mos.brand_member(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mos.brand_member(text) TO mos_app,mos_worker;
-- mos_guard is NOLOGIN, owns no business tables, has SELECT only on these non-RLS security metadata tables.
-- Runtime roles are non-owner/NOBYPASSRLS. Identity/session and global settings need separately reviewed narrow repositories/functions.''']
for t in tables:
 if t['scope']=='brand':
  n=t['name'];sql += [f'ALTER TABLE mos.{n} ENABLE ROW LEVEL SECURITY;',f'ALTER TABLE mos.{n} FORCE ROW LEVEL SECURITY;',f"CREATE POLICY brand_scope ON mos.{n} TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));"]
sql += ['''ALTER TABLE mos.source_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.source_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_read ON mos.source_evidence FOR SELECT TO mos_app,mos_worker USING (
 EXISTS (SELECT 1 FROM mos.research_report_evidence r WHERE r.evidence_id=source_evidence.id)
);
-- No INSERT/UPDATE policy for linked evidence in this draft: Phase3A-2 must implement a narrow authorized ingestion function.
-- Nullable-brand provider_calls/audit_events/invalidations and global tables are DENY by absence of runtime GRANT in this draft.
-- They require brand-read/admin-read and append-only functions, not unrestricted SELECT/UPDATE grants.
-- REQUIRED BEFORE EXECUTION: immutable-manifest/append-only triggers; grant catalog; global/nullable-brand policies;
-- snapshot file READY gate, report/evidence/source brand consistency, active membership epoch locking,
-- admission subject snapshot freeze, legacy field codec and date/time decisions. See PG07. No statement was executed.''']
(OUT/'POSTGRESQL_SCHEMA_DRAFT.sql').write_text('\n'.join(line.rstrip() for line in '\n'.join(sql).splitlines())+'\n',encoding='utf-8')
(OUT/'TABLE_CATALOG.json').write_text(json.dumps({'baseline':BASE,'collections':43,'coreTables':43,'relationshipTables':15,'supportTables':16,'totalTables':74,'tables':tables,'foreignKeys':fks},ensure_ascii=False,indent=2),encoding='utf-8')
HEADER=f'''设计日期：2026-10-27。唯一分析基线：`{BASE}`，分支 `baseline/consolidation-phase2`，仓库 `475022876/watu-operation`。开始时HEAD、origin远程分支及干净工作树一致。应用0.1.6、mosSchemaVersion=8保持不变。

本轮是 **Phase 3A-1设计**：没有导入应用store、启动业务服务、读取生产JSON内容、安装依赖/PostgreSQL、执行SQL、迁移数据或修改任何业务源码。Phase 2的990项记录是既有隔离证据，本轮只核对源码及证据，不将其说成PostgreSQL测试通过。SQL是待评审草案，未在数据库解析或执行；本轮静态检查不能代替下一阶段迁移/约束/RLS验收。
'''
def doc(filename,title,body):
 (OUT/filename).write_text('# '+title+'\n\n'+HEADER+'\n'+body.strip()+'\n',encoding='utf-8')
source=Path('lib/mos/store.js').read_text(encoding='utf-8');block=source[source.index('const BASE_SHAPE = {'):source.index('\nlet db = null;')]
collections8=re.findall(r'^  (\w+): \[\]',block,re.M)
assert set(collections8)=={t['source'] for t in tables if t['source']}
store_consumers=[];routes=[]
for p in Path('lib/mos').rglob('*.js'):
 text=p.read_text(encoding='utf-8')
 if re.search(r"require\(['\"]\.{1,2}/store['\"]\)",text):store_consumers.append(p.as_posix())
 if p.parent.name=='routes':routes += [{'method':m.group(1).upper(),'path':m.group(2),'file':p.as_posix()} for m in re.finditer(r"^(get|post|put|del)\('([^']+)'",text,re.M)]
maprows='|JSON集合|目标主表|品牌隔离|拆分/迁移特别规则|\n|---|---|---|---|\n'
for c in collections8:
 t=next(t for t in tables if t['source']==c)
 scope={'brand':'brand_code + 复合FK','global':'全局身份/受控配置','optional':'品牌或明确全局记录','linked':'报告关系授权，禁止全局开放'}[t['scope']]
 maprows+='|'+c+'|'+t['name']+'|'+scope+'|'+(t['note'] or '保留原ID、业务编码、状态及可验证时间；标量与文档字段见SQL/字段目录')+'|\n'
doc('PG01_CURRENT_DATA_MODEL_AUDIT.md','PG01 当前schema8数据模型审计',f'''
## 结论与计数

`lib/mos/store.js`的BASE_SHAPE精确包含 **43个数组集合**，包括品牌/身份/会话与业务/审计；另有`settings`、`seq`两个持久化对象，共45个数据分组。`mosSchemaVersion`是元数据，`_initialPasswordOnce`为初始化临时字段，不计业务集合，不迁移该临时明文。不能把43说成生产实库已有43个非空集合：本轮未读取生产数据，实库行数、容量、孤儿和重复率均为Unknown。

30个MOS模块直接require store；路由目录静态识别155条直接字面量注册（GET71、POST65、PUT15、DEL4，不包括动态/其他注册方式）。这说明需内部异步Repository改造，不能只更换一条数据库连接。清单见SOURCE_ANALYSIS.json。

## 43集合完整映射

{maprows}
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
''')
# Full schema synopsis for all 74 tables.
summary='|表|类别|PK / 附加唯一键|主要FK|查询索引/版本|\n|---|---|---|---|---|\n'
for t in tables:
 fkcols=['`'+c+'`→'+p for name,c,p,_ in fks if name==t['name'] and c!='brand_code']
 summary+='|'+t['name']+'|'+t['group']+'|'+('code' if t['name']=='brands' else 'id:text')+'；'+(' / '.join(t['unique']) or '无未经确认的自然唯一键')+'|'+('; '.join(fkcols) or '—')+'|'+('; '.join(t['indexes']) or 'PK/FK索引')+'；row_version|\n'
doc('PG02_TARGET_POSTGRESQL_SCHEMA.md','PG02 PostgreSQL目标模型与SQL草案',f'''
## 规模与边界

建议 **74张业务及支撑表=43张主表+15张关系/明细表+16张运行支撑表**，不含迁移工具自身版本登记表、临时staging、索引、视图或函数。74是此草案的可审查范围，不是必须一次全部手写完或已经建表。禁止单个JSONB大表承接mos.json。完整字段/类型在POSTGRESQL_SCHEMA_DRAFT.sql及TABLE_CATALOG.json；SQL全量表定义、外键、唯一键、状态检查和RLS示例均未执行。

核心模型不变：计划—活动—MasterTopic—任务—内容版本—专业/发布审核—排期—发布/快照；情报—报告—发现/证据—候选选题—人工批准；工作素材—准入申请—独立最终审核—Workspace回执/引用。数据库不成为Workspace审批或权限的替代权威。

## 统一类型、键、品牌和审计约定

- 原业务ID为text，保留现有uid/手工演示ID；brands以code为PK。无id的关系、会话元数据等用确定性迁移id，DTO不增加原来不存在的字段。table id不承担展示编号。
- 品牌业务表brand_code NOT NULL，引用品牌表code；同品牌父子使用(brand_code,id)复合FK，不能只按id外键而放任跨品牌。全局users/角色/配置通过专用权限通道；source_evidence以授权报告关系隔离；全局审计/探针/失效记录的brand可NULL，必须显式特殊策略。
- mutable行row_version和updated_at：CAS每次+1；旧行缺版本的迁移默认1只可用于原本未定义版本的行，旧字段已存在却非法时拒绝。业务版本number与row_version独立。created_at/created_by_ref、updated_at/updated_by_ref及demo属于审计基础；没有历史值时created_at保留NULL，技术recorded_at记录入库时刻；DTO不输出原来不存在的历史字段，不伪造真实业务时间。
- 真实时间用timestamptz，日历日期用date；排期原串、local timestamp、timezone/precision和可证实UTC并存。毫秒epoch会话时间按毫秒转换。PostgreSQL输出Date/JSONB/numeric/bigint须通过DTO codec保持旧API类型和格式。
- 钱为numeric(20,6)，指标为numeric(28,6)，字节/计数为bigint；NULL未知费用不变0；不换汇或重建虚假费用。API仍输出原number/null，在安全范围内明确转换，不全局改pg类型解析并丢精度。
- FK默认RESTRICT，不级联删除历史；用户软停用不删除，历史actor缺失时保留actor_ref并将可空actor_user_id设NULL，禁止制造Active用户。真正任务负责人缺失属于阻断项。
- audit_events/review_decisions/admission_history/发布快照为追加或冻结记录：运行角色禁止UPDATE/DELETE；状态迁移继续由原业务状态机控制。SQL草案尚需不可变/追加触发器和最小GRANT评审，不能直接拿草案上线。

## 74表概览

{summary}
## 关系型拆分及JSONB分工

15张明细分别为：角色品牌scope、任务资料引用、版本素材、版本渠道、版本证据、生成输出、视频分镜、发现证据、候选来源发现、派工结果任务、入库history、报告品牌scope、视频关键帧、Campaign资料引用、报告证据。

JSONB用于有界文档：营销Brief、prompt/rule/manifest快照、模板非执行配置、审核requirements、视频脚本/字幕/镜头描述、报告机会/缺口/模型执行元数据、经过脱敏的回执与事件payload、用户prefs。授权引用、外键、状态、预算、金额、排期筛选、关键版本号必须是列/关系。当前publication_metrics是标量，不能机械改为JSONB；仅额外平台扩展可用有schema的platform_extensions。

每表legacy_extra仅收纳经分类的非关键兼容余项，不得复制整条原JSON对象、凭据或业务关系，不能作为通用读写主载体。下一阶段字段登记器要求每一个源字段明确属于typed列/有schema文档/子关系/获批准归档或拒绝项，否则迁移失败。完整原始字节只在加密只读源快照保留，不能以丢字段取得兼容。

## 关键特殊约束

内容版本唯一(task,number)，同品牌FK；review_cases内容主体同时绑定(content_version_id,version_hash)到冻结manifest，decisions必须与case类型/主体/hash一致。资产准入的subject_snapshot另行冻结，不能把assetSha256误当全部准入元数据hash。三条审核链不合并成一个approved字段。

review_cases旧内容hash为空/与目标不一致、历史准入快照不可重建时不能直接导成有效批准；保持原历史并列出隔离问题，人工解决后才允许切换，不自动补批准。发布必须仍检查当前冻结版本、渠道、专业审核、发布批准和素材READY；FK和CHECK不能独立证明业务审核通过。

source_evidence保持全局ID，但运行账号无全局访问；经research_report_evidence以及原主品牌授权读取。发现证据关联用报告/证据复合FK。来源表品牌与报告品牌不一致、无任何消费者或未知访问范围的证据进入隔离；不会默认归属VFIB或向所有品牌公开。报告完整brandScope列表保留，现有仅首品牌可访问的行为不因拆表自动放宽。

原manifest hash保持原值和canonical原文，不以jsonb::text重算。JSONB键序/空白/数值输出不是JS stableStringify；冻结对象必须用原算法验证，禁止迁移时重新签发批准。

## RLS建议与实现边界

建议对品牌业务表启用RLS+FORCE ROW LEVEL SECURITY，作为遗漏WHERE brand条件的防线；应用RBAC仍做动作权限、当前用户、职责分离和当前授权校验。运行角色不能是表owner、superuser或BYPASSRLS；RLS默认拒绝及owner例外见[PostgreSQL官方说明](https://www.postgresql.org/docs/18/ddl-rowsecurity.html)。

每个已认证请求在同一client事务内set_config(...,true)设置actor/brand；身份来自已验证会话，禁止信任请求体actorId。未设置上下文或actor停用/撤权即拒绝；空上下文不等于全品牌。COMMIT/ROLLBACK清除局部上下文，归还池前重置，异常连接销毁。SQL injection或持有应用DB凭据者能伪设GUC，因此RLS不等于可信身份来源，参数化SQL和凭据保护仍必要。

草案包含会员检查函数和品牌RLS示例；全局/nullable-brand/身份bootstrap/证据写入仍按默认无GRANT阻断，须在Phase3A-2补齐限定函数和策略后才可执行。安全definer函数固定search_path、撤销PUBLIC执行、专用NOLOGIN guard角色只读授权元数据，不授予全库访问。RLS查询不可递归引用其自身策略表；DBA备份/恢复走受控专用角色。

## 文件模型及恢复

file_objects标识逻辑对象/后端/存储键/品牌；file_versions标识不可变版本、SHA256、字节数、MIME、校验时刻和上传状态；upload_sessions记录临时上传。working_assets和published_artifacts以同品牌FK引用明确文件版本。文件留在既有uploads/published路径，首轮仅登记与校验，不搬移/删除、不强制部署新对象存储。

状态草案UPLOADING→STAGED→VERIFIED→READY；文件先写临时位置并校验，短事务写READY引用。崩溃前后通过session、hash、存储清单对账：未引用对象标记ORPHAN_PENDING并隔离待人工批准，已引用缺文件标记MISSING并阻断发布。对象存储与PG不能构成单一原子提交；Outbox完成后续动作，孤儿对账负责补偿。发布快照保留独立不可变版本，不变成指向可编辑原素材的链接。二进制、视频、base64媒体不入普通业务JSONB。
''')
TX=[
('TX01','审核决定/内容联动','锁actor+case+主体版本/任务；重查职责分离和manifest；decision追加、case与内容/任务状态、审计一次提交','远程准入授权在事务外取得证据，短事务重查授权epoch/冻结主体后提交；失败不记批准','并发相反决策仅一个成功；断连接/磁盘满/撤权后无部分成功'),
('TX02','内容修订/旧审核失效','锁task+old_version+所有未终结case；分配新number；新草稿/旧SUPERSEDED/取消decision/任务状态同提交','无需网络；冻结文件检查先做并在事务中核对file_version/hash','同时修订/编辑/批准不会复用旧批准；409保留员工草稿'),
('TX03','排期/发布/回执','排期更新CAS；版本、渠道、审核、READY素材再校验；发布记录+不可变文件引用+审计一次提交','现有人工登记不发社媒请求；未来发布用Outbox和外部幂等回执/补偿，文件准备在事务外','保存失败不得伪造PUBLISHED；回执重复/乱序不倒退状态，快照完整'),
('TX04','企业资料准入','准入本地审核状态、独立finalApprovalStatus/syncStatus、作业及outbox同提交；稳定origin/idempotency','worker按create→submit→artifact执行现有正式契约；外部成功本地失败先查回执再恢复；不可回滚已获批准的远端事实','远程超时/429/回执丢失/本地提交失败均不重复入库，不凭MOCK得到真实复用资格'),
('TX05','Provider预算/账本','锁预算period行；原子检查confirmed+reserved+unknown与限额；插唯一invocation预留+job/outbox；结算账本+预留+审计同提交','模型调用在事务外；实际供应商费用与估价分离；超时结果UNKNOWN保留占额，不自动释放或双记','并发抢最后预算不超配；同回执只结一次；重启未知费用不当0'),
('TX06','权限/撤权/游标','所有授权更改先锁user，增加authz_epoch；inbox去重+失效登记+票据元数据过期+游标同提交','外部事件轮询在事务外；未知事件/truncated置reconcile_required并暂停关键使用；以Workspace实时授权为准','游标不能越过未提交撤权；旧会话/在途本地权限快照不能绕过；全局失效不缩成某品牌'),
('TX07','研究/图片/视频作业','创建job+幂等记录+预算预留+outbox；短租约领取；完成时用lease_token/CAS写结果、素材、账本与审计','search/LLM/render/poll/download均事务外；不支持供应商幂等的模糊结果先对账/人工处理','worker崩溃/租约过期/晚回包无重复采用；拒绝将未真正调用写SUCCEEDED'),
('TX08','常规计划/活动/任务等并发','单聚合显式Repository UPDATE ... WHERE row_version=expected；关联FK/唯一+审计同事务','大查询分页/确定排序；日历仍同源投影，不另建一套日历事实','多员工同版本并发一个成功另一个409；非法跨品牌FK前仍做RBAC'),
('TX09','存储耐久/多进程','PG WAL durable COMMIT；同client事务，明确异常回滚；唯一业务编号用锁计数器；禁整库覆盖','业务实例全部切到一个权威PG；PG故障Fail Closed，不自动退JSON；备份/PITR处理灾难','双实例并发、断连提交不确定、死锁/序列化重试、重启与恢复验证'),
('TX10','文件/数据库一致性','PG保存上传状态/固定文件版本/哈希和引用；只有已校验READY可引用；关系提交与业务状态一致','文件暂存→校验→READY短事务；Outbox对账+隔离孤儿+人工删除；不承诺跨存储原子性','各崩溃点无可发布的缺文件引用；文件哈希/PITR时点可对账，无擅删素材')]
txt='|风险|领域|数据库事务边界|外部与补偿边界|验收负例|\n|---|---|---|---|---|\n'+'\n'.join('|'+ '|'.join(row)+'|' for row in TX)
(OUT/'TX01_TX10_MAPPING.md').write_text('# TX01—TX10设计对应表\n\n'+txt+'\n',encoding='utf-8')
doc('PG03_TRANSACTION_AND_CONCURRENCY_DESIGN.md','PG03 事务、并发与权限设计',f'''
## Repository / Transaction Layer

保留路由、DTO、状态机、RBAC和Enterprise Workspace网关语义，改内部持久化边界：Controller→现有业务规则/聚合Service→Repository→同一PG client的UnitOfWork。事务上下文显式传给审计、幂等、预算和Outbox Repository；pure helpers可继续接收限定聚合的只读对象，不能在全局getDb里偷偷装一个全库缓存再回写。

当前getDb同步返回可变数组、atomicMutation拒绝async，而PG I/O必须await；30个直接消费者及其调用链需逐模块内部改造。不得将getDb简单改成Promise、用Proxy伪装数组或每次SELECT全库后全量DELETE/INSERT。未来runInTransaction(async tx=>...)需要begin/commit/rollback/finally release，每条SQL参数化，所有操作同一个client；不能在pool.query随机连接间拼事务。[node-postgres事务说明](https://node-postgres.com/features/transactions)。

默认READ COMMITTED+明确行锁/CAS/唯一约束；跨行谓词不适合锁固定行时可用SERIALIZABLE并处理40001，不能误认为隔离级别会自动防应用丢写。[PostgreSQL隔离级别](https://www.postgresql.org/docs/18/transaction-iso.html)。

## TX01—TX10全覆盖

{txt}

## 锁顺序和并发编辑

所有写事务固定按用户id排序锁当前actor/负责人授权行，再锁聚合根（任务/准入/报告），再锁内容版本、case等从属行，最后预算/幂等/审计记录；混合预算与任务服务须共用已评审锁序，避免某路径倒序。预算锁前置预检可在单独短事务预留，避免与聚合长链交叉锁。角色撤销必须也先锁用户行并增加epoch，不允许只删grant绕过同步点。行锁/死锁处理依据[PG锁机制](https://www.postgresql.org/docs/18/explicit-locking.html)。

负责人只Active不够，派工提交前仍查询当前品牌content.edit权限。锁用户授权行后关键操作与撤权有可定义提交顺序；不要依赖session缓存角色、Redis或启动时权限快照。RLS校验品牌可见性，Service RBAC校验动作与职责分离，二者都必须执行。

编辑草案示意（仅文档，不执行）：

```sql
UPDATE mos.content_versions
SET body=$1, row_version=row_version+1, updated_at=CURRENT_TIMESTAMP
WHERE brand_code=$2 AND id=$3 AND row_version=$4 AND state='DRAFT'
RETURNING id,row_version;
```

0行先按同品牌授权查询区分既有404/状态错误/ROW_VERSION_CONFLICT；不要统一泄露外品牌是否存在。CAS失败事务回滚，H07仍保留当前草稿，不能继续锁旧内容。版本number在task行锁内分配并受唯一约束，不用并发MAX+1裸写。所有跨对象引用先应用鉴权，再依赖复合FK兜底。

## 幂等、提交不确定与错误映射

H01标准化仍调用原JS算法；幂等唯一(actor,brand,operation,resource/proposal,key)，digest保存normalized payload。单事务争抢唯一键，同key不同digest返回原明确409；相同digest返回首次持久化response_snapshot，不能根据已变化任务重建另一份结果。实际payload/快照不写密钥，响应不得包含未经授权品牌数据。

COMMIT已发送但连接断开属于UNKNOWN，不等于回滚；用相同幂等作用域在新连接确认提交状态后返回/重试，不产生第二业务编号、审批、外部提交。40001/40P01仅在事务内无外部副作用且幂等允许时有界重试（初拟最多3次+抖动），业务409不自动重放覆盖编辑。

DB23505/23503/23514通过具体Repository上下文映射既有API错误码和状态；SQL/表名/连接串/堆栈不得回传。超时/数据库不可用走现有失败结构，绝不初始化新库或自动读旧JSON掩盖失败。短事务初拟statement_timeout=5秒、lock_timeout=1秒、idle_in_transaction_session_timeout=10秒，须按回归/压测修订，不是已验证生产参数。

## Outbox / Inbox执行协议

1. 事务A：授权、不可变请求快照、幂等、预算预留、业务job及Outbox一起提交；拿到提交成功后才允许启动worker。
2. 事务B：worker用FOR UPDATE SKIP LOCKED领取到期任务，设置lease_owner、lease_until、递增lease_token，立即提交。SKIP LOCKED仅用于队列，不用于普通业务读以避免遗漏，[官方SELECT语法](https://www.postgresql.org/docs/18/sql-select.html)。
3. 无数据库事务持有期间执行外部搜索/模型/资料库API/文件I/O；发送前重新验证用户/品牌权限、Workspace授权和H04出站安全；租约心跳只用独立短事务。
4. 事务C：只有正确lease_token/幂等身份才能接受回执，追加调用事实，结算预算，落素材及业务状态，写审计并完成Outbox。失去租约的迟到worker不能覆盖新结果。
5. 对方支持幂等时复用稳定外部key；不支持时，发送超时进入UNKNOWN/RECONCILIATION，不盲目再次计费或发布。at-least-once投递不等于跨系统exactly-once，不能作此承诺。
6. Inbox对provider+brand+stream+event_key去重；撤权、缓存失效、游标、审计同提交。事件缺失/截断须全量对账；已有processSeqs仅导入去重事实，不把历史元数据当新事件重放。

## 预算、冻结和远程授权特别说明

预算period同时核算confirmed、reserved、未知结果占额，NULL仍未知；旧账本滚动丢失部分需财务/预算责任人批准期初余额，不能置零。provideradmin与research-engine费用口径要先决策再统一，不以数据库替换暗改预算含义。

内容冻结后正文、引用、披露、渠道和语言由不可变版本/manifest绑定，state可按原状态机流转；审核决定记录固定hash及policy_version。素材替换必须新file_version/新内容版本；允许修改负责人等非实质字段不能改变冻结摘要。审批发起人不能审批自身内容。

Workspace实时授权发生在外部调用阶段，不能在数据库长事务里等资料库响应；取得权威证据后本地重查epoch、失效登记、主体hash。外部系统在最后校验后立即撤权与已经发出的网络请求之间仍有不可消除窗口，应使用现有短期用户票据、记录授权时点并停止后续下载/复用；数据库RLS不能消灭这一跨系统事实，也不能替代H05外发检查。

## 同步API兼容

已有同步模型接口可保持HTTP请求等待，内部等待worker/结果时不持DB事务；超时返回原失败结构并按原幂等查询首次结果，不能擅自改成202或新状态。已有异步研究/视频接口继续原jobId与轮询契约。若具体同步端点无法在旧超时/响应字段内安全表达UNKNOWN，列为协议变更申请阻断该端点迁移，不以“API零修改”掩盖冲突。
''')
doc('PG04_MIGRATION_AND_ROLLBACK_PLAN.md','PG04 确定性迁移、核对与回滚计划','''
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
''')
doc('PG05_DEPLOYMENT_AND_OPERATIONS.md','PG05 PostgreSQL部署与运维设计','''
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
''')
doc('PG06_IMPLEMENTATION_ROADMAP.md','PG06 实施路线、工作量与验收门禁','''
## 当前阶段的完成范围

Phase3A-1交付7份设计、74表SQL/字段目录、43集合映射、ER图、TX对应及只读完整性证明。没有PG运行环境，数据库语法/约束/RLS/迁移/恢复均Not Executed；仅文档/静态检查完成。Phase2既有990项不抵扣任何PG验收。完成设计后停止，不能自行进入Phase3A-2。

## 建议分期

|阶段|拟实施内容|验收标准|需要的授权|
|---|---|---|---|
|A 决策冻结|审阅74表、字段规则、时区/预算/会话失效、RLS、运维和回滚边界|PG07全部阻断决策有负责人/批准；真实数据profiling范围明确|人工批准设计及下一阶段范围|
|B 隔离存储基础|在专用开发/CI环境引入pg+迁移工具，完整DDL/GRANT/RLS/append-only/冻结触发器；Repository/UoW/DTO codec；用合成数据|schema74表可全新建库；错误migration可恢复；RLS空ctx/池复用/品牌/角色负例全通过；无真实外部连接|单独授权依赖/测试PG安装或托管实例，不能据本设计直接执行|
|C 关键事务先行|TX01/02/05/06及派工；按批准范围确认/修复H05字段覆盖疑点；内容、审核、预算、身份Repository|并发审核/修订/最后预算/撤权/提交断连测试；H01/H02/H07不退化；外部API契约golden匹配|单独授权业务源码重构及独立修复范围|
|D 全域Repository及Outbox|计划/活动/任务/情报/研究/生成/视频/排期/入库/归档，文件元数据与inbox|155直接路由及间接消费者访问清单均迁出生产JSON；17回归及专项PG版通过；外部替身故障矩阵通过|按模块评审提交；禁止生产混存双写|
|E 迁移工具/逆向恢复演练|严格schema8只读snapshot profiling、74表映射、对账/拒绝清单；文件清单；移植合法配置引用|同快照两次相同逻辑结果；43集合逐记录核对；真实批准hash/引用/金额/权限一致；损坏/未来schema不落目标|经批准使用脱敏或受控真实副本；完整恢复条件明确|
|F 预生产验证|负载/双实例/租约/网络分区/主库故障/PITR/文件崩溃；旧JSON与PG响应对照|0未解释差异，RPO/RTO实测达标；外部作业UNKNOWN有执行手册；代码/数据回滚演练通过|独立预生产资源、备份与故障注入授权|
|G 生产切换|停写、最终快照完整导入、对账、PG只读抽验、人工放行、观察|最终源摘要锁定；0关键拒绝项；全部旧写者fenced；明确首次PG提交时间和单写权威|单独生产变更/迁移/开放写入批准|

B—F为建议工作包，可再细分代码提交；并非本次已被授权的行动。按模块逐步实现不等于按集合分批生产写入。正式单次切换的维护窗口需演练实测后批准。

## 工作量估计与约束

复杂度高：74表、30个同步store直接消费者、至少155个直接注册端点，以及审批/预算/远程作业/文件一致性。瓶颈是行为兼容和失败测试，不是生成建表SQL。没有生产数据量、并发、部署约束和外部能力实测，以下只是规划估计。

初拟设计冻结/原型验证5–8工程人日，Repository/74表/关键事务15–22人日，全域调用迁移与Outbox/文件12–18人日，导入/对账/回滚工具8–12人日；合计约40–60工程人日，另需约8–12 QA/恢复演练人日。两名熟悉Node/PG的工程师配兼职DBA和QA、决策及时的情况下约6–10个自然周；单人或数据缺陷多/需要真实联调时更长。未包含Postiz/Activepieces、真实社媒、向量检索或新的AI功能，不能以工期换删功能。

## 必须先作出的人工决策

1. 确认74表的范围及source_evidence报告关系隔离、RLS防线，接受补齐正式GRANT/函数/触发器后才执行DDL。
2. 批准PG18最新小版本与具体托管/自建、区域/资料驻留、环境预算、DBA与恢复责任人；RPO/RTO和备份保留目标。
3. 决定是否授权Phase3A-2安装测试依赖/隔离PG、增加lockfile、创建独立开发分支和修改业务源码，明确每次提交/审计节奏。
4. 批准对真实JSON只读快照及素材/配置引用做profiling的范围、接触人员和脱敏要求；明确缺陷修正审批，不能默认改生产数据。
5. 确认排期timezone与actualAt继承/精度/DST规则、非法日期处置，以及保持DTO原格式的要求。
6. 确认预算按何时区自然月/原31天口径、研究与Provider账本去重/期初余额、UNKNOWN占额与历史不足时的放行责任。
7. 批准切换会话重登、票据重取、后台任务HOLD与逐项恢复策略，决定如何处理在途/模糊结果外部请求。
8. 对H05 contentTaskId/taskId疑点先安排负例复核，单独授权修复和回归；不能把Phase2旧测试通过当作覆盖该路径。
9. 选择停写全量最终切换，批准维护窗口和写者fencing；PG首写之后的回滚原则为优先前滚/PITR，若要求回JSON必须先证明逆向映射与作业状态可无损表达。
10. 指定业务/API、安全、数据/备份三方验收人，以及生产变更批准人；无批准不开始G。

## 对外交付口径

预计外部API路径/请求字段/响应结构/业务状态/双系统正式契约改动 **0项（设计目标）**。内部异步调用和事务实现会广泛变更，不能称零成本替换；发现必须新增HTTP状态/字段或审批语义时，先提交兼容变更申请，未获批准则阻断相关模块，而不是先改契约。
''')
RISK=[
('R01','High / 阻断','同步全局getDb和可变数组与PG异步事务结构冲突','30个直接消费者/155直接端点仅为静态下界','域Repository+显式UoW+DTO codec；禁止全库JSONB/Promise伪装store','PG版全路由与故障回归；0业务源码改动发生于本轮'),
('R02','High / 阻断','H05版本引用遍历字段不一致','routes/content.js用contentTaskId；workspace-ai-policy.js按v.taskId，静态可见','先用真实版本构造负例验证漏查，单独授权修复，FK映射严格content_task_id','任务仅经版本素材引用受限资料时仍阻断外发；本轮未复现运行攻击/未修复'),
('R03','High / 阻断','无品牌/多态/外部ID，机械一对一会扩权或断引用','source_evidence无brand，报告brandScope、plan_items从父级推导、libraryId外部ID','报告证据授权边+复合品牌FK+排他审核主体CHECK；未知归属隔离','跨品牌/未知归属/全局撤权负例；0无解释孤儿'),
('R04','High / 阻断','预算口径/历史账本不足','31天汇总与自然月/UTC实现并存；provider_calls滚动2000','先人工决定期间/币种/期初/UNKNOWN策略，再事务预留与去重结算','预算责任人签署期初核对；不虚造费用或把NULL置0'),
('R05','High / 阻断','冻结hash/JSONB序列化/历史批准不一致','manifest使用JS stableStringify，SQL jsonb文本不等价','保留原canonical/hash；冻结文件版本；审批case绑定准确主体/hash','旧批准指纹100%核对；无法重建者不能自动批准'),
('R06','High / 阻断','时间类型/API数值变化','无偏移plannedAt/actualAt，排期另有timezone；pg numeric/bigint输出可为字符串','显式DTO/时区/精度codec；不依部署机器时区推断','DST/日期级/epoch/null/大数/六位小数golden测试'),
('R07','High / 阻断','不可重复外部操作及跨存储非原子','准入多步推送、模型计费、文件落盘与PG分离','Outbox/Inbox、稳定幂等、租约fencing、UNKNOWN对账；不宣称exactly-once','超时/429/远端成功本地失败/重复回执/租约过期负例'),
('R08','High / 阻断','RLS信任来源、全局表、bootstrap及权限漂移','共享DB角色可SET GUC，global auth需读取受限字段','服务端验证session，参数化SQL，非owner/NOBYPASSRLS；guard限定函数；RBAC仍动作权威','空ctx/伪actor/连接池复用/角色撤销/全局审计读取负例'),
('R09','High / 阻断','PG首写后回旧JSON丢失数据','新预算预留/Outbox状态不完全可表达为schema8','停写全量切换；首写后优先PG修复，回JSON需逆向验证且无UNKNOWN在途','含新PG写和外部副作用的恢复演练，而非只git checkout'),
('R10','High / 阻断','素材缺失、可变文件与PITR不同时点','objectKey和published物理副本；PG不备份文件','file_object/version、READY门禁、hash清单、隔离孤儿、同点备份','冻结/发布引用均有对应字节与SHA；不自动删除旧素材'),
('R11','Medium→High / 未知','生产容量/孤儿/非法UTF8/NUL/坏日期/重复键','本轮未读生产记录，不能给通过结论','授权快照profiling，字段完全分类，拒绝清单，禁止静默清洗','关键未解决拒绝数0；74表映射重跑确定'),
('R12','High / 阻断','恢复密钥和基础设施选择未完成','旧备份DPAPI同用户；PG未部署','托管KMS/独立恢复责任+PITR/文件演练；密钥只引用','RPO/RTO实测达标、异机或独立故障域恢复可用'),
('R13','Medium / 阻断执行','SQL草案未经过数据库验证','本轮只文本构造/静态检查，不安装PG','Phase3A-2补全append-only/冻结触发器、全局GRANT/策略、证据写入函数并在隔离PG执行','真实建表/外键/状态/鉴权/回滚测试后才形成可执行migration'),
('R14','Medium','过度JSONB/索引与保留治理','legacy_extra易变成隐形整行存储，FK索引可能重复','字段schema登记；JSONB仅有界文档；基于EXPLAIN合并索引；清理有批准','无未知字段静默落extras、无预算/关系藏JSONB、旧审计不丢'),
('R15','High / 未验证','真实Workspace/模型供应商能力','Phase2真实外部服务/生产未验收','继续保持H04/H05拒绝策略，另行授权最低预算/测试账户验证','缺元数据/撤权/未知密级仍拒绝，不修改正式契约绕过')]
rtable='|编号/级别|风险|当前证据/未知|兼容与处置方案|验收/批准门禁|\n|---|---|---|---|---|\n'+'\n'.join('|'+ '|'.join(r)+'|' for r in RISK)
doc('PG07_RISK_AND_COMPATIBILITY_MATRIX.md','PG07 风险及API兼容性矩阵',rtable+'''

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
''')
ER='''erDiagram
    brands ||--o{ monthly_plans : scopes
    monthly_plans ||--o{ plan_items : contains
    plan_items }o--o| content_tasks : schedules
    campaigns ||--o{ campaign_topic_links : links
    master_topics ||--o{ campaign_topic_links : belongs
    master_topics ||--o{ content_tasks : produces
    content_tasks ||--o{ content_versions : versions
    content_versions ||--o{ content_version_assets : freezes
    working_assets ||--o{ content_version_assets : references
    content_versions ||--o{ review_cases : exact_manifest
    asset_admissions ||--o{ review_cases : separate_approval
    review_cases ||--o{ review_decisions : append_only
    content_versions ||--o{ publishing_schedules : approved_version
    channels ||--o{ publishing_schedules : destination
    publishing_schedules ||--o{ publication_records : actual_receipt
    publication_records ||--o{ published_artifacts : immutable_snapshot
    working_assets ||--o{ asset_admissions : admission
    asset_admissions ||--o{ library_admission_jobs : external_saga
    asset_admissions ||--o{ library_asset_refs : verified_receipt
    library_asset_refs ||--o{ task_library_refs : permission_recheck
    content_tasks ||--o{ task_library_refs : authorizes_use
    research_reports ||--o{ research_findings : findings
    research_reports ||--o{ research_report_evidence : scoped_access
    source_evidence ||--o{ research_report_evidence : shared_identity
    research_findings ||--o{ research_finding_evidence : supports
    source_evidence ||--o{ research_finding_evidence : cited
    topic_proposals ||--o{ topic_proposal_findings : grounded
    research_findings ||--o{ topic_proposal_findings : source
    topic_proposals ||--o{ proposal_dispatch_tasks : approved_dispatch
    content_tasks ||--o{ proposal_dispatch_tasks : dispatched_task
    file_objects ||--o{ file_versions : immutable_bytes_ref
    file_versions ||--o{ working_assets : current_file
    file_versions ||--o{ published_artifacts : retained_file
    users ||--o{ user_role_grants : roles
    user_role_grants ||--o{ role_brand_scopes : brand_scope
    budget_periods ||--o{ budget_reservations : reserves
'''
(OUT/'KEY_ENTITY_RELATIONSHIPS.mmd').write_text(ER,encoding='utf-8')
p=OUT/'PG02_TARGET_POSTGRESQL_SCHEMA.md';p.write_text(p.read_text(encoding='utf-8')+'\n## 关键实体关系图\n\n```mermaid\n'+ER+'```\n\n图中是关键链路子集；完整74表和所有外键以TABLE_CATALOG.json/SQL为准。外部Workspace资产不是本库实体的可级联FK；以外部ID和实时授权核验保持隔离。\n',encoding='utf-8')
(OUT/'JSON_TO_PG_MAPPING.md').write_text('# schema8集合与PostgreSQL映射\n\n'+maprows+'\nsettings/seq及临时字段规则见PG01；关系表/字段类型与外键见PG02和SQL。所有映射为计划，未执行导入。\n',encoding='utf-8')
source_files={}
for f in subprocess.check_output(['git','ls-tree','-r','--name-only','-z',BASE]).decode('utf-8').split('\0'):
 if not f:continue
 p=Path(f)
 source_files[f]=hashlib.sha256(p.read_bytes()).hexdigest()
phase2=json.loads(Path('TEST_EVIDENCE_PHASE2/ACCEPTANCE_SUMMARY.json').read_text(encoding='utf-8-sig'))
assert phase2['passedAssertionsAndCases']==990 and phase2['externalServices']=='NOT_VERIFIED'
# Static checks only: every referenced column and candidate key is defined in the generated text catalog.
def colnames(t):
 names={part.split()[0] for part in t['columns'].split('|')};names.update(['row_version','created_at','recorded_at','updated_at','created_by_ref','updated_by_ref','demo','legacy_extra'])
 if t['name']!='brands':names.add('id')
 if t['scope'] in ['brand','optional']:names.add('brand_code')
 return names
for c,cs,p,ps in fks:
 assert set(cs.split(','))<=colnames(by[c]),(c,cs)
 assert set(ps.split(','))<=colnames(by[p]),(p,ps)
 pk='code' if p=='brands' else 'id';keys={pk,*by[p]['unique']}
 if by[p]['scope'] in ['brand','optional']:keys.add('brand_code,id')
 assert ps in keys,(p,ps,keys)
for t in tables:
 for key in t['unique']:assert set(key.split(','))<=colnames(t),(t['name'],key)
 for key in t['indexes']:assert set(key.split(','))<=colnames(t),(t['name'],key)
assert len(re.findall(r'^CREATE TABLE mos\.',(OUT/'POSTGRESQL_SCHEMA_DRAFT.sql').read_text(encoding='utf-8'),re.M))==74
analysis={'baseline':BASE,'initialHeadVerified':BASE,'remoteBranchVerifiedAtStart':BASE,'initialStatus':'clean','arrayCollections':collections8,'persistedObjects':['settings','seq'],'storeConsumers':store_consumers,'literalRouteRegistrations':routes,'baseWorkingFileHashes':source_files,'phase2EvidenceSummary':phase2,'noApplicationCodeExecuted':True,'noDatabaseInstalledOrConnected':True,'noSQLExecuted':True,'noProductionDataReadOrModified':True}
(OUT/'SOURCE_ANALYSIS.json').write_text(json.dumps(analysis,ensure_ascii=False,indent=2),encoding='utf-8')
(OUT/'DESIGN_VALIDATION.json').write_text(json.dumps({'mode':'STATIC_DESIGN_ONLY','schemaCollectionsCovered':43,'targetTableCount':74,'groups':{'core':43,'relation':15,'ops':16},'foreignKeyDefinitions':len(fks),'foreignKeyColumnAndTargetKeyStaticChecks':'PASS','databaseSQLParsing':'NOT_EXECUTED','databaseConstraintsRLSMigrationRecoveryTests':'NOT_EXECUTED','liveServices':'NOT_CALLED','phase3A2':'NOT_AUTHORIZED'},indent=2),encoding='utf-8')
(OUT/'README.md').write_text('''# Phase 3A-1 PostgreSQL设计交付

阅读顺序：PG01→PG02（结合SQL/ER/字段目录）→PG03→PG04→PG05→PG06→PG07。

7份PG文档是主交付；POSTGRESQL_SCHEMA_DRAFT.sql是74表设计草案；TABLE_CATALOG.json为字段/约束目录；JSON_TO_PG_MAPPING.md、KEY_ENTITY_RELATIONSHIPS.mmd和TX01_TX10_MAPPING.md是映射/图/事务附件。SOURCE_ANALYSIS.json记录只读基线/文件摘要和静态路由清单；DESIGN_VALIDATION.json明确本轮只静态检查，未执行SQL或迁移。

本轮仅设计，不能将SQL草案直接当作生产migration。全局/nullable-brand授权、冻结/追加触发器及RLS真实测试等门禁见PG07。源码中新增发现的H05字段覆盖疑点仅记录，未改业务代码。

已验证基线7f05078614a789b94a040f67b18e462f2284f063；应用0.1.6/schema8保持。生产容量/真实数据质量/外部服务/PG性能与恢复结果未知。完成后等待人工批准，不自动进入Phase3A-2。

_build_design.py仅用Python标准库生成文档和SQL文本，读取受版本控制源码，无应用/SQL连接入口；不是迁移工具。运行它会覆盖本设计目录生成文件，应仅在审阅后用于重新生成。
''',encoding='utf-8')
print(json.dumps({'collections':43,'tables':74,'foreignKeys':len(fks),'documents':7,'sqlExecuted':False,'businessFilesRead':len(source_files)}))
