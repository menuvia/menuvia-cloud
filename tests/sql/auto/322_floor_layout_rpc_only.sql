-- tests/sql/auto/322_floor_layout_rpc_only.sql
-- =============================================================================
-- FLW1–FLW3 — clichetul PERMANENT al mig 322: `restaurants.floor_layout` se
-- scrie DOAR prin `save_floor_layout` (rol + `floor_plan` + obiect + 1 MiB).
-- Înainte, grant-ul de coloană din 096B lăsa un PATCH direct să ocolească toate
-- gate-urile, iar salvarea din Setări (rândul întreg, încărcat la montare)
-- rescria harta cu copia VECHE. Gate-ul e un trigger care PĂSTREAZĂ valoarea
-- veche pentru anon/authenticated (nu un revoke: un bundle vechi cară
-- `floor_layout` în ORICE PATCH din Setări și ar fi primit 42501 la fiecare
-- salvare — recenzia O7a). Rulează pe AMBELE medii (sql-verify + E2E),
-- autonom, ROLLBACK la final.
--
-- FLW2/FLW3 rulează SUB rolul REAL `authenticated`: ca `postgres` gate-ul nu se
-- aplică (corect — proprietarul și RPC-urile DEFINER scriu), deci testul ar fi
-- orb exact la clasa reparată.
--
--   FLW1 catalog: trigger-ul există pe restaurants, BEFORE UPDATE ROW fără listă
--        de coloane (tgtype 19 EXACT), funcția NU e DEFINER și NU e executabilă
--        de anon/authenticated; save_floor_layout e apelabil de authenticated și
--        e SECURITY DEFINER; ancoră — authenticated păstrează UPDATE pe
--        wifi_password.
--        [PICĂ: fără trigger; trigger `before update of name` (tgattr nevid);
--        funcția promovată la DEFINER; grant EXECUTE pe authenticated]
--   FLW2 owner pe PRO: salvează harta prin RPC; un PATCH în forma VECHII
--        salvări din Setări (`wifi_password` + `floor_layout = null`) TRECE
--        (row_count = 1, wifi_password scris — fără asta un bundle vechi nu mai
--        salva nimic din Setări), iar harta din RPC rămâne. Control pozitiv:
--        o a doua salvare prin RPC chiar schimbă harta (gate-ul nu blochează
--        calea legitimă).
--        [PICĂ: fără trigger (harta devine NULL — bug-ul reprodus); revoke pe
--        coloană în loc de trigger (PATCH-ul de Setări aruncă 42501 — regresia
--        din recenzie); trigger care RESPINGE în loc să păstreze (idem);
--        funcția promovată la DEFINER (harta devine NULL); trigger fără
--        condiția pe rol (a doua salvare prin RPC nu mai schimbă harta)]
--   FLW3 owner pe GROWTH: RPC-ul refuză cu hint `feature_disabled`, iar calea
--        directă (`floor_layout = '[1,2,3]'`, în același PATCH cu wifi_password)
--        nu scrie harta; harta rămâne NULL. Control pozitiv: wifi_password din
--        ACELAȘI PATCH s-a scris (row_count = 1).
--        [PICĂ: fără trigger („growth a scris floor_layout direct”)]
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
declare
  v_tgtype int;
  v_tgattr text;
begin
  select tgtype, tgattr::text into v_tgtype, v_tgattr
    from pg_trigger
   where tgname = 'trg_restaurants_floor_layout_rpc_only'
     and tgrelid = 'public.restaurants'::regclass and not tgisinternal;
  if v_tgtype is null then
    raise exception 'FLW1 FAIL: lipsește trg_restaurants_floor_layout_rpc_only — PATCH-ul direct pe floor_layout ocolește save_floor_layout';
  end if;
  if v_tgtype <> 19 or v_tgattr <> '' then
    raise exception 'FLW1 FAIL: trigger-ul trebuie să fie BEFORE UPDATE FOR EACH ROW fără listă de coloane (tgtype 19), este % / %', v_tgtype, v_tgattr;
  end if;
  if exists (select 1 from pg_proc
              where oid = 'public.fn_restaurants_floor_layout_rpc_only()'::regprocedure and prosecdef) then
    raise exception 'FLW1 FAIL: gate-ul e DEFINER — current_user ar fi mereu proprietarul, deci n-ar mai vedea rolul client';
  end if;
  if has_function_privilege('anon', 'public.fn_restaurants_floor_layout_rpc_only()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.fn_restaurants_floor_layout_rpc_only()', 'EXECUTE') then
    raise exception 'FLW1 FAIL: funcția de trigger e executabilă de roluri client';
  end if;
  if not has_column_privilege('authenticated', 'public.restaurants', 'wifi_password', 'UPDATE') then
    raise exception 'FLW1 FAIL (ancoră): authenticated a pierdut UPDATE pe wifi_password';
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
  v_new2    jsonb := '{"floors":[{"id":"NEW2"}]}';
  v_n       int;
  v_old_n   int;
  v_err     text;
  v_after1  jsonb;
  v_layout  jsonb;
