-- mig 097D — Program de afiliere: onboarding + dashboard (Faza 3, backend)
--
--   • register_affiliate — userul autentificat devine afiliat și primește un
--     referral_code unic. Opțional cu parent (sub-afiliere, 1 nivel).
--   • get_affiliate_dashboard — un singur fetch pentru panoul UI: profilul de
--     afiliat, restaurantele aduse (nume+oraș, fără PII), sub-afiliații direcți,
--     câștigurile (pending/confirmed/paid/total) și data următoarei plăți.
--
-- De ce RPC și nu citire directă: view-urile de sold sunt agregate, iar
-- affiliate_touches n-are policy de SELECT (date de fraudă). RPC-ul SECURITY
-- DEFINER scopează totul la auth.uid() și expune doar ce trebuie.
--
-- Convenție 096: SECURITY DEFINER, search_path strict, jsonb, PUBLIC zero
-- EXECUTE, GRANT authenticated (apelate din UI cu JWT).

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ═══════════════════════════════════════════════════════════════════════════
-- register_affiliate — onboarding afiliat
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.register_affiliate(
  p_parent_referral_code text default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_existing public.affiliates;
  v_parent  public.affiliates;
  v_code    text;
  v_aff_id  uuid;
  v_try     int := 0;
begin
  if v_uid is null then
    raise exception using errcode = 'insufficient_privilege',
      message = 'register_affiliate requires authentication';
  end if;

  -- Idempotent: dacă userul e deja afiliat, întoarce-i datele.
  select * into v_existing from public.affiliates where profile_id = v_uid;
  if found then
    return jsonb_build_object('ok', true, 'already', true,
      'affiliate_id', v_existing.id, 'referral_code', v_existing.referral_code);
  end if;

  -- Parent opțional (sub-afiliere). Trebuie să existe, să fie activ și ≠ self.
  if p_parent_referral_code is not null and btrim(p_parent_referral_code) <> '' then
    select * into v_parent from public.affiliates
     where referral_code = lower(btrim(p_parent_referral_code)) and status = 'active';
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'parent_not_found');
    end if;
    if v_parent.profile_id = v_uid then
      return jsonb_build_object('ok', false, 'reason', 'parent_is_self');
    end if;
  end if;

  -- Generează un referral_code unic (8 hex = ^[a-z0-9]{6,32}$). Retry pe coliziune.
  loop
    v_try := v_try + 1;
    v_code := substr(md5(gen_random_uuid()::text), 1, 8);
    exit when not exists (select 1 from public.affiliates where referral_code = v_code);
    if v_try > 10 then
      raise exception 'register_affiliate: could not generate unique referral_code';
    end if;
  end loop;

  insert into public.affiliates (profile_id, referral_code, parent_affiliate_id)
  values (v_uid, v_code, v_parent.id)
  returning id into v_aff_id;

  return jsonb_build_object('ok', true, 'affiliate_id', v_aff_id, 'referral_code', v_code,
    'parent_affiliate_id', v_parent.id);
end$$;

revoke all on function public.register_affiliate(text) from public, anon;
grant execute on function public.register_affiliate(text) to authenticated;

comment on function public.register_affiliate(text) is
  'Userul devine afiliat (referral_code unic). Opțional cu parent (1 nivel). Idempotent.';

-- ═══════════════════════════════════════════════════════════════════════════
-- get_affiliate_dashboard — fetch unic pentru panoul UI
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.get_affiliate_dashboard()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_aff     public.affiliates;
  v_result  jsonb;
