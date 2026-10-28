SET LOCAL ROLE mos_owner;
CREATE FUNCTION mos.deny_record_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,mos AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='IMMUTABLE_RECORD'; END $$;
CREATE FUNCTION mos.protect_review_subject() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,mos AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='REVIEW_HISTORY_REQUIRED'; END IF;
 IF ROW(NEW.brand_code,NEW.type,NEW.subject_type,NEW.subject_id,NEW.content_version_id,NEW.asset_admission_id,NEW.version_hash,NEW.policy_version,NEW.subject_snapshot,NEW.subject_canonical_text)
 IS DISTINCT FROM ROW(OLD.brand_code,OLD.type,OLD.subject_type,OLD.subject_id,OLD.content_version_id,OLD.asset_admission_id,OLD.version_hash,OLD.policy_version,OLD.subject_snapshot,OLD.subject_canonical_text)
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='REVIEW_SUBJECT_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION mos.protect_content_version() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,mos AS $$
DECLARE p jsonb; assets jsonb; channels jsonb; d1 jsonb;d2 jsonb;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.state<>'DRAFT' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='FROZEN_CONTENT'; END IF; RETURN OLD;
 END IF;
 IF OLD.state<>'DRAFT' AND ROW(NEW.brand_code,NEW.content_task_id,NEW.number,NEW.code,NEW.title,NEW.body,NEW.format,NEW.risk_grade,NEW.locale,NEW.disclosures,NEW.manifest_hash,NEW.manifest_payload,NEW.manifest_canonical_text)
 IS DISTINCT FROM ROW(OLD.brand_code,OLD.content_task_id,OLD.number,OLD.code,OLD.title,OLD.body,OLD.format,OLD.risk_grade,OLD.locale,OLD.disclosures,OLD.manifest_hash,OLD.manifest_payload,OLD.manifest_canonical_text)
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='FROZEN_CONTENT'; END IF;
 IF OLD.state<>'DRAFT' AND NEW.state='DRAFT' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='FROZEN_CONTENT_CANNOT_REOPEN'; END IF;
 IF OLD.state='DRAFT' AND NEW.state<>'DRAFT' THEN
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
 RETURN NEW;
END $$;
CREATE FUNCTION mos.protect_version_reference() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,mos AS $$
DECLARE r record;s text;
BEGIN
 FOR r IN SELECT j->>'brand_code' AS b,j->>'content_version_id' AS v FROM (VALUES(CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END),(CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END)) x(j) WHERE j IS NOT NULL LOOP
  SELECT state INTO s FROM mos.content_versions WHERE id=r.v AND brand_code=r.b FOR SHARE;
  IF s IS NULL OR s<>'DRAFT' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='FROZEN_VERSION_REFERENCE'; END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_TABLE_NAME='content_version_assets' THEN
  IF NEW.file_version_id IS NULL OR NOT EXISTS(SELECT 1 FROM mos.file_versions f JOIN mos.working_assets a ON a.id=NEW.asset_id AND a.brand_code=NEW.brand_code WHERE f.id=NEW.file_version_id AND f.brand_code=NEW.brand_code AND f.upload_state='READY' AND a.file_version_id=f.id AND a.sha256=f.sha256 AND NEW.asset_sha256=f.sha256) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ASSET_FILE_NOT_READY'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION mos.protect_ready_file() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,mos AS $$
BEGIN
 IF OLD.upload_state='READY' AND (TG_OP='DELETE' OR ROW(NEW.brand_code,NEW.object_id,NEW.version_no,NEW.storage_version,NEW.sha256,NEW.byte_length,NEW.mime,NEW.upload_state,NEW.verified_at) IS DISTINCT FROM ROW(OLD.brand_code,OLD.object_id,OLD.version_no,OLD.storage_version,OLD.sha256,OLD.byte_length,OLD.mime,OLD.upload_state,OLD.verified_at)) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='READY_FILE_IMMUTABLE'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE FUNCTION mos.protect_frozen_asset() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,mos AS $$
