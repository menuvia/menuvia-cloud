-- =============================================================
-- Menuvia — Migration 017
-- Split bill: partial payments on orders.
-- When sum(payments) >= order.total, order auto-transitions to paid.
--
-- Run AFTER migration-016.
-- =============================================================

create table if not exists public.order_payments (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  amount        numeric(10,2) not null check (amount > 0),
  method        text not null check (method in ('cash','card_pos','other')),
  paid_by       uuid references auth.users(id) on delete set null,
  created_at    timestamptz default now()
);

create index if not exists idx_order_payments_order
  on public.order_payments (order_id);

alter table public.order_payments enable row level security;

-- Members can read payments for orders in their restaurant
create policy "order_payments: member read"
  on public.order_payments for select
  using (
    exists (
      select 1 from public.orders o
      join public.restaurant_memberships rm on rm.restaurant_id = o.restaurant_id
      where o.id = order_payments.order_id
        and rm.user_id = auth.uid()
    )
  );

-- RPC: add partial payment
create or replace function public.add_partial_payment(
  p_order_id      uuid,
  p_amount        numeric,
  p_method        text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order       record;
  v_total_paid  numeric;
  v_payment_id  uuid;
begin
  -- Validate method
  if p_method not in ('cash', 'card_pos', 'other') then
    raise exception 'Metodă de plată invalidă.';
  end if;

  if p_amount <= 0 then
    raise exception 'Suma trebuie să fie pozitivă.';
  end if;

  -- Lock the order row
  select o.id, o.restaurant_id, o.total, o.status
  into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Comandă negăsită.';
  end if;

  -- Must be served status
  if v_order.status != 'served' then
    raise exception 'Comanda trebuie să fie în status "servit" pentru plată.';
  end if;

  -- Verify caller is member
  if not exists (
    select 1 from public.restaurant_memberships
    where restaurant_id = v_order.restaurant_id
      and user_id = auth.uid()
  ) then
    raise exception 'Nu ai acces la acest restaurant.';
  end if;

  -- Insert payment
  insert into public.order_payments (order_id, amount, method, paid_by)
  values (p_order_id, p_amount, p_method, auth.uid())
  returning id into v_payment_id;

  -- Check if fully paid
  select coalesce(sum(amount), 0) into v_total_paid
  from public.order_payments
  where order_id = p_order_id;

  -- If total paid >= order total, auto-transition to paid
  if v_total_paid >= v_order.total then
    update public.orders
    set status = 'paid',
        paid_at = now(),
        paid_by = auth.uid(),
        payment_method = case
          when (select count(distinct method) from public.order_payments where order_id = p_order_id) = 1
          then p_method::text
          else 'other'
        end,
        paid_amount = v_total_paid
    where id = p_order_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'payment_id', v_payment_id,
    'total_paid', v_total_paid,
    'remaining', greatest(v_order.total - v_total_paid, 0),
    'fully_paid', v_total_paid >= v_order.total
  );
end;
$$;

grant execute on function public.add_partial_payment(uuid, numeric, text) to authenticated;

-- RPC: get payments for an order
create or replace function public.get_order_payments(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  -- Verify caller is member of the order's restaurant
  if not exists (
    select 1 from public.orders o
    join public.restaurant_memberships rm on rm.restaurant_id = o.restaurant_id
    where o.id = p_order_id
      and rm.user_id = auth.uid()
  ) then
    raise exception 'Nu ai acces.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', op.id,
      'amount', op.amount,
      'method', op.method,
      'created_at', op.created_at
    ) order by op.created_at
  ), '[]'::jsonb)
  into v_result
  from public.order_payments op
  where op.order_id = p_order_id;

  return v_result;
end;
$$;

grant execute on function public.get_order_payments(uuid) to authenticated;
