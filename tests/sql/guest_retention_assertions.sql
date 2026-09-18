-- tests/sql/guest_retention_assertions.sql
-- =============================================================================
-- GR1–GR10 — clichetul PERMANENT al mig 280 (retenția PII a oaspeților).
--
-- DE CE AICI ȘI NU DOAR ÎN MIGRAȚIE: blocul de asserțiuni din corpul mig 280 se
-- evaluează O SINGURĂ DATĂ, la poziția 280 din lanț (clasa DP6 / VS8 / F1–F9).
-- Fișierul ăsta rulează la FIECARE replay, pe starea FINALĂ a lanțului.
--
--   GR1  Fereastra de 12 luni: rândul de la 13 luni e pseudonimizat pe TOATE
--        cele patru câmpuri, cel de la 11 luni e NEATINS (control pozitiv +
--        negativ în aceeași fixtură).
--   GR2  Auto-consum: a doua rulare atinge ZERO rânduri, pe fiecare găleată.
--   GR3  `orders`: comanda pickup primește sentinela + telefon NULL; comanda
--        QR (fără nume) NU primește un nume inventat.
--   GR4  `audit_log`: exact două chei mascate, restul instantaneului IDENTIC,
--        ZERO rânduri șterse — inclusiv rândul scris chiar de UPDATE-ul de la
--        pasul 2 (altfel pasul pe `orders` e teatru).
--   GR5  `pii_mask_jsonb`: cheie absentă / JSON null / deja mascată → intrare
--        NESCHIMBATĂ (contractul care face UPDATE-ul auto-consumat).
--   GR6  Cozile: DOAR rânduri terminale, DOAR peste fereastră, `dedup_key`
--        NEATINS (indexul unic e anti-dublare, nu poate fi pierdut).
--   GR7  `order_feedback` / `qr_scans`: identificatorii tehnici dispar la 30 de
--        zile; `comment`, `rating`, `country` rămân.
--   GR8  COMPORTAMENTAL: un telefon anonimizat iese SINGUR din raportul de
--        recidiviști (`get_reservation_no_show_counts`), fiindcă sentinela nu
--        conține cifre. Control pozitiv: ÎNAINTE de anonimizare apare.
--   GR9  Suprafață: nicio funcție nouă nu e apelabilă de un rol client; jobul e
--        în manifestul pg_cron și NU în denylist.
--   GR10 CLICHET DE CLASĂ: orice tabelă din `public` cu o coloană de identitate
--        e ori acoperită de janitor, ori într-un registru de scutiri CU MOTIV.
--        O tabelă VIITOARE cu PII face CI roșu până primește o decizie.
--
-- Rulează DUPĂ migrații, într-o singură tranzacție, cu ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on
\timing off

begin;

-- ── Fixtură ──────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('61710000-0000-4000-8000-000000000001'::uuid, 'gr-owner@gr.test');

-- `growth`, nu `free` (limita de membri din mig 131 respinge membership-ul) și
-- nu `enterprise`: pe un plan cu `fiscal_receipt`, `enforce_closed_status_gate`
-- (mig 264) ar respinge inserarea comenzilor cu `status = 'closed'`.
update public.profiles set plan = 'growth'
 where id = '61710000-0000-4000-8000-000000000001'::uuid;

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('61720000-0000-4000-8000-000000000001'::uuid,'61710000-0000-4000-8000-000000000001'::uuid,
   'GR Bistro','gr-bistro-slug','Cluj',true);

insert into public.restaurant_memberships (restaurant_id, user_id, role) values
  ('61720000-0000-4000-8000-000000000001'::uuid,'61710000-0000-4000-8000-000000000001'::uuid,'owner')
on conflict (restaurant_id, user_id) do nothing;

