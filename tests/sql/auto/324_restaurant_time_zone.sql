-- tests/sql/auto/324_restaurant_time_zone.sql
-- =============================================================================
-- TZ1–TZ9 — clichetul PERMANENT al mig 324: Happy Hour și plafonul lunar de SMS
-- se judecă în fusul RESTAURANTULUI. Autonom,
-- ROLLBACK la final. Apelurile sub rol REAL (`anon` / `authenticated` /
-- `service_role`) sunt `execute` DINAMIC: un apel static își cachează
-- verificarea EXECUTE (capcana TS4 din 312). Instantele sunt FIXE (DST, ziua
-- săptămânii, wrap-around), iar unde contează `now()` (înghețat per tranzacție)
-- scenariul e construit relativ la el, deci deterministic la orice oră a CI-ului.
--
-- Fixtură — câte un OWNER per restaurant (`enforce_restaurant_limit`, 131),
-- plan growth (order_qr + sms_notifications), țara și fusul la INSERT:
--   NY   US 'America/New_York'   AKL  NZ 'Pacific/Auckland'
--   BUC  RO 'Europe/Bucharest'   BAD  RO 'Mars/Olympus' (invalid → București)
--   LOW  US 'america/new_york' (minuscule → numele canonic)
--   NY7 / NY7OFF  US 'America/New_York' (TZ7; al doilea `is_active = false`)
--   KIR  US 'Pacific/Kiritimati' (TZ8f; mutat pe 'Pacific/Pago_Pago' de owner)
--
--   TZ1  `safe_time_zone` cu scurtătura = calea lentă (oracolul = corpul 298)
--        pe NULL, '', București în trei capitalizări, cu spațiu, fus inexistent
--        din Europa, NY, AKL, POSIX, posixrules/localtime/Factory; control
--        pozitiv pe minuscule. TZ1b: scurtătura există (clichet de performanță).
--        [PICĂ: scurtătura pe `lower()` (M1); `like 'Europe/%'` (M2);
--         scurtătura scoasă (M3, TZ1b); fallback-ul pe 'UTC' (M11)]
--   TZ2  `restaurant_time_zone`: NY, LOW → canonic, BAD → București, BUC,
--        restaurant inexistent → București.
--        [PICĂ: `coalesce(r.timezone, …)` fără validare (M4)]
--   TZ3  nucleul `_happy_hour_rules_at` pe trei instante FIXE de vineri, rulat
--        sub TimeZone de sesiune UTC ȘI Australia/Sydney: matricea 5×3 (NY, AKL,
--        BUC, BAD, LOW × 18:00 la NY / la București / la Auckland).
--        [PICĂ: fusul București în nucleu (M5); fusul brut, nevalidat (M6:
--         BAD aruncă „time zone not recognized”); `isodow` fără conversie (M7)]
--   TZ4  wrap-around la Auckland (sâmbătă 22:00–02:00): sâm 23:30 activă,
--        dum 01:00 INACTIVĂ, sâm 01:00 activă — îngheață semantica EXISTENTĂ
--        „ziua curentă” (rezidual de decis, nu specificație).
--        [PICĂ: M5 (sâm 23:30 NZ = 12:30 la București); ziua de SERVICIU în
--         stilul 241 (M8)]
--   TZ5  DST: NY 17:00–19:00 de o parte și de alta a 1 nov 2026 (EDT/EST),
--        AKL de o parte și de alta a 27 sep 2026 (NZST/NZDT).
--        [PICĂ: ofset FIX luat la `now()` (M9)]
--   TZ6  control RO: pe o grilă din 30 în 30 de minute 24.10–01.11.2026 (ora
--        României, traversează DST-ul din 25.10 — 386 de instante, ora 03:xx
--        apare de două ori), mulțimea regulilor active pe BUC == ORACOLUL care
--        copiază VERBATIM predicatul 077 cu fusul București; același oracol pe
--        BAD (fiecare a treia instanță — calea lentă costă ~10 ms/apel). Control
--        pozitiv: fiecare regulă e și activă, și inactivă pe grilă.
--        [PICĂ: M7; `<` în loc de `<=` la `ends_at` (M10); fallback-ul pe 'UTC'
--         (M11 — prins întâi de TZ1, apoi de TZ3 pe BAD)]
--   TZ7  învelișurile cap-coadă, relativ la `now()`: pe NY7, regula A (10%) în
--        fereastra ±30 min a orei NY, regula B (50%) în fereastra ±30 min a
--        orei BUCUREȘTIULUI (mereu în afară: |Δ| ≥ 6 h).
--        a) `public_happy_hour_now(NY7)` sub `anon` REAL → {A};
--        b) NY7OFF (restaurant inactiv, aceleași reguli) → ∅;
--        c) `evaluate_happy_hour_for_now` sub `authenticated` REAL: owner → {A},
--           străin → 'Not a member';
--        d) BANII: comandă QR pe NY7 → reducere 10% („Happy Hour: TZ A”), NU 50%;
--        e) consumatorii (`_apply_happy_hour_auto`, `update_order_items`,
--           `suggest_…`) cheamă încă învelișurile.
--        [PICĂ: corpurile 077/036 vechi (M12: a, c, d); fără filtrul pe
--         restaurant activ (M13: b); fără `is_member` (M14: c); trigger-ul
--         repointat pe nucleu (M15: e)]
--   TZ8  SMS. a) `_restaurant_month` (eticheta lunii) pe instante fixe, de o parte
--        și de alta a graniței locale, sub două TimeZone-uri de sesiune (NY: granița
--        1 nov 04:00Z, EDT — nu 05:00Z; AKL: 30 sep 11:00Z; BUC/BAD: 31 oct
--        22:00Z = formula veche); a') ștampila `cap_month` de la INSERT = eticheta
--        lui `created_at`. b) rânduri la granița lunii LOCALE ±1 min +
--        un `cancelled` după ea → `get_sms_usage` (owner, `authenticated` REAL)
--        = 1 pe NY și pe AKL — codul vechi dă 2 sau 0, după cum România e în
--        aceeași lună sau deja în următoarea, deci pică în AMBELE cazuri de
--        calendar. d) control RO pe granița veche ±1 min = 1. e) `enqueue_sms` sub
--        `service_role` REAL → non-null (lanțul EXECUTE DEFINER → helperi închiși;
--        concludent doar acolo unde proprietarul NU e superuser).
--        c) plafon 2 pe NY: primul `enqueue_sms` trece, al doilea e null.
--        f) OCOLIREA prin schimbarea fusului (recenzia adversarială pe G2a): pe
--        KIR (UTC+14) două SMS-uri la 1 minut după începutul lunii L în fusul lui
--        (L = luna de ACUM la Pago Pago, deci instantul e mereu în trecut), apoi
--        owner-ul (sub `authenticated` REAL) mută fusul pe Pago Pago (UTC−11,
--        luna L începe cu 25 h mai târziu). Cu plafonul 2, al treilea SMS e
--        refuzat și contorul arată 2; controale: ștampilele au rămas L, iar o
--        fereastră din fusul CURENT le-ar fi exclus (scenariul chiar e ocolirea);
--        pozitiv: cu plafonul 3 același apel trece.
--        [PICĂ: corpurile 228 vechi (M16: b, c); doar `get_sms_usage` convertit
--         (M17a: c); doar `enqueue_sms` convertit (M17b: b); `cancelled` numărat
--         (M18: b); numărătoarea pe fereastra fusului CURENT, `created_at >=
--         începutul lunii acum` (M27: f — exact codul de dinaintea recenziei);
--         numărătoarea pe `_restaurant_month(restaurant_id, created_at)` re-
--         calculat (M28: f); ștampila din `now()` în loc de `created_at` (M29: a')]
--   TZ9  clichet structural VIU (asserțiile migrației rulează o singură dată):
--        fără literalul de fus București în cele 8 corpuri; învelișurile deleagă
--        nucleului și nu mai calculează ziua; perechea SMS numără pe `cap_month`
--        (fără `created_at >=`, fără trunchiere proprie); nucleul HH și eticheta
--        lunii cheamă fusul EXACT o dată, în variabilă, nu în interogare (o
--        evaluare per rând costă ~10 ms/rând pe un local din afara României);
--        coloana `cap_month` date NOT NULL + trigger BEFORE INSERT ROW (tgtype 7);
--        o singură semnătură pe fiecare din cele 9 nume; helperii INVOKER cu
--        pg_temp, fără EXECUTE pentru anon / authenticated / service_role /
--        PUBLIC, iar apelul REAL ca `authenticated` dă 42501 „for function”;
--        contractul ACL al învelișurilor; același proprietar.
--        [PICĂ: corpul 077 copiat înapoi (M12); grant către anon pe un helper
--         (M22); helper promovat la DEFINER (M23); al doilea overload (M24 —
--         prins întâi de TZ2: literalul se leagă de overload-ul `text`);
--         proprietar diferit (M25); fusul evaluat per rând în nucleul HH (M26);
--         trigger-ul de ștampilă `or update` (M30); luna CURENTĂ din perechea
--         SMS calculată pe alt fus decât ștampila — `_restaurant_month(null,
--         now())` = București (M31: trece de TOT TZ8 în afara orelor de graniță,
--         fiindcă `now()` nu se poate muta, deci doar clichetul o vede);
--         lacătul FOR SHARE pe restaurant scos din `enqueue_sms` sau mutat după
--         calculul lunii (M32: cursa e între două sesiuni — schimbarea de fus
--         comisă între numărătoare și ștampilă —, deci doar clichetul o vede)]
--
-- `report_by_hour` NU e în 324 (recenzia adversarială): singurul consumator e
-- suprafața FISCALĂ (ReportsTab sub `fiscalReports`, `money === 3`, adică doar
-- România), deci rămâne pe lanțul 122 și se decide în G2b cu fereastra.
--
-- Mutațiile M1–M32 (fără M19–M21, retrase odată cu `report_by_hour`) au fost
-- verificate pe un cluster de replay (KEEP=1
-- scripts/verify-migrations-local.sh), fiecare într-o tranzacție derulată
-- înapoi: suita pică EXACT la testul notat. Unde o mutație e prinsă de un test
-- ANTERIOR celui care o descrie (M5, M7, M11, M12, M16, M24), testul descris a
-- fost verificat separat, pe o copie a suitei fără testele anterioare: M5 → TZ4,
-- M7 → TZ6, M11 → TZ6 (BAD), M12 → TZ7d și TZ9, M16 → TZ9, M24 → TZ9.
-- TZ8e NU poate pica local: pe Postgres gol proprietarul e superuser și ocolește
-- orice ACL; mutația „helper revocat de la proprietar” e concludentă doar unde
-- proprietarul NU e superuser (stack-ul Supabase din jobul E2E, dacă `postgres`
-- e acolo ne-superuser — nedovedit local), iar clasa „alt proprietar” o ține
-- TZ9 (M25) pe ambele medii.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Fixtură ──────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('32400000-0000-4000-8000-000000000001', 'tz-ny@tz324.test'),
  ('32400000-0000-4000-8000-000000000002', 'tz-akl@tz324.test'),
  ('32400000-0000-4000-8000-000000000003', 'tz-buc@tz324.test'),
  ('32400000-0000-4000-8000-000000000004', 'tz-bad@tz324.test'),
  ('32400000-0000-4000-8000-000000000005', 'tz-low@tz324.test'),
  ('32400000-0000-4000-8000-000000000006', 'tz-ny7@tz324.test'),
  ('32400000-0000-4000-8000-000000000007', 'tz-ny7off@tz324.test'),
  ('32400000-0000-4000-8000-000000000008', 'tz-stranger@tz324.test'),
  ('32400000-0000-4000-8000-000000000009', 'tz-kir@tz324.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email)
  select id, email from auth.users where email like 'tz-%@tz324.test'
  on conflict (id) do nothing;
update public.profiles set plan = 'growth'
 where id in ('32400000-0000-4000-8000-000000000001', '32400000-0000-4000-8000-000000000002',
              '32400000-0000-4000-8000-000000000003', '32400000-0000-4000-8000-000000000004',
              '32400000-0000-4000-8000-000000000005', '32400000-0000-4000-8000-000000000006',
              '32400000-0000-4000-8000-000000000007', '32400000-0000-4000-8000-000000000009');

insert into public.restaurants (id, owner_id, name, slug, city, is_active, country, timezone) values
  ('324b0000-0000-4000-8000-000000000001', '32400000-0000-4000-8000-000000000001', 'TZ NY',  'tz324-ny',  'New York', true, 'US', 'America/New_York'),
  ('324b0000-0000-4000-8000-000000000002', '32400000-0000-4000-8000-000000000002', 'TZ AKL', 'tz324-akl', 'Auckland', true, 'NZ', 'Pacific/Auckland'),
  ('324b0000-0000-4000-8000-000000000003', '32400000-0000-4000-8000-000000000003', 'TZ BUC', 'tz324-buc', 'Cluj',     true, 'RO', 'Europe/Bucharest'),
  ('324b0000-0000-4000-8000-000000000004', '32400000-0000-4000-8000-000000000004', 'TZ BAD', 'tz324-bad', 'Nicăieri', true, 'RO', 'Mars/Olympus'),
  ('324b0000-0000-4000-8000-000000000005', '32400000-0000-4000-8000-000000000005', 'TZ LOW', 'tz324-low', 'New York', true, 'US', 'america/new_york'),
  ('324b0000-0000-4000-8000-000000000006', '32400000-0000-4000-8000-000000000006', 'TZ NY7', 'tz324-ny7', 'New York', true, 'US', 'America/New_York'),
  ('324b0000-0000-4000-8000-000000000007', '32400000-0000-4000-8000-000000000007', 'TZ NY7 oprit', 'tz324-ny7off', 'New York', false, 'US', 'America/New_York'),
  ('324b0000-0000-4000-8000-000000000009', '32400000-0000-4000-8000-000000000009', 'TZ KIR', 'tz324-kir', 'Kiritimati', true, 'US', 'Pacific/Kiritimati');

insert into public.restaurant_modules (restaurant_id, module_key, enabled) values
  ('324b0000-0000-4000-8000-000000000001', 'sms_notifications', true),
  ('324b0000-0000-4000-8000-000000000002', 'sms_notifications', true),
  ('324b0000-0000-4000-8000-000000000003', 'sms_notifications', true),
  ('324b0000-0000-4000-8000-000000000009', 'sms_notifications', true);

-- Regulă activă la instantul dat? (după id — mai multe reguli pe același local)
create function pg_temp.tz_on(p_rest uuid, p_at timestamptz, p_rule uuid) returns boolean
language sql stable as $$
  select exists (select 1 from public._happy_hour_rules_at(p_rest, p_at) h where h.id = p_rule);
$$;

-- Instant = ora de perete dată într-un fus dat (independent de TimeZone-ul sesiunii).
create function pg_temp.tz_at(p_wall text, p_tz text) returns timestamptz
language sql immutable as $$ select p_wall::timestamp at time zone p_tz; $$;

-- SQLSTATE + mesaj al unei instrucțiuni (NULL = a trecut).
create function pg_temp.tz_catch(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- ── TZ1: scurtătura == calea lentă ───────────────────────────────────────────
-- Oracolul = corpul 298 VERBATIM (calea lentă, fără scurtătură).
create function pg_temp.tz_slow(p_tz text) returns text
language sql stable as $$
  select coalesce(
    (select n.name
       from pg_catalog.pg_timezone_names n
      where lower(n.name) = lower(p_tz)
        and n.name not in ('localtime', 'posixrules', 'Factory')
      order by n.name collate "C"
      limit 1),
    'Europe/Bucharest');
$$;

do $$
declare
  v_in text;
  v_n  int := 0;
begin
  -- control pozitiv: oracolul chiar canonicalizează (altfel TZ1 ar fi vacuu)
  if pg_temp.tz_slow('america/new_york') is distinct from 'America/New_York'
     or public.safe_time_zone('america/new_york') is distinct from 'America/New_York' then
    raise exception 'TZ1 FAIL (control): oracolul/helperul nu canonicalizează america/new_york';
  end if;
  foreach v_in in array array[null, '', 'Europe/Bucharest', 'europe/bucharest', 'EUROPE/BUCHAREST',
                              'Europe/Bucharest ', ' Europe/Bucharest', 'Europe/Nowhere', 'America/New_York',
                              'Pacific/Auckland', 'UTC+3', 'posixrules', 'localtime', 'Factory']::text[] loop
    if public.safe_time_zone(v_in) is distinct from pg_temp.tz_slow(v_in) then
      raise exception 'TZ1 FAIL: safe_time_zone(%) = % ≠ calea lentă %',
        coalesce(quote_literal(v_in), 'NULL'), public.safe_time_zone(v_in), pg_temp.tz_slow(v_in);
    end if;
    v_n := v_n + 1;
  end loop;
  -- TZ1b: scurtătura (performanță) — fără ea, fiecare apel pe București ~10 ms.
  if position($q$p_tz = 'Europe/Bucharest'$q$ in
       (select prosrc from pg_proc where oid = 'public.safe_time_zone(text)'::regprocedure)) = 0 then
    raise exception 'TZ1b FAIL: safe_time_zone a pierdut scurtătura pentru București';
  end if;
  raise notice 'TZ1 OK: % intrări identice cu calea lentă; scurtătura prezentă (TZ1b)', v_n;
end $$;

-- ── TZ2: restaurant_time_zone ────────────────────────────────────────────────
do $$
begin
  if public.restaurant_time_zone('324b0000-0000-4000-8000-000000000001') is distinct from 'America/New_York'
     or public.restaurant_time_zone('324b0000-0000-4000-8000-000000000002') is distinct from 'Pacific/Auckland' then
    raise exception 'TZ2 FAIL: fusul valid nu e întors (NY/AKL)';
  end if;
  if public.restaurant_time_zone('324b0000-0000-4000-8000-000000000005') is distinct from 'America/New_York' then
    raise exception 'TZ2 FAIL: fusul scris cu minuscule nu e canonicalizat (%)',
      public.restaurant_time_zone('324b0000-0000-4000-8000-000000000005');
  end if;
  if public.restaurant_time_zone('324b0000-0000-4000-8000-000000000004') is distinct from 'Europe/Bucharest' then
    raise exception 'TZ2 FAIL: fusul invalid nu cade pe București (%)',
      public.restaurant_time_zone('324b0000-0000-4000-8000-000000000004');
  end if;
  if public.restaurant_time_zone('324b0000-0000-4000-8000-000000000003') is distinct from 'Europe/Bucharest'
     or public.restaurant_time_zone('324b0000-0000-4000-8000-0000000000ff') is distinct from 'Europe/Bucharest'
     or public.restaurant_time_zone(null) is distinct from 'Europe/Bucharest' then
    raise exception 'TZ2 FAIL: BUC / restaurant inexistent / NULL nu dau București';
  end if;
  raise notice 'TZ2 OK: fusul localului validat, inexistent/invalid → București';
end $$;

-- ── TZ3: matricea pe instante fixe de vineri ─────────────────────────────────
-- Regula R3 pe fiecare restaurant: vineri (dow 6), 17:00–19:00.
insert into public.happy_hour_rules (id, restaurant_id, name, is_active, starts_at, ends_at, days_of_week,
                                     scope, discount_type, discount_value)
select ('324a0000-0000-4000-8000-00000000030' || s)::uuid, ('324b0000-0000-4000-8000-00000000000' || s)::uuid,
       'TZ R3', true, '17:00', '19:00', array[6]::smallint[], 'all', 'percent', 10
  from generate_series(1, 5) s;

do $$
declare
  v_tz      text;
  v_r       int;
  v_i       int;
  v_got     boolean;
  -- I1 = vineri 13.11.2026 18:00 la NY (sâmbătă 01:00 la București);
  -- I2 = vineri 18:00 la București (11:00 la NY);
  -- I3 = vineri 18:00 la Auckland (07:00 la București, 00:00 la NY).
  v_inst    timestamptz[] := array[pg_temp.tz_at('2026-11-13 18:00', 'America/New_York'),
                                   pg_temp.tz_at('2026-11-13 18:00', 'Europe/Bucharest'),
                                   pg_temp.tz_at('2026-11-13 18:00', 'Pacific/Auckland')];
  -- rânduri: NY, AKL, BUC, BAD, LOW; coloane: I1, I2, I3
  v_expect  boolean[] := array[[true,  false, false],
                               [false, false, true ],
                               [false, true,  false],
                               [false, true,  false],
                               [true,  false, false]];
  v_old_tz  text := current_setting('TimeZone');
begin
  foreach v_tz in array array['UTC', 'Australia/Sydney'] loop
    perform set_config('TimeZone', v_tz, true);
    for v_r in 1..5 loop
      for v_i in 1..3 loop
        v_got := pg_temp.tz_on(('324b0000-0000-4000-8000-00000000000' || v_r)::uuid, v_inst[v_i],
                               ('324a0000-0000-4000-8000-00000000030' || v_r)::uuid);
        if v_got is distinct from v_expect[v_r][v_i] then
          raise exception 'TZ3 FAIL: restaurantul % la instantul I% (sesiune %) → activ=% (așteptat %)',
            (array['NY', 'AKL', 'BUC', 'BAD', 'LOW'])[v_r], v_i, v_tz, v_got, v_expect[v_r][v_i];
        end if;
      end loop;
    end loop;
  end loop;
  perform set_config('TimeZone', v_old_tz, true);
  raise notice 'TZ3 OK: matricea 5×3 identică sub TimeZone UTC și Australia/Sydney';
end $$;

-- ── TZ4: wrap-around la Auckland, ziua CURENTĂ ───────────────────────────────
insert into public.happy_hour_rules (id, restaurant_id, name, is_active, starts_at, ends_at, days_of_week,
                                     scope, discount_type, discount_value) values
  ('324a0000-0000-4000-8000-000000000402', '324b0000-0000-4000-8000-000000000002', 'TZ R4 wrap',
   true, '22:00', '02:00', array[7]::smallint[], 'all', 'percent', 10);
do $$
declare
  c_akl  constant uuid := '324b0000-0000-4000-8000-000000000002';
  c_rule constant uuid := '324a0000-0000-4000-8000-000000000402';
begin
  -- sâmbătă 14.11.2026 23:30 NZDT = 10:30Z = 12:30 la București
  if not pg_temp.tz_on(c_akl, pg_temp.tz_at('2026-11-14 23:30', 'Pacific/Auckland'), c_rule) then
    raise exception 'TZ4 FAIL: sâmbătă 23:30 la Auckland, regula de sâmbătă 22:00–02:00 e inactivă';
  end if;
  -- duminică 15.11.2026 01:00 NZDT: ora e în fereastră, dar ziua CURENTĂ e duminică
  if pg_temp.tz_on(c_akl, pg_temp.tz_at('2026-11-15 01:00', 'Pacific/Auckland'), c_rule) then
    raise exception 'TZ4 FAIL: duminică 01:00 la Auckland e activă — semantica „ziua curentă” s-a schimbat tăcut (ziua de serviciu cere decizie)';
  end if;
  -- sâmbătă 14.11.2026 01:00 NZDT: ziua curentă e sâmbătă, ora în fereastră
  if not pg_temp.tz_on(c_akl, pg_temp.tz_at('2026-11-14 01:00', 'Pacific/Auckland'), c_rule) then
    raise exception 'TZ4 FAIL: sâmbătă 01:00 la Auckland e inactivă (ziua curentă = sâmbătă)';
  end if;
  raise notice 'TZ4 OK: wrap-around în fusul localului, ziua curentă (semantica existentă)';
end $$;

-- ── TZ5: DST ─────────────────────────────────────────────────────────────────
insert into public.happy_hour_rules (id, restaurant_id, name, is_active, starts_at, ends_at, days_of_week,
                                     scope, discount_type, discount_value) values
  ('324a0000-0000-4000-8000-000000000501', '324b0000-0000-4000-8000-000000000001', 'TZ R5 NY',
   true, '17:00', '19:00', array[]::smallint[], 'all', 'percent', 10),
  ('324a0000-0000-4000-8000-000000000502', '324b0000-0000-4000-8000-000000000002', 'TZ R5 AKL',
   true, '17:00', '19:00', array[]::smallint[], 'all', 'percent', 10);
do $$
declare
  c_ny   constant uuid := '324b0000-0000-4000-8000-000000000001';
  c_akl  constant uuid := '324b0000-0000-4000-8000-000000000002';
  c_rny  constant uuid := '324a0000-0000-4000-8000-000000000501';
  c_rakl constant uuid := '324a0000-0000-4000-8000-000000000502';
  r record;
begin
  for r in
    select * from (values
      (c_ny,  c_rny,  timestamptz '2026-10-31 21:30:00+00', true,  'NY 17:30 EDT'),
      (c_ny,  c_rny,  timestamptz '2026-10-31 23:30:00+00', false, 'NY 19:30 EDT'),
      (c_ny,  c_rny,  timestamptz '2026-11-02 22:30:00+00', true,  'NY 17:30 EST'),
      (c_ny,  c_rny,  timestamptz '2026-11-02 21:30:00+00', false, 'NY 16:30 EST'),
      (c_akl, c_rakl, timestamptz '2026-09-26 05:30:00+00', true,  'AKL 17:30 NZST'),
      (c_akl, c_rakl, timestamptz '2026-09-28 04:30:00+00', true,  'AKL 17:30 NZDT'),
      (c_akl, c_rakl, timestamptz '2026-09-28 06:30:00+00', false, 'AKL 19:30 NZDT')
    ) v(rest, rule, at_, expect, label)
  loop
    if pg_temp.tz_on(r.rest, r.at_, r.rule) is distinct from r.expect then
      raise exception 'TZ5 FAIL: % → activ=% (așteptat %)', r.label, not r.expect, r.expect;
    end if;
  end loop;
  raise notice 'TZ5 OK: fereastra urmează ora de perete de o parte și de alta a schimbării de oră';
end $$;

-- ── TZ6: control RO pe grilă, identic cu 077 ─────────────────────────────────
insert into public.happy_hour_rules (id, restaurant_id, name, is_active, starts_at, ends_at, days_of_week,
                                     scope, discount_type, discount_value)
select ('324a0000-0000-4000-8000-0000000006' || s || k)::uuid, ('324b0000-0000-4000-8000-00000000000' || s)::uuid,
       'TZ R6 ' || k, true, v.st::time, v.en::time, v.days::smallint[], 'all', 'percent', 10
  from (values (3), (4)) rs(s)
 cross join lateral (values (1, '11:30', '14:00', '{}'), (2, '22:00', '02:00', '{}'), (3, '08:00', '20:00', '{2,6}'))
       v(k, st, en, days);

-- ORACOLUL = predicatul 077 VERBATIM, cu fusul București.
create function pg_temp.tz_oracle077(p_rest uuid, p_at timestamptz) returns uuid[]
language plpgsql stable as $$
declare v_now_time time; v_now_dow smallint;
begin
  v_now_time := (p_at at time zone 'Europe/Bucharest')::time;
  v_now_dow  := extract(isodow from (p_at at time zone 'Europe/Bucharest'))::smallint;
  v_now_dow  := case when v_now_dow = 7 then 1 else v_now_dow + 1 end;
  return array(
    select r.id from public.happy_hour_rules r
     where r.restaurant_id = p_rest
       and r.is_active = true
       and (cardinality(r.days_of_week) = 0 OR v_now_dow = ANY(r.days_of_week))
       and ((r.ends_at >= r.starts_at AND v_now_time >= r.starts_at AND v_now_time <= r.ends_at)
            OR (r.ends_at < r.starts_at AND (v_now_time >= r.starts_at OR v_now_time <= r.ends_at)))
     order by r.id);
end $$;

do $$
declare
  c_buc constant uuid := '324b0000-0000-4000-8000-000000000003';
  c_bad constant uuid := '324b0000-0000-4000-8000-000000000004';
  v_t    timestamptz;
  v_i    int := 0;
  v_n    int := 0;
  v_got  uuid[];
  v_exp  uuid[];
  v_hits int[] := array[0, 0, 0];
  v_k    int;
  v_dup  int;
begin
  for v_t in
    select g from generate_series(pg_temp.tz_at('2026-10-24 00:00', 'Europe/Bucharest'),
                                  pg_temp.tz_at('2026-11-01 00:00', 'Europe/Bucharest') - interval '30 minutes',
                                  interval '30 minutes') g
  loop
    v_i := v_i + 1;
    v_got := array(select h.id from public._happy_hour_rules_at(c_buc, v_t) h order by h.id);
    v_exp := pg_temp.tz_oracle077(c_buc, v_t);
    if v_got is distinct from v_exp then
      raise exception 'TZ6 FAIL: BUC la % (ora României %) → % ≠ oracolul 077 %',
        v_t, v_t at time zone 'Europe/Bucharest', v_got, v_exp;
    end if;
    for v_k in 1..3 loop
      if ('324a0000-0000-4000-8000-00000000063' || v_k)::uuid = any(v_got) then
        v_hits[v_k] := v_hits[v_k] + 1;
      end if;
    end loop;
    if v_i % 3 = 0 then
      v_n := v_n + 1;
      v_got := array(select h.id from public._happy_hour_rules_at(c_bad, v_t) h order by h.id);
      v_exp := pg_temp.tz_oracle077(c_bad, v_t);
      if v_got is distinct from v_exp then
        raise exception 'TZ6 FAIL: BAD (fus invalid) la % → % ≠ oracolul 077 %', v_t, v_got, v_exp;
      end if;
    end if;
  end loop;
  -- controlul grilei: traversează DST-ul (ora 03:xx de două ori) și are 8 zile + 1 h
  select count(*) into v_dup
    from (select g at time zone 'Europe/Bucharest' as w
            from generate_series(pg_temp.tz_at('2026-10-24 00:00', 'Europe/Bucharest'),
                                 pg_temp.tz_at('2026-11-01 00:00', 'Europe/Bucharest') - interval '30 minutes',
                                 interval '30 minutes') g) s
   group by w having count(*) > 1;
  if v_i <> 386 or v_dup is null then
    raise exception 'TZ6 FAIL (control): grila are % instante (așteptat 386) / nu traversează DST-ul', v_i;
  end if;
  -- control pozitiv: fiecare regulă e și activă, și inactivă pe grilă
  for v_k in 1..3 loop
    if v_hits[v_k] = 0 or v_hits[v_k] = v_i then
      raise exception 'TZ6 FAIL (control): regula R6 % e activă pe % din % instante — testul ar fi vacuu',
        v_k, v_hits[v_k], v_i;
    end if;
  end loop;
  raise notice 'TZ6 OK: % instante BUC + % BAD identice cu oracolul 077 (activări R6: %)', v_i, v_n, v_hits;
end $$;

-- ── TZ7: învelișurile cap-coadă, relativ la now() ────────────────────────────
-- A (10%): ±30 min în jurul orei de perete a NY, zilele = {ziua NY de azi}.
-- B (50%): ±30 min în jurul orei BUCUREȘTIULUI, toate zilele — la NY e mereu în
-- afară (diferența e de 6 sau 7 ore), dar codul vechi o vedea activă.
insert into public.happy_hour_rules (id, restaurant_id, name, is_active, starts_at, ends_at, days_of_week,
                                     scope, discount_type, discount_value)
select ('324a0000-0000-4000-8000-0000000007' || s || 'a')::uuid, ('324b0000-0000-4000-8000-00000000000' || s)::uuid,
       'TZ A', true,
       ((now() at time zone 'America/New_York')::time - interval '30 minutes'),
       ((now() at time zone 'America/New_York')::time + interval '30 minutes'),
       array[(case when extract(isodow from now() at time zone 'America/New_York') = 7 then 1
                   else extract(isodow from now() at time zone 'America/New_York') + 1 end)::smallint],
       'all', 'percent'::public.order_discount_type, 10
  from (values (6), (7)) v(s)
union all
select ('324a0000-0000-4000-8000-0000000007' || s || 'b')::uuid, ('324b0000-0000-4000-8000-00000000000' || s)::uuid,
       'TZ B', true,
       ((now() at time zone 'Europe/Bucharest')::time - interval '30 minutes'),
       ((now() at time zone 'Europe/Bucharest')::time + interval '30 minutes'),
       array[]::smallint[], 'all', 'percent'::public.order_discount_type, 50
  from (values (6), (7)) v(s);

insert into public.tables (id, restaurant_id, name, slug, is_active, seats) values
  ('324c0000-0000-4000-8000-000000000006', '324b0000-0000-4000-8000-000000000006', 'TZ Masa 1', 'tz324-masa-1', true, 4);
insert into public.qr_tokens (id, restaurant_id, table_id, token, is_active) values
  ('324d0000-0000-4000-8000-000000000006', '324b0000-0000-4000-8000-000000000006',
   '324c0000-0000-4000-8000-000000000006', 'tok_tz324_ny7', true);
insert into public.categories (id, restaurant_id, name) values
  ('324e0000-0000-4000-8000-000000000006', '324b0000-0000-4000-8000-000000000006', 'TZ Băuturi');
insert into public.products (id, restaurant_id, category_id, name, price, vat_group, is_active, is_draft) values
  ('324f0000-0000-4000-8000-000000000006', '324b0000-0000-4000-8000-000000000006',
   '324e0000-0000-4000-8000-000000000006', 'TZ Limonadă', 20.00, 1, true, false);

do $$
declare
  c_ny7    constant uuid := '324b0000-0000-4000-8000-000000000006';
  c_ny7off constant uuid := '324b0000-0000-4000-8000-000000000007';
  c_a      constant uuid := '324a0000-0000-4000-8000-00000000076a';
  v_ids    uuid[];
  v_err    text;
begin
  -- a) învelișul public sub anon REAL
  perform set_config('role', 'anon', true);
  execute 'select coalesce(array_agg(h.id order by h.id), ''{}''::uuid[]) from public.public_happy_hour_now($1) h'
     into v_ids using c_ny7;
  perform set_config('role', 'none', true);
  if v_ids is distinct from array[c_a] then
    raise exception 'TZ7a FAIL: public_happy_hour_now(NY7) ca anon → % (așteptat doar regula A, în ora NY)', v_ids;
  end if;

  -- b) control pozitiv: restaurantul inactiv nu întoarce nimic, deși regulile lui sunt active
  perform set_config('role', 'anon', true);
  execute 'select coalesce(array_agg(h.id order by h.id), ''{}''::uuid[]) from public.public_happy_hour_now($1) h'
     into v_ids using c_ny7off;
  perform set_config('role', 'none', true);
  if v_ids is distinct from '{}'::uuid[] then
    raise exception 'TZ7b FAIL: restaurantul INACTIV întoarce reguli %', v_ids;
  end if;
  if not exists (select 1 from public._happy_hour_rules_at(c_ny7off, now())) then
    raise exception 'TZ7b FAIL (control): regula A a NY7OFF nu e activă în nucleu — b) ar fi vacuu';
  end if;

  -- c) învelișul de personal sub authenticated REAL
  perform set_config('request.jwt.claim.sub', '32400000-0000-4000-8000-000000000006', true);
  perform set_config('role', 'authenticated', true);
  execute 'select coalesce(array_agg(h.id order by h.id), ''{}''::uuid[]) from public.evaluate_happy_hour_for_now($1) h'
     into v_ids using c_ny7;
  perform set_config('role', 'none', true);
  if v_ids is distinct from array[c_a] then
    raise exception 'TZ7c FAIL: evaluate_happy_hour_for_now(NY7) ca owner → % (așteptat doar regula A)', v_ids;
  end if;
  perform set_config('request.jwt.claim.sub', '32400000-0000-4000-8000-000000000008', true);
  perform set_config('role', 'authenticated', true);
  v_err := pg_temp.tz_catch(format('select * from public.evaluate_happy_hour_for_now(%L)', c_ny7));
  perform set_config('role', 'none', true);
  if v_err is null or v_err not like '%Not a member of this restaurant%' then
    raise exception 'TZ7c FAIL: un cont fără restaurant citește regulile NY7 (%)', coalesce(v_err, 'a trecut');
  end if;
  perform set_config('request.jwt.claim.sub', '', true);
  raise notice 'TZ7a–c OK: învelișurile întorc regula din ora NY, nu pe cea din ora Bucureștiului';
end $$;

-- d) BANII: comanda QR pe NY7 primește 10% (A), nu 50% (B)
select set_config('request.jwt.claim.role', 'anon', true);
do $$
declare v_sess jsonb; v_sid uuid; v_res jsonb; v_oid uuid; o record;
begin
  v_sess := public.open_table_session('tok_tz324_ny7');
  v_sid  := (v_sess->>'session_id')::uuid;
  v_res := public.create_order(
    '324b0000-0000-4000-8000-000000000006', 'qr',
    '324c0000-0000-4000-8000-000000000006', '324d0000-0000-4000-8000-000000000006', null,
    '[{"product_id":"324f0000-0000-4000-8000-000000000006","quantity":2}]'::jsonb,
    null, null, null, null, v_sid);
  v_oid := (v_res->>'id')::uuid;
  set constraints all immediate;
  select discount_amount as da, discount_reason as dr, total into o from public.orders where id = v_oid;
  if o.da is distinct from 4.00::numeric or o.total is distinct from 36.00::numeric
     or coalesce(o.dr, '') not like '%Happy Hour: TZ A%' then
    raise exception 'TZ7d FAIL: comanda QR pe NY7 → reducere % (%), total % — așteptat 4.00 din regula A (ora NY), nu 20.00 din B',
      o.da, o.dr, o.total;
  end if;
  raise notice 'TZ7d OK: banii urmează ora localului (40.00 → 36.00, regula A)';