begin
  if v_uid is null then
    raise exception using errcode = 'insufficient_privilege',
      message = 'get_affiliate_dashboard requires authentication';
  end if;

  select * into v_aff from public.affiliates where profile_id = v_uid;
  if not found then
    return jsonb_build_object('ok', true, 'is_affiliate', false);
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'is_affiliate', true,
    'affiliate', jsonb_build_object(
      'id', v_aff.id,
      'referral_code', v_aff.referral_code,
      'vanity_slug', v_aff.vanity_slug,
      'status', v_aff.status,
      'setup_bps', v_aff.setup_bps,
      'recurring_bps', v_aff.recurring_bps,
      'cascade_bps', v_aff.cascade_bps,
      'recurring_cap_months', v_aff.recurring_cap_months,
      'created_at', v_aff.created_at
    ),

    -- Restaurantele aduse: nume + oraș (din restaurants pe owner_id = profil
    -- referit), status atribuire, comision cumulat. Fără date PII ale owner-ului.
    'restaurants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'attribution_id', aa.id,
        'status', aa.status,
        'captured_at', aa.captured_at,
        'restaurant_names', coalesce((
          select jsonb_agg(r.name order by r.name)
            from public.restaurants r where r.owner_id = aa.referred_profile_id
        ), '[]'::jsonb),
        'city', (
          select r.city from public.restaurants r
           where r.owner_id = aa.referred_profile_id order by r.name limit 1
        ),
        'commission_cents', coalesce((
          select sum(l.amount_cents) from public.affiliate_ledger l
           where l.attribution_id = aa.id and l.amount_cents > 0
        ), 0)
      ) order by aa.captured_at desc)
        from public.affiliate_attributions aa
       where aa.affiliate_id = v_aff.id
    ), '[]'::jsonb),

    -- Sub-afiliații direcți: cod, status, câte conturi au adus, cota mea cascade.
    'sub_affiliates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'referral_code', sa.referral_code,
        'status', sa.status,
        'joined_at', sa.created_at,
        'attributions_count', (
          select count(*) from public.affiliate_attributions x where x.affiliate_id = sa.id
        )
      ) order by sa.created_at desc)
        from public.affiliates sa
       where sa.parent_affiliate_id = v_aff.id
    ), '[]'::jsonb),

    -- Câștiguri (doar ledger-ul propriu; cota de cascade e deja un rând pe
    -- affiliate_id = self). Toate în RON (MVP).
    'earnings', jsonb_build_object(
      'currency', 'RON',
      -- total brut câștigat (pozitive setup/recurring/cascade)
      'total_cents', coalesce((
        select sum(amount_cents) from public.affiliate_ledger
         where affiliate_id = v_aff.id and amount_cents > 0
           and leg in ('setup','recurring','cascade')
      ), 0),
      -- confirmat (payable acum): trecut de hold, ne-stornat
      'confirmed_cents', coalesce((
        select sum(amount_cents) from public.v_affiliate_payable
         where affiliate_id = v_aff.id
      ), 0),
      -- în așteptare (hold încă activ)
      'pending_cents', coalesce((
        select sum(amount_cents) from public.affiliate_ledger
         where affiliate_id = v_aff.id and amount_cents > 0
           and leg in ('setup','recurring','cascade') and hold_until > now()
      ), 0),
      -- plătit (rânduri de payout, negative)
      'paid_cents', coalesce((
        select -sum(amount_cents) from public.affiliate_ledger
         where affiliate_id = v_aff.id and leg = 'payout'
      ), 0),
      -- stornat (clawback)
      'clawed_back_cents', coalesce((
        select -sum(amount_cents) from public.affiliate_ledger
         where affiliate_id = v_aff.id and leg = 'clawback'
      ), 0)
    ),

    -- Următoarea plată estimată: cel mai apropiat hold care expiră.
    'next_payout_at', (
      select min(hold_until) from public.affiliate_ledger
       where affiliate_id = v_aff.id and amount_cents > 0
         and leg in ('setup','recurring','cascade') and hold_until > now()
    )
  );

  return v_result;
end$$;

revoke all on function public.get_affiliate_dashboard() from public, anon;
grant execute on function public.get_affiliate_dashboard() to authenticated;

comment on function public.get_affiliate_dashboard() is
  'Fetch unic pentru panoul afiliat: profil, restaurante aduse, sub-afiliați, câștiguri.';

-- ── Asserții inline ──────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='register_affiliate' and p.prosecdef) then
    raise exception 'mig 097D: register_affiliate missing/not SECURITY DEFINER';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='get_affiliate_dashboard' and p.prosecdef) then
    raise exception 'mig 097D: get_affiliate_dashboard missing/not SECURITY DEFINER';
  end if;
  raise notice 'mig 097D: dashboard RPCs OK';
end $$;

commit;
