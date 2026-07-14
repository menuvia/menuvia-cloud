-- tests/sql/sms_queue_assertions.sql
-- =============================================================================
-- Aserții pentru mig 228 (SMS tranzacționale): coadă + gate-uri + triggere.
--
--   SQ1   Modul OFF → enqueue_sms întoarce null, zero rânduri.
--   SQ2   Modul ON + plan growth → enqueue reușește; dedup_key duplicat →
--         al doilea apel null și tot 1 rând.
--   SQ3   Plan free (modul ON) → null (SMS doar pe planurile plătite).
--   SQ4   Plafon lunar: limit_value=1 → al doilea SMS (dedup diferit) refuzat.
--   SQ5   Telefon fix / străin → null (doar mobile RO).
--   SQ6   claim_sms_batch: marchează sending, nu redă același rând; rândurile
--         sending cu claimed_at vechi de >10 min sunt reclamate.
--   SQ7   Trigger rezervare: INSERT confirmed → rând cu dedup
--         'sms_reservation_confirmed:<id>'; pending → confirmed → enqueue.
--   SQ8   Trigger pickup: pickup cu telefon → ready → rând
--         'sms_pickup_ready:<id>'; qr → ready NU enqueue.
--   SQ9   Robustețe: cu modul OFF, insertul de rezervare confirmed reușește
--         fără eroare (triggerul nu avortează tranzacția).
--   SQ10  anon/authenticated fără EXECUTE pe enqueue_sms/claim_sms_batch.
--
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('61a1a1a1-1111-4111-8111-aaaaaaaaaaaa','sq-owner-growth@sq.test'),
  ('62a2a2a2-2222-4222-8222-aaaaaaaaaaaa','sq-owner-free@sq.test');

update public.profiles set plan = 'growth'
 where id = '61a1a1a1-1111-4111-8111-aaaaaaaaaaaa';
update public.profiles set plan = 'free'
 where id = '62a2a2a2-2222-4222-8222-aaaaaaaaaaaa';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('71b1b1b1-1111-4111-8111-bbbbbbbbbbbb','61a1a1a1-1111-4111-8111-aaaaaaaaaaaa',
   'SQ Growth','sq-growth-slug','Cluj',true),
  ('72b2b2b2-2222-4222-8222-bbbbbbbbbbbb','62a2a2a2-2222-4222-8222-aaaaaaaaaaaa',
   'SQ Free','sq-free-slug','Cluj',true);

-- ── SQ1: modul OFF (niciun rând în restaurant_modules) → null ────────────────
do $$
declare v uuid;
begin
  v := public.enqueue_sms('71b1b1b1-1111-4111-8111-bbbbbbbbbbbb', '0722333444',
                          'reservation_confirmed', '{}'::jsonb, 'sq1');
  if v is not null then
    raise exception 'SQ1 FAIL: enqueue a trecut cu modulul OFF';
  end if;
  if exists (select 1 from public.sms_queue
             where restaurant_id = '71b1b1b1-1111-4111-8111-bbbbbbbbbbbb') then
    raise exception 'SQ1 FAIL: rând în sms_queue cu modulul OFF';
  end if;
end $$;

-- Activăm modulul pe ambele restaurante pentru testele următoare.
insert into public.restaurant_modules (restaurant_id, module_key, enabled) values
  ('71b1b1b1-1111-4111-8111-bbbbbbbbbbbb','sms_notifications',true),
  ('72b2b2b2-2222-4222-8222-bbbbbbbbbbbb','sms_notifications',true);

-- ── SQ2: growth → enqueue ok; dedup duplicat → null, tot 1 rând ──────────────
do $$
declare v1 uuid; v2 uuid; v_cnt bigint; v_phone text;
begin
  v1 := public.enqueue_sms('71b1b1b1-1111-4111-8111-bbbbbbbbbbbb', '0040 722 333 444',
                           'reservation_confirmed', '{"x":1}'::jsonb, 'sq2');
  if v1 is null then
    raise exception 'SQ2 FAIL: enqueue refuzat pe growth cu modul ON';
  end if;
  v2 := public.enqueue_sms('71b1b1b1-1111-4111-8111-bbbbbbbbbbbb', '0722333444',
                           'reservation_confirmed', '{"x":2}'::jsonb, 'sq2');
  if v2 is not null then
    raise exception 'SQ2 FAIL: dedup_key duplicat a produs al doilea rând';
  end if;
  select count(*), min(recipient_phone) into v_cnt, v_phone
    from public.sms_queue where dedup_key = 'sq2';
  if v_cnt <> 1 then
    raise exception 'SQ2 FAIL: % rânduri pentru dedup sq2', v_cnt;
  end if;
  if v_phone <> '+40722333444' then
    raise exception 'SQ2 FAIL: telefonul nu e normalizat E.164 (%)', v_phone;
  end if;
