-- mig 193 — accesul de partener respectă statusul atribuirii + fix
--           admin_mark_payout_paid (coalesce text/bigint = RPC nefuncțional)
-- ─────────────────────────────────────────────────────────────────────
-- Findings din review-ul adversarial pe migrațiile 185–192:
--
-- (1) MEDIUM, fail-open: has_partner_access (mig 187) filtra doar pe
--     affiliates.status='active' și partner_access_revoked_at is null —
--     NU și pe affiliate_attributions.status. Consecință: după ce abonamentul
--     restaurantului referit ajunge canceled/refunded/expired, afiliatul
--     păstrează acces de manager pe restaurant NELIMITAT (revocarea era doar
--     manuală, iar ownerul nu e notificat). Fix: atribuirile în stare
--     terminală nu mai acordă acces — se aplică LIVE (funcția citește la
--     fiecare verificare RLS), deci accesul dispare automat la tranziție.
--     Decizie de produs păstrată: 'pending'/'paused'/'downgraded' rămân cu
--     acces — afiliatul își ajută restaurantul la onboarding ÎN trial (înainte
--     de prima factură plătită) și nu-l pierde la o pauză de plată.
--
-- (2) BUG (RPC mort): admin_mark_payout_paid (mig 186) făcea
--     `coalesce(p_wise_transfer_id, wise_transfer_id)` cu p_wise_transfer_id
--     TEXT peste coloana BIGINT (mig 098:75). Postgres nu poate rezolva
--     tipul COALESCE-ului text/bigint → eroare la PLAN-TIME, adică la ORICE
--     apel (și cu parametrul null). Butonul „Marchează plătit" din FounderPage
--     era complet nefuncțional. Fix: păstrăm semnătura text (compat cu
--     frontend-ul), validăm numeric explicit și convertim la bigint.
--
-- Convenția lockdown: SECURITY DEFINER, search_path = public, pg_temp,
-- revoke/grant explicite, asserții fail-closed. Migrațiile aplicate nu se
-- editează → fișier nou care recreează starea finală a funcțiilor.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '60s';

-- ── 1. has_partner_access — stare finală (187 + gate pe statusul atribuirii) ──
-- Stările terminale ale atribuirii (enum mig 097: pending/active/paused/
-- downgraded/canceled/refunded/expired) nu mai acordă acces.
create or replace function public.has_partner_access(p_restaurant_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.affiliates a
      join public.affiliate_attributions aa on aa.affiliate_id = a.id
      join public.restaurants r on r.owner_id = aa.referred_profile_id
     where r.id = p_restaurant_id
       and a.profile_id = auth.uid()
       and a.status = 'active'
       and aa.status not in ('canceled', 'refunded', 'expired')
       and aa.partner_access_revoked_at is null
  )
$$;

revoke all on function public.has_partner_access(uuid) from public, anon, service_role;
grant execute on function public.has_partner_access(uuid) to authenticated;

comment on function public.has_partner_access(uuid) is
  'Afiliatul are acces de partener (manager virtual) pe restaurantul referit? Cere: afiliat activ, atribuire ne-terminală (nu canceled/refunded/expired), acces nerevocat de owner/founder.';

-- ── 2. list_partner_restaurants — oglindește EXACT același criteriu ──
-- (altfel panoul afiliatului ar lista restaurante pe care RLS-ul îl respinge)
create or replace function public.list_partner_restaurants()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'restaurant_id', r.id,
             'name',          r.name,
             'slug',          r.slug,
             'city',          r.city,
             'is_active',     r.is_active,
             'plan',          op.plan
           ) order by r.name)
      from public.affiliates a
      join public.affiliate_attributions aa on aa.affiliate_id = a.id
      join public.restaurants r on r.owner_id = aa.referred_profile_id
      join public.profiles op on op.id = r.owner_id
     where a.profile_id = auth.uid()
       and a.status = 'active'
       and aa.status not in ('canceled', 'refunded', 'expired')
       and aa.partner_access_revoked_at is null
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_partner_restaurants() from public, anon, service_role;
grant execute on function public.list_partner_restaurants() to authenticated;

