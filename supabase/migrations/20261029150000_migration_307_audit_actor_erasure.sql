-- =============================================================================
-- MIGRATION 307 — Jurnalul acțiunilor de platformă, tura de casă și comenzile
-- servite de patron NU mai blochează ștergerea GDPR a contului (Art. 17)
-- =============================================================================
-- ── Problema ────────────────────────────────────────────────────────────────
-- `platform_audit_log.actor_user_id` (mig 186) era `uuid NOT NULL references
-- profiles ON DELETE RESTRICT`. Cascada `delete from auth.users` → `profiles`
-- pica pe RESTRICT, iar `process_account_deletions` (042→179→183→282→284→295)
-- prinde eroarea în handler-ul per-user (`exception when others → continue`,
-- mig 183) și REÎNCEARCĂ LA INFINIT, TĂCUT: contul nu se șterge niciodată.
-- Cine scrie în jurnal: fondatorii (toate `admin_*`, inclusiv cele din 304),
-- afiliații (`log_partner_visit` 187, `request_partner_access` 286, profilul de
-- payout 294) și ownerii (`revoke_partner_access` 187, `grant_/revoke_partner_
-- access` 286). Mig 303 (`owner_grant_partner_access`, pe ORICE plan, din cardul
-- „Agentul tău") a mutat clasa de la „câțiva fondatori și parteneri" la „ORICE
-- patron care îi dă acces agentului". Mig 295 detașase afiliații de FK-urile
-- RESTRICT ale afilierii, dar NU și de jurnal: un afiliat care și-a văzut vreodată
-- un client (`enter_account`) sau și-a setat contul de payout rămânea neștergibil.
--
-- Descoperirea pe catalog (FK-uri care opresc cascada din `auth.users`) a găsit
-- încă un membru VIU al aceleiași clase, cu altă formă:
-- `cash_shifts.opened_by` (mig 032) e `NOT NULL` + `ON DELETE SET NULL` — o
-- contradicție: acțiunea RI încearcă să scrie NULL într-o coloană NOT NULL și
-- pică (23502). Reprodus pe replay: un ospătar/manager care a deschis o tură pe
-- restaurantul altcuiva NU se poate șterge, iar un OWNER care și-a deschis o
-- tură pe propriul restaurant nici el (acțiunea SET NULL din `auth.users` rulează
-- înaintea cascadei restaurants → cash_shifts). Adică ORICE local de pe Plan 3
-- care folosește casa de marcat. NOT NULL nu garanta nimic în schimb: singurul
-- scriitor e `open_shift` (DEFINER, gate `is_admin` ⇒ `auth.uid()` ne-NULL), iar
-- politica `cash_shifts: admin manage` lasă oricum un admin să scrie ORICE uuid
-- în coloană — deci coloana n-a fost niciodată o atribuire verificată, doar un
-- blocaj de ștergere. Devine nullable, exact ca `closed_by` (aceeași tabelă,
-- aceeași acțiune) și ca toate atribuirile de staff din mig 055.
--
-- Al TREILEA membru, cel mai larg, nu se vede pe catalog ci doar pe date COMISE:
-- un rând cu DOUĂ FK-uri `ON DELETE SET NULL` spre ACELAȘI user. `orders` are
-- patru (`created_by`, `served_by`, `paid_by`, `discount_applied_by`),
-- `cash_shifts` două (`opened_by`, `closed_by`). În cascada unică din
-- `auth.users`, prima acțiune SET NULL rescrie rândul, a doua îl rescrie din nou
-- — iar pe o versiune scrisă de tranzacția CURENTĂ, Postgres re-verifică TOATE
-- FK-urile rândului (`RI_FKey_fk_upd_check_required`), inclusiv
-- `restaurant_id`. Coada de evenimente RI e parcursă în LĂȚIME: ștergerea
-- restaurantului (din `profiles`) rulează înaintea acelei verificări, iar
-- ștergerea rândului însuși (din `restaurants`) abia după ea → 23503 „insert or
-- update on table orders violates foreign key constraint
-- orders_restaurant_id_fkey". Reprodus pe replay cu rânduri COMISE (ca pe
-- producție): owner cu o comandă `created_by = served_by = el` → NEștergibil; cu
-- un singur FK pe rând → se șterge; la fel tura deschisă ȘI închisă de owner.
-- Adică ORICE patron care a luat sau a servit el însuși o comandă. Fix-ul nu e
-- pe catalog (un FK DEFERRABLE pe `orders.restaurant_id` ar muta TOATE erorile
-- de scriere la COMMIT): `process_account_deletions` (lanț
-- 042→179→183→282→284→295→307, copie VERBATIM din 295 + O instrucțiune) șterge
-- restaurantele owner-ului într-o instrucțiune PROPRIE, imediat înaintea
-- contului — cât profilul încă există, deci nicio acțiune SET NULL nu mai
-- întâlnește un rând al restaurantului. Starea finală e identică (cascada le
-- ștergea oricum), arhivele fiscale (179/284) sunt scrise ÎNAINTE, iar
-- trigger-ele de DELETE din închiderea restaurantului (scutirea din 275,
-- invariantul de owner din 096) tratau deja restaurantul dispărut. Staff-ul
-- (ospătar / manager pe restaurantul ALTCUIVA) nu era afectat: restaurantul
-- există, verificarea trece.
-- Proba cap-coadă, MANUALĂ (o suită într-o singură tranzacție nu o poate
-- reproduce: pe un rând scris de tranzacția curentă și UN singur SET NULL
-- forțează verificarea), pe replay, cu fixtură COMISĂ — owner pe Plan 3 cu o
-- comandă `created_by = served_by = el`, tura deschisă și închisă de el, acces
-- acordat agentului (`owner_grant_partner_access`, rând în jurnal), D+30:
--   • `process_account_deletions` din 295 → 0 șterși, WARNING „23503: insert
--     or update on table orders violates foreign key constraint
--     orders_restaurant_id_fkey", contul rămâne;
--   • din 307 → 1 șters, rândul de jurnal rămâne cu actor NULL +
--     `actor_erased_at`.
--
-- ── Decizia de design (jurnalul) ────────────────────────────────────────────
-- Rândul de jurnal SUPRAVIEȚUIEȘTE ștergerii contului (e jurnalul acțiunilor de
-- platformă: CE s-a făcut, pe CE restaurant, CÂND), dar fără legătură spre un
-- profil șters:
--   • `actor_user_id` devine nullable, FK `ON DELETE SET NULL`;
--   • coloană nouă `actor_erased_at` = momentul în care legătura a fost tăiată;
--   • CHECK bicondițional `(actor_user_id is null) = (actor_erased_at is not
--     null)`: un actor NULL înseamnă ÎNTOTDEAUNA „cont șters" — niciodată „scris
--     fără autentificare" — iar un rând viu nu poate purta tombstone;
--   • trigger BEFORE INSERT OR UPDATE OF (actor_user_id, actor_erased_at)
--     (`trg_platform_audit_log_actor_guard`, DEFINER `public, pg_temp`):
--       – INSERT cere actor ne-NULL și fără tombstone (păstrează exact garanția
--         vechiului NOT NULL: `log_platform_action` fără JWT pică, hint
--         `audit_actor_required` — nimeni nu poate fabrica un rând „șters");
--       – UPDATE permite O SINGURĂ tranziție: actor → NULL, și DOAR după ce
--         profilul nu mai există (adică acțiunea RI a cascadei, pe ORICE cale de
--         ștergere: process_account_deletions, Dashboard, API admin). Atunci
--         ștampilează `actor_erased_at`. Orice altceva — golire cu profilul viu,
--         schimbarea actorului, re-legarea unui rând șters, rescrierea
--         tombstone-ului — e respins (hint `audit_actor_immutable`), inclusiv
--         pentru service_role, care ocolește RLS-ul.
--       – DEFINER, nu INVOKER: verificarea „profilul nu mai există" trebuie să
--         vadă TOATE profilurile; sub RLS-ul unui apelant (politica
--         `profiles_self_select`) orice profil străin ar părea „inexistent" și
--         golirea ar trece (aceeași capcană ca în 278).
-- De ce SET NULL și nu tiparul 295 (FK RESTRICT + detașare chemată din
-- process_account_deletions): 295 a păstrat RESTRICT fiindcă rândul de afiliat
-- poartă PII (telefon, IBAN, CUI, branding) care TREBUIE golite — o ștergere pe
-- altă cale ar fi lăsat PII lângă un profil NULL. Rândul de jurnal nu poartă PII
-- a actorului în afara legăturii însăși: am enumerat toate cele ~40 de apeluri
-- `log_platform_action` (ultimele definiții) — `details` conține id-uri, stări,
-- planuri, sume, hash-uri, motive scrise de fondator; NICIODATĂ email, nume sau
-- telefon. (Rândurile de payout 294 au `iban_last4` — un identificator TRUNCHIAT,
-- păstrat deliberat și în rândurile FONDATORULUI despre același payout, ca
-- evidență de plată, ca în 295; a-l masca doar în rândurile actorului șters ar fi
-- o jumătate de măsură, deci rămâne — consemnat.) Așa că legătura e TOT ce
-- trebuie tăiat, iar SET NULL o taie pe ORICE cale de ștergere (Dashboard, API
-- admin), nu doar prin `process_account_deletions` — fără o a doua detașare de
-- ținut în sincron cu funcția.
-- Fără pseudonim: NU păstrăm nicio identitate de corelare. Un hash al uuid-ului
-- e REVERSIBIL (uuid-ul supraviețuiește în instantaneele din `audit_log`, unde
-- retenția e „păstrăm tot"), iar un jeton aleator per persoană ar permite
-- „singling out" peste rânduri (considerentul 26 GDPR) — exact ce ar ține
-- datele personale. `actor_kind` (founder/affiliate/owner) rămâne: rolul, nu
-- persoana.
--
-- ── Cititorii ───────────────────────────────────────────────────────────────
-- Singurul cititor al coloanei e `admin_list_audit_log` (186, FounderPage →
-- secțiunea Audit), care făcea INNER JOIN pe `profiles` — un rând cu actor NULL
-- ar fi DISPĂRUT din panou exact când rămâne pentru evidență (clasa §5 din 295).
-- Acum LEFT JOIN: `actor_email` NULL + chei noi la final `actor_erased`
-- (boolean) și `actor_erased_at`; UI-ul afișează „Cont șters". Tipul de retur
-- rămâne jsonb → `create or replace`.
--
-- ── Rezidual consemnat, NEadresat (decizie de fondator) ─────────────────────
-- `purchase_order_items.ingredient_id → ingredients ON DELETE RESTRICT`: ambele
-- tabele sunt în cascada owner-ului, dar coada de evenimente RI e parcursă în
-- LĂȚIME, iar verificarea RESTRICT (generată la ștergerea ingredientelor) ajunge
-- înaintea cascadei purchase_orders → purchase_order_items când trigger-ul RI al
-- ingredientelor sortează înaintea celui al NIR-urilor pe `restaurants` (după
-- nume = OID). Pe replay: un owner cu un rând de NIR NU se poate șterge.
-- Rezultatul depinde de ordinea OID-urilor, deci de mediu. NU se repară aici
-- fiindcă reparația naivă (CASCADE / NO ACTION amânat) ar transforma un blocaj
-- Art. 17 într-o ȘTERGERE TĂCUTĂ de documente contabile (NIR = document
-- justificativ, Legea 82/1991) — aceeași întrebare pe care 179/284 au rezolvat-o
-- pentru facturi/bonuri prin arhivare. Clichetul de clasă îl ține în registru ca
-- `open`, cu NOTICE la fiecare rulare.
--
-- Teste: AE1–AE7 `tests/sql/auto/307_audit_actor_erasure.sql` (inclusiv
-- clichetele de CLASĂ: FK-urile care opresc cascada din `auth.users` — AE6 — și
-- rândurile cu dublu SET NULL spre user — AE7).
-- =============================================================================
begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ═══════════════════════════════════════════════════════════════════════════
-- §1. platform_audit_log — legătura spre actor se taie la ștergerea profilului
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.platform_audit_log
  add column if not exists actor_erased_at timestamptz;

comment on column public.platform_audit_log.actor_erased_at is
  'mig 307: momentul în care profilul actorului a fost șters (GDPR) și actor_user_id a devenit NULL prin ON DELETE SET NULL. NULL = actor viu. Ștampilat de trg_platform_audit_log_actor_guard.';

alter table public.platform_audit_log alter column actor_user_id drop not null;

-- FK-ul vechi (RESTRICT) se găsește pe DEFINIȚIE (coloana), nu pe nume.
do $$
declare r record;
begin
  for r in
    select c.conname
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.conrelid = 'public.platform_audit_log'::regclass
       and c.contype = 'f'
       and a.attname = 'actor_user_id'
  loop
    execute format('alter table public.platform_audit_log drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.platform_audit_log
  add constraint platform_audit_log_actor_user_id_fkey
  foreign key (actor_user_id) references public.profiles(id) on delete set null;

alter table public.platform_audit_log drop constraint if exists platform_audit_log_actor_or_erased;
alter table public.platform_audit_log add constraint platform_audit_log_actor_or_erased
  check ((actor_user_id is null) = (actor_erased_at is not null));

create or replace function public.platform_audit_log_actor_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    -- Garanția vechiului NOT NULL: un rând nou are un actor autentificat.
    -- Un rând „deja șters" nu se poate fabrica.
    if new.actor_user_id is null or new.actor_erased_at is not null then
      raise exception using errcode = 'check_violation',
        message = 'platform_audit_log: un rând nou cere un actor autentificat (auth.uid()), nu un actor șters',
        hint    = 'audit_actor_required';
    end if;
    return new;
  end if;

  -- UPDATE fără schimbare pe coloanele actorului: nimic de verificat.
  if new.actor_user_id is not distinct from old.actor_user_id
     and new.actor_erased_at is not distinct from old.actor_erased_at then
    return new;
  end if;

  -- Singura tranziție permisă: actor viu → NULL, DOAR după ce profilul nu mai
  -- există (acțiunea ON DELETE SET NULL a cascadei, pe orice cale de ștergere).
  if old.actor_user_id is not null
     and new.actor_user_id is null
     and not exists (select 1 from public.profiles p where p.id = old.actor_user_id) then
    new.actor_erased_at := now();
    return new;
  end if;

  raise exception using errcode = 'check_violation',
    message = 'platform_audit_log: actorul unui rând de jurnal e imuabil — se golește DOAR prin ștergerea profilului (ON DELETE SET NULL)',
    hint    = 'audit_actor_immutable';
end;
$$;

-- Funcție de trigger: nu e apelabilă prin /rpc de nimeni (clasa mig 279 / RP13;
-- default privileges din Supabase re-acordă EXECUTE funcțiilor noi).
revoke all on function public.platform_audit_log_actor_guard()
  from public, anon, authenticated, service_role;

comment on function public.platform_audit_log_actor_guard() is
  'mig 307: INSERT cere actor ne-NULL fără tombstone; UPDATE permite DOAR actor → NULL după ștergerea profilului (ștampilează actor_erased_at). Restul: audit_actor_immutable.';

drop trigger if exists trg_platform_audit_log_actor_guard on public.platform_audit_log;
create trigger trg_platform_audit_log_actor_guard
  before insert or update of actor_user_id, actor_erased_at on public.platform_audit_log
  for each row execute function public.platform_audit_log_actor_guard();

-- ═══════════════════════════════════════════════════════════════════════════
-- §2. admin_list_audit_log — LEFT JOIN: rândul actorului șters RĂMÂNE în panou
--     Copie VERBATIM din 186 + LEFT JOIN + două chei NOI la final.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.admin_list_audit_log(p_limit integer default 100)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;

  return coalesce((
    select jsonb_agg(row_data)
      from (
        select jsonb_build_object(
                 'id',            l.id,
                 'actor_email',   p.email,
                 'actor_kind',    l.actor_kind,
                 'restaurant_id', l.restaurant_id,
                 'restaurant_name', r.name,
                 'action',        l.action,
                 'details',       l.details,
                 'created_at',    l.created_at,
                 -- mig 307: actorul șters (GDPR) — rândul rămâne, fără identitate.
                 'actor_erased',    l.actor_user_id is null,
                 'actor_erased_at', l.actor_erased_at
               ) as row_data
          from public.platform_audit_log l
          left join public.profiles p on p.id = l.actor_user_id
          left join public.restaurants r on r.id = l.restaurant_id
         order by l.created_at desc
         limit greatest(1, least(coalesce(p_limit, 100), 500))
      ) rows
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_list_audit_log(integer) from public, anon, service_role;
grant execute on function public.admin_list_audit_log(integer) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- §3. cash_shifts.opened_by — NOT NULL + ON DELETE SET NULL era o contradicție
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.cash_shifts alter column opened_by drop not null;

comment on column public.cash_shifts.opened_by is
  'Cine a deschis tura (auth.uid() din open_shift). mig 307: nullable — ON DELETE SET NULL (mig 032) pe o coloană NOT NULL bloca ștergerea GDPR a oricui a deschis vreodată o tură. NULL = cont șters, ca closed_by.';

-- ═══════════════════════════════════════════════════════════════════════════
-- §4. process_account_deletions — lanț 042→179→183→282→284→295→307.
--    Copie VERBATIM din 295 + UN `delete from public.restaurants` imediat
--    înaintea ștergerii contului. Orice recreare pornește de AICI și păstrează
--    TOT: lacătul, ordinea, claim-ul, cele 3 politici, arhivarea facturilor ȘI
--    a bonurilor, gate-ul `block` pe ambele, amânarea pe bon `sent` și pe payout
--    în mișcare, detașarea afilierii, ștergerea restaurantelor ÎNAINTEA
--    contului, `limit 100` și izolarea per-user.
-- ═══════════════════════════════════════════════════════════════════════════
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
  v_has_receipts boolean;  -- mig 284
  v_archived  integer;
  v_archived_receipts integer;  -- mig 284
  v_affiliate jsonb;            -- mig 295
  v_aff_id    uuid;             -- mig 295 (amânarea pe payout în mișcare)
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

      -- mig 284: SERIALIZARE cu bridge-ul, ÎNAINTEA oricărei verificări pe bonuri
      -- (recenzie CodeRabbit pe #271). Fără lacăte, sub READ COMMITTED: un bon
      -- `sent` confirmat de bridge DUPĂ citirea arhivei ar fi arhivat în starea
      -- veche (fără bon_number), iar un rând inserat între arhivare și cascadă
      -- s-ar șterge fără arhivă. `for update` pe restaurante blochează inserările
      -- noi (FK-ul ia KEY SHARE pe părinte); lacătul pe rândurile de jurnal
      -- blochează confirmările și claim-urile pe rândurile existente.
      perform 1 from public.restaurants where owner_id = v_user.id for update;
      perform 1
        from public.pending_receipts pr
        join public.restaurants r on r.id = pr.restaurant_id
       where r.owner_id = v_user.id
       for update of pr;

      -- Un bon `sent` e în TIPĂRIRE: nu ștergem contul sub el. Se SARE pentru
      -- tick-ul ăsta, FĂRĂ deletion_blocked_reason — rămâne eligibil, iar
      -- janitorul orar `bridge_mark_stale_as_error` (pg_cron, mig 274) mută un
      -- `sent` agățat în `error`, deci amânarea e MĂRGINITĂ. `pending` NU se
      -- așteaptă: un bridge offline pe termen nedefinit ar bloca Art. 17 pentru
      -- totdeauna, tăcut; rândul `pending` se arhivează ca atare (nimic tipărit).
      if exists (
        select 1
          from public.pending_receipts pr
          join public.restaurants r on r.id = pr.restaurant_id
         where r.owner_id = v_user.id
           and pr.status = 'sent'
      ) then
        raise notice 'process_account_deletions: user % sărit — bon în tipărire (sent), reîncercat la tick-ul următor', v_user.id;
        continue;
      end if;

      -- mig 295: un payout de afiliat cu BANI ÎN MIȘCARE (processing / on_hold /
      -- failed CU referință) AMÂNĂ userul, ca bonul `sent`: detașarea golește
      -- IBAN-ul, iar banii pot reveni sau trebuie re-trimiși. Lacătul pe rândul
      -- de afiliat serializează cu `admin_payout_start_transfer` (singura
      -- intrare în mișcare, ia același lacăt); verificat ÎNAINTEA arhivărilor.
      select id into v_aff_id from public.affiliates
       where profile_id = v_user.id
       for update;
      if v_aff_id is not null and public.affiliate_payouts_in_flight(v_aff_id) > 0 then
        raise notice 'process_account_deletions: user % sărit — payout de afiliat cu bani în mișcare, reîncercat la tick-ul următor', v_user.id;
        continue;
      end if;

      -- mig 284: are owner-ul bonuri fiscale TIPĂRITE (`success`, cu bon_number)?
      -- `pending_receipts` e singura legătură comandă↔bon din bază (mig 275), iar
      -- cascada auth.users → profiles → restaurants → orders → pending_receipts
      -- o șterge. Sub `block`, un bon tipărit blochează ca o factură emisă.
      select exists(
        select 1
          from public.pending_receipts pr
          join public.restaurants r on r.id = pr.restaurant_id
         where r.owner_id = v_user.id
           and pr.status = 'success'
      ) into v_has_receipts;

      -- ── Politica BLOCK ──────────────────────────────────────────
      -- Nu șterge. Marchează motivul; owner-ul rezolvă manual (transfer/închidere).
      if v_policy = 'block' and (v_has_invoices or v_has_receipts) then
        update public.profiles
           set deletion_blocked_reason =
                 'Blocat: contul are documente fiscale (facturi sau bonuri) care trebuie '
                 'păstrate 10 ani (Legea 82/1991). Contactați privacy@menuvia.ro pentru '
                 'transfer sau închiderea restaurantului înainte de ștergere.'
         where id = v_user.id;
        raise notice 'process_account_deletions: user % blocat (are documente fiscale)', v_user.id;
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

      -- mig 284: JURNALUL fiscal al restaurantelor owner-ului (toate rândurile din
      -- pending_receipts: bonuri, Z/X, marcaje POSIBIL DUPLICAT) se arhivează
      -- ÎNAINTEA cascadei, pe ORICE politică — mig 179 arhiva doar `invoices`, iar
      -- politica activă pe prod e `archive_anonymize`. Idempotent (on conflict).
      -- O eroare aici cade în handler-ul per-user de mai jos: userul NU se șterge
      -- și se reîncearcă la tick-ul următor — niciodată ștergere fără arhivă.
      v_archived_receipts := public.archive_fiscal_receipts_for_user(v_user.id);
      if v_archived_receipts > 0 then
        raise notice 'process_account_deletions: user % — % rânduri din jurnalul de bonuri arhivate',
          v_user.id, v_archived_receipts;
      end if;

      -- mig 295: afilierea are FK-uri RESTRICT pe profil (097:62-63, :90-91) —
      -- fără detașare, ștergerea de mai jos pica pe ORICE afiliat sau cont
      -- atribuit, iar handler-ul per-user o reîncerca la infinit. Afiliatul
      -- devine `closed` cu PII golite, atribuirea pierde referred_profile_id
      -- (tombstone); ledger-ul și payout-urile rămân (retenție fiscală). În
      -- aceeași subtranzacție: dacă ștergerea pică, se derulează și detașarea.
      v_affiliate := public.erase_affiliate_identity_for_user(v_user.id);
      if (v_affiliate->>'affiliate_erased')::boolean
         or (v_affiliate->>'attributions_detached')::int > 0 then
        raise notice 'process_account_deletions: user % — afiliere detașată (%)',
          v_user.id, v_affiliate;
      end if;

      -- mig 307: restaurantele owner-ului se șterg ÎNAINTEA contului, într-o
      -- instrucțiune PROPRIE. În cascada unică din auth.users, un rând cu DOUĂ
      -- FK-uri SET NULL spre același user (orders: created_by / served_by /
      -- paid_by / discount_applied_by; cash_shifts: opened_by / closed_by) e
      -- rescris de două ori; la a doua rescriere Postgres re-verifică TOATE
      -- FK-urile rândului (versiunea veche e a tranzacției curente), iar
      -- verificarea pe restaurant_id rulează DUPĂ ce restaurantul a fost șters și
      -- ÎNAINTE ca rândul să fie atins de cascadă → 23503, userul sărit la
      -- infinit. Orice owner care a servit sau a încasat el însuși o comandă
      -- rămânea neștergibil (reprodus pe replay, cu rânduri COMISE). Aici
      -- rândurile pleacă odată cu restaurantul, cât profilul încă există, deci
      -- nicio acțiune SET NULL nu mai întâlnește un rând al restaurantului.
      -- Starea finală e identică (cascada le ștergea oricum); arhivele fiscale
      -- (facturi, jurnalul de bonuri) sunt deja scrise mai sus.
      delete from public.restaurants where owner_id = v_user.id;

      -- Ștergerea propriu-zisă. Cascada (auth.users → profiles → …) șterge
      -- datele personale rămase. retained_invoices / retained_receipts NU sunt
      -- cascadate → supraviețuiesc. Atribuirile de staff (orders.*_by,
      -- cash_shifts.*_by, platform_audit_log.actor_user_id — mig 055/307) devin
      -- NULL prin ON DELETE SET NULL.
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
grant execute on function public.process_account_deletions() to service_role;

comment on function public.process_account_deletions() is
  'Sterge conturile marcate GDPR dupa D+30 (Art. 17). mig 282: single-flight (pg_try_advisory_xact_lock), ordine determinista, for update skip locked. mig 284: arhiveaza jurnalul de bonuri (retained_receipts) inaintea cascadei, pe orice politica; politica block blocheaza si pe bonuri success. mig 295: detaseaza afilierea (FK RESTRICT pe profil) inaintea stergerii. mig 307: sterge restaurantele owner-ului intr-o instructiune proprie inaintea contului (dublul SET NULL pe orders/cash_shifts re-verifica restaurant_id dupa ce restaurantul disparuse). Ruleaza pe pg_cron (menuvia_janitor_gdpr_deletions) si din automation-cron.js.';

-- ═══════════════════════════════════════════════════════════════════════════
-- §5. Asserții fail-closed (evaluate o dată, aici; clichetul VIU e în AE1–AE7)
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_src   text;
  v_bad   text;
  v_attrs text[];
begin
  -- 4a. Coloana e nullable, tombstone-ul există.
  if exists (select 1 from pg_attribute
              where attrelid = 'public.platform_audit_log'::regclass
                and attname = 'actor_user_id' and attnotnull) then
    raise exception 'mig 307: platform_audit_log.actor_user_id e încă NOT NULL';
  end if;
  if not exists (select 1 from pg_attribute
                  where attrelid = 'public.platform_audit_log'::regclass
                    and attname = 'actor_erased_at' and not attisdropped) then
    raise exception 'mig 307: lipsește platform_audit_log.actor_erased_at';
  end if;

  -- 4b. EXACT un FK pe actor_user_id, spre profiles, ON DELETE SET NULL.
  if (select count(*) from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
       where c.conrelid = 'public.platform_audit_log'::regclass and c.contype = 'f'
         and a.attname = 'actor_user_id') <> 1
     or not exists (select 1 from pg_constraint
                     where conname = 'platform_audit_log_actor_user_id_fkey'
                       and conrelid = 'public.platform_audit_log'::regclass
                       and confrelid = 'public.profiles'::regclass
                       and confdeltype = 'n') then
    raise exception 'mig 307: FK-ul actorului nu e exact unul, spre profiles, ON DELETE SET NULL';
  end if;

  -- 4c. CHECK-ul bicondițional.
  if not exists (select 1 from pg_constraint
                  where conname = 'platform_audit_log_actor_or_erased'
                    and conrelid = 'public.platform_audit_log'::regclass
                    and contype = 'c' and convalidated) then
    raise exception 'mig 307: lipsește CHECK-ul actor-sau-tombstone';
  end if;

  -- 4d. Trigger-ul: BEFORE INSERT OR UPDATE OF (ambele coloane) ROW = tgtype 23,
  --     activ; funcția DEFINER cu pg_temp, neapelabilă de niciun rol client.
  select array_agg(a.attname::text order by a.attname collate "C") into v_attrs
    from pg_trigger t
    join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = any (t.tgattr::int2[])
   where t.tgrelid = 'public.platform_audit_log'::regclass
     and t.tgname = 'trg_platform_audit_log_actor_guard';
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.platform_audit_log'::regclass
                    and tgname = 'trg_platform_audit_log_actor_guard'
                    and tgtype = 23 and tgenabled = 'O')
     or v_attrs is distinct from array['actor_erased_at', 'actor_user_id'] then
    raise exception 'mig 307: trg_platform_audit_log_actor_guard lipsește / altă formă (coloane: %)', v_attrs;
  end if;
  if not exists (select 1 from pg_proc
                  where oid = 'public.platform_audit_log_actor_guard()'::regprocedure
                    and prosecdef
                    and 'search_path=public, pg_temp' = any (proconfig)) then
    raise exception 'mig 307: platform_audit_log_actor_guard nu e DEFINER cu search_path public, pg_temp';
  end if;
  if has_function_privilege('anon', 'public.platform_audit_log_actor_guard()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.platform_audit_log_actor_guard()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.platform_audit_log_actor_guard()', 'EXECUTE') then
    raise exception 'mig 307: funcția de trigger e apelabilă din afară';
  end if;

  -- 4e. Cititorul fondatorului: LEFT JOIN, gate-ul păstrat, chei noi.
  select p.prosrc into v_src from pg_proc p
   where p.oid = 'public.admin_list_audit_log(integer)'::regprocedure;
  if v_src ~* '(^|[^t])\s+join\s+public\.profiles\s+p\s+on\s+p\.id\s*=\s*l\.actor_user_id'
     or position('left join public.profiles p on p.id = l.actor_user_id' in v_src) = 0
     or position('is_platform_admin' in v_src) = 0
     or position('''actor_erased''' in v_src) = 0 then
    raise exception 'mig 307: admin_list_audit_log nu face LEFT JOIN pe profiles / a pierdut gate-ul';
  end if;
  if has_function_privilege('anon', 'public.admin_list_audit_log(integer)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.admin_list_audit_log(integer)', 'EXECUTE') then
    raise exception 'mig 307: suprafața admin_list_audit_log s-a schimbat';
  end if;

  -- 4f. cash_shifts.opened_by nullable, FK-ul rămâne SET NULL.
  if exists (select 1 from pg_attribute
              where attrelid = 'public.cash_shifts'::regclass
                and attname = 'opened_by' and attnotnull) then
    raise exception 'mig 307: cash_shifts.opened_by e încă NOT NULL';
  end if;

  -- 4g. process_account_deletions: invariantele lanțului (copia 295) + ștergerea
  --     restaurantelor DUPĂ arhivări și detașare, ÎNAINTEA contului.
  select p.prosrc into v_src from pg_proc p
   where p.oid = 'public.process_account_deletions()'::regprocedure;
  if position('pg_try_advisory_xact_lock' in v_src) = 0
     or position('order by deletion_requested_at, id' in v_src) = 0
     or position('for update skip locked' in v_src) = 0
     or position('archive_fiscal_invoices_for_user' in v_src) = 0
     or position('deletion_blocked_reason is null' in v_src) = 0
     or position('exception when others then' in v_src) = 0
     or position('limit 100' in v_src) = 0
     or position('for update of pr' in v_src) = 0
     or position('and pr.status = ''sent''' in v_src) = 0
     or position('v_policy = ''block'' and (v_has_invoices or v_has_receipts)' in v_src) = 0
     or position('transfer_tombstone' in v_src) = 0
     or position('public.affiliate_payouts_in_flight(v_aff_id) > 0' in v_src) = 0 then
    raise exception 'mig 307: process_account_deletions a pierdut un invariant din 179/183/282/284/295';
  end if;
  if not (position('v_archived_receipts := public.archive_fiscal_receipts_for_user(v_user.id)' in v_src)
            between 1 and position('delete from public.restaurants where owner_id = v_user.id' in v_src)
          and position('public.erase_affiliate_identity_for_user(v_user.id)' in v_src)
            between 1 and position('delete from public.restaurants where owner_id = v_user.id' in v_src)
          and position('delete from public.restaurants where owner_id = v_user.id' in v_src)
            between 1 and position('delete from auth.users where id = v_user.id' in v_src)) then
    raise exception 'mig 307: ordinea arhivare → detașare → restaurante → cont nu mai e respectată în process_account_deletions';
  end if;
  if has_function_privilege('anon', 'public.process_account_deletions()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.process_account_deletions()', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.process_account_deletions()', 'EXECUTE') then
    raise exception 'mig 307: suprafața process_account_deletions s-a schimbat';
  end if;

  -- 4h. Clasa, o singură evaluare aici: niciun FK din public direct spre
  --     profiles/auth.users nu mai blochează ștergerea (RESTRICT / NO ACTION, sau
  --     SET NULL pe coloană NOT NULL) în afara celor două detașate de 295.
  select string_agg(format('%s.%s(%s)', n.nspname, k.relname, a.attname), ', ')
    into v_bad
    from pg_constraint c
    join pg_class k on k.oid = c.conrelid
    join pg_namespace n on n.oid = k.relnamespace and n.nspname = 'public'
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.contype = 'f'
     and c.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
     and (c.confdeltype in ('r', 'a') or (c.confdeltype = 'n' and a.attnotnull))
     and (k.relname, a.attname) not in (('affiliates', 'profile_id'),
                                        ('affiliate_attributions', 'referred_profile_id'));
  if v_bad is not null then
    raise exception 'mig 307: FK-uri spre profiles/auth.users care blochează ștergerea GDPR: %', v_bad;
  end if;
end $$;

commit;
