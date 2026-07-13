-- ═══════════════════════════════════════════════════════════════
-- shifts/cash gate — asserțiuni pentru mig 149 (#7 / #8 / #17)
-- ═══════════════════════════════════════════════════════════════
--   CS1 — owner growth (Plan 2): open_shift respins (feature 'shifts');
--   CS2 — owner pro (Plan 3): open_shift reușește;
--   CS3 — owner pro: add_cash_movement reușește;
--   CS4 — după downgrade pro→growth: close_shift(send_z=false) reușește (UPDATE negate-uit);
--   CS5 — cash_collected_for_shift NU e executabil de authenticated (#8);
--   CS6 — owner growth: INSERT direct bridge_devices respins (fiscal_receipt, #17).
-- ═══════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

begin;

do $$
declare
  v_pro    uuid := '51111111-2222-3333-4444-555555555501'::uuid;
  v_grw    uuid := '51111111-2222-3333-4444-555555555502'::uuid;
  v_rp     uuid := '51111111-2222-3333-4444-5555555555a1'::uuid;  -- restaurant pro
  v_rg     uuid := '51111111-2222-3333-4444-5555555555a2'::uuid;  -- restaurant growth
  v_shift  uuid;
  v_blocked boolean;
begin
  insert into auth.users (id, email) values (v_pro, 'shift-pro@menuvia.ro');
  insert into auth.users (id, email) values (v_grw, 'shift-grw@menuvia.ro');
  update public.profiles set plan = 'pro'    where id = v_pro;
  update public.profiles set plan = 'growth' where id = v_grw;

  insert into public.restaurants (id, owner_id, name, slug, city, is_active)
    values (v_rp, v_pro, 'Shift Pro R', 'shift-pro-slug', 'Cluj', true);
  insert into public.restaurants (id, owner_id, name, slug, city, is_active)
    values (v_rg, v_grw, 'Shift Grw R', 'shift-grw-slug', 'Cluj', true);

  -- ─── CS1: growth → open_shift respins ──────────────────────────
  perform set_config('request.jwt.claim.sub', v_grw::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  v_blocked := false;
  begin
    perform public.open_shift(v_rg, 100.00, null);
  exception when others then
    if position('shifts' in lower(sqlerrm)) = 0 then
      raise exception 'CS1 FAIL: open_shift a eșuat din alt motiv decât gate-ul shifts: %', sqlerrm;
    end if;
    v_blocked := true;
    raise notice 'CS1 PASS: growth open_shift respins de gate-ul shifts: %', sqlerrm;
  end;
  if not v_blocked then raise exception 'CS1 FAIL: growth a putut deschide tură (gate shifts lipsește)'; end if;

  -- ─── CS2: pro → open_shift reușește ────────────────────────────
  perform set_config('request.jwt.claim.sub', v_pro::text, true);
  v_shift := public.open_shift(v_rp, 100.00, 'tura 1');
  if v_shift is null then raise exception 'CS2 FAIL: pro nu a putut deschide tură'; end if;
  raise notice 'CS2 PASS: pro open_shift reușește (shift=%)', v_shift;

  -- ─── CS3: pro → add_cash_movement reușește ─────────────────────
  perform public.add_cash_movement(v_rp, 20.00, 'deposit', 'fond marunt', false);
  raise notice 'CS3 PASS: pro add_cash_movement reușește';

  -- ─── CS4: downgrade pro→growth, close_shift(send_z=false) reușește ──
  update public.profiles set plan = 'growth' where id = v_pro;
  perform public.close_shift(v_shift, 120.00, 'inchidere dupa downgrade', false);
  if exists (select 1 from public.cash_shifts where id = v_shift and status = 'open') then
    raise exception 'CS4 FAIL: tura nu a fost închisă';
  end if;
  raise notice 'CS4 PASS: close_shift(send_z=false) permis după downgrade (UPDATE negate-uit)';

  -- ─── CS5: helperii cash NU executabili de authenticated (#8) ────
  if has_function_privilege('authenticated', 'public.cash_collected_for_shift(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cash_expected(uuid)', 'EXECUTE') then
    raise exception 'CS5 FAIL: helperii cash încă executabili de authenticated';
  end if;
  raise notice 'CS5 PASS: cash_collected_for_shift/cash_expected revocate de la authenticated (#8)';

  -- ─── CS6: bridge_devices pe growth — contract SCHIMBAT de mig 227 ──
  -- Până la 227, INSERT-ul pe growth era respins (device = doar casă fiscală,
  -- Plan 3). De la 227, device-ul poate servi și imprimanta de bucătărie
  -- (feature kitchen_tickets, growth+) → INSERT-ul pe growth TRECE. Lanțul
  -- FISCAL rămâne închis (gate-urile pe pending_receipts/'paid' neatinse);
  -- respingerea sub growth e acoperită de kitchen_ticket_assertions (KT8).
  perform set_config('request.jwt.claim.sub', v_grw::text, true);
  begin
    insert into public.bridge_devices (restaurant_id, name, device_secret)
      values (v_rg, 'Casa 1', 'secret-xyz');
    raise notice 'CS6 PASS: bridge_devices pe growth acceptat (gate dublu mig 227)';
  exception when others then
    raise exception 'CS6 FAIL: bridge_devices pe growth respins după mig 227: %', sqlerrm;
  end;
  v_blocked := false; -- variabila rămâne folosită (fără warning de unused)

  raise notice 'ALL PASS';
end$$;

rollback;
