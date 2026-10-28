-- tests/sql/reservation_timezone_assertions.sql
-- =============================================================================
-- Aserții permanente pentru mig 298 (G0, menuvia.com): rezervarea publică se
-- judecă în fusul RESTAURANTULUI, iar limba de bază + țara ajung la oaspete.
--
--   RZ1  Local în America/New_York, deschis 18:00–23:00 doar SÂMBĂTA:
--        sâmbătă 19:00 la New York → ACCEPTATĂ (chemată ca rolul REAL `anon`);
--        sâmbătă 12:00 la New York → RESPINSĂ „în afara programului";
--        sâmbătă 03:00 la New York → RESPINSĂ (control: ambele coduri o resping).
--        [PICĂ pe codul vechi: 19:00 NY = 01:00/02:00 duminică la București →
--         respinsă pe zi ȘI pe oră; 12:00 NY = 18:00/19:00 sâmbătă la București →
--         ACCEPTATĂ, deși localul e închis]
--   RZ2  Wrap-around + ziua de SERVICIU (241) într-un fus ne-București
--        (America/Los_Angeles, 18:00–02:00, doar sâmbăta): duminică 01:00 LA
--        (serviciul de sâmbătă) → acceptată; sâmbătă 23:00 LA → acceptată;
--        sâmbătă 01:00 LA (serviciul de vineri) → respinsă pe ZI.
--        [PICĂ pe codul vechi: duminică 01:00 LA = duminică 10:00/11:00 la
--         București → respinsă; sâmbătă 01:00 LA ieșea pe ORĂ, nu pe zi]
--   RZ3  Fus invalid / NULL / POSIX / cu spații → comportamentul Bucureștiului
--        (paritate cu safeTimeZone din client), iar un nume valid scris cu altă
--        capitalizare se folosește CANONIC (Intl îl acceptă, deci și formularul).
--        [PICĂ dacă funcția folosește fusul brut: „time zone not recognized";
--         dacă helperul nu validează sau nu e case-insensitive]
--   RZ4  Restaurantele din București: comportament neschimbat (fereastră
--        normală + wrap-around + ziua de serviciu), pe date RELATIVE — RS1–RS3
--        rămân și ele verzi.
--        [PICĂ dacă fusul implicit devine altul decât București (ex. UTC)]
--   RZ5  Clichete structurale: o singură semnătură, niciun 'Europe/Bucharest'
--        hardcodat în create_reservation_public, fusul validat în toate cele 3
--        locuri, invarianții lanțului (273/289), helperul închis pentru clienți.
--   RZ6  Limba de bază + țara: owner-ul o scrie SUB rolul REAL `authenticated`
--        (CHECK pe cele 7 limbi), un străin nu (RLS, control pozitiv), iar
--        `resolve_qr_token` / `get_restaurant_by_slug` / `get_menu_by_slug` le
--        proiectează.
--        [PICĂ fără grant (42501), fără CHECK, fără cheile noi în proiecții]
--
-- Datele sunt RELATIVE (prima sâmbătă la ≥10 zile de azi): o dată fixă ar pica
-- după ce trece, pe plafonul de avans — dintr-un motiv fără legătură cu fusul.
-- Plafonul anti-abuz (115/129) = 5 rezervări publice/minut per restaurant și
-- 3/5 min per telefon → fiecare restaurant are ≤4 reușite, telefoane distincte.
--
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a2980000-0000-4000-8000-000000000001','rz-ny@rz.test'),
  ('a2980000-0000-4000-8000-000000000002','rz-la@rz.test'),
  ('a2980000-0000-4000-8000-000000000003','rz-bad@rz.test'),
  ('a2980000-0000-4000-8000-000000000004','rz-low@rz.test'),
  ('a2980000-0000-4000-8000-000000000005','rz-buc@rz.test'),
  ('a2980000-0000-4000-8000-000000000006','rz-stranger@rz.test');
update public.profiles set plan = 'enterprise'
 where id::text like 'a2980000-0000-4000-8000-00000000000%';

