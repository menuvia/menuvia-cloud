-- tests/sql/auto/329_kitchen_ticket_language.sql
-- =============================================================================
-- KL0–KL9 — clichetul PERMANENT al mig 329 (lotul L8c): tichetul de bucătărie
-- în limba de bază a localului (`restaurants.language`, 7 limbi) și pe fusul
-- lui (`restaurant_time_zone`, 324). Rulează din tests/sql/auto/
-- (scripts/run-sql-auto.sh) pe AMBELE medii; autonom, ROLLBACK la final.
--
-- ORACOLUL: `pg_temp.kt316_payload` e corpul mig 316 copiat BYTE cu BYTE
-- (md5 înghețat de KL0 — oracolul nu se „repară” ca să egaleze codul nou).
-- Fiecare comandă din fixtură e randată de ambele; o comparație e pe payload-ul
-- ÎNTREG, nu pe fragmente.
--
-- Fixtura: 11 localuri, fiecare cu 5 comenzi pe același instant,
-- 2026-07-15 22:30Z (= 01:30 16.07 la București, 00:30 16.07 la Berlin,
-- 18:30 15.07 la New York — ora ȘI ziua depind de fus):
--   k=1 ospătar cu masă (opțiune, extra, nota liniei, nota comenzii),
--   k=2 ospătar fără masă, k=3 QR cu masă, k=4 QR fără masă („MASA: -”),
--   k=5 ridicare cu notă.
--
--   KL0  oracolul e corpul 316 neatins (md5 al `prosrc`).
--        [PICĂ: orice caracter schimbat în copia 316]
--   KL1  ro + București → BYTE-identic cu 316 pe toate cele 5 comenzi × nou/
--        reprint (10 comparații, toate ramurile exersate: ospătar cu/fără masă,
--        QR cu/fără masă, ridicare, notă, opțiune, extra, nota liniei), plus o
--        așteptare ÎNGHEȚATĂ a payload-ului k=1 (independentă de oracol).
--        [PICĂ: eticheta „NOTE:” românească schimbată; formatul orei
--         („DD/MM” în loc de „DD.MM”)]
--   KL2  limba NULL / necunoscută ('pt', 'RO', șir gol) → rezerva e româna
--        316, byte-identic. CHECK-ul 298 și NOT NULL (038) sunt scoase DOAR
--        în tranzacția testului (ramura e altfel inaccesibilă din date).
--        [PICĂ: rezerva pe engleză, cu `when 'ro'` explicit — KL1 trece, KL2 nu]
--   KL3  de + Europe/Berlin → payload-ul k=1 ÎNGHEȚAT (etichete germane, ora
--        Berlinului 00:30 16.07), fără nicio etichetă românească; anti-
--        vacuitate: oracolul DIFERĂ pe același rând. Separat: de pe fusul
--        Bucureștiului → doar etichetele diferă (ora = a oracolului); ro pe
--        Berlin → payload = oracolul cu ora Berlinului, nimic altceva.
--        [PICĂ: literalul de fus readus; limba ignorată (`case 'ro'`); fusul
--         unui local inexistent (`restaurant_time_zone(null)` = mereu
--         București); corpul 316 (replay fără 329)]
--   KL4  toate cele 7 limbi: fiecare rând de etichetă (antet, sursă, notă) e
--        EXACT cel din tabela înghețată mai jos, pe toate ramurile (80 de
--        payload-uri, numărate).
--        [PICĂ: antetul de retipărire german readus pe „REPRINT”; o etichetă
--         ne-ASCII („ÚJ RENDELÉS”)]
--   KL5  ASCII: fiecare payload, în fiecare limbă, are doar octeți tipăribili
--        ASCII (+ `\n` și separatorul „·” al antetului 316); maghiara (cea mai
--        accentuată dintre cele 7) verificată și pe octeți UTF-8.
--        [PICĂ: o etichetă ne-ASCII, chiar cu tabela KL4 aliniată la ea]
--   KL6  reprint: antetul de retipărire per limbă (7), diferit de antetul nou
--        în fiecare limbă; ora rămâne a comenzii.
--        [PICĂ (verificat și cu KL1–KL5 scoase): reprint-ul pe antetul nou;
--         antetul german de retipărire readus pe „REPRINT”]
--   KL7  fus invalid ('Mars/Olympus') → București, byte-identic cu oracolul;
--        'europe/berlin' (case-insensitive) → numele canonic, ora Berlinului —
--        EXACT ce întoarce `restaurant_time_zone`.
--        [PICĂ: fusul BRUT din `restaurants.timezone` în `at time zone` —
--         „Mars/Olympus” aruncă la randare (prima o vede KL5, care randează
--         toate localurile); la enqueue tichetul s-ar pierde tăcut]
--   KL8  capăt-la-capăt: enqueue (COMMIT forțat) → payload german STOCAT;
--        limba localului trece pe fr; `kitchen_ticket_retry` NU regenerează
--        (payload neschimbat), `kitchen_ticket_reprint` regenerează în limba
--        CURENTĂ (fr), cu ora comenzii.
--        [PICĂ: `kitchen_ticket_retry` care regenerează payload-ul]
--   KL9  catalogul: o semnătură, STABLE SECURITY DEFINER, `public, pg_temp`,
--        fără EXECUTE pentru anon/authenticated/PUBLIC, `extra_name` (316),
--        niciun literal de fus, `restaurant_time_zone(` exact o dată (fără
--        `safe_time_zone(`), același proprietar ca `restaurant_time_zone`.
--        [PICĂ: grant către authenticated; proprietarul lui
--         `restaurant_time_zone` schimbat]
-- =============================================================================

