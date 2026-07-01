-- =============================================================
-- Migration 173 — get_restaurant_members: nume membri pentru afișare
-- =============================================================
-- Context: RLS `profiles_self` (auth.uid() = id) permite citirea DOAR a
-- propriului profil, deci listarea numelor colegilor (alocare mese, echipă)
-- eșua și UI-ul cădea pe user_id-ul brut („37853e71"). Acest RPC SECURITY
-- DEFINER întoarce membrii unui restaurant cu nume/email, DOAR pentru un
-- apelant care e el însuși membru al restaurantului. READ-ONLY: nu atinge
-- `restaurant_memberships` (nicio mutație pe suprafața de lockdown).

create or replace function public.get_restaurant_members(p_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_result jsonb;
begin
  if v_caller is null then
    return '[]'::jsonb;
  end if;
  -- Autorizare: apelantul trebuie să fie membru al restaurantului.
  if not exists (
    select 1 from public.restaurant_memberships
    where restaurant_id = p_restaurant_id and user_id = v_caller
  ) then
    return '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'user_id', m.user_id,
      'role', m.role,
      'full_name', p.full_name,
      'email', p.email
    )
    order by m.role, coalesce(p.full_name, p.email, m.user_id::text)
  ), '[]'::jsonb)
  into v_result
  from public.restaurant_memberships m
  left join public.profiles p on p.id = m.user_id
  where m.restaurant_id = p_restaurant_id;
  return v_result;
end;
$$;

revoke all on function public.get_restaurant_members(uuid) from public, anon, service_role;
grant execute on function public.get_restaurant_members(uuid) to authenticated;
