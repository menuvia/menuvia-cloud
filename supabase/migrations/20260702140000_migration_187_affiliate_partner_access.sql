-- mig 187 — Acces partener: afiliații pot administra restaurantele aduse de ei
-- ─────────────────────────────────────────────────────────────────────
-- Decizie produs: afiliatul primește AUTOMAT acces de tip manager la
-- restaurantele atribuite lui (affiliate_attributions), dar ownerul
-- restaurantului îl poate REVOCA oricând din tabul Echipă. Vizitele se
-- înregistrează în platform_audit_log (log_partner_visit).
--
-- Lanțul de autorizare: afiliatul e legat de restaurant prin
--   affiliates.profile_id = auth.uid()
--   → affiliate_attributions.affiliate_id (status ne-revocat)
--   → referred_profile_id = restaurants.owner_id
-- (atribuirea e pe PROFILUL ownerului, nu direct pe restaurant — deci
-- accesul acoperă TOATE restaurantele ownerului atribuit, consecvent cu
-- modelul de comision care urmărește abonamentul ownerului).
--
-- Redefinim is_admin/is_member/my_role (a doua oară după mig 186) cu
-- ramura de partener; escape-ul is_platform_admin() din 186 se păstrează.
-- Convenția lockdown: SECURITY DEFINER, search_path, revoke/grant,
-- asserții fail-closed. Migrațiile aplicate nu se editează → fișier nou.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── 1. Coloana de revocare pe atribuiri ──────────────────────────────
alter table public.affiliate_attributions
  add column if not exists partner_access_revoked_at timestamptz;

comment on column public.affiliate_attributions.partner_access_revoked_at is
  'Ownerul restaurantului a revocat accesul de partener al afiliatului (null = acces activ).';

-- ── 2. Predicatul de acces partener (folosit în is_admin/is_member/my_role) ──
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
       and aa.partner_access_revoked_at is null
  )
$$;

revoke all on function public.has_partner_access(uuid) from public, anon, service_role;
grant execute on function public.has_partner_access(uuid) to authenticated;

-- ── 3. is_admin / is_member / my_role — stare finală (096a + 186 + partener) ──
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
  -- Fondatorul platformei (mig 186) sau afiliatul partener (mig 187,
  -- revocabil de owner) au acces admin.
  or public.is_platform_admin()
  or public.has_partner_access(p_restaurant_id)
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
  or public.has_partner_access(p_restaurant_id)
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
    -- Membership real are prioritate; fondatorul/partenerul FĂRĂ membership
    -- capătă rol virtual de manager (nu owner — owner_id rămâne imuabil).
    else coalesce(
      (
        select rm.role from public.restaurant_memberships rm
         where rm.restaurant_id = p_restaurant_id
           and rm.user_id = auth.uid()
           and rm.role <> 'owner'::public.member_role
         limit 1
      ),
      case when public.is_platform_admin() or public.has_partner_access(p_restaurant_id)
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

-- ── 4. Audit: permitem actor_kind 'owner' (revocările făcute de owner) ──
alter table public.platform_audit_log
  drop constraint if exists platform_audit_log_actor_kind_check;
alter table public.platform_audit_log
  add constraint platform_audit_log_actor_kind_check
  check (actor_kind in ('founder', 'affiliate', 'owner'));

-- ── 5. RPC-uri ───────────────────────────────────────────────────────

-- 5a. Restaurantele partenere ale afiliatului logat (pentru AffiliatePanel).
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
       and aa.partner_access_revoked_at is null
  ), '[]'::jsonb);
end;
$$;

-- 5b. Ownerul vede cine are acces de partener pe restaurantul lui (tab Echipă).
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
             'attribution_id', aa.id,
             'affiliate_email', p.email,
             'affiliate_name',  p.full_name,
             'revoked_at',      aa.partner_access_revoked_at
           ))
      from public.affiliate_attributions aa
      join public.affiliates a on a.id = aa.affiliate_id
      join public.profiles p on p.id = a.profile_id
      join public.restaurants r on r.owner_id = aa.referred_profile_id
     where r.id = p_restaurant_id
  ), '[]'::jsonb);
end;
$$;