begin;

-- ── Oracolul: corpul mig 316, BYTE cu BYTE ──────────────────────────────────
create function pg_temp.kt316_payload(
  p_order_id uuid,
  p_reprint  boolean default false
) returns text
language plpgsql stable
as $$
declare
  v_order  record;
  v_lines  text;
  v_items  int;
begin
  select o.id, o.source, o.notes, o.created_at,
         coalesce(o._table_name_snapshot, t.name) as table_name
    into v_order
    from public.orders o
    left join public.tables t on t.id = o.table_id
   where o.id = p_order_id;
  if not found then
    raise exception 'build_kitchen_ticket_payload: order % not found', p_order_id;
  end if;

  select count(*),
         string_agg(
           oi.quantity || 'x ' ||
           regexp_replace(oi.product_name_snapshot, '[\r\n\t]', ' ', 'g') ||
           coalesce((
             select string_agg(e'\n   + ' ||
                      regexp_replace(coalesce(m->>'option_name', ''), '[\r\n\t]', ' ', 'g'), '')
               from jsonb_array_elements(coalesce(oi.selected_modifiers, '[]'::jsonb)) m
              where coalesce(m->>'option_name', '') <> ''
           ), '') ||
           coalesce((
             -- mig 316: `extra_name` (forma vie, mig 088+); `name` doar pentru
             -- rândurile scrise înainte de 088.
             select string_agg(e'\n   + ' ||
                      regexp_replace(coalesce(nullif(x->>'extra_name', ''), x->>'name', ''),
                                     '[\r\n\t]', ' ', 'g'), '')
               from jsonb_array_elements(coalesce(oi.extras_added, '[]'::jsonb)) x
              where coalesce(nullif(x->>'extra_name', ''), x->>'name', '') <> ''
           ), '') ||
           case when coalesce(btrim(oi.notes), '') <> ''
                then e'\n   >> ' || regexp_replace(oi.notes, '[\r\n\t]', ' ', 'g')
                else '' end,
           e'\n' order by oi.created_at
         )
    into v_items, v_lines
    from public.order_items oi
   where oi.order_id = p_order_id;

  if coalesce(v_items, 0) = 0 then
    raise exception 'build_kitchen_ticket_payload: order % has no items', p_order_id;
  end if;

  return case when p_reprint then '*** REPRINT ***' else '*** COMANDA NOUA ***' end
    || e'\n'
    || case v_order.source
         when 'pickup' then 'PICKUP'
         when 'waiter' then 'OSPATAR' ||
           case when v_order.table_name is not null then ' · MASA: ' ||
             regexp_replace(v_order.table_name, '[\r\n\t]', ' ', 'g') else '' end
         else 'MASA: ' || coalesce(regexp_replace(v_order.table_name, '[\r\n\t]', ' ', 'g'), '-')
       end
    || e'\n'
    || '#' || upper(right(v_order.id::text, 6)) || ' · '
    || to_char(v_order.created_at at time zone 'Europe/Bucharest', 'HH24:MI DD.MM')
    || e'\n------------------------------\n'
    || v_lines
    || e'\n------------------------------'
    || case when coalesce(btrim(v_order.notes), '') <> ''
            then e'\nNOTE: ' || regexp_replace(v_order.notes, '[\r\n\t]', ' ', 'g')
            else '' end;
end$$;

-- ── Fixtura ─────────────────────────────────────────────────────────────────
-- (idx, limbă, fus, țară, ora așteptată pe fus) — owner propriu per local
-- (limita de restaurante pe plan, 131).
create temp table kl_rest (
  idx   int primary key,
  lang  text not null,
  tz    text not null,
  ctry  text not null,
  hm    text not null,
  rid   uuid not null,
  uid   uuid not null,
  tid   uuid not null
) on commit drop;

