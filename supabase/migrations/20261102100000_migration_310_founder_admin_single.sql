-- mig 310 — un singur cont de fondator, doar cu email confirmat
-- ─────────────────────────────────────────────────────────────────────
-- Context (raportul fondatorului, 02.11.2026): „intru de pe alt cont și îmi
-- apare panoul de fondator la restaurant și pot umbla pe altele”. Cauza:
-- mig 195 promova automat, pe EMAIL, două conturi — georgeradu119 și
-- georgeradu004 — iar escape-ul `is_platform_admin()` din funelul
-- is_member/is_admin/my_role (mig 286) dă acces REAL de manager la ORICE
-- restaurant. Decizia fondatorului: 004 e un cont obișnuit (acces doar la
-- restaurantul lui și, ca afiliat, la cele care i-l acordă prin fluxul
-- opt-in din mig 286); fondatorul e DOAR 119.
--
-- Două goluri închise aici:
--   1. 004 nu mai e promovat și flag-ul existent e COBORÂT explicit —
--      trigger-ul din 195 doar ridică flag-ul, deci o coborâre nu se face
--      niciodată singură.
--   2. Promovarea cere `auth.users.email_confirmed_at` nenul. Fără asta,
--      oricine se înscria primul cu emailul fondatorului (de exemplu pe un
--      proiect cu confirmarea emailului oprită) devenea administrator de
--      platformă. Citirea trece prin `to_jsonb(u)`, ca în mig 304: schema
--      mock din CI nu are coloana, iar absența ei înseamnă NECONFIRMAT
--      (fail-closed).
--
-- Mig 195 NU se editează (aplicată). MFA obligatoriu NU se activează aici:
-- pe producție, la 02.11.2026, contul 119 nu are niciun factor TOTP
-- verificat, deci `mfa_enforced = true` l-ar bloca afară din /founder
-- (is_platform_admin cere aal2, mig 235). Se activează din Setări → Cont
-- după înrolarea factorului (MfaCard).
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '60s';

-- ── 1. Funcția de seed: un singur email, doar confirmat ─────────────
-- create or replace păstrează trigger-ul din 195; search_path scris
-- explicit (create or replace rescrie proconfig).
create or replace function public.fn_seed_platform_admin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_confirmed boolean := false;
begin
  if lower(coalesce(new.email, '')) = 'georgeradu119@gmail.com' then
    -- Emailul CONFIRMAT e cel din auth.users, nu cel din profiles: un viitor
    -- scriitor al lui profiles.email (sync, service_role) n-are voie să
    -- transforme în fondator un cont confirmat cu alt email.
    select (to_jsonb(u) ->> 'email_confirmed_at') is not null
      into v_confirmed
      from auth.users u
     where u.id = new.id
       and lower(u.email) = 'georgeradu119@gmail.com';
    if coalesce(v_confirmed, false) then
      new.is_platform_admin := true;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.fn_seed_platform_admin() from public, anon, authenticated, service_role;

comment on function public.fn_seed_platform_admin() is
  'Seed self-healing (mig 195 → 310): DOAR georgeradu119@gmail.com, DOAR cu email confirmat, primește is_platform_admin=true. Doar ridică flag-ul; lista se schimbă numai prin migrație nouă.';

-- ── 1b. Promovarea la CONFIRMAREA emailului ─────────────────────────
-- Profilul se creează la signup (handle_new_user), când emailul e de regulă
-- încă neconfirmat, deci seed-ul de mai sus nu promovează. Confirmarea
-- scrie doar în auth.users, iar trigger-ul de pe profiles nu se mai
-- declanșează — fără pasul ăsta, un cont de fondator recreat (de exemplu
-- după o ștergere GDPR) n-ar mai fi promovat niciodată.
create or replace function public.fn_seed_platform_admin_on_confirm()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if lower(coalesce(new.email, '')) = 'georgeradu119@gmail.com'
     and (to_jsonb(new) ->> 'email_confirmed_at') is not null then
    update public.profiles
       set is_platform_admin = true
     where id = new.id
       and not is_platform_admin;
  end if;
  return null;
