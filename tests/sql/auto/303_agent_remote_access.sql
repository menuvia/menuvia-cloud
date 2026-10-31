-- tests/sql/auto/303_agent_remote_access.sql
-- =============================================================================
-- Mig 303 (pachetul 10): „Agentul tău Menuvia” — patronul își vede agentul și îi
-- dă acces la meniu pe ORICE plan, fără să aștepte o cerere. Rulează din
-- tests/sql/auto/ (scripts/run-sql-auto.sh) pe AMBELE medii. Autonom, ROLLBACK.
-- Verificările de identitate rulează sub rolul REAL `authenticated` / `anon`
-- (ca postgres RLS-ul și ACL-urile sunt ocolite și testul ar fi orb).
--
--   AR1  get_my_agent: lista albă EXACTĂ (8 chei), contactul agentului ascuns
--        fără consimțământul lui (`contact_sharing`), vizibil cu el (control
--        pozitiv); un restaurant fără agent întoarce DOAR {"has_agent": false}
--   AR2  gate: non-admin / waiter / străin / restaurant inexistent → același
--        42501 „Acces interzis” (zero oracol); anon → 42501 pe funcție;
--        managerul și fondatorul văd agentul dar NU contactul și can_manage=false
--   AR3  owner_grant_partner_access pe plan FREE: acordă fără cerere, agentul
--        capătă has_partner_access, idempotent (o singură urmă de audit),
--        revocabil, re-acordabil
--   AR4  respingeri: agentul / străinul / alt owner / manager / fondator nu pot
--        acorda; atribuire terminală (canceled/refunded/expired) și agent
--        suspendat → ok:false; atribuire cu profilul șters (NULL) → Acces interzis
--   AR5  REGULA DE AUR: după acordare pe plan free agentul vede meniul și mesele,
--        dar ZERO rânduri din comenzi, plăți, bonuri, facturi, rezervări,
--        oblio_configs, invitații, echipă; scrierea pe ele e refuzată
--   AR6  emailul către patron: o cerere nouă → 1 rând `partner_access_requested`
--        către PATRON (nu agent, fără contactul agentului), re-intrarea nu
--        dublează, o cerere nouă după revocare = email nou, acordarea proactivă
--        nu trimite; un eșec de enqueue NU avortează cererea (exception-wrapped)
--   AR7  catalog: DEFINER cu `public, pg_temp`, grant-uri doar `authenticated`,
--        funcția de trigger fără EXECUTE pentru roluri client, funcțiile 286
--        neatinse (o singură semnătură)
--   AR8  cerere a agentului → aprobare de owner pe ACELAȘI card (starea
--        `requested` → `granted`), cu ambele căi (grant / owner_grant)
-- =============================================================================

begin;

-- ── Fixture ──────────────────────────────────────────────────────────────────
-- Agenți: AG1 activ (cu telefon), AG2 suspendat.
-- Owneri: O1 free (R1, atribuit AG1, cu date SENSIBILE), O2 fără agent (R2),
-- O3 atribuire canceled (R3), O4 agent suspendat (R4), O5 enterprise (R5,
-- atribuit AG1, manager M1 + waiter W1). X străin, F fondator.
insert into auth.users (id, email) values
  ('a3000000-0000-4000-8000-0000000000a1', 'ar-agent1@ar303.test'),
  ('a3000000-0000-4000-8000-0000000000a2', 'ar-agent2@ar303.test'),
  ('a3000000-0000-4000-8000-0000000000b1', 'ar-o1@ar303.test'),
  ('a3000000-0000-4000-8000-0000000000b2', 'ar-o2@ar303.test'),
  ('a3000000-0000-4000-8000-0000000000b3', 'ar-o3@ar303.test'),
  ('a3000000-0000-4000-8000-0000000000b4', 'ar-o4@ar303.test'),
  ('a3000000-0000-4000-8000-0000000000b5', 'ar-o5@ar303.test'),
  ('a3000000-0000-4000-8000-0000000000b6', 'ar-o6@ar303.test'),
  ('a3000000-0000-4000-8000-0000000000c1', 'ar-manager@ar303.test'),
  ('a3000000-0000-4000-8000-0000000000c2', 'ar-waiter@ar303.test'),
  ('a3000000-0000-4000-8000-0000000000d1', 'ar-stranger@ar303.test'),
  ('a3000000-0000-4000-8000-0000000000f1', 'ar-founder@ar303.test');
update public.profiles set full_name = 'Agent Unu'
 where id = 'a3000000-0000-4000-8000-0000000000a1';
update public.profiles set full_name = 'Patron Cinci'
 where id = 'a3000000-0000-4000-8000-0000000000b5';
update public.profiles set is_platform_admin = true
 where id = 'a3000000-0000-4000-8000-0000000000f1';
-- O1 e enterprise doar cât timp seed-uim date fiscale (gate-urile 124/133);
-- apoi coboară pe FREE — scenariul real al acestui pachet.
update public.profiles set plan = 'enterprise'
 where id in ('a3000000-0000-4000-8000-0000000000b1', 'a3000000-0000-4000-8000-0000000000b5');

insert into public.affiliates (id, profile_id, referral_code, status, phone) values
  ('a3a00000-0000-4000-8000-0000000000a1', 'a3000000-0000-4000-8000-0000000000a1', 'aragnta1', 'active',    '0721000111'),
  ('a3a00000-0000-4000-8000-0000000000a2', 'a3000000-0000-4000-8000-0000000000a2', 'aragntb2', 'suspended', '0721000222');

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('a3100000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-0000000000b1', 'AR Unu',    'ar-unu-303',    'Cluj', true),
  ('a3100000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-0000000000b2', 'AR Doi',    'ar-doi-303',    'Cluj', true),
  ('a3100000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-0000000000b3', 'AR Trei',   'ar-trei-303',   'Cluj', true),
  ('a3100000-0000-4000-8000-000000000004', 'a3000000-0000-4000-8000-0000000000b4', 'AR Patru',  'ar-patru-303',  'Cluj', true),
  ('a3100000-0000-4000-8000-000000000005', 'a3000000-0000-4000-8000-0000000000b5', 'AR Cinci',  'ar-cinci-303',  'Cluj', true);
