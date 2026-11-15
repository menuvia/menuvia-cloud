-- tests/sql/auto/325_report_time_zone.sql
-- =============================================================================
-- FZ1–FZ8 — clichetul PERMANENT al mig 325: ziua de RAPORTARE (`report_time_zone`)
-- și „Toate locațiile” (`get_locations_summary`) judecat pe ea. Autonom,
-- ROLLBACK la final. Rulează după auto/314 (LS1–LS6 țin invariantele 314 pe
-- starea FINALĂ a lanțului) și după auto/324 (TZ1–TZ9, helperii fusului).
--
-- Apelurile se fac SUB rolul REAL `authenticated`, prin `execute` DINAMIC: ca
-- `postgres`, EXECUTE și RLS sunt ocolite (un DEFINER coborât la INVOKER sau un
-- grant pierdut ar trece nevăzute), iar un apel static își cachează verificarea
-- EXECUTE per tranzacție (capcana TS4 din 312).
--
-- `now()` e ÎNGHEȚAT în tranzacție, deci granițele se calculează în test, per
-- fus: L0(tz) = începutul zilei de AZI în acel fus. Comenzile stau la L0+1 min
-- (azi), L0−1 min (ieri) și o `cancelled` la L0+2 min. Ofsetul oricărui fus din
-- fixtură față de București e de cel puțin 2 h, mult peste banda de 2 minute,
-- deci o FEREASTRĂ calculată pe alt fus decât cel așteptat cuprinde fie ambele
-- comenzi, fie niciuna: numără 0 sau 2 în loc de 1 — la ORICE oră a rulării.
-- Ziua BANILOR, în schimb, e o DATĂ dată lui `get_daily_payments_by_method`, nu
-- o fereastră: pe Londra ea coincide cu a Bucureștiului ~22 h din 24, deci o
-- mutație pe ziua banilor ar trece acolo aproape mereu. De aceea fixtura are și
-- R_ROX: un local RO al cărui fus e ales LA RULARE dintre Pacific/Kiritimati
-- (UTC+14) și Pacific/Pago_Pago (UTC−11) — cel a cărui DATĂ diferă ACUM de a
-- Bucureștiului (unul dintre ele diferă la orice oră: Kiritimati de la
-- 12:00/13:00 ora României, Pago Pago până la 13:00/14:00; precondiția de
-- fixtură o verifică) — pe el și ziua banilor discriminează la orice oră.
--
-- Fixtură: OWNER A pe enterprise (plafonul de restaurante 071), câte un local pe
-- (țară, fus); B = owner (growth) al localului cu fus invalid, SINGUR pe lista
-- lui (un fus nevalidat aruncă și rupe TOT apelul — izolat, mutația pică exact
-- la FZ3, nu la fiecare test); X = cont autentificat străin.
--   R_RO   RO / Europe/Bucharest       R_ROL  RO / Europe/London
--   R_ROX  RO / Kiritimati|Pago_Pago   R_US   US / America/New_York
--   R_NZ   NZ / Pacific/Auckland       R_IN   IN / Asia/Kolkata
--   R_H    RO / Kiritimati|Pago_Pago (FZ7 — o singură comandă, la 00:30 ora României)
--   R_BAD  US / 'Mars/Olympus' (fus invalid; coloana n-are CHECK) — al lui B
--
--   FZ0  precondiția comună: fusul „străin” ales chiar are altă DATĂ acum decât
--        Bucureștiul, iar apelul lui A (sub `authenticated`) nu aruncă și vede
--        cele 7 locații.
--        [PICĂ: helperul coborât la INVOKER (M8: 42501 pe `restaurant_time_zone`)]
--   FZ1  CONTROL RO: R_RO, R_ROL, R_ROX → `orders_today` = 2 (o comandă `new` și
--        una `paid` la L0(București)+1 min; cele de la −1 min și anulata nu),
--        EGAL cu formula 314 calculată inline pe București, iar `day_time_zone`
--        = 'Europe/Bucharest' pe toate trei.
--        [PICĂ: regula pe țară scoasă din helper — R_ROL și R_ROX numără 0 sau
--         4, cu `day_time_zone` = fusul lor (M1)]
--   FZ2  non-RO: R_US, R_NZ, R_IN → `orders_today` = 1 fiecare, `day_time_zone`
--        = fusul lor, `revenue_today` NULL (gate-ul pe țară 296: fără bani).
--        [PICĂ: fereastra 314 pe București (M2: 0 sau 2); CASE-ul pe
--         `restaurant_has_feature` scos (M3: 0 în loc de NULL)]
--   FZ3  fus invalid: apelul lui B (doar R_BAD) NU aruncă, `day_time_zone` =
--        București, numărătoarea pe fereastra Bucureștiului (= 1).
--        [PICĂ: fusul brut, nevalidat (M4: 22023 „time zone not recognized”
--         rupe TOT ecranul, nu doar cardul)]
--   FZ4  banii pe ziua românească: pe R_RO, R_ROL, R_ROX (`paid` 50 la
--        L0(București)+1 min, 20 la −1 min) `revenue_today` = 50 =
--        sum(get_daily_payments_by_method(id, ziua RO, ziua RO)). Control
--        pozitiv: e NUMĂR, nu NULL.
--        [PICĂ: M1 pe R_ROX (ziua banilor pe fusul local: 0 sau 20) — prins
--         întâi de FZ1; verificat separat, pe copii ale suitei fără FZ0–FZ1 și
--         fără FZ0–FZ3 (pe R_ROL trece: data Londrei coincide acum cu a
--         Bucureștiului — de aceea există R_ROX)]
--   FZ5  suprafața helperului, VIU: `report_time_zone` DEFINER, `public, pg_temp`,
--        o semnătură, același `proowner` ca `restaurant_time_zone`, EXECUTE doar
--        `authenticated` (nu anon / service_role / PUBLIC), apel real ca anon →
--        42501 „for function”. Gate: X (străin) primește București pe R_US; A
--        primește America/New_York pe R_US și București pe R_ROL; B primește
--        București pe R_BAD; un restaurant inexistent → București.
--        [PICĂ: grant către anon (M6); gate-ul scos (M7: X vede New York);
--         fallback NULL pe ne-membru (M5); proprietar diferit (M13); INVOKER
--         (M8 — prins întâi de FZ0; verificat și separat, pe o copie a suitei
--         fără FZ0–FZ4)]
--   FZ6  structura lui `get_locations_summary`, VIU (asserțiile migrației rulează
--        o singură dată): o semnătură, INVOKER, STABLE, `pg_temp`; coloanele OUT
--        (din `proargnames`/`proargmodes = 't'`, capcana 269) exact în ordine, cu
--        `day_time_zone` ULTIMA; în `prosrc` `report_time_zone(` EXACT o dată și
--        `materialized`, zero `restaurant_time_zone(` / `safe_time_zone(` / literal
--        București; încă `get_daily_payments_by_method`, `my_admin_restaurant_ids()`,
--        `is_admin(`; ACL doar `authenticated` + apel real ca anon → 42501.
--        [PICĂ: CTE-ul fără MATERIALIZED (M9); fusul cerut în fiecare
--         subinterogare (M9b: 7 apariții); literalul readus, chiar și într-un
--         comentariu (M14); `day_time_zone` mutată înaintea lui `last_order_at`
--         (M10)]
--   FZ7  CONSECVENȚA ecranelor fiscale pe un local RO cu fus străin: pe R_H, o
--        comandă la L0(București)+30 min (00:30 ora României; 12:30 la
--        Kiritimati / 11:30 la Pago Pago) e numărată în `orders_today`, iar
--        `report_by_hour(R_H, ziua RO)` (JWT de owner) și `v_hourly_distribution`
--        o pun în ORA 0, nicio altă oră nenulă. Îngheață consecvența, nu
--        literalul: o mutare viitoare pe `report_time_zone` trece.
--        [PICĂ: `report_by_hour` (M11) / `v_hourly_distribution` (M12) mutate pe
--         fusul localului — ora 12/11, adică două definiții ale zilei pe același
--         local]
--   FZ8  `zoned_day_start` (fereastra zilei din `get_locations_summary`) dă
--        PRIMUL minut al zilei, verificat pe PROPRIETATE (tzdata diferă între
--        PG16 local și postgres:17 din CI — o valoare fixă pe Havana pica într-un
--        mediu): pe 16 fusuri × 2025–2027 instantul cade în ziua cerută și
--        minutul dinainte în ziua precedentă, iar setul conține cel puțin o zi cu
--        miezul nopții DUBLU (Atlantic/Azores, regula UE — anti-vacuitate); pe București
--        IDENTIC cu forma 314; EXECUTE doar `authenticated`, INVOKER. FZ6 cere
--        în corp fereastra prin helper (ambele capete).
--        [PICĂ: helperul pe forma 314 `p_day::timestamp at time zone p_tz`
--         (M15: miezul nopții dublu → a doua apariție, caracterizarea pică); fereastra din corp revenită la forma 314
--         (M16: FZ6, token lipsă); grant scos de la authenticated (M17: FZ0 —
--         apelul lui A aruncă 42501 — și FZ8)]
--
-- Mutațiile M1–M17 (+ M9b) au fost aplicate pe un cluster de replay (KEEP=1
-- scripts/verify-migrations-local.sh), fiecare într-o tranzacție derulată
-- înapoi: suita pică EXACT la testul notat (sau la cel notat „prins întâi”).
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Helperi ──────────────────────────────────────────────────────────────────
-- Începutul zilei de AZI (la now() înghețat) în fusul dat.
create function pg_temp.fz_l0(p_tz text) returns timestamptz
language sql stable as $$
  select ((now() at time zone p_tz)::date)::timestamp at time zone p_tz;
