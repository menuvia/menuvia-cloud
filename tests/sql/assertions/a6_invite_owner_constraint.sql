-- tests/sql/assertions/a6_invite_owner_constraint.sql
--   A6 partajat — invite_tokens role <> 'owner' (CHECK NOT VALID în PR 1A,
--   VALIDATED în PR 1C). Include cu \ir din phase-1A + final-state.
--   Cere session_user='postgres'; fixture-ul mock-auth seedat anterior.

begin;
set local role postgres;
savepoint a6;

-- Defensive: confirm conexiune ca postgres (altfel un eventual SET LOCAL ROLE
-- eșuat ar putea masca rezultatele cu 42501-uri venite din REVOKE-uri).
do $$
begin
  if session_user <> 'postgres' then
    raise exception 'A6 ROLE FAIL: expected session_user=postgres, got %', session_user;
  end if;
end$$;

-- Metadata: constraint exists, NOT VALID în 1A, zero pending owner invites
do $$
declare v_convalidated boolean; v_pending int;
begin
  select c.convalidated into v_convalidated from pg_constraint c
   where c.conrelid = 'public.invite_tokens'::regclass
     and c.conname  = 'invite_tokens_role_not_owner'
     and c.contype  = 'c';
  if not found then
    raise exception 'A6 META FAIL: invite_tokens_role_not_owner missing';
  end if;
  if v_convalidated then
    raise exception 'A6 META FAIL: constraint must remain NOT VALID until PR 1C';
  end if;

  select count(*) into v_pending from public.invite_tokens
   where role = 'owner'::public.member_role
     and accepted_at is null;
  if v_pending <> 0 then
    raise exception 'A6 META FAIL: % pending owner invites still present', v_pending;
  end if;
end$$;

-- Comportamental (3 cazuri): owner pending, owner accepted, UPDATE waiter→owner.
do $$
declare
  v_rid uuid; v_uid uuid; v_ok boolean; v_constraint text;
  v_token1 text := 'a6-' || gen_random_uuid()::text;
  v_token2 text := 'a6-' || gen_random_uuid()::text;
  v_token3 text := 'a6-' || gen_random_uuid()::text;
begin
  select id into v_uid from auth.users
   where id = '00000000-0000-4000-8000-00000000a601';
  select id into v_rid from public.restaurants
   where id = '00000000-0000-4000-8000-00000000a602';
  if v_uid is null or v_rid is null then
    raise exception 'A6 FIXTURE FAIL: deterministic fixture missing (auth=%, restaurants=%)',
      v_uid is not null, v_rid is not null;
  end if;

  -- Caz 1: owner pending
  v_ok := false;
  begin
    insert into public.invite_tokens (restaurant_id, email, role, token, expires_at, invited_by, accepted_at)
    values (v_rid, 'a6-pending@test.invalid', 'owner'::public.member_role,
            v_token1, now() + interval '1 hour', v_uid, null);
    raise exception 'A6 CASE 1 FAIL: pending owner invite accepted';
  exception
    when check_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'invite_tokens_role_not_owner' then
        raise exception 'A6 CASE 1 FAIL: unexpected constraint %', v_constraint;
      end if;
      v_ok := true;
    when others then
      raise exception 'A6 CASE 1 FAIL: unexpected SQLSTATE %: %', sqlstate, sqlerrm;
  end;
  if not v_ok then raise exception 'A6 CASE 1 FAIL: constraint not exercised'; end if;

  -- Caz 2: owner deja accepted (constraint trebuie să respingă chiar și INSERT
  -- cu accepted_at NOT NULL — previne fals-verde pentru expresie eronată gen
  -- `role <> 'owner' OR accepted_at IS NOT NULL`).
  v_ok := false;
  begin
    insert into public.invite_tokens (restaurant_id, email, role, token, expires_at, invited_by, accepted_at)
    values (v_rid, 'a6-accepted@test.invalid', 'owner'::public.member_role,
            v_token2, now() + interval '1 hour', v_uid, now());
    raise exception 'A6 CASE 2 FAIL: accepted owner invite accepted';
  exception
    when check_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'invite_tokens_role_not_owner' then
        raise exception 'A6 CASE 2 FAIL: unexpected constraint %', v_constraint;
      end if;
      v_ok := true;
    when others then
      raise exception 'A6 CASE 2 FAIL: unexpected SQLSTATE %: %', sqlstate, sqlerrm;
  end;
  if not v_ok then raise exception 'A6 CASE 2 FAIL: constraint not exercised'; end if;

  -- Caz 3: UPDATE waiter → owner
  v_ok := false;
  insert into public.invite_tokens (restaurant_id, email, role, token, expires_at, invited_by)
  values (v_rid, 'a6-waiter@test.invalid', 'waiter'::public.member_role,
          v_token3, now() + interval '1 hour', v_uid);
  begin
    update public.invite_tokens set role = 'owner'::public.member_role
     where token = v_token3;
    raise exception 'A6 CASE 3 FAIL: UPDATE waiter→owner accepted';
  exception
    when check_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'invite_tokens_role_not_owner' then
        raise exception 'A6 CASE 3 FAIL: unexpected constraint %', v_constraint;
      end if;
      v_ok := true;
    when others then
      raise exception 'A6 CASE 3 FAIL: unexpected SQLSTATE %: %', sqlstate, sqlerrm;
  end;
  if not v_ok then raise exception 'A6 CASE 3 FAIL: constraint not exercised'; end if;
end$$;

rollback to savepoint a6;
rollback;
