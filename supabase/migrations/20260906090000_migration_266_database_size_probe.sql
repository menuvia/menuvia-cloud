-- migration_266_database_size_probe.sql
-- =============================================================================
-- Audit v3 — rangul 12, PARTEA DE ALARMĂ.
--
-- CE FACE: expune dimensiunea bazei către /health, ca plafonul de stocare să nu
-- fie descoperit în ziua în care Postgres trece în READ-ONLY — moment în care
-- platforma nu mai acceptă comenzi, la NICIUN restaurant. Aceeași filozofie ca
-- verificarea de prospețime a cron-ului adăugată după incidentul din 2–9 august:
-- un monitor lovit din AFARĂ, nu unul care trăiește în interiorul lucrului
-- monitorizat.
--
-- CE NU FACE, DELIBERAT: NU subțiază `audit_log`. Planul consiliului cerea și
-- stocarea doar a cheilor schimbate pe UPDATE-urile de pe `orders`. Măsurat pe
-- producție înainte de a scrie cod: baza are 21 MB (4,25% din plafonul de 500 MB
-- al planului Free), `audit_log` are 539 de rânduri și a crescut cu 14 în ultimele
-- 7 zile. Mecanismul semnalat de consiliu e real — `orders UPDATE` e tipul dominant
-- de rând, cu ~1704 octeți de payload (old_data + new_data complete) — dar la
-- volumul de AZI proiecția lui („depășește plafonul lunar la 500 de comenzi/zi")
-- e la ani distanță. Iar subțierea payload-ului înseamnă pierderea instantaneului
-- complet al rândului dintr-un jurnal FISCAL: nu mai poți reconstitui starea
-- comenzii la momentul T. Asta e o decizie despre ce trebuie să poată dovedi
-- auditul, nu una de performanță — se ia cu fondatorul, cu cifre pe masă.
-- Alarma de aici e exact lucrul care spune CÂND devine necesară.
--
-- SECURITY INVOKER, nu DEFINER, deliberat: `service_role` are deja EXECUTE pe
-- `pg_database_size` și CONNECT pe bază (verificat), deci DEFINER ar escalada
-- degeaba. Grant EXCLUSIV service_role — numele tabelelor și dimensiunile lor nu
-- au ce căuta pe suprafața anon/authenticated.
--
-- Teste permanente DB1–DB4: tests/sql/database_size_probe_assertions.sql.
-- =============================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';

create or replace function public.get_database_size()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'bytes',  pg_database_size(current_database()),
    'pretty', pg_size_pretty(pg_database_size(current_database())),
    -- Primele 5 tabele, ca alerta să vină cu diagnosticul în ea: fără asta,
    -- founderul primește „baza e la 85%" și nu știe de unde să taie.
    'top_tables', (
      select coalesce(jsonb_agg(t order by t.bytes desc), '[]'::jsonb)
        from (
          select c.relname::text                        as name,
                 pg_total_relation_size(c.oid)          as bytes,
                 pg_size_pretty(pg_total_relation_size(c.oid)) as pretty
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and c.relkind in ('r', 'p')
           order by pg_total_relation_size(c.oid) desc
           limit 5
        ) t
    )
  );
$$;

revoke all on function public.get_database_size() from public, anon, authenticated;
grant execute on function public.get_database_size() to service_role;

comment on function public.get_database_size() is
  'mig 266: dimensiunea bazei + primele 5 tabele, pentru alarma de stocare din /health. service_role EXCLUSIV. INVOKER deliberat (service_role are deja privilegiul; DEFINER ar escalada degeaba).';

-- ═════════════════════════════════════════════════════════════════════════════
-- Asserții fail-closed
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare v_oid oid; v_secdef boolean; v_cfg text;
begin
  select p.oid, p.prosecdef, array_to_string(p.proconfig, ',')
    into v_oid, v_secdef, v_cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_database_size';
  if v_oid is null then
    raise exception 'mig 266: get_database_size lipseste'; end if;

  -- (a) INVOKER, nu DEFINER — escaladarea inutila e un finding, nu o scapare.
  if v_secdef then
    raise exception 'mig 266: get_database_size a devenit SECURITY DEFINER (inutil: service_role are deja privilegiul)'; end if;

  -- (b) Igiena obligatorie de search_path (mig 194/262).
  if v_cfg is null or position('pg_temp' in v_cfg) = 0 then
    raise exception 'mig 266: get_database_size fara pg_temp in search_path'; end if;

  -- (c) Suprafata: DOAR service_role.
  if has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception 'mig 266: anon poate executa get_database_size'; end if;
  if has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'mig 266: authenticated poate executa get_database_size'; end if;
  if not has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'mig 266: service_role NU poate executa get_database_size'; end if;

  raise notice 'mig 266: get_database_size OK (INVOKER, service_role exclusiv)';
end $$;

commit;
