-- migration_289_reservations_expired.sql
-- =============================================================================
-- Planul „lansare RO", PR 2 / decizia D1 — rezervările `pending` rămase în
-- TRECUT nu le procesa nimic.
--
-- Măsurat pe producție la 30 sept 2026: 8 rezervări `pending` cu `starts_at` în
-- trecut, cea mai veche de 116 zile (+ 1 `confirmed` mai veche de 48h).
--   * `auto_mark_reservation_no_show` (mig 234) atinge DOAR `confirmed`, DOAR în
--     fereastra rulantă de 48h;
--   * reminderele (057→215→234) iau DOAR `confirmed`;
--   * UI-ul filtrează pe interval de dată, deci rândurile vechi erau INVIZIBILE.
-- Rezultat: o masă „rezervată" în sistem pe vecie și zero semnal către local.
--
-- DECIZIA D1: status NOU `expired`, nu `cancelled`. `reservations` n-are coloană
-- de motiv de anulare, iar `cancelled` înseamnă „clientul/localul a anulat" —
-- amestecat cu „nu s-a confirmat niciodată" ar fi o minciună în istoric. Nici
-- `no_show`: clientul nu a ratat nimic confirmat, deci NU are voie să intre în
-- numărătoarea de recidiviști (`get_reservation_no_show_counts` numără
-- `status = 'no_show'` — NEATINSĂ, vezi mai jos).
--
-- CE FACE MIGRAȚIA
--   A. CHECK-ul de status (inline în 057, numele de catalog) e recreat cu
--      `expired`.
--   B. `expired` ELIBEREAZĂ masa. Predicatul `status not in ('cancelled',
--      'no_show')` stă în DOUĂ locuri de date + TREI funcții; toate primesc
--      `'expired'`:
--        * indexul parțial `idx_reservations_availability` (057) — DROP+CREATE;
--        * constrângerea EXCLUDE `excl_reservations_no_overlap` (121) — DROP+ADD
--          (altfel un rând expirat ar continua să blocheze o inserare directă
--          din dashboard pe același interval);
--        * `create_reservation_public` (ultima definiție: 273, 11 argumente),
--          `get_tables_availability` (246), `check_availability` (086).
--      Funcțiile sunt rescrise MECANIC: `pg_get_functiondef` de pe definiția VIE
--      + înlocuirea predicatului, cu asserții pe numărul de înlocuiri. Nicio
--      copie de mână a 270 de linii de logică (p_table_id 199, plafon durată 151,
--      gate modul 200, wrap-around 201, ziua de SERVICIU 241, idempotență 273) —
--      invarianții rămân pe loc prin construcție, iar GRANT-urile le păstrează
--      `create or replace`. proconfig (search_path) vine în același
--      `pg_get_functiondef`. Orice recreare VIITOARE pornește din definiția
--      vie, nu din 273; testul RX7 cere `'expired'` în cele trei corpuri.
--      NEatinse, cu dovadă în testele RX: `get_reservation_no_show_counts` (234
--      filtrează `= 'no_show'` — expired nu intră), `claim_reservation_reminders`
--      (filtrează `= 'confirmed'`), `auto_mark_reservation_no_show`,
--      `check_reservation_rate_limit` (115/129: fereastră de MINUTE pe
--      created_at — un rând expirat e vechi de ore, nu poate fi în ea),
--      trigger-ul SMS (228: reacționează doar la `confirmed`).
--   C. Janitorul `expire_stale_pending_reservations(p_grace_hours)`: `pending` cu
--      `starts_at` mai vechi de grație (2h, ca grația no-show-ului) → `expired`.
--      Programat pe pg_cron prin manifestul mig 274 (minut 47, orar — minutul
--      43 e al janitorului de comenzi din mig 288).
--        * AUTO-CONSUMAT: după rulare rândul nu mai e `pending` → a doua rulare
--          prinde 0 rânduri;
--        * FĂRĂ ceas de perete: fereastra e o VÂRSTĂ (CJ7);
--        * BACKFILL NELIMITAT, DORIT (spre deosebire de no-show, care are
--          fereastra de 48h): rândurile vechi `pending` NU au intrat niciodată în
--          nicio statistică de recidivă, deci nu există badge de otrăvit, iar cele
--          8 fantome trebuie să iasă. O ȘTERGERE ar fi fost greșită — rămân ca
--          istoric, cu statusul adevărat. Se apelează o dată și în migrație.
--        * ZERO grant-uri (nici service_role): rulează ca `postgres` pe pg_cron,
--          unde EXECUTE vine din proprietate; nu există apelant în Netlify.
--
-- `confirmed` NEACTUALIZAT >48h (1 pe prod) — DECIZIE: RĂMÂNE așa. (1) Fereastra
-- de 48h din 234 e anti-backfill deliberat: a rescrie istoricul de `confirmed` în
-- `no_show` otrăvește IREVERSIBIL badge-ul de recidivist. (2) `expired` ar minți:
-- rezervarea FUSESE confirmată. (3) `completed` ar INVENTA un fapt (că oaspeții au
-- venit). Soluția e vizibilitatea, nu rescrierea: tab-ul Rezervări are acum o
-- secțiune fără filtru de dată care le arată pe toate, ca omul să decidă.
--
-- Teste permanente RX1–RX9: tests/sql/reservations_expired_assertions.sql
-- =============================================================================

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── A. CHECK-ul de status ────────────────────────────────────────────────────
do $$
declare v_con text;
begin
  for v_con in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.reservations'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%no_show%'
       and pg_get_constraintdef(c.oid) ilike '%status%'
  loop
    execute format('alter table public.reservations drop constraint %I', v_con);
  end loop;
