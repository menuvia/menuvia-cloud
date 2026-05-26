-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 028 — Raport TVA + Plan Limits + Feature Gates
-- ═══════════════════════════════════════════════════════════════

-- ── Part 1: VAT REPORT VIEW ─────────────────────────────────
-- Grupează vânzările pe cota TVA + zi pentru raportare contabilă

create or replace view public.vat_report_daily as
select
  o.restaurant_id,
  date_trunc('day', o.paid_at)::date as report_date,
  coalesce(p.vat_group, 1) as vat_group,
  case coalesce(p.vat_group, 1)
    when 1 then 9
    when 2 then 19
    when 3 then 5
    when 4 then 0
  end as vat_rate_percent,
  count(distinct o.id) as orders_count,
  sum(oi.item_total) as gross_total,
  -- TVA = gross × (rate / (100 + rate))
  sum(oi.item_total * (
    case coalesce(p.vat_group, 1)
      when 1 then 9
      when 2 then 19
      when 3 then 5
      when 4 then 0
    end / (100.0 +
    case coalesce(p.vat_group, 1)
      when 1 then 9
      when 2 then 19
      when 3 then 5
      when 4 then 0
    end))) as vat_amount,
  -- Net = gross - vat
  sum(oi.item_total * (
    100.0 / (100.0 +
    case coalesce(p.vat_group, 1)
      when 1 then 9
      when 2 then 19
      when 3 then 5
      when 4 then 0
    end))) as net_total
from public.orders o
join public.order_items oi on oi.order_id = o.id
left join public.products p on p.id = oi.product_id
where o.status = 'paid' and o.paid_at is not null
group by o.restaurant_id, date_trunc('day', o.paid_at)::date, coalesce(p.vat_group, 1);

grant select on public.vat_report_daily to authenticated;
comment on view public.vat_report_daily is 'Vânzări grupate per zi + cota TVA pentru raportare contabilă';

-- ── Part 2: PLAN FEATURES ───────────────────────────────────
-- Tabela centrală: ce feature-uri are fiecare plan

create table if not exists public.plan_features (
  plan          text not null check (plan in ('free', 'starter', 'growth', 'pro', 'enterprise')),
  feature       text not null,
  enabled       boolean not null default true,
  limit_value   integer,
  primary key (plan, feature)
);

comment on table public.plan_features is 'Feature gates per plan. limit_value = NULL înseamnă nelimitat.';

