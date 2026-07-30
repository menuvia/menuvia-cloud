-- Migration 249 — affiliates SELECT own-row-only (fix scurgere PII downline)
--
-- Context: mig 224 a adăugat pe public.affiliates coloanele `phone` (obligatoriu la
-- înscriere) și `application_note` (text liber) — ambele PII. Politica SELECT
-- „affiliate: read own" (mig 097) folosea `affiliate_visible_ids()` = rândul propriu
-- + sub-afiliații direcți (downline). Asta a fost sigur DOAR cât timp tabela nu avea
-- PII (garanția explicită a mig 104: „affiliates rămâne pe downline fiindcă are doar
-- referral_code/status/bps — fără PII"). Mig 224 a invalidat garanția: un afiliat
-- care a recrutat sub-afiliați putea rula prin PostgREST brut
-- `select profile_id, phone, application_note from affiliates` și recolta telefoanele
-- + notele întregului downline — scurgere de date de contact între conturi (GDPR).
--
-- Frontend-ul NU citește raw din `affiliates` (comentariul mig 097: „citește prin
-- RPC/view dedicat"; grep confirmă zero `from('affiliates')`). Arborele de
-- sub-afiliați vine din `get_affiliate_dashboard` (SECURITY DEFINER → ocolește RLS),
-- iar founderul prin `admin_list_affiliates` (DEFINER, founder-gated). Deci putem
-- îngusta politica la OWN-ROW fără să stricăm nimic — finalizând exact ce au făcut
-- mig 103/104/190 pe tabelele-soră (payouts/attributions/ledger).

begin;

drop policy if exists "affiliate: read own" on public.affiliates;
create policy "affiliate: read own" on public.affiliates
  for select to authenticated
  using (profile_id = auth.uid());

-- ── Asserții fail-closed ─────────────────────────────────────────────────────
do $$
declare
  v_qual text;
begin
  select qual into v_qual
    from pg_policies
   where schemaname = 'public'
     and tablename = 'affiliates'
     and policyname = 'affiliate: read own';

  if v_qual is null then
    raise exception 'mig 249: politica „affiliate: read own" lipsește de pe affiliates';
  end if;
  -- Nu mai depinde de downline → nicio scurgere de PII către afiliatul-părinte.
  if position('affiliate_visible_ids' in v_qual) > 0 then
    raise exception 'mig 249: affiliates încă folosește affiliate_visible_ids (scurgere PII downline)';
  end if;
  -- E strict own-row.
  if position('profile_id' in v_qual) = 0 then
    raise exception 'mig 249: politica affiliates nu e own-row (profile_id lipsește)';
  end if;
end $$;

commit;
