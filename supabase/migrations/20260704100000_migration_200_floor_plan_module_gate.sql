-- mig 200 — Gate de modul pe RPC-urile publice de plan/disponibilitate (fix review)
-- ─────────────────────────────────────────────────────────────────────
-- Panelul de review pe rezervarea-cu-hartă (mig 199): get_public_floor_plan și
-- get_tables_availability NU aplicau gate-ul `is_module_enabled('reservations')`
-- pe care celelalte RPC-uri de rezervare îl au (check_availability mig 086,
-- create_reservation_public mig 199). Modulul e OFF by default (mig 086), deci
-- un anon putea enumera topologia meselor + ocuparea live pentru restaurante
-- care N-AU activat rezervările (leak Poarta D / regula 1 CLAUDE.md).
--
-- Recreez ambele RPC-uri (CREATE OR REPLACE — semnături neschimbate) cu gate-ul
-- de modul adăugat imediat după rezolvarea restaurantului din slug. Restul
-- corpului e VERBATIM din mig 199.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '60s';

-- ── get_public_floor_plan: + gate modul (null dacă modulul e OFF, ca la
-- restaurant inexistent — clientul ascunde harta grațios). ──────────
create or replace function public.get_public_floor_plan(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_restaurant_id uuid;
  v_layout        jsonb;
  v_tables        jsonb;
begin
  select id, floor_layout into v_restaurant_id, v_layout
  from public.restaurants
  where lower(slug) = lower(p_slug) and is_active = true;
  if v_restaurant_id is null then
    return null;
  end if;

  -- ★ Gate modul: fără rezervări activate, nu expunem planul/mesele.
  if not public.is_module_enabled(v_restaurant_id, 'reservations') then
    return null;
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', t.id, 'name', t.name, 'seats', t.seats, 'zone', t.zone
           ) order by t.name
         ), '[]'::jsonb)
    into v_tables
  from public.tables t
  where t.restaurant_id = v_restaurant_id and t.is_active = true;

  return jsonb_build_object(
    'floor_layout', v_layout,
    'tables',       v_tables
  );
end;
$$;

-- ── get_tables_availability: + gate modul (raise, ca check_availability). ──
create or replace function public.get_tables_availability(
  p_slug       text,
  p_starts_at  timestamptz,
  p_ends_at    timestamptz,
  p_party_size smallint default 1
)
returns table (
  table_id     uuid,
  table_name   text,
  seats        smallint,
  zone         text,
  is_available boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_restaurant_id uuid;
begin
  if p_ends_at <= p_starts_at then
    raise exception 'ends_at trebuie să fie după starts_at';
  end if;

  select id into v_restaurant_id
  from public.restaurants
  where lower(slug) = lower(p_slug) and is_active = true;
  if v_restaurant_id is null then
    raise exception 'Restaurantul nu a fost găsit';
  end if;

  -- ★ Gate modul: fără rezervări activate, nu expunem ocuparea meselor.
  if not public.is_module_enabled(v_restaurant_id, 'reservations') then
    raise exception 'Rezervările nu sunt activate pentru acest restaurant'
      using errcode = 'check_violation', hint = 'module_disabled';
  end if;

  return query
  select
    t.id, t.name, t.seats, t.zone,
    (t.seats is not null
     and t.seats >= greatest(p_party_size, 1)
     and not exists (
       select 1 from public.reservations r
       where r.restaurant_id = v_restaurant_id
         and r.table_id = t.id
         and r.status not in ('cancelled','no_show')
         and (r.starts_at, r.ends_at) overlaps (p_starts_at, p_ends_at)
     )) as is_available
  from public.tables t
  where t.restaurant_id = v_restaurant_id
    and t.is_active = true
  order by t.name;
end;
$$;

-- Grant-urile rămân (CREATE OR REPLACE nu le resetează), dar le reasertăm defensiv.
grant execute on function public.get_public_floor_plan(text) to anon, authenticated;
grant execute on function public.get_tables_availability(text, timestamptz, timestamptz, smallint)
  to anon, authenticated;

-- ── Aserție fail-closed: gate-ul de modul e prezent în ambele ────────
do $$
declare v_a text; v_b text;
begin
  select pg_get_functiondef(p.oid) into v_a
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='get_public_floor_plan';
  select pg_get_functiondef(p.oid) into v_b
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='get_tables_availability';
  if v_a is null or position('is_module_enabled' in v_a) = 0 then
    raise exception 'mig 200: gate-ul de modul lipsește din get_public_floor_plan';
  end if;
  if v_b is null or position('is_module_enabled' in v_b) = 0 then
    raise exception 'mig 200: gate-ul de modul lipsește din get_tables_availability';
  end if;
  raise notice 'mig 200: gate de modul pe RPC-urile de plan/disponibilitate OK';
end $$;

commit;
