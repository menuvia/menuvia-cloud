-- tests/sql/auto/333_kitchen_change_tickets.sql
-- =============================================================================
-- KC0–KC11 — clichetul PERMANENT al mig 333 (lotul C3c): tichetul de
-- MODIFICARE (la `update_order_items`) și tichetul ANULAT (la intrarea comenzii
-- în `cancelled`) la imprimanta bucătăriei. Tichete NEfiscale. Rulează din
-- tests/sql/auto/ (scripts/run-sql-auto.sh) pe AMBELE medii; autonom, ROLLBACK.
--
-- Fixtura: R1 (growth, ro, București) cu imprimantă de bucătărie, produse cu
-- extra și grupă de opțiuni (ca EO 320); comenzile se creează pe calea REALĂ
-- (create_order), tichetul original pe calea REALĂ (trigger-ul 227 forțat cu
-- `set constraints all immediate`, apoi claim + confirm prin RPC-urile bridge).
-- R3 (growth, New York) servește doar etichetelor din KC8.
--
--   KC0  catalogul: builder STABLE DEFINER `public, pg_temp`, o semnătură, fără
--        EXECUTE pentru anon/authenticated/service_role/PUBLIC, proprietarul lui
--        restaurant_time_zone; funcția de trigger DEFINER fără nicio cale de
--        client (RP13) și fără „now() -” (nu e janitor, JL1); trigger-ul AFTER
--        UPDATE OF status (tgtype 17, doar coloana status, WHEN); update_order_items
--        o semnătură, anon NU / authenticated DA.
--        [PICĂ: grant către authenticated pe builder; trigger-ul fără `of status`]
--   KC1  editarea unei comenzi tipărite → EXACT un tichet nou, cu payload-ul
--        ÎNGHEȚAT: antet „*** MODIFICARE ***”, linia sursei identică cu a
--        tichetului original, ora schimbării, DOAR `+2x Cola`, `+1x Burger >> fara
--        sare`, `-1x Burger` (pizza și burgerul cu bacon, neschimbate, lipsesc),
--        nota comenzii la final.
--        [PICĂ: blocul de enqueue scos din update_order_items (0 tichete); toată
--         comanda tipărită în loc de diferență; ordinea +/− inversată]
--   KC2  editare fără diferență pentru bucătărie — aceleași linii, cu produsul
--        REDENUMIT între timp (linia păstrată ia numele de azi, 320) → niciun
--        tichet. [PICĂ: cheia pe nume în loc de product_id → „-vechi +nou”;
--         builder-ul care nu întoarce NULL pe diferență goală]
--   KC3  gate-urile: imprimanta oprită / comanda fără tichet ne-anulat / plan
--        retrogradat → niciun tichet, iar editarea TRECE (totalul se schimbă).
--        [PICĂ: condiția de imprimantă sau de tichet ne-anulat scoasă. Planul e
--         păzit de DOUĂ ori — gate-ul din RPC și `trg_kitchen_tickets_plan_gate`
--         (227, în DATE, a cărui excepție o înghite catch-all-ul) — deci doar
--         scoaterea AMBELOR pică; verificat prin mutație]
--   KC4  catch-all: un builder care aruncă NU avortează editarea (în
--        subtranzacție, builder-ul înlocuit temporar).
--        [PICĂ: blocul fără `exception when others`]
--   KC5  anulare de către om dintr-o comandă tipărită (new) → EXACT un tichet
--        nou, payload ÎNGHEȚAT: „*** ANULAT ***”, toate liniile cu `-`, fără nota
--        comenzii. [PICĂ: trigger-ul scos; nota pe ANULAT; semnul `+`]
--   KC6  anulare cu tichetul original încă `pending` (bridge offline) → el
--        devine `cancelled` (ORDER_CANCELLED), nu apare în coada bridge-ului,
--        niciun ANULAT. [PICĂ: pasul (1) scos — tichetul comenzii anulate pleacă
--         la imprimantă mai târziu]
--   KC7  niciun ANULAT pe: janitorul 288 (`expire_stale_orders`, fără JWT), pe o
--        anulare din `ready`, pe o comandă fără tichet ajuns la bridge.
--        [PICĂ: gate-ul pe `auth.uid()` scos → janitorul tipărește; gate-ul pe
--         old.status scos]
--   KC8  7 limbi × 5 surse: antetele MODIFICARE/ANULAT din tabela de mai jos,
--        linia sursei = cea a tichetului nou (329) în fiecare limbă, ora
--        SCHIMBĂRII (now(), nu a comenzii) pe fusul localului (New York),
--        ASCII, nota doar pe MODIFICARE.
--        [PICĂ: o etichetă de sursă divergentă de 329; antet ne-ASCII; fusul
--         Bucureștiului în loc de restaurant_time_zone; ora comenzii]
--   KC9  semantica diferenței (builder-ul direct): ordinea opțiunilor nu
--        contează; extra-ul vechi (`id`/`name`) = cel nou (`extra_id`/
--        `extra_name`); nota schimbată → `-` vechi + `+` nou; forma obiect
--        (v_old_lines) = forma array; linia fără produs pe nume; caractere de
--        control → spațiu; kind invalid / change fără instantaneu → excepție.
--        [PICĂ: cheia care ține cont de ordinea opțiunilor; doar forma array]
--   KC10 sub rolul REAL `authenticated`: editarea și anularea produc tichetele
--        (căile DEFINER), owner-ul le citește prin RLS; builder-ul NU e apelabil
--        direct de authenticated / anon (42501 „for function” — altfel orice
--        cont ar citi liniile comenzilor oricui).
--        [PICĂ: grant către authenticated pe builder]
--   KC11 tichetul ANULAT și cel de MODIFICARE NU ating coada fiscală
--        (pending_receipts) și intră în coada bridge-ului în ordinea creării.
-- =============================================================================

begin;

