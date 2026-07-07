-- ═══════════════════════════════════════════════════════════════════
-- Migration 206: resolve_qr_token expune currency + menu_languages
-- ─────────────────────────────────────────────────────────────────────
-- Două goluri în proiecția publică a clientului QR (whitelist mig 127):
--   • `menu_languages` — fast-follow-ul notat în qr.ts la mig 197: fără el,
--     switcher-ul de limbi era ASCUNS pe pagina QR (parseMenuLanguages → []).
--   • `currency` — activată în mig 205; fără ea, fmtPrice cade pe RON și
--     un local internațional ar afișa prețuri fără monedă corectă pe QR.
-- Redefinire = COPIE EXACTĂ a mig 127 (gate-ul de plan `order_qr` inclus,
-- asserție mai jos) + cele 2 câmpuri noi în jsonb_build_object.
-- get_restaurant_by_slug NU se atinge aici: currency e deja în proiecția lui
-- (mig 148); menu_languages ajunge la meniul public prin fluxul lui existent.
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.resolve_qr_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_qr         public.qr_tokens%rowtype;
  v_table      public.tables%rowtype;
  v_restaurant jsonb;
  v_ordering   boolean := true;
  v_feature    boolean := false;
begin
  select * into v_qr
  from public.qr_tokens
  where token = p_token and is_active = true;

  if not found then return null; end if;

  if v_qr.expires_at is not null and v_qr.expires_at < now() then
    return null;
  end if;

  select * into v_table
  from public.tables
  where id = v_qr.table_id;

  if not found then return null; end if;

  select jsonb_build_object(
    'id',                            r.id,
    'name',                          r.name,
    'primary_color',                 r.primary_color,
    'logo_url',                      r.logo_url,
    'address',                       r.address,
    'phone',                         r.phone,
    'hours',                         r.hours,
    'checkout_suggestion_settings',  r.checkout_suggestion_settings,
    'theme_settings',                r.theme_settings,
    -- mig 206: limba + moneda meniului — publice prin definiție (apar pe
    -- meniul fizic oricum); restul coloanelor rămân în afara proiecției.
    'menu_languages',                r.menu_languages,
    'currency',                      r.currency
  ) into v_restaurant
  from public.restaurants r
  where r.id = v_qr.restaurant_id and r.is_active = true;

  if v_restaurant is null then return null; end if;

  select coalesce(rs.ordering_enabled, true) into v_ordering
  from public.restaurant_settings rs
  where rs.restaurant_id = v_qr.restaurant_id;

  -- Gate de plan (mig 127): comanda QR e Plan 2+ (feature order_qr). Inline pe
  -- plan_features ca enforce_feature_for_restaurant, ca sa mearga si pe anon.
  select coalesce(pf.enabled, false) into v_feature
  from public.restaurants r
  join public.profiles pr on pr.id = r.owner_id
  left join public.plan_features pf on pf.plan = pr.plan and pf.feature = 'order_qr'
  where r.id = v_qr.restaurant_id;

  return jsonb_build_object(
    'token',           to_jsonb(v_qr),
    'table',           to_jsonb(v_table),
    'restaurant',      v_restaurant,
    'orderingAllowed', coalesce(v_ordering, true) and coalesce(v_feature, false)
  );
end;
$function$;

grant execute on function public.resolve_qr_token(text) to anon, authenticated;

-- ── Asserții fail-closed: gate-ul de plan a supraviețuit + câmpurile noi ──
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.resolve_qr_token(text)'::regprocedure);
  if position('order_qr' in v_def) = 0 then
    raise exception 'ASSERT FAIL: redefinirea a pierdut gate-ul de plan order_qr (mig 127)';
  end if;
  if position('menu_languages' in v_def) = 0 or position('currency' in v_def) = 0 then
    raise exception 'ASSERT FAIL: proiecția nu conține menu_languages + currency';
  end if;
end $$;

commit;