end $$;
set constraints all deferred;

-- e) consumatorii moșteniți cheamă încă învelișurile
do $$
begin
  if position('public_happy_hour_now' in (select prosrc from pg_proc
        where oid = 'public._apply_happy_hour_auto()'::regprocedure)) = 0 then
    raise exception 'TZ7e FAIL: _apply_happy_hour_auto nu mai cheamă public_happy_hour_now';
  end if;
  if position('public_happy_hour_now' in pg_get_functiondef('public.update_order_items(uuid, jsonb, numeric)'::regprocedure)) = 0 then
    raise exception 'TZ7e FAIL: update_order_items nu mai re-evaluează prin public_happy_hour_now';
  end if;
  if position('evaluate_happy_hour_for_now' in (select prosrc from pg_proc
        where oid = 'public.suggest_happy_hour_discount_for_order(uuid)'::regprocedure)) = 0 then
    raise exception 'TZ7e FAIL: suggest_happy_hour_discount_for_order nu mai cheamă evaluate_happy_hour_for_now';
  end if;
  raise notice 'TZ7e OK: trigger-ul de bani, editarea și sugestia trec prin învelișuri';
end $$;

-- ── TZ8: plafonul lunar de SMS ───────────────────────────────────────────────
do $$
declare
  c_ny  constant uuid := '324b0000-0000-4000-8000-000000000001';
  c_akl constant uuid := '324b0000-0000-4000-8000-000000000002';
  c_buc constant uuid := '324b0000-0000-4000-8000-000000000003';
  c_bad constant uuid := '324b0000-0000-4000-8000-000000000004';
  v_tz  text;
  v_old_tz text := current_setting('TimeZone');
  r record;
