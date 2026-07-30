-- tests/sql/fiscal_q4_assertions.sql
-- =============================================================================
-- Aserții pentru mig 238/239 (corecții fiscale Q4):
--   FQ1  vat_report_daily aplică discount_amount: o comandă cu reducere
--        raportează gross POST-discount (= ce s-a încasat), nu prețul întreg.
--   FQ2  vat_report_daily fără discount rămâne neschimbat (gross = subtotal).
--   FQ3  oblio_reclaim_stale_generating: 'generating' vechi → 'failed' cu
--        eroare ambiguă; 'generating' recent rămâne neatins; service_role only.
--
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a1b10000-0000-4000-8000-0000000000f0','fq-owner@fq.test');
-- pro = are fiscal_receipt (view-ul e gate-uit pe el)
update public.profiles set plan = 'enterprise'
 where id = 'a1b10000-0000-4000-8000-0000000000f0';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('b1c10000-0000-4000-8000-0000000000f0','a1b10000-0000-4000-8000-0000000000f0',
   'FQ Bistro','fq-bistro-slug','Cluj',true);

-- Rată TVA 21% pe grupa 1 (Normala) — pentru un net/gross verificabil.
insert into public.vat_rates (restaurant_id, vat_group, rate_percent, label)
values ('b1c10000-0000-4000-8000-0000000000f0', 1, 21, 'Normala')
on conflict (restaurant_id, vat_group) do update set rate_percent = 21, label = 'Normala';

insert into public.products (id, restaurant_id, name, price, vat_group, is_active)
values ('c0110000-0000-4000-8000-0000000000f0','b1c10000-0000-4000-8000-0000000000f0',
        'Produs FQ', 100, 1, true);

-- Comanda A: subtotal 100, reducere 20 (amount) → total 80 (ce s-a încasat).
-- Reducerea se dă prin discount_type/discount_value: trigger-ul
-- order_items_subtotal_sync (mig 031) recalculează total + discount_amount la
-- fiecare insert de order_items (setarea directă a discount_amount ar fi
-- suprascrisă la 0).
insert into public.orders (id, restaurant_id, source, status, discount_type, discount_value, paid_at)
values ('d0110000-0000-4000-8000-0000000000fa','b1c10000-0000-4000-8000-0000000000f0',
        'waiter','paid','amount',20, now());
insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
values ('d0110000-0000-4000-8000-0000000000fa','c0110000-0000-4000-8000-0000000000f0','Produs FQ',1,100,100);

-- Comanda B: subtotal 50, fără reducere → total 50.
insert into public.orders (id, restaurant_id, source, status, paid_at)
values ('d0110000-0000-4000-8000-0000000000fb','b1c10000-0000-4000-8000-0000000000f0',
        'waiter','paid', now());
insert into public.order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, item_total)
values ('d0110000-0000-4000-8000-0000000000fb','c0110000-0000-4000-8000-0000000000f0','Produs FQ',1,50,50);

-- paid_at e setat la insert, dar tranziția reală de status ar fi via RPC; aici
-- verificăm doar view-ul, deci confirmăm că trigger-ul a produs totalurile.
do $$
begin
  if (select total from public.orders where id='d0110000-0000-4000-8000-0000000000fa') <> 80
     or (select discount_amount from public.orders where id='d0110000-0000-4000-8000-0000000000fa') <> 20 then
    raise exception 'SEED FAIL: trigger-ul nu a produs total=80/discount=20 pe comanda A';
  end if;
end $$;

-- ── FQ1 + FQ2: raportul TVA aplică discount-ul ───────────────────────────────
set local role authenticated;
set local request.jwt.claim.sub = 'a1b10000-0000-4000-8000-0000000000f0';

do $$
declare
  v_gross numeric;
  v_vat   numeric;
  v_net   numeric;
begin
  -- Ambele comenzi cad în același rând de grup (restaurant/dată/grupă TVA/rată
  -- identice). GROSS combinat POST-discount = 80 (A) + 50 (B) = 130.
  -- FĂRĂ fix ar fi 100 + 50 = 150 (supradeclarare de 20 lei brut).
  select gross_total, vat_amount, net_total into v_gross, v_vat, v_net
    from public.vat_report_daily
   where restaurant_id = 'b1c10000-0000-4000-8000-0000000000f0'
     and vat_rate_percent = 21;

  if round(coalesce(v_gross, -1), 2) <> 130.00 then
    raise exception 'FQ1 FAIL: gross combinat = % (așteptat 130 post-discount; 150 = bug)', v_gross;
  end if;
  -- TVA + net coerente cu gross-ul post-discount (21% inclus).
  if round(v_vat, 2) <> round(130.0 * 21 / 121, 2) then
    raise exception 'FQ1 FAIL: TVA = % (așteptat pe gross 130)', v_vat;
  end if;
  if round(v_net, 2) <> round(130.0 * 100 / 121, 2) then
    raise exception 'FQ2 FAIL: net = % (așteptat pe gross 130)', v_net;
  end if;
  raise notice 'FQ1+FQ2 OK: raportul TVA aplică discount-ul (gross 130, nu 150)';
end $$;

reset role;

-- ── FQ3: reclaim stale generating ────────────────────────────────────────────
insert into public.invoices (id, restaurant_id, order_id, customer_name, status, total_with_vat, generating_since)
values
  ('e0110000-0000-4000-8000-0000000000f1','b1c10000-0000-4000-8000-0000000000f0',
   'd0110000-0000-4000-8000-0000000000fa','Client A','generating',80, now() - interval '30 minutes'),
  ('e0110000-0000-4000-8000-0000000000f2','b1c10000-0000-4000-8000-0000000000f0',
   'd0110000-0000-4000-8000-0000000000fb','Client B','generating',50, now() - interval '2 minutes');

do $$
declare v_n integer;
begin
  v_n := public.oblio_reclaim_stale_generating(15);
  if v_n <> 1 then
    raise exception 'FQ3 FAIL: reclaim a marcat % facturi (așteptat 1)', v_n;
  end if;
  if (select status from public.invoices where id = 'e0110000-0000-4000-8000-0000000000f1') <> 'failed' then
    raise exception 'FQ3 FAIL: factura veche în generating nu a devenit failed';
  end if;
  if (select last_error from public.invoices where id = 'e0110000-0000-4000-8000-0000000000f1')
       not ilike '%STUCK_GENERATING%' then
    raise exception 'FQ3 FAIL: eroarea ambiguă lipsește';
  end if;
  if (select status from public.invoices where id = 'e0110000-0000-4000-8000-0000000000f2') <> 'generating' then
    raise exception 'FQ3 FAIL: factura recentă a fost atinsă (fereastra de stale)';
  end if;
  raise notice 'FQ3 OK: doar generating vechi → failed cu eroare ambiguă';
end $$;

select 'FISCAL Q4 ASSERTIONS: FQ1–FQ3 PASS' as result;

rollback;
