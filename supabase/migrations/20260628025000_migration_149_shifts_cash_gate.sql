-- mig 149 — gate Plan 3 pe Casă/Tură (#7) + revoke helperi cash (#8) + gate bridge_devices (#17)
-- ─────────────────────────────────────────────────────────────────────
-- Auditul round-4 (cash_shifts / fiscal_boundary). Trei probleme:
--
--   #7 (gate-leak): `cash_shifts`/`cash_movements` (mig 032) erau scriibile de orice
--      admin (RLS is_admin + grant authenticated), iar RPC-urile open_shift/
--      add_cash_movement NU verificau planul. Casa de marcat / sertarul de bani sunt
--      funcție de Plan 3 (`shifts` = pro/enterprise în plan_features). Un owner/manager
--      pe Plan 1/2 putea deschide ture și mișcări de cash (direct PostgREST sau via RPC).
--      Fix: trigger BEFORE INSERT pe cash_shifts + cash_movements → enforce 'shifts'.
--      Acoperă TOATE căile de INSERT dintr-un loc (RPC + PostgREST + cod viitor).
--      DECIZIE: gate-uim doar INSERT (deschiderea turei / mișcările). close_shift face
--      UPDATE pe cash_shifts → NEgate-uit intenționat: o tură deschisă înainte de
--      downgrade trebuie să poată fi ÎNCHISĂ (altfel rămâne blocată). Read-urile
--      (get_current_shift/get_shift_summary/list_recent_shifts) rămân is_member.
--
--   #8 (cross-tenant cash leak): `cash_collected_for_shift(uuid)` și `cash_expected(uuid)`
--      sunt helperi SECURITY DEFINER FĂRĂ verificare de tenant — primesc orice shift_id
--      și întorc cifrele de cash. Cu EXECUTE pentru authenticated (default PUBLIC), orice
--      user autentificat putea enumera shift_id-uri și citi cash-ul altui restaurant.
--      Fix: revoke de la public + authenticated. RPC-urile definer care îi folosesc
--      intern (get_shift_summary/close_shift) rulează ca owner → neafectate.
--
--   #17 (enabler fiscal): bridge_register (mig 133) impune deja fiscal_receipt, dar
--      `bridge_devices` rămânea INSERT-abil direct prin PostgREST de un admin. Oglindă
--      mig 133: trigger BEFORE INSERT pe bridge_devices → enforce 'fiscal_receipt'.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── 1. Gate 'shifts' (Plan 3) pe scrierile de cash ───────────────────────────
create or replace function public.enforce_shifts_plan_gate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Casa de bani / tura = funcție Plan 3. Acoperă open_shift, add_cash_movement
  -- și orice INSERT direct PostgREST. close_shift (UPDATE) rămâne permis.
  perform public.enforce_feature_for_restaurant(new.restaurant_id, 'shifts');
  return new;
end;
$$;
revoke all on function public.enforce_shifts_plan_gate() from public;

drop trigger if exists trg_cash_shifts_plan_gate on public.cash_shifts;
create trigger trg_cash_shifts_plan_gate
  before insert on public.cash_shifts
  for each row
  execute function public.enforce_shifts_plan_gate();

drop trigger if exists trg_cash_movements_plan_gate on public.cash_movements;
create trigger trg_cash_movements_plan_gate
  before insert on public.cash_movements
  for each row
  execute function public.enforce_shifts_plan_gate();

-- ── 2. #8: revoke helperi cash de la roluri aplicație (cross-tenant leak) ─────
revoke all on function public.cash_collected_for_shift(uuid) from public, authenticated;
revoke all on function public.cash_expected(uuid)            from public, authenticated;

-- ── 3. #17: gate fiscal pe înregistrarea directă a casei de marcat ───────────
create or replace function public.enforce_bridge_device_fiscal_gate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Înregistrarea unei case de marcat = fiscalizare → Plan 3. Oglindă bridge_register.
  perform public.enforce_feature_for_restaurant(new.restaurant_id, 'fiscal_receipt');
  return new;
end;
$$;
revoke all on function public.enforce_bridge_device_fiscal_gate() from public;

drop trigger if exists trg_bridge_devices_fiscal_gate on public.bridge_devices;
create trigger trg_bridge_devices_fiscal_gate
  before insert on public.bridge_devices
  for each row
  execute function public.enforce_bridge_device_fiscal_gate();

-- ── Asserții fail-closed ─────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_trigger where tgname='trg_cash_shifts_plan_gate'
                  and tgrelid='public.cash_shifts'::regclass and not tgisinternal) then
    raise exception 'mig 149: trg_cash_shifts_plan_gate lipsește'; end if;
  if not exists (select 1 from pg_trigger where tgname='trg_cash_movements_plan_gate'
                  and tgrelid='public.cash_movements'::regclass and not tgisinternal) then
    raise exception 'mig 149: trg_cash_movements_plan_gate lipsește'; end if;
  if not exists (select 1 from pg_trigger where tgname='trg_bridge_devices_fiscal_gate'
                  and tgrelid='public.bridge_devices'::regclass and not tgisinternal) then
    raise exception 'mig 149: trg_bridge_devices_fiscal_gate lipsește'; end if;

  if has_function_privilege('authenticated', 'public.cash_collected_for_shift(uuid)', 'EXECUTE') then
    raise exception 'mig 149: cash_collected_for_shift încă executabil de authenticated (#8)'; end if;
  if has_function_privilege('authenticated', 'public.cash_expected(uuid)', 'EXECUTE') then
    raise exception 'mig 149: cash_expected încă executabil de authenticated (#8)'; end if;

  raise notice 'mig 149: gate shifts (#7) + revoke cash helpers (#8) + bridge gate (#17) OK';
end $$;

commit;
