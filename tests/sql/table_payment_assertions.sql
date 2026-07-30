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
--   TP9  Gate de monedă (mig 209): restaurant cu currency='EUR' → begin
--        respins cu currency_not_supported (bonul fiscal e RON-only);
--        după reset la RON, gate-ul nu mai blochează.
--   TP10 F1 (mig 211): plată parțială cash luată ÎNTRE begin și settle →
--        comanda e SĂRITĂ (rămâne pe fluxul de staff) + notată.
--   TP11 F2 (mig 211): totalul editat între begin și settle → comanda se
--        plătește (banii au venit), dar diferența e notată în settle_note.
--   TP12 F3 (mig 211): al doilea begin pe aceeași sesiune întoarce intent-ul
--        vechi în superseded_intents (rândul rămâne processing — mutația e a
--        funcției Netlify); rândurile 'created' fără intent se anulează direct.
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

-- ── TP9: monedă ≠ RON → currency_not_supported (mig 209) ─────────────────────
-- Gate-ul de monedă pică ÎNAINTE de calculul sumei, deci sesiunea nu are
-- nevoie de comenzi; controlul pozitiv (după reset la RON) trebuie să ajungă
-- la nothing_to_pay — dovada că DOAR moneda bloca.
do $$
declare
  v_hint text;
begin
  insert into public.table_sessions (id, restaurant_id, table_id, status) values
    ('e9e9e9e9-9999-4999-8999-eeeeeeeeeeee','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
     'c3c3c3c3-3333-4333-8333-cccccccccccc','open');

  update public.restaurants set currency = 'EUR'
   where id = 'b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb';

  begin
    perform public.begin_table_payment('e9e9e9e9-9999-4999-8999-eeeeeeeeeeee','tok_tp_race');
    raise exception 'TP9 FAIL: begin a trecut cu moneda EUR (ar încasa RON pentru prețuri EUR)';
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint <> 'currency_not_supported' then
      raise;
    end if;
  end;

  update public.restaurants set currency = 'RON'
   where id = 'b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb';

  begin
    perform public.begin_table_payment('e9e9e9e9-9999-4999-8999-eeeeeeeeeeee','tok_tp_race');
    raise exception 'TP9 FAIL: begin a trecut pe o sesiune fără comenzi';
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint <> 'nothing_to_pay' then
      raise;
    end if;
  end;

  raise notice 'TP9 OK: moneda ≠ RON e respinsă fail-closed; RON trece de gate';
end $$;

-- ── TP10: plată parțială cash între begin și settle → sărită + notată (F1) ────
do $$
declare
  v_begin jsonb;
  v_res   jsonb;
begin
  insert into public.tables (id, restaurant_id, name, slug, seats, is_active) values
    ('c4c4c4c4-4444-4444-8444-cccccccccccc','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','Masa TP10','masa-tp10',4,true);
  insert into public.qr_tokens (id, restaurant_id, table_id, token, is_active) values
    ('d4d4d4d4-4444-4444-8444-dddddddddddd','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
     'c4c4c4c4-4444-4444-8444-cccccccccccc','tok_tp10',true);
  insert into public.table_sessions (id, restaurant_id, table_id, status) values
    ('eaeaeaea-aaaa-4aaa-8aaa-eeeeeeeeeeee','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
     'c4c4c4c4-4444-4444-8444-cccccccccccc','open');
  insert into public.orders (id, restaurant_id, source, status, total, session_id,
                             table_id, qr_token_id) values
    ('fafafafa-aaaa-4aaa-8aaa-ffffffffffff','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','qr','served',50,
     'eaeaeaea-aaaa-4aaa-8aaa-eeeeeeeeeeee','c4c4c4c4-4444-4444-8444-cccccccccccc','d4d4d4d4-4444-4444-8444-dddddddddddd');

  v_begin := public.begin_table_payment('eaeaeaea-aaaa-4aaa-8aaa-eeeeeeeeeeee','tok_tp10');
  perform public.attach_payment_intent((v_begin->>'payment_id')::uuid, 'pi_tp10');

  -- Ospătarul ia 20 cash parțial ÎNTRE begin și confirmarea online.
  insert into public.order_payments (order_id, amount, method)
  values ('fafafafa-aaaa-4aaa-8aaa-ffffffffffff', 20, 'cash');

  v_res := public.settle_table_payment('pi_tp10', 'succeeded');
  if (v_res->>'orders_partial')::int <> 1 or (v_res->>'orders_paid')::int <> 0 then
    raise exception 'TP10 FAIL: comanda cu plată parțială nu a fost sărită (%)', v_res;
  end if;
  if exists (select 1 from public.orders
              where id = 'fafafafa-aaaa-4aaa-8aaa-ffffffffffff' and status = 'paid') then
    raise exception 'TP10 FAIL: comanda cu parțial cash a fost marcată card_online (dublă încasare)';
  end if;
  if not exists (select 1 from public.table_payments
                  where stripe_payment_intent_id = 'pi_tp10'
                    and status = 'succeeded'
                    and settle_note ilike '%parțiale%') then
    raise exception 'TP10 FAIL: settle_note nu semnalează plățile parțiale';
  end if;

  raise notice 'TP10 OK: plata parțială cash e sărită + notată (fără dublă încasare tăcută)';
