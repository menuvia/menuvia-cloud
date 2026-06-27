-- mig 096C — Authorization Lockdown PR 1C (validate + retire transitory guard)
--
-- Continuă PR 1A (096A) + PR 1B (096B). Pașii finali ai lockdown-ului owner:
--   1. Arhivează istoricul `invite_tokens` cu role='owner' într-o schemă
--      `archive` (append-only față de rolurile aplicației) ca să poată fi
--      validată constrângerea fără a respinge istoricul legitim acceptat.
--   2. `VALIDATE CONSTRAINT invite_tokens_role_not_owner` — acum că nu mai
--      există rânduri owner, scan-ul reușește și constrângerea devine
--      `convalidated = true` (aplicată retroactiv + pe rândurile noi).
--   3. Instalează invariantul permanent ca CONSTRAINT TRIGGER DEFERRABLE
--      INITIALLY DEFERRED: la COMMIT, fiecare restaurant are EXACT 1 owner
--      membership aliniat cu `restaurants.owner_id`. Verificarea la commit
--      (nu pe fiecare statement) permite tranzacții legitime cu stări
--      intermediare (ex. transfer de proprietate viitor) păstrând garanția
--      finală.
--   4. ABIA DUPĂ ce invariantul deferred e instalat: DROP guard-ul tranzitoriu
--      `trg_block_owner_membership_mutation` + funcția lui. Guard-ul (BEFORE
--      I/U/D, per-statement, din 096A) devine redundant — invariantul deferred
--      acoperă starea finală, iar REVOKE-urile IUD din 096B blochează deja
--      mutațiile directe ale rolurilor aplicației.
--
-- Securitate: zero GUC bypass, zero session_replication_role. Migrația rulează
-- într-o singură tranzacție DDL atomică; dacă invariantul global e rupt la
-- pre-check, abort înainte de orice modificare.
--
-- TRADE-OFF NOTE: per-statement guard → deferred invariant
--   Mutarea de la guardul BEFORE I/U/D (per-statement, din 096A) la CONSTRAINT
--   TRIGGER DEFERRABLE INITIALLY DEFERRED (commit-time) NU este o îmbunătățire
--   pură — este un trade-off conștient asumat:
--     • ÎNAINTE (per-statement): guardul respingea statementul ofensator
--       IMEDIAT, inclusiv din interiorul RPC-urilor SECURITY DEFINER. Un bug
--       care încerca să rupă starea owner era prins exact la statementul
--       vinovat — debugging trivial, fail-fast la sursa erorii.
--     • DUPĂ (commit-time): un RPC buggy poate TRANZITA o stare ruptă pe
--       parcursul tranzacției (ex. ștergere temporară a owner-membership +
--       reinserare ulterioară) și o poate „repara" înainte de COMMIT;
--       invariantul deferred NU va trage pe transit, doar dacă starea finală
--       rămâne ruptă la COMMIT (sau la SET CONSTRAINTS IMMEDIATE).
--   De ce e acceptabil:
--     • Commit-time garantează în continuare invariantul final pentru ORICE
--       tranzacție care reușește să se commit-eze — zero scenarii „end-state
--       broken" se persistă în tabel.
--     • 096B a făcut REVOKE IUD pe rolurile aplicației (anon/authenticated/
--       service_role) pe `restaurant_memberships`, deci mutațiile directe de
--       la PostgREST sunt deja blocate la nivel de privilegii — singura cale
--       de mutație rămâne RPC-urile SECURITY DEFINER auditate (suprafața
--       mică: create_restaurant, change_member_role, remove_member).
--   Ce trebuie să respecte codul viitor:
--     • Orice cod nou care mutează owner memberships în interiorul unei
--       tranzacții TREBUIE să lase starea finală coerentă (exact 1 owner
--       aliniat cu restaurants.owner_id) — invariantul deferred NU va ajuta
--       la debugging mid-transaction transit; bug-urile care „se autocorect-
--       ează" înainte de COMMIT vor trece neobservate de DB.
--     • Pentru orice RPC nou care atinge owner memberships, adaugă teste
--       comportamentale care verifică explicit starea intermediară, nu doar
--       starea finală.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 1. Lock ordine deterministă (identică cu 096A/096B)
-- ═══════════════════════════════════════════════════════════════════════════
lock table public.restaurants            in share row exclusive mode;
lock table public.restaurant_memberships in share row exclusive mode;
lock table public.invite_tokens          in share row exclusive mode;

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 2. Pre-check global ownership invariant
--   Trebuie să fie deja curat (096B l-a impus). Dacă nu, abort — operatorul
--   rulează scripts/apply_ownership_remediation.sql întâi.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare v_anomalies int;
begin
  select count(*) into v_anomalies
  from public.restaurants r
  where (
    select count(*) from public.restaurant_memberships rm
     where rm.restaurant_id = r.id and rm.role = 'owner'::public.member_role
  ) <> 1
     or not exists (
       select 1 from public.restaurant_memberships rm
        where rm.restaurant_id = r.id
          and rm.role = 'owner'::public.member_role
          and rm.user_id = r.owner_id
     );
  if v_anomalies > 0 then
    raise exception '096C PRE-CHECK FAIL: % restaurants have inconsistent owner state. Run scripts/apply_ownership_remediation.sql first.',
      v_anomalies;
  end if;
