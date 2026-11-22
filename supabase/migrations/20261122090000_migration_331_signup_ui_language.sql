-- =============================================================================
-- Migration 331: contul NOU pornește în limba în care s-a înregistrat
-- (precondiția B1 a activării englezei, francezei și germanei pentru personal)
-- =============================================================================
-- Problema: mig 323 a lăsat conturile noi cu `profiles.ui_language = null`
-- („clientul decide”), iar `handle_new_user` (definit O SINGURĂ DATĂ, în
-- schema de bază) inserează doar `(id, email, full_name)`. Clientul pune însă
-- limba ecranului în `user_metadata.ui_lang` la signUp (AuthPage, InviteAccept-
-- Page — SW9), pe care SQL-ul n-o citea nicăieri. Consecința, la activarea
-- limbilor:
--   • panoul unui cont nou urmează stocarea dispozitivului sau BROWSERUL, dar
--     serverul (send-push.js, process-email-queue.js, send-invite.js) vede
--     `null` și scrie în română: un ospătar german pe ecranul de bucătărie în
--     germană primește „🔔 Comandă nouă”, un patron englez primește toate
--     emailurile de personal în română;
--   • un român cu browserul în engleză, înregistrat pe menuvia.ro după 323,
--     s-ar trezi cu panoul în engleză în ziua activării — exact ce a refuzat
--     fondatorul pentru conturile existente („rămân în română”).
--
-- Ce face:
--   1. `handle_new_user` = definiția din schema de bază, VERBATIM, plus
--      `ui_language` = `raw_user_meta_data->>'ui_lang'` DOAR dacă e exact una
--      dintre cele patru limbi ale CHECK-ului din 323; orice altceva ('xx',
--      'FR', '', număr JSON, metadata ne-obiect, cheie lipsă) → `null`, ca
--      înainte. Garda e în expresie, NU în CHECK: o valoare invalidă care ar
--      ajunge la CHECK ar face INSERT-ul să pice, adică SIGNUP-ul să pice.
--   2. Backfill: conturile cu `ui_language` null primesc limba din metadata
--      (aceeași regulă), altfel 'ro' — intenția declarată a lui 323 pentru
--      conturile existente. Pe producție (la 291 la scriere) 323 și 331 se
--      aplică împreună, deci backfill-ul e practic un NO-OP; contează pe orice
--      bază unde 323 a stat aplicată singură.
--
-- `null` rămâne o stare LEGITIMĂ după migrație: contul poate reveni la
-- „nealeasă” (UL1), iar un cont creat fără metadata (alt client, admin API)
-- pornește tot cu null (UL5 din 323 rămâne adevărat). De aceea NU există un
-- invariant permanent „zero null”; asserția de mai jos verifică backfill-ul o
-- singură dată, la aplicare.
--
-- Backfill-ul e un UPDATE simplu, FĂRĂ trigger dezactivat (RP7 cere zero
-- trigger-e dezactivate, și n-ar avea ce proteja). Pe profiles trag la UPDATE
-- doar `set_profiles_updated_at` (mută `updated_at` — corect: rândul chiar s-a
-- schimbat, iar coloana n-are niciun cititor), `trg_seed_platform_admin`
-- (`update of email` — neatins) și `trg_profiles_attribution_stripe_link`
-- (`update of stripe_customer_id` — neatins).
--
-- Suprafața: `create or replace` cu ACEEAȘI semnătură păstrează ACL-ul viu
-- (279 a scos EXECUTE pentru anon/authenticated — o funcție de trigger nu e
-- apelabilă prin /rpc, clichetul RP13), dar revoke-ul e re-afirmat explicit
-- per rol. `set search_path = public, pg_temp` e scris EXPLICIT: `create or
-- replace` rescrie `proconfig`, deci pg_temp-ul pus de 262 prin ALTER s-ar
-- pierde tăcut. SECURITY DEFINER rămâne (inserarea în profiles e blocată
-- pentru rolurile client — 262).
--
-- Teste permanente: NU1–NU5 `tests/sql/auto/331_signup_ui_language.sql`.
-- Toleranță: un client vechi trimite deja `ui_lang`; un client nou pe o bază
-- fără 331 lasă contul pe null (comportamentul de azi). Ordinea e liberă.
-- =============================================================================

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── 1. handle_new_user (schema de bază → 331) ───────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name, ui_language)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    -- Limba ecranului de la înregistrare (clientul: `options.data.ui_lang`).
    -- Doar valorile CHECK-ului din 323; restul → null (signup-ul nu pică).
    case
      when new.raw_user_meta_data->>'ui_lang' in ('ro', 'en', 'fr', 'de')
        then new.raw_user_meta_data->>'ui_lang'
    end
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ── 2. Backfill: conturile fără limbă ───────────────────────────────────────
-- Lacătul (SHARE ROW EXCLUSIVE, până la COMMIT) oprește pentru câteva
-- milisecunde scrierile pe profiles: fără el, un signup comis între UPDATE și
-- asserția de mai jos (prin funcția VECHE, încă vizibilă altor tranzacții) ar
-- lăsa un rând null și ar pica migrația din motive de cursă, nu de cod.
lock table public.profiles in share row exclusive mode;

-- `profiles.id` referă `auth.users(id)` (schema de bază), deci join-ul acoperă
-- fiecare rând; nu există profil fără utilizator.
update public.profiles p
   set ui_language = coalesce(
         case
           when u.raw_user_meta_data->>'ui_lang' in ('ro', 'en', 'fr', 'de')
             then u.raw_user_meta_data->>'ui_lang'
         end,
         'ro')
  from auth.users u
 where u.id = p.id
   and p.ui_language is null;

-- ── Asserții fail-closed ────────────────────────────────────────────────────
do $$
declare
  v_def text;
  v_cfg text[];
  v_null bigint;
begin
  select pg_get_functiondef(p.oid), p.proconfig
    into v_def, v_cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'handle_new_user'
     and p.pronargs = 0;
  if v_def is null then
    raise exception 'mig 331: handle_new_user() lipsește';
  end if;
  if position('ui_lang' in v_def) = 0 or position('ui_language' in v_def) = 0 then
    raise exception 'mig 331: handle_new_user nu copiază ui_lang în ui_language';
  end if;
  -- Corpul vechi e păstrat: numele din metadata cu rezerva pe email.
  if position($q$split_part(new.email, '@', 1)$q$ in v_def) = 0 then
    raise exception 'mig 331: handle_new_user a pierdut rezerva full_name = partea locală a emailului';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'handle_new_user' and p.prosecdef) then
    raise exception 'mig 331: handle_new_user nu mai e SECURITY DEFINER';
  end if;
  if v_cfg is null or not ('search_path=public, pg_temp' = any (v_cfg)) then
    raise exception 'mig 331: handle_new_user are search_path % (trebuia public, pg_temp)', v_cfg;
  end if;
  if has_function_privilege('anon', 'public.handle_new_user()', 'execute')
     or has_function_privilege('authenticated', 'public.handle_new_user()', 'execute') then
    raise exception 'mig 331: handle_new_user e executabilă de un rol client (RP13)';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgname = 'on_auth_user_created'
                    and tgrelid = 'auth.users'::regclass
                    and tgfoid = 'public.handle_new_user()'::regprocedure
                    and tgenabled = 'O') then
    raise exception 'mig 331: trigger-ul on_auth_user_created lipsește sau e dezactivat';
  end if;

  select count(*) into v_null from public.profiles where ui_language is null;
  if v_null > 0 then
    raise exception 'mig 331: % conturi au rămas fără limbă după backfill', v_null;
  end if;
end;
$$;

commit;
