-- tests/sql/table_payment_assertions.sql
-- =============================================================================
-- Aserții pentru mig 202/203: plata online la masă (Etapa 1).
--
--   TP1  Gate de plan (regula de aur): restaurant pe 'free' → begin respins
--        cu feature_disabled, chiar cu modul ON + cont Stripe conectat.
--   TP2  Modul dezactivat → begin respins cu module_disabled (plan OK).
--   TP3  Happy path: begin întoarce suma corectă server-side (doar comenzile
--        neplătite ale sesiunii) → attach → settle succeeded → comenzile devin
--        paid cu payment_method='card_online' și paid_amount=total.
--   TP4  Idempotență: al doilea settle pe același intent → already_settled,
--        fără să atingă comenzile.
--   TP5  Race: o comandă plătită cash ÎNTRE begin și settle e SĂRITĂ (rămâne
--        pe cash), restul se plătesc; settle_note e populat.
--   TP6  Cablajul fiscal: triggerul enqueue_fiscal_receipt e atașat pe orders
--        (bonul pleacă din aceeași tranziție 'paid') + maparea card_online→7.
--
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
-- Owner enterprise (gate-ul de plan trece) + owner free (TP1).
insert into auth.users (id, email) values
  ('a1a1a1a1-1111-4111-8111-aaaaaaaaaaaa','tp-owner-ent@tp.test'),
  ('a2a2a2a2-2222-4222-8222-aaaaaaaaaaaa','tp-owner-free@tp.test');

update public.profiles set plan = 'enterprise'
 where id = 'a1a1a1a1-1111-4111-8111-aaaaaaaaaaaa';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','a1a1a1a1-1111-4111-8111-aaaaaaaaaaaa',
   'TP Enterprise','tp-enterprise-slug','Cluj',true),
  ('b2b2b2b2-2222-4222-8222-bbbbbbbbbbbb','a2a2a2a2-2222-4222-8222-aaaaaaaaaaaa',
   'TP Free','tp-free-slug','Cluj',true);

update public.restaurants set stripe_account_id = 'acct_test_tp'
 where id in ('b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','b2b2b2b2-2222-4222-8222-bbbbbbbbbbbb');

insert into public.restaurant_modules (restaurant_id, module_key, enabled) values
  ('b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','online_payments',true),
  ('b2b2b2b2-2222-4222-8222-bbbbbbbbbbbb','online_payments',true);

insert into public.tables (id, restaurant_id, name, slug, seats, is_active) values
  ('c1c1c1c1-1111-4111-8111-cccccccccccc','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','Masa TP1','masa-tp1',4,true),
  ('c2c2c2c2-2222-4222-8222-cccccccccccc','b2b2b2b2-2222-4222-8222-bbbbbbbbbbbb','Masa TPF','masa-tpf',4,true),
  ('c3c3c3c3-3333-4333-8333-cccccccccccc','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','Masa TP5','masa-tp5',4,true);

insert into public.qr_tokens (id, restaurant_id, table_id, token, is_active) values
  ('d1d1d1d1-1111-4111-8111-dddddddddddd','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
   'c1c1c1c1-1111-4111-8111-cccccccccccc','tok_tp_ent',true),
  ('d2d2d2d2-2222-4222-8222-dddddddddddd','b2b2b2b2-2222-4222-8222-bbbbbbbbbbbb',
   'c2c2c2c2-2222-4222-8222-cccccccccccc','tok_tp_free',true),
  ('d3d3d3d3-3333-4333-8333-dddddddddddd','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
   'c3c3c3c3-3333-4333-8333-cccccccccccc','tok_tp_race',true);

insert into public.table_sessions (id, restaurant_id, table_id, status) values
  ('e1e1e1e1-1111-4111-8111-eeeeeeeeeeee','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
   'c1c1c1c1-1111-4111-8111-cccccccccccc','open'),
  ('e2e2e2e2-2222-4222-8222-eeeeeeeeeeee','b2b2b2b2-2222-4222-8222-bbbbbbbbbbbb',
   'c2c2c2c2-2222-4222-8222-cccccccccccc','open'),
  ('e3e3e3e3-3333-4333-8333-eeeeeeeeeeee','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
   'c3c3c3c3-3333-4333-8333-cccccccccccc','open');

