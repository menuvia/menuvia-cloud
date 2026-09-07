-- tests/sql/schema_version_assertions.sql
-- =============================================================================
-- Asserții permanente pentru mig 271 (A) — `get_schema_version(text[])`,
-- sonda de decalaj între migrațiile din repo și ledger-ul producției
-- (audit v3 RES-08: mig 263 a stat pe main fără să fie pe prod, nedetectat).
--
--   SV1  toleranță: FĂRĂ schema `supabase_migrations` (CI-ul efemer) →
--        `available=false`, fără excepție.
--   SV2  cheia e NUMELE: ledger cu `version` DELIBERAT diferit de prefixul
--        fișierului (replica prod-ului) → `missing='{}'` când numele coincid.
--   SV3  decalaj la MIJLOC: lipsă în mijlocul listei + ultimul → `missing` =
--        exact cele două, sortate (nu doar „ultimul e prezent").
--   SV4  suprafață: EXECUTE doar service_role.
--   SV5  DEFINER + pg_temp (pe prod INVOKER = sondă moartă: service_role n-are
--        USAGE pe schemă) — doar catalogul vede clasa asta, suita rulează ca
--        postgres.
--   SV6  formă înghețată: exact 5 chei.
--
-- Self-contained, ROLLBACK la final (schema creată în test dispare).
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── SV1: fără ledger → available=false, fără excepție ────────────────────────
do $$
declare v jsonb;
begin
  if exists (select 1 from pg_namespace where nspname = 'supabase_migrations') then
    raise notice 'SV1 SKIP: schema supabase_migrations exista deja in acest mediu';
  else
    v := public.get_schema_version(array['x']);
    if (v->>'available')::boolean is not false or v->'missing' <> 'null'::jsonb then
      raise exception 'SV1 FAIL: fara ledger sonda trebuie sa intoarca available=false (%)', v; end if;
    raise notice 'SV1 OK: fara ledger → available=false, fara exceptie';
  end if;
end $$;

-- ── Ledger de test: version ≠ prefixul fișierului, ca pe prod ────────────────
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version    text primary key,
  name       text,
  statements text[]
);
insert into supabase_migrations.schema_migrations (version, name) values
  ('20260903233550', 'migration_264_audit_v3_council'),
  ('20260905065810', 'migration_268_daily_payments_rpc'),
  ('20260905075533', 'migration_269_oblio_delivery_date')
on conflict (version) do nothing;

-- ── SV2: numele e cheia ───────────────────────────────────────────────────────
do $$
declare v jsonb;
begin
  v := public.get_schema_version(array['migration_264_audit_v3_council',
                                       'migration_268_daily_payments_rpc',
                                       'migration_269_oblio_delivery_date']);
  if (v->>'available')::boolean is not true then
    raise exception 'SV2 FAIL: available=% cu ledger prezent', v->>'available'; end if;
  if (v->>'ledger_count')::int < 3 then
    raise exception 'SV2 FAIL: ledger_count=% (asteptat >= 3)', v->>'ledger_count'; end if;
  if v->'missing' <> '[]'::jsonb then
    raise exception 'SV2 FAIL: numele coincid dar sonda raporteaza lipsuri (%) — compara pe version, nu pe name', v->'missing'; end if;
  if v->>'latest_name' <> 'migration_269_oblio_delivery_date' then
    raise exception 'SV2 FAIL: latest_name=% (asteptat 269)', v->>'latest_name'; end if;
  raise notice 'SV2 OK: cheia e NAME, versiunea de aplicare nu conteaza';
end $$;

-- ── SV3: decalaj la mijloc + la final → exact cele doua, sortate ─────────────
do $$
declare v jsonb;
begin
  v := public.get_schema_version(array['migration_264_audit_v3_council',
                                       'migration_266_database_size_probe',
                                       'migration_268_daily_payments_rpc',
                                       'migration_269_oblio_delivery_date',
                                       'migration_271_health_probes']);
  if v->'missing' <> '["migration_266_database_size_probe","migration_271_health_probes"]'::jsonb then
    raise exception 'SV3 FAIL: missing=% (asteptat 266 + 271, sortate)', v->'missing'; end if;
  raise notice 'SV3 OK: lipsurile din mijloc nu sunt ascunse de „ultimul e prezent”';
end $$;

-- ── SV4 + SV5 + SV6: suprafață, DEFINER, formă ──────────────────────────────
do $$
declare v jsonb; v_keys text[]; v_src text; v_cfg text[];
begin
  if has_function_privilege('anon', 'public.get_schema_version(text[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.get_schema_version(text[])', 'EXECUTE') then
    raise exception 'SV4 FAIL: rolurile client pot citi starea ledger-ului'; end if;
  if not has_function_privilege('service_role', 'public.get_schema_version(text[])', 'EXECUTE') then
    raise exception 'SV4 FAIL: service_role nu poate apela sonda — /health ar raporta unknown pentru totdeauna'; end if;

  select pg_get_functiondef(p.oid), p.proconfig into v_src, v_cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_schema_version';
  if position('security definer' in lower(v_src)) = 0 then
    raise exception 'SV5 FAIL: get_schema_version nu e DEFINER — pe prod service_role n-are USAGE pe supabase_migrations'; end if;
  if not exists (select 1 from unnest(v_cfg) c where c like 'search_path=%pg_temp%') then
    raise exception 'SV5 FAIL: search_path fara pg_temp'; end if;

  v := public.get_schema_version(array['migration_264_audit_v3_council']);
  select array_agg(k order by k) into v_keys from jsonb_object_keys(v) k;
  if v_keys is distinct from array['available','latest_name','latest_version','ledger_count','missing'] then
    raise exception 'SV6 FAIL: forma raspunsului s-a schimbat: %', v_keys; end if;
  raise notice 'SV4–SV6 OK: service_role-only, DEFINER+pg_temp, forma inghetata';
end $$;

rollback;
