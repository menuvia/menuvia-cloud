-- migration_280_guest_pii_retention.sql
-- =============================================================================
-- Retenția datelor personale ale OASPEȚILOR (audit v3 RES-33 / SCOPE-33.1).
-- DECIZIE DE FONDATOR (16 sept 2026): **12 luni**, prin PSEUDONIMIZARE, nu prin
-- ștergere — rândul tranzacțional rămâne (obligație fiscală + statistici de
-- ocupare), doar identitatea oaspetelui dispare.
--
-- ── De ce e nevoie ────────────────────────────────────────────────────────────
-- Politica publicată (`menuvia-pack/03-DRAFT-CONFIDENTIALITATE.md` §3.2) promite
-- o perioadă de păstrare; în cod NU exista NIMIC care să o aplice. Un termen de
-- retenție care nu are un executor e exact tiparul „documentație care minte",
-- doar că de data asta minte într-un document cu valoare juridică.
--
-- ── Inventarul (verificat pe PRODUCȚIE, nu presupus) ─────────────────────────
--   reservations   customer_name (NOT NULL), customer_phone (NOT NULL),
--                  customer_email, special_requests
--   orders         customer_name, customer_phone            (comenzi `pickup`)
--   email_queue    recipient_email (NOT NULL), recipient_name, template_data
--   sms_queue      recipient_phone (NOT NULL), template_data
--   order_feedback ip_address, user_agent  (identificatori TEHNICI — nici măcar
--                  nu apar în politica publicată; SCOPE-33.1)
--   qr_scans       user_agent                (aceeași clasă tehnică)
--   loyalty        DOAR `fn_loyalty_phone_hash` (md5) — nimic de anonimizat.
--
-- ── Cele trei ferestre și de ce diferă ───────────────────────────────────────
--   p_months     = 12  PII de oaspete (decizia fondatorului).
--   p_queue_days = 90  cozile de LIVRARE (email/SMS), doar rânduri TERMINALE.
--                      Nu sunt arhivă: sunt mecanismul prin care mesajul a
--                      plecat. După 90 de zile nu mai servesc nici diagnoza.
--   p_tech_days  = 30  IP + user-agent pe feedback: semnal ANTI-ABUZ, are
--                      valoare doar cât timp abuzul e recent.
--   Ultimele două sunt propunerile mele, consemnate ca atare în planul aprobat
--   (docs/PLAN_RAMAS_2026-09-16.md §B3) — se schimbă dintr-un singur loc,
--   argumentele funcției din manifest.
--
-- ── De ce cozile se PSEUDONIMIZEAZĂ și nu se ȘTERG ───────────────────────────
-- `email_queue.dedup_key` are index UNIC și E mecanismul de anti-dublare
-- (`resv_created:<id>`, `winback:<uid>:<data>`…). Un DELETE ar face ca un
-- producător care re-evaluează aceeași condiție să treacă din nou de
-- `on conflict do nothing` → al doilea email real către un om. Rândul rămâne,
-- cu destinatarul și `template_data` golite: dedup-ul e INTACT, PII-ul nu.
--
-- ── Capcana centrală: `audit_log` (mig 044) ──────────────────────────────────
-- `orders` are trigger de audit FOR EACH ROW pe INSERT/UPDATE/DELETE, care
-- scrie `old_data`/`new_data` = RÂNDUL ÎNTREG. Deci:
--   (a) istoricul conține DEJA numele și telefonul fiecărei comenzi pickup, de
--       la creare și de la fiecare schimbare de status;
--   (b) UPDATE-ul de anonimizare ar mai scrie o copie PROASPĂTĂ, în chiar
--       momentul în care pretindem că am șters-o.
-- Retenția `audit_log` e ÎNCHISĂ ca decizie („păstrăm tot"), deci nu se șterge
-- niciun rând. Se MASCHEAZĂ chirurgical DOUĂ chei (`customer_name`,
-- `customer_phone`) în rândurile comenzilor deja anonimizate — restul
-- instantaneului (starea fiscală, sumele, statusurile) rămâne byte-identic,
-- deci „reconstituie starea comenzii la momentul T" continuă să funcționeze.
-- Mascarea rulează DUPĂ UPDATE-ul pe `orders`, în ACEEAȘI tranzacție, și prinde
-- inclusiv rândul de audit pe care tocmai l-a produs acel UPDATE (trigger-ele
-- AFTER ROW se execută la finalul instrucțiunii, înaintea celei următoare).
-- Indexul folosit există deja: `audit_log_row_idx (table_name, row_id)`.
--
-- ── Sentinelă ────────────────────────────────────────────────────────────────
-- `'[anonimizat]'` — o valoare, nu NULL, fiindcă `reservations.customer_name`
-- și `customer_phone` sunt NOT NULL cu CHECK `length(trim(...)) > 0`.
-- **Nu conține NICIO cifră, iar asta e o cerință, nu o coincidență**:
-- `get_reservation_no_show_counts` (mig 234) grupează recidiviștii pe
-- `right(regexp_replace(customer_phone,'\D','','g'), 9)` cu filtru
-- `length(...) >= 9`, deci un telefon anonimizat cade singur din raport. O
-- sentinelă cu cifre ar inventa un „recidivist" care nu există. Clichet: GR8.
--
-- ── Dublă rulare / idempotență ───────────────────────────────────────────────
-- Fiecare predicat e AUTO-CONSUMAT: exclude explicit rândurile deja tratate
-- (`<> v_marker`, `is not null`, `<> '{}'::jsonb`), deci a doua rulare atinge
-- ZERO rânduri — criteriul (b) de includere în manifestul pg_cron (mig 274).
--
-- ── Ce NU face, deliberat ────────────────────────────────────────────────────
--   • `orders.notes` — instrucțiuni de comandă, câmp operațional; poate conține
--     incidental PII, dar golirea lui ar rescrie conținutul comenzii. Reziduu
--     consemnat, nu ascuns.
--   • `order_feedback.comment` — conținutul feedback-ului e chiar valoarea
--     tabelei și nu identifică pe nimeni; se păstrează.
--   • `audit_log` pe alte tabele (products/restaurants/memberships) — acolo
--     „oaspete" nu există; sunt date de cont.
--   • ștergerea conturilor (Art. 17) rămâne `process_account_deletions`, în
--     denylist-ul pg_cron din mig 274 (cale ireversibilă, decizie separată).
--
-- ── Modelul de eșec, deliberat ATOMIC și ZGOMOTOS ────────────────────────────
-- Tot janitorul e o singură tranzacție: dacă o găleată aruncă, TOATE se rulează
-- înapoi și jobul pg_cron e marcat eșuat, iar `/health` → `checks.pgcron` trece
-- pe `failing` (și pe `stale` dacă nu mai reușește în fereastră) — deci se vede
-- de AFARĂ, prin health-watch. Alternativa — fiecare pas într-un `begin …
-- exception` — ar produce o retenție PARȚIALĂ raportată ca succes, adică exact
-- modul de eșec pe care o obligație de conformitate nu-l suportă.
-- Singura cale prin care un rând poate deveni ne-actualizabil e ca
-- `trg_enforce_order_table_tenant` / `trg_reservation_table_tenant` (BEFORE
-- UPDATE pe TOATE coloanele) să respingă o masă ajunsă la alt restaurant. Nu
-- există scriitor care să mute o masă între restaurante, iar FK-ul împiedică
-- referința suspendată — dacă totuși apare, alarma de mai sus e cea care spune.
--
-- Teste permanente: tests/sql/guest_retention_assertions.sql (GR1–GR10).
-- =============================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '300s';

-- ─────────────────────────────────────────────────────────────────────────────
-- A. Helper: maschează CHEI ANUME dintr-un instantaneu jsonb de audit.
--    Funcție separată (nu SQL inline) fiindcă e folosită de DOUĂ ori — o dată
--    în `set`, o dată în `where` — și trebuie să fie EXACT aceeași logică în
--    ambele, altfel UPDATE-ul ori ratează rânduri, ori le atinge la infinit.
--
--    Trei subtilități, fiecare a fost o variantă greșită:
--      • `p ? k` e adevărat și când valoarea e JSON `null` (comandă QR, fără
--        nume). A o înlocui cu sentinela ar INVENTA un nume unde nu a fost
--        niciodată unul → se sare peste `jsonb_typeof(...) = 'null'`.
--      • cheia deja mascată se sare (`p ->> k is distinct from p_marker`),
--        altfel `where`-ul ar fi mereu adevărat și jobul ar rescrie aceleași
--        rânduri la fiecare rulare (nu doar risipă: fiecare rulare ar fi un
--        „am mai anonimizat N rânduri" fals în raport).
--      • fără chei de mascat → `|| '{}'::jsonb`, deci rezultat IDENTIC cu
--        intrarea; `is distinct from` din `where` îl recunoaște și nu atinge
--        rândul.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.pii_mask_jsonb(
  p_data   jsonb,
  p_keys   text[],
  p_marker text
)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select case
    when p_data is null then null
    else p_data || coalesce(
      (select jsonb_object_agg(k, to_jsonb(p_marker))
         from unnest(p_keys) as k
        where p_data ? k
          and jsonb_typeof(p_data -> k) <> 'null'
          and p_data ->> k is distinct from p_marker),
      '{}'::jsonb)
  end;
$fn$;

comment on function public.pii_mask_jsonb(jsonb, text[], text) is
  'mig 280: inlocuieste valorile cheilor date dintr-un instantaneu jsonb de audit cu sentinela, sarind cheile absente, cele cu valoare JSON null si cele deja mascate. Folosita IDENTIC in `set` si in `where`, ca UPDATE-ul sa fie auto-consumat.';

-- Suprafață internă: niciun apelant client. Revoke EXPLICIT per rol — pe
-- stack-ul Supabase `pg_default_acl` acordă EXECUTE pe orice funcție NOUĂ
-- direct lui service_role (și anon/authenticated pe CLI-ul nou), iar
-- `revoke ... from public` nu atinge un grant direct (clasa CJ9, mig 274).
revoke all on function public.pii_mask_jsonb(jsonb, text[], text)
  from public, anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- B. Janitorul.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.anonymize_guest_pii(
  p_months     integer default 12,
  p_queue_days integer default 90,
  p_tech_days  integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_marker    constant text   := '[anonimizat]';
  v_keys      constant text[] := array['customer_name', 'customer_phone'];
  v_cut_pii   timestamptz := now() - make_interval(months => greatest(coalesce(p_months, 12), 1));
  v_cut_queue timestamptz := now() - make_interval(days   => greatest(coalesce(p_queue_days, 90), 1));
  v_cut_tech  timestamptz := now() - make_interval(days   => greatest(coalesce(p_tech_days, 30), 1));
  v_resv      integer := 0;
  v_ord       integer := 0;
  v_audit     integer := 0;
  v_email     integer := 0;
  v_sms       integer := 0;
  v_feedback  integer := 0;
  v_qr        integer := 0;
  v_ids       text[]  := '{}';
begin
  -- 1) Rezervări — fereastra curge de la ZIUA REZERVĂRII (`starts_at`), nu de
  --    la crearea ei: o rezervare făcută cu 3 luni înainte ar fi altfel
  --    anonimizată cu 3 luni mai devreme decât una făcută în aceeași zi.
  update public.reservations r
     set customer_name    = v_marker,
         customer_phone   = v_marker,
         customer_email   = null,
         special_requests = null
   where r.starts_at < v_cut_pii
     and (r.customer_name  <> v_marker
       or r.customer_phone <> v_marker
       or r.customer_email is not null
       or r.special_requests is not null);
  get diagnostics v_resv = row_count;

  -- 2) Comenzi (pickup) — `paid_at` când există, altfel `created_at`, aceeași
  --    convenție ca peste tot unde ziua încasării contează.
  --    `case` pe nume: o comandă QR NU are nume, iar a-i pune sentinela ar
  --    însemna să inventăm un oaspete identificat acolo unde n-a fost unul.
  with anonimizate as (
    update public.orders o
       set customer_name  = case when o.customer_name is not null then v_marker else null end,
           customer_phone = null
     where coalesce(o.paid_at, o.created_at) < v_cut_pii
       and ((o.customer_name is not null and o.customer_name <> v_marker)
         or o.customer_phone is not null)
    returning o.id
  )
  select coalesce(array_agg(id::text), '{}') into v_ids from anonimizate;
  v_ord := coalesce(array_length(v_ids, 1), 0);

  -- 3) `audit_log`: mascăm ACELEAȘI două chei în istoricul comenzilor tocmai
  --    anonimizate. Fără pasul ăsta, punctul 2 e teatru: copia integrală a
  --    rândului trăiește mai departe în jurnal, inclusiv cea scrisă chiar de
  --    UPDATE-ul de mai sus. Niciun rând nu se șterge (retenția audit_log e
  --    ÎNCHISĂ: „păstrăm tot"), nicio altă cheie nu se atinge.
  if v_ord > 0 then
    update public.audit_log a
       set old_data = public.pii_mask_jsonb(a.old_data, v_keys, v_marker),
           new_data = public.pii_mask_jsonb(a.new_data, v_keys, v_marker)
     where a.table_name = 'orders'
       and a.row_id = any (v_ids)
       and (public.pii_mask_jsonb(a.old_data, v_keys, v_marker) is distinct from a.old_data
         or public.pii_mask_jsonb(a.new_data, v_keys, v_marker) is distinct from a.new_data);
    get diagnostics v_audit = row_count;
  end if;

  -- 4) Coada de email — DOAR rânduri terminale. `queued`/`sending` sunt muncă
  --    în curs; golirea destinatarului acolo ar trimite un email către
  --    „[anonimizat]" sau l-ar pierde. `dedup_key` rămâne NEATINS.
  update public.email_queue e
     set recipient_email = v_marker,
         recipient_name  = null,
         template_data   = '{}'::jsonb
   where e.status in ('sent', 'failed', 'cancelled')
     and e.created_at < v_cut_queue
     and (e.recipient_email <> v_marker
       or e.recipient_name is not null
       or coalesce(e.template_data, '{}'::jsonb) <> '{}'::jsonb);
  get diagnostics v_email = row_count;

  -- 5) Coada de SMS — identic. `provider_message_id` rămâne (e referința la
  --    furnizor pentru o eventuală contestație de cost, nu o dată personală).
  update public.sms_queue s
     set recipient_phone = v_marker,
         template_data   = '{}'::jsonb
   where s.status in ('sent', 'failed', 'cancelled')
     and s.created_at < v_cut_queue
     and (s.recipient_phone <> v_marker
       or s.template_data <> '{}'::jsonb);
  get diagnostics v_sms = row_count;

  -- 6) Identificatori tehnici pe feedback (fereastra cea mai scurtă).
  update public.order_feedback f
     set ip_address = null,
         user_agent = null
   where f.created_at < v_cut_tech
     and (f.ip_address is not null or f.user_agent is not null);
  get diagnostics v_feedback = row_count;

  -- 7) Amprenta de browser pe scanările QR — aceeași clasă cu (6): semnal de
  --    analytics, nu identitate, dar user-agent-ul e un identificator tehnic și
  --    nu are de ce să supraviețuiască ferestrei anti-abuz. `country` rămâne
  --    (e agregat, nu individual), la fel `scanned_at`: fără ele statistica de
  --    activare a QR-ului ar dispărea odată cu amprenta.
  update public.qr_scans q
     set user_agent = null
   where q.scanned_at < v_cut_tech
     and q.user_agent is not null;
  get diagnostics v_qr = row_count;

  return jsonb_build_object(
    'reservations',   v_resv,
    'orders',         v_ord,
    'audit_rows',     v_audit,
    'email_queue',    v_email,
    'sms_queue',      v_sms,
    'order_feedback', v_feedback,
    'qr_scans',       v_qr,
    'cutoff_pii',     v_cut_pii,
    'cutoff_queue',   v_cut_queue,
    'cutoff_tech',    v_cut_tech
  );