-- Comenzile sesiunii enterprise: 30 + 20 de plătit, una deja plătită (NU intră).
insert into public.orders (id, restaurant_id, source, status, total, session_id,
                           table_id, qr_token_id) values
  ('f1f1f1f1-1111-4111-8111-ffffffffffff','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','qr','served',30,
   'e1e1e1e1-1111-4111-8111-eeeeeeeeeeee','c1c1c1c1-1111-4111-8111-cccccccccccc','d1d1d1d1-1111-4111-8111-dddddddddddd'),
  ('f2f2f2f2-2222-4222-8222-ffffffffffff','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','qr','confirmed',20,
   'e1e1e1e1-1111-4111-8111-eeeeeeeeeeee','c1c1c1c1-1111-4111-8111-cccccccccccc','d1d1d1d1-1111-4111-8111-dddddddddddd');
-- Comanda deja plătită (cash) a sesiunii — begin NU trebuie s-o includă.
insert into public.orders (id, restaurant_id, source, status, total, session_id,
                           table_id, qr_token_id) values
  ('f0f0f0f0-0000-4000-8000-ffffffffffff','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','qr','served',15,
   'e1e1e1e1-1111-4111-8111-eeeeeeeeeeee','c1c1c1c1-1111-4111-8111-cccccccccccc','d1d1d1d1-1111-4111-8111-dddddddddddd');
update public.orders set status='paid', payment_method='cash', paid_amount=15, paid_at=now()
 where id = 'f0f0f0f0-0000-4000-8000-ffffffffffff';

-- Sesiunea free NU are comenzi: planul free nici nu poate crea comenzi
-- (enforce_ordering_enabled la INSERT). Nu contează — gate-ul de plan din
-- begin_table_payment pică ÎNAINTE de calculul sumei, exact ce testăm în TP1.

-- Sesiunea de race (TP5): două comenzi de 25 fiecare.
insert into public.orders (id, restaurant_id, source, status, total, session_id,
                           table_id, qr_token_id) values
  ('f5f5f5f5-5555-4555-8555-ffffffffffff','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','qr','served',25,
   'e3e3e3e3-3333-4333-8333-eeeeeeeeeeee','c3c3c3c3-3333-4333-8333-cccccccccccc','d3d3d3d3-3333-4333-8333-dddddddddddd'),
  ('f6f6f6f6-6666-4666-8666-ffffffffffff','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','qr','served',25,
   'e3e3e3e3-3333-4333-8333-eeeeeeeeeeee','c3c3c3c3-3333-4333-8333-cccccccccccc','d3d3d3d3-3333-4333-8333-dddddddddddd');

-- ── TP1: plan free → feature_disabled ────────────────────────────────────────
do $$
begin
  begin
    perform public.begin_table_payment('e2e2e2e2-2222-4222-8222-eeeeeeeeeeee','tok_tp_free');
    raise exception 'TP1 FAIL: begin_table_payment a trecut pe plan free (regula de aur spartă)';
  exception when others then
    if sqlerrm like '%Featurea%' or sqlerrm ilike '%plan%' then
      raise notice 'TP1 OK: planul free e respins server-side';
    else
      raise;
    end if;
  end;
end $$;

-- ── TP2: modul OFF → module_disabled ─────────────────────────────────────────
do $$
begin
  update public.restaurant_modules set enabled=false
   where restaurant_id='b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb' and module_key='online_payments';
  begin
    perform public.begin_table_payment('e1e1e1e1-1111-4111-8111-eeeeeeeeeeee','tok_tp_ent');
    raise exception 'TP2 FAIL: begin a trecut cu modulul dezactivat';
  exception when others then
    if sqlerrm ilike '%nu este activat%' then
      raise notice 'TP2 OK: modulul dezactivat blochează plata';
    else
      raise;
    end if;
  end;
  update public.restaurant_modules set enabled=true
   where restaurant_id='b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb' and module_key='online_payments';
end $$;

-- ── TP3: happy path — sumă server-side + settle → paid card_online ───────────
do $$
declare
  v_begin  jsonb;
  v_settle jsonb;
  v_cnt    integer;
