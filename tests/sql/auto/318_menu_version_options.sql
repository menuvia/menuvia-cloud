-- tests/sql/auto/318_menu_version_options.sql
-- =============================================================================
-- VM1–VM3 — clichetul PERMANENT al mig 318: versiunea meniului se schimbă la
-- orice editare care schimbă ce vede oaspetele în foaia produsului. Autonom,
-- ROLLBACK la final.
--
--   VM1  Control: fără schimbări versiunea e stabilă. Apoi FIECARE editare o
--        schimbă: opțiune indisponibilă, preț de opțiune, grup devenit
--        obligatoriu, grup legat de produs, legătură scoasă, preț de extra,
--        extra scos, asociere adăugată. Totul în aceeași tranzacție (now()
--        înghețat), deci schimbarea vine din CONȚINUT, nu din `updated_at`.
--        [PICĂ: corpul din 313 — prima editare de opțiune nu schimbă nimic]
--   VM2  Scope: editările altui restaurant nu schimbă versiunea acestuia
--        (control: o schimbă pe a lui).
--        [PICĂ: filtrul `mg.restaurant_id = p_restaurant_id` scos din termenul
--         opțiunilor]
--   VM3  Suprafața: o semnătură, DEFINER, `public, pg_temp`, iar `anon` o poate
--        apela (apel REAL sub rol; meniul QR e public).
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('31800000-0000-4000-8000-0000000000a1', 'vm-a@vm318.test'),
  ('31800000-0000-4000-8000-0000000000a2', 'vm-b@vm318.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email) values
  ('31800000-0000-4000-8000-0000000000a1', 'vm-a@vm318.test'),
  ('31800000-0000-4000-8000-0000000000a2', 'vm-b@vm318.test')
  on conflict (id) do nothing;
update public.profiles set plan = 'growth'
 where id in ('31800000-0000-4000-8000-0000000000a1', '31800000-0000-4000-8000-0000000000a2');

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('318b0000-0000-4000-8000-000000000001', '31800000-0000-4000-8000-0000000000a1', 'VM A', 'vm318-a', 'Cluj', true),
  ('318b0000-0000-4000-8000-000000000002', '31800000-0000-4000-8000-0000000000a2', 'VM B', 'vm318-b', 'Cluj', true);
insert into public.products (id, restaurant_id, category_id, name, price, is_active) values
  ('318d0000-0000-4000-8000-000000000001', '318b0000-0000-4000-8000-000000000001', null, 'Pizza VM', 30.00, true),
  ('318d0000-0000-4000-8000-000000000002', '318b0000-0000-4000-8000-000000000001', null, 'Bere VM', 12.00, true),
  ('318d0000-0000-4000-8000-000000000003', '318b0000-0000-4000-8000-000000000002', null, 'Pizza B', 30.00, true);
insert into public.modifier_groups (id, restaurant_id, name, selection_type, is_required, min_select) values
  ('318a0000-0000-4000-8000-000000000001', '318b0000-0000-4000-8000-000000000001', 'Blat', 'single', false, 0),
  ('318a0000-0000-4000-8000-000000000002', '318b0000-0000-4000-8000-000000000001', 'Sos', 'multiple', false, 0),
  ('318a0000-0000-4000-8000-000000000003', '318b0000-0000-4000-8000-000000000002', 'Blat B', 'single', false, 0);
insert into public.modifier_options (id, modifier_group_id, name, price_delta, is_available) values
  ('318c0000-0000-4000-8000-000000000001', '318a0000-0000-4000-8000-000000000001', 'Pufos', 2.00, true),
  ('318c0000-0000-4000-8000-000000000003', '318a0000-0000-4000-8000-000000000003', 'Pufos B', 2.00, true);
insert into public.product_modifier_groups (product_id, modifier_group_id, display_order) values
  ('318d0000-0000-4000-8000-000000000001', '318a0000-0000-4000-8000-000000000001', 0),
  ('318d0000-0000-4000-8000-000000000003', '318a0000-0000-4000-8000-000000000003', 0);
insert into public.product_extras (id, product_id, name, price, is_available) values
  ('318e0000-0000-4000-8000-000000000001', '318d0000-0000-4000-8000-000000000001', 'Bacon', 5.00, true),
  ('318e0000-0000-4000-8000-000000000002', '318d0000-0000-4000-8000-000000000001', 'Ou', 3.00, true);

-- ── VM1: fiecare editare de opțiuni/extra/asocieri schimbă versiunea ────────
do $$
declare
  c_a constant uuid := '318b0000-0000-4000-8000-000000000001';
  v_prev text;
  v_next text;
  v_step text;
begin
  v_prev := public.get_menu_version(c_a);
  if v_prev is null or v_prev is distinct from public.get_menu_version(c_a) then
    raise exception 'VM1 FAIL (control): fără schimbări versiunea trebuia stabilă și ne-NULL';
  end if;

  foreach v_step in array array[
    'opțiune indisponibilă', 'preț de opțiune', 'grup obligatoriu', 'grup legat',
    'legătură scoasă', 'preț de extra', 'extra scos', 'asociere adăugată'] loop
    case v_step
      when 'opțiune indisponibilă' then
        update public.modifier_options set is_available = false
         where id = '318c0000-0000-4000-8000-000000000001';
      when 'preț de opțiune' then
        update public.modifier_options set price_delta = 3.00
         where id = '318c0000-0000-4000-8000-000000000001';
      when 'grup obligatoriu' then
        update public.modifier_groups set is_required = true, min_select = 1
         where id = '318a0000-0000-4000-8000-000000000001';
      when 'grup legat' then
        insert into public.product_modifier_groups (product_id, modifier_group_id, display_order)
        values ('318d0000-0000-4000-8000-000000000001', '318a0000-0000-4000-8000-000000000002', 1);
      when 'legătură scoasă' then
        delete from public.product_modifier_groups
         where product_id = '318d0000-0000-4000-8000-000000000001'
           and modifier_group_id = '318a0000-0000-4000-8000-000000000001';
      when 'preț de extra' then
        update public.product_extras set price = 6.00 where id = '318e0000-0000-4000-8000-000000000001';
      when 'extra scos' then
        delete from public.product_extras where id = '318e0000-0000-4000-8000-000000000002';
      when 'asociere adăugată' then
        insert into public.product_pairings (product_id, paired_product_id, display_order)
        values ('318d0000-0000-4000-8000-000000000001', '318d0000-0000-4000-8000-000000000002', 0);
    end case;
    v_next := public.get_menu_version(c_a);
    if v_next is not distinct from v_prev then
      raise exception 'VM1 FAIL: „%” nu a schimbat versiunea meniului', v_step;
    end if;
    v_prev := v_next;
  end loop;
  raise notice 'VM1 PASS: opțiunile, grupurile, legăturile, extra-urile și asocierile schimbă versiunea';
end $$;

-- ── VM2: scope pe restaurant ───────────────────────────────────────────────
do $$
declare
  v_a text := public.get_menu_version('318b0000-0000-4000-8000-000000000001');
  v_b text := public.get_menu_version('318b0000-0000-4000-8000-000000000002');
begin
  update public.modifier_options set is_available = false
   where id = '318c0000-0000-4000-8000-000000000003';
  insert into public.product_extras (product_id, name, price)
  values ('318d0000-0000-4000-8000-000000000003', 'Bacon B', 5.00);
  if public.get_menu_version('318b0000-0000-4000-8000-000000000001') is distinct from v_a then
    raise exception 'VM2 FAIL: editarea meniului lui B a schimbat versiunea lui A';
  end if;
  if public.get_menu_version('318b0000-0000-4000-8000-000000000002') is not distinct from v_b then
    raise exception 'VM2 FAIL (control): editarea meniului lui B nu i-a schimbat versiunea';
  end if;
  raise notice 'VM2 PASS: versiunea fiecărui restaurant ține doar de meniul lui';
end $$;

-- ── VM3: suprafața ─────────────────────────────────────────────────────────
do $$
declare v_cfg text; v_res text;
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'get_menu_version') <> 1 then
    raise exception 'VM3 FAIL: get_menu_version trebuie să aibă O semnătură';
  end if;
  select lower(regexp_replace(coalesce(array_to_string(p.proconfig, ','), ''), '[[:space:]]+', '', 'g'))
    into v_cfg from pg_proc p where p.oid = 'public.get_menu_version(uuid)'::regprocedure;
  if not (select prosecdef from pg_proc where oid = 'public.get_menu_version(uuid)'::regprocedure)
     or v_cfg !~ '(^|,)search_path=public,pg_temp(,|$)' then
    raise exception 'VM3 FAIL: get_menu_version trebuie DEFINER cu search_path public, pg_temp (%)', v_cfg;
  end if;
  perform set_config('role', 'anon', true);
  v_res := public.get_menu_version('318b0000-0000-4000-8000-000000000001');
  perform set_config('role', 'none', true);
  if v_res is null then
    raise exception 'VM3 FAIL: anon a primit NULL pe un restaurant activ';
  end if;
  raise notice 'VM3 PASS: o semnătură, DEFINER, public+pg_temp, apelabilă de anon';
end $$;

rollback;