insert into kl_rest (idx, lang, tz, ctry, hm, rid, uid, tid)
select v.idx, v.lang, v.tz, v.ctry, v.hm,
       format('32900000-0000-4000-8000-00000000b0%s', lpad(v.idx::text, 2, '0'))::uuid,
       format('32900000-0000-4000-8000-00000000a0%s', lpad(v.idx::text, 2, '0'))::uuid,
       format('32900000-0000-4000-8000-00000000c0%s', lpad(v.idx::text, 2, '0'))::uuid
  from (values
    ( 1, 'ro', 'Europe/Bucharest', 'RO', '01:30 16.07'),
    ( 2, 'en', 'America/New_York', 'US', '18:30 15.07'),
    ( 3, 'de', 'Europe/Berlin',    'DE', '00:30 16.07'),
    ( 4, 'fr', 'Europe/Paris',     'FR', '00:30 16.07'),
    ( 5, 'it', 'Europe/Rome',      'IT', '00:30 16.07'),
    ( 6, 'hu', 'Europe/Budapest',  'HU', '00:30 16.07'),
    ( 7, 'es', 'Europe/Madrid',    'ES', '00:30 16.07'),
    ( 8, 'de', 'Europe/Bucharest', 'DE', '01:30 16.07'),
    ( 9, 'ro', 'Europe/Berlin',    'RO', '00:30 16.07'),
    (10, 'ro', 'Mars/Olympus',     'RO', '01:30 16.07'),
    (11, 'ro', 'europe/berlin',    'RO', '00:30 16.07')
  ) v(idx, lang, tz, ctry, hm);

insert into auth.users (id, email)
select uid, format('kl329-owner-%s@kl.test', idx) from kl_rest
  on conflict (id) do nothing;
insert into public.profiles (id, email)
select uid, format('kl329-owner-%s@kl.test', idx) from kl_rest
  on conflict (id) do nothing;
-- growth: comenzile de ospătar/QR/ridicare și tichetele de bucătărie (227).
update public.profiles set plan = 'growth' where id in (select uid from kl_rest);

insert into public.restaurants (id, owner_id, name, slug, city, is_active, language, timezone, country)
select rid, uid, format('KL Local %s', idx), format('kl329-local-%s', idx), 'Oras',
       true, lang, tz, ctry
  from kl_rest;
insert into public.tables (id, restaurant_id, name, slug, seats, is_active)
select tid, rid, format('T%s', idx), format('kl329-masa-%s', idx), 4, true from kl_rest;

-- Comenzile: id = …d<idx:2><k>; instant FIX (fără now()).
create temp table kl_order (
  rid   uuid not null,
  idx   int  not null,
  k     int  not null,
  id    uuid primary key
) on commit drop;
insert into kl_order (rid, idx, k, id)
select r.rid, r.idx, k.k,
       format('32900000-0000-4000-8000-00000000d%s%s', lpad(r.idx::text, 2, '0'), k.k)::uuid
  from kl_rest r cross join generate_series(1, 5) as k(k);

insert into public.orders (id, restaurant_id, source, status, total, table_id, notes, created_at,
                           customer_name, customer_phone, pickup_time)
select o.id, o.rid,
       (case o.k when 1 then 'waiter' when 2 then 'waiter' when 3 then 'qr' when 4 then 'qr'
                 else 'pickup' end)::public.order_source,
       'new', 30,
       case when o.k in (1, 3) then r.tid end,
       case o.k when 1 then 'Alergie nuci' when 5 then 'Vin la 20' end,
       timestamptz '2026-07-15 22:30:00+00',
       case when o.k = 5 then 'KL Client' end,
       case when o.k = 5 then '0722000329' end,
       case when o.k = 5 then timestamptz '2026-07-15 23:30:00+00' end
  from kl_order o join kl_rest r on r.rid = o.rid;

insert into public.order_items
  (order_id, product_name_snapshot, quantity, unit_price_snapshot, item_total, notes,
   selected_modifiers, extras_added, created_at)
select o.id, 'Burger', 2, 12, 24, case when o.k = 1 then 'fara sare' end,
       case when o.k = 1 then '[{"option_name":"Mediu"}]' else '[]' end::jsonb,
       case when o.k = 1 then '[{"extra_id":null,"extra_name":"Bacon","price":3}]' else '[]' end::jsonb,
       timestamptz '2026-07-15 22:30:00+00'
  from kl_order o
union all
select o.id, 'Limonada', 1, 6, 6, null, '[]'::jsonb, '[]'::jsonb, timestamptz '2026-07-15 22:30:01+00'
  from kl_order o where o.k in (1, 5);

