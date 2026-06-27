-- mig 111 — Fix securitate P0: gate-leak fiscal pe add_partial_payment (Regula de aur)
--
-- Găsit la auditul platformei (zona advance_order). add_partial_payment (mig 017,
-- split bill) tranziționează comanda în status='paid' (stare FISCALĂ — bani
-- încasați) când sum(plăți) >= total, DAR:
--   • NU are gate de plan → un restaurant Plan 1/2 (free/starter/growth) putea
--     ajunge la 'paid' fără Plan 3, încălcând regula de aur „bani + bon = Plan 3".
--     mig 094 a închis exact acest leak pe advance_order『mark_paid』
--     (enforce_feature_for_restaurant ... 'fiscal_receipt'), dar a uitat calea
--     paralelă din split bill.
--   • NU verifică rolul → orice membru, inclusiv 'kitchen', putea înregistra plăți
--     și forța 'paid'. mig 076 a reparat asta pe mark_paid; split bill a rămas.
--
-- FIX: recreăm add_partial_payment cu (1) verificare de rol (owner/manager/waiter,
-- ca mark_paid) și (2) enforce_feature_for_restaurant(..., 'fiscal_receipt')
-- înainte de orice inserare de plată. Restul logicii rămâne identic.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

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
  if p_method not in ('cash', 'card_pos', 'other') then
    raise exception 'Metodă de plată invalidă.';
  end if;

  if p_amount <= 0 then
    raise exception 'Suma trebuie să fie pozitivă.';
  end if;

  select o.id, o.restaurant_id, o.total, o.status
  into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Comandă negăsită.';
  end if;

  if v_order.status != 'served' then
    raise exception 'Comanda trebuie să fie în status "servit" pentru plată.';
  end if;

  -- Autorizare: membru CU rol de încasare (NU kitchen) — aliniat cu mark_paid.
  if not exists (
    select 1 from public.restaurant_memberships
    where restaurant_id = v_order.restaurant_id
      and user_id = auth.uid()
      and role in ('owner', 'manager', 'waiter')
  ) then
    raise exception 'Nu ai dreptul să încasezi plăți pentru acest restaurant.'
      using hint = 'insufficient_role';
  end if;

  -- Regula de aur: încasarea de bani = bon fiscal = Plan 3. Gate pe feature.
  perform public.enforce_feature_for_restaurant(v_order.restaurant_id, 'fiscal_receipt');

  insert into public.order_payments (order_id, amount, method, paid_by)
  values (p_order_id, p_amount, p_method, auth.uid())
  returning id into v_payment_id;

  select coalesce(sum(amount), 0) into v_total_paid
  from public.order_payments
  where order_id = p_order_id;

  if v_total_paid >= v_order.total then
    update public.orders
    set status = 'paid',
        paid_at = now(),
        paid_by = auth.uid(),
        -- payment_method e enum public.payment_method — castăm explicit (originalul
        -- din mig 017 atribuia text → eroare la calea „fully paid", bug latent reparat aici).
        payment_method = case
          when (select count(distinct method) from public.order_payments where order_id = p_order_id) = 1
          then p_method::public.payment_method
          else 'other'::public.payment_method
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

-- Asserție: funcția conține acum gate-ul fiscal + filtrul de rol.
do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='add_partial_payment';
  if position('fiscal_receipt' in v_src) = 0 then
    raise exception 'mig 111: gate fiscal lipsește din add_partial_payment';
  end if;
  if position($q$role in ('owner', 'manager', 'waiter')$q$ in v_src) = 0 then
    raise exception 'mig 111: filtrul de rol lipsește din add_partial_payment';
  end if;
  raise notice 'mig 111: split bill gate fiscal + rol OK';
end $$;

commit;
