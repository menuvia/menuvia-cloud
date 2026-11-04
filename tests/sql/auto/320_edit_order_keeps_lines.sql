-- tests/sql/auto/320_edit_order_keeps_lines.sql
-- =============================================================================
-- EO1–EO6 — clichetul PERMANENT al mig 320: editarea unei comenzi nu mută bani
-- și extra-uri între linii. Autonom, ROLLBACK la final. Comenzile se creează pe
-- calea REALĂ (create_order), iar editarea se cere ca proprietar.
--
--   EO1  Două linii „Burger” (una cu Bacon): editarea care adaugă o Cola și
--        trimite fiecare linie cu `source_item_id` lasă Bacon-ul pe linia LUI.
--        [PICĂ: extra-urile liniei-sursă ignorate — Bacon-ul dispare, total 83]
--   EO2  Linia cu Bacon scoasă + un Burger NOU (fără sursă): Burger-ul nou nu
--        moștenește Bacon-ul liniei șterse. [PICĂ: euristica pe produs folosită
--        și în modul strict — totalul crește cu 5 lei]
--   EO3  Prețul burger-ului crește după comandă: linia neschimbată își păstrează
--        prețul; 2 → 3 bucăți = 2 la prețul vechi + 1 la prețul de azi, pe două
--        linii. Control: fără schimbare de preț, 2 → 3 rămâne o linie.
--        [PICĂ: prețul re-citit din products pe linia păstrată]
--   EO4  O opțiune a liniei devine indisponibilă și produsul e scos din meniu:
--        adăugarea unei Cola trece, linia păstrează opțiunea; schimbarea liniei
--        pe o opțiune indisponibilă e refuzată (`invalid_options`); creșterea
--        produsului scos → `product_inactive`. [PICĂ: scutirea din trigger-ul
--        130 doar pentru epuizat — linia păstrată a produsului scos pică]
--        EO3 [PICĂ și: prețul liniei păstrate re-citit din products]
--   EO5  Cantitate 21 → `invalid_quantity`; sursa altei comenzi / folosită de
--        două ori → `invalid_source_item`; comanda rămâne neatinsă.
--   EO6  Clientul vechi (fără niciun `source_item_id`) păstrează comportamentul
--        de dinainte: extra-ul rămâne pe produs (euristica M1).
--   EO7  Plafonul pe linie (recenzia O3a): clientul vechi rămâne pe 1–99 (o
--        comandă cu o linie de 25 se poate edita din clientul instalat); clientul
--        nou păstrează linia de 25 cu sursa ei, dar n-o poate crește, iar o linie
--        NOUĂ peste 20 e refuzată, cu plafonul real în mesaj.
--        [PICĂ: plafonul fix de 20 pe ambele căi — pasul 1 și pasul 2 refuzate]
-- =============================================================================

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('32000000-0000-4000-8000-000000000001', 'eo-owner@eo320.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email) values
  ('32000000-0000-4000-8000-000000000001', 'eo-owner@eo320.test')
  on conflict (id) do nothing;
update public.profiles set plan = 'growth' where id = '32000000-0000-4000-8000-000000000001';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('320b0000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', 'EO Bistro', 'eo320-bistro', 'Cluj', true);
insert into public.tables (id, restaurant_id, name, slug, seats, is_active) values
  ('320c0000-0000-4000-8000-000000000001', '320b0000-0000-4000-8000-000000000001', 'EO M1', 'eo320-m1', 4, true);
insert into public.products (id, restaurant_id, name, price, is_active) values
  ('320d0000-0000-4000-8000-000000000001', '320b0000-0000-4000-8000-000000000001', 'Burger EO', 25, true),
  ('320d0000-0000-4000-8000-000000000002', '320b0000-0000-4000-8000-000000000001', 'Cola EO', 8, true),
  ('320d0000-0000-4000-8000-000000000003', '320b0000-0000-4000-8000-000000000001', 'Pizza EO', 30, true);
insert into public.product_extras (id, product_id, name, price, is_available) values
  ('320e0000-0000-4000-8000-000000000001', '320d0000-0000-4000-8000-000000000001', 'Bacon', 5, true);
insert into public.modifier_groups (id, restaurant_id, name, selection_type, is_required, min_select) values
  ('320a0000-0000-4000-8000-000000000001', '320b0000-0000-4000-8000-000000000001', 'Blat', 'single', true, 1);
insert into public.modifier_options (id, modifier_group_id, name, price_delta, is_available) values
  ('320f0000-0000-4000-8000-000000000001', '320a0000-0000-4000-8000-000000000001', 'Pufos', 2, true),
  ('320f0000-0000-4000-8000-000000000002', '320a0000-0000-4000-8000-000000000001', 'Subțire', 0, true);
insert into public.product_modifier_groups (product_id, modifier_group_id, display_order) values
  ('320d0000-0000-4000-8000-000000000003', '320a0000-0000-4000-8000-000000000001', 0);

select set_config('request.jwt.claim.sub', '32000000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claim.role', 'authenticated', false);

-- Comanda de lucru: Burger+Bacon ×1, Burger ×2 (= 30 + 50 = 80).
create function pg_temp.eo_order() returns uuid
language plpgsql as $f$
declare v_res jsonb;
begin
  v_res := public.create_order(
    '320b0000-0000-4000-8000-000000000001', 'waiter', '320c0000-0000-4000-8000-000000000001', null, null,
    '[{"product_id":"320d0000-0000-4000-8000-000000000001","quantity":1,"extra_ids":["320e0000-0000-4000-8000-000000000001"]},
      {"product_id":"320d0000-0000-4000-8000-000000000001","quantity":2}]'::jsonb,
    null, null, null, null, null);
  return (v_res->>'id')::uuid;
