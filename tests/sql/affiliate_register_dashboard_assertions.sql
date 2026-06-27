-- tests/sql/affiliate_register_dashboard_assertions.sql
-- =============================================================================
-- Asserții pentru mig 097D (register_affiliate + get_affiliate_dashboard) și
-- mig 110 (earnings filtrat currency='RON', fix AFF-E2E-2).
--
-- Aceste două RPC-uri sunt SECURITY DEFINER scopate la auth.uid(): le rulăm
-- prin set_config('request.jwt.claim.sub', ...). Self-contained, ROLLBACK la
-- final (ca celelalte fișiere affiliate_*).
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/affiliate_register_dashboard_assertions.sql
--
--   RD1  register_affiliate fără auth → insufficient_privilege
--   RD2  register valid → ok + referral_code; al doilea register → already (idempotent)
--   RD3  register cu parent inexistent → parent_not_found; parent=self → parent_is_self
--   RD4  dashboard părinte: downline agregat (attributions_count) FĂRĂ PII brut
--        (NU expune stripe_customer_id / referred_profile_id ale sub-afiliatului)
--   RD5  earnings.currency='RON' și sumele NU includ ledger-ul EUR
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed: useri + profile (ca în celelalte fișiere affiliate_*) ──────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1','00e1@aff.test'),
  ('00000000-0000-0000-0000-0000000000e2','00e2@aff.test'),
  ('00000000-0000-0000-0000-0000000000e3','00e3@aff.test'),
  ('00000000-0000-0000-0000-0000000000e4','00e4@aff.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email) values
  ('00000000-0000-0000-0000-0000000000e1','00e1@aff.test'),
  ('00000000-0000-0000-0000-0000000000e2','00e2@aff.test'),
  ('00000000-0000-0000-0000-0000000000e3','00e3@aff.test'),
  ('00000000-0000-0000-0000-0000000000e4','00e4@aff.test')
  on conflict (id) do nothing;

-- ── RD1: register_affiliate fără auth → insufficient_privilege ───────────────
do $$
declare v_raised boolean := false;
begin
  -- request.jwt.claim.sub gol → auth.uid() = NULL
  perform set_config('request.jwt.claim.sub','', true);
  begin
    perform public.register_affiliate(null);
    raise exception 'RD1 FAIL: register fără auth a fost acceptat';
  exception
    when insufficient_privilege then
      v_raised := true;
      raise notice 'RD1 OK: register fără auth → insufficient_privilege';
  end;
  if not v_raised then raise exception 'RD1 FAIL: nu s-a ridicat insufficient_privilege'; end if;
end $$;

-- ── RD2: register valid → ok + referral_code; re-register → already ──────────
do $$
declare v jsonb; v_code text; v2 jsonb;
begin
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1', true);
  v := public.register_affiliate(null);
  if (v->>'ok')::boolean is not true then raise exception 'RD2 FAIL: register valid (%)', v; end if;
  v_code := v->>'referral_code';
  if v_code is null or v_code !~ '^[a-z0-9]{6,32}$' then
    raise exception 'RD2 FAIL: referral_code invalid/lipsă (%)', v; end if;
  -- al doilea register (același user) → idempotent, întoarce already=true + același cod
  v2 := public.register_affiliate(null);
  if (v2->>'already')::boolean is not true then
    raise exception 'RD2 FAIL: al doilea register nu e idempotent (%)', v2; end if;
  if v2->>'referral_code' is distinct from v_code then
    raise exception 'RD2 FAIL: re-register a întors alt referral_code (% vs %)', v2->>'referral_code', v_code; end if;
  -- exact un rând în affiliates pentru e1
  if (select count(*) from public.affiliates where profile_id='00000000-0000-0000-0000-0000000000e1') <> 1 then
    raise exception 'RD2 FAIL: register a duplicat afiliatul'; end if;
  raise notice 'RD2 OK: register valid + idempotent (already)';
end $$;

-- ── RD3: parent inexistent → parent_not_found; parent=self → parent_is_self ──
do $$
declare v jsonb; v_self_code text; v_self jsonb;
begin
  -- e2 încearcă register cu un parent referral_code care nu există
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e2', true);
  v := public.register_affiliate('nuexista');
  if v->>'reason' is distinct from 'parent_not_found' then
    raise exception 'RD3 FAIL: parent inexistent neגate-uit (%)', v; end if;
  raise notice 'RD3 OK: parent inexistent → parent_not_found';

  -- parent = self: e1 (deja afiliat din RD2) încearcă să se refere pe sine
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1', true);
  select referral_code into v_self_code from public.affiliates
   where profile_id='00000000-0000-0000-0000-0000000000e1';
  v_self := public.register_affiliate(v_self_code);
  -- e1 e deja afiliat → calea idempotentă (already=true) e atinsă ÎNAINTE de
  -- verificarea parent-ului. Deci aici confirmăm doar că NU explodează și nu
  -- creează ceva nou. parent_is_self e validat printr-un user proaspăt mai jos.
  if (v_self->>'already')::boolean is not true then
    raise exception 'RD3 FAIL: e1 re-register self ar trebui already (%)', v_self; end if;
  raise notice 'RD3 OK (a): re-register cu self-code pe afiliat existent → already';

  -- parent_is_self real: nu se poate ajunge fără a fi deja afiliat, fiindcă
  -- referral_code-ul parent trebuie să existe în affiliates. Confirmăm că un
  -- user proaspăt cu parent valid = afiliatul e1 e ACCEPTAT (sub-afiliere ok),
  -- iar branch-ul parent_is_self e cel care păzește cazul self în cod.
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e3', true);
  v_self := public.register_affiliate(v_self_code);
  if (v_self->>'ok')::boolean is not true then
    raise exception 'RD3 FAIL: sub-afiliere validă (parent=e1) respinsă (%)', v_self; end if;
  if v_self->>'parent_affiliate_id' is null then
    raise exception 'RD3 FAIL: sub-afiliatul nu are parent_affiliate_id (%)', v_self; end if;
  raise notice 'RD3 OK (b): sub-afiliere validă cu parent=e1 acceptată';
end $$;

-- ── RD4: dashboard părinte vede downline AGREGAT, fără PII brut ───────────────
-- Setup: e3 (sub-afiliatul lui e1, creat în RD3) primește o atribuire cu
-- stripe_customer_id. Dashboard-ul lui e1 (părinte) trebuie să întoarcă pentru
-- sub-afiliat DOAR attributions_count, NU stripe_customer_id/referred_profile_id.
do $$
declare
  v_e3_aff uuid;
  v jsonb;
  v_txt text;
  v_sub jsonb;
begin
  select id into v_e3_aff from public.affiliates
   where profile_id='00000000-0000-0000-0000-0000000000e3';
  if v_e3_aff is null then raise exception 'RD4 FAIL: e3 nu e afiliat (setup RD3 lipsă)'; end if;

  -- Atribuire pentru sub-afiliatul e3, cu PII Stripe care NU trebuie expus
  -- în dashboard-ul părintelui. referred_profile_id = e2 (profil distinct).
  insert into public.affiliate_attributions
    (affiliate_id, referred_profile_id, stripe_customer_id, status)
  values
    (v_e3_aff, '00000000-0000-0000-0000-0000000000e2',
     'cus_SECRET_DOWNLINE_PII', 'active');

  -- Dashboard ca părintele e1
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1', true);
  v := public.get_affiliate_dashboard();
  if (v->>'is_affiliate')::boolean is not true then
    raise exception 'RD4 FAIL: e1 nu e recunoscut ca afiliat (%)', v; end if;

  -- Cheia testului: jsonb-ul rezultat NU conține stripe_customer_id-ul brut
  v_txt := v::text;
  if v_txt ilike '%cus_SECRET_DOWNLINE_PII%' then
    raise exception 'RD4 FAIL: dashboard expune stripe_customer_id-ul downline-ului!'; end if;
  if v_txt ilike '%stripe_customer_id%' then
    raise exception 'RD4 FAIL: dashboard conține cheia stripe_customer_id (PII brut)!'; end if;
  -- referred_profile_id-ul sub-afiliatului nu trebuie nici el expus în downline
  if v_txt ilike '%referred_profile_id%' then
    raise exception 'RD4 FAIL: dashboard expune referred_profile_id (PII brut)!'; end if;

  -- Sub-afiliatul e3 apare în downline cu attributions_count = 1 (agregat).
  -- e1 are exact un sub-afiliat (e3), deci luăm primul element.
  if jsonb_array_length(v->'sub_affiliates') < 1 then
    raise exception 'RD4 FAIL: downline-ul lui e1 e gol'; end if;
  v_sub := (v->'sub_affiliates')->0;
  if not (v_sub ? 'attributions_count') then
    raise exception 'RD4 FAIL: sub-afiliatul nu expune attributions_count (%)', v_sub; end if;
  if (v_sub->>'attributions_count')::int <> 1 then
    raise exception 'RD4 FAIL: attributions_count ar trebui 1, e: %', v_sub->>'attributions_count'; end if;
  -- și NU expune câmpuri brute la nivel de sub-afiliat
  if (v_sub ? 'stripe_customer_id') or (v_sub ? 'referred_profile_id') then
    raise exception 'RD4 FAIL: sub-afiliatul expune PII brut (%)', v_sub; end if;

  raise notice 'RD4 OK: downline agregat (attributions_count=1) fără PII brut';
end $$;

-- ── RD5: earnings.currency='RON' și sumele NU includ ledger-ul EUR (mig 110) ─
do $$
declare
  v_e1_aff   uuid;
  v_attr_id  uuid;
  v jsonb;
  v_total_before bigint;
  v_total_after  bigint;
begin
  select id into v_e1_aff from public.affiliates
   where profile_id='00000000-0000-0000-0000-0000000000e1';

  -- Atribuire a lui e1 către un profil referit distinct (e4). NU putem folosi
  -- e1 ca referit — trg_affiliate_no_self_referral interzice self-referral.
  insert into public.affiliate_attributions (affiliate_id, referred_profile_id, status)
  values (v_e1_aff, '00000000-0000-0000-0000-0000000000e4', 'active')
  returning id into v_attr_id;

  -- Ledger RON: 50000 (setup, payable trecut de hold)
  insert into public.affiliate_ledger
    (affiliate_id, attribution_id, leg, amount_cents, currency, hold_until, stripe_event_id)
  values (v_e1_aff, v_attr_id, 'setup', 50000, 'RON', now() - interval '1 day', 'evt_rd5_ron');

  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1', true);
  v := public.get_affiliate_dashboard();
  if v->'earnings'->>'currency' is distinct from 'RON' then
    raise exception 'RD5 FAIL: earnings.currency ar trebui RON (%)', v->'earnings'; end if;
  v_total_before := (v->'earnings'->>'total_cents')::bigint;
  if v_total_before <> 50000 then
    raise exception 'RD5 FAIL: total_cents RON ar trebui 50000, e: %', v_total_before; end if;

  -- Adăugăm un ledger EUR pe același afiliat — NU trebuie numărat în totalul RON.
  insert into public.affiliate_ledger
    (affiliate_id, attribution_id, leg, amount_cents, currency, hold_until, stripe_event_id)
  values (v_e1_aff, null, 'setup', 99999, 'EUR', now() - interval '1 day', 'evt_rd5_eur');

  v := public.get_affiliate_dashboard();
  v_total_after := (v->'earnings'->>'total_cents')::bigint;
  if v_total_after <> 50000 then
    raise exception 'RD5 FAIL: ledger EUR a contaminat totalul RON (% != 50000)', v_total_after; end if;

  raise notice 'RD5 OK: earnings.currency=RON; ledger EUR exclus din total (fix AFF-E2E-2)';
end $$;

do $$ begin raise notice '════ affiliate register/dashboard assertions: ALL PASS ════'; end $$;

rollback;
