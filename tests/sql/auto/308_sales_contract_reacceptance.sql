-- tests/sql/auto/308_sales_contract_reacceptance.sql
-- =============================================================================
-- Mig 308: reacceptarea contractului rețelei de vânzări. Rulează din
-- tests/sql/auto/ pe AMBELE medii (sql-verify + stack-ul Supabase din E2E).
-- Autonom, ROLLBACK la final. Apelurile client rulează SUB rolul REAL
-- `authenticated` / `anon` (ca `postgres` EXECUTE e ocolit, deci un „anon e
-- respins" ar fi vacuu); verificările de stare se fac înapoi ca postgres.
--
--   KA1  catalog: o singură semnătură, DEFINER + pg_temp, EXECUTE doar
--        authenticated; apel REAL ca anon → 42501 pe FUNCȚIE
--   KA2  contract neschimbat → needs_acceptance false; acceptarea e idempotentă
--        (`already`, niciun rând nou)
--   KA3  versiune NOUĂ → needs_acceptance true pe membri, false pe afiliatul vechi
--        și pe non-afiliat; motivele de contract în ordinea răscumpărării, fără
--        rânduri scrise; acceptarea corectă (hash cu majuscule normalizat) scrie
--        un rând cu CUI-ul ULTIMEI acceptări, kind = rolul, invitation_id NULL;
--        flag-ul cade doar pentru cine a acceptat
--   KA4  a doua acceptare a aceleiași perechi → `already`, zero rânduri noi
--   KA5  ACEEAȘI versiune republicată cu ALT text → needs_acceptance true
--        (înainte de 308: false — flag-ul compara doar versiunea)
--   KA6  cine NU poate accepta: afiliat vechi / non-afiliat (`not_an_affiliate`),
--        închis (`account_closed`); suspendatul POATE (acceptarea nu redă nimic)
--   KA7  contract retras → `contract_not_published`, flag false
--   KA8  rate limit: a 11-a încercare → `rate_limited`
--   KA9  structural: for update pe afiliat, rate limit, idempotența pe PERECHE;
--        forma `contract` din get_sales_network neschimbată
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Fixtură ──────────────────────────────────────────────────────────────────
-- F fondator · N cont simplu · L afiliat vechi · H șef · G agent ·
-- C membru închis · S membru suspendat · R cont pentru rate limit
insert into auth.users (id, email) values
  ('5b000000-0000-4000-8000-0000000000f1', 'ka-founder@ka308.test'),
  ('5b000000-0000-4000-8000-0000000000e1', 'ka-nobody@ka308.test'),
  ('5b000000-0000-4000-8000-0000000000e2', 'ka-legacy@ka308.test'),
  ('5b000000-0000-4000-8000-000000000001', 'ka-head@ka308.test'),
  ('5b000000-0000-4000-8000-000000000011', 'ka-agent@ka308.test'),
  ('5b000000-0000-4000-8000-000000000021', 'ka-closed@ka308.test'),
  ('5b000000-0000-4000-8000-000000000022', 'ka-susp@ka308.test'),
  ('5b000000-0000-4000-8000-000000000031', 'ka-rl@ka308.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email)
  select id, email from auth.users where email like 'ka-%@ka308.test'
  on conflict (id) do nothing;
-- Coloanele GoTrue citite de răscumpărare lipsesc din schema mock din CI.
do $$ begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'auth' and table_name = 'users' and column_name = 'email_confirmed_at') then
    alter table auth.users add column email_confirmed_at timestamptz;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'auth' and table_name = 'users' and column_name = 'is_anonymous') then
    alter table auth.users add column is_anonymous boolean not null default false;
  end if;
end $$;
update auth.users set email_confirmed_at = now() where email like 'ka-%@ka308.test';
update public.profiles set is_platform_admin = true where id = '5b000000-0000-4000-8000-0000000000f1';

insert into public.affiliates (id, profile_id, referral_code) values
  ('5bb00000-0000-4000-8000-0000000000e2', '5b000000-0000-4000-8000-0000000000e2', 'kalegacy1');

create function pg_temp.ka_as(p_role text, p_uid uuid, p_sql text) returns jsonb
language plpgsql as $f$
declare v jsonb; v_state text; v_hint text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('role', p_role, true);
  begin
    execute 'select (' || p_sql || ')::jsonb' into v;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
    v := jsonb_build_object('raised', true, 'sqlstate', v_state, 'hint', v_hint, 'error', sqlerrm);
  end;
  perform set_config('role', 'none', true);
  return v;
