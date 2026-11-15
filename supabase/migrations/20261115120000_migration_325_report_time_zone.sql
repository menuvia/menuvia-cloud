-- migration_325_report_time_zone.sql
-- =============================================================================
-- G2b: „Toate locațiile” judecă „azi” pe ZIUA DE RAPORTARE a fiecărui local;
-- regula ei stă într-un singur helper, apelabil și din obiectele INVOKER.
--
-- ── Problema ────────────────────────────────────────────────────────────────
-- `get_locations_summary` (314) calcula „azi” pe fusul Bucureștiului pentru
-- ORICE local: un restaurant din New York vedea „Comenzi azi” resetat la 17:00
-- (miezul nopții la București), iar comenzile de după 17:00 cădeau pe ziua de
-- mâine. G2a (324) a pus fusul localului în SQL prin `restaurant_time_zone`, dar
-- helperul e INVOKER și închis pentru TOATE rolurile client, iar
-- `get_locations_summary` e INVOKER deliberat (RLS-ul și gate-ul fiscal vin
-- moștenite, LS5) — deci nu-l putea chema (capcana (b) din G2a, RZ5).
--
-- ── Regula: ziua de RAPORTARE ───────────────────────────────────────────────
-- `report_time_zone(uuid)`: țara 'RO' → București; altfel fusul localului
-- (`restaurant_time_zone`, 324). Pe un local românesc banii stau pe ziua
-- ROMÂNEASCĂ a încasării (267/268/272: `get_daily_payments_by_method`,
-- `v_daily_orders`, `vat_report_daily`), deci numărătorile trebuie să stea pe
-- aceeași zi — altfel pe un local RO cu `timezone` ≠ București același ecran ar
-- avea două definiții de „azi” (comenzile pe ora Londrei, banii pe a
-- Bucureștiului). Pe un local din afara României nu există bani în panou
-- (`feature_requires_ro`, 296), deci ziua lui e ziua lui.
-- Regula e pe ȚARĂ, nu pe plan și nu pe fus: `fiscal_receipt` comută la un
-- downgrade (ziua s-ar muta odată cu planul), iar `timezone` îl scrie orice admin;
-- țara o schimbă doar owner-ul sau fondatorul (`trg_restaurants_country_owner_only`,
-- 296). Oglinda din client: `reportTimeZone(restaurant)` din src/lib/dates.ts.
--
-- ── Cum află un INVOKER fusul ───────────────────────────────────────────────
-- `report_time_zone` e DEFINER (rulează ca proprietarul, același cu al lui
-- `restaurant_time_zone` — asertat mai jos), cu gate `is_member` și EXECUTE doar
-- pentru `authenticated`. Nu e un oracol: un ne-membru primește fusul implicit,
-- nu fusul localului. Ne-membru / restaurant inexistent / NULL → București, nu
-- NULL: `at time zone NULL` dă o fereastră NULL, adică zero rânduri TĂCUT.
-- Ramura RO scurtcircuitează ÎNAINTEA căii lente: scurtătura din 324 acoperă doar
-- șirul exact al fusului implicit, deci un local RO cu fus Londra ar fi plătit
-- scanarea `pg_timezone_names` (~10 ms) fără să-i folosească rezultatul.
--
-- ── `get_locations_summary` 314 → 325 ───────────────────────────────────────
-- DROP + CREATE: tipul de RETURN primește coloana `day_time_zone` (la FINAL) =
-- fusul în care serverul a judecat „azi”. Clientul afișează „Ultima comandă” pe
-- ACEST fus, nu pe `restaurant.timezone` (pe un local RO cu fus Londra ar
-- contrazice „Comenzi azi”). Fusul se evaluează O DATĂ per local, într-un CTE
-- `MATERIALIZED` (barieră de optimizare): un apel corelat în fiecare subinterogare
-- s-ar evalua per subinterogare (de până la șapte ori per local, ~10 ms fiecare
-- pe calea lentă), iar fără MATERIALIZED planificatorul poate inlinia CTE-ul și
-- reevalua expresia (capcana (a) din G2a). MĂSURAT pe replay (PG 16), 100 000 de
-- comenzi în 10 localuri (6 RO/București, 2 RO/Londra, 2 SUA/New York), sub
-- `authenticated` REAL, 6 apeluri fiecare: varianta de mai jos 173–234 ms per
-- apel, la fel ca 314 (178–265 ms, fereastra fixă, fără niciun fus); aceeași
-- interogare fără MATERIALIZED 252–392 ms; fusul cerut în fiecare subinterogare
-- 250–398 ms. Restul costului e RLS-ul per rând pe `orders` (vezi INVOKER, mai jos).
-- `revenue_today` rămâne pe `get_daily_payments_by_method(id, today, today)`:
-- pe orice local cu bani (fiscal ⇒ RO ⇒ București) `today` e ziua românească
-- prin construcție — nu există a doua definiție a zilei banilor. INVOKER rămâne
-- (LS5); același corp ca DEFINER, pe aceeași fixtură, ar costa 37–58 ms în loc de
-- 197–259 ms (RLS-ul per rând pe `orders` dispare) — o decizie de performanță
-- SEPARATĂ, care cere rescrierea LS5 și a raționamentului 314, consemnată în
-- CLAUDE.md, nu strecurată aici.
--
-- ── Rămân pe București, DELIBERAT (fără recreare) ───────────────────────────
-- `report_by_hour` (033→122) și `v_hourly_distribution` (116): consumate DOAR pe
-- suprafața fiscală românească (`fetchHourlySales` sub `fiscalReports`;
-- AnalyticsTab pe `analyticsAccess === 'full'`), unde ziua de raportare ESTE
-- Bucureștiul. FZ7 îngheață CONSECVENȚA (pe un local RO cu fus Londra, 00:30 ora
-- României e ora 0 în ambele și intră în „azi”), nu literalul. Un view
-- `security_invoker` nu poate chema helperul DEFINER per rând fără să plătească
-- un apel per rând, iar `at time zone r.timezone` brut aruncă la primul fus
-- invalid (coloana n-are CHECK) — dacă histograma se deschide vreodată pe planuri
-- fără bani, calea e un RPC DEFINER cu fusul în variabilă.
--
-- ── Lanțuri ─────────────────────────────────────────────────────────────────
--   get_locations_summary  314→**325** (DROP + CREATE: tip de retur nou)
--   NOU: report_time_zone(uuid), zoned_day_start(date, text)
-- Pentru localurile din România (toate de azi pe producție, toate pe București)
-- comportamentul e IDENTIC: FZ1 compară cu formula 314 calculată inline.
-- Migrația conține DROP FUNCTION → pe producție o aplică FONDATORUL (SQL editor).
--
-- ── Invariante păstrate (LS1–LS6 pe starea FINALĂ a lanțului) ───────────────
--   O singură semnătură; INVOKER; STABLE; `search_path = public, pg_temp`; lista
--   = `my_admin_restaurant_ids()` ȘI `is_admin(...)` (fără escape de fondator,
--   LS3); `cancelled` exclus din orders_today și last_order_at; open_orders
--   NEfiltrat pe zi; banii prin `get_daily_payments_by_method` cu CASE pe
--   `restaurant_has_feature(.., 'fiscal_receipt')` → NULL, nu 0; fereastra
--   jumătate-deschisă [azi 00:00, mâine 00:00) în fusul zilei; EXECUTE doar
--   `authenticated`. Asserțiile de mai jos + FZ5/FZ6 (tests/sql/auto/325_*) le țin.
--
-- Teste permanente FZ0–FZ8: tests/sql/auto/325_report_time_zone.sql
-- =============================================================================

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── §0. Precondiții + distribuția (de văzut la aplicare) ────────────────────
do $$
declare
  v_dist text;
  v_ro_other text;
