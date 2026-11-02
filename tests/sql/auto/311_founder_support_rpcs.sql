-- tests/sql/auto/311_founder_support_rpcs.sql
-- =============================================================================
-- FS1–FS8 — clichetul PERMANENT al mig 311: fondatorul în vizită (platform
-- admin FĂRĂ membership) poate roti QR-ul unei mese și salva harta sălii;
-- restul refuzurilor rămân neatinse. Rulează pe AMBELE medii (sql-verify +
-- E2E), autonom, ROLLBACK la final.
--
-- Apelurile se fac SUB rolul REAL `authenticated` (și `anon` pentru suprafață):
-- ca `postgres`, EXECUTE e ocolit, deci un grant greșit ar trece nevăzut (clasa
-- TP23/PF). `auth.uid()` vine din `request.jwt.claim.sub`.
--
--   FS1  fondatorul (is_platform_admin, fără membership) rotește QR-ul unei mese
--        străine: răspuns ok, tokenul vechi inactiv, unul nou activ.
--        [PICĂ: escape-ul scos din rotate_qr_token — codul din 022]
--   FS2  un cont autentificat fără membership și FĂRĂ admin e refuzat; niciun
--        token nu se schimbă. [PICĂ: verificarea de rol scoasă de tot]
--   FS3  ospătarul restaurantului (membership `waiter`) e refuzat la rotire —
--        refuzul pe rol a supraviețuit copiei. [PICĂ: `role in (...)` lărgit]
--   FS4  fondatorul salvează harta sălii (restaurant pe pro, floor_plan).
--        [PICĂ: escape-ul scos din save_floor_layout — codul din 154]
--   FS5  străinul și ospătarul sunt refuzați la salvarea hărții; harta rămâne
--        cea de dinainte. [PICĂ: escape-ul pus și pe ramura `elsif` fără rol]
--   FS6  gate-ul de plan rămâne: fondatorul pe un restaurant FĂRĂ floor_plan
--        (free) e refuzat cu hint `feature_disabled`. [PICĂ: gate-ul 154 pierdut]
--   FS7  control pozitiv: owner-ul își rotește singur QR-ul (funcția merge
--        pentru cazul normal — altfel FS2/FS3 ar trece pe o funcție ruptă).
--   FS8  suprafața: anon NU are EXECUTE (privilegiu efectiv + apel real cu eroare
--        pe FUNCȚIE, nu pe schemă), authenticated da; DEFINER + `public,
--        pg_temp`; fără `has_partner_access` în corp (partenerul nu primește
--        nimic). [PICĂ: `grant execute ... to anon`; `create or replace` fără
--        `set search_path`]
-- =============================================================================

begin;

