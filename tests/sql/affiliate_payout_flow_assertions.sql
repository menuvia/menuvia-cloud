-- tests/sql/affiliate_payout_flow_assertions.sql
-- =============================================================================
-- PF1–PF12 — fluxul de payout CAP-COADĂ (mig 294).
--
-- Suitele vechi (affiliate_payout_assertions PO1–PO10, _profile PP1–PP7) rulează
-- ca `postgres` și scriu DIRECT în `affiliate_payouts` — testează trigger-ul,
-- nu calea pe care o folosește fondatorul. Aici fiecare tranziție trece prin
-- RPC-ul ei, SUB rolul REAL `authenticated` (ca TP24/PM8): ca postgres, ACL-ul
-- de EXECUTE și RLS-ul sunt ocolite, deci „non-fondatorul e respins" ar fi
-- vacuu. Verificările de stare se fac ÎNAPOI ca postgres (role none).
--
--   PF1  catalog: 9 RPC-uri DEFINER + pg_temp, EXECUTE doar authenticated,
--        o singură semnătură pentru admin_mark_payout_paid, helper-ul IBAN și
--        batch-ul inaccesibile clienților; apel REAL ca anon → permission denied
--   PF2  non-fondator (cont simplu ȘI afiliatul însuși) → 42501 pe FIECARE RPC,
--        rândul neatins (control pozitiv: PF3 face aceleași apeluri ca fondator)
--   PF3  parcurs complet pe VIRAMENT BANCAR, fără Wise: batch manual → draft →
--        awaiting_invoice → invoice_matched → processing → paid; debit în
--        ledger = -gross; wise_transfer_id NULL; audit pentru fiecare pas
--   PF4  tranziții ILEGALE respinse de RPC (cod stabil, rând neatins) și de
--        trigger (revenire pre-transfer după referință; referință imuabilă)
--   PF5  validarea intrărilor: metodă, referință, wise numeric → bigint,
--        referință dublă, profil lipsă, motiv/factură obligatorii
--   PF6  mark_paid: confirmarea referinței (mismatch) + invariantul 106
--        (clawback după draft) întors ca cod, nu ca excepție
--   PF7  profilul de plată (IBAN/CUI/beneficiar) vizibil DOAR fondatorului
--   PF8  IBAN validat real (mod-97, lungime RO, normalizare, IBAN străin)
--   PF9  IBAN înghețat cât un payout e deschis (inclusiv on_hold), liber pe
--        failed/paid; auditul nu conține IBAN-ul complet
--   PF10 idempotența batch-ului (aceeași perioadă / perioadă nouă / failed CU
--        referință bancară rămâne angajat / canceled eliberează)
--   PF11 perioada batch-ului manual (prima zi, nu în viitor) + lacătul
--        single-flight prezent în corp (concurența reală: verificată manual
--        cu două sesiuni, vezi raportul — re-entrant pe aceeași sesiune)
--   PF12 batch-ul rămâne în denylist-ul pg_cron (mutarea a fost refuzată)
--
-- Self-contained, ROLLBACK la final.
-- =============================================================================
\set ON_ERROR_STOP on

begin;

-- ── Fixtură ──────────────────────────────────────────────────────────────────
-- F = fondator, N = cont simplu, A1..A4 = afiliați, R = profilul referit.
insert into auth.users (id, email) values
  ('9f000000-0000-4000-8000-0000000000f1', 'pf-founder@pf.test'),
  ('9f000000-0000-4000-8000-0000000000e1', 'pf-nobody@pf.test'),
  ('9f000000-0000-4000-8000-0000000000a1', 'pf-a1@pf.test'),
  ('9f000000-0000-4000-8000-0000000000a2', 'pf-a2@pf.test'),
  ('9f000000-0000-4000-8000-0000000000a3', 'pf-a3@pf.test'),
  ('9f000000-0000-4000-8000-0000000000a4', 'pf-a4@pf.test'),
  ('9f000000-0000-4000-8000-0000000000b1', 'pf-ref1@pf.test'),
  ('9f000000-0000-4000-8000-0000000000b2', 'pf-ref2@pf.test'),
  ('9f000000-0000-4000-8000-0000000000b3', 'pf-ref3@pf.test'),
  ('9f000000-0000-4000-8000-0000000000b4', 'pf-ref4@pf.test')
  on conflict (id) do nothing;
insert into public.profiles (id, email)
  select id, email from auth.users where email like 'pf-%@pf.test'
  on conflict (id) do nothing;
update public.profiles set is_platform_admin = true
 where id = '9f000000-0000-4000-8000-0000000000f1';

insert into public.affiliates (id, profile_id, referral_code) values
  ('9fa00000-0000-4000-8000-000000000001', '9f000000-0000-4000-8000-0000000000a1', 'pfaff1'),
  ('9fa00000-0000-4000-8000-000000000002', '9f000000-0000-4000-8000-0000000000a2', 'pfaff2'),
  ('9fa00000-0000-4000-8000-000000000003', '9f000000-0000-4000-8000-0000000000a3', 'pfaff3'),
  ('9fa00000-0000-4000-8000-000000000004', '9f000000-0000-4000-8000-0000000000a4', 'pfaff4');
