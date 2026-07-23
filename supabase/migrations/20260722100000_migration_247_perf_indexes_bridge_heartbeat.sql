-- Migration 247: performanță — indexuri afiliere/owner + heartbeat bridge condiționat (OPT-R2)
-- ─────────────────────────────────────────────────────────────────────
-- Pur ADITIV pe citiri (indexuri) + reducere de SCRIERI redundante (heartbeat).
--
-- 1. restaurants(owner_id): fiecare încărcare de dashboard filtrează
--    restaurants pe owner_id (useData.ts), plus lanțul has_partner_access
--    (mig 187) și admin_list_affiliates (mig 236) fac join owner_id — fără
--    index → seq scan. La fel cum orders are deja index pe restaurant_id.
-- 2. affiliate_attributions(affiliate_id): subquery per-afiliat în
--    admin_list_affiliates/get_affiliate_dashboard filtrează pe affiliate_id
--    (doar UNIQUE pe referred_profile_id exista, mig 097).
-- 3. reservations(starts_at) NEpartial: count-ul necondiționat din
--    admin_platform_overview.reservations_today (mig 186) nu putea folosi
--    indexurile existente (parțiale pe status, sau conduse de restaurant_id);
--    la fel cum orders_today e servit de orders_created_at_idx (mig 003).
-- 4. bridge_get_pending (1-arg mig 030 + 2-arg mig 045) și
--    bridge_get_pending_tickets (mig 227): heartbeat-ul UPDATE pe
--    bridge_devices rula NECONDIȚIONAT la fiecare poll (5s) — ~17-35k
--    scrieri/zi/device + trigger touch. Devine CONDIȚIONAT (scrie doar dacă
--    e stale >25s sau nu e 'online'). Corpurile SELECT rămân BYTE-IDENTICE
--    (fetch-ul de bonuri/tichete neatins); doar heartbeat-ul se rărește.
--    Contractul, semnăturile, gate-urile și granturile rămân IDENTICE.
-- ─────────────────────────────────────────────────────────────────────
begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── 1-3. Indexuri pur aditive ────────────────────────────────────────
create index if not exists restaurants_owner_id_idx
  on public.restaurants (owner_id);
comment on index public.restaurants_owner_id_idx is
  'Dashboard load (useData.ts) + join owner_id în afiliere/partener (mig 247).';

create index if not exists affiliate_attributions_affiliate_idx
  on public.affiliate_attributions (affiliate_id);
comment on index public.affiliate_attributions_affiliate_idx is
  'Subquery per-afiliat în admin_list_affiliates/get_affiliate_dashboard (mig 247).';

create index if not exists reservations_starts_at_idx
  on public.reservations (starts_at);
comment on index public.reservations_starts_at_idx is
  'Count necondiționat reservations_today din admin_platform_overview (mig 186, mig 247).';

