-- mig 104 — Fix securitate/GDPR: atribuiri + ledger = own-only (frați ai leak-ului 103)
--
-- CONTINUAREA review-ului care a produs mig 103. Aceeași clasă de problemă pe
-- tabelele-soră: policy-urile de SELECT pe affiliate_attributions și
-- affiliate_ledger foloseau `affiliate_visible_ids()` (own + sub-afiliați).
-- Efect: un afiliat-părinte putea citi prin ORICE client PostgREST:
--   • affiliate_attributions → `stripe_customer_id` + `referred_profile_id` ale
--     clienților aduși de sub-afiliat (PII + lista de clienți a downline-ului);
--   • affiliate_ledger → fiecare comision al sub-afiliatului (venitul lui exact).
-- Comentariul din mig 097 recunoaște chiar că aceste coloane sunt sensibile, dar
-- se baza pe „frontend-ul nu le citește" — ceea ce NU e o barieră de securitate
-- (RLS e bariera reală). Dashboard-ul (get_affiliate_dashboard) expune deja, prin
-- SECURITY DEFINER, exact cât trebuie pentru downline: doar `attributions_count`
-- agregat per sub-afiliat — NU rândurile brute.
--
-- FIX: SELECT restrâns la propriul afiliat (profile_id = auth.uid()).
--   • Dashboard-ul e DEFINER → ocolește RLS → numărătorile sub-afiliaților +
--     câștigurile proprii rămân neschimbate.
--   • Frontend-ul nu citește direct aceste tabele (doar prin RPC) → zero impact UI.
--   • Webhook/cron rulează ca service_role (BYPASSRLS) → neafectate.
--
-- `affiliates` rămâne pe `affiliate_visible_ids()`: enumerarea sub-afiliaților
-- direcți (referral_code/status/bps — fără PII/IBAN/clienți) ESTE feature-ul
-- „panoul cu sub-afiliații tăi" și nu expune date sensibile.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── affiliate_attributions: own-only ─────────────────────────────────────────
drop policy if exists "affiliate: read own attributions" on public.affiliate_attributions;
create policy "affiliate: read own attributions" on public.affiliate_attributions
  for select to authenticated
  using (affiliate_id in (
    select a.id from public.affiliates a where a.profile_id = auth.uid()
  ));

-- ── affiliate_ledger: own-only ───────────────────────────────────────────────
drop policy if exists "affiliate: read own ledger" on public.affiliate_ledger;
create policy "affiliate: read own ledger" on public.affiliate_ledger
  for select to authenticated
  using (affiliate_id in (
    select a.id from public.affiliates a where a.profile_id = auth.uid()
  ));

-- ── Asserție: policy-urile nu mai depind de affiliate_visible_ids() ───────────
do $$
declare v_qual text;
begin
  select qual into v_qual from pg_policies
   where schemaname='public' and tablename='affiliate_attributions'
     and policyname='affiliate: read own attributions';
  if v_qual is null then raise exception 'mig 104: policy attributions lipsește'; end if;
  if position('affiliate_visible_ids' in v_qual) > 0 then
    raise exception 'mig 104: attributions încă folosește affiliate_visible_ids (leak)';
  end if;

  select qual into v_qual from pg_policies
   where schemaname='public' and tablename='affiliate_ledger'
     and policyname='affiliate: read own ledger';
  if v_qual is null then raise exception 'mig 104: policy ledger lipsește'; end if;
  if position('affiliate_visible_ids' in v_qual) > 0 then
    raise exception 'mig 104: ledger încă folosește affiliate_visible_ids (leak)';
  end if;
  raise notice 'mig 104: attributions + ledger RLS own-only OK';
end $$;

commit;
