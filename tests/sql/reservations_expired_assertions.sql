-- tests/sql/reservations_expired_assertions.sql
-- =============================================================================
-- Aserții permanente pentru mig 289 — decizia D1: rezervările `pending` rămase
-- în trecut devin `expired` (status NOU, nu `cancelled`/`no_show`).
--
--   RX1  CHECK-ul de status admite `expired` și RESPINGE un status inventat.
--   RX2  janitorul: `pending` mai vechi de grație → `expired` (inclusiv una de
--        116 zile — backfill NELIMITAT, deliberat); `pending` în grație /
--        viitoare, `confirmed`, `seated`, `completed` și `confirmed` vechi de
--        10 zile rămân NEATINSE (control pozitiv: 2 rânduri trebuie prinse).
--   RX3  AUTO-CONSUMAT: a doua rulare prinde 0 rânduri.
--   RX4  `expired` ELIBEREAZĂ masa: create_reservation_public cu p_table_id,
--        check_availability, get_tables_availability și inserarea directă
--        (EXCLUDE) reușesc pe un slot ocupat doar de un rând `expired` — iar
--        controlul pozitiv (același slot ocupat de un `pending`) rămâne blocat.
--   RX5  `expired` NU intră în get_reservation_no_show_counts (un telefon cu
--        două `expired` n-are rând; unul cu un `no_show` are exact 1).
--   RX6  auto_mark_reservation_no_show NU atinge `expired` (și nici invers).
--   RX7  clichet structural: `'expired'` în cele trei corpuri de funcție, în
--        indexul de disponibilitate și în EXCLUDE; create_reservation_public
--        își păstrează invarianții (o SINGURĂ semnătură, 11 argumente).
--   RX8  suprafața janitorului: zero EXECUTE pentru anon/authenticated/
--        service_role; DEFINER cu pg_temp; în manifest, minutul 43, orar.
--
-- Mutații dovedite (vezi raportul agentului): janitor fără `expired` în SET →
-- RX2; fără predicatul de grație → RX2; indexul/EXCLUDE/funcțiile fără
-- `expired` → RX4/RX7; `no_show` în loc de `expired` → RX5.
--
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a8900000-0000-4000-8000-000000000001','rx-owner@rx.test');
update public.profiles set plan = 'enterprise'
 where id = 'a8900000-0000-4000-8000-000000000001';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('b8900000-0000-4000-8000-000000000001','a8900000-0000-4000-8000-000000000001',
   'RX Bistro','rx-bistro-slug','Cluj',true);

insert into public.restaurant_memberships (restaurant_id, user_id, role) values
  ('b8900000-0000-4000-8000-000000000001','a8900000-0000-4000-8000-000000000001','owner')
on conflict (restaurant_id, user_id) do nothing;

insert into public.restaurant_modules (restaurant_id, module_key, enabled) values
  ('b8900000-0000-4000-8000-000000000001','reservations',true)
on conflict (restaurant_id, module_key) do update set enabled = true;

insert into public.reservation_settings
  (restaurant_id, open_days, open_time, close_time, min_advance_hours, max_advance_days, auto_confirm)
values
  ('b8900000-0000-4000-8000-000000000001','{1,2,3,4,5,6,7}','00:00','23:59',0,3650,true)
on conflict (restaurant_id) do update
  set open_days = '{1,2,3,4,5,6,7}', open_time = '00:00', close_time = '23:59',
      min_advance_hours = 0, max_advance_days = 3650, auto_confirm = true;

-- T1: ocupată DOAR de un rând expired (RX4); T2: ocupată de un pending (control).
insert into public.tables (id, restaurant_id, name, slug, seats, is_active) values
  ('c8900000-0000-4000-8000-000000000001','b8900000-0000-4000-8000-000000000001','RX-1','rx-1',4,true),
  ('c8900000-0000-4000-8000-000000000002','b8900000-0000-4000-8000-000000000001','RX-2','rx-2',4,true);