insert into public.affiliate_attributions (id, affiliate_id, referred_profile_id, status) values
  ('9fb00000-0000-4000-8000-000000000001', '9fa00000-0000-4000-8000-000000000001', '9f000000-0000-4000-8000-0000000000b1', 'active'),
  ('9fb00000-0000-4000-8000-000000000002', '9fa00000-0000-4000-8000-000000000002', '9f000000-0000-4000-8000-0000000000b2', 'active'),
  ('9fb00000-0000-4000-8000-000000000003', '9fa00000-0000-4000-8000-000000000003', '9f000000-0000-4000-8000-0000000000b3', 'active'),
  ('9fb00000-0000-4000-8000-000000000004', '9fa00000-0000-4000-8000-000000000004', '9f000000-0000-4000-8000-0000000000b4', 'active');
insert into public.affiliate_ledger
  (id, affiliate_id, attribution_id, leg, amount_cents, hold_until, stripe_invoice_id, stripe_event_id) values
  ('9fc00000-0000-4000-8000-000000000001', '9fa00000-0000-4000-8000-000000000001', '9fb00000-0000-4000-8000-000000000001', 'setup', 87000, now() - interval '1 day', 'in_pf1', 'evt_pf1'),
  ('9fc00000-0000-4000-8000-000000000002', '9fa00000-0000-4000-8000-000000000002', '9fb00000-0000-4000-8000-000000000002', 'setup', 50000, now() - interval '1 day', 'in_pf2', 'evt_pf2'),
  ('9fc00000-0000-4000-8000-000000000003', '9fa00000-0000-4000-8000-000000000003', '9fb00000-0000-4000-8000-000000000003', 'setup', 40000, now() - interval '1 day', 'in_pf3', 'evt_pf3'),
  ('9fc00000-0000-4000-8000-000000000004', '9fa00000-0000-4000-8000-000000000004', '9fb00000-0000-4000-8000-000000000004', 'setup', 30000, now() - interval '1 day', 'in_pf4', 'evt_pf4');

-- Rulează un apel jsonb SUB rolul REAL `authenticated`, ca utilizatorul dat.
-- Întoarce rezultatul, sau {raised:true, sqlstate, hint} dacă apelul aruncă.
-- În pg_temp: nu atinge schema aplicației, dispare cu sesiunea.
create function pg_temp.pf_call(p_uid uuid, p_sql text) returns jsonb
language plpgsql as $f$
declare v jsonb; v_state text; v_hint text;
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('role', 'authenticated', true);
  begin
    execute 'select (' || p_sql || ')::jsonb' into v;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
    v := jsonb_build_object('raised', true, 'sqlstate', v_state, 'hint', v_hint, 'error', sqlerrm);
  end;
  perform set_config('role', 'none', true);
  return v;
end $f$;

-- Profilurile de plată ale lui A1, A2, A4 (ÎNAINTE de orice payout — după
-- batch, PF9 le îngheață). A3 rămâne fără profil (PF5: payout_profile_missing).
do $$
declare v jsonb;
begin
  v := pg_temp.pf_call('9f000000-0000-4000-8000-0000000000a1',
        $q$public.upsert_payout_profile('pfa','RO12345678','RO49 aaaa 1b31 0075 9384 0000','Ion A1 PFA')$q$);
  if (v->>'ok')::boolean is not true then raise exception 'PF fixtură: profil A1 respins (%)', v; end if;
  v := pg_temp.pf_call('9f000000-0000-4000-8000-0000000000a2',
        $q$public.upsert_payout_profile('srl','RO87654321','RO14RNCB0082044534160001','A2 SRL')$q$);
  if (v->>'ok')::boolean is not true then raise exception 'PF fixtură: profil A2 respins (%)', v; end if;
  v := pg_temp.pf_call('9f000000-0000-4000-8000-0000000000a4',
        $q$public.upsert_payout_profile('pfa',null,'RO21INGB0000999901234567','A4')$q$);
  if (v->>'ok')::boolean is not true then raise exception 'PF fixtură: profil A4 respins (%)', v; end if;
end $$;