begin
  -- 325 e stacked pe 324 (helperul fusului localului).
  if to_regprocedure('public.restaurant_time_zone(uuid)') is null then
    raise exception 'mig 325: lipsește public.restaurant_time_zone(uuid) — aplică întâi mig 324';
  end if;
  if to_regprocedure('public.get_daily_payments_by_method(uuid, date, date)') is null
     or to_regprocedure('public.my_admin_restaurant_ids()') is null
     or to_regprocedure('public.restaurant_has_feature(uuid, text)') is null then
    raise exception 'mig 325: lipsesc dependențele lui get_locations_summary (268/314/296)';
  end if;

  -- Ziua de raportare a fiecărui local, calculată DIRECT (fără gate-ul de
  -- membru al helperului: migrația rulează fără JWT). Pe producție, așteptat:
  -- totul pe București.
  select string_agg(format('%s → %s = %s', country, tz, n), ', ' order by n desc, country, tz)
    into v_dist
    from (select country,
                 case when country = 'RO' then 'Europe/Bucharest'
                      when timezone = 'Europe/Bucharest' then timezone
                      else public.safe_time_zone(timezone) end as tz,
                 count(*) as n
            from public.restaurants
           group by 1, 2) d;
  raise notice 'mig 325: ziua de raportare (țară → fus): %', coalesce(v_dist, '(niciun restaurant)');

  -- Localurile românești cu alt fus: rapoartele/Acasă/Locațiile rămân pe
  -- București, Rezervările și harta urmează fusul lor (regula operațională, 298).
  select string_agg(format('%s (%s)', slug, timezone), ', ' order by slug)
    into v_ro_other
    from public.restaurants
   where country = 'RO'
     and timezone is distinct from 'Europe/Bucharest';
  if v_ro_other is not null then
    raise notice 'mig 325: localuri din România cu alt fus (ziua de raportare rămâne București; rezervările/harta urmează fusul lor): %', v_ro_other;
  end if;
