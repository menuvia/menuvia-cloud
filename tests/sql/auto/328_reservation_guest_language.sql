-- tests/sql/auto/328_reservation_guest_language.sql
-- =============================================================================
-- GL1–GL7 — clichetul PERMANENT al mig 328 (lotul L8b): limba oaspetelui se
-- păstrează pe rezervare, ajunge în confirmarea SMS și în claim-ul de
-- remindere, fără să piardă vreun invariant al lanțului. Rulează din
-- tests/sql/auto/ (scripts/run-sql-auto.sh) pe AMBELE medii; autonom,
-- ROLLBACK la final. Comparațiile sunt `is distinct from`.
--
--   GL1  coloana: text NULL fără default; cele 7 limbi + NULL trec, 'pt' e
--        respins de CHECK (23514).
--        [PICĂ: CHECK lipsă / listă diferită]
--   GL2  `create_reservation_public` apelat SUB rolul REAL `anon`, pe NUME
--        (ca PostgREST): eticheta se normalizează ('en-US' → 'en', 'DE' → 'de',
--        ' fr_CA ' → 'fr', 'es-419' → 'es'), iar o limbă necunoscută / un șir
--        gol / un cuvânt ('pt-BR', 'english', '') NU respinge rezervarea —
--        se salvează NULL. Control pozitiv: toate cele 10 rezervări există.
--        [PICĂ: fără normalizare ('en-US' lovește CHECK-ul → rezervare
--         respinsă); coloana scoasă din INSERT; grantul anon pierdut]
--   GL3  contractele vechi trec pe funcția nouă: 11 argumente (273, cu cheie)
--        și 10 argumente (fără cheie), pe NUME, sub `anon` → rezervare cu
--        guest_language NULL.
--        [PICĂ: parametrul nou fără default]
--   GL4  idempotența: o retrimitere cu ACEEAȘI cheie și altă limbă întoarce
--        rândul existent, fără să-i rescrie limba; un singur rând.
--        [PICĂ: lookup-ul care face UPDATE pe limbă / un al doilea INSERT]
--   GL5  SMS-ul de confirmare: rezervarea publică confirmată automat pune în
--        coadă `template_data.guest_language` = limba normalizată; cheile =
--        cele de dinainte ∪ {guest_language}; NULL → cheia prezentă cu JSON
--        null; aprobarea pending → confirmed din panou poartă limba stocată.
--        Control: count = 1 înainte de orice citire.
--        [PICĂ: cheia scoasă din trigger (= replay fără 328)]
--   GL6  claim-ul de remindere întoarce guest_language (apel REAL sub
--        `service_role`): 'hu' pentru rândul cu limbă, NULL pentru cel fără.
--        [PICĂ: coloana scoasă / proiectată din altă sursă]
--   GL7  invariantele pe CATALOG: o singură semnătură de RPC (anti PGRST203),
--        12 argumente cu `p_guest_language` ULTIMUL și opțional, proiecția de
--        8 coloane, DEFINER + pg_temp, EXECUTE anon + authenticated și NU
--        PUBLIC; trigger-ul SMS exception-wrapped, nechemabil prin /rpc;
--        claim-ul cu `guest_language` ULTIMA coloană, reclaim-ul 215, ambele
--        canale, `skip locked`, EXECUTE doar service_role.
--        [PICĂ: grant PUBLIC; un overload vechi lăsat în urmă; coloana
--         mutată în mijlocul retururilor]
-- =============================================================================

begin;

-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('32800000-0000-4000-8000-00000000a001', 'gl328-owner-a@gl.test'),
  ('32800000-0000-4000-8000-00000000a002', 'gl328-owner-b@gl.test'),
  ('32800000-0000-4000-8000-00000000a003', 'gl328-owner-c@gl.test');
-- SMS doar pe planurile plătite (228); pe free, limita de membri (131) respinge
-- și primul membership.
update public.profiles set plan = 'growth'
 where id in ('32800000-0000-4000-8000-00000000a001', '32800000-0000-4000-8000-00000000a002',
              '32800000-0000-4000-8000-00000000a003');

