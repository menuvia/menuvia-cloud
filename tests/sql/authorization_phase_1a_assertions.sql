-- tests/sql/authorization_phase_1a_assertions.sql
--   Set complet asserții PR 1A. Cere fixture-ul rulat în prealabil.
--
--   A1. Audit table shape valid + privilegii zero pentru rolurile aplicației.
--   A2. invite_tokens_role_not_owner CHECK exists, NOT VALID, comportamental.
--   A3. profiles column lockdown: authenticated nu poate UPDATE plan/stripe_*.
--   A4. restaurants owner_id immutability trigger active.
--   A5. restaurant_memberships guard trigger active (tgtype=31, funcția corectă).
--   A6. \ir către assertion-ul partajat A6.
--   A7. 6 RPC-uri existență, SECURITY DEFINER, proconfig, return type, EXECUTE
--       matrix, owner trust, niciun overload extra.
--   A8. Behavioral negative: foreign owner INSERT, UPDATE waiter→owner,
--       DELETE owner; behavioral positive: create_restaurant flux complet.

\set ON_ERROR_STOP on

-- ═══════════ A1. Audit table shape ═══════════════════════════════════════════
do $$
declare v_kind "char"; v_owner text; v_role text;
begin
  select c.relkind into v_kind from pg_class c
   where c.oid = 'public.security_ownership_remediations'::regclass;
  if v_kind is null or v_kind <> 'r' then
    raise exception 'A1 FAIL: relkind=%', coalesce(v_kind::text, 'NULL');
  end if;
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if has_table_privilege(v_role, 'public.security_ownership_remediations',
         'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') then
      raise exception 'A1 FAIL: % retains privileges', v_role;
    end if;
  end loop;
  if exists (select 1 from pg_class c, aclexplode(c.relacl) ae
              where c.oid = 'public.security_ownership_remediations'::regclass
                and ae.grantee = 0 and ae.privilege_type in
                  ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')) then
    raise exception 'A1 FAIL: PUBLIC retains privileges';
  end if;
  select pg_get_userbyid(c.relowner) into v_owner from pg_class c
   where c.oid = 'public.security_ownership_remediations'::regclass;
  if v_owner in ('anon','authenticated','service_role') then
    raise exception 'A1 FAIL: untrusted owner %', v_owner;
  end if;
  raise notice 'A1 PASS: audit table shape + privileges OK';
end$$;

-- ═══════════ A2. invite_tokens CHECK NOT VALID ═══════════════════════════════
do $$
declare v_v boolean;
begin
  select c.convalidated into v_v from pg_constraint c
   where c.conrelid = 'public.invite_tokens'::regclass
     and c.conname  = 'invite_tokens_role_not_owner';
  if not found then raise exception 'A2 FAIL: constraint missing'; end if;
  if v_v then raise exception 'A2 FAIL: constraint should be NOT VALID until PR 1C'; end if;
  raise notice 'A2 PASS: invite_tokens_role_not_owner exists, NOT VALID';
end$$;

-- ═══════════ A3. profiles column lockdown ════════════════════════════════════
do $$
begin
  if has_column_privilege('authenticated', 'public.profiles', 'plan', 'UPDATE') then
    raise exception 'A3 FAIL: authenticated retains UPDATE on profiles.plan';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'plan_expires_at', 'UPDATE') then
    raise exception 'A3 FAIL: authenticated retains UPDATE on profiles.plan_expires_at';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'stripe_customer_id', 'UPDATE') then
    raise exception 'A3 FAIL: authenticated retains UPDATE on profiles.stripe_customer_id';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'stripe_subscription_id', 'UPDATE') then
    raise exception 'A3 FAIL: authenticated retains UPDATE on profiles.stripe_subscription_id';
  end if;
  -- Sanity positive: full_name UPDATE rămâne
  if not has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE') then
    raise exception 'A3 FAIL: authenticated lost UPDATE on profiles.full_name';
  end if;
  raise notice 'A3 PASS: profiles plan/stripe locked; full_name preserved';
