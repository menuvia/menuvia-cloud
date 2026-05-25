-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 045 — BRIDGE CONTRACT: validate + overload + fixes
-- ═══════════════════════════════════════════════════════════════
-- Conține 4 lucruri:
--   1. bridge_validate_device — NOU, apelat de bridge Rust la pornire
--   2. bridge_get_pending OVERLOAD cu p_limit (păstrează cea cu 1 param)
--   3. bridge_confirm_receipt rescrisă: idempotent + status guard + 
--      validare input strictă (success necesită bon_number)
--   4. FIX bridge_force_resolve_stuck: 'completed' → 'success' +
--      completed_at populat pe ambele ramuri
--
-- Compatibil cu schema existentă din migration-030 și migration-038:
--   - bridge_devices.status: CHECK ('online','offline','error')
--   - pending_receipts.status: CHECK ('pending','sent','success','error','cancelled')
--   - pending_receipts: retry_count smallint, completed_at timestamptz, bon_number text
-- ═══════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────
-- 1) bridge_validate_device — NOU
-- ───────────────────────────────────────────────────────────────
create or replace function public.bridge_validate_device(
  p_device_secret text
)
returns table (
  device_id       uuid,
  restaurant_id   uuid,
  restaurant_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device record;
begin
  if p_device_secret is null or length(p_device_secret) < 16 then
    raise exception 'Device secret invalid';
  end if;

  select bd.id, bd.restaurant_id, r.name as rest_name
    into v_device
    from public.bridge_devices bd
    join public.restaurants r on r.id = bd.restaurant_id
   where bd.device_secret = p_device_secret
   limit 1;

  if not found then
    raise exception 'Device secret necunoscut';
  end if;

  update public.bridge_devices
     set status       = 'online',
         last_seen_at = now(),
         last_error   = null
   where id = v_device.id;

  return query
  select v_device.id, v_device.restaurant_id, v_device.rest_name;
end;
$$;

revoke all on function public.bridge_validate_device(text) from public;
grant execute on function public.bridge_validate_device(text) to anon, authenticated;

comment on function public.bridge_validate_device is
  'Bridge Rust apelează la pornire pentru a valida device_secret și a primi restaurant_name.';


-- ───────────────────────────────────────────────────────────────
-- 2) bridge_get_pending OVERLOAD cu p_limit
-- ───────────────────────────────────────────────────────────────
-- Cea existentă cu 1 param rămâne pentru backward compat.
-- Adaugă variantă cu p_limit (1-20).

