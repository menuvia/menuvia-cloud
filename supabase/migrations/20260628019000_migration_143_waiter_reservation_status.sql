-- mig 143 — Fix P3: restrange tranzitiile de status pe reservations pentru waiter (RES-WAITER-1)
--
-- Auditul rundei 3 (reservations_tables). Politica reservations_waiter_update (mig 073)
-- permitea unui waiter sa faca UPDATE pe orice rezervare a restaurantului, cu orice status
-- rezultat (inclusiv re-activarea unei rezervari cancelled, sau setari arbitrare). Restrangem
-- la tranzitiile operationale de sala: poate atinge doar rezervari pending/confirmed/seated
-- si le poate duce in seated/no_show/completed/confirmed (NU cancelled/pending arbitrar).
-- owner/manager pastreaza politicile lor (neatinse).

begin;
set local lock_timeout = '10s';

drop policy if exists reservations_waiter_update on public.reservations;
create policy reservations_waiter_update
  on public.reservations for update
  using (
    exists (select 1 from public.restaurant_memberships m
             where m.restaurant_id = reservations.restaurant_id
               and m.user_id = auth.uid() and m.role = 'waiter'::member_role)
    and status in ('pending','confirmed','seated')
  )
  with check (
    exists (select 1 from public.restaurant_memberships m
             where m.restaurant_id = reservations.restaurant_id
               and m.user_id = auth.uid() and m.role = 'waiter'::member_role)
    and status in ('seated','no_show','completed','confirmed')
  );

do $$ begin
  if not exists (select 1 from pg_policy where polname='reservations_waiter_update'
                  and polrelid='public.reservations'::regclass) then
    raise exception 'mig 143: politica lipseste'; end if;
  raise notice 'mig 143: waiter reservations restrans la tranzitii operationale OK';
end $$;
commit;
