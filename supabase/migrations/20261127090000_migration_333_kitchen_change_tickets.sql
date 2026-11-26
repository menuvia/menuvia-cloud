-- ═══════════════════════════════════════════════════════════════════
-- Migration 333: tichet de MODIFICARE și de ANULARE la imprimanta
-- bucătăriei (lotul C3c, Partea III audit nov 2026, C3 Bucătărie)
-- ─────────────────────────────────────────────────────────────────────
-- PROBLEMA: tichetul de bucătărie (227) se pune în coadă DOAR la INSERT-ul
-- comenzii (`trg_enqueue_kitchen_ticket`, after insert, un tichet per
-- comandă). Pe hârtie nu iese NIMIC când:
--   (a) ospătarul EDITEAZĂ comanda (`update_order_items` — adaugă un desert pe
--       o masă servită, scoate o porție, schimbă o opțiune): singura cale era
--       „Retipărește la bucătărie”, care tipărește TOATĂ comanda cu antetul
--       REPRINT, deci bucătarul nu știe ce e nou și poate găti dublu;
--   (b) comanda e ANULATĂ cât bucătăria încă o gătește: tichetul tipărit rămâne
--       pe șină, nimic nu-i spune bucătarului să se oprească — iar un tichet
--       încă NEtipărit (bridge offline) ieșea mai târziu pentru o comandă
--       deja anulată.
-- CLAUDE.md consemna (a) ca rezidual „NEadresat, fără lot” (O3a/O3b, L8c).
--
-- REMEDIUL (tichete NEfiscale — nu ating `pending_receipts`, gate-ul fiscal
-- 133 sau lanțul Plan 3; hârtie, nu bani):
--   §1 `build_kitchen_ticket_change_payload(order_id, old_lines, kind)` —
--      builder nou, pornit din `build_kitchen_ticket_payload` (227→316→329):
--      aceeași linie de sursă (PICKUP / OSPATAR · MASA: / MASA:), aceleași
--      etichete în cele 7 limbi ale lui 329, ASCII, ora pe fusul localului
--      (`restaurant_time_zone`, 324 — o dată, în variabilă) — dar ora e
--      MOMENTUL schimbării (now()), nu al comenzii, iar corpul are DOAR liniile
--      schimbate: `+Nx` (de gătit în plus) apoi `-Nx` (nu mai trebuie).
--        kind = 'change' → antet „*** MODIFICARE ***” (7 limbi), diferența
--          multiset dintre instantaneu și liniile de acum; NULL dacă nu s-a
--          schimbat nimic pentru bucătărie (doar prețul / ordinea liniilor);
--        kind = 'cancel' → antet „*** ANULAT ***” (7 limbi), toate liniile cu
--          `-Nx`, fără nota comenzii.
--      Cheia unei linii = produsul (id; numele doar pe rândurile fără produs)
--      + opțiunile + extra-urile (id-uri SORTATE — ordinea din JSON nu contează)
--      + nota liniei. Deci: un produs redenumit între comandă și editare NU
--      apare ca „-vechi +nou”; unitățile adăugate la prețul de azi (linie
--      separată, 320) apar ca `+1x`, nu ca o linie nouă întreagă.
--   §2 `update_order_items` (lanț 079→…→192→313→320→**333**, aceeași
--      semnătură → `create or replace`) = corpul 320 VERBATIM + trei schimbări:
--        (i)   variabila `v_kt_payload`;
--        (ii)  `v_old_lines` (instantaneul de dinainte de DELETE) poartă și
--              `product_name_snapshot` + `notes` (cheile citite de 320 rămân);
--        (iii) un bloc FINAL exception-wrapped: featurea `kitchen_tickets` +
--              o imprimantă + comanda are deja un tichet ne-anulat → tichetul
--              de MODIFICARE. Un eșec = `raise warning`, editarea trece.
--      Toate invariantele 320 rămân (EO1–EO7, plafonul 20/99, scutirea 130,
--      Happy Hour prin `public_happy_hour_now`, lock-ul optimist 40001,
--      `for update`, plăți parțiale, rezumatul de audit, forma răspunsului).
--   §3 `trg_kitchen_ticket_on_cancel` — AFTER UPDATE OF status pe `orders`,
--      WHEN intrarea în `cancelled`; funcția `enqueue_kitchen_cancel_ticket()`
--      (DEFINER `public, pg_temp`, catch-all `raise warning` — un tichet eșuat
--      NU avortează niciodată anularea):
--        (1) tichetele comenzii încă `pending` (netipărite) → `cancelled`
--            (`error_code = ORDER_CANCELLED`). Race-safe cu bridge-ul: claim-ul
--            (227) cere `status = 'pending'` sub lacăt de rând, iar bridge-ul
--            tipărește DOAR după un claim reușit (menuvia-bridge.js) — ori l-a
--            revendicat întâi (→ `sent`, intră la (2)), ori claim-ul lui dă
--            {claimed:false} și nu tipărește nimic;
--        (2) tichetul ANULAT, doar dacă: comanda venea din new/confirmed/
--            preparing (bucătăria o putea găti încă), anularea e făcută de un
--            OM (`auth.uid()` ne-NULL — janitorul 288, `expire_stale_orders` pe
--            pg_cron fără JWT, ar fi tipărit un ANULAT pentru fiecare comandă
--            uitată, la ore distanță), featurea + imprimanta există și un
--            tichet al comenzii a ajuns la bridge (`sent` / `success` / `error`
--            — `error` include BRIDGE_TIMEOUT, posibil tipărit; hârtie în plus
--            e inofensivă, un bucătar care gătește o comandă anulată nu).
--
-- SUPRAFAȚA: ambele funcții noi sunt DEFINER `public, pg_temp`, cu EXECUTE
-- revocat de la public, anon, authenticated ȘI service_role (default privileges
-- pe Supabase acordă implicit — CJ9): le cheamă doar `update_order_items` și
-- trigger-ul, ca proprietar (RP13 pentru funcția de trigger, AH1). Builder-ul
-- are proprietarul lui `restaurant_time_zone` (altfel 42501, înghițit TĂCUT de
-- catch-all — capcana 329 (h)). ACL-ul lui `update_order_items` e neschimbat
-- (instantaneu înainte/după, asertat) și re-afirmat ca în 313.
--
-- ORDINEA: după 320 (corpul) și 329 (etichetele + fusul — precondiții
-- asertate). O re-aplicare ULTERIOARĂ a lui 320 ar scoate tăcut tichetul de
-- modificare (capcana 290/296) — 320 nu se re-aplică după 333.
-- Teste permanente: tests/sql/auto/333_kitchen_change_tickets.sql (KC0–KC11).
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- ── §0. Precondiții + instantaneul ACL al lui update_order_items ────
do $$
begin
  if to_regprocedure('public.restaurant_time_zone(uuid)') is null then
    raise exception 'mig 333: lipsește public.restaurant_time_zone(uuid) — aplică întâi mig 324';
  end if;
  if to_regprocedure('public.build_kitchen_ticket_payload(uuid, boolean)') is null
     or position('restaurant_language' in (select prosrc from pg_proc
          where oid = 'public.build_kitchen_ticket_payload(uuid, boolean)'::regprocedure)) = 0 then
    raise exception 'mig 333: lipsește build_kitchen_ticket_payload din mig 329 (etichetele în limba localului)';
  end if;
  if to_regprocedure('public.update_order_items(uuid, jsonb, numeric)') is null
     or position('v_same_config' in (select prosrc from pg_proc
          where oid = 'public.update_order_items(uuid, jsonb, numeric)'::regprocedure)) = 0 then
    raise exception 'mig 333: update_order_items nu e cel din mig 320 — aplică întâi mig 320';
  end if;
  if to_regclass('public.kitchen_tickets') is null then
    raise exception 'mig 333: lipsește public.kitchen_tickets (mig 227)';
  end if;
