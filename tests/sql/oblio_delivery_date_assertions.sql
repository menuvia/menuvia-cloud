-- tests/sql/oblio_delivery_date_assertions.sql
-- =============================================================================
-- Aserții permanente pentru mig 269 — rangul 14 al auditului v3.
--
--   OB1  `bridge_oblio_get_queued` întoarce `order_paid_at` cu valoarea REALĂ a
--        comenzii (deliveryDate se așază pe ziua ÎNCASĂRII, fiindcă ea
--        determină exigibilitatea TVA).
--   OB2  claim-ul rămâne ATOMIC și idempotent: a doua chemare NU mai vede
--        factura deja revendicată, iar `generating_since` e stampilat (mig 239
--        depinde de el ca să poată recupera facturile agățate).
--   OB3  gate-urile lanțului rămân: `failed_attempts < 3`, fereastra
--        `next_attempt_at`, și doar configurări `is_active`.
--   OB4  `list_invoices_for_restaurant` întoarce `has_einvoice` corect
--        (true/false), FĂRĂ să expună XML-ul.
--   OB5  contractul de coloane al listei e cel așteptat, cu `has_einvoice` la
--        FINAL (clientul face cast, deci ordinea veche nu se atinge).
--   OB6  suprafață: claim-ul e service_role EXCLUSIV; lista e authenticated,
--        nu anon.
--   OB7  (mig 276 / RES-18) claim-ul poartă bonul fiscal al comenzii:
--        `receipt_bon_number` + `receipt_printed_at` (= claimed_at, cu
--        completed_at ca rezervă) din rândul `success` cel mai recent al
--        ACELUIAȘI restaurant; un `cancelled` mai nou cu bon, un success mai
--        vechi și un success-parazit al altui restaurant NU contează; fără
--        niciun rând → NULL.
--   OB8  contractul de coloane al claim-ului: EXACT o semnătură, 21 de coloane,
--        cele două noi la FINAL, invariantele lanțului în corp (clichet VIU —
--        verificările din corpul mig 276 rulează o singură dată).
--   OB9  o factură a cărei comandă are un bon în TRANZIT (pending/sent/error)
--        NU se revendică; iese la primul claim de după success (cu bon) sau
--        cancelled (fără bon).
--
-- Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('8e000000-0000-4000-8000-0000000000a0','ob-owner@ob.test');
update public.profiles set plan = 'enterprise' where id = '8e000000-0000-4000-8000-0000000000a0';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('8e000000-0000-4000-8000-000000000001','8e000000-0000-4000-8000-0000000000a0',
   'OB Bistro','ob-bistro-slug','Cluj',true);
insert into public.products (id, restaurant_id, name, price, is_active) values
  ('8e000000-0000-4000-8000-0000000000b0','8e000000-0000-4000-8000-000000000001','Produs OB',100,true);

insert into public.oblio_configs (restaurant_id, api_email, api_secret, company_cif,
                                  company_name, default_series, is_active)
values ('8e000000-0000-4000-8000-000000000001','ob@ob.test','secret','RO123',
        'OB SRL','MNV', true);

-- Comandă plătită IERI la 23:55 (ora României) — exact cazul în care ziua
-- emiterii și ziua livrării se despart.
insert into public.orders (id, restaurant_id, source, status, payment_method,
                           paid_amount, created_at, paid_at)
values ('8e000000-0000-4000-8000-0000000000d1','8e000000-0000-4000-8000-000000000001',
        'waiter','paid','cash',100,'2026-03-10 20:00:00+02','2026-03-10 23:55:00+02');
insert into public.order_items (order_id, product_id, product_name_snapshot,
                                quantity, unit_price_snapshot, item_total)
values ('8e000000-0000-4000-8000-0000000000d1','8e000000-0000-4000-8000-0000000000b0','Produs OB',1,100,100);

insert into public.invoices (id, restaurant_id, order_id, customer_name, is_b2b,
                             total_with_vat, status, created_at)
values ('8e000000-0000-4000-8000-0000000000f1','8e000000-0000-4000-8000-000000000001',
        '8e000000-0000-4000-8000-0000000000d1','Client OB', true, 100, 'queued', now());

