-- tests/sql/auto/322_floor_layout_rpc_only.sql
-- =============================================================================
-- FLW1–FLW3 — clichetul PERMANENT al mig 322: `restaurants.floor_layout` se
-- scrie DOAR prin `save_floor_layout` (rol + `floor_plan` + obiect + 1 MiB).
-- Înainte, grant-ul de coloană din 096B lăsa un PATCH direct să ocolească toate
-- gate-urile, iar salvarea din Setări (rândul întreg, încărcat la montare)
-- rescria harta cu copia VECHE. Rulează pe AMBELE medii (sql-verify + E2E),
-- autonom, ROLLBACK la final.
--
-- FLW2/FLW3 rulează SUB rolul REAL `authenticated`: ca `postgres`, privilegiile
-- de coloană sunt ocolite, deci testul ar fi orb exact la clasa reparată.
--
--   FLW1 catalog: anon/authenticated NU au UPDATE pe floor_layout; ancoră —
--        authenticated păstrează UPDATE pe wifi_password; save_floor_layout e
--        apelabil de authenticated și e SECURITY DEFINER.
--        [PICĂ: fără revoke („authenticated poate scrie direct”); revoke pe
--        TABEL (`revoke update on table restaurants`) → ancora „revoke prea larg”]
--   FLW2 owner pe PRO: salvează harta prin RPC; un PATCH în forma VECHII
--        salvări din Setări (`wifi_password` + `floor_layout = null`) e respins
--        cu insufficient_privilege PE TABEL (nu pe schemă), iar harta din RPC
--        rămâne. Control pozitiv: un PATCH de Setări FĂRĂ floor_layout trece
--        (row_count = 1, wifi_password scris).
--        [PICĂ: fără revoke (UPDATE-ul trece și lasă harta NULL — bug-ul
--        reprodus); save_floor_layout coborât la INVOKER (apelul RPC aruncă);
--        revoke pe tabel (controlul pozitiv aruncă)]
--   FLW3 owner pe GROWTH: RPC-ul refuză cu hint `feature_disabled`, iar calea
--        directă (`floor_layout = '[1,2,3]'`) e și ea respinsă; harta rămâne
--        NULL. Control pozitiv: același owner își salvează wifi_password.
--        [PICĂ: fără revoke („growth a scris floor_layout direct”)]
-- =============================================================================

begin;