end $$;

-- ── §1. report_time_zone: ziua de RAPORTARE a unui local ────────────────────
create or replace function public.report_time_zone(p_restaurant_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_country text;
begin
  -- Ne-membru, restaurant necunoscut, NULL: fusul implicit, nu NULL (o fereastră
  -- `at time zone NULL` ar întoarce zero rânduri fără eroare) și nu fusul real
  -- al localului (helperul nu e un oracol pentru străini).
  if p_restaurant_id is null or not coalesce(public.is_member(p_restaurant_id), false) then
    return 'Europe/Bucharest';
  end if;
  select r.country into v_country from public.restaurants r where r.id = p_restaurant_id;
  -- România (sau țară necunoscută): ziua românească, ca banii (267/268/272).
  -- Scurtătura stă ÎNAINTEA căii lente — un local RO cu alt fus nu plătește
  -- scanarea catalogului de fusuri.
  if not found or v_country is null or v_country = 'RO' then
    return 'Europe/Bucharest';
  end if;
  return public.restaurant_time_zone(p_restaurant_id);
end;
$$;

comment on function public.report_time_zone(uuid) is
  'mig 325: fusul ZILEI DE RAPORTARE — țara RO (sau necunoscută) → București, altfel restaurant_time_zone (324). DEFINER cu gate is_member (ne-membru/necunoscut → București, nu NULL), EXECUTE doar authenticated: calea prin care un obiect INVOKER (get_locations_summary) află fusul. Oglinda reportTimeZone din src/lib/dates.ts.';

revoke all on function public.report_time_zone(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.report_time_zone(uuid) to authenticated;

-- ── §1b. zoned_day_start: primul instant al unei zile în fusul dat ──────────
-- `p_day::timestamp at time zone p_tz` NU e mereu începutul zilei: unde ceasul
-- se dă ÎNAPOI chiar la miezul nopții (America/Havana, 1 nov 2026: 01:00 CDT →
-- 00:00 CST), ora 00:00 apare de DOUĂ ori, iar Postgres alege a DOUA apariție
-- (ofsetul de după tranziție) — 05:00Z în loc de 04:00Z. Ziua de 31 oct se
-- termina atunci la 05:00Z, dar `(now() at time zone tz)::date` dădea deja
-- 1 nov de la 04:00Z: o oră pe an, comenzile nu cădeau în NICIO zi, iar
-- „Comenzi azi” de pe Toate locațiile contrazicea Acasă (clientul,
-- `zonedDayStartMs`, alege corect PRIMA apariție, DZ4). Al doilea candidat,
-- 23:59 din ziua precedentă + 1 minut, e începutul real pe tranzițiile la
-- miezul nopții (în ambele sensuri); `least` cu forma veche lasă rezultatul
-- IDENTIC în orice altă zi (o tranziție care sare peste miezul nopții, ex.
-- 23:30 → 00:30, rămâne exact cât era: ambele forme dau același instant).
-- INVOKER, fără acces la date, EXECUTE pentru `authenticated` (îl cheamă
-- `get_locations_summary`, INVOKER). Un fus invalid aruncă — apelanții îl
-- primesc din `report_time_zone`, care validează. Teste: FZ8.
create or replace function public.zoned_day_start(p_day date, p_tz text)
returns timestamptz
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select least(p_day::timestamp at time zone p_tz,
               ((p_day::timestamp - interval '1 minute') at time zone p_tz) + interval '1 minute');
$$;

comment on function public.zoned_day_start(date, text) is
  'mig 325: primul instant al zilei p_day în fusul p_tz — corect și pe tranzițiile de oră de vară la miezul nopții (America/Havana: 00:00 apare de două ori, se ia PRIMA apariție). Oglinda zonedDayStartMs din src/lib/dates.ts. INVOKER, fără date; EXECUTE doar authenticated (get_locations_summary).';

revoke all on function public.zoned_day_start(date, text)
  from public, anon, authenticated, service_role;
grant execute on function public.zoned_day_start(date, text) to authenticated;

-- ── §2. get_locations_summary 314 → 325 ─────────────────────────────────────
-- Tipul de retur se schimbă (coloana nouă la FINAL) → DROP + CREATE; `or
-- replace` doar ca migrația să fie re-rulabilă (tiparul 273).
drop function if exists public.get_locations_summary();

create or replace function public.get_locations_summary()
returns table (
  id            uuid,
  name          text,
  slug          text,
  orders_today  bigint,
  open_orders   bigint,
  revenue_today numeric,
  last_order_at timestamptz,
  day_time_zone text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  -- Localurile MELE (membership real owner/manager, fără escape de fondator),
  -- cu fusul zilei de raportare evaluat O DATĂ per local: CTE-ul materializat e
  -- barieră de optimizare, deci helperul nu se repetă per subinterogare.
  with mine as materialized (
    select r.id, r.name, r.slug, public.report_time_zone(r.id) as tz
      from public.restaurants r
     where r.id in (select public.my_admin_restaurant_ids())
       and public.is_admin(r.id)
  ), d as (
    select m.id, m.name, m.slug, m.tz, (now() at time zone m.tz)::date as today
      from mine m
  ), w as (
    select d.*,
           public.zoned_day_start(d.today, d.tz)     as day_start,
           public.zoned_day_start(d.today + 1, d.tz) as day_end
      from d
  )
  select d.id,
         d.name,
         d.slug,
         (select count(*)
            from public.orders o
           where o.restaurant_id = d.id
             and o.status <> 'cancelled'::order_status
             and o.created_at >= d.day_start
             and o.created_at <  d.day_end)
           as orders_today,
         (select count(*)
            from public.orders o
           where o.restaurant_id = d.id
             and o.status in ('new'::order_status, 'confirmed'::order_status,
                              'preparing'::order_status, 'ready'::order_status,
                              'served'::order_status))
           as open_orders,
         -- Banii doar pe planurile care îi țin; pe ele ziua e cea românească
         -- (fiscal ⇒ RO), exact ziua pe care o grupează sursa unică (268).
         case
           when public.restaurant_has_feature(d.id, 'fiscal_receipt')
           then coalesce((select sum(p.total_revenue)
                            from public.get_daily_payments_by_method(d.id, d.today, d.today) p),
                         0::numeric)
         end as revenue_today,
         (select max(o.created_at)
            from public.orders o
           where o.restaurant_id = d.id
             and o.status <> 'cancelled'::order_status)
           as last_order_at,
         d.tz as day_time_zone
    from w d
   order by d.name, d.id;
$$;

comment on function public.get_locations_summary() is
  'mig 314→325: rezumatul zilei pe fiecare local unde apelantul are membership owner/manager; ziua = ziua de RAPORTARE (report_time_zone: RO → București, altfel fusul localului), întoarsă ca day_time_zone. INVOKER: RLS + gate fiscal moștenite (get_daily_payments_by_method → v_order_payment_methods); revenue_today NULL pe planurile fără fiscal_receipt.';

revoke all on function public.get_locations_summary()
  from public, anon, authenticated, service_role;
grant execute on function public.get_locations_summary() to authenticated;

-- ── §3. Asserții fail-closed ────────────────────────────────────────────────
do $$
declare
  c_rtz constant text := 'public.report_time_zone(uuid)';
  c_gls constant text := 'public.get_locations_summary()';
  v_n     int;
  v_src   text;
  v_def   boolean;
  v_vol   "char";
  v_cfg   text[];
  v_role  text;
  v_cols  text[];
  v_tok   text;
begin
  -- (a) o singură semnătură pe fiecare nume (un overload = PGRST203)
  foreach v_tok in array array['report_time_zone', 'get_locations_summary', 'zoned_day_start'] loop
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_tok;
    if v_n <> 1 then
      raise exception 'mig 325: % are % semnături (trebuie exact 1)', v_tok, v_n;
    end if;
  end loop;

  -- (b) report_time_zone: DEFINER, STABLE, pg_temp, proprietarul lui
  -- restaurant_time_zone (altfel apelul ar da 42501 sub authenticated)
  select prosecdef, provolatile, proconfig, prosrc into v_def, v_vol, v_cfg, v_src
    from pg_proc where oid = c_rtz::regprocedure;
  if not v_def then
    raise exception 'mig 325: report_time_zone nu e SECURITY DEFINER — un INVOKER n-ar putea chema restaurant_time_zone';
  end if;
  if v_vol <> 's' then
    raise exception 'mig 325: report_time_zone trebuie să fie STABLE (e %)', v_vol;
  end if;
  if v_cfg is null or not (v_cfg @> array['search_path=public, pg_temp']) then
    raise exception 'mig 325: report_time_zone fără search_path = public, pg_temp (%)', v_cfg;
  end if;
  if (select proowner from pg_proc where oid = c_rtz::regprocedure)
     is distinct from (select proowner from pg_proc where oid = 'public.restaurant_time_zone(uuid)'::regprocedure) then
    raise exception 'mig 325: report_time_zone are alt proprietar decât restaurant_time_zone (42501 la apel)';
  end if;
  -- corpul: gate de membru, scurtătura RO ÎNAINTEA căii lente, fusul o dată
  v_n := (length(v_src) - length(replace(v_src, 'restaurant_time_zone(', ''))) / length('restaurant_time_zone(');
  if v_n <> 1 or position('safe_time_zone(' in v_src) > 0 then
    raise exception 'mig 325: report_time_zone cheamă fusul de % ori / direct prin safe_time_zone (așteptat o dată)', v_n;
  end if;
  if position('public.is_member(p_restaurant_id)' in v_src) = 0 then
    raise exception 'mig 325: report_time_zone a pierdut gate-ul is_member (ar fi un oracol de fus)';
  end if;
  if position('v_country = ''RO''' in v_src) = 0
     or position('v_country = ''RO''' in v_src) > position('restaurant_time_zone(' in v_src) then
    raise exception 'mig 325: scurtătura RO lipsește sau stă după calea lentă';
  end if;
  if v_src ~* '\mraise\M' then
    raise exception 'mig 325: report_time_zone nu are voie să arunce (apelantul e o listă)';
  end if;

  -- (c) report_time_zone: suprafața — doar authenticated (catalog + PUBLIC)
  if not has_function_privilege('authenticated', c_rtz, 'execute') then
    raise exception 'mig 325: authenticated NU poate executa report_time_zone';
  end if;
  foreach v_role in array array['anon', 'service_role'] loop
    if has_function_privilege(v_role, c_rtz, 'execute') then
      raise exception 'mig 325: % poate executa report_time_zone', v_role;
    end if;
  end loop;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid = c_rtz::regprocedure and a.grantee = 0) then
    raise exception 'mig 325: PUBLIC poate executa report_time_zone';
  end if;
  -- helperii 324 rămân închiși (RZ5/TZ9): migrația nu deschide calea lentă
  foreach v_tok in array array['public.restaurant_time_zone(uuid)', 'public.safe_time_zone(text)'] loop
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(v_role, v_tok, 'execute') then
        raise exception 'mig 325: helperul % a devenit executabil de %', v_tok, v_role;
      end if;
    end loop;
  end loop;

  -- (d) get_locations_summary: INVOKER, STABLE, pg_temp, coloanele OUT în ordine
  select prosecdef, provolatile, proconfig, prosrc into v_def, v_vol, v_cfg, v_src
    from pg_proc where oid = c_gls::regprocedure;
  if v_def then
    raise exception 'mig 325: get_locations_summary a devenit SECURITY DEFINER — ar ocoli RLS-ul (LS5)';
  end if;
  if v_vol <> 's' then
    raise exception 'mig 325: get_locations_summary trebuie să fie STABLE (e %)', v_vol;
  end if;
  if v_cfg is null or not (v_cfg @> array['search_path=public, pg_temp']) then
    raise exception 'mig 325: get_locations_summary fără search_path = public, pg_temp (%)', v_cfg;
  end if;
  -- Capcana de catalog (269): coloanele unui `returns table` sunt parametri OUT,
  -- în `proargnames` filtrat pe `proargmodes = 't'`, nu în pg_attribute.
  select array_agg(a.name order by a.ord) into v_cols
    from pg_proc p,
         unnest(p.proargnames, p.proargmodes) with ordinality as a(name, mode, ord)
   where p.oid = c_gls::regprocedure and a.mode = 't';
  if v_cols is distinct from array['id', 'name', 'slug', 'orders_today', 'open_orders',
                                   'revenue_today', 'last_order_at', 'day_time_zone'] then
    raise exception 'mig 325: coloanele lui get_locations_summary = % (day_time_zone trebuie să fie ULTIMA)', v_cols;
  end if;
  -- fusul o dată per local, materializat; niciun fus fix, nicio cale lentă directă
  v_n := (length(v_src) - length(replace(v_src, 'report_time_zone(', ''))) / length('report_time_zone(');
  if v_n <> 1 or position('materialized' in lower(v_src)) = 0 then
    raise exception 'mig 325: get_locations_summary evaluează fusul de % ori / fără CTE materializat', v_n;
  end if;
  if position('restaurant_time_zone(' in v_src) > 0 or position('safe_time_zone(' in v_src) > 0
     or position('''Europe/Bucharest''' in v_src) > 0 then
    raise exception 'mig 325: get_locations_summary are fusul fix / cheamă direct helperii închiși';
  end if;
  -- invariantele 314
  foreach v_tok in array array[
    'get_daily_payments_by_method(d.id, d.today, d.today)',
    'restaurant_has_feature(d.id, ''fiscal_receipt'')',
    'my_admin_restaurant_ids()',
    'public.is_admin(r.id)',
    'o.status <> ''cancelled''::order_status',
    'public.zoned_day_start(d.today, d.tz)',
    'public.zoned_day_start(d.today + 1, d.tz)',
    'o.created_at >= d.day_start',
    'o.created_at <  d.day_end'
  ] loop
    if position(v_tok in v_src) = 0 then
      raise exception 'mig 325: get_locations_summary a pierdut „%”', v_tok;
    end if;
  end loop;

  -- (e) get_locations_summary: suprafața (identică cu 314)
  if not has_function_privilege('authenticated', c_gls, 'execute') then
    raise exception 'mig 325: authenticated NU poate executa get_locations_summary';
  end if;
  foreach v_role in array array['anon', 'service_role'] loop
    if has_function_privilege(v_role, c_gls, 'execute') then
      raise exception 'mig 325: % poate executa get_locations_summary', v_role;
    end if;
  end loop;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid = c_gls::regprocedure and a.grantee = 0) then
    raise exception 'mig 325: PUBLIC poate executa get_locations_summary';
  end if;

  -- (e2) zoned_day_start: INVOKER, STABLE, pg_temp, doar authenticated; prima
  -- apariție a miezului nopții pe Havana 1 nov 2026, identic cu forma veche în
  -- rest (control pe București)
  select prosecdef, provolatile, proconfig into v_def, v_vol, v_cfg
    from pg_proc where oid = 'public.zoned_day_start(date, text)'::regprocedure;
  if v_def or v_vol <> 's' or v_cfg is null or not (v_cfg @> array['search_path=public, pg_temp']) then
    raise exception 'mig 325: zoned_day_start trebuie INVOKER, STABLE, search_path = public, pg_temp';
  end if;
  if not has_function_privilege('authenticated', 'public.zoned_day_start(date, text)', 'execute') then
    raise exception 'mig 325: authenticated NU poate executa zoned_day_start (get_locations_summary e INVOKER)';
  end if;
  foreach v_role in array array['anon', 'service_role'] loop
    if has_function_privilege(v_role, 'public.zoned_day_start(date, text)', 'execute') then
      raise exception 'mig 325: % poate executa zoned_day_start', v_role;
    end if;
  end loop;
  if public.zoned_day_start('2026-11-01', 'America/Havana') is distinct from '2026-11-01 04:00:00+00'::timestamptz then
    raise exception 'mig 325: zoned_day_start(Havana, 1 nov 2026) = % (aștepta 04:00Z, prima apariție a miezului nopții)',
      public.zoned_day_start('2026-11-01', 'America/Havana');
  end if;
  if exists (select 1 from generate_series('2025-01-01'::date, '2027-12-31'::date, interval '1 day') g(day)
              where public.zoned_day_start(g.day::date, 'Europe/Bucharest')
                    is distinct from (g.day::date::timestamp at time zone 'Europe/Bucharest')) then
    raise exception 'mig 325: zoned_day_start schimbă începutul zilei pe București (trebuie IDENTIC)';
  end if;

  -- (f) fără JWT (migrația) helperul dă fusul implicit, nu NULL și nu fusul real
  if public.report_time_zone(null) is distinct from 'Europe/Bucharest' then
    raise exception 'mig 325: report_time_zone(NULL) nu întoarce fusul implicit';
  end if;

  raise notice 'mig 325: ziua de raportare (report_time_zone) + get_locations_summary pe ea OK';
end $$;

commit;