-- ── OB1 + OB2: order_paid_at real + claim atomic ─────────────────────────────
do $$
declare v_paid timestamptz; v_n int; v_gen timestamptz;
begin
  select order_paid_at into v_paid
    from public.bridge_oblio_get_queued(10)
   where invoice_id = '8e000000-0000-4000-8000-0000000000f1';
  if v_paid is distinct from '2026-03-10 23:55:00+02'::timestamptz then
    raise exception 'OB1 FAIL: order_paid_at = % (așteptat 2026-03-10 23:55 EET) — deliveryDate ar cădea pe ziua emiterii', v_paid;
  end if;
  raise notice 'OB1 OK: claim-ul poartă ziua ÎNCASĂRII, nu pe cea a emiterii';

  select generating_since into v_gen from public.invoices
   where id = '8e000000-0000-4000-8000-0000000000f1';
  if v_gen is null then
    raise exception 'OB2 FAIL: generating_since nu e stampilat — oblio_reclaim_stale_generating (mig 239) rămâne fără reper';
  end if;

  -- A doua chemare NU mai vede factura (deja 'generating').
  select count(*) into v_n from public.bridge_oblio_get_queued(10)
   where invoice_id = '8e000000-0000-4000-8000-0000000000f1';
  if v_n <> 0 then
    raise exception 'OB2 FAIL: factura revendicată apare din nou (% ori) — risc de emitere DUBLĂ', v_n; end if;
  raise notice 'OB2 OK: claim atomic + generating_since stampilat';
end $$;

-- ── OB3: gate-urile lanțului ─────────────────────────────────────────────────
do $$
declare v_n int;
begin
  -- 3 eșecuri => nu se mai revendică.
  insert into public.invoices (id, restaurant_id, order_id, customer_name, is_b2b,
                               total_with_vat, status, failed_attempts, created_at)
  values ('8e000000-0000-4000-8000-0000000000f2','8e000000-0000-4000-8000-000000000001',
          '8e000000-0000-4000-8000-0000000000d1','Client OB2', false, 50, 'queued', 3, now());
  select count(*) into v_n from public.bridge_oblio_get_queued(10)
   where invoice_id = '8e000000-0000-4000-8000-0000000000f2';
  if v_n <> 0 then
    raise exception 'OB3 FAIL: factura cu failed_attempts=3 a fost revendicată'; end if;

  -- next_attempt_at în VIITOR => nu se revendică încă.
  insert into public.invoices (id, restaurant_id, order_id, customer_name, is_b2b,
                               total_with_vat, status, next_attempt_at, created_at)
  values ('8e000000-0000-4000-8000-0000000000f3','8e000000-0000-4000-8000-000000000001',
          '8e000000-0000-4000-8000-0000000000d1','Client OB3', false, 50, 'queued',
          now() + interval '1 hour', now());
  select count(*) into v_n from public.bridge_oblio_get_queued(10)
   where invoice_id = '8e000000-0000-4000-8000-0000000000f3';
  if v_n <> 0 then
    raise exception 'OB3 FAIL: factura cu next_attempt_at în viitor a fost revendicată'; end if;

  -- config INACTIV => nicio factură a restaurantului nu se revendică.
  update public.oblio_configs set is_active = false
   where restaurant_id = '8e000000-0000-4000-8000-000000000001';
  insert into public.invoices (id, restaurant_id, order_id, customer_name, is_b2b,
                               total_with_vat, status, created_at)
  values ('8e000000-0000-4000-8000-0000000000f4','8e000000-0000-4000-8000-000000000001',
          '8e000000-0000-4000-8000-0000000000d1','Client OB4', false, 50, 'queued', now());
  select count(*) into v_n from public.bridge_oblio_get_queued(10);
  if v_n <> 0 then
    raise exception 'OB3 FAIL: s-au revendicat % facturi deși oblio_configs e inactiv', v_n; end if;
  update public.oblio_configs set is_active = true
   where restaurant_id = '8e000000-0000-4000-8000-000000000001';
  raise notice 'OB3 OK: failed_attempts, next_attempt_at și is_active țin';
