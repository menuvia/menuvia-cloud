-- tests/sql/assertions/a6_invite_owner_constraint_validated.sql
--   Variantă A6 pentru starea POST-1C (096C): constrângerea
--   invite_tokens_role_not_owner trebuie să fie `convalidated = true`.
--   Aceleași 3 cazuri comportamentale ca A6 partajat (respinge owner INSERT
--   pending/accepted + UPDATE waiter→owner), dar metadata cere VALIDATED.
--   Inclus cu \ir din phase-1C. Cere session_user='postgres' + fixture seedat.

begin;
set local role postgres;
savepoint a6v;

do $$
begin
  if session_user <> 'postgres' then
    raise exception 'A6V ROLE FAIL: expected session_user=postgres, got %', session_user;
  end if;
end$$;

-- Metadata: constraint există, VALIDATED în 1C, zero owner invites live.
do $$
declare v_convalidated boolean; v_owner int;
begin
  select c.convalidated into v_convalidated from pg_constraint c
   where c.conrelid = 'public.invite_tokens'::regclass
     and c.conname  = 'invite_tokens_role_not_owner'
     and c.contype  = 'c';
  if not found then
    raise exception 'A6V META FAIL: invite_tokens_role_not_owner missing';
  end if;
  if not v_convalidated then
    raise exception 'A6V META FAIL: constraint must be VALIDATED after PR 1C';
  end if;

  select count(*) into v_owner from public.invite_tokens
   where role = 'owner'::public.member_role;
  if v_owner <> 0 then
    raise exception 'A6V META FAIL: % owner invites still in live table', v_owner;
  end if;
end$$;

-- Comportamental (3 cazuri): owner pending, owner accepted, UPDATE waiter→owner.
do $$
declare
  v_rid uuid; v_uid uuid; v_ok boolean; v_constraint text;
  v_token1 text := 'a6v-' || gen_random_uuid()::text;
  v_token2 text := 'a6v-' || gen_random_uuid()::text;
  v_token3 text := 'a6v-' || gen_random_uuid()::text;
begin
  select id into v_uid from auth.users
   where id = '00000000-0000-4000-8000-00000000a601';
  select id into v_rid from public.restaurants
   where id = '00000000-0000-4000-8000-00000000a602';
  if v_uid is null or v_rid is null then
    raise exception 'A6V FIXTURE FAIL: deterministic fixture missing (auth=%, restaurants=%)',
      v_uid is not null, v_rid is not null;
  end if;

  -- Caz 1: owner pending
  v_ok := false;
  begin
    insert into public.invite_tokens (restaurant_id, email, role, token, expires_at, invited_by, accepted_at)
    values (v_rid, 'a6v-pending@test.invalid', 'owner'::public.member_role,
            v_token1, now() + interval '1 hour', v_uid, null);
    raise exception 'A6V CASE 1 FAIL: pending owner invite accepted';
  exception
    when check_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'invite_tokens_role_not_owner' then
        raise exception 'A6V CASE 1 FAIL: unexpected constraint %', v_constraint;
      end if;
      v_ok := true;
    when others then
      raise exception 'A6V CASE 1 FAIL: unexpected SQLSTATE %: %', sqlstate, sqlerrm;
  end;
  if not v_ok then raise exception 'A6V CASE 1 FAIL: constraint not exercised'; end if;

  -- Caz 2: owner deja accepted
  v_ok := false;
  begin
    insert into public.invite_tokens (restaurant_id, email, role, token, expires_at, invited_by, accepted_at)
    values (v_rid, 'a6v-accepted@test.invalid', 'owner'::public.member_role,
            v_token2, now() + interval '1 hour', v_uid, now());
    raise exception 'A6V CASE 2 FAIL: accepted owner invite accepted';
  exception
    when check_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'invite_tokens_role_not_owner' then
        raise exception 'A6V CASE 2 FAIL: unexpected constraint %', v_constraint;
      end if;
      v_ok := true;
    when others then
      raise exception 'A6V CASE 2 FAIL: unexpected SQLSTATE %: %', sqlstate, sqlerrm;
  end;
  if not v_ok then raise exception 'A6V CASE 2 FAIL: constraint not exercised'; end if;

  -- Caz 3: UPDATE waiter → owner
  v_ok := false;
  insert into public.invite_tokens (restaurant_id, email, role, token, expires_at, invited_by)
  values (v_rid, 'a6v-waiter@test.invalid', 'waiter'::public.member_role,
          v_token3, now() + interval '1 hour', v_uid);
  begin
    update public.invite_tokens set role = 'owner'::public.member_role
     where token = v_token3;
    raise exception 'A6V CASE 3 FAIL: UPDATE waiter→owner accepted';
  exception
    when check_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'invite_tokens_role_not_owner' then
        raise exception 'A6V CASE 3 FAIL: unexpected constraint %', v_constraint;
      end if;
      v_ok := true;
    when others then
      raise exception 'A6V CASE 3 FAIL: unexpected SQLSTATE %: %', sqlstate, sqlerrm;
  end;
  if not v_ok then raise exception 'A6V CASE 3 FAIL: constraint not exercised'; end if;
end$$;

rollback to savepoint a6v;
rollback;
