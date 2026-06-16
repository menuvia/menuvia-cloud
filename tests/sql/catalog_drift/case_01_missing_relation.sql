-- Drift 01: relația lipsește complet (helper-ul folosește to_regclass → NULL).
begin;
do $$
begin
  begin
    perform public.assert_security_audit_shape('public.audit_drift_01_missing_xyz');
    raise exception 'DRIFT 01 FAIL: missing relation accepted';
  exception
    when sqlstate 'P0001' then
      if sqlerrm !~ 'relation .* missing' then
        raise exception 'DRIFT 01 FAIL: wrong message: %', sqlerrm;
      end if;
  end;
end$$;
rollback;