insert into public.restaurants (id, owner_id, name, slug, city, is_active, timezone) values
  ('b2980000-0000-4000-8000-000000000001','a2980000-0000-4000-8000-000000000001','RZ NY','rz-ny-slug','New York',true,'America/New_York'),
  ('b2980000-0000-4000-8000-000000000002','a2980000-0000-4000-8000-000000000002','RZ LA','rz-la-slug','Los Angeles',true,'America/Los_Angeles'),
  ('b2980000-0000-4000-8000-000000000003','a2980000-0000-4000-8000-000000000003','RZ Bad','rz-bad-slug','Nowhere',true,'Mars/Olympus'),
  ('b2980000-0000-4000-8000-000000000004','a2980000-0000-4000-8000-000000000004','RZ Low','rz-low-slug','New York',true,'america/new_york'),
  ('b2980000-0000-4000-8000-000000000005','a2980000-0000-4000-8000-000000000005','RZ Buc','rz-buc-slug','Cluj',true,'Europe/Bucharest');

insert into public.restaurant_modules (restaurant_id, module_key, enabled)
select id, 'reservations', true from public.restaurants
 where id::text like 'b2980000-0000-4000-8000-00000000000%'
on conflict (restaurant_id, module_key) do update set enabled = true;

insert into public.reservation_settings
  (restaurant_id, open_days, open_time, close_time, min_advance_hours, max_advance_days, auto_confirm)
values
  ('b2980000-0000-4000-8000-000000000001','{6}',            '18:00','23:00',0,3650,true),
  ('b2980000-0000-4000-8000-000000000002','{6}',            '18:00','02:00',0,3650,true),
  ('b2980000-0000-4000-8000-000000000003','{1,2,3,4,5,6,7}','18:00','23:00',0,3650,true),
  ('b2980000-0000-4000-8000-000000000004','{1,2,3,4,5,6,7}','18:00','23:00',0,3650,true),
  ('b2980000-0000-4000-8000-000000000005','{6}',            '18:00','02:00',0,3650,true)
on conflict (restaurant_id) do update
  set open_days = excluded.open_days, open_time = excluded.open_time,
      close_time = excluded.close_time, min_advance_hours = 0,
      max_advance_days = 3650, auto_confirm = true;

-- Prima sâmbătă la cel puțin 10 zile de azi (dată RELATIVĂ, vezi antetul).
create or replace function pg_temp.rz_sat() returns date
language sql stable as $$
  select (current_date + 10 + ((6 - extract(isodow from current_date + 10)::int + 7) % 7))::date
$$;

-- Ora de PERETE `p_hm` în ziua `p_day` (offset față de sâmbătă), în fusul `p_tz`.
create or replace function pg_temp.rz_at(p_day int, p_hm text, p_tz text) returns timestamptz
language sql stable as $$
  select ((pg_temp.rz_sat() + p_day)::timestamp + p_hm::time) at time zone p_tz
$$;

-- 'OK:<status>' sau 'ERR:<mesaj>' — fiecare apel e propria subtranzacție.
create or replace function pg_temp.rz_try(p_slug text, p_phone text, p_at timestamptz) returns text
language plpgsql as $$
declare v_status text;
begin
  select r.status into v_status
    from public.create_reservation_public(p_slug, 'Client RZ', p_phone, 2::smallint, p_at) r;
  return 'OK:' || coalesce(v_status, '<null>');
exception when others then
  return 'ERR:' || sqlerrm;
end $$;

-- ── RZ1: New York, 18:00–23:00, doar sâmbăta ─────────────────────────────────
do $$
declare
  v_at  timestamptz := pg_temp.rz_at(0, '19:00', 'America/New_York');
  v_st  text;
  v_r   text;
