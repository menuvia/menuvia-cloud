-- tests/sql/low_hardening_assertions.sql
-- =============================================================================
-- Aserții permanente pentru mig 243 (sweep LOW) + invariantul anti-leak
-- al proiecției publice pe slug (mig 217/219):
--   LH1  advance_order mark_paid RESPINGE 'card_online' (hint
--        invalid_payment_method) — staff nu poate înregistra manual o plată
--        online (paritate cu add_partial_payment, mig 231).
--   LH2  Control pozitiv anti-vacuu: 'meal_voucher' trece → paid.
--   LH3  register_affiliate întoarce ok+pending (fluxul de cerere, mig 224,
--        neafectat de handler-ul de cursă din mig 243).
--   LH4  check_reservation_rate_limit NU mai e apelabil de anon/authenticated;
--        trigger-ul de rate-limit există în continuare.
--   LH5  get_restaurant_by_slug (anon) întoarce wifi_password=null și
--        qr_token=null chiar dacă în DB au valori (invariant mig 217,
--        post-ÎNTREG lanțul de migrații — o recreare viitoare care
--        reintroduce r.wifi_password pică AICI, nu doar în asserția din mig).
--   LH6  ...și menu_languages E în proiecție (invariant mig 219).
--
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a1b30000-0000-4000-8000-0000000000f1','lh-owner-ent@lh.test'),
  ('a1b40000-0000-4000-8000-0000000000f2','lh-affiliate@lh.test');

update public.profiles set plan = 'enterprise'
 where id = 'a1b30000-0000-4000-8000-0000000000f1';

insert into public.restaurants
  (id, owner_id, name, slug, city, is_active, wifi_password, qr_token, menu_languages) values
  ('b1c30000-0000-4000-8000-0000000000f1','a1b30000-0000-4000-8000-0000000000f1',
   'LH Enterprise','lh-ent-slug','Cluj',true,'parola-wifi-secreta','token-qr-secret',
   '["en","de"]'::jsonb);

insert into public.restaurant_memberships (restaurant_id, user_id, role) values
  ('b1c30000-0000-4000-8000-0000000000f1','a1b30000-0000-4000-8000-0000000000f1','owner')
on conflict (restaurant_id, user_id) do nothing;

insert into public.orders (id, restaurant_id, source, status, total) values
  ('c1d40000-0000-4000-8000-0000000000f1','b1c30000-0000-4000-8000-0000000000f1','waiter','served',100),
  ('c1d50000-0000-4000-8000-0000000000f2','b1c30000-0000-4000-8000-0000000000f1','waiter','served',80);

-- ── LH1 + LH2: gate-ul pe metoda de plată din mark_paid ──────────────────────
set local role authenticated;
set local request.jwt.claim.sub = 'a1b30000-0000-4000-8000-0000000000f1';

do $$
declare
  v_ok   boolean := false;
  v_hint text;
  v      jsonb;
begin
  -- LH1: card_online respins ÎNAINTE de orice update.
  begin
    perform public.advance_order(
      'c1d40000-0000-4000-8000-0000000000f1', 'mark_paid', 100, 'card_online');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint = 'invalid_payment_method' then
      v_ok := true;
    else
      raise exception 'LH1 FAIL: altă excepție decât gate-ul de metodă (hint %, %)',
        coalesce(v_hint, '<null>'), sqlerrm;
    end if;
  end;
  if not v_ok then
    raise exception 'LH1 FAIL: mark_paid a acceptat card_online manual';
  end if;

  -- LH2 (anti-vacuu): meal_voucher rămâne o metodă validă de staff → paid.
  v := public.advance_order(
    'c1d50000-0000-4000-8000-0000000000f2', 'mark_paid', 80, 'meal_voucher');
  if coalesce((v->>'ok')::boolean, false) is not true then
    raise exception 'LH2 FAIL: meal_voucher respins la mark_paid (%)', v;
  end if;
  raise notice 'LH1+LH2 OK: card_online respins, meal_voucher acceptat';
end $$;

reset role;