-- ── 4a. bridge_get_pending (1-arg, lanț 030) — heartbeat condiționat ──
create or replace function public.bridge_get_pending(p_device_secret text)
returns table (
  id            uuid,
  order_id      uuid,
  payload       text,
  retry_count   smallint,
  created_at    timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
begin
  select restaurant_id into v_restaurant_id
    from public.bridge_devices
   where device_secret = p_device_secret;

  if not found then
    raise exception 'Invalid device secret';
  end if;

  -- mig 247: heartbeat CONDIȚIONAT — la poll de 5s scriam necondiționat
  -- ~17-35k rânduri/zi + trigger touch. Acum doar dacă e stale >25s sau
  -- statusul nu e 'online' (recuperare din offline).
  update public.bridge_devices
     set last_seen_at = now(),
         status       = 'online'
   where device_secret = p_device_secret
     and (last_seen_at is null
          or last_seen_at < now() - interval '25 seconds'
          or status is distinct from 'online');

  return query
    select pr.id, pr.order_id, pr.payload, pr.retry_count, pr.created_at
      from public.pending_receipts pr
     where pr.restaurant_id = v_restaurant_id
       and pr.status = 'pending'
     order by pr.created_at
     limit 10;
end;
$$;

revoke all on function public.bridge_get_pending(text) from public;
grant execute on function public.bridge_get_pending(text) to anon, authenticated;

-- ── 4b. bridge_get_pending (2-arg, lanț 045) — heartbeat condiționat ──
create or replace function public.bridge_get_pending(
  p_device_secret text,
  p_limit         integer
)
returns table (
  id            uuid,
  order_id      uuid,
  payload       text,
  retry_count   smallint,
  created_at    timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_limit         integer;
begin
  select restaurant_id into v_restaurant_id
    from public.bridge_devices
   where device_secret = p_device_secret;

  if not found then
    raise exception 'Invalid device secret';
  end if;

  update public.bridge_devices
     set last_seen_at = now(),
         status       = 'online'
   where device_secret = p_device_secret
     and (last_seen_at is null
          or last_seen_at < now() - interval '25 seconds'
          or status is distinct from 'online');

  v_limit := greatest(1, least(coalesce(p_limit, 5), 20));

  return query
    select pr.id, pr.order_id, pr.payload, pr.retry_count, pr.created_at
      from public.pending_receipts pr
     where pr.restaurant_id = v_restaurant_id
       and pr.status = 'pending'
     order by pr.created_at
     limit v_limit;
end;
$$;

revoke all on function public.bridge_get_pending(text, integer) from public;
grant execute on function public.bridge_get_pending(text, integer) to anon, authenticated;

-- ── 4c. bridge_get_pending_tickets (mig 227) — heartbeat condiționat ──
create or replace function public.bridge_get_pending_tickets(
  p_device_secret text,
  p_limit         integer default 5
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant_id uuid;
  v_limit         integer;
begin
  -- Device-ul TREBUIE să aibă tipărirea de tichete pornită — fără să divulgăm
  -- prin mesaj diferența dintre „secret greșit" și „flag oprit".
  select restaurant_id into v_restaurant_id
    from public.bridge_devices
   where device_secret = p_device_secret and prints_kitchen_receipts = true;
  if not found then
    raise exception 'Invalid device secret';
  end if;

  update public.bridge_devices
     set last_seen_at = now(), status = 'online'
   where device_secret = p_device_secret
     and (last_seen_at is null
          or last_seen_at < now() - interval '25 seconds'
          or status is distinct from 'online');

  -- Downgrade sub growth → coada devine mută (fără eroare la bridge).
  if not public.restaurant_has_feature(v_restaurant_id, 'kitchen_tickets') then
    return '[]'::jsonb;
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 5), 20));

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', kt.id, 'order_id', kt.order_id, 'payload', kt.payload,
             'retry_count', kt.retry_count, 'created_at', kt.created_at
           ) order by kt.created_at)
      from (
        select * from public.kitchen_tickets
        where restaurant_id = v_restaurant_id and status = 'pending'
        order by created_at
        limit v_limit
      ) kt
  ), '[]'::jsonb);
end$$;

revoke all on function public.bridge_get_pending_tickets(text, integer) from public;
grant execute on function public.bridge_get_pending_tickets(text, integer) to anon, authenticated;

-- ── Asserții fail-closed ─────────────────────────────────────────────
do $$
declare v_src text;
begin
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='restaurants_owner_id_idx') then
    raise exception 'mig 247: restaurants_owner_id_idx lipsește'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='affiliate_attributions_affiliate_idx') then
    raise exception 'mig 247: affiliate_attributions_affiliate_idx lipsește'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='reservations_starts_at_idx') then
    raise exception 'mig 247: reservations_starts_at_idx lipsește'; end if;

  -- Heartbeat condiționat prezent în toate cele 3 RPC-uri; fetch-ul de bonuri
  -- (pending_receipts) rămâne în 1-arg + 2-arg, tichetele (kitchen_tickets) în tickets.
  select pg_get_functiondef(p.oid) into v_src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='bridge_get_pending' and p.pronargs=1;
  if v_src is null or position('25 seconds' in v_src) = 0 or position('pending_receipts' in v_src) = 0 then
    raise exception 'mig 247: bridge_get_pending(1) heartbeat/fetch invalid'; end if;

  select pg_get_functiondef(p.oid) into v_src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='bridge_get_pending' and p.pronargs=2;
  if v_src is null or position('25 seconds' in v_src) = 0 or position('pending_receipts' in v_src) = 0 then
    raise exception 'mig 247: bridge_get_pending(2) heartbeat/fetch invalid'; end if;

  select pg_get_functiondef(p.oid) into v_src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='bridge_get_pending_tickets';
  if v_src is null or position('25 seconds' in v_src) = 0 or position('kitchen_tickets' in v_src) = 0 then
    raise exception 'mig 247: bridge_get_pending_tickets heartbeat/fetch invalid'; end if;
  if position('prints_kitchen_receipts' in v_src) = 0 then
    raise exception 'mig 247: gate-ul prints_kitchen_receipts (mig 227) s-a pierdut'; end if;

  raise notice 'mig 247: indexuri + heartbeat bridge condiționat OK';
end $$;

commit;
