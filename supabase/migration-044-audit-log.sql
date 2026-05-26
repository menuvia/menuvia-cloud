-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 044 — Runtime Audit Log pentru mutații sensibile
-- ═══════════════════════════════════════════════════════════════
-- Rezolvă P2 din raport: lipsa unei tabele runtime de audit pentru
-- forensics / conformitate GDPR Art. 30 + investigații post-incident.
--
-- Distinct de:
--   • migration-035-security-audit (checklist one-time, nu runtime)
--   • supabase/audit (Supabase audit dashboard — nu accesibil per-row)
--
-- Captures: cine + ce + când + before/after pentru tabele critice.
-- Storage: ~50 bytes per linie + diff size. La 1000 mutații/zi/restaurant
-- = ~2 MB/lună. Retenție 1 an = ~24 MB. Acceptabil.
-- ═══════════════════════════════════════════════════════════════

-- ── Tabela centrală ──────────────────────────────────────────
create table if not exists public.audit_log (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  -- Cine
  actor_id      uuid,                       -- auth.uid() (NULL = service role / cron)
  actor_role    text,                       -- 'authenticated' | 'service_role' | 'anon'
  -- Ce
  table_name    text not null,              -- 'orders' | 'products' | 'restaurant_memberships'
  operation     text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  row_id        text not null,              -- text pentru a accepta UUID + bigint
  restaurant_id uuid,                       -- pentru filtering rapid per restaurant
  -- Diff
  old_data      jsonb,                      -- NULL pentru INSERT
  new_data      jsonb,                      -- NULL pentru DELETE
  changed_keys  text[],                     -- doar câmpurile schimbate (UPDATE)
  -- Context
  ip_address    inet,
  user_agent    text,
  request_id    text                        -- corelație cu Sentry/Netlify logs
);

-- Indexuri pentru queries comune
create index if not exists audit_log_created_idx
  on public.audit_log (created_at desc);

create index if not exists audit_log_actor_idx
  on public.audit_log (actor_id, created_at desc)
  where actor_id is not null;

create index if not exists audit_log_table_op_idx
  on public.audit_log (table_name, operation, created_at desc);

create index if not exists audit_log_restaurant_idx
  on public.audit_log (restaurant_id, created_at desc)
  where restaurant_id is not null;

create index if not exists audit_log_row_idx
  on public.audit_log (table_name, row_id);


-- ── RLS: vizibilitate restrictivă ────────────────────────────
alter table public.audit_log enable row level security;

-- Owner-ul restaurantului poate vedea log-ul propriilor restaurante
drop policy if exists "audit_log_select_own_restaurant" on public.audit_log;
create policy "audit_log_select_own_restaurant"
  on public.audit_log for select
  using (
    restaurant_id is not null
    and restaurant_id in (
      select restaurant_id from public.restaurant_memberships
       where user_id = auth.uid()
         and role in ('owner', 'manager')
    )
  );

-- User-ul poate vedea propriile acțiuni (chiar și fără restaurant)
drop policy if exists "audit_log_select_own_actions" on public.audit_log;
create policy "audit_log_select_own_actions"
  on public.audit_log for select
  using (actor_id = auth.uid());

-- NIMENI nu poate insert/update/delete prin client — doar prin triggere
revoke insert, update, delete on public.audit_log from authenticated, anon;


-- ── Trigger function generică ────────────────────────────────
-- Apelată din triggere pe tabelele țintă. Captures auth.uid() + JWT claims.
create or replace function public.audit_trigger_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_data jsonb;
  v_new_data jsonb;
  v_changed text[];
  v_row_id  text;
  v_restaurant_id uuid;
  v_actor_id uuid;
  v_actor_role text;
