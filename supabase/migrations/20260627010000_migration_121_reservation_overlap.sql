-- Migration 121: EXCLUDE constraint anti double-booking pe rezervări (RES-1)
-- ─────────────────────────────────────────────────────────────────────
-- RES-1: overlap-ul aceleiași mese/interval e verificat DOAR în RPC
--   (create_reservation_public, mig 057/086) sub advisory lock per restaurant.
--   Lipsește o constrângere de DB → orice scriere directă în public.reservations
--   (ex: insert din dashboard, source='dashboard'/'phone'/'walk_in', sau o cale
--   paralelă viitoare) poate crea două rezervări ACTIVE suprapuse pe aceeași
--   masă. Advisory lock-ul din RPC nu protejează căile care nu trec prin RPC.
--
-- FIX: o constrângere EXCLUDE cu GiST care interzice, pentru aceeași masă,
--   suprapunerea intervalelor [starts_at, ends_at) între rezervări ACTIVE.
--   • table_id WITH =        → constrânge per masă (NULL nu se compară în
--                              EXCLUDE → rezervările fără masă alocată NU intră
--                              în constrângere, exact ca în logica RPC).
--   • tstzrange(...) WITH && → respinge intervalele care se intersectează.
--   • WHERE status not in ('cancelled','no_show') → doar rezervările active
--     ocupă slotul; o anulare/no_show eliberează intervalul (oglindește exact
--     filtrul folosit în check_availability și în alocarea din RPC).
--
-- Limitele de interval folosesc '[)' (inclusiv start, exclusiv end): două
-- rezervări lipite (ends_at == starts_at) NU se consideră overlap — identic cu
-- semantica OVERLAPS folosită în RPC, care tratează capetele atinse ca libere.
--
-- Necesită btree_gist pentru a putea pune un tip scalar (uuid table_id) cu '='
-- alături de un range cu '&&' în același index GiST. btree_gist e standard în
-- Supabase/PostgreSQL.
--
-- NOTĂ: NU atingem RPC-ul (create_reservation_public / check_availability).
-- Constrângerea e o plasă de siguranță la nivel de DB; RPC-ul rămâne calea
-- normală (verificare + alocare + advisory lock). În cazul rar de race care
-- scapă de lock pe o cale paralelă, INSERT-ul al doilea pică pe constrângere.

\set ON_ERROR_STOP on

begin;

-- 1. Extensia btree_gist (în schema `extensions`, ca pgcrypto în mig 050).
--    Idempotent, safe la re-run.
create extension if not exists btree_gist with schema extensions;

-- 2. EXCLUDE constraint per masă pe intervalul rezervării, doar status activ.
--    În CI tabela e goală la apply → constrângerea se atașează curat.
alter table public.reservations
  add constraint excl_reservations_no_overlap
  exclude using gist (
    table_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  where (status not in ('cancelled', 'no_show'));

-- 3. Asersție inline: constrângerea EXCLUDE există pe public.reservations.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname  = 'excl_reservations_no_overlap'
      and conrelid = 'public.reservations'::regclass
      and contype  = 'x'  -- 'x' = EXCLUDE constraint
  ) then
    raise exception 'mig 121: excl_reservations_no_overlap lipsește';
  end if;
end $$;

commit;
