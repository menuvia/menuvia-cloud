-- =============================================================================
-- Migration 323: limba interfeței e a CONTULUI (lotul L0a, Partea II —
-- platforma în română, engleză, franceză și germană pentru personal)
-- =============================================================================
-- Decizia fondatorului (nov 2026): limba se alege PER UTILIZATOR, nu per
-- restaurant — un patron român și un ospătar francez lucrează în același
-- local, fiecare în limba lui. Până acum limba exista doar în `localStorage`
-- (`menuvia_ui_lang`, funnel-ul RO/EN), adică per DISPOZITIV: pe telefonul
-- de serviciu al localului, al doilea ospătar ar fi moștenit limba primului.
--
-- `profiles.ui_language`:
--   - `null` = contul n-a ales nimic (clientul decide: URL → stocare locală →
--     browser → site), CHECK pe cele patru limbi ale personalului;
--   - conturile EXISTENTE primesc 'ro' (decizia fondatorului: „rămân în
--     română") — altfel un patron cu browserul în engleză s-ar trezi cu
--     panoul în engleză în ziua în care engleza se activează.
-- Backfill-ul e `add column ... default 'ro'` + `drop default`: pe PG ≥ 11
-- valoarea implicită a unei coloane NOI se scrie în catalog (attmissingval),
-- nu prin UPDATE — deci NU se declanșează niciun trigger de pe profiles
-- (`set_profiles_updated_at` ar fi mutat `updated_at` pe TOATE conturile,
-- `trg_seed_platform_admin` e pe UPDATE OF email, dar regula e: o migrație de
-- limbă nu atinge alte coloane), nu se rescrie tabela, iar rândurile vechi
-- își păstrează 'ro' după `drop default`. Conturile NOI pornesc cu `null`.
--
-- Scrierea: `authenticated` primește UPDATE DOAR pe coloana nouă (regimul
-- column-gated din 096a: UPDATE la nivel de tabelă pe profiles ar redeschide
-- escaladarea la `is_platform_admin`/`plan`, SH3/mig 258). Whitelist-ul RP4
-- din `tests/sql/privilege_regime_assertions.sql` crește cu `ui_language`, în
-- același PR. RLS-ul `profiles_self_update` (262) rămâne autoritatea pe rând.
--
-- Clientul se poate deploya ÎNAINTEA migrației: AuthContext reîncearcă
-- citirea profilului fără coloană la 42703 (altfel profilul n-ar mai încărca
-- deloc, iar gate-ul de Termeni ar rămâne orb).
-- =============================================================================

begin;

alter table public.profiles
  add column if not exists ui_language text default 'ro';
alter table public.profiles
  alter column ui_language drop default;

alter table public.profiles
  drop constraint if exists profiles_ui_language_check;
alter table public.profiles
  add constraint profiles_ui_language_check
  check (ui_language is null or ui_language in ('ro', 'en', 'fr', 'de'));

comment on column public.profiles.ui_language is
  'Limba interfeței personalului (ro/en/fr/de), aleasă de cont; null = nealeasă (decide clientul). Conturile dinainte de mig 323 = ro.';

grant update (ui_language) on table public.profiles to authenticated;

-- ── Asserții fail-closed ────────────────────────────────────────────────────
do $$
declare
  v_null bigint;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'ui_language'
       and column_default is null
  ) then
    raise exception 'mig 323: profiles.ui_language lipsește sau are încă default (conturile noi trebuie să pornească cu null)';
  end if;

  -- Backfill: niciun cont existent fără limbă.
  select count(*) into v_null from public.profiles where ui_language is null;
  if v_null > 0 then
    raise exception 'mig 323: % conturi existente au rămas fără limbă (backfill-ul ro a eșuat)', v_null;
  end if;

  if not has_column_privilege('authenticated', 'public.profiles', 'ui_language', 'UPDATE') then
    raise exception 'mig 323: authenticated nu poate scrie profiles.ui_language';
  end if;
  -- Regimul column-gated rămâne: niciun UPDATE la nivel de tabelă.
  if has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
     and has_column_privilege('authenticated', 'public.profiles', 'is_platform_admin', 'UPDATE') then
    raise exception 'mig 323: authenticated poate scrie is_platform_admin — regimul 096a s-a rupt';
  end if;
  if has_column_privilege('anon', 'public.profiles', 'ui_language', 'UPDATE') then
    raise exception 'mig 323: anon poate scrie profiles.ui_language';
  end if;

  -- CHECK-ul există, e validat (deci acoperă și rândurile vechi) și numește
  -- exact cele patru limbi. Comportamentul (respinge 'xx', acceptă null) e
  -- exersat de suita UL1–UL4 (`tests/sql/auto/323_profile_ui_language.sql`).
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.profiles'::regclass and conname = 'profiles_ui_language_check'
       and convalidated
  ) then
    raise exception 'mig 323: CHECK-ul pe ui_language lipsește sau nu e validat';
  end if;
end;
$$;

commit;
