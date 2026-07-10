-- ═══════════════════════════════════════════════════════════════════
-- Migration 221: create_restaurant — handler unique_violation pe slug (anti TOCTOU)
-- ─────────────────────────────────────────────────────────────────────
-- BUG (audit securitate/reziliență, MEDIUM): create_restaurant (mig 148) verifică
-- unicitatea slug-ului cu `while exists(...)` ȘI APOI face INSERT. Între check și
-- insert e o fereastră TOCTOU: două create_restaurant concurente cu același nume trec
-- amândouă de `while`, apoi al doilea INSERT lovește UNIQUE și aruncă `23505` BRUT →
-- onboarding-ul unui user nou eșuează cu o eroare Postgres necosmetizată (nu retry, nu
-- mesaj clar). Rar, dar exact la primul contact cu produsul.
--
-- Fix (oglindește change_restaurant_slug, care are deja handler unique_violation):
-- înfășor INSERT-ul într-o buclă cu `exception when unique_violation` — la coliziune
-- regenerez slug-ul cu sufix aleator și reîncerc (max 6 iterații). Pre-check-ul `while`
-- rămâne ca fast-path (mai puține coliziuni). Restul (auth, name, normalizare, grants)
-- IDENTIC cu mig 148. Return type neschimbat → create or replace OK.
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.create_restaurant(
  p_name text,
  p_city text default null,
  p_slug text default null,
  p_primary_color text default '#C8963C'
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_id   uuid;
  v_slug text;
  v_base text;
begin
  if v_uid is null then
    raise exception using errcode = 'insufficient_privilege',
      message = 'create_restaurant requires authentication';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception using errcode = 'check_violation', message = 'name is required';
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

      insert into public.restaurants (owner_id, name, city, slug, primary_color)
      values (v_uid, btrim(p_name), nullif(btrim(p_city), ''), v_slug, p_primary_color)
      returning id into v_id;

      exit;  -- succes
    exception when unique_violation then
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

revoke all on function public.create_restaurant(text, text, text, text)
  from public, anon, service_role;
grant execute on function public.create_restaurant(text, text, text, text)
  to authenticated;

-- ── Asserție fail-closed: handler-ul de cursă e prezent + grants corecte ──
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.create_restaurant(text, text, text, text)'::regprocedure);
  if position('when unique_violation then' in v_def) = 0 then
    raise exception 'ASSERT FAIL: create_restaurant fără handler unique_violation (mig 221)';
  end if;
  if has_function_privilege('anon', 'public.create_restaurant(text, text, text, text)', 'execute') then
    raise exception 'ASSERT FAIL: create_restaurant nu trebuie apelabil de anon';
  end if;
  if not has_function_privilege('authenticated', 'public.create_restaurant(text, text, text, text)', 'execute') then
    raise exception 'ASSERT FAIL: create_restaurant trebuie apelabil de authenticated';
  end if;
end $$;

commit;
