-- mig 158 — gate fiscal Plan 3 pe facturi Oblio (P0 round-5)
-- ─────────────────────────────────────────────────────────────────────
-- Auditul round-5 (fiscal-ui-gateleak + fn-ai-misc). Facturarea Oblio (`invoices`) emite
-- DOCUMENTE FISCALE REALE (facturi legale via Oblio), feature explicit Plan 3 (Fiscalizare).
-- Dar întreaga suprafață era gate-uită DOAR pe is_admin, fără gate de plan:
--
--   P0a: `public.invoices` — INSERT (PostgREST direct + enqueue_invoice_for_order) verifica
--        doar is_admin → un owner/manager pe Plan 1/2 putea pune facturi în coadă, pe care
--        bridge-ul Oblio (oblio-generator.js) le emite ca facturi reale. (Calea legitimă
--        cere order.status='paid', deja gate-uit Plan 3 prin mig 124 — dar INSERT-ul direct
--        pe `invoices` ocolește asta.)
--   P0b: `cancel_invoice` (RPC) — anularea unui document fiscal emis, doar is_admin.
--   P2 (enabler): `oblio_configs` — configurarea Oblio, scriibilă direct (saveOblioConfig),
--        doar is_admin. Un admin sub-Plan-3 își putea configura facturarea.
--
-- Fix (oglindă mig 133 pe pending_receipts): triggere BEFORE INSERT/UPDATE care impun
-- enforce_feature_for_restaurant(..., 'fiscal_receipt') pe invoices (INSERT) + oblio_configs
-- (INSERT/UPDATE), și gate explicit în cancel_invoice (UPDATE, neacoperit de trigger INSERT).
-- Acoperă TOATE căile (RPC + PostgREST direct) dintr-un singur loc.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── 1. Gate fiscal pe coada de facturi ───────────────────────────────────────
create or replace function public.enforce_invoice_fiscal_gate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Orice factură nouă = document fiscal real spre Oblio → necesită Plan 3.
  perform public.enforce_feature_for_restaurant(new.restaurant_id, 'fiscal_receipt');
  return new;
end;
$$;
revoke all on function public.enforce_invoice_fiscal_gate() from public;

drop trigger if exists trg_invoices_fiscal_gate on public.invoices;
create trigger trg_invoices_fiscal_gate
  before insert on public.invoices
  for each row
  execute function public.enforce_invoice_fiscal_gate();

-- ── 2. Gate fiscal pe configurarea Oblio (enabler) ───────────────────────────
create or replace function public.enforce_oblio_config_fiscal_gate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.enforce_feature_for_restaurant(new.restaurant_id, 'fiscal_receipt');
  return new;
end;
$$;
revoke all on function public.enforce_oblio_config_fiscal_gate() from public;

drop trigger if exists trg_oblio_configs_fiscal_gate on public.oblio_configs;
create trigger trg_oblio_configs_fiscal_gate
  before insert or update on public.oblio_configs
  for each row
  execute function public.enforce_oblio_config_fiscal_gate();

-- ── 3. cancel_invoice: gate de plan după is_admin ────────────────────────────
-- Recreare din corpul EFECTIV curent (mig 041), VERBATIM, cu adăugarea gate-ului.
create or replace function public.cancel_invoice(p_invoice_id uuid, p_reason text default 'Anulată de utilizator')
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_status invoice_status;
begin
  select restaurant_id, status into v_restaurant_id, v_status
    from public.invoices where id = p_invoice_id;

  if not found then return false; end if;
  if not public.is_admin(v_restaurant_id) then
    raise exception 'Acces interzis';
  end if;

  -- mig 158 (P0): anularea unui document fiscal emis = operațiune fiscală → Plan 3.
  perform public.enforce_feature_for_restaurant(v_restaurant_id, 'fiscal_receipt');

  if v_status != 'issued' then
    raise exception 'Doar facturile emise pot fi anulate (status curent: %)', v_status;
  end if;

  update public.invoices
     set status = 'cancelled', cancelled_at = now(), last_error = p_reason
   where id = p_invoice_id;

  return true;
end;
$$;

revoke all on function public.cancel_invoice(uuid, text) from public;
grant execute on function public.cancel_invoice(uuid, text) to authenticated;

-- ── Asserții fail-closed ─────────────────────────────────────────────────────
do $$
declare v_src text;
begin
  if not exists (select 1 from pg_trigger where tgname='trg_invoices_fiscal_gate'
                  and tgrelid='public.invoices'::regclass and not tgisinternal) then
    raise exception 'mig 158: trg_invoices_fiscal_gate lipsește'; end if;
  if not exists (select 1 from pg_trigger where tgname='trg_oblio_configs_fiscal_gate'
                  and tgrelid='public.oblio_configs'::regclass and not tgisinternal) then
    raise exception 'mig 158: trg_oblio_configs_fiscal_gate lipsește'; end if;
  select pg_get_functiondef(p.oid) into v_src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='cancel_invoice';
  if position('fiscal_receipt' in v_src) = 0 then
    raise exception 'mig 158: cancel_invoice nu impune fiscal_receipt'; end if;
  raise notice 'mig 158: gate fiscal pe invoices + oblio_configs + cancel_invoice OK';
end $$;

commit;
