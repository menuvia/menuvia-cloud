-- mig 133 — Fix P0 (gate-leak fiscal): gate universal pe coada fiscala terminala (FISC-GATE-1)
--
-- Auditul rundei 3 (rls_rpc + fiscal_boundary). Mig 124 a inchis DOAR tranzitia
-- orders.status->paid (trigger enqueue_fiscal_receipt). Dar coada fiscala TERMINALA,
-- public.pending_receipts (mig 030) — randurile pe care bridge-ul local FiscalNet le
-- ridica si le tipareste ca BON FISCAL real — ramanea scriibila direct de orice admin,
-- fara gate de plan:
--   • RLS: doar "admin manage" using/with check is_admin(restaurant_id) (mig 030).
--   • grant select,insert,update,delete to authenticated (mig 030:678).
--   • zero triggere pe tabela.
-- => owner/manager pe Plan 1/2 (fiscal_receipt=false) putea, prin cai MULTIPLE:
--   - POST /rest/v1/pending_receipts direct (P0 #1/#5),
--   - add_cash_movement(p_send_to_fiscal=true) → I^/O^ sertar (P0 #2/#3),
--   - close_shift(p_send_z=true) → Raport Z (P0 #4),
--   sa insereze comenzi fiscale reale pe un plan fara drept de fiscalizare.
--
-- Fix (oglinda mig 124, dar pe tabela terminala — acopera TOATE caile de INSERT
-- dintr-un singur loc): trigger BEFORE INSERT pe pending_receipts care impune
-- enforce_feature_for_restaurant(..., 'fiscal_receipt'). Calea legitima (Plan 3,
-- enqueue_fiscal_receipt la order.paid) trece neschimbata. In plus gate de plan pe
-- bridge_register, ca un admin sub-Plan-3 sa nu-si poata inregistra casa (enabler, P1 #10).

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── 1. Gate terminal pe coada fiscala ────────────────────────────────────────
create or replace function public.enforce_pending_receipt_fiscal_gate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Orice rand nou in coada fiscala = comanda spre casa de marcat → necesita Plan 3.
  -- Acopera PostgREST direct, add_cash_movement, close_shift si orice cod viitor.
  perform public.enforce_feature_for_restaurant(new.restaurant_id, 'fiscal_receipt');
  return new;
end;
$$;

revoke all on function public.enforce_pending_receipt_fiscal_gate() from public;

drop trigger if exists trg_pending_receipts_fiscal_gate on public.pending_receipts;
create trigger trg_pending_receipts_fiscal_gate
  before insert on public.pending_receipts
  for each row
  execute function public.enforce_pending_receipt_fiscal_gate();

comment on function public.enforce_pending_receipt_fiscal_gate() is
  'mig 133: gate universal Plan 3 (fiscal_receipt) pe coada fiscala terminala pending_receipts. Inchide gate-leak-urile pe pending_receipts/add_cash_movement/close_shift.';

-- ── 2. Gate de plan pe inregistrarea casei de marcat (enabler, P1 #10) ────────
create or replace function public.bridge_register(p_restaurant_id uuid, p_name text, p_fiscalnet_brand text default null::text, p_fiscalnet_model text default null::text)
returns table(device_id uuid, device_secret text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_secret text;
  v_id     uuid;
begin
  if not public.is_admin(p_restaurant_id) then
    raise exception 'Only owners/managers can register bridge devices';
  end if;

  -- mig 133: inregistrarea casei de marcat e fiscalizare → necesita Plan 3.
  perform public.enforce_feature_for_restaurant(p_restaurant_id, 'fiscal_receipt');

  v_secret := replace(gen_random_uuid()::text, '-', '') ||
              replace(gen_random_uuid()::text, '-', '');

  insert into public.bridge_devices (
    restaurant_id, name, device_secret, fiscalnet_brand, fiscalnet_model
  ) values (
    p_restaurant_id, p_name, v_secret, p_fiscalnet_brand, p_fiscalnet_model
  )
  returning id into v_id;

  return query select v_id, v_secret;
end;
$function$;

-- ── Asertiune inline (fail-closed in CI) ─────────────────────────────────────
do $$
declare v_def text;
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'trg_pending_receipts_fiscal_gate'
       and tgrelid = 'public.pending_receipts'::regclass
       and not tgisinternal
  ) then
    raise exception 'mig 133: triggerul trg_pending_receipts_fiscal_gate lipseste';
  end if;

  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='bridge_register' limit 1;
  if v_def is null or position('fiscal_receipt' in v_def) = 0 then
    raise exception 'mig 133: bridge_register nu impune fiscal_receipt';
  end if;

  raise notice 'mig 133: gate fiscal pe pending_receipts + bridge_register OK';
end $$;

commit;
