-- mig 100 — Program de afiliere: incrementality reală (Faza P1)
--
-- Auditul a găsit că gate-ul de incrementality din 097C era DUBLU defect:
--   (a) FAIL-OPEN: „fără touch → atribuit" — un afiliat sărea peste touch și
--       prindea conversii organice;
--   (b) cheia pe referred_profile_id, care e NULL la momentul touch-ului
--       (vizitatorul e nelogat la /r/:cod) → gate-ul nu se declanșa NICIODATĂ.
--
-- Fix FAIL-CLOSED: atribuim DOAR dacă există un touch server-recorded pentru
-- (afiliat, visitor_id) ȘI profilul nu e semnificativ mai vechi decât primul
-- touch. Lipsă touch / profil preexistent → skip (organic).
--
-- visitor_id = id anonim per-vizitator (cookie), corelează touch-ul (la /r/)
-- cu conversia (la checkout). touch.created_at e mereu now() server-side, deci
-- un profil vechi (organic) rămâne mai vechi decât orice touch nou → skip.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- Index pentru lookup-ul gate-ului (afiliat, cookie) + earliest.
create index if not exists idx_affiliate_touches_lookup
  on public.affiliate_touches (affiliate_id, cookie_value, created_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- record_affiliate_touch — apelat de /r/:cod (anon). Un touch per
--   (afiliat, visitor) = primul; dedup natural → rezistent la spam (storage).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.record_affiliate_touch(
  p_referral_code text,
  p_visitor_id    text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_aff_id uuid;
begin
  if p_referral_code is null or btrim(p_referral_code) = ''
     or p_visitor_id is null or btrim(p_visitor_id) = '' then
    return jsonb_build_object('ok', true, 'skipped', 'bad_input');
  end if;

  select id into v_aff_id
    from public.affiliates
   where referral_code = lower(btrim(p_referral_code)) and status = 'active';
  if not found then
    return jsonb_build_object('ok', true, 'skipped', 'unknown_code');
  end if;

  -- Un singur touch per (afiliat, visitor): păstrăm PRIMUL (earliest) — exact
  -- ce-i trebuie gate-ului. Dedup → fără pile-up la /r/ repetate, anti-spam.
  insert into public.affiliate_touches (affiliate_id, referred_profile_id, cookie_value)
  select v_aff_id, null, p_visitor_id
   where not exists (
     select 1 from public.affiliate_touches
      where affiliate_id = v_aff_id and cookie_value = p_visitor_id
   );

  return jsonb_build_object('ok', true);
end$$;

revoke all on function public.record_affiliate_touch(text, text) from public;
grant execute on function public.record_affiliate_touch(text, text) to anon, authenticated;

comment on function public.record_affiliate_touch(text, text) is
  'Înregistrează un touch (server-side) la /r/:cod. Un rând per (afiliat, visitor).';

-- ═══════════════════════════════════════════════════════════════════════════
-- capture_affiliate_attribution — semnătură nouă (+ p_visitor_id), gate FAIL-CLOSED
-- ═══════════════════════════════════════════════════════════════════════════
drop function if exists public.capture_affiliate_attribution(text, uuid, text);

create or replace function public.capture_affiliate_attribution(
  p_referral_code       text,
  p_referred_profile_id uuid,
  p_stripe_customer_id  text,
  p_visitor_id          text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_aff             record;
  v_profile_created timestamptz;
  v_first_touch     timestamptz;
  v_attr_id         uuid;
begin
  if p_referral_code is null or btrim(p_referral_code) = '' then
    return jsonb_build_object('ok', true, 'skipped', 'no_code');
  end if;
  if p_referred_profile_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_profile');
  end if;

  select * into v_aff
    from public.affiliates
   where referral_code = lower(btrim(p_referral_code)) and status = 'active';
  if not found then
    return jsonb_build_object('ok', true, 'skipped', 'unknown_or_inactive_code');
  end if;

  if v_aff.profile_id = p_referred_profile_id then
    return jsonb_build_object('ok', true, 'skipped', 'self_referral');
  end if;

  -- INCREMENTALITY FAIL-CLOSED: cheia pe visitor_id (cookie), nu pe profil
  -- (userul e nelogat la touch). Primul touch al acestui vizitator pe acest afiliat.
  select min(created_at) into v_first_touch
    from public.affiliate_touches
   where affiliate_id = v_aff.id and cookie_value = p_visitor_id;

  -- Fără touch server-recorded → tratăm ca organic (nu plătim).
  if v_first_touch is null then
    return jsonb_build_object('ok', true, 'skipped', 'no_touch_organic');
  end if;

  -- Profil semnificativ mai vechi decât primul touch → organic preexistent.
  -- Marjă de 5 min pentru click→signup în aceeași sesiune / clock skew.
  select created_at into v_profile_created
    from public.profiles where id = p_referred_profile_id;
  if v_profile_created is not null and v_profile_created < v_first_touch - interval '5 minutes' then
    return jsonb_build_object('ok', true, 'skipped', 'organic_preexisting');
  end if;

  -- First-wins: un profil deja atribuit rămâne la primul afiliat.
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

revoke all on function public.capture_affiliate_attribution(text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.capture_affiliate_attribution(text, uuid, text, text)
  to service_role;

comment on function public.capture_affiliate_attribution(text, uuid, text, text) is
  'Atribuire la checkout. Gate FAIL-CLOSED: necesită touch server-recorded (incrementality).';

-- ── Asserții inline ──────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='record_affiliate_touch' and p.prosecdef) then
    raise exception 'mig 100: record_affiliate_touch missing';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='capture_affiliate_attribution' and p.pronargs=4) then
    raise exception 'mig 100: capture_affiliate_attribution trebuie să aibă 4 args (+ p_visitor_id)';
  end if;
  raise notice 'mig 100: affiliate incrementality OK';
end $$;

commit;
