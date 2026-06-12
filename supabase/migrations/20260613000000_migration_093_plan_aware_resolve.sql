-- Migration 093: orderingAllowed verifică PLANUL + expune link-urile în resolve
-- ─────────────────────────────────────────────────────────────────────
-- Bug real (audit „aceleași QR-uri pe ambele planuri", 2026-06-12):
-- resolve_qr_token (ultima definiție: mig 024) calcula orderingAllowed DOAR
-- din restaurant_settings.ordering_enabled — fără să verifice planul.
-- Pe Meniu Digital (starter), clientul vedea coșul, butoanele „Adaugă",
-- „Cheamă ospătarul", „Cere nota", completa comanda... și primea eroare de
-- server abia la submit (Gate A, mig 083, respinge la INSERT).
--
-- Fix: orderingAllowed = ordering_enabled (kill-switch manual, păstrat)
--                        AND plan_features 'order_qr' enabled pe planul
--                        restaurantului (cheia REALĂ, verificată în mig 028
--                        seeds + mig 083 mapping: starter/free=false,
--                        growth/pro/enterprise=true).
--
-- Efect comercial: ACELAȘI QR funcționează pe ambele planuri —
--   Meniu Digital  → meniu de citit, curat, fără butoane de comandă
--   Meniu + Comenzi→ aceleași QR-uri activează comenzile, zero re-printare
--
-- Bonus (decizie user): expunem `socials` (jsonb, mig 049) +
-- `google_review_url` în payload-ul de restaurant — pagina QR afișează
-- bară de link-uri (Maps/Instagram/Facebook/Website/WhatsApp/Telefon).
-- REFOLOSIM socials jsonb existent — ZERO coloane noi; extindem doar
-- convenția de chei cu google_maps + whatsapp (phone există din base_schema).
-- ─────────────────────────────────────────────────────────────────────

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
  v_plan_ok    boolean := false;
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
    'socials',                       r.socials,
    'google_review_url',             r.google_review_url,
    'checkout_suggestion_settings',  r.checkout_suggestion_settings,
    'theme_settings',                r.theme_settings
  ) into v_restaurant
  from public.restaurants r
  where r.id = v_qr.restaurant_id and r.is_active = true;

  if v_restaurant is null then return null; end if;

  -- Kill-switch manual (restaurant_settings) — neschimbat din mig 022/024.
  select coalesce(rs.ordering_enabled, true) into v_ordering
  from public.restaurant_settings rs
  where rs.restaurant_id = v_qr.restaurant_id;

  -- ★ Gate de plan (mig 093): feature 'order_qr' pe planul owner-ului.
  -- Același pattern ca trigger-ul Gate A (mig 083) — UI-ul și serverul
  -- spun acum ACELAȘI lucru, clientul nu mai vede butoane care eșuează.
  select coalesce(pf.enabled, false) into v_plan_ok
  from public.restaurants r
  join public.profiles pr on pr.id = r.owner_id
  left join public.plan_features pf
         on pf.plan = pr.plan and pf.feature = 'order_qr'
  where r.id = v_qr.restaurant_id;

  return jsonb_build_object(
    'token',           to_jsonb(v_qr),
    'table',           to_jsonb(v_table),
    'restaurant',      v_restaurant,
    'orderingAllowed', coalesce(v_ordering, true) and coalesce(v_plan_ok, false)
  );
end;
$$;

grant execute on function public.resolve_qr_token(text) to anon, authenticated;

-- Convenția de chei extinsă pe socials (jsonb existent, mig 049):
comment on column public.restaurants.socials is
  'JSON cu link-uri: { instagram, facebook, tiktok, website, google_maps, whatsapp }. Valori opționale (string|null). Afișate pe meniul public/QR doar dacă sunt completate.';

-- Verificare manuală (post-deploy):
-- select public.resolve_qr_token('<token-de-pe-un-restaurant-starter>')
--   -> orderingAllowed = false, restaurant.socials prezent
