-- Migration 065: BEFORE INSERT trigger blochează waiter orders din rol kitchen
-- ─────────────────────────────────────────────────────────────────────
-- BUG (P0 securitate): create_order RPC pentru source='waiter' verifică doar
--   is_member(restaurant_id) → orice membru autentificat (inclusiv kitchen)
-- poate crea comenzi waiter.
--
-- Realitate POS: doar owner/manager/waiter trebuie să poată introduce comenzi
-- la masă. Kitchen rolul există pentru kitchen display + status updates, nu
-- pentru data entry de comenzi.
--
-- Fix: trigger BEFORE INSERT pe orders care verifică rolul când
-- source='waiter' AND created_by IS NOT NULL. Asta evită rescrierea funcției
-- create_order de 371 linii și acoperă orice viitoare RPC care ar insera
-- direct în orders (defensive layered security).

create or replace function public.trg_waiter_order_role_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role public.member_role;
begin
  -- Doar pentru comenzi waiter cu user autenticat (QR/pickup nu se aplică)
  if NEW.source != 'waiter' or NEW.created_by is null then
    return NEW;
  end if;

  -- Citim rolul direct, nu prin my_role() (care folosește auth.uid() — în
  -- context trigger SECURITY DEFINER, NEW.created_by e sursa de adevăr).
  select role into v_role
  from public.restaurant_memberships
  where restaurant_id = NEW.restaurant_id
    and user_id = NEW.created_by
  limit 1;

  if v_role is null then
    raise exception 'User has no membership in this restaurant'
      using errcode = 'P0001', hint = 'not_a_member';
  end if;

  if v_role not in ('owner', 'manager', 'waiter') then
    raise exception 'Role % not allowed to create waiter orders', v_role
      using errcode = 'P0001', hint = 'role_forbidden';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_waiter_order_role_check on public.orders;
create trigger trg_waiter_order_role_check
  before insert on public.orders
  for each row execute function public.trg_waiter_order_role_check();