end $f$;

-- Id-ul liniei: cu extra (true) sau fără (false).
create function pg_temp.eo_line(p_order uuid, p_with_extra boolean) returns uuid
language sql as $f$
  select id from public.order_items
   where order_id = p_order and product_id = '320d0000-0000-4000-8000-000000000001'
     and (jsonb_array_length(coalesce(extras_added, '[]')) > 0) = p_with_extra
   limit 1
$f$;

-- Liniile comenzii ca text compact, ordonat: 'Burger EO×1@25+Bacon,Burger EO×2@25,…'.
create function pg_temp.eo_lines(p_order uuid) returns text
language sql as $f$
  select string_agg(product_name_snapshot || '×' || quantity || '@' || unit_price_snapshot::numeric(10,0)
                    || coalesce((select string_agg('+' || (e->>'extra_name'), '' order by e->>'extra_name')
                                   from jsonb_array_elements(coalesce(extras_added, '[]')) e), '')
                    || coalesce((select string_agg('/' || (m->>'option_name'), '' order by m->>'option_name')
                                   from jsonb_array_elements(coalesce(selected_modifiers, '[]')) m), ''),
                    ',' order by product_name_snapshot, quantity, unit_price_snapshot, extras_added::text)
    from public.order_items where order_id = p_order
$f$;

-- ── EO1: fiecare linie își păstrează extra-urile ───────────────────────────
do $$
declare v_oid uuid := pg_temp.eo_order(); v_total numeric; v_items jsonb;
begin
  -- Linia FĂRĂ extra trimisă prima: euristica veche i-ar fi dat ei Bacon-ul.
  v_items := jsonb_build_array(
    jsonb_build_object('product_id', '320d0000-0000-4000-8000-000000000001', 'quantity', 2,
                       'source_item_id', pg_temp.eo_line(v_oid, false)),
    jsonb_build_object('product_id', '320d0000-0000-4000-8000-000000000001', 'quantity', 1,
                       'source_item_id', pg_temp.eo_line(v_oid, true)),
    jsonb_build_object('product_id', '320d0000-0000-4000-8000-000000000002', 'quantity', 1));
  perform public.update_order_items(v_oid, v_items, null);
  select total into v_total from public.orders where id = v_oid;
  if v_total is distinct from 88.00
     or pg_temp.eo_lines(v_oid) <> 'Burger EO×1@25+Bacon,Burger EO×2@25,Cola EO×1@8' then
    raise exception 'EO1 FAIL: total % (aștept 88), linii %', v_total, pg_temp.eo_lines(v_oid);
  end if;
  raise notice 'EO1 PASS: Bacon-ul rămâne pe linia lui';
