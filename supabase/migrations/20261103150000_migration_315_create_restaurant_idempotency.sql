-- ═══════════════════════════════════════════════════════════════════
-- Migration 315: create_restaurant — idempotent pe (proprietar, cheie)
-- ─────────────────────────────────────────────────────────────────────
-- PROBLEMA (recenzia CodeRabbit pe #344, „Adaugă o locație", lotul A):
-- o creare al cărei răspuns se pierde (rețea căzută după COMMIT) e AMBIGUĂ.
-- Clientul caută apoi locația în listă, dar „negăsită" nu dovedește nimic:
-- cererea poate fi încă în drum sau necomisă, iar `create_restaurant`
-- (221) alege ALT slug la coliziune, deci o reîncercare face o locație
-- DUBLĂ. Dubla nu se mai poate șterge (DELETE revocat din 096B) și ocupă
-- PERMANENT un loc din limita planului (`enforce_restaurant_limit`, 131).
-- O fereastră de timp în client micșorează riscul, nu îl închide: nicio
-- măsurătoare de ceas nu dovedește că o cerere întârziată nu mai poate
-- începe.
--
-- FIX (tiparul rezervărilor, mig 273): garanția stă în DATE.
--   1) `restaurants.create_idempotency_key uuid` + index UNIC PARȚIAL pe
--      (owner_id, create_idempotency_key) where not null — garanția reală,
--      independentă de cod și de ceas.
--   2) `create_restaurant` primește `p_idempotency_key uuid default null`
--      (ULTIMUL parametru, cu default → apelurile existente cu 4 argumente
--      — OnboardingPage, testele G6/SL — rămân valide). Cu cheie, un LOOKUP
--      înaintea insert-ului întoarce rândul existent (`replayed: true`),
--      deci o reîncercare nu lovește nici limita de plan, nici slug-ul.
--   3) BACKSTOP pentru cursa a două cereri simultane cu aceeași cheie: bucla
--      de slug din 221 prinde `unique_violation`; acum distinge PE NUMELE
--      CONSTRÂNGERII — coliziunea pe cheie re-citește rândul câștigător și îl
--      întoarce, coliziunea pe slug își păstrează comportamentul (sufix nou +
--      reîncercare). Fără distincție, bucla ar fi re-încercat pe cheie de 6
--      ori și ar fi aruncat „could not allocate a unique slug" — o eroare
--      falsă pentru o creare care A REUȘIT.
--   Cheia e scopată pe proprietar: aceeași cheie la alt cont creează normal
--   (nu întoarce locația altcuiva).
--
-- SEMNĂTURĂ NOUĂ → DROP + CREATE (anti PGRST203, ca 243/273): un
-- `create or replace` cu un parametru în plus ar lăsa ambele overload-uri.
-- Restul corpului e VERBATIM 221 (auth, nume, normalizarea slug-ului din
-- 148, handler-ul de cursă pe slug, forma răspunsului). Convenția celor 7
-- RPC-uri de autorizare (096): DEFINER, jsonb, `public, pg_temp`, PUBLIC fără
-- EXECUTE, doar `authenticated` — revoke-ul e EXPLICIT pe anon și
-- service_role (default privileges Supabase acordă EXECUTE funcțiilor noi).
-- Clichetele RP10 / G7 se actualizează la noua semnătură în același PR.
--
-- Client: `createRestaurant({ idempotencyKey })` (lib/restaurants.ts) cade
-- O SINGURĂ dată pe semnătura veche la PGRST202 (frontend înaintea
-- migrației), ca „Adaugă o locație" să nu se rupă pe o bază fără 315.
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.restaurants
  add column if not exists create_idempotency_key uuid;

create unique index if not exists restaurants_owner_create_key_uidx
  on public.restaurants (owner_id, create_idempotency_key)
  where create_idempotency_key is not null;

drop function if exists public.create_restaurant(text, text, text, text);

