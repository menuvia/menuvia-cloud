-- mig 096A — Authorization Lockdown PR 1A (foundation)
--
-- Închide P0 înainte de fereastra de deployment 1A→1B:
--   • owner membership mutation guard (invariant-based, fără GUC bypass)
--   • restaurants.owner_id immutability trigger
--   • profiles column lockdown (plan / plan_expires_at / stripe_* REVOKE)
--   • invite_tokens role <> 'owner' (NOT VALID; VALIDATE în PR 1C)
--   • 4 RPC-uri SECURITY DEFINER pentru fluxul autorizat (create_restaurant,
--     change_member_role, remove_member, revoke_invite)
--   • preview_invite / accept_invite hardenate
--   • my_role / is_admin / is_member redefinite ca să folosească ÎN PRIMUL
--     RÂND restaurants.owner_id ca autoritate de owner; rolurile non-owner
--     citite din restaurant_memberships
--   • audit table append-only + inline structural assertion
--
-- Notă: 1A păstrează policy-urile mutation existente pe restaurants /
-- restaurant_memberships / invite_tokens (REVOKE-urile finale + drop policy
-- vin în PR 1B). În 1A, guard-ul BEFORE INSERT/UPDATE/DELETE pe
-- restaurant_memberships + CHECK NOT VALID pe invite_tokens închid efectiv
-- vectorii P0, fără a sparge fluxul legacy de creare a restaurantelor.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 1. Audit table append-only
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

comment on table public.security_ownership_remediations is
  'Append-only audit pentru remedierea ownership-ului împotriva '
  'restaurants/restaurant_memberships. Rolurile aplicației (anon, '
  'authenticated, service_role, public) au zero privilegii; DB owner '
  'și superuserul rămân administratori privilegiați.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 2. INLINE structural assertion pe audit table (production)
