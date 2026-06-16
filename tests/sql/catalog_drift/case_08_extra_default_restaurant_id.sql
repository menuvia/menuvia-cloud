-- Drift 08: default suplimentar pe restaurant_id (nu ar trebui să aibă default).
begin;
create schema audit_drift_08;
create table audit_drift_08.t (
  id uuid not null default gen_random_uuid(),
  applied_at timestamptz not null default now(),
  db_session_user name not null default session_user,
  restaurant_id uuid not null default gen_random_uuid(),  -- DRIFT: default suplimentar
  observed_owner_id uuid,
  observed_owner_members uuid[] not null,
  final_owner_id uuid not null,
  ticket_reference text not null,
  notes text,
  constraint t_pkey primary key (id),
  constraint t_ticket_nonempty check (btrim(ticket_reference) <> '')
);
revoke all on table audit_drift_08.t from public, anon, authenticated, service_role;
do $$
begin
  begin
    perform public.assert_security_audit_shape('audit_drift_08.t');
    raise exception 'DRIFT 08 FAIL: extra default on restaurant_id accepted';
  exception
    when sqlstate 'P0001' then
      if sqlerrm !~ 'col=restaurant_id' then
        raise exception 'DRIFT 08 FAIL: wrong message: %', sqlerrm;
      end if;
  end;
end$$;
rollback;
