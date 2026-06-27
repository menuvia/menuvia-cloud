-- mig 098 — Program de afiliere: payouts (Faza 5, backend)
--
-- Modelul de decontare peste un ledger APPEND-ONLY (WORM). Provocarea: nu poți
-- marca un comision drept „plătit" printr-un UPDATE (WORM interzice). Soluția:
--   • O plată ESTE o intrare nouă de ledger (leg='payout', amount NEGATIV).
--   • Debitul se inserează EXACT la tranziția → 'paid' (nu la draft), printr-un
--     trigger AFTER UPDATE pe affiliate_payouts. Astfel banii apar în ledger
--     doar când chiar pleacă; un payout eșuat nu lasă debit.
--   • „Disponibil de plată acum" = credite_eligibile − plăți_în_zbor_sau_decontate.
--     Plățile draft/processing (gross rezervat) scad disponibilul → fără
--     dublă-plată cât timp un payout e în curs. Un payout failed/canceled își
--     eliberează gross-ul → suma redevine plătibilă.
--   • Datoria negativă (clawback după plată) se reportează natural: balanța
--     devine negativă, iar batch-ul următor o scade din eligibil.
--
-- Idempotency: UNIQUE(affiliate, period) pe payout-uri; wise_customer_txn_id e
-- un UUID PERSISTAT (nu derivat în cod) — cheia de idempotență pentru Wise.
--
-- ATENȚIE: integrarea Wise HTTP (Netlify fn) necesită validare în sandbox
-- (idempotența fund-step + TTL customerTransactionId) ÎNAINTE de activare.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 1. Enum status payout (state machine)
-- ═══════════════════════════════════════════════════════════════════════════
do $$ begin
  if not exists (select 1 from pg_type where typname = 'affiliate_payout_status') then
    create type public.affiliate_payout_status as enum (
      'draft',            -- creat de batch, sold rezervat
      'awaiting_invoice', -- afiliatul trebuie să emită factura
      'invoice_matched',  -- factura confirmată (Oblio/SPV/manual)
      'processing',       -- transfer Wise creat + în finanțare (wise_transfer_id setat)
      'paid',             -- confirmat trimis → inserează debitul în ledger
      'failed',           -- eșuat (IBAN invalid etc.) → gross eliberat
      'on_hold',          -- ambiguu, necesită reconciliere manuală
      'canceled'          -- anulat (afiliatul nu a facturat) → gross eliberat
    );
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 2. affiliate_payout_profile — date fiscale/bancare (off critical path)
--   Populat la onboarding payout, NU la atribuire. CUI/IBAN = date sensibile.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.affiliate_payout_profile (
  affiliate_id     uuid primary key references public.affiliates(id) on delete restrict,
  legal_form       text not null check (legal_form in ('pfa','srl','other')),
  cui              text,
  iban             text,
  beneficiary_name text,
  payout_method    text not null default 'wise',
  updated_at       timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

comment on table public.affiliate_payout_profile is
  'Date fiscale/bancare afiliat (PFA/SRL). Sensibile — RLS own, scriere prin RPC.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 3. affiliate_payouts — un batch per afiliat per perioadă
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.affiliate_payouts (
  id                   uuid primary key default gen_random_uuid(),
  affiliate_id         uuid not null references public.affiliates(id) on delete restrict,
  period_month         date not null check (period_month = date_trunc('month', period_month)::date),
  currency             public.affiliate_currency not null default 'RON',
  gross_cents          bigint not null check (gross_cents > 0),
  status               public.affiliate_payout_status not null default 'draft',
  -- Cheia de idempotență Wise: UUID PERSISTAT (trimis ca customerTransactionId).
  wise_customer_txn_id uuid not null default gen_random_uuid(),
  wise_transfer_id     bigint unique,         -- setat la creare transfer (processing+)
  invoice_number       text,                  -- factura afiliatului (e-Factura/SPV)
  invoice_matched_at   timestamptz,
  failure_reason       text,
  paid_at              timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (affiliate_id, period_month),
  unique (wise_customer_txn_id)
);

create index if not exists idx_affiliate_payouts_status on public.affiliate_payouts(status);
create index if not exists idx_affiliate_payouts_affiliate on public.affiliate_payouts(affiliate_id);

comment on table public.affiliate_payouts is
  'Batch de plată per afiliat/perioadă. State machine; debit ledger la paid.';

-- Legătura debitului de payout din ledger către batch-ul său.
alter table public.affiliate_ledger
  add column if not exists payout_id uuid references public.affiliate_payouts(id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 4. State machine: tranziții valide + debit ledger la 'paid'
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_affiliate_payout_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_ok boolean := false;
begin
  if OLD.status = NEW.status then
    return NEW;  -- update non-status (ex. invoice_number) permis
  end if;

  -- Matrice de tranziții permise.
  v_ok := case OLD.status
    when 'draft'            then NEW.status in ('awaiting_invoice','canceled')
    when 'awaiting_invoice' then NEW.status in ('invoice_matched','canceled')
    when 'invoice_matched'  then NEW.status in ('processing','canceled')
    when 'processing'       then NEW.status in ('paid','failed','on_hold')
    when 'on_hold'          then NEW.status in ('paid','failed')
    when 'failed'           then NEW.status in ('invoice_matched','canceled')
    else false  -- paid / canceled = terminale
  end;

  if not v_ok then
    raise exception using errcode = 'check_violation',
      message = format('payout: tranziție invalidă %s → %s', OLD.status, NEW.status),
      hint    = 'invalid_payout_transition';
  end if;

  -- Niciodată înapoi spre o stare pre-transfer odată ce wise_transfer_id există
  -- (ar risca dubla-plată). Acoperit parțial de matrice, dar gardăm explicit.
  if OLD.wise_transfer_id is not null and NEW.status in ('draft','awaiting_invoice','invoice_matched') then
    raise exception using errcode = 'check_violation',
      message = 'payout: nu se poate reveni la o stare pre-transfer după ce există wise_transfer_id',
      hint    = 'invalid_payout_transition';
  end if;

  NEW.updated_at := now();
  if NEW.status = 'paid' and NEW.paid_at is null then
    NEW.paid_at := now();
  end if;
  return NEW;
end$$;

drop trigger if exists trg_affiliate_payout_transition on public.affiliate_payouts;
create trigger trg_affiliate_payout_transition
  before update on public.affiliate_payouts
  for each row execute function public.fn_affiliate_payout_transition();

-- La 'paid': inserează debitul în ledger (decontare WORM-compatibilă).
create or replace function public.fn_affiliate_payout_settle()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if NEW.status = 'paid' and OLD.status <> 'paid' then
    insert into public.affiliate_ledger
      (affiliate_id, leg, amount_cents, currency, hold_until, payout_id)
    values
      (NEW.affiliate_id, 'payout', -NEW.gross_cents, NEW.currency, now(), NEW.id);
  end if;
  return null;
end$$;

drop trigger if exists trg_affiliate_payout_settle on public.affiliate_payouts;
create trigger trg_affiliate_payout_settle
  after update on public.affiliate_payouts
  for each row execute function public.fn_affiliate_payout_settle();

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 5. RPC run_affiliate_payout_batch — creează draft-uri din soldul plătibil
--   Idempotent per (afiliat, perioadă). „Plătibil acum" = eligibil − în-zbor.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.run_affiliate_payout_batch(
  p_period_month date,
  p_min_cents    bigint default 5000   -- prag minim (carry-forward sub el)
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  r           record;
  v_eligible  bigint;
  v_committed bigint;
  v_payable   bigint;
  v_created   int := 0;
  v_skipped   int := 0;
begin
  if p_period_month <> date_trunc('month', p_period_month)::date then
    raise exception 'period_month trebuie să fie prima zi a lunii';
  end if;

  for r in select id from public.affiliates where status = 'active' loop
    -- Credite eligibile (trecute de hold, ne-stornate), în RON.
    select coalesce(sum(amount_cents), 0) into v_eligible
      from public.v_affiliate_payable where affiliate_id = r.id and currency = 'RON';

    -- Sume deja angajate (în zbor sau decontate) — exclude failed/canceled.
    select coalesce(sum(gross_cents), 0) into v_committed
      from public.affiliate_payouts
     where affiliate_id = r.id and currency = 'RON'
       and status in ('draft','awaiting_invoice','invoice_matched','processing','paid');

    v_payable := v_eligible - v_committed;

    if v_payable < p_min_cents then
      v_skipped := v_skipped + 1;
      continue;  -- carry-forward
    end if;

    -- Idempotent: un singur batch per (afiliat, perioadă).
    insert into public.affiliate_payouts (affiliate_id, period_month, currency, gross_cents, status)
    values (r.id, p_period_month, 'RON', v_payable, 'draft')
    on conflict (affiliate_id, period_month) do nothing;

    if found then v_created := v_created + 1; else v_skipped := v_skipped + 1; end if;
  end loop;

  return jsonb_build_object('ok', true, 'created', v_created, 'skipped', v_skipped,
                            'period', p_period_month);
end$$;

revoke all on function public.run_affiliate_payout_batch(date, bigint) from public, anon, authenticated;
grant execute on function public.run_affiliate_payout_batch(date, bigint) to service_role;

comment on function public.run_affiliate_payout_batch(date, bigint) is
  'Creează draft-uri de payout din soldul plătibil (eligibil − în-zbor). Idempotent per afiliat/perioadă.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 6. Privilegii + RLS
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.affiliate_payout_profile enable row level security;
alter table public.affiliate_payouts        enable row level security;

revoke insert, update, delete on public.affiliate_payout_profile from public, anon, authenticated;
revoke insert, update, delete on public.affiliate_payouts        from public, anon, authenticated;

-- Afiliatul își vede propriile date de payout (folosește helper-ul din 097).
drop policy if exists "affiliate: read own payout profile" on public.affiliate_payout_profile;
create policy "affiliate: read own payout profile" on public.affiliate_payout_profile
  for select to authenticated
  using (affiliate_id in (select public.affiliate_visible_ids()));

drop policy if exists "affiliate: read own payouts" on public.affiliate_payouts;
create policy "affiliate: read own payouts" on public.affiliate_payouts
  for select to authenticated
  using (affiliate_id in (select public.affiliate_visible_ids()));

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 7. Asserții inline
-- ═══════════════════════════════════════════════════════════════════════════
do $$ begin
  if not exists (select 1 from pg_trigger where tgname='trg_affiliate_payout_settle'
     and tgrelid='public.affiliate_payouts'::regclass) then
    raise exception 'mig 098: settle trigger missing';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='run_affiliate_payout_batch' and p.prosecdef) then
    raise exception 'mig 098: run_affiliate_payout_batch missing/not SECURITY DEFINER';
  end if;
  raise notice 'mig 098: affiliate payouts OK';
end $$;

commit;
