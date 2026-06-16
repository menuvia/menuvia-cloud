-- Drift 10: PK lipsă.
begin;
create schema audit_drift_10;
create table audit_drift_10.t (
  id uuid not null default gen_random_uuid(),
  applied_at timestamptz not null default now(),
  db_session_user name not null default session_user,
  restaurant_id uuid not null,
  observed_owner_id uuid,
  observed_owner_members uuid[] not null,
  final_owner_id uuid not null,
  ticket_reference text not null,
  notes text,
  -- PK omis
  constraint t_ticket_nonempty check (btrim(ticket_reference) <> '')
);
revoke all on table audit_drift_10.t from public, anon, authenticated, service_role;
do $$
begin
  begin
    perform public.assert_security_audit_shape('audit_drift_10.t');
    raise exception 'DRIFT 10 FAIL: missing PK accepted';
  exception
    when sqlstate 'P0001' then
      if sqlerrm !~ 'PK on \(id\) named' then
        raise exception 'DRIFT 10 FAIL: wrong message: %', sqlerrm;
      end if;
  end;
end$$;
rollback;