-- Insert defaults pentru Starter / Growth / Pro / Enterprise
insert into public.plan_features (plan, feature, enabled, limit_value) values
  -- ── STARTER (49 lei) — meniu QR doar
  ('starter', 'menu_qr',           true,  null),
  ('starter', 'max_products',      true,  30),
  ('starter', 'max_tables',        true,  5),
  ('starter', 'max_team_members',  true,  1),
  ('starter', 'order_qr',          false, null),
  ('starter', 'kitchen_dashboard', false, null),
  ('starter', 'waiter_manual',     false, null),
  ('starter', 'pickup_orders',     false, null),
  ('starter', 'extras_pairings',   false, null),
  ('starter', 'modifiers',         false, null),
  ('starter', 'stocks',            false, null),
  ('starter', 'recipes',           false, null),
  ('starter', 'profitability',     false, null),
  ('starter', 'ai_import',         false, null),
  ('starter', 'analytics_advanced',false, null),
  ('starter', 'reports_pdf',       false, null),
  ('starter', 'reports_vat',       false, null),
  ('starter', 'floor_plan',        false, null),
  ('starter', 'shifts',            false, null),
  ('starter', 'split_bill',        false, null),
  ('starter', 'themes',            true,  null),
  ('starter', 'remove_branding',   false, null),

  -- ── GROWTH (99 lei) — comenzi + bucătărie + ospătar
  ('growth', 'menu_qr',           true, null),
  ('growth', 'max_products',      true, null),
  ('growth', 'max_tables',        true, null),
  ('growth', 'max_team_members',  true, 5),
  ('growth', 'order_qr',          true, null),
  ('growth', 'kitchen_dashboard', true, null),
  ('growth', 'waiter_manual',     true, null),
  ('growth', 'pickup_orders',     true, null),
  ('growth', 'extras_pairings',   true, null),
  ('growth', 'modifiers',         true, null),
  ('growth', 'stocks',            true, null),
  ('growth', 'recipes',           true, null),
  ('growth', 'profitability',     true, null),
  ('growth', 'ai_import',         false, null),
  ('growth', 'analytics_advanced',false, null),
  ('growth', 'reports_pdf',       true, null),
  ('growth', 'reports_vat',       true, null),
  ('growth', 'floor_plan',        false, null),
  ('growth', 'shifts',            false, null),
  ('growth', 'split_bill',        false, null),
  ('growth', 'themes',            true, null),
  ('growth', 'remove_branding',   true, null),

  -- ── PRO (199 lei) — totul + AI + floor plan + ture
  ('pro', 'menu_qr',           true, null),
  ('pro', 'max_products',      true, null),
  ('pro', 'max_tables',        true, null),
  ('pro', 'max_team_members',  true, null),
  ('pro', 'order_qr',          true, null),
  ('pro', 'kitchen_dashboard', true, null),
  ('pro', 'waiter_manual',     true, null),
  ('pro', 'pickup_orders',     true, null),
  ('pro', 'extras_pairings',   true, null),
  ('pro', 'modifiers',         true, null),
  ('pro', 'stocks',            true, null),
  ('pro', 'recipes',           true, null),
  ('pro', 'profitability',     true, null),
  ('pro', 'ai_import',         true, null),
  ('pro', 'analytics_advanced',true, null),
  ('pro', 'reports_pdf',       true, null),
  ('pro', 'reports_vat',       true, null),
  ('pro', 'floor_plan',        true, null),
  ('pro', 'shifts',            true, null),
  ('pro', 'split_bill',        true, null),
  ('pro', 'themes',            true, null),
  ('pro', 'remove_branding',   true, null),

  -- ── ENTERPRISE (Contact) — tot, fără limite
  ('enterprise', 'menu_qr',           true, null),
  ('enterprise', 'max_products',      true, null),
  ('enterprise', 'max_tables',        true, null),
  ('enterprise', 'max_team_members',  true, null),
  ('enterprise', 'order_qr',          true, null),
  ('enterprise', 'kitchen_dashboard', true, null),
  ('enterprise', 'waiter_manual',     true, null),
  ('enterprise', 'pickup_orders',     true, null),
  ('enterprise', 'extras_pairings',   true, null),
  ('enterprise', 'modifiers',         true, null),
  ('enterprise', 'stocks',            true, null),
  ('enterprise', 'recipes',           true, null),
  ('enterprise', 'profitability',     true, null),
  ('enterprise', 'ai_import',         true, null),
  ('enterprise', 'analytics_advanced',true, null),
  ('enterprise', 'reports_pdf',       true, null),
  ('enterprise', 'reports_vat',       true, null),
  ('enterprise', 'floor_plan',        true, null),
  ('enterprise', 'shifts',            true, null),
  ('enterprise', 'split_bill',        true, null),
  ('enterprise', 'themes',            true, null),
  ('enterprise', 'remove_branding',   true, null),

  -- ── FREE (legacy/backwards compat)
  ('free', 'menu_qr',           true, null),
  ('free', 'max_products',      true, 15),
  ('free', 'max_tables',        true, 3),
  ('free', 'max_team_members',  true, 1),
  ('free', 'order_qr',          false, null),
  ('free', 'kitchen_dashboard', false, null),
  ('free', 'stocks',            false, null),
  ('free', 'themes',            false, null)
on conflict (plan, feature) do update set
  enabled = excluded.enabled,
  limit_value = excluded.limit_value;

-- Make plan_features readable to all authenticated users
alter table public.plan_features enable row level security;
create policy "plan_features: read all" on public.plan_features for select to authenticated using (true);

-- ── Part 3: HELPER RPC — get features for restaurant ────────
create or replace function public.get_restaurant_features(p_restaurant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_features jsonb;
begin
  -- Get plan from restaurant
  select coalesce(plan, 'starter') into v_plan
  from public.restaurants
  where id = p_restaurant_id;

  if v_plan is null then return null; end if;

  -- Build features map: { feature_name: { enabled, limit } }
  select jsonb_object_agg(
    pf.feature,
    jsonb_build_object('enabled', pf.enabled, 'limit', pf.limit_value)
  ) into v_features
  from public.plan_features pf
  where pf.plan = v_plan;

  return jsonb_build_object(
    'plan', v_plan,
    'features', coalesce(v_features, '{}'::jsonb)
  );
end;
$$;

grant execute on function public.get_restaurant_features(uuid) to authenticated;
comment on function public.get_restaurant_features is 
  'Returnează features și limite pentru un restaurant, pe baza planului curent';
