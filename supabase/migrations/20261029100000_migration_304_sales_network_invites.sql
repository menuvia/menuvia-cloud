-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION 304 — Rețeaua de vânzări DOAR pe invitații (pachetul 8a: baza de date)
-- ═══════════════════════════════════════════════════════════════════════════
-- Decizia D8: rețeaua merge doar pe invitații; programul public
-- (`affiliate_program_open`) rămâne ÎNCHIS și NEATINS — `register_affiliate`,
-- `admin_review_affiliate` și `affiliate_program_is_open` nu sunt recreate aici.
-- Invitația ține loc de poartă ȘI de aprobare: șeful de vânzări e invitat de
-- fondator, agentul de șeful lui; contul se activează singur la răscumpărare.
--
-- Ce face migrația:
--   (1) `affiliate_invitations` — invitații de unică folosință. Tokenul (32 de
--       octeți aleatori, URL-safe) se întoarce O SINGURĂ DATĂ la creare și NU se
--       stochează NICIODATĂ: în tabelă stă doar sha256-ul lui. RLS pornit, zero
--       politici, toate privilegiile revocate EXPLICIT (default privileges din
--       Supabase le re-acordă): accesul trece exclusiv prin RPC-urile de mai jos.
--       Legăturile spre conturi sunt `on delete set null` (GDPR). Emailul
--       (nota fondatorului: „cui i-am trimis linkul”) se GOLEȘTE la răscumpărare
--       — potrivirea s-a făcut, iar un email care supraviețuiește ștergerii
--       contului ar fi PII fără scop.
--   (2) Contract VERSIONAT + dovadă append-only. Versiunea publicată stă în
--       `platform_settings.sales_contract_version` ca OBIECT
--       `{"version":"1.0","text_hash":"<sha256 hex>"}` (JSON `null` = NEPUBLICAT,
--       implicit; orice altă formă — șir gol, șir simplu fără hash, obiect cu
--       hash prost — e tot nepublicat). Hash-ul publicat LEAGĂ versiunea de textul
--       exact: `redeem_*` respinge cu `contract_hash_mismatch` orice alt hash
--       (înainte, orice 64 hex trecea, inclusiv 000…0). Cât timp e nepublicată, NICIO invitație nu se creează și
--       niciuna nu se răscumpără (`contract_not_published`) — contractul
--       (docs/dosar/03*, art. 3.4) e DRAFT, deci codul e FAIL-CLOSED. Tabela
--       `affiliate_contract_acceptances` e append-only (trigger BEFORE
--       UPDATE/DELETE + BEFORE TRUNCATE): afiliat, rol, versiune, sha256 al
--       textului AFIȘAT (primit de la client), momentul și CUI-ul declarat.
--       Acceptarea se face în ACELAȘI pas cu răscumpărarea (atomic).
--       `admin_set_sales_contract_version(p_version, p_text_hash)` refuză versiunile
--       care conțin „draft”, cuvintele rezervate (null/none/undefined/false/true/
--       nan) și orice nu are forma `^v?[0-9]+(\.[0-9]+)*$` (max 20 caractere).
--   (2b) D8 ÎN DATE. Un părinte cu `sales_role` setat (șef) poate avea ca
--       copii DOAR conturi cu `sales_role = 'agent'` (intrate prin invitație, cu
--       contract acceptat): constraint trigger deferred
--       `trg_affiliate_sales_role_parent`. Fără el, programul public redeschis +
--       `register_affiliate` cu codul șefului + `admin_review_affiliate` ar fi
--       lăsat un „agent” fără contract să încaseze cascada de 20% a șefului.
--       `get_sales_network` listează în `team` doar `sales_role = 'agent'`.
--   (3) CUI obligatoriu, validat cu cifra de control (cheia 753217532):
--       `normalize_ro_cui` / `is_valid_ro_cui`. Verificat pe CUI-uri reale
--       (Banca Transilvania 5022670, eMAG 14399840, Dedeman 2816464, Orange
--       9010105, Carrefour 11588780). Se stochează în acceptare (dovada
--       declarației), NU în `affiliate_payout_profile`: acolo `legal_form` e
--       NOT NULL (nu-l colectăm la răscumpărare), `upsert_payout_profile` cere
--       IBAN valid, iar o salvare ulterioară cu `p_cui = null` ar ȘTERGE
--       declarația. Completarea din ANAF + profilul de plată vin în pachetul 13.
--       UNICITATE: la răscumpărare (după validarea tokenului) CUI-ul normalizat nu
--       poate coincide cu cel din ULTIMA acceptare a niciunui afiliat ne-închis
--       și ne-șters (inclusiv șeful invitator) — `cui_conflict`; verificarea ia un
--       lacăt advisory pe CUI (două răscumpărări simultane cu același CUI).
--   (4) RPC-uri de fondator (toate: `is_platform_admin()`, altfel 42501 cu hint
--       `not_platform_admin`): `admin_set_sales_contract_version`,
--       `admin_create_sales_head_invite`, `admin_revoke_affiliate_invite`,
--       `admin_list_affiliate_invites`, `admin_set_affiliate_status`.
--   (5) RPC-uri de utilizator autentificat: `redeem_sales_head_invite`,
--       `create_agent_invite`, `redeem_agent_invite`, `revoke_agent_invite`
--       (contract 03b art. 4.3: șeful poate retrage o invitație neacceptată),
--       `set_my_contact_sharing`, `get_sales_network`.
--       Cele două răscumpărări sunt ÎNVELIȘURI peste o singură implementare
--       (`sales_invite_redeem`): ordinea verificărilor nu poate diverge.
--   (6) `cascade_bps` implicit 200 → 2000 în `platform_settings`, DOAR dacă e
--       încă 200 (nu suprascrie o valoare schimbată de fondator). Logica stă
--       într-o funcție internă (`sales_network_apply_cascade_default`), ca
--       testul să exerseze EXACT instrucțiunea din migrație. Default-ul
--       COLOANEI `affiliates.cascade_bps` rămâne 200 (RC1 depinde de el).
--
-- IDENTITATEA EMAILULUI. O invitație legată de email se răscumpără doar de un
-- cont cu email CONFIRMAT (`auth.users.email_confirmed_at`) care se potrivește;
-- orice răscumpărare cere un cont non-anonim (email prezent, `is_anonymous` fals;
-- coloanele se citesc prin `to_jsonb(u)` ca să nu depindă de schema mock din CI).
-- Absența coloanei `email_confirmed_at` = NECONFIRMAT (fail-closed).
--
-- GDPR. Revocarea unei invitații (`admin_revoke_affiliate_invite`,
-- `revoke_agent_invite`) golește `email` și `note`; răscumpărarea golește `email`.
-- REZIDUU consemnat (nu acum): invitațiile EXPIRATE neutilizate păstrează
-- email/note până la un janitor.
--
-- ANTI-ORACOL. Un SINGUR motiv extern pentru orice problemă a invitației:
-- `invite_invalid` (inexistentă / expirată / folosită / revocată / alt tip /
-- email nepotrivit / invitatorul nu mai e un șef activ). Verificările care NU
-- depind de token (autentificare, rate limit, contract, hash, telefon, CUI)
-- vin ÎNAINTEA căutării tokenului (inclusiv `contract_hash_mismatch` și
-- `anonymous_account`) — altfel „cui_invalid” vs „invite_invalid”
-- ar spune dacă tokenul e bun. Rate limit 10/15 min per utilizator.
--
-- SUSPENDAREA (D9). `admin_set_affiliate_status` doar schimbă `status`; înghețarea
-- comisioanelor noi o fac filtrele `status = 'active'` DEJA existente
-- (`process_affiliate_invoice_paid` 293: `affiliate_inactive`; cascada cere
-- părinte activ; atribuirea 097c/301 și `has_partner_access` cer `active`) —
-- NIMIC din ele nu se atinge aici. Comisioanele deja scrise rămân în ledger.
-- Fără DELETE. `closed` e terminal.
--
-- Reziduuri consemnate, NEadresate aici: (a) batch-ul de payout iterează doar
-- `status='active'` (294) — „suspendatul își primește soldul câștigat” (D9) e
-- pachetul 13; (b) re-acceptarea la o versiune nouă de contract nu are RPC
-- (gate-ul de creare cere ≥1 acceptare, plata va cere versiunea curentă);
-- (c) `platform_audit_log.actor_user_id` e ON DELETE RESTRICT: de aceea RPC-urile
-- de agent/șef NU scriu în audit (înregistrarea lor e chiar rândul invitației și
-- al acceptării) — doar cele de fondator loghează.
--
-- Funcțiile noi: `security definer`, `search_path = public, pg_temp`, revoke
-- EXPLICIT per rol apoi grant minim; helperii interni fără EXECUTE pentru niciun
-- rol client (default privileges din Supabase re-acordă EXECUTE funcțiilor noi).
-- ═══════════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ───────────────────────────────────────────────────────────────────────────
-- §1. Coloane noi pe `affiliates` (rolul în rețea + consimțământul de contact)
-- ───────────────────────────────────────────────────────────────────────────
-- `sales_role` NULL = afiliat vechi / din programul public (nu face parte din
-- rețeaua pe invitații). Politica RLS „own row” (249) rămâne neatinsă.
alter table public.affiliates
  add column if not exists sales_role          text
    check (sales_role in ('head', 'agent')),
  add column if not exists contact_sharing     boolean not null default false,
  add column if not exists contact_sharing_at  timestamptz;

