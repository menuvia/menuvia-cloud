-- =============================================================
-- Menuvia — Migration 016
-- Waiter calls: customers can call a waiter from QR menu.
--
-- Run AFTER migration-015.
-- =============================================================

create table if not exists public.waiter_calls (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_id      uuid references public.tables(id) on delete set null,
  qr_token_id   uuid references public.qr_tokens(id) on delete set null,
  status        text not null default 'pending' check (status in ('pending','resolved')),
  created_at    timestamptz default now(),
  resolved_at   timestamptz,
  resolved_by   uuid references auth.users(id) on delete set null
);

create index if not exists idx_waiter_calls_restaurant_status
  on public.waiter_calls (restaurant_id, status, created_at desc);

alter table public.waiter_calls enable row level security;

-- NOTE: "waiter_calls: member read" policy already created in migration-008.
-- Skipping duplicate creation.

-- RPC: call waiter (anon allowed — customer scans QR)
create or replace function public.call_waiter(p_qr_token_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token    record;
  v_call_id  uuid;
begin
  -- Validate QR token
  select qt.id, qt.restaurant_id, qt.table_id
  into v_token
  from public.qr_tokens qt
  where qt.id = p_qr_token_id
    and qt.is_active = true;

  if not found then
    raise exception 'QR token invalid sau expirat.';
  end if;

  -- Rate limit: max 1 pending call per table per 5 minutes
  if exists (
    select 1 from public.waiter_calls
    where table_id = v_token.table_id
      and status = 'pending'
      and created_at > now() - interval '5 minutes'
  ) then
    return jsonb_build_object('ok', true, 'message', 'Ospătarul a fost deja chemat.');
  end if;

  insert into public.waiter_calls (restaurant_id, table_id, qr_token_id)
  values (v_token.restaurant_id, v_token.table_id, p_qr_token_id)
  returning id into v_call_id;

  return jsonb_build_object('ok', true, 'call_id', v_call_id);
end;
$$;

grant execute on function public.call_waiter(uuid) to anon, authenticated;

-- RPC: resolve waiter call (authenticated staff only)
create or replace function public.resolve_waiter_call(p_call_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_call record;
begin
  select wc.* into v_call
  from public.waiter_calls wc
  where wc.id = p_call_id
    and wc.status = 'pending';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Apel negăsit sau deja rezolvat.');
  end if;

  -- Verify caller is member of this restaurant
  if not exists (
    select 1 from public.restaurant_memberships
    where restaurant_id = v_call.restaurant_id
      and user_id = auth.uid()
  ) then
    raise exception 'Nu ai acces la acest restaurant.';
  end if;

  update public.waiter_calls
  set status = 'resolved',
      resolved_at = now(),
      resolved_by = auth.uid()
  where id = p_call_id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.resolve_waiter_call(uuid) to authenticated;
