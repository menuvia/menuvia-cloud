-- tests/sql/helpers/assert_security_audit_shape.sql
--
-- CI-only helper, parameterized cu p_relation_name text (not regclass — so it
-- can be called with a non-existent name and reject explicitly via to_regclass
-- returning NULL).
--
-- Implementează aceeași logică ca assertion-ul inline din 096A Sec 2:
--   relkind=r, set exact de coloane + tipuri + nullability + defaults
--   (FULL OUTER JOIN simetric), PK exact pe (id) cu nume contractual *_pkey,
--   CHECK metadata + expresie semantic exactă (PG15-safe), privilegii zero
--   pentru anon/authenticated/service_role, PUBLIC zero prin aclexplode,
--   owner trust.
--
-- Drop-uit la finalul drift step-ului din sql-verify.yml.

create or replace function public.assert_security_audit_shape(p_relation_name text)
returns void
language plpgsql
as $$
declare
  v_rel       regclass := to_regclass(p_relation_name);
  v_rel_kind  "char";
  v_drift     text;
  v_pk_count  int;
  v_chk_count int;
  v_chk_def   text;
  v_owner     text;
  v_role      text;
  v_relname   text;
begin
  if v_rel is null then
    raise exception 'audit shape: relation % missing', p_relation_name;
  end if;

  select c.relkind, c.relname into v_rel_kind, v_relname
  from pg_class c where c.oid = v_rel;
  if v_rel_kind <> 'r' then
    raise exception 'audit shape: % not an ordinary table (relkind=%)', p_relation_name, v_rel_kind;
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
    where a.attrelid = v_rel
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
    raise exception 'audit shape: % schema drift: %', p_relation_name, v_drift;
  end if;

  -- PK exact (id), nume contractual <relname>_pkey
  select count(*) into v_pk_count
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attname = 'id'
   and a.attnum > 0 and not a.attisdropped
  where c.conrelid = v_rel
    and c.contype = 'p'
    and c.conname = v_relname || '_pkey'
    and c.conkey = array[a.attnum]::smallint[];
  if v_pk_count <> 1 then
    raise exception 'audit shape: % expected PK on (id) named %_pkey', p_relation_name, v_relname;
  end if;

  -- CHECK ticket nonempty (validated) + expresie semantic exactă PG15-safe
  select count(*),
         max(regexp_replace(
               lower(regexp_replace(pg_get_constraintdef(c.oid, true),
                                    '[[:space:]]+', '', 'g')),
               '^check\(\((.*)\)\)$', 'check(\1)'))
  into v_chk_count, v_chk_def
  from pg_constraint c
  where c.conrelid = v_rel
    and c.conname  = v_relname || '_ticket_nonempty'
    and c.contype  = 'c' and c.convalidated;
  if v_chk_count <> 1 then
    raise exception 'audit shape: % ticket CHECK missing or NOT VALID', p_relation_name;
  end if;
  if v_chk_def !~ '^check\(btrim\(ticket_reference\)<>''''(::text)?\)$' then
    raise exception 'audit shape: % ticket CHECK wrong expression: %', p_relation_name, v_chk_def;
  end if;

  -- Owner trust (verificat ÎNAINTE de privilegii: dacă un rol al aplicației
  -- deține tabela, are toate privilegiile prin proprietate, ceea ce ar masca
  -- semnalul exact al owner-trust-ului).
  select pg_get_userbyid(c.relowner) into v_owner from pg_class c where c.oid = v_rel;
  if v_owner in ('anon','authenticated','service_role') then
    raise exception 'audit shape: % untrusted owner %', p_relation_name, v_owner;
  end if;

  -- Privilegii zero: anon, authenticated, service_role (table + column)
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if has_table_privilege(v_role, v_rel,
         'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then
      raise exception 'audit shape: % retains table privilege on %', v_role, p_relation_name;
    end if;
    if has_any_column_privilege(v_role, v_rel,
         'SELECT, INSERT, UPDATE, REFERENCES') then
      raise exception 'audit shape: % retains column privilege on %', v_role, p_relation_name;
    end if;
  end loop;

  -- PUBLIC prin aclexplode (grantee = 0)
  if exists (
    select 1 from pg_class c, aclexplode(c.relacl) ae
     where c.oid = v_rel and ae.grantee = 0
       and ae.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
  ) then
    raise exception 'audit shape: % PUBLIC retains table privilege', p_relation_name;
  end if;
  if exists (
    select 1 from pg_attribute a, aclexplode(a.attacl) ae
     where a.attrelid = v_rel and a.attnum > 0 and not a.attisdropped
       and ae.grantee = 0
       and ae.privilege_type in ('SELECT','INSERT','UPDATE','REFERENCES')
  ) then
    raise exception 'audit shape: % PUBLIC retains column privilege', p_relation_name;
  end if;
end$$;

revoke all on function public.assert_security_audit_shape(text)
  from public, anon, authenticated, service_role;
