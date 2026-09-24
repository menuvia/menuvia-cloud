-- tests/sql/gdpr_receipt_archive_assertions.sql
-- =============================================================================
-- RA1–RA5 — clichetul PERMANENT al mig 284: ștergerea GDPR a unui owner nu mai
-- distruge jurnalul de bonuri fiscale.
--
-- Ce păzește: `delete from auth.users` cascadează profiles → restaurants →
-- orders → pending_receipts, iar mig 179 arhiva DOAR `invoices`. Pe producție
-- politica activă e `archive_anonymize` — ramura care NU blochează — deci
-- arhivarea trebuie să ruleze pe ORICE politică, ÎNAINTEA ștergerii.
--
--   RA1  archive_anonymize: contul se șterge, TOT jurnalul (success / error cu
--        marcaj / raport Z fără comandă) ajunge în retained_receipts, cu
--        bon_number și statusurile intacte; originalele au plecat în cascadă
--   RA2  block: un bon `success` (fără nicio factură) BLOCHEAZĂ ștergerea
--   RA3  block, control pozitiv: un owner cu bon DOAR `error` se șterge —
--        blocajul e pe bon TIPĂRIT, nu pe orice rând din coadă
--   RA4  arhivarea e idempotentă (a doua rulare nu dublează)
--   RA5  structură + suprafață: arhivarea e ÎNAINTEA ștergerii în corp;
--        siguranțele din 282 au rămas; tabela și funcția sunt închise
--
-- Rulează ca `postgres`, într-o tranzacție derulată la final.
-- =============================================================================
\set ON_ERROR_STOP on

begin;

-- ── Fixtură comună ─────────────────────────────────────────────────────────
-- `enterprise`: pending_receipts are gate fiscal (mig 133, feature
-- `fiscal_receipt` = Plan 3). Comenzile sunt `served`, NU `closed`/`paid`,
-- deci gate-urile de închidere (124/264) nu se ating (tiparul GD4).
-- Trei owneri: RA1 (archive_anonymize), RA2 (block, bon success), RA3 (block,
-- doar bon error).
insert into auth.users (id, email) values
  ('8b000000-0000-4000-8000-0000000000a1'::uuid, 'ra1@ra.test'),
  ('8b000000-0000-4000-8000-0000000000a2'::uuid, 'ra2@ra.test'),
  ('8b000000-0000-4000-8000-0000000000a3'::uuid, 'ra3@ra.test');

-- Doar RA1 e eligibil de la început: `process_account_deletions` procesează
-- TOȚI owner-ii eligibili, deci RA2/RA3 devin eligibili abia înaintea rulării
-- lor sub `block` — altfel rularea RA1 i-ar șterge și pe ei (capcană prinsă la
-- prima rulare a suitei).
update public.profiles set plan = 'enterprise'
 where id in ('8b000000-0000-4000-8000-0000000000a1'::uuid,
              '8b000000-0000-4000-8000-0000000000a2'::uuid,
              '8b000000-0000-4000-8000-0000000000a3'::uuid);
update public.profiles set deletion_requested_at = now() - interval '45 days'
 where id = '8b000000-0000-4000-8000-0000000000a1'::uuid;

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('8b100000-0000-4000-8000-0000000000a1'::uuid, '8b000000-0000-4000-8000-0000000000a1'::uuid, 'RA1', 'ra1-test', 'Cluj', true),
  ('8b100000-0000-4000-8000-0000000000a2'::uuid, '8b000000-0000-4000-8000-0000000000a2'::uuid, 'RA2', 'ra2-test', 'Cluj', true),
  ('8b100000-0000-4000-8000-0000000000a3'::uuid, '8b000000-0000-4000-8000-0000000000a3'::uuid, 'RA3', 'ra3-test', 'Cluj', true);

insert into public.orders (id, restaurant_id, source, status, total) values
  ('8b200000-0000-4000-8000-0000000000a1'::uuid, '8b100000-0000-4000-8000-0000000000a1'::uuid, 'waiter', 'served', 50.00),
  ('8b200000-0000-4000-8000-0000000000a2'::uuid, '8b100000-0000-4000-8000-0000000000a2'::uuid, 'waiter', 'served', 60.00),
  ('8b200000-0000-4000-8000-0000000000a3'::uuid, '8b100000-0000-4000-8000-0000000000a3'::uuid, 'waiter', 'served', 70.00);

-- RA1: trei rânduri care contrazic fiecare filtru posibil — un bon TIPĂRIT,
-- un eșec AMBIGUU (poate tipărit, mig 270) și un raport Z FĂRĂ comandă (mig 032).
insert into public.pending_receipts
  (id, restaurant_id, order_id, command_type, payload, status, bon_number, error_info, total_snapshot, claimed_at, completed_at)
