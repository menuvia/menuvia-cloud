-- mig 286 — Accesul partenerului (afiliat) devine OPT-IN și cu ROL RESTRÂNS
-- ─────────────────────────────────────────────────────────────────────
-- DECIZIE DE FONDATOR (1 oct 2026), care ÎNLOCUIEȘTE regula din mig 187
-- („funelul is_admin/is_member/my_role păstrează AMBELE escape-uri"):
--
--   * Mig 187 făcea din afiliat un MANAGER virtual pe TOATE restaurantele
--     ownerului atribuit (is_admin/is_member/my_role includeau
--     has_partner_access), AUTOMAT, de la momentul atribuirii — care se scrie
--     la checkout-ul abandonat (stripe-checkout.js), nu la plată. Ca manager
--     partenerul citea oblio_configs.api_secret, comenzile și telefoanele
--     oaspeților, rezervările, iar prin PATCH direct putea rescrie jurnalul
--     fiscal (SC-1) — fără ca ownerul să fi consimțit la ceva.
--
--   * Acum: (1) partenerul NU mai e în funel — `has_partner_access` iese din
--     is_admin/is_member/my_role (escape-ul `is_platform_admin()` din 186
--     RĂMÂNE: fondatorul își păstrează accesul); (2) accesul cere
--     CONSIMȚĂMÂNTUL ownerului (`owner_consented_at`), cerut de afiliat
--     (`request_partner_access`) și acordat/revocat de owner
--     (`grant_partner_access`/`revoke_partner_access`); (3) accesul acordat
--     acoperă DOAR meniul + mesele/QR, prin politici DEDICATE, nu prin funel.
--
-- Suprafața partenerului după această migrație (și NUMAI ea):
--   citire restaurants; categories, products, product_extras,
--   product_pairings, modifier_groups/modifier_options/product_modifier_groups,
--   tables, qr_tokens (citire + configurare); vat_rates (DOAR citire — formularul
--   de produs cere grupele de TVA). NIMIC pe orders/order_items/order_payments,
--   reservations, pending_receipts, invoices, oblio_configs, cash_*,
--   bridge_devices, ai_provider_configs, loyalty, restaurant_memberships,
--   invite_tokens, setări (UPDATE restaurants).
--
-- Clichet de CLASĂ la finalul migrației: nicio politică din `public` în afara
-- listei de mai sus nu are voie să pomenească has_partner_access (o politică
-- viitoare care „dă și partenerului" pe o tabelă sensibilă face migrația /
-- CI-ul roșu), iar funelul nu are voie să-l conțină.
--
-- Mig 187 NU se editează (migrațiile aplicate nu se ating): asserția ei
-- „funelul are AMBELE escape-uri" rulează doar în corpul ei, la poziția 187.
-- Echivalentul permanent inversat e în tests/sql/partner_optin_assertions.sql.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── 1. Consimțământul ownerului + momentul cererii ───────────────────
alter table public.affiliate_attributions
  add column if not exists owner_consented_at timestamptz,
  add column if not exists partner_access_requested_at timestamptz;

comment on column public.affiliate_attributions.owner_consented_at is
  'Ownerul (sau un manager al lui) a ACORDAT accesul de partener (mig 286). NULL = fără consimțământ = fără acces. Rămâne setat și după revocare (urmă); revocarea e partner_access_revoked_at.';
comment on column public.affiliate_attributions.partner_access_requested_at is
  'Afiliatul a cerut accesul (request_partner_access, mig 286). Ownerul vede cererea în tab-ul Echipă.';

-- ── 2. Funelul de autorizare FĂRĂ partener (186 + nimic) ─────────────
-- Copie a definițiilor din mig 186 (ultima stare dinaintea lui 187), fără
-- ramura de partener. is_platform_admin() RĂMÂNE.
create or replace function public.is_admin(p_restaurant_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.restaurants
     where id = p_restaurant_id and owner_id = auth.uid()
  ) or exists (
    select 1 from public.restaurant_memberships rm
     where rm.restaurant_id = p_restaurant_id
       and rm.user_id = auth.uid()
       and rm.role = 'manager'::public.member_role
  )
  -- Fondatorul platformei are acces admin pe ORICE restaurant (mig 186).
  -- Partenerul NU mai e aici (mig 286): are politici dedicate, doar pe meniu.
  or public.is_platform_admin()
$$;

create or replace function public.is_member(p_restaurant_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.restaurants
     where id = p_restaurant_id and owner_id = auth.uid()
  ) or exists (
    select 1 from public.restaurant_memberships rm
     where rm.restaurant_id = p_restaurant_id
       and rm.user_id = auth.uid()
  )
  or public.is_platform_admin()
$$;

create or replace function public.my_role(p_restaurant_id uuid)
returns public.member_role
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case
    when exists (
      select 1 from public.restaurants
       where id = p_restaurant_id and owner_id = auth.uid()
    ) then 'owner'::public.member_role
    -- Membership real are prioritate; fondatorul FĂRĂ membership capătă rol
    -- virtual de manager (nu owner — owner_id rămâne imuabil). Partenerul NU
    -- are rol în DB (mig 286): rolul „partner" există doar în UI.
    else coalesce(
      (
        select rm.role from public.restaurant_memberships rm
         where rm.restaurant_id = p_restaurant_id
           and rm.user_id = auth.uid()
           and rm.role <> 'owner'::public.member_role
         limit 1
      ),
      case when public.is_platform_admin()
           then 'manager'::public.member_role
           else null end
    )
  end
$$;

revoke all on function public.is_admin(uuid)  from public, anon, service_role;
revoke all on function public.is_member(uuid) from public, anon, service_role;
revoke all on function public.my_role(uuid)   from public, anon, service_role;
grant execute on function public.is_admin(uuid)  to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.my_role(uuid)   to authenticated;

-- ── 3. has_partner_access — stare finală (193 + consimțământ) ────────
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
       and aa.owner_consented_at is not null
       and aa.partner_access_revoked_at is null
  )
