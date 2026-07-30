-- ═══════════════════════════════════════════════════════════════════
-- Migration 215: claim_reservation_reminders — reclaim la kill de proces
-- ─────────────────────────────────────────────────────────────────────
-- BUG (audit reziliență): claim_reservation_reminders (mig 057) marchează atomic
-- reminder_sent_at=now() pentru TOATE cele ≤50 de rânduri revendicate ÎNAINTE de
-- bucla de enqueue one-by-one din send-reservation-reminders.js. Reset-ul pe eșec
-- (funcția Netlify) acoperă DOAR erorile prinse per-item — NU cazul în care
-- procesul e OMORÂT la mijloc (timeout Netlify = hard kill, crash/OOM): rândurile
-- revendicate-dar-neprocesate rămân cu reminder_sent_at setat permanent, iar
-- filtrul de claim (reminder_sent_at IS NULL) nu le mai vede niciodată →
-- reminder pierdut TĂCUT.
--
-- Fix (pattern mig 167 pentru email_queue): înainte de a revendica un lot nou,
-- RECLAIM-ăm rândurile blocate — reset reminder_sent_at=NULL pentru rezervările
-- confirmate, încă viitoare, revendicate acum >15 min (deci nu un lot în curs) al
-- căror reminder NU a ajuns în email_queue (dedup_key `reservation_reminder:<id>`
-- lipsește). enqueue_email e idempotent pe dedup_key (on conflict do nothing),
-- deci reclaim-ul e SIGUR: chiar dacă reprocesăm o rezervare al cărei email
-- apucase să fie enqueue-uit, re-enqueue-ul nu produce un duplicat.
--
-- Redefinire = COPIE EXACTĂ a claim-ului din mig 057 + pasul de reclaim la început.
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

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
  -- ── Reclaim (mig 215): rândurile revendicate-dar-neprocesate la un kill de
  -- proces. reminder_sent_at setat >15 min în urmă (un lot normal se termină în
  -- secunde), rezervarea încă validă pentru reminder, DAR emailul nu a ajuns în
  -- coadă → l-am pierdut; îl re-eliberăm. Sigur prin idempotența dedup_key.
  update public.reservations r
     set reminder_sent_at = null
   where r.reminder_sent_at is not null
     and r.reminder_sent_at < now() - interval '15 minutes'
     and r.status = 'confirmed'
     and r.customer_email is not null
     and r.starts_at > now()
     and not exists (
       select 1 from public.email_queue eq
        where eq.dedup_key = 'reservation_reminder:' || r.id::text
     );

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
        and r2.customer_email is not null
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
grant execute on function public.claim_reservation_reminders(integer) to service_role;

-- ── Asserție fail-closed: pasul de reclaim e prezent ─────────────────
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.claim_reservation_reminders(integer)'::regprocedure);
  if position('reservation_reminder:' in v_def) = 0
     or position('15 minutes' in v_def) = 0 then
    raise exception 'ASSERT FAIL: claim_reservation_reminders fără pasul de reclaim (mig 215)';
  end if;
  if has_function_privilege('anon', 'public.claim_reservation_reminders(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_reservation_reminders(integer)', 'execute') then
    raise exception 'ASSERT FAIL: claim_reservation_reminders trebuie să rămână service_role-only';
  end if;
end $$;

commit;
