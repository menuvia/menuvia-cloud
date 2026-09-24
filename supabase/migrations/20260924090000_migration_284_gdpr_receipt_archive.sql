-- migration_284_gdpr_receipt_archive.sql
-- =============================================================================
-- Ștergerea GDPR a unui OWNER nu mai distruge jurnalul de bonuri fiscale.
--
-- ── Problema (verificată în cod) ─────────────────────────────────────────────
-- `delete from auth.users` (process_account_deletions, lanț 042→179→183→282)
-- cascadează: profiles.id (base_schema:12) → restaurants.owner_id → orders →
-- pending_receipts (mig 030:116-117, ambele `on delete cascade`). Mig 275 a
-- scutit deliberat de gate-ul anti-ștergere exact cascada de la `restaurants`
-- (erasure-ul de tenant), deci bonurile pleacă odată cu contul.
--
-- Singura arhivare fiscală (mig 179, `archive_fiscal_invoices_for_user`) copiază
-- DOAR `invoices`. Iar `pending_receipts` e SINGURA legătură comandă↔bon din
-- toată baza (`bon_number` există într-o singură coloană — mig 275/276): după
-- cascadă, nimic din Menuvia nu mai poate spune ce bon a ieșit pentru ce
-- comandă, deși factura corespunzătoare (dacă există) e păstrată 10 ani.
--
-- Politica ACTIVĂ pe producție e `archive_anonymize` (citit 24 sept 2026), adică
-- ramura care NU blochează — deci un fix legat doar de ramura `block` n-ar fi
-- făcut nimic. Arhivarea stă ÎNAINTEA ștergerii, pe ORICE politică.
--
-- ── Ce se adaugă ─────────────────────────────────────────────────────────────
--   A. `retained_receipts` — oglinda lui `retained_invoices` (179): fără FK (ca să
--      nu fie cascadată), RLS pornit fără politici, revoke pe rolurile client.
--      Coloanele originale au prefixul `original_` DELIBERAT: o tabelă cu
--      `order_id` + `restaurant_id` ar intra sub clichetul TG4 (mig 278), care
--      i-ar cere un gate de tenant pe comenzi care nu mai există.
--   B. `archive_fiscal_receipts_for_user(uuid)` — copiază TOT jurnalul
--      restaurantelor owner-ului (bonuri `success`, Z/X, `error` cu marcaj
--      POSIBIL DUPLICAT, `cancelled`): fiecare rând e dovadă (mig 275).
--      Idempotent prin index unic pe `original_receipt_id`. Payload-ul FiscalNet
--      conține DOAR produse/prețuri/plăți (build_fiscalnet_payload, mig 272) —
--      nicio dată de client, deci nu cere anonimizare.
--   C. `process_account_deletions` (lanț …→282→284): copie VERBATIM din 282 +
--      (1) arhivarea bonurilor înainte de `delete`, pe orice politică;
--      (2) politica `block` blochează și pe bonuri `success`, nu doar pe facturi.
--      Lacătul, ordinea, `skip locked`, cele 3 politici, arhivarea facturilor,
--      `limit 100` și izolarea per-user rămân neatinse.
--
-- Stare pe producție la aplicare: 1 rând în pending_receipts, 0 `success`,
-- 0 cereri de ștergere — fix aditiv, fără efect vizibil azi.
-- Teste: RA1–RA6 `tests/sql/gdpr_receipt_archive_assertions.sql`.
-- =============================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ─────────────────────────────────────────────────────────────────────────────
-- A. retained_receipts
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.retained_receipts (
  id                     uuid primary key default gen_random_uuid(),
  -- Referințe originale (fără FK — trebuie să supraviețuiască ștergerii sursei)
  original_receipt_id    uuid not null,   -- pending_receipts.id
  original_restaurant_id uuid not null,   -- restaurants.id
  original_order_id      uuid,            -- orders.id (NULL la Z/X/cash, mig 032)
  -- Identitatea emitentului (dată de business, nu personală)
  company_cif            text,
  company_name           text,
  -- Documentul, exact cum era în jurnal
  command_type           text not null,
  status                 text not null,
  bon_number             text,
  error_code             text,
  error_info             text,
  payload                text not null,
  total_snapshot         numeric(10,2) not null,
  -- Datare
  receipt_created_at     timestamptz,
  claimed_at             timestamptz,     -- momentul tipăririi pe factură (mig 276)
  completed_at           timestamptz,
  -- Audit retenție
  retained_at            timestamptz not null default now(),
  reason                 text
);

comment on table public.retained_receipts is
  'RETENȚIE LEGALĂ 10 ANI (Legea 82/1991). Jurnalul de bonuri fiscale (pending_receipts) '
  'al restaurantelor unui owner șters prin GDPR (Art. 17), arhivat ÎNAINTEA cascadei '
  'auth.users → restaurants → pending_receipts (mig 284). Fără FK, ca să nu fie cascadat; '
  'fără date personale (payload-ul FiscalNet conține doar produse, prețuri și plăți).';

create index if not exists idx_retained_receipts_restaurant
  on public.retained_receipts (original_restaurant_id);

create unique index if not exists uq_retained_receipts_original
  on public.retained_receipts (original_receipt_id);

