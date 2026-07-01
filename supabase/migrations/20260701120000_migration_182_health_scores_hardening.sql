-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 182 — Hardening customer health scores (audit)
-- ═══════════════════════════════════════════════════════════════
-- Context: audit intern pe `supabase/migrations/20260525003800_migration_040_health_ui.sql`
-- a confirmat 3 probleme [medium], toate legate de robustețea/ordinea
-- verificărilor din funcțiile de health score. NU atingem cooldown-ul
-- de recalculare manuală (`recompute_health_for_restaurant`) — e deja
-- reparat separat în mig. 178 (`last_manual_recompute_at`, distinct de
-- `computed_at`). Aici tratăm alt subiect.
--
-- NU edităm migrațiile aplicate 040/178 (regulă nenegociabilă #2) —
-- recreăm funcțiile via `create or replace function`, idempotent.
--
--   1. [medium] `get_health_score` — verificarea `is_admin` se făcea
--      DOAR ca predicat în clauza WHERE a unui singur SELECT (limbaj sql),
--      adică citirea din `customer_health_scores` și verificarea de
--      autorizare erau contopite în aceeași execuție a query planner-ului,
--      nu un fail-fast explicit înainte de orice citire. Rescriem funcția
--      în plpgsql cu un `if not public.is_admin(...) then raise exception`
--      chiar la începutul corpului, înainte de orice citire din tabel —
--      simetric cu pattern-ul deja folosit în `recompute_health_for_restaurant`
--      (mig. 040/178).
--
--   2. [medium] `compute_health_scores()` — bucla peste toate restaurantele
--      active nu avea (a) niciun parametru de batching și (b) nicio izolare
--      a erorilor per-restaurant: o eroare neprinsă la UN restaurant oprea
--      tot batch-ul (restul restaurantelor rămâneau nerecalculate până la
--      următorul cron). Adăugăm:
--        (a) parametru opțional `p_batch_size integer default null`
--            (null = comportament neschimbat, toate restaurantele active;
--            permite limitare/paginare pe viitor, ca în `process_lifecycle_events`
--            din mig. 039, care folosește `limit p_batch_size ... for update
--            skip locked`);
--        (b) `begin ... exception when others then ... end` în jurul
--            apelului `_compute_one_health_score(r.id)` per restaurant din
--            buclă — o eroare la un restaurant e logată (via `raise warning`)
--            și bucla continuă cu următorul restaurant, fără să oprească
--            tot batch-ul. Pattern identic cu hardening-ul deja aplicat pe
--            `process_lifecycle_events` în mig. 180.
--
--   3. [medium] `_compute_one_health_score` apelat fără protecție per-restaurant
--      din `compute_health_scores()` — rezolvat de fix-ul (2) de mai sus
--      (try/catch e plasat exact în jurul acestui apel). Nu duplicăm.
--
-- Grants/convenție lockdown păstrate identice cu originalul din mig. 040:
--   SECURITY DEFINER, `search_path = public, pg_temp`, `revoke all ... from
--   public` (service role only pentru `compute_health_scores`, `authenticated`
--   pentru `get_health_score` via RPC-ul apelat din UI).
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- 1. get_health_score — fail-fast pe autorizare, înainte de orice citire
-- ─────────────────────────────────────────────────────────────────
-- Identică funcțional cu mig. 040, dar rescrisă din `language sql` în
-- `language plpgsql` ca să putem face un `raise exception` explicit
-- ÎNAINTE de interogarea `customer_health_scores` — apelantul neautorizat
-- nu mai declanșează nicio citire/planificare pe tabelul cu date, doar
-- verificarea `is_admin`.
create or replace function public.get_health_score(p_restaurant_id uuid)
returns table (
  score             integer,
  previous_score    integer,
  trend             text,
  score_login       integer,
  score_orders      integer,
  score_team        integer,
  score_tickets     integer,
  score_engagement  integer,
  computed_at       timestamptz,
  details           jsonb
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  -- Fail-fast: verificarea de autorizare ÎNTÂI, înainte de orice citire
  -- din `customer_health_scores`. Simetric cu `recompute_health_for_restaurant`.
  if not public.is_admin(p_restaurant_id) then
    raise exception 'Only owners/managers can view health score';
  end if;

  return query
  select
    h.score, h.previous_score, h.trend,
    h.score_login, h.score_orders, h.score_team, h.score_tickets, h.score_engagement,
    h.computed_at, h.details
  from public.customer_health_scores h
  where h.restaurant_id = p_restaurant_id;
end;
$$;

revoke all on function public.get_health_score(uuid) from public;
grant execute on function public.get_health_score(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────
-- 2. compute_health_scores — batching opțional + izolare erori per-restaurant
-- ─────────────────────────────────────────────────────────────────
-- Identică funcțional cu mig. 040 când `p_batch_size` e null (comportament
-- neschimbat by-default: procesează toate restaurantele active). Diferențe:
--   - parametru nou `p_batch_size integer default null` → dacă e setat,
--     limitează bucla la primele `p_batch_size` restaurante active
--     (ordonate după id, pentru determinism), permițând rulări incrementale.
--   - `begin ... exception when others then ...` în jurul apelului
--     `_compute_one_health_score(r.id)`: o eroare la un restaurant NU mai
--     oprește tot batch-ul — se loghează via `raise warning` și bucla
--     continuă (`continue`).
--
-- NOTĂ signatură: `create or replace function` NU înlocuiește o funcție cu
-- o listă de parametri diferită — ar crea un al doilea overload și ar
-- LĂSA varianta veche `compute_health_scores()` (0 argumente, din mig. 040)
-- încă prezentă. `supabase.rpc('compute_health_scores')` (fără argumente,
-- din `automation-cron.js`) ar deveni ambiguă între cele două overload-uri.
-- Dropăm explicit varianta veche 0-arg înainte de a crea noua variantă
-- cu `p_batch_size default null` (echivalentă comportamental la apel fără
-- argumente, deci apelantul din cron nu observă nicio schimbare).
drop function if exists public.compute_health_scores();

create or replace function public.compute_health_scores(p_batch_size integer default null)
returns table (
  restaurant_id  uuid,
  score          integer,
  trend          text,
  alert_needed   boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  result record;
begin
  for r in
    select rest.id, rest.owner_id, p.email, p.full_name
      from public.restaurants rest
      join public.profiles p on p.id = rest.owner_id
     where rest.is_active = true
     order by rest.id
     limit p_batch_size
  loop
    begin
      select * into result from public._compute_one_health_score(r.id);
    exception when others then
      -- Izolare per-restaurant: o eroare aici NU oprește restul batch-ului.
      -- Logăm pentru vizibilitate în audit/logs Postgres și trecem mai departe.
      raise warning 'compute_health_scores: eșec la restaurant %: %', r.id, SQLERRM;
      continue;
    end;

    if result.alert_needed then
      -- Queue health alert email
      perform public.enqueue_email(
        r.email,
        'health_score_alert'::email_template_kind,
        jsonb_build_object(
          'owner_name', coalesce(r.full_name, 'Stimate patron'),
          'restaurant_id', r.id,
          'score', result.score,
          'trend', result.trend
        ),
        r.owner_id,
        r.full_name,
        null,
        'health_alert:' || r.id::text || ':' || to_char(now(), 'YYYY-MM-DD')
      );

      insert into public.lifecycle_events (user_id, restaurant_id, event_type, event_data)
      values (r.owner_id, r.id, 'health_critical', jsonb_build_object(
        'score', result.score, 'trend', result.trend
      ));
    end if;

    restaurant_id := r.id;
    score := result.score;
    trend := result.trend;
    alert_needed := result.alert_needed;
    return next;
  end loop;

  return;
end;
$$;

revoke all on function public.compute_health_scores(integer) from public;
-- Service role only (identic cu mig. 040).

-- ═══════════════════════════════════════════════════════════════
-- DONE. Nicio schimbare de schemă — doar create or replace pe 2 funcții
-- existente (`get_health_score`, `compute_health_scores`). Cooldown-ul
-- de recalculare manuală (mig. 178) rămâne neatins.
-- ═══════════════════════════════════════════════════════════════
