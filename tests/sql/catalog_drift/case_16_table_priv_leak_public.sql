-- Drift 16: privilege leak la PUBLIC pe SELECT (acoperă aclexplode + effective).
begin;
create schema audit_drift_16;
create table audit_drift_16.t (
  id uuid not null default gen_random_uuid(),
  applied_at timestamptz not null default now(),
  db_session_user name not null default session_user,
  restaurant_id uuid not null,
  observed_owner_id uuid,
  observed_owner_members uuid[] not null,
  final_owner_id uuid not null,
  ticket_reference text not null,
  notes text,
  constraint t_pkey primary key (id),
  constraint t_ticket_nonempty check (btrim(ticket_reference) <> '')
);
revoke all on table audit_drift_16.t from public, anon, authenticated, service_role;
grant select on table audit_drift_16.t to public;  -- DRIFT
do $$
begin
  begin
    perform public.assert_security_audit_shape('audit_drift_16.t');
    raise exception 'DRIFT 16 FAIL: PUBLIC SELECT grant accepted';
  exception
    when sqlstate 'P0001' then
      if sqlerrm !~ 'retains table privilege|PUBLIC retains table privilege' then
        raise exception 'DRIFT 16 FAIL: wrong message: %', sqlerrm;
      end if;
  end;
end$$;
rollback;