$$;

revoke all on function public.has_partner_access(uuid) from public, anon, service_role;
grant execute on function public.has_partner_access(uuid) to authenticated;

comment on function public.has_partner_access(uuid) is
  'Afiliatul are acces de PARTENER (meniu + mese/QR, prin politici dedicate — NU prin is_admin/is_member) pe restaurantul referit? Cere: afiliat activ, atribuire ne-terminală (nu canceled/refunded/expired), CONSIMȚĂMÂNT al ownerului (owner_consented_at, mig 286), acces nerevocat. Se aplică LIVE.';

-- ── 4. list_partner_restaurants — oglindește EXACT același criteriu ──
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
       and aa.owner_consented_at is not null
       and aa.partner_access_revoked_at is null
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_partner_restaurants() from public, anon, service_role;
grant execute on function public.list_partner_restaurants() to authenticated;

-- ── 5. Starea accesului (sursă unică pentru ambele ecrane) ───────────
-- granted   : consimțământ dat, nerevocat
-- requested : cerere ulterioară ultimei revocări (sau fără revocare), fără acces
-- revoked   : revocat (de owner/manager/fondator) și nicio cerere nouă după
-- none      : nicio cerere, niciun acces
create or replace function public.partner_access_state(
  p_requested timestamptz,
  p_consented timestamptz,
  p_revoked   timestamptz
)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select case
    when p_revoked is null and p_consented is not null then 'granted'
    when p_requested is not null and (p_revoked is null or p_requested > p_revoked) then 'requested'
    when p_revoked is not null then 'revoked'
    else 'none'
  end
$$;

revoke all on function public.partner_access_state(timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

-- ── 6. get_partner_access (tab Echipă al ownerului) — lanț 187 → 286 ──
-- Aceeași gate (owner REAL) și aceeași formă + câmpurile noi; rândurile fără
-- nicio cerere/acces ('none') nu se afișează.
create or replace function public.get_partner_access(p_restaurant_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  -- Gate pe owner REAL (nu is_admin — partenerul nu trebuie să-și vadă/
  -- administreze propriul acces prin această cale).
  if not exists (
    select 1 from public.restaurants
     where id = p_restaurant_id and owner_id = auth.uid()
  ) then
    raise exception 'Acces interzis';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'attribution_id',  aa.id,
             'affiliate_email', p.email,
             'affiliate_name',  p.full_name,
             'revoked_at',      aa.partner_access_revoked_at,
             'requested_at',    aa.partner_access_requested_at,
             'consented_at',    aa.owner_consented_at,
             'state',           public.partner_access_state(
                                  aa.partner_access_requested_at,
                                  aa.owner_consented_at,
                                  aa.partner_access_revoked_at)
           ) order by aa.created_at)
      from public.affiliate_attributions aa
      join public.affiliates a on a.id = aa.affiliate_id
      join public.profiles p on p.id = a.profile_id
      join public.restaurants r on r.owner_id = aa.referred_profile_id
     where r.id = p_restaurant_id
       and public.partner_access_state(
             aa.partner_access_requested_at,
             aa.owner_consented_at,
             aa.partner_access_revoked_at) <> 'none'
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_partner_access(uuid) from public, anon, service_role;
grant execute on function public.get_partner_access(uuid) to authenticated;

