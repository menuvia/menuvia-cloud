-- mig 123 — Fix P2 (cost/abuz): quota AI-import atomică folosită corect (AI-4)
--
-- Auditul profund (CH8.a). ai-import.js folosea check_ai_import_quota (read-only)
-- urmat de log_ai_import (write) — check-then-act: cereri concurente treceau toate
-- de verificare și depășeau cota (apeluri AI = cost real Anthropic). mig 022 avea
-- deja `reserve_ai_import_slot` (advisory xact lock + verifică + rezervă atomic),
-- dar nefolosit. Aici îl extindem să întoarcă `slot_id`-ul rândului rezervat, ca
-- funcția să poată finaliza token-ii (UPDATE pe succes) sau refunda slot-ul
-- (DELETE pe eșec) PRECIS, după id — fără cursă pe „cel mai recent rând".

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

create or replace function public.reserve_ai_import_slot(
  p_user_id       uuid,
  p_restaurant_id uuid
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_plan text; v_max integer; v_used integer; v_id uuid;
begin
  -- Serializează cererile concurente per user (anti check-then-act).
  perform pg_advisory_xact_lock(hashtext('ai_import:' || p_user_id::text));

  select plan into v_plan from public.profiles where id = p_user_id;
  select ai_imports_month into v_max from public.plan_limits where plan = coalesce(v_plan, 'free');
  if v_max is null then v_max := 1; end if;

  select count(*) into v_used
  from public.ai_import_log
  where user_id = p_user_id and created_at > date_trunc('month', now());

  if v_used >= v_max then
    return jsonb_build_object('allowed', false, 'used', v_used, 'max', v_max, 'plan', coalesce(v_plan, 'free'));
  end if;

  -- REZERVĂ slot-ul ACUM (înainte de apelul AI), atomic sub lock.
  insert into public.ai_import_log (user_id, restaurant_id, tokens_used)
  values (p_user_id, p_restaurant_id, 0)
  returning id into v_id;

  return jsonb_build_object('allowed', true, 'used', v_used + 1, 'max', v_max,
                            'plan', coalesce(v_plan, 'free'), 'slot_id', v_id);
end;
$$;
grant execute on function public.reserve_ai_import_slot(uuid, uuid) to authenticated;

do $$
declare v text;
begin
  select pg_get_functiondef(p.oid) into v from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='reserve_ai_import_slot' limit 1;
  if v is null or position('slot_id' in v) = 0 then
    raise exception 'mig 123: reserve_ai_import_slot nu întoarce slot_id';
  end if;
  raise notice 'mig 123: reserve_ai_import_slot atomic + slot_id OK';
end $$;

commit;
