-- mig 165 — adjust_stock_manual: lock pe rând (audit trail corect la concurență) (P3 round-5)
-- ─────────────────────────────────────────────────────────────────────
-- Auditul round-5 (stocks). adjust_stock_manual citea ingredientul FĂRĂ `for update`, calcula
-- v_diff = p_new_amount - current_stock, apoi scria. Două ajustări concurente puteau citi același
-- current_stock → al doilea v_diff (change_amount logat în stock_movements) e greșit (audit trail
-- inexact). Stocul final e corect (ultimul write câștigă), dar mișcarea logată nu reflectă realul.
-- Fix: `for update` pe SELECT → v_diff calculat pe valoarea blocată. Recreare VERBATIM + lock.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout = '10s';

create or replace function public.adjust_stock_manual(p_ingredient_id uuid, p_new_amount numeric, p_notes text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ing record;
  v_diff numeric;
  v_user_id uuid := auth.uid();
begin
  -- Predicatul de autorizare e PARTE din SELECT-ul cu lock: un caller neautorizat care știe
  -- un ingredient_id nu mai poate lua lock-ul `for update` înainte de check (SECURITY DEFINER).
  select * into v_ing
    from public.ingredients
   where id = p_ingredient_id
     and public.is_admin(restaurant_id)
   for update;
  if v_ing is null then
    raise exception 'Ingredient not found or permission denied';
  end if;

  -- NULL nu e prins de `< 0` → v_diff ar deveni NULL și am scrie stoc NULL. Respins explicit.
  if p_new_amount is null or p_new_amount < 0 then
    raise exception 'Stock cannot be null or negative';
  end if;

  v_diff := p_new_amount - v_ing.current_stock;

  update public.ingredients
  set current_stock = p_new_amount, updated_at = now()
  where id = p_ingredient_id;

  insert into public.stock_movements (
    ingredient_id, change_amount, reason, reference_type,
    notes, created_by
  )
  values (
    p_ingredient_id, v_diff, 'inventory', 'manual',
    coalesce(p_notes, 'Ajustare manuală'), v_user_id
  );

  return jsonb_build_object('success', true, 'new_stock', p_new_amount);
end;
$function$;

do $$
begin
  if position('for update' in lower(pg_get_functiondef('public.adjust_stock_manual'::regproc))) = 0 then
    raise exception 'mig 165: lock-ul for update lipsește din adjust_stock_manual';
  end if;
  raise notice 'mig 165: adjust_stock_manual for-update (audit trail corect) OK';
end $$;

commit;