insert into public.restaurant_memberships (restaurant_id, user_id, role) values
  ('a3100000-0000-4000-8000-000000000005', 'a3000000-0000-4000-8000-0000000000c1', 'manager'),
  ('a3100000-0000-4000-8000-000000000005', 'a3000000-0000-4000-8000-0000000000c2', 'waiter');

insert into public.affiliate_attributions (id, affiliate_id, referred_profile_id, status, source) values
  ('a3c00000-0000-4000-8000-000000000001', 'a3a00000-0000-4000-8000-0000000000a1', 'a3000000-0000-4000-8000-0000000000b1', 'active',   'link'),
  ('a3c00000-0000-4000-8000-000000000003', 'a3a00000-0000-4000-8000-0000000000a1', 'a3000000-0000-4000-8000-0000000000b3', 'canceled', 'link'),
  ('a3c00000-0000-4000-8000-000000000004', 'a3a00000-0000-4000-8000-0000000000a2', 'a3000000-0000-4000-8000-0000000000b4', 'active',   'link'),
  ('a3c00000-0000-4000-8000-000000000005', 'a3a00000-0000-4000-8000-0000000000a1', 'a3000000-0000-4000-8000-0000000000b5', 'active',   'link');

-- Meniu + mese pe R1 (ce agentul are voie să vadă DUPĂ acordare).
insert into public.categories (id, restaurant_id, name) values
  ('a3d00000-0000-4000-8000-000000000001', 'a3100000-0000-4000-8000-000000000001', 'Cat AR');
insert into public.products (id, restaurant_id, name, price, is_active, is_draft) values
  ('a3e00000-0000-4000-8000-000000000001', 'a3100000-0000-4000-8000-000000000001', 'Produs AR 1', 50, true, true),
  ('a3e00000-0000-4000-8000-000000000002', 'a3100000-0000-4000-8000-000000000001', 'Produs AR 2', 30, true, false);
insert into public.tables (id, restaurant_id, name, slug) values
  ('a3f00000-0000-4000-8000-000000000001', 'a3100000-0000-4000-8000-000000000001', 'Masa AR', 'masa-ar');

-- Date SENSIBILE pe R1 (bani, bon, rezervări, secrete) — agentul NU le vede niciodată.
insert into public.orders (id, restaurant_id, source, status) values
  ('a3b00000-0000-4000-8000-000000000001', 'a3100000-0000-4000-8000-000000000001', 'waiter', 'new');
insert into public.order_items (order_id, product_name_snapshot, unit_price_snapshot, item_total) values
  ('a3b00000-0000-4000-8000-000000000001', 'Produs AR 2', 30, 30);
insert into public.order_payments (order_id, amount, method) values
  ('a3b00000-0000-4000-8000-000000000001', 10, 'cash');
insert into public.reservations (restaurant_id, customer_name, customer_phone, party_size, starts_at, ends_at) values
  ('a3100000-0000-4000-8000-000000000001', 'Client AR', '+40700000303', 2,
   now() + interval '3 days', now() + interval '3 days 2 hours');
insert into public.oblio_configs (restaurant_id, api_email, api_secret, company_cif, company_name) values
  ('a3100000-0000-4000-8000-000000000001', 'ar@ar303.test', 'SECRET-AR', 'RO123', 'AR SRL');
insert into public.pending_receipts (restaurant_id, order_id, payload, total_snapshot) values
  ('a3100000-0000-4000-8000-000000000001', 'a3b00000-0000-4000-8000-000000000001', 'payload-ar', 30);
insert into public.invite_tokens (restaurant_id, email, role) values
  ('a3100000-0000-4000-8000-000000000001', 'invitat@ar303.test', 'waiter');

-- Coborâre pe FREE (scenariul pachetului: patronul pe plan gratuit / 99 lei).
update public.profiles set plan = 'free' where id = 'a3000000-0000-4000-8000-0000000000b1';

-- ═══════ AR1: lista albă, contactul doar cu consimțământul agentului ═══════
do $$
declare
  v      jsonb;
  v_keys text[];
  v_st   text;