end $$;

create temp table m333_acl_before on commit drop as
select p.oid,
       pg_get_userbyid(p.proowner) as owner,
       coalesce(array_to_string(array(select x::text from unnest(p.proacl) x order by x::text collate "C"), ','), '<implicit>') as acl
  from pg_proc p
 where p.oid = 'public.update_order_items(uuid, jsonb, numeric)'::regprocedure;

-- ── §1. build_kitchen_ticket_change_payload ─────────────────────────
-- p_old_lines: instantaneul liniilor de DINAINTE (kind = 'change'), fie
-- obiectul `v_old_lines` din update_order_items (id → linie), fie un array de
-- linii; fiecare linie: product_id, product_name_snapshot, quantity,
-- selected_modifiers, extras_added, notes. Ignorat pe kind = 'cancel' (atunci
-- „înainte” = liniile de acum, „după” = nimic). Întoarce NULL când nu există
-- nicio diferență pentru bucătărie.
create or replace function public.build_kitchen_ticket_change_payload(
  p_order_id  uuid,
  p_old_lines jsonb,
  p_kind      text
) returns text
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_order   record;
  v_lines   text;
  v_tz      text;
  v_change  text;
  v_cancel  text;
  v_pickup  text;
  v_waiter  text;
  v_table   text;
  v_note    text;
begin
  if p_kind is null or p_kind not in ('change', 'cancel') then
    raise exception 'build_kitchen_ticket_change_payload: kind % invalid (change | cancel)', p_kind;
  end if;
  if p_kind = 'change'
     and jsonb_typeof(p_old_lines) is distinct from 'object'
     and jsonb_typeof(p_old_lines) is distinct from 'array' then
    raise exception 'build_kitchen_ticket_change_payload: kind change cere instantaneul liniilor (object sau array)';
  end if;

  select o.id, o.restaurant_id, o.source, o.notes,
         coalesce(o._table_name_snapshot, t.name) as table_name,
         r.language as restaurant_language
    into v_order
    from public.orders o
    left join public.tables t on t.id = o.table_id
    left join public.restaurants r on r.id = o.restaurant_id
   where o.id = p_order_id;
  if not found then
    raise exception 'build_kitchen_ticket_change_payload: order % not found', p_order_id;
  end if;

  -- Diferența multiset: fiecare linie intră cu semnul ei (înainte = -1,
  -- după = +1), grupată pe cheia de bucătărie; rămân doar cheile cu sumă ≠ 0.
  with prev as (
    select e.value as j
      from jsonb_array_elements(case when p_kind = 'change' and jsonb_typeof(p_old_lines) = 'array'
                                     then p_old_lines else '[]'::jsonb end) e
    union all
    select e.value
      from jsonb_each(case when p_kind = 'change' and jsonb_typeof(p_old_lines) = 'object'
                           then p_old_lines else '{}'::jsonb end) e
  ),
  cur as (
    select jsonb_build_object(
             'product_id',            oi.product_id,
             'product_name_snapshot', oi.product_name_snapshot,
             'quantity',              oi.quantity,
             'selected_modifiers',    coalesce(oi.selected_modifiers, '[]'::jsonb),
             'extras_added',          coalesce(oi.extras_added, '[]'::jsonb),
             'notes',                 oi.notes) as j
      from public.order_items oi
     where oi.order_id = p_order_id
  ),
  sides as (
    select prev.j, -1 as sgn from prev
    union all
    select cur.j, case when p_kind = 'change' then 1 else -1 end from cur
  ),
  keyed as (
    select s.sgn, s.j,
           greatest(coalesce((s.j ->> 'quantity')::int, 0), 0) as qty,
           concat_ws('|',
             coalesce(nullif(s.j ->> 'product_id', ''), 'n:' || coalesce(s.j ->> 'product_name_snapshot', '')),
             (select coalesce(string_agg(x.mk, ',' order by x.mk collate "C"), '')
                from (select coalesce(nullif(m ->> 'option_id', ''), 'n:' || coalesce(m ->> 'option_name', '')) as mk
                        from jsonb_array_elements(case when jsonb_typeof(s.j -> 'selected_modifiers') = 'array'
                                                       then s.j -> 'selected_modifiers' else '[]'::jsonb end) m) x),
             (select coalesce(string_agg(x.ek, ',' order by x.ek collate "C"), '')
                from (select coalesce(nullif(e ->> 'extra_id', ''), nullif(e ->> 'id', ''),
                                      'n:' || coalesce(nullif(e ->> 'extra_name', ''), e ->> 'name', '')) as ek
                        from jsonb_array_elements(case when jsonb_typeof(s.j -> 'extras_added') = 'array'
                                                       then s.j -> 'extras_added' else '[]'::jsonb end) e) x),
             coalesce(btrim(s.j ->> 'notes'), '')) as k
      from sides s
  ),
  grouped as (
    select keyed.k,
           sum(keyed.sgn * keyed.qty) as d,
           (array_agg(keyed.j) filter (where keyed.sgn = 1))[1]  as j_after,
           (array_agg(keyed.j) filter (where keyed.sgn = -1))[1] as j_before
      from keyed
     group by keyed.k
    having sum(keyed.sgn * keyed.qty) <> 0
  ),
  rendered as (
    -- Linia arată ca pe tichetul nou (227→316→329), cu semnul în față: numele
    -- din partea care contează (după pentru +, înainte pentru -).
    select (g.d < 0) as is_removal,
           (case when g.d > 0 then '+' else '-' end) || abs(g.d) || 'x ' ||
           regexp_replace(coalesce(r.j ->> 'product_name_snapshot', ''), '[\r\n\t]', ' ', 'g') ||
           coalesce((
             select string_agg(e'\n   + ' ||
                      regexp_replace(coalesce(m->>'option_name', ''), '[\r\n\t]', ' ', 'g'), '')
               from jsonb_array_elements(case when jsonb_typeof(r.j -> 'selected_modifiers') = 'array'
                                              then r.j -> 'selected_modifiers' else '[]'::jsonb end) m
              where coalesce(m->>'option_name', '') <> ''
           ), '') ||
           coalesce((
             select string_agg(e'\n   + ' ||
                      regexp_replace(coalesce(nullif(x->>'extra_name', ''), x->>'name', ''),
                                     '[\r\n\t]', ' ', 'g'), '')
               from jsonb_array_elements(case when jsonb_typeof(r.j -> 'extras_added') = 'array'
                                              then r.j -> 'extras_added' else '[]'::jsonb end) x
              where coalesce(nullif(x->>'extra_name', ''), x->>'name', '') <> ''
           ), '') ||
           case when coalesce(btrim(r.j ->> 'notes'), '') <> ''
                then e'\n   >> ' || regexp_replace(r.j ->> 'notes', '[\r\n\t]', ' ', 'g')
                else '' end as line
      from grouped g
      cross join lateral (select case when g.d > 0 then g.j_after else g.j_before end as j) r
  )
  select string_agg(rendered.line, e'\n' order by rendered.is_removal, rendered.line collate "C")
    into v_lines
    from rendered;

  if v_lines is null then
    return null;
  end if;

  -- Fusul localului, O SINGURĂ dată (fus invalid → București), ca în 329.
  v_tz := public.restaurant_time_zone(v_order.restaurant_id);

  -- Etichetele în limba de bază a localului — sursa, masa și nota IDENTICE cu
  -- 329 (KC8 le compară cu tichetul nou pe toate limbile); antetele noi. ASCII
  -- pur (imprimanta termică n-are diacritice); NULL / necunoscută → româna.
  case coalesce(v_order.restaurant_language, 'ro')
    when 'en' then
      v_change  := '*** MODIFIED ***';
      v_cancel  := '*** CANCELLED ***';
      v_pickup  := 'PICKUP';
      v_waiter  := 'WAITER';
      v_table   := 'TABLE:';
      v_note    := 'NOTE:';
    when 'de' then
      v_change  := '*** AENDERUNG ***';
      v_cancel  := '*** STORNIERT ***';
      v_pickup  := 'ABHOLUNG';
      v_waiter  := 'SERVICE';
      v_table   := 'TISCH:';
      v_note    := 'HINWEIS:';
    when 'fr' then
      v_change  := '*** MODIFICATION ***';
      v_cancel  := '*** ANNULEE ***';
      v_pickup  := 'A EMPORTER';
      v_waiter  := 'SERVEUR';
      v_table   := 'TABLE:';
      v_note    := 'NOTE:';
    when 'it' then
      v_change  := '*** MODIFICA ***';
      v_cancel  := '*** ANNULLATA ***';
      v_pickup  := 'ASPORTO';
      v_waiter  := 'CAMERIERE';
      v_table   := 'TAVOLO:';
      v_note    := 'NOTA:';
    when 'hu' then
      v_change  := '*** MODOSITAS ***';
      v_cancel  := '*** TOROLVE ***';
      v_pickup  := 'ELVITEL';
      v_waiter  := 'PINCER';
      v_table   := 'ASZTAL:';
      v_note    := 'MEGJEGYZES:';
    when 'es' then
      v_change  := '*** MODIFICACION ***';
      v_cancel  := '*** ANULADA ***';
      v_pickup  := 'PARA RECOGER';
      v_waiter  := 'CAMARERO';
      v_table   := 'MESA:';
      v_note    := 'NOTA:';
    else
      v_change  := '*** MODIFICARE ***';
      v_cancel  := '*** ANULAT ***';
      v_pickup  := 'PICKUP';
      v_waiter  := 'OSPATAR';
      v_table   := 'MASA:';
      v_note    := 'NOTE:';
  end case;

  return case when p_kind = 'cancel' then v_cancel else v_change end
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
    || to_char(now() at time zone v_tz, 'HH24:MI DD.MM')
    || e'\n------------------------------\n'
    || v_lines
    || e'\n------------------------------'
    || case when p_kind = 'change' and coalesce(btrim(v_order.notes), '') <> ''
            then e'\n' || v_note || ' ' || regexp_replace(v_order.notes, '[\r\n\t]', ' ', 'g')
            else '' end;
