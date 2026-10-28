-- tests/sql/auto/301_agent_code_signup_attribution.sql
-- =============================================================================
-- Mig 301 (pachetul 7 / PR-5a): codul de agent la ÎNSCRIERE, nu la checkout.
-- Rulează din tests/sql/auto/ (scripts/run-sql-auto.sh) pe AMBELE medii
-- (Postgres gol din sql-verify + stack-ul Supabase din E2E). Autonom, ROLLBACK.
--
--   AC1  înscriere cu `user_metadata.agent_code` (cod / vanity, litere mari,
--        spații) → atribuire `pending` pe afiliatul corect, sursa
--        `signup_agent_code`, instantaneul bps completat (293), FĂRĂ client Stripe
--   AC2  un cod GREȘIT nu blochează înscrierea: necunoscut, afiliat pending /
--        suspendat, formă proastă, tip JSON greșit (număr/obiect/array/null),
--        metadata ne-obiect, 200 de caractere — contul și profilul EXISTĂ,
--        zero atribuiri (control pozitiv: AC1)
--   AC3  LEGĂTURA CU CLIENTUL STRIPE: atribuirea de la înscriere primește
--        `stripe_customer_id` când apare pe profil; checkout-ul (capture, first-
--        wins) NU o schimbă; comisionul se găsește (înainte de legătură:
--        no_attribution); nu suprascrie un client deja legat; nu atinge o
--        atribuire terminală; un profil fără atribuire nu pică
--   AC4  PRIMUL CÂȘTIGĂ: un cont deja atribuit prin înscriere nu poate
--        revendica alt agent (atribuirea rămâne a primului)
--   AC5  claim_agent_code (sub rolul REAL `authenticated`): cont eligibil DA
--        (clientul Stripe existent e copiat); afiliat ca client NU (și pending);
--        fereastra D10 (marginea, ambele părți); factură plătită NU (0 lei nu
--        contează); nelogat → unauthenticated
--   AC6  ANTI-ORACOL: același `{ok:false, reason:invalid_code}` pentru cod
--        necunoscut / afiliat pending / suspendat / formă proastă; pe un cont
--        neeligibil, cod bun și cod rău primesc ACELAȘI răspuns
--   AC7  rate limit: al 6-lea apel în fereastră → rate_limited, chiar cu cod bun
--   AC8  trigger-ele NU aruncă niciodată: cu o capcană care aruncă pe INSERT-ul
--        de atribuire, contul se creează oricum; cu una pe UPDATE, scrierea
--        clientului Stripe pe profil reușește oricum
--   AC9  catalog: DEFINER cu `public, pg_temp`; anon fără EXECUTE pe
--        claim_agent_code (apel REAL: 42501 pe funcție); funcțiile de trigger și
--        helperii fără EXECUTE pentru roluri client; trigger-ele AFTER; D10 = 14
--   AC10 coduri DICTABILE: generatorul (alfabet, lungime, entropie) și
--        register_affiliate sub `authenticated` cu programul deschis; codul
--        existent al unui afiliat nu se rescrie
--   AC11 o atribuire NU dă acces la date: agentul atribuit prin înscriere vede
--        zero restaurante până la consimțământul ownerului (control pozitiv:
--        după consimțământ le vede)
--   AC12 CLICHET: register_affiliate rămâne pe lanțul 301 (o singură semnătură,
--        folosește generatorul, fără md5) — o migrație viitoare care îl recreează
--        din 295 face CI roșu aici, nu tăcut
-- =============================================================================

begin;

-- ── Fixture: agenți ──────────────────────────────────────────────────────────
-- A activ (cod + vanity), B activ, P pending (cerere), S suspendat.
insert into auth.users (id, email) values
  ('ac000000-0000-4000-8000-0000000000a1', 'ac-agent-a@ac301.test'),
  ('ac000000-0000-4000-8000-0000000000a2', 'ac-agent-b@ac301.test'),
  ('ac000000-0000-4000-8000-0000000000a3', 'ac-agent-p@ac301.test'),
  ('ac000000-0000-4000-8000-0000000000a4', 'ac-agent-s@ac301.test'),
  ('ac000000-0000-4000-8000-0000000000a5', 'ac-agent-n@ac301.test');
insert into public.affiliates (id, profile_id, referral_code, vanity_slug, status) values
  ('ac0a0000-0000-4000-8000-0000000000a1', 'ac000000-0000-4000-8000-0000000000a1', 'acagnta2', 'ac-vanity', 'active'),
  ('ac0a0000-0000-4000-8000-0000000000a2', 'ac000000-0000-4000-8000-0000000000a2', 'acagntb3', null, 'active'),
  ('ac0a0000-0000-4000-8000-0000000000a3', 'ac000000-0000-4000-8000-0000000000a3', 'acagntp4', null, 'pending'),
  ('ac0a0000-0000-4000-8000-0000000000a4', 'ac000000-0000-4000-8000-0000000000a4', 'acagnts5', null, 'suspended'),
  -- N: cod NUMERIC (8 cifre, valid pentru CHECK-ul 097) — singurul care deosebește
  -- un string „55667788” de un număr JSON 55667788 (`->>` le scrie la fel).
  ('ac0a0000-0000-4000-8000-0000000000a5', 'ac000000-0000-4000-8000-0000000000a5', '55667788', null, 'active');

