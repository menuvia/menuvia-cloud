-- tests/sql/public_branding_gate_assertions.sql
-- =============================================================================
-- PB1–PB8 — clichetul PERMANENT al mig 281 (gate de branding la CITIRE).
--
-- DE CE AICI ȘI NU DOAR ÎN MIGRAȚIE: blocul din corpul mig 281 se evaluează o
-- SINGURĂ dată, la poziția 281 din lanț (clasa DP6 / VS8 / F1–F9). Fișierul ăsta
-- rulează la FIECARE replay, pe starea FINALĂ a lanțului.
--
--   PB1  Gate-ul face muncă reală pe scenariul de DOWNGRADE: același rând
--        stocat cu hide_branding=true se citește `true` pe planul CU feature și
--        `false` după coborârea planului. Fără ambele jumătăți, testul ar trece
--        și cu gate-ul șters.
--   PB2  `resolve_qr_token` aplică ACEEAȘI regulă (a doua suprafață publică).
--   PB3  Restul lui `theme_settings` rămâne NEATINS — gate-ul schimbă o cheie,
--        nu rescrie tema.
--   PB4  Paritate cu clientul: doar `true` EXPLICIT ascunde. `"true"` (string),
--        `1`, `null` și cheia absentă nu sunt „ascuns", deci nu se normalizează
--        și nu aruncă (un `::boolean` ar fi rupt toată proiecția publică).
--   PB5  Ne-obiect / null → întors neatins prin ramura `else` (helperul nu rupe
--        meniul public pentru o temă stricată). NU există o gardă separată pe
--        tip: `->` cu cheie text dă NULL pe scalari/array-uri, deci ramura cu
--        `jsonb_set` e inaccesibilă — o gardă ar fi fost cod mort (verificat:
--        mutația care o ștergea nu pica nimic).
--   PB6  Invariantele MOȘTENITE de proiecție: fără wifi_password/qr_token (217),
--        cu menu_languages (219), slug case-insensitive (148), gate order_qr
--        în resolve_qr_token (127).
--   PB7  Suprafață: proiecțiile rămân anon; helperul NU e apelabil de niciun rol
--        client; toate trei au pg_temp (mig 262 l-a adăugat prin ALTER, iar un
--        `create or replace` fără el l-ar șterge tăcut).
--
-- Rulează DUPĂ migrații, într-o singură tranzacție, cu ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on
\timing off

begin;

-- ── Fixtură ──────────────────────────────────────────────────────────────────
-- Owner pe `growth` (are `remove_branding`), ca să putem SCRIE flag-ul: gate-ul
-- de scriere din mig 225 l-ar normaliza la false pe un plan mic, deci scenariul
-- „stocat true, plan coborât" NU se poate construi altfel. Exact asta face
-- downgrade-ul în realitate.
insert into auth.users (id, email) values
  ('bb110000-0000-4000-8000-000000000001'::uuid, 'pb-owner@pb.test');

update public.profiles set plan = 'growth'
 where id = 'bb110000-0000-4000-8000-000000000001'::uuid;

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('bb220000-0000-4000-8000-000000000001'::uuid,'bb110000-0000-4000-8000-000000000001'::uuid,
   'PB Bistro','pb-bistro-slug','Cluj', true);

-- Flagul se pune prin UPDATE — calea REALĂ (comutatorul din SettingsTab), și
-- singura care mergea înainte de fix-ul §F. PB1–PB7 rămân astfel independente
-- de acel fix; calea de INSERT are testul ei separat, PB8.
update public.restaurants
   set theme_settings = '{"hide_branding": true, "accent": "#ff0000", "elements": {"hero": false}}'::jsonb
 where id = 'bb220000-0000-4000-8000-000000000001'::uuid;

insert into public.restaurant_memberships (restaurant_id, user_id, role) values
  ('bb220000-0000-4000-8000-000000000001'::uuid,'bb110000-0000-4000-8000-000000000001'::uuid,'owner')
on conflict (restaurant_id, user_id) do nothing;

insert into public.tables (id, restaurant_id, name, slug, seats, is_active) values
  ('bb330000-0000-4000-8000-000000000001'::uuid,'bb220000-0000-4000-8000-000000000001'::uuid,
   'Masa PB','masa-pb', 4, true);

