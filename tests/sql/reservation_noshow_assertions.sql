-- tests/sql/reservation_noshow_assertions.sql
-- =============================================================================
-- Aserții pentru mig 233/234 (no-show pe rezervări):
--   NS1  auto_mark_reservation_no_show: confirmed + starts_at depășit de grație
--        → no_show; confirmed recent / pending / seated rămân neatinse.
--   NS2  claim_reservation_reminders (lanț 057→234): rezervarea doar-cu-telefon
--        NU e revendicată cu modulul SMS oprit (nu ardem reminder_sent_at fără
--        canal), DAR e revendicată după activarea modulului; canalul email
--        rămâne neatins (revendicat indiferent de modul).
--   NS3  get_reservation_no_show_counts: numără no-show-urile istorice pe
--        aceeași cheie de telefon indiferent de format (+40… vs 07…); gate
--        is_member — un user străin primește excepție.
--   NS4  Granturi: auto_mark + claim doar service_role; counts fără anon.
--   NS5  Enumul sms_template_kind conține 'reservation_reminder' (mig 233).
--
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a1b10000-0000-4000-8000-0000000000f1','ns-owner@ns.test'),
  ('a1b20000-0000-4000-8000-0000000000f2','ns-outsider@ns.test');

-- growth = feature sms_notifications activ la nivel de plan (mig 228 seed).
update public.profiles set plan = 'growth'
 where id = 'a1b10000-0000-4000-8000-0000000000f1';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('b1c10000-0000-4000-8000-0000000000f1','a1b10000-0000-4000-8000-0000000000f1',
   'NS Bistro','ns-bistro-slug','Cluj',true);

insert into public.restaurant_memberships (restaurant_id, user_id, role) values
  ('b1c10000-0000-4000-8000-0000000000f1','a1b10000-0000-4000-8000-0000000000f1','owner')
on conflict (restaurant_id, user_id) do nothing;

-- Rezervări pentru NS1 (trecut) + istoric no_show pentru NS3.
-- Statusurile inițiale sunt setate direct (insert ca postgres, ocolind RLS —
-- același pattern ca restul suitelor); trigger-ul SMS de confirmare e inert
-- (modulul sms_notifications e OFF la acest punct).
insert into public.reservations
  (id, restaurant_id, customer_name, customer_phone, party_size,
   starts_at, ends_at, status) values
  -- NS1: confirmed, depășită cu 3h → trebuie marcată no_show
  ('c1d10000-0000-4000-8000-0000000000f1','b1c10000-0000-4000-8000-0000000000f1',
   'Vlad','0722111222',2, now() - interval '3 hours', now() - interval '1 hour','confirmed'),
  -- NS1: confirmed, depășită cu doar 1h (< grația de 2h) → rămâne confirmed
  ('c1d20000-0000-4000-8000-0000000000f2','b1c10000-0000-4000-8000-0000000000f1',
   'Ana','0733222333',2, now() - interval '1 hour', now() + interval '1 hour','confirmed'),
  -- NS1: pending depășită → decizie de staff, rămâne pending
  ('c1d30000-0000-4000-8000-0000000000f3','b1c10000-0000-4000-8000-0000000000f1',
   'Radu','0744333444',4, now() - interval '3 hours', now() - interval '1 hour','pending'),
  -- NS1: seated depășită → clientul A venit, rămâne seated
  ('c1d40000-0000-4000-8000-0000000000f4','b1c10000-0000-4000-8000-0000000000f1',
   'Ioana','0755444555',3, now() - interval '3 hours', now() - interval '1 hour','seated'),
  -- NS3: istoric no_show pe ACELAȘI telefon ca Vlad, în format internațional
  ('c1d50000-0000-4000-8000-0000000000f5','b1c10000-0000-4000-8000-0000000000f1',
   'Vlad','+40 722 111 222',2, now() - interval '7 days', now() - interval '7 days' + interval '2 hours','no_show');

-- ── NS1: auto-mark doar confirmed + depășit de grație ────────────────────────
do $$
declare v_marked integer;
begin
  v_marked := public.auto_mark_reservation_no_show(120);
  if v_marked <> 1 then
    raise exception 'NS1 FAIL: auto_mark a marcat % rezervări (așteptat 1)', v_marked;
  end if;
  if (select status from public.reservations where id = 'c1d10000-0000-4000-8000-0000000000f1') <> 'no_show' then
    raise exception 'NS1 FAIL: confirmed depășită cu 3h nu a devenit no_show';
  end if;
  if (select status from public.reservations where id = 'c1d20000-0000-4000-8000-0000000000f2') <> 'confirmed' then
    raise exception 'NS1 FAIL: confirmed în interiorul grației a fost atinsă';
  end if;
  if (select status from public.reservations where id = 'c1d30000-0000-4000-8000-0000000000f3') <> 'pending' then
    raise exception 'NS1 FAIL: pending a fost atinsă de auto-mark';
  end if;
  if (select status from public.reservations where id = 'c1d40000-0000-4000-8000-0000000000f4') <> 'seated' then
    raise exception 'NS1 FAIL: seated a fost atinsă de auto-mark';
  end if;
  raise notice 'NS1 OK: auto-mark doar confirmed depășite de grație';
