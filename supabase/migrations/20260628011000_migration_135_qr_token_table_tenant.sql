-- mig 135 — Fix P2 (izolare tenant): qr_tokens.table_id legat de restaurant (QR-TENANT-1)
--
-- Auditul rundei 3 (reservations_tables). qr_tokens.table_id nu era validat sa apartina
-- aceluiasi restaurant ca token-ul => un admin putea crea/muta un token pe masa altui
-- restaurant (integritate + DoS cross-tenant). Oglinda exacta a mig 128 (reservations).

begin;
set local lock_timeout = '10s';

create or replace function public.enforce_qr_token_table_tenant()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.table_id is not null then
    if not exists (
      select 1 from public.tables t
       where t.id = new.table_id and t.restaurant_id = new.restaurant_id
    ) then
      raise exception 'Masa % nu apartine restaurantului % (izolare tenant)', new.table_id, new.restaurant_id
        using errcode = 'P0001', hint = 'table_wrong_restaurant';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_qr_token_table_tenant() from public;

drop trigger if exists trg_qr_token_table_tenant on public.qr_tokens;
create trigger trg_qr_token_table_tenant
  before insert or update on public.qr_tokens
  for each row execute function public.enforce_qr_token_table_tenant();

do $$ begin
  if not exists (select 1 from pg_trigger where tgname='trg_qr_token_table_tenant'
                  and tgrelid='public.qr_tokens'::regclass and not tgisinternal) then
    raise exception 'mig 135: trigger lipseste'; end if;
  raise notice 'mig 135: qr_tokens.table_id tenant guard OK';
end $$;
commit;
