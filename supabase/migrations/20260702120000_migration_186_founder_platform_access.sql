-- mig 186 — Fundația founder: acces platform-admin peste tot + audit + RPC-uri admin_*
-- ─────────────────────────────────────────────────────────────────────
-- Fondatorul (profiles.is_platform_admin, mig 168) trebuie să poată VEDEA tot
-- și MODIFICA tot: intră pe contul oricărui restaurant, schimbă planuri,
-- reîncearcă email-uri/facturi blocate, marchează payout-uri, vede health global.
--
-- Mecanism de impersonare (ieftin arhitectural): is_admin/is_member/my_role
-- (mig 096a) sunt funcțiile centrale prin care trec TOATE RLS-urile și
-- RPC-urile → le redefinim O DATĂ cu `or is_platform_admin()` și fondatorul
-- primește acces admin peste tot, fără să atingem zecile de policies.
--
-- Transparență: acțiunile de modificare din RPC-urile admin_* se scriu în
-- `platform_audit_log` (cine, pe ce restaurant, ce acțiune, când).
--
-- Convenția lockdown (CLAUDE.md): SECURITY DEFINER, search_path = public,
-- pg_temp, PUBLIC zero EXECUTE, gate is_platform_admin() la începutul
-- fiecărui RPC, idempotent, asserții fail-closed.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ═══════════════════════════════════════════════════════════════════
-- Sec 1. is_admin / is_member / my_role + is_platform_admin()
--   Semnături IDENTICE cu mig 096a (CREATE OR REPLACE păstrează grants;
--   le re-aplicăm defensiv la final, ca în 096a: revoke public/anon/
--   service_role, grant authenticated).
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.is_admin(p_restaurant_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.restaurants
     where id = p_restaurant_id and owner_id = auth.uid()
  ) or exists (
    select 1 from public.restaurant_memberships rm
     where rm.restaurant_id = p_restaurant_id
       and rm.user_id = auth.uid()
       and rm.role = 'manager'::public.member_role
  )
  -- Fondatorul platformei are acces admin pe ORICE restaurant (mod fondator).
  or public.is_platform_admin()
$$;

create or replace function public.is_member(p_restaurant_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.restaurants
     where id = p_restaurant_id and owner_id = auth.uid()
  ) or exists (
    select 1 from public.restaurant_memberships rm
     where rm.restaurant_id = p_restaurant_id
       and rm.user_id = auth.uid()
  )
  or public.is_platform_admin()
$$;

create or replace function public.my_role(p_restaurant_id uuid)
returns public.member_role
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case
    when exists (
      select 1 from public.restaurants
       where id = p_restaurant_id and owner_id = auth.uid()
    ) then 'owner'::public.member_role
    -- Membership real are prioritate; fondatorul FĂRĂ membership pe acest
    -- restaurant capătă rol virtual de manager (nu owner — owner-ul rămâne
    -- ancorat pe restaurants.owner_id, imuabil per mig 096).
    else coalesce(
      (
        select rm.role from public.restaurant_memberships rm
         where rm.restaurant_id = p_restaurant_id
           and rm.user_id = auth.uid()
           and rm.role <> 'owner'::public.member_role
         limit 1
      ),
      case when public.is_platform_admin()
           then 'manager'::public.member_role
           else null end
    )
  end
$$;