-- ── AC1: înscriere cu codul agentului → atribuire pending ───────────────────
do $$
declare
  r record;
begin
  -- Cod cu litere mari și spații (tastat de om) → normalizat.
  insert into auth.users (id, email, raw_user_meta_data) values
    ('ac000000-0000-4000-8000-0000000000c1', 'ac-c1@ac301.test',
     jsonb_build_object('full_name', 'Patron C1', 'agent_code', '  ACAGNTA2 '));
  select aa.* into r from public.affiliate_attributions aa
   where aa.referred_profile_id = 'ac000000-0000-4000-8000-0000000000c1';
  if not found then
    raise exception 'AC1 FAIL: înscrierea cu cod valid nu a creat atribuirea';
  end if;
  if r.affiliate_id is distinct from 'ac0a0000-0000-4000-8000-0000000000a1'::uuid then
    raise exception 'AC1 FAIL: atribuit altui afiliat (%)', r.affiliate_id;
  end if;
  if r.status::text is distinct from 'pending' or r.source is distinct from 'signup_agent_code' then
    raise exception 'AC1 FAIL: status/sursă greșite (% / %)', r.status, r.source;
  end if;
  if r.stripe_customer_id is not null then
    raise exception 'AC1 FAIL: atribuirea de la înscriere nu are voie să aibă client Stripe încă';
  end if;
  if r.snap_setup_bps is null or r.snap_recurring_bps is null then
    raise exception 'AC1 FAIL: instantaneul de comision (293) nu s-a completat';
  end if;
  if r.owner_consented_at is not null then
    raise exception 'AC1 FAIL: consimțământul de acces nu se pune la înscriere';
  end if;
  -- Profilul există (înscrierea nu a fost afectată).
  if not exists (select 1 from public.profiles where id = 'ac000000-0000-4000-8000-0000000000c1') then
    raise exception 'AC1 FAIL: profilul nu există';
  end if;

  -- Vanity-ul rezolvă la același afiliat (aceeași regulă ca resolve_referral_code).
  insert into auth.users (id, email, raw_user_meta_data) values
    ('ac000000-0000-4000-8000-0000000000c2', 'ac-c2@ac301.test',
     jsonb_build_object('agent_code', 'AC-Vanity'));
  if (select affiliate_id from public.affiliate_attributions
       where referred_profile_id = 'ac000000-0000-4000-8000-0000000000c2')
     is distinct from 'ac0a0000-0000-4000-8000-0000000000a1'::uuid then
    raise exception 'AC1 FAIL: vanity-ul nu a rezolvat la afiliatul A';
  end if;

  -- Control pozitiv pentru AC2 (tipul JSON): același cod numeric, ca STRING, atribuie.
  insert into auth.users (id, email, raw_user_meta_data) values
    ('ac000000-0000-4000-8000-0000000000c4', 'ac-c4@ac301.test',
     jsonb_build_object('agent_code', '55667788'));
  if (select affiliate_id from public.affiliate_attributions
       where referred_profile_id = 'ac000000-0000-4000-8000-0000000000c4')
     is distinct from 'ac0a0000-0000-4000-8000-0000000000a5'::uuid then
    raise exception 'AC1 FAIL: codul numeric ca string nu a atribuit';
  end if;

  -- Fără cod → fără atribuire (patronii veniți singuri nu sunt atinși).
  insert into auth.users (id, email, raw_user_meta_data) values
    ('ac000000-0000-4000-8000-0000000000c3', 'ac-c3@ac301.test', jsonb_build_object('full_name', 'Singur'));
  if exists (select 1 from public.affiliate_attributions
              where referred_profile_id = 'ac000000-0000-4000-8000-0000000000c3') then
    raise exception 'AC1 FAIL: un cont fără cod a primit atribuire';
  end if;
  raise notice 'AC1 OK: înscriere cu cod/vanity → atribuire pending (sursa signup_agent_code), fără client Stripe';
end $$;

-- ── AC2: coduri greșite / metadata ciudat NU blochează înscrierea ───────────
do $$
declare
  v_meta   jsonb;
  v_id     uuid;
  v_n      int := 0;
  v_cases  jsonb[] := array[
    '{"agent_code":"nosuchco"}'::jsonb,                      -- necunoscut
    '{"agent_code":"acagntp4"}'::jsonb,                      -- afiliat PENDING (inert)
    '{"agent_code":"acagnts5"}'::jsonb,                      -- afiliat SUSPENDAT (inert)
    '{"agent_code":"x"}'::jsonb,                             -- prea scurt
    '{"agent_code":"a b c d"}'::jsonb,                       -- spații în interior
    '{"agent_code":"acagnta2; drop table x"}'::jsonb,        -- gunoi
    '{"agent_code":55667788}'::jsonb,                        -- număr JSON cu aceeași cifre ca un cod real
    '{"agent_code":{"code":"acagnta2"}}'::jsonb,             -- obiect
    '{"agent_code":["acagnta2"]}'::jsonb,                    -- array
    '{"agent_code":null}'::jsonb,                            -- null JSON
    '{"agent_code":""}'::jsonb,                              -- gol
    '{}'::jsonb,                                             -- fără cheie
    '"doar un string"'::jsonb,                               -- metadata ne-obiect
    '[]'::jsonb,                                             -- metadata array
    'null'::jsonb,                                           -- JSON null
    jsonb_build_object('agent_code', repeat('a', 200))       -- 200 de caractere
  ];
