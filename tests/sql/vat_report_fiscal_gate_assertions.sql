-- ═══════════════════════════════════════════════════════════════
-- vat_report_daily — asserțiuni pentru gate fiscal (mig 150, #6)
-- ═══════════════════════════════════════════════════════════════
--   VT1 — restaurant pro cu comandă paid → vat_report_daily are rânduri;
--   VT2 — după downgrade la growth → vat_report_daily are 0 rânduri (predicat);
--   VT3 — reports_vat dezactivat pe growth în plan_features (UI).
-- Rulat ca superuser (RLS bypass) — testăm strict predicatul de plan din view.
-- ═══════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

begin;

do $$
declare
  v_pro   uuid := '61111111-2222-3333-4444-555555555501'::uuid;
  v_rp    uuid := '61111111-2222-3333-4444-5555555555a1'::uuid;
  v_pid   uuid;
  v_oid   uuid := '61111111-2222-3333-4444-5555555555b1'::uuid;
  v_rows  int;
begin
  insert into auth.users (id, email) values (v_pro, 'vat-pro@menuvia.ro');
  update public.profiles set plan = 'pro' where id = v_pro;
  insert into public.restaurants (id, owner_id, name, slug, city, is_active)
    values (v_rp, v_pro, 'VAT Pro R', 'vat-pro-slug', 'Cluj', true);
  insert into public.products (restaurant_id, category_id, name, price, is_active)
    values (v_rp, null, 'Produs', 50.00, true) returning id into v_pid;

  -- comandă paid (pe pro trece gate-ul fiscal mig 124) + un item
  insert into public.orders (id, restaurant_id, source, status, total, paid_at, paid_amount, payment_method)
    values (v_oid, v_rp, 'waiter', 'paid', 50.00, now(), 50.00, 'cash');
  insert into public.order_items (order_id, product_id, product_name_snapshot, unit_price_snapshot, quantity, item_total)
    values (v_oid, v_pid, 'Produs', 50.00, 1, 50.00);

  -- ─── VT1: pro → rânduri prezente ───────────────────────────────
  select count(*) into v_rows from public.vat_report_daily where restaurant_id = v_rp;
  if v_rows < 1 then
    raise exception 'VT1 FAIL: vat_report_daily gol pentru restaurant pro (% rânduri)', v_rows;
  end if;
  raise notice 'VT1 PASS: vat_report_daily are % rânduri pe pro', v_rows;

  -- ─── VT2: downgrade growth → 0 rânduri ─────────────────────────
  update public.profiles set plan = 'growth' where id = v_pro;
  select count(*) into v_rows from public.vat_report_daily where restaurant_id = v_rp;
  if v_rows <> 0 then
    raise exception 'VT2 FAIL: vat_report_daily încă vizibil pe growth (% rânduri)', v_rows;
  end if;
  raise notice 'VT2 PASS: vat_report_daily gol pe growth (predicat fiscal_receipt)';

  -- ─── VT3: reports_vat dezactivat pe growth (UI) ────────────────
  if exists (select 1 from public.plan_features
              where feature='reports_vat' and plan='growth' and enabled) then
    raise exception 'VT3 FAIL: reports_vat încă enabled pe growth';
  end if;
  raise notice 'VT3 PASS: reports_vat dezactivat pe growth (UI)';

  raise notice 'ALL PASS';
end$$;

rollback;
