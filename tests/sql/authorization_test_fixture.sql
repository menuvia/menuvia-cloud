-- tests/sql/authorization_test_fixture.sql
--   MOCK-AUTH ONLY: rulează exclusiv în sql-verify.yml (PG15 + mock auth.users
--   + psql ca postgres). NU rulează pe Supabase real — `auth.users` real are
--   coloane suplimentare obligatorii. Pentru Supabase real, vezi PR 1D.
--
-- Seeds determinist:
--   auth.users:                  …a601 (owner), …a603 (second user)
--   profiles (via handle_new_user) idempotent
--   restaurants:                 …a602 (owned by …a601)
--   restaurant_memberships:      owner (…a601) prin bootstrap trigger
--                                waiter (…a603) seeded direct
--
-- Idempotent: rulabil de mai multe ori; pe a doua rulare confirmă starea
-- existentă fără să încalce guard-ul.

begin;

-- 1) Auth users
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000a601', 'a6-owner@test.invalid'),
  ('00000000-0000-4000-8000-00000000a603', 'a6-second@test.invalid')
on conflict (id) do nothing;

-- 2) Profiles (handle_new_user trigger se ocupă pe INSERT real în auth.users;
--    aici garantăm explicit pentru cazul în care testul rulează după ce a
--    user-ul a fost recreat fără triggerul handle_new_user activ).
insert into public.profiles (id, email, full_name) values
  ('00000000-0000-4000-8000-00000000a601', 'a6-owner@test.invalid', 'A6 Owner'),
  ('00000000-0000-4000-8000-00000000a603', 'a6-second@test.invalid', 'A6 Second')
on conflict (id) do nothing;

-- 3) Restaurant determinist; bootstrap_restaurant_owner creează automat
--    owner membership prin guard-ul invariant-based.
insert into public.restaurants (id, owner_id, name, slug, primary_color)
values ('00000000-0000-4000-8000-00000000a602',
        '00000000-0000-4000-8000-00000000a601',
        'A6 Restaurant', 'a6-restaurant', '#C8963C')
on conflict (id) do nothing;

-- 3b) Plan cu echipă pe owner-ul de fixture: limita max_team_members (mig 131) ar
--     bloca membrul non-owner de mai jos pe free (=1). 'pro' permite staff (=1000).
update public.profiles set plan = 'pro'
 where id = '00000000-0000-4000-8000-00000000a601';

-- 4) Waiter membership pentru second user (non-owner; ON CONFLICT DO NOTHING
--    e sigur — triggerul nu blochează inserarea non-owner).
insert into public.restaurant_memberships (restaurant_id, user_id, role)
values ('00000000-0000-4000-8000-00000000a602',
        '00000000-0000-4000-8000-00000000a603',
        'waiter'::public.member_role)
on conflict (restaurant_id, user_id) do nothing;

-- 5) Asertăm starea finală explicit pe valori, nu doar counts.
do $$
declare
  v_owner uuid; v_slug text; v_email text; v_role public.member_role;
begin
  select owner_id, slug into v_owner, v_slug
    from public.restaurants
   where id = '00000000-0000-4000-8000-00000000a602';
  if v_owner <> '00000000-0000-4000-8000-00000000a601' or v_slug <> 'a6-restaurant' then
    raise exception 'FIXTURE FAIL: restaurant owner=%, slug=%', v_owner, v_slug;
  end if;

  select email into v_email from auth.users
   where id = '00000000-0000-4000-8000-00000000a601';
  if v_email <> 'a6-owner@test.invalid' then
    raise exception 'FIXTURE FAIL: owner email=%', v_email;
  end if;

  select role into v_role from public.restaurant_memberships
   where restaurant_id = '00000000-0000-4000-8000-00000000a602'
     and user_id       = '00000000-0000-4000-8000-00000000a601';
  if v_role <> 'owner'::public.member_role then
    raise exception 'FIXTURE FAIL: owner membership role=%', v_role;
  end if;

  select role into v_role from public.restaurant_memberships
   where restaurant_id = '00000000-0000-4000-8000-00000000a602'
     and user_id       = '00000000-0000-4000-8000-00000000a603';
  if v_role <> 'waiter'::public.member_role then
    raise exception 'FIXTURE FAIL: waiter membership role=%', v_role;
  end if;
end$$;

commit;
