-- Drift 14: CHECK cu nume corect dar expresie greșită (length > 3 în loc de btrim).
begin;
create schema audit_drift_14;
create table audit_drift_14.t (
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
  constraint t_ticket_nonempty check (length(ticket_reference) > 3)  -- DRIFT
);
revoke all on table audit_drift_14.t from public, anon, authenticated, service_role;
do $$
begin
  begin
    perform public.assert_security_audit_shape('audit_drift_14.t');
    raise exception 'DRIFT 14 FAIL: wrong CHECK expression accepted';
  exception
    when sqlstate 'P0001' then
      if sqlerrm !~ 'ticket CHECK wrong expression' then
        raise exception 'DRIFT 14 FAIL: wrong message: %', sqlerrm;
      end if;
  end;
end$$;
rollback;
