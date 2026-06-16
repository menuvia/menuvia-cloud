-- scripts/apply_ownership_remediation.sql
--
-- ADMINISTRATIVE remediation script. Rulat MANUAL de operator (DBA), NU în
-- CI sau pe deploy. Cere un input aprobat (per linie: ticket + restaurant_id
-- + final_owner_id + observed_owner_id + observed_owner_members snapshot)
-- și aplică modificarea atomic sub locks stricte, cu CAS verification,
-- invariant local + global, audit INSERT cu count assertion, și revenire
-- la guard active înainte de invariant checks.
--
-- Designul de securitate:
--   • Nu există GUC caller-settable de bypass (V9.12 #1).
--   • Bypass-ul guard-urilor este per-trigger, sub lock, în aceeași tranzacție:
--       ALTER TABLE … DISABLE TRIGGER trg_block_owner_membership_mutation
--       ALTER TABLE … DISABLE TRIGGER trg_restaurants_owner_id_immutable
--     Re-enable-ul se face ÎNAINTE de invariant checks ca aceste să ruleze
--     împotriva guard-urilor active (fail-safe).
--   • NU se folosește session_replication_role = 'replica' (V9.12 #6).
--   • Există un singur `ON CONFLICT DO UPDATE`, justificat de comentariul de mai
--     jos — restul codului este zero-upsert.
--
-- Workflow:
--   1. Operator rulează `scripts/report_ownership_anomalies.sql` și identifică
--      restaurantele cu anomalii (A, B, C).
--   2. Pentru fiecare anomalie, operator obține:
--        ticket_reference (ex: 'SEC-2026-042'),
--        restaurant_id,
--        final_owner_id (ID-ul corect al owner-ului per ticket),
--        observed_owner_id (current restaurants.owner_id, pentru CAS),
--        observed_owner_members (current set de owner memberships, sortat).
--   3. Operator copiază TEMPLATE-ul de INSERT INTO approved_input și
--      completează valorile. Templates sunt în secțiunea „INSERT TEMPLATES" mai jos.
--   4. Operator rulează scriptul. Dacă CAS-ul detectează modificare a
--      stării între report și apply, scriptul abort-ează fără modificări.
--
-- Idempotent față de tabela de audit (CREATE IF NOT EXISTS); restul este
-- pur atomic într-o tranzacție.

\set ON_ERROR_STOP on

-- ═══════════════════════════════════════════════════════════════════════════
-- Pre-tranzacție: tabela audit există + privilegii revocate.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.security_ownership_remediations (
  id                     uuid        not null default gen_random_uuid(),
  applied_at             timestamptz not null default now(),
  db_session_user        name        not null default session_user,
  restaurant_id          uuid        not null,
  observed_owner_id      uuid,
  observed_owner_members uuid[]      not null,
  final_owner_id         uuid        not null,
  ticket_reference       text        not null,
  notes                  text,
  constraint security_ownership_remediations_pkey
    primary key (id),
  constraint security_ownership_remediations_ticket_nonempty
    check (btrim(ticket_reference) <> '')
);
revoke all on table public.security_ownership_remediations
  from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Tranzacție administrativă: lock-order strict + verificări + apply + audit.
-- ═══════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout      = '10s';
set local statement_timeout = '60s';

-- Lock order: restaurants → restaurant_memberships → audit.
lock table public.restaurants                in share row exclusive mode;
lock table public.restaurant_memberships     in share row exclusive mode;
lock table public.security_ownership_remediations in share row exclusive mode;

-- ─── INLINE structural assertion pe audit table ─────────────────────────────
-- (Text identic cu Sec 2 din 20260615000000_migration_096a_authorization_foundation.sql;
--  păstrat inline aici pentru ca scriptul administrativ să NU depindă de un helper.)
do $$
declare
  v_rel_kind  "char";
  v_drift     text;
  v_pk_count  int;
  v_chk_count int;
  v_chk_def   text;
  v_owner     text;
  v_role      text;
begin
  select c.relkind into v_rel_kind from pg_class c
   where c.oid = 'public.security_ownership_remediations'::regclass;
  if v_rel_kind is null or v_rel_kind <> 'r' then
    raise exception 'REMEDIATION audit shape: relation missing or not ordinary table (relkind=%)',
      coalesce(v_rel_kind::text, 'NULL');
  end if;

  with expected (col, typ, is_notnull, default_pattern) as (values
    ('id',                     'uuid',                       true,  '^gen_random_uuid\(\)$'),
    ('applied_at',             'timestamp with time zone',   true,  '^now\(\)$'),
    ('db_session_user',        'name',                       true,  '^session_user$'),
    ('restaurant_id',          'uuid',                       true,  null::text),
    ('observed_owner_id',      'uuid',                       false, null::text),
    ('observed_owner_members', 'uuid[]',                     true,  null::text),
    ('final_owner_id',         'uuid',                       true,  null::text),
    ('ticket_reference',       'text',                       true,  null::text),
    ('notes',                  'text',                       false, null::text)
  ),
  actual as (
    select a.attname as col,
           format_type(a.atttypid, a.atttypmod) as typ,
           a.attnotnull as is_notnull,
           lower(regexp_replace(pg_get_expr(ad.adbin, ad.adrelid, false),
                                '[[:space:]]+', '', 'g')) as default_expr
    from pg_attribute a
    left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
    where a.attrelid = 'public.security_ownership_remediations'::regclass
      and a.attnum > 0 and not a.attisdropped
  )
  select string_agg(format('col=%s exp(typ=%s,nn=%s,def=%s,present=%s) act(typ=%s,nn=%s,def=%s,present=%s)',
           coalesce(e.col, a.col), e.typ, e.is_notnull, e.default_pattern, e.col is not null,
           a.typ, a.is_notnull, a.default_expr, a.col is not null), '; ')
  into v_drift
  from expected e full outer join actual a using (col)
  where e.col is null or a.col is null
     or e.typ <> a.typ or e.is_notnull <> a.is_notnull
     or (e.default_pattern is null and a.default_expr is not null)
     or (e.default_pattern is not null
         and (a.default_expr is null or a.default_expr !~ e.default_pattern));
  if v_drift is not null then
    raise exception 'REMEDIATION audit shape drift: %', v_drift;
  end if;

  select count(*) into v_pk_count
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attname = 'id'
   and a.attnum > 0 and not a.attisdropped
  where c.conrelid = 'public.security_ownership_remediations'::regclass
    and c.contype = 'p'
    and c.conname = 'security_ownership_remediations_pkey'
    and c.conkey = array[a.attnum]::smallint[];
  if v_pk_count <> 1 then
    raise exception 'REMEDIATION audit shape: expected exactly one PK on (id) named *_pkey';
  end if;

  select count(*),
         max(regexp_replace(
               lower(regexp_replace(pg_get_constraintdef(c.oid, true),
                                    '[[:space:]]+', '', 'g')),
               '^check\(\((.*)\)\)$', 'check(\1)'))
    into v_chk_count, v_chk_def
  from pg_constraint c
  where c.conrelid = 'public.security_ownership_remediations'::regclass
    and c.conname  = 'security_ownership_remediations_ticket_nonempty'
    and c.contype  = 'c' and c.convalidated;
  if v_chk_count <> 1 then
    raise exception 'REMEDIATION audit shape: ticket CHECK missing or NOT VALID';
  end if;
  if v_chk_def !~ '^check\(btrim\(ticket_reference\)<>''''(::text)?\)$' then
    raise exception 'REMEDIATION audit shape: ticket CHECK wrong expression: %', v_chk_def;
  end if;

  select pg_get_userbyid(c.relowner) into v_owner from pg_class c
   where c.oid = 'public.security_ownership_remediations'::regclass;
  if v_owner in ('anon','authenticated','service_role') then
    raise exception 'REMEDIATION audit shape: untrusted owner %', v_owner;
  end if;

  foreach v_role in array array['anon','authenticated','service_role'] loop
    if has_table_privilege(v_role, 'public.security_ownership_remediations',
         'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then
      raise exception 'REMEDIATION audit shape: % retains table privilege', v_role;
    end if;
    if has_any_column_privilege(v_role, 'public.security_ownership_remediations',
         'SELECT, INSERT, UPDATE, REFERENCES') then
      raise exception 'REMEDIATION audit shape: % retains column privilege', v_role;
    end if;
  end loop;
  if exists (select 1 from pg_class c, aclexplode(c.relacl) ae
              where c.oid = 'public.security_ownership_remediations'::regclass
                and ae.grantee = 0 and ae.privilege_type in
                  ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')) then
    raise exception 'REMEDIATION audit shape: PUBLIC retains table privilege';
  end if;
end$$;

-- ─── Approved input table (temp, ON COMMIT DROP) ────────────────────────────
create temp table approved_input (
  restaurant_id          uuid    not null,
  final_owner_id         uuid    not null,
  observed_owner_id      uuid,
  observed_owner_members uuid[]  not null,
  ticket_reference       text    not null,
  notes                  text
) on commit drop;

-- ═══════════════════════════════════════════════════════════════════════════
-- INSERT TEMPLATES — operator: decomentează și completează cu valori reale.
--
-- Pentru ANOMALY A (owner orfan: owner_id fără membership):
--   observed_owner_members = '{}' (array gol).
-- insert into approved_input (restaurant_id, final_owner_id, observed_owner_id,
--                              observed_owner_members, ticket_reference, notes)
-- values (
--   '00000000-0000-0000-0000-000000000000'::uuid,  -- restaurant_id
--   '00000000-0000-0000-0000-000000000000'::uuid,  -- final_owner_id
--   '00000000-0000-0000-0000-000000000000'::uuid,  -- observed_owner_id (current restaurants.owner_id)
--   '{}'::uuid[],                                  -- observed_owner_members (current set, sortat)
--   'SEC-2026-NNN',                                -- ticket_reference
--   'Anomaly A: orphan owner_id remediated to canonical membership'
-- );
--
-- Pentru ANOMALY B (owner multiplu: >1 membership cu role=owner):
--   observed_owner_members = sorted array al user_id-urilor curente cu role=owner.
-- insert into approved_input (...)
-- values (
--   '<restaurant_id>'::uuid,
--   '<final_owner_id>'::uuid,                       -- ID-ul corect per ticket
--   '<observed_owner_id>'::uuid,                    -- restaurants.owner_id curent
--   array['<u1>','<u2>']::uuid[],                   -- sortați ascendent
--   'SEC-2026-NNN',
--   'Anomaly B: collapsed multiple owner memberships to canonical'
-- );
--
-- Pentru ANOMALY C (owner inconsistent: membership.user_id ≠ restaurants.owner_id):
--   observed_owner_id ≠ observed_owner_members[1].
-- (same template structure as above)
-- ═══════════════════════════════════════════════════════════════════════════

-- ↓↓↓ OPERATOR INSERTS — decomentează rândurile de mai jos ↓↓↓
-- (Nicio modificare nu se aplică dacă approved_input rămâne gol — CAS-ul va
--  rula peste zero rânduri, apply-ul peste zero rânduri, audit-ul va inserta 0.
--  Asta înseamnă că un rulaj „dry-run" cu zero input nu face nimic dăunător.)



-- ↑↑↑ OPERATOR INSERTS ↑↑↑

-- ─── Input validation ──────────────────────────────────────────────────────
do $$
declare v_blank int;
begin
  select count(*) into v_blank from approved_input where btrim(ticket_reference) = '';
  if v_blank > 0 then
    raise exception 'REMEDIATION INPUT FAIL: % rows have blank ticket_reference', v_blank;
  end if;
end$$;

-- ─── CAS verification (compare-and-swap) ───────────────────────────────────
-- Pentru fiecare rând în approved_input, verificăm că starea actuală a
-- DB-ului se potrivește cu snapshot-ul `observed_*`. Dacă cineva a modificat
-- între report și apply, abort.
do $$
declare
  r record;
  v_actual_owner   uuid;
  v_actual_members uuid[];
  v_observed_sorted uuid[];
begin
  for r in select * from approved_input loop
    -- owner_id curent
    select owner_id into v_actual_owner
      from public.restaurants where id = r.restaurant_id;
    if v_actual_owner is distinct from r.observed_owner_id then
      raise exception 'REMEDIATION CAS FAIL on restaurant %: observed_owner_id=% but current=%',
        r.restaurant_id, r.observed_owner_id, v_actual_owner;
    end if;

    -- set sortat de owner memberships curent
    select coalesce(array_agg(user_id order by user_id), '{}'::uuid[])
      into v_actual_members
      from public.restaurant_memberships
     where restaurant_id = r.restaurant_id and role = 'owner';

    -- sortăm observed pentru comparație canonică (array_eq depinde de ordine)
    select coalesce(array_agg(x order by x), '{}'::uuid[])
      into v_observed_sorted
      from unnest(r.observed_owner_members) x;

    if v_actual_members is distinct from v_observed_sorted then
      raise exception 'REMEDIATION CAS FAIL on restaurant %: owner_members mismatch (observed=%, current=%)',
        r.restaurant_id, v_observed_sorted, v_actual_members;
    end if;
  end loop;
end$$;

-- ─── Apply: disable guard + immutability triggers, mutate, re-enable ───────
-- (Bypass per-trigger, NU global session_replication_role.)
alter table public.restaurant_memberships
  disable trigger trg_block_owner_membership_mutation;
alter table public.restaurants
  disable trigger trg_restaurants_owner_id_immutable;

do $$
declare r record;
begin
  for r in select * from approved_input loop
    -- 1. Actualizează restaurants.owner_id la final_owner_id.
    update public.restaurants set owner_id = r.final_owner_id where id = r.restaurant_id;

    -- 2. Șterge owner memberships care nu sunt cele canonice (final_owner_id).
    delete from public.restaurant_memberships
     where restaurant_id = r.restaurant_id
       and role = 'owner'::public.member_role
       and user_id <> r.final_owner_id;

    -- 3. UNICUL ON CONFLICT DO UPDATE din întreaga aplicație (justificat aici:
    --    sub lock, sub trigger disable, CAS validat, input operator aprobat,
    --    audit atomic; restul codului rămâne strict zero-upsert).
    insert into public.restaurant_memberships (restaurant_id, user_id, role)
    values (r.restaurant_id, r.final_owner_id, 'owner'::public.member_role)
    on conflict (restaurant_id, user_id) do update
      set role = excluded.role;
  end loop;
end$$;

-- Re-enable guards ÎNAINTE de invariant checks. Asta forțează verificarea
-- finală cu guard-urile active — un eventual reziduu nereparat trebuie să fie
-- vizibil sub guard-uri, nu sub bypass.
alter table public.restaurant_memberships
  enable trigger trg_block_owner_membership_mutation;
alter table public.restaurants
  enable trigger trg_restaurants_owner_id_immutable;

-- ─── Invariant local (per restaurantul remediat) ───────────────────────────
do $$
declare r record; v_owner_count int; v_aligned int;
begin
  for r in select * from approved_input loop
    select count(*) into v_owner_count
      from public.restaurant_memberships
     where restaurant_id = r.restaurant_id and role = 'owner'::public.member_role;
    if v_owner_count <> 1 then
      raise exception 'REMEDIATION LOCAL INVARIANT FAIL: restaurant % has % owner memberships',
        r.restaurant_id, v_owner_count;
    end if;

    select count(*) into v_aligned
      from public.restaurant_memberships rm
      join public.restaurants rest on rest.id = rm.restaurant_id
     where rm.restaurant_id = r.restaurant_id
       and rm.role = 'owner'::public.member_role
       and rm.user_id is not distinct from rest.owner_id;
    if v_aligned <> 1 then
      raise exception 'REMEDIATION LOCAL INVARIANT FAIL: restaurant % owner membership ≠ restaurants.owner_id',
        r.restaurant_id;
    end if;
  end loop;
end$$;

-- ─── Invariant global (toate restaurantele DB-ului) ────────────────────────
-- Toate restaurantele trebuie să aibă exact 1 owner membership aliniat cu
-- restaurants.owner_id. Dacă există orice anomalie reziduală în DB
-- (chiar pe restaurante neincluse în approved_input), scriptul abort-ează.
do $$
declare v_anomalies int;
begin
  -- Anomalie globală = oricare:
  --   (a) restaurant fără exact 1 owner membership, sau
  --   (b) singurul owner membership are user_id ≠ restaurants.owner_id.
  select count(*) into v_anomalies
  from public.restaurants rest
  where (
    select count(*) from public.restaurant_memberships rm
     where rm.restaurant_id = rest.id and rm.role = 'owner'::public.member_role
  ) <> 1
     or not exists (
       select 1 from public.restaurant_memberships rm
        where rm.restaurant_id = rest.id
          and rm.role = 'owner'::public.member_role
          and rm.user_id = rest.owner_id
     );
  if v_anomalies > 0 then
    raise exception 'REMEDIATION GLOBAL INVARIANT FAIL: % restaurants still have inconsistent owner state',
      v_anomalies;
  end if;
end$$;

-- ─── Audit INSERT atomic + count assertion via ROW_COUNT diagnostic ─────────
do $$
declare v_inserted int; v_expected int;
begin
  select count(*) into v_expected from approved_input;

  insert into public.security_ownership_remediations (
    restaurant_id, observed_owner_id, observed_owner_members,
    final_owner_id, ticket_reference, notes
  )
  select restaurant_id, observed_owner_id, observed_owner_members,
         final_owner_id, ticket_reference, notes
  from approved_input;

  get diagnostics v_inserted = ROW_COUNT;
  if v_inserted <> v_expected then
    raise exception 'REMEDIATION AUDIT FAIL: expected % audit rows, inserted %',
      v_expected, v_inserted;
  end if;

  raise notice 'REMEDIATION SUCCESS: % remediation(s) applied and audited atomically',
    v_inserted;
end$$;

commit;
