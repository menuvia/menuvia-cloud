-- ═══════════════════════════════════════════════════════════════════
-- Migration 227: tichete de bucătărie prin bridge (E3, NEfiscale)
-- ─────────────────────────────────────────────────────────────────────
-- Localurile FĂRĂ KDS vor tichet FIZIC în bucătărie la fiecare comandă.
-- Coadă NOUĂ `kitchen_tickets`, SEPARATĂ de coada fiscală `pending_receipts`:
--   • pending_receipts are gate-ul universal Plan 3 (trg mig 133) pe care NU
--     avem voie să-l slăbim + retenție fiscală 10 ani (mig 179) + bridge-uri
--     vechi care ar ridica rânduri străine prin bridge_get_pending → un kind
--     nou acolo risca tipărirea tichetelor pe CASA FISCALĂ.
--   • tichetul se tipărește pe o imprimantă TERMICĂ de bucătărie, prin
--     ACELAȘI bridge local (consumer nou: TCP RAW 9100 / file-drop), NU prin
--     FiscalNet. Vezi docs/BRIDGE_FISCALNET_ARCHITECTURE.md §Tichete.
--
-- Declanșare: CONSTRAINT TRIGGER AFTER INSERT pe orders, DEFERRABLE INITIALLY
-- DEFERRED (pattern mig 077) — la COMMIT order_items există deja, iar publicul
-- țintă (fără KDS) nu are pe nimeni să apese „confirmă". Catch-all în trigger:
-- un tichet pierdut NU are voie să avorteze comanda.
--
-- Gate: feature de plan NOU `kitchen_tickets` (growth+ — tichetele nu ating
-- bani, deci NU e Plan 3; tier 1 nu are order_qr oricum) + opt-in per
-- restaurant prin coloana EXISTENTĂ bridge_devices.prints_kitchen_receipts
-- (mig 030, până azi nefolosită). bridge_register (lanț 030→133→227) se
-- redeschide pentru growth prin `fiscal_receipt OR kitchen_tickets` —
-- lanțul fiscal (trg mig 133, enforce_paid_status_gate) rămâne INTACT.
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- ── 1. Gate de plan: kitchen_tickets = growth+ ─────────────────────
insert into public.plan_features (plan, feature, enabled, limit_value) values
  ('free',       'kitchen_tickets', false, null),
  ('starter',    'kitchen_tickets', false, null),
  ('growth',     'kitchen_tickets', true,  null),
  ('pro',        'kitchen_tickets', true,  null),
  ('enterprise', 'kitchen_tickets', true,  null)
on conflict (plan, feature) do update set enabled = excluded.enabled;

-- ── 2. Coada de tichete (oglinda structurală a pending_receipts) ────
create table if not exists public.kitchen_tickets (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants(id) on delete cascade,
  order_id         uuid not null references public.orders(id) on delete cascade,
  payload          text not null,
  status           text not null default 'pending'
                   check (status in ('pending', 'sent', 'success', 'error', 'cancelled')),
  bridge_device_id uuid references public.bridge_devices(id) on delete set null,
  error_code       text,
  error_info       text,
  retry_count      smallint not null default 0,
  is_reprint       boolean not null default false,
  created_at       timestamptz not null default now(),
  claimed_at       timestamptz,
  completed_at     timestamptz
);
create index if not exists idx_kitchen_tickets_rest_status
  on public.kitchen_tickets(restaurant_id, status, created_at);
create index if not exists idx_kitchen_tickets_order
  on public.kitchen_tickets(order_id);
create index if not exists idx_kitchen_tickets_open
  on public.kitchen_tickets(status) where status in ('pending', 'sent');

alter table public.kitchen_tickets enable row level security;
drop policy if exists "kitchen_tickets member read" on public.kitchen_tickets;
create policy "kitchen_tickets member read" on public.kitchen_tickets
  for select using (public.is_member(restaurant_id));
grant select on public.kitchen_tickets to authenticated;
revoke insert, update, delete on public.kitchen_tickets from anon, authenticated;

-- ── 3. Gate defense-in-depth pe INSERT (oglinda trg-ului fiscal mig 133) ──
create or replace function public.enforce_kitchen_ticket_gate()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public.enforce_feature_for_restaurant(new.restaurant_id, 'kitchen_tickets');
  return new;
end$$;
revoke all on function public.enforce_kitchen_ticket_gate() from public;