end $$;

-- ── SQ3: plan free (modul ON) → null ─────────────────────────────────────────
do $$
declare v uuid;
begin
  v := public.enqueue_sms('72b2b2b2-2222-4222-8222-bbbbbbbbbbbb', '0722333444',
                          'pickup_ready', '{}'::jsonb, 'sq3');
  if v is not null then
    raise exception 'SQ3 FAIL: SMS pe planul free';
  end if;
end $$;

-- ── SQ4: plafonul lunar ──────────────────────────────────────────────────────
do $$
declare v uuid;
begin
  update public.plan_features set limit_value = 1
   where plan = 'growth' and feature = 'sms_notifications';
  -- sq2 a consumat deja singurul SMS al lunii → următorul e refuzat.
  v := public.enqueue_sms('71b1b1b1-1111-4111-8111-bbbbbbbbbbbb', '0722333445',
                          'pickup_ready', '{}'::jsonb, 'sq4');
  if v is not null then
    raise exception 'SQ4 FAIL: plafonul lunar nu se aplică';
  end if;
  update public.plan_features set limit_value = 300
   where plan = 'growth' and feature = 'sms_notifications';
end $$;

-- ── SQ5: fix / străin → null ─────────────────────────────────────────────────
do $$
declare v uuid;
begin
  v := public.enqueue_sms('71b1b1b1-1111-4111-8111-bbbbbbbbbbbb', '021 555 1234',
                          'pickup_ready', '{}'::jsonb, 'sq5a');
  if v is not null then
    raise exception 'SQ5 FAIL: număr fix acceptat';
  end if;
  v := public.enqueue_sms('71b1b1b1-1111-4111-8111-bbbbbbbbbbbb', '+49 151 1234567',
                          'pickup_ready', '{}'::jsonb, 'sq5b');
  if v is not null then
    raise exception 'SQ5 FAIL: număr străin acceptat';
  end if;
end $$;

-- ── SQ6: claim atomic + reclaim stale-sending ────────────────────────────────
do $$
declare v_cnt bigint;
begin
  perform public.enqueue_sms('71b1b1b1-1111-4111-8111-bbbbbbbbbbbb', '0722333446',
                             'pickup_ready', '{}'::jsonb, 'sq6a');
  perform public.enqueue_sms('71b1b1b1-1111-4111-8111-bbbbbbbbbbbb', '0722333447',
                             'pickup_ready', '{}'::jsonb, 'sq6b');

  select count(*) into v_cnt from public.claim_sms_batch(10);
  -- sq2 e tot 'queued' → 3 rânduri revendicate (sq2 + sq6a + sq6b).
  if v_cnt <> 3 then
    raise exception 'SQ6 FAIL: primul claim a redat % rânduri (așteptat 3)', v_cnt;
  end if;

  select count(*) into v_cnt from public.claim_sms_batch(10);
  if v_cnt <> 0 then
    raise exception 'SQ6 FAIL: al doilea claim a redat rânduri deja revendicate';
  end if;

  -- Simulăm un worker mort: sending vechi de 11 min → reclaim + re-claim.
  update public.sms_queue set claimed_at = now() - interval '11 minutes'
   where dedup_key = 'sq6a';
  select count(*) into v_cnt from public.claim_sms_batch(10);
  if v_cnt <> 1 then
    raise exception 'SQ6 FAIL: rândul stale nu a fost reclamat (%)', v_cnt;
  end if;
  if not exists (select 1 from public.sms_queue
                 where dedup_key = 'sq6a' and failed_attempts = 1 and status = 'sending') then
    raise exception 'SQ6 FAIL: reclaim-ul nu a incrementat failed_attempts';
  end if;
end $$;

