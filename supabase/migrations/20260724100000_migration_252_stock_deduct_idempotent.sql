-- Migration 252 — deducerea de stoc: idempotență DB-enforced (o dată per comandă)
--
-- Review adversarial (post-250): `deduct_stock_on_order_paid` (mig 026→250) era
-- idempotentă DOAR pe tranziția de status (deduce la intrarea în ('paid','closed')
-- dintr-o stare non-terminală). NU exista niciun backstop la nivel de DB, spre
-- deosebire de oglinda ei declarată — loyalty mig 226 — care garantează „exact o
-- dată" printr-un index unic parțial + `on conflict do nothing`.
--
-- Vector real (severitate mică, dar corect): politica `orders: admin all` (mig 013)
-- permite owner/manager să facă UPDATE direct pe `orders.status` prin PostgREST
-- (corecții manuale), iar niciun trigger de stare nu blochează `closed→served`.
-- Secvența `closed → served → closed` re-declanșează trigger-ul cu OLD='served'
-- (non-terminal) → NEW='closed' (terminal): fără backstop, ÎNTREGUL stoc al
-- comenzii se scădea A DOUA OARĂ + un rând `stock_movements` duplicat. Stocul
-- derivă negativ, valoarea inventarului se corupe, fără nimic să-l prindă.
--
-- Fix (exact pattern-ul loyalty 226): o tabelă-claim `order_stock_deductions`
-- (order_id PK). Funcția încearcă întâi să REVENDICE comanda; dacă rândul există
-- deja (deducere anterioară), iese fără să scadă nimic. Garanția „o dată per
-- comandă" e acum a bazei de date (unique PK), race-safe, indiferent de câte ori
-- se re-intră în starea terminală. Guardurile de status din mig 250 rămân (fast
-- path: nu revendicăm pe tranziții non-terminale / OLD deja terminal).

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── Tabela-claim: o comandă apare aici DOAR după ce i s-a dedus stocul o dată ──
create table if not exists public.order_stock_deductions (
  order_id     uuid primary key references public.orders(id) on delete cascade,
  deducted_at  timestamptz not null default now()
);
-- Internă: scrisă exclusiv de trigger-ul DEFINER; niciun client nu o citește direct.
alter table public.order_stock_deductions enable row level security;
revoke all on public.order_stock_deductions from anon, authenticated;

create or replace function public.deduct_stock_on_order_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_recipe record;
  v_consumption numeric;
  v_claimed boolean;
begin
  -- Fast path (mig 250): deduce la INTRAREA în starea terminală ('paid' pe pro,
  -- 'closed' pe growth), o singură dată. OLD deja terminal → sare (pro paid→closed).
  if NEW.status not in ('paid', 'closed') then return NEW; end if;
  if OLD.status in ('paid', 'closed') then return NEW; end if;

  -- Backstop DB (mig 252): revendică comanda. Dacă rândul există deja (o deducere
  -- anterioară, ex. re-intrare closed→served→closed prin UPDATE direct), NU se
  -- mai scade nimic. `found` după INSERT ... ON CONFLICT DO NOTHING e true DOAR
  -- când rândul chiar s-a inserat acum.
  insert into public.order_stock_deductions (order_id)
  values (NEW.id)
  on conflict (order_id) do nothing;
  get diagnostics v_claimed = row_count;
  if not v_claimed then
    return NEW;  -- deja dedus o dată — idempotent
  end if;

  -- Pentru fiecare order_item, găsește rețeta și scade ingredientele
  for v_item in
    select oi.product_id, oi.quantity, oi.product_name_snapshot
    from public.order_items oi
    where oi.order_id = NEW.id
  loop
    for v_recipe in
      select r.ingredient_id, r.quantity as recipe_qty, i.current_stock, i.name as ing_name
      from public.recipes r
      join public.ingredients i on i.id = r.ingredient_id
      where r.product_id = v_item.product_id
    loop
      v_consumption := v_recipe.recipe_qty * v_item.quantity;

      update public.ingredients
      set
        current_stock = current_stock - v_consumption,
        updated_at = now()
      where id = v_recipe.ingredient_id;

      insert into public.stock_movements (
        ingredient_id, change_amount, reason, reference_type, reference_id,
        notes
      )
      values (
        v_recipe.ingredient_id, -v_consumption, 'sale', 'order', NEW.id,
        format('Vânzare %sx %s', v_item.quantity, v_item.product_name_snapshot)
      );
    end loop;
  end loop;

  return NEW;
end;
$$;

-- ── Asserție fail-closed: backstop-ul de idempotență e prezent ────────────────
do $$
declare v_src text;
begin
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='order_stock_deductions') then
    raise exception 'mig 252: tabela-claim order_stock_deductions lipsește';
  end if;
  select pg_get_functiondef('public.deduct_stock_on_order_paid()'::regprocedure) into v_src;
  if position('order_stock_deductions' in v_src) = 0
     or position('on conflict (order_id) do nothing' in v_src) = 0 then
    raise exception 'mig 252: deduct_stock nu revendică idempotent comanda (backstop DB lipsă)';
  end if;
  -- guardurile de status din mig 250 rămân
  if position('not in (''paid'', ''closed'')' in v_src) = 0
     or position('OLD.status in (''paid'', ''closed'')' in v_src) = 0 then
    raise exception 'mig 252: guardurile de status (mig 250) au regresat';
  end if;
end $$;

commit;
