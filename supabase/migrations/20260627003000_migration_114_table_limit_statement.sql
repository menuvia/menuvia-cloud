-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 114 — Închidere bypass limită mese prin INSERT multi-row
-- ═══════════════════════════════════════════════════════════════
-- CFG-2 (P1): enforce_table_limit (mig 013) e trigger BEFORE INSERT
-- FOR EACH ROW. Într-un INSERT multi-row (ex. TablesManager.tsx →
-- from('tables').insert(rows), OnboardingPage.tsx), fiecare rând frate
-- e evaluat pe ACEEAȘI bază (count(*) dinainte de statement), pentru că
-- trigger-ul per-row nu vede rândurile-frați din același statement.
-- Rezultat: un restaurant free (max_tables=3) putea insera 50 de mese
-- dintr-o singură comandă PostgREST.
--
-- RPC-ul bulk_create_tables (mig 034) inserează rând-cu-rând, deci NU
-- e afectat (fiecare INSERT e propriul statement).
--
-- Fix: trigger AFTER INSERT … FOR EACH STATEMENT cu tabel de tranziție
-- (REFERENCING NEW TABLE AS new_rows). După ce toate rândurile au intrat,
-- pentru fiecare restaurant_id distinct verificăm total count(*) vs
-- max_tables al planului owner-ului. Dacă depășește → respins (rollback).
--
-- Defense in depth: NU ștergem trigger-ul per-row existent
-- (trg_enforce_table_limit). El prinde inserturile single-row mai
-- devreme; cel statement-level prinde multi-row.
--
-- Sursa max_tables: aceeași ca enforce_table_limit → owner_plan() +
-- plan_limits. Free = 3 (mig 062 seed).
-- ═══════════════════════════════════════════════════════════════

-- Funcția statement-level: rulează o singură dată per INSERT, cu acces
-- la toate rândurile noi prin tabelul de tranziție `new_rows`.
create or replace function public.enforce_table_limit_stmt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec   record;
  v_plan  text;
  v_max   integer;
  v_count integer;
begin
  -- Pentru fiecare restaurant atins de acest statement, verifică totalul.
  for v_rec in
    select distinct restaurant_id from new_rows
  loop
    select public.owner_plan(v_rec.restaurant_id) into v_plan;
    select max_tables into v_max
      from public.plan_limits
     where plan = coalesce(v_plan, 'free');
    if v_max is null then v_max := 3; end if;

    -- Totalul după statement (rândurile noi sunt deja în tabel — AFTER).
    select count(*) into v_count
      from public.tables
     where restaurant_id = v_rec.restaurant_id;

    if v_count > v_max then
      raise exception
        'Limită mese atinsă: maxim % pentru planul %.', v_max, coalesce(v_plan, 'free')
        using errcode = 'P0001', hint = 'table_limit';
    end if;
  end loop;

  return null;  -- valoarea de retur e ignorată la AFTER … FOR EACH STATEMENT
end;
$$;

drop trigger if exists trg_enforce_table_limit_stmt on public.tables;
create trigger trg_enforce_table_limit_stmt
  after insert on public.tables
  referencing new table as new_rows
  for each statement execute function public.enforce_table_limit_stmt();

-- ── Asersție inline: trigger-ul statement-level există ──────────
do $$
begin
  if not exists (
    select 1
      from pg_trigger
     where tgname = 'trg_enforce_table_limit_stmt'
       and tgrelid = 'public.tables'::regclass
       and not tgisinternal
  ) then
    raise exception 'MIG 114: trigger-ul trg_enforce_table_limit_stmt lipsește';
  end if;
end $$;
