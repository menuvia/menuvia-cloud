-- mig 144 — Fix P1 (anti-furt): order_items.item_total nu poate fi negativ (OI-TOTAL-1)
--
-- Auditul rundei 4 (create_order_args). create_order permite `option_ids` DUPLICATE:
-- subquery-ul de validare numara count(*) == jsonb_array_length(option_ids) (trece la
-- duplicate, fiindca fiecare aparitie face join valid la acelasi modifier_option), iar
-- sum(mo.price_delta) numara delta de N ori. Cu o optiune cu price_delta NEGATIV (reducere
-- legitima, permisa de mig 120 in [-10000,10000]) un client QR anon poate duplica optiunea
-- de N ori -> v_item_total = (unit + options_total + extras) * qty devine NEGATIV -> scade
-- orders.total (furt). order_items (mig 003) avea doar CHECK quantity>0, niciun bound pe total.
--
-- Acest fix blocheaza cel mai grav vector (total negativ) la nivel de constraint, indiferent
-- de calea de scriere (create_order ambele overload-uri, update_order_items, PostgREST direct).
-- NOT VALID: impune pe randuri NOI fara a esua pe eventuale randuri legacy.
-- NOTA: fix-ul COMPLET (dedup option_ids in create_order + plafon lungime) ramane de facut
-- separat; acesta e plasa de siguranta pe rezultat.

begin;
set local lock_timeout = '10s';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'chk_order_items_item_total_nonneg'
       and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint chk_order_items_item_total_nonneg
      check (item_total >= 0) not valid;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'chk_order_items_item_total_nonneg'
       and conrelid = 'public.order_items'::regclass
  ) then
    raise exception 'mig 144: constraint-ul chk_order_items_item_total_nonneg lipseste';
  end if;
  raise notice 'mig 144: order_items.item_total >= 0 (anti total negativ) OK';
end $$;

commit;
