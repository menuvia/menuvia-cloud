-- mig 113 — Fix P1 multi-tenant: comanda nu trebuie să refere masa altui restaurant
--
-- Găsit la audit (ORD-1). Rewrite-ul create_order (mig 084/088) a pierdut guard-ul
-- din mig 046 care verifica `table_id ∈ tables(restaurant_id)` pe branch-ul waiter.
-- FK-ul orders.table_id → tables(id) NU e scopat pe restaurant, deci un waiter putea
-- crea (via PostgREST direct, RPC SECURITY DEFINER) o comandă în PROPRIUL restaurant
-- dar legată de masa altui restaurant → coruperea integrității + scurgere slabă a
-- numelui mesei străine în KDS/UI.
--
-- FIX (mai robust decât reintroducerea în branch-ul waiter): un trigger BEFORE
-- INSERT pe orders care impune apartenența mesei la restaurant pentru TOATE căile
-- (qr/waiter/pickup + orice insert direct). Comenzile fără masă (table_id null)
-- sunt permise (pickup/legacy). Comenzile legitime au mereu masa în propriul
-- restaurant, deci nu rupe niciun flux.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

create or replace function public.enforce_order_table_tenant()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if NEW.table_id is not null and not exists (
    select 1 from public.tables t
     where t.id = NEW.table_id and t.restaurant_id = NEW.restaurant_id
  ) then
    raise exception 'Masa nu aparține acestui restaurant.'
      using errcode = 'P0001', hint = 'table_wrong_restaurant';
  end if;
  return NEW;
end $$;

drop trigger if exists trg_enforce_order_table_tenant on public.orders;
create trigger trg_enforce_order_table_tenant
  before insert on public.orders
  for each row execute function public.enforce_order_table_tenant();

do $$ begin
  if not exists (select 1 from pg_trigger where tgname='trg_enforce_order_table_tenant'
     and tgrelid='public.orders'::regclass) then
    raise exception 'mig 113: trigger tenant pe orders lipsește';
  end if;
  raise notice 'mig 113: order↔table tenant guard OK';
end $$;

commit;
