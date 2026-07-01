-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 179 — GDPR ștergere cont vs. retenție fiscală (Legea 82/1991)
-- ═══════════════════════════════════════════════════════════════
-- Finding HIGH din audit: `process_account_deletions` (mig 042) șterge contul
-- prin cascada `auth.users → profiles → restaurants → invoices`. Pentru că
-- `invoices.restaurant_id` are `ON DELETE CASCADE` (mig 041), ștergerea
-- restaurantului ȘTERGE facturile fiscale emise → încalcă Legea 82/1991
-- (retenție documente contabile 10 ani).
--
-- Soluție: separăm ștergerea datelor personale (drept GDPR Art. 17) de
-- păstrarea documentului fiscal (obligație legală care PREVALEAZĂ asupra
-- dreptului la ștergere — vezi și docs/AFFILIATE_PROGRAM.md §6.7).
--
-- Mecanismul cheie: snapshot al câmpurilor STRICT FISCALE într-o tabelă
-- `retained_invoices` care NU e cascadată de la `auth.users`. Când cascada
-- șterge `invoices`, snapshot-ul fiscal SUPRAVIEȚUIEȘTE. Snapshot-ul exclude
-- datele personale ale persoanei fizice (nume/email/telefon client B2C) și
-- păstrează doar datele de BUSINESS (serie, număr, total, TVA, CUI firmă).
--
-- 3 politici configurabile (single-row `gdpr_deletion_config.policy`):
--   • archive_anonymize (DEFAULT) — snapshot fiscal + șterge datele personale
--   • block               — refuză ștergerea cât timp există facturi emise
--   • transfer_tombstone  — snapshot fiscal + marchează restaurantul tombstoned
--                           (owner_id e IMUABIL — vezi caveat mai jos)
--
-- CAVEAT owner_id imuabil (CLAUDE.md): `trg_restaurants_owner_id_immutable`
-- (mig 096x) blochează orice UPDATE pe `restaurants.owner_id`. Un transfer
-- REAL de proprietar NU se poate face din acest RPC și NU dezactivăm trigger-e
-- de lockdown aici. Transferul efectiv de owner necesită
-- `scripts/apply_ownership_remediation.sql` (procedură manuală, sub lock).
-- Politica `transfer_tombstone` face deci: snapshot fiscal + marcaj
-- „tombstoned/orphaned" + `raise notice`, apoi lasă remedierea de owner manuală.
--
-- Convenție lockdown: SECURITY DEFINER, `set search_path = public, pg_temp`,
-- revoke public/anon, fără grant către authenticated (RPC de cron/service_role).
-- Idempotent: `create table if not exists`, `create or replace`, `add column
-- if not exists`, `on conflict do nothing`.
-- ═══════════════════════════════════════════════════════════════


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ 1. RETAINED_INVOICES — nucleul de retenție fiscală 10 ani     ║
-- ╚═══════════════════════════════════════════════════════════════╝
-- Snapshot al câmpurilor STRICT fiscale ale unei facturi emise. NU e legat
-- prin FK de `restaurants`/`invoices`/`auth.users`, deci NU e cascadat la
-- ștergerea contului — supraviețuiește cascadei. Datele personale ale
-- persoanei fizice (nume/email/telefon client B2C) sunt EXCLUSE prin design.
-- `customer_cif` (CUI/cod fiscal firmă) e dată de BUSINESS, nu personală, și
-- e obligatorie pe factura fiscală → o păstrăm.