-- Un șef NU are părinte (un singur nivel: șef → agenți). Backstop în DATE; un
-- `on delete set null` pe părinte nu poate încălca regula (NULL e permis).
alter table public.affiliates drop constraint if exists affiliates_head_has_no_parent;
alter table public.affiliates add constraint affiliates_head_has_no_parent
  check (sales_role is distinct from 'head' or parent_affiliate_id is null);

-- D8 în DATE: sub un părinte din rețea (sales_role setat) intră DOAR agenți
-- (sales_role = 'agent', adică invitație + contract acceptat). Constraint trigger
-- deferred, ca `trg_affiliate_depth1`: verifică starea finală la COMMIT, deci
-- rânduri create/aprobate pe alte căi (register_affiliate cu programul public
-- redeschis, admin_review_affiliate, UPDATE direct) cad cu o eroare clară.
create or replace function public.fn_affiliate_sales_role_parent()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if NEW.parent_affiliate_id is not null
     and NEW.sales_role is distinct from 'agent'
     and exists (select 1 from public.affiliates p
                  where p.id = NEW.parent_affiliate_id and p.sales_role is not null) then
    raise exception using errcode = 'check_violation',
      message = 'sub un șef de vânzări pot fi doar agenți intrați prin invitație',
      hint    = 'invariant:agent_requires_invitation';
  end if;
  -- Invers: un cont care devine membru al rețelei nu poate avea copii ne-agenți.
  if NEW.sales_role is not null and exists (
       select 1 from public.affiliates c
        where c.parent_affiliate_id = NEW.id and c.sales_role is distinct from 'agent') then
    raise exception using errcode = 'check_violation',
      message = 'un cont din rețea nu poate avea sub el conturi fără invitație',
      hint    = 'invariant:agent_requires_invitation';
  end if;
  return null;
end$$;

revoke all on function public.fn_affiliate_sales_role_parent()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_affiliate_sales_role_parent on public.affiliates;
create constraint trigger trg_affiliate_sales_role_parent
  after insert or update on public.affiliates
  deferrable initially deferred
  for each row execute function public.fn_affiliate_sales_role_parent();

comment on column public.affiliates.sales_role is
  'mig 304: head | agent pentru conturile create prin invitație; NULL = afiliat din programul public/vechi.';
comment on column public.affiliates.contact_sharing is
  'mig 304: consimțământ REVOCABIL (contract art. 9.5) ca numele/telefonul/emailul să fie afișate șefului / agenților. Implicit false.';

-- ───────────────────────────────────────────────────────────────────────────
-- §2. affiliate_invitations
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.affiliate_invitations (
  id                      uuid primary key default gen_random_uuid(),
  kind                    text not null check (kind in ('head', 'agent')),
  -- sha256 hex al tokenului. Tokenul în clar NU se stochează nicăieri.
  token_hash              text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- NULL pentru șef (invitat de fondator). Pentru agent îl impune RPC-ul.
  invited_by_affiliate_id uuid references public.affiliates(id) on delete set null,
  created_by_profile_id   uuid references public.profiles(id)   on delete set null,
  -- Nota fondatorului „cui i-am dat linkul”; golită la răscumpărare.
  email                   text check (email is null or length(email) <= 254),
  note                    text check (note is null or length(note) <= 500),
  created_at              timestamptz not null default clock_timestamp(),
  expires_at              timestamptz not null,
  used_at                 timestamptz,
  used_by_profile_id      uuid references public.profiles(id)   on delete set null,
  used_by_affiliate_id    uuid references public.affiliates(id) on delete set null,
  revoked_at              timestamptz,
  check (expires_at > created_at),
  check (not (used_at is not null and revoked_at is not null)),
  check (used_at is not null or (used_by_profile_id is null and used_by_affiliate_id is null))
);

create index if not exists affiliate_invitations_inviter_idx
  on public.affiliate_invitations (invited_by_affiliate_id);
create index if not exists affiliate_invitations_created_by_idx
  on public.affiliate_invitations (created_by_profile_id);
create index if not exists affiliate_invitations_used_by_profile_idx
  on public.affiliate_invitations (used_by_profile_id);
create index if not exists affiliate_invitations_used_by_affiliate_idx
  on public.affiliate_invitations (used_by_affiliate_id);

alter table public.affiliate_invitations enable row level security;
revoke all on table public.affiliate_invitations
  from public, anon, authenticated, service_role;

comment on table public.affiliate_invitations is
  'mig 304: invitații șef/agent de vânzări. token_hash = sha256(token); tokenul nu se stochează. RLS fără politici + revoke explicit: acces DOAR prin RPC-urile DEFINER (admin_*_invite, create_agent_invite, redeem_*).';

-- ───────────────────────────────────────────────────────────────────────────
-- §3. affiliate_contract_acceptances — dovadă APPEND-ONLY
-- ───────────────────────────────────────────────────────────────────────────
-- Fără FK spre `profiles`: un `on delete set null` ar fi un UPDATE pe un tabel
-- append-only și ar bloca ștergerea GDPR a contului. Legătura e `affiliate_id`
-- (rândul afiliatului nu se șterge niciodată — doar tombstone, mig 295).
create table if not exists public.affiliate_contract_acceptances (
  id               uuid primary key default gen_random_uuid(),
  affiliate_id     uuid not null references public.affiliates(id) on delete restrict,
  kind             text not null check (kind in ('head', 'agent')),
  contract_version text not null check (length(btrim(contract_version)) between 1 and 40),
  -- sha256 hex al documentului COMPLET așa cum a fost afișat (art. 3.4).
  text_hash        text not null check (text_hash ~ '^[0-9a-f]{64}$'),
  -- CUI-ul declarat, normalizat (doar cifre, fără prefixul RO).
  declared_cui     text not null check (declared_cui ~ '^[1-9][0-9]{1,9}$'),
  accepted_at      timestamptz not null default clock_timestamp(),
  invitation_id    uuid references public.affiliate_invitations(id) on delete restrict
);

