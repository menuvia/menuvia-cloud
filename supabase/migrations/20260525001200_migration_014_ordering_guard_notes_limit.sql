-- =============================================================
-- Menuvia — Migration 014
-- Production hardening — completes audit fixes.
--
-- 1. BEFORE-INSERT trigger on orders enforces:
--    - restaurants.is_active = true
--    - restaurant_settings.ordering_enabled != false
--    Fires even for SECURITY DEFINER RPC (create_order), so no
--    need to rewrite the 150-line create_order function.
--
-- 2. CHECK constraints on notes length:
--    - orders.notes        <= 500 chars
--    - order_items.notes   <= 300 chars
--    Blocks abuse (100KB payload breaks UI, floods storage).
--
-- Run AFTER migration-013.
-- =============================================================


-- =============================================================
-- 1. Ordering guard trigger
-- =============================================================

create or replace function public.enforce_ordering_enabled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Restaurant must exist and be active
  if not exists (
    select 1 from public.restaurants
    where id = new.restaurant_id
      and is_active = true
  ) then
    raise exception 'Restaurantul este dezactivat.'
      using errcode = 'check_violation';
  end if;

  -- If restaurant_settings row exists, ordering_enabled must be true
  -- (absence of row = default true = allowed)
  if exists (
    select 1 from public.restaurant_settings
    where restaurant_id = new.restaurant_id
      and ordering_enabled = false
  ) then
    raise exception 'Comenzile sunt oprite momentan pentru acest restaurant.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_ordering_enabled on public.orders;
create trigger trg_enforce_ordering_enabled
  before insert on public.orders
  for each row execute function public.enforce_ordering_enabled();


-- =============================================================
-- 2. Notes length constraints
-- =============================================================

do $$ begin
  alter table public.orders
    add constraint orders_notes_len check (notes is null or length(notes) <= 500);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.order_items
    add constraint order_items_notes_len check (notes is null or length(notes) <= 300);
exception when duplicate_object then null; end $$;