-- Rezervări: una VECHE (13 luni, peste fereastră), una RECENTĂ (11 luni, sub
-- fereastră) și una VECHE `no_show` pentru GR8. Fiecare contrazice un predicat
-- diferit — fără ele, filtrul de vârstă ar fi netestat.
insert into public.reservations
  (id, restaurant_id, customer_name, customer_phone, customer_email, special_requests,
   party_size, starts_at, ends_at, status, created_at) values
  ('61730000-0000-4000-8000-000000000001'::uuid,'61720000-0000-4000-8000-000000000001'::uuid,
   'Vechi Ion','0722111222','vechi@gr.test','fara ceapa',
   2, now() - interval '13 months', now() - interval '13 months' + interval '2 hours','seated', now() - interval '13 months'),
  ('61730000-0000-4000-8000-000000000002'::uuid,'61720000-0000-4000-8000-000000000001'::uuid,
   'Recent Ana','0733222333','recent@gr.test','langa geam',
   2, now() - interval '11 months', now() - interval '11 months' + interval '2 hours','seated', now() - interval '11 months'),
  ('61730000-0000-4000-8000-000000000003'::uuid,'61720000-0000-4000-8000-000000000001'::uuid,
   'Recidivist','0744333444', null, null,
   2, now() - interval '13 months', now() - interval '13 months' + interval '2 hours','no_show', now() - interval '13 months');