$$;

-- Fusul străin a cărui DATĂ diferă ACUM de a Bucureștiului (unul dintre cei doi
-- diferă la orice oră — vezi antetul).
create function pg_temp.fz_far_tz() returns text
language sql stable as $$
  select case when (now() at time zone 'Pacific/Kiritimati')::date
                   <> (now() at time zone 'Europe/Bucharest')::date
              then 'Pacific/Kiritimati' else 'Pacific/Pago_Pago' end;
$$;

-- ── Fixtură ──────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('32500000-0000-4000-8000-0000000000a1', 'fz-a@fz325.test'),
  ('32500000-0000-4000-8000-0000000000b1', 'fz-b@fz325.test'),
  ('32500000-0000-4000-8000-0000000000d1', 'fz-x@fz325.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email)
  select id, email from auth.users where email like 'fz-%@fz325.test'
  on conflict (id) do nothing;
update public.profiles set plan = 'enterprise' where id = '32500000-0000-4000-8000-0000000000a1';
update public.profiles set plan = 'growth'     where id = '32500000-0000-4000-8000-0000000000b1';

insert into public.restaurants (id, owner_id, name, slug, city, is_active, country, timezone) values
  ('325b0000-0000-4000-8000-000000000001', '32500000-0000-4000-8000-0000000000a1', 'FZ 1 RO',   'fz325-ro',  'Cluj',     true, 'RO', 'Europe/Bucharest'),
  ('325b0000-0000-4000-8000-000000000002', '32500000-0000-4000-8000-0000000000a1', 'FZ 2 ROL',  'fz325-rol', 'Cluj',     true, 'RO', 'Europe/London'),
  ('325b0000-0000-4000-8000-000000000003', '32500000-0000-4000-8000-0000000000a1', 'FZ 3 ROX',  'fz325-rox', 'Cluj',     true, 'RO', pg_temp.fz_far_tz()),
  ('325b0000-0000-4000-8000-000000000004', '32500000-0000-4000-8000-0000000000a1', 'FZ 4 US',   'fz325-us',  'New York', true, 'US', 'America/New_York'),
  ('325b0000-0000-4000-8000-000000000005', '32500000-0000-4000-8000-0000000000a1', 'FZ 5 NZ',   'fz325-nz',  'Auckland', true, 'NZ', 'Pacific/Auckland'),
  ('325b0000-0000-4000-8000-000000000006', '32500000-0000-4000-8000-0000000000a1', 'FZ 6 IN',   'fz325-in',  'Mumbai',   true, 'IN', 'Asia/Kolkata'),
  ('325b0000-0000-4000-8000-000000000007', '32500000-0000-4000-8000-0000000000b1', 'FZ 7 BAD',  'fz325-bad', 'Nicăieri', true, 'US', 'Mars/Olympus'),
  ('325b0000-0000-4000-8000-000000000008', '32500000-0000-4000-8000-0000000000a1', 'FZ 8 H',    'fz325-h',   'Cluj',     true, 'RO', pg_temp.fz_far_tz());

-- Ziua „de azi” așteptată pe fiecare local: București pe RO și pe fusul invalid,
-- fusul lor pe restul.
create temp table fz_expect (rid uuid primary key, tz text not null) on commit drop;
insert into fz_expect values
  ('325b0000-0000-4000-8000-000000000001', 'Europe/Bucharest'),
  ('325b0000-0000-4000-8000-000000000002', 'Europe/Bucharest'),
  ('325b0000-0000-4000-8000-000000000003', 'Europe/Bucharest'),
  ('325b0000-0000-4000-8000-000000000004', 'America/New_York'),
  ('325b0000-0000-4000-8000-000000000005', 'Pacific/Auckland'),
  ('325b0000-0000-4000-8000-000000000006', 'Asia/Kolkata'),
  ('325b0000-0000-4000-8000-000000000007', 'Europe/Bucharest');

-- Pe fiecare local din fz_expect: `new` la L0+1 min (azi), `new` la L0−1 min
-- (ieri), `cancelled` la L0+2 min (nu se numără).
insert into public.orders (restaurant_id, source, status, created_at)
select e.rid, 'waiter', s.status::order_status, pg_temp.fz_l0(e.tz) + s.off
  from fz_expect e
 cross join (values ('new', interval '1 minute'),
                    ('new', interval '-1 minute'),
                    ('cancelled', interval '2 minutes')) s(status, off);

-- Pe localurile RO (fiscal pe enterprise): bani la granița ZILEI ROMÂNEȘTI —
-- 50 azi, 20 ieri.
insert into public.orders (restaurant_id, source, status, payment_method, paid_amount, created_at, paid_at)
select r.rid, 'waiter', 'paid', 'cash', s.amt, pg_temp.fz_l0('Europe/Bucharest') + s.off,
       pg_temp.fz_l0('Europe/Bucharest') + s.off
  from (values ('325b0000-0000-4000-8000-000000000001'::uuid),
               ('325b0000-0000-4000-8000-000000000002'::uuid),
               ('325b0000-0000-4000-8000-000000000003'::uuid)) r(rid)
 cross join (values (50::numeric, interval '1 minute'),
                    (20::numeric, interval '-1 minute')) s(amt, off);

-- FZ7: o singură comandă pe R_H, la 00:30 ora României.
insert into public.orders (restaurant_id, source, status, created_at) values
  ('325b0000-0000-4000-8000-000000000008', 'waiter', 'new',
   pg_temp.fz_l0('Europe/Bucharest') + interval '30 minutes');

-- Rândurile lui get_locations_summary SUB rolul dat, ca utilizatorul dat
-- (jsonb ordonat pe nume, sau {raised, sqlstate, error}). `set_config('role')`
-- stă ÎN AFARA sub-blocului cu excepție (altfel s-ar derula odată cu el).
create function pg_temp.fz_rows(p_role text, p_uid uuid) returns jsonb
language plpgsql as $f$
declare v jsonb; v_state text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('role', p_role, true);
  begin
    execute $q$ select coalesce(jsonb_agg(to_jsonb(s) order by s.name), '[]'::jsonb)
                  from public.get_locations_summary() s $q$ into v;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v := jsonb_build_object('raised', true, 'sqlstate', v_state, 'error', sqlerrm);
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  return v;
end $f$;

-- report_time_zone(p_rid) SUB rolul dat, ca utilizatorul dat (text sau
-- 'ERR <sqlstate>: <mesaj>').
create function pg_temp.fz_rtz(p_role text, p_uid uuid, p_rid uuid) returns text
language plpgsql as $f$
declare v text; v_state text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('role', p_role, true);
  begin
    execute 'select public.report_time_zone($1)' into v using p_rid;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v := 'ERR ' || v_state || ': ' || sqlerrm;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  return v;
end $f$;

create function pg_temp.fz_row(p_rows jsonb, p_id uuid) returns jsonb
language sql as $f$
  select e from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) e
   where e->>'id' = p_id::text
