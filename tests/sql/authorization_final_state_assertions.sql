-- tests/sql/authorization_final_state_assertions.sql
--   Set complet asserții PR 1B (după 096B). Cere fixture-ul rulat în prealabil.
--
--   F1. Guard membership active + tgtype = 31 exact.
--   F2. Guard owner_id immutable active.
--   F3. 4 teste comportamentale negative ca `postgres` cu hint check + zero
--       efect rezidual.
--   F4. 2 teste pozitive prin RPC (change_member_role, create_restaurant).
--   F5. Privilegii table-level: zero IUD pe restaurants/memberships/invites
--       pentru PUBLIC/anon/authenticated; zero non-UPDATE (incl. INSERT) pe
--       restaurants pentru authenticated.
--   F6. UPDATE column-level pe restaurants: whitelist OK; owner_id + slug = FALSE.
--   F7. A6 partajat via \ir (3 cazuri comportamentale + metadata NOT VALID).
--   F8. 7 RPCs final-state: existence, prosecdef, jsonb return, owner trusted,
--       search_path=public,pg_temp, PUBLIC EXECUTE zero via aclexplode,
--       EXECUTE matrix pentru anon/authenticated/service_role, overload detection.

\set ON_ERROR_STOP on

-- ═══════════════════════ F1. Guard membership active ═════════════════════════
do $$
declare v_t int;
begin
  select t.tgtype into v_t from pg_trigger t
   where t.tgrelid = 'public.restaurant_memberships'::regclass
     and t.tgname  = 'trg_block_owner_membership_mutation'
     and not t.tgisinternal
     and t.tgenabled in ('O','A')
     and t.tgfoid   = 'public.fn_block_owner_membership_mutation()'::regprocedure;
  if not found then raise exception 'F1 FAIL: guard membership trigger missing'; end if;
  if v_t <> 31 then
    raise exception 'F1 FAIL: tgtype=% expected 31 (ROW|BEFORE|INSERT|UPDATE|DELETE)', v_t;
  end if;
  raise notice 'F1 PASS: trg_block_owner_membership_mutation tgtype=31, function aligned';
end$$;

-- ═══════════════════════ F2. Guard owner_id immutable ════════════════════════
do $$
declare v_count int;
begin
  select count(*) into v_count from pg_trigger t
   where t.tgrelid = 'public.restaurants'::regclass
     and t.tgname  = 'trg_restaurants_owner_id_immutable'
     and not t.tgisinternal
     and t.tgenabled in ('O','A')
     and t.tgfoid   = 'public.fn_restaurants_owner_id_immutable()'::regprocedure;
  if v_count <> 1 then raise exception 'F2 FAIL: owner_id immutability trigger missing'; end if;
  raise notice 'F2 PASS: trg_restaurants_owner_id_immutable active';
end$$;

-- ═══════════════════════ F3. Negative trigger probes (postgres) ══════════════
-- Probele rulează ca `postgres` (superuser). REVOKE-urile din PR 1B nu pot
-- masca rezultatul — eroarea trebuie să vină din trigger, nu din lipsă de
-- privilegii pe rol.
begin;
set local role postgres;
savepoint f3;

-- F3.1: INSERT owner pentru alt user → 42501 + hint exact
do $$
declare
  v_hint text; v_msg text; v_n_before int; v_n_after int;
  v_foreign uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_foreign, 'f31-foreign@test.invalid')
    on conflict (id) do nothing;
  select count(*) into v_n_before from public.restaurant_memberships
   where restaurant_id = '00000000-0000-4000-8000-00000000a602';
  begin
    insert into public.restaurant_memberships (restaurant_id, user_id, role)
    values ('00000000-0000-4000-8000-00000000a602', v_foreign, 'owner'::public.member_role);
    raise exception 'F3.1 FAIL: INSERT owner foreign user accepted';
  exception
    when insufficient_privilege then
      get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text;
      if v_hint <> 'guard:trg_block_owner_membership_mutation' then
        raise exception 'F3.1 FAIL: wrong hint=% msg=%', v_hint, v_msg;
      end if;
    when others then raise exception 'F3.1 FAIL: SQLSTATE %', sqlstate;
  end;
  select count(*) into v_n_after from public.restaurant_memberships
   where restaurant_id = '00000000-0000-4000-8000-00000000a602';
  if v_n_after <> v_n_before then
    raise exception 'F3.1 FAIL: row count drifted %→%', v_n_before, v_n_after;
  end if;
  raise notice 'F3.1 PASS: foreign owner INSERT blocked (42501 + exact hint + zero residual)';
end$$;
rollback to savepoint f3;

