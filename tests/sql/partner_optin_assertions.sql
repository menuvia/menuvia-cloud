-- tests/sql/partner_optin_assertions.sql
-- =============================================================================
-- Aserții permanente pentru mig 286 — accesul partenerului (afiliat) e OPT-IN
-- (consimțământul ownerului) și RESTRÂNS (doar meniu + mese/QR, prin politici
-- dedicate; NU prin funelul is_admin/is_member/my_role).
--
--   PO1  FĂRĂ consimțământ: partenerul vede ZERO rânduri în TOATE tabelele cu
--        `restaurant_id` (descoperire automată — o tabelă viitoare cu perechea
--        intră în verificare fără să atingi testul), inclusiv meniul și
--        `restaurants`.
--   PO2  Cererea (request_partner_access) NU acordă nimic; cererea pe atribuirea
--        ALTUIA și consimțământul pus de afiliat/străin/fondator sunt respinse.
--   PO3  CU consimțământ: meniul + mesele/QR + vat_rates (citire) DA — iar
--        orders/order_items/order_payments, reservations, oblio_configs,
--        pending_receipts, invite_tokens, restaurant_memberships și ORICE altă
--        tabelă cu restaurant_id = 0 rânduri. Controlul POZITIV: ownerul vede
--        tot. Cross-tenant: partenerul nu vede nimic din alt restaurant.
--   PO4  Scrierea partenerului: meniu DA (categorie/produs/masă); comenzi,
--        setări (UPDATE restaurants), oblio_configs, pending_receipts,
--        memberships NU; nu-și poate pune singur consimțământul (UPDATE pe
--        affiliate_attributions refuzat).
--   PO5  Revocarea → 0 peste tot, apoi o nouă cerere NU readuce accesul;
--        re-acordarea îl readuce. Manager membru poate acorda/revoca.
--   PO6  Filtrele păstrate din 193: atribuire terminală (canceled) și afiliat
--        ne-activ → fără acces, chiar cu consimțământ.
--   PO7  Fondatorul (is_platform_admin, escape-ul 186) PĂSTREAZĂ accesul total.
--   PO8  list_partner_restaurants oglindește has_partner_access; stările din
--        get_partner_access / list_partner_attributions sunt corecte.
--   PO9  Catalog: funelul NU conține has_partner_access (INVERSUL asserției
--        mig 187) dar păstrează is_platform_admin; setul tabelelor cu politică
--        de partener e EXACT cel permis; privilegiile RPC-urilor noi.
--   PO10 Auditul: cerere/acordare/revocare în platform_audit_log.
--
-- TOATE verificările de acces rulează sub rolul REAL `authenticated` (ca
-- postgres RLS-ul e ocolit și testul ar fi orb). Self-contained, ROLLBACK.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a1000000-0000-4000-8000-0000000000a1','po-owner1@po.test'),
  ('a1000000-0000-4000-8000-0000000000a2','po-owner2@po.test'),
  ('a1000000-0000-4000-8000-0000000000a3','po-partner@po.test'),
  ('a1000000-0000-4000-8000-0000000000a4','po-partner-b@po.test'),
  ('a1000000-0000-4000-8000-0000000000a5','po-stranger@po.test'),
  ('a1000000-0000-4000-8000-0000000000a6','po-founder@po.test'),
  ('a1000000-0000-4000-8000-0000000000a7','po-manager@po.test');
update public.profiles set plan = 'enterprise'
 where id in ('a1000000-0000-4000-8000-0000000000a1','a1000000-0000-4000-8000-0000000000a2');
update public.profiles set is_platform_admin = true
 where id = 'a1000000-0000-4000-8000-0000000000a6';

-- Restaurantele se DEZACTIVEAZĂ după seed (un restaurant inactiv nu primește
-- comenzi): citirile publice (anon) pe meniu cer restaurant
-- activ, deci un cont fără drepturi vede 0 rânduri peste tot — orice rând vizibil
-- partenerului vine din politicile de partener, nu din citirea publică.
insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-0000000000a1','PO Bistro','po-bistro','Cluj',true),
  ('a1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-0000000000a2','PO Altul','po-altul','Cluj',true);

insert into public.restaurant_memberships (restaurant_id, user_id, role) values
  ('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-0000000000a7','manager');

-- Meniu + mese/QR pe R1 (produsul p1 e DRAFT: nici public nu l-ar vedea).
insert into public.categories (id, restaurant_id, name) values
  ('a1000000-0000-4000-8000-0000000000c0','a1000000-0000-4000-8000-000000000001','Cat PO'),
  ('a1000000-0000-4000-8000-0000000000c9','a1000000-0000-4000-8000-000000000002','Cat PO altul');
insert into public.products (id, restaurant_id, name, price, is_active, is_draft) values
  ('a1000000-0000-4000-8000-0000000000b1','a1000000-0000-4000-8000-000000000001','Produs PO 1',50,true,true),
  ('a1000000-0000-4000-8000-0000000000b2','a1000000-0000-4000-8000-000000000001','Produs PO 2',30,true,false),
  ('a1000000-0000-4000-8000-0000000000b9','a1000000-0000-4000-8000-000000000002','Produs PO altul',20,true,false);