begin
  if (select plan from public.profiles where id = 'a3000000-0000-4000-8000-0000000000b1') <> 'free' then
    raise exception 'AR1 FAIL (precondiție): O1 trebuie să fie pe plan free';
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000b1', true);
  v := public.get_my_agent('a3100000-0000-4000-8000-000000000001');
  perform set_config('role', 'none', true);

  select array_agg(k order by k collate "C") into v_keys from jsonb_object_keys(v) k;
  if v_keys is distinct from array['access_state', 'agent_name', 'attribution_id', 'can_manage',
                                   'contact_shared', 'email', 'has_agent', 'phone'] then
    raise exception 'AR1 FAIL: forma nu mai e lista albă înghețată: %', v_keys;
  end if;
  if (v->>'has_agent')::boolean is not true
     or v->>'attribution_id' is distinct from 'a3c00000-0000-4000-8000-000000000001'
     or v->>'agent_name' is distinct from 'Agent Unu'
     or v->>'access_state' is distinct from 'none'
     or (v->>'can_manage')::boolean is not true
     or (v->>'contact_shared')::boolean is not false then
    raise exception 'AR1 FAIL: conținut greșit pentru owner: %', v;
  end if;
  if jsonb_typeof(v->'phone') is distinct from 'null' or jsonb_typeof(v->'email') is distinct from 'null' then
    raise exception 'AR1 FAIL: contactul agentului a ieșit FĂRĂ consimțământul lui: %', v;
  end if;
  -- Nicio valoare din răspuns nu conține telefonul/emailul agentului.
  if v::text like '%0721000111%' or v::text like '%ar-agent1@ar303.test%' then
    raise exception 'AR1 FAIL: contactul agentului apare în răspuns fără consimțământ: %', v;
  end if;

  -- Control POZITIV: agentul bifează consimțământul → ownerul vede contactul.
  update public.affiliates set contact_sharing = true, contact_sharing_at = now()
   where id = 'a3a00000-0000-4000-8000-0000000000a1';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000b1', true);
  v := public.get_my_agent('a3100000-0000-4000-8000-000000000001');
  perform set_config('role', 'none', true);
  if v->>'phone' is distinct from '0721000111'
     or v->>'email' is distinct from 'ar-agent1@ar303.test'
     or (v->>'contact_shared')::boolean is not true then
    raise exception 'AR1 FAIL (control +): cu consimțământ contactul nu iese: %', v;
  end if;

  -- Restaurant FĂRĂ agent: DOAR has_agent=false (nimic altceva).
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000b2', true);
  v := public.get_my_agent('a3100000-0000-4000-8000-000000000002');
  perform set_config('role', 'none', true);
  if v is distinct from '{"has_agent": false}'::jsonb then
    raise exception 'AR1 FAIL: restaurant fără agent trebuie să întoarcă exact {has_agent:false}, nu %', v;
  end if;

  -- Atribuire TERMINALĂ (canceled / refunded / expired) → nimic.
  foreach v_st in array array['canceled', 'refunded', 'expired'] loop
    update public.affiliate_attributions set status = v_st::public.attribution_status
     where id = 'a3c00000-0000-4000-8000-000000000003';
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000b3', true);
    v := public.get_my_agent('a3100000-0000-4000-8000-000000000003');
    perform set_config('role', 'none', true);
    if v is distinct from '{"has_agent": false}'::jsonb then
      raise exception 'AR1 FAIL: atribuire % trebuie să nu mai arate agentul, nu %', v_st, v;
    end if;
  end loop;
  -- Control pozitiv pe aceeași atribuire: non-terminală → agentul apare.
  update public.affiliate_attributions set status = 'pending'
   where id = 'a3c00000-0000-4000-8000-000000000003';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000b3', true);
  v := public.get_my_agent('a3100000-0000-4000-8000-000000000003');
  perform set_config('role', 'none', true);
  if (v->>'has_agent')::boolean is not true then
    raise exception 'AR1 FAIL (control +): atribuirea pending nu mai arată agentul: %', v;
  end if;
  update public.affiliate_attributions set status = 'canceled'
   where id = 'a3c00000-0000-4000-8000-000000000003';

  -- Agent SUSPENDAT → nimic (nu poate avea acces, deci nici card).
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000b4', true);
  v := public.get_my_agent('a3100000-0000-4000-8000-000000000004');
  perform set_config('role', 'none', true);
  if v is distinct from '{"has_agent": false}'::jsonb then
    raise exception 'AR1 FAIL: agent suspendat trebuie să nu apară, nu %', v;
  end if;
  raise notice 'AR1 OK: lista albă, contact doar cu consimțământ, fără agent / terminal / suspendat = has_agent:false';
end $$;

-- ═══════ AR2: gate ═══════════════════════════════════════════════════════════
do $$
declare
  v        jsonb;
  v_who    uuid;
  v_state  text;
  v_msg    text;
  v_msg_x  text;
begin
  -- Străin, waiter și restaurant inexistent: ACELAȘI 42501 / același mesaj.
  foreach v_who in array array[
    'a3000000-0000-4000-8000-0000000000d1'::uuid,   -- străin
    'a3000000-0000-4000-8000-0000000000c2'::uuid,   -- waiter pe R5
    'a3000000-0000-4000-8000-0000000000a1'::uuid,   -- agentul însuși
    'a3000000-0000-4000-8000-0000000000b2'::uuid    -- owner ALTUI restaurant
  ] loop
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', v_who::text, true);
    begin
      v := public.get_my_agent('a3100000-0000-4000-8000-000000000005');
      v_state := null;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    end;
    perform set_config('role', 'none', true);
    if v_state is distinct from '42501' or v_msg is distinct from 'Acces interzis' then
      raise exception 'AR2 FAIL: % a primit (%, %) în loc de 42501 / Acces interzis', v_who, v_state, v_msg;
    end if;
  end loop;

  -- Restaurant inexistent: același răspuns ca la străin (zero oracol de existență).
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000d1', true);
  begin
    v := public.get_my_agent('a3100000-0000-4000-8000-0000000000ff');
    v_state := null;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg_x = message_text;
  end;
  perform set_config('role', 'none', true);
  if v_state is distinct from '42501' or v_msg_x is distinct from v_msg then
    raise exception 'AR2 FAIL: restaurantul inexistent se distinge de cel străin (%, %)', v_state, v_msg_x;
  end if;

  -- NULL → același refuz.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000b5', true);
  begin
    v := public.get_my_agent(null);
    v_state := null;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  perform set_config('role', 'none', true);
  if v_state is distinct from '42501' then
    raise exception 'AR2 FAIL: get_my_agent(null) nu a fost respins (%)', v_state;
  end if;

  -- Anon: nu are EXECUTE (apel REAL, nu doar catalog).
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    v := public.get_my_agent('a3100000-0000-4000-8000-000000000001');
    v_state := null;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;
  perform set_config('role', 'none', true);
  if v_state is distinct from '42501' or v_msg not like '%for function%' then
    raise exception 'AR2 FAIL: anon a executat get_my_agent sau a primit altă eroare (%, %)', v_state, v_msg;
  end if;

  -- Managerul (is_admin) vede agentul, dar NU contactul (consimțământul e către
  -- patron), iar can_manage e false. contact_sharing e TRUE în acest moment.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000c1', true);
  v := public.get_my_agent('a3100000-0000-4000-8000-000000000005');
  perform set_config('role', 'none', true);
  if (v->>'has_agent')::boolean is not true
     or v->>'agent_name' is distinct from 'Agent Unu'
     or (v->>'can_manage')::boolean is not false
     or jsonb_typeof(v->'phone') is distinct from 'null'
     or jsonb_typeof(v->'email') is distinct from 'null' then
    raise exception 'AR2 FAIL: managerul vede contactul / poate administra: %', v;
  end if;

  -- Fondatorul (is_platform_admin) vede, dar nu administrează și nu primește contactul.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000f1', true);
  v := public.get_my_agent('a3100000-0000-4000-8000-000000000005');
  perform set_config('role', 'none', true);
  if (v->>'has_agent')::boolean is not true
     or (v->>'can_manage')::boolean is not false
     or jsonb_typeof(v->'phone') is distinct from 'null' then
    raise exception 'AR2 FAIL: fondatorul primește contact / can_manage: %', v;
  end if;

  -- Control POZITIV: ownerul R5 (enterprise) vede contactul și administrează.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000b5', true);
  v := public.get_my_agent('a3100000-0000-4000-8000-000000000005');
  perform set_config('role', 'none', true);
  if (v->>'can_manage')::boolean is not true or v->>'phone' is distinct from '0721000111' then
    raise exception 'AR2 FAIL (control +): ownerul R5 nu vede contactul: %', v;
  end if;
  raise notice 'AR2 OK: același 42501 pentru străin/waiter/agent/alt owner/inexistent/null; manager + fondator fără contact';
