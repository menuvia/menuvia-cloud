-- ═══════════════════════════════════════════════════════════════════
-- Migration 329: tichetul de bucătărie în limba și pe fusul LOCALULUI (lotul L8c)
-- ─────────────────────────────────────────────────────────────────────
-- PROBLEMA: `build_kitchen_ticket_payload` (lanț 227→316) scria etichetele
-- tichetului în română („*** COMANDA NOUA ***”, „OSPATAR”, „MASA:”, „NOTE:”)
-- și ora în fusul Bucureștiului, scris de mână în corp. Platforma vinde și în
-- afara României (menuvia.com), iar restaurantul își alege limba de bază
-- (`restaurants.language`, 7 limbi, CHECK 298) și fusul (`restaurants.timezone`,
-- G1). Un bucătar din Berlin primea „COMANDA NOUA · MASA: 4” și ora Bucureștiului
-- (o oră înaintea ceasului din bucătărie), lângă numele produselor scrise de
-- local în germană — singurul text de pe tichet pe care nu-l putea citi.
--
-- REMEDIUL: corpul 316 VERBATIM, cu trei schimbări:
--   (1) `o.restaurant_id` și `restaurants.language` (LEFT JOIN) în SELECT-ul
--       comenzii;
--   (2) ora prin `restaurant_time_zone(o.restaurant_id)` (324) — sursa UNICĂ a
--       fusului localului (`safe_time_zone`: fus invalid / restaurant lipsă →
--       București), evaluată O DATĂ, în variabilă (regula 324), în locul
--       literalului de fus;
--   (3) cele șase etichete (antetul nou / reprint, PICKUP, OSPATAR, MASA:,
--       NOTE:) dintr-un CASE pe limba restaurantului: ro/en/de/fr/it/hu/es;
--       NULL sau necunoscută → ro. Etichetele sunt ASCII PUR (imprimantele
--       termice n-au diacritice; fără ß), scurte, cu cuvintele din glosarul
--       oaspetelui / personalului: de „Abholung”, „Hinweis” (nota pentru
--       bucătărie a oaspetelui, qc_kitchen_note), fr „à emporter”, it „comanda”
--       / „asporto”, hu „elvitel” / „megjegyzés”, es „comanda” / „para recoger”.
-- Restaurant în română pe fusul Bucureștiului → ieșire BYTE-identică cu 316
-- (oracolul din tests/sql/auto/329_*.sql randează aceleași comenzi cu o copie
-- a corpului 316, cu md5 înghețat, și compară payload-urile întregi).
-- Separatorul „·” din antet (structură, nu etichetă) rămâne în toate limbile;
-- bridge-ul îl mapează pe „-” (KB6). Formatul orei („HH24:MI DD.MM”) rămâne.
--
-- CE SE SCHIMBĂ CU LIMBA, PE CALEA REALĂ (payload-ul e STOCAT în
-- `kitchen_tickets.payload` la punerea în coadă):
--   * enqueue (`enqueue_kitchen_ticket`, 227, la COMMIT-ul comenzii) → limba
--     și fusul de ATUNCI;
--   * `kitchen_ticket_retry` (227) NU regenerează: retrimite payload-ul stocat,
--     deci limba/ora primei puneri în coadă (o schimbare de limbă între timp nu
--     rescrie un tichet deja emis — e același tichet, retipărit);
--   * `kitchen_ticket_reprint` (227) regenerează (rând nou, `p_reprint=true`)
--     → limba și fusul CURENTE ale localului, ora rămâne cea a comenzii
--     (`created_at`).
-- Bridge-ul (`bridge_get_pending_tickets`/`bridge_claim_ticket`) doar
-- transportă payload-ul; nu-l construiește.
--
-- SUPRAFAȚA: aceeași semnătură → `create or replace` (fără overload, fără
-- PGRST203); proprietarul și ACL-ul se păstrează (instantaneu înainte/după,
-- asertat). `stable security definer`, `search_path = public, pg_temp` scris
-- EXPLICIT (`create or replace` rescrie `proconfig`). Revocările 316 sunt
-- re-afirmate (public, anon, authenticated); service_role rămâne cum era — îl
-- cheamă doar trigger-ul de enqueue și RPC-urile DEFINER (227). Proprietarul
-- TREBUIE să fie al lui `restaurant_time_zone` (închis pentru toate rolurile,
-- 324): altfel apelul dă 42501, iar pe calea enqueue-ului (catch-all
-- `raise warning`) tichetele s-ar pierde TĂCUT — asertat.
--
-- ORDINEA: după 316 (corpul) și 324 (helperul de fus — precondiție asertată).
-- O re-aplicare ULTERIOARĂ a lui 316 ar readuce româna și Bucureștiul, tăcut
-- (capcana 290/296) — 316 nu se re-aplică după 329. Deploy-ul bridge-ului e
-- independent (etichetele noi sunt ASCII; un bridge vechi le tipărește la fel).
-- La aplicare, §3 listează (NOTICE) localurile al căror tichet se schimbă.
--
-- Teste permanente: tests/sql/auto/329_kitchen_ticket_language.sql (KL0–KL9).
-- Partea de bridge (transliterarea ß/æ/ø/œ/ł/đ/þ) e în același lot:
-- bridge/lib/kitchenPrinter.js, teste KB10–KB12.
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- ── §0. Precondiții + instantaneul ACL ──────────────────────────────
do $$
begin
  if to_regprocedure('public.restaurant_time_zone(uuid)') is null then
    raise exception 'mig 329: lipsește public.restaurant_time_zone(uuid) — aplică întâi mig 324';
  end if;
  if to_regprocedure('public.build_kitchen_ticket_payload(uuid, boolean)') is null then
    raise exception 'mig 329: lipsește public.build_kitchen_ticket_payload(uuid, boolean) — aplică întâi mig 227/316';
  end if;
