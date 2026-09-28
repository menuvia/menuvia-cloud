-- tests/sql/vat_preset_assertions.sql
-- =============================================================================
-- FR-07 (mig 285): preset-ul TVA din Setup Asistent == cotele implicite legale.
--
-- Înainte de 285, `apply_vat_preset` (mig 034) scria 19/9/5% — cote abrogate de
-- L.141/2025 — în timp ce restaurantele NOI primeau 11/21 (mig 102/109). Două
-- surse pentru același lucru au divergat. Acum ambele derivă din
-- `vat_rate_defaults_ro()`; suita ține relația PE COMPORTAMENT (VP1), ancora
-- LEGALĂ (VP2 — altfel sursa și preset-ul ar putea deriva ÎMPREUNĂ spre o cotă
-- greșită, iar VP1 ar rămâne verde) și cele trei defecte laterale.
--
--   VP1  preset == default-urile unui restaurant NOU, pornind de la un local
--        pre-102 (9/19/5/0, etichete vechi, grupa 3 inactivă)
--   VP2  ancora legală: sursa unică + trigger-ul dau EXACT {1:11, 2:21, 3:11, 4:0};
--        nicio cotă abrogată (5/9/19) după preset
--   VP3  maparea pe casă (setată de instalator) NU e atinsă de preset
--   VP4  grupele LIPSĂ se re-creează identic cu trigger-ul de creare
--   VP5  id-urile vechi → hint `vat_preset_retired`, registru NEATINS;
--        id necunoscut / NULL → hint `invalid_preset`
--   VP6  non-admin (străin, fără JWT) respins, registru NEATINS
--   VP7  catalog: 1 semnătură, DEFINER + pg_temp, EXECUTE doar authenticated,
--        sursa unică închisă clientului, AMBELE funcții derivă din ea
--
-- Rulează ca `postgres` (sql-verify) și pe stack-ul Supabase real (jobul E2E din
-- ci.yml — acolo default privileges dau EXECUTE lui anon pe orice funcție NOUĂ,
-- deci VP7 are muncă reală doar acolo). Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Fixtură: câte un owner per restaurant (enforce_restaurant_limit, mig 131)
insert into auth.users (id, email) values
  ('78500000-0000-4000-8000-000000000001', 'vp-owner1@vp.test'),
  ('78500000-0000-4000-8000-000000000002', 'vp-owner2@vp.test'),
  ('78500000-0000-4000-8000-000000000003', 'vp-owner3@vp.test'),
  ('78500000-0000-4000-8000-000000000009', 'vp-stranger@vp.test');

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('785b0000-0000-4000-8000-000000000001', '78500000-0000-4000-8000-000000000001', 'VP Nou',   'vp-285-nou',   'Cluj',   true),
  ('785b0000-0000-4000-8000-000000000002', '78500000-0000-4000-8000-000000000002', 'VP Vechi', 'vp-285-vechi', 'Iași',   true),
  ('785b0000-0000-4000-8000-000000000003', '78500000-0000-4000-8000-000000000003', 'VP Lipsă', 'vp-285-lipsa', 'Brașov', true);

-- R2 = local de dinainte de mig 102 care apăsase preset-ul vechi 'tourism_5':
-- cote abrogate, etichete vechi, grupa 3 dezactivată, și o mapare pe casă setată
-- de INSTALATOR care diferă de ORICE scriau preset-urile vechi (food_9/tourism_5
-- scriau 1→2, 2→1, 3→3; simple_19 scria 1→1) — altfel VP3 ar trece și pe corpul vechi.
update public.vat_rates v
   set rate_percent    = x.r,
       label           = x.l,
       description     = x.d,
       fiscalnet_group = x.fg,
       is_active       = x.a
  from (values
    (1::smallint,  9.00, 'Cotă restaurant 9%', 'Restaurant și catering',       4::smallint, true),
    (2::smallint, 19.00, 'Cotă standard 19%',  'Alcool, alte vânzări',         3::smallint, true),
    (3::smallint,  5.00, 'Cotă turism 5%',     'Cazare turistică, agroturism', 5::smallint, false),
    (4::smallint,  0.00, 'Scutit',             'Scutit TVA',                   2::smallint, true)
  ) x(g, r, l, d, fg, a)
 where v.restaurant_id = '785b0000-0000-4000-8000-000000000002'
   and v.vat_group = x.g;

