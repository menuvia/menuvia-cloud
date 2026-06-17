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
  v_rid             uuid := coalesce(NEW.restaurant_id, OLD.restaurant_id);
  v_restaurant_owner uuid;
  v_owner_count     int;
begin
  -- Restaurantul a dispărut (cascade delete) → nu mai e nimic de impus.
  select r.owner_id into v_restaurant_owner
    from public.restaurants r where r.id = v_rid;
  if not found then
    return null;
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

  -- Invariant deferred constraint trigger activ
  select count(*) into v_inv from pg_trigger
   where tgname = 'trg_enforce_owner_membership_invariant'
     and tgrelid = 'public.restaurant_memberships'::regclass
     and not tgisinternal and tgdeferrable and tginitdeferred
     and tgfoid = 'public.fn_enforce_owner_membership_invariant()'::regprocedure;
  if v_inv <> 1 then
    raise exception '096C FAIL: deferred invariant trigger missing/not-deferred';
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