end;
$fn$;

comment on function public.anonymize_guest_pii(integer, integer, integer) is
  'mig 280 (RES-33): pseudonimizeaza PII-ul oaspetilor dupa p_months (decizie fondator: 12), cozile de livrare terminale dupa p_queue_days si identificatorii tehnici dupa p_tech_days. Nu sterge niciun rand. Mascheaza si instantaneele din audit_log ale comenzilor anonimizate (doua chei), altfel pasul pe orders e teatru. Toate predicatele sunt auto-consumate: a doua rulare atinge zero randuri.';

-- Rulează pe pg_cron ca `postgres` (proprietarul), deci nu are nevoie de niciun
-- grant. Nu are apelant client și nu va avea: e o cale care REscrie date, cu
-- pierdere de informație.
revoke all on function public.anonymize_guest_pii(integer, integer, integer)
  from public, anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Programarea, prin manifestul mig 274 (sursa UNICĂ).
--    Zilnic: fereastra e de LUNI, deci o oră anume nu are nicio semnificație
--    (criteriul (a) — age-gated, fără ceas de perete). Minutul e etalat și nu e
--    multiplu de 15 (CJ6), distinct de 23 (rate_limits) și 41 (cron_prune).
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.pg_cron_janitor_manifest
  (job_name, schedule, signature, command, max_age_s, safety_marker, note)