values
  ('8b300000-0000-4000-8000-0000000000a1'::uuid, '8b100000-0000-4000-8000-0000000000a1'::uuid,
   '8b200000-0000-4000-8000-0000000000a1'::uuid, 'order', 'S^Ciorba^25.00^2^buc^1^1', 'success', 'RA-101', null, 50.00,
   now() - interval '50 days', now() - interval '50 days'),
  ('8b300000-0000-4000-8000-0000000000a2'::uuid, '8b100000-0000-4000-8000-0000000000a1'::uuid,
   '8b200000-0000-4000-8000-0000000000a1'::uuid, 'order', 'S^Ciorba^25.00^2^buc^1^1', 'error', null,
   'POSIBIL DUPLICAT — verifica banda casei', 50.00, now() - interval '49 days', now() - interval '49 days'),
  ('8b300000-0000-4000-8000-0000000000a3'::uuid, '8b100000-0000-4000-8000-0000000000a1'::uuid,
   null, 'report_z', 'Z^', 'success', 'Z-7', null, 0.00, now() - interval '48 days', now() - interval '48 days');

-- RA2: un bon tipărit, NICIO factură.
insert into public.pending_receipts
  (id, restaurant_id, order_id, command_type, payload, status, bon_number, total_snapshot, claimed_at, completed_at)
values
  ('8b300000-0000-4000-8000-0000000000b2'::uuid, '8b100000-0000-4000-8000-0000000000a2'::uuid,
   '8b200000-0000-4000-8000-0000000000a2'::uuid, 'order', 'S^Pizza^60.00^1^buc^1^1', 'success', 'RA-202', 60.00,
   now() - interval '50 days', now() - interval '50 days');

-- RA3: doar un eșec CLAR (nimic tipărit).
insert into public.pending_receipts
  (id, restaurant_id, order_id, command_type, payload, status, error_code, error_info, total_snapshot, completed_at)
values
  ('8b300000-0000-4000-8000-0000000000c3'::uuid, '8b100000-0000-4000-8000-0000000000a3'::uuid,
   '8b200000-0000-4000-8000-0000000000a3'::uuid, 'order', 'S^Paste^70.00^1^buc^1^1', 'error', 'ECONNREFUSED',
   'casa oprita', 70.00, now() - interval '50 days');

-- ── RA4: idempotență (înainte de orice ștergere, pe owner-ul RA1 viu) ───────
do $$
declare v_first int; v_second int; v_rows int;
begin
  v_first  := public.archive_fiscal_receipts_for_user('8b000000-0000-4000-8000-0000000000a1'::uuid);
  v_second := public.archive_fiscal_receipts_for_user('8b000000-0000-4000-8000-0000000000a1'::uuid);
  select count(*) into v_rows from public.retained_receipts
   where original_restaurant_id = '8b100000-0000-4000-8000-0000000000a1'::uuid;

  if v_first is distinct from 3 then
    raise exception 'RA4: prima arhivare trebuia sa copieze 3 randuri (success + error + Z), a copiat %', v_first;
  end if;
  if v_second is distinct from 0 or v_rows is distinct from 3 then
    raise exception 'RA4: a doua arhivare nu e idempotenta (a doua=%, randuri=%)', v_second, v_rows;
  end if;
  -- Curățăm ca RA1 să dovedească arhivarea făcută de process_account_deletions,
  -- nu pe cea de aici.
  delete from public.retained_receipts
   where original_restaurant_id = '8b100000-0000-4000-8000-0000000000a1'::uuid;
  raise notice 'RA4 OK';
end $$;

-- ── RA1: archive_anonymize (politica activă pe producție) ──────────────────
do $$
declare
  v_uid uuid := '8b000000-0000-4000-8000-0000000000a1'::uuid;
  v_rid uuid := '8b100000-0000-4000-8000-0000000000a1'::uuid;
  v_n int;
begin
  insert into public.gdpr_deletion_config (id, policy) values (true, 'archive_anonymize')
  on conflict (id) do update set policy = 'archive_anonymize';

  select count(*) into v_n from public.process_account_deletions() where deleted_user_id = v_uid;
  if v_n is distinct from 1 or exists (select 1 from auth.users where id = v_uid) then
    raise exception 'RA1: contul RA1 nu a fost sters (control pozitiv esuat — fixtura e gresita, nu gate-ul)';
  end if;

  if exists (select 1 from public.pending_receipts where restaurant_id = v_rid) then
    raise exception 'RA1: originalele din pending_receipts n-au plecat in cascada — fixtura nu exerseaza problema';
  end if;

  select count(*) into v_n from public.retained_receipts where original_restaurant_id = v_rid;
  if v_n is distinct from 3 then
    raise exception 'RA1: jurnalul de bonuri NU a fost arhivat inaintea cascadei (% randuri in retained_receipts, asteptate 3)', v_n;
  end if;
  if not exists (select 1 from public.retained_receipts
                  where original_receipt_id = '8b300000-0000-4000-8000-0000000000a1'::uuid
                    and status = 'success' and bon_number = 'RA-101'
                    and original_order_id = '8b200000-0000-4000-8000-0000000000a1'::uuid) then
    raise exception 'RA1: bonul tiparit RA-101 lipseste sau si-a pierdut legatura cu comanda';
  end if;
  if not exists (select 1 from public.retained_receipts
                  where original_receipt_id = '8b300000-0000-4000-8000-0000000000a2'::uuid
                    and status = 'error' and error_info like 'POSIBIL DUPLICAT%') then
    raise exception 'RA1: esecul AMBIGUU (marcaj POSIBIL DUPLICAT) nu a fost pastrat';
  end if;
  if not exists (select 1 from public.retained_receipts
                  where original_receipt_id = '8b300000-0000-4000-8000-0000000000a3'::uuid
                    and command_type = 'report_z' and original_order_id is null) then
    raise exception 'RA1: raportul Z (fara comanda) nu a fost pastrat';
  end if;

  raise notice 'RA1 OK';
