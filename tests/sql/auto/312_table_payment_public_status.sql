-- tests/sql/auto/312_table_payment_public_status.sql
-- =============================================================================
-- TS1–TS5 — clichetul PERMANENT al mig 312: statusul PUBLIC al plății online
-- la masă (`get_table_payment_public_status`), sursa unică pe care clientul
-- QR o folosește ca să declare „Plătit”. Rulează din tests/sql/auto/ pe AMBELE
-- medii (Postgres gol din sql-verify + stack-ul Supabase din E2E). Autonom,
-- ROLLBACK la final.
--
-- Apelurile oaspetelui se fac SUB rolul REAL `anon` (helperul ts_as): ca
-- `postgres`, EXECUTE e ocolit, deci „anon poate apela” ar fi vacuu (clasa
-- PF/TP24). Seed-ul, begin/attach/settle și verificările rămân ca postgres
-- (fluxul de bani e service_role-only; aici îl exersăm doar ca să producem
-- stările pe care le citește oaspetele).
--
--   TS1  `succeeded` DOAR după settle: aceeași plată e `processing` înainte și
--        `succeeded` după `settle_table_payment`, pe AMBELE referințe (uuid-ul
--        plății și `pi_…`); statusul rămâne citibil după ce settle-ul a ÎNCHIS
--        sesiunea (trg_maybe_close_session, 084) — exact momentul în care
--        oaspetele întreabă. Plus maparea celorlalte stări terminale:
--        settle `failed` → `failed`, cancel fără intent → `canceled`.
--        [PICĂ: un filtru `s.status = 'open'` pe sesiune (după settle întoarce
--         `unknown`); maparea `succeeded` → altceva]
--   TS2  ÎNAINTE de settle nu există „succeeded”: rând fără intent → `pending`,
--        intent atașat (= browserul poate avea deja „succeeded” de la Stripe)
--        → `processing`; răspunsul are EXACT cheia `status` (nicio sumă, niciun
--        id Stripe).
--        [PICĂ: statusul derivat din intent (`stripe_payment_intent_id is not
--         null` → `succeeded`, adică „Stripe a zis da”); o cheie în plus în
--         răspuns (ex. `amount`)]
--   TS3  ANTI-ORACLE: token al ALTEI mese din același restaurant, token al
--        altui restaurant, sesiune străină cu token corect, token inexistent,
--        token inactiv, referință inexistentă / gunoi / prea lungă, argumente
--        NULL → TOATE dau exact `{"status":"unknown"}`, fără excepție.
--        Control POZITIV în același bloc: perechea corectă NU dă `unknown`
--        (altfel totul ar trece pe o funcție care întoarce mereu `unknown`).
--        [PICĂ: fără `s.table_id = v_tok.table_id` (masa vecină vede plata);
--         un `raise` pe token invalid (eroare ≠ unknown = oracol); `::uuid`
--         necondiționat (aruncă pe `pi_…`/gunoi)]
--   TS4  Suprafața: DEFINER + `search_path = public, pg_temp`, VOLATILE, O
--        SINGURĂ semnătură; anon ȘI authenticated pot apela (apel REAL sub
--        ambele roluri), service_role și PUBLIC NU (apel REAL ca service_role →
--        42501 pe FUNCȚIE, nu pe schemă).
--        [PICĂ: `grant execute … to service_role` / `to public`; `security
--         invoker` (sub anon RLS-ul pe table_payments dă mereu `unknown` —
--         controlul pozitiv din TS2 pică); revoke-ul pe anon]
--   TS5  RATE-LIMIT per masă: 120 de interogări în aceeași fereastră trec, a
--        121-a dă `unknown` deși perechea e validă; o altă masă are bugetul ei
--        (cheia e token-ul rezolvat, nu global); token-urile INVALIDE nu scriu
--        niciun rând în `function_rate_limits` (respinse înainte de plafon).
--        [PICĂ: `check_rate_limit` scos (a 121-a dă `pending`); plafonul
--         chemat înainte de validarea token-ului cu cheia `p_token` (token-urile
--         aleatorii scriu rânduri); cheie globală (masa a doua e blocată)]
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Fixtură ──────────────────────────────────────────────────────────────────
-- A (enterprise): restaurantul R1 cu mesele M1 (sesiunea S1, comanda 30), M2
-- (sesiunea S2, comanda 20), M4 (sesiunea S4, comanda 10 — doar TS5) și M5
-- (token INACTIV). B (enterprise): restaurantul R2, masa M3, sesiunea S3.
insert into auth.users (id, email) values
  ('31200000-0000-4000-8000-000000000001', 'ts-owner-a@pg312.test'),
  ('31200000-0000-4000-8000-000000000002', 'ts-owner-b@pg312.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email)
  select id, email from auth.users where email like 'ts-owner-%@pg312.test'
  on conflict (id) do nothing;
update public.profiles set plan = 'enterprise'
 where id in ('31200000-0000-4000-8000-000000000001', '31200000-0000-4000-8000-000000000002');

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('312b0000-0000-4000-8000-000000000001', '31200000-0000-4000-8000-000000000001',
   'TS Bistro', 'ts312-bistro', 'Cluj', true),
  ('312b0000-0000-4000-8000-000000000002', '31200000-0000-4000-8000-000000000002',
   'TS Altul', 'ts312-altul', 'Cluj', true);
update public.restaurants set stripe_account_id = 'acct_test_ts312'
 where id in ('312b0000-0000-4000-8000-000000000001', '312b0000-0000-4000-8000-000000000002');
insert into public.restaurant_modules (restaurant_id, module_key, enabled) values
  ('312b0000-0000-4000-8000-000000000001', 'online_payments', true),
  ('312b0000-0000-4000-8000-000000000002', 'online_payments', true)
  on conflict (restaurant_id, module_key) do update set enabled = true;

insert into public.tables (id, restaurant_id, name, slug, seats, is_active) values
  ('312c0000-0000-4000-8000-000000000001', '312b0000-0000-4000-8000-000000000001', 'TS M1', 'ts312-m1', 4, true),
  ('312c0000-0000-4000-8000-000000000002', '312b0000-0000-4000-8000-000000000001', 'TS M2', 'ts312-m2', 4, true),
  ('312c0000-0000-4000-8000-000000000003', '312b0000-0000-4000-8000-000000000002', 'TS M3', 'ts312-m3', 4, true),
  ('312c0000-0000-4000-8000-000000000004', '312b0000-0000-4000-8000-000000000001', 'TS M4', 'ts312-m4', 4, true),
  ('312c0000-0000-4000-8000-000000000005', '312b0000-0000-4000-8000-000000000001', 'TS M5', 'ts312-m5', 4, true);

insert into public.qr_tokens (id, restaurant_id, table_id, token, is_active) values
  ('312e0000-0000-4000-8000-000000000001', '312b0000-0000-4000-8000-000000000001',
   '312c0000-0000-4000-8000-000000000001', 'tok_ts312_m1', true),
  ('312e0000-0000-4000-8000-000000000002', '312b0000-0000-4000-8000-000000000001',
   '312c0000-0000-4000-8000-000000000002', 'tok_ts312_m2', true),
  ('312e0000-0000-4000-8000-000000000003', '312b0000-0000-4000-8000-000000000002',
   '312c0000-0000-4000-8000-000000000003', 'tok_ts312_m3', true),
  ('312e0000-0000-4000-8000-000000000004', '312b0000-0000-4000-8000-000000000001',
   '312c0000-0000-4000-8000-000000000004', 'tok_ts312_m4', true),
  ('312e0000-0000-4000-8000-000000000005', '312b0000-0000-4000-8000-000000000001',
   '312c0000-0000-4000-8000-000000000001', 'tok_ts312_m1_old', false);

insert into public.table_sessions (id, restaurant_id, table_id, status) values
  ('312f0000-0000-4000-8000-000000000001', '312b0000-0000-4000-8000-000000000001',
   '312c0000-0000-4000-8000-000000000001', 'open'),
  ('312f0000-0000-4000-8000-000000000002', '312b0000-0000-4000-8000-000000000001',
   '312c0000-0000-4000-8000-000000000002', 'open'),
  ('312f0000-0000-4000-8000-000000000003', '312b0000-0000-4000-8000-000000000002',
   '312c0000-0000-4000-8000-000000000003', 'open'),
  ('312f0000-0000-4000-8000-000000000004', '312b0000-0000-4000-8000-000000000001',
   '312c0000-0000-4000-8000-000000000004', 'open');

insert into public.orders (id, restaurant_id, source, status, total, session_id, table_id, qr_token_id) values
  ('312a0000-0000-4000-8000-000000000001', '312b0000-0000-4000-8000-000000000001', 'qr', 'served', 30,
   '312f0000-0000-4000-8000-000000000001', '312c0000-0000-4000-8000-000000000001', '312e0000-0000-4000-8000-000000000001'),
  ('312a0000-0000-4000-8000-000000000002', '312b0000-0000-4000-8000-000000000001', 'qr', 'served', 20,
   '312f0000-0000-4000-8000-000000000002', '312c0000-0000-4000-8000-000000000002', '312e0000-0000-4000-8000-000000000002'),
  ('312a0000-0000-4000-8000-000000000003', '312b0000-0000-4000-8000-000000000002', 'qr', 'served', 15,
   '312f0000-0000-4000-8000-000000000003', '312c0000-0000-4000-8000-000000000003', '312e0000-0000-4000-8000-000000000003'),
  ('312a0000-0000-4000-8000-000000000004', '312b0000-0000-4000-8000-000000000001', 'qr', 'served', 10,
   '312f0000-0000-4000-8000-000000000004', '312c0000-0000-4000-8000-000000000004', '312e0000-0000-4000-8000-000000000004');

-- Apelul oaspetelui SUB rolul dat. Întoarce rezultatul sau
-- {raised:true, sqlstate, error} — o excepție nu are voie să se strecoare ca
-- „unknown”, și nici invers. `set_config('role', …)` stă ÎN AFARA sub-blocului
-- cu excepție (în interior s-ar derula înapoi cu subtranzacția — lot B).
create function pg_temp.ts_as(p_role text, p_token text, p_session uuid, p_ref text) returns jsonb
language plpgsql as $f$
declare v jsonb; v_state text;
begin
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('role', p_role, true);
  begin
    -- EXECUTE dinamic, nu `v := public.…(…)`: PL/pgSQL cachează expresiile
    -- simple per tranzacție, iar verificarea EXECUTE se face o singură dată, la
    -- inițializare — un apel ca anon urmat de unul ca service_role ar trece pe
    -- ACL-ul primului rol (prins la prima rulare a TS4).
    execute 'select public.get_table_payment_public_status($1, $2, $3)'
      into v using p_token, p_session, p_ref;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v := jsonb_build_object('raised', true, 'sqlstate', v_state, 'error', sqlerrm);
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.role', '', true);
  return v;
end $f$;

create function pg_temp.ts_anon(p_token text, p_session uuid, p_ref text) returns jsonb
language sql as $f$ select pg_temp.ts_as('anon', p_token, p_session, p_ref) $f$;

-- Plățile fixturii, create pe calea REALĂ (begin → attach → settle). Id-urile
-- se țin într-o tabelă temporară ca blocurile să le poată citi.
create temp table ts_pay (k text primary key, id uuid not null);

do $$
declare v jsonb;
begin
  v := public.begin_table_payment('312f0000-0000-4000-8000-000000000001', 'tok_ts312_m1');
  insert into ts_pay values ('p1', (v->>'payment_id')::uuid);
  v := public.begin_table_payment('312f0000-0000-4000-8000-000000000002', 'tok_ts312_m2');
  insert into ts_pay values ('p2', (v->>'payment_id')::uuid);
  v := public.begin_table_payment('312f0000-0000-4000-8000-000000000004', 'tok_ts312_m4');
  insert into ts_pay values ('p4', (v->>'payment_id')::uuid);
  if (select count(*) from ts_pay) <> 3
     or (select count(*) from public.table_payments
          where id in (select id from ts_pay) and status = 'created') <> 3 then
    raise exception 'FIXTURA: begin_table_payment n-a creat cele 3 plăți `created` — suita ar fi vacuă';
  end if;
end $$;

-- ── TS2: înainte de settle nu există „succeeded” ─────────────────────────────
do $$
declare v_p1 text := (select id::text from ts_pay where k = 'p1'); v jsonb;
begin
  v := pg_temp.ts_anon('tok_ts312_m1', '312f0000-0000-4000-8000-000000000001', v_p1);
  if v is distinct from '{"status":"pending"}'::jsonb then
    raise exception 'TS2 FAIL: plata fără intent trebuia `pending`, a dat %', v;
  end if;

  perform public.attach_payment_intent(v_p1::uuid, 'pi_ts312_p1');
  -- Din acest moment browserul poate primi „succeeded” de la Stripe — DB-ul
  -- n-a decontat nimic, deci oaspetele NU are voie să vadă „succeeded”.
  v := pg_temp.ts_anon('tok_ts312_m1', '312f0000-0000-4000-8000-000000000001', v_p1);
  if v is distinct from '{"status":"processing"}'::jsonb then
    raise exception 'TS2 FAIL: intent atașat, nedecontat — trebuia `processing`, a dat %', v;
  end if;
  v := pg_temp.ts_anon('tok_ts312_m1', '312f0000-0000-4000-8000-000000000001', 'pi_ts312_p1');
  if v is distinct from '{"status":"processing"}'::jsonb then
    raise exception 'TS2 FAIL: referința `pi_…` trebuia `processing`, a dat %', v;
  end if;
  if (select array_agg(k order by k collate "C") from jsonb_object_keys(v) k) is distinct from array['status'] then
    raise exception 'TS2 FAIL: răspunsul are alte chei decât `status`: %', v;
  end if;
  if (select status from public.orders where id = '312a0000-0000-4000-8000-000000000001') = 'paid' then
    raise exception 'FIXTURA TS2: comanda e deja paid înainte de settle';
  end if;
  raise notice 'TS2 OK: pending → processing înainte de settle; răspunsul are doar `status`';
end $$;

-- ── TS1: succeeded DOAR după settle (+ celelalte stări terminale) ────────────
do $$
declare
  v_p1 text := (select id::text from ts_pay where k = 'p1');
  v_p2 text := (select id::text from ts_pay where k = 'p2');
  v jsonb;
begin
  perform public.settle_table_payment('pi_ts312_p1', 'succeeded');
  if (select status from public.orders where id = '312a0000-0000-4000-8000-000000000001') <> 'paid' then
    raise exception 'FIXTURA TS1: settle n-a trecut comanda în paid';
  end if;
  -- Singura comandă a sesiunii e plătită → 084 închide sesiunea. Statusul
  -- trebuie să rămână citibil exact acum.
  if (select status from public.table_sessions where id = '312f0000-0000-4000-8000-000000000001') = 'open' then
    raise exception 'FIXTURA TS1: sesiunea a rămas deschisă — ramura „sesiune închisă” n-ar fi exersată';
  end if;
  v := pg_temp.ts_anon('tok_ts312_m1', '312f0000-0000-4000-8000-000000000001', v_p1);
  if v is distinct from '{"status":"succeeded"}'::jsonb then
    raise exception 'TS1 FAIL: după settle (sesiune închisă) trebuia `succeeded`, a dat %', v;
  end if;
  v := pg_temp.ts_anon('tok_ts312_m1', '312f0000-0000-4000-8000-000000000001', 'pi_ts312_p1');
  if v is distinct from '{"status":"succeeded"}'::jsonb then
    raise exception 'TS1 FAIL: referința `pi_…` după settle trebuia `succeeded`, a dat %', v;
  end if;

  -- failed: ultima încercare de card a eșuat (rândul rămâne retryable, 207).
  perform public.attach_payment_intent(v_p2::uuid, 'pi_ts312_p2');
  perform public.settle_table_payment('pi_ts312_p2', 'failed', 'card refuzat');
  v := pg_temp.ts_anon('tok_ts312_m2', '312f0000-0000-4000-8000-000000000002', v_p2);
  if v is distinct from '{"status":"failed"}'::jsonb then
    raise exception 'TS1 FAIL: settle failed trebuia `failed`, a dat %', v;
  end if;

  -- canceled: o plată nouă fără intent, anulată de client (208).
  v := public.begin_table_payment('312f0000-0000-4000-8000-000000000002', 'tok_ts312_m2');
  insert into ts_pay values ('p2c', (v->>'payment_id')::uuid);
  perform public.cancel_table_payment((v->>'payment_id')::uuid,
    '312f0000-0000-4000-8000-000000000002', 'tok_ts312_m2');
  v := pg_temp.ts_anon('tok_ts312_m2', '312f0000-0000-4000-8000-000000000002',
    (select id::text from ts_pay where k = 'p2c'));
  if v is distinct from '{"status":"canceled"}'::jsonb then
    raise exception 'TS1 FAIL: plata anulată trebuia `canceled`, a dat %', v;
  end if;
  raise notice 'TS1 OK: succeeded doar după settle (și cu sesiunea închisă); failed/canceled mapate';
end $$;

-- ── TS3: anti-oracle — orice pereche invalidă dă exact {"status":"unknown"} ─
do $$
declare
  v_p1 text := (select id::text from ts_pay where k = 'p1');
  v_unknown constant jsonb := '{"status":"unknown"}'::jsonb;
  r record;
  v jsonb;
begin
  -- Control POZITIV: perechea corectă nu e `unknown`.
  if pg_temp.ts_anon('tok_ts312_m1', '312f0000-0000-4000-8000-000000000001', v_p1) = v_unknown then
    raise exception 'TS3 FAIL (control pozitiv): perechea corectă dă `unknown` — restul ar fi vacuu';
  end if;

  for r in
    select * from (values
      ('masa vecină, același restaurant', 'tok_ts312_m2', '312f0000-0000-4000-8000-000000000001'::uuid, v_p1),
      ('alt restaurant',                  'tok_ts312_m3', '312f0000-0000-4000-8000-000000000001'::uuid, v_p1),
      ('sesiune străină, token corect',   'tok_ts312_m1', '312f0000-0000-4000-8000-000000000002'::uuid, v_p1),
      ('sesiunea altui restaurant',       'tok_ts312_m3', '312f0000-0000-4000-8000-000000000003'::uuid, v_p1),
      ('token inexistent',                'tok_ts312_nu_exista', '312f0000-0000-4000-8000-000000000001'::uuid, v_p1),
      ('token inactiv al aceleiași mese', 'tok_ts312_m1_old', '312f0000-0000-4000-8000-000000000001'::uuid, v_p1),
      ('plată inexistentă (uuid)',        'tok_ts312_m1', '312f0000-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-000000000000'),
      ('intent al altei plăți',           'tok_ts312_m1', '312f0000-0000-4000-8000-000000000001'::uuid, 'pi_ts312_p2'),
      ('intent inexistent',               'tok_ts312_m1', '312f0000-0000-4000-8000-000000000001'::uuid, 'pi_ts312_nu_exista'),
      ('referință gunoi',                 'tok_ts312_m1', '312f0000-0000-4000-8000-000000000001'::uuid, 'x''; drop table x;--'),
      ('referință prea lungă',            'tok_ts312_m1', '312f0000-0000-4000-8000-000000000001'::uuid, repeat('a', 300)),
      ('token NULL',                      null,           '312f0000-0000-4000-8000-000000000001'::uuid, v_p1),
      ('sesiune NULL',                    'tok_ts312_m1', null::uuid, v_p1),
      ('referință NULL',                  'tok_ts312_m1', '312f0000-0000-4000-8000-000000000001'::uuid, null)
    ) t(label, tok, sess, ref)
  loop
    v := pg_temp.ts_anon(r.tok, r.sess, r.ref);
    if v is distinct from v_unknown then
      raise exception 'TS3 FAIL (%): trebuia exact {"status":"unknown"}, a dat %', r.label, v;
    end if;
  end loop;
  raise notice 'TS3 OK: 14 perechi invalide → același `unknown`, fără excepții; perechea corectă nu';
end $$;

-- ── TS4: suprafața (catalog + apel REAL pe fiecare rol) ──────────────────────
do $$
declare
  v_fn regprocedure := to_regprocedure('public.get_table_payment_public_status(text,uuid,text)');
  v_p1 text := (select id::text from ts_pay where k = 'p1');
  v jsonb;
begin
  if v_fn is null then
    raise exception 'TS4 FAIL: public.get_table_payment_public_status(text,uuid,text) lipsește';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'get_table_payment_public_status') <> 1 then
    raise exception 'TS4 FAIL: mai multe semnături (PGRST203 la orice apel)';
  end if;
  if not (select prosecdef from pg_proc where oid = v_fn) then
    raise exception 'TS4 FAIL: funcția nu e SECURITY DEFINER (sub anon RLS-ul pe table_payments o face oarbă)';
  end if;
  if (select provolatile from pg_proc where oid = v_fn) <> 'v' then
    raise exception 'TS4 FAIL: funcția trebuie să fie VOLATILE (rate-limit-ul scrie)';
  end if;
  if not exists (select 1 from pg_proc where oid = v_fn
                  and array_to_string(proconfig, ',') like '%search_path=public, pg_temp%') then
    raise exception 'TS4 FAIL: search_path = public, pg_temp lipsește';
  end if;
  if not has_function_privilege('anon', v_fn, 'execute')
     or not has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception 'TS4 FAIL: oaspetele (anon/authenticated) nu poate apela';
  end if;
  if has_function_privilege('service_role', v_fn, 'execute') then
    raise exception 'TS4 FAIL: service_role are EXECUTE (suprafața oaspetelui, nu a funcțiilor Netlify)';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
    raise exception 'TS4 FAIL: PUBLIC are EXECUTE';
  end if;

  -- Apel REAL: authenticated (oaspete logat) primește același răspuns ca anon.
  v := pg_temp.ts_as('authenticated', 'tok_ts312_m1', '312f0000-0000-4000-8000-000000000001', v_p1);
  if v is distinct from '{"status":"succeeded"}'::jsonb then
    raise exception 'TS4 FAIL: apelul ca authenticated a dat %', v;
  end if;
  -- Apel REAL: service_role e refuzat pe ACL-ul FUNCȚIEI.
  v := pg_temp.ts_as('service_role', 'tok_ts312_m1', '312f0000-0000-4000-8000-000000000001', v_p1);
  if not coalesce((v->>'raised')::boolean, false) or v->>'sqlstate' <> '42501'
     or v->>'error' not like '%for function%' then
    raise exception 'TS4 FAIL: service_role trebuia refuzat pe funcție (42501), a dat %', v;
  end if;
  raise notice 'TS4 OK: DEFINER/pg_temp/VOLATILE/o semnătură; anon+authenticated da, service_role+PUBLIC nu';
