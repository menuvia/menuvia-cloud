-- mig 188 — Comisioane afiliat controlate de fondator: platform_settings +
--           default global editabil + override per afiliat + „aplică la toți"
-- ─────────────────────────────────────────────────────────────────────
-- Cerință fondator: comisionul e un default setat de EL la nivel de platformă,
-- modificabil PER AFILIAT (mai mare/mic, orice), plus aplicare în masă.
--
-- Fapte pe care se sprijină designul:
--   • bps-urile (mig 097: setup 3000 / recurring 1000 / cascade 200 / cap 12)
--     sunt citite LIVE din rândul afiliatului de RPC-ul de comision (mig 099)
--     la fiecare invoice.paid → modificarea are efect imediat, fără migrare
--     de date.
--   • UPDATE direct pe affiliates e revocat (mig 097 Sec 8) → scrierea trece
--     exclusiv prin RPC SECURITY DEFINER cu gate is_platform_admin().
--   • Defaulturile globale primesc o sursă editabilă: platform_settings
--     (tabelă generică key/value — reutilizabilă pentru orice config viitor).
--
-- Convenția lockdown (CLAUDE.md): SECURITY DEFINER, search_path = public,
-- pg_temp, PUBLIC/anon/service_role zero EXECUTE, grant authenticated (gate-ul
-- real e în corp), audit prin log_platform_action (mig 186), idempotent,
-- asserții fail-closed. Migrațiile aplicate nu se editează → fișier nou;
-- register_affiliate / admin_list_affiliates / get_affiliate_dashboard sunt
-- RECREATE cu semnături identice (copie fidelă + delta minim, ca mig 174).
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ═══════════════════════════════════════════════════════════════════
-- Sec 1. platform_settings — config global de platformă (key/value)
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.platform_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.platform_settings enable row level security;

revoke insert, update, delete on table public.platform_settings
  from public, anon, authenticated, service_role;

-- Fondatorul poate CITI direct (debug); scrierile trec EXCLUSIV prin RPC.
drop policy if exists platform_settings_founder_read on public.platform_settings;
create policy platform_settings_founder_read
  on public.platform_settings for select
  using (public.is_platform_admin());
grant select on public.platform_settings to authenticated;

-- Seed idempotent — NU suprascrie valorile setate de fondator la re-run.
insert into public.platform_settings (key, value)
values ('affiliate_commission_defaults',
        '{"setup_bps":3000,"recurring_bps":1000,"cascade_bps":200,"recurring_cap_months":12}'::jsonb)
on conflict (key) do nothing;

-- ═══════════════════════════════════════════════════════════════════
-- Sec 2. RPC-uri founder pe comisioane
-- ═══════════════════════════════════════════════════════════════════

-- 2a. Citește defaulturile globale (fallback pe valorile istorice din 097).
create or replace function public.admin_get_affiliate_defaults()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.platform_settings;
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;

  select * into v_row from public.platform_settings
   where key = 'affiliate_commission_defaults';

  return jsonb_build_object(
    'ok', true,
    'setup_bps',            coalesce((v_row.value->>'setup_bps')::int, 3000),
    'recurring_bps',        coalesce((v_row.value->>'recurring_bps')::int, 1000),
    'cascade_bps',          coalesce((v_row.value->>'cascade_bps')::int, 200),
    'recurring_cap_months', coalesce((v_row.value->>'recurring_cap_months')::int, 12),
    'updated_at',           v_row.updated_at
  );
end;
$$;