end $$;

create temp table m329_acl_before on commit drop as
select p.oid,
       pg_get_userbyid(p.proowner) as owner,
       coalesce(array_to_string(array(select x::text from unnest(p.proacl) x order by x::text collate "C"), ','), '<implicit>') as acl
  from pg_proc p
 where p.oid = 'public.build_kitchen_ticket_payload(uuid, boolean)'::regprocedure;

-- ── §1. build_kitchen_ticket_payload, lanț 227→316→329 ──────────────
create or replace function public.build_kitchen_ticket_payload(
  p_order_id uuid,
  p_reprint  boolean default false
) returns text
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_order  record;
  v_lines  text;
  v_items  int;
  -- mig 329: fusul și etichetele localului
  v_tz       text;
  v_new      text;
  v_reprint  text;
  v_pickup   text;
  v_waiter   text;
  v_table    text;
  v_note     text;
begin
  select o.id, o.restaurant_id, o.source, o.notes, o.created_at,
         coalesce(o._table_name_snapshot, t.name) as table_name,
         r.language as restaurant_language
    into v_order
    from public.orders o
    left join public.tables t on t.id = o.table_id
    left join public.restaurants r on r.id = o.restaurant_id
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

  -- mig 329: fusul localului, O SINGURĂ dată (fus invalid → București).
  v_tz := public.restaurant_time_zone(v_order.restaurant_id);

  -- mig 329: etichetele în limba de bază a localului. ASCII pur (imprimanta
  -- termică n-are diacritice); NULL sau necunoscută → româna din 316.
  case coalesce(v_order.restaurant_language, 'ro')
    when 'en' then
      v_new     := '*** NEW ORDER ***';
      v_reprint := '*** REPRINT ***';
      v_pickup  := 'PICKUP';
      v_waiter  := 'WAITER';
      v_table   := 'TABLE:';
      v_note    := 'NOTE:';
    when 'de' then
      v_new     := '*** NEUE BESTELLUNG ***';
      v_reprint := '*** NACHDRUCK ***';
      v_pickup  := 'ABHOLUNG';
      v_waiter  := 'SERVICE';
      v_table   := 'TISCH:';
      v_note    := 'HINWEIS:';
    when 'fr' then
      v_new     := '*** NOUVELLE COMMANDE ***';
      v_reprint := '*** REIMPRESSION ***';
      v_pickup  := 'A EMPORTER';
      v_waiter  := 'SERVEUR';
      v_table   := 'TABLE:';
      v_note    := 'NOTE:';
    when 'it' then
      v_new     := '*** NUOVA COMANDA ***';
      v_reprint := '*** RISTAMPA ***';
      v_pickup  := 'ASPORTO';
      v_waiter  := 'CAMERIERE';
      v_table   := 'TAVOLO:';
      v_note    := 'NOTA:';
    when 'hu' then
      v_new     := '*** UJ RENDELES ***';
      v_reprint := '*** UJRANYOMTATAS ***';
      v_pickup  := 'ELVITEL';
      v_waiter  := 'PINCER';
      v_table   := 'ASZTAL:';
      v_note    := 'MEGJEGYZES:';
    when 'es' then
      v_new     := '*** NUEVA COMANDA ***';
      v_reprint := '*** REIMPRESION ***';
      v_pickup  := 'PARA RECOGER';
      v_waiter  := 'CAMARERO';
      v_table   := 'MESA:';
      v_note    := 'NOTA:';
    else
      v_new     := '*** COMANDA NOUA ***';
      v_reprint := '*** REPRINT ***';
      v_pickup  := 'PICKUP';
      v_waiter  := 'OSPATAR';
      v_table   := 'MASA:';
      v_note    := 'NOTE:';
  end case;

  return case when p_reprint then v_reprint else v_new end
    || e'\n'
    || case v_order.source
         when 'pickup' then v_pickup
         when 'waiter' then v_waiter ||
           case when v_order.table_name is not null then ' · ' || v_table || ' ' ||
             regexp_replace(v_order.table_name, '[\r\n\t]', ' ', 'g') else '' end
         else v_table || ' ' || coalesce(regexp_replace(v_order.table_name, '[\r\n\t]', ' ', 'g'), '-')
       end
    || e'\n'
    || '#' || upper(right(v_order.id::text, 6)) || ' · '
    || to_char(v_order.created_at at time zone v_tz, 'HH24:MI DD.MM')
    || e'\n------------------------------\n'
    || v_lines
    || e'\n------------------------------'
    || case when coalesce(btrim(v_order.notes), '') <> ''
            then e'\n' || v_note || ' ' || regexp_replace(v_order.notes, '[\r\n\t]', ' ', 'g')
            else '' end;
