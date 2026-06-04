-- ════════════════════════════════════════════════════════════════════════
-- SCRIPT ONE-OFF (dev/test only): conturi tester + alocare waiter
-- ════════════════════════════════════════════════════════════════════════
-- NU pune în supabase/migrations/ — sql-verify.yml aplică toate migrațiile
-- pe DB efemer fără userii ăștia → raise exception → CI roșu → merge blocat.
--
-- Rulează manual în Supabase Dashboard > SQL Editor (după ce userii au făcut
-- sign-up în app). Idempotent.
--
-- Conține 2 secțiuni:
--   A. Upgrade georgeradu119@gmail.com → plan 'enterprise'
--   B. Alocă georgeradu004@gmail.com ca waiter pe primul restaurant al
--      owner-ului A.
--
-- Înlocuiește emailurile cu ale tale dacă vrei să rulezi pentru alt cont.
-- ════════════════════════════════════════════════════════════════════════

-- ── Secțiunea A: enterprise pentru owner ──────────────────────────
update public.profiles
set
  plan            = 'enterprise',
  plan_expires_at = null  -- fără expirare (override manual, fără Stripe)
where email = 'georgeradu119@gmail.com';


-- ── Secțiunea B: alocă waiter pe primul restaurant al owner-ului ──
do $$
declare
  v_owner_id      uuid;
  v_waiter_id     uuid;
  v_restaurant_id uuid;
begin
  select id into v_owner_id
  from public.profiles where email = 'georgeradu119@gmail.com';

  if v_owner_id is null then
    raise exception 'Owner georgeradu119@gmail.com nu există în profiles. Sign-up întâi.';
  end if;

  select id into v_restaurant_id
  from public.restaurants
  where owner_id = v_owner_id
  order by created_at asc
  limit 1;

  if v_restaurant_id is null then
    raise exception 'Owner % nu are restaurante. Crează unul în app întâi.', v_owner_id;
  end if;

  select id into v_waiter_id
  from public.profiles where email = 'georgeradu004@gmail.com';

  if v_waiter_id is null then
    raise exception 'Waiter georgeradu004@gmail.com nu există în profiles. Sign-up întâi.';
  end if;

  insert into public.restaurant_memberships (restaurant_id, user_id, role, invited_by)
  values (v_restaurant_id, v_waiter_id, 'waiter', v_owner_id)
  on conflict (restaurant_id, user_id) do update set role = 'waiter';

  raise notice '✓ Waiter % alocat la restaurantul % (owner %)',
    v_waiter_id, v_restaurant_id, v_owner_id;
end $$;