-- ── Fixtura ─────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('33300000-0000-4000-8000-000000000001', 'kc-owner-1@kc333.test'),
  ('33300000-0000-4000-8000-000000000003', 'kc-owner-3@kc333.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email) values
  ('33300000-0000-4000-8000-000000000001', 'kc-owner-1@kc333.test'),
  ('33300000-0000-4000-8000-000000000003', 'kc-owner-3@kc333.test')
  on conflict (id) do nothing;
update public.profiles set plan = 'growth'
 where id in ('33300000-0000-4000-8000-000000000001', '33300000-0000-4000-8000-000000000003');

insert into public.restaurants (id, owner_id, name, slug, city, is_active, language, timezone, country) values
  ('333b0000-0000-4000-8000-000000000001', '33300000-0000-4000-8000-000000000001',
   'KC Bistro', 'kc333-bistro', 'Cluj', true, 'ro', 'Europe/Bucharest', 'RO'),
  ('333b0000-0000-4000-8000-000000000003', '33300000-0000-4000-8000-000000000003',
   'KC Diner', 'kc333-diner', 'NYC', true, 'en', 'America/New_York', 'US');
insert into public.tables (id, restaurant_id, name, slug, seats, is_active) values
  ('333c0000-0000-4000-8000-000000000001', '333b0000-0000-4000-8000-000000000001', 'KC M1', 'kc333-m1', 4, true),
  ('333c0000-0000-4000-8000-000000000003', '333b0000-0000-4000-8000-000000000003', 'T3', 'kc333-t3', 4, true);
insert into public.products (id, restaurant_id, name, price, is_active) values
  ('333d0000-0000-4000-8000-000000000001', '333b0000-0000-4000-8000-000000000001', 'Burger EO', 25, true),
  ('333d0000-0000-4000-8000-000000000002', '333b0000-0000-4000-8000-000000000001', 'Cola EO', 8, true),
  ('333d0000-0000-4000-8000-000000000003', '333b0000-0000-4000-8000-000000000001', 'Pizza EO', 30, true);
insert into public.product_extras (id, product_id, name, price, is_available) values
  ('333e0000-0000-4000-8000-000000000001', '333d0000-0000-4000-8000-000000000001', 'Bacon', 5, true);
insert into public.modifier_groups (id, restaurant_id, name, selection_type, is_required, min_select) values
  ('333a0000-0000-4000-8000-000000000001', '333b0000-0000-4000-8000-000000000001', 'Blat', 'single', true, 1);
insert into public.modifier_options (id, modifier_group_id, name, price_delta, is_available) values
  ('333f0000-0000-4000-8000-000000000001', '333a0000-0000-4000-8000-000000000001', 'Pufos', 2, true),
  ('333f0000-0000-4000-8000-000000000002', '333a0000-0000-4000-8000-000000000001', 'Subtire', 0, true);
insert into public.product_modifier_groups (product_id, modifier_group_id, display_order) values
  ('333d0000-0000-4000-8000-000000000003', '333a0000-0000-4000-8000-000000000001', 0);
insert into public.bridge_devices (id, restaurant_id, name, device_secret, prints_kitchen_receipts) values
  ('33390000-0000-4000-8000-000000000001', '333b0000-0000-4000-8000-000000000001',
   'Bucatarie KC', 'kc333_secret_1', true);

select set_config('request.jwt.claim.sub', '33300000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claim.role', 'authenticated', false);

-- Comanda de lucru (calea reală) + tichetul original pus în coadă la COMMIT-ul
-- simulat. `set constraints all deferred` imediat după: altfel următorul
-- INSERT de comandă ar declanșa trigger-ii amânați pe o comandă fără linii.
create function pg_temp.kc_order(p_notes text default null) returns uuid
language plpgsql as $f$
declare v_res jsonb;
begin
  v_res := public.create_order(
    '333b0000-0000-4000-8000-000000000001', 'waiter', '333c0000-0000-4000-8000-000000000001', null, p_notes,
    '[{"product_id":"333d0000-0000-4000-8000-000000000001","quantity":2},
      {"product_id":"333d0000-0000-4000-8000-000000000001","quantity":1,"extra_ids":["333e0000-0000-4000-8000-000000000001"]},
      {"product_id":"333d0000-0000-4000-8000-000000000003","quantity":1,"option_ids":["333f0000-0000-4000-8000-000000000001"]}]'::jsonb,
    null, null, null, null, null);
  set constraints all immediate;
  set constraints all deferred;
  return (v_res->>'id')::uuid;
end $f$;

-- Tipărirea originalului, pe calea bridge-ului (claim → confirm success).
create function pg_temp.kc_print(p_order uuid) returns void
language plpgsql as $f$
declare v_id uuid;
begin
  for v_id in select id from public.kitchen_tickets where order_id = p_order and status = 'pending' loop
    if (public.bridge_claim_ticket('kc333_secret_1', v_id) ->> 'claimed')::boolean is not true then
      raise exception 'KC SETUP: claim respins pe tichetul %', v_id;
    end if;
    perform public.bridge_confirm_ticket('kc333_secret_1', v_id, true);
  end loop;
end $f$;

create function pg_temp.kc_count(p_order uuid) returns int
language sql as $f$ select count(*)::int from public.kitchen_tickets where order_id = p_order $f$;

-- Liniile comenzii ca payload pentru update_order_items: fiecare linie existentă
-- cu `source_item_id` și extra-urile EI (clientul O3b), cantitatea neschimbată.
create function pg_temp.kc_keep(p_order uuid) returns jsonb
language sql as $f$
  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', product_id, 'quantity', quantity, 'source_item_id', id,
           'option_ids', coalesce((select jsonb_agg(m->>'option_id') from jsonb_array_elements(selected_modifiers) m), '[]'::jsonb),
           'extra_ids',  coalesce((select jsonb_agg(e->>'extra_id') from jsonb_array_elements(extras_added) e), '[]'::jsonb),
           'notes', notes) order by id), '[]'::jsonb)
    from public.order_items where order_id = p_order
$f$;

-- Antetul de timp așteptat pe R1 (ora SCHIMBĂRII, pe fusul localului).
create function pg_temp.kc_stamp(p_order uuid, p_rid uuid) returns text
language sql stable as $f$
  select '#' || upper(right(p_order::text, 6)) || ' · '
         || to_char(now() at time zone public.restaurant_time_zone(p_rid), 'HH24:MI DD.MM')