-- Rândurile de fixtură inserate direct sunt „de staff", nu publice: default-ul
-- coloanei `source` e 'public' și plafonul anti-abuz (mig 115, 5/minut) le-ar
-- număra. Se schimbă DOAR în această tranzacție (ROLLBACK la final); RPC-ul
-- public își scrie singur source='public'.
alter table public.reservations alter column source set default 'dashboard';

-- ── RX1: CHECK-ul de status ──────────────────────────────────────────────────
do $$
begin
  insert into public.reservations (id, restaurant_id, customer_name, customer_phone, party_size, starts_at, ends_at, status)
  values ('d8900000-0000-4000-8000-0000000000e1','b8900000-0000-4000-8000-000000000001','Check Ok','0700000001',2,
          now() - interval '5 days', now() - interval '5 days' + interval '2 hours', 'expired');
  begin
    insert into public.reservations (restaurant_id, customer_name, customer_phone, party_size, starts_at, ends_at, status)
    values ('b8900000-0000-4000-8000-000000000001','Check Bogus','0700000002',2,
            now() - interval '5 days', now() - interval '5 days' + interval '2 hours', 'expirat');
    raise exception 'RX1 FAIL: un status inventat a fost acceptat de CHECK';
  exception when check_violation then null;
  end;
  delete from public.reservations where id = 'd8900000-0000-4000-8000-0000000000e1';
  raise notice 'RX1 OK: expired admis, statusul inventat respins';
end $$;

-- ── RX2 + RX3: janitorul + auto-consumare ────────────────────────────────────
insert into public.reservations
  (id, restaurant_id, customer_name, customer_phone, party_size, starts_at, ends_at, status) values
  -- ar TREBUI expirate (CONTROL POZITIV: 2 rânduri)
  ('d8900000-0000-4000-8000-0000000000a1','b8900000-0000-4000-8000-000000000001','Pending 3h','0711000001',2,
     now() - interval '3 hours', now() - interval '1 hour','pending'),
  ('d8900000-0000-4000-8000-0000000000a2','b8900000-0000-4000-8000-000000000001','Pending 116z','0711000002',2,
     now() - interval '116 days', now() - interval '116 days' + interval '2 hours','pending'),
  -- NU: pending încă în grație (staff-ul o mai poate confirma)
  ('d8900000-0000-4000-8000-0000000000b1','b8900000-0000-4000-8000-000000000001','Pending 30m','0711000003',2,
     now() - interval '30 minutes', now() + interval '1 hour','pending'),
  -- NU: pending viitoare
  ('d8900000-0000-4000-8000-0000000000b2','b8900000-0000-4000-8000-000000000001','Pending viitor','0711000004',2,
     now() + interval '2 days', now() + interval '2 days' + interval '2 hours','pending'),
  -- NU: confirmed / seated / completed, toate în trecut
  ('d8900000-0000-4000-8000-0000000000b3','b8900000-0000-4000-8000-000000000001','Confirmed 3h','0711000005',2,
     now() - interval '3 hours', now() - interval '1 hour','confirmed'),
  ('d8900000-0000-4000-8000-0000000000b4','b8900000-0000-4000-8000-000000000001','Seated 3h','0711000006',2,
     now() - interval '3 hours', now() - interval '1 hour','seated'),
  ('d8900000-0000-4000-8000-0000000000b5','b8900000-0000-4000-8000-000000000001','Completed','0711000007',2,
     now() - interval '3 hours', now() - interval '1 hour','completed'),
  -- NU: confirmed vechi de 10 zile (decizia: rămâne — anti-backfill no-show 234)
  ('d8900000-0000-4000-8000-0000000000b6','b8900000-0000-4000-8000-000000000001','Confirmed vechi','0711000008',2,
     now() - interval '10 days', now() - interval '10 days' + interval '2 hours','confirmed');

