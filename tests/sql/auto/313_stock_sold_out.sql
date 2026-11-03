-- tests/sql/auto/313_stock_sold_out.sql
-- =============================================================================
-- SO1–SO8 — clichetul PERMANENT al mig 313 („Epuizat” automat din stoc +
-- deblocare de către personal, lotul B). Rulează din tests/sql/auto/ pe AMBELE
-- medii (Postgres gol din sql-verify + stack-ul Supabase din E2E). Autonom,
-- ROLLBACK la final. Fiecare test are CONTROL POZITIV (starea opusă, care
-- trebuie să treacă) și mutația care îl pică, verificată pe replay.
--
--   SO1  Stoc SUB o porție → epuizat, sursa 'stock' — pe calea REALĂ a unei
--        vânzări (comandă →closed, deducerea 250/252 NEATINSĂ) și pe o ajustare
--        directă. Pragul e STRICT: stoc == porție rămâne disponibil. Un local
--        fără featurea `stocks` nu e atins (stocul nu e ținut acolo).
--        [PICĂ: trg_ingredients_sold_out_upd șters; gate-ul
--         `restaurant_has_feature(…,'stocks')` scos din recalc_products_sold_out]
--   SO2  Stoc refăcut → revine SINGUR, doar când sursa e stocul; ștergerea
--        rețetei (recipes DELETE) îl eliberează la fel.
--        [PICĂ: a doua actualizare din recalc_products_sold_out scoasă;
--         triggerul de DELETE pe recipes șters; `<` → `<=` în predicatul pe
--         mulțime din recalc_products_sold_out (stoc == porție rămâne epuizat)]
--   SO3  Epuizarea MANUALĂ (RPC și PATCH direct al adminului, normalizat de
--        trg_products_sold_out_normalize) nu e ștearsă de stoc, nici la
--        refacere, nici la lipsă. Deblocarea manuală a unui produs epuizat din
--        stoc ține la următoarea SCĂDERE (rămâne disponibil, sursa 'manual');
--        stocul refăcut RE-ARMEAZĂ regula, iar o nouă scădere îl epuizează iar.
--        [PICĂ: filtrul `sold_out_source is null` scos din prima actualizare
--         (manualul devine 'stock' și apoi revine singur); a treia actualizare
--         (re-armarea) scoasă; normalizarea scoasă (PATCH-ul direct lasă
--         'stock' pe un produs blocat de om → CHECK-ul pică)]
--   SO4  set_product_sold_out: ospătarul ȘI bucătarul (membri) DA, sub rolul
--        REAL `authenticated`; owner-ul altui restaurant NU (42501 + hint
--        `not_member`), cu EXACT aceeași eroare ca un id inexistent (anti-
--        oracol); `anon` NU (42501 pe ACL-ul FUNCȚIEI, nu pe schemă).
--        [PICĂ: `is_member` → `true`; `grant … to anon`; ramuri diferite
--         pentru „nu există” și „străin”]
--   SO5  create_order respinge un produs epuizat cu hint `product_sold_out`
--        (prin trigger-ul 130, pe calea reală); control: același produs,
--        disponibil, trece.
--        [PICĂ: ramura sold_out scoasă din reject_unavailable_order_item]
--   SO6  update_order_items PĂSTREAZĂ cantitatea deja comandată dintr-un produs
--        epuizat între timp (editarea altei linii trece); creșterea cantității
--        lui sau adăugarea unui produs epuizat NOU → `product_sold_out`, cu
--        comanda NEATINSĂ; GUC-ul de păstrare e golit după RPC (un INSERT
--        direct ulterior în aceeași tranzacție e respins).
--        [PICĂ: verificarea de cantitate scoasă (creșterea trece); GUC-ul
--         nefixat (editarea pică pe trigger-ul 130); GUC-ul nepus înapoi pe ''
--         după ultimul INSERT — de aceea ultima linie a editării valide e supa]
--   SO7  Catalog: cele 4 triggere de stoc sunt FOR EACH STATEMENT (tgtype & 1 =
--        0) cu transition tables și NU recalculează (doar pun în coadă);
--        golirea e un constraint trigger DEFERRABLE INITIALLY DEFERRED pe
--        coadă (tgtype 5); recalcularea lock-uiește ordonat cu `skip locked`;
--        coada e deny-all; funcțiile noi DEFINER cu `public, pg_temp`;
--        funcțiile de trigger și helperii interni NU sunt executabili de
--        anon/authenticated (RP13); O SINGURĂ semnătură pe fiecare RPC.
--        [PICĂ: un trigger recreat `for each row`; `grant execute … to
--         authenticated` pe o funcție de trigger; `security invoker`;
--         `initially immediate` pe golire; `skip locked` scos]
--   SO8  get_menu_version: se schimbă la epuizare/deblocare și la o editare de
--        produs, rămâne IDENTICĂ fără schimbări (control: două citiri la rând),
--        NULL pe restaurant inactiv; anon o poate apela (apel REAL).
--        [PICĂ: is_sold_out scos din hash; filtrul is_restaurant_active scos;
--         revoke pe anon]
--   SO9  Recalcularea e AMÂNATĂ la commit, iar semnalul e doar pe pragul
--        TRAVERSAT: cu constraint trigger-ul în modul implicit (deferred), o
--        scădere care NU traversează pragul nu pune nimic în coadă; o vânzare
--        REALĂ care îl traversează pune produsul în coadă, dar produsul rămâne
--        disponibil până la „commit” (`set constraints … immediate`, exact ce
--        face COMMIT-ul cu evenimentele amânate) — abia atunci devine
--        true/stock, iar coada se golește.
--        [PICĂ: filtrul de traversare înlocuit cu `current_stock is distinct
--         from` (coadă ne-goală fără traversare); recalcularea chemată direct
--         din triggerul de statement (produsul epuizat înainte de commit);
--         constraint trigger-ul făcut NOT DEFERRABLE (SET CONSTRAINTS pică)]
--   SO10 O recalculare care ARUNCĂ la commit (trigger temporar pe products,
--        creat în test) NU oprește încasarea: comanda se închide, „commit-ul”
--        (`set constraints … immediate`) trece, produsul rămâne neatins, iar
--        coada e golită (fără rânduri orfane). Testat în modul AMÂNAT: în modul
--        imediat eroarea ar fi absorbită și de sub-blocul semnalului, care ar
--        masca pierderea sub-blocului din golire.
--        [PICĂ: sub-blocul `exception when others` scos din
--         flush_products_sold_out_queue; golirea mutată ÎN sub-blocul
--         recalculării (rândul rămâne în coadă)]
--   SO11 Partenerul cu acces ACORDAT (mig 286) poate marca epuizat/disponibil
--        (sub rolul REAL `authenticated`); după revocare primește EXACT
--        eroarea străinului (anti-oracol).
--        [PICĂ: ramura `has_partner_access` scoasă din set_product_sold_out;
--         o eroare distinctă pentru partenerul revocat]
--
-- Modul constraint trigger-ului: SO1–SO8 rulează cu
-- `trg_products_sold_out_queue_flush` IMEDIAT (recalcularea la sfârșitul
-- statement-ului care a pus în coadă), fiindcă tot fișierul e o singură
-- tranzacție derulată la final — COMMIT-ul nu vine niciodată. SO9/SO10
-- exersează modul REAL (amânat) și „commit-ul” explicit.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Fixtură ──────────────────────────────────────────────────────────────────
-- A (growth, Gestiune): R1 cu ospătar + bucătar; B (growth): R2, străinul;
-- F (growth la seed, apoi free): R3 — gate-ul `stocks`.
insert into auth.users (id, email) values
  ('31300000-0000-4000-8000-000000000001', 'so-owner-a@pg313.test'),
  ('31300000-0000-4000-8000-000000000002', 'so-owner-b@pg313.test'),
  ('31300000-0000-4000-8000-000000000003', 'so-waiter@pg313.test'),
  ('31300000-0000-4000-8000-000000000004', 'so-kitchen@pg313.test'),
  ('31300000-0000-4000-8000-000000000005', 'so-owner-f@pg313.test'),
  ('31300000-0000-4000-8000-000000000006', 'so-partner@pg313.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email)
  select id, email from auth.users where email like 'so-%@pg313.test'
  on conflict (id) do nothing;
update public.profiles set plan = 'growth'
 where id in ('31300000-0000-4000-8000-000000000001', '31300000-0000-4000-8000-000000000002',
              '31300000-0000-4000-8000-000000000005');

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('313b0000-0000-4000-8000-000000000001', '31300000-0000-4000-8000-000000000001', 'SO Bistro', 'so313-bistro', 'Cluj', true),
  ('313b0000-0000-4000-8000-000000000002', '31300000-0000-4000-8000-000000000002', 'SO Altul', 'so313-altul', 'Cluj', true),
  ('313b0000-0000-4000-8000-000000000003', '31300000-0000-4000-8000-000000000005', 'SO Free', 'so313-free', 'Cluj', true);

insert into public.restaurant_memberships (restaurant_id, user_id, role) values
  ('313b0000-0000-4000-8000-000000000001', '31300000-0000-4000-8000-000000000003', 'waiter'),
  ('313b0000-0000-4000-8000-000000000001', '31300000-0000-4000-8000-000000000004', 'kitchen');

insert into public.tables (id, restaurant_id, name, slug, seats, is_active) values
  ('313c0000-0000-4000-8000-000000000001', '313b0000-0000-4000-8000-000000000001', 'SO M1', 'so313-m1', 4, true);

-- Produse: P1 (rețetă: 2 kg făină), P2 (rețetă: 1 kg făină + 1 buc ou),
-- P3 (fără rețetă), P4 (pe R3, rețetă), P5 (pe R1, pentru SO6).
insert into public.products (id, restaurant_id, name, price, is_active) values
  ('313d0000-0000-4000-8000-000000000001', '313b0000-0000-4000-8000-000000000001', 'SO Pâine', 10, true),
  ('313d0000-0000-4000-8000-000000000002', '313b0000-0000-4000-8000-000000000001', 'SO Clătită', 12, true),
  ('313d0000-0000-4000-8000-000000000003', '313b0000-0000-4000-8000-000000000001', 'SO Apă', 5, true),
  ('313d0000-0000-4000-8000-000000000004', '313b0000-0000-4000-8000-000000000003', 'SO Free Pâine', 10, true),
  ('313d0000-0000-4000-8000-000000000005', '313b0000-0000-4000-8000-000000000001', 'SO Supă', 15, true),
  ('313d0000-0000-4000-8000-000000000006', '313b0000-0000-4000-8000-000000000001', 'SO Ciorbă', 18, true);

insert into public.ingredients (id, restaurant_id, name, unit, current_stock) values
  ('313e0000-0000-4000-8000-000000000001', '313b0000-0000-4000-8000-000000000001', 'SO Făină', 'kg', 10),
  ('313e0000-0000-4000-8000-000000000002', '313b0000-0000-4000-8000-000000000001', 'SO Ou', 'buc', 10),
  ('313e0000-0000-4000-8000-000000000003', '313b0000-0000-4000-8000-000000000003', 'SO Free Făină', 'kg', 10),
  ('313e0000-0000-4000-8000-000000000005', '313b0000-0000-4000-8000-000000000001', 'SO Legume', 'kg', 10),
  ('313e0000-0000-4000-8000-000000000006', '313b0000-0000-4000-8000-000000000001', 'SO Carne', 'kg', 10);

insert into public.recipes (product_id, ingredient_id, quantity) values
  ('313d0000-0000-4000-8000-000000000001', '313e0000-0000-4000-8000-000000000001', 2),
  ('313d0000-0000-4000-8000-000000000002', '313e0000-0000-4000-8000-000000000001', 1),
  ('313d0000-0000-4000-8000-000000000002', '313e0000-0000-4000-8000-000000000002', 1),
  ('313d0000-0000-4000-8000-000000000004', '313e0000-0000-4000-8000-000000000003', 2),
  ('313d0000-0000-4000-8000-000000000005', '313e0000-0000-4000-8000-000000000005', 1),
  ('313d0000-0000-4000-8000-000000000006', '313e0000-0000-4000-8000-000000000006', 1);

-- R3 coboară pe free DUPĂ seed (ingredientele cer `stocks` la INSERT, mig 142).
update public.profiles set plan = 'free' where id = '31300000-0000-4000-8000-000000000005';

-- Partenerul (SO11): afiliat activ care l-a adus pe owner-ul A, cu acces
-- ACORDAT de owner (mig 286: owner_consented_at; revocarea vine în SO11).
insert into public.affiliates (id, profile_id, referral_code) values
  ('313a0000-0000-4000-8000-000000000001', '31300000-0000-4000-8000-000000000006', 'sopartner313');
insert into public.affiliate_attributions (id, affiliate_id, referred_profile_id, status, source, owner_consented_at) values
  ('313a0000-0000-4000-8000-0000000000a1', '313a0000-0000-4000-8000-000000000001',
   '31300000-0000-4000-8000-000000000001', 'active', 'link', now());

-- SO1–SO8: golirea cozii IMEDIAT (vezi antetul); SO9/SO10 trec pe modul real.
set constraints public.trg_products_sold_out_queue_flush immediate;

-- Starea unui produs ca text compact: 'true/stock', 'false/-', …
create function pg_temp.so_state(p uuid) returns text
language sql as $f$
  select coalesce(is_sold_out, false)::text || '/' || coalesce(sold_out_source, '-')
    from public.products where id = p
$f$;

-- Apel SUB rolul și identitatea date; întoarce null (a trecut) sau
-- 'SQLSTATE|hint|mesaj'. `set_config('role')` stă ÎN AFARA sub-blocului cu
-- excepție (în interior s-ar derula înapoi cu subtranzacția). EXECUTE dinamic:
-- PL/pgSQL ar cache-ui verificarea de ACL a primului rol (lecția TS4).
create function pg_temp.so_call(p_role text, p_sub uuid, p_sql text) returns text
language plpgsql as $f$
declare v_state text; v_hint text; v_msg text; v_out text := null;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('role', p_role, true);
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint, v_msg = message_text;
    v_out := v_state || '|' || coalesce(v_hint, '') || '|' || v_msg;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v_out;
end $f$;

-- ── SO1: stoc sub o porție → epuizat din stoc ────────────────────────────────
do $$
declare v_res jsonb; v_oid uuid;
begin
  -- Control: la seed (10 kg făină, porții 2/1) totul e disponibil.
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000001') <> 'false/-'
     or pg_temp.so_state('313d0000-0000-4000-8000-000000000002') <> 'false/-' then
    raise exception 'SO1 FAIL (control): la stoc suficient produsele trebuiau disponibile: %, %',
      pg_temp.so_state('313d0000-0000-4000-8000-000000000001'), pg_temp.so_state('313d0000-0000-4000-8000-000000000002');
  end if;

  -- Vânzare REALĂ: 4 pâini (4 × 2 kg = 8 kg) → rămân 2 kg = EXACT o porție de
  -- pâine → pâinea rămâne disponibilă (prag strict).
  perform set_config('request.jwt.claim.sub', '31300000-0000-4000-8000-000000000001', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  v_res := public.create_order(
    '313b0000-0000-4000-8000-000000000001', 'waiter', '313c0000-0000-4000-8000-000000000001', null, null,
    '[{"product_id":"313d0000-0000-4000-8000-000000000001","quantity":4}]'::jsonb,
    null, null, null, null, null);
  v_oid := (v_res->>'id')::uuid;
  update public.orders set status = 'closed' where id = v_oid;
  if (select current_stock from public.ingredients where id = '313e0000-0000-4000-8000-000000000001') <> 2 then
    raise exception 'SO1 FAIL (fixtură): deducerea 250/252 trebuia să lase 2 kg';
  end if;
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000001') <> 'false/-' then
    raise exception 'SO1 FAIL: stoc == porție (2 kg / 2 kg) trebuie să rămână disponibil (prag STRICT), e %',
      pg_temp.so_state('313d0000-0000-4000-8000-000000000001');
  end if;

  -- Încă o pâine vândută: 2 - 2 = 0 < 2 → epuizată din stoc. Clătita (1 kg) la
  -- fel: 0 < 1. Încasarea NU e oprită de recalculare.
  v_res := public.create_order(
    '313b0000-0000-4000-8000-000000000001', 'waiter', '313c0000-0000-4000-8000-000000000001', null, null,
    '[{"product_id":"313d0000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
    null, null, null, null, null);
  update public.orders set status = 'closed' where id = (v_res->>'id')::uuid;
  if (select status from public.orders where id = (v_res->>'id')::uuid) <> 'closed' then
    raise exception 'SO1 FAIL: comanda nu s-a închis';
  end if;
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000001') <> 'true/stock'
     or pg_temp.so_state('313d0000-0000-4000-8000-000000000002') <> 'true/stock' then
    raise exception 'SO1 FAIL: stoc 0 kg sub porție → trebuia true/stock; pâine %, clătită %',
      pg_temp.so_state('313d0000-0000-4000-8000-000000000001'), pg_temp.so_state('313d0000-0000-4000-8000-000000000002');
  end if;
  -- Produsul fără rețetă nu e atins.
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000003') <> 'false/-' then
    raise exception 'SO1 FAIL: produsul fără rețetă a fost atins: %', pg_temp.so_state('313d0000-0000-4000-8000-000000000003');
  end if;

  -- Gate-ul `stocks`: R3 e pe free. Ingredientele lui nu se mai pot scrie
  -- (trg_stocks_gate_ingredients, mig 142), dar o rețetă se poate: o porție de
  -- 20 kg peste stocul de 10 NU epuizează nimic pe un local fără Gestiune.
  update public.recipes set quantity = 20
   where product_id = '313d0000-0000-4000-8000-000000000004';
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000004') <> 'false/-' then
    raise exception 'SO1 FAIL: local fără Gestiune (stocks) epuizat din stoc: %', pg_temp.so_state('313d0000-0000-4000-8000-000000000004');
  end if;
  -- Control pozitiv al gate-ului: același local, urcat pe growth → epuizat.
  update public.profiles set plan = 'growth' where id = '31300000-0000-4000-8000-000000000005';
  update public.recipes set quantity = 21
   where product_id = '313d0000-0000-4000-8000-000000000004';
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000004') <> 'true/stock' then
    raise exception 'SO1 FAIL (control gate): pe growth produsul trebuia true/stock, e %', pg_temp.so_state('313d0000-0000-4000-8000-000000000004');
  end if;
  raise notice 'SO1 OK: sub porție → true/stock (vânzare reală, prag strict, gate stocks)';
end $$;

-- ── SO2: stoc refăcut → revine singur (doar sursa stoc) ─────────────────────
do $$
begin
  -- NIR / ajustare: 0 → 1 kg. Clătita (porție 1) revine, pâinea (porție 2) nu.
  update public.ingredients set current_stock = 1 where id = '313e0000-0000-4000-8000-000000000001';
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000002') <> 'false/-' then
    raise exception 'SO2 FAIL: clătita trebuia să revină (1 kg ≥ porția 1), e %', pg_temp.so_state('313d0000-0000-4000-8000-000000000002');
  end if;
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000001') <> 'true/stock' then
    raise exception 'SO2 FAIL (control): pâinea (porție 2) trebuia să rămână true/stock la 1 kg, e %', pg_temp.so_state('313d0000-0000-4000-8000-000000000001');
  end if;

  -- Ștergerea rețetei eliberează produsul (fără rețetă nu există „sub porție”).
  delete from public.recipes
   where product_id = '313d0000-0000-4000-8000-000000000004' and ingredient_id = '313e0000-0000-4000-8000-000000000003';
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000004') <> 'false/-' then
    raise exception 'SO2 FAIL: rețeta ștearsă trebuia să elibereze produsul, e %', pg_temp.so_state('313d0000-0000-4000-8000-000000000004');
  end if;
  -- Reinserarea rețetei (porție 21 > stocul de 10) îl epuizează iar (trigger INSERT).
  insert into public.recipes (product_id, ingredient_id, quantity)
  values ('313d0000-0000-4000-8000-000000000004', '313e0000-0000-4000-8000-000000000003', 21);
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000004') <> 'true/stock' then
    raise exception 'SO2 FAIL: rețeta nouă sub porție trebuia true/stock, e %', pg_temp.so_state('313d0000-0000-4000-8000-000000000004');
  end if;
  raise notice 'SO2 OK: stocul refăcut / rețeta ștearsă eliberează produsul';
end $$;

-- ── SO3: manualul nu e șters de stoc; deblocarea ține; re-armarea ───────────
do $$
declare v_err text;
begin
  -- (a) Ospătarul deblochează pâinea (stoc 1 < 2): rămâne disponibilă, 'manual'.
  v_err := pg_temp.so_call('authenticated', '31300000-0000-4000-8000-000000000003',
    $q$select public.set_product_sold_out('313d0000-0000-4000-8000-000000000001', false)$q$);
  if v_err is not null then raise exception 'SO3 FAIL: deblocarea ospătarului a picat: %', v_err; end if;
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000001') <> 'false/manual' then
    raise exception 'SO3 FAIL: deblocat sub porție trebuia false/manual, e %', pg_temp.so_state('313d0000-0000-4000-8000-000000000001');
  end if;
  -- Următoarea SCĂDERE (1 → 0.5): deblocarea ține.
  update public.ingredients set current_stock = 0.5 where id = '313e0000-0000-4000-8000-000000000001';
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000001') <> 'false/manual' then
    raise exception 'SO3 FAIL: la scăderea de după deblocare pâinea trebuia să rămână false/manual, e %',
      pg_temp.so_state('313d0000-0000-4000-8000-000000000001');
  end if;
  -- Stocul refăcut (NIR, 20 kg) re-armează regula…
  update public.ingredients set current_stock = 20 where id = '313e0000-0000-4000-8000-000000000001';
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000001') <> 'false/-' then
    raise exception 'SO3 FAIL: stocul refăcut trebuia să re-armeze regula (false/-), e %', pg_temp.so_state('313d0000-0000-4000-8000-000000000001');
  end if;
  -- …iar o nouă scădere sub porție îl epuizează din nou.
  update public.ingredients set current_stock = 1 where id = '313e0000-0000-4000-8000-000000000001';
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000001') <> 'true/stock' then
    raise exception 'SO3 FAIL: după re-armare scăderea trebuia true/stock, e %', pg_temp.so_state('313d0000-0000-4000-8000-000000000001');
  end if;

  -- (b) Bucătarul blochează MANUAL clătita (stoc 1 = porția → disponibilă).
  v_err := pg_temp.so_call('authenticated', '31300000-0000-4000-8000-000000000004',
    $q$select public.set_product_sold_out('313d0000-0000-4000-8000-000000000002', true)$q$);
  if v_err is not null then raise exception 'SO3 FAIL: blocarea bucătarului a picat: %', v_err; end if;
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000002') <> 'true/manual' then
    raise exception 'SO3 FAIL: blocat manual trebuia true/manual, e %', pg_temp.so_state('313d0000-0000-4000-8000-000000000002');
  end if;
  -- Lipsă (0) apoi refacere (50): manualul rămâne neatins în ambele sensuri.
  update public.ingredients set current_stock = 0 where id = '313e0000-0000-4000-8000-000000000001';
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000002') <> 'true/manual' then
    raise exception 'SO3 FAIL: lipsa a rescris manualul în %', pg_temp.so_state('313d0000-0000-4000-8000-000000000002');
  end if;
  update public.ingredients set current_stock = 50 where id = '313e0000-0000-4000-8000-000000000001';
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000002') <> 'true/manual' then
    raise exception 'SO3 FAIL: refacerea stocului a șters epuizarea MANUALĂ: %', pg_temp.so_state('313d0000-0000-4000-8000-000000000002');
  end if;
  -- Control: pâinea (sursa stoc) a revenit la aceeași refacere.
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000001') <> 'false/-' then
    raise exception 'SO3 FAIL (control): pâinea (stoc) trebuia să revină la 50 kg, e %', pg_temp.so_state('313d0000-0000-4000-8000-000000000001');
  end if;

  -- (c) PATCH direct al adminului (clientul vechi / formularul): fără sursă →
  -- normalizat la 'manual', iar stocul nu-l mai atinge.
  update public.ingredients set current_stock = 0 where id = '313e0000-0000-4000-8000-000000000001';
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000001') <> 'true/stock' then
    raise exception 'SO3 FAIL (fixtură): pâinea trebuia true/stock la 0 kg';
  end if;
  update public.products set is_sold_out = false where id = '313d0000-0000-4000-8000-000000000001';
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000001') <> 'false/manual' then
    raise exception 'SO3 FAIL: PATCH-ul direct de deblocare sub porție trebuia normalizat la false/manual, e %',
      pg_temp.so_state('313d0000-0000-4000-8000-000000000001');
  end if;
  update public.products set is_sold_out = true where id = '313d0000-0000-4000-8000-000000000003';
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000003') <> 'true/manual' then
    raise exception 'SO3 FAIL: PATCH-ul direct de blocare trebuia normalizat la true/manual, e %', pg_temp.so_state('313d0000-0000-4000-8000-000000000003');
  end if;
  update public.products set is_sold_out = false where id = '313d0000-0000-4000-8000-000000000003';
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000003') <> 'false/-' then
    raise exception 'SO3 FAIL: deblocarea directă cu stoc OK (fără rețetă) trebuia false/-, e %', pg_temp.so_state('313d0000-0000-4000-8000-000000000003');
  end if;
  raise notice 'SO3 OK: manualul rezistă stocului; deblocarea ține; refacerea re-armează; PATCH-ul direct e normalizat';
end $$;

-- ── SO4: RPC-ul — membri DA, străin NU, anon NU ──────────────────────────────
do $$
declare v_strange text; v_ghost text; v_anon text; v jsonb;
begin
  -- Control pozitiv: ospătarul și bucătarul pot (sub rolul REAL authenticated).
  if pg_temp.so_call('authenticated', '31300000-0000-4000-8000-000000000003',
       $q$select public.set_product_sold_out('313d0000-0000-4000-8000-000000000003', true)$q$) is not null
     or pg_temp.so_state('313d0000-0000-4000-8000-000000000003') <> 'true/manual' then
    raise exception 'SO4 FAIL (control): ospătarul trebuia să poată bloca produsul';
  end if;
  if pg_temp.so_call('authenticated', '31300000-0000-4000-8000-000000000004',
       $q$select public.set_product_sold_out('313d0000-0000-4000-8000-000000000003', false)$q$) is not null
     or pg_temp.so_state('313d0000-0000-4000-8000-000000000003') <> 'false/-' then
    raise exception 'SO4 FAIL (control): bucătarul trebuia să poată debloca produsul';
  end if;

  -- Străinul (owner-ul lui R2) pe un produs al lui R1.
  v_strange := pg_temp.so_call('authenticated', '31300000-0000-4000-8000-000000000002',
    $q$select public.set_product_sold_out('313d0000-0000-4000-8000-000000000003', true)$q$);
  if v_strange is null or split_part(v_strange, '|', 1) <> '42501' or split_part(v_strange, '|', 2) <> 'not_member' then
    raise exception 'SO4 FAIL: străinul trebuia respins cu 42501/not_member, a dat %', coalesce(v_strange, 'TRECUT');
  end if;
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000003') <> 'false/-' then
    raise exception 'SO4 FAIL: refuzul străinului a lăsat urme: %', pg_temp.so_state('313d0000-0000-4000-8000-000000000003');
  end if;
  -- Anti-oracol: id inexistent → EXACT aceeași eroare.
  v_ghost := pg_temp.so_call('authenticated', '31300000-0000-4000-8000-000000000002',
    $q$select public.set_product_sold_out('313d0000-0000-4000-8000-0000000000ff', true)$q$);
  if v_ghost is distinct from v_strange then
    raise exception 'SO4 FAIL: „inexistent” (%) ≠ „străin” (%) — oracol de existență', v_ghost, v_strange;
  end if;

  -- anon: pică pe ACL-ul FUNCȚIEI (nu pe schemă, nu în corp).
  v_anon := pg_temp.so_call('anon', null,
    $q$select public.set_product_sold_out('313d0000-0000-4000-8000-000000000003', true)$q$);
  if v_anon is null or split_part(v_anon, '|', 1) <> '42501' or v_anon not like '%for function%' then
    raise exception 'SO4 FAIL: anon trebuia respins pe ACL-ul funcției, a dat %', coalesce(v_anon, 'TRECUT');
  end if;

  -- Forma răspunsului.
  perform set_config('request.jwt.claim.sub', '31300000-0000-4000-8000-000000000001', true);
  v := public.set_product_sold_out('313d0000-0000-4000-8000-000000000003', true);
  if v is distinct from jsonb_build_object('ok', true, 'product_id', '313d0000-0000-4000-8000-000000000003',
                                           'is_sold_out', true, 'sold_out_source', 'manual') then
    raise exception 'SO4 FAIL: forma răspunsului: %', v;
  end if;
  perform public.set_product_sold_out('313d0000-0000-4000-8000-000000000003', false);
  perform set_config('request.jwt.claim.sub', '', true);
  raise notice 'SO4 OK: membri DA, străin/inexistent NU (aceeași eroare), anon NU';
end $$;

-- ── SO5: create_order respinge produsul epuizat ──────────────────────────────
do $$
declare v_hint text; v_res jsonb;
begin
  perform set_config('request.jwt.claim.sub', '31300000-0000-4000-8000-000000000001', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  -- Control: Apa (P3) disponibilă trece.
  v_res := public.create_order(
    '313b0000-0000-4000-8000-000000000001', 'waiter', '313c0000-0000-4000-8000-000000000001', null, null,
    '[{"product_id":"313d0000-0000-4000-8000-000000000003","quantity":1}]'::jsonb,
    null, null, null, null, null);
  if v_res->>'id' is null then raise exception 'SO5 FAIL (control): comanda cu produs disponibil n-a trecut'; end if;

  perform public.set_product_sold_out('313d0000-0000-4000-8000-000000000003', true);
  v_hint := null;
  begin
    perform public.create_order(
      '313b0000-0000-4000-8000-000000000001', 'waiter', '313c0000-0000-4000-8000-000000000001', null, null,
      '[{"product_id":"313d0000-0000-4000-8000-000000000003","quantity":1}]'::jsonb,
      null, null, null, null, null);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'product_sold_out' then
    raise exception 'SO5 FAIL: create_order cu produs epuizat trebuia respins cu product_sold_out, hint=%', coalesce(v_hint, 'TRECUT');
  end if;
  perform public.set_product_sold_out('313d0000-0000-4000-8000-000000000003', false);
  raise notice 'SO5 OK: create_order respinge product_sold_out';
end $$;

-- ── SO6: update_order_items păstrează cantitatea deja comandată ─────────────
do $$
declare v_res jsonb; v_oid uuid; v_hint text; v_total numeric; v_n int;
begin
  perform set_config('request.jwt.claim.sub', '31300000-0000-4000-8000-000000000001', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  -- Comandă: 2 × Supă (P5) + 1 × Apă (P3) = 35.
  v_res := public.create_order(
    '313b0000-0000-4000-8000-000000000001', 'waiter', '313c0000-0000-4000-8000-000000000001', null, null,
    '[{"product_id":"313d0000-0000-4000-8000-000000000005","quantity":2},
      {"product_id":"313d0000-0000-4000-8000-000000000003","quantity":1}]'::jsonb,
    null, null, null, null, null);
  v_oid := (v_res->>'id')::uuid;

  -- Supa se epuizează între timp (legume 10 → 0.2 < 1).
  update public.ingredients set current_stock = 0.2 where id = '313e0000-0000-4000-8000-000000000005';
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000005') <> 'true/stock' then
    raise exception 'SO6 FAIL (fixtură): supa trebuia epuizată, e %', pg_temp.so_state('313d0000-0000-4000-8000-000000000005');
  end if;

  -- (a) Editare care PĂSTREAZĂ supa (2) și crește apa → trece.
  perform public.update_order_items(v_oid,
    '[{"product_id":"313d0000-0000-4000-8000-000000000005","quantity":2},
      {"product_id":"313d0000-0000-4000-8000-000000000003","quantity":3}]'::jsonb, null);
  select total into v_total from public.orders where id = v_oid;
  if v_total is distinct from 45.00 then
    raise exception 'SO6 FAIL: editarea care păstrează supa epuizată trebuia să treacă cu total 45, e %', v_total;
  end if;
  -- Și o împărțire pe două linii a aceleiași cantități (1 + 1) trece. Supa e
  -- ULTIMA linie deliberat: GUC-ul de păstrare e setat pe ea, deci (d) vede
  -- dacă RPC-ul uită să-l golească după ultimul INSERT.
  perform public.update_order_items(v_oid,
    '[{"product_id":"313d0000-0000-4000-8000-000000000003","quantity":3},
      {"product_id":"313d0000-0000-4000-8000-000000000005","quantity":1},
      {"product_id":"313d0000-0000-4000-8000-000000000005","quantity":1,"notes":"fără sare"}]'::jsonb, null);

  -- (b) Creșterea supei (2 → 3, pe linii separate 2 + 1) → respinsă, comanda neatinsă.
  v_hint := null;
  begin
    perform public.update_order_items(v_oid,
      '[{"product_id":"313d0000-0000-4000-8000-000000000005","quantity":2},
        {"product_id":"313d0000-0000-4000-8000-000000000005","quantity":1},
        {"product_id":"313d0000-0000-4000-8000-000000000003","quantity":3}]'::jsonb, null);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'product_sold_out' then
    raise exception 'SO6 FAIL: creșterea cantității unui produs epuizat trebuia product_sold_out, hint=%', coalesce(v_hint, 'TRECUT');
  end if;
  select total into v_total from public.orders where id = v_oid;
  select coalesce(sum(quantity), 0) into v_n from public.order_items
   where order_id = v_oid and product_id = '313d0000-0000-4000-8000-000000000005';
  if v_total is distinct from 45.00 or v_n <> 2 then
    raise exception 'SO6 FAIL: refuzul a lăsat comanda modificată (total %, supe %)', v_total, v_n;
  end if;

  -- (c) Un produs epuizat NOU pe comandă (clătita, manual din SO3) → respins.
  v_hint := null;
  begin
    perform public.update_order_items(v_oid,
      '[{"product_id":"313d0000-0000-4000-8000-000000000005","quantity":2},
        {"product_id":"313d0000-0000-4000-8000-000000000002","quantity":1}]'::jsonb, null);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'product_sold_out' then
    raise exception 'SO6 FAIL: adăugarea unui produs epuizat nou trebuia product_sold_out, hint=%', coalesce(v_hint, 'TRECUT');
  end if;

  -- (d) GUC-ul de păstrare e GOL după RPC: un INSERT direct al aceleiași
  -- comenzi cu supa epuizată, în aceeași tranzacție, e respins de trigger-ul 130.
  if coalesce(current_setting('menuvia.sold_out_keep_order', true), '') <> '' then
    raise exception 'SO6 FAIL: menuvia.sold_out_keep_order a rămas setat după RPC: %', current_setting('menuvia.sold_out_keep_order', true);
  end if;
  v_hint := null;
  begin
    insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
    values (v_oid, '313d0000-0000-4000-8000-000000000005', 'SO Supă', 1, 15, 15);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'product_sold_out' then
    raise exception 'SO6 FAIL: INSERT direct după RPC trebuia respins de trigger-ul 130, hint=%', coalesce(v_hint, 'TRECUT');
  end if;
  raise notice 'SO6 OK: cantitatea deja comandată se păstrează; creșterea / produsul nou epuizat sunt respinse';
end $$;

-- ── SO7: catalog ─────────────────────────────────────────────────────────────
do $$
declare v_fn text; v_n int;
begin
  select count(*) into v_n
    from pg_trigger t
   where not t.tgisinternal
     and (t.tgrelid, t.tgname) in (('public.ingredients'::regclass, 'trg_ingredients_sold_out_upd'),
                                   ('public.recipes'::regclass, 'trg_recipes_sold_out_ins'),
                                   ('public.recipes'::regclass, 'trg_recipes_sold_out_upd'),
                                   ('public.recipes'::regclass, 'trg_recipes_sold_out_del'))
     and (t.tgtype & 1) = 0
     and (t.tgoldtable is not null or t.tgnewtable is not null);
  if v_n <> 4 then
    raise exception 'SO7 FAIL: aștept 4 triggere de stoc FOR EACH STATEMENT cu transition tables, găsit %', v_n;
  end if;
  -- Normalizarea e BEFORE ROW pe products (tgtype: ROW 1 + BEFORE 2 + INSERT 4 + UPDATE 16 = 23).
  if not exists (select 1 from pg_trigger where tgrelid = 'public.products'::regclass
                    and tgname = 'trg_products_sold_out_normalize' and tgtype = 23) then
    raise exception 'SO7 FAIL: trg_products_sold_out_normalize lipsește sau nu e BEFORE INSERT OR UPDATE ROW';
  end if;

  foreach v_fn in array array['public.product_stock_short(uuid)', 'public.recalc_products_sold_out(uuid[])',
                              'public.normalize_product_sold_out()', 'public.ingredients_sold_out_stmt()',
                              'public.recipes_sold_out_stmt()', 'public.reject_unavailable_order_item()',
                              'public.set_product_sold_out(uuid,boolean)', 'public.get_menu_version(uuid)'] loop
    if not exists (select 1 from pg_proc where oid = v_fn::regprocedure and prosecdef
                     and array_to_string(proconfig, ',') like '%search_path=public, pg_temp%') then
      raise exception 'SO7 FAIL: % nu e DEFINER cu search_path = public, pg_temp', v_fn;
    end if;
  end loop;
  foreach v_fn in array array['public.product_stock_short(uuid)', 'public.recalc_products_sold_out(uuid[])',
                              'public.normalize_product_sold_out()', 'public.ingredients_sold_out_stmt()',
                              'public.recipes_sold_out_stmt()', 'public.reject_unavailable_order_item()'] loop
    if has_function_privilege('anon', v_fn::regprocedure, 'execute')
       or has_function_privilege('authenticated', v_fn::regprocedure, 'execute') then
      raise exception 'SO7 FAIL: % e executabilă de anon/authenticated (RP13 / helper intern)', v_fn;
    end if;
  end loop;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
        and proname in ('set_product_sold_out', 'get_menu_version', 'update_order_items')) <> 3 then
    raise exception 'SO7 FAIL: set_product_sold_out / get_menu_version / update_order_items trebuie să aibă câte O semnătură';
  end if;
  if has_function_privilege('anon', 'public.set_product_sold_out(uuid,boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.set_product_sold_out(uuid,boolean)', 'execute') then
    raise exception 'SO7 FAIL: set_product_sold_out trebuie să fie DOAR pentru authenticated';
  end if;

  -- Amânarea: golirea e constraint trigger DEFERRABLE INITIALLY DEFERRED,
  -- AFTER INSERT ROW (1 + 4 = 5) pe coadă; semnalul NU recalculează.
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.products_sold_out_queue'::regclass
                    and tgname = 'trg_products_sold_out_queue_flush'
                    and tgconstraint <> 0 and tgdeferrable and tginitdeferred and tgtype = 5) then
    raise exception 'SO7 FAIL: trg_products_sold_out_queue_flush nu e constraint trigger DEFERRABLE INITIALLY DEFERRED (AFTER INSERT ROW)';
  end if;
  foreach v_fn in array array['public.ingredients_sold_out_stmt()', 'public.recipes_sold_out_stmt()'] loop
    if position('recalc_products_sold_out' in (select prosrc from pg_proc where oid = v_fn::regprocedure)) > 0 then
      raise exception 'SO7 FAIL: % recalculează în statement (trebuie doar să pună în coadă)', v_fn;
    end if;
  end loop;
  if position('skip locked' in (select prosrc from pg_proc where oid = 'public.recalc_products_sold_out(uuid[])'::regprocedure)) = 0
     or position('order by p.id' in (select prosrc from pg_proc where oid = 'public.recalc_products_sold_out(uuid[])'::regprocedure)) = 0 then
    raise exception 'SO7 FAIL: recalc_products_sold_out fără lock ordonat `order by p.id … skip locked`';
  end if;
  if not exists (select 1 from pg_proc where oid = 'public.flush_products_sold_out_queue()'::regprocedure and prosecdef
                   and array_to_string(proconfig, ',') like '%search_path=public, pg_temp%')
     or has_function_privilege('anon', 'public.flush_products_sold_out_queue()', 'execute')
     or has_function_privilege('authenticated', 'public.flush_products_sold_out_queue()', 'execute') then
    raise exception 'SO7 FAIL: flush_products_sold_out_queue trebuie DEFINER + pg_temp, fără EXECUTE pentru clienți';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.products_sold_out_queue'::regclass)
     or has_table_privilege('authenticated', 'public.products_sold_out_queue', 'select,insert,update,delete,truncate')
     or has_table_privilege('anon', 'public.products_sold_out_queue', 'select,insert,update,delete,truncate')
     or exists (select 1 from pg_policy where polrelid = 'public.products_sold_out_queue'::regclass) then
    raise exception 'SO7 FAIL: products_sold_out_queue trebuie deny-all (RLS fără politici, fără privilegii client)';
  end if;
  raise notice 'SO7 OK: semnal statement-level, golire amânată la commit, lock ordonat, DEFINER + pg_temp, fără acces client';
end $$;

-- ── SO8: sonda de versiune ───────────────────────────────────────────────────
do $$
declare v1 text; v2 text; v3 text; v4 text; v_anon text; v_err text;
begin
  v1 := public.get_menu_version('313b0000-0000-4000-8000-000000000001');
  v2 := public.get_menu_version('313b0000-0000-4000-8000-000000000001');
  if v1 is null or v1 is distinct from v2 then
    raise exception 'SO8 FAIL (control): fără schimbări versiunea trebuia stabilă și ne-NULL (%, %)', v1, v2;
  end if;

  -- Epuizarea (în aceeași tranzacție: updated_at = now() e înghețat, deci
  -- schimbarea trebuie să vină din is_sold_out din hash).
  perform set_config('request.jwt.claim.sub', '31300000-0000-4000-8000-000000000001', true);
  perform public.set_product_sold_out('313d0000-0000-4000-8000-000000000003', true);
  v3 := public.get_menu_version('313b0000-0000-4000-8000-000000000001');
  if v3 is not distinct from v2 then
    raise exception 'SO8 FAIL: epuizarea nu a schimbat versiunea';
  end if;
  perform public.set_product_sold_out('313d0000-0000-4000-8000-000000000003', false);
  -- Editare de categorie (nume).
  insert into public.categories (id, restaurant_id, name, display_order)
  values ('313f0000-0000-4000-8000-000000000001', '313b0000-0000-4000-8000-000000000001', 'SO Ciorbe', 1);
  v4 := public.get_menu_version('313b0000-0000-4000-8000-000000000001');
  update public.categories set name = 'SO Supe' where id = '313f0000-0000-4000-8000-000000000001';
  if public.get_menu_version('313b0000-0000-4000-8000-000000000001') is not distinct from v4 then
    raise exception 'SO8 FAIL: redenumirea unei categorii nu a schimbat versiunea';
  end if;
  -- Alt restaurant are altă versiune; restaurantul inexistent / inactiv → NULL.
  if public.get_menu_version('313b0000-0000-4000-8000-000000000002') is not distinct from v1 then
    raise exception 'SO8 FAIL: două restaurante diferite au aceeași versiune';
  end if;
  if public.get_menu_version('313b0000-0000-4000-8000-0000000000ff') is not null
     or public.get_menu_version(null) is not null then
    raise exception 'SO8 FAIL: restaurant inexistent / NULL trebuia NULL';
  end if;
  update public.restaurants set is_active = false where id = '313b0000-0000-4000-8000-000000000002';
  if public.get_menu_version('313b0000-0000-4000-8000-000000000002') is not null then
    raise exception 'SO8 FAIL: restaurant inactiv trebuia NULL';
  end if;

  -- anon o poate apela (apel REAL sub rol).
  v_err := pg_temp.so_call('anon', null,
    $q$select public.get_menu_version('313b0000-0000-4000-8000-000000000001')$q$);
  if v_err is not null then raise exception 'SO8 FAIL: anon nu poate apela sonda: %', v_err; end if;
  raise notice 'SO8 OK: versiunea se schimbă la epuizare / editare, e stabilă altfel, NULL pe inactiv';
end $$;

-- ── SO9: recalcularea e AMÂNATĂ la commit; semnalul doar pe traversare ──────
-- Modul REAL: constraint trigger-ul de golire amânat (ca pe producție).
set constraints public.trg_products_sold_out_queue_flush deferred;

do $$
declare v_res jsonb; v_q int;
begin
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000006') <> 'false/-' then
    raise exception 'SO9 FAIL (fixtură): ciorba trebuia disponibilă, e %', pg_temp.so_state('313d0000-0000-4000-8000-000000000006');
  end if;

  -- (a) Scădere FĂRĂ traversare (10 → 8 kg, porția 1 kg): nimic în coadă.
  update public.ingredients set current_stock = 8 where id = '313e0000-0000-4000-8000-000000000006';
  select count(*) into v_q from public.products_sold_out_queue where tx_id = txid_current();
  if v_q <> 0 then
    raise exception 'SO9 FAIL: o scădere care NU traversează pragul a pus % produse în coadă', v_q;
  end if;

  -- (b) Vânzare REALĂ care traversează pragul: 8 ciorbe → 0 kg.
  perform set_config('request.jwt.claim.sub', '31300000-0000-4000-8000-000000000001', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  v_res := public.create_order(
    '313b0000-0000-4000-8000-000000000001', 'waiter', '313c0000-0000-4000-8000-000000000001', null, null,
    '[{"product_id":"313d0000-0000-4000-8000-000000000006","quantity":8}]'::jsonb,
    null, null, null, null, null);
  update public.orders set status = 'closed' where id = (v_res->>'id')::uuid;
  if (select current_stock from public.ingredients where id = '313e0000-0000-4000-8000-000000000006') <> 0 then
    raise exception 'SO9 FAIL (fixtură): deducerea trebuia să lase 0 kg de carne';
  end if;
  if not exists (select 1 from public.products_sold_out_queue
                  where tx_id = txid_current() and product_id = '313d0000-0000-4000-8000-000000000006') then
    raise exception 'SO9 FAIL: traversarea pragului nu a pus ciorba în coadă';
  end if;
  -- Înainte de commit produsul e NEATINS: nimic nu s-a recalculat (deci niciun
  -- lock pe products) în mijlocul buclei de deducere.
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000006') <> 'false/-' then
    raise exception 'SO9 FAIL: ciorba a fost recalculată ÎN statement (înainte de commit): %',
      pg_temp.so_state('313d0000-0000-4000-8000-000000000006');
  end if;
end $$;

-- „Commit-ul”: evenimentele amânate se declanșează acum.
set constraints public.trg_products_sold_out_queue_flush immediate;

do $$
begin
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000006') <> 'true/stock' then
    raise exception 'SO9 FAIL: la commit ciorba trebuia true/stock, e %', pg_temp.so_state('313d0000-0000-4000-8000-000000000006');
  end if;
  if exists (select 1 from public.products_sold_out_queue where tx_id = txid_current()) then
    raise exception 'SO9 FAIL: coada nu s-a golit la commit';
  end if;
  -- Refacere (mod imediat) pentru SO10: 0 → 10 kg, ciorba revine.
  update public.ingredients set current_stock = 10 where id = '313e0000-0000-4000-8000-000000000006';
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000006') <> 'false/-' then
    raise exception 'SO9 FAIL (fixtură SO10): ciorba trebuia să revină la 10 kg, e %', pg_temp.so_state('313d0000-0000-4000-8000-000000000006');
  end if;
  raise notice 'SO9 OK: fără traversare nimic în coadă; traversarea așteaptă commit-ul; la commit true/stock, coada goală';
end $$;

-- ── SO10: o recalculare care aruncă nu oprește commit-ul încasării ──────────
create function public.so313_boom() returns trigger
language plpgsql as $f$
begin
  raise exception 'SO10: recalculare sabotată';
end $f$;
create trigger so313_boom
  before update on public.products
  for each row when (new.id = '313d0000-0000-4000-8000-000000000006'::uuid)
  execute function public.so313_boom();

set constraints public.trg_products_sold_out_queue_flush deferred;

do $$
declare v_res jsonb; v_oid uuid;
begin
  -- Control: sabotajul chiar aruncă pe ciorbă.
  begin
    update public.products set name = name where id = '313d0000-0000-4000-8000-000000000006';
    raise exception 'SO10 FAIL (control): triggerul de sabotaj nu a aruncat';
  exception when raise_exception then
    if sqlerrm not like 'SO10: recalculare sabotată%' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', '31300000-0000-4000-8000-000000000001', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  v_res := public.create_order(
    '313b0000-0000-4000-8000-000000000001', 'waiter', '313c0000-0000-4000-8000-000000000001', null, null,
    '[{"product_id":"313d0000-0000-4000-8000-000000000006","quantity":10}]'::jsonb,
    null, null, null, null, null);
  v_oid := (v_res->>'id')::uuid;
  update public.orders set status = 'closed' where id = v_oid;

  -- „Commit-ul”: golirea + recalcularea (care aruncă) rulează acum.
  begin
    set constraints public.trg_products_sold_out_queue_flush immediate;
  exception when others then
    raise exception 'SO10 FAIL: o recalculare eșuată a oprit commit-ul încasării: %', sqlerrm;
  end;

  if (select status from public.orders where id = v_oid) <> 'closed' then
    raise exception 'SO10 FAIL: comanda nu s-a închis';
  end if;
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000006') <> 'false/-' then
    raise exception 'SO10 FAIL: recalcularea sabotată trebuia derulată (ciorba neatinsă), e %',
      pg_temp.so_state('313d0000-0000-4000-8000-000000000006');
  end if;
  if exists (select 1 from public.products_sold_out_queue where tx_id = txid_current()) then
    raise exception 'SO10 FAIL: eșecul recalculării a lăsat rânduri orfane în coadă';
  end if;
  raise notice 'SO10 OK: recalcularea care aruncă la commit e absorbită; comanda închisă, coada goală';
end $$;

drop trigger so313_boom on public.products;
drop function public.so313_boom();

-- ── SO11: partenerul cu acces acordat DA, după revocare NU (aceeași eroare) ──
do $$
declare v_err text; v_strange text;
begin
  v_err := pg_temp.so_call('authenticated', '31300000-0000-4000-8000-000000000006',
    $q$select public.set_product_sold_out('313d0000-0000-4000-8000-000000000003', true)$q$);
  if v_err is not null or pg_temp.so_state('313d0000-0000-4000-8000-000000000003') <> 'true/manual' then
    raise exception 'SO11 FAIL: partenerul cu acces acordat trebuia să poată bloca produsul (%, %)',
      coalesce(v_err, 'trecut'), pg_temp.so_state('313d0000-0000-4000-8000-000000000003');
  end if;
  v_err := pg_temp.so_call('authenticated', '31300000-0000-4000-8000-000000000006',
    $q$select public.set_product_sold_out('313d0000-0000-4000-8000-000000000003', false)$q$);
  if v_err is not null or pg_temp.so_state('313d0000-0000-4000-8000-000000000003') <> 'false/-' then
    raise exception 'SO11 FAIL: partenerul cu acces acordat trebuia să poată debloca produsul (%)', coalesce(v_err, 'trecut');
  end if;

  -- Owner-ul revocă accesul: partenerul devine un străin oarecare.
  update public.affiliate_attributions set partner_access_revoked_at = now()
   where id = '313a0000-0000-4000-8000-0000000000a1';
  v_err := pg_temp.so_call('authenticated', '31300000-0000-4000-8000-000000000006',
    $q$select public.set_product_sold_out('313d0000-0000-4000-8000-000000000003', true)$q$);
  v_strange := pg_temp.so_call('authenticated', '31300000-0000-4000-8000-000000000002',
    $q$select public.set_product_sold_out('313d0000-0000-4000-8000-000000000003', true)$q$);
  if v_err is null or split_part(v_err, '|', 2) <> 'not_member' or v_err is distinct from v_strange then
    raise exception 'SO11 FAIL: partenerul revocat trebuia respins EXACT ca străinul (% vs %)',
      coalesce(v_err, 'TRECUT'), coalesce(v_strange, 'TRECUT');
  end if;
  if pg_temp.so_state('313d0000-0000-4000-8000-000000000003') <> 'false/-' then
    raise exception 'SO11 FAIL: refuzul partenerului revocat a lăsat urme: %', pg_temp.so_state('313d0000-0000-4000-8000-000000000003');
  end if;
  raise notice 'SO11 OK: partenerul cu acces acordat DA; revocat → aceeași eroare ca străinul';
end $$;

rollback;
