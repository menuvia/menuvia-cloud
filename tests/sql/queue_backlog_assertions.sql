-- tests/sql/queue_backlog_assertions.sql
-- =============================================================================
-- Asserții permanente pentru mig 271 (B) — `get_queue_backlog()`, sonda de
-- backlog a cozilor pentru /health (audit v3 RES-32: /health vedea un singur
-- job din șase; cozile puteau muri tăcut cu HTTP 200).
--
-- Principiul central: fiecare predicat OGLINDEȘTE claim-ul corespunzător. Un
-- backlog pe care claim-ul nu l-ar ridica niciodată = alarmă permanentă falsă;
-- unul pe care claim-ul îl ridică dar sonda nu-l vede = sondă moartă. De aceea
-- QB3/QB4/QB5/QB6 fac claim-ul REAL și cer backlog 0 după.
--
--   QB1  formă + privilegii: exact {cron, bridge}, DEFINER+pg_temp, service_role-only.
--   QB2  email: scadent → numărat cu vârstă; viitor / plafonat / sending
--        proaspăt → NU; sending BLOCAT >10 min (reclaimabil, 242) → DA;
--        sending blocat dar la plafon după bump → NU.
--   QB3  email LEGAT de claim_email_batch: după claim, 0.
--   QB4  sms: aceeași pereche + claim_sms_batch (incl. reclaim-ul 228).
--   QB5  invoices: doar cu oblio_configs.is_active; backoff în viitor → NU;
--        după bridge_oblio_get_queued → 0.
--   QB6  remindere: în fereastră + canal livrabil → numărat; în afara ferestrei
--        / fără canal → NU; vârsta = de la CLAIMABIL (podea created_at: o
--        rezervare same-day făcută în fereastră NU raportează ~20h);
--        după claim_reservation_reminders → 0.
--   QB7  bridge: pending_receipts / kitchen_tickets pending apar sub `bridge`,
--        NU sub `cron` (contractul pe care JS-ul sprijină „warn, nu 503");
--        DOAR la restaurante cu device (247) / device+feature (227) — un rând
--        orfan (device șters, plan retrogradat) NU e backlog.
--   QB8  read-only + idempotent: două apeluri, același rezultat, nicio scriere.
--
-- Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('73000000-0000-4000-8000-000000000001', 'qb-owner@qb.test');
update public.profiles set plan = 'pro' where id = '73000000-0000-4000-8000-000000000001';
insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('73b00000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', 'QB Pro', 'qb-pro', 'Cluj', true),
  ('73b00000-0000-4000-8000-000000000002', '73000000-0000-4000-8000-000000000001', 'QB Fara Oblio', 'qb-fara-oblio', 'Cluj', true);
insert into public.orders (id, restaurant_id, source, status, total) values
  ('73f00000-0000-4000-8000-000000000001', '73b00000-0000-4000-8000-000000000001', 'waiter', 'served', 50),
  ('73f00000-0000-4000-8000-000000000002', '73b00000-0000-4000-8000-000000000002', 'waiter', 'served', 50);

-- Nimic în cozi la început (starea curată a replay-ului): baseline.
create temp table qb_base as select public.get_queue_backlog() as snap;

-- ── QB1: formă + privilegii ──────────────────────────────────────────────────
do $$
declare v jsonb; v_keys text[]; v_src text; v_cfg text[];
begin
  v := public.get_queue_backlog();
  select array_agg(k order by k) into v_keys from jsonb_object_keys(v) k;
  if v_keys is distinct from array['bridge','cron'] then
    raise exception 'QB1 FAIL: cheile de top-level sunt % (asteptat {bridge,cron})', v_keys; end if;
  select array_agg(k order by k) into v_keys from jsonb_object_keys(v->'cron') k;
  if v_keys is distinct from array['email','invoices','reminders','slack_alerts','sms'] then
    raise exception 'QB1 FAIL: cheile grupei cron sunt %', v_keys; end if;
  select array_agg(k order by k) into v_keys from jsonb_object_keys(v->'bridge') k;
  if v_keys is distinct from array['receipts','tickets'] then
    raise exception 'QB1 FAIL: cheile grupei bridge sunt %', v_keys; end if;

  select pg_get_functiondef(p.oid), p.proconfig into v_src, v_cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_queue_backlog';
  if position('security definer' in lower(v_src)) = 0
     or not exists (select 1 from unnest(v_cfg) c where c like 'search_path=%pg_temp%') then
    raise exception 'QB1 FAIL: get_queue_backlog nu e DEFINER cu pg_temp'; end if;
  if has_function_privilege('anon', 'public.get_queue_backlog()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.get_queue_backlog()', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.get_queue_backlog()', 'EXECUTE') then
    raise exception 'QB1 FAIL: volumul cozilor e volum de business — doar service_role'; end if;
  raise notice 'QB1 OK: forma {cron,bridge} inghetata, DEFINER, service_role-only';
end $$;

-- ── QB2 + QB3: email — predicat + legare de claim ────────────────────────────
do $$
declare v jsonb; v_base int; v_n int;
begin
  select (snap->'cron'->'email'->>'waiting')::int into v_base from qb_base;
  insert into public.email_queue (recipient_email, template_kind, status, scheduled_for) values
    ('a@qb.test', 'welcome', 'queued', now() - interval '1 hour'),   -- scadent → numărat
    ('b@qb.test', 'welcome', 'queued', now() + interval '1 hour');   -- backoff în viitor → NU
  insert into public.email_queue (recipient_email, template_kind, status, scheduled_for, failed_attempts) values
    ('c@qb.test', 'welcome', 'queued', now() - interval '1 hour', 3); -- plafonat → NU
  insert into public.email_queue (recipient_email, template_kind, status, scheduled_for, claimed_at) values
    ('d@qb.test', 'welcome', 'sending', now() - interval '1 hour', now()),                       -- în lucru (proaspăt) → NU
    ('e@qb.test', 'welcome', 'sending', now() - interval '1 hour', now() - interval '20 minutes'); -- blocat >10 min → reclaim (242) → DA
  insert into public.email_queue (recipient_email, template_kind, status, scheduled_for, claimed_at, failed_attempts) values
    ('f@qb.test', 'welcome', 'sending', now() - interval '1 hour', now() - interval '20 minutes', 2); -- blocat, dar bump-ul atinge plafonul → 'failed' → NU

  v := public.get_queue_backlog();
  v_n := (v->'cron'->'email'->>'waiting')::int - v_base;
  if v_n <> 2 then
    raise exception 'QB2 FAIL: email waiting=% peste baseline (asteptat 2: randul scadent queued + randul blocat in sending >10 min pe care claim-ul il reclama)', v_n; end if;
  if (v->'cron'->'email'->>'oldest_age_s')::numeric < 3590 then
    raise exception 'QB2 FAIL: oldest_age_s=% (asteptat ~3600)', v->'cron'->'email'->>'oldest_age_s'; end if;

  -- QB3: claim-ul ridică EXACT ce numără sonda.
  perform public.claim_email_batch(30);
  v := public.get_queue_backlog();
  -- Claim-ul ridică TOT ce e claimabil (inclusiv un eventual baseline al replay-ului),
  -- deci după el sonda TREBUIE să dea 0 — orice rest = sonda numără ceva ce
  -- claim-ul nu ridică niciodată (alarmă permanentă falsă).
  if (v->'cron'->'email'->>'waiting')::int <> 0 then
    raise exception 'QB3 FAIL: dupa claim_email_batch backlog-ul email e % (asteptat 0) — sonda numara ceva ce claim-ul nu ridica', v->'cron'->'email'->>'waiting'; end if;
  raise notice 'QB2/QB3 OK: email — predicatul oglindeste claim-ul';
end $$;

-- ── QB4: sms — aceeași pereche ───────────────────────────────────────────────
do $$
declare v jsonb; v_base int; v_n int;
begin
  select (snap->'cron'->'sms'->>'waiting')::int into v_base from qb_base;
  insert into public.sms_queue (restaurant_id, recipient_phone, template_kind, status, scheduled_for) values
    ('73b00000-0000-4000-8000-000000000001', '0722000111', 'pickup_ready', 'queued', now() - interval '30 minutes'),
    ('73b00000-0000-4000-8000-000000000001', '0722000112', 'pickup_ready', 'queued', now() + interval '30 minutes');
  insert into public.sms_queue (restaurant_id, recipient_phone, template_kind, status, scheduled_for, failed_attempts) values
    ('73b00000-0000-4000-8000-000000000001', '0722000113', 'pickup_ready', 'queued', now() - interval '30 minutes', 3);
  insert into public.sms_queue (restaurant_id, recipient_phone, template_kind, status, scheduled_for, claimed_at) values
    ('73b00000-0000-4000-8000-000000000001', '0722000114', 'pickup_ready', 'sending', now() - interval '30 minutes', now() - interval '2 minutes'),  -- în lucru → NU
    ('73b00000-0000-4000-8000-000000000001', '0722000115', 'pickup_ready', 'sending', now() - interval '30 minutes', now() - interval '20 minutes'); -- blocat → reclaim (228) → DA
  v := public.get_queue_backlog();
  v_n := (v->'cron'->'sms'->>'waiting')::int - v_base;
  if v_n <> 2 then
    raise exception 'QB4 FAIL: sms waiting=% peste baseline (asteptat 2: queued scadent + sending blocat >10 min)', v_n; end if;
  perform public.claim_sms_batch(30);
  v := public.get_queue_backlog();
  if (v->'cron'->'sms'->>'waiting')::int <> 0 then
    raise exception 'QB4 FAIL: dupa claim_sms_batch backlog-ul sms e % (asteptat 0)', v->'cron'->'sms'->>'waiting'; end if;
  raise notice 'QB4 OK: sms — predicatul oglindeste claim-ul';
end $$;

-- ── QB5: invoices — doar cu config Oblio activ; backoff; legare de claim ─────
do $$
declare v jsonb; v_base int; v_n int;
begin
  select (snap->'cron'->'invoices'->>'waiting')::int into v_base from qb_base;
  insert into public.oblio_configs (restaurant_id, api_email, api_secret, company_cif, company_name, is_active) values
    ('73b00000-0000-4000-8000-000000000001', 'qb@oblio.test', 'sec', 'RO123', 'QB SRL', true);
  insert into public.invoices (id, restaurant_id, order_id, customer_name, total_with_vat, status, created_at) values
    -- config activ, scadentă → numărată
    ('73a00000-0000-4000-8000-000000000001', '73b00000-0000-4000-8000-000000000001',
     '73f00000-0000-4000-8000-000000000001', 'Client A', 50, 'queued', now() - interval '2 hours'),
    -- restaurant FĂRĂ config Oblio → claim-ul n-o ia niciodată → NU
    ('73a00000-0000-4000-8000-000000000002', '73b00000-0000-4000-8000-000000000002',
     '73f00000-0000-4000-8000-000000000002', 'Client B', 50, 'queued', now() - interval '2 hours');
  insert into public.invoices (id, restaurant_id, order_id, customer_name, total_with_vat, status, created_at, next_attempt_at) values
    -- backoff în viitor → NU
    ('73a00000-0000-4000-8000-000000000003', '73b00000-0000-4000-8000-000000000001',
     '73f00000-0000-4000-8000-000000000001', 'Client C', 50, 'queued', now() - interval '2 hours', now() + interval '10 minutes');
  v := public.get_queue_backlog();
  v_n := (v->'cron'->'invoices'->>'waiting')::int - v_base;
  if v_n <> 1 then
    raise exception 'QB5 FAIL: invoices waiting=% peste baseline (asteptat 1) — join-ul pe oblio_configs sau fereastra de backoff s-au pierdut', v_n; end if;
  if (v->'cron'->'invoices'->>'oldest_age_s')::numeric < 7190 then
    raise exception 'QB5 FAIL: oldest_age_s=% (asteptat ~7200)', v->'cron'->'invoices'->>'oldest_age_s'; end if;
  perform public.bridge_oblio_get_queued(100);
  v := public.get_queue_backlog();
  if (v->'cron'->'invoices'->>'waiting')::int <> 0 then
    raise exception 'QB5 FAIL: dupa bridge_oblio_get_queued backlog-ul e % (asteptat 0)', v->'cron'->'invoices'->>'waiting'; end if;
  raise notice 'QB5 OK: invoices — doar cu config activ, cu backoff, legat de claim';
end $$;

-- ── QB6: remindere — fereastra + canalul, legare de claim ───────────────────
do $$
declare v jsonb; v_base int; v_n int; v_age numeric;
begin
  select (snap->'cron'->'reminders'->>'waiting')::int into v_base from qb_base;
  -- Setările sunt create automat per restaurant (mig 057); fixăm fereastra.
  update public.reservation_settings set reminder_hours_before = 24
   where restaurant_id = '73b00000-0000-4000-8000-000000000001';
  insert into public.reservations (id, restaurant_id, customer_name, customer_phone, customer_email, party_size, starts_at, ends_at, status, created_at) values
    -- în fereastră (24h), cu email, creată acum 3h → numărată, vârstă ~3h
    ('73c00000-0000-4000-8000-000000000001', '73b00000-0000-4000-8000-000000000001', 'Ana', '0212000000', 'ana@qb.test', 2,
     now() + interval '21 hours', now() + interval '22 hours', 'confirmed', now() - interval '3 hours'),
    -- în afara ferestrei → NU
    ('73c00000-0000-4000-8000-000000000002', '73b00000-0000-4000-8000-000000000001', 'Ion', '0212000001', 'ion@qb.test', 2,
     now() + interval '30 hours', now() + interval '31 hours', 'confirmed', now() - interval '3 hours'),
    -- în fereastră dar FĂRĂ canal (fără email, telefon fix, modul SMS OFF) → NU
    ('73c00000-0000-4000-8000-000000000003', '73b00000-0000-4000-8000-000000000001', 'Dan', '0212000002', null, 2,
     now() + interval '21 hours', now() + interval '22 hours', 'confirmed', now() - interval '3 hours'),
    -- SAME-DAY: slot peste 5h, creată ACUM, în fereastra de 24h → numărată, dar
    -- vârsta ei e ~0 (claimabilă de când există), NU ~19h (de când slotul a
    -- intrat în fereastră) — altfel /health dădea 503 la fiecare rezervare de
    -- ultim moment, până la următorul tick al cron-ului.
    ('73c00000-0000-4000-8000-000000000004', '73b00000-0000-4000-8000-000000000001', 'Eva', '0212000003', 'eva@qb.test', 2,
     now() + interval '5 hours', now() + interval '6 hours', 'confirmed', now());
  v := public.get_queue_backlog();
  v_n := (v->'cron'->'reminders'->>'waiting')::int - v_base;
  if v_n <> 2 then
    raise exception 'QB6 FAIL: reminders waiting=% peste baseline (asteptat 2: fereastra reminder_hours_before + canal livrabil, incl. same-day)', v_n; end if;
  v_age := (v->'cron'->'reminders'->>'oldest_age_s')::numeric;
  if v_age < 3 * 3600 - 60 or v_age > 3 * 3600 + 60 then
    raise exception 'QB6 FAIL: oldest_age_s=% (asteptat ~3h = max(acum - greatest(starts_at - 24h, created_at)); ~19h = varsta se masoara de la intrarea in fereastra, nu de la claimabil)', v_age; end if;
  perform public.claim_reservation_reminders(100);
  v := public.get_queue_backlog();
  if (v->'cron'->'reminders'->>'waiting')::int <> 0 then
    raise exception 'QB6 FAIL: dupa claim_reservation_reminders backlog-ul e % (asteptat 0)', v->'cron'->'reminders'->>'waiting'; end if;
  raise notice 'QB6 OK: remindere — fereastra + canal, legat de claim';
end $$;

-- ── QB7: bridge — receipts/tickets pending sub `bridge`, nu sub `cron` ───────
do $$
declare v jsonb; v_r int; v_t int; v_cron_before jsonb; v_before jsonb;
begin
  -- Snapshot IMEDIAT înainte de inserări (claim-urile din QB3–QB6 au schimbat
  -- grupa cron față de baseline-ul inițial).
  v_before := public.get_queue_backlog();
  v_cron_before := v_before->'cron';
  v_r := (v_before->'bridge'->'receipts'->>'waiting')::int;
  v_t := (v_before->'bridge'->'tickets'->>'waiting')::int;
  -- Restaurantul 1 (pro) are device cu tichete; restaurantul 2 NU are device
  -- (șters / niciodată înregistrat); restaurantul 3 a fost pe growth (device
  -- cu tichete înregistrat legitim — gate-ul 149/227 refuză device-ul pe free)
  -- și apoi RETROGRADAT pe free → fără feature-ul kitchen_tickets. Claim-urile
  -- nu ridică nimic de la 2 și 3, deci nici sonda nu numără (altfel `warn`
  -- permanent, care maschează un bridge căzut real în altă parte).
  insert into public.bridge_devices (id, restaurant_id, name, device_secret, prints_kitchen_receipts) values
    ('73e00000-0000-4000-8000-000000000001', '73b00000-0000-4000-8000-000000000001', 'Casa QB', 'QBSECRET', true);
  insert into auth.users (id, email) values ('73000000-0000-4000-8000-000000000002', 'qb-downgrade@qb.test');
  update public.profiles set plan = 'growth' where id = '73000000-0000-4000-8000-000000000002';
  insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
    ('73b00000-0000-4000-8000-000000000003', '73000000-0000-4000-8000-000000000002', 'QB Downgrade', 'qb-downgrade', 'Cluj', true);
  insert into public.bridge_devices (id, restaurant_id, name, device_secret, prints_kitchen_receipts) values
    ('73e00000-0000-4000-8000-000000000003', '73b00000-0000-4000-8000-000000000003', 'Casa Downgrade', 'QBDOWN', true);
  insert into public.orders (id, restaurant_id, source, status, total) values
    ('73f00000-0000-4000-8000-000000000003', '73b00000-0000-4000-8000-000000000003', 'waiter', 'served', 50);

  insert into public.pending_receipts (restaurant_id, order_id, payload, status, total_snapshot, created_at) values
    ('73b00000-0000-4000-8000-000000000001', '73f00000-0000-4000-8000-000000000001', 'P', 'pending', 50, now() - interval '20 minutes'),
    ('73b00000-0000-4000-8000-000000000002', '73f00000-0000-4000-8000-000000000002', 'P', 'pending', 50, now() - interval '20 minutes'); -- fără device → NU
  insert into public.kitchen_tickets (restaurant_id, order_id, payload, status, created_at) values
    ('73b00000-0000-4000-8000-000000000001', '73f00000-0000-4000-8000-000000000001', 'T', 'pending', now() - interval '20 minutes'),
    ('73b00000-0000-4000-8000-000000000002', '73f00000-0000-4000-8000-000000000002', 'T', 'pending', now() - interval '20 minutes'), -- fără device → NU
    ('73b00000-0000-4000-8000-000000000003', '73f00000-0000-4000-8000-000000000003', 'T', 'pending', now() - interval '20 minutes'); -- inserat pe growth, apoi downgrade → NU
  -- Downgrade DUPĂ inserare: gate-ul de plan pe kitchen_tickets (227) refuză
  -- inserarea pe free, deci rândul orfan apare doar prin retrogradare.
  update public.profiles set plan = 'free' where id = '73000000-0000-4000-8000-000000000002';
  if public.restaurant_has_feature('73b00000-0000-4000-8000-000000000003', 'kitchen_tickets') then
    raise exception 'QB7 SETUP: dupa downgrade restaurantul nu ar trebui sa mai aiba kitchen_tickets'; end if;
  v := public.get_queue_backlog();
  if (v->'bridge'->'receipts'->>'waiting')::int - v_r <> 1 or (v->'bridge'->'tickets'->>'waiting')::int - v_t <> 1 then
    raise exception 'QB7 FAIL: bridge=% (asteptat +1 bon, +1 tichet: DOAR restaurantul cu device inregistrat si feature — randurile orfane nu sunt backlog)', v->'bridge'; end if;
  if (v->'bridge'->'receipts'->>'oldest_age_s')::numeric < 1190 then
    raise exception 'QB7 FAIL: varsta bonului pending e % (asteptat ~1200)', v->'bridge'->'receipts'->>'oldest_age_s'; end if;
  -- Grupa cron NU se atinge de bridge (e contractul „warn, nu 503") — egalitate
  -- pe ÎNTREAGA grupă, nu doar pe două chei.
  if v->'cron' <> v_cron_before then
    raise exception 'QB7 FAIL: randurile de bridge au contaminat grupa cron (% vs %)', v->'cron', v_cron_before; end if;
  raise notice 'QB7 OK: bonurile/tichetele pending stau sub bridge';
end $$;

-- ── QB8: read-only + idempotent ──────────────────────────────────────────────
do $$
declare v1 jsonb; v2 jsonb; c1 bigint; c2 bigint;
begin
  select (select count(*) from public.email_queue) + (select count(*) from public.sms_queue)
       + (select count(*) from public.invoices) + (select count(*) from public.reservations)
       + (select count(*) from public.pending_receipts) + (select count(*) from public.kitchen_tickets)
    into c1;
  v1 := public.get_queue_backlog();
  v2 := public.get_queue_backlog();
  select (select count(*) from public.email_queue) + (select count(*) from public.sms_queue)
       + (select count(*) from public.invoices) + (select count(*) from public.reservations)
       + (select count(*) from public.pending_receipts) + (select count(*) from public.kitchen_tickets)
    into c2;
  if c1 <> c2 then raise exception 'QB8 FAIL: sonda a scris in tabele (%→%)', c1, c2; end if;
  if (v1 - 'cron') <> (v2 - 'cron') or (v1->'cron'->'email'->>'waiting') <> (v2->'cron'->'email'->>'waiting') then
    raise exception 'QB8 FAIL: doua apeluri consecutive difera'; end if;
  raise notice 'QB8 OK: read-only, idempotent';
end $$;

rollback;
