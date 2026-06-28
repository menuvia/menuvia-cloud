-- mig 150 — vat_report_daily: gate Plan 3 (fiscal_receipt) în predicat (#6)
-- ─────────────────────────────────────────────────────────────────────
-- Auditul round-4 (#6). View-ul `vat_report_daily` (mig 028/029) expune venit + TVA pe
-- zi/grupă. Mig 125 a închis leak-ul cross-tenant (security_invoker=true), dar view-ul
-- rămânea vizibil pentru ORICE plan: un owner pe Plan 1/2 (fără fiscal_receipt) putea citi
-- raportul TVA al propriului restaurant — date care există doar pentru Plan 3 (regula de aur:
-- bon fiscal + TVA = Plan 3). Cross-consum coerent cu report_by_* (mig 122) care deja
-- gate-uiește pe fiscal_receipt.
--
-- B2 (decizie review): NU revocăm view-ul — `VatReportTab.tsx` îl citește direct (nu există
-- RPC wrapper); un revoke ar goli raportul și pe Plan 3 legitim. În schimb adăugăm predicatul
-- de plan în WHERE: `restaurant_has_feature(o.restaurant_id,'fiscal_receipt')`. Pe Plan 3 →
-- raport complet; pe Plan 1/2 → zero rânduri. Păstrăm security_invoker=true + grant.
--
-- În plus: flip `plan_features.reports_vat=false` pe free/starter/growth — DOAR pentru UI
-- (features.has('reports_vat') ascunde tab-ul). Gate-ul canonic e predicatul din view.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── 1. Recreare view cu predicat fiscal (proiecție IDENTICĂ) ─────────────────
create or replace view public.vat_report_daily
with (security_invoker = true) as
  SELECT o.restaurant_id,
     date_trunc('day'::text, o.paid_at)::date AS report_date,
     COALESCE(p.vat_group::integer, 1) AS vat_group,
     COALESCE(vr.rate_percent, 0::numeric) AS vat_rate_percent,
     COALESCE(vr.label, '?'::text) AS vat_label,
     count(DISTINCT o.id) AS orders_count,
     sum(oi.item_total) AS gross_total,
     sum(oi.item_total * (COALESCE(vr.rate_percent, 0::numeric) / (100.0 + COALESCE(vr.rate_percent, 0::numeric)))) AS vat_amount,
     sum(oi.item_total * (100.0 / (100.0 + COALESCE(vr.rate_percent, 0::numeric)))) AS net_total
    FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN vat_rates vr ON vr.restaurant_id = o.restaurant_id AND vr.vat_group = COALESCE(p.vat_group::integer, 1)
   WHERE o.status = 'paid'::order_status
     AND o.paid_at IS NOT NULL
     AND public.restaurant_has_feature(o.restaurant_id, 'fiscal_receipt')  -- #6 (mig 150): gate Plan 3
   GROUP BY o.restaurant_id, (date_trunc('day'::text, o.paid_at)::date), (COALESCE(p.vat_group::integer, 1)), (COALESCE(vr.rate_percent, 0::numeric)), (COALESCE(vr.label, '?'::text));

grant select on public.vat_report_daily to authenticated;

-- ── 2. UI: ascunde tab-ul TVA sub Plan 3 (gate canonic rămâne predicatul de mai sus) ──
update public.plan_features
   set enabled = false
 where feature = 'reports_vat'
   and plan in ('free', 'starter', 'growth');

-- ── Asserții fail-closed ─────────────────────────────────────────────────────
do $$
declare
  v_def text;
  v_si  boolean;
begin
  select pg_get_viewdef('public.vat_report_daily'::regclass, true) into v_def;
  if position('restaurant_has_feature' in v_def) = 0 then
    raise exception 'mig 150: predicatul fiscal_receipt lipsește din vat_report_daily';
  end if;

  -- security_invoker păstrat
  select c.reloptions::text like '%security_invoker=true%' into v_si
    from pg_class c where c.oid = 'public.vat_report_daily'::regclass;
  if not coalesce(v_si, false) then
    raise exception 'mig 150: vat_report_daily nu mai are security_invoker=true';
  end if;

  if exists (select 1 from public.plan_features
              where feature='reports_vat' and plan='growth' and enabled) then
    raise exception 'mig 150: reports_vat încă enabled pe growth (UI)';
  end if;

  raise notice 'mig 150: vat_report_daily gate fiscal_receipt (#6) + reports_vat UI flip OK';
end $$;

commit;
