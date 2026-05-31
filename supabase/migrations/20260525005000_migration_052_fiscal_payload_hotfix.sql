-- ════════════════════════════════════════════════════════════════════════
-- MIGRATION 052 — Hotfix fiscal payload: drift, false-positives, invariants reale
-- ════════════════════════════════════════════════════════════════════════
-- Suprascrie `public.build_fiscalnet_payload(uuid)` definită în migration_051
-- cu o versiune care corectează defectele descoperite în analiza adversarială
-- post-051:
--
--  A1 (CRITIC) — drift de rotunjire = bonuri respinse de casa fiscală.
--                ────────────────────────────────────────────────────
--                Pentru item cu (item_total*100) % quantity ≠ 0 (ex: 10.00 RON
--                pe 3 buc → 333 cents/buc × 3 = 999 cents ≠ 1000 cents pe P^),
--                casa fiscală respinge bonul la INSERT (SUM linii ≠ P^).
--                Fix: detectez drift per item; dacă există, fallback la
--                qty=1000 (1 buc) cu PRET=item_total*100. Pierdem info de
--                cantitate pe bonul fiscal pentru ITEMUL respectiv, dar
--                bonul rămâne fiscal-valid. Loghez `audit_log` cu
--                operation='fiscal_drift_fallback' pentru transparență
--                owner; restul itemilor cu cantitate divizibilă merg normal.
--
--  A2 (CRITIC) — BUG #6 guard era fals pozitiv pe produse cu modifier obligatoriu.
--                ────────────────────────────────────────────────────────────────
--                În migration_051 verificam ATÂT `unit_price_snapshot <= 0`
--                cât și `item_total <= 0`. Primul respinge un caz legitim:
--                produs cu preț catalog 0 (ex: "Cadou personalizat", combo)
--                care primește valoare prin modifier obligatoriu (item_total > 0).
--                Fix: ELIMIN check pe unit_price_snapshot; păstrez DOAR
--                pe item_total <= 0 (suma efectiv plătită — singurul lucru
--                care contează ANAF). Plus guard nou pe quantity (schema
--                check ar trebui să prindă, dar belt+suspenders).
--
--  A3 (CRITIC) — BUG #7 guard era tautologie (verifica ce trigger-ul calculează).
--                ──────────────────────────────────────────────────────────────
--                Versiunea 051 verifica `SUM(item_total) = total + discount_amount`,
--                dar trigger-ul `recalc_order_subtotal` calculează exact asta.
--                Real invariantul fiscal e: `SUM(S^ cents post-discount) = P^ cents - tips_cents`.
--                Asta-i ce verifică casa fiscală la INSERT bon. Fix: calculez
--                progresiv `v_lines_sum_cents` în timp ce emit liniile S^,
--                apoi `v_payments_sum_cents` în timp ce emit P^, și verific
--                invariantul REAL la final. Drift-ul A1 e absorbit aici
--                (după A1 fix, suma e exactă).
--
--  A4 (CRITIC) — split payment fără invariant SUM = total+tips.
--                ──────────────────────────────────────────────
--                Migration_051 emit P^ per rând din order_payments fără să
--                verifice că suma plăților = total+tips. Casierul putea
--                introduce greșit (ex: cash 30 + card 25 pentru order 50 →
--                declarat 55 dar venit declarat 50 → bani fără bon). Fix:
--                guard pe SUM(order_payments.amount) ≈ total + tips_amount
--                cu toleranță 0.01 RON (rounding artifacts).
--
--  A5 (MAJOR)  — payment_method NULL → P^ malformed.
--                ───────────────────────────────────
--                `orders.payment_method` e nullable. Cu NULL,
--                fiscalnet_payment_code returna NULL → format producea
--                'P^^XXXX' → bon respins. Fix: RAISE early dacă NULL și
--                lipsește split.
--
-- INTERACȚIUNE cu enqueue_fiscal_receipt:
-- Trigger-ul wraps build_fiscalnet_payload în `exception when others`,
-- înregistrând eroarea în `pending_receipts.status='error'`. Asta înseamnă
-- că orice RAISE de mai sus NU blochează marcarea ca paid (UX nu se rupe),
-- dar generează un pending receipt cu eroare vizibilă în Dashboard owner.
--
-- Bug-uri rămase după 050+051+052 (toate feature work, P3):
--   #5 CF^ client CIF (necesită ALTER TABLE invoices + UI checkout)
--   #8 encoding diacritice → Bridge (necesită test contra hardware real)
--   #9 payment_method enum incomplet (necesită ALTER TYPE + mapping cod)
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
  v_total_with_tips    numeric(10,2);
  v_split_count        integer;
  v_split_sum          numeric(10,2);
  v_item_cents         bigint;
  v_unit_cents         bigint;
  v_qty_milli          bigint;
  v_drift              boolean;
  v_lines_sum_cents    bigint := 0;
  v_payments_sum_cents bigint := 0;
  v_tips_cents         bigint;
  v_discount_cents     bigint := 0;
  v_expected_payments  bigint;