BEGIN
 PERFORM 1 FROM mos.content_versions v JOIN mos.content_version_assets r ON v.id=r.content_version_id AND v.brand_code=r.brand_code WHERE r.asset_id=OLD.id AND r.brand_code=OLD.brand_code FOR SHARE OF v;
 IF ROW(NEW.sha256,NEW.mime,NEW.origin,NEW.file_version_id,NEW.bytes,NEW.object_key_legacy) IS DISTINCT FROM ROW(OLD.sha256,OLD.mime,OLD.origin,OLD.file_version_id,OLD.bytes,OLD.object_key_legacy)
 AND EXISTS(SELECT 1 FROM mos.content_version_assets r JOIN mos.content_versions v ON v.id=r.content_version_id AND v.brand_code=r.brand_code WHERE r.asset_id=OLD.id AND r.brand_code=OLD.brand_code AND v.state<>'DRAFT') THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='FROZEN_ASSET_IMMUTABLE'; END IF; RETURN NEW;
END $$;
CREATE FUNCTION mos.protect_file_location() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,mos AS $$
BEGIN
 IF ROW(NEW.brand_code,NEW.storage_backend,NEW.bucket_ref,NEW.object_key) IS DISTINCT FROM ROW(OLD.brand_code,OLD.storage_backend,OLD.bucket_ref,OLD.object_key)
 AND EXISTS(SELECT 1 FROM mos.file_versions WHERE object_id=OLD.id AND brand_code=OLD.brand_code AND upload_state='READY') THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='READY_FILE_LOCATION_IMMUTABLE'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER freeze_content BEFORE UPDATE OR DELETE ON mos.content_versions FOR EACH ROW EXECUTE FUNCTION mos.protect_content_version();
CREATE TRIGGER review_subject BEFORE UPDATE OR DELETE ON mos.review_cases FOR EACH ROW EXECUTE FUNCTION mos.protect_review_subject();
CREATE TRIGGER ready_file BEFORE UPDATE OR DELETE ON mos.file_versions FOR EACH ROW EXECUTE FUNCTION mos.protect_ready_file();
CREATE TRIGGER frozen_asset BEFORE UPDATE ON mos.working_assets FOR EACH ROW EXECUTE FUNCTION mos.protect_frozen_asset();
CREATE TRIGGER file_location BEFORE UPDATE ON mos.file_objects FOR EACH ROW EXECUTE FUNCTION mos.protect_file_location();
ALTER TABLE mos.file_versions ADD CONSTRAINT file_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$');
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON mos.audit_events FOR EACH ROW EXECUTE FUNCTION mos.deny_record_mutation();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON mos.review_decisions FOR EACH ROW EXECUTE FUNCTION mos.deny_record_mutation();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON mos.asset_admission_history FOR EACH ROW EXECUTE FUNCTION mos.deny_record_mutation();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON mos.published_artifacts FOR EACH ROW EXECUTE FUNCTION mos.deny_record_mutation();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON mos.publication_corrections FOR EACH ROW EXECUTE FUNCTION mos.deny_record_mutation();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON mos.provider_calls FOR EACH ROW EXECUTE FUNCTION mos.deny_record_mutation();
CREATE TRIGGER version_reference BEFORE INSERT OR UPDATE OR DELETE ON mos.content_version_assets FOR EACH ROW EXECUTE FUNCTION mos.protect_version_reference();
CREATE TRIGGER version_reference BEFORE INSERT OR UPDATE OR DELETE ON mos.content_version_channels FOR EACH ROW EXECUTE FUNCTION mos.protect_version_reference();
CREATE TRIGGER version_reference BEFORE INSERT OR UPDATE OR DELETE ON mos.content_version_evidence FOR EACH ROW EXECUTE FUNCTION mos.protect_version_reference();
-- Current enum contains an editorial state not included in researchlib.PROPOSAL_STATUS.
ALTER TABLE mos.topic_proposals ADD CONSTRAINT proposal_state CHECK (status IN ('AI_RECOMMENDED','PENDING_EDITORIAL_REVIEW','APPROVED','APPROVED_UNSCHEDULED','REVISION_REQUESTED','ON_HOLD','REJECTED'));
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mos FROM PUBLIC;
RESET ROLE;
SET LOCAL ROLE mos_owner;
CREATE FUNCTION mos.content_starts_draft() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,mos AS $$
BEGIN
 IF NEW.state<>'DRAFT' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='NEW_CONTENT_REQUIRES_DRAFT'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER starts_draft BEFORE INSERT ON mos.content_versions FOR EACH ROW EXECUTE FUNCTION mos.content_starts_draft();
REVOKE ALL ON FUNCTION mos.content_starts_draft() FROM PUBLIC;
RESET ROLE;
