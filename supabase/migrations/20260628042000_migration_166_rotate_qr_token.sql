-- mig 166 — rotate_qr_token: rotație atomică a token-ului QR (P3 round-5)
-- ─────────────────────────────────────────────────────────────────────
-- Auditul round-5 (floor-tables). TablesManager.rotateToken făcea DOUĂ scrieri separate
-- (UPDATE is_active=false, apoi INSERT token nou) din client — între ele există o fereastră în
-- care masa NU are niciun token activ (un scan QR ar eșua). Mutăm rotația într-un RPC SECURITY
-- DEFINER care face dezactivarea + insertul în ACEEAȘI tranzacție, gate-uit pe is_admin + tenant
-- (oglinda convenției RPC-urilor SECURITY DEFINER din lockdown).
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout = '10s';

create or replace function public.rotate_qr_token(p_table_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant_id uuid;
  v_new_id        uuid;
begin
  select restaurant_id into v_restaurant_id from public.tables where id = p_table_id;
  if v_restaurant_id is null then
    raise exception 'Masa nu există' using errcode = 'P0001';
  end if;
  if not public.is_admin(v_restaurant_id) then
    raise exception 'Doar owner/manager pot reînnoi token-ul' using errcode = 'P0001';
  end if;

  -- dezactivare + insert în aceeași tranzacție: nicio fereastră fără token activ
  update public.qr_tokens
     set is_active = false
   where table_id = p_table_id and is_active = true;

  insert into public.qr_tokens (restaurant_id, table_id)
  values (v_restaurant_id, p_table_id)
  returning id into v_new_id;

  return v_new_id;
end;
$$;

revoke all on function public.rotate_qr_token(uuid) from public, anon;
grant execute on function public.rotate_qr_token(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='rotate_qr_token') then
    raise exception 'mig 166: rotate_qr_token lipsește';
  end if;
  raise notice 'mig 166: rotate_qr_token (rotație atomică) OK';
end $$;

commit;
