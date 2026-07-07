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
--   TP8  Opt-out client (mig 208): cancel validat pe sesiune+token; rândul
--        fără intent → canceled direct; succeeded nu e anulabil.
--   TP7  Retry de card (mig 207): payment_failed NU e terminal — un
--        succeeded ulterior pe ACELAȘI intent marchează comenzile plătite.
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


-- ── TP7: retry de card — failed apoi succeeded pe ACELAȘI intent (mig 207) ───
do $$
declare
  v_begin  jsonb;
  v_fail   jsonb;
  v_ok     jsonb;
begin
  -- Sesiune + comandă noi (sesiunile anterioare s-au închis la plată).
  insert into public.table_sessions (id, restaurant_id, table_id, status) values
    ('e7e7e7e7-7777-4777-8777-eeeeeeeeeeee','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
     'c1c1c1c1-1111-4111-8111-cccccccccccc','open');
  insert into public.orders (id, restaurant_id, source, status, total, session_id,
                             table_id, qr_token_id) values
    ('f7f7f7f7-7777-4777-8777-ffffffffffff','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','qr','served',33,
     'e7e7e7e7-7777-4777-8777-eeeeeeeeeeee','c1c1c1c1-1111-4111-8111-cccccccccccc','d1d1d1d1-1111-4111-8111-dddddddddddd');

  v_begin := public.begin_table_payment('e7e7e7e7-7777-4777-8777-eeeeeeeeeeee','tok_tp_ent');
  perform public.attach_payment_intent((v_begin->>'payment_id')::uuid, 'pi_tp_retry');

  -- Prima încercare de card pică (webhook payment_failed).
  v_fail := public.settle_table_payment('pi_tp_retry', 'failed', 'card_declined');
  if v_fail->>'status' <> 'failed' then
    raise exception 'TP7 FAIL: primul failed nu s-a înregistrat (%)', v_fail;
  end if;

  -- Clientul reîncearcă în același Payment Element și plata REUȘEȘTE.
  v_ok := public.settle_table_payment('pi_tp_retry', 'succeeded');
  if coalesce((v_ok->>'already_settled')::boolean, false) then
    raise exception 'TP7 FAIL: succeeded după failed a fost blocat ca already_settled — banii luați, comenzile neplătite (bug-ul mig 203)';
  end if;
  if (v_ok->>'orders_paid')::int <> 1 then
    raise exception 'TP7 FAIL: comanda nu a fost marcată plătită după retry (%)', v_ok;
  end if;

  if not exists (
    select 1 from public.orders
     where id = 'f7f7f7f7-7777-4777-8777-ffffffffffff'
       and status = 'paid' and payment_method = 'card_online'
  ) then
    raise exception 'TP7 FAIL: statusul comenzii nu e paid/card_online';
  end if;

  -- Iar un failed ÎNTÂRZIAT (webhook out-of-order) nu mai regresează plata.
  v_fail := public.settle_table_payment('pi_tp_retry', 'failed', 'late_event');
  if coalesce((v_fail->>'already_settled')::boolean, false) is not true
     or v_fail->>'status' <> 'succeeded' then
    raise exception 'TP7 FAIL: failed întârziat a regresat starea succeeded (%)', v_fail;
  end if;

  raise notice 'TP7 OK: failed → succeeded settle-ază; succeeded rămâne terminal';
end $$;


-- ── TP8: opt-out-ul clientului — cancel_table_payment (mig 208) ──────────────
do $$
declare
  v_begin jsonb;
  v_c     jsonb;