do $$
declare v_n int; v_first int; v_bad text[]; v_upd_before timestamptz;
begin
  -- control pozitiv: fixtura chiar conține 2 candidați
  select count(*) into v_n from public.reservations
   where restaurant_id = 'b8900000-0000-4000-8000-000000000001'
     and status = 'pending' and starts_at < now() - interval '2 hours';
  if v_n <> 2 then raise exception 'RX2 FAIL (fixtura): % candidați, se așteptau 2', v_n; end if;

  -- drenează orice a lăsat replay-ul în alte restaurante: contează doar al nostru
  v_first := public.expire_stale_pending_reservations(2);
  if v_first < 2 then raise exception 'RX2 FAIL: janitorul a expirat % rânduri (așteptat >= 2)', v_first; end if;

  select array_agg(c.nm order by c.nm) into v_bad from (
    select 'A1:' || status as nm from public.reservations where id = 'd8900000-0000-4000-8000-0000000000a1' and status is distinct from 'expired'
    union all
    select 'A2:' || status from public.reservations where id = 'd8900000-0000-4000-8000-0000000000a2' and status is distinct from 'expired'
    union all
    select 'B1:' || status from public.reservations where id = 'd8900000-0000-4000-8000-0000000000b1' and status is distinct from 'pending'
    union all
    select 'B2:' || status from public.reservations where id = 'd8900000-0000-4000-8000-0000000000b2' and status is distinct from 'pending'
    union all
    select 'B3:' || status from public.reservations where id = 'd8900000-0000-4000-8000-0000000000b3' and status is distinct from 'confirmed'
    union all
    select 'B4:' || status from public.reservations where id = 'd8900000-0000-4000-8000-0000000000b4' and status is distinct from 'seated'
    union all
    select 'B5:' || status from public.reservations where id = 'd8900000-0000-4000-8000-0000000000b5' and status is distinct from 'completed'
    union all
    select 'B6:' || status from public.reservations where id = 'd8900000-0000-4000-8000-0000000000b6' and status is distinct from 'confirmed'
  ) c;
  if v_bad is not null then
    raise exception 'RX2 FAIL: stări greșite după janitor: %', v_bad; end if;

  -- RX3: a doua rulare = 0 și rândurile expirate nu se mai ating
  select updated_at into v_upd_before from public.reservations where id = 'd8900000-0000-4000-8000-0000000000a1';
  v_n := public.expire_stale_pending_reservations(2);
  if v_n <> 0 then raise exception 'RX3 FAIL: a doua rulare a atins % rânduri (auto-consumare ruptă)', v_n; end if;
  if (select updated_at from public.reservations where id = 'd8900000-0000-4000-8000-0000000000a1') is distinct from v_upd_before then
    raise exception 'RX3 FAIL: un rând deja expirat a fost rescris'; end if;
  -- grația nu coboară sub 1h: p_grace_hours = 0 / NULL nu expiră pending de 30 min
  perform public.expire_stale_pending_reservations(0);
  perform public.expire_stale_pending_reservations(null);
  if (select status from public.reservations where id = 'd8900000-0000-4000-8000-0000000000b1') <> 'pending' then
    raise exception 'RX2 FAIL: grația de minim 1h nu e respectată'; end if;
  raise notice 'RX2/RX3 OK: 2 expirate (inclusiv 116 zile), 6 neatinse, a doua rulare 0';
end $$;

-- ── RX4: `expired` eliberează masa ───────────────────────────────────────────
-- Slot comun în viitor: ((current_date + 60) 12:00 București).
-- T1 e ținută de un expired, T2 de un pending (control).
insert into public.reservations
  (id, restaurant_id, table_id, customer_name, customer_phone, party_size, starts_at, ends_at, status) values
  ('d8900000-0000-4000-8000-0000000000c1','b8900000-0000-4000-8000-000000000001','c8900000-0000-4000-8000-000000000001',
   'Ocupa T1 expirat','0722000001',2,
   ((current_date + 60)::timestamp + time '12:00') at time zone 'Europe/Bucharest',
   ((current_date + 60)::timestamp + time '13:30') at time zone 'Europe/Bucharest','expired'),
  ('d8900000-0000-4000-8000-0000000000c2','b8900000-0000-4000-8000-000000000001','c8900000-0000-4000-8000-000000000002',
   'Ocupa T2 pending','0722000002',2,
   ((current_date + 60)::timestamp + time '12:00') at time zone 'Europe/Bucharest',
   ((current_date + 60)::timestamp + time '13:30') at time zone 'Europe/Bucharest','pending');

