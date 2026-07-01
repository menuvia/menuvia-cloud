-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 181 — Oblio queue: fix claim înaintea filtrului is_active +
--                 backoff exponențial (liniar) pe retry
-- ═══════════════════════════════════════════════════════════════
-- Audit pe RPC-urile din mig 041 (supabase/migrations/20260525003900_migration_041_oblio_invoices.sql,
-- fișier aplicat — NU se editează):
--
-- [HIGH] bridge_oblio_get_queued: filtrul `oblio_configs.is_active` era aplicat
--   în JOIN-ul final, DUPĂ ce rândurile din `invoices` erau deja claim-uite
--   (UPDATE ... status = 'generating' ... FOR UPDATE SKIP LOCKED) în CTE-ul
--   `claimed`. Efect: facturi pentru restaurante cu Oblio dezactivat erau
--   totuși marcate 'generating' (consumate din coadă) fără să fie efectiv
--   trimise mai departe către Oblio API — rămâneau blocate, nu 'queued'.
--   Fix: mutăm filtrul `oc.is_active = true` în subquery-ul de selecție a
--   rândurilor de claim-uit (join cu oblio_configs ÎNAINTE de FOR UPDATE
--   SKIP LOCKED), astfel încât facturile pentru config inactiv nu sunt
--   atinse deloc — rămân 'queued', vizibile în UI, dar neconsumate.
--
-- [medium] bridge_oblio_mark_failed: la failed_attempts >= 3 seta direct
--   status = 'failed', fără backoff progresiv între încercări (spre
--   deosebire de email_queue care are scheduled_for). Fix: coloană nouă
--   `invoices.next_attempt_at` + backoff liniar (failed_attempts * 2 min)
--   setat la fiecare eșec; `bridge_oblio_get_queued` filtrează suplimentar
--   pe `next_attempt_at is null or next_attempt_at <= now()` la claim.

-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ 1. Coloană nouă pentru backoff ─────────────────────────────  ║
-- ╚═══════════════════════════════════════════════════════════════╝

alter table public.invoices
  add column if not exists next_attempt_at timestamptz;

comment on column public.invoices.next_attempt_at is
  'Backoff liniar pe retry Oblio: nu se re-claim-uiește înainte de acest timestamp (failed_attempts * 2 min).';


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ 2. bridge_oblio_get_queued — fix claim + backoff ────────────  ║
-- ╚═══════════════════════════════════════════════════════════════╝
-- Filtrul pe oc.is_active e mutat ÎN subquery-ul de selecție (înainte de
-- FOR UPDATE SKIP LOCKED), la fel și filtrul pe next_attempt_at. Semnătura
-- rămâne identică cu originalul din mig 041 (create or replace = idempotent).

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
  -- Config (din join cu oblio_configs)
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
       set status = 'generating'
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
-- Service role only (identic cu mig 041 — fără grant explicit, apelat doar
-- via service_role key din Netlify function).


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ 3. bridge_oblio_mark_failed — backoff liniar ────────────────  ║
-- ╚═══════════════════════════════════════════════════════════════╝
-- La fiecare eșec: next_attempt_at = now() + (failed_attempts * 2 minute).
-- La failed_attempts + 1 >= 3, status devine 'failed' definitiv (comportament
-- neschimbat față de mig 041) — next_attempt_at rămâne setat informativ, dar
-- nu mai contează pentru claim (status != 'queued').

create or replace function public.bridge_oblio_mark_failed(
  p_invoice_id uuid,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempts integer;
begin
  update public.invoices
     set failed_attempts = failed_attempts + 1,
         last_error = left(p_error, 1000),
         status = case
           when failed_attempts + 1 >= 3 then 'failed'::invoice_status
           else 'queued'::invoice_status
         end,
         next_attempt_at = now() + ((failed_attempts + 1) * interval '2 minutes')
   where id = p_invoice_id
  returning failed_attempts into v_attempts;

  return found;
end;
$$;

revoke all on function public.bridge_oblio_mark_failed(uuid, text) from public;
-- Service role only (identic cu mig 041 — fără grant explicit).