begin
  -- Sesiune + comandă noi pe masa TP5 (sesiunile vechi s-au închis la plată).
  insert into public.table_sessions (id, restaurant_id, table_id, status) values
    ('e8e8e8e8-8888-4888-8888-eeeeeeeeeeee','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
     'c3c3c3c3-3333-4333-8333-cccccccccccc','open');
  insert into public.orders (id, restaurant_id, source, status, total, session_id,
                             table_id, qr_token_id) values
    ('f8f8f8f8-8888-4888-8888-ffffffffffff','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','qr','served',12,
     'e8e8e8e8-8888-4888-8888-eeeeeeeeeeee','c3c3c3c3-3333-4333-8333-cccccccccccc','d3d3d3d3-3333-4333-8333-dddddddddddd');

  v_begin := public.begin_table_payment('e8e8e8e8-8888-4888-8888-eeeeeeeeeeee','tok_tp_race');

  -- (a) Token de la ALTĂ masă → respins (nu-ți poți anula plata vecinului).
  begin
    perform public.cancel_table_payment((v_begin->>'payment_id')::uuid,
                                        'e8e8e8e8-8888-4888-8888-eeeeeeeeeeee','tok_tp_ent');
    raise exception 'TP8 FAIL: cancel a trecut cu token de la altă masă';
  exception when others then
    if sqlerrm not ilike '%QR invalid%' then raise; end if;
  end;

  -- (b) Fără intent atașat → canceled direct în RPC.
  v_c := public.cancel_table_payment((v_begin->>'payment_id')::uuid,
                                     'e8e8e8e8-8888-4888-8888-eeeeeeeeeeee','tok_tp_race');
  if coalesce((v_c->>'canceled')::boolean, false) is not true
     or coalesce((v_c->>'no_intent')::boolean, false) is not true then
    raise exception 'TP8 FAIL: rândul fără intent nu s-a anulat direct (%)', v_c;
  end if;
  if not exists (select 1 from public.table_payments
                  where id = (v_begin->>'payment_id')::uuid and status = 'canceled') then
    raise exception 'TP8 FAIL: statusul plății nu e canceled';
  end if;

  -- (c) Cu intent atașat → RPC-ul întoarce datele pentru cancel-ul Stripe.
  v_begin := public.begin_table_payment('e8e8e8e8-8888-4888-8888-eeeeeeeeeeee','tok_tp_race');
  perform public.attach_payment_intent((v_begin->>'payment_id')::uuid, 'pi_tp_cancel');
  v_c := public.cancel_table_payment((v_begin->>'payment_id')::uuid,
                                     'e8e8e8e8-8888-4888-8888-eeeeeeeeeeee','tok_tp_race');
  if coalesce((v_c->>'cancelable')::boolean, false) is not true
     or v_c->>'stripe_payment_intent_id' <> 'pi_tp_cancel' then
    raise exception 'TP8 FAIL: RPC-ul nu a întors intent-ul de anulat (%)', v_c;
  end if;
  perform public.settle_table_payment('pi_tp_cancel', 'canceled', 'Anulat de client.');

  -- (d) Plata anulată nu blochează masa: un begin nou pe aceeași sesiune merge.
  v_begin := public.begin_table_payment('e8e8e8e8-8888-4888-8888-eeeeeeeeeeee','tok_tp_race');
  if (v_begin->>'amount')::numeric <> 12 then
    raise exception 'TP8 FAIL: begin după cancel nu mai vede comanda (%)', v_begin;
  end if;

  -- (e) succeeded nu e anulabil.
  perform public.attach_payment_intent((v_begin->>'payment_id')::uuid, 'pi_tp_cancel2');
  perform public.settle_table_payment('pi_tp_cancel2', 'succeeded');
  v_c := public.cancel_table_payment((v_begin->>'payment_id')::uuid,
                                     'e8e8e8e8-8888-4888-8888-eeeeeeeeeeee','tok_tp_race');
  if coalesce((v_c->>'cancelable')::boolean, true) is not false
     or v_c->>'status' <> 'succeeded' then
    raise exception 'TP8 FAIL: plata reușită a apărut anulabilă (%)', v_c;
  end if;

  raise notice 'TP8 OK: opt-out validat pe masă; fără intent → direct; succeeded protejat';
end $$;

rollback;
