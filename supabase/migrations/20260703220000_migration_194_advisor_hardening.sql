-- mig 194 — igienă din Supabase security advisors (prod, 2026-07-02)
-- ─────────────────────────────────────────────────────────────────────
-- Advisors rulate pe producție: 0 ERROR, dar două categorii WARN reale,
-- nefixate nicăieri în repo:
--
-- (1) function_search_path_mutable — 14 funcții vechi (trigger-e și helpere
--     din migrațiile timpurii) fără `search_path` fixat. Toate cele noi îl
--     au prin convenția lockdown; astea au scăpat. Un search_path mutabil
--     pe SECURITY DEFINER/trigger permite umbrirea obiectelor prin pg_temp
--     sau scheme controlate de atacator. Fix: ALTER FUNCTION ... SET
--     search_path (nu redefinim corpurile — ALTER păstrează trigger-ele
--     și dependențele; semnăturile se rezolvă dinamic din pg_proc).
--
-- (2) public_bucket_allows_listing — bucket-ul public `product-images` are
--     două politici SELECT largi pe storage.objects („public_read" din
--     base_schema + „product-images: public read" din mig 015) care permit
--     ORICUI să enumere toate fișierele (căi cu user_id/restaurant_id în
--     nume). Servirea imaginilor NU depinde de ele: bucket-ul e `public`,
--     iar frontend-ul folosește doar upload + getPublicUrl (verificat:
--     zero `.list()`/`.download()` în src/ și netlify/). Upload/update/
--     delete au politicile lor proprii (owner-scoped) — rămân neatinse.
--
-- Rămâne pe dashboard (nu e migrabilă): Auth → Password security →
-- „Leaked password protection" (HaveIBeenPwned) e dezactivată.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '60s';

-- ── 1. search_path fixat pe cele 14 funcții flagate ─────────────────
do $$
declare
  r record;
  v_count int := 0;
begin
  for r in
    select p.oid,
           n.nspname,
           p.proname,
           pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
             'bootstrap_restaurant_owner',
             'bridge_devices_touch',
             'check_ai_import_quota',
             'compute_google_review_url',
             'fn_restaurants_owner_id_immutable',
             'init_onboarding_state',
             'init_restaurant_settings',
             'is_valid_phone',
             'log_ai_import',
             'owner_plan',
             'set_updated_at',
             'stamp_order_timestamps',
             'tables_normalize_zone',
             'trg_oblio_configs_touch'
           )
       -- doar cele care chiar nu au search_path (idempotent la re-run)
       and (p.proconfig is null
            or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
  loop
    execute format('alter function %I.%I(%s) set search_path = public, pg_temp',
                   r.nspname, r.proname, r.args);
    v_count := v_count + 1;
  end loop;
  raise notice 'mig 194: search_path fixat pe % funcții', v_count;
end $$;

-- ── 2. Fără enumerarea bucket-ului public ───────────────────────────
-- Politicile de INSERT/UPDATE/DELETE (owner-scoped, base_schema + mig 015)
-- rămân; cad doar cele două SELECT-uri largi. getPublicUrl continuă să
-- funcționeze — servirea obiectelor din bucket public nu trece prin RLS.
drop policy if exists "public_read" on storage.objects;
drop policy if exists "product-images: public read" on storage.objects;

-- ── Asserții fail-closed ────────────────────────────────────────────
do $$
declare
  v_missing text;
  v_listing int;
begin
  -- (1) toate cele 14 au acum search_path în proconfig
  select string_agg(p.proname, ', ') into v_missing
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
           'bootstrap_restaurant_owner','bridge_devices_touch','check_ai_import_quota',
           'compute_google_review_url','fn_restaurants_owner_id_immutable',
           'init_onboarding_state','init_restaurant_settings','is_valid_phone',
           'log_ai_import','owner_plan','set_updated_at','stamp_order_timestamps',
           'tables_normalize_zone','trg_oblio_configs_touch'
         )
     and (p.proconfig is null
          or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'));
  if v_missing is not null then
    raise exception 'mig 194: funcții rămase fără search_path: %', v_missing;
  end if;

  -- (2) nicio politică SELECT largă rămasă pe product-images
  select count(*) into v_listing
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and cmd = 'SELECT'
     and policyname in ('public_read', 'product-images: public read');
  if v_listing > 0 then
    raise exception 'mig 194: politicile de listare publică încă există';
  end if;

  -- Politicile owner-scoped de scriere NU trebuie să fi dispărut.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and cmd = 'INSERT'
  ) then
    raise exception 'mig 194: politicile de upload au dispărut — regresie';
  end if;

  raise notice 'mig 194: hardening advisors OK (search_path + bucket listing)';
end $$;

commit;
