-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION 305 — `admin_list_affiliates` proiectează `sales_role` (pachetul 8b)
-- ═══════════════════════════════════════════════════════════════════════════
-- Mig 304 a adăugat `affiliates.sales_role` ('head' | 'agent' | NULL), iar lista
-- „Rețeaua” din panoul fondatorului (SalesNetworkPanel → `networkRows` din
-- lib/salesInviteFlow.ts) ia rolul afișat EXCLUSIV din câmpul ăsta — nu-l
-- ghicește din lipsa unui părinte (un afiliat din programul public n-are părinte,
-- dar nu e șef de vânzări). Doar că RPC-ul care alimentează lista NU îl
-- proiecta: câmpul lipsea din fiecare rând, clientul îl citea ca „rol
-- necunoscut” și TOȚI apăreau „Partener”, inclusiv șefii reali. Fondatorul nu
-- putea distinge, pe singura suprafață care arată rețeaua întreagă, un șef de
-- un partener din programul public — exact distincția pentru care 304 a creat
-- coloana (D8: sub un șef intră DOAR agenți cu contract).
--
-- Ce face: recreează `admin_list_affiliates` din ULTIMA ei definiție — lanț
-- 186→188→224→236→295→**305** — și adaugă O SINGURĂ cheie, `sales_role`, la
-- FINAL. Tot restul e copie VERBATIM a lui 295: cererea (224: phone /
-- application_note / reviewed_at), comisioanele (188: setup / recurring /
-- cascade bps + recurring_cap_months), brandingul (236: brand_domain / name /
-- logo), soldul RON, restaurantele atribuite, LEFT JOIN pe profil + `erased_at`
-- (295: afiliatul șters GDPR rămâne vizibil fondatorului), ordinea (cererile
-- pending întâi) și gate-ul `is_platform_admin()` cu ACELAȘI refuz
-- („Acces interzis”, P0001 — clientul nu se schimbă).
--
-- Tipul de retur rămâne `jsonb` și semnătura `()` → `create or replace` (fără
-- DROP; zero risc de PGRST203). `create or replace` REscrie `proconfig`, deci
-- `set search_path = public, pg_temp` e scris explicit. Regimul de privilegii e
-- re-aplicat IDENTIC cu 295: revoke per rol (public/anon/authenticated/
-- service_role) + EXECUTE doar `authenticated` (gate-ul din corp decide).
--
-- Valoarea NULL e semnificativă: cheia e MEREU prezentă (`jsonb_build_object`
-- scrie `null` JSON), deci clientul distinge „program public / afiliat vechi”
-- (NULL) de „proiecție veche” (cheie absentă) — `networkRoleOf` mapează
-- 'head' → Șef, 'agent' → Agent, null → Partener (program public), absent sau
-- orice altă valoare → Partener (rol necunoscut). CHECK-ul din 304 ține
-- valorile în ('head','agent').
--
-- Compatibilitate de deploy: frontend-ul tratează deja `sales_role` ca opțional,
-- deci ordinea (client înainte sau după migrație) e liberă.
--
-- Teste: AL1–AL3 `tests/sql/auto/305_admin_list_affiliates_sales_role.sql`
-- (rulează SUB rolul real `authenticated`; AL2 îngheață cheile vechi).
-- ═══════════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── admin_list_affiliates — lanț 186→188→224→236→295→305 ────────────────────
-- Copie a lui 295 (TOATE câmpurile) + `sales_role` la FINAL.
create or replace function public.admin_list_affiliates()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'affiliate_id',        a.id,
             -- mig 295: NULL după ștergerea GDPR (profilul a plecat).
             'email',               p.email,
             'full_name',           p.full_name,
             'referral_code',       a.referral_code,
             'status',              a.status,
             'parent_affiliate_id', a.parent_affiliate_id,
             -- Datele cererii (mig 224) — pentru interviul telefonic.
             'phone',               a.phone,
             'application_note',    a.application_note,
             'reviewed_at',         a.reviewed_at,
             -- Comisioanele curente (mig 188) — editabile din FounderPage.
             'setup_bps',            a.setup_bps,
             'recurring_bps',        a.recurring_bps,
             'cascade_bps',          a.cascade_bps,
             'recurring_cap_months', a.recurring_cap_months,
             -- White-label (mig 236) — editabil din FounderPage.
             'brand_domain',        a.brand_domain,
             'brand_name',          a.brand_name,
             'brand_logo_url',      a.brand_logo_url,
             'balance_ron_cents', (
               select coalesce(sum(l.amount_cents), 0)
                 from public.affiliate_ledger l
                where l.affiliate_id = a.id and l.currency = 'RON'
             ),
             'restaurants', (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'restaurant_id', r.id,
                        'name',          r.name,
                        'slug',          r.slug,
                        'plan',          op.plan,
                        'is_active',     r.is_active
                      ) order by r.name), '[]'::jsonb)
                 from public.affiliate_attributions aa
                 join public.restaurants r on r.owner_id = aa.referred_profile_id
                 join public.profiles op on op.id = r.owner_id
                where aa.affiliate_id = a.id
             ),
             'created_at',          a.created_at,
             -- mig 295: tombstone-ul ștergerii GDPR.
             'erased_at',           a.erased_at,
             -- mig 305 (la FINAL): rolul în rețeaua pe invitații (mig 304).
             -- NULL = program public / afiliat vechi; cheia e MEREU prezentă.
             'sales_role',          a.sales_role
           ) order by (a.status = 'pending') desc, a.created_at)
      from public.affiliates a
      -- LEFT (mig 295): profile_id e NULL după ștergere; rândul rămâne
      -- (ledger, payout-uri) și fondatorul trebuie să-l vadă.
      left join public.profiles p on p.id = a.profile_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_list_affiliates() from public, anon, authenticated, service_role;
