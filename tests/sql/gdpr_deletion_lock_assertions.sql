-- tests/sql/gdpr_deletion_lock_assertions.sql
-- =============================================================================
-- GD1–GD6 — clichetul PERMANENT al mig 282 (ștergerile GDPR pe pg_cron).
--
-- Ce păzește: `process_account_deletions` a stat în denylist-ul pg_cron (mig
-- 274) fiindcă `delete from auth.users` e IREVERSIBIL, iar bucla n-avea `order
-- by`, `for update`, `skip locked` sau lacăt. Mig 282 le-a adăugat; suita asta
-- verifică să nu dispară la o recreare viitoare, ȘI că invariantele vechi din
-- 179/183 au supraviețuit recreării.
--
-- ⚠️ CE NU ACOPERĂ SUITA, deliberat și explicit:
-- concurența REALĂ cere două sesiuni, iar suita rulează într-una singură.
-- `pg_try_advisory_xact_lock` e re-entrant pentru aceeași sesiune, deci un test
-- in-process ar reuși mereu să ia lacătul și ar fi VACUU — ar „trece" și dacă
-- lacătul n-ar face nimic. Proba de concurență e MANUALĂ, cu două sesiuni psql,
-- consemnată în antetul mig 282 (același precedent ca mig 273). Aici se verifică
-- PREZENȚA celor trei mecanisme + comportamentul observabil într-o sesiune.
--
--   GD1  ordinea e DETERMINISTĂ (cea mai veche cerere prima)
--   GD2  fereastra D+30 e respectată (control pozitiv + negativ)
--   GD3  cele TREI mecanisme de siguranță sunt în corp (clichet pe prosrc)
--   GD4  politica `block` nu șterge și nu raportează (invariant mig 179)
--   GD5  conturile marcate blocate sunt SĂRITE (invariant mig 179)
--   GD6  manifest ↔ denylist: e în unul și NU în celălalt
--
-- Rulează ca `postgres`, într-o tranzacție derulată la final.
-- =============================================================================
\set ON_ERROR_STOP on

begin;

-- ── Fixtură ────────────────────────────────────────────────────────────────
-- Trei conturi eligibile, cu vârste DIFERITE și create în ordine INVERSĂ față
-- de vârstă: dacă cineva scoate `order by`, ordinea returnată devine cea fizică
-- (de inserare) și GD1 pică. Fără ordinea inversă, testul ar fi trecut din
-- întâmplare.
insert into auth.users (id, email) values
  ('8a000000-0000-4000-8000-0000000000d1'::uuid, 'gd-nou@gd.test'),
  ('8a000000-0000-4000-8000-0000000000d2'::uuid, 'gd-mediu@gd.test'),
  ('8a000000-0000-4000-8000-0000000000d3'::uuid, 'gd-vechi@gd.test'),
  ('8a000000-0000-4000-8000-0000000000d4'::uuid, 'gd-recent@gd.test'),
  ('8a000000-0000-4000-8000-0000000000d5'::uuid, 'gd-blocat@gd.test');

update public.profiles set deletion_requested_at = now() - interval '35 days'
 where id = '8a000000-0000-4000-8000-0000000000d1'::uuid;
update public.profiles set deletion_requested_at = now() - interval '60 days'
 where id = '8a000000-0000-4000-8000-0000000000d2'::uuid;
update public.profiles set deletion_requested_at = now() - interval '90 days'
 where id = '8a000000-0000-4000-8000-0000000000d3'::uuid;
-- NEeligibil: sub fereastra de 30 de zile.
update public.profiles set deletion_requested_at = now() - interval '10 days'
 where id = '8a000000-0000-4000-8000-0000000000d4'::uuid;
-- Eligibil ca vârstă, dar marcat BLOCAT → trebuie sărit.
update public.profiles
   set deletion_requested_at = now() - interval '100 days',
       deletion_blocked_reason = 'test: are facturi fiscale'
 where id = '8a000000-0000-4000-8000-0000000000d5'::uuid;

-- ── GD1 + GD2 + GD5: o singură rulare, trei proprietăți ────────────────────
do $$
declare
  v_ids uuid[];