begin
  -- ────────────────────────────────────────────────────────────────────
  -- 1. Header
  -- ────────────────────────────────────────────────────────────────────
  select o.id, o.restaurant_id, o.payment_method,
         o.total, o.tips_amount, o.discount_amount,
         o.discount_type, o.discount_value
    into v_order
    from public.orders o
   where o.id = p_order_id;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  v_tips_cents := round(v_order.tips_amount * 100)::bigint;

  -- ────────────────────────────────────────────────────────────────────
  -- 2. Linii S^ (cu drift handling A1 + BUG #6 relaxat A2)
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
    -- A2: refuz DOAR item_total ≤ 0 (suma efectiv plătită). unit_price_snapshot
    -- nu se mai verifică — poate fi 0 legitim la produse cu modifier obligatoriu.
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

    -- A1: detect drift. item_total în cents trebuie divizibil cu quantity ca
    -- PRET_UNITAR*CANT/1000 pe casa fiscală = item_total cents.
    v_item_cents := round(v_item.item_total * 100)::bigint;
    v_drift      := (v_item_cents % v_item.quantity) <> 0;

    if v_drift then
      -- Fallback: 1 linie pentru întregul item_total. Pierdem granularitate
      -- de cantitate pe bonul fiscal pentru ITEMUL ăsta, dar bonul e valid.
      v_unit_cents := v_item_cents;
      v_qty_milli  := 1000;

      -- Log în lifecycle_events pentru transparență owner. NOTĂ: rulează în
      -- aceeași tranzacție cu order paid; dacă tranzacția roll-back-ește
      -- (alt motiv), log-ul se anulează. lifecycle_events.event_type e
      -- free-form (fără CHECK) — alegere intenționată față de audit_log
      -- care e DML-only (INSERT/UPDATE/DELETE).
      insert into public.lifecycle_events (
        restaurant_id, event_type, event_data
      ) values (
        v_order.restaurant_id,
        'fiscal_drift_fallback',
        jsonb_build_object(
          'order_id',     p_order_id,
          'item_id',      v_item.id,
          'product',      v_item.product_name_snapshot,
          'quantity',     v_item.quantity,
          'item_total',   v_item.item_total,
          'item_cents',   v_item_cents,
          'reason',       'item_total cents not divisible by quantity',
          'fallback',     'collapsed to qty=1 to preserve fiscal invariant SUM(S^)=P^'
        )
      );
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

    -- Acumulez în cents EXACT cum face casa fiscală: PRET × CANT / 1000.
    v_lines_sum_cents := v_lines_sum_cents + (v_unit_cents * v_qty_milli / 1000);
  end loop;

  if array_length(v_lines, 1) is null then
    raise exception 'Order % has no items', p_order_id;
  end if;

  -- ────────────────────────────────────────────────────────────────────
  -- 3. ST^ + discount (după ST^, ordine FiscalNet)
  -- ────────────────────────────────────────────────────────────────────
  v_lines := array_append(v_lines, 'ST^'::text);

  if v_order.discount_type = 'percent' and v_order.discount_value > 0 then
    v_lines := array_append(v_lines,
      format('DP^%s', round(v_order.discount_value * 100)::bigint));
    -- Casa fiscală aplică DP^ pe v_lines_sum_cents.
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
  -- 4. P^ — single sau split (cu invariante A4 + A5)
  -- ────────────────────────────────────────────────────────────────────
  select count(*), coalesce(sum(amount), 0)
    into v_split_count, v_split_sum
    from public.order_payments
   where order_id = p_order_id;

  if v_split_count > 0 then
    -- A4: invariant split. Toleranță 0.01 pentru rounding artifacts.
    if abs(v_split_sum - (v_order.total + v_order.tips_amount)) > 0.01 then
      raise exception
        'Order %: split payments sum (%) != total (%) + tips (%) — refused by fiscal payload (A4 split-sum guard).',
        p_order_id, v_split_sum, v_order.total, v_order.tips_amount;
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
    -- A5: single P^ necesită payment_method NOT NULL.
    if v_order.payment_method is null then
      raise exception
        'Order %: payment_method is NULL and no order_payments rows — fiscal payload requires explicit payment method (A5 guard).',
        p_order_id;
    end if;

    v_payment_code := public.fiscalnet_payment_code(v_order.payment_method);
    v_total_with_tips := v_order.total + v_order.tips_amount;
    v_payments_sum_cents := round(v_total_with_tips * 100)::bigint;
    v_lines := array_append(v_lines,
      format('P^%s^%s', v_payment_code, v_payments_sum_cents));
  end if;

  -- ────────────────────────────────────────────────────────────────────
  -- 5. A3: invariant fiscal REAL (post-emit, în cents).
  --    SUM(S^ effective cents) + tips_cents = SUM(P^ cents).
  --    Asta-i ce verifică casa fiscală la INSERT bon.
  --    Toleranță 1 cent pentru artefacte numerice (nu rotunjire reală —
  --    A1 a eliminat asta — ci pentru cumul aritmetic numeric/bigint).
  -- ────────────────────────────────────────────────────────────────────
  v_expected_payments := v_lines_sum_cents + v_tips_cents;
  if abs(v_payments_sum_cents - v_expected_payments) > 1 then
    raise exception
      'Order %: fiscal invariant broken — SUM(P^ cents)=% but SUM(S^ post-discount cents)=% + tips_cents=% → expected %. Refused (BUG #7 real guard).',
      p_order_id, v_payments_sum_cents, v_lines_sum_cents, v_tips_cents, v_expected_payments;
  end if;

  return array_to_string(v_lines, E'\n');
end;
$$;

comment on function public.build_fiscalnet_payload(uuid) is
  'Generează payload-ul .txt FiscalNet pentru un order. V5 (migration_052): '
  'fix A1 (drift rotunjire → fallback qty=1 cu audit_log), A2 (BUG #6 fals '
  'pozitiv relaxat — doar item_total≤0), A3 (BUG #7 invariant REAL post-emit '
  'în cents), A4 (split SUM vs total+tips), A5 (payment_method NULL guard). '
  'Pe lângă fix-urile #1/#2/#3 din migration_050 și #4 din migration_051.';