end $$;

-- ═══════ AR3: acordare PROACTIVĂ pe plan FREE ═════════════════════════════════
do $$
declare
  v       jsonb;
  v_n     int;
  v_ls    jsonb;
  v_ha    boolean;
  c_att   constant uuid := 'a3c00000-0000-4000-8000-000000000001';
  c_r1    constant uuid := 'a3100000-0000-4000-8000-000000000001';
begin
  -- Precondiții: free, fără acces, fără cerere.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000a1', true);
  v_ha := public.has_partner_access(c_r1);
  perform set_config('role', 'none', true);
  if v_ha then raise exception 'AR3 FAIL (precondiție): agentul are deja acces'; end if;
  if exists (select 1 from public.affiliate_attributions where id = c_att and partner_access_requested_at is not null) then
    raise exception 'AR3 FAIL (precondiție): există o cerere — testul trebuie să acorde FĂRĂ cerere';
  end if;

  -- Ownerul acordă fără cerere.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000b1', true);
  v := public.owner_grant_partner_access(c_att);
  perform set_config('role', 'none', true);
  if v is distinct from '{"ok": true, "state": "granted"}'::jsonb then
    raise exception 'AR3 FAIL: acordarea proactivă pe plan free a eșuat: %', v;
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000a1', true);
  v_ha := public.has_partner_access(c_r1);
  v_ls := public.list_partner_restaurants();
  perform set_config('role', 'none', true);
  if not v_ha then raise exception 'AR3 FAIL: după acordare agentul nu are has_partner_access'; end if;
  if jsonb_array_length(v_ls) <> 1 or v_ls->0->>'restaurant_id' is distinct from c_r1::text then
    raise exception 'AR3 FAIL: list_partner_restaurants nu oglindește acordarea: %', v_ls;
  end if;

  -- Cardul arată starea.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000b1', true);
  v := public.get_my_agent(c_r1);
  perform set_config('role', 'none', true);
  if v->>'access_state' is distinct from 'granted' then
    raise exception 'AR3 FAIL: get_my_agent nu arată granted: %', v;
  end if;

  -- Idempotent: a doua apăsare nu mai scrie în audit.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000b1', true);
  v := public.owner_grant_partner_access(c_att);
  perform set_config('role', 'none', true);
  select count(*) into v_n from public.platform_audit_log
   where action = 'owner_grant_partner_access' and restaurant_id = c_r1 and actor_kind = 'owner';
  if v->>'ok' is distinct from 'true' or v_n <> 1 then
    raise exception 'AR3 FAIL: re-apăsarea nu e idempotentă (% / % rânduri de audit)', v, v_n;
  end if;

  -- Revocabil: ownerul retrage (RPC-ul 286), agentul pierde accesul imediat.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000b1', true);
  v := public.revoke_partner_access(c_att);
  perform set_config('role', 'none', true);
  if v->>'ok' is distinct from 'true' then raise exception 'AR3 FAIL: revocarea a eșuat: %', v; end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000a1', true);
  v_ha := public.has_partner_access(c_r1);
  perform set_config('role', 'none', true);
  if v_ha then raise exception 'AR3 FAIL: după revocare agentul mai are acces'; end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000b1', true);
  v := public.get_my_agent(c_r1);
  perform set_config('role', 'none', true);
  if v->>'access_state' is distinct from 'revoked' then
    raise exception 'AR3 FAIL: după revocare starea trebuie să fie revoked: %', v;
  end if;

  -- Re-acordabil (patronul s-a răzgândit): revoked → granted, accesul revine.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000b1', true);
  v := public.owner_grant_partner_access(c_att);
  perform set_config('role', 'none', true);
  if v->>'ok' is distinct from 'true' then raise exception 'AR3 FAIL: re-acordarea a eșuat: %', v; end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000a1', true);
  v_ha := public.has_partner_access(c_r1);
  perform set_config('role', 'none', true);
  if not v_ha then raise exception 'AR3 FAIL: re-acordarea nu a readus accesul'; end if;
  if (select partner_access_revoked_at from public.affiliate_attributions where id = c_att) is not null then
    raise exception 'AR3 FAIL: re-acordarea nu a șters revocarea';
  end if;
  select count(*) into v_n from public.platform_audit_log
   where action = 'owner_grant_partner_access' and restaurant_id = c_r1;
  if v_n <> 2 then raise exception 'AR3 FAIL: așteptam 2 urme de audit (acordare + re-acordare), am %', v_n; end if;
  raise notice 'AR3 OK: acordare fără cerere pe free, idempotentă, revocabilă, re-acordabilă, cu audit';
end $$;

-- ═══════ AR4: cine NU poate acorda, ce nu se poate acorda ═════════════════════
do $$
declare
  v        jsonb;
  v_who    uuid;
  v_att    uuid;
  v_msg    text;
  v_state  text;
  v_n      int;
  v_status text;