end$$;

-- Helper intern: îl cheamă doar update_order_items și trigger-ul de anulare,
-- ca proprietar. Nicio cale de client și niciun grant implicit (CJ9).
revoke all on function public.build_kitchen_ticket_change_payload(uuid, jsonb, text)
  from public, anon, authenticated, service_role;

-- ── §2. update_order_items, lanț 079→…→313→320→333 ──────────────────
-- Corpul 320 VERBATIM (review-ul se face pe diff față de 320:101–662) +
-- `v_kt_payload`, numele/nota în `v_old_lines` și blocul final al tichetului
-- de MODIFICARE. Aceeași semnătură → `create or replace`.
create or replace function public.update_order_items(
  p_order_id       uuid,
  p_items          jsonb,
  p_expected_total numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_uid    uuid := auth.uid();
  v_order         public.orders%rowtype;
  v_role          text;
  v_item          jsonb;
  v_product       record;
  v_option_ids    uuid[];
  v_extra_ids     uuid[];
  v_valid_count   integer;
  v_unit_price    numeric(10,2);
  v_options_delta numeric(10,2);
  v_options_json  jsonb;
  v_extras_delta  numeric(10,2);
  v_extras_json   jsonb;
  v_extras_count  integer;
  v_preserved     jsonb;
  v_used          boolean[];
  v_pcount        integer;
  v_idx           integer;
  v_match_idx     integer;
  v_item_total    numeric(10,2);
  v_item_qty      integer;
  v_item_notes    text;
  v_payments_sum  numeric(10,2);
  v_items_count   integer;
  v_was_happy_hour boolean := false;
  v_hh_rule       record;
  v_hh_subtotal   numeric(10,2);
  v_hh_discount   numeric(10,2);
  v_hh_best_disc  numeric(10,2) := 0;
  v_hh_best_name  text;
  v_new_subtotal  numeric(10,2);
  v_old_items     jsonb;
  v_new_items     jsonb;
  v_old_total     numeric(10,2);
  v_group_name    text;
  v_group_min     int;
  v_old_qty       jsonb;
  v_kept_qty      jsonb := '{}'::jsonb;
  v_old_n         integer;
  v_new_n         integer;
  -- mig 320: liniile vechi după id, modul strict și instantaneul liniei-sursă.
  v_old_lines     jsonb;
  v_strict        boolean;
  v_src           jsonb;
  v_src_ids       uuid[] := '{}';
  v_qty_cap       integer;
  v_same_config   boolean;
  v_unavailable   boolean;
  v_kept_part     integer;
  v_new_part      integer;
  v_k_unit        numeric(10,2);
  v_k_opts_json   jsonb;
  v_k_opts_delta  numeric(10,2);
  v_k_extras_json jsonb;
  v_k_extras_delta numeric(10,2);
  -- mig 333: tichetul de MODIFICARE pentru bucătărie (doar diferențele).
  v_kt_payload    text;
begin
  if v_caller_uid is null then
    raise exception 'update_order_items: authentication required';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'update_order_items: order % not found', p_order_id;
  end if;
  v_old_total := v_order.total;

  -- OPTIMISTIC LOCK: comanda nu s-a schimbat de la deschiderea sheet-ului
  if p_expected_total is not null and v_order.total <> p_expected_total then
    raise exception
      'update_order_items: comanda a fost modificată între timp (total %, așteptat %). Redeschide comanda și încearcă din nou.',
      v_order.total, p_expected_total
      using errcode = '40001';
  end if;

  select role::text into v_role
  from public.restaurant_memberships
  where restaurant_id = v_order.restaurant_id
    and user_id = v_caller_uid;

  if v_role is null then
    raise exception 'update_order_items: caller is not a member of this restaurant';
  end if;
  if v_role not in ('owner', 'manager', 'waiter') then
    raise exception 'update_order_items: role % cannot edit orders', v_role;
  end if;

  if v_order.status in ('paid', 'cancelled', 'closed') then
    raise exception 'update_order_items: order is % — cannot edit terminal state', v_order.status;
  end if;

  select coalesce(sum(amount), 0) into v_payments_sum
  from public.order_payments
  where order_id = p_order_id;
  if v_payments_sum > 0 then
    raise exception
      'update_order_items: order has partial payments (% lei). Anulează plățile întâi.',
      v_payments_sum;
  end if;

  v_items_count := jsonb_array_length(coalesce(p_items, '[]'::jsonb));
  if v_items_count = 0 then
    raise exception 'update_order_items: items array empty. Pentru anulare folosește advance_order(cancel).';
  end if;
  if v_items_count > 100 then
    raise exception 'update_order_items: too many items (max 100)';
  end if;

  v_was_happy_hour := v_order.discount_reason is not null
    and v_order.discount_reason like '%Happy Hour%';

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', product_name_snapshot,
           'qty',  quantity,
           'total', item_total
         ) order by product_name_snapshot), '[]'::jsonb)
    into v_old_items
    from public.order_items where order_id = p_order_id;

  -- mig 313: cât era DEJA comandat din fiecare produs (sumă pe produs).
  select coalesce(jsonb_object_agg(s.product_id::text, s.q), '{}'::jsonb)
    into v_old_qty
    from (select product_id, sum(quantity)::int as q
            from public.order_items
           where order_id = p_order_id and product_id is not null
           group by product_id) s;

  -- mig 320: liniile vechi DUPĂ ID (instantaneul complet, înainte de DELETE).
  select coalesce(jsonb_object_agg(id::text, jsonb_build_object(
           'product_id',          product_id,
           'quantity',            quantity,
           'unit_price_snapshot', unit_price_snapshot,
           'selected_modifiers',  coalesce(selected_modifiers, '[]'::jsonb),
           'extras_added',        coalesce(extras_added, '[]'::jsonb),
           -- mig 333: numele și nota liniei, pentru tichetul de modificare.
           'product_name_snapshot', product_name_snapshot,
           'notes',               notes)), '{}'::jsonb)
    into v_old_lines
    from public.order_items where order_id = p_order_id;

  -- Modul strict = clientul nou (cel puțin o linie cu source_item_id).
  select exists (
    select 1 from jsonb_array_elements(p_items) x where x ? 'source_item_id'
  ) into v_strict;

  -- M1 (mig 146) — DOAR pentru clientul vechi: extra-urile păstrate pe produs.
  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', product_id,
           'extras',     coalesce(extras_added, '[]'::jsonb)
         ) order by id), '[]'::jsonb)
    into v_preserved
    from public.order_items where order_id = p_order_id;
  v_pcount := jsonb_array_length(v_preserved);
  v_used   := array_fill(false, array[greatest(v_pcount, 1)]);

  perform set_config('menuvia.skip_item_audit', 'on', true);

  delete from public.order_items where order_id = p_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_qty := (v_item ->> 'quantity')::integer;
    if v_item_qty is null or v_item_qty < 1 then
      raise exception 'update_order_items: invalid quantity (1-%)', case when v_strict then 20 else 99 end
        using errcode = 'P0001', hint = 'invalid_quantity';
    end if;

    select id, restaurant_id, name, price, is_active, is_sold_out, is_draft
    into v_product
    from public.products
    where id = (v_item ->> 'product_id')::uuid;

    if not found then
      raise exception 'update_order_items: product % not found', v_item ->> 'product_id'
        using errcode = 'P0001', hint = 'product_not_found';
    end if;
    if v_product.restaurant_id <> v_order.restaurant_id then
      raise exception 'update_order_items: product does not belong to this restaurant';
    end if;

    -- ── Linia-sursă (mig 320) ──────────────────────────────────────────────
    v_src := null;
    if v_item ? 'source_item_id' and nullif(v_item ->> 'source_item_id', '') is not null then
      v_src := v_old_lines -> (v_item ->> 'source_item_id');
      if v_src is null or (v_src ->> 'product_id') is distinct from v_product.id::text then
        raise exception 'update_order_items: linia sursă nu aparține comenzii sau produsului "%"', v_product.name
          using errcode = 'P0001', hint = 'invalid_source_item';
      end if;
      if (v_item ->> 'source_item_id')::uuid = any (v_src_ids) then
        raise exception 'update_order_items: linia sursă apare de două ori'
          using errcode = 'P0001', hint = 'invalid_source_item';
      end if;
      v_src_ids := v_src_ids || (v_item ->> 'source_item_id')::uuid;
    end if;

    -- ── Plafonul pe linie (recenzia O3a) ───────────────────────────────────
    -- Clientul vechi (fără source_item_id) păstrează plafonul din 313 (1–99):
    -- altfel o comandă cu o linie de 25, scrisă înainte de 320, nu mai putea
    -- fi editată deloc din clientul deja instalat. Clientul nou: 20 pe linie
    -- (ca create_order), dar o linie PĂSTRATĂ își poate ține cantitatea veche
    -- chiar peste 20 — fără excepția asta ar fi trebuit ruptă în două, cu
    -- surplusul re-prețuit la azi.
    v_qty_cap := case
      when not v_strict then 99
      when v_src is not null then greatest(20, coalesce((v_src ->> 'quantity')::int, 0))
      else 20
    end;
    if v_item_qty > v_qty_cap then
      raise exception 'update_order_items: invalid quantity (1-%)', v_qty_cap
        using errcode = 'P0001', hint = 'invalid_quantity';
    end if;

    -- ── Produs indisponibil: rămâne DOAR cantitatea deja comandată (313 → 320:
    -- epuizat, scos din meniu sau ciornă).
    v_unavailable := v_product.is_sold_out is true or not v_product.is_active or v_product.is_draft is true;
    if v_unavailable then
      v_old_n := coalesce((v_old_qty ->> v_product.id::text)::int, 0);
      v_new_n := coalesce((v_kept_qty ->> v_product.id::text)::int, 0) + v_item_qty;
      if v_new_n > v_old_n then
        if v_product.is_sold_out is true then
          raise exception 'update_order_items: produsul "%" este epuizat — poți păstra cel mult cantitatea deja comandată (%)',
            v_product.name, v_old_n
            using errcode = 'P0001', hint = 'product_sold_out';
        else
          raise exception 'update_order_items: produsul "%" nu mai e în meniu — poți păstra cel mult cantitatea deja comandată (%)',
            v_product.name, v_old_n
            using errcode = 'P0001', hint = 'product_inactive';
        end if;
      end if;
      v_kept_qty := jsonb_set(v_kept_qty, array[v_product.id::text], to_jsonb(v_new_n));
    end if;

    v_option_ids := array(
      select (x)::uuid
      from jsonb_array_elements_text(coalesce(v_item -> 'option_ids', '[]'::jsonb)) as x
    );
    if array_length(v_option_ids, 1) <> (
         select count(distinct t.v)
         from jsonb_array_elements_text(coalesce(v_item -> 'option_ids', '[]'::jsonb)) as t(v)
       ) then
      raise exception 'update_order_items: option_ids duplicate pentru produsul "%"', v_product.name
        using errcode = 'P0001', hint = 'duplicate_options';
    end if;

    -- Extra-urile cerute: explicit (`extra_ids`), altfel ale liniei-sursă.
    if v_item ? 'extra_ids' then
      v_extra_ids := array(
        select (x)::uuid from jsonb_array_elements_text(coalesce(v_item -> 'extra_ids', '[]'::jsonb)) as x
      );
      if coalesce(array_length(v_extra_ids, 1), 0) <> (
           select count(distinct t.v)
           from jsonb_array_elements_text(coalesce(v_item -> 'extra_ids', '[]'::jsonb)) as t(v)
         ) then
        raise exception 'update_order_items: extra_ids duplicate pentru produsul "%"', v_product.name
          using errcode = 'P0001', hint = 'duplicate_extras';
      end if;
    elsif v_src is not null then
      v_extra_ids := array(
        select (coalesce(e ->> 'extra_id', e ->> 'id'))::uuid
          from jsonb_array_elements(v_src -> 'extras_added') e
         where coalesce(e ->> 'extra_id', e ->> 'id') is not null
      );
    else
      v_extra_ids := null;  -- clientul vechi / linie nouă fără extra_ids
    end if;

    -- Aceeași configurație ca linia-sursă = aceleași opțiuni ȘI aceleași extra-uri.
    v_same_config := v_src is not null
      and (select coalesce(array_agg(x order by x), '{}') from unnest(v_option_ids) x)
          = (select coalesce(array_agg((m ->> 'option_id')::uuid order by (m ->> 'option_id')::uuid), '{}')
               from jsonb_array_elements(v_src -> 'selected_modifiers') m)
      and (select coalesce(array_agg(x order by x), '{}') from unnest(coalesce(v_extra_ids, '{}')) x)
          = (select coalesce(array_agg((coalesce(e ->> 'extra_id', e ->> 'id'))::uuid
                                       order by (coalesce(e ->> 'extra_id', e ->> 'id'))::uuid), '{}')
               from jsonb_array_elements(v_src -> 'extras_added') e
              where coalesce(e ->> 'extra_id', e ->> 'id') is not null);

    v_kept_part := 0;
    v_new_part  := v_item_qty;
    if v_same_config then
      v_kept_part := least(v_item_qty, (v_src ->> 'quantity')::int);
      v_new_part  := v_item_qty - v_kept_part;
      -- Partea păstrată: prețul, opțiunile și extra-urile din instantaneu.
      v_k_unit        := (v_src ->> 'unit_price_snapshot')::numeric;
      v_k_opts_json   := v_src -> 'selected_modifiers';
      v_k_extras_json := v_src -> 'extras_added';
      select coalesce(sum((m ->> 'price_delta')::numeric), 0) into v_k_opts_delta
        from jsonb_array_elements(v_k_opts_json) m;
      select coalesce(sum((e ->> 'price')::numeric), 0) into v_k_extras_delta
        from jsonb_array_elements(v_k_extras_json) e;
    end if;

    -- ── Partea NOUĂ (linie nouă, configurație schimbată sau unități adăugate):
    -- validare completă pe catalogul de azi, la prețul de azi.
    v_unit_price    := v_product.price;
    v_options_delta := 0;
    v_options_json  := '[]'::jsonb;
    v_extras_delta  := 0;
    v_extras_json   := '[]'::jsonb;
    if v_new_part > 0 then
      if array_length(v_option_ids, 1) > 0 then
        select count(*) into v_valid_count
        from public.modifier_options mo
        join public.modifier_groups mg on mg.id = mo.modifier_group_id
        join public.product_modifier_groups pmg on pmg.modifier_group_id = mg.id
        where mo.id = any(v_option_ids)
          and mo.is_available = true
          and pmg.product_id = v_product.id
          and mg.restaurant_id = v_order.restaurant_id;

        if v_valid_count <> array_length(v_option_ids, 1) then
          raise exception 'update_order_items: invalid options for product "%"', v_product.name
            using errcode = 'P0001', hint = 'invalid_options';
        end if;

        if exists (
          select 1
          from public.modifier_options mo
          join public.modifier_groups mg on mg.id = mo.modifier_group_id
          join public.product_modifier_groups pmg on pmg.modifier_group_id = mg.id
          where mo.id = any(v_option_ids)
            and mo.is_available = true
            and pmg.product_id = v_product.id
            and mg.restaurant_id = v_order.restaurant_id
          group by mg.id, mg.selection_type, mg.max_select
          having count(*) > coalesce(
                   case when mg.selection_type = 'single' then 1 else mg.max_select end,
                   2147483647)
        ) then
          raise exception 'update_order_items: prea multe opțiuni selectate într-un grup pentru produsul "%"', v_product.name
            using errcode = 'P0001', hint = 'too_many_in_group';
        end if;

        select
          coalesce(sum(mo.price_delta), 0),
          coalesce(jsonb_agg(jsonb_build_object(
            'group_id',    mg.id,
            'group_name',  mg.name,
            'option_id',   mo.id,
            'option_name', mo.name,
            'price_delta', mo.price_delta
          )), '[]'::jsonb)
        into v_options_delta, v_options_json
        from public.modifier_options mo
        join public.modifier_groups mg on mg.id = mo.modifier_group_id
        where mo.id = any(v_option_ids);
      end if;

      -- MINIM pe grup (mig 192), paritate create_order.
      v_group_name := null;
      select mg.name,
             least(
               greatest(mg.min_select, case when mg.is_required then 1 else 0 end),
               case when mg.selection_type = 'single' then 1 else 32767 end
             )::int
        into v_group_name, v_group_min
        from public.product_modifier_groups pmg
        join public.modifier_groups mg on mg.id = pmg.modifier_group_id
        left join lateral (
          select count(*) as cnt
            from public.modifier_options mo
           where mo.modifier_group_id = mg.id
             and mo.id = any(v_option_ids)
             and mo.is_available = true
        ) sel on true
       where pmg.product_id = v_product.id
         and mg.restaurant_id = v_order.restaurant_id
         and (mg.is_required or mg.min_select > 0)
         and sel.cnt < least(
               greatest(mg.min_select, case when mg.is_required then 1 else 0 end),
               case when mg.selection_type = 'single' then 1 else 32767 end
             )
       order by pmg.display_order, mg.name
       limit 1;

      if v_group_name is not null then
        raise exception 'update_order_items: grupul "%" pentru produsul "%" cere cel puțin % %',
          v_group_name, v_product.name, v_group_min,
          case when v_group_min = 1 then 'opțiune selectată' else 'opțiuni selectate' end
          using errcode = 'P0001', hint = 'missing_required_group';
      end if;

      if v_extra_ids is not null then
        -- (a) extra-uri cerute explicit sau ale liniei-sursă: validate azi.
        if coalesce(array_length(v_extra_ids, 1), 0) > 0 then
          select
            coalesce(sum(pe.price), 0),
            coalesce(jsonb_agg(jsonb_build_object(
              'extra_id',   pe.id,
              'extra_name', pe.name,
              'price',      pe.price
            )), '[]'::jsonb),
            count(*)
          into v_extras_delta, v_extras_json, v_extras_count
          from unnest(v_extra_ids) eid
          join public.product_extras pe on pe.id = eid
          where pe.product_id = v_product.id
            and pe.is_available = true;

          if v_extras_count <> array_length(v_extra_ids, 1) then
            raise exception 'update_order_items: extras invalide/indisponibile pentru produsul "%"', v_product.name
              using errcode = 'P0001', hint = 'invalid_extras';
          end if;
        end if;
      elsif not v_strict then
        -- (b) M1, DOAR clientul vechi: extra-urile păstrate pe produs.
        v_match_idx := null;
        if v_pcount > 0 then
          for v_idx in 0 .. v_pcount - 1 loop
            if not v_used[v_idx + 1]
               and (v_preserved -> v_idx ->> 'product_id')::uuid = v_product.id then
              v_match_idx := v_idx;
              exit;
            end if;
          end loop;
        end if;
        if v_match_idx is not null then
          v_used[v_match_idx + 1] := true;
          v_extras_json := v_preserved -> v_match_idx -> 'extras';
          select coalesce(sum((e ->> 'price')::numeric), 0)
            into v_extras_delta
            from jsonb_array_elements(v_extras_json) e;
        end if;
      end if;
      -- (c) modul strict, linie nouă fără extra_ids → fără extra-uri.
    end if;

    v_item_notes := nullif(trim(coalesce(v_item ->> 'notes', '')), '');

    -- Partea nouă are același preț unitar ca cea păstrată → o singură linie.
    if v_kept_part > 0 and v_new_part > 0
       and v_k_unit + v_k_opts_delta + v_k_extras_delta = v_unit_price + v_options_delta + v_extras_delta then
      v_kept_part := v_kept_part + v_new_part;
      v_new_part  := 0;
    end if;

    -- GUC-ul pentru trigger-ul 130: DOAR pe linia unui produs indisponibil
    -- (cantitatea a fost verificată mai sus), golit imediat după.
    perform set_config('menuvia.sold_out_keep_order',
                       case when v_unavailable then p_order_id::text else '' end,
                       true);

    if v_kept_part > 0 then
      insert into public.order_items (
        order_id, product_id, product_name_snapshot, unit_price_snapshot,
        quantity, item_total, selected_modifiers, extras_added, notes
      )
      values (
        p_order_id, v_product.id, v_product.name, v_k_unit,
        v_kept_part, (v_k_unit + v_k_opts_delta + v_k_extras_delta) * v_kept_part,
        v_k_opts_json, v_k_extras_json, v_item_notes
      );
    end if;
    if v_new_part > 0 then
      v_item_total := (v_unit_price + v_options_delta + v_extras_delta) * v_new_part;
      insert into public.order_items (
        order_id, product_id, product_name_snapshot, unit_price_snapshot,
        quantity, item_total, selected_modifiers, extras_added, notes
      )
      values (
        p_order_id, v_product.id, v_product.name, v_unit_price,
        v_new_part, v_item_total, v_options_json, v_extras_json, v_item_notes
      );
    end if;

    perform set_config('menuvia.sold_out_keep_order', '', true);
  end loop;

  if v_was_happy_hour then
    select coalesce(sum(item_total), 0) into v_new_subtotal
    from public.order_items where order_id = p_order_id;

    for v_hh_rule in
      select * from public.public_happy_hour_now(v_order.restaurant_id)
    loop
      if v_hh_rule.scope = 'all' then
        v_hh_subtotal := v_new_subtotal;
      elsif v_hh_rule.scope = 'category' then
        select coalesce(sum(oi.item_total), 0) into v_hh_subtotal
          from public.order_items oi
          join public.products p on p.id = oi.product_id
         where oi.order_id = p_order_id and p.category_id = v_hh_rule.category_id;
      elsif v_hh_rule.scope = 'product' then
        select coalesce(sum(oi.item_total), 0) into v_hh_subtotal
          from public.order_items oi
         where oi.order_id = p_order_id and oi.product_id = v_hh_rule.product_id;
      else
        v_hh_subtotal := 0;
      end if;

      if v_hh_subtotal <= 0 then continue; end if;

      if v_hh_rule.discount_type = 'percent' then
        v_hh_discount := round(v_hh_subtotal * v_hh_rule.discount_value / 100, 2);
      else
        v_hh_discount := least(v_hh_rule.discount_value, v_hh_subtotal);
      end if;

      if v_hh_rule.max_discount is not null and v_hh_discount > v_hh_rule.max_discount then
        v_hh_discount := v_hh_rule.max_discount;
      end if;

      if v_hh_discount > v_hh_best_disc then
        v_hh_best_disc := v_hh_discount;
        v_hh_best_name := v_hh_rule.name;
      end if;
    end loop;

    update public.orders
       set discount_type   = case when v_hh_best_disc > 0 then 'amount'::public.order_discount_type else null end,
           discount_value  = case when v_hh_best_disc > 0 then v_hh_best_disc else null end,
           discount_reason = case
             when v_hh_best_disc > 0 then '🎉 Happy Hour: ' || coalesce(v_hh_best_name, '')
             else null
           end
     where id = p_order_id;
  end if;

  perform public._refresh_order_totals(p_order_id);

  select * into v_order from public.orders where id = p_order_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', product_name_snapshot,
           'qty',  quantity,
           'total', item_total
         ) order by product_name_snapshot), '[]'::jsonb)
    into v_new_items
    from public.order_items where order_id = p_order_id;

  begin
    insert into public.audit_log (
      actor_id, actor_role, table_name, operation, row_id,
      restaurant_id, old_data, new_data, changed_keys
    ) values (
      v_caller_uid,
      coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user),
      'order_items', 'UPDATE', p_order_id::text,
      v_order.restaurant_id,
      jsonb_build_object('items', v_old_items, 'total', v_old_total),
      jsonb_build_object('items', v_new_items, 'total', v_order.total),
      array['items', 'total']
    );
  exception when others then
    raise warning 'update_order_items: audit summary insert failed: %', sqlerrm;
  end;

  -- mig 333: tichetul de MODIFICARE la imprimanta bucătăriei — DOAR liniile
  -- schimbate (+N / −N) față de instantaneul de dinainte (`v_old_lines`).
  -- Gate: featurea `kitchen_tickets` + o imprimantă de bucătărie + comanda are
  -- deja un tichet care n-a fost anulat (bucătăria are sau va avea originalul;
  -- fără el, un „+1” n-ar avea la ce se adăuga). Tichet NEfiscal, hârtie, nu
  -- bani: un eșec NU avortează niciodată editarea (catch-all, ca
  -- enqueue_kitchen_ticket 227). Payload-ul e STOCAT (limba/fusul de acum).
  begin
    if public.restaurant_has_feature(v_order.restaurant_id, 'kitchen_tickets')
       and exists (select 1 from public.bridge_devices
                    where restaurant_id = v_order.restaurant_id
                      and prints_kitchen_receipts = true)
       and exists (select 1 from public.kitchen_tickets
                    where order_id = p_order_id and status <> 'cancelled') then
      v_kt_payload := public.build_kitchen_ticket_change_payload(p_order_id, v_old_lines, 'change');
      -- NULL = nimic de schimbat pentru bucătărie (doar prețul / ordinea).
      if v_kt_payload is not null then
        insert into public.kitchen_tickets (restaurant_id, order_id, payload)
        values (v_order.restaurant_id, p_order_id, v_kt_payload);
      end if;
    end if;
  exception when others then
    raise warning 'update_order_items: kitchen change ticket skipped for order %: %', p_order_id, sqlerrm;
  end;

  return jsonb_build_object(
    'id',              v_order.id,
    'total',           v_order.total,
    'discount_amount', v_order.discount_amount,
    'items_count',     v_items_count
  );
