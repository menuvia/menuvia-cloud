-- Drift 03: coloană lipsă (`notes`).
begin;
create schema audit_drift_03;
create table audit_drift_03.t (
  id uuid not null default gen_random_uuid(),
  applied_at timestamptz not null default now(),
  db_session_user name not null default session_user,
  restaurant_id uuid not null,
  observed_owner_id uuid,
  observed_owner_members uuid[] not null,
  final_owner_id uuid not null,
  ticket_reference text not null,
  -- notes intentionally omitted
  constraint t_pkey primary key (id),
  constraint t_ticket_nonempty check (btrim(ticket_reference) <> '')
);
revoke all on table audit_drift_03.t from public, anon, authenticated, service_role;
do $$
begin
  begin
    perform public.assert_security_audit_shape('audit_drift_03.t');
    raise exception 'DRIFT 03 FAIL: missing notes column accepted';
  exception
    when sqlstate 'P0001' then
      if sqlerrm !~ 'col=notes' then
        raise exception 'DRIFT 03 FAIL: wrong message: %', sqlerrm;
      end if;
  end;
end$$;
rollback;
