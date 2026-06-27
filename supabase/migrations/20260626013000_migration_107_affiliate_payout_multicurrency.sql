-- mig 107 — Fix P1: comisioanele non-RON (EUR) nu erau niciodată plătite (PAYOUT-3)
--
-- PROBLEMA: affiliate_currency = ('RON','EUR') iar RPC-ul de comision acceptă EUR
-- (mig 099) → pot exista rânduri de ledger EUR. Dar run_affiliate_payout_batch
-- (mig 098/106) filtra EXCLUSIV currency='RON' (eligibil + committed) și hardcoda
-- 'RON' la insert. Comisioanele EUR rămâneau blocate pe veci: niciun draft, nicio
-- alertă, bani datorați afiliatului neplătiți.
--
-- FIX: batch-ul buclează peste monedele distincte cu sold plătibil per afiliat și
-- creează un draft per (afiliat, perioadă, monedă). Necesită extinderea cheii de
-- unicitate cu `currency` (altfel două monede în aceeași perioadă s-ar ciocni).
-- Păstrează regula PAYOUT-2 (mig 106): gross angajat și pentru failed-cu-transfer.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── 1) Cheie de unicitate per (afiliat, perioadă, MONEDĂ) ────────────────────
alter table public.affiliate_payouts
  drop constraint if exists affiliate_payouts_affiliate_id_period_month_key;
alter table public.affiliate_payouts
  add constraint affiliate_payouts_affiliate_period_currency_key
  unique (affiliate_id, period_month, currency);

-- ── 2) Batch multi-monedă ────────────────────────────────────────────────────
create or replace function public.run_affiliate_payout_batch(
  p_period_month date,
  p_min_cents    bigint default 5000
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  r           record;
  cur         public.affiliate_currency;
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
    -- O rulare per monedă cu sold plătibil (RON și/sau EUR).
    for cur in
      select distinct currency from public.v_affiliate_payable where affiliate_id = r.id
    loop
      select coalesce(sum(amount_cents), 0) into v_eligible
        from public.v_affiliate_payable where affiliate_id = r.id and currency = cur;

      -- Angajat: în zbor sau decontat; eliberăm doar canceled și failed FĂRĂ transfer.
      select coalesce(sum(gross_cents), 0) into v_committed
        from public.affiliate_payouts
       where affiliate_id = r.id and currency = cur
         and (status in ('draft','awaiting_invoice','invoice_matched','processing','paid','on_hold')
              or (status = 'failed' and wise_transfer_id is not null));

      v_payable := v_eligible - v_committed;

      if v_payable < p_min_cents then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      insert into public.affiliate_payouts (affiliate_id, period_month, currency, gross_cents, status)
      values (r.id, p_period_month, cur, v_payable, 'draft')
      on conflict (affiliate_id, period_month, currency) do nothing;

      if found then v_created := v_created + 1; else v_skipped := v_skipped + 1; end if;
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'created', v_created, 'skipped', v_skipped,
                            'period', p_period_month);
end$$;

-- ── Asserții inline ──────────────────────────────────────────────────────────
do $$ begin
  if exists (select 1 from pg_constraint
     where conrelid='public.affiliate_payouts'::regclass and contype='u'
       and conname='affiliate_payouts_affiliate_id_period_month_key') then
    raise exception 'mig 107: cheia veche (fără currency) încă există';
  end if;
  if not exists (select 1 from pg_constraint
     where conrelid='public.affiliate_payouts'::regclass and contype='u'
       and conname='affiliate_payouts_affiliate_period_currency_key') then
    raise exception 'mig 107: cheia nouă (cu currency) lipsește';
  end if;
  raise notice 'mig 107: payout multi-monedă OK';
end $$;

commit;
