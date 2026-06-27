-- mig 134 — Fix P1: order_items UPDATE direct interzis, editare doar prin RPC (OI-UPD-1)
--
-- Auditul rundei 3 (orders_flow). order_items avea grant UPDATE catre authenticated +
-- politici "order_items: waiter manager update" / "admin update delete", deci un
-- waiter/manager putea face PostgREST UPDATE direct pe order_items si manipula
-- quantity / unit_price_snapshot / item_total / product_id => total comanda corupt,
-- ocolind validarea server-authoritative.
--
-- Fix (oglinda deciziei mig 005 „creare doar prin create_order RPC", extinsa la editare):
-- REVOKE UPDATE pe order_items de la authenticated/anon. Editarea legitima trece deja
-- EXCLUSIV prin update_order_items (SECURITY DEFINER — confirmat secdef=true; ruleaza ca
-- owner, deci REVOKE-ul nu il afecteaza). Frontend-ul foloseste doar acest RPC
-- (EditOrderSheet → update_order_items, src/lib/orders.ts), deci zero regresie UI.
-- SELECT/INSERT/DELETE raman neatinse.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '60s';

revoke update on public.order_items from authenticated;
revoke update on public.order_items from anon;

do $$
begin
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'order_items'
       and grantee = 'authenticated' and privilege_type = 'UPDATE'
  ) then
    raise exception 'mig 134: authenticated inca are UPDATE pe order_items';
  end if;
  raise notice 'mig 134: UPDATE direct pe order_items revocat (editare doar prin update_order_items RPC) OK';
end $$;

commit;