create index if not exists affiliate_contract_acceptances_affiliate_idx
  on public.affiliate_contract_acceptances (affiliate_id, accepted_at desc);
create index if not exists affiliate_contract_acceptances_invitation_idx
  on public.affiliate_contract_acceptances (invitation_id);

alter table public.affiliate_contract_acceptances enable row level security;
revoke all on table public.affiliate_contract_acceptances
  from public, anon, authenticated, service_role;

comment on table public.affiliate_contract_acceptances is
  'mig 304: istoric APPEND-ONLY al acceptărilor de contract (versiune, sha256 al textului afișat, CUI declarat, moment). UPDATE/DELETE/TRUNCATE respinse de trigger.';

create or replace function public.fn_contract_acceptance_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception using errcode = 'restrict_violation',
    message = 'affiliate_contract_acceptances is append-only: UPDATE/DELETE/TRUNCATE forbidden',
    hint    = 'Dovada acceptării nu se modifică; o nouă acceptare e un rând nou.';
end$$;

revoke all on function public.fn_contract_acceptance_immutable()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_contract_acceptance_immutable on public.affiliate_contract_acceptances;
create trigger trg_contract_acceptance_immutable
  before update or delete on public.affiliate_contract_acceptances
  for each row execute function public.fn_contract_acceptance_immutable();

drop trigger if exists trg_contract_acceptance_no_truncate on public.affiliate_contract_acceptances;
create trigger trg_contract_acceptance_no_truncate
  before truncate on public.affiliate_contract_acceptances
  for each statement execute function public.fn_contract_acceptance_immutable();

-- ───────────────────────────────────────────────────────────────────────────
-- §4. Helperi interni (fără EXECUTE pentru niciun rol client)
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.sales_invite_ttl_days()
returns integer
language sql immutable
set search_path = public, pg_temp
as $$ select 14 $$;

create or replace function public.sales_open_invites_max()
returns integer
language sql immutable
set search_path = public, pg_temp
as $$ select 20 $$;

-- Versiunea publicată a contractului; NULL = nepublicat (fail-closed: orice
-- altceva decât un șir JSON ne-gol — absent, `null`, număr, obiect — e NULL).
create or replace function public.sales_contract_published_version()
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select nullif(btrim(ps.value ->> 'version'), '')
    from public.platform_settings ps
   where ps.key = 'sales_contract_version'
     and jsonb_typeof(ps.value) = 'object'
     and jsonb_typeof(ps.value -> 'version') = 'string'
     and jsonb_typeof(ps.value -> 'text_hash') = 'string'
     and (ps.value ->> 'text_hash') ~ '^[0-9a-f]{64}$'
$$;

-- Hash-ul publicat al textului (aceeași condiție ca versiunea: NULL = nepublicat).
create or replace function public.sales_contract_published_hash()
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select ps.value ->> 'text_hash'
    from public.platform_settings ps
   where ps.key = 'sales_contract_version'
     and jsonb_typeof(ps.value) = 'object'
     and jsonb_typeof(ps.value -> 'version') = 'string'
     and nullif(btrim(ps.value ->> 'version'), '') is not null
     and jsonb_typeof(ps.value -> 'text_hash') = 'string'
     and (ps.value ->> 'text_hash') ~ '^[0-9a-f]{64}$'
$$;

-- CUI: prefix RO opțional (orice majuscule/spații), 2–10 cifre, cifra de
-- control cu cheia 753217532. Întoarce cifrele normalizate sau NULL.
create or replace function public.normalize_ro_cui(p_cui text)
returns text
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  v_c     text;
  v_body  text;
  v_key   constant int[] := array[7, 5, 3, 2, 1, 7, 5, 3, 2];
  v_sum   int := 0;
  v_ctrl  int;
  i       int;
begin
  if p_cui is null then
    return null;
  end if;
  v_c := upper(regexp_replace(p_cui, '[[:space:]]', '', 'g'));
  if left(v_c, 2) = 'RO' then
    v_c := substr(v_c, 3);
  end if;
  -- 2–10 cifre, FĂRĂ zero în față: un CUI e un număr pozitiv (și '0000000' ar
  -- trece altfel de cifra de control: suma 0 → control 0).
  if v_c !~ '^[1-9][0-9]{1,9}$' then
    return null;
  end if;
  v_ctrl := substr(v_c, length(v_c), 1)::int;
  v_body := lpad(substr(v_c, 1, length(v_c) - 1), 9, '0');
  for i in 1..9 loop
    v_sum := v_sum + substr(v_body, i, 1)::int * v_key[i];
  end loop;
  if (v_sum * 10) % 11 % 10 <> v_ctrl then
    return null;
  end if;
  return v_c;
end;
$$;

create or replace function public.is_valid_ro_cui(p_cui text)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$ select public.normalize_ro_cui(p_cui) is not null $$;

-- Backstop în DATE: nicio acceptare cu un CUI cu cifră de control greșită.
alter table public.affiliate_contract_acceptances
  drop constraint if exists affiliate_contract_acceptances_cui_valid;
alter table public.affiliate_contract_acceptances
  add constraint affiliate_contract_acceptances_cui_valid
  check (public.is_valid_ro_cui(declared_cui));

create or replace function public.new_sales_invite_token()
returns text
language sql volatile
set search_path = public, pg_temp
as $$
  -- 32 de octeți → 43 de caractere [A-Za-z0-9_-] (fără padding, fără newline).
  select rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=')
$$;

create or replace function public.sales_invite_token_hash(p_token text)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select encode(extensions.digest(convert_to(coalesce(p_token, ''), 'utf8'), 'sha256'), 'hex')
$$;

-- Bonusul șefului: 200 → 2000 bps DOAR dacă valoarea implicită e încă 200.
create or replace function public.sales_network_apply_cascade_default()
returns boolean
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  update public.platform_settings
     set value = jsonb_set(value, '{cascade_bps}', '2000'::jsonb),
         updated_at = now()
   where key = 'affiliate_commission_defaults'
     and jsonb_typeof(value -> 'cascade_bps') = 'number'
     and (value ->> 'cascade_bps')::numeric = 200;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

revoke all on function public.sales_invite_ttl_days()                       from public, anon, authenticated, service_role;
revoke all on function public.sales_open_invites_max()                      from public, anon, authenticated, service_role;
revoke all on function public.sales_contract_published_version()            from public, anon, authenticated, service_role;
revoke all on function public.sales_contract_published_hash()               from public, anon, authenticated, service_role;
revoke all on function public.normalize_ro_cui(text)                        from public, anon, authenticated, service_role;
revoke all on function public.is_valid_ro_cui(text)                         from public, anon, authenticated, service_role;
revoke all on function public.new_sales_invite_token()                      from public, anon, authenticated, service_role;
revoke all on function public.sales_invite_token_hash(text)                 from public, anon, authenticated, service_role;
revoke all on function public.sales_network_apply_cascade_default()         from public, anon, authenticated, service_role;