begin
  perform set_config('request.jwt.claim.sub', '32200000-0000-4000-8000-0000000000b1', true);
  perform set_config('role', 'authenticated', true);
  perform public.save_floor_layout(v_rp, v_new);
  -- Control pozitiv: PATCH de Setări FĂRĂ floor_layout (forma clientului NOU).
  update public.restaurants set wifi_password = 'flw-wifi', name = 'FLW Pro 2' where id = v_rp;
  get diagnostics v_n = row_count;
  -- Forma VECHII salvări din Setări (bundle de dinaintea deploy-ului): rândul
  -- întreg, cu harta încărcată la montare (aici NULL). Trebuie să TREACĂ.
  begin
    update public.restaurants set wifi_password = 'flw-wifi-2', floor_layout = null where id = v_rp;
    get diagnostics v_old_n = row_count;
  exception when others then
    get stacked diagnostics v_err = message_text;
  end;
  select floor_layout into v_after1 from public.restaurants where id = v_rp;
  -- Control pozitiv: calea legitimă (RPC) chiar schimbă harta prin gate.
  perform public.save_floor_layout(v_rp, v_new2);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);

  if v_n <> 1 then
    raise exception 'FLW2 FAIL (control): PATCH-ul fără floor_layout a atins % rânduri', v_n;
  end if;
  if v_err is not null then
    raise exception 'FLW2 FAIL: salvarea VECHE din Setări (cu floor_layout) e respinsă — un bundle vechi nu mai salvează nimic (%)', v_err;
  end if;
  if v_old_n is distinct from 1
     or (select wifi_password from public.restaurants where id = v_rp) is distinct from 'flw-wifi-2' then
    raise exception 'FLW2 FAIL: salvarea VECHE din Setări nu și-a scris câmpurile (row_count=%)', v_old_n;
  end if;
  if v_after1 is distinct from v_new then
    raise exception 'FLW2 FAIL: harta salvată prin RPC a fost suprascrisă de PATCH-ul din Setări: %', v_after1;
  end if;
  select floor_layout into v_layout from public.restaurants where id = v_rp;
  if v_layout is distinct from v_new2 then
    raise exception 'FLW2 FAIL (control): save_floor_layout nu mai poate schimba harta (gate prea larg): %', v_layout;
  end if;
  raise notice 'FLW2 PASS';
end $$;

-- ═══════ FLW3: owner pe GROWTH — gate-ul floor_plan pe AMBELE căi ═══════
do $$
declare
  v_rg      uuid  := '322b0000-0000-4000-8000-000000000002';
  v_hint    text;
  v_n       int;
begin
  perform set_config('request.jwt.claim.sub', '32200000-0000-4000-8000-0000000000b2', true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.save_floor_layout(v_rg, '{"floors":[{"id":"NEW"}]}'::jsonb);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  -- Calea directă, împreună cu un câmp obișnuit (control pozitiv în același PATCH).
  update public.restaurants set wifi_password = 'flw-g', floor_layout = '[1,2,3]'::jsonb where id = v_rg;
  get diagnostics v_n = row_count;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);

  if v_hint is distinct from 'feature_disabled' then
    raise exception 'FLW3 FAIL: save_floor_layout pe growth nu a dat feature_disabled (hint=%)', v_hint;
  end if;
  if v_n <> 1 or (select wifi_password from public.restaurants where id = v_rg) is distinct from 'flw-g' then
    raise exception 'FLW3 FAIL (control): growth nu își poate salva wifi_password (% rânduri)', v_n;
  end if;
  if (select floor_layout from public.restaurants where id = v_rg) is not null then
    raise exception 'FLW3 FAIL: growth a scris floor_layout direct, ocolind gate-ul floor_plan';
  end if;
  raise notice 'FLW3 PASS';
end $$;

rollback;
