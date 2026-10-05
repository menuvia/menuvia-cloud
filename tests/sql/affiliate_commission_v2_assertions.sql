-- tests/sql/affiliate_commission_v2_assertions.sql
-- =============================================================================
-- AF1–AF10 — clichetul PERMANENT al mig 293 (afiliere v2: comisionul).
-- Rulează DUPĂ migrații, ca postgres (logica RPC-urilor DEFINER); suprafața de
-- privilegii (AF10) se verifică pe catalog ȘI cu un apel REAL ca authenticated.
-- Self-contained, ROLLBACK la final.
--
--   AF1  starter / growth / pro produc comision (setup 30% + recurring 10%)
--   AF2  free / plan necunoscut / NULL / 0 lei → skip, nimic scris, nimic consemnat
--   AF3  setup-ul se scrie abia la a DOUA factură plătită (cu baza + factura PRIMEI,
--        hold 60 z); reluarea oricărei facturi (înainte/după) nu dublează nimic
--   AF4  instantaneul procentelor rezistă la schimbarea procentelor afiliatului
--        (+ control pozitiv: o atribuire NOUĂ ia procentele noi)
--   AF5  refund parțial + dispută ≤ comision (tier-1 ȘI cascadă), restul e plafonul
--   AF6  refund pe PRIMA factură înaintea setup-ului scade baza setup-ului, iar
--        reluarea lui după scrierea setup-ului NU mai stornează o dată
--   AF7  două facturi în aceeași period_month NU aruncă (skip period_already_credited)
--   AF8  al 13-lea recurring e respins (plafon 12 din instantaneu)
--   AF9  set_affiliate_attribution_status: tranziție + audit, idempotent, validări,
--        atribuirea terminală nu mai produce comision
--   AF10 suprafața: set_status / RPC-urile de comision doar service_role
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- Seed: părinte P (cascadă 200), copil C (sub-afiliat) — profiluri a293…
insert into auth.users (id, email) values
  ('a2930000-0000-4000-8000-000000000001','af1@aff293.test'),
  ('a2930000-0000-4000-8000-000000000002','af2@aff293.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email) values
  ('a2930000-0000-4000-8000-000000000001','af1@aff293.test'),
  ('a2930000-0000-4000-8000-000000000002','af2@aff293.test')
  on conflict (id) do nothing;
insert into public.affiliates (id, profile_id, referral_code) values
  ('a2931000-0000-4000-8000-000000000001','a2930000-0000-4000-8000-000000000001','af293parent');
insert into public.affiliates (id, profile_id, referral_code, parent_affiliate_id) values
  ('a2931000-0000-4000-8000-000000000002','a2930000-0000-4000-8000-000000000002','af293child',
   'a2931000-0000-4000-8000-000000000001');

-- Referiți r01..r20 (profil + atribuire pe copil, customer cus_293_NN).
do $$
declare i int; v_pid uuid; v_aid uuid;
begin
  for i in 1..20 loop
    v_pid := ('a2932000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid;
    v_aid := ('a2933000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid;
    insert into auth.users (id, email) values (v_pid, 'r' || i || '@aff293.test') on conflict (id) do nothing;
    insert into public.profiles (id, email) values (v_pid, 'r' || i || '@aff293.test') on conflict (id) do nothing;
    if i <= 18 then  -- 19/20 se creează în AF4, după schimbarea procentelor
      insert into public.affiliate_attributions (id, affiliate_id, referred_profile_id, stripe_customer_id, status)
      values (v_aid, 'a2931000-0000-4000-8000-000000000002', v_pid, 'cus_293_' || lpad(i::text, 2, '0'), 'pending');
    end if;
  end loop;
end $$;

-- Scurtătură: o factură plătită pe customer-ul NN.
create function pg_temp.inv(p_nn int, p_evt text, p_inv text, p_cents bigint, p_plan text,
                            p_month date default '2026-10-01')
returns jsonb language sql as $$
  select public.process_affiliate_invoice_paid(p_evt, 'cus_293_' || lpad(p_nn::text, 2, '0'),
           'sub_293_' || p_nn, p_inv, 'subscription_cycle', p_cents, 'RON', p_month, now(), p_plan)
$$;
create function pg_temp.attr(p_nn int) returns uuid language sql as $$
  select ('a2933000-0000-4000-8000-0000000000' || lpad(p_nn::text, 2, '0'))::uuid
$$;

-- ── AF1: starter / growth / pro produc comision ─────────────────────────────
do $$
declare v jsonb; i int; v_plan text; v_price bigint; v_setup bigint;
begin
  for i in 1..3 loop
    v_plan  := (array['starter','growth','pro'])[i];
    v_price := (array[9900, 24900, 49900])[i];
    v := pg_temp.inv(i, 'evt_af1_'||i||'a', 'in_af1_'||i||'a', v_price, v_plan, '2026-09-01');
    if v->>'deferred' is distinct from 'setup_awaits_second_invoice' then
      raise exception 'AF1 FAIL: % prima factură nu e consemnată (%)', v_plan, v; end if;
    v := pg_temp.inv(i, 'evt_af1_'||i||'b', 'in_af1_'||i||'b', v_price, v_plan, '2026-10-01');
    if v->>'leg' is distinct from 'recurring'
       or (v->>'commission_cents')::bigint is distinct from v_price * 1000 / 10000 then
      raise exception 'AF1 FAIL: % recurring greșit (%)', v_plan, v; end if;
    select amount_cents into v_setup from public.affiliate_ledger
     where attribution_id = pg_temp.attr(i) and leg = 'setup';
    if v_setup is distinct from v_price * 3000 / 10000 then
      raise exception 'AF1 FAIL: % setup % (așteptat %)', v_plan, v_setup, v_price * 3000 / 10000; end if;
    -- cascada părintelui: 2% din fiecare comision
    if (select count(*) from public.affiliate_ledger
         where attribution_id = pg_temp.attr(i) and leg = 'cascade'
           and affiliate_id = 'a2931000-0000-4000-8000-000000000001') <> 2 then
      raise exception 'AF1 FAIL: % fără cascadă pe setup+recurring', v_plan; end if;
  end loop;
  raise notice 'AF1 OK: starter/growth/pro → setup 30%% + recurring 10%% + cascadă';
end $$;

-- ── AF2: free / necunoscut / NULL / 0 lei → nimic ───────────────────────────
do $$
declare v jsonb; v_plan text;
begin
  foreach v_plan in array array['free','business','gold'] loop
    v := pg_temp.inv(4, 'evt_af2_'||v_plan, 'in_af2_'||v_plan, 9900, v_plan);
    if v->>'skipped' is distinct from 'not_paid_plan' then
      raise exception 'AF2 FAIL: plan % neskip-uit (%)', v_plan, v; end if;
  end loop;
  v := pg_temp.inv(4, 'evt_af2_null', 'in_af2_null', 9900, null);
  if v->>'skipped' is distinct from 'not_paid_plan' then raise exception 'AF2 FAIL: NULL (%)', v; end if;
  v := pg_temp.inv(4, 'evt_af2_zero', 'in_af2_zero', 0, 'pro');
  if v->>'skipped' is distinct from 'zero_amount' then raise exception 'AF2 FAIL: 0 lei (%)', v; end if;
  if exists (select 1 from public.affiliate_ledger where attribution_id = pg_temp.attr(4))
     or (select first_paid_invoice_id from public.affiliate_attributions where id = pg_temp.attr(4)) is not null then
    raise exception 'AF2 FAIL: o factură sărită a scris/consemnat ceva'; end if;
  -- control pozitiv: aceeași atribuire, factură pe plan plătit → consemnată
  v := pg_temp.inv(4, 'evt_af2_ok', 'in_af2_ok', 9900, 'starter');
  if (select first_paid_invoice_id from public.affiliate_attributions where id = pg_temp.attr(4))
       is distinct from 'in_af2_ok' then
    raise exception 'AF2 FAIL (control): factura starter nu a fost consemnată'; end if;
  raise notice 'AF2 OK: free/necunoscut/NULL/0 lei → skip, fără efect';
end $$;

-- ── AF3: setup la a DOUA factură + idempotență ──────────────────────────────
do $$
declare v jsonb; v_row public.affiliate_ledger%rowtype; v_n int;
begin
  v := pg_temp.inv(5, 'evt_af3_a', 'in_af3_a', 24900, 'growth', '2026-09-01');
  if exists (select 1 from public.affiliate_ledger where attribution_id = pg_temp.attr(5)) then
    raise exception 'AF3 FAIL: prima factură a scris în ledger (setup trebuie amânat)'; end if;
  if (select status from public.affiliate_attributions where id = pg_temp.attr(5)) is distinct from 'active' then
    raise exception 'AF3 FAIL: atribuirea nu a devenit active la prima factură'; end if;
  -- reluarea primei facturi înainte de a doua: tot nimic
  v := pg_temp.inv(5, 'evt_af3_a', 'in_af3_a', 24900, 'growth', '2026-09-01');
  if exists (select 1 from public.affiliate_ledger where attribution_id = pg_temp.attr(5)) then
    raise exception 'AF3 FAIL: reluarea primei facturi a scris în ledger'; end if;

  v := pg_temp.inv(5, 'evt_af3_b', 'in_af3_b', 24900, 'growth', '2026-10-01');
  select * into v_row from public.affiliate_ledger where attribution_id = pg_temp.attr(5) and leg = 'setup';
  if not found then raise exception 'AF3 FAIL: setup nescris la a doua factură'; end if;
  if v_row.amount_cents is distinct from 7470::bigint or v_row.base_cents is distinct from 24900::bigint
     or v_row.stripe_invoice_id is distinct from 'in_af3_a' or v_row.stripe_event_id is distinct from 'evt_af3_a'
     or v_row.hold_until < now() + interval '59 days' then
    raise exception 'AF3 FAIL: setup greșit (amount %, base %, inv %, evt %, hold %)',
      v_row.amount_cents, v_row.base_cents, v_row.stripe_invoice_id, v_row.stripe_event_id, v_row.hold_until; end if;
  if (v->>'setup_commission_cents')::bigint is distinct from 7470::bigint then
    raise exception 'AF3 FAIL: răspunsul nu raportează setup-ul (%)', v; end if;

  -- reluări DUPĂ setup: prima factură (event-ul setup-ului) și a doua → nimic nou
  select count(*) into v_n from public.affiliate_ledger where attribution_id = pg_temp.attr(5);
  v := pg_temp.inv(5, 'evt_af3_a', 'in_af3_a', 24900, 'growth', '2026-09-01');
  if (v->>'replay')::boolean is distinct from true then raise exception 'AF3 FAIL: reluare inv1 nu e replay (%)', v; end if;
  v := pg_temp.inv(5, 'evt_af3_b', 'in_af3_b', 24900, 'growth', '2026-10-01');
  v := pg_temp.inv(5, 'evt_af3_b2', 'in_af3_b', 24900, 'growth', '2026-10-01'); -- alt event, aceeași factură
  if (select count(*) from public.affiliate_ledger where attribution_id = pg_temp.attr(5)) <> v_n then
    raise exception 'AF3 FAIL: reluarea a dublat rânduri (% → %)', v_n,
      (select count(*) from public.affiliate_ledger where attribution_id = pg_temp.attr(5)); end if;
  raise notice 'AF3 OK: setup la a doua factură (bază+factura primei, hold 60z), reluări fără efect';
end $$;

-- ── AF4: instantaneul rezistă la schimbarea procentelor ─────────────────────
do $$
declare v jsonb; v_setup bigint;
begin
  if (select snap_setup_bps from public.affiliate_attributions where id = pg_temp.attr(6)) is distinct from 3000 then
    raise exception 'AF4 FAIL: instantaneul nu s-a pus la creare'; end if;
  -- Fondatorul schimbă procentele (echivalentul admin_set_affiliate_commission /
  -- admin_apply_defaults_to_all_affiliates din 188) DUPĂ ce clientul a fost adus.
  update public.affiliates set setup_bps = 5000, recurring_bps = 2500, recurring_cap_months = 1
   where id = 'a2931000-0000-4000-8000-000000000002';
  update public.affiliates set cascade_bps = 900 where id = 'a2931000-0000-4000-8000-000000000001';
  v := pg_temp.inv(6, 'evt_af4_a', 'in_af4_a', 10000, 'pro', '2026-09-01');
  v := pg_temp.inv(6, 'evt_af4_b', 'in_af4_b', 10000, 'pro', '2026-10-01');
  select amount_cents into v_setup from public.affiliate_ledger where attribution_id = pg_temp.attr(6) and leg = 'setup';
  if v_setup is distinct from 3000::bigint or (v->>'commission_cents')::bigint is distinct from 1000::bigint then
    raise exception 'AF4 FAIL: procentele noi s-au aplicat retroactiv (setup %, recurring %)', v_setup, v->>'commission_cents'; end if;
  if (select amount_cents from public.affiliate_ledger where stripe_event_id = 'evt_af4_b' and leg = 'cascade')
       is distinct from 20::bigint then
    raise exception 'AF4 FAIL: cascada nu folosește instantaneul (200 bps)'; end if;
  -- plafonul tot din instantaneu (12, nu 1): al doilea recurring trece
  v := pg_temp.inv(6, 'evt_af4_c', 'in_af4_c', 10000, 'pro', '2026-11-01');
  if v->>'leg' is distinct from 'recurring' then raise exception 'AF4 FAIL: plafonul nu vine din instantaneu (%)', v; end if;

  -- Control POZITIV: o atribuire NOUĂ ia procentele noi.
  insert into public.affiliate_attributions (id, affiliate_id, referred_profile_id, stripe_customer_id, status)
  values (pg_temp.attr(19), 'a2931000-0000-4000-8000-000000000002',
          'a2932000-0000-4000-8000-000000000019', 'cus_293_19', 'pending');
  v := pg_temp.inv(19, 'evt_af4_n1', 'in_af4_n1', 10000, 'pro', '2026-09-01');
  v := pg_temp.inv(19, 'evt_af4_n2', 'in_af4_n2', 10000, 'pro', '2026-10-01');
  if (select amount_cents from public.affiliate_ledger where attribution_id = pg_temp.attr(19) and leg = 'setup')
       is distinct from 5000::bigint or (v->>'commission_cents')::bigint is distinct from 2500::bigint then
    raise exception 'AF4 FAIL (control): atribuirea nouă nu are procentele noi (%)', v; end if;

  update public.affiliates set setup_bps = 3000, recurring_bps = 1000, recurring_cap_months = 12
   where id = 'a2931000-0000-4000-8000-000000000002';
  update public.affiliates set cascade_bps = 200 where id = 'a2931000-0000-4000-8000-000000000001';
  raise notice 'AF4 OK: instantaneul (setup/recurring/cascadă/plafon) rezistă; atribuirile noi iau procentele noi';
end $$;

-- ── AF5: refund parțial + dispută ≤ comision ────────────────────────────────
do $$
declare v jsonb; v_rec public.affiliate_ledger%rowtype; v_casc public.affiliate_ledger%rowtype;
        v_claw bigint; v_cclaw bigint;
begin
  v := pg_temp.inv(7, 'evt_af5_a', 'in_af5_a', 20000, 'pro', '2026-09-01');
  v := pg_temp.inv(7, 'evt_af5_b', 'in_af5_b', 20000, 'pro', '2026-10-01');
  select * into v_rec from public.affiliate_ledger where stripe_event_id = 'evt_af5_b' and leg = 'recurring';
  select * into v_casc from public.affiliate_ledger where stripe_event_id = 'evt_af5_b' and leg = 'cascade';
  -- refund 60% → storno 60%
  perform public.process_affiliate_refund('evt_af5_r1', 'in_af5_b', 20000, 're_af5_1', 12000, now());
  select coalesce(sum(amount_cents), 0) into v_claw from public.affiliate_ledger where reverses_ledger_id = v_rec.id;
  if v_claw is distinct from -1200::bigint then raise exception 'AF5 FAIL: refund 60%% → storno % (așteptat -1200)', v_claw; end if;
  -- dispută pe TOT charge-ul (100%) — fără plafon ar fi încă -2000
  perform public.process_affiliate_refund('evt_af5_d', 'in_af5_b', 20000, 'dispute_af5', 20000, now());
  select coalesce(sum(amount_cents), 0) into v_claw from public.affiliate_ledger where reverses_ledger_id = v_rec.id;
  select coalesce(sum(amount_cents), 0) into v_cclaw from public.affiliate_ledger where reverses_ledger_id = v_casc.id;
  if v_claw is distinct from -v_rec.amount_cents then
    raise exception 'AF5 FAIL: storno cumulat % ≠ -comision % (peste 100%%)', v_claw, v_rec.amount_cents; end if;
  if v_cclaw is distinct from -v_casc.amount_cents then
    raise exception 'AF5 FAIL: storno cascadă % ≠ -%', v_cclaw, v_casc.amount_cents; end if;
  -- încă un refund după 100%: nimic
  perform public.process_affiliate_refund('evt_af5_r3', 'in_af5_b', 20000, 're_af5_3', 5000, now());
  if (select sum(amount_cents) from public.affiliate_ledger where reverses_ledger_id = v_rec.id) is distinct from -v_rec.amount_cents then
    raise exception 'AF5 FAIL: storno peste 100%% după un refund suplimentar'; end if;
  raise notice 'AF5 OK: refund 60%% + dispută 100%% = exact comisionul (tier-1 și cascadă)';
end $$;

-- ── AF6: refund pe prima factură ÎNAINTEA setup-ului ────────────────────────
do $$
declare v jsonb; v_setup public.affiliate_ledger%rowtype; v_n int;
begin
  v := pg_temp.inv(8, 'evt_af6_a', 'in_af6_a', 10000, 'growth', '2026-09-01');
  perform public.process_affiliate_refund('evt_af6_r1', 'in_af6_a', 10000, 're_af6_1', 4000, now());
  perform public.process_affiliate_refund('evt_af6_r1b', 'in_af6_a', 10000, 're_af6_1', 4000, now()); -- reluare
  v := pg_temp.inv(8, 'evt_af6_b', 'in_af6_b', 10000, 'growth', '2026-10-01');
  select * into v_setup from public.affiliate_ledger where attribution_id = pg_temp.attr(8) and leg = 'setup';
  if v_setup.base_cents is distinct from 6000::bigint or v_setup.amount_cents is distinct from 1800::bigint then
    raise exception 'AF6 FAIL: baza setup % / comision % (așteptat 6000 / 1800)', v_setup.base_cents, v_setup.amount_cents; end if;
  -- refunds.list reia re_af6_1 la un refund nou: re_af6_1 nu se mai stornează
  perform public.process_affiliate_refund('evt_af6_r2', 'in_af6_a', 10000, 're_af6_1', 4000, now());
  select count(*) into v_n from public.affiliate_ledger where reverses_ledger_id = v_setup.id;
  if v_n <> 0 then raise exception 'AF6 FAIL: refund-ul deja scăzut din bază a fost stornat din nou'; end if;
  -- refund nou de 3000 din cei 6000 rămași → storno 900 (30%% din 3000)
  perform public.process_affiliate_refund('evt_af6_r2', 'in_af6_a', 10000, 're_af6_2', 3000, now());
  if (select sum(amount_cents) from public.affiliate_ledger where reverses_ledger_id = v_setup.id) is distinct from -900::bigint then
    raise exception 'AF6 FAIL: refund nou după setup → storno % (așteptat -900)',
      (select sum(amount_cents) from public.affiliate_ledger where reverses_ledger_id = v_setup.id); end if;
  raise notice 'AF6 OK: refund pre-setup scade baza; reluarea lui nu dublează stornarea';
end $$;

-- ── AF7: două facturi în aceeași period_month ───────────────────────────────
do $$
declare v jsonb;
begin
  v := pg_temp.inv(9, 'evt_af7_a', 'in_af7_a', 9900, 'starter', '2026-09-01');
  v := pg_temp.inv(9, 'evt_af7_b', 'in_af7_b', 9900, 'starter', '2026-10-01');
  -- upgrade cu prorata facturată imediat, ACEEAȘI lună
  v := pg_temp.inv(9, 'evt_af7_c', 'in_af7_c', 15000, 'growth', '2026-10-01');
  if v->>'skipped' is distinct from 'period_already_credited' then
    raise exception 'AF7 FAIL: a doua factură din lună (%)', v; end if;
  if (select count(*) from public.affiliate_ledger where attribution_id = pg_temp.attr(9) and leg = 'recurring') <> 1 then
    raise exception 'AF7 FAIL: două recurring pe aceeași lună'; end if;
  raise notice 'AF7 OK: a doua factură din aceeași lună → skip, fără excepție';
end $$;

-- ── AF8: al 13-lea recurring respins ────────────────────────────────────────
do $$
declare v jsonb; i int;
begin
  v := pg_temp.inv(10, 'evt_af8_0', 'in_af8_0', 9900, 'starter', '2026-01-01');
  for i in 1..12 loop
    v := pg_temp.inv(10, 'evt_af8_'||i, 'in_af8_'||i, 9900, 'starter',
                     (date '2026-01-01' + make_interval(months => i))::date);
    if v->>'leg' is distinct from 'recurring' then raise exception 'AF8 FAIL: recurring % respins (%)', i, v; end if;
  end loop;
  v := pg_temp.inv(10, 'evt_af8_13', 'in_af8_13', 9900, 'starter', '2027-02-01');
  if v->>'skipped' is distinct from 'recurring_cap_reached' then
    raise exception 'AF8 FAIL: al 13-lea recurring acceptat (%)', v; end if;
  if (select count(*) from public.affiliate_ledger where attribution_id = pg_temp.attr(10) and leg = 'recurring') <> 12 then
    raise exception 'AF8 FAIL: număr recurring ≠ 12'; end if;
  raise notice 'AF8 OK: 12 recurring, al 13-lea respins';
end $$;

-- ── AF9: set_affiliate_attribution_status ───────────────────────────────────
do $$
declare v jsonb; v_audit public.audit_log%rowtype; v_raised boolean;
begin
  v := pg_temp.inv(11, 'evt_af9_a', 'in_af9_a', 9900, 'starter', '2026-09-01');  -- devine active
  v := public.set_affiliate_attribution_status('a2932000-0000-4000-8000-000000000011', 'refunded', 'refund total in_af9_a');
  if v->>'to' is distinct from 'refunded' or v->>'from' is distinct from 'active' then
    raise exception 'AF9 FAIL: tranziție (%)', v; end if;
  select * into v_audit from public.audit_log
   where table_name = 'affiliate_attributions' and row_id = pg_temp.attr(11)::text
   order by id desc limit 1;
  if not found or v_audit.new_data->>'status_reason' is distinct from 'refund total in_af9_a'
     or v_audit.old_data->>'status' is distinct from 'active' or v_audit.new_data->>'status' is distinct from 'refunded' then
    raise exception 'AF9 FAIL: audit lipsă/greșit'; end if;
  -- idempotent: terminal rămâne terminal, fără audit nou
  v := public.set_affiliate_attribution_status('a2932000-0000-4000-8000-000000000011', 'expired', 'x');
  if v->>'skipped' is distinct from 'already_terminal'
     or (select status from public.affiliate_attributions where id = pg_temp.attr(11)) is distinct from 'refunded' then
    raise exception 'AF9 FAIL: terminal suprascris (%)', v; end if;
  if (select count(*) from public.audit_log where table_name = 'affiliate_attributions'
        and row_id = pg_temp.attr(11)::text) <> 1 then raise exception 'AF9 FAIL: audit la no-op'; end if;
  -- atribuirea terminală nu mai produce comision (nici setup-ul amânat)
  v := pg_temp.inv(11, 'evt_af9_b', 'in_af9_b', 9900, 'starter', '2026-10-01');
  if v->>'skipped' is distinct from 'no_attribution'
     or exists (select 1 from public.affiliate_ledger where attribution_id = pg_temp.attr(11)) then
    raise exception 'AF9 FAIL: comision pe atribuire terminală (%)', v; end if;
  -- validări
  v_raised := false;
  begin perform public.set_affiliate_attribution_status('a2932000-0000-4000-8000-000000000012', 'active', 'x');
  exception when sqlstate '22023' then v_raised := true; end;
  if not v_raised then raise exception 'AF9 FAIL: status nepermis acceptat'; end if;
  v_raised := false;
  begin perform public.set_affiliate_attribution_status('a2932000-0000-4000-8000-000000000012', 'canceled', '  ');
  exception when sqlstate '22023' then v_raised := true; end;
  if not v_raised then raise exception 'AF9 FAIL: motiv gol acceptat'; end if;
  if (select status from public.affiliate_attributions where id = pg_temp.attr(12)) is distinct from 'pending' then
    raise exception 'AF9 FAIL: o validare respinsă a schimbat statusul'; end if;
  v := public.set_affiliate_attribution_status('a2932000-0000-4000-8000-0000000000ff', 'canceled', 'x');
  if v->>'skipped' is distinct from 'no_attribution' then raise exception 'AF9 FAIL: profil fără atribuire (%)', v; end if;
  raise notice 'AF9 OK: tranziție + audit, idempotent, validări, terminal = fără comision';
end $$;

-- ── AF10: suprafața ─────────────────────────────────────────────────────────
do $$
declare v_fn text; v_role text; v_raised boolean := false;
begin
  foreach v_fn in array array[
    'public.set_affiliate_attribution_status(uuid, text, text)',
    'public.process_affiliate_invoice_paid(text, text, text, text, text, bigint, text, date, timestamptz, text)',
    'public.process_affiliate_refund(text, text, bigint, text, bigint, timestamptz)'] loop
    foreach v_role in array array['anon','authenticated'] loop
      if has_function_privilege(v_role, v_fn, 'execute') then
        raise exception 'AF10 FAIL: % are EXECUTE pe %', v_role, v_fn; end if;
    end loop;
    if not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'AF10 FAIL: service_role fără EXECUTE pe %', v_fn; end if;
  end loop;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'a2932000-0000-4000-8000-000000000013', true);
  begin
    perform public.set_affiliate_attribution_status('a2932000-0000-4000-8000-000000000013', 'canceled', 'atac');
  exception when insufficient_privilege then
    v_raised := sqlerrm like '%function%';
  end;
  perform set_config('role', 'none', true);
  if not v_raised then raise exception 'AF10 FAIL: authenticated a putut schimba statusul atribuirii'; end if;
  if (select status from public.affiliate_attributions where id = pg_temp.attr(13)) is distinct from 'pending' then
    raise exception 'AF10 FAIL: statusul s-a schimbat sub authenticated'; end if;
  raise notice 'AF10 OK: RPC-urile de comision/status doar service_role';
end $$;

do $$ begin raise notice '════ affiliate commission v2 assertions (mig 293): ALL PASS ════'; end $$;

rollback;
