-- ════════════════════════════════════════════════════════════════════════
-- ONE-OFF (dev/test): reset georgeradu004 → strict waiter pe restaurantul
-- lui georgeradu119. Șterge orice restaurant unde e owner (creat accidental
-- la onboarding) ca să nu mai apară meniul de owner în app.
-- ════════════════════════════════════════════════════════════════════════
-- Rulează DUPĂ ce ai rulat seed_test_accounts_dev.sql (care a creat deja
-- membership-ul waiter). Idempotent.
--
-- CONSECINȚE: șterge tot ce ține de restaurantele lui georgeradu004 ca owner
-- (categorii, produse, comenzi, mese, etc.) via CASCADE. E un cont de test
-- gol — nu pierzi nimic real.
-- ════════════════════════════════════════════════════════════════════════

do $$
declare
  v_waiter_id uuid;
  v_owner_id  uuid;
  v_deleted   int;
  v_member_ct int;
begin
  -- 1. ID-urile celor doi useri
  select id into v_waiter_id from public.profiles where email = 'georgeradu004@gmail.com';
  if v_waiter_id is null then
    raise exception 'georgeradu004@gmail.com nu există în profiles. Sign-up întâi.';
  end if;

  select id into v_owner_id from public.profiles where email = 'georgeradu119@gmail.com';
  if v_owner_id is null then
    raise exception 'georgeradu119@gmail.com nu există în profiles.';
  end if;

  -- 2. Șterge orice restaurant unde georgeradu004 e owner_id (CASCADE)
  delete from public.restaurants where owner_id = v_waiter_id;
  get diagnostics v_deleted = row_count;
  raise notice '✓ Șters % restaurant(e) owned de georgeradu004.', v_deleted;

  -- 3. Asigură membership waiter pe primul restaurant al lui georgeradu119
  insert into public.restaurant_memberships (restaurant_id, user_id, role, invited_by)
  select r.id, v_waiter_id, 'waiter', v_owner_id
  from public.restaurants r
  where r.owner_id = v_owner_id
  order by r.created_at asc
  limit 1
  on conflict (restaurant_id, user_id) do update set role = 'waiter';

  -- 4. Verifică starea finală
  select count(*) into v_member_ct
  from public.restaurant_memberships where user_id = v_waiter_id;

  raise notice '─────────────────────────────────────────────────';
  raise notice 'Memberships finale pentru georgeradu004: %', v_member_ct;
  raise notice 'Așteptat: 1 rând (waiter pe restaurantul lui georgeradu119)';
  raise notice '─────────────────────────────────────────────────';
end $$;

-- ── Verificare ──
select
  rm.role,
  r.name as restaurant_name,
  r.slug,
  p.email as owner_email
from public.restaurant_memberships rm
join public.restaurants r on r.id = rm.restaurant_id
join public.profiles p    on p.id = r.owner_id
where rm.user_id = (select id from public.profiles where email = 'georgeradu004@gmail.com');
-- Așteptat: 1 rând cu role='waiter', owner_email='georgeradu119@gmail.com'
