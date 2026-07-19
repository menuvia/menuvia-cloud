-- ═══════════════════════════════════════════════════════════════════
-- Migration 220: process_lifecycle_events — plan_changed NO-OP (stop zgomot audit)
-- ─────────────────────────────────────────────────────────────────────
-- BUG (audit Stripe, MEDIUM): stripe-webhook.js inserează un lifecycle event
-- `plan_changed` la FIECARE schimbare de plan (upgrade/downgrade), dar
-- process_lifecycle_events nu are ramură pentru el → cade în `else` și scrie
-- `process_error = 'unknown_event_type: plan_changed'` pe fiecare schimbare de plan
-- (zgomot fals în audit, exact ca invoice_paid înainte de mig 216). plan_changed e
-- eveniment pur de audit — nu trebuie să emită email.
--
-- Fix: ramură NO-OP explicită `when 'plan_changed' then null;` (identic cu invoice_paid,
-- mig 216). Redefinire = COPIE EXACTĂ a mig 216 + o ramură. Fără schimbare de schemă.
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.process_lifecycle_events(p_batch_size int default 50)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  evt record;
  v_email text;
  v_name  text;
  v_processed int := 0;
begin
  for evt in
    select e.*
    from public.lifecycle_events e
    where e.processed_at is null
      and e.process_attempts < 3
    order by e.created_at asc
    limit p_batch_size
    for update skip locked
  loop
    begin
      select email, full_name into v_email, v_name
      from public.profiles where id = evt.user_id;

      if v_email is null then
        update public.lifecycle_events
           set processed_at = now(),
               process_error = 'no_email_for_user',
               process_attempts = process_attempts + 1
         where id = evt.id;
        continue;
      end if;

      case evt.event_type
        when 'first_product_added' then
          null;

        when 'first_paid_order' then
          perform public.enqueue_email(
            v_email,
            'milestone_first_month'::email_template_kind,
            jsonb_build_object('owner_name', v_name) || evt.event_data,
            evt.user_id, v_name, null,
            'first_order:' || evt.restaurant_id::text
          );

        when 'milestone_100_orders' then
          perform public.enqueue_email(
            v_email, 'milestone_100_orders'::email_template_kind,
            jsonb_build_object('owner_name', v_name) || evt.event_data,
            evt.user_id, v_name, null,
            'm100:' || evt.restaurant_id::text
          );

        when 'milestone_1000_orders' then
          perform public.enqueue_email(
            v_email, 'milestone_1000_orders'::email_template_kind,
            jsonb_build_object('owner_name', v_name) || evt.event_data,
            evt.user_id, v_name, null,
            'm1000:' || evt.restaurant_id::text
          );

        when 'trial_ending_soon' then
          perform public.enqueue_email(
            v_email, 'trial_ending_3d'::email_template_kind,
            jsonb_build_object('owner_name', v_name) || evt.event_data,
            evt.user_id, v_name, null,
            'trial_end:' || evt.user_id::text
          );

        when 'payment_failed' then
          perform public.enqueue_email(
            v_email, 'payment_failed'::email_template_kind,
            jsonb_build_object('owner_name', v_name) || evt.event_data,
            evt.user_id, v_name, null,
            -- dedup per FACTURĂ+attempt (ca payment_recovered): cheia veche
            -- 'pmt_fail:user:attempt' se repeta identic la al doilea episod de
            -- dunning (attempt-urile reincep de la 1) → on conflict do nothing
            -- inghitea toate emailurile, bucla de dunning murea de la al 2-lea
            -- esec incolo (audit sapt. 10). invoice_id il face unic per ciclu.
            'pmt_fail:' || evt.user_id::text || ':'
              || coalesce(evt.event_data->>'invoice_id', evt.id::text)
              || ':' || coalesce(evt.event_data->>'attempt', '0')
          );

        when 'payment_recovered' then
          perform public.enqueue_email(
            v_email, 'payment_recovered'::email_template_kind,
            jsonb_build_object('owner_name', v_name) || evt.event_data,
            evt.user_id, v_name, null,
            'pmt_recovered:' || evt.user_id::text || ':' || coalesce(evt.event_data->>'invoice_id', evt.id::text)
          );

        when 'invoice_paid' then
          -- NO-OP (mig 216): sursa comisioanelor de afiliere, tratată în webhook.
          null;

        when 'plan_changed' then
          -- NO-OP (mig 220): eveniment pur de audit emis de stripe-webhook.js la
          -- schimbarea planului — fără email. Fără el cădea în `else` scriind
          -- `unknown_event_type: plan_changed` pe fiecare upgrade/downgrade.
          null;

        when 'subscription_started' then
          perform public.enqueue_email(
            v_email, 'welcome'::email_template_kind,
            jsonb_build_object('owner_name', v_name) || evt.event_data,
            evt.user_id, v_name, null,
            'welcome:' || evt.user_id::text
          );

        when 'subscription_cancelled' then
          perform public.enqueue_email(
            v_email, 'subscription_cancelled'::email_template_kind,
            jsonb_build_object('owner_name', v_name) || evt.event_data,
            evt.user_id, v_name, null,
            'lifecycle:subscription_cancelled:' || evt.id::text
          );

        when 'health_critical' then
          null;

        else
          update public.lifecycle_events
             set process_error = 'unknown_event_type: ' || evt.event_type
           where id = evt.id;
      end case;

      update public.lifecycle_events
         set processed_at = now()
       where id = evt.id;

      v_processed := v_processed + 1;
    exception when others then
      update public.lifecycle_events
         set process_attempts = process_attempts + 1,
             process_error = SQLERRM,
             processed_at = case
               when process_attempts + 1 >= 3 then now()
               else processed_at
             end
       where id = evt.id;
    end;
  end loop;

  return v_processed;
end;
$$;

revoke all on function public.process_lifecycle_events(int) from public;

-- ── Asserție fail-closed: toate ramurile no-op + dunning prezente ──
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.process_lifecycle_events(int)'::regprocedure);
  if position($q$when 'plan_changed' then$q$ in v_def) = 0 then
    raise exception 'ASSERT FAIL: process_lifecycle_events fără no-op-ul plan_changed (mig 220)';
  end if;
  if position($q$when 'invoice_paid' then$q$ in v_def) = 0
     or position('payment_recovered' in v_def) = 0 then
    raise exception 'ASSERT FAIL: process_lifecycle_events a pierdut ramuri din mig 216';
  end if;
end $$;

commit;