do $$
declare
  v_s timestamptz := ((current_date + 60)::timestamp + time '12:00') at time zone 'Europe/Bucharest';
  v_e timestamptz := ((current_date + 60)::timestamp + time '13:30') at time zone 'Europe/Bucharest';
  v_r record; v_n int; v_av boolean;
begin
  -- CONTROL POZITIV: masa ținută de un pending rămâne blocată
  begin
    perform * from public.create_reservation_public(
      'rx-bistro-slug', 'Control T2', '0733000002', 2::smallint, v_s,
      null, null, null, null, 'c8900000-0000-4000-8000-000000000002'::uuid, null);
    raise exception 'RX4 FAIL (control): masa ținută de un pending a fost acceptată';
  exception when check_violation then null;
  end;

  -- expired NU blochează: aceeași alegere de masă pe T1 reușește
  select * into v_r from public.create_reservation_public(
    'rx-bistro-slug', 'Pe T1', '0733000001', 2::smallint, v_s,
    null, null, null, null, 'c8900000-0000-4000-8000-000000000001'::uuid, null);
  if v_r.table_name is distinct from 'RX-1' then
    raise exception 'RX4 FAIL: rezervarea pe T1 (ocupată doar de expired) n-a primit masa: %', v_r.table_name; end if;

  -- check_availability: T1 apare ca liberă (înainte de a o ocupa noua rezervare
  -- nu mai putem verifica — verificăm pe un slot diferit, ocupat tot doar de expired)
  insert into public.reservations
    (restaurant_id, table_id, customer_name, customer_phone, party_size, starts_at, ends_at, status)
  values ('b8900000-0000-4000-8000-000000000001','c8900000-0000-4000-8000-000000000001','Expirat slot2','0722000003',2,
          v_s + interval '3 days', v_e + interval '3 days','expired'),
         ('b8900000-0000-4000-8000-000000000001','c8900000-0000-4000-8000-000000000002','Pending slot2','0722000004',2,
          v_s + interval '3 days', v_e + interval '3 days','pending');
  select count(*) into v_n from public.check_availability(
    'b8900000-0000-4000-8000-000000000001', v_s + interval '3 days', v_e + interval '3 days', 2::smallint, null)
   where table_id = 'c8900000-0000-4000-8000-000000000001';
  if v_n <> 1 then raise exception 'RX4 FAIL: check_availability nu listează masa ținută doar de expired'; end if;
  select count(*) into v_n from public.check_availability(
    'b8900000-0000-4000-8000-000000000001', v_s + interval '3 days', v_e + interval '3 days', 2::smallint, null)
   where table_id = 'c8900000-0000-4000-8000-000000000002';
  if v_n <> 0 then raise exception 'RX4 FAIL (control): check_availability listează masa ținută de un pending'; end if;

  -- get_tables_availability (suprafața publică, anon)
  select is_available into v_av from public.get_tables_availability(
    'rx-bistro-slug', v_s + interval '3 days', v_e + interval '3 days', 2::smallint)
   where table_id = 'c8900000-0000-4000-8000-000000000001';
  if v_av is distinct from true then raise exception 'RX4 FAIL: get_tables_availability arată T1 ocupată de un expired'; end if;
  select is_available into v_av from public.get_tables_availability(
    'rx-bistro-slug', v_s + interval '3 days', v_e + interval '3 days', 2::smallint)
   where table_id = 'c8900000-0000-4000-8000-000000000002';
  if v_av is distinct from false then raise exception 'RX4 FAIL (control): get_tables_availability arată T2 liberă deși are un pending'; end if;

  -- EXCLUDE: inserare directă peste expired reușește; peste pending e respinsă
  insert into public.reservations
    (restaurant_id, table_id, customer_name, customer_phone, party_size, starts_at, ends_at, status)
  values ('b8900000-0000-4000-8000-000000000001','c8900000-0000-4000-8000-000000000001','Direct peste expired','0722000005',2,
          v_s + interval '3 days', v_e + interval '3 days','confirmed');
  begin
    insert into public.reservations
      (restaurant_id, table_id, customer_name, customer_phone, party_size, starts_at, ends_at, status)
    values ('b8900000-0000-4000-8000-000000000001','c8900000-0000-4000-8000-000000000002','Direct peste pending','0722000006',2,
            v_s + interval '3 days', v_e + interval '3 days','confirmed');
    raise exception 'RX4 FAIL (control): EXCLUDE a lăsat două rezervări active pe aceeași masă';
  exception when exclusion_violation then null;
  end;
  raise notice 'RX4 OK: expired eliberează masa (RPC, disponibilitate publică + staff, EXCLUDE); pending o ține';