begin
  -- Nu pot acorda: agentul, străinul, alt owner, managerul R5, fondatorul —
  -- pe atribuirea O5 (a3c…05), unde ownerul REAL e O5.
  foreach v_who in array array[
    'a3000000-0000-4000-8000-0000000000a1'::uuid,   -- agentul (nu-și acordă singur)
    'a3000000-0000-4000-8000-0000000000d1'::uuid,   -- străin
    'a3000000-0000-4000-8000-0000000000b2'::uuid,   -- owner ALTUI cont
    'a3000000-0000-4000-8000-0000000000c1'::uuid,   -- manager pe R5
    'a3000000-0000-4000-8000-0000000000f1'::uuid    -- fondator (consimțământul nu se pune în numele ownerului)
  ] loop
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', v_who::text, true);
    begin
      v := public.owner_grant_partner_access('a3c00000-0000-4000-8000-000000000005');
      v_msg := 'a trecut: ' || v::text;
    exception when others then
      v_msg := sqlerrm;
    end;
    perform set_config('role', 'none', true);
    if v_msg not like 'Acces interzis%' then
      raise exception 'AR4 FAIL: % a putut acorda sau a primit altă eroare (%)', v_who, v_msg;
    end if;
  end loop;
  if (select owner_consented_at from public.affiliate_attributions
       where id = 'a3c00000-0000-4000-8000-000000000005') is not null then
    raise exception 'AR4 FAIL: o acordare respinsă a lăsat totuși un consimțământ';
  end if;

  -- id NULL și id inexistent → același refuz (fără oracol).
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000b5', true);
  foreach v_att in array array[null::uuid, 'a3c00000-0000-4000-8000-0000000000ff'::uuid] loop
    begin
      v := public.owner_grant_partner_access(v_att);
      v_msg := 'a trecut: ' || v::text;
    exception when others then
      v_msg := sqlerrm;
    end;
    if v_msg not like 'Acces interzis%' then
      raise exception 'AR4 FAIL: id % nu a fost respins cu Acces interzis (%)', v_att, v_msg;
    end if;
  end loop;
  perform set_config('role', 'none', true);

  -- Atribuire TERMINALĂ: ownerul O3 e principalul, dar nu mai are ce acorda.
  foreach v_status in array array['canceled', 'refunded', 'expired'] loop
    update public.affiliate_attributions set status = v_status::public.attribution_status
     where id = 'a3c00000-0000-4000-8000-000000000003';
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000b3', true);
    v := public.owner_grant_partner_access('a3c00000-0000-4000-8000-000000000003');
    perform set_config('role', 'none', true);
    if v->>'ok' is distinct from 'false' or v->>'error' is distinct from 'Atribuirea nu mai este activă.' then
      raise exception 'AR4 FAIL: atribuirea % a fost acordată sau a primit alt mesaj: %', v_status, v;
    end if;
  end loop;
  if (select owner_consented_at from public.affiliate_attributions
       where id = 'a3c00000-0000-4000-8000-000000000003') is not null then
    raise exception 'AR4 FAIL: atribuire terminală cu consimțământ pus';
  end if;
  -- Control pozitiv: aceeași atribuire, readusă pe pending, se acordă.
  update public.affiliate_attributions set status = 'pending'
   where id = 'a3c00000-0000-4000-8000-000000000003';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000b3', true);
  v := public.owner_grant_partner_access('a3c00000-0000-4000-8000-000000000003');
  perform set_config('role', 'none', true);
  if v->>'ok' is distinct from 'true' then
    raise exception 'AR4 FAIL (control +): atribuirea pending nu se poate acorda: %', v;
  end if;
  update public.affiliate_attributions
     set status = 'canceled', owner_consented_at = null
   where id = 'a3c00000-0000-4000-8000-000000000003';

  -- Agent SUSPENDAT: butonul nu are voie să mintă (has_partner_access ar fi oricum fals).
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000b4', true);
  v := public.owner_grant_partner_access('a3c00000-0000-4000-8000-000000000004');
  perform set_config('role', 'none', true);
  if v->>'ok' is distinct from 'false' or v->>'error' is distinct from 'Agentul nu mai este activ.' then
    raise exception 'AR4 FAIL: agent suspendat acceptat sau mesaj greșit: %', v;
  end if;
  if (select owner_consented_at from public.affiliate_attributions
       where id = 'a3c00000-0000-4000-8000-000000000004') is not null then
    raise exception 'AR4 FAIL: consimțământ pus pe un agent suspendat';
  end if;

  -- Atribuire cu profilul ȘTERS (tombstone 295: referred NULL): NIMENI nu o poate
  -- acorda — `partner_consent_principal(NULL)` întoarce NULL, iar un `not NULL` ar
  -- fi lăsat verificarea să treacă.
  insert into public.affiliate_attributions (id, affiliate_id, referred_profile_id, status, source)
    values ('a3c00000-0000-4000-8000-000000000006', 'a3a00000-0000-4000-8000-0000000000a1',
            'a3000000-0000-4000-8000-0000000000b6', 'active', 'link');
  update public.affiliate_attributions
     set referred_profile_id = null, referred_erased_at = now()
   where id = 'a3c00000-0000-4000-8000-000000000006';
  foreach v_who in array array[
    'a3000000-0000-4000-8000-0000000000b6'::uuid,
    'a3000000-0000-4000-8000-0000000000b5'::uuid,
    'a3000000-0000-4000-8000-0000000000a1'::uuid
  ] loop
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', v_who::text, true);
    begin
      v := public.owner_grant_partner_access('a3c00000-0000-4000-8000-000000000006');
      v_msg := 'a trecut: ' || v::text;
    exception when others then
      v_msg := sqlerrm;
    end;
    perform set_config('role', 'none', true);
    if v_msg not like 'Acces interzis%' then
      raise exception 'AR4 FAIL: atribuirea cu profil șters a fost acordată de % (%)', v_who, v_msg;
    end if;
  end loop;
  if (select owner_consented_at from public.affiliate_attributions
       where id = 'a3c00000-0000-4000-8000-000000000006') is not null then
    raise exception 'AR4 FAIL: tombstone cu consimțământ';
  end if;

  -- Anon: nu are EXECUTE (apel REAL).
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    v := public.owner_grant_partner_access('a3c00000-0000-4000-8000-000000000001');
    v_state := null;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;
  perform set_config('role', 'none', true);
  if v_state is distinct from '42501' or v_msg not like '%for function%' then
    raise exception 'AR4 FAIL: anon a executat owner_grant_partner_access (%, %)', v_state, v_msg;
  end if;
  raise notice 'AR4 OK: doar ownerul REAL acordă; terminal / suspendat / tombstone / anon respinse';