end;
$$;

-- ACL-ul: `create or replace` păstrează ACL-ul și proprietarul 320 —
-- verificat ÎNAINTEA re-afirmării de mai jos (paritate 329 (g)).
do $$
declare
  v_acl text;
begin
  select coalesce(array_to_string(array(select x::text from unnest(p.proacl) x order by x::text collate "C"), ','), '<implicit>')
    into v_acl
    from pg_proc p where p.oid = 'public.update_order_items(uuid, jsonb, numeric)'::regprocedure;
  if (select count(*) from pg_temp.m333_acl_before) <> 1
     or v_acl is distinct from (select acl from pg_temp.m333_acl_before)
     or (select pg_get_userbyid(proowner) from pg_proc
          where oid = 'public.update_order_items(uuid, jsonb, numeric)'::regprocedure)
        is distinct from (select owner from pg_temp.m333_acl_before) then
    raise exception 'ASSERT FAIL (mig 333): create or replace a schimbat ACL-ul/proprietarul lui update_order_items (% → %)',
      (select acl from pg_temp.m333_acl_before), v_acl;
  end if;
end $$;

-- Re-afirmat ca în 313: RPC de personal, nu de oaspete.
revoke all on function public.update_order_items(uuid, jsonb, numeric) from public, anon;
grant execute on function public.update_order_items(uuid, jsonb, numeric) to authenticated;