begin
  v_begin := public.begin_table_payment('e1e1e1e1-1111-4111-8111-eeeeeeeeeeee','tok_tp_ent');

  -- Suma = 30 + 20 (comanda deja plătită de 15 NU intră).
  if (v_begin->>'amount')::numeric <> 50 then
    raise exception 'TP3 FAIL: suma calculată e % (așteptat 50)', v_begin->>'amount';
  end if;
  if jsonb_array_length(v_begin->'order_ids') <> 2 then
    raise exception 'TP3 FAIL: order_ids are % elemente (așteptat 2)',
      jsonb_array_length(v_begin->'order_ids');
  end if;
  if v_begin->>'stripe_account_id' <> 'acct_test_tp' then
    raise exception 'TP3 FAIL: stripe_account_id lipsă din răspuns';
  end if;

  perform public.attach_payment_intent((v_begin->>'payment_id')::uuid, 'pi_tp_test_1');

  v_settle := public.settle_table_payment('pi_tp_test_1', 'succeeded');
  if (v_settle->>'orders_paid')::int <> 2 or (v_settle->>'orders_skipped')::int <> 0 then
    raise exception 'TP3 FAIL: settle a raportat paid=% skipped=%',
      v_settle->>'orders_paid', v_settle->>'orders_skipped';
  end if;

  select count(*) into v_cnt
    from public.orders
   where id in ('f1f1f1f1-1111-4111-8111-ffffffffffff','f2f2f2f2-2222-4222-8222-ffffffffffff')
     and status = 'paid'
     and payment_method = 'card_online'
     and paid_amount = total;
  if v_cnt <> 2 then
    raise exception 'TP3 FAIL: comenzile nu au ajuns paid/card_online (găsite %)', v_cnt;
  end if;

  raise notice 'TP3 OK: begin(50 lei, 2 comenzi) → settle → paid card_online';
end $$;

-- ── TP4: idempotență settle ──────────────────────────────────────────────────
do $$
declare
  v_again jsonb;
begin
  v_again := public.settle_table_payment('pi_tp_test_1', 'succeeded');
  if coalesce((v_again->>'already_settled')::boolean, false) is not true then
    raise exception 'TP4 FAIL: al doilea settle nu a raportat already_settled';
  end if;
  raise notice 'TP4 OK: settle idempotent pe intent id';
end $$;

-- ── TP5: race — comandă plătită cash între begin și settle → sărită ──────────
do $$
declare
  v_begin  jsonb;
  v_settle jsonb;
  v_method public.payment_method;
begin
  v_begin := public.begin_table_payment('e3e3e3e3-3333-4333-8333-eeeeeeeeeeee','tok_tp_race');
  if (v_begin->>'amount')::numeric <> 50 then
    raise exception 'TP5 FAIL: suma race-session e % (așteptat 50)', v_begin->>'amount';
  end if;
  perform public.attach_payment_intent((v_begin->>'payment_id')::uuid, 'pi_tp_test_2');

  -- Ospătarul încasează cash una din comenzi ÎNTRE begin și settle.
  update public.orders
     set status='paid', payment_method='cash', paid_amount=total, paid_at=now()
   where id = 'f5f5f5f5-5555-4555-8555-ffffffffffff';

  v_settle := public.settle_table_payment('pi_tp_test_2', 'succeeded');
  if (v_settle->>'orders_paid')::int <> 1 or (v_settle->>'orders_skipped')::int <> 1 then
    raise exception 'TP5 FAIL: settle a raportat paid=% skipped=% (așteptat 1/1)',
      v_settle->>'orders_paid', v_settle->>'orders_skipped';
  end if;

  -- Comanda încasată cash NU e rescrisă pe card_online.
  select payment_method into v_method
    from public.orders where id = 'f5f5f5f5-5555-4555-8555-ffffffffffff';
  if v_method <> 'cash' then
    raise exception 'TP5 FAIL: comanda cash a fost suprascrisă cu %', v_method;
  end if;

  if not exists (
    select 1 from public.table_payments
     where stripe_payment_intent_id = 'pi_tp_test_2'
       and status = 'succeeded'
       and settle_note is not null
  ) then
    raise exception 'TP5 FAIL: settle_note nu a fost populat pe race';
  end if;

  raise notice 'TP5 OK: comanda plătită cash între timp e sărită + notată';
end $$;

-- ── TP6: cablajul fiscal rămâne pe tranziția paid ────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.orders'::regclass
       and tgname  = 'enqueue_fiscal_receipt_trg'
       and not tgisinternal
       and tgenabled in ('O','A')
  ) then
    raise exception 'TP6 FAIL: enqueue_fiscal_receipt_trg lipsește/e dezactivat pe orders';
  end if;
  if public.fiscalnet_payment_code('card_online'::public.payment_method) <> 7 then
    raise exception 'TP6 FAIL: card_online nu e mapat la codul FiscalNet 7';
  end if;
  raise notice 'TP6 OK: bonul pleacă din aceeași tranziție paid (cod 7 pe P^)';
end $$;

rollback;
