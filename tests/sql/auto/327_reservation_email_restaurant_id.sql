-- tests/sql/auto/327_reservation_email_restaurant_id.sql
-- =============================================================================
-- RE1–RE4 — clichetul PERMANENT al mig 327 (lotul L8a): emailurile de
-- rezervare către owner poartă `restaurant_id`, ca worker-ul să afișeze ora pe
-- fusul LOCALULUI, fără să piardă vreun invariant al lui 255/257. Rulează din
-- tests/sql/auto/ (scripts/run-sql-auto.sh) pe AMBELE medii; autonom,
-- ROLLBACK la final. Comparațiile sunt `is distinct from`; seturile de chei
-- se compară ordonate cu `collate "C"`.
--
--   RE1  INSERT rezervare → EXACT un rând `reservation_created` (control:
--        count = 1 înainte de orice citire), `restaurant_id` = restaurantul
--        rezervării, cheile = cele de dinainte ∪ {restaurant_id}.
--        [PICĂ: cheia scoasă din trigger (= replay fără 327)]
--   RE2  `cancel_reservation_by_code` apelat SUB rolul REAL `anon` (execute
--        dinamic — ca postgres EXECUTE e ocolit): răspunsul rămâne EXACT
--        {ok, starts_at}; rândul `reservation_cancelled` are restaurant_id.
--        [PICĂ: cheia scoasă din RPC; grantul anon pierdut]
--   RE3  invariantele moștenite, pe CATALOG: trigger DEFINER + pg_temp + garda
--        pe email + exception-wrapper, fără EXECUTE pentru anon/authenticated;
--        RPC cu o singură semnătură, DEFINER + pg_temp, rate-limit, predicatul
--        de status în UPDATE, EXECUTE pentru anon + authenticated și NU pentru
--        PUBLIC. (Starea „owner fără email” e imposibilă prin schemă —
--        profiles.email NOT NULL, RN3 — deci garda se ține pe catalog.)
--        [PICĂ: exception-wrapper-ul scos; grantul anon pierdut; un grant PUBLIC]
--   RE4  scope pe restaurant: rezervarea de la al DOILEA local poartă id-ul LUI
--        (nu al primului); o anulare cu cod greșit nu pune nimic în coadă.
--        [PICĂ: id-ul luat din altă sursă decât rezervarea / slug-ul]
-- =============================================================================

begin;

-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('32700000-0000-4000-8000-00000000a001', 're327-owner-a@re.test'),
  ('32700000-0000-4000-8000-00000000a002', 're327-owner-b@re.test');
-- Pe free, limita de membri (131) respinge chiar primul membership.
update public.profiles set plan = 'growth'
 where id in ('32700000-0000-4000-8000-00000000a001', '32700000-0000-4000-8000-00000000a002');

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('32700000-0000-4000-8000-00000000b001', '32700000-0000-4000-8000-00000000a001', 'RE Bistro A', 're327-bistro-a', 'Cluj', true),
  ('32700000-0000-4000-8000-00000000b002', '32700000-0000-4000-8000-00000000a002', 'RE Bistro B', 're327-bistro-b', 'Cluj', true);
insert into public.restaurant_memberships (restaurant_id, user_id, role) values
  ('32700000-0000-4000-8000-00000000b001', '32700000-0000-4000-8000-00000000a001', 'owner'),
  ('32700000-0000-4000-8000-00000000b002', '32700000-0000-4000-8000-00000000a002', 'owner')
on conflict (restaurant_id, user_id) do nothing;

-- `source` explicit: default-ul 'public' trece prin rate-limit-ul public (115).
insert into public.reservations
  (id, restaurant_id, customer_name, customer_phone, party_size, starts_at, ends_at, status, source, confirmation_code)
values
  ('32700000-0000-4000-8000-00000000c001', '32700000-0000-4000-8000-00000000b001',
   'Client A', '0722327001', 4, now() + interval '2 days', now() + interval '2 days 2 hours',
   'confirmed', 'dashboard', 'RE327AA1'),
  ('32700000-0000-4000-8000-00000000c002', '32700000-0000-4000-8000-00000000b002',
   'Client B', '0722327002', 2, now() + interval '3 days', now() + interval '3 days 2 hours',
   'confirmed', 'dashboard', 'RE327BB2');

