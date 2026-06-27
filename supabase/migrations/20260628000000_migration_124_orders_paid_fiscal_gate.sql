-- mig 124 — Fix P0 (gate-leak fiscal): gate universal pe orders.status='paid' (ORD-PAID-1)
--
-- Auditul rundei 2 (orders_kds). Regula de aur (bani + bon fiscal = Plan 3) era
-- impusa DOAR in RPC-uri (advance_order mig 094:236 branch mark_paid; split_bill
-- mig 111:72). La nivel RLS/trigger gate-ul LIPSEA: mig 047 acorda
-- `grant ... update on orders to authenticated`, iar singura politica UPDATE
-- ramasa dupa mig 013 (P0-3) este "orders: admin all" = using/with check
-- is_admin(restaurant_id), care NU restrictioneaza coloanele si NU verifica planul.
--
-- => Un owner/manager pe Plan 2 (growth, fiscal_receipt=false) putea apela direct
-- PostgREST: `update orders set status='paid', paid_at=..., paid_amount=...` ocolind
-- complet RPC-ul si gate-ul fiscal. Cu un bridge_device configurat, triggerul
-- enqueue_fiscal_receipt (mig 030) genera chiar un bon fiscal real — fiscalizare pe
-- un plan care nu o are.
--
-- Fix (defense-in-depth, acopera ORICE cale de scriere): trigger BEFORE INSERT OR
-- UPDATE care, la tranzitia spre status='paid', impune enforce_feature_for_restaurant
-- (..., 'fiscal_receipt') + revalideaza semnul sumelor (oglinda advance_order mig 094).
-- Calea legitima (RPC pe Plan 3) trece neschimbata; orice alta cale spre 'paid' pe
-- non-Plan-3 e respinsa server-side.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

create or replace function public.enforce_paid_status_gate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Doar pe tranzitia efectiva spre 'paid' (INSERT direct cu paid, sau UPDATE
  -- din alta stare). Re-setarea 'paid'->'paid' nu re-declanseaza gate-ul.
  if new.status = 'paid'
     and (tg_op = 'INSERT' or old.status is distinct from 'paid') then

    -- Gate fiscal universal: bani + bon = Plan 3. Acopera PostgREST direct,
    -- RPC-uri si orice cod viitor. Pe Plan 3 trece; altfel ridica feature_disabled.
    perform public.enforce_feature_for_restaurant(new.restaurant_id, 'fiscal_receipt');

    -- Validare semn (oglinda advance_order mig 094) — sume negative corupteaza rapoartele.
    if coalesce(new.paid_amount, 0) < 0 then
      raise exception 'paid_amount nu poate fi negativ (primit: %)', new.paid_amount
        using errcode = 'P0001', hint = 'invalid_amount';
    end if;
    if coalesce(new.tips_amount, 0) < 0 then
      raise exception 'tips_amount nu poate fi negativ (primit: %)', new.tips_amount
        using errcode = 'P0001', hint = 'invalid_amount';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_paid_status_gate() from public;

drop trigger if exists trg_orders_paid_fiscal_gate on public.orders;
create trigger trg_orders_paid_fiscal_gate
  before insert or update on public.orders
  for each row
  execute function public.enforce_paid_status_gate();

comment on function public.enforce_paid_status_gate() is
  'mig 124: gate universal Plan 3 (fiscal_receipt) pe orice tranzitie orders.status->paid + validare semn sume. Inchide gate-leak-ul PostgREST direct.';

-- ── Asertiune inline (fail-closed in CI) ─────────────────────────────────────
do $$
declare v_def text;
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.orders'::regclass
       and tgname = 'trg_orders_paid_fiscal_gate'
       and not tgisinternal
  ) then
    raise exception 'mig 124: triggerul trg_orders_paid_fiscal_gate lipseste';
  end if;

  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'enforce_paid_status_gate' limit 1;
  if v_def is null or position('fiscal_receipt' in v_def) = 0 then
    raise exception 'mig 124: enforce_paid_status_gate nu impune fiscal_receipt';
  end if;

  raise notice 'mig 124: gate universal orders.status=paid (fiscal_receipt) OK';
end $$;

commit;