begin
  -- WITH ORDINALITY exprima direct contractul „ordinea EMISA de functie";
  -- un row_number() over () FARA order by in fereastra are numerotare
  -- NESPECIFICATA, deci asertia de ordine s-ar fi sprijinit pe nimic
  -- (recenzie CodeRabbit pe #269).
  select array_agg(t.deleted_user_id order by t.ord)
    into v_ids
    from public.process_account_deletions()
         with ordinality as t(deleted_user_id, deleted_at, ord);

  -- GD1: ordinea e cea a vechimii cererii, nu cea de inserare.
  if v_ids is null then
    raise exception 'GD1: functia n-a sters NIMIC — fixtura sau fereastra sunt gresite (control pozitiv esuat)';
  end if;
  if v_ids[1] is distinct from '8a000000-0000-4000-8000-0000000000d3'::uuid then
    raise exception 'GD1: primul sters ar trebui sa fie cel mai VECHI (gd03, 90 zile), e %. `order by deletion_requested_at` a disparut?', v_ids[1];
  end if;
  if v_ids[2] is distinct from '8a000000-0000-4000-8000-0000000000d2'::uuid then
    raise exception 'GD1: al doilea ar trebui gd02 (60 zile), e %', v_ids[2];
  end if;
  if v_ids[3] is distinct from '8a000000-0000-4000-8000-0000000000d1'::uuid then
    raise exception 'GD1: al treilea ar trebui gd01 (35 zile), e %', v_ids[3];
  end if;

  -- GD2: contul de 10 zile NU e atins (fereastra D+30).
  if '8a000000-0000-4000-8000-0000000000d4'::uuid = any(v_ids) then
    raise exception 'GD2: contul de 10 zile a fost sters — fereastra de 30 de zile a disparut';
  end if;
  if not exists (select 1 from auth.users where id = '8a000000-0000-4000-8000-0000000000d4'::uuid) then
    raise exception 'GD2: contul de 10 zile nu mai exista in auth.users';
  end if;

  -- GD5: contul BLOCAT e sarit, si ca raportare, si ca stergere.
  if '8a000000-0000-4000-8000-0000000000d5'::uuid = any(v_ids) then
    raise exception 'GD5: contul cu deletion_blocked_reason a fost raportat ca sters';
  end if;
  if not exists (select 1 from auth.users where id = '8a000000-0000-4000-8000-0000000000d5'::uuid) then
    raise exception 'GD5: contul BLOCAT a fost sters — filtrul `deletion_blocked_reason is null` (mig 179) a disparut';
  end if;

  -- Ștergerea chiar s-a produs (nu doar `return next`).
  if exists (select 1 from auth.users where id = '8a000000-0000-4000-8000-0000000000d3'::uuid) then
    raise exception 'GD1: gd03 a fost RAPORTAT ca sters dar exista inca in auth.users';
  end if;

  raise notice 'GD1 OK / GD2 OK / GD5 OK (sterse: %)', v_ids;
end $$;

-- ── GD3: cele TREI mecanisme de siguranță sunt în corp ─────────────────────
-- Clichet pe `prosrc`. E o verificare de PREZENȚĂ, nu de semantică — de asta
-- proba de concurență e manuală (vezi antetul). Dar fără ea, o recreare care
-- pierde unul dintre mecanisme ar repune funcția exact în starea pentru care
-- mig 274 o ținea afară din pg_cron, iar nimic n-ar pica.
do $$
declare v_src text; v_m text;
begin
  select p.prosrc into v_src
    from pg_proc p
   where p.oid = 'public.process_account_deletions()'::regprocedure;
  if v_src is null then
    raise exception 'GD3: process_account_deletions() nu exista';
  end if;

  foreach v_m in array array[
    'pg_try_advisory_xact_lock',          -- single-flight
    'order by deletion_requested_at, id', -- ordine determinista (anti-deadlock)
    'for update skip locked'              -- claim per rand
  ] loop
    if position(v_m in v_src) = 0 then
      raise exception 'GD3: „%" a disparut din corp — functia redevine ce era inainte de mig 282 (motivul denylist-ului 274)', v_m;
    end if;
  end loop;

  -- Invariantele MOȘTENITE: o recreare care pornește din 183 în loc de 282 le-ar
  -- păstra pe astea dar ar pierde cele trei de sus; una care pornește din altceva
  -- le-ar putea pierde pe toate.
  foreach v_m in array array[
    'archive_fiscal_invoices_for_user',   -- mig 179
    'deletion_blocked_reason is null',    -- mig 179
    'exception when others then',         -- mig 183
    'limit 100'
  ] loop
    if position(v_m in v_src) = 0 then
      raise exception 'GD3: invariantul mostenit „%" a disparut la recreare', v_m;
    end if;
  end loop;

  -- `safety_marker` din manifest TREBUIE să fie unul dintre mecanismele reale,
  -- nu un șir oarecare care se întâmplă să existe în corp. CJ5 verifică doar că
  -- se regăsește; aici verific că e CHIAR mecanismul.
  if not exists (
    select 1 from public.pg_cron_janitor_manifest
     where job_name = 'menuvia_janitor_gdpr_deletions'
       and safety_marker in ('for update skip locked', 'pg_try_advisory_xact_lock')
  ) then
    raise exception 'GD3: safety_marker-ul jobului GDPR nu e unul dintre mecanismele de siguranta reale';
  end if;

  raise notice 'GD3 OK';
end $$;

-- ── GD4: politica `block` marchează, nu șterge ─────────────────────────────
-- Invariant mig 179. Fixtură proprie: cont eligibil CU factură fiscală emisă,
-- sub politica `block`.
do $$
declare
  v_uid uuid := '8a000000-0000-4000-8000-0000000000d6'::uuid;
  v_rid uuid;
  v_n   int;
begin
  insert into auth.users (id, email) values (v_uid, 'gd-block@gd.test');
  -- `enterprise`: `invoices` are gate fiscal (enforce_invoice_fiscal_gate cere
  -- feature-ul `fiscal_receipt` = Plan 3), iar `free` ar pica si pe limita de
  -- restaurante din mig 131. Comanda de mai jos e `served`, NU `closed`/`paid`,
  -- deci gate-urile de inchidere (124/264) nu se ating — capcana din suita GR,
  -- unde `enterprise` ar fi respins inserarea comenzilor `closed`.
  update public.profiles
     set plan = 'enterprise', deletion_requested_at = now() - interval '45 days'
   where id = v_uid;

  insert into public.restaurants (id, owner_id, name, slug, city, is_active)
  values ('8a100000-0000-4000-8000-0000000000d6'::uuid, v_uid,
          'GD Block Test', 'gd-block-test', 'Cluj', true)
  returning id into v_rid;

  -- `invoices` cere order_id NOT NULL (FK on delete restrict) + customer_name +
  -- total_with_vat, iar mig 278 impune comanda din ACELASI restaurant.
  insert into public.orders (id, restaurant_id, source, status, total)
  values ('8a200000-0000-4000-8000-0000000000d6'::uuid, v_rid, 'waiter', 'served', 100.00);

  insert into public.invoices
    (restaurant_id, order_id, customer_name, total_with_vat, status, issued_at)
  values (v_rid, '8a200000-0000-4000-8000-0000000000d6'::uuid,
          'Client GD Block', 100.00, 'issued', now());

  insert into public.gdpr_deletion_config (id, policy) values (true, 'block')
  on conflict (id) do update set policy = 'block';

  select count(*) into v_n
    from public.process_account_deletions()
   where deleted_user_id = v_uid;

  if v_n <> 0 then
    raise exception 'GD4: contul cu factura fiscala a fost RAPORTAT ca sters sub politica `block`';
  end if;
  if not exists (select 1 from auth.users where id = v_uid) then
    raise exception 'GD4: contul cu factura fiscala a fost STERS sub politica `block` — Legea 82/1991';
  end if;
  if (select deletion_blocked_reason from public.profiles where id = v_uid) is null then
    raise exception 'GD4: contul n-a primit deletion_blocked_reason, deci va fi reincercat la infinit';
  end if;

  raise notice 'GD4 OK';
end $$;

-- ── GD6: manifest ↔ denylist, coerente ─────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from public.pg_cron_janitor_manifest
     where job_name = 'menuvia_janitor_gdpr_deletions'
       and signature = 'public.process_account_deletions()'
       and schedule  = '37 3 * * *'
       and max_age_s = 172800
  ) then
    raise exception 'GD6: jobul GDPR lipseste din manifest sau si-a schimbat forma';
  end if;

  if exists (
    select 1 from public.pg_cron_janitor_denylist()
     where fn_name = 'process_account_deletions'
  ) then
    raise exception 'GD6: functia e SI in manifest SI in denylist — contradictie (CJ4 ar trebui sa pice si ea)';
  end if;

  raise notice 'GD6 OK';
end $$;

rollback;
