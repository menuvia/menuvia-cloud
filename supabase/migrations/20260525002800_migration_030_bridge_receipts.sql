-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 030 — Bridge casă de marcat (FiscalNet integration)
-- ═══════════════════════════════════════════════════════════════
-- Arhitectura:
--   1. Order trece în 'paid' → trigger generează payload FiscalNet
--      și-l inserează în pending_receipts cu status='pending'.
--   2. Bridge local (Node.js pe PC-ul clientului) polluează prin
--      RPC bridge_get_pending(device_secret) la fiecare 5-30s.
--   3. Bridge scrie payload în C:\FiscalNet\Bonuri\<uuid>.txt
--      → FiscalNet listează bonul → scrie răspuns în \Raspuns\
--      → Bridge citește răspunsul → cheamă bridge_confirm_receipt
--      cu success/error.
--   4. Dashboard tab "📟 Casă de marcat" arată status device + queue.
--
-- Format FiscalNet (din docs EconMedia):
--   S^NUME^PRET_BANI^CANT_MII^buc^GRUPA_TVA^1   (vânzare item)
--   ST^                                          (subtotal)
--   P^METODA^TOTAL_BANI                          (plată)
--
-- Decizii cheie:
--   • Fiecare item se trimite cu quantity=1 (1000 mii) și price=item_total
--     ca să evităm probleme de rotunjire la cents.
--   • TVA mapping: vat_rates.vat_group (1-4 intern) → fiscalnet_group (1-5
--     pe casă). Default identical; owner poate ajusta dacă instalator-ul
--     a configurat casa diferit.
--   • Idempotency: pending_receipts.id (uuid) = numele fișierului .txt.
--     Dacă bridge-ul rescrie același fișier, FiscalNet îl recunoaște.

-- ═══════════════════════════════════════════════════════════════
-- 1) FISCALNET GROUP MAPPING pe vat_rates
-- ═══════════════════════════════════════════════════════════════
alter table public.vat_rates
  add column if not exists fiscalnet_group smallint
    check (fiscalnet_group between 1 and 5);

-- Backfill: default = vat_group (1→1, 2→2, 3→3, 4→4)
update public.vat_rates
   set fiscalnet_group = vat_group
 where fiscalnet_group is null;

-- De-acum încolo obligatoriu
alter table public.vat_rates
  alter column fiscalnet_group set not null,
  alter column fiscalnet_group set default 1;

comment on column public.vat_rates.fiscalnet_group is
  'Grupa TVA pe casa de marcat (1-5). Setată de instalator la fiscalizare. Default = vat_group.';