begin
  -- Sâmbătă 19:00 la New York — apel ca rolul REAL `anon` (suprafața publică).
  perform set_config('role', 'anon', true);
  select r.status into v_st
    from public.create_reservation_public('rz-ny-slug', 'Client NY', '+12125550101', 2::smallint, v_at) r;
  perform set_config('role', 'none', true);
  if v_st is distinct from 'pending' then
    raise exception 'RZ1 FAIL: sâmbătă 19:00 la New York (local deschis) nu a fost acceptată (status %)', v_st;
  end if;

  -- Sâmbătă 12:00 la New York = 18:00/19:00 la București: localul e ÎNCHIS.
  v_r := pg_temp.rz_try('rz-ny-slug', '+12125550102', pg_temp.rz_at(0, '12:00', 'America/New_York'));
  if v_r not like 'ERR:%în afara programului%' then
    raise exception 'RZ1 FAIL: sâmbătă 12:00 la New York (închis) → % (așteptat: în afara programului)', v_r;
  end if;

  -- Control (brief): 03:00 la New York e respinsă de ambele coduri.
  v_r := pg_temp.rz_try('rz-ny-slug', '+12125550103', pg_temp.rz_at(0, '03:00', 'America/New_York'));
  if v_r not like 'ERR:%în afara programului%' then
    raise exception 'RZ1 FAIL: sâmbătă 03:00 la New York → % (așteptat: în afara programului)', v_r;
  end if;

  -- Ziua: duminică 19:00 la New York (local închis duminica) → respinsă pe ZI.
  v_r := pg_temp.rz_try('rz-ny-slug', '+12125550104', pg_temp.rz_at(1, '19:00', 'America/New_York'));
  if v_r not like 'ERR:%nu acceptă rezervări în această zi%' then
    raise exception 'RZ1 FAIL: duminică 19:00 la New York (închis duminica) → %', v_r;
  end if;

  raise notice 'RZ1 OK: New York judecat în fusul lui (19:00 acceptat, 12:00/03:00/duminica respinse)';
end $$;

-- ── RZ2: Los Angeles, 18:00–02:00 (wrap), doar sâmbăta ──────────────────────
do $$
declare v_r text;
begin
  -- Duminică 01:00 LA = serviciul de SÂMBĂTĂ → acceptată.
  v_r := pg_temp.rz_try('rz-la-slug', '+13105550201', pg_temp.rz_at(1, '01:00', 'America/Los_Angeles'));
  if v_r not like 'OK:%' then
    raise exception 'RZ2 FAIL: duminică 01:00 LA (serviciul de sâmbătă) → % (așteptat acceptată)', v_r;
  end if;
  -- Sâmbătă 23:00 LA → acceptată (fereastra [open, 24:00)).
  v_r := pg_temp.rz_try('rz-la-slug', '+13105550202', pg_temp.rz_at(0, '23:00', 'America/Los_Angeles'));
  if v_r not like 'OK:%' then
    raise exception 'RZ2 FAIL: sâmbătă 23:00 LA → % (așteptat acceptată)', v_r;
  end if;
  -- Sâmbătă 01:00 LA = serviciul de VINERI (închis) → respinsă pe ZI.
  v_r := pg_temp.rz_try('rz-la-slug', '+13105550203', pg_temp.rz_at(0, '01:00', 'America/Los_Angeles'));
  if v_r not like 'ERR:%nu acceptă rezervări în această zi%' then
    raise exception 'RZ2 FAIL: sâmbătă 01:00 LA (serviciul de vineri) → % (așteptat respinsă pe zi)', v_r;
  end if;
  -- Sâmbătă 03:00 LA: în afara ferestrei [18:00, 02:00).
  v_r := pg_temp.rz_try('rz-la-slug', '+13105550204', pg_temp.rz_at(0, '03:00', 'America/Los_Angeles'));
  if v_r not like 'ERR:%în afara programului%' then
    raise exception 'RZ2 FAIL: sâmbătă 03:00 LA → % (așteptat în afara programului)', v_r;
  end if;
  raise notice 'RZ2 OK: wrap-around + ziua de serviciu în fusul Los Angeles';
end $$;