end $$;

-- ═══════ AR5: regula de aur — accesul pe free NU atinge banii, bonul, datele ═══
do $$
declare
  v_t      text;
  v_n      bigint;
  v_denied boolean;
  c_r1     constant uuid := 'a3100000-0000-4000-8000-000000000001';
  v_sens   text[] := array['orders', 'order_items', 'order_payments', 'reservations', 'oblio_configs',
                           'pending_receipts', 'invite_tokens', 'restaurant_memberships', 'invoices',
                           'bridge_devices', 'cash_shifts', 'ai_provider_configs'];
begin
  -- Precondiții: free + acces ACORDAT (de AR3).
  if (select plan from public.profiles where id = 'a3000000-0000-4000-8000-0000000000b1') <> 'free' then
    raise exception 'AR5 FAIL (precondiție): O1 nu mai e free';
  end if;
  if (select owner_consented_at from public.affiliate_attributions
       where id = 'a3c00000-0000-4000-8000-000000000001') is null then
    raise exception 'AR5 FAIL (precondiție): accesul nu e acordat';
  end if;

  -- Control POZITIV: ownerul vede rânduri în fiecare tabelă sensibilă care a primit seed
  -- (altfel „0 rânduri pentru agent” ar fi trivial adevărat).
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000b1', true);
  foreach v_t in array array['orders', 'order_items', 'order_payments', 'reservations', 'oblio_configs',
                             'pending_receipts', 'invite_tokens', 'restaurant_memberships'] loop
    execute format('select count(*) from public.%I', v_t) into v_n;
    if v_n = 0 then
      perform set_config('role', 'none', true);
      raise exception 'AR5 FAIL (control +): ownerul nu vede nimic în % — fixture vacuu', v_t;
    end if;
  end loop;
  perform set_config('role', 'none', true);

  -- Agentul: ZERO în TOATE tabelele sensibile (sau permission denied = tot zero).
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000a1', true);
  foreach v_t in array v_sens loop
    begin
      execute format('select count(*) from public.%I', v_t) into v_n;
    exception when insufficient_privilege then v_n := 0;
    end;
    if v_n <> 0 then
      perform set_config('role', 'none', true);
      raise exception 'AR5 FAIL: agentul cu acces pe FREE vede % rânduri în %', v_n, v_t;
    end if;
  end loop;

  -- Control POZITIV pentru agent: meniul + mesele ARE (RLS nu e un zid total).
  select count(*) into v_n from public.products where restaurant_id = c_r1;
  if v_n <> 2 then
    perform set_config('role', 'none', true);
    raise exception 'AR5 FAIL (control +): agentul vede % produse pe R1 (așteptam 2, inclusiv draftul)', v_n;
  end if;
  select count(*) into v_n from public.tables where restaurant_id = c_r1;
  if v_n <> 1 then
    perform set_config('role', 'none', true);
    raise exception 'AR5 FAIL (control +): agentul nu vede masa';
  end if;

  -- Scrierea pe bani/bon/setări: refuzată (eroare sau 0 rânduri).
  v_denied := false;
  begin
    insert into public.orders (restaurant_id, source, status) values (c_r1, 'waiter', 'new');
  exception when others then v_denied := true;
  end;
  if not v_denied then
    perform set_config('role', 'none', true);
    raise exception 'AR5 FAIL: agentul a putut insera o comandă';
  end if;
  v_denied := false;
  begin
    insert into public.pending_receipts (restaurant_id, order_id, payload, total_snapshot)
      values (c_r1, 'a3b00000-0000-4000-8000-000000000001', 'x', 1);
  exception when others then v_denied := true;
  end;
  if not v_denied then
    perform set_config('role', 'none', true);
    raise exception 'AR5 FAIL: agentul a putut insera un bon fiscal';
  end if;
  v_n := 0;
  begin
    update public.restaurants set name = 'Hack' where id = c_r1;
    get diagnostics v_n = row_count;
  exception when insufficient_privilege then v_n := 0;
  end;
  perform set_config('role', 'none', true);
  if v_n <> 0 or (select name from public.restaurants where id = c_r1) <> 'AR Unu' then
    raise exception 'AR5 FAIL: agentul a putut modifica setările restaurantului';
  end if;
  raise notice 'AR5 OK: pe plan FREE accesul acordat = meniu + mese; zero bani/bon/rezervări/secrete';
end $$;

-- ═══════ AR6: emailul către patron la cerere nouă ═════════════════════════════
do $$
declare
  v        jsonb;
  v_n      int;
  v_row    record;
  c_att    constant uuid := 'a3c00000-0000-4000-8000-000000000005';
