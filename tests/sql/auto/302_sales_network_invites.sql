-- tests/sql/auto/302_sales_network_invites.sql
-- =============================================================================
-- Mig 302 (pachetul 8a): rețeaua de vânzări DOAR pe invitații. Rulează din
-- tests/sql/auto/ (scripts/run-sql-auto.sh) pe AMBELE medii (Postgres gol din
-- sql-verify + stack-ul Supabase din E2E). Autonom, ROLLBACK la final.
--
-- Tot ce atinge ACL/RLS se apelează SUB rolul REAL (`authenticated` / `anon`):
-- ca `postgres` EXECUTE și RLS sunt ocolite, deci „non-fondatorul e respins" ar
-- fi vacuu (clasa PF/TP24). Verificările de stare se fac ÎNAPOI ca postgres.
--
--   IN1  catalog: 11 RPC-uri DEFINER + pg_temp, o singură semnătură, EXECUTE
--        doar authenticated; helperii + funcția de trigger la NIMENI; tabelele
--        fără politici și fără privilegii; apel REAL ca anon → 42501 pe funcție
--   IN2  non-fondator (cont simplu, afiliat vechi, anon) → 42501 pe FIECARE RPC
--        admin_*, nimic scris (control pozitiv: IN3 face aceleași apeluri ca F)
--   IN3  FAIL-CLOSED cât contractul e nepublicat: nici o invitație nu se creează
--        (fondator ȘI șef), niciuna nu se răscumpără, invitația rămâne neatinsă;
--        versiunile DRAFT/invalide refuzate; publicarea e în audit
--   IN4  tokenul: 43 de caractere URL-safe, doar hash-ul stă în tabelă, tokenul
--        lipsește din ORICE tabelă din public (audit, acceptări, lista, note)
--   IN5  răscumpărarea de ȘEF: cont active fără părinte, cascade 2000, cod
--        dictabil, acceptare cu versiune/hash/CUI normalizat, email GOLIT;
--        folosire dublă de alt cont → invalid; dublu-submit → idempotent
--   IN6  ANTI-ORACOL: inexistent / expirat / revocat / folosit / alt tip / email
--        nepotrivit / invitator suspendat — TOATE întorc exact aceeași valoare;
--        erorile de câmp NU depind de token (cui_invalid identic pe token bun/rău)
--   IN7  expirarea: marginea (`expires_at <= acum`) ambele părți
--   IN8  revocarea: neutilizată DA, idempotentă, folosită NU, necunoscută
--   IN9  concurența: `for update` pe invitație + handler unique_violation +
--        rate limit PREZENTE în corp (lacătul e re-entrant in-process → un test
--        in-process ar fi vacuu; dovada cu două sesiuni e în raport)
--   IN10 CUI: CUI-uri reale valide/invalide, normalizare, răscumpărare respinsă
--        cu invitația NEfolosită
--   IN11 câmpurile contractului: versiune ≠ publicată, hash prost, telefon scurt
--   IN12 acceptarea e APPEND-ONLY: UPDATE/DELETE/TRUNCATE respinse (și ca rol client)
--   IN13 fluxul de AGENT: invitat de șef, activ imediat, părinte = șef; plafon de
--        invitații deschise; șef fără contract / suspendat / agent → refuzat;
--        retragerea de către șef
--   IN14 depth-1: invitator care e el însuși agent → refuz CURAT (nu eroare la
--        COMMIT); șeful nu primește părinte (CHECK)
--   IN15 consimțământ + `get_sales_network`: contact ascuns fără consimțământ,
--        doar recruții DIRECȚI, formă ÎNGHEȚATĂ, zero date de clienți/IBAN/Stripe;
--        RLS „own row" (249) neschimbat
--   IN16 cascade_bps 200→2000 DOAR dacă e 200 (2500 al fondatorului se păstrează)
--   IN17 SUSPENDAREA îngheață comisioanele noi (agent și șef), cele scrise rămân,
--        reactivarea le reia; bonusul de 20% end-to-end; `closed` terminal
--   IN18 GDPR: ștergerea contului agentului/creatorului NU e blocată de FK-urile noi
--   IN19 rate limit pe răscumpări (a 11-a încercare → rate_limited)
--   IN20 programul public rămâne închis și neatins
--   IN21 lista fondatorului: formă, stări, fără token/hash; scanare globală finală
--   IN22 UNICITATE CUI: același CUI ca șeful / ca alt șef respins (`cui_conflict`),
--        doar ULTIMA acceptare contează, închis/șters eliberează, formatul nu ocolește
--   IN23 D8 ÎN DATE: programul public redeschis + register_affiliate / review nu pot
--        pune un cont fără invitație sub un șef (trigger deferred); `team` filtrează
--   IN24 IDENTITATEA: cont anonim respins; invitația cu email cere email CONFIRMAT
--   IN25 hash legat de versiune (`contract_hash_mismatch`), reguli de versiune,
--        `contact_sharing_at` stabil, revocarea golește email/notă
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Fixtură ──────────────────────────────────────────────────────────────────
-- F fondator · N cont simplu · L afiliat vechi (program public) · H1/H2 șefi ·
-- G1..G3 agenți · Q1..Q4 răscumpărători · C clientul unui agent
insert into auth.users (id, email) values
  ('5a000000-0000-4000-8000-0000000000f1', 'in-founder@in302.test'),
  ('5a000000-0000-4000-8000-0000000000e1', 'in-nobody@in302.test'),
  ('5a000000-0000-4000-8000-0000000000e2', 'in-legacy@in302.test'),
  ('5a000000-0000-4000-8000-000000000001', 'in-h1@in302.test'),
  ('5a000000-0000-4000-8000-000000000002', 'in-h2@in302.test'),
  ('5a000000-0000-4000-8000-000000000011', 'in-g1@in302.test'),
  ('5a000000-0000-4000-8000-000000000012', 'in-g2@in302.test'),
  ('5a000000-0000-4000-8000-000000000013', 'in-g3@in302.test'),
  ('5a000000-0000-4000-8000-000000000021', 'in-q1@in302.test'),
  ('5a000000-0000-4000-8000-000000000022', 'in-q2@in302.test'),
  ('5a000000-0000-4000-8000-000000000023', 'in-q3@in302.test'),
  ('5a000000-0000-4000-8000-000000000024', 'in-q4@in302.test'),
  ('5a000000-0000-4000-8000-000000000031', 'in-client@in302.test'),
  ('5a000000-0000-4000-8000-000000000041', 'in-hx@in302.test'),
  ('5a000000-0000-4000-8000-000000000042', 'in-creator@in302.test'),
  ('5a000000-0000-4000-8000-000000000043', 'in-rl@in302.test'),
  ('5a000000-0000-4000-8000-000000000044', 'in-newuser@in302.test'),
  ('5a000000-0000-4000-8000-000000000045', 'in-ghost@in302.test'),
  ('5a000000-0000-4000-8000-000000000046', 'in-client2@in302.test'),
  ('5a000000-0000-4000-8000-000000000047', 'in-rl2@in302.test'),
  ('5a000000-0000-4000-8000-000000000048', 'in-q5@in302.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email)
  select id, email from auth.users where email like 'in-%@in302.test'
  on conflict (id) do nothing;
-- Schema mock din CI (sql-verify) nu are coloanele din GoTrue pe care le citește
-- răscumpărarea; pe stack-ul Supabase real ele există (blocul e atunci un no-op).
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
-- Toate conturile de test au emailul confirmat; excepțiile (anonim / neconfirmat)
-- se construiesc explicit, cu `pg_temp.in_mkuser`, în IN24.
update auth.users set email_confirmed_at = now() where email like 'in-%@in302.test';

update public.profiles set is_platform_admin = true
 where id = '5a000000-0000-4000-8000-0000000000f1';
update public.profiles set full_name = 'Ion Șef'     where id = '5a000000-0000-4000-8000-000000000001';
update public.profiles set full_name = 'Ana Agent'   where id = '5a000000-0000-4000-8000-000000000011';
update public.profiles set full_name = 'Dan Agent'   where id = '5a000000-0000-4000-8000-000000000012';

-- Afiliat VECHI (programul public), fără rol în rețea.
insert into public.affiliates (id, profile_id, referral_code) values
  ('5aa00000-0000-4000-8000-0000000000e2', '5a000000-0000-4000-8000-0000000000e2', 'inlegacy1');

-- Tokenurile create în test (pentru scanarea globală de la final).
create temp table in_tokens (label text primary key, token text not null) on commit drop;

-- Rulează un apel jsonb SUB rolul indicat, ca utilizatorul dat. Întoarce
-- rezultatul sau {raised:true, sqlstate, hint, error} dacă apelul aruncă.
create function pg_temp.in_as(p_role text, p_uid uuid, p_sql text) returns jsonb
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

create function pg_temp.in_u(p_uid uuid, p_sql text) returns jsonb
language sql as $$ select pg_temp.in_as('authenticated', p_uid, p_sql) $$;

-- CUI-uri VALIDE și distincte pentru răscumpările fără CUI explicit (unicitatea CUI e
-- impusă de mig 302: două conturi nu pot declara același CUI).
create temp table in_cui_ctr (n int not null) on commit drop;
insert into in_cui_ctr values (0);
create function pg_temp.in_next_cui() returns text language plpgsql as $f$
declare v int;
begin
  update in_cui_ctr set n = n + 1 returning n into v;
  return (select x::text from generate_series(1000000, 1001000) x
           where public.normalize_ro_cui(x::text) is not null order by x offset v limit 1);
end $f$;

-- SQL-ul unui apel de răscumpărare (kind head|agent).
create function pg_temp.in_rs(p_kind text, p_token text,
  p_cui text default null, p_ver text default '1.0', p_hash text default null,
  p_phone text default '0722 111 222', p_share boolean default true) returns text
language sql as $$
  select format('public.%s(%L, %L, %L, %L, %L, %s)',
           case p_kind when 'head' then 'redeem_sales_head_invite' else 'redeem_agent_invite' end,
           p_token, p_phone, coalesce(p_cui, pg_temp.in_next_cui()), p_ver, coalesce(p_hash, repeat('a', 64)), case when p_share then 'true' else 'false' end)
$$;

create function pg_temp.in_seed_inv(p_kind text, p_token text, p_by uuid,
  p_email text default null, p_created timestamptz default null, p_expires timestamptz default null)
returns uuid language sql as $$
  insert into public.affiliate_invitations
    (kind, token_hash, invited_by_affiliate_id, email, created_at, expires_at)
  values (p_kind, public.sales_invite_token_hash(p_token), p_by, p_email,
          coalesce(p_created, clock_timestamp()),
          coalesce(p_expires, clock_timestamp() + interval '14 days'))
  returning id
$$;

-- Cont nou, cu email confirmat (implicit), non-anonim.
create function pg_temp.in_mkuser(p_label text, p_confirmed boolean default true) returns uuid
language plpgsql as $f$
declare v_id uuid := md5('in302:' || p_label)::uuid;
begin
  insert into auth.users (id, email, email_confirmed_at)
    values (v_id, 'in-' || p_label || '@in302.test', case when p_confirmed then now() end);
  insert into public.profiles (id, email) values (v_id, 'in-' || p_label || '@in302.test') on conflict (id) do nothing;
  return v_id;
end $f$;

-- Publică contractul 1.0 cu hash-ul 'aaa…a' (ca fondator).
create function pg_temp.in_publish(p_ver text default '1.0', p_hash text default null) returns jsonb
language sql as $$
  select pg_temp.in_u('5a000000-0000-4000-8000-0000000000f1',
           format('public.admin_set_sales_contract_version(%L, %L)', p_ver, coalesce(p_hash, repeat('a', 64))))
$$;

create function pg_temp.in_inv_used(p_id uuid) returns boolean language sql as $$
  select used_at is not null from public.affiliate_invitations where id = p_id
$$;

-- ── IN1: catalog ─────────────────────────────────────────────────────────────
do $$
declare
  fn text; v_oid oid; v_n int; v_state text; v_msg text;
  v_pub text[] := array[
    'admin_set_sales_contract_version', 'admin_create_sales_head_invite',
    'admin_revoke_affiliate_invite', 'admin_list_affiliate_invites',
    'admin_set_affiliate_status', 'redeem_sales_head_invite', 'redeem_agent_invite',
    'create_agent_invite', 'revoke_agent_invite', 'set_my_contact_sharing',
    'get_sales_network'];
  v_int text[] := array[
    'sales_invite_ttl_days', 'sales_open_invites_max', 'sales_contract_published_version',
    'sales_contract_published_hash', 'fn_affiliate_sales_role_parent',
    'normalize_ro_cui', 'is_valid_ro_cui', 'new_sales_invite_token',
    'sales_invite_token_hash', 'sales_network_apply_cascade_default',
    'sales_invite_redeem', 'fn_contract_acceptance_immutable'];
  v_tbl text;
begin
  foreach fn in array v_pub loop
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn;
    if v_n <> 1 then raise exception 'IN1 FAIL: % are % semnături', fn, v_n; end if;
    select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn;
    if not exists (select 1 from pg_proc p where p.oid = v_oid and p.prosecdef
                    and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%pg_temp%')) then
      raise exception 'IN1 FAIL: % nu e DEFINER cu pg_temp', fn; end if;
    if has_function_privilege('anon', v_oid, 'EXECUTE') or has_function_privilege('service_role', v_oid, 'EXECUTE') then
      raise exception 'IN1 FAIL: % e apelabilă de anon/service_role', fn; end if;
    if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
      raise exception 'IN1 FAIL (control pozitiv): % nu e apelabilă de authenticated', fn; end if;
  end loop;

  foreach fn in array v_int loop
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn;
    if v_n <> 1 then raise exception 'IN1 FAIL: helperul % are % semnături', fn, v_n; end if;
    for v_oid in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = fn loop
      if has_function_privilege('anon', v_oid, 'EXECUTE') or has_function_privilege('authenticated', v_oid, 'EXECUTE')
         or has_function_privilege('service_role', v_oid, 'EXECUTE') then
        raise exception 'IN1 FAIL: helperul % e apelabil de un rol client', fn; end if;
    end loop;
  end loop;

  -- CLICHET DE CLASĂ (prin descoperire): orice funcție din `public` al cărei corp atinge
  -- tabelele rețelei NU e apelabilă de anon/service_role — o funcție VIITOARE care le
  -- citește cu un grant larg face CI roșu aici, fără să fie nevoie s-o enumerăm.
  v_n := 0;
  for v_oid, fn in
    select p.oid, p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.prosrc ~ 'affiliate_invitations|affiliate_contract_acceptances'
  loop
    v_n := v_n + 1;
    if has_function_privilege('anon', v_oid, 'EXECUTE') or has_function_privilege('service_role', v_oid, 'EXECUTE') then
      raise exception 'IN1 FAIL: % atinge tabelele rețelei și e apelabilă de anon/service_role', fn; end if;
  end loop;
  if v_n < 7 then raise exception 'IN1 FAIL (anti-vacuitate): doar % funcții descoperite care ating tabelele rețelei', v_n; end if;

  -- Tabelele: RLS pornit, ZERO politici, zero privilegii pentru niciun rol client.
  foreach v_tbl in array array['affiliate_invitations', 'affiliate_contract_acceptances'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || v_tbl)::regclass) then
      raise exception 'IN1 FAIL: RLS oprit pe %', v_tbl; end if;
    if exists (select 1 from pg_policy where polrelid = ('public.' || v_tbl)::regclass) then
      raise exception 'IN1 FAIL: % are politici', v_tbl; end if;
    if has_table_privilege('anon', ('public.' || v_tbl)::regclass, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
       or has_table_privilege('authenticated', ('public.' || v_tbl)::regclass, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
       or has_table_privilege('service_role', ('public.' || v_tbl)::regclass, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception 'IN1 FAIL: % are privilegii pentru un rol client', v_tbl; end if;
  end loop;

  -- Apel REAL ca anon: pică pe ACL-ul FUNCȚIEI (nu pe schemă/corp).
  perform set_config('role', 'anon', true);
  begin
    perform public.get_sales_network();
    perform set_config('role', 'none', true);
    raise exception 'IN1 FAIL: anon a apelat get_sales_network';
  exception when insufficient_privilege then
    get stacked diagnostics v_msg = message_text;
    perform set_config('role', 'none', true);
    if v_msg not like '%for function%' then
      raise exception 'IN1 FAIL: anon a picat dar nu pe ACL-ul funcției: %', v_msg; end if;
  end;
  raise notice 'IN1 OK: 11 RPC-uri DEFINER/pg_temp doar authenticated, 10 helperi închiși, tabele deny-all, anon → 42501 pe funcție';
end $$;

-- ── IN2: non-fondator → 42501 pe fiecare RPC admin ──────────────────────────
do $$
declare
  v_calls text[] := array[
    $q$public.admin_set_sales_contract_version('9.9', repeat('a', 64))$q$,
    $q$public.admin_create_sales_head_invite('x@y.ro', 'n')$q$,
    $q$public.admin_revoke_affiliate_invite('5aa00000-0000-4000-8000-0000000000aa')$q$,
    $q$public.admin_list_affiliate_invites()$q$,
    $q$public.admin_set_affiliate_status('5aa00000-0000-4000-8000-0000000000e2', 'suspended', 'test motiv')$q$];
  v_who record; v_sql text; v jsonb;
begin
  for v_who in select * from (values
      ('authenticated', '5a000000-0000-4000-8000-0000000000e1'::uuid),   -- cont simplu
      ('authenticated', '5a000000-0000-4000-8000-0000000000e2'::uuid),   -- afiliatul însuși
      ('anon',          null::uuid),
      ('service_role',  null::uuid)) t(role, uid) loop
    foreach v_sql in array v_calls loop
      v := pg_temp.in_as(v_who.role, v_who.uid, v_sql);
      if (v->>'raised') is distinct from 'true' or (v->>'sqlstate') is distinct from '42501' then
        raise exception 'IN2 FAIL: % ca % nu e 42501: %', v_sql, v_who.role, v; end if;
      -- Pentru rolurile cu EXECUTE (authenticated) hint-ul vine din corp.
      if v_who.role = 'authenticated' and (v->>'hint') is distinct from 'not_platform_admin' then
        raise exception 'IN2 FAIL: % ca authenticated fără hint not_platform_admin: %', v_sql, v; end if;
    end loop;
  end loop;
  if exists (select 1 from public.affiliate_invitations) then
    raise exception 'IN2 FAIL: un apel respins a scris o invitație'; end if;
  if (select status from public.affiliates where id = '5aa00000-0000-4000-8000-0000000000e2') <> 'active' then
    raise exception 'IN2 FAIL: afiliatul a fost suspendat de un non-fondator'; end if;
  if (select value from public.platform_settings where key = 'sales_contract_version') is distinct from 'null'::jsonb then
    raise exception 'IN2 FAIL: versiunea contractului s-a schimbat'; end if;
  raise notice 'IN2 OK: 5 RPC-uri admin × (cont simplu, afiliat, anon, service_role) → 42501, nimic scris';
end $$;

-- ── IN3: FAIL-CLOSED cât contractul e nepublicat ────────────────────────────
do $$
declare
  F constant uuid := '5a000000-0000-4000-8000-0000000000f1';
  v jsonb; v_inv uuid; v_head uuid := '5aa00000-0000-4000-8000-0000000000b1';
begin
  if public.sales_contract_published_version() is not null then
    raise exception 'IN3 FAIL: contractul apare publicat în starea inițială'; end if;

  -- Fondatorul NU poate crea invitație.
  v := pg_temp.in_u(F, $q$public.admin_create_sales_head_invite('a@b.ro', 'n')$q$);
  if v is distinct from '{"ok": false, "reason": "contract_not_published"}'::jsonb then
    raise exception 'IN3 FAIL: fondatorul a putut crea o invitație fără contract: %', v; end if;
  if exists (select 1 from public.affiliate_invitations) then
    raise exception 'IN3 FAIL: s-a scris o invitație'; end if;

  -- Un ȘEF existent (inserat direct) NU poate crea invitație de agent.
  insert into auth.users (id, email) values ('5a000000-0000-4000-8000-000000000051', 'in-hold@in302.test');
  insert into public.profiles (id, email) values ('5a000000-0000-4000-8000-000000000051', 'in-hold@in302.test')
    on conflict (id) do nothing;
  insert into public.affiliates (id, profile_id, referral_code, sales_role)
    values (v_head, '5a000000-0000-4000-8000-000000000051', 'inhold01', 'head');
  insert into public.affiliate_contract_acceptances (affiliate_id, kind, contract_version, text_hash, declared_cui)
    values (v_head, 'head', '0.1', repeat('c', 64), '5022670');
  v := pg_temp.in_u('5a000000-0000-4000-8000-000000000051', $q$public.create_agent_invite('n')$q$);
  if v is distinct from '{"ok": false, "reason": "contract_not_published"}'::jsonb then
    raise exception 'IN3 FAIL: șeful a creat invitație fără contract publicat: %', v; end if;

  -- O invitație EXISTENTĂ (inserată direct) nu se răscumpără.
  v_inv := pg_temp.in_seed_inv('head', 'tok-in3-existent', null);
  v := pg_temp.in_u('5a000000-0000-4000-8000-000000000021', pg_temp.in_rs('head', 'tok-in3-existent', p_ver => '1.0'));
  if v is distinct from '{"ok": false, "reason": "contract_not_published"}'::jsonb then
    raise exception 'IN3 FAIL: răscumpărare fără contract publicat: %', v; end if;
  if pg_temp.in_inv_used(v_inv) or exists (select 1 from public.affiliates where profile_id = '5a000000-0000-4000-8000-000000000021') then
    raise exception 'IN3 FAIL: invitația s-a consumat / s-a creat cont'; end if;
  delete from public.affiliate_invitations where id = v_inv;

  -- Versiuni refuzate: DRAFT (orice majusculă), cuvinte rezervate, formă invalidă, hash prost.
  v := pg_temp.in_publish('agent-1.0-DRAFT');
  if v is distinct from '{"ok": false, "reason": "draft_version"}'::jsonb then raise exception 'IN3 FAIL: DRAFT publicat: %', v; end if;
  v := pg_temp.in_publish('1.0 draft');
  if v is distinct from '{"ok": false, "reason": "draft_version"}'::jsonb then raise exception 'IN3 FAIL: "1.0 draft": %', v; end if;
  v := pg_temp.in_publish('v 1');
  if v is distinct from '{"ok": false, "reason": "invalid_version"}'::jsonb then raise exception 'IN3 FAIL: versiune cu spațiu: %', v; end if;
  v := pg_temp.in_publish('1.0', 'abc');
  if v is distinct from '{"ok": false, "reason": "invalid_text_hash"}'::jsonb then raise exception 'IN3 FAIL: hash scurt la publicare: %', v; end if;
  v := pg_temp.in_u(F, $q$public.admin_set_sales_contract_version('1.0', null)$q$);
  if v is distinct from '{"ok": false, "reason": "invalid_text_hash"}'::jsonb then raise exception 'IN3 FAIL: hash NULL la publicare: %', v; end if;
  if public.sales_contract_published_version() is not null then
    raise exception 'IN3 FAIL: o versiune refuzată a ajuns publicată'; end if;

  -- Orice altceva decât obiectul {version, text_hash} valid = NEPUBLICAT (fail-closed).
  update public.platform_settings set value = '1'::jsonb where key = 'sales_contract_version';
  if public.sales_contract_published_version() is not null then raise exception 'IN3 FAIL: număr tratat drept versiune'; end if;
  update public.platform_settings set value = '""'::jsonb where key = 'sales_contract_version';
  if public.sales_contract_published_version() is not null then raise exception 'IN3 FAIL: șir gol tratat drept versiune'; end if;
  update public.platform_settings set value = '"1.0"'::jsonb where key = 'sales_contract_version';
  if public.sales_contract_published_version() is not null or public.sales_contract_published_hash() is not null then
    raise exception 'IN3 FAIL: șirul simplu FĂRĂ hash tratat drept publicat'; end if;
  update public.platform_settings set value = '{"version":"1.0"}'::jsonb where key = 'sales_contract_version';
  if public.sales_contract_published_version() is not null then raise exception 'IN3 FAIL: obiect fără hash tratat drept publicat'; end if;
  update public.platform_settings set value = jsonb_build_object('version', '1.0', 'text_hash', repeat('A', 64)) where key = 'sales_contract_version';
  if public.sales_contract_published_version() is not null then raise exception 'IN3 FAIL: hash cu majuscule tratat drept publicat'; end if;
  update public.platform_settings set value = jsonb_build_object('version', '1.0', 'text_hash', 'zzz') where key = 'sales_contract_version';
  if public.sales_contract_published_version() is not null then raise exception 'IN3 FAIL: hash prost tratat drept publicat'; end if;
  update public.platform_settings set value = jsonb_build_object('version', 1, 'text_hash', repeat('a', 64)) where key = 'sales_contract_version';
  if public.sales_contract_published_version() is not null then raise exception 'IN3 FAIL: versiune numerică tratată drept publicată'; end if;
  update public.platform_settings set value = '{"v":"1.0"}'::jsonb where key = 'sales_contract_version';
  if public.sales_contract_published_version() is not null then raise exception 'IN3 FAIL: obiect străin tratat drept versiune'; end if;
  delete from public.platform_settings where key = 'sales_contract_version';
  if public.sales_contract_published_version() is not null then raise exception 'IN3 FAIL: cheie absentă tratată drept versiune'; end if;
  insert into public.platform_settings (key, value) values ('sales_contract_version', 'null'::jsonb);

  -- Publicarea (control pozitiv) + audit cu versiune ȘI hash.
  v := pg_temp.in_publish('1.0');
  if v is distinct from jsonb_build_object('ok', true, 'version', '1.0', 'text_hash', repeat('a', 64), 'previous', null) then
    raise exception 'IN3 FAIL: publicarea 1.0 respinsă: %', v; end if;
  if public.sales_contract_published_version() is distinct from '1.0'
     or public.sales_contract_published_hash() is distinct from repeat('a', 64)
     or (select value from public.platform_settings where key = 'sales_contract_version')
          is distinct from jsonb_build_object('version', '1.0', 'text_hash', repeat('a', 64)) then
    raise exception 'IN3 FAIL: formatul setării publicate'; end if;
  if not exists (select 1 from public.platform_audit_log
                  where action = 'sales_contract_version_set' and details ->> 'new' = '1.0'
                    and details ->> 'new_text_hash' = repeat('a', 64) and actor_user_id = F) then
    raise exception 'IN3 FAIL: publicarea nu e în audit'; end if;
  -- Retragerea (NULL) blochează din nou; re-publicare.
  v := pg_temp.in_u(F, $q$public.admin_set_sales_contract_version(null, null)$q$);
  if (v->>'ok') is distinct from 'true' or public.sales_contract_published_version() is not null
     or public.sales_contract_published_hash() is not null then
    raise exception 'IN3 FAIL: retragerea contractului: %', v; end if;
  v := pg_temp.in_publish('1.0');
  if (v->>'ok') is distinct from 'true' then raise exception 'IN3 FAIL: re-publicare: %', v; end if;
  raise notice 'IN3 OK: contract nepublicat → nicio invitație creată/răscumpărată (fondator, șef, existentă); DRAFT/invalid refuzate; fail-closed pe forme ciudate; publicare auditată';
end $$;

-- ── IN4 + IN5: invitația de ȘEF, tokenul și răscumpărarea ───────────────────
do $$
declare
  F constant uuid := '5a000000-0000-4000-8000-0000000000f1';
  H1 constant uuid := '5a000000-0000-4000-8000-000000000001';
  v jsonb; v_tok text; v_id uuid; v_inv public.affiliate_invitations%rowtype;
  v_aff public.affiliates%rowtype; v_acc public.affiliate_contract_acceptances%rowtype;
  v_list jsonb;
begin
  -- Email cu majuscule: se normalizează; răscumpărătorul are același email.
  v := pg_temp.in_u(F, $q$public.admin_create_sales_head_invite('  IN-H1@in302.TEST ', 'primul șef')$q$);
  if (v->>'ok') is distinct from 'true' or v->>'kind' is distinct from 'head' then
    raise exception 'IN4 FAIL: crearea invitației de șef: %', v; end if;
  v_tok := v->>'token'; v_id := (v->>'invite_id')::uuid;
  insert into in_tokens values ('head1', v_tok);

  if v_tok !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'IN4 FAIL: format token: %', v_tok; end if;
  select * into v_inv from public.affiliate_invitations where id = v_id;
  if v_inv.token_hash is distinct from encode(extensions.digest(convert_to(v_tok, 'utf8'), 'sha256'), 'hex')
     or v_inv.token_hash = v_tok then
    raise exception 'IN4 FAIL: token_hash ≠ sha256(token) sau egal cu tokenul'; end if;
  if v_inv.email is distinct from 'in-h1@in302.test' then
    raise exception 'IN4 FAIL: emailul nu e normalizat: %', v_inv.email; end if;
  if v_inv.kind <> 'head' or v_inv.invited_by_affiliate_id is not null
     or v_inv.created_by_profile_id is distinct from F
     or v_inv.expires_at < clock_timestamp() + interval '13 days 23 hours'
     or v_inv.expires_at > clock_timestamp() + interval '14 days 1 hour' then
    raise exception 'IN4 FAIL: rândul invitației: %', to_jsonb(v_inv); end if;
  if exists (select 1 from public.platform_audit_log where details::text like '%' || v_tok || '%'
                or details::text like '%in-h1@in302%') then
    raise exception 'IN4 FAIL: tokenul/emailul a ajuns în audit'; end if;
  -- Lista fondatorului: fără token/hash.
  v_list := pg_temp.in_u(F, $q$public.admin_list_affiliate_invites()$q$);
  if v_list::text like '%' || v_tok || '%' or v_list::text like '%' || v_inv.token_hash || '%'
     or v_list::text like '%token%' then
    raise exception 'IN4 FAIL: lista admin conține token/hash: %', v_list; end if;

  -- Emailul invitației nu se potrivește → invite_invalid ÎNAINTE de orice cont.
  v := pg_temp.in_u('5a000000-0000-4000-8000-000000000021', pg_temp.in_rs('head', v_tok));
  if v is distinct from '{"ok": false, "reason": "invite_invalid"}'::jsonb then
    raise exception 'IN5 FAIL: alt email a răscumpărat invitația: %', v; end if;

  -- Răscumpărarea de H1 (email potrivit), cu consimțământ de contact.
  v := pg_temp.in_u(H1, pg_temp.in_rs('head', v_tok, p_cui => 'RO 14399840', p_hash => repeat('A', 64)));
  if (v->>'ok') is distinct from 'true' or v->>'role' is distinct from 'head' or v->>'status' is distinct from 'active'
     or (v->>'parent_affiliate_id') is not null or v ? 'already' then
    raise exception 'IN5 FAIL: răscumpărarea șefului: %', v; end if;
  select * into v_aff from public.affiliates where profile_id = H1;
  if v_aff.id is distinct from (v->>'affiliate_id')::uuid or v_aff.sales_role <> 'head'
     or v_aff.parent_affiliate_id is not null or v_aff.status <> 'active'
     or v_aff.phone <> '0722 111 222' or v_aff.contact_sharing is not true or v_aff.contact_sharing_at is null
     or v_aff.cascade_bps <> 2000 or v_aff.setup_bps <> 3000 or v_aff.recurring_bps <> 1000
     or v_aff.referral_code !~ '^[abcdefghjkmnpqrstuvwxyz2-9]{7}$' then
    raise exception 'IN5 FAIL: rândul afiliatului: %', to_jsonb(v_aff); end if;
  select * into v_acc from public.affiliate_contract_acceptances where affiliate_id = v_aff.id;
  if v_acc.kind <> 'head' or v_acc.contract_version <> '1.0' or v_acc.text_hash <> repeat('a', 64)
     or v_acc.declared_cui <> '14399840' or v_acc.invitation_id <> v_id then
    raise exception 'IN5 FAIL: acceptarea: %', to_jsonb(v_acc); end if;
  select * into v_inv from public.affiliate_invitations where id = v_id;
  if v_inv.used_at is null or v_inv.used_by_profile_id <> H1 or v_inv.used_by_affiliate_id <> v_aff.id
     or v_inv.email is not null then
    raise exception 'IN5 FAIL: invitația după folosire (email golit?): %', to_jsonb(v_inv); end if;

  -- Dublu-submit al ACELUIAȘI token de același cont: idempotent, nimic dublat.
  v := pg_temp.in_u(H1, pg_temp.in_rs('head', v_tok));
  if (v->>'ok') is distinct from 'true' or (v->>'already') is distinct from 'true'
     or (v->>'affiliate_id')::uuid <> v_aff.id then
    raise exception 'IN5 FAIL: dublu-submit nu e idempotent: %', v; end if;
  if (select count(*) from public.affiliates where profile_id = H1) <> 1
     or (select count(*) from public.affiliate_contract_acceptances where affiliate_id = v_aff.id) <> 1 then
    raise exception 'IN5 FAIL: dublu-submit a dublat rânduri'; end if;

  -- Folosire dublă de ALT cont → invite_invalid; contul nu se creează.
  v := pg_temp.in_u('5a000000-0000-4000-8000-000000000022', pg_temp.in_rs('head', v_tok));
  if v is distinct from '{"ok": false, "reason": "invite_invalid"}'::jsonb
     or exists (select 1 from public.affiliates where profile_id = '5a000000-0000-4000-8000-000000000022') then
    raise exception 'IN5 FAIL: al doilea cont a folosit tokenul: %', v; end if;
  -- Un cont deja afiliat cu ALT token → already_affiliate (tokenul rămâne nefolosit).
  v := pg_temp.in_u(H1, pg_temp.in_rs('head', 'alt-token-inexistent'));
  if v is distinct from '{"ok": false, "reason": "already_affiliate"}'::jsonb then
    raise exception 'IN5 FAIL: afiliat existent: %', v; end if;
  raise notice 'IN4/IN5 OK: token 43 URL-safe, doar hash în tabelă, email normalizat și golit la folosire, șef active/fără părinte/cascade 2000, acceptare cu CUI normalizat, dublu-submit idempotent';
end $$;

-- ── IN6 + IN7 + IN8: anti-oracol, expirare, revocare ────────────────────────
do $$
declare
  F constant uuid := '5a000000-0000-4000-8000-0000000000f1';
  Q1 constant uuid := '5a000000-0000-4000-8000-000000000021';
  Q2 constant uuid := '5a000000-0000-4000-8000-000000000022';
  Q3 constant uuid := '5a000000-0000-4000-8000-000000000023';
  H1 constant uuid := '5a000000-0000-4000-8000-000000000001';
  v_h1 uuid; v_hx uuid := '5aa00000-0000-4000-8000-0000000000b2';
  want constant jsonb := '{"ok": false, "reason": "invite_invalid"}';
  v jsonb; v_id uuid; v_tok text; v_res jsonb[] := '{}'; i int;
begin
  select id into v_h1 from public.affiliates where profile_id = H1;

  -- 1. inexistent
  v_res := v_res || pg_temp.in_u(Q1, pg_temp.in_rs('head', 'token-care-nu-exista-deloc'));

  -- 2. expirat (created în trecut, expires_at în trecut)
  perform pg_temp.in_seed_inv('head', 'tok-in6-expirat', null, null, now() - interval '2 days', now() - interval '1 second');
  v_res := v_res || pg_temp.in_u(Q1, pg_temp.in_rs('head', 'tok-in6-expirat'));

  -- 3. revocat (prin RPC de fondator)
  v := pg_temp.in_u(F, $q$public.admin_create_sales_head_invite(null, 'de revocat')$q$);
  v_id := (v->>'invite_id')::uuid; v_tok := v->>'token';
  insert into in_tokens values ('head-revoked', v_tok);
  v := pg_temp.in_u(F, format('public.admin_revoke_affiliate_invite(%L)', v_id));
  if v is distinct from '{"ok": true}'::jsonb then raise exception 'IN8 FAIL: revocare: %', v; end if;
  v_res := v_res || pg_temp.in_u(Q1, pg_temp.in_rs('head', v_tok));
  -- IN8: idempotentă; rândul are revoked_at; audit
  v := pg_temp.in_u(F, format('public.admin_revoke_affiliate_invite(%L)', v_id));
  if v is distinct from '{"ok": true, "already": true}'::jsonb then raise exception 'IN8 FAIL: re-revocare: %', v; end if;
  if not exists (select 1 from public.platform_audit_log where action = 'sales_invite_revoked' and details ->> 'invite_id' = v_id::text) then
    raise exception 'IN8 FAIL: revocarea nu e în audit'; end if;

  -- 4. folosit (tokenul lui H1 din IN5)
  v_res := v_res || pg_temp.in_u(Q1, pg_temp.in_rs('head', (select token from in_tokens where label = 'head1')));

  -- 5. ALT TIP: token de agent la RPC-ul de șef
  perform pg_temp.in_seed_inv('agent', 'tok-in6-agent', v_h1);
  v_res := v_res || pg_temp.in_u(Q1, pg_temp.in_rs('head', 'tok-in6-agent'));

  -- 6. EMAIL nepotrivit (invitația e pentru altcineva)
  perform pg_temp.in_seed_inv('head', 'tok-in6-email', null, 'altcineva@exemplu.test');
  v_res := v_res || pg_temp.in_u(Q1, pg_temp.in_rs('head', 'tok-in6-email'));

  -- 7. invitator SUSPENDAT (agent token valid, dar șeful nu mai e activ)
  insert into public.affiliates (id, profile_id, referral_code, sales_role, status)
    values (v_hx, '5a000000-0000-4000-8000-000000000041', 'inhxsusp', 'head', 'suspended');
  perform pg_temp.in_seed_inv('agent', 'tok-in6-susp', v_hx);
  v_res := v_res || pg_temp.in_u(Q2, pg_temp.in_rs('agent', 'tok-in6-susp'));

  -- 8. agent token fără invitator (NULL) la RPC-ul de agent
  perform pg_temp.in_seed_inv('agent', 'tok-in6-orfan', null);
  v_res := v_res || pg_temp.in_u(Q2, pg_temp.in_rs('agent', 'tok-in6-orfan'));

  for i in 1..array_length(v_res, 1) loop
    if v_res[i] is distinct from want then
      raise exception 'IN6 FAIL: cazul % întoarce % (așteptat exact %)', i, v_res[i], want; end if;
  end loop;
  -- nimic nu s-a creat
  if exists (select 1 from public.affiliates where profile_id in (Q1, Q2)) then
    raise exception 'IN6 FAIL: un refuz a creat cont'; end if;

  -- IN6b: erorile de CÂMP nu depind de token (altfel ar fi oracol).
  perform pg_temp.in_seed_inv('head', 'tok-in6-bun', null);
  if pg_temp.in_u(Q3, pg_temp.in_rs('head', 'tok-in6-bun', p_cui => '1234567'))
       is distinct from pg_temp.in_u(Q3, pg_temp.in_rs('head', 'nu-exista-nici-asta', p_cui => '1234567'))
     or pg_temp.in_u(Q3, pg_temp.in_rs('head', 'tok-in6-bun', p_cui => '1234567')) is distinct from '{"ok": false, "reason": "cui_invalid"}'::jsonb then
    raise exception 'IN6 FAIL: cui_invalid depinde de validitatea tokenului'; end if;
  if pg_temp.in_u(Q3, pg_temp.in_rs('head', 'tok-in6-bun', p_ver => '0.5'))
       is distinct from pg_temp.in_u(Q3, pg_temp.in_rs('head', 'nu-exista-nici-asta', p_ver => '0.5')) then
    raise exception 'IN6 FAIL: contract_version_mismatch depinde de token'; end if;

  -- IN7: marginea expirării (control pozitiv: cu o oră rămasă se răscumpără).
  perform pg_temp.in_seed_inv('head', 'tok-in7-margine', null, null, now() - interval '1 day', clock_timestamp() - interval '1 millisecond');
  if pg_temp.in_u(Q3, pg_temp.in_rs('head', 'tok-in7-margine')) is distinct from want then
    raise exception 'IN7 FAIL: invitația expirată cu 1 ms s-a răscumpărat'; end if;
  perform pg_temp.in_seed_inv('head', 'tok-in7-ok', null, null, now() - interval '1 day', clock_timestamp() + interval '1 hour');
  v := pg_temp.in_u(Q3, pg_temp.in_rs('head', 'tok-in7-ok'));
  if (v->>'ok') is distinct from 'true' then raise exception 'IN7 FAIL (control): invitația cu o oră rămasă respinsă: %', v; end if;
  -- (Q3 devine șef; folosit mai jos ca H2-substitut pentru depth.)

  -- IN8: folosită NU se revocă; necunoscută
  v := pg_temp.in_u(F, format('public.admin_revoke_affiliate_invite(%L)',
         (select id from public.affiliate_invitations where used_at is not null limit 1)));
  if v is distinct from '{"ok": false, "reason": "already_used"}'::jsonb then raise exception 'IN8 FAIL: revocare invitație folosită: %', v; end if;
  v := pg_temp.in_u(F, $q$public.admin_revoke_affiliate_invite('5aa00000-0000-4000-8000-0000000000ff')$q$);
  if v is distinct from '{"ok": false, "reason": "invite_not_found"}'::jsonb then raise exception 'IN8 FAIL: invitație necunoscută: %', v; end if;
  raise notice 'IN6/IN7/IN8 OK: 8 cauze (inexistent/expirat/revocat/folosit/alt tip/email/invitator suspendat/orfan) → ACEEAȘI valoare; câmpurile nu depind de token; marginea de 1 ms; revocare idempotentă';
end $$;

-- ── IN9: concurența — structural ────────────────────────────────────────────
do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc where oid = 'public.sales_invite_redeem(text,text,text,text,text,text,boolean)'::regprocedure;
  -- `for update` pe INVITAȚIE (nu doar pe orice rând), înainte de verificările de stare.
  if v_src !~ 'from public\.affiliate_invitations\s+where token_hash = [^;]+for update;' then
    raise exception 'IN9 FAIL: lipsește `for update` pe invitația din sales_invite_redeem'; end if;
  if position('exception when unique_violation' in v_src) = 0 or position('raise;' in v_src) = 0 then
    raise exception 'IN9 FAIL: lipsește handler-ul unique_violation (cu re-aruncarea celorlalte violări)'; end if;
  if position('check_rate_limit(''redeem_sales_invite''' in v_src) = 0 then
    raise exception 'IN9 FAIL: lipsește rate limit-ul pe răscumpărări'; end if;
  -- rate limit-ul vine ÎNAINTEA căutării tokenului
  if position('check_rate_limit' in v_src) > position('sales_invite_token_hash' in v_src) then
    raise exception 'IN9 FAIL: rate limit-ul nu e înaintea căutării tokenului'; end if;
  -- șeful invitator e blocat `for share` (suspendarea concurentă e așteptată)
  if v_src !~ 'from public\.affiliates\s+where id = v_inv\.invited_by_affiliate_id for share' then
    raise exception 'IN9 FAIL: invitatorul nu e blocat `for share`'; end if;
  -- crearea invitațiilor de agent serializează pe rândul șefului
  if (select prosrc from pg_proc where oid = 'public.create_agent_invite(text)'::regprocedure)
       !~ 'where profile_id = v_uid for update' then
    raise exception 'IN9 FAIL: create_agent_invite nu ia lacăt pe rândul șefului (plafon inexact)'; end if;
  raise notice 'IN9 OK: for update (invitație) + for share (șef) + unique_violation/raise + rate limit înaintea tokenului (concurența reală: două sesiuni psql, vezi raportul)';
end $$;

-- ── IN10: CUI ───────────────────────────────────────────────────────────────
do $$
declare
  Q4 constant uuid := '5a000000-0000-4000-8000-000000000024';
  c text; v jsonb; v_id uuid;
begin
  -- CUI-uri REALE valide (BT, eMAG, Dedeman, Orange, Carrefour, ...), cu/ fără RO, spații, litere mici
  foreach c in array array['5022670', 'RO5022670', 'ro 5022670', ' RO 14399840 ', '2816464', '9010105', '11588780', '18547290'] loop
    if not public.is_valid_ro_cui(c) then raise exception 'IN10 FAIL: CUI valid respins: %', c; end if;
  end loop;
  if public.normalize_ro_cui(' ro 14399840 ') is distinct from '14399840' then
    raise exception 'IN10 FAIL: normalizare'; end if;
  -- invalide: cifră de control greșită, prea scurt/lung, litere, gol, NULL, doar prefix
  foreach c in array array['5022671', '14399841', '1', '12345678901', '50226a0', '', 'RO', 'RO-5022670', '5022 670x', '0000000', '05022670'] loop
    if public.is_valid_ro_cui(c) then raise exception 'IN10 FAIL: CUI invalid acceptat: %', c; end if;
  end loop;
  if public.is_valid_ro_cui(null) or public.normalize_ro_cui(null) is not null then
    raise exception 'IN10 FAIL: NULL acceptat'; end if;
  -- CUI de 2 cifre (minimul): '19' are controlul corect (1·2=2 → 20 mod 11 = 9), '10' nu
  if not public.is_valid_ro_cui('19') or public.is_valid_ro_cui('10') then
    raise exception 'IN10 FAIL: CUI de 2 cifre'; end if;

  -- Răscumpărare cu CUI invalid: respinsă, invitația NEfolosită, fără cont.
  v_id := pg_temp.in_seed_inv('head', 'tok-in10', null);
  foreach c in array array['5022671', 'abc', '', 'RO'] loop
    v := pg_temp.in_u(Q4, pg_temp.in_rs('head', 'tok-in10', p_cui => c));
    if v is distinct from '{"ok": false, "reason": "cui_invalid"}'::jsonb then
      raise exception 'IN10 FAIL: CUI "%" → %', c, v; end if;
  end loop;
  v := pg_temp.in_u(Q4, 'public.redeem_sales_head_invite(''tok-in10'', ''0722111222'', null, ''1.0'', ''' || repeat('a', 64) || ''', false)');
  if v is distinct from '{"ok": false, "reason": "cui_invalid"}'::jsonb then raise exception 'IN10 FAIL: CUI NULL: %', v; end if;
  if pg_temp.in_inv_used(v_id) or exists (select 1 from public.affiliates where profile_id = Q4)
     or exists (select 1 from public.affiliate_contract_acceptances where declared_cui = '5022671') then
    raise exception 'IN10 FAIL: un CUI invalid a consumat invitația / creat cont / acceptare'; end if;
  -- backstop în DATE: nici un INSERT direct cu CUI prost
  begin
    insert into public.affiliate_contract_acceptances (affiliate_id, kind, contract_version, text_hash, declared_cui)
      select id, 'head', '1.0', repeat('d', 64), '5022671' from public.affiliates limit 1;
    raise exception 'IN10 FAIL: CHECK-ul din date a lăsat un CUI cu control greșit';
  exception when check_violation then null; end;
  raise notice 'IN10 OK: 8 CUI-uri reale valide, 11 invalide (și zero în față), normalizare, răscumpărare respinsă fără efecte, backstop CHECK în date';
end $$;

-- ── IN11: câmpurile contractului ────────────────────────────────────────────
do $$
declare
  Q5 constant uuid := '5a000000-0000-4000-8000-000000000048';
  v jsonb; v_id uuid := (select id from public.affiliate_invitations
                          where token_hash = public.sales_invite_token_hash('tok-in10'));
begin
  v := pg_temp.in_u(Q5, pg_temp.in_rs('head', 'tok-in10', p_ver => '0.9'));
  if v is distinct from '{"ok": false, "reason": "contract_version_mismatch"}'::jsonb then raise exception 'IN11 FAIL: versiune veche: %', v; end if;
  v := pg_temp.in_u(Q5, pg_temp.in_rs('head', 'tok-in10', p_ver => ''));
  if v is distinct from '{"ok": false, "reason": "contract_version_mismatch"}'::jsonb then raise exception 'IN11 FAIL: versiune goală: %', v; end if;
  v := pg_temp.in_u(Q5, pg_temp.in_rs('head', 'tok-in10', p_hash => 'abc'));
  if v is distinct from '{"ok": false, "reason": "contract_hash_invalid"}'::jsonb then raise exception 'IN11 FAIL: hash scurt: %', v; end if;
  v := pg_temp.in_u(Q5, pg_temp.in_rs('head', 'tok-in10', p_hash => repeat('g', 64)));
  if v is distinct from '{"ok": false, "reason": "contract_hash_invalid"}'::jsonb then raise exception 'IN11 FAIL: hash non-hex: %', v; end if;
  v := pg_temp.in_u(Q5, pg_temp.in_rs('head', 'tok-in10', p_phone => '123'));
  if v is distinct from '{"ok": false, "reason": "phone_required"}'::jsonb then raise exception 'IN11 FAIL: telefon scurt: %', v; end if;
  v := pg_temp.in_u(Q5, pg_temp.in_rs('head', 'tok-in10', p_phone => repeat('7', 33)));
  if v is distinct from '{"ok": false, "reason": "phone_required"}'::jsonb then raise exception 'IN11 FAIL: telefon lung: %', v; end if;
  if pg_temp.in_inv_used(v_id) or exists (select 1 from public.affiliates where profile_id = Q5) then
    raise exception 'IN11 FAIL: un câmp respins a consumat invitația'; end if;
  -- control pozitiv: aceeași invitație, câmpuri bune, FĂRĂ consimțământ de contact
  v := pg_temp.in_u(Q5, pg_temp.in_rs('head', 'tok-in10', p_share => false));
  if (v->>'ok') is distinct from 'true' then raise exception 'IN11 FAIL (control): %', v; end if;
  if (select contact_sharing from public.affiliates where profile_id = Q5) is not false
     or (select contact_sharing_at from public.affiliates where profile_id = Q5) is not null then
    raise exception 'IN11 FAIL: consimțământul implicit nu e false'; end if;
  raise notice 'IN11 OK: versiune ≠ publicată, hash prost (scurt/non-hex), telefon scurt/lung respinse fără a consuma invitația';
end $$;

-- ── IN12: acceptarea e APPEND-ONLY ──────────────────────────────────────────
do $$
declare
  v_ok boolean; v_n int; v jsonb;
  v_aff uuid := (select affiliate_id from public.affiliate_contract_acceptances limit 1);
begin
  select count(*) into v_n from public.affiliate_contract_acceptances;
  if v_n < 3 then raise exception 'IN12 FAIL (control pozitiv): doar % acceptări', v_n; end if;
  begin update public.affiliate_contract_acceptances set declared_cui = '5022670';
    raise exception 'IN12 FAIL: UPDATE permis'; exception when restrict_violation then null; end;
  begin update public.affiliate_contract_acceptances set text_hash = repeat('e', 64) where affiliate_id = v_aff;
    raise exception 'IN12 FAIL: UPDATE pe text_hash permis'; exception when restrict_violation then null; end;
  begin delete from public.affiliate_contract_acceptances where affiliate_id = v_aff;
    raise exception 'IN12 FAIL: DELETE permis'; exception when restrict_violation then null; end;
  begin truncate public.affiliate_contract_acceptances;
    raise exception 'IN12 FAIL: TRUNCATE permis'; exception when restrict_violation then null; end;
  -- ca rol client: nici măcar nu ajunge la trigger (zero privilegii)
  v := pg_temp.in_u('5a000000-0000-4000-8000-000000000001', $q$(select to_jsonb(count(*)) from public.affiliate_contract_acceptances)$q$);
  if (v->>'sqlstate') is distinct from '42501' then raise exception 'IN12 FAIL: authenticated a citit acceptările: %', v; end if;
  if (select count(*) from public.affiliate_contract_acceptances) <> v_n then
    raise exception 'IN12 FAIL: s-au pierdut rânduri'; end if;
  raise notice 'IN12 OK: UPDATE/DELETE/TRUNCATE respinse de trigger; authenticated nu citește (42501; scrierea: IN1 pe privilegii); % rânduri intacte', v_n;
end $$;

-- ── IN13: fluxul de AGENT ───────────────────────────────────────────────────
do $$
declare
  H1 constant uuid := '5a000000-0000-4000-8000-000000000001';
  G1 constant uuid := '5a000000-0000-4000-8000-000000000011';
  G2 constant uuid := '5a000000-0000-4000-8000-000000000012';
  Q1 constant uuid := '5a000000-0000-4000-8000-000000000022';   -- (Q2: Q1 e aproape de plafonul de răscumpărări)
  v jsonb; v_h1 uuid; v_tok text; v_id uuid; i int; v_aff public.affiliates%rowtype;
  v_inv public.affiliate_invitations%rowtype; v_ids uuid[] := '{}';
begin
  select id into v_h1 from public.affiliates where profile_id = H1;

  -- un NON-șef (afiliatul vechi) nu poate crea invitații
  v := pg_temp.in_u('5a000000-0000-4000-8000-0000000000e2', $q$public.create_agent_invite('x')$q$);
  if v is distinct from '{"ok": false, "reason": "not_a_head"}'::jsonb then raise exception 'IN13 FAIL: afiliat vechi: %', v; end if;
  v := pg_temp.in_u('5a000000-0000-4000-8000-0000000000e1', $q$public.create_agent_invite('x')$q$);
  if v is distinct from '{"ok": false, "reason": "not_a_head"}'::jsonb then raise exception 'IN13 FAIL: cont simplu: %', v; end if;
  v := pg_temp.in_as('anon', null, $q$public.create_agent_invite('x')$q$);
  if (v->>'sqlstate') is distinct from '42501' then raise exception 'IN13 FAIL: anon: %', v; end if;

  -- șeful H1 creează o invitație de agent
  v := pg_temp.in_u(H1, $q$public.create_agent_invite('  pentru Ana  ')$q$);
  if (v->>'ok') is distinct from 'true' or v->>'kind' is distinct from 'agent' or v->>'token' !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'IN13 FAIL: create_agent_invite: %', v; end if;
  v_tok := v->>'token'; v_id := (v->>'invite_id')::uuid;
  insert into in_tokens values ('agent1', v_tok);
  select * into v_inv from public.affiliate_invitations where id = v_id;
  if v_inv.kind <> 'agent' or v_inv.invited_by_affiliate_id <> v_h1 or v_inv.note <> 'pentru Ana'
     or v_inv.token_hash = v_tok or v_inv.created_by_profile_id <> H1 then
    raise exception 'IN13 FAIL: rândul invitației de agent: %', to_jsonb(v_inv); end if;

  -- agentul G1 o răscumpără: ACTIV imediat, părinte = H1, fără aprobare
  v := pg_temp.in_u(G1, pg_temp.in_rs('agent', v_tok, p_cui => '2816464', p_share => false));
  if (v->>'ok') is distinct from 'true' or v->>'role' is distinct from 'agent' or v->>'status' is distinct from 'active'
     or (v->>'parent_affiliate_id')::uuid is distinct from v_h1 then
    raise exception 'IN13 FAIL: răscumpărarea agentului: %', v; end if;
  select * into v_aff from public.affiliates where profile_id = G1;
  if v_aff.status <> 'active' or v_aff.sales_role <> 'agent' or v_aff.parent_affiliate_id <> v_h1
     or v_aff.reviewed_at is not null or v_aff.cascade_bps <> 2000 then
    raise exception 'IN13 FAIL: rândul agentului: %', to_jsonb(v_aff); end if;
  if (select kind from public.affiliate_contract_acceptances where affiliate_id = v_aff.id) <> 'agent'
     or (select declared_cui from public.affiliate_contract_acceptances where affiliate_id = v_aff.id) <> '2816464' then
    raise exception 'IN13 FAIL: acceptarea agentului'; end if;
  -- același token nu mai merge (alt cont)
  v := pg_temp.in_u(Q1, pg_temp.in_rs('agent', v_tok));
  if v is distinct from '{"ok": false, "reason": "invite_invalid"}'::jsonb then raise exception 'IN13 FAIL: refolosire: %', v; end if;
  -- un token de AGENT nu merge pe RPC-ul de șef și invers
  v := pg_temp.in_u(Q1, pg_temp.in_rs('head', v_tok));
  if v is distinct from '{"ok": false, "reason": "invite_invalid"}'::jsonb then raise exception 'IN13 FAIL: agent token pe RPC-ul de șef: %', v; end if;

  -- al doilea agent (G2), cu consimțământ
  v := pg_temp.in_u(H1, $q$public.create_agent_invite('pentru Dan')$q$);
  insert into in_tokens values ('agent2', v->>'token');
  v := pg_temp.in_u(G2, pg_temp.in_rs('agent', v->>'token', p_cui => '9010105', p_share => true));
  if (v->>'ok') is distinct from 'true' then raise exception 'IN13 FAIL: G2: %', v; end if;

  -- AGENTUL nu poate crea invitații (nu e șef)
  v := pg_temp.in_u(G1, $q$public.create_agent_invite('x')$q$);
  if v is distinct from '{"ok": false, "reason": "not_a_head"}'::jsonb then raise exception 'IN13 FAIL: agentul a creat invitație: %', v; end if;

  -- plafonul de invitații deschise (20): se umple până la refuz, refuzul e exact too_many_open_invites
  for i in 1..25 loop
    v := pg_temp.in_u(H1, format('public.create_agent_invite(%L)', 'cap ' || i));
    exit when (v->>'ok') is distinct from 'true';
    v_ids := v_ids || (v->>'invite_id')::uuid;
  end loop;
  if v is distinct from '{"ok": false, "reason": "too_many_open_invites"}'::jsonb then
    raise exception 'IN13 FAIL: plafon neaplicat (% create): %', array_length(v_ids, 1), v; end if;
  if (select count(*) from public.affiliate_invitations where invited_by_affiliate_id = v_h1 and used_at is null and revoked_at is null and expires_at > clock_timestamp()) <> 20 then
    raise exception 'IN13 FAIL: nu sunt exact 20 de deschise'; end if;
  -- altcineva nu poate retrage invitațiile lui H1 (nici G1, nici fondatorul prin RPC-ul de șef)
  v := pg_temp.in_u(G1, format('public.revoke_agent_invite(%L)', v_ids[1]));
  if (v->>'ok') is distinct from 'false' then raise exception 'IN13 FAIL: agentul a retras invitația șefului: %', v; end if;
  -- H1 retrage una → se eliberează un loc
  v := pg_temp.in_u(H1, format('public.revoke_agent_invite(%L)', v_ids[1]));
  if v is distinct from '{"ok": true}'::jsonb then raise exception 'IN13 FAIL: retragere: %', v; end if;
  v := pg_temp.in_u(H1, format('public.revoke_agent_invite(%L)', v_ids[1]));
  if v is distinct from '{"ok": true, "already": true}'::jsonb then raise exception 'IN13 FAIL: retragere idempotentă: %', v; end if;
  v := pg_temp.in_u(H1, format('public.revoke_agent_invite(%L)', v_id));  -- cea FOLOSITĂ
  if v is distinct from '{"ok": false, "reason": "already_used"}'::jsonb then raise exception 'IN13 FAIL: retragere folosită: %', v; end if;
  v := pg_temp.in_u(H1, $q$public.create_agent_invite('după retragere')$q$);
  if (v->>'ok') is distinct from 'true' then raise exception 'IN13 FAIL: locul eliberat nu s-a refolosit: %', v; end if;
  -- invitația retrasă nu se mai răscumpără
  -- (tokenul nu e păstrat; verificăm prin starea rândului)
  if (select revoked_at from public.affiliate_invitations where id = v_ids[1]) is null then
    raise exception 'IN13 FAIL: revoked_at lipsă'; end if;
  -- toate invitațiile deschise ale lui H1 le retragem ca să nu polueze restul
  update public.affiliate_invitations set revoked_at = clock_timestamp()
   where invited_by_affiliate_id = v_h1 and used_at is null and revoked_at is null;

  -- șef FĂRĂ contract acceptat → contract_not_accepted; șef suspendat → head_not_active
  -- (șeful Q4 din IN11 a acceptat; construim unul fără acceptare, direct)
  insert into auth.users (id, email) values ('5a000000-0000-4000-8000-000000000052', 'in-noacc@in302.test');
  insert into public.profiles (id, email) values ('5a000000-0000-4000-8000-000000000052', 'in-noacc@in302.test') on conflict (id) do nothing;
  insert into public.affiliates (profile_id, referral_code, sales_role) values ('5a000000-0000-4000-8000-000000000052', 'innoacc1', 'head');
  v := pg_temp.in_u('5a000000-0000-4000-8000-000000000052', $q$public.create_agent_invite('x')$q$);
  if v is distinct from '{"ok": false, "reason": "contract_not_accepted"}'::jsonb then raise exception 'IN13 FAIL: fără contract: %', v; end if;
  update public.affiliates set status = 'suspended' where profile_id = H1;
  v := pg_temp.in_u(H1, $q$public.create_agent_invite('x')$q$);
  if v is distinct from '{"ok": false, "reason": "head_not_active"}'::jsonb then raise exception 'IN13 FAIL: șef suspendat: %', v; end if;
  update public.affiliates set status = 'active' where profile_id = H1;
  raise notice 'IN13 OK: agent activ imediat cu părinte = șef, fără aprobare; tipuri separate; plafon 20 + retragere; non-șef / fără contract / suspendat refuzați';
end $$;

-- ── IN14: depth-1 curat ─────────────────────────────────────────────────────
do $$
declare
  G1 constant uuid := '5a000000-0000-4000-8000-000000000011';
  Q2 constant uuid := '5a000000-0000-4000-8000-000000000022';
  v_g1 uuid; v_res jsonb; v_raised boolean := false;
begin
  select id into v_g1 from public.affiliates where profile_id = G1;
  -- invitație de agent al cărei invitator e AGENT (construită direct: RPC-urile nu o produc)
  perform pg_temp.in_seed_inv('agent', 'tok-in14-agent-invitator', v_g1);
  v_res := pg_temp.in_u(Q2, pg_temp.in_rs('agent', 'tok-in14-agent-invitator'));
  if v_res is distinct from '{"ok": false, "reason": "invite_invalid"}'::jsonb then
    raise exception 'IN14 FAIL: invitator agent → %', v_res; end if;
  if exists (select 1 from public.affiliates where profile_id = Q2) then
    raise exception 'IN14 FAIL: s-a creat cont sub un agent'; end if;
  -- Dovada că refuzul e CURAT, nu o eroare amânată la COMMIT: forțăm verificarea
  -- triggerelor deferred ACUM (tot ce s-a scris până aici trebuie să treacă).
  set constraints all immediate;
  set constraints all deferred;

  -- Controlul harness-ului: un agent construit DIRECT sub un agent PICĂ la aceeași verificare.
  begin
    insert into public.affiliates (profile_id, referral_code, parent_affiliate_id, sales_role)
      values (Q2, 'indepth01', v_g1, 'agent');
    set constraints all immediate;
  exception when check_violation then v_raised := true;
  end;
  set constraints all deferred;
  if not v_raised then raise exception 'IN14 FAIL (control): depth-1 nu mai e impus la verificarea deferred'; end if;

  -- un ȘEF nu poate primi părinte (CHECK în date)
  begin
    update public.affiliates set parent_affiliate_id = v_g1 where profile_id = '5a000000-0000-4000-8000-000000000001';
    raise exception 'IN14 FAIL: un șef a primit părinte';
  exception when check_violation then null; end;
  raise notice 'IN14 OK: invitator-agent → invite_invalid curat (verificarea deferred trece), control: agent-sub-agent direct PICĂ, șeful nu poate avea părinte';
end $$;

-- ── IN15: consimțământ + get_sales_network ──────────────────────────────────
do $$
declare
  H1 constant uuid := '5a000000-0000-4000-8000-000000000001';
  H2 constant uuid := '5a000000-0000-4000-8000-000000000002';
  G1 constant uuid := '5a000000-0000-4000-8000-000000000011';
  G2 constant uuid := '5a000000-0000-4000-8000-000000000012';
  v jsonb; v_t jsonb; v_k text; v_h2 uuid; v_g2 uuid; v_item jsonb;
  v_team_keys text; v_top_keys text;
begin
  -- fără cont de afiliat: formă stabilă
  v := pg_temp.in_u('5a000000-0000-4000-8000-0000000000e1', $q$public.get_sales_network()$q$);
  if (v->>'ok') is distinct from 'true' or v->'role' is distinct from 'null'::jsonb
     or (v #>> '{contract,current_version}') is distinct from '1.0' then
    raise exception 'IN15 FAIL: non-afiliat: %', v; end if;
  v := pg_temp.in_as('anon', null, $q$public.get_sales_network()$q$);
  if (v->>'sqlstate') is distinct from '42501' then raise exception 'IN15 FAIL: anon: %', v; end if;

  -- AGENTUL G1 (nu consimte) vede cardul șefului H1 (consimte → contact vizibil)
  v := pg_temp.in_u(G1, $q$public.get_sales_network()$q$);
  if v->>'role' is distinct from 'agent' or (v #>> '{head,contact_shared}') is distinct from 'true'
     or (v #>> '{head,name}') is distinct from 'Ion Șef' or (v #>> '{head,phone}') is distinct from '0722 111 222'
     or (v #>> '{head,email}') is distinct from 'in-h1@in302.test' then
    raise exception 'IN15 FAIL: cardul șefului cu consimțământ: %', v; end if;
  if v->'team' <> '[]'::jsonb or v->'open_invites' <> '[]'::jsonb then
    raise exception 'IN15 FAIL: agentul vede echipă/invitații: %', v; end if;

  -- ȘEFUL își retrage consimțământul → agentul vede cardul FĂRĂ contact
  v := pg_temp.in_u(H1, $q$public.set_my_contact_sharing(false)$q$);
  if v is distinct from '{"ok": true, "contact_sharing": false}'::jsonb then raise exception 'IN15 FAIL: retragere: %', v; end if;
  if (select contact_sharing_at from public.affiliates where profile_id = H1) is not null then
    raise exception 'IN15 FAIL: contact_sharing_at rămas după retragere'; end if;
  v := pg_temp.in_u(G1, $q$public.get_sales_network()$q$);
  if (v #>> '{head,contact_shared}') is distinct from 'false'
     or (v #> '{head,name}') is distinct from 'null'::jsonb or (v #> '{head,phone}') is distinct from 'null'::jsonb
     or (v #> '{head,email}') is distinct from 'null'::jsonb or v::text like '%Ion Șef%' or v::text like '%0722%' then
    raise exception 'IN15 FAIL: contactul șefului scurge fără consimțământ: %', v; end if;
  v := pg_temp.in_u(H1, $q$public.set_my_contact_sharing(true)$q$);
  if (select contact_sharing_at from public.affiliates where profile_id = H1) is null then
    raise exception 'IN15 FAIL: contact_sharing_at lipsă după consimțământ'; end if;

  -- set_my_contact_sharing: validări
  if pg_temp.in_u(H1, $q$public.set_my_contact_sharing(null)$q$) is distinct from '{"ok": false, "reason": "invalid_value"}'::jsonb
     or pg_temp.in_u('5a000000-0000-4000-8000-0000000000e1', $q$public.set_my_contact_sharing(true)$q$)
          is distinct from '{"ok": false, "reason": "not_an_affiliate"}'::jsonb then
    raise exception 'IN15 FAIL: validări set_my_contact_sharing'; end if;
  if (pg_temp.in_as('anon', null, $q$public.set_my_contact_sharing(true)$q$)->>'sqlstate') is distinct from '42501' then
    raise exception 'IN15 FAIL: anon a apelat set_my_contact_sharing'; end if;

  -- Un ALT șef (H2) cu un agent propriu: NU apare în echipa lui H1 (doar DIRECȚII).
  insert into public.affiliates (id, profile_id, referral_code, sales_role)
    values ('5aa00000-0000-4000-8000-0000000000c2', H2, 'inhead02', 'head');
  v_h2 := '5aa00000-0000-4000-8000-0000000000c2';
  insert into public.affiliate_contract_acceptances (affiliate_id, kind, contract_version, text_hash, declared_cui)
    values (v_h2, 'head', '1.0', repeat('c', 64), '5022670');
  v := pg_temp.in_u(H2, $q$public.create_agent_invite('h2 agent')$q$);
  insert into in_tokens values ('agent-h2', v->>'token');
  v := pg_temp.in_u('5a000000-0000-4000-8000-000000000023', pg_temp.in_rs('agent', v->>'token', p_cui => '11588780', p_share => true));
  -- (Q3 era șef din IN7; acum trebuie să fie respins: deja afiliat)
  if v is distinct from '{"ok": false, "reason": "already_affiliate"}'::jsonb then
    raise exception 'IN15 FAIL: un șef a răscumpărat o invitație de agent: %', v; end if;
  v := pg_temp.in_u('5a000000-0000-4000-8000-000000000043', pg_temp.in_rs('agent', (select token from in_tokens where label = 'agent-h2'), p_cui => '11588780', p_share => true));
  if (v->>'ok') is distinct from 'true' then raise exception 'IN15 FAIL: agent H2: %', v; end if;

  -- DATE de clienți / bani care NU au voie să iasă: un client al lui G2, cu IBAN și Stripe pe agent.
  insert into public.affiliate_payout_profile (affiliate_id, legal_form, cui, iban, beneficiary_name)
    select id, 'pfa', '9010105', 'RO49AAAA1B31007593840000', 'Dan SECRET PFA' from public.affiliates where profile_id = G2;
  insert into public.affiliate_attributions (affiliate_id, referred_profile_id, stripe_customer_id, status)
    select id, '5a000000-0000-4000-8000-000000000031', 'cus_SECRET_in302', 'active' from public.affiliates where profile_id = G2;

  v := pg_temp.in_u(H1, $q$public.get_sales_network()$q$);
  v_top_keys := (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(v) k);
  if v_top_keys is distinct from 'affiliate_id,contact_sharing,contract,head,limits,ok,open_invites,role,status,team' then
    raise exception 'IN15 FAIL: forma de sus s-a schimbat: %', v_top_keys; end if;
  if v->>'role' <> 'head' or jsonb_array_length(v->'team') <> 2 then
    raise exception 'IN15 FAIL: echipa lui H1 trebuie să aibă EXACT cei 2 recruți direcți: %', v->'team'; end if;
  v_team_keys := (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(v->'team'->0) k);
  if v_team_keys is distinct from 'affiliate_id,agent_earned_ron_cents,clients_active,clients_total,contact_shared,email,head_bonus_ron_cents,joined_at,last_sale_at,name,ordinal,phone,status' then
    raise exception 'IN15 FAIL: forma elementului de echipă s-a schimbat: %', v_team_keys; end if;
  -- G1 (nu consimte): zero contact; G2 (consimte): contact vizibil
  select e into v_item from jsonb_array_elements(v->'team') e where (e->>'affiliate_id')::uuid = (select id from public.affiliates where profile_id = G1);
  if (v_item->>'contact_shared') <> 'false' or v_item->'name' <> 'null'::jsonb or v_item->'phone' <> 'null'::jsonb or v_item->'email' <> 'null'::jsonb then
    raise exception 'IN15 FAIL: contactul agentului fără consimțământ e vizibil: %', v_item; end if;
  select e into v_item from jsonb_array_elements(v->'team') e where (e->>'affiliate_id')::uuid = (select id from public.affiliates where profile_id = G2);
  if (v_item->>'contact_shared') <> 'true' or v_item->>'name' <> 'Dan Agent' or v_item->>'phone' <> '0722 111 222'
     or v_item->>'email' <> 'in-g2@in302.test' or (v_item->>'clients_total')::int <> 1 or (v_item->>'clients_active')::int <> 1 then
    raise exception 'IN15 FAIL: agentul care consimte: %', v_item; end if;
  -- ZERO scurgeri: clientul final, IBAN, Stripe, restaurantul, token, hash
  foreach v_k in array array['SECRET', 'cus_', 'RO49', 'iban', 'stripe', 'in-client', 'token', 'token_hash', '9010105', 'Restaurantul'] loop
    if position(lower(v_k) in lower(v::text)) > 0 then
      raise exception 'IN15 FAIL: rezultatul conține "%" (date de client/bani/secret): %', v_k, v; end if;
  end loop;
  -- H2 nu vede agenții lui H1 și invers (doar direcții)
  v_t := pg_temp.in_u(H2, $q$public.get_sales_network()$q$);
  if jsonb_array_length(v_t->'team') <> 1 or v_t::text like '%Dan Agent%' or v_t::text like '%in-g1@%' then
    raise exception 'IN15 FAIL: echipa lui H2 conține agenți ai lui H1: %', v_t->'team'; end if;
  -- RLS „own row” (249) NEATINSĂ: H1 vede DOAR rândul propriu în `affiliates`
  v_t := pg_temp.in_u(H1, $q$(select to_jsonb(count(*)) from public.affiliates)$q$);
  if v_t is distinct from '1'::jsonb then raise exception 'IN15 FAIL: RLS affiliates nu mai e own-row: %', v_t; end if;
  -- agentul vede doar rândul propriu și în affiliate_attributions nu vede pe ale altora
  v_t := pg_temp.in_u(G1, $q$(select to_jsonb(count(*)) from public.affiliate_attributions)$q$);
  if v_t is distinct from '0'::jsonb then raise exception 'IN15 FAIL: agentul G1 vede atribuiri străine: %', v_t; end if;
  -- invitațiile deschise ale șefului ies FĂRĂ token/hash
  v := pg_temp.in_u(H1, $q$public.create_agent_invite('deschisă')$q$);
  insert into in_tokens values ('agent-open', v->>'token');
  v_t := pg_temp.in_u(H1, $q$public.get_sales_network()$q$);
  if jsonb_array_length(v_t->'open_invites') <> 1 or v_t::text like '%' || (v->>'token') || '%'
     or (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(v_t->'open_invites'->0) k) is distinct from 'created_at,expires_at,id,note' then
    raise exception 'IN15 FAIL: open_invites: %', v_t->'open_invites'; end if;
  raise notice 'IN15 OK: contact ascuns fără consimțământ (ambele sensuri), retragerea se vede imediat, doar recruți direcți, formă înghețată, zero PII de client/IBAN/Stripe, RLS own-row intact';
end $$;

-- ── IN16: cascade_bps 200 → 2000 doar dacă e 200 ────────────────────────────
do $$
declare v_orig jsonb; v_r boolean;
begin
  select value into v_orig from public.platform_settings where key = 'affiliate_commission_defaults';
  -- starea după migrație: 2000 (default-ul seed era 200) sau o valoare a fondatorului ≠ 200
  if (v_orig ->> 'cascade_bps')::int = 200 then raise exception 'IN16 FAIL: cascade_bps a rămas 200 după migrație'; end if;
  -- default-ul COLOANEI rămâne 200 (RC1 depinde de el)
  if (select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'affiliates' and column_name = 'cascade_bps') is distinct from '200' then
    raise exception 'IN16 FAIL: default-ul coloanei affiliates.cascade_bps s-a schimbat'; end if;

  -- 2500 (modificat de fondator) se PĂSTREAZĂ
  update public.platform_settings set value = jsonb_set(value, '{cascade_bps}', '2500') where key = 'affiliate_commission_defaults';
  v_r := public.sales_network_apply_cascade_default();
  if v_r or (select (value ->> 'cascade_bps')::int from public.platform_settings where key = 'affiliate_commission_defaults') <> 2500 then
    raise exception 'IN16 FAIL: valoarea 2500 a fondatorului a fost suprascrisă'; end if;
  -- 200 → 2000, restul cheilor neatinse
  update public.platform_settings set value = jsonb_set(value, '{cascade_bps}', '200') where key = 'affiliate_commission_defaults';
  v_r := public.sales_network_apply_cascade_default();
  if not v_r or (select (value ->> 'cascade_bps')::int from public.platform_settings where key = 'affiliate_commission_defaults') <> 2000
     or (select value - 'cascade_bps' from public.platform_settings where key = 'affiliate_commission_defaults') is distinct from (v_orig - 'cascade_bps') then
    raise exception 'IN16 FAIL: 200 nu devine 2000 (sau alte chei atinse)'; end if;
  -- idempotent: a doua aplicare nu face nimic
  if public.sales_network_apply_cascade_default() then raise exception 'IN16 FAIL: nu e idempotentă'; end if;
  -- valoare 0 (fondatorul a oprit bonusul) rămâne 0
  update public.platform_settings set value = jsonb_set(value, '{cascade_bps}', '0') where key = 'affiliate_commission_defaults';
  if public.sales_network_apply_cascade_default() then raise exception 'IN16 FAIL: 0 suprascris'; end if;
  update public.platform_settings set value = v_orig where key = 'affiliate_commission_defaults';
  raise notice 'IN16 OK: 200→2000 doar dacă e 200 (2500 și 0 păstrate), idempotent, default-ul coloanei neatins';
end $$;

-- ── IN17: SUSPENDAREA îngheață comisioanele; bonusul de 20% end-to-end ──────
do $$
declare
  F constant uuid := '5a000000-0000-4000-8000-0000000000f1';
  H1 constant uuid := '5a000000-0000-4000-8000-000000000001';
  G1 constant uuid := '5a000000-0000-4000-8000-000000000011';
  C  constant uuid := '5a000000-0000-4000-8000-000000000046';
  v jsonb; v_g1 uuid; v_h1 uuid; v_attr uuid; n_agent int; n_casc int; v_sum_a bigint; v_sum_c bigint;
begin
  select id into v_g1 from public.affiliates where profile_id = G1;
  select id into v_h1 from public.affiliates where profile_id = H1;
  -- clientul C aparține lui G1 (atribuire creată direct; instantaneul vine din trigger-ul 293)
  insert into public.affiliate_attributions (affiliate_id, referred_profile_id, stripe_customer_id, status)
    values (v_g1, C, 'cus_in302_c', 'pending') returning id into v_attr;
  if (select snap_cascade_bps from public.affiliate_attributions where id = v_attr) is distinct from 2000 then
    raise exception 'IN17 FAIL: instantaneul cascadei nu e 2000 (părintele are 2000): %',
      (select snap_cascade_bps from public.affiliate_attributions where id = v_attr); end if;

  -- factura n (lună n): plan growth 24900
  perform public.process_affiliate_invoice_paid('evt_in_1', 'cus_in302_c', 'sub_in302', 'in_in_1', 'subscription_create', 24900, 'RON', '2026-09-01', now(), 'growth');
  perform public.process_affiliate_invoice_paid('evt_in_2', 'cus_in302_c', 'sub_in302', 'in_in_2', 'subscription_cycle', 24900, 'RON', '2026-10-01', now(), 'growth');
  select coalesce(sum(amount_cents), 0) into v_sum_a from public.affiliate_ledger where affiliate_id = v_g1 and leg in ('setup', 'recurring');
  select coalesce(sum(amount_cents), 0) into v_sum_c from public.affiliate_ledger where affiliate_id = v_h1 and leg = 'cascade';
  -- setup 30% + recurring 10% din 24900 = 7470 + 2490 = 9960; bonus șef = 20% = 1992
  if v_sum_a <> 9960 or v_sum_c <> 1992 or v_sum_c * 5 <> v_sum_a then
    raise exception 'IN17 FAIL: bonusul șefului nu e 20%% din comisionul agentului (agent %, șef %)', v_sum_a, v_sum_c; end if;

  -- ȘEFUL își vede cifrele, AGREGAT
  v := pg_temp.in_u(H1, $q$public.get_sales_network()$q$);
  if (select (e->>'agent_earned_ron_cents')::bigint from jsonb_array_elements(v->'team') e where (e->>'affiliate_id')::uuid = v_g1) <> 9960
     or (select (e->>'head_bonus_ron_cents')::bigint from jsonb_array_elements(v->'team') e where (e->>'affiliate_id')::uuid = v_g1) <> 1992
     or (select e->>'last_sale_at' from jsonb_array_elements(v->'team') e where (e->>'affiliate_id')::uuid = v_g1) is null
     or (select (e->>'clients_total')::int from jsonb_array_elements(v->'team') e where (e->>'affiliate_id')::uuid = v_g1) <> 1 then
    raise exception 'IN17 FAIL: cifrele din get_sales_network: %', v->'team'; end if;

  -- ── SUSPENDĂM agentul ──
  v := pg_temp.in_u(F, format('public.admin_set_affiliate_status(%L, %L, %L)', v_g1, 'suspended', 'verificare suspiciune'));
  if v is distinct from '{"ok": true, "status": "suspended"}'::jsonb then raise exception 'IN17 FAIL: suspendare: %', v; end if;
  if not exists (select 1 from public.platform_audit_log where action = 'affiliate_status_changed'
                  and details ->> 'affiliate_id' = v_g1::text and details ->> 'new_status' = 'suspended'
                  and details ->> 'reason' = 'verificare suspiciune' and details ->> 'old_status' = 'active') then
    raise exception 'IN17 FAIL: suspendarea nu e în audit cu motiv'; end if;
  select count(*) into n_agent from public.affiliate_ledger where affiliate_id = v_g1;
  select count(*) into n_casc from public.affiliate_ledger where affiliate_id = v_h1;
  v := public.process_affiliate_invoice_paid('evt_in_3', 'cus_in302_c', 'sub_in302', 'in_in_3', 'subscription_cycle', 24900, 'RON', '2026-11-01', now(), 'growth');
  if v ->> 'skipped' is distinct from 'affiliate_inactive' then raise exception 'IN17 FAIL: agent suspendat nu e sărit: %', v; end if;
  if (select count(*) from public.affiliate_ledger where affiliate_id = v_g1) <> n_agent
     or (select count(*) from public.affiliate_ledger where affiliate_id = v_h1) <> n_casc then
    raise exception 'IN17 FAIL: suspendarea NU a înghețat comisioanele noi (agent/șef)'; end if;
  -- cele DEJA scrise rămân (D9): nimic șters, aceeași sumă
  if (select coalesce(sum(amount_cents), 0) from public.affiliate_ledger where affiliate_id = v_g1 and leg in ('setup', 'recurring')) <> 9960 then
    raise exception 'IN17 FAIL: comisioanele deja câștigate s-au modificat'; end if;
  -- un cod nou al agentului suspendat nu mai atribuie (claim_agent_code: invalid_code)
  v := pg_temp.in_u('5a000000-0000-4000-8000-000000000044',
         format('public.claim_agent_code(%L)', (select referral_code from public.affiliates where id = v_g1)));
  if v is distinct from '{"ok": false, "reason": "invalid_code"}'::jsonb then
    raise exception 'IN17 FAIL: agentul suspendat poate primi atribuiri noi: %', v; end if;

  -- ── REACTIVĂM (control pozitiv: comisionul reapare) ──
  v := pg_temp.in_u(F, format('public.admin_set_affiliate_status(%L, %L, %L)', v_g1, 'active', 'clarificat'));
  if (v->>'ok') is distinct from 'true' then raise exception 'IN17 FAIL: reactivare: %', v; end if;
  v := public.process_affiliate_invoice_paid('evt_in_4', 'cus_in302_c', 'sub_in302', 'in_in_4', 'subscription_cycle', 24900, 'RON', '2026-12-01', now(), 'growth');
  if v ->> 'leg' is distinct from 'recurring' or (v ->> 'commission_cents')::bigint <> 2490 then
    raise exception 'IN17 FAIL (control): după reactivare comisionul nu reapare: %', v; end if;
  select count(*) into n_casc from public.affiliate_ledger where affiliate_id = v_h1 and leg = 'cascade';
  if n_casc <> 3 then raise exception 'IN17 FAIL: cascadă lipsă după reactivare (%)', n_casc; end if;

  -- ── SUSPENDĂM ȘEFUL: agentul primește comision, șeful NU (fără cascadă nouă) ──
  v := pg_temp.in_u(F, format('public.admin_set_affiliate_status(%L, %L, %L)', v_h1, 'suspended', 'revizuire contract'));
  if (v->>'ok') is distinct from 'true' then raise exception 'IN17 FAIL: suspendare șef: %', v; end if;
  v := public.process_affiliate_invoice_paid('evt_in_5', 'cus_in302_c', 'sub_in302', 'in_in_5', 'subscription_cycle', 24900, 'RON', '2027-01-01', now(), 'growth');
  if v ->> 'leg' is distinct from 'recurring' then raise exception 'IN17 FAIL: agentul nu mai primește comision la șef suspendat: %', v; end if;
  if (select count(*) from public.affiliate_ledger where affiliate_id = v_h1 and leg = 'cascade') <> 3 then
    raise exception 'IN17 FAIL: șeful suspendat a primit bonus nou'; end if;
  -- șeful suspendat: nici invitații noi, nici echipă în get_sales_network
  if pg_temp.in_u(H1, $q$public.create_agent_invite('x')$q$) is distinct from '{"ok": false, "reason": "head_not_active"}'::jsonb then
    raise exception 'IN17 FAIL: șef suspendat a creat invitație'; end if;
  v := pg_temp.in_u(H1, $q$public.get_sales_network()$q$);
  if v->>'status' <> 'suspended' or v->'team' <> '[]'::jsonb then
    raise exception 'IN17 FAIL: șef suspendat vede echipa: %', v; end if;
  v := pg_temp.in_u(F, format('public.admin_set_affiliate_status(%L, %L, %L)', v_h1, 'active', 'revizuire încheiată'));
  if (v->>'ok') is distinct from 'true' then raise exception 'IN17 FAIL: reactivare șef: %', v; end if;

  -- ── validări + `closed` TERMINAL + tipuri ──
  if pg_temp.in_u(F, format('public.admin_set_affiliate_status(%L, %L, %L)', v_g1, 'suspended', ''))
       is distinct from '{"ok": false, "reason": "reason_required"}'::jsonb
     or pg_temp.in_u(F, format('public.admin_set_affiliate_status(%L, %L, %L)', v_g1, 'suspended', '  ab '))
       is distinct from '{"ok": false, "reason": "reason_required"}'::jsonb
     or pg_temp.in_u(F, format('public.admin_set_affiliate_status(%L, %L, %L)', v_g1, 'deleted', 'motiv bun'))
       is distinct from '{"ok": false, "reason": "invalid_status"}'::jsonb
     or pg_temp.in_u(F, format('public.admin_set_affiliate_status(%L, %L, %L)', v_g1, 'pending', 'motiv bun'))
       is distinct from '{"ok": false, "reason": "invalid_status"}'::jsonb
     or pg_temp.in_u(F, format('public.admin_set_affiliate_status(%L, %L, %L)', v_g1, 'active', 'motiv bun'))
       is distinct from '{"ok": false, "reason": "no_change", "status": "active"}'::jsonb
     or pg_temp.in_u(F, $q$public.admin_set_affiliate_status('5aa00000-0000-4000-8000-0000000000ff', 'closed', 'motiv bun')$q$)
       is distinct from '{"ok": false, "reason": "not_found"}'::jsonb then
    raise exception 'IN17 FAIL: validări admin_set_affiliate_status'; end if;
  insert into public.affiliates (id, profile_id, referral_code, status)
    values ('5aa00000-0000-4000-8000-0000000000d1', '5a000000-0000-4000-8000-000000000045', 'inpend01', 'pending');
  if pg_temp.in_u(F, $q$public.admin_set_affiliate_status('5aa00000-0000-4000-8000-0000000000d1', 'active', 'motiv bun')$q$)
       is distinct from '{"ok": false, "reason": "not_in_network", "status": "pending"}'::jsonb then
    raise exception 'IN17 FAIL: o cerere pending a fost activată prin set_status'; end if;

  v := pg_temp.in_u(F, format('public.admin_set_affiliate_status(%L, %L, %L)', v_g1, 'closed', 'încetare contract'));
  if (v->>'ok') is distinct from 'true' then raise exception 'IN17 FAIL: closed: %', v; end if;
  v := pg_temp.in_u(F, format('public.admin_set_affiliate_status(%L, %L, %L)', v_g1, 'active', 'revenire'));
  if v is distinct from '{"ok": false, "reason": "invalid_transition", "status": "closed"}'::jsonb then
    raise exception 'IN17 FAIL: closed nu e terminal: %', v; end if;
  v := public.process_affiliate_invoice_paid('evt_in_6', 'cus_in302_c', 'sub_in302', 'in_in_6', 'subscription_cycle', 24900, 'RON', '2027-02-01', now(), 'growth');
  if v ->> 'skipped' is distinct from 'affiliate_inactive' then raise exception 'IN17 FAIL: closed nu îngheață comisioanele: %', v; end if;
  -- G1 a rămas "closed" doar în această tranzacție; îl readucem pentru restul testelor (postgres ocolește RPC-ul)
  update public.affiliates set status = 'active' where id = v_g1;
  raise notice 'IN17 OK: bonus șef = 20%% din comisionul agentului (1992/9960); suspendare agent/șef îngheață comisioanele NOI, cele scrise rămân, reactivarea le reia; closed terminal; pending nu se activează prin set_status';
end $$;

-- ── IN18: GDPR — FK-urile noi nu blochează ștergerea ────────────────────────
do $$
declare
  G2 constant uuid := '5a000000-0000-4000-8000-000000000012';
  U  constant uuid := '5a000000-0000-4000-8000-000000000042';
  v_g2 uuid; v_inv uuid; v_acc_n int; v_h1 uuid; v jsonb;
begin
  select id into v_g2 from public.affiliates where profile_id = G2;
  select id into v_h1 from public.affiliates where profile_id = '5a000000-0000-4000-8000-000000000001';
  select count(*) into v_acc_n from public.affiliate_contract_acceptances where affiliate_id = v_g2;
  select id into v_inv from public.affiliate_invitations where used_by_affiliate_id = v_g2;
  if v_inv is null or v_acc_n <> 1 then raise exception 'IN18 FAIL (control pozitiv): lipsesc invitația/acceptarea lui G2'; end if;

  -- calea reală: detașarea afilierii (295) apoi ștergerea contului
  perform public.erase_affiliate_identity_for_user(G2);
  delete from auth.users where id = G2;   -- NU are voie să pice pe FK-urile 302
  if exists (select 1 from public.profiles where id = G2) then raise exception 'IN18 FAIL: profilul nu s-a șters'; end if;
  if (select used_by_profile_id from public.affiliate_invitations where id = v_inv) is not null
     or (select used_by_affiliate_id from public.affiliate_invitations where id = v_inv) is distinct from v_g2 then
    raise exception 'IN18 FAIL: used_by_profile_id nu a devenit NULL (sau used_by_affiliate_id s-a pierdut)'; end if;
  if (select count(*) from public.affiliate_contract_acceptances where affiliate_id = v_g2) <> 1 then
    raise exception 'IN18 FAIL: dovada acceptării a dispărut'; end if;

  -- agentul șters apare în echipa șefului fără nicio dată personală
  v := pg_temp.in_u('5a000000-0000-4000-8000-000000000001', $q$public.get_sales_network()$q$);
  if (select e from jsonb_array_elements(v->'team') e where (e->>'affiliate_id')::uuid = v_g2) is null
     or (select (e->>'contact_shared')::boolean from jsonb_array_elements(v->'team') e where (e->>'affiliate_id')::uuid = v_g2) is not false
     or (select e->>'status' from jsonb_array_elements(v->'team') e where (e->>'affiliate_id')::uuid = v_g2) <> 'closed'
     or v::text like '%Dan Agent%' or v::text like '%in-g2@%' then
    raise exception 'IN18 FAIL: agentul șters în echipă: %', v->'team'; end if;

  -- creatorul unei invitații (created_by_profile_id) se poate șterge
  insert into public.profiles (id, email) values (U, 'in-creator@in302.test') on conflict (id) do nothing;
  insert into public.affiliate_invitations (kind, token_hash, created_by_profile_id, expires_at)
    values ('head', public.sales_invite_token_hash('tok-in18-creator'), U, clock_timestamp() + interval '1 day');
  delete from auth.users where id = U;
  if (select created_by_profile_id from public.affiliate_invitations where token_hash = public.sales_invite_token_hash('tok-in18-creator')) is not null then
    raise exception 'IN18 FAIL: created_by_profile_id nu a devenit NULL'; end if;
  raise notice 'IN18 OK: ștergerea agentului (erase + delete auth.users) și a creatorului trece; used_by/created_by → NULL, acceptarea rămâne, echipa nu arată date personale';
end $$;

-- ── IN19: rate limit pe răscumpări ──────────────────────────────────────────
do $$
declare
  U  constant uuid := '5a000000-0000-4000-8000-000000000044';
  v jsonb; i int; v_id uuid;
begin
  v_id := pg_temp.in_seed_inv('head', 'tok-in19-bun', null);
  for i in 1..10 loop
    v := pg_temp.in_u(U, pg_temp.in_rs('head', 'token-ghicit-' || i));
    if v is distinct from '{"ok": false, "reason": "invite_invalid"}'::jsonb then
      raise exception 'IN19 FAIL: încercarea % → %', i, v; end if;
  end loop;
  -- a 11-a: rate_limited, CHIAR cu tokenul bun; invitația rămâne neatinsă
  v := pg_temp.in_u(U, pg_temp.in_rs('head', 'tok-in19-bun'));
  if v is distinct from '{"ok": false, "reason": "rate_limited"}'::jsonb then
    raise exception 'IN19 FAIL: a 11-a încercare: %', v; end if;
  if pg_temp.in_inv_used(v_id) then raise exception 'IN19 FAIL: răscumpărare peste plafon'; end if;
  -- plafonul e PER UTILIZATOR: alt cont nu e afectat (control pozitiv)
  v := pg_temp.in_u('5a000000-0000-4000-8000-000000000047', pg_temp.in_rs('head', 'tok-in19-bun'));
  if (v->>'ok') is distinct from 'true' then raise exception 'IN19 FAIL (control): alt cont blocat: %', v; end if;
  raise notice 'IN19 OK: 10 încercări → a 11-a rate_limited chiar cu token bun (neconsumat); plafonul e per utilizator';
end $$;

-- ── IN20: programul public rămâne închis și neatins ─────────────────────────
do $$
declare v jsonb;
begin
  if public.affiliate_program_is_open() then raise exception 'IN20 FAIL: programul public s-a deschis'; end if;
  v := pg_temp.in_u('5a000000-0000-4000-8000-0000000000e1', $q$public.register_affiliate(null, '0722111222', 'nota')$q$);
  if v is distinct from '{"ok": false, "reason": "program_closed"}'::jsonb then
    raise exception 'IN20 FAIL: register_affiliate nu mai întoarce program_closed: %', v; end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('register_affiliate', 'admin_review_affiliate')) <> 2 then
    raise exception 'IN20 FAIL: register_affiliate/admin_review_affiliate au mai multe semnături'; end if;
  -- ȘI răscumpărarea a mers cu programul închis (IN5/IN13): invitația ține loc de poartă
  if not exists (select 1 from public.affiliates where sales_role = 'head') then
    raise exception 'IN20 FAIL (control pozitiv): nu există șefi creați cu programul închis'; end if;
  raise notice 'IN20 OK: program închis, register_affiliate → program_closed, invitațiile funcționează independent de el';
end $$;


-- ── IN22: UNICITATE CUI ─────────────────────────────────────────────────────
do $$
declare
  H1 constant uuid := '5a000000-0000-4000-8000-000000000001';
  want_conflict constant jsonb := '{"ok": false, "reason": "cui_conflict"}';
  v_h1 uuid; v jsonb; v_inv uuid; u1 uuid; u2 uuid; u3 uuid; u4 uuid; u5 uuid; u6 uuid;
  v_old text; v_new text; v_aff uuid; v_er text;
begin
  select id into v_h1 from public.affiliates where profile_id = H1;
  u1 := pg_temp.in_mkuser('c1'); u2 := pg_temp.in_mkuser('c2'); u3 := pg_temp.in_mkuser('c3');
  u4 := pg_temp.in_mkuser('c4'); u5 := pg_temp.in_mkuser('c5'); u6 := pg_temp.in_mkuser('c6');

  -- 1. AGENT cu același CUI ca ȘEFUL invitator (14399840) → respins, formatul nu ocolește
  v_inv := pg_temp.in_seed_inv('agent', 'tok-in22-a', v_h1);
  v := pg_temp.in_u(u1, pg_temp.in_rs('agent', 'tok-in22-a', p_cui => 'RO 14399840'));
  if v is distinct from want_conflict then raise exception 'IN22 FAIL: agent cu CUI-ul șefului: %', v; end if;
  v := pg_temp.in_u(u1, pg_temp.in_rs('agent', 'tok-in22-a', p_cui => ' 14399840 '));
  if v is distinct from want_conflict then raise exception 'IN22 FAIL: același CUI, alt format: %', v; end if;
  if pg_temp.in_inv_used(v_inv) or exists (select 1 from public.affiliates where profile_id = u1) then
    raise exception 'IN22 FAIL: un CUI în conflict a consumat invitația / creat cont'; end if;
  -- 2. același CUI ca al ALTUI afiliat activ (agentul G1: 2816464)
  v := pg_temp.in_u(u1, pg_temp.in_rs('agent', 'tok-in22-a', p_cui => '2816464'));
  if v is distinct from want_conflict then raise exception 'IN22 FAIL: CUI-ul altui agent: %', v; end if;
  -- 3. același CUI la DOI șefi: al doilea respins
  perform pg_temp.in_seed_inv('head', 'tok-in22-h', null);
  v := pg_temp.in_u(u2, pg_temp.in_rs('head', 'tok-in22-h', p_cui => '14399840'));
  if v is distinct from want_conflict then raise exception 'IN22 FAIL: al doilea șef cu același CUI: %', v; end if;
  -- 4. CONTROL POZITIV: un CUI nou trece (agentul u1, apoi șeful u2)
  v := pg_temp.in_u(u1, pg_temp.in_rs('agent', 'tok-in22-a'));
  if (v->>'ok') is distinct from 'true' then raise exception 'IN22 FAIL (control): agent cu CUI nou: %', v; end if;
  v := pg_temp.in_u(u2, pg_temp.in_rs('head', 'tok-in22-h'));
  if (v->>'ok') is distinct from 'true' then raise exception 'IN22 FAIL (control): șef cu CUI nou: %', v; end if;
  select declared_cui into v_old from public.affiliate_contract_acceptances
   where affiliate_id = (select id from public.affiliates where profile_id = u1);

  -- 5. contează DOAR ultima acceptare a fiecărui afiliat
  v_new := pg_temp.in_next_cui();
  insert into public.affiliate_contract_acceptances (affiliate_id, kind, contract_version, text_hash, declared_cui, accepted_at)
    select id, 'agent', '1.1', repeat('c', 64), v_new, clock_timestamp() + interval '1 second'
      from public.affiliates where profile_id = u1;
  perform pg_temp.in_seed_inv('head', 'tok-in22-old', null);
  v := pg_temp.in_u(u3, pg_temp.in_rs('head', 'tok-in22-old', p_cui => v_old));
  if (v->>'ok') is distinct from 'true' then raise exception 'IN22 FAIL: CUI-ul vechi (înlocuit) al unui afiliat ar trebui să fie liber: %', v; end if;
  perform pg_temp.in_seed_inv('head', 'tok-in22-new', null);
  v := pg_temp.in_u(u4, pg_temp.in_rs('head', 'tok-in22-new', p_cui => v_new));
  if v is distinct from want_conflict then raise exception 'IN22 FAIL: CUI-ul NOU (ultima acceptare) nu conflictează: %', v; end if;

  -- 6. un afiliat ÎNCHIS eliberează CUI-ul
  update public.affiliates set status = 'closed' where profile_id = u3;
  v_old := (select declared_cui from public.affiliate_contract_acceptances
             where affiliate_id = (select id from public.affiliates where profile_id = u3));
  v := pg_temp.in_u(u4, pg_temp.in_rs('head', 'tok-in22-new', p_cui => v_old));
  if (v->>'ok') is distinct from 'true' then raise exception 'IN22 FAIL: CUI-ul unui cont închis ar trebui să fie liber: %', v; end if;
  -- 7. un afiliat ȘTERS (GDPR) eliberează CUI-ul
  v_er := pg_temp.in_next_cui();
  insert into public.affiliates (id, profile_id, referral_code, status, erased_at)
    values ('5aa00000-0000-4000-8000-0000000000e9', null, 'inerased1', 'active', now());
  insert into public.affiliate_contract_acceptances (affiliate_id, kind, contract_version, text_hash, declared_cui)
    values ('5aa00000-0000-4000-8000-0000000000e9', 'agent', '1.0', repeat('c', 64), v_er);
  perform pg_temp.in_seed_inv('head', 'tok-in22-er', null);
  v := pg_temp.in_u(u5, pg_temp.in_rs('head', 'tok-in22-er', p_cui => v_er));
  if (v->>'ok') is distinct from 'true' then raise exception 'IN22 FAIL: CUI-ul unui cont șters ar trebui să fie liber: %', v; end if;
  -- 8. un afiliat SUSPENDAT ține CUI-ul
  update public.affiliates set status = 'suspended' where profile_id = u5;
  perform pg_temp.in_seed_inv('head', 'tok-in22-susp', null);
  v := pg_temp.in_u(u6, pg_temp.in_rs('head', 'tok-in22-susp', p_cui => v_er));
  if v is distinct from want_conflict then raise exception 'IN22 FAIL: CUI-ul unui cont suspendat trebuie să rămână ocupat: %', v; end if;

  -- 9. lacăt advisory pe CUI + verificarea e ÎNAINTEA creării contului (structural)
  if (select prosrc from pg_proc where oid = 'public.sales_invite_redeem(text,text,text,text,text,text,boolean)'::regprocedure)
       !~ 'pg_advisory_xact_lock\(hashtextextended\(''menuvia\.sales_cui:'' \|\| v_cui' then
    raise exception 'IN22 FAIL: lipsește lacătul advisory pe CUI'; end if;
  -- toate rândurile create prin răscumpărări trec de verificarea deferred
  set constraints all immediate;
  set constraints all deferred;
  raise notice 'IN22 OK: CUI-ul șefului / altui afiliat / celui de-al doilea șef → cui_conflict (format ignorat); doar ultima acceptare; închis și șters eliberează, suspendat ține; control pozitiv cu CUI nou';
end $$;

-- ── IN23: D8 ÎN DATE ────────────────────────────────────────────────────────
do $$
declare
  F  constant uuid := '5a000000-0000-4000-8000-0000000000f1';
  H1 constant uuid := '5a000000-0000-4000-8000-000000000001';
  v_h1 uuid; v_code text; v jsonb; v_raised boolean; v_hint text; n_before int; n_after int;
  a uuid; b uuid; c uuid; v_lp uuid := '5aa00000-0000-4000-8000-0000000000f2';
  v_lc uuid := '5aa00000-0000-4000-8000-0000000000f3';
begin
  select id, referral_code into v_h1, v_code from public.affiliates where profile_id = H1;
  a := pg_temp.in_mkuser('d8a'); b := pg_temp.in_mkuser('d8b'); c := pg_temp.in_mkuser('d8c');

  -- Redeschidem programul public prin mecanismul REAL (founder).
  v := pg_temp.in_u(F, $q$public.admin_set_affiliate_program_open(true)$q$);
  if (v->>'ok') is distinct from 'true' then raise exception 'IN23 FAIL: nu am putut deschide programul: %', v; end if;
  if not public.affiliate_program_is_open() then raise exception 'IN23 FAIL (control): programul nu s-a deschis'; end if;

  -- 1. register_affiliate cu CODUL șefului → cererea se naște, dar COMMIT-ul ar pica.
  v_raised := false;
  begin
    v := pg_temp.in_u(a, format('public.register_affiliate(%L, %L, %L)', v_code, '0722111222', 'nota'));
    if (v->>'ok') is distinct from 'true' then raise exception 'IN23 FAIL (control): register_affiliate: %', v; end if;
    set constraints all immediate;
  exception when check_violation then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_raised := true;
  end;
  set constraints all deferred;
  if not v_raised or v_hint is distinct from 'invariant:agent_requires_invitation' then
    raise exception 'IN23 FAIL: un cont fără invitație a ajuns sub un șef prin register_affiliate (hint %)', v_hint; end if;

  -- 2. o cerere pending DEJA existentă (creată înainte de trigger) aprobată de fondator
  set constraints all immediate; set constraints all deferred;   -- ALTER TABLE cere zero evenimente în așteptare
  alter table public.affiliates disable trigger trg_affiliate_sales_role_parent;
  insert into public.affiliates (id, profile_id, referral_code, status, parent_affiliate_id, phone)
    values ('5aa00000-0000-4000-8000-0000000000f1', b, 'ind8pend1', 'pending', v_h1, '0722111222');
  set constraints all immediate; set constraints all deferred;
  alter table public.affiliates enable trigger trg_affiliate_sales_role_parent;
  v_raised := false;
  begin
    v := pg_temp.in_u(F, $q$public.admin_review_affiliate('5aa00000-0000-4000-8000-0000000000f1', true, true)$q$);
    if (v->>'ok') is distinct from 'true' then raise exception 'IN23 FAIL (control): review: %', v; end if;
    set constraints all immediate;
  exception when check_violation then v_raised := true;
  end;
  set constraints all deferred;
  if not v_raised then raise exception 'IN23 FAIL: admin_review_affiliate a aprobat un cont fără invitație sub un șef'; end if;

  -- 3. `team` listează DOAR agenți (date vechi, dinainte de trigger, nu apar)
  v := pg_temp.in_u(H1, $q$public.get_sales_network()$q$);
  n_before := jsonb_array_length(v->'team');
  set constraints all immediate; set constraints all deferred;
  alter table public.affiliates disable trigger trg_affiliate_sales_role_parent;
  insert into public.affiliates (id, profile_id, referral_code, status, parent_affiliate_id, phone)
    values ('5aa00000-0000-4000-8000-0000000000f4', c, 'ind8old01', 'active', v_h1, '0722111222');
  set constraints all immediate; set constraints all deferred;
  alter table public.affiliates enable trigger trg_affiliate_sales_role_parent;
  v := pg_temp.in_u(H1, $q$public.get_sales_network()$q$);
  n_after := jsonb_array_length(v->'team');
  if n_after <> n_before or n_before < 1 then
    raise exception 'IN23 FAIL: team conține un cont fără sales_role=agent (% → %)', n_before, n_after; end if;
  delete from public.affiliates where id = '5aa00000-0000-4000-8000-0000000000f4';

  -- 4. INVERS: un cont legacy cu copii legacy NU poate deveni membru al rețelei
  -- (profile_id NULL cere erased_at — conturi „legacy" fără persoană, doar pentru structură)
  insert into public.affiliates (id, profile_id, referral_code, erased_at) values (v_lp, null, 'inlegp01', now());
  insert into public.affiliates (id, profile_id, referral_code, parent_affiliate_id, erased_at)
    values (v_lc, null, 'inlegc01', v_lp, now());
  set constraints all immediate;   -- control: legacy sub legacy e permis
  set constraints all deferred;
  v_raised := false;
  begin
    update public.affiliates set sales_role = 'head' where id = v_lp;
    set constraints all immediate;
  exception when check_violation then v_raised := true;
  end;
  set constraints all deferred;
  if not v_raised then raise exception 'IN23 FAIL: un cont cu copii fără invitație a devenit șef'; end if;

  -- 5. CONTROL POZITIV: un agent intrat prin invitație trece de verificarea deferred
  perform pg_temp.in_seed_inv('agent', 'tok-in23-ok', v_h1);
  v := pg_temp.in_u(pg_temp.in_mkuser('d8ok'), pg_temp.in_rs('agent', 'tok-in23-ok'));
  if (v->>'ok') is distinct from 'true' then raise exception 'IN23 FAIL (control): agent prin invitație: %', v; end if;
  set constraints all immediate;
  set constraints all deferred;

  v := pg_temp.in_u(F, $q$public.admin_set_affiliate_program_open(false)$q$);
  if public.affiliate_program_is_open() then raise exception 'IN23 FAIL: programul a rămas deschis'; end if;
  raise notice 'IN23 OK: register_affiliate cu codul șefului și admin_review nu pot plasa un cont fără invitație sub un șef (trigger deferred, ambele sensuri); team doar agenți; control pozitiv';
end $$;

-- ── IN24: identitatea emailului ─────────────────────────────────────────────
do $$
declare
  want constant jsonb := '{"ok": false, "reason": "invite_invalid"}';
  anon uuid; unconf uuid; e1 uuid; e2 uuid;
  v jsonb; v_inv uuid; v_bearer uuid;
begin
  anon := pg_temp.in_mkuser('anon'); update auth.users set is_anonymous = true where id = anon;
  unconf := pg_temp.in_mkuser('unconf', false);
  e1 := pg_temp.in_mkuser('e1'); e2 := pg_temp.in_mkuser('e2');

  -- 1. cont ANONIM (is_anonymous) → anonymous_account, invitația neatinsă (și bearer)
  v_bearer := pg_temp.in_seed_inv('head', 'tok-in24-bearer', null);
  v := pg_temp.in_u(anon, pg_temp.in_rs('head', 'tok-in24-bearer'));
  if v is distinct from '{"ok": false, "reason": "anonymous_account"}'::jsonb then raise exception 'IN24 FAIL: cont anonim: %', v; end if;
  -- motivul NU depinde de token (nu e oracol)
  if pg_temp.in_u(anon, pg_temp.in_rs('head', 'nu-exista-deloc-in24')) is distinct from '{"ok": false, "reason": "anonymous_account"}'::jsonb then
    raise exception 'IN24 FAIL: anonymous_account depinde de token'; end if;
  if pg_temp.in_inv_used(v_bearer) then raise exception 'IN24 FAIL: invitația consumată de un cont anonim'; end if;

  -- 2. invitația LEGATĂ de email: cont NECONFIRMAT cu emailul potrivit → invite_invalid (identic cu inexistentă)
  v_inv := pg_temp.in_seed_inv('head', 'tok-in24-email', null, 'in-unconf@in302.test');
  v := pg_temp.in_u(unconf, pg_temp.in_rs('head', 'tok-in24-email'));
  if v is distinct from want
     or v is distinct from pg_temp.in_u(unconf, pg_temp.in_rs('head', 'token-inexistent-in24')) then
    raise exception 'IN24 FAIL: email neconfirmat: %', v; end if;
  if pg_temp.in_inv_used(v_inv) then raise exception 'IN24 FAIL: invitația legată de email consumată de un cont neconfirmat'; end if;
  -- 3. confirmat dar POTRIVIT altcuiva → invite_invalid; confirmat și potrivit → OK
  v_inv := pg_temp.in_seed_inv('head', 'tok-in24-e1', null, 'in-e1@in302.test');
  if pg_temp.in_u(e2, pg_temp.in_rs('head', 'tok-in24-e1')) is distinct from want then
    raise exception 'IN24 FAIL: email confirmat dar al altcuiva'; end if;
  v := pg_temp.in_u(e1, pg_temp.in_rs('head', 'tok-in24-e1'));
  if (v->>'ok') is distinct from 'true' then raise exception 'IN24 FAIL (control): email confirmat și potrivit: %', v; end if;
  -- 4. invitația fără email (bearer) se răscumpără de un cont non-anonim chiar NECONFIRMAT
  v := pg_temp.in_u(unconf, pg_temp.in_rs('head', 'tok-in24-bearer'));
  if (v->>'ok') is distinct from 'true' then raise exception 'IN24 FAIL (control): bearer, cont neconfirmat non-anonim: %', v; end if;
  raise notice 'IN24 OK: anonim → anonymous_account (independent de token); email-bound cere email CONFIRMAT și potrivit (altfel invite_invalid); bearer merge pe cont non-anonim';
end $$;

-- ── IN25: hash legat de versiune, reguli de versiune, consimțământ stabil, revocare ──
do $$
declare
  F  constant uuid := '5a000000-0000-4000-8000-0000000000f1';
  H1 constant uuid := '5a000000-0000-4000-8000-000000000001';
  v jsonb; u1 uuid; u2 uuid; u3 uuid; v_id uuid; v_ts timestamptz; w text; v_h1 uuid;
begin
  select id into v_h1 from public.affiliates where profile_id = H1;
  u1 := pg_temp.in_mkuser('n25a'); u2 := pg_temp.in_mkuser('n25b'); u3 := pg_temp.in_mkuser('n25c');

  -- 1. hash legat de versiune: orice 64 hex ≠ publicat → contract_hash_mismatch (și 000…0)
  v_id := pg_temp.in_seed_inv('head', 'tok-in25', null);
  foreach w in array array[repeat('b', 64), repeat('0', 64), repeat('a', 63) || 'b'] loop
    v := pg_temp.in_u(u1, pg_temp.in_rs('head', 'tok-in25', p_hash => w));
    if v is distinct from '{"ok": false, "reason": "contract_hash_mismatch"}'::jsonb then
      raise exception 'IN25 FAIL: hash % → %', left(w, 6), v; end if;
    -- ACELAȘI răspuns pentru un token inexistent (verificarea e ÎNAINTEA tokenului)
    if pg_temp.in_u(u1, pg_temp.in_rs('head', 'token-inexistent-in25', p_hash => w)) is distinct from v then
      raise exception 'IN25 FAIL: contract_hash_mismatch depinde de token'; end if;
  end loop;
  -- format prost rămâne contract_hash_invalid (nu mismatch)
  if pg_temp.in_u(u1, pg_temp.in_rs('head', 'tok-in25', p_hash => 'xyz')) is distinct from '{"ok": false, "reason": "contract_hash_invalid"}'::jsonb then
    raise exception 'IN25 FAIL: hash non-hex'; end if;
  if pg_temp.in_inv_used(v_id) then raise exception 'IN25 FAIL: un hash greșit a consumat invitația'; end if;
  -- schimbarea hash-ului publicat mută poarta: acum 'bbb…' e cel bun, 'aaa…' nu
  v := pg_temp.in_publish('1.0', repeat('b', 64));
  if (v->>'ok') is distinct from 'true' then raise exception 'IN25 FAIL: republicare cu alt hash: %', v; end if;
  if pg_temp.in_u(u1, pg_temp.in_rs('head', 'tok-in25')) is distinct from '{"ok": false, "reason": "contract_hash_mismatch"}'::jsonb then
    raise exception 'IN25 FAIL: hash-ul vechi trece după republicare'; end if;
  v := pg_temp.in_u(u1, pg_temp.in_rs('head', 'tok-in25', p_hash => repeat('B', 64)));   -- majuscule normalizate
  if (v->>'ok') is distinct from 'true' then raise exception 'IN25 FAIL (control): hash-ul publicat respins: %', v; end if;
  if (select text_hash from public.affiliate_contract_acceptances
       where affiliate_id = (select id from public.affiliates where profile_id = u1)) is distinct from repeat('b', 64) then
    raise exception 'IN25 FAIL: hash-ul acceptării ≠ cel publicat'; end if;
  v := pg_temp.in_publish('1.0');   -- înapoi la aaa…
  -- get_sales_network expune hash-ul publicat (UI-ul poate verifica textul înainte de „Accept")
  v := pg_temp.in_u(H1, $q$public.get_sales_network()$q$);
  if (v #>> '{contract,current_text_hash}') is distinct from repeat('a', 64) then
    raise exception 'IN25 FAIL: current_text_hash lipsește din get_sales_network: %', v->'contract'; end if;

  -- 2. reguli de versiune
  foreach w in array array['null', 'None', 'UNDEFINED', 'false', 'TRUE', 'NaN', 'v', '1.', '.1', '1..2', '1.0-beta', 'vv1', '1.2.3.4.5.6.7.8.9.10.11', ' ', '1 0'] loop
    if w = ' ' then continue; end if;
    v := pg_temp.in_publish(w);
    if (v->>'ok') is distinct from 'false' or (v->>'reason') not in ('invalid_version', 'draft_version') then
      raise exception 'IN25 FAIL: versiunea "%" acceptată: %', w, v; end if;
  end loop;
  foreach w in array array['2', 'v1.2.3', '10.0', 'v7'] loop
    v := pg_temp.in_publish(w);
    if (v->>'ok') is distinct from 'true' then raise exception 'IN25 FAIL: versiunea validă "%" respinsă: %', w, v; end if;
  end loop;
  v := pg_temp.in_publish('1.0');

  -- 3. contact_sharing_at STABIL la re-apel cu true
  perform pg_temp.in_u(u1, $q$public.set_my_contact_sharing(true)$q$);
  update public.affiliates set contact_sharing_at = timestamptz '2026-01-01 10:00:00+00' where profile_id = u1;
  perform pg_temp.in_u(u1, $q$public.set_my_contact_sharing(true)$q$);
  select contact_sharing_at into v_ts from public.affiliates where profile_id = u1;
  if v_ts is distinct from timestamptz '2026-01-01 10:00:00+00' then
    raise exception 'IN25 FAIL: set_my_contact_sharing(true) a rescris contact_sharing_at (%)', v_ts; end if;
  perform pg_temp.in_u(u1, $q$public.set_my_contact_sharing(false)$q$);
  if (select contact_sharing_at from public.affiliates where profile_id = u1) is not null then
    raise exception 'IN25 FAIL: contact_sharing_at nu s-a golit la retragere'; end if;
  perform pg_temp.in_u(u1, $q$public.set_my_contact_sharing(true)$q$);
  if (select contact_sharing_at from public.affiliates where profile_id = u1) is null then
    raise exception 'IN25 FAIL: contact_sharing_at nu s-a setat la re-consimțământ'; end if;

  -- 4. REVOCAREA golește email și notă (fondator + șef)
  v := pg_temp.in_u(F, $q$public.admin_create_sales_head_invite('persoana@exemplu.test', 'nota liberă cu nume')$q$);
  v_id := (v->>'invite_id')::uuid;
  v := pg_temp.in_u(F, format('public.admin_revoke_affiliate_invite(%L)', v_id));
  if (v->>'ok') is distinct from 'true' then raise exception 'IN25 FAIL: revocare fondator: %', v; end if;
  if exists (select 1 from public.affiliate_invitations where id = v_id and (email is not null or note is not null)) then
    raise exception 'IN25 FAIL: revocarea de fondator păstrează email/notă'; end if;
  v := pg_temp.in_u(H1, $q$public.create_agent_invite('nota șefului cu nume')$q$);
  v_id := (v->>'invite_id')::uuid;
  v := pg_temp.in_u(H1, format('public.revoke_agent_invite(%L)', v_id));
  if (v->>'ok') is distinct from 'true' then raise exception 'IN25 FAIL: revocare șef: %', v; end if;
  if exists (select 1 from public.affiliate_invitations where id = v_id and (email is not null or note is not null)) then
    raise exception 'IN25 FAIL: revocarea de șef păstrează nota'; end if;
  -- control pozitiv: invitația ne-revocată își păstrează nota
  v := pg_temp.in_u(H1, $q$public.create_agent_invite('rămâne')$q$);
  if (select note from public.affiliate_invitations where id = (v->>'invite_id')::uuid) is distinct from 'rămâne' then
    raise exception 'IN25 FAIL (control): nota unei invitații active a dispărut'; end if;
  raise notice 'IN25 OK: hash ≠ publicat → contract_hash_mismatch (independent de token, și 000…0); reguli de versiune; contact_sharing_at stabil; revocarea golește email/notă';
end $$;

-- ── IN21: lista fondatorului + scanare GLOBALĂ finală de token ──────────────
do $$
declare
  F constant uuid := '5a000000-0000-4000-8000-0000000000f1';
  v jsonb; v_keys text; r record; v_hits int; v_total int := 0; v_n int;
begin
  v := pg_temp.in_u(F, $q$public.admin_list_affiliate_invites()$q$);
  if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) < 10 then
    raise exception 'IN21 FAIL: lista admin: %', left(v::text, 300); end if;
  v_keys := (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(v->0) k);
  if v_keys is distinct from 'created_at,email,expires_at,id,invited_by_affiliate_id,invited_by_name,kind,note,revoked_at,state,used_at,used_by_affiliate_id,used_by_name' then
    raise exception 'IN21 FAIL: forma listei: %', v_keys; end if;
  -- toate cele 4 stări apar (open/used/revoked/expired) — control pozitiv al CASE-ului
  for r in select s from unnest(array['open', 'used', 'revoked', 'expired']) s loop
    if not exists (select 1 from jsonb_array_elements(v) e where e->>'state' = r.s) then
      raise exception 'IN21 FAIL: starea % lipsește din listă', r.s; end if;
  end loop;
  -- ordine descrescătoare după created_at
  if exists (select 1 from (select (e->>'created_at')::timestamptz c, lag((e->>'created_at')::timestamptz) over (order by ord) p
                               from jsonb_array_elements(v) with ordinality t(e, ord)) x where x.p < x.c) then
    raise exception 'IN21 FAIL: ordinea listei'; end if;
  -- niciun email nu supraviețuiește pe invitațiile FOLOSITE
  if exists (select 1 from jsonb_array_elements(v) e where e->>'state' = 'used' and e->'email' <> 'null'::jsonb) then
    raise exception 'IN21 FAIL: email păstrat pe o invitație folosită'; end if;

  -- SCANARE GLOBALĂ: niciun token creat în test nu apare în NICIUN tabel din public.
  select count(*) into v_n from in_tokens;
  if v_n < 6 then raise exception 'IN21 FAIL (control pozitiv): doar % tokenuri colectate', v_n; end if;
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' loop
    execute format('select count(*) from public.%I t, in_tokens k where position(k.token in t::text) > 0', r.relname) into v_hits;
    v_total := v_total + v_hits;
    if v_hits > 0 then raise exception 'IN21 FAIL: un token apare în clar în public.% (% rânduri)', r.relname, v_hits; end if;
  end loop;
  -- control pozitiv al scanerului: hash-ul UNUI token apare (altfel scanarea ar putea fi oarbă)
  execute format('select count(*) from public.affiliate_invitations t where position(%L in t::text) > 0',
                 public.sales_invite_token_hash((select token from in_tokens where label = 'head1'))) into v_hits;
  if v_hits <> 1 then raise exception 'IN21 FAIL (control scaner): hash-ul tokenului head1 apare de % ori', v_hits; end if;
  raise notice 'IN21 OK: lista admin (formă, 4 stări, ordine, fără email pe folosite); % tokenuri scanate în toate tabelele din public — niciun token în clar', v_n;
end $$;

rollback;
\echo '✅ RETEA PE INVITATII OK (IN1-IN25)'