-- ── PF1: catalog ─────────────────────────────────────────────────────────────
do $$
declare fn text; v_n int; v_raised boolean := false; v_msg text;
begin
  foreach fn in array array[
    'admin_payout_request_invoice(uuid)', 'admin_payout_match_invoice(uuid, text)',
    'admin_payout_start_transfer(uuid, text, text)', 'admin_payout_hold(uuid, text)',
    'admin_payout_mark_failed(uuid, text)', 'admin_payout_cancel(uuid, text)',
    'admin_mark_payout_paid(uuid, text)', 'admin_run_payout_batch(date)', 'admin_list_payouts()'
  ] loop
    if to_regprocedure('public.' || fn) is null then
      raise exception 'PF1 FAIL: % lipsește', fn; end if;
    if not exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.' || fn)
                    and p.prosecdef
                    and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%pg_temp%')) then
      raise exception 'PF1 FAIL: % nu e DEFINER cu pg_temp', fn; end if;
    if has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
       or has_function_privilege('service_role', 'public.' || fn, 'EXECUTE') then
      raise exception 'PF1 FAIL: % e apelabilă de anon/service_role', fn; end if;
    if not has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE') then
      raise exception 'PF1 FAIL: % nu e apelabilă de authenticated (control pozitiv)', fn; end if;
  end loop;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_mark_payout_paid';
  if v_n <> 1 then raise exception 'PF1 FAIL: admin_mark_payout_paid are % semnături (PGRST203)', v_n; end if;
  if has_function_privilege('authenticated', 'public.iban_is_valid(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.iban_is_valid(text)', 'EXECUTE') then
    raise exception 'PF1 FAIL: helper-ul iban_is_valid e apelabil de un client'; end if;
  if has_function_privilege('authenticated', 'public.run_affiliate_payout_batch(date, bigint)', 'EXECUTE') then
    raise exception 'PF1 FAIL: batch-ul brut e apelabil de authenticated (ocolește gate-ul de fondator)'; end if;
  -- Apel REAL ca anon: refuzul trebuie să fie pe FUNCȚIE (un 42501 pe schemă
  -- ar trece un test doar pe SQLSTATE — clasa TP23).
  perform set_config('role', 'anon', true);
  begin
    perform public.admin_list_payouts();
  exception when insufficient_privilege then v_raised := true; v_msg := sqlerrm;
  end;
  perform set_config('role', 'none', true);
  if not v_raised or v_msg not like '%for function%' then
    raise exception 'PF1 FAIL: anon nu a fost respins pe EXECUTE (%)', v_msg; end if;
  raise notice 'PF1 OK: 9 RPC-uri de fondator, doar authenticated; helper și batch închise';
end $$;

-- Batch-ul MANUAL al fondatorului pe luna curentă (Europe/Bucharest).
do $$
declare v jsonb; v_period date := date_trunc('month', now() at time zone 'Europe/Bucharest')::date;
begin
  v := pg_temp.pf_call('9f000000-0000-4000-8000-0000000000f1',
        format('public.admin_run_payout_batch(%L::date)', v_period));
  if (v->>'ok')::boolean is not true or (v->>'created')::int < 4 then
    raise exception 'PF3 FAIL: batch-ul manual (%)', v; end if;
  if (select count(*) from public.affiliate_payouts
       where affiliate_id::text like '9fa00000-%' and period_month = v_period and status = 'draft') <> 4 then
    raise exception 'PF3 FAIL: se așteptau 4 draft-uri pentru afiliații fixturii'; end if;
end $$;

-- ── PF2: non-fondator respins pe FIECARE RPC ─────────────────────────────────
do $$
declare
  v jsonb; v_id uuid; v_uid text; v_call text;
  v_before text; v_after text;
begin
  select id into v_id from public.affiliate_payouts
   where affiliate_id = '9fa00000-0000-4000-8000-000000000001';
  select to_jsonb(ap)::text into v_before from public.affiliate_payouts ap where id = v_id;
  -- Cont simplu ȘI afiliatul titular (cel mai motivat să-și mute singur plata).
  foreach v_uid in array array['9f000000-0000-4000-8000-0000000000e1', '9f000000-0000-4000-8000-0000000000a1'] loop
    foreach v_call in array array[
      format('public.admin_payout_request_invoice(%L)', v_id),
      format('public.admin_payout_match_invoice(%L, %L)', v_id, 'F-X'),
      format('public.admin_payout_start_transfer(%L, %L, %L)', v_id, 'bank_transfer', 'OP-X'),
      format('public.admin_payout_hold(%L, %L)', v_id, 'motiv'),
      format('public.admin_payout_mark_failed(%L, %L)', v_id, 'motiv'),
      format('public.admin_payout_cancel(%L, %L)', v_id, 'motiv'),
      format('public.admin_mark_payout_paid(%L)', v_id),
      format('public.admin_run_payout_batch(%L::date)', '2026-01-01'),
      'public.admin_list_payouts()'
    ] loop
      v := pg_temp.pf_call(v_uid::uuid, v_call);
      if (v->>'raised') is distinct from 'true' or (v->>'sqlstate') is distinct from '42501' then
        raise exception 'PF2 FAIL: % (uid %) NU a fost respins cu 42501: %', v_call, v_uid, v; end if;
    end loop;
  end loop;
  select to_jsonb(ap)::text into v_after from public.affiliate_payouts ap where id = v_id;
  if v_after is distinct from v_before then
    raise exception 'PF2 FAIL: un apel respins a modificat payout-ul'; end if;
  raise notice 'PF2 OK: 9 RPC-uri × 2 non-fondatori → 42501, rând neatins';
end $$;

-- ── PF3: parcurs complet pe virament bancar, fără Wise ───────────────────────
do $$
declare
  v jsonb; v_id uuid; v_f uuid := '9f000000-0000-4000-8000-0000000000f1';
  v_p public.affiliate_payouts%rowtype; v_debit bigint; v_audit int;
