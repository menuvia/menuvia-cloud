-- tests/sql/auto/307_audit_actor_erasure.sql
-- =============================================================================
-- Mig 307: jurnalul acțiunilor de platformă (`platform_audit_log`) și tura de
-- casă (`cash_shifts.opened_by`) NU mai blochează ștergerea GDPR a contului.
-- Rulează din tests/sql/auto/ (scripts/run-sql-auto.sh) pe AMBELE medii (Postgres
-- gol din sql-verify + stack-ul Supabase din E2E). Autonom, ROLLBACK la final.
--
-- Scrierile în jurnal se fac pe calea REALĂ, SUB rolul `authenticated` (ca
-- postgres EXECUTE și RLS sunt ocolite); ștergerea pe calea REALĂ,
-- `process_account_deletions()` (lanț 042→179→183→282→284→295), cum o rulează
-- pg_cron. Verificările de stare se fac înapoi ca postgres.
--
--   AE1  un OWNER (plan free) care i-a dat acces agentului
--        (`owner_grant_partner_access`, 303) și AGENTUL care a intrat pe contul
--        lui (`log_partner_visit`, 187) se ȘTERG; rândurile lor de jurnal RĂMÂN,
--        cu actor NULL + `actor_erased_at`, acțiunea/detaliile neatinse; rândul
--        FONDATORULUI despre același restaurant rămâne cu actorul viu
--   AE2  un owner (Plan 3) care și-a deschis o tură, a servit EL o comandă
--        (`created_by = served_by` = el — dublul SET NULL) și are o factură EMISĂ,
--        și un MANAGER care a deschis o tură pe restaurantul altcuiva, se ȘTERG;
--        tura managerului rămâne cu `opened_by` NULL; factura e arhivată (179) —
--        și proba COMPORTAMENTALĂ a intrării `cascade_order` din registrul AE6
--   AE3  cititorul fondatorului (`admin_list_audit_log`) nu pică și nu PIERDE
--        rânduri pe actor NULL (LEFT JOIN): „cont șters", fără email; gate păstrat
--   AE4  garda din DATE: actorul se golește DOAR prin ștergerea profilului;
--        golire cu profil viu / schimbare / re-legare / tombstone rescris /
--        INSERT fără actor / rând „șters" fabricat → respinse (control pozitiv)
--   AE5  catalogul: formă, trigger (tgtype + tgattr), DEFINER + pg_temp,
--        neapelabil din afară, LEFT JOIN, cash_shifts.opened_by nullable
--   AE6  CLICHET DE CLASĂ: orice FK care oprește cascada `delete from
--        auth.users` (RESTRICT / NO ACTION, sau SET NULL/DEFAULT pe coloană NOT
--        NULL) spre o tabelă din închiderea cascadei e într-un registru CU MOTIV
--        (detașat de process_account_deletions / ordine dovedită / rezidual
--        deschis) — altfel CI roșu. Intrările moarte pică și ele. Câte un canar
--        pentru fiecare dintre cele trei forme + unul inofensiv (detectorul nu e
--        nici orb, nici prea larg).
--   AE7  CLICHET DE CLASĂ pe „dublu SET NULL": un rând cu ≥2 FK-uri SET NULL spre
--        user e rescris de două ori în cascadă, iar a doua rescriere re-verifică
--        TOATE FK-urile lui; niciun alt FK al unui astfel de rând nu are voie să
--        țintească o tabelă pe care cascada din `auth.users` o golește la nivelul
--        acelei verificări (restaurantele sunt șterse ÎNAINTE de
--        process_account_deletions — verificat structural). Canar care pică +
--        canar care trece, ambele validate cu rânduri comise.
--
-- ⚠️ CE NU POATE ARĂTA o suită într-o singură tranzacție: pe un rând SCRIS în
-- tranzacția curentă, Postgres re-verifică FK-urile la ORICE rescriere (nu doar
-- la a doua), deci aici și un singur SET NULL ar pica fără fix — testul e mai
-- STRICT decât producția, nu mai slab. Diferența „un FK trece / două FK-uri
-- pică" se vede doar pe rânduri COMISE; e consemnată cu probă în antetul mig 307.
--
-- Capcană de mediu: pe stack-ul E2E `auth.users` are index unic pe email →
-- domeniu propriu `@ae307.test`.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Fixtură ──────────────────────────────────────────────────────────────────
-- F fondator · A1 agent activ · O1 owner FREE (R1, atribuit A1) ·
-- O2 owner enterprise (R2: tură + factură emisă) · O3 owner enterprise (R3) ·
-- M manager pe R3 (deschide o tură acolo)
insert into auth.users (id, email) values
  ('ae000000-0000-4000-8000-0000000000f1', 'ae-founder@ae307.test'),
  ('ae000000-0000-4000-8000-0000000000a1', 'ae-agent@ae307.test'),
  ('ae000000-0000-4000-8000-0000000000b1', 'ae-o1@ae307.test'),
  ('ae000000-0000-4000-8000-0000000000b2', 'ae-o2@ae307.test'),
  ('ae000000-0000-4000-8000-0000000000b3', 'ae-o3@ae307.test'),
  ('ae000000-0000-4000-8000-0000000000c1', 'ae-manager@ae307.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email)
  select id, email from auth.users where email like 'ae-%@ae307.test'
  on conflict (id) do nothing;

update public.profiles set is_platform_admin = true
 where id = 'ae000000-0000-4000-8000-0000000000f1';
update public.profiles set plan = 'enterprise'
 where id in ('ae000000-0000-4000-8000-0000000000b2', 'ae000000-0000-4000-8000-0000000000b3');

insert into public.affiliates (id, profile_id, referral_code, status) values
  ('aea00000-0000-4000-8000-0000000000a1', 'ae000000-0000-4000-8000-0000000000a1', 'aeagnt307', 'active');

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('ae100000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-0000000000b1', 'AE Unu',  'ae-unu-307',  'Cluj', true),
  ('ae100000-0000-4000-8000-000000000002', 'ae000000-0000-4000-8000-0000000000b2', 'AE Doi',  'ae-doi-307',  'Cluj', true),
  ('ae100000-0000-4000-8000-000000000003', 'ae000000-0000-4000-8000-0000000000b3', 'AE Trei', 'ae-trei-307', 'Cluj', true);
insert into public.restaurant_memberships (restaurant_id, user_id, role) values
  ('ae100000-0000-4000-8000-000000000003', 'ae000000-0000-4000-8000-0000000000c1', 'manager');

insert into public.affiliate_attributions (id, affiliate_id, referred_profile_id, status, source) values
  ('aec00000-0000-4000-8000-000000000001', 'aea00000-0000-4000-8000-0000000000a1',
   'ae000000-0000-4000-8000-0000000000b1', 'active', 'link');

-- Politica GDPR implicită (cea de pe producție), explicit — un rând lăsat de
-- altă suită pe `block` ar schimba ce testăm.
insert into public.gdpr_deletion_config (id, policy) values (true, 'archive_anonymize')
  on conflict (id) do update set policy = 'archive_anonymize';

-- Apel SUB rolul real `authenticated` ca p_uid; întoarce rezultatul jsonb.
create function pg_temp.ae_as(p_uid uuid, p_sql text) returns jsonb
language plpgsql as $$
declare v jsonb;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  execute 'select to_jsonb(' || p_sql || ')' into v;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
exception when others then
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
  raise;
end $$;

-- Rulează ștergerea GDPR pe calea reală pentru userii daţi (eligibili D+30) și
-- întoarce cei rămași în auth.users, cu eroarea REALĂ a cascadei pentru fiecare
-- (process_account_deletions o înghite în handler-ul per-user, mig 183).
create function pg_temp.ae_erase(p_ids uuid[]) returns text
language plpgsql as $$
declare
  v_id   uuid;
  v_left text := '';
  v_err  text;
begin
  update public.profiles
     set deletion_requested_at = now() - interval '45 days', deletion_blocked_reason = null
   where id = any (p_ids);
  perform count(*) from public.process_account_deletions();
  foreach v_id in array p_ids loop
    if exists (select 1 from auth.users where id = v_id) then
      -- Diagnostic (verdictul e deja dat de process_account_deletions): aceeași
      -- coadă ca pe calea reală — detașarea afilierii (295), apoi contul — într-o
      -- subtranzacție derulată, ca mesajul să numească FK-ul REAL care oprește.
      begin
        perform public.erase_affiliate_identity_for_user(v_id);
        delete from auth.users where id = v_id;
        v_err := 'process_account_deletions l-a sărit, dar delete direct a mers';
        raise exception 'ae_rollback_probe';
      exception when others then
        if sqlerrm <> 'ae_rollback_probe' then v_err := sqlerrm; end if;
      end;
      v_left := v_left || format(' [%s: %s]', v_id, v_err);
    end if;
  end loop;
  return nullif(v_left, '');
end $$;

-- ── AE1: owner + agent care au scris în jurnal se ȘTERG; rândurile rămân ────
do $$
declare
  F  constant uuid := 'ae000000-0000-4000-8000-0000000000f1';
  A1 constant uuid := 'ae000000-0000-4000-8000-0000000000a1';
  O1 constant uuid := 'ae000000-0000-4000-8000-0000000000b1';
  R1 constant uuid := 'ae100000-0000-4000-8000-000000000001';
  v       jsonb;
  v_left  text;
  v_row   record;
begin
  -- Scrierile REALE: owner-ul pe plan free acordă accesul (303), agentul intră
  -- pe cont (187), fondatorul acționează pe același restaurant (186).
  if (select plan from public.profiles where id = O1) is distinct from 'free' then
    raise exception 'AE1 FAIL (precondiție): O1 trebuie să fie pe plan free'; end if;
  v := pg_temp.ae_as(O1, $q$public.owner_grant_partner_access('aec00000-0000-4000-8000-000000000001')$q$);
  if (v->>'ok')::boolean is not true then raise exception 'AE1 FAIL (fixtură): owner_grant → %', v; end if;
  v := pg_temp.ae_as(A1, format('public.log_partner_visit(%L)', R1));
  if (v->>'ok')::boolean is not true then raise exception 'AE1 FAIL (fixtură): log_partner_visit → %', v; end if;
  v := pg_temp.ae_as(F, format('public.admin_toggle_restaurant_active(%L, true)', R1));
  if (v->>'ok')::boolean is not true then raise exception 'AE1 FAIL (fixtură): admin_toggle → %', v; end if;

  -- Control POZITIV: cele trei rânduri există, cu actorii vii. (Nicio coloană
  -- nouă din 307 până după ștergere: pe codul vechi testul trebuie să pice pe
  -- COMPORTAMENT — contul neștergibil — nu pe o coloană lipsă.)
  if (select count(*) from public.platform_audit_log
       where (actor_user_id, action) in ((O1, 'owner_grant_partner_access'),
                                         (A1, 'enter_account'),
                                         (F,  'toggle_active'))
         and restaurant_id = R1) <> 3 then
    raise exception 'AE1 FAIL (control +): rândurile de jurnal nu s-au scris pe calea reală'; end if;

  -- Ștergerea REALĂ. Pe codul vechi (FK RESTRICT, NOT NULL) amândoi rămân.
  v_left := pg_temp.ae_erase(array[O1, A1]);
  if v_left is not null then
    raise exception 'AE1 FAIL: conturile care au scris în platform_audit_log NU s-au putut șterge (Art. 17):%', v_left;
  end if;
  if exists (select 1 from public.profiles where id in (O1, A1)) then
    raise exception 'AE1 FAIL: profilurile au rămas după ștergere'; end if;

  -- Rândurile owner-ului și agentului: RĂMÂN, fără legătură, cu tombstone.
  for v_row in
    select * from public.platform_audit_log
     where action in ('owner_grant_partner_access', 'enter_account')
       and actor_kind in ('owner', 'affiliate')
       and created_at = now()
  loop
    if v_row.actor_user_id is not null or v_row.actor_erased_at is null then
      raise exception 'AE1 FAIL: rândul % (%) n-a fost detașat corect: actor=%, erased_at=%',
        v_row.id, v_row.action, v_row.actor_user_id, v_row.actor_erased_at; end if;
    if v_row.restaurant_id is not null then
      raise exception 'AE1 FAIL: restaurantul șters a rămas referit în rândul %', v_row.id; end if;
  end loop;
  -- Exact cele două rânduri, cu acțiunea și detaliile NEATINSE.
  if (select count(*) from public.platform_audit_log
       where actor_user_id is null and actor_erased_at is not null and created_at = now()
         and ((actor_kind = 'owner' and action = 'owner_grant_partner_access'
               and details = '{"attribution_id": "aec00000-0000-4000-8000-000000000001"}'::jsonb)
           or (actor_kind = 'affiliate' and action = 'enter_account' and details = '{}'::jsonb))) <> 2 then
    raise exception 'AE1 FAIL: rândurile de jurnal ale conturilor șterse au DISPĂRUT sau s-au schimbat'; end if;

  -- Rândul fondatorului: actorul VIU rămâne, restaurantul (cascadat) → NULL.
  select * into v_row from public.platform_audit_log
   where action = 'toggle_active' and actor_user_id = F and created_at = now();
  if not found or v_row.actor_erased_at is not null or v_row.restaurant_id is not null then
    raise exception 'AE1 FAIL: rândul fondatorului a fost atins greșit (%)', to_jsonb(v_row); end if;

  raise notice 'AE1 OK: owner-ul (free) și agentul care au scris în jurnal se șterg pe calea reală; rândurile rămân cu actor NULL + actor_erased_at; fondatorul neatins';
end $$;

-- ── AE2: tura de casă (owner + manager) și factura emisă nu blochează ───────
do $$
declare
  O2 constant uuid := 'ae000000-0000-4000-8000-0000000000b2';
  M  constant uuid := 'ae000000-0000-4000-8000-0000000000c1';
  R2 constant uuid := 'ae100000-0000-4000-8000-000000000002';
  R3 constant uuid := 'ae100000-0000-4000-8000-000000000003';
  v_s2    uuid;
  v_s3    uuid;
  v_inv   uuid;
  v_left  text;
begin
  -- Ture deschise pe calea REALĂ (open_shift, gate shifts = Plan 3).
  v_s2 := (pg_temp.ae_as(O2, format('public.open_shift(%L, 100)', R2)) #>> '{}')::uuid;
  v_s3 := (pg_temp.ae_as(M,  format('public.open_shift(%L, 50)',  R3)) #>> '{}')::uuid;
  if (select opened_by from public.cash_shifts where id = v_s2) is distinct from O2
     or (select opened_by from public.cash_shifts where id = v_s3) is distinct from M then
    raise exception 'AE2 FAIL (control +): turele nu poartă cine le-a deschis'; end if;

  -- Patronul și-a ÎNCHIS el tura și a luat + servit el comanda: dublul SET NULL
  -- spre același user pe ambele rânduri (forma care bloca pe producție).
  update public.cash_shifts set closed_by = O2 where id = v_s2;

  -- Factură EMISĂ pe R2: `invoices.order_id → orders` e RESTRICT, ambele în
  -- cascada owner-ului (intrarea `cascade_order` din registrul AE6).
  insert into public.orders (id, restaurant_id, source, status, total, created_by, served_by)
  values ('ae200000-0000-4000-8000-000000000002', R2, 'waiter', 'served', 100.00, O2, O2);
  insert into public.invoices (restaurant_id, order_id, customer_name, total_with_vat, status, issued_at)
  values (R2, 'ae200000-0000-4000-8000-000000000002', 'Client AE', 100.00, 'issued', now())
  returning id into v_inv;

  v_left := pg_temp.ae_erase(array[O2, M]);
  if v_left is not null then
    raise exception 'AE2 FAIL: conturile cu tură de casă / comandă servită de patron / factură emisă NU s-au putut șterge (Art. 17):%', v_left;
  end if;

  -- Tura managerului pe restaurantul ALTCUIVA rămâne, fără atribuire.
  if not exists (select 1 from public.cash_shifts
                  where id = v_s3 and opened_by is null and status = 'open' and restaurant_id = R3) then
    raise exception 'AE2 FAIL: tura managerului șters a dispărut sau n-a pierdut atribuirea'; end if;
  -- Tura owner-ului a plecat cu restaurantul; factura e arhivată fiscal (179).
  if exists (select 1 from public.cash_shifts where id = v_s2)
     or exists (select 1 from public.restaurants where id = R2) then
    raise exception 'AE2 FAIL: restaurantul owner-ului șters a rămas'; end if;
  if not exists (select 1 from public.retained_invoices where original_invoice_id = v_inv) then
    raise exception 'AE2 FAIL: factura emisă n-a fost arhivată înaintea cascadei'; end if;

  raise notice 'AE2 OK: owner-ul cu tură deschisă+închisă de el, comandă servită de el și factură emisă, și managerul cu tură pe alt restaurant se șterg; tura managerului rămâne cu opened_by NULL; factura e arhivată';
end $$;

-- ── AE3: cititorul fondatorului — nu pică, nu pierde rânduri ───────────────
do $$
declare
  F  constant uuid := 'ae000000-0000-4000-8000-0000000000f1';
  v      jsonb;
  v_e    jsonb;
  v_n    int;
  v_err  text;
begin
  v := pg_temp.ae_as(F, 'public.admin_list_audit_log(500)');
  select least(count(*), 500) into v_n from public.platform_audit_log;
  if jsonb_array_length(v) <> v_n then
    raise exception 'AE3 FAIL: admin_list_audit_log întoarce % rânduri, tabela are % — rândurile actorilor șterși dispar (INNER JOIN)',
      jsonb_array_length(v), v_n; end if;

  -- Rândul owner-ului șters: prezent, „cont șters", fără email.
  select e into v_e from jsonb_array_elements(v) e
   where e->>'action' = 'owner_grant_partner_access'
     and e->'details'->>'attribution_id' = 'aec00000-0000-4000-8000-000000000001';
  if v_e is null
     or jsonb_typeof(v_e->'actor_email') is distinct from 'null'
     or (v_e->>'actor_erased')::boolean is not true
     or v_e->>'actor_erased_at' is null
     or v_e->>'actor_kind' is distinct from 'owner' then
    raise exception 'AE3 FAIL: rândul actorului șters lipsește sau are altă formă: %', v_e; end if;
  -- Rândul fondatorului: actor viu, cu email.
  select e into v_e from jsonb_array_elements(v) e
   where e->>'action' = 'toggle_active' and e->>'actor_email' = 'ae-founder@ae307.test';
  if v_e is null or (v_e->>'actor_erased')::boolean is not false
     or v_e->'actor_erased_at' is distinct from 'null'::jsonb then
    raise exception 'AE3 FAIL: rândul fondatorului (actor viu) are altă formă: %', v_e; end if;
  -- Nicio urmă a identității conturilor șterse în răspuns.
  if v::text like '%ae-o1@ae307.test%' or v::text like '%ae-agent@ae307.test%' then
    raise exception 'AE3 FAIL: emailul unui cont șters apare în jurnalul fondatorului'; end if;

  -- Gate-ul a rămas: un non-fondator (O3) e respins.
  begin
    perform pg_temp.ae_as('ae000000-0000-4000-8000-0000000000b3', 'public.admin_list_audit_log(10)');
    v_err := 'trecut';
  exception when others then v_err := sqlerrm;
  end;
  if v_err is distinct from 'Acces interzis' then
    raise exception 'AE3 FAIL: admin_list_audit_log a pierdut gate-ul is_platform_admin (%)', v_err; end if;

  raise notice 'AE3 OK: admin_list_audit_log întoarce TOATE rândurile; actorul șters = „cont șters" fără email; gate-ul e păstrat';
end $$;

-- ── AE4: garda din DATE pe coloanele actorului ─────────────────────────────
create function pg_temp.ae_hint(p_sql text) returns text
language plpgsql as $$
declare v_hint text;
begin
  execute p_sql;
  return 'TRECUT';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return coalesce(nullif(v_hint, ''), 'fara-hint: ' || sqlerrm);
end $$;

do $$
declare
  F  constant uuid := 'ae000000-0000-4000-8000-0000000000f1';
  O3 constant uuid := 'ae000000-0000-4000-8000-0000000000b3';
  v_live   uuid;
  v_erased uuid;
  v_h      text;
begin
  select id into v_live from public.platform_audit_log
   where actor_user_id = F and action = 'toggle_active' and created_at = now() limit 1;
  select id into v_erased from public.platform_audit_log
   where actor_user_id is null and action = 'owner_grant_partner_access' and created_at = now() limit 1;
  if v_live is null or v_erased is null then
    raise exception 'AE4 FAIL (precondiție): lipsesc rândurile din AE1'; end if;

  -- (a) golire cu profilul VIU — fie și ca postgres/service_role (ocolesc RLS)
  v_h := pg_temp.ae_hint(format('update public.platform_audit_log set actor_user_id = null where id = %L', v_live));
  if v_h <> 'audit_actor_immutable' then raise exception 'AE4 FAIL (a) golire cu profil viu: %', v_h; end if;
  -- (b) schimbarea actorului
  v_h := pg_temp.ae_hint(format('update public.platform_audit_log set actor_user_id = %L where id = %L', O3, v_live));
  if v_h <> 'audit_actor_immutable' then raise exception 'AE4 FAIL (b) schimbarea actorului: %', v_h; end if;
  -- (c) re-legarea unui rând șters
  v_h := pg_temp.ae_hint(format('update public.platform_audit_log set actor_user_id = %L where id = %L', F, v_erased));
  if v_h <> 'audit_actor_immutable' then raise exception 'AE4 FAIL (c) re-legare: %', v_h; end if;
  -- (d) rescrierea tombstone-ului
  v_h := pg_temp.ae_hint(format('update public.platform_audit_log set actor_erased_at = now() - interval ''1 day'' where id = %L', v_erased));
  if v_h <> 'audit_actor_immutable' then raise exception 'AE4 FAIL (d) tombstone rescris: %', v_h; end if;
  -- (e) INSERT fără actor: log_platform_action fără JWT (garanția vechiului NOT NULL)
  perform set_config('request.jwt.claim.sub', '', true);
  v_h := pg_temp.ae_hint($q$select public.log_platform_action('founder', null, 'ae_probe', '{}'::jsonb)$q$);
  if v_h <> 'audit_actor_required' then raise exception 'AE4 FAIL (e) INSERT fără actor: %', v_h; end if;
  -- (f) un rând „deja șters" fabricat
  v_h := pg_temp.ae_hint($q$insert into public.platform_audit_log (actor_user_id, actor_erased_at, action) values (null, now(), 'ae_forge')$q$);
  if v_h <> 'audit_actor_required' then raise exception 'AE4 FAIL (f) rând șters fabricat: %', v_h; end if;
  if exists (select 1 from public.platform_audit_log where action in ('ae_probe', 'ae_forge')) then
    raise exception 'AE4 FAIL: un rând fără actor a ajuns în jurnal'; end if;

  -- Control POZITIV: garda nu respinge tot — un INSERT cu actor și un UPDATE
  -- care nu atinge actorul trec, iar rândurile vizate sunt neschimbate.
  perform set_config('request.jwt.claim.sub', F::text, true);
  perform public.log_platform_action('founder', null, 'ae_probe_ok', '{}'::jsonb);
  perform set_config('request.jwt.claim.sub', '', true);
  if not exists (select 1 from public.platform_audit_log where action = 'ae_probe_ok' and actor_user_id = F) then
    raise exception 'AE4 FAIL (control +): INSERT-ul legitim a fost respins'; end if;
  update public.platform_audit_log set details = details || '{"ae": 1}'::jsonb where id = v_live;
  if (select actor_user_id from public.platform_audit_log where id = v_live) is distinct from F
     or (select actor_user_id from public.platform_audit_log where id = v_erased) is not null then
    raise exception 'AE4 FAIL (control +): rândurile vizate s-au schimbat'; end if;

  raise notice 'AE4 OK: actorul se golește DOAR prin ștergerea profilului; golire/schimbare/re-legare/tombstone/INSERT fără actor → respinse cu hint';
end $$;

-- ── AE5: catalogul ──────────────────────────────────────────────────────────
do $$
declare
  v_attrs text[];
  v_src   text;
  r       record;
begin
  if exists (select 1 from pg_attribute where attrelid = 'public.platform_audit_log'::regclass
              and attname = 'actor_user_id' and attnotnull) then
    raise exception 'AE5 FAIL: platform_audit_log.actor_user_id e NOT NULL'; end if;
  if (select count(*) from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
       where c.conrelid = 'public.platform_audit_log'::regclass and c.contype = 'f'
         and a.attname = 'actor_user_id'
         and c.confrelid = 'public.profiles'::regclass and c.confdeltype = 'n') <> 1
     or (select count(*) from pg_constraint c
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
          where c.conrelid = 'public.platform_audit_log'::regclass and c.contype = 'f'
            and a.attname = 'actor_user_id') <> 1 then
    raise exception 'AE5 FAIL: FK-ul actorului nu e EXACT unul, spre profiles, ON DELETE SET NULL'; end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.platform_audit_log'::regclass
                    and conname = 'platform_audit_log_actor_or_erased' and convalidated
                    and pg_get_constraintdef(oid) ilike '%actor_user_id IS NULL%actor_erased_at IS NOT NULL%') then
    raise exception 'AE5 FAIL: lipsește CHECK-ul bicondițional actor/tombstone'; end if;

  -- tgtype 23 = ROW | BEFORE | INSERT | UPDATE; lista UPDATE OF = ambele coloane
  -- (un `update of details` ar lăsa golirea actorului NEpăzită).
  select array_agg(a.attname::text order by a.attname collate "C") into v_attrs
    from pg_trigger t
    join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = any (t.tgattr::int2[])
   where t.tgrelid = 'public.platform_audit_log'::regclass
     and t.tgname = 'trg_platform_audit_log_actor_guard';
  if not exists (select 1 from pg_trigger where tgrelid = 'public.platform_audit_log'::regclass
                  and tgname = 'trg_platform_audit_log_actor_guard' and tgtype = 23 and tgenabled = 'O')
     or v_attrs is distinct from array['actor_erased_at', 'actor_user_id'] then
    raise exception 'AE5 FAIL: trigger-ul de gardă lipsește / altă formă (coloane %)', v_attrs; end if;

  -- DEFINER deliberat: sub RLS-ul unui apelant, „profilul nu mai există" ar fi
  -- adevărat pentru ORICE profil străin, deci golirea ar trece (clasa 278).
  if not exists (select 1 from pg_proc where oid = 'public.platform_audit_log_actor_guard()'::regprocedure
                  and prosecdef and proconfig @> array['search_path=public, pg_temp']) then
    raise exception 'AE5 FAIL: funcția de gardă nu e DEFINER cu search_path public, pg_temp'; end if;
  for r in select unnest(array['anon', 'authenticated', 'service_role']) as rol loop
    if has_function_privilege(r.rol, 'public.platform_audit_log_actor_guard()', 'EXECUTE') then
      raise exception 'AE5 FAIL: % poate executa funcția de trigger prin /rpc', r.rol; end if;
  end loop;

  select prosrc into v_src from pg_proc where oid = 'public.admin_list_audit_log(integer)'::regprocedure;
  if v_src ~* '(^|[^t])\s+join\s+public\.profiles\s+p\s+on\s+p\.id\s*=\s*l\.actor_user_id'
     or position('left join public.profiles p on p.id = l.actor_user_id' in v_src) = 0 then
    raise exception 'AE5 FAIL: admin_list_audit_log nu face LEFT JOIN pe profiles'; end if;
  if has_function_privilege('anon', 'public.admin_list_audit_log(integer)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.admin_list_audit_log(integer)', 'EXECUTE') then
    raise exception 'AE5 FAIL: suprafața admin_list_audit_log s-a schimbat'; end if;

  if exists (select 1 from pg_attribute where attrelid = 'public.cash_shifts'::regclass
              and attname = 'opened_by' and attnotnull) then
    raise exception 'AE5 FAIL: cash_shifts.opened_by e NOT NULL (ON DELETE SET NULL pe NOT NULL blochează ștergerea)'; end if;

  raise notice 'AE5 OK: formă, FK SET NULL, CHECK, trigger 23 pe ambele coloane, DEFINER + pg_temp, neapelabil, LEFT JOIN, opened_by nullable';
end $$;

-- ── AE6: CLICHET DE CLASĂ pe FK-urile care opresc cascada din auth.users ────
-- Închiderea = auth.users + orice tabelă din `public` atinsă prin lanțuri de
-- FK-uri ON DELETE CASCADE. Un FK spre o tabelă din închidere oprește ștergerea
-- unui cont dacă e RESTRICT / NO ACTION sau SET NULL / SET DEFAULT pe o coloană
-- NOT NULL. Fiecare astfel de FK e într-un registru CU MOTIV:
--   detach        — process_account_deletions golește legătura ÎNAINTEA ștergerii
--                   (verificat: funcția numită e chemată înainte de delete);
--   cascade_order — ambele tabele cascadează din același părinte, iar tabela care
--                   referă e ștearsă la o adâncime ≤ celei referite, deci coada RI
--                   (parcursă în lățime) o golește înaintea verificării RESTRICT;
--                   dovedit COMPORTAMENTAL în AE2;
--   open          — rezidual DESCHIS, consemnat (NOTICE la fiecare rulare).
-- O tabelă VIITOARE care adaugă un astfel de FK face CI roșu până primește o
-- decizie; o intrare care nu mai corespunde niciunui FK pică și ea.
create function pg_temp.ae_blocking_fks(p_schemas text[]) returns table (fk text)
language sql as $$
  with recursive closure(rel) as (
    select 'auth.users'::regclass::oid
    union
    select c.conrelid
      from pg_constraint c
      join closure cl on c.confrelid = cl.rel
      join pg_class k on k.oid = c.conrelid
      join pg_namespace n on n.oid = k.relnamespace
     where c.contype = 'f' and c.confdeltype = 'c' and n.nspname = any (p_schemas)
  )
  select format('%s(%s) -> %s.%s',
                k.relname,
                (select string_agg(a.attname, ',' order by x.ord)
                   from unnest(c.conkey) with ordinality x(attnum, ord)
                   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = x.attnum),
                pn.nspname, pk.relname)
    from pg_constraint c
    join pg_class k on k.oid = c.conrelid
    join pg_namespace n on n.oid = k.relnamespace
    join pg_class pk on pk.oid = c.confrelid
    join pg_namespace pn on pn.oid = pk.relnamespace
   where c.contype = 'f'
     and c.conparentid = 0
     and n.nspname = any (p_schemas)
     and c.confrelid in (select rel from closure)
     and (c.confdeltype in ('r', 'a')
          or (c.confdeltype in ('n', 'd')
              and exists (select 1 from pg_attribute a
                           where a.attrelid = c.conrelid and a.attnum = any (c.conkey) and a.attnotnull)))
$$;

do $$
declare
  v_reg    jsonb := jsonb_build_object(
    'affiliates(profile_id) -> public.profiles',
      jsonb_build_object('kind', 'detach', 'fn', 'erase_affiliate_identity_for_user',
        'why', 'mig 295: afiliatul devine closed cu PII golite ÎNAINTEA ștergerii; RESTRICT păstrat ca o ștergere pe altă cale să fie refuzată'),
    'affiliate_attributions(referred_profile_id) -> public.profiles',
      jsonb_build_object('kind', 'detach', 'fn', 'erase_affiliate_identity_for_user',
        'why', 'mig 295: atribuirea pierde referred_profile_id (tombstone) ÎNAINTEA ștergerii'),
    'invoices(order_id) -> public.orders',
      jsonb_build_object('kind', 'cascade_order',
        'why', 'în instrucțiunea care șterge restaurantele (307), restaurants → invoices și restaurants → orders sunt pe ACELAȘI nivel, iar verificarea RESTRICT generată de ștergerea comenzilor rulează la nivelul următor, după ce facturile au plecat — independent de OID-uri; facturile emise sunt arhivate de 179 înainte; dovedit în AE2'),
    'purchase_order_items(ingredient_id) -> public.ingredients',
      jsonb_build_object('kind', 'open',
        'why', 'REZIDUAL DESCHIS (mig 307): verificarea RESTRICT generată de restaurants → ingredients și cascada restaurants → purchase_orders → purchase_order_items cad pe ACELAȘI nivel, deci ordinea o decid OID-urile; pe replay verificarea vine prima și un owner cu NIR rămâne neștergibil. Reparația naivă ar ȘTERGE tăcut documente contabile (NIR) — decizie de fondator: arhivare ca 179/284 sau cascadă.')
  );
  v_found  text[];
  v_bad    text;
  v_stale  text;
  v_src    text;
  v_del    int;
  v_pos    int;
  v_k      text;
  v_canary text[];
begin
  select array_agg(fk order by fk collate "C") into v_found from pg_temp.ae_blocking_fks(array['public']);

  -- Anti-vacuitate: închiderea trebuie să cuprindă tabelele de tenant, altfel
  -- un detector stricat ar întoarce zero și registrul ar fi „curat" degeaba.
  if not exists (select 1 from pg_temp.ae_blocking_fks(array['public']) where fk like 'invoices(order_id)%')
     or array_length(v_found, 1) is null then
    raise exception 'AE6 FAIL (anti-vacuitate): detectorul nu mai vede nici măcar invoices(order_id) — închiderea cascadei e greșită'; end if;

  -- (1) Orice FK blocant NEînregistrat → roșu.
  select string_agg(f, '; ') into v_bad
    from unnest(v_found) f where not (v_reg ? f);
  if v_bad is not null then
    raise exception 'AE6 FAIL: FK-uri care opresc ștergerea GDPR a unui cont (cascada din auth.users), fără decizie: %. Fă coloana nullable cu ON DELETE SET NULL (ca platform_audit_log, mig 307), detașeaz-o în process_account_deletions, sau adaug-o în registrul AE6 CU MOTIV.', v_bad;
  end if;

  -- (2) Intrare moartă în registru → roșu (registrul nu are voie să se umfle).
  select string_agg(k, '; ') into v_stale
    from jsonb_object_keys(v_reg) k where not (k = any (v_found));
  if v_stale is not null then
    raise exception 'AE6 FAIL: intrări în registru care nu mai corespund niciunui FK blocant (șterge-le): %', v_stale; end if;

  -- (3) `detach`: funcția numită e chemată de process_account_deletions ÎNAINTEA ștergerii.
  select p.prosrc into v_src from pg_proc p where p.oid = 'public.process_account_deletions()'::regprocedure;
  v_del := position('delete from auth.users where id = v_user.id' in v_src);
  for v_k in select k from jsonb_object_keys(v_reg) k where v_reg->k->>'kind' = 'detach' loop
    v_pos := position(format('public.%s(v_user.id)', v_reg->v_k->>'fn') in v_src);
    if v_del = 0 or v_pos = 0 or v_pos > v_del then
      raise exception 'AE6 FAIL: % e marcat `detach`, dar % nu e chemată înaintea delete from auth.users', v_k, v_reg->v_k->>'fn'; end if;
  end loop;

  -- (4) `open`: reziduu VIZIBIL la fiecare rulare.
  for v_k in select k from jsonb_object_keys(v_reg) k where v_reg->k->>'kind' = 'open' loop
    raise notice 'AE6 REZIDUAL DESCHIS: % — %', v_k, v_reg->v_k->>'why';
  end loop;

  -- (5) Canare: detectorul prinde fiecare dintre cele trei forme. Stau în `public`
  -- (o tabelă temporară nu poate referi una permanentă) și dispar la ROLLBACK;
  -- sunt create DUPĂ (1)–(2), deci nu ating registrul. Plus un control NEGATIV:
  -- SET NULL pe coloană NULLABLE nu e blocant (forma reparată de 307).
  create table public.ae307_canary_restrict (u uuid references public.profiles(id) on delete restrict);
  create table public.ae307_canary_setnull  (u uuid not null references auth.users(id) on delete set null);
  create table public.ae307_canary_inner    (i uuid references public.ingredients(id));  -- NO ACTION
  create table public.ae307_canary_ok       (u uuid references auth.users(id) on delete set null);
  select array_agg(fk order by fk collate "C") into v_canary
    from pg_temp.ae_blocking_fks(array['public'])
   where fk like 'ae307_canary_%';
  if v_canary is distinct from array['ae307_canary_inner(i) -> public.ingredients',
                                     'ae307_canary_restrict(u) -> public.profiles',
                                     'ae307_canary_setnull(u) -> auth.users'] then
    raise exception 'AE6 FAIL (canar): detectorul e orb la o formă sau prinde una inofensivă: %', v_canary; end if;

  raise notice 'AE6 OK: % FK-uri blocante, toate în registru cu motiv; canarele (RESTRICT / SET NULL pe NOT NULL / NO ACTION în închidere) prinse', array_length(v_found, 1);
end $$;

-- ── AE7: CLICHET DE CLASĂ pe „dublu SET NULL" spre user ──────────────────────
-- Un rând cu ≥2 FK-uri SET NULL / SET DEFAULT spre user (auth.users / profiles)
-- e rescris de ≥2 ori de cascada din auth.users; a doua rescriere găsește o
-- versiune a tranzacției curente și re-verifică TOATE FK-urile rândului. Coada
-- de evenimente RI e parcursă pe NIVELURI (în lățime): o acțiune declanșată de
-- un părinte aflat la adâncimea d rulează la nivelul d+1. Cu L = nivelul celei
-- de-a doua rescrieri (1 pentru un FK spre auth.users, 2 pentru unul spre
-- profiles), verificarea forțată rulează la nivelul L+1. Un alt FK al rândului,
-- spre un părinte P de la adâncimea d(P), o face să pice dacă P e deja șters și
-- rândul încă există în acel moment:
--   d(P) = L+1  → P șters la același nivel cu verificarea, de un eveniment pus
--                 în coadă ÎNAINTEA ei; rândul pleacă abia la L+2 → 23503
--                 (forma patronilor: orders → restaurants, L=1, d=2);
--   d(P) = L    → depinde de ordinea OID-urilor (de obicei trece) — tot roșu,
--                 fiindcă pe alt mediu ordinea poate fi alta;
--   d(P) < L    → rândul pleacă înaintea verificării → inofensiv.
-- Validat cu rânduri COMISE pe replay: (auth, auth, push_subscriptions CASCADE)
-- pică cu 23503, (auth, profiles, restaurant_memberships CASCADE) trece.
-- Închiderea e cea a cascadei din auth.users FĂRĂ trecerea prin `restaurants`:
-- process_account_deletions șterge restaurantele owner-ului ÎNAINTE, într-o
-- instrucțiune proprie (verificat aici), iar pentru staff restaurantul altcuiva
-- nu e atins deloc. RESTRICT / NO ACTION / SET NULL pe NOT NULL sunt deja AE6.
create function pg_temp.ae_double_setnull(p_schemas text[]) returns table (fk text)
language sql as $$
  with recursive b(rel, depth) as (
    select 'auth.users'::regclass::oid, 0
    union
    select c.conrelid, b.depth + 1
      from pg_constraint c
      join b on c.confrelid = b.rel
      join pg_class k on k.oid = c.conrelid
      join pg_namespace n on n.oid = k.relnamespace
     where c.contype = 'f' and c.confdeltype = 'c' and n.nspname = any (p_schemas)
       and c.conrelid <> 'public.restaurants'::regclass
       and b.depth < 12
  ),
  bd as (select rel, min(depth) as depth from b group by rel),
  uf as (
    select c.conrelid, bd.depth + 1 as lvl
      from pg_constraint c
      join bd on bd.rel = c.confrelid
      join pg_class k on k.oid = c.conrelid
      join pg_namespace n on n.oid = k.relnamespace
     where c.contype = 'f' and c.conparentid = 0 and n.nspname = any (p_schemas)
       and c.confdeltype in ('n', 'd')
       and c.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
  ),
  t as (
    select conrelid, (array_agg(lvl order by lvl))[2] as l
      from uf group by conrelid having count(*) >= 2
  )
  select format('%s(%s) -> %s.%s [L=%s, d=%s]', k.relname,
                (select string_agg(a.attname, ',' order by x.ord)
                   from unnest(g.conkey) with ordinality x(attnum, ord)
                   join pg_attribute a on a.attrelid = g.conrelid and a.attnum = x.attnum),
                pn.nspname, pk.relname, t.l, bd.depth)
    from pg_constraint g
    join t on t.conrelid = g.conrelid
    join bd on bd.rel = g.confrelid
    join pg_class k on k.oid = g.conrelid
    join pg_class pk on pk.oid = g.confrelid
    join pg_namespace pn on pn.oid = pk.relnamespace
   where g.contype = 'f' and g.conparentid = 0
     and g.confdeltype in ('c', 'n', 'd')
     and not (g.confdeltype in ('n', 'd')
              and g.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass))
     and bd.depth between t.l and t.l + 1
$$;

do $$
declare
  v_bad    text;
  v_src    text;
  v_canary text[];
begin
  -- Premisa: restaurantele owner-ului pleacă ÎNAINTEA contului, în instrucțiune
  -- proprie. Fără ea, `restaurants` NU are voie să fie scos din închidere.
  select p.prosrc into v_src from pg_proc p where p.oid = 'public.process_account_deletions()'::regprocedure;
  if not (position('delete from public.restaurants where owner_id = v_user.id' in v_src)
            between 1 and position('delete from auth.users where id = v_user.id' in v_src)) then
    raise exception 'AE7 FAIL: process_account_deletions nu mai șterge restaurantele owner-ului ÎNAINTEA contului — dublul SET NULL de pe orders/cash_shifts re-blochează orice patron care a servit el o comandă'; end if;

  -- Anti-vacuitate: forma reală (orders / cash_shifts cu dublu SET NULL spre user)
  -- există, deci detectorul are pe ce lucra.
  if (select count(*) from (
        select c.conrelid from pg_constraint c
         where c.contype = 'f' and c.confdeltype = 'n'
           and c.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
           and c.conrelid in ('public.orders'::regclass, 'public.cash_shifts'::regclass)
         group by c.conrelid having count(*) >= 2) x) <> 2 then
    raise exception 'AE7 FAIL (anti-vacuitate): orders / cash_shifts nu mai au dublu SET NULL spre user — revizuiește clichetul'; end if;

  select string_agg(fk, '; ' order by fk collate "C") into v_bad from pg_temp.ae_double_setnull(array['public']);
  if v_bad is not null then
    raise exception 'AE7 FAIL: rânduri cu ≥2 FK-uri SET NULL spre user care referă și o tabelă golită de cascada din auth.users la nivelul verificării: %. A doua rescriere re-verifică FK-ul, iar părintele e deja șters → 23503, ștergerea GDPR sărită la infinit.', v_bad;
  end if;

  -- Canare, ambele formele validate cu rânduri comise: pozitiv
  -- (auth, auth → L=1; push_subscriptions la d=2 = L+1 → pică) și negativ
  -- (auth, profiles → L=2; restaurant_memberships la d=1 < L → trece; plus un FK
  -- spre `restaurants`, golit înainte de process_account_deletions).
  create table public.ae307_dbl_bad (
    a uuid references auth.users(id) on delete set null,
    b uuid references auth.users(id) on delete set null,
    p uuid references public.push_subscriptions(id) on delete cascade);
  create table public.ae307_dbl_ok (
    a uuid references auth.users(id) on delete set null,
    b uuid references public.profiles(id) on delete set null,
    m uuid references public.restaurant_memberships(id) on delete cascade,
    r uuid references public.restaurants(id) on delete cascade);
  select array_agg(fk order by fk collate "C") into v_canary
    from pg_temp.ae_double_setnull(array['public']) where fk like 'ae307_dbl_%';
  if v_canary is distinct from array['ae307_dbl_bad(p) -> public.push_subscriptions [L=1, d=2]'] then
    raise exception 'AE7 FAIL (canar): detectorul e orb sau prea larg: %', v_canary; end if;

  raise notice 'AE7 OK: restaurantele pleacă înaintea contului; niciun rând cu dublu SET NULL spre user nu referă o tabelă golită la nivelul verificării; canarele (pică / trece) clasificate corect';
end $$;

rollback;
