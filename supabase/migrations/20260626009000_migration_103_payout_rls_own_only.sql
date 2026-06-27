-- mig 103 — Fix securitate/GDPR: datele de payout = strict own-only (P1)
--
-- PROBLEMA (găsită la review adversarial):
--   Policy-urile de SELECT pe affiliate_payout_profile și affiliate_payouts
--   (mig 098) foloseau `affiliate_visible_ids()`, helper care întoarce own +
--   sub-afiliații direcți (corect pentru agregatele din dashboard, dar GREȘIT
--   pentru date personale). Efect: un afiliat-părinte putea citi IBAN/CUI/nume
--   beneficiar ȘI sumele de plată ale sub-afiliaților prin ORICE client
--   PostgREST (UI-ul filtra pe own, dar RLS e bariera reală). Comentariul tabelei
--   spunea deja „RLS own" — policy-ul contrazicea designul. Date sensibile
--   (CUI/IBAN) → risc GDPR.
--
-- FIX: restrânge SELECT la propriul afiliat (profile_id = auth.uid()), fără a
--   atinge `affiliate_visible_ids()` (rămâne corect pentru affiliates/
--   attributions/ledger, unde părintele TREBUIE să vadă agregatele copiilor).
--   Cascada își are câștigurile în ledger-ul PROPRIU al părintelui, deci nu
--   pierde nimic vizibil restrângând aici.
--
-- RPC-urile SECURITY DEFINER (get_affiliate_dashboard, run_affiliate_payout_batch)
-- ocolesc RLS → neafectate.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── affiliate_payout_profile: own-only ───────────────────────────────────────
drop policy if exists "affiliate: read own payout profile" on public.affiliate_payout_profile;
create policy "affiliate: read own payout profile" on public.affiliate_payout_profile
  for select to authenticated
  using (affiliate_id in (
    select a.id from public.affiliates a where a.profile_id = auth.uid()
  ));

-- ── affiliate_payouts: own-only ──────────────────────────────────────────────
drop policy if exists "affiliate: read own payouts" on public.affiliate_payouts;
create policy "affiliate: read own payouts" on public.affiliate_payouts
  for select to authenticated
  using (affiliate_id in (
    select a.id from public.affiliates a where a.profile_id = auth.uid()
  ));

-- ── Asserție: policy-urile nu mai depind de affiliate_visible_ids() ───────────
do $$
declare v_qual text;
begin
  select qual into v_qual from pg_policies
   where schemaname='public' and tablename='affiliate_payout_profile'
     and policyname='affiliate: read own payout profile';
  if v_qual is null then raise exception 'mig 103: policy payout_profile lipsește'; end if;
  if position('affiliate_visible_ids' in v_qual) > 0 then
    raise exception 'mig 103: payout_profile încă folosește affiliate_visible_ids (leak)';
  end if;

  select qual into v_qual from pg_policies
   where schemaname='public' and tablename='affiliate_payouts'
     and policyname='affiliate: read own payouts';
  if v_qual is null then raise exception 'mig 103: policy payouts lipsește'; end if;
  if position('affiliate_visible_ids' in v_qual) > 0 then
    raise exception 'mig 103: payouts încă folosește affiliate_visible_ids (leak)';
  end if;
  raise notice 'mig 103: payout RLS own-only OK';
end $$;

commit;
