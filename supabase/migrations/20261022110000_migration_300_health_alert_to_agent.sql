-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 300 — Alerta „client în pericol" merge la AGENT, niciodată la patron
-- ═══════════════════════════════════════════════════════════════
-- Bug (de la mig 039, păstrat de 040 și 182): `compute_health_scores` punea în
-- coadă `health_score_alert` — un șablon INTERN („[INTERN] Health score
-- critic … Sună patronul în 24h") — către EMAILUL PATRONULUI (`p.email`, join
-- pe `restaurants.owner_id`). Adică exact omul despre care e alerta primea
-- nota internă care spune să fie sunat. Pe producție nu a plecat încă nimic
-- doar pentru că serverul (Netlify) e mort; prima republicare l-ar fi trimis.
--
-- Acum (lanț 039 → 040 → 182 → 300, aceeași semnătură, același RETURN):
--   • dacă patronul are o atribuire NE-terminală (status not in canceled/
--     refunded/expired, oglinda filtrului din has_partner_access 193/286), pe
--     care patronul NU a revocat-o explicit (partner_access_revoked_at is null),
--     iar afiliatul e `active` → `agent_client_at_risk` (mig 299) către
--     emailul AGENTULUI, cu contractul din process-email-queue.js: numele și
--     orașul localului, scorul, trendul, numele agentului — ZERO date ale
--     patronului; `user_id` = profilul agentului (RLS-ul „user reads own" nu
--     mai expune rândul patronului);
--   • altfel → NICIUN email; restaurantul apare în raportul de luni al
--     fondatorului (lifecycle_events `health_critical` rămâne scris);
--   • NICIODATĂ către patron (inclusiv o atribuire cu agentul = patronul, pe
--     care trigger-ul anti self-referral din 097 oricum o respinge).
--
-- Revocarea explicită exclude alerta (decizie, nu cerință a planului): scorul
-- e derivat din activitatea patronului (autentificări, comenzi); un patron care
-- i-a retras agentului accesul nu mai trimite agentului nici semnale despre ea.
--
-- Copie FIDELĂ a lui 182 în rest: aceeași buclă (`join profiles` păstrat ca
-- setul iterat să rămână identic), `limit p_batch_size`, izolarea per-restaurant
-- `exception when others` în jurul `_compute_one_health_score`, inserarea
-- `health_critical`, aceeași cheie de dedup `health_alert:<rid>:<zi>`. NOU:
-- rutarea către agent are propriul bloc `exception when others` — un eșec la
-- căutarea agentului sau la enqueue NU mai poate opri restul lotului, iar
-- funcția e dead-man's switch-ul /health (`checks.cron` citește computed_at),
-- deci un email nu are voie s-o omoare. Fără `now() -` în corp (JL1).
--
-- RĂMÂNE în denylist-ul pg_cron (274/282, CJ4/CJ11): e heartbeat-ul Netlify.
--
-- Curățare one-shot: alertele interne încă neplecate (queued/sending) trec în
-- `cancelled` — ar fi plecat la patroni la prima republicare. Șablonul
-- `health_score_alert` rămâne în worker (valoarea de enum nu se poate scoate;
-- EK1 cere șablon pentru fiecare valoare), dar nimic nu-l mai produce.
--
-- Teste permanente HA1–HA6: tests/sql/health_alert_routing_assertions.sql.
-- ═══════════════════════════════════════════════════════════════

begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';

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
  v_agent_profile uuid;
  v_agent_email   text;
  v_agent_name    text;