insert into public.restaurants (id, owner_id, name, slug, city, is_active, phone) values
  ('32800000-0000-4000-8000-00000000b001', '32800000-0000-4000-8000-00000000a001', 'GL Bistro A', 'gl328-a', 'Cluj', true, '+40722000328'),
  ('32800000-0000-4000-8000-00000000b002', '32800000-0000-4000-8000-00000000a002', 'GL Bistro B', 'gl328-b', 'Cluj', true, null),
  ('32800000-0000-4000-8000-00000000b003', '32800000-0000-4000-8000-00000000a003', 'GL Bistro C', 'gl328-c', 'Cluj', true, null);
insert into public.restaurant_memberships (restaurant_id, user_id, role) values
  ('32800000-0000-4000-8000-00000000b001', '32800000-0000-4000-8000-00000000a001', 'owner'),
  ('32800000-0000-4000-8000-00000000b002', '32800000-0000-4000-8000-00000000a002', 'owner'),
  ('32800000-0000-4000-8000-00000000b003', '32800000-0000-4000-8000-00000000a003', 'owner')
on conflict (restaurant_id, user_id) do nothing;

insert into public.restaurant_modules (restaurant_id, module_key, enabled) values
  ('32800000-0000-4000-8000-00000000b001', 'reservations', true),
  ('32800000-0000-4000-8000-00000000b001', 'sms_notifications', true),
  ('32800000-0000-4000-8000-00000000b002', 'reservations', true),
  ('32800000-0000-4000-8000-00000000b003', 'reservations', true)
on conflict (restaurant_id, module_key) do update set enabled = excluded.enabled;

-- Program permisiv; confirmare automată (A: SMS-ul de confirmare pleacă la INSERT).
insert into public.reservation_settings
  (restaurant_id, open_days, open_time, close_time, min_advance_hours, max_advance_days, auto_confirm)
values
  ('32800000-0000-4000-8000-00000000b001', '{1,2,3,4,5,6,7}', '00:00', '23:59', 0, 3650, true),
  ('32800000-0000-4000-8000-00000000b002', '{1,2,3,4,5,6,7}', '00:00', '23:59', 0, 3650, true),
  ('32800000-0000-4000-8000-00000000b003', '{1,2,3,4,5,6,7}', '00:00', '23:59', 0, 3650, true)
on conflict (restaurant_id) do update
  set open_days = excluded.open_days, open_time = excluded.open_time, close_time = excluded.close_time,
      min_advance_hours = excluded.min_advance_hours, max_advance_days = excluded.max_advance_days,
      auto_confirm = excluded.auto_confirm;

insert into public.tables (id, restaurant_id, name, slug, seats, is_active) values
  ('32800000-0000-4000-8000-00000000d001', '32800000-0000-4000-8000-00000000b001', 'GL-A1', 'gl-a1', 4, true),
  ('32800000-0000-4000-8000-00000000d002', '32800000-0000-4000-8000-00000000b002', 'GL-B1', 'gl-b1', 4, true),
  ('32800000-0000-4000-8000-00000000d003', '32800000-0000-4000-8000-00000000b003', 'GL-C1', 'gl-c1', 4, true);

-- Rezultatele apelurilor publice, citite ca postgres DUPĂ revenirea din `anon`.
create temp table gl_calls (label text primary key, rid uuid, expected text) on commit drop;
grant insert, select on gl_calls to anon;

