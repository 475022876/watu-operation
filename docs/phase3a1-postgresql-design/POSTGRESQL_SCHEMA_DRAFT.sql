-- PHASE 3A-1 DESIGN DRAFT ONLY. DO NOT EXECUTE. No database has validated this file.
-- Baseline 7f05078614a789b94a040f67b18e462f2284f063
-- Requires approved roles mos_owner / mos_app / mos_worker / mos_guard provisioned separately.
-- Missing production gates are enumerated in PG07; this is not an executable migration release.
CREATE SCHEMA mos;

-- core / source brands / PK取code；保持VFIB/UCARD，不推断其他品牌授权
CREATE TABLE mos.brands (
  code text PRIMARY KEY,
  name text NOT NULL,
  legacy_id text,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- core / source users / lower(username)唯一；密码散列/盐原样保留，明文和真实值不进入设计包
CREATE TABLE mos.users (
  id text PRIMARY KEY,
  username text NOT NULL,
  display_name text,
  status text NOT NULL,
  external_identity_id text,
  identity_source text,
  dept text,
  title text,
  password_hash text,
  password_salt text,
  must_change_password boolean,
  authz_epoch bigint NOT NULL DEFAULT 1,
  prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_login_at timestamptz,
  password_changed_at timestamptz,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- core / source user_roles / brandScope拆到role_brand_scopes；*映射all_brands而非伪造*品牌
CREATE TABLE mos.user_role_grants (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  role_code text NOT NULL,
  all_brands boolean NOT NULL DEFAULT false,
  granted_at timestamptz,
  revoked_at timestamptz,
  valid_until timestamptz,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- core / source sessions / 历史会话仅留原加密快照，目标会话表初始为空，切换重新登录，须人工批准
CREATE TABLE mos.auth_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  token_digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  ip inet,
  user_agent text,
  revoked_at timestamptz,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (token_digest)
);

-- core / source monthly_plans /
CREATE TABLE mos.monthly_plans (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  year integer NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  version integer NOT NULL CHECK (version > 0),
  code text NOT NULL,
  title text NOT NULL,
  owner_id text,
  supersedes_id text,
  status text NOT NULL,
  objectives jsonb,
  review_note text,
  approved_at timestamptz,
  approved_by_ref text,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,year,month,version),
  UNIQUE (brand_code,code)
);

-- core / source plan_items / 原行无brandCode，须从plan推导并与任务品牌一致
CREATE TABLE mos.plan_items (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  plan_id text NOT NULL,
  content_task_id text,
  title text NOT NULL,
  priority text,
  work_date date NOT NULL,
  ad_hoc boolean,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id)
);

-- core / source campaigns / Brief保留版本化结构快照，LIBRARY引用投影到campaign_library_refs
CREATE TABLE mos.campaigns (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  brief text,
  owner_id text,
  start_at timestamptz,
  end_at timestamptz,
  state text NOT NULL,
  marketing_brief jsonb,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,code)
);

-- core / source monthly_campaign_links / 无id行用集合+稳定自然键生成迁移ID，DTO不新增id字段
CREATE TABLE mos.monthly_campaign_links (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  plan_id text NOT NULL,
  campaign_id text NOT NULL,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,plan_id,campaign_id)
);

-- core / source master_topics /
CREATE TABLE mos.master_topics (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  title text NOT NULL,
  pillar_code text,
  narrative_code text,
  risk_grade text,
  evidence_status text,
  summary text,
  owner_id text,
  state text NOT NULL,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id)
);

-- core / source campaign_topic_links /
CREATE TABLE mos.campaign_topic_links (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  campaign_id text NOT NULL,
  topic_id text NOT NULL,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,campaign_id,topic_id)
);

-- core / source content_tasks /
CREATE TABLE mos.content_tasks (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  type text,
  platform text,
  pillar_code text,
  narrative_code text,
  risk_grade text,
  owner_id text,
  campaign_id text,
  topic_id text,
  parent_task_id text,
  status text NOT NULL,
  production_due date,
  review_due date,
  planned_publish_at_raw text,
  planned_publish_at_utc timestamptz,
  business_basis jsonb,
  deliverables jsonb,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (code)
);

-- core / source source_registry / 域名相同不当然重复，不添加未经验证的domain唯一约束
CREATE TABLE mos.source_registry (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  domain text NOT NULL,
  name text,
  tier text,
  method text,
  endpoint text,
  license_policy text,
  license_note text,
  allow_full_text boolean,
  retention_days integer,
  frequency text,
  retry_policy text,
  owner_id text,
  status text NOT NULL,
  last_ok_at timestamptz,
  next_run_at timestamptz,
  schedule_config jsonb,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id)
);

-- core / source source_items / URL和摘要原字节语义保留；URL以sha256辅助定位并比对原URL，避免超长URL的B-tree键大小风险；去重规则核对后才升级唯一键
CREATE TABLE mos.source_items (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  source_id text NOT NULL,
  canonical_url text NOT NULL,
  title text,
  summary text,
  full_text text,
  content_digest text,
  license_state text,
  published_at timestamptz,
  published_at_raw text,
  fetched_at timestamptz,
  ai_summary text,
  ai_summary_state text,
  fetch_metadata jsonb,
  raw_stored boolean NOT NULL DEFAULT false,
  canonical_url_hash text,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id)
);

-- core / source evidence_references / 从topic/version/sourceItem推导品牌，全部已知父级必须一致
CREATE TABLE mos.evidence_references (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  source_item_id text,
  topic_id text,
  content_version_id text,
  claim_locator text,
  verification_state text NOT NULL,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id)
);

-- core / source skill_versions /
CREATE TABLE mos.skill_versions (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  skill_code text NOT NULL,
  version text NOT NULL,
  checksum text,
  approval_ref text,
  state text NOT NULL,
  activated_at timestamptz,
  note text,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,skill_code,version)
);

-- core / source creative_templates / 生成记录templateVersionId的id@vN须解析并核对，不把它直接当FK
CREATE TABLE mos.creative_templates (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  skill_version_id text,
  template_code text NOT NULL,
  version integer NOT NULL,
  platform text,
  mode text,
  display text,
  label text,
  state text NOT NULL,
  aspects text[],
  config jsonb,
  note text,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,template_code,version)
);

-- core / source content_versions / 真正字段contentTaskId；不可用taskId映射；冻结正文、清单和素材版本须不可覆盖
CREATE TABLE mos.content_versions (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  content_task_id text NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  code text NOT NULL,
  title text,
  body text,
  format text,
  pillar_code text,
  narrative_code text,
  risk_grade text,
  locale text,
  state text NOT NULL,
  author_id text,
  supersedes_id text,
  superseded_by_id text,
  manifest_hash text,
  manifest_canonical_text text,
  manifest_payload jsonb,
  disclosures jsonb,
  approved_at timestamptz,
  approved_by_ref text,
  revise_reason text,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,content_task_id,number),
  UNIQUE (code),
  UNIQUE (brand_code,id,manifest_hash)
);

-- core / source review_cases / 三种审核类型保留；多态subject必须通过排他CHECK和强类型FK约束
CREATE TABLE mos.review_cases (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  type text NOT NULL,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  content_version_id text,
  asset_admission_id text,
  version_hash text NOT NULL,
  policy_version text NOT NULL,
  risk_grade text,
  state text NOT NULL,
  submitted_by text,
  submitted_at timestamptz,
  decided_by_ref text,
  decided_at timestamptz,
  requirements jsonb,
  note text,
  subject_snapshot jsonb,
  subject_canonical_text text,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,id,version_hash),
  UNIQUE (brand_code,id,content_version_id),
  UNIQUE (brand_code,id,asset_admission_id)
);

-- core / source review_decisions / 追加记录；主体与hash必须与所属case一致，历史actor缺失只保留actor_ref，不造账号
CREATE TABLE mos.review_decisions (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  case_id text NOT NULL,
  content_version_id text,
  asset_admission_id text,
  type text NOT NULL,
  version_hash text NOT NULL,
  actor_id text,
  actor_ref text,
  actor_name text,
  action text NOT NULL,
  previous_state text,
  acting_authority jsonb,
  remarks text,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id)
);

-- core / source working_assets / projectRef拆三条FK；正文二进制不进JSONB；校验objectKey/哈希后关联file_versions
CREATE TABLE mos.working_assets (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  file_version_id text,
  file_name text,
  mime text,
  bytes bigint CHECK (bytes >= 0),
  sha256 text,
  object_key_legacy text,
  owner_id text,
  task_id text,
  campaign_id text,
  topic_id text,
  generation_job_id text,
  origin text,
  license text,
  visibility text NOT NULL DEFAULT 'PRIVATE',
  mock boolean,
  prompt_snapshot jsonb,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id)
);

-- core / source generation_jobs / outputAssetIds拆表；referenceIds语义需逐项分类，不把任意字符串当素材FK
CREATE TABLE mos.generation_jobs (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  task_id text,
  kind text NOT NULL,
  data_class text NOT NULL,
  provider text,
  model_id text,
  skill_version_id text,
  template_id text,
  template_version_raw text,
  status text NOT NULL,
  provider_job_id text,
  prompt_snapshot jsonb,
  provider_usage jsonb,
  cost jsonb,
  qa_result jsonb,
  idempotency_key text,
  requested_by text,
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id)
);

-- core / source video_artifacts / 分镜拆行，关键帧拆关系；脚本字幕可保持有界有序文档
CREATE TABLE mos.video_artifacts (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  task_id text NOT NULL,
  video_type text,
  motion_code text,
  brief text,
  script jsonb,
  subtitles jsonb,
  final_asset_id text,
  state text NOT NULL,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,task_id)
);

-- core / source channels / 仍仅官方账号元数据，不引入社媒Token
CREATE TABLE mos.channels (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  platform text NOT NULL,
  handle text,
  url text,
  label text,
  state text NOT NULL,
  publish_mode text,
  owner_id text,
  last_verified_at timestamptz,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id)
);