values
  ('menuvia_janitor_guest_pii', '29 3 * * *',
   'public.anonymize_guest_pii(integer, integer, integer)',
   'select public.anonymize_guest_pii(12, 90, 30)', 172800,
   '<> v_marker',
   'mig 280 (RES-33). Pseudonimizeaza PII-ul oaspetilor la 12 luni (decizie fondator), cozile terminale la 90 de zile, IP/user-agent la 30. Predicate AUTO-CONSUMATE: fiecare exclude randurile deja tratate (`<> v_marker`), deci a doua rulare prinde 0 randuri si nu poate dubla nimic. Fereastra e de LUNI: nicio ora de perete, deci se poate programa in GMT.')
on conflict (job_name) do update set
  schedule      = excluded.schedule,
  signature     = excluded.signature,
  command       = excluded.command,
  max_age_s     = excluded.max_age_s,
  safety_marker = excluded.safety_marker,
  note          = excluded.note;

-- ─────────────────────────────────────────────────────────────────────────────
-- D. Asserțiuni la momentul aplicării (centură, NU acoperire — acoperirea e
--    suita GR1–GR10, care rulează la FIECARE replay).
-- ─────────────────────────────────────────────────────────────────────────────

-- D1. Sentinela nu are cifre. Dacă ar avea, telefoanele anonimizate ar intra
--     în gruparea recidiviștilor din `get_reservation_no_show_counts`.
do $$
begin
  if length(regexp_replace('[anonimizat]', '\D', '', 'g')) <> 0 then
    raise exception 'mig 280: sentinela contine cifre — ar polua get_reservation_no_show_counts';
  end if;