-- ── SQ7: triggerul de rezervare ──────────────────────────────────────────────
do $$
declare v_key text;
begin
  -- INSERT direct confirmed (fluxul public + dashboard).
  insert into public.reservations
    (id, restaurant_id, customer_name, customer_phone, party_size,
     starts_at, ends_at, status)
  values
    ('81e1e1e1-1111-4111-8111-eeeeeeeeeeee','71b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
     'Ana Test','0722 333 448',2, now() + interval '1 day',
     now() + interval '1 day 2 hours','confirmed');
  v_key := 'sms_reservation_confirmed:81e1e1e1-1111-4111-8111-eeeeeeeeeeee';
  if not exists (select 1 from public.sms_queue where dedup_key = v_key) then
    raise exception 'SQ7 FAIL: INSERT confirmed nu a pus SMS în coadă';
  end if;

  -- pending → confirmed (aprobarea din dashboard).
  insert into public.reservations
    (id, restaurant_id, customer_name, customer_phone, party_size,
     starts_at, ends_at, status)
  values
    ('82e2e2e2-2222-4222-8222-eeeeeeeeeeee','71b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
     'Bogdan Test','0722333449',4, now() + interval '2 days',
     now() + interval '2 days 2 hours','pending');
  v_key := 'sms_reservation_confirmed:82e2e2e2-2222-4222-8222-eeeeeeeeeeee';
  if exists (select 1 from public.sms_queue where dedup_key = v_key) then
    raise exception 'SQ7 FAIL: SMS pe rezervare pending';
  end if;
  update public.reservations set status = 'confirmed'
   where id = '82e2e2e2-2222-4222-8222-eeeeeeeeeeee';
  if not exists (select 1 from public.sms_queue where dedup_key = v_key) then
    raise exception 'SQ7 FAIL: pending→confirmed nu a pus SMS în coadă';
  end if;
end $$;

-- ── SQ8: triggerul pickup ────────────────────────────────────────────────────
do $$
declare v_key text;
begin
  insert into public.orders
    (id, restaurant_id, source, status, total, customer_name, customer_phone, pickup_time)
  values
    ('91f1f1f1-1111-4111-8111-ffffffffffff','71b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
     'pickup','preparing',45,'Radu Test','0722333450', now() + interval '40 minutes');
  update public.orders set status = 'ready'
   where id = '91f1f1f1-1111-4111-8111-ffffffffffff';
  v_key := 'sms_pickup_ready:91f1f1f1-1111-4111-8111-ffffffffffff';
  if not exists (select 1 from public.sms_queue where dedup_key = v_key) then
    raise exception 'SQ8 FAIL: pickup→ready nu a pus SMS în coadă';
  end if;

  -- O comandă QR care ajunge ready NU trimite SMS.
  insert into public.orders (id, restaurant_id, source, status, total)
  values ('92f2f2f2-2222-4222-8222-ffffffffffff',
          '71b1b1b1-1111-4111-8111-bbbbbbbbbbbb','qr','preparing',30);
  update public.orders set status = 'ready'
   where id = '92f2f2f2-2222-4222-8222-ffffffffffff';
  if exists (select 1 from public.sms_queue
             where dedup_key = 'sms_pickup_ready:92f2f2f2-2222-4222-8222-ffffffffffff') then
    raise exception 'SQ8 FAIL: SMS pe comandă QR';
  end if;
end $$;

-- ── SQ9: robustețe — modul OFF, rezervarea confirmed reușește fără eroare ────
do $$
begin
  update public.restaurant_modules set enabled = false
   where restaurant_id = '71b1b1b1-1111-4111-8111-bbbbbbbbbbbb'
     and module_key = 'sms_notifications';
  insert into public.reservations
    (id, restaurant_id, customer_name, customer_phone, party_size,
     starts_at, ends_at, status)
  values
    ('83e3e3e3-3333-4333-8333-eeeeeeeeeeee','71b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
     'Corina Test','0722333451',3, now() + interval '3 days',
     now() + interval '3 days 2 hours','confirmed');
  if not exists (select 1 from public.reservations
                 where id = '83e3e3e3-3333-4333-8333-eeeeeeeeeeee') then
    raise exception 'SQ9 FAIL: rezervarea nu s-a creat';
  end if;
  if exists (select 1 from public.sms_queue
             where dedup_key = 'sms_reservation_confirmed:83e3e3e3-3333-4333-8333-eeeeeeeeeeee') then
    raise exception 'SQ9 FAIL: SMS pus în coadă cu modulul OFF';
  end if;
end $$;

-- ── SQ10: privilegii ─────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon',
       'public.enqueue_sms(uuid, text, public.sms_template_kind, jsonb, text)', 'execute')
     or has_function_privilege('authenticated',
       'public.enqueue_sms(uuid, text, public.sms_template_kind, jsonb, text)', 'execute') then
    raise exception 'SQ10 FAIL: enqueue_sms executabil de anon/authenticated';
  end if;
  if has_function_privilege('anon', 'public.claim_sms_batch(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_sms_batch(integer)', 'execute') then
    raise exception 'SQ10 FAIL: claim_sms_batch executabil de anon/authenticated';
  end if;
end $$;

select 'SMS QUEUE ASSERTIONS: SQ1–SQ10 PASS' as result;

rollback;