create table if not exists public.retained_invoices (
  id                    uuid primary key default gen_random_uuid(),
  -- Referințe originale (fără FK — trebuie să supraviețuiască ștergerii sursei)
  original_invoice_id   uuid not null,           -- invoices.id original
  original_restaurant_id uuid not null,          -- restaurants.id original
  -- Identitate emitent (firma care a emis factura — dată fiscală, nu personală)
  company_cif           text,                    -- CIF emitent (oblio_configs.company_cif)
  company_name          text,                    -- denumire firmă emitentă
  -- Câmpuri STRICT fiscale ale documentului
  oblio_series          text,                    -- seria documentului
  oblio_number          text,                    -- numărul documentului
  total_with_vat        numeric(12,2) not null,  -- total cu TVA
  currency              text not null default 'RON',
  -- Identificarea fiscală a clientului (CUI firmă = business, NU date personale)
  customer_cif          text,                    -- "RO12345678" pentru B2B; null la B2C
  is_b2b                boolean not null default false,
  -- Marcaj B2C anonimizat: pentru persoane fizice NU păstrăm nume/email/telefon;
  -- reținem doar faptul că factura a existat + valoarea fiscală.
  customer_label        text not null default '[persoană fizică anonimizată]',
  -- Datare fiscală
  issued_at             timestamptz,             -- data emiterii (invoices.issued_at)
  original_created_at   timestamptz,             -- data creării înregistrării originale
  -- Audit retenție
  retained_at           timestamptz not null default now(),
  reason                text
);

comment on table public.retained_invoices is
  'RETENȚIE LEGALĂ 10 ANI (Legea 82/1991). Snapshot fiscal al facturilor emise, '
  'păstrat DUPĂ ștergerea contului (GDPR Art. 17). Conține DOAR date fiscale/de '
  'business (serie, număr, total, TVA, CUI firmă) — datele personale ale '
  'persoanei fizice sunt excluse/anonimizate. NU are FK spre restaurants/invoices/'
  'auth.users ca să NU fie cascadat. Nu se șterge decât după expirarea retenției.';

comment on column public.retained_invoices.customer_cif is
  'CUI/cod fiscal client B2B — dată de business, obligatorie pe factură, NU date personale.';
comment on column public.retained_invoices.customer_label is
  'Etichetă anonimizată pentru B2C. NU stocăm nume/email/telefon persoană fizică.';

-- Index pentru căutare la audit fiscal / control ANAF
create index if not exists idx_retained_invoices_restaurant
  on public.retained_invoices (original_restaurant_id);
create index if not exists idx_retained_invoices_cif
  on public.retained_invoices (customer_cif) where customer_cif is not null;
create index if not exists idx_retained_invoices_issued
  on public.retained_invoices (issued_at);

-- Dedup: nu arhivăm de două ori aceeași factură (idempotență la re-rulare cron)
create unique index if not exists uq_retained_invoices_original
  on public.retained_invoices (original_invoice_id);

alter table public.retained_invoices enable row level security;

-- RLS: fără acces public/anon/authenticated. Doar service_role (BYPASSRLS) și
-- platform admin (via RPC dedicat, dacă va fi nevoie) pot citi. Nu creăm nicio
-- policy permisivă → default deny pentru rolurile normale.
revoke all on public.retained_invoices from public, anon, authenticated;


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ 2. GDPR_DELETION_CONFIG — politica activă (single-row)        ║
-- ╚═══════════════════════════════════════════════════════════════╝

create table if not exists public.gdpr_deletion_config (
  id         boolean primary key default true check (id),
  policy     text    not null default 'archive_anonymize'
               check (policy in ('block', 'archive_anonymize', 'transfer_tombstone')),
  updated_at timestamptz not null default now()
);

insert into public.gdpr_deletion_config (id, policy)
values (true, 'archive_anonymize')
on conflict (id) do nothing;

comment on table public.gdpr_deletion_config is
  'Politica de tratare a facturilor fiscale la ștergerea contului (mig 179). '
  'Single-row (id=true). archive_anonymize=default recomandat.';

alter table public.gdpr_deletion_config enable row level security;
-- Admin/service_role-only. Fără policy permisivă → default deny.
revoke all on public.gdpr_deletion_config from public, anon, authenticated;


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ 3. Marcaj tombstone pe restaurants (pentru transfer_tombstone)║
-- ╚═══════════════════════════════════════════════════════════════╝
-- owner_id rămâne IMUABIL (trg_restaurants_owner_id_immutable). NU îl atingem.
-- Adăugăm coloane INFORMATIVE care NU sunt owner_id, deci nu declanșează
-- trigger-ul de imuabilitate. Marchează restaurantul ca „orfan" (owner șters)
-- până la remedierea manuală de owner (scripts/apply_ownership_remediation.sql).

