-- tests/sql/bridge_connection_assertions.sql
-- =============================================================================
-- Aserții permanente pentru mig 265 (`bridge_connection_status`), RPC-ul care
-- alimentează banner-ul „Fiscalizare activă, casa nu e conectată".
-- Self-contained, ROLLBACK la final.
--
--   BC1  Fără niciun dispozitiv: registered=false, connected=false.
--   BC2  Dispozitiv cu heartbeat ACUM: registered=true, connected=true.
--   BC3  Dispozitiv cu last_seen_at vechi (10 min): registered=true,
--        connected=FALSE — liveness-ul vine din last_seen_at, nu din `status`,
--        care rămâne 'online' pentru totdeauna (nimic nu-l resetează).
--   BC4  Un membru al ALTUI restaurant e respins (hint `unauthorized`).
--   BC5  Proiecția are EXACT 3 chei și niciuna nu e un secret.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('65000000-0000-4000-8000-000000000001','bc-owner@bc.test'),
  ('65000000-0000-4000-8000-000000000002','bc-strain@bc.test');
update public.profiles set plan='pro' where id='65000000-0000-4000-8000-000000000001';
update public.profiles set plan='pro' where id='65000000-0000-4000-8000-000000000002';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('65b00000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000001','BC Fiscal','bc-fiscal','Cluj',true),
  ('65b00000-0000-4000-8000-000000000002','65000000-0000-4000-8000-000000000002','BC Strain','bc-strain','Cluj',true);

select set_config('request.jwt.claim.sub','65000000-0000-4000-8000-000000000001', true);

-- ── BC1: fără dispozitive ────────────────────────────────────────────────────
do $$
declare v jsonb;
begin
  v := public.bridge_connection_status('65b00000-0000-4000-8000-000000000001');
  if (v->>'registered')::boolean is not false then
    raise exception 'BC1 FAIL: registered=% fără niciun dispozitiv', v->>'registered'; end if;
  if (v->>'connected')::boolean is not false then
    raise exception 'BC1 FAIL: connected=% fără niciun dispozitiv', v->>'connected'; end if;
  if v->>'last_seen_at' is not null then
    raise exception 'BC1 FAIL: last_seen_at=% fără dispozitive', v->>'last_seen_at'; end if;
  raise notice 'BC1 OK: fără dispozitive → registered=false, connected=false';
end $$;

-- ── BC2: heartbeat acum → conectat ───────────────────────────────────────────
do $$
declare v jsonb;
begin
  insert into public.bridge_devices (id, restaurant_id, name, device_secret, status, last_seen_at)
  values ('65d00000-0000-4000-8000-000000000001','65b00000-0000-4000-8000-000000000001',
          'Casa 1','bc-secret-viu','online', now());
  v := public.bridge_connection_status('65b00000-0000-4000-8000-000000000001');
  if (v->>'registered')::boolean is not true or (v->>'connected')::boolean is not true then
    raise exception 'BC2 FAIL: heartbeat acum dar registered=% connected=%',
      v->>'registered', v->>'connected'; end if;
  raise notice 'BC2 OK: heartbeat acum → conectat';
end $$;

-- ── BC3: heartbeat vechi → NEconectat, deși status a rămas 'online' ─────────
do $$
declare v jsonb; v_status text;
begin
  update public.bridge_devices
     set last_seen_at = now() - interval '10 minutes'
   where id = '65d00000-0000-4000-8000-000000000001';

  select status into v_status from public.bridge_devices
   where id = '65d00000-0000-4000-8000-000000000001';
  if v_status <> 'online' then
    raise exception 'BC3 FAIL: premisa testului s-a schimbat — status=% (era lipicios pe „online")', v_status; end if;

  v := public.bridge_connection_status('65b00000-0000-4000-8000-000000000001');
  if (v->>'registered')::boolean is not true then
    raise exception 'BC3 FAIL: dispozitivul există dar registered=%', v->>'registered'; end if;
  if (v->>'connected')::boolean is not false then
    raise exception 'BC3 FAIL: last_seen_at vechi de 10 min dar connected=% — liveness-ul s-a întors pe `status`, care nu se resetează NICIODATĂ', v->>'connected'; end if;
  raise notice 'BC3 OK: heartbeat vechi → neconectat, deși status rămâne „online"';
end $$;

-- ── BC4: membru al altui restaurant → respins ────────────────────────────────
do $$
declare v_hint text;
begin
  perform set_config('request.jwt.claim.sub','65000000-0000-4000-8000-000000000002', true);
  begin
    perform public.bridge_connection_status('65b00000-0000-4000-8000-000000000001');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'unauthorized' then
    raise exception 'BC4 FAIL: un străin a citit starea bridge-ului altui restaurant (hint=%)', v_hint; end if;
  perform set_config('request.jwt.claim.sub','65000000-0000-4000-8000-000000000001', true);
  raise notice 'BC4 OK: cross-tenant respins cu unauthorized';
end $$;

-- ── BC5: proiecția are exact 3 chei, niciuna secretă ─────────────────────────
do $$
declare v jsonb; v_chei text;
begin
  v := public.bridge_connection_status('65b00000-0000-4000-8000-000000000001');
  select string_agg(k, ',' order by k) into v_chei from jsonb_object_keys(v) as k;
  if v_chei is distinct from 'connected,last_seen_at,registered' then
    raise exception 'BC5 FAIL: proiecția s-a lărgit — chei=% (așteptat connected,last_seen_at,registered)', v_chei; end if;
  if v::text ilike '%secret%' then
    raise exception 'BC5 FAIL: proiecția conține un secret: %', v::text; end if;
  raise notice 'BC5 OK: proiecție de 3 chei, fără secrete';
end $$;

rollback;
