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

rollback;
