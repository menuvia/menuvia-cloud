-- mig 185 — ai_record_usage: idempotență pe request_id (evită dublă scădere la retry)
-- ─────────────────────────────────────────────────────────────────────
-- Remediază finding Major din code review (PR wave2r-ai-fixes): ai-proxy.js
-- reîncearcă o dată apelul RPC `ai_record_usage` dacă primul răspuns arată
-- eroare (timeout de rețea/pool) — dar dacă primul apel a comis efectiv
-- INSERT-ul + scăderea de cotă pe server, iar clientul doar n-a primit
-- răspunsul, reîncercarea dubla-încarcă: încă un rând `ai_usage` + încă o
-- scădere din cotă pentru un singur apel real către provider.
--
-- Fix: adăugăm parametru opțional `p_request_id` (generat o singură dată în
-- ai-proxy.js per apel către provider, refolosit identic la reîncercare).
-- `ai_usage.request_id` are unique index parțial (doar rânduri ne-null) —
-- INSERT-ul devine `on conflict ... do nothing`; scăderea de cotă rulează
-- DOAR dacă rândul chiar s-a inserat (nu la un conflict = retry idempotent).
-- Apelanții care NU trimit `p_request_id` (ex. ramura de eroare din
-- ai-proxy.js, care nu se reîncearcă) păstrează comportamentul vechi exact
-- (request_id null → niciodată conflict → mereu inserează + scade cota).
--
-- Migrațiile aplicate sunt imutabile (CLAUDE.md) → fișier nou. Schimbarea de
-- semnătură (9→10 parametri) necesită `drop function if exists` explicit
-- înainte de `create` (altfel Postgres creează un overload ambiguu, nu
-- înlocuiește — capcană cunoscută, vezi mig 182). Idempotent; asserții fail-closed.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── 1. Coloană + index unic parțial pe ai_usage.request_id ──────────
alter table public.ai_usage add column if not exists request_id text;

create unique index if not exists idx_ai_usage_request_id_uniq
  on public.ai_usage(request_id) where request_id is not null;

-- ── 2. Drop explicit al semnăturii vechi (9 param.) ─────────────────
drop function if exists public.ai_record_usage(uuid, text, text, text, integer, integer, numeric, boolean, text);

-- ── 3. Recreează ai_record_usage cu p_request_id + guard idempotent ─
create or replace function public.ai_record_usage(
  p_restaurant_id uuid,
  p_feature       text,
  p_provider      text,
  p_model         text,
  p_input_tokens  integer,
  p_output_tokens integer,
  p_cost          numeric default 0,
  p_success       boolean default true,
  p_error         text default null,
  p_request_id    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.ai_quota;
  v_total integer := greatest(coalesce(p_input_tokens, 0), 0) + greatest(coalesce(p_output_tokens, 0), 0);
  v_from_included integer;
  v_from_credit integer;
  v_inserted_rows integer;
begin
  insert into public.ai_usage (restaurant_id, feature, provider, model,
                               input_tokens, output_tokens, cost_estimate, success, error, request_id)
    values (p_restaurant_id, p_feature, coalesce(p_provider, ''), coalesce(p_model, ''),
            greatest(coalesce(p_input_tokens, 0), 0), greatest(coalesce(p_output_tokens, 0), 0),
            coalesce(p_cost, 0), coalesce(p_success, true), p_error, p_request_id)
  on conflict (request_id) where request_id is not null do nothing;

  get diagnostics v_inserted_rows = row_count;

  -- Scade din cotă DOAR pentru apeluri reușite CARE CHIAR au inserat un rând
  -- nou (v_inserted_rows = 0 + request_id ne-null = reîncercare idempotentă
  -- a unui apel deja înregistrat — sărim scăderea, altfel dublu-taxăm).
  if coalesce(p_success, true) and not (p_request_id is not null and v_inserted_rows = 0) then
    -- Asigură existența rândului + roll lunar, apoi RE-CITEȘTE CU LOCK în aceeași
    -- tranzacție → serializează apelurile concurente pe același restaurant și
    -- elimină lost-update-ul (dublă scădere / sold negativ) — nemodificat din mig 171.
    perform public.ai_ensure_quota(p_restaurant_id);
    select * into v from public.ai_quota where restaurant_id = p_restaurant_id for update;

    v_from_included := least(greatest(v.included_tokens - v.used_tokens, 0), v_total);
    v_from_credit   := least(greatest(v.credit_balance, 0), v_total - v_from_included);
    update public.ai_quota
       set used_tokens    = used_tokens + v_from_included,
           credit_balance = credit_balance - v_from_credit,
           updated_at     = now()
     where restaurant_id = p_restaurant_id;
  end if;

  v := public.ai_ensure_quota(p_restaurant_id);
  return jsonb_build_object(
    'recorded_tokens', v_total,
    'included_remaining', greatest(v.included_tokens - v.used_tokens, 0),
    'credit_balance', v.credit_balance
  );
end;
$$;

revoke all on function public.ai_record_usage(uuid, text, text, text, integer, integer, numeric, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.ai_record_usage(uuid, text, text, text, integer, integer, numeric, boolean, text, text)
  to service_role;

-- ── Asserții fail-closed ────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_attribute a join pg_class c on c.oid = a.attrelid
     where c.relname = 'ai_usage' and a.attname = 'request_id' and not a.attisdropped
  ) then
    raise exception 'mig 185: coloana ai_usage.request_id lipsește'; end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_ai_usage_request_id_uniq') then
    raise exception 'mig 185: idx_ai_usage_request_id_uniq lipsește'; end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'ai_record_usage'
       and pg_get_function_arguments(p.oid) ilike '%p_request_id%'
  ) then
    raise exception 'mig 185: ai_record_usage nu are parametrul p_request_id'; end if;
  if not has_function_privilege('service_role',
       'public.ai_record_usage(uuid, text, text, text, integer, integer, numeric, boolean, text, text)', 'EXECUTE') then
    raise exception 'mig 185: service_role nu poate executa ai_record_usage'; end if;
  raise notice 'mig 185: ai_record_usage idempotent pe request_id OK';
end $$;

commit;
