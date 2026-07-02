-- mig 189 — get_affiliate_public_defaults: procentele programului de afiliere,
--           citibile PUBLIC (pagina de prezentare /afiliat pentru vizitatori)
-- ─────────────────────────────────────────────────────────────────────
-- Context: fluxul de intrare în programul de afiliere era rupt — linkul
-- public „Program de parteneriat" ducea la un zid de login fără nicio
-- explicație. Pagina publică de prezentare are nevoie de procentele REALE
-- (setate de fondator în platform_settings, mig 188), altfel afișează text
-- generic care nu vinde.
--
-- Expunem DOAR cele 3 valori de marketing (setup/recurring/cap) — nu
-- cascade_bps (detaliu de program intern, afișat doar afiliaților logați),
-- nu restul platform_settings (SELECT-ul direct rămâne founder-only).
--
-- Convenția lockdown: SECURITY DEFINER, search_path = public, pg_temp,
-- grant EXPLICIT anon + authenticated (e intenționat public), asserții
-- fail-closed. Migrațiile aplicate nu se editează → fișier nou.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '60s';

create or replace function public.get_affiliate_public_defaults()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  select value into v from public.platform_settings
   where key = 'affiliate_commission_defaults';

  return jsonb_build_object(
    'setup_bps',            coalesce((v->>'setup_bps')::int, 3000),
    'recurring_bps',        coalesce((v->>'recurring_bps')::int, 1000),
    'recurring_cap_months', coalesce((v->>'recurring_cap_months')::int, 12)
  );
end;
$$;

revoke all on function public.get_affiliate_public_defaults() from public, service_role;
grant execute on function public.get_affiliate_public_defaults() to anon, authenticated;

comment on function public.get_affiliate_public_defaults() is
  'Procentele publice ale programului de afiliere (pagina de prezentare /afiliat). Doar valorile de marketing — fără cascade/alte settings.';

-- ── Asserții fail-closed ────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'get_affiliate_public_defaults' and p.prosecdef
  ) then
    raise exception 'mig 189: get_affiliate_public_defaults lipsește';
  end if;
  if not has_function_privilege('anon', 'public.get_affiliate_public_defaults()', 'EXECUTE') then
    raise exception 'mig 189: anon nu poate citi procentele publice';
  end if;
  -- Nu expune cascade_bps (detaliu intern) — guard anti-regresie.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'get_affiliate_public_defaults'
       and pg_get_functiondef(p.oid) ilike '%cascade_bps%'
  ) then
    raise exception 'mig 189: funcția publică nu trebuie să expună cascade_bps';
  end if;
  -- SELECT-ul direct pe platform_settings rămâne founder-only.
  if has_table_privilege('anon', 'public.platform_settings', 'SELECT') then
    raise exception 'mig 189: anon poate citi platform_settings direct';
  end if;
  raise notice 'mig 189: procente publice afiliere OK';
end $$;

commit;