insert into public.product_extras (product_id, name, price) values
  ('a1000000-0000-4000-8000-0000000000b1','Extra PO',3);
insert into public.product_pairings (product_id, paired_product_id) values
  ('a1000000-0000-4000-8000-0000000000b1','a1000000-0000-4000-8000-0000000000b2');
insert into public.modifier_groups (id, restaurant_id, name) values
  ('a1000000-0000-4000-8000-0000000000d0','a1000000-0000-4000-8000-000000000001','Grup PO');
insert into public.modifier_options (modifier_group_id, name) values
  ('a1000000-0000-4000-8000-0000000000d0','Opțiune PO');
insert into public.product_modifier_groups (product_id, modifier_group_id) values
  ('a1000000-0000-4000-8000-0000000000b1','a1000000-0000-4000-8000-0000000000d0');
insert into public.tables (id, restaurant_id, name, slug) values
  ('a1000000-0000-4000-8000-0000000000e0','a1000000-0000-4000-8000-000000000001','Masa PO','masa-po');
insert into public.qr_tokens (restaurant_id, table_id) values
  ('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-0000000000e0');

-- Date SENSIBILE pe R1 (ce partenerul NU are voie să vadă).
insert into public.orders (id, restaurant_id, source, status) values
  ('a1000000-0000-4000-8000-0000000000f0','a1000000-0000-4000-8000-000000000001','waiter','new');
insert into public.order_items (order_id, product_name_snapshot, unit_price_snapshot, item_total) values
  ('a1000000-0000-4000-8000-0000000000f0','Produs PO 2',30,30);
insert into public.order_payments (order_id, amount, method) values
  ('a1000000-0000-4000-8000-0000000000f0',10,'cash');
insert into public.reservations (restaurant_id, customer_name, customer_phone, party_size, starts_at, ends_at) values
  ('a1000000-0000-4000-8000-000000000001','Client PO','+40700000001',2,
   now() + interval '3 days', now() + interval '3 days 2 hours');
insert into public.oblio_configs (restaurant_id, api_email, api_secret, company_cif, company_name) values
  ('a1000000-0000-4000-8000-000000000001','po@po.test','SECRET-PO','RO123','PO SRL');
insert into public.pending_receipts (restaurant_id, order_id, payload, total_snapshot) values
  ('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-0000000000f0','payload-po',30);
insert into public.invite_tokens (restaurant_id, email, role) values
  ('a1000000-0000-4000-8000-000000000001','invitat@po.test','waiter');

-- Acum inactive: citirile publice (anon) pe meniu cer restaurant activ, deci un
-- cont fără drepturi vede 0 rânduri peste tot — orice rând vizibil partenerului
-- vine din politicile de partener, nu din citirea publică.
update public.restaurants set is_active = false
 where id in ('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002');

-- Afiliați + atribuiri. PA aduce O1 (cu R1); PB aduce O2 (cu R2).
insert into public.affiliates (id, profile_id, referral_code) values
  ('a1000000-0000-4000-8000-0000000000aa','a1000000-0000-4000-8000-0000000000a3','popartnera1'),
  ('a1000000-0000-4000-8000-0000000000ab','a1000000-0000-4000-8000-0000000000a4','popartnerb1');
insert into public.affiliate_attributions (id, affiliate_id, referred_profile_id, status, source) values
  ('a1000000-0000-4000-8000-0000000000ca','a1000000-0000-4000-8000-0000000000aa','a1000000-0000-4000-8000-0000000000a1','active','link'),
  ('a1000000-0000-4000-8000-0000000000cb','a1000000-0000-4000-8000-0000000000ab','a1000000-0000-4000-8000-0000000000a2','active','link');

-- ── Helper de test: ce rânduri vede apelantul (INVOKER → RLS-ul apelantului) ─
create or replace function public.po_vis(p_rid uuid)
returns jsonb
language plpgsql
as $$
declare
  r   record;
  n   bigint;
  out jsonb := '{}'::jsonb;
begin
  -- Descoperire AUTOMATĂ: orice tabelă din public cu coloana restaurant_id.
  for r in
    select c.relname
      from pg_class c
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'restaurant_id' and not a.attisdropped
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
       and c.relname <> 'platform_audit_log'
     order by 1
  loop
    begin
      execute format('select count(*) from public.%I where restaurant_id = $1', r.relname)
        into n using p_rid;
    exception when insufficient_privilege then n := 0;
    end;
    out := out || jsonb_build_object(r.relname, n);
  end loop;
  -- Tabele fără restaurant_id (legate prin părinte) + restaurants însuși.
  select count(*) into n from public.restaurants where id = p_rid;
  out := out || jsonb_build_object('restaurants', n);
  select count(*) into n from public.modifier_options mo
    join public.modifier_groups mg on mg.id = mo.modifier_group_id where mg.restaurant_id = p_rid;
  out := out || jsonb_build_object('modifier_options', n);
  select count(*) into n from public.product_extras x
    join public.products p on p.id = x.product_id where p.restaurant_id = p_rid;
  out := out || jsonb_build_object('product_extras', n);
  select count(*) into n from public.product_pairings x
    join public.products p on p.id = x.product_id where p.restaurant_id = p_rid;
  out := out || jsonb_build_object('product_pairings', n);
  select count(*) into n from public.product_modifier_groups x
    join public.products p on p.id = x.product_id where p.restaurant_id = p_rid;
  out := out || jsonb_build_object('product_modifier_groups', n);
  begin
    select count(*) into n from public.order_items oi
      join public.orders o on o.id = oi.order_id where o.restaurant_id = p_rid;
  exception when insufficient_privilege then n := 0; end;
  out := out || jsonb_build_object('order_items', n);
  begin
    select count(*) into n from public.order_payments op
      join public.orders o on o.id = op.order_id where o.restaurant_id = p_rid;
  exception when insufficient_privilege then n := 0; end;
  out := out || jsonb_build_object('order_payments', n);
  return out;
