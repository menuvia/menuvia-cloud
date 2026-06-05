-- Migration 073: ospătarii văd și pot actualiza rezervările restaurantului
-- ─────────────────────────────────────────────────────────────────────
-- Bug feature: WaiterPage nu afișa rezervări → ospătarul nu știa cine
-- urmează. Cauza root: RLS policy reservations_admin (mig 057:144)
-- permite doar owner/manager. Ospătarul n-avea select.
--
-- Fix: policy separată pentru waiter — SELECT (vede ce vine), UPDATE
-- (poate marca seated, no_show, completed când oaspetele ajunge).
-- DELETE rămâne doar admin (siguranță).

drop policy if exists reservations_waiter_read on public.reservations;
create policy reservations_waiter_read on public.reservations
  for select to authenticated
  using (
    exists (
      select 1 from public.restaurant_memberships m
      where m.restaurant_id = reservations.restaurant_id
        and m.user_id = auth.uid()
        and m.role = 'waiter'
    )
  );

drop policy if exists reservations_waiter_update on public.reservations;
create policy reservations_waiter_update on public.reservations
  for update to authenticated
  using (
    exists (
      select 1 from public.restaurant_memberships m
      where m.restaurant_id = reservations.restaurant_id
        and m.user_id = auth.uid()
        and m.role = 'waiter'
    )
  )
  with check (
    exists (
      select 1 from public.restaurant_memberships m
      where m.restaurant_id = reservations.restaurant_id
        and m.user_id = auth.uid()
        and m.role = 'waiter'
    )
  );