-- core / source publishing_schedules / 原行含timezone（默认Asia/Shanghai），先按每行有效IANA区解析；缺失/歧义/无效时停入隔离，不从部署机器时区推断
CREATE TABLE mos.publishing_schedules (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  content_version_id text NOT NULL,
  channel_id text NOT NULL,
  planned_at_raw text NOT NULL,
  planned_at_local timestamp,
  planned_at_utc timestamptz,
  time_zone text,
  time_precision text,
  state text NOT NULL,
  manifest_hash text,
  operator_id text,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id)
);

-- core / source publication_records / 每排期是否仅一条正式回执，先核实历史，SQL草案不擅加唯一并丢弃重复
CREATE TABLE mos.publication_records (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  schedule_id text NOT NULL,
  content_version_id text NOT NULL,
  channel_id text NOT NULL,
  actual_at_raw text,
  actual_at_local timestamp,
  actual_at_utc timestamptz,
  time_zone text,
  time_precision text,
  url text,
  operator_id text,
  evidence_ref text,
  status text NOT NULL,
  text_hash text,
  manifest_hash text,
  approved_at timestamptz,
  approved_by_ref text,
  notes text,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id)
);

-- core / source published_artifacts / 保留独立不可变归档文件；不得改成对可变工作素材的快捷链接
CREATE TABLE mos.published_artifacts (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  publication_id text NOT NULL,
  file_version_id text,
  kind text NOT NULL,
  object_key_legacy text,
  sha256 text,
  bytes bigint,
  mime text,
  file_name text,
  manifest_hash text,
  immutable boolean NOT NULL DEFAULT true,
  preserved_at timestamptz,
  snapshot_metadata jsonb,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id)
);

-- core / source publication_corrections / 追加式更正；不改旧发布快照
CREATE TABLE mos.publication_corrections (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  publication_id text NOT NULL,
  kind text NOT NULL,
  reason text,
  replacement_publication_id text,
  previous_status text,
  actor_id text,
  before_snapshot jsonb,
  after_snapshot jsonb,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id)
);

-- core / source publication_metrics / 当前是一行一个metric/amount/asOf/sourceKind，保持标量；仅未来平台扩展用JSONB，不能改API形状
CREATE TABLE mos.publication_metrics (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  publication_id text NOT NULL,
  channel_id text,
  metric text NOT NULL,
  amount numeric(28,6) NOT NULL,
  source_kind text NOT NULL,
  as_of date NOT NULL,
  proof_ref text,
  platform_extensions jsonb,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id)
);

-- core / source asset_admissions / 最终批准、同步和可复用三个维度不合并；历史字段版本admissionFieldsSchema保留兼容余项
CREATE TABLE mos.asset_admissions (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  working_asset_id text NOT NULL,
  asset_sha256 text,
  origin_object_id text NOT NULL,
  origin_version_id text,
  category_code text,
  library_primary_category text,
  library_subcategory text,
  classification text,
  license_status text,
  reuse_scope text,
  ai_reuse_policy text,
  external_ai_transfer_policy text,
  state text NOT NULL,
  final_approval_status text NOT NULL,
  sync_status text NOT NULL,
  approval_mode text NOT NULL,
  library_id text,
  library_version text,
  idempotency_key text NOT NULL,
  submitted_by text,
  submitted_at timestamptz,
  decided_by_ref text,
  decided_at timestamptz,
  submission_metadata jsonb,
  precheck jsonb,
  receipt jsonb,
  manual_review_reasons jsonb,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id)
);

-- core / source library_asset_refs / 外部libraryId不是MOS主键；不以数据库缓存代替Workspace权威
CREATE TABLE mos.library_asset_refs (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  admission_id text,
  working_asset_id text,
  library_id text,
  library_version text,
  permission_valid boolean NOT NULL DEFAULT false,
  permission_scope text[],
  asset_state text,
  state text,
  mock boolean,
  source_kind text,
  source_ref text,
  source_digest text,
  last_verified_at timestamptz,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id)
);

-- core / source ingest_jobs / 有效dedupeKey局部唯一需核对重试是否复用同键，不能直接锁死历史重试
CREATE TABLE mos.ingest_jobs (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  source_id text NOT NULL,
  trigger text,
  status text NOT NULL,
  dedupe_key text,
  attempt integer,
  started_at timestamptz,
  finished_at timestamptz,
  next_run_at timestamptz,
  failure_code text,
  retryable boolean,
  counts jsonb,
  lease_owner text,
  lease_until timestamptz,
  lease_token bigint NOT NULL DEFAULT 0,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id)
);

-- core / source research_reports / brandScope[0]为现有可访问品牌；有序完整scope子表不自动扩权
CREATE TABLE mos.research_reports (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  code text NOT NULL,
  requester_id text,
  mode text,
  query text,
  title text,
  objective text,
  status text NOT NULL,
  completion text,
  job_id text,
  executive_summary text,
  industry_implications text,
  vfib_relevance text,
  time_window jsonb,
  period jsonb,
  sources_snapshot jsonb,
  editorial_opportunities jsonb,
  unresolved_claims jsonb,
  model_run jsonb,
  cost jsonb,
  refresh_state text,
  conflict_detection text,
  reverify_due jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (code)
);

-- core / source research_findings / evidenceIds拆关系；FACT无有效证据不得升级VERIFIED
CREATE TABLE mos.research_findings (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  report_id text NOT NULL,
  ordinal integer,
  statement text,
  kind text NOT NULL,
  verification_state text NOT NULL,
  source_item_id text,
  as_of_raw text,
  conflict_note text,
  origin text,
  needs_verification boolean,
  confidence_rationale text,
  notes jsonb,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,id,report_id)
);

-- core / source source_evidence / 原对象无品牌且可被多报告引用，单份对象保留全局id；访问必须经report_evidence的已授权报告，不能作为公开全局表
CREATE TABLE mos.source_evidence (
  id text PRIMARY KEY,
  url text NOT NULL,
  final_url text,
  source_id text,
  title text,
  source_name text,
  published_at timestamptz,
  published_at_raw text,
  retrieved_at timestamptz,
  quote text,
  excerpt text,
  content_hash text,
  access_state text,
  license_state text,
  availability text,
  http_status integer,
  provider text,
  provider_rank integer,
  redirect_chain jsonb,
  retrieval_metadata jsonb,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- core / source topic_proposals / sourceFindingIds拆表；dispatch快照保留用于精确幂等重放
CREATE TABLE mos.topic_proposals (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  code text NOT NULL,
  report_id text,
  report_version bigint,
  suggested_title_en text,
  summary_zh text,
  angle text,
  primary_category text,
  risk_grade text,
  status text NOT NULL,
  source text,
  ai_generated boolean,
  needs_verification boolean,
  created_by_id text,
  reviewer_id text,
  reviewed_at timestamptz,
  review_comments text,
  revision integer,
  topic_id text,
  dispatch_snapshot jsonb,
  fact_check_needs jsonb,
  recommendation jsonb,
  edit_diff jsonb,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (code)
);

-- core / source research_jobs /
CREATE TABLE mos.research_jobs (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  code text NOT NULL,
  report_id text,
  kind text,
  actor_id text,
  query text,
  status text NOT NULL,
  stage text,
  progress integer CHECK (progress BETWEEN 0 AND 100),
  provider text,
  provider_trace_id text,
  idempotency_key text,
  payload_hash text,
  attempts integer,
  cancel_requested boolean,
  filters jsonb,
  budget_snapshot jsonb,
  log jsonb,
  error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  lease_owner text,
  lease_until timestamptz,
  lease_token bigint NOT NULL DEFAULT 0,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (code)
);

-- core / source provider_calls / NULL费用与0严格区分；管理探针允许全局brandNULL，仅管理员可见；追加事实，不凭估价记实付
CREATE TABLE mos.provider_calls (
  id text PRIMARY KEY,
  brand_code text,
  kind text NOT NULL,
  op text,
  provider text,
  model text,
  state text NOT NULL,
  error_code text,
  http_status integer,
  latency_ms bigint,
  attempts integer,
  actor_id text,
  request_id text,
  invocation_key text,
  confirmed_amount numeric(20,6),
  currency text,
  cost_confirmed boolean NOT NULL DEFAULT false,
  prompt_tokens bigint,
  completion_tokens bigint,
  total_tokens bigint,
  note text,
  receipt_metadata jsonb,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id)
);

-- core / source video_render_jobs /
CREATE TABLE mos.video_render_jobs (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  task_id text NOT NULL,
  actor_id text,
  status text NOT NULL,
  status_raw text,
  progress integer,
  provider text,
  model text,
  provider_job_id text,
  prompt text,
  duration_sec numeric,
  size text,
  file_version_id text,
  file_path_legacy text,
  bytes bigint,
  error_code text,
  note text,
  lease_owner text,
  lease_until timestamptz,
  lease_token bigint NOT NULL DEFAULT 0,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id)
);

-- core / source library_tickets / 源集合只有票据元数据；真实ticket在进程Map，不新增明文ticket列；迁移后过期/重新换取
CREATE TABLE mos.library_ticket_cache (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  ticket_key text NOT NULL,
  key_id text NOT NULL,
  provider_user_id text NOT NULL,
  scopes text[],
  issued_at timestamptz,
  expires_at timestamptz,
  status text,
  purpose text,
  refresh_count integer,
  stripped_scopes text[],
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (ticket_key)
);

-- core / source library_event_cursors / brandId转brand_code；processedSeqs投影到inbox元数据，不凭空重放外部事件
CREATE TABLE mos.library_event_cursors (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  cursor_value bigint NOT NULL DEFAULT 0,
  next_cursor bigint,
  last_seq bigint,
  truncated_count integer,
  degraded boolean,
  reconcile_required boolean,
  last_poll_at timestamptz,
  last_event_at timestamptz,
  consumer_state jsonb,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code)
);

-- core / source library_invalidations / 旧key仅kind+targetId且可无brand；缺品牌保守全局失效，不能静默缩小撤权范围
CREATE TABLE mos.library_invalidations (
  id text PRIMARY KEY,
  brand_code text,
  kind text NOT NULL,
  target_id text NOT NULL,
  at timestamptz,
  seq bigint,
  detail jsonb,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE NULLS NOT DISTINCT (brand_code,kind,target_id)
);