-- F3.2: UPDATE waiter→owner → 42501 + hint exact + zero state change
do $$
declare v_hint text; v_mid uuid; v_role_before public.member_role; v_role_after public.member_role;
begin
  select id, role into v_mid, v_role_before from public.restaurant_memberships
   where restaurant_id = '00000000-0000-4000-8000-00000000a602'
     and user_id       = '00000000-0000-4000-8000-00000000a603';
  begin
    update public.restaurant_memberships set role = 'owner'::public.member_role where id = v_mid;
    raise exception 'F3.2 FAIL: UPDATE waiter→owner accepted';
  exception
    when insufficient_privilege then
      get stacked diagnostics v_hint = pg_exception_hint;
      if v_hint <> 'guard:trg_block_owner_membership_mutation' then
        raise exception 'F3.2 FAIL: wrong hint=%', v_hint;
      end if;
    when others then raise exception 'F3.2 FAIL: SQLSTATE %', sqlstate;
  end;
  select role into v_role_after from public.restaurant_memberships where id = v_mid;
  if v_role_after <> v_role_before then
    raise exception 'F3.2 FAIL: role drifted %→%', v_role_before, v_role_after;
  end if;
  raise notice 'F3.2 PASS: UPDATE waiter→owner blocked + zero state drift';
end$$;
rollback to savepoint f3;

-- F3.3: DELETE owner direct → 42501 + hint + row still present
do $$
declare v_hint text; v_mid uuid; v_count_after int;
begin
  select id into v_mid from public.restaurant_memberships
   where restaurant_id = '00000000-0000-4000-8000-00000000a602'
     and role = 'owner'::public.member_role limit 1;
  begin
    delete from public.restaurant_memberships where id = v_mid;
    raise exception 'F3.3 FAIL: direct DELETE owner accepted';
  exception
    when insufficient_privilege then
      get stacked diagnostics v_hint = pg_exception_hint;
      if v_hint <> 'guard:trg_block_owner_membership_mutation' then
        raise exception 'F3.3 FAIL: wrong hint=%', v_hint;
      end if;
    when others then raise exception 'F3.3 FAIL: SQLSTATE %', sqlstate;
  end;
  select count(*) into v_count_after from public.restaurant_memberships where id = v_mid;
  if v_count_after <> 1 then
    raise exception 'F3.3 FAIL: owner row deleted despite block (count=%)', v_count_after;
  end if;
  raise notice 'F3.3 PASS: direct DELETE owner blocked + row preserved';
end$$;
rollback to savepoint f3;

-- F3.4: UPDATE owner_id pe restaurants → 42501 + hint owner_id_immutable
do $$
declare v_hint text; v_owner_before uuid; v_owner_after uuid;
begin
  select owner_id into v_owner_before from public.restaurants
   where id = '00000000-0000-4000-8000-00000000a602';
  begin
    update public.restaurants set owner_id = gen_random_uuid()
     where id = '00000000-0000-4000-8000-00000000a602';
    raise exception 'F3.4 FAIL: UPDATE owner_id accepted';
  exception
    when insufficient_privilege then
      get stacked diagnostics v_hint = pg_exception_hint;
      if v_hint <> 'guard:owner_id_immutable' then
        raise exception 'F3.4 FAIL: wrong hint=%', v_hint;
      end if;
    when others then raise exception 'F3.4 FAIL: SQLSTATE %', sqlstate;
  end;
  select owner_id into v_owner_after from public.restaurants
   where id = '00000000-0000-4000-8000-00000000a602';
  if v_owner_after <> v_owner_before then
    raise exception 'F3.4 FAIL: owner_id drifted %→%', v_owner_before, v_owner_after;
  end if;
  raise notice 'F3.4 PASS: UPDATE owner_id blocked + zero state drift';
end$$;
rollback to savepoint f3;
rollback;

-- ═══════════════════════ F4. Positive RPC paths ══════════════════════════════
-- F4.1: change_member_role waiter→kitchen pe …a603 (membership existent în fixture)
begin;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000a601';
set local role authenticated;
do $$
declare v_mid uuid; v_resp jsonb; v_role public.member_role;
begin
  select id into v_mid from public.restaurant_memberships
   where restaurant_id = '00000000-0000-4000-8000-00000000a602'
     and user_id       = '00000000-0000-4000-8000-00000000a603';
  v_resp := public.change_member_role(v_mid, 'kitchen'::public.member_role);
  if not (v_resp->>'ok')::boolean then raise exception 'F4.1 FAIL: resp=%', v_resp; end if;
  select role into v_role from public.restaurant_memberships where id = v_mid;
  if v_role <> 'kitchen'::public.member_role then
    raise exception 'F4.1 FAIL: role after=%', v_role;
  end if;
  raise notice 'F4.1 PASS: change_member_role waiter→kitchen via RPC';