end $$;
grant execute on function public.po_vis(uuid) to authenticated;

-- Tabelele pe care partenerul are voie să le vadă DUPĂ consimțământ.
create temp table po_menu (t text primary key);
insert into po_menu values ('restaurants'),('categories'),('products'),('product_extras'),
  ('product_pairings'),('modifier_groups'),('modifier_options'),('product_modifier_groups'),
  ('tables'),('qr_tokens'),('vat_rates');
grant select on po_menu to authenticated;

-- Rezultatul vizibilității, per identitate (scris DUPĂ ce revenim la postgres).
create temp table po_seen (who text, rid uuid, j jsonb);
grant insert, select on po_seen to authenticated;

-- ═══════ PO1: fără consimțământ → ZERO peste tot ═══════════════════════════
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-0000000000a3', true);
set local role authenticated;
insert into po_seen select 'partner_none', 'a1000000-0000-4000-8000-000000000001'::uuid,
  public.po_vis('a1000000-0000-4000-8000-000000000001');
reset role;

do $$
declare v_j jsonb; v_k text; v_n bigint; v_has boolean;
begin
  select j into v_j from po_seen where who = 'partner_none';
  for v_k, v_n in select key, value::bigint from jsonb_each_text(v_j) loop
    if v_n <> 0 then
      raise exception 'PO1 FAIL: partener FĂRĂ consimțământ vede % rânduri în %', v_n, v_k;
    end if;
  end loop;
  if (select count(*) from jsonb_object_keys(v_j)) < 40 then
    raise exception 'PO1 FAIL: descoperirea tabelelor cu restaurant_id a găsit prea puține (% chei) — verificare vacuă',
      (select count(*) from jsonb_object_keys(v_j));
  end if;
  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-0000000000a3', true);
  set local role authenticated;
  v_has := public.has_partner_access('a1000000-0000-4000-8000-000000000001');
  reset role;
  if v_has then raise exception 'PO1 FAIL: has_partner_access true fără consimțământ'; end if;
  raise notice 'PO1 OK: fără consimțământ, % tabele verificate, 0 rânduri', (select count(*) from jsonb_object_keys(v_j));
end $$;

-- ═══════ PO2: cererea nu acordă; cereri/consimțăminte nepermise ═════════════
do $$
declare v jsonb; v_aa record; v_who uuid;
begin
  -- (a) partenerul cere pe atribuirea LUI.
  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-0000000000a3', true);
  set local role authenticated;
  v := public.request_partner_access('a1000000-0000-4000-8000-0000000000ca');
  reset role;
  if v->>'ok' is distinct from 'true' or v->>'state' is distinct from 'requested' then
    raise exception 'PO2 FAIL: cererea proprie a întors %', v; end if;
  select * into v_aa from public.affiliate_attributions where id = 'a1000000-0000-4000-8000-0000000000ca';
  if v_aa.partner_access_requested_at is null or v_aa.owner_consented_at is not null then
    raise exception 'PO2 FAIL: cererea a setat/nu a setat coloanele corect'; end if;

  -- (b) partenerul B NU poate cere pe atribuirea partenerului A.
  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-0000000000a4', true);
  set local role authenticated;
  begin
    perform public.request_partner_access('a1000000-0000-4000-8000-0000000000ca');
    reset role;
    raise exception 'PO2 FAIL: afiliatul B a putut cere pe atribuirea lui A';
  exception when others then
    reset role;
    if sqlerrm not like 'Acces interzis%' then raise; end if;
  end;

  -- (c) afiliatul nu-și poate acorda singur accesul; nici un străin; nici fondatorul.
  foreach v_who in array array[
    'a1000000-0000-4000-8000-0000000000a3'::uuid,   -- afiliatul însuși
    'a1000000-0000-4000-8000-0000000000a5'::uuid,   -- străin
    'a1000000-0000-4000-8000-0000000000a2'::uuid,   -- owner ALTUI cont
    'a1000000-0000-4000-8000-0000000000a6'::uuid    -- fondator (consimțământul nu se pune în numele ownerului)
  ] loop
    perform set_config('request.jwt.claim.sub', v_who::text, true);
    set local role authenticated;
    begin
      perform public.grant_partner_access('a1000000-0000-4000-8000-0000000000ca');
      reset role;
      raise exception 'PO2 FAIL: % a putut acorda accesul', v_who;
    exception when others then
      reset role;
      if sqlerrm not like 'Acces interzis%' then raise; end if;
    end;
  end loop;

  -- (d) nu se poate acorda fără cerere (PB: atribuirea cb nu are cerere; owner O2 încearcă).
  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-0000000000a2', true);
  set local role authenticated;
  v := public.grant_partner_access('a1000000-0000-4000-8000-0000000000cb');
  reset role;
  if v->>'ok' is distinct from 'false' then
    raise exception 'PO2 FAIL: acordare fără cerere a trecut: %', v; end if;

  -- (e) după toate astea: tot ZERO pentru partener.
  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-0000000000a3', true);
  set local role authenticated;
  v := public.po_vis('a1000000-0000-4000-8000-000000000001');
  reset role;
  if (select coalesce(sum(value::bigint),0) from jsonb_each_text(v)) <> 0 then
    raise exception 'PO2 FAIL: cererea (neaprobată) a dat acces: %', v; end if;
  raise notice 'PO2 OK: cererea nu acordă; afiliat/străin/alt owner/fondator nu pot acorda';
