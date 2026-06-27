-- mig 131 — Fix P1: enforce max_team_members (TEAM-LIM-1)
--
-- Auditul rundei 3 (team_invites_rbac). max_team_members e definit in plan_features
-- (free/starter=1, growth=10, pro=1000, enterprise=null=nelimitat — mig 028/089) dar
-- NU e impus nicaieri: accept_invite (mig 096a) insereaza in restaurant_memberships
-- fara sa numere membrii vs limita. Astfel un restaurant free/starter (1) sau growth
-- (10) putea adauga oricati membri => bypass de limita de plan (aceeasi clasa ca
-- limita produse/mese, mig 114/126).
--
-- Fix: trigger BEFORE INSERT pe restaurant_memberships care numara membrii existenti
-- vs limita planului owner-ului si respinge peste prag. Owner-ul (primul membru, la
-- create_restaurant) trece mereu (count 0 < orice limita >=1). null = nelimitat.
-- Lock advisory per restaurant (anti race, ca la celelalte limite).

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

create or replace function public.enforce_team_member_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan  text;
  v_max   integer;
  v_count integer;
begin
  -- Serializeaza inserturile concurente pe acelasi restaurant (anti race la count).
  perform pg_advisory_xact_lock(hashtext('team_limit_' || new.restaurant_id::text));

  select public.owner_plan(new.restaurant_id) into v_plan;

  select limit_value into v_max
    from public.plan_features
   where plan = coalesce(v_plan, 'free') and feature = 'max_team_members';

  -- null (pro/enterprise sau lipsa) => nelimitat.
  if v_max is null then
    return new;
  end if;

  select count(*) into v_count
    from public.restaurant_memberships
   where restaurant_id = new.restaurant_id;

  -- BEFORE INSERT: randul nou nu e inca numarat. La count >= limita, al (count+1)-lea
  -- ar depasi => respins. Owner-ul (count 0) trece intotdeauna.
  if v_count >= v_max then
    raise exception 'Limita de membri atinsa: maxim % pentru planul %.', v_max, coalesce(v_plan, 'free')
      using errcode = 'P0001', hint = 'team_member_limit';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_team_member_limit() from public;

drop trigger if exists trg_enforce_team_member_limit on public.restaurant_memberships;
create trigger trg_enforce_team_member_limit
  before insert on public.restaurant_memberships
  for each row
  execute function public.enforce_team_member_limit();

do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'trg_enforce_team_member_limit'
       and tgrelid = 'public.restaurant_memberships'::regclass
       and not tgisinternal
  ) then
    raise exception 'mig 131: triggerul trg_enforce_team_member_limit lipseste';
  end if;
  raise notice 'mig 131: limita max_team_members impusa pe membership OK';
end $$;

commit;