end $f$;

create function pg_temp.ka_u(p_uid uuid, p_sql text) returns jsonb
language sql as $$ select pg_temp.ka_as('authenticated', p_uid, p_sql) $$;

create function pg_temp.ka_publish(p_ver text, p_hash text) returns jsonb
language sql as $$
  select pg_temp.ka_u('5b000000-0000-4000-8000-0000000000f1',
           format('public.admin_set_sales_contract_version(%L, %L)', p_ver, p_hash))
$$;

create function pg_temp.ka_accept(p_uid uuid, p_ver text, p_hash text) returns jsonb
language sql as $$
  select pg_temp.ka_u(p_uid, format('public.accept_sales_contract(%L, %L)', p_ver, p_hash))
$$;

create function pg_temp.ka_needs(p_uid uuid) returns text
language sql as $$
  select pg_temp.ka_u(p_uid, 'public.get_sales_network()') #>> '{contract,needs_acceptance}'
$$;

create function pg_temp.ka_rows(p_uid uuid) returns int
language sql as $$
  select count(*)::int from public.affiliate_contract_acceptances ca
    join public.affiliates a on a.id = ca.affiliate_id
   where a.profile_id = p_uid
$$;

-- Invitație de șef semănată direct (ca postgres), răscumpărată ca utilizatorul.
create function pg_temp.ka_head(p_uid uuid, p_token text, p_cui text) returns jsonb
language plpgsql as $f$
begin
  insert into public.affiliate_invitations (kind, token_hash, expires_at)
    values ('head', public.sales_invite_token_hash(p_token), clock_timestamp() + interval '14 days');
  return pg_temp.ka_u(p_uid, format(
    'public.redeem_sales_head_invite(%L, %L, %L, %L, %L, true)',
    p_token, '0722 111 222', p_cui, '1.0', repeat('a', 64)));
end $f$;

-- Contractul 1.0 publicat; H, C, S șefi; G agentul lui H.
do $$
declare
  H constant uuid := '5b000000-0000-4000-8000-000000000001';
  G constant uuid := '5b000000-0000-4000-8000-000000000011';
  v jsonb; v_tok text;
begin
  v := pg_temp.ka_publish('1.0', repeat('a', 64));
  if (v->>'ok') is distinct from 'true' then raise exception 'KA fixtură: publicarea 1.0: %', v; end if;

  v := pg_temp.ka_head(H, 'ka-tok-head', '18547290');
  if (v->>'ok') is distinct from 'true' then raise exception 'KA fixtură: șeful H: %', v; end if;
  v := pg_temp.ka_head('5b000000-0000-4000-8000-000000000021', 'ka-tok-closed', '14399840');
  if (v->>'ok') is distinct from 'true' then raise exception 'KA fixtură: membrul C: %', v; end if;
  v := pg_temp.ka_head('5b000000-0000-4000-8000-000000000022', 'ka-tok-susp', '2816464');
  if (v->>'ok') is distinct from 'true' then raise exception 'KA fixtură: membrul S: %', v; end if;

  v := pg_temp.ka_u(H, $q$public.create_agent_invite('pentru G')$q$);
  if (v->>'ok') is distinct from 'true' then raise exception 'KA fixtură: invitația lui G: %', v; end if;
  v_tok := v->>'token';
  v := pg_temp.ka_u(G, format('public.redeem_agent_invite(%L, %L, %L, %L, %L, false)',
                              v_tok, '0733 222 333', '9010105', '1.0', repeat('a', 64)));
  if (v->>'ok') is distinct from 'true' then raise exception 'KA fixtură: agentul G: %', v; end if;

  update public.affiliates set status = 'closed'
   where profile_id = '5b000000-0000-4000-8000-000000000021';
  update public.affiliates set status = 'suspended'
   where profile_id = '5b000000-0000-4000-8000-000000000022';
end $$;

