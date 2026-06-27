-- mig 141 — Fix P3: cota AI-import pe planul RESTAURANTULUI + membership (AI-QUOTA-1)
--
-- Auditul rundei 3 (netlify_functions). reserve_ai_import_slot (mig 123):
--   • folosea profiles.plan al APELANTULUI, nu planul restaurantului (gating-ul corect
--     e pe restaurant — CLAUDE.md regula 3);
--   • numara cota pe user_id, nu pe restaurant_id;
--   • NU verifica apartenenta apelantului la p_restaurant_id => IDOR: un user putea
--     scrie randuri in ai_import_log atribuite altui restaurant (log-poisoning) si
--     consuma/observa cota acestuia.
-- Fix: validare membership, plan derivat din owner-ul restaurantului, cota pe restaurant.
-- Netlify ai-import.js ramane neschimbat (trimite deja p_user_id + p_restaurant_id).

begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

create or replace function public.reserve_ai_import_slot(p_user_id uuid, p_restaurant_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $function$
declare
  v_plan text; v_max integer; v_used integer; v_id uuid;
begin
  -- Anti-spoofing: un apelant AUTENTICAT (PostgREST direct) poate folosi DOAR propriul
  -- uid. Apelul legitim din Netlify foloseste service_role (auth.uid() = NULL) si trimite
  -- un p_user_id deja verificat prin getUser(JWT), deci e permis. Astfel se inchide IDOR-ul
  -- prin care un user autentificat ar pasa UUID-ul altui membru.
  if auth.uid() is not null and auth.uid() <> p_user_id then
    return jsonb_build_object('allowed', false, 'used', 0, 'max', 0, 'plan', 'free', 'error', 'forbidden');
  end if;

  -- Apartenenta obligatorie (anti IDOR/log-poisoning).
  if p_restaurant_id is null or not exists (
    select 1 from public.restaurant_memberships m
     where m.restaurant_id = p_restaurant_id and m.user_id = p_user_id
  ) then
    return jsonb_build_object('allowed', false, 'used', 0, 'max', 0, 'plan', 'free', 'error', 'not_a_member');
  end if;

  -- Serializeaza pe RESTAURANT (cota se numara pe restaurant).
  perform pg_advisory_xact_lock(hashtext('ai_import:' || p_restaurant_id::text));

  -- Planul RESTAURANTULUI (owner), nu al apelantului.
  select pr.plan into v_plan
  from public.restaurants r join public.profiles pr on pr.id = r.owner_id
  where r.id = p_restaurant_id;

  select ai_imports_month into v_max from public.plan_limits where plan = coalesce(v_plan, 'free');
  if v_max is null then v_max := 1; end if;

  select count(*) into v_used
  from public.ai_import_log
  where restaurant_id = p_restaurant_id and created_at > date_trunc('month', now());

  if v_used >= v_max then
    return jsonb_build_object('allowed', false, 'used', v_used, 'max', v_max, 'plan', coalesce(v_plan, 'free'));
  end if;

  insert into public.ai_import_log (user_id, restaurant_id, tokens_used)
  values (p_user_id, p_restaurant_id, 0)
  returning id into v_id;

  return jsonb_build_object('allowed', true, 'used', v_used + 1, 'max', v_max,
                            'plan', coalesce(v_plan, 'free'), 'slot_id', v_id);
end;
$function$;
grant execute on function public.reserve_ai_import_slot(uuid, uuid) to authenticated;

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='reserve_ai_import_slot' limit 1;
  if v_def is null or position('restaurant_memberships' in v_def)=0 or position('owner_id' in v_def)=0 then
    raise exception 'mig 141: reserve_ai_import_slot nu valideaza membership/plan restaurant';
  end if;
  raise notice 'mig 141: AI quota pe restaurant + membership OK';
end $$;
commit;
