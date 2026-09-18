-- migration_278_order_tenant_guard.sql
-- =============================================================================
-- Un rând care poartă (order_id, restaurant_id) nu poate referi comanda ALTUI
-- restaurant — gate în DATE, nu în RPC. (cauza-rădăcină a capcanei de tenant
-- găsite de recenzia adversarială a mig 276; consemnată atunci ca migrație
-- separată)
--
-- Gaura, REPRODUSĂ pe replay sub rolul real `authenticated`: `pending_receipts`
-- e scrisă direct de rolurile client (INSERT/UPDATE sub politica `admin
-- manage`, mig 030), politica verifică DOAR `is_admin(restaurant_id)`, FK-ul pe
-- `order_id` acceptă orice comandă existentă, iar mig 133 verifică doar planul
-- lui `new.restaurant_id`. Deci owner-ul unui restaurant B pe Plan 3 poate
-- insera `(restaurant_id = B, order_id = <comanda lui A>, status = 'success',
-- bon_number = '666')` FĂRĂ să poată măcar citi bonurile lui A. Consecințe
-- reale, nu teoretice:
--   • `enqueue_fiscal_receipt` (259) e idempotent pe `order_id` SINGUR
--     (`where order_id = new.id and status in ('pending','sent','success')`):
--     un rând-parazit `success` pe comanda lui A face ca încasarea REALĂ a lui
--     A să NU mai producă bon fiscal — tăcut, exact clasa „bani fără bon";
--   • până la mig 276, lateralul de pe factura Oblio ar fi tipărit bonul
--     parazit pe documentul lui A (276 a scopat lateralul pe restaurant, dar
--     asta apără o SINGURĂ citire, nu tabela).
-- Aceeași clasă are precedent: `trg_enforce_order_table_tenant` (113/240) pe
-- `orders.table_id`.
--
-- Ce se instalează. O funcție de trigger GENERICĂ,
-- `enforce_order_tenant_consistency()`, care cere `orders.restaurant_id =
-- new.restaurant_id` pentru `new.order_id` (NULL = nimic de verificat — pe
-- prod există un rând istoric `cancelled` cu `order_id` NULL, iar mig 032 a
-- făcut coloana nullable). DEFINER cu `public, pg_temp`: sub INVOKER, B nu
-- vede comanda lui A prin RLS și ar primi „comanda nu există" — tot respins,
-- dar cu un mesaj care minte; iar în cascade/roluri fără SELECT pe `orders`
-- gate-ul ar deveni ORB. O singură eroare (hint `receipt_tenant_mismatch`)
-- pentru „nu există" și „e a altuia" — fără oracol de existență. Trigger BEFORE INSERT OR UPDATE OF (order_id,
-- restaurant_id) FOR EACH ROW pe TOATE cele patru tabele care poartă perechea
-- — `pending_receipts` (gaura vie), `kitchen_tickets`, `invoices`,
-- `order_feedback` (scrise azi doar prin RPC-uri DEFINER/service_role, deci
-- gate-ul e defense-in-depth acolo: un bug într-un RPC nu poate produce un rând
-- cross-tenant). Un UPDATE de status nu declanșează nimic.
--
-- Clichet de CLASĂ (TG4, permanent): ORICE tabelă din `public` care are ambele
-- coloane trebuie să poarte trigger-ul (tgtype 23 = BEFORE + INSERT + UPDATE +
-- ROW, pe această funcție, cu AMBELE coloane în lista `UPDATE OF` — tgattr —
-- sau lista goală). O tabelă VIITOARE cu perechea (order_id, restaurant_id)
-- face CI roșu până primește gate-ul — nu se mai poate strecura.
--
-- Partea PĂRINTE (TG5): `orders.restaurant_id` devine IMUABIL
-- (`trg_orders_restaurant_id_immutable`) — altfel invariantul se sparge fără
-- să se scrie niciun copil: un admin la două restaurante muta comanda, iar
-- bonul/tichetul/factura rămâneau pe restaurantul vechi.
--
-- One-shot: zero rânduri cross-tenant existente (prod, 15 sept 2026: 0 în
-- toate cele patru; un rând istoric cu order_id NULL, scutit). Dacă apar la
-- aplicare, migrația PICĂ — o inconsistență fiscală existentă e decizie de
-- fondator, nu se ascunde sub un trigger.
--
-- Teste permanente TG1–TG5: tests/sql/order_tenant_guard_assertions.sql
-- (TG1 rulează SUB rolul real `authenticated` — ca postgres RLS-ul e ocolit și
-- testul ar fi orb la faptul că politica lasă INSERT-ul să ajungă la trigger).
-- =============================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';