end $$;

-- ── NS2: claim-ul de remindere — canal SMS gate-uit pe modul ─────────────────
-- Două rezervări VIITOARE în fereastra de reminder (default 24h):
--   • doar-telefon (mobil RO valid, fără email);
--   • doar-email (telefon fix, ne-mobil — normalizarea întoarce null).
insert into public.reservations
  (id, restaurant_id, customer_name, customer_phone, customer_email, party_size,
   starts_at, ends_at, status) values
  ('c1d60000-0000-4000-8000-0000000000f6','b1c10000-0000-4000-8000-0000000000f1',
   'Doar Telefon','0766555666',null,2, now() + interval '2 hours', now() + interval '4 hours','confirmed'),
  ('c1d70000-0000-4000-8000-0000000000f7','b1c10000-0000-4000-8000-0000000000f1',
   'Doar Email','0212345678','doar.email@ns.test',2, now() + interval '2 hours', now() + interval '4 hours','confirmed');

do $$
declare v_ids uuid[];
begin
  -- Modulul SMS e OFF → doar rezervarea cu email e revendicată.
  select coalesce(array_agg(c.id), '{}') into v_ids
    from public.claim_reservation_reminders(100) c;
  if 'c1d60000-0000-4000-8000-0000000000f6' = any(v_ids) then
    raise exception 'NS2 FAIL: rezervarea doar-telefon revendicată cu modulul SMS OFF';
  end if;
  if not ('c1d70000-0000-4000-8000-0000000000f7' = any(v_ids)) then
    raise exception 'NS2 FAIL: rezervarea cu email nu a fost revendicată';
  end if;

  -- Activăm modulul → rezervarea doar-telefon devine eligibilă.
  insert into public.restaurant_modules (restaurant_id, module_key, enabled)
  values ('b1c10000-0000-4000-8000-0000000000f1','sms_notifications',true)
  on conflict (restaurant_id, module_key) do update set enabled = true;

  select coalesce(array_agg(c.id), '{}') into v_ids
    from public.claim_reservation_reminders(100) c;
  if not ('c1d60000-0000-4000-8000-0000000000f6' = any(v_ids)) then
    raise exception 'NS2 FAIL: rezervarea doar-telefon nu e revendicată cu modulul SMS ON';
  end if;
  if (select reminder_sent_at from public.reservations
       where id = 'c1d60000-0000-4000-8000-0000000000f6') is null then
    raise exception 'NS2 FAIL: reminder_sent_at nu a fost marcat la claim';
  end if;
  raise notice 'NS2 OK: canal SMS gate-uit pe modul; canalul email neatins';
end $$;

-- ── NS3: recidiviști — aceeași cheie indiferent de format + gate is_member ───
set local role authenticated;
set local request.jwt.claim.sub = 'a1b10000-0000-4000-8000-0000000000f1';

do $$
declare v_cnt bigint;
begin
  -- Telefonul lui Vlad are 2 no-show-uri: cel istoric (+40 722 111 222) și cel
  -- marcat de NS1 (0722111222) — formate diferite, aceeași cheie (722111222).
  select c.no_show_count into v_cnt
    from public.get_reservation_no_show_counts('b1c10000-0000-4000-8000-0000000000f1') c
   where c.phone_key = '722111222';
  if coalesce(v_cnt, 0) <> 2 then
    raise exception 'NS3 FAIL: cheia 722111222 are % no-show-uri (așteptat 2)', coalesce(v_cnt, 0);
  end if;
end $$;

set local request.jwt.claim.sub = 'a1b20000-0000-4000-8000-0000000000f2';

do $$
begin
  begin
    perform public.get_reservation_no_show_counts('b1c10000-0000-4000-8000-0000000000f1');
    raise exception 'NS3 FAIL: un user fără membership a citit istoricul no-show';
  exception when others then
    if sqlerrm not ilike '%acces%' then raise; end if;
  end;
  raise notice 'NS3 OK: cheie stabilă între formate + gate is_member';
end $$;

reset role;

-- ── NS4: granturi ────────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.auto_mark_reservation_no_show(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.auto_mark_reservation_no_show(integer)', 'execute') then
    raise exception 'NS4 FAIL: auto_mark_reservation_no_show accesibil non-service_role';
  end if;
  if has_function_privilege('anon', 'public.claim_reservation_reminders(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_reservation_reminders(integer)', 'execute') then
    raise exception 'NS4 FAIL: claim_reservation_reminders accesibil non-service_role';
  end if;
  if has_function_privilege('anon', 'public.get_reservation_no_show_counts(uuid)', 'execute') then
    raise exception 'NS4 FAIL: get_reservation_no_show_counts accesibil anon';
  end if;
  raise notice 'NS4 OK: granturi corecte';
end $$;

-- ── NS5: enumul are template-ul de reminder ──────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'sms_template_kind' and e.enumlabel = 'reservation_reminder'
  ) then
    raise exception 'NS5 FAIL: sms_template_kind fără reservation_reminder';
  end if;
  raise notice 'NS5 OK: template reservation_reminder în enum';
end $$;

select 'RESERVATION NO-SHOW ASSERTIONS: NS1–NS5 PASS' as result;

rollback;
