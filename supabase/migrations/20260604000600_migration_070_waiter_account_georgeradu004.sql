-- Migration 070: alocă georgeradu004@gmail.com ca waiter la restaurantul lui georgeradu119
-- One-off: cont de test waiter pentru validare features waiter mode.

do $$
declare
  v_owner_id     uuid;
  v_waiter_id    uuid;
  v_restaurant_id uuid;
begin
  -- Owner
  select id into v_owner_id
  from public.profiles where email = 'georgeradu119@gmail.com';

  if v_owner_id is null then
    raise exception 'Owner georgeradu119@gmail.com nu există în profiles. Sign-up-ul nu a fost făcut?';
  end if;

  -- Restaurantul owner-ului (primul, dacă are mai multe)
  select id into v_restaurant_id
  from public.restaurants
  where owner_id = v_owner_id
  order by created_at asc
  limit 1;

  if v_restaurant_id is null then
    raise exception 'Owner georgeradu119@gmail.com nu are niciun restaurant — crează unul mai întâi.';
  end if;

  -- Waiter (trebuie să fi făcut sign-up înainte)
  select id into v_waiter_id
  from public.profiles where email = 'georgeradu004@gmail.com';

  if v_waiter_id is null then
    raise exception 'Waiter georgeradu004@gmail.com nu există în profiles. Trebuie să facă sign-up întâi pe app, apoi rulez această migrație.';
  end if;

  -- Insert (idempotent pe (restaurant_id, user_id))
  insert into public.restaurant_memberships (restaurant_id, user_id, role, invited_by)
  values (v_restaurant_id, v_waiter_id, 'waiter', v_owner_id)
  on conflict (restaurant_id, user_id) do update set role = 'waiter';

  raise notice 'Waiter % alocat la restaurantul % (owner %)', v_waiter_id, v_restaurant_id, v_owner_id;
end $$;