revoke all on function public.is_admin(uuid)  from public, anon, service_role;
revoke all on function public.is_member(uuid) from public, anon, service_role;
revoke all on function public.my_role(uuid)   from public, anon, service_role;
grant execute on function public.is_admin(uuid)  to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.my_role(uuid)   to authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- Sec 2. platform_audit_log — cine a modificat ce, în mod fondator/partener
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.platform_audit_log (
  id             uuid primary key default gen_random_uuid(),
  actor_user_id  uuid not null references public.profiles(id) on delete restrict,
  actor_kind     text not null default 'founder' check (actor_kind in ('founder','affiliate')),
  restaurant_id  uuid references public.restaurants(id) on delete set null,
  action         text not null,
  details        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists idx_platform_audit_restaurant
  on public.platform_audit_log(restaurant_id, created_at desc);
create index if not exists idx_platform_audit_created
  on public.platform_audit_log(created_at desc);

alter table public.platform_audit_log enable row level security;

-- Doar fondatorul citește auditul. Scrierea trece EXCLUSIV prin
-- log_platform_action (SECURITY DEFINER) — fără policy de INSERT.
drop policy if exists platform_audit_founder_read on public.platform_audit_log;
create policy platform_audit_founder_read
  on public.platform_audit_log for select
  using (public.is_platform_admin());

-- Helper interior (nu e expus): apelat din RPC-urile admin_* de mai jos.
create or replace function public.log_platform_action(
  p_actor_kind    text,
  p_restaurant_id uuid,
  p_action        text,
  p_details       jsonb default '{}'::jsonb
)
returns void
language sql security definer
set search_path = public, pg_temp
as $$
  insert into public.platform_audit_log (actor_user_id, actor_kind, restaurant_id, action, details)
  values (auth.uid(), p_actor_kind, p_restaurant_id, p_action, coalesce(p_details, '{}'::jsonb))
$$;

revoke all on function public.log_platform_action(text, uuid, text, jsonb)
  from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════
-- Sec 3. RPC-uri founder (gate is_platform_admin pe fiecare)
-- ═══════════════════════════════════════════════════════════════════

-- 3a. Overview KPI global — un singur apel pentru ecranul principal.
create or replace function public.admin_platform_overview()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;

  return jsonb_build_object(
    'restaurants_total',  (select count(*) from public.restaurants),
    'restaurants_active', (select count(*) from public.restaurants where is_active),
    'restaurants_by_plan', (
      select coalesce(jsonb_object_agg(plan, cnt), '{}'::jsonb)
        from (
          select p.plan, count(*) as cnt
            from public.restaurants r
            join public.profiles p on p.id = r.owner_id
           group by p.plan
        ) t
    ),
    'orders_today', (
      select count(*) from public.orders
       where created_at >= date_trunc('day', now())
    ),
    'reservations_today', (
      select count(*) from public.reservations
       where starts_at >= date_trunc('day', now())
         and starts_at <  date_trunc('day', now()) + interval '1 day'
    ),
    'emails_failed',   (select count(*) from public.email_queue where status = 'failed'),
    'invoices_failed', (select count(*) from public.invoices    where status = 'failed'),
    'payouts_open', (
      select count(*) from public.affiliate_payouts
       where status not in ('paid', 'canceled')
    ),
    'health_critical', (
      select count(*) from public.customer_health_scores where score < 50
    )
  );
end;
$$;

-- 3b. Toate restaurantele + plan + health + activitate.
create or replace function public.admin_list_restaurants()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;

  return coalesce((
    select jsonb_agg(row_data order by row_data->>'name')
      from (
        select jsonb_build_object(
          'restaurant_id', r.id,
          'name',          r.name,
          'slug',          r.slug,
          'city',          r.city,
          'is_active',     r.is_active,
          'plan',          p.plan,
          'owner_email',   p.email,
          'health_score',  h.score,
          'health_trend',  h.trend,
          'orders_7d', (
            select count(*) from public.orders o
             where o.restaurant_id = r.id
               and o.created_at >= now() - interval '7 days'
          ),
          'created_at',    r.created_at
        ) as row_data
          from public.restaurants r
          join public.profiles p on p.id = r.owner_id
          left join public.customer_health_scores h on h.restaurant_id = r.id
      ) rows
  ), '[]'::jsonb);
end;
$$;

-- 3c. Health global cu breakdown.
create or replace function public.admin_list_health()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'restaurant_id',   h.restaurant_id,
             'restaurant_name', r.name,
             'score',           h.score,
             'trend',           h.trend,
             'score_login',     h.score_login,
             'score_orders',    h.score_orders,
             'score_team',      h.score_team,
             'score_tickets',   h.score_tickets,
             'score_engagement',h.score_engagement,
             'computed_at',     h.computed_at
           ) order by h.score asc)
      from public.customer_health_scores h
      join public.restaurants r on r.id = h.restaurant_id
  ), '[]'::jsonb);
end;
$$;