end $$;

-- ── RX5: expired nu intră în numărătoarea de recidiviști ─────────────────────
insert into public.reservations
  (restaurant_id, customer_name, customer_phone, party_size, starts_at, ends_at, status) values
  ('b8900000-0000-4000-8000-000000000001','Doar expirate','0744123456',2,
     now() - interval '30 days', now() - interval '30 days' + interval '2 hours','expired'),
  ('b8900000-0000-4000-8000-000000000001','Doar expirate','+40 744 123 456',2,
     now() - interval '40 days', now() - interval '40 days' + interval '2 hours','expired'),
  ('b8900000-0000-4000-8000-000000000001','Un no-show','0755987654',2,
     now() - interval '20 days', now() - interval '20 days' + interval '2 hours','no_show');

do $$
declare v_exp bigint; v_ns bigint;
begin
  perform set_config('request.jwt.claim.sub', 'a8900000-0000-4000-8000-000000000001', true);
  select no_show_count into v_ns from public.get_reservation_no_show_counts('b8900000-0000-4000-8000-000000000001')
   where phone_key = right(regexp_replace('0755987654', '\D', '', 'g'), 9);
  if v_ns is distinct from 1 then
    raise exception 'RX5 FAIL (control): un no_show ar trebui să apară cu 1, apare cu %', v_ns; end if;
  select no_show_count into v_exp from public.get_reservation_no_show_counts('b8900000-0000-4000-8000-000000000001')
   where phone_key = right(regexp_replace('0744123456', '\D', '', 'g'), 9);
  if v_exp is not null then
    raise exception 'RX5 FAIL: două rezervări expired au fost numărate ca no-show (%)', v_exp; end if;
  raise notice 'RX5 OK: expired nu apare în recidiviști';
end $$;

-- ── RX6: no-show-ul automat nu atinge expired ────────────────────────────────
do $$
declare v_before text; v_after text;
begin
  select status into v_before from public.reservations where id = 'd8900000-0000-4000-8000-0000000000a1';
  perform public.auto_mark_reservation_no_show(120);
  select status into v_after from public.reservations where id = 'd8900000-0000-4000-8000-0000000000a1';
  if v_before is distinct from 'expired' or v_after is distinct from 'expired' then
    raise exception 'RX6 FAIL: expired a devenit % după auto_mark (era %)', v_after, v_before; end if;
  -- confirmed de 3h a devenit no_show (controlul pozitiv că funcția a rulat)
  if (select status from public.reservations where id = 'd8900000-0000-4000-8000-0000000000b3') <> 'no_show' then
    raise exception 'RX6 FAIL (control): auto_mark nu a rulat pe confirmed'; end if;
  raise notice 'RX6 OK: expired neatins de no-show-ul automat';
end $$;

