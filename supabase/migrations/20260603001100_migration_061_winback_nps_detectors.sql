-- Migration 061: Detector RPC pentru win-back + NPS automation
-- ─────────────────────────────────────────────────────────────────────
-- Completează automation-cron cu 2 jobs noi care identifică:
--   1. Restaurante inactive (0 comenzi în 7+ sau 30+ zile) → win_back email
--   2. Useri la 60 zile post-signup care n-au primit încă NPS survey
--
-- Pattern: SQL face DETECȚIA + enqueue_email; automation-cron.js doar
-- apelează RPC + log rezultate. Idempotent via dedup_key pe enqueue_email.

-- ─────────────────────────────────────────────────────────────────────
-- 1. detect_winback_inactive — scan restaurants + enqueue win-back
-- ─────────────────────────────────────────────────────────────────────
-- Două praguri (match enum email_template_kind existent):
--   win_back_7d  — restaurante cu 0 comenzi în ultimele 7-29 zile
--   win_back_30d — restaurante cu 0 comenzi în ultimele 30+ zile
--
-- Dedup_key: `wb7:<rest_id>:<YYYY-MM>` / `wb30:<rest_id>:<YYYY-MM>` →
-- max 1 email per restaurant per lună pe fiecare prag.
-- Asta evită spamul dacă cron-ul rulează zilnic.

create or replace function public.detect_winback_inactive()
returns table (
  enqueued_7d  integer,
  enqueued_30d integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_last_order timestamptz;
  v_days_since int;
  v_month_tag  text := to_char(now(), 'YYYY-MM');
  v_7d_count   int := 0;
  v_30d_count  int := 0;
begin
  for r in
    select rest.id, rest.owner_id, rest.name as restaurant_name,
           p.email as owner_email, p.full_name as owner_name
      from public.restaurants rest
      join public.profiles p on p.id = rest.owner_id
     where rest.is_active = true
       and p.email is not null
  loop
    -- Last paid order (paid_at preferred, fallback created_at)
    select coalesce(max(paid_at), max(created_at))
      into v_last_order
      from public.orders
     where restaurant_id = r.id
       and status not in ('cancelled');

    -- Restaurant cu ZERO comenzi vreodată = nu trigger win-back (e onboarding-flow,
    -- nu inactivity-flow; există template `onboarding_no_orders` separat).
    if v_last_order is null then
      continue;
    end if;

    v_days_since := extract(day from (now() - v_last_order));

    -- 30+ zile: win_back_30d (prioritar — un patron poate fi în ambele praguri)
    if v_days_since >= 30 then
      perform public.enqueue_email(
        r.owner_email,
        'win_back_30d'::email_template_kind,
        jsonb_build_object(
          'owner_name', coalesce(r.owner_name, 'Stimate patron'),
          'restaurant_name', r.restaurant_name,
          'days_since_last_order', v_days_since,
          'last_order_at', v_last_order
        ),
        r.owner_id,
        r.owner_name,
        null,
        'wb30:' || r.id::text || ':' || v_month_tag
      );
      v_30d_count := v_30d_count + 1;

    -- 7-29 zile: win_back_7d
    elsif v_days_since >= 7 then
      perform public.enqueue_email(
        r.owner_email,
        'win_back_7d'::email_template_kind,
        jsonb_build_object(
          'owner_name', coalesce(r.owner_name, 'Stimate patron'),
          'restaurant_name', r.restaurant_name,
          'days_since_last_order', v_days_since,
          'last_order_at', v_last_order
        ),
        r.owner_id,
        r.owner_name,
        null,
        'wb7:' || r.id::text || ':' || v_month_tag
      );
      v_7d_count := v_7d_count + 1;
    end if;
  end loop;

  return query select v_7d_count, v_30d_count;
end;
$$;

revoke all on function public.detect_winback_inactive() from public;
grant execute on function public.detect_winback_inactive() to service_role;

comment on function public.detect_winback_inactive() is
  'Cron: scan restaurants → enqueue win_back_7d sau win_back_30d în '
  'email_queue. Dedup_key per lună evită spam. Apelat zilnic.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. detect_nps_due — useri la 60 zile post-signup
-- ─────────────────────────────────────────────────────────────────────
-- Trigger când: profile.created_at < now() - 60 days AND no nps email
-- ever sent (dedup_key lifetime: `nps:<user_id>`).
-- Folosim profiles.created_at (sincronizat cu auth.users prin trigger
-- la signup în migration 011).

create or replace function public.detect_nps_due()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  u record;
  v_count int := 0;
begin
  for u in
    select p.id, p.email, p.full_name, p.created_at,
           -- ia primul restaurant ca să avem context (nume) în email
           (select name from public.restaurants
             where owner_id = p.id
             order by created_at asc limit 1) as primary_restaurant
      from public.profiles p
     where p.email is not null
       and p.created_at < now() - interval '60 days'
       and not exists (
         -- Skip dacă deja avem nps în email_queue (cu orice status)
         select 1 from public.email_queue
          where user_id = p.id
            and template_kind = 'nps_survey'
       )
  loop
    perform public.enqueue_email(
      u.email,
      'nps_survey'::email_template_kind,
      jsonb_build_object(
        'owner_name', coalesce(u.full_name, 'Stimate utilizator'),
        'restaurant_name', coalesce(u.primary_restaurant, 'Menuvia'),
        'days_since_signup', extract(day from (now() - u.created_at)),
        -- user_id în template_data pentru mailto link (process-email-queue
        -- nu merge-uiește user_id col automat în render context)
        'user_id', u.id::text
      ),
      u.id,
      u.full_name,
      null,
      'nps:' || u.id::text
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.detect_nps_due() from public;
grant execute on function public.detect_nps_due() to service_role;

comment on function public.detect_nps_due() is
  'Cron: scan profiles cu signup > 60 zile fără NPS în email_queue → '
  'enqueue nps_survey. Dedup_key lifetime (`nps:<user_id>`).';

-- ─────────────────────────────────────────────────────────────────────
-- Verificare manuală:
-- ─────────────────────────────────────────────────────────────────────
-- -- Forced test win-back: face un restaurant să apară inactive
-- update orders set created_at = now() - interval '40 days',
--                   paid_at    = now() - interval '40 days'
--  where restaurant_id = '<test>' and status='paid';
-- select * from detect_winback_inactive();
-- -- → ar trebui să apară un rând cu enqueued_30d=1
-- select * from email_queue
--  where template_kind = 'win_back_30d' order by created_at desc limit 1;
--
-- -- Forced test NPS:
-- update profiles set created_at = now() - interval '61 days'
--  where id = '<test_user>';
-- select detect_nps_due();
-- -- → ar trebui să returneze ≥1