end $$;

-- ═══════ PO3: owner acordă → meniu DA, restul 0; owner vede tot ═════════════
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
insert into po_seen select 'owner_before', 'a1000000-0000-4000-8000-000000000001'::uuid,
  public.po_vis('a1000000-0000-4000-8000-000000000001');
select public.grant_partner_access('a1000000-0000-4000-8000-0000000000ca');
reset role;

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-0000000000a3', true);
set local role authenticated;
insert into po_seen select 'partner_granted', 'a1000000-0000-4000-8000-000000000001'::uuid,
  public.po_vis('a1000000-0000-4000-8000-000000000001');
insert into po_seen select 'partner_granted_other_tenant', 'a1000000-0000-4000-8000-000000000002'::uuid,
  public.po_vis('a1000000-0000-4000-8000-000000000002');
reset role;

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-0000000000a5', true);
set local role authenticated;
insert into po_seen select 'stranger', 'a1000000-0000-4000-8000-000000000001'::uuid,
  public.po_vis('a1000000-0000-4000-8000-000000000001');
reset role;

do $$
declare v_j jsonb; v_o jsonb; v_k text; v_n bigint; v_ownern bigint;
begin
  select j into v_j from po_seen where who = 'partner_granted';
  select j into v_o from po_seen where who = 'owner_before';

  -- Meniul + mese/QR + vat_rates: partenerul vede (R1 e inactiv → public nu le dă).
  foreach v_k in array array['restaurants','categories','products','product_extras','product_pairings',
                             'modifier_groups','modifier_options','product_modifier_groups',
                             'tables','qr_tokens','vat_rates'] loop
    if (v_j->>v_k)::bigint < 1 then
      raise exception 'PO3 FAIL: partener CU consimțământ nu vede % (%)', v_k, v_j->>v_k; end if;
    if (v_j->>v_k)::bigint <> (v_o->>v_k)::bigint then
      raise exception 'PO3 FAIL: partenerul vede % rânduri în %, ownerul %', v_j->>v_k, v_k, v_o->>v_k; end if;
  end loop;
  -- produsul DRAFT e vizibil partenerului (configurare), deci products = 2.
  if (v_j->>'products')::bigint <> 2 then
    raise exception 'PO3 FAIL: partenerul nu vede draft-urile (products=%)', v_j->>'products'; end if;

  -- Tot ce NU e meniu: 0.
  for v_k, v_n in select key, value::bigint from jsonb_each_text(v_j) loop
    if v_k not in (select t from po_menu) and v_n <> 0 then
      raise exception 'PO3 FAIL: partener CU consimțământ vede % rânduri în % (nepermis)', v_n, v_k; end if;
  end loop;

  -- Controlul POZITIV: ownerul vede datele sensibile (altfel „0 rânduri" ar trece vacuu).
  -- (oblio_configs lipsește deliberat din controlul pozitiv: `authenticated` n-are
  -- SELECT pe tabelă — secretul nu se citește din client —, deci nici ownerul nu-l
  -- vede; 0 rânduri acolo e garantat de grant, iar politica nu pomenește partenerul,
  -- ceea ce PO9 verifică pe catalog.)
  foreach v_k in array array['orders','order_items','order_payments','reservations',
                             'pending_receipts','invite_tokens','restaurant_memberships'] loop
    if coalesce((v_o->>v_k)::bigint, 0) < 1 then
      raise exception 'PO3 FAIL (control pozitiv): ownerul nu vede % — fixtura/privilegiile sunt oarbe', v_k; end if;
  end loop;

  -- Cross-tenant: nimic din R2 (al altui owner), nici meniu.
  select j into v_j from po_seen where who = 'partner_granted_other_tenant';
  for v_k, v_n in select key, value::bigint from jsonb_each_text(v_j) loop
    if v_n <> 0 then
      raise exception 'PO3 FAIL: partenerul lui O1 vede % rânduri în % din ALT restaurant', v_n, v_k; end if;
  end loop;

  -- Străinul rămâne la 0 pe tot (R1 inactiv).
  select j into v_j from po_seen where who = 'stranger';
  for v_k, v_n in select key, value::bigint from jsonb_each_text(v_j) loop
    if v_n <> 0 then raise exception 'PO3 FAIL: străinul vede % rânduri în %', v_n, v_k; end if;
  end loop;
  raise notice 'PO3 OK: meniu+mese/QR+vat DA; orders/reservations/oblio_configs/pending_receipts/... 0; owner vede tot; cross-tenant 0';
end $$;

-- ═══════ PO4: scrierea partenerului ═════════════════════════════════════════
-- Restaurantul trebuie ACTIV aici: trigger-ul `enforce_ordering_enabled` respinge
-- INSERT-ul de comenzi pe un restaurant inactiv ÎNAINTEA verificării RLS, deci
-- „partenerul nu poate crea comenzi" ar trece din motivul greșit. Se readuce
-- inactiv imediat după.
update public.restaurants set is_active = true
 where id = 'a1000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-0000000000a3', true);
