-- Migration 250 — stoc: deduce la intrarea în ('paid','closed'), nu doar 'paid'
--
-- `deduct_stock_on_order_paid` (mig 026) scădea ingredientele DOAR la tranziția în
-- 'paid'. Dar modulul `stocks` e activ pe growth (Plan 2, mig 028), iar comenzile
-- growth NU ajung NICIODATĂ 'paid': `enforce_paid_status_gate` (mig 124) cere
-- `fiscal_receipt` (Plan 3), deci fluxul growth se termină în 'closed' (mig 085).
-- Rezultat: la fiecare restaurant growth cu rețete, stocul doar CREȘTE (NIR/ajustare
-- manuală) și nu scade niciodată la vânzare → current_stock derivă în sus, alertele
-- de stoc scăzut nu se declanșează, iar profitabilitatea/valoarea inventarului sunt
-- false. StocksTab promite literal „la fiecare comandă plătită, ingredientele scad
-- automat" — tăcut fals pe tot planul growth.
--
-- Fix (oglindă loyalty mig 226): deduce la INTRAREA în oricare stare terminală
-- ('paid' SAU 'closed'), o SINGURĂ dată. Anti dublă-scădere pe pro (new→paid→closed):
-- dacă OLD era deja terminală, skip. Trigger-ul rămâne `after update of status`
-- (mig 026) — acoperă ambele tranziții; doar corpul funcției se schimbă.

begin;

create or replace function public.deduct_stock_on_order_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_recipe record;
  v_consumption numeric;
begin
  -- Deduce la intrarea în starea terminală ('paid' pe pro, 'closed' pe growth),
  -- exact O DATĂ (anti dublă-scădere pe pro: paid→closed sare fiindcă OLD e terminală).
  if NEW.status not in ('paid', 'closed') then return NEW; end if;
  if OLD.status in ('paid', 'closed') then return NEW; end if;

  -- Pentru fiecare order_item, găsește rețeta și scade ingredientele
  for v_item in
    select oi.product_id, oi.quantity, oi.product_name_snapshot
    from public.order_items oi
    where oi.order_id = NEW.id
  loop
    for v_recipe in
      select r.ingredient_id, r.quantity as recipe_qty, i.current_stock, i.name as ing_name
      from public.recipes r
      join public.ingredients i on i.id = r.ingredient_id
      where r.product_id = v_item.product_id
    loop
      v_consumption := v_recipe.recipe_qty * v_item.quantity;

      -- Scade din stoc (poate deveni negativ — alertele se ocupă în UI)
      update public.ingredients
      set
        current_stock = current_stock - v_consumption,
        updated_at = now()
      where id = v_recipe.ingredient_id;

      -- Audit trail
      insert into public.stock_movements (
        ingredient_id, change_amount, reason, reference_type, reference_id,
        notes
      )
      values (
        v_recipe.ingredient_id, -v_consumption, 'sale', 'order', NEW.id,
        format('Vânzare %sx %s', v_item.quantity, v_item.product_name_snapshot)
      );
    end loop;
  end loop;

  return NEW;
end;
$$;

-- ── Asserție fail-closed: funcția deduce pe AMBELE stări terminale ────────────
do $$
declare
  v_src text;
begin
  select pg_get_functiondef('public.deduct_stock_on_order_paid()'::regprocedure) into v_src;
  if position('not in (''paid'', ''closed'')' in v_src) = 0 then
    raise exception 'mig 250: deduct_stock nu gate-uiește pe (paid,closed) — growth ar rămâne fără deducere';
  end if;
  if position('OLD.status in (''paid'', ''closed'')' in v_src) = 0 then
    raise exception 'mig 250: deduct_stock nu are guardul anti dublă-scădere pe OLD terminal';
  end if;
end $$;

commit;