drop trigger if exists trg_kitchen_tickets_plan_gate on public.kitchen_tickets;
create trigger trg_kitchen_tickets_plan_gate
  before insert on public.kitchen_tickets
  for each row execute function public.enforce_kitchen_ticket_gate();

-- ── 4. Payload-ul tichetului — text simplu pentru imprimantă termică ──
-- FĂRĂ prețuri (e tichet de producție, nu bon); control chars stripate;
-- ora locală România. raise dacă nu există iteme (prins de caller).
create or replace function public.build_kitchen_ticket_payload(
  p_order_id uuid,
  p_reprint  boolean default false
) returns text
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_order  record;
  v_lines  text;
  v_items  int;
begin
  select o.id, o.source, o.notes, o.created_at,
         coalesce(o._table_name_snapshot, t.name) as table_name
    into v_order
    from public.orders o
    left join public.tables t on t.id = o.table_id
   where o.id = p_order_id;
  if not found then
    raise exception 'build_kitchen_ticket_payload: order % not found', p_order_id;
  end if;

  select count(*),
         string_agg(
           oi.quantity || 'x ' ||
           regexp_replace(oi.product_name_snapshot, '[\r\n\t]', ' ', 'g') ||
           coalesce((
             select string_agg(e'\n   + ' ||
                      regexp_replace(coalesce(m->>'option_name', ''), '[\r\n\t]', ' ', 'g'), '')
               from jsonb_array_elements(coalesce(oi.selected_modifiers, '[]'::jsonb)) m
              where coalesce(m->>'option_name', '') <> ''
           ), '') ||
           coalesce((
             select string_agg(e'\n   + ' ||
                      regexp_replace(coalesce(x->>'name', ''), '[\r\n\t]', ' ', 'g'), '')
               from jsonb_array_elements(coalesce(oi.extras_added, '[]'::jsonb)) x
              where coalesce(x->>'name', '') <> ''
           ), '') ||
           case when coalesce(btrim(oi.notes), '') <> ''
                then e'\n   >> ' || regexp_replace(oi.notes, '[\r\n\t]', ' ', 'g')
                else '' end,
           e'\n' order by oi.created_at
         )
    into v_items, v_lines
    from public.order_items oi
   where oi.order_id = p_order_id;

  if coalesce(v_items, 0) = 0 then
    raise exception 'build_kitchen_ticket_payload: order % has no items', p_order_id;
  end if;

  return case when p_reprint then '*** REPRINT ***' else '*** COMANDA NOUA ***' end
    || e'\n'
    || case v_order.source
         when 'pickup' then 'PICKUP'
         when 'waiter' then 'OSPATAR' ||
           case when v_order.table_name is not null then ' · MASA: ' ||
             regexp_replace(v_order.table_name, '[\r\n\t]', ' ', 'g') else '' end
         else 'MASA: ' || coalesce(regexp_replace(v_order.table_name, '[\r\n\t]', ' ', 'g'), '-')
       end
    || e'\n'
    || '#' || upper(right(v_order.id::text, 6)) || ' · '
    || to_char(v_order.created_at at time zone 'Europe/Bucharest', 'HH24:MI DD.MM')
    || e'\n------------------------------\n'
    || v_lines
    || e'\n------------------------------'
    || case when coalesce(btrim(v_order.notes), '') <> ''
            then e'\nNOTE: ' || regexp_replace(v_order.notes, '[\r\n\t]', ' ', 'g')
            else '' end;
end$$;
revoke all on function public.build_kitchen_ticket_payload(uuid, boolean) from public;

-- ── 5. Enqueue la COMMIT-ul INSERT-ului comenzii (pattern mig 077) ──
-- Catch-all: NIMIC de aici nu are voie să avorteze comanda la COMMIT.
create or replace function public.enqueue_kitchen_ticket()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  begin
    if not public.restaurant_has_feature(new.restaurant_id, 'kitchen_tickets') then
      return null;
    end if;
    if not exists (
      select 1 from public.bridge_devices
      where restaurant_id = new.restaurant_id and prints_kitchen_receipts = true
    ) then
      return null;
    end if;
    -- Dedup: un tichet per comandă (reprint-ul manual ocolește intenționat).
    if exists (
      select 1 from public.kitchen_tickets
      where order_id = new.id and status in ('pending', 'sent', 'success')
    ) then
      return null;
    end if;
    insert into public.kitchen_tickets (restaurant_id, order_id, payload)
    values (new.restaurant_id, new.id, public.build_kitchen_ticket_payload(new.id));
  exception when others then
    -- Un tichet pierdut e hârtie, nu bani — comanda trece mai departe.
    raise warning 'enqueue_kitchen_ticket skipped for order %: %', new.id, sqlerrm;
  end;
  return null;