set local role authenticated;
do $$
declare n int; v_ok boolean;
begin
  -- Meniu: DA.
  insert into public.categories (restaurant_id, name)
    values ('a1000000-0000-4000-8000-000000000001','Cat de la partener');
  update public.products set price = price + 1 where id = 'a1000000-0000-4000-8000-0000000000b2';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'PO4 FAIL: partenerul nu poate edita produse (n=%)', n; end if;
  insert into public.tables (restaurant_id, name, slug)
    values ('a1000000-0000-4000-8000-000000000001','Masa partener','masa-partener');
  insert into public.product_extras (product_id, name, price)
    values ('a1000000-0000-4000-8000-0000000000b2','Extra partener',1);
  insert into public.modifier_options (modifier_group_id, name)
    values ('a1000000-0000-4000-8000-0000000000d0','Opțiune partener');
  insert into public.qr_tokens (restaurant_id, table_id)
    values ('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-0000000000e0');

  -- Alt tenant: nu poate scrie.
  begin
    insert into public.categories (restaurant_id, name)
      values ('a1000000-0000-4000-8000-000000000002','Intrus');
    raise exception 'PO4 FAIL: partener a scris meniul altui tenant';
  exception when insufficient_privilege then null; end;

  -- NU: comenzi, setări, oblio, jurnal fiscal, echipă, auto-consimțământ.
  begin
    insert into public.orders (restaurant_id, source) values ('a1000000-0000-4000-8000-000000000001','waiter');
    raise exception 'PO4 FAIL: partenerul poate crea comenzi';
  exception when insufficient_privilege then null; end;

  update public.restaurants set name = 'Hack' where id = 'a1000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'PO4 FAIL: partenerul poate edita setările restaurantului'; end if;

  begin
    update public.oblio_configs set api_secret = 'x' where restaurant_id = 'a1000000-0000-4000-8000-000000000001';
    get diagnostics n = row_count;
  exception when insufficient_privilege then n := 0; end;
  if n <> 0 then raise exception 'PO4 FAIL: partenerul poate scrie oblio_configs'; end if;

  begin
    update public.pending_receipts set payload = 'x' where restaurant_id = 'a1000000-0000-4000-8000-000000000001';
    get diagnostics n = row_count;
  exception when insufficient_privilege then n := 0; end;
  if n <> 0 then raise exception 'PO4 FAIL: partenerul poate rescrie jurnalul fiscal (SC-1)'; end if;

  update public.orders set status = 'cancelled' where restaurant_id = 'a1000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'PO4 FAIL: partenerul poate modifica comenzi'; end if;

  begin
    insert into public.restaurant_memberships (restaurant_id, user_id, role)
      values ('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-0000000000a3','manager');
    raise exception 'PO4 FAIL: partenerul își poate crea membership';
  exception when insufficient_privilege then null; end;

  begin
    update public.affiliate_attributions set owner_consented_at = now(), partner_access_revoked_at = null
     where id = 'a1000000-0000-4000-8000-0000000000cb';
    raise exception 'PO4 FAIL: afiliatul poate scrie direct pe affiliate_attributions';
  exception when insufficient_privilege then null; end;
  raise notice 'PO4 OK: meniu/mese/QR scriu; comenzi/setări/oblio/jurnal fiscal/echipă/auto-consimțământ refuzate';
end $$;
reset role;
update public.restaurants set is_active = false
 where id = 'a1000000-0000-4000-8000-000000000001';

