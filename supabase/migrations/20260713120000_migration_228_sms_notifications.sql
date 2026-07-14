-- Migration 228: SMS tranzacționale — confirmare rezervare + „comanda gata" la pickup
-- ─────────────────────────────────────────────────────────────────────
-- Clonă a pattern-ului email_queue (mig 039/162/167), pe canal separat:
--   • `sms_queue` — coadă proprie (destinatar = telefon; are restaurant_id
--     pentru plafonul LUNAR per restaurant, pe care email_queue nu-l are).
--   • enqueue prin DOUĂ triggere DB (rezervare confirmată; pickup → ready),
--     NU prin redefinirea create_reservation_public (lanț 151→199→201) sau
--     advance_order (twin 085/087) — ambele au lanțuri cu asserții fail-closed.
--   • Gate dublu server-side: modul opt-in `sms_notifications` (default OFF,
--     ownerul activează conștient — costul per SMS e al platformei) + plan
--     `plan_features[sms_notifications]` cu limit_value = plafon lunar
--     (free OFF; starter 100, growth 300, pro 500, enterprise 1000).
--   • enqueue_sms NU face raise pe NICIO ramură negativă (modul/plan/plafon/
--     telefon invalid → return null): e chemat din triggere pe căi critice
--     (insert rezervare, lifecycle comandă) — un eșec de SMS nu are voie să
--     avorteze tranzacția părinte. Triggerele sunt în plus exception-wrapped.
--   • Doar numere MOBILE RO (07xxxxxxxx după normalizarea din mig 226) —
--     controlează costul; restul = skip silențios.
--   • Livrarea: netlify/functions/process-sms-queue.js (cron * * * * *)
--     prin SMSO.ro; claim_sms_batch = oglinda claim_email_batch (mig 167,
--     FOR UPDATE SKIP LOCKED + reclaim stale-sending 10 min).
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── A. Enum + tabelă ─────────────────────────────────────────────────

create type public.sms_template_kind as enum ('reservation_confirmed', 'pickup_ready');

create table public.sms_queue (
  id                  uuid primary key default gen_random_uuid(),
  restaurant_id       uuid not null references public.restaurants(id) on delete cascade,
  recipient_phone     text not null,
  template_kind       public.sms_template_kind not null,
  template_data       jsonb not null default '{}'::jsonb,
  status              text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  scheduled_for       timestamptz not null default now(),
  claimed_at          timestamptz,
  sent_at             timestamptz,
  failed_attempts     integer not null default 0,
  last_error          text,
  provider_message_id text,
  dedup_key           text unique,
  created_at          timestamptz not null default now()
);

comment on table public.sms_queue is
  $$Coadă SMS tranzacționale (mig 228). Scrierile trec EXCLUSIV prin enqueue_sms
  (triggere DB) și claim_sms_batch / update-urile workerului (service_role).
  Plafonul lunar per restaurant se numără pe (restaurant_id, created_at) în
  luna Europe/Bucharest, excluzând doar 'cancelled' (anti-abuz: și eșecurile
  consumă plafonul).$$;

create index idx_sms_queue_scheduled
  on public.sms_queue(scheduled_for) where status = 'queued';
create index idx_sms_queue_sending_claimed
  on public.sms_queue(claimed_at) where status = 'sending';
create index idx_sms_queue_restaurant_month
  on public.sms_queue(restaurant_id, created_at);

alter table public.sms_queue enable row level security;

-- SELECT: adminii restaurantului (is_admin aduce automat escape-urile
-- is_platform_admin / has_partner_access din mig 186/187 — nu le re-implementa).
create policy sms_queue_admin_read on public.sms_queue
  for select to authenticated
  using (public.is_admin(restaurant_id));

revoke all on public.sms_queue from public, anon, authenticated;
grant select on public.sms_queue to authenticated;

-- ── B. Whitelist module + set_restaurant_module ──────────────────────
-- CHECK-ul pe restaurant_modules.module_key e inline din mig 086 → numele e
-- auto-generat și poate diferi între medii. Îl găsim dinamic și îl recreăm
-- cu nume explicit, incluzând 'sms_notifications'.

do $$
declare v_con text;
begin
  select con.conname into v_con
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'restaurant_modules'
    and con.contype = 'c'
    and exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid
        and a.attname = 'module_key'
        and a.attnum = any (con.conkey)
    );
  if v_con is null then
    raise exception 'mig 228: nu găsesc CHECK-ul pe restaurant_modules.module_key';
  end if;
  execute format('alter table public.restaurant_modules drop constraint %I', v_con);
