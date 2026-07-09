-- ═══════════════════════════════════════════════════════════════════
-- Migration 216: dunning — emailul de RECUPERARE + tăcerea zgomotului invoice_paid
-- ─────────────────────────────────────────────────────────────────────
-- State machine-ul de dunning e deja solid (stripe-webhook.js): past_due ține
-- abonamentul VIU (grace), downgrade doar pe stări terminale, iar `payment_failed`
-- produce un email branded „⚠️ Plata nu s-a putut procesa" (mig 180 + template).
-- DAR bucla e incompletă: când cardul reușește în sfârșit (retry Stripe →
-- `invoice.paid` cu attempt_count>1), clientul care a primit emailul alarmant nu
-- mai primește NIMIC. Template-ul `payment_recovered` („✅ Plata s-a procesat cu
-- succes") EXISTĂ în process-email-queue.js și valoarea e DEJA în enum
-- email_template_kind (mig 039) — dar nimic nu-l emitea vreodată.
--
-- Fix (2 ramuri noi în process_lifecycle_events, redefinire = COPIE EXACTĂ a
-- mig 180 + cele 2 case-uri):
--   • `payment_recovered` → enqueue email de recuperare (dedup pe invoice_id, un
--     singur email per factură recuperată). stripe-webhook.js inserează acest
--     eveniment DOAR când invoice.attempt_count>1 (recuperare reală după ≥1 eșec).
--   • `invoice_paid` → NO-OP explicit. safeInsertLifecycleEvent('invoice_paid')
--     rulează la FIECARE factură plătită (sursa canonică pentru comisioanele de
--     afiliere, tratată integral în webhook), dar nu are ramură aici → cădea în
--     `else` și scria `unknown_event_type: invoice_paid` ca process_error pe
--     FIECARE ciclu recurent → zgomot fals în audit. Îl marcăm procesat curat.
--
-- Fără schimbare de schemă/enum — `payment_recovered` e deja în email_template_kind.
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
      -- Resolve recipient
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

      -- Dispatch by event_type → email template
      case evt.event_type
        when 'first_product_added' then
          -- skip — milestone too early for email
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
            'pmt_fail:' || evt.user_id::text || ':' || (evt.event_data->>'attempt')
          );

        when 'payment_recovered' then
          -- FIX (mig 216): închide bucla de dunning. Emis de stripe-webhook.js la
          -- invoice.paid cu attempt_count>1 (cardul a reușit după ≥1 eșec) →
          -- clientul care a primit emailul alarmant primește acum reasigurarea.
          -- Dedup pe invoice_id: un singur email per factură recuperată.
          perform public.enqueue_email(
            v_email, 'payment_recovered'::email_template_kind,
            jsonb_build_object('owner_name', v_name) || evt.event_data,
            evt.user_id, v_name, null,
            'pmt_recovered:' || evt.user_id::text || ':' || coalesce(evt.event_data->>'invoice_id', evt.id::text)
          );

        when 'invoice_paid' then
          -- FIX (mig 216): NO-OP explicit. Inserat la FIECARE factură plătită
          -- (sursa canonică pentru comisioanele de afiliere, tratată integral în
          -- stripe-webhook.js) — nu trebuie să emită email și nu mai trebuie să
          -- cadă în `else` scriind `unknown_event_type: invoice_paid` (zgomot fals
          -- în audit pe fiecare ciclu recurent).
          null;

        when 'subscription_started' then
          perform public.enqueue_email(
            v_email, 'welcome'::email_template_kind,
            jsonb_build_object('owner_name', v_name) || evt.event_data,
            evt.user_id, v_name, null,
            'welcome:' || evt.user_id::text
          );

        when 'subscription_cancelled' then
          -- FIX: emis de stripe-webhook.js la customer.subscription.deleted
          -- (downgrade la free) — nu mai cade tăcut în else.
          perform public.enqueue_email(
            v_email, 'subscription_cancelled'::email_template_kind,
            jsonb_build_object('owner_name', v_name) || evt.event_data,
            evt.user_id, v_name, null,
            'lifecycle:subscription_cancelled:' || evt.id::text
          );

        when 'health_critical' then
          -- Special: alert Radu, not user
          -- Handled by compute_health_scores directly
          null;

        else
          -- FIX: event_type necunoscut — nu mai marcăm "procesat" tăcut,
          -- scriem process_error ca să fie vizibil în audit.
          update public.lifecycle_events
             set process_error = 'unknown_event_type: ' || evt.event_type
           where id = evt.id;
      end case;

      update public.lifecycle_events
         set processed_at = now()
       where id = evt.id;

      v_processed := v_processed + 1;
    exception when others then
      -- FIX: la a 3-a eroare (process_attempts + 1 >= 3), setăm și
      -- processed_at = now() ca rândul să nu mai rămână zombie etern —
      -- rămâne vizibil în audit prin process_error = SQLERRM.
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

-- ── Asserție fail-closed: ambele ramuri noi de dunning sunt prezente ──
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.process_lifecycle_events(int)'::regprocedure);
  if position('payment_recovered' in v_def) = 0 then
    raise exception 'ASSERT FAIL: process_lifecycle_events fără ramura payment_recovered (mig 216)';
  end if;
  if position($q$when 'invoice_paid' then$q$ in v_def) = 0 then
    raise exception 'ASSERT FAIL: process_lifecycle_events fără no-op-ul invoice_paid (mig 216)';
  end if;
  -- payment_recovered trebuie să existe în enum ca ::cast-ul să se plane
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'email_template_kind' and e.enumlabel = 'payment_recovered'
  ) then
    raise exception 'ASSERT FAIL: email_template_kind fără valoarea payment_recovered';
  end if;
end $$;

commit;