comment on function public.normalize_ro_cui(text) is
  'mig 304: CUI românesc normalizat (cifre, fără RO) sau NULL. 2–10 cifre + cifra de control cu cheia 753217532 (verificat pe CUI-uri reale). Pură, IMMUTABLE.';
comment on function public.sales_contract_published_version() is
  'mig 304: versiunea publicată a contractului de rețea (platform_settings.sales_contract_version); NULL = nepublicat = invitațiile sunt blocate (fail-closed).';

-- Seed: contractul NU e publicat (JSON null). Nu suprascrie o valoare existentă.
insert into public.platform_settings (key, value)
values ('sales_contract_version', 'null'::jsonb)
on conflict (key) do nothing;

select public.sales_network_apply_cascade_default();

-- ───────────────────────────────────────────────────────────────────────────
-- §5. RPC-uri de FONDATOR
-- ───────────────────────────────────────────────────────────────────────────

-- 5a. Publică / retrage versiunea contractului (versiune + hash-ul textului).
create or replace function public.admin_set_sales_contract_version(
  p_version   text,
  p_text_hash text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_new  text := nullif(btrim(coalesce(p_version, '')), '');
  v_hash text;
  v_old  text;
  v_oldh text;
begin
  if not public.is_platform_admin() then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Acces interzis', hint = 'not_platform_admin';
  end if;

  -- NULL / gol = retragere (invitațiile se blochează din nou); hash-ul se ignoră.
  if v_new is not null then
    -- Un contract DRAFT nu are voie să deblocheze invitațiile (înaintea formei:
    -- forma numerică nu poate conține „draft", deci verificarea ar fi moartă).
    if v_new ~* 'draft' then
      return jsonb_build_object('ok', false, 'reason', 'draft_version');
    end if;
    -- (Lista de cuvinte rezervate e redundantă cu forma numerică de mai jos —
    -- păstrată explicit, defense în adâncime; scoaterea ei nu e observabilă.)
    if length(v_new) > 20
       or lower(v_new) in ('null', 'none', 'undefined', 'false', 'true', 'nan')
       or v_new !~ '^v?[0-9]+(\.[0-9]+)*$' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_version');
    end if;
    v_hash := lower(btrim(coalesce(p_text_hash, '')));
    if v_hash !~ '^[0-9a-f]{64}$' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_text_hash');
    end if;
  end if;

  v_old  := public.sales_contract_published_version();
  v_oldh := public.sales_contract_published_hash();

  insert into public.platform_settings (key, value, updated_at)
  values ('sales_contract_version',
          case when v_new is null then 'null'::jsonb
               else jsonb_build_object('version', v_new, 'text_hash', v_hash) end, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

  perform public.log_platform_action('founder', null, 'sales_contract_version_set',
    jsonb_build_object('old', v_old, 'old_text_hash', v_oldh,
                       'new', v_new, 'new_text_hash', v_hash));

  return jsonb_build_object('ok', true, 'version', v_new, 'text_hash', v_hash, 'previous', v_old);
end;
$$;

-- 5b. Invitația de ȘEF (tokenul se întoarce O SINGURĂ DATĂ).
create or replace function public.admin_create_sales_head_invite(
  p_email text default null,
  p_note  text default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_note  text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
  v_token text;
  v_id    uuid;
  v_exp   timestamptz;
begin
  if not public.is_platform_admin() then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Acces interzis', hint = 'not_platform_admin';
  end if;

  if public.sales_contract_published_version() is null then
    return jsonb_build_object('ok', false, 'reason', 'contract_not_published');
  end if;
  if v_email is not null
     and (length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_email');
  end if;

  v_token := public.new_sales_invite_token();
  v_exp   := clock_timestamp() + make_interval(days => public.sales_invite_ttl_days());

  insert into public.affiliate_invitations
    (kind, token_hash, invited_by_affiliate_id, created_by_profile_id, email, note, expires_at)
  values
    ('head', public.sales_invite_token_hash(v_token), null, auth.uid(), v_email, v_note, v_exp)
  returning id into v_id;

  -- Auditul NU conține tokenul și nici emailul (doar faptul că a existat unul).
  perform public.log_platform_action('founder', null, 'sales_head_invite_created',
    jsonb_build_object('invite_id', v_id, 'has_email', v_email is not null));

  return jsonb_build_object('ok', true, 'invite_id', v_id, 'kind', 'head',
                            'token', v_token, 'expires_at', v_exp);
end;
$$;

-- 5c. Revocă o invitație neutilizată (șef sau agent).
create or replace function public.admin_revoke_affiliate_invite(p_invite_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_inv public.affiliate_invitations%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Acces interzis', hint = 'not_platform_admin';
  end if;

  select * into v_inv from public.affiliate_invitations where id = p_invite_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invite_not_found');
  end if;
  if v_inv.used_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_used');
  end if;
  if v_inv.revoked_at is not null then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  -- GDPR: o invitație retrasă nu mai are nevoie de email/notă.
  update public.affiliate_invitations
     set revoked_at = clock_timestamp(), email = null, note = null
   where id = v_inv.id;
  perform public.log_platform_action('founder', null, 'sales_invite_revoked',
    jsonb_build_object('invite_id', v_inv.id, 'kind', v_inv.kind));
  return jsonb_build_object('ok', true);
end;
$$;

-- 5d. Lista invitațiilor — FĂRĂ token și FĂRĂ hash.
create or replace function public.admin_list_affiliate_invites()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Acces interzis', hint = 'not_platform_admin';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',                      i.id,
             'kind',                    i.kind,
             'state', case when i.used_at is not null then 'used'
                           when i.revoked_at is not null then 'revoked'
                           when i.expires_at <= clock_timestamp() then 'expired'
                           else 'open' end,
             'email',                   i.email,
             'note',                    i.note,
             'created_at',              i.created_at,
             'expires_at',              i.expires_at,
             'used_at',                 i.used_at,
             'revoked_at',              i.revoked_at,
             'invited_by_affiliate_id', i.invited_by_affiliate_id,
             'invited_by_name',         ip.full_name,
             'used_by_affiliate_id',    i.used_by_affiliate_id,
             'used_by_name',            up.full_name
           ) order by i.created_at desc, i.id)
      from public.affiliate_invitations i
      left join public.affiliates ia on ia.id = i.invited_by_affiliate_id
      left join public.profiles   ip on ip.id = ia.profile_id
      left join public.profiles   up on up.id = i.used_by_profile_id
  ), '[]'::jsonb);
end;
$$;

-- 5e. Activ / suspendat / închis. Doar fondatorul; motiv obligatoriu; fără DELETE.
create or replace function public.admin_set_affiliate_status(
  p_affiliate_id uuid,
  p_status       text,
  p_reason       text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_aff    public.affiliates%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.is_platform_admin() then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Acces interzis', hint = 'not_platform_admin';
  end if;

  if p_status is null or p_status not in ('active', 'suspended', 'closed') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status');
  end if;
  if length(v_reason) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;
  if length(v_reason) > 500 then
    return jsonb_build_object('ok', false, 'reason', 'reason_too_long');
  end if;

  select * into v_aff from public.affiliates where id = p_affiliate_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_aff.erased_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'erased');
  end if;
  -- Cererile din programul public (pending/rejected) se decid prin
  -- admin_review_affiliate, nu prin suspendare.
  if v_aff.status not in ('active', 'suspended', 'closed') then
    return jsonb_build_object('ok', false, 'reason', 'not_in_network', 'status', v_aff.status);
  end if;
  if v_aff.status::text = p_status then
    return jsonb_build_object('ok', false, 'reason', 'no_change', 'status', v_aff.status);
  end if;
  -- `closed` e terminal (ștergerea GDPR îl folosește ca tombstone).
  if v_aff.status = 'closed' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_transition', 'status', v_aff.status);
  end if;

  update public.affiliates set status = p_status::public.affiliate_status where id = v_aff.id;

  perform public.log_platform_action('founder', null, 'affiliate_status_changed',
    jsonb_build_object('affiliate_id', v_aff.id, 'old_status', v_aff.status,
                       'new_status', p_status, 'reason', v_reason));

  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- §6. Răscumpărarea — O SINGURĂ implementare, două învelișuri
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.sales_invite_redeem(
  p_kind             text,
  p_token            text,
  p_phone            text,
  p_cui              text,
  p_contract_version text,
  p_contract_hash    text,
  p_share_contact    boolean
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_version  text;
  v_hash     text;
  v_phone    text;
  v_cui      text;
  v_inv      public.affiliate_invitations%rowtype;
  v_head     public.affiliates%rowtype;
  v_existing public.affiliates%rowtype;
  v_email    text;
  v_confirmed boolean;
  v_anon     boolean;
  v_pub_hash text;
  v_defaults jsonb;
  v_code     text;
  v_try      int := 0;
  v_aff_id   uuid;
  v_share    boolean := coalesce(p_share_contact, false);
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  -- Plafon PER UTILIZATOR, ÎNAINTEA oricărei căutări: ghicitul de tokenuri e
  -- mărginit indiferent de răspuns.
  if not public.check_rate_limit('redeem_sales_invite', v_uid::text, 10, 15) then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  -- Verificările care NU depind de token (anti-oracol: vezi antetul).
  v_version := public.sales_contract_published_version();
  if v_version is null then
    return jsonb_build_object('ok', false, 'reason', 'contract_not_published');
  end if;
  if btrim(coalesce(p_contract_version, '')) <> v_version then
    return jsonb_build_object('ok', false, 'reason', 'contract_version_mismatch');
  end if;
  v_hash := lower(btrim(coalesce(p_contract_hash, '')));
  if v_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'reason', 'contract_hash_invalid');
  end if;
  -- Hash-ul trebuie să fie al textului PUBLICAT pentru această versiune (înainte
  -- de token: un motiv independent de token nu e oracol).
  v_pub_hash := public.sales_contract_published_hash();
  if v_pub_hash is null or v_hash <> v_pub_hash then
    return jsonb_build_object('ok', false, 'reason', 'contract_hash_mismatch');
  end if;
  v_phone := btrim(coalesce(p_phone, ''));
  if length(v_phone) < 5 or length(v_phone) > 32 then
    return jsonb_build_object('ok', false, 'reason', 'phone_required');
  end if;
  v_cui := public.normalize_ro_cui(p_cui);
  if v_cui is null then
    return jsonb_build_object('ok', false, 'reason', 'cui_invalid');
  end if;

  -- Cont non-anonim: email prezent și `is_anonymous` fals. Citit prin to_jsonb(u)
  -- (coloanele lipsesc din schema mock din CI; absent = neconfirmat/ne-anonim).
  select lower(u.email),
         (to_jsonb(u) ->> 'email_confirmed_at') is not null,
         coalesce((to_jsonb(u) ->> 'is_anonymous')::boolean, false)
    into v_email, v_confirmed, v_anon
    from auth.users u where u.id = v_uid;
  if not found or v_email is null or v_anon then
    return jsonb_build_object('ok', false, 'reason', 'anonymous_account');
  end if;

  -- Invitația: `for update` serializează două răscumpărări ale aceluiași token
  -- (a doua așteaptă commit-ul primeia și o vede folosită).
  if length(btrim(coalesce(p_token, ''))) between 1 and 200 then
    select * into v_inv
      from public.affiliate_invitations
     where token_hash = public.sales_invite_token_hash(btrim(p_token))
       and kind = p_kind
     for update;
  end if;

  -- Utilizator deja afiliat: dublu-submit al ACELUIAȘI token → idempotent;
  -- orice altceva → already_affiliate (indiferent de token, deci fără oracol).
  select * into v_existing from public.affiliates where profile_id = v_uid;
  if found then
    if v_inv.id is not null and v_inv.used_by_profile_id = v_uid then
      return jsonb_build_object('ok', true, 'already', true,
        'affiliate_id', v_existing.id, 'role', v_existing.sales_role,
        'status', v_existing.status, 'referral_code', v_existing.referral_code,
        'parent_affiliate_id', v_existing.parent_affiliate_id);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'already_affiliate');
  end if;

  -- UN SINGUR motiv extern pentru orice problemă a invitației.
  if v_inv.id is null
     or v_inv.used_at is not null
     or v_inv.revoked_at is not null
     or v_inv.expires_at <= clock_timestamp() then
    return jsonb_build_object('ok', false, 'reason', 'invite_invalid');
  end if;
  -- Invitația legată de email: doar un cont cu emailul CONFIRMAT și potrivit.
  -- (Nepotrivit / neconfirmat → același invite_invalid: anti-oracol.)
  if v_inv.email is not null and (not v_confirmed or v_email is distinct from v_inv.email) then
    return jsonb_build_object('ok', false, 'reason', 'invite_invalid');
  end if;

  if p_kind = 'agent' then
    -- Invitatorul trebuie să fie ÎNCĂ un șef activ, fără părinte (depth-1).
    -- `for share`: o suspendare concurentă (for update) e așteptată, nu ratată.
    if v_inv.invited_by_affiliate_id is null then
      return jsonb_build_object('ok', false, 'reason', 'invite_invalid');
    end if;
    select * into v_head from public.affiliates
     where id = v_inv.invited_by_affiliate_id for share;
    if not found
       or v_head.sales_role is distinct from 'head'
       or v_head.status <> 'active'
       or v_head.parent_affiliate_id is not null then
      return jsonb_build_object('ok', false, 'reason', 'invite_invalid');
    end if;
  end if;

  -- UNICITATE CUI (după validarea tokenului: doar cine are o invitație validă
  -- vede acest motiv). Lacăt pe CUI: două răscumpărări simultane cu același CUI
  -- se serializează, a doua vede acceptarea primeia după commit.
  perform pg_advisory_xact_lock(hashtextextended('menuvia.sales_cui:' || v_cui, 0));
  if exists (
       select 1
         from public.affiliates a
         join lateral (select ca.declared_cui
                         from public.affiliate_contract_acceptances ca
                        where ca.affiliate_id = a.id
                        order by ca.accepted_at desc, ca.id desc
                        limit 1) l on true
        where l.declared_cui = v_cui
          and a.status <> 'closed'
          and a.erased_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'cui_conflict');
  end if;

  -- Procentele de start = defaulturile fondatorului (mig 188; cascade 2000 din 304).
  select value into v_defaults from public.platform_settings
   where key = 'affiliate_commission_defaults';

  loop
    v_try := v_try + 1;
    v_code := public.new_agent_referral_code();
    exit when not exists (select 1 from public.affiliates where referral_code = v_code);
    if v_try > 10 then
      raise exception 'sales_invite_redeem: could not generate unique referral_code';
    end if;
  end loop;

  begin
    insert into public.affiliates
      (profile_id, referral_code, parent_affiliate_id, status, phone, sales_role,
       contact_sharing, contact_sharing_at,
       setup_bps, recurring_bps, cascade_bps, recurring_cap_months)
    values
      (v_uid, v_code, case when p_kind = 'agent' then v_head.id end, 'active', v_phone, p_kind,
       v_share, case when v_share then clock_timestamp() end,
       coalesce((v_defaults ->> 'setup_bps')::int, 3000),
       coalesce((v_defaults ->> 'recurring_bps')::int, 1000),
       coalesce((v_defaults ->> 'cascade_bps')::int, 2000),
       coalesce((v_defaults ->> 'recurring_cap_months')::int, 12))
    returning id into v_aff_id;
  exception when unique_violation then
    -- Cursă dublu-submit (altă tranzacție a comis între verificare și insert),
    -- ca `create_restaurant` (221). Invitația NU s-a consumat (corpul a ieșit).
    select * into v_existing from public.affiliates where profile_id = v_uid;
    if found then
      if v_existing.sales_role is not distinct from p_kind then
        return jsonb_build_object('ok', true, 'already', true,
          'affiliate_id', v_existing.id, 'role', v_existing.sales_role,
          'status', v_existing.status, 'referral_code', v_existing.referral_code,
          'parent_affiliate_id', v_existing.parent_affiliate_id);
      end if;
      return jsonb_build_object('ok', false, 'reason', 'already_affiliate');
    end if;
    raise;  -- altă violare (ex. coliziune de cod): clientul poate reîncerca
  end;

  insert into public.affiliate_contract_acceptances
    (affiliate_id, kind, contract_version, text_hash, declared_cui, invitation_id)
  values
    (v_aff_id, p_kind, v_version, v_hash, v_cui, v_inv.id);

  update public.affiliate_invitations
     set used_at = clock_timestamp(),
         used_by_profile_id = v_uid,
         used_by_affiliate_id = v_aff_id,
         email = null                      -- potrivirea s-a făcut; nu păstrăm PII
   where id = v_inv.id;

  return jsonb_build_object('ok', true, 'affiliate_id', v_aff_id, 'role', p_kind,
    'status', 'active', 'referral_code', v_code,
    'parent_affiliate_id', case when p_kind = 'agent' then v_head.id end);
end;
$$;

revoke all on function public.sales_invite_redeem(text, text, text, text, text, text, boolean)
  from public, anon, authenticated, service_role;

create or replace function public.redeem_sales_head_invite(
  p_token            text,
  p_phone            text,
  p_cui              text,
  p_contract_version text,
  p_contract_hash    text,
  p_share_contact    boolean default false
) returns jsonb
language sql security definer
set search_path = public, pg_temp
as $$
  select public.sales_invite_redeem('head', p_token, p_phone, p_cui,
                                    p_contract_version, p_contract_hash, p_share_contact)
$$;

create or replace function public.redeem_agent_invite(
  p_token            text,
  p_phone            text,
  p_cui              text,
  p_contract_version text,
  p_contract_hash    text,
  p_share_contact    boolean default false
) returns jsonb
language sql security definer
set search_path = public, pg_temp
as $$
  select public.sales_invite_redeem('agent', p_token, p_phone, p_cui,
                                    p_contract_version, p_contract_hash, p_share_contact)
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- §7. Invitațiile de AGENT (șeful activ cu contract acceptat)
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.create_agent_invite(p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_head  public.affiliates%rowtype;
  v_note  text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
  v_token text;
  v_id    uuid;
  v_exp   timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if public.sales_contract_published_version() is null then
    return jsonb_build_object('ok', false, 'reason', 'contract_not_published');
  end if;

  -- `for update`: două creări simultane ale aceluiași șef se serializează, deci
  -- plafonul de invitații deschise de mai jos e exact.
  select * into v_head from public.affiliates where profile_id = v_uid for update;
  if not found or v_head.sales_role is distinct from 'head' then
    return jsonb_build_object('ok', false, 'reason', 'not_a_head');
  end if;
  if v_head.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'head_not_active');
  end if;
  if not exists (select 1 from public.affiliate_contract_acceptances ca
                  where ca.affiliate_id = v_head.id and ca.kind = 'head') then
    return jsonb_build_object('ok', false, 'reason', 'contract_not_accepted');
  end if;

  if not public.check_rate_limit('create_agent_invite', v_head.id::text, 30, 60) then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;
  if (select count(*) from public.affiliate_invitations i
       where i.invited_by_affiliate_id = v_head.id and i.kind = 'agent'
         and i.used_at is null and i.revoked_at is null
         and i.expires_at > clock_timestamp()) >= public.sales_open_invites_max() then
    return jsonb_build_object('ok', false, 'reason', 'too_many_open_invites');
  end if;

  v_token := public.new_sales_invite_token();
  v_exp   := clock_timestamp() + make_interval(days => public.sales_invite_ttl_days());

  insert into public.affiliate_invitations
    (kind, token_hash, invited_by_affiliate_id, created_by_profile_id, note, expires_at)
  values
    ('agent', public.sales_invite_token_hash(v_token), v_head.id, v_uid, v_note, v_exp)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'invite_id', v_id, 'kind', 'agent',
                            'token', v_token, 'expires_at', v_exp);