-- Etichetele așteptate, ÎNGHEȚATE (aceeași tabelă ca în mig 329; o schimbare
-- de etichetă se face în AMBELE, deliberat).
create temp table kl_labels (
  lang text primary key, new text, reprint text, pickup text, waiter text, tbl text, note text
) on commit drop;
insert into kl_labels values
  ('ro', '*** COMANDA NOUA ***',      '*** REPRINT ***',       'PICKUP',       'OSPATAR',   'MASA:',   'NOTE:'),
  ('en', '*** NEW ORDER ***',         '*** REPRINT ***',       'PICKUP',       'WAITER',    'TABLE:',  'NOTE:'),
  ('de', '*** NEUE BESTELLUNG ***',   '*** NACHDRUCK ***',     'ABHOLUNG',     'SERVICE',   'TISCH:',  'HINWEIS:'),
  ('fr', '*** NOUVELLE COMMANDE ***', '*** REIMPRESSION ***',  'A EMPORTER',   'SERVEUR',   'TABLE:',  'NOTE:'),
  ('it', '*** NUOVA COMANDA ***',     '*** RISTAMPA ***',      'ASPORTO',      'CAMERIERE', 'TAVOLO:', 'NOTA:'),
  ('hu', '*** UJ RENDELES ***',       '*** UJRANYOMTATAS ***', 'ELVITEL',      'PINCER',    'ASZTAL:', 'MEGJEGYZES:'),
  ('es', '*** NUEVA COMANDA ***',     '*** REIMPRESION ***',   'PARA RECOGER', 'CAMARERO',  'MESA:',   'NOTA:');

-- ── KL0: oracolul e corpul 316 neatins ──────────────────────────────────────
do $$
declare v_md5 text;
begin
  select md5(p.prosrc) into v_md5
    from pg_proc p where p.oid = 'pg_temp.kt316_payload(uuid, boolean)'::regprocedure;
  if v_md5 is distinct from '15aa16535157bcb93cc34f65c53f9ef1' then
    raise exception 'KL0 FAIL: copia corpului 316 s-a schimbat (md5 %) — oracolul nu se repară', v_md5;
  end if;
  raise notice 'KL0 PASS: oracolul = corpul mig 316 (md5 înghețat)';
end $$;

-- ── KL1: ro + București = 316, byte cu byte ─────────────────────────────────
do $$
declare
  o record; v_new text; v_old text; v_n int := 0; v_all text := '';
  v_k1 text;
begin
  for o in select ko.id, rp from kl_order ko cross join (values (false), (true)) v(rp)
            where ko.idx = 1 order by ko.k, rp loop
    v_new := public.build_kitchen_ticket_payload(o.id, o.rp);
    v_old := pg_temp.kt316_payload(o.id, o.rp);
    if v_new is distinct from v_old then
      raise exception 'KL1 FAIL: ro/București diferă de 316 pe comanda % (reprint=%): nou=[%] 316=[%]',
        o.id, o.rp, v_new, v_old;
    end if;
    v_n := v_n + 1;
    v_all := v_all || e'\n' || v_old;
  end loop;
  if v_n <> 10 then
    raise exception 'KL1 FAIL (anti-vacuitate): % comparații în loc de 10', v_n;
  end if;
  -- Toate ramurile 316 au fost exersate (altfel egalitatea ar fi trivială).
  if position('*** COMANDA NOUA ***' in v_all) = 0 or position('*** REPRINT ***' in v_all) = 0
     or position(e'\nPICKUP\n' in v_all) = 0 or position(e'\nOSPATAR\n' in v_all) = 0
     or position('OSPATAR · MASA: T1' in v_all) = 0 or position(e'\nMASA: T1\n' in v_all) = 0
     or position(e'\nMASA: -\n' in v_all) = 0 or position(e'\nNOTE: Alergie nuci' in v_all) = 0
     or position(e'\nNOTE: Vin la 20' in v_all) = 0 or position('   + Mediu' in v_all) = 0
     or position('   + Bacon' in v_all) = 0 or position('   >> fara sare' in v_all) = 0 then
    raise exception 'KL1 FAIL (anti-vacuitate): o ramură a tichetului nu a fost exersată:%', v_all;
  end if;
  -- Așteptarea înghețată, independentă de oracol.
  v_k1 := public.build_kitchen_ticket_payload('32900000-0000-4000-8000-00000000d011');
  if v_k1 is distinct from
       '*** COMANDA NOUA ***' || e'\n'
    || 'OSPATAR · MASA: T1' || e'\n'
    || '#00D011 · 01:30 16.07' || e'\n'
    || '------------------------------' || e'\n'
    || '2x Burger' || e'\n' || '   + Mediu' || e'\n' || '   + Bacon' || e'\n' || '   >> fara sare' || e'\n'
    || '1x Limonada' || e'\n'
    || '------------------------------' || e'\n'
    || 'NOTE: Alergie nuci' then
    raise exception 'KL1 FAIL: payload-ul românesc k=1 diferă de forma înghețată:%', e'\n' || v_k1;
  end if;
  raise notice 'KL1 PASS: ro + București byte-identic cu 316 (10 payload-uri, toate ramurile)';
