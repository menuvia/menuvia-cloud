-- Drift 12: PK cu nume greșit (t_pk în loc de t_pkey).
begin;
create schema audit_drift_12;
create table audit_drift_12.t (
  id uuid not null default gen_random_uuid(),
  applied_at timestamptz not null default now(),
  db_session_user name not null default session_user,
  restaurant_id uuid not null,
  observed_owner_id uuid,
  observed_owner_members uuid[] not null,
  final_owner_id uuid not null,
  ticket_reference text not null,
  notes text,
  constraint t_pk primary key (id),  -- DRIFT: nume nu se termină în _pkey
  constraint t_ticket_nonempty check (btrim(ticket_reference) <> '')
);
revoke all on table audit_drift_12.t from public, anon, authenticated, service_role;
do $$
begin
  begin
    perform public.assert_security_audit_shape('audit_drift_12.t');
    raise exception 'DRIFT 12 FAIL: wrong PK name accepted';
  exception
    when sqlstate 'P0001' then
      if sqlerrm !~ 'PK on \(id\) named' then
        raise exception 'DRIFT 12 FAIL: wrong message: %', sqlerrm;
      end if;
  end;
end$$;
rollback;