end $$;

alter table public.reservations
  add constraint reservations_status_check
  check (status in ('pending','confirmed','seated','completed','cancelled','no_show','expired'));

-- ── B1. Indexul parțial + EXCLUDE: `expired` eliberează masa ─────────────────
drop index if exists public.idx_reservations_availability;
create index idx_reservations_availability
  on public.reservations (restaurant_id, table_id, starts_at, ends_at)
  where status not in ('cancelled','no_show','expired');

alter table public.reservations drop constraint if exists excl_reservations_no_overlap;
alter table public.reservations
  add constraint excl_reservations_no_overlap
  exclude using gist (
    table_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  where (status not in ('cancelled', 'no_show', 'expired'));

-- ── B2. Cele trei funcții, rescrise MECANIC din definiția vie ────────────────
do $$
declare
  v_sig  text;
  v_exp  int;
  v_def  text;
  v_new  text;
  v_n    int;
  v_old  constant text := $q$not in ('cancelled','no_show')$q$;
  v_upd  constant text := $q$not in ('cancelled','no_show','expired')$q$;
begin
  for v_sig, v_exp in
    select * from (values
      ('public.create_reservation_public(text,text,text,smallint,timestamptz,text,text,smallint,text,uuid,uuid)', 2),
      ('public.get_tables_availability(text,timestamptz,timestamptz,smallint)', 1),
      ('public.check_availability(uuid,timestamptz,timestamptz,smallint,text)', 1)
    ) t(sig, n)
  loop
    v_def := pg_get_functiondef(v_sig::regprocedure);
    v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    if v_n <> v_exp then
      raise exception 'mig 289: % are % aparitii ale predicatului, se asteptau % (definitia vie s-a schimbat — rescrie de mana)', v_sig, v_n, v_exp;
    end if;
    v_new := replace(v_def, v_old, v_upd);
    execute v_new;
  end loop;
end $$;

-- ── C. Janitorul ─────────────────────────────────────────────────────────────
create or replace function public.expire_stale_pending_reservations(
  p_grace_hours integer default 2
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  -- `pending` care a rămas în trecut = nimeni nu a confirmat-o și ora a trecut.
  -- Grația (implicit 2h, minim 1h) acoperă o rezervare de seară pe care staff-ul
  -- încă o poate confirma/așeza. Fără fereastră în urmă (backfill dorit — vezi
  -- antetul migrației 289). Auto-consumat: rândul iese din `pending`.
  update public.reservations
     set status = 'expired',
         updated_at = now()
   where status = 'pending'
     and starts_at < now() - make_interval(hours => greatest(coalesce(p_grace_hours, 2), 1));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_stale_pending_reservations(integer)
  from public, anon, authenticated, service_role;

insert into public.pg_cron_janitor_manifest
  (job_name, schedule, signature, command, max_age_s, safety_marker, note)
values
  ('menuvia_janitor_reservation_expire', '47 * * * *',
   'public.expire_stale_pending_reservations(integer)',
   'select public.expire_stale_pending_reservations(2)', 10800,
   'where status = ''pending''',
   'mig 289 (D1). pending cu starts_at mai vechi de 2h -> expired (status nou, NU cancelled/no_show: nu intra in recidivisti). Auto-consumat (iese din pending), fara ceas de perete. Backfill NELIMITAT deliberat: fantomele vechi trebuie sa iasa, iar istoricul pending nu a alimentat niciun badge. confirmed >48h NU se atinge (anti-backfill 234).')
on conflict (job_name) do update set
  schedule      = excluded.schedule,
  signature     = excluded.signature,
  command       = excluded.command,
  max_age_s     = excluded.max_age_s,
  safety_marker = excluded.safety_marker,
  note          = excluded.note;

do $$
declare v_n integer;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'mig 289: pg_cron neinstalat - programarea sarita; manifestul si functia sunt aplicate (clichetul CJ + RX nu depinde de extensie).';
    return;
  end if;
  v_n := public.pg_cron_apply_manifest();
  raise notice 'mig 289: % joburi pg_cron programate (inclusiv menuvia_janitor_reservation_expire)', v_n;
end $$;

-- Backfill-ul celor 8 fantome de pe prod: o rulare în migrație (pe CI e no-op).
do $$
declare v_n integer;
begin
  v_n := public.expire_stale_pending_reservations(2);
  raise notice 'mig 289: % rezervari pending din trecut marcate expired', v_n;
end $$;

-- ── Asserții fail-closed ─────────────────────────────────────────────────────
do $$
declare v_def text; v_sig text;
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.reservations'::regclass and conname = 'reservations_status_check'
                    and pg_get_constraintdef(oid) like '%expired%') then
    raise exception 'mig 289: CHECK-ul de status nu admite expired'; end if;
  if (select count(*) from pg_constraint
       where conrelid = 'public.reservations'::regclass and contype = 'c'
         and pg_get_constraintdef(oid) ilike '%no_show%') <> 1 then
    raise exception 'mig 289: trebuie sa existe EXACT un CHECK de status'; end if;
  if (select pg_get_indexdef('public.idx_reservations_availability'::regclass))
       not like '%expired%' then
    raise exception 'mig 289: indexul de disponibilitate nu exclude expired'; end if;
  if not exists (select 1 from pg_constraint where conname = 'excl_reservations_no_overlap'
                    and conrelid = 'public.reservations'::regclass and contype = 'x'
                    and pg_get_constraintdef(oid) like '%expired%') then
    raise exception 'mig 289: EXCLUDE-ul anti-overlap nu exclude expired'; end if;
  foreach v_sig in array array[
    'public.create_reservation_public(text,text,text,smallint,timestamptz,text,text,smallint,text,uuid,uuid)',
    'public.get_tables_availability(text,timestamptz,timestamptz,smallint)',
    'public.check_availability(uuid,timestamptz,timestamptz,smallint,text)'] loop
    v_def := pg_get_functiondef(v_sig::regprocedure);
    if v_def not like '%''cancelled'',''no_show'',''expired''%' then
      raise exception 'mig 289: % nu exclude expired', v_sig; end if;
    if v_def not like '%search_path%pg_temp%' then
      raise exception 'mig 289: % si-a pierdut search_path', v_sig; end if;
  end loop;
  -- invariantii create_reservation_public ramasi (rescrierea e mecanica, dar verificam)
  v_def := pg_get_functiondef('public.create_reservation_public(text,text,text,smallint,timestamptz,text,text,smallint,text,uuid,uuid)'::regprocedure);
  if v_def not like '%is_module_enabled%' or v_def not like '%idempotency_key%'
     or v_def not like '%pg_advisory_xact_lock%' or v_def not like '%table_unavailable%'
     or v_def not like '%reservation_duration%' then
    raise exception 'mig 289: create_reservation_public si-a pierdut un invariant (modul/idempotenta/lock/table_unavailable/durata)'; end if;
  -- janitorul: nicio suprafata client
  if has_function_privilege('anon', 'public.expire_stale_pending_reservations(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.expire_stale_pending_reservations(integer)', 'execute')
     or has_function_privilege('service_role', 'public.expire_stale_pending_reservations(integer)', 'execute') then
    raise exception 'mig 289: janitorul e apelabil din afara proprietarului'; end if;
  -- anon pastreaza EXECUTE pe suprafata publica
  if not has_function_privilege('anon', 'public.create_reservation_public(text,text,text,smallint,timestamptz,text,text,smallint,text,uuid,uuid)', 'execute')
     or not has_function_privilege('anon', 'public.get_tables_availability(text,timestamptz,timestamptz,smallint)', 'execute') then
    raise exception 'mig 289: suprafata publica de rezervare si-a pierdut grant-ul anon'; end if;
end $$;

commit;