-- ── GL1 ──────────────────────────────────────────────────────────────────────
do $$
declare
  v_lang text;
  v_ok   boolean := false;
  v_i    int := 0;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'reservations'
                    and column_name = 'guest_language' and data_type = 'text'
                    and is_nullable = 'YES' and column_default is null) then
    raise exception 'GL1 FAIL: reservations.guest_language nu e text NULL fără default';
  end if;
  foreach v_lang in array array['ro','en','de','fr','it','hu','es'] loop
    v_i := v_i + 1;
    -- `source` explicit: default-ul 'public' trece prin rate-limit-ul public (115).
    insert into public.reservations
      (restaurant_id, customer_name, customer_phone, party_size, starts_at, ends_at,
       status, source, guest_language)
    values ('32800000-0000-4000-8000-00000000b003', 'GL1 ' || v_lang, '07223281' || lpad(v_i::text, 2, '0'), 2,
            now() + make_interval(days => 400 + v_i), now() + make_interval(days => 400 + v_i, hours => 2),
            'pending', 'dashboard', v_lang);
  end loop;
  insert into public.reservations
    (restaurant_id, customer_name, customer_phone, party_size, starts_at, ends_at, status, source, guest_language)
  values ('32800000-0000-4000-8000-00000000b003', 'GL1 null', '0722328199', 2,
          now() + interval '420 days', now() + interval '420 days 2 hours', 'pending', 'dashboard', null);
  begin
    insert into public.reservations
      (restaurant_id, customer_name, customer_phone, party_size, starts_at, ends_at, status, source, guest_language)
    values ('32800000-0000-4000-8000-00000000b003', 'GL1 pt', '0722328198', 2,
            now() + interval '421 days', now() + interval '421 days 2 hours', 'pending', 'dashboard', 'pt');
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'GL1 FAIL: CHECK-ul a acceptat guest_language = ''pt''';
  end if;
  if (select count(*) from public.reservations
       where restaurant_id = '32800000-0000-4000-8000-00000000b003' and customer_name like 'GL1 %') <> 8 then
    raise exception 'GL1 FAIL: cele 7 limbi + NULL nu au intrat toate';
  end if;
  raise notice 'GL1 PASS: coloana NULL fără default, 7 limbi + NULL, restul respins de CHECK';
end $$;

-- ── GL2 + GL3 + GL4 (apeluri sub rolul REAL `anon`, pe NUME) ─────────────────
do $$
declare
  r      record;
  v_rid  uuid;
  v_i    int := 0;
  c_sql  constant text :=
    'select x.reservation_id from public.create_reservation_public('
    || 'p_slug => $1, p_customer_name => $2, p_customer_phone => $3, p_party_size => 2::smallint, '
    || 'p_starts_at => $4, p_idempotency_key => $5, p_guest_language => $6) x';
