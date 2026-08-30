-- migration_261_anon_analytics_rate_limits.sql
-- =============================================================================
-- Închiderea ultimelor scrieri anon NElimitate (auditul v2, aug 2026) — lanț
-- 013→261 pentru record_qr_scan/record_page_view, 097c→261 pentru
-- preview_referral. Aceeași disciplină ca get_loyalty_state (mig 258):
-- plafoane generoase (invizibile pentru trafic real), degradare TĂCUTĂ peste
-- plafon (analytics, nu bani — nu stricăm UX-ul public cu erori).
--
--   1. record_qr_scan (anon): plafon 300/15min per restaurant. Înainte: un
--      anonim putea umfla nelimitat qr_scans (poluare analytics).
--   2. record_page_view (anon): plafon 600/15min per restaurant + VALIDAREA
--      p_product_id ↔ p_restaurant_id (înainte: anon putea insera page_views
--      cu product_id al ALTUI tenant — poluare analytics cross-tenant).
--      Product_id străin se anulează (view-ul de restaurant rămâne — semnalul
--      agregat corect se păstrează, poluarea per-produs moare).
--   3. preview_referral (anon): plafon GLOBAL 600/15min anti-enumerare de
--      coduri. Peste plafon: {valid:false, rate_limited:true} — landing-ul
--      degradează la „cod necunoscut", nu eroare. (Nu există IP în RPC;
--      plafonul global e acceptabil la traficul actual și oprește scanarea.)
--
-- Nota: cele două record_* nu au azi NICIUN apelant în src/ — dar sunt
-- granted anon din mig 013, deci suprafața există pentru oricine cu URL-ul
-- PostgREST. Rămân granted (analytics-ul le poate refolosi), dar plafonate.
-- =============================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. record_qr_scan — lanț 013→261 (+ rate-limit per restaurant)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.record_qr_scan(
  p_restaurant_id uuid,
  p_qr_token_id   uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Validate the QR token exists and belongs to this restaurant
  if not exists (
    select 1 from public.qr_tokens
    where id = p_qr_token_id
      and restaurant_id = p_restaurant_id
      and is_active = true
  ) then
    -- Silently ignore invalid scans — don't reveal token info
    return;
  end if;

  -- RATE-LIMIT (mig 261): plafon generos per restaurant — un local aglomerat
  -- nu-l atinge; un script care umflă qr_scans, da. Peste plafon: skip tăcut
  -- (analytics, nu bani — fără erori pe suprafața publică).
  if not public.check_rate_limit('record_qr_scan', p_restaurant_id::text, 300, 15) then
    return;
  end if;

  insert into public.qr_scans (restaurant_id)
  values (p_restaurant_id);
end;
$$;

revoke all on function public.record_qr_scan(uuid, uuid) from public;
grant execute on function public.record_qr_scan(uuid, uuid) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. record_page_view — lanț 013→261 (+ rate-limit + validare product↔tenant)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.record_page_view(
  p_restaurant_id uuid,
  p_product_id    uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid := p_product_id;
begin
  -- Restaurant must exist and be active
  if not exists (
    select 1 from public.restaurants
    where id = p_restaurant_id and is_active = true
  ) then
    return;
  end if;

  -- RATE-LIMIT (mig 261): per restaurant, plafon dublu față de scan-uri
  -- (mai multe view-uri decât scanări per vizită). Skip tăcut peste plafon.
  if not public.check_rate_limit('record_page_view', p_restaurant_id::text, 600, 15) then
    return;
  end if;

  -- VALIDARE CROSS-TENANT (mig 261): un product_id care nu aparține
  -- restaurantului se ANULEAZĂ (nu respinge view-ul — semnalul agregat pe
  -- restaurant rămâne corect; poluarea per-produs a altui tenant moare).
  if v_product_id is not null and not exists (
    select 1 from public.products
    where id = v_product_id and restaurant_id = p_restaurant_id
  ) then
    v_product_id := null;
  end if;

  insert into public.page_views (restaurant_id, product_id)
  values (p_restaurant_id, v_product_id);
end;
$$;

revoke all on function public.record_page_view(uuid, uuid) from public;
grant execute on function public.record_page_view(uuid, uuid) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. preview_referral — lanț 097c→261 (+ plafon global anti-enumerare)
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- RATE-LIMIT GLOBAL (mig 261): fără IP în RPC, plafonul per-cod n-ar opri
  -- rotația de coduri — plafonul global (600/15min, mult peste traficul real
  -- al landing-ului) oprește scanarea. Peste plafon: „cod necunoscut" +
  -- marker, NU eroare (landing-ul degradează grațios).
  if not public.check_rate_limit('preview_referral', 'all', 600, 15) then
    return jsonb_build_object('valid', false, 'rate_limited', true);
  end if;

  select exists(
    select 1 from public.affiliates
     where referral_code = lower(btrim(p_referral_code)) and status = 'active'
  ) into v_exists;
  return jsonb_build_object('valid', v_exists, 'referral_code', lower(btrim(p_referral_code)));
end$$;

revoke all on function public.preview_referral(text) from public;
grant execute on function public.preview_referral(text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Aserții fail-closed
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_src text; v_fn text;
begin
  foreach v_fn in array array['record_qr_scan','record_page_view','preview_referral'] loop
    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_src is null then
      raise exception 'mig 261: % lipsește', v_fn; end if;
    if position('check_rate_limit' in v_src) = 0 then
      raise exception 'mig 261: rate-limit-ul lipsește din %', v_fn; end if;
  end loop;

  -- Validarea cross-tenant a rămas în record_page_view.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_page_view';
  if position('restaurant_id = p_restaurant_id' in v_src) = 0
     or position('v_product_id := null' in v_src) = 0 then
    raise exception 'mig 261: validarea product_id↔restaurant a regresat'; end if;

  -- Grant-urile anon rămân (suprafață publică asumată, acum plafonată).
  if not has_function_privilege('anon', 'public.record_qr_scan(uuid, uuid)', 'execute')
     or not has_function_privilege('anon', 'public.record_page_view(uuid, uuid)', 'execute')
     or not has_function_privilege('anon', 'public.preview_referral(text)', 'execute') then
    raise exception 'mig 261: un grant anon s-a pierdut la redefinire'; end if;
end $$;

commit;
