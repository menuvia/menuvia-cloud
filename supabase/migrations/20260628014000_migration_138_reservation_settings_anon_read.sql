-- mig 138 — Fix P3 (leak cross-tenant): reservation_settings citibil doar de anon + admin (RES-SET-1)
--
-- Auditul rundei 3 (reservations_tables). reservation_settings_public_read avea
-- `to anon, authenticated` => orice user autentificat citea setarile de rezervare ale
-- ORICARUI restaurant activ (inclusiv auto_confirm/reminder_hours_before). Widget-ul
-- public foloseste sesiunea anon (ReservationSheet), deci scoatem `authenticated` din
-- politica publica; membrii owner/manager pastreaza reservation_settings_admin.

begin;
set local lock_timeout = '10s';

drop policy if exists reservation_settings_public_read on public.reservation_settings;
create policy reservation_settings_public_read
  on public.reservation_settings for select to anon
  using (exists (
    select 1 from public.restaurants r
     where r.id = reservation_settings.restaurant_id and r.is_active = true
  ));

do $$
declare v_roles text;
begin
  select array_to_string(polroles::regrole[], ',') into v_roles
  from pg_policy where polname='reservation_settings_public_read'
   and polrelid='public.reservation_settings'::regclass;
  if v_roles is distinct from 'anon' then
    raise exception 'mig 138: reservation_settings_public_read are roluri % (asteptat anon)', v_roles;
  end if;
  raise notice 'mig 138: reservation_settings_public_read doar anon OK';
end $$;
commit;
