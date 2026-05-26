-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 036 — Happy Hour reguli automate
-- ═══════════════════════════════════════════════════════════════
-- Reduceri automate aplicate la nivel de comandă sau produs, declanșate
-- de interval orar și/sau zi a săptămânii.
--
-- Exemple de reguli:
--   • "Happy Hour 17-19" — 20% reducere pe TOATE produsele între 17:00-19:00
--   • "Sâmbătă seara 21-23" — 15% pe categoria "Cocktailuri"
--   • "Luni-joi prânz 12-15" — 10% pe categoria "Fel principal"
--
-- Aplicare:
--   • La server: trigger NU se rulează automat (păstrăm flexibilitate UI)
--   • UI-ul WaiterPage poate apela `evaluate_happy_hour_for_order(order_id)`
--     pentru a obține lista de reduceri sugerate și un buton "Aplică Happy Hour"
--   • Sau owner poate dezactiva rapid o regulă oricând

create table if not exists public.happy_hour_rules (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  name            text not null check (length(name) between 1 and 80),
  is_active       boolean not null default true,

  -- Interval orar (HH:MM:SS). Local time Europe/Bucharest.
  starts_at       time not null,
  ends_at         time not null,  -- DACĂ ends_at < starts_at, regula trece peste miezul nopții

  -- Zile săptămână: bitmask sau array. Folosim array de int (1=duminică ... 7=sâmbătă, ISO standard).
  -- {} = toate zilele
  days_of_week    smallint[] not null default array[]::smallint[],

  -- Scope: pe ce produse se aplică
  scope           text not null default 'all' check (scope in ('all', 'category', 'product')),
  category_id     uuid references public.categories(id) on delete cascade,  -- doar pentru scope='category'
  product_id      uuid references public.products(id) on delete cascade,    -- doar pentru scope='product'

  -- Tipul reducerii
  discount_type   public.order_discount_type not null,  -- 'percent' | 'amount'
  discount_value  numeric(10,2) not null check (discount_value > 0),

  -- Limită opțională per comandă (ex: max 50 lei reducere)
  max_discount    numeric(10,2),

  -- Audit
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id)
);

create index if not exists idx_happy_hour_rules_active
  on public.happy_hour_rules(restaurant_id, is_active);

-- ── RLS ──────────────────────────────────────────────────────
alter table public.happy_hour_rules enable row level security;

create policy "happy_hour_rules: admin manage" on public.happy_hour_rules for all
  using (public.is_admin(restaurant_id))
  with check (public.is_admin(restaurant_id));

create policy "happy_hour_rules: members read" on public.happy_hour_rules for select
  using (public.is_member(restaurant_id));