end$$;

-- ═══════════ A4. owner_id immutability trigger ═══════════════════════════════
-- PR 1A: triggerul fail-closed este garanția. Lockdown-ul column-level
-- (REVOKE UPDATE + GRANT UPDATE pe whitelist) intră în PR 1B.
do $$
declare v_count int;
begin
  select count(*) into v_count from pg_trigger t
   where t.tgrelid = 'public.restaurants'::regclass
     and t.tgname = 'trg_restaurants_owner_id_immutable'
     and not t.tgisinternal
     and t.tgenabled in ('O','A')
     and t.tgfoid = 'public.fn_restaurants_owner_id_immutable()'::regprocedure;
  if v_count <> 1 then
    raise exception 'A4 FAIL: owner_id immutability trigger missing/disabled';
  end if;
  raise notice 'A4 PASS: owner_id immutability trigger active (column REVOKE deferred to PR 1B)';
end$$;

-- ═══════════ A5. owner membership guard trigger ══════════════════════════════
do $$
declare v_tgtype int;
begin
  select t.tgtype into v_tgtype from pg_trigger t
   where t.tgrelid = 'public.restaurant_memberships'::regclass
     and t.tgname = 'trg_block_owner_membership_mutation'
     and not t.tgisinternal
     and t.tgenabled in ('O','A')
     and t.tgfoid = 'public.fn_block_owner_membership_mutation()'::regprocedure;
  if not found then raise exception 'A5 FAIL: guard trigger missing'; end if;
  -- tgtype 31 = ROW(1)+BEFORE(2)+INSERT(4)+DELETE(8)+UPDATE(16)
  if v_tgtype <> 31 then
    raise exception 'A5 FAIL: guard tgtype=% expected 31', v_tgtype;
  end if;
  raise notice 'A5 PASS: guard trigger active, FOR EACH ROW BEFORE I/U/D';
end$$;

-- ═══════════ A6. shared (constraint + 3 behavioral cases) ════════════════════
\ir assertions/a6_invite_owner_constraint.sql

-- ═══════════ A7. RPC matrix (6 RPC-uri) ══════════════════════════════════════
do $$
declare
  v_expected_text text[] := array[
    'public.preview_invite(text)',
    'public.accept_invite(text)',
    'public.create_restaurant(text,text,text,text)',
    'public.change_member_role(uuid,public.member_role)',
    'public.remove_member(uuid)',
    'public.revoke_invite(uuid)'
  ];
  v_expected_oid oid[];
  v_missing text; v_fn text; v_extra text;
  v_owner text; v_cfg text;
  v_proc regprocedure;
  v_role text; v_should boolean; v_actual boolean;
