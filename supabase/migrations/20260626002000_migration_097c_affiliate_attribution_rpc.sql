-- mig 097C — Program de afiliere: RPC de atribuire (Faza 2, partea backend)
--
-- Două RPC-uri care leagă fluxul de checkout de programul de afiliere:
--   • capture_affiliate_attribution — apelat de stripe-checkout.js (service_role)
--     când userul pornește checkout cu un cookie de referral. Creează o
--     atribuire `pending` (profile-bound) legată de stripe_customer_id.
--   • preview_referral — apelat de pagina publică /r/:cod (anon) ca să valideze
--     codul fără a expune date sensibile.
--
-- Gate-uri aplicate la capture (anti-fraud economic, MVP):
--   • afiliat inexistent/inactiv → skip
--   • self-referral (afiliat == profilul referit) → skip (triggerul îl și blochează)
--   • incrementality: dacă profilul a fost creat ÎNAINTE de primul touch al
--     acestui afiliat → user organic preexistent, skip (best-effort: doar dacă
--     există touch înregistrat)
--   • first-wins: un profil deja atribuit nu se re-atribuie (ON CONFLICT DO NOTHING)
--
-- Convenție 096: SECURITY DEFINER, search_path strict, jsonb, PUBLIC zero EXECUTE.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ═══════════════════════════════════════════════════════════════════════════
-- capture_affiliate_attribution — creează atribuirea la checkout
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.capture_affiliate_attribution(
  p_referral_code     text,
  p_referred_profile_id uuid,
  p_stripe_customer_id  text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_aff         record;
  v_profile_created timestamptz;
  v_first_touch timestamptz;
  v_attr_id     uuid;
begin
  if p_referral_code is null or btrim(p_referral_code) = '' then
    return jsonb_build_object('ok', true, 'skipped', 'no_code');
  end if;
  if p_referred_profile_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_profile');
  end if;

  -- Afiliat valid + activ (codul e normalizat lowercase la onboarding).
  select * into v_aff
    from public.affiliates
   where referral_code = lower(btrim(p_referral_code))
     and status = 'active';
  if not found then
    return jsonb_build_object('ok', true, 'skipped', 'unknown_or_inactive_code');
  end if;

  -- Self-referral determinist (triggerul îl blochează oricum, dar răspundem curat).
  if v_aff.profile_id = p_referred_profile_id then
    return jsonb_build_object('ok', true, 'skipped', 'self_referral');
  end if;

  -- Incrementality (best-effort): dacă există un touch al acestui afiliat pe acest
  -- profil ȘI profilul e mai vechi decât primul touch → organic preexistent.
  select created_at into v_profile_created
    from public.profiles where id = p_referred_profile_id;
  select min(created_at) into v_first_touch
    from public.affiliate_touches
   where affiliate_id = v_aff.id and referred_profile_id = p_referred_profile_id;
  if v_first_touch is not null and v_profile_created is not null
     and v_profile_created < v_first_touch then
    return jsonb_build_object('ok', true, 'skipped', 'organic_preexisting');
  end if;

  -- First-wins: un profil deja atribuit (oricui) rămâne la primul afiliat.
  insert into public.affiliate_attributions
    (affiliate_id, referred_profile_id, stripe_customer_id, status, source)
  values
    (v_aff.id, p_referred_profile_id, p_stripe_customer_id, 'pending', 'checkout_referral')
  on conflict (referred_profile_id) do nothing
  returning id into v_attr_id;

  if v_attr_id is null then
    return jsonb_build_object('ok', true, 'skipped', 'already_attributed');
  end if;

  return jsonb_build_object('ok', true, 'attribution_id', v_attr_id, 'affiliate_id', v_aff.id);
end$$;

revoke all on function public.capture_affiliate_attribution(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.capture_affiliate_attribution(text, uuid, text)
  to service_role;

comment on function public.capture_affiliate_attribution(text, uuid, text) is
  'Creează atribuire pending la checkout. Gate: self-referral, incrementality, first-wins.';

-- ═══════════════════════════════════════════════════════════════════════════
-- preview_referral — validare publică a codului pentru pagina /r/:cod
--   Returnează DOAR existența + validitatea, fără date personale.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.preview_referral(
  p_referral_code text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_exists boolean;
begin
  if p_referral_code is null or btrim(p_referral_code) = '' then
    return jsonb_build_object('valid', false);
  end if;
  select exists(
    select 1 from public.affiliates
     where referral_code = lower(btrim(p_referral_code)) and status = 'active'
  ) into v_exists;
  return jsonb_build_object('valid', v_exists, 'referral_code', lower(btrim(p_referral_code)));
end$$;

revoke all on function public.preview_referral(text) from public;
grant execute on function public.preview_referral(text) to anon, authenticated;

comment on function public.preview_referral(text) is
  'Validare publică a unui cod de referral pentru landing /r/. Zero date personale.';

-- ── Asserții inline ──────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='capture_affiliate_attribution' and p.prosecdef) then
    raise exception 'mig 097C: capture_affiliate_attribution missing/not SECURITY DEFINER';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='preview_referral' and p.prosecdef) then
    raise exception 'mig 097C: preview_referral missing/not SECURITY DEFINER';
  end if;
  raise notice 'mig 097C: attribution RPCs OK';
end $$;

commit;