begin
  foreach v_meta in array v_cases loop
    v_n := v_n + 1;
    v_id := ('ac000000-0000-4000-8000-00000000d0' || lpad(v_n::text, 2, '0'))::uuid;
    insert into auth.users (id, email, raw_user_meta_data)
      values (v_id, 'ac-d' || v_n || '@ac301.test', v_meta);
    if not exists (select 1 from public.profiles where id = v_id) then
      raise exception 'AC2 FAIL (caz %: %): contul/profilul nu s-a creat', v_n, v_meta;
    end if;
    if exists (select 1 from public.affiliate_attributions where referred_profile_id = v_id) then
      raise exception 'AC2 FAIL (caz %: %): s-a creat o atribuire dintr-un cod invalid', v_n, v_meta;
    end if;
  end loop;
  -- NULL SQL (nu JSON null)
  insert into auth.users (id, email, raw_user_meta_data)
    values ('ac000000-0000-4000-8000-00000000d0ff', 'ac-dnull@ac301.test', null);
  if not exists (select 1 from public.profiles where id = 'ac000000-0000-4000-8000-00000000d0ff') then
    raise exception 'AC2 FAIL: metadata NULL a blocat înscrierea';
  end if;
  -- Control pozitiv: același mecanism, cu cod BUN, produce atribuire (altfel
  -- „zero atribuiri” de mai sus ar fi adevărat și cu trigger-ul șters).
  if not exists (select 1 from public.affiliate_attributions
                  where referred_profile_id = 'ac000000-0000-4000-8000-0000000000c1') then
    raise exception 'AC2 FAIL (control +): atribuirea din AC1 lipsește';
  end if;
  raise notice 'AC2 OK: % de coduri/metadata greșite — conturile se creează, zero atribuiri', v_n + 1;
end $$;

-- ── AC3: legătura cu clientul Stripe ────────────────────────────────────────
do $$
declare
  v_u   constant uuid := 'ac000000-0000-4000-8000-0000000000e3';
  v     jsonb;
  r     record;
  v_led bigint;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (v_u, 'ac-e3@ac301.test', jsonb_build_object('agent_code', 'acagnta2'));
  if not exists (select 1 from public.affiliate_attributions
                  where referred_profile_id = v_u and stripe_customer_id is null) then
    raise exception 'AC3 FAIL (precondiție): atribuirea de la înscriere lipsește / are deja client';
  end if;

  -- ÎNAINTE de legătură comisionul nu are cum să găsească atribuirea.
  v := public.process_affiliate_invoice_paid('evt_ac3_pre', 'cus_ac3', 'sub_ac3', 'in_ac3_pre',
         'subscription_create', 2900, 'RON', null, now(), 'pro');
  if v->>'skipped' is distinct from 'no_attribution' then
    raise exception 'AC3 FAIL (precondiție): fără client legat comisionul ar fi trebuit să dea no_attribution (%)', v;
  end if;

  -- Checkout-ul scrie clientul pe profil → trigger-ul îl scrie pe atribuire.
  update public.profiles set stripe_customer_id = 'cus_ac3' where id = v_u;
  select stripe_customer_id into r from public.affiliate_attributions where referred_profile_id = v_u;
  if r.stripe_customer_id is distinct from 'cus_ac3' then
    raise exception 'AC3 FAIL: clientul Stripe nu s-a propagat pe atribuire (%)', r.stripe_customer_id;
  end if;

  -- Checkout-ul chemă apoi capture_affiliate_attribution cu codul din cookie
  -- (aici al LUI B): primul câștigă, atribuirea rămâne a lui A.
  perform public.record_affiliate_touch('acagntb3', 'visitor_ac3x');
  v := public.capture_affiliate_attribution('acagntb3', v_u, 'cus_ac3', 'visitor_ac3x');
  if v->>'skipped' is distinct from 'already_attributed' then
    raise exception 'AC3 FAIL: capture ar fi trebuit să dea already_attributed (%)', v;
  end if;
  if (select affiliate_id from public.affiliate_attributions where referred_profile_id = v_u)
     is distinct from 'ac0a0000-0000-4000-8000-0000000000a1'::uuid then
    raise exception 'AC3 FAIL: checkout-ul a schimbat afiliatul atribuit';
  end if;

  -- Comisionul găsește atribuirea și plătește AFILIATUL DE LA ÎNSCRIERE (A).
  v := public.process_affiliate_invoice_paid('evt_ac3_1', 'cus_ac3', 'sub_ac3', 'in_ac3_1',
         'subscription_create', 2900, 'RON', null, now(), 'pro');
  if v->>'deferred' is distinct from 'setup_awaits_second_invoice' then
    raise exception 'AC3 FAIL: prima factură nu a găsit atribuirea (%)', v;
  end if;
  v := public.process_affiliate_invoice_paid('evt_ac3_2', 'cus_ac3', 'sub_ac3', 'in_ac3_2',
         'subscription_cycle', 2900, 'RON', '2026-12-01', now(), 'pro');
  if (v->>'setup_commission_cents')::bigint is distinct from 870::bigint then
    raise exception 'AC3 FAIL: comisionul de setup % (așteptat 870)', v->>'setup_commission_cents';
  end if;
  select count(*) into v_led from public.affiliate_ledger l
   where l.affiliate_id = 'ac0a0000-0000-4000-8000-0000000000a1'
     and l.attribution_id = (select id from public.affiliate_attributions where referred_profile_id = v_u);
  if v_led < 1 then
    raise exception 'AC3 FAIL: nicio linie în ledger pe afiliatul A';
  end if;

  -- Un client deja legat NU se suprascrie.
  update public.profiles set stripe_customer_id = 'cus_ac3_altul' where id = v_u;
  if (select stripe_customer_id from public.affiliate_attributions where referred_profile_id = v_u)
     is distinct from 'cus_ac3' then
    raise exception 'AC3 FAIL: clientul legat a fost suprascris';
  end if;

  -- O atribuire TERMINALĂ nu se atinge.
  insert into auth.users (id, email, raw_user_meta_data) values
    ('ac000000-0000-4000-8000-0000000000e4', 'ac-e4@ac301.test', jsonb_build_object('agent_code', 'acagnta2'));
  update public.affiliate_attributions set status = 'canceled'
   where referred_profile_id = 'ac000000-0000-4000-8000-0000000000e4';
  update public.profiles set stripe_customer_id = 'cus_ac3_term' where id = 'ac000000-0000-4000-8000-0000000000e4';
  if (select stripe_customer_id from public.affiliate_attributions
       where referred_profile_id = 'ac000000-0000-4000-8000-0000000000e4') is not null then
    raise exception 'AC3 FAIL: atribuirea terminală a primit client Stripe';
  end if;

  -- Un profil FĂRĂ atribuire poate primi client fără erori.
  insert into auth.users (id, email) values ('ac000000-0000-4000-8000-0000000000e5', 'ac-e5@ac301.test');
  update public.profiles set stripe_customer_id = 'cus_ac3_none' where id = 'ac000000-0000-4000-8000-0000000000e5';
  if (select stripe_customer_id from public.profiles where id = 'ac000000-0000-4000-8000-0000000000e5')
     is distinct from 'cus_ac3_none' then
    raise exception 'AC3 FAIL: profilul fără atribuire nu a primit clientul';
  end if;
  raise notice 'AC3 OK: clientul Stripe se propagă pe atribuirea de la înscriere → comisionul A (870) se găsește';
