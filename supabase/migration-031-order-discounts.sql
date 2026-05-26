-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 031 — Reduceri (discount-uri) manuale pe comandă
-- ═══════════════════════════════════════════════════════════════
-- Permite owner/manager să aplice reducere pe o comandă deschisă
-- (înainte de status='paid'). Suportă:
--   • Procent (ex: 10% off pe totalul comenzii)
--   • Sumă fixă (ex: 5 RON off pe totalul comenzii)
--
-- Limitări v1:
--   • Reducere doar pe TOTAL comandă (nu per item)
--   • Doar admin/manager pot aplica (ospătar cheamă manager)
--   • Nu există approval workflow peste prag (vine ulterior)
--   • Nu are reguli automate happy hour (vine în iterație separată)
--
-- Integrare FiscalNet: la trimitere la casă, se generează linia
-- DP^<percent*100> sau DV^<amount_cents> după ST^.

-- ═══════════════════════════════════════════════════════════════
-- 1) ENUM tip reducere
-- ═══════════════════════════════════════════════════════════════
do $$ begin
  create type public.order_discount_type as enum ('percent', 'amount');
exception when duplicate_object then null; end $$;

-- ═══════════════════════════════════════════════════════════════
-- 2) COLOANE pe orders
-- ═══════════════════════════════════════════════════════════════
alter table public.orders
  add column if not exists discount_type        public.order_discount_type,
  add column if not exists discount_value       numeric(10,2),
  add column if not exists discount_amount      numeric(10,2) not null default 0,
  add column if not exists discount_reason      text,
  add column if not exists discount_applied_by  uuid references auth.users(id) on delete set null,
  add column if not exists discount_applied_at  timestamptz;

-- Validări la nivel de coloană (defensive — RPC-urile verifică prima)
alter table public.orders
  drop constraint if exists orders_discount_value_check,
  drop constraint if exists orders_discount_amount_check;

alter table public.orders
  add constraint orders_discount_value_check check (
    discount_value is null or discount_value > 0
  ),
  add constraint orders_discount_amount_check check (
    discount_amount >= 0
  );

comment on column public.orders.discount_type is
  'Tipul reducerii: percent (procent din total) sau amount (sumă fixă în RON).';
comment on column public.orders.discount_value is
  'Valoarea input — procent (1-100) sau sumă RON. NULL = fără reducere.';
comment on column public.orders.discount_amount is
  'Suma calculată a reducerii în RON (auto-completată de _refresh_order_totals).';

-- ═══════════════════════════════════════════════════════════════
-- 3) HELPER: recalc totals (subtotal + discount → total)
-- ═══════════════════════════════════════════════════════════════
create or replace function public._refresh_order_totals(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subtotal        numeric(10,2);
  v_discount_amount numeric(10,2);
  v_dtype           public.order_discount_type;
  v_dvalue          numeric(10,2);
begin
  -- Subtotal din items
  select coalesce(sum(item_total), 0)
    into v_subtotal
    from public.order_items
   where order_id = p_order_id;

  -- Config reducere
  select discount_type, discount_value
    into v_dtype, v_dvalue
    from public.orders
   where id = p_order_id;

  -- Compute discount amount
  if v_dtype = 'percent' and v_dvalue is not null then
    v_discount_amount := round(v_subtotal * v_dvalue / 100, 2);
  elsif v_dtype = 'amount' and v_dvalue is not null then
    v_discount_amount := least(v_subtotal, v_dvalue);  -- never exceed subtotal
  else
    v_discount_amount := 0;
  end if;

  -- Update orders.total + discount_amount
  update public.orders
     set total           = greatest(0, v_subtotal - v_discount_amount),
         discount_amount = v_discount_amount
   where id = p_order_id;
end;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 4) Update trigger recalc_order_subtotal să folosească helperul
-- ═══════════════════════════════════════════════════════════════
create or replace function public.recalc_order_subtotal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._refresh_order_totals(coalesce(new.order_id, old.order_id));
  return coalesce(new, old);
end;
$$;

-- Triggerul `order_items_subtotal_sync` definit în migration-003 e păstrat;
-- doar funcția se schimbă.

