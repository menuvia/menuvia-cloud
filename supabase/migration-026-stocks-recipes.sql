-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 026 — Stocuri & Rețete (modul gestiune simplu)
-- ═══════════════════════════════════════════════════════════════
-- Scop:
--   Restaurantul poate ține evidența ingredientelor (stocuri),
--   defini rețete (1 produs = X ingrediente × Y cantitate),
--   urmări furnizorii și NIR-urile,
--   primi alerte când ingrediente scad sub un prag.
--
-- La fiecare comandă plătită, sistemul scade automat ingredientele
-- din stoc conform rețetei (dacă rețeta există).

-- ── Tabela: ingredients ──────────────────────────────────────
create table if not exists public.ingredients (
  id              uuid primary key default uuid_generate_v4(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  name            text not null check (length(name) > 0 and length(name) <= 100),
  unit            text not null check (unit in ('g', 'kg', 'ml', 'l', 'buc', 'pachet')),
  current_stock   numeric(12,3) not null default 0 check (current_stock >= 0),
  min_stock_alert numeric(12,3) check (min_stock_alert is null or min_stock_alert >= 0),
  cost_per_unit   numeric(10,4) not null default 0 check (cost_per_unit >= 0),
  vat_group       smallint not null default 1 check (vat_group between 1 and 4),
  emoji           text check (emoji is null or length(emoji) <= 10),
  category        text check (category is null or length(category) <= 50),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_ingredients_restaurant on public.ingredients(restaurant_id, is_active);
create index idx_ingredients_low_stock on public.ingredients(restaurant_id) 
  where min_stock_alert is not null and current_stock < min_stock_alert;

alter table public.ingredients enable row level security;

create policy "ingredients: admin all" on public.ingredients for all
  using (public.is_admin(restaurant_id)) with check (public.is_admin(restaurant_id));

comment on table public.ingredients is 'Ingrediente / materii prime per restaurant';
comment on column public.ingredients.unit is 'Unitate măsură: g, kg, ml, l, buc, pachet';
comment on column public.ingredients.current_stock is 'Stoc curent în unitatea declarată';
comment on column public.ingredients.cost_per_unit is 'Cost mediu de achiziție per unitate';

-- ── Tabela: recipes (rețete = product → ingredients) ────────
create table if not exists public.recipes (
  id              uuid primary key default uuid_generate_v4(),
  product_id      uuid not null references public.products(id) on delete cascade,
  ingredient_id   uuid not null references public.ingredients(id) on delete cascade,
  quantity        numeric(12,3) not null check (quantity > 0),
  notes           text,
  created_at      timestamptz not null default now(),
  unique (product_id, ingredient_id)
);

create index idx_recipes_product on public.recipes(product_id);
create index idx_recipes_ingredient on public.recipes(ingredient_id);

alter table public.recipes enable row level security;

create policy "recipes: admin all" on public.recipes for all
  using (
    exists (
      select 1 from public.products p
      where p.id = recipes.product_id and public.is_admin(p.restaurant_id)
    )
  )
  with check (
    exists (
      select 1 from public.products p
      where p.id = recipes.product_id and public.is_admin(p.restaurant_id)
    )
  );

comment on table public.recipes is 'Rețete: pentru un produs, câte ingrediente consumă';

-- ── Tabela: stock_movements (audit trail) ────────────────────
create table if not exists public.stock_movements (
  id              uuid primary key default uuid_generate_v4(),
  ingredient_id   uuid not null references public.ingredients(id) on delete cascade,
  change_amount   numeric(12,3) not null,
  reason          text not null check (reason in ('purchase', 'sale', 'waste', 'inventory', 'manual')),
  reference_type  text check (reference_type is null or reference_type in ('order', 'purchase_order', 'manual')),
  reference_id    uuid,
  notes           text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now()
);

create index idx_stock_mov_ingredient on public.stock_movements(ingredient_id, created_at desc);
create index idx_stock_mov_reference on public.stock_movements(reference_type, reference_id) 
  where reference_type is not null;

alter table public.stock_movements enable row level security;

create policy "stock_mov: admin read" on public.stock_movements for select
  using (
    exists (
      select 1 from public.ingredients i
      where i.id = stock_movements.ingredient_id and public.is_admin(i.restaurant_id)
    )
  );

comment on table public.stock_movements is 'Audit trail: toate mișcările de stoc';
comment on column public.stock_movements.change_amount is 'Pozitiv = adăugare, negativ = scădere';

-- ── Tabela: suppliers ────────────────────────────────────────
create table if not exists public.suppliers (
  id                     uuid primary key default uuid_generate_v4(),
  restaurant_id          uuid not null references public.restaurants(id) on delete cascade,
  name                   text not null check (length(name) > 0 and length(name) <= 100),
  vat_id                 text check (vat_id is null or length(vat_id) <= 30),
  contact_name           text,
  phone                  text check (phone is null or length(phone) <= 30),
  email                  text check (email is null or length(email) <= 100),
  address                text,
  payment_terms_days     smallint not null default 0 check (payment_terms_days >= 0),
  is_active              boolean not null default true,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index idx_suppliers_restaurant on public.suppliers(restaurant_id, is_active);

alter table public.suppliers enable row level security;

create policy "suppliers: admin all" on public.suppliers for all
  using (public.is_admin(restaurant_id)) with check (public.is_admin(restaurant_id));

comment on table public.suppliers is 'Furnizori per restaurant';

-- ── Tabela: purchase_orders (NIR) ────────────────────────────
create table if not exists public.purchase_orders (
  id                     uuid primary key default uuid_generate_v4(),
  restaurant_id          uuid not null references public.restaurants(id) on delete cascade,
  supplier_id            uuid references public.suppliers(id) on delete set null,
  invoice_number         text,
  invoice_date           date,
  status                 text not null default 'draft'
                         check (status in ('draft', 'received', 'paid', 'cancelled')),
  subtotal               numeric(12,2) not null default 0,
  vat_total              numeric(12,2) not null default 0,
  total                  numeric(12,2) not null default 0,
  notes                  text,
  created_by             uuid references auth.users(id),
  created_at             timestamptz not null default now(),
  received_at            timestamptz,
  paid_at                timestamptz
);

create index idx_po_restaurant on public.purchase_orders(restaurant_id, status, created_at desc);

alter table public.purchase_orders enable row level security;

create policy "po: admin all" on public.purchase_orders for all
  using (public.is_admin(restaurant_id)) with check (public.is_admin(restaurant_id));

comment on table public.purchase_orders is 'NIR — Note Recepție Marfă (intrări de la furnizori)';

-- ── Tabela: purchase_order_items ─────────────────────────────
create table if not exists public.purchase_order_items (
  id                  uuid primary key default uuid_generate_v4(),
  purchase_order_id   uuid not null references public.purchase_orders(id) on delete cascade,
  ingredient_id       uuid not null references public.ingredients(id) on delete restrict,
  quantity            numeric(12,3) not null check (quantity > 0),
  unit_price          numeric(10,4) not null check (unit_price >= 0),
  vat_rate            numeric(5,2) not null default 19 check (vat_rate >= 0 and vat_rate <= 100),
  line_total          numeric(12,2) not null,
  created_at          timestamptz not null default now()
);

create index idx_po_items_po on public.purchase_order_items(purchase_order_id);

alter table public.purchase_order_items enable row level security;

create policy "po_items: admin all" on public.purchase_order_items for all
  using (
    exists (
      select 1 from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id 
        and public.is_admin(po.restaurant_id)
    )
  )
  with check (
    exists (
      select 1 from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id 
        and public.is_admin(po.restaurant_id)
    )
  );

-- ── RPC: receive_purchase_order (confirmă NIR și crește stocul) ──
create or replace function public.receive_purchase_order(p_po_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po record;
  v_item record;
  v_user_id uuid := auth.uid();
begin
  -- Validează PO
  select * into v_po from public.purchase_orders where id = p_po_id;
  if v_po is null then
    raise exception 'Purchase order not found';
  end if;
  
  if not public.is_admin(v_po.restaurant_id) then
    raise exception 'Permission denied';
  end if;
  
  if v_po.status != 'draft' then
    raise exception 'PO already received or cancelled (status: %)', v_po.status;
  end if;

  -- Pentru fiecare item: crește stocul + recalculează cost mediu + log mișcare
  for v_item in 
    select * from public.purchase_order_items where purchase_order_id = p_po_id
  loop
    -- Update ingredient stock + recalculate weighted average cost
    update public.ingredients
    set 
      current_stock = current_stock + v_item.quantity,
      cost_per_unit = case
        when current_stock + v_item.quantity = 0 then 0
        else (
          (current_stock * cost_per_unit + v_item.quantity * v_item.unit_price)
          / (current_stock + v_item.quantity)
        )
      end,
      updated_at = now()
    where id = v_item.ingredient_id;

    -- Audit trail
    insert into public.stock_movements (
      ingredient_id, change_amount, reason, reference_type, reference_id,
      notes, created_by
    )
    values (
      v_item.ingredient_id, v_item.quantity, 'purchase', 'purchase_order', p_po_id,
      format('NIR %s', coalesce(v_po.invoice_number, p_po_id::text)),
      v_user_id
    );
  end loop;

  -- Update PO status
  update public.purchase_orders
  set status = 'received', received_at = now()
  where id = p_po_id;

  return jsonb_build_object('success', true, 'po_id', p_po_id);
end;
$$;

grant execute on function public.receive_purchase_order(uuid) to authenticated;

-- ── RPC: adjust_stock_manual (ajustare manuală inventar) ─────
create or replace function public.adjust_stock_manual(
  p_ingredient_id uuid,
  p_new_amount    numeric,
  p_notes         text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ing record;
  v_diff numeric;
  v_user_id uuid := auth.uid();
begin
  select * into v_ing from public.ingredients where id = p_ingredient_id;
  if v_ing is null then
    raise exception 'Ingredient not found';
  end if;
  
  if not public.is_admin(v_ing.restaurant_id) then
    raise exception 'Permission denied';
  end if;
  
  if p_new_amount < 0 then
    raise exception 'Stock cannot be negative';
  end if;

  v_diff := p_new_amount - v_ing.current_stock;

  update public.ingredients
  set current_stock = p_new_amount, updated_at = now()
  where id = p_ingredient_id;

  insert into public.stock_movements (
    ingredient_id, change_amount, reason, reference_type,
    notes, created_by
  )
  values (
    p_ingredient_id, v_diff, 'inventory', 'manual',
    coalesce(p_notes, 'Ajustare manuală'), v_user_id
  );

  return jsonb_build_object('success', true, 'new_stock', p_new_amount);
end;
$$;

grant execute on function public.adjust_stock_manual(uuid, numeric, text) to authenticated;

-- ── Trigger: deduce stocul automat la order paid ─────────────
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
begin
  -- Doar la trecere de la NEpaid la paid
  if NEW.status != 'paid' then return NEW; end if;
  if OLD.status = 'paid' then return NEW; end if;

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

      -- Scade din stoc (poate deveni negativ — alerte se ocupă în UI)
      update public.ingredients
      set 
        current_stock = current_stock - v_consumption,
        updated_at = now()
      where id = v_recipe.ingredient_id;

      -- Audit trail
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

drop trigger if exists deduct_stock_trigger on public.orders;
create trigger deduct_stock_trigger
  after update of status on public.orders
  for each row execute function public.deduct_stock_on_order_paid();

comment on function public.deduct_stock_on_order_paid is
  'Scade automat ingredientele din stoc când o comandă e plătită, conform rețetelor';

-- ── View: ingredients with low stock alert ───────────────────
create or replace view public.ingredients_low_stock as
select 
  i.*,
  (i.min_stock_alert is not null and i.current_stock < i.min_stock_alert) as is_low
from public.ingredients i
where i.is_active = true;

grant select on public.ingredients_low_stock to authenticated;

-- ── View: product profitability ──────────────────────────────
create or replace view public.product_profitability as
select 
  p.id as product_id,
  p.restaurant_id,
  p.name,
  p.price as sell_price,
  coalesce((
    select sum(r.quantity * i.cost_per_unit)
    from public.recipes r
    join public.ingredients i on i.id = r.ingredient_id
    where r.product_id = p.id
  ), 0) as cost_price,
  p.price - coalesce((
    select sum(r.quantity * i.cost_per_unit)
    from public.recipes r
    join public.ingredients i on i.id = r.ingredient_id
    where r.product_id = p.id
  ), 0) as profit_amount,
  case 
    when p.price > 0 then
      ((p.price - coalesce((
        select sum(r.quantity * i.cost_per_unit)
        from public.recipes r
        join public.ingredients i on i.id = r.ingredient_id
        where r.product_id = p.id
      ), 0)) / p.price * 100)
    else 0 
  end as margin_percent
from public.products p
where p.is_active = true;

grant select on public.product_profitability to authenticated;