end $$;

-- ── TP11: total editat între begin și settle → plătit + diferența notată (F2) ─
do $$
declare
  v_begin jsonb;
  v_res   jsonb;
begin
  insert into public.tables (id, restaurant_id, name, slug, seats, is_active) values
    ('c5c5c5c5-5555-4555-8555-cccccccccccc','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','Masa TP11','masa-tp11',4,true);
  insert into public.qr_tokens (id, restaurant_id, table_id, token, is_active) values
    ('d5d5d5d5-5555-4555-8555-dddddddddddd','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
     'c5c5c5c5-5555-4555-8555-cccccccccccc','tok_tp11',true);
  insert into public.table_sessions (id, restaurant_id, table_id, status) values
    ('ebebebeb-bbbb-4bbb-8bbb-eeeeeeeeeeee','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
     'c5c5c5c5-5555-4555-8555-cccccccccccc','open');
  insert into public.orders (id, restaurant_id, source, status, total, session_id,
                             table_id, qr_token_id) values
    ('fbfbfbfb-bbbb-4bbb-8bbb-ffffffffffff','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','qr','served',30,
     'ebebebeb-bbbb-4bbb-8bbb-eeeeeeeeeeee','c5c5c5c5-5555-4555-8555-cccccccccccc','d5d5d5d5-5555-4555-8555-dddddddddddd');

  v_begin := public.begin_table_payment('ebebebeb-bbbb-4bbb-8bbb-eeeeeeeeeeee','tok_tp11');
  if (v_begin->'order_totals') is not null then
    null; -- snapshot-ul nu se întoarce clientului; doar verificăm pe rând mai jos
  end if;
  perform public.attach_payment_intent((v_begin->>'payment_id')::uuid, 'pi_tp11');

  -- Staff-ul modifică comanda (30 → 35) în timp ce clientul confirmă 30.
  update public.orders set total = 35
   where id = 'fbfbfbfb-bbbb-4bbb-8bbb-ffffffffffff';

  v_res := public.settle_table_payment('pi_tp11', 'succeeded');
  if (v_res->>'orders_paid')::int <> 1 or (v_res->>'orders_changed')::int <> 1 then
    raise exception 'TP11 FAIL: diferența de total nu a fost detectată (%)', v_res;
  end if;
  if not exists (select 1 from public.orders
                  where id = 'fbfbfbfb-bbbb-4bbb-8bbb-ffffffffffff'
                    and status = 'paid' and payment_method = 'card_online') then
    raise exception 'TP11 FAIL: comanda nu a fost plătită (clientul chiar a plătit snapshot-ul)';
  end if;
  if not exists (select 1 from public.table_payments
                  where stripe_payment_intent_id = 'pi_tp11'
                    and settle_note ilike '%modificate%') then
    raise exception 'TP11 FAIL: settle_note nu semnalează totalul modificat';
  end if;

  raise notice 'TP11 OK: totalul editat în timpul plății e plătit + reconciliere vizibilă';
end $$;

-- ── TP12: un singur intent live per sesiune — supersede la begin (F3) ─────────
do $$
declare
  v1 jsonb;
  v2 jsonb;
  v3 jsonb;
begin
  insert into public.tables (id, restaurant_id, name, slug, seats, is_active) values
    ('c6c6c6c6-6666-4666-8666-cccccccccccc','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','Masa TP12','masa-tp12',4,true);
  insert into public.qr_tokens (id, restaurant_id, table_id, token, is_active) values
    ('d6d6d6d6-6666-4666-8666-dddddddddddd','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
     'c6c6c6c6-6666-4666-8666-cccccccccccc','tok_tp12',true);
  insert into public.table_sessions (id, restaurant_id, table_id, status) values
    ('ecececec-cccc-4ccc-8ccc-eeeeeeeeeeee','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
     'c6c6c6c6-6666-4666-8666-cccccccccccc','open');
  insert into public.orders (id, restaurant_id, source, status, total, session_id,
                             table_id, qr_token_id) values
    ('fcfcfcfc-cccc-4ccc-8ccc-ffffffffffff','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','qr','served',40,
     'ecececec-cccc-4ccc-8ccc-eeeeeeeeeeee','c6c6c6c6-6666-4666-8666-cccccccccccc','d6d6d6d6-6666-4666-8666-dddddddddddd');

  -- Telefonul A: primul begin — nimic de înlocuit.
  v1 := public.begin_table_payment('ecececec-cccc-4ccc-8ccc-eeeeeeeeeeee','tok_tp12');
  if v1->'superseded_intents' <> '[]'::jsonb then
    raise exception 'TP12 FAIL: primul begin nu trebuia să înlocuiască nimic (%)', v1;
  end if;
  perform public.attach_payment_intent((v1->>'payment_id')::uuid, 'pi_tp12_a');

  -- Telefonul B: al doilea begin — intent-ul lui A e raportat spre anulare,
  -- dar rândul lui rămâne 'processing' (mutația vine DUPĂ cancel-ul Stripe).
  v2 := public.begin_table_payment('ecececec-cccc-4ccc-8ccc-eeeeeeeeeeee','tok_tp12');
  if not ((v2->'superseded_intents') ? 'pi_tp12_a') then
    raise exception 'TP12 FAIL: intent-ul telefonului A nu apare în superseded_intents (%)', v2;
  end if;
  if not exists (select 1 from public.table_payments
                  where stripe_payment_intent_id = 'pi_tp12_a' and status = 'processing') then
    raise exception 'TP12 FAIL: rândul lui A a fost mutat în RPC (webhook-ul de succeeded nu l-ar mai găsi)';
  end if;

  -- Telefonul C: rândul lui B ('created', fără intent) se anulează DIRECT.
  v3 := public.begin_table_payment('ecececec-cccc-4ccc-8ccc-eeeeeeeeeeee','tok_tp12');
  if not exists (select 1 from public.table_payments
                  where id = (v2->>'payment_id')::uuid and status = 'canceled') then
    raise exception 'TP12 FAIL: rândul fără intent nu a fost anulat la begin-ul următor';
  end if;
  if not ((v3->'superseded_intents') ? 'pi_tp12_a') then
    raise exception 'TP12 FAIL: intent-ul viu al lui A trebuie raportat și la al treilea begin (%)', v3;
  end if;

  raise notice 'TP12 OK: un singur intent live per sesiune; rândurile fără intent se curăță';
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- TP13–TP20: split pe itemi (mig 229). Comenzile de aici au order_items REALE —
-- INSERT-ul în order_items declanșează recalc_order_subtotal → orders.total se
-- calculează singur (NU se setează manual pe aceste comenzi).
-- ═════════════════════════════════════════════════════════════════════════════

