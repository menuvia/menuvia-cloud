-- =============================================================================
-- Migration 322: harta sălii se scrie DOAR prin `save_floor_layout`
-- (lotul O7a, audit nov 2026 — pierderi de date)
-- =============================================================================
-- `restaurants.floor_layout` avea DOUĂ căi de scriere:
--   1. RPC-ul `save_floor_layout` (018 → 154 → 311): DEFINER `public, pg_temp`,
--      rol owner/manager (sau fondatorul, 311), gate de plan `floor_plan`
--      (doar pro/enterprise), `jsonb_typeof = 'object'` (hint `invalid_layout`)
--      și plafon de 1 MiB (hint `layout_too_large`);
--   2. grant-ul column-level `update (floor_layout)` pentru `authenticated` din
--      096B (Sec 5), deci un `PATCH /rest/v1/restaurants` direct.
-- Calea 2 ocolea TOATE cele patru gate-uri: reprodus sub rolul REAL
-- `authenticated`, un owner pe growth e refuzat de RPC cu `feature_disabled`,
-- dar `update restaurants set floor_layout = '[1,2,3]'` trece, la fel un blob
-- de 2,1 MB.
--
-- Mai grav, calea 2 era folosită fără intenție: formularul din Setări pornește
-- de la rândul încărcat la montare și îl trimite ÎNTREG (`pickAllowed` păstra
-- `floor_layout` în RESTAURANT_UPDATE_FIELDS), iar nimic nu reîmprospăta lista
-- după o salvare a hărții prin RPC. Deci: salvezi harta → mergi în Setări →
-- salvezi programul → harta VECHE (sau NULL) suprascrie tăcut harta nouă.
-- Reprodus pe un owner pro: după `save_floor_layout(NOU)`, un PATCH în forma
-- salvării din Setări, cu `floor_layout = null`, trece și lasă NULL.
--
-- Fix: gate în DATE, nu revoke. Trigger-ul `trg_restaurants_floor_layout_rpc_only`
-- (BEFORE UPDATE ROW, tgtype 19) PĂSTREAZĂ `old.floor_layout` când scrierea vine
-- din `anon`/`authenticated`. Funcția e NE-definer DELIBERAT (ca 262/270/287):
-- trebuie să vadă rolul APELANTULUI; din `save_floor_layout` (DEFINER deținut de
-- postgres) `current_user` = postgres, deci RPC-ul scrie în continuare.
--
-- DE CE NU revoke (prima variantă a acestei migrații, nelivrată — recenzia
-- O7a): PostgREST pune fiecare cheie din corp în lista SET, iar Postgres verifică
-- privilegiul de coloană ÎNAINTEA oricărui trigger și indiferent de valoare.
-- Bundle-ul VECHI are `floor_layout` în RESTAURANT_UPDATE_FIELDS, deci ORICE
-- salvare din Setări îl cară (chiar și null) — după un revoke ar fi primit
-- 42501, afișat ca „Nu ai drepturi”, și NICIO setare nu s-ar mai fi salvat
-- până la un reload complet. „Frontend întâi” nu acoperea filele deschise de
-- dinaintea deploy-ului: `useSWUpdate` nu cheamă `registration.update()`, iar
-- navigarea SPA nu declanșează verificarea SW-ului, deci o tabletă de staff
-- rulează bundle-ul vechi fără niciun card de actualizare. Cu trigger-ul,
-- salvarea veche trece (restul câmpurilor se scriu), iar harta rămâne cea
-- curentă. Ordinea de deploy e LIBERĂ.
--
-- Păstrare TĂCUTĂ, nu respingere: o respingere pe „valoare diferită” ar bloca
-- exact salvarea veche din Setări peste o hartă salvată între timp (copia din
-- formular e mai veche decât rândul) — aceeași regresie. Un PATCH ostil nu
-- câștigă nimic: harta rămâne cea scrisă prin RPC, iar răspunsul (rândul
-- întors) arată adevărul. `service_role` și proprietarul nu sunt atinși.
--
-- Grant-ul de coloană din 096B RĂMÂNE deocamdată (RW1 îl ține în whitelist-ul
-- SQL; `RESTAURANT_UPDATE_FIELDS` nu mai trimite coloana — divergență
-- deliberată). Revoke-ul (eroare zgomotoasă în loc de păstrare tăcută) poate
-- veni într-o migrație ULTERIOARĂ, după ce bundle-urile vechi au dispărut;
-- trigger-ul rămâne backstop-ul permanent.
--
-- Nicio dată nu se rescrie. Citirile (`get_public_floor_plan`, SELECT-ul din
-- WaiterPage) nu sunt atinse.
--
-- Înainte de `db push` pe prod, rulează (read-only) și consemnează rândurile:
--   select id, jsonb_typeof(floor_layout), octet_length(floor_layout::text),
--          public.restaurant_has_feature(id, 'floor_plan')
--     from public.restaurants
--    where floor_layout is not null
--      and (jsonb_typeof(floor_layout) <> 'object'
--           or octet_length(floor_layout::text) > 1048576
--           or not public.restaurant_has_feature(id, 'floor_plan'));
-- Hărțile scrise deja pe calea ocolitoare NU sunt curățate aici — decizie de
-- fondator.
--
-- Teste: FLW1–FLW3 `tests/sql/auto/322_floor_layout_rpc_only.sql` (ambele
-- medii) + RW1 (`restaurant_update_whitelist_assertions.sql`: `floor_layout`
-- scriibil DOAR cu trigger-ul prezent).
-- =============================================================================

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '60s';

