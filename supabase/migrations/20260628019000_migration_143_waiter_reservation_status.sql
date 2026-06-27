-- mig 143 — Fix P3: restrange tranzitiile de status pe reservations pentru waiter (RES-WAITER-1)
--
-- Auditul rundei 3 (reservations_tables). Politica reservations_waiter_update (mig 073)
-- permitea unui waiter sa faca UPDATE pe orice rezervare a restaurantului, cu orice status
-- rezultat (inclusiv re-activarea unei rezervari cancelled, sau setari arbitrare). Restrangem
-- la tranzitiile operationale de sala: poate atinge doar rezervari pending/confirmed/seated
-- si le poate duce in seated/no_show/completed/confirmed (NU cancelled/pending arbitrar).
-- owner/manager pastreaza politicile lor (neatinse).

begin;
set local lock_timeout = '10s';

drop policy if exists reservations_waiter_update on public.reservations;
create policy reservations_waiter_update
  on public.reservations for update
  using (
    exists (select 1 from public.restaurant_memberships m
             where m.restaurant_id = reservations.restaurant_id
               and m.user_id = auth.uid() and m.role = 'waiter'::member_role)
    and status in ('pending','confirmed','seated')
  )
  with check (
    exists (select 1 from public.restaurant_memberships m
             where m.restaurant_id = reservations.restaurant_id
               and m.user_id = auth.uid() and m.role = 'waiter'::member_role)
    and status in ('seated','no_show','completed','confirmed')
  );

-- Lock pe coloane: politica RLS limiteaza statusul, dar un waiter ar putea inca edita
-- PII/ora/masa pastrand un status valid. Trigger BEFORE UPDATE care, DOAR pentru rolul
-- efectiv 'waiter', respinge orice modificare in afara de status (compara column-agnostic
-- via jsonb, excluzand campurile de sistem). owner/manager + service_role neatinsi.
create or replace function public.enforce_waiter_reservation_columns()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_role public.member_role;
begin
  if auth.uid() is null then
    return new;  -- service_role / context intern (definer): neatins
  end if;
  select role into v_role from public.restaurant_memberships
   where restaurant_id = new.restaurant_id and user_id = auth.uid();

  if v_role = 'waiter'::public.member_role then
    if (to_jsonb(new) - 'status' - 'updated_at' - 'reminder_sent_at')
       is distinct from
       (to_jsonb(old) - 'status' - 'updated_at' - 'reminder_sent_at') then
      raise exception 'Un waiter poate schimba doar statusul rezervarii (nu PII/ora/masa)'
        using errcode = 'P0001', hint = 'waiter_field_locked';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_waiter_reservation_columns() from public;

drop trigger if exists trg_waiter_reservation_columns on public.reservations;
create trigger trg_waiter_reservation_columns
  before update on public.reservations
  for each row
  execute function public.enforce_waiter_reservation_columns();

do $$ begin
  if not exists (select 1 from pg_policy where polname='reservations_waiter_update'
                  and polrelid='public.reservations'::regclass) then
    raise exception 'mig 143: politica lipseste'; end if;
  if not exists (select 1 from pg_trigger where tgname='trg_waiter_reservation_columns'
                  and tgrelid='public.reservations'::regclass and not tgisinternal) then
    raise exception 'mig 143: triggerul de coloane lipseste'; end if;
  raise notice 'mig 143: waiter reservations restrans la status (RLS + column-lock) OK';
end $$;
commit;