-- ═══════════════════════════════════════════════════════════════
-- 5) RPC: apply_order_discount
-- ═══════════════════════════════════════════════════════════════
create or replace function public.apply_order_discount(
  p_order_id uuid,
  p_type     text,         -- 'percent' or 'amount'
  p_value    numeric,
  p_reason   text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_status        public.order_status;
begin
  select restaurant_id, status into v_restaurant_id, v_status
    from public.orders
   where id = p_order_id;

  if v_restaurant_id is null then
    raise exception 'Order % not found', p_order_id;
  end if;

  if not public.is_admin(v_restaurant_id) then
    raise exception 'Only owners/managers can apply discounts';
  end if;

  if v_status in ('paid', 'cancelled') then
    raise exception 'Cannot apply discount to a % order', v_status;
  end if;

  -- Validări input
  if p_type not in ('percent', 'amount') then
    raise exception 'Discount type must be percent or amount';
  end if;

  if p_value is null or p_value <= 0 then
    raise exception 'Discount value must be > 0';
  end if;

  if p_type = 'percent' and p_value > 100 then
    raise exception 'Percent discount cannot exceed 100';
  end if;

  -- Aplică
  update public.orders
     set discount_type       = p_type::public.order_discount_type,
         discount_value      = p_value,
         discount_reason     = nullif(trim(coalesce(p_reason, '')), ''),
         discount_applied_by = auth.uid(),
         discount_applied_at = now()
   where id = p_order_id;

  perform public._refresh_order_totals(p_order_id);
  return true;
end;
$$;

revoke all on function public.apply_order_discount(uuid, text, numeric, text) from public;
grant execute on function public.apply_order_discount(uuid, text, numeric, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 6) RPC: remove_order_discount
-- ═══════════════════════════════════════════════════════════════
create or replace function public.remove_order_discount(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_status        public.order_status;
begin
  select restaurant_id, status into v_restaurant_id, v_status
    from public.orders
   where id = p_order_id;

  if v_restaurant_id is null then
    raise exception 'Order % not found', p_order_id;
  end if;

  if not public.is_admin(v_restaurant_id) then
    raise exception 'Only owners/managers can remove discounts';
  end if;

  if v_status in ('paid', 'cancelled') then
    raise exception 'Cannot remove discount on a % order', v_status;
  end if;

  update public.orders
     set discount_type       = null,
         discount_value      = null,
         discount_reason     = null,
         discount_applied_by = null,
         discount_applied_at = null
   where id = p_order_id;

  perform public._refresh_order_totals(p_order_id);
  return true;
end;
$$;

revoke all on function public.remove_order_discount(uuid) from public;
grant execute on function public.remove_order_discount(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 7) Update build_fiscalnet_payload să includă discount-ul
-- ═══════════════════════════════════════════════════════════════
-- Format updated:
--   S^Item1^...
--   S^Item2^...
--   ST^                    (subtotal — discount aplicat după)
--   DP^<percent*100>       (dacă procent)
--   DV^<amount_cents>      (dacă sumă fixă)
--   P^<method>^<total>     (total = subtotal - discount)
create or replace function public.build_fiscalnet_payload(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order        record;
  v_item         record;
  v_lines        text[] := array[]::text[];
  v_payment_code smallint;
begin
  select o.id, o.restaurant_id, o.payment_method, o.total,
         o.discount_type, o.discount_value
    into v_order
    from public.orders o
   where o.id = p_order_id;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  -- Item lines
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

  -- Subtotal (necesar înainte de discount pe total bon)
  v_lines := v_lines || 'ST^';

  -- Discount linie (după ST^, conform docs EconMedia)
  if v_order.discount_type = 'percent' and v_order.discount_value > 0 then
    v_lines := v_lines || format('DP^%s', round(v_order.discount_value * 100)::bigint);
  elsif v_order.discount_type = 'amount' and v_order.discount_value > 0 then
    v_lines := v_lines || format('DV^%s', round(v_order.discount_value * 100)::bigint);
  end if;

  -- Plată: folosim v_order.total care e DEJA după discount (recalculat de trigger)
  v_payment_code := public.fiscalnet_payment_code(v_order.payment_method);
  v_lines := v_lines || format('P^%s^%s', v_payment_code, round(v_order.total * 100)::bigint);

  return array_to_string(v_lines, E'\n');
end;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 8) Backfill: orders existente fără discount → discount_amount=0
-- ═══════════════════════════════════════════════════════════════
update public.orders
   set discount_amount = 0
 where discount_amount is null;

-- ═══════════════════════════════════════════════════════════════
-- KNOWN LIMITATION — vat_report_daily nu împarte discount-ul pe TVA
-- ═══════════════════════════════════════════════════════════════
-- View-ul vat_report_daily (din migration 028/029) calculează TVA pe
-- baza item_total din order_items, NU pe baza total-ului post-discount.
-- Asta înseamnă: dacă o comandă are reducere, raportul TVA intern al
-- Menuvia va arăta venit total mai mare decât bonul fiscal de pe casă.
--
-- Pentru conformitate fiscală, raportul Z al casei de marcat e cel
-- oficial. Discrepanța intern vs casă va fi proporțională cu volumul
-- de discount-uri aplicate.
--
-- Fix viitor (în v2): split discount proportional pe grupele TVA și
-- update vat_report_daily să folosească (item_total - item_discount_share).