begin
  -- a) instante fixe, sub două TimeZone-uri de sesiune
  foreach v_tz in array array['UTC', 'Australia/Sydney'] loop
    perform set_config('TimeZone', v_tz, true);
    for r in
      select * from (values
        (c_ny,  timestamptz '2026-11-15 12:00:00+00', date '2026-11-01', 'NY 15 nov'),
        (c_ny,  timestamptz '2026-11-01 03:59:00+00', date '2026-10-01', 'NY 31 oct 23:59 EDT'),
        (c_ny,  timestamptz '2026-11-01 04:00:00+00', date '2026-11-01', 'NY 1 nov 00:00 EDT (nu 05:00Z)'),
        (c_akl, timestamptz '2026-09-30 10:59:00+00', date '2026-09-01', 'AKL 30 sep 23:59 NZDT'),
        (c_akl, timestamptz '2026-09-30 11:00:00+00', date '2026-10-01', 'AKL 1 oct 00:00 NZDT'),
        (c_akl, timestamptz '2026-09-15 05:00:00+00', date '2026-09-01', 'AKL 15 sep (NZST)'),
        (c_buc, timestamptz '2026-10-31 21:59:00+00', date '2026-10-01', 'BUC 31 oct 23:59'),
        (c_buc, timestamptz '2026-10-31 22:00:00+00', date '2026-11-01', 'BUC 1 nov 00:00'),
        (c_bad, timestamptz '2026-10-31 21:59:00+00', date '2026-10-01', 'BAD (fus invalid) 31 oct 23:59'),
        (c_bad, timestamptz '2026-10-31 22:00:00+00', date '2026-11-01', 'BAD (fus invalid) 1 nov 00:00')
      ) v(rest, at_, expect, label)
    loop
      if public._restaurant_month(r.rest, r.at_) is distinct from r.expect then
        raise exception 'TZ8a FAIL: % (sesiune %) → % (așteptat %)',
          r.label, v_tz, public._restaurant_month(r.rest, r.at_), r.expect;
      end if;
    end loop;
  end loop;
  perform set_config('TimeZone', v_old_tz, true);
  raise notice 'TZ8a OK: luna în fusul localului, granița pe miezul nopții local (DST inclus)';