begin
  select id into v_id from public.affiliate_payouts where affiliate_id = '9fa00000-0000-4000-8000-000000000001';
  v := pg_temp.pf_call(v_f, format('public.admin_payout_request_invoice(%L)', v_id));
  if v->>'status' is distinct from 'awaiting_invoice' then raise exception 'PF3 FAIL: request_invoice %', v; end if;
  v := pg_temp.pf_call(v_f, format('public.admin_payout_match_invoice(%L, %L)', v_id, '  F-PF-001 '));
  if v->>'status' is distinct from 'invoice_matched' then raise exception 'PF3 FAIL: match_invoice %', v; end if;
  v := pg_temp.pf_call(v_f, format('public.admin_payout_start_transfer(%L, %L, %L)', v_id, 'bank_transfer', 'OP-2026-001'));
  if v->>'status' is distinct from 'processing' then raise exception 'PF3 FAIL: start_transfer %', v; end if;
  v := pg_temp.pf_call(v_f, format('public.admin_mark_payout_paid(%L)', v_id));
  if v->>'status' is distinct from 'paid' then raise exception 'PF3 FAIL: mark_paid %', v; end if;

  select * into v_p from public.affiliate_payouts where id = v_id;
  if v_p.status is distinct from 'paid'::public.affiliate_payout_status
     or v_p.invoice_number is distinct from 'F-PF-001'
     or v_p.invoice_matched_at is null or v_p.paid_at is null
     or v_p.payment_method is distinct from 'bank_transfer'
     or v_p.payment_reference is distinct from 'OP-2026-001'
     or v_p.wise_transfer_id is not null then
    raise exception 'PF3 FAIL: starea finală greșită %', to_jsonb(v_p); end if;
  select coalesce(sum(amount_cents), 0) into v_debit from public.affiliate_ledger
   where affiliate_id = '9fa00000-0000-4000-8000-000000000001' and leg = 'payout';
  if v_debit is distinct from -87000::bigint then raise exception 'PF3 FAIL: debit ledger % (așteptat -87000)', v_debit; end if;
  select count(*) into v_audit from public.platform_audit_log
   where actor_user_id = v_f and details->>'payout_id' = v_id::text
     and action in ('payout_request_invoice','payout_match_invoice','payout_start_transfer','mark_payout_paid');
  if v_audit is distinct from 4 then raise exception 'PF3 FAIL: % rânduri de audit (așteptat 4)', v_audit; end if;
  if not exists (select 1 from public.platform_audit_log where actor_user_id = v_f and action = 'run_payout_batch') then
    raise exception 'PF3 FAIL: batch-ul manual nu e în audit'; end if;
  raise notice 'PF3 OK: draft → paid pe virament bancar (fără Wise), debit -87000, 4+1 rânduri de audit';
end $$;

-- ── PF4: tranziții ilegale ───────────────────────────────────────────────────
do $$
declare
  v jsonb; v_paid uuid; v_draft uuid; v_f uuid := '9f000000-0000-4000-8000-0000000000f1';
  v_call text; v_before text; v_raised boolean;
begin
  select id into v_paid  from public.affiliate_payouts where affiliate_id = '9fa00000-0000-4000-8000-000000000001';
  select id into v_draft from public.affiliate_payouts where affiliate_id = '9fa00000-0000-4000-8000-000000000003';
  select string_agg(to_jsonb(ap)::text, '|' order by id) into v_before
    from public.affiliate_payouts ap where id in (v_paid, v_draft);
  foreach v_call in array array[
    format('public.admin_payout_request_invoice(%L)', v_paid),
    format('public.admin_payout_cancel(%L, %L)', v_paid, 'anulare pe plătit'),
    format('public.admin_payout_mark_failed(%L, %L)', v_paid, 'eșec pe plătit'),
    format('public.admin_mark_payout_paid(%L)', v_paid),
    format('public.admin_mark_payout_paid(%L)', v_draft),
    format('public.admin_payout_match_invoice(%L, %L)', v_draft, 'F-1'),
    format('public.admin_payout_start_transfer(%L, %L, %L)', v_draft, 'bank_transfer', 'OP-9'),
    format('public.admin_payout_hold(%L, %L)', v_draft, 'verificare'),
    format('public.admin_payout_mark_failed(%L, %L)', v_draft, 'eșec')
  ] loop
    v := pg_temp.pf_call(v_f, v_call);
    if v->>'reason' is distinct from 'invalid_transition' then
      raise exception 'PF4 FAIL: % → % (se aștepta invalid_transition)', v_call, v; end if;
  end loop;
  if (select string_agg(to_jsonb(ap)::text, '|' order by id)
        from public.affiliate_payouts ap where id in (v_paid, v_draft)) is distinct from v_before then
    raise exception 'PF4 FAIL: o tranziție respinsă a modificat rânduri'; end if;

  -- Trigger-ul (calea DIRECTĂ, ca postgres): referința e imuabilă pe paid…
  v_raised := false;
  begin
    update public.affiliate_payouts set payment_reference = 'OP-ALTUL' where id = v_paid;
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'PF4 FAIL: referința unui payout plătit a putut fi rescrisă'; end if;
  raise notice 'PF4 OK: 9 tranziții ilegale → invalid_transition; referința plătită imuabilă';
end $$;

-- ── PF5: validarea intrărilor + profil lipsă ─────────────────────────────────
do $$
declare
  v jsonb; v_f uuid := '9f000000-0000-4000-8000-0000000000f1';
  v3 uuid; v4 uuid; v2 uuid;