create or replace function public.bridge_get_pending(
  p_device_secret text,
  p_limit         integer
)
returns table (
  id            uuid,
  order_id      uuid,
  payload       text,
  retry_count   smallint,
  created_at    timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_limit         integer;
begin
  select restaurant_id into v_restaurant_id
    from public.bridge_devices
   where device_secret = p_device_secret;

  if not found then
    raise exception 'Invalid device secret';
  end if;

  update public.bridge_devices
     set last_seen_at = now(),
         status       = 'online'
   where device_secret = p_device_secret;

  v_limit := greatest(1, least(coalesce(p_limit, 5), 20));

  return query
    select pr.id, pr.order_id, pr.payload, pr.retry_count, pr.created_at
      from public.pending_receipts pr
     where pr.restaurant_id = v_restaurant_id
       and pr.status = 'pending'
     order by pr.created_at
     limit v_limit;
end;
$$;

revoke all on function public.bridge_get_pending(text, integer) from public;
grant execute on function public.bridge_get_pending(text, integer) to anon, authenticated;

comment on function public.bridge_get_pending(text, integer) is
  'Overload cu p_limit. Bridge poate cere între 1-20 bonuri (default 5 dacă null).';


-- ───────────────────────────────────────────────────────────────
-- 3) bridge_confirm_receipt — strict + idempotent + input validation
-- ───────────────────────────────────────────────────────────────
create or replace function public.bridge_confirm_receipt(
  p_device_secret text,
  p_receipt_id    uuid,
  p_success       boolean,
  p_bon_number    text default null,
  p_error_code    text default null,
  p_error_info    text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device_id        uuid;
  v_restaurant_id    uuid;
  v_current_status   text;
  v_current_bon      text;
  v_claimed_device   uuid;
  v_updated          int;
begin
  -- Validare device — luăm și ID-ul, nu doar restaurant_id
  select id, restaurant_id
    into v_device_id, v_restaurant_id
    from public.bridge_devices
   where device_secret = p_device_secret;

  if not found then
    raise exception 'Invalid device secret'
      using errcode = 'P0001', hint = 'invalid_device_secret';
  end if;

  -- ─── INPUT VALIDATION ───
  if p_success is null then
    raise exception 'p_success este obligatoriu'
      using errcode = 'P0001', hint = 'missing_success_flag';
  end if;

  if p_success = true
     and nullif(trim(coalesce(p_bon_number, '')), '') is null
  then
    raise exception 'bon_number este obligatoriu pentru confirmare success'
      using errcode = 'P0001', hint = 'missing_fiscal_number';
  end if;

  -- Stare curentă receipt — luăm și bridge_device_id pentru hardening
  select status, bon_number, bridge_device_id
    into v_current_status, v_current_bon, v_claimed_device
    from public.pending_receipts
   where id = p_receipt_id
     and restaurant_id = v_restaurant_id;

  if not found then
    return false;
  end if;

  -- ─── HARDENING: doar bridge-ul care a făcut claim poate confirma ───
  -- Scenariu: 1 restaurant cu 2 bridge-uri. Bridge A claim-uiește bonul,
  -- bridge B trimite confirm. Refuzăm explicit pentru trasabilitate fiscală.
  if v_claimed_device is not null and v_claimed_device <> v_device_id then
    raise exception 'Receipt claimed by another bridge device (claimed by %, confirm from %)',
      v_claimed_device, v_device_id
      using errcode = 'P0001', hint = 'wrong_bridge_device';
  end if;

  -- ─── IDEMPOTENCY: success retransmis cu același bon de ACELAȘI device ───
  -- Funcționează doar dacă e același device care a făcut claim (verificat mai sus).
  if v_current_status = 'success'
     and p_success = true
     and v_current_bon is not null
     and v_current_bon = p_bon_number
  then
    return true;
  end if;

  -- ─── ANOMALIE: success cu BON DIFERIT față de cel existent ───
  if v_current_status = 'success'
     and v_current_bon is not null
     and p_success = true
     and p_bon_number is not null
     and v_current_bon != p_bon_number
  then
    raise exception 'Bonul are deja număr fiscal % alocat. Refuz suprascriere cu %.',
      v_current_bon, p_bon_number
      using errcode = 'P0001', hint = 'fiscal_number_already_assigned';
  end if;

  -- ─── IDEMPOTENCY: error retransmis ───
  if v_current_status = 'error'
     and p_success = false
     and p_error_code is not null
  then
    update public.pending_receipts
       set completed_at = now()
     where id = p_receipt_id
       and restaurant_id = v_restaurant_id;
    return true;
  end if;

  -- ─── STATUS GUARD: doar 'sent' permite confirmare normală ───
  if v_current_status != 'sent' then
    raise exception 'Cannot confirm receipt in status %. Expected: sent.', v_current_status
      using errcode = 'P0001', hint = 'invalid_state_for_confirm';
  end if;

  -- ─── HARDENING: pentru confirmare normală din 'sent', bridge_device_id ───
  -- ─── trebuie să fie set (claim a fost făcut). Dacă e null, e bug în sistem ───
  if v_claimed_device is null then
    raise exception 'Receipt was not claimed by this bridge before confirm'
      using errcode = 'P0001', hint = 'confirm_without_claim';
  end if;

  -- ─── Update normal ───
  update public.pending_receipts
     set status       = case when p_success then 'success' else 'error' end,
         bon_number   = case when p_success then p_bon_number else bon_number end,
         error_code   = case when p_success then null else p_error_code end,
         error_info   = case when p_success then null else p_error_info end,
         completed_at = now(),
         retry_count  = case when p_success then retry_count else retry_count + 1 end
   where id            = p_receipt_id
     and restaurant_id = v_restaurant_id;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.bridge_confirm_receipt(text, uuid, boolean, text, text, text) from public;
grant execute on function public.bridge_confirm_receipt(text, uuid, boolean, text, text, text) to anon, authenticated;

comment on function public.bridge_confirm_receipt is
  'Confirmare strictă cu hardening: doar bridge_device_id care a făcut claim poate confirma. Idempotent. success necesită bon_number.';


-- ───────────────────────────────────────────────────────────────
-- 4) FIX bridge_force_resolve_stuck — completed → success + completed_at
-- ───────────────────────────────────────────────────────────────
create or replace function public.bridge_force_resolve_stuck(
  p_receipt_id  uuid,
  p_was_printed boolean,
  p_bon_number  text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_status        text;
  v_existing_bon  text;
  v_updated       int;
begin
  select restaurant_id, status, bon_number
    into v_restaurant_id, v_status, v_existing_bon
    from public.pending_receipts
   where id = p_receipt_id;

  if not found then return false; end if;

  if not public.is_admin(v_restaurant_id) then
    raise exception 'Only owners/managers can force-resolve receipts';
  end if;

  if v_status != 'sent' then
    raise exception 'Doar bonuri stuck pot fi rezolvate. Status curent: %', v_status;
  end if;

  if v_existing_bon is not null then
    raise exception 'Bonul are deja număr fiscal: %. Nu poate fi resolvat din nou.', v_existing_bon;
  end if;

  if p_was_printed then
    if p_bon_number is null or nullif(trim(p_bon_number), '') is null then
      raise exception 'Dacă bonul a fost tipărit, numărul fiscal este obligatoriu.';
    end if;
    -- FIX: 'completed' → 'success' (status valid în enum)
    update public.pending_receipts
       set status       = 'success',
           bon_number   = p_bon_number,
           completed_at = now(),
           error_info   = 'Force-resolved by admin: bon physically verified as printed'
     where id = p_receipt_id;
  else
    -- FIX: adaugă completed_at = now() pe ramura de eroare
    update public.pending_receipts
       set status       = 'error',
           error_code   = 'FORCE_FAILED',
           error_info   = 'Force-resolved by admin: bon NOT printed, marked as error',
           completed_at = now()
     where id = p_receipt_id;
  end if;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.bridge_force_resolve_stuck(uuid, boolean, text) from public;
grant execute on function public.bridge_force_resolve_stuck(uuid, boolean, text) to authenticated;

comment on function public.bridge_force_resolve_stuck is
  'FIX 045: status=success (nu completed) + completed_at pe ambele ramuri.';
