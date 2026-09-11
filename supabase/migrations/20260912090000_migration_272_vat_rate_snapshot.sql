-- migration_272_vat_rate_snapshot.sql
-- =============================================================================
-- Audit v3 — RES-20 (medium, fiscal): raportul TVA, payload-ul FiscalNet și
-- factura Oblio citeau cota TVA CURENTĂ a produsului, nu cea de la VÂNZARE.
--
-- MODELUL DE DATE (verificat pe lanț): `products.vat_group` (027) NU e o cotă,
-- e o REFERINȚĂ la grupa 1–4 din `vat_rates` (029), a cărei `rate_percent` e
-- editabilă de owner (VatRatesEditor) și a fost schimbată de lege o dată deja
-- (L.141/2025: 9→11, 19→21 — mig 102 a mutat DOAR default-urile, cotele
-- existente aparțin restaurantului). `order_items` avea snapshot pentru nume și
-- preț (`product_name_snapshot`, `unit_price_snapshot` — mig 003, „so historical
-- orders are not broken by menu edits") dar NU pentru TVA: toate cele trei
-- cititoare re-rezolvau live `order_items → products.vat_group → vat_rates`:
--   • vat_report_daily (028→029→031→125→150→238→253): `vr.rate_percent` LIVE →
--     orice schimbare de cotă sau reclasificare a unui produs RESCRIA tot
--     istoricul raportului, care nu mai corespundea cu bonurile/Z-urile emise;
--   • build_fiscalnet_payload (030→050→051→052→053): `p.vat_group` LIVE la
--     REGENERARE (bridge_retry_receipt 262/270 regenerează payload-ul; INSERT
--     direct 'paid' 259 îl construiește după itemi) → un retry după o
--     reclasificare punea linia în altă grupă a casei decât vânzarea;
--   • oblio-generator.js: `products(vat_group)` + `vat_rates` LIVE la EMITERE —
--     care poate fi la ZILE distanță de încasare (mig 218/239, retry manual).
--
-- CE ENCODEAZĂ FiscalNet pentru TVA (mig 030 + docs/BRIDGE_FISCALNET_ARCHITECTURE):
--   `S^NUME^PRET_BANI^CANT_MII^buc^GRUPA_TVA^1` — GRUPA_TVA e INDEXUL grupei
--   programate ÎN CASĂ (1–5, „setată de instalator: 1=9%, 2=19%"), NU o cotă.
--   Casa aplică cota ei proprie pentru grupă. Deci pe bon snapshot-ul util e
--   GRUPA INTERNĂ a produsului la vânzare (ce a vândut restaurantul), iar
--   maparea grupă-internă → grupă-pe-casă (`vat_rates.fiscalnet_group`) rămâne
--   LIVE: e o configurare de DEVICE (o corecție de instalator trebuie să se
--   aplice și la retry), nu un fapt fiscal. Cota (RATE) e ce cer raportul TVA
--   și Oblio (`vatPercentage` + `vatName`). Snapshot-ul are deci DOUĂ coloane.
--
-- FIX (cea mai mică schimbare care închide clasa, la TOATE căile de scriere):
--   1. `order_items.vat_group_snapshot smallint` + `vat_rate_snapshot numeric(5,2)`.
--   2. Trigger BEFORE INSERT `trg_snapshot_order_item_vat` care le completează
--      din `products.vat_group` + `vat_rates` (pe restaurantul COMENZII) când
--      scriitorul nu le-a dat. Un trigger, nu recrearea RPC-urilor: `create_order`
--      (191) și `update_order_items` (192) inserează cu listă explicită de
--      coloane și rămân NEATINSE; orice scriitor viitor (PostgREST direct sub
--      „admin update delete" FOR ALL, seed-uri) e acoperit la fel (precedent:
--      mig 130). `update_order_items` = DELETE+INSERT → re-snapshot la EDITARE,
--      corect: editarea e permisă doar pe comenzi NE-terminale, fără plăți
--      parțiale — momentul fiscal (bonul) e după.
--   3. Cele trei cititoare preferă snapshot-ul, cu fallback pe cota curentă
--      DOAR pentru rânduri fără snapshot (produs șters înainte de backfill).
--      Forma lui `vat_report_daily` (nume/ordine/tipuri de coloane) e NEATINSĂ —
--      VatReportTab face `select('*')`.
--   4. Backfill: rândurile existente primesc grupa/cota CURENTĂ a produsului —
--      cea mai bună informație disponibilă: `vat_rates` NU are date de intrare
--      în vigoare și NU e auditată (mig 044 auditează orders/products/
--      memberships), deci cota la `orders.created_at` nu e reconstruibilă.
--      Producția a pornit după L.141/2025, deci schimbarea legală nu cade în
--      istoric; rămâne fereastra „restaurant creat înainte de mig 102 cu 9/19,
--      trecut manual pe 11/21 DUPĂ prima vânzare" — verificabilă pe prod cu
--      `vat_rates.updated_at` vs `min(orders.paid_at)` (vezi CLAUDE.md).
--      Backfill-ul rulează cu `order_items_subtotal_sync_upd` DEZACTIVAT
--      per-trigger (mig 248: orice UPDATE pe order_items re-calculează
--      `orders.total` per comandă → UPDATE pe comenzi PLĂTITE → audit + o
--      posibilă „reparare" tăcută a unui total fiscal) și cu audit-ul per rând
--      sărit prin GUC-ul existent `menuvia.skip_item_audit` (mig 081) —
--      migrația e înregistrată în ledger, nu e o acțiune de business.
--
-- Teste permanente VS1–VS9: tests/sql/vat_rate_snapshot_assertions.sql
-- Recuperarea orfanilor (produs șters ÎNAINTE de migrație, deci fără product_id
-- de unde să citim grupa) e un script rulat MANUAL, în afara lanțului:
--   scripts/recover_orphan_vat_snapshots.sql  (sursa: audit_log DELETE pe products)
-- (VS2/VS3/VS4 verificate că PICĂ pe codul de dinainte). Partea JS (Oblio) are
-- teste proprii în tests/functions/oblio-generator.test.js.
-- =============================================================================

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── 1. Coloanele de snapshot ─────────────────────────────────────────────────
alter table public.order_items
  add column if not exists vat_group_snapshot smallint
    check (vat_group_snapshot between 1 and 4),
  add column if not exists vat_rate_snapshot numeric(5,2)
    check (vat_rate_snapshot >= 0 and vat_rate_snapshot <= 100);

comment on column public.order_items.vat_group_snapshot is
  'mig 272: grupa TVA internă (1-4) a produsului la momentul scrierii liniei. NULL doar pe rânduri istorice fără produs (cititorii cad pe grupa curentă).';
comment on column public.order_items.vat_rate_snapshot is
  'mig 272: cota TVA (%) în vigoare pentru grupa de mai sus, pe restaurantul comenzii, la momentul scrierii liniei. Sursa raportului TVA și a facturii Oblio; bonul FiscalNet poartă doar grupa.';

-- ── 2. Trigger BEFORE INSERT: completează snapshot-ul dacă scriitorul nu l-a dat ─
create or replace function public.snapshot_order_item_vat()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_group smallint;
  v_rid   uuid;
begin
  -- Scriitorul poate furniza explicit ambele valori (backfill dirijat, teste
  -- cu rânduri istorice); completăm DOAR ce lipsește.
  if new.vat_group_snapshot is null then
    if new.product_id is null then
      return new;  -- linie fără produs: nimic de snapshot-uit, cititorii cad pe fallback
    end if;
    select p.vat_group into v_group from public.products p where p.id = new.product_id;
    if not found then
      return new;  -- FK-ul semnalează inexistența; nu dublăm eroarea
    end if;
    new.vat_group_snapshot := coalesce(v_group, 1);
  end if;

  if new.vat_rate_snapshot is null then
    -- Cota se citește pe restaurantul COMENZII (vat_rates e per restaurant),
    -- exact cum fac cititorii (`vr.restaurant_id = o.restaurant_id`).
    select o.restaurant_id into v_rid from public.orders o where o.id = new.order_id;
    select vr.rate_percent into new.vat_rate_snapshot
      from public.vat_rates vr
     where vr.restaurant_id = v_rid
       and vr.vat_group     = new.vat_group_snapshot;
    -- grupă neconfigurată → rămâne NULL → cititorii cad pe cota curentă (ca înainte)
  end if;

  return new;
end;
$$;

revoke all on function public.snapshot_order_item_vat() from public, anon, authenticated;

drop trigger if exists trg_snapshot_order_item_vat on public.order_items;
create trigger trg_snapshot_order_item_vat
  before insert on public.order_items
  for each row
  execute function public.snapshot_order_item_vat();

-- ── 3. Backfill: rândurile existente primesc grupa/cota CURENTĂ ─────────────
-- Trigger-ul de sincronizare a subtotalului (mig 248) e dezactivat per-trigger
-- pe durata tranzacției: altfel fiecare comandă atinsă ar primi un UPDATE pe
-- `orders` (audit_orders 044 + gate-urile BEFORE UPDATE), iar un total fiscal
-- deja bonat ar putea fi „reparat" tăcut din liniile curente. Audit-ul per rând
-- (081) e sărit prin GUC-ul lui update_order_items — flag tranzacțional.
alter table public.order_items disable trigger order_items_subtotal_sync_upd;
select set_config('menuvia.skip_item_audit', 'on', true);

do $$
declare v_n bigint;
begin
  update public.order_items oi
     set vat_group_snapshot = s.vat_group,
         vat_rate_snapshot  = s.rate_percent
    from (
      select oi2.id, p.vat_group, vr.rate_percent
        from public.order_items oi2
        join public.orders   o on o.id = oi2.order_id
        join public.products p on p.id = oi2.product_id
        left join public.vat_rates vr
          on vr.restaurant_id = o.restaurant_id
         and vr.vat_group     = p.vat_group
       where oi2.vat_group_snapshot is null
    ) s
   where s.id = oi.id;
  get diagnostics v_n = row_count;
  raise notice 'mig 272: backfill snapshot TVA pe % linii de comandă (grupa/cota curentă a produsului — cea mai bună informație disponibilă)', v_n;
end $$;

alter table public.order_items enable trigger order_items_subtotal_sync_upd;

-- ── 4. build_fiscalnet_payload — lanț 030→050→051→052→053→272 ────────────────
-- Copie VERBATIM a mig 053 (B1 toleranță 0, B2 P^ din liniile emise + cross-check
-- orders.total, B3 fără bacșiș, B4 idempotență lifecycle_events, A1 drift qty=1,
-- guard BUG #6 item_total, A5 payment_method) cu UN delta: grupa internă vine din
-- `oi.vat_group_snapshot` (fallback `p.vat_group`), iar maparea pe casă
-- (`vr.fiscalnet_group`) rămâne LIVE pe acea grupă. `search_path` primește
-- `pg_temp` (igiena mig 262 — funcția o avea prin ALTER, aici o scriem direct).
create or replace function public.build_fiscalnet_payload(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
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
  --    mig 272: grupa internă = snapshot-ul de la vânzare (fallback: produsul
  --    curent, doar pe rânduri istorice fără snapshot); maparea pe casă e LIVE.
  -- ────────────────────────────────────────────────────────────────────
  for v_item in
    select
      oi.id,
      oi.product_name_snapshot,
      oi.quantity,
      oi.item_total,
      coalesce(vr.fiscalnet_group, coalesce(oi.vat_group_snapshot, p.vat_group, 1)) as fn_group
    from public.order_items oi
    left join public.products p on p.id = oi.product_id
    left join public.vat_rates vr on vr.restaurant_id = v_order.restaurant_id
                                  and vr.vat_group = coalesce(oi.vat_group_snapshot, p.vat_group, 1)
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

-- Suprafață identică cu mig 262: helper intern, doar service_role (apelanții
-- reali sunt trigger-ul 259 și RPC-urile DEFINER de retry).
revoke all on function public.build_fiscalnet_payload(uuid) from public, anon, authenticated;
grant execute on function public.build_fiscalnet_payload(uuid) to service_role;

comment on function public.build_fiscalnet_payload(uuid) is
  'Generează payload-ul .txt FiscalNet pentru un order. V7 (mig 272): grupa TVA a liniei vine din order_items.vat_group_snapshot (cota de la VÂNZARE), fallback pe products.vat_group doar pe rânduri istorice; maparea pe casă (vat_rates.fiscalnet_group) rămâne live. Păstrează integral mig 053 (B1–B4, A1–A5, BUG #6/#7).';

-- ── 5. vat_report_daily — lanț 028→029→031→125→150→238→253→272 ──────────────
-- Copie a mig 253 (factorul de discount 238, gate fiscal ca SEMI-JOIN 253,
-- security_invoker 125) cu UN delta: grupa și cota vin din snapshot, cu fallback
-- pe produs/cota curentă DOAR când snapshot-ul lipsește. Eticheta rămâne cea
-- curentă a grupei (cosmetică). Numele, ordinea și TIPURILE coloanelor sunt
-- NEATINSE (`create or replace view` ar respinge altfel).
-- Ziua de raportare e ziua ROMÂNEASCĂ a încasării. Lanțul moștenise
-- `date_trunc('day', o.paid_at)` FĂRĂ conversie, deci se rezolva în TimeZone-ul
-- sesiunii — UTC pe Supabase (verificat pe producție: `current_setting('TimeZone')`
-- = UTC). O încasare la 00:30 ora României pica în ziua PRECEDENTĂ, iar la
-- granița de lună în PERIOADA FISCALĂ precedentă, în timp ce VatReportTab cere
-- intervalul cu `toRomaniaYMD` și `v_daily_payments_by_method` (267) / 
-- `get_daily_payments_by_method` (268) raportau aceeași încasare pe ziua
-- românească — deci raportul de TVA și cel de venit nu puteau reconcilia
-- niciodată pe o lună. Aceeași clasă pe care mig 269 a reparat-o pentru
-- `deliveryDate` la Oblio. Verificat prin mutație: VS10.
create or replace view public.vat_report_daily
with (security_invoker = true) as
  WITH order_sub AS (
    SELECT oi2.order_id, sum(oi2.item_total) AS subtotal
      FROM order_items oi2
     GROUP BY oi2.order_id
  )
  SELECT o.restaurant_id,
     date_trunc('day'::text, (o.paid_at AT TIME ZONE 'Europe/Bucharest'::text))::date AS report_date,
     COALESCE(oi.vat_group_snapshot::integer, p.vat_group::integer, 1) AS vat_group,
     COALESCE(oi.vat_rate_snapshot, vr.rate_percent, 0::numeric) AS vat_rate_percent,
     COALESCE(vr.label, '?'::text) AS vat_label,
     count(DISTINCT o.id) AS orders_count,
     sum(oi.item_total * COALESCE(o.total / NULLIF(os.subtotal, 0), 1)) AS gross_total,
     sum(oi.item_total * COALESCE(o.total / NULLIF(os.subtotal, 0), 1)
         * (COALESCE(oi.vat_rate_snapshot, vr.rate_percent, 0::numeric)
            / (100.0 + COALESCE(oi.vat_rate_snapshot, vr.rate_percent, 0::numeric)))) AS vat_amount,
     sum(oi.item_total * COALESCE(o.total / NULLIF(os.subtotal, 0), 1)
         * (100.0 / (100.0 + COALESCE(oi.vat_rate_snapshot, vr.rate_percent, 0::numeric)))) AS net_total
    FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN order_sub os ON os.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN vat_rates vr ON vr.restaurant_id = o.restaurant_id
                            AND vr.vat_group = COALESCE(oi.vat_group_snapshot::integer, p.vat_group::integer, 1)
   WHERE o.status = 'paid'::order_status
     AND o.paid_at IS NOT NULL
     AND o.restaurant_id IN (SELECT r.id FROM restaurants r
                              WHERE public.restaurant_has_feature(r.id, 'fiscal_receipt'))
   GROUP BY o.restaurant_id, (date_trunc('day'::text, (o.paid_at AT TIME ZONE 'Europe/Bucharest'::text))::date),
            (COALESCE(oi.vat_group_snapshot::integer, p.vat_group::integer, 1)),
            (COALESCE(oi.vat_rate_snapshot, vr.rate_percent, 0::numeric)),
            (COALESCE(vr.label, '?'::text));

grant select on public.vat_report_daily to authenticated;

comment on view public.vat_report_daily is
  'Vânzări grupate per zi + cota TVA pentru raportare contabilă. mig 272: cota e cea de la VÂNZARE (order_items.vat_rate_snapshot), nu cea curentă a grupei; fallback pe cota curentă doar pe rânduri fără snapshot.';

-- ═════════════════════════════════════════════════════════════════════════════
-- Asserții fail-closed
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_def   text;
  v_src   text;
  v_cfg   text[];
  v_sig   text;
  v_type  smallint;
  v_n     int;
  v_cols  text[];
begin
  -- (a) coloanele există, cu CHECK-uri
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'order_items'
         and column_name in ('vat_group_snapshot', 'vat_rate_snapshot')) <> 2 then
    raise exception 'mig 272: coloanele de snapshot lipsesc de pe order_items';
  end if;

  -- (b) trigger BEFORE INSERT ROW (tgtype = ROW 1 + BEFORE 2 + INSERT 4 = 7, EXACT:
  --     un `before insert or update` = 23 ar re-snapshot-ui la UPDATE-uri)
  select tgtype into v_type from pg_trigger
   where tgrelid = 'public.order_items'::regclass and tgname = 'trg_snapshot_order_item_vat' and not tgisinternal;
  if v_type is null then
    raise exception 'mig 272: trg_snapshot_order_item_vat lipsește'; end if;
  if v_type <> 7 then
    raise exception 'mig 272: trg_snapshot_order_item_vat trebuie să fie BEFORE INSERT FOR EACH ROW (tgtype 7, găsit %)', v_type; end if;

  -- (c) trigger-ul de subtotal e RE-activat (backfill-ul nu l-a lăsat oprit)
  if exists (select 1 from pg_trigger
              where tgrelid = 'public.order_items'::regclass
                and tgname = 'order_items_subtotal_sync_upd' and tgenabled = 'D') then
    raise exception 'mig 272: order_items_subtotal_sync_upd a rămas DEZACTIVAT după backfill'; end if;

  -- (d) backfill complet: nicio linie cu produs existent fără snapshot
  --     (vacuu pe replay-ul CI, fără date — verificarea REALĂ e pe prod, vezi
  --     interogarea din CLAUDE.md; aici prinde o regresie de join)
  select count(*) into v_n
    from public.order_items oi join public.products p on p.id = oi.product_id
   where oi.vat_group_snapshot is null;
  if v_n > 0 then
    raise exception 'mig 272: % linii cu produs rămase fără snapshot după backfill', v_n; end if;

  -- (e) vat_report_daily: citește snapshot-ul + păstrează TOT lanțul
  v_def := pg_get_viewdef('public.vat_report_daily'::regclass, true);
  foreach v_sig in array array['vat_rate_snapshot', 'vat_group_snapshot',
                               'NULLIF', 'subtotal', 'restaurant_has_feature', 'fiscal_receipt'] loop
    if v_def not ilike '%' || v_sig || '%' then
      raise exception 'mig 272: vat_report_daily a pierdut „%"', v_sig; end if;
  end loop;
  if not exists (select 1 from pg_class c where c.oid = 'public.vat_report_daily'::regclass
                    and coalesce(c.reloptions::text, '') like '%security_invoker=true%') then
    raise exception 'mig 272: vat_report_daily și-a pierdut security_invoker=true'; end if;
  -- forma de coloane înghețată (VatReportTab: select('*'))
  select array_agg(a.attname::text order by a.attnum) into v_cols
    from pg_attribute a where a.attrelid = 'public.vat_report_daily'::regclass and a.attnum > 0 and not a.attisdropped;
  if v_cols is distinct from array['restaurant_id','report_date','vat_group','vat_rate_percent','vat_label',
                                   'orders_count','gross_total','vat_amount','net_total'] then
    raise exception 'mig 272: forma vat_report_daily s-a schimbat: %', v_cols; end if;

  -- (f) build_fiscalnet_payload: snapshot + invariantele 053 + suprafață 262
  select pg_get_functiondef(p.oid), p.proconfig into v_src, v_cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'build_fiscalnet_payload';
  foreach v_sig in array array['vat_group_snapshot', 'B2 guard', 'B1 tolerance=0', 'A5 guard',
                               'fiscal_drift_fallback', 'BUG #6 guard', 'split-sum guard'] loop
    if position(v_sig in v_src) = 0 then
      raise exception 'mig 272: build_fiscalnet_payload a pierdut „%"', v_sig; end if;
  end loop;
  if position('security definer' in lower(v_src)) = 0 then
    raise exception 'mig 272: build_fiscalnet_payload nu mai e DEFINER'; end if;
  if not (v_cfg @> array['search_path=public, pg_temp']) then
    raise exception 'mig 272: build_fiscalnet_payload fără search_path=public, pg_temp (%)', v_cfg; end if;
  if has_function_privilege('anon', 'public.build_fiscalnet_payload(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.build_fiscalnet_payload(uuid)', 'EXECUTE') then
    raise exception 'mig 272: build_fiscalnet_payload executabil de roluri client (mig 262 regresat)'; end if;
  if not has_function_privilege('service_role', 'public.build_fiscalnet_payload(uuid)', 'EXECUTE') then
    raise exception 'mig 272: service_role nu mai poate executa build_fiscalnet_payload'; end if;

  -- (g) funcția-trigger: DEFINER cu pg_temp, ne-executabilă de roluri client
  select p.proconfig into v_cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'snapshot_order_item_vat';
  if not (v_cfg @> array['search_path=public, pg_temp']) then
    raise exception 'mig 272: snapshot_order_item_vat fără search_path=public, pg_temp'; end if;
  if has_function_privilege('anon', 'public.snapshot_order_item_vat()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.snapshot_order_item_vat()', 'EXECUTE') then
    raise exception 'mig 272: snapshot_order_item_vat executabil de roluri client'; end if;

  raise notice 'mig 272: snapshot TVA la vânzare (order_items) + cititori pe snapshot OK';
end $$;

commit;