-- Comenzi: una PICKUP veche (cu nume+telefon), una de OSPĂTAR veche FĂRĂ nume de
-- oaspete (cazul care prinde „sentinela pusă necondiționat"), una PICKUP recentă.
insert into public.orders
  (id, restaurant_id, source, status, total,
   customer_name, customer_phone, created_at) values
  ('61740000-0000-4000-8000-000000000001'::uuid,'61720000-0000-4000-8000-000000000001'::uuid,
   'pickup','closed', 50, 'Pickup Dan','0755444555', now() - interval '13 months'),
  ('61740000-0000-4000-8000-000000000002'::uuid,'61720000-0000-4000-8000-000000000001'::uuid,
   'waiter','closed', 30, null, null, now() - interval '13 months'),
  ('61740000-0000-4000-8000-000000000003'::uuid,'61720000-0000-4000-8000-000000000001'::uuid,
   'pickup','closed', 20, 'Proaspat Mihai','0766555666', now() - interval '11 months'),
  -- VECHE, cu TELEFON dar FĂRĂ nume: singurul rând care INTRĂ în predicat și
  -- totuși nu are nume. Fără el, `case when customer_name is not null` e
  -- netestat, iar o sentinelă pusă necondiționat ar trece nedetectată.
  ('61740000-0000-4000-8000-000000000004'::uuid,'61720000-0000-4000-8000-000000000001'::uuid,
   'waiter','closed', 40, null, '0777888999', now() - interval '13 months');

-- Cozile: terminal+vechi (se anonimizează), ne-terminal+vechi (NU), terminal+
-- recent (NU). `dedup_key` e distinct pe fiecare rând, ca GR6 să poată dovedi
-- că nu s-a pierdut.
insert into public.email_queue
  (id, recipient_email, recipient_name, template_kind, template_data, status, dedup_key, created_at) values
  ('61750000-0000-4000-8000-000000000001'::uuid,'a@gr.test','Ana','reservation_created',
   '{"name":"Ana","phone":"0722111222"}'::jsonb,'sent','gr:dedup:1', now() - interval '100 days'),
  ('61750000-0000-4000-8000-000000000002'::uuid,'b@gr.test','Bogdan','reservation_created',
   '{"name":"Bogdan"}'::jsonb,'queued','gr:dedup:2', now() - interval '100 days'),
  ('61750000-0000-4000-8000-000000000003'::uuid,'c@gr.test','Cosmin','reservation_created',
   '{"name":"Cosmin"}'::jsonb,'sent','gr:dedup:3', now() - interval '10 days');

insert into public.sms_queue
  (id, restaurant_id, recipient_phone, template_kind, template_data, status, dedup_key, created_at) values
  ('61760000-0000-4000-8000-000000000001'::uuid,'61720000-0000-4000-8000-000000000001'::uuid,
   '0722111222','reservation_confirmed','{"name":"Ana"}'::jsonb,'sent','gr:sms:1', now() - interval '100 days'),
  ('61760000-0000-4000-8000-000000000002'::uuid,'61720000-0000-4000-8000-000000000001'::uuid,
   '0733222333','reservation_confirmed','{"name":"Bogdan"}'::jsonb,'queued','gr:sms:2', now() - interval '100 days');

insert into public.order_feedback
  (id, order_id, restaurant_id, feedback_type, rating, comment, ip_address, user_agent, created_at) values
  ('61770000-0000-4000-8000-000000000001'::uuid,'61740000-0000-4000-8000-000000000001'::uuid,
   '61720000-0000-4000-8000-000000000001'::uuid,'service',5,'foarte bun','203.0.113.7'::inet,'Mozilla/5.0 GR', now() - interval '60 days'),
  ('61770000-0000-4000-8000-000000000002'::uuid,'61740000-0000-4000-8000-000000000003'::uuid,
   '61720000-0000-4000-8000-000000000001'::uuid,'service',4,'ok','203.0.113.8'::inet,'Mozilla/5.0 GR2', now() - interval '5 days');

insert into public.qr_scans (id, restaurant_id, scanned_at, user_agent, country) values
  ('61780000-0000-4000-8000-000000000001'::uuid,'61720000-0000-4000-8000-000000000001'::uuid,
   now() - interval '60 days','Mozilla/5.0 QR','RO'),
  ('61780000-0000-4000-8000-000000000002'::uuid,'61720000-0000-4000-8000-000000000001'::uuid,
   now() - interval '5 days','Mozilla/5.0 QR2','RO');

-- Un instantaneu de audit SCRIS DE MÂNĂ pe comanda veche, cu câmpuri care NU au
-- voie să se schimbe. Trigger-ul real (`audit_orders`) va mai scrie unul la
-- UPDATE-ul de anonimizare — GR4 cere ca AMBELE să fie mascate.
insert into public.audit_log
  (id, actor_role, table_name, operation, row_id, restaurant_id, old_data, new_data) values
  (9900000001,'authenticated','orders','UPDATE',
   '61740000-0000-4000-8000-000000000001','61720000-0000-4000-8000-000000000001'::uuid,
   '{"id":"61740000-0000-4000-8000-000000000001","status":"served","total":50,"customer_name":"Pickup Dan","customer_phone":"0755444555"}'::jsonb,
   '{"id":"61740000-0000-4000-8000-000000000001","status":"closed","total":50,"customer_name":"Pickup Dan","customer_phone":"0755444555"}'::jsonb),
  -- Rând de CONTROL pe ALTĂ comandă: NU are voie să fie atins (dovada că
  -- mascarea e scopată pe comenzile chiar anonimizate, nu pe toată tabela).
  (9900000002,'authenticated','orders','UPDATE',
   '61740000-0000-4000-8000-000000000003','61720000-0000-4000-8000-000000000001'::uuid,
   '{"id":"61740000-0000-4000-8000-000000000003","customer_name":"Proaspat Mihai","customer_phone":"0766555666"}'::jsonb,
   null);

-- ── GR8 (partea de CONTROL POZITIV) — se măsoară ÎNAINTE de anonimizare ──────
-- `get_reservation_no_show_counts` are gate `is_member`, care citește
-- `auth.uid()`; suita rulează ca `postgres`, FĂRĂ JWT, deci fără claim-ul de
-- mai jos funcția ar arunca, iar un „0 rânduri" de după ar fi indistinct de
-- succes. (Aceeași capcană ca OB4 din suita Oblio.)
set local request.jwt.claim.sub = '61710000-0000-4000-8000-000000000001';

do $$
declare v_n bigint;
begin
  select coalesce(sum(c.no_show_count), 0) into v_n
    from public.get_reservation_no_show_counts('61720000-0000-4000-8000-000000000001'::uuid) c;
  if v_n is distinct from 1 then
    raise exception 'GR8 (control pozitiv): inainte de anonimizare se asteptau 1 no-show in raport, s-au gasit %', v_n;
  end if;
  create temp table gr_before_no_show(n bigint) on commit drop;
  insert into gr_before_no_show values (v_n);
end $$;

-- ── Rularea ──────────────────────────────────────────────────────────────────
-- Claim-ul se STINGE înainte: pe pg_cron janitorul rulează ca `postgres`, fără
-- niciun JWT. Cu claim-ul aprins, `enforce_waiter_reservation_columns` ar lua
-- altă ramură decât în producție, iar testul ar valida un scenariu inexistent.
set local request.jwt.claim.sub = '';

create temp table gr_run1(res jsonb) on commit drop;
insert into gr_run1 select public.anonymize_guest_pii(12, 90, 30);

-- ── GR1: fereastra de 12 luni pe rezervări ───────────────────────────────────
do $$
declare v_old public.reservations%rowtype; v_new public.reservations%rowtype;
begin
  select * into v_old from public.reservations where id = '61730000-0000-4000-8000-000000000001'::uuid;
  select * into v_new from public.reservations where id = '61730000-0000-4000-8000-000000000002'::uuid;

  if v_old.customer_name is distinct from '[anonimizat]'
     or v_old.customer_phone is distinct from '[anonimizat]'
     or v_old.customer_email is not null or v_old.special_requests is not null then
    raise exception 'GR1: rezervarea de la 13 luni NU e pseudonimizata complet (nume=%, tel=%, email=%, cerinte=%)',
      v_old.customer_name, v_old.customer_phone, v_old.customer_email, v_old.special_requests;
  end if;
  -- Rândul rămâne: pseudonimizare, NU stergere (statistica de ocupare).
  if v_old.party_size is null or v_old.starts_at is null or v_old.status is distinct from 'seated' then
    raise exception 'GR1: datele NE-personale ale rezervarii vechi s-au pierdut'; end if;

  if v_new.customer_name is distinct from 'Recent Ana'
     or v_new.customer_phone is distinct from '0733222333'
     or v_new.customer_email is distinct from 'recent@gr.test'
     or v_new.special_requests is distinct from 'langa geam' then
    raise exception 'GR1: rezervarea de la 11 luni a fost atinsa (fereastra de 12 luni nu se aplica)';
  end if;
  raise notice 'GR1 OK';
end $$;

-- ── GR2: auto-consum (a doua rulare = zero peste tot) ────────────────────────
do $$
declare v_res jsonb; v_k text; v_v bigint;
begin
  v_res := public.anonymize_guest_pii(12, 90, 30);
  for v_k, v_v in
    select k, (v_res ->> k)::bigint from jsonb_object_keys(v_res) k where k not like 'cutoff%'
  loop
    if v_v is distinct from 0 then
      raise exception 'GR2: a doua rulare a atins % rand(uri) in galeata "%" — predicatul NU e auto-consumat', v_v, v_k;
    end if;
  end loop;
  raise notice 'GR2 OK';
end $$;

-- ── GR3: comenzi — pickup mascat, QR fără nume inventat ─────────────────────
do $$
declare v_pick public.orders%rowtype; v_qr public.orders%rowtype; v_fresh public.orders%rowtype;
        v_nophone public.orders%rowtype;
begin
  select * into v_pick  from public.orders where id = '61740000-0000-4000-8000-000000000001'::uuid;
  select * into v_qr    from public.orders where id = '61740000-0000-4000-8000-000000000002'::uuid;
  select * into v_fresh from public.orders where id = '61740000-0000-4000-8000-000000000003'::uuid;

  if v_pick.customer_name is distinct from '[anonimizat]' or v_pick.customer_phone is not null then
    raise exception 'GR3: comanda pickup veche NU e anonimizata (nume=%, tel=%)', v_pick.customer_name, v_pick.customer_phone; end if;
  if v_pick.total is distinct from 50 or v_pick.status is distinct from 'closed' then
    raise exception 'GR3: datele FISCALE ale comenzii au fost atinse'; end if;

  if v_qr.customer_name is not null then
    raise exception 'GR3: comanda FARA nume de oaspete a primit sentinela "%" — s-a inventat un oaspete identificat', v_qr.customer_name; end if;

  -- Cazul care CHIAR intra in predicat (telefon, fara nume): telefonul dispare,
  -- numele ramane NULL. Aici se prinde sentinela pusa neconditionat.
  select * into v_nophone from public.orders where id = '61740000-0000-4000-8000-000000000004'::uuid;
  if v_nophone.customer_phone is not null then
    raise exception 'GR3: telefonul comenzii fara nume a supravietuit'; end if;
  if v_nophone.customer_name is not null then
    raise exception 'GR3: o comanda FARA nume a primit sentinela "%" desi a intrat in predicat prin TELEFON — s-a inventat un oaspete identificat', v_nophone.customer_name; end if;

  if v_fresh.customer_name is distinct from 'Proaspat Mihai'
     or v_fresh.customer_phone is distinct from '0766555666' then
    raise exception 'GR3: comanda de la 11 luni a fost atinsa'; end if;
  raise notice 'GR3 OK';
end $$;

-- ── GR4: audit_log — două chei mascate, restul IDENTIC, zero rânduri șterse ──
do $$
declare v_row public.audit_log%rowtype; v_ctl public.audit_log%rowtype;
        v_fresh_bad int; v_total int;
begin
  select * into v_row from public.audit_log where id = 9900000001;
  if v_row.id is null then
    raise exception 'GR4: randul de audit a fost STERS — retentia audit_log e INCHISA (pastram tot)'; end if;

  if v_row.old_data ->> 'customer_name'  is distinct from '[anonimizat]'
     or v_row.old_data ->> 'customer_phone' is distinct from '[anonimizat]'
     or v_row.new_data ->> 'customer_name'  is distinct from '[anonimizat]'
     or v_row.new_data ->> 'customer_phone' is distinct from '[anonimizat]' then
    raise exception 'GR4: instantaneul de audit inca poarta PII (old=%, new=%)', v_row.old_data, v_row.new_data; end if;

  -- Restul instantaneului, byte-cu-byte: „reconstituie starea comenzii la
  -- momentul T" trebuie sa functioneze mai departe.
  if (v_row.old_data - 'customer_name' - 'customer_phone')
       is distinct from '{"id":"61740000-0000-4000-8000-000000000001","status":"served","total":50}'::jsonb
     or (v_row.new_data - 'customer_name' - 'customer_phone')
       is distinct from '{"id":"61740000-0000-4000-8000-000000000001","status":"closed","total":50}'::jsonb then
    raise exception 'GR4: mascarea a atins si alte chei: old=%, new=%', v_row.old_data, v_row.new_data; end if;

  -- Randul de CONTROL, pe o comanda NEanonimizata: neatins.
  select * into v_ctl from public.audit_log where id = 9900000002;
  if v_ctl.old_data ->> 'customer_name' is distinct from 'Proaspat Mihai' then
    raise exception 'GR4: mascarea a scapat scopul — a atins auditul unei comenzi NEanonimizate'; end if;

  -- Randul scris CHIAR de UPDATE-ul de anonimizare (trigger `audit_orders`):
  -- fara pasul 3 din mig 280, `old_data` al lui ar fi o copie PROASPATA a
  -- PII-ului, scrisa exact in momentul in care pretindem ca l-am sters.
  select count(*) into v_fresh_bad
    from public.audit_log a
   where a.table_name = 'orders'
     and a.row_id = '61740000-0000-4000-8000-000000000001'
     and (a.old_data ->> 'customer_phone' = '0755444555'
       or a.new_data ->> 'customer_phone' = '0755444555'
       or a.old_data ->> 'customer_name'  = 'Pickup Dan'
       or a.new_data ->> 'customer_name'  = 'Pickup Dan');
  if v_fresh_bad is distinct from 0 then
    raise exception 'GR4: % rand(uri) de audit inca poarta PII-ul comenzii anonimizate (inclusiv cel scris de UPDATE-ul insusi)', v_fresh_bad; end if;

  select count(*) into v_total from public.audit_log
   where id in (9900000001,9900000002);
  if v_total is distinct from 2 then
    raise exception 'GR4: s-au pierdut randuri de audit (% din 2)', v_total; end if;
  raise notice 'GR4 OK';
end $$;

-- ── GR5: contractul lui pii_mask_jsonb ──────────────────────────────────────
do $$
declare v_keys constant text[] := array['customer_name','customer_phone'];
begin
  if public.pii_mask_jsonb(null, v_keys, '[anonimizat]') is not null then
    raise exception 'GR5: null → trebuie null'; end if;

  -- cheie ABSENTA: nu se adauga
  if public.pii_mask_jsonb('{"total":10}'::jsonb, v_keys, '[anonimizat]')
     is distinct from '{"total":10}'::jsonb then
    raise exception 'GR5: o cheie absenta a fost ADAUGATA'; end if;

  -- JSON null (comanda QR): NU se inventeaza un nume
  if public.pii_mask_jsonb('{"customer_name":null}'::jsonb, v_keys, '[anonimizat]')
     is distinct from '{"customer_name":null}'::jsonb then
    raise exception 'GR5: o valoare JSON null a fost inlocuita cu sentinela (nume inventat)'; end if;

  -- deja mascata: rezultat IDENTIC (altfel UPDATE-ul nu s-ar consuma niciodata)
  if public.pii_mask_jsonb('{"customer_name":"[anonimizat]"}'::jsonb, v_keys, '[anonimizat]')
     is distinct from '{"customer_name":"[anonimizat]"}'::jsonb then
    raise exception 'GR5: o cheie deja mascata produce un rezultat DIFERIT — UPDATE-ul ar rescrie la infinit'; end if;

  -- NE-obiect (scalar / array): NEATINS. Fara garda, `||` CONCATENEAZA:
  -- `'5'::jsonb` devine `[5, {}]`, adica un instantaneu de jurnal fiscal corupt
  -- TACIT. Azi intrarile vin din `to_jsonb(ROW)` si sunt mereu obiecte, dar
  -- helperul e general si asta e clasa de defect pe care o vanam peste tot.
  if public.pii_mask_jsonb('5'::jsonb, v_keys, '[anonimizat]') is distinct from '5'::jsonb then
    raise exception 'GR5: un jsonb SCALAR a fost modificat (concatenare, nu imbinare): %',
      public.pii_mask_jsonb('5'::jsonb, v_keys, '[anonimizat]'); end if;
  if public.pii_mask_jsonb('["customer_name"]'::jsonb, v_keys, '[anonimizat]')
     is distinct from '["customer_name"]'::jsonb then
    raise exception 'GR5: un jsonb ARRAY a fost modificat: %',
      public.pii_mask_jsonb('["customer_name"]'::jsonb, v_keys, '[anonimizat]'); end if;

  -- cazul viu
  if public.pii_mask_jsonb('{"customer_name":"Dan","total":5}'::jsonb, v_keys, '[anonimizat]')
     is distinct from '{"customer_name":"[anonimizat]","total":5}'::jsonb then
    raise exception 'GR5: cazul viu nu mascheaza corect'; end if;
  raise notice 'GR5 OK';
end $$;

-- ── GR6: cozile — doar terminale, doar peste fereastră, dedup_key INTACT ────
do $$
declare v_r record;
begin
  select * into v_r from public.email_queue where id = '61750000-0000-4000-8000-000000000001'::uuid;
  if v_r.recipient_email is distinct from '[anonimizat]' or v_r.recipient_name is not null
     or v_r.template_data is distinct from '{}'::jsonb then
    raise exception 'GR6: emailul terminal vechi NU e anonimizat (%, %, %)', v_r.recipient_email, v_r.recipient_name, v_r.template_data; end if;
  if v_r.dedup_key is distinct from 'gr:dedup:1' then
    raise exception 'GR6: dedup_key a fost atins — indexul unic e singura plasa anti-dublare'; end if;
  if v_r.status is distinct from 'sent' then
    raise exception 'GR6: statusul cozii a fost schimbat'; end if;

  select * into v_r from public.email_queue where id = '61750000-0000-4000-8000-000000000002'::uuid;
  if v_r.recipient_email is distinct from 'b@gr.test' then
    raise exception 'GR6: un email `queued` (munca IN CURS) a fost anonimizat — ar pleca spre "[anonimizat]"'; end if;

  select * into v_r from public.email_queue where id = '61750000-0000-4000-8000-000000000003'::uuid;
  if v_r.recipient_email is distinct from 'c@gr.test' then
    raise exception 'GR6: un email terminal RECENT (10 zile) a fost anonimizat'; end if;

  select * into v_r from public.sms_queue where id = '61760000-0000-4000-8000-000000000001'::uuid;
  if v_r.recipient_phone is distinct from '[anonimizat]' or v_r.template_data is distinct from '{}'::jsonb then
    raise exception 'GR6: SMS-ul terminal vechi NU e anonimizat'; end if;
  if v_r.dedup_key is distinct from 'gr:sms:1' then
    raise exception 'GR6: dedup_key (sms) a fost atins'; end if;

  select * into v_r from public.sms_queue where id = '61760000-0000-4000-8000-000000000002'::uuid;
  if v_r.recipient_phone is distinct from '0733222333' then
    raise exception 'GR6: un SMS `queued` a fost anonimizat'; end if;
  raise notice 'GR6 OK';
end $$;

-- ── GR7: identificatori tehnici la 30 de zile, conținutul rămâne ────────────
do $$
declare v_f record; v_q record;
begin
  select * into v_f from public.order_feedback where id = '61770000-0000-4000-8000-000000000001'::uuid;
  if v_f.ip_address is not null or v_f.user_agent is not null then
    raise exception 'GR7: IP/user-agent de la 60 de zile au supravietuit'; end if;
  if v_f.rating is distinct from 5 or v_f.comment is distinct from 'foarte bun' then
    raise exception 'GR7: continutul feedback-ului a fost atins (rating/comment nu sunt identificatori)'; end if;

  select * into v_f from public.order_feedback where id = '61770000-0000-4000-8000-000000000002'::uuid;
  if v_f.ip_address is null or v_f.user_agent is null then
    raise exception 'GR7: feedback-ul de la 5 zile a fost curatat (fereastra anti-abuz e de 30)'; end if;

  select * into v_q from public.qr_scans where id = '61780000-0000-4000-8000-000000000001'::uuid;
  if v_q.user_agent is not null then
    raise exception 'GR7: user-agent-ul de pe scanarea de la 60 de zile a supravietuit'; end if;
  if v_q.country is distinct from 'RO' or v_q.scanned_at is null then
    raise exception 'GR7: statistica de activare QR (country/scanned_at) a fost atinsa'; end if;

  select * into v_q from public.qr_scans where id = '61780000-0000-4000-8000-000000000002'::uuid;
  if v_q.user_agent is null then
    raise exception 'GR7: scanarea de la 5 zile a fost curatata'; end if;
  raise notice 'GR7 OK';
end $$;

-- ── GR8: telefonul anonimizat iese SINGUR din raportul de recidiviști ───────
-- Legătura e reală, nu presupusă: `get_reservation_no_show_counts` filtrează pe
-- `length(regexp_replace(customer_phone,'\D','','g')) >= 9`, deci o sentinelă CU
-- cifre ar inventa un „recidivist". Controlul pozitiv (1 înainte) a rulat mai sus.
set local request.jwt.claim.sub = '61710000-0000-4000-8000-000000000001';

do $$
declare v_after bigint; v_before bigint;
begin
  select n into v_before from gr_before_no_show;
  select coalesce(sum(c.no_show_count), 0) into v_after
    from public.get_reservation_no_show_counts('61720000-0000-4000-8000-000000000001'::uuid) c;
  if v_before is distinct from 1 then
    raise exception 'GR8: controlul pozitiv s-a pierdut (before=%)', v_before; end if;
  if v_after is distinct from 0 then
    raise exception 'GR8: dupa anonimizare raportul de recidivisti inca numara % — sentinela contine cifre?', v_after; end if;
  if length(regexp_replace('[anonimizat]', '\D', '', 'g')) is distinct from 0 then
    raise exception 'GR8: sentinela contine cifre'; end if;
  raise notice 'GR8 OK';
end $$;

-- ── GR9: suprafață + programare ─────────────────────────────────────────────
do $$
declare v_bad text; v_m record;
begin
  select string_agg(x.fn || '/' || x.rol, ', ') into v_bad
    from (select f.fn, r.rol
            from (values ('public.anonymize_guest_pii(integer,integer,integer)'),
                         ('public.pii_mask_jsonb(jsonb,text[],text)')) as f(fn),
                 (values ('anon'), ('authenticated'), ('service_role')) as r(rol)
           where has_function_privilege(r.rol, f.fn, 'execute')) x;
  if v_bad is not null then
    raise exception 'GR9: functii apelabile de roluri client: %', v_bad; end if;

  if not (select prosecdef from pg_proc
           where oid = 'public.anonymize_guest_pii(integer,integer,integer)'::regprocedure) then
    raise exception 'GR9: janitorul trebuie sa fie SECURITY DEFINER'; end if;
  if not exists (select 1 from pg_proc
                  where oid = 'public.anonymize_guest_pii(integer,integer,integer)'::regprocedure
                    and array_to_string(proconfig, ',') like '%pg_temp%') then
    raise exception 'GR9: janitorul nu are search_path = public, pg_temp'; end if;

  -- Plafoanele de lacăt/instrucțiune sunt pe FUNCȚIE: sub pg_cron nimeni nu pune
  -- `set local`, iar un UPDATE care așteaptă la nesfârșit ține o tranzacție
  -- deschisă și blochează `vacuum` pe `orders`/`audit_log`. O recreare care le
  -- pierde readuce exact asta, tăcut.
  if not exists (select 1 from pg_proc
                  where oid = 'public.anonymize_guest_pii(integer,integer,integer)'::regprocedure
                    and array_to_string(proconfig, ',') like '%lock_timeout=%') then
    raise exception 'GR9: janitorul nu mai are lock_timeout pe functie — poate astepta la nesfarsit dupa un lacat'; end if;
  if not exists (select 1 from pg_proc
                  where oid = 'public.anonymize_guest_pii(integer,integer,integer)'::regprocedure
                    and array_to_string(proconfig, ',') like '%statement_timeout=%') then
    raise exception 'GR9: janitorul nu mai are statement_timeout pe functie'; end if;

  select * into v_m from public.pg_cron_janitor_manifest where job_name = 'menuvia_janitor_guest_pii';
  if v_m.job_name is null then
    raise exception 'GR9: jobul lipseste din manifestul pg_cron — retentia nu ruleaza nicaieri'; end if;
  if exists (select 1 from public.pg_cron_janitor_denylist() where fn_name = 'anonymize_guest_pii') then
    raise exception 'GR9: jobul e SI in manifest, SI in denylist'; end if;
  raise notice 'GR9 OK';
end $$;

-- ── GR10: CLICHET DE CLASĂ pe inventarul de PII ─────────────────────────────
-- Orice tabelă din `public` cu o coloană de identitate e ori ACOPERITĂ de
-- janitor (numele tabelei apare în corpul lui), ori într-un registru de scutiri
-- CU MOTIV. O tabelă viitoare cu PII face CI roșu până cineva decide în care
-- dintre cele două categorii intră — exact disciplina TG4 / JL1.
do $$
declare
  v_src text;
  v_scutiri constant text[] := array[
    -- B2B / cont / fiscal — NU sunt date de OASPETE:
    'affiliates',       -- partener contractual; telefonul e cerut de mig 224 la aprobare
    'audit_log',        -- jurnal fiscal, retentie INCHISA ("pastram tot"); PII-ul de
                        -- oaspete din instantaneele `orders` e mascat de pasul 3 al mig 280
    'invite_tokens',    -- invitatie de STAFF; randul moare la accept/revoke
    'invoices',         -- date de FACTURARE: retentie fiscala de 10 ani, nu 12 luni
    'leads',            -- prospect de marketing, nu oaspete al unui restaurant
    'profiles',         -- cont; Art. 17 prin process_account_deletions (denylist mig 274)
    'recrutare_leads',  -- candidat, nu oaspete
    'restaurants',      -- datele PUBLICE ale localului (afisate in meniu)
    'suppliers'         -- contact B2B al restaurantului
  ];
  v_bad text;
begin
  select p.prosrc into v_src from pg_proc p
   where p.oid = 'public.anonymize_guest_pii(integer,integer,integer)'::regprocedure;

  select string_agg(distinct c.relname || '.' || a.attname, ', ' order by c.relname || '.' || a.attname)
    into v_bad
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
     and a.attname ~ '^(customer_name|customer_phone|customer_email|recipient_name|recipient_email|recipient_phone|special_requests|ip_address|user_agent|guest_name|guest_phone|guest_email|phone|email)$'
     and not (c.relname = any (v_scutiri))
     and position('public.' || c.relname in v_src) = 0;

  if v_bad is not null then
    raise exception 'GR10: coloane de identitate NEACOPERITE de retentie si fara scutire motivata: %. Adauga tabela in anonymize_guest_pii (mig 280) SAU in registrul de scutiri din GR10, cu motiv.', v_bad;
  end if;

  -- Anti-vacuitate: registrul de scutiri nu poate fi umflat ca sa taca testul,
  -- iar acoperirea reala trebuie sa existe. Fara asta, un `v_scutiri` cu toate
  -- tabelele ar face GR10 mereu verde.
  if position('public.reservations' in v_src) = 0
     or position('public.orders' in v_src) = 0
     or position('public.email_queue' in v_src) = 0
     or position('public.sms_queue' in v_src) = 0
     or position('public.order_feedback' in v_src) = 0
     or position('public.qr_scans' in v_src) = 0 then
    raise exception 'GR10 (anti-vacuitate): janitorul nu mai atinge una dintre cele sase tabele acoperite';
  end if;
  raise notice 'GR10 OK';
end $$;

rollback;

\echo '✅ RETENTIE PII OASPETI OK (GR1-GR10)'
