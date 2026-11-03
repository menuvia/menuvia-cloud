-- mig 314 — „Toate locațiile” (lotul A): rezumatul zilei pe fiecare local
-- ─────────────────────────────────────────────────────────────────────────────
-- Decizia fondatorului: „Toate locațiile” e vizibil pentru ORICE admin
-- (proprietar SAU manager) cu ≥ 2 localuri la care e admin. Ecranul arată, pe
-- câte un card per local: comenzile de azi, câte sunt deschise acum, încasările
-- de azi (DOAR pe planurile cu bani) și ora ultimei comenzi.
--
-- ── get_locations_summary() → setof (id, name, slug, orders_today,
--    open_orders, revenue_today, last_order_at) ─────────────────────────────
-- SECURITY INVOKER deliberat (tiparul mig 268): RLS-ul pe `restaurants`,
-- `orders` și `restaurant_memberships` decide ce vede apelantul, iar gate-ul
-- fiscal al banilor vine MOȘTENIT din `get_daily_payments_by_method` →
-- `v_order_payment_methods` (267). Un DEFINER ar ocoli RLS-ul și m-ar obliga
-- să re-implementez gate-ul aici — exact tiparul care a produs gate-ul MORT
-- reparat în 267.
--
-- ── CINE apare: membership REAL owner/manager, nu doar `is_admin` ───────────
-- `is_admin` are escape-ul `is_platform_admin()` (186): pentru fondator e
-- adevărat pe ORICE restaurant al platformei, deci un filtru doar pe el ar fi
-- transformat „Toate locațiile” fondatorului într-o listă a TUTUROR clienților
-- (cu comenzile și încasările lor). „Toate locațiile” înseamnă localurile MELE:
-- filtrul e un rând în `restaurant_memberships` cu rolul `owner`/`manager`
-- pentru `auth.uid()` (invariantul 096: proprietarul are mereu rândul `owner`),
-- iar `is_admin` rămâne ca a doua condiție (defense-in-depth: o membership
-- `manager` pe care funelul n-ar recunoaște-o nu primește nimic). Clientul
-- numără EXACT aceleași rânduri (RestaurantContext, fără membership-ul
-- sintetic al vizitei de fondator) ca să decidă vizibilitatea ecranului.
-- Lista vine dintr-un helper DEFINER minuscul, `my_admin_restaurant_ids()`
-- (doar id-urile PROPRII cu rol owner/manager, nimic altceva): corpul INVOKER
-- nu cheamă `auth.uid()` direct, fiindcă sub `authenticated` asta cere USAGE
-- pe schema `auth` — prezent pe Supabase, absent pe Postgres-ul gol din
-- sql-verify (și niciun alt INVOKER din lanț nu-l cheamă direct). Tiparul e
-- cel al politicilor: funelul DEFINER citește identitatea, RLS-ul filtrează.
-- Ospătarul și bucătarul NU văd localul (rolul lor nu e admin), iar un local
-- unde ești doar ospătar nu apare nici în lista unui patron multi-local.
--
-- ── ZIUA e ziua ROMÂNIEI ────────────────────────────────────────────────────
-- `now()` convertit în Europe/Bucharest (Supabase rulează în UTC: o comandă la
-- 00:30 ora României e 21:30 UTC în ziua PRECEDENTĂ — clasa reparată de 269 /
-- 272), iar fereastra e jumătate-deschisă `[azi 00:00, mâine 00:00)` în fusul
-- României, ca în 268. Comenzile de azi = create azi, NEanulate; încasările de
-- azi = ziua ÎNCASĂRII (`paid_at`), aceeași convenție ca ReportsTab/268.
--
-- ── BANII: NULL pe planurile fără bani, nu 0 ────────────────────────────────
-- `v_order_payment_methods` are deja gate-ul fiscal în DATE (un local fără
-- `fiscal_receipt` nu are rânduri), dar „niciun rând” ar ieși `0` — adică un
-- „Încasări azi: 0 lei” afirmat pe un plan care nu ține banii deloc. De aceea
-- distincția e EXPLICITĂ: `restaurant_has_feature(id, 'fiscal_receipt')`
-- (care include și gate-ul pe țară, 296) → suma (0 dacă azi nu s-a încasat
-- nimic), altfel NULL. Clientul nu afișează câmpul pe NULL.
--
-- Suprafața: revoke explicit de la public/anon/authenticated/service_role,
-- grant EXECUTE DOAR `authenticated` (service_role n-are auth.uid(), deci n-ar
-- primi oricum nimic; anon nu are ce căuta lângă bani).
-- Teste LS1–LS6: tests/sql/auto/314_locations_summary.sql.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';

-- Helperul: id-urile restaurantelor unde apelantul are membership REAL
-- owner/manager. DEFINER (citește identitatea din JWT ca funelul 096a/286),
-- fără escape de fondator, fără partener. Nu e un oracol: întoarce doar
-- localurile proprii ale apelantului.
create or replace function public.my_admin_restaurant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.restaurant_id
    from public.restaurant_memberships m
   where m.user_id = auth.uid()
     and m.role in ('owner'::public.member_role, 'manager'::public.member_role)
$$;

comment on function public.my_admin_restaurant_ids() is
  'mig 314: id-urile restaurantelor unde apelantul are membership REAL owner/manager (fără escape-ul fondatorului). Sursa listei din get_locations_summary.';