end $$;

alter table public.restaurant_modules
  add constraint restaurant_modules_module_key_check
  check (module_key in ('reservations','online_payments','loyalty','delivery','gift_cards','sms_notifications'));

-- Redefinire set_restaurant_module — copie EXACTĂ din mig 086 (membership
-- owner/manager SAU restaurants.owner_id fallback, definer, search_path,
-- grants), cu un singur rând schimbat: whitelist-ul include sms_notifications.
-- Lanț de redefiniri: 086 → 228.
create or replace function public.set_restaurant_module(
  p_restaurant_id uuid,
  p_module_key    text,
  p_enabled       boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Trebuie să fii autentificat'
      using errcode = 'insufficient_privilege';
  end if;

  -- Verifică membership admin SAU owner direct (owner-ul poate să nu fie
  -- mirror-uit în restaurant_memberships).
  if not exists (
    select 1 from public.restaurant_memberships
    where restaurant_id = p_restaurant_id
      and user_id = v_uid
      and role in ('owner','manager')
  ) and not exists (
    select 1 from public.restaurants
    where id = p_restaurant_id
      and owner_id = v_uid
  ) then
    raise exception 'Doar owner sau manager poate activa module'
      using errcode = 'insufficient_privilege';
  end if;

  -- Validare module_key (redundant cu CHECK, dar mesaj mai clar pentru UI)
  if p_module_key not in ('reservations','online_payments','loyalty','delivery','gift_cards','sms_notifications') then
    raise exception 'Modul necunoscut: %', p_module_key
      using errcode = 'check_violation';
  end if;

  insert into public.restaurant_modules
    (restaurant_id, module_key, enabled, configured_by, configured_at)
  values (p_restaurant_id, p_module_key, p_enabled, v_uid, now())
  on conflict (restaurant_id, module_key) do update
    set enabled = excluded.enabled,
        configured_by = excluded.configured_by,
        configured_at = excluded.configured_at;

  return jsonb_build_object(
    'restaurant_id', p_restaurant_id,
    'module_key',    p_module_key,
    'enabled',       p_enabled,
    'configured_at', now()
  );
end;
$$;

revoke all on function public.set_restaurant_module(uuid, text, boolean) from public;
grant execute on function public.set_restaurant_module(uuid, text, boolean) to authenticated;

-- ── C. Seed plan_features — plafonul lunar per plan ──────────────────
-- limit_value = SMS-uri incluse pe lună (null = nelimitat, semantica getLimit).
insert into public.plan_features (plan, feature, enabled, limit_value) values
  ('free',       'sms_notifications', false, null),
  ('starter',    'sms_notifications', true,  100),
  ('growth',     'sms_notifications', true,  300),
  ('pro',        'sms_notifications', true,  500),
  ('enterprise', 'sms_notifications', true,  1000)
on conflict (plan, feature) do update
  set enabled = excluded.enabled, limit_value = excluded.limit_value;

-- ── D. Normalizare telefon RO ────────────────────────────────────────
-- Aceeași normalizare ca fn_loyalty_phone_hash (mig 226), dar întoarce numărul
-- E.164 (+40...) DOAR pentru mobile RO (07xxxxxxxx) — restul = null (skip).
create or replace function public.fn_sms_normalize_ro_phone(p_phone text)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select case
    when d.digits ~ '^07[0-9]{8}$' then '+4' || d.digits
  end
  from (
    select case
      when raw like '0040%'                    then '0' || substr(raw, 5)
      when raw like '40%' and length(raw) = 11 then '0' || substr(raw, 3)
      else raw
    end as digits
    from (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as raw) r
  ) d
$$;
revoke all on function public.fn_sms_normalize_ro_phone(text) from public, anon, authenticated;

-- ── E. enqueue_sms — TOATE ramurile negative întorc null, nu raise ───
create or replace function public.enqueue_sms(
  p_restaurant_id   uuid,
  p_recipient_phone text,
  p_template_kind   public.sms_template_kind,
  p_template_data   jsonb default '{}'::jsonb,
  p_dedup_key       text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit       integer;
  v_used        bigint;
  v_phone       text;
  v_id          uuid;
  v_month_start timestamptz;
begin
  -- 1) Gate modul (opt-in explicit al ownerului; default OFF).
  if not public.is_module_enabled(p_restaurant_id, 'sms_notifications') then
    return null;
  end if;

  -- 2) Gate plan (free = OFF; doar planurile plătite).
  if not public.restaurant_has_feature(p_restaurant_id, 'sms_notifications') then
    return null;
  end if;

  -- 3) Plafonul lunar (luna în Europe/Bucharest, NU UTC). Numără tot ce nu e
  -- 'cancelled' — și tentativele eșuate consumă plafonul (anti-abuz).
  select pf.limit_value into v_limit
  from public.restaurants r
  join public.profiles pr on pr.id = r.owner_id
  join public.plan_features pf on pf.plan = pr.plan and pf.feature = 'sms_notifications'
  where r.id = p_restaurant_id;

  if v_limit is not null then
    v_month_start := date_trunc('month', now() at time zone 'Europe/Bucharest')
                       at time zone 'Europe/Bucharest';
    select count(*) into v_used
    from public.sms_queue
    where restaurant_id = p_restaurant_id
      and status <> 'cancelled'
      and created_at >= v_month_start;
    if v_used >= v_limit then
      return null;
    end if;
  end if;

  -- 4) Doar mobile RO.
  v_phone := public.fn_sms_normalize_ro_phone(p_recipient_phone);
  if v_phone is null then
    return null;
  end if;

  -- 5) Insert cu dedup (on conflict do nothing → null la duplicat).
  insert into public.sms_queue
    (restaurant_id, recipient_phone, template_kind, template_data, dedup_key)
  values (p_restaurant_id, v_phone, p_template_kind, coalesce(p_template_data, '{}'::jsonb), p_dedup_key)
  on conflict (dedup_key) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.enqueue_sms(uuid, text, public.sms_template_kind, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.enqueue_sms(uuid, text, public.sms_template_kind, jsonb, text)
  to service_role;
-- Triggerele definer (owner postgres) îl apelează fără grant explicit.

-- ── F. claim_sms_batch — oglinda claim_email_batch (mig 162/167) ─────
create or replace function public.claim_sms_batch(p_limit integer default 30)
returns setof public.sms_queue
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- 1) Reclaim: rânduri blocate în 'sending' de un worker mort (>10 min).
  update public.sms_queue
     set status          = 'queued',
         claimed_at      = null,
         failed_attempts = failed_attempts + 1,
         last_error      = 'reclaimed: blocat in sending > 10 min'
   where status = 'sending'
     and claimed_at is not null
     and claimed_at < now() - interval '10 minutes';

  -- 2) Claim atomic al unui batch nou.
  return query
  update public.sms_queue q
     set status     = 'sending',
         claimed_at = now()
   where q.id in (
     select s.id from public.sms_queue s
      where s.status = 'queued'
        and s.scheduled_for <= now()
        and s.failed_attempts < 3
      order by s.scheduled_for asc
      limit greatest(coalesce(p_limit, 30), 1)
      for update skip locked
   )
  returning q.*;