-- ── Trigger pentru updated_at ────────────────────────────────
create trigger happy_hour_rules_updated_at
  before update on public.happy_hour_rules
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- RPC: evaluate_happy_hour_for_now
-- ═══════════════════════════════════════════════════════════════
-- Returnează regulile active ACUM (acum = ora locală Europe/Bucharest)
-- pentru un restaurant. Util pentru waiter UI care vrea să afișeze
-- banner "🎉 Happy Hour activ!" + să sugereze aplicarea.
create or replace function public.evaluate_happy_hour_for_now(
  p_restaurant_id uuid
)
returns table (
  id              uuid,
  name            text,
  scope           text,
  category_id     uuid,
  product_id      uuid,
  discount_type   public.order_discount_type,
  discount_value  numeric,
  max_discount    numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now_time    time;
  v_now_dow     smallint;
begin
  if not public.is_member(p_restaurant_id) then
    raise exception 'Not a member of this restaurant';
  end if;

  -- Calculează ora curentă în Europe/Bucharest
  v_now_time := (now() at time zone 'Europe/Bucharest')::time;
  -- ISO day of week: 1=duminică, 2=luni, ..., 7=sâmbătă
  v_now_dow  := extract(isodow from (now() at time zone 'Europe/Bucharest'))::smallint;
  -- Postgres ISODOW: 1=luni, ..., 7=duminică. Convertim la convenția noastră:
  -- Noi vrem 1=duminică, 2=luni, ..., 7=sâmbătă
  v_now_dow  := case when v_now_dow = 7 then 1 else v_now_dow + 1 end;

  return query
    select
      r.id, r.name, r.scope, r.category_id, r.product_id,
      r.discount_type, r.discount_value, r.max_discount
    from public.happy_hour_rules r
    where r.restaurant_id = p_restaurant_id
      and r.is_active = true
      and (
        -- Zile săptămână: gol = toate, altfel verifică inclusiune
        cardinality(r.days_of_week) = 0 OR v_now_dow = ANY(r.days_of_week)
      )
      and (
        -- Interval orar (gestionează peste miezul nopții: ends < starts)
        (r.ends_at >= r.starts_at AND v_now_time >= r.starts_at AND v_now_time <= r.ends_at)
        OR
        (r.ends_at < r.starts_at AND (v_now_time >= r.starts_at OR v_now_time <= r.ends_at))
      );
end;
$$;

revoke all on function public.evaluate_happy_hour_for_now(uuid) from public;
grant execute on function public.evaluate_happy_hour_for_now(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- RPC: suggest_happy_hour_discount_for_order
-- ═══════════════════════════════════════════════════════════════
-- Dat un order_id, calculează ce reducere ar trebui aplicată dacă există
-- happy hour rule activ care matchează produsele din comandă.
--
-- Returnează: { rule_id, rule_name, discount_type, discount_value,
--               applicable_subtotal, computed_discount }
-- DACĂ nu există rule aplicabilă: returnează null.
--
-- Selectează regula care dă reducerea cea mai mare (best for customer).
-- NU aplică automat — UI-ul decide. Apelat din WaiterPage la momentul plății.
create or replace function public.suggest_happy_hour_discount_for_order(
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order         record;
  v_rule          record;
  v_subtotal      numeric;
  v_discount      numeric;
  v_best_discount numeric := 0;
  v_best          jsonb   := null;
begin
  -- Get order + restaurant
  select restaurant_id, subtotal into v_order
    from public.orders where id = p_order_id;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  if not public.is_member(v_order.restaurant_id) then
    raise exception 'Not a member';
  end if;

  -- Iterează prin toate regulile active acum
  for v_rule in
    select * from public.evaluate_happy_hour_for_now(v_order.restaurant_id)
  loop
    -- Calculează subtotal aplicabil pentru această regulă
    if v_rule.scope = 'all' then
      v_subtotal := v_order.subtotal;
    elsif v_rule.scope = 'category' then
      select coalesce(sum(oi.item_total), 0) into v_subtotal
        from public.order_items oi
        join public.products p on p.id = oi.product_id
       where oi.order_id = p_order_id
         and p.category_id = v_rule.category_id;
    elsif v_rule.scope = 'product' then
      select coalesce(sum(oi.item_total), 0) into v_subtotal
        from public.order_items oi
       where oi.order_id = p_order_id
         and oi.product_id = v_rule.product_id;
    else
      v_subtotal := 0;
    end if;

    if v_subtotal <= 0 then continue; end if;

    -- Calculează reducerea
    if v_rule.discount_type = 'percent' then
      v_discount := round(v_subtotal * v_rule.discount_value / 100, 2);
    else  -- amount
      v_discount := least(v_rule.discount_value, v_subtotal);
    end if;

    -- Aplică max_discount cap
    if v_rule.max_discount is not null and v_discount > v_rule.max_discount then
      v_discount := v_rule.max_discount;
    end if;

    -- Păstrează cea mai mare reducere
    if v_discount > v_best_discount then
      v_best_discount := v_discount;
      v_best := jsonb_build_object(
        'rule_id',             v_rule.id,
        'rule_name',           v_rule.name,
        'discount_type',       v_rule.discount_type,
        'discount_value',      v_rule.discount_value,
        'applicable_subtotal', v_subtotal,
        'computed_discount',   v_discount
      );
    end if;
  end loop;

  return v_best;
end;
$$;

revoke all on function public.suggest_happy_hour_discount_for_order(uuid) from public;
grant execute on function public.suggest_happy_hour_discount_for_order(uuid) to authenticated;