create or replace function public.create_restaurant(
  p_name text,
  p_city text default null,
  p_slug text default null,
  p_primary_color text default '#C8963C',
  p_idempotency_key uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_id   uuid;
  v_slug text;
  v_base text;
  v_constraint text;
begin
  if v_uid is null then
    raise exception using errcode = 'insufficient_privilege',
      message = 'create_restaurant requires authentication';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception using errcode = 'check_violation', message = 'name is required';
  end if;

  -- Reîncercare cu aceeași cheie (mig 315): întoarce locația deja creată,
  -- ÎNAINTEA limitei de plan și a slug-ului — nimic nu se mai inserează.
  if p_idempotency_key is not null then
    select r.id, r.slug into v_id, v_slug
      from public.restaurants r
     where r.owner_id = v_uid
       and r.create_idempotency_key = p_idempotency_key;
    if v_id is not null then
      return jsonb_build_object('ok', true,
                                'restaurant_id', v_id,
                                'restaurant_slug', v_slug,
                                'replayed', true);
    end if;
  end if;

  -- Normalizează slug-ul (inclusiv cel furnizat de user) la lowercase (mig 148).
  v_slug := coalesce(nullif(btrim(p_slug), ''), lower(p_name));
  v_slug := regexp_replace(lower(v_slug), '[^a-z0-9]+', '-', 'g');
  v_slug := btrim(v_slug, '-');
  if v_slug = '' then
    v_slug := 'r-' || substring(gen_random_uuid()::text, 1, 8);
  end if;
  v_base := v_slug;  -- baza pentru regenerare pe coliziune

  -- Insert cu retry pe coliziune de slug (mig 221): pre-check `while` = fast-path,
  -- dar cursa reală (TOCTOU) e prinsă de `exception when unique_violation` → sufix
  -- nou și reîncercare. Max 6 iterații; practic imposibil să se epuizeze.
  for i in 1..6 loop
    begin
      -- fast-path: dacă slug-ul curent e liber, îl folosim; altfel adăugăm sufix
      while exists (select 1 from public.restaurants where lower(slug) = v_slug) loop
        v_slug := v_base || '-' || substring(gen_random_uuid()::text, 1, 4);
      end loop;

      insert into public.restaurants (owner_id, name, city, slug, primary_color,
                                      create_idempotency_key)
      values (v_uid, btrim(p_name), nullif(btrim(p_city), ''), v_slug, p_primary_color,
              p_idempotency_key)
      returning id into v_id;

      exit;  -- succes
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'restaurants_owner_create_key_uidx' then
        -- Cerere SIMULTANĂ cu aceeași cheie (mig 315): cealaltă a comis întâi
        -- (indexul unic ne-a ținut până la COMMIT-ul ei), deci rândul e vizibil
        -- acum. Îl întoarcem — crearea A REUȘIT, o singură dată.
        select r.id, r.slug into v_id, v_slug
          from public.restaurants r
         where r.owner_id = v_uid
           and r.create_idempotency_key = p_idempotency_key;
        if v_id is null then
          raise;
        end if;
        return jsonb_build_object('ok', true,
                                  'restaurant_id', v_id,
                                  'restaurant_slug', v_slug,
                                  'replayed', true);
      end if;
      -- Alt tx a luat slug-ul între check și insert. Sufix aleator nou + retry.
      v_slug := v_base || '-' || substring(gen_random_uuid()::text, 1, 6);
    end;
  end loop;

  if v_id is null then
    raise exception using errcode = 'unique_violation',
      message = 'could not allocate a unique slug after retries';
  end if;

  return jsonb_build_object('ok', true,
                            'restaurant_id', v_id,
                            'restaurant_slug', v_slug);
end$$;

revoke all on function public.create_restaurant(text, text, text, text, uuid)
  from public, anon, service_role;
grant execute on function public.create_restaurant(text, text, text, text, uuid)
  to authenticated;

-- ── Asserții fail-closed ─────────────────────────────────────────────
do $$
declare v_def text; v_n int;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_restaurant';
  if v_n <> 1 then
    raise exception 'ASSERT FAIL: create_restaurant are % semnături (aștept 1, anti PGRST203)', v_n;
  end if;
  v_def := pg_get_functiondef('public.create_restaurant(text, text, text, text, uuid)'::regprocedure);
  if position('when unique_violation then' in v_def) = 0 then
    raise exception 'ASSERT FAIL: create_restaurant fără handler unique_violation (mig 221)';
  end if;
  if position('restaurants_owner_create_key_uidx' in v_def) = 0 then
    raise exception 'ASSERT FAIL: create_restaurant nu distinge coliziunea pe cheie (mig 315)';
  end if;
  if to_regclass('public.restaurants_owner_create_key_uidx') is null then
    raise exception 'ASSERT FAIL: indexul unic pe (owner_id, create_idempotency_key) lipsește';
  end if;
  if has_function_privilege('anon', 'public.create_restaurant(text, text, text, text, uuid)', 'execute') then
    raise exception 'ASSERT FAIL: create_restaurant nu trebuie apelabil de anon';
  end if;
  if has_function_privilege('service_role', 'public.create_restaurant(text, text, text, text, uuid)', 'execute') then
    raise exception 'ASSERT FAIL: create_restaurant nu trebuie apelabil de service_role';
  end if;
  if not has_function_privilege('authenticated', 'public.create_restaurant(text, text, text, text, uuid)', 'execute') then
    raise exception 'ASSERT FAIL: create_restaurant trebuie apelabil de authenticated';
  end if;
end $$;

commit;