end;
$$;

revoke all on function public.claim_sms_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_sms_batch(integer) to service_role;

-- ── G. get_sms_usage — contorul lunar pentru UI (admin-only) ─────────
create or replace function public.get_sms_usage(p_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit       integer;
  v_used        bigint;
  v_month_start timestamptz;
begin
  if not public.is_admin(p_restaurant_id) then
    raise exception 'Acces interzis' using errcode = 'insufficient_privilege';
  end if;

  select pf.limit_value into v_limit
  from public.restaurants r
  join public.profiles pr on pr.id = r.owner_id
  join public.plan_features pf on pf.plan = pr.plan and pf.feature = 'sms_notifications'
  where r.id = p_restaurant_id;

  v_month_start := date_trunc('month', now() at time zone 'Europe/Bucharest')
                     at time zone 'Europe/Bucharest';
  select count(*) into v_used
  from public.sms_queue
  where restaurant_id = p_restaurant_id
    and status <> 'cancelled'
    and created_at >= v_month_start;

  return jsonb_build_object(
    'used',           v_used,
    'cap',            v_limit,
    'module_enabled', public.is_module_enabled(p_restaurant_id, 'sms_notifications'),
    'plan_enabled',   public.restaurant_has_feature(p_restaurant_id, 'sms_notifications')
  );
end;
$$;

revoke all on function public.get_sms_usage(uuid) from public, anon;
grant execute on function public.get_sms_usage(uuid) to authenticated;

-- ── H. Triggerele de enqueue — exception-wrapped, nu avortează NICIODATĂ ──

-- (a) Rezervare confirmată: INSERT direct confirmed (create_reservation_public
-- + dashboard) SAU tranziție pending → confirmed (aprobarea din dashboard).
create or replace function public.trg_sms_on_reservation_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name  text;
  v_phone text;
begin
  if (tg_op = 'INSERT' and new.status = 'confirmed')
     or (tg_op = 'UPDATE' and new.status = 'confirmed' and old.status is distinct from 'confirmed')
  then
    begin
      select name, phone into v_name, v_phone
        from public.restaurants where id = new.restaurant_id;
      perform public.enqueue_sms(
        new.restaurant_id,
        new.customer_phone,
        'reservation_confirmed',
        jsonb_build_object(
          'customer_name',     new.customer_name,
          'restaurant_name',   v_name,
          'restaurant_phone',  v_phone,
          'starts_at',         new.starts_at,
          'party_size',        new.party_size,
          'confirmation_code', new.confirmation_code
        ),
        'sms_reservation_confirmed:' || new.id::text
      );
    exception when others then
      -- Un eșec de enqueue SMS NU are voie să avorteze rezervarea.
      raise warning 'sms enqueue rezervare % a esuat: %', new.id, sqlerrm;
    end;
  end if;
  return null; -- AFTER trigger
end;
$$;

drop trigger if exists trg_sms_reservation_confirmed on public.reservations;
create trigger trg_sms_reservation_confirmed
  after insert or update of status on public.reservations
  for each row
  execute function public.trg_sms_on_reservation_confirmed();

-- (b) Pickup gata: comanda source='pickup' intră în 'ready'. WHEN doar pe
-- new.*; verificările pe old + telefon sunt în corp (dedup_key protejează
-- oricum re-enqueue-ul, dar nu ne bazăm doar pe el).
create or replace function public.trg_sms_on_pickup_ready()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
begin
  if old.status is distinct from 'ready' and new.customer_phone is not null then
    begin
      select name into v_name from public.restaurants where id = new.restaurant_id;
      perform public.enqueue_sms(
        new.restaurant_id,
        new.customer_phone,
        'pickup_ready',
        jsonb_build_object(
          'customer_name',   new.customer_name,
          'short_id',        upper(right(new.id::text, 6)),
          'restaurant_name', v_name,
          'pickup_time',     new.pickup_time
        ),
        'sms_pickup_ready:' || new.id::text
      );
    exception when others then
      -- Un eșec de enqueue SMS NU are voie să avorteze advance_order.
      raise warning 'sms enqueue pickup % a esuat: %', new.id, sqlerrm;
    end;
  end if;
  return null; -- AFTER trigger
end;
$$;

drop trigger if exists trg_sms_pickup_ready on public.orders;
create trigger trg_sms_pickup_ready
  after update of status on public.orders
  for each row
  when (new.status = 'ready' and new.source = 'pickup')
  execute function public.trg_sms_on_pickup_ready();

-- ── I. Asserții fail-closed ──────────────────────────────────────────
do $$
declare
  v_src   text;
  v_check text;
begin
  -- 1) Enumul are exact cele 2 valori.
  if (select count(*) from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      where t.typname = 'sms_template_kind') <> 2 then
    raise exception 'mig 228: enumul sms_template_kind nu are exact 2 valori';
  end if;

  -- 2) Whitelist-ul modulelor include sms_notifications.
  select pg_get_constraintdef(oid) into v_check
  from pg_constraint
  where conname = 'restaurant_modules_module_key_check';
  if v_check is null or position('sms_notifications' in v_check) = 0 then
    raise exception 'mig 228: CHECK-ul restaurant_modules nu include sms_notifications';
  end if;

  -- 3) plan_features: free OFF, planurile plătite ON.
  if exists (select 1 from public.plan_features
             where feature = 'sms_notifications' and plan = 'free' and enabled) then
    raise exception 'mig 228: sms_notifications e activ pe free';
  end if;
  if (select count(*) from public.plan_features
      where feature = 'sms_notifications' and enabled
        and plan in ('starter','growth','pro','enterprise')) <> 4 then
    raise exception 'mig 228: sms_notifications lipsește de pe un plan plătit';
  end if;

  -- 4) Privilegii: anon/authenticated FĂRĂ enqueue/claim; service_role LE ARE;
  -- authenticated ARE get_sms_usage.
  if has_function_privilege('anon',
       'public.enqueue_sms(uuid, text, public.sms_template_kind, jsonb, text)', 'execute')
     or has_function_privilege('authenticated',
       'public.enqueue_sms(uuid, text, public.sms_template_kind, jsonb, text)', 'execute') then
    raise exception 'mig 228: enqueue_sms e executabil de anon/authenticated';
  end if;
  if has_function_privilege('anon', 'public.claim_sms_batch(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_sms_batch(integer)', 'execute') then
    raise exception 'mig 228: claim_sms_batch e executabil de anon/authenticated';
  end if;
  if not has_function_privilege('service_role',
       'public.enqueue_sms(uuid, text, public.sms_template_kind, jsonb, text)', 'execute')
     or not has_function_privilege('service_role', 'public.claim_sms_batch(integer)', 'execute') then
    raise exception 'mig 228: service_role nu poate executa enqueue/claim';
  end if;
  if not has_function_privilege('authenticated', 'public.get_sms_usage(uuid)', 'execute') then
    raise exception 'mig 228: authenticated nu poate executa get_sms_usage';
  end if;

  -- 5) Corpurile funcțiilor conțin invariantele critice.
  select pg_get_functiondef('public.enqueue_sms(uuid, text, public.sms_template_kind, jsonb, text)'::regprocedure)
    into v_src;
  if position('limit_value' in v_src) = 0 then
    raise exception 'mig 228: plafonul lunar a dispărut din enqueue_sms';
  end if;
  select pg_get_functiondef('public.claim_sms_batch(integer)'::regprocedure) into v_src;
  if position('skip locked' in lower(v_src)) = 0
     or position('reclaimed' in lower(v_src)) = 0 then
    raise exception 'mig 228: claim_sms_batch a pierdut SKIP LOCKED sau reclaim-ul';
  end if;

  -- 6) Triggerele există.
  if not exists (select 1 from pg_trigger where tgname = 'trg_sms_reservation_confirmed')
     or not exists (select 1 from pg_trigger where tgname = 'trg_sms_pickup_ready') then
    raise exception 'mig 228: unul dintre triggerele SMS lipsește';
  end if;

  -- 7) Funcțiile de trigger sunt exception-safe (un eșec de SMS nu avortează
  -- rezervarea / advance_order).
  select pg_get_functiondef('public.trg_sms_on_reservation_confirmed()'::regprocedure) into v_src;
  if position('when others' in lower(v_src)) = 0 then
    raise exception 'mig 228: trg_sms_on_reservation_confirmed nu e exception-safe';
  end if;
  select pg_get_functiondef('public.trg_sms_on_pickup_ready()'::regprocedure) into v_src;
  if position('when others' in lower(v_src)) = 0 then
    raise exception 'mig 228: trg_sms_on_pickup_ready nu e exception-safe';
  end if;

  -- 8) Normalizarea: mobil RO în orice format acceptat; fix/străin respins.
  if public.fn_sms_normalize_ro_phone('0040 712 345 678') is distinct from '+40712345678'
     or public.fn_sms_normalize_ro_phone('+40 712-345-678') is distinct from '+40712345678'
     or public.fn_sms_normalize_ro_phone('0712345678') is distinct from '+40712345678'
     or public.fn_sms_normalize_ro_phone('021 555 1234') is not null
     or public.fn_sms_normalize_ro_phone('+49 151 1234567') is not null then
    raise exception 'mig 228: fn_sms_normalize_ro_phone normalizează greșit';
  end if;

  -- 9) search_path fixat pe toate funcțiile noi (advisorul nu crește).
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('enqueue_sms','claim_sms_batch','get_sms_usage',
                        'fn_sms_normalize_ro_phone',
                        'trg_sms_on_reservation_confirmed','trg_sms_on_pickup_ready')
      and (p.proconfig is null
           or not exists (select 1 from unnest(p.proconfig) cfg
                          where cfg like 'search_path=%'))
  ) then
    raise exception 'mig 228: o funcție SMS nu are search_path fixat';
  end if;
end $$;

commit;