-- ── §3. Tichetul ANULAT: trigger la intrarea comenzii în `cancelled` ──
create or replace function public.enqueue_kitchen_cancel_ticket()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_payload text;
begin
  begin
    -- (1) Ce n-a ajuns încă la imprimantă nu mai pleacă. Race-safe cu bridge-ul:
    --     claim-ul (227) cere status = 'pending' sub lacătul rândului, iar
    --     bridge-ul tipărește DOAR după un claim reușit.
    update public.kitchen_tickets
       set status = 'cancelled', completed_at = now(), error_code = 'ORDER_CANCELLED'
     where order_id = new.id and status = 'pending';

    -- (2) Tichetul ANULAT — doar pentru o comandă pe care bucătăria o putea
    --     găti încă (new / confirmed / preparing) ...
    if old.status not in ('new', 'confirmed', 'preparing') then
      return null;
    end if;
    -- ... anulată de un OM: janitorul 288 (expire_stale_orders, pg_cron, fără
    -- JWT) n-are voie să tipărească câte un ANULAT pentru fiecare comandă uitată.
    if auth.uid() is null then
      return null;
    end if;
    if not public.restaurant_has_feature(new.restaurant_id, 'kitchen_tickets') then
      return null;
    end if;
    if not exists (
      select 1 from public.bridge_devices
       where restaurant_id = new.restaurant_id and prints_kitchen_receipts = true
    ) then
      return null;
    end if;
    -- ... și doar dacă un tichet al ei a ajuns la bridge (sent / success /
    -- error — error include BRIDGE_TIMEOUT, posibil tipărit).
    if not exists (
      select 1 from public.kitchen_tickets
       where order_id = new.id and status in ('sent', 'success', 'error')
    ) then
      return null;
    end if;
    v_payload := public.build_kitchen_ticket_change_payload(new.id, null, 'cancel');
    if v_payload is null then
      return null;
    end if;
    insert into public.kitchen_tickets (restaurant_id, order_id, payload)
    values (new.restaurant_id, new.id, v_payload);
  exception when others then
    -- Un tichet pierdut e hârtie, nu bani — anularea trece mai departe.
    raise warning 'enqueue_kitchen_cancel_ticket skipped for order %: %', new.id, sqlerrm;
  end;
  return null;