begin
  perform set_config('role', 'anon', true);
  for r in
    select * from (values
      ('a1', 'gl328-a', 'en-US',   'en'),
      ('a2', 'gl328-a', 'DE',      'de'),
      ('a3', 'gl328-a', ' fr_CA ', 'fr'),
      ('a4', 'gl328-a', 'it',      'it'),
      ('a5', 'gl328-a', 'hu-HU',   'hu'),
      ('b1', 'gl328-b', 'es-419',  'es'),
      ('b2', 'gl328-b', 'ro',      'ro'),
      ('b3', 'gl328-b', 'pt-BR',   null),
      ('b4', 'gl328-b', 'english', null),
      ('b5', 'gl328-b', '',        null)
    ) t(label, slug, tag, expected)
  loop
    v_i := v_i + 1;
    execute c_sql into v_rid
      using r.slug, 'GL2 ' || r.label, '07223282' || lpad(v_i::text, 2, '0'),
            ((current_date + 30 + v_i)::timestamp + time '12:00') at time zone 'Europe/Bucharest',
            gen_random_uuid(), r.tag;
    insert into gl_calls values (r.label, v_rid, r.expected);
  end loop;

  -- GL3: contractul 273 (11 argumente, cu cheie) și cel de dinainte (10).
  execute 'select x.reservation_id from public.create_reservation_public('
       || 'p_slug => $1, p_customer_name => $2, p_customer_phone => $3, p_party_size => 2::smallint, '
       || 'p_starts_at => $4, p_customer_email => null, p_special_requests => null, '
       || 'p_duration_minutes => null, p_zone => null, p_table_id => null, p_idempotency_key => $5) x'
    into v_rid
    using 'gl328-c', 'GL3 c273', '0722328301',
          ((current_date + 60)::timestamp + time '12:00') at time zone 'Europe/Bucharest', gen_random_uuid();
  insert into gl_calls values ('c273', v_rid, null);
  execute 'select x.reservation_id from public.create_reservation_public('
       || 'p_slug => $1, p_customer_name => $2, p_customer_phone => $3, p_party_size => 2::smallint, '
       || 'p_starts_at => $4, p_customer_email => null, p_special_requests => null, '
       || 'p_duration_minutes => null, p_zone => null, p_table_id => null) x'
    into v_rid
    using 'gl328-c', 'GL3 c10', '0722328302',
          ((current_date + 61)::timestamp + time '12:00') at time zone 'Europe/Bucharest';
  insert into gl_calls values ('c10', v_rid, null);

  -- GL4: aceeași cheie, altă limbă la retrimitere.
  execute c_sql into v_rid
    using 'gl328-c', 'GL4 idem', '0722328303',
          ((current_date + 62)::timestamp + time '12:00') at time zone 'Europe/Bucharest',
          '32800000-0000-4000-8000-0000000000e1'::uuid, 'de';
  insert into gl_calls values ('c_idem1', v_rid, 'de');
  execute c_sql into v_rid
    using 'gl328-c', 'GL4 idem', '0722328303',
          ((current_date + 62)::timestamp + time '12:00') at time zone 'Europe/Bucharest',
          '32800000-0000-4000-8000-0000000000e1'::uuid, 'en';
  insert into gl_calls values ('c_idem2', v_rid, 'de');
  perform set_config('role', 'none', true);
end $$;

do $$
declare
  r     record;
  v_got text;
  v_n   int;
begin
  -- Control pozitiv: fiecare apel a creat un rând, ca anon.
  select count(*) into v_n from gl_calls c join public.reservations x on x.id = c.rid;
  if v_n is distinct from 14 then
    raise exception 'GL2 FAIL: % rezervări găsite pentru 14 apeluri (o etichetă a respins rezervarea?)', v_n;
  end if;
  for r in select c.label, c.expected, x.guest_language, x.source
             from gl_calls c join public.reservations x on x.id = c.rid
            where c.label not like 'c%' loop
    if r.guest_language is distinct from r.expected then
      raise exception 'GL2 FAIL: %: guest_language = % (aștept %)', r.label, r.guest_language, r.expected;
    end if;
    if r.source is distinct from 'public' then
      raise exception 'GL2 FAIL: %: source = % (fixtura nu trece prin RPC)', r.label, r.source;
    end if;
  end loop;
  raise notice 'GL2 PASS: eticheta se normalizează, o limbă necunoscută dă NULL fără să respingă rezervarea';

  select x.guest_language into v_got from gl_calls c join public.reservations x on x.id = c.rid where c.label = 'c273';
  if v_got is not null then raise exception 'GL3 FAIL: contractul 273 a salvat limba %', v_got; end if;
  select x.guest_language into v_got from gl_calls c join public.reservations x on x.id = c.rid where c.label = 'c10';
  if v_got is not null then raise exception 'GL3 FAIL: contractul vechi a salvat limba %', v_got; end if;
  raise notice 'GL3 PASS: contractele 273 și vechi trec pe funcția nouă, limba rămâne NULL';

  if (select rid from gl_calls where label = 'c_idem1') is distinct from (select rid from gl_calls where label = 'c_idem2') then
    raise exception 'GL4 FAIL: retrimiterea cu aceeași cheie a întors alt rând';
  end if;
  select count(*) into v_n from public.reservations
   where restaurant_id = '32800000-0000-4000-8000-00000000b003'
     and idempotency_key = '32800000-0000-4000-8000-0000000000e1';
  if v_n is distinct from 1 then raise exception 'GL4 FAIL: % rânduri pentru aceeași cheie', v_n; end if;
  select x.guest_language into v_got from gl_calls c join public.reservations x on x.id = c.rid where c.label = 'c_idem2';
  if v_got is distinct from 'de' then
    raise exception 'GL4 FAIL: retrimiterea a rescris limba în %', v_got;
  end if;
  raise notice 'GL4 PASS: retrimiterea întoarce rândul existent, cu limba primei cereri';