begin
  -- 1) Existence: to_regprocedure pe toate 6
  select string_agg(fn, ', ') into v_missing
  from unnest(v_expected_text) fn where to_regprocedure(fn) is null;
  if v_missing is not null then raise exception 'A7 missing: %', v_missing; end if;

  -- Build expected oid[] for set comparison
  select array_agg(to_regprocedure(fn)::oid) into v_expected_oid
  from unnest(v_expected_text) fn;

  -- 2) Overload detection: niciun proc public.* cu nume identic dar signature diferită
  select string_agg(p.oid::regprocedure::text, ', ') into v_extra
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('preview_invite','accept_invite','create_restaurant',
                      'change_member_role','remove_member','revoke_invite')
    and not (p.oid = any (v_expected_oid));
  if v_extra is not null then raise exception 'A7 unexpected overloads: %', v_extra; end if;

  -- 3) Per RPC: SECURITY DEFINER, return jsonb, owner trust, proconfig
  foreach v_fn in array v_expected_text loop
    v_proc := v_fn::regprocedure;
    if not (select p.prosecdef from pg_proc p where p.oid = v_proc) then
      raise exception 'A7 FAIL: % not SECURITY DEFINER', v_fn;
    end if;
    if (select pg_catalog.format_type(p.prorettype, null) from pg_proc p where p.oid = v_proc) <> 'jsonb' then
      raise exception 'A7 FAIL: % return type <> jsonb', v_fn;
    end if;
    select pg_get_userbyid(p.proowner) into v_owner from pg_proc p where p.oid = v_proc;
    if v_owner in ('anon','authenticated','service_role') then
      raise exception 'A7 FAIL: % untrusted owner %', v_fn, v_owner;
    end if;
    select lower(regexp_replace(coalesce(array_to_string(p.proconfig, ','), ''),
                                 '[[:space:]]+','','g'))
      into v_cfg from pg_proc p where p.oid = v_proc;
    if v_cfg !~ '(^|,)search_path=public,pg_temp(,|$)' then
      raise exception 'A7 FAIL: % proconfig=% expected search_path=public,pg_temp', v_fn, v_cfg;
    end if;
  end loop;

  -- 4) PUBLIC EXECUTE prin aclexplode → toate 6 zero
  foreach v_fn in array v_expected_text loop
    v_proc := v_fn::regprocedure;
    if exists (select 1 from pg_proc p, aclexplode(p.proacl) ae
                where p.oid = v_proc and ae.grantee = 0 and ae.privilege_type = 'EXECUTE') then
      raise exception 'A7 FAIL: PUBLIC retains EXECUTE on %', v_fn;
    end if;
  end loop;

  -- 5) EXECUTE matrix per (anon, authenticated, service_role)
  for v_role, v_fn, v_should in
    select * from (values
      ('anon',         'public.preview_invite(text)',                            true),
      ('authenticated','public.preview_invite(text)',                            true),
      ('service_role', 'public.preview_invite(text)',                            false),
      ('anon',         'public.accept_invite(text)',                             false),
      ('authenticated','public.accept_invite(text)',                             true),
      ('service_role', 'public.accept_invite(text)',                             false),
      ('anon',         'public.create_restaurant(text,text,text,text)',          false),
      ('authenticated','public.create_restaurant(text,text,text,text)',          true),
      ('service_role', 'public.create_restaurant(text,text,text,text)',          false),
      ('anon',         'public.change_member_role(uuid,public.member_role)',     false),
      ('authenticated','public.change_member_role(uuid,public.member_role)',     true),
      ('service_role', 'public.change_member_role(uuid,public.member_role)',     false),
      ('anon',         'public.remove_member(uuid)',                             false),
      ('authenticated','public.remove_member(uuid)',                             true),
      ('service_role', 'public.remove_member(uuid)',                             false),
      ('anon',         'public.revoke_invite(uuid)',                             false),
      ('authenticated','public.revoke_invite(uuid)',                             true),
      ('service_role', 'public.revoke_invite(uuid)',                             false)
    ) m(rl, fn, should)
  loop
    v_actual := has_function_privilege(v_role, v_fn::regprocedure, 'EXECUTE');
    if v_actual <> v_should then
      raise exception 'A7 EXECUTE FAIL: % on % expected=% actual=%', v_role, v_fn, v_should, v_actual;
    end if;
  end loop;
  raise notice 'A7 PASS: 6 RPCs metadata + EXECUTE matrix OK';
end$$;

-- ═══════════ A8. Behavioral negative + positive ══════════════════════════════
begin;
set local role postgres;
savepoint a8;

-- A8.1 Foreign owner INSERT → 42501 + exact hint
do $$
declare v_hint text; v_fid uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_fid, 'a8-foreign@test.invalid')
    on conflict (id) do nothing;
  begin
    insert into public.restaurant_memberships (restaurant_id, user_id, role)
    values ('00000000-0000-4000-8000-00000000a602', v_fid, 'owner'::public.member_role);
    raise exception 'A8.1 FAIL: foreign owner INSERT accepted';
  exception
    when insufficient_privilege then
      get stacked diagnostics v_hint = pg_exception_hint;
      if v_hint <> 'guard:trg_block_owner_membership_mutation' then
        raise exception 'A8.1 FAIL: wrong hint=%', v_hint;
      end if;
  end;
  raise notice 'A8.1 PASS: foreign owner INSERT blocked';
