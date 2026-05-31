-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 049 — Public menu editorial fields
-- ═══════════════════════════════════════════════════════════════
-- Adaugă coloanele pentru noul design "editorial" al meniului public
-- (hero glass-morphism, ore per zi, amenities, social links).
-- Tot ce e afișat NEW pe /m/{slug} trebuie să poată fi editat din
-- Dashboard Settings, fără cod custom per restaurant.
--
-- Idempotent: poate fi rulat de mai multe ori fără erori.

alter table public.restaurants
  add column if not exists socials jsonb not null default '{}'::jsonb,
  add column if not exists amenities text[] not null default '{}'::text[],
  add column if not exists hours_structured jsonb,
  add column if not exists wifi_password text,
  add column if not exists timezone text not null default 'Europe/Bucharest';

comment on column public.restaurants.socials is
  'JSON cu link-uri social: { instagram, facebook, tiktok, website }. Valori opționale (string|null).';
comment on column public.restaurants.amenities is
  'Array enum cu facilități: wifi, vegan_options, outdoor_seating, parking, cards, reservations, pet_friendly. Afișate ca pills în hero.';
comment on column public.restaurants.hours_structured is
  'JSON cu program detaliat per zi: { mon:{open:"08:00",close:"23:00",closed:false}, tue:{...}, ... }. Folosit pentru a computa is_open client-side. Coloana hours (text) rămâne fallback pentru afișare liberă.';
comment on column public.restaurants.wifi_password is
  'Parola WiFi afișată în meniu (opțional). Doar text plain — nu sensibil.';
comment on column public.restaurants.timezone is
  'IANA timezone pentru calcul is_open. Default Europe/Bucharest.';

-- Meta sub titlul categoriei (ex: "Servit până la ora 13:00")
alter table public.categories
  add column if not exists meta_text text;

comment on column public.categories.meta_text is
  'Text mic italic afișat sub titlul categoriei pe meniul public. Opțional.';