-- ═══════════════════════════════════════════════════════════════
-- 2) BRIDGE DEVICES (case de marcat înregistrate)
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.bridge_devices (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,

  -- Identitate
  name            text not null check (length(name) between 1 and 80),
  device_secret   text not null unique,  -- UUID generat la înregistrare (auth pentru bridge)

  -- Status și activitate
  status          text not null default 'offline'
                    check (status in ('online', 'offline', 'error')),
  last_seen_at    timestamptz,
  last_error      text,

  -- Configurare FiscalNet (descriptiv, nu controlează bridge-ul)
  fiscalnet_brand text,           -- 'datecs', 'activa', 'tremol', etc.
  fiscalnet_model text,           -- 'DP-25', 'MP-55', etc.
  fiscalnet_license_type text     -- 'pro', 'plus'
                    check (fiscalnet_license_type in ('pro', 'plus') or fiscalnet_license_type is null),

  -- Print imprimantă bucătărie (opțional, viitor)
  prints_kitchen_receipts boolean not null default false,

  -- Metadata
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists bridge_devices_restaurant_idx on public.bridge_devices(restaurant_id);
create index if not exists bridge_devices_secret_idx     on public.bridge_devices(device_secret);

comment on table public.bridge_devices is
  'Case de marcat înregistrate per restaurant. Un device = un PC cu FiscalNet + bridge Menuvia.';

-- RLS
alter table public.bridge_devices enable row level security;

create policy "bridge_devices: admin manage" on public.bridge_devices for all
  using (public.is_admin(restaurant_id))
  with check (public.is_admin(restaurant_id));

create policy "bridge_devices: members read" on public.bridge_devices for select
  using (public.is_member(restaurant_id));

-- Auto-update updated_at
create or replace function public.bridge_devices_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists bridge_devices_touch_trg on public.bridge_devices;
create trigger bridge_devices_touch_trg
  before update on public.bridge_devices
  for each row execute function public.bridge_devices_touch();

-- ═══════════════════════════════════════════════════════════════
-- 3) PENDING RECEIPTS (queue bonuri spre tipărire)
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.pending_receipts (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  order_id        uuid not null references public.orders(id) on delete cascade,

  -- Payload FiscalNet (textul .txt brut)
  payload         text not null,

  -- Status flow
  status          text not null default 'pending'
                    check (status in ('pending', 'sent', 'success', 'error', 'cancelled')),
  --   pending   = în queue, bridge nu l-a luat încă
  --   sent      = bridge l-a luat și l-a scris în \Bonuri (în lucru pe casă)
  --   success   = FiscalNet returnat BONOK=1
  --   error     = FiscalNet returnat BONOK=0 sau timeout sau bridge crăpat
  --   cancelled = anulat manual de owner (ex: comandă greșită deja tipărită altcum)

  -- Atribuire bridge (umplut la claim)
  bridge_device_id uuid references public.bridge_devices(id) on delete set null,

  -- Rezultat FiscalNet
  bon_number      text,      -- NRBON din răspunsul FiscalNet (când e success)
  error_code      text,      -- ERRCODE când e error
  error_info      text,      -- ERRINFO când e error

  -- Retry tracking
  retry_count     smallint not null default 0,

  -- Snapshot pentru audit (chiar dacă order_id e șters cumva)
  total_snapshot  numeric(10,2) not null,

  -- Timestamps
  created_at      timestamptz not null default now(),
  claimed_at      timestamptz,   -- când bridge l-a luat
  completed_at    timestamptz    -- success sau error final
);

-- Indexes pentru query-uri tipice
create index if not exists pending_receipts_restaurant_status_idx
  on public.pending_receipts(restaurant_id, status, created_at);
create index if not exists pending_receipts_order_idx
  on public.pending_receipts(order_id);
create index if not exists pending_receipts_status_idx
  on public.pending_receipts(status) where status in ('pending', 'sent');

comment on table public.pending_receipts is
  'Queue bonuri fiscale generate la order.paid. Bridge-ul local le ridică, scrie în FiscalNet, raportează rezultat.';

-- RLS
alter table public.pending_receipts enable row level security;

create policy "pending_receipts: members read" on public.pending_receipts for select
  using (public.is_member(restaurant_id));

create policy "pending_receipts: admin manage" on public.pending_receipts for all
  using (public.is_admin(restaurant_id))
  with check (public.is_admin(restaurant_id));

-- ═══════════════════════════════════════════════════════════════
-- 4) HELPER: sanitize product name pentru bon (max 36 chars, fără ^)
-- ═══════════════════════════════════════════════════════════════
create or replace function public.fiscalnet_sanitize(p_text text)
returns text
language sql immutable
set search_path = public
as $$
  select substring(
    regexp_replace(coalesce(p_text, ''), '[\^\r\n\t]', ' ', 'g'),
    1, 36
  );
$$;

-- ═══════════════════════════════════════════════════════════════
-- 5) HELPER: convert payment_method enum → cod FiscalNet
-- ═══════════════════════════════════════════════════════════════
-- 1=Numerar, 2=Card, 3=Credit, 4=Tichet masa, 5=Tichet valoric,
-- 6=Voucher, 7=Plata moderna, 8=Alte modalitati
create or replace function public.fiscalnet_payment_code(p_method public.payment_method)
returns smallint
language sql immutable
set search_path = public
as $$
  select case p_method
    when 'cash'     then 1::smallint
    when 'card_pos' then 2::smallint
    when 'other'    then 8::smallint
    else 1::smallint  -- fallback numerar
  end;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 6) MAIN BUILDER: build_fiscalnet_payload(order_id) → text
