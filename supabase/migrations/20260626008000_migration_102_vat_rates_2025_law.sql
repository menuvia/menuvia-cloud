-- mig 102 — Cote TVA implicite pentru Legea 141/2025 (11% / 21%)
--
-- CONTEXT FISCAL: Legea 141/2025 (în vigoare din 1 aug 2025) a eliminat cotele
-- reduse de 5% ȘI 9% și a introdus o cotă redusă UNICĂ de 11%, plus cota
-- standard majorată la 21% (de la 19%). Vezi mig 029 (cote vechi 9/19/5/0).
--
-- CE FACE această migrație:
--   • Înlocuiește DOAR funcția-trigger `create_default_vat_rates` astfel încât
--     restaurantele NOI să primească 11% (redus) / 21% (standard) din start.
--
-- CE NU FACE (intenționat):
--   • NU face UPDATE în masă pe `vat_rates` existente. Cotele aparțin
--     restaurantului — owner-ul și le-a putut ajusta manual (mig 029 le-a făcut
--     configurabile tocmai pentru asta). Un UPDATE global ar suprascrie
--     configurări legitime și ar fi greșit pentru restaurantele care au deja
--     11/21 setate de owner. Migrarea cotelor existente e o decizie de business
--     (per restaurant), nu o migrație de schemă.
--   • NU atinge `fiscalnet_group` — INSERT-ul păstrează exact coloanele din
--     mig 029, deci coloana cade pe default-ul ei (1, vezi mig 030).
--
-- Grupa 3 („Special") rămâne ca rezervă pentru cazuri rare; o aducem la 11%
-- (cota redusă curentă) ca să nu mai semene a 5% dispărut — owner-ul o ajustează
-- cu contabilul dacă are un caz concret.

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
    (NEW.id, 1, 11.00, 'Mâncare', 'Mâncare, băuturi nealcoolice, apă, sucuri, cafea, ceai (cotă redusă 11%, L.141/2025)'),
    (NEW.id, 2, 21.00, 'Alcool',  'Bere, vin, spirtoase, țigări, accize (cotă standard 21%, L.141/2025)'),
    (NEW.id, 3, 11.00, 'Special', 'Cazuri rare — verifică cu contabilul'),
    (NEW.id, 4, 0.00,  'Scutit',  'Produse scutite explicit de TVA')
  on conflict (restaurant_id, vat_group) do nothing;
  return NEW;
end;
$$;

-- Trigger-ul din mig 029 (create_vat_rates_trigger AFTER INSERT ON restaurants)
-- rămâne neschimbat — pointează deja la această funcție.

do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_default_vat_rates';
  if v_src is null then
    raise exception 'mig 102: create_default_vat_rates lipsește';
  end if;
  if position('11.00' in v_src) = 0 or position('21.00' in v_src) = 0 then
    raise exception 'mig 102: cotele noi (11/21) nu sunt în funcție';
  end if;
  raise notice 'mig 102: cote TVA implicite 11/21 OK';
end $$;

commit;