-- ── RE1 ──────────────────────────────────────────────────────────────────────
do $$
declare
  v_n    int;
  v_td   jsonb;
  v_keys text[];
begin
  select count(*) into v_n from public.email_queue
   where dedup_key = 'resv_created:32700000-0000-4000-8000-00000000c001';
  if v_n is distinct from 1 then
    raise exception 'RE1 FAIL: % rânduri reservation_created (aștept 1 — fixtura nu exersează trigger-ul)', v_n;
  end if;
  select template_data into v_td from public.email_queue
   where dedup_key = 'resv_created:32700000-0000-4000-8000-00000000c001';
  if v_td ->> 'restaurant_id' is distinct from '32700000-0000-4000-8000-00000000b001' then
    raise exception 'RE1 FAIL: restaurant_id = % în template_data', v_td ->> 'restaurant_id';
  end if;
  select array_agg(k order by k collate "C") into v_keys from jsonb_object_keys(v_td) k;
  if v_keys is distinct from array['confirmation_code', 'customer_name', 'customer_phone', 'party_size',
       'restaurant_id', 'restaurant_name', 'source', 'special_requests', 'starts_at', 'status']::text[] then
    raise exception 'RE1 FAIL: cheile template_data = %', v_keys;
  end if;
  raise notice 'RE1 PASS: reservation_created poartă restaurant_id, restul contractului neschimbat';
end $$;

-- ── RE2 ──────────────────────────────────────────────────────────────────────
do $$
declare
  v      jsonb;
  v_n    int;
  v_td   jsonb;
  v_keys text[];
begin
  perform set_config('role', 'anon', true);
  execute 'select public.cancel_reservation_by_code($1, $2)' into v using 're327-bistro-a', 're327aa1';
  perform set_config('role', 'none', true);

  if coalesce((v ->> 'ok')::boolean, false) is not true then
    raise exception 'RE2 FAIL: anularea ca anon a eșuat: %', v;
  end if;
  select array_agg(k order by k collate "C") into v_keys from jsonb_object_keys(v) k;
  if v_keys is distinct from array['ok', 'starts_at']::text[] then
    raise exception 'RE2 FAIL: răspunsul RPC-ului și-a schimbat forma: %', v;
  end if;

  select count(*) into v_n from public.email_queue
   where dedup_key = 'resv_cancelled:32700000-0000-4000-8000-00000000c001';
  if v_n is distinct from 1 then
    raise exception 'RE2 FAIL: % rânduri reservation_cancelled (aștept 1)', v_n;
  end if;
  select template_data into v_td from public.email_queue
   where dedup_key = 'resv_cancelled:32700000-0000-4000-8000-00000000c001';
  if v_td ->> 'restaurant_id' is distinct from '32700000-0000-4000-8000-00000000b001' then
    raise exception 'RE2 FAIL: restaurant_id = % în emailul de anulare', v_td ->> 'restaurant_id';
  end if;
  select array_agg(k order by k collate "C") into v_keys from jsonb_object_keys(v_td) k;
  if v_keys is distinct from array['customer_name', 'customer_phone', 'party_size', 'restaurant_id',
       'restaurant_name', 'starts_at']::text[] then
    raise exception 'RE2 FAIL: cheile template_data = %', v_keys;
  end if;
  raise notice 'RE2 PASS: anularea ca anon pune restaurant_id; răspunsul RPC neschimbat';
end $$;

-- ── RE3 ──────────────────────────────────────────────────────────────────────
do $$
declare
  v_trg regprocedure := 'public.trg_email_on_reservation_created()'::regprocedure;
  v_rpc regprocedure := 'public.cancel_reservation_by_code(text, text)'::regprocedure;
  v_fn  regprocedure;
  v_def text;
  v_cfg text;
  v_n   int;
