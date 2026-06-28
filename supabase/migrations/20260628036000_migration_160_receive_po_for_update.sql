-- mig 160 — receive_purchase_order: lock pe rand (anti dublu-receptie) (P1 round-5)
-- ─────────────────────────────────────────────────────────────────────
-- Auditul round-5 (stocks). receive_purchase_order (mig 026) citea PO-ul FARA `for update`,
-- verifica status='draft', apoi la final il marca 'received'. Doua apeluri concurente pe
-- acelasi PO (dublu-click / retrimitere) puteau trece AMBELE de verificarea draft inainte ca
-- vreunul sa scrie 'received' -> stocul si valoarea inventarului se dubleaza, iar
-- stock_movements primeste doua randuri de tip 'purchase' (audit dublat).
--
-- Fix: `for update` pe SELECT-ul PO-ului — al doilea apel asteapta lock-ul, apoi reciteste
-- status='received' si e respins corect. Recreare din corpul EFECTIV curent, VERBATIM, cu
-- singura adaugare a lock-ului. Semnatura, search_path, grants raman identice.
-- ─────────────────────────────────────────────────────────────────────

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
        when current_stock + v_item.quantity = 0 then 0
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
  if position('for update' in lower(v_src)) = 0 then
    raise exception 'mig 160: lock-ul `for update` lipsește din receive_purchase_order';
  end if;
  raise notice 'mig 160: receive_purchase_order for-update (anti dublu-receptie) OK';
end $$;

commit;