-- ═══════════════════════════════════════════════════════════════
-- Returnează stringul .txt complet pentru FiscalNet, conform spec EconMedia.
-- Format:
--   S^NUME^PRET^CANT^buc^GRTVA^1   (per item, qty=1 ca să evităm rotunjiri)
--   ST^                            (subtotal opțional, doar pentru claritate)
--   P^METODA^TOTAL                 (plată)
create or replace function public.build_fiscalnet_payload(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order      record;
  v_item       record;
  v_lines      text[] := array[]::text[];
  v_total_cents bigint := 0;
  v_payment_code smallint;
begin
  -- Pull order header
  select o.id, o.restaurant_id, o.payment_method, o.total, o.paid_amount
    into v_order
    from public.orders o
   where o.id = p_order_id;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  -- Pull items + vat mapping
  for v_item in
    select
      oi.id,
      oi.product_name_snapshot,
      oi.item_total,
      coalesce(p.vat_group, 1) as vat_group_internal,
      coalesce(vr.fiscalnet_group, coalesce(p.vat_group, 1)) as fn_group
    from public.order_items oi
    left join public.products p on p.id = oi.product_id
    left join public.vat_rates vr on vr.restaurant_id = v_order.restaurant_id
                                  and vr.vat_group = coalesce(p.vat_group, 1)
    where oi.order_id = p_order_id
    order by oi.created_at
  loop
    -- Convertim item_total în cents (integer)
    v_total_cents := v_total_cents + round(v_item.item_total * 100)::bigint;

    -- Linie vânzare: S^NUME^PRET_CENTS^1000^buc^GRTVA^1
    v_lines := v_lines || format(
      'S^%s^%s^1000^buc^%s^1',
      public.fiscalnet_sanitize(v_item.product_name_snapshot),
      round(v_item.item_total * 100)::bigint,
      v_item.fn_group
    );
  end loop;

  if array_length(v_lines, 1) is null then
    raise exception 'Order % has no items', p_order_id;
  end if;

  -- Subtotal (pentru claritate pe bon)
  v_lines := v_lines || 'ST^';

  -- Plată: P^COD^TOTAL_CENTS
  v_payment_code := public.fiscalnet_payment_code(v_order.payment_method);
  v_lines := v_lines || format('P^%s^%s', v_payment_code, v_total_cents);

  return array_to_string(v_lines, E'\n');
end;
$$;

comment on function public.build_fiscalnet_payload(uuid) is
  'Generează payload-ul .txt FiscalNet pentru un order. Folosit de trigger la order.paid.';

-- ═══════════════════════════════════════════════════════════════
-- 7) TRIGGER: la order.paid → INSERT în pending_receipts
-- ═══════════════════════════════════════════════════════════════
create or replace function public.enqueue_fiscal_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_bridge boolean;
  v_payload    text;
begin
  -- Doar tranziție 'paid' (nu 'paid'→'paid')
  if new.status <> 'paid' or coalesce(old.status, 'new'::public.order_status) = 'paid' then
    return new;
  end if;

  -- Skip dacă restaurantul nu are bridge configurat (evităm queue orphan)
  -- Owner-ul va vedea în Dashboard alertă "configurare necesară" dacă vrea bridge
  select exists (
    select 1 from public.bridge_devices
    where restaurant_id = new.restaurant_id
  ) into v_has_bridge;

  if not v_has_bridge then
    return new;
  end if;

  -- Idempotency: dacă există deja pending/sent pentru order-ul ăsta, skip
  if exists (
    select 1 from public.pending_receipts
    where order_id = new.id
      and status in ('pending', 'sent', 'success')
  ) then
    return new;
  end if;

  -- Generăm payload-ul
  begin
    v_payload := public.build_fiscalnet_payload(new.id);
  exception when others then
    -- Nu blocăm marcarea ca plătit dacă payload-ul eșuează
    -- Log în pending_receipts cu status='error' ca să vadă owner-ul
    insert into public.pending_receipts (
      restaurant_id, order_id, payload, status, error_info, total_snapshot
    ) values (
      new.restaurant_id, new.id, '', 'error', SQLERRM, new.total
    );
    return new;
  end;

  -- INSERT în queue
  insert into public.pending_receipts (
    restaurant_id, order_id, payload, total_snapshot
  ) values (
    new.restaurant_id, new.id, v_payload, new.total
  );

  return new;