-- ── RZ3: fus invalid / NULL → București; capitalizare → nume canonic ─────────
do $$
declare v_r text;
begin
  -- Helperul (contractul safeTimeZone din client).
  if public.safe_time_zone(null) is distinct from 'Europe/Bucharest'
     or public.safe_time_zone('') is distinct from 'Europe/Bucharest'
     or public.safe_time_zone('Mars/Olympus') is distinct from 'Europe/Bucharest'
     or public.safe_time_zone('UTC+3') is distinct from 'Europe/Bucharest'
     or public.safe_time_zone(' America/New_York') is distinct from 'Europe/Bucharest'
     or public.safe_time_zone('posixrules') is distinct from 'Europe/Bucharest' then
    raise exception 'RZ3 FAIL: safe_time_zone nu cade pe București pentru NULL/gol/invalid/POSIX/cu spații';
  end if;
  -- Control pozitiv: un fus valid trece neschimbat, iar capitalizarea se repară.
  if public.safe_time_zone('America/New_York') is distinct from 'America/New_York'
     or public.safe_time_zone('AMERICA/NEW_YORK') is distinct from 'America/New_York'
     or public.safe_time_zone('Europe/Bucharest') is distinct from 'Europe/Bucharest' then
    raise exception 'RZ3 FAIL: safe_time_zone nu întoarce numele canonic pentru un fus valid';
  end if;

  -- Restaurant cu fus INVALID: judecat ca București (18:00–23:00, orice zi).
  v_r := pg_temp.rz_try('rz-bad-slug', '+40722980301', pg_temp.rz_at(0, '19:00', 'Europe/Bucharest'));
  if v_r not like 'OK:%' then
    raise exception 'RZ3 FAIL: fus invalid, 19:00 la București → % (așteptat acceptată, ca București)', v_r;
  end if;
  v_r := pg_temp.rz_try('rz-bad-slug', '+40722980302', pg_temp.rz_at(0, '19:00', 'America/New_York'));
  if v_r not like 'ERR:%în afara programului%' then
    raise exception 'RZ3 FAIL: fus invalid, 19:00 la New York (= noapte la București) → %', v_r;
  end if;

  -- Restaurant cu 'america/new_york' (minuscule): Intl îl acceptă → serverul la fel.
  v_r := pg_temp.rz_try('rz-low-slug', '+12125550401', pg_temp.rz_at(0, '19:00', 'America/New_York'));
  if v_r not like 'OK:%' then
    raise exception 'RZ3 FAIL: fus scris cu minuscule, 19:00 la New York → % (așteptat acceptată)', v_r;
  end if;
  raise notice 'RZ3 OK: fus invalid → București; capitalizare → nume canonic';
end $$;

-- Un fus NULL nu poate fi STOCAT (coloana e NOT NULL din 049) — calea NULL e
-- acoperită de helper mai sus; aici confirmăm că NOT NULL a rămas.
do $$
begin
  if (select is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'restaurants'
         and column_name = 'timezone') is distinct from 'NO' then
    raise exception 'RZ3 FAIL: restaurants.timezone a devenit nullable (049)';
  end if;
end $$;

-- ── RZ4: București neschimbat (wrap 18:00–02:00 sâmbăta, apoi normal) ────────
do $$
declare v_r text;
begin
  -- Duminică 01:00 = serviciul de sâmbătă → acceptată (RS1, pe date relative).
  v_r := pg_temp.rz_try('rz-buc-slug', '+40722980501', pg_temp.rz_at(1, '01:00', 'Europe/Bucharest'));
  if v_r not like 'OK:%' then
    raise exception 'RZ4 FAIL: București, duminică 01:00 (serviciu sâmbătă) → %', v_r;
  end if;
  -- Sâmbătă 01:00 = serviciul de vineri → respinsă pe zi (RS2).
  v_r := pg_temp.rz_try('rz-buc-slug', '+40722980502', pg_temp.rz_at(0, '01:00', 'Europe/Bucharest'));
  if v_r not like 'ERR:%nu acceptă rezervări în această zi%' then
    raise exception 'RZ4 FAIL: București, sâmbătă 01:00 (serviciu vineri) → %', v_r;
  end if;
  -- Sâmbătă 19:00 → acceptată.
  v_r := pg_temp.rz_try('rz-buc-slug', '+40722980503', pg_temp.rz_at(0, '19:00', 'Europe/Bucharest'));
  if v_r not like 'OK:%' then
    raise exception 'RZ4 FAIL: București, sâmbătă 19:00 → %', v_r;
  end if;
  -- Sâmbătă 17:00 → în afara programului.
  v_r := pg_temp.rz_try('rz-buc-slug', '+40722980504', pg_temp.rz_at(0, '17:00', 'Europe/Bucharest'));
  if v_r not like 'ERR:%în afara programului%' then
    raise exception 'RZ4 FAIL: București, sâmbătă 17:00 → %', v_r;
  end if;
