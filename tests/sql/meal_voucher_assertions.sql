-- tests/sql/meal_voucher_assertions.sql
-- =============================================================================
-- Aserții pentru mig 230/231 (tichete de masă):
--   MV1  Staff (waiter-capable) înregistrează o plată parțială cu tichete —
--        rând în order_payments, comanda rămâne ne-paid sub total.
--   MV2  Completarea cu tichete → paid, payment_method='meal_voucher',
--        iar maparea fiscală e codul 4 (tichet masă).
--   MV3  Mix tichete + cash → payment_method='other' (cod FiscalNet 8),
--        exact ca orice mix de metode.
--   MV4  'card_online' RĂMÂNE respins în add_partial_payment (plățile online
--        vin doar prin Stripe/settle — invariantul din mig 229).
--   MV5  Regula de aur: pe plan growth (fără fiscal_receipt), tichetele sunt
--        respinse de gate-ul de plan — banii cer Plan 3, indiferent de metodă.
--
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a1b10000-0000-4000-8000-0000000000e1','mv-owner-ent@mv.test'),
  ('a1b20000-0000-4000-8000-0000000000e2','mv-owner-growth@mv.test');

update public.profiles set plan = 'enterprise'
 where id = 'a1b10000-0000-4000-8000-0000000000e1';
update public.profiles set plan = 'growth'
 where id = 'a1b20000-0000-4000-8000-0000000000e2';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('b1c10000-0000-4000-8000-0000000000e1','a1b10000-0000-4000-8000-0000000000e1',
   'MV Enterprise','mv-ent-slug','Cluj',true),
  ('b1c20000-0000-4000-8000-0000000000e2','a1b20000-0000-4000-8000-0000000000e2',
   'MV Growth','mv-growth-slug','Cluj',true);

insert into public.restaurant_memberships (restaurant_id, user_id, role) values
  ('b1c10000-0000-4000-8000-0000000000e1','a1b10000-0000-4000-8000-0000000000e1','owner'),
  ('b1c20000-0000-4000-8000-0000000000e2','a1b20000-0000-4000-8000-0000000000e2','owner')
on conflict (restaurant_id, user_id) do nothing;

insert into public.orders (id, restaurant_id, source, status, total) values
  ('c1d10000-0000-4000-8000-0000000000e1','b1c10000-0000-4000-8000-0000000000e1','waiter','served',100),
  ('c1d20000-0000-4000-8000-0000000000e2','b1c10000-0000-4000-8000-0000000000e1','waiter','served',100),
  ('c1d30000-0000-4000-8000-0000000000e3','b1c20000-0000-4000-8000-0000000000e2','waiter','served',50);

-- Identitatea ownerului enterprise (add_partial_payment cere membership real).
set local role authenticated;
set local request.jwt.claim.sub = 'a1b10000-0000-4000-8000-0000000000e1';

-- ── MV1 + MV2: parțial cu tichete → completare → paid/meal_voucher, cod 4 ────
do $$
declare v jsonb;
begin
  v := public.add_partial_payment('c1d10000-0000-4000-8000-0000000000e1', 40, 'meal_voucher');
  if coalesce((v->>'fully_paid')::boolean, true) then
    raise exception 'MV1 FAIL: 40/100 raportat fully_paid (%)', v;
  end if;

  v := public.add_partial_payment('c1d10000-0000-4000-8000-0000000000e1', 60, 'meal_voucher');
  if (v->>'fully_paid')::boolean is not true then
    raise exception 'MV2 FAIL: 100/100 nu e fully_paid (%)', v;
  end if;
end $$;

reset role;