-- ── 7. list_partner_attributions (AfiliatPage: stările cererilor) ────
-- Restaurantele (cu id, pentru „Intră pe dashboard") se întorc DOAR când
-- accesul e acordat; altfel doar numele (care oricum apar în dashboard-ul
-- afiliatului, mig 097).
create or replace function public.list_partner_attributions()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  return coalesce((
    select jsonb_agg(row_json order by created_at)
      from (
        select aa.created_at,
               jsonb_build_object(
                 'attribution_id', aa.id,
                 'status',         aa.status,
                 'state',          public.partner_access_state(
                                     aa.partner_access_requested_at,
                                     aa.owner_consented_at,
                                     aa.partner_access_revoked_at),
                 'requested_at',   aa.partner_access_requested_at,
                 'consented_at',   aa.owner_consented_at,
                 'revoked_at',     aa.partner_access_revoked_at,
                 'restaurant_names', coalesce((
                   select jsonb_agg(r.name order by r.name)
                     from public.restaurants r
                    where r.owner_id = aa.referred_profile_id
                 ), '[]'::jsonb),
                 'restaurants', case
                   when aa.status not in ('canceled', 'refunded', 'expired')
                    and aa.owner_consented_at is not null
                    and aa.partner_access_revoked_at is null
                   then coalesce((
                     select jsonb_agg(jsonb_build_object(
                              'restaurant_id', r.id,
                              'name',          r.name,
                              'city',          r.city,
                              'is_active',     r.is_active
                            ) order by r.name)
                       from public.restaurants r
                      where r.owner_id = aa.referred_profile_id
                   ), '[]'::jsonb)
                   else '[]'::jsonb
                 end
               ) as row_json
          from public.affiliates a
          join public.affiliate_attributions aa on aa.affiliate_id = a.id
         where a.profile_id = auth.uid()
           and a.status = 'active'
           and aa.status not in ('canceled', 'refunded', 'expired')
      ) s
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_partner_attributions() from public, anon, service_role;
grant execute on function public.list_partner_attributions() to authenticated;

-- ── 8. request_partner_access — afiliatul CERE accesul ───────────────
create or replace function public.request_partner_access(p_attribution_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_aa    public.affiliate_attributions%rowtype;
  v_state text;
  v_rid   uuid;
begin
  select aa.* into v_aa
    from public.affiliate_attributions aa
    join public.affiliates a on a.id = aa.affiliate_id
   where aa.id = p_attribution_id
     and a.profile_id = auth.uid()
     and a.status = 'active'
     and aa.status not in ('canceled', 'refunded', 'expired');
  if not found then
    raise exception 'Acces interzis';
  end if;

  v_state := public.partner_access_state(
    v_aa.partner_access_requested_at, v_aa.owner_consented_at, v_aa.partner_access_revoked_at);
  if v_state in ('granted', 'requested') then
    return jsonb_build_object('ok', true, 'state', v_state);
  end if;

  select r.id into v_rid
    from public.restaurants r
   where r.owner_id = v_aa.referred_profile_id
   order by r.created_at
   limit 1;
  if v_rid is null then
    return jsonb_build_object('ok', false,
      'error', 'Clientul nu are încă un restaurant creat — nu e nimic de accesat.');
  end if;

  update public.affiliate_attributions
     set partner_access_requested_at = now()
   where id = p_attribution_id;

  perform public.log_platform_action('affiliate', v_rid, 'request_partner_access',
    jsonb_build_object('attribution_id', p_attribution_id));
  return jsonb_build_object('ok', true, 'state', 'requested');
end;
$$;

-- ── 9. grant_partner_access — ownerul/managerul ACORDĂ ───────────────
-- Consimțământul îl dau doar principalii REALI ai contului (owner sau manager
-- membru), NU is_admin: acela include fondatorul, iar un consimțământ pus de
-- fondator în numele ownerului nu e consimțământ.
create or replace function public.partner_consent_principal(p_referred_profile_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and (
       auth.uid() = p_referred_profile_id
       or exists (
         select 1
           from public.restaurants r
           join public.restaurant_memberships rm on rm.restaurant_id = r.id
          where r.owner_id = p_referred_profile_id
            and rm.user_id = auth.uid()
            and rm.role = 'manager'::public.member_role
       )
     )
$$;

revoke all on function public.partner_consent_principal(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.grant_partner_access(p_attribution_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_aa  public.affiliate_attributions%rowtype;
  v_rid uuid;
begin
  select * into v_aa from public.affiliate_attributions where id = p_attribution_id for update;
  if not found or not public.partner_consent_principal(v_aa.referred_profile_id) then
    raise exception 'Acces interzis';
  end if;
  -- Doar o cerere a afiliatului se poate aproba (fără acces „în avans").
  if v_aa.partner_access_requested_at is null then
    return jsonb_build_object('ok', false, 'error', 'Partenerul nu a cerut acces.');
  end if;
  if v_aa.status in ('canceled', 'refunded', 'expired') then
    return jsonb_build_object('ok', false, 'error', 'Atribuirea nu mai este activă.');
  end if;

  update public.affiliate_attributions
     set owner_consented_at = now(),
         partner_access_revoked_at = null
   where id = p_attribution_id;

  select r.id into v_rid from public.restaurants r
   where r.owner_id = v_aa.referred_profile_id order by r.created_at limit 1;
  perform public.log_platform_action('owner', v_rid, 'grant_partner_access',
    jsonb_build_object('attribution_id', p_attribution_id));
  return jsonb_build_object('ok', true);
end;
$$;

-- ── 10. revoke_partner_access — ownerul/managerul REVOCĂ / REFUZĂ ────
create or replace function public.revoke_partner_access(p_attribution_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_aa  public.affiliate_attributions%rowtype;
  v_rid uuid;
begin
  select * into v_aa from public.affiliate_attributions where id = p_attribution_id for update;
  if not found or not public.partner_consent_principal(v_aa.referred_profile_id) then
    raise exception 'Acces interzis';
  end if;
  if v_aa.partner_access_revoked_at is not null
     and (v_aa.partner_access_requested_at is null
          or v_aa.partner_access_requested_at <= v_aa.partner_access_revoked_at) then
    return jsonb_build_object('ok', false, 'error', 'Accesul este deja revocat.');
  end if;
  if v_aa.partner_access_requested_at is null and v_aa.owner_consented_at is null then
    return jsonb_build_object('ok', false, 'error', 'Nu există acces sau cerere de revocat.');
  end if;

  update public.affiliate_attributions
     set partner_access_revoked_at = now()
   where id = p_attribution_id;

  select r.id into v_rid from public.restaurants r
   where r.owner_id = v_aa.referred_profile_id order by r.created_at limit 1;
  perform public.log_platform_action('owner', v_rid, 'revoke_partner_access',
    jsonb_build_object('attribution_id', p_attribution_id));
  return jsonb_build_object('ok', true);
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'request_partner_access(uuid)',
    'grant_partner_access(uuid)',
    'revoke_partner_access(uuid)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- ── 11. Politici DEDICATE de partener (meniu + mese/QR) ──────────────
-- ALTER POLICY, nu politici noi: aceleași nume, aceleași roluri, aceeași
-- logică + `or has_partner_access(...)`. Fără politici permisive duplicate.

-- restaurants: DOAR citire (nu UPDATE — setările rămân ale ownerului).
alter policy "restaurants: member read" on public.restaurants
  using (public.is_member(id) or public.has_partner_access(id));

-- categories
alter policy "categories: admin write" on public.categories
  using (public.is_admin(restaurant_id) or public.has_partner_access(restaurant_id))
  with check (public.is_admin(restaurant_id) or public.has_partner_access(restaurant_id));

-- products
alter policy "products: admin write" on public.products
  using (public.is_admin(restaurant_id) or public.has_partner_access(restaurant_id))
  with check (public.is_admin(restaurant_id) or public.has_partner_access(restaurant_id));
alter policy "products: member read all" on public.products
  using (public.is_member(restaurant_id) or public.has_partner_access(restaurant_id));

-- product_extras / product_pairings (prin produs)
alter policy "extras: admin manage" on public.product_extras
  using (exists (
    select 1 from public.products p
     where p.id = product_extras.product_id
       and (public.is_admin(p.restaurant_id) or public.has_partner_access(p.restaurant_id))))
  with check (exists (
    select 1 from public.products p
     where p.id = product_extras.product_id
       and (public.is_admin(p.restaurant_id) or public.has_partner_access(p.restaurant_id))));

alter policy "pairings: admin manage" on public.product_pairings
  using (exists (
    select 1 from public.products p
     where p.id = product_pairings.product_id
       and (public.is_admin(p.restaurant_id) or public.has_partner_access(p.restaurant_id))))
  with check (exists (
    select 1 from public.products p
     where p.id = product_pairings.product_id
       and (public.is_admin(p.restaurant_id) or public.has_partner_access(p.restaurant_id))));

-- modifier_groups / modifier_options / product_modifier_groups
alter policy "modifier_groups: admin write" on public.modifier_groups
  using (public.is_admin(restaurant_id) or public.has_partner_access(restaurant_id))
  with check (public.is_admin(restaurant_id) or public.has_partner_access(restaurant_id));
alter policy "modifier_groups: member read" on public.modifier_groups
  using (public.is_member(restaurant_id) or public.has_partner_access(restaurant_id));

alter policy "modifier_options: admin write" on public.modifier_options
  using (exists (
    select 1 from public.modifier_groups mg
     where mg.id = modifier_options.modifier_group_id
       and (public.is_admin(mg.restaurant_id) or public.has_partner_access(mg.restaurant_id))))
  with check (exists (
    select 1 from public.modifier_groups mg
     where mg.id = modifier_options.modifier_group_id
       and (public.is_admin(mg.restaurant_id) or public.has_partner_access(mg.restaurant_id))));
alter policy "modifier_options: member read" on public.modifier_options
  using (public.is_member_of_modifier_group(modifier_group_id)
         or exists (
           select 1 from public.modifier_groups mg
            where mg.id = modifier_options.modifier_group_id
              and public.has_partner_access(mg.restaurant_id)));

alter policy "pmg: admin write" on public.product_modifier_groups
  using (exists (
    select 1 from public.modifier_groups mg
      join public.products p on p.restaurant_id = mg.restaurant_id
     where mg.id = product_modifier_groups.modifier_group_id
       and p.id = product_modifier_groups.product_id
       and (public.is_admin(mg.restaurant_id) or public.has_partner_access(mg.restaurant_id))))
  with check (exists (
    select 1 from public.modifier_groups mg
      join public.products p on p.restaurant_id = mg.restaurant_id
     where mg.id = product_modifier_groups.modifier_group_id
       and p.id = product_modifier_groups.product_id
       and (public.is_admin(mg.restaurant_id) or public.has_partner_access(mg.restaurant_id))));

-- tables
alter policy "tables: admin delete" on public.tables
  using (public.is_admin(restaurant_id) or public.has_partner_access(restaurant_id));
alter policy "tables: admin insert" on public.tables
  with check (public.is_admin(restaurant_id) or public.has_partner_access(restaurant_id));
alter policy "tables: admin update" on public.tables
  using (public.is_admin(restaurant_id) or public.has_partner_access(restaurant_id));
alter policy "tables: members read" on public.tables
  using (public.is_member(restaurant_id) or public.has_partner_access(restaurant_id));

-- qr_tokens
alter policy "qr_tokens: admin delete" on public.qr_tokens
  using (public.is_admin(restaurant_id) or public.has_partner_access(restaurant_id));
alter policy "qr_tokens: admin insert" on public.qr_tokens
  with check (public.is_admin(restaurant_id) or public.has_partner_access(restaurant_id));
alter policy "qr_tokens: admin update" on public.qr_tokens
  using (public.is_admin(restaurant_id) or public.has_partner_access(restaurant_id));
alter policy "qr_tokens: members read" on public.qr_tokens
  using (public.is_member(restaurant_id) or public.has_partner_access(restaurant_id));

-- vat_rates: DOAR citire (formularul de produs cere grupele de TVA).
alter policy "vat_rates: member read" on public.vat_rates
  using (public.is_member(restaurant_id) or public.has_partner_access(restaurant_id));

-- ═══════════════════════════════════════════════════════════════════
-- Asserții fail-closed
-- ═══════════════════════════════════════════════════════════════════
do $$
declare
  v_def text;
  fn    text;
  v_bad text;
  v_tables text;
begin
  -- 1. Funelul: is_platform_admin DA (186), has_partner_access NU (286).
  foreach fn in array array['is_admin', 'is_member', 'my_role'] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn
       and pg_get_function_identity_arguments(p.oid) = 'p_restaurant_id uuid';
    if v_def is null or v_def not ilike '%is_platform_admin%' then
      raise exception 'mig 286: %() a pierdut escape-ul is_platform_admin (186)', fn;
    end if;
    if v_def ilike '%has_partner_access%' then
      raise exception 'mig 286: %() mai conține has_partner_access — partenerul nu are voie în funel', fn;
    end if;
    if v_def !~* 'pg_temp' then
      raise exception 'mig 286: %() fără pg_temp în search_path', fn;
    end if;
  end loop;

  -- 2. has_partner_access cere consimțământ + revocare + status + afiliat activ.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'has_partner_access';
  if v_def is null
     or v_def !~ 'owner_consented_at is not null'
     or v_def !~ 'partner_access_revoked_at is null'
     or v_def !~ 'canceled' or v_def !~ 'refunded' or v_def !~ 'expired'
     or v_def !~ '''active''' or v_def !~ 'pg_temp' then
    raise exception 'mig 286: has_partner_access nu are toate criteriile (consimțământ/revocare/status/afiliat activ)';
  end if;

  -- 3. list_partner_restaurants oglindește EXACT criteriul.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'list_partner_restaurants';
  if v_def is null
     or v_def !~ 'owner_consented_at is not null'
     or v_def !~ 'partner_access_revoked_at is null'
     or v_def !~ 'canceled' or v_def !~ '''active''' then
    raise exception 'mig 286: list_partner_restaurants nu oglindește has_partner_access';
  end if;

  -- 4. CLICHET DE CLASĂ: has_partner_access apare în politici EXCLUSIV pe
  --    tabelele permise (meniu + mese/QR + vat_rates read).
  select string_agg(distinct c.relname, ', ' order by c.relname) into v_bad
    from pg_policy pol join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') ilike '%has_partner_access%'
          or coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ilike '%has_partner_access%')
     and c.relname not in (
       'restaurants', 'categories', 'products', 'product_extras', 'product_pairings',
       'modifier_groups', 'modifier_options', 'product_modifier_groups',
       'tables', 'qr_tokens', 'vat_rates');
  if v_bad is not null then
    raise exception 'mig 286: politici de partener pe tabele NEPERMISE: %', v_bad;
  end if;

  select string_agg(distinct c.relname, ', ' order by c.relname) into v_tables
    from pg_policy pol join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') ilike '%has_partner_access%'
          or coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ilike '%has_partner_access%');
  if v_tables is distinct from
     'categories, modifier_groups, modifier_options, product_extras, product_modifier_groups, product_pairings, products, qr_tokens, restaurants, tables, vat_rates' then
    raise exception 'mig 286: setul tabelelor cu politică de partener s-a schimbat: %', v_tables;
  end if;

  -- 5. restaurants: partenerul NU primește UPDATE (setările rămân ale ownerului).
  if exists (
    select 1 from pg_policy pol join pg_class c on c.oid = pol.polrelid
     where c.relname = 'restaurants' and c.relnamespace = 'public'::regnamespace
       and pol.polcmd in ('w', '*')
       and coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') ilike '%has_partner_access%'
  ) then
    raise exception 'mig 286: partenerul are politică de scriere pe restaurants';
  end if;

  -- 6. Privilegii: RPC-urile noi — authenticated DA, anon/service_role NU;
  --    helperii interni — nimeni.
  foreach fn in array array[
    'public.request_partner_access(uuid)',
    'public.grant_partner_access(uuid)',
    'public.revoke_partner_access(uuid)',
    'public.list_partner_attributions()'
  ] loop
    if not has_function_privilege('authenticated', fn, 'EXECUTE')
       or has_function_privilege('anon', fn, 'EXECUTE')
       or has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception 'mig 286: grant-uri greșite pe %', fn;
    end if;
  end loop;
  foreach fn in array array[
    'public.partner_access_state(timestamptz, timestamptz, timestamptz)',
    'public.partner_consent_principal(uuid)'
  ] loop
    if has_function_privilege('authenticated', fn, 'EXECUTE')
       or has_function_privilege('anon', fn, 'EXECUTE')
       or has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception 'mig 286: helperul intern % e executabil din roluri client', fn;
    end if;
  end loop;

  -- 7. Toate RPC-urile noi sunt DEFINER cu search_path explicit + pg_temp.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('request_partner_access', 'grant_partner_access', 'revoke_partner_access',
                         'list_partner_attributions', 'partner_consent_principal')
       and (not p.prosecdef or p.proconfig is null
            or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%pg_temp%'))
  ) then
    raise exception 'mig 286: RPC nou fără SECURITY DEFINER + search_path (public, pg_temp)';
  end if;

  raise notice 'mig 286: acces partener opt-in + rol restrâns OK';
end $$;

commit;