end$$;
rollback to savepoint a8;

-- A8.2 UPDATE waiter→owner pe …a603 → 42501 + exact hint
do $$
declare v_hint text; v_mid uuid;
begin
  select id into v_mid from public.restaurant_memberships
   where restaurant_id = '00000000-0000-4000-8000-00000000a602'
     and user_id       = '00000000-0000-4000-8000-00000000a603';
  begin
    update public.restaurant_memberships set role = 'owner'::public.member_role
     where id = v_mid;
    raise exception 'A8.2 FAIL: UPDATE waiter→owner accepted';
  exception
    when insufficient_privilege then
      get stacked diagnostics v_hint = pg_exception_hint;
      if v_hint <> 'guard:trg_block_owner_membership_mutation' then
        raise exception 'A8.2 FAIL: wrong hint=%', v_hint;
      end if;
  end;
  raise notice 'A8.2 PASS: UPDATE waiter→owner blocked';
end$$;
rollback to savepoint a8;

-- A8.3 DELETE owner direct → 42501 + exact hint
do $$
declare v_hint text; v_mid uuid;
begin
  select id into v_mid from public.restaurant_memberships
   where restaurant_id = '00000000-0000-4000-8000-00000000a602'
     and role = 'owner';
  begin
    delete from public.restaurant_memberships where id = v_mid;
    raise exception 'A8.3 FAIL: direct DELETE owner accepted';
  exception
    when insufficient_privilege then
      get stacked diagnostics v_hint = pg_exception_hint;
      if v_hint <> 'guard:trg_block_owner_membership_mutation' then
        raise exception 'A8.3 FAIL: wrong hint=%', v_hint;
      end if;
  end;
  raise notice 'A8.3 PASS: direct DELETE owner blocked';
end$$;
rollback to savepoint a8;

-- A8.4 Positive: create_restaurant flux complet → exact 1 owner membership aliniat
-- Bypass plan-1-restaurant limit prin ridicarea planului în savepoint (rollback
-- la final). Asta NU este parte din contractul de securitate; este pur fixture-side.
do $$
declare
  v_slug text := 'a8-bootstrap-' || gen_random_uuid()::text;
  v_resp jsonb; v_rid uuid; v_owner uuid; v_n int;
begin
  -- elevate plan ca postgres înainte de a switch-a rolul (enterprise = unlimited)
  update public.profiles set plan = 'enterprise'
   where id = '00000000-0000-4000-8000-00000000a601';
  perform set_config('request.jwt.claim.sub',
                     '00000000-0000-4000-8000-00000000a601', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  v_resp := public.create_restaurant('A8 Bootstrap', 'București', v_slug, '#C8963C');
  if not (v_resp->>'ok')::boolean then
    raise exception 'A8.4 FAIL: create_restaurant resp=%', v_resp;
  end if;
  v_rid := (v_resp->>'restaurant_id')::uuid;
  select owner_id into v_owner from public.restaurants where id = v_rid;
  if v_owner <> '00000000-0000-4000-8000-00000000a601' then
    raise exception 'A8.4 FAIL: owner=% expected …a601', v_owner;
  end if;
  select count(*) into v_n from public.restaurant_memberships
   where restaurant_id = v_rid and role = 'owner';
  if v_n <> 1 then
    raise exception 'A8.4 FAIL: owner membership count=% expected 1', v_n;
  end if;
  raise notice 'A8.4 PASS: create_restaurant + bootstrap produces exactly 1 aligned owner membership';
end$$;
rollback to savepoint a8;
rollback;

\echo '✅ phase-1A assertions passed (A1-A8)'