$f$;

-- Antetele noi, ÎNGHEȚATE (aceeași tabelă ca în mig 333 — o schimbare de
-- etichetă se face în AMBELE, deliberat). Sursa/masa/nota NU sunt aici: KC8 le
-- compară cu tichetul nou din 329, în fiecare limbă.
create temp table kc_labels (lang text primary key, change text, cancel text) on commit drop;
insert into kc_labels values
  ('ro', '*** MODIFICARE ***',    '*** ANULAT ***'),
  ('en', '*** MODIFIED ***',      '*** CANCELLED ***'),
  ('de', '*** AENDERUNG ***',     '*** STORNIERT ***'),
  ('fr', '*** MODIFICATION ***',  '*** ANNULEE ***'),
  ('it', '*** MODIFICA ***',      '*** ANNULLATA ***'),
  ('hu', '*** MODOSITAS ***',     '*** TOROLVE ***'),
  ('es', '*** MODIFICACION ***',  '*** ANULADA ***');

-- ── KC0: catalogul ──────────────────────────────────────────────────────────
do $$
declare
  c_bld constant regprocedure := 'public.build_kitchen_ticket_change_payload(uuid, jsonb, text)'::regprocedure;
  c_trg constant regprocedure := 'public.enqueue_kitchen_cancel_ticket()'::regprocedure;
  c_uoi constant regprocedure := 'public.update_order_items(uuid, jsonb, numeric)'::regprocedure;
  v_fn regprocedure; v_role text; v_n int;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('build_kitchen_ticket_change_payload', 'update_order_items');
  if v_n <> 2 then
    raise exception 'KC0 FAIL: % semnături pentru builder + update_order_items (aștept 2)', v_n;
  end if;
  if not (select prosecdef and provolatile = 's' from pg_proc where oid = c_bld) then
    raise exception 'KC0 FAIL: builder-ul nu mai e STABLE SECURITY DEFINER';
  end if;
  if not (select prosecdef from pg_proc where oid = c_trg) then
    raise exception 'KC0 FAIL: funcția de trigger nu mai e SECURITY DEFINER';
  end if;
  foreach v_fn in array array[c_bld, c_trg, c_uoi] loop
    if not exists (select 1 from pg_proc p, unnest(p.proconfig) c(e)
                    where p.oid = v_fn
                      and lower(regexp_replace(c.e, '[[:space:]]+', '', 'g')) = 'search_path=public,pg_temp') then
      raise exception 'KC0 FAIL: % fără search_path = public, pg_temp', v_fn;
    end if;
  end loop;
  foreach v_fn in array array[c_bld, c_trg] loop
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(v_role, v_fn, 'execute') then
        raise exception 'KC0 FAIL: % apelabil de %', v_fn, v_role;
      end if;
    end loop;
    if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = v_fn and a.grantee = 0) then
      raise exception 'KC0 FAIL: % executabil de PUBLIC', v_fn;
    end if;
  end loop;
  if (select proowner from pg_proc where oid = c_bld)
     is distinct from (select proowner from pg_proc where oid = 'public.restaurant_time_zone(uuid)'::regprocedure) then
    raise exception 'KC0 FAIL: builder-ul are alt proprietar decât restaurant_time_zone (42501 tăcut)';
  end if;
  -- JL1 descoperă funcțiile cu DML + „now() -” și zero argumente ne-scalare;
  -- funcția de trigger nu e un janitor și nu are voie să intre în registru.
  if (select prosrc from pg_proc where oid = c_trg) ~* 'now\(\)[[:space:]]*-' then
    raise exception 'KC0 FAIL: funcția de trigger conține „now() -” (ar fi descoperită de JL1 ca janitor)';
  end if;
  if not exists (
    select 1 from pg_trigger t
     where t.tgname = 'trg_kitchen_ticket_on_cancel' and t.tgrelid = 'public.orders'::regclass
       and t.tgfoid = c_trg and t.tgtype = 17 and t.tgenabled = 'O' and not t.tgdeferrable
       and t.tgqual is not null
       and t.tgattr::text = (select attnum::text from pg_attribute
                              where attrelid = 'public.orders'::regclass and attname = 'status')
  ) then
    raise exception 'KC0 FAIL: trg_kitchen_ticket_on_cancel lipsește sau nu e AFTER UPDATE OF status ROW cu WHEN';
  end if;
  if has_function_privilege('anon', c_uoi, 'execute') or not has_function_privilege('authenticated', c_uoi, 'execute') then
    raise exception 'KC0 FAIL: ACL-ul lui update_order_items (anon NU, authenticated DA)';
  end if;
  raise notice 'KC0 PASS: suprafața (builder, trigger, update_order_items) e cea așteptată';
end $$;

-- ── KC1: tichetul de MODIFICARE, payload înghețat ───────────────────────────
do $$
declare
  v_oid uuid := pg_temp.kc_order('Alergie nuci');
  v_plain uuid; v_bacon uuid; v_pizza uuid;
  v_orig text; v_tk record; v_n int; v_total numeric;