end$$;

-- (g) `create or replace` a păstrat ACL-ul și proprietarul lui 316 — verificat
-- ÎNAINTEA revocării de mai jos, ca un grant de client rămas din urmă să fie
-- revocat, nu să oprească migrația.
do $$
declare
  v_acl text;
begin
  select coalesce(array_to_string(array(select x::text from unnest(p.proacl) x order by x::text collate "C"), ','), '<implicit>')
    into v_acl
    from pg_proc p where p.oid = 'public.build_kitchen_ticket_payload(uuid, boolean)'::regprocedure;
  if (select count(*) from pg_temp.m329_acl_before) <> 1
     or v_acl is distinct from (select acl from pg_temp.m329_acl_before)
     or (select pg_get_userbyid(proowner) from pg_proc
          where oid = 'public.build_kitchen_ticket_payload(uuid, boolean)'::regprocedure)
        is distinct from (select owner from pg_temp.m329_acl_before) then
    raise exception 'ASSERT FAIL (mig 329): create or replace a schimbat ACL-ul/proprietarul (% → %)',
      (select acl from pg_temp.m329_acl_before), v_acl;
  end if;
end $$;

-- Helper intern: îl cheamă doar trigger-ul de enqueue și RPC-urile DEFINER
-- (kitchen_ticket_reprint). Nicio cale de client (re-afirmat, ca în 316).
revoke all on function public.build_kitchen_ticket_payload(uuid, boolean)
  from public, anon, authenticated;

-- ── §2. Asserții fail-closed (a)–(f), (h) ─────────────────────────────
do $$
declare
  c_fn   constant regprocedure := 'public.build_kitchen_ticket_payload(uuid, boolean)'::regprocedure;
  v_n    int;
  v_src  text;
  v_def  boolean;
  v_vol  "char";
  v_cfg  text[];
  v_bad  text;
  v_lang text;
  v_role text;