end$$;
rollback;

-- F4.2: create_restaurant produce restaurant + EXACT 1 owner membership aliniat
begin;
do $$ begin
  -- Bypass plan-1-restaurant limit pentru testul de bootstrap (rollback la final)
  update public.profiles set plan = 'enterprise'
   where id = '00000000-0000-4000-8000-00000000a601';
end$$;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000a601';
set local role authenticated;
do $$
declare
  v_slug text := 'f4-bootstrap-' || gen_random_uuid()::text;
  v_resp jsonb; v_rid uuid; v_owner uuid; v_n int;
begin
  v_resp := public.create_restaurant('F4 Bootstrap', 'București', v_slug, '#C8963C');
  if not (v_resp->>'ok')::boolean then raise exception 'F4.2 FAIL: resp=%', v_resp; end if;
  v_rid := (v_resp->>'restaurant_id')::uuid;
  select owner_id into v_owner from public.restaurants where id = v_rid;
  if v_owner <> '00000000-0000-4000-8000-00000000a601' then
    raise exception 'F4.2 FAIL: owner=%', v_owner;
  end if;
  select count(*) into v_n from public.restaurant_memberships
   where restaurant_id = v_rid and role = 'owner';
  if v_n <> 1 then raise exception 'F4.2 FAIL: owner count=%', v_n; end if;
  raise notice 'F4.2 PASS: create_restaurant + bootstrap produces exactly 1 aligned owner membership';
end$$;
rollback;

