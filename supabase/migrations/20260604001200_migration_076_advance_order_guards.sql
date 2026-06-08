-- Migration 076: advance_order — guard de rol + guard de tranziție
-- ─────────────────────────────────────────────────────────────────────
-- Audit flux comandă (P1): advance_order (mig 043) e SECURITY DEFINER
-- (bypassează RLS) și verifica DOAR membership-ul, nu rolul și nici
-- statusul curent. Două găuri reale:
--
--   1. ROL: orice membru, inclusiv 'kitchen', putea face mark_paid și
--      cancel. Bucătăria n-ar trebui să încaseze sau să anuleze bonuri.
--
--   2. STATE MACHINE: case-ul seta noul status necondiționat. Puteai
--      face mark_paid pe o comandă 'new' (sărind bucătăria), anula un
--      bon deja 'paid', sau re-confirma la nesfârșit. Integritate ruptă.
--
-- Fix (păstrez semnătura identică — UI-ul nu se schimbă):
--   • Citesc rolul apelantului din restaurant_memberships.
--   • Per acțiune: set de roluri permise + set de statusuri-sursă valide.
--   • Erori clare cu errcode P0001 + hint pentru UI.
--
-- Roluri (member_role): owner, manager, waiter, kitchen.
-- Matrice:
--   confirm/start_preparing/mark_ready → owner, manager, kitchen, waiter
--     (flux bucătărie; waiter inclus pt. venue mici cu un singur device)
--   mark_served                        → owner, manager, waiter
--   mark_paid                          → owner, manager, waiter (NU kitchen)
--   cancel                             → owner, manager, waiter (NU kitchen)
--
-- Tranziții (statusuri-sursă permise). Comenzile terminale (paid,
-- cancelled) nu mai pot fi avansate deloc.

create or replace function public.advance_order(
  p_order_id        uuid,
  p_action          text,
  p_payment_method  text default null,
  p_paid_amount     numeric default null,
  p_tips_amount     numeric default null,
  p_cancel_reason   text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  public.orders%rowtype;
  v_role   public.member_role;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Comandă inexistentă';
  end if;

  -- Rolul apelantului în restaurantul comenzii
  select role into v_role
  from public.restaurant_memberships
  where user_id = auth.uid()
    and restaurant_id = v_order.restaurant_id
  limit 1;

  if v_role is null then
    raise exception 'Acces interzis'
      using errcode = 'P0001', hint = 'not_a_member';
  end if;

  -- Comenzile închise nu mai pot fi avansate (orice acțiune)
  if v_order.status in ('paid', 'cancelled') then
    raise exception 'Comanda este % și nu mai poate fi modificată', v_order.status
      using errcode = 'P0001', hint = 'order_closed';
  end if;

  case p_action
    when 'confirm' then
      if v_role not in ('owner','manager','kitchen','waiter') then
        raise exception 'Rol % nu poate confirma comenzi', v_role using errcode='P0001', hint='role_forbidden';
      end if;
      if v_order.status <> 'new' then
        raise exception 'Nu pot confirma o comandă în starea %', v_order.status using errcode='P0001', hint='bad_transition';
      end if;
      update public.orders set status='confirmed', confirmed_at=now() where id=p_order_id;

    when 'start_preparing' then
      if v_role not in ('owner','manager','kitchen','waiter') then
        raise exception 'Rol % nu poate porni prepararea', v_role using errcode='P0001', hint='role_forbidden';
      end if;
      if v_order.status not in ('new','confirmed') then
        raise exception 'Nu pot porni prepararea din starea %', v_order.status using errcode='P0001', hint='bad_transition';
      end if;
      update public.orders set status='preparing', preparing_at=now() where id=p_order_id;

    when 'mark_ready' then
      if v_role not in ('owner','manager','kitchen','waiter') then
        raise exception 'Rol % nu poate marca gata', v_role using errcode='P0001', hint='role_forbidden';
      end if;
      if v_order.status not in ('confirmed','preparing') then
        raise exception 'Nu pot marca gata din starea %', v_order.status using errcode='P0001', hint='bad_transition';
      end if;
      update public.orders set status='ready', ready_at=now() where id=p_order_id;

    when 'mark_served' then
      if v_role not in ('owner','manager','waiter') then
        raise exception 'Rol % nu poate marca servit', v_role using errcode='P0001', hint='role_forbidden';
      end if;
      if v_order.status not in ('ready','preparing') then
        raise exception 'Nu pot marca servit din starea %', v_order.status using errcode='P0001', hint='bad_transition';
      end if;
      update public.orders set status='served', served_at=now(), served_by=auth.uid() where id=p_order_id;

    when 'mark_paid' then
      if v_role not in ('owner','manager','waiter') then
        raise exception 'Rol % nu poate încasa', v_role using errcode='P0001', hint='role_forbidden';
      end if;
      if v_order.status not in ('served','ready') then
        raise exception 'Nu pot încasa din starea %', v_order.status using errcode='P0001', hint='bad_transition';
      end if;
      update public.orders
         set status='paid',
             paid_at=now(),
             paid_by=auth.uid(),
             payment_method=coalesce(p_payment_method::payment_method, payment_method),
             paid_amount=coalesce(p_paid_amount, paid_amount),
             tips_amount=coalesce(p_tips_amount, tips_amount)
       where id=p_order_id;

    when 'cancel' then
      if v_role not in ('owner','manager','waiter') then
        raise exception 'Rol % nu poate anula comenzi', v_role using errcode='P0001', hint='role_forbidden';
      end if;
      -- cancel permis din orice stare ne-terminală (terminalele sunt deja
      -- blocate mai sus)
      update public.orders
         set status='cancelled',
             cancelled_at=now(),
             cancel_reason=coalesce(p_cancel_reason, cancel_reason)
       where id=p_order_id;

    else
      raise exception 'Acțiune necunoscută: %', p_action;
  end case;
end;
$$;