end $$;

update public.reservation_settings
   set open_days = '{7}', open_time = '10:00', close_time = '22:00'
 where restaurant_id = 'b2980000-0000-4000-8000-000000000005';

do $$
declare v_r text;
begin
  -- Program normal: duminică 12:00 acceptată, duminică 01:00 în afara orelor (RS3).
  v_r := pg_temp.rz_try('rz-buc-slug', '+40722980505', pg_temp.rz_at(1, '12:00', 'Europe/Bucharest'));
  if v_r not like 'OK:%' then
    raise exception 'RZ4 FAIL: București normal, duminică 12:00 → %', v_r;
  end if;
  v_r := pg_temp.rz_try('rz-buc-slug', '+40722980506', pg_temp.rz_at(1, '01:00', 'Europe/Bucharest'));
  if v_r not like 'ERR:%în afara programului%' then
    raise exception 'RZ4 FAIL: București normal, duminică 01:00 → %', v_r;
  end if;
  raise notice 'RZ4 OK: restaurantele din București judecate exact ca înainte';
end $$;

-- ── RZ5: clichete structurale ────────────────────────────────────────────────
do $$
declare
  v_src text;
  v_n   int;
  v_bad text;
  v_tok text;
  c_crp constant text := 'public.create_reservation_public(text,text,text,smallint,timestamptz,text,text,smallint,text,uuid,uuid)';
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_reservation_public';
  if v_n <> 1 then
    raise exception 'RZ5 FAIL: create_reservation_public are % semnături (PGRST203)', v_n;
  end if;
  v_src := pg_get_functiondef(c_crp::regprocedure);
  if position('''Europe/Bucharest''' in v_src) > 0 then
    raise exception 'RZ5 FAIL: create_reservation_public are fusul București HARDCODAT';
  end if;
  if position('public.safe_time_zone(' in v_src) = 0
     or (length(v_src) - length(replace(v_src, 'at time zone v_tz', ''))) / length('at time zone v_tz') <> 3 then
    raise exception 'RZ5 FAIL: fusul validat al restaurantului nu e folosit în toate cele 3 locuri (oră + 2× zi)';
  end if;
  foreach v_tok in array array[
    'p_idempotency_key', 'unique_violation', 'raise;', '- interval ''1 day''',
    'close_time <= v_settings.open_time', 'p_table_id', 'table_unavailable',
    'is_module_enabled', 'v_settings.reservation_duration', 'pg_advisory_xact_lock',
    $q$not in ('cancelled','no_show','expired')$q$
  ] loop
    if position(v_tok in v_src) = 0 then
      raise exception 'RZ5 FAIL: create_reservation_public a pierdut „%"', v_tok;
    end if;
  end loop;
  if not has_function_privilege('anon', c_crp, 'execute') then
    raise exception 'RZ5 FAIL: anon nu mai poate chema create_reservation_public';
  end if;

  select string_agg(r.rol, ', ') into v_bad
    from (values ('anon'), ('authenticated'), ('service_role')) as r(rol)
   where has_function_privilege(r.rol, 'public.safe_time_zone(text)', 'execute');
  if v_bad is not null then
    raise exception 'RZ5 FAIL: safe_time_zone e apelabil de: %', v_bad;
  end if;
  if not exists (select 1 from pg_proc
                  where oid = 'public.safe_time_zone(text)'::regprocedure
                    and coalesce(array_to_string(proconfig, ','), '') like '%pg_temp%') then
    raise exception 'RZ5 FAIL: safe_time_zone fără search_path cu pg_temp';
  end if;
  raise notice 'RZ5 OK: structură + invarianți + suprafață';
end $$;

-- ── RZ6: limba de bază + țara (scriere sub authenticated, proiecții) ────────
insert into public.tables (id, restaurant_id, name, slug, seats, is_active) values
  ('c2980000-0000-4000-8000-000000000001','b2980000-0000-4000-8000-000000000001','RZ-1','rz-1',4,true);
insert into public.qr_tokens (token, restaurant_id, table_id, is_active) values
  ('rz-qr-token-298','b2980000-0000-4000-8000-000000000001','c2980000-0000-4000-8000-000000000001',true);
