-- mig 174 — Fix AFF: ultimele două sub-sume din dashboard încă amestecau EUR în RON
--
--   mig 110 a filtrat currency='RON' pe blocul 'earnings' (total/confirmed/
--   pending/paid/clawed_back), dar a lăsat DOUĂ sub-sume necurățate care rulează
--   tot pe affiliate_ledger și sunt prezentate implicit ca RON:
--     1. `commission_cents` per restaurant adus (agregat în lista 'restaurants',
--        L78-81 în mig 110) — însuma TOATE rândurile pozitive, inclusiv EUR
--        (mig 107 multicurrency), deci comisionul afișat lângă un restaurant
--        putea fi umflat cu bani în EUR adunați ca și cum ar fi RON.
--     2. `next_payout_at` (L142-146) — lua cel mai apropiat hold din ORICE
--        monedă; un hold EUR putea deveni „următoarea plată" deși batch-ul de
--        payout rulează în RON.
--
--   affiliate_ledger.currency există (mig 097, type public.affiliate_currency,
--   default 'RON'). Fix minim, non-distructiv: COPIE FIDELĂ a funcției din mig
--   110 cu O SINGURĂ schimbare — `and l.currency = 'RON'` pe commission_cents și
--   `and currency = 'RON'` pe next_payout_at. Restul rămâne IDENTIC cu mig 110
--   (semnătură, security definer, search_path, restaurants, sub_affiliates,
--   earnings, grants).
--
-- Convenție 096: SECURITY DEFINER, search_path strict, PUBLIC zero EXECUTE,
-- GRANT authenticated. Migrațiile aplicate nu se editează — fișier nou.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ═══════════════════════════════════════════════════════════════════════════
-- get_affiliate_dashboard — copie fidelă a mig 110 + filtru currency='RON' pe
-- commission_cents și next_payout_at (ultimele leak-uri cross-currency)
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
        -- Doar comisionul RON: eticheta e RON și batch-ul de payout e RON,
        -- deci un rând EUR (mig 107) NU trebuie adunat aici (fix cross-currency).
        'commission_cents', coalesce((
          select sum(l.amount_cents) from public.affiliate_ledger l
           where l.attribution_id = aa.id and l.amount_cents > 0
             and l.currency = 'RON'
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
    -- Doar holdurile RON: batch-ul de payout rulează în RON, deci un hold EUR
    -- (mig 107) nu trebuie prezentat ca „următoarea plată" RON (fix cross-currency).
    'next_payout_at', (
      select min(hold_until) from public.affiliate_ledger
       where affiliate_id = v_aff.id and amount_cents > 0
         and leg in ('setup','recurring','cascade') and hold_until > now()
         and currency = 'RON'
    )
  );

  return v_result;
end$$;

revoke all on function public.get_affiliate_dashboard() from public, anon;
grant execute on function public.get_affiliate_dashboard() to authenticated;

comment on function public.get_affiliate_dashboard() is
  'Fetch unic pentru panoul afiliat: profil, restaurante aduse (commission_cents filtrat RON), sub-afiliați, câștiguri, next_payout_at filtrat RON (fix cross-currency, extinde mig 110).';

-- ── Asserții inline ──────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='get_affiliate_dashboard' and p.prosecdef) then
    raise exception 'mig 174: get_affiliate_dashboard missing/not SECURITY DEFINER';
  end if;
  -- Sanity: sursa trebuie să conțină filtrul RON și pe commission_cents (alias l).
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='get_affiliate_dashboard'
       and pg_get_functiondef(p.oid) ilike '%l.currency = ''RON''%'
  ) then
    raise exception 'mig 174: commission_cents nu filtrează l.currency=RON (cross-currency leak)';
  end if;
  raise notice 'mig 174: dashboard commission_cents + next_payout_at filtered to RON OK';
end $$;

commit;