end $$;

-- ── EO2: o linie nouă nu moștenește extra-ul unei linii șterse ─────────────
-- Comanda are UN singur Burger (cu Bacon), deci euristica veche l-ar alege
-- determinist — testul nu depinde de ordinea uuid-urilor.
do $$
declare v_res jsonb; v_oid uuid; v_cola uuid; v_total numeric;
begin
  v_res := public.create_order(
    '320b0000-0000-4000-8000-000000000001', 'waiter', '320c0000-0000-4000-8000-000000000001', null, null,
    '[{"product_id":"320d0000-0000-4000-8000-000000000001","quantity":1,"extra_ids":["320e0000-0000-4000-8000-000000000001"]},
      {"product_id":"320d0000-0000-4000-8000-000000000002","quantity":1}]'::jsonb,
    null, null, null, null, null);
  v_oid := (v_res->>'id')::uuid;
  select id into v_cola from public.order_items
   where order_id = v_oid and product_id = '320d0000-0000-4000-8000-000000000002';
  -- Linia cu Bacon scoasă; un Burger NOU, simplu.
  perform public.update_order_items(v_oid, jsonb_build_array(
    jsonb_build_object('product_id', '320d0000-0000-4000-8000-000000000002', 'quantity', 1, 'source_item_id', v_cola),
    jsonb_build_object('product_id', '320d0000-0000-4000-8000-000000000001', 'quantity', 1)), null);
  select total into v_total from public.orders where id = v_oid;
  if v_total is distinct from 33.00 or pg_temp.eo_lines(v_oid) <> 'Burger EO×1@25,Cola EO×1@8' then
    raise exception 'EO2 FAIL: total % (aștept 33), linii %', v_total, pg_temp.eo_lines(v_oid);
  end if;
  raise notice 'EO2 PASS: linia nouă vine fără extra-ul liniei șterse';
end $$;

-- ── EO3: linia păstrată își păstrează prețul; unitățile noi la prețul de azi ─
do $$
declare v_oid uuid := pg_temp.eo_order(); v_total numeric; v_plain uuid; v_bacon uuid;
begin
  v_plain := pg_temp.eo_line(v_oid, false);
  v_bacon := pg_temp.eo_line(v_oid, true);
  -- Control: fără schimbare de preț, 2 → 3 rămâne o singură linie.
  perform public.update_order_items(v_oid, jsonb_build_array(
    jsonb_build_object('product_id', '320d0000-0000-4000-8000-000000000001', 'quantity', 3, 'source_item_id', v_plain),
    jsonb_build_object('product_id', '320d0000-0000-4000-8000-000000000001', 'quantity', 1, 'source_item_id', v_bacon)), null);
  if pg_temp.eo_lines(v_oid) <> 'Burger EO×1@25+Bacon,Burger EO×3@25' then
    raise exception 'EO3 FAIL (control): linii %', pg_temp.eo_lines(v_oid);
  end if;

  -- Burger-ul se scumpește la 27; liniile nu se schimbă → prețurile vechi.
  update public.products set price = 27 where id = '320d0000-0000-4000-8000-000000000001';
  v_plain := pg_temp.eo_line(v_oid, false);
  v_bacon := pg_temp.eo_line(v_oid, true);
  perform public.update_order_items(v_oid, jsonb_build_array(
    jsonb_build_object('product_id', '320d0000-0000-4000-8000-000000000001', 'quantity', 3, 'source_item_id', v_plain),
    jsonb_build_object('product_id', '320d0000-0000-4000-8000-000000000001', 'quantity', 1, 'source_item_id', v_bacon)), null);
  select total into v_total from public.orders where id = v_oid;
  if v_total is distinct from 105.00 then
    raise exception 'EO3 FAIL: linii neschimbate re-prețuite: total % (aștept 105), %', v_total, pg_temp.eo_lines(v_oid);
  end if;

  -- 3 → 4 bucăți simple: 3 la 25 + 1 la 27, pe linii separate.
  v_plain := pg_temp.eo_line(v_oid, false);
  v_bacon := pg_temp.eo_line(v_oid, true);
  perform public.update_order_items(v_oid, jsonb_build_array(
    jsonb_build_object('product_id', '320d0000-0000-4000-8000-000000000001', 'quantity', 4, 'source_item_id', v_plain),
    jsonb_build_object('product_id', '320d0000-0000-4000-8000-000000000001', 'quantity', 1, 'source_item_id', v_bacon)), null);
  select total into v_total from public.orders where id = v_oid;
  if v_total is distinct from 132.00
     or pg_temp.eo_lines(v_oid) <> 'Burger EO×1@25+Bacon,Burger EO×1@27,Burger EO×3@25' then
    raise exception 'EO3 FAIL: total % (aștept 132), linii %', v_total, pg_temp.eo_lines(v_oid);
  end if;
  update public.products set price = 25 where id = '320d0000-0000-4000-8000-000000000001';
  raise notice 'EO3 PASS: prețul liniei păstrate rămâne, unitățile noi la prețul de azi';
