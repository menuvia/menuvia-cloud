-- tests/sql/security_hardening_258_assertions.sql
-- =============================================================================
-- Aserții pentru mig 258 (întărire securitate + bani din auditul de platformă).
-- Self-contained, ROLLBACK la final.
--
--   SH1  add_partial_payment: supra-încasarea e RESPINSĂ (hint 'overpayment'),
--        comanda rămâne 'served', order_payments neschimbat (control negativ).
--   SH2  add_partial_payment: plata EXACTĂ la total trece → 'paid' (control +).
--   SH3  INVARIANTUL #1 din audit: un 'authenticated' NU poate ridica
--        profiles.is_platform_admin (UPDATE respins cu SQLSTATE 42501); flag-ul
--        rămâne false. Îngheață gaura contra unei re-lărgiri de grant.
--   SH4  security_ownership_remediations: RLS activ → un 'authenticated' vede
--        0 rânduri (deny-all), chiar dacă tabela are date.
--   SH5  get_loyalty_state: peste plafonul de 40/5min per token → rate_limited,
--        fără a distinge înrolat de neînrolat (anti-enumerare).
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('58000000-0000-4000-8000-000000000001','sh-owner-pro@sh.test'),
  ('58000000-0000-4000-8000-000000000002','sh-attacker@sh.test'),
  ('58000000-0000-4000-8000-000000000003','sh-owner-growth@sh.test');

update public.profiles set plan='pro'    where id='58000000-0000-4000-8000-000000000001';
update public.profiles set plan='growth' where id='58000000-0000-4000-8000-000000000003';

insert into public.restaurants (id, owner_id, name, slug, city, is_active) values
  ('58b00000-0000-4000-8000-000000000001','58000000-0000-4000-8000-000000000001','SH Pro','sh-pro','Cluj',true),
  ('58b00000-0000-4000-8000-000000000003','58000000-0000-4000-8000-000000000003','SH Growth','sh-growth','Cluj',true);

-- Comenzi 'served' pe restaurantul pro (total 100).
insert into public.orders (id, restaurant_id, source, status, total) values
  ('58f00000-0000-4000-8000-000000000001','58b00000-0000-4000-8000-000000000001','qr','served',100),
  ('58f00000-0000-4000-8000-000000000002','58b00000-0000-4000-8000-000000000001','qr','served',100);

-- Un rând în tabela de remedieri (ca SH4 să dovedească deny-all pe date reale,
-- nu pe o tabelă goală). id/applied_at/db_session_user au default-uri;
-- observed_owner_members (NOT NULL, array) trebuie furnizat explicit.
insert into public.security_ownership_remediations
  (restaurant_id, observed_owner_id, observed_owner_members, final_owner_id, ticket_reference, notes)
values
  ('58b00000-0000-4000-8000-000000000001','58000000-0000-4000-8000-000000000001',
   array['58000000-0000-4000-8000-000000000001']::uuid[],
   '58000000-0000-4000-8000-000000000001','SH-TEST','seed test SH4');

-- Loyalty pe restaurantul growth (pentru SH5).
insert into public.restaurant_modules (restaurant_id, module_key, enabled) values
  ('58b00000-0000-4000-8000-000000000003','loyalty',true);
insert into public.loyalty_programs (restaurant_id, points_per_leu, reward_threshold, reward_description) values
  ('58b00000-0000-4000-8000-000000000003', 1, 30, 'Un desert');
insert into public.tables (id, restaurant_id, name, slug, is_active) values
  ('58c00000-0000-4000-8000-000000000003','58b00000-0000-4000-8000-000000000003','Masa SH','masa-sh',true);
insert into public.qr_tokens (id, restaurant_id, table_id, token, is_active) values
  ('58d00000-0000-4000-8000-000000000003','58b00000-0000-4000-8000-000000000003',
   '58c00000-0000-4000-8000-000000000003','tok_sh_growth',true);

-- ── SH1: supra-încasare respinsă ─────────────────────────────────────────────
do $$
declare v_blocked boolean := false;
begin
  perform set_config('request.jwt.claim.sub','58000000-0000-4000-8000-000000000001', true);
  begin
    -- 100 e OK; 120 pe un total de 100 depășește → trebuie respins.
    perform public.add_partial_payment('58f00000-0000-4000-8000-000000000001', 120, 'cash');
  exception when others then
    if sqlerrm ilike '%depășește%' or sqlerrm ilike '%total%' then v_blocked := true;
    else raise exception 'SH1: eroare neașteptată: %', sqlerrm; end if;
  end;
  if not v_blocked then raise exception 'SH1 FAIL: supra-încasarea (120/100) a fost acceptată'; end if;
  if (select status from public.orders where id='58f00000-0000-4000-8000-000000000001') <> 'served' then
    raise exception 'SH1 FAIL: comanda a ieșit din served după supra-încasare respinsă'; end if;
  if (select count(*) from public.order_payments
       where order_id='58f00000-0000-4000-8000-000000000001') <> 0 then
    raise exception 'SH1 FAIL: order_payments are rânduri după supra-încasare respinsă'; end if;
  raise notice 'SH1 OK: supra-încasarea respinsă (hint overpayment), fără efecte';
end $$;