end $$;

-- ── AC4: primul câștigă (pe claim) ──────────────────────────────────────────
do $$
declare
  v_u constant uuid := 'ac000000-0000-4000-8000-0000000000f1';
  v   jsonb;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (v_u, 'ac-f1@ac301.test', jsonb_build_object('agent_code', 'acagnta2'));
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_u::text, true);
  v := public.claim_agent_code('acagntb3');
  perform set_config('role', 'none', true);
  if v->>'ok' is distinct from 'false' or v->>'detail' is distinct from 'already_attributed' then
    raise exception 'AC4 FAIL: claim peste o atribuire existentă nu e refuzat (%)', v;
  end if;
  if (select affiliate_id from public.affiliate_attributions where referred_profile_id = v_u)
     is distinct from 'ac0a0000-0000-4000-8000-0000000000a1'::uuid then
    raise exception 'AC4 FAIL: atribuirea nu mai e a primului agent';
  end if;
  raise notice 'AC4 OK: primul câștigă — claim peste atribuire respins, atribuirea rămâne a lui A';
end $$;

-- ── AC5: claim_agent_code — eligibilitate (sub rolul REAL authenticated) ─────
do $$
declare
  v    jsonb;
  v_ok constant uuid := 'ac000000-0000-4000-8000-0000000000b1';
  v_w  int := public.agent_code_claim_window_days();