-- ── TP13: gate dublu — plan free + split_bill OFF pe enterprise ──────────────
do $$
begin
  -- (a) Plan free → respins la gate-ul de plan (claims shape-valide ca să
  -- ajungem la gate, conținutul nu mai contează).
  begin
    perform public.begin_split_payment('e2e2e2e2-2222-4222-8222-eeeeeeeeeeee','tok_tp_free',
      '[{"order_item_id":"00000000-0000-4000-8000-000000000000","quantity":1}]'::jsonb);
    raise exception 'TP13 FAIL: begin_split_payment a trecut pe plan free';
  exception when others then
    if sqlerrm like '%Featurea%' or sqlerrm ilike '%plan%' then null; else raise; end if;
  end;

  -- (b) split_bill dezactivat pe enterprise → respins (online_payments singur
  -- NU e suficient).
  update public.plan_features set enabled = false
   where plan = 'enterprise' and feature = 'split_bill';
  begin
    perform public.begin_split_payment('e9e9e9e9-9999-4999-8999-eeeeeeeeeeee','tok_tp_race',
      '[{"order_item_id":"00000000-0000-4000-8000-000000000000","quantity":1}]'::jsonb);
    raise exception 'TP13 FAIL: begin_split_payment a trecut fără split_bill';
  exception when others then
    if sqlerrm like '%Featurea%' or sqlerrm ilike '%plan%' then null; else raise; end if;
  end;
  update public.plan_features set enabled = true
   where plan = 'enterprise' and feature = 'split_bill';

  raise notice 'TP13 OK: gate dublu online_payments + split_bill (regula de aur)';
end $$;

-- Seed comun split: masă + sesiune + comandă cu 2 itemi (2×10 + 1×30 → total 50).
insert into public.tables (id, restaurant_id, name, slug, seats, is_active) values
  ('c7c7c7c7-7777-4777-8777-cccccccccccc','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','Masa TP14','masa-tp14',4,true);
insert into public.qr_tokens (id, restaurant_id, table_id, token, is_active) values
  ('d7d7d7d7-7777-4777-8777-dddddddddddd','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
   'c7c7c7c7-7777-4777-8777-cccccccccccc','tok_tp14',true);
insert into public.table_sessions (id, restaurant_id, table_id, status) values
  ('ed14ed14-1414-4141-8141-eeeeeeeeeeee','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
   'c7c7c7c7-7777-4777-8777-cccccccccccc','open');
insert into public.orders (id, restaurant_id, source, status, total, session_id,
                           table_id, qr_token_id) values
  ('a14aa14a-1414-4141-8141-ffffffffffff','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','qr','served',0,
   'ed14ed14-1414-4141-8141-eeeeeeeeeeee','c7c7c7c7-7777-4777-8777-cccccccccccc','d7d7d7d7-7777-4777-8777-dddddddddddd');
insert into public.order_items (id, order_id, product_name_snapshot, unit_price_snapshot,
                                quantity, item_total) values
  ('11141114-1414-4141-8141-000000000001','a14aa14a-1414-4141-8141-ffffffffffff','Pizza TP',10,2,20),
  ('11141114-1414-4141-8141-000000000002','a14aa14a-1414-4141-8141-ffffffffffff','Paste TP',30,1,30);

-- ── TP14: happy path parțial — claim 1×Pizza → 10 lei; comanda RĂMÂNE ne-paid ─
do $$
declare
  v_begin  jsonb;
  v_settle jsonb;
