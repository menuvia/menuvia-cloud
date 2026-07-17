-- mig 234 — no-show pe rezervări: reminder SMS + auto-no-show + recidiviști
-- ─────────────────────────────────────────────────────────────────────
-- Săptămâna 8 din PLAN_10_SAPTAMANI: „no-show pe rezervări (SMS-ul există
-- din mig 228)". Statusul 'no_show' există din mig 057 (CHECK + tranziție
-- manuală în ReservationsTab/RLS waiter mig 143); ce lipsea:
--
--   A. Reminder-ele ajung DOAR pe email (claim_reservation_reminders cere
--      customer_email non-null) — rezervările telefonice, exact cele cu
--      risc de no-show, nu primesc nimic. Redefinim claim-ul (lanț 057→234)
--      să accepte și telefon mobil RO, DOAR când restaurantul are modulul
--      sms_notifications pornit + feature-ul de plan (altfel am „arde"
--      reminder_sent_at fără să existe vreun canal de livrare).
--   B. Nimeni nu marchează no-show dacă staff-ul uită: auto_mark_reservation_
--      no_show (service_role, cron orar) trece 'confirmed' → 'no_show' după
--      o grație de 120 min de la starts_at. Doar 'confirmed': pending e
--      decizie de staff, seated înseamnă că clientul A venit.
--   C. Recidiviștii sunt invizibili: get_reservation_no_show_counts întoarce,
--      per telefon (ultimele 9 cifre — ACEEAȘI normalizare ca rate-limit-ul
--      mig 115/129; NU hash-ul loyalty, vezi capcana din CLAUDE.md), numărul
--      de no-show-uri istorice — badge de risc în ReservationsTab.
--
-- Trigger-ul trg_sms_reservation_confirmed (mig 228) NU se declanșează la
-- →no_show (enqueue doar pe →confirmed), deci auto-marcarea nu trimite SMS.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── A. claim_reservation_reminders — lanț 057→234 ────────────────────
-- Copia exactă a mig 057 cu O singură lărgire de eligibilitate: email
-- non-null SAU (mobil RO valid + modul SMS pornit + feature de plan).
-- Semnătura și forma de retur rămân identice (workerul citește ambele
-- canale din același rând).
create or replace function public.claim_reservation_reminders(
  p_batch_size integer default 100
)
returns table (
  id              uuid,
  restaurant_id   uuid,
  customer_name   text,
  customer_phone  text,
  customer_email  text,
  starts_at       timestamptz,
  party_size      smallint,
  confirmation_code text,
  restaurant_name text,
  restaurant_phone text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with claimed as (
    update public.reservations r
    set reminder_sent_at = now()
    where r.id in (
      select r2.id
      from public.reservations r2
      join public.reservation_settings s on s.restaurant_id = r2.restaurant_id
      where r2.status = 'confirmed'
        and r2.reminder_sent_at is null
        and (
          r2.customer_email is not null
          or (
            public.fn_sms_normalize_ro_phone(r2.customer_phone) is not null
            and public.is_module_enabled(r2.restaurant_id, 'sms_notifications')
            and public.restaurant_has_feature(r2.restaurant_id, 'sms_notifications')
          )
        )
        and r2.starts_at > now()
        and r2.starts_at <= now() + (s.reminder_hours_before || ' hours')::interval
      order by r2.starts_at asc
      limit p_batch_size
      for update of r2 skip locked
    )
    returning *
  )
  select
    c.id, c.restaurant_id,
    c.customer_name, c.customer_phone, c.customer_email,
    c.starts_at, c.party_size, c.confirmation_code,
    rest.name, rest.phone
  from claimed c
  join public.restaurants rest on rest.id = c.restaurant_id;
end;
$$;

revoke all on function public.claim_reservation_reminders(integer) from public;
revoke all on function public.claim_reservation_reminders(integer) from anon, authenticated;
grant execute on function public.claim_reservation_reminders(integer) to service_role;

-- ── B. auto_mark_reservation_no_show — cron orar, service_role ───────
-- Grația are podea de 30 min (anti-configurare accidentală agresivă).
-- Întoarce numărul de rezervări marcate (pentru results-ul cron-ului).
create or replace function public.auto_mark_reservation_no_show(
  p_grace_minutes integer default 120
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.reservations r
  set status = 'no_show'
  where r.status = 'confirmed'
    and r.starts_at < now() - make_interval(mins => greatest(coalesce(p_grace_minutes, 120), 30));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.auto_mark_reservation_no_show(integer) from public;
revoke all on function public.auto_mark_reservation_no_show(integer) from anon, authenticated;
grant execute on function public.auto_mark_reservation_no_show(integer) to service_role;

-- ── C. get_reservation_no_show_counts — badge de risc pentru staff ───
-- phone_key = ultimele 9 cifre (normalizarea din mig 115/129) — frontend-ul
-- calculează aceeași cheie din customer_phone-ul rezervării afișate.
-- Gate is_member: și ospătarul vede riscul (el preia clientul la ușă).
create or replace function public.get_reservation_no_show_counts(
  p_restaurant_id uuid
)
returns table (phone_key text, no_show_count bigint, last_no_show timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_member(p_restaurant_id) then
    raise exception 'Nu ai acces la acest restaurant';
  end if;

  return query
  select
    right(regexp_replace(r.customer_phone, '\D', '', 'g'), 9) as phone_key,
    count(*)::bigint as no_show_count,
    max(r.starts_at) as last_no_show
  from public.reservations r
  where r.restaurant_id = p_restaurant_id
    and r.status = 'no_show'
    and length(regexp_replace(r.customer_phone, '\D', '', 'g')) >= 9
  group by 1;
end;
$$;

revoke all on function public.get_reservation_no_show_counts(uuid) from public;
revoke all on function public.get_reservation_no_show_counts(uuid) from anon;
grant execute on function public.get_reservation_no_show_counts(uuid) to authenticated;

-- ── Asserții fail-closed ─────────────────────────────────────────────
do $$
declare v_def text;
begin
  -- enumul are valoarea nouă (mig 233, fișier separat fără tranzacție)
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'sms_template_kind' and e.enumlabel = 'reservation_reminder'
  ) then
    raise exception 'mig 234: enumul sms_template_kind nu are reservation_reminder (mig 233 lipsă?)';
  end if;

  -- claim-ul păstrează canalul email ȘI a primit canalul SMS gate-uit
  v_def := pg_get_functiondef('public.claim_reservation_reminders(integer)'::regprocedure);
  if v_def not ilike '%customer_email is not null%'
     or v_def not ilike '%fn_sms_normalize_ro_phone%'
     or v_def not ilike '%is_module_enabled%'
     or v_def not ilike '%restaurant_has_feature%' then
    raise exception 'mig 234: claim_reservation_reminders nu are ambele canale gate-uite';
  end if;

  -- auto-mark: doar service_role, doar confirmed
  if has_function_privilege('anon', 'public.auto_mark_reservation_no_show(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.auto_mark_reservation_no_show(integer)', 'execute') then
    raise exception 'mig 234: auto_mark_reservation_no_show accesibil non-service_role';
  end if;
  v_def := pg_get_functiondef('public.auto_mark_reservation_no_show(integer)'::regprocedure);
  if v_def not like '%''confirmed''%' or v_def not like '%no_show%' then
    raise exception 'mig 234: auto_mark_reservation_no_show nu țintește confirmed→no_show';
  end if;

  -- counts: gate is_member prezent, anon fără EXECUTE
  v_def := pg_get_functiondef('public.get_reservation_no_show_counts(uuid)'::regprocedure);
  if v_def not ilike '%is_member%' then
    raise exception 'mig 234: get_reservation_no_show_counts fără gate is_member';
  end if;
  if has_function_privilege('anon', 'public.get_reservation_no_show_counts(uuid)', 'execute') then
    raise exception 'mig 234: get_reservation_no_show_counts accesibil anon';
  end if;

  raise notice 'mig 234: no-show rezervări (reminder SMS + auto-mark + recidiviști) OK';
end $$;

commit;