end $$;

-- ── RA2 + RA3: politica `block`, o singură rulare ──────────────────────────
do $$
declare
  v_ids uuid[];
begin
  insert into public.gdpr_deletion_config (id, policy) values (true, 'block')
  on conflict (id) do update set policy = 'block';

  update public.profiles set deletion_requested_at = now() - interval '45 days'
   where id in ('8b000000-0000-4000-8000-0000000000a2'::uuid,
                '8b000000-0000-4000-8000-0000000000a3'::uuid);

  select coalesce(array_agg(deleted_user_id), '{}') into v_ids
    from public.process_account_deletions();

  -- RA2: bon tipărit, fără factură → BLOCAT.
  if '8b000000-0000-4000-8000-0000000000a2'::uuid = any(v_ids)
     or not exists (select 1 from auth.users where id = '8b000000-0000-4000-8000-0000000000a2'::uuid) then
    raise exception 'RA2: contul cu bon fiscal TIPARIT a fost sters sub politica `block` (Legea 82/1991)';
  end if;
  if (select deletion_blocked_reason from public.profiles
       where id = '8b000000-0000-4000-8000-0000000000a2'::uuid) is null then
    raise exception 'RA2: contul blocat n-a primit deletion_blocked_reason — ar fi reincercat la infinit';
  end if;
  if not exists (select 1 from public.pending_receipts
                  where id = '8b300000-0000-4000-8000-0000000000b2'::uuid) then
    raise exception 'RA2: bonul contului blocat a disparut';
  end if;
  raise notice 'RA2 OK';

  -- RA3: doar eșec clar → se ȘTERGE (blocajul e pe bon tipărit, nu pe orice rând).
  if not ('8b000000-0000-4000-8000-0000000000a3'::uuid = any(v_ids))
     or exists (select 1 from auth.users where id = '8b000000-0000-4000-8000-0000000000a3'::uuid) then
    raise exception 'RA3: contul fara niciun bon tiparit a fost blocat — `block` s-ar extinde la orice rand din coada';
  end if;
  if not exists (select 1 from public.retained_receipts
                  where original_receipt_id = '8b300000-0000-4000-8000-0000000000c3'::uuid) then
    raise exception 'RA3: jurnalul contului sters sub `block` nu a fost arhivat';
  end if;
  raise notice 'RA3 OK';
end $$;

-- ── RA5: structură + suprafață ─────────────────────────────────────────────
do $$
declare v_src text; v_arch int; v_del int;
begin
  select p.prosrc into v_src from pg_proc p
   where p.oid = 'public.process_account_deletions()'::regprocedure;

  v_arch := position('v_archived_receipts := public.archive_fiscal_receipts_for_user(v_user.id)' in v_src);
  v_del  := position('delete from auth.users where id = v_user.id' in v_src);
  if v_arch = 0 or v_del = 0 or v_arch > v_del then
    raise exception 'RA5: arhivarea bonurilor lipseste sau e DUPA stergere (arch=%, del=%)', v_arch, v_del;
  end if;
  if position('pg_try_advisory_xact_lock' in v_src) = 0
     or position('order by deletion_requested_at, id' in v_src) = 0
     or position('for update skip locked' in v_src) = 0
     or position('archive_fiscal_invoices_for_user' in v_src) = 0 then
    raise exception 'RA5: o recreare a pierdut o siguranta din 179/282';
  end if;

  if has_table_privilege('anon', 'public.retained_receipts', 'SELECT')
     or has_table_privilege('authenticated', 'public.retained_receipts', 'SELECT')
     or has_table_privilege('authenticated', 'public.retained_receipts', 'INSERT')
     or has_table_privilege('authenticated', 'public.retained_receipts', 'DELETE') then
    raise exception 'RA5: retained_receipts e accesibila unui rol client';
  end if;
  if has_function_privilege('anon', 'public.archive_fiscal_receipts_for_user(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.archive_fiscal_receipts_for_user(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.archive_fiscal_receipts_for_user(uuid)', 'EXECUTE') then
    raise exception 'RA5: archive_fiscal_receipts_for_user e executabila din afara';
  end if;
  raise notice 'RA5 OK';
end $$;

rollback;