end;
$$;

revoke all on function public.fn_seed_platform_admin_on_confirm() from public, anon, authenticated, service_role;

-- Coloana lipsește din schema mock a auth.users din CI (sql-verify); pe
-- Supabase există. Trigger-ul se creează doar unde poate funcționa.
-- Coloana se caută în pg_attribute, nu în information_schema (acolo apar
-- doar coloanele pe care rolul curent are privilegii). Fără DROP: pe
-- Supabase găzduit postgres nu e proprietarul lui auth.users, deci un
-- `drop trigger` pe un trigger EXISTENT ar pica la o re-aplicare; crearea
-- e condiționată de absența lui.
do $$
begin
  if exists (
    select 1 from pg_attribute
     where attrelid = 'auth.users'::regclass
       and attname = 'email_confirmed_at' and not attisdropped
  ) and not exists (
    select 1 from pg_trigger
     where tgrelid = 'auth.users'::regclass
       and tgname = 'trg_seed_platform_admin_on_confirm'
  ) then
    execute 'create trigger trg_seed_platform_admin_on_confirm
               after update of email_confirmed_at on auth.users
               for each row execute function public.fn_seed_platform_admin_on_confirm()';
  end if;
end $$;

-- ── 2. Un singur administrator de platformă: 119 ───────────────────
-- Trigger-ul din 195 doar RIDICĂ flag-ul, deci coborârea e explicită. Pe
-- producție, la 02.11.2026, singurele conturi cu flag sunt 119 și 004; orice
-- alt flag pus de mână ar supraviețui tăcut, deci se coboară toate celelalte.
do $$
declare
  v_n int;
begin
  update public.profiles
     set is_platform_admin = false
   where is_platform_admin
     and lower(coalesce(email, '')) <> 'georgeradu119@gmail.com';
  get diagnostics v_n = row_count;
  raise notice 'mig 310: % cont(uri) coborâte din administrator de platformă', v_n;
end $$;

-- ── Asserții fail-closed ────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_seed_platform_admin';

  if v_def is null then
    raise exception 'mig 310: fn_seed_platform_admin lipsește';
  end if;
  if v_def ~ 'georgeradu004' then
    raise exception 'mig 310: fn_seed_platform_admin încă promovează 004';
  end if;
  if v_def !~ 'u\.email\)' then
    raise exception 'mig 310: fn_seed_platform_admin nu verifică emailul din auth.users';
  end if;
  if v_def !~ 'email_confirmed_at' then
    raise exception 'mig 310: fn_seed_platform_admin nu cere emailul confirmat';
  end if;
  if v_def !~ 'pg_temp' then
    raise exception 'mig 310: fn_seed_platform_admin fără pg_temp în search_path';
  end if;

  if not exists (
    select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'profiles'
       and t.tgname = 'trg_seed_platform_admin' and not t.tgisinternal
  ) then
    raise exception 'mig 310: triggerul trg_seed_platform_admin lipsește';
  end if;

  if exists (
    select 1 from public.profiles
     where is_platform_admin
       and lower(coalesce(email, '')) <> 'georgeradu119@gmail.com'
  ) then
    raise exception 'mig 310: există administratori de platformă în afară de 119';
  end if;

  -- Trigger-ul de confirmare există EXACT unde există coloana: fără el, un
  -- cont de fondator recreat n-ar mai fi promovat niciodată, tăcut.
  if exists (
    select 1 from pg_attribute
     where attrelid = 'auth.users'::regclass
       and attname = 'email_confirmed_at' and not attisdropped
  ) is distinct from exists (
    select 1 from pg_trigger
     where tgrelid = 'auth.users'::regclass
       and tgname = 'trg_seed_platform_admin_on_confirm' and not tgisinternal
  ) then
    raise exception 'mig 310: trigger-ul de confirmare nu corespunde coloanei email_confirmed_at';
  end if;

  raise notice 'mig 310: un singur fondator (119, confirmat); ceilalți coborâți';
end $$;

commit;