begin
  -- (a) cont eligibil, CU client Stripe deja pe profil → claim reușește, clientul se copiază.
  insert into auth.users (id, email) values (v_ok, 'ac-b1@ac301.test');
  update public.profiles set stripe_customer_id = 'cus_ac5_claim' where id = v_ok;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_ok::text, true);
  v := public.claim_agent_code('ACAGNTB3');
  perform set_config('role', 'none', true);
  if v is distinct from '{"ok": true}'::jsonb then
    raise exception 'AC5 FAIL: claim eligibil respins (%)', v; end if;
  if not exists (select 1 from public.affiliate_attributions
                  where referred_profile_id = v_ok and source = 'claim_agent_code'
                    and status::text = 'pending'
                    and affiliate_id = 'ac0a0000-0000-4000-8000-0000000000a2'
                    and stripe_customer_id = 'cus_ac5_claim') then
    raise exception 'AC5 FAIL: atribuirea din claim lipsește / altul / fără clientul Stripe existent'; end if;

  -- (b) un AFILIAT nu poate fi client: activ (B → codul lui A) și pending (P).
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'ac000000-0000-4000-8000-0000000000a2', true);
  v := public.claim_agent_code('acagnta2');
  perform set_config('role', 'none', true);
  if v->>'detail' is distinct from 'is_affiliate' then
    raise exception 'AC5 FAIL: afiliat activ ca client (%)', v; end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'ac000000-0000-4000-8000-0000000000a3', true);
  v := public.claim_agent_code('acagnta2');
  perform set_config('role', 'none', true);
  if v->>'detail' is distinct from 'is_affiliate' then
    raise exception 'AC5 FAIL: solicitant de afiliere (pending) ca client (%)', v; end if;
  -- propriul cod al unui afiliat: tot respins (nu pe sine)
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'ac000000-0000-4000-8000-0000000000a1', true);
  v := public.claim_agent_code('acagnta2');
  perform set_config('role', 'none', true);
  if v->>'ok' is distinct from 'false' then
    raise exception 'AC5 FAIL: afiliatul și-a revendicat propriul cod (%)', v; end if;
  if exists (select 1 from public.affiliate_attributions
              where referred_profile_id in ('ac000000-0000-4000-8000-0000000000a1',
                                            'ac000000-0000-4000-8000-0000000000a2',
                                            'ac000000-0000-4000-8000-0000000000a3')) then
    raise exception 'AC5 FAIL: un afiliat a ajuns client'; end if;

  -- (c) fereastra D10: cu 1 minut PESTE → refuzat; cu 1 minut SUB → acceptat.
  insert into auth.users (id, email) values
    ('ac000000-0000-4000-8000-0000000000b2', 'ac-b2@ac301.test'),
    ('ac000000-0000-4000-8000-0000000000b3', 'ac-b3@ac301.test');
  update public.profiles set created_at = now() - make_interval(days => v_w) - interval '1 minute'
   where id = 'ac000000-0000-4000-8000-0000000000b2';
  update public.profiles set created_at = now() - make_interval(days => v_w) + interval '1 minute'
   where id = 'ac000000-0000-4000-8000-0000000000b3';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'ac000000-0000-4000-8000-0000000000b2', true);
  v := public.claim_agent_code('acagnta2');
  perform set_config('role', 'none', true);
  if v->>'detail' is distinct from 'account_too_old' then
    raise exception 'AC5 FAIL: contul peste fereastră acceptat (%)', v; end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'ac000000-0000-4000-8000-0000000000b3', true);
  v := public.claim_agent_code('acagnta2');
  perform set_config('role', 'none', true);
  if v->>'ok' is distinct from 'true' then
    raise exception 'AC5 FAIL: contul din fereastră respins (%)', v; end if;

  -- (d) factură plătită: >0 → refuzat; 0 lei (trialul) → eligibil.
  insert into auth.users (id, email) values
    ('ac000000-0000-4000-8000-0000000000b4', 'ac-b4@ac301.test'),
    ('ac000000-0000-4000-8000-0000000000b5', 'ac-b5@ac301.test');
  insert into public.lifecycle_events (user_id, event_type, event_data) values
    ('ac000000-0000-4000-8000-0000000000b4', 'invoice_paid', '{"amount_paid": 24900, "currency": "ron"}'),
    ('ac000000-0000-4000-8000-0000000000b5', 'invoice_paid', '{"amount_paid": 0, "currency": "ron"}');
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'ac000000-0000-4000-8000-0000000000b4', true);
  v := public.claim_agent_code('acagnta2');
  perform set_config('role', 'none', true);
  if v->>'detail' is distinct from 'already_paying' then
    raise exception 'AC5 FAIL: cont cu factură plătită acceptat (%)', v; end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'ac000000-0000-4000-8000-0000000000b5', true);
  v := public.claim_agent_code('acagnta2');
  perform set_config('role', 'none', true);
  if v->>'ok' is distinct from 'true' then
    raise exception 'AC5 FAIL: factura de 0 lei (trial) a blocat revendicarea (%)', v; end if;

  -- (e) nelogat (rol authenticated, fără sub) → unauthenticated.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '', true);
  v := public.claim_agent_code('acagnta2');
  perform set_config('role', 'none', true);
  if v->>'reason' is distinct from 'unauthenticated' then
    raise exception 'AC5 FAIL: apel fără identitate (%)', v; end if;
  raise notice 'AC5 OK: eligibil DA (client Stripe copiat); afiliat NU; fereastra D10 (±1 min); factură >0 NU, 0 lei DA; nelogat refuzat';
end $$;

-- ── AC6: anti-oracol ────────────────────────────────────────────────────────
do $$
declare
  v_u constant uuid := 'ac000000-0000-4000-8000-0000000000b6';
  v   jsonb;
  v_c text;
  v_exp constant jsonb := '{"ok": false, "reason": "invalid_code"}'::jsonb;
  v_old jsonb;
  v_new jsonb;
begin
  insert into auth.users (id, email) values (v_u, 'ac-b6@ac301.test');
  -- 4 coduri care NU trebuie să se poată distinge (limita e 5 apeluri / fereastră).
  foreach v_c in array array['zzzzzzzz', 'acagntp4', 'acagnts5', '!!'] loop
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', v_u::text, true);
    v := public.claim_agent_code(v_c);
    perform set_config('role', 'none', true);
    if v is distinct from v_exp then
      raise exception 'AC6 FAIL: codul „%” a primit % în loc de invalid_code', v_c, v; end if;
  end loop;
  if exists (select 1 from public.affiliate_attributions where referred_profile_id = v_u) then
    raise exception 'AC6 FAIL: un cod invalid a creat atribuire'; end if;

  -- Cont NEeligibil (prea vechi): cod bun și cod rău → răspuns IDENTIC.
  insert into auth.users (id, email) values
    ('ac000000-0000-4000-8000-0000000000b7', 'ac-b7@ac301.test');
  update public.profiles set created_at = now() - interval '60 days'
   where id = 'ac000000-0000-4000-8000-0000000000b7';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'ac000000-0000-4000-8000-0000000000b7', true);
  v_old := public.claim_agent_code('acagnta2');
  v_new := public.claim_agent_code('zzzzzzzz');
  perform set_config('role', 'none', true);
  if v_old is distinct from v_new or v_old->>'reason' is distinct from 'not_eligible' then
    raise exception 'AC6 FAIL: pe un cont neeligibil, codul bun (%) se distinge de cel rău (%)', v_old, v_new; end if;
  raise notice 'AC6 OK: invalid_code identic pentru necunoscut/pending/suspendat/formă; neeligibil → același răspuns pe cod bun și rău';