$f$;

-- Rândurile lui A, o singură dată (now() e înghețat: aceleași în toată suita).
create temp table fz_a on commit drop as
  select pg_temp.fz_rows('authenticated', '32500000-0000-4000-8000-0000000000a1') as v;

-- ═══════ FZ0: precondiția comună ═══════
do $$
begin
  if (now() at time zone pg_temp.fz_far_tz())::date = (now() at time zone 'Europe/Bucharest')::date then
    raise exception 'FZ0 FIXTURE: % are aceeași dată ca Bucureștiul acum — R_ROX/R_H n-ar discrimina', pg_temp.fz_far_tz();
  end if;
  if (select jsonb_typeof(v) from fz_a) is distinct from 'array' then
    raise exception 'FZ0 FAIL: apelul lui A (sub authenticated) aruncă: %', (select v from fz_a);
  end if;
  if jsonb_array_length((select v from fz_a)) <> 7 then
    raise exception 'FZ0 FAIL: A trebuia să vadă 7 locații, a văzut %', jsonb_array_length((select v from fz_a));
  end if;
  raise notice 'FZ0 PASS: fusul străin % are altă dată acum; A vede cele 7 locații', pg_temp.fz_far_tz();
end $$;

-- ═══════ FZ1: control RO — identic cu formula 314, ziua pe București ═══════
do $$
declare v_rid uuid; r jsonb; v_old bigint;
begin
  foreach v_rid in array array['325b0000-0000-4000-8000-000000000001'::uuid,
                               '325b0000-0000-4000-8000-000000000002'::uuid,
                               '325b0000-0000-4000-8000-000000000003'::uuid] loop
    r := pg_temp.fz_row((select v from fz_a), v_rid);
    if r is null then
      raise exception 'FZ1 FAIL: lipsește localul %', v_rid; end if;
    -- Formula 314 VERBATIM (fereastra pe București), calculată inline ca postgres.
    select count(*) into v_old
      from public.orders o
     where o.restaurant_id = v_rid
       and o.status <> 'cancelled'::order_status
       and o.created_at >= (((now() at time zone 'Europe/Bucharest')::date)::timestamp at time zone 'Europe/Bucharest')
       and o.created_at <  ((((now() at time zone 'Europe/Bucharest')::date) + 1)::timestamp at time zone 'Europe/Bucharest');
    if v_old is distinct from 2::bigint then
      raise exception 'FZ1 FIXTURE: formula 314 dă % pe % (aștepta 2)', v_old, v_rid; end if;
    if (r->>'orders_today')::bigint is distinct from v_old then
      raise exception 'FZ1 FAIL: % (%) orders_today = %, formula 314 = % — ziua de raportare a unui local RO nu mai e a Bucureștiului',
        r->>'name', (select timezone from public.restaurants where id = v_rid), r->>'orders_today', v_old; end if;
    if r->>'day_time_zone' is distinct from 'Europe/Bucharest' then
      raise exception 'FZ1 FAIL: % day_time_zone = % (aștepta Europe/Bucharest — regula e pe țară)',
        r->>'name', coalesce(r->>'day_time_zone', '<lipsă>'); end if;
  end loop;
  raise notice 'FZ1 PASS: localurile RO (București, Londra, %) numără pe ziua românească', pg_temp.fz_far_tz();
