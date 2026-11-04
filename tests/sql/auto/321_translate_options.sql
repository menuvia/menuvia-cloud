-- tests/sql/auto/321_translate_options.sql
-- =============================================================================
-- TO1–TO3 — clichetul PERMANENT al mig 321: opțiunile, grupurile și extra-urile
-- se pot traduce, iar meniul oaspetelui poartă traducerile. Autonom, ROLLBACK.
--
--   TO1  Meniul public (get_menu_for_restaurant) întoarce `translations` pe
--        grup, opțiune și extra, exact cum au fost scrise. [PICĂ: corpul din
--        253 — cheile lipsesc]
--   TO2  `translations` trebuie să fie obiect: un array e refuzat de CHECK.
--   TO3  Departajare pe nume: două produse cu aceeași poziție (importul CSV
--        vechi le dădea tuturor 0) ies mereu în ordine alfabetică.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values ('32100000-0000-4000-8000-000000000001', 'to-owner@to321.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email) values ('32100000-0000-4000-8000-000000000001', 'to-owner@to321.test')
  on conflict (id) do nothing;
update public.profiles set plan = 'growth' where id = '32100000-0000-4000-8000-000000000001';
insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('321b0000-0000-4000-8000-000000000001', '32100000-0000-4000-8000-000000000001', 'TO Bistro', 'to321-bistro', 'Cluj', true);
insert into public.categories (id, restaurant_id, name, display_order) values
  ('321f0000-0000-4000-8000-000000000001', '321b0000-0000-4000-8000-000000000001', 'Pizza', 0);
insert into public.products (id, restaurant_id, category_id, name, price, is_active, display_order) values
  ('321d0000-0000-4000-8000-000000000001', '321b0000-0000-4000-8000-000000000001', '321f0000-0000-4000-8000-000000000001', 'Quattro', 34, true, 0),
  ('321d0000-0000-4000-8000-000000000002', '321b0000-0000-4000-8000-000000000001', '321f0000-0000-4000-8000-000000000001', 'Diavola', 32, true, 0);
insert into public.modifier_groups (id, restaurant_id, name, selection_type, translations) values
  ('321a0000-0000-4000-8000-000000000001', '321b0000-0000-4000-8000-000000000001', 'Mărime', 'single',
   '{"en": {"name": "Size"}}');
insert into public.modifier_options (id, modifier_group_id, name, price_delta, translations) values
  ('321c0000-0000-4000-8000-000000000001', '321a0000-0000-4000-8000-000000000001', 'Mare', 5,
   '{"en": {"name": "Large"}}');
insert into public.product_modifier_groups (product_id, modifier_group_id, display_order) values
  ('321d0000-0000-4000-8000-000000000001', '321a0000-0000-4000-8000-000000000001', 0);
insert into public.product_extras (id, product_id, name, price, translations) values
  ('321e0000-0000-4000-8000-000000000001', '321d0000-0000-4000-8000-000000000001', 'Brânză extra', 4,
   '{"en": {"name": "Extra cheese"}}');

-- ── TO1: traducerile ajung în meniul oaspetelui ─────────────────────────────
do $$
declare v_menu jsonb; v_prod jsonb;
begin
  v_menu := public.get_menu_for_restaurant('321b0000-0000-4000-8000-000000000001')::jsonb;
  select p into v_prod
    from jsonb_array_elements(v_menu->0->'products') p
   where p->>'id' = '321d0000-0000-4000-8000-000000000001';
  if v_prod #>> '{modifier_groups,0,translations,en,name}' is distinct from 'Size'
     or v_prod #>> '{modifier_groups,0,modifier_options,0,translations,en,name}' is distinct from 'Large'
     or v_prod #>> '{extras,0,translations,en,name}' is distinct from 'Extra cheese' then
    raise exception 'TO1 FAIL: traducerile lipsesc din meniu: %', v_prod;
  end if;
  raise notice 'TO1 PASS: grupul, opțiunea și extra-ul își poartă traducerile';
end $$;

-- ── TO2: traducerile trebuie să fie obiect ─────────────────────────────────
do $$
declare v_ok boolean := false;
begin
  begin
    update public.modifier_options set translations = '["en"]'::jsonb
     where id = '321c0000-0000-4000-8000-000000000001';
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'TO2 FAIL: un array a trecut drept translations'; end if;
  raise notice 'TO2 PASS: translations ne-obiect refuzat';
end $$;

-- ── TO3: aceeași poziție → ordine alfabetică ───────────────────────────────
do $$
declare v_names text;
begin
  select string_agg(p->>'name', ',' order by ord) into v_names
    from jsonb_array_elements(public.get_menu_for_restaurant('321b0000-0000-4000-8000-000000000001')::jsonb->0->'products')
         with ordinality as t(p, ord);
  if v_names is distinct from 'Diavola,Quattro' then
    raise exception 'TO3 FAIL: ordinea produselor cu aceeași poziție = % (aștept Diavola,Quattro)', v_names;
  end if;
  raise notice 'TO3 PASS: departajare pe nume';
end $$;

rollback;
