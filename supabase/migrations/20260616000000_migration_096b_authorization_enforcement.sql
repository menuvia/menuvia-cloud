-- mig 096B — Authorization Lockdown PR 1B (enforcement)
--
-- Continuă PR 1A: revocă privilegiile directe de mutație pe restaurants /
-- restaurant_memberships / invite_tokens pentru rolurile aplicației, șterge
-- policy-urile non-SELECT pe care le supliniește acum RLS prin RPC, reasertă
-- guard-urile din 096A active, și adaugă `change_restaurant_slug` RPC pentru
-- a păstra fluxul legitim de schimbare slug din SettingsTab (slug nu intră în
-- whitelist-ul UPDATE column-level — schimbarea slug-ului este o operație
-- privilegiată cu validare de unicitate).
--
-- Securitate: zero GUC bypass. Bypass-ul guard-urilor în scriptul administrativ
-- (apply_ownership_remediation.sql) folosește per-trigger DISABLE/ENABLE, nu
-- session_replication_role. 096B NU re-creează guard-urile; doar asertă că
-- rămân active conectate la funcțiile corecte.
--
-- Compatibilitate front-end:
--   • UPDATE table-level revocat → fluxul de UPDATE pe restaurants merge prin
--     column-level GRANT pe whitelist-ul care oglindește exact
--     `RESTAURANT_UPDATE_FIELDS` (src/lib/sanitize.ts). `slug` este OMIS
--     deliberat din ambele liste (V9.12 decision §13) — schimbarea slug-ului
--     trece exclusiv prin `change_restaurant_slug` RPC.
--   • SettingsTab.tsx folosea direct .update({slug, ...}). Acel call site
--     migrează la `change_restaurant_slug` RPC în același PR.
--   • `restaurants.remove()` din useData.ts nu este apelat din UI (verificat
--     prin grep), așa că REVOKE DELETE nu rupe niciun call site.
--
-- Idempotency: drop policy IF EXISTS, revoke IF EXISTS, drop function IF EXISTS
-- pe RPC nou (pattern din alte migrații recente). Inline pre-check global
-- invariant abort-ează dacă state-ul DB-ului nu e curat.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 1. Lock ordine deterministă pentru a evita deadlock-uri cu RPC-urile
--   din 096A care iau lock-uri pe aceste tabele în aceeași ordine.
-- ═══════════════════════════════════════════════════════════════════════════
lock table public.restaurants            in share row exclusive mode;
lock table public.restaurant_memberships in share row exclusive mode;
lock table public.invite_tokens          in share row exclusive mode;

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 2. Pre-check global ownership invariant
--   Toate restaurantele trebuie să aibă exact 1 owner membership aliniat cu
--   restaurants.owner_id. Dacă există anomalii, scriptul administrativ
--   apply_ownership_remediation.sql trebuie rulat ÎNAINTE de 096B.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare v_anomalies int;
begin
  select count(*) into v_anomalies
  from public.restaurants r
  where (
    select count(*) from public.restaurant_memberships rm
     where rm.restaurant_id = r.id and rm.role = 'owner'::public.member_role
  ) <> 1
     or not exists (
       select 1 from public.restaurant_memberships rm
        where rm.restaurant_id = r.id
          and rm.role = 'owner'::public.member_role
          and rm.user_id = r.owner_id
     );
  if v_anomalies > 0 then
    raise exception '096B PRE-CHECK FAIL: % restaurants have inconsistent owner state. Run scripts/apply_ownership_remediation.sql first.',
      v_anomalies;
  end if;