-- core / source library_admission_jobs / 同一准入申请稳定远程幂等键及多步回执，禁止重新生成键后盲重试
CREATE TABLE mos.library_admission_jobs (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  admission_id text NOT NULL,
  idempotency_key text NOT NULL,
  provider_admission_id text,
  status text NOT NULL,
  attempts integer,
  next_retry_at timestamptz,
  last_error_code text,
  request_snapshot jsonb,
  response_snapshot jsonb,
  lease_owner text,
  lease_until timestamptz,
  lease_token bigint NOT NULL DEFAULT 0,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,admission_id)
);

-- core / source audit_events / 原timestamp保留，所有现存事件逐条迁移；不伪造已被旧20000条上限淘汰的历史
CREATE TABLE mos.audit_events (
  id text PRIMARY KEY,
  brand_code text,
  actor_user_id text,
  actor_ref text,
  event_type text NOT NULL,
  object_type text,
  object_id text,
  old_state jsonb,
  new_state jsonb,
  correlation_id text,
  outcome text,
  ip_raw text,
  metadata jsonb,
  occurred_at timestamptz,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id)
);

-- relation / source None / brandScope数组逐项保留，*不在本表
CREATE TABLE mos.role_brand_scopes (
  id text PRIMARY KEY,
  grant_id text NOT NULL,
  scope_brand_code text NOT NULL,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (grant_id,scope_brand_code)
);

-- relation / source None / 任务显式资料引用
CREATE TABLE mos.task_library_refs (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  task_id text NOT NULL,
  library_ref_id text NOT NULL,
  ordinal integer NOT NULL,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,task_id,library_ref_id)
);

-- relation / source None / 冻结后固定文件版本及hash
CREATE TABLE mos.content_version_assets (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  content_version_id text NOT NULL,
  asset_id text NOT NULL,
  file_version_id text,
  ordinal integer NOT NULL,
  asset_sha256 text,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,content_version_id,asset_id)
);

-- relation / source None / 有序渠道引用
CREATE TABLE mos.content_version_channels (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  content_version_id text NOT NULL,
  channel_id text NOT NULL,
  ordinal integer NOT NULL,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,content_version_id,channel_id)
);

-- relation / source None / 有序证据引用
CREATE TABLE mos.content_version_evidence (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  content_version_id text NOT NULL,
  evidence_reference_id text NOT NULL,
  ordinal integer NOT NULL,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,content_version_id,evidence_reference_id)
);

-- relation / source None / 输出不可丢关联
CREATE TABLE mos.generation_job_outputs (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  job_id text NOT NULL,
  asset_id text NOT NULL,
  ordinal integer NOT NULL,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,job_id,asset_id)
);

-- relation / source None / 资产FK独立列；镜头描述结构JSONB
CREATE TABLE mos.video_storyboard_shots (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  video_artifact_id text NOT NULL,
  ordinal integer NOT NULL,
  duration_sec numeric,
  asset_id text,
  shot_document jsonb NOT NULL,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,video_artifact_id,ordinal)
);

-- relation / source None / 须属于该报告获授权的证据集合
CREATE TABLE mos.research_finding_evidence (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  finding_id text NOT NULL,
  report_id text NOT NULL,
  evidence_id text NOT NULL,
  ordinal integer NOT NULL,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,finding_id,evidence_id)
);

-- relation / source None / 不允许跨品牌引用发现
CREATE TABLE mos.topic_proposal_findings (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  proposal_id text NOT NULL,
  finding_id text NOT NULL,
  ordinal integer NOT NULL,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,proposal_id,finding_id)
);

-- relation / source None / 从dispatch.taskIds/planItemIds成对恢复，不依赖数组按时间排序
CREATE TABLE mos.proposal_dispatch_tasks (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  proposal_id text NOT NULL,
  task_id text NOT NULL,
  plan_item_id text,
  ordinal integer NOT NULL,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,proposal_id,task_id)
);

-- relation / source None / 内嵌history全部追加恢复
CREATE TABLE mos.asset_admission_history (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  admission_id text NOT NULL,
  ordinal integer NOT NULL,
  event_at timestamptz,
  actor_id text,
  event_type text,
  event_document jsonb,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,admission_id,ordinal)
);

-- relation / source None / 完整保存scope列表；本期仅主品牌可读
CREATE TABLE mos.research_report_brands (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  report_id text NOT NULL,
  visible_brand_code text NOT NULL,
  ordinal integer NOT NULL,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,report_id,ordinal)
);

-- relation / source None / 关键帧有序FK，不把ID留JSONB
CREATE TABLE mos.video_keyframe_assets (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  video_artifact_id text NOT NULL,
  asset_id text NOT NULL,
  ordinal integer NOT NULL,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,video_artifact_id,ordinal)
);

-- relation / source None / Brief源kind为LIBRARY才抽取，JSONB快照保持原样
CREATE TABLE mos.campaign_library_refs (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  campaign_id text NOT NULL,
  library_ref_id text NOT NULL,
  claim_path text NOT NULL,
  ordinal integer NOT NULL,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,campaign_id,claim_path,ordinal)
);

-- relation / source None / 从report.evidenceIds、finding.evidenceIds及sources引用并集确定，保留原列表顺序元数据
CREATE TABLE mos.research_report_evidence (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  report_id text NOT NULL,
  evidence_id text NOT NULL,
  ordinal integer NOT NULL,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,report_id,evidence_id)
);

-- ops / source None / 仅元数据，不搬文件；桶/后端命名空间属于存储身份
CREATE TABLE mos.file_objects (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  storage_backend text NOT NULL,
  bucket_ref text,
  object_key text NOT NULL,
  legacy_path text,
  state text NOT NULL,
  owner_id text,
  visibility text,
  retention_until timestamptz,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE NULLS NOT DISTINCT (brand_code,storage_backend,bucket_ref,object_key)
);

-- ops / source None / 文件内容哈希，不以ETag代替SHA256
CREATE TABLE mos.file_versions (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  object_id text NOT NULL,
  version_no integer NOT NULL,
  storage_version text,
  sha256 text NOT NULL,
  byte_length bigint NOT NULL CHECK (byte_length >= 0),
  mime text,
  upload_state text NOT NULL,
  verified_at timestamptz,
  immutable boolean NOT NULL DEFAULT false,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,object_id,version_no)
);

-- ops / source None / 暂存、校验、READY提交与孤儿对账
CREATE TABLE mos.upload_sessions (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  object_id text NOT NULL,
  file_version_id text,
  expected_sha256 text,
  expected_bytes bigint,
  status text NOT NULL,
  expires_at timestamptz,
  owner_id text,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id)
);

-- ops / source None / 现有全局配置及env>DB>file优先级保留；凭据不放自由JSONB
CREATE TABLE mos.provider_configs (
  id text PRIMARY KEY,
  kind text NOT NULL,
  mode text NOT NULL,
  base_url text,
  model text,
  timeout_ms integer,
  retry_limit integer,
  secret_ref text,
  secret_ciphertext text,
  secret_key_id text,
  nonsecret_options jsonb,
  last_test_at timestamptz,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (kind)
);

-- ops / source None / 全局默认及品牌策略模板，0含义须按原接口保留
CREATE TABLE mos.provider_budget_policies (
  id text PRIMARY KEY,
  scope_key text NOT NULL,
  kind text NOT NULL,
  brand_monthly_usd numeric(20,6),
  per_job_usd_max numeric(20,6),
  budget_timezone text,
  effective_at timestamptz,
  policy_document jsonb,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (scope_key,kind)
);

-- ops / source None / 锁定行防并发超预算，费用未知不能当零
CREATE TABLE mos.budget_periods (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  policy_id text NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  confirmed_usd numeric(20,6) NOT NULL DEFAULT 0,
  reserved_usd numeric(20,6) NOT NULL DEFAULT 0,
  unknown_usd numeric(20,6) NOT NULL DEFAULT 0,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,policy_id,period_start)
);

-- ops / source None / 超时不自动释放结果未知的预留
CREATE TABLE mos.budget_reservations (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  period_id text NOT NULL,
  invocation_key text NOT NULL,
  amount_usd numeric(20,6) NOT NULL CHECK (amount_usd >= 0),
  status text NOT NULL,
  receipt_key text,
  expires_at timestamptz,
  job_ref text,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,invocation_key)
);

-- ops / source None / 事务内排队，事务外出站；无原始Token/正文自由日志
CREATE TABLE mos.outbox_events (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  dedupe_key text NOT NULL,
  actor_id text,
  actor_authz_epoch bigint,
  payload jsonb NOT NULL,
  status text NOT NULL,
  available_at timestamptz NOT NULL,
  lease_owner text,
  lease_until timestamptz,
  lease_token bigint NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  last_error_code text,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,dedupe_key)
);

-- ops / source None / 与游标和撤权变更同一事务提交
CREATE TABLE mos.inbox_events (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  provider text NOT NULL,
  event_key text NOT NULL,
  stream_key text NOT NULL,
  provider_seq bigint,
  received_at timestamptz,
  processed_at timestamptz,
  status text NOT NULL,
  sanitized_payload jsonb,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,provider,stream_key,event_key)
);

-- ops / source None / H01作用域和标准化算法保持；同键不同digest返回409
CREATE TABLE mos.idempotency_requests (
  id text PRIMARY KEY,
  brand_code text NOT NULL,
  actor_id text NOT NULL,
  operation text NOT NULL,
  proposal_id text,
  resource_key text NOT NULL,
  idempotency_key text NOT NULL,
  normalized_digest text NOT NULL,
  response_snapshot jsonb,
  state text NOT NULL,
  completed_at timestamptz,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (brand_code,id),
  UNIQUE (brand_code,actor_id,operation,resource_key,idempotency_key)
);

-- ops / source None / 只设计；无迁移执行
CREATE TABLE mos.migration_runs (
  id text PRIMARY KEY,
  source_sha256 text NOT NULL,
  source_schema integer NOT NULL,
  mapping_version text NOT NULL,
  tool_commit text NOT NULL,
  status text NOT NULL,
  counts jsonb,
  file_manifest_sha256 text,
  approved_by_ref text,
  approved_at timestamptz,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (source_sha256,mapping_version)
);

