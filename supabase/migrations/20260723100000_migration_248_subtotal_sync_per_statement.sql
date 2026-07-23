-- Migration 248 — order_items_subtotal_sync: per-rând → per-statement (perf)
--
-- Trigger-ul `order_items_subtotal_sync` era AFTER INSERT/UPDATE/DELETE **FOR EACH
-- ROW** (mig 003, funcția `recalc_order_subtotal` mig 031). Pentru o comandă cu N
-- linii se făceau N recompute-uri complete ale totalului → N UPDATE-uri pe `orders`
-- → N rânduri `audit_log` (trigger `audit_orders`, mig 044) + N evenimente realtime
-- (publicație `supabase_realtime`, mig 078). Recompute-ul e IDEMPOTENT (sumă completă
-- din order_items), deci totalul final e IDENTIC — amplificarea intermediară e pură
-- risipă (write amplification pe orders + zgomot audit + N evenimente realtime pe
-- Bucătărie/Ospătar în loc de 1).
--
-- Trecem la **FOR EACH STATEMENT** cu transition tables: o singură reîmprospătare
-- per comandă atinsă, per statement. `_refresh_order_totals` (mig 031) rămâne
-- NEATINS — se schimbă DOAR granularitatea declanșării, nu aritmetica. Semantica
-- finală (total = greatest(0, subtotal - discount_amount), post-discount) e păstrată
-- 1:1. Happy-hour (`trg_apply_happy_hour_auto`, constraint trigger DEFERRED pe
-- `orders`, mig 077) e neafectat: rulează la COMMIT, pe altă tabelă, și oricum
-- suprascrie final totalul. RPC-urile care setează `orders.total` direct
-- (`create_order`, `update_order_items` → `_refresh_order_totals`) rămân corecte:
-- statement trigger-ul recalculează la fel, o singură dată per statement.
--
-- Design validat pe PG 16: insert multi-linie / update / delete parțial / delete
-- total dau toate totalul corect cu O SINGURĂ reîmprospătare per statement.

begin;

-- 1) Renunțăm la trigger-ul row-level (mig 003) + funcția lui wrapper (mig 031).
drop trigger if exists order_items_subtotal_sync on public.order_items;
drop function if exists public.recalc_order_subtotal();

-- 2) Funcția statement-level. Citește order_id-urile distincte din transition
--    tables și reîmprospătează fiecare comandă O SINGURĂ dată. Ramurile pe TG_OP
--    referă DOAR transition tables valide pentru evenimentul respectiv (plpgsql
--    planifică leneș fiecare statement, deci ramura ne-executată nu se validează).
create or replace function public.recalc_order_subtotal_stmt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  if tg_op = 'INSERT' then
    for v_order_id in select distinct order_id from changed_rows loop
      perform public._refresh_order_totals(v_order_id);
    end loop;
  elsif tg_op = 'DELETE' then
    for v_order_id in select distinct order_id from changed_old_rows loop
      perform public._refresh_order_totals(v_order_id);
    end loop;
  else -- UPDATE: order_id se poate schimba în teorie → reîmprospătăm ambele.
    for v_order_id in
      select order_id from changed_rows
      union
      select order_id from changed_old_rows
    loop
      perform public._refresh_order_totals(v_order_id);
    end loop;
  end if;
  return null;
end;
$$;

-- 3) Câte un trigger statement-level per eveniment, cu transition tables valide.
create trigger order_items_subtotal_sync_ins
  after insert on public.order_items
  referencing new table as changed_rows
  for each statement execute function public.recalc_order_subtotal_stmt();

create trigger order_items_subtotal_sync_upd
  after update on public.order_items
  referencing old table as changed_old_rows new table as changed_rows
  for each statement execute function public.recalc_order_subtotal_stmt();

create trigger order_items_subtotal_sync_del
  after delete on public.order_items
  referencing old table as changed_old_rows
  for each statement execute function public.recalc_order_subtotal_stmt();

-- ── Asserții fail-closed ─────────────────────────────────────────────────────
do $$
declare
  v_n int;
begin
  -- cele 3 triggere noi există
  select count(*) into v_n
    from pg_trigger
   where tgrelid = 'public.order_items'::regclass
     and not tgisinternal
     and tgname in (
       'order_items_subtotal_sync_ins',
       'order_items_subtotal_sync_upd',
       'order_items_subtotal_sync_del'
     );
  if v_n <> 3 then
    raise exception 'mig 248: aștept 3 triggere statement-level, găsit %', v_n;
  end if;

  -- vechiul trigger row-level nu mai există
  if exists (
    select 1 from pg_trigger
     where tgrelid = 'public.order_items'::regclass
       and tgname = 'order_items_subtotal_sync'
  ) then
    raise exception 'mig 248: vechiul trigger row-level încă există';
  end if;

  -- toate cele 3 sunt STATEMENT-level (tgtype bit 0 = FOR EACH ROW → trebuie 0)
  if exists (
    select 1 from pg_trigger
     where tgrelid = 'public.order_items'::regclass
       and tgname like 'order_items_subtotal_sync_%'
       and (tgtype & 1) = 1
  ) then
    raise exception 'mig 248: un trigger de subtotal e încă FOR EACH ROW';
  end if;

  -- funcția row-level veche a dispărut; cea nouă există
  if exists (
    select 1 from pg_proc where proname = 'recalc_order_subtotal'
      and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'mig 248: funcția row-level veche recalc_order_subtotal încă există';
  end if;
  if not exists (
    select 1 from pg_proc where proname = 'recalc_order_subtotal_stmt'
      and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'mig 248: funcția statement recalc_order_subtotal_stmt lipsește';
  end if;
end $$;

commit;
