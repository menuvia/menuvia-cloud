-- mig 110 — Fix AFF-E2E-2: dashboard însuma cross-currency dar eticheta 'RON'
--
--   get_affiliate_dashboard expune blocul 'earnings' cu currency hardcodat 'RON'
--   (MVP) și payout-ul rulează în RON. Dar sub-sumele din affiliate_ledger NU
--   filtrau pe currency, deci o atribuire în EUR (mig 107 multicurrency) era
--   adunată în aceiași bani și prezentată ca RON — total fals.
--
--   Fix minim, non-distructiv: o COPIE FIDELĂ a funcției din mig 097D cu O
--   SINGURĂ schimbare — `and currency = 'RON'` la cele 4 sub-sume din
--   affiliate_ledger (total/pending/paid/clawed_back) ȘI la confirmed_cents
--   (v_affiliate_payable expune coloana currency — mig 099). Eticheta și
--   batch-ul de payout sunt deja RON, deci sumele devin consecvente.
--
--   Tot restul funcției (security definer, search_path, restaurants,
--   sub_affiliates, next_payout_at) rămâne IDENTIC.
--
-- Convenție 096: SECURITY DEFINER, search_path strict, PUBLIC zero EXECUTE,
-- GRANT authenticated. Migrațiile aplicate nu se editează — fișier nou.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ═══════════════════════════════════════════════════════════════════════════
-- get_affiliate_dashboard — copie fidelă a mig 097D + filtru currency='RON'
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
    -- affiliate_id = self). Toate în RON (MVP) — vezi filtrul currency='RON'
    -- de mai jos: eticheta și batch-ul de payout sunt RON, deci sumele NU
    -- trebuie să amestece EUR (fix AFF-E2E-2).
    'earnings', jsonb_build_object(
      'currency', 'RON',
      -- total brut câștigat (pozitive setup/recurring/cascade)
      'total_cents', coalesce((
        select sum(amount_cents) from public.affiliate_ledger
         where affiliate_id = v_aff.id and amount_cents > 0
           and leg in ('setup','recurring','cascade')
           and currency = 'RON'
      ), 0),
      -- confirmat (payable acum): trecut de hold, ne-stornat
      'confirmed_cents', coalesce((
        select sum(amount_cents) from public.v_affiliate_payable
         where affiliate_id = v_aff.id
           and currency = 'RON'
      ), 0),
      -- în așteptare (hold încă activ)
      'pending_cents', coalesce((
        select sum(amount_cents) from public.affiliate_ledger
         where affiliate_id = v_aff.id and amount_cents > 0
           and leg in ('setup','recurring','cascade') and hold_until > now()
           and currency = 'RON'
      ), 0),
      -- plătit (rânduri de payout, negative)
      'paid_cents', coalesce((
        select -sum(amount_cents) from public.affiliate_ledger
         where affiliate_id = v_aff.id and leg = 'payout'
           and currency = 'RON'
      ), 0),
      -- stornat (clawback)
      'clawed_back_cents', coalesce((
        select -sum(amount_cents) from public.affiliate_ledger
         where affiliate_id = v_aff.id and leg = 'clawback'
           and currency = 'RON'
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
  'Fetch unic pentru panoul afiliat: profil, restaurante aduse, sub-afiliați, câștiguri (earnings filtrat currency=RON, fix AFF-E2E-2).';

-- ── Asserții inline ──────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='get_affiliate_dashboard' and p.prosecdef) then
    raise exception 'mig 110: get_affiliate_dashboard missing/not SECURITY DEFINER';
  end if;
  -- Sanity: sursa funcției trebuie să conțină filtrul de currency adăugat.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='get_affiliate_dashboard'
       and pg_get_functiondef(p.oid) ilike '%currency = ''RON''%'
  ) then
    raise exception 'mig 110: get_affiliate_dashboard nu conține filtrul currency=RON (AFF-E2E-2)';
  end if;
  raise notice 'mig 110: dashboard earnings filtered to RON OK';
end $$;

commit;
