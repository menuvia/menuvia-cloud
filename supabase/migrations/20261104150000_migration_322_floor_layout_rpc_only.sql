-- =============================================================================
-- Migration 322: harta sălii se scrie DOAR prin `save_floor_layout`
-- (lotul O7a, audit nov 2026 — pierderi de date)
-- =============================================================================
-- `restaurants.floor_layout` avea DOUĂ căi de scriere:
--   1. RPC-ul `save_floor_layout` (018 → 154 → 311): DEFINER `public, pg_temp`,
--      rol owner/manager (sau fondatorul, 311), gate de plan `floor_plan`
--      (doar pro/enterprise), `jsonb_typeof = 'object'` (hint `invalid_layout`)
--      și plafon de 1 MiB (hint `layout_too_large`);
--   2. grant-ul column-level `update (floor_layout)` pentru `authenticated` din
--      096B (Sec 5), deci un `PATCH /rest/v1/restaurants` direct.
-- Calea 2 ocolea TOATE cele patru gate-uri: reprodus sub rolul REAL
-- `authenticated`, un owner pe growth e refuzat de RPC cu `feature_disabled`,
-- dar `update restaurants set floor_layout = '[1,2,3]'` trece, la fel un blob
-- de 2,1 MB.
--
-- Mai grav, calea 2 era folosită fără intenție: formularul din Setări pornește
-- de la rândul încărcat la montare și îl trimite ÎNTREG (`pickAllowed` păstra
-- `floor_layout` în RESTAURANT_UPDATE_FIELDS), iar nimic nu reîmprospăta lista
-- după o salvare a hărții prin RPC. Deci: salvezi harta → mergi în Setări →
-- salvezi programul → harta VECHE (sau NULL) suprascrie tăcut harta nouă.
-- Reprodus pe un owner pro: după `save_floor_layout(NOU)`, un PATCH în forma
-- salvării din Setări, cu `floor_layout = null`, trece și lasă NULL.
--
-- Fix: revoke la nivel de COLOANĂ, pereche cu grant-ul pe coloană din 096B. Un
-- revoke pe TABEL ar lua automat și grant-urile pe TOATE celelalte coloane, deci
-- Setările n-ar mai salva nimic (asserția de mai jos ține ancora wifi_password).
-- Precedentele: `slug` (096B, doar prin `change_restaurant_slug`) și
-- `oblio_configs.api_secret` (287). Clientul a scos coloana din
-- RESTAURANT_UPDATE_FIELDS, iar editorul aplică harta salvată în listă prin
-- `onSaved` → `useRestaurants.patchLocal`.
--
-- Nicio funcție nu se creează sau recreează (regula DEFINER `public, pg_temp`
-- și revoke-ul explicit pentru funcții NOI nu se aplică); `save_floor_layout`
-- e DEFINER deținut de postgres, deci continuă să scrie. Citirile
-- (`get_public_floor_plan`, SELECT-ul din WaiterPage) nu sunt atinse. Nicio
-- dată nu se rescrie.
--
-- ORDINEA DE DEPLOY e OBLIGATORIE: FRONTEND ÎNTÂI, migrația DUPĂ. PostgREST
-- pune fiecare cheie din corp în lista SET, iar Postgres verifică privilegiul
-- de coloană indiferent de valoare — un client VECHI (al cărui PATCH din
-- Setări cară mereu `floor_layout`, chiar și null) ar primi 42501 la ORICE
-- salvare din Setări după revoke. Invers (client nou, DB veche) totul merge.
--
-- Înainte de `db push` pe prod, rulează (read-only) și consemnează rândurile:
--   select id, jsonb_typeof(floor_layout), octet_length(floor_layout::text),
--          public.restaurant_has_feature(id, 'floor_plan')
--     from public.restaurants
--    where floor_layout is not null
--      and (jsonb_typeof(floor_layout) <> 'object'
--           or octet_length(floor_layout::text) > 1048576
--           or not public.restaurant_has_feature(id, 'floor_plan'));
-- Hărțile scrise deja pe calea ocolitoare NU sunt curățate aici — decizie de
-- fondator.
--
-- Teste: FLW1–FLW3 `tests/sql/auto/322_floor_layout_rpc_only.sql` (ambele
-- medii) + RW1 (`restaurant_update_whitelist_assertions.sql`, whitelist-ul fără
-- `floor_layout`).
-- =============================================================================

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '60s';

revoke update (floor_layout) on table public.restaurants from public, anon, authenticated;

-- ── Asserție fail-closed ─────────────────────────────────────────────────────
do $$
declare
  r text;
  v_cfg text[];
begin
  foreach r in array array['anon', 'authenticated'] loop
    if has_column_privilege(r, 'public.restaurants', 'floor_layout', 'UPDATE') then
      raise exception 'mig 322: % poate încă scrie direct restaurants.floor_layout', r;
    end if;
  end loop;

  -- Ancoră: revoke-ul e pe COLOANĂ, nu pe tabel — Setările scriu în continuare.
  if not has_column_privilege('authenticated', 'public.restaurants', 'wifi_password', 'UPDATE') then
    raise exception 'mig 322: authenticated a pierdut UPDATE pe wifi_password — revoke prea larg';
  end if;

  -- Singura cale rămasă trebuie să existe și să fie apelabilă.
  if not has_function_privilege('authenticated', 'public.save_floor_layout(uuid,jsonb)', 'EXECUTE') then
    raise exception 'mig 322: authenticated nu mai poate apela save_floor_layout — harta n-ar mai avea nicio cale de scriere';
  end if;

  select p.proconfig into v_cfg
    from pg_proc p
   where p.oid = 'public.save_floor_layout(uuid,jsonb)'::regprocedure
     and p.prosecdef;
  if v_cfg is null or not ('search_path=public, pg_temp' = any (v_cfg)) then
    raise exception 'mig 322: save_floor_layout nu mai e SECURITY DEFINER cu search_path public, pg_temp (proconfig=%)', v_cfg;
  end if;

  raise notice 'mig 322 OK: floor_layout se scrie doar prin save_floor_layout';
end $$;

commit;