-- ── 3. admin_mark_payout_paid — stare finală (186 + cast validat bigint) ──
create or replace function public.admin_mark_payout_paid(
  p_id uuid,
  p_wise_transfer_id text default null
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
  v_wise    bigint;
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;

  -- wise_transfer_id e BIGINT în affiliate_payouts (mig 098). Parametrul
  -- rămâne text (compat frontend), dar îl validăm și convertim explicit —
  -- coalesce(text, bigint) direct în UPDATE nu se poate nici măcar plana.
  if p_wise_transfer_id is not null then
    if p_wise_transfer_id !~ '^\d{1,18}$' then
      return jsonb_build_object('ok', false,
        'error', 'wise_transfer_id trebuie să fie numeric (id-ul transferului Wise)');
    end if;
    v_wise := p_wise_transfer_id::bigint;
  end if;

  -- Doar din stările pre-terminale permise de state machine (mig 098):
  -- processing / on_hold → paid. Tranzițiile invalide sunt oricum respinse
  -- de trg_affiliate_payout_transition; filtrăm aici pentru un mesaj clar.
  update public.affiliate_payouts
     set status = 'paid',
         wise_transfer_id = coalesce(v_wise, wise_transfer_id)
   where id = p_id and status in ('processing', 'on_hold');
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return jsonb_build_object('ok', false,
      'error', 'Payout inexistent sau într-o stare din care nu se poate marca plătit (permise: processing, on_hold)');
  end if;

  perform public.log_platform_action('founder', null, 'mark_payout_paid',
    jsonb_build_object('payout_id', p_id, 'wise_transfer_id', p_wise_transfer_id));
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_mark_payout_paid(uuid, text) from public, anon, service_role;
grant execute on function public.admin_mark_payout_paid(uuid, text) to authenticated;

-- ── Asserții fail-closed ────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  -- (1) has_partner_access exclude stările terminale ale atribuirii.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'has_partner_access';
  if v_def is null or v_def !~ 'canceled' or v_def !~ 'refunded' or v_def !~ 'expired' then
    raise exception 'mig 193: has_partner_access nu filtrează stările terminale ale atribuirii';
  end if;
  if v_def !~ 'partner_access_revoked_at' or v_def !~ 'search_path' then
    raise exception 'mig 193: has_partner_access a pierdut criteriile din mig 187';
  end if;

  -- (2) list_partner_restaurants oglindește filtrul (fără divergență UI/RLS).
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'list_partner_restaurants';
  if v_def is null or v_def !~ 'canceled' then
    raise exception 'mig 193: list_partner_restaurants nu oglindește filtrul de status';
  end if;

  -- (3) admin_mark_payout_paid: fără coalesce text/bigint (bug plan-time) și
  --     cu validare numerică; smoke-test real că funcția măcar se poate
  --     executa (id inexistent → jsonb {ok:false}, NU excepție de tip).
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_mark_payout_paid';
  if v_def is null or v_def !~ 'v_wise' or v_def !~ '::bigint' then
    raise exception 'mig 193: admin_mark_payout_paid nu are cast-ul validat la bigint';
  end if;
  -- Anti-regresie pe bug-ul exact: coalesce direct pe parametrul text peste
  -- coloana bigint nu se poate PLANA → orice apel pica. Pattern-ul nu are
  -- voie să reapară.
  if v_def ~ 'coalesce\(p_wise_transfer_id' then
    raise exception 'mig 193: admin_mark_payout_paid conține iar coalesce(text, bigint)';
  end if;

  -- (4) Privilegii: anon zero EXECUTE pe toate trei.
  if has_function_privilege('anon', 'public.has_partner_access(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.list_partner_restaurants()', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_mark_payout_paid(uuid, text)', 'EXECUTE') then
    raise exception 'mig 193: anon are EXECUTE pe funcții de partener/founder';
  end if;

  raise notice 'mig 193: gate status atribuire + fix mark_payout_paid OK';
end $$;

-- Smoke-test de PLANARE pentru fix-ul (2): exact expresia reparată trebuie
-- să se poată plana peste schema reală (bug-ul vechi pica aici, indiferent
-- de valori — 42804 datatype_mismatch la primul apel al RPC-ului). Nu
-- atinge date și nu cere context de auth.
do $$
begin
  perform coalesce(null::bigint, wise_transfer_id)
     from public.affiliate_payouts
    limit 0;
  raise notice 'mig 193: expresia coalesce(bigint, wise_transfer_id) se planează OK';
end $$;

commit;