end$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 3. Arhivă istoric owner-invite → schema `archive`
--   `LIKE ... INCLUDING DEFAULTS` copiază DOAR default-urile coloanelor, NU
--   constrângerile CHECK — esențial, altfel CHECK-ul role<>'owner' ar bloca
--   inserarea istoricului owner pe care tocmai îl arhivăm.
-- ═══════════════════════════════════════════════════════════════════════════
create schema if not exists archive;

create table if not exists archive.invite_tokens_owner_history (
  like public.invite_tokens including defaults
);
alter table archive.invite_tokens_owner_history
  add column if not exists archived_at timestamptz not null default now();

revoke all on schema archive from public, anon, authenticated, service_role;
revoke all on table archive.invite_tokens_owner_history
  from public, anon, authenticated, service_role;

comment on table archive.invite_tokens_owner_history is
  'Append-only arhivă a invite_tokens cu role=owner, mutate în PR 1C înainte de VALIDATE CONSTRAINT. Rolurile aplicației au zero privilegii.';

-- Mută rândurile owner (orice stare: pending sau accepted) din invite_tokens
-- în arhivă. DELETE ... RETURNING + INSERT, atomic în aceeași tranzacție.
with moved as (
  delete from public.invite_tokens
   where role = 'owner'::public.member_role
   returning id, restaurant_id, email, role, token, invited_by,
             accepted_at, expires_at, created_at
)
insert into archive.invite_tokens_owner_history
  (id, restaurant_id, email, role, token, invited_by, accepted_at, expires_at, created_at)