begin
  if pg_temp.kc_count(v_oid) <> 1 then
    raise exception 'KC1 SETUP: tichetul original lipsește (%)', pg_temp.kc_count(v_oid);
  end if;
  perform pg_temp.kc_print(v_oid);
  select payload into v_orig from public.kitchen_tickets where order_id = v_oid;

  select id into v_plain from public.order_items
   where order_id = v_oid and product_id = '333d0000-0000-4000-8000-000000000001' and extras_added = '[]'::jsonb;
  select id into v_bacon from public.order_items
   where order_id = v_oid and product_id = '333d0000-0000-4000-8000-000000000001' and extras_added <> '[]'::jsonb;
  select id into v_pizza from public.order_items
   where order_id = v_oid and product_id = '333d0000-0000-4000-8000-000000000003';

  -- Burger simplu 2 → 1, Burger+Bacon și Pizza neschimbate, Cola ×2 nouă,
  -- un Burger NOU cu nota „fara sare”.
  perform public.update_order_items(v_oid, jsonb_build_array(
    jsonb_build_object('product_id', '333d0000-0000-4000-8000-000000000001', 'quantity', 1, 'source_item_id', v_plain),
    jsonb_build_object('product_id', '333d0000-0000-4000-8000-000000000001', 'quantity', 1, 'source_item_id', v_bacon,
                       'extra_ids', jsonb_build_array('333e0000-0000-4000-8000-000000000001')),
    jsonb_build_object('product_id', '333d0000-0000-4000-8000-000000000003', 'quantity', 1, 'source_item_id', v_pizza,
                       'option_ids', jsonb_build_array('333f0000-0000-4000-8000-000000000001')),
    jsonb_build_object('product_id', '333d0000-0000-4000-8000-000000000002', 'quantity', 2),
    jsonb_build_object('product_id', '333d0000-0000-4000-8000-000000000001', 'quantity', 1, 'notes', 'fara sare')), null);

  select total into v_total from public.orders where id = v_oid;
  if v_total is distinct from 128.00 then
    raise exception 'KC1 SETUP: editarea a dat totalul % (aștept 25+30+32+16+25 = 128)', v_total;
  end if;
  select count(*) into v_n from public.kitchen_tickets where order_id = v_oid and status = 'pending';
  if v_n <> 1 or pg_temp.kc_count(v_oid) <> 2 then
    raise exception 'KC1 FAIL: % tichete pending / % în total (aștept 1 nou + originalul)', v_n, pg_temp.kc_count(v_oid);
  end if;
  select * into v_tk from public.kitchen_tickets where order_id = v_oid and status = 'pending';
  if v_tk.is_reprint then
    raise exception 'KC1 FAIL: tichetul de modificare e marcat is_reprint';
  end if;
  if v_tk.payload is distinct from
       '*** MODIFICARE ***' || e'\n'
    || split_part(v_orig, e'\n', 2) || e'\n'
    || pg_temp.kc_stamp(v_oid, '333b0000-0000-4000-8000-000000000001') || e'\n'
    || '------------------------------' || e'\n'
    || '+1x Burger EO' || e'\n' || '   >> fara sare' || e'\n'
    || '+2x Cola EO' || e'\n'
    || '-1x Burger EO' || e'\n'
    || '------------------------------' || e'\n'
    || 'NOTE: Alergie nuci' then
    raise exception 'KC1 FAIL: payload-ul de modificare diferă de forma înghețată:%', e'\n' || v_tk.payload;
  end if;
  if split_part(v_orig, e'\n', 2) is distinct from 'OSPATAR · MASA: KC M1' then
    raise exception 'KC1 FAIL (premisă): linia sursei pe tichetul original e %', split_part(v_orig, e'\n', 2);
  end if;
  raise notice 'KC1 PASS: un tichet de MODIFICARE, doar +/- (pizza și bacon-ul neschimbate lipsesc)';
end $$;

-- ── KC2: fără diferență pentru bucătărie (produs redenumit) → niciun tichet ──
do $$
declare v_oid uuid := pg_temp.kc_order(); v_before int;
begin
  perform pg_temp.kc_print(v_oid);
  v_before := pg_temp.kc_count(v_oid);
  update public.products set name = 'Burger Clasic' where id = '333d0000-0000-4000-8000-000000000001';
  perform public.update_order_items(v_oid, pg_temp.kc_keep(v_oid), null);
  -- Premisa: linia păstrată chiar a luat numele de azi (320) — altfel testul
  -- n-ar exersa cheia pe produs.
  if not exists (select 1 from public.order_items where order_id = v_oid and product_name_snapshot = 'Burger Clasic') then
    raise exception 'KC2 SETUP: linia păstrată nu a luat numele nou (premisa testului a dispărut)';
  end if;
  if pg_temp.kc_count(v_oid) <> v_before then
    raise exception 'KC2 FAIL: o editare fără diferență a pus % tichet(e) în coadă: %',
      pg_temp.kc_count(v_oid) - v_before,
      (select string_agg(payload, e'\n====\n') from public.kitchen_tickets where order_id = v_oid and status = 'pending');
  end if;
  update public.products set name = 'Burger EO' where id = '333d0000-0000-4000-8000-000000000001';
  raise notice 'KC2 PASS: editare fără diferență (produs redenumit) → niciun tichet';
end $$;

-- ── KC3: gate-urile; editarea trece în toate trei ───────────────────────────
do $$
declare v_oid uuid; v_items jsonb; v_before int; v_case text; v_total numeric;
begin
  foreach v_case in array array['printer_off', 'ticket_cancelled', 'downgrade'] loop
    v_oid := pg_temp.kc_order();
    perform pg_temp.kc_print(v_oid);
    if v_case = 'printer_off' then
      update public.bridge_devices set prints_kitchen_receipts = false
       where id = '33390000-0000-4000-8000-000000000001';
    elsif v_case = 'ticket_cancelled' then
      update public.kitchen_tickets set status = 'cancelled' where order_id = v_oid;
    else
      update public.profiles set plan = 'starter' where id = '33300000-0000-4000-8000-000000000001';
    end if;
    v_before := pg_temp.kc_count(v_oid);
    v_items := pg_temp.kc_keep(v_oid)
            || jsonb_build_array(jsonb_build_object('product_id', '333d0000-0000-4000-8000-000000000002', 'quantity', 1));
    perform public.update_order_items(v_oid, v_items, null);
    select total into v_total from public.orders where id = v_oid;
    if v_total is distinct from 120.00 then
      raise exception 'KC3 FAIL (%): editarea nu a trecut (total %, aștept 112 + 8)', v_case, v_total;
    end if;
    if pg_temp.kc_count(v_oid) <> v_before then
      raise exception 'KC3 FAIL (%): tichet de modificare pus în coadă peste gate', v_case;
    end if;
    update public.bridge_devices set prints_kitchen_receipts = true where id = '33390000-0000-4000-8000-000000000001';
    update public.profiles set plan = 'growth' where id = '33300000-0000-4000-8000-000000000001';
  end loop;
  -- Control pozitiv: aceeași editare, cu toate condițiile îndeplinite → tichet.
  v_oid := pg_temp.kc_order();
  perform pg_temp.kc_print(v_oid);
  v_before := pg_temp.kc_count(v_oid);
  perform public.update_order_items(v_oid, pg_temp.kc_keep(v_oid)
    || jsonb_build_array(jsonb_build_object('product_id', '333d0000-0000-4000-8000-000000000002', 'quantity', 1)), null);
  if pg_temp.kc_count(v_oid) <> v_before + 1 then
    raise exception 'KC3 FAIL (control): fără gate închis tichetul de modificare lipsește';
  end if;
  raise notice 'KC3 PASS: imprimanta oprită / tichet anulat / plan retrogradat → niciun tichet, editarea trece';