begin
  v_begin := public.begin_split_payment('ed14ed14-1414-4141-8141-eeeeeeeeeeee','tok_tp14',
    '[{"order_item_id":"11141114-1414-4141-8141-000000000001","quantity":1}]'::jsonb);
  if (v_begin->>'amount')::numeric <> 10 then
    raise exception 'TP14 FAIL: suma claim-ului e % (așteptat 10)', v_begin->>'amount';
  end if;
  perform public.attach_payment_intent((v_begin->>'payment_id')::uuid, 'pi_tp14');

  v_settle := public.settle_table_payment('pi_tp14', 'succeeded');
  if v_settle->>'kind' <> 'split'
     or (v_settle->>'orders_partial')::int <> 1
     or (v_settle->>'orders_paid')::int <> 0 then
    raise exception 'TP14 FAIL: settle split a raportat % (așteptat partial=1)', v_settle;
  end if;
  if not exists (
    select 1 from public.order_payments
     where order_id = 'a14aa14a-1414-4141-8141-ffffffffffff'
       and method = 'card_online' and amount = 10
  ) then
    raise exception 'TP14 FAIL: plata parțială nu a intrat în order_payments';
  end if;
  if exists (select 1 from public.orders
              where id = 'a14aa14a-1414-4141-8141-ffffffffffff' and status = 'paid') then
    raise exception 'TP14 FAIL: comanda a fost marcată paid la 10/50';
  end if;
  raise notice 'TP14 OK: split parțial → order_payments(card_online), comanda deschisă';
end $$;

-- ── TP15: completarea — restul itemilor → comanda devine paid + bonul unic ────
do $$
declare
  v_begin  jsonb;
  v_settle jsonb;
begin
  v_begin := public.begin_split_payment('ed14ed14-1414-4141-8141-eeeeeeeeeeee','tok_tp14',
    '[{"order_item_id":"11141114-1414-4141-8141-000000000001","quantity":1},
      {"order_item_id":"11141114-1414-4141-8141-000000000002","quantity":1}]'::jsonb);
  -- Restul comenzii: 50 − 10 deja plătit = 40 EXACT (absorbția restului).
  if (v_begin->>'amount')::numeric <> 40 then
    raise exception 'TP15 FAIL: restul e % (așteptat 40)', v_begin->>'amount';
  end if;
  perform public.attach_payment_intent((v_begin->>'payment_id')::uuid, 'pi_tp15');

  v_settle := public.settle_table_payment('pi_tp15', 'succeeded');
  if (v_settle->>'orders_paid')::int <> 1 then
    raise exception 'TP15 FAIL: comanda nu a fost închisă la acoperirea totalului (%)', v_settle;
  end if;
  if not exists (
    select 1 from public.orders
     where id = 'a14aa14a-1414-4141-8141-ffffffffffff'
       and status = 'paid' and payment_method = 'card_online' and paid_amount = 50
  ) then
    raise exception 'TP15 FAIL: comanda nu e paid/card_online/50';
  end if;
  raise notice 'TP15 OK: completarea split-ului → paid, UN bon prin triggerul fiscal';
end $$;

-- ── TP16: conflict de claims între telefoane + eliberare prin cancel ──────────
do $$
declare
  v_a jsonb;
  v_b jsonb;
begin
  insert into public.table_sessions (id, restaurant_id, table_id, status) values
    ('ed16ed16-1616-4161-8161-eeeeeeeeeeee','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
     'c7c7c7c7-7777-4777-8777-cccccccccccc','open');
  insert into public.orders (id, restaurant_id, source, status, total, session_id,
                             table_id, qr_token_id) values
    ('a16aa16a-1616-4161-8161-ffffffffffff','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','qr','served',0,
     'ed16ed16-1616-4161-8161-eeeeeeeeeeee','c7c7c7c7-7777-4777-8777-cccccccccccc','d7d7d7d7-7777-4777-8777-dddddddddddd');
  insert into public.order_items (id, order_id, product_name_snapshot, unit_price_snapshot,
                                  quantity, item_total) values
    ('11161116-1616-4161-8161-000000000001','a16aa16a-1616-4161-8161-ffffffffffff','Mici TP',16,1,16);

  -- Telefonul A revendică singurul item (rând 'created', fără intent).
  v_a := public.begin_split_payment('ed16ed16-1616-4161-8161-eeeeeeeeeeee','tok_tp14',
    '[{"order_item_id":"11161116-1616-4161-8161-000000000001","quantity":1}]'::jsonb);

  -- Telefonul B pe ACELAȘI item → refuz curat.
  begin
    perform public.begin_split_payment('ed16ed16-1616-4161-8161-eeeeeeeeeeee','tok_tp14',
      '[{"order_item_id":"11161116-1616-4161-8161-000000000001","quantity":1}]'::jsonb);
    raise exception 'TP16 FAIL: claims duplicate acceptate (dublă încasare posibilă)';
  exception when others then
    if sqlerrm not ilike '%revendicate%' then raise; end if;
  end;

  -- A se răzgândește (cancel pe rândul fără intent) → claims eliberate → B trece.
  perform public.cancel_table_payment((v_a->>'payment_id')::uuid,
                                      'ed16ed16-1616-4161-8161-eeeeeeeeeeee','tok_tp14');
  v_b := public.begin_split_payment('ed16ed16-1616-4161-8161-eeeeeeeeeeee','tok_tp14',
    '[{"order_item_id":"11161116-1616-4161-8161-000000000001","quantity":1}]'::jsonb);
  if (v_b->>'amount')::numeric <> 16 then
    raise exception 'TP16 FAIL: după cancel claims-urile nu s-au eliberat (%)', v_b;
  end if;
  raise notice 'TP16 OK: conflict → items_already_claimed; cancel eliberează claims-urile';
