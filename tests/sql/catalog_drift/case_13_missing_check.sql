-- Drift 13: CHECK ticket lipsă.
begin;
create schema audit_drift_13;
create table audit_drift_13.t (
  id uuid not null default gen_random_uuid(),
  applied_at timestamptz not null default now(),
  db_session_user name not null default session_user,
  restaurant_id uuid not null,
  observed_owner_id uuid,
  observed_owner_members uuid[] not null,
  final_owner_id uuid not null,
  ticket_reference text not null,
  notes text,
  constraint t_pkey primary key (id)
  -- t_ticket_nonempty omis
);
revoke all on table audit_drift_13.t from public, anon, authenticated, service_role;
do $$
begin
  begin
    perform public.assert_security_audit_shape('audit_drift_13.t');
    raise exception 'DRIFT 13 FAIL: missing CHECK accepted';
  exception
    when sqlstate 'P0001' then
      if sqlerrm !~ 'ticket CHECK missing or NOT VALID' then
        raise exception 'DRIFT 13 FAIL: wrong message: %', sqlerrm;
      end if;
  end;
end$$;
rollback;
