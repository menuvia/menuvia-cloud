-- migration_282_gdpr_deletions_pgcron.sql
-- =============================================================================
-- Ștergerile GDPR (Art. 17) trec pe pg_cron — DUPĂ ce primesc siguranța care le
-- lipsea (RESID-17, decizie de fondator C6).
--
-- ── De ce era în denylist, și de ce motivul era CORECT ───────────────────────
-- Mig 274 a exclus deliberat `process_account_deletions` din manifest, cu acest
-- motiv (verbatim din `pg_cron_janitor_denylist()`):
--
--   „delete from auth.users IREVERSIBIL, iar bucla nu are `order by`, nici
--    `for update`, nici `skip locked`: doua rulari concurente itereaza seturi
--    suprapuse in ordini diferite (risc de deadlock pe cascade) si a doua face
--    `return next` pentru randuri pe care nu le-a sters. Un advisory lock e
--    LOGICA NOUA pe o cale ireversibila = decizie de fondator."
--
-- Verificat pe lanțul curent (042→179→**183**): selectul care conduce bucla are
-- DOAR `where deletion_requested_at < now() - interval '30 days' and
-- deletion_blocked_reason is null` + `limit 100`. Niciun `order by`, niciun
-- `for update`, niciun `skip locked`, niciun lacăt. Motivul e literal adevărat.
--
-- Deci decizia fondatorului deblochează MUNCA, nu mutarea rândului: migrația
-- asta ADAUGĂ proprietatea de siguranță. A muta rândul fără ea ar fi însemnat
-- să fac exact ce descrie motivul.
--
-- ── Dublarea NU e ipotetică, și nu vine de la pg_cron ────────────────────────
-- `automation-cron.js:281` gate-uiește apelul pe `(hour === 3 && minute >= 30)
-- || (hour === 4 && minute < 30)` — o fereastră de O ORĂ, cu tick sub-orar
-- (`TICK_MINUTES`). Deci RPC-ul se cheamă de MAI MULTE ori pe zi deja numai din
-- Netlify. Azi e teoretic (Netlify e mort, issue #250); la reparația lui devine
-- real, cu sau fără pg_cron. Fereastra largă e deliberată (un tick ratat la
-- 03:30 nu amână ștergerea cu o zi) — deci soluția nu e s-o îngustez, ci ca
-- funcția să fie sigură la rulări suprapuse.
--
-- ── Ce se adaugă ─────────────────────────────────────────────────────────────
--   1. `pg_try_advisory_xact_lock` la intrare → a doua rulare iese IMEDIAT, cu
--      zero rânduri. Asta face double-run-ul sigur INDIFERENT de planificator,
--      deci apelul din automation-cron.js RĂMÂNE neatins (îl scot doar când
--      #250 e reparat și îl măsor). Convenția de cheie e cea din repo:
--      `hashtext('<scope>')` (mig 015/038/056/057).
--   2. `order by deletion_requested_at, id` — ordine deterministă, ca două
--      bucle să nu se încrucișeze pe cascadă (cauza de deadlock din motiv).
--   3. `for update skip locked` — claim per rând; ce e revendicat de altcineva
--      se SARE, deci a doua rulare nu mai face `return next` pe rânduri pe care
--      nu le-a șters (a doua consecință din motiv).
--
-- Restul corpului e copie VERBATIM din 183: cele 3 politici (block /
-- transfer_tombstone / archive_anonymize) din 179, arhivarea fiscală,
-- tombstone-ul, `limit 100` și izolarea `exception when others → continue`.
--
-- ── Ce NU poate dovedi CI-ul, și ce s-a făcut în loc ─────────────────────────
-- CJ5 verifică PREZENȚA unui șir în `prosrc`, nu semantica lui — deci nu e o
-- dovadă că proprietatea există. Concurența reală cere două sesiuni, iar suita
-- SQL rulează într-una singură (și `pg_try_advisory_xact_lock` e RE-ENTRANT pe
-- aceeași sesiune, deci un test in-process ar reuși mereu să ia lacătul și ar fi
-- VACUU). Ca la mig 273, s-a verificat MANUAL, cu două sesiuni psql concurente
-- pe replay-ul local. Rezultat MĂSURAT, cu două conturi eligibile în fixtură:
--
--   CU lacăt (codul de mai jos):
--     A: begin; select ... from process_account_deletions();  → 2 șterse, ține lacătul
--     B: (pornit în timp ce A îl ține)                        → NOTICE + 0, INSTANT
--        („alta rulare e in curs — ies fara sa sterg nimic"; B nu se BLOCHEAZĂ,
--         `try_` iese imediat — un `pg_advisory_xact_lock` simplu ar fi ținut
--         conexiunea ocupată degeaba)
--
--   FĂRĂ lacăt (forma din mig 183, reprodusă pe același cluster):
--     A → 2 șterse.  B → **2 șterse, ACELEAȘI 2.**
--     Adică exact a doua consecință din motivul denylist-ului: „a doua face
--     `return next` pentru randuri pe care nu le-a sters". Raportul cron-ului
--     (`results.account_deletions_processed`) ar fi numărat 4 ștergeri pentru 2
--     conturi.
--
-- Suita `tests/sql/gdpr_deletion_lock_assertions.sql` (GD1–GD6) acoperă ce se
-- POATE în CI: ordinea deterministă, fereastra de 30 de zile, politica `block`,
-- prezența AMBILOR markeri de siguranță și coerența manifest ↔ denylist.
--
-- ── CJ4 se ÎNTĂREȘTE, nu se slăbește ─────────────────────────────────────────
-- Scoaterea intrării duce denylist-ul de la 9 la 8, iar CJ4 cerea `>= 9` →
-- „lista s-a SCURTAT". Coborârea pragului la 8 ar fi arătat exact ca „ajustez
-- testul ca să treacă". În loc de asta, podeaua e înlocuită cu SETUL EXACT de
-- 8 nume rămase: e STRICT mai tare, fiindcă o podea nu prinde un SWAP (scoți o
-- interdicție, adaugi alta nelegată, numărul rămâne), iar setul îl prinde.
-- =============================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ─────────────────────────────────────────────────────────────────────────────
-- A. `process_account_deletions` — lanț 042→179→183→282.
--    Orice recreare viitoare pornește de AICI și păstrează TOT: lacătul,
--    ordinea, claim-ul, cele 3 politici, arhivarea fiscală, `limit 100` și
--    izolarea per-user.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.process_account_deletions()
returns table(deleted_user_id uuid, deleted_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user      record;
  v_policy    text;
  v_has_invoices boolean;
  v_archived  integer;
begin
  -- mig 282: SINGLE-FLIGHT. A doua rulare (alt planificator, tick suprapus,
  -- declanșare manuală) iese imediat cu zero rânduri în loc să itereze peste
  -- aceleași conturi. Lacătul e pe TRANZACȚIE: se eliberează la commit/rollback,
  -- deci un proces ucis nu-l lasă agățat.
  if not pg_try_advisory_xact_lock(hashtext('gdpr_account_deletions')) then
    raise notice 'process_account_deletions: alta rulare e in curs — ies fara sa sterg nimic';
    return;
  end if;

  -- Citește politica activă (fallback la default recomandat dacă lipsește rândul)
  select coalesce(
           (select policy from public.gdpr_deletion_config where id = true),
           'archive_anonymize'
         )
    into v_policy;

  for v_user in
    select id from public.profiles
    where deletion_requested_at is not null
      and deletion_requested_at < now() - interval '30 days'
      -- Sari peste conturile deja marcate blocate (așteaptă remediere manuală)
      and deletion_blocked_reason is null
    -- mig 282: ordine DETERMINISTĂ. Fără ea, două bucle concurente parcurg
    -- aceleași rânduri în ordini diferite → deadlock pe cascada auth.users.
    order by deletion_requested_at, id
    limit 100 -- batch pentru a nu bloca cron-ul
    -- mig 282: claim per rând. Ce e revendicat de altă rulare se SARE, deci
    -- nu se mai face `return next` pentru conturi pe care nu le-am șters noi.
    for update skip locked
  loop
    -- Izolare eroare per-user (mig 183): o eroare neașteptată (ex. constraint
    -- violation) la UN user NU oprește restul batch-ului de ștergeri GDPR.
    begin
      -- Are owner-ul facturi fiscale EMISE pe vreun restaurant deținut?
      select exists(
        select 1
          from public.invoices i
          join public.restaurants r on r.id = i.restaurant_id
         where r.owner_id = v_user.id
           and i.status in ('issued', 'cancelled')
      ) into v_has_invoices;

      -- ── Politica BLOCK ──────────────────────────────────────────
      -- Nu șterge. Marchează motivul; owner-ul rezolvă manual (transfer/închidere).
      if v_policy = 'block' and v_has_invoices then
        update public.profiles
           set deletion_blocked_reason =
                 'Blocat: contul are facturi fiscale emise care trebuie păstrate 10 '
                 'ani (Legea 82/1991). Contactați privacy@menuvia.ro pentru transfer '
                 'sau închiderea restaurantului înainte de ștergere.'
         where id = v_user.id;
        raise notice 'process_account_deletions: user % blocat (are facturi fiscale)', v_user.id;
        continue; -- NU avansează ștergerea, NU returnează next
      end if;

      -- ── Politica TRANSFER_TOMBSTONE ────────────────────────────
      -- Snapshot fiscal + marchează restaurantele ca orfane. Transferul REAL de
      -- owner NU se face aici (owner_id imuabil, lockdown). raise notice pentru
      -- remediere manuală via scripts/apply_ownership_remediation.sql.
      if v_policy = 'transfer_tombstone' and v_has_invoices then
        perform public.archive_fiscal_invoices_for_user(v_user.id);
        update public.restaurants
           set is_tombstoned    = true,
               tombstoned_at     = now(),
               tombstoned_reason =
                 'Owner șters (GDPR). Necesită remediere manuală de owner: '
                 'scripts/apply_ownership_remediation.sql'
         where owner_id = v_user.id;
        raise notice
          'process_account_deletions: user % — restaurante tombstoned; transfer '
          'owner necesită remediere manuală (owner_id imuabil)', v_user.id;
        -- Continuă ștergerea contului: datele personale se șterg (GDPR), snapshot-ul
        -- fiscal supraviețuiește. Cascada VA șterge restaurantele tombstoned și
        -- invoices — acceptat, fiindcă am salvat deja snapshot-ul fiscal.
      end if;

      -- ── Politica ARCHIVE_ANONYMIZE (DEFAULT) ───────────────────
      -- Snapshot fiscal ÎNAINTE de ștergere, apoi lasă cascada să șteargă originalele.
      -- Se aplică și ca ramură comună pentru archive_anonymize + fallback
      -- transfer_tombstone (snapshot deja făcut mai sus e idempotent).
      if v_has_invoices then
        v_archived := public.archive_fiscal_invoices_for_user(v_user.id);
        raise notice 'process_account_deletions: user % — % facturi arhivate fiscal',
          v_user.id, v_archived;
      end if;

      -- Ștergerea propriu-zisă. Cascada (auth.users → profiles → restaurants →
      -- invoices) șterge datele personale. retained_invoices NU e cascadat →
      -- supraviețuiește. Datele personale reziduale (audit columns) sunt deja
      -- SET NULL prin FK-urile din mig 055.
      delete from auth.users where id = v_user.id;

      deleted_user_id := v_user.id;
      deleted_at := now();
      return next;
    exception when others then
      -- Izolare (mig 183): un singur user eșuat NU oprește restul batch-ului.
      -- Userul rămâne eligibil și va fi reîncercat la următorul tick al cron-ului.
      raise warning
        'process_account_deletions: eroare la ștergerea user % — sărit, se reîncearcă '
        'la următorul tick (%: %)', v_user.id, sqlstate, sqlerrm;
      continue;
    end;
  end loop;
end;
$$;

revoke all on function public.process_account_deletions() from public, anon, authenticated;
-- Grant-ul e cel din mig 274 secțiunea E (service_role); pe pg_cron jobul rulează
-- ca `postgres`, unde EXECUTE vine din PROPRIETATE, nu dintr-un grant.
grant execute on function public.process_account_deletions() to service_role;

comment on function public.process_account_deletions() is
  'Sterge conturile marcate GDPR dupa D+30 (Art. 17). mig 282: single-flight prin pg_try_advisory_xact_lock, ordine determinista (order by deletion_requested_at, id) si claim per rand (for update skip locked) — cele trei lipsuri pentru care mig 274 o tinea in denylist-ul pg_cron. Ruleaza pe pg_cron (menuvia_janitor_gdpr_deletions) SI din automation-cron.js: lacatul face suprapunerea inofensiva.';

-- ─────────────────────────────────────────────────────────────────────────────
-- B. Denylist FĂRĂ `process_account_deletions` — 8 intrări rămase.
--    Restul textelor sunt copie VERBATIM din 274.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.pg_cron_janitor_denylist()
returns table (fn_name text, reason text)
language sql
immutable
set search_path = public, pg_temp
as $$
  select *
    from (values
      ('compute_health_scores',
       'ESTE dead-man s switch-ul Netlify: /health citeste customer_health_scores.computed_at (checks.cron, CRON_STALE_HOURS=2) si nu exista alt scriitor automat. Mutat pe pg_cron, alarma devine VERDE cu Netlify MORT — exact orbirea construita dupa incidentul din august. Grant-ul lipsa i s-a acordat (sectiunea E), ca heartbeat-ul sa masoare CHIAR Netlify.'),
      ('run_affiliate_payout_batch',
       'BANI: upsert-ul e idempotent (on conflict (affiliate_id, period_month, currency)), dar notificarea Slack „N draft-uri necesita procesare Wise" si pre-check-ul pe perioada stau in JS. Pe pg_cron s-ar crea TACUT draft-uri pe care nimeni nu le proceseaza.'),
      ('compute_daily_report',
       'Nu e janitor: e per-restaurant, iar orchestrarea (localuri active + email owner, chunking 8, circuit breaker la 10 esecuri consecutive, dedup_key datat, short-circuit „deja trimis") sta in automation-cron.js. Mutarea = SQL NOU. Plus fereastra de 08:00 Bucuresti.'),
      ('compute_weekly_report',
       'Idem compute_daily_report: orchestrare in JS, fereastra vineri 18:00-20:00 Bucuresti.'),
      ('detect_winback_inactive',
       'Marketing: valoarea lui e ORA trimiterii (09:00 Bucuresti), gard care sta in JS si dispare sub pg_cron; cron.timezone=GMT + DST romanesc fac imposibila pastrarea intentiei. Si CONSUMATORUL (worker-ul de email) e tot Netlify: a programa un PRODUCATOR al carui consumator e mort doar umfla coada.'),
      ('detect_nps_due',
       'Idem detect_winback_inactive (fereastra de 10:00 Bucuresti in JS).'),
      ('pending_receipts_cleanup_old',
       'COD MORT (mig 035): filtreaza status=''completed'', valoare pe care CHECK-ul tabelei o INTERZICE. Programarea ar instala un job care ruleaza pe veci, sterge ZERO randuri si face retentia fiscala sa PARA rezolvata. Mig 275 o DROP-uieste; pending_receipts nu are si nu primeste stergere automata.'),
      ('audit_log_cleanup',
       'Jurnal FISCAL: retentia e decizie de fondator, explicit in afara scopului. Masurat la 11 sept 2026: 539 randuri, 0 mai vechi de 365 de zile.')
    ) as t(fn_name, reason);
$$;

revoke all on function public.pg_cron_janitor_denylist() from public, anon, authenticated;
grant execute on function public.pg_cron_janitor_denylist() to service_role;

comment on function public.pg_cron_janitor_denylist() is
  'Ce NU are voie pe pg_cron, cu motivul. mig 282: `process_account_deletions` a IESIT dupa ce a primit lacatul single-flight + order by + for update skip locked (exact lipsurile din motivul ei). Raman 8 intrari; CJ4 le verifica pe NUME, ca set exact — o podea numerica n-ar fi prins un swap.';

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Rândul de manifest.
--    Minut 37: liber (7/11/13/17/19 orare, 23/29/41 zilnice) și ne-multiplu de
--    15, deci nu cade peste tick-ul `*/15` al lifecycle-ului (CJ6).
--    max_age_s = 172800: pentru un job zilnic e singura valoare admisă de CJ8
--    (intervalul e [2 × 86400, 172800]).
--    Fereastra e de LUNI (D+30), deci nu depinde de nicio oră de perete — se
--    poate programa în GMT (CJ7).
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.pg_cron_janitor_manifest
  (job_name, schedule, signature, command, max_age_s, safety_marker, note)
values
  ('menuvia_janitor_gdpr_deletions', '37 3 * * *',
   'public.process_account_deletions()',
   'select * from public.process_account_deletions()', 172800,
   'for update skip locked',
   'RESID-17 / decizie fondator C6. Stergerile Art. 17 la D+30. Pana la mig 282 statea in denylist fiindca bucla nu avea order by / for update / skip locked pe o cale IREVERSIBILA; mig 282 le-a adaugat, plus pg_try_advisory_xact_lock (single-flight). Ruleaza si din automation-cron.js — lacatul face suprapunerea inofensiva, deci apelul JS ramane neatins.')
on conflict (job_name) do update set
  schedule      = excluded.schedule,
  signature     = excluded.signature,
  command       = excluded.command,
  max_age_s     = excluded.max_age_s,
  safety_marker = excluded.safety_marker,
  note          = excluded.note;

-- Programarea efectivă. `pg_cron_apply_manifest()` ARUNCĂ dacă pg_cron lipsește
-- (mig 274, deliberat: pe un cluster care CHIAR are extensia, o eroare de
-- programare nu are voie să fie un NOTICE). Discriminatorul e `pg_extension`,
-- nu `to_regclass('cron.job')` — suita CJ simulează schema `cron`, deci un guard
-- pe tabelă ar cere programare acolo unde nu e nimic de programat (capcană
-- prinsă la mig 274, repetată aici de replay-ul local la prima rulare).
do $$
declare v_n integer;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'mig 282: pg_cron neinstalat - programarea sarita, manifestul si functia sunt aplicate. Clichetul permanent (CJ1-CJ13 + GD1-GD6) nu depinde de extensie.';
    return;
  end if;
  v_n := public.pg_cron_apply_manifest();
  raise notice 'mig 282: % joburi pg_cron programate (inclusiv menuvia_janitor_gdpr_deletions)', v_n;
end$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D. Asserțiuni la aplicare (centură; acoperirea permanentă e GD1–GD6 + CJ*).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_src text; v_n int;
begin
  select p.prosrc into v_src
    from pg_proc p
   where p.oid = 'public.process_account_deletions()'::regprocedure;

  -- Cele TREI lipsuri din motivul denylist-ului, fiecare verificată separat.
  if position('pg_try_advisory_xact_lock' in v_src) = 0 then
    raise exception 'mig 282: lipseste lacatul single-flight — exact riscul pentru care functia era in denylist';
  end if;
  if position('order by deletion_requested_at, id' in v_src) = 0 then
    raise exception 'mig 282: lipseste ordinea determinista (cauza de deadlock pe cascade)';
  end if;
  if position('for update skip locked' in v_src) = 0 then
    raise exception 'mig 282: lipseste claim-ul per rand — a doua rulare ar raporta stergeri pe care nu le-a facut';
  end if;

  -- Invariantele MOȘTENITE din 179/183: o recreare care le pierde pica AICI.
  if position('archive_fiscal_invoices_for_user' in v_src) = 0 then
    raise exception 'mig 282: s-a pierdut arhivarea fiscala (mig 179)';
  end if;
  if position('deletion_blocked_reason is null' in v_src) = 0 then
    raise exception 'mig 282: s-a pierdut filtrul pe conturile blocate (mig 179)';
  end if;
  if position('exception when others then' in v_src) = 0 then
    raise exception 'mig 282: s-a pierdut izolarea erorii per-user (mig 183)';
  end if;
  if position('limit 100' in v_src) = 0 then
    raise exception 'mig 282: s-a pierdut batch-ul de 100';
  end if;

  -- Denylist: intrarea a IESIT, dar lista nu s-a golit.
  if exists (select 1 from public.pg_cron_janitor_denylist() where fn_name = 'process_account_deletions') then
    raise exception 'mig 282: process_account_deletions e inca in denylist — manifest si denylist ar fi contradictorii (CJ4)';
  end if;
  select count(*) into v_n from public.pg_cron_janitor_denylist();
  if v_n <> 8 then
    raise exception 'mig 282: denylist-ul are % intrari, se asteptau exact 8', v_n;
  end if;

  -- Manifest: rândul există și e coerent.
  if not exists (
    select 1 from public.pg_cron_janitor_manifest
     where job_name = 'menuvia_janitor_gdpr_deletions'
       and schedule = '37 3 * * *'
       and max_age_s = 172800
       and safety_marker = 'for update skip locked'
  ) then
    raise exception 'mig 282: randul de manifest lipseste sau are alta forma';
  end if;
end$$;

commit;
