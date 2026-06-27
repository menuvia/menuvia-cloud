-- tests/sql/reservation_ratelimit_assertions.sql
-- =============================================================================
-- Aserții pentru mig 115: rate limit pe rezervările publice (anti-spam anon).
-- Trigger reservations_public_rate_limit (BEFORE INSERT) + helper
-- check_reservation_rate_limit: max 5/min/restaurant + max 3/5min/telefon,
-- DOAR pentru source = 'public'.
--
-- Testăm DIRECT pe tabela reservations (insert raw cu source='public'), nu
-- prin create_reservation_public — vrem să izolăm logica de rate-limit fără
-- lanțul complet de validări (open_days/open_time/min_advance) care ar face
-- testul fragil la data/ora rulării. Trigger-ul se declanșează identic pe
-- orice insert cu source='public', deci acoperim exact path-ul atacat.
--
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/reservation_ratelimit_assertions.sql
--
--   RR0  trigger + helper există (sanity pe structură)
--   RR1  sub prag (4 rezervări publice / minut) → toate acceptate
--   RR2  peste prag restaurant (a 6-a în fereastra de 1 min) → respins
--   RR3  burst guard telefon (a 4-a de la același număr în 5 min) → respins
--   RR4  source != 'public' (dashboard) NU e afectat de rate-limit
--   RR5  rezervările cancelled/no_show NU se numără în prag
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed minimal ─────────────────────────────────────────────────────────────
-- Restaurant activ + owner + masă + modul reservations activat. Settings sunt
-- create automat de trigger-ul din mig 057 la insert restaurant.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1','rr-owner@res.test')
  on conflict (id) do nothing;

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('0aaa0000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1',
   'RateLimit Test R','reservation-ratelimit-slug','Cluj',true);

-- Masă cu locuri (table_id e nullable pe reservations, dar punem una ca seed-ul
-- să fie realist).
insert into public.tables (id, restaurant_id, name, slug, seats, is_active) values
  ('0aaa0000-0000-0000-0000-00000000000a','0aaa0000-0000-0000-0000-0000000000a1',
   'Masa 1','masa-1',4,true);

-- Activăm modulul reservations (default OFF). Trigger-ul de rate-limit NU
-- depinde de modul, dar îl activăm pentru fidelitate cu fluxul real.
insert into public.restaurant_modules (restaurant_id, module_key, enabled) values
  ('0aaa0000-0000-0000-0000-0000000000a1','reservations',true)
  on conflict (restaurant_id, module_key) do update set enabled = true;

-- Helper local de seed pentru o rezervare publică (un slot oarecare în viitor,
-- masă explicită ca să nu lovim eventuale constrângeri). Întoarce id-ul.
-- Folosim un slot fix; overlaps nu contează aici (trigger-ul rulează înainte
-- de orice logică de alocare — testăm doar rate-limit).

-- ── RR0: structura (trigger + helper există) ─────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.reservations'::regclass
       and tgname = 'reservations_public_rate_limit'
  ) then
    raise exception 'RR0 FAIL: trigger reservations_public_rate_limit lipsește';
  end if;
  if to_regprocedure('public.check_reservation_rate_limit(uuid, text)') is null then
    raise exception 'RR0 FAIL: funcția check_reservation_rate_limit lipsește';
  end if;
  raise notice 'RR0 OK: trigger + helper prezente';
end $$;

-- ── RR1: sub prag (4 rezervări publice/minut) → toate acceptate ──────────────
do $$
declare v_cnt int;
begin
  for i in 1..4 loop
    insert into public.reservations (
      restaurant_id, table_id, customer_name, customer_phone,
      party_size, starts_at, ends_at, status, source
    ) values (
      '0aaa0000-0000-0000-0000-0000000000a1',
      '0aaa0000-0000-0000-0000-00000000000a',
      'Client '||i, '0700000'||(100+i)::text,
      2, now() + interval '2 days', now() + interval '2 days' + interval '90 minutes',
      'confirmed', 'public'
    );
  end loop;
  select count(*) into v_cnt from public.reservations
    where restaurant_id = '0aaa0000-0000-0000-0000-0000000000a1' and source='public';
  if v_cnt <> 4 then
    raise exception 'RR1 FAIL: % rezervări inserate (așteptat 4)', v_cnt;
  end if;
  raise notice 'RR1 OK: 4 rezervări sub prag acceptate';
