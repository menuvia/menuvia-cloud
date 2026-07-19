-- mig 239 — recuperarea facturilor Oblio blocate în 'generating'
-- ─────────────────────────────────────────────────────────────────────
-- Bug de reziliență (re-audit săpt. 10): claim-ul din coada Oblio (mig 181,
-- bridge_oblio_get_queued) transiționează DOAR queued→generating; nimic nu
-- recuperează un rând rămas în 'generating' după un kill dur de proces
-- (OOM/timeout Netlify ÎNTRE claim și blocul try/catch al generatorului).
-- Rezultat: factura e blocată PERMANENT — invizibilă și în lista de eșecuri a
-- founderului (care listează 'failed'), fără nicio cale de recuperare.
--
-- Fix în 3 pași:
--   A. Coloană `generating_since` — momentul intrării în 'generating' (nu
--      există `updated_at` pe invoices). Fără ea, un reclaim pe `created_at`
--      ar marca fals o factură ABIA claim-uită (creată demult, procesată acum).
--   B. bridge_oblio_get_queued (lanț 041→181→239) stampilează generating_since
--      = now() la claim. Restul semnăturii/logicii — IDENTIC cu mig 181.
--   C. oblio_reclaim_stale_generating (service_role, cron orar) marchează
--      'generating' cu generating_since mai vechi de p_minutes ca 'failed' cu
--      eroare AMBIGUĂ. NU re-pune în coadă (kill în timpul POST-ului la Oblio
--      e ambiguu — factura poate fi DEJA creată; mig 218 impune retry MANUAL
--      după verificare). Odată 'failed', apare în admin_list_invoice_failures.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── A. Coloana de timp pentru intrarea în 'generating' ───────────────
alter table public.invoices
  add column if not exists generating_since timestamptz;

comment on column public.invoices.generating_since is
  'Momentul intrării în status generating (mig 239) — bază pentru reclaim-ul de facturi blocate la un kill de proces (oblio_reclaim_stale_generating).';

-- ── B. bridge_oblio_get_queued — lanț 041→181→239 (+ stamp) ──────────
create or replace function public.bridge_oblio_get_queued(p_limit integer default 10)
returns table (
  invoice_id        uuid,
  restaurant_id     uuid,
  order_id          uuid,
  customer_name     text,
  customer_cif      text,
  customer_address  text,
  customer_email    text,
  customer_phone    text,
  is_b2b            boolean,
  total_with_vat    numeric,
  api_email         text,
  api_secret        text,
  company_cif       text,
  company_name      text,
  default_series    text,
  vat_included      boolean,
  send_email        boolean,
  test_mode         boolean
)
language sql
security definer
volatile
set search_path = public, pg_temp
as $$
  with claimed as (
    update public.invoices
       set status = 'generating',
           generating_since = now()   -- mig 239: stamp pentru reclaim-ul de stale
     where id in (
       select i.id
       from public.invoices i
       join public.oblio_configs oc
         on oc.restaurant_id = i.restaurant_id
        and oc.is_active = true
       where i.status = 'queued'
         and i.failed_attempts < 3
         and (i.next_attempt_at is null or i.next_attempt_at <= now())
       order by i.created_at asc
       limit p_limit
       for update skip locked
     )
    returning *
  )
  select
    c.id as invoice_id,
    c.restaurant_id, c.order_id,
    c.customer_name, c.customer_cif, c.customer_address, c.customer_email, c.customer_phone,
    c.is_b2b, c.total_with_vat,
    oc.api_email, oc.api_secret, oc.company_cif, oc.company_name,
    oc.default_series, oc.vat_included, oc.send_email, oc.test_mode
  from claimed c
  join public.oblio_configs oc on oc.restaurant_id = c.restaurant_id and oc.is_active;
$$;

revoke all on function public.bridge_oblio_get_queued(integer) from public;

-- ── C. oblio_reclaim_stale_generating — service_role, cron orar ──────
create or replace function public.oblio_reclaim_stale_generating(p_minutes integer default 15)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.invoices
     set status = 'failed',
         last_error = 'STUCK_GENERATING: proces întrerupt în timpul emiterii — '
                      || 'VERIFICĂ în Oblio dacă factura a fost deja creată ÎNAINTE de retry '
                      || '(risc de duplicat fiscal).'
   where status = 'generating'
     -- generating_since null (rând intrat înainte de mig 239) → folosim created_at
     -- ca fallback conservator (rândurile vechi blocate sunt oricum de recuperat).
     and coalesce(generating_since, created_at) < now() - make_interval(mins => greatest(coalesce(p_minutes, 15), 5));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.oblio_reclaim_stale_generating(integer) from public;
revoke all on function public.oblio_reclaim_stale_generating(integer) from anon, authenticated;
grant execute on function public.oblio_reclaim_stale_generating(integer) to service_role;

-- ── Asserții fail-closed ─────────────────────────────────────────────
do $$
declare v_def text;
begin
  -- claim-ul stampilează generating_since
  v_def := pg_get_functiondef('public.bridge_oblio_get_queued(integer)'::regprocedure);
  if v_def not ilike '%generating_since%' then
    raise exception 'mig 239: bridge_oblio_get_queued nu stampilează generating_since';
  end if;

  -- reclaim: generating→failed, NU generating→queued (anti auto-requeue)
  v_def := pg_get_functiondef('public.oblio_reclaim_stale_generating(integer)'::regprocedure);
  if v_def not ilike '%''generating''%' or v_def not ilike '%''failed''%' then
    raise exception 'mig 239: reclaim-ul nu țintește generating→failed';
  end if;
  if v_def ilike '%''queued''%' then
    raise exception 'mig 239: reclaim-ul re-pune în coadă (interzis — duplicat fiscal)';
  end if;
  if has_function_privilege('anon', 'public.oblio_reclaim_stale_generating(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.oblio_reclaim_stale_generating(integer)', 'execute') then
    raise exception 'mig 239: reclaim accesibil non-service_role';
  end if;
  raise notice 'mig 239: oblio_reclaim_stale_generating + stamp claim OK';
end $$;

commit;