end $$;

-- ═══════ FZ2: non-RO — ziua localului, fără bani ═══════
do $$
declare v_rid uuid; r jsonb; v_tz text;
begin
  foreach v_rid in array array['325b0000-0000-4000-8000-000000000004'::uuid,
                               '325b0000-0000-4000-8000-000000000005'::uuid,
                               '325b0000-0000-4000-8000-000000000006'::uuid] loop
    r := pg_temp.fz_row((select v from fz_a), v_rid);
    select tz into v_tz from fz_expect where rid = v_rid;
    if r is null then
      raise exception 'FZ2 FAIL: lipsește localul %', v_rid; end if;
    if (r->>'orders_today')::int is distinct from 1 then
      raise exception 'FZ2 FAIL: % orders_today = % (aștepta 1 — fereastra pe ziua de azi la %)',
        r->>'name', r->>'orders_today', v_tz; end if;
    if r->>'day_time_zone' is distinct from v_tz then
      raise exception 'FZ2 FAIL: % day_time_zone = % (aștepta %)', r->>'name', r->>'day_time_zone', v_tz; end if;
    if jsonb_typeof(r->'revenue_today') is distinct from 'null' then
      raise exception 'FZ2 FAIL: % (non-RO) revenue_today = % (aștepta NULL — fără bani în afara României)',
        r->>'name', r->'revenue_today'; end if;
  end loop;
  raise notice 'FZ2 PASS: New York, Auckland, Kolkata numără pe ziua lor, fără bani';