end $$;

-- ── GL5 ──────────────────────────────────────────────────────────────────────
do $$
declare
  r      record;
  v_n    int;
  v_td   jsonb;
  v_keys text[];
  c_keys constant text[] := array['confirmation_code', 'customer_name', 'guest_language', 'party_size',
                                  'restaurant_name', 'restaurant_phone', 'starts_at'];
  v_pid  uuid := '32800000-0000-4000-8000-00000000c501';
begin
  for r in select c.label, c.rid, c.expected, x.status
             from gl_calls c join public.reservations x on x.id = c.rid
            where c.label like 'a%' order by c.label loop
    if r.status is distinct from 'confirmed' then
      raise exception 'GL5 FAIL: %: status % (fixtura nu exersează confirmarea automată)', r.label, r.status;
    end if;
    select count(*) into v_n from public.sms_queue
     where dedup_key = 'sms_reservation_confirmed:' || r.rid::text;
    if v_n is distinct from 1 then
      raise exception 'GL5 FAIL: %: % rânduri SMS (aștept 1 — modul/plan/telefon greșite în fixtură)', r.label, v_n;
    end if;
    select template_data into v_td from public.sms_queue
     where dedup_key = 'sms_reservation_confirmed:' || r.rid::text;
    if v_td ->> 'guest_language' is distinct from r.expected then
      raise exception 'GL5 FAIL: %: template_data.guest_language = % (aștept %)', r.label, v_td ->> 'guest_language', r.expected;
    end if;
    select array_agg(k order by k collate "C") into v_keys from jsonb_object_keys(v_td) k;
    if v_keys is distinct from c_keys then
      raise exception 'GL5 FAIL: cheile template_data = %', v_keys;
    end if;
  end loop;

  -- Rezervare din panou fără limbă: cheia e prezentă, cu JSON null.
  insert into public.reservations
    (id, restaurant_id, customer_name, customer_phone, party_size, starts_at, ends_at, status, source)
  values ('32800000-0000-4000-8000-00000000c502', '32800000-0000-4000-8000-00000000b001',
          'GL5 null', '0722328502', 2, now() + interval '200 days', now() + interval '200 days 2 hours',
          'confirmed', 'dashboard');
  select template_data into v_td from public.sms_queue
   where dedup_key = 'sms_reservation_confirmed:32800000-0000-4000-8000-00000000c502';
  if v_td is null or not (v_td ? 'guest_language') or v_td -> 'guest_language' is distinct from 'null'::jsonb then
    raise exception 'GL5 FAIL: rezervarea fără limbă: template_data = %', v_td;
  end if;

  -- Aprobarea din panou (pending → confirmed) poartă limba stocată.
  insert into public.reservations
    (id, restaurant_id, customer_name, customer_phone, party_size, starts_at, ends_at, status, source, guest_language)
  values (v_pid, '32800000-0000-4000-8000-00000000b001',
          'GL5 pending', '0722328501', 2, now() + interval '201 days', now() + interval '201 days 2 hours',
          'pending', 'dashboard', 'it');
  if exists (select 1 from public.sms_queue where dedup_key = 'sms_reservation_confirmed:' || v_pid::text) then
    raise exception 'GL5 FAIL: SMS de confirmare pe o rezervare pending';
  end if;
  update public.reservations set status = 'confirmed' where id = v_pid;
  select count(*) into v_n from public.sms_queue where dedup_key = 'sms_reservation_confirmed:' || v_pid::text;
  if v_n is distinct from 1 then raise exception 'GL5 FAIL: aprobarea a pus % SMS-uri (aștept 1)', v_n; end if;
  select template_data into v_td from public.sms_queue where dedup_key = 'sms_reservation_confirmed:' || v_pid::text;
  if v_td ->> 'guest_language' is distinct from 'it' then
    raise exception 'GL5 FAIL: aprobarea din panou a pierdut limba (%)', v_td ->> 'guest_language';
  end if;
  raise notice 'GL5 PASS: confirmarea SMS poartă limba oaspetelui (INSERT + aprobare), NULL ca JSON null';
