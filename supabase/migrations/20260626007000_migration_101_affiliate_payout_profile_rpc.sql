-- mig 101 — Program de afiliere: upsert date fiscale/bancare (Faza P2)
--
-- Afiliatul își introduce singur datele de payout (PFA/SRL, CUI, IBAN) din UI.
-- Scrierile pe affiliate_payout_profile sunt REVOKE pentru rolurile aplicației
-- (mig 098) → trec prin acest RPC SECURITY DEFINER, scopat la afiliatul curent.
-- Citirea se face direct prin RLS (policy „read own payout profile" din 098).

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

create or replace function public.upsert_payout_profile(
  p_legal_form       text,
  p_cui              text,
  p_iban             text,
  p_beneficiary_name text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_aff_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = 'insufficient_privilege',
      message = 'upsert_payout_profile requires authentication';
  end if;

  select id into v_aff_id from public.affiliates where profile_id = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_an_affiliate');
  end if;

  if p_legal_form is null or p_legal_form not in ('pfa', 'srl', 'other') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_legal_form');
  end if;
  -- IBAN-ul e obligatoriu ca să poată fi plătit; validare lejeră de format.
  if p_iban is null or length(btrim(p_iban)) < 15 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_iban');
  end if;

  insert into public.affiliate_payout_profile
    (affiliate_id, legal_form, cui, iban, beneficiary_name)
  values
    (v_aff_id, p_legal_form, nullif(btrim(p_cui), ''), btrim(p_iban), nullif(btrim(p_beneficiary_name), ''))
  on conflict (affiliate_id) do update set
    legal_form       = excluded.legal_form,
    cui              = excluded.cui,
    iban             = excluded.iban,
    beneficiary_name = excluded.beneficiary_name,
    updated_at       = now();

  return jsonb_build_object('ok', true);
end$$;

revoke all on function public.upsert_payout_profile(text, text, text, text) from public, anon;
grant execute on function public.upsert_payout_profile(text, text, text, text) to authenticated;

comment on function public.upsert_payout_profile(text, text, text, text) is
  'Afiliatul își setează datele fiscale/bancare (PFA/SRL, CUI, IBAN). Scopat la auth.uid().';

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='upsert_payout_profile' and p.prosecdef) then
    raise exception 'mig 101: upsert_payout_profile missing';
  end if;
  raise notice 'mig 101: payout profile RPC OK';
end $$;

commit;
