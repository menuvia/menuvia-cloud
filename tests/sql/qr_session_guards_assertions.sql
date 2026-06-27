-- tests/sql/qr_session_guards_assertions.sql
-- =============================================================================
-- Aserții pentru mig 119: gărzi server-side QR.
--
--   QR-2  Masă dezactivată (tables.is_active=false) NU mai poate primi sesiuni:
--         trigger BEFORE INSERT pe table_sessions. Verificăm pe AMBELE căi —
--         open_table_session (RPC anon) și insert direct în table_sessions.
--   QR-3  Un singur token QR activ per masă: la inserarea unui token nou activ,
--         token-urile active vechi ale aceleiași mese devin inactive (trigger),
--         iar indexul parțial unic e plasa de siguranță.
--
-- Rulează DUPĂ migrații. Self-contained, ROLLBACK la final.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/qr_session_guards_assertions.sql
--
--   QS1  masă inactivă → open_table_session respins + insert sesiune respins
--   QS2  token nou activ pe masă → vechiul token devine inactiv (1 activ/masă)
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed minimal ─────────────────────────────────────────────────────────────
-- Owner + restaurant activ (settings + owner membership create de trigger).
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111','qrguard-owner@qr.test');

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',
   'QR Guard Test','qr-session-guards-slug','Cluj',true);

-- Masa A: dezactivată (pentru QS1). Masa B: activă (pentru QS2).
insert into public.tables (id, restaurant_id, name, slug, seats, is_active) values
  ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222',
   'Masa Inactiva','masa-inactiva',4,false),
  ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222',
   'Masa Activa','masa-activa',4,true);

-- Token activ pe masa inactivă (pentru open_table_session în QS1).
insert into public.qr_tokens (id, restaurant_id, table_id, token, is_active) values
  ('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222',
   '33333333-3333-4333-8333-333333333333','tok_masa_inactiva',true);

-- ── QS1: masă inactivă → nicio sesiune nouă ──────────────────────────────────
do $$
declare
  v_blocked boolean := false;
  v_cnt     integer;
begin
  -- (a) Calea RPC: open_table_session pe token-ul mesei dezactivate → respins.
  begin
    perform public.open_table_session('tok_masa_inactiva');
  exception when others then
    if sqlerrm ilike '%dezactivat%' then v_blocked := true;
    else raise exception 'QS1 FAIL: eroare neașteptată la open_table_session: %', sqlerrm; end if;
  end;

  if not v_blocked then
    raise exception 'QS1 FAIL: open_table_session a deschis sesiune pe masă dezactivată';
  end if;

  -- (b) Calea directă: insert raw în table_sessions pe masa inactivă → respins.
  v_blocked := false;
  begin
    insert into public.table_sessions (restaurant_id, table_id)
    values ('22222222-2222-4222-8222-222222222222',
            '33333333-3333-4333-8333-333333333333');
  exception when others then
    if sqlerrm ilike '%dezactivat%' then v_blocked := true;
    else raise exception 'QS1 FAIL: eroare neașteptată la insert sesiune: %', sqlerrm; end if;
  end;

  if not v_blocked then
    raise exception 'QS1 FAIL: insert direct a creat sesiune pe masă dezactivată';
  end if;

  -- Nicio sesiune nu trebuie să existe pe masa inactivă.
  select count(*) into v_cnt
  from public.table_sessions
  where table_id = '33333333-3333-4333-8333-333333333333';
  if v_cnt <> 0 then
    raise exception 'QS1 FAIL: există % sesiuni pe masa inactivă (așteptat 0)', v_cnt;
  end if;

  raise notice 'QS1 PASS: masă inactivă respinge sesiuni (RPC + insert direct)';
end$$;

-- Control pozitiv: pe masa activă open_table_session funcționează normal.
insert into public.qr_tokens (id, restaurant_id, table_id, token, is_active) values
  ('66666666-6666-4666-8666-666666666666','22222222-2222-4222-8222-222222222222',
   '44444444-4444-4444-8444-444444444444','tok_masa_activa_v1',true);

do $$
declare
  v_res jsonb;
begin
  v_res := public.open_table_session('tok_masa_activa_v1');
  if v_res->>'session_id' is null then
    raise exception 'QS1 FAIL (control): masa activă ar trebui să deschidă sesiune';
  end if;
  raise notice 'QS1 control PASS: masă activă deschide sesiune normal';
end$$;

-- ── QS2: un singur token activ per masă (rotație) ────────────────────────────
do $$
declare
  v_old_active boolean;
  v_active_cnt integer;
  v_new_active boolean;
begin
  -- Token-ul v1 al mesei active e activ înainte de rotație.
  select is_active into v_old_active
  from public.qr_tokens where token = 'tok_masa_activa_v1';
  if v_old_active is distinct from true then
    raise exception 'QS2 FAIL (setup): tok_masa_activa_v1 ar trebui activ înainte';
  end if;

  -- Rotație: inserăm un token NOU activ pe aceeași masă (ca rotateToken,
  -- dar fără UPDATE-ul prealabil din client — exact scenariul atacat).
  insert into public.qr_tokens (id, restaurant_id, table_id, token, is_active)
  values ('77777777-7777-4777-8777-777777777777',
          '22222222-2222-4222-8222-222222222222',
          '44444444-4444-4444-8444-444444444444','tok_masa_activa_v2',true);

  -- Vechiul token trebuie să fi devenit inactiv (trigger).
  select is_active into v_old_active
  from public.qr_tokens where token = 'tok_masa_activa_v1';
  if v_old_active is distinct from false then
    raise exception 'QS2 FAIL: tok_masa_activa_v1 ar trebui dezactivat după rotație';
  end if;

  -- Noul token trebuie să fie cel activ.
  select is_active into v_new_active
  from public.qr_tokens where token = 'tok_masa_activa_v2';
  if v_new_active is distinct from true then
    raise exception 'QS2 FAIL: tok_masa_activa_v2 ar trebui activ după rotație';
  end if;

  -- Exact un singur token activ pe masa activă.
  select count(*) into v_active_cnt
  from public.qr_tokens
  where table_id = '44444444-4444-4444-8444-444444444444'
    and is_active = true;
  if v_active_cnt <> 1 then
    raise exception 'QS2 FAIL: % token-uri active pe masă (așteptat 1)', v_active_cnt;
  end if;

  raise notice 'QS2 PASS: token nou activ dezactivează vechiul (1 token activ/masă)';
end$$;

select 'ALL PASS' as result;

rollback;