-- ── KA1: catalog + apel real ca anon ─────────────────────────────────────────
do $$
declare v_n int; v jsonb;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'accept_sales_contract';
  if v_n <> 1 then raise exception 'KA1 FAIL: % semnături', v_n; end if;
  if not (select p.prosecdef from pg_proc p where p.oid = 'public.accept_sales_contract(text, text)'::regprocedure) then
    raise exception 'KA1 FAIL: nu e SECURITY DEFINER'; end if;
  if not exists (select 1 from pg_proc p, unnest(coalesce(p.proconfig, '{}'::text[])) c
                  where p.oid = 'public.accept_sales_contract(text, text)'::regprocedure
                    and c like 'search_path=%pg_temp%') then
    raise exception 'KA1 FAIL: search_path fără pg_temp'; end if;
  if has_function_privilege('anon', 'public.accept_sales_contract(text, text)', 'execute')
     or has_function_privilege('service_role', 'public.accept_sales_contract(text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.accept_sales_contract(text, text)', 'execute') then
    raise exception 'KA1 FAIL: EXECUTE nu e doar authenticated'; end if;
  v := pg_temp.ka_as('anon', null, format('public.accept_sales_contract(%L, %L)', '1.0', repeat('a', 64)));
  -- Doar pe SQLSTATE ar fi vacuu: `permission denied for schema` e tot 42501.
  if (v->>'sqlstate') is distinct from '42501' or (v->>'error') not like '%for function%' then
    raise exception 'KA1 FAIL: anon a ajuns în funcție: %', v; end if;
  raise notice 'KA1 OK: o semnătură, DEFINER + pg_temp, doar authenticated, anon respins pe funcție';
end $$;

-- ── KA2: contract neschimbat → nimic de acceptat, acceptarea e idempotentă ───
do $$
declare
  H constant uuid := '5b000000-0000-4000-8000-000000000001';
  G constant uuid := '5b000000-0000-4000-8000-000000000011';
  v jsonb;
begin
  if pg_temp.ka_needs(H) is distinct from 'false' or pg_temp.ka_needs(G) is distinct from 'false' then
    raise exception 'KA2 FAIL: needs_acceptance pe contractul deja acceptat'; end if;
  v := pg_temp.ka_accept(H, '1.0', repeat('a', 64));
  if (v->>'ok') is distinct from 'true' or (v->>'already') is distinct from 'true' then
    raise exception 'KA2 FAIL: reacceptarea aceleiași perechi: %', v; end if;
  if pg_temp.ka_rows(H) <> 1 then raise exception 'KA2 FAIL: rând nou pe o pereche deja acceptată'; end if;
  raise notice 'KA2 OK: contract neschimbat → flag false, acceptarea idempotentă';
end $$;

-- ── KA3: versiune NOUĂ ───────────────────────────────────────────────────────
do $$
declare
  H constant uuid := '5b000000-0000-4000-8000-000000000001';
  G constant uuid := '5b000000-0000-4000-8000-000000000011';
  L constant uuid := '5b000000-0000-4000-8000-0000000000e2';
  N constant uuid := '5b000000-0000-4000-8000-0000000000e1';
  v jsonb; v_acc public.affiliate_contract_acceptances%rowtype;
