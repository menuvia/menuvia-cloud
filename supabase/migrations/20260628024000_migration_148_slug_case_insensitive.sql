-- mig 148 — slug case-insensitive end-to-end (#4)
-- ─────────────────────────────────────────────────────────────────────
-- Auditul round-4 (#4). Rutarea pe slug era inconsecventă pe case:
--   • `create_restaurant` (mig 096a) accepta `p_slug` cu MAJUSCULE (doar btrim, fără
--     lower) și verifica unicitatea case-sensitive (`slug = v_slug`);
--   • `change_restaurant_slug` (mig 096b) normaliza la lowercase;
--   • `get_restaurant_by_slug` (mig 015) compara case-sensitive (`r.slug = p_slug`);
--   • indexul `restaurants_lower_slug_idx` (mig 075) era NON-unic.
-- Rezultat: 'MyResto' și 'myresto' puteau coexista → coliziune de rutare (meniul public
-- prin lower(slug) putea găsi 2 rânduri; get_restaurant_by_slug returna doar varianta
-- exact-case). Forțăm slug 100% lowercase + unicitate case-insensitive la nivel de index.
--
-- (a) Remediere date: lowercase toate slug-urile + dezambiguizare deterministă a
--     coliziunilor (-2/-3..., ordonat by created_at). Parcăm întâi pe valori temporare
--     unice ca să evităm coliziuni tranzitorii pe UNIQUE(slug) în timpul update-ului.
-- (b) Index: înlocuim indexul NON-unic cu UNIQUE pe lower(slug).
-- (c) Normalizare în create_restaurant + change_restaurant_slug (lowercase + unicitate
--     case-insensitive).
-- (d) get_restaurant_by_slug: comparație lower(r.slug)=lower(p_slug), shape identic.
-- (e) NU recreăm create_reservation_public (mig 074 face deja lower(slug)).
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── (a) Remediere: lowercase + dezambiguizare coliziuni ──────────────────────
do $$
declare
  r       record;
  v_final text;
  v_n     int;
begin
  create temp table _slug_remap on commit drop as
    select id,
           regexp_replace(lower(slug), '[^a-z0-9]+', '-', 'g') as base,
           row_number() over (partition by lower(slug) order by created_at, id) as rn
      from public.restaurants;

  -- normalizează base (fără leading/trailing '-'; fallback dacă devine gol)
  update _slug_remap set base = btrim(base, '-');
  update _slug_remap set base = 'r-' || substring(id::text, 1, 8) where base = '';

  -- parchează tot pe valori unice temporare (anti coliziune tranzitorie)
  update public.restaurants set slug = 'tmpslug-' || id::text;

  -- atribuie slug-urile finale, în ordine, evitând coliziunile deja atribuite
  for r in select id, base, rn from _slug_remap order by rn, id loop
    if r.rn = 1 then
      v_final := r.base;
    else
      v_final := r.base || '-' || r.rn::text;
    end if;
    v_n := r.rn;
    while exists (
      select 1 from public.restaurants
       where lower(slug) = v_final and id <> r.id
    ) loop
      v_n := v_n + 1;
      v_final := r.base || '-' || v_n::text;
    end loop;
    update public.restaurants set slug = v_final where id = r.id;
  end loop;
end $$;

-- asserție: zero coliziuni case-insensitive după remediere
do $$
declare v_dups int;
begin
  select count(*) into v_dups from (
    select 1 from public.restaurants group by lower(slug) having count(*) > 1
  ) d;
  if v_dups > 0 then
    raise exception 'mig 148: % grupuri de slug duplicate (case-insensitive) rămase', v_dups;
  end if;
end $$;

-- ── (b) Index UNIQUE pe lower(slug) (înlocuiește indexul non-unic mig 075) ────
drop index if exists public.restaurants_lower_slug_idx;
create unique index if not exists restaurants_lower_slug_uidx
  on public.restaurants (lower(slug));

-- ── (c) create_restaurant: normalizare lowercase + unicitate case-insensitive ─
create or replace function public.create_restaurant(
  p_name text,
  p_city text default null,
  p_slug text default null,
  p_primary_color text default '#C8963C'
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_id   uuid;
  v_slug text;
begin
  if v_uid is null then
    raise exception using errcode = 'insufficient_privilege',
      message = 'create_restaurant requires authentication';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception using errcode = 'check_violation', message = 'name is required';
  end if;

  -- #4 (mig 148): normalizează slug-ul (inclusiv cel furnizat de user) la lowercase.
  v_slug := coalesce(nullif(btrim(p_slug), ''), lower(p_name));
  v_slug := regexp_replace(lower(v_slug), '[^a-z0-9]+', '-', 'g');
  v_slug := btrim(v_slug, '-');
  if v_slug = '' then
    v_slug := 'r-' || substring(gen_random_uuid()::text, 1, 8);
  end if;
  -- unicitate CASE-INSENSITIVE (v_slug e deja lowercase)
  while exists (select 1 from public.restaurants where lower(slug) = v_slug) loop
    v_slug := v_slug || '-' || substring(gen_random_uuid()::text, 1, 4);
  end loop;

  insert into public.restaurants (owner_id, name, city, slug, primary_color)
  values (v_uid, btrim(p_name), nullif(btrim(p_city), ''), v_slug, p_primary_color)
  returning id into v_id;

  return jsonb_build_object('ok', true,
                            'restaurant_id', v_id,
                            'restaurant_slug', v_slug);
end$$;

revoke all on function public.create_restaurant(text, text, text, text)
  from public, anon, service_role;
grant execute on function public.create_restaurant(text, text, text, text)
  to authenticated;

-- ── (c) change_restaurant_slug: conflict check case-insensitive ───────────────
create or replace function public.change_restaurant_slug(
  p_restaurant_id uuid,
  p_new_slug text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_new_slug  text;
  v_existing  text;
begin
  if v_uid is null then
    raise exception using errcode = 'insufficient_privilege',
      message = 'change_restaurant_slug requires authentication';
  end if;
  if p_new_slug is null or btrim(p_new_slug) = '' then
    raise exception using errcode = 'check_violation',
      message = 'slug is required';
  end if;
  if not public.is_admin(p_restaurant_id) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'not an admin';
  end if;

  -- Normalize: lowercase, alphanumeric + hyphens, no leading/trailing hyphens
  v_new_slug := regexp_replace(lower(btrim(p_new_slug)), '[^a-z0-9]+', '-', 'g');
  v_new_slug := btrim(v_new_slug, '-');
  if v_new_slug = '' or length(v_new_slug) < 2 then
    raise exception using errcode = 'check_violation',
      message = 'slug too short after normalization';
  end if;

  -- Conflict check CASE-INSENSITIVE (early, friendlier than UNIQUE violation)
  if exists (
    select 1 from public.restaurants
     where lower(slug) = v_new_slug and id <> p_restaurant_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'slug_taken', 'slug', v_new_slug);
  end if;

  begin
    update public.restaurants
       set slug = v_new_slug
     where id = p_restaurant_id
     returning slug into v_existing;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'reason', 'slug_taken', 'slug', v_new_slug);
  end;
  if not found then
    raise exception using errcode = 'no_data_found', message = 'restaurant not found';
  end if;

  return jsonb_build_object('ok', true, 'restaurant_id', p_restaurant_id, 'slug', v_existing);
end$$;

revoke all on function public.change_restaurant_slug(uuid, text)
  from public, anon, service_role;
grant execute on function public.change_restaurant_slug(uuid, text)
  to authenticated;

-- ── (d) get_restaurant_by_slug: comparație case-insensitive ───────────────────
-- Recreare din corpul EFECTIV curent (mig 054, returns TABLE, language sql), VERBATIM,
-- cu singura schimbare `lower(r.slug) = lower(p_slug)`. Return type IDENTIC → or replace OK.
create or replace function public.get_restaurant_by_slug(p_slug text)
returns table (
  id                uuid,
  name              text,
  slug              text,
  description       text,
  tagline           text,
  address           text,
  phone             text,
  hours             text,
  logo_url          text,
  cover_url         text,
  primary_color     text,
  is_active         boolean,
  qr_token          text,
  currency          text,
  tax_included      boolean,
  language          text,
  socials           jsonb,
  amenities         text[],
  hours_structured  jsonb,
  wifi_password     text,
  timezone          text,
  theme_settings    jsonb,
  pickup_settings   jsonb,
  google_review_url text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    r.id, r.name, r.slug, r.description, r.tagline, r.address, r.phone,
    r.hours, r.logo_url, r.cover_url, r.primary_color, r.is_active,
    r.qr_token, r.currency, r.tax_included, r.language,
    r.socials, r.amenities, r.hours_structured, r.wifi_password, r.timezone,
    r.theme_settings, r.pickup_settings, r.google_review_url
  from public.restaurants r
  where lower(r.slug) = lower(p_slug)
    and r.is_active = true
  limit 1;
$$;

revoke all on function public.get_restaurant_by_slug(text) from public;
grant execute on function public.get_restaurant_by_slug(text) to anon, authenticated;

-- ── Asserții fail-closed ─────────────────────────────────────────────────────
do $$
declare
  v_uidx int;
  v_src  text;
begin
  -- indexul UNIQUE pe lower(slug) există
  select count(*) into v_uidx
    from pg_indexes
   where schemaname = 'public' and tablename = 'restaurants'
     and indexname = 'restaurants_lower_slug_uidx';
  if v_uidx <> 1 then
    raise exception 'mig 148: indexul UNIQUE restaurants_lower_slug_uidx lipsește';
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_restaurant_by_slug';
  if position('lower(r.slug)' in v_src) = 0 then
    raise exception 'mig 148: get_restaurant_by_slug nu compară case-insensitive';
  end if;

  raise notice 'mig 148: slug case-insensitive (remediere + unique index + RPC normalize) OK';
end $$;

commit;