end $$;

-- ── TP17: discount pe comandă — suma claims == orders.total EXACT ─────────────
do $$
declare
  v_begin jsonb;
  v_total numeric;
  v_sum   numeric;
begin
  -- Masa TP14 permite o singură sesiune deschisă — o închidem pe cea veche.
  update public.table_sessions set status = 'closed' where id = 'ed16ed16-1616-4161-8161-eeeeeeeeeeee';
  insert into public.table_sessions (id, restaurant_id, table_id, status) values
    ('ed17ed17-1717-4171-8171-eeeeeeeeeeee','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
     'c7c7c7c7-7777-4777-8777-cccccccccccc','open');
  insert into public.orders (id, restaurant_id, source, status, total, session_id,
                             table_id, qr_token_id) values
    ('a17aa17a-1717-4171-8171-ffffffffffff','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','qr','served',0,
     'ed17ed17-1717-4171-8171-eeeeeeeeeeee','c7c7c7c7-7777-4777-8777-cccccccccccc','d7d7d7d7-7777-4777-8777-dddddddddddd');
  -- 3 itemi de 10 → subtotal 30; discount 1 leu → total 29; factor 29/30
  -- produce rest de rotunjire (3 × 9,67 = 29,01) → absorbit de ultimul claim.
  insert into public.order_items (id, order_id, product_name_snapshot, unit_price_snapshot,
                                  quantity, item_total) values
    ('11171117-1717-4171-8171-000000000001','a17aa17a-1717-4171-8171-ffffffffffff','Fel A',10,1,10),
    ('11171117-1717-4171-8171-000000000002','a17aa17a-1717-4171-8171-ffffffffffff','Fel B',10,1,10),
    ('11171117-1717-4171-8171-000000000003','a17aa17a-1717-4171-8171-ffffffffffff','Fel C',10,1,10);
  update public.orders set discount_type = 'amount', discount_value = 1
   where id = 'a17aa17a-1717-4171-8171-ffffffffffff';
  perform public._refresh_order_totals('a17aa17a-1717-4171-8171-ffffffffffff');

  select total into v_total from public.orders
   where id = 'a17aa17a-1717-4171-8171-ffffffffffff';
  if v_total <> 29 then
    raise exception 'TP17 FAIL: seed greșit — totalul e % (așteptat 29)', v_total;
  end if;

  v_begin := public.begin_split_payment('ed17ed17-1717-4171-8171-eeeeeeeeeeee','tok_tp14',
    '[{"order_item_id":"11171117-1717-4171-8171-000000000001","quantity":1},
      {"order_item_id":"11171117-1717-4171-8171-000000000002","quantity":1},
      {"order_item_id":"11171117-1717-4171-8171-000000000003","quantity":1}]'::jsonb);
  if (v_begin->>'amount')::numeric <> 29 then
    raise exception 'TP17 FAIL: suma claims e % (așteptat EXACT 29 — restul de rotunjire neabsorbit)',
      v_begin->>'amount';
  end if;
  select sum(amount) into v_sum from public.table_payment_items
   where payment_id = (v_begin->>'payment_id')::uuid;
  if v_sum <> 29 then
    raise exception 'TP17 FAIL: suma pe claims individuale e % (așteptat 29)', v_sum;
  end if;
  raise notice 'TP17 OK: discount proporțional + absorbția restului → sum(claims) == total';
end $$;

-- ── TP18: coexistența split ↔ plata pe toată masa ─────────────────────────────
do $$
declare
  v_full  jsonb;
  v_split jsonb;
  v_hint  text;
