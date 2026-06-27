-- mig 130 — Fix P2 (regresie): order_items nu accepta produse draft/sold_out (ORD-AVAIL-1)
--
-- Auditul rundei 2 (public_qr). create_order original (mig 046:362) respingea produsele
-- cu is_draft sau is_sold_out (`if not is_active or is_draft or is_sold_out`). La
-- recrearea din mig 088 -> 117, validarea s-a redus la `is_active` => un produs ciorna
-- sau epuizat putea fi comandat (regresie). create_order e RPC mare si patchabil riscant;
-- in loc sa-l recreez, pun un guard defense-in-depth pe order_items care acopera ORICE
-- cale de inserare (RPC actual, viitor, PostgREST direct).
--
-- Fix: trigger BEFORE INSERT pe order_items care respinge produse draft / sold_out /
-- inactive (oglinda semantica mig 046).

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '60s';

create or replace function public.reject_unavailable_order_item()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prod record;
begin
  if new.product_id is null then
    return new;  -- linie ad-hoc fara produs (FK permite); nimic de validat
  end if;

  select is_active, is_draft, is_sold_out, name
    into v_prod
  from public.products
  where id = new.product_id;

  if not found then
    return new;  -- FK-ul se ocupa de inexistenta; nu dublam eroarea
  end if;

  if v_prod.is_draft then
    raise exception 'Produsul "%" este ciornă și nu poate fi comandat', v_prod.name
      using errcode = 'P0001', hint = 'product_draft';
  end if;
  if v_prod.is_sold_out then
    raise exception 'Produsul "%" este epuizat', v_prod.name
      using errcode = 'P0001', hint = 'product_sold_out';
  end if;
  if not v_prod.is_active then
    raise exception 'Produsul "%" nu este disponibil', v_prod.name
      using errcode = 'P0001', hint = 'product_inactive';
  end if;

  return new;
end;
$$;

revoke all on function public.reject_unavailable_order_item() from public;

drop trigger if exists trg_reject_unavailable_order_item on public.order_items;
create trigger trg_reject_unavailable_order_item
  before insert on public.order_items
  for each row
  execute function public.reject_unavailable_order_item();

do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'trg_reject_unavailable_order_item'
       and tgrelid = 'public.order_items'::regclass
       and not tgisinternal
  ) then
    raise exception 'mig 130: triggerul trg_reject_unavailable_order_item lipseste';
  end if;
  raise notice 'mig 130: order_items respinge draft/sold_out/inactive OK';
end $$;

commit;
