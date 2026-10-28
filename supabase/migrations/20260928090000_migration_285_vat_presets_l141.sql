-- migration_285_vat_presets_l141.sql
-- =============================================================================
-- FR-07 — Preset-ul TVA din Setup Asistent scria cote ABROGATE (19% / 9% / 5%).
--
-- `apply_vat_preset` (mig 034, singura definiție din lanț; mig 262 i-a adăugat
-- doar pg_temp prin ALTER FUNCTION) oferea 'simple_19' (grupa 1 → 19%),
-- 'food_9' (9% + 19%) și 'tourism_5' (9% + 19% + 5%). Legea 141/2025 (în
-- vigoare din 1 aug 2025) a eliminat cotele de 5% și 9%, a introdus cota
-- redusă UNICĂ de 11% și a urcat standardul la 21%. Mig 102 a mutat
-- DEFAULT-urile, mig 109 descrierile-ghid — preset-ul a rămas pe legea veche.
-- Setup Asistent e randat pe Acasă cât timp setup-ul nu e complet, pe ORICE
-- plan, deci un owner care apăsa „Aplică" își RESCRIA cotele la valori abrogate;
-- din mig 272 cota se SNAPSHOT-uiește pe fiecare linie vândută, deci greșeala
-- intra permanent în raportul TVA și în facturile Oblio.
--
-- Trei defecte în plus în corpul vechi, închise aici:
--   (a) suprascria maparea pe casa de marcat (coloana setată de INSTALATOR în
--       BridgeTab, config de DEVICE citit LIVE de build_fiscalnet_payload, mig
--       272) — un „preset de TVA" re-ruta tăcut liniile bonului pe altă grupă
--       a casei;
--   (b) 'simple_19'/'food_9' lăsau grupele 3/4 neatinse → un local creat
--       înainte de 102 rămânea cu grupa 3 la 5% după ce „aplicase preset-ul";
--   (c) 'simple_19' punea grupa 1 („Mâncare") la cota standard — cota legală
--       depinde de PRODUS (clasificarea pe grupă), nu de local.
--
-- Cu o singură cotă redusă, tabela grupă → cotă e UNICĂ. De aceea:
--   1. `vat_rate_defaults_ro()` — SURSA UNICĂ: valorile EXACTE din mig 109
--      (11/21/11/0 + etichete + descrieri-ghid).
--   2. `create_default_vat_rates` (029→102→109→285) citește din ea — aceleași
--      valori ca 109, deci comportament IDENTIC pentru restaurantele noi.
--   3. `apply_vat_preset` (034→285), aceeași semnătură (uuid, text) → create or
--      replace (grant-urile se re-scriu oricum explicit mai jos):
--        • un singur preset, 'ro_l141_2025' = EXACT default-urile, toate 4 grupele;
--        • id-urile vechi → RESPINSE cu hint `vat_preset_retired` (un client
--          vechi din cache nu mai poate scrie 19/9/5 și nici nu primește tăcut
--          altceva decât i-a arătat ecranul);
--        • UPSERT-ul NU atinge maparea pe casă pe rândurile existente; un rând
--          LIPSĂ se creează exact ca în trigger-ul de creare (coloana pe default);
--        • gate-ul `is_admin` rămâne primul, cu același mesaj.
--
-- Ce NU face (intenționat — raționamentul din mig 102):
--   • NU face UPDATE în masă pe `vat_rates` existente, nici pe cele scrise de
--     preset-urile vechi. Cotele aparțin restaurantului; preset-ul reparat E
--     calea owner-ului spre cotele legale (din 272 istoria vânzărilor nu se
--     rescrie la schimbarea cotei — snapshot pe linie).
--   • NU adaugă gate de plan: `vat_rates` e seed-uită de trigger pe ORICE plan,
--     iar politica „vat_rates: admin manage" (029) permite același UPDATE direct
--     prin PostgREST — un gate doar pe RPC ar fi teatru. Consumatorii FISCALI ai
--     cotelor (bon, raport TVA, Oblio) au gate-urile lor de Plan 3.
--
-- Teste: VP1–VP7 tests/sql/vat_preset_assertions.sql (sql-verify + E2E) +
-- QS1–QS6 src/lib/__tests__/quickSetup.test.ts (QS3 citește ACEST fișier).
-- =============================================================================

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── 1) Sursa unică: tabela legală grupă → cotă (L.141/2025, mig 102/109) ─────
-- Forma rândurilor e CONTRACT pentru QS3 (vitest): `(N::smallint, R::numeric,
-- 'Eticheta'::text, ...` — nu o reformata fără să actualizezi parserul testului.
create or replace function public.vat_rate_defaults_ro()
returns table (vat_group smallint, rate_percent numeric, label text, description text)
language sql
immutable
set search_path = public, pg_temp
as $$
  values
    (1::smallint, 11.00::numeric, 'Mâncare'::text,
     'Mâncare, apă plată, cafea, ceai, lapte (cotă redusă 11%, L.141/2025). NU include răcoritoare CN 2202 / băuturi cu zahăr ≥10g/100g — acelea = grupa 2 (21%).'::text),
    (2::smallint, 21.00::numeric, 'Alcool'::text,
     'Alcool, bere, vin, spirtoase, țigări, accize + băuturi nealcoolice la cotă standard (răcoritoare CN 2202, băuturi cu zahăr ≥10g/100g), cotă standard 21% (L.141/2025 + HG 602/2025).'::text),
    (3::smallint, 11.00::numeric, 'Special'::text,
     'Rezervă pentru cazuri rare; pentru produse nealcoolice la cotă standard folosește grupa 2 (21%). Verifică cu contabilul.'::text),
    (4::smallint, 0.00::numeric, 'Scutit'::text,
     'Produse scutite explicit de TVA'::text)
