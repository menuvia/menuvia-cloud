-- tests/sql/auto/310_founder_admin_single.sql
-- =============================================================================
-- Mig 310: un singur cont de fondator (georgeradu119), promovat DOAR cu email
-- confirmat; georgeradu004 nu mai e administrator de platformă. Autonom,
-- ROLLBACK la final, pe AMBELE medii (Postgres gol din sql-verify, unde
-- auth.users e un mock fără `email_confirmed_at`, și stack-ul Supabase din E2E).
--
--   FA1  un profil cu emailul 004, CONFIRMAT, NU devine admin
--        (mutație: 004 readus în fn_seed_platform_admin → pică)
--   FA2  profilul 119 cu email NECONFIRMAT nu devine admin
--        (mutație: fără verificarea email_confirmed_at → pică)
--   FA3  control pozitiv: după confirmare, 119 devine admin — prin trigger-ul
--        de confirmare acolo unde există (Supabase), și prin seed-ul de pe
--        profiles la o actualizare de email (ambele medii)
--   FA4  catalog: cele două funcții sunt DEFINER cu pg_temp și NU sunt
--        apelabile de anon/authenticated/service_role; trigger-ul de pe
--        auth.users există exact când coloana email_confirmed_at exista
--        ÎNAINTE de suită (mutație: fără blocul care creează trigger-ul →
--        FA3/FA4 pică pe Supabase)
--   FA6  profilul cu emailul 119 dar al cărui rând auth are ALT email,
--        confirmat, nu devine admin (mutație: fără verificarea u.email → pică)
--   FA5  starea finală: niciun profil cu emailul 004 nu e admin
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- Dacă coloana exista ÎNAINTE de suită (Supabase) — FA4 cere atunci
-- trigger-ul de confirmare; pe mock coloana o adaugă suita, după migrare.
create temp table _fa_env on commit drop as
select exists (
  select 1 from pg_attribute
   where attrelid = 'auth.users'::regclass
     and attname = 'email_confirmed_at' and not attisdropped
) as had_col;

-- Pe mock-ul din CI coloana lipsește: o adăugăm în tranzacție (rollback la
-- final). Pe Supabase există, iar postgres nu e proprietarul tabelei — deci
-- ALTER doar când lipsește.
do $$
begin
  if not (select had_col from _fa_env) then
    execute 'alter table auth.users add column email_confirmed_at timestamptz';
  end if;
end $$;

-- ── FA1: 004 confirmat nu e promovat ─────────────────────────────────────────
insert into auth.users (id, email, email_confirmed_at) values
  ('fa000000-0000-4000-8000-000000000004', 'georgeradu004@gmail.com', now())
  on conflict (id) do nothing;
insert into public.profiles (id, email)
  values ('fa000000-0000-4000-8000-000000000004', 'georgeradu004@gmail.com')
  on conflict (id) do update set email = excluded.email;

do $$
begin
  if (select is_platform_admin from public.profiles
       where id = 'fa000000-0000-4000-8000-000000000004') then
    raise exception 'FA1: contul 004 confirmat a fost promovat administrator de platformă';
  end if;
  raise notice 'FA1 ✓ 004 confirmat rămâne cont obișnuit';
end $$;

-- ── FA2: 119 neconfirmat nu e promovat ───────────────────────────────────────
insert into auth.users (id, email, email_confirmed_at) values
  ('fa000000-0000-4000-8000-000000000119', 'georgeradu119@gmail.com', null)
  on conflict (id) do nothing;
insert into public.profiles (id, email)
  values ('fa000000-0000-4000-8000-000000000119', 'georgeradu119@gmail.com')
  on conflict (id) do update set email = excluded.email;

do $$
begin
  if (select is_platform_admin from public.profiles
       where id = 'fa000000-0000-4000-8000-000000000119') then
    raise exception 'FA2: emailul fondatorului NECONFIRMAT a primit is_platform_admin';
  end if;
  raise notice 'FA2 ✓ email neconfirmat nu promovează';
end $$;

-- ── FA3: după confirmare, 119 e promovat ─────────────────────────────────────
update auth.users set email_confirmed_at = now()
 where id = 'fa000000-0000-4000-8000-000000000119';

do $$
declare
  v_has_confirm_trigger boolean;