begin
  delete from public.email_queue where template_kind = 'partner_access_requested';

  -- Agentul cere acces (sub rolul real) → UN email către PATRON.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000a1', true);
  v := public.request_partner_access(c_att);
  perform set_config('role', 'none', true);
  if v->>'ok' is distinct from 'true' or v->>'state' is distinct from 'requested' then
    raise exception 'AR6 FAIL: cererea nu a reușit: %', v;
  end if;
  select count(*) into v_n from public.email_queue where template_kind = 'partner_access_requested';
  if v_n <> 1 then raise exception 'AR6 FAIL: așteptam 1 email, am %', v_n; end if;
  select * into v_row from public.email_queue where template_kind = 'partner_access_requested';
  if v_row.recipient_email is distinct from 'ar-o5@ar303.test'
     or v_row.user_id is distinct from 'a3000000-0000-4000-8000-0000000000b5'::uuid then
    raise exception 'AR6 FAIL: emailul nu merge la PATRON (%/%)', v_row.recipient_email, v_row.user_id;
  end if;
  if v_row.template_data->>'agent_display_name' is distinct from 'Agent Unu'
     or v_row.template_data->>'restaurant_name' is distinct from 'AR Cinci'
     or v_row.template_data->>'owner_name' is distinct from 'Patron Cinci'
     or v_row.template_data->>'approve_url' is distinct from '/dashboard' then
    raise exception 'AR6 FAIL: template_data greșit: %', v_row.template_data;
  end if;
  -- Zero PII a agentului în email (contactul a fost bifat ca partajat, dar emailul
  -- anunță doar cererea).
  if v_row.template_data::text like '%0721000111%' or v_row.template_data::text like '%ar-agent1@%' then
    raise exception 'AR6 FAIL: contactul agentului a ajuns în emailul către patron: %', v_row.template_data;
  end if;
  if v_row.dedup_key is null or v_row.dedup_key not like 'partner_access_req:a3c00000-0000-4000-8000-000000000005:%' then
    raise exception 'AR6 FAIL: dedup_key neașteptat: %', v_row.dedup_key;
  end if;

  -- Re-intrare: a doua cerere cât prima e activă NU dublează.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000a1', true);
  v := public.request_partner_access(c_att);
  perform set_config('role', 'none', true);
  select count(*) into v_n from public.email_queue where template_kind = 'partner_access_requested';
  if v_n <> 1 then raise exception 'AR6 FAIL: re-cererea a dublat emailul (%)', v_n; end if;
  -- Aceeași valoare re-scrisă (UPDATE care nu schimbă momentul) NU declanșează.
  update public.affiliate_attributions
     set partner_access_requested_at = partner_access_requested_at where id = c_att;
  select count(*) into v_n from public.email_queue where template_kind = 'partner_access_requested';
  if v_n <> 1 then raise exception 'AR6 FAIL: un UPDATE fără schimbare a retrimis emailul (%)', v_n; end if;

  -- Ownerul REFUZĂ (revocă cererea), agentul cere din nou → email NOU (alt moment).
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000b5', true);
  v := public.revoke_partner_access(c_att);
  perform set_config('role', 'none', true);
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000a1', true);
  v := public.request_partner_access(c_att);
  perform set_config('role', 'none', true);
  select count(*) into v_n from public.email_queue where template_kind = 'partner_access_requested';
  if v_n <> 2 then raise exception 'AR6 FAIL: o cerere nouă după revocare trebuie să trimită alt email (am %)', v_n; end if;

  -- Acordarea proactivă și aprobarea NU trimit emailuri către patron.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000b1', true);
  v := public.revoke_partner_access('a3c00000-0000-4000-8000-000000000001');
  v := public.owner_grant_partner_access('a3c00000-0000-4000-8000-000000000001');
  perform set_config('role', 'none', true);
  select count(*) into v_n from public.email_queue where template_kind = 'partner_access_requested';
  if v_n <> 2 then raise exception 'AR6 FAIL: acordarea proactivă a trimis email (%)', v_n; end if;

  -- EXCEPTION-WRAPPED: o capcană care aruncă pe INSERT-ul în coadă NU avortează cererea.
  create function public.ar_trap_email() returns trigger language plpgsql as $f$
  begin raise exception 'capcana ar_trap_email'; end $f$;
  create trigger ar_trap_email before insert on public.email_queue
    for each row execute function public.ar_trap_email();
  -- Cerere nouă: întâi revocare (O5), apoi agentul cere.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000b5', true);
  v := public.revoke_partner_access(c_att);
  perform set_config('role', 'none', true);
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000a1', true);
  v := public.request_partner_access(c_att);   -- NU are voie să arunce
  perform set_config('role', 'none', true);
  if v->>'ok' is distinct from 'true' or v->>'state' is distinct from 'requested' then
    raise exception 'AR6 FAIL: cererea a fost avortată de eșecul emailului: %', v;
  end if;
  if public.partner_access_state(
       (select partner_access_requested_at from public.affiliate_attributions where id = c_att),
       (select owner_consented_at from public.affiliate_attributions where id = c_att),
       (select partner_access_revoked_at from public.affiliate_attributions where id = c_att)) <> 'requested' then
    raise exception 'AR6 FAIL: cererea nu a rămas înregistrată după eșecul emailului';
  end if;
  select count(*) into v_n from public.email_queue where template_kind = 'partner_access_requested';
  if v_n <> 2 then raise exception 'AR6 FAIL: capcana trebuia să împiedice emailul (am %)', v_n; end if;
  drop trigger ar_trap_email on public.email_queue;
  drop function public.ar_trap_email();
  raise notice 'AR6 OK: email către patron la cerere nouă, dedup, fără PII, exception-wrapped';
end $$;

-- ═══════ AR7: catalog ═════════════════════════════════════════════════════════
do $$
declare
  v_fn   text;
  v_p    pg_proc%rowtype;
  v_def  text;