-- ops / source None / 完整原文仅在加密只读源快照，拒绝表不复制密钥/资料正文
CREATE TABLE mos.migration_rejections (
  id text PRIMARY KEY,
  run_id text NOT NULL,
  source_collection text NOT NULL,
  source_key text NOT NULL,
  source_ordinal bigint,
  reason_code text NOT NULL,
  source_record_hash text NOT NULL,
  resolution_ref text,
  sanitized_detail jsonb,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- ops / source None / 仅白名单有界配置；不把全部mos.json或预算账本放此表
CREATE TABLE mos.system_settings (
  id text PRIMARY KEY,
  setting_key text NOT NULL,
  schema_version integer NOT NULL,
  value jsonb NOT NULL,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (setting_key)
);

-- ops / source None / 从seq各键及现存业务编码最大值校验后恢复，不回退重用编号
CREATE TABLE mos.code_counters (
  id text PRIMARY KEY,
  counter_key text NOT NULL,
  last_value bigint NOT NULL CHECK (last_value >= 0),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (counter_key)
);

-- ops / source None / 由现有dict受控导入，不扩大角色权能
CREATE TABLE mos.role_definitions (
  id text PRIMARY KEY,
  role_code text NOT NULL,
  label text,
  kind text,
  policy_version text NOT NULL,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (role_code)
);

-- ops / source None / 与代码RBAC策略版本一致，防数据库与字典双权威漂移
CREATE TABLE mos.role_permissions (
  id text PRIMARY KEY,
  role_code text NOT NULL,
  permission_code text NOT NULL,
  policy_version text NOT NULL,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  created_by_ref text,
  updated_by_ref text,
  demo boolean NOT NULL DEFAULT false,
  legacy_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (role_code,permission_code)
);
ALTER TABLE mos.monthly_plans ADD CONSTRAINT fk_001 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.plan_items ADD CONSTRAINT fk_002 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.campaigns ADD CONSTRAINT fk_003 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.monthly_campaign_links ADD CONSTRAINT fk_004 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.master_topics ADD CONSTRAINT fk_005 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.campaign_topic_links ADD CONSTRAINT fk_006 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.content_tasks ADD CONSTRAINT fk_007 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.source_registry ADD CONSTRAINT fk_008 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.source_items ADD CONSTRAINT fk_009 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.evidence_references ADD CONSTRAINT fk_010 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.skill_versions ADD CONSTRAINT fk_011 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.creative_templates ADD CONSTRAINT fk_012 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.content_versions ADD CONSTRAINT fk_013 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.review_cases ADD CONSTRAINT fk_014 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.review_decisions ADD CONSTRAINT fk_015 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.working_assets ADD CONSTRAINT fk_016 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.generation_jobs ADD CONSTRAINT fk_017 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.video_artifacts ADD CONSTRAINT fk_018 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.channels ADD CONSTRAINT fk_019 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.publishing_schedules ADD CONSTRAINT fk_020 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.publication_records ADD CONSTRAINT fk_021 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.published_artifacts ADD CONSTRAINT fk_022 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.publication_corrections ADD CONSTRAINT fk_023 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.publication_metrics ADD CONSTRAINT fk_024 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.asset_admissions ADD CONSTRAINT fk_025 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.library_asset_refs ADD CONSTRAINT fk_026 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.ingest_jobs ADD CONSTRAINT fk_027 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.research_reports ADD CONSTRAINT fk_028 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.research_findings ADD CONSTRAINT fk_029 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.topic_proposals ADD CONSTRAINT fk_030 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.research_jobs ADD CONSTRAINT fk_031 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.provider_calls ADD CONSTRAINT fk_032 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.video_render_jobs ADD CONSTRAINT fk_033 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.library_ticket_cache ADD CONSTRAINT fk_034 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.library_event_cursors ADD CONSTRAINT fk_035 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.library_invalidations ADD CONSTRAINT fk_036 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.library_admission_jobs ADD CONSTRAINT fk_037 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.audit_events ADD CONSTRAINT fk_038 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.task_library_refs ADD CONSTRAINT fk_039 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.content_version_assets ADD CONSTRAINT fk_040 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.content_version_channels ADD CONSTRAINT fk_041 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.content_version_evidence ADD CONSTRAINT fk_042 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.generation_job_outputs ADD CONSTRAINT fk_043 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.video_storyboard_shots ADD CONSTRAINT fk_044 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.research_finding_evidence ADD CONSTRAINT fk_045 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.topic_proposal_findings ADD CONSTRAINT fk_046 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.proposal_dispatch_tasks ADD CONSTRAINT fk_047 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.asset_admission_history ADD CONSTRAINT fk_048 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.research_report_brands ADD CONSTRAINT fk_049 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.video_keyframe_assets ADD CONSTRAINT fk_050 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.campaign_library_refs ADD CONSTRAINT fk_051 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.research_report_evidence ADD CONSTRAINT fk_052 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.file_objects ADD CONSTRAINT fk_053 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.file_versions ADD CONSTRAINT fk_054 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.upload_sessions ADD CONSTRAINT fk_055 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.budget_periods ADD CONSTRAINT fk_056 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.budget_reservations ADD CONSTRAINT fk_057 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.outbox_events ADD CONSTRAINT fk_058 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.inbox_events ADD CONSTRAINT fk_059 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.idempotency_requests ADD CONSTRAINT fk_060 FOREIGN KEY (brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.user_role_grants ADD CONSTRAINT fk_061 FOREIGN KEY (user_id) REFERENCES mos.users (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.auth_sessions ADD CONSTRAINT fk_062 FOREIGN KEY (user_id) REFERENCES mos.users (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.monthly_plans ADD CONSTRAINT fk_063 FOREIGN KEY (owner_id) REFERENCES mos.users (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.campaigns ADD CONSTRAINT fk_064 FOREIGN KEY (owner_id) REFERENCES mos.users (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.master_topics ADD CONSTRAINT fk_065 FOREIGN KEY (owner_id) REFERENCES mos.users (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.content_tasks ADD CONSTRAINT fk_066 FOREIGN KEY (owner_id) REFERENCES mos.users (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.source_registry ADD CONSTRAINT fk_067 FOREIGN KEY (owner_id) REFERENCES mos.users (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.content_versions ADD CONSTRAINT fk_068 FOREIGN KEY (author_id) REFERENCES mos.users (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.working_assets ADD CONSTRAINT fk_069 FOREIGN KEY (owner_id) REFERENCES mos.users (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.generation_jobs ADD CONSTRAINT fk_070 FOREIGN KEY (requested_by) REFERENCES mos.users (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.channels ADD CONSTRAINT fk_071 FOREIGN KEY (owner_id) REFERENCES mos.users (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.research_reports ADD CONSTRAINT fk_072 FOREIGN KEY (requester_id) REFERENCES mos.users (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.topic_proposals ADD CONSTRAINT fk_073 FOREIGN KEY (created_by_id) REFERENCES mos.users (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.research_jobs ADD CONSTRAINT fk_074 FOREIGN KEY (actor_id) REFERENCES mos.users (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.video_render_jobs ADD CONSTRAINT fk_075 FOREIGN KEY (actor_id) REFERENCES mos.users (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.review_decisions ADD CONSTRAINT fk_076 FOREIGN KEY (actor_id) REFERENCES mos.users (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.asset_admission_history ADD CONSTRAINT fk_077 FOREIGN KEY (actor_id) REFERENCES mos.users (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.audit_events ADD CONSTRAINT fk_078 FOREIGN KEY (actor_user_id) REFERENCES mos.users (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.user_role_grants ADD CONSTRAINT fk_079 FOREIGN KEY (role_code) REFERENCES mos.role_definitions (role_code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.role_permissions ADD CONSTRAINT fk_080 FOREIGN KEY (role_code) REFERENCES mos.role_definitions (role_code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.monthly_plans ADD CONSTRAINT fk_081 FOREIGN KEY (brand_code,supersedes_id) REFERENCES mos.monthly_plans (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.plan_items ADD CONSTRAINT fk_082 FOREIGN KEY (brand_code,plan_id) REFERENCES mos.monthly_plans (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.plan_items ADD CONSTRAINT fk_083 FOREIGN KEY (brand_code,content_task_id) REFERENCES mos.content_tasks (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.monthly_campaign_links ADD CONSTRAINT fk_084 FOREIGN KEY (brand_code,plan_id) REFERENCES mos.monthly_plans (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.monthly_campaign_links ADD CONSTRAINT fk_085 FOREIGN KEY (brand_code,campaign_id) REFERENCES mos.campaigns (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.campaign_topic_links ADD CONSTRAINT fk_086 FOREIGN KEY (brand_code,campaign_id) REFERENCES mos.campaigns (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.campaign_topic_links ADD CONSTRAINT fk_087 FOREIGN KEY (brand_code,topic_id) REFERENCES mos.master_topics (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.content_tasks ADD CONSTRAINT fk_088 FOREIGN KEY (brand_code,campaign_id) REFERENCES mos.campaigns (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.content_tasks ADD CONSTRAINT fk_089 FOREIGN KEY (brand_code,topic_id) REFERENCES mos.master_topics (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.content_tasks ADD CONSTRAINT fk_090 FOREIGN KEY (brand_code,parent_task_id) REFERENCES mos.content_tasks (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.source_items ADD CONSTRAINT fk_091 FOREIGN KEY (brand_code,source_id) REFERENCES mos.source_registry (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.evidence_references ADD CONSTRAINT fk_092 FOREIGN KEY (brand_code,source_item_id) REFERENCES mos.source_items (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.evidence_references ADD CONSTRAINT fk_093 FOREIGN KEY (brand_code,topic_id) REFERENCES mos.master_topics (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.evidence_references ADD CONSTRAINT fk_094 FOREIGN KEY (brand_code,content_version_id) REFERENCES mos.content_versions (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.creative_templates ADD CONSTRAINT fk_095 FOREIGN KEY (brand_code,skill_version_id) REFERENCES mos.skill_versions (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.content_versions ADD CONSTRAINT fk_096 FOREIGN KEY (brand_code,content_task_id) REFERENCES mos.content_tasks (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.content_versions ADD CONSTRAINT fk_097 FOREIGN KEY (brand_code,supersedes_id) REFERENCES mos.content_versions (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.content_versions ADD CONSTRAINT fk_098 FOREIGN KEY (brand_code,superseded_by_id) REFERENCES mos.content_versions (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.review_cases ADD CONSTRAINT fk_099 FOREIGN KEY (brand_code,content_version_id) REFERENCES mos.content_versions (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.review_cases ADD CONSTRAINT fk_100 FOREIGN KEY (brand_code,asset_admission_id) REFERENCES mos.asset_admissions (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.review_decisions ADD CONSTRAINT fk_101 FOREIGN KEY (brand_code,case_id) REFERENCES mos.review_cases (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.working_assets ADD CONSTRAINT fk_102 FOREIGN KEY (brand_code,task_id) REFERENCES mos.content_tasks (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.working_assets ADD CONSTRAINT fk_103 FOREIGN KEY (brand_code,campaign_id) REFERENCES mos.campaigns (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.working_assets ADD CONSTRAINT fk_104 FOREIGN KEY (brand_code,topic_id) REFERENCES mos.master_topics (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.working_assets ADD CONSTRAINT fk_105 FOREIGN KEY (brand_code,generation_job_id) REFERENCES mos.generation_jobs (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.working_assets ADD CONSTRAINT fk_106 FOREIGN KEY (brand_code,file_version_id) REFERENCES mos.file_versions (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.generation_jobs ADD CONSTRAINT fk_107 FOREIGN KEY (brand_code,task_id) REFERENCES mos.content_tasks (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.generation_jobs ADD CONSTRAINT fk_108 FOREIGN KEY (brand_code,skill_version_id) REFERENCES mos.skill_versions (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.generation_jobs ADD CONSTRAINT fk_109 FOREIGN KEY (brand_code,template_id) REFERENCES mos.creative_templates (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.video_artifacts ADD CONSTRAINT fk_110 FOREIGN KEY (brand_code,task_id) REFERENCES mos.content_tasks (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.video_artifacts ADD CONSTRAINT fk_111 FOREIGN KEY (brand_code,final_asset_id) REFERENCES mos.working_assets (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.publishing_schedules ADD CONSTRAINT fk_112 FOREIGN KEY (brand_code,content_version_id) REFERENCES mos.content_versions (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.publishing_schedules ADD CONSTRAINT fk_113 FOREIGN KEY (brand_code,channel_id) REFERENCES mos.channels (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.publication_records ADD CONSTRAINT fk_114 FOREIGN KEY (brand_code,schedule_id) REFERENCES mos.publishing_schedules (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.publication_records ADD CONSTRAINT fk_115 FOREIGN KEY (brand_code,content_version_id) REFERENCES mos.content_versions (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.publication_records ADD CONSTRAINT fk_116 FOREIGN KEY (brand_code,channel_id) REFERENCES mos.channels (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.published_artifacts ADD CONSTRAINT fk_117 FOREIGN KEY (brand_code,publication_id) REFERENCES mos.publication_records (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.published_artifacts ADD CONSTRAINT fk_118 FOREIGN KEY (brand_code,file_version_id) REFERENCES mos.file_versions (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.publication_corrections ADD CONSTRAINT fk_119 FOREIGN KEY (brand_code,publication_id) REFERENCES mos.publication_records (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.publication_corrections ADD CONSTRAINT fk_120 FOREIGN KEY (brand_code,replacement_publication_id) REFERENCES mos.publication_records (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.publication_metrics ADD CONSTRAINT fk_121 FOREIGN KEY (brand_code,publication_id) REFERENCES mos.publication_records (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.publication_metrics ADD CONSTRAINT fk_122 FOREIGN KEY (brand_code,channel_id) REFERENCES mos.channels (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.asset_admissions ADD CONSTRAINT fk_123 FOREIGN KEY (brand_code,working_asset_id) REFERENCES mos.working_assets (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.library_asset_refs ADD CONSTRAINT fk_124 FOREIGN KEY (brand_code,admission_id) REFERENCES mos.asset_admissions (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.library_asset_refs ADD CONSTRAINT fk_125 FOREIGN KEY (brand_code,working_asset_id) REFERENCES mos.working_assets (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.ingest_jobs ADD CONSTRAINT fk_126 FOREIGN KEY (brand_code,source_id) REFERENCES mos.source_registry (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.research_reports ADD CONSTRAINT fk_127 FOREIGN KEY (brand_code,job_id) REFERENCES mos.research_jobs (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.research_jobs ADD CONSTRAINT fk_128 FOREIGN KEY (brand_code,report_id) REFERENCES mos.research_reports (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.research_findings ADD CONSTRAINT fk_129 FOREIGN KEY (brand_code,report_id) REFERENCES mos.research_reports (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.research_findings ADD CONSTRAINT fk_130 FOREIGN KEY (brand_code,source_item_id) REFERENCES mos.source_items (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.topic_proposals ADD CONSTRAINT fk_131 FOREIGN KEY (brand_code,report_id) REFERENCES mos.research_reports (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.topic_proposals ADD CONSTRAINT fk_132 FOREIGN KEY (brand_code,topic_id) REFERENCES mos.master_topics (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.video_render_jobs ADD CONSTRAINT fk_133 FOREIGN KEY (brand_code,task_id) REFERENCES mos.content_tasks (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.video_render_jobs ADD CONSTRAINT fk_134 FOREIGN KEY (brand_code,file_version_id) REFERENCES mos.file_versions (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.library_admission_jobs ADD CONSTRAINT fk_135 FOREIGN KEY (brand_code,admission_id) REFERENCES mos.asset_admissions (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.role_brand_scopes ADD CONSTRAINT fk_136 FOREIGN KEY (grant_id) REFERENCES mos.user_role_grants (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.task_library_refs ADD CONSTRAINT fk_137 FOREIGN KEY (brand_code,task_id) REFERENCES mos.content_tasks (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.task_library_refs ADD CONSTRAINT fk_138 FOREIGN KEY (brand_code,library_ref_id) REFERENCES mos.library_asset_refs (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.content_version_assets ADD CONSTRAINT fk_139 FOREIGN KEY (brand_code,content_version_id) REFERENCES mos.content_versions (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.content_version_assets ADD CONSTRAINT fk_140 FOREIGN KEY (brand_code,asset_id) REFERENCES mos.working_assets (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.content_version_assets ADD CONSTRAINT fk_141 FOREIGN KEY (brand_code,file_version_id) REFERENCES mos.file_versions (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.content_version_channels ADD CONSTRAINT fk_142 FOREIGN KEY (brand_code,content_version_id) REFERENCES mos.content_versions (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.content_version_channels ADD CONSTRAINT fk_143 FOREIGN KEY (brand_code,channel_id) REFERENCES mos.channels (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.content_version_evidence ADD CONSTRAINT fk_144 FOREIGN KEY (brand_code,content_version_id) REFERENCES mos.content_versions (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.content_version_evidence ADD CONSTRAINT fk_145 FOREIGN KEY (brand_code,evidence_reference_id) REFERENCES mos.evidence_references (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.generation_job_outputs ADD CONSTRAINT fk_146 FOREIGN KEY (brand_code,job_id) REFERENCES mos.generation_jobs (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.generation_job_outputs ADD CONSTRAINT fk_147 FOREIGN KEY (brand_code,asset_id) REFERENCES mos.working_assets (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.video_storyboard_shots ADD CONSTRAINT fk_148 FOREIGN KEY (brand_code,video_artifact_id) REFERENCES mos.video_artifacts (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.video_storyboard_shots ADD CONSTRAINT fk_149 FOREIGN KEY (brand_code,asset_id) REFERENCES mos.working_assets (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.research_finding_evidence ADD CONSTRAINT fk_150 FOREIGN KEY (brand_code,finding_id) REFERENCES mos.research_findings (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.research_finding_evidence ADD CONSTRAINT fk_151 FOREIGN KEY (brand_code,report_id) REFERENCES mos.research_reports (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.research_finding_evidence ADD CONSTRAINT fk_152 FOREIGN KEY (evidence_id) REFERENCES mos.source_evidence (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.topic_proposal_findings ADD CONSTRAINT fk_153 FOREIGN KEY (brand_code,proposal_id) REFERENCES mos.topic_proposals (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.topic_proposal_findings ADD CONSTRAINT fk_154 FOREIGN KEY (brand_code,finding_id) REFERENCES mos.research_findings (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.proposal_dispatch_tasks ADD CONSTRAINT fk_155 FOREIGN KEY (brand_code,proposal_id) REFERENCES mos.topic_proposals (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.proposal_dispatch_tasks ADD CONSTRAINT fk_156 FOREIGN KEY (brand_code,task_id) REFERENCES mos.content_tasks (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.proposal_dispatch_tasks ADD CONSTRAINT fk_157 FOREIGN KEY (brand_code,plan_item_id) REFERENCES mos.plan_items (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.asset_admission_history ADD CONSTRAINT fk_158 FOREIGN KEY (brand_code,admission_id) REFERENCES mos.asset_admissions (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.research_report_brands ADD CONSTRAINT fk_159 FOREIGN KEY (brand_code,report_id) REFERENCES mos.research_reports (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.video_keyframe_assets ADD CONSTRAINT fk_160 FOREIGN KEY (brand_code,video_artifact_id) REFERENCES mos.video_artifacts (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.video_keyframe_assets ADD CONSTRAINT fk_161 FOREIGN KEY (brand_code,asset_id) REFERENCES mos.working_assets (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.campaign_library_refs ADD CONSTRAINT fk_162 FOREIGN KEY (brand_code,campaign_id) REFERENCES mos.campaigns (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.campaign_library_refs ADD CONSTRAINT fk_163 FOREIGN KEY (brand_code,library_ref_id) REFERENCES mos.library_asset_refs (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.research_report_evidence ADD CONSTRAINT fk_164 FOREIGN KEY (brand_code,report_id) REFERENCES mos.research_reports (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.research_report_evidence ADD CONSTRAINT fk_165 FOREIGN KEY (evidence_id) REFERENCES mos.source_evidence (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.file_versions ADD CONSTRAINT fk_166 FOREIGN KEY (brand_code,object_id) REFERENCES mos.file_objects (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.upload_sessions ADD CONSTRAINT fk_167 FOREIGN KEY (brand_code,object_id) REFERENCES mos.file_objects (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.upload_sessions ADD CONSTRAINT fk_168 FOREIGN KEY (brand_code,file_version_id) REFERENCES mos.file_versions (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.budget_periods ADD CONSTRAINT fk_169 FOREIGN KEY (policy_id) REFERENCES mos.provider_budget_policies (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.budget_reservations ADD CONSTRAINT fk_170 FOREIGN KEY (brand_code,period_id) REFERENCES mos.budget_periods (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.migration_rejections ADD CONSTRAINT fk_171 FOREIGN KEY (run_id) REFERENCES mos.migration_runs (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.idempotency_requests ADD CONSTRAINT fk_172 FOREIGN KEY (brand_code,proposal_id) REFERENCES mos.topic_proposals (brand_code,id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.role_brand_scopes ADD CONSTRAINT fk_173 FOREIGN KEY (scope_brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.research_report_brands ADD CONSTRAINT fk_174 FOREIGN KEY (visible_brand_code) REFERENCES mos.brands (code) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.source_evidence ADD CONSTRAINT fk_175 FOREIGN KEY (source_id) REFERENCES mos.source_registry (id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.review_cases ADD CONSTRAINT fk_176 FOREIGN KEY (brand_code,content_version_id,version_hash) REFERENCES mos.content_versions (brand_code,id,manifest_hash) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.review_decisions ADD CONSTRAINT fk_177 FOREIGN KEY (brand_code,case_id,version_hash) REFERENCES mos.review_cases (brand_code,id,version_hash) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.review_decisions ADD CONSTRAINT fk_178 FOREIGN KEY (brand_code,case_id,content_version_id) REFERENCES mos.review_cases (brand_code,id,content_version_id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.review_decisions ADD CONSTRAINT fk_179 FOREIGN KEY (brand_code,case_id,asset_admission_id) REFERENCES mos.review_cases (brand_code,id,asset_admission_id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.research_finding_evidence ADD CONSTRAINT fk_180 FOREIGN KEY (brand_code,finding_id,report_id) REFERENCES mos.research_findings (brand_code,id,report_id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE mos.research_finding_evidence ADD CONSTRAINT fk_181 FOREIGN KEY (brand_code,report_id,evidence_id) REFERENCES mos.research_report_evidence (brand_code,report_id,evidence_id) ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
CREATE UNIQUE INDEX users_username_ci ON mos.users (lower(username));
CREATE INDEX outbox_ready ON mos.outbox_events (available_at,id) WHERE status IN ('PENDING','RETRY');
CREATE INDEX outbox_leased ON mos.outbox_events (lease_until) WHERE status='LEASED';
CREATE INDEX session_expiry ON mos.auth_sessions (expires_at);
CREATE INDEX ticket_expiry ON mos.library_ticket_cache (expires_at);
CREATE INDEX invalidation_target ON mos.library_invalidations (kind,target_id);
CREATE INDEX file_integrity ON mos.file_versions (brand_code,sha256,byte_length);
CREATE INDEX ix_plan_items_0 ON mos.plan_items (brand_code,work_date);
CREATE INDEX ix_content_tasks_0 ON mos.content_tasks (brand_code,owner_id,status);
CREATE INDEX ix_content_tasks_1 ON mos.content_tasks (brand_code,production_due);
CREATE INDEX ix_source_registry_0 ON mos.source_registry (brand_code,status,next_run_at);
CREATE INDEX ix_source_items_0 ON mos.source_items (brand_code,source_id,fetched_at);
CREATE INDEX ix_source_items_1 ON mos.source_items (brand_code,canonical_url_hash);
CREATE INDEX ix_review_cases_0 ON mos.review_cases (brand_code,state,type);
CREATE INDEX ix_generation_jobs_0 ON mos.generation_jobs (brand_code,status,created_at);
CREATE INDEX ix_publishing_schedules_0 ON mos.publishing_schedules (brand_code,planned_at_utc,state);
CREATE INDEX ix_publication_metrics_0 ON mos.publication_metrics (brand_code,publication_id,as_of);
CREATE INDEX ix_library_asset_refs_0 ON mos.library_asset_refs (brand_code,library_id);
CREATE INDEX ix_ingest_jobs_0 ON mos.ingest_jobs (brand_code,status,next_run_at);
CREATE INDEX ix_provider_calls_0 ON mos.provider_calls (brand_code,created_at);
CREATE INDEX ix_provider_calls_1 ON mos.provider_calls (provider,state,created_at);
CREATE INDEX ix_audit_events_0 ON mos.audit_events (brand_code,occurred_at);
CREATE INDEX ix_audit_events_1 ON mos.audit_events (correlation_id);
CREATE INDEX fk_lookup_001 ON mos.monthly_plans (brand_code);
CREATE INDEX fk_lookup_002 ON mos.plan_items (brand_code);
CREATE INDEX fk_lookup_003 ON mos.campaigns (brand_code);
CREATE INDEX fk_lookup_004 ON mos.monthly_campaign_links (brand_code);
CREATE INDEX fk_lookup_005 ON mos.master_topics (brand_code);
CREATE INDEX fk_lookup_006 ON mos.campaign_topic_links (brand_code);
CREATE INDEX fk_lookup_007 ON mos.content_tasks (brand_code);
CREATE INDEX fk_lookup_008 ON mos.source_registry (brand_code);
CREATE INDEX fk_lookup_009 ON mos.source_items (brand_code);
CREATE INDEX fk_lookup_010 ON mos.evidence_references (brand_code);
CREATE INDEX fk_lookup_011 ON mos.skill_versions (brand_code);
CREATE INDEX fk_lookup_012 ON mos.creative_templates (brand_code);
CREATE INDEX fk_lookup_013 ON mos.content_versions (brand_code);
CREATE INDEX fk_lookup_014 ON mos.review_cases (brand_code);
CREATE INDEX fk_lookup_015 ON mos.review_decisions (brand_code);
CREATE INDEX fk_lookup_016 ON mos.working_assets (brand_code);
CREATE INDEX fk_lookup_017 ON mos.generation_jobs (brand_code);
CREATE INDEX fk_lookup_018 ON mos.video_artifacts (brand_code);
CREATE INDEX fk_lookup_019 ON mos.channels (brand_code);
CREATE INDEX fk_lookup_020 ON mos.publishing_schedules (brand_code);
CREATE INDEX fk_lookup_021 ON mos.publication_records (brand_code);
CREATE INDEX fk_lookup_022 ON mos.published_artifacts (brand_code);
CREATE INDEX fk_lookup_023 ON mos.publication_corrections (brand_code);
CREATE INDEX fk_lookup_024 ON mos.publication_metrics (brand_code);
CREATE INDEX fk_lookup_025 ON mos.asset_admissions (brand_code);
CREATE INDEX fk_lookup_026 ON mos.library_asset_refs (brand_code);
CREATE INDEX fk_lookup_027 ON mos.ingest_jobs (brand_code);
CREATE INDEX fk_lookup_028 ON mos.research_reports (brand_code);
CREATE INDEX fk_lookup_029 ON mos.research_findings (brand_code);
CREATE INDEX fk_lookup_030 ON mos.topic_proposals (brand_code);
CREATE INDEX fk_lookup_031 ON mos.research_jobs (brand_code);
CREATE INDEX fk_lookup_032 ON mos.provider_calls (brand_code);
CREATE INDEX fk_lookup_033 ON mos.video_render_jobs (brand_code);
CREATE INDEX fk_lookup_034 ON mos.library_ticket_cache (brand_code);
CREATE INDEX fk_lookup_035 ON mos.library_event_cursors (brand_code);
CREATE INDEX fk_lookup_036 ON mos.library_invalidations (brand_code);
CREATE INDEX fk_lookup_037 ON mos.library_admission_jobs (brand_code);
CREATE INDEX fk_lookup_038 ON mos.audit_events (brand_code);
CREATE INDEX fk_lookup_039 ON mos.task_library_refs (brand_code);
CREATE INDEX fk_lookup_040 ON mos.content_version_assets (brand_code);
CREATE INDEX fk_lookup_041 ON mos.content_version_channels (brand_code);
CREATE INDEX fk_lookup_042 ON mos.content_version_evidence (brand_code);
CREATE INDEX fk_lookup_043 ON mos.generation_job_outputs (brand_code);
CREATE INDEX fk_lookup_044 ON mos.video_storyboard_shots (brand_code);
CREATE INDEX fk_lookup_045 ON mos.research_finding_evidence (brand_code);
CREATE INDEX fk_lookup_046 ON mos.topic_proposal_findings (brand_code);
CREATE INDEX fk_lookup_047 ON mos.proposal_dispatch_tasks (brand_code);
CREATE INDEX fk_lookup_048 ON mos.asset_admission_history (brand_code);
CREATE INDEX fk_lookup_049 ON mos.research_report_brands (brand_code);
CREATE INDEX fk_lookup_050 ON mos.video_keyframe_assets (brand_code);
CREATE INDEX fk_lookup_051 ON mos.campaign_library_refs (brand_code);
CREATE INDEX fk_lookup_052 ON mos.research_report_evidence (brand_code);
CREATE INDEX fk_lookup_053 ON mos.file_objects (brand_code);
CREATE INDEX fk_lookup_054 ON mos.file_versions (brand_code);
CREATE INDEX fk_lookup_055 ON mos.upload_sessions (brand_code);
CREATE INDEX fk_lookup_056 ON mos.budget_periods (brand_code);
CREATE INDEX fk_lookup_057 ON mos.budget_reservations (brand_code);
CREATE INDEX fk_lookup_058 ON mos.outbox_events (brand_code);
CREATE INDEX fk_lookup_059 ON mos.inbox_events (brand_code);
CREATE INDEX fk_lookup_060 ON mos.idempotency_requests (brand_code);
CREATE INDEX fk_lookup_061 ON mos.user_role_grants (user_id);
CREATE INDEX fk_lookup_062 ON mos.auth_sessions (user_id);
CREATE INDEX fk_lookup_063 ON mos.monthly_plans (owner_id);
CREATE INDEX fk_lookup_064 ON mos.campaigns (owner_id);
CREATE INDEX fk_lookup_065 ON mos.master_topics (owner_id);
CREATE INDEX fk_lookup_066 ON mos.content_tasks (owner_id);
CREATE INDEX fk_lookup_067 ON mos.source_registry (owner_id);
CREATE INDEX fk_lookup_068 ON mos.content_versions (author_id);
CREATE INDEX fk_lookup_069 ON mos.working_assets (owner_id);
CREATE INDEX fk_lookup_070 ON mos.generation_jobs (requested_by);
CREATE INDEX fk_lookup_071 ON mos.channels (owner_id);
CREATE INDEX fk_lookup_072 ON mos.research_reports (requester_id);
CREATE INDEX fk_lookup_073 ON mos.topic_proposals (created_by_id);
CREATE INDEX fk_lookup_074 ON mos.research_jobs (actor_id);
CREATE INDEX fk_lookup_075 ON mos.video_render_jobs (actor_id);
CREATE INDEX fk_lookup_076 ON mos.review_decisions (actor_id);
CREATE INDEX fk_lookup_077 ON mos.asset_admission_history (actor_id);
CREATE INDEX fk_lookup_078 ON mos.audit_events (actor_user_id);
CREATE INDEX fk_lookup_079 ON mos.user_role_grants (role_code);
CREATE INDEX fk_lookup_080 ON mos.role_permissions (role_code);
CREATE INDEX fk_lookup_081 ON mos.monthly_plans (brand_code,supersedes_id);
CREATE INDEX fk_lookup_082 ON mos.plan_items (brand_code,plan_id);
CREATE INDEX fk_lookup_083 ON mos.plan_items (brand_code,content_task_id);
CREATE INDEX fk_lookup_084 ON mos.monthly_campaign_links (brand_code,plan_id);
CREATE INDEX fk_lookup_085 ON mos.monthly_campaign_links (brand_code,campaign_id);
CREATE INDEX fk_lookup_086 ON mos.campaign_topic_links (brand_code,campaign_id);
CREATE INDEX fk_lookup_087 ON mos.campaign_topic_links (brand_code,topic_id);
CREATE INDEX fk_lookup_088 ON mos.content_tasks (brand_code,campaign_id);
CREATE INDEX fk_lookup_089 ON mos.content_tasks (brand_code,topic_id);
CREATE INDEX fk_lookup_090 ON mos.content_tasks (brand_code,parent_task_id);
CREATE INDEX fk_lookup_091 ON mos.source_items (brand_code,source_id);
CREATE INDEX fk_lookup_092 ON mos.evidence_references (brand_code,source_item_id);
CREATE INDEX fk_lookup_093 ON mos.evidence_references (brand_code,topic_id);
CREATE INDEX fk_lookup_094 ON mos.evidence_references (brand_code,content_version_id);
CREATE INDEX fk_lookup_095 ON mos.creative_templates (brand_code,skill_version_id);
CREATE INDEX fk_lookup_096 ON mos.content_versions (brand_code,content_task_id);
CREATE INDEX fk_lookup_097 ON mos.content_versions (brand_code,supersedes_id);
CREATE INDEX fk_lookup_098 ON mos.content_versions (brand_code,superseded_by_id);
CREATE INDEX fk_lookup_099 ON mos.review_cases (brand_code,content_version_id);
CREATE INDEX fk_lookup_100 ON mos.review_cases (brand_code,asset_admission_id);
CREATE INDEX fk_lookup_101 ON mos.review_decisions (brand_code,case_id);
CREATE INDEX fk_lookup_102 ON mos.working_assets (brand_code,task_id);
CREATE INDEX fk_lookup_103 ON mos.working_assets (brand_code,campaign_id);
CREATE INDEX fk_lookup_104 ON mos.working_assets (brand_code,topic_id);
CREATE INDEX fk_lookup_105 ON mos.working_assets (brand_code,generation_job_id);
CREATE INDEX fk_lookup_106 ON mos.working_assets (brand_code,file_version_id);
CREATE INDEX fk_lookup_107 ON mos.generation_jobs (brand_code,task_id);
CREATE INDEX fk_lookup_108 ON mos.generation_jobs (brand_code,skill_version_id);
CREATE INDEX fk_lookup_109 ON mos.generation_jobs (brand_code,template_id);
CREATE INDEX fk_lookup_110 ON mos.video_artifacts (brand_code,task_id);
CREATE INDEX fk_lookup_111 ON mos.video_artifacts (brand_code,final_asset_id);
CREATE INDEX fk_lookup_112 ON mos.publishing_schedules (brand_code,content_version_id);
CREATE INDEX fk_lookup_113 ON mos.publishing_schedules (brand_code,channel_id);
CREATE INDEX fk_lookup_114 ON mos.publication_records (brand_code,schedule_id);
CREATE INDEX fk_lookup_115 ON mos.publication_records (brand_code,content_version_id);
CREATE INDEX fk_lookup_116 ON mos.publication_records (brand_code,channel_id);
CREATE INDEX fk_lookup_117 ON mos.published_artifacts (brand_code,publication_id);
CREATE INDEX fk_lookup_118 ON mos.published_artifacts (brand_code,file_version_id);
CREATE INDEX fk_lookup_119 ON mos.publication_corrections (brand_code,publication_id);
CREATE INDEX fk_lookup_120 ON mos.publication_corrections (brand_code,replacement_publication_id);
CREATE INDEX fk_lookup_121 ON mos.publication_metrics (brand_code,publication_id);
CREATE INDEX fk_lookup_122 ON mos.publication_metrics (brand_code,channel_id);
CREATE INDEX fk_lookup_123 ON mos.asset_admissions (brand_code,working_asset_id);
CREATE INDEX fk_lookup_124 ON mos.library_asset_refs (brand_code,admission_id);
CREATE INDEX fk_lookup_125 ON mos.library_asset_refs (brand_code,working_asset_id);
CREATE INDEX fk_lookup_126 ON mos.ingest_jobs (brand_code,source_id);
CREATE INDEX fk_lookup_127 ON mos.research_reports (brand_code,job_id);
CREATE INDEX fk_lookup_128 ON mos.research_jobs (brand_code,report_id);
CREATE INDEX fk_lookup_129 ON mos.research_findings (brand_code,report_id);
CREATE INDEX fk_lookup_130 ON mos.research_findings (brand_code,source_item_id);
CREATE INDEX fk_lookup_131 ON mos.topic_proposals (brand_code,report_id);
CREATE INDEX fk_lookup_132 ON mos.topic_proposals (brand_code,topic_id);
CREATE INDEX fk_lookup_133 ON mos.video_render_jobs (brand_code,task_id);
CREATE INDEX fk_lookup_134 ON mos.video_render_jobs (brand_code,file_version_id);
CREATE INDEX fk_lookup_135 ON mos.library_admission_jobs (brand_code,admission_id);
CREATE INDEX fk_lookup_136 ON mos.role_brand_scopes (grant_id);
CREATE INDEX fk_lookup_137 ON mos.task_library_refs (brand_code,task_id);
CREATE INDEX fk_lookup_138 ON mos.task_library_refs (brand_code,library_ref_id);
CREATE INDEX fk_lookup_139 ON mos.content_version_assets (brand_code,content_version_id);
CREATE INDEX fk_lookup_140 ON mos.content_version_assets (brand_code,asset_id);
CREATE INDEX fk_lookup_141 ON mos.content_version_assets (brand_code,file_version_id);
CREATE INDEX fk_lookup_142 ON mos.content_version_channels (brand_code,content_version_id);
CREATE INDEX fk_lookup_143 ON mos.content_version_channels (brand_code,channel_id);
CREATE INDEX fk_lookup_144 ON mos.content_version_evidence (brand_code,content_version_id);
CREATE INDEX fk_lookup_145 ON mos.content_version_evidence (brand_code,evidence_reference_id);
CREATE INDEX fk_lookup_146 ON mos.generation_job_outputs (brand_code,job_id);
CREATE INDEX fk_lookup_147 ON mos.generation_job_outputs (brand_code,asset_id);
CREATE INDEX fk_lookup_148 ON mos.video_storyboard_shots (brand_code,video_artifact_id);
CREATE INDEX fk_lookup_149 ON mos.video_storyboard_shots (brand_code,asset_id);
CREATE INDEX fk_lookup_150 ON mos.research_finding_evidence (brand_code,finding_id);
CREATE INDEX fk_lookup_151 ON mos.research_finding_evidence (brand_code,report_id);
CREATE INDEX fk_lookup_152 ON mos.research_finding_evidence (evidence_id);
CREATE INDEX fk_lookup_153 ON mos.topic_proposal_findings (brand_code,proposal_id);
CREATE INDEX fk_lookup_154 ON mos.topic_proposal_findings (brand_code,finding_id);
CREATE INDEX fk_lookup_155 ON mos.proposal_dispatch_tasks (brand_code,proposal_id);
CREATE INDEX fk_lookup_156 ON mos.proposal_dispatch_tasks (brand_code,task_id);
CREATE INDEX fk_lookup_157 ON mos.proposal_dispatch_tasks (brand_code,plan_item_id);
CREATE INDEX fk_lookup_158 ON mos.asset_admission_history (brand_code,admission_id);
CREATE INDEX fk_lookup_159 ON mos.research_report_brands (brand_code,report_id);
CREATE INDEX fk_lookup_160 ON mos.video_keyframe_assets (brand_code,video_artifact_id);
CREATE INDEX fk_lookup_161 ON mos.video_keyframe_assets (brand_code,asset_id);
CREATE INDEX fk_lookup_162 ON mos.campaign_library_refs (brand_code,campaign_id);
CREATE INDEX fk_lookup_163 ON mos.campaign_library_refs (brand_code,library_ref_id);
CREATE INDEX fk_lookup_164 ON mos.research_report_evidence (brand_code,report_id);
CREATE INDEX fk_lookup_165 ON mos.research_report_evidence (evidence_id);
CREATE INDEX fk_lookup_166 ON mos.file_versions (brand_code,object_id);
CREATE INDEX fk_lookup_167 ON mos.upload_sessions (brand_code,object_id);
CREATE INDEX fk_lookup_168 ON mos.upload_sessions (brand_code,file_version_id);
CREATE INDEX fk_lookup_169 ON mos.budget_periods (policy_id);
CREATE INDEX fk_lookup_170 ON mos.budget_reservations (brand_code,period_id);
CREATE INDEX fk_lookup_171 ON mos.migration_rejections (run_id);
CREATE INDEX fk_lookup_172 ON mos.idempotency_requests (brand_code,proposal_id);
CREATE INDEX fk_lookup_173 ON mos.role_brand_scopes (scope_brand_code);
CREATE INDEX fk_lookup_174 ON mos.research_report_brands (visible_brand_code);
CREATE INDEX fk_lookup_175 ON mos.source_evidence (source_id);
CREATE INDEX fk_lookup_176 ON mos.review_cases (brand_code,content_version_id,version_hash);
CREATE INDEX fk_lookup_177 ON mos.review_decisions (brand_code,case_id,version_hash);
CREATE INDEX fk_lookup_178 ON mos.review_decisions (brand_code,case_id,content_version_id);
CREATE INDEX fk_lookup_179 ON mos.review_decisions (brand_code,case_id,asset_admission_id);
CREATE INDEX fk_lookup_180 ON mos.research_finding_evidence (brand_code,finding_id,report_id);
CREATE INDEX fk_lookup_181 ON mos.research_finding_evidence (brand_code,report_id,evidence_id);
ALTER TABLE mos.review_cases ADD CONSTRAINT ck_review_cases CHECK (((subject_type='content_version' AND content_version_id IS NOT NULL AND asset_admission_id IS NULL AND subject_id=content_version_id AND type IN ('PROFESSIONAL_REVIEW','PUBLICATION_APPROVAL')) OR (subject_type='asset_admission' AND asset_admission_id IS NOT NULL AND content_version_id IS NULL AND subject_id=asset_admission_id AND type='ASSET_ADMISSION')));
ALTER TABLE mos.review_decisions ADD CONSTRAINT ck_review_decisions CHECK (((content_version_id IS NOT NULL)::integer + (asset_admission_id IS NOT NULL)::integer = 1));
ALTER TABLE mos.budget_periods ADD CONSTRAINT ck_budget_periods CHECK (confirmed_usd >= 0 AND reserved_usd >= 0 AND unknown_usd >= 0 AND period_end > period_start);
ALTER TABLE mos.provider_calls ADD CONSTRAINT ck_provider_calls CHECK ((cost_confirmed=false OR confirmed_amount IS NOT NULL) AND (confirmed_amount IS NULL OR confirmed_amount >= 0));
ALTER TABLE mos.file_versions ADD CONSTRAINT ck_file_versions CHECK (upload_state <> 'READY' OR verified_at IS NOT NULL);
ALTER TABLE mos.content_tasks ADD CONSTRAINT state_content_tasks_status CHECK (status IN ('IDEA','PLANNED','IN_PRODUCTION','IN_REVIEW','READY','COMPLETED','ON_HOLD','CANCELLED'));
ALTER TABLE mos.monthly_plans ADD CONSTRAINT state_monthly_plans_status CHECK (status IN ('DRAFT','SUBMITTED','REVISION_REQUIRED','APPROVED','ACTIVE','CLOSED','CANCELLED'));
ALTER TABLE mos.content_versions ADD CONSTRAINT state_content_versions_state CHECK (state IN ('DRAFT','LOCKED_FOR_REVIEW','REVISION_REQUIRED','APPROVED','SUPERSEDED'));
ALTER TABLE mos.review_cases ADD CONSTRAINT state_review_cases_state CHECK (state IN ('SUBMITTED','IN_REVIEW','REVISION_REQUIRED','APPROVED','REJECTED','CANCELLED'));
ALTER TABLE mos.publishing_schedules ADD CONSTRAINT state_publishing_schedules_state CHECK (state IN ('DRAFT','BLOCKED','READY','SCHEDULED','CANCELLED'));
ALTER TABLE mos.publication_records ADD CONSTRAINT state_publication_records_status CHECK (status IN ('PUBLISHED','CORRECTED','REMOVED'));
ALTER TABLE mos.asset_admissions ADD CONSTRAINT state_asset_admissions_state CHECK (state IN ('WORKING','SUBMITTED','PRECHECK','REVIEWING','FINAL_APPROVAL_PENDING','FINAL_APPROVAL_GRANTED','REJECTED','LIBRARY_SYNC_PENDING','SYNC_COMPLETED','SYNC_FAILED','AVAILABLE'));
ALTER TABLE mos.asset_admissions ADD CONSTRAINT state_asset_admissions_final_approval_status CHECK (final_approval_status IN ('PENDING','APPROVED','REJECTED'));
ALTER TABLE mos.asset_admissions ADD CONSTRAINT state_asset_admissions_sync_status CHECK (sync_status IN ('NOT_STARTED','PENDING','COMPLETED','FAILED'));
ALTER TABLE mos.generation_jobs ADD CONSTRAINT state_generation_jobs_status CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','BUDGET_EXCEEDED','NOT_CONFIGURED','BLOCKED'));
ALTER TABLE mos.video_artifacts ADD CONSTRAINT state_video_artifacts_state CHECK (state IN ('BRIEF','SCRIPT','STORYBOARD','SUBTITLE','FINAL_UPLOADED'));
ALTER TABLE mos.channels ADD CONSTRAINT state_channels_state CHECK (state IN ('ENABLED','DISABLED'));
ALTER TABLE mos.skill_versions ADD CONSTRAINT state_skill_versions_state CHECK (state IN ('APPROVED','REFERENCE_ONLY','PENDING_APPROVAL','MISSING_NOT_APPROVED'));

-- RLS is defense in depth. Trusted server identity/RBAC remains mandatory; settings are NOT user assertions.
CREATE FUNCTION mos.brand_member(b text) RETURNS boolean
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
-- Runtime roles are non-owner/NOBYPASSRLS. Identity/session and global settings need separately reviewed narrow repositories/functions.
ALTER TABLE mos.monthly_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.monthly_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.monthly_plans TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.plan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.plan_items FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.plan_items TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.campaigns FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.campaigns TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.monthly_campaign_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.monthly_campaign_links FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.monthly_campaign_links TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.master_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.master_topics FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.master_topics TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.campaign_topic_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.campaign_topic_links FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.campaign_topic_links TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.content_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.content_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.content_tasks TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.source_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.source_registry FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.source_registry TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.source_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.source_items FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.source_items TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.evidence_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.evidence_references FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.evidence_references TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.skill_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.skill_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.skill_versions TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.creative_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.creative_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.creative_templates TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.content_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.content_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.content_versions TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.review_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.review_cases FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.review_cases TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.review_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.review_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.review_decisions TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.working_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.working_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.working_assets TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.generation_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.generation_jobs TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.video_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.video_artifacts FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.video_artifacts TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.channels FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.channels TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.publishing_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.publishing_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.publishing_schedules TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.publication_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.publication_records FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.publication_records TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.published_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.published_artifacts FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.published_artifacts TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.publication_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.publication_corrections FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.publication_corrections TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.publication_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.publication_metrics FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.publication_metrics TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.asset_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.asset_admissions FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.asset_admissions TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.library_asset_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.library_asset_refs FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.library_asset_refs TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.ingest_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.ingest_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.ingest_jobs TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.research_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.research_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.research_reports TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.research_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.research_findings FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.research_findings TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.topic_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.topic_proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.topic_proposals TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.research_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.research_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.research_jobs TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.video_render_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.video_render_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.video_render_jobs TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.library_ticket_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.library_ticket_cache FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.library_ticket_cache TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.library_event_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.library_event_cursors FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.library_event_cursors TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.library_admission_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.library_admission_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.library_admission_jobs TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.task_library_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.task_library_refs FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.task_library_refs TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.content_version_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.content_version_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.content_version_assets TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.content_version_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.content_version_channels FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.content_version_channels TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.content_version_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.content_version_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.content_version_evidence TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.generation_job_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.generation_job_outputs FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.generation_job_outputs TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.video_storyboard_shots ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.video_storyboard_shots FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.video_storyboard_shots TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.research_finding_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.research_finding_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.research_finding_evidence TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.topic_proposal_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.topic_proposal_findings FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.topic_proposal_findings TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.proposal_dispatch_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.proposal_dispatch_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.proposal_dispatch_tasks TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.asset_admission_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.asset_admission_history FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.asset_admission_history TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.research_report_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.research_report_brands FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.research_report_brands TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.video_keyframe_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.video_keyframe_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.video_keyframe_assets TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.campaign_library_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.campaign_library_refs FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.campaign_library_refs TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.research_report_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.research_report_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.research_report_evidence TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.file_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.file_objects FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.file_objects TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.file_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.file_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.file_versions TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.upload_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.upload_sessions TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.budget_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.budget_periods FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.budget_periods TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.budget_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.budget_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.budget_reservations TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.outbox_events FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.outbox_events TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.inbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.inbox_events FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.inbox_events TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.idempotency_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.idempotency_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_scope ON mos.idempotency_requests TO mos_app,mos_worker USING (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code)) WITH CHECK (brand_code=nullif(current_setting('mos.brand_code',true),'') AND mos.brand_member(brand_code));
ALTER TABLE mos.source_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE mos.source_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_read ON mos.source_evidence FOR SELECT TO mos_app,mos_worker USING (
 EXISTS (SELECT 1 FROM mos.research_report_evidence r WHERE r.evidence_id=source_evidence.id)
);
-- No INSERT/UPDATE policy for linked evidence in this draft: Phase3A-2 must implement a narrow authorized ingestion function.
-- Nullable-brand provider_calls/audit_events/invalidations and global tables are DENY by absence of runtime GRANT in this draft.
-- They require brand-read/admin-read and append-only functions, not unrestricted SELECT/UPDATE grants.
-- REQUIRED BEFORE EXECUTION: immutable-manifest/append-only triggers; grant catalog; global/nullable-brand policies;
-- snapshot file READY gate, report/evidence/source brand consistency, active membership epoch locking,
-- admission subject snapshot freeze, legacy field codec and date/time decisions. See PG07. No statement was executed.
