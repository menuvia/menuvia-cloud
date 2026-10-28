-- tests/sql/money_exactness_assertions.sql
-- =============================================================================
-- Aserții permanente pentru mig 291 (A10 „money-exactness"). Self-contained,
-- ROLLBACK la final.
--
--   BF-3 (egalitate exactă pe cenți, în loc de ±0,01):
--   MX1  parțial 50,00 + mark_paid 49,99 pe un total de 100,00 → `underpayment`
--        (înainte: comandă `paid` cu 99,99 → B3 din build_fiscalnet_payload
--        refuză payload-ul → bon imposibil); 50,01 → `overpayment`; restul
--        EXACT trece, iar bonul se POATE construi (control pozitiv).
--   MX2  add_partial_payment 50,00 + 50,01 → `overpayment` (înainte 100,01 paid);
--        50,00 + 50,00 → paid, bonul se poate construi.
--   MX3  ramura FĂRĂ parțiale: 99,99 → `underpayment`, 100,01 → `overpayment`;
--        zgomotul de float al clientului (100.09999999999999 + bacșiș 5.05)
--        TRECE — suma netă se rotunjește la cent, nu se respinge.
--   BF-7 (reducerea nu se mișcă peste bani încasați):
--   MX4  apply/remove_order_discount peste o plată parțială → `discount_over_payments`,
--        totalul comenzii neatins.
--   MX5  apply_order_discount pe o comandă `closed` → respins.
--   MX6  table_payments vii (created/processing/failed cu intent, proaspete) blochează
--        reducerea (`discount_online_payment`); canceled/succeeded/failed fără
--        intent NU (control pozitiv: fără plăți reducerea trece și se scoate).
--   MX8  TTL de 15 min (pe `updated_at`) pentru created/failed-cu-intent: un
--        „Plătește online” abandonat NU blochează reducerea pe veci; proaspăt
--        blochează (control pozitiv), `processing` blochează la orice vârstă.
--   MX7  clichet structural: `for update`, `closed`, `pg_temp` în search_path,
--        fără `0.01` în advance_order/add_partial_payment.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('91000000-0000-4000-8000-000000000001','mx-pro@mx.test'),
  ('91000000-0000-4000-8000-000000000002','mx-growth@mx.test');
update public.profiles set plan='pro'    where id='91000000-0000-4000-8000-000000000001';
update public.profiles set plan='growth' where id='91000000-0000-4000-8000-000000000002';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('91b00000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','MX Pro','mx-pro','Cluj',true),
  ('91b00000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000002','MX Growth','mx-growth','Cluj',true);

insert into public.categories (id, restaurant_id, name) values
  ('91c00000-0000-4000-8000-000000000001','91b00000-0000-4000-8000-000000000001','MX Cat'),
  ('91c00000-0000-4000-8000-000000000002','91b00000-0000-4000-8000-000000000002','MX Cat G');
insert into public.products (id, restaurant_id, category_id, name, price, vat_group, is_active, is_draft) values
  ('91d00000-0000-4000-8000-000000000001','91b00000-0000-4000-8000-000000000001',
   '91c00000-0000-4000-8000-000000000001','MX Cafea',100,1,true,false),
  ('91d00000-0000-4000-8000-000000000002','91b00000-0000-4000-8000-000000000002',
   '91c00000-0000-4000-8000-000000000002','MX Cafea G',100,1,true,false);

insert into public.tables (id, restaurant_id, name, slug, seats, is_active) values
  ('91a00000-0000-4000-8000-000000000001','91b00000-0000-4000-8000-000000000001','Masa MX','masa-mx',4,true);
insert into public.table_sessions (id, restaurant_id, table_id, status) values
  ('91e00000-0000-4000-8000-000000000001','91b00000-0000-4000-8000-000000000001',
   '91a00000-0000-4000-8000-000000000001','open');

select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001', true);

-- ── MX1: parțial + mark_paid cu rest NE-exact → respins; restul exact trece ──
do $$
declare v_o uuid := '91f00000-0000-4000-8000-000000000001'; v_hint text; v_status text;
        v_payload text; v_sum numeric;
begin
  insert into public.orders (id, restaurant_id, source, status, total)
    values (v_o, '91b00000-0000-4000-8000-000000000001', 'waiter', 'served', 100);
  insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
    values (v_o, '91d00000-0000-4000-8000-000000000001', 'MX Cafea', 1, 100, 100);
  insert into public.order_payments (order_id, amount, method, paid_by)
    values (v_o, 50, 'cash', '91000000-0000-4000-8000-000000000001');

  v_hint := null;
  begin
    perform public.advance_order(v_o, 'mark_paid', 49.99, 'cash', 0, null);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'underpayment' then
    raise exception 'MX1 FAIL: 50,00 + 49,99 pe 100,00 nu a fost respins cu underpayment (hint=%)', v_hint; end if;

  v_hint := null;
  begin
    perform public.advance_order(v_o, 'mark_paid', 50.01, 'cash', 0, null);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'overpayment' then
    raise exception 'MX1 FAIL: 50,00 + 50,01 pe 100,00 nu a fost respins cu overpayment (hint=%)', v_hint; end if;

  select status::text into v_status from public.orders where id = v_o;
  if v_status <> 'served' then
    raise exception 'MX1 FAIL: comanda a trecut în % după refuzuri', v_status; end if;

  -- Control pozitiv: restul EXACT (50,00) + bacșiș; bonul se poate construi.
  perform public.advance_order(v_o, 'mark_paid', 55, 'cash', 5, null);
  select coalesce(sum(amount),0) into v_sum from public.order_payments where order_id = v_o;
  if v_sum <> 100 or (select status::text from public.orders where id = v_o) <> 'paid' then
    raise exception 'MX1 FAIL: plata exactă nu a închis nota la 100 (sum=%)', v_sum; end if;
  v_payload := public.build_fiscalnet_payload(v_o);
  if v_payload is null or length(v_payload) = 0 then
    raise exception 'MX1 FAIL: bonul nu se poate construi pe o comandă plătită exact'; end if;
  raise notice 'MX1 OK: 49,99 → underpayment, 50,01 → overpayment, restul exact trece și bonul se construiește';
end $$;

-- ── MX2: add_partial_payment — plafon exact ──────────────────────────────────
do $$
declare v_o uuid := '91f00000-0000-4000-8000-000000000002'; v_hint text; v_sum numeric;
        v_status text; v_payload text;
begin
  insert into public.orders (id, restaurant_id, source, status, total)
    values (v_o, '91b00000-0000-4000-8000-000000000001', 'waiter', 'served', 100);
  insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
    values (v_o, '91d00000-0000-4000-8000-000000000001', 'MX Cafea', 1, 100, 100);

  perform public.add_partial_payment(v_o, 50, 'cash');

  v_hint := null;
  begin
    perform public.add_partial_payment(v_o, 50.01, 'cash');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'overpayment' then
    raise exception 'MX2 FAIL: 50,00 + 50,01 pe 100,00 nu a fost respins cu overpayment (hint=%)', v_hint; end if;
  select coalesce(sum(amount),0), max((select status::text from public.orders where id = v_o))
    into v_sum, v_status from public.order_payments where order_id = v_o;
  if v_sum <> 50 or v_status <> 'served' then
    raise exception 'MX2 FAIL: după refuz sum=% status=% (așteptat 50 / served)', v_sum, v_status; end if;

  -- Control pozitiv: 50,00 exact închide nota, iar bonul se poate construi.
  perform public.add_partial_payment(v_o, 50, 'card_pos');
  select status::text into v_status from public.orders where id = v_o;
  if v_status <> 'paid' then
    raise exception 'MX2 FAIL: 50 + 50 nu a trecut comanda în paid (%)', v_status; end if;
  v_payload := public.build_fiscalnet_payload(v_o);
  if v_payload is null or length(v_payload) = 0 then
    raise exception 'MX2 FAIL: bonul nu se poate construi'; end if;
  raise notice 'MX2 OK: partial 50,01 peste 50,00 respins; 50 + 50 → paid cu bon construibil';
end $$;

-- ── MX3: ramura fără parțiale — praguri exacte + zgomot de float ─────────────
do $$
declare v_o uuid := '91f00000-0000-4000-8000-000000000003'; v_hint text;
        v_o2 uuid := '91f00000-0000-4000-8000-000000000004'; v_paid numeric; v_payload text;
begin
  insert into public.orders (id, restaurant_id, source, status, total)
    values (v_o, '91b00000-0000-4000-8000-000000000001', 'waiter', 'served', 100);
  insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
    values (v_o, '91d00000-0000-4000-8000-000000000001', 'MX Cafea', 1, 100, 100);

  v_hint := null;
  begin perform public.advance_order(v_o, 'mark_paid', 99.99, 'cash', 0, null);
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; end;
  if v_hint is distinct from 'underpayment' then
    raise exception 'MX3 FAIL: 99,99 pe 100,00 nu a fost respins cu underpayment (hint=%)', v_hint; end if;

  v_hint := null;
  begin perform public.advance_order(v_o, 'mark_paid', 100.01, 'cash', 0, null);
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; end;
  if v_hint is distinct from 'overpayment' then
    raise exception 'MX3 FAIL: 100,01 pe 100,00 nu a fost respins cu overpayment (hint=%)', v_hint; end if;

  -- Zgomot de float: total 100,10, înmânat 105.14999999999999, bacșiș 5.05 →
  -- nota = 100.09999999999999 → rotunjit 100,10 = total → TREBUIE să treacă.
  insert into public.orders (id, restaurant_id, source, status, total)
    values (v_o2, '91b00000-0000-4000-8000-000000000001', 'waiter', 'served', 100.10);
  insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
    values (v_o2, '91d00000-0000-4000-8000-000000000001', 'MX Cafea', 1, 100.10, 100.10);
  perform public.advance_order(v_o2, 'mark_paid', 105.14999999999999, 'cash', 5.05, null);
  select paid_amount into v_paid from public.orders where id = v_o2;
  if v_paid is distinct from 100.10 then
    raise exception 'MX3 FAIL: paid_amount=% după zgomot de float (așteptat 100,10)', v_paid; end if;
  v_payload := public.build_fiscalnet_payload(v_o2);
  if v_payload is null or length(v_payload) = 0 then
    raise exception 'MX3 FAIL: bonul nu se poate construi după plata cu zgomot de float'; end if;
  raise notice 'MX3 OK: 99,99 / 100,01 respinse; zgomotul de float al clientului nu respinge o plată corectă';
end $$;

-- ── MX4: reducerea peste o plată parțială → respinsă; fără plăți → trece ─────
do $$
declare v_o uuid := '91f00000-0000-4000-8000-000000000005'; v_hint text; v_total numeric;
begin
  insert into public.orders (id, restaurant_id, source, status, total)
    values (v_o, '91b00000-0000-4000-8000-000000000001', 'waiter', 'served', 100);
  insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
    values (v_o, '91d00000-0000-4000-8000-000000000001', 'MX Cafea', 1, 100, 100);

  -- Control pozitiv: FĂRĂ plăți, reducerea trece și se poate scoate.
  perform public.apply_order_discount(v_o, 'percent', 10, 'mx');
  select total into v_total from public.orders where id = v_o;
  if v_total is distinct from 90.00 then
    raise exception 'MX4 FAIL: reducerea de 10%% fără plăți nu a dus totalul la 90 (%)', v_total; end if;
  perform public.remove_order_discount(v_o);
  select total into v_total from public.orders where id = v_o;
  if v_total is distinct from 100.00 then
    raise exception 'MX4 FAIL: scoaterea reducerii nu a readus totalul la 100 (%)', v_total; end if;

  perform public.add_partial_payment(v_o, 40, 'cash');

  v_hint := null;
  begin perform public.apply_order_discount(v_o, 'percent', 10, 'mx');
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; end;
  if v_hint is distinct from 'discount_over_payments' then
    raise exception 'MX4 FAIL: apply peste o plată parțială nu a fost respins (hint=%)', v_hint; end if;

  v_hint := null;
  begin perform public.remove_order_discount(v_o);
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; end;
  if v_hint is distinct from 'discount_over_payments' then
    raise exception 'MX4 FAIL: remove peste o plată parțială nu a fost respins (hint=%)', v_hint; end if;

  select total into v_total from public.orders where id = v_o;
  if v_total is distinct from 100.00 then
    raise exception 'MX4 FAIL: totalul s-a mișcat (%) deși reducerea a fost respinsă', v_total; end if;
  raise notice 'MX4 OK: reducerea peste plată parțială respinsă (apply + remove); fără plăți trece';
end $$;

-- ── MX5: reducerea pe o comandă `closed` → respinsă (growth: closed e permis) ─
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002', true);
do $$
declare v_o uuid := '91f00000-0000-4000-8000-000000000006'; v_msg text; v_total numeric;
begin
  insert into public.orders (id, restaurant_id, source, status, total)
    values (v_o, '91b00000-0000-4000-8000-000000000002', 'waiter', 'served', 100);
  insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
    values (v_o, '91d00000-0000-4000-8000-000000000002', 'MX Cafea G', 1, 100, 100);
  perform public.advance_order(v_o, 'close_order', null, null, null, null);
  if (select status::text from public.orders where id = v_o) <> 'closed' then
    raise exception 'MX5 FAIL (fixtură): comanda growth nu e closed'; end if;

  v_msg := null;
  begin perform public.apply_order_discount(v_o, 'percent', 10, 'mx');
  exception when others then v_msg := sqlerrm; end;
  if v_msg is null or v_msg not like 'Cannot apply discount to a closed order%' then
    raise exception 'MX5 FAIL: apply pe closed nu a fost respins ca terminal (%)', v_msg; end if;
  v_msg := null;
  begin perform public.remove_order_discount(v_o);
  exception when others then v_msg := sqlerrm; end;
  if v_msg is null or v_msg not like 'Cannot remove discount on a closed order%' then
    raise exception 'MX5 FAIL: remove pe closed nu a fost respins ca terminal (%)', v_msg; end if;
  select total into v_total from public.orders where id = v_o;
  if v_total is distinct from 100.00 then
    raise exception 'MX5 FAIL: totalul closed s-a mișcat (%)', v_total; end if;
  raise notice 'MX5 OK: reducerea pe comanda closed e respinsă';
end $$;

-- ── MX6: table_payments vii blochează reducerea ──────────────────────────────
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001', true);
do $$
declare v_o uuid := '91f00000-0000-4000-8000-000000000007'; v_hint text; v_st text;
        v_tp uuid := '91aa0000-0000-4000-8000-000000000001';
        v_total numeric;
begin
  insert into public.orders (id, restaurant_id, source, status, total, session_id)
    values (v_o, '91b00000-0000-4000-8000-000000000001', 'waiter', 'served', 100,
            '91e00000-0000-4000-8000-000000000001');
  insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
    values (v_o, '91d00000-0000-4000-8000-000000000001', 'MX Cafea', 1, 100, 100);

  insert into public.table_payments (id, restaurant_id, session_id, order_ids, amount, status, stripe_payment_intent_id)
    values (v_tp, '91b00000-0000-4000-8000-000000000001', '91e00000-0000-4000-8000-000000000001',
            array[v_o], 100, 'created', null);

  -- stări VII: created, processing, failed CU intent → blochează
  for v_st in select unnest(array['created', 'processing', 'failed']) loop
    update public.table_payments
       set status = v_st,
           stripe_payment_intent_id = case when v_st = 'created' then null else 'pi_mx_' || v_st end
     where id = v_tp;
    v_hint := null;
    begin perform public.apply_order_discount(v_o, 'percent', 10, 'mx');
    exception when others then get stacked diagnostics v_hint = pg_exception_hint; end;
    if v_hint is distinct from 'discount_online_payment' then
      raise exception 'MX6 FAIL: table_payments % nu blochează reducerea (hint=%)', v_st, v_hint; end if;
  end loop;

  -- stări MOARTE: canceled, succeeded, failed fără intent → NU blochează
  for v_st in select unnest(array['canceled', 'succeeded', 'failed-no-intent']) loop
    update public.table_payments
       set status = split_part(v_st, '-', 1),
           stripe_payment_intent_id = case when v_st = 'failed-no-intent' then null else 'pi_mx_done_' || v_st end
     where id = v_tp;
    begin
      perform public.apply_order_discount(v_o, 'percent', 10, 'mx');
      perform public.remove_order_discount(v_o);
    exception when others then
      raise exception 'MX6 FAIL: table_payments % (moartă) blochează reducerea: %', v_st, sqlerrm;
    end;
  end loop;
  select total into v_total from public.orders where id = v_o;
  if v_total is distinct from 100.00 then
    raise exception 'MX6 FAIL: totalul %, așteptat 100 după apply+remove', v_total; end if;
  raise notice 'MX6 OK: created/processing/failed-cu-intent blochează; canceled/succeeded/failed-fără-intent nu';
end $$;

-- ── MX8: plata online ABANDONATĂ nu blochează reducerea pe veci (TTL 15 min) ─
-- Oaspetele apasă „Plătește online”, renunță și plătește cash: rândul rămâne
-- `created` (sau `failed` cu intent după un card refuzat) și nimic nu-l expiră
-- în afară de un begin_* ulterior. Fără TTL, reducerea devenea imposibilă.
-- `processing` rămâne blocant indiferent de vârstă (banii sunt în zbor).
do $$
declare v_o uuid := '91f00000-0000-4000-8000-000000000008'; v_hint text; v_st text;
        v_tp uuid := '91aa0000-0000-4000-8000-000000000008';
        v_total numeric;
begin
  insert into public.orders (id, restaurant_id, source, status, total, session_id)
    values (v_o, '91b00000-0000-4000-8000-000000000001', 'waiter', 'served', 100,
            '91e00000-0000-4000-8000-000000000001');
  insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
    values (v_o, '91d00000-0000-4000-8000-000000000001', 'MX Cafea', 1, 100, 100);
  insert into public.table_payments (id, restaurant_id, session_id, order_ids, amount, status, stripe_payment_intent_id)
    values (v_tp, '91b00000-0000-4000-8000-000000000001', '91e00000-0000-4000-8000-000000000001',
            array[v_o], 100, 'created', null);

  -- control pozitiv: aceleași stări, PROASPETE (2 min) → blochează
  for v_st in select unnest(array['created', 'failed', 'processing']) loop
    update public.table_payments
       set status = v_st,
           stripe_payment_intent_id = case when v_st = 'created' then null else 'pi_mx8_' || v_st end,
           created_at = now() - interval '2 minutes',
           updated_at = now() - interval '2 minutes'
     where id = v_tp;
    v_hint := null;
    begin perform public.apply_order_discount(v_o, 'percent', 10, 'mx8');
    exception when others then get stacked diagnostics v_hint = pg_exception_hint; end;
    if v_hint is distinct from 'discount_online_payment' then
      raise exception 'MX8 FAIL: % proaspăt nu blochează reducerea (hint=%)', v_st, v_hint; end if;
  end loop;

  -- processing VECHI (20 min) → tot blochează
  update public.table_payments
     set status = 'processing', stripe_payment_intent_id = 'pi_mx8_proc_old',
         created_at = now() - interval '20 minutes',
         updated_at = now() - interval '20 minutes'
   where id = v_tp;
  v_hint := null;
  begin perform public.apply_order_discount(v_o, 'percent', 10, 'mx8');
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; end;
  if v_hint is distinct from 'discount_online_payment' then
    raise exception 'MX8 FAIL: processing vechi nu mai blochează reducerea (hint=%)', v_hint; end if;

  -- created / failed-cu-intent ABANDONATE (20 min) → reducerea trece
  for v_st in select unnest(array['created', 'failed']) loop
    update public.table_payments
       set status = v_st,
           stripe_payment_intent_id = case when v_st = 'created' then null else 'pi_mx8_old_' || v_st end,
           created_at = now() - interval '20 minutes',
           updated_at = now() - interval '20 minutes'
     where id = v_tp;
    begin
      perform public.apply_order_discount(v_o, 'percent', 10, 'mx8');
    exception when others then
      raise exception 'MX8 FAIL: % abandonat (20 min) blochează apply: %', v_st, sqlerrm;
    end;
    select total into v_total from public.orders where id = v_o;
    if v_total is distinct from 90.00 then
      raise exception 'MX8 FAIL: după apply pe % abandonat totalul e % (așteptat 90)', v_st, v_total; end if;
    begin
      perform public.remove_order_discount(v_o);
    exception when others then
      raise exception 'MX8 FAIL: % abandonat (20 min) blochează remove: %', v_st, sqlerrm;
    end;
  end loop;

  -- created CU intent atașat recent pe un rând creat demult: activitatea e
  -- updated_at (attach intent îl bumpează), deci blochează.
  update public.table_payments
     set status = 'created', stripe_payment_intent_id = 'pi_mx8_attached',
         created_at = now() - interval '20 minutes',
         updated_at = now() - interval '1 minute'
   where id = v_tp;
  v_hint := null;
  begin perform public.remove_order_discount(v_o);
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; end;
  if v_hint is distinct from 'discount_online_payment' then
    raise exception 'MX8 FAIL: created cu activitate recentă (updated_at) nu blochează (hint=%)', v_hint; end if;

  select total into v_total from public.orders where id = v_o;
  if v_total is distinct from 100.00 then
    raise exception 'MX8 FAIL: totalul final %, așteptat 100', v_total; end if;
  raise notice 'MX8 OK: created/failed abandonate >15 min nu mai blochează; proaspete și processing (orice vârstă) blochează';
end $$;

-- ── MX7: clichet structural ──────────────────────────────────────────────────
do $$
declare v_src text; v_cfg text[]; v_sig text;
begin
  for v_sig in select unnest(array[
      'public.advance_order(uuid, text, numeric, text, numeric, text)',
      'public.add_partial_payment(uuid, numeric, text)',
      'public.apply_order_discount(uuid, text, numeric, text)',
      'public.remove_order_discount(uuid)']) loop
    select prosrc, proconfig into v_src, v_cfg from pg_proc where oid = v_sig::regprocedure;
    if not ('search_path=public, pg_temp' = any (v_cfg)) then
      raise exception 'MX7 FAIL: % fără search_path=public, pg_temp (%)', v_sig, v_cfg; end if;
    if has_function_privilege('anon', v_sig::regprocedure, 'execute') then
      raise exception 'MX7 FAIL: % executabil de anon', v_sig; end if;
    if not has_function_privilege('authenticated', v_sig::regprocedure, 'execute') then
      raise exception 'MX7 FAIL: % nu mai e executabil de authenticated', v_sig; end if;
  end loop;

  select prosrc into v_src from pg_proc
   where oid = 'public.advance_order(uuid, text, numeric, text, numeric, text)'::regprocedure;
  if v_src like '%0.01%' then
    raise exception 'MX7 FAIL: advance_order a reintrodus toleranța 0.01'; end if;
  if v_src not like '%for update of o%' or v_src not like '%cancel_over_payments%'
     or v_src not like '%paid_amount_required%' or v_src not like '%fiscal_plan_requires_payment%'
     or v_src not like '%invalid_payment_method%' or v_src not like '%cancel_reason_required%'
     or v_src not like '%underpayment%' or v_src not like '%overpayment%'
     or v_src not like '%v_final - v_tips%' then
    raise exception 'MX7 FAIL: advance_order a pierdut un invariant din lanțul 270'; end if;

  select prosrc into v_src from pg_proc
   where oid = 'public.add_partial_payment(uuid, numeric, text)'::regprocedure;
  if v_src like '%0.01%' or v_src not like '%meal_voucher%' or v_src not like '%fiscal_receipt%'
     or v_src not like '%''owner'', ''manager'', ''waiter''%' or v_src not like '%::public.payment_method%' then
    raise exception 'MX7 FAIL: add_partial_payment a pierdut un invariant sau are toleranță'; end if;
  if v_src like '%card_online%' and v_src not like '%not in (''cash'', ''card_pos'', ''other'', ''meal_voucher'')%' then
    raise exception 'MX7 FAIL: add_partial_payment acceptă card_online'; end if;

  for v_sig in select unnest(array[
      'public.apply_order_discount(uuid, text, numeric, text)',
      'public.remove_order_discount(uuid)']) loop
    select prosrc into v_src from pg_proc where oid = v_sig::regprocedure;
    if v_src not like '%for update%' or v_src not like '%''closed''%'
       or v_src not like '%discount_over_payments%' or v_src not like '%discount_online_payment%'
       or v_src not like '%interval ''15 minutes''%' then
      raise exception 'MX7 FAIL: % fără for update / closed / gate-uri', v_sig; end if;
  end loop;
  raise notice 'MX7 OK: clichet structural (search_path, grant-uri, invarianți 270, fără 0.01, gate-uri discount)';
end $$;

rollback;