create or replace function public.enforce_order_tenant_consistency()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rid uuid;
begin
  -- Fără comandă = nimic de verificat (rânduri istorice, mig 032).
  if new.order_id is null then
    return new;
  end if;

  select o.restaurant_id into v_rid from public.orders o where o.id = new.order_id;
  -- O SINGURĂ eroare pentru „comanda nu există" ȘI „comanda e a altui
  -- restaurant" (recenzie CodeRabbit pe #259): trigger-ul BEFORE rulează
  -- ÎNAINTEA verificării FK, deci două erori diferite ar fi un oracol de
  -- existență pentru id-uri de comenzi străine. Mesajul nu dezvăluie nici
  -- restaurantul comenzii, nici dacă ea există: apelantul află doar că perechea
  -- (comandă, restaurant) e respinsă. Hint-ul e contractul testelor/clientului.
  if v_rid is null or v_rid <> new.restaurant_id then
    raise exception 'Rândul din % (restaurant %) nu poate referi comanda %: nu aparține acestui restaurant.',
      tg_table_name, new.restaurant_id, new.order_id
      using errcode = 'P0001', hint = 'receipt_tenant_mismatch';
  end if;
  return new;
end;
$$;

-- Explicit per rol (default privileges Supabase, mig 274): doar trigger-ele o cheamă.
revoke all on function public.enforce_order_tenant_consistency() from public, anon, authenticated, service_role;

comment on function public.enforce_order_tenant_consistency() is
  'mig 278: gate de tenant in DATE pentru orice tabela cu (order_id, restaurant_id) — comanda referita trebuie sa apartina aceluiasi restaurant (hint receipt_tenant_mismatch, aceeasi eroare si pentru comanda inexistenta — fara oracol de existenta). order_id NULL = nimic de verificat. DEFINER: sub INVOKER un rol care nu vede comanda prin RLS ar primi un mesaj fals, iar in cascade gate-ul ar fi orb. Clichet de clasa: TG4.';

-- ── Partea PĂRINTE: orders.restaurant_id e IMUABIL ───────────────────────────
-- Gate-ul de mai sus apără scrierile pe COPII. Politica `orders: admin all`
-- (mig 015/096) permite însă un UPDATE direct prin PostgREST, iar `authenticated`
-- are UPDATE pe coloana `restaurant_id` (verificat pe replay): un cont care e
-- admin la DOUĂ restaurante (lanț, agenție) putea muta o comandă din A în B, iar
-- copiii ei (bon, tichet, factură, feedback) rămâneau cu `restaurant_id = A` —
-- invariantul de mai sus, spart prin părinte, fără ca vreun copil să fie scris
-- (recenzie CodeRabbit pe #259). Mig 113/240 apără doar `table_id` (comenzile
-- pickup n-au masă). Niciun scriitor legitim nu mută comenzi între restaurante
-- (grep pe migrații/funcții/client: zero), deci coloana devine imuabilă, ca
-- `restaurants.owner_id` (096c). Fără DEFINER: compară doar OLD/NEW.
create or replace function public.fn_orders_restaurant_id_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.restaurant_id is distinct from old.restaurant_id then
    raise exception 'orders.restaurant_id este imuabil: comanda % nu poate fi mutată la alt restaurant.', old.id
      using errcode = 'P0001', hint = 'order_restaurant_immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.fn_orders_restaurant_id_immutable() from public, anon, authenticated, service_role;

comment on function public.fn_orders_restaurant_id_immutable() is
  'mig 278: orders.restaurant_id e imuabil (hint order_restaurant_immutable) — partea PARINTE a gate-ului de tenant: o comanda mutata la alt restaurant ar lasa copiii (bon/tichet/factura/feedback) cu restaurant_id-ul vechi.';

drop trigger if exists trg_orders_restaurant_id_immutable on public.orders;
create trigger trg_orders_restaurant_id_immutable
  before update of restaurant_id on public.orders
  for each row execute function public.fn_orders_restaurant_id_immutable();

-- ── Pre-instalare: zero rânduri cross-tenant EXISTENTE (altfel PICĂ) ──────────
do $$
declare v_t text; v_n bigint;
begin
  foreach v_t in array array['pending_receipts', 'kitchen_tickets', 'invoices', 'order_feedback'] loop
    execute format(
      'select count(*) from public.%I r join public.orders o on o.id = r.order_id where o.restaurant_id <> r.restaurant_id',
      v_t) into v_n;
    if v_n <> 0 then
      raise exception 'mig 278: % randuri cross-tenant existente in % — decizie de fondator inainte de gate', v_n, v_t;
    end if;
  end loop;
end $$;

