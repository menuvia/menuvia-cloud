-- mig 154 — save_floor_layout: gate floor_plan (#24) + plafon dimensiune (#25)
-- ─────────────────────────────────────────────────────────────────────
-- Auditul round-4 (#24/#25). `save_floor_layout` (Hartă sală) salva orice jsonb în
-- restaurants.floor_layout fără:
--   #24 (B3): gate de plan. `floor_plan` e feature Plan 3 (pro/enterprise în plan_features),
--      dar funcția verifica doar owner/manager → un admin pe Plan 1/2 putea folosi harta.
--   #25: plafon de dimensiune. p_layout putea fi arbitrar de mare (DoS pe storage/row).
--   + jsonb trebuie să fie un OBIECT (nu array/scalar arbitrar) și search_path întărit.
--
-- Recreare din corpul EFECTIV curent, VERBATIM, cu adăugările de mai sus. Semnătura
-- (uuid, jsonb) returns void, security definer, grants — păstrate.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout = '10s';

create or replace function public.save_floor_layout(p_restaurant_id uuid, p_layout jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_role text;
begin
  -- Verifică că user-ul curent e owner sau manager
  select role into v_role
  from restaurant_memberships
  where restaurant_id = p_restaurant_id
    and user_id = auth.uid()
  limit 1;

  if v_role is null then
    if not exists (
      select 1 from restaurants
      where id = p_restaurant_id and owner_id = auth.uid()
    ) then
      raise exception 'Acces interzis: nu ești owner/manager al acestui restaurant';
    end if;
  elsif v_role not in ('owner', 'manager') then
    raise exception 'Acces interzis: doar owner/manager pot edita layout-ul';
  end if;

  -- #24 (mig 154): Hartă sală = feature Plan 3 (floor_plan). Gate după verificarea de rol.
  perform public.enforce_feature_for_restaurant(p_restaurant_id, 'floor_plan');

  -- p_layout trebuie să fie un obiect JSON (nu array/scalar arbitrar)
  if p_layout is null or jsonb_typeof(p_layout) <> 'object' then
    raise exception 'Layout invalid: se așteaptă un obiect JSON'
      using errcode = 'P0001', hint = 'invalid_layout';
  end if;

  -- #25 (mig 154): plafon de dimensiune (1 MiB) — anti DoS pe storage/row.
  if octet_length(p_layout::text) > 1048576 then
    raise exception 'Layout prea mare (max 1 MB)'
      using errcode = 'P0001', hint = 'layout_too_large';
  end if;

  update restaurants
  set floor_layout = p_layout,
      updated_at   = now()
  where id = p_restaurant_id;
end;
$function$;

-- ── Asserție fail-closed ─────────────────────────────────────────────────────
do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='save_floor_layout';
  if position('floor_plan' in v_src) = 0 then
    raise exception 'mig 154: gate-ul floor_plan lipsește din save_floor_layout (#24)'; end if;
  if position('layout_too_large' in v_src) = 0 then
    raise exception 'mig 154: plafonul de dimensiune lipsește (#25)'; end if;
  raise notice 'mig 154: save_floor_layout gate floor_plan (#24) + size cap (#25) OK';
end $$;

commit;
