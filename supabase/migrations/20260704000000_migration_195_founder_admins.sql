-- mig 195 — platform admin pe georgeradu004@gmail.com + seed self-healing
-- ─────────────────────────────────────────────────────────────────────
-- Context: fondatorul folosește contul georgeradu004@gmail.com pentru
-- panoul de fondator; azi flag-ul e seed-uit doar pe georgeradu119 (mig 168).
--
-- Capcana din mig 168 (recunoscută chiar în comentariul ei): seed-ul e un
-- UPDATE după email — dacă profilul NU există la momentul aplicării,
-- afectează 0 rânduri și se pierde definitiv (migrarea nu se re-rulează).
-- Fix definitiv: pe lângă UPDATE-ul idempotent, un trigger BEFORE
-- INSERT/UPDATE OF email pe profiles care setează is_platform_admin pentru
-- emailurile de fondator — seed-ul „se vindecă singur" indiferent când se
-- creează contul (handle_new_user inserează email-ul la signup).
--
-- Lista de emailuri stă ÎN funcția triggerului (nu tabelă nouă) — e o listă
-- de 2, controlată exclusiv prin migrații; o tabelă ar fi altă suprafață
-- de securizat degeaba.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '60s';

-- ── 1. Seed imediat pentru conturile deja existente ─────────────────
update public.profiles
   set is_platform_admin = true
 where lower(email) in ('georgeradu119@gmail.com', 'georgeradu004@gmail.com')
   and is_platform_admin = false;

-- ── 2. Trigger self-healing pentru signup-uri viitoare ──────────────
-- BEFORE, deci setează câmpul pe rândul în curs de scriere — fără UPDATE
-- suplimentar și fără recursie. Doar ridică flag-ul (nu-l coboară niciodată:
-- revocarea rămâne operațiune manuală deliberată, nu efect de trigger).
create or replace function public.fn_seed_platform_admin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if lower(coalesce(new.email, '')) in (
       'georgeradu119@gmail.com',
       'georgeradu004@gmail.com'
     )
  then
    new.is_platform_admin := true;
  end if;
  return new;
end;
$$;

revoke all on function public.fn_seed_platform_admin() from public, anon, authenticated, service_role;

drop trigger if exists trg_seed_platform_admin on public.profiles;
create trigger trg_seed_platform_admin
  before insert or update of email on public.profiles
  for each row execute procedure public.fn_seed_platform_admin();

comment on function public.fn_seed_platform_admin() is
  'Seed self-healing: emailurile fondatorului primesc is_platform_admin=true la crearea/actualizarea profilului. Lista se schimbă DOAR prin migrație nouă.';

-- ── Asserții fail-closed ────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  -- Triggerul + funcția există, funcția are search_path fixat.
  if not exists (
    select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'profiles'
       and t.tgname = 'trg_seed_platform_admin' and not t.tgisinternal
  ) then
    raise exception 'mig 195: triggerul trg_seed_platform_admin lipsește';
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_seed_platform_admin';
  if v_def is null or v_def !~ 'search_path' or v_def !~ 'georgeradu004' then
    raise exception 'mig 195: fn_seed_platform_admin incompletă';
  end if;

  -- Dacă profilurile există deja, flag-ul trebuie să fie ridicat.
  if exists (
    select 1 from public.profiles
     where lower(email) in ('georgeradu119@gmail.com', 'georgeradu004@gmail.com')
       and is_platform_admin = false
  ) then
    raise exception 'mig 195: profil de fondator existent fără is_platform_admin';
  end if;

  raise notice 'mig 195: founder admins OK (seed + trigger self-healing)';
end $$;

commit;