end $$;

-- ═══════ FZ3: fus invalid → București, fără excepție ═══════
do $$
declare v jsonb; r jsonb;
begin
  v := pg_temp.fz_rows('authenticated', '32500000-0000-4000-8000-0000000000b1');
  if jsonb_typeof(v) is distinct from 'array' then
    raise exception 'FZ3 FAIL: un fus invalid rupe tot apelul: %', v; end if;
  if jsonb_array_length(v) <> 1 then
    raise exception 'FZ3 FAIL: B trebuia să vadă doar localul lui: %', v; end if;
  r := pg_temp.fz_row(v, '325b0000-0000-4000-8000-000000000007');
  if r is null then
    raise exception 'FZ3 FAIL: localul cu fus invalid lipsește'; end if;
  if r->>'day_time_zone' is distinct from 'Europe/Bucharest' then
    raise exception 'FZ3 FAIL: fus invalid → day_time_zone = % (aștepta Europe/Bucharest)', r->>'day_time_zone'; end if;
  if (r->>'orders_today')::int is distinct from 1 then
    raise exception 'FZ3 FAIL: fus invalid → orders_today = % (aștepta 1, pe fereastra Bucureștiului)', r->>'orders_today'; end if;
  raise notice 'FZ3 PASS: un fus invalid cade pe București, ecranul nu aruncă';
end $$;

-- ═══════ FZ4: banii pe ziua românească ═══════
do $$
declare v_rid uuid; r jsonb; v_src numeric;
begin
  foreach v_rid in array array['325b0000-0000-4000-8000-000000000001'::uuid,
                               '325b0000-0000-4000-8000-000000000002'::uuid,
                               '325b0000-0000-4000-8000-000000000003'::uuid] loop
    r := pg_temp.fz_row((select v from fz_a), v_rid);
    -- Control pozitiv: pe un local RO cu bani suma EXISTĂ.
    if jsonb_typeof(r->'revenue_today') is distinct from 'number' then
      raise exception 'FZ4 FAIL: % revenue_today nu e număr: %', r->>'name', r->'revenue_today'; end if;
    select coalesce(sum(p.total_revenue), 0) into v_src
      from public.get_daily_payments_by_method(v_rid, (now() at time zone 'Europe/Bucharest')::date,
                                                      (now() at time zone 'Europe/Bucharest')::date) p;
    if v_src is distinct from 50::numeric then
      raise exception 'FZ4 FIXTURE: sursa unică dă % pe % (aștepta 50)', v_src, v_rid; end if;
    if (r->>'revenue_today')::numeric is distinct from v_src then
      raise exception 'FZ4 FAIL: % revenue_today = % (aștepta % — încasările zilei românești)',
        r->>'name', r->>'revenue_today', v_src; end if;
  end loop;
  raise notice 'FZ4 PASS: încasările de azi = ziua românească a încasării pe toate localurile RO';
end $$;

