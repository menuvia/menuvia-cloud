-- Migration 120: CHECK pe public.modifier_options.price_delta (MOD-1)
-- ─────────────────────────────────────────────────────────────────────
-- MOD-1: modifier_options.price_delta (mig 002) e numeric(10,2) FĂRĂ CHECK.
--   create_order (mig 088) însumează `mo.price_delta` direct în totalul
--   comenzii (sum(mo.price_delta) → v_options_total), deci valori negative
--   absurde sau uriașe distorsionează totalul / TVA-ul comenzii.
--
-- UNITATEA: numeric(10,2) reprezintă RON cu 2 zecimale (NU minor units) —
--   aceeași unitate ca products.price (base_schema). Un supliment plauzibil
--   stă în zeci/sute de RON; o reducere mică e legitimă (price_delta < 0).
--   Alegem un bound generos dar finit: între -10000 și 10000 RON. Acoperă
--   orice supliment/reducere real, dar respinge valori absurde (ex. 1e9).
--
-- SEMANTICA NESCHIMBATĂ: price_delta poate rămâne negativ (reduceri mici)
--   sau zero (default). Nu atingem coloana, default-ul sau tipul — doar
--   adăugăm constrângerea de domeniu.
--
-- NOT VALID + VALIDATE: în CI tabelul e gol, dar folosim pattern-ul sigur
--   (adaugă constrângerea fără scan blocant, apoi validează) ca să nu pice
--   pe eventuale rânduri preexistente în alte medii.

\set ON_ERROR_STOP on

begin;

-- 1. Adaugă constrângerea (NOT VALID → nu scanează rândurile existente).
alter table public.modifier_options
  add constraint chk_modifier_price_delta
  check (price_delta >= -10000 and price_delta <= 10000)
  not valid;

-- 2. Validează constrângerea pe rândurile existente.
alter table public.modifier_options
  validate constraint chk_modifier_price_delta;

-- 3. Asersție inline: constrângerea există și e validată.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chk_modifier_price_delta'
      and conrelid = 'public.modifier_options'::regclass
      and contype  = 'c'
      and convalidated
  ) then
    raise exception 'mig 120: chk_modifier_price_delta lipsește sau nu e validată';
  end if;
end $$;

commit;