begin
  -- Masa TP14 permite o singură sesiune deschisă — o închidem pe cea veche.
  update public.table_sessions set status = 'closed' where id = 'ed17ed17-1717-4171-8171-eeeeeeeeeeee';
  insert into public.table_sessions (id, restaurant_id, table_id, status) values
    ('ed18ed18-1818-4181-8181-eeeeeeeeeeee','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
     'c7c7c7c7-7777-4777-8777-cccccccccccc','open');
  insert into public.orders (id, restaurant_id, source, status, total, session_id,
                             table_id, qr_token_id) values
    ('a18aa18a-1818-4181-8181-ffffffffffff','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','qr','served',0,
     'ed18ed18-1818-4181-8181-eeeeeeeeeeee','c7c7c7c7-7777-4777-8777-cccccccccccc','d7d7d7d7-7777-4777-8777-dddddddddddd');
  insert into public.order_items (id, order_id, product_name_snapshot, unit_price_snapshot,
                                  quantity, item_total) values
    ('11181118-1818-4181-8181-000000000001','a18aa18a-1818-4181-8181-ffffffffffff','Platou TP',20,2,40);

  -- (a) Plata pe toată masa e live → begin_split o raportează spre anulare
  -- și NU îi mută rândul (webhook-ul trebuie să-l mai găsească).
  v_full := public.begin_table_payment('ed18ed18-1818-4181-8181-eeeeeeeeeeee','tok_tp14');
  perform public.attach_payment_intent((v_full->>'payment_id')::uuid, 'pi_tp18_full');
  v_split := public.begin_split_payment('ed18ed18-1818-4181-8181-eeeeeeeeeeee','tok_tp14',
    '[{"order_item_id":"11181118-1818-4181-8181-000000000001","quantity":1}]'::jsonb);
  if not ((v_split->'superseded_intents') ? 'pi_tp18_full') then
    raise exception 'TP18 FAIL: intent-ul full-table nu apare în superseded (%)', v_split;
  end if;
  if not exists (select 1 from public.table_payments
                  where stripe_payment_intent_id = 'pi_tp18_full' and status = 'processing') then
    raise exception 'TP18 FAIL: rândul full-table a fost mutat de begin_split (webhook orfan)';
  end if;

  -- (b) Invers: begin_table_payment raportează intent-ul split viu.
  perform public.attach_payment_intent((v_split->>'payment_id')::uuid, 'pi_tp18_split');
  v_full := public.begin_table_payment('ed18ed18-1818-4181-8181-eeeeeeeeeeee','tok_tp14');
  if not ((v_full->'superseded_intents') ? 'pi_tp18_split') then
    raise exception 'TP18 FAIL: intent-ul split nu apare în superseded la full begin (%)', v_full;
  end if;

  -- (c) O comandă cu plăți card_online (split reușit) e EXCLUSĂ din
  -- begin_table_payment (regula order_payments, mig 211).
  perform public.settle_table_payment('pi_tp18_split', 'succeeded');
  perform public.settle_table_payment('pi_tp18_full', 'canceled', 'test');
  begin
    perform public.begin_table_payment('ed18ed18-1818-4181-8181-eeeeeeeeeeee','tok_tp14');
    raise exception 'TP18 FAIL: begin_table_payment a inclus comanda cu plăți split (dublă încasare)';
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint <> 'nothing_to_pay' then raise; end if;
  end;
  raise notice 'TP18 OK: split ↔ full-table coexistă pe mecanismul superseded_intents';
end $$;

-- ── TP19: race staff — comanda plătită cash între split-begin și settle ───────
do $$
declare
  v_begin  jsonb;
  v_settle jsonb;
begin
  -- Masa TP14 permite o singură sesiune deschisă — o închidem pe cea veche.
  update public.table_sessions set status = 'closed' where id = 'ed18ed18-1818-4181-8181-eeeeeeeeeeee';
  insert into public.table_sessions (id, restaurant_id, table_id, status) values
    ('ed19ed19-1919-4191-8191-eeeeeeeeeeee','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
     'c7c7c7c7-7777-4777-8777-cccccccccccc','open');
  -- Sursă 'waiter' (fără qr_token): evită rate-limit-ul QR (mig 090) pe
  -- token-ul refolosit de TP14–TP18; split-ul lucrează pe sesiune, nu pe sursă.
  insert into public.orders (id, restaurant_id, source, status, total, session_id,
                             table_id) values
    ('a19aa19a-1919-4191-8191-ffffffffffff','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','waiter','served',0,
     'ed19ed19-1919-4191-8191-eeeeeeeeeeee','c7c7c7c7-7777-4777-8777-cccccccccccc');
  insert into public.order_items (id, order_id, product_name_snapshot, unit_price_snapshot,
                                  quantity, item_total) values
    ('11191119-1919-4191-8191-000000000001','a19aa19a-1919-4191-8191-ffffffffffff','Desert TP',18,1,18);

  v_begin := public.begin_split_payment('ed19ed19-1919-4191-8191-eeeeeeeeeeee','tok_tp14',
    '[{"order_item_id":"11191119-1919-4191-8191-000000000001","quantity":1}]'::jsonb);
  perform public.attach_payment_intent((v_begin->>'payment_id')::uuid, 'pi_tp19');

  -- Ospătarul închide comanda cash ÎNTRE begin și confirmare.
  update public.orders
     set status='paid', payment_method='cash', paid_amount=total, paid_at=now()
   where id = 'a19aa19a-1919-4191-8191-ffffffffffff';

  v_settle := public.settle_table_payment('pi_tp19', 'succeeded');
  if (v_settle->>'orders_skipped')::int <> 1 or (v_settle->>'orders_paid')::int <> 0 then
    raise exception 'TP19 FAIL: settle split pe comanda închisă a raportat % (așteptat skipped=1)', v_settle;
  end if;
  if exists (select 1 from public.order_payments
              where order_id = 'a19aa19a-1919-4191-8191-ffffffffffff' and method = 'card_online') then
    raise exception 'TP19 FAIL: s-a inserat plată card_online peste comanda închisă cash';
  end if;
  if not exists (select 1 from public.table_payments
                  where stripe_payment_intent_id = 'pi_tp19'
                    and status = 'succeeded' and settle_note is not null) then
    raise exception 'TP19 FAIL: settle_note nu semnalează banii de verificat pentru refund';
  end if;
  raise notice 'TP19 OK: comanda închisă între timp e sărită + notată (refund uman)';