end$$;
revoke all on function public.enqueue_kitchen_ticket() from public;

drop trigger if exists trg_enqueue_kitchen_ticket on public.orders;
create constraint trigger trg_enqueue_kitchen_ticket
  after insert on public.orders
  deferrable initially deferred
  for each row execute function public.enqueue_kitchen_ticket();

-- ── 6. RPC-uri pentru bridge (auth pe device_secret, paritate mig 030/045) ──
create or replace function public.bridge_get_pending_tickets(
  p_device_secret text,
  p_limit         integer default 5
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant_id uuid;
  v_limit         integer;
begin
  -- Device-ul TREBUIE să aibă tipărirea de tichete pornită — fără să divulgăm
  -- prin mesaj diferența dintre „secret greșit" și „flag oprit".
  select restaurant_id into v_restaurant_id
    from public.bridge_devices
   where device_secret = p_device_secret and prints_kitchen_receipts = true;
  if not found then
    raise exception 'Invalid device secret';
  end if;

  update public.bridge_devices
     set last_seen_at = now(), status = 'online'
   where device_secret = p_device_secret;

  -- Downgrade sub growth → coada devine mută (fără eroare la bridge).
  if not public.restaurant_has_feature(v_restaurant_id, 'kitchen_tickets') then
    return '[]'::jsonb;
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 5), 20));

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', kt.id, 'order_id', kt.order_id, 'payload', kt.payload,
             'retry_count', kt.retry_count, 'created_at', kt.created_at
           ) order by kt.created_at)
      from (
        select * from public.kitchen_tickets
        where restaurant_id = v_restaurant_id and status = 'pending'
        order by created_at
        limit v_limit
      ) kt
  ), '[]'::jsonb);
end$$;
revoke all on function public.bridge_get_pending_tickets(text, integer) from public;
grant execute on function public.bridge_get_pending_tickets(text, integer) to anon, authenticated;