begin
  select id into v2 from public.affiliate_payouts where affiliate_id = '9fa00000-0000-4000-8000-000000000002';
  select id into v3 from public.affiliate_payouts where affiliate_id = '9fa00000-0000-4000-8000-000000000003';
  select id into v4 from public.affiliate_payouts where affiliate_id = '9fa00000-0000-4000-8000-000000000004';

  v := pg_temp.pf_call(v_f, format('public.admin_payout_cancel(%L, %L)', v3, ' '));
  if v->>'reason' is distinct from 'reason_required' then raise exception 'PF5 FAIL: cancel fără motiv %', v; end if;

  -- A3 n-are profil de plată: transferul nu se poate iniția.
  perform pg_temp.pf_call(v_f, format('public.admin_payout_request_invoice(%L)', v3));
  v := pg_temp.pf_call(v_f, format('public.admin_payout_match_invoice(%L, %L)', v3, ''));
  if v->>'reason' is distinct from 'invoice_number_required' then raise exception 'PF5 FAIL: factură goală %', v; end if;
  perform pg_temp.pf_call(v_f, format('public.admin_payout_match_invoice(%L, %L)', v3, 'F-PF-003'));
  v := pg_temp.pf_call(v_f, format('public.admin_payout_start_transfer(%L, %L, %L)', v3, 'bank_transfer', 'OP-3'));
  if v->>'reason' is distinct from 'payout_profile_missing' then raise exception 'PF5 FAIL: fără profil %', v; end if;
  if (select status::text from public.affiliate_payouts where id = v3) is distinct from 'invoice_matched' then
    raise exception 'PF5 FAIL: refuzul pe profil lipsă a mutat payout-ul'; end if;

  -- A4: metode/referințe invalide, apoi referința DUBLĂ (a lui A1).
  perform pg_temp.pf_call(v_f, format('public.admin_payout_request_invoice(%L)', v4));
  perform pg_temp.pf_call(v_f, format('public.admin_payout_match_invoice(%L, %L)', v4, 'F-PF-004'));
  v := pg_temp.pf_call(v_f, format('public.admin_payout_start_transfer(%L, %L, %L)', v4, 'cash', 'X1'));
  if v->>'reason' is distinct from 'invalid_payment_method' then raise exception 'PF5 FAIL: metodă invalidă %', v; end if;
  v := pg_temp.pf_call(v_f, format('public.admin_payout_start_transfer(%L, %L, %L)', v4, 'bank_transfer', '  '));
  if v->>'reason' is distinct from 'payment_reference_required' then raise exception 'PF5 FAIL: referință goală %', v; end if;
  v := pg_temp.pf_call(v_f, format('public.admin_payout_start_transfer(%L, %L, %L)', v4, 'wise', 'TR-12'));
  if v->>'reason' is distinct from 'invalid_wise_transfer_id' then raise exception 'PF5 FAIL: wise ne-numeric %', v; end if;
  v := pg_temp.pf_call(v_f, format('public.admin_payout_start_transfer(%L, %L, %L)', v4, 'bank_transfer', 'op-2026-001'));
  if v->>'reason' is distinct from 'payment_reference_taken' then raise exception 'PF5 FAIL: referință dublă acceptată %', v; end if;
  if (select status::text from public.affiliate_payouts where id = v4) is distinct from 'invoice_matched' then
    raise exception 'PF5 FAIL: un refuz a mutat payout-ul lui A4'; end if;
  v := pg_temp.pf_call(v_f, format('public.admin_payout_start_transfer(%L, %L, %L)', v4, 'bank_transfer', 'OP-2026-004'));
  if v->>'status' is distinct from 'processing' then raise exception 'PF5 FAIL: control pozitiv A4 %', v; end if;

  -- A2: Wise — referința numerică ajunge și în wise_transfer_id (BIGINT).
  perform pg_temp.pf_call(v_f, format('public.admin_payout_request_invoice(%L)', v2));
  perform pg_temp.pf_call(v_f, format('public.admin_payout_match_invoice(%L, %L)', v2, 'F-PF-002'));
  v := pg_temp.pf_call(v_f, format('public.admin_payout_start_transfer(%L, %L, %L)', v2, 'wise', '4400123'));
  if v->>'status' is distinct from 'processing' then raise exception 'PF5 FAIL: wise %', v; end if;
  if (select wise_transfer_id from public.affiliate_payouts where id = v2) is distinct from 4400123::bigint then
    raise exception 'PF5 FAIL: wise_transfer_id nu a fost convertit la bigint'; end if;
  raise notice 'PF5 OK: motiv/factură/metodă/referință validate, referință dublă refuzată, profil lipsă refuzat, wise → bigint';
end $$;