end $$;

-- ── KL2: limba NULL / necunoscută → româna 316 ──────────────────────────────
-- Ramura e inaccesibilă din date (NOT NULL 038 + CHECK 298), deci constrângerile
-- se scot DOAR aici; ROLLBACK-ul de la final le readuce. ALTER TABLE refuză o
-- tabelă cu evenimente DEFERRED în așteptare (invariantul de owner, 096c), deci
-- le golim întâi și readucem apoi amânarea (KL8 are nevoie de enqueue amânat).
set constraints all immediate;
alter table public.restaurants drop constraint restaurants_language_check;
alter table public.restaurants alter column language drop not null;
set constraints all deferred;
do $$
declare
  v_lang text; o record; v_n int := 0;
begin
  foreach v_lang in array array['<NULL>', 'pt', 'RO', ''] loop
    update public.restaurants set language = nullif(v_lang, '<NULL>')
     where id = '32900000-0000-4000-8000-00000000b001';
    for o in select ko.id, rp from kl_order ko cross join (values (false), (true)) v(rp)
              where ko.idx = 1 loop
      if public.build_kitchen_ticket_payload(o.id, o.rp)
           is distinct from pg_temp.kt316_payload(o.id, o.rp) then
        raise exception 'KL2 FAIL: limba % nu cade pe româna 316 (comanda %, reprint=%): %',
          v_lang, o.id, o.rp, public.build_kitchen_ticket_payload(o.id, o.rp);
      end if;
      v_n := v_n + 1;
    end loop;
  end loop;
  if v_n <> 40 then
    raise exception 'KL2 FAIL (anti-vacuitate): % comparații în loc de 40', v_n;
  end if;
  update public.restaurants set language = 'ro' where id = '32900000-0000-4000-8000-00000000b001';
  raise notice 'KL2 PASS: NULL / pt / RO / șir gol → româna 316, byte-identic';
end $$;

-- ── KL3: de + Berlin; de pe București; ro pe Berlin ─────────────────────────
do $$
declare v_new text; v_old text;
begin
  v_new := public.build_kitchen_ticket_payload('32900000-0000-4000-8000-00000000d031');
  v_old := pg_temp.kt316_payload('32900000-0000-4000-8000-00000000d031');
  if v_new is distinct from
       '*** NEUE BESTELLUNG ***' || e'\n'
    || 'SERVICE · TISCH: T3' || e'\n'
    || '#00D031 · 00:30 16.07' || e'\n'
    || '------------------------------' || e'\n'
    || '2x Burger' || e'\n' || '   + Mediu' || e'\n' || '   + Bacon' || e'\n' || '   >> fara sare' || e'\n'
    || '1x Limonada' || e'\n'
    || '------------------------------' || e'\n'
    || 'HINWEIS: Alergie nuci' then
    raise exception 'KL3 FAIL: tichetul german pe Berlin diferă de forma înghețată:%', e'\n' || v_new;
  end if;
  if v_new = v_old then
    raise exception 'KL3 FAIL (anti-vacuitate): oracolul 316 dă același tichet pe un local german';
  end if;
  if v_new ~ '(OSPATAR|MASA:|COMANDA NOUA|NOTE:|01:30)' then
    raise exception 'KL3 FAIL: resturi românești / ora Bucureștiului pe tichetul german: %', v_new;
  end if;

  -- de pe fusul Bucureștiului: doar etichetele diferă, ora e a oracolului.
  v_new := public.build_kitchen_ticket_payload('32900000-0000-4000-8000-00000000d081');
  v_old := pg_temp.kt316_payload('32900000-0000-4000-8000-00000000d081');
  if v_new = v_old or split_part(v_new, e'\n', 3) is distinct from split_part(v_old, e'\n', 3)
     or split_part(v_new, e'\n', 1) is distinct from '*** NEUE BESTELLUNG ***' then
    raise exception 'KL3 FAIL: de/București — etichetele sau ora greșite:%', e'\n' || v_new;
  end if;

  -- ro pe Berlin: EXACT oracolul, cu ora Berlinului.
  v_new := public.build_kitchen_ticket_payload('32900000-0000-4000-8000-00000000d091');
  v_old := pg_temp.kt316_payload('32900000-0000-4000-8000-00000000d091');
  if v_new = v_old
     or v_new is distinct from replace(v_old, ' · 01:30 16.07', ' · 00:30 16.07') then
    raise exception 'KL3 FAIL: ro/Berlin trebuie să fie 316 cu ora Berlinului: nou=[%] 316=[%]',
      v_new, v_old;
  end if;
  raise notice 'KL3 PASS: de/Berlin înghețat; limba și fusul se aplică independent';