--   Conține: relkind=r, set exact de coloane + tipuri + nullability +
--   defaults (FULL OUTER JOIN simetric), PK exact pe (id), CHECK ticket
--   nonempty cu expresie semantic exactă, privilegii zero pentru rolurile
--   aplicației (table + column), PUBLIC zero prin aclexplode, owner trust.
-- ═══════════════════════════════════════════════════════════════════════════
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
    raise exception '096A audit shape: relation missing or not ordinary table (relkind=%)',
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
    raise exception '096A audit shape drift: %', v_drift;
  end if;

  -- PK exact pe (id), nume contractual *_pkey
  select count(*) into v_pk_count
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attname = 'id'
   and a.attnum > 0 and not a.attisdropped
  where c.conrelid = 'public.security_ownership_remediations'::regclass
    and c.contype = 'p'
    and c.conname = 'security_ownership_remediations_pkey'
    and c.conkey = array[a.attnum]::smallint[];
  if v_pk_count <> 1 then
    raise exception '096A audit shape: expected exactly one PK on (id) named *_pkey';
  end if;

  -- CHECK metadata + expresie semantic exactă (PG15/16 canonical form)
  --   pg_get_constraintdef la pg15/16 returnează 'CHECK ((btrim(ticket_reference) <> ''::text))'
  --   sau 'CHECK ((btrim(ticket_reference) <> ''''::text))' după escape.
  --   Normalizăm: lowercase, fără spații, fără paranteze redundante externe.
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
    raise exception '096A audit shape: ticket CHECK missing or NOT VALID';
  end if;
  if v_chk_def !~ '^check\(btrim\(ticket_reference\)<>''''(::text)?\)$' then
    raise exception '096A audit shape: ticket CHECK wrong expression: %', v_chk_def;
  end if;

  -- Privilegii zero pentru anon, authenticated, service_role
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if has_table_privilege(v_role, 'public.security_ownership_remediations',
         'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then
      raise exception '096A audit shape: % retains table privilege', v_role;
    end if;
    if has_any_column_privilege(v_role, 'public.security_ownership_remediations',
         'SELECT, INSERT, UPDATE, REFERENCES') then
      raise exception '096A audit shape: % retains column privilege', v_role;
    end if;
  end loop;

  -- PUBLIC prin aclexplode (grantee = 0) — neacoperit de has_*_privilege
  if exists (
    select 1 from pg_class c, aclexplode(c.relacl) ae
     where c.oid = 'public.security_ownership_remediations'::regclass
       and ae.grantee = 0
       and ae.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
  ) then
    raise exception '096A audit shape: PUBLIC retains table privilege';
  end if;
  if exists (
    select 1 from pg_attribute a, aclexplode(a.attacl) ae
     where a.attrelid = 'public.security_ownership_remediations'::regclass
       and a.attnum > 0 and not a.attisdropped
       and ae.grantee = 0
       and ae.privilege_type in ('SELECT','INSERT','UPDATE','REFERENCES')
  ) then
    raise exception '096A audit shape: PUBLIC retains column privilege';
  end if;

  -- Owner trust
  select pg_get_userbyid(c.relowner) into v_owner from pg_class c
   where c.oid = 'public.security_ownership_remediations'::regclass;
  if v_owner in ('anon','authenticated','service_role') then
    raise exception '096A audit shape: untrusted owner %', v_owner;
  end if;
end$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 3. invite_tokens: pre-check duplicate tokens + CHECK NOT VALID
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare v_dup int;
begin
  select count(*) into v_dup
  from (select token from public.invite_tokens
         where token is not null group by token having count(*) > 1) d;
  if v_dup > 0 then
    raise exception 'FAIL 096A: % duplicate invite tokens detected (pre-VALIDATE)', v_dup;
  end if;
end$$;

-- Constraint NOT VALID: nu scanează istoricul; aplică pentru toate INSERT/UPDATE
-- noi. VALIDATE în PR 1C după arhivarea istoricului owner-invite-uri.
alter table public.invite_tokens
  drop constraint if exists invite_tokens_role_not_owner;
alter table public.invite_tokens
  add constraint invite_tokens_role_not_owner
  check (role <> 'owner'::public.member_role) not valid;

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 4. profiles: P0 column lockdown (plan, plan_expires_at, stripe_*)
--   authenticated NU mai poate UPDATE coloanele sensibile; UPDATE pe coloane
--   non-sensibile (full_name, terms_*, deletion_requested_at) păstrate.
--   RLS policy `profiles_self` rămâne (gate la nivel de rând: auth.uid()=id).
-- ═══════════════════════════════════════════════════════════════════════════
revoke update on table public.profiles from authenticated;
grant  update (full_name, terms_accepted_at, terms_accepted_version,
               deletion_requested_at)
  on table public.profiles to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 5. restaurants: owner_id immutability + slug REVOKE
--   Triggerul fail-closed pentru orice UPDATE care schimbă owner_id (inclusiv
--   prin policy `restaurants_owner` care permite altfel FOR ALL la owner-ul
--   curent). Restaurarea ownership-ului se face exclusiv prin scriptul
--   administrativ apply_ownership_remediation.sql.
--   Coloana `slug` revocată UPDATE pentru `authenticated` — slug-ul devine
--   stabil după onboarding; mutarea slug-ului nu este parte din fluxul UI.
--   Coloana `owner_id` revocată UPDATE — defense in depth (triggerul prinde
--   oricum, dar privilegiul lipsește simetric cu slug).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_restaurants_owner_id_immutable()
returns trigger
language plpgsql
as $$
begin
  if NEW.owner_id is distinct from OLD.owner_id then
    raise exception
      using errcode = 'insufficient_privilege',
            message = 'restaurants.owner_id is immutable; use admin remediation script',
            hint    = 'guard:owner_id_immutable';
  end if;
  return NEW;
end$$;

revoke all on function public.fn_restaurants_owner_id_immutable()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_restaurants_owner_id_immutable on public.restaurants;
create trigger trg_restaurants_owner_id_immutable
  before update on public.restaurants
  for each row execute function public.fn_restaurants_owner_id_immutable();

-- Notă: în PostgreSQL, GRANT UPDATE la nivel de tabel acordă UPDATE pe toate
-- coloanele și nu poate fi „scăzut" cu REVOKE la nivel de coloană. Lockdown-ul
-- column-level (REVOKE UPDATE pe tabel + GRANT UPDATE pe lista whitelisted) se
-- face în PR 1B. În PR 1A, triggerul `trg_restaurants_owner_id_immutable` este
-- garanția pentru owner_id immutability; slug-ul rămâne UPDATE-able prin policy
-- până la 1B (UI nu îl atinge — vezi RESTAURANT_UPDATE_FIELDS).

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 6. restaurant_memberships guard: invariant-based, fără GUC bypass
--   Permite mutația când invarianții din DB state sunt satisfăcuți:
--     INSERT owner: NEW.user_id = restaurants.owner_id ∧ unic owner;
--     UPDATE: blocat dacă atinge role='owner' (în orice direcție);
--     DELETE owner: blocat, exceptând cascade-ul de la DELETE pe restaurants
--                   (detectat prin „restaurantul nu mai există în catalog").
--   Pentru remedierea administrativă se folosește
--     ALTER TABLE ... DISABLE TRIGGER trg_block_owner_membership_mutation;
--   sub locks stricte, în loc de un GUC caller-settable.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_block_owner_membership_mutation()
returns trigger
language plpgsql
as $$
declare
  v_restaurant_owner uuid;
  v_other_owners    int;
begin
  if TG_OP = 'INSERT' then
    if NEW.role <> 'owner'::public.member_role then
      return NEW;
    end if;
    select r.owner_id into v_restaurant_owner
      from public.restaurants r where r.id = NEW.restaurant_id;
    if not found then
      raise exception
        using errcode = 'insufficient_privilege',
              message = 'owner membership refers to a restaurant that does not exist',
              hint    = 'guard:trg_block_owner_membership_mutation';
    end if;
    if NEW.user_id is distinct from v_restaurant_owner then
      raise exception
        using errcode = 'insufficient_privilege',
              message = 'owner membership user_id must equal restaurants.owner_id',
              hint    = 'guard:trg_block_owner_membership_mutation';
    end if;
    select count(*) into v_other_owners
      from public.restaurant_memberships
     where restaurant_id = NEW.restaurant_id
       and role = 'owner'::public.member_role;
    if v_other_owners > 0 then
      raise exception
        using errcode = 'insufficient_privilege',
              message = 'restaurant already has an owner membership',
              hint    = 'guard:trg_block_owner_membership_mutation';
    end if;
    return NEW;

  elsif TG_OP = 'UPDATE' then
    if OLD.role = 'owner'::public.member_role
       or NEW.role = 'owner'::public.member_role then
      raise exception
        using errcode = 'insufficient_privilege',
              message = 'owner role cannot be changed via UPDATE on restaurant_memberships',
              hint    = 'guard:trg_block_owner_membership_mutation';
    end if;
    return NEW;

  elsif TG_OP = 'DELETE' then
    if OLD.role <> 'owner'::public.member_role then
      return OLD;
    end if;
    -- Allow cascade from restaurants DELETE: parent row not visible anymore.
    if not exists (select 1 from public.restaurants where id = OLD.restaurant_id) then
      return OLD;
    end if;
    raise exception
      using errcode = 'insufficient_privilege',
            message = 'owner membership cannot be deleted directly',
            hint    = 'guard:trg_block_owner_membership_mutation';
  end if;
  return null;
end$$;

revoke all on function public.fn_block_owner_membership_mutation()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_block_owner_membership_mutation on public.restaurant_memberships;
create trigger trg_block_owner_membership_mutation
  before insert or update or delete on public.restaurant_memberships
  for each row execute function public.fn_block_owner_membership_mutation();

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 7. my_role / is_admin / is_member ancorate pe restaurants.owner_id
--   Sursa de adevăr pentru owner = restaurants.owner_id; rolurile non-owner
--   = restaurant_memberships. Un owner membership „rătăcit" (forged sau stale)
--   nu mai conferă autoritate de owner.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.my_role(p_restaurant_id uuid)
returns public.member_role
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case
    when exists (
      select 1 from public.restaurants
       where id = p_restaurant_id and owner_id = auth.uid()
    ) then 'owner'::public.member_role
    else (
      select rm.role from public.restaurant_memberships rm
       where rm.restaurant_id = p_restaurant_id
         and rm.user_id = auth.uid()
         and rm.role <> 'owner'::public.member_role
       limit 1
    )
  end
$$;

create or replace function public.is_admin(p_restaurant_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.restaurants
     where id = p_restaurant_id and owner_id = auth.uid()
  ) or exists (
    select 1 from public.restaurant_memberships rm
     where rm.restaurant_id = p_restaurant_id
       and rm.user_id = auth.uid()
       and rm.role = 'manager'::public.member_role
  )
$$;

create or replace function public.is_member(p_restaurant_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.restaurants
     where id = p_restaurant_id and owner_id = auth.uid()
  ) or exists (
    select 1 from public.restaurant_memberships rm
     where rm.restaurant_id = p_restaurant_id
       and rm.user_id = auth.uid()
  )
$$;

revoke all on function public.my_role(uuid)   from public, anon, service_role;
revoke all on function public.is_admin(uuid)  from public, anon, service_role;
revoke all on function public.is_member(uuid) from public, anon, service_role;
grant execute on function public.my_role(uuid)   to authenticated;
grant execute on function public.is_admin(uuid)  to authenticated;
grant execute on function public.is_member(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 8. preview_invite (anon/authenticated) hardenat
--   • respinge token gol/invalid;
--   • respinge invite cu role='owner' (defense in depth — constraint NOT VALID
--     pe insert/update, dar preview ar fi trecut altfel pe rândurile istorice);
--   • expires_at NULL-safe.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.preview_invite(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_row record;
begin
  if p_token is null or btrim(p_token) = '' then
    return jsonb_build_object('status', 'invalid');
  end if;

  select it.email, it.role, it.accepted_at, it.expires_at, r.name as restaurant_name
    into v_row
    from public.invite_tokens it
    join public.restaurants r on r.id = it.restaurant_id
   where it.token = p_token
   limit 1;

  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v_row.role = 'owner'::public.member_role then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v_row.accepted_at is not null then
    return jsonb_build_object('status', 'used');
  end if;
  if v_row.expires_at is null or v_row.expires_at <= now() then
    return jsonb_build_object('status', 'expired');
  end if;

  return jsonb_build_object(
    'status',          'valid',
    'email',           v_row.email,
    'role',            v_row.role,
    'restaurant_name', v_row.restaurant_name,
    'expires_at',      v_row.expires_at
  );
end$$;

revoke all on function public.preview_invite(text)
  from public, service_role;
grant execute on function public.preview_invite(text) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 9. accept_invite hardenat
--   Branșe acoperite + invariants:
--     • auth required;                                           42501
--     • profile existence (auth.users join);                     42501
--     • invite found + row-level lock FOR UPDATE;
--     • role = 'owner' istoric           → respins                42501
--                                          (NU consumă invitația)
--     • already accepted                 → respins idempotent     ok=false
--     • expired                          → respins idempotent     ok=false
--     • email mismatch (IS DISTINCT FROM) → respins, NU consumă   ok=false
--     • membership existent same role    → consumă idempotent     ok=true
--     • membership existent ALT role     → respins, NU consumă    42501
--     • happy path                       → INSERT + consume + invited_by=NULL
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.accept_invite(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_email    text;
  v_invite   record;
  v_existing public.member_role;
begin
  if v_uid is null then
    raise exception using errcode = 'insufficient_privilege',
      message = 'accept_invite requires authentication';
  end if;

  -- Profile existence (email pentru email-binding null-safe).
  select u.email into v_email from auth.users u where u.id = v_uid;
  if v_email is null then
    raise exception using errcode = 'insufficient_privilege',
      message = 'unknown user';
  end if;

  select it.id, it.restaurant_id, it.email, it.role, it.accepted_at, it.expires_at
    into v_invite
    from public.invite_tokens it
   where it.token = p_token
   for update
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  -- Owner role istoric → niciodată acceptabilă; nu consumă invitația.
  if v_invite.role = 'owner'::public.member_role then
    raise exception using errcode = 'insufficient_privilege',
      message = 'owner role cannot be accepted via invite',
      hint = 'invite:owner_role_blocked';
  end if;

  if v_invite.accepted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_accepted',
                              'already_accepted', true);
  end if;

  if v_invite.expires_at is null or v_invite.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  -- Email-binding: null-safe; nu consumă invitația dacă utilizatorul nu se potrivește.
  if lower(v_invite.email) is distinct from lower(v_email) then
    return jsonb_build_object('ok', false, 'reason', 'email_mismatch');
  end if;

  -- Verificăm existența unui membership pe acel restaurant.
  select rm.role into v_existing
    from public.restaurant_memberships rm
   where rm.restaurant_id = v_invite.restaurant_id
     and rm.user_id = v_uid
   limit 1;

  if found then
    if v_existing = v_invite.role then
      -- Aceeași rol existent → marchează invitația acceptată idempotent.
      update public.invite_tokens set accepted_at = now() where id = v_invite.id;
      return jsonb_build_object('ok', true,
                                'restaurant_id', v_invite.restaurant_id,
                                'role', v_invite.role,
                                'already_member', true);
    else
      -- Alt rol existent → respins; NU consumă invitația.
      raise exception using errcode = 'insufficient_privilege',
        message = 'user already has a different role on this restaurant',
        hint = 'invite:role_conflict';
    end if;
  end if;

  -- Happy path: INSERT membership + consume invite.
  insert into public.restaurant_memberships (restaurant_id, user_id, role, invited_by)
  values (v_invite.restaurant_id, v_uid, v_invite.role, null);

  update public.invite_tokens set accepted_at = now() where id = v_invite.id;

  return jsonb_build_object('ok', true,
                            'restaurant_id', v_invite.restaurant_id,
                            'role', v_invite.role);
end$$;

revoke all on function public.accept_invite(text)
  from public, anon, service_role;
grant execute on function public.accept_invite(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 10. create_restaurant — bootstrap-trigger-friendly
--   Inserează DOAR restaurantul (cu owner_id=auth.uid()). Triggerul existent
--   `restaurants_bootstrap_owner_membership` se ocupă de INSERT-ul în
--   restaurant_memberships role='owner'. Guard-ul nostru BEFORE INSERT
--   validează invariantul: NEW.user_id = restaurants.owner_id ∧ unic.
-- ═══════════════════════════════════════════════════════════════════════════
drop function if exists public.create_restaurant(text, text, text, text);
create function public.create_restaurant(
  p_name text,
  p_city text default null,
  p_slug text default null,
  p_primary_color text default '#C8963C'
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_id   uuid;
  v_slug text;
begin
  if v_uid is null then
    raise exception using errcode = 'insufficient_privilege',
      message = 'create_restaurant requires authentication';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception using errcode = 'check_violation', message = 'name is required';
  end if;

  v_slug := coalesce(nullif(btrim(p_slug), ''),
                     regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'));
  v_slug := btrim(v_slug, '-');
  if v_slug = '' then
    v_slug := 'r-' || substring(gen_random_uuid()::text, 1, 8);
  end if;
  while exists (select 1 from public.restaurants where slug = v_slug) loop
    v_slug := v_slug || '-' || substring(gen_random_uuid()::text, 1, 4);
  end loop;

  insert into public.restaurants (owner_id, name, city, slug, primary_color)
  values (v_uid, btrim(p_name), nullif(btrim(p_city), ''), v_slug, p_primary_color)
  returning id into v_id;
  -- restaurants_bootstrap_owner_membership AFTER INSERT face owner membership;
  -- trg_block_owner_membership_mutation BEFORE INSERT verifică invariantul.

  return jsonb_build_object('ok', true,
                            'restaurant_id', v_id,
                            'restaurant_slug', v_slug);
end$$;

revoke all on function public.create_restaurant(text, text, text, text)
  from public, anon, service_role;
grant execute on function public.create_restaurant(text, text, text, text)
  to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 11. change_member_role
--   • auth required;
--   • new_role required, NEVER 'owner';
--   • current row role NEVER 'owner' (nu degradăm owner-ul aici);
--   • caller must be admin pe restaurantul țintă.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.change_member_role(
  p_membership_id uuid,
  p_new_role public.member_role
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_rm  record;
begin
  if v_uid is null then
    raise exception using errcode = 'insufficient_privilege',
      message = 'change_member_role requires authentication';
  end if;
  if p_new_role is null then
    raise exception using errcode = 'check_violation', message = 'new role required';
  end if;
  if p_new_role = 'owner'::public.member_role then
    raise exception using errcode = 'check_violation',
      message = 'change_member_role cannot promote to owner';
  end if;

  select rm.id, rm.restaurant_id, rm.user_id, rm.role
    into v_rm
    from public.restaurant_memberships rm
   where rm.id = p_membership_id
   for update;
  if not found then
    raise exception using errcode = 'no_data_found', message = 'membership not found';
  end if;
  if v_rm.role = 'owner'::public.member_role then
    raise exception using errcode = 'check_violation',
      message = 'cannot demote owner via change_member_role';
  end if;
  if not public.is_admin(v_rm.restaurant_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'not an admin';
  end if;

  update public.restaurant_memberships
     set role = p_new_role
   where id = p_membership_id;

  return jsonb_build_object('ok', true,
                            'membership_id', p_membership_id,
                            'role', p_new_role);
end$$;

revoke all on function public.change_member_role(uuid, public.member_role)
  from public, anon, service_role;
grant execute on function public.change_member_role(uuid, public.member_role)
  to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 12. remove_member
--   Nu poate elimina owner-ul. Admin only.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.remove_member(p_membership_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_rm  record;
begin
  if v_uid is null then
    raise exception using errcode = 'insufficient_privilege',
      message = 'remove_member requires authentication';
  end if;

  select rm.id, rm.restaurant_id, rm.user_id, rm.role
    into v_rm
    from public.restaurant_memberships rm
   where rm.id = p_membership_id
   for update;
  if not found then
    raise exception using errcode = 'no_data_found', message = 'membership not found';
  end if;
  if v_rm.role = 'owner'::public.member_role then
    raise exception using errcode = 'check_violation',
      message = 'cannot remove owner via remove_member';
  end if;
  if not public.is_admin(v_rm.restaurant_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'not an admin';
  end if;

  delete from public.restaurant_memberships where id = p_membership_id;

  return jsonb_build_object('ok', true, 'membership_id', p_membership_id);
end$$;

revoke all on function public.remove_member(uuid)
  from public, anon, service_role;
grant execute on function public.remove_member(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 13. revoke_invite — admin-only, pre-acceptance
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.revoke_invite(p_invite_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_inv record;
begin
  if v_uid is null then
    raise exception using errcode = 'insufficient_privilege',
      message = 'revoke_invite requires authentication';
  end if;

  select it.id, it.restaurant_id, it.accepted_at
    into v_inv
    from public.invite_tokens it
   where it.id = p_invite_id
   for update;
  if not found then
    raise exception using errcode = 'no_data_found', message = 'invite not found';
  end if;
  if v_inv.accepted_at is not null then
    raise exception using errcode = 'check_violation',
      message = 'cannot revoke an already-accepted invite';
  end if;
  if not public.is_admin(v_inv.restaurant_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'not an admin';
  end if;

  delete from public.invite_tokens where id = p_invite_id;

  return jsonb_build_object('ok', true, 'invite_id', p_invite_id);
end$$;

revoke all on function public.revoke_invite(uuid)
  from public, anon, service_role;
grant execute on function public.revoke_invite(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Sec 14. Phase-1A inline smoke (înainte de COMMIT). Set-ul complet stă în
--   tests/sql/authorization_phase_1a_assertions.sql.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare v_v boolean; v_t int;
begin
  select c.convalidated into v_v from pg_constraint c
   where c.conrelid = 'public.invite_tokens'::regclass
     and c.conname  = 'invite_tokens_role_not_owner';
  if not found then raise exception '096A FAIL: invite_tokens CHECK missing'; end if;
  if v_v then raise exception '096A FAIL: CHECK should remain NOT VALID until PR 1C'; end if;

  select t.tgtype into v_t from pg_trigger t
   where t.tgrelid = 'public.restaurant_memberships'::regclass
     and t.tgname = 'trg_block_owner_membership_mutation'
     and not t.tgisinternal
     and t.tgenabled in ('O','A')
     and t.tgfoid = 'public.fn_block_owner_membership_mutation()'::regprocedure;
  if not found then raise exception '096A FAIL: guard trigger missing/disabled'; end if;
  -- tgtype = ROW(1) | BEFORE(2) | INSERT(4) | DELETE(8) | UPDATE(16) = 31
  if v_t <> 31 then raise exception '096A FAIL: guard tgtype=% expected 31', v_t; end if;
end$$;

commit;
