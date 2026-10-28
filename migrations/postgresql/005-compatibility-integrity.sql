SET LOCAL ROLE mos_owner;
CREATE OR REPLACE FUNCTION mos.protect_content_version() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,mos AS $$
DECLARE p jsonb; assets jsonb; channels jsonb; d1 jsonb;d2 jsonb;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.state<>'DRAFT' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='FROZEN_CONTENT'; END IF; RETURN OLD;
 END IF;
 IF OLD.state<>'DRAFT' AND ROW(NEW.brand_code,NEW.content_task_id,NEW.number,NEW.code,NEW.title,NEW.body,NEW.format,NEW.risk_grade,NEW.locale,NEW.pillar_code,NEW.narrative_code,NEW.author_id,NEW.disclosures,NEW.manifest_hash,NEW.manifest_payload,NEW.manifest_canonical_text)
 IS DISTINCT FROM ROW(OLD.brand_code,OLD.content_task_id,OLD.number,OLD.code,OLD.title,OLD.body,OLD.format,OLD.risk_grade,OLD.locale,OLD.pillar_code,OLD.narrative_code,OLD.author_id,OLD.disclosures,OLD.manifest_hash,OLD.manifest_payload,OLD.manifest_canonical_text)
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='FROZEN_CONTENT'; END IF;
 IF ROW(NEW.brand_code,NEW.content_task_id,NEW.number,NEW.code,NEW.author_id) IS DISTINCT FROM ROW(OLD.brand_code,OLD.content_task_id,OLD.number,OLD.code,OLD.author_id) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CONTENT_IDENTITY_IMMUTABLE'; END IF;
 IF OLD.state<>'DRAFT' AND NEW.state='DRAFT' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='FROZEN_CONTENT_CANNOT_REOPEN'; END IF;
 IF NEW.state IS DISTINCT FROM OLD.state AND NOT (('{"DRAFT":["LOCKED_FOR_REVIEW","SUPERSEDED"],"LOCKED_FOR_REVIEW":["APPROVED","REVISION_REQUIRED","SUPERSEDED"],"REVISION_REQUIRED":["SUPERSEDED"],"APPROVED":["SUPERSEDED"],"SUPERSEDED":[]}'::jsonb->OLD.state) ? NEW.state) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ILLEGAL_CONTENT_TRANSITION'; END IF;
 IF OLD.state='DRAFT' AND NEW.state='LOCKED_FOR_REVIEW' THEN
  IF NEW.state<>'LOCKED_FOR_REVIEW' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FREEZE_BEFORE_REVIEW'; END IF;
  IF NEW.manifest_canonical_text IS NULL OR NEW.manifest_hash IS NULL OR NEW.manifest_hash<>encode(mos_crypto.digest(convert_to(NEW.manifest_canonical_text,'UTF8'),'sha256'),'hex') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVALID_MANIFEST_DIGEST'; END IF;
  p:=NEW.manifest_canonical_text::jsonb;
  IF p IS DISTINCT FROM NEW.manifest_payload OR p->>'contentVersionId' IS DISTINCT FROM NEW.id OR p->>'contentTaskId' IS DISTINCT FROM NEW.content_task_id OR p->>'brandCode' IS DISTINCT FROM NEW.brand_code OR p->>'riskGrade' IS DISTINCT FROM coalesce(NEW.risk_grade,'') OR p->>'locale' IS DISTINCT FROM coalesce(NEW.locale,'zh-CN') OR p->>'textHash' IS DISTINCT FROM encode(mos_crypto.digest(convert_to(coalesce(NEW.body,''),'UTF8'),'sha256'),'hex') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='MANIFEST_CONTENT_MISMATCH'; END IF;
  IF EXISTS (SELECT 1 FROM mos.content_version_assets r JOIN mos.working_assets a ON a.id=r.asset_id AND a.brand_code=r.brand_code LEFT JOIN mos.file_versions f ON f.id=r.file_version_id AND f.brand_code=r.brand_code WHERE r.content_version_id=NEW.id AND r.brand_code=NEW.brand_code AND (r.file_version_id IS DISTINCT FROM a.file_version_id OR r.asset_sha256 IS DISTINCT FROM a.sha256 OR r.asset_sha256 IS DISTINCT FROM f.sha256 OR f.upload_state IS DISTINCT FROM 'READY')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ASSET_PIN_MISMATCH'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'sha256',a.sha256,'mime',a.mime,'origin',a.origin) ORDER BY a.id),'[]'::jsonb) INTO assets FROM mos.content_version_assets r JOIN mos.working_assets a ON a.id=r.asset_id AND a.brand_code=r.brand_code WHERE r.content_version_id=NEW.id AND r.brand_code=NEW.brand_code;
  SELECT coalesce(jsonb_agg(r.channel_id ORDER BY r.channel_id),'[]'::jsonb) INTO channels FROM mos.content_version_channels r WHERE r.content_version_id=NEW.id AND r.brand_code=NEW.brand_code;
  SELECT coalesce(jsonb_agg(v ORDER BY v),'[]'::jsonb) INTO d1 FROM jsonb_array_elements(coalesce(NEW.disclosures,'[]'::jsonb)) v;
  SELECT coalesce(jsonb_agg(v ORDER BY v),'[]'::jsonb) INTO d2 FROM jsonb_array_elements(coalesce(p->'disclosures','[]'::jsonb)) v;
  IF p->'assets' IS DISTINCT FROM assets OR p->'channelIds' IS DISTINCT FROM channels OR d1 IS DISTINCT FROM d2 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='MANIFEST_REFERENCE_MISMATCH'; END IF;
 END IF;
 IF NEW.state='APPROVED' AND OLD.state<>'APPROVED' THEN
  IF NOT mos.has_permission('content.publish_approve') OR NOT EXISTS(SELECT 1 FROM mos.review_cases WHERE content_version_id=NEW.id AND brand_code=NEW.brand_code AND type='PUBLICATION_APPROVAL' AND state='APPROVED' AND version_hash=NEW.manifest_hash) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PUBLICATION_APPROVAL_REQUIRED'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION mos.protect_review_subject() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,mos AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='REVIEW_HISTORY_REQUIRED'; END IF;
 IF ROW(NEW.brand_code,NEW.type,NEW.subject_type,NEW.subject_id,NEW.content_version_id,NEW.asset_admission_id,NEW.version_hash,NEW.policy_version,NEW.subject_snapshot,NEW.subject_canonical_text,NEW.submitted_by,NEW.submitted_at)
 IS DISTINCT FROM ROW(OLD.brand_code,OLD.type,OLD.subject_type,OLD.subject_id,OLD.content_version_id,OLD.asset_admission_id,OLD.version_hash,OLD.policy_version,OLD.subject_snapshot,OLD.subject_canonical_text,OLD.submitted_by,OLD.submitted_at)
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='REVIEW_SUBJECT_IMMUTABLE'; END IF;
 IF NEW.state IS DISTINCT FROM OLD.state AND NOT (('{"SUBMITTED":["IN_REVIEW","APPROVED","REVISION_REQUIRED","REJECTED","CANCELLED"],"IN_REVIEW":["APPROVED","REVISION_REQUIRED","REJECTED","CANCELLED"],"REVISION_REQUIRED":["CANCELLED"],"APPROVED":[],"REJECTED":[],"CANCELLED":[]}'::jsonb->OLD.state) ? NEW.state) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ILLEGAL_REVIEW_TRANSITION'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION mos.protect_approved_admission() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,mos AS $$
BEGIN
 IF OLD.final_approval_status='APPROVED' AND ROW(NEW.brand_code,NEW.working_asset_id,NEW.asset_sha256,NEW.origin_object_id,NEW.origin_version_id,NEW.classification,NEW.license_status,NEW.reuse_scope,NEW.ai_reuse_policy,NEW.external_ai_transfer_policy,NEW.submission_metadata,NEW.submitted_by,NEW.category_code,NEW.library_primary_category,NEW.library_subcategory,NEW.approval_mode,NEW.final_approval_status)
 IS DISTINCT FROM ROW(OLD.brand_code,OLD.working_asset_id,OLD.asset_sha256,OLD.origin_object_id,OLD.origin_version_id,OLD.classification,OLD.license_status,OLD.reuse_scope,OLD.ai_reuse_policy,OLD.external_ai_transfer_policy,OLD.submission_metadata,OLD.submitted_by,OLD.category_code,OLD.library_primary_category,OLD.library_subcategory,OLD.approval_mode,OLD.final_approval_status)
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='APPROVED_ADMISSION_IMMUTABLE'; END IF;
 IF NEW.final_approval_status='APPROVED' AND OLD.final_approval_status<>'APPROVED' AND (NOT mos.has_permission('library.asset.approve.final') OR NEW.submitted_by=mos.current_claims()->>'actorId') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='FINAL_APPROVER_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION mos.validate_published_file() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,mos AS $$
BEGIN
 IF NEW.file_version_id IS NULL OR NOT EXISTS(SELECT 1 FROM mos.file_versions WHERE id=NEW.file_version_id AND brand_code=NEW.brand_code AND upload_state='READY' AND sha256=NEW.sha256 AND byte_length=NEW.bytes) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PUBLISHED_FILE_NOT_READY'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER approved_admission BEFORE UPDATE ON mos.asset_admissions FOR EACH ROW EXECUTE FUNCTION mos.protect_approved_admission();
CREATE TRIGGER published_file BEFORE INSERT ON mos.published_artifacts FOR EACH ROW EXECUTE FUNCTION mos.validate_published_file();
REVOKE ALL ON FUNCTION mos.protect_approved_admission(),mos.validate_published_file() FROM PUBLIC;
RESET ROLE;
