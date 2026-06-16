-- Drift 02: obiectul există dar e un VIEW, nu o tabelă obișnuită.
begin;
create schema audit_drift_02;
create view audit_drift_02.t as select 1 as id;
do $$
begin
  begin
    perform public.assert_security_audit_shape('audit_drift_02.t');
    raise exception 'DRIFT 02 FAIL: view accepted as table';
  exception
    when sqlstate 'P0001' then
      if sqlerrm !~ 'not an ordinary table' then
        raise exception 'DRIFT 02 FAIL: wrong message: %', sqlerrm;
      end if;
  end;
end$$;
rollback;