-- ── Gate-ul pe toate tabelele care poartă perechea ───────────────────────────
drop trigger if exists trg_pending_receipts_tenant_guard on public.pending_receipts;
create trigger trg_pending_receipts_tenant_guard
  before insert or update of order_id, restaurant_id on public.pending_receipts
  for each row execute function public.enforce_order_tenant_consistency();

drop trigger if exists trg_kitchen_tickets_tenant_guard on public.kitchen_tickets;
create trigger trg_kitchen_tickets_tenant_guard
  before insert or update of order_id, restaurant_id on public.kitchen_tickets
  for each row execute function public.enforce_order_tenant_consistency();

drop trigger if exists trg_invoices_tenant_guard on public.invoices;
create trigger trg_invoices_tenant_guard
  before insert or update of order_id, restaurant_id on public.invoices
  for each row execute function public.enforce_order_tenant_consistency();

drop trigger if exists trg_order_feedback_tenant_guard on public.order_feedback;
create trigger trg_order_feedback_tenant_guard
  before insert or update of order_id, restaurant_id on public.order_feedback
  for each row execute function public.enforce_order_tenant_consistency();

-- ═════════════════════════════════════════════════════════════════════════════
-- Verificări ONE-SHOT (poziția 278). Permanentele: TG1–TG5.
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare r record; v_missing text[] := '{}'; v_n int;
begin
  for r in
    select c.oid, c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and exists (select 1 from pg_attribute where attrelid = c.oid and attname = 'order_id' and not attisdropped)
       and exists (select 1 from pg_attribute where attrelid = c.oid and attname = 'restaurant_id' and not attisdropped)
  loop
    -- tgtype 23 = BEFORE + INSERT + UPDATE + ROW; lista `UPDATE OF` (tgattr)
    -- trebuie sa contina AMBELE coloane de tenant (sau sa fie goala = toate
    -- coloanele) — un trigger cu `update of status` ar satisface tgtype si ar
    -- lasa UPDATE-ul pe order_id/restaurant_id sa treaca (recenzie #259).
    if not exists (select 1 from pg_trigger t
                    where t.tgrelid = r.oid and not t.tgisinternal and t.tgtype = 23
                      and t.tgfoid = 'public.enforce_order_tenant_consistency'::regproc
                      and (t.tgattr = ''::int2vector
                           or ((select attnum from pg_attribute where attrelid = r.oid and attname = 'order_id') = any (t.tgattr::int2[])
                               and (select attnum from pg_attribute where attrelid = r.oid and attname = 'restaurant_id') = any (t.tgattr::int2[])))) then
      v_missing := v_missing || r.relname;
    end if;
  end loop;
  if array_length(v_missing, 1) > 0 then
    raise exception 'mig 278: tabele cu (order_id, restaurant_id) fara gate de tenant (sau cu lista UPDATE OF incompleta): %', v_missing; end if;
  -- partea parinte: trigger BEFORE UPDATE ROW (tgtype 19) pe orders, cu restaurant_id in lista
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.orders'::regclass and not t.tgisinternal and t.tgtype = 19
                    and t.tgfoid = 'public.fn_orders_restaurant_id_immutable'::regproc
                    and (t.tgattr = ''::int2vector
                         or (select attnum from pg_attribute where attrelid = 'public.orders'::regclass and attname = 'restaurant_id') = any (t.tgattr::int2[]))) then
    raise exception 'mig 278: orders.restaurant_id nu e imuabil (trigger parinte lipsa)'; end if;
  select count(*) into v_n from pg_trigger
   where tgfoid = 'public.enforce_order_tenant_consistency'::regproc and not tgisinternal;
  if v_n < 4 then raise exception 'mig 278: doar % triggere de tenant (asteptat >= 4)', v_n; end if;
  if not exists (select 1 from pg_proc where oid = 'public.enforce_order_tenant_consistency'::regproc
                    and prosecdef and array_to_string(proconfig, ',') like '%pg_temp%') then
    raise exception 'mig 278: functia de gate nu e DEFINER cu pg_temp'; end if;
  if has_function_privilege('anon', 'public.enforce_order_tenant_consistency()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.enforce_order_tenant_consistency()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.enforce_order_tenant_consistency()', 'EXECUTE')
     or has_function_privilege('anon', 'public.fn_orders_restaurant_id_immutable()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.fn_orders_restaurant_id_immutable()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.fn_orders_restaurant_id_immutable()', 'EXECUTE') then
    raise exception 'mig 278: o functie de gate e executabila de un rol client/service'; end if;
  raise notice 'mig 278: gate de tenant pe % tabele cu (order_id, restaurant_id) + orders.restaurant_id imuabil — OK (permanentele: TG1-TG5)', v_n;
end $$;

commit;
