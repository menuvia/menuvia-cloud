-- Drift 05: tip greșit pe observed_owner_members (text[] în loc de uuid[]).
begin;
create schema audit_drift_05;
create table audit_drift_05.t (
  id uuid not null default gen_random_uuid(),
  applied_at timestamptz not null default now(),
  db_session_user name not null default session_user,
  restaurant_id uuid not null,
  observed_owner_id uuid,
  observed_owner_members text[] not null,  -- DRIFT: ar trebui uuid[]
  final_owner_id uuid not null,
  ticket_reference text not null,
  notes text,
  constraint t_pkey primary key (id),
  constraint t_ticket_nonempty check (btrim(ticket_reference) <> '')
);
revoke all on table audit_drift_05.t from public, anon, authenticated, service_role;
do $$
begin
  begin
    perform public.assert_security_audit_shape('audit_drift_05.t');
    raise exception 'DRIFT 05 FAIL: text[] accepted instead of uuid[]';
  exception
    when sqlstate 'P0001' then
      if sqlerrm !~ 'typ=text\[\]' then
        raise exception 'DRIFT 05 FAIL: wrong message: %', sqlerrm;
      end if;
  end;
end$$;
rollback;
