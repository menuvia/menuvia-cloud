-- migration_275_pending_receipts_evidence.sql
-- =============================================================================
-- Migrația 275 — janitoare MOARTE + proba fiscală din `pending_receipts`
--   (audit v3, constatare nouă găsită la triajul RES-09; recenzie adversarială
--    în PR-ul mig 274/275)
--
-- 1. CE E MORT. `pending_receipts_cleanup_old` (mig 035) șterge
--    `status = 'completed'`, valoare pe care CHECK-ul tabelei o INTERZICE (admite
--    exact `pending/sent/success/error/cancelled` — identic pe PRODUCȚIE și pe
--    replay). `completed_at` EXISTĂ, deci funcția se parsează, rulează, șterge 0
--    rânduri și iese cu SUCCES: un no-op TĂCUT, pe care orice scheduler l-ar
--    raporta sănătos pe veci. Zero apelanți în repo. E reziduul lui mig 045,
--    care a înlocuit 'completed'→'success' în `bridge_force_resolve_stuck` (vezi
--    MF-03 la „dovedit fals" în AUDIT_V3) și a ratat-o aici.
--
-- 2. DE CE NU SE REPARĂ PREDICATUL — niciun status de pe această tabelă nu e
--    lipsit de greutate fiscală:
--      • `success` — `bon_number` există în EXACT o coloană în toată schema
--        (`pending_receipts.bon_number`, verificat pe prod prin
--        information_schema); `orders` NU are coloană de număr de bon (doar
--        `fiscal_receipt_requested_at`, o intenție de client), iar tabela NU e
--        acoperită de niciun trigger de audit (audit_log acoperă order_items/
--        orders/products/restaurant_memberships/restaurants), deci NU există o
--        a doua copie. Și a doua consecință: ștergerea RE-ARMEAZĂ un bon fiscal
--        REAL — idempotența lui `enqueue_fiscal_receipt` (mig 259) e dată
--        EXCLUSIV de existența unui rând în ('pending','sent','success') pentru
--        acel `order_id`; fără rând, o re-intrare în 'paid' (posibilă prin PATCH
--        direct sub `orders: admin all`, premisa mig 252) pune un `pending` NOU
--        pe care bridge-ul îl TIPĂREȘTE (bandă + Z + ANAF).
--      • `error` / `cancelled` — sunt MUNCĂ VIE, nu arhivă: `bridge_retry_receipt`
--        (lanț 030→038→262→270) acceptă retry pe EXACT aceste două stări, iar
--        singura apărare contra unui retry ORB e markerul `error_info like
--        'POSIBIL DUPLICAT%'`, care trăiește pe aceleași rânduri.
--    Comentariul din 035 („Bonurile cu status error sau cancelled rămân
--    indefinit pentru audit") e INVERSUL unei licențe de ștergere. Retenția
--    rămâne deci: ZERO ștergere automată. Gemenul NEfiscal,
--    `kitchen_tickets_mark_stale` (mig 227), are exact acest DELETE pe 30 de
--    zile și e viu și corect — care e cel mai curat argument că fiscalul nu are
--    voie să-l primească.
--
-- 3. AL DOILEA JANITOR MORT, altfel. `bridge_devices_mark_stale` (mig 035)
--    scrie în `is_active` și citește `last_heartbeat`, coloane care NU există →
--    42703 la ORICE apel (consemnat de mig 265; liveness-ul real se citește din
--    `last_seen_at` prin `bridge_connection_status`). Zero apelanți. Pleacă și
--    el: altfel registrul de janitoare din suită ar avea o EXCEPȚIE permanentă.
--    Cele două nu sunt aceeași sub-clasă: una minte TĂCUT (exit 0), cealaltă
--    ARUNCĂ. Un test care caută doar literale imposibile prinde prima și ratează
--    a doua; unul care EXECUTĂ și cere EFECT le prinde pe amândouă (JL2/JL3).
--
-- 4. CAPCANA NU CEREA UN JANITOR CA S-O DECLANȘEZE. Mig 030 a dat
--    `delete on pending_receipts to authenticated`, iar politica
--    `pending_receipts: admin manage` e FOR ALL → un owner/manager ȘTERGE proba
--    fiscală printr-un `DELETE /rest/v1/pending_receipts?id=eq.…` brut prin
--    PostgREST. Nimic în repo nu folosește acest DELETE (BridgeTab doar CITEȘTE),
--    deci grant-ul se revocă — și TRUNCATE odată cu el (anon și service_role îl
--    aveau pe prod; TRUNCATE nu trece prin trigger-e ROW, deci ar fi ocolit
--    gate-ul de mai jos). A închide funcția moartă și a lăsa verbul viu ar fi
--    exact tiparul „gate în RPC, nu în DATE" pe care 240/264/270 l-au închis.
--
-- 5. GATE-UL E PE TABELĂ, NU PE ROL ȘI NU PE STATUS — și asta e MĂSURAT: un gate
--    pe `current_user in ('anon','authenticated')` (forma din mig 270) e ORB pe
--    calea care contează: `orders` are FK `on delete cascade` spre
--    `pending_receipts`, `authenticated` are DELETE pe `orders` (+ politica
--    `orders: owner delete`), iar într-o cascadă declanșată de client trigger-ul
--    COPILULUI vede `current_user = postgres` (verificat pe replay). Iar un gate
--    pe STATUS/probă (prima variantă a acestei migrații) lăsa o gaură pe care
--    propriul antet o interzice: un rând `error`/`cancelled` fără bon și fără
--    marker era ștergibil, deși e ținta vie a `bridge_retry_receipt`. Regula e
--    deci simplă: **niciun rând din `pending_receipts` nu se șterge cât timp
--    restaurantul lui există**, indiferent de apelant. Singura ștergere
--    legitimă e ERASURE de tenant (GDPR): cascada de la `restaurants`,
--    recunoscută prin ABSENȚA restaurantului-părinte la momentul acțiunii RI
--    (Postgres șterge părintele ÎNAINTE de a rula acțiunea RI pe copil —
--    verificat în ambele direcții: la ștergerea unei COMENZI restaurantul e
--    încă viu → blocat; la ștergerea RESTAURANTULUI e dispărut → scutit).
--    Un rând agățat nu se ȘTERGE, se ÎNCHIDE: `pending` → `bridge_cancel_receipt`;
--    `sent` → `bridge_force_resolve_stuck(id, false)` (045); o urgență reală =
--    migrație nouă cu `disable trigger` sub `lock_timeout`, NU un DELETE ad-hoc.
--
-- 6. CE NU FACE. Nu atinge `audit_log` (jurnal fiscal — decizie de FONDATOR). Nu
--    inventează o politică de elagare pentru `pending_receipts`: aritmetica din
--    035 (365k rânduri/restaurant/an) e reală, dar răspunsul nu poate fi un
--    DELETE pe NICIUN status, iar lucrul care va spune CÂND contează e alarma de
--    stocare din mig 266. Azi toată tabela are UN rând pe producție.
--
-- Verificările din corpul migrației sunt ONE-SHOT (poziția 275 din lanț).
-- Clichetele PERMANENTE: `tests/sql/janitor_liveness_assertions.sql` (JL1–JL9),
-- legat NECONDIȚIONAT în sql-verify.yml.
-- =============================================================================
begin;

-- Antetul casei (153 din 274 de migrații, incl. 264/270): `alter table ...
-- trigger` ia ShareRowExclusiveLock pe `pending_receipts`, tabelă de pe calea
-- de plată — un apply blocat trebuie să pice repede, nu să țină plățile.
set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- ── 1. `pending_receipts_cleanup_old` (mig 035) — DROP, nu reparare ──────────
drop function if exists public.pending_receipts_cleanup_old();

-- ── 2. `bridge_devices_mark_stale` (mig 035) — DROP ─────────────────────────
drop function if exists public.bridge_devices_mark_stale();

-- ── 3. Proba fiscală nu se mai poate șterge/trunchia din rolurile client ────
revoke delete   on public.pending_receipts from authenticated, anon;
revoke truncate on public.pending_receipts from authenticated, anon, service_role;

-- ── 4. Gate-ul e în DATE, nu într-un comentariu ─────────────────────────────
-- DEFINER deliberat ȘI defensiv: azi niciun rol client nu mai are DELETE, dar
-- dacă o migrație viitoare re-acordă verbul, sub INVOKER `select 1 from
-- public.restaurants` ar trece prin RLS, deci un apelant fără apartenență ar
-- vedea părintele ca „dispărut" și ar trece de scutirea de erasure (JL5 ar
-- prinde re-acordarea, dar ordinea nu e garantată). Asertat de JL6a.
create or replace function public.fn_pending_receipts_block_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Scutire UNICĂ: ERASURE de tenant (cascada de la `restaurants`: auth.users →
  -- profiles → restaurants → orders → pending_receipts). La momentul acțiunii RI
  -- rândul-părinte e DEJA șters, deci absența restaurantului e semnătura
  -- cascadei. NU folosim `current_user`: într-o cascadă declanșată de client el
  -- e `postgres`, deci un gate pe rol ar fi orb exact pe calea asta.
  if not exists (select 1 from public.restaurants where id = old.restaurant_id) then
    return old;
  end if;

  raise exception
    'Rândul % din pending_receipts (status %) nu se poate șterge cât timp restaurantul există: coada fiscală e și JURNAL (bon_number, jetonul de idempotență al emiterii — mig 259 —, ținta retry-ului și markerul POSIBIL DUPLICAT — mig 270). Închide-l, nu-l șterge: pending → bridge_cancel_receipt; sent → bridge_force_resolve_stuck(id,false).',
    old.id, old.status
    using errcode = 'P0001', hint = 'fiscal_evidence_delete';
end;
$$;

revoke all on function public.fn_pending_receipts_block_delete() from public;

drop trigger if exists trg_pending_receipts_block_delete on public.pending_receipts;
create trigger trg_pending_receipts_block_delete
  before delete on public.pending_receipts
  for each row execute function public.fn_pending_receipts_block_delete();

comment on function public.fn_pending_receipts_block_delete() is
  'Mig 275: refuza ORICE stergere din pending_receipts cat timp restaurantul randului exista, pentru ORICE apelant (inclusiv postgres, service_role si cascada de la orders). Scutit DOAR erasure-ul de tenant (cascada de la restaurants, recunoscuta prin absenta parintelui). Un rand agatat se INCHIDE (pending -> bridge_cancel_receipt; sent -> bridge_force_resolve_stuck), nu se sterge; o urgenta reala e o migratie cu disable trigger sub lock_timeout. TRUNCATE ocoleste trigger-ele ROW, de aceea e revocat separat (mig 275) si pazit de JL5.';

comment on table public.pending_receipts is
  'Coada fiscala + JURNAL: singurul loc din baza care leaga o comanda de numarul de bon (bon_number) — orders nu are coloana de bon si tabela nu are trigger de audit, deci nu exista a doua copie. NU exista si NU se adauga stergere automata (mig 275: pending_receipts_cleanup_old a fost DROP-uita, nu reparata). Randurile nu se sterg cat timp restaurantul exista (trg_pending_receipts_block_delete).';

-- ── 5. Verificări ONE-SHOT (permanentele: tests/sql/janitor_liveness_...) ───
do $$
declare v_n int; v_lits text[];
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('pending_receipts_cleanup_old', 'bridge_devices_mark_stale');
  if v_n <> 0 then raise exception 'MIG275 FAIL: % janitoare moarte au supravietuit', v_n; end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc ~* 'delete[[:space:]]+from[[:space:]]+(public\.)?pending_receipts';
  if v_n <> 0 then raise exception 'MIG275 FAIL: % functii inca sterg din pending_receipts', v_n; end if;

  if has_table_privilege('authenticated', 'public.pending_receipts', 'DELETE')
     or has_table_privilege('anon', 'public.pending_receipts', 'DELETE')
     or has_table_privilege('authenticated', 'public.pending_receipts', 'TRUNCATE')
     or has_table_privilege('anon', 'public.pending_receipts', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.pending_receipts', 'TRUNCATE') then
    raise exception 'MIG275 FAIL: un rol client (sau service_role pe TRUNCATE) mai poate goli pending_receipts'; end if;

  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and column_name = 'bon_number';
  if v_n <> 1 then raise exception 'MIG275 FAIL: bon_number apare in % coloane', v_n; end if;

  select array_agg(x order by x) into v_lits
    from pg_constraint c,
         regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m(arr),
         unnest(m.arr) x
   where c.conname = 'pending_receipts_status_check';
  if v_lits is distinct from array['cancelled','error','pending','sent','success'] then
    raise exception 'MIG275 FAIL: CHECK-ul de status admite %', v_lits; end if;

  raise notice 'MIG275 OK (verificari one-shot; permanentele: tests/sql/janitor_liveness_assertions.sql)';
end $$;

commit;
