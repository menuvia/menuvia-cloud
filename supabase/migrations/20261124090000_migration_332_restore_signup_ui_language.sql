-- =============================================================================
-- Migration 332: contul creat după activarea limbilor își păstrează limba de la
-- înscriere și când mig 323 + 331 se aplică DUPĂ ce s-a înscris
-- =============================================================================
-- Problema (recenzia adversarială finală a activării, #391): activarea
-- (ENABLED_STAFF_LANGS = ro/en/fr/de) face posibilă înscrierea în engleză,
-- franceză și germană, iar clientul pune limba în `user_metadata.ui_lang`. Pe
-- producție (la 291 la scriere) coloana `profiles.ui_language` nu există încă,
-- deci un cont creat între publicarea clientului și aplicarea migrațiilor are
-- limba DOAR în metadata. La aplicare:
--   • 323 adaugă coloana cu `default 'ro'` → TOATE rândurile existente atunci,
--     inclusiv acest cont, primesc 'ro' (corect pentru conturile dinainte de
--     activare — decizia fondatorului);
--   • 331 completează din metadata DOAR rândurile cu `ui_language` null — al
--     nostru nu mai e null, deci limba lui de la înscriere se pierde.
-- Consecința: un patron francez înscris în franceză primește pe veci emailurile
-- de personal, push-urile și invitațiile în română (serverul citește profilul),
-- deși panoul, onboarding-ul și emailul de bun venit au fost în franceză.
-- Fraza din antetul 331 „Ordinea e liberă / practic un NO-OP” e falsă exact în
-- acest interval (331 nu se editează — e aplicată; corectura stă aici și în
-- CLAUDE.md).
--
-- Ce face: `restore_signup_ui_language(p_since)` (INVOKER, ZERO EXECUTE pentru
-- rolurile client — o rulează doar migrația, ca `postgres`) pune în profil limba
-- din metadata pentru conturile:
--   • create la sau după `p_since` (activarea limbilor: 2026-11-24) — conturile
--     dinainte rămân pe 'ro', decizia fondatorului;
--   • cu `ui_language = 'ro'` (exact ce le-a dat default-ul 323);
--   • cu `ui_lang` în metadata = 'en' / 'fr' / 'de' (aceeași gardă ca 331).
-- O alegere EXPLICITĂ a românei după înscriere nu e atinsă: comutatorul scrie
-- limba și în `user_metadata.ui_lang` (`useSetUiLanguage.syncAuthMetadata`),
-- deci un cont care a ales româna are 'ro' și în metadata. Rezidual consemnat:
-- dacă acea sincronizare best-effort a picat, o rulare a funcției ar readuce
-- limba de la înscriere — de aceea migrația o cheamă DOAR la PRIMA aplicare
-- (funcția nu exista înainte), nu la o re-aplicare (replay, `db push` peste o
-- aplicare prin MCP).
--
-- Pe producție 323 + 331 + 332 se aplică împreună: conturile din interval își
-- recapătă limba într-o singură trecere. Dacă migrațiile ajung pe producție
-- ÎNAINTEA clientului nou, intervalul e gol și apelul e un NO-OP. În CI baza e
-- goală la aplicare (apel fără efect); comportamentul îl țin SB1–SB6
-- (`tests/sql/auto/332_restore_signup_ui_language.sql`), care cheamă funcția.
--
-- Backfill FĂRĂ trigger dezactivat (RP7): pe profiles trag la UPDATE doar
-- `set_profiles_updated_at` (corect: rândul se schimbă), `trg_seed_platform_admin`
-- (`update of email` — neatins) și `trg_profiles_attribution_stripe_link`
-- (`update of stripe_customer_id` — neatins); `trg_profiles_block_client_write`
-- (262) respinge doar rolurile client, iar aici rulează `postgres`.
-- =============================================================================

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- Prima aplicare? Reținut ÎNAINTEA lui `create or replace` (vezi antetul).
select set_config('menuvia.mig332_fresh',
  (to_regprocedure('public.restore_signup_ui_language(timestamptz)') is null)::text,
  true);

create or replace function public.restore_signup_ui_language(p_since timestamptz)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  if p_since is null then
    raise exception 'restore_signup_ui_language: p_since e obligatoriu'
      using errcode = '22004';
  end if;
  update public.profiles p
     set ui_language = u.raw_user_meta_data->>'ui_lang'
    from auth.users u
   where u.id = p.id
     and u.created_at >= p_since
     and p.ui_language = 'ro'
     and u.raw_user_meta_data->>'ui_lang' in ('en', 'fr', 'de');
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.restore_signup_ui_language(timestamptz) is
  'mig 332: limba de la înscriere (user_metadata.ui_lang en/fr/de) pentru conturile create de la p_since pe care default-ul ro din mig 323 a acoperit-o. Doar postgres; chemată o dată, la prima aplicare a 332.';

revoke execute on function public.restore_signup_ui_language(timestamptz)
  from public, anon, authenticated, service_role;

-- Lacătul (SHARE ROW EXCLUSIVE, până la COMMIT) oprește pentru câteva
-- milisecunde scrierile pe profiles, ca asserția de mai jos să vadă exact
-- starea lăsată de reparație (paritate cu 331).
lock table public.profiles in share row exclusive mode;

do $$
begin
  if current_setting('menuvia.mig332_fresh', true) = 'true' then
    perform public.restore_signup_ui_language('2026-11-24 00:00:00+00'::timestamptz);
  end if;
end;
$$;

-- ── Asserții fail-closed ────────────────────────────────────────────────────
do $$
declare
  v_def text;
  v_cfg text[];
  v_left bigint;
begin
  select pg_get_functiondef(p.oid), p.proconfig
    into v_def, v_cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'restore_signup_ui_language';
  if v_def is null then
    raise exception 'mig 332: restore_signup_ui_language(timestamptz) lipsește';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'restore_signup_ui_language'
                and p.prosecdef) then
    raise exception 'mig 332: restore_signup_ui_language a devenit SECURITY DEFINER';
  end if;
  if v_cfg is null or not ('search_path=public, pg_temp' = any (v_cfg)) then
    raise exception 'mig 332: restore_signup_ui_language are search_path % (trebuia public, pg_temp)', v_cfg;
  end if;
  -- Ancorat pe EXPRESIA din cod, nu pe identificator (lecția 331).
  if position($q$p.ui_language = 'ro'$q$ in v_def) = 0
     or position($q$u.created_at >= p_since$q$ in v_def) = 0
     or position($q$in ('en', 'fr', 'de')$q$ in v_def) = 0 then
    raise exception 'mig 332: restore_signup_ui_language și-a pierdut una dintre gărzi (ro / p_since / en-fr-de)';
  end if;
  if has_function_privilege('anon', 'public.restore_signup_ui_language(timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.restore_signup_ui_language(timestamptz)', 'execute')
     or has_function_privilege('service_role', 'public.restore_signup_ui_language(timestamptz)', 'execute') then
    raise exception 'mig 332: restore_signup_ui_language e executabilă de un rol client';
  end if;

  if current_setting('menuvia.mig332_fresh', true) = 'true' then
    select count(*) into v_left
      from public.profiles p join auth.users u on u.id = p.id
     where u.created_at >= '2026-11-24 00:00:00+00'::timestamptz
       and p.ui_language = 'ro'
       and u.raw_user_meta_data->>'ui_lang' in ('en', 'fr', 'de');
    if v_left > 0 then
      raise exception 'mig 332: % conturi au rămas pe ro deși s-au înscris în en/fr/de', v_left;
    end if;
  end if;
end;
$$;

commit;