insert into public.qr_tokens (token, restaurant_id, table_id, is_active) values
  ('pb-token-001','bb220000-0000-4000-8000-000000000001'::uuid,'bb330000-0000-4000-8000-000000000001'::uuid, true);

-- Control: flag-ul CHIAR s-a stocat ca true (dacă gate-ul de scriere din 225
-- l-ar fi normalizat, tot testul de mai jos ar fi vacuu).
do $$
declare v_stored jsonb;
begin
  select theme_settings into v_stored from public.restaurants
   where id = 'bb220000-0000-4000-8000-000000000001'::uuid;
  if v_stored -> 'hide_branding' is distinct from 'true'::jsonb then
    raise exception 'FIXTURA: flag-ul nu s-a stocat ca true (stocat: %) — restul suitei ar fi vacuu', v_stored;
  end if;
end$$;

-- ── PB1: scenariul de DOWNGRADE pe /m/:slug ─────────────────────────────────
do $$
declare v_before jsonb; v_after jsonb;
begin
  -- CU feature (growth): flag-ul trece mai departe — beneficiul plătit e real.
  select theme_settings into v_before
    from public.get_restaurant_by_slug('pb-bistro-slug');
  if v_before -> 'hide_branding' is distinct from 'true'::jsonb then
    raise exception 'PB1 (control pozitiv): pe planul CU remove_branding badge-ul trebuie sa ramana ascuns (primit: %)', v_before;
  end if;

  -- DOWNGRADE: planul coboară, rândul stocat rămâne neatins (nimeni nu scrie
  -- theme_settings) — exact situația din producție.
  update public.profiles set plan = 'free'
   where id = 'bb110000-0000-4000-8000-000000000001'::uuid;

  select theme_settings into v_after
    from public.get_restaurant_by_slug('pb-bistro-slug');
  if v_after -> 'hide_branding' is distinct from 'false'::jsonb then
    raise exception 'PB1: dupa downgrade badge-ul ramane ascuns — beneficiul platit supravietuieste (primit: %)', v_after;
  end if;

  -- Rândul din tabelă NU s-a schimbat: gate-ul e la citire, nu o migrare de date.
  if (select theme_settings -> 'hide_branding' from public.restaurants
       where id = 'bb220000-0000-4000-8000-000000000001'::uuid) is distinct from 'true'::jsonb then
    raise exception 'PB1: gate-ul de CITIRE nu are voie sa rescrie randul stocat';
  end if;
  raise notice 'PB1 OK';
end$$;

-- ── PB2: aceeași regulă pe suprafața QR ─────────────────────────────────────
do $$
declare v_res jsonb;
begin
  -- planul e deja `free` de la PB1
  v_res := public.resolve_qr_token('pb-token-001');
  if v_res is null then
    raise exception 'PB2: resolve_qr_token a intors null — fixtura de token/masa e gresita'; end if;
  if v_res #> '{restaurant,theme_settings,hide_branding}' is distinct from 'false'::jsonb then
    raise exception 'PB2: resolve_qr_token nu aplica gate-ul de branding (primit: %)',
      v_res #> '{restaurant,theme_settings}'; end if;

  update public.profiles set plan = 'growth'
   where id = 'bb110000-0000-4000-8000-000000000001'::uuid;
  v_res := public.resolve_qr_token('pb-token-001');
  if v_res #> '{restaurant,theme_settings,hide_branding}' is distinct from 'true'::jsonb then
    raise exception 'PB2 (control pozitiv): pe growth flag-ul trebuie sa treaca (primit: %)',
      v_res #> '{restaurant,theme_settings}'; end if;
  raise notice 'PB2 OK';
end$$;

-- ── PB3: restul temei rămâne NEATINS ────────────────────────────────────────
do $$
declare v_theme jsonb;
begin
  update public.profiles set plan = 'free'
   where id = 'bb110000-0000-4000-8000-000000000001'::uuid;
  select theme_settings into v_theme from public.get_restaurant_by_slug('pb-bistro-slug');
  if v_theme -> 'accent' is distinct from '"#ff0000"'::jsonb
     or v_theme -> 'elements' is distinct from '{"hero": false}'::jsonb then
    raise exception 'PB3: gate-ul a atins si alte chei din tema (primit: %)', v_theme; end if;
  raise notice 'PB3 OK';
