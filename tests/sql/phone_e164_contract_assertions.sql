-- tests/sql/phone_e164_contract_assertions.sql
-- =============================================================================
-- Contractul SERVER pe care se sprijină PhoneInput (PH-4): clientul trimite de
-- acum telefonul oaspetelui în E.164 („+40722123456", „+46701234567") în loc de
-- forma națională tastată. Nicio migrație — funcțiile de mai jos acceptau deja
-- forma; suita ÎNGHEAȚĂ acest fapt, ca o recreare viitoare să nu-l rupă tăcut.
--
--   PE1  fn_sms_normalize_ro_phone: E.164 RO ≡ național RO (control POZITIV —
--        fără el, PE2 ar trece și cu o funcție care întoarce mereu NULL).
--   PE2  fn_sms_normalize_ro_phone: E.164 STRĂIN al cărui format național e
--        „07 + 8 cifre" (SE, CH, FR, KE) → NULL. Miezul fix-ului: o „simplificare"
--        pe ultimele 9 cifre ar trimite din nou SMS-ul unui străin din România.
--   PE3  fn_loyalty_phone_hash: +40… și 07… → ACELAȘI wallet; +46… ≠ 07… .
--   PE4  is_valid_phone (pickup, mig 046): acceptă „+", E.164 de 15 cifre;
--        respinge 16.
--   PE5  orders.customer_phone (CHECK ≤ 20, mig 025) primește cel mai lung E.164.
--   PE6  check_reservation_rate_limit: formate mixte ale ACELUIAȘI număr intră
--        în aceeași găleată (a 4-a în 5 min e respinsă); un E.164 străin cu alt
--        NSN nu e afectat.
--
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── PE1 ──────────────────────────────────────────────────────────────────────
do $$
begin
  if public.fn_sms_normalize_ro_phone('+40722123456') is distinct from '+40722123456'
     or public.fn_sms_normalize_ro_phone('0722123456') is distinct from '+40722123456'
     or public.fn_sms_normalize_ro_phone('+40701234567') is distinct from '+40701234567' then
    raise exception 'PE1 FAIL: E.164 RO nu mai e echivalent cu forma națională';
  end if;
end $$;

-- ── PE2 ──────────────────────────────────────────────────────────────────────
do $$
declare v text;
begin
  foreach v in array array['+46701234567','+41791234567','+33712345678','+254712345678'] loop
    if public.fn_sms_normalize_ro_phone(v) is not null then
      raise exception 'PE2 FAIL: numărul străin % e normalizat la %  — SMS către un străin din RO',
        v, public.fn_sms_normalize_ro_phone(v);
    end if;
  end loop;
end $$;

-- ── PE3 ──────────────────────────────────────────────────────────────────────
do $$
begin
  if public.fn_loyalty_phone_hash('+40722123456') is null
     or public.fn_loyalty_phone_hash('+40722123456') is distinct from public.fn_loyalty_phone_hash('0722123456')
     or public.fn_loyalty_phone_hash('+40722123456') is distinct from public.fn_loyalty_phone_hash('0040 722 123 456') then
    raise exception 'PE3 FAIL: +40… și 07… nu mai ajung în ACELAȘI wallet';
  end if;
  if public.fn_loyalty_phone_hash('+46701234567') is null
     or public.fn_loyalty_phone_hash('+46701234567') = public.fn_loyalty_phone_hash('0701234567') then
    raise exception 'PE3 FAIL: E.164 suedez cade în wallet-ul numărului românesc 0701234567';
  end if;
end $$;

-- ── PE4 ──────────────────────────────────────────────────────────────────────
do $$
begin
  if not public.is_valid_phone('+40722123456')
     or not public.is_valid_phone('+393471234567')
     or not public.is_valid_phone('+123456789012345') then
    raise exception 'PE4 FAIL: is_valid_phone respinge un E.164 valid';
  end if;
  if public.is_valid_phone('+1234567890123456') then
    raise exception 'PE4 FAIL: is_valid_phone acceptă 16 cifre';
  end if;
end $$;

-- ── Seed PE5/PE6 ─────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('e1640000-0000-4000-8000-0000000000a1','pe-owner@pe.test');
-- growth: comenzile (inclusiv pickup) cer plan plătit (gate-ul de plan pe orders).
update public.profiles set plan = 'growth'
 where id = 'e1640000-0000-4000-8000-0000000000a1';
insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('e1640000-0000-4000-8000-0000000000b1','e1640000-0000-4000-8000-0000000000a1',
   'PE Bistro','pe-bistro-slug','Cluj',true);

-- ── PE5 ──────────────────────────────────────────────────────────────────────
do $$
begin
  insert into public.orders (restaurant_id, source, status, total, customer_name, customer_phone, pickup_time)
  values ('e1640000-0000-4000-8000-0000000000b1','pickup','new',0,'PE','+123456789012345', now() + interval '1 hour');
exception when check_violation then
  raise exception 'PE5 FAIL: orders.customer_phone respinge un E.164 de 16 caractere: %', sqlerrm;
end $$;

-- ── PE6 ──────────────────────────────────────────────────────────────────────
insert into public.reservations
  (restaurant_id, customer_name, customer_phone, party_size, starts_at, ends_at, status, source)
values
  ('e1640000-0000-4000-8000-0000000000b1','A','0722123456',      2, now() + interval '1 day', now() + interval '1 day 2 hours','pending','public'),
  ('e1640000-0000-4000-8000-0000000000b1','B','+40722123456',    2, now() + interval '2 day', now() + interval '2 day 2 hours','pending','public'),
  ('e1640000-0000-4000-8000-0000000000b1','C','0040 722 123 456',2, now() + interval '3 day', now() + interval '3 day 2 hours','pending','public');

do $$
declare v_hint text;
begin
  -- Control: alt NSN (E.164 suedez) NU e în găleata lui 722123456.
  insert into public.reservations
    (restaurant_id, customer_name, customer_phone, party_size, starts_at, ends_at, status, source)
  values ('e1640000-0000-4000-8000-0000000000b1','S','+46701234567',2,
          now() + interval '4 day', now() + interval '4 day 2 hours','pending','public');

  begin
    insert into public.reservations
      (restaurant_id, customer_name, customer_phone, party_size, starts_at, ends_at, status, source)
    values ('e1640000-0000-4000-8000-0000000000b1','D','+40 722-123-456',2,
            now() + interval '5 day', now() + interval '5 day 2 hours','pending','public');
    raise exception 'PE6 FAIL: a 4-a rezervare a aceluiași număr (format mixt) a trecut de rate-limit';
  exception when raise_exception then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint is distinct from 'reservation_rate_limit' then
      raise;
    end if;
  end;
end $$;

\echo 'PE1-PE6 OK'
rollback;