$$;

comment on function public.vat_rate_defaults_ro() is
  'Sursa UNICĂ a cotelor TVA implicite RO (L.141/2025): grupă → cotă/etichetă/descriere. Citită de create_default_vat_rates (restaurant nou) și apply_vat_preset (Setup Asistent) — mig 285.';

-- Helper intern: îl apelează doar funcțiile DEFINER de mai jos (proprietar
-- postgres). Default privileges din Supabase acordă EXECUTE DIRECT rolurilor
-- client pe orice funcție nouă, deci revoke-ul se scrie per rol.
revoke all on function public.vat_rate_defaults_ro() from public, anon, authenticated, service_role;

-- ── 2) create_default_vat_rates (029→102→109→285): aceleași valori, din sursă ─
create or replace function public.create_default_vat_rates()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.vat_rates (restaurant_id, vat_group, rate_percent, label, description)
  select NEW.id, d.vat_group, d.rate_percent, d.label, d.description
    from public.vat_rate_defaults_ro() d
  on conflict (restaurant_id, vat_group) do nothing;
  return NEW;
end;
$$;

-- `create or replace` păstrează ACL-ul (revoke-ul din mig 279), dar îl
-- rescriem explicit: RP13 cere ca funcțiile de trigger să nu fie apelabile
-- de rolurile client prin /rpc.
revoke execute on function public.create_default_vat_rates() from public, anon, authenticated;