end$$;

-- D2. Jobul nu are voie să fie în denylist-ul pg_cron (mig 274).
do $$
begin
  if exists (select 1 from public.pg_cron_janitor_denylist() where fn_name = 'anonymize_guest_pii') then
    raise exception 'mig 280: anonymize_guest_pii e in denylist-ul pg_cron';
  end if;
end$$;

-- D3. Fail-closed pe suprafață: niciun rol client nu poate apela nici janitorul,
--     nici helperul.
do $$
declare v_bad text;
begin
  select string_agg(x.fn || '/' || x.rol, ', ') into v_bad
    from (
      select f.fn, r.rol
        from (values ('public.anonymize_guest_pii(integer,integer,integer)'),
                     ('public.pii_mask_jsonb(jsonb,text[],text)')) as f(fn),
             (values ('anon'), ('authenticated'), ('service_role')) as r(rol)
       where has_function_privilege(r.rol, f.fn, 'execute')
    ) x;
  if v_bad is not null then
    raise exception 'mig 280: functii executabile de roluri client: %', v_bad;
  end if;
end$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- E. Prima rulare, în migrație.
--    Verificat pe PRODUCȚIE la 18 sept 2026, ÎNAINTE de a scrie asta: prima
--    comandă e din 2 iunie 2026 și zero rânduri depășesc vreuna dintre cele
--    trei ferestre (0 rezervări, 0 comenzi, 0 feedback, 0 rânduri de coadă mai
--    vechi de 90 de zile). Deci pe prod apelul e un NO-OP dovedit, iar valoarea
--    lui e alta: execută corpul o dată, la aplicare, în loc să lase prima
--    execuție reală să fie un tick de cron la 03:29 pe care nu-l vede nimeni.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_res jsonb;
begin
  v_res := public.anonymize_guest_pii(12, 90, 30);
  raise notice 'mig 280: prima rulare → %', v_res;
end$$;

-- Programarea efectivă. `pg_cron_apply_manifest()` ARUNCĂ dacă pg_cron lipsește
-- (mig 274, deliberat: pe un cluster care CHIAR are extensia, o eroare de
-- programare nu are voie să fie un NOTICE). Discriminatorul e `pg_extension`,
-- nu `to_regclass('cron.job')` — suita CJ simulează schema `cron`, deci un
-- guard pe tabelă ar cere programare acolo unde nu e nimic de programat
-- (capcană prinsă la mig 274). Mig 274 a făcut deja instalarea și grant-urile;
-- aici doar re-rulăm bucla, ca jobul nou să ajungă în `cron.job`.
do $$
declare v_n integer;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'mig 280: pg_cron neinstalat - programarea sarita, manifestul si functiile sunt aplicate. Clichetul permanent (CJ1-CJ13 + GR1-GR10) nu depinde de extensie.';
    return;
  end if;
  v_n := public.pg_cron_apply_manifest();
  raise notice 'mig 280: % joburi pg_cron programate (inclusiv menuvia_janitor_guest_pii)', v_n;
end$$;

commit;
