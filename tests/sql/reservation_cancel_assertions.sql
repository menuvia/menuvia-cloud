-- tests/sql/reservation_cancel_assertions.sql
-- =============================================================================
-- Aserții pentru mig 256/257 (anularea publică pe cod de confirmare):
--   RC1  cod valid + rezervare viitoare confirmed → ok, status='cancelled',
--        email 'reservation_cancelled' către owner (dedup resv_cancelled:<id>).
--   RC2  cod greșit / slug greșit → hint 'invalid_code' IDENTIC (anti-oracle),
--        statusul rămâne neatins.
--   RC3  re-anulare (deja cancelled) și rezervare din trecut → 'not_cancellable'.
--   RC4  granturi: anon + authenticated pot executa; PUBLIC nu.
--
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a1b10000-0000-4000-8000-00000000c0f1','rc-owner@rc.test');
update public.profiles set plan = 'growth'
 where id = 'a1b10000-0000-4000-8000-00000000c0f1';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('b1c10000-0000-4000-8000-00000000c0f1','a1b10000-0000-4000-8000-00000000c0f1',
   'RC Bistro','rc-bistro-slug','Cluj',true);
insert into public.restaurant_memberships (restaurant_id, user_id, role) values
  ('b1c10000-0000-4000-8000-00000000c0f1','a1b10000-0000-4000-8000-00000000c0f1','owner')
on conflict (restaurant_id, user_id) do nothing;

insert into public.reservations
  (id, restaurant_id, customer_name, customer_phone, party_size,
   starts_at, ends_at, status, confirmation_code)
values
  ('c1d10000-0000-4000-8000-00000000c0f1','b1c10000-0000-4000-8000-00000000c0f1',
   'Client Viitor','0722000311',4,
   now() + interval '2 days', now() + interval '2 days 2 hours', 'confirmed', 'AABBCC11'),
  ('c1d20000-0000-4000-8000-00000000c0f2','b1c10000-0000-4000-8000-00000000c0f1',
   'Client Trecut','0722000322',2,
   now() - interval '2 hours', now() - interval '30 minutes', 'confirmed', 'AABBCC22');

-- ── RC1: anulare reușită + email owner ──────────────────────────────────────
do $$
declare
  v jsonb;
  v_status text;
  v_mail int;
begin
  v := public.cancel_reservation_by_code('rc-bistro-slug', 'aabbcc11');
  if coalesce((v->>'ok')::boolean, false) is not true then
    raise exception 'RC1: anularea validă a eșuat: %', v;
  end if;
  select status into v_status from public.reservations
   where id = 'c1d10000-0000-4000-8000-00000000c0f1';
  if v_status <> 'cancelled' then
    raise exception 'RC1: status % în loc de cancelled', v_status;
  end if;
  select count(*) into v_mail from public.email_queue
   where dedup_key = 'resv_cancelled:c1d10000-0000-4000-8000-00000000c0f1'
     and template_kind::text = 'reservation_cancelled';
  if v_mail <> 1 then
    raise exception 'RC1: așteptam 1 email de anulare către owner, am găsit %', v_mail;
  end if;
end $$;

-- ── RC2: cod greșit și slug greșit → același hint, nimic atins ──────────────
do $$
declare
  v1 jsonb;
  v2 jsonb;
begin
  v1 := public.cancel_reservation_by_code('rc-bistro-slug', 'GRESIT00');
  v2 := public.cancel_reservation_by_code('slug-inexistent', 'AABBCC22');
  if v1->>'hint' <> 'invalid_code' or v2->>'hint' <> 'invalid_code' then
    raise exception 'RC2: hint-urile diferă (oracle): % vs %', v1, v2;
  end if;
  if exists (select 1 from public.reservations
              where id = 'c1d20000-0000-4000-8000-00000000c0f2'
                and status <> 'confirmed') then
    raise exception 'RC2: rezervarea neatinsă și-a schimbat statusul';
  end if;
end $$;

-- ── RC3: re-anulare + rezervare din trecut → not_cancellable ────────────────
do $$
declare
  v1 jsonb;
  v2 jsonb;
begin
  v1 := public.cancel_reservation_by_code('rc-bistro-slug', 'AABBCC11'); -- deja cancelled
  v2 := public.cancel_reservation_by_code('rc-bistro-slug', 'AABBCC22'); -- în trecut
  if v1->>'hint' <> 'not_cancellable' or v2->>'hint' <> 'not_cancellable' then
    raise exception 'RC3: hint greșit: % / %', v1, v2;
  end if;
end $$;

-- ── RC4: granturi ───────────────────────────────────────────────────────────
do $$
begin
  if not has_function_privilege('anon', 'public.cancel_reservation_by_code(text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.cancel_reservation_by_code(text, text)', 'execute') then
    raise exception 'RC4: anon/authenticated nu pot executa RPC-ul public';
  end if;
end $$;

select 'RC1–RC4 OK: anularea publică pe cod de confirmare' as status;

rollback;