end $$;

-- ── EO4: opțiune devenită indisponibilă, produs scos din meniu ─────────────
do $$
declare v_res jsonb; v_oid uuid; v_line uuid; v_hint text; v_total numeric;
begin
  v_res := public.create_order(
    '320b0000-0000-4000-8000-000000000001', 'waiter', '320c0000-0000-4000-8000-000000000001', null, null,
    '[{"product_id":"320d0000-0000-4000-8000-000000000003","quantity":2,"option_ids":["320f0000-0000-4000-8000-000000000001"]}]'::jsonb,
    null, null, null, null, null);
  v_oid := (v_res->>'id')::uuid;
  select id into v_line from public.order_items where order_id = v_oid;

  update public.modifier_options set is_available = false where id = '320f0000-0000-4000-8000-000000000001';
  update public.products set is_active = false where id = '320d0000-0000-4000-8000-000000000003';

  -- (a) Adăugarea unei Cola trece; pizza își păstrează opțiunea și prețul.
  perform public.update_order_items(v_oid, jsonb_build_array(
    jsonb_build_object('product_id', '320d0000-0000-4000-8000-000000000003', 'quantity', 2,
                       'option_ids', jsonb_build_array('320f0000-0000-4000-8000-000000000001'), 'source_item_id', v_line),
    jsonb_build_object('product_id', '320d0000-0000-4000-8000-000000000002', 'quantity', 1)), null);
  select total into v_total from public.orders where id = v_oid;
  if v_total is distinct from 72.00 or pg_temp.eo_lines(v_oid) <> 'Cola EO×1@8,Pizza EO×2@30/Pufos' then
    raise exception 'EO4 FAIL: total % (aștept 72), linii %', v_total, pg_temp.eo_lines(v_oid);
  end if;

  -- (b) Creșterea pizzei scoase din meniu → product_inactive, comanda neatinsă.
  select id into v_line from public.order_items where order_id = v_oid and product_id = '320d0000-0000-4000-8000-000000000003';
  v_hint := null;
  begin
    perform public.update_order_items(v_oid, jsonb_build_array(
      jsonb_build_object('product_id', '320d0000-0000-4000-8000-000000000003', 'quantity', 3,
                         'option_ids', jsonb_build_array('320f0000-0000-4000-8000-000000000001'), 'source_item_id', v_line)), null);
  exception when others then get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'product_inactive' then
    raise exception 'EO4 FAIL: creșterea unui produs scos trebuia product_inactive, hint=%', coalesce(v_hint, 'TRECUT');
  end if;

  -- (c) Pizza din nou activă; schimbarea pe aceeași opțiune indisponibilă
  -- într-o linie NOUĂ (fără sursă) → invalid_options.
  update public.products set is_active = true where id = '320d0000-0000-4000-8000-000000000003';
  v_hint := null;
  begin
    perform public.update_order_items(v_oid, jsonb_build_array(
      jsonb_build_object('product_id', '320d0000-0000-4000-8000-000000000003', 'quantity', 1,
                         'option_ids', jsonb_build_array('320f0000-0000-4000-8000-000000000001'))), null);
  exception when others then get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'invalid_options' then
    raise exception 'EO4 FAIL: opțiunea indisponibilă pe o linie nouă trebuia invalid_options, hint=%', coalesce(v_hint, 'TRECUT');
  end if;
  select total into v_total from public.orders where id = v_oid;
  if v_total is distinct from 72.00 then
    raise exception 'EO4 FAIL: refuzurile au modificat comanda (total %)', v_total;
  end if;
  update public.modifier_options set is_available = true where id = '320f0000-0000-4000-8000-000000000001';
  raise notice 'EO4 PASS: linia păstrată trece peste indisponibilitate, schimbarea nu';