-- 2b. Setează defaulturile globale (upsert + audit old/new).
create or replace function public.admin_set_affiliate_defaults(
  p_setup_bps     int,
  p_recurring_bps int,
  p_cascade_bps   int,
  p_cap_months    int
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;

  if p_setup_bps is null or p_setup_bps not between 0 and 10000
     or p_recurring_bps is null or p_recurring_bps not between 0 and 10000
     or p_cascade_bps is null or p_cascade_bps not between 0 and 10000 then
    return jsonb_build_object('ok', false, 'error', 'Procentele trebuie să fie între 0% și 100%');
  end if;
  if p_cap_months is null or p_cap_months not between 0 and 120 then
    return jsonb_build_object('ok', false, 'error', 'Plafonul de luni trebuie să fie între 0 și 120');
  end if;

  select value into v_old from public.platform_settings
   where key = 'affiliate_commission_defaults';

  v_new := jsonb_build_object(
    'setup_bps', p_setup_bps,
    'recurring_bps', p_recurring_bps,
    'cascade_bps', p_cascade_bps,
    'recurring_cap_months', p_cap_months
  );

  insert into public.platform_settings (key, value, updated_at)
  values ('affiliate_commission_defaults', v_new, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

  perform public.log_platform_action('founder', null, 'set_affiliate_defaults',
    jsonb_build_object('old', v_old, 'new', v_new));

  return jsonb_build_object('ok', true);
end;
$$;

-- 2c. Modifică comisionul UNUI afiliat (efect imediat — mig 099 citește live).
create or replace function public.admin_set_affiliate_commission(
  p_affiliate_id  uuid,
  p_setup_bps     int,
  p_recurring_bps int,
  p_cascade_bps   int,
  p_cap_months    int
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.affiliates;
  v_updated integer;
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;

  if p_setup_bps is null or p_setup_bps not between 0 and 10000
     or p_recurring_bps is null or p_recurring_bps not between 0 and 10000
     or p_cascade_bps is null or p_cascade_bps not between 0 and 10000 then
    return jsonb_build_object('ok', false, 'error', 'Procentele trebuie să fie între 0% și 100%');
  end if;
  if p_cap_months is null or p_cap_months not between 0 and 120 then
    return jsonb_build_object('ok', false, 'error', 'Plafonul de luni trebuie să fie între 0 și 120');
  end if;

  select * into v_old from public.affiliates where id = p_affiliate_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Afiliat inexistent');
  end if;

  update public.affiliates
     set setup_bps            = p_setup_bps,
         recurring_bps        = p_recurring_bps,
         cascade_bps          = p_cascade_bps,
         recurring_cap_months = p_cap_months
   where id = p_affiliate_id;
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return jsonb_build_object('ok', false, 'error', 'Afiliat inexistent');
  end if;

  perform public.log_platform_action('founder', null, 'set_affiliate_commission',
    jsonb_build_object(
      'affiliate_id', p_affiliate_id,
      'old', jsonb_build_object('setup_bps', v_old.setup_bps, 'recurring_bps', v_old.recurring_bps,
                                'cascade_bps', v_old.cascade_bps, 'recurring_cap_months', v_old.recurring_cap_months),
      'new', jsonb_build_object('setup_bps', p_setup_bps, 'recurring_bps', p_recurring_bps,
                                'cascade_bps', p_cascade_bps, 'recurring_cap_months', p_cap_months)
    ));

  return jsonb_build_object('ok', true);
end;
$$;

-- 2d. Aplică defaulturile curente la TOȚI afiliații (suprascrie override-urile).
create or replace function public.admin_apply_defaults_to_all_affiliates()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_defaults jsonb;
  v_setup int; v_recurring int; v_cascade int; v_cap int;
  v_count integer;
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;

  select value into v_defaults from public.platform_settings
   where key = 'affiliate_commission_defaults';

  v_setup     := coalesce((v_defaults->>'setup_bps')::int, 3000);
  v_recurring := coalesce((v_defaults->>'recurring_bps')::int, 1000);
  v_cascade   := coalesce((v_defaults->>'cascade_bps')::int, 200);
  v_cap       := coalesce((v_defaults->>'recurring_cap_months')::int, 12);

  update public.affiliates
     set setup_bps            = v_setup,
         recurring_bps        = v_recurring,
         cascade_bps          = v_cascade,
         recurring_cap_months = v_cap;
  get diagnostics v_count = row_count;

  perform public.log_platform_action('founder', null, 'apply_affiliate_defaults_all',
    jsonb_build_object(
      'defaults', jsonb_build_object('setup_bps', v_setup, 'recurring_bps', v_recurring,
                                     'cascade_bps', v_cascade, 'recurring_cap_months', v_cap),
      'updated_count', v_count
    ));

  return jsonb_build_object('ok', true, 'updated_count', v_count);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- Sec 3. register_affiliate — copie fidelă din mig 097d cu UN delta:
--        INSERT-ul preia bps-urile din platform_settings (fallback pe
--        valorile istorice 3000/1000/200/12 dacă settings lipsește).
-- ═══════════════════════════════════════════════════════════════════
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
  v_defaults jsonb;
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

  -- Comisioanele de start = defaulturile setate de fondator (mig 188).
  select value into v_defaults from public.platform_settings
   where key = 'affiliate_commission_defaults';

  insert into public.affiliates
    (profile_id, referral_code, parent_affiliate_id,
     setup_bps, recurring_bps, cascade_bps, recurring_cap_months)
  values
    (v_uid, v_code, v_parent.id,
     coalesce((v_defaults->>'setup_bps')::int, 3000),
     coalesce((v_defaults->>'recurring_bps')::int, 1000),
     coalesce((v_defaults->>'cascade_bps')::int, 200),
     coalesce((v_defaults->>'recurring_cap_months')::int, 12))
  returning id into v_aff_id;

  return jsonb_build_object('ok', true, 'affiliate_id', v_aff_id, 'referral_code', v_code,
    'parent_affiliate_id', v_parent.id);
end$$;

revoke all on function public.register_affiliate(text) from public, anon;
grant execute on function public.register_affiliate(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- Sec 4. admin_list_affiliates — copie fidelă din mig 186 + 4 chei bps
-- ═══════════════════════════════════════════════════════════════════
create or replace function public.admin_list_affiliates()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'affiliate_id',        a.id,
             'email',               p.email,
             'full_name',           p.full_name,
             'referral_code',       a.referral_code,
             'status',              a.status,
             'parent_affiliate_id', a.parent_affiliate_id,
             -- Comisioanele curente (mig 188) — editabile din FounderPage.
             'setup_bps',            a.setup_bps,
             'recurring_bps',        a.recurring_bps,
             'cascade_bps',          a.cascade_bps,
             'recurring_cap_months', a.recurring_cap_months,
             'balance_ron_cents', (
               select coalesce(sum(l.amount_cents), 0)
                 from public.affiliate_ledger l
                where l.affiliate_id = a.id and l.currency = 'RON'
             ),
             'restaurants', (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'restaurant_id', r.id,
                        'name',          r.name,
                        'slug',          r.slug,
                        'plan',          op.plan,
                        'is_active',     r.is_active
                      ) order by r.name), '[]'::jsonb)
                 from public.affiliate_attributions aa
                 join public.restaurants r on r.owner_id = aa.referred_profile_id
                 join public.profiles op on op.id = r.owner_id
                where aa.affiliate_id = a.id
             ),
             'created_at',          a.created_at
           ) order by a.created_at)
      from public.affiliates a
      join public.profiles p on p.id = a.profile_id
  ), '[]'::jsonb);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- Sec 5. get_affiliate_dashboard — copie fidelă din mig 174 cu UN delta:
--        ramura ne-afiliat include 'defaults' (procentele reale pentru
--        onboarding-ul „Devino afiliat" din AfiliatPage).
-- ═══════════════════════════════════════════════════════════════════
create or replace function public.get_affiliate_dashboard()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_aff     public.affiliates;
  v_result  jsonb;
  v_defaults jsonb;
begin
  if v_uid is null then
    raise exception using errcode = 'insufficient_privilege',
      message = 'get_affiliate_dashboard requires authentication';
  end if;

  select * into v_aff from public.affiliates where profile_id = v_uid;
  if not found then
    -- Ne-afiliat: includem defaulturile de comision (mig 188) ca onboarding-ul
    -- să afișeze procentele REALE pe care le-ar primi, nu text generic.
    select value into v_defaults from public.platform_settings
     where key = 'affiliate_commission_defaults';
    return jsonb_build_object('ok', true, 'is_affiliate', false,
      'defaults', jsonb_build_object(
        'setup_bps',            coalesce((v_defaults->>'setup_bps')::int, 3000),
        'recurring_bps',        coalesce((v_defaults->>'recurring_bps')::int, 1000),
        'recurring_cap_months', coalesce((v_defaults->>'recurring_cap_months')::int, 12)
      ));
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

-- ── Grants pe RPC-urile admin noi ────────────────────────────────────
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'admin_get_affiliate_defaults()',
    'admin_set_affiliate_defaults(int, int, int, int)',
    'admin_set_affiliate_commission(uuid, int, int, int, int)',
    'admin_apply_defaults_to_all_affiliates()'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon, service_role', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════
-- Asserții fail-closed
-- ═══════════════════════════════════════════════════════════════════
do $$
declare
  fn text;
begin
  -- 1. platform_settings există, cu RLS + seed.
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'platform_settings' and c.relrowsecurity
  ) then
    raise exception 'mig 188: platform_settings lipsește sau RLS oprit';
  end if;
  if not exists (
    select 1 from public.platform_settings where key = 'affiliate_commission_defaults'
  ) then
    raise exception 'mig 188: seed-ul affiliate_commission_defaults lipsește';
  end if;

  -- 2. RPC-urile admin noi există + au gate.
  foreach fn in array array[
    'admin_get_affiliate_defaults', 'admin_set_affiliate_defaults',
    'admin_set_affiliate_commission', 'admin_apply_defaults_to_all_affiliates'
  ] loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = fn and p.prosecdef
         and pg_get_functiondef(p.oid) ilike '%is_platform_admin%'
    ) then
      raise exception 'mig 188: %() lipsește sau nu are gate is_platform_admin', fn;
    end if;
  end loop;

  -- 3. register_affiliate citește defaulturile din platform_settings.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'register_affiliate'
       and pg_get_functiondef(p.oid) ilike '%platform_settings%'
  ) then
    raise exception 'mig 188: register_affiliate nu citește platform_settings';
  end if;

  -- 4. admin_list_affiliates expune bps-urile.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'admin_list_affiliates'
       and pg_get_functiondef(p.oid) ilike '%setup_bps%'
  ) then
    raise exception 'mig 188: admin_list_affiliates nu expune bps-urile';
  end if;

  -- 5. get_affiliate_dashboard păstrează fixul cross-currency (mig 174) și
  --    include defaults în ramura ne-afiliat.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'get_affiliate_dashboard'
       and pg_get_functiondef(p.oid) ilike '%l.currency = ''RON''%'
       and pg_get_functiondef(p.oid) ilike '%''defaults''%'
  ) then
    raise exception 'mig 188: get_affiliate_dashboard a pierdut fixul RON sau nu include defaults';
  end if;

  -- 6. UPDATE direct pe affiliates rămâne revocat; anon zero EXECUTE pe admin.
  if has_table_privilege('authenticated', 'public.affiliates', 'UPDATE') then
    raise exception 'mig 188: authenticated poate face UPDATE direct pe affiliates';
  end if;
  if has_function_privilege('anon', 'public.admin_set_affiliate_commission(uuid, int, int, int, int)', 'EXECUTE') then
    raise exception 'mig 188: anon poate executa admin_set_affiliate_commission';
  end if;
  if has_table_privilege('authenticated', 'public.platform_settings', 'INSERT')
     or has_table_privilege('authenticated', 'public.platform_settings', 'UPDATE') then
    raise exception 'mig 188: authenticated poate scrie direct în platform_settings';
  end if;

  raise notice 'mig 188: comisioane afiliat controlate de fondator OK';
end $$;

commit;