end $$;

-- b) + d) rânduri la granițele lunii; oracolul e calculat AICI, independent
insert into public.sms_queue (restaurant_id, recipient_phone, template_kind, template_data, dedup_key, status, created_at)
select v.rest, '+40722324000', 'pickup_ready', '{}'::jsonb, 'tz324-8b-' || v.lbl || '-' || x.k, x.st,
       (date_trunc('month', now() at time zone v.tz) at time zone v.tz) + x.off
  from (values ('324b0000-0000-4000-8000-000000000001'::uuid, 'America/New_York', 'ny'),
               ('324b0000-0000-4000-8000-000000000002'::uuid, 'Pacific/Auckland', 'akl'),
               ('324b0000-0000-4000-8000-000000000003'::uuid, 'Europe/Bucharest', 'buc')) v(rest, tz, lbl)
 cross join (values ('before', 'queued', interval '-1 minute'),
                    ('after', 'queued', interval '1 minute'),
                    ('cancelled', 'cancelled', interval '2 minutes')) x(k, st, off);

-- a') ștampila de la INSERT = eticheta lui `created_at` (nu a lui `now()`):
-- rândul „before” e în luna PRECEDENTĂ, cu control că există și rânduri în luna
-- curentă (altfel testul nu deosebește cele două surse).
do $$
declare v_bad int; v_prev int; v_cur int;
begin
  select count(*) filter (where cap_month is distinct from public._restaurant_month(restaurant_id, created_at)),
         count(*) filter (where dedup_key like '%-before' and cap_month < public._restaurant_month(restaurant_id, now())),
         count(*) filter (where dedup_key like '%-after' and cap_month = public._restaurant_month(restaurant_id, now()))
    into v_bad, v_prev, v_cur
    from public.sms_queue where dedup_key like 'tz324-8b-%';
  if v_bad <> 0 or v_prev <> 3 or v_cur <> 3 then
    raise exception 'TZ8a'' FAIL: ștampila cap_month (abateri %, „before” în luna precedentă %/3, „after” în luna curentă %/3)',
      v_bad, v_prev, v_cur;
  end if;
  raise notice 'TZ8a'' OK: cap_month = luna locală a creării';
