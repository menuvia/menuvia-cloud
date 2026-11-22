-- tests/sql/auto/331_signup_ui_language.sql
-- =============================================================================
-- NU1–NU5 — clichetul PERMANENT al mig 331: contul nou pornește în limba în
-- care s-a înregistrat. Autonom, ROLLBACK la final. Conturile se creează prin
-- INSERT în `auth.users` (exact calea signUp-ului: trigger-ul
-- `on_auth_user_created` → `handle_new_user`), nu prin INSERT direct în
-- profiles — altfel testul n-ar atinge deloc funcția verificată.
--
--   NU1  `ui_lang` valid în metadata ('fr', 'en', 'de', 'ro') → profilul
--        pornește cu acea limbă.
--        [PICĂ: handle_new_user din schema de bază (fără ui_language) → null]
--   NU2  Orice altă valoare ('xx', 'FR', ' en', '', număr JSON, cheie lipsă,
--        metadata ne-obiect) → null, iar signup-ul REUȘEȘTE (garda e în
--        expresie, nu în CHECK; o valoare care ajunge la CHECK ar face
--        INSERT-ul în auth.users să pice).
--        [PICĂ: copierea brută `new.raw_user_meta_data->>'ui_lang'` → 23514]
--   NU3  Corpul vechi e neschimbat: `full_name` din metadata, altfel partea
--        locală a emailului; emailul copiat.
--        [PICĂ: rezerva pe email pierdută la recrearea funcției]
--   NU4  Catalog: DEFINER, `search_path = public, pg_temp`, ne-executabilă de
--        anon/authenticated (RP13), trigger-ul activ pe auth.users.
--        [PICĂ: `create or replace` fără `set search_path` explicit]
--   NU5  Limba copiată la signup NU e o alegere blocată: contul o poate schimba
--        sub rolul REAL `authenticated` și poate reveni la null (UL1 din 323).
--        [PICĂ: o constrângere nouă care ar lega ui_language de metadata]
-- Backfill-ul (conturile null de dinaintea migrației → metadata, altfel 'ro')
-- se verifică o singură dată, la aplicare, prin asserția din migrație; nu
-- există un invariant permanent „zero null” (vezi antetul migrației).
-- =============================================================================

\set ON_ERROR_STOP on

begin;

do $$
declare
  v_cases jsonb := jsonb_build_array(
    -- NU1: valori valide
    jsonb_build_array('33100000-0000-4000-8000-000000000001', jsonb_build_object('ui_lang', 'fr'), 'fr'),
    jsonb_build_array('33100000-0000-4000-8000-000000000002', jsonb_build_object('ui_lang', 'en', 'full_name', 'Ann'), 'en'),
    jsonb_build_array('33100000-0000-4000-8000-000000000003', jsonb_build_object('ui_lang', 'de'), 'de'),
    jsonb_build_array('33100000-0000-4000-8000-000000000004', jsonb_build_object('ui_lang', 'ro'), 'ro'),
    -- NU2: tot restul → null
    jsonb_build_array('33100000-0000-4000-8000-000000000011', jsonb_build_object('ui_lang', 'xx'), null),
    jsonb_build_array('33100000-0000-4000-8000-000000000012', jsonb_build_object('ui_lang', 'FR'), null),
    jsonb_build_array('33100000-0000-4000-8000-000000000013', jsonb_build_object('ui_lang', ' en'), null),
    jsonb_build_array('33100000-0000-4000-8000-000000000014', jsonb_build_object('ui_lang', ''), null),
    jsonb_build_array('33100000-0000-4000-8000-000000000015', jsonb_build_object('ui_lang', 5), null),
    jsonb_build_array('33100000-0000-4000-8000-000000000016', jsonb_build_object('full_name', 'Fără limbă'), null),
    jsonb_build_array('33100000-0000-4000-8000-000000000017', '[]'::jsonb, null),
    jsonb_build_array('33100000-0000-4000-8000-000000000018', '"fr"'::jsonb, null)
  );
  c jsonb;
  v_id uuid;
  v_got text;
  v_n int := 0;