do $$
begin
  if (select count(*) from public.order_payments
       where order_id = 'c1d10000-0000-4000-8000-0000000000e1'
         and method = 'meal_voucher') <> 2 then
    raise exception 'MV1 FAIL: plățile cu tichete nu sunt în order_payments';
  end if;
  if not exists (select 1 from public.orders
                  where id = 'c1d10000-0000-4000-8000-0000000000e1'
                    and status = 'paid'
                    and payment_method = 'meal_voucher'
                    and paid_amount = 100) then
    raise exception 'MV2 FAIL: comanda nu e paid/meal_voucher/100';
  end if;
  if public.fiscalnet_payment_code('meal_voucher'::public.payment_method) <> 4 then
    raise exception 'MV2 FAIL: maparea fiscală nu e codul 4 (tichet masă)';
  end if;
  raise notice 'MV1+MV2 OK: tichete parțial → complet → paid/meal_voucher, cod P 4';
end $$;

-- ── MV3: mix tichete + cash → payment_method=other (cod 8) ───────────────────
set local role authenticated;
set local request.jwt.claim.sub = 'a1b10000-0000-4000-8000-0000000000e1';

do $$
declare v jsonb;
begin
  v := public.add_partial_payment('c1d20000-0000-4000-8000-0000000000e2', 50, 'meal_voucher');
  v := public.add_partial_payment('c1d20000-0000-4000-8000-0000000000e2', 50, 'cash');
  if (v->>'fully_paid')::boolean is not true then
    raise exception 'MV3 FAIL: mixul 50+50 nu e fully_paid (%)', v;
  end if;
end $$;

-- ── MV4: card_online rămâne interzis pentru staff ────────────────────────────
do $$
begin
  begin
    perform public.add_partial_payment('c1d20000-0000-4000-8000-0000000000e2', 1, 'card_online');
    raise exception 'MV4 FAIL: staff-ul a putut înregistra card_online manual';
  exception when others then
    if sqlerrm not ilike '%invalid%' then raise; end if;
  end;
  raise notice 'MV4 OK: card_online respins în add_partial_payment';
end $$;

reset role;

do $$
begin
  if not exists (select 1 from public.orders
                  where id = 'c1d20000-0000-4000-8000-0000000000e2'
                    and status = 'paid' and payment_method = 'other') then
    raise exception 'MV3 FAIL: mixul nu a dat payment_method=other';
  end if;
  if public.fiscalnet_payment_code('other'::public.payment_method) <> 8 then
    raise exception 'MV3 FAIL: other nu e mapat la codul 8';
  end if;
  raise notice 'MV3 OK: mix tichete+cash → other (cod P 8)';
end $$;

-- ── MV5: regula de aur — tichetele pe growth sunt respinse de gate ───────────
-- Suma e PARȚIALĂ (20 din 50) intenționat: la plata integrală, tranziția →paid
-- ar declanșa trg_orders_paid_fiscal_gate (mig 124), care aruncă ACELAȘI mesaj
-- „Featurea fiscal_receipt..." și ar masca dispariția gate-ului din
-- add_partial_payment (verificat empiric: cu gate-ul șters din RPC, varianta
-- pe sumă integrală trecea verde). Sub total, trigger-ul nu se atinge — doar
-- gate-ul propriu al RPC-ului poate respinge.
set local role authenticated;
set local request.jwt.claim.sub = 'a1b20000-0000-4000-8000-0000000000e2';

do $$
begin
  begin
    perform public.add_partial_payment('c1d30000-0000-4000-8000-0000000000e3', 20, 'meal_voucher');
    raise exception 'MV5 FAIL: plată cu tichete acceptată pe growth (regula de aur spartă)';
  exception when others then
    if sqlerrm like '%Featurea%' or sqlerrm ilike '%plan%' then
      raise notice 'MV5 OK: tichetele cer Plan 3, ca orice bani';
    else
      raise;
    end if;
  end;
end $$;

reset role;

-- Defense-in-depth: niciun ban înregistrat pe comanda growth, indiferent de
-- mesajul de eroare care a oprit apelul.
do $$
begin
  if (select count(*) from public.order_payments
       where order_id = 'c1d30000-0000-4000-8000-0000000000e3') <> 0 then
    raise exception 'MV5 FAIL: order_payments are rânduri pe comanda growth (bani fără Plan 3)';
  end if;
end $$;

select 'MEAL VOUCHER ASSERTIONS: MV1–MV5 PASS' as result;

rollback;
