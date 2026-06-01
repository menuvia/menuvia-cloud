-- ════════════════════════════════════════════════════════════════════════
-- MIGRATION 053 — Hotfix runda 2: B1/B2/B3/B4 din analiza adversarială
-- ════════════════════════════════════════════════════════════════════════
-- Suprascrie `public.build_fiscalnet_payload(uuid)` din migration_052 cu
-- versiunea care închide 4 defecte critice descoperite în atacul pe 052:
--
--  B1 (CRITIC) — toleranța ±1 cent admitea exact erorile de rotunjire
--                pe care guard-ul trebuia să le prindă.
--                ───────────────────────────────────────────────────
--                Aritmetica pe bigint cents este EXACTĂ. Nu există
--                "artefacte numerice" de acumulat. Toleranța ±1 lăsa
--                să treacă bonuri pe care casa fiscală le respinge
--                (ea verifică == strict). Fix: toleranță 0.
--
--  B2 (CRITIC, arhitectural) — P^ era derivat din orders.total, casa
--                              fiscală calculează din liniile MELE.
--                ─────────────────────────────────────────────────────
--                Două surse independente pentru "total după discount":
--                (1) orders.total (calculat de trigger recalc_order_subtotal)
--                (2) SUM(S^ cents) - discount_cents (ce vede casa fiscală
--                    din liniile emise de mine)
--                Dacă cele două diverg (trigger stale, edit manual pe
--                orders.total, race condition la concurrent paid),
--                casa fiscală respinge bonul.
--                Fix: P^ derivat din v_lines_sum_cents (sursa de adevăr
--                e ce emit eu). orders.total devine doar cross-check
--                (RAISE dacă diferă — alarmă de data-quality).
--
--  B3 (CRITIC, decizie de produs) — tips în P^ era fiscal incorect.
--                ─────────────────────────────────────────────────
--                Pe casa fiscală, P^ > SUM(bunuri) înseamnă "sumă tendată"
--                → casa tipărește REST DAT CLIENTULUI. Adică bacșișul era
--                înregistrat ca rest, nu ca venit. Plus: pe card, casa
--                refuză P^ > SUM (nu poți da rest cash la plată card).
--                OUG 8/2023 cere bacșișul declarat ca linie SEPARATĂ pe
--                bon (netaxabilă), nu inclus în P^. Fără spec FiscalNet
--                pentru linia exactă, NU putem implementa linia corect azi.
--                Fix: P^ reflectă DOAR total bunuri post-discount (în cents
--                derivate din liniile emise). orders.tips_amount rămâne
--                în DB pentru contabilitate internă; fiscalizarea ulterioară
--                a bacșișului = problemă separată de produs.
--                ATENȚIE: asta REVERSEAZĂ fix-ul BUG #3 din migration_050.
--                Vechea afirmație "tips nu pe bon = bani neînregistrați"
--                era greșită — bacșișul în România NU intră pe bonul fiscal
--                de bunuri/servicii; e gestionat separat.
--
--  B4 (MINOR) — lifecycle_events.fiscal_drift_fallback se duplica la
--               fiecare apel pentru același order+item.
--               ──────────────────────────────────────────────────
--               Trigger-ul enqueue_fiscal_receipt are idempotency
--               pre-apel, deci în flux normal NU se manifestă. Dar la
--               retry / debug / regenerare manuală, log-ul se umflă.
--               Fix: skip INSERT dacă există deja entry pentru
--               (order_id, item_id, event_type='fiscal_drift_fallback').
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.build_fiscalnet_payload(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order              record;
  v_item               record;
  v_pay                record;
  v_lines              text[] := array[]::text[];
  v_payment_code       smallint;
  v_split_count        integer;
  v_split_sum_cents    bigint := 0;
  v_item_cents         bigint;
  v_unit_cents         bigint;
  v_qty_milli          bigint;
  v_drift              boolean;
  v_lines_sum_cents    bigint := 0;
  v_payments_sum_cents bigint := 0;
  v_discount_cents     bigint := 0;
  v_orders_total_cents bigint;
  v_existing_log       int;
begin
  -- ────────────────────────────────────────────────────────────────────
  -- 1. Header (nu mai citim tips_amount — B3: tips nu intră pe bon)
  -- ────────────────────────────────────────────────────────────────────
  select o.id, o.restaurant_id, o.payment_method,
         o.total, o.discount_amount, o.discount_type, o.discount_value
    into v_order
    from public.orders o
   where o.id = p_order_id;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  v_orders_total_cents := round(v_order.total * 100)::bigint;

  -- ────────────────────────────────────────────────────────────────────
  -- 2. Linii S^ (drift handling + BUG #6 guard pe item_total)
  -- ────────────────────────────────────────────────────────────────────
  for v_item in
    select
      oi.id,
      oi.product_name_snapshot,
      oi.quantity,
      oi.item_total,
      coalesce(vr.fiscalnet_group, coalesce(p.vat_group, 1)) as fn_group
    from public.order_items oi
    left join public.products p on p.id = oi.product_id
    left join public.vat_rates vr on vr.restaurant_id = v_order.restaurant_id
                                  and vr.vat_group = coalesce(p.vat_group, 1)
    where oi.order_id = p_order_id
    order by oi.created_at, oi.id
  loop
    if v_item.item_total is null or v_item.item_total <= 0 then
      raise exception
        'Order %: item % (%) has non-positive total (%) — refused by fiscal payload (BUG #6 guard)',
        p_order_id, v_item.id, v_item.product_name_snapshot, v_item.item_total;
    end if;
    if v_item.quantity is null or v_item.quantity <= 0 then
      raise exception
        'Order %: item % (%) has non-positive quantity (%) — refused (schema check should prevent this)',
        p_order_id, v_item.id, v_item.product_name_snapshot, v_item.quantity;
    end if;

    -- A1 fix (migration_052): drift detection cu fallback qty=1.
    v_item_cents := round(v_item.item_total * 100)::bigint;
    v_drift      := (v_item_cents % v_item.quantity) <> 0;

    if v_drift then
      v_unit_cents := v_item_cents;
      v_qty_milli  := 1000;

      -- B4 fix: idempotency. Skip log dacă există deja entry pentru
      -- (order_id, item_id) și event_type='fiscal_drift_fallback'.
      select count(*) into v_existing_log
        from public.lifecycle_events
       where event_type = 'fiscal_drift_fallback'
         and (event_data->>'order_id')::uuid = p_order_id
         and (event_data->>'item_id')::uuid = v_item.id;

      if v_existing_log = 0 then
        insert into public.lifecycle_events (
          restaurant_id, event_type, event_data
        ) values (
          v_order.restaurant_id,
          'fiscal_drift_fallback',
          jsonb_build_object(
            'order_id',   p_order_id,
            'item_id',    v_item.id,
            'product',    v_item.product_name_snapshot,
            'quantity',   v_item.quantity,
            'item_total', v_item.item_total,
            'item_cents', v_item_cents,
            'reason',     'item_total cents not divisible by quantity',
            'fallback',   'collapsed to qty=1 to preserve fiscal invariant SUM(S^)=P^'
          )
        );
      end if;
    else
      v_unit_cents := v_item_cents / v_item.quantity;
      v_qty_milli  := (v_item.quantity * 1000)::bigint;
    end if;

    v_lines := array_append(v_lines, format(
      'S^%s^%s^%s^buc^%s^1',
      public.fiscalnet_sanitize(v_item.product_name_snapshot),
      v_unit_cents,
      v_qty_milli,
      v_item.fn_group
    ));

    v_lines_sum_cents := v_lines_sum_cents + (v_unit_cents * v_qty_milli / 1000);
  end loop;

  if array_length(v_lines, 1) is null then
    raise exception 'Order % has no items', p_order_id;
  end if;

  -- ────────────────────────────────────────────────────────────────────
  -- 3. ST^ + discount
  -- ────────────────────────────────────────────────────────────────────
  v_lines := array_append(v_lines, 'ST^'::text);

  if v_order.discount_type = 'percent' and v_order.discount_value > 0 then
    v_lines := array_append(v_lines,
      format('DP^%s', round(v_order.discount_value * 100)::bigint));
    v_discount_cents := round(v_lines_sum_cents * v_order.discount_value / 100)::bigint;
    v_lines_sum_cents := v_lines_sum_cents - v_discount_cents;
  elsif v_order.discount_type = 'amount' and v_order.discount_value > 0 then
    v_discount_cents := least(v_lines_sum_cents,
                              round(v_order.discount_value * 100)::bigint);
    v_lines := array_append(v_lines,
      format('DV^%s', v_discount_cents));
    v_lines_sum_cents := v_lines_sum_cents - v_discount_cents;
  end if;

  -- ────────────────────────────────────────────────────────────────────
  -- 4. B2 fix: cross-check orders.total vs v_lines_sum_cents.
  --    Două surse de adevăr pentru "total după discount" — dacă diverg,
  --    trigger-ul recalc_order_subtotal e stale sau cineva a editat
  --    orders.total direct. Toleranță 0 (cents, aritmetica exactă).
  -- ────────────────────────────────────────────────────────────────────
  if v_orders_total_cents <> v_lines_sum_cents then
    raise exception
      'Order %: orders.total cents (%) <> v_lines_sum_cents (%) post-discount — trigger recalc_order_subtotal is stale or orders.total was edited directly (B2 guard).',
      p_order_id, v_orders_total_cents, v_lines_sum_cents;
  end if;

  -- ────────────────────────────────────────────────────────────────────
  -- 5. P^ — derivat din v_lines_sum_cents (B2 fix), fără tips (B3 fix)
  -- ────────────────────────────────────────────────────────────────────
  select count(*), coalesce(sum(amount * 100), 0)::bigint
    into v_split_count, v_split_sum_cents
    from public.order_payments
   where order_id = p_order_id;

  if v_split_count > 0 then
    -- Split invariant (B3 reformulat): SUM(order_payments) = v_lines_sum_cents.
    -- Tips NU intră în split (e gestionat separat de aplicație, în orders.tips_amount).
    -- Aplicațiile care vor să păstreze tips în order_payments trebuie să-l
    -- excludă din rândurile pasate la fiscalizare.
    if v_split_sum_cents <> v_lines_sum_cents then
      raise exception
        'Order %: split payments sum cents (%) <> v_lines_sum_cents (%) — refused. Tips NU intră în order_payments fiscale (B3); verifică ce inserezi în order_payments (A4+B3 split-sum guard).',
        p_order_id, v_split_sum_cents, v_lines_sum_cents;
    end if;

    for v_pay in
      select method, amount
        from public.order_payments
       where order_id = p_order_id
       order by created_at, id
    loop
      v_lines := array_append(v_lines, format(
        'P^%s^%s',
        public.fiscalnet_payment_code(v_pay.method::public.payment_method),
        round(v_pay.amount * 100)::bigint
      ));
      v_payments_sum_cents := v_payments_sum_cents + round(v_pay.amount * 100)::bigint;
    end loop;
  else
    -- Single P^.
    if v_order.payment_method is null then
      raise exception
        'Order %: payment_method is NULL and no order_payments rows — fiscal payload requires explicit payment method (A5 guard).',
        p_order_id;
    end if;

    v_payment_code := public.fiscalnet_payment_code(v_order.payment_method);
    -- B2+B3: P^ = v_lines_sum_cents (sursa de adevăr e ce emit eu, NU
    -- orders.total; tips NU intră — fiscalizare bacșiș = produs separat).
    v_payments_sum_cents := v_lines_sum_cents;
    v_lines := array_append(v_lines,
      format('P^%s^%s', v_payment_code, v_payments_sum_cents));
  end if;

  -- ────────────────────────────────────────────────────────────────────
  -- 6. B1 fix: invariant fiscal REAL cu toleranță ZERO.
  --    SUM(P^ cents) trebuie să EGALEZE SUM(S^ post-discount cents).
  --    (tips a fost scos — B3.) Aritmetica e exactă; orice diferență
  --    indică un bug, nu o aproximare numerică.
  -- ────────────────────────────────────────────────────────────────────
  if v_payments_sum_cents <> v_lines_sum_cents then
    raise exception
      'Order %: fiscal invariant broken — SUM(P^ cents)=% but SUM(S^ post-discount cents)=%. Refused (BUG #7 real guard, B1 tolerance=0).',
      p_order_id, v_payments_sum_cents, v_lines_sum_cents;
  end if;

  return array_to_string(v_lines, E'\n');
end;
$$;

comment on function public.build_fiscalnet_payload(uuid) is
  'Generează payload-ul .txt FiscalNet pentru un order. V6 (migration_053): '
  'fix B1 (tolerance=0), B2 (P^ din v_lines_sum, orders.total doar cross-check), '
  'B3 (tips NU pe bon — REVERSEAZĂ fix BUG #3 din 050 care era fiscal incorect), '
  'B4 (idempotency lifecycle_events). Plus toate fix-urile #1/#2/#4/#6/#7/#A1-A5 '
  'din 050/051/052.';