end $$;

do $$
declare
  v_owner text;
  v_rest  uuid;
  v_j     jsonb;
  r record;
begin
  for r in
    select * from (values
      ('32400000-0000-4000-8000-000000000001', '324b0000-0000-4000-8000-000000000001'::uuid, 'NY'),
      ('32400000-0000-4000-8000-000000000002', '324b0000-0000-4000-8000-000000000002'::uuid, 'AKL'),
      ('32400000-0000-4000-8000-000000000003', '324b0000-0000-4000-8000-000000000003'::uuid, 'BUC (control RO)')
    ) v(owner_id, rest, label)
  loop
    perform set_config('request.jwt.claim.sub', r.owner_id, true);
    perform set_config('role', 'authenticated', true);
    execute 'select public.get_sms_usage($1)' into v_j using r.rest;
    perform set_config('role', 'none', true);
    if (v_j->>'used')::int is distinct from 1 then
      raise exception 'TZ8b FAIL: get_sms_usage(%) → used=% (așteptat 1: doar rândul de după granița lunii LOCALE, fără cel anulat)',
        r.label, v_j->>'used';
    end if;
    if (v_j->>'module_enabled')::boolean is distinct from true or (v_j->>'plan_enabled')::boolean is distinct from true
       or (v_j->>'cap')::int is distinct from
          (select limit_value from public.plan_features where plan = 'growth' and feature = 'sms_notifications') then
      raise exception 'TZ8b FAIL: forma răspunsului s-a schimbat pe % (%)', r.label, v_j;
    end if;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  raise notice 'TZ8b/TZ8d OK: contorul numără luna localului (NY, AKL) și luna Bucureștiului pe BUC';
