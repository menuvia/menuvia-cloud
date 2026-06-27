-- mig 097 — Program de afiliere: fundația contabilă (Faza 1)
--
-- Introduce modelul de date pentru afiliere FĂRĂ nicio logică de scriere a
-- comisioanelor (aceea vine în 097B prin RPC `process_stripe_affiliate_event`).
--
-- Decizii de design (din auditul adversarial — vezi docs/AFFILIATE_PROGRAM.md):
--   • Atribuire PROFILE-BOUND (afiliat → profil al userului care cumpără).
--     Atribuirea pe restaurant_id e structural imposibilă la checkout (Stripe
--     legat de profil, restaurant_id nu există încă) → amânată la Faza 5.
--   • Ledger PUR APPEND-ONLY (WORM): trigger care RAISE pe UPDATE ȘI DELETE.
--     Nu există mutație de status pe rândurile de bani — un clawback e un rând
--     NOU negativ (reverses_ledger_id → original), un payout e un rând negativ.
--     „held / payable / paid" se DERIVĂ din view-uri (hold_until imutabil +
--     absența unui clawback), nu se ține ca status mutabil. Asta elimină
--     contradicția WORM-vs-state-machine.
--   • Regula de aur: lockdown-ul 096 (REVOKE/RLS) NU protejează banii fiindcă
--     scrierile vin prin webhook sub service_role (BYPASSRLS + owner). Singura
--     barieră reală e CONSTRAINT/ROW TRIGGER care RAISE — ca în 096C. De aceea
--     imutabilitatea ledger-ului e impusă de trigger, nu de REVOKE.
--   • Bani în minor-units (cents) — extinde idiomul integer-cents existent
--     (mig 030/041/053), NU numeric(10,2). amount_cents poate fi NEGATIV
--     (clawback/payout); base_cents >= 0.
--
-- Idempotency: tot e `if not exists` / `create or replace`; re-runnable în CI
-- („Apply all migrations"). Asserții inline fail-closed la final.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 1. Tipuri enumerate
-- ═══════════════════════════════════════════════════════════════════════════
do $$ begin
  if not exists (select 1 from pg_type where typname = 'affiliate_status') then
    create type public.affiliate_status as enum ('active', 'suspended', 'closed');
  end if;
  if not exists (select 1 from pg_type where typname = 'attribution_status') then
    create type public.attribution_status as enum
      ('pending', 'active', 'paused', 'downgraded', 'canceled', 'refunded', 'expired');
  end if;
  -- Legul (leg) descrie natura economică a rândului din ledger.
  if not exists (select 1 from pg_type where typname = 'affiliate_ledger_leg') then
    create type public.affiliate_ledger_leg as enum
      ('setup', 'recurring', 'cascade', 'clawback', 'payout', 'adjustment');
  end if;
  -- Moneda — enum ca să blocheze agregarea cross-currency în view-uri.
  -- RON e singura valoare azi (abonamente RO); extensibil ulterior.
  if not exists (select 1 from pg_type where typname = 'affiliate_currency') then
    create type public.affiliate_currency as enum ('RON', 'EUR');
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 2. affiliates — un rând per afiliat (profile-bound)
--   Datele fiscale (CUI/IBAN) merg pe affiliate_payout_profile separat,
--   populat la onboarding payout — NU pe calea critică de atribuire.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.affiliates (
  id                    uuid primary key default gen_random_uuid(),
  profile_id            uuid not null unique
                          references public.profiles(id) on delete restrict,
  referral_code         text not null unique
                          check (referral_code ~ '^[a-z0-9]{6,32}$'),
  vanity_slug           text unique
                          check (vanity_slug is null or vanity_slug ~ '^[a-z0-9-]{2,40}$'),
  parent_affiliate_id   uuid references public.affiliates(id) on delete set null
                          check (parent_affiliate_id is distinct from id),
  status                public.affiliate_status not null default 'active',
  -- Procente în basis points (0-10000) — fără erori de rotunjire la calcul.
  setup_bps             int not null default 3000 check (setup_bps     between 0 and 10000),
  recurring_bps         int not null default 1000 check (recurring_bps between 0 and 10000),
  cascade_bps           int not null default 200  check (cascade_bps   between 0 and 10000),
  recurring_cap_months  int not null default 12   check (recurring_cap_months between 0 and 120),
  created_at            timestamptz not null default now()
);

comment on table public.affiliates is
  'Afiliați (profile-bound). Procente în bps. parent_affiliate_id = 1 nivel cascade.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 3. affiliate_attributions — 1:1 profil-referit ↔ afiliat
--   referred_profile_id UNIQUE = un profil poate fi atribuit unui singur
--   afiliat (no double-dipping). Datele Stripe se completează la checkout.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.affiliate_attributions (
  id                     uuid primary key default gen_random_uuid(),
  affiliate_id           uuid not null references public.affiliates(id) on delete restrict,
  referred_profile_id    uuid not null unique
                           references public.profiles(id) on delete restrict,
  stripe_customer_id     text,
  stripe_subscription_id text,
  status                 public.attribution_status not null default 'pending',
  source                 text not null default 'referral_link',
  captured_at            timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  -- Anti self-referral determinist (gate dur, fără CUI/IBAN): un afiliat nu-și
  -- poate atribui propriul profil. Enforce-uit ȘI în RPC, dar și aici la nivel
  -- de tranzit prin trigger (Sec 6) fiindcă FK-ul nu poate exprima inecuația.
  check (referred_profile_id is not null)
);

comment on table public.affiliate_attributions is
  'Atribuire profile-bound. referred_profile_id UNIQUE previne double-dipping.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 4. affiliate_touches — pentru incrementality gate
--   Dacă profiles.created_at < touch.created_at → user organic preexistent,
--   exclus de la comision (nu plătim conversii care s-ar fi întâmplat oricum).
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.affiliate_touches (
  id                  uuid primary key default gen_random_uuid(),
  affiliate_id        uuid not null references public.affiliates(id) on delete restrict,
  referred_profile_id uuid references public.profiles(id) on delete cascade,
  cookie_value        text,
  created_at          timestamptz not null default now()
);

comment on table public.affiliate_touches is
  'Click-uri pe link afiliat. Folosit la incrementality (organic vs referit).';

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 5. affiliate_ledger — APPEND-ONLY (WORM)
--   Fiecare rând e un fapt financiar imutabil. Comision = +; clawback/payout = -.
--   Soldul se DERIVĂ (Sec 7), nu se ține pe rând. Status mutabil = INTERZIS.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.affiliate_ledger (
  id                     uuid primary key default gen_random_uuid(),
  affiliate_id           uuid not null references public.affiliates(id) on delete restrict,
  attribution_id         uuid references public.affiliate_attributions(id) on delete set null,
  -- Lanț pentru cascade (tier-2 → comisionul tier-1 sursă) și clawback.
  source_ledger_id       uuid references public.affiliate_ledger(id),
  reverses_ledger_id     uuid references public.affiliate_ledger(id),
  leg                    public.affiliate_ledger_leg not null,
  -- Luna de facturare (prima zi a lunii) pentru cap-ul de 12 luni + idempotency.
  period_month           date check (period_month = date_trunc('month', period_month)::date),
  base_cents             bigint not null default 0 check (base_cents >= 0),
  commission_bps         int not null default 0 check (commission_bps between 0 and 10000),
  amount_cents           bigint not null,            -- semnat: + comision, - clawback/payout
  currency               public.affiliate_currency not null default 'RON',
  -- Hold imutabil: comisionul devine „payable" doar după hold_until (anti-churn).
  hold_until             timestamptz not null default now(),
  -- Sursa Stripe pentru idempotency durabil (per efect, nu per rând de dedup).
  stripe_event_id        text,
  stripe_invoice_id      text,
  stripe_event_created_at timestamptz,
  created_at             timestamptz not null default now()
);

-- Idempotency per-efect: un (event, leg) nu poate genera două rânduri.
-- Tier-2 cascade are alt affiliate_id dar trebuie să fie un leg distinct ('cascade')
-- pe același event → cheia (event, leg) le discriminează corect.
create unique index if not exists uq_affiliate_ledger_event_leg
  on public.affiliate_ledger (stripe_event_id, leg)
  where stripe_event_id is not null;

-- Cap 12 luni + anti-dublă-creditare pe perioadă: cel mult 1 recurring per
-- (atribuire, lună). Setup-ul (period_month null) nu intră aici.
create unique index if not exists uq_affiliate_ledger_recurring_period
  on public.affiliate_ledger (attribution_id, period_month)
  where leg = 'recurring' and attribution_id is not null and period_month is not null;

create index if not exists idx_affiliate_ledger_affiliate
  on public.affiliate_ledger (affiliate_id, leg);
create index if not exists idx_affiliate_ledger_attribution
  on public.affiliate_ledger (attribution_id);
create index if not exists idx_affiliate_ledger_payable
  on public.affiliate_ledger (affiliate_id, hold_until)
  where leg in ('setup', 'recurring', 'cascade');

comment on table public.affiliate_ledger is
  'Ledger append-only (WORM, impus de trigger). Sold derivat din view. amount_cents semnat.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 6. Triggere de integritate (singura barieră reală contra service_role)
-- ═══════════════════════════════════════════════════════════════════════════

-- 6a. WORM: ledger-ul nu se mută și nu se șterge. NICIODATĂ. Nici service_role.
create or replace function public.fn_affiliate_ledger_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception using errcode = 'restrict_violation',
    message = 'affiliate_ledger is append-only: UPDATE/DELETE forbidden',
    hint    = 'Pentru corecții inserează un rând nou (leg=clawback/adjustment cu reverses_ledger_id).';
end$$;

drop trigger if exists trg_affiliate_ledger_immutable on public.affiliate_ledger;
create trigger trg_affiliate_ledger_immutable
  before update or delete on public.affiliate_ledger
  for each row execute function public.fn_affiliate_ledger_immutable();

-- 6b. Anti self-referral pe atribuire: referred_profile_id ≠ affiliate.profile_id.
create or replace function public.fn_affiliate_no_self_referral()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare v_affiliate_profile uuid;
begin
  select a.profile_id into v_affiliate_profile
    from public.affiliates a where a.id = NEW.affiliate_id;
  if v_affiliate_profile is not null and v_affiliate_profile = NEW.referred_profile_id then
    raise exception using errcode = 'check_violation',
      message = 'self-referral interzis: afiliatul nu-și poate atribui propriul profil',
      hint    = 'gate:self_referral';
  end if;
  return NEW;
end$$;

drop trigger if exists trg_affiliate_no_self_referral on public.affiliate_attributions;
create trigger trg_affiliate_no_self_referral
  before insert or update on public.affiliate_attributions
  for each row execute function public.fn_affiliate_no_self_referral();

-- 6c. Anti-cycle depth-1: un afiliat cu parent nu poate fi el însuși parent al
--   altcuiva (lanțul de cascade are exact 1 nivel). CONSTRAINT TRIGGER deferred
--   ca să permită tranzitul intra-tranzacție, verifică starea finală la COMMIT.
create or replace function public.fn_affiliate_depth1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Dacă NEW are un parent, acel parent nu trebuie să aibă, la rândul lui, parent.
  if NEW.parent_affiliate_id is not null then
    if exists (
      select 1 from public.affiliates p
       where p.id = NEW.parent_affiliate_id and p.parent_affiliate_id is not null
    ) then
      raise exception using errcode = 'check_violation',
        message = 'cascade depth-1: parent-ul nu poate avea el însuși parent',
        hint    = 'invariant:cascade_depth1';
    end if;
  end if;
  -- Și invers: dacă NEW are copii, NEW nu poate primi un parent.
  if NEW.parent_affiliate_id is not null and exists (
    select 1 from public.affiliates c where c.parent_affiliate_id = NEW.id
  ) then
    raise exception using errcode = 'check_violation',
      message = 'cascade depth-1: un afiliat cu sub-afiliați nu poate primi parent',
      hint    = 'invariant:cascade_depth1';
  end if;
  return null;
end$$;

drop trigger if exists trg_affiliate_depth1 on public.affiliates;
create constraint trigger trg_affiliate_depth1
  after insert or update on public.affiliates
  deferrable initially deferred
  for each row execute function public.fn_affiliate_depth1();

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 7. View-uri derivate (soldul = singura sursă de adevăr)
-- ═══════════════════════════════════════════════════════════════════════════

-- Sold per afiliat per monedă (suma simplă a ledger-ului semnat).
-- security_invoker=true: view-ul rulează cu privilegiile + RLS ale apelantului,
-- NU ale definer-ului. Fără el, un afiliat autentificat ar citi soldurile
-- TUTUROR (RLS-ul de pe affiliate_ledger ar fi ocolit). Pattern din mig 008.
create or replace view public.v_affiliate_balance
  with (security_invoker = true) as
  select affiliate_id,
         currency,
         sum(amount_cents) as balance_cents,
         count(*)          as entry_count
    from public.affiliate_ledger
   group by affiliate_id, currency;

comment on view public.v_affiliate_balance is
  'Sold derivat din ledger (semnat), cu security_invoker → RLS al apelantului.';

-- Comisioane „payable": leg pozitiv, trecut de hold, ne-stornat de un clawback.
create or replace view public.v_affiliate_payable
  with (security_invoker = true) as
  select l.id,
         l.affiliate_id,
         l.attribution_id,
         l.leg,
         l.period_month,
         l.amount_cents,
         l.currency,
         l.hold_until
    from public.affiliate_ledger l
   where l.leg in ('setup', 'recurring', 'cascade')
     and l.amount_cents > 0
     and l.hold_until <= now()
     and not exists (
       select 1 from public.affiliate_ledger r
        where r.reverses_ledger_id = l.id
     );

comment on view public.v_affiliate_payable is
  'Comisioane eligibile de plată: pozitive, trecute de hold, ne-stornate (security_invoker).';

-- Acces SELECT pe view-uri pentru rolul aplicației (RLS-ul subiacent scopează rândurile).
grant select on public.v_affiliate_balance to authenticated;
grant select on public.v_affiliate_payable to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 8. Privilegii — REVOKE IUD pentru roluri aplicație; SELECT prin RLS
--   Scrierile vin EXCLUSIV prin RPC SECURITY DEFINER (097B) / webhook
--   service_role. Imutabilitatea reală e impusă de triggerul WORM (Sec 6a),
--   nu de aceste REVOKE-uri (service_role le ocolește ca owner).
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.affiliates             enable row level security;
alter table public.affiliate_attributions enable row level security;
alter table public.affiliate_touches      enable row level security;
alter table public.affiliate_ledger       enable row level security;

revoke insert, update, delete on public.affiliates             from public, anon, authenticated;
revoke insert, update, delete on public.affiliate_attributions from public, anon, authenticated;
revoke insert, update, delete on public.affiliate_touches      from public, anon, authenticated;
revoke insert, update, delete on public.affiliate_ledger       from public, anon, authenticated;

-- Helper SECURITY DEFINER: setul de afiliați vizibili apelantului (propriul rând
-- + sub-afiliații direcți). RULEAZĂ CU BYPASS RLS (definer) → evită recursia
-- infinită a politicii pe `affiliates` care altfel s-ar auto-declanșa când o
-- politică citește `affiliates` în subquery. Pattern identic cu is_admin/is_member.
create or replace function public.affiliate_visible_ids()
returns setof uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select a.id
    from public.affiliates a
   where a.profile_id = auth.uid()
      or a.parent_affiliate_id = (
        select s.id from public.affiliates s where s.profile_id = auth.uid() limit 1
      )
$$;

revoke all on function public.affiliate_visible_ids() from public, anon;
grant execute on function public.affiliate_visible_ids() to authenticated;

-- RLS SELECT: afiliatul își vede propriul rând + (pentru parent) sub-afiliații
-- direcți. Coloanele sensibile (cookie_value, stripe_customer_id) NU se expun
-- în UI — frontend-ul citește prin RPC/view dedicat, nu direct din tabele.
-- Toate politicile folosesc helper-ul SECURITY DEFINER → fără recursie.
drop policy if exists "affiliate: read own" on public.affiliates;
create policy "affiliate: read own" on public.affiliates
  for select to authenticated
  using (id in (select public.affiliate_visible_ids()));

drop policy if exists "affiliate: read own attributions" on public.affiliate_attributions;
create policy "affiliate: read own attributions" on public.affiliate_attributions
  for select to authenticated
  using (affiliate_id in (select public.affiliate_visible_ids()));

drop policy if exists "affiliate: read own ledger" on public.affiliate_ledger;
create policy "affiliate: read own ledger" on public.affiliate_ledger
  for select to authenticated
  using (affiliate_id in (select public.affiliate_visible_ids()));

-- affiliate_touches: zero SELECT pentru roluri aplicație (date de fraud/audit).
-- Nicio policy → blocat complet pentru anon/authenticated. Doar service_role.

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 9. Asserții inline fail-closed (smoke; setul complet în tests/sql)
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare v_count int;
begin
  -- 9a. Cele 4 tabele există.
  select count(*) into v_count from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('affiliates','affiliate_attributions','affiliate_touches','affiliate_ledger')
     and c.relkind = 'r';
  if v_count <> 4 then
    raise exception 'mig 097: expected 4 affiliate tables, found %', v_count;
  end if;

  -- 9b. Triggerul WORM e prezent pe ledger.
  if not exists (
    select 1 from pg_trigger
     where tgname = 'trg_affiliate_ledger_immutable'
       and tgrelid = 'public.affiliate_ledger'::regclass
       and not tgisinternal
  ) then
    raise exception 'mig 097: WORM trigger missing on affiliate_ledger';
  end if;

  -- 9c. Anti-cycle e CONSTRAINT TRIGGER DEFERRED.
  if not exists (
    select 1 from pg_trigger
     where tgname = 'trg_affiliate_depth1'
       and tgrelid = 'public.affiliates'::regclass
       and tgdeferrable and tginitdeferred
  ) then
    raise exception 'mig 097: depth-1 trigger must be DEFERRABLE INITIALLY DEFERRED';
  end if;

  -- 9d. RLS activ pe toate cele 4 tabele.
  select count(*) into v_count from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('affiliates','affiliate_attributions','affiliate_touches','affiliate_ledger')
     and c.relrowsecurity;
  if v_count <> 4 then
    raise exception 'mig 097: RLS not enabled on all 4 tables (found %)', v_count;
  end if;

  -- 9e. View-urile au security_invoker=true (altfel ocolesc RLS-ul ledger-ului).
  select count(*) into v_count from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('v_affiliate_balance','v_affiliate_payable')
     and c.reloptions @> array['security_invoker=true'];
  if v_count <> 2 then
    raise exception 'mig 097: views must have security_invoker=true (found %)', v_count;
  end if;

  raise notice 'mig 097: affiliate foundation OK';
end $$;

commit;
