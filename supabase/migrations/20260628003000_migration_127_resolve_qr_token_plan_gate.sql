-- mig 127 — Fix P3 (gate-leak UI): resolve_qr_token gate orderingAllowed pe plan (QR-ORD-1)
--
-- Auditul rundei 2 (public_qr). resolve_qr_token (mig 024, anon) intorcea
-- orderingAllowed = coalesce(ordering_enabled, true) FARA gate de plan. Comanda QR
-- e Plan 2+ (feature order_qr, mig 083; create_order o impune oricum server-side via
-- Gate A). Dar pe Plan 1 (free/starter, order_qr=false) clientul public primea
-- orderingAllowed=true => UI-ul de comanda se activa inutil, iar incercarea de comanda
-- esua abia la create_order. Aliniem semnalul UI cu realitatea server-side.
--
-- Fix: recreez resolve_qr_token (verbatim din DB) + AND cu featurea order_qr a planului.
-- Verificarea e INLINE pe plan_features (ca enforce_feature_for_restaurant), ca sa ruleze
-- corect si pentru apelantul anon, fara dependenta de grant pe restaurant_has_feature.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '60s';

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
    'theme_settings',                r.theme_settings
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

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='resolve_qr_token' limit 1;
  if v_def is null or position('order_qr' in v_def) = 0 then
    raise exception 'mig 127: resolve_qr_token nu gate-uieste order_qr';
  end if;
  raise notice 'mig 127: resolve_qr_token orderingAllowed gate-uit pe order_qr OK';
end $$;

commit;
