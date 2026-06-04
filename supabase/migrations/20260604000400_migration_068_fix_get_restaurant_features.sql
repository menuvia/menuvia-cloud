-- Migration 068: fix get_restaurant_features — citește planul din profiles
-- ─────────────────────────────────────────────────────────────────────
-- Bug (P0 testing-blocker): RPC din mig 028 face
--   select coalesce(plan, 'starter') from public.restaurants where id = ...
-- DAR restaurants NU are coloana 'plan' (vezi base_schema). Planul real
-- e pe profiles.plan (owner-ul restaurantului). Query-ul aruncă
-- "column plan does not exist" → useFeatures prinde silent → features.has()
-- întoarce false pentru tot → user enterprise vede paywall pe orice
-- feature (Gestiune, etc.) chiar dacă DB zice că e enterprise.
--
-- Fix: JOIN restaurants → profiles via owner_id și citește profiles.plan.

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
  -- Planul e pe profiles (al owner-ului), nu pe restaurants
  select coalesce(p.plan, 'free') into v_plan
  from public.restaurants r
  join public.profiles p on p.id = r.owner_id
  where r.id = p_restaurant_id;

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