end $$;

-- ── RR2: peste prag restaurant (a 5-a/a 6-a în 1 min) → respins ──────────────
-- Avem deja 4 din RR1 (telefoane diferite). A 5-a (count=4 >= 5? nu) trece;
-- a 6-a (count=5 >= 5) e respinsă. Folosim telefoane DIFERITE ca să nu lovim
-- burst-ul per-telefon (RR3) — izolăm pragul per restaurant.
do $$
declare
  v_blocked boolean := false;
  v_hint    text;
begin
  -- a 5-a (count curent = 4, 4 >= 5 fals → acceptată)
  insert into public.reservations (
    restaurant_id, table_id, customer_name, customer_phone,
    party_size, starts_at, ends_at, status, source
  ) values (
    '0aaa0000-0000-0000-0000-0000000000a1',
    '0aaa0000-0000-0000-0000-00000000000a',
    'Client 5', '0700000205',
    2, now() + interval '2 days', now() + interval '2 days' + interval '90 minutes',
    'confirmed', 'public'
  );

  -- a 6-a (count curent = 5, 5 >= 5 adevărat → respinsă)
  begin
    insert into public.reservations (
      restaurant_id, table_id, customer_name, customer_phone,
      party_size, starts_at, ends_at, status, source
    ) values (
      '0aaa0000-0000-0000-0000-0000000000a1',
      '0aaa0000-0000-0000-0000-00000000000a',
      'Client 6', '0700000206',
      2, now() + interval '2 days', now() + interval '2 days' + interval '90 minutes',
      'confirmed', 'public'
    );
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      if position('reservation_rate_limit' in coalesce(v_hint, '')) > 0
         or sqlerrm ilike '%Prea multe rezervări%' then
        v_blocked := true;
      else
        raise;
      end if;
  end;

  if not v_blocked then
    raise exception 'RR2 FAIL: a 6-a rezervare publică NU a fost respinsă de rate-limit';
  end if;
  raise notice 'RR2 OK: prag restaurant (5/min) aplicat — a 6-a respinsă';
end $$;

-- ── RR3: burst guard telefon (a 4-a de la același număr în 5 min) → respins ──
-- Restaurant nou ca să resetăm pragul per-restaurant (5/min) și să izolăm
-- pragul per-telefon (3/5min). 3 de la același telefon trec, a 4-a e respinsă.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a2','rr-owner2@res.test')
  on conflict (id) do nothing;
insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('0aaa0000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a2',
   'RateLimit Test R2','reservation-ratelimit-slug-2','Iași',true);
insert into public.restaurant_modules (restaurant_id, module_key, enabled) values
  ('0aaa0000-0000-0000-0000-0000000000a2','reservations',true)
  on conflict (restaurant_id, module_key) do update set enabled = true;

do $$
declare
  v_blocked boolean := false;
  v_hint    text;
begin
  -- 3 rezervări de la ACELAȘI telefon (sub pragul restaurant de 5, dar la
  -- limita pragului telefon de 3).
  for i in 1..3 loop
    insert into public.reservations (
      restaurant_id, customer_name, customer_phone,
      party_size, starts_at, ends_at, status, source
    ) values (
      '0aaa0000-0000-0000-0000-0000000000a2',
      'Spam '||i, '0711111111',
      2, now() + interval '2 days', now() + interval '2 days' + interval '90 minutes',
      'confirmed', 'public'
    );
  end loop;

  -- a 4-a de la același telefon (count=3 >= 3 → respinsă)
  begin
    insert into public.reservations (
      restaurant_id, customer_name, customer_phone,
      party_size, starts_at, ends_at, status, source
    ) values (
      '0aaa0000-0000-0000-0000-0000000000a2',
      'Spam 4', '0711111111',
      2, now() + interval '2 days', now() + interval '2 days' + interval '90 minutes',
      'confirmed', 'public'
    );
  exception
    when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      if position('reservation_rate_limit' in coalesce(v_hint, '')) > 0
         or sqlerrm ilike '%Prea multe rezervări de la acest număr%' then
        v_blocked := true;
      else
        raise;
      end if;
  end;

  if not v_blocked then
    raise exception 'RR3 FAIL: a 4-a rezervare de la același telefon NU a fost respinsă';
  end if;
  raise notice 'RR3 OK: burst guard telefon (3/5min) aplicat — a 4-a respinsă';
