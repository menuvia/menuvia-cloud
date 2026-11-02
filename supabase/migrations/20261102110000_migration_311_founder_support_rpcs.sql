-- migration_311_founder_support_rpcs.sql
-- =============================================================================
-- Fondatorul în vizită („Intră pe cont", founder view) poate roti QR-ul unei
-- mese și salva harta sălii — cele două RPC-uri DEFINER de pe tab-urile Mese &
-- QR / Hartă sală care verificau membership-ul DIRECT, fără escape-ul
-- `is_platform_admin()` pe care funelul is_admin/is_member/my_role îl are din
-- mig 186.
--
-- ── Ce era ───────────────────────────────────────────────────────────────────
-- `rotate_qr_token` (mig 022) și `save_floor_layout` (018 → 154) citesc
-- `restaurant_memberships` / `restaurants.owner_id` pentru `auth.uid()`. În
-- founder view RestaurantContext injectează un membership SINTETIC (manager)
-- doar în UI: în bază nu există niciun rând, deci ambele refuzau cu „Acces
-- interzis" — singurele butoane din tab-urile vizitate care eșuau pentru
-- fondator, deși TOT restul (produse, mese, categorii, prin RLS + is_admin)
-- mergea. Fondatorul intră pe cont tocmai ca să ajute la configurare.
--
-- ── Fix ──────────────────────────────────────────────────────────────────────
-- Recreare VERBATIM din ultimele definiții (022 pentru rotate_qr_token, 154
-- pentru save_floor_layout) + `or public.is_platform_admin()` în verificarea
-- de autorizare — EXACT escape-ul funelului (mig 186; cu MFA din 235: cere aal2
-- când `mfa_enforced`). Nimic altceva nu se schimbă: gate-ul de plan
-- `floor_plan` și plafonul de 1 MiB (154) rămân, refuzul pentru waiter/kitchen
-- rămâne, iar partenerul (mig 286) NU primește nimic — `has_partner_access` nu
-- apare aici, deliberat (PO9: accesul lui stă doar în politicile dedicate).
--
-- `create or replace` REscrie `proconfig`: `search_path = public, pg_temp` se
-- scrie explicit (rotate_qr_token avea `public` în 022, iar pg_temp-ul venea
-- din ALTER-ul din 262 — fără el s-ar pierde tăcut, capcana din 281).
-- Grant-urile se re-declară IDENTIC cu 297 (revoke public+anon, grant
-- authenticated) — `create or replace` le păstrează oricum; declarația le face
-- verificabile aici.
--
-- Teste permanente: tests/sql/auto/311_founder_support_rpcs.sql (FS1–FS8).
-- =============================================================================

begin;

set local lock_timeout = '10s';

-- ── rotate_qr_token (022 → 311) ──────────────────────────────────────────────
create or replace function public.rotate_qr_token(p_table_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_table record;
  v_new_id uuid;
begin
  -- Află restaurantul + verifică membership
  select t.id, t.restaurant_id into v_table
  from public.tables t
  where t.id = p_table_id;

  if not found then
    raise exception 'Masa nu există.';
  end if;

  -- mig 311: + escape-ul de platformă (fondatorul în vizită), ca funelul 186.
  if not exists (
    select 1 from public.restaurant_memberships
    where restaurant_id = v_table.restaurant_id
      and user_id = auth.uid()
      and role in ('owner','manager')
  ) and not exists (
    select 1 from public.restaurants
    where id = v_table.restaurant_id and owner_id = auth.uid()
  ) and not public.is_platform_admin() then
    raise exception 'Acces interzis: doar owner/manager pot roti token-urile.';
  end if;

  -- Într-o singură tranzacție: dezactivează vechiul, creează noul
  update public.qr_tokens
  set is_active = false
  where table_id = p_table_id and is_active = true;

  insert into public.qr_tokens (restaurant_id, table_id)
  values (v_table.restaurant_id, p_table_id)
  returning id into v_new_id;

  return jsonb_build_object('ok', true, 'new_token_id', v_new_id);
end;
$$;

revoke execute on function public.rotate_qr_token(uuid) from public, anon;
grant  execute on function public.rotate_qr_token(uuid) to authenticated;

-- ── save_floor_layout (018 → 154 → 311) ──────────────────────────────────────
create or replace function public.save_floor_layout(p_restaurant_id uuid, p_layout jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_role text;
begin
  -- Verifică că user-ul curent e owner sau manager
  select role into v_role
  from restaurant_memberships
  where restaurant_id = p_restaurant_id
    and user_id = auth.uid()
  limit 1;

  -- mig 311: + escape-ul de platformă (fondatorul în vizită), ca funelul 186.
  if v_role is null then
    if not exists (
      select 1 from restaurants
      where id = p_restaurant_id and owner_id = auth.uid()
    ) and not public.is_platform_admin() then
      raise exception 'Acces interzis: nu ești owner/manager al acestui restaurant';
    end if;
  elsif v_role not in ('owner', 'manager') and not public.is_platform_admin() then
    raise exception 'Acces interzis: doar owner/manager pot edita layout-ul';
  end if;

  -- #24 (mig 154): Hartă sală = feature Plan 3 (floor_plan). Gate după verificarea de rol.
  perform public.enforce_feature_for_restaurant(p_restaurant_id, 'floor_plan');

  -- p_layout trebuie să fie un obiect JSON (nu array/scalar arbitrar)
  if p_layout is null or jsonb_typeof(p_layout) <> 'object' then
    raise exception 'Layout invalid: se așteaptă un obiect JSON'
      using errcode = 'P0001', hint = 'invalid_layout';
  end if;

  -- #25 (mig 154): plafon de dimensiune (1 MiB) — anti DoS pe storage/row.
  if octet_length(p_layout::text) > 1048576 then
    raise exception 'Layout prea mare (max 1 MB)'
      using errcode = 'P0001', hint = 'layout_too_large';
  end if;

  update restaurants
  set floor_layout = p_layout,
      updated_at   = now()
  where id = p_restaurant_id;
end;
$function$;

revoke execute on function public.save_floor_layout(uuid, jsonb) from public, anon;
grant  execute on function public.save_floor_layout(uuid, jsonb) to authenticated;

-- ── Asserție fail-closed ─────────────────────────────────────────────────────
do $$
declare
  v_sig  text;
  v_src  text;
  v_cfg  text[];
  v_def  boolean;
  v_n    int;
begin
  foreach v_sig in array array['public.rotate_qr_token(uuid)', 'public.save_floor_layout(uuid,jsonb)'] loop
    select p.prosrc, p.proconfig, p.prosecdef into v_src, v_cfg, v_def
      from pg_proc p where p.oid = v_sig::regprocedure;
    if position('is_platform_admin()' in v_src) = 0 then
      raise exception 'mig 311: % nu are escape-ul is_platform_admin()', v_sig; end if;
    if position('has_partner_access' in v_src) > 0 then
      raise exception 'mig 311: % NU are voie să dea acces partenerului (mig 286)', v_sig; end if;
    if not v_def or not (v_cfg @> array['search_path=public, pg_temp']) then
      raise exception 'mig 311: % trebuie să fie DEFINER cu search_path public, pg_temp (are %)', v_sig, v_cfg; end if;
    if has_function_privilege('anon', v_sig::regprocedure, 'execute') then
      raise exception 'mig 311: % e executabilă de anon', v_sig; end if;
    if not has_function_privilege('authenticated', v_sig::regprocedure, 'execute') then
      raise exception 'mig 311: authenticated a pierdut %', v_sig; end if;
  end loop;

  select count(*) into v_n from pg_proc
   where pronamespace = 'public'::regnamespace and proname in ('rotate_qr_token', 'save_floor_layout');
  if v_n <> 2 then
    raise exception 'mig 311: se așteptau exact 2 semnături, sunt %', v_n; end if;

  select prosrc into v_src from pg_proc where oid = 'public.save_floor_layout(uuid,jsonb)'::regprocedure;
  if position('floor_plan' in v_src) = 0 or position('layout_too_large' in v_src) = 0 then
    raise exception 'mig 311: save_floor_layout a pierdut gate-ul floor_plan / plafonul (154)'; end if;

  raise notice 'mig 311: rotate_qr_token + save_floor_layout cu escape is_platform_admin() OK';
end $$;

commit;
