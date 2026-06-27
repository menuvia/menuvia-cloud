-- mig 105 — Fix P1: dublă plată a comisionului de setup la race (AFF-LEDGER-1)
--
-- PROBLEMA (review adversarial): determinarea „prima factură cu bani = setup"
-- în process_affiliate_invoice_paid (mig 099) e read-then-write: `select not
-- exists(... leg='setup')` apoi insert cu `on conflict (stripe_event_id, leg)`.
-- Indexul uq_affiliate_ledger_event_leg e PER-EVENT; nu există unicitate pe
-- atribuire pentru setup. Două invoice.paid concurente cu event_id-uri DIFERITE
-- (livrare paralelă / out-of-order Stripe) citesc ambele „no setup" → inserează
-- ambele leg='setup' → niciun conflict → 2× comision de activare (30%).
-- Recurring e deja protejat de uq_affiliate_ledger_recurring_period; setup nu era.
--
-- FIX: index unic parțial — un singur rând leg='setup' per atribuire, vreodată.
-- A doua inserție concurentă eșuează cu unique_violation (prinsă best-effort de
-- webhook), deci comisionul de setup rămâne unic. Acoperă și re-subscribe după
-- refund integral (nu se mai acordă un al doilea setup pe aceeași atribuire —
-- previne și „setup farming" prin refund+resubscribe).

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

create unique index if not exists uq_affiliate_ledger_setup_per_attribution
  on public.affiliate_ledger (attribution_id)
  where leg = 'setup' and attribution_id is not null;

do $$ begin
  if not exists (select 1 from pg_indexes where schemaname='public'
       and indexname='uq_affiliate_ledger_setup_per_attribution') then
    raise exception 'mig 105: index setup-per-attribution lipsește';
  end if;
  raise notice 'mig 105: setup unique per attribution OK';
end $$;

commit;