end $$;

-- ── EO5: cantitate și surse invalide ───────────────────────────────────────
do $$
declare v_oid uuid := pg_temp.eo_order(); v_other uuid := pg_temp.eo_order(); v_hint text; v_total numeric;
begin
  v_hint := null;
  begin
    perform public.update_order_items(v_oid,
      '[{"product_id":"320d0000-0000-4000-8000-000000000002","quantity":21,"source_item_id":null}]'::jsonb, null);
  exception when others then get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'invalid_quantity' then
    raise exception 'EO5 FAIL: cantitatea 21 trebuia invalid_quantity, hint=%', coalesce(v_hint, 'TRECUT');
  end if;

  v_hint := null;
  begin
    perform public.update_order_items(v_oid, jsonb_build_array(
      jsonb_build_object('product_id', '320d0000-0000-4000-8000-000000000001', 'quantity', 1,
                         'source_item_id', pg_temp.eo_line(v_other, true))), null);
  exception when others then get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'invalid_source_item' then
    raise exception 'EO5 FAIL: sursa altei comenzi trebuia invalid_source_item, hint=%', coalesce(v_hint, 'TRECUT');
  end if;

  v_hint := null;
  begin
    perform public.update_order_items(v_oid, jsonb_build_array(
      jsonb_build_object('product_id', '320d0000-0000-4000-8000-000000000001', 'quantity', 1,
                         'source_item_id', pg_temp.eo_line(v_oid, true)),
      jsonb_build_object('product_id', '320d0000-0000-4000-8000-000000000001', 'quantity', 1,
                         'source_item_id', pg_temp.eo_line(v_oid, true))), null);
  exception when others then get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'invalid_source_item' then
    raise exception 'EO5 FAIL: aceeași sursă de două ori trebuia invalid_source_item, hint=%', coalesce(v_hint, 'TRECUT');
  end if;
  select total into v_total from public.orders where id = v_oid;
  if v_total is distinct from 80.00 then
    raise exception 'EO5 FAIL: refuzurile au modificat comanda (total %)', v_total;
  end if;
  raise notice 'EO5 PASS: cantitate > 20 și surse invalide refuzate, comanda neatinsă';
end $$;

-- ── EO6: clientul vechi păstrează comportamentul de dinainte ───────────────
do $$
declare v_res jsonb; v_oid uuid;
begin
  v_res := public.create_order(
    '320b0000-0000-4000-8000-000000000001', 'waiter', '320c0000-0000-4000-8000-000000000001', null, null,
    '[{"product_id":"320d0000-0000-4000-8000-000000000001","quantity":1,"extra_ids":["320e0000-0000-4000-8000-000000000001"]}]'::jsonb,
    null, null, null, null, null);
  v_oid := (v_res->>'id')::uuid;
  perform public.update_order_items(v_oid,
    '[{"product_id":"320d0000-0000-4000-8000-000000000001","quantity":1},
      {"product_id":"320d0000-0000-4000-8000-000000000002","quantity":1}]'::jsonb, null);
  if pg_temp.eo_lines(v_oid) <> 'Burger EO×1@25+Bacon,Cola EO×1@8' then
    raise exception 'EO6 FAIL: clientul vechi a pierdut extra-ul: %', pg_temp.eo_lines(v_oid);
  end if;
  raise notice 'EO6 PASS: fără source_item_id, comportamentul de dinainte';