-- ── Fixtură ──────────────────────────────────────────────────────────────────
--   P/RP owner pe PRO (floor_plan)    G/RG owner pe GROWTH (fără floor_plan)
insert into auth.users (id, email) values
  ('32200000-0000-4000-8000-0000000000b1', 'flw-pro@flw322.test'),
  ('32200000-0000-4000-8000-0000000000b2', 'flw-grw@flw322.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email)
  select id, email from auth.users where email like 'flw-%@flw322.test'
  on conflict (id) do nothing;
update public.profiles set plan = 'pro'    where id = '32200000-0000-4000-8000-0000000000b1';
update public.profiles set plan = 'growth' where id = '32200000-0000-4000-8000-0000000000b2';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('322b0000-0000-4000-8000-000000000001', '32200000-0000-4000-8000-0000000000b1',
   'FLW Pro', 'flw322-pro', 'Cluj', true),
  ('322b0000-0000-4000-8000-000000000002', '32200000-0000-4000-8000-0000000000b2',
   'FLW Grw', 'flw322-grw', 'Cluj', true);

-- ═══════ FLW1: catalog (citește doar) ═══════
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if has_column_privilege(r, 'public.restaurants', 'floor_layout', 'UPDATE') then
      raise exception 'FLW1 FAIL: % poate scrie direct restaurants.floor_layout (ocolește save_floor_layout)', r;
    end if;
  end loop;
  if not has_column_privilege('authenticated', 'public.restaurants', 'wifi_password', 'UPDATE') then
    raise exception 'FLW1 FAIL (ancoră): authenticated a pierdut UPDATE pe wifi_password — revoke prea larg';
  end if;
  if not has_function_privilege('authenticated', 'public.save_floor_layout(uuid,jsonb)', 'EXECUTE') then
    raise exception 'FLW1 FAIL: authenticated nu mai poate apela save_floor_layout';
  end if;
  if not exists (select 1 from pg_proc
                  where oid = 'public.save_floor_layout(uuid,jsonb)'::regprocedure and prosecdef) then
    raise exception 'FLW1 FAIL: save_floor_layout nu mai e SECURITY DEFINER (n-ar mai putea scrie coloana)';
  end if;
  raise notice 'FLW1 PASS';
end $$;

-- ═══════ FLW2: owner pe PRO — harta din RPC supraviețuiește salvării din Setări ═══════
do $$
declare
  v_rp      uuid  := '322b0000-0000-4000-8000-000000000001';
  v_new     jsonb := '{"floors":[{"id":"NEW"}]}';
  v_n       int;
  v_msg     text;
  v_refused boolean := false;
  v_layout  jsonb;
begin
  perform set_config('request.jwt.claim.sub', '32200000-0000-4000-8000-0000000000b1', true);
  perform set_config('role', 'authenticated', true);
  perform public.save_floor_layout(v_rp, v_new);
  -- Control pozitiv: PATCH de Setări FĂRĂ floor_layout (RLS + grant-urile pe
  -- celelalte coloane funcționează).
  update public.restaurants set wifi_password = 'flw-wifi', name = 'FLW Pro 2' where id = v_rp;
  get diagnostics v_n = row_count;
  -- Forma VECHII salvări din Setări: rândul întreg, cu harta încărcată la montare.
  begin
    update public.restaurants set wifi_password = 'flw-wifi-2', floor_layout = null where id = v_rp;
  exception when insufficient_privilege then
    get stacked diagnostics v_msg = message_text;
    v_refused := v_msg like '%restaurants%';
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);

  if v_n <> 1 then
    raise exception 'FLW2 FAIL (control): PATCH-ul fără floor_layout a atins % rânduri', v_n;
  end if;
  if not v_refused then
    raise exception 'FLW2 FAIL: UPDATE direct pe floor_layout acceptat (grant de coloană prezent; msg=%)', v_msg;
  end if;
  select floor_layout into v_layout from public.restaurants where id = v_rp;
  if v_layout is distinct from v_new then
    raise exception 'FLW2 FAIL: harta salvată prin RPC a fost suprascrisă: %', v_layout;
  end if;
  if (select wifi_password from public.restaurants where id = v_rp) is distinct from 'flw-wifi' then
    raise exception 'FLW2 FAIL (control): PATCH-ul fără hartă nu s-a aplicat (sau cel respins a scris)';
  end if;
  raise notice 'FLW2 PASS';
end $$;

-- ═══════ FLW3: owner pe GROWTH — gate-ul floor_plan pe AMBELE căi ═══════
do $$
declare
  v_rg      uuid  := '322b0000-0000-4000-8000-000000000002';
  v_hint    text;
  v_refused boolean := false;
  v_n       int;
begin
  perform set_config('request.jwt.claim.sub', '32200000-0000-4000-8000-0000000000b2', true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.save_floor_layout(v_rg, '{"floors":[{"id":"NEW"}]}'::jsonb);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  begin
    update public.restaurants set floor_layout = '[1,2,3]'::jsonb where id = v_rg;
  exception when insufficient_privilege then
    v_refused := true;
  end;
  -- Control pozitiv: același owner salvează un câmp obișnuit.
  update public.restaurants set wifi_password = 'flw-g' where id = v_rg;
  get diagnostics v_n = row_count;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);

  if v_hint is distinct from 'feature_disabled' then
    raise exception 'FLW3 FAIL: save_floor_layout pe growth nu a dat feature_disabled (hint=%)', v_hint;
  end if;
  if not v_refused then
    raise exception 'FLW3 FAIL: growth a scris floor_layout direct, ocolind gate-ul floor_plan';
  end if;
  if v_n <> 1 then
    raise exception 'FLW3 FAIL (control): growth nu își poate salva wifi_password (% rânduri)', v_n;
  end if;
  if (select floor_layout from public.restaurants where id = v_rg) is not null then
    raise exception 'FLW3 FAIL: floor_layout pe growth nu mai e NULL';
  end if;
  raise notice 'FLW3 PASS';
end $$;

rollback;