-- ═══════ FZ5: suprafața și gate-ul helperului ═══════
do $$
declare
  c_rtz constant text := 'public.report_time_zone(uuid)';
  v_n int; v_def boolean; v_vol "char"; v_cfg text[]; v text;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'report_time_zone';
  if v_n <> 1 then
    raise exception 'FZ5 FAIL: report_time_zone are % semnături (PGRST203)', v_n; end if;
  select prosecdef, provolatile, proconfig into v_def, v_vol, v_cfg
    from pg_proc where oid = c_rtz::regprocedure;
  if not v_def then
    raise exception 'FZ5 FAIL: report_time_zone nu e SECURITY DEFINER'; end if;
  if v_vol <> 's' then
    raise exception 'FZ5 FAIL: report_time_zone are volatilitatea % (trebuie STABLE)', v_vol; end if;
  if v_cfg is null or not (v_cfg @> array['search_path=public, pg_temp']) then
    raise exception 'FZ5 FAIL: search_path %', v_cfg; end if;
  if (select proowner from pg_proc where oid = c_rtz::regprocedure)
     is distinct from (select proowner from pg_proc where oid = 'public.restaurant_time_zone(uuid)'::regprocedure) then
    raise exception 'FZ5 FAIL: report_time_zone are alt proprietar decât restaurant_time_zone (42501 la apel)'; end if;
  if not has_function_privilege('authenticated', c_rtz, 'execute') then
    raise exception 'FZ5 FAIL: authenticated NU poate executa report_time_zone'; end if;
  if has_function_privilege('anon', c_rtz, 'execute') then
    raise exception 'FZ5 FAIL: anon poate executa report_time_zone'; end if;
  if has_function_privilege('service_role', c_rtz, 'execute') then
    raise exception 'FZ5 FAIL: service_role poate executa report_time_zone'; end if;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid = c_rtz::regprocedure and a.grantee = 0) then
    raise exception 'FZ5 FAIL: PUBLIC poate executa report_time_zone'; end if;
  v := pg_temp.fz_rtz('anon', null, '325b0000-0000-4000-8000-000000000004');
  if v is null or v not like 'ERR 42501:%for function%' then
    raise exception 'FZ5 FAIL: apelul real ca anon → % (aștepta 42501 „for function”)', coalesce(v, '<null>'); end if;

  -- Gate: străinul primește fusul implicit, nu fusul real (nu e un oracol).
  v := pg_temp.fz_rtz('authenticated', '32500000-0000-4000-8000-0000000000d1', '325b0000-0000-4000-8000-000000000004');
  if v is distinct from 'Europe/Bucharest' then
    raise exception 'FZ5 FAIL: străinul X primește % pe R_US (aștepta Europe/Bucharest — fără oracol, fără NULL)', coalesce(v, '<null>'); end if;
  -- Control pozitiv: owner-ul primește fusul real.
  v := pg_temp.fz_rtz('authenticated', '32500000-0000-4000-8000-0000000000a1', '325b0000-0000-4000-8000-000000000004');
  if v is distinct from 'America/New_York' then
    raise exception 'FZ5 FAIL: A primește % pe R_US (aștepta America/New_York)', coalesce(v, '<null>'); end if;
  v := pg_temp.fz_rtz('authenticated', '32500000-0000-4000-8000-0000000000a1', '325b0000-0000-4000-8000-000000000002');
  if v is distinct from 'Europe/Bucharest' then
    raise exception 'FZ5 FAIL: A primește % pe R_ROL (aștepta Europe/Bucharest — regula pe țară)', coalesce(v, '<null>'); end if;
  v := pg_temp.fz_rtz('authenticated', '32500000-0000-4000-8000-0000000000b1', '325b0000-0000-4000-8000-000000000007');
  if v is distinct from 'Europe/Bucharest' then
    raise exception 'FZ5 FAIL: B primește % pe R_BAD (fus invalid → Europe/Bucharest)', coalesce(v, '<null>'); end if;
  v := pg_temp.fz_rtz('authenticated', '32500000-0000-4000-8000-0000000000a1', '325b0fff-0000-4000-8000-000000000000');
  if v is distinct from 'Europe/Bucharest' then
    raise exception 'FZ5 FAIL: restaurant inexistent → % (aștepta Europe/Bucharest)', coalesce(v, '<null>'); end if;
  raise notice 'FZ5 PASS: report_time_zone DEFINER, doar authenticated, gate is_member, fără NULL';
end $$;