-- ═══════════════════════ F5. Table-level privilege final-state ═══════════════
do $$
declare v_role text;
begin
  foreach v_role in array array['anon','authenticated','service_role'] loop
    -- restaurants: zero INSERT/DELETE/REFERENCES/TRUNCATE/TRIGGER
    if has_table_privilege(v_role, 'public.restaurants',
         'INSERT, DELETE, REFERENCES, TRUNCATE, TRIGGER') then
      raise exception 'F5 FAIL: % retains non-UPDATE privilege on restaurants', v_role;
    end if;
    -- restaurant_memberships: zero IUD
    if has_table_privilege(v_role, 'public.restaurant_memberships',
         'INSERT, UPDATE, DELETE') then
      raise exception 'F5 FAIL: % retains IUD on restaurant_memberships', v_role;
    end if;
    -- invite_tokens: zero IUD
    if has_table_privilege(v_role, 'public.invite_tokens',
         'INSERT, UPDATE, DELETE') then
      raise exception 'F5 FAIL: % retains IUD on invite_tokens', v_role;
    end if;
  end loop;
  -- PUBLIC via aclexplode
  if exists (select 1 from pg_class c, aclexplode(c.relacl) ae
              where c.oid in ('public.restaurants'::regclass,
                              'public.restaurant_memberships'::regclass,
                              'public.invite_tokens'::regclass)
                and ae.grantee = 0
                and ae.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')) then
    raise exception 'F5 FAIL: PUBLIC retains mutation privilege on one of the three tables';
  end if;
  raise notice 'F5 PASS: zero IUD direct pe restaurants/memberships/invites pentru PUBLIC/anon/authenticated';
end$$;

-- ═══════════════════════ F6. Column-level whitelist final-state ══════════════
do $$
declare
  v_col text;
  v_extra text;
  v_whitelist text[] := array[
    'name','tagline','city','description','address','phone','hours',
    'hours_structured','timezone','wifi_password','primary_color','logo_url',
    'cover_url','floor_layout','socials','amenities',
    'checkout_suggestion_settings','theme_settings','pickup_settings',
    'google_place_id','google_review_url',
    -- mig 197 — meniu multilingv: grant update (menu_languages) pe restaurants.
    'menu_languages',
    -- mig 205 — moneda meniului (expansiune internațională planurile 1-2).
    'currency'
  ];
begin
  -- Toate coloanele whitelisted trebuie să fie UPDATE-able de authenticated
  foreach v_col in array v_whitelist loop
    if not has_column_privilege('authenticated', 'public.restaurants', v_col, 'UPDATE') then
      raise exception 'F6 FAIL: authenticated lost UPDATE on restaurants.%', v_col;
    end if;
  end loop;

  -- Exact-allowlist enforcement: zero coloane în AFARA whitelist-ului trebuie
  -- să rămână UPDATE-able. Asigură că o nouă coloană adăugată în viitor sau o
  -- altă coloană sensibilă (business_type, qr_token, is_active, currency,
  -- language, etc.) NU primește implicit privilegiu.
  select string_agg(c.column_name, ', ' order by c.ordinal_position)
    into v_extra
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name   = 'restaurants'
     and has_column_privilege('authenticated', 'public.restaurants', c.column_name, 'UPDATE')
     and not (c.column_name = any (v_whitelist));
  if v_extra is not null then
    raise exception 'F6 FAIL: authenticated retains UPDATE on coloane în afara whitelist-ului: %', v_extra;
  end if;

  -- owner_id + slug EXPLICIT excluse din whitelist (sanity asserts; redundanți
  -- cu exact-allowlist check de mai sus, dar mențin mesajul de eroare precis)
  if has_column_privilege('authenticated', 'public.restaurants', 'owner_id', 'UPDATE') then
    raise exception 'F6 FAIL: authenticated retains UPDATE on restaurants.owner_id';
  end if;
  if has_column_privilege('authenticated', 'public.restaurants', 'slug', 'UPDATE') then
    raise exception 'F6 FAIL: authenticated retains UPDATE on restaurants.slug';
  end if;
  raise notice 'F6 PASS: exact allowlist 22 coloane UPDATE OK; toate celelalte coloane excluse';
end$$;

-- ═══════════════════════ F7. A6 partajat (3 cazuri + metadata) ════════════════
\ir assertions/a6_invite_owner_constraint.sql

-- ═══════════════════════ F8. 7 RPCs final-state matrix ═══════════════════════
do $$
declare
  v_expected_text text[] := array[
    'public.preview_invite(text)',
    'public.accept_invite(text)',
    'public.create_restaurant(text,text,text,text)',
    'public.change_member_role(uuid,public.member_role)',
    'public.remove_member(uuid)',
    'public.revoke_invite(uuid)',
    'public.change_restaurant_slug(uuid,text)'
  ];
  v_expected_oid oid[];
  v_missing text; v_fn text; v_extra text;
  v_owner text; v_cfg text;
  v_proc regprocedure;
  v_role text; v_should boolean; v_actual boolean;
begin
  -- 1. Existence
  select string_agg(fn, ', ') into v_missing
  from unnest(v_expected_text) fn where to_regprocedure(fn) is null;
  if v_missing is not null then raise exception 'F8 missing: %', v_missing; end if;

  select array_agg(to_regprocedure(fn)::oid) into v_expected_oid
  from unnest(v_expected_text) fn;

  -- 2. Overload detection (niciun proc public.* cu nume identic dar signature diferită)
  select string_agg(p.oid::regprocedure::text, ', ') into v_extra
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('preview_invite','accept_invite','create_restaurant',
                      'change_member_role','remove_member','revoke_invite',
                      'change_restaurant_slug')
    and not (p.oid = any (v_expected_oid));
  if v_extra is not null then raise exception 'F8 unexpected overloads: %', v_extra; end if;

  -- 3. Per RPC: prosecdef, return jsonb, owner trusted, search_path strict
  foreach v_fn in array v_expected_text loop
    v_proc := v_fn::regprocedure;
    if not (select p.prosecdef from pg_proc p where p.oid = v_proc) then
      raise exception 'F8 FAIL: % not SECURITY DEFINER', v_fn;
    end if;
    if (select pg_catalog.format_type(p.prorettype, null) from pg_proc p where p.oid = v_proc) <> 'jsonb' then
      raise exception 'F8 FAIL: % return type <> jsonb', v_fn;
    end if;
    select pg_get_userbyid(p.proowner) into v_owner from pg_proc p where p.oid = v_proc;
    if v_owner in ('anon','authenticated','service_role') then
      raise exception 'F8 FAIL: % untrusted owner %', v_fn, v_owner;
    end if;
    select lower(regexp_replace(coalesce(array_to_string(p.proconfig, ','), ''),
                                 '[[:space:]]+','','g'))
      into v_cfg from pg_proc p where p.oid = v_proc;
    if v_cfg !~ '(^|,)search_path=public,pg_temp(,|$)' then
      raise exception 'F8 FAIL: % proconfig=% expected search_path=public,pg_temp', v_fn, v_cfg;
    end if;
  end loop;

  -- 4. PUBLIC EXECUTE zero pentru toate 7
  foreach v_fn in array v_expected_text loop
    v_proc := v_fn::regprocedure;
    if exists (select 1 from pg_proc p, aclexplode(p.proacl) ae
                where p.oid = v_proc and ae.grantee = 0 and ae.privilege_type = 'EXECUTE') then
      raise exception 'F8 FAIL: PUBLIC retains EXECUTE on %', v_fn;
    end if;
  end loop;

  -- 5. EXECUTE matrix per (anon, authenticated, service_role)
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
      ('service_role', 'public.revoke_invite(uuid)',                             false),
      ('anon',         'public.change_restaurant_slug(uuid,text)',               false),
      ('authenticated','public.change_restaurant_slug(uuid,text)',               true),
      ('service_role', 'public.change_restaurant_slug(uuid,text)',               false)
    ) m(rl, fn, should)
  loop
    v_actual := has_function_privilege(v_role, v_fn::regprocedure, 'EXECUTE');
    if v_actual <> v_should then
      raise exception 'F8 EXECUTE FAIL: % on % expected=% actual=%', v_role, v_fn, v_should, v_actual;
    end if;
  end loop;
  raise notice 'F8 PASS: 7 RPCs metadata + EXECUTE matrix OK';
