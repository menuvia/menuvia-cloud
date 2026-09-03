-- migration_265_bridge_connection_status.sql
-- =============================================================================
-- Audit v3 — rangul 8: „Fiscalizare activă, casa nu e conectată".
--
-- PROBLEMA: pe Plan 3 (`fiscal_receipt`) restaurantul încasează normal, dar
-- dacă bridge-ul nu e conectat NU se emite niciun bon — tăcut. Fereastra e
-- exact ziua 1–14 a fiecărui client nou de 499 lei, adică perioada în care
-- riscul fiscal e maxim și nimeni nu se uită încă la BridgeTab.
--
-- DE CE UN RPC NOU și nu un `select` din client:
-- Mig 240 a ȘTERS politica „bridge_devices: members read" fiindcă expunea
-- `device_secret` oricărui waiter prin PostgREST. Rămâne doar
-- „bridge_devices: admin manage", deci un waiter/kitchen citește ZERO rânduri
-- și un banner construit pe interogarea directă ar spune fals „nu e conectată"
-- pe ecranul ospătarului. Testul SQ3 (`security_q4_assertions.sql`) îngheață
-- acea revocare — NU reintroduce politica de citire pentru membri.
--
-- DE CE `last_seen_at` și nu `status`:
-- `bridge_devices.status` e un flag LIPICIOS. Toate scrierile îl duc pe
-- 'online' (`bridge_heartbeat` mig 030, `bridge_validate_device` mig 045,
-- `bridge_get_pending`/`bridge_get_pending_tickets` mig 247/227) și NIMIC nu-l
-- readuce vreodată pe 'offline' — singura funcție care ar fi făcut-o,
-- `bridge_devices_mark_stale` (mig 035), scrie într-o coloană `is_active` care
-- nu există pe tabel, deci e moartă. Un bridge oprit rămâne 'online' la
-- nesfârșit. Liveness-ul real se citește DOAR din `last_seen_at`.
--
-- Pragul de 3 minute: bridge-ul bate la 30 s (`bridge/lib/config.js`,
-- heartbeatMs default 30000), iar heartbeat-ul condiționat din mig 247 scrie la
-- >25 s. Trei minute = 6 bătăi ratate, adică suficient cât să nu clipească
-- banner-ul la un blip de rețea, dar destul de strâns cât o casă oprită să
-- apară în aceeași tură.
--
-- SUPRAFAȚĂ: proiecție de 3 câmpuri, niciunul secret. NU întoarce
-- `device_secret`, `name`, `last_error` sau `fiscalnet_*` — dacă ai nevoie de
-- ele, e BridgeTab (admin, RLS).
--
-- Teste permanente BC1–BC5: tests/sql/bridge_connection_assertions.sql.
-- =============================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';

create or replace function public.bridge_connection_status(p_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
  v_last  timestamptz;
begin
  -- Gate de tenant EXPLICIT: funcția e DEFINER, deci ocolește RLS-ul care ar fi
  -- oprit un membru al altui restaurant. `is_member` acoperă owner + toate
  -- rolurile de staff, plus escape-urile de platformă/partener (mig 186/187).
  if not public.is_member(p_restaurant_id) then
    raise exception 'Not authorized for this restaurant'
      using errcode = 'P0001', hint = 'unauthorized';
  end if;

  select count(*), max(last_seen_at)
    into v_count, v_last
    from public.bridge_devices
   where restaurant_id = p_restaurant_id;

  return jsonb_build_object(
    'registered',   v_count > 0,
    'connected',    v_last is not null and v_last > now() - interval '3 minutes',
    'last_seen_at', v_last
  );
end;
$$;

revoke all on function public.bridge_connection_status(uuid) from public, anon;
grant execute on function public.bridge_connection_status(uuid) to authenticated;

comment on function public.bridge_connection_status(uuid) is
  'mig 265: liveness-ul bridge-ului pentru banner-ul „casa nu e conectata". Derivat din last_seen_at (status e lipicios), gate is_member, proiectie fara secrete. Citit de orice rol de staff — bridge_devices nu mai are politica members read (mig 240).';

-- ═════════════════════════════════════════════════════════════════════════════
-- Asserții fail-closed
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bridge_connection_status';
  if v_src is null then
    raise exception 'mig 265: bridge_connection_status lipseste'; end if;

  -- (a) Gate de tenant + liveness pe last_seen_at, nu pe status.
  if position('is_member' in v_src) = 0 then
    raise exception 'mig 265: bridge_connection_status a pierdut gate-ul is_member'; end if;
  if position('last_seen_at' in v_src) = 0 then
    raise exception 'mig 265: bridge_connection_status nu mai deriva liveness din last_seen_at'; end if;

  -- (b) ZERO secrete in proiectie. `status` e permis sa lipseasca, dar
  --     `device_secret` nu are voie sa apara nici macar in corp.
  if position('device_secret' in v_src) > 0 then
    raise exception 'mig 265: bridge_connection_status atinge device_secret'; end if;

  -- (c) Igiena obligatorie pentru DEFINER (mig 262 DM-05).
  if position('pg_temp' in v_src) = 0 then
    raise exception 'mig 265: bridge_connection_status fara pg_temp in search_path'; end if;

  -- (d) anon NU are voie sa o execute (nu e suprafata publica).
  if has_function_privilege('anon', 'public.bridge_connection_status(uuid)', 'EXECUTE') then
    raise exception 'mig 265: anon poate executa bridge_connection_status'; end if;
  if not has_function_privilege('authenticated', 'public.bridge_connection_status(uuid)', 'EXECUTE') then
    raise exception 'mig 265: authenticated NU poate executa bridge_connection_status'; end if;

  -- (e) Politica de citire pentru membri pe bridge_devices trebuie sa RAMANA
  --     stearsa (mig 240) — altfel device_secret redevine citibil de waiteri si
  --     RPC-ul asta nu mai are rost.
  if exists (select 1 from pg_policy pol join pg_class c on c.oid = pol.polrelid
              where c.relname = 'bridge_devices' and pol.polname = 'bridge_devices: members read') then
    raise exception 'mig 265: politica „bridge_devices: members read" a reaparut (mig 240 o interzice)'; end if;

  raise notice 'mig 265: bridge_connection_status OK (liveness din last_seen_at, gate is_member, fara secrete)';
end $$;

commit;