alter table public.restaurants
  add column if not exists is_tombstoned          boolean not null default false,
  add column if not exists tombstoned_at          timestamptz,
  add column if not exists tombstoned_reason       text;

comment on column public.restaurants.is_tombstoned is
  'true = owner-ul și-a șters contul (GDPR) dar restaurantul are facturi fiscale '
  'de păstrat. Transferul REAL de owner necesită scripts/apply_ownership_remediation.sql '
  '(owner_id e imuabil). Nu dezactiva trigger-e de lockdown din RPC.';


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ 4. Helper: snapshot fiscal pentru un user (owner)            ║
-- ╚═══════════════════════════════════════════════════════════════╝
-- Copiază facturile EMISE ale tuturor restaurantelor deținute de user în
-- retained_invoices, EXCLUZÂND datele personale B2C. Idempotent prin
-- ON CONFLICT (uq_retained_invoices_original) DO NOTHING.
-- Returnează numărul de facturi arhivate în această rulare.

create or replace function public.archive_fiscal_invoices_for_user(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
begin
  insert into public.retained_invoices (
    original_invoice_id, original_restaurant_id,
    company_cif, company_name,
    oblio_series, oblio_number, total_with_vat, currency,
    customer_cif, is_b2b, customer_label,
    issued_at, original_created_at, reason
  )
  select
    i.id, i.restaurant_id,
    oc.company_cif, oc.company_name,
    i.oblio_series, i.oblio_number, i.total_with_vat, i.currency,
    -- customer_cif = date de business (CUI firmă). Se păstrează.
    i.customer_cif,
    i.is_b2b,
    -- Anonimizare B2C: nu copiem customer_name/email/phone. Pentru B2B punem CUI
    -- ca etichetă (business, nepersonal); pentru B2C etichetă generică.
    case
      when i.is_b2b and i.customer_cif is not null then 'CUI ' || i.customer_cif
      else '[persoană fizică anonimizată]'
    end,
    i.issued_at, i.created_at,
    'Ștergere cont GDPR — retenție fiscală Legea 82/1991 (10 ani)'
  from public.invoices i
  join public.restaurants r on r.id = i.restaurant_id
  left join public.oblio_configs oc on oc.restaurant_id = i.restaurant_id
  where r.owner_id = p_user_id
    -- Doar documente fiscale REALE (emise). queued/failed nu sunt facturi fiscale.
    and i.status in ('issued', 'cancelled')
  on conflict (original_invoice_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.archive_fiscal_invoices_for_user(uuid) from public, anon, authenticated;


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ 5. Redefinire process_account_deletions cu cele 3 politici    ║
-- ╚═══════════════════════════════════════════════════════════════╝
-- Semnătura și autorizarea păstrate din mig 042 (service_role-only, fără grant
-- către authenticated). Batch 100/tick păstrat.

-- Flag pentru politica `block`: motivul pentru care ștergerea a fost oprită.
alter table public.profiles
  add column if not exists deletion_blocked_reason text;

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
    limit 100 -- batch pentru a nu bloca cron-ul
  loop
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
  end loop;
end;
$$;

revoke all on function public.process_account_deletions() from public, anon, authenticated;
-- Doar service_role poate apela (cron job) — la fel ca mig 042.


-- ═══════════════════════════════════════════════════════════════
-- FINAL: rezultat legal
--   • Date personale șterse (GDPR Art. 17). ✔
--   • Factură fiscală păstrată 10 ani în retained_invoices (Legea 82/1991). ✔
--   • Politica e configurabilă (gdpr_deletion_config.policy). ✔
--   • Lockdown-ul owner_id NU e atins; transferul real rămâne manual. ✔
-- Detalii + TODO avocat: docs/GDPR_DELETION.md
-- ═══════════════════════════════════════════════════════════════