end $$;

-- ── GL6 ──────────────────────────────────────────────────────────────────────
insert into public.reservations
  (id, restaurant_id, customer_name, customer_phone, customer_email, party_size, starts_at, ends_at,
   status, source, guest_language)
values
  ('32800000-0000-4000-8000-00000000c601', '32800000-0000-4000-8000-00000000b001', 'GL6 hu', '0722328601',
   'gl6-hu@gl.test', 2, now() + interval '3 hours', now() + interval '5 hours', 'confirmed', 'dashboard', 'hu'),
  ('32800000-0000-4000-8000-00000000c602', '32800000-0000-4000-8000-00000000b002', 'GL6 null', '0722328602',
   'gl6-null@gl.test', 2, now() + interval '4 hours', now() + interval '6 hours', 'confirmed', 'dashboard', null);

do $$
declare
  v_rows jsonb;
begin
  perform set_config('role', 'service_role', true);
  execute $q$select coalesce(jsonb_object_agg(c.id::text, jsonb_build_object('lang', c.guest_language)), '{}'::jsonb)
              from public.claim_reservation_reminders(100) c
             where c.id in ('32800000-0000-4000-8000-00000000c601', '32800000-0000-4000-8000-00000000c602')$q$
    into v_rows;
  perform set_config('role', 'none', true);

  if (select count(*) from jsonb_object_keys(v_rows)) is distinct from 2 then
    raise exception 'GL6 FAIL: claim-ul a întors % din cele 2 rezervări (fixtura nu e în fereastră?): %',
      (select count(*) from jsonb_object_keys(v_rows)), v_rows;
  end if;
  if v_rows -> '32800000-0000-4000-8000-00000000c601' ->> 'lang' is distinct from 'hu' then
    raise exception 'GL6 FAIL: claim-ul a întors limba % pentru rândul în maghiară', v_rows -> '32800000-0000-4000-8000-00000000c601';
  end if;
  if v_rows -> '32800000-0000-4000-8000-00000000c602' -> 'lang' is distinct from 'null'::jsonb then
    raise exception 'GL6 FAIL: claim-ul a întors % pentru rândul fără limbă', v_rows -> '32800000-0000-4000-8000-00000000c602';
  end if;
  raise notice 'GL6 PASS: claim-ul (service_role) întoarce guest_language';
end $$;