end $$;

-- e) lanțul EXECUTE: enqueue_sms sub service_role REAL → helperii închiși sunt
-- chemați ca proprietarul învelișului.
do $$
declare v_id uuid;
begin
  perform set_config('role', 'service_role', true);
  execute $q$select public.enqueue_sms($1, '0722324011', 'pickup_ready'::public.sms_template_kind, '{}'::jsonb, 'tz324-8e')$q$
     into v_id using '324b0000-0000-4000-8000-000000000003'::uuid;
  perform set_config('role', 'none', true);
  if v_id is null then
    raise exception 'TZ8e FAIL: enqueue_sms sub service_role a întors null (lanțul spre helperi e rupt — pe calea triggerelor ar fi TĂCUT)';
  end if;
  raise notice 'TZ8e OK: enqueue_sms sub service_role REAL inserează';
end $$;

-- c) plafonul: pe NY, cu luna locală conținând deja 1 rând, plafonul 2 lasă
-- exact un SMS să treacă.
do $$
declare
  c_ny constant uuid := '324b0000-0000-4000-8000-000000000001';
  v_cap int;
  v1 uuid;
  v2 uuid;
begin
  select limit_value into v_cap from public.plan_features where plan = 'growth' and feature = 'sms_notifications';
  update public.plan_features set limit_value = 2 where plan = 'growth' and feature = 'sms_notifications';
  v1 := public.enqueue_sms(c_ny, '0722324001', 'pickup_ready', '{}'::jsonb, 'tz324-8c-1');
  v2 := public.enqueue_sms(c_ny, '0722324002', 'pickup_ready', '{}'::jsonb, 'tz324-8c-2');
  update public.plan_features set limit_value = v_cap where plan = 'growth' and feature = 'sms_notifications';
  if v1 is null then
    raise exception 'TZ8c FAIL: primul SMS al lunii locale refuzat (plafonul numără altă lună)';
  end if;
  if v2 is not null then
    raise exception 'TZ8c FAIL: al doilea SMS a trecut peste plafonul 2 (plafonul numără altă lună)';
  end if;
  raise notice 'TZ8c OK: plafonul și contorul numără aceeași lună locală';