end $$;

-- ── KC4: un builder care aruncă nu avortează editarea ───────────────────────
do $$
declare v_oid uuid := pg_temp.kc_order(); v_before int; v_total numeric;
begin
  perform pg_temp.kc_print(v_oid);
  v_before := pg_temp.kc_count(v_oid);
  begin
    execute $ddl$
      create or replace function public.build_kitchen_ticket_change_payload(
        p_order_id uuid, p_old_lines jsonb, p_kind text) returns text
      language plpgsql stable security definer set search_path = public, pg_temp
      as $b$ begin raise exception 'kc4 boom'; end $b$
    $ddl$;
    perform public.update_order_items(v_oid, pg_temp.kc_keep(v_oid)
      || jsonb_build_array(jsonb_build_object('product_id', '333d0000-0000-4000-8000-000000000002', 'quantity', 1)), null);
    select total into v_total from public.orders where id = v_oid;
    if v_total is distinct from 120.00 then
      raise exception 'KC4 FAIL: editarea nu a trecut cu builder-ul stricat (total %)', v_total;
    end if;
    if pg_temp.kc_count(v_oid) <> v_before then
      raise exception 'KC4 FAIL: tichet pus în coadă deși builder-ul a aruncat';
    end if;
    raise exception 'kc4_rollback';
  exception when others then
    if sqlerrm <> 'kc4_rollback' then raise; end if;
  end;
  -- Builder-ul real e înapoi (subtranzacția derulată).
  if position('kc4 boom' in (select prosrc from pg_proc
       where oid = 'public.build_kitchen_ticket_change_payload(uuid, jsonb, text)'::regprocedure)) > 0 then
    raise exception 'KC4 SETUP: builder-ul de test a rămas instalat';
  end if;
  raise notice 'KC4 PASS: un builder care aruncă → editarea trece, niciun tichet';
end $$;

-- ── KC5: anulare de către om → tichetul ANULAT, payload înghețat ────────────
do $$
declare v_oid uuid := pg_temp.kc_order('Alergie nuci'); v_orig text; v_tk record; v_n int;
begin
  perform pg_temp.kc_print(v_oid);
  select payload into v_orig from public.kitchen_tickets where order_id = v_oid;
  perform public.advance_order(v_oid, 'cancel', null, null, null, 'Clientul a plecat');
  if (select status from public.orders where id = v_oid) is distinct from 'cancelled' then
    raise exception 'KC5 SETUP: comanda nu e anulată';
  end if;
  select count(*) into v_n from public.kitchen_tickets where order_id = v_oid and status = 'pending';
  if v_n <> 1 or pg_temp.kc_count(v_oid) <> 2 then
    raise exception 'KC5 FAIL: % tichete ANULAT pending / % în total (aștept 1 + originalul)', v_n, pg_temp.kc_count(v_oid);
  end if;
  select * into v_tk from public.kitchen_tickets where order_id = v_oid and status = 'pending';
  if v_tk.payload is distinct from
       '*** ANULAT ***' || e'\n'
    || split_part(v_orig, e'\n', 2) || e'\n'
    || pg_temp.kc_stamp(v_oid, '333b0000-0000-4000-8000-000000000001') || e'\n'
    || '------------------------------' || e'\n'
    || '-1x Burger EO' || e'\n' || '   + Bacon' || e'\n'
    || '-1x Pizza EO' || e'\n' || '   + Pufos' || e'\n'
    || '-2x Burger EO' || e'\n'
    || '------------------------------' then
    raise exception 'KC5 FAIL: payload-ul ANULAT diferă de forma înghețată:%', e'\n' || v_tk.payload;
  end if;
  -- Originalul tipărit rămâne neatins (success), doar s-a adăugat ANULAT.
  if not exists (select 1 from public.kitchen_tickets where order_id = v_oid and status = 'success') then
    raise exception 'KC5 FAIL: tichetul original tipărit a fost atins';
  end if;
  raise notice 'KC5 PASS: anulare de către om → un tichet ANULAT, toate liniile cu -';
end $$;

-- ── KC6: originalul încă netipărit → anulat, nu mai pleacă, niciun ANULAT ───
do $$
declare v_oid uuid := pg_temp.kc_order(); v_tk record;
begin
  if (select count(*) from public.kitchen_tickets where order_id = v_oid and status = 'pending') <> 1 then
    raise exception 'KC6 SETUP: originalul trebuie să fie pending';
  end if;
  perform public.advance_order(v_oid, 'cancel', null, null, null, 'Dublura QR');
  if pg_temp.kc_count(v_oid) <> 1 then
    raise exception 'KC6 FAIL: % tichete (aștept doar originalul, fără ANULAT)', pg_temp.kc_count(v_oid);
  end if;
  select * into v_tk from public.kitchen_tickets where order_id = v_oid;
  if v_tk.status is distinct from 'cancelled' or v_tk.error_code is distinct from 'ORDER_CANCELLED'
     or v_tk.completed_at is null then
    raise exception 'KC6 FAIL: originalul netipărit a rămas % (%), ar ieși la imprimantă după anulare',
      v_tk.status, v_tk.error_code;
  end if;
  if exists (select 1 from jsonb_array_elements(public.bridge_get_pending_tickets('kc333_secret_1', 20)) x
              where (x ->> 'order_id')::uuid = v_oid) then
    raise exception 'KC6 FAIL: coada bridge-ului încă livrează un tichet al comenzii anulate';
  end if;
  -- Un claim întârziat (bridge-ul citise lista înainte) nu mai reușește.
  if (public.bridge_claim_ticket('kc333_secret_1', v_tk.id) ->> 'claimed')::boolean is not false then
    raise exception 'KC6 FAIL: claim-ul întârziat pe tichetul anulat a reușit';
  end if;
  raise notice 'KC6 PASS: tichetul netipărit al comenzii anulate e anulat și nu mai poate fi revendicat';