-- ── PF6: mark_paid — confirmarea referinței + invariantul anti-supraplată ────
do $$
declare v jsonb; v_f uuid := '9f000000-0000-4000-8000-0000000000f1'; v2 uuid;
begin
  select id into v2 from public.affiliate_payouts where affiliate_id = '9fa00000-0000-4000-8000-000000000002';
  v := pg_temp.pf_call(v_f, format('public.admin_mark_payout_paid(%L, %L)', v2, '999'));
  if v->>'reason' is distinct from 'reference_mismatch' then raise exception 'PF6 FAIL: referință greșită acceptată %', v; end if;
  -- Clawback integral DUPĂ draft: plata trebuie refuzată (106), ca un cod, nu ca 500.
  insert into public.affiliate_ledger (affiliate_id, attribution_id, reverses_ledger_id, leg, amount_cents, hold_until, stripe_event_id)
  values ('9fa00000-0000-4000-8000-000000000002', '9fb00000-0000-4000-8000-000000000002',
          '9fc00000-0000-4000-8000-000000000002', 'clawback', -50000, now(), 'evt_pf2_claw');
  v := pg_temp.pf_call(v_f, format('public.admin_mark_payout_paid(%L, %L)', v2, '4400123'));
  if v->>'reason' is distinct from 'payout_exceeds_eligible' then raise exception 'PF6 FAIL: plata pe comision stornat %', v; end if;
  if (select status::text from public.affiliate_payouts where id = v2) is distinct from 'processing' then
    raise exception 'PF6 FAIL: plata refuzată a schimbat statusul'; end if;
  if exists (select 1 from public.affiliate_ledger where affiliate_id = '9fa00000-0000-4000-8000-000000000002' and leg = 'payout') then
    raise exception 'PF6 FAIL: debit scris pe o plată refuzată'; end if;
  raise notice 'PF6 OK: reference_mismatch + payout_exceeds_eligible întoarse ca cod, fără debit';
end $$;

