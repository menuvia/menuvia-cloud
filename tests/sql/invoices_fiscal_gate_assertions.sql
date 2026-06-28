-- ═══════════════════════════════════════════════════════════════
-- Facturi Oblio — gate fiscal Plan 3 (mig 158 + 159, P0 round-5)
-- ═══════════════════════════════════════════════════════════════
--   INV1 — INSERT invoices pe Plan 2 (growth) → respins (fiscal_receipt); pe pro → OK;
--   INV2 — INSERT oblio_configs pe growth → respins; pe pro → OK;
--   ANA1 — analytics views (pro) au rânduri; după downgrade la growth → 0 rânduri;
--   INV3 — cancel_invoice pe restaurant downgradat la growth → respins (fiscal_receipt).
-- ═══════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

begin;

do $$
declare
  v_pro  uuid := 'a1111111-2222-3333-4444-555555555501'::uuid;
  v_grw  uuid := 'a1111111-2222-3333-4444-555555555502'::uuid;
  v_rp   uuid := 'a1111111-2222-3333-4444-5555555555a1'::uuid;
  v_rg   uuid := 'a1111111-2222-3333-4444-5555555555a2'::uuid;
  v_pid  uuid;
  v_op   uuid := 'a1111111-2222-3333-4444-5555555555b1'::uuid;  -- paid order pe pro
  v_og   uuid := 'a1111111-2222-3333-4444-5555555555b2'::uuid;  -- order pe growth
  v_inv  uuid := 'a1111111-2222-3333-4444-5555555555c1'::uuid;  -- issued invoice pe pro
  v_blocked boolean;
  v_rows int;
begin
  insert into auth.users (id, email) values (v_pro,'inv-pro@menuvia.ro'),(v_grw,'inv-grw@menuvia.ro');
  update public.profiles set plan='pro' where id=v_pro;
  update public.profiles set plan='growth' where id=v_grw;
  insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
    (v_rp, v_pro, 'Inv Pro', 'inv-pro-slug', 'Cluj', true),
    (v_rg, v_grw, 'Inv Grw', 'inv-grw-slug', 'Cluj', true);
  insert into public.products (restaurant_id, category_id, name, price, is_active)
    values (v_rp, null, 'Produs', 50.00, true) returning id into v_pid;

  -- comandă paid pe pro (+ item) pentru analytics + factură
  insert into public.orders (id, restaurant_id, source, status, total, paid_amount, payment_method, paid_at, created_by, served_by, paid_by)
    values (v_op, v_rp, 'waiter', 'paid', 50.00, 50.00, 'cash', now(), v_pro, v_pro, v_pro);
  insert into public.order_items (order_id, product_id, product_name_snapshot, unit_price_snapshot, quantity, item_total)
    values (v_op, v_pid, 'Produs', 50.00, 1, 50.00);
  -- order pe growth (status new) — doar ca FK target pentru INV1
  insert into public.orders (id, restaurant_id, source, status, total)
    values (v_og, v_rg, 'waiter', 'new', 0);

  -- factură emisă pe pro (trece gate-ul, RP=pro) — pentru INV3
  insert into public.invoices (id, restaurant_id, order_id, customer_name, total_with_vat, status)
    values (v_inv, v_rp, v_op, 'Client SRL', 50.00, 'issued');

  -- ─── INV1: INSERT invoices pe growth → respins ─────────────────
  v_blocked := false;
  begin
    insert into public.invoices (restaurant_id, order_id, customer_name, total_with_vat)
      values (v_rg, v_og, 'X', 10.00);
  exception when others then
    if sqlerrm like '%fiscal_receipt%' then v_blocked := true; end if;
  end;
  if not v_blocked then raise exception 'INV1 FAIL: factură creată pe Plan 2 (gate fiscal lipsă)'; end if;
  raise notice 'INV1 PASS: INSERT invoices respins pe growth, acceptat pe pro';

  -- ─── INV2: oblio_configs growth → respins; pro → OK ────────────
  v_blocked := false;
  begin
    insert into public.oblio_configs (restaurant_id, api_email, api_secret, company_cif, company_name)
      values (v_rg, 'a@b.ro', 'sec', 'RO123', 'Co');
  exception when others then
    if sqlerrm like '%fiscal_receipt%' then v_blocked := true; end if;
  end;
  if not v_blocked then raise exception 'INV2 FAIL: oblio_configs scris pe Plan 2'; end if;
  insert into public.oblio_configs (restaurant_id, api_email, api_secret, company_cif, company_name)
    values (v_rp, 'a@b.ro', 'sec', 'RO123', 'Co');
  raise notice 'INV2 PASS: oblio_configs respins pe growth, acceptat pe pro';

  -- ─── ANA1a: analytics views au rânduri pe pro ──────────────────
  select count(*) into v_rows from public.v_daily_orders where restaurant_id = v_rp;
  if v_rows < 1 then raise exception 'ANA1 FAIL: v_daily_orders gol pe pro'; end if;
  select count(*) into v_rows from public.v_product_performance where restaurant_id = v_rp;
  if v_rows < 1 then raise exception 'ANA1 FAIL: v_product_performance gol pe pro'; end if;
  raise notice 'ANA1a PASS: analytics views au rânduri pe pro';

  -- ─── downgrade pro→growth ──────────────────────────────────────
  update public.profiles set plan='growth' where id=v_pro;

  -- ─── ANA1b: analytics views goale pe growth ────────────────────
  select count(*) into v_rows from public.v_daily_orders where restaurant_id = v_rp;
  if v_rows <> 0 then raise exception 'ANA1 FAIL: v_daily_orders încă vizibil pe growth (% rânduri)', v_rows; end if;
  select count(*) into v_rows from public.v_product_performance where restaurant_id = v_rp;
  if v_rows <> 0 then raise exception 'ANA1 FAIL: v_product_performance vizibil pe growth'; end if;
  select count(*) into v_rows from public.v_waiter_performance where restaurant_id = v_rp;
  if v_rows <> 0 then raise exception 'ANA1 FAIL: v_waiter_performance vizibil pe growth'; end if;
  raise notice 'ANA1b PASS: analytics views goale după downgrade (gate fiscal)';

  -- ─── INV3: cancel_invoice pe restaurant growth → respins ───────
  perform set_config('request.jwt.claim.sub', v_pro::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  v_blocked := false;
  begin
    perform public.cancel_invoice(v_inv, 'test');
  exception when others then
    if sqlerrm like '%fiscal_receipt%' then v_blocked := true; end if;
  end;
  if not v_blocked then raise exception 'INV3 FAIL: cancel_invoice permis pe Plan 2'; end if;
  raise notice 'INV3 PASS: cancel_invoice respins pe growth (gate fiscal)';

  raise notice 'ALL PASS';
end$$;

rollback;