end;
$$;

drop trigger if exists enqueue_fiscal_receipt_trg on public.orders;
create trigger enqueue_fiscal_receipt_trg
  after update of status on public.orders
  for each row execute function public.enqueue_fiscal_receipt();

-- ═══════════════════════════════════════════════════════════════
-- 8) RPC: bridge_register — admin generează un device + secret
-- ═══════════════════════════════════════════════════════════════
create or replace function public.bridge_register(
  p_restaurant_id   uuid,
  p_name            text,
  p_fiscalnet_brand text default null,
  p_fiscalnet_model text default null
)
returns table (device_id uuid, device_secret text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_id     uuid;
begin
  if not public.is_admin(p_restaurant_id) then
    raise exception 'Only owners/managers can register bridge devices';
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
$$;

revoke all on function public.bridge_register(uuid, text, text, text) from public;
grant execute on function public.bridge_register(uuid, text, text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 9) RPC: bridge_heartbeat — bridge anunță că e online
-- ═══════════════════════════════════════════════════════════════
create or replace function public.bridge_heartbeat(p_device_secret text)
returns table (device_id uuid, restaurant_id uuid, ok boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device record;
begin
  select id, restaurant_id into v_device
    from public.bridge_devices
   where device_secret = p_device_secret;

  if not found then
    return query select null::uuid, null::uuid, false;
    return;
  end if;

  update public.bridge_devices
     set last_seen_at = now(),
         status       = 'online',
         last_error   = null
   where id = v_device.id;

  return query select v_device.id, v_device.restaurant_id, true;
end;
$$;

revoke all on function public.bridge_heartbeat(text) from public;
grant execute on function public.bridge_heartbeat(text) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 10) RPC: bridge_get_pending — bridge ridică bonurile pending
-- ═══════════════════════════════════════════════════════════════
-- Returnează maxim 10 bonuri pending pentru restaurantul device-ului.
-- NU le marchează încă ca 'sent' — asta o face bridge_claim_receipt
-- după ce bridge-ul a scris fișierul cu succes pe disk.
create or replace function public.bridge_get_pending(p_device_secret text)
returns table (
  id            uuid,
  order_id      uuid,
  payload       text,
  retry_count   smallint,
  created_at    timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
begin
  select restaurant_id into v_restaurant_id
    from public.bridge_devices
   where device_secret = p_device_secret;

  if not found then
    raise exception 'Invalid device secret';
  end if;

  -- Update heartbeat în trecere
  update public.bridge_devices
     set last_seen_at = now(),
         status       = 'online'
   where device_secret = p_device_secret;

  return query
    select pr.id, pr.order_id, pr.payload, pr.retry_count, pr.created_at
      from public.pending_receipts pr
     where pr.restaurant_id = v_restaurant_id
       and pr.status = 'pending'
     order by pr.created_at
     limit 10;
end;
$$;

revoke all on function public.bridge_get_pending(text) from public;
grant execute on function public.bridge_get_pending(text) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 11) RPC: bridge_claim_receipt — bridge marchează ca 'sent'
-- ═══════════════════════════════════════════════════════════════
-- După ce bridge-ul a scris cu succes fișierul .txt în \Bonuri\,
-- cheamă asta. Așa se evită ca alt bridge (în setup cu 2 case) să-l ridice.
create or replace function public.bridge_claim_receipt(
  p_device_secret text,
  p_receipt_id    uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device_id     uuid;
  v_restaurant_id uuid;
  v_updated       int;
begin
  select id, restaurant_id into v_device_id, v_restaurant_id
    from public.bridge_devices
   where device_secret = p_device_secret;

  if not found then
    raise exception 'Invalid device secret';
  end if;

  -- Atomic claim: schimbă status doar dacă încă e pending
  update public.pending_receipts
     set status           = 'sent',
         bridge_device_id = v_device_id,
         claimed_at       = now()
   where id            = p_receipt_id
     and restaurant_id = v_restaurant_id
     and status        = 'pending';

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.bridge_claim_receipt(text, uuid) from public;
grant execute on function public.bridge_claim_receipt(text, uuid) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 12) RPC: bridge_confirm_receipt — rezultat final de la FiscalNet
-- ═══════════════════════════════════════════════════════════════
create or replace function public.bridge_confirm_receipt(
  p_device_secret text,
  p_receipt_id    uuid,
  p_success       boolean,
  p_bon_number    text default null,
  p_error_code    text default null,
  p_error_info    text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_updated       int;
begin
  select restaurant_id into v_restaurant_id
    from public.bridge_devices
   where device_secret = p_device_secret;

  if not found then
    raise exception 'Invalid device secret';
  end if;

  update public.pending_receipts
     set status       = case when p_success then 'success' else 'error' end,
         bon_number   = case when p_success then p_bon_number else bon_number end,
         error_code   = case when p_success then null else p_error_code end,
         error_info   = case when p_success then null else p_error_info end,
         completed_at = now(),
         retry_count  = case when p_success then retry_count else retry_count + 1 end
   where id            = p_receipt_id
     and restaurant_id = v_restaurant_id;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.bridge_confirm_receipt(text, uuid, boolean, text, text, text) from public;
grant execute on function public.bridge_confirm_receipt(text, uuid, boolean, text, text, text) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 13) RPC: bridge_retry_receipt — admin retrimite un bon eșuat
-- ═══════════════════════════════════════════════════════════════
create or replace function public.bridge_retry_receipt(p_receipt_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_updated       int;
begin
  select restaurant_id into v_restaurant_id
    from public.pending_receipts
   where id = p_receipt_id;

  if not found then
    return false;
  end if;

  if not public.is_admin(v_restaurant_id) then
    raise exception 'Only owners/managers can retry receipts';
  end if;

  update public.pending_receipts
     set status           = 'pending',
         bridge_device_id = null,
         claimed_at       = null,
         completed_at     = null,
         error_code       = null,
         error_info       = null
   where id     = p_receipt_id
     and status in ('error', 'cancelled');

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.bridge_retry_receipt(uuid) from public;
grant execute on function public.bridge_retry_receipt(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 14) RPC: bridge_cancel_receipt — admin anulează un bon pending
-- ═══════════════════════════════════════════════════════════════
create or replace function public.bridge_cancel_receipt(p_receipt_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_updated       int;
begin
  select restaurant_id into v_restaurant_id
    from public.pending_receipts
   where id = p_receipt_id;

  if not found then
    return false;
  end if;

  if not public.is_admin(v_restaurant_id) then
    raise exception 'Only owners/managers can cancel receipts';
  end if;

  update public.pending_receipts
     set status       = 'cancelled',
         completed_at = now()
   where id     = p_receipt_id
     and status in ('pending', 'error');

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.bridge_cancel_receipt(uuid) from public;
grant execute on function public.bridge_cancel_receipt(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 15) PERIODIC CLEANUP: mark stale 'sent' as 'error' (timeout 10 min)
-- ═══════════════════════════════════════════════════════════════
-- Apelată periodic (cron Supabase sau manual). Detectează bonuri care
-- au fost ridicate de bridge dar n-au primit confirmare în 10 min.
create or replace function public.bridge_mark_stale_as_error()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.pending_receipts
     set status       = 'error',
         error_code   = 'BRIDGE_TIMEOUT',
         error_info   = 'Bridge a luat bonul dar nu a confirmat în 10 minute',
         completed_at = now(),
         retry_count  = retry_count + 1
   where status = 'sent'
     and claimed_at < now() - interval '10 minutes';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.bridge_mark_stale_as_error() from public;
grant execute on function public.bridge_mark_stale_as_error() to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 16) PERMISIUNI tabele
-- ═══════════════════════════════════════════════════════════════
grant select, insert, update, delete on public.bridge_devices to authenticated;
grant select on public.bridge_devices to anon;  -- pentru bridge polling (filtrat prin RPC)

grant select, insert, update, delete on public.pending_receipts to authenticated;
grant select on public.pending_receipts to anon;