-- 3d. Email-uri eșuate (dead-letter) + retrimitere.
create or replace function public.admin_list_email_failures()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',              e.id,
             'recipient_email', e.recipient_email,
             'template_kind',   e.template_kind,
             'failed_attempts', e.failed_attempts,
             'last_error',      e.last_error,
             'scheduled_for',   e.scheduled_for,
             'created_at',      e.created_at
           ) order by e.created_at desc)
      from public.email_queue e
     where e.status = 'failed'
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_retry_email(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;

  update public.email_queue
     set status = 'queued',
         failed_attempts = 0,
         last_error = null,
         scheduled_for = now()
   where id = p_id and status = 'failed';
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return jsonb_build_object('ok', false, 'error', 'Emailul nu există sau nu e în stare failed');
  end if;

  perform public.log_platform_action('founder', null, 'retry_email', jsonb_build_object('email_id', p_id));
  return jsonb_build_object('ok', true);
end;
$$;

-- 3e. Facturi Oblio eșuate + reîncercare.
create or replace function public.admin_list_invoice_failures()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',              i.id,
             'restaurant_id',   i.restaurant_id,
             'restaurant_name', r.name,
             'customer_name',   i.customer_name,
             'total_with_vat',  i.total_with_vat,
             'currency',        i.currency,
             'failed_attempts', i.failed_attempts,
             'last_error',      i.last_error,
             'created_at',      i.created_at
           ) order by i.created_at desc)
      from public.invoices i
      join public.restaurants r on r.id = i.restaurant_id
     where i.status = 'failed'
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_retry_invoice(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant uuid;
  v_updated integer;
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;

  update public.invoices
     set status = 'queued',
         failed_attempts = 0,
         last_error = null,
         next_attempt_at = null
   where id = p_id and status = 'failed'
  returning restaurant_id into v_restaurant;
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return jsonb_build_object('ok', false, 'error', 'Factura nu există sau nu e în stare failed');
  end if;

  perform public.log_platform_action('founder', v_restaurant, 'retry_invoice', jsonb_build_object('invoice_id', p_id));
  return jsonb_build_object('ok', true);
end;
$$;

-- 3f. Payout-uri afiliați (toate stările) + marcare plătit.
create or replace function public.admin_list_payouts()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',               ap.id,
             'affiliate_id',     ap.affiliate_id,
             'affiliate_email',  p.email,
             'status',           ap.status,
             'gross_cents',      ap.gross_cents,
             'currency',         ap.currency,
             'invoice_number',   ap.invoice_number,
             'wise_transfer_id', ap.wise_transfer_id,
             'failure_reason',   ap.failure_reason,
             'paid_at',          ap.paid_at,
             'created_at',       ap.created_at
           ) order by ap.created_at desc)
      from public.affiliate_payouts ap
      join public.affiliates a on a.id = ap.affiliate_id
      join public.profiles  p on p.id = a.profile_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_mark_payout_paid(
  p_id uuid,
  p_wise_transfer_id text default null
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;

  -- Doar din stările pre-terminale permise de state machine (mig 098):
  -- processing / on_hold → paid. Tranzițiile invalide sunt oricum respinse
  -- de trg_affiliate_payout_transition; filtrăm aici pentru un mesaj clar.
  update public.affiliate_payouts
     set status = 'paid',
         wise_transfer_id = coalesce(p_wise_transfer_id, wise_transfer_id)
   where id = p_id and status in ('processing', 'on_hold');
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return jsonb_build_object('ok', false,
      'error', 'Payout inexistent sau într-o stare din care nu se poate marca plătit (permise: processing, on_hold)');
  end if;

  perform public.log_platform_action('founder', null, 'mark_payout_paid',
    jsonb_build_object('payout_id', p_id, 'wise_transfer_id', p_wise_transfer_id));
  return jsonb_build_object('ok', true);
end;
$$;

-- 3g. Afiliați: arbore (parent → sub-afiliați) + restaurantele atribuite + sold.
--   Restaurantele unui afiliat = atribuirile lui → referred_profile_id →
--   restaurants.owner_id (atribuirea e pe PROFIL, nu direct pe restaurant).
create or replace function public.admin_list_affiliates()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'affiliate_id',        a.id,
             'email',               p.email,
             'full_name',           p.full_name,
             'referral_code',       a.referral_code,
             'status',              a.status,
             'parent_affiliate_id', a.parent_affiliate_id,
             'balance_ron_cents', (
               select coalesce(sum(l.amount_cents), 0)
                 from public.affiliate_ledger l
                where l.affiliate_id = a.id and l.currency = 'RON'
             ),
             'restaurants', (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'restaurant_id', r.id,
                        'name',          r.name,
                        'slug',          r.slug,
                        'plan',          op.plan,
                        'is_active',     r.is_active
                      ) order by r.name), '[]'::jsonb)
                 from public.affiliate_attributions aa
                 join public.restaurants r on r.owner_id = aa.referred_profile_id
                 join public.profiles op on op.id = r.owner_id
                where aa.affiliate_id = a.id
             ),
             'created_at',          a.created_at
           ) order by a.created_at)
      from public.affiliates a
      join public.profiles p on p.id = a.profile_id
  ), '[]'::jsonb);
end;
$$;

