-- tests/sql/table_limit_assertions.sql
-- =============================================================================
-- Asersții pentru CFG-2 (mig 114): bypass-ul limitei de mese printr-un INSERT
-- multi-row. Trigger-ul per-row (mig 013) nu vede rândurile-frați din același
-- statement, deci un restaurant free (max_tables=3) putea insera zeci de mese
-- dintr-o singură comandă. Trigger-ul statement-level (mig 114) îl prinde.
--
-- Self-contained, ROLLBACK la final.
--
--   TL1  INSERT multi-row de 50 de mese pe restaurant free → RESPINS (depășește)
--   TL2  INSERT a câtorva mese sub limită (3 ≤ max) → ACCEPTAT (control pozitiv)
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Setup (ca postgres; handle_new_user creează profilurile) ─────────────────
insert into auth.users (id, email) values
  ('a1a1a1a1-1111-4111-8111-111111111111','owner-tl@tbl.test');

-- Planul restaurantului = free → max_tables = 3 (seed mig 062).
update public.profiles set plan='free' where id='a1a1a1a1-1111-4111-8111-111111111111';

-- Restaurant (trigger bootstrap creează owner membership; 0 mese inițial).
insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('b2b2b2b2-2222-4222-8222-222222222222','a1a1a1a1-1111-4111-8111-111111111111',
   'Rfree','rfree-tl','Cluj',true);

-- ── TL1: INSERT multi-row de 50 de mese pe free → respins ────────────────────
do $$
declare
  v_blocked boolean := false;
  v_count   int;
begin
  begin
    insert into public.tables (restaurant_id, name, slug, seats)
    select
      'b2b2b2b2-2222-4222-8222-222222222222',
      'Masa ' || g,
      'masa-' || g,
      4
    from generate_series(1, 50) as g;
  exception when others then
    -- Acceptăm orice eroare ce semnalează limita atinsă (hint/text).
    if sqlerrm ilike '%limită%' or sqlerrm ilike '%limita%' or sqlerrm ilike '%table_limit%'
      then v_blocked := true;
    else raise exception 'TL1: eroare neașteptată: %', sqlerrm; end if;
  end;

  if not v_blocked then
    raise exception 'TL1 FAIL: INSERT multi-row de 50 mese a trecut pe free (bypass limită)';
  end if;

  -- Rollback la nivel de statement: niciun rând nu trebuie să fi rămas.
  select count(*) into v_count
    from public.tables
   where restaurant_id='b2b2b2b2-2222-4222-8222-222222222222';
  if v_count <> 0 then
    raise exception 'TL1 FAIL: % mese persistă după respingere (statement nu a făcut rollback)', v_count;
  end if;

  raise notice 'TL1 OK: INSERT multi-row de 50 mese respins pe free (limită aplicată)';
end $$;

-- ── TL2: INSERT a 3 mese (= max) sub/la limită → acceptat ────────────────────
do $$
declare v_count int;
begin
  insert into public.tables (restaurant_id, name, slug, seats) values
    ('b2b2b2b2-2222-4222-8222-222222222222','Masa 1','masa-1',4),
    ('b2b2b2b2-2222-4222-8222-222222222222','Masa 2','masa-2',4),
    ('b2b2b2b2-2222-4222-8222-222222222222','Masa 3','masa-3',4);

  select count(*) into v_count
    from public.tables
   where restaurant_id='b2b2b2b2-2222-4222-8222-222222222222';
  if v_count <> 3 then
    raise exception 'TL2 FAIL: așteptam 3 mese, găsit %', v_count;
  end if;

  raise notice 'TL2 OK: INSERT multi-row sub limită (3 = max free) acceptat';
end $$;

do $$ begin raise notice '════ table limit assertions: ALL PASS ════'; end $$;

rollback;