end $$;

-- f) ocolirea plafonului prin schimbarea fusului la granița lunii
do $$
declare
  c_kir   constant uuid := '324b0000-0000-4000-8000-000000000009';
  c_owner constant text := '32400000-0000-4000-8000-000000000009';
  -- L = luna de ACUM la Pago Pago; instantul = 1 minut după începutul lui L la
  -- Kiritimati (cu 25 h înaintea începutului lui L la Pago Pago) — mereu în trecut.
  v_label date := date_trunc('month', now() at time zone 'Pacific/Pago_Pago')::date;
  v_at    timestamptz := (v_label::timestamp at time zone 'Pacific/Kiritimati') + interval '1 minute';
  v_cap   int;
  v_rows  int;
  v_id    uuid;
  v_j     jsonb;
begin
  insert into public.sms_queue (restaurant_id, recipient_phone, template_kind, template_data, dedup_key, status, created_at)
  values (c_kir, '+40722324091', 'pickup_ready', '{}'::jsonb, 'tz324-8f-1', 'sent', v_at),
         (c_kir, '+40722324092', 'pickup_ready', '{}'::jsonb, 'tz324-8f-2', 'sent', v_at);
  if (select count(*) from public.sms_queue where dedup_key like 'tz324-8f-%' and cap_month = v_label) <> 2 then
    raise exception 'TZ8f FAIL (control): rândurile de pe Kiritimati nu au ștampila % (luna lor locală)', v_label;
  end if;

  -- owner-ul mută fusul (calea reală: PATCH pe coloana cu grant, sub RLS)
  perform set_config('request.jwt.claim.sub', c_owner, true);
  perform set_config('role', 'authenticated', true);
  execute 'update public.restaurants set timezone = $1 where id = $2' using 'Pacific/Pago_Pago', c_kir;
  get diagnostics v_rows = row_count;
  perform set_config('role', 'none', true);
  if v_rows <> 1 or public.restaurant_time_zone(c_kir) is distinct from 'Pacific/Pago_Pago' then
    raise exception 'TZ8f FAIL (control): owner-ul nu a putut muta fusul (% rânduri)', v_rows;
  end if;

  -- controale: nicio re-etichetare, luna curentă e tot L, iar o fereastră din
  -- fusul CURENT ar fi exclus ambele rânduri (scenariul E ocolirea)
  if (select count(*) from public.sms_queue where dedup_key like 'tz324-8f-%' and cap_month = v_label) <> 2
     or public._restaurant_month(c_kir, now()) is distinct from v_label
     or v_at >= (v_label::timestamp at time zone 'Pacific/Pago_Pago') then
    raise exception 'TZ8f FAIL (control): scenariul nu e cel al ocolirii (ștampile / luna curentă / fereastra)';
  end if;

  select limit_value into v_cap from public.plan_features where plan = 'growth' and feature = 'sms_notifications';
  update public.plan_features set limit_value = 2 where plan = 'growth' and feature = 'sms_notifications';
  v_id := public.enqueue_sms(c_kir, '0722324093', 'pickup_ready', '{}'::jsonb, 'tz324-8f-3');
  if v_id is not null then
    update public.plan_features set limit_value = v_cap where plan = 'growth' and feature = 'sms_notifications';
    raise exception 'TZ8f FAIL: după mutarea fusului est→vest, al treilea SMS a trecut peste plafonul 2 (plafon ocolit)';
  end if;
  perform set_config('request.jwt.claim.sub', c_owner, true);
  perform set_config('role', 'authenticated', true);
  execute 'select public.get_sms_usage($1)' into v_j using c_kir;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
  if (v_j->>'used')::int is distinct from 2 then
    update public.plan_features set limit_value = v_cap where plan = 'growth' and feature = 'sms_notifications';
    raise exception 'TZ8f FAIL: contorul arată used=% după mutarea fusului (așteptat 2)', v_j->>'used';
  end if;

  -- control pozitiv: cu plafonul 3 același apel trece (null-ul de mai sus vine din plafon)
  update public.plan_features set limit_value = 3 where plan = 'growth' and feature = 'sms_notifications';
  v_id := public.enqueue_sms(c_kir, '0722324093', 'pickup_ready', '{}'::jsonb, 'tz324-8f-3');
  update public.plan_features set limit_value = v_cap where plan = 'growth' and feature = 'sms_notifications';
  if v_id is null then
    raise exception 'TZ8f FAIL (control): cu plafonul 3 SMS-ul e tot refuzat — null-ul nu venea din plafon';
  end if;
  raise notice 'TZ8f OK: mutarea fusului la granița lunii nu resetează plafonul (ștampila rămâne)';
end $$;

-- ── TZ9: clichet structural viu ──────────────────────────────────────────────
do $$
declare
  c_helpers constant text[] := array[
    'public.restaurant_time_zone(uuid)',
    'public._happy_hour_rules_at(uuid, timestamptz)',
    'public._restaurant_month(uuid, timestamptz)',
    'public.sms_queue_stamp_cap_month()'];
  c_wrappers constant text[] := array[
    'public.public_happy_hour_now(uuid)',
    'public.evaluate_happy_hour_for_now(uuid)',
    'public.enqueue_sms(uuid, text, public.sms_template_kind, jsonb, text)',
    'public.get_sms_usage(uuid)'];
  v_sig  text;
  v_src  text;
  v_cfg  text;
  v_def  boolean;
  v_n    int;
  v_role text;
  v_err  text;
