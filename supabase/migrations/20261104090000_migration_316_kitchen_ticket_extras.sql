-- ═══════════════════════════════════════════════════════════════════
-- Migration 316: tichetul de bucătărie tipărește extra-urile (lotul O2a)
-- ─────────────────────────────────────────────────────────────────────
-- BUG (audit nov 2026, OPT-1 / STAFF-OPT-2, confirmat adversarial): oaspetele
-- alege un extra plătit („+ Bacon 5 lei"), serverul îl încasează, dar bucătăria
-- nu-l vede. `build_kitchen_ticket_payload` (mig 227, singura definiție) citea
-- cheia `name` din `order_items.extras_added`, iar TOȚI scriitorii vii scriu
-- `extra_name` (create_order 191:437-441, update_order_items 313:984-990,
-- forma {extra_id, extra_name, price} din mig 088). Valoarea era mereu NULL și
-- filtrul `where coalesce(x->>'name','') <> ''` arunca fiecare extra. Măsurat
-- pe producție la 4 nov 2026: 2 linii de comandă cu extra, niciunul tipărit.
--
-- FIX: corpul 227 VERBATIM, schimbată DOAR subinterogarea extra-urilor:
-- citește `extra_name`, cu `name` ca rezervă pentru rândurile vechi (scrise
-- de mig 023/025/046, înaintea formei din 088), în ambele locuri (select și
-- where). Aceeași semnătură → `create or replace` (fără overload, fără
-- PGRST203); `stable security definer`, `search_path = public, pg_temp`,
-- curățarea `[\r\n\t]`, antetul, subsolul și ora București rămân identice
-- (fusul restaurantului vine într-un lot separat, G2/L8c).
--
-- Partea de client (ecranele bucătăriei și ale ospătarului care nu cereau
-- deloc `extras_added`) e în același PR. Teste: tests/sql/auto/316_*.sql
-- (KX1–KX4), inclusiv capăt-la-capăt prin create_order.
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.build_kitchen_ticket_payload(
  p_order_id uuid,
  p_reprint  boolean default false
) returns text
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_order  record;
  v_lines  text;
  v_items  int;
begin
  select o.id, o.source, o.notes, o.created_at,
         coalesce(o._table_name_snapshot, t.name) as table_name
    into v_order
    from public.orders o
    left join public.tables t on t.id = o.table_id
   where o.id = p_order_id;
  if not found then
    raise exception 'build_kitchen_ticket_payload: order % not found', p_order_id;
  end if;

  select count(*),
         string_agg(
           oi.quantity || 'x ' ||
           regexp_replace(oi.product_name_snapshot, '[\r\n\t]', ' ', 'g') ||
           coalesce((
             select string_agg(e'\n   + ' ||
                      regexp_replace(coalesce(m->>'option_name', ''), '[\r\n\t]', ' ', 'g'), '')
               from jsonb_array_elements(coalesce(oi.selected_modifiers, '[]'::jsonb)) m
              where coalesce(m->>'option_name', '') <> ''
           ), '') ||
           coalesce((
             -- mig 316: `extra_name` (forma vie, mig 088+); `name` doar pentru
             -- rândurile scrise înainte de 088.
             select string_agg(e'\n   + ' ||
                      regexp_replace(coalesce(nullif(x->>'extra_name', ''), x->>'name', ''),
                                     '[\r\n\t]', ' ', 'g'), '')
               from jsonb_array_elements(coalesce(oi.extras_added, '[]'::jsonb)) x
              where coalesce(nullif(x->>'extra_name', ''), x->>'name', '') <> ''
           ), '') ||
           case when coalesce(btrim(oi.notes), '') <> ''
                then e'\n   >> ' || regexp_replace(oi.notes, '[\r\n\t]', ' ', 'g')
                else '' end,
           e'\n' order by oi.created_at
         )
    into v_items, v_lines
    from public.order_items oi
   where oi.order_id = p_order_id;

  if coalesce(v_items, 0) = 0 then
    raise exception 'build_kitchen_ticket_payload: order % has no items', p_order_id;
  end if;

  return case when p_reprint then '*** REPRINT ***' else '*** COMANDA NOUA ***' end
    || e'\n'
    || case v_order.source
         when 'pickup' then 'PICKUP'
         when 'waiter' then 'OSPATAR' ||
           case when v_order.table_name is not null then ' · MASA: ' ||
             regexp_replace(v_order.table_name, '[\r\n\t]', ' ', 'g') else '' end
         else 'MASA: ' || coalesce(regexp_replace(v_order.table_name, '[\r\n\t]', ' ', 'g'), '-')
       end
    || e'\n'
    || '#' || upper(right(v_order.id::text, 6)) || ' · '
    || to_char(v_order.created_at at time zone 'Europe/Bucharest', 'HH24:MI DD.MM')
    || e'\n------------------------------\n'
    || v_lines
    || e'\n------------------------------'
    || case when coalesce(btrim(v_order.notes), '') <> ''
            then e'\nNOTE: ' || regexp_replace(v_order.notes, '[\r\n\t]', ' ', 'g')
            else '' end;
end$$;

-- Helper intern: îl cheamă doar trigger-ul de enqueue și RPC-urile DEFINER
-- (bridge_*, kitchen_ticket_reprint). Nicio cale de client.
revoke all on function public.build_kitchen_ticket_payload(uuid, boolean)
  from public, anon, authenticated;

-- ── Asserții fail-closed ─────────────────────────────────────────────
do $$
declare v_def text; v_n int;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'build_kitchen_ticket_payload';
  if v_n <> 1 then
    raise exception 'ASSERT FAIL: build_kitchen_ticket_payload are % semnături (aștept 1)', v_n;
  end if;
  v_def := pg_get_functiondef('public.build_kitchen_ticket_payload(uuid, boolean)'::regprocedure);
  if position('extra_name' in v_def) = 0 then
    raise exception 'ASSERT FAIL: tichetul nu citește extra_name (mig 316)';
  end if;
  if has_function_privilege('anon', 'public.build_kitchen_ticket_payload(uuid, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.build_kitchen_ticket_payload(uuid, boolean)', 'execute') then
    raise exception 'ASSERT FAIL: build_kitchen_ticket_payload apelabil din client';
  end if;
end $$;

commit;
