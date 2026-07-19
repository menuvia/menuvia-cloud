-- mig 238 — vat_report_daily: aplică reducerea la nivel de comandă (discount_amount)
-- ─────────────────────────────────────────────────────────────────────
-- Bug fiscal (re-audit săpt. 10): view-ul (mig 028→029→125→150) sumează
-- `oi.item_total` BRUT (pre-discount), dar clientul plătește post-discount
-- (mig 031: orders.total = subtotal − discount_amount; Happy Hour mig 077
-- scrie automat discount_amount). Rezultatul: raportul TVA SUPRADECLARĂ brut
-- + TVA față de bonul fiscal și de factura Oblio la ORICE comandă cu reducere
-- — restaurantul ar plăti mai mult TVA la ANAF decât a încasat.
--
-- Fix: scalăm fiecare linie cu factorul de discount al comenzii
-- (order.total / subtotal), EXACT ca oblio-generator.js (liniile 244–263) —
-- ca raportul să corespundă la leu cu facturile emise. Reducerea e distribuită
-- PROPORȚIONAL peste grupele de TVA (share-ul fiecărei linii din subtotal).
--
-- Lanț view: 028→029→125→150→238. Se păstrează TOT: security_invoker=true
-- (mig 125), predicatul fiscal_receipt (mig 150, gate Plan 3), grant select.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

create or replace view public.vat_report_daily
with (security_invoker = true) as
  WITH order_sub AS (
    SELECT oi2.order_id, sum(oi2.item_total) AS subtotal
      FROM order_items oi2
     GROUP BY oi2.order_id
  )
  SELECT o.restaurant_id,
     date_trunc('day'::text, o.paid_at)::date AS report_date,
     COALESCE(p.vat_group::integer, 1) AS vat_group,
     COALESCE(vr.rate_percent, 0::numeric) AS vat_rate_percent,
     COALESCE(vr.label, '?'::text) AS vat_label,
     count(DISTINCT o.id) AS orders_count,
     -- Fiecare linie scalată cu factorul de discount al comenzii
     -- (o.total / subtotal). Fallback la 1 (fără discount) când subtotalul e
     -- 0 sau totalul lipsește. GROSS post-discount = ce s-a încasat efectiv.
     sum(oi.item_total * COALESCE(o.total / NULLIF(os.subtotal, 0), 1)) AS gross_total,
     sum(oi.item_total * COALESCE(o.total / NULLIF(os.subtotal, 0), 1)
         * (COALESCE(vr.rate_percent, 0::numeric) / (100.0 + COALESCE(vr.rate_percent, 0::numeric)))) AS vat_amount,
     sum(oi.item_total * COALESCE(o.total / NULLIF(os.subtotal, 0), 1)
         * (100.0 / (100.0 + COALESCE(vr.rate_percent, 0::numeric)))) AS net_total
    FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN order_sub os ON os.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN vat_rates vr ON vr.restaurant_id = o.restaurant_id AND vr.vat_group = COALESCE(p.vat_group::integer, 1)
   WHERE o.status = 'paid'::order_status
     AND o.paid_at IS NOT NULL
     AND public.restaurant_has_feature(o.restaurant_id, 'fiscal_receipt')  -- #6 (mig 150): gate Plan 3
   GROUP BY o.restaurant_id, (date_trunc('day'::text, o.paid_at)::date), (COALESCE(p.vat_group::integer, 1)), (COALESCE(vr.rate_percent, 0::numeric)), (COALESCE(vr.label, '?'::text));

grant select on public.vat_report_daily to authenticated;

-- ── Asserții fail-closed ─────────────────────────────────────────────
do $$
declare v_def text;
begin
  v_def := pg_get_viewdef('public.vat_report_daily'::regclass, true);
  -- factorul de discount aplicat (o.total / subtotal)
  if v_def not ilike '%NULLIF%' or v_def not ilike '%subtotal%' then
    raise exception 'mig 238: factorul de discount lipsește din vat_report_daily';
  end if;
  -- gate fiscal (mig 150) păstrat
  if v_def not ilike '%restaurant_has_feature%' or v_def not ilike '%fiscal_receipt%' then
    raise exception 'mig 238: predicatul fiscal_receipt s-a pierdut din vat_report_daily';
  end if;
  -- security_invoker (mig 125) păstrat
  if not exists (
    select 1 from pg_class c
     where c.oid = 'public.vat_report_daily'::regclass
       and coalesce(c.reloptions::text, '') like '%security_invoker=true%'
  ) then
    raise exception 'mig 238: vat_report_daily și-a pierdut security_invoker=true';
  end if;
  raise notice 'mig 238: vat_report_daily aplică discount-ul de comandă OK';
end $$;

commit;