end $$;

-- ── TP20: get_table_bill — claimed/remaining + locked pe parțial de staff ─────
do $$
declare
  v_bill  jsonb;
  v_order jsonb;
  v_item  jsonb;
begin
  -- Masa TP14 permite o singură sesiune deschisă — o închidem pe cea veche.
  update public.table_sessions set status = 'closed' where id = 'ed19ed19-1919-4191-8191-eeeeeeeeeeee';
  insert into public.table_sessions (id, restaurant_id, table_id, status) values
    ('ed20ed20-2020-4202-8202-eeeeeeeeeeee','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
     'c7c7c7c7-7777-4777-8777-cccccccccccc','open');
  insert into public.orders (id, restaurant_id, source, status, total, session_id,
                             table_id) values
    ('a20aa20a-2020-4202-8202-ffffffffffff','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','waiter','served',0,
     'ed20ed20-2020-4202-8202-eeeeeeeeeeee','c7c7c7c7-7777-4777-8777-cccccccccccc'),
    ('a21aa21a-2121-4212-8212-ffffffffffff','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','waiter','served',0,
     'ed20ed20-2020-4202-8202-eeeeeeeeeeee','c7c7c7c7-7777-4777-8777-cccccccccccc');
  insert into public.order_items (id, order_id, product_name_snapshot, unit_price_snapshot,
                                  quantity, item_total) values
    ('11201120-2020-4202-8202-000000000001','a20aa20a-2020-4202-8202-ffffffffffff','Bere TP',8,2,16),
    ('11211121-2121-4212-8212-000000000001','a21aa21a-2121-4212-8212-ffffffffffff','Vin TP',25,1,25);

  -- Un claim viu de 1×Bere + un parțial cash de staff pe comanda cu Vin.
  perform public.begin_split_payment('ed20ed20-2020-4202-8202-eeeeeeeeeeee','tok_tp14',
    '[{"order_item_id":"11201120-2020-4202-8202-000000000001","quantity":1}]'::jsonb);
  insert into public.order_payments (order_id, amount, method)
  values ('a21aa21a-2121-4212-8212-ffffffffffff', 5, 'cash');

  v_bill := public.get_table_bill('ed20ed20-2020-4202-8202-eeeeeeeeeeee','tok_tp14');
  if jsonb_array_length(v_bill->'orders') <> 2 then
    raise exception 'TP20 FAIL: nota are % comenzi (așteptat 2)', jsonb_array_length(v_bill->'orders');
  end if;

  select ord into v_order from jsonb_array_elements(v_bill->'orders') ord
   where ord->>'id' = 'a20aa20a-2020-4202-8202-ffffffffffff';
  if (v_order->>'locked')::boolean is not false then
    raise exception 'TP20 FAIL: comanda cu claims online apare locked';
  end if;
  select it into v_item from jsonb_array_elements(v_order->'items') it
   where it->>'id' = '11201120-2020-4202-8202-000000000001';
  if (v_item->>'claimed_qty')::int <> 1 or (v_item->>'remaining_qty')::int <> 1 then
    raise exception 'TP20 FAIL: claimed/remaining greșite (%)', v_item;
  end if;

  select ord into v_order from jsonb_array_elements(v_bill->'orders') ord
   where ord->>'id' = 'a21aa21a-2121-4212-8212-ffffffffffff';
  if (v_order->>'locked')::boolean is not true then
    raise exception 'TP20 FAIL: comanda cu parțial cash de staff nu apare locked';
  end if;
  raise notice 'TP20 OK: nota expune claimed/remaining + locked pe fluxul de staff';
end $$;

-- ── TP21: cash de staff luat ÎNTRE begin_split și settle → notat (echiv. F1) ─
do $$
declare
  v_begin  jsonb;
  v_settle jsonb;