end $$;

-- ── OB4 + OB5: has_einvoice + contractul de coloane ──────────────────────────
-- `list_invoices_for_restaurant` are gate `is_admin`, care se uită la
-- `auth.uid()`. Suita rulează ca `postgres`, fără JWT → `auth.uid()` e NULL →
-- ZERO rânduri, iar `select into` ar da NULL tăcut. Punem claim-ul pe OWNER:
-- `is_admin` verifică întâi `restaurants.owner_id = auth.uid()`, deci nu e
-- nevoie de membership. (Prima variantă a testului a picat exact aici — bine,
-- fiindcă un `has_einvoice` NULL arată identic cu „fără e-Factura".)
select set_config('request.jwt.claim.sub', '8e000000-0000-4000-8000-0000000000a0', true);

do $$
declare v_has boolean; v_cols text[]; v_n int;
begin
  update public.invoices
     set status = 'issued', oblio_series = 'MNV', oblio_number = '42',
         oblio_einvoice = '<xml>e-factura</xml>', issued_at = now()
   where id = '8e000000-0000-4000-8000-0000000000f1';

  -- Guard: dacă gate-ul `is_admin` nu trece, lista e goală și `select into` dă
  -- NULL — indistinct de „false". Verificăm întâi că RPC-ul chiar vede factura.
  select count(*) into v_n
    from public.list_invoices_for_restaurant('8e000000-0000-4000-8000-000000000001', 50, 0)
   where id = '8e000000-0000-4000-8000-0000000000f1';
  if v_n <> 1 then
    raise exception 'OB4 FAIL: RPC-ul nu întoarce factura (% rânduri) — gate-ul is_admin nu trece, testul ar fi vacuu', v_n; end if;

  select has_einvoice into v_has
    from public.list_invoices_for_restaurant('8e000000-0000-4000-8000-000000000001', 50, 0)
   where id = '8e000000-0000-4000-8000-0000000000f1';
  if v_has is not true then
    raise exception 'OB4 FAIL: factura CU e-Factura raportează has_einvoice=%', v_has; end if;

  -- Factură emisă FĂRĂ e-Factura: semnalul care contează pe B2B.
  update public.invoices
     set status = 'issued', oblio_series = 'MNV', oblio_number = '43',
         oblio_einvoice = null, issued_at = now()
   where id = '8e000000-0000-4000-8000-0000000000f2';
  select has_einvoice into v_has
    from public.list_invoices_for_restaurant('8e000000-0000-4000-8000-000000000001', 50, 0)
   where id = '8e000000-0000-4000-8000-0000000000f2';
  if v_has is not false then
    raise exception 'OB4 FAIL: factura FĂRĂ e-Factura raportează has_einvoice=%', v_has; end if;

  -- Șir GOL ≡ absent (nu „prezent dar vid").
  update public.invoices set oblio_einvoice = '' where id = '8e000000-0000-4000-8000-0000000000f2';
  select has_einvoice into v_has
    from public.list_invoices_for_restaurant('8e000000-0000-4000-8000-000000000001', 50, 0)
   where id = '8e000000-0000-4000-8000-0000000000f2';
  if v_has is not false then
    raise exception 'OB4 FAIL: XML gol raportat ca e-Factura prezentă'; end if;
  raise notice 'OB4 OK: has_einvoice true/false/gol corect';

  select array_agg(u.nm order by u.ord) into v_cols
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace,
    lateral unnest(p.proargnames, p.proargmodes) with ordinality as u(nm, md, ord)
   where n.nspname = 'public' and p.proname = 'list_invoices_for_restaurant'
     and u.md = 't';
  if v_cols[14] is distinct from 'has_einvoice' then
    raise exception 'OB5 FAIL: has_einvoice nu e ultima coloană (e %) — clientul face cast pe ordine', v_cols; end if;
  if v_cols[1] is distinct from 'id' or v_cols[13] is distinct from 'created_at' then
    raise exception 'OB5 FAIL: ordinea coloanelor vechi s-a schimbat: %', v_cols; end if;
  raise notice 'OB5 OK: contract de coloane intact, has_einvoice la final';
end $$;

-- ── OB6: suprafață ───────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('authenticated','public.bridge_oblio_get_queued(integer)','EXECUTE') then
    raise exception 'OB6 FAIL: authenticated poate revendica facturi (doar service_role)'; end if;
  if not has_function_privilege('service_role','public.bridge_oblio_get_queued(integer)','EXECUTE') then
    raise exception 'OB6 FAIL: service_role NU poate revendica'; end if;
  if has_function_privilege('anon','public.list_invoices_for_restaurant(uuid, integer, integer)','EXECUTE') then
    raise exception 'OB6 FAIL: anon poate lista facturi'; end if;
  raise notice 'OB6 OK: claim service_role-only, listă authenticated';
end $$;

-- ── OB7: bonul fiscal al comenzii ajunge în claim (mig 276 / RES-18) ─────────
-- Fixtura e construită ca fiecare predicat al lateralului să aibă un rând care
-- l-ar contrazice (verificat prin mutație — fără rândurile astea testul era
-- VACUU pe filtrul de status, pe tenant, pe ordine și pe momentul tipăririi):
--   d7 @ restaurantul 1:  success 0007 (mai VECHI)      → ordinea alege 0042
--                         success 0042 claimed 11.03 21:03, completed 12.03 00:30
--                                                       → printed_at = claimed_at
--                         cancelled 9999 (cel mai NOU, cu bon) → status ≠ success
--   d7 @ restaurantul 2:  success 666, completed cel mai NOU → alt tenant
--   d8: niciun rând → claim cu NULL (comandă fără bridge → fără bon, ca înainte)
do $$
declare v_bon text; v_at timestamptz; v_n int;
begin
  insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
    ('8e000000-0000-4000-8000-000000000002','8e000000-0000-4000-8000-0000000000a0',
     'OB Parazit','ob-parazit-slug','Cluj',true);
  insert into public.orders (id, restaurant_id, source, status, payment_method,
                             paid_amount, created_at, paid_at)
  values ('8e000000-0000-4000-8000-0000000000d7','8e000000-0000-4000-8000-000000000001',
          'waiter','paid','cash',100,'2026-03-11 20:00:00+02','2026-03-11 21:00:00+02'),
         ('8e000000-0000-4000-8000-0000000000d8','8e000000-0000-4000-8000-000000000001',
          'waiter','paid','cash',100,'2026-03-11 20:10:00+02','2026-03-11 21:10:00+02');
  insert into public.pending_receipts (restaurant_id, order_id, payload, status, bon_number,
                                       total_snapshot, created_at, claimed_at, completed_at)
  values ('8e000000-0000-4000-8000-000000000001','8e000000-0000-4000-8000-0000000000d7',
          'S^x', 'success', '0007', 100, '2026-03-11 20:30:00+02', '2026-03-11 20:31:00+02', '2026-03-11 20:32:00+02'),
         ('8e000000-0000-4000-8000-000000000001','8e000000-0000-4000-8000-0000000000d7',
          'S^x', 'success', '0042', 100, '2026-03-11 21:01:00+02', '2026-03-11 21:03:00+02', '2026-03-12 00:30:00+02'),
         ('8e000000-0000-4000-8000-000000000001','8e000000-0000-4000-8000-0000000000d7',
          'S^x', 'cancelled', '9999', 100, '2026-03-12 01:40:00+02', null, '2026-03-12 01:41:00+02'),
         ('8e000000-0000-4000-8000-000000000002','8e000000-0000-4000-8000-0000000000d7',
          'S^x', 'success', '666', 100, '2026-03-12 02:00:00+02', '2026-03-12 02:01:00+02', '2026-03-12 02:02:00+02');
  insert into public.invoices (id, restaurant_id, order_id, customer_name, is_b2b,
                               total_with_vat, status, created_at)
  values ('8e000000-0000-4000-8000-0000000000f7','8e000000-0000-4000-8000-000000000001',
          '8e000000-0000-4000-8000-0000000000d7','Client OB7', true, 100, 'queued', now()),
         ('8e000000-0000-4000-8000-0000000000f8','8e000000-0000-4000-8000-000000000001',
          '8e000000-0000-4000-8000-0000000000d8','Client OB8', true, 100, 'queued', now());

  create temp table ob7_claim on commit drop as
    select * from public.bridge_oblio_get_queued(10);

  select count(*) into v_n from ob7_claim
   where invoice_id in ('8e000000-0000-4000-8000-0000000000f7','8e000000-0000-4000-8000-0000000000f8');
  if v_n <> 2 then
    raise exception 'OB7 FAIL: claim-ul a întors % din cele 2 facturi (join-ul pe bon a pierdut rânduri?)', v_n; end if;

  select receipt_bon_number, receipt_printed_at into v_bon, v_at
    from ob7_claim where invoice_id = '8e000000-0000-4000-8000-0000000000f7';
  if v_bon is distinct from '0042' then
    raise exception 'OB7 FAIL: receipt_bon_number = % (așteptat 0042: success-ul cel mai recent al ACESTUI restaurant — nu 0007/vechi, nu 9999/cancelled, nu 666/alt tenant)', v_bon; end if;
  if v_at is distinct from timestamptz '2026-03-11 21:03:00+02' then
    raise exception 'OB7 FAIL: receipt_printed_at = % (așteptat claimed_at 2026-03-11 21:03 EET, nu completed_at de a doua zi)', v_at; end if;

  select receipt_bon_number, receipt_printed_at into v_bon, v_at
    from ob7_claim where invoice_id = '8e000000-0000-4000-8000-0000000000f8';
  if v_bon is not null or v_at is not null then
    raise exception 'OB7 FAIL: comanda FĂRĂ niciun bon raportează bon % / % — mențiunea ar minți', v_bon, v_at; end if;
  raise notice 'OB7 OK: bonul e success-ul cel mai recent al restaurantului (0042 @ claimed_at), NULL fără rânduri';
end $$;

-- ── OB8: contractul de coloane + invariantele lanțului (clichet VIU) ─────────
do $$
declare v_cols text[]; v_src text; v_sig text; v_n int;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bridge_oblio_get_queued';
  if v_n <> 1 then
    raise exception 'OB8 FAIL: % semnaturi pentru bridge_oblio_get_queued (PGRST203 la orice apel)', v_n; end if;

  select array_agg(u.nm order by u.ord) into v_cols
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
    lateral unnest(p.proargnames, p.proargmodes) with ordinality as u(nm, md, ord)
   where n.nspname = 'public' and p.proname = 'bridge_oblio_get_queued' and u.md = 't';
  if array_length(v_cols, 1) <> 21
     or v_cols[1]  is distinct from 'invoice_id'
     or v_cols[19] is distinct from 'order_paid_at'
     or v_cols[20] is distinct from 'receipt_bon_number'
     or v_cols[21] is distinct from 'receipt_printed_at' then
    raise exception 'OB8 FAIL: contractul de coloane al claim-ului s-a schimbat: %', v_cols; end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bridge_oblio_get_queued';
  foreach v_sig in array array['for update skip locked', 'generating_since',
                               'failed_attempts < 3', 'next_attempt_at', 'oc.is_active',
                               'order by i.created_at asc', 'public.pending_receipts',
                               'r.status = ''success''', 'r.bon_number is not null',
                               'r.restaurant_id = c.restaurant_id',
                               'r.restaurant_id = i.restaurant_id',
                               'r.status in (''pending'', ''sent'', ''error'')',
                               'coalesce(r.claimed_at, r.completed_at)',
                               'order by r.completed_at desc nulls last, r.created_at desc'] loop
    if position(v_sig in v_src) = 0 then
      raise exception 'OB8 FAIL: claim-ul a pierdut invariantul "%"', v_sig; end if;
  end loop;
  raise notice 'OB8 OK: o singură semnătură, 21 de coloane cu bonul la final, invariantele în corp';
end $$;

-- ── OB9: bon în TRANZIT → factura așteaptă (mig 276, punctul 2) ─────────────
do $$
declare v_n int; v_bon text; v_st text; v_rid uuid;
begin
  insert into public.orders (id, restaurant_id, source, status, payment_method,
                             paid_amount, created_at, paid_at)
  values ('8e000000-0000-4000-8000-0000000000d9','8e000000-0000-4000-8000-000000000001',
          'waiter','paid','cash',100,'2026-03-12 20:00:00+02','2026-03-12 21:00:00+02'),
         ('8e000000-0000-4000-8000-0000000000da','8e000000-0000-4000-8000-000000000001',
          'waiter','paid','cash',100,'2026-03-12 20:10:00+02','2026-03-12 21:10:00+02');
  insert into public.pending_receipts (id, restaurant_id, order_id, payload, status, total_snapshot, created_at)
  values ('8e000000-0000-4000-8000-0000000000e9','8e000000-0000-4000-8000-000000000001',
          '8e000000-0000-4000-8000-0000000000d9','S^x','pending',100,'2026-03-12 21:00:30+02'),
         ('8e000000-0000-4000-8000-0000000000ea','8e000000-0000-4000-8000-000000000001',
          '8e000000-0000-4000-8000-0000000000da','S^x','pending',100,'2026-03-12 21:10:30+02');
  insert into public.invoices (id, restaurant_id, order_id, customer_name, is_b2b,
                               total_with_vat, status, created_at)
  values ('8e000000-0000-4000-8000-0000000000f9','8e000000-0000-4000-8000-000000000001',
          '8e000000-0000-4000-8000-0000000000d9','Client OB9', true, 100, 'queued', now()),
         ('8e000000-0000-4000-8000-0000000000fa','8e000000-0000-4000-8000-000000000001',
          '8e000000-0000-4000-8000-0000000000da','Client OB9b', true, 100, 'queued', now());

  -- pending → sent → error: niciuna nu se revendică, factura rămâne `queued`.
  foreach v_st in array array['pending', 'sent', 'error'] loop
    update public.pending_receipts set status = v_st
     where id = '8e000000-0000-4000-8000-0000000000e9';
    select count(*) into v_n from public.bridge_oblio_get_queued(10)
     where invoice_id = '8e000000-0000-4000-8000-0000000000f9';
    if v_n <> 0 then
      raise exception 'OB9 FAIL: factura a fost revendicată cu bonul în %, mențiunea s-ar pierde pentru totdeauna', v_st; end if;
  end loop;
  select status::text into v_st from public.invoices where id = '8e000000-0000-4000-8000-0000000000f9';
  if v_st <> 'queued' then
    raise exception 'OB9 FAIL: factura amânată nu mai e queued (%)', v_st; end if;

  -- success cu bon → se revendică, cu bonul.
  update public.pending_receipts
     set status = 'success', bon_number = '0077',
         claimed_at = '2026-03-12 21:02:00+02', completed_at = '2026-03-12 21:02:30+02'
   where id = '8e000000-0000-4000-8000-0000000000e9';
  select receipt_bon_number into v_bon from public.bridge_oblio_get_queued(10)
   where invoice_id = '8e000000-0000-4000-8000-0000000000f9';
  if v_bon is distinct from '0077' then
    raise exception 'OB9 FAIL: după success factura nu iese cu bonul (%)', v_bon; end if;

  -- cancelled (fără bon) → NU e în tranzit: se revendică fără mențiune.
  update public.pending_receipts set status = 'cancelled'
   where id = '8e000000-0000-4000-8000-0000000000ea';
  select count(*), max(receipt_bon_number) into v_n, v_bon from public.bridge_oblio_get_queued(10)
   where invoice_id = '8e000000-0000-4000-8000-0000000000fa';
  if v_n <> 1 or v_bon is not null then
    raise exception 'OB9 FAIL: bon cancelled → factura ar trebui revendicată fără mențiune (n=%, bon=%)', v_n, v_bon; end if;
  raise notice 'OB9 OK: pending/sent/error amână factura; success o eliberează cu bon, cancelled fără';
end $$;

rollback;