end $$;

-- ── KL4: etichetele per limbă, pe toate ramurile ────────────────────────────
do $$
declare
  o record; v text; v_l text[]; v_exp2 text; v_n int := 0;
begin
  for o in
    select ko.id, ko.k, r.idx, r.hm, l.*, rp
      from kl_order ko
      join kl_rest r on r.rid = ko.rid
      join kl_labels l on l.lang = r.lang
     cross join (values (false), (true)) v(rp)
     where r.idx between 1 and 8
     order by r.idx, ko.k, rp
  loop
    v := public.build_kitchen_ticket_payload(o.id, o.rp);
    v_l := string_to_array(v, e'\n');
    v_exp2 := case o.k
                when 1 then o.waiter || ' · ' || o.tbl || ' T' || o.idx
                when 2 then o.waiter
                when 3 then o.tbl || ' T' || o.idx
                when 4 then o.tbl || ' -'
                else o.pickup end;
    if v_l[1] is distinct from (case when o.rp then o.reprint else o.new end)
       or v_l[2] is distinct from v_exp2
       or v_l[3] is distinct from '#' || upper(right(o.id::text, 6)) || ' · ' || o.hm
       or v_l[4] is distinct from '------------------------------'
       or (o.k = 1 and v_l[array_length(v_l, 1)] is distinct from o.note || ' Alergie nuci')
       or (o.k = 5 and v_l[array_length(v_l, 1)] is distinct from o.note || ' Vin la 20')
       or (o.k in (2, 3, 4) and v_l[array_length(v_l, 1)] is distinct from '------------------------------') then
      raise exception 'KL4 FAIL: limba %, comanda k=% (reprint=%) — etichetele diferă de tabelă:%',
        o.lang, o.k, o.rp, e'\n' || v;
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n <> 80 then
    raise exception 'KL4 FAIL (anti-vacuitate): % payload-uri în loc de 80', v_n;
  end if;
  raise notice 'KL4 PASS: etichetele celor 7 limbi, pe toate ramurile (80 de payload-uri)';
end $$;

-- ── KL5: ASCII pe toate limbile; maghiara și pe octeți ──────────────────────
do $$
declare o record; v text; v_n int := 0;
begin
  for o in select ko.id, r.lang, rp from kl_order ko join kl_rest r on r.rid = ko.rid
            cross join (values (false), (true)) v(rp) loop
    v := replace(public.build_kitchen_ticket_payload(o.id, o.rp), ' · ', ' ');
    if v !~ '^[ -~\n]*$' then
      raise exception 'KL5 FAIL: caractere ne-ASCII pe tichetul în limba %: %', o.lang, v;
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n <> 110 then
    raise exception 'KL5 FAIL (anti-vacuitate): % payload-uri în loc de 110', v_n;
  end if;
  -- Maghiara: fiecare caracter are UN octet în UTF-8 (fără Ú/É/Ő dintr-o etichetă).
  for o in select ko.id, rp from kl_order ko cross join (values (false), (true)) v(rp)
            where ko.idx = 6 loop
    v := replace(public.build_kitchen_ticket_payload(o.id, o.rp), ' · ', ' ');
    if octet_length(convert_to(v, 'UTF8')) <> length(v) then
      raise exception 'KL5 FAIL: tichetul maghiar are caractere multi-octet: %', v;
    end if;
  end loop;
  -- Control pozitiv: verificarea chiar respinge o etichetă accentuată.
  if 'ÚJ RENDELÉS' ~ '^[ -~\n]*$' then
    raise exception 'KL5 FAIL (control): regexul ASCII acceptă diacritice';
  end if;
  raise notice 'KL5 PASS: 110 tichete ASCII în 7 limbi; maghiara un octet pe caracter';
end $$;