begin
  update public.table_sessions set status = 'closed'
   where id = 'ed20ed20-2020-4202-8202-eeeeeeeeeeee';
  insert into public.table_sessions (id, restaurant_id, table_id, status) values
    ('ed21ed21-2121-4212-8212-eeeeeeeeeeee','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
     'c7c7c7c7-7777-4777-8777-cccccccccccc','open');
  insert into public.orders (id, restaurant_id, source, status, total, session_id,
                             table_id) values
    ('a22aa22a-2222-4222-8222-ffffffffffff','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','waiter','served',0,
     'ed21ed21-2121-4212-8212-eeeeeeeeeeee','c7c7c7c7-7777-4777-8777-cccccccccccc');
  insert into public.order_items (id, order_id, product_name_snapshot, unit_price_snapshot,
                                  quantity, item_total) values
    ('11221122-2222-4222-8222-000000000001','a22aa22a-2222-4222-8222-ffffffffffff','Friptura TP',60,1,60),
    ('11221122-2222-4222-8222-000000000002','a22aa22a-2222-4222-8222-ffffffffffff','Garnitura TP',40,1,40);

  v_begin := public.begin_split_payment('ed21ed21-2121-4212-8212-eeeeeeeeeeee','tok_tp14',
    '[{"order_item_id":"11221122-2222-4222-8222-000000000001","quantity":1}]'::jsonb);
  if (v_begin->>'amount')::numeric <> 60 then
    raise exception 'TP21 FAIL: suma claim-ului e % (așteptat 60)', v_begin->>'amount';
  end if;
  perform public.attach_payment_intent((v_begin->>'payment_id')::uuid, 'pi_tp21');

  -- Ospătarul ia 50 cash parțial ÎN FEREASTRA begin→confirmare (3DS).
  insert into public.order_payments (order_id, amount, method)
  values ('a22aa22a-2222-4222-8222-ffffffffffff', 50, 'cash');

  v_settle := public.settle_table_payment('pi_tp21', 'succeeded');
  -- Banii online se înregistrează (au fost încasați); 50+60=110 >= 100 → paid,
  -- dar suprapunerea cu cash-ul de staff TREBUIE să fie vizibilă.
  if (v_settle->>'orders_staff_race')::int <> 1 then
    raise exception 'TP21 FAIL: suprapunerea cu plata de staff nu e raportată (%)', v_settle;
  end if;
  if not exists (select 1 from public.orders
                  where id = 'a22aa22a-2222-4222-8222-ffffffffffff'
                    and status = 'paid' and payment_method = 'other' and paid_amount = 110) then
    raise exception 'TP21 FAIL: comanda nu e paid/other/110 (mix cash+online)';
  end if;
  if not exists (select 1 from public.table_payments
                  where stripe_payment_intent_id = 'pi_tp21'
                    and status = 'succeeded' and settle_note ilike '%staff%') then
    raise exception 'TP21 FAIL: settle_note nu semnalează plățile de staff din fereastră';
  end if;
  raise notice 'TP21 OK: cash-ul de staff din fereastra begin→settle e notat (nu tăcut)';
end $$;

-- ── TP22: claim cu sumă zero (produs gratuit) NU avortează settle-ul ─────────
do $$
declare
  v_begin  jsonb;
  v_settle jsonb;
begin
  update public.table_sessions set status = 'closed'
   where id = 'ed21ed21-2121-4212-8212-eeeeeeeeeeee';
  insert into public.table_sessions (id, restaurant_id, table_id, status) values
    ('ed22ed22-2222-4222-8222-eeeeeeeeeeee','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb',
     'c7c7c7c7-7777-4777-8777-cccccccccccc','open');
  insert into public.orders (id, restaurant_id, source, status, total, session_id,
                             table_id) values
    ('a23aa23a-2323-4232-8232-ffffffffffff','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','waiter','served',0,
     'ed22ed22-2222-4222-8222-eeeeeeeeeeee','c7c7c7c7-7777-4777-8777-cccccccccccc'),
    ('a24aa24a-2424-4242-8242-ffffffffffff','b1b1b1b1-1111-4111-8111-bbbbbbbbbbbb','waiter','served',0,
     'ed22ed22-2222-4222-8222-eeeeeeeeeeee','c7c7c7c7-7777-4777-8777-cccccccccccc');
  insert into public.order_items (id, order_id, product_name_snapshot, unit_price_snapshot,
                                  quantity, item_total) values
    ('11231123-2323-4232-8232-000000000001','a23aa23a-2323-4232-8232-ffffffffffff','Limonada TP',16,1,16),
    ('11241124-2424-4242-8242-000000000001','a24aa24a-2424-4242-8242-ffffffffffff','Apa din partea casei',0,1,0);

  -- Claim pe ambele: comanda gratuită contribuie 0 la sumă.
  v_begin := public.begin_split_payment('ed22ed22-2222-4222-8222-eeeeeeeeeeee','tok_tp14',
    '[{"order_item_id":"11231123-2323-4232-8232-000000000001","quantity":1},
      {"order_item_id":"11241124-2424-4242-8242-000000000001","quantity":1}]'::jsonb);
  if (v_begin->>'amount')::numeric <> 16 then
    raise exception 'TP22 FAIL: suma e % (așteptat 16)', v_begin->>'amount';
  end if;
  perform public.attach_payment_intent((v_begin->>'payment_id')::uuid, 'pi_tp22');

  -- Settle-ul NU are voie să pice pe insert de 0 în order_payments (CHECK
  -- amount > 0, mig 017): grupul zero se sare, plata validă se înregistrează.
  v_settle := public.settle_table_payment('pi_tp22', 'succeeded');
  if v_settle->>'status' <> 'succeeded' or (v_settle->>'orders_paid')::int <> 1 then
    raise exception 'TP22 FAIL: settle a raportat % (așteptat succeeded, paid=1)', v_settle;
  end if;
  if exists (select 1 from public.order_payments
              where order_id = 'a24aa24a-2424-4242-8242-ffffffffffff') then
    raise exception 'TP22 FAIL: s-a inserat un rând de 0 lei în order_payments';
  end if;
  if not exists (select 1 from public.orders
                  where id = 'a23aa23a-2323-4232-8232-ffffffffffff'
                    and status = 'paid' and paid_amount = 16) then
    raise exception 'TP22 FAIL: comanda plătită valid nu a fost înregistrată';
  end if;
  raise notice 'TP22 OK: claim-ul de 0 lei e sărit; settle-ul nu se rostogolește';
end $$;

rollback;