select id, restaurant_id, email, role, token, invited_by, accepted_at, expires_at, created_at
from moved;

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 4. VALIDATE CONSTRAINT (acum că istoricul owner a fost mutat)
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.invite_tokens
  validate constraint invite_tokens_role_not_owner;

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 5. Invariant permanent — CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED
--   La COMMIT: fiecare restaurant are exact 1 owner membership aliniat cu
--   restaurants.owner_id. Dacă restaurantul a fost șters (cascade), skip.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_enforce_owner_membership_invariant()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  -- Setul de restaurante de validat per rând atinsit. Iterăm peste valori
  -- distincte: când restaurant_memberships UPDATE mută rândul între
  -- restaurante (OLD.restaurant_id ≠ NEW.restaurant_id), AMBELE restaurante
  -- trebuie validate, altfel restaurantul vechi poate rămâne cu 0 owneri și
  -- triggerul nu l-ar prinde dacă verifica doar NEW (CodeRabbit PR#48 #3).
  v_restaurant_ids  uuid[];
  v_rid             uuid;
  v_restaurant_owner uuid;
  v_owner_count     int;
begin
  -- Determină ce restaurante au fost atinse de operația curentă. Funcția
  -- e atașată la DOUĂ triggere (CONSTRAINT TRIGGER DEFERRED):
  --   • pe `restaurant_memberships` (AFTER I/U/D) — sursa primară;
  --   • pe `restaurants` (AFTER INSERT OR UPDATE OF owner_id) — defense-in-depth
  --     pentru cazul în care un INSERT/UPDATE pe `restaurants` ar putea
  --     persista un restaurant fără owner-membership (ex. bootstrap-ul
  --     `bootstrap_restaurant_owner` dezactivat sau bypass-at).
  if TG_TABLE_NAME = 'restaurant_memberships' then
    if TG_OP = 'INSERT' then
      v_restaurant_ids := array[NEW.restaurant_id];
    elsif TG_OP = 'DELETE' then
      v_restaurant_ids := array[OLD.restaurant_id];
    else  -- UPDATE: ambele dacă diferă (mutarea owner între restaurante)
      v_restaurant_ids := array[OLD.restaurant_id, NEW.restaurant_id];
    end if;
  elsif TG_TABLE_NAME = 'restaurants' then
    -- Pe `restaurants`: PK `id` e imuabil, deci NEW.id == OLD.id la UPDATE.
    -- INSERT setează NEW.id; nu există trigger DELETE pe `restaurants` aici
    -- (CASCADE-ul va trigger-ui DELETE-ul de pe memberships oricum).
    v_restaurant_ids := array[coalesce(NEW.id, OLD.id)];
  else
    return null;  -- defensive: niciodată atins în production
  end if;

  for v_rid in
    select distinct rid
      from unnest(v_restaurant_ids) as ids(rid)
     where rid is not null
  loop
    -- Restaurantul a dispărut (cascade delete) → nu mai e nimic de impus.
    select r.owner_id into v_restaurant_owner
      from public.restaurants r where r.id = v_rid;
    if not found then
      continue;
    end if;

    select count(*) into v_owner_count
      from public.restaurant_memberships rm
     where rm.restaurant_id = v_rid and rm.role = 'owner'::public.member_role;

    if v_owner_count <> 1 then
      raise exception using errcode = 'check_violation',
        message = format('restaurant %s must have exactly 1 owner membership, found %s',
                         v_rid, v_owner_count),
        hint = 'invariant:owner_membership_singleton';
    end if;

    if not exists (
      select 1 from public.restaurant_memberships rm
       where rm.restaurant_id = v_rid
         and rm.role = 'owner'::public.member_role
         and rm.user_id = v_restaurant_owner
    ) then
      raise exception using errcode = 'check_violation',
        message = format('restaurant %s owner membership not aligned with owner_id', v_rid),
        hint = 'invariant:owner_membership_alignment';
    end if;
  end loop;

  return null;
end$$;

revoke all on function public.fn_enforce_owner_membership_invariant()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_enforce_owner_membership_invariant
  on public.restaurant_memberships;
create constraint trigger trg_enforce_owner_membership_invariant
  after insert or update or delete on public.restaurant_memberships
  deferrable initially deferred
  for each row execute function public.fn_enforce_owner_membership_invariant();

-- Defense-in-depth: invariant și pe `restaurants` la INSERT și UPDATE OF
-- owner_id. UPDATE-ul de owner_id e blocat de `trg_restaurants_owner_id_immutable`
-- în mod normal, dar scriptul admin de remediere îl dezactivează temporar —
-- triggerul ăsta asigură că, chiar și sub bypass, ownership-ul rămâne aliniat
-- la COMMIT. INSERT-ul prinde cazul în care un RPC viitor ar bypassa
-- triggerul `bootstrap_restaurant_owner` (din 004) și ar lăsa restaurantul
-- fără owner-membership.
drop trigger if exists trg_enforce_owner_membership_invariant_restaurants
  on public.restaurants;
create constraint trigger trg_enforce_owner_membership_invariant_restaurants
  after insert or update of owner_id on public.restaurants
  deferrable initially deferred
  for each row execute function public.fn_enforce_owner_membership_invariant();

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 6. Retragere guard tranzitoriu (DUPĂ ce invariantul deferred e instalat)
--   Guard-ul per-statement din 096A devine redundant: invariantul deferred
--   acoperă starea finală + REVOKE IUD (096B) blochează mutațiile directe.
-- ═══════════════════════════════════════════════════════════════════════════
drop trigger if exists trg_block_owner_membership_mutation
  on public.restaurant_memberships;
drop function if exists public.fn_block_owner_membership_mutation();

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 7. Inline smoke assertions înainte de COMMIT (fail-closed)
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare v_convalidated boolean; v_guard int; v_inv int; v_owner_invites int;
begin
  -- Constrângerea VALIDATED
  select convalidated into v_convalidated from pg_constraint
   where conrelid = 'public.invite_tokens'::regclass
     and conname  = 'invite_tokens_role_not_owner' and contype = 'c';
  if not coalesce(v_convalidated, false) then
    raise exception '096C FAIL: invite_tokens_role_not_owner not VALIDATED';
  end if;

  -- Guard tranzitoriu eliminat (trigger + funcție)
  select count(*) into v_guard from pg_trigger
   where tgname = 'trg_block_owner_membership_mutation' and not tgisinternal;
  if v_guard <> 0 then
    raise exception '096C FAIL: transitory guard trigger still present';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='fn_block_owner_membership_mutation') then
    raise exception '096C FAIL: fn_block_owner_membership_mutation still present';
  end if;

  -- Invariant deferred constraint trigger activ — ambele tabele
  select count(*) into v_inv from pg_trigger
   where tgname = 'trg_enforce_owner_membership_invariant'
     and tgrelid = 'public.restaurant_memberships'::regclass
     and not tgisinternal and tgdeferrable and tginitdeferred
     and tgfoid = 'public.fn_enforce_owner_membership_invariant()'::regprocedure;
  if v_inv <> 1 then
    raise exception '096C FAIL: deferred invariant trigger on memberships missing/not-deferred';
  end if;
  select count(*) into v_inv from pg_trigger
   where tgname = 'trg_enforce_owner_membership_invariant_restaurants'
     and tgrelid = 'public.restaurants'::regclass
     and not tgisinternal and tgdeferrable and tginitdeferred
     and tgfoid = 'public.fn_enforce_owner_membership_invariant()'::regprocedure;
  if v_inv <> 1 then
    raise exception '096C FAIL: deferred invariant trigger on restaurants missing/not-deferred';
  end if;

  -- owner_id immutability trigger (din 096A) rămâne activ
  if not exists (select 1 from pg_trigger
                  where tgname='trg_restaurants_owner_id_immutable'
                    and tgrelid='public.restaurants'::regclass
                    and not tgisinternal and tgenabled in ('O','A')) then
    raise exception '096C FAIL: owner_id immutability trigger missing';
  end if;

  -- Zero owner invites rămase în tabela live
  select count(*) into v_owner_invites from public.invite_tokens
   where role = 'owner'::public.member_role;
  if v_owner_invites <> 0 then
    raise exception '096C FAIL: % owner invites still in invite_tokens', v_owner_invites;
  end if;
end$$;

commit;
