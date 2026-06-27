-- mig 142 — Fix P2 (gate de plan): modulul Gestiune (stocks) cere featurea 'stocks' (STOCKS-GATE-1)
--
-- Auditul rundei 3 (stocks_promotions). Modulul Gestiune (ingredients/recipes/suppliers/
-- purchase_orders) nu avea gate de plan server-side — accesibil de pe Plan 1 (free/starter,
-- unde 'stocks'=false in plan_features). RPC-urile (adjust_stock_manual/receive_purchase_order/
-- create_purchase_order_atomic) si scrierile directe PostgREST nu verificau planul.
--
-- Fix universal (acopera RPC + PostgREST direct, fara a recrea RPC-urile): trigger BEFORE
-- INSERT pe tabelele-radacina cu restaurant_id (ingredients, suppliers, purchase_orders)
-- care impune enforce_feature_for_restaurant(..., 'stocks'). Tabelele dependente
-- (stock_movements/recipe_items/purchase_order_items) atarna de ingredients/PO, deci
-- daca nu poti crea radacina pe Plan 1, nu exista nici dependentele.

begin;
set local lock_timeout = '10s';

create or replace function public.enforce_stocks_feature()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.enforce_feature_for_restaurant(new.restaurant_id, 'stocks');
  return new;
end;
$$;
revoke all on function public.enforce_stocks_feature() from public;

-- INSERT OR UPDATE: blocheaza si mutarea datelor de stoc existente dupa un downgrade
-- (nu doar crearea de noi radacini). Tabelele copil (stock_movements/recipe_items/
-- purchase_order_items) atarna de aceste radacini.
drop trigger if exists trg_stocks_gate_ingredients on public.ingredients;
create trigger trg_stocks_gate_ingredients
  before insert or update on public.ingredients for each row execute function public.enforce_stocks_feature();

drop trigger if exists trg_stocks_gate_suppliers on public.suppliers;
create trigger trg_stocks_gate_suppliers
  before insert or update on public.suppliers for each row execute function public.enforce_stocks_feature();

drop trigger if exists trg_stocks_gate_purchase_orders on public.purchase_orders;
create trigger trg_stocks_gate_purchase_orders
  before insert or update on public.purchase_orders for each row execute function public.enforce_stocks_feature();

do $$
declare n int;
begin
  select count(*) into n from pg_trigger
   where tgname in ('trg_stocks_gate_ingredients','trg_stocks_gate_suppliers','trg_stocks_gate_purchase_orders')
     and not tgisinternal;
  if n <> 3 then raise exception 'mig 142: lipsesc triggere stocks (gasite %)', n; end if;
  raise notice 'mig 142: modul Gestiune gate-uit pe featurea stocks OK';
end $$;
commit;