-- ── 3) apply_vat_preset (034→285) ────────────────────────────────────────────
-- Lista SET din ON CONFLICT e DELIBERAT fără maparea pe casă (vezi antetul, (a)).
-- Nu pomeni numele acelei coloane în CORPUL funcției: VP3 verifică
-- comportamentul, dar un comentariu în corp ar induce în eroare orice grep.
create or replace function public.apply_vat_preset(
  p_restaurant_id uuid,
  p_preset        text  -- 'ro_l141_2025'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int := 0;
begin
  if not public.is_admin(p_restaurant_id) then
    raise exception 'Not admin of this restaurant';
  end if;

  if p_preset in ('simple_19', 'food_9', 'tourism_5') then
    raise exception 'Preset-ul TVA „%" folosește cote abrogate de L.141/2025 (19%%, 9%%, 5%%). Reîncarcă pagina și aplică cotele legale actuale.', p_preset
      using hint = 'vat_preset_retired';
  end if;

  if p_preset is distinct from 'ro_l141_2025' then
    raise exception 'Invalid preset: %', coalesce(p_preset, '<NULL>')
      using hint = 'invalid_preset';
  end if;

  insert into public.vat_rates (restaurant_id, vat_group, rate_percent, label, description)
  select p_restaurant_id, d.vat_group, d.rate_percent, d.label, d.description
    from public.vat_rate_defaults_ro() d
  on conflict (restaurant_id, vat_group) do update set
    rate_percent = excluded.rate_percent,
    label        = excluded.label,
    description  = excluded.description,
    is_active    = true,
    updated_at   = now();

  get diagnostics v_count = row_count;

  return jsonb_build_object(
    'status',        'success',
    'preset',        p_preset,
    'rates_applied', v_count
  );
end;
$$;

revoke all on function public.apply_vat_preset(uuid, text) from public, anon, service_role;
grant execute on function public.apply_vat_preset(uuid, text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- Asserții fail-closed (o singură evaluare, la poziția 285 — clichetul VIU e
-- suita VP, care rulează pe starea FINALĂ a lanțului la fiecare CI)
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_diff int;
  v_n    int;
  v_src  text;
begin
  -- Ancora legală: sursa unică dă EXACT tabela din mig 102/109.
  select count(*) into v_diff from (
    (select d.vat_group, d.rate_percent from public.vat_rate_defaults_ro() d
     except
     select w.g, w.r from (values (1::smallint, 11.00::numeric), (2::smallint, 21.00::numeric),
                                  (3::smallint, 11.00::numeric), (4::smallint,  0.00::numeric)) w(g, r))
    union all
    (select w.g, w.r from (values (1::smallint, 11.00::numeric), (2::smallint, 21.00::numeric),
                                  (3::smallint, 11.00::numeric), (4::smallint,  0.00::numeric)) w(g, r)
     except
     select d.vat_group, d.rate_percent from public.vat_rate_defaults_ro() d)
  ) x;
  if v_diff <> 0 then
    raise exception 'mig 285: vat_rate_defaults_ro nu mai e tabela L.141/2025 (11/21/11/0) — % diferențe', v_diff;
  end if;

  -- Derivare: AMBELE funcții citesc din sursa unică (altfel preset-ul și
  -- default-urile pot diverge din nou — exact FR-07).
  select p.prosrc into v_src from pg_proc p
   where p.oid = 'public.apply_vat_preset(uuid,text)'::regprocedure;
  if position('vat_rate_defaults_ro' in v_src) = 0 then
    raise exception 'mig 285: apply_vat_preset nu derivă din vat_rate_defaults_ro';
  end if;
  select p.prosrc into v_src from pg_proc p
   where p.oid = 'public.create_default_vat_rates()'::regprocedure;
  if position('vat_rate_defaults_ro' in v_src) = 0 then
    raise exception 'mig 285: create_default_vat_rates nu derivă din vat_rate_defaults_ro';
  end if;

  -- O singură semnătură (anti PGRST203).
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'apply_vat_preset';
  if v_n <> 1 then
    raise exception 'mig 285: % semnături apply_vat_preset (aștept 1)', v_n;
  end if;

  -- Privilegii EFECTIVE.
  if not has_function_privilege('authenticated', 'public.apply_vat_preset(uuid,text)', 'EXECUTE') then
    raise exception 'mig 285: authenticated a pierdut EXECUTE pe apply_vat_preset';
  end if;
  if has_function_privilege('anon', 'public.apply_vat_preset(uuid,text)', 'EXECUTE') then
    raise exception 'mig 285: anon poate executa apply_vat_preset';
  end if;
  if has_function_privilege('anon', 'public.vat_rate_defaults_ro()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.vat_rate_defaults_ro()', 'EXECUTE') then
    raise exception 'mig 285: vat_rate_defaults_ro e apelabilă de rolurile client';
  end if;

  raise notice 'mig 285: preset TVA = default-urile L.141/2025 (sursă unică), id-uri vechi retrase, mapare pe casă neatinsă';
end $$;

commit;