-- ── KL6: antetul de retipărire per limbă ────────────────────────────────────
do $$
declare o record; v_r text; v_n text; v_cnt int := 0;
begin
  for o in select r.lang, r.hm, l.new, l.reprint,
                  format('32900000-0000-4000-8000-00000000d%s1', lpad(r.idx::text, 2, '0'))::uuid as id
             from kl_rest r join kl_labels l on l.lang = r.lang
            where r.idx between 1 and 7 loop
    v_r := public.build_kitchen_ticket_payload(o.id, true);
    v_n := public.build_kitchen_ticket_payload(o.id, false);
    if split_part(v_r, e'\n', 1) is distinct from o.reprint
       or o.reprint = o.new
       or v_r is distinct from o.reprint || substr(v_n, length(o.new) + 1)
       or split_part(v_r, e'\n', 3) not like '% · ' || o.hm then
      raise exception 'KL6 FAIL: retipărirea în limba % e greșită:%', o.lang, e'\n' || v_r;
    end if;
    v_cnt := v_cnt + 1;
  end loop;
  if v_cnt <> 7 then
    raise exception 'KL6 FAIL (anti-vacuitate): % limbi în loc de 7', v_cnt;
  end if;
  raise notice 'KL6 PASS: antetul de retipărire în fiecare dintre cele 7 limbi';
end $$;

-- ── KL7: fus invalid / scris altfel → exact restaurant_time_zone ────────────
do $$
declare o record; v_new text; v_old text;
begin
  if public.restaurant_time_zone('32900000-0000-4000-8000-00000000b010') is distinct from 'Europe/Bucharest'
     or public.restaurant_time_zone('32900000-0000-4000-8000-00000000b011') is distinct from 'Europe/Berlin' then
    raise exception 'KL7 FAIL (premisă): restaurant_time_zone nu validează fusul fixturii';
  end if;
  for o in select ko.id, rp from kl_order ko cross join (values (false), (true)) v(rp)
            where ko.idx = 10 loop
    if public.build_kitchen_ticket_payload(o.id, o.rp) is distinct from pg_temp.kt316_payload(o.id, o.rp) then
      raise exception 'KL7 FAIL: fusul invalid nu cade pe București (comanda %)', o.id;
    end if;
  end loop;
  v_new := public.build_kitchen_ticket_payload('32900000-0000-4000-8000-00000000d111');
  v_old := pg_temp.kt316_payload('32900000-0000-4000-8000-00000000d111');
  if v_new is distinct from replace(v_old, ' · 01:30 16.07', ' · 00:30 16.07') or v_new = v_old then
    raise exception 'KL7 FAIL: ''europe/berlin'' nu dă ora Berlinului:%', e'\n' || v_new;
  end if;
  raise notice 'KL7 PASS: fus invalid → București; fus scris altfel → numele canonic';
end $$;

-- ── KL8: enqueue → stocat; retry nu regenerează; reprint în limba curentă ───
insert into public.bridge_devices (restaurant_id, name, device_secret, prints_kitchen_receipts)
values ('32900000-0000-4000-8000-00000000b003', 'Kueche KL', 'kl329_secret', true);
do $$
declare
  c_oid constant uuid := '32900000-0000-4000-8000-0000000e0031';
  v_tk record; v_res jsonb; v_rp record;