begin
  -- o singură semnătură pe fiecare nume
  foreach v_sig in array array['safe_time_zone', 'restaurant_time_zone', '_happy_hour_rules_at',
                               'public_happy_hour_now', 'evaluate_happy_hour_for_now',
                               '_restaurant_month', 'sms_queue_stamp_cap_month',
                               'enqueue_sms', 'get_sms_usage'] loop
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_sig;
    if v_n <> 1 then
      raise exception 'TZ9 FAIL: % are % semnături (PGRST203)', v_sig, v_n;
    end if;
  end loop;

  -- fără fusul fix; pg_temp; securitate corectă
  foreach v_sig in array c_helpers || c_wrappers loop
    select prosrc, coalesce(array_to_string(proconfig, ','), ''), prosecdef
      into v_src, v_cfg, v_def from pg_proc where oid = v_sig::regprocedure;
    if position('''Europe/Bucharest''' in v_src) > 0 then
      raise exception 'TZ9 FAIL: % are fusul București scris de mână', v_sig;
    end if;
    if v_cfg !~ 'search_path=public, ?pg_temp' then
      raise exception 'TZ9 FAIL: % fără search_path cu pg_temp (%)', v_sig, v_cfg;
    end if;
    if (v_sig = any(c_helpers)) and v_def then
      raise exception 'TZ9 FAIL: helperul % a fost promovat la SECURITY DEFINER', v_sig;
    end if;
    if not (v_sig = any(c_helpers)) and not v_def then
      raise exception 'TZ9 FAIL: învelișul % nu mai e SECURITY DEFINER', v_sig;
    end if;
  end loop;
  foreach v_sig in array array['public.public_happy_hour_now(uuid)', 'public.evaluate_happy_hour_for_now(uuid)'] loop
    select prosrc into v_src from pg_proc where oid = v_sig::regprocedure;
    if position('_happy_hour_rules_at(' in v_src) = 0 or position('isodow' in v_src) > 0 then
      raise exception 'TZ9 FAIL: % nu deleagă nucleului / își calculează singur ziua', v_sig;
    end if;
  end loop;
  foreach v_sig in array array['public.enqueue_sms(uuid, text, public.sms_template_kind, jsonb, text)',
                               'public.get_sms_usage(uuid)'] loop
    select prosrc into v_src from pg_proc where oid = v_sig::regprocedure;
    if position('_restaurant_month(' in v_src) = 0 or position('cap_month = v_month' in v_src) = 0
       or position('date_trunc(' in v_src) > 0 or position('created_at >=' in v_src) > 0 then
      raise exception 'TZ9 FAIL: % nu numără pe luna ștampilată (cap_month) — o fereastră din fusul curent se ocolește schimbând fusul', v_sig;
    end if;
    -- luna CURENTĂ pe fusul ACESTUI restaurant, la `now()` — exact ca ștampila.
    -- Comportamental nu se vede: în afara orelor de graniță toate fusurile sunt în
    -- aceeași lună, deci o etichetă pe alt fus (`_restaurant_month(null, now())`
    -- = București) trece de TZ8 în ~29 de zile din 30 (M31).
    if position('v_month := public._restaurant_month(p_restaurant_id, now());' in v_src) = 0 then
      raise exception 'TZ9 FAIL: % nu calculează luna curentă pe restaurantul lui, la now() (eticheta ar putea diverge de ștampilă)', v_sig;
    end if;
    -- Fusul înghețat între numărătoare și ștampilă (recenzia CodeRabbit pe #376):
    -- cursa e între DOUĂ sesiuni, deci un test in-process e vacuu — clichetul
    -- ține lacătul (M32). Doar pe enqueue_sms: get_sms_usage doar afișează.
    if v_sig like 'public.enqueue_sms(%'
       and (position('where r.id = p_restaurant_id for share;' in v_src) = 0
            or position('for share;' in v_src) > position('v_month := public._restaurant_month(' in v_src)) then
      raise exception 'TZ9 FAIL: enqueue_sms nu blochează rândul restaurantului (FOR SHARE) înaintea lunii — o schimbare de fus concurentă ștampilează în altă lună decât cea verificată';
    end if;
  end loop;

  -- fusul O SINGURĂ dată per apel, în variabilă — niciodată per rând (calea
  -- lentă a lui safe_time_zone costă ~10 ms; per rând, un raport/meniu mare cade)
  foreach v_sig in array array['public._happy_hour_rules_at(uuid, timestamptz)',
                               'public._restaurant_month(uuid, timestamptz)'] loop
    select prosrc into v_src from pg_proc where oid = v_sig::regprocedure;
    v_n := (length(v_src) - length(replace(v_src, 'restaurant_time_zone(', ''))) / length('restaurant_time_zone(');
    if v_n <> 1 or position('safe_time_zone(' in v_src) > 0 then
      raise exception 'TZ9 FAIL: % cheamă fusul de % ori / direct prin safe_time_zone (așteptat o dată, în variabilă)', v_sig, v_n;
    end if;
  end loop;
  select prosrc into v_src from pg_proc where oid = 'public._happy_hour_rules_at(uuid, timestamptz)'::regprocedure;
  if position('restaurant_time_zone(' in v_src) > position('return query' in v_src) then
    raise exception 'TZ9 FAIL: nucleul Happy Hour evaluează fusul în interogare (per rând)';
  end if;

  -- ștampila: coloana date NOT NULL + trigger BEFORE INSERT ROW (tgtype 7 EXACT:
  -- un `or update` = 23 ar re-eticheta rândurile — exact ocolirea), din created_at
  if not exists (select 1 from pg_attribute
                  where attrelid = 'public.sms_queue'::regclass and attname = 'cap_month'
                    and atttypid = 'date'::regtype and attnotnull and not attisdropped) then
    raise exception 'TZ9 FAIL: sms_queue.cap_month lipsește / nu e date NOT NULL';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.sms_queue'::regclass
                    and t.tgname = 'trg_sms_queue_stamp_cap_month'
                    and t.tgtype = 7 and t.tgenabled = 'O' and not t.tgisinternal
                    and t.tgfoid = 'public.sms_queue_stamp_cap_month()'::regprocedure) then
    raise exception 'TZ9 FAIL: trg_sms_queue_stamp_cap_month lipsește / nu e BEFORE INSERT ROW (tgtype 7) activ';
  end if;
  if position('new.cap_month := public._restaurant_month(new.restaurant_id, new.created_at)' in
       (select prosrc from pg_proc where oid = 'public.sms_queue_stamp_cap_month()'::regprocedure)) = 0 then
    raise exception 'TZ9 FAIL: ștampila nu vine din _restaurant_month(restaurant_id, created_at)';
  end if;

  -- helperii închiși: catalog (+ PUBLIC) și apel REAL
  foreach v_sig in array c_helpers || array['public.safe_time_zone(text)'] loop
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(v_role, v_sig, 'execute') then
        raise exception 'TZ9 FAIL: % poate executa helperul %', v_role, v_sig;
      end if;
    end loop;
    if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = v_sig::regprocedure and a.grantee = 0) then
      raise exception 'TZ9 FAIL: PUBLIC poate executa helperul %', v_sig;
    end if;
  end loop;
  perform set_config('role', 'authenticated', true);
  v_err := pg_temp.tz_catch('select public.restaurant_time_zone(''324b0000-0000-4000-8000-000000000001'')');
  perform set_config('role', 'none', true);
  if v_err is null or v_err not like '42501:%for function%' then
    raise exception 'TZ9 FAIL: apelul real ca authenticated pe restaurant_time_zone → % (așteptat 42501 „for function”)',
      coalesce(v_err, 'a trecut');
  end if;
  -- control pozitiv: același apel ca proprietar trece (altfel 42501 ar veni din altă parte)
  if public.restaurant_time_zone('324b0000-0000-4000-8000-000000000001') is distinct from 'America/New_York' then
    raise exception 'TZ9 FAIL (control): proprietarul nu poate chema helperul';
  end if;

  -- contractul ACL al învelișurilor
  if not has_function_privilege('anon', 'public.public_happy_hour_now(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.public_happy_hour_now(uuid)', 'execute') then
    raise exception 'TZ9 FAIL: public_happy_hour_now nu mai e apelabil de anon + authenticated (meniul QR)';
  end if;
  foreach v_sig in array array['public.evaluate_happy_hour_for_now(uuid)', 'public.get_sms_usage(uuid)'] loop
    if has_function_privilege('anon', v_sig, 'execute') or not has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception 'TZ9 FAIL: % trebuie să fie authenticated-only', v_sig;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.enqueue_sms(uuid, text, public.sms_template_kind, jsonb, text)', 'execute')
     or has_function_privilege('authenticated', 'public.enqueue_sms(uuid, text, public.sms_template_kind, jsonb, text)', 'execute')
     or not has_function_privilege('service_role', 'public.enqueue_sms(uuid, text, public.sms_template_kind, jsonb, text)', 'execute') then
    raise exception 'TZ9 FAIL: enqueue_sms trebuie să fie doar service_role (+ triggerele DEFINER)';
  end if;

  -- același proprietar pentru helperi și învelișuri (+ create_reservation_public, 298)
  select count(distinct p.proowner) into v_n
    from pg_proc p
   where p.oid = any (array(select s::regprocedure::oid
                              from unnest(c_helpers || c_wrappers || array[
                                'public.safe_time_zone(text)',
                                'public.create_reservation_public(text,text,text,smallint,timestamptz,text,text,smallint,text,uuid,uuid,text)']) s));
  if v_n <> 1 then
    raise exception 'TZ9 FAIL: helperii și învelișurile au % proprietari (un DEFINER cu alt proprietar primește 42501)', v_n;
  end if;
  raise notice 'TZ9 OK: structură, suprafață și proprietar';
end $$;

rollback;