end $$;

-- ── RR4: source != 'public' (dashboard) NU e afectat ─────────────────────────
-- Restaurant nou. Inserăm 10 rezervări 'dashboard' într-un minut: toate trec
-- (trigger-ul ignoră sursele non-public).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a3','rr-owner3@res.test')
  on conflict (id) do nothing;
insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('0aaa0000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a3',
   'RateLimit Test R3','reservation-ratelimit-slug-3','Brașov',true);

do $$
declare v_cnt int;
begin
  for i in 1..10 loop
    insert into public.reservations (
      restaurant_id, customer_name, customer_phone,
      party_size, starts_at, ends_at, status, source
    ) values (
      '0aaa0000-0000-0000-0000-0000000000a3',
      'Staff add '||i, '0722222222',
      2, now() + interval '2 days', now() + interval '2 days' + interval '90 minutes',
      'confirmed', 'dashboard'
    );
  end loop;
  select count(*) into v_cnt from public.reservations
    where restaurant_id = '0aaa0000-0000-0000-0000-0000000000a3' and source='dashboard';
  if v_cnt <> 10 then
    raise exception 'RR4 FAIL: % rezervări dashboard inserate (așteptat 10) — rate-limit a lovit greșit', v_cnt;
  end if;
  raise notice 'RR4 OK: sursa dashboard NU e afectată de rate-limit';
end $$;

-- ── RR5: cancelled/no_show NU se numără în prag ──────────────────────────────
-- Restaurant nou. Inserăm 5 rezervări 'public' anulate (nu contează), apoi 5
-- active — toate cele 5 active trec pentru că anulatele nu se numără.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a4','rr-owner4@res.test')
  on conflict (id) do nothing;
insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('0aaa0000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-0000000000a4',
   'RateLimit Test R4','reservation-ratelimit-slug-4','Sibiu',true);

do $$
declare v_active int;
begin
  -- 5 rezervări publice anulate (telefoane diferite ca să nu lovim per-telefon)
  for i in 1..5 loop
    insert into public.reservations (
      restaurant_id, customer_name, customer_phone,
      party_size, starts_at, ends_at, status, source
    ) values (
      '0aaa0000-0000-0000-0000-0000000000a4',
      'Anulat '||i, '07300000'||(10+i)::text,
      2, now() + interval '2 days', now() + interval '2 days' + interval '90 minutes',
      'cancelled', 'public'
    );
  end loop;

  -- 4 active (sub pragul de 5) → toate trec, fiindcă cele anulate nu se numără
  for i in 1..4 loop
    insert into public.reservations (
      restaurant_id, customer_name, customer_phone,
      party_size, starts_at, ends_at, status, source
    ) values (
      '0aaa0000-0000-0000-0000-0000000000a4',
      'Activ '||i, '07300001'||(20+i)::text,
      2, now() + interval '2 days', now() + interval '2 days' + interval '90 minutes',
      'confirmed', 'public'
    );
  end loop;

  select count(*) into v_active from public.reservations
    where restaurant_id = '0aaa0000-0000-0000-0000-0000000000a4'
      and source='public' and status='confirmed';
  if v_active <> 4 then
    raise exception 'RR5 FAIL: % rezervări active inserate (așteptat 4) — anulatele au fost numărate', v_active;
  end if;
  raise notice 'RR5 OK: rezervările cancelled/no_show nu se numără în prag';
end $$;

do $$ begin raise notice '════ reservation rate limit (mig 115) assertions: ALL PASS ════'; end $$;

rollback;