end$$;

-- ── PB4: paritate cu clientul — doar `true` EXPLICIT ascunde ────────────────
do $$
declare v_rid uuid := 'bb220000-0000-4000-8000-000000000001'::uuid;
begin
  -- Pe plan `free` (fără feature): niciuna dintre formele de mai jos nu e
  -- „ascuns", deci helperul nu are ce normaliza ȘI nu are voie să arunce.
  if public.public_theme_settings(v_rid, '{"hide_branding":"true"}'::jsonb)
     is distinct from '{"hide_branding":"true"}'::jsonb then
    raise exception 'PB4: string-ul "true" a fost tratat ca boolean'; end if;
  if public.public_theme_settings(v_rid, '{"hide_branding":1}'::jsonb)
     is distinct from '{"hide_branding":1}'::jsonb then
    raise exception 'PB4: un numar a fost tratat ca boolean'; end if;
  if public.public_theme_settings(v_rid, '{"hide_branding":null}'::jsonb)
     is distinct from '{"hide_branding":null}'::jsonb then
    raise exception 'PB4: JSON null a fost normalizat'; end if;
  if public.public_theme_settings(v_rid, '{"accent":"#000"}'::jsonb)
     is distinct from '{"accent":"#000"}'::jsonb then
    raise exception 'PB4: cheia absenta a fost ADAUGATA'; end if;
  -- iar cazul viu chiar se normalizează
  if public.public_theme_settings(v_rid, '{"hide_branding":true}'::jsonb)
     is distinct from '{"hide_branding":false}'::jsonb then
    raise exception 'PB4: cazul viu nu se normalizeaza'; end if;
  raise notice 'PB4 OK';
end$$;

-- ── PB5: null / ne-obiect → neatins prin ramura `else` ─────────────────────
do $$
declare v_rid uuid := 'bb220000-0000-4000-8000-000000000001'::uuid;
begin
  if public.public_theme_settings(v_rid, null) is not null then
    raise exception 'PB5: null trebuie sa ramana null'; end if;
  if public.public_theme_settings(v_rid, '5'::jsonb) is distinct from '5'::jsonb then
    raise exception 'PB5: un scalar jsonb a fost modificat'; end if;
  if public.public_theme_settings(v_rid, '["hide_branding"]'::jsonb)
     is distinct from '["hide_branding"]'::jsonb then
    raise exception 'PB5: un array jsonb a fost modificat'; end if;
  raise notice 'PB5 OK';
end$$;

-- ── PB6: invariantele MOȘTENITE de cele două proiecții ─────────────────────
do $$
declare v_slug text; v_qr text;
begin
  v_slug := pg_get_functiondef('public.get_restaurant_by_slug(text)'::regprocedure);
  v_qr   := pg_get_functiondef('public.resolve_qr_token(text)'::regprocedure);

  if position('public_theme_settings' in v_slug) = 0
     or position('public_theme_settings' in v_qr) = 0 then
    raise exception 'PB6: o proiectie publica nu mai trece theme_settings prin gate'; end if;
  if position('r.wifi_password' in v_slug) > 0 or position('r.qr_token' in v_slug) > 0 then
    raise exception 'PB6: leak-ul wifi/qr_token a reaparut (mig 217)'; end if;
  if position('r.menu_languages' in v_slug) = 0 then
    raise exception 'PB6: menu_languages a disparut din proiectie (mig 219)'; end if;
  if position('lower(r.slug)' in v_slug) = 0 then
    raise exception 'PB6: slug-ul case-insensitive s-a pierdut (mig 148)'; end if;
  if position('order_qr' in v_qr) = 0 then
    raise exception 'PB6: gate-ul de plan order_qr s-a pierdut din resolve_qr_token (mig 127)'; end if;
  -- gate-ul de SCRIERE din 225 ramane (defense-in-depth)
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'restaurants' and t.tgname = 'trg_normalize_hide_branding'
                    and not t.tgisinternal) then
    raise exception 'PB6: trg_normalize_hide_branding (mig 225) a disparut'; end if;
  raise notice 'PB6 OK';
end$$;