grant execute on function public.admin_list_affiliates() to authenticated;

-- ── Asserții fail-closed ─────────────────────────────────────────────────────
do $$
declare
  v_fn   regprocedure := to_regprocedure('public.admin_list_affiliates()');
  v_n    int;
  v_src  text;
  k      text;
  -- Cheile de nivel 1 ale lui 295 (TOATE) + `sales_role`. O recreare care
  -- pierde vreuna dintre ele rupe FounderPage tăcut (câmpurile sunt opționale
  -- în client, deci UI-ul ar afișa „—”, nu o eroare).
  v_keys text[] := array[
    'affiliate_id', 'email', 'full_name', 'referral_code', 'status',
    'parent_affiliate_id', 'phone', 'application_note', 'reviewed_at',
    'setup_bps', 'recurring_bps', 'cascade_bps', 'recurring_cap_months',
    'brand_domain', 'brand_name', 'brand_logo_url', 'balance_ron_cents',
    'restaurants', 'created_at', 'erased_at', 'sales_role',
    -- cheile restaurantelor atribuite (obiectul imbricat)
    'restaurant_id', 'name', 'slug', 'plan', 'is_active'];
begin
  if v_fn is null then
    raise exception 'mig 305: public.admin_list_affiliates() lipsește';
  end if;

  -- O singură semnătură (anti-overload PostgREST / PGRST203).
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_list_affiliates';
  if v_n <> 1 then
    raise exception 'mig 305: admin_list_affiliates are % semnături (trebuie 1)', v_n;
  end if;

  -- DEFINER, STABLE, retur jsonb, search_path cu pg_temp.
  select p.prosrc into v_src from pg_proc p
   where p.oid = v_fn and p.prosecdef and p.provolatile = 's'
     and p.prorettype = 'jsonb'::regtype
     and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public, pg_temp');
  if v_src is null then
    raise exception 'mig 305: admin_list_affiliates nu e DEFINER/STABLE/jsonb cu search_path = public, pg_temp';
  end if;

  -- Gate-ul de fondator, cu ACELAȘI refuz ca înainte.
  if position('is_platform_admin()' in v_src) = 0
     or position('Acces interzis' in v_src) = 0 then
    raise exception 'mig 305: admin_list_affiliates fără gate-ul is_platform_admin / refuzul vechi';
  end if;

  -- Toate cheile (lanțul 188/224/236/295 + 305).
  foreach k in array v_keys loop
    if position('''' || k || '''' in v_src) = 0 then
      raise exception 'mig 305: admin_list_affiliates a pierdut cheia %', k;
    end if;
  end loop;
  if position('a.sales_role' in v_src) = 0 then
    raise exception 'mig 305: sales_role nu e citit din affiliates';
  end if;

  -- LEFT JOIN pe profil (295): un INNER ar ascunde afiliații șterși GDPR.
  if v_src ~* '(^|[^t])\s+join\s+public\.profiles\s+p\s+on\s+p\.id\s*=\s*a\.profile_id'
     or position('left join public.profiles p' in v_src) = 0 then
    raise exception 'mig 305: admin_list_affiliates face inner join pe profilul afiliatului';
  end if;

  -- Regimul de privilegii, identic cu 295.
  if has_function_privilege('public', v_fn, 'EXECUTE')
     or has_function_privilege('anon', v_fn, 'EXECUTE')
     or has_function_privilege('service_role', v_fn, 'EXECUTE')
     or not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception 'mig 305: grant-uri greșite pe admin_list_affiliates';
  end if;
end $$;

commit;
