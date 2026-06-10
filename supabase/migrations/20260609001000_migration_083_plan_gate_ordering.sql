-- Migration 083: Poarta A — plan-level gate pe ordering
-- ─────────────────────────────────────────────────────────────────────
-- Spec §3 Regula 3: "Gating la nivel de RPC/RLS, NU în UI."
-- Spec §6 Poarta A: "ordering_enabled=false + blocare server-side"
--
-- Situația anterioară:
--   enforce_ordering_enabled() verifica doar:
--     1. restaurants.is_active
--     2. restaurant_settings.ordering_enabled
--   DAR NU verifica planul. Un restaurant pe planul 'free' sau 'starter'
--   (Plan 1 — meniu QR only) putea crea comenzi dacă nu setase manual
--   ordering_enabled=false.
--
-- Fix: trigger-ul verifică acum feature-ul corespunzând source-ului comenzii:
--   source='qr'     → plan_features.order_qr
--   source='waiter' → plan_features.waiter_manual
--   source='pickup' → plan_features.pickup_orders
-- free/starter: toate trei sunt false → orice INSERT pe orders e respins.
-- growth/pro/enterprise: true → trec normal.
--
-- Ordine checks:
--   1. restaurants.is_active
--   2. plan feature (gate hard, nu poate fi suprascris din UI)
--   3. restaurant_settings.ordering_enabled (manual toggle)

create or replace function public.enforce_ordering_enabled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan          text;
  v_feature       text;
  v_feature_on    boolean;
begin
  -- ── 1. Restaurant activ ──────────────────────────────────────────
  if not exists (
    select 1 from public.restaurants
    where id = new.restaurant_id
      and is_active = true
  ) then
    raise exception 'Restaurantul este dezactivat.'
      using errcode = 'check_violation';
  end if;

  -- ── 2. Plan-level feature gate ───────────────────────────────────
  -- Mapăm source → feature_name
  v_feature := case new.source::text
    when 'waiter'  then 'waiter_manual'
    when 'pickup'  then 'pickup_orders'
    else                'order_qr'       -- 'qr' + orice source viitor
  end;

  -- Obținem planul owner-ului și valoarea feature-ului
  select
    coalesce(pr.plan, 'free'),
    coalesce(pf.enabled, false)
  into v_plan, v_feature_on
  from public.restaurants r
  join public.profiles pr on pr.id = r.owner_id
  left join public.plan_features pf
         on pf.plan = pr.plan and pf.feature = v_feature
  where r.id = new.restaurant_id;

  if not coalesce(v_feature_on, false) then
    raise exception
      'Comenzile nu sunt disponibile pe planul curent (%). Upgrade la Growth sau mai sus.',
      v_plan
      using errcode = 'check_violation', hint = 'plan_upgrade_required';
  end if;

  -- ── 3. Manual toggle ─────────────────────────────────────────────
  if exists (
    select 1 from public.restaurant_settings
    where restaurant_id = new.restaurant_id
      and ordering_enabled = false
  ) then
    raise exception 'Comenzile sunt oprite momentan pentru acest restaurant.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- Triggerul e deja atașat (migration 014) — nu e nevoie să-l recreăm,
-- funcția e replace-uită în loc.
-- Verificare: trigger există pe orders
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_enforce_ordering_enabled'
      and tgrelid = 'public.orders'::regclass
  ) then
    execute '
      create trigger trg_enforce_ordering_enabled
        before insert on public.orders
        for each row execute function public.enforce_ordering_enabled()
    ';
  end if;
end$$;

-- ── Asigurăm că free are order_qr=false (idempotent) ─────────────
insert into public.plan_features (plan, feature, enabled, limit_value)
values
  ('free', 'order_qr',      false, null),
  ('free', 'waiter_manual', false, null),
  ('free', 'pickup_orders', false, null)
on conflict (plan, feature) do update set enabled = false;

-- starter: confirmare explicită că orders sunt blocate
insert into public.plan_features (plan, feature, enabled, limit_value)
values
  ('starter', 'order_qr',      false, null),
  ('starter', 'waiter_manual', false, null),
  ('starter', 'pickup_orders', false, null)
on conflict (plan, feature) do update set enabled = false;