-- 5c. Ownerul revocă accesul partenerului pe TOATE restaurantele lui
--     (atribuirea e pe profilul ownerului, deci revocarea e tot pe profil).
create or replace function public.revoke_affiliate_access(p_restaurant_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_updated integer;
begin
  select owner_id into v_owner from public.restaurants where id = p_restaurant_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'Acces interzis';
  end if;

  update public.affiliate_attributions
     set partner_access_revoked_at = now()
   where referred_profile_id = v_owner
     and partner_access_revoked_at is null;
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return jsonb_build_object('ok', false, 'error', 'Niciun acces de partener activ de revocat');
  end if;

  perform public.log_platform_action('owner', p_restaurant_id, 'revoke_partner_access',
    jsonb_build_object('revoked_attributions', v_updated));
  return jsonb_build_object('ok', true);
end;
$$;

-- 5d. Fondatorul revocă accesul unui afiliat (după attribution_id).
create or replace function public.admin_revoke_affiliate_access(p_attribution_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;

  update public.affiliate_attributions
     set partner_access_revoked_at = now()
   where id = p_attribution_id
     and partner_access_revoked_at is null;
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return jsonb_build_object('ok', false, 'error', 'Atribuire inexistentă sau deja revocată');
  end if;

  perform public.log_platform_action('founder', null, 'revoke_partner_access',
    jsonb_build_object('attribution_id', p_attribution_id));
  return jsonb_build_object('ok', true);
end;
$$;

-- 5e. Log de vizită la intrarea pe cont (fondator sau partener) — apelat
--     de client la „Intră pe cont"; best-effort, nu blochează navigarea.
create or replace function public.log_partner_visit(p_restaurant_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_platform_admin() then
    perform public.log_platform_action('founder', p_restaurant_id, 'enter_account', '{}'::jsonb);
    return jsonb_build_object('ok', true);
  end if;
  if public.has_partner_access(p_restaurant_id) then
    perform public.log_platform_action('affiliate', p_restaurant_id, 'enter_account', '{}'::jsonb);
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'Acces interzis';
end;
$$;

-- ── Grants ───────────────────────────────────────────────────────────
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'list_partner_restaurants()',
    'get_partner_access(uuid)',
    'revoke_affiliate_access(uuid)',
    'admin_revoke_affiliate_access(uuid)',
    'log_partner_visit(uuid)'
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
  -- 1. Coloana de revocare există.
  if not exists (
    select 1 from pg_attribute a join pg_class c on c.oid = a.attrelid
     where c.relname = 'affiliate_attributions'
       and a.attname = 'partner_access_revoked_at' and not a.attisdropped
  ) then
    raise exception 'mig 187: partner_access_revoked_at lipsește';
  end if;

  -- 2. is_admin/is_member/my_role păstrează AMBELE escape-uri (platform
  --    admin din 186 + partener din 187) — regresie = fail.
  foreach fn in array array['is_admin', 'is_member', 'my_role'] loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = fn
         and pg_get_functiondef(p.oid) ilike '%is_platform_admin%'
         and pg_get_functiondef(p.oid) ilike '%has_partner_access%'
    ) then
      raise exception 'mig 187: %() nu are ambele escape-uri (platform admin + partener)', fn;
    end if;
  end loop;

  -- 3. has_partner_access respectă revocarea și statusul afiliatului.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'has_partner_access'
       and pg_get_functiondef(p.oid) ilike '%partner_access_revoked_at is null%'
       and pg_get_functiondef(p.oid) ilike '%''active''%'
  ) then
    raise exception 'mig 187: has_partner_access nu verifică revocarea/statusul';
  end if;

  -- 4. RPC-urile există; anon zero EXECUTE.
  if has_function_privilege('anon', 'public.list_partner_restaurants()', 'EXECUTE') then
    raise exception 'mig 187: anon poate executa list_partner_restaurants';
  end if;
  if has_function_privilege('anon', 'public.revoke_affiliate_access(uuid)', 'EXECUTE') then
    raise exception 'mig 187: anon poate executa revoke_affiliate_access';
  end if;

  -- 5. Constraint-ul de actor_kind acceptă 'owner'.
  if not exists (
    select 1 from pg_constraint
     where conname = 'platform_audit_log_actor_kind_check'
       and pg_get_constraintdef(oid) ilike '%owner%'
  ) then
    raise exception 'mig 187: actor_kind nu acceptă owner';
  end if;

  raise notice 'mig 187: acces partener afiliați OK';
end $$;

commit;