end$$;

-- Funcție de TRIGGER: nicio cale /rpc (RP13), niciun grant implicit (CJ9).
revoke all on function public.enqueue_kitchen_cancel_ticket()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_kitchen_ticket_on_cancel on public.orders;
create trigger trg_kitchen_ticket_on_cancel
  after update of status on public.orders
  for each row
  when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
  execute function public.enqueue_kitchen_cancel_ticket();

-- ── §4. Asserții fail-closed ────────────────────────────────────────
do $$
declare
  c_bld  constant regprocedure := 'public.build_kitchen_ticket_change_payload(uuid, jsonb, text)'::regprocedure;
  c_trg  constant regprocedure := 'public.enqueue_kitchen_cancel_ticket()'::regprocedure;
  c_uoi  constant regprocedure := 'public.update_order_items(uuid, jsonb, numeric)'::regprocedure;
  v_n    int;
  v_src  text;
  v_bad  text;
  v_lang text;
  v_role text;
  v_fn   regprocedure;
begin
  -- (a) builder: o semnătură, STABLE DEFINER, search_path exact, fără client,
  --     proprietarul lui restaurant_time_zone, fusul O dată, ASCII, 7 limbi.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'build_kitchen_ticket_change_payload';
  if v_n <> 1 then
    raise exception 'ASSERT FAIL (mig 333): build_kitchen_ticket_change_payload are % semnături (aștept 1)', v_n;
  end if;
  if not (select p.prosecdef and p.provolatile = 's' from pg_proc p where p.oid = c_bld) then
    raise exception 'ASSERT FAIL (mig 333): builder-ul trebuie să fie STABLE SECURITY DEFINER';
  end if;
  foreach v_fn in array array[c_bld, c_trg] loop
    if not exists (select 1 from pg_proc p, unnest(p.proconfig) c(e)
                    where p.oid = v_fn
                      and lower(regexp_replace(c.e, '[[:space:]]+', '', 'g')) = 'search_path=public,pg_temp') then
      raise exception 'ASSERT FAIL (mig 333): % fără search_path = public, pg_temp', v_fn;
    end if;
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(v_role, v_fn, 'execute') then
        raise exception 'ASSERT FAIL (mig 333): % apelabil de %', v_fn, v_role;
      end if;
    end loop;
    if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = v_fn and a.grantee = 0) then
      raise exception 'ASSERT FAIL (mig 333): % executabil de PUBLIC', v_fn;
    end if;
  end loop;
  if (select proowner from pg_proc where oid = c_bld)
     is distinct from (select proowner from pg_proc where oid = 'public.restaurant_time_zone(uuid)'::regprocedure) then
    raise exception 'ASSERT FAIL (mig 333): builder-ul are alt proprietar decât restaurant_time_zone (42501 tăcut la enqueue)';
  end if;
  select prosrc into v_src from pg_proc where oid = c_bld;
  if position('''Europe/Bucharest''' in v_src) > 0 then
    raise exception 'ASSERT FAIL (mig 333): literalul de fus București în builder';
  end if;
  v_n := (length(v_src) - length(replace(v_src, 'restaurant_time_zone(', ''))) / length('restaurant_time_zone(');
  if v_n <> 1 or position('safe_time_zone(' in v_src) > 0 or position('at time zone v_tz' in v_src) = 0 then
    raise exception 'ASSERT FAIL (mig 333): fusul evaluat de % ori / ocolind restaurant_time_zone', v_n;
  end if;
  if position('extra_name' in v_src) = 0 then
    raise exception 'ASSERT FAIL (mig 333): builder-ul nu citește extra_name (mig 316)';
  end if;
  foreach v_lang in array array['en', 'de', 'fr', 'it', 'hu', 'es'] loop
    if position(format('when %L then', v_lang) in v_src) = 0 then
      raise exception 'ASSERT FAIL (mig 333): lipsește ramura de etichete pentru limba %', v_lang;
    end if;
  end loop;
  if position('coalesce(v_order.restaurant_language, ''ro'')' in v_src) = 0
     or position('''*** MODIFICARE ***''' in v_src) = 0
     or position('''*** ANULAT ***''' in v_src) = 0 then
    raise exception 'ASSERT FAIL (mig 333): rezerva românească lipsește din CASE';
  end if;
  select string_agg(btrim(l), ' | ') into v_bad
    from regexp_split_to_table(v_src, e'\n') l
   where l ~ ':= ''' and l !~ '^[ -~]*$';
  if v_bad is not null then
    raise exception 'ASSERT FAIL (mig 333): etichete ne-ASCII pe tichet: %', v_bad;
  end if;

  -- (b) funcția de trigger: DEFINER, catch-all, gate-ul pe om, nu pică JL1
  --     (fără „now() -” — nu e un janitor).
  select prosrc into v_src from pg_proc where oid = c_trg;
  if not (select prosecdef from pg_proc where oid = c_trg)
     or position('exception when others' in v_src) = 0
     or position('raise warning' in v_src) = 0
     or position('auth.uid() is null' in v_src) = 0
     or position('status = ''pending''' in v_src) = 0
     or position('''kitchen_tickets''' in v_src) = 0
     or position('prints_kitchen_receipts' in v_src) = 0
     or v_src ~* 'now\(\)[[:space:]]*-' then
    raise exception 'ASSERT FAIL (mig 333): enqueue_kitchen_cancel_ticket a pierdut un invariant';
  end if;

  -- (c) trigger-ul: AFTER UPDATE ROW (tgtype 17 EXACT), UPDATE OF status ȘI
  --     doar status, cu WHEN, ne-amânat, activ.
  if not exists (
    select 1 from pg_trigger t
     where t.tgname = 'trg_kitchen_ticket_on_cancel'
       and t.tgrelid = 'public.orders'::regclass
       and t.tgfoid = c_trg
       and t.tgtype = 17
       and t.tgenabled = 'O'
       and not t.tgdeferrable
       and t.tgqual is not null
       -- int2vector → text = numerele coloanelor separate prin spațiu
       and t.tgattr::text = (select attnum::text from pg_attribute
                              where attrelid = 'public.orders'::regclass and attname = 'status')
  ) then
    raise exception 'ASSERT FAIL (mig 333): trg_kitchen_ticket_on_cancel lipsește sau are altă formă';
  end if;
  -- trigger-ul de enqueue 227 rămâne neatins (after insert, deferred)
  if not exists (
    select 1 from pg_trigger
     where tgname = 'trg_enqueue_kitchen_ticket' and tgrelid = 'public.orders'::regclass
       and tgtype = 5 and tgdeferrable and tginitdeferred
  ) then
    raise exception 'ASSERT FAIL (mig 333): trg_enqueue_kitchen_ticket (227) nu mai e after insert deferred';
  end if;

  -- (d) update_order_items: o semnătură, invariantele 079…320 + blocul nou.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'update_order_items') <> 1 then
    raise exception 'ASSERT FAIL (mig 333): update_order_items trebuie să aibă O singură semnătură';
  end if;
  select prosrc into v_src from pg_proc where oid = c_uoi;
  if v_src !~ 'source_item_id' or v_src !~ 'v_same_config' or v_src !~ 'not v_strict'
     or v_src !~ 'for update' or v_src !~ '40001' or v_src !~ 'missing_required_group'
     or v_src !~ 'too_many_in_group' or v_src !~ 'duplicate_options' or v_src !~ 'skip_item_audit'
     or v_src !~ '_refresh_order_totals' or v_src !~ 'public_happy_hour_now' or v_src !~ 'partial payments'
     or v_src !~ 'sold_out_keep_order' or v_src !~ 'invalid_quantity' or v_src !~ 'greatest\(20' then
    raise exception 'ASSERT FAIL (mig 333): update_order_items a pierdut un invariant al lanțului 079…320';
  end if;
  if position('build_kitchen_ticket_change_payload(p_order_id, v_old_lines, ''change'')' in v_src) = 0
     or position('kitchen change ticket skipped' in v_src) = 0
     or position('''product_name_snapshot'', product_name_snapshot' in v_src) = 0 then
    raise exception 'ASSERT FAIL (mig 333): update_order_items fără tichetul de modificare (catch-all)';
  end if;
  if not exists (select 1 from pg_proc p, unnest(p.proconfig) c(e)
                  where p.oid = c_uoi
                    and lower(regexp_replace(c.e, '[[:space:]]+', '', 'g')) = 'search_path=public,pg_temp') then
    raise exception 'ASSERT FAIL (mig 333): update_order_items fără search_path = public, pg_temp';
  end if;
  if has_function_privilege('anon', c_uoi, 'execute')
     or not has_function_privilege('authenticated', c_uoi, 'execute') then
    raise exception 'ASSERT FAIL (mig 333): ACL-ul lui update_order_items (anon interzis, authenticated permis)';
  end if;

  -- (e) coada rămâne închisă scrierilor directe de client (227).
  if has_table_privilege('authenticated', 'public.kitchen_tickets', 'INSERT')
     or has_table_privilege('authenticated', 'public.kitchen_tickets', 'UPDATE') then
    raise exception 'ASSERT FAIL (mig 333): authenticated poate scrie direct în kitchen_tickets';
  end if;

  raise notice 'mig 333: tichetele de MODIFICARE și ANULARE pentru bucătărie OK';
end $$;

commit;