begin
  for c in select * from jsonb_array_elements(v_cases) loop
    v_id := (c->>0)::uuid;
    insert into auth.users (id, email, raw_user_meta_data)
    values (v_id, 'nl-' || right(v_id::text, 2) || '@nl331.test', c->1);
    select ui_language into strict v_got from public.profiles where id = v_id;
    if v_got is distinct from (c->>2) then
      raise exception 'NU1/NU2 FAIL: metadata % → ui_language % (trebuia %)', c->1, v_got, coalesce(c->>2, 'null');
    end if;
    v_n := v_n + 1;
  end loop;
  -- Anti-vacuitate: toate cele 12 conturi au trecut prin trigger.
  if v_n <> 12 then
    raise exception 'NU1/NU2 FAIL: doar % cazuri rulate', v_n;
  end if;
  raise notice 'NU1–NU2 OK: limba de la signup copiată doar pentru ro/en/fr/de, restul null, signup-ul nu pică';
end;
$$;

-- NU3: corpul vechi.
do $$
declare
  r record;
begin
  select email, full_name into strict r from public.profiles
   where id = '33100000-0000-4000-8000-000000000002';
  if r.full_name is distinct from 'Ann' or r.email is distinct from 'nl-02@nl331.test' then
    raise exception 'NU3 FAIL: full_name/email din metadata = %/% (trebuia Ann/nl-02@nl331.test)', r.full_name, r.email;
  end if;
  select email, full_name into strict r from public.profiles
   where id = '33100000-0000-4000-8000-000000000001';
  if r.full_name is distinct from 'nl-01' then
    raise exception 'NU3 FAIL: fără full_name în metadata, numele = % (trebuia partea locală a emailului, nl-01)', r.full_name;
  end if;
  raise notice 'NU3 OK: full_name și emailul se completează ca înainte';
end;
$$;

-- NU4: catalog.
do $$
declare
  v_cfg text[];
  v_def boolean;
begin
  select p.proconfig, p.prosecdef into strict v_cfg, v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'handle_new_user' and p.pronargs = 0;
  if not v_def then
    raise exception 'NU4 FAIL: handle_new_user nu e SECURITY DEFINER';
  end if;
  if v_cfg is null or not ('search_path=public, pg_temp' = any (v_cfg)) then
    raise exception 'NU4 FAIL: handle_new_user are proconfig % (trebuia search_path=public, pg_temp)', v_cfg;
  end if;
  if has_function_privilege('anon', 'public.handle_new_user()', 'execute')
     or has_function_privilege('authenticated', 'public.handle_new_user()', 'execute') then
    raise exception 'NU4 FAIL: handle_new_user e executabilă de un rol client';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgname = 'on_auth_user_created'
                    and tgrelid = 'auth.users'::regclass
                    and tgfoid = 'public.handle_new_user()'::regprocedure
                    and tgenabled = 'O') then
    raise exception 'NU4 FAIL: on_auth_user_created lipsește, e dezactivat sau cheamă altă funcție';
  end if;
  raise notice 'NU4 OK: DEFINER + public, pg_temp, fără EXECUTE pentru clienți, trigger activ';
end;
$$;

-- NU5: limba copiată rămâne o preferință a contului, schimbabilă sub RLS.
do $$
declare
  v_id constant uuid := '33100000-0000-4000-8000-000000000001';
  v_lang text;
  v_n int;
begin
  perform set_config('request.jwt.claim.sub', v_id::text, true);
  perform set_config('role', 'authenticated', true);
  update public.profiles set ui_language = 'de' where id = v_id;
  get diagnostics v_n = row_count;
  perform set_config('role', 'none', true);
  select ui_language into v_lang from public.profiles where id = v_id;
  if v_n <> 1 or v_lang is distinct from 'de' then
    raise exception 'NU5 FAIL: schimbarea limbii copiate a atins % rânduri, limba %', v_n, v_lang;
  end if;
  perform set_config('role', 'authenticated', true);
  update public.profiles set ui_language = null where id = v_id;
  perform set_config('role', 'none', true);
  select ui_language into v_lang from public.profiles where id = v_id;
  if v_lang is not null then
    raise exception 'NU5 FAIL: revenirea la null a lăsat %', v_lang;
  end if;
  raise notice 'NU5 OK: limba de la signup se poate schimba și anula din cont';
end;
$$;

rollback;