-- ═══════ PO8: oglindirea listei + stările ═══════════════════════════════════
do $$
declare v jsonb; v_cnt int;
begin
  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-0000000000a3', true);
  set local role authenticated;
  v := public.list_partner_restaurants();
  reset role;
  if jsonb_array_length(v) <> 1 or v->0->>'restaurant_id' <> 'a1000000-0000-4000-8000-000000000001' then
    raise exception 'PO8 FAIL: list_partner_restaurants (acordat) = %', v; end if;

  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-0000000000a3', true);
  set local role authenticated;
  v := public.list_partner_attributions();
  reset role;
  if jsonb_array_length(v) <> 1 or v->0->>'state' <> 'granted'
     or jsonb_array_length(v->0->'restaurants') <> 1 then
    raise exception 'PO8 FAIL: list_partner_attributions (acordat) = %', v; end if;

  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-0000000000a1', true);
  set local role authenticated;
  v := public.get_partner_access('a1000000-0000-4000-8000-000000000001');
  reset role;
  if jsonb_array_length(v) <> 1 or v->0->>'state' <> 'granted'
     or v->0->>'affiliate_email' <> 'po-partner@po.test' then
    raise exception 'PO8 FAIL: get_partner_access (acordat) = %', v; end if;

  -- get_partner_access rămâne gate-uit pe owner REAL (managerul/partenerul/fondatorul nu-l citesc).
  foreach v_cnt in array array[7, 3, 6] loop
    perform set_config('request.jwt.claim.sub',
      'a1000000-0000-4000-8000-0000000000a' || v_cnt::text, true);
    set local role authenticated;
    begin
      perform public.get_partner_access('a1000000-0000-4000-8000-000000000001');
      reset role;
      raise exception 'PO8 FAIL: get_partner_access citit de non-owner (a%)', v_cnt;
    exception when others then
      reset role;
      if sqlerrm not like 'Acces interzis%' then raise; end if;
    end;
  end loop;
  raise notice 'PO8 OK: list_partner_restaurants oglindește accesul; stările/gate-urile corecte';
end $$;

-- ═══════ PO5: revocare → 0; cerere nouă ≠ acces; re-acordare; manager ═══════
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
select public.revoke_partner_access('a1000000-0000-4000-8000-0000000000ca');
reset role;

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-0000000000a3', true);
set local role authenticated;
insert into po_seen select 'partner_revoked', 'a1000000-0000-4000-8000-000000000001'::uuid,
  public.po_vis('a1000000-0000-4000-8000-000000000001');
-- re-cerere după revocare: NU readuce accesul.
select public.request_partner_access('a1000000-0000-4000-8000-0000000000ca');
insert into po_seen select 'partner_rerequested', 'a1000000-0000-4000-8000-000000000001'::uuid,
  public.po_vis('a1000000-0000-4000-8000-000000000001');
reset role;