-- ── PB7: suprafață + pg_temp ───────────────────────────────────────────────
do $$
declare v_bad text;
begin
  if not has_function_privilege('anon', 'public.get_restaurant_by_slug(text)', 'execute')
     or not has_function_privilege('anon', 'public.resolve_qr_token(text)', 'execute') then
    raise exception 'PB7: proiectiile publice trebuie sa ramana apelabile de anon'; end if;

  select string_agg(r.rol, ', ') into v_bad
    from (values ('anon'), ('authenticated'), ('service_role')) as r(rol)
   where has_function_privilege(r.rol, 'public.public_theme_settings(uuid,jsonb)', 'execute');
  if v_bad is not null then
    raise exception 'PB7: helperul de branding e apelabil de: %', v_bad; end if;

  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.oid in ('public.get_restaurant_by_slug(text)'::regprocedure,
                   'public.resolve_qr_token(text)'::regprocedure,
                   'public.public_theme_settings(uuid,jsonb)'::regprocedure)
     and coalesce(array_to_string(p.proconfig, ','), '') not like '%pg_temp%';
  if v_bad is not null then
    raise exception 'PB7: functii DEFINER fara pg_temp in search_path: %', v_bad; end if;
  raise notice 'PB7 OK';
end$$;

-- ── PB8: gate-ul de SCRIERE funcționează și la INSERT (mig 281 §F) ─────────
-- Pe mig 225 `fn_normalize_hide_branding` întreba `restaurant_has_feature(NEW.id)`,
-- iar la BEFORE INSERT rândul nu e încă în tabelă → feature-ul ieșea mereu false
-- → flag-ul se ștergea pe ORICE plan. Reprodus pe replay înainte de fix.
-- Owneri PROPRII: `enforce_restaurant_limit` (mig 131) plafonează numărul de
-- restaurante per cont, deci al doilea INSERT pe owner-ul de mai sus ar pica pe
-- limită, nu pe branding — testul ar raporta altceva decât testează.
insert into auth.users (id, email) values
  ('bb110000-0000-4000-8000-000000000002'::uuid, 'pb-growth@pb.test'),
  ('bb110000-0000-4000-8000-000000000003'::uuid, 'pb-free@pb.test');
update public.profiles set plan = 'growth' where id = 'bb110000-0000-4000-8000-000000000002'::uuid;
update public.profiles set plan = 'free'   where id = 'bb110000-0000-4000-8000-000000000003'::uuid;

do $$
declare v_stored jsonb;
begin
  -- CU feature: un restaurant creat DIRECT cu tema păstrează flag-ul.
  insert into public.restaurants (id, owner_id, name, slug, city, is_active, theme_settings)
  values ('bb220000-0000-4000-8000-000000000002'::uuid,
          'bb110000-0000-4000-8000-000000000002'::uuid,
          'PB Insert','pb-insert-slug','Cluj', true,
          '{"hide_branding": true}'::jsonb);
  select theme_settings into v_stored from public.restaurants
   where id = 'bb220000-0000-4000-8000-000000000002'::uuid;
  if v_stored -> 'hide_branding' is distinct from 'true'::jsonb then
    raise exception 'PB8: INSERT pe un plan CU remove_branding a pierdut flagul (stocat: %)', v_stored; end if;

  -- FĂRĂ feature: același INSERT se normalizează (gate-ul chiar lucrează).
  insert into public.restaurants (id, owner_id, name, slug, city, is_active, theme_settings)
  values ('bb220000-0000-4000-8000-000000000003'::uuid,
          'bb110000-0000-4000-8000-000000000003'::uuid,
          'PB Insert Free','pb-insert-free-slug','Cluj', true,
          '{"hide_branding": true}'::jsonb);
  select theme_settings into v_stored from public.restaurants
   where id = 'bb220000-0000-4000-8000-000000000003'::uuid;
  if v_stored -> 'hide_branding' is distinct from 'false'::jsonb then
    raise exception 'PB8: INSERT pe un plan FARA remove_branding a pastrat flagul (stocat: %)', v_stored; end if;
  raise notice 'PB8 OK';
end$$;

rollback;

\echo '✅ GATE DE BRANDING LA CITIRE OK (PB1-PB8)'
