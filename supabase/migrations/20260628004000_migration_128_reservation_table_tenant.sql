-- mig 128 — Fix P2 (izolare tenant): reservations.table_id trebuie sa apartina
-- aceluiasi restaurant (RES-TENANT-1)
--
-- Auditul rundei 2 (reservations_tables). reservations.table_id e FK spre tables(id)
-- (mig 057) dar NIMIC nu impune ca masa sa apartina aceluiasi restaurant ca rezervarea.
-- La assignTable/seat (src/hooks/useReservations.ts) un waiter/admin putea seta un
-- table_id dintr-un ALT restaurant => leak de izolare tenant (asociere cross-tenant).
-- Oglinda mig 113 (acelasi guard pentru orders.table_id).
--
-- Fix: trigger BEFORE INSERT OR UPDATE care, daca table_id not null, verifica apartenenta.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '60s';

create or replace function public.enforce_reservation_table_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.table_id is not null then
    if not exists (
      select 1 from public.tables t
       where t.id = new.table_id
         and t.restaurant_id = new.restaurant_id
    ) then
      raise exception 'Masa % nu apartine restaurantului % (izolare tenant)', new.table_id, new.restaurant_id
        using errcode = 'P0001', hint = 'table_wrong_restaurant';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_reservation_table_tenant() from public;

drop trigger if exists trg_reservation_table_tenant on public.reservations;
create trigger trg_reservation_table_tenant
  before insert or update on public.reservations
  for each row
  execute function public.enforce_reservation_table_tenant();

do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'trg_reservation_table_tenant'
       and tgrelid = 'public.reservations'::regclass
       and not tgisinternal
  ) then
    raise exception 'mig 128: triggerul trg_reservation_table_tenant lipseste';
  end if;
  raise notice 'mig 128: reservations.table_id tenant guard OK';
end $$;

commit;
