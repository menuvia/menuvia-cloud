-- mig 232 — v_daily_orders: coloană voucher_revenue (tichete de masă)
-- ─────────────────────────────────────────────────────────────────────
-- Review adversarial E4b: mig 230/231 fac 'meal_voucher' metodă de plată de
-- prim rang înregistrată de staff (exact pe tier-ul pro/enterprise care vede
-- analytics-ul), dar v_daily_orders bucketa doar cash/card_pos → pie-ul
-- „Metodă plată" din AnalyticsTab ignora complet veniturile pe tichete.
-- Tichetele se decontează separat cu emitentul (Edenred/Sodexo/Up), deci
-- totalul lor distinct e necesar operațional, nu cosmetic.
--
-- Lanț de redefiniri v_daily_orders: 007→022→116→159→232. Definiția de mai
-- jos e copia exactă a mig 159 + coloana voucher_revenue ADĂUGATĂ LA FINAL
-- (create or replace view acceptă doar append de coloane). Se păstrează:
-- security_invoker=true (mig 116) + predicatul restaurant_has_feature(
-- 'fiscal_receipt') (mig 159, regula de aur) + grant select authenticated.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

create or replace view public.v_daily_orders
with (security_invoker = true) as
  SELECT restaurant_id,
     date_trunc('day'::text, (created_at AT TIME ZONE 'Europe/Bucharest'::text))::date AS day,
     count(*) AS total_orders,
     count(*) FILTER (WHERE source = 'qr'::order_source) AS qr_orders,
     count(*) FILTER (WHERE source = 'waiter'::order_source) AS waiter_orders,
     COALESCE(sum(paid_amount) FILTER (WHERE status = 'paid'::order_status), 0::numeric) AS revenue,
     COALESCE(sum(paid_amount) FILTER (WHERE status = 'paid'::order_status AND payment_method = 'cash'::payment_method), 0::numeric) AS cash_revenue,
     COALESCE(sum(paid_amount) FILTER (WHERE status = 'paid'::order_status AND payment_method = 'card_pos'::payment_method), 0::numeric) AS card_revenue,
     COALESCE(sum(paid_amount) FILTER (WHERE status = 'paid'::order_status AND payment_method = 'meal_voucher'::payment_method), 0::numeric) AS voucher_revenue
    FROM orders o
   WHERE status <> 'cancelled'::order_status
     AND public.restaurant_has_feature(o.restaurant_id, 'fiscal_receipt')
   GROUP BY restaurant_id, (date_trunc('day'::text, (created_at AT TIME ZONE 'Europe/Bucharest'::text))::date);

grant select on public.v_daily_orders to authenticated;

-- ── Asserții fail-closed ─────────────────────────────────────────────────────
do $$
declare v_def text;
begin
  select pg_get_viewdef('public.v_daily_orders'::regclass) into v_def;

  -- coloana nouă există și e filtrată pe meal_voucher
  if v_def not like '%voucher_revenue%' or v_def not like '%meal_voucher%' then
    raise exception 'mig 232: voucher_revenue lipsește din v_daily_orders';
  end if;

  -- gate-ul fiscal (mig 159) păstrat — regula de aur
  if v_def not like '%restaurant_has_feature%' or v_def not like '%fiscal_receipt%' then
    raise exception 'mig 232: predicatul fiscal_receipt s-a pierdut din v_daily_orders';
  end if;

  -- security_invoker (mig 116) păstrat
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'v_daily_orders'
       and coalesce(c.reloptions::text, '') not like '%security_invoker=true%'
  ) then
    raise exception 'mig 232: v_daily_orders și-a pierdut security_invoker=true';
  end if;

  raise notice 'mig 232: v_daily_orders + voucher_revenue OK';
end $$;

commit;