-- R3 = local căruia îi lipsesc grupele 3/4 (șterse manual; `vat_rates` nu are
-- gardă pe DELETE sub „admin manage").
delete from public.vat_rates
 where restaurant_id = '785b0000-0000-4000-8000-000000000003' and vat_group in (3, 4);

-- ── VP1: preset == default-urile unui restaurant nou ─────────────────────────
do $$
declare v_res jsonb; v_n int; v_diff int;
begin
  perform set_config('request.jwt.claim.sub', '78500000-0000-4000-8000-000000000002', true);
  v_res := public.apply_vat_preset('785b0000-0000-4000-8000-000000000002', 'ro_l141_2025');
  perform set_config('request.jwt.claim.sub', '', true);

  -- Întâi CONȚINUTUL (invariantul FR-07), abia apoi forma răspunsului — altfel
  -- o mutație care scrie mai puține grupe ar pica pe `rates_applied` și nu am
  -- ști dacă egalitatea de mulțimi de mai jos o prinde singură.
  -- Egalitate de MULȚIMI în ambele sensuri, pe toate coloanele de conținut.
  select count(*) into v_diff from (
    (select vat_group, rate_percent, label, description, is_active from public.vat_rates
      where restaurant_id = '785b0000-0000-4000-8000-000000000001'
     except
     select vat_group, rate_percent, label, description, is_active from public.vat_rates
      where restaurant_id = '785b0000-0000-4000-8000-000000000002')
    union all
    (select vat_group, rate_percent, label, description, is_active from public.vat_rates
      where restaurant_id = '785b0000-0000-4000-8000-000000000002'
     except
     select vat_group, rate_percent, label, description, is_active from public.vat_rates
      where restaurant_id = '785b0000-0000-4000-8000-000000000001')
  ) x;
  if v_diff <> 0 then
    raise exception 'VP1 FAIL: preset-ul diferă de default-urile unui restaurant nou în % rânduri', v_diff;
  end if;

  select count(*) into v_n from public.vat_rates
   where restaurant_id = '785b0000-0000-4000-8000-000000000002';
  if v_n <> 4 then raise exception 'VP1 FAIL: % grupe după preset (aștept 4)', v_n; end if;

  if v_res->>'status' is distinct from 'success'
     or v_res->>'preset' is distinct from 'ro_l141_2025'
     or (v_res->>'rates_applied')::int is distinct from 4 then
    raise exception 'VP1 FAIL: răspuns neașteptat %', v_res;
  end if;
  raise notice 'VP1 OK: preset == default-urile restaurantului nou (4 grupe, conținut identic)';
end $$;

-- ── VP2: ancora legală (L.141/2025) ──────────────────────────────────────────
do $$
declare v_diff int; v_bad int;
begin
  -- Sursa unică.
  select count(*) into v_diff from (
    (select d.vat_group, d.rate_percent from public.vat_rate_defaults_ro() d
     except
     select w.g, w.r from (values (1::smallint, 11.00::numeric), (2::smallint, 21.00::numeric),
                                  (3::smallint, 11.00::numeric), (4::smallint,  0.00::numeric)) w(g, r))
    union all
    (select w.g, w.r from (values (1::smallint, 11.00::numeric), (2::smallint, 21.00::numeric),
                                  (3::smallint, 11.00::numeric), (4::smallint,  0.00::numeric)) w(g, r)
     except
     select d.vat_group, d.rate_percent from public.vat_rate_defaults_ro() d)
  ) x;
  if v_diff <> 0 then
    raise exception 'VP2 FAIL: vat_rate_defaults_ro nu e tabela L.141/2025 (11/21/11/0) — % diferențe', v_diff;
  end if;

  -- Trigger-ul de creare scrie EXACT sursa (conținut complet, nu doar cota).
  select count(*) into v_diff from (
    (select d.vat_group, d.rate_percent, d.label, d.description from public.vat_rate_defaults_ro() d
     except
     select vat_group, rate_percent, label, description from public.vat_rates
      where restaurant_id = '785b0000-0000-4000-8000-000000000001')
    union all
    (select vat_group, rate_percent, label, description from public.vat_rates
      where restaurant_id = '785b0000-0000-4000-8000-000000000001'
     except
     select d.vat_group, d.rate_percent, d.label, d.description from public.vat_rate_defaults_ro() d)
  ) x;
  if v_diff <> 0 then
    raise exception 'VP2 FAIL: trigger-ul de creare nu scrie sursa unică (% diferențe)', v_diff;
  end if;

  -- Clasa: nicio cotă abrogată pe restaurantul nou sau pe cel re-configurat.
  select count(*) into v_bad from public.vat_rates
   where restaurant_id in ('785b0000-0000-4000-8000-000000000001',
                           '785b0000-0000-4000-8000-000000000002')
     and rate_percent in (5, 9, 19);
  if v_bad <> 0 then
    raise exception 'VP2 FAIL: % rânduri cu cote abrogate (5/9/19) după preset', v_bad;
  end if;
  raise notice 'VP2 OK: sursa unică = trigger = 11/21/11/0; zero cote abrogate';
end $$;

-- ── VP3: maparea pe casă NU e atinsă ─────────────────────────────────────────
do $$
declare v_map text;
begin
  select string_agg(vat_group || '>' || fiscalnet_group, ',' order by vat_group) into v_map
    from public.vat_rates where restaurant_id = '785b0000-0000-4000-8000-000000000002';
  if v_map is distinct from '1>4,2>3,3>5,4>2' then
    raise exception 'VP3 FAIL: preset-ul a rescris maparea pe casă: % (aștept 1>4,2>3,3>5,4>2 — cea a instalatorului)', v_map;
  end if;
  raise notice 'VP3 OK: maparea pe casă a instalatorului a supraviețuit preset-ului';
end $$;

-- ── VP4: grupele lipsă se re-creează exact ca la trigger ─────────────────────
do $$
declare v_res jsonb; v_diff int;
begin
  perform set_config('request.jwt.claim.sub', '78500000-0000-4000-8000-000000000003', true);
  v_res := public.apply_vat_preset('785b0000-0000-4000-8000-000000000003', 'ro_l141_2025');
  perform set_config('request.jwt.claim.sub', '', true);

  if (v_res->>'rates_applied')::int is distinct from 4 then
    raise exception 'VP4 FAIL: rates_applied = % (aștept 4: 2 actualizate + 2 create)', v_res->>'rates_applied';
  end if;

  -- Comparăm și maparea pe casă: rândurile create de preset trebuie să arate
  -- ca ale trigger-ului (coloana pe default), nu o valoare inventată.
  select count(*) into v_diff from (
    (select vat_group, rate_percent, label, description, is_active, fiscalnet_group from public.vat_rates
      where restaurant_id = '785b0000-0000-4000-8000-000000000001'
     except
     select vat_group, rate_percent, label, description, is_active, fiscalnet_group from public.vat_rates
      where restaurant_id = '785b0000-0000-4000-8000-000000000003')
    union all
    (select vat_group, rate_percent, label, description, is_active, fiscalnet_group from public.vat_rates
      where restaurant_id = '785b0000-0000-4000-8000-000000000003'
     except
     select vat_group, rate_percent, label, description, is_active, fiscalnet_group from public.vat_rates
      where restaurant_id = '785b0000-0000-4000-8000-000000000001')
  ) x;
  if v_diff <> 0 then
    raise exception 'VP4 FAIL: după preset, restaurantul cu grupe lipsă diferă de unul nou în % rânduri', v_diff;
  end if;
  raise notice 'VP4 OK: grupele 3/4 re-create identic cu trigger-ul de creare';
end $$;

-- ── VP5: id-urile vechi sunt RETRASE, nu reinterpretate ──────────────────────
do $$
declare
  v_id     text;
  v_hint   text;
  v_caught boolean;
  v_before text;
  v_after  text;
begin
  -- Stare distinctă de default-uri: dacă un id vechi ar fi acceptat (ca alias
  -- sau cu corpul 034), rândul s-ar schimba și comparația ar vedea-o.
  update public.vat_rates set rate_percent = 9.00, label = 'Manual 9'
   where restaurant_id = '785b0000-0000-4000-8000-000000000002' and vat_group = 1;
  select string_agg(format('%s:%s:%s:%s:%s', vat_group, rate_percent, label, is_active, fiscalnet_group),
                    '|' order by vat_group)
    into v_before from public.vat_rates
   where restaurant_id = '785b0000-0000-4000-8000-000000000002';

  perform set_config('request.jwt.claim.sub', '78500000-0000-4000-8000-000000000002', true);
  foreach v_id in array array['simple_19', 'food_9', 'tourism_5'] loop
    v_caught := false; v_hint := null;
    begin
      perform public.apply_vat_preset('785b0000-0000-4000-8000-000000000002', v_id);
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      v_caught := true;
    end;
    if not v_caught then
      raise exception 'VP5 FAIL: preset-ul abrogat % a fost ACCEPTAT', v_id;
    end if;
    if v_hint is distinct from 'vat_preset_retired' then
      raise exception 'VP5 FAIL: % respins cu hint % (aștept vat_preset_retired)', v_id, v_hint;
    end if;
  end loop;

  -- Id necunoscut și NULL → invalid_preset (nu „retired", nu succes).
  foreach v_id in array array['ro_2024', null] loop
    v_caught := false; v_hint := null;
    begin
      perform public.apply_vat_preset('785b0000-0000-4000-8000-000000000002', v_id);
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      v_caught := true;
    end;
    if not v_caught or v_hint is distinct from 'invalid_preset' then
      raise exception 'VP5 FAIL: id % → caught=% hint=% (aștept invalid_preset)', coalesce(v_id, '<NULL>'), v_caught, v_hint;
    end if;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);

  select string_agg(format('%s:%s:%s:%s:%s', vat_group, rate_percent, label, is_active, fiscalnet_group),
                    '|' order by vat_group)
    into v_after from public.vat_rates
   where restaurant_id = '785b0000-0000-4000-8000-000000000002';
  if v_after is distinct from v_before then
    raise exception 'VP5 FAIL: un preset respins a modificat registrul: % → %', v_before, v_after;
  end if;
  raise notice 'VP5 OK: simple_19/food_9/tourism_5 → vat_preset_retired; necunoscut/NULL → invalid_preset; registru neatins';
end $$;

-- ── VP6: non-admin respins, registru neatins ─────────────────────────────────
do $$
declare
  v_sub    text;
  v_caught boolean;
  v_msg    text;
  v_g1     numeric;
begin
  -- R2 are încă grupa 1 la 9.00 (din VP5) — un apel reușit ar urca-o la 11.00.
  foreach v_sub in array array['78500000-0000-4000-8000-000000000009', ''] loop
    perform set_config('request.jwt.claim.sub', v_sub, true);
    v_caught := false; v_msg := null;
    begin
      perform public.apply_vat_preset('785b0000-0000-4000-8000-000000000002', 'ro_l141_2025');
    exception when others then
      v_caught := true; v_msg := sqlerrm;
    end;
    perform set_config('request.jwt.claim.sub', '', true);
    if not v_caught or v_msg not like 'Not admin%' then
      raise exception 'VP6 FAIL: apelant % → caught=% msg=% (aștept „Not admin…")',
        coalesce(nullif(v_sub, ''), '<fără JWT>'), v_caught, v_msg;
    end if;
  end loop;

  select rate_percent into v_g1 from public.vat_rates
   where restaurant_id = '785b0000-0000-4000-8000-000000000002' and vat_group = 1;
  if v_g1 is distinct from 9.00 then
    raise exception 'VP6 FAIL: un apel non-admin a schimbat cota grupei 1 (%)', v_g1;
  end if;
  raise notice 'VP6 OK: străin și apel fără JWT respinse, registru neatins';
end $$;

-- ── VP7: catalog (semnătură, DEFINER, privilegii, derivare) ──────────────────
do $$
declare v_n int; v_src text;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'apply_vat_preset';
  if v_n <> 1 then
    raise exception 'VP7 FAIL: % semnături apply_vat_preset (aștept 1 — altfel PGRST203)', v_n;
  end if;

  if not exists (
    select 1 from pg_proc p
     where p.oid = 'public.apply_vat_preset(uuid,text)'::regprocedure
       and p.prosecdef
       and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
                    where lower(regexp_replace(c, '[[:space:]]+', '', 'g')) like 'search\_path=%pg\_temp%')
  ) then
    raise exception 'VP7 FAIL: apply_vat_preset nu e DEFINER cu pg_temp în search_path';
  end if;

  -- Privilegii EFECTIVE (nu text de ACL — RP3).
  if not has_function_privilege('authenticated', 'public.apply_vat_preset(uuid,text)', 'EXECUTE') then
    raise exception 'VP7 FAIL (control pozitiv): authenticated nu poate executa apply_vat_preset — Setup Asistent e mort';
  end if;
  if has_function_privilege('anon', 'public.apply_vat_preset(uuid,text)', 'EXECUTE') then
    raise exception 'VP7 FAIL: anon poate executa apply_vat_preset';
  end if;
  if has_function_privilege('anon', 'public.vat_rate_defaults_ro()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.vat_rate_defaults_ro()', 'EXECUTE') then
    raise exception 'VP7 FAIL: vat_rate_defaults_ro e apelabilă de rolurile client';
  end if;
  if has_function_privilege('anon', 'public.create_default_vat_rates()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.create_default_vat_rates()', 'EXECUTE') then
    raise exception 'VP7 FAIL: create_default_vat_rates (trigger) e apelabilă de rolurile client (RP13)';
  end if;

  -- Derivare: o copie a literalilor în oricare funcție ar trece VP1 azi și ar
  -- diverge la prima schimbare de lege — exact clasa FR-07.
  select p.prosrc into v_src from pg_proc p where p.oid = 'public.apply_vat_preset(uuid,text)'::regprocedure;
  if position('vat_rate_defaults_ro' in v_src) = 0 then
    raise exception 'VP7 FAIL: apply_vat_preset nu mai derivă din vat_rate_defaults_ro';
  end if;
  select p.prosrc into v_src from pg_proc p where p.oid = 'public.create_default_vat_rates()'::regprocedure;
  if position('vat_rate_defaults_ro' in v_src) = 0 then
    raise exception 'VP7 FAIL: create_default_vat_rates nu mai derivă din vat_rate_defaults_ro';
  end if;
  raise notice 'VP7 OK: 1 semnătură, DEFINER+pg_temp, EXECUTE doar authenticated, sursă unică închisă și folosită de ambele';
end $$;

do $$ begin raise notice '════ vat preset == defaults (mig 285, VP1–VP7): ALL PASS ════'; end $$;

rollback;