-- ═══════ FZ6: structura lui get_locations_summary, viu ═══════
do $$
declare
  c_gls constant text := 'public.get_locations_summary()';
  v_n int; v_def boolean; v_vol "char"; v_cfg text[]; v_src text; v_cols text[]; v_tok text; v jsonb;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_locations_summary';
  if v_n <> 1 then
    raise exception 'FZ6 FAIL: get_locations_summary are % semnături (PGRST203)', v_n; end if;
  select prosecdef, provolatile, proconfig, prosrc into v_def, v_vol, v_cfg, v_src
    from pg_proc where oid = c_gls::regprocedure;
  if v_def then
    raise exception 'FZ6 FAIL: get_locations_summary e SECURITY DEFINER (trebuie INVOKER, LS5)'; end if;
  if v_vol <> 's' then
    raise exception 'FZ6 FAIL: volatilitate % (trebuie STABLE)', v_vol; end if;
  if v_cfg is null or not (v_cfg @> array['search_path=public, pg_temp']) then
    raise exception 'FZ6 FAIL: search_path %', v_cfg; end if;
  -- coloanele unui `returns table` = parametrii OUT (proargmodes 't'), nu pg_attribute
  select array_agg(a.name order by a.ord) into v_cols
    from pg_proc p,
         unnest(p.proargnames, p.proargmodes) with ordinality as a(name, mode, ord)
   where p.oid = c_gls::regprocedure and a.mode = 't';
  if v_cols is distinct from array['id', 'name', 'slug', 'orders_today', 'open_orders',
                                   'revenue_today', 'last_order_at', 'day_time_zone'] then
    raise exception 'FZ6 FAIL: coloanele = % (day_time_zone trebuie să fie ULTIMA; clientul vechi citește pe nume)', v_cols; end if;
  -- fusul O DATĂ per local, materializat (o evaluare per subinterogare = ~10 ms ×
  -- 3 per local străin pe calea lentă)
  v_n := (length(v_src) - length(replace(v_src, 'report_time_zone(', ''))) / length('report_time_zone(');
  if v_n <> 1 then
    raise exception 'FZ6 FAIL: report_time_zone( apare de % ori în corp (aștepta exact 1, în CTE-ul materializat)', v_n; end if;
  if position('materialized' in lower(v_src)) = 0 then
    raise exception 'FZ6 FAIL: CTE-ul cu fusul nu mai e MATERIALIZED (planificatorul îl poate inlinia per subinterogare)'; end if;
  if position('restaurant_time_zone(' in v_src) > 0 or position('safe_time_zone(' in v_src) > 0 then
    raise exception 'FZ6 FAIL: corpul INVOKER cheamă direct helperii închiși (42501 sub authenticated)'; end if;
  if position('''Europe/Bucharest''' in v_src) > 0 then
    raise exception 'FZ6 FAIL: fusul București e scris de mână în corp (inclusiv în comentarii — prosrc le conține)'; end if;
  foreach v_tok in array array['get_daily_payments_by_method', 'my_admin_restaurant_ids()', 'is_admin(',
                                'public.zoned_day_start(d.today, d.tz)', 'public.zoned_day_start(d.today + 1, d.tz)',
                                'o.created_at >= d.day_start', 'o.created_at <  d.day_end'] loop
    if position(v_tok in v_src) = 0 then
      raise exception 'FZ6 FAIL: corpul a pierdut „%” (invariant 314)', v_tok; end if;
  end loop;
  if has_function_privilege('anon', c_gls, 'execute') or has_function_privilege('service_role', c_gls, 'execute')
     or not has_function_privilege('authenticated', c_gls, 'execute') then
    raise exception 'FZ6 FAIL: ACL-ul lui get_locations_summary nu mai e „doar authenticated”'; end if;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid = c_gls::regprocedure and a.grantee = 0) then
    raise exception 'FZ6 FAIL: PUBLIC poate executa get_locations_summary (DROP+CREATE a refăcut grantul implicit)'; end if;
  v := pg_temp.fz_rows('anon', null);
  if (v->>'sqlstate') is distinct from '42501' or v->>'error' not like '%for function%' then
    raise exception 'FZ6 FAIL: apelul real ca anon → % (aștepta 42501 „for function”)', v; end if;
  raise notice 'FZ6 PASS: get_locations_summary INVOKER, fusul o dată materializat, day_time_zone ultima, doar authenticated';
end $$;

-- ═══════ FZ7: consecvența ecranelor fiscale pe un local RO cu fus străin ═══════
do $$
declare
  r jsonb; v_day date := (now() at time zone 'Europe/Bucharest')::date;
  v_h0 bigint; v_other bigint; v_vh0 bigint; v_vother bigint;
begin
  -- „azi” pe Toate locațiile o conține
  r := pg_temp.fz_row((select v from fz_a), '325b0000-0000-4000-8000-000000000008');
  if (r->>'orders_today')::int is distinct from 1 or r->>'day_time_zone' is distinct from 'Europe/Bucharest' then
    raise exception 'FZ7 FAIL: comanda de la 00:30 ora României nu e „azi” pe R_H: %', r; end if;

  -- report_by_hour (fereastra = ziua românească, ca ReportsTab pe un local RO),
  -- cu JWT de owner (gate is_member).
  perform set_config('request.jwt.claim.sub', '32500000-0000-4000-8000-0000000000a1', true);
  select coalesce(sum(order_count) filter (where hour = 0), 0),
         coalesce(sum(order_count) filter (where hour <> 0), 0)
    into v_h0, v_other
    from public.report_by_hour('325b0000-0000-4000-8000-000000000008',
                               v_day::timestamp at time zone 'Europe/Bucharest',
                               (v_day + 1)::timestamp at time zone 'Europe/Bucharest' - interval '1 millisecond');
  perform set_config('request.jwt.claim.sub', '', true);
  if v_h0 is distinct from 1::bigint or v_other is distinct from 0::bigint then
    raise exception 'FZ7 FAIL: report_by_hour pune comanda de la 00:30 (ora României) în altă oră (ora 0 = %, restul = %) — două definiții ale zilei pe același local',
      v_h0, v_other; end if;

  -- v_hourly_distribution (AnalyticsTab, doar pe suprafața fiscală)
  select coalesce(sum(order_count) filter (where hour = 0), 0),
         coalesce(sum(order_count) filter (where hour <> 0), 0)
    into v_vh0, v_vother
    from public.v_hourly_distribution
   where restaurant_id = '325b0000-0000-4000-8000-000000000008';
  if v_vh0 is distinct from 1::bigint or v_vother is distinct from 0::bigint then
    raise exception 'FZ7 FAIL: v_hourly_distribution pune comanda de la 00:30 (ora României) în altă oră (ora 0 = %, restul = %)',
      v_vh0, v_vother; end if;
  raise notice 'FZ7 PASS: pe un local RO cu fus % ziua, ora și histograma rămân pe București, consecvent', pg_temp.fz_far_tz();
end $$;

-- ═══════ FZ8: zoned_day_start = PRIMUL instant al zilei, pe orice fus ═══════
do $$
declare
  v_bad text; v_n int;