end $$;

-- ── TS5: rate-limit per masă ─────────────────────────────────────────────────
do $$
declare
  v_p4 text := (select id::text from ts_pay where k = 'p4');
  v_p1 text := (select id::text from ts_pay where k = 'p1');
  v_before bigint;
  v jsonb;
  i int;
begin
  -- Token-urile invalide se resping ÎNAINTE de plafon: zero rânduri noi.
  select count(*) into v_before from public.function_rate_limits
   where function_name = 'table_payment_public_status';
  for i in 1..5 loop
    perform pg_temp.ts_anon('tok_ts312_aleator_' || i, '312f0000-0000-4000-8000-000000000004', v_p4);
  end loop;
  if (select count(*) from public.function_rate_limits
       where function_name = 'table_payment_public_status') <> v_before then
    raise exception 'TS5 FAIL: token-urile invalide au scris rânduri în function_rate_limits';
  end if;

  -- 120 de interogări valide trec (`now()` e înghețat în tranzacție → aceeași fereastră).
  for i in 1..120 loop
    v := pg_temp.ts_anon('tok_ts312_m4', '312f0000-0000-4000-8000-000000000004', v_p4);
    if v is distinct from '{"status":"pending"}'::jsonb then
      raise exception 'TS5 FAIL: interogarea % (sub plafon) a dat %', i, v;
    end if;
  end loop;
  v := pg_temp.ts_anon('tok_ts312_m4', '312f0000-0000-4000-8000-000000000004', v_p4);
  if v is distinct from '{"status":"unknown"}'::jsonb then
    raise exception 'TS5 FAIL: a 121-a interogare în fereastră trebuia `unknown` (plafon), a dat %', v;
  end if;
  -- Altă masă: bugetul ei (cheia e masa, nu globală).
  v := pg_temp.ts_anon('tok_ts312_m1', '312f0000-0000-4000-8000-000000000001', v_p1);
  if v is distinct from '{"status":"succeeded"}'::jsonb then
    raise exception 'TS5 FAIL: plafonul mesei M4 a blocat masa M1: %', v;
  end if;
  raise notice 'TS5 OK: 120/5 min per masă, a 121-a → unknown; token-urile invalide nu scriu rânduri';
end $$;

rollback;