end;
$$;

-- Șeful retrage o invitație NEacceptată (contract 03b art. 4.3).
create or replace function public.revoke_agent_invite(p_invite_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_head public.affiliates%rowtype;
  v_inv  public.affiliate_invitations%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  select * into v_head from public.affiliates where profile_id = v_uid;
  if not found or v_head.sales_role is distinct from 'head' then
    return jsonb_build_object('ok', false, 'reason', 'not_a_head');
  end if;

  select * into v_inv from public.affiliate_invitations
   where id = p_invite_id and kind = 'agent' and invited_by_affiliate_id = v_head.id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invite_not_found');
  end if;
  if v_inv.used_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_used');
  end if;
  if v_inv.revoked_at is not null then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  update public.affiliate_invitations
     set revoked_at = clock_timestamp(), email = null, note = null
   where id = v_inv.id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- §8. Consimțământul de contact + „Echipa mea”
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.set_my_contact_sharing(p_share boolean)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if p_share is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_value');
  end if;

  update public.affiliates
     set contact_sharing    = p_share,
         contact_sharing_at = case when p_share then coalesce(contact_sharing_at, clock_timestamp()) else null end
   where profile_id = v_uid and erased_at is null
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_an_affiliate');
  end if;
  return jsonb_build_object('ok', true, 'contact_sharing', p_share);
end;
$$;

-- LISTA ALBĂ: rol, contract, cardul șefului (agent) / recruții DIRECȚI (șef).
-- Datele de contact (nume/telefon/email) ies DOAR cu consimțământul persoanei.
-- NICIODATĂ: clienți finali, IBAN/CUI de plată, cont Stripe, token/hash.
create or replace function public.get_sales_network()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_current  text := public.sales_contract_published_version();
  v_me       public.affiliates%rowtype;
  v_acc_ver  text;
  v_acc_at   timestamptz;
  v_head_row public.affiliates%rowtype;
  v_head_p   public.profiles%rowtype;
  v_head     jsonb := null;
  v_team     jsonb := '[]'::jsonb;
  v_invites  jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select * into v_me from public.affiliates where profile_id = v_uid;
  if not found then
    return jsonb_build_object('ok', true, 'role', null, 'status', null,
      'affiliate_id', null, 'contact_sharing', false,
      'contract', jsonb_build_object('current_version', v_current,
        'accepted_version', null, 'accepted_at', null, 'needs_acceptance', false,
        'current_text_hash', public.sales_contract_published_hash()),
      'head', null, 'team', '[]'::jsonb, 'open_invites', '[]'::jsonb,
      'limits', jsonb_build_object('open_invites_max', public.sales_open_invites_max(),
                                   'invite_ttl_days', public.sales_invite_ttl_days()));
  end if;

  select ca.contract_version, ca.accepted_at into v_acc_ver, v_acc_at
    from public.affiliate_contract_acceptances ca
   where ca.affiliate_id = v_me.id
   order by ca.accepted_at desc, ca.id desc limit 1;

  -- Agentul: cardul șefului (contact doar cu consimțământul ȘEFULUI).
  if v_me.sales_role = 'agent' and v_me.parent_affiliate_id is not null then
    select * into v_head_row from public.affiliates where id = v_me.parent_affiliate_id;
    if found then
      select * into v_head_p from public.profiles where id = v_head_row.profile_id;
      v_head := jsonb_build_object(
        'affiliate_id',   v_head_row.id,
        'status',         v_head_row.status,
        'contact_shared', (v_head_row.contact_sharing and v_head_row.erased_at is null),
        'name',  case when v_head_row.contact_sharing and v_head_row.erased_at is null then v_head_p.full_name end,
        'phone', case when v_head_row.contact_sharing and v_head_row.erased_at is null then v_head_row.phone end,
        'email', case when v_head_row.contact_sharing and v_head_row.erased_at is null then v_head_p.email end);
    end if;
  end if;

  -- Șeful ACTIV: recruții lui DIRECȚI + invitațiile deschise (fără token/hash).
  if v_me.sales_role = 'head' and v_me.status = 'active' then
    select coalesce(jsonb_agg(t.j order by t.ord), '[]'::jsonb) into v_team
      from (
        select row_number() over (order by a.created_at, a.id) as ord,
               jsonb_build_object(
                 'affiliate_id',   a.id,
                 'ordinal',        row_number() over (order by a.created_at, a.id),
                 'status',         a.status,
                 'joined_at',      a.created_at,
                 'contact_shared', (a.contact_sharing and a.erased_at is null),
                 'name',  case when a.contact_sharing and a.erased_at is null then p.full_name end,
                 'phone', case when a.contact_sharing and a.erased_at is null then a.phone end,
                 'email', case when a.contact_sharing and a.erased_at is null then p.email end,
                 'clients_total',  (select count(*) from public.affiliate_attributions aa
                                     where aa.affiliate_id = a.id),
                 'clients_active', (select count(*) from public.affiliate_attributions aa
                                     where aa.affiliate_id = a.id and aa.status = 'active'),
                 'agent_earned_ron_cents', coalesce((
                     select sum(l.amount_cents) from public.affiliate_ledger l
                      where l.affiliate_id = a.id and l.currency = 'RON'
                        and l.leg in ('setup', 'recurring', 'clawback')), 0),
                 'head_bonus_ron_cents', coalesce((
                     select sum(l.amount_cents) from public.affiliate_ledger l
                      where l.affiliate_id = v_me.id and l.currency = 'RON'
                        and l.leg in ('cascade', 'clawback')
                        and l.attribution_id in (select aa.id from public.affiliate_attributions aa
                                                  where aa.affiliate_id = a.id)), 0),
                 'last_sale_at', (select max(l.created_at) from public.affiliate_ledger l
                                   where l.affiliate_id = a.id and l.leg in ('setup', 'recurring'))
               ) as j
          from public.affiliates a
          left join public.profiles p on p.id = a.profile_id
         where a.parent_affiliate_id = v_me.id and a.sales_role = 'agent'
      ) t;

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', i.id, 'note', i.note,
             'created_at', i.created_at, 'expires_at', i.expires_at)
           order by i.created_at desc, i.id), '[]'::jsonb) into v_invites
      from public.affiliate_invitations i
     where i.invited_by_affiliate_id = v_me.id and i.kind = 'agent'
       and i.used_at is null and i.revoked_at is null
       and i.expires_at > clock_timestamp();
  end if;

  return jsonb_build_object(
    'ok', true,
    'role', v_me.sales_role,
    'status', v_me.status,
    'affiliate_id', v_me.id,
    'contact_sharing', v_me.contact_sharing,
    'contract', jsonb_build_object(
      'current_version',  v_current,
      'accepted_version', v_acc_ver,
      'accepted_at',      v_acc_at,
      'needs_acceptance', (v_current is not null and v_acc_ver is distinct from v_current),
      'current_text_hash', public.sales_contract_published_hash()),
    'head', v_head,
    'team', v_team,
    'open_invites', v_invites,
    'limits', jsonb_build_object('open_invites_max', public.sales_open_invites_max(),
                                 'invite_ttl_days', public.sales_invite_ttl_days()));
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- §9. Privilegii: revoke EXPLICIT per rol, apoi grant minim
-- ───────────────────────────────────────────────────────────────────────────
revoke all on function public.admin_set_sales_contract_version(text, text)       from public, anon, authenticated, service_role;
revoke all on function public.admin_create_sales_head_invite(text, text)         from public, anon, authenticated, service_role;
revoke all on function public.admin_revoke_affiliate_invite(uuid)                from public, anon, authenticated, service_role;
revoke all on function public.admin_list_affiliate_invites()                     from public, anon, authenticated, service_role;
revoke all on function public.admin_set_affiliate_status(uuid, text, text)       from public, anon, authenticated, service_role;
revoke all on function public.redeem_sales_head_invite(text, text, text, text, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.redeem_agent_invite(text, text, text, text, text, boolean)      from public, anon, authenticated, service_role;
revoke all on function public.create_agent_invite(text)                          from public, anon, authenticated, service_role;
revoke all on function public.revoke_agent_invite(uuid)                          from public, anon, authenticated, service_role;
revoke all on function public.set_my_contact_sharing(boolean)                    from public, anon, authenticated, service_role;
revoke all on function public.get_sales_network()                                from public, anon, authenticated, service_role;

grant execute on function public.admin_set_sales_contract_version(text, text)       to authenticated;
grant execute on function public.admin_create_sales_head_invite(text, text)         to authenticated;
grant execute on function public.admin_revoke_affiliate_invite(uuid)                to authenticated;
grant execute on function public.admin_list_affiliate_invites()                     to authenticated;
grant execute on function public.admin_set_affiliate_status(uuid, text, text)       to authenticated;
grant execute on function public.redeem_sales_head_invite(text, text, text, text, text, boolean) to authenticated;
grant execute on function public.redeem_agent_invite(text, text, text, text, text, boolean)      to authenticated;
grant execute on function public.create_agent_invite(text)                          to authenticated;
grant execute on function public.revoke_agent_invite(uuid)                          to authenticated;
grant execute on function public.set_my_contact_sharing(boolean)                    to authenticated;
grant execute on function public.get_sales_network()                                to authenticated;

comment on function public.redeem_sales_head_invite(text, text, text, text, text, boolean) is
  'mig 304: răscumpără invitația de ȘEF (cont active, fără părinte, cascade_bps din setări) și acceptă contractul în același pas. Un singur motiv de refuz pe invitație: invite_invalid. Rate limit 10/15 min.';
comment on function public.redeem_agent_invite(text, text, text, text, text, boolean) is
  'mig 304: răscumpără invitația de AGENT (cont active, părinte = șeful invitator, FĂRĂ aprobare) și acceptă contractul în același pas. Un singur motiv de refuz pe invitație: invite_invalid.';
comment on function public.get_sales_network() is
  'mig 304: lista albă „Echipa mea”: rolul, contractul, cardul șefului (agent) / recruții direcți (șef). Contact doar cu consimțământ; niciodată clienți finali, IBAN, Stripe, token.';

-- ───────────────────────────────────────────────────────────────────────────
-- §10. Asserții fail-closed
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  v_fn   text;
  v_tbl  text;
  v_n    integer;
  v_cas  jsonb;
begin
  -- (a) tabelele: RLS pornit, ZERO politici, zero privilegii pentru rolurile client
  foreach v_tbl in array array['affiliate_invitations', 'affiliate_contract_acceptances'] loop
    if not (select c.relrowsecurity from pg_class c
             where c.oid = ('public.' || v_tbl)::regclass) then
      raise exception 'mig 304: RLS oprit pe %', v_tbl;
    end if;
    if exists (select 1 from pg_policy p where p.polrelid = ('public.' || v_tbl)::regclass) then
      raise exception 'mig 304: % are politici RLS (trebuie deny-all-by-absence)', v_tbl;
    end if;
    if has_table_privilege('anon', ('public.' || v_tbl)::regclass, 'SELECT,INSERT,UPDATE,DELETE')
       or has_table_privilege('authenticated', ('public.' || v_tbl)::regclass, 'SELECT,INSERT,UPDATE,DELETE')
       or has_table_privilege('service_role', ('public.' || v_tbl)::regclass, 'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'mig 304: % are privilegii pentru un rol client', v_tbl;
    end if;
  end loop;

  -- (b) append-only: trigger pe UPDATE/DELETE (row) ȘI pe TRUNCATE (statement)
  if not exists (select 1 from pg_trigger where tgname = 'trg_contract_acceptance_immutable'
                  and tgrelid = 'public.affiliate_contract_acceptances'::regclass and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname = 'trg_contract_acceptance_no_truncate'
                  and tgrelid = 'public.affiliate_contract_acceptances'::regclass and not tgisinternal) then
    raise exception 'mig 304: triggerele append-only lipsesc';
  end if;

  -- (c) RPC-urile: DEFINER + pg_temp, o singură semnătură, doar authenticated
  foreach v_fn in array array[
    'admin_set_sales_contract_version', 'admin_create_sales_head_invite',
    'admin_revoke_affiliate_invite', 'admin_list_affiliate_invites',
    'admin_set_affiliate_status', 'redeem_sales_head_invite', 'redeem_agent_invite',
    'create_agent_invite', 'revoke_agent_invite', 'set_my_contact_sharing',
    'get_sales_network'] loop
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_n <> 1 then
      raise exception 'mig 304: % are % semnături (PGRST203)', v_fn, v_n;
    end if;
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_fn and p.prosecdef
                      and array_to_string(p.proconfig, ',') like '%search_path=public, pg_temp%') then
      raise exception 'mig 304: % nu e DEFINER cu search_path = public, pg_temp', v_fn;
    end if;
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = v_fn
                  and (has_function_privilege('anon', p.oid, 'EXECUTE')
                    or has_function_privilege('service_role', p.oid, 'EXECUTE')
                    or not has_function_privilege('authenticated', p.oid, 'EXECUTE'))) then
      raise exception 'mig 304: % trebuie apelabilă DOAR de authenticated', v_fn;
    end if;
  end loop;

  -- (d) helperii interni + funcția de trigger: la NIMENI
  foreach v_fn in array array[
    'sales_invite_ttl_days', 'sales_open_invites_max', 'sales_contract_published_version',
    'sales_contract_published_hash', 'fn_affiliate_sales_role_parent',
    'normalize_ro_cui', 'is_valid_ro_cui', 'new_sales_invite_token',
    'sales_invite_token_hash', 'sales_network_apply_cascade_default',
    'sales_invite_redeem', 'fn_contract_acceptance_immutable'] loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_fn) then
      raise exception 'mig 304: helperul % lipsește', v_fn;
    end if;
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = v_fn
                  and (has_function_privilege('anon', p.oid, 'EXECUTE')
                    or has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    or has_function_privilege('service_role', p.oid, 'EXECUTE'))) then
      raise exception 'mig 304: helperul % nu trebuie apelabil de roluri client', v_fn;
    end if;
  end loop;

  -- (e) răscumpărarea: lock pe invitație, handler unique_violation, rate limit
  select p.prosrc into v_fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'sales_invite_redeem';
  -- Ancorat pe CLAUZA din interogarea invitației (ca IN9), nu pe text: corpul
  -- pomenește lacătul și într-un comentariu, deci un `position` ar trece și cu
  -- lacătul scos din interogare.
  if v_fn !~ 'from public\.affiliate_invitations\s+where token_hash = [^;]+for update;'
     or position('unique_violation' in v_fn) = 0
     or position('check_rate_limit' in v_fn) = 0 then
    raise exception 'mig 304: sales_invite_redeem a pierdut for update / unique_violation / rate limit';
  end if;

  -- (f) contractul NU e publicat implicit; cascade: 2000 sau o valoare ≠ 200
  if exists (select 1 from public.platform_settings
              where key = 'sales_contract_version' and jsonb_typeof(value) = 'object'
                and (value ->> 'version') ~* 'draft') then
    raise exception 'mig 304: sales_contract_version conține o versiune DRAFT';
  end if;
  select value into v_cas from public.platform_settings where key = 'affiliate_commission_defaults';
  if v_cas is null or (v_cas ->> 'cascade_bps')::numeric = 200 then
    raise exception 'mig 304: cascade_bps implicit a rămas 200 (așteptat 2000 sau valoarea fondatorului)';
  end if;

  -- (g0) D8 în date: triggerul deferred există și semnătura admin e unică
  if not exists (select 1 from pg_trigger where tgname = 'trg_affiliate_sales_role_parent'
                  and tgrelid = 'public.affiliates'::regclass and tgdeferrable and tginitdeferred
                  and not tgisinternal) then
    raise exception 'mig 304: trg_affiliate_sales_role_parent lipsește / nu e DEFERRED';
  end if;

  -- (g) programul public rămâne neatins: register_affiliate are o singură semnătură
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'register_affiliate';
  if v_n <> 1 then
    raise exception 'mig 304: register_affiliate are % semnături', v_n;
  end if;

  -- (h) CUI: cinci CUI-uri reale valide + trei invalide
  if not (public.is_valid_ro_cui('5022670') and public.is_valid_ro_cui('RO14399840')
          and public.is_valid_ro_cui(' ro 2816464 ') and public.is_valid_ro_cui('9010105')
          and public.is_valid_ro_cui('11588780'))
     or public.is_valid_ro_cui('5022671') or public.is_valid_ro_cui('1') or public.is_valid_ro_cui(null) then
    raise exception 'mig 304: is_valid_ro_cui nu trece verificările de bază';
  end if;

  -- (i) tokenul: 43 de caractere URL-safe, hash de 64 hex ≠ token
  v_fn := public.new_sales_invite_token();
  if length(v_fn) <> 43 or v_fn !~ '^[A-Za-z0-9_-]{43}$'
     or public.sales_invite_token_hash(v_fn) !~ '^[0-9a-f]{64}$'
     or public.sales_invite_token_hash(v_fn) = v_fn then
    raise exception 'mig 304: formatul tokenului/hash-ului e greșit';
  end if;
end $$;

commit;