-- ── GL7 ──────────────────────────────────────────────────────────────────────
do $$
declare
  v_crp  regprocedure := to_regprocedure('public.create_reservation_public(text,text,text,smallint,timestamptz,text,text,smallint,text,uuid,uuid,text)');
  v_trg  regprocedure := 'public.trg_sms_on_reservation_confirmed()'::regprocedure;
  v_cl   regprocedure := 'public.claim_reservation_reminders(integer)'::regprocedure;
  v_n    int;
  v_out  text[];
  v_def  text;
  v_cfg  text;
  v_tok  text;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_reservation_public';
  if v_n is distinct from 1 or v_crp is null then
    raise exception 'GL7 FAIL: % semnături create_reservation_public, cea nouă %', v_n, coalesce(v_crp::text, 'LIPSĂ');
  end if;
  if (select pronargs from pg_proc where oid = v_crp) is distinct from 12::smallint
     or (select pronargdefaults from pg_proc where oid = v_crp) is distinct from 7::smallint
     or (select proargnames[12] from pg_proc where oid = v_crp) is distinct from 'p_guest_language' then
    raise exception 'GL7 FAIL: p_guest_language nu e al 12-lea argument, opțional';
  end if;
  select array_agg(a order by o) into v_out
    from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as x(a, m, o)
   where p.oid = v_crp and m = 't';
  if v_out is distinct from array['reservation_id','confirmation_code','status','table_name',
                                  'starts_at','ends_at','requested_zone','party_size']::text[] then
    raise exception 'GL7 FAIL: proiecția s-a schimbat: %', v_out;
  end if;
  select array_to_string(proconfig, ',') into v_cfg from pg_proc where oid = v_crp;
  if not (select prosecdef from pg_proc where oid = v_crp) or coalesce(v_cfg, '') not like '%search_path=public, pg_temp%' then
    raise exception 'GL7 FAIL: RPC-ul și-a pierdut DEFINER/search_path (%)', v_cfg;
  end if;
  if not has_function_privilege('anon', v_crp, 'EXECUTE') or not has_function_privilege('authenticated', v_crp, 'EXECUTE') then
    raise exception 'GL7 FAIL: rezervarea publică a pierdut EXECUTE pentru anon/authenticated';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid = v_crp and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
    raise exception 'GL7 FAIL: PUBLIC are EXECUTE pe create_reservation_public';
  end if;
  v_def := pg_get_functiondef(v_crp);
  foreach v_tok in array array['v_guest_lang', 'pg_advisory_xact_lock', 'table_unavailable', 'least(',
                               'is_module_enabled', 'close_time <= v_settings.open_time', '- interval ''1 day''',
                               'unique_violation', 'raise;', '''expired''', 'safe_time_zone(v_tz)'] loop
    if position(v_tok in v_def) = 0 then
      raise exception 'GL7 FAIL: create_reservation_public a pierdut „%”', v_tok;
    end if;
  end loop;

  v_def := pg_get_functiondef(v_trg);
  if v_def !~* 'exception\s+when\s+others' or v_def !~* 'raise\s+warning' then
    raise exception 'GL7 FAIL: trigger-ul SMS nu mai e exception-wrapped';
  end if;
  if has_function_privilege('anon', v_trg, 'EXECUTE') or has_function_privilege('authenticated', v_trg, 'EXECUTE') then
    raise exception 'GL7 FAIL: funcția de trigger SMS e apelabilă prin /rpc';
  end if;

  select array_agg(a order by o) into v_out
    from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as x(a, m, o)
   where p.oid = v_cl and m = 't';
  if v_out[array_length(v_out, 1)] is distinct from 'guest_language' or array_length(v_out, 1) is distinct from 11 then
    raise exception 'GL7 FAIL: coloanele claim-ului = % (guest_language trebuie să fie a 11-a, ultima)', v_out;
  end if;
  v_def := pg_get_functiondef(v_cl);
  foreach v_tok in array array['interval ''15 minutes''', 'customer_email is not null', 'fn_sms_normalize_ro_phone',
                               'sms_notifications', 'reminder_hours_before', 'for update of r2 skip locked'] loop
    if position(v_tok in v_def) = 0 then
      raise exception 'GL7 FAIL: claim_reservation_reminders a pierdut „%”', v_tok;
    end if;
  end loop;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'claim_reservation_reminders';
  if v_n is distinct from 1 then raise exception 'GL7 FAIL: % semnături claim_reservation_reminders', v_n; end if;
  if has_function_privilege('anon', v_cl, 'EXECUTE') or has_function_privilege('authenticated', v_cl, 'EXECUTE')
     or not has_function_privilege('service_role', v_cl, 'EXECUTE') then
    raise exception 'GL7 FAIL: claim-ul nu mai e service_role-only';
  end if;
  raise notice 'GL7 PASS: semnături, proiecții, ACL și invariantele lanțului';
end $$;

rollback;