end$$;

-- ═══════════════════════ F9. change_restaurant_slug TOCTOU safety net ════════
--   Forțează unique_violation pe UPDATE-ul intern (printr-un trigger BEFORE
--   UPDATE care injectează un rând cu același slug) și asertă că funcția
--   returnează contractul {ok:false, reason:slug_taken, slug} în loc să lase
--   23505 să iasă către client. Acoperă fereastra TOCTOU dintre `exists` check
--   și UPDATE care nu poate fi eliminată single-statement.
do $$
declare v_resp jsonb;
        v_parasite uuid := gen_random_uuid();
        v_parasite_user uuid := gen_random_uuid();
        v_target_slug text := 'f9-toctou-' || substring(gen_random_uuid()::text, 1, 8);
        v_my uuid := '00000000-0000-4000-8000-00000000a602';
begin
  -- Preconditii fixture-ului existent + competitor user/profile
  insert into auth.users (id, email) values (v_parasite_user, 'f9-parasite@test.invalid')
    on conflict (id) do nothing;
  insert into public.profiles (id, email, full_name)
    values (v_parasite_user, 'f9-parasite@test.invalid', 'F9 Parasite')
    on conflict (id) do nothing;

  -- Trigger injection: la UPDATE-ul restaurantului țintă, inserează rândul
  -- competitor cu acelaşi slug → unique_violation.
  create or replace function pg_temp.f9_race_inject() returns trigger language plpgsql as $f$
  begin
    if NEW.slug = current_setting('app.f9_race_slug', true) then
      insert into public.restaurants (id, owner_id, name, slug, primary_color)
      values (
        current_setting('app.f9_race_parasite_id')::uuid,
        current_setting('app.f9_race_parasite_user')::uuid,
        'F9 Parasite Restaurant',
        NEW.slug,
        '#000000'
      );
    end if;
    return NEW;
  end$f$;

  perform set_config('app.f9_race_slug', v_target_slug, true);
  perform set_config('app.f9_race_parasite_id', v_parasite::text, true);
  perform set_config('app.f9_race_parasite_user', v_parasite_user::text, true);

  -- Conditional drop ca să nu emitem NOTICE inutil în CI dacă triggerul lipsea.
  if exists (
    select 1 from pg_trigger
     where tgrelid = 'public.restaurants'::regclass
       and tgname  = 'trg_f9_toctou_inject'
  ) then
    drop trigger trg_f9_toctou_inject on public.restaurants;
  end if;
  create trigger trg_f9_toctou_inject before update on public.restaurants
    for each row execute function pg_temp.f9_race_inject();

  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a601', true);
  v_resp := public.change_restaurant_slug(v_my, v_target_slug);

  drop trigger trg_f9_toctou_inject on public.restaurants;

  -- Contractul trebuie să fie EXACT {ok:false, reason:slug_taken, slug:v_target_slug}.
  -- `IS DISTINCT FROM` pe jsonb întreg e null-safe (cheile lipsă nu mai produc NULL).
  if v_resp is distinct from jsonb_build_object(
    'ok',     false,
    'reason', 'slug_taken',
    'slug',   v_target_slug
  ) then
    raise exception 'F9 FAIL: TOCTOU race response=% (expected {ok:false, reason:slug_taken, slug:%})',
      v_resp, v_target_slug;
  end if;

  -- Cleanup (parasite row a fost inserat în loc, restaurantul țintă neschimbat)
  delete from public.restaurants where id = v_parasite;
  delete from public.profiles  where id = v_parasite_user;
  delete from auth.users       where id = v_parasite_user;

  raise notice 'F9 PASS: change_restaurant_slug TOCTOU race → {ok:false, reason:slug_taken, slug:%}', v_target_slug;
end$$;

\echo '✅ final-state assertions passed (F1-F9)'
