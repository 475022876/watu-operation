SET LOCAL ROLE mos_owner;
CREATE SCHEMA mos_crypto AUTHORIZATION mos_owner;
CREATE EXTENSION pgcrypto WITH SCHEMA mos_crypto;
REVOKE ALL ON SCHEMA mos,mos_crypto FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA mos FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mos_crypto FROM PUBLIC;
GRANT USAGE ON SCHEMA mos TO mos_app,mos_worker,mos_guard;
GRANT USAGE ON SCHEMA mos_crypto TO mos_guard,mos_app,mos_worker;
GRANT EXECUTE ON FUNCTION mos_crypto.hmac(bytea,bytea,text) TO mos_guard;
GRANT EXECUTE ON FUNCTION mos_crypto.digest(bytea,text) TO mos_app,mos_worker,mos_guard;
GRANT SELECT ON mos.users,mos.user_role_grants,mos.role_brand_scopes,mos.role_definitions,mos.role_permissions,mos.system_settings TO mos_guard;
-- Service-only signing key resides in a protected system_settings row, never accessible to the app SQL role.
CREATE FUNCTION mos.verified_claims(p text,sig text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,mos AS $$
DECLARE k text; c jsonb;
BEGIN
 IF p IS NULL OR sig IS NULL OR length(p)>4096 OR sig !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
 SELECT value->>'hex' INTO k FROM mos.system_settings WHERE setting_key='_pg_context_key';
 IF k IS NULL OR encode(mos_crypto.hmac(convert_to(p,'UTF8'),decode(k,'hex'),'sha256'),'hex')<>sig THEN RETURN NULL; END IF;
 c:=p::jsonb;
 IF jsonb_typeof(c)<>'object' OR NOT (c ?& ARRAY['actorId','brandCode','backendPid','transactionId','expiresAt']) OR jsonb_typeof(c->'expiresAt')<>'number' THEN RETURN NULL; END IF;
 IF (c->>'backendPid')::integer IS DISTINCT FROM pg_backend_pid() OR c->>'transactionId' IS DISTINCT FROM txid_current()::text
 OR (c->>'expiresAt')::numeric < extract(epoch FROM clock_timestamp())
 OR (c->>'expiresAt')::numeric > extract(epoch FROM clock_timestamp())+120
 OR coalesce(c->>'actorId','')='' OR coalesce(c->>'brandCode','')='' THEN RETURN NULL; END IF;
 RETURN c;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
CREATE FUNCTION mos.current_claims() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,mos AS $$
 SELECT mos.verified_claims(current_setting('mos.claims',true),current_setting('mos.claims_signature',true))
$$;
CREATE FUNCTION mos.brand_member(b text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,mos AS $$
 SELECT coalesce((SELECT b=c->>'brandCode' AND EXISTS (
 SELECT 1 FROM mos.users u JOIN mos.user_role_grants g ON g.user_id=u.id
 WHERE u.id=c->>'actorId' AND u.status='active' AND g.revoked_at IS NULL
 AND (g.valid_until IS NULL OR g.valid_until>CURRENT_TIMESTAMP)
 AND (g.all_brands OR EXISTS (SELECT 1 FROM mos.role_brand_scopes s WHERE s.grant_id=g.id AND s.scope_brand_code=b))
 ) FROM (SELECT mos.current_claims() AS c) v),false)
$$;
CREATE FUNCTION mos.has_permission(p text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,mos AS $$
 SELECT coalesce((SELECT mos.brand_member(c->>'brandCode') AND EXISTS (
 SELECT 1 FROM mos.user_role_grants g JOIN mos.role_permissions rp ON rp.role_code=g.role_code
 WHERE g.user_id=c->>'actorId' AND rp.permission_code=p AND g.revoked_at IS NULL
 AND (g.valid_until IS NULL OR g.valid_until>CURRENT_TIMESTAMP)
 AND (g.all_brands OR EXISTS(SELECT 1 FROM mos.role_brand_scopes s WHERE s.grant_id=g.id AND s.scope_brand_code=c->>'brandCode'))
 ) FROM (SELECT mos.current_claims() AS c) v),false)
$$;
CREATE FUNCTION mos.set_context(p text,sig text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,mos AS $$
DECLARE c jsonb;
BEGIN
 c:=mos.verified_claims(p,sig);
 IF c IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='TRUSTED_CONTEXT_REQUIRED'; END IF;
 PERFORM set_config('mos.claims',p,true); PERFORM set_config('mos.claims_signature',sig,true);
 IF NOT mos.brand_member(c->>'brandCode') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='BRAND_ACCESS_DENIED'; END IF;
END $$;
CREATE FUNCTION mos.current_identity() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,mos AS $$
DECLARE c jsonb:=mos.current_claims();r jsonb;
BEGIN
 IF NOT mos.brand_member(c->>'brandCode') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CONTEXT_REQUIRED'; END IF;
 SELECT jsonb_build_object('id',id,'username',username,'displayName',display_name,'status',status,'authzEpoch',authz_epoch) INTO r FROM mos.users WHERE id=c->>'actorId';
 RETURN r;
END $$;
CREATE FUNCTION mos.read_provider_config(k text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,mos AS $$
BEGIN
 IF NOT mos.has_permission('settings.manage') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CONFIG_ACCESS_DENIED'; END IF;
 RETURN (SELECT jsonb_build_object('kind',kind,'mode',mode,'baseUrl',base_url,'model',model,'timeoutMs',timeout_ms) FROM mos.provider_configs WHERE kind=k);
END $$;
GRANT SELECT ON mos.provider_configs TO mos_guard;
CREATE FUNCTION mos.reference_invalidated(k text,t text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,mos AS $$
DECLARE c jsonb:=mos.current_claims();
BEGIN
 IF NOT mos.brand_member(c->>'brandCode') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CONTEXT_REQUIRED'; END IF;
 RETURN EXISTS(SELECT 1 FROM mos.library_invalidations WHERE kind=k AND target_id=t AND (brand_code IS NULL OR brand_code=c->>'brandCode'));
END $$;
GRANT SELECT ON mos.library_invalidations TO mos_guard;
-- Guard is NOLOGIN, not a business-table owner; no app role can SET ROLE to it.
GRANT CREATE ON SCHEMA mos TO mos_guard;
ALTER FUNCTION mos.verified_claims(text,text) OWNER TO mos_guard;
ALTER FUNCTION mos.current_claims() OWNER TO mos_guard;
ALTER FUNCTION mos.brand_member(text) OWNER TO mos_guard;
ALTER FUNCTION mos.has_permission(text) OWNER TO mos_guard;
ALTER FUNCTION mos.set_context(text,text) OWNER TO mos_guard;
ALTER FUNCTION mos.current_identity() OWNER TO mos_guard;
ALTER FUNCTION mos.read_provider_config(text) OWNER TO mos_guard;
ALTER FUNCTION mos.reference_invalidated(text,text) OWNER TO mos_guard;
REVOKE CREATE ON SCHEMA mos FROM mos_guard;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mos FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mos.current_claims(),mos.brand_member(text),mos.has_permission(text),mos.set_context(text,text),mos.current_identity(),mos.read_provider_config(text),mos.reference_invalidated(text,text) TO mos_app,mos_worker;
RESET ROLE;
