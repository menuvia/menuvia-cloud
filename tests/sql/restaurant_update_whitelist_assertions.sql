-- tests/sql/restaurant_update_whitelist_assertions.sql
-- =============================================================================
-- RW1: whitelist-ul de coloane UPDATE-abile pe `public.restaurants`.
--
-- DE CE E UN FIȘIER SEPARAT (audit v3, rangul 13):
-- Asserția asta trăia ca „F6" în `authorization_final_state_assertions.sql`, o
-- suită pe care CI-ul o rulează sub condiția
--   hashFiles(mig 096b) != '' AND hashFiles(mig 096c) == ''
-- adică DOAR în era dintre 096b și 096c. Mig 096c există din iunie 2026, deci
-- condiția e permanent falsă și F6 NU a mai rulat niciodată de atunci — exact
-- tiparul „gate declarat care nu se execută" pe care auditul îl semnalează.
-- Aici rulează NECONDIȚIONAT, la fiecare replay.
--
-- CE PĂZEȘTE: `restaurants` e column-gated. `RESTAURANT_UPDATE_FIELDS`
-- (src/lib/sanitize.ts) trebuie ținut în sincron cu grant-urile din DB — o
-- coloană nouă care primește din greșeală `grant update ... to authenticated`
-- devine scriibilă de orice membru, iar `slug`/`owner_id` au RPC-uri și
-- triggere dedicate tocmai fiindcă NU au voie să fie scrise direct.
-- Whitelist-ul de mai jos e o listă EXACTĂ, nu un minim: orice coloană în plus
-- pică testul, deci un grant accidental viitor nu poate trece tăcut.
--
-- Când adaugi legitim o coloană editabilă din UI, ea se sincronizează în 4
-- locuri (vezi CLAUDE.md): migrația cu `grant update (...)`, whitelist-ul de
-- aici, `RESTAURANT_UPDATE_FIELDS` și testul JS corespunzător.
-- Self-contained, fără seed, fără ROLLBACK (doar citește catalogul).
-- =============================================================================

\set ON_ERROR_STOP on

do $$
declare
  v_col   text;
  v_extra text;
  v_lipsa text;
  v_whitelist text[] := array[
    'name','tagline','city','description','address','phone','hours',
    'hours_structured','timezone','wifi_password','primary_color','logo_url',
    'cover_url',
    -- `floor_layout`: grant-ul PĂSTRAT deliberat (mig 322) — un bundle vechi
    -- cară coloana în orice PATCH din Setări și un revoke i-ar fi blocat toată
    -- salvarea cu 42501. Gate-ul e în DATE (trg_restaurants_floor_layout_rpc_only
    -- păstrează valoarea veche pentru anon/authenticated; harta se scrie doar
    -- prin save_floor_layout). RESTAURANT_UPDATE_FIELDS NU o mai trimite —
    -- divergență deliberată; (c) cere trigger-ul cât timp grant-ul există.
    'floor_layout',
    'socials','amenities',
    'checkout_suggestion_settings','theme_settings','pickup_settings',
    'google_place_id','google_review_url',
    -- mig 197 — meniu multilingv: grant update (menu_languages) pe restaurants.
    'menu_languages',
    -- mig 205 — moneda meniului (expansiune internațională planurile 1-2).
    'currency',
    -- mig 296 — țara (regula de aur pe țară; schimbarea e owner-only în DATE).
    'country',
    -- mig 298 — limba de BAZĂ a meniului (CHECK pe cele 7 limbi ale meniului).
    'language'
  ];
begin
  -- (a) Toate coloanele din whitelist TREBUIE să rămână UPDATE-abile: dacă un
  --     revoke prea larg le ia, UI-ul de setări se rupe tăcut la salvare.
  select string_agg(w, ', ') into v_lipsa
    from unnest(v_whitelist) as w
   where not has_column_privilege('authenticated', 'public.restaurants', w, 'UPDATE');
  if v_lipsa is not null then
    raise exception 'RW1 FAIL: authenticated a pierdut UPDATE pe coloanele: %', v_lipsa;
  end if;

  -- (b) ZERO coloane în AFARA whitelist-ului: lista e exactă, nu un minim.
  select string_agg(c.column_name, ', ' order by c.ordinal_position)
    into v_extra
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name   = 'restaurants'
     and has_column_privilege('authenticated', 'public.restaurants', c.column_name, 'UPDATE')
     and not (c.column_name = any (v_whitelist));
  if v_extra is not null then
    raise exception 'RW1 FAIL: authenticated poate scrie coloane din afara whitelist-ului: % '
                    '(adaugă-le în whitelist DOAR dacă sunt intenționat editabile din UI, '
                    'și sincronizează RESTAURANT_UPDATE_FIELDS din src/lib/sanitize.ts)', v_extra;
  end if;

  -- (c) Sanity expliciți pe coloanele cu cale dedicată: `slug` se schimbă
  --     exclusiv prin `change_restaurant_slug` (RPC), iar `owner_id` e imuabil
  --     (trg_restaurants_owner_id_immutable). Redundanți cu (b), dar dau un
  --     mesaj de eroare care spune imediat ce s-a rupt. `floor_layout` se scrie
  --     exclusiv prin `save_floor_layout` (mig 322): cât timp grant-ul de
  --     coloană există, trigger-ul care păstrează valoarea veche TREBUIE să
  --     existe — altfel PATCH-ul direct ocolește gate-ul floor_plan.
  if has_column_privilege('authenticated', 'public.restaurants', 'owner_id', 'UPDATE') then
    raise exception 'RW1 FAIL: authenticated poate scrie restaurants.owner_id (owner_id e imuabil)';
  end if;
  if has_column_privilege('authenticated', 'public.restaurants', 'slug', 'UPDATE') then
    raise exception 'RW1 FAIL: authenticated poate scrie restaurants.slug (doar prin change_restaurant_slug)';
  end if;
  if has_column_privilege('authenticated', 'public.restaurants', 'floor_layout', 'UPDATE')
     and not exists (select 1 from pg_trigger
                      where tgname = 'trg_restaurants_floor_layout_rpc_only'
                        and tgrelid = 'public.restaurants'::regclass
                        and not tgisinternal and tgenabled <> 'D') then
    raise exception 'RW1 FAIL: authenticated poate scrie restaurants.floor_layout fără trg_restaurants_floor_layout_rpc_only (doar prin save_floor_layout, mig 322)';
  end if;

  raise notice 'RW1 OK: whitelist EXACT de % coloane UPDATE pe restaurants; owner_id/slug excluse, floor_layout sub trigger',
    array_length(v_whitelist, 1);
end $$;
