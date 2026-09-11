-- tests/sql/reservation_idempotency_assertions.sql
-- =============================================================================
-- Aserții permanente pentru mig 273 — audit v3 RES-29: rezervarea publică e
-- IDEMPOTENTĂ pe (restaurant, cheie).
--
--   RI1  aceeași cheie de două ori → O SINGURĂ rezervare, iar al doilea apel
--        întoarce EXACT rândul creat de primul (id, cod, status, masă).
--        [PICĂ pe codul vechi: a doua chemare creează a doua rezervare]
--   RI2  chei DIFERITE → rezervări diferite (idempotența nu colapsează
--        rezervări legitime distincte).
--   RI3  cheie NULL de două ori → două rezervări (compatibilitate: clientul
--        vechi, care nu trimite cheie, se comportă exact ca înainte).
--   RI4  retrimiterile NU consumă plafonul anti-abuz: 5 reluări cu aceeași
--        cheie și același telefon trec fără eroare și lasă o singură rezervare.
--        [PICĂ pe codul vechi: a treia inserare de la același număr lovește
--         plafonul de 3/5min și aruncă]
--   RI5  retrimiterea NU re-pune emailul către local în coadă (un singur rând
--        în email_queue pentru rezervarea respectivă).
--   RI6  retrimiterea reușește chiar dacă validările de setări ar respinge ACUM
--        o rezervare nouă (plafonul de avans s-a strâns între timp) — asta e
--        motivul pentru care lookup-ul stă înaintea validărilor.
--   RI7  cheia e SCOPATĂ pe restaurant: aceeași cheie la alt local creează o
--        rezervare proprie (altfel un client ar „fura" rezervarea altuia).
--   RI8  clichete structurale: exact O semnătură (PGRST203), index UNIC PARȚIAL
--        pe (restaurant_id, idempotency_key), suprafață anon+authenticated.
--
-- Plafoanele reale (mig 115/129): 5 rezervări publice/minut per restaurant și
-- 3/5 minute per telefon normalizat. De aceea inserările legitime de mai jos
-- folosesc telefoane DIFERITE și rămân sub praguri; retrimiterile (care NU
-- inserează) refolosesc deliberat același telefon, ca RI4 să aibă sens.
--
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a7300000-0000-4000-8000-000000000001','ri-owner@ri.test'),
  ('a7300000-0000-4000-8000-000000000002','ri-owner2@ri.test');
update public.profiles set plan = 'enterprise'
 where id in ('a7300000-0000-4000-8000-000000000001','a7300000-0000-4000-8000-000000000002');

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('b7300000-0000-4000-8000-000000000001','a7300000-0000-4000-8000-000000000001',
   'RI Bistro','ri-bistro-slug','Cluj',true),
  ('b7300000-0000-4000-8000-000000000002','a7300000-0000-4000-8000-000000000002',
   'RI Altul','ri-altul-slug','Cluj',true);

insert into public.restaurant_modules (restaurant_id, module_key, enabled) values
  ('b7300000-0000-4000-8000-000000000001','reservations',true),
  ('b7300000-0000-4000-8000-000000000002','reservations',true)
on conflict (restaurant_id, module_key) do update set enabled = true;

-- Program permisiv: orice zi, toată ziua, fără plafon de avans.
insert into public.reservation_settings
  (restaurant_id, open_days, open_time, close_time, min_advance_hours, max_advance_days, auto_confirm)
values
  ('b7300000-0000-4000-8000-000000000001','{1,2,3,4,5,6,7}','00:00','23:59',0,3650,true),
  ('b7300000-0000-4000-8000-000000000002','{1,2,3,4,5,6,7}','00:00','23:59',0,3650,true)
on conflict (restaurant_id) do update
  set open_days = '{1,2,3,4,5,6,7}', open_time = '00:00', close_time = '23:59',
      min_advance_hours = 0, max_advance_days = 3650, auto_confirm = true;

insert into public.tables (id, restaurant_id, name, slug, seats, is_active) values
  ('c7300000-0000-4000-8000-000000000001','b7300000-0000-4000-8000-000000000001','RI-1','ri-1',4,true),
  ('c7300000-0000-4000-8000-000000000002','b7300000-0000-4000-8000-000000000001','RI-2','ri-2',4,true),
  ('c7300000-0000-4000-8000-000000000003','b7300000-0000-4000-8000-000000000002','RI-A1','ri-a1',4,true);

-- ── RI1: aceeași cheie de două ori → o singură rezervare, același rând ───────
do $$
declare
  v1 record; v2 record; v_n int;
begin
  select * into v1 from public.create_reservation_public(
    'ri-bistro-slug', 'Ana Idem', '0722000001', 2::smallint,
    (timestamp '2027-06-01 12:00') at time zone 'Europe/Bucharest',
    null, null, null, null, null,
    '7e300000-0000-4000-8000-0000000000a1'::uuid);

  select * into v2 from public.create_reservation_public(
    'ri-bistro-slug', 'Ana Idem', '0722000001', 2::smallint,
    (timestamp '2027-06-01 12:00') at time zone 'Europe/Bucharest',
    null, null, null, null, null,
    '7e300000-0000-4000-8000-0000000000a1'::uuid);

  select count(*) into v_n from public.reservations
   where restaurant_id = 'b7300000-0000-4000-8000-000000000001';
  if v_n <> 1 then
    raise exception 'RI1 FAIL: % rezervări după două apeluri cu ACEEAȘI cheie (așteptat 1)', v_n; end if;
  if v2.reservation_id is distinct from v1.reservation_id then
    raise exception 'RI1 FAIL: al doilea apel a întors alt id (% vs %)', v2.reservation_id, v1.reservation_id; end if;
  if v2.confirmation_code is distinct from v1.confirmation_code
     or v2.status is distinct from v1.status
     or v2.table_name is distinct from v1.table_name
     or v2.starts_at is distinct from v1.starts_at
     or v2.ends_at is distinct from v1.ends_at then
    raise exception 'RI1 FAIL: retrimiterea a întors alt rând decât cel creat (cod %/%, status %/%, masă %/%)',
      v2.confirmation_code, v1.confirmation_code, v2.status, v1.status, v2.table_name, v1.table_name; end if;
  raise notice 'RI1 OK: retrimiterea întoarce rezervarea existentă (%), fără să creeze alta', v1.confirmation_code;
end $$;

-- ── RI2: chei diferite → rezervări diferite ─────────────────────────────────
do $$
declare v_id uuid; v_n int;
begin
  select reservation_id into v_id from public.create_reservation_public(
    'ri-bistro-slug', 'Bogdan Alt', '0722000002', 2::smallint,
    (timestamp '2027-06-01 14:00') at time zone 'Europe/Bucharest',
    null, null, null, null, null,
    '7e300000-0000-4000-8000-0000000000a2'::uuid);
  select count(*) into v_n from public.reservations
   where restaurant_id = 'b7300000-0000-4000-8000-000000000001';
  if v_n <> 2 then
    raise exception 'RI2 FAIL: cheie DIFERITĂ nu a creat o rezervare nouă (% rânduri, așteptat 2)', v_n; end if;
  raise notice 'RI2 OK: cheie diferită → rezervare nouă';
end $$;

-- ── RI3: fără cheie (client vechi) → comportamentul de dinainte ─────────────
do $$
declare v_n int;
begin
  perform public.create_reservation_public(
    'ri-bistro-slug', 'Cezar Fara', '0722000003', 2::smallint,
    (timestamp '2027-06-01 16:00') at time zone 'Europe/Bucharest');
  perform public.create_reservation_public(
    'ri-bistro-slug', 'Cezar Fara', '0722000004', 2::smallint,
    (timestamp '2027-06-01 18:00') at time zone 'Europe/Bucharest');
  select count(*) into v_n from public.reservations
   where restaurant_id = 'b7300000-0000-4000-8000-000000000001';
  if v_n <> 4 then
    raise exception 'RI3 FAIL: apelurile FĂRĂ cheie au fost deduplicate (% rânduri, așteptat 4) — clientul vechi s-ar rupe', v_n; end if;
  raise notice 'RI3 OK: fără cheie = comportamentul clasic (NULL nu se deduplică)';
end $$;

-- ── RI4: retrimiterile NU consumă plafonul anti-abuz ────────────────────────
do $$
declare v_n int; v_i int;
begin
  -- Același telefon ca la RI1. Plafonul e 3 rezervări/5 min de la un număr:
  -- pe codul vechi, a treia inserare ar arunca. Aici nu se inserează nimic.
  for v_i in 1..5 loop
    perform public.create_reservation_public(
      'ri-bistro-slug', 'Ana Idem', '0722000001', 2::smallint,
      (timestamp '2027-06-01 12:00') at time zone 'Europe/Bucharest',
      null, null, null, null, null,
      '7e300000-0000-4000-8000-0000000000a1'::uuid);
  end loop;
  select count(*) into v_n from public.reservations
   where restaurant_id = 'b7300000-0000-4000-8000-000000000001';
  if v_n <> 4 then
    raise exception 'RI4 FAIL: 5 retrimiteri au schimbat numărul de rezervări (% , așteptat 4)', v_n; end if;
  raise notice 'RI4 OK: 5 retrimiteri, zero inserări, plafonul anti-abuz neatins';
end $$;

-- ── RI5: retrimiterea nu re-pune emailul către local în coadă ───────────────
do $$
declare v_id uuid; v_n int;
begin
  select id into v_id from public.reservations
   where restaurant_id = 'b7300000-0000-4000-8000-000000000001'
     and idempotency_key = '7e300000-0000-4000-8000-0000000000a1';
  select count(*) into v_n from public.email_queue
   where dedup_key = 'resv_created:' || v_id::text;
  if v_n > 1 then
    raise exception 'RI5 FAIL: % emailuri în coadă pentru aceeași rezervare — retrimiterea a re-notificat localul', v_n; end if;
  raise notice 'RI5 OK: un singur email de rezervare nouă în coadă (% rând)', v_n;
end $$;

-- ── RI6: retrimiterea trece chiar dacă validările ar respinge ACUM ──────────
do $$
declare v_id uuid; v_ok boolean := false;
begin
  -- Plafonul de avans se strânge la 30000 de ore (~3,4 ani, sub plafonul smallint):
  -- o rezervare NOUĂ pe slotul din 2027 ar fi acum respinsă.
  update public.reservation_settings set min_advance_hours = 30000
   where restaurant_id = 'b7300000-0000-4000-8000-000000000001';

  begin
    perform public.create_reservation_public(
      'ri-bistro-slug', 'Dan Nou', '0722000005', 2::smallint,
      (timestamp '2027-06-01 20:00') at time zone 'Europe/Bucharest',
      null, null, null, null, null,
      '7e300000-0000-4000-8000-0000000000a9'::uuid);
  exception when others then
    v_ok := true;  -- control pozitiv: o rezervare NOUĂ chiar e respinsă acum
  end;
  if not v_ok then
    raise exception 'RI6 FAIL (control pozitiv): o rezervare nouă a trecut deși plafonul de avans o interzice — testul ar fi vacuu'; end if;

  -- Retrimiterea cheii existente TREBUIE să întoarcă rândul, nu o eroare.
  -- Prinsă explicit: fără lookup-ul de dinaintea validărilor, aici iese
  -- „Rezervările se fac cu minim N ore înainte", iar mesajul brut n-ar spune
  -- ce anume s-a rupt.
  begin
    select reservation_id into v_id from public.create_reservation_public(
      'ri-bistro-slug', 'Ana Idem', '0722000001', 2::smallint,
      (timestamp '2027-06-01 12:00') at time zone 'Europe/Bucharest',
      null, null, null, null, null,
      '7e300000-0000-4000-8000-0000000000a1'::uuid);
  exception when others then
    raise exception 'RI6 FAIL: retrimiterea unei chei EXISTENTE a fost respinsă de validările de setări („%") — lookup-ul de idempotență nu mai stă înaintea lor', sqlerrm;
  end;
  if v_id is null then
    raise exception 'RI6 FAIL: retrimiterea nu a întors rezervarea existentă'; end if;

  update public.reservation_settings set min_advance_hours = 0
   where restaurant_id = 'b7300000-0000-4000-8000-000000000001';
  raise notice 'RI6 OK: retrimiterea trece peste validările care s-au strâns între timp';
end $$;

-- ── RI7: cheia e scopată pe restaurant ──────────────────────────────────────
do $$
declare v_id uuid; v_other uuid; v_n int;
begin
  select id into v_other from public.reservations
   where restaurant_id = 'b7300000-0000-4000-8000-000000000001'
     and idempotency_key = '7e300000-0000-4000-8000-0000000000a1';

  select reservation_id into v_id from public.create_reservation_public(
    'ri-altul-slug', 'Elena Alt Local', '0722000006', 2::smallint,
    (timestamp '2027-06-01 12:00') at time zone 'Europe/Bucharest',
    null, null, null, null, null,
    '7e300000-0000-4000-8000-0000000000a1'::uuid);

  if v_id is null or v_id = v_other then
    raise exception 'RI7 FAIL: aceeași cheie la ALT restaurant a întors rezervarea primului local (%)', v_id; end if;
  select count(*) into v_n from public.reservations
   where restaurant_id = 'b7300000-0000-4000-8000-000000000002';
  if v_n <> 1 then
    raise exception 'RI7 FAIL: al doilea restaurant are % rezervări (așteptat 1)', v_n; end if;
  raise notice 'RI7 OK: cheia e scopată pe restaurant';
end $$;

-- ── RI8: clichete structurale ───────────────────────────────────────────────
do $$
declare v_n int; v_idx text; v_src text;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_reservation_public';
  if v_n <> 1 then
    raise exception 'RI8 FAIL: % semnături pentru create_reservation_public — PostgREST ar da PGRST203', v_n; end if;

  select pg_get_indexdef(i.indexrelid) into v_idx
    from pg_index i
   where i.indrelid = 'public.reservations'::regclass
     and i.indexrelid = 'public.reservations_restaurant_idempotency_key_uidx'::regclass;
  if v_idx is null then
    raise exception 'RI8 FAIL: indexul de idempotență lipsește — garanția ar depinde doar de cod'; end if;
  if position('UNIQUE' in upper(v_idx)) = 0 then
    raise exception 'RI8 FAIL: indexul nu e UNIC: %', v_idx; end if;
  if position('WHERE' in upper(v_idx)) = 0 then
    raise exception 'RI8 FAIL: indexul nu e parțial: %', v_idx; end if;
  if position('restaurant_id' in v_idx) = 0 then
    raise exception 'RI8 FAIL: indexul nu e scopat pe restaurant: %', v_idx; end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_reservation_public';
  if position('unique_violation' in v_src) = 0 then
    raise exception 'RI8 FAIL: backstop-ul de cursă (unique_violation) a dispărut'; end if;
  if position('raise;' in v_src) = 0 then
    raise exception 'RI8 FAIL: handler-ul nu mai RE-ARUNCĂ violările străine — o coliziune de confirmation_code ar trece drept succes'; end if;

  if not has_function_privilege('anon', 'public.create_reservation_public(text, text, text, smallint, timestamptz, text, text, smallint, text, uuid, uuid)', 'EXECUTE') then
    raise exception 'RI8 FAIL: anon nu mai poate chema RPC-ul'; end if;
  if not has_function_privilege('authenticated', 'public.create_reservation_public(text, text, text, smallint, timestamptz, text, text, smallint, text, uuid, uuid)', 'EXECUTE') then
    raise exception 'RI8 FAIL: authenticated nu mai poate chema RPC-ul'; end if;
  raise notice 'RI8 OK: o semnătură, index unic parțial scopat, backstop cu re-aruncare, suprafață anon+authenticated';
end $$;

select 'RESERVATION IDEMPOTENCY ASSERTIONS: RI1–RI8 PASS' as result;

rollback;
