-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 178 — Cooldown recalculare manuală health score
-- ═══════════════════════════════════════════════════════════════
-- PROBLEMĂ: `recompute_health_for_restaurant` (mig 040) impunea un
-- cooldown de 5 min pe recalcularea MANUALĂ folosind coloana
-- `computed_at` din `customer_health_scores`. Însă cron-ul
-- `compute_health_scores` (la fiecare 30 min) scrie `computed_at`
-- pentru TOATE restaurantele → butonul manual "Recalculează acum"
-- putea fi blocat inutil de o rulare de cron/nocturnă.
--
-- SOLUȚIE: introducem o coloană dedicată `last_manual_recompute_at`
-- care e ștampilată DOAR de recalcularea manuală. Cooldown-ul de
-- 5 min se bazează pe această coloană, deci cron-ul (care scrie
-- doar `computed_at`) nu mai poate bloca butonul manual.
--
-- NOTĂ: NU edităm mig 040. Recreăm doar RPC-ul via `create or replace`.
-- Autorizarea existentă (owner/manager via `is_admin`) e păstrată
-- neschimbată. Idempotent: `add column if not exists` + `create or replace`.

-- ─────────────────────────────────────────────────────────────────
-- 1. Coloană dedicată pentru timestamp-ul ultimei recalculări MANUALE
-- ─────────────────────────────────────────────────────────────────
alter table public.customer_health_scores
  add column if not exists last_manual_recompute_at timestamptz;


-- ─────────────────────────────────────────────────────────────────
-- 2. Recreează RPC-ul: cooldown pe `last_manual_recompute_at`
-- ─────────────────────────────────────────────────────────────────
-- Diferențe față de mig 040:
--   - cooldown-ul citește `last_manual_recompute_at` (nu `computed_at`)
--   - după `_compute_one_health_score`, ștampilăm `last_manual_recompute_at = now()`
--     DOAR pe traseul manual (aici), nu în helper (folosit și de cron).
create or replace function public.recompute_health_for_restaurant(p_restaurant_id uuid)
returns table (
  score        integer,
  trend        text,
  alert_needed boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_last_manual timestamptz;
begin
  -- Autorizare (păstrată identic din mig 040): doar owner/manager
  if not public.is_admin(p_restaurant_id) then
    raise exception 'Only owners/managers can recompute health score';
  end if;

  -- Anti-spam: max 1 recalculare MANUALĂ la 5 min per restaurant.
  -- Folosim `last_manual_recompute_at` (nu `computed_at`) ca să nu
  -- fim blocați de scrierile cron-ului `compute_health_scores`.
  select last_manual_recompute_at into v_last_manual
    from public.customer_health_scores
   where customer_health_scores.restaurant_id = p_restaurant_id;

  if v_last_manual is not null and v_last_manual > now() - interval '5 minutes' then
    raise exception 'Scor recalculat recent. Reîncearcă peste % minute.',
      ceil(extract(epoch from (v_last_manual + interval '5 minutes' - now())) / 60)::integer
      using errcode = 'P0001', hint = 'cooldown';
  end if;

  -- Recalculăm (upsert-ul pe `computed_at`/`details` e făcut în helper).
  return query select * from public._compute_one_health_score(p_restaurant_id);

  -- Ștampilăm timestamp-ul recalculării MANUALE DOAR aici (nu în helper,
  -- care e apelat și de cron). Rândul există garantat după helper (upsert).
  update public.customer_health_scores
     set last_manual_recompute_at = now()
   where customer_health_scores.restaurant_id = p_restaurant_id;
end;
$$;

revoke all on function public.recompute_health_for_restaurant(uuid) from public;
grant execute on function public.recompute_health_for_restaurant(uuid) to authenticated;