end $$;

-- ── AC7: rate limit 5 / 15 min per utilizator ───────────────────────────────
do $$
declare
  v_u constant uuid := 'ac000000-0000-4000-8000-0000000000b8';
  v   jsonb;
  i   int;
begin
  insert into auth.users (id, email) values (v_u, 'ac-b8@ac301.test');
  for i in 1..5 loop
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', v_u::text, true);
    v := public.claim_agent_code('zzzzzzzz');
    perform set_config('role', 'none', true);
    if v->>'reason' is distinct from 'invalid_code' then
      raise exception 'AC7 FAIL: apelul % ar fi trebuit să treacă de plafon (%)', i, v; end if;
  end loop;
  -- Al 6-lea, CU cod bun: plafonul bate totul și nu se creează nimic.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_u::text, true);
  v := public.claim_agent_code('acagnta2');
  perform set_config('role', 'none', true);
  if v->>'reason' is distinct from 'rate_limited' then
    raise exception 'AC7 FAIL: al 6-lea apel nu e rate_limited (%)', v; end if;
  if exists (select 1 from public.affiliate_attributions where referred_profile_id = v_u) then
    raise exception 'AC7 FAIL: apelul peste plafon a creat atribuire'; end if;
  -- Plafonul e PER UTILIZATOR: alt cont, primul apel, trece.
  insert into auth.users (id, email) values ('ac000000-0000-4000-8000-0000000000b9', 'ac-b9@ac301.test');
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'ac000000-0000-4000-8000-0000000000b9', true);
  v := public.claim_agent_code('acagnta2');
  perform set_config('role', 'none', true);
  if v->>'ok' is distinct from 'true' then
    raise exception 'AC7 FAIL (control +): alt utilizator blocat de plafonul altuia (%)', v; end if;
  raise notice 'AC7 OK: 5 apeluri trec, al 6-lea → rate_limited (și cu cod bun); plafonul e per utilizator';
end $$;

-- ── AC8: trigger-ele NU aruncă niciodată ────────────────────────────────────
-- Capcană care ARUNCĂ pe orice INSERT / UPDATE din affiliate_attributions: fără
-- exception-wrapper, înscrierea (respectiv scrierea clientului Stripe) ar muri.
create function public.ac301_boom() returns trigger language plpgsql as $f$
begin
  raise exception 'ac301 boom (capcană de test)';
end $f$;

do $$
declare
  v_u constant uuid := 'ac000000-0000-4000-8000-0000000000aa';
begin
  -- (a) INSERT de atribuire care aruncă → contul se creează oricum.
  create trigger ac301_boom_ins before insert on public.affiliate_attributions
    for each row execute function public.ac301_boom();
  insert into auth.users (id, email, raw_user_meta_data) values
    (v_u, 'ac-boom1@ac301.test', jsonb_build_object('agent_code', 'acagnta2'));
  if not exists (select 1 from public.profiles where id = v_u) then
    raise exception 'AC8 FAIL: o eroare în atribuire a avortat crearea contului'; end if;
  if exists (select 1 from public.affiliate_attributions where referred_profile_id = v_u) then
    raise exception 'AC8 FAIL (control): capcana nu a oprit atribuirea — testul ar fi vacuu'; end if;
  drop trigger ac301_boom_ins on public.affiliate_attributions;

  -- (b) UPDATE de atribuire care aruncă → clientul Stripe se scrie pe profil oricum.
  insert into auth.users (id, email, raw_user_meta_data) values
    ('ac000000-0000-4000-8000-0000000000ab', 'ac-boom2@ac301.test', jsonb_build_object('agent_code', 'acagnta2'));
  if not exists (select 1 from public.affiliate_attributions
                  where referred_profile_id = 'ac000000-0000-4000-8000-0000000000ab') then
    raise exception 'AC8 FAIL (precondiție): atribuirea pentru (b) lipsește'; end if;
  create trigger ac301_boom_upd before update on public.affiliate_attributions
    for each row execute function public.ac301_boom();
  update public.profiles set stripe_customer_id = 'cus_ac8' where id = 'ac000000-0000-4000-8000-0000000000ab';
  if (select stripe_customer_id from public.profiles where id = 'ac000000-0000-4000-8000-0000000000ab')
     is distinct from 'cus_ac8' then
    raise exception 'AC8 FAIL: o eroare în legătura Stripe a avortat scrierea pe profil'; end if;
  if (select stripe_customer_id from public.affiliate_attributions
       where referred_profile_id = 'ac000000-0000-4000-8000-0000000000ab') is not null then
    raise exception 'AC8 FAIL (control): capcana UPDATE nu a oprit legătura — testul ar fi vacuu'; end if;
  drop trigger ac301_boom_upd on public.affiliate_attributions;
  raise notice 'AC8 OK: eroare în atribuire / legătură → contul și clientul Stripe se scriu oricum';
end $$;

drop function public.ac301_boom();