end $$;

-- ── KC7: fără ANULAT pe janitor, pe anulare din ready, fără tichet la bridge ─
do $$
declare v_oid uuid; v_res jsonb; v_old_sub text;
begin
  -- (a) janitorul 288: comandă `new` veche de 13 h, tichet tipărit, fără JWT.
  v_oid := pg_temp.kc_order();
  perform pg_temp.kc_print(v_oid);
  update public.orders set created_at = now() - interval '13 hours' where id = v_oid;
  v_old_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claim.sub', '', true);
  v_res := public.expire_stale_orders(12);
  perform set_config('request.jwt.claim.sub', v_old_sub, true);
  if (select status from public.orders where id = v_oid) is distinct from 'cancelled' then
    raise exception 'KC7 SETUP: janitorul nu a anulat comanda veche (%)', v_res;
  end if;
  if pg_temp.kc_count(v_oid) <> 1 then
    raise exception 'KC7 FAIL (a): janitorul a pus un ANULAT în coadă (% tichete)', pg_temp.kc_count(v_oid);
  end if;

  -- (b) anulare din `ready` (bucătăria a terminat) → niciun ANULAT.
  v_oid := pg_temp.kc_order();
  perform pg_temp.kc_print(v_oid);
  update public.orders set status = 'ready' where id = v_oid;
  perform public.advance_order(v_oid, 'cancel', null, null, null, 'Clientul a plecat');
  if (select status from public.orders where id = v_oid) is distinct from 'cancelled' then
    raise exception 'KC7 SETUP: comanda ready nu s-a anulat';
  end if;
  if pg_temp.kc_count(v_oid) <> 1 then
    raise exception 'KC7 FAIL (b): ANULAT pe o comandă anulată din ready';
  end if;

  -- (c) niciun tichet ajuns la bridge (originalul anulat de admin) → niciun ANULAT.
  v_oid := pg_temp.kc_order();
  update public.kitchen_tickets set status = 'cancelled' where order_id = v_oid;
  perform public.advance_order(v_oid, 'cancel', null, null, null, 'Test');
  if pg_temp.kc_count(v_oid) <> 1 then
    raise exception 'KC7 FAIL (c): ANULAT fără niciun tichet ajuns la bridge';
  end if;

  -- (d) control pozitiv: tichetul original în `error` (BRIDGE_TIMEOUT, posibil
  --     tipărit) → ANULAT.
  v_oid := pg_temp.kc_order();
  update public.kitchen_tickets set status = 'error', error_code = 'BRIDGE_TIMEOUT', claimed_at = now()
   where order_id = v_oid;
  perform public.advance_order(v_oid, 'cancel', null, null, null, 'Test');
  if pg_temp.kc_count(v_oid) <> 2
     or not exists (select 1 from public.kitchen_tickets where order_id = v_oid and status = 'pending'
                     and payload like '*** ANULAT ***%') then
    raise exception 'KC7 FAIL (d): tichetul în error (posibil tipărit) nu a primit ANULAT';
  end if;
  raise notice 'KC7 PASS: janitor / din ready / fără tichet la bridge → niciun ANULAT; error → ANULAT';
end $$;

-- ── KC8: 7 limbi × 5 surse (R3, New York) ───────────────────────────────────
insert into public.orders (id, restaurant_id, source, status, total, table_id, notes,
                           customer_name, customer_phone, pickup_time)
select format('33310000-0000-4000-8000-00000000000%s', k)::uuid, '333b0000-0000-4000-8000-000000000003',
       (case k when 1 then 'waiter' when 2 then 'waiter' when 3 then 'qr' when 4 then 'qr' else 'pickup' end)::public.order_source,
       'new', 30,
       case when k in (1, 3) then '333c0000-0000-4000-8000-000000000003'::uuid end,
       case when k in (1, 5) then 'Alergie nuci' end,
       case when k = 5 then 'KC Client' end,
       case when k = 5 then '0722000333' end,
       case when k = 5 then now() + interval '1 hour' end
  from generate_series(1, 5) k;
-- Comenzile au o oră FIXĂ în trecut: ora de pe tichetul de modificare trebuie
-- să fie a schimbării (now()), deci diferită de a tichetului nou.
update public.orders set created_at = timestamptz '2026-07-15 22:30:00+00'
 where id in (select format('33310000-0000-4000-8000-00000000000%s', k)::uuid from generate_series(1, 5) k);
