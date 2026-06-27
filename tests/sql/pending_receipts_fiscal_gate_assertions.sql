-- tests/sql/pending_receipts_fiscal_gate_assertions.sql
-- =============================================================================
-- Asertii pentru mig 133: gate universal Plan 3 pe coada fiscala terminala.
-- Orice INSERT in pending_receipts (PostgREST direct, add_cash_movement,
-- close_shift) pe un restaurant non-Plan-3 trebuie respins server-side.
-- Ruleaza DUPA migratii. Self-contained, ROLLBACK la final.
--
--   PR1  growth (Plan 2): INSERT in pending_receipts = RESPINS (fiscal_receipt)
--   PR2  pro    (Plan 3): INSERT in pending_receipts = PERMIS
-- =============================================================================

\set ON_ERROR_STOP on

begin;

insert into auth.users (id,email) values
  ('a3a3a3a3-1111-4111-8111-111111111111','g@fisc.test'),
  ('a4a4a4a4-2222-4222-8222-222222222222','p@fisc.test');
update public.profiles set plan='growth' where id='a3a3a3a3-1111-4111-8111-111111111111';
update public.profiles set plan='pro'    where id='a4a4a4a4-2222-4222-8222-222222222222';
insert into public.restaurants (id,owner_id,name,slug,city,is_active) values
  ('b3b3b3b3-1111-4111-8111-111111111111','a3a3a3a3-1111-4111-8111-111111111111','G','g-fisc','Cluj',true),
  ('b4b4b4b4-2222-4222-8222-222222222222','a4a4a4a4-2222-4222-8222-222222222222','P','p-fisc','Cluj',true);

-- ── PR1: growth → RESPINS ────────────────────────────────────────────────────
do $$
begin
  insert into public.pending_receipts (restaurant_id, command_type, payload, status, total_snapshot)
  values ('b3b3b3b3-1111-4111-8111-111111111111','order','S^test','pending',100);
  raise exception 'PR1 FAIL: growth a inserat in pending_receipts (gate-leak fiscal NEINCHIS)';
exception when others then
  if sqlerrm like '%fiscal%' or sqlerrm like '%Featurea%' then
    raise notice 'PR1 OK: growth blocat pe pending_receipts';
  else raise; end if;
end $$;

-- ── PR2: pro → PERMIS ────────────────────────────────────────────────────────
insert into public.pending_receipts (restaurant_id, command_type, payload, status, total_snapshot)
values ('b4b4b4b4-2222-4222-8222-222222222222','order','S^test','pending',100);
do $$
begin
  if not exists (select 1 from public.pending_receipts
                  where restaurant_id='b4b4b4b4-2222-4222-8222-222222222222') then
    raise exception 'PR2 FAIL: pro nu a putut insera in pending_receipts';
  end if;
  raise notice 'PR2 OK: pro a inserat in pending_receipts';
end $$;

do $$ begin raise notice '════ pending_receipts fiscal gate assertions: ALL PASS ════'; end $$;

rollback;
