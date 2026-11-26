-- tests/sql/auto/332_restore_signup_ui_language.sql
-- =============================================================================
-- SB1–SB6 — clichetul PERMANENT al mig 332: contul creat după activarea
-- limbilor își recapătă limba de la înscriere când default-ul 'ro' al mig 323 a
-- acoperit-o (323 + 331 aplicate DUPĂ înscriere). Autonom, ROLLBACK la final.
-- Conturile se creează prin INSERT în `auth.users` (calea signUp-ului: trigger
-- → `handle_new_user`), apoi profilul e pus pe 'ro' — exact starea lăsată de
-- `add column ... default 'ro'` peste un rând existent. Momentul de referință
-- e în viitorul îndepărtat (2099), ca rândurile fixturii / seed-ului să nu
-- intre în reparație și numărătoarea să fie exactă.
--
--   SB1  creat după moment, metadata 'fr' / 'en' / 'de', profil 'ro' → limba
--        din metadata; funcția întoarce EXACT 3.
--        [PICĂ: funcție fără UPDATE / fără gardă pe metadata]
--   SB2  creat ÎNAINTE de moment (metadata 'en', profil 'ro') → rămâne 'ro'
--        (decizia fondatorului: conturile de dinainte rămân în română).
--        [PICĂ: garda `created_at >= p_since` scoasă]
--   SB3  metadata 'ro' (româna aleasă explicit — comutatorul o scrie și în
--        metadata) sau lipsă / 'xx' / 'FR' → rămâne 'ro'.
--        [PICĂ: copierea brută a metadatei, fără listă]
--   SB4  profil deja pe altă limbă ('de', metadata 'fr' — o alegere ulterioară)
--        → neatins: se repară DOAR 'ro'-ul default-ului.
--        [PICĂ: garda `p.ui_language = 'ro'` scoasă]
--   SB5  a doua rulare întoarce 0 (auto-consumată); `p_since` null aruncă.
--   SB6  catalog: INVOKER, `search_path = public, pg_temp`, ne-executabilă de
--        anon / authenticated / service_role.
--        [PICĂ: promovare la DEFINER; un grant pentru un rol client]
-- =============================================================================

\set ON_ERROR_STOP on

begin;

do $$
declare
  v_since constant timestamptz := '2099-01-01 00:00:00+00';
  v_cases jsonb := jsonb_build_array(
    -- id, created_at, metadata, profil înainte, profil așteptat
    jsonb_build_array('33200000-0000-4000-8000-000000000001', '2099-01-02', jsonb_build_object('ui_lang', 'fr'), 'ro', 'fr'),
    jsonb_build_array('33200000-0000-4000-8000-000000000002', '2099-01-02', jsonb_build_object('ui_lang', 'en'), 'ro', 'en'),
    jsonb_build_array('33200000-0000-4000-8000-000000000003', '2099-01-02', jsonb_build_object('ui_lang', 'de'), 'ro', 'de'),
    -- SB2: înaintea momentului
    jsonb_build_array('33200000-0000-4000-8000-000000000011', '2098-12-31', jsonb_build_object('ui_lang', 'en'), 'ro', 'ro'),
    -- SB3: metadata română / lipsă / invalidă
    jsonb_build_array('33200000-0000-4000-8000-000000000021', '2099-01-02', jsonb_build_object('ui_lang', 'ro'), 'ro', 'ro'),
    jsonb_build_array('33200000-0000-4000-8000-000000000022', '2099-01-02', jsonb_build_object('full_name', 'Fără limbă'), 'ro', 'ro'),
    jsonb_build_array('33200000-0000-4000-8000-000000000023', '2099-01-02', jsonb_build_object('ui_lang', 'xx'), 'ro', 'ro'),
    jsonb_build_array('33200000-0000-4000-8000-000000000024', '2099-01-02', jsonb_build_object('ui_lang', 'FR'), 'ro', 'ro'),
    -- SB4: profil pe altă limbă decât româna
    jsonb_build_array('33200000-0000-4000-8000-000000000031', '2099-01-02', jsonb_build_object('ui_lang', 'fr'), 'de', 'de')
  );
  c jsonb;
  v_id uuid;
  v_n int;
  v_got text;
begin
  for c in select * from jsonb_array_elements(v_cases) loop
    v_id := (c->>0)::uuid;
    insert into auth.users (id, email, raw_user_meta_data, created_at)
    values (v_id, 'sb-' || right(v_id::text, 2) || '@sb332.test', c->2, (c->>1)::timestamptz);
    -- Starea lăsată de default-ul 323 peste un rând existent (sau altă limbă).
    update public.profiles set ui_language = c->>3 where id = v_id;
  end loop;

  v_n := public.restore_signup_ui_language(v_since);
  if v_n <> 3 then
    raise exception 'SB1 FAIL: reparația a atins % conturi (trebuia exact 3: fr, en, de)', v_n;
  end if;

  for c in select * from jsonb_array_elements(v_cases) loop
    v_id := (c->>0)::uuid;
    select ui_language into strict v_got from public.profiles where id = v_id;
    if v_got is distinct from (c->>4) then
      raise exception 'SB1–SB4 FAIL: cont % (creat %, metadata %, profil %) → % (trebuia %)',
        v_id, c->>1, c->2, c->>3, v_got, c->>4;
    end if;
  end loop;
  raise notice 'SB1–SB4 OK: limba de la înscriere recăpătată doar pentru conturile noi cu en/fr/de și profil ro';

  -- SB5: auto-consumată; momentul e obligatoriu.
  v_n := public.restore_signup_ui_language(v_since);
  if v_n <> 0 then
    raise exception 'SB5 FAIL: a doua rulare a atins % conturi (trebuia 0)', v_n;
  end if;
  begin
    perform public.restore_signup_ui_language(null);
    raise exception 'SB5 FAIL: p_since null a fost acceptat';
  exception when sqlstate '22004' then
    null;
  end;
  raise notice 'SB5 OK: a doua rulare nu atinge nimic; momentul e obligatoriu';
end;
$$;

-- SB6: catalog.
do $$
declare
  v_cfg text[];
  v_def boolean;
begin
  select p.proconfig, p.prosecdef into strict v_cfg, v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'restore_signup_ui_language';
  if v_def then
    raise exception 'SB6 FAIL: restore_signup_ui_language e SECURITY DEFINER';
  end if;
  if v_cfg is null or not ('search_path=public, pg_temp' = any (v_cfg)) then
    raise exception 'SB6 FAIL: proconfig % (trebuia search_path=public, pg_temp)', v_cfg;
  end if;
  if has_function_privilege('anon', 'public.restore_signup_ui_language(timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.restore_signup_ui_language(timestamptz)', 'execute')
     or has_function_privilege('service_role', 'public.restore_signup_ui_language(timestamptz)', 'execute') then
    raise exception 'SB6 FAIL: restore_signup_ui_language e executabilă de un rol client';
  end if;
  raise notice 'SB6 OK: INVOKER, public + pg_temp, fără EXECUTE pentru rolurile client';
end;
$$;

rollback;