insert into public.order_items (order_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
select format('33310000-0000-4000-8000-00000000000%s', k)::uuid, 'Burger', 2, 15, 30
  from generate_series(1, 5) k;
set constraints all immediate;
set constraints all deferred;
do $$
declare
  o record; v_new text; v_chg text; v_can text; v_n int := 0;
  c_old constant jsonb := '[{"product_id":null,"product_name_snapshot":"Burger","quantity":1}]';
begin
  for o in select l.*, k,
                  format('33310000-0000-4000-8000-00000000000%s', k)::uuid as oid
             from kc_labels l cross join generate_series(1, 5) k
            order by l.lang, k loop
    update public.restaurants set language = o.lang where id = '333b0000-0000-4000-8000-000000000003';
    v_new := public.build_kitchen_ticket_payload(o.oid);
    v_chg := public.build_kitchen_ticket_change_payload(o.oid, c_old, 'change');
    v_can := public.build_kitchen_ticket_change_payload(o.oid, null, 'cancel');
    if split_part(v_chg, e'\n', 1) is distinct from o.change
       or split_part(v_can, e'\n', 1) is distinct from o.cancel then
      raise exception 'KC8 FAIL: antetele în limba % sunt [%] / [%]', o.lang,
        split_part(v_chg, e'\n', 1), split_part(v_can, e'\n', 1);
    end if;
    if split_part(v_chg, e'\n', 2) is distinct from split_part(v_new, e'\n', 2)
       or split_part(v_can, e'\n', 2) is distinct from split_part(v_new, e'\n', 2) then
      raise exception 'KC8 FAIL: linia sursei în limba % (k=%) diferă de tichetul nou 329: [%] vs [%]',
        o.lang, o.k, split_part(v_chg, e'\n', 2), split_part(v_new, e'\n', 2);
    end if;
    if split_part(v_chg, e'\n', 3) is distinct from
         '#' || upper(right(o.oid::text, 6)) || ' · ' || to_char(now() at time zone 'America/New_York', 'HH24:MI DD.MM')
       or split_part(v_can, e'\n', 3) is distinct from split_part(v_chg, e'\n', 3) then
      raise exception 'KC8 FAIL: ora nu e a schimbării pe fusul localului (New York): %', split_part(v_chg, e'\n', 3);
    end if;
    if split_part(v_new, e'\n', 3) not like '% · 18:30 15.07'
       or split_part(v_chg, e'\n', 3) = split_part(v_new, e'\n', 3) then
      raise exception 'KC8 FAIL (anti-vacuitate): tichetul nou / de modificare au ora [%] / [%]',
        split_part(v_new, e'\n', 3), split_part(v_chg, e'\n', 3);
    end if;
    if split_part(v_chg, e'\n', 5) is distinct from '+1x Burger'
       or split_part(v_can, e'\n', 5) is distinct from '-2x Burger' then
      raise exception 'KC8 FAIL: liniile [%] / [%]', split_part(v_chg, e'\n', 5), split_part(v_can, e'\n', 5);
    end if;
    -- Nota comenzii: pe MODIFICARE e ultima linie a tichetului nou; pe ANULAT lipsește.
    if o.k in (1, 5) then
      if split_part(v_chg, e'\n', 7) is distinct from split_part(v_new, e'\n', array_length(string_to_array(v_new, e'\n'), 1))
         or split_part(v_chg, e'\n', 7) not like '% Alergie nuci' then
        raise exception 'KC8 FAIL: nota pe MODIFICARE în limba %: %', o.lang, v_chg;
      end if;
    end if;
    if v_can like '%Alergie nuci%' or array_length(string_to_array(v_can, e'\n'), 1) <> 6 then
      raise exception 'KC8 FAIL: ANULAT cu notă sau linii în plus în limba %: %', o.lang, v_can;
    end if;
    if replace(v_chg || v_can, ' · ', ' ') !~ '^[ -~\n]*$' then
      raise exception 'KC8 FAIL: caractere ne-ASCII în limba %: % / %', o.lang, v_chg, v_can;
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n <> 35 then
    raise exception 'KC8 FAIL (anti-vacuitate): % combinații în loc de 35', v_n;
  end if;
  raise notice 'KC8 PASS: 7 limbi × 5 surse — antete, sursa = 329, ora New York, ASCII';
end $$;

-- ── KC9: semantica diferenței, pe builder ───────────────────────────────────
insert into public.orders (id, restaurant_id, source, status, total, table_id)
values ('33310000-0000-4000-8000-000000000009', '333b0000-0000-4000-8000-000000000001',
        'waiter', 'new', 60, '333c0000-0000-4000-8000-000000000001');
insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot,
                                item_total, notes, selected_modifiers, extras_added) values
  ('33310000-0000-4000-8000-000000000009', '333d0000-0000-4000-8000-000000000001', 'Burger EO', 2, 25, 50, null,
   '[{"option_id":"333f0000-0000-4000-8000-000000000001","option_name":"Pufos"},
     {"option_id":"333f0000-0000-4000-8000-000000000002","option_name":"Subtire"}]',
   '[{"extra_id":"333e0000-0000-4000-8000-000000000001","extra_name":"Bacon","price":5}]'),
  ('33310000-0000-4000-8000-000000000009', null, 'Apa' || chr(9) || 'plata', 1, 10, 10, 'rece' || chr(10) || 'fara gheata', '[]', '[]');
set constraints all immediate;
set constraints all deferred;
do $$
declare
  c_o constant uuid := '33310000-0000-4000-8000-000000000009';
  v_same jsonb; v text; v_raised boolean;
begin
  -- Aceeași configurație, opțiunile în ordine INVERSĂ, extra-ul în forma veche.
  v_same := jsonb_build_array(
    jsonb_build_object('product_id', '333d0000-0000-4000-8000-000000000001', 'product_name_snapshot', 'Burger EO',
      'quantity', 2,
      'selected_modifiers', '[{"option_id":"333f0000-0000-4000-8000-000000000002","option_name":"Subtire"},
                              {"option_id":"333f0000-0000-4000-8000-000000000001","option_name":"Pufos"}]'::jsonb,
      'extras_added', '[{"id":"333e0000-0000-4000-8000-000000000001","name":"Bacon"}]'::jsonb),
    jsonb_build_object('product_id', null, 'product_name_snapshot', 'Apa' || chr(9) || 'plata', 'quantity', 1,
      'notes', 'rece' || chr(10) || 'fara gheata'));
  v := public.build_kitchen_ticket_change_payload(c_o, v_same, 'change');
  if v is not null then
    raise exception 'KC9 FAIL: aceeași configurație (opțiuni inversate / extra în forma veche / linie fără produs) a dat:%', e'\n' || v;
  end if;
  -- Forma obiect (ca v_old_lines din update_order_items) = forma array.
  v := public.build_kitchen_ticket_change_payload(c_o,
         jsonb_build_object('a', v_same -> 0, 'b', v_same -> 1), 'change');
  if v is not null then
    raise exception 'KC9 FAIL: forma obiect a instantaneului nu e echivalentă cu forma array:%', e'\n' || v;
  end if;
  -- Nota liniei schimbată → - vechea + noua; caracterele de control → spațiu.
  v := public.build_kitchen_ticket_change_payload(c_o, jsonb_build_array(v_same -> 0,
         (v_same -> 1) || jsonb_build_object('notes', 'cald')), 'change');
  if split_part(v, e'\n', 5) is distinct from '+1x Apa plata'
     or split_part(v, e'\n', 6) is distinct from '   >> rece fara gheata'
     or split_part(v, e'\n', 7) is distinct from '-1x Apa plata'
     or split_part(v, e'\n', 8) is distinct from '   >> cald'
     or position(chr(9) in v) > 0 then
    raise exception 'KC9 FAIL: nota schimbată / caracterele de control:%', e'\n' || v;
  end if;
  -- Cantitate: 2 → 3 pe aceeași configurație = +1, cu opțiunile și extra-ul liniei.
  v := public.build_kitchen_ticket_change_payload(c_o, jsonb_build_array(
         (v_same -> 0) || jsonb_build_object('quantity', 3), v_same -> 1), 'change');
  if v not like e'%\n------------------------------\n-1x Burger EO\n   + Subtire\n   + Pufos\n   + Bacon\n------------------------------' then
    raise exception 'KC9 FAIL: 3 → 2 pe aceeași configurație nu e „-1x” cu opțiunile liniei vechi:%', e'\n' || v;
  end if;
  -- Contractul: kind invalid / change fără instantaneu → excepție.
  foreach v in array array['nimic', 'change'] loop
    v_raised := false;
    begin
      perform public.build_kitchen_ticket_change_payload(c_o, null, v);
    exception when others then
      v_raised := true;
    end;
    if not v_raised then
      raise exception 'KC9 FAIL: kind=% cu instantaneu NULL nu a aruncat', v;
    end if;
  end loop;
  -- cancel ignoră instantaneul: toate liniile de acum, cu -.
  if public.build_kitchen_ticket_change_payload(c_o, v_same, 'cancel')
       is distinct from public.build_kitchen_ticket_change_payload(c_o, null, 'cancel') then
    raise exception 'KC9 FAIL: cancel depinde de instantaneu';
  end if;
  raise notice 'KC9 PASS: cheia pe produs + id-uri sortate + notă; forma obiect = array; contractul de kind';