alter table public.retained_receipts enable row level security;
-- Fără politici: default deny pentru rolurile normale (ca retained_invoices).
-- Revoke-ul e PORTANT: pg_default_acl dă `authenticated` CRUD pe orice tabelă nouă.
revoke all on public.retained_receipts from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- B. archive_fiscal_receipts_for_user
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.archive_fiscal_receipts_for_user(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
begin
  insert into public.retained_receipts (
    original_receipt_id, original_restaurant_id, original_order_id,
    company_cif, company_name,
    command_type, status, bon_number, error_code, error_info,
    payload, total_snapshot,
    receipt_created_at, claimed_at, completed_at, reason
  )
  select
    pr.id, pr.restaurant_id, pr.order_id,
    oc.company_cif, oc.company_name,
    pr.command_type, pr.status, pr.bon_number, pr.error_code, pr.error_info,
    pr.payload, pr.total_snapshot,
    pr.created_at, pr.claimed_at, pr.completed_at,
    'Ștergere cont GDPR — jurnal de bonuri fiscale, retenție Legea 82/1991 (10 ani)'
  from public.pending_receipts pr
  join public.restaurants r on r.id = pr.restaurant_id
  left join public.oblio_configs oc on oc.restaurant_id = pr.restaurant_id
  where r.owner_id = p_user_id
  on conflict (original_receipt_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Apelată DOAR din process_account_deletions (DEFINER, proprietar postgres).
-- Revoke explicit per rol: default privileges re-acordă EXECUTE funcțiilor noi.
revoke all on function public.archive_fiscal_receipts_for_user(uuid)
  from public, anon, authenticated, service_role;

comment on function public.archive_fiscal_receipts_for_user(uuid) is
  'mig 284: copiază jurnalul pending_receipts al restaurantelor owner-ului în retained_receipts '
  'înaintea ștergerii GDPR. Idempotent (uq_retained_receipts_original). Doar intern.';

-- ─────────────────────────────────────────────────────────────────────────────
-- C. process_account_deletions — lanț 042→179→183→282→284.
--    Orice recreare pornește de AICI și păstrează TOT: lacătul, ordinea,
--    claim-ul, cele 3 politici, arhivarea facturilor ȘI a bonurilor, gate-ul
--    `block` pe ambele, `limit 100` și izolarea per-user.
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
  v_has_receipts boolean;  -- mig 284
  v_archived  integer;
  v_archived_receipts integer;  -- mig 284
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
grant execute on function public.process_account_deletions() to service_role;

comment on function public.process_account_deletions() is
  'Sterge conturile marcate GDPR dupa D+30 (Art. 17). mig 282: single-flight (pg_try_advisory_xact_lock), ordine determinista, for update skip locked. mig 284: arhiveaza jurnalul de bonuri (retained_receipts) inaintea cascadei, pe orice politica; politica block blocheaza si pe bonuri success. Ruleaza pe pg_cron (menuvia_janitor_gdpr_deletions) si din automation-cron.js.';

-- ─────────────────────────────────────────────────────────────────────────────
-- D. Asserțiuni la aplicare (centură; acoperirea permanentă e RA1–RA6 + GD*).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_src text;
  v_arch int;
  v_del int;
begin
  select p.prosrc into v_src
    from pg_proc p
   where p.oid = 'public.process_account_deletions()'::regprocedure;

  -- Moștenite din 282 (siguranța căii ireversibile) și din 179/183.
  if position('pg_try_advisory_xact_lock' in v_src) = 0
     or position('order by deletion_requested_at, id' in v_src) = 0
     or position('for update skip locked' in v_src) = 0 then
    raise exception 'mig 284: s-a pierdut una dintre sigurantele din mig 282 (lacat / order by / skip locked)';
  end if;
  if position('archive_fiscal_invoices_for_user' in v_src) = 0
     or position('deletion_blocked_reason is null' in v_src) = 0
     or position('exception when others then' in v_src) = 0
     or position('limit 100' in v_src) = 0 then
    raise exception 'mig 284: s-a pierdut un invariant mostenit din 179/183';
  end if;

  -- Nou: arhivarea bonurilor exista si e INAINTEA stergerii.
  v_arch := position('v_archived_receipts := public.archive_fiscal_receipts_for_user(v_user.id)' in v_src);
  v_del  := position('delete from auth.users where id = v_user.id' in v_src);
  if v_arch = 0 or v_del = 0 then
    raise exception 'mig 284: lipseste arhivarea bonurilor sau ancora de stergere (arch=%, del=%)', v_arch, v_del;
  end if;
  if v_arch > v_del then
    raise exception 'mig 284: arhivarea bonurilor e DUPA stergere — cascada ar fi sters deja jurnalul';
  end if;
  if position('v_policy = ''block'' and (v_has_invoices or v_has_receipts)' in v_src) = 0 then
    raise exception 'mig 284: politica block nu blocheaza pe bonuri success';
  end if;

  -- Suprafata: tabela si functia NU sunt atinse de roluri client.
  if has_table_privilege('anon', 'public.retained_receipts', 'SELECT')
     or has_table_privilege('authenticated', 'public.retained_receipts', 'SELECT')
     or has_table_privilege('authenticated', 'public.retained_receipts', 'INSERT') then
    raise exception 'mig 284: retained_receipts e accesibila unui rol client';
  end if;
  if has_function_privilege('anon', 'public.archive_fiscal_receipts_for_user(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.archive_fiscal_receipts_for_user(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.archive_fiscal_receipts_for_user(uuid)', 'EXECUTE') then
    raise exception 'mig 284: archive_fiscal_receipts_for_user e executabila din afara';
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'retained_receipts' and c.relrowsecurity) then
    raise exception 'mig 284: retained_receipts fara RLS';
  end if;
end$$;

commit;
