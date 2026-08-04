-- tests/sql/reservation_owner_notify_assertions.sql
-- =============================================================================
-- Aserții pentru mig 254/255 (notificarea restaurantului la rezervare nouă):
--   RN1  INSERT rezervare → EXACT un rând în email_queue cu template_kind
--        'reservation_created', către emailul owner-ului, dedup 'resv_created:<id>'.
--   RN2  UPDATE de status pe aceeași rezervare NU mai produce alt email
--        (trigger doar pe INSERT; dedup-ul pe id e plasa a doua).
--   RN3  Ramurile defensive rămân în funcție (aserțiune de CATALOG): guard-ul
--        de email null + exception-wrapper-ul. Starea „owner fără email" e
--        IMPOSIBILĂ prin schemă (profiles.email NOT NULL; delete pe profil
--        cascadează restaurantul) — verificat empiric la scrierea testului,
--        deci nu se poate testa ca stare, doar ca prezență a guard-urilor.
--
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a1b10000-0000-4000-8000-00000000e0f1','rn-owner@rn.test'),
  ('a1b20000-0000-4000-8000-00000000e0f2','rn-noemail@rn.test');

-- Pe planul free, trigger-ul de limită de membri (mig 131) respinge chiar
-- primul membership (aceeași capcană ca la seed-ul E2E) — bump la growth.
update public.profiles set plan = 'growth'
 where id in ('a1b10000-0000-4000-8000-00000000e0f1',
              'a1b20000-0000-4000-8000-00000000e0f2');

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('b1c10000-0000-4000-8000-00000000e0f1','a1b10000-0000-4000-8000-00000000e0f1',
   'RN Bistro','rn-bistro-slug','Cluj',true),
  ('b1c20000-0000-4000-8000-00000000e0f2','a1b20000-0000-4000-8000-00000000e0f2',
   'RN NoMail','rn-nomail-slug','Cluj',true);

insert into public.restaurant_memberships (restaurant_id, user_id, role) values
  ('b1c10000-0000-4000-8000-00000000e0f1','a1b10000-0000-4000-8000-00000000e0f1','owner'),
  ('b1c20000-0000-4000-8000-00000000e0f2','a1b20000-0000-4000-8000-00000000e0f2','owner')
on conflict (restaurant_id, user_id) do nothing;

-- ── RN1: INSERT → un email 'reservation_created' către owner ────────────────
insert into public.reservations
  (id, restaurant_id, customer_name, customer_phone, party_size, starts_at, ends_at, status)
values
  ('c1d10000-0000-4000-8000-00000000e0f1','b1c10000-0000-4000-8000-00000000e0f1',
   'Client RN','0722000111',4, now() + interval '2 days',
   now() + interval '2 days 2 hours', 'confirmed');

do $$
declare
  v_count int;
  v_recipient text;
  v_kind text;
begin
  select count(*), min(recipient_email), min(template_kind::text)
    into v_count, v_recipient, v_kind
    from public.email_queue
   where dedup_key = 'resv_created:c1d10000-0000-4000-8000-00000000e0f1';
  if v_count <> 1 then
    raise exception 'RN1: așteptam exact 1 email în coadă, am găsit %', v_count;
  end if;
  if v_recipient <> 'rn-owner@rn.test' then
    raise exception 'RN1: destinatar greșit: %', v_recipient;
  end if;
  if v_kind <> 'reservation_created' then
    raise exception 'RN1: template_kind greșit: %', v_kind;
  end if;
end $$;

-- ── RN2: UPDATE de status nu produce alt email ──────────────────────────────
update public.reservations
   set status = 'seated'
 where id = 'c1d10000-0000-4000-8000-00000000e0f1';

do $$
declare v_count int;
begin
  select count(*) into v_count
    from public.email_queue
   where template_kind::text = 'reservation_created'
     and dedup_key like 'resv_created:c1d10000%';
  if v_count <> 1 then
    raise exception 'RN2: UPDATE-ul a produs email suplimentar (total %)', v_count;
  end if;
end $$;

-- ── RN3: guard-urile defensive există în definiția funcției ─────────────────
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.trg_email_on_reservation_created()'::regprocedure);
  if v_def !~* 'v_owner_email\s+is\s+null' then
    raise exception 'RN3: guard-ul de email null a dispărut din trigger';
  end if;
  if v_def !~* 'when\s+others' then
    raise exception 'RN3: exception-wrapper-ul a dispărut din trigger';
  end if;
end $$;

select 'RN1–RN3 OK: notificarea owner-ului la rezervare nouă' as status;

rollback;