begin
  v := pg_temp.ka_publish('2.0', repeat('b', 64));
  if (v->>'ok') is distinct from 'true' then raise exception 'KA3 FAIL: publicarea 2.0: %', v; end if;

  if pg_temp.ka_needs(H) is distinct from 'true' or pg_temp.ka_needs(G) is distinct from 'true' then
    raise exception 'KA3 FAIL: membrii nu sunt rugați să accepte 2.0'; end if;
  -- afiliatul vechi n-are ce accepta (înainte de 308: true); non-afiliatul: false
  if pg_temp.ka_needs(L) is distinct from 'false' then
    raise exception 'KA3 FAIL: afiliatul vechi primește needs_acceptance'; end if;
  if pg_temp.ka_needs(N) is distinct from 'false' then
    raise exception 'KA3 FAIL: non-afiliatul primește needs_acceptance'; end if;

  -- motivele de contract, în ordinea răscumpărării; nimic scris
  if pg_temp.ka_accept(H, '1.0', repeat('b', 64)) is distinct from '{"ok": false, "reason": "contract_version_mismatch"}'::jsonb then
    raise exception 'KA3 FAIL: versiunea veche acceptată'; end if;
  if pg_temp.ka_accept(H, '2.0', 'xyz') is distinct from '{"ok": false, "reason": "contract_hash_invalid"}'::jsonb then
    raise exception 'KA3 FAIL: hash non-hex acceptat'; end if;
  if pg_temp.ka_accept(H, '2.0', repeat('a', 64)) is distinct from '{"ok": false, "reason": "contract_hash_mismatch"}'::jsonb then
    raise exception 'KA3 FAIL: hash-ul textului vechi acceptat'; end if;
  if pg_temp.ka_rows(H) <> 1 then raise exception 'KA3 FAIL: un refuz a scris un rând'; end if;

  -- control pozitiv: hash-ul publicat, cu majuscule și spații → normalizat
  v := pg_temp.ka_accept(H, ' 2.0 ', ' ' || repeat('B', 64) || ' ');
  if (v->>'ok') is distinct from 'true' or (v->>'already') is distinct from 'false' or v->>'version' is distinct from '2.0' then
    raise exception 'KA3 FAIL: acceptarea corectă: %', v; end if;
  select ca.* into v_acc from public.affiliate_contract_acceptances ca
    join public.affiliates a on a.id = ca.affiliate_id
   where a.profile_id = H order by ca.accepted_at desc, ca.id desc limit 1;
  if v_acc.contract_version is distinct from '2.0' or v_acc.text_hash is distinct from repeat('b', 64)
     or v_acc.declared_cui is distinct from '18547290' or v_acc.kind is distinct from 'head'
     or v_acc.invitation_id is not null then
    raise exception 'KA3 FAIL: rândul acceptării: %', row_to_json(v_acc); end if;
  if pg_temp.ka_rows(H) <> 2 then raise exception 'KA3 FAIL: % rânduri pentru H', pg_temp.ka_rows(H); end if;

  -- flag-ul cade DOAR pentru cine a acceptat
  if pg_temp.ka_needs(H) is distinct from 'false' then raise exception 'KA3 FAIL: H încă trebuie să accepte'; end if;
  if pg_temp.ka_needs(G) is distinct from 'true' then raise exception 'KA3 FAIL: acceptarea lui H a stins flag-ul lui G'; end if;

  -- agentul: kind = 'agent', CUI-ul lui
  v := pg_temp.ka_accept(G, '2.0', repeat('b', 64));
  if (v->>'ok') is distinct from 'true' then raise exception 'KA3 FAIL: acceptarea agentului: %', v; end if;
  if (select ca.kind || ':' || ca.declared_cui from public.affiliate_contract_acceptances ca
        join public.affiliates a on a.id = ca.affiliate_id
       where a.profile_id = G order by ca.accepted_at desc, ca.id desc limit 1) is distinct from 'agent:9010105' then
    raise exception 'KA3 FAIL: rândul agentului nu are rolul/CUI-ul lui'; end if;
  raise notice 'KA3 OK: versiune nouă → flag pe membri, motive fără scriere, rând cu CUI-ul ultimei acceptări';
end $$;

-- ── KA4: idempotență pe pereche ──────────────────────────────────────────────
do $$
declare H constant uuid := '5b000000-0000-4000-8000-000000000001'; v jsonb;
begin
  v := pg_temp.ka_accept(H, '2.0', repeat('b', 64));
  if (v->>'ok') is distinct from 'true' or (v->>'already') is distinct from 'true' then
    raise exception 'KA4 FAIL: a doua acceptare: %', v; end if;
  if pg_temp.ka_rows(H) <> 2 then raise exception 'KA4 FAIL: dublu-submit a scris un rând'; end if;
  raise notice 'KA4 OK: a doua acceptare a aceleiași perechi nu scrie nimic';
end $$;

-- ── KA5: aceeași versiune, ALT text ──────────────────────────────────────────
do $$
declare H constant uuid := '5b000000-0000-4000-8000-000000000001'; v jsonb;
begin
  v := pg_temp.ka_publish('2.0', repeat('c', 64));
  if (v->>'ok') is distinct from 'true' then raise exception 'KA5 FAIL: republicarea 2.0: %', v; end if;
  if pg_temp.ka_needs(H) is distinct from 'true' then
    raise exception 'KA5 FAIL: alt text sub aceeași versiune nu cere reacceptare'; end if;
  v := pg_temp.ka_accept(H, '2.0', repeat('c', 64));
  if (v->>'ok') is distinct from 'true' or (v->>'already') is distinct from 'false' then
    raise exception 'KA5 FAIL: acceptarea textului nou: %', v; end if;
  if pg_temp.ka_needs(H) is distinct from 'false' then raise exception 'KA5 FAIL: flag-ul nu cade'; end if;
  raise notice 'KA5 OK: republicarea altui text sub aceeași versiune cere reacceptare';
end $$;

-- ── KA6: cine nu poate accepta ───────────────────────────────────────────────
do $$
declare
  L constant uuid := '5b000000-0000-4000-8000-0000000000e2';
  N constant uuid := '5b000000-0000-4000-8000-0000000000e1';
  C constant uuid := '5b000000-0000-4000-8000-000000000021';
  S constant uuid := '5b000000-0000-4000-8000-000000000022';
  v jsonb;