-- NE-definer DELIBERAT: trebuie să vadă rolul APELANTULUI. Promovată la DEFINER,
-- `current_user` ar fi mereu postgres și gate-ul ar deveni vacuu (FLW1/FLW2).
create or replace function public.fn_restaurants_floor_layout_rpc_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('anon', 'authenticated')
     and new.floor_layout is distinct from old.floor_layout then
    -- Păstrare, nu respingere: un client vechi cară harta din formularul de
    -- Setări în orice PATCH; restul câmpurilor trebuie să se salveze.
    new.floor_layout := old.floor_layout;
  end if;
  return new;
end;
$$;

revoke all on function public.fn_restaurants_floor_layout_rpc_only()
  from public, anon, authenticated, service_role;

-- Fără listă `UPDATE OF`: se declanșează pe ORICE UPDATE, deci nicio formă de
-- instrucțiune nu-l ocolește.
drop trigger if exists trg_restaurants_floor_layout_rpc_only on public.restaurants;
create trigger trg_restaurants_floor_layout_rpc_only
  before update on public.restaurants
  for each row
  execute function public.fn_restaurants_floor_layout_rpc_only();

comment on function public.fn_restaurants_floor_layout_rpc_only() is
  'mig 322 (O7a): anon/authenticated nu pot schimba restaurants.floor_layout direct — valoarea veche se păstrează; harta se scrie DOAR prin save_floor_layout (DEFINER). NE-definer deliberat.';

-- ── Asserție fail-closed ─────────────────────────────────────────────────────
do $$
declare
  v_tgtype int;
  v_tgattr text;
  v_cfg    text[];
begin
  select tgtype, tgattr::text into v_tgtype, v_tgattr
    from pg_trigger
   where tgname = 'trg_restaurants_floor_layout_rpc_only'
     and tgrelid = 'public.restaurants'::regclass and not tgisinternal;
  if v_tgtype is distinct from 19 or v_tgattr <> '' then
    raise exception 'mig 322: trigger-ul trebuie să fie BEFORE UPDATE FOR EACH ROW fără listă de coloane (tgtype 19), este % / %', v_tgtype, v_tgattr;
  end if;

  if exists (select 1 from pg_proc
              where oid = 'public.fn_restaurants_floor_layout_rpc_only()'::regprocedure and prosecdef) then
    raise exception 'mig 322: gate-ul NU are voie să fie DEFINER (ar ascunde rolul apelantului)';
  end if;

  if has_function_privilege('anon', 'public.fn_restaurants_floor_layout_rpc_only()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.fn_restaurants_floor_layout_rpc_only()', 'EXECUTE') then
    raise exception 'mig 322: funcția de trigger e executabilă de roluri client (RP13)';
  end if;

  -- Ancoră: nicio coloană nu și-a pierdut grant-ul — Setările scriu în continuare.
  if not has_column_privilege('authenticated', 'public.restaurants', 'wifi_password', 'UPDATE') then
    raise exception 'mig 322: authenticated a pierdut UPDATE pe wifi_password';
  end if;

  -- Singura cale rămasă trebuie să existe și să fie apelabilă.
  if not has_function_privilege('authenticated', 'public.save_floor_layout(uuid,jsonb)', 'EXECUTE') then
    raise exception 'mig 322: authenticated nu mai poate apela save_floor_layout — harta n-ar mai avea nicio cale de scriere';
  end if;

  select p.proconfig into v_cfg
    from pg_proc p
   where p.oid = 'public.save_floor_layout(uuid,jsonb)'::regprocedure
     and p.prosecdef;
  if v_cfg is null or not ('search_path=public, pg_temp' = any (v_cfg)) then
    raise exception 'mig 322: save_floor_layout nu mai e SECURITY DEFINER cu search_path public, pg_temp (proconfig=%)', v_cfg;
  end if;

  raise notice 'mig 322 OK: floor_layout se scrie doar prin save_floor_layout (gate în date)';
end $$;

commit;