begin
  foreach v_fn in array array['public.get_my_agent(uuid)', 'public.owner_grant_partner_access(uuid)',
                              'public.trg_email_on_partner_access_requested()'] loop
    select * into v_p from pg_proc where oid = v_fn::regprocedure;
    if not v_p.prosecdef then raise exception 'AR7 FAIL: % nu e SECURITY DEFINER', v_fn; end if;
    if not exists (select 1 from unnest(coalesce(v_p.proconfig, '{}')) c where c = 'search_path=public, pg_temp') then
      raise exception 'AR7 FAIL: % fără search_path = public, pg_temp (%)', v_fn, v_p.proconfig;
    end if;
    -- PUBLIC fără EXECUTE (proacl NU e NULL: NULL = implicit PUBLIC).
    if v_p.proacl is null or exists (select 1 from aclexplode(v_p.proacl) a where a.grantee = 0) then
      raise exception 'AR7 FAIL: % are EXECUTE pentru PUBLIC / ACL implicit', v_fn;
    end if;
  end loop;
  if (select provolatile from pg_proc where oid = 'public.get_my_agent(uuid)'::regprocedure) <> 's' then
    raise exception 'AR7 FAIL: get_my_agent trebuie să fie STABLE';
  end if;

  foreach v_fn in array array['public.get_my_agent(uuid)', 'public.owner_grant_partner_access(uuid)'] loop
    if has_function_privilege('anon', v_fn::regprocedure, 'execute')
       or has_function_privilege('service_role', v_fn::regprocedure, 'execute')
       or not has_function_privilege('authenticated', v_fn::regprocedure, 'execute') then
      raise exception 'AR7 FAIL: grant-uri greșite pe % (doar authenticated)', v_fn;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.trg_email_on_partner_access_requested()'::regprocedure, 'execute')
     or has_function_privilege('authenticated', 'public.trg_email_on_partner_access_requested()'::regprocedure, 'execute')
     or has_function_privilege('service_role', 'public.trg_email_on_partner_access_requested()'::regprocedure, 'execute') then
    raise exception 'AR7 FAIL: funcția de trigger e executabilă de un rol client';
  end if;

  -- Trigger: AFTER ROW pe UPDATE, cu WHEN; funcția cu exception-wrapper.
  if not exists (
    select 1 from pg_trigger t
     where t.tgname = 'trg_email_partner_access_requested'
       and t.tgrelid = 'public.affiliate_attributions'::regclass
       and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 0 and (t.tgtype & 16) = 16
       and t.tgqual is not null and t.tgenabled = 'O'
  ) then
    raise exception 'AR7 FAIL: trigger-ul de email lipsește / alt tip / dezactivat';
  end if;
  v_def := pg_get_functiondef('public.trg_email_on_partner_access_requested()'::regprocedure);
  if v_def !~* 'when\s+others' then raise exception 'AR7 FAIL: trigger-ul nu mai e exception-wrapped'; end if;

  -- Lista albă: nicio coloană secretă în get_my_agent.
  v_def := pg_get_functiondef('public.get_my_agent(uuid)'::regprocedure);
  if v_def ~* '(referral_code|payout_profile|iban|stripe_|_bps|device_secret|api_secret|wifi_password|qr_token)' then
    raise exception 'AR7 FAIL: get_my_agent referă o coloană secretă';
  end if;
  if v_def !~ 'is_admin' or v_def !~ '42501' then
    raise exception 'AR7 FAIL: get_my_agent și-a pierdut gate-ul is_admin / 42501';
  end if;

  -- Funcțiile 286 NEATINSE: câte o singură semnătură (anti PGRST203), iar
  -- grant_partner_access cere în continuare o cerere (PO2(d)).
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'grant_partner_access') <> 1
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'request_partner_access') <> 1
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'revoke_partner_access') <> 1
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'get_my_agent') <> 1
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'owner_grant_partner_access') <> 1 then
    raise exception 'AR7 FAIL: semnătură dublă pe o funcție din suprafața de acces a agentului';
  end if;
  if pg_get_functiondef('public.grant_partner_access(uuid)'::regprocedure) !~ 'partner_access_requested_at is null' then
    raise exception 'AR7 FAIL: grant_partner_access nu mai cere cererea agentului (a fost modificată?)';
  end if;
  raise notice 'AR7 OK: DEFINER + search_path, grant-uri doar authenticated, trigger fără EXECUTE, 286 neatinsă';
end $$;

-- ═══════ AR8: cerere → aprobare, pe ambele căi ═══════════════════════════════
do $$
declare
  v      jsonb;
  c_att  constant uuid := 'a3c00000-0000-4000-8000-000000000005';
  c_r5   constant uuid := 'a3100000-0000-4000-8000-000000000005';
begin
  -- Starea curentă (din AR6): cerere activă. Cardul o arată.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000b5', true);
  v := public.get_my_agent(c_r5);
  perform set_config('role', 'none', true);
  if v->>'access_state' is distinct from 'requested' then
    raise exception 'AR8 FAIL: cardul nu arată cererea agentului: %', v;
  end if;

  -- Ownerul apasă „Permite” chiar cât cererea e în așteptare → granted.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000b5', true);
  v := public.owner_grant_partner_access(c_att);
  perform set_config('role', 'none', true);
  if v->>'ok' is distinct from 'true' then raise exception 'AR8 FAIL: owner_grant peste cerere a eșuat: %', v; end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000b5', true);
  v := public.get_my_agent(c_r5);
  perform set_config('role', 'none', true);
  if v->>'access_state' is distinct from 'granted' then
    raise exception 'AR8 FAIL: starea nu a trecut în granted: %', v;
  end if;

  -- Calea veche (aprobare a cererii cu grant_partner_access) rămâne funcțională:
  -- revocă → agentul cere → ownerul aprobă cu RPC-ul 286.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000b5', true);
  v := public.revoke_partner_access(c_att);
  perform set_config('role', 'none', true);
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000a1', true);
  v := public.request_partner_access(c_att);
  perform set_config('role', 'none', true);
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000b5', true);
  v := public.grant_partner_access(c_att);
  perform set_config('role', 'none', true);
  if v->>'ok' is distinct from 'true' then raise exception 'AR8 FAIL: aprobarea veche (286) nu mai merge: %', v; end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-0000000000a1', true);
  if not public.has_partner_access(c_r5) then
    perform set_config('role', 'none', true);
    raise exception 'AR8 FAIL: după aprobarea 286 agentul nu are acces';
  end if;
  perform set_config('role', 'none', true);
  raise notice 'AR8 OK: requested → granted pe ambele căi';
end $$;

rollback;