begin
  if pg_temp.ka_accept(L, '2.0', repeat('c', 64)) is distinct from '{"ok": false, "reason": "not_an_affiliate"}'::jsonb then
    raise exception 'KA6 FAIL: afiliatul vechi'; end if;
  if pg_temp.ka_accept(N, '2.0', repeat('c', 64)) is distinct from '{"ok": false, "reason": "not_an_affiliate"}'::jsonb then
    raise exception 'KA6 FAIL: non-afiliatul'; end if;
  if pg_temp.ka_accept(C, '2.0', repeat('c', 64)) is distinct from '{"ok": false, "reason": "account_closed"}'::jsonb then
    raise exception 'KA6 FAIL: membrul închis'; end if;
  if pg_temp.ka_rows(L) <> 0 or pg_temp.ka_rows(C) <> 1 then
    raise exception 'KA6 FAIL: un refuz a scris un rând'; end if;
  -- suspendatul POATE (control pozitiv: fără el, „account_closed" pe toți ar trece)
  v := pg_temp.ka_accept(S, '2.0', repeat('c', 64));
  if (v->>'ok') is distinct from 'true' or pg_temp.ka_rows(S) <> 2 then
    raise exception 'KA6 FAIL: suspendatul nu poate accepta: %', v; end if;
  raise notice 'KA6 OK: vechi / non-afiliat / închis refuzați fără scriere; suspendatul acceptă';
end $$;

-- ── KA7: contract retras ─────────────────────────────────────────────────────
do $$
declare H constant uuid := '5b000000-0000-4000-8000-000000000001'; v jsonb;
begin
  v := pg_temp.ka_publish(null, null);
  if (v->>'ok') is distinct from 'true' then raise exception 'KA7 FAIL: retragerea: %', v; end if;
  if pg_temp.ka_accept(H, '2.0', repeat('c', 64)) is distinct from '{"ok": false, "reason": "contract_not_published"}'::jsonb then
    raise exception 'KA7 FAIL: acceptare pe contract retras'; end if;
  if pg_temp.ka_needs(H) is distinct from 'false' then raise exception 'KA7 FAIL: flag pe contract retras'; end if;
  v := pg_temp.ka_publish('2.0', repeat('c', 64));
  raise notice 'KA7 OK: contract retras → contract_not_published, flag false';
end $$;

-- ── KA8: rate limit ──────────────────────────────────────────────────────────
do $$
declare R constant uuid := '5b000000-0000-4000-8000-000000000031'; v jsonb; i int;
begin
  for i in 1..10 loop
    v := pg_temp.ka_accept(R, '2.0', repeat('c', 64));
    if v is distinct from '{"ok": false, "reason": "not_an_affiliate"}'::jsonb then
      raise exception 'KA8 FAIL: încercarea %: %', i, v; end if;
  end loop;
  v := pg_temp.ka_accept(R, '2.0', repeat('c', 64));
  if v is distinct from '{"ok": false, "reason": "rate_limited"}'::jsonb then
    raise exception 'KA8 FAIL: a 11-a încercare: %', v; end if;
  raise notice 'KA8 OK: a 11-a încercare → rate_limited';
end $$;

-- ── KA9: structural + forma neschimbată ──────────────────────────────────────
do $$
declare
  H constant uuid := '5b000000-0000-4000-8000-000000000001';
  v_def text; v jsonb; v_keys text;
begin
  select pg_get_functiondef('public.accept_sales_contract(text, text)'::regprocedure) into v_def;
  if v_def !~ 'from public\.affiliates where profile_id = v_uid for update;' then
    raise exception 'KA9 FAIL: lacătul pe rândul afiliatului'; end if;
  if position('check_rate_limit(''accept_sales_contract''' in v_def) = 0 then
    raise exception 'KA9 FAIL: rate limit'; end if;
  if v_def !~ 'v_last\.contract_version = v_version and v_last\.text_hash = v_hash' then
    raise exception 'KA9 FAIL: idempotența nu mai e pe pereche'; end if;

  v := pg_temp.ka_u(H, 'public.get_sales_network()');
  select string_agg(k, ',' order by k collate "C") into v_keys from jsonb_object_keys(v->'contract') k;
  if v_keys is distinct from 'accepted_at,accepted_version,current_text_hash,current_version,needs_acceptance' then
    raise exception 'KA9 FAIL: forma contract s-a schimbat: %', v_keys; end if;
  raise notice 'KA9 OK: clauzele de corectitudine prezente, forma contract neschimbată';
end $$;

rollback;