end $$;

-- ── EO7: plafonul pe linie, pe ambele căi ──────────────────────────────────
do $$
declare v_oid uuid := pg_temp.eo_order(); v_line uuid; v_hint text; v_msg text; v_total numeric;
begin
  -- 1) Clientul vechi: o linie de 25 trece (plafonul 1–99 din 313).
  perform public.update_order_items(v_oid,
    '[{"product_id":"320d0000-0000-4000-8000-000000000002","quantity":25}]'::jsonb, null);
  select id into v_line from public.order_items where order_id = v_oid;
  if pg_temp.eo_lines(v_oid) <> 'Cola EO×25@8' then
    raise exception 'EO7 FAIL: clientul vechi nu mai poate scrie 25: %', pg_temp.eo_lines(v_oid);
  end if;

  -- 2) Clientul nou păstrează linia de 25 cu sursa ei și adaugă o pizza.
  perform public.update_order_items(v_oid, jsonb_build_array(
    jsonb_build_object('product_id', '320d0000-0000-4000-8000-000000000002', 'quantity', 25, 'source_item_id', v_line),
    jsonb_build_object('product_id', '320d0000-0000-4000-8000-000000000003', 'quantity', 1, 'source_item_id', null,
                       'option_ids', jsonb_build_array('320f0000-0000-4000-8000-000000000002'))), null);
  select total into v_total from public.orders where id = v_oid;
  if v_total is distinct from 230.00 then
    raise exception 'EO7 FAIL: linia păstrată de 25 (aștept total 230), %: %', v_total, pg_temp.eo_lines(v_oid);
  end if;
  select id into v_line from public.order_items
   where order_id = v_oid and product_id = '320d0000-0000-4000-8000-000000000002';

  -- 3) …dar n-o poate crește peste cantitatea veche.
  v_hint := null; v_msg := null;
  begin
    perform public.update_order_items(v_oid, jsonb_build_array(
      jsonb_build_object('product_id', '320d0000-0000-4000-8000-000000000002', 'quantity', 26, 'source_item_id', v_line)), null);
  exception when others then get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text;
  end;
  if v_hint is distinct from 'invalid_quantity' or v_msg not like '%(1-25)%' then
    raise exception 'EO7 FAIL: 25 → 26 trebuia invalid_quantity (1-25): hint=% msg=%', coalesce(v_hint, 'TRECUT'), v_msg;
  end if;

  -- 4) O linie NOUĂ peste 20 e refuzată, cu plafonul 20 în mesaj.
  v_hint := null; v_msg := null;
  begin
    perform public.update_order_items(v_oid, jsonb_build_array(
      jsonb_build_object('product_id', '320d0000-0000-4000-8000-000000000002', 'quantity', 25, 'source_item_id', v_line),
      jsonb_build_object('product_id', '320d0000-0000-4000-8000-000000000001', 'quantity', 21, 'source_item_id', null)), null);
  exception when others then get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text;
  end;
  if v_hint is distinct from 'invalid_quantity' or v_msg not like '%(1-20)%' then
    raise exception 'EO7 FAIL: linia nouă de 21 trebuia invalid_quantity (1-20): hint=% msg=%', coalesce(v_hint, 'TRECUT'), v_msg;
  end if;
  select total into v_total from public.orders where id = v_oid;
  if v_total is distinct from 230.00 then
    raise exception 'EO7 FAIL: refuzurile au modificat comanda (total %)', v_total;
  end if;
  raise notice 'EO7 PASS: clientul vechi pe 1–99, linia păstrată își ține cantitatea, linia nouă ≤ 20';
end $$;

rollback;
