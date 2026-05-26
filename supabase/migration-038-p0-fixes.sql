-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 038 — P0 Critical Fixes (pre-launch blockers)
-- ═══════════════════════════════════════════════════════════════
-- Rezolvă cele 7 blockere identificate în AUDIT premium:
--   SEC-001  Stripe webhook raw body (fix in netlify function)
--   SEC-002  Restaurants public read by slug (full table scan)
--   SEC-003  Stripe webhook dedup (idempotency)
--   SEC-004  send-invite rate limiting
--   DB-001   Advisory locks on enforce_*_limit triggers (race condition)
--   FE-001   Router fix (in App.tsx, separat)
--   BRIDGE-001 Idempotency pe pending_receipts (dublu bon = amendă ANAF)

-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ SEC-002 — get_restaurant_by_slug RPC + drop public policy    ║
-- ╚═══════════════════════════════════════════════════════════════╝

-- RPC dedicat: returnează doar restaurantul activ care matchează slug-ul.
-- Nu permite SELECT * pe restaurants (cum era cu policy 'public read by slug').
create or replace function public.get_restaurant_by_slug(p_slug text)
returns table (
  id           uuid,
  name         text,
  slug         text,
  description  text,
  logo_url     text,
  cover_url    text,
  primary_color text,
  is_active    boolean,
  qr_token     text,
  currency     text,
  tax_included boolean,
  language     text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    r.id, r.name, r.slug, r.description, r.logo_url, r.cover_url,
    r.primary_color, r.is_active, r.qr_token, r.currency,
    r.tax_included, r.language
  from public.restaurants r
  where r.slug = p_slug
    and r.is_active = true
  limit 1;
$$;

revoke all on function public.get_restaurant_by_slug(text) from public;
grant execute on function public.get_restaurant_by_slug(text) to anon, authenticated;

comment on function public.get_restaurant_by_slug(text) is
  'Securitate (SEC-002): înlocuiește policy "restaurants: public read by slug" care permitea full table scan. Returnează doar restaurantul activ care matchează slug-ul, fără data leak.';

-- Echivalent pentru lookup by qr_token (folosit de QrMenuPage)
create or replace function public.get_restaurant_by_qr_token(p_token text)
returns table (
  id           uuid,
  name         text,
  slug         text,
  description  text,
  logo_url     text,
  cover_url    text,
  primary_color text,
  is_active    boolean,
  qr_token     text,
  currency     text,
  tax_included boolean,
  language     text
)
language sql security definer stable set search_path = public as $$
  select
    r.id, r.name, r.slug, r.description, r.logo_url, r.cover_url,
    r.primary_color, r.is_active, r.qr_token, r.currency,
    r.tax_included, r.language
  from public.restaurants r
  where r.qr_token = p_token
    and r.is_active = true
  limit 1;
$$;

revoke all on function public.get_restaurant_by_qr_token(text) from public;
grant execute on function public.get_restaurant_by_qr_token(text) to anon, authenticated;

-- DROP policy publică care permitea full table scan.
-- Members + admins păstrează policy-urile lor existente prin alte migrații (008).
drop policy if exists "restaurants: public read by slug" on public.restaurants;
drop policy if exists "restaurants_public_read"          on public.restaurants;


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ SEC-003 — Stripe webhook events dedup                        ║
-- ╚═══════════════════════════════════════════════════════════════╝

-- Stocăm event_id pentru fiecare webhook procesat → idempotency.
-- Dacă Stripe retransmite (rețea pierdută, timeout), ignorăm.
create table if not exists public.stripe_events (
  event_id     text primary key,
  event_type   text not null,
  payload      jsonb,
  status       text not null default 'received'
    check (status in ('received', 'processing', 'completed', 'failed')),
  user_id      uuid references public.profiles(id) on delete set null,
  error_info   text,
  received_at  timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_stripe_events_status     on public.stripe_events(status);
create index if not exists idx_stripe_events_received_at on public.stripe_events(received_at desc);

alter table public.stripe_events enable row level security;
-- Nicio policy → blocată complet pentru anon/authenticated. Doar service_role.

comment on table public.stripe_events is
  'SEC-003: Dedup pentru Stripe webhooks. event_id PK previne dublă procesare la retry.';


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ SEC-004 — Function rate limits (anti-spam pe send-invite)    ║
-- ╚═══════════════════════════════════════════════════════════════╝

-- Generic rate limit table folosit de orice Netlify function.
-- Cheia compusă (function_name, scope_key) ne permite per-user/per-IP/per-restaurant limits.
create table if not exists public.function_rate_limits (
  function_name  text not null,
  scope_key      text not null,        -- ex: user_id, ip, restaurant_id
  window_start   timestamptz not null, -- începutul ferestrei curente
  request_count  integer not null default 0,
  primary key (function_name, scope_key, window_start)
);

create index if not exists idx_rate_limits_window on public.function_rate_limits(window_start);

alter table public.function_rate_limits enable row level security;

-- RPC pentru a verifica & incrementa rate limit atomic.
-- Returnează true dacă request-ul e permis, false dacă a depășit limita.
create or replace function public.check_rate_limit(
  p_function_name  text,
  p_scope_key      text,
  p_max_requests   integer,
  p_window_minutes integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_current_count integer;
begin
  -- Calculează începutul ferestrei (rounded down la increment de p_window_minutes)
  v_window_start := date_trunc('hour', now()) +
    (extract(minute from now())::integer / p_window_minutes) * (p_window_minutes || ' minutes')::interval;

  -- Upsert atomic
  insert into public.function_rate_limits (function_name, scope_key, window_start, request_count)
  values (p_function_name, p_scope_key, v_window_start, 1)
  on conflict (function_name, scope_key, window_start)
  do update set request_count = public.function_rate_limits.request_count + 1
  returning request_count into v_current_count;

  return v_current_count <= p_max_requests;
end;
$$;

revoke all on function public.check_rate_limit(text, text, integer, integer) from public;
-- Doar service_role apelează asta (din Netlify functions).

-- Cleanup periodic pentru rate limits vechi (cron job)
create or replace function public.cleanup_old_rate_limits()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.function_rate_limits
   where window_start < now() - interval '7 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_old_rate_limits() from public;


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ DB-001 — Advisory locks pe enforce_*_limit triggers          ║
-- ╚═══════════════════════════════════════════════════════════════╝

-- Race condition: 2 INSERT-uri concurente pot trece check-ul SELECT count(*)
-- înainte ca oricare să comite. Fix: pg_advisory_xact_lock pe restaurant_id.
-- Lock-ul se eliberează automat la commit/rollback, fără cleanup manual.

create or replace function public.enforce_product_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_plan text;
  v_max  integer;
  v_count integer;
begin
  -- DB-001 FIX: Lock per restaurant_id pentru a preveni race în limit check.
  -- hashtext() convertește uuid::text la int8 pentru advisory lock.
  perform pg_advisory_xact_lock(hashtext('product_limit_' || new.restaurant_id::text));

  select public.owner_plan(new.restaurant_id) into v_plan;
  select max_products into v_max from public.plan_limits where plan = coalesce(v_plan, 'free');
  if v_max is null then v_max := 15; end if;

  select count(*) into v_count
  from public.products where restaurant_id = new.restaurant_id;

  if v_count >= v_max then
    raise exception 'Limită produse atinsă: maxim % pentru planul %.', v_max, coalesce(v_plan, 'free')
      using errcode = 'P0001', hint = 'upgrade_plan';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_table_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_plan text;
  v_max  integer;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('table_limit_' || new.restaurant_id::text));

  select public.owner_plan(new.restaurant_id) into v_plan;
  select max_tables into v_max from public.plan_limits where plan = coalesce(v_plan, 'free');
  if v_max is null then v_max := 3; end if;

  select count(*) into v_count
  from public.tables where restaurant_id = new.restaurant_id;

  if v_count >= v_max then
    raise exception 'Limită mese atinsă: maxim % pentru planul %.', v_max, coalesce(v_plan, 'free')
      using errcode = 'P0001', hint = 'upgrade_plan';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_restaurant_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_plan text;
  v_max  integer;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('restaurant_limit_' || new.owner_id::text));

  select plan into v_plan from public.profiles where id = new.owner_id;
  select max_restaurants into v_max from public.plan_limits where plan = coalesce(v_plan, 'free');
  if v_max is null then v_max := 1; end if;

  select count(*) into v_count
  from public.restaurants where owner_id = new.owner_id;

  if v_count >= v_max then
    raise exception 'Limită restaurante atinsă: maxim % pentru planul %.', v_max, coalesce(v_plan, 'free')
      using errcode = 'P0001', hint = 'upgrade_plan';
  end if;
  return new;
end;
$$;


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ BRIDGE-001 — Idempotency pe pending_receipts                 ║
-- ╚═══════════════════════════════════════════════════════════════╝
-- PROBLEMĂ: Bridge claims receipt → scrie .txt → FiscalNet tipărește bon →
-- Bridge crashează ÎNAINTE de bridge_confirm_receipt → receipt rămâne 'sent'
-- → admin retry → receipt resetat la 'pending' → alt bridge claims → AL DOILEA BON
-- → AMENDĂ ANAF.
--
-- Fix:
--   1. bon_number este SOURCE OF TRUTH fiscal. Dacă există → NICIODATĂ retry.
--   2. bridge_retry_receipt verifică explicit bon_number IS NULL.
--   3. Adăugăm bridge_force_reset_stuck_receipt pentru cazuri excepționale
--      (admin SUNĂ Radu, citește bon-ul fizic, decide manual).

create or replace function public.bridge_retry_receipt(p_receipt_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_bon_number    text;
  v_status        text;
  v_updated       int;
begin
  select restaurant_id, bon_number, status
    into v_restaurant_id, v_bon_number, v_status
    from public.pending_receipts
   where id = p_receipt_id;

  if not found then return false; end if;

  if not public.is_admin(v_restaurant_id) then
    raise exception 'Only owners/managers can retry receipts';
  end if;

  -- BRIDGE-001 GUARD: dacă bon-ul are deja un număr fiscal alocat,
  -- ÎNSEAMNĂ că FiscalNet l-a tipărit. NU permitem retry.
  if v_bon_number is not null then
    raise exception 'Bonul a fost deja tipărit fiscal (Nr. %). Pentru anulare, folosește bon de stornare la casa de marcat.', v_bon_number
      using errcode = 'P0001', hint = 'already_printed';
  end if;

  -- Doar status 'error' sau 'cancelled' permite retry (nu 'sent' care e ambiguu)
  update public.pending_receipts
     set status           = 'pending',
         bridge_device_id = null,
         claimed_at       = null,
         completed_at     = null,
         error_code       = null,
         error_info       = null
   where id     = p_receipt_id
     and status in ('error', 'cancelled')
     and bon_number is null;  -- double check

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- ESCAPE HATCH: pentru receipts "stuck in sent" — admin verifică manual la
-- casă dacă bonul a fost printat sau nu, apoi decide explicit.
-- Această funcție NU resetează la 'pending', ci marchează ca 'error' sau 'completed'
-- în funcție de decizia admin.
create or replace function public.bridge_force_resolve_stuck(
  p_receipt_id uuid,
  p_was_printed boolean,        -- true dacă bonul S-A tipărit (chiar fără confirm), false dacă NU
  p_bon_number  text default null  -- dacă was_printed=true, fournize numărul citit fizic
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_status        text;
  v_existing_bon  text;
  v_updated       int;
begin
  select restaurant_id, status, bon_number
    into v_restaurant_id, v_status, v_existing_bon
    from public.pending_receipts
   where id = p_receipt_id;

  if not found then return false; end if;

  if not public.is_admin(v_restaurant_id) then
    raise exception 'Only owners/managers can force-resolve receipts';
  end if;

  -- Doar receipts stuck (>10 min în 'sent' fără confirm)
  if v_status != 'sent' then
    raise exception 'Doar bonuri stuck pot fi resolvate. Status curent: %', v_status;
  end if;

  if v_existing_bon is not null then
    raise exception 'Bonul are deja număr fiscal: %. Nu poate fi resolvat din nou.', v_existing_bon;
  end if;

  if p_was_printed then
    if p_bon_number is null then
      raise exception 'Dacă bonul a fost tipărit, numărul fiscal este obligatoriu.';
    end if;
    update public.pending_receipts
       set status       = 'completed',
           bon_number   = p_bon_number,
           completed_at = now(),
           error_info   = 'Force-resolved by admin: bon physically verified as printed'
     where id = p_receipt_id;
  else
    update public.pending_receipts
       set status     = 'error',
           error_code = 'FORCE_FAILED',
           error_info = 'Force-resolved by admin: bon NOT printed, marked as error'
     where id = p_receipt_id;
  end if;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.bridge_force_resolve_stuck(uuid, boolean, text) from public;
grant execute on function public.bridge_force_resolve_stuck(uuid, boolean, text) to authenticated;

comment on function public.bridge_force_resolve_stuck(uuid, boolean, text) is
  'BRIDGE-001 escape hatch: admin marchează manual stuck receipt după verificare fizică la casă. Single source of truth = bonul tipărit.';


-- ═══════════════════════════════════════════════════════════════
-- DONE. Verificare:
--   SELECT * FROM pg_proc WHERE proname IN (
--     'get_restaurant_by_slug', 'check_rate_limit',
--     'enforce_product_limit', 'bridge_retry_receipt'
--   );
-- ═══════════════════════════════════════════════════════════════
