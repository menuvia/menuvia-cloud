-- tests/sql/team_member_limit_assertions.sql
-- =============================================================================
-- Asertii pentru mig 131: max_team_members impus pe restaurant_memberships.
-- Owner-ul (creat de trigger-ul bootstrap la inserarea restaurantului) ocupa
-- primul slot; membrii peste limita planului sunt respinsi.
-- Ruleaza DUPA migratii. Self-contained, ROLLBACK la final.
--
--   TL1  free (limita 1): al 2-lea membru = RESPINS (owner ocupa slotul)
--   TL2  growth (limita 10): al 2-lea membru = PERMIS
-- =============================================================================

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('f1f1f1f1-1111-4111-8111-111111111111','own-free@team.test'),
  ('f2f2f2f2-2222-4222-8222-222222222222','staff1@team.test'),
  ('f4f4f4f4-4444-4444-8444-444444444444','own-growth@team.test'),
  ('f5f5f5f5-5555-4555-8555-555555555555','staff2@team.test');
update public.profiles set plan='free'   where id='f1f1f1f1-1111-4111-8111-111111111111';
update public.profiles set plan='growth' where id='f4f4f4f4-4444-4444-8444-444444444444';

-- Inserarea restaurantului declanseaza bootstrap_owner_membership (owner, count 1).
insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('f3f3f3f3-3333-4333-8333-333333333333','f1f1f1f1-1111-4111-8111-111111111111','TF','t-free','Cluj',true),
  ('f6f6f6f6-6666-4666-8666-666666666666','f4f4f4f4-4444-4444-8444-444444444444','TG','t-growth','Cluj',true);

-- ── TL1: free → al 2-lea membru RESPINS ──────────────────────────────────────
do $$
begin
  insert into public.restaurant_memberships (restaurant_id, user_id, role)
  values ('f3f3f3f3-3333-4333-8333-333333333333','f2f2f2f2-2222-4222-8222-222222222222','waiter');
  raise exception 'TL1 FAIL: al 2-lea membru acceptat pe free (limita NEIMPUSA)';
exception when others then
  if sqlerrm like '%membri%' or sqlerrm like '%team%' then
    raise notice 'TL1 OK: al 2-lea membru blocat pe free';
  else raise; end if;
end $$;

-- ── TL2: growth → al 2-lea membru PERMIS ─────────────────────────────────────
insert into public.restaurant_memberships (restaurant_id, user_id, role)
values ('f6f6f6f6-6666-4666-8666-666666666666','f5f5f5f5-5555-4555-8555-555555555555','waiter');
do $$
begin
  if (select count(*) from public.restaurant_memberships
       where restaurant_id='f6f6f6f6-6666-4666-8666-666666666666') < 2 then
    raise exception 'TL2 FAIL: growth nu a permis al 2-lea membru';
  end if;
  raise notice 'TL2 OK: growth a permis al 2-lea membru (sub limita 10)';
end $$;

do $$ begin raise notice '════ team member limit assertions: ALL PASS ════'; end $$;

rollback;