do $$
declare v_j jsonb; v jsonb; v_who text; v_s text;
begin
  foreach v_who in array array['partner_revoked','partner_rerequested'] loop
    select j into v_j from po_seen where who = v_who;
    if (select coalesce(sum(value::bigint),0) from jsonb_each_text(v_j)) <> 0 then
      raise exception 'PO5 FAIL: % — partenerul mai vede date: %', v_who, v_j; end if;
  end loop;

  select state into v_s from (
    select public.partner_access_state(partner_access_requested_at, owner_consented_at, partner_access_revoked_at) as state
      from public.affiliate_attributions where id = 'a1000000-0000-4000-8000-0000000000ca') x;
  if v_s <> 'requested' then raise exception 'PO5 FAIL: starea după re-cerere = %', v_s; end if;

  -- Managerul membru (a7) NU poate ACORDA: deschiderea contului unui terț e
  -- decizia ownerului (recenzie CodeRabbit pe #282). Respins, starea neatinsă.
  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-0000000000a7', true);
  set local role authenticated;
  begin
    v := public.grant_partner_access('a1000000-0000-4000-8000-0000000000ca');
    reset role;
    raise exception 'PO5 FAIL: managerul a putut acorda accesul: %', v;
  exception when raise_exception then
    if sqlerrm like 'PO5 FAIL%' then raise; end if;
    if sqlerrm is distinct from 'Acces interzis' then
      raise exception 'PO5 FAIL: refuzul managerului are alt mesaj: %', sqlerrm; end if;
  end;
  reset role;
  if (select owner_consented_at is not null and partner_access_revoked_at is null
        from public.affiliate_attributions where id = 'a1000000-0000-4000-8000-0000000000ca') then
    raise exception 'PO5 FAIL: refuzul managerului a lăsat accesul acordat'; end if;

  -- Ownerul (a1) re-acordă (control pozitiv).
  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-0000000000a1', true);
  set local role authenticated;
  v := public.grant_partner_access('a1000000-0000-4000-8000-0000000000ca');
  reset role;
  if v->>'ok' is distinct from 'true' then raise exception 'PO5 FAIL: ownerul nu poate re-acorda: %', v; end if;

  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-0000000000a3', true);
  set local role authenticated;
  v := public.po_vis('a1000000-0000-4000-8000-000000000001');
  reset role;
  if (v->>'categories')::bigint < 1 or (v->>'orders')::bigint <> 0 then
    raise exception 'PO5 FAIL: după re-acordare: %', v; end if;

  -- Managerul NU poate nici REVOCA: consimțământul e pe tot contul, deci un
  -- manager al unui restaurant ar decide și pentru celelalte (CodeRabbit #282).
  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-0000000000a7', true);
  set local role authenticated;
  begin
    v := public.revoke_partner_access('a1000000-0000-4000-8000-0000000000ca');
    reset role;
    raise exception 'PO5 FAIL: managerul a putut revoca accesul: %', v;
  exception when raise_exception then
    if sqlerrm like 'PO5 FAIL%' then raise; end if;
    if sqlerrm is distinct from 'Acces interzis' then
      raise exception 'PO5 FAIL: refuzul revocării managerului are alt mesaj: %', sqlerrm; end if;
  end;
  reset role;
  if not (select owner_consented_at is not null and partner_access_revoked_at is null
            from public.affiliate_attributions where id = 'a1000000-0000-4000-8000-0000000000ca') then
    raise exception 'PO5 FAIL: refuzul managerului a revocat totuși accesul'; end if;

  -- Ownerul (a1) revocă (control pozitiv).
  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-0000000000a1', true);
  set local role authenticated;
  v := public.revoke_partner_access('a1000000-0000-4000-8000-0000000000ca');
  reset role;
  if v->>'ok' is distinct from 'true' then raise exception 'PO5 FAIL: ownerul nu poate revoca: %', v; end if;
  -- A doua revocare consecutivă: respinsă curat.
  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-0000000000a1', true);
  set local role authenticated;
  v := public.revoke_partner_access('a1000000-0000-4000-8000-0000000000ca');
  reset role;
  if v->>'ok' is distinct from 'false' then raise exception 'PO5 FAIL: dublă revocare: %', v; end if;

  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-0000000000a3', true);
  set local role authenticated;
  v := public.po_vis('a1000000-0000-4000-8000-000000000001');
  reset role;
  if (select coalesce(sum(value::bigint),0) from jsonb_each_text(v)) <> 0 then
    raise exception 'PO5 FAIL: după revocarea ownerului: %', v; end if;
  raise notice 'PO5 OK: revocare=0; re-cerere nu dă acces; re-acordare (owner) dă; managerul NU acordă și NU revocă';
end $$;

-- ═══════ PO6: filtrele păstrate (atribuire terminală, afiliat ne-activ) ═════
update public.affiliate_attributions
   set owner_consented_at = now(), partner_access_revoked_at = null
 where id = 'a1000000-0000-4000-8000-0000000000ca';   -- consimțământ valid, ca postgres

do $$
declare v jsonb; v_st text;
begin
  -- control pozitiv: cu consimțământ + active + afiliat activ → acces.
  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-0000000000a3', true);
  set local role authenticated;
  v := public.po_vis('a1000000-0000-4000-8000-000000000001');
  reset role;
  if (v->>'categories')::bigint < 1 then raise exception 'PO6 FAIL (control): fără acces deși consimțământ valid'; end if;

  foreach v_st in array array['canceled','refunded','expired'] loop
    execute format('update public.affiliate_attributions set status = %L::public.attribution_status where id = %L',
      v_st, 'a1000000-0000-4000-8000-0000000000ca');
    perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-0000000000a3', true);
    set local role authenticated;
    v := public.po_vis('a1000000-0000-4000-8000-000000000001');
    reset role;
    if (select coalesce(sum(value::bigint),0) from jsonb_each_text(v)) <> 0 then
      raise exception 'PO6 FAIL: atribuire % mai dă acces', v_st; end if;
  end loop;
  update public.affiliate_attributions set status = 'active'
   where id = 'a1000000-0000-4000-8000-0000000000ca';

  update public.affiliates set status = 'suspended' where id = 'a1000000-0000-4000-8000-0000000000aa';
  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-0000000000a3', true);
  set local role authenticated;
  v := public.po_vis('a1000000-0000-4000-8000-000000000001');
  reset role;
  if (select coalesce(sum(value::bigint),0) from jsonb_each_text(v)) <> 0 then
    raise exception 'PO6 FAIL: afiliat suspendat mai are acces'; end if;
  update public.affiliates set status = 'active' where id = 'a1000000-0000-4000-8000-0000000000aa';
  raise notice 'PO6 OK: canceled/refunded/expired + afiliat suspendat → fără acces chiar cu consimțământ';
end $$;

-- ═══════ PO7: fondatorul (escape 186) păstrează accesul TOTAL ═══════════════
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-0000000000a6', true);
set local role authenticated;
insert into po_seen select 'founder', 'a1000000-0000-4000-8000-000000000001'::uuid,
  public.po_vis('a1000000-0000-4000-8000-000000000001');
reset role;
do $$
declare v_j jsonb; v_k text;
begin
  select j into v_j from po_seen where who = 'founder';
  foreach v_k in array array['restaurants','categories','products','orders','order_items','order_payments',
                             'pending_receipts','invite_tokens'] loop
    if coalesce((v_j->>v_k)::bigint,0) < 1 then
      raise exception 'PO7 FAIL: fondatorul (platform admin) nu mai vede % — escape-ul 186 pierdut', v_k; end if;
  end loop;
  raise notice 'PO7 OK: fondatorul păstrează accesul total (is_platform_admin)';
end $$;

-- ═══════ PO9: catalog ═══════════════════════════════════════════════════════
do $$
declare v_def text; fn text; v_tables text; v_sig text;
begin
  -- INVERSUL asserției mig 187: partenerul NU e în funel; fondatorul DA.
  foreach fn in array array['is_admin','is_member','my_role'] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn
       and pg_get_function_identity_arguments(p.oid) = 'p_restaurant_id uuid';
    if v_def not ilike '%is_platform_admin%' then
      raise exception 'PO9 FAIL: %() a pierdut escape-ul is_platform_admin (186)', fn; end if;
    if v_def ilike '%has_partner_access%' then
      raise exception 'PO9 FAIL: %() conține din nou has_partner_access (partenerul în funel)', fn; end if;
  end loop;

  -- has_partner_access cere consimțământ.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'has_partner_access';
  if v_def !~ 'owner_consented_at is not null' then
    raise exception 'PO9 FAIL: has_partner_access nu cere owner_consented_at'; end if;

  -- Setul EXACT de tabele cu politici de partener.
  select string_agg(relname, ', ' order by relname collate "C") into v_tables
    from (
      select distinct c.relname::text as relname
        from pg_policy pol join pg_class c on c.oid = pol.polrelid
       where c.relnamespace = 'public'::regnamespace
         and (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') ilike '%has_partner_access%'
              or coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ilike '%has_partner_access%')
    ) s;
  if v_tables is distinct from
     'categories, modifier_groups, modifier_options, product_extras, product_modifier_groups, product_pairings, products, qr_tokens, restaurants, tables, vat_rates' then
    raise exception 'PO9 FAIL: tabele cu politică de partener = %', v_tables; end if;

  -- Nicio funcție din public în afara listei nu pomenește has_partner_access
  -- (un RPC nou care „dă și partenerului" iese în evidență).
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosrc ilike '%has_partner_access%'
       and p.proname not in ('has_partner_access', 'log_partner_visit')
  ) then
    raise exception 'PO9 FAIL: o funcție din public folosește has_partner_access în afara listei permise: %',
      (select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosrc ilike '%has_partner_access%'
          and p.proname not in ('has_partner_access', 'log_partner_visit'));
  end if;

  -- Privilegii RPC (fail-closed: o semnătură nouă face testul să ARUNCE).
  foreach v_sig in array array[
    'public.request_partner_access(uuid)', 'public.grant_partner_access(uuid)',
    'public.revoke_partner_access(uuid)', 'public.list_partner_attributions()',
    'public.get_partner_access(uuid)', 'public.list_partner_restaurants()'
  ] loop
    if has_function_privilege('anon', v_sig, 'EXECUTE') then
      raise exception 'PO9 FAIL: anon poate executa %', v_sig; end if;
    if has_function_privilege('service_role', v_sig, 'EXECUTE') then
      raise exception 'PO9 FAIL: service_role poate executa %', v_sig; end if;
    if not has_function_privilege('authenticated', v_sig, 'EXECUTE') then
      raise exception 'PO9 FAIL: authenticated NU poate executa %', v_sig; end if;
  end loop;
  foreach v_sig in array array[
    'public.partner_access_state(timestamptz, timestamptz, timestamptz)',
    'public.partner_consent_principal(uuid)'
  ] loop
    if has_function_privilege('anon', v_sig, 'EXECUTE')
       or has_function_privilege('authenticated', v_sig, 'EXECUTE')
       or has_function_privilege('service_role', v_sig, 'EXECUTE') then
      raise exception 'PO9 FAIL: helperul intern % e executabil din roluri client', v_sig; end if;
  end loop;

  -- Apel REAL ca anon: respins pe privilegiul de EXECUTE (nu pe schemă).
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  begin
    perform public.request_partner_access('a1000000-0000-4000-8000-0000000000ca');
    reset role;
    raise exception 'PO9 FAIL: anon a executat request_partner_access';
  exception when insufficient_privilege then
    reset role;
    if sqlerrm not like '%for function%' then raise; end if;
  end;
  raise notice 'PO9 OK: funel fără partener (cu fondator), politici doar pe setul permis, privilegii RPC';
end $$;

-- ═══════ PO10: auditul ══════════════════════════════════════════════════════
do $$
declare v_n int;
begin
  select count(*) into v_n from public.platform_audit_log
   where action = 'request_partner_access' and actor_kind = 'affiliate'
     and actor_user_id = 'a1000000-0000-4000-8000-0000000000a3';
  if v_n < 2 then raise exception 'PO10 FAIL: cererile nu sunt auditate (n=%)', v_n; end if;
  select count(*) into v_n from public.platform_audit_log
   where action = 'grant_partner_access' and actor_kind = 'owner';
  if v_n < 2 then raise exception 'PO10 FAIL: acordările nu sunt auditate (n=%)', v_n; end if;
  select count(*) into v_n from public.platform_audit_log
   where action = 'revoke_partner_access' and actor_kind = 'owner';
  if v_n < 2 then raise exception 'PO10 FAIL: revocările nu sunt auditate (n=%)', v_n; end if;
  raise notice 'PO10 OK: cerere/acordare/revocare în platform_audit_log';
end $$;

select 'PARTNER OPT-IN ASSERTIONS: PO1–PO10 PASS' as result;

rollback;
