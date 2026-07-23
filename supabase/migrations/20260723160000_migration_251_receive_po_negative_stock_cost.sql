-- Migration 251 — receive_purchase_order: cost mediu robust pe stoc negativ
--
-- `receive_purchase_order` (mig 026→160) recalcula costul mediu ponderat (WAC) cu
-- formula `(current_stock*cost + qty*unit_price) / (current_stock + qty)`. Cât timp
-- `current_stock >= 0` e corect, dar mig 250 face stocul negativ un caz REAL și
-- frecvent (comenzile growth scad stocul sub 0 la supra-vânzare, alertele sunt
-- normale). Cu `current_stock < 0`:
--   • valoarea existentă `current_stock*cost` devine o ficțiune (negativă);
--   • dacă după recepție stocul rămâne negativ (numitor < 0) dar numărătorul e
--     pozitiv → WAC-ul iese NEGATIV → încalcă CHECK-ul `cost_per_unit >= 0`
--     (mig 026) → RPC-ul aruncă și RECEPȚIA ÎNTREAGĂ eșuează (NIR blocat).
--
-- Fix: WAC-ul se aplică DOAR când există bază pozitivă de stoc. Pe `current_stock <= 0`
-- (fără on-hand pozitiv de mediat) costul devine prețul de achiziție al livrării noi —
-- comportamentul standard de inventar; garantează `cost_per_unit >= 0`. Recreare
-- VERBATIM din corpul curent (mig 160, cu lock-ul `for update`), doar CASE-ul de cost
-- se schimbă. Semnătură/search_path/grants identice.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

create or replace function public.receive_purchase_order(p_po_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_po record;
  v_item record;
  v_user_id uuid := auth.uid();
begin
  -- Validează PO (lock pe rand pana la commit: serializeaza receptia, anti dublu-receptie)
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if v_po is null then
    raise exception 'Purchase order not found';
  end if;

  if not public.is_admin(v_po.restaurant_id) then
    raise exception 'Permission denied';
  end if;

  if v_po.status != 'draft' then
    raise exception 'PO already received or cancelled (status: %)', v_po.status;
  end if;

  -- Pentru fiecare item: crește stocul + recalculează cost mediu + log mișcare
  for v_item in
    select * from public.purchase_order_items where purchase_order_id = p_po_id
  loop
    update public.ingredients
    set
      current_stock = current_stock + v_item.quantity,
      cost_per_unit = case
        -- Nimic de recepționat (defensiv) → păstrează costul curent.
        when v_item.quantity <= 0 then cost_per_unit
        -- Fără bază pozitivă de stoc (stoc 0 sau negativ din supra-vânzare):
        -- WAC-ul n-are sens și ar putea deveni negativ → folosește prețul livrării.
        when current_stock <= 0 then v_item.unit_price
        -- Caz normal: medie ponderată (numitor garantat pozitiv aici).
        else (
          (current_stock * cost_per_unit + v_item.quantity * v_item.unit_price)
          / (current_stock + v_item.quantity)
        )
      end,
      updated_at = now()
    where id = v_item.ingredient_id;

    insert into public.stock_movements (
      ingredient_id, change_amount, reason, reference_type, reference_id,
      notes, created_by
    )
    values (
      v_item.ingredient_id, v_item.quantity, 'purchase', 'purchase_order', p_po_id,
      format('NIR %s', coalesce(v_po.invoice_number, p_po_id::text)),
      v_user_id
    );
  end loop;

  update public.purchase_orders
  set status = 'received', received_at = now()
  where id = p_po_id;

  return jsonb_build_object('success', true, 'po_id', p_po_id);
end;
$function$;

-- ── Asserție fail-closed ─────────────────────────────────────────────────────
do $$
declare v_src text;
begin
  select pg_get_functiondef('public.receive_purchase_order(uuid)'::regprocedure) into v_src;
  -- lock-ul anti dublu-recepție (mig 160) trebuie păstrat
  if position('for update' in lower(v_src)) = 0 then
    raise exception 'mig 251: lock-ul `for update` lipsește din receive_purchase_order';
  end if;
  -- guardul de stoc non-pozitiv trebuie prezent (altfel WAC negativ pe stoc negativ)
  if position('when current_stock <= 0 then' in v_src) = 0 then
    raise exception 'mig 251: guardul cost pe stoc non-pozitiv lipsește — WAC ar putea încălca cost_per_unit >= 0';
  end if;
  raise notice 'mig 251: receive_purchase_order cost robust pe stoc negativ OK';
end $$;

commit;
