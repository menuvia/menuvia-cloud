-- Drift 09: default greșit pe applied_at (current_timestamp în loc de now()).
begin;
create schema audit_drift_09;
create table audit_drift_09.t (
  id uuid not null default gen_random_uuid(),
  applied_at timestamptz not null default current_timestamp,  -- DRIFT
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
revoke all on table audit_drift_09.t from public, anon, authenticated, service_role;
do $$
begin
  begin
    perform public.assert_security_audit_shape('audit_drift_09.t');
    raise exception 'DRIFT 09 FAIL: current_timestamp default accepted';
  exception
    when sqlstate 'P0001' then
      if sqlerrm !~ 'col=applied_at' then
        raise exception 'DRIFT 09 FAIL: wrong message: %', sqlerrm;
      end if;
  end;
end$$;
rollback;