begin
  foreach v_fn in array array[v_trg, v_rpc] loop
    v_def := pg_get_functiondef(v_fn);
    if not (select prosecdef from pg_proc where oid = v_fn) then
      raise exception 'RE3 FAIL: % nu mai e SECURITY DEFINER', v_fn;
    end if;
    select array_to_string(proconfig, ',') into v_cfg from pg_proc where oid = v_fn;
    if coalesce(v_cfg, '') not like '%pg_temp%' then
      raise exception 'RE3 FAIL: % fără pg_temp (proconfig=%)', v_fn, v_cfg;
    end if;
    if v_def !~* 'when\s+others' then
      raise exception 'RE3 FAIL: % nu mai e exception-wrapped', v_fn;
    end if;
    if v_def !~* 'v_owner_email\s+is\s+(not\s+)?null' then
      raise exception 'RE3 FAIL: % a pierdut garda pe emailul owner-ului', v_fn;
    end if;
  end loop;

  if has_function_privilege('anon', v_trg, 'execute') or has_function_privilege('authenticated', v_trg, 'execute') then
    raise exception 'RE3 FAIL: funcția de trigger e apelabilă de un rol client';
  end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cancel_reservation_by_code';
  if v_n is distinct from 1 then
    raise exception 'RE3 FAIL: % semnături cancel_reservation_by_code', v_n;
  end if;
  v_def := pg_get_functiondef(v_rpc);
  if v_def !~* 'check_rate_limit' then
    raise exception 'RE3 FAIL: rate-limit-ul s-a pierdut';
  end if;
  if v_def !~* 'and\s+status\s+in\s+\(''pending'',\s*''confirmed''\)' then
    raise exception 'RE3 FAIL: predicatul de status din UPDATE s-a pierdut (TOCTOU)';
  end if;
  if not has_function_privilege('anon', v_rpc, 'execute') or not has_function_privilege('authenticated', v_rpc, 'execute') then
    raise exception 'RE3 FAIL: anon/authenticated fără EXECUTE pe fluxul public de anulare';
  end if;
  if (select proacl from pg_proc where oid = v_rpc) is null
     or exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                 where p.oid = v_rpc and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
    raise exception 'RE3 FAIL: PUBLIC are EXECUTE pe cancel_reservation_by_code';
  end if;
  raise notice 'RE3 PASS: invariantele 255/257 pe catalog';
end $$;

-- ── RE4 ──────────────────────────────────────────────────────────────────────
do $$
declare
  v      jsonb;
  v_n    int;
  v_rid  text;
begin
  select template_data ->> 'restaurant_id' into v_rid from public.email_queue
   where dedup_key = 'resv_created:32700000-0000-4000-8000-00000000c002';
  if v_rid is distinct from '32700000-0000-4000-8000-00000000b002' then
    raise exception 'RE4 FAIL: rezervarea localului B poartă restaurant_id = %', v_rid;
  end if;

  select count(*) into v_n from public.email_queue where template_kind::text = 'reservation_cancelled'
     and template_data ->> 'restaurant_id' in ('32700000-0000-4000-8000-00000000b001', '32700000-0000-4000-8000-00000000b002');
  v := public.cancel_reservation_by_code('re327-bistro-a', 'RE327BB2'); -- codul lui B, pe slug-ul lui A
  if v ->> 'hint' is distinct from 'invalid_code' then
    raise exception 'RE4 FAIL: codul altui local a dat %', v;
  end if;
  if (select count(*) from public.email_queue where template_kind::text = 'reservation_cancelled'
        and template_data ->> 'restaurant_id' in ('32700000-0000-4000-8000-00000000b001', '32700000-0000-4000-8000-00000000b002'))
     is distinct from v_n then
    raise exception 'RE4 FAIL: o anulare respinsă a pus un email în coadă';
  end if;
  if (select status from public.reservations where id = '32700000-0000-4000-8000-00000000c002') is distinct from 'confirmed' then
    raise exception 'RE4 FAIL: rezervarea lui B a fost atinsă de o anulare pe slug-ul lui A';
  end if;
  raise notice 'RE4 PASS: restaurant_id pe local, anularea respinsă nu notifică';
end $$;

rollback;