-- ── AC9: catalog + privilegii ───────────────────────────────────────────────
do $$
declare
  v_sig  text;
  v_msg  text;
  v_st   text;
begin
  -- DEFINER cu search_path = public, pg_temp
  foreach v_sig in array array[
    'public.claim_agent_code(text)', 'public.fn_attribute_signup_agent_code()',
    'public.fn_link_attribution_stripe_customer()'] loop
    if not (select prosecdef from pg_proc where oid = v_sig::regprocedure) then
      raise exception 'AC9 FAIL: % nu e SECURITY DEFINER', v_sig; end if;
  end loop;
  foreach v_sig in array array[
    'public.claim_agent_code(text)', 'public.fn_attribute_signup_agent_code()',
    'public.fn_link_attribution_stripe_customer()', 'public.new_agent_referral_code()',
    'public.agent_code_claim_window_days()'] loop
    if not exists (select 1 from pg_proc where oid = v_sig::regprocedure
                    and array_to_string(proconfig, ',') like '%search_path=public, pg_temp%') then
      raise exception 'AC9 FAIL: % fără search_path = public, pg_temp', v_sig; end if;
  end loop;

  -- claim_agent_code: DOAR authenticated (control pozitiv + negative)
  if not has_function_privilege('authenticated', 'public.claim_agent_code(text)', 'execute') then
    raise exception 'AC9 FAIL (control +): authenticated nu poate apela claim_agent_code'; end if;
  if has_function_privilege('anon', 'public.claim_agent_code(text)', 'execute')
     or has_function_privilege('service_role', 'public.claim_agent_code(text)', 'execute') then
    raise exception 'AC9 FAIL: anon/service_role pot apela claim_agent_code'; end if;

  -- Apel REAL ca anon: pică pe ACL-ul FUNCȚIEI (nu pe schemă / corp).
  begin
    perform set_config('role', 'anon', true);
    perform public.claim_agent_code('acagnta2');
    perform set_config('role', 'none', true);
    raise exception 'AC9 FAIL: anon a putut apela claim_agent_code';
  exception when insufficient_privilege then
    get stacked diagnostics v_msg = message_text, v_st = returned_sqlstate;
    perform set_config('role', 'none', true);
    if v_msg not like '%for function%' then
      raise exception 'AC9 FAIL: anon a picat din alt motiv decât ACL-ul funcției (%)', v_msg; end if;
  end;

  -- Funcțiile de trigger + helperii: la niciun rol client.
  foreach v_sig in array array[
    'public.fn_attribute_signup_agent_code()', 'public.fn_link_attribution_stripe_customer()',
    'public.new_agent_referral_code()', 'public.agent_code_claim_window_days()'] loop
    if has_function_privilege('anon', v_sig::regprocedure, 'execute')
       or has_function_privilege('authenticated', v_sig::regprocedure, 'execute')
       or has_function_privilege('service_role', v_sig::regprocedure, 'execute') then
      raise exception 'AC9 FAIL: % e apelabilă de un rol client', v_sig; end if;
  end loop;

  -- Trigger-ele: AFTER INSERT ROW (5) și AFTER UPDATE OF ROW (17), pe profiles.
  if not exists (select 1 from pg_trigger where tgname = 'trg_profiles_agent_code_attribution'
                  and tgrelid = 'public.profiles'::regclass and tgtype = 5 and tgenabled = 'O') then
    raise exception 'AC9 FAIL: trg_profiles_agent_code_attribution lipsește / nu e AFTER INSERT ROW / e dezactivat'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_profiles_attribution_stripe_link'
                  and tgrelid = 'public.profiles'::regclass and tgtype = 17 and tgenabled = 'O') then
    raise exception 'AC9 FAIL: trg_profiles_attribution_stripe_link lipsește / nu e AFTER UPDATE ROW / e dezactivat'; end if;
  -- NU pe auth.users (nu concurează handle_new_user): singurul trigger de acolo e al profilului.
  if exists (select 1 from pg_trigger t where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal
              and pg_get_triggerdef(t.oid) ilike '%agent_code%') then
    raise exception 'AC9 FAIL: atribuirea stă pe auth.users, nu pe profiles'; end if;

  -- D10: o singură constantă, 14.
  if public.agent_code_claim_window_days() <> 14 then
    raise exception 'AC9 FAIL: fereastra D10 ≠ 14'; end if;
  raise notice 'AC9 OK: DEFINER + search_path, anon respins pe ACL-ul funcției, trigger-e/helperi la niciun rol client, D10 = 14';
end $$;

-- ── AC10: coduri dictabile ──────────────────────────────────────────────────
do $$
declare
  v_code text;
  v_set  text[] := '{}';
  i      int;
  v      jsonb;