begin
  -- (a) o singură semnătură (un overload = PGRST203 / apel ambiguu)
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'build_kitchen_ticket_payload';
  if v_n <> 1 then
    raise exception 'ASSERT FAIL (mig 329): build_kitchen_ticket_payload are % semnături (aștept 1)', v_n;
  end if;

  -- (b) DEFINER, STABLE, search_path = public, pg_temp
  select prosecdef, provolatile, proconfig, prosrc into v_def, v_vol, v_cfg, v_src
    from pg_proc where oid = c_fn;
  if not v_def or v_vol <> 's' then
    raise exception 'ASSERT FAIL (mig 329): builder-ul trebuie să rămână STABLE SECURITY DEFINER (def=%, vol=%)', v_def, v_vol;
  end if;
  if v_cfg is null or not (v_cfg @> array['search_path=public, pg_temp']) then
    raise exception 'ASSERT FAIL (mig 329): builder-ul fără search_path = public, pg_temp (%)', v_cfg;
  end if;

  -- (c) invariantul 316: extra-urile pe cheia vie
  if position('extra_name' in v_src) = 0 then
    raise exception 'ASSERT FAIL (mig 329): tichetul nu mai citește extra_name (mig 316)';
  end if;

  -- (d) fusul: niciun literal de fus, helperul 324 chemat O dată, ora pe el
  if position('''Europe/Bucharest''' in v_src) > 0 then
    raise exception 'ASSERT FAIL (mig 329): literalul de fus București a rămas în corp';
  end if;
  v_n := (length(v_src) - length(replace(v_src, 'restaurant_time_zone(', ''))) / length('restaurant_time_zone(');
  if v_n <> 1 or position('safe_time_zone(' in v_src) > 0 then
    raise exception 'ASSERT FAIL (mig 329): fusul evaluat de % ori / ocolind restaurant_time_zone (aștept o dată)', v_n;
  end if;
  if position('at time zone v_tz' in v_src) = 0 then
    raise exception 'ASSERT FAIL (mig 329): ora nu se formatează pe fusul localului';
  end if;

  -- (e) limbile: câte o ramură pentru fiecare limbă ≠ ro, rezerva = româna 316
  foreach v_lang in array array['en', 'de', 'fr', 'it', 'hu', 'es'] loop
    if position(format('when %L then', v_lang) in v_src) = 0 then
      raise exception 'ASSERT FAIL (mig 329): lipsește ramura de etichete pentru limba %', v_lang;
    end if;
  end loop;
  if position('coalesce(v_order.restaurant_language, ''ro'')' in v_src) = 0
     or position('''*** COMANDA NOUA ***''' in v_src) = 0
     or position('''OSPATAR''' in v_src) = 0
     or position('''MASA:''' in v_src) = 0 then
    raise exception 'ASSERT FAIL (mig 329): rezerva românească (316) lipsește din CASE';
  end if;
  -- etichetele (liniile `v_x := '…';`) sunt ASCII tipăribil
  select string_agg(btrim(l), ' | ') into v_bad
    from regexp_split_to_table(v_src, e'\n') l
   where l ~ ':= '''
     and l !~ '^[ -~]*$';
  if v_bad is not null then
    raise exception 'ASSERT FAIL (mig 329): etichete ne-ASCII pe tichet: %', v_bad;
  end if;

  -- (f) nicio cale de client (catalog + PUBLIC)
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, c_fn, 'execute') then
      raise exception 'ASSERT FAIL (mig 329): build_kitchen_ticket_payload apelabil de %', v_role;
    end if;
  end loop;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid = c_fn and a.grantee = 0) then
    raise exception 'ASSERT FAIL (mig 329): build_kitchen_ticket_payload executabil de PUBLIC';
  end if;

  -- (h) același proprietar ca restaurant_time_zone: altfel 42501 la apel, iar
  -- pe enqueue (catch-all) tichetele s-ar pierde TĂCUT
  if (select proowner from pg_proc where oid = c_fn)
     is distinct from (select proowner from pg_proc where oid = 'public.restaurant_time_zone(uuid)'::regprocedure) then
    raise exception 'ASSERT FAIL (mig 329): builder-ul are alt proprietar decât restaurant_time_zone (42501 la apel)';
  end if;

  raise notice 'mig 329: tichetul de bucătărie în limba și pe fusul localului OK';
end $$;

-- ── §3. Informativ (ca notice-ul 324): localurile al căror tichet se schimbă ─
-- Doar ro + București rămâne byte-identic; orice alt local (inclusiv unul din
-- România cu limba de bază a meniului ≠ ro) primește de acum alte etichete
-- și/sau alt ceas pe tichet. Fondatorul vede lista la aplicare. Lista e
-- filtrată pe ACEEAȘI eligibilitate ca enqueue-ul (227: feature
-- `kitchen_tickets` + un bridge cu `prints_kitchen_receipts`) — un local fără
-- tichete nu are ce tichet să-i se schimbe (recenzie CodeRabbit pe #383).
do $$
declare v_list text;
begin
  select string_agg(format('%s (%s, %s)', x.slug, x.lang, x.tz), ', ' order by x.slug)
    into v_list
    from (
      select r.slug, coalesce(r.language, 'NULL') as lang, public.restaurant_time_zone(r.id) as tz,
             coalesce(r.language, 'ro') as eff_lang
        from public.restaurants r
       where public.restaurant_has_feature(r.id, 'kitchen_tickets')
         and exists (select 1 from public.bridge_devices d
                      where d.restaurant_id = r.id and d.prints_kitchen_receipts = true)
    ) x
   where x.eff_lang <> 'ro' or x.tz <> 'Europe/Bucharest';
  raise notice 'mig 329: localuri care tipăresc tichete de bucătărie și le primesc de acum în altă limbă / pe alt fus decât ro + București: %',
    coalesce(v_list, '(niciunul)');
end $$;

commit;