end $$;

-- ── KC10: sub rolul REAL authenticated ──────────────────────────────────────
do $$
declare
  v_oid uuid; v_cnl uuid; v_seen int; v_state text; v_msg text;
begin
  v_oid := pg_temp.kc_order();
  perform pg_temp.kc_print(v_oid);
  v_cnl := pg_temp.kc_order();
  perform pg_temp.kc_print(v_cnl);

  perform set_config('role', 'authenticated', true);
  perform public.update_order_items(v_oid, pg_temp.kc_keep(v_oid)
    || jsonb_build_array(jsonb_build_object('product_id', '333d0000-0000-4000-8000-000000000002', 'quantity', 1)), null);
  perform public.advance_order(v_cnl, 'cancel', null, null, null, 'Lipsa ingredient');
  -- Owner-ul vede tichetele noi prin RLS (`kitchen_tickets member read`).
  select count(*) into v_seen from public.kitchen_tickets
   where order_id in (v_oid, v_cnl) and status = 'pending';
  -- Builder-ul NU e o cale de citire pentru client.
  begin
    perform public.build_kitchen_ticket_change_payload(v_oid, null, 'cancel');
    v_state := 'ok';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;
  perform set_config('role', 'none', true);

  if v_seen <> 2 then
    raise exception 'KC10 FAIL: sub authenticated, owner-ul vede % tichete noi (aștept MODIFICARE + ANULAT)', v_seen;
  end if;
  if not exists (select 1 from public.kitchen_tickets where order_id = v_oid and status = 'pending'
                  and payload like '*** MODIFICARE ***%' and payload like '%+1x Cola EO%')
     or not exists (select 1 from public.kitchen_tickets where order_id = v_cnl and status = 'pending'
                     and payload like '*** ANULAT ***%') then
    raise exception 'KC10 FAIL: căile DEFINER nu au produs tichetele sub authenticated';
  end if;
  if v_state is distinct from '42501' or v_msg not like '%for function%' then
    raise exception 'KC10 FAIL: authenticated poate apela builder-ul direct (state %, %)', v_state, v_msg;
  end if;

  perform set_config('role', 'anon', true);
  begin
    perform public.build_kitchen_ticket_change_payload(v_oid, null, 'cancel');
    v_state := 'ok';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;
  perform set_config('role', 'none', true);
  if v_state is distinct from '42501' or v_msg not like '%for function%' then
    raise exception 'KC10 FAIL: anon poate apela builder-ul direct (state %, %)', v_state, v_msg;
  end if;
  raise notice 'KC10 PASS: sub authenticated — tichetele se produc prin DEFINER, builder-ul închis clientului';
end $$;

-- ── KC11: coada fiscală neatinsă; coada bridge-ului în ordinea creării ──────
do $$
declare v_oid uuid := pg_temp.kc_order(); v_fiscal int; v_q jsonb;
begin
  -- Originalul încă pending (bridge offline), apoi o editare: ambele așteaptă,
  -- originalul (vechi) primul, apoi diferența.
  update public.kitchen_tickets set created_at = now() - interval '1 minute' where order_id = v_oid;
  select count(*) into v_fiscal from public.pending_receipts;
  perform public.update_order_items(v_oid, pg_temp.kc_keep(v_oid)
    || jsonb_build_array(jsonb_build_object('product_id', '333d0000-0000-4000-8000-000000000002', 'quantity', 1)), null);
  if (select count(*) from public.pending_receipts) <> v_fiscal then
    raise exception 'KC11 FAIL: tichetul de modificare a atins pending_receipts';
  end if;
  select jsonb_agg(x ->> 'payload' order by ord) into v_q
    from jsonb_array_elements(public.bridge_get_pending_tickets('kc333_secret_1', 20)) with ordinality t(x, ord)
   where (x ->> 'order_id')::uuid = v_oid;
  if jsonb_array_length(v_q) <> 2
     or (v_q ->> 0) not like '*** COMANDA NOUA ***%'
     or (v_q ->> 1) not like '*** MODIFICARE ***%' then
    raise exception 'KC11 FAIL: coada bridge-ului pentru comandă: %', v_q;
  end if;
  raise notice 'KC11 PASS: coada fiscală neatinsă; originalul se tipărește înaintea diferenței';
end $$;

rollback;
