-- migration_259_fiscal_enqueue_insert_parity.sql
-- =============================================================================
-- Paritate INSERT pe trigger-ul de enqueue fiscal (audit aug 2026, lanț 030→259).
--
-- ASIMETRIA: gate-ul fiscal trg_orders_paid_fiscal_gate (mig 124) acoperă
-- `before insert OR update` — un INSERT direct cu status='paid' e permis pe
-- Plan 3 (politica „orders: admin all"). Dar enqueue_fiscal_receipt_trg era
-- DOAR `after update of status` → comanda devenea 'paid' FĂRĂ să genereze bon
-- fiscal, tăcut. Bani înregistrați, bon lipsă — exact clasa de gaură pe care
-- regula de aur o interzice.
--
-- Fix: trigger-ul devine `after insert or update of status` (lista `of status`
-- se aplică doar ramurii UPDATE), iar guard-ul din funcție devine TG_OP-safe
-- (pe INSERT, OLD nu există — referirea lui ar fi aruncat la runtime).
-- Restul corpului (skip fără bridge, idempotență pe pending/sent/success,
-- catch-all pe build_fiscalnet_payload cu rând 'error') rămâne VERBATIM mig 030.
--
-- Nota INSERT-direct-cu-status-paid: itemii se inserează DUPĂ comanda-părinte,
-- deci payload-ul construit la INSERT nu-i poate include → build_fiscalnet_payload
-- pică → rândul intră cu status='error', VIZIBIL în BridgeTab pentru retry
-- manual (care regenerează payload-ul la zi prin bridge_retry_receipt).
-- Îmbunătățirea față de înainte: eșec VIZIBIL în loc de tăcere totală.
-- =============================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';

create or replace function public.enqueue_fiscal_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_bridge boolean;
  v_payload    text;
begin
  -- Doar intrarea în 'paid'. TG_OP-safe (mig 259): pe INSERT, OLD nu există.
  if new.status <> 'paid' then
    return new;
  end if;
  if TG_OP = 'UPDATE' and old.status = 'paid' then
    return new;  -- 'paid'→'paid', nu re-enqueue
  end if;

  -- Skip dacă restaurantul nu are bridge configurat (evităm queue orphan)
  -- Owner-ul va vedea în Dashboard alertă "configurare necesară" dacă vrea bridge
  select exists (
    select 1 from public.bridge_devices
    where restaurant_id = new.restaurant_id
  ) into v_has_bridge;

  if not v_has_bridge then
    return new;
  end if;

  -- Idempotency: dacă există deja pending/sent pentru order-ul ăsta, skip
  if exists (
    select 1 from public.pending_receipts
    where order_id = new.id
      and status in ('pending', 'sent', 'success')
  ) then
    return new;
  end if;

  -- Generăm payload-ul
  begin
    v_payload := public.build_fiscalnet_payload(new.id);
  exception when others then
    -- Nu blocăm marcarea ca plătit dacă payload-ul eșuează
    -- Log în pending_receipts cu status='error' ca să vadă owner-ul
    insert into public.pending_receipts (
      restaurant_id, order_id, payload, status, error_info, total_snapshot
    ) values (
      new.restaurant_id, new.id, '', 'error', SQLERRM, new.total
    );
    return new;
  end;

  -- INSERT în queue
  insert into public.pending_receipts (
    restaurant_id, order_id, payload, total_snapshot
  ) values (
    new.restaurant_id, new.id, v_payload, new.total
  );

  return new;
end;
$$;

drop trigger if exists enqueue_fiscal_receipt_trg on public.orders;
create trigger enqueue_fiscal_receipt_trg
  after insert or update of status on public.orders
  for each row execute function public.enqueue_fiscal_receipt();

-- ── Aserții fail-closed ──────────────────────────────────────────────────────
do $$
declare
  v_src text;
  v_tg  record;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enqueue_fiscal_receipt';
  if v_src is null then
    raise exception 'mig 259: enqueue_fiscal_receipt lipsește'; end if;
  if position('TG_OP' in v_src) = 0 then
    raise exception 'mig 259: guard-ul TG_OP lipsește (INSERT ar crăpa pe OLD)'; end if;
  if position('build_fiscalnet_payload' in v_src) = 0
     or position('bridge_devices' in v_src) = 0 then
    raise exception 'mig 259: corpul mig 030 a regresat (payload/skip-bridge)'; end if;

  select t.tgtype into v_tg
    from pg_trigger t
   where t.tgname = 'enqueue_fiscal_receipt_trg'
     and t.tgrelid = 'public.orders'::regclass;
  if not found then
    raise exception 'mig 259: trigger-ul enqueue_fiscal_receipt_trg lipsește de pe orders'; end if;
  -- tgtype: bit 2 (val 4) = INSERT, bit 4 (val 16) = UPDATE — cerem AMBELE.
  if (v_tg.tgtype & 4) = 0 or (v_tg.tgtype & 16) = 0 then
    raise exception 'mig 259: trigger-ul nu acoperă INSERT ȘI UPDATE (tgtype=%)', v_tg.tgtype; end if;
end $$;

commit;
