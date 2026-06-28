-- ═══════════════════════════════════════════════════════════════
-- create_reservation_public — plafon durată (mig 151, #12)
-- ═══════════════════════════════════════════════════════════════
--   RD1 — p_duration_minutes uriaș (100000) → ends_at clamp la reservation_duration (90 min);
--   RD2 — p_duration_minutes null → folosește reservation_duration (90 min).
-- ═══════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

begin;

do $$
declare
  v_owner uuid := '71111111-2222-3333-4444-555555555501'::uuid;
  v_rest  uuid := '71111111-2222-3333-4444-5555555555a1'::uuid;
  v_start timestamptz := date_trunc('day', now()) + interval '2 days 12 hours';
  v_row   record;
  v_mins  numeric;
begin
  insert into auth.users (id, email) values (v_owner, 'resv-dur@menuvia.ro');
  update public.profiles set plan = 'growth' where id = v_owner;
  insert into public.restaurants (id, owner_id, name, slug, city, is_active)
    values (v_rest, v_owner, 'Resv Dur R', 'resv-dur-slug', 'Cluj', true);
  insert into public.tables (id, restaurant_id, name, slug, is_active, seats)
    values (gen_random_uuid(), v_rest, 'Masa 1', 'rd-masa-1', true, 4);
  insert into public.restaurant_modules (restaurant_id, module_key, enabled)
    values (v_rest, 'reservations', true)
    on conflict (restaurant_id, module_key) do update set enabled = true;
  -- reservation_settings e auto-creat de trigger la insert restaurant → UPDATE permisiv.
  update public.reservation_settings set
    open_days = '{1,2,3,4,5,6,7}', open_time = '00:00', close_time = '23:59',
    reservation_duration = 90, min_advance_hours = 0, max_advance_days = 365,
    max_party_size = 20, auto_confirm = true
   where restaurant_id = v_rest;

  perform set_config('request.jwt.claim.role', 'anon', true);

  -- ─── RD1: durată uriașă → clamp la 90 min ──────────────────────
  select * into v_row from public.create_reservation_public(
    'resv-dur-slug', 'Ion Test', '0712345678', 2::smallint, v_start,
    null, null, 30000::smallint, null
  );
  v_mins := extract(epoch from (v_row.ends_at - v_row.starts_at)) / 60;
  if v_mins is distinct from 90 then
    raise exception 'RD1 FAIL: durata ar trebui plafonată la 90 min, e: % min', v_mins;
  end if;
  raise notice 'RD1 PASS: durată uriașă plafonată la 90 min (#12)';

  -- ─── RD2: durată null → default 90 ─────────────────────────────
  select * into v_row from public.create_reservation_public(
    'resv-dur-slug', 'Ana Test', '0712345679', 2::smallint, v_start + interval '3 hours',
    null, null, null, null
  );
  v_mins := extract(epoch from (v_row.ends_at - v_row.starts_at)) / 60;
  if v_mins is distinct from 90 then
    raise exception 'RD2 FAIL: durata default ar trebui 90 min, e: % min', v_mins;
  end if;
  raise notice 'RD2 PASS: durată null → default 90 min';

  raise notice 'ALL PASS';
end$$;

rollback;