update public.restaurants set country = 'US'
 where id = 'b2980000-0000-4000-8000-000000000001';

do $$
declare
  v_n   int;
  v_ok  boolean := false;
  v_qr  jsonb;
  v_row record;
  v_mb  jsonb;
begin
  -- Străinul (fără apartenență): UPDATE-ul nu atinge NIMIC (RLS).
  perform set_config('request.jwt.claim.sub', 'a2980000-0000-4000-8000-000000000006', true);
  perform set_config('role', 'authenticated', true);
  update public.restaurants set language = 'en'
   where id = 'b2980000-0000-4000-8000-000000000001';
  get diagnostics v_n = row_count;
  perform set_config('role', 'none', true);
  if v_n <> 0 then
    raise exception 'RZ6 FAIL: un cont fără apartenență a schimbat limba altui restaurant (% rânduri)', v_n;
  end if;

  -- Owner-ul: scrie limba (grant pe coloană + RLS is_admin).
  perform set_config('request.jwt.claim.sub', 'a2980000-0000-4000-8000-000000000001', true);
  perform set_config('role', 'authenticated', true);
  update public.restaurants set language = 'en'
   where id = 'b2980000-0000-4000-8000-000000000001';
  get diagnostics v_n = row_count;
  perform set_config('role', 'none', true);
  if v_n <> 1 then
    raise exception 'RZ6 FAIL: owner-ul nu și-a putut schimba limba de bază (% rânduri) — lipsește grant update (language)?', v_n;
  end if;

  -- Valoare în afara celor 7 limbi → respinsă de CHECK.
  begin
    perform set_config('role', 'authenticated', true);
    update public.restaurants set language = 'xx'
     where id = 'b2980000-0000-4000-8000-000000000001';
  exception when check_violation then
    v_ok := true;
  end;
  perform set_config('role', 'none', true);
  if not v_ok then
    raise exception 'RZ6 FAIL: restaurants.language a acceptat o limbă în afara celor 7';
  end if;
  if (select language from public.restaurants where id = 'b2980000-0000-4000-8000-000000000001')
     is distinct from 'en' then
    raise exception 'RZ6 FAIL: limba nu a rămas „en" după scrierea respinsă';
  end if;

  -- Proiecțiile publice (ca `anon`, suprafața reală).
  perform set_config('role', 'anon', true);
  v_qr := public.resolve_qr_token('rz-qr-token-298');
  select * into v_row from public.get_restaurant_by_slug('RZ-NY-SLUG');
  v_mb := public.get_menu_by_slug('rz-ny-slug');
  perform set_config('role', 'none', true);

  if v_qr -> 'restaurant' ->> 'language' is distinct from 'en' then
    raise exception 'RZ6 FAIL: resolve_qr_token nu proiectează limba de bază (primit %)', v_qr -> 'restaurant' -> 'language';
  end if;
  if v_row.language is distinct from 'en' or v_row.country is distinct from 'US' then
    raise exception 'RZ6 FAIL: get_restaurant_by_slug → language %, country % (așteptat en / US)', v_row.language, v_row.country;
  end if;
  if v_row.wifi_password is not null or v_row.qr_token is not null then
    raise exception 'RZ6 FAIL: get_restaurant_by_slug scurge wifi_password/qr_token (217)';
  end if;
  if v_mb -> 'restaurant' ->> 'country' is distinct from 'US'
     or v_mb -> 'restaurant' ->> 'language' is distinct from 'en' then
    raise exception 'RZ6 FAIL: get_menu_by_slug nu moștenește country/language (primit %)', v_mb -> 'restaurant';
  end if;

  -- anon nu scrie niciodată restaurants.
  if has_column_privilege('anon', 'public.restaurants', 'language', 'UPDATE') then
    raise exception 'RZ6 FAIL: anon poate scrie restaurants.language';
  end if;
  raise notice 'RZ6 OK: limba de bază scrisă de owner (CHECK, RLS), proiectată pe QR și /m/:slug, cu țara';
end $$;

select 'RESERVATION TIMEZONE + BASE LANGUAGE ASSERTIONS: RZ1–RZ6 PASS' as result;

rollback;