begin
  for i in 1..2000 loop
    v_code := public.new_agent_referral_code();
    if v_code !~ '^[abcdefghjkmnpqrstuvwxyz2-9]{7}$' then
      raise exception 'AC10 FAIL: cod în afara alfabetului dictabil / lungime greșită: %', v_code; end if;
    v_set := v_set || v_code;
  end loop;
  -- Entropie: din 2000 de coduri, aproape toate distincte (31^7 ≈ 2,7e10).
  if (select count(distinct x) from unnest(v_set) x) < 1990 then
    raise exception 'AC10 FAIL: prea multe coliziuni în 2000 de coduri — generatorul nu e aleator'; end if;
  -- Toate cele 7 poziții variază (nu rămâne vreuna fixă).
  for i in 1..7 loop
    if (select count(distinct substr(x, i, 1)) from unnest(v_set) x) < 20 then
      raise exception 'AC10 FAIL: poziția % are prea puține valori distincte', i; end if;
  end loop;

  -- register_affiliate (sub rolul REAL authenticated, programul DESCHIS) dă cod dictabil.
  update public.platform_settings set value = 'true'::jsonb where key = 'affiliate_program_open';
  insert into auth.users (id, email) values ('ac000000-0000-4000-8000-0000000000c9', 'ac-c9@ac301.test');
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'ac000000-0000-4000-8000-0000000000c9', true);
  v := public.register_affiliate(null, '0712 345 678', 'AC10');
  perform set_config('role', 'none', true);
  if v->>'ok' is distinct from 'true' or v->>'referral_code' !~ '^[abcdefghjkmnpqrstuvwxyz2-9]{7}$' then
    raise exception 'AC10 FAIL: register_affiliate nu dă cod dictabil (%)', v; end if;
  if not exists (select 1 from public.affiliates
                  where profile_id = 'ac000000-0000-4000-8000-0000000000c9'
                    and referral_code = v->>'referral_code' and status::text = 'pending') then
    raise exception 'AC10 FAIL: rândul din affiliates nu corespunde'; end if;
  -- Codurile EXISTENTE nu se rescriu.
  if (select referral_code from public.affiliates where id = 'ac0a0000-0000-4000-8000-0000000000a1')
     is distinct from 'acagnta2' then
    raise exception 'AC10 FAIL: un cod existent a fost rescris'; end if;
  raise notice 'AC10 OK: 2000 de coduri dictabile (7 car., fără 0/o/1/i/l, entropie), register_affiliate le folosește, cele existente neatinse';
end $$;

-- ── AC11: o atribuire NU dă acces la date ───────────────────────────────────
do $$
declare
  v_o  constant uuid := 'ac000000-0000-4000-8000-0000000000ca';
  v_r  constant uuid := 'ac000000-0000-4000-8000-0000000000cb';
  v_ls jsonb;
  v_ha boolean;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (v_o, 'ac-owner@ac301.test', jsonb_build_object('agent_code', 'acagnta2'));
  update public.profiles set plan = 'enterprise' where id = v_o;
  insert into public.restaurants (id, owner_id, name, slug, city, is_active)
    values (v_r, v_o, 'AC Bistro', 'ac-bistro-301', 'Cluj', true);
  if not exists (select 1 from public.affiliate_attributions where referred_profile_id = v_o) then
    raise exception 'AC11 FAIL (precondiție): atribuirea ownerului lipsește'; end if;

  -- Agentul A, sub rolul real: nimic fără consimțământ.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'ac000000-0000-4000-8000-0000000000a1', true);
  v_ls := public.list_partner_restaurants();
  v_ha := public.has_partner_access(v_r);
  perform set_config('role', 'none', true);
  if jsonb_array_length(v_ls) <> 0 or v_ha then
    raise exception 'AC11 FAIL: atribuirea de la înscriere a dat acces la date fără consimțământ (% / %)', v_ls, v_ha; end if;

  -- Control POZITIV: cu consimțământul ownerului, aceeași atribuire dă acces.
  update public.affiliate_attributions set owner_consented_at = now() where referred_profile_id = v_o;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'ac000000-0000-4000-8000-0000000000a1', true);
  v_ls := public.list_partner_restaurants();
  v_ha := public.has_partner_access(v_r);
  perform set_config('role', 'none', true);
  if jsonb_array_length(v_ls) <> 1 or not v_ha then
    raise exception 'AC11 FAIL (control +): cu consimțământ agentul nu vede restaurantul (% / %)', v_ls, v_ha; end if;
  raise notice 'AC11 OK: atribuire fără consimțământ = zero acces; cu consimțământ = acces (control pozitiv)';
end $$;

-- ── AC12: clichet pe lanțul register_affiliate ──────────────────────────────
do $$
declare
  v_src text;
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'register_affiliate') <> 1 then
    raise exception 'AC12 FAIL: register_affiliate are mai multe semnături (PGRST203)'; end if;
  v_src := pg_get_functiondef('public.register_affiliate(text, text, text)'::regprocedure);
  if position('new_agent_referral_code' in v_src) = 0 then
    raise exception 'AC12 FAIL: register_affiliate nu mai folosește generatorul dictabil — recreat din 295? Orice recreare pornește din 301'; end if;
  if position('md5(' in v_src) > 0 then
    raise exception 'AC12 FAIL: register_affiliate generează iar coduri md5 (8 hex)'; end if;
  -- Invariantele 224/243/295 rămân.
  if position('unique_violation' in v_src) = 0 or position('phone_required' in v_src) = 0
     or position('affiliate_program_is_open' in v_src) = 0 or position('platform_settings' in v_src) = 0
     or position('pg_temp' in v_src) = 0 then
    raise exception 'AC12 FAIL: register_affiliate a pierdut un invariant 224/243/295'; end if;
  raise notice 'AC12 OK: register_affiliate pe lanțul 301 (generator dictabil, o semnătură, invarianții păstrați)';
end $$;

do $$ begin raise notice '════ 301 agent code signup attribution: ALL PASS ════'; end $$;

rollback;