begin
  v_actor_id := auth.uid();
  v_actor_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    current_user
  );

  if tg_op = 'DELETE' then
    v_old_data := to_jsonb(OLD);
    v_new_data := null;
    v_row_id   := coalesce(OLD.id::text, 'unknown');
  elsif tg_op = 'UPDATE' then
    v_old_data := to_jsonb(OLD);
    v_new_data := to_jsonb(NEW);
    v_row_id   := coalesce(NEW.id::text, 'unknown');
    -- Calculează doar câmpurile schimbate (mai mic decât full diff)
    select array_agg(key) into v_changed
      from jsonb_each(v_new_data)
     where v_old_data -> key is distinct from v_new_data -> key;
  elsif tg_op = 'INSERT' then
    v_old_data := null;
    v_new_data := to_jsonb(NEW);
    v_row_id   := coalesce(NEW.id::text, 'unknown');
  end if;

  -- Încearcă să extragi restaurant_id (dacă coloana există în row)
  begin
    v_restaurant_id := coalesce(
      (v_new_data ->> 'restaurant_id')::uuid,
      (v_old_data ->> 'restaurant_id')::uuid
    );
  exception when others then
    v_restaurant_id := null;
  end;

  -- Insert audit row — fail-safe (nu blochează mutația dacă audit eșuează)
  begin
    insert into public.audit_log (
      actor_id, actor_role, table_name, operation, row_id,
      restaurant_id, old_data, new_data, changed_keys
    ) values (
      v_actor_id, v_actor_role, tg_table_name, tg_op, v_row_id,
      v_restaurant_id, v_old_data, v_new_data, v_changed
    );
  exception when others then
    -- Log to PostgreSQL log dar nu pica mutația originală
    raise warning 'audit_trigger_fn: insert failed: %', sqlerrm;
  end;

  -- Pentru INSERT/UPDATE returnăm NEW, pentru DELETE returnăm OLD
  if tg_op = 'DELETE' then
    return OLD;
  else
    return NEW;
  end if;
end;
$$;


-- ── Atașez triggere pe tabelele critice ──────────────────────
-- AFTER trigger = se execută după mutația originală, nu o blochează

-- Orders (cele mai sensibile — bani + status fiscal)
drop trigger if exists audit_orders on public.orders;
create trigger audit_orders
  after insert or update or delete on public.orders
  for each row execute function public.audit_trigger_fn();

-- Products (modificări preț = important pentru reclamații client)
drop trigger if exists audit_products on public.products;
create trigger audit_products
  after insert or update or delete on public.products
  for each row execute function public.audit_trigger_fn();

-- Restaurant memberships (cine are acces, când a fost adăugat/scos)
drop trigger if exists audit_memberships on public.restaurant_memberships;
create trigger audit_memberships
  after insert or update or delete on public.restaurant_memberships
  for each row execute function public.audit_trigger_fn();

-- Restaurants (modificări branding / Google Place ID / setări)
drop trigger if exists audit_restaurants on public.restaurants;
create trigger audit_restaurants
  after insert or update or delete on public.restaurants
  for each row execute function public.audit_trigger_fn();


-- ── View pentru raport ușor pe dashboard ─────────────────────
create or replace view public.v_audit_recent as
select
  a.id,
  a.created_at,
  a.actor_id,
  p.full_name as actor_name,
  a.table_name,
  a.operation,
  a.row_id,
  a.restaurant_id,
  a.changed_keys,
  -- Diff scurt (doar câmpurile schimbate) pentru afișare compactă
  case
    when a.operation = 'UPDATE' then
      (select jsonb_object_agg(k, jsonb_build_object('from', a.old_data -> k, 'to', a.new_data -> k))
         from unnest(a.changed_keys) k)
    when a.operation = 'INSERT' then a.new_data
    else a.old_data
  end as diff_short
from public.audit_log a
left join public.profiles p on p.id = a.actor_id
order by a.created_at desc;

grant select on public.v_audit_recent to authenticated;


-- ── Cleanup job: retenție 1 an ───────────────────────────────
-- Apelat din automation-cron.js sau direct prin pg_cron dacă disponibil.
create or replace function public.audit_log_cleanup(p_retention_days int default 365)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from public.audit_log
   where created_at < (now() - (p_retention_days || ' days')::interval);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.audit_log_cleanup(int) from public;
-- Doar service_role poate apela