begin
  select exists (
    select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'auth' and c.relname = 'users'
       and t.tgname = 'trg_seed_platform_admin_on_confirm' and not t.tgisinternal
  ) into v_has_confirm_trigger;

  if v_has_confirm_trigger then
    if not (select is_platform_admin from public.profiles
             where id = 'fa000000-0000-4000-8000-000000000119') then
      raise exception 'FA3: confirmarea emailului nu a promovat contul fondatorului';
    end if;
    raise notice 'FA3 ✓ confirmarea emailului promovează (trigger pe auth.users)';
  elsif (select had_col from _fa_env) then
    raise exception 'FA3: coloana email_confirmed_at există nativ, dar trigger-ul de confirmare lipsește';
  else
    raise notice 'FA3 · trigger-ul de confirmare lipsește pe mediul ăsta (mock fără coloană la migrare)';
  end if;
end $$;

-- Seed-ul de pe profiles, pe ambele medii: o actualizare a emailului, acum
-- confirmat, promovează.
update public.profiles set is_platform_admin = false
 where id = 'fa000000-0000-4000-8000-000000000119';
update public.profiles set email = 'georgeradu119@gmail.com'
 where id = 'fa000000-0000-4000-8000-000000000119';

do $$
begin
  if not (select is_platform_admin from public.profiles
           where id = 'fa000000-0000-4000-8000-000000000119') then
    raise exception 'FA3: seed-ul de pe profiles nu promovează 119 cu email confirmat';
  end if;
  raise notice 'FA3 ✓ seed-ul de pe profiles promovează 119 confirmat';
end $$;

-- ── FA6: emailul confirmat e cel din auth.users ──────────────────────────────
insert into auth.users (id, email, email_confirmed_at) values
  ('fa000000-0000-4000-8000-000000000006', 'altcineva-fa6@example.com', now())
  on conflict (id) do nothing;
insert into public.profiles (id, email)
  values ('fa000000-0000-4000-8000-000000000006', 'georgeradu119@gmail.com')
  on conflict (id) do update set email = excluded.email;

do $$
begin
  if (select is_platform_admin from public.profiles
       where id = 'fa000000-0000-4000-8000-000000000006') then
    raise exception 'FA6: un cont confirmat cu ALT email a devenit fondator prin profiles.email';
  end if;
  raise notice 'FA6 ✓ promovarea cere emailul fondatorului în auth.users';
end $$;

-- ── FA4: catalog ─────────────────────────────────────────────────────────────
do $$
declare
  v_fn text;
  v_role text;
  v_had_col boolean;
  v_has_trg boolean;
begin
  foreach v_fn in array array['fn_seed_platform_admin', 'fn_seed_platform_admin_on_confirm'] loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_fn and p.prosecdef
         and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%pg_temp%')
    ) then
      raise exception 'FA4: % nu e DEFINER cu pg_temp în search_path', v_fn;
    end if;
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(v_role, format('public.%I()', v_fn), 'execute') then
        raise exception 'FA4: % poate executa %', v_role, v_fn;
      end if;
    end loop;
  end loop;

  select had_col from _fa_env into v_had_col;
  select exists (
    select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'auth' and c.relname = 'users'
       and t.tgname = 'trg_seed_platform_admin_on_confirm' and not t.tgisinternal
  ) into v_has_trg;
  -- Echivalență pe starea DINAINTEA suitei: unde coloana există nativ
  -- (Supabase), trigger-ul TREBUIE să existe — altfel FA3 ar sări tăcut;
  -- pe mock, coloana adăugată de suită nu are și nu trebuie să aibă trigger.
  if v_had_col and not v_has_trg then
    raise exception 'FA4: coloana email_confirmed_at există, dar trigger-ul de confirmare lipsește';
  end if;
  if v_has_trg and not v_had_col then
    raise exception 'FA4: trigger de confirmare fără coloana email_confirmed_at';
  end if;
  raise notice 'FA4 ✓ funcțiile sunt interne, DEFINER cu pg_temp';
end $$;

-- ── FA5: niciun profil 004 nu e admin ────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from public.profiles
     where lower(email) = 'georgeradu004@gmail.com' and is_platform_admin
  ) then
    raise exception 'FA5: un profil cu emailul 004 e încă administrator de platformă';
  end if;
  raise notice 'FA5 ✓ 004 nu e administrator';
end $$;

rollback;
