-- mig 109 — Corectarea descrierilor-ghid ale grupelor VAT implicite (FISCAL-1/FISCAL-3)
--
-- CONTEXT FISCAL: descrierile-ghid din mig 102 induceau owner-ul în eroare.
-- Sub Legea 141/2025 + HG 602/2025, băuturile nealcoolice NU sunt uniform la
-- cota redusă 11%. Răcoritoarele încadrate la CN 2202 (ape minerale/gazoase cu
-- adaos de zahăr/îndulcitori/arome) ȘI băuturile cu zahăr ≥10g/100g se impozitează
-- la cota STANDARD 21%, nu la 11%. Textul vechi al grupei 1 spunea generic
-- „băuturi nealcoolice, ... sucuri (cotă redusă 11%)", ceea ce putea face owner-ul
-- să mapeze greșit aceste produse pe grupa 1 (subdeclarare TVA).
--
-- CE FACE această migrație:
--   • Înlocuiește DOAR funcția-trigger `create_default_vat_rates` cu DESCRIERI
--     corectate pe grupele 1/2/3, ca restaurantele NOI să primească etichete-ghid
--     care reflectă corect regimul CN 2202 / zahăr ≥10g/100g.
--
-- CE NU FACE (intenționat):
--   • NU schimbă COTELE — rămân EXACT 11.00 / 21.00 / 11.00 / 0.00 ca în mig 102
--     (altfel ar sparge tests/sql/vat_rates_2025_assertions.sql). Reparăm doar
--     textul-ghid (label/description), nu fiscalitatea efectivă.
--   • NU face UPDATE în masă pe `vat_rates` existente — cotele și etichetele
--     aparțin restaurantului (vezi raționamentul din mig 102). Owner-ul care vrea
--     descrierile noi pe un restaurant existent le ajustează manual / cu contabilul.
--   • NU atinge `fiscalnet_group` — INSERT-ul păstrează exact coloanele din mig 102.
--
-- Trigger-ul `create_vat_rates_trigger` (AFTER INSERT ON restaurants, din mig 029)
-- rămâne neschimbat — pointează deja la această funcție.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

create or replace function public.create_default_vat_rates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.vat_rates (restaurant_id, vat_group, rate_percent, label, description)
  values
    (NEW.id, 1, 11.00, 'Mâncare', 'Mâncare, apă plată, cafea, ceai, lapte (cotă redusă 11%, L.141/2025). NU include răcoritoare CN 2202 / băuturi cu zahăr ≥10g/100g — acelea = grupa 2 (21%).'),
    (NEW.id, 2, 21.00, 'Alcool',  'Alcool, bere, vin, spirtoase, țigări, accize + băuturi nealcoolice la cotă standard (răcoritoare CN 2202, băuturi cu zahăr ≥10g/100g), cotă standard 21% (L.141/2025 + HG 602/2025).'),
    (NEW.id, 3, 11.00, 'Special', 'Rezervă pentru cazuri rare; pentru produse nealcoolice la cotă standard folosește grupa 2 (21%). Verifică cu contabilul.'),
    (NEW.id, 4, 0.00,  'Scutit',  'Produse scutite explicit de TVA')
  on conflict (restaurant_id, vat_group) do nothing;
  return NEW;
end;
$$;

-- Aserție inline: funcția conține cotele 11.00 ȘI 21.00 (ca în mig 102).
-- Garantează că reparația de descrieri nu a alterat din greșeală cotele.
do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_default_vat_rates';
  if v_src is null then
    raise exception 'mig 109: create_default_vat_rates lipsește';
  end if;
  if position('11.00' in v_src) = 0 or position('21.00' in v_src) = 0 then
    raise exception 'mig 109: cotele (11/21) nu mai sunt în funcție — descrierile au alterat cotele';
  end if;
  raise notice 'mig 109: descrieri-ghid VAT corectate (CN 2202 / zahăr ≥10g/100g → grupa 2), cote 11/21 intacte OK';
end $$;

commit;
