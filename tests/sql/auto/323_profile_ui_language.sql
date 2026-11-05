-- tests/sql/auto/323_profile_ui_language.sql
-- =============================================================================
-- UL1–UL5 — clichetul PERMANENT al mig 323: limba interfeței e a contului.
-- Autonom, ROLLBACK la final. Scrierile rulează SUB rolul REAL `authenticated`
-- (ca postgres, ACL-ul de coloană și RLS-ul sunt ocolite, deci testul ar fi orb
-- exact la ce verifică).
--
--   UL1  Contul își alege limba ('fr') și o citește înapoi; poate reveni la null.
--        [PICĂ: fără `grant update (ui_language)` → 42501]
--   UL2  O limbă necunoscută ('it', 'xx') e respinsă de CHECK (23514).
--        [PICĂ: fără CHECK]
--   UL3  Un cont NU poate schimba limba altui cont (RLS: 0 rânduri atinse).
--        [PICĂ: politica de UPDATE lărgită la `using (true)`]
--   UL4  Grantul nou nu lărgește regimul: `plan` și `is_platform_admin` rămân
--        nescriibile din client (42501), în aceeași tranzacție cu UL1.
--        [PICĂ: grant UPDATE la nivel de tabelă]
--   UL5  Un cont NOU pornește fără limbă (null), nu cu 'ro'.
--        [PICĂ: default 'ro' păstrat — conturile noi n-ar mai urma browserul]
-- =============================================================================

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('32300000-0000-4000-8000-000000000001', 'ul-a@ul323.test'),
  ('32300000-0000-4000-8000-000000000002', 'ul-b@ul323.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email) values
  ('32300000-0000-4000-8000-000000000001', 'ul-a@ul323.test'),
  ('32300000-0000-4000-8000-000000000002', 'ul-b@ul323.test')
  on conflict (id) do nothing;

do $$
declare
  v_a constant uuid := '32300000-0000-4000-8000-000000000001';
  v_b constant uuid := '32300000-0000-4000-8000-000000000002';
  v_lang text;
  v_n int;
  v_state text;
begin
  -- UL5 (înaintea oricărei scrieri): contul nou n-a ales nimic.
  select ui_language into v_lang from public.profiles where id = v_a;
  if v_lang is not null then
    raise exception 'UL5 FAIL: contul nou pornește cu limba % (trebuia null)', v_lang;
  end if;

  -- UL1: A își alege franceza, sub rolul real.
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  perform set_config('role', 'authenticated', true);
  update public.profiles set ui_language = 'fr' where id = v_a;
  get diagnostics v_n = row_count;
  perform set_config('role', 'none', true);
  if v_n <> 1 then
    raise exception 'UL1 FAIL: actualizarea propriei limbi a atins % rânduri', v_n;
  end if;
  select ui_language into v_lang from public.profiles where id = v_a;
  if v_lang is distinct from 'fr' then
    raise exception 'UL1 FAIL: limba citită înapoi = % (trebuia fr)', v_lang;
  end if;
  -- … și poate reveni la „nealeasă”.
  perform set_config('role', 'authenticated', true);
  update public.profiles set ui_language = null where id = v_a;
  perform set_config('role', 'none', true);
  select ui_language into v_lang from public.profiles where id = v_a;
  if v_lang is not null then
    raise exception 'UL1 FAIL: revenirea la null a lăsat %', v_lang;
  end if;

  -- UL2: limbi necunoscute → CHECK.
  foreach v_lang in array array['it', 'xx', 'RO', ''] loop
    v_state := null;
    begin
      perform set_config('role', 'authenticated', true);
      update public.profiles set ui_language = v_lang where id = v_a;
      perform set_config('role', 'none', true);
    exception when others then
      v_state := sqlstate;
    end;
    perform set_config('role', 'none', true);
    if v_state is distinct from '23514' then
      raise exception 'UL2 FAIL: limba „%” → SQLSTATE % (trebuia 23514)', v_lang, coalesce(v_state, 'acceptată');
    end if;
  end loop;

  -- UL3: A nu atinge limba lui B.
  perform set_config('role', 'authenticated', true);
  update public.profiles set ui_language = 'de' where id = v_b;
  get diagnostics v_n = row_count;
  perform set_config('role', 'none', true);
  select ui_language into v_lang from public.profiles where id = v_b;
  if v_n <> 0 or v_lang is not null then
    raise exception 'UL3 FAIL: A a schimbat limba lui B (% rânduri, limba %)', v_n, v_lang;
  end if;

  -- UL4: regimul column-gated e neschimbat.
  foreach v_lang in array array['plan', 'is_platform_admin'] loop
    v_state := null;
    begin
      perform set_config('role', 'authenticated', true);
      if v_lang = 'plan' then
        update public.profiles set plan = 'enterprise' where id = v_a;
      else
        update public.profiles set is_platform_admin = true where id = v_a;
      end if;
      perform set_config('role', 'none', true);
    exception when others then
      v_state := sqlstate;
    end;
    perform set_config('role', 'none', true);
    if v_state is distinct from '42501' then
      raise exception 'UL4 FAIL: authenticated a scris profiles.% (SQLSTATE %)', v_lang, coalesce(v_state, 'acceptat');
    end if;
  end loop;

  raise notice 'UL1–UL5 OK: limba contului (mig 323)';
end;
$$;

rollback;
