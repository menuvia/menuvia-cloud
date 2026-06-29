-- mig 171 — Hardening cotă AI (lock anti-cursă + constrângeri non-negative)
-- ─────────────────────────────────────────────────────────────────────
-- Remediază findingul HIGH din analiza critică: `ai_record_usage` (mig 168)
-- citea ai_quota FĂRĂ lock (prin ai_ensure_quota) și apoi scădea — două apeluri
-- AI concurente pe același restaurant puteau produce dublă scădere / sold negativ
-- (lost update sub READ COMMITTED). Recreăm funcția cu `SELECT ... FOR UPDATE`
-- în aceeași tranzacție cu UPDATE-ul, plus constrângeri de plasă de siguranță.
--
-- Migrațiile aplicate sunt imutabile (CLAUDE.md) → recreăm prin CREATE OR REPLACE
-- într-un fișier nou, păstrând EXACT semnătura, search_path și grant-urile.
-- Idempotent; asserții fail-closed.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── 1. Constrângeri de plasă de siguranță pe ai_quota ───────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_quota_credit_nonneg') then
    alter table public.ai_quota add constraint ai_quota_credit_nonneg check (credit_balance >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_quota_used_nonneg') then
    alter table public.ai_quota add constraint ai_quota_used_nonneg check (used_tokens >= 0);
  end if;
end $$;

-- ── 2. Recreează ai_record_usage cu lock pe rând ────────────────────
-- Semnătura + search_path + grants IDENTICE cu mig 168 (grants persistă la
-- CREATE OR REPLACE; le re-acordăm defensiv la final).
create or replace function public.ai_record_usage(
  p_restaurant_id uuid,
  p_feature       text,
  p_provider      text,
  p_model         text,
  p_input_tokens  integer,
  p_output_tokens integer,
  p_cost          numeric default 0,
  p_success       boolean default true,
  p_error         text default null
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
begin
  insert into public.ai_usage (restaurant_id, feature, provider, model,
                               input_tokens, output_tokens, cost_estimate, success, error)
    values (p_restaurant_id, p_feature, coalesce(p_provider, ''), coalesce(p_model, ''),
            greatest(coalesce(p_input_tokens, 0), 0), greatest(coalesce(p_output_tokens, 0), 0),
            coalesce(p_cost, 0), coalesce(p_success, true), p_error);

  -- Scade din cotă DOAR pentru apeluri reușite.
  if coalesce(p_success, true) then
    -- Asigură existența rândului + roll lunar, apoi RE-CITEȘTE CU LOCK în aceeași
    -- tranzacție → serializează apelurile concurente pe același restaurant și
    -- elimină lost-update-ul (dublă scădere / sold negativ).
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
revoke all on function public.ai_record_usage(uuid, text, text, text, integer, integer, numeric, boolean, text)
  from public, anon, authenticated;
grant execute on function public.ai_record_usage(uuid, text, text, text, integer, integer, numeric, boolean, text)
  to service_role;

-- ── Asserții fail-closed ────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_quota_credit_nonneg') then
    raise exception 'mig 171: constrângerea ai_quota_credit_nonneg lipsește'; end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_quota_used_nonneg') then
    raise exception 'mig 171: constrângerea ai_quota_used_nonneg lipsește'; end if;
  -- Funcția conține lock-ul FOR UPDATE
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'ai_record_usage'
       and pg_get_functiondef(p.oid) ilike '%for update%'
  ) then
    raise exception 'mig 171: ai_record_usage nu conține FOR UPDATE'; end if;
  if not has_function_privilege('service_role',
       'public.ai_record_usage(uuid, text, text, text, integer, integer, numeric, boolean, text)', 'EXECUTE') then
    raise exception 'mig 171: service_role nu poate executa ai_record_usage'; end if;
  raise notice 'mig 171: AI quota hardening OK';
end $$;

commit;
