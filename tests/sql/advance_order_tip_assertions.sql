-- ═══════════════════════════════════════════════════════════════
-- advance_order mark_paid — bacșiș pe notă split (mig 214)
-- ═══════════════════════════════════════════════════════════════
-- Self-contained (begin/rollback). Owner enterprise (gate fiscal trece) +
-- comandă 'served' de 200 cu o plată parțială cash de 50. Verifică:
--   AO1 — „Plata integrală" a restului 150 + bacșiș 15 (p_paid_amount=165,
--          p_tips_amount=15) ÎNCHIDE nota (înainte pica fals 'overpayment');
--   AO2 — o supra-încasare REALĂ pe partea de notă (rest fără bacșiș depășește
--          restul datorat) tot e respinsă cu hint='overpayment'.
-- Rulează ca superuser (bootstrap) — auth.uid() nu e setat, deci simulăm prin
-- membership owner; advance_order cere auth.uid(), așa că folosim set_config.
-- ═══════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

begin;

do $$
declare
  v_owner uuid := '61111111-2222-3333-4444-555555555501'::uuid;
  v_rest  uuid := '61111111-2222-3333-4444-555555555502'::uuid;
  v_table uuid := '61111111-2222-3333-4444-555555555503'::uuid;
  v_ord   uuid := '61111111-2222-3333-4444-555555555510'::uuid;
  v_ord2  uuid := '61111111-2222-3333-4444-555555555511'::uuid;
  v_res   jsonb;
  v_hint  text;
begin
  insert into auth.users (id, email) values (v_owner, 'ao-tip@tp.test');
  update public.profiles set plan = 'enterprise' where id = v_owner;
  insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
    (v_rest, v_owner, 'AO Tip', 'ao-tip-slug', 'Cluj', true);
  insert into public.tables (id, restaurant_id, name, slug, seats, is_active) values
    (v_table, v_rest, 'Masa AO', 'masa-ao', 4, true);

  -- auth.uid() = owner-ul, ca advance_order să treacă de authz.
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  -- ── AO1: notă 200, parțial cash 50, restul 150 + bacșiș 15 ──────────────────
  insert into public.orders (id, restaurant_id, source, status, total, table_id) values
    (v_ord, v_rest, 'waiter', 'served', 200, v_table);
  insert into public.order_payments (order_id, amount, method, paid_by) values
    (v_ord, 50, 'cash', v_owner);

  v_res := public.advance_order(v_ord, 'mark_paid', 165, 'cash', 15, null);
  if coalesce((v_res->>'ok')::boolean, false) is not true then
    raise exception 'AO1 FAIL: nota split cu bacșiș nu s-a închis (%)', v_res;
  end if;
  if not exists (select 1 from public.orders where id = v_ord and status = 'paid') then
    raise exception 'AO1 FAIL: comanda nu e paid după plata integrală cu bacșiș';
  end if;
  if not exists (select 1 from public.orders where id = v_ord and tips_amount = 15) then
    raise exception 'AO1 FAIL: bacșișul nu a fost înregistrat';
  end if;

  -- ── AO2: supra-încasare REALĂ pe partea de notă tot respinsă ────────────────
  insert into public.orders (id, restaurant_id, source, status, total, table_id) values
    (v_ord2, v_rest, 'waiter', 'served', 200, v_table);
  insert into public.order_payments (order_id, amount, method, paid_by) values
    (v_ord2, 50, 'cash', v_owner);
  -- rest 200 (fără bacșiș) peste restul datorat de 150 → overpayment
  begin
    perform public.advance_order(v_ord2, 'mark_paid', 200, 'cash', 0, null);
    raise exception 'AO2 FAIL: supra-încasarea reală nu a fost respinsă';
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint <> 'overpayment' then raise; end if;
  end;

  raise notice 'AO1/AO2 OK: bacșișul nu mai dă fals overpayment; supra-încasarea reală rămâne respinsă';
end $$;

rollback;