begin
  -- Pe PROPRIETATE, nu pe instante fixe (ca DZ4 în client): tzdata diferă între
  -- versiuni — imaginea postgres:17 din CI nu mai are tranziția Havanei din
  -- 1 nov 2026 pe care o are PG16 local, deci o valoare fixă (04:00Z) pica pe
  -- un mediu și trecea pe altul. Anti-vacuitate: setul TREBUIE să conțină cel
  -- puțin o zi în care miezul nopții apare de DOUĂ ori (forma 314 nu e primul minut) —
  -- Atlantic/Azores, regula UE (ultima duminică din oct, 01:00 UTC: 01:00 → 00:00),
  -- e acolo în orice tzdata recent; fără o astfel de zi, mutația M15 (helperul
  -- pe forma 314) n-ar mai pica nicăieri.
  select count(*), string_agg(format('%s %s', z.tz, g.day::date), ', ')
    into v_n, v_bad
    from unnest(array['America/Havana', 'Atlantic/Azores']) z(tz)
   cross join generate_series('2025-01-01'::date, '2027-12-31'::date, interval '1 day') g(day)
   -- independent de helper: zilele în care forma 314 NU e primul minut (minutul
   -- dinaintea ei e încă în aceeași zi) — exact unde helperul trebuie să difere
   where (((g.day::date::timestamp at time zone z.tz) - interval '1 minute') at time zone z.tz)::date = g.day::date;
  if v_n = 0 then
    raise exception 'FZ8 FAIL: niciun miez al nopții dublu în set (anti-vacuitate) — caracterizarea de mai jos n-ar prinde forma 314'; end if;
  raise notice 'FZ8: % zile cu miezul nopții dublu în set: %', v_n, left(v_bad, 200);
  -- Caracterizarea „primul minut al zilei”: instantul cade în ziua cerută, iar
  -- minutul dinaintea lui în ziua precedentă — pe fusuri cu tranziții la miezul
  -- nopții (Havana, Santiago, Beirut, Asuncion, Amman, Damasc, Cairo) și pe
  -- fusurile obișnuite, 2025–2027.
  select string_agg(format('%s %s → %s', z.tz, g.day::date, public.zoned_day_start(g.day::date, z.tz)), '; '), count(*)
    into v_bad, v_n
    from unnest(array['America/Havana', 'Atlantic/Azores', 'America/Santiago', 'Asia/Beirut', 'America/Asuncion',
                      'Asia/Amman', 'Asia/Damascus', 'Africa/Cairo', 'Europe/Bucharest',
                      'Europe/London', 'America/New_York', 'Pacific/Auckland', 'Asia/Kolkata',
                      'Australia/Lord_Howe', 'Pacific/Chatham', 'America/St_Johns']) z(tz)
   cross join generate_series('2025-01-01'::date, '2027-12-31'::date, interval '1 day') g(day)
   where (public.zoned_day_start(g.day::date, z.tz) at time zone z.tz)::date is distinct from g.day::date
      or ((public.zoned_day_start(g.day::date, z.tz) - interval '1 minute') at time zone z.tz)::date
         is distinct from (g.day::date - 1);
  if v_n > 0 then
    raise exception 'FZ8 FAIL: % zile nu încep la primul lor minut: %', v_n, left(v_bad, 400); end if;
  -- Control RO: pe București rezultatul e IDENTIC cu forma 314.
  select count(*) into v_n
    from generate_series('2025-01-01'::date, '2027-12-31'::date, interval '1 day') g(day)
   where public.zoned_day_start(g.day::date, 'Europe/Bucharest')
         is distinct from (g.day::date::timestamp at time zone 'Europe/Bucharest');
  if v_n > 0 then
    raise exception 'FZ8 FAIL: pe București % zile încep altfel decât în 314', v_n; end if;
  -- Suprafața: authenticated îl poate chema (get_locations_summary e INVOKER),
  -- anon / service_role / PUBLIC nu.
  if not has_function_privilege('authenticated', 'public.zoned_day_start(date, text)', 'execute')
     or has_function_privilege('anon', 'public.zoned_day_start(date, text)', 'execute')
     or has_function_privilege('service_role', 'public.zoned_day_start(date, text)', 'execute') then
    raise exception 'FZ8 FAIL: ACL-ul lui zoned_day_start nu mai e „doar authenticated”'; end if;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid = 'public.zoned_day_start(date, text)'::regprocedure and a.grantee = 0) then
    raise exception 'FZ8 FAIL: PUBLIC poate executa zoned_day_start'; end if;
  if (select prosecdef from pg_proc where oid = 'public.zoned_day_start(date, text)'::regprocedure) then
    raise exception 'FZ8 FAIL: zoned_day_start e SECURITY DEFINER (nu are de ce)'; end if;
  -- (Viu sub authenticated: FZ0 — fără EXECUTE apelul lui A aruncă 42501.)
  raise notice 'FZ8 PASS: zoned_day_start dă primul minut al zilei pe 16 fusuri × 2025–2027 (inclusiv miezul nopții dublu), identic cu 314 pe București';
end $$;

rollback;