-- ── Fixtură ──────────────────────────────────────────────────────────────────
--   O1/R1 owner pe PRO (floor_plan), masa T1 cu token activ
--   O2/R2 owner pe FREE (fără floor_plan)
--   W1    ospătar pe R1
--   X     cont autentificat străin
--   F     fondator (is_platform_admin), fără niciun membership
insert into auth.users (id, email) values
  ('31100000-0000-4000-8000-0000000000b1', 'fs-owner1@fs311.test'),
  ('31100000-0000-4000-8000-0000000000b2', 'fs-owner2@fs311.test'),
  ('31100000-0000-4000-8000-0000000000c1', 'fs-waiter@fs311.test'),
  ('31100000-0000-4000-8000-0000000000d1', 'fs-stranger@fs311.test'),
  ('31100000-0000-4000-8000-0000000000f1', 'fs-founder@fs311.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email)
  select id, email from auth.users where email like 'fs-%@fs311.test'
  on conflict (id) do nothing;
update public.profiles set plan = 'pro' where id = '31100000-0000-4000-8000-0000000000b1';
update public.profiles set plan = 'free' where id = '31100000-0000-4000-8000-0000000000b2';
update public.profiles set is_platform_admin = true
 where id = '31100000-0000-4000-8000-0000000000f1';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('311b0000-0000-4000-8000-000000000001', '31100000-0000-4000-8000-0000000000b1', 'FS Pro', 'fs311-pro', 'Cluj', true),
  ('311b0000-0000-4000-8000-000000000002', '31100000-0000-4000-8000-0000000000b2', 'FS Free', 'fs311-free', 'Cluj', true);
insert into public.restaurant_memberships (restaurant_id, user_id, role) values
  ('311b0000-0000-4000-8000-000000000001', '31100000-0000-4000-8000-0000000000c1', 'waiter');
insert into public.tables (id, restaurant_id, name, slug, is_active) values
  ('311c0000-0000-4000-8000-000000000001', '311b0000-0000-4000-8000-000000000001', 'Masa FS', 'masa-fs', true);
insert into public.qr_tokens (id, restaurant_id, table_id) values
  ('311d0000-0000-4000-8000-000000000001', '311b0000-0000-4000-8000-000000000001',
   '311c0000-0000-4000-8000-000000000001');

-- Rulează o expresie jsonb SUB rolul indicat, ca utilizatorul dat. Întoarce
-- rezultatul sau {raised:true, sqlstate, hint, error}. `set_config('role')` stă
-- ÎN AFARA sub-blocului cu excepție (altfel s-ar derula odată cu el).
create function pg_temp.fs_as(p_role text, p_uid uuid, p_sql text) returns jsonb
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
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  return v;
end $f$;

-- Varianta pentru o funcție `returns void` (save_floor_layout): rulează
-- instrucțiunea și întoarce {ok:true} sau aceeași formă de eroare.
create function pg_temp.fs_run(p_role text, p_uid uuid, p_sql text) returns jsonb
language plpgsql as $f$
declare v jsonb := '{"ok": true}'::jsonb; v_state text; v_hint text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('role', p_role, true);
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
    v := jsonb_build_object('raised', true, 'sqlstate', v_state, 'hint', v_hint, 'error', sqlerrm);
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  return v;
end $f$;

create function pg_temp.fs_active_tokens() returns int
language sql as $f$
  select count(*)::int from public.qr_tokens
   where table_id = '311c0000-0000-4000-8000-000000000001' and is_active
$f$;

-- ═══════ FS2 + FS3 (înaintea lui FS1: tokenul inițial e cel cunoscut) ═══════
do $$
declare v jsonb;
begin
  v := pg_temp.fs_as('authenticated', '31100000-0000-4000-8000-0000000000d1',
    $q$ public.rotate_qr_token('311c0000-0000-4000-8000-000000000001') $q$);
  if (v->>'raised') is distinct from 'true' or v->>'error' not like 'Acces interzis%' then
    raise exception 'FS2 FAIL: străinul a rotit QR-ul (sau altă eroare): %', v;
  end if;
  v := pg_temp.fs_as('authenticated', '31100000-0000-4000-8000-0000000000c1',
    $q$ public.rotate_qr_token('311c0000-0000-4000-8000-000000000001') $q$);
  if (v->>'raised') is distinct from 'true' or v->>'error' not like 'Acces interzis%' then
    raise exception 'FS3 FAIL: ospătarul a rotit QR-ul (sau altă eroare): %', v;
  end if;
  if not exists (select 1 from public.qr_tokens
                  where id = '311d0000-0000-4000-8000-000000000001' and is_active)
     or pg_temp.fs_active_tokens() <> 1 then
    raise exception 'FS2/FS3 FAIL: un refuz a schimbat totuși tokenul mesei';
  end if;
  raise notice 'FS2 + FS3 PASS';
end $$;

-- ═══════ FS1: fondatorul rotește QR-ul ═══════
do $$
declare v jsonb;
begin
  v := pg_temp.fs_as('authenticated', '31100000-0000-4000-8000-0000000000f1',
    $q$ public.rotate_qr_token('311c0000-0000-4000-8000-000000000001') $q$);
  if (v->>'ok') is distinct from 'true' then
    raise exception 'FS1 FAIL: fondatorul nu a putut roti QR-ul: %', v;
  end if;
  if exists (select 1 from public.qr_tokens
              where id = '311d0000-0000-4000-8000-000000000001' and is_active) then
    raise exception 'FS1 FAIL: tokenul vechi a rămas activ';
  end if;
  if not exists (select 1 from public.qr_tokens
                  where id = (v->>'new_token_id')::uuid and is_active
                    and table_id = '311c0000-0000-4000-8000-000000000001') then
    raise exception 'FS1 FAIL: tokenul nou nu e activ pe masă';
  end if;
  if pg_temp.fs_active_tokens() <> 1 then
    raise exception 'FS1 FAIL: masa are % tokenuri active', pg_temp.fs_active_tokens();
  end if;
  raise notice 'FS1 PASS';
end $$;

-- ═══════ FS7: control — owner-ul își rotește QR-ul ═══════
do $$
declare v jsonb;
begin
  v := pg_temp.fs_as('authenticated', '31100000-0000-4000-8000-0000000000b1',
    $q$ public.rotate_qr_token('311c0000-0000-4000-8000-000000000001') $q$);
  if (v->>'ok') is distinct from 'true' or pg_temp.fs_active_tokens() <> 1 then
    raise exception 'FS7 FAIL: owner-ul nu și-a putut roti QR-ul: %', v;
  end if;
  raise notice 'FS7 PASS';
end $$;

-- ═══════ FS4 + FS5 + FS6: harta sălii ═══════
do $$
declare v jsonb;
begin
  -- FS5 întâi: refuzurile nu ating harta (NULL la început).
  v := pg_temp.fs_run('authenticated', '31100000-0000-4000-8000-0000000000d1',
    $q$ select public.save_floor_layout('311b0000-0000-4000-8000-000000000001', '{"floors":[{"id":"x"}]}'::jsonb) $q$);
  if (v->>'raised') is distinct from 'true' or v->>'error' not like 'Acces interzis%' then
    raise exception 'FS5 FAIL: străinul a salvat harta (sau altă eroare): %', v;
  end if;
  v := pg_temp.fs_run('authenticated', '31100000-0000-4000-8000-0000000000c1',
    $q$ select public.save_floor_layout('311b0000-0000-4000-8000-000000000001', '{"floors":[{"id":"x"}]}'::jsonb) $q$);
  if (v->>'raised') is distinct from 'true' or v->>'error' not like 'Acces interzis%' then
    raise exception 'FS5 FAIL: ospătarul a salvat harta (sau altă eroare): %', v;
  end if;
  if (select floor_layout from public.restaurants
       where id = '311b0000-0000-4000-8000-000000000001') is not null then
    raise exception 'FS5 FAIL: un refuz a scris totuși harta';
  end if;

  -- FS4: fondatorul salvează.
  v := pg_temp.fs_run('authenticated', '31100000-0000-4000-8000-0000000000f1',
    $q$ select public.save_floor_layout('311b0000-0000-4000-8000-000000000001', '{"floors":[{"id":"fs"}]}'::jsonb) $q$);
  if (v->>'raised') = 'true' then
    raise exception 'FS4 FAIL: fondatorul nu a putut salva harta: %', v;
  end if;
  if (select floor_layout from public.restaurants
       where id = '311b0000-0000-4000-8000-000000000001') is distinct from '{"floors":[{"id":"fs"}]}'::jsonb then
    raise exception 'FS4 FAIL: harta salvată de fondator nu e cea trimisă';
  end if;

  -- FS6: gate-ul de plan rămâne și pentru fondator.
  v := pg_temp.fs_run('authenticated', '31100000-0000-4000-8000-0000000000f1',
    $q$ select public.save_floor_layout('311b0000-0000-4000-8000-000000000002', '{"floors":[]}'::jsonb) $q$);
  if (v->>'raised') is distinct from 'true' or v->>'hint' is distinct from 'feature_disabled' then
    raise exception 'FS6 FAIL: gate-ul floor_plan nu a refuzat restaurantul free: %', v;
  end if;
  raise notice 'FS4 + FS5 + FS6 PASS';
end $$;

-- ═══════ FS8: suprafața ═══════
do $$
declare
  v_sig text; v_src text; v_cfg text[]; v_def boolean; v jsonb;
begin
  foreach v_sig in array array['public.rotate_qr_token(uuid)', 'public.save_floor_layout(uuid,jsonb)'] loop
    if has_function_privilege('anon', v_sig::regprocedure, 'execute') then
      raise exception 'FS8 FAIL: % e executabilă de anon', v_sig; end if;
    if not has_function_privilege('authenticated', v_sig::regprocedure, 'execute') then
      raise exception 'FS8 FAIL: authenticated nu poate executa %', v_sig; end if;
    select prosrc, proconfig, prosecdef into v_src, v_cfg, v_def
      from pg_proc where oid = v_sig::regprocedure;
    if not v_def or not (v_cfg @> array['search_path=public, pg_temp']) then
      raise exception 'FS8 FAIL: % nu e DEFINER cu search_path public, pg_temp (%)', v_sig, v_cfg; end if;
    if position('has_partner_access' in v_src) > 0 then
      raise exception 'FS8 FAIL: % dă acces partenerului', v_sig; end if;
  end loop;
  v := pg_temp.fs_as('anon', null,
    $q$ public.rotate_qr_token('311c0000-0000-4000-8000-000000000001') $q$);
  if (v->>'sqlstate') is distinct from '42501' or v->>'error' not like '%for function%' then
    raise exception 'FS8 FAIL: anon a apelat rotate_qr_token (sau eroare pe altceva): %', v;
  end if;
  raise notice 'FS8 PASS';
end $$;

rollback;
