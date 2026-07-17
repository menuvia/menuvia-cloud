-- mig 235 — MFA (TOTP) pe conturile de platformă: aal2 pentru is_platform_admin
-- ─────────────────────────────────────────────────────────────────────
-- Săptămâna 8 din PLAN_10_SAPTAMANI: „MFA pe conturile de platformă".
-- Contul de fondator e cel mai valoros din sistem (is_platform_admin trece
-- prin TOATE gate-urile via funelul is_admin/is_member/my_role, mig 186/187).
--
-- Model: opt-in cu clichet.
--   • `profiles.mfa_enforced` (default false) — userul îl activează DUPĂ ce
--     și-a înrolat + verificat un factor TOTP (SettingsTab → Cont).
--   • `is_platform_admin()` (redefinire, singura de la mig 168) cere sesiune
--     `aal2` DOAR când mfa_enforced e true — fail-open pe ne-înrolați, ca
--     founder-ul să nu fie blocat înainte de enrollment. `aal` se citește din
--     GUC-ul `request.jwt.claims` (setat de PostgREST/GoTrue), NU prin
--     auth.jwt() (absent din bootstrap-ul CI); lipsa claim-ului = 'aal1'
--     (fail-closed pe conturile cu flag pornit).
--   • `set_my_mfa_enforced(p_enforced)`: activarea e liberă; DEZACTIVAREA
--     cere ea însăși aal2 — altfel un atacator doar-cu-parola (aal1) ar
--     stinge flag-ul și ar ocoli întreg MFA-ul (clichetul e miezul schemei).
--
-- IMPORTANT: redefinim DOAR corpul lui is_platform_admin(); funelul
-- is_admin/is_member/my_role (mig 186/187) rămâne NEATINS, deci asserțiile
-- lui anti-regresie (ambele escape-uri) rămân valide. Enforcement-ul se
-- propagă automat: escape-ul din funel cheamă această funcție.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── A. Flag-ul de enforcement ────────────────────────────────────────
alter table public.profiles
  add column if not exists mfa_enforced boolean not null default false;

comment on column public.profiles.mfa_enforced is
  'MFA obligatoriu pe acest cont (mig 235): is_platform_admin() cere sesiune aal2 când e true. Se activează din SettingsTab→Cont după enrollment TOTP; dezactivarea cere aal2 (set_my_mfa_enforced).';

-- ── B. Helper: nivelul de asigurare al sesiunii curente ──────────────
create or replace function public.fn_session_aal()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal',
    'aal1'
  );
$$;

revoke all on function public.fn_session_aal() from public;
revoke all on function public.fn_session_aal() from anon;
grant execute on function public.fn_session_aal() to authenticated;

-- ── C. is_platform_admin — lanț 168→235 ──────────────────────────────
-- Aceeași semnătură/volatilitate/convenție ca mig 168; singura schimbare:
-- clauza de enforcement aal2 legată de mfa_enforced.
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select p.is_platform_admin
             and (not p.mfa_enforced or public.fn_session_aal() = 'aal2')
      from public.profiles p
      where p.id = auth.uid()
    ),
    false
  );
$$;

revoke all on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to authenticated;

-- ── D. set_my_mfa_enforced — activare liberă, dezactivare doar aal2 ──
create or replace function public.set_my_mfa_enforced(p_enforced boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Autentificare necesară';
  end if;
  if p_enforced is null then
    raise exception 'Parametru invalid';
  end if;

  -- Clichetul anti-downgrade: OFF doar dintr-o sesiune care a trecut MFA.
  if not p_enforced and public.fn_session_aal() <> 'aal2' then
    raise exception 'Dezactivarea MFA cere o sesiune verificată cu MFA (aal2)';
  end if;

  update public.profiles set mfa_enforced = p_enforced where id = v_uid;

  return jsonb_build_object('ok', true, 'mfa_enforced', p_enforced);
end;
$$;

revoke all on function public.set_my_mfa_enforced(boolean) from public;
revoke all on function public.set_my_mfa_enforced(boolean) from anon;
grant execute on function public.set_my_mfa_enforced(boolean) to authenticated;

-- ── Asserții fail-closed ─────────────────────────────────────────────
do $$
declare v_def text;
begin
  -- is_platform_admin are enforcement-ul, legat de flag (fail-open ne-înrolați)
  v_def := pg_get_functiondef('public.is_platform_admin()'::regprocedure);
  if v_def not ilike '%mfa_enforced%' or v_def not ilike '%fn_session_aal%' then
    raise exception 'mig 235: is_platform_admin fără enforcement MFA';
  end if;

  -- Funelul 186/187 e neatins: ambele escape-uri încă prezente
  if not (
    (select pg_get_functiondef(p.oid) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'is_admin'
        and pg_get_function_identity_arguments(p.oid) = 'p_restaurant_id uuid')
      ilike '%is_platform_admin%'
  ) then
    raise exception 'mig 235: escape-ul is_platform_admin a dispărut din is_admin (funelul NU trebuia atins)';
  end if;

  -- Dezactivarea fără aal2 e respinsă în corpul RPC-ului
  v_def := pg_get_functiondef('public.set_my_mfa_enforced(boolean)'::regprocedure);
  if v_def not ilike '%aal2%' then
    raise exception 'mig 235: set_my_mfa_enforced fără clichetul aal2 pe dezactivare';
  end if;

  -- anon fără EXECUTE pe suprafața nouă
  if has_function_privilege('anon', 'public.set_my_mfa_enforced(boolean)', 'execute')
     or has_function_privilege('anon', 'public.fn_session_aal()', 'execute') then
    raise exception 'mig 235: suprafața MFA accesibilă anon';
  end if;

  raise notice 'mig 235: MFA pe conturile de platformă (aal2 + clichet) OK';
end $$;

commit;