-- ── SH1b: supra-încasare INCREMENTALĂ (60 + 60 pe total 100) → a doua respinsă ─
do $$
declare v jsonb; v_blocked boolean := false;
begin
  perform set_config('request.jwt.claim.sub','58000000-0000-4000-8000-000000000001', true);
  v := public.add_partial_payment('58f00000-0000-4000-8000-000000000001', 60, 'cash');  -- OK (60 ≤ 100)
  if (v->>'fully_paid')::boolean is not false then
    raise exception 'SH1b FAIL: 60/100 nu ar trebui să fie fully_paid'; end if;
  begin
    perform public.add_partial_payment('58f00000-0000-4000-8000-000000000001', 60, 'cash');  -- 120 > 100
  exception when others then
    if sqlerrm ilike '%depășește%' then v_blocked := true; else raise; end if;
  end;
  if not v_blocked then raise exception 'SH1b FAIL: a doua plată (60+60>100) acceptată'; end if;
  if (select coalesce(sum(amount),0) from public.order_payments
       where order_id='58f00000-0000-4000-8000-000000000001') <> 60 then
    raise exception 'SH1b FAIL: suma încasată nu e 60 după respingerea celei de-a doua'; end if;
  raise notice 'SH1b OK: a doua plată care ar depăși totalul e respinsă, prima rămâne';
end $$;

-- ── SH2: plata EXACTĂ la total trece (control pozitiv) ───────────────────────
do $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub','58000000-0000-4000-8000-000000000001', true);
  v := public.add_partial_payment('58f00000-0000-4000-8000-000000000002', 100, 'cash');
  if (v->>'fully_paid')::boolean is not true then
    raise exception 'SH2 FAIL: plata exactă 100/100 nu e fully_paid (%)', v; end if;
  if (select status from public.orders where id='58f00000-0000-4000-8000-000000000002') <> 'paid' then
    raise exception 'SH2 FAIL: comanda plătită integral nu e paid'; end if;
  raise notice 'SH2 OK: plata exactă la total trece (control pozitiv)';
end $$;

-- ── SH3: escaladarea is_platform_admin e imposibilă pentru authenticated ─────
set local role authenticated;
set local request.jwt.claim.sub = '58000000-0000-4000-8000-000000000002';
do $$
declare v_blocked boolean := false;
begin
  begin
    update public.profiles set is_platform_admin = true
     where id = '58000000-0000-4000-8000-000000000002';
  exception when insufficient_privilege then
    v_blocked := true;   -- SQLSTATE 42501, exact ce am observat empiric
  when others then
    raise exception 'SH3: eroare neașteptată (%): %', sqlstate, sqlerrm;
  end;
  if not v_blocked then
    raise exception 'SH3 FAIL: authenticated a putut UPDATA is_platform_admin (escaladare!)'; end if;
end $$;
reset role;
-- Confirmă că flag-ul chiar a rămas false (indiferent de RLS/coloană).
do $$
begin
  if (select is_platform_admin from public.profiles
       where id='58000000-0000-4000-8000-000000000002') is distinct from false then
    raise exception 'SH3 FAIL: is_platform_admin nu mai e false'; end if;
  raise notice 'SH3 OK: escaladarea is_platform_admin respinsă (42501), flag rămâne false';
end $$;

-- ── SH4: security_ownership_remediations inaccesibil pentru authenticated ────
-- Dublu blindaj: revoke de SELECT (mig 096a) + RLS deny-all (mig 258). Oricare
-- dintre ele face datele inaccesibile — acceptăm AMBELE forme (permission denied
-- SAU 0 rânduri), respingem doar scurgerea reală de rânduri.
set local role authenticated;
set local request.jwt.claim.sub = '58000000-0000-4000-8000-000000000001';  -- chiar owner-ul
do $$
declare n int;
begin
  begin
    select count(*) into n from public.security_ownership_remediations;
  exception when insufficient_privilege then
    raise notice 'SH4 OK: acces refuzat prin revoke de privilegii (+ RLS deny-all în spate)';
    return;
  end;
  if n <> 0 then
    raise exception 'SH4 FAIL: authenticated vede % rânduri în security_ownership_remediations', n; end if;
  raise notice 'SH4 OK: security_ownership_remediations = 0 rânduri pentru authenticated (RLS deny-all)';
end $$;
reset role;

-- ── SH5: rate-limit anti-enumerare pe get_loyalty_state ──────────────────────
-- now() e fix în tranzacție → toate apelurile cad în ACELAȘI bucket de 5 min,
-- deci plafonul de 40 e determinist: apelurile 1-40 trec, 41+ sunt rate_limited.
do $$
declare v jsonb; v_first jsonb; v_over jsonb; i int;
begin
  -- Primul apel: răspuns normal, fără rate_limited.
  v_first := public.get_loyalty_state('58d00000-0000-4000-8000-000000000003', 'anon_sh_1');
  if (v_first->>'enabled')::boolean is not true then
    raise exception 'SH5 FAIL: loyalty ar trebui enabled pe growth (%)', v_first; end if;
  if v_first ? 'rate_limited' then
    raise exception 'SH5 FAIL: primul apel nu ar trebui rate_limited'; end if;

  -- Epuizează restul plafonului (încă 39 apeluri OK → total 40).
  for i in 2..40 loop
    perform public.get_loyalty_state('58d00000-0000-4000-8000-000000000003', 'anon_sh_'||i);
  end loop;

  -- Al 41-lea depășește pragul → rate_limited, fără să dezvăluie starea de înrolare.
  v_over := public.get_loyalty_state('58d00000-0000-4000-8000-000000000003', 'anon_sh_41');
  if (v_over->>'rate_limited')::boolean is not true then
    raise exception 'SH5 FAIL: apelul 41 nu e rate_limited (%)', v_over; end if;
  if v_over ? 'short_code' or v_over ? 'points' then
    raise exception 'SH5 FAIL: răspunsul rate_limited scurge date de wallet (%)', v_over; end if;
  raise notice 'SH5 OK: get_loyalty_state rate-limited după 40/5min per token';
end $$;

select 'SECURITY HARDENING 258 ASSERTIONS: SH1–SH5 PASS' as result;

rollback;