end$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 3. Drop policy-uri non-SELECT pe cele trei tabele
--   `restaurants_owner` FOR ALL → permitea INSERT/DELETE proprietarului;
--      înlocuit cu RPC-urile create_restaurant (INSERT) + admin script (DELETE
--      not exposed in 1A/1B).
--   `restaurants: admin update` FOR UPDATE → eliminat aici; UPDATE merge prin
--      column-level GRANT (Sec 5) gated implicit prin RLS-ul rămas
--      `restaurants: member read` + ownership efectiv în query.
--      ATENȚIE: column-level GRANT nu este RLS — orice authenticated user
--      poate teoretic UPDATE pe whitelist-ul de coloane pe ORICE rând.
--      Pentru a păstra restricția per-restaurant, introducem o policy nouă
--      `restaurants: admin update via RLS` (Sec 4) ce limitează prin is_admin.
--   `rms: admin all` → eliminat; mutațiile pe memberships merg prin
--      change_member_role / remove_member RPC-uri (096A).
--   `invites: admin all` → eliminat; mutațiile pe invites merg prin
--      send-invite netlify function (server-side via service_role) +
--      revoke_invite RPC (096A).
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists "restaurants_owner"          on public.restaurants;
drop policy if exists "restaurants: admin update"  on public.restaurants;
drop policy if exists "rms: admin all"             on public.restaurant_memberships;
drop policy if exists "invites: admin all"         on public.invite_tokens;

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 4. Re-create restaurants admin UPDATE policy (RLS)
--   Limitează UPDATE la admin (owner via restaurants.owner_id sau manager via
--   membership) — combinat cu column-level GRANT din Sec 5, asta restrânge
--   atât setul de rânduri (RLS) cât și setul de coloane (privilege).
-- ═══════════════════════════════════════════════════════════════════════════
create policy "restaurants: admin update"
  on public.restaurants
  for update
  to authenticated
  using (public.is_admin(id))
  with check (public.is_admin(id));

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 5. REVOKE table-level + column-level GRANT whitelist
--   PUBLIC + anon + authenticated → zero IUD direct pe restaurants /
--   memberships / invites.
--   authenticated păstrează SELECT (prin policy) + UPDATE column-level pe
--   whitelist-ul derivat din RESTAURANT_UPDATE_FIELDS.
--
--   Whitelist GRANT UPDATE pe restaurants (21 coloane):
--     name, tagline, city, description, address, phone, hours,
--     hours_structured, timezone, wifi_password, primary_color, logo_url,
--     cover_url, floor_layout, socials, amenities,
--     checkout_suggestion_settings, theme_settings, pickup_settings,
--     google_place_id, google_review_url
--
--   EXCLUSE explicit (per V9.12 §13):
--     • owner_id  — guard fail-closed la modificare (096A trigger);
--     • slug      — schimbare prin change_restaurant_slug RPC (Sec 7);
--     • id, created_at, updated_at  — system-controlled;
--     • currency, tax_included, language, is_active, business_type,
--       qr_token — fie billing/entitlement, fie controlate de UI specific
--       (admin tools), neexpuse în SettingsTab.
-- ═══════════════════════════════════════════════════════════════════════════
revoke insert, update, delete, references, truncate, trigger
  on table public.restaurants from public, anon, authenticated;
revoke insert, update, delete, references, truncate, trigger
  on table public.restaurant_memberships from public, anon, authenticated;
revoke insert, update, delete, references, truncate, trigger
  on table public.invite_tokens from public, anon, authenticated;

grant update (
  name, tagline, city, description, address, phone, hours,
  hours_structured, timezone, wifi_password, primary_color, logo_url,
  cover_url, floor_layout, socials, amenities,
  checkout_suggestion_settings, theme_settings, pickup_settings,
  google_place_id, google_review_url
) on table public.restaurants to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 6. Reasertă guard-urile active (NU le re-creează)
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare v_tgtype int;
begin
  -- Guard membership: tgtype = ROW(1)|BEFORE(2)|INSERT(4)|DELETE(8)|UPDATE(16) = 31
  select t.tgtype into v_tgtype from pg_trigger t
   where t.tgrelid = 'public.restaurant_memberships'::regclass
     and t.tgname  = 'trg_block_owner_membership_mutation'
     and not t.tgisinternal
     and t.tgenabled in ('O','A')
     and t.tgfoid   = 'public.fn_block_owner_membership_mutation()'::regprocedure;
  if not found then
    raise exception '096B FAIL: trg_block_owner_membership_mutation missing/disabled/wrong function';
  end if;
  if v_tgtype <> 31 then
    raise exception '096B FAIL: guard tgtype=% expected 31', v_tgtype;
  end if;

  -- Guard owner_id immutability: BEFORE UPDATE row
  select t.tgtype into v_tgtype from pg_trigger t
   where t.tgrelid = 'public.restaurants'::regclass
     and t.tgname  = 'trg_restaurants_owner_id_immutable'
     and not t.tgisinternal
     and t.tgenabled in ('O','A')
     and t.tgfoid   = 'public.fn_restaurants_owner_id_immutable()'::regprocedure;
  if not found then
    raise exception '096B FAIL: trg_restaurants_owner_id_immutable missing/disabled/wrong function';
  end if;
