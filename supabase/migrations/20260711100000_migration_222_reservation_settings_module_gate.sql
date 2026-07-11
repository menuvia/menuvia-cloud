-- ═══════════════════════════════════════════════════════════════════
-- Migration 222: reservation_settings — citirea anon gate-uită pe modulul 'reservations'
-- ─────────────────────────────────────────────────────────────────────
-- Consistență (audit rezervări, LOW): mig 200 a gate-uit RPC-urile publice de
-- rezervare (`get_public_floor_plan`, `get_tables_availability`) pe
-- `is_module_enabled('reservations')`, iar `create_reservation_public` respinge
-- rezervările cu modulul OFF — dar politica `reservation_settings_public_read`
-- (mig 138) lăsa anon să citească setările de rezervare (auto_confirm,
-- reminder_hours_before, program) pentru ORICE restaurant activ, inclusiv cele cu
-- modulul dezactivat (default OFF). Nu e „bani+bon", dar suprafața era inconsecventă.
--
-- Fix: adaug gate-ul de modul în USING. Sigur pentru UI: meniul public decide
-- afișarea butonului de rezervare din `restaurant_modules` (SELECT public) /
-- amenity legacy — NU din reușita citirii `reservation_settings`; iar pentru
-- restaurantele cu modulul OFF fluxul era deja fund de sac server-side (mig 200/201).
-- `is_module_enabled` e SECURITY DEFINER, STABLE, grant anon (mig 086).
-- Membrii owner/manager păstrează `reservation_settings_admin` (mig 057), neatins.
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

drop policy if exists reservation_settings_public_read on public.reservation_settings;
create policy reservation_settings_public_read
  on public.reservation_settings for select to anon
  using (
    exists (
      select 1 from public.restaurants r
       where r.id = reservation_settings.restaurant_id and r.is_active = true
    )
    and public.is_module_enabled(reservation_settings.restaurant_id, 'reservations')
  );

-- ── Asserție fail-closed: rolul rămâne DOAR anon + gate-ul de modul e în policy ──
do $$
declare
  v_roles text;
  v_qual  text;
begin
  select array_to_string(polroles::regrole[], ','), pg_get_expr(polqual, polrelid)
    into v_roles, v_qual
  from pg_policy
  where polname = 'reservation_settings_public_read'
    and polrelid = 'public.reservation_settings'::regclass;

  if v_roles is distinct from 'anon' then
    raise exception 'ASSERT FAIL (mig 222): reservation_settings_public_read are roluri % (așteptat anon)', v_roles;
  end if;
  if position('is_module_enabled' in coalesce(v_qual, '')) = 0 then
    raise exception 'ASSERT FAIL (mig 222): politica nu conține gate-ul is_module_enabled';
  end if;
end $$;

commit;
