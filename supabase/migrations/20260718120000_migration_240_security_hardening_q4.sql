-- mig 240 — hardening securitate Q4 (re-audit săpt. 10)
-- ─────────────────────────────────────────────────────────────────────
-- Două findings de securitate din re-audit:
--
--   A. orders.table_id mutabil cross-tenant prin UPDATE direct. Trigger-ul
--      `trg_enforce_order_table_tenant` (mig 113) verifică apartenența mesei
--      DOAR pe INSERT (`before insert`). Un UPDATE direct (PostgREST) al
--      orders.table_id la o masă a ALTUI restaurant scapă de verificare.
--      Fix: trigger-ul se declanșează și pe UPDATE (funcția e neschimbată,
--      folosește NEW pentru ambele).
--
--   B. `bridge_devices.device_secret` citibil de ORICE membru. Politica
--      `bridge_devices: members read` (mig 030) folosea is_member → un waiter/
--      kitchen putea citi direct `select device_secret from bridge_devices`
--      (secretul de auth al bridge-ului fiscal). BridgeTab e admin-only (grupul
--      Rapoarte, adminOnly), iar toți cititorii SQL sunt SECURITY DEFINER
--      (scutiți de RLS), deci eliminăm politica de membru: adminii păstrează
--      accesul prin `bridge_devices: admin manage` (FOR ALL).
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── A. table_id: verificare și pe UPDATE ─────────────────────────────
drop trigger if exists trg_enforce_order_table_tenant on public.orders;
create trigger trg_enforce_order_table_tenant
  before insert or update on public.orders
  for each row execute function public.enforce_order_table_tenant();

-- ── B. bridge_devices: secretul nu mai e vizibil membrilor ───────────
drop policy if exists "bridge_devices: members read" on public.bridge_devices;

-- ── Asserții fail-closed ─────────────────────────────────────────────
do $$
begin
  -- trigger-ul se declanșează pe INSERT ȘI UPDATE
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where c.relname = 'orders' and t.tgname = 'trg_enforce_order_table_tenant'
      -- tgtype bit 2 = INSERT (4), bit 4 = UPDATE (16); ambele setate
      and (t.tgtype & 4) <> 0 and (t.tgtype & 16) <> 0
  ) then
    raise exception 'mig 240: trg_enforce_order_table_tenant nu acoperă INSERT+UPDATE';
  end if;

  -- politica de membru pe bridge_devices a dispărut (secretul nu mai leak-uiește)
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'bridge_devices'
      and policyname = 'bridge_devices: members read'
  ) then
    raise exception 'mig 240: politica members read încă expune bridge_devices';
  end if;
  -- adminii păstrează accesul (politica FOR ALL rămâne)
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'bridge_devices'
      and policyname = 'bridge_devices: admin manage'
  ) then
    raise exception 'mig 240: politica admin manage a dispărut din bridge_devices';
  end if;

  raise notice 'mig 240: hardening securitate Q4 (table_id UPDATE + device_secret) OK';
end $$;

commit;