end$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 7. change_restaurant_slug RPC
--   Slug schimbare admin-only, validează unicitate prin try-INSERT pattern
--   (FOR UPDATE pe rând + check UNIQUE existent). SECURITY DEFINER cu
--   search_path strict; REVOKE PUBLIC/anon/service_role, GRANT authenticated.
-- ═══════════════════════════════════════════════════════════════════════════
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

  -- Conflict check (early, friendlier than UNIQUE violation)
  if exists (
    select 1 from public.restaurants
     where slug = v_new_slug and id <> p_restaurant_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'slug_taken', 'slug', v_new_slug);
  end if;

  -- TOCTOU safety net: între `exists` check și UPDATE există o fereastră în care
  -- alt session poate INSERT-ui exact acest slug. UNIQUE(restaurants.slug) prinde
  -- duplicarea, dar fără handler-ul ăsta clientul ar primi 23505 în loc de
  -- contractul `{ok:false, reason:'slug_taken'}`.
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

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 8. Inline A1-A7 final-state assertions înainte de COMMIT
--   Set complet în tests/sql/authorization_final_state_assertions.sql; aici
--   doar smoke critice care fail-closed migrația.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare v_role text;
begin
  -- IUD direct pe cele trei tabele = ZERO pentru rolurile aplicației
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if has_table_privilege(v_role, 'public.restaurants',
                           'INSERT, DELETE, REFERENCES, TRUNCATE, TRIGGER') then
      raise exception '096B FAIL: % retains non-UPDATE table privilege on restaurants', v_role;
    end if;
    if has_table_privilege(v_role, 'public.restaurant_memberships',
                           'INSERT, UPDATE, DELETE') then
      raise exception '096B FAIL: % retains IUD on restaurant_memberships', v_role;
    end if;
    if has_table_privilege(v_role, 'public.invite_tokens',
                           'INSERT, UPDATE, DELETE') then
      raise exception '096B FAIL: % retains IUD on invite_tokens', v_role;
    end if;
  end loop;

  -- authenticated trebuie să aibă UPDATE pe coloanele whitelisted
  if not has_column_privilege('authenticated', 'public.restaurants', 'name', 'UPDATE') then
    raise exception '096B FAIL: authenticated lost UPDATE on restaurants.name';
  end if;
  if not has_column_privilege('authenticated', 'public.restaurants', 'primary_color', 'UPDATE') then
    raise exception '096B FAIL: authenticated lost UPDATE on restaurants.primary_color';
  end if;

  -- authenticated NU mai are UPDATE pe owner_id sau slug
  if has_column_privilege('authenticated', 'public.restaurants', 'owner_id', 'UPDATE') then
    raise exception '096B FAIL: authenticated retains UPDATE on restaurants.owner_id';
  end if;
  if has_column_privilege('authenticated', 'public.restaurants', 'slug', 'UPDATE') then
    raise exception '096B FAIL: authenticated retains UPDATE on restaurants.slug';
  end if;

  -- change_restaurant_slug acordat doar la authenticated; PUBLIC EXECUTE zero
  if not has_function_privilege('authenticated',
       'public.change_restaurant_slug(uuid,text)'::regprocedure, 'EXECUTE') then
    raise exception '096B FAIL: authenticated lost EXECUTE on change_restaurant_slug';
  end if;
  if exists (
    select 1 from pg_proc p, aclexplode(p.proacl) ae
     where p.oid = 'public.change_restaurant_slug(uuid,text)'::regprocedure
       and ae.grantee = 0 and ae.privilege_type = 'EXECUTE'
  ) then
    raise exception '096B FAIL: PUBLIC retains EXECUTE on change_restaurant_slug';
  end if;
end$$;

commit;