-- 3h. Schimbă planul unui restaurant (scrie profiles.plan pe owner).
--   Notă: webhook-ul Stripe poate suprascrie la următorul eveniment de
--   abonament — override-ul manual e pentru corecții/demo/parteneriate.
create or replace function public.admin_set_restaurant_plan(
  p_restaurant_id uuid,
  p_plan text
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_old_plan text;
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;

  if p_plan not in ('free', 'starter', 'growth', 'pro', 'enterprise') then
    return jsonb_build_object('ok', false, 'error', 'Plan necunoscut: ' || coalesce(p_plan, 'null'));
  end if;

  select owner_id into v_owner from public.restaurants where id = p_restaurant_id;
  if v_owner is null then
    return jsonb_build_object('ok', false, 'error', 'Restaurant inexistent');
  end if;

  select plan into v_old_plan from public.profiles where id = v_owner;

  update public.profiles set plan = p_plan where id = v_owner;

  perform public.log_platform_action('founder', p_restaurant_id, 'set_plan',
    jsonb_build_object('old_plan', v_old_plan, 'new_plan', p_plan, 'owner_id', v_owner));
  return jsonb_build_object('ok', true, 'old_plan', v_old_plan, 'new_plan', p_plan);
end;
$$;

-- 3i. Activează/dezactivează un restaurant.
create or replace function public.admin_toggle_restaurant_active(
  p_restaurant_id uuid,
  p_active boolean
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;

  update public.restaurants set is_active = p_active where id = p_restaurant_id;
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return jsonb_build_object('ok', false, 'error', 'Restaurant inexistent');
  end if;

  perform public.log_platform_action('founder', p_restaurant_id, 'toggle_active',
    jsonb_build_object('active', p_active));
  return jsonb_build_object('ok', true);
end;
$$;

-- 3j. Auditul recent (pentru secțiunea Audit din FounderPage).
create or replace function public.admin_list_audit_log(p_limit integer default 100)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;

  return coalesce((
    select jsonb_agg(row_data)
      from (
        select jsonb_build_object(
                 'id',            l.id,
                 'actor_email',   p.email,
                 'actor_kind',    l.actor_kind,
                 'restaurant_id', l.restaurant_id,
                 'restaurant_name', r.name,
                 'action',        l.action,
                 'details',       l.details,
                 'created_at',    l.created_at
               ) as row_data
          from public.platform_audit_log l
          join public.profiles p on p.id = l.actor_user_id
          left join public.restaurants r on r.id = l.restaurant_id
         order by l.created_at desc
         limit greatest(1, least(coalesce(p_limit, 100), 500))
      ) rows
  ), '[]'::jsonb);
end;
$$;

-- ── Grants: PUBLIC/anon/service_role zero; doar authenticated (gate-ul
--    real e is_platform_admin() în corpul fiecărei funcții). ────────────
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'admin_platform_overview()',
    'admin_list_restaurants()',
    'admin_list_health()',
    'admin_list_email_failures()',
    'admin_retry_email(uuid)',
    'admin_list_invoice_failures()',
    'admin_retry_invoice(uuid)',
    'admin_list_payouts()',
    'admin_mark_payout_paid(uuid, text)',
    'admin_list_affiliates()',
    'admin_set_restaurant_plan(uuid, text)',
    'admin_toggle_restaurant_active(uuid, boolean)',
    'admin_list_audit_log(integer)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon, service_role', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════
-- Asserții fail-closed
-- ═══════════════════════════════════════════════════════════════════
do $$
declare
  fn text;
begin
  -- 1. is_admin / is_member / my_role conțin escape-ul de platform admin.
  foreach fn in array array['is_admin', 'is_member', 'my_role'] loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = fn
         and pg_get_functiondef(p.oid) ilike '%is_platform_admin%'
    ) then
      raise exception 'mig 186: %() nu conține escape-ul is_platform_admin', fn;
    end if;
  end loop;

  -- 2. Tabelul de audit există, cu RLS pornit.
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'platform_audit_log' and c.relrowsecurity
  ) then
    raise exception 'mig 186: platform_audit_log lipsește sau RLS oprit';
  end if;

  -- 3. Fiecare RPC admin_* există și are gate-ul în corp.
  foreach fn in array array[
    'admin_platform_overview', 'admin_list_restaurants', 'admin_list_health',
    'admin_list_email_failures', 'admin_retry_email',
    'admin_list_invoice_failures', 'admin_retry_invoice',
    'admin_list_payouts', 'admin_mark_payout_paid', 'admin_list_affiliates',
    'admin_set_restaurant_plan', 'admin_toggle_restaurant_active', 'admin_list_audit_log'
  ] loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = fn
         and pg_get_functiondef(p.oid) ilike '%is_platform_admin%'
    ) then
      raise exception 'mig 186: %() lipsește sau nu are gate is_platform_admin', fn;
    end if;
  end loop;

  -- 4. anon nu poate executa niciun RPC admin_*.
  if has_function_privilege('anon', 'public.admin_platform_overview()', 'EXECUTE') then
    raise exception 'mig 186: anon poate executa admin_platform_overview';
  end if;
  if has_function_privilege('anon', 'public.admin_set_restaurant_plan(uuid, text)', 'EXECUTE') then
    raise exception 'mig 186: anon poate executa admin_set_restaurant_plan';
  end if;

  -- 5. log_platform_action nu e executabil de nimeni din exterior.
  if has_function_privilege('authenticated', 'public.log_platform_action(text, uuid, text, jsonb)', 'EXECUTE') then
    raise exception 'mig 186: authenticated poate executa log_platform_action direct';
  end if;

  raise notice 'mig 186: fundația founder OK';
end $$;

commit;