begin
  insert into public.orders (id, restaurant_id, source, status, total, table_id, created_at)
  values (c_oid, '32900000-0000-4000-8000-00000000b003', 'waiter', 'new', 24,
          '32900000-0000-4000-8000-00000000c003', timestamptz '2026-07-15 22:30:00+00');
  insert into public.order_items (order_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
  values (c_oid, 'Schnitzel', 1, 24, 24);
  -- Trigger-ul de enqueue e DEFERRED: îl forțăm acum, în tranzacția testului.
  set constraints all immediate;

  select * into v_tk from public.kitchen_tickets where order_id = c_oid and not is_reprint;
  if v_tk.id is null then
    raise exception 'KL8 FAIL: niciun tichet pus în coadă (enqueue a eșuat tăcut?)';
  end if;
  if v_tk.payload is distinct from public.build_kitchen_ticket_payload(c_oid)
     or split_part(v_tk.payload, e'\n', 1) is distinct from '*** NEUE BESTELLUNG ***'
     or split_part(v_tk.payload, e'\n', 3) not like '% · 00:30 16.07' then
    raise exception 'KL8 FAIL: tichetul pus în coadă nu e german / pe Berlin:%', e'\n' || v_tk.payload;
  end if;

  -- Limba ȘI fusul localului se schimbă DUPĂ emitere (recenzie CodeRabbit pe
  -- #383: cu fusul neschimbat, un reprint care ar refolosi fusul de la emitere
  -- trecea; New York = 18:30 15.07, deci se schimbă și ZIUA față de Berlin).
  update public.restaurants set language = 'fr', timezone = 'America/New_York'
   where id = '32900000-0000-4000-8000-00000000b003';
  update public.kitchen_tickets set status = 'error', error_code = 'PRINT_TIMEOUT' where id = v_tk.id;

  perform set_config('request.jwt.claim.sub', '32900000-0000-4000-8000-00000000a003', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  v_res := public.kitchen_ticket_retry(v_tk.id);
  if coalesce((v_res->>'ok')::boolean, false) is not true then
    raise exception 'KL8 FAIL (control): retry respins: %', v_res;
  end if;
  if (select payload from public.kitchen_tickets where id = v_tk.id) is distinct from v_tk.payload then
    raise exception 'KL8 FAIL: retry-ul a rescris payload-ul stocat';
  end if;
  -- Retry-ul trebuie să și REPUNĂ tichetul în coadă: un `ok:true` care lasă
  -- rândul în `error` nu se mai tipărește niciodată (recenzie CodeRabbit pe #383).
  if (select status from public.kitchen_tickets where id = v_tk.id) is distinct from 'pending' then
    raise exception 'KL8 FAIL: retry-ul nu a repus tichetul în pending (status=%)',
      (select status from public.kitchen_tickets where id = v_tk.id);
  end if;

  v_res := public.kitchen_ticket_reprint(c_oid);
  if coalesce((v_res->>'ok')::boolean, false) is not true then
    raise exception 'KL8 FAIL (control): reprint respins: %', v_res;
  end if;
  select * into v_rp from public.kitchen_tickets where id = (v_res->>'ticket_id')::uuid;
  if not v_rp.is_reprint
     or split_part(v_rp.payload, e'\n', 1) is distinct from '*** REIMPRESSION ***'
     or split_part(v_rp.payload, e'\n', 2) is distinct from 'SERVEUR · TABLE: T3'
     or split_part(v_rp.payload, e'\n', 3) not like '% · 18:30 15.07' then
    raise exception 'KL8 FAIL: retipărirea nu e în limba / pe fusul curent (fr, New York) la instantul comenzii:%', e'\n' || v_rp.payload;
  end if;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  raise notice 'KL8 PASS: enqueue stocat în de/Berlin, retry neschimbat + pending, reprint în fr/New York';
end $$;

-- ── KL9: suprafața, pe catalog ──────────────────────────────────────────────
do $$
declare
  c_fn constant regprocedure := 'public.build_kitchen_ticket_payload(uuid, boolean)'::regprocedure;
  v_n int; v_cfg text; v_src text; v_role text;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'build_kitchen_ticket_payload';
  if v_n <> 1 then
    raise exception 'KL9 FAIL: % semnături build_kitchen_ticket_payload', v_n;
  end if;
  if not (select p.prosecdef and p.provolatile = 's' from pg_proc p where p.oid = c_fn) then
    raise exception 'KL9 FAIL: nu mai e STABLE SECURITY DEFINER';
  end if;
  -- Intrarea EXACTĂ din proconfig (recenzie CodeRabbit pe #383): o expresie
  -- pe șirul unit cu virgule accepta și `public, pg_temp, alta_schema`.
  select array_to_string(p.proconfig, ' | '), p.prosrc
    into v_cfg, v_src from pg_proc p where p.oid = c_fn;
  if not exists (select 1 from pg_proc p, unnest(p.proconfig) c(e)
                  where p.oid = c_fn
                    and lower(regexp_replace(c.e, '[[:space:]]+', '', 'g')) = 'search_path=public,pg_temp') then
    raise exception 'KL9 FAIL: proconfig=%', v_cfg;
  end if;
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, c_fn, 'execute') then
      raise exception 'KL9 FAIL: helperul e apelabil de %', v_role;
    end if;
  end loop;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid = c_fn and a.grantee = 0) then
    raise exception 'KL9 FAIL: helperul e executabil de PUBLIC';
  end if;
  if position('extra_name' in v_src) = 0 then
    raise exception 'KL9 FAIL: invariantul 316 (extra_name) a dispărut';
  end if;
  if position('''Europe/Bucharest''' in v_src) > 0 then
    raise exception 'KL9 FAIL: literalul de fus București a revenit în corp';
  end if;
  v_n := (length(v_src) - length(replace(v_src, 'restaurant_time_zone(', ''))) / length('restaurant_time_zone(');
  if v_n <> 1 or position('safe_time_zone(' in v_src) > 0 then
    raise exception 'KL9 FAIL: fusul evaluat de % ori / ocolind restaurant_time_zone', v_n;
  end if;
  if (select proowner from pg_proc where oid = c_fn)
     is distinct from (select proowner from pg_proc where oid = 'public.restaurant_time_zone(uuid)'::regprocedure) then
    raise exception 'KL9 FAIL: proprietar diferit de al lui restaurant_time_zone (42501 tăcut la enqueue)';
  end if;
  raise notice 'KL9 PASS: o semnătură, DEFINER, pg_temp, închis clientului, fusul din 324, același proprietar';
end $$;

rollback;