create or replace function public.bridge_claim_ticket(
  p_device_secret text,
  p_ticket_id     uuid
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant_id uuid;
  v_device_id     uuid;
  v_updated       int;
begin
  select restaurant_id, id into v_restaurant_id, v_device_id
    from public.bridge_devices
   where device_secret = p_device_secret and prints_kitchen_receipts = true;
  if not found then
    raise exception 'Invalid device secret';
  end if;

  update public.kitchen_tickets
     set status = 'sent', bridge_device_id = v_device_id, claimed_at = now()
   where id = p_ticket_id and restaurant_id = v_restaurant_id and status = 'pending';
  get diagnostics v_updated = row_count;

  return jsonb_build_object('claimed', v_updated > 0);
end$$;
revoke all on function public.bridge_claim_ticket(text, uuid) from public;
grant execute on function public.bridge_claim_ticket(text, uuid) to anon, authenticated;

create or replace function public.bridge_confirm_ticket(
  p_device_secret text,
  p_ticket_id     uuid,
  p_success       boolean,
  p_error_code    text default null,
  p_error_info    text default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant_id uuid;
  v_device_id     uuid;
  v_ticket        record;
begin
  select restaurant_id, id into v_restaurant_id, v_device_id
    from public.bridge_devices
   where device_secret = p_device_secret and prints_kitchen_receipts = true;
  if not found then
    raise exception 'Invalid device secret';
  end if;

  select id, status, bridge_device_id into v_ticket
    from public.kitchen_tickets
   where id = p_ticket_id and restaurant_id = v_restaurant_id
   for update;
  if not found then
    raise exception 'Ticket not found';
  end if;

  -- Doar device-ul care a claim-uit poate confirma (paritate mig 045).
  if v_ticket.bridge_device_id is distinct from v_device_id then
    raise exception 'Ticket claimed by another device' using hint = 'wrong_bridge_device';
  end if;

  -- Re-confirm idempotent al aceleiași stări terminale.
  if v_ticket.status in ('success', 'error', 'cancelled') then
    return jsonb_build_object('updated', true, 'status', v_ticket.status);
  end if;
  if v_ticket.status <> 'sent' then
    raise exception 'Ticket not in sent state' using hint = 'not_claimed';
  end if;

  if p_success then
    update public.kitchen_tickets
       set status = 'success', completed_at = now(), error_code = null, error_info = null
     where id = p_ticket_id;
  else
    update public.kitchen_tickets
       set status = 'error', retry_count = retry_count + 1, completed_at = now(),
           error_code = left(coalesce(p_error_code, 'UNKNOWN'), 64),
           error_info = left(coalesce(p_error_info, ''), 500)
     where id = p_ticket_id;
  end if;

  return jsonb_build_object('updated', true);
end$$;
revoke all on function public.bridge_confirm_ticket(text, uuid, boolean, text, text) from public;
grant execute on function public.bridge_confirm_ticket(text, uuid, boolean, text, text)
  to anon, authenticated;

-- ── 7. RPC-uri pentru staff (retry / cancel / reprint) ──────────────
create or replace function public.kitchen_ticket_retry(p_ticket_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_rid uuid;
begin
  select restaurant_id into v_rid from public.kitchen_tickets where id = p_ticket_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.is_admin(v_rid) then
    raise exception 'Acces interzis';
  end if;
  update public.kitchen_tickets
     set status = 'pending', bridge_device_id = null, claimed_at = null,
         completed_at = null, error_code = null, error_info = null
   where id = p_ticket_id and status in ('error', 'cancelled');
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_retryable');
  end if;
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.kitchen_ticket_retry(uuid) from public, anon;
grant execute on function public.kitchen_ticket_retry(uuid) to authenticated;

create or replace function public.kitchen_ticket_cancel(p_ticket_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_rid uuid;
begin
  select restaurant_id into v_rid from public.kitchen_tickets where id = p_ticket_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.is_admin(v_rid) then
    raise exception 'Acces interzis';
  end if;
  update public.kitchen_tickets
     set status = 'cancelled', completed_at = now()
   where id = p_ticket_id and status in ('pending', 'error');
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_cancellable');
  end if;
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.kitchen_ticket_cancel(uuid) from public, anon;
grant execute on function public.kitchen_ticket_cancel(uuid) to authenticated;

-- Reprint manual (v1 — fără auto-reprint la editare, anti spam de hârtie):
-- orice membru poate retipări (ospătarul e primul care află că s-a pierdut).
create or replace function public.kitchen_ticket_reprint(p_order_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_rid uuid;
  v_id  uuid;
begin
  select restaurant_id into v_rid from public.orders where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.is_member(v_rid) then
    raise exception 'Acces interzis';
  end if;
  perform public.enforce_feature_for_restaurant(v_rid, 'kitchen_tickets');
  if not exists (
    select 1 from public.bridge_devices
    where restaurant_id = v_rid and prints_kitchen_receipts = true
  ) then
    return jsonb_build_object('ok', false, 'reason', 'no_kitchen_printer');
  end if;

  insert into public.kitchen_tickets (restaurant_id, order_id, payload, is_reprint)
  values (v_rid, p_order_id, public.build_kitchen_ticket_payload(p_order_id, true), true)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'ticket_id', v_id);
end$$;
revoke all on function public.kitchen_ticket_reprint(uuid) from public, anon;
grant execute on function public.kitchen_ticket_reprint(uuid) to authenticated;

-- ── 8. bridge_register — lanț 030→133→227, ACEEAȘI semnătură + return ──
-- Gate lărgit: fiscal_receipt (Plan 3, casa de marcat) OR kitchen_tickets
-- (growth+, imprimanta de bucătărie). Lanțul fiscal rămâne închis: trg-ul
-- mig 133 pe pending_receipts + gate-ul 'paid' NU se ating — un device
-- growth e inert fiscal.
create or replace function public.bridge_register(
  p_restaurant_id uuid,
  p_name text,
  p_fiscalnet_brand text default null::text,
  p_fiscalnet_model text default null::text
)
returns table(device_id uuid, device_secret text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_secret text;
  v_id     uuid;
begin
  if not public.is_admin(p_restaurant_id) then
    raise exception 'Only owners/managers can register bridge devices';
  end if;

  -- mig 227: device-ul servește fie casa fiscală ('fiscal_receipt', Plan 3),
  -- fie imprimanta de bucătărie ('kitchen_tickets', growth+).
  if not (public.restaurant_has_feature(p_restaurant_id, 'fiscal_receipt')
          or public.restaurant_has_feature(p_restaurant_id, 'kitchen_tickets')) then
    raise exception 'Featurea bridge nu e disponibilă pe planul curent.'
      using errcode = 'P0001', hint = 'plan_gate';
  end if;

  v_secret := replace(gen_random_uuid()::text, '-', '') ||
              replace(gen_random_uuid()::text, '-', '');

  insert into public.bridge_devices (
    restaurant_id, name, device_secret, fiscalnet_brand, fiscalnet_model
  ) values (
    p_restaurant_id, p_name, v_secret, p_fiscalnet_brand, p_fiscalnet_model
  )
  returning id into v_id;

  return query select v_id, v_secret;
end;
$function$;

-- ── 8b. Gate-ul de pe bridge_devices (mig 149) — aceeași lărgire ─────
-- Trigger-ul enforce_bridge_device_fiscal_gate (INSERT pe bridge_devices) era
-- oglinda lui bridge_register pe fiscal_receipt — îl aliniem la gate-ul dublu,
-- altfel un device de bucătărie pe growth ar fi respins la INSERT chiar dacă
-- bridge_register îl permite.
create or replace function public.enforce_bridge_device_fiscal_gate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- mig 227: device = casă fiscală (Plan 3) SAU imprimantă bucătărie (growth+).
  if not (public.restaurant_has_feature(new.restaurant_id, 'fiscal_receipt')
          or public.restaurant_has_feature(new.restaurant_id, 'kitchen_tickets')) then
    perform public.enforce_feature_for_restaurant(new.restaurant_id, 'fiscal_receipt');
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_bridge_device_fiscal_gate() from public;

-- ── 9. Sweeper: stale → error; terminale vechi → purjate ────────────
create or replace function public.kitchen_tickets_mark_stale()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_stale  int;
  v_purged int;
begin
  update public.kitchen_tickets
     set status = 'error', error_code = 'BRIDGE_TIMEOUT',
         retry_count = retry_count + 1, completed_at = now()
   where status = 'sent' and claimed_at < now() - interval '10 minutes';
  get diagnostics v_stale = row_count;

  -- Tichetele n-au valoare de audit fiscal — tabela stă mică.
  delete from public.kitchen_tickets
   where status in ('success', 'cancelled')
     and completed_at < now() - interval '30 days';
  get diagnostics v_purged = row_count;

  return jsonb_build_object('stale', v_stale, 'purged', v_purged);
end$$;
revoke all on function public.kitchen_tickets_mark_stale() from public, anon, authenticated;
grant execute on function public.kitchen_tickets_mark_stale() to service_role;

-- ── Asserții fail-closed ──────────────────────────────────────────
do $$
declare v_def text;
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_enqueue_kitchen_ticket'
      and tgrelid = 'public.orders'::regclass
      and tgdeferrable and tginitdeferred
  ) then
    raise exception 'ASSERT FAIL (mig 227): trigger-ul de enqueue lipsește sau nu e deferred';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_kitchen_tickets_plan_gate'
      and tgrelid = 'public.kitchen_tickets'::regclass
  ) then
    raise exception 'ASSERT FAIL (mig 227): gate-ul de plan pe kitchen_tickets lipsește';
  end if;
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bridge_register' limit 1;
  if position('kitchen_tickets' in v_def) = 0 or position('fiscal_receipt' in v_def) = 0 then
    raise exception 'ASSERT FAIL (mig 227): bridge_register fără gate-ul dublu';
  end if;
  if has_table_privilege('authenticated', 'public.kitchen_tickets', 'INSERT') then
    raise exception 'ASSERT FAIL (mig 227): authenticated poate insera direct tichete';
  end if;
  -- Toate funcțiile noi au search_path fixat (advisor-ul nu crește).
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('enforce_kitchen_ticket_gate', 'build_kitchen_ticket_payload',
                        'enqueue_kitchen_ticket', 'bridge_get_pending_tickets',
                        'bridge_claim_ticket', 'bridge_confirm_ticket',
                        'kitchen_ticket_retry', 'kitchen_ticket_cancel',
                        'kitchen_ticket_reprint', 'kitchen_tickets_mark_stale')
      and (p.proconfig is null or not exists (
        select 1 from unnest(p.proconfig) c where c like 'search_path=%'
      ))
  ) then
    raise exception 'ASSERT FAIL (mig 227): funcție nouă fără search_path fixat';
  end if;
  if not exists (
    select 1 from public.plan_features
    where plan = 'growth' and feature = 'kitchen_tickets' and enabled
  ) or exists (
    select 1 from public.plan_features
    where plan = 'starter' and feature = 'kitchen_tickets' and enabled
  ) then
    raise exception 'ASSERT FAIL (mig 227): seed-ul de plan kitchen_tickets greșit';
  end if;
end $$;

commit;