-- ── PF7: profilul de plată vizibil DOAR fondatorului ─────────────────────────
do $$
declare v jsonb; v_row jsonb; v_n int;
begin
  v := pg_temp.pf_call('9f000000-0000-4000-8000-0000000000f1', 'public.admin_list_payouts()');
  select e into v_row from jsonb_array_elements(v) e
   where e->>'affiliate_id' = '9fa00000-0000-4000-8000-000000000001';
  if v_row->>'payee_iban' is distinct from 'RO49AAAA1B31007593840000'
     or v_row->>'payee_cui' is distinct from 'RO12345678'
     or v_row->>'payee_name' is distinct from 'Ion A1 PFA'
     or v_row->>'payee_legal_form' is distinct from 'pfa'
     or v_row->>'payment_reference' is distinct from 'OP-2026-001'
     or v_row->>'payment_method' is distinct from 'bank_transfer' then
    raise exception 'PF7 FAIL: fondatorul nu vede profilul de plată complet: %', v_row; end if;
  -- Non-fondatorul nu primește lista (deci nici IBAN-urile altora)…
  v := pg_temp.pf_call('9f000000-0000-4000-8000-0000000000a2', 'public.admin_list_payouts()');
  if (v->>'raised') is distinct from 'true' then raise exception 'PF7 FAIL: afiliatul a primit lista fondatorului'; end if;
  -- …iar pe tabelă vede DOAR propriul profil (RLS own-only, mig 103).
  perform set_config('request.jwt.claim.sub', '9f000000-0000-4000-8000-0000000000a2', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from public.affiliate_payout_profile
   where affiliate_id in ('9fa00000-0000-4000-8000-000000000001', '9fa00000-0000-4000-8000-000000000004');
  perform set_config('role', 'none', true);
  if v_n <> 0 then raise exception 'PF7 FAIL: A2 vede % profiluri străine', v_n; end if;
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from public.affiliate_payout_profile
   where affiliate_id = '9fa00000-0000-4000-8000-000000000002';
  perform set_config('role', 'none', true);
  if v_n <> 1 then raise exception 'PF7 FAIL: control pozitiv — A2 nu-și vede propriul profil (%)', v_n; end if;
  raise notice 'PF7 OK: IBAN/CUI/beneficiar doar la fondator; afiliatul vede doar propriul profil';
end $$;

-- ── PF8: IBAN validat real ───────────────────────────────────────────────────
-- Afiliat NOU, fără niciun payout: altfel blocarea din PF9 (payout_in_progress)
-- ar răspunde înaintea validării și ar masca-o.
insert into auth.users (id, email) values ('9f000000-0000-4000-8000-0000000000a5', 'pf-a5@pf.test') on conflict (id) do nothing;
insert into public.profiles (id, email) values ('9f000000-0000-4000-8000-0000000000a5', 'pf-a5@pf.test') on conflict (id) do nothing;
insert into public.affiliates (id, profile_id, referral_code) values
  ('9fa00000-0000-4000-8000-000000000005', '9f000000-0000-4000-8000-0000000000a5', 'pfaff5');
do $$
declare v jsonb; v_u uuid := '9f000000-0000-4000-8000-0000000000a5'; v_bad text;
begin
  foreach v_bad in array array[
    'RO49BBBB1B31007593840000',   -- cifre de control greșite (mod-97 ≠ 1)
    'RO49AAAA1B3100759384000',    -- RO cu 23 de caractere
    'RO00AAAA1B31007593840000',   -- cifre de control rezervate
    'XX',                         -- format
    'RO49AAAA1B31007593840000!'   -- caracter străin
  ] loop
    v := pg_temp.pf_call(v_u, format('public.upsert_payout_profile(%L,%L,%L,%L)', 'pfa', 'RO1', v_bad, 'A5'));
    if v->>'reason' is distinct from 'invalid_iban' then raise exception 'PF8 FAIL: IBAN invalid % acceptat (%)', v_bad, v; end if;
  end loop;
  if exists (select 1 from public.affiliate_payout_profile where affiliate_id = '9fa00000-0000-4000-8000-000000000005') then
    raise exception 'PF8 FAIL: un IBAN respins a creat profilul'; end if;
  -- Control pozitiv: IBAN străin valid + normalizare (spații, minuscule).
  v := pg_temp.pf_call(v_u, format('public.upsert_payout_profile(%L,%L,%L,%L)', 'other', null, 'de89 3704 0044 0532 0130 00', 'A5 GmbH'));
  if (v->>'ok')::boolean is not true then raise exception 'PF8 FAIL: IBAN DE valid respins %', v; end if;
  if (select iban from public.affiliate_payout_profile where affiliate_id = '9fa00000-0000-4000-8000-000000000005')
       is distinct from 'DE89370400440532013000' then
    raise exception 'PF8 FAIL: IBAN-ul nu a fost normalizat'; end if;
  raise notice 'PF8 OK: 5 IBAN-uri invalide respinse, IBAN străin valid normalizat';
end $$;

-- ── PF9: IBAN înghețat cât un payout e deschis ───────────────────────────────
do $$
declare
  v jsonb; v_f uuid := '9f000000-0000-4000-8000-0000000000f1';
  v_a4 uuid := '9f000000-0000-4000-8000-0000000000a4'; v4 uuid; v_detail jsonb;
begin
  select id into v4 from public.affiliate_payouts where affiliate_id = '9fa00000-0000-4000-8000-000000000004';
  -- processing (din PF5) → blocat
  v := pg_temp.pf_call(v_a4, format('public.upsert_payout_profile(%L,%L,%L,%L)', 'pfa', null, 'RO40BBBB1B31007593840000', 'A4'));
  if v->>'reason' is distinct from 'payout_in_progress' then raise exception 'PF9 FAIL: IBAN schimbat în processing %', v; end if;
  -- on_hold → tot blocat (bani posibil plecați)
  perform pg_temp.pf_call(v_f, format('public.admin_payout_hold(%L, %L)', v4, 'banca nu confirmă'));
  v := pg_temp.pf_call(v_a4, format('public.upsert_payout_profile(%L,%L,%L,%L)', 'pfa', null, 'RO40BBBB1B31007593840000', 'A4'));
  if v->>'reason' is distinct from 'payout_in_progress' then raise exception 'PF9 FAIL: IBAN schimbat în on_hold %', v; end if;
  if (select iban from public.affiliate_payout_profile where affiliate_id = '9fa00000-0000-4000-8000-000000000004')
       is distinct from 'RO21INGB0000999901234567' then
    raise exception 'PF9 FAIL: IBAN-ul s-a schimbat deși a fost refuzat'; end if;
  -- failed → LIBER (exact starea în care un IBAN greșit se corectează)
  v := pg_temp.pf_call(v_f, format('public.admin_payout_mark_failed(%L, %L)', v4, 'IBAN respins de bancă'));
  if v->>'status' is distinct from 'failed' then raise exception 'PF9 FAIL: mark_failed %', v; end if;
  v := pg_temp.pf_call(v_a4, format('public.upsert_payout_profile(%L,%L,%L,%L)', 'pfa', null, 'RO40BBBB1B31007593840000', 'A4'));
  if (v->>'ok')::boolean is not true then raise exception 'PF9 FAIL: IBAN blocat pe failed %', v; end if;
  -- Auditul: urma schimbării, FĂRĂ IBAN-ul complet.
  select details into v_detail from public.platform_audit_log
   where actor_user_id = v_a4 and action = 'payout_profile_updated'
   order by created_at desc limit 1;
  if v_detail is null or v_detail->>'iban_last4_new' is distinct from '0000'
     or v_detail->>'iban_last4_old' is distinct from '4567'
     or not (v_detail->'changed') ? 'iban' then
    raise exception 'PF9 FAIL: auditul schimbării lipsește sau e incomplet: %', v_detail; end if;
  if v_detail::text like '%RO40BBBB%' or v_detail::text like '%RO21INGB%' then
    raise exception 'PF9 FAIL: auditul conține IBAN-ul complet'; end if;
  -- paid (A1, PF3) → liber
  v := pg_temp.pf_call('9f000000-0000-4000-8000-0000000000a1',
        format('public.upsert_payout_profile(%L,%L,%L,%L)', 'pfa', 'RO12345678', 'RO31CCCC1B31007593840000', 'Ion A1 PFA'));
  if (v->>'ok')::boolean is not true then raise exception 'PF9 FAIL: IBAN blocat după paid %', v; end if;
  raise notice 'PF9 OK: blocat în processing/on_hold, liber pe failed/paid, audit fără IBAN complet';
end $$;

-- ── PF10: idempotența batch-ului ─────────────────────────────────────────────
do $$
declare
  v jsonb; v_f uuid := '9f000000-0000-4000-8000-0000000000f1';
  v_period date := date_trunc('month', now() at time zone 'Europe/Bucharest')::date;
  v_prev date; v4 uuid; v_n int;
begin
  v_prev := (v_period - interval '1 month')::date;
  -- Aceeași perioadă, de două ori → zero draft-uri noi.
  v := pg_temp.pf_call(v_f, format('public.admin_run_payout_batch(%L::date)', v_period));
  if (v->>'created')::int is distinct from 0 then raise exception 'PF10 FAIL: re-rulare pe aceeași perioadă a creat %', v; end if;
  -- Perioadă diferită: soldul angajat (paid/processing/invoice_matched, și
  -- failed CU referință bancară — A4, FĂRĂ wise) NU se re-oferă.
  v := pg_temp.pf_call(v_f, format('public.admin_run_payout_batch(%L::date)', v_prev));
  if (v->>'ok')::boolean is not true then raise exception 'PF10 FAIL: batch %', v; end if;
  select count(*) into v_n from public.affiliate_payouts
   where period_month = v_prev and affiliate_id::text like '9fa00000-%';
  if v_n <> 0 then raise exception 'PF10 FAIL: % draft-uri pe bani deja angajați (failed CU referință bancară trebuie să rămână angajat)', v_n; end if;
  -- Anularea (operatorul confirmă că banii NU au plecat) eliberează gross-ul.
  select id into v4 from public.affiliate_payouts where affiliate_id = '9fa00000-0000-4000-8000-000000000004';
  v := pg_temp.pf_call(v_f, format('public.admin_payout_cancel(%L, %L)', v4, 'banca a returnat suma, verificat extras'));
  if v->>'status' is distinct from 'canceled' then raise exception 'PF10 FAIL: cancel pe failed %', v; end if;
  v := pg_temp.pf_call(v_f, format('public.admin_run_payout_batch(%L::date)', v_prev));
  if not exists (select 1 from public.affiliate_payouts
                  where period_month = v_prev and affiliate_id = '9fa00000-0000-4000-8000-000000000004'
                    and status = 'draft' and gross_cents = 30000) then
    raise exception 'PF10 FAIL: după canceled soldul lui A4 nu a redevenit plătibil (%)', v; end if;
  -- Draft deschis → IBAN blocat (ultima stare neacoperită de PF9).
  v := pg_temp.pf_call('9f000000-0000-4000-8000-0000000000a4',
        format('public.upsert_payout_profile(%L,%L,%L,%L)', 'pfa', null, 'RO21INGB0000999901234567', 'A4'));
  if v->>'reason' is distinct from 'payout_in_progress' then raise exception 'PF10 FAIL: IBAN schimbat cu un draft deschis %', v; end if;
  raise notice 'PF10 OK: idempotent pe perioadă, failed-cu-referință angajat, canceled eliberează, draft îngheață IBAN-ul';
end $$;

-- ── PF11: perioada batch-ului manual + lacătul ───────────────────────────────
do $$
declare v jsonb; v_f uuid := '9f000000-0000-4000-8000-0000000000f1'; v_src text;
begin
  v := pg_temp.pf_call(v_f, format('public.admin_run_payout_batch(%L::date)', '2026-03-15'));
  if v->>'reason' is distinct from 'invalid_period' then raise exception 'PF11 FAIL: zi ≠ 1 acceptată %', v; end if;
  v := pg_temp.pf_call(v_f, format('public.admin_run_payout_batch(%L::date)',
        (date_trunc('month', now() at time zone 'Europe/Bucharest') + interval '1 month')::date));
  if v->>'reason' is distinct from 'future_period' then raise exception 'PF11 FAIL: perioadă viitoare acceptată %', v; end if;
  select prosrc into v_src from pg_proc where oid = 'public.run_affiliate_payout_batch(date, bigint)'::regprocedure;
  if position('pg_try_advisory_xact_lock(hashtext(''affiliate_payout_batch''))' in v_src) = 0
     or position('batch_in_progress' in v_src) = 0 then
    raise exception 'PF11 FAIL: batch-ul a pierdut lacătul single-flight (doi apelanți: cron + fondator)'; end if;
  raise notice 'PF11 OK: perioadă invalidă/viitoare refuzată; lacăt single-flight prezent';
end $$;

-- ── PF12: batch-ul rămâne în afara pg_cron ───────────────────────────────────
do $$
begin
  if not exists (select 1 from public.pg_cron_janitor_denylist() where fn_name = 'run_affiliate_payout_batch') then
    raise exception 'PF12 FAIL: batch-ul a ieșit din denylist'; end if;
  if exists (select 1 from public.pg_cron_janitor_manifest where signature like 'public.run_affiliate_payout_batch(%') then
    raise exception 'PF12 FAIL: batch-ul a ajuns în manifestul pg_cron (CJ7: perioada e o lună românească)'; end if;
  raise notice 'PF12 OK: batch-ul rămâne în denylist, calea manuală e butonul fondatorului';
end $$;

do $$ begin raise notice '════ affiliate payout flow assertions (PF1–PF12): ALL PASS ════'; end $$;

rollback;
