-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 024 — Theme settings per restaurant
-- ═══════════════════════════════════════════════════════════════
-- Owner alege o temă predefinită din 8 (Cafe, Pizzeria, FineDining, ...)
-- și opțional un accent color override (Growth+).
-- Public read ca să poată anon afișa meniul cu tema corectă.

alter table public.restaurants
  add column if not exists theme_settings jsonb
  default '{
    "preset_id": "cafe",
    "accent_override": null
  }'::jsonb;

comment on column public.restaurants.theme_settings is
  'Tema vizuală a meniului QR. preset_id ∈ {cafe, pizzeria, fine-dining, pub, mexican, asian, healthy, mediterranean}. accent_override e opțional (Growth+).';

-- Update resolve_qr_token to include theme_settings in restaurant payload
create or replace function public.resolve_qr_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qr         public.qr_tokens%rowtype;
  v_table      public.tables%rowtype;
  v_restaurant jsonb;
  v_ordering   boolean := true;
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

  return jsonb_build_object(
    'token',           to_jsonb(v_qr),
    'table',           to_jsonb(v_table),
    'restaurant',      v_restaurant,
    'orderingAllowed', coalesce(v_ordering, true)
  );
end;
$$;

grant execute on function public.resolve_qr_token(text) to anon, authenticated;
