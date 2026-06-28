-- mig 126 — Fix P1: inchidere bypass limita produse prin INSERT multi-row (PROD-LIM-1)
--
-- Auditul rundei 2 (onboarding_settings). Acelasi bug ca CFG-2 (mig 114, mese), dar
-- nereparat pentru PRODUSE: enforce_product_limit (mig 038) e trigger BEFORE INSERT
-- FOR EACH ROW. Intr-un INSERT multi-row (ProductsCsvImport / bulk din UI), fiecare
-- rand-frate vede acelasi count(*) dinainte de statement => un restaurant free
-- (max_products=15) putea insera N>15 produse dintr-o singura comanda PostgREST.
--
-- Fix (oglinda mig 114): trigger AFTER INSERT ... REFERENCING NEW TABLE ... FOR EACH
-- STATEMENT care, dupa ce toate randurile au intrat, verifica pentru fiecare
-- restaurant_id distinct total count(*) vs max_products al planului owner-ului.
-- Defense in depth: NU stergem triggerul per-row (prinde single-row mai devreme).

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

create or replace function public.enforce_product_limit_stmt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec   record;
  v_plan  text;
  v_max   integer;
  v_count integer;
begin
  for v_rec in
    select distinct restaurant_id from new_rows
  loop
    -- Acelasi lock ca triggerul per-row (mig 038) — serializeaza inserturile concurente.
    perform pg_advisory_xact_lock(hashtext('product_limit_' || v_rec.restaurant_id::text));

    select public.owner_plan(v_rec.restaurant_id) into v_plan;
    select max_products into v_max
      from public.plan_limits
     where plan = coalesce(v_plan, 'free');
    if v_max is null then v_max := 15; end if;

    select count(*) into v_count
      from public.products
     where restaurant_id = v_rec.restaurant_id;

    if v_count > v_max then
      raise exception
        'Limita produse atinsa: maxim % pentru planul %.', v_max, coalesce(v_plan, 'free')
        using errcode = 'P0001', hint = 'product_limit';
    end if;
  end loop;

  return null;  -- ignorat la AFTER ... FOR EACH STATEMENT
end;
$$;

revoke all on function public.enforce_product_limit_stmt() from public;

drop trigger if exists trg_enforce_product_limit_stmt on public.products;
create trigger trg_enforce_product_limit_stmt
  after insert on public.products
  referencing new table as new_rows
  for each statement execute function public.enforce_product_limit_stmt();

-- ── Asertiune inline ─────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'trg_enforce_product_limit_stmt'
       and tgrelid = 'public.products'::regclass
       and not tgisinternal
  ) then
    raise exception 'mig 126: triggerul trg_enforce_product_limit_stmt lipseste';
  end if;
  raise notice 'mig 126: limita produse statement-level OK';
end $$;

commit;
