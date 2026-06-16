-- Drift 17: privilege leak la column-level (authenticated SELECT pe `notes`).
begin;
create schema audit_drift_17;
create table audit_drift_17.t (
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
revoke all on table audit_drift_17.t from public, anon, authenticated, service_role;
grant select (notes) on table audit_drift_17.t to authenticated;  -- DRIFT column-level
do $$
begin
  begin
    perform public.assert_security_audit_shape('audit_drift_17.t');
    raise exception 'DRIFT 17 FAIL: column-level grant accepted';
  exception
    when sqlstate 'P0001' then
      if sqlerrm !~ 'retains column privilege' then
        raise exception 'DRIFT 17 FAIL: wrong message: %', sqlerrm;
      end if;
  end;
end$$;
rollback;