do $$
begin
  if not exists (select 1 from public.orders
                  where id = 'c1d50000-0000-4000-8000-0000000000f2'
                    and status = 'paid' and payment_method = 'meal_voucher') then
    raise exception 'LH2 FAIL: comanda nu e paid/meal_voucher după mark_paid';
  end if;
  if exists (select 1 from public.orders
              where id = 'c1d40000-0000-4000-8000-0000000000f1'
                and status <> 'served') then
    raise exception 'LH1 FAIL: comanda respinsă și-a schimbat totuși statusul';
  end if;
end $$;

-- ── LH3: register_affiliate — fluxul de cerere funcționează ──────────────────
set local role authenticated;
set local request.jwt.claim.sub = 'a1b40000-0000-4000-8000-0000000000f2';

do $$
declare v jsonb;
begin
  v := public.register_affiliate(null, '0712345678', 'test LH3');
  if coalesce((v->>'ok')::boolean, false) is not true
     or (v->>'status') is distinct from 'pending' then
    raise exception 'LH3 FAIL: cererea de afiliere nu a întors ok+pending (%)', v;
  end if;
  -- Idempotență: al doilea apel = already, aceeași stare.
  v := public.register_affiliate(null, '0712345678', null);
  if coalesce((v->>'already')::boolean, false) is not true then
    raise exception 'LH3 FAIL: al doilea apel nu e idempotent (%)', v;
  end if;
  raise notice 'LH3 OK: cerere pending + idempotență';
end $$;

reset role;

-- ── LH4: rate-limit helper — EXECUTE retras, trigger-ul rămâne ───────────────
do $$
begin
  if has_function_privilege('anon',
       'public.check_reservation_rate_limit(uuid, text)', 'execute') then
    raise exception 'LH4 FAIL: anon poate chema direct check_reservation_rate_limit';
  end if;
  if has_function_privilege('authenticated',
       'public.check_reservation_rate_limit(uuid, text)', 'execute') then
    raise exception 'LH4 FAIL: authenticated poate chema direct check_reservation_rate_limit';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgname = 'reservations_public_rate_limit'
       and tgrelid = 'public.reservations'::regclass) then
    raise exception 'LH4 FAIL: trigger-ul de rate-limit a dispărut';
  end if;
  raise notice 'LH4 OK: oracle-ul de rate-limit închis, trigger-ul intact';
end $$;

-- ── LH5 + LH6: proiecția publică pe slug nu scurge secrete ───────────────────
set local role anon;

do $$
declare r record;
begin
  select * into r from public.get_restaurant_by_slug('lh-ent-slug');
  if not found then
    raise exception 'LH5 FAIL: get_restaurant_by_slug nu a întors restaurantul';
  end if;
  if r.wifi_password is not null then
    raise exception 'LH5 FAIL: wifi_password s-a scurs la anon (%)', r.wifi_password;
  end if;
  if r.qr_token is not null then
    raise exception 'LH5 FAIL: qr_token s-a scurs la anon (%)', r.qr_token;
  end if;
  if r.menu_languages is null or r.menu_languages <> '["en","de"]'::jsonb then
    raise exception 'LH6 FAIL: menu_languages lipsește/greșit din proiecție (%)', r.menu_languages;
  end if;
  raise notice 'LH5+LH6 OK: secrete null la anon, menu_languages prezent';
end $$;

-- ── LH7: RPC-ul COMPUS get_menu_by_slug (mig 245) moștenește anti-leak-ul ────
do $$
declare v jsonb;
begin
  v := public.get_menu_by_slug('lh-ent-slug');
  if v is null then
    raise exception 'LH7 FAIL: get_menu_by_slug nu a întors restaurantul';
  end if;
  if v->'restaurant'->>'wifi_password' is not null
     or v->'restaurant'->>'qr_token' is not null then
    raise exception 'LH7 FAIL: compusul scurge secrete la anon';
  end if;
  if jsonb_typeof(v->'menu') is distinct from 'array' then
    raise exception 'LH7 FAIL: compusul nu întoarce meniul ca array (%)',
      jsonb_typeof(v->'menu');
  end if;
  if public.get_menu_by_slug('slug-inexistent-xyz') is not null then
    raise exception 'LH7 FAIL: slug inexistent nu întoarce null';
  end if;
  raise notice 'LH7 OK: compusul pe slug moștenește whitelist-ul + null pe 404';
end $$;

reset role;

select 'LOW HARDENING ASSERTIONS: LH1–LH7 PASS' as result;

rollback;