begin
  for r in
    -- Join-ul pe profiles e păstrat din 182 (setul iterat rămâne identic),
    -- dar NU se mai citesc datele patronului: alerta nu mai pleacă la el.
    select rest.id, rest.owner_id, rest.name, rest.city
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
      raise warning 'compute_health_scores: eșec la restaurant %: %', r.id, SQLERRM;
      continue;
    end;

    if result.alert_needed then
      -- Mig 300: alerta merge la AGENTUL clientului; fără agent → fără email
      -- (raportul de luni al fondatorului îl listează). Niciodată la patron.
      begin
        v_agent_profile := null;
        v_agent_email := null;
        v_agent_name := null;

        select a.profile_id, ap.email, ap.full_name
          into v_agent_profile, v_agent_email, v_agent_name
          from public.affiliate_attributions aa
          join public.affiliates a  on a.id = aa.affiliate_id
          join public.profiles  ap on ap.id = a.profile_id
         where aa.referred_profile_id = r.owner_id
           and aa.status not in ('canceled', 'refunded', 'expired')
           and aa.partner_access_revoked_at is null
           and a.status = 'active'
           and a.profile_id <> r.owner_id
         limit 1;

        if nullif(btrim(v_agent_email), '') is not null then
          perform public.enqueue_email(
            v_agent_email,
            'agent_client_at_risk'::email_template_kind,
            jsonb_build_object(
              'restaurant_name', r.name,
              'city', r.city,
              'score', result.score,
              'trend', result.trend,
              'agent_name', v_agent_name
            ),
            v_agent_profile,
            v_agent_name,
            null,
            'health_alert:' || r.id::text || ':' || to_char(now(), 'YYYY-MM-DD')
          );
        end if;
      exception when others then
        raise warning 'compute_health_scores: alerta către agent a eșuat la restaurant %: %', r.id, SQLERRM;
      end;

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

revoke all on function public.compute_health_scores(integer) from public, anon, authenticated, service_role;
grant execute on function public.compute_health_scores(integer) to service_role;

comment on function public.compute_health_scores(integer) is
  'Recalculează scorul de sănătate al restaurantelor active (heartbeat /health). Alerta critică merge DOAR la agentul activ al clientului (agent_client_at_risk, mig 300), niciodată la patron.';

-- ── Curățare one-shot: alertele interne rămase în coadă către patroni ──
update public.email_queue
   set status = 'cancelled',
       last_error = 'mig 300: alertă internă rutată greșit către patron'
 where template_kind = 'health_score_alert'
   and status in ('queued', 'sending');

-- ── Asserții fail-closed ─────────────────────────────────────────
do $$
declare
  v_src text;
  v_n   int;
begin
  select count(*) into v_n
    from pg_proc where proname = 'compute_health_scores'
     and pronamespace = 'public'::regnamespace;
  if v_n <> 1 then
    raise exception 'mig 300: % definiții compute_health_scores (anti-overload: trebuie exact 1)', v_n;
  end if;

  v_src := (select prosrc from pg_proc where oid = 'public.compute_health_scores(integer)'::regprocedure);
  if position('agent_client_at_risk' in v_src) = 0 then
    raise exception 'mig 300: compute_health_scores nu trimite agent_client_at_risk';
  end if;
  if position('health_score_alert' in v_src) > 0 then
    raise exception 'mig 300: compute_health_scores încă produce health_score_alert';
  end if;
  if v_src ~ '\mr\.email\M' or v_src ~ '\mp\.email\M' then
    raise exception 'mig 300: compute_health_scores încă citește emailul PATRONULUI';
  end if;
  if v_src !~ '_compute_one_health_score\(r\.id\);\s*exception when others' then
    raise exception 'mig 300: izolarea per-restaurant (exception when others) s-a pierdut';
  end if;
  if position('limit p_batch_size' in v_src) = 0 or position('''health_critical''' in v_src) = 0 then
    raise exception 'mig 300: batching-ul sau inserarea health_critical s-au pierdut';
  end if;
  if v_src ~* 'now\(\)\s*-' then
    raise exception 'mig 300: corpul conține now() - (ar intra sub clichetul de janitori JL1)';
  end if;

  if not exists (
    select 1 from pg_proc
     where oid = 'public.compute_health_scores(integer)'::regprocedure
       and prosecdef
       and proconfig @> array['search_path=public, pg_temp']
  ) then
    raise exception 'mig 300: compute_health_scores nu e DEFINER cu search_path = public, pg_temp';
  end if;

  if not has_function_privilege('service_role', 'public.compute_health_scores(integer)', 'execute')
     or has_function_privilege('anon', 'public.compute_health_scores(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.compute_health_scores(integer)', 'execute') then
    raise exception 'mig 300: grant-uri greșite pe compute_health_scores (doar service_role)';
  end if;

  if not exists (select 1 from public.pg_cron_janitor_denylist() where fn_name = 'compute_health_scores') then
    raise exception 'mig 300: compute_health_scores a ieșit din denylist-ul pg_cron (dead-man''s switch)';
  end if;

  if exists (select 1 from public.email_queue
              where template_kind = 'health_score_alert' and status in ('queued', 'sending')) then
    raise exception 'mig 300: au rămas alerte interne neplecate în coadă';
  end if;
end $$;

commit;