-- ── RX7: clichet structural ──────────────────────────────────────────────────
do $$
declare v_sig text; v_def text; v_n int;
begin
  foreach v_sig in array array[
    'public.create_reservation_public(text,text,text,smallint,timestamptz,text,text,smallint,text,uuid,uuid)',
    'public.get_tables_availability(text,timestamptz,timestamptz,smallint)',
    'public.check_availability(uuid,timestamptz,timestamptz,smallint,text)'] loop
    v_def := pg_get_functiondef(v_sig::regprocedure);
    if v_def like '%not in (''cancelled'',''no_show'')%' then
      raise exception 'RX7 FAIL: % are încă predicatul VECHI (fără expired)', v_sig; end if;
    if v_def not like '%''cancelled'',''no_show'',''expired''%' then
      raise exception 'RX7 FAIL: % nu exclude expired', v_sig; end if;
  end loop;
  if pg_get_indexdef('public.idx_reservations_availability'::regclass) not like '%expired%' then
    raise exception 'RX7 FAIL: indexul de disponibilitate nu exclude expired'; end if;
  if not exists (select 1 from pg_constraint where conname = 'excl_reservations_no_overlap'
                  and conrelid = 'public.reservations'::regclass and contype = 'x'
                  and pg_get_constraintdef(oid) like '%expired%') then
    raise exception 'RX7 FAIL: EXCLUDE-ul nu exclude expired'; end if;
  if (select count(*) from pg_constraint where conrelid = 'public.reservations'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%no_show%'
        and pg_get_constraintdef(oid) like '%expired%') <> 1 then
    raise exception 'RX7 FAIL: trebuie exact un CHECK de status, cu expired'; end if;
  -- create_reservation_public: o SINGURĂ semnătură (anti PGRST203) și invarianții
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_reservation_public';
  if v_n <> 1 then raise exception 'RX7 FAIL: create_reservation_public are % semnături (PGRST203)', v_n; end if;
  v_def := pg_get_functiondef('public.create_reservation_public(text,text,text,smallint,timestamptz,text,text,smallint,text,uuid,uuid)'::regprocedure);
  if v_def not like '%is_module_enabled%'
     or v_def not like '%close_time <= v_settings.open_time%'
     or v_def not like '%- interval ''1 day''%'
     or v_def not like '%pg_advisory_xact_lock%'
     or v_def not like '%table_unavailable%'
     or v_def not like '%idempotency_key%'
     or v_def not like '%v_settings.reservation_duration%' then
    raise exception 'RX7 FAIL: create_reservation_public și-a pierdut un invariant (modul / wrap-around / zi de serviciu / lock / table_unavailable / idempotență / plafon durată)'; end if;
  if not has_function_privilege('anon', 'public.create_reservation_public(text,text,text,smallint,timestamptz,text,text,smallint,text,uuid,uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_tables_availability(text,timestamptz,timestamptz,smallint)', 'execute') then
    raise exception 'RX7 FAIL: suprafața publică de rezervare și-a pierdut grant-ul'; end if;
  raise notice 'RX7 OK: expired în 3 funcții + index + EXCLUDE + CHECK; invarianții 199/201/241/273 rămași';
end $$;

-- ── RX8: suprafața janitorului + manifest ────────────────────────────────────
do $$
declare v_sig text := 'public.expire_stale_pending_reservations(integer)'; v_p record;
begin
  if has_function_privilege('anon', v_sig, 'execute') or has_function_privilege('authenticated', v_sig, 'execute')
     or has_function_privilege('service_role', v_sig, 'execute') then
    raise exception 'RX8 FAIL: janitorul e apelabil din afara proprietarului'; end if;
  select prosecdef, proconfig into v_p from pg_proc where oid = v_sig::regprocedure;
  if not v_p.prosecdef or not exists (select 1 from unnest(v_p.proconfig) c where c like 'search_path=%pg_temp%') then
    raise exception 'RX8 FAIL: janitorul nu e DEFINER cu pg_temp'; end if;
  if not exists (select 1 from public.pg_cron_janitor_manifest
                  where job_name = 'menuvia_janitor_reservation_expire'
                    and signature = v_sig and schedule = '43 * * * *') then
    raise exception 'RX8 FAIL: jobul lipsește din manifest sau are alt orar'; end if;
  raise notice 'RX8 OK: janitor închis rolurilor client, în manifest (43 * * * *)';
end $$;

rollback;