revoke all on function public.my_admin_restaurant_ids() from public, anon, authenticated, service_role;
grant execute on function public.my_admin_restaurant_ids() to authenticated;

create or replace function public.get_locations_summary()
returns table (
  id            uuid,
  name          text,
  slug          text,
  orders_today  bigint,
  open_orders   bigint,
  revenue_today numeric,
  last_order_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with b as (
    select (now() at time zone 'Europe/Bucharest')::date as today
  )
  select r.id,
         r.name,
         r.slug,
         (select count(*)
            from public.orders o
           where o.restaurant_id = r.id
             and o.status <> 'cancelled'::order_status
             and o.created_at >= (b.today::timestamp at time zone 'Europe/Bucharest')
             and o.created_at <  ((b.today + 1)::timestamp at time zone 'Europe/Bucharest'))
           as orders_today,
         (select count(*)
            from public.orders o
           where o.restaurant_id = r.id
             and o.status in ('new'::order_status, 'confirmed'::order_status,
                              'preparing'::order_status, 'ready'::order_status,
                              'served'::order_status))
           as open_orders,
         case
           when public.restaurant_has_feature(r.id, 'fiscal_receipt')
           then coalesce((select sum(d.total_revenue)
                            from public.get_daily_payments_by_method(r.id, b.today, b.today) d),
                         0::numeric)
         end as revenue_today,
         (select max(o.created_at)
            from public.orders o
           where o.restaurant_id = r.id
             and o.status <> 'cancelled'::order_status)
           as last_order_at
    from public.restaurants r
   cross join b
   where r.id in (select public.my_admin_restaurant_ids())
     and public.is_admin(r.id)
   order by r.name, r.id;
$$;

comment on function public.get_locations_summary() is
  'mig 314: rezumatul zilei (ziua României) pe fiecare local unde apelantul are membership owner/manager. INVOKER: RLS + gate fiscal moștenite (get_daily_payments_by_method → v_order_payment_methods); revenue_today NULL pe planurile fără fiscal_receipt.';

revoke all on function public.get_locations_summary() from public, anon, authenticated, service_role;
grant execute on function public.get_locations_summary() to authenticated;

-- ── Asserții fail-closed ────────────────────────────────────────────────────
do $$
declare v_oid oid; v_secdef boolean; v_vol "char"; v_cfg text[]; v_src text; v_n int;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_locations_summary';
  if v_n <> 1 then
    raise exception 'mig 314: get_locations_summary are % semnături (trebuie exact 1)', v_n; end if;

  select p.oid, p.prosecdef, p.provolatile, p.proconfig, p.prosrc
    into v_oid, v_secdef, v_vol, v_cfg, v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_locations_summary';

  -- (a) INVOKER: RLS-ul și gate-ul fiscal vin moștenite.
  if v_secdef then
    raise exception 'mig 314: get_locations_summary a devenit SECURITY DEFINER — ar ocoli RLS-ul'; end if;
  -- (b) search_path cu pg_temp (194/262).
  if v_cfg is null or not (v_cfg @> array['search_path=public, pg_temp']) then
    raise exception 'mig 314: search_path fără public, pg_temp (%)', v_cfg; end if;
  if v_vol <> 's' then
    raise exception 'mig 314: funcția trebuie să fie STABLE (e %)', v_vol; end if;
  -- (c) suprafața: doar authenticated.
  if has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception 'mig 314: anon poate executa get_locations_summary'; end if;
  if has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'mig 314: service_role poate executa get_locations_summary'; end if;
  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'mig 314: authenticated NU poate executa get_locations_summary'; end if;
  -- (d) banii trec prin sursa unică (gate fiscal moștenit) + NULL explicit.
  if position('get_daily_payments_by_method' in v_src) = 0 then
    raise exception 'mig 314: încasările nu mai derivă din get_daily_payments_by_method (gate fiscal pierdut)'; end if;
  if position('restaurant_has_feature(r.id, ''fiscal_receipt'')' in v_src) = 0 then
    raise exception 'mig 314: lipsește distincția NULL pe planurile fără fiscal_receipt'; end if;
  -- (e) lista = membership REAL owner/manager (fără escape-ul fondatorului).
  if position('my_admin_restaurant_ids()' in v_src) = 0 then
    raise exception 'mig 314: filtrul pe membership-ul real a dispărut — fondatorul ar vedea toată platforma'; end if;

  -- (f) helperul: DEFINER cu pg_temp, fără escape de fondator, doar authenticated.
  select p.oid, p.prosecdef, p.proconfig, p.prosrc into v_oid, v_secdef, v_cfg, v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'my_admin_restaurant_ids';
  if v_oid is null or not v_secdef or v_cfg is null
     or not (v_cfg @> array['search_path=public, pg_temp']) then
    raise exception 'mig 314: my_admin_restaurant_ids lipsește sau nu e DEFINER cu public, pg_temp'; end if;
  if position('is_platform_admin' in v_src) > 0 or position('is_admin' in v_src) > 0
     or position('has_partner_access' in v_src) > 0 then
    raise exception 'mig 314: my_admin_restaurant_ids are un escape (fondator/partener)'; end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE')
     or has_function_privilege('service_role', v_oid, 'EXECUTE')
     or not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'mig 314: suprafața lui my_admin_restaurant_ids e greșită'; end if;

  raise notice 'mig 314: get_locations_summary OK (INVOKER, STABLE, public+pg_temp, doar authenticated)';
end $$;

commit;
