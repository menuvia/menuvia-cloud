-- tests/sql/affiliate_program_gdpr_assertions.sql
-- =============================================================================
-- AP1–AP14 — clichetul PERMANENT al mig 295 (programul de afiliere: poartă de
-- deschidere, panou net, vanity, ștergere GDPR).
--
--   AP1  program ÎNCHIS (seed implicit): register_affiliate → program_closed,
--        niciun rând creat — sub rolul REAL `authenticated`
--   AP2  program DESCHIS: register → ok + pending (control pozitiv)
--   AP3  program închis: aprobarea → program_closed (cererea rămâne pending);
--        respingerea e liberă; override explicit → active + audit cu override
--   AP4  program deschis: aprobare fără override (control pozitiv); comutatorul
--        e doar al fondatorului; starea publică expune EXACT o cheie (`open`)
--   AP5  fail-closed: o valoare stricată a flag-ului (`"true"` string) = închis
--   AP6  panoul NET: clawback pe un credit în hold scade „în așteptare";
--        un credit stornat integral dispare; un draft de payout scade
--        „disponibil”; identitatea net = confirmat + în așteptare net
--   AP7  resolve_referral_code (anon): vanity → codul canonic; cod exact;
--        afiliat ne-activ → null; malformat → null
--   AP8  GDPR: contul unui AFILIAT se șterge; rândul rămâne `closed`, fără
--        profil, cu PII golite (telefon, notă, vanity, CUI/IBAN); ledger-ul și
--        payout-urile rămân
--   AP9  GDPR: contul unui OWNER ATRIBUIT se șterge; atribuirea rămâne cu
--        tombstone, `canceled`; ledger-ul afiliatului rămâne; afiliatul
--        neatins (control pozitiv pe PII-ul LUI)
--   AP10 NULL pe profil fără tombstone e respins (CHECK)
--   AP11 structură: detașarea e ÎNAINTEA ștergerii; siguranțele 282/284 au
--        rămas; helperul nu e apelabil din afară
--   AP12 FK-urile rămân RESTRICT: o ștergere pe altă cale (fără detașare)
--        e tot refuzată — NULL vine DOAR prin procesul GDPR
--   AP13 ștergerea unui afiliat se AMÂNĂ (user eligibil, IBAN intact) cât are
--        un payout `processing` sau `failed` CU referință; detașarea directă
--        refuză (`affiliate_payout_in_flight`); după stări terminale → AP8
--   AP14 fondatorul vede afiliatul șters și payout-urile lui (inclusiv cele
--        terminale) — email NULL + marcaj; control pe un afiliat ne-șters
--
-- Rulează ca `postgres`, într-o tranzacție derulată la final; secțiunile care
-- contează pentru privilegii coboară în rolul REAL `authenticated`/`anon`.
-- =============================================================================
\set ON_ERROR_STOP on

begin;

-- ── Fixtură ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('9a000000-0000-4000-8000-0000000000f0'::uuid, 'ap-founder@ap.test'),
  ('9a000000-0000-4000-8000-0000000000a1'::uuid, 'ap-cand@ap.test'),
  ('9a000000-0000-4000-8000-0000000000a2'::uuid, 'ap-aff@ap.test'),
  ('9a000000-0000-4000-8000-0000000000a3'::uuid, 'ap-owner@ap.test'),
  ('9a000000-0000-4000-8000-0000000000a4'::uuid, 'ap-gone@ap.test')
on conflict (id) do nothing;
insert into public.profiles (id, email) values
  ('9a000000-0000-4000-8000-0000000000f0'::uuid, 'ap-founder@ap.test'),
  ('9a000000-0000-4000-8000-0000000000a1'::uuid, 'ap-cand@ap.test'),
  ('9a000000-0000-4000-8000-0000000000a2'::uuid, 'ap-aff@ap.test'),
  ('9a000000-0000-4000-8000-0000000000a3'::uuid, 'ap-owner@ap.test'),
  ('9a000000-0000-4000-8000-0000000000a4'::uuid, 'ap-gone@ap.test')
on conflict (id) do nothing;
update public.profiles set is_platform_admin = true
 where id = '9a000000-0000-4000-8000-0000000000f0'::uuid;

-- Programul pornește din starea IMPLICITĂ a migrației (închis). O rulare pe o
-- bază unde fondatorul l-a deschis e normalizată aici, în tranzacția suitei.
update public.platform_settings set value = 'false'::jsonb where key = 'affiliate_program_open';

-- ── AP1: închis → program_closed, sub `authenticated` ──────────────────────
do $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-0000000000a1', true);
  perform set_config('role', 'authenticated', true);
  v := public.register_affiliate(null, '0712 000 001', 'AP1');
  perform set_config('role', 'none', true);
  if v->>'reason' is distinct from 'program_closed' or (v->>'ok')::boolean is distinct from false then
    raise exception 'AP1 FAIL: programul inchis a primit cererea (%)', v;
  end if;
  if exists (select 1 from public.affiliates where profile_id = '9a000000-0000-4000-8000-0000000000a1'::uuid) then
    raise exception 'AP1 FAIL: s-a creat un rand de afiliat cu programul inchis';
  end if;
  raise notice 'AP1 OK: program inchis → program_closed, fara rand';
end $$;

-- ── AP5: valoare stricată = închis (fail-closed) ───────────────────────────
do $$
declare v jsonb;
begin
  update public.platform_settings set value = '"true"'::jsonb where key = 'affiliate_program_open';
  perform set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-0000000000a1', true);
  perform set_config('role', 'authenticated', true);
  v := public.register_affiliate(null, '0712 000 001', 'AP5');
  perform set_config('role', 'none', true);
  if v->>'reason' is distinct from 'program_closed' then
    raise exception 'AP5 FAIL: o valoare stricata a deschis programul (%)', v;
  end if;
  if (public.get_affiliate_program_status()->>'open')::boolean is distinct from false then
    raise exception 'AP5 FAIL: starea publica raporteaza deschis pe valoare stricata';
  end if;
  update public.platform_settings set value = 'false'::jsonb where key = 'affiliate_program_open';
  raise notice 'AP5 OK: doar JSON true deschide programul';
end $$;

-- ── AP2 + AP3 + AP4: cerere, aprobare, comutator ──────────────────────────
do $$
declare v jsonb; v_aff uuid; v_raised boolean := false; v_keys text;
begin
  -- AP2: deschis → cererea intră pending (control pozitiv pentru AP1).
  update public.platform_settings set value = 'true'::jsonb where key = 'affiliate_program_open';
  perform set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-0000000000a1', true);
  perform set_config('role', 'authenticated', true);
  v := public.register_affiliate(null, '0712 000 001', 'AP2');
  perform set_config('role', 'none', true);
  if (v->>'ok')::boolean is not true or v->>'status' is distinct from 'pending' then
    raise exception 'AP2 FAIL: programul deschis nu a primit cererea (%)', v;
  end if;
  v_aff := (v->>'affiliate_id')::uuid;
  raise notice 'AP2 OK: program deschis → cerere pending';

  -- AP3: închis → aprobarea refuzată, cererea rămâne pending.
  update public.platform_settings set value = 'false'::jsonb where key = 'affiliate_program_open';
  perform set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-0000000000f0', true);
  perform set_config('role', 'authenticated', true);
  v := public.admin_review_affiliate(v_aff, true);
  perform set_config('role', 'none', true);
  if v->>'reason' is distinct from 'program_closed' then
    raise exception 'AP3 FAIL: aprobarea a trecut cu programul inchis (%)', v;
  end if;
  if (select status::text from public.affiliates where id = v_aff) is distinct from 'pending' then
    raise exception 'AP3 FAIL: cererea si-a schimbat statusul desi aprobarea a fost refuzata';
  end if;

  -- Override explicit → active + urmă în audit.
  perform set_config('role', 'authenticated', true);
  v := public.admin_review_affiliate(v_aff, true, true);
  perform set_config('role', 'none', true);
  if (v->>'ok')::boolean is not true or v->>'status' is distinct from 'active' then
    raise exception 'AP3 FAIL: override-ul fondatorului nu a aprobat (%)', v;
  end if;
  if not exists (select 1 from public.platform_audit_log
                  where action = 'affiliate_reviewed'
                    and details->>'affiliate_id' = v_aff::text
                    and (details->>'override')::boolean is true) then
    raise exception 'AP3 FAIL: override-ul nu e consemnat in audit';
  end if;
  raise notice 'AP3 OK: inchis → aprobarea cere override, consemnat in audit';

  -- AP4: comutatorul e doar al fondatorului.
  perform set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-0000000000a1', true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.admin_set_affiliate_program_open(true);
  exception when others then
    if sqlerrm not like '%Acces interzis%' then raise; end if;
    v_raised := true;
  end;
  perform set_config('role', 'none', true);
  if not v_raised then raise exception 'AP4 FAIL: un non-fondator a deschis programul'; end if;

  perform set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-0000000000f0', true);
  perform set_config('role', 'authenticated', true);
  v := public.admin_set_affiliate_program_open(true);
  perform set_config('role', 'none', true);
  if (v->>'ok')::boolean is not true then raise exception 'AP4 FAIL: fondatorul nu a putut deschide (%)', v; end if;

  -- Starea publică: anon, EXACT o cheie.
  perform set_config('role', 'anon', true);
  v := public.get_affiliate_program_status();
  perform set_config('role', 'none', true);
  select string_agg(k, ',' order by k collate "C") into v_keys from jsonb_object_keys(v) k;
  if v_keys is distinct from 'open' or (v->>'open')::boolean is distinct from true then
    raise exception 'AP4 FAIL: starea publica are alta forma (%)', v;
  end if;

  -- Deschis → aprobare FĂRĂ override (control pozitiv pentru AP3).
  update public.affiliates set status = 'pending' where id = v_aff;
  perform set_config('role', 'authenticated', true);
  v := public.admin_review_affiliate(v_aff, true);
  perform set_config('role', 'none', true);
  if v->>'status' is distinct from 'active' then
    raise exception 'AP4 FAIL: aprobarea normala nu merge cu programul deschis (%)', v;
  end if;
  raise notice 'AP4 OK: comutator doar fondator, stare publica = {open}, aprobare normala cu programul deschis';
end $$;

-- ── Fixtura de bani: afiliatul AP (a2), owner-ul atribuit (a3) ─────────────
insert into public.affiliates (id, profile_id, referral_code, vanity_slug, status, phone, application_note)
values ('9a100000-0000-4000-8000-0000000000a2'::uuid, '9a000000-0000-4000-8000-0000000000a2'::uuid,
        'apaff001', 'ion-ap', 'active', '0722 111 222', 'nota AP');
insert into public.affiliates (id, profile_id, referral_code, vanity_slug, status)
values ('9a100000-0000-4000-8000-0000000000a4'::uuid, '9a000000-0000-4000-8000-0000000000a4'::uuid,
        'apgone01', 'gone-ap', 'suspended');
insert into public.affiliate_payout_profile (affiliate_id, legal_form, cui, iban, beneficiary_name)
values ('9a100000-0000-4000-8000-0000000000a2'::uuid, 'pfa', 'RO123456', 'RO49AAAA1B31007593840000', 'Pop Ion PFA');
insert into public.affiliate_attributions (id, affiliate_id, referred_profile_id, stripe_customer_id, status)
values ('9a200000-0000-4000-8000-0000000000a3'::uuid, '9a100000-0000-4000-8000-0000000000a2'::uuid,
        '9a000000-0000-4000-8000-0000000000a3'::uuid, 'cus_ap_a3', 'active');

-- Ledger: (1) setup 3000 ÎN HOLD, stornat parțial cu 1000;
--         (2) recurring 1000 trecut de hold, intact;
--         (3) recurring 2000 trecut de hold, stornat INTEGRAL.
insert into public.affiliate_ledger (id, affiliate_id, attribution_id, leg, base_cents, commission_bps, amount_cents, hold_until, stripe_event_id)
values
  ('9a300000-0000-4000-8000-000000000001'::uuid, '9a100000-0000-4000-8000-0000000000a2'::uuid,
   '9a200000-0000-4000-8000-0000000000a3'::uuid, 'setup', 10000, 3000, 3000, now() + interval '30 days', 'evt_ap_1');
insert into public.affiliate_ledger (id, affiliate_id, attribution_id, leg, period_month, base_cents, commission_bps, amount_cents, hold_until, stripe_event_id)
values
  ('9a300000-0000-4000-8000-000000000002'::uuid, '9a100000-0000-4000-8000-0000000000a2'::uuid,
   '9a200000-0000-4000-8000-0000000000a3'::uuid, 'recurring', date_trunc('month', now() - interval '2 months')::date,
   10000, 1000, 1000, now() - interval '10 days', 'evt_ap_2'),
  ('9a300000-0000-4000-8000-000000000003'::uuid, '9a100000-0000-4000-8000-0000000000a2'::uuid,
   '9a200000-0000-4000-8000-0000000000a3'::uuid, 'recurring', date_trunc('month', now() - interval '1 month')::date,
   20000, 1000, 2000, now() - interval '5 days', 'evt_ap_3');
insert into public.affiliate_ledger (affiliate_id, attribution_id, reverses_ledger_id, leg, base_cents, commission_bps, amount_cents, hold_until, stripe_refund_id)
values
  ('9a100000-0000-4000-8000-0000000000a2'::uuid, '9a200000-0000-4000-8000-0000000000a3'::uuid,
   '9a300000-0000-4000-8000-000000000001'::uuid, 'clawback', 0, 0, -1000, now(), 're_ap_1'),
  ('9a100000-0000-4000-8000-0000000000a2'::uuid, '9a200000-0000-4000-8000-0000000000a3'::uuid,
   '9a300000-0000-4000-8000-000000000003'::uuid, 'clawback', 0, 0, -2000, now(), 're_ap_3');
-- Un draft de payout de 400 → angajat.
insert into public.affiliate_payouts (affiliate_id, period_month, currency, gross_cents, status)
values ('9a100000-0000-4000-8000-0000000000a2'::uuid, date_trunc('month', now() - interval '3 months')::date, 'RON', 400, 'draft');

-- ── AP6: panoul NET ────────────────────────────────────────────────────────
do $$
declare v jsonb; e jsonb;
begin
  perform set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-0000000000a2', true);
  perform set_config('role', 'authenticated', true);
  v := public.get_affiliate_dashboard();
  perform set_config('role', 'none', true);
  e := v->'earnings';

  -- Control pozitiv: câmpurile vechi (BRUTE) sunt neschimbate.
  if (e->>'total_cents')::bigint is distinct from 6000 or (e->>'pending_cents')::bigint is distinct from 3000 then
    raise exception 'AP6 FAIL: campurile brute s-au schimbat (%)', e;
  end if;
  if (e->>'confirmed_cents')::bigint is distinct from 1000 then
    raise exception 'AP6 FAIL: confirmat = % (asteptat 1000: recurentul intact; cel stornat integral iese)', e->>'confirmed_cents';
  end if;
  if (e->>'pending_net_cents')::bigint is distinct from 2000 then
    raise exception 'AP6 FAIL: in asteptare net = % (asteptat 3000 - 1000 clawback = 2000)', e->>'pending_net_cents';
  end if;
  if (e->>'net_earned_cents')::bigint is distinct from 3000
     or (e->>'net_earned_cents')::bigint is distinct from
        (e->>'confirmed_cents')::bigint + (e->>'pending_net_cents')::bigint then
    raise exception 'AP6 FAIL: net castigat = % (asteptat 3000 = confirmat + in asteptare net)', e->>'net_earned_cents';
  end if;
  if (e->>'in_progress_cents')::bigint is distinct from 400
     or (e->>'available_cents')::bigint is distinct from 600 then
    raise exception 'AP6 FAIL: in curs=% disponibil=% (asteptat 400 / 1000-400=600)', e->>'in_progress_cents', e->>'available_cents';
  end if;
  if (e->>'min_payout_cents')::int is distinct from 5000 then
    raise exception 'AP6 FAIL: pragul = %', e->>'min_payout_cents';
  end if;
  -- Ziua următoarei rulări: AZI (fereastra zilelor 1–2, încă nerulată) sau
  -- 1 ale lunii următoare — niciodată în trecut.
  if (v->>'next_batch_date') is null
     or not ((v->>'next_batch_date')::date = (now() at time zone 'Europe/Bucharest')::date
             or (v->>'next_batch_date')::date
                = (date_trunc('month', now() at time zone 'Europe/Bucharest') + interval '1 month')::date) then
    raise exception 'AP6 FAIL: next_batch_date nu e o zi reala de batch (%)', v->>'next_batch_date';
  end if;
  raise notice 'AP6 OK: panou net (clawback in hold scazut, stornat integral exclus, draft scazut din disponibil)';
end $$;

-- ── AP6b: un payout `failed` cu referință BANCARĂ (fără Wise) rămâne angajat ──
-- Paritate cu run_affiliate_payout_batch din mig 294: banii unui virament eșuat
-- pot fi deja plecați, deci nu au voie să reapară ca „disponibili”.
insert into public.affiliate_payouts (affiliate_id, period_month, currency, gross_cents, status, payment_method, payment_reference)
values ('9a100000-0000-4000-8000-0000000000a2'::uuid, date_trunc('month', now() - interval '4 months')::date,
        'RON', 300, 'failed', 'bank_transfer', 'RF-AP6B-1');
do $$
declare e jsonb;
begin
  perform set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-0000000000a2', true);
  perform set_config('role', 'authenticated', true);
  e := public.get_affiliate_dashboard()->'earnings';
  perform set_config('role', 'none', true);
  if (e->>'in_progress_cents')::bigint is distinct from 700
     or (e->>'available_cents')::bigint is distinct from 300 then
    raise exception 'AP6b FAIL: in curs=% disponibil=% (asteptat 700 / 1000-700=300: failed cu referinta bancara e angajat, ca in batch-ul 294)',
      e->>'in_progress_cents', e->>'available_cents';
  end if;
  raise notice 'AP6b OK: failed cu referinta bancara ramane angajat (paritate cu batch-ul 294)';
end $$;

-- ── AP7: resolve_referral_code (anon) ──────────────────────────────────────
do $$
declare v1 jsonb; v2 jsonb; v3 jsonb; v4 jsonb;
begin
  perform set_config('role', 'anon', true);
  v1 := public.resolve_referral_code('Ion-AP');
  v2 := public.resolve_referral_code('apaff001');
  v3 := public.resolve_referral_code('gone-ap');      -- afiliat suspended
  v4 := public.resolve_referral_code('nu e bun!');
  perform set_config('role', 'none', true);
  if v1->>'referral_code' is distinct from 'apaff001' then
    raise exception 'AP7 FAIL: vanity-ul nu s-a rezolvat la codul canonic (%)', v1; end if;
  if v2->>'referral_code' is distinct from 'apaff001' then
    raise exception 'AP7 FAIL: codul exact nu s-a rezolvat (%)', v2; end if;
  if v3->>'referral_code' is not null then
    raise exception 'AP7 FAIL: un afiliat ne-activ a fost rezolvat (%)', v3; end if;
  if v4->>'referral_code' is not null then
    raise exception 'AP7 FAIL: o valoare malformata a fost rezolvata (%)', v4; end if;
  raise notice 'AP7 OK: vanity → canonic, doar afiliati activi';
end $$;

-- ── AP10: NULL pe profil fără tombstone e respins ──────────────────────────
do $$
declare v_raised boolean := false;
begin
  begin
    update public.affiliates set profile_id = null where id = '9a100000-0000-4000-8000-0000000000a4'::uuid;
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'AP10 FAIL: profile_id NULL fara erased_at a fost acceptat'; end if;
  v_raised := false;
  begin
    update public.affiliate_attributions set referred_profile_id = null
     where id = '9a200000-0000-4000-8000-0000000000a3'::uuid;
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'AP10 FAIL: referred_profile_id NULL fara tombstone a fost acceptat'; end if;
  raise notice 'AP10 OK: NULL pe profil doar cu tombstone';
end $$;

-- ── AP12: o ștergere pe altă cale e tot refuzată (FK RESTRICT) ─────────────
do $$
declare v_raised boolean := false;
begin
  begin
    delete from auth.users where id = '9a000000-0000-4000-8000-0000000000a4'::uuid;
  exception when foreign_key_violation then v_raised := true;
  end;
  if not v_raised then
    raise exception 'AP12 FAIL: profilul unui afiliat s-a sters fara detasare (FK-ul nu mai e RESTRICT)';
  end if;
  raise notice 'AP12 OK: stergerea directa ramane refuzata';
end $$;

-- ── AP8 + AP9: ștergerea GDPR (archive_anonymize, politica de pe prod) ─────
do $$
declare
  v_ids uuid[];
  v_ledger_before int;
  v_ledger_after int;
  r record;
  pp record;
  a record;
begin
  insert into public.gdpr_deletion_config (id, policy) values (true, 'archive_anonymize')
  on conflict (id) do update set policy = 'archive_anonymize';

  select count(*) into v_ledger_before from public.affiliate_ledger
   where affiliate_id = '9a100000-0000-4000-8000-0000000000a2'::uuid;

  -- AP9 întâi: DOAR owner-ul atribuit e eligibil.
  update public.profiles set deletion_requested_at = now() - interval '40 days'
   where id = '9a000000-0000-4000-8000-0000000000a3'::uuid;
  select array_agg(deleted_user_id) into v_ids from public.process_account_deletions();
  if not ('9a000000-0000-4000-8000-0000000000a3'::uuid = any(coalesce(v_ids, '{}'))) then
    raise exception 'AP9 FAIL: contul owner-ului atribuit NU s-a sters (FK RESTRICT pe referred_profile_id)';
  end if;
  select * into a from public.affiliate_attributions where id = '9a200000-0000-4000-8000-0000000000a3'::uuid;
  if not found then raise exception 'AP9 FAIL: atribuirea a disparut (ledger-ul o refera)'; end if;
  if a.referred_profile_id is not null or a.referred_erased_at is null
     or a.status::text is distinct from 'canceled' then
    raise exception 'AP9 FAIL: atribuirea nu e detasata (profil=%, tombstone=%, status=%)',
      a.referred_profile_id, a.referred_erased_at, a.status;
  end if;
  select * into r from public.affiliates where id = '9a100000-0000-4000-8000-0000000000a2'::uuid;
  if r.phone is distinct from '0722 111 222' or r.status::text is distinct from 'active' then
    raise exception 'AP9 FAIL: afiliatul (care NU a cerut stergerea) a fost atins';
  end if;
  raise notice 'AP9 OK: owner atribuit sters, atribuire cu tombstone, afiliatul neatins';
end $$;

-- ── AP13: ștergerea afiliatului se AMÂNĂ cât banii sunt în mișcare ─────────
-- a2 are deja un draft (400, nimic plecat) și un `failed` CU referință bancară
-- (AP6b — transfer plecat, rezultat neconfirmat). Adăugăm și un `processing`.
-- Cât unul dintre ele e în mișcare, detașarea (care golește IBAN-ul) nu rulează;
-- după ce fondatorul le duce în stări terminale, ștergerea trece (AP8).
insert into public.affiliate_payouts (affiliate_id, period_month, currency, gross_cents, status, payment_method, payment_reference)
values ('9a100000-0000-4000-8000-0000000000a2'::uuid, date_trunc('month', now() - interval '5 months')::date,
        'RON', 200, 'processing', 'bank_transfer', 'RF-AP13-P');
do $$
declare
  v_ids uuid[];
  v jsonb;
  v_failed uuid; v_proc uuid;
  v_raised boolean := false; v_hint text;
  r record; pp record;
  -- Rulează process_account_deletions și verifică AMÂNAREA lui a2.
begin
  select id into v_failed from public.affiliate_payouts where payment_reference = 'RF-AP6B-1';
  select id into v_proc   from public.affiliate_payouts where payment_reference = 'RF-AP13-P';

  update public.profiles set deletion_requested_at = now() - interval '40 days'
   where id = '9a000000-0000-4000-8000-0000000000a2'::uuid;

  -- (1) processing + failed cu referință → amânat.
  select array_agg(deleted_user_id) into v_ids from public.process_account_deletions();
  if '9a000000-0000-4000-8000-0000000000a2'::uuid = any(coalesce(v_ids, '{}')) then
    raise exception 'AP13 FAIL: afiliatul s-a sters cu un payout in procesare / failed cu referinta (IBAN golit cu banii in miscare)';
  end if;
  select * into r from public.affiliates where id = '9a100000-0000-4000-8000-0000000000a2'::uuid;
  select * into pp from public.affiliate_payout_profile where affiliate_id = '9a100000-0000-4000-8000-0000000000a2'::uuid;
  if r.profile_id is distinct from '9a000000-0000-4000-8000-0000000000a2'::uuid or r.erased_at is not null
     or pp.iban is distinct from 'RO49AAAA1B31007593840000' then
    raise exception 'AP13 FAIL: amanarea a atins totusi afiliatul (profil=%, erased=%, iban=%)', r.profile_id, r.erased_at, pp.iban;
  end if;
  if (select deletion_blocked_reason from public.profiles where id = '9a000000-0000-4000-8000-0000000000a2'::uuid) is not null
     or not exists (select 1 from auth.users where id = '9a000000-0000-4000-8000-0000000000a2'::uuid) then
    raise exception 'AP13 FAIL: amanarea trebuie sa lase userul ELIGIBIL (fara deletion_blocked_reason) si contul intact';
  end if;

  -- Centura: detașarea apelată direct REFUZĂ, nu golește tăcut IBAN-ul.
  begin
    perform public.erase_affiliate_identity_for_user('9a000000-0000-4000-8000-0000000000a2'::uuid);
  exception when check_violation then
    v_raised := true; get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if not v_raised or v_hint is distinct from 'affiliate_payout_in_flight' then
    raise exception 'AP13 FAIL: detasarea directa nu a refuzat payout-ul in miscare (hint=%)', v_hint;
  end if;

  -- (2) Fondatorul anulează failed-ul (cu confirmarea întoarcerii banilor) →
  -- rămâne `processing` → tot amânat (fiecare stare amână singură).
  perform set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-0000000000f0', true);
  perform set_config('role', 'authenticated', true);
  v := public.admin_payout_cancel(v_failed, 'banii s-au intors, verificat extras', true);
  perform set_config('role', 'none', true);
  if v->>'status' is distinct from 'canceled' then raise exception 'AP13 FAIL: anularea failed-ului (%)', v; end if;
  select array_agg(deleted_user_id) into v_ids from public.process_account_deletions();
  if '9a000000-0000-4000-8000-0000000000a2'::uuid = any(coalesce(v_ids, '{}')) then
    raise exception 'AP13 FAIL: afiliatul s-a sters cu un payout in procesare';
  end if;

  -- (3) processing → failed → canceled (confirmat). Rămâne doar draft-ul
  -- (nimic plecat) → AP8 de mai jos TREBUIE să șteargă.
  perform set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-0000000000f0', true);
  perform set_config('role', 'authenticated', true);
  v := public.admin_payout_mark_failed(v_proc, 'banca a respins transferul');
  if v->>'status' is distinct from 'failed' then
    perform set_config('role', 'none', true);
    raise exception 'AP13 FAIL: mark_failed (%)', v; end if;
  v := public.admin_payout_cancel(v_proc, 'suma returnata, verificat extras', true);
  perform set_config('role', 'none', true);
  if v->>'status' is distinct from 'canceled' then raise exception 'AP13 FAIL: anularea processing-ului esuat (%)', v; end if;
  raise notice 'AP13 OK: stergerea amanata pe processing si pe failed cu referinta (IBAN intact, user eligibil), detasarea directa refuza';
end $$;

do $$
declare
  v_ids uuid[];
  v_ledger_before int;
  v_ledger_after int;
  r record;
  pp record;
begin
  select count(*) into v_ledger_before from public.affiliate_ledger
   where affiliate_id = '9a100000-0000-4000-8000-0000000000a2'::uuid;

  -- AP8: acum contul AFILIATULUI (doar draft + anulate → nimic în mișcare).
  update public.profiles set deletion_requested_at = now() - interval '40 days'
   where id = '9a000000-0000-4000-8000-0000000000a2'::uuid;
  select array_agg(deleted_user_id) into v_ids from public.process_account_deletions();
  if not ('9a000000-0000-4000-8000-0000000000a2'::uuid = any(coalesce(v_ids, '{}'))) then
    raise exception 'AP8 FAIL: contul afiliatului NU s-a sters (FK RESTRICT pe affiliates.profile_id)';
  end if;
  if exists (select 1 from auth.users where id = '9a000000-0000-4000-8000-0000000000a2'::uuid) then
    raise exception 'AP8 FAIL: auth.users inca are afiliatul';
  end if;
  select * into r from public.affiliates where id = '9a100000-0000-4000-8000-0000000000a2'::uuid;
  if not found then raise exception 'AP8 FAIL: randul de afiliat a disparut (ledger-ul il refera)'; end if;
  if r.profile_id is not null or r.erased_at is null or r.status::text is distinct from 'closed' then
    raise exception 'AP8 FAIL: afiliatul nu e inchis/detasat (profil=%, erased=%, status=%)', r.profile_id, r.erased_at, r.status;
  end if;
  if r.phone is not null or r.application_note is not null or r.vanity_slug is not null then
    raise exception 'AP8 FAIL: PII ramase pe afiliat (telefon=%, nota=%, vanity=%)', r.phone, r.application_note, r.vanity_slug;
  end if;
  select * into pp from public.affiliate_payout_profile where affiliate_id = '9a100000-0000-4000-8000-0000000000a2'::uuid;
  if pp.iban is not null or pp.cui is not null or pp.beneficiary_name is not null then
    raise exception 'AP8 FAIL: date bancare/fiscale ramase (iban=%, cui=%)', pp.iban, pp.cui;
  end if;
  select count(*) into v_ledger_after from public.affiliate_ledger
   where affiliate_id = '9a100000-0000-4000-8000-0000000000a2'::uuid;
  if v_ledger_after is distinct from v_ledger_before or v_ledger_before is distinct from 5 then
    raise exception 'AP8 FAIL: ledger-ul s-a schimbat (inainte=%, dupa=%)', v_ledger_before, v_ledger_after;
  end if;
  if not exists (select 1 from public.affiliate_payouts where affiliate_id = '9a100000-0000-4000-8000-0000000000a2'::uuid) then
    raise exception 'AP8 FAIL: payout-urile au disparut';
  end if;
  raise notice 'AP8 OK: afiliat sters — rand closed fara PII, ledger + payout pastrate';
end $$;

-- ── AP14: fondatorul vede în continuare afiliatul șters și payout-urile lui ─
do $$
declare v_aff jsonb; v_pay jsonb; v_row jsonb; v_n int; v_ctrl jsonb;
begin
  perform set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-0000000000f0', true);
  perform set_config('role', 'authenticated', true);
  v_aff := public.admin_list_affiliates();
  v_pay := public.admin_list_payouts();
  perform set_config('role', 'none', true);

  select e into v_row from jsonb_array_elements(v_aff) e
   where e->>'affiliate_id' = '9a100000-0000-4000-8000-0000000000a2';
  if v_row is null then
    raise exception 'AP14 FAIL: afiliatul sters a disparut din admin_list_affiliates (inner join pe profil)';
  end if;
  if v_row ? 'email' is not true or v_row->>'email' is not null or v_row->>'erased_at' is null
     or v_row->>'status' is distinct from 'closed' or v_row->>'referral_code' is distinct from 'apaff001' then
    raise exception 'AP14 FAIL: randul afiliatului sters e gresit: %', v_row;
  end if;
  -- Control pozitiv: afiliatul NE-șters își păstrează emailul, fără tombstone.
  select e into v_ctrl from jsonb_array_elements(v_aff) e
   where e->>'affiliate_id' = '9a100000-0000-4000-8000-0000000000a4';
  if v_ctrl->>'email' is distinct from 'ap-gone@ap.test' or v_ctrl->>'erased_at' is not null then
    raise exception 'AP14 FAIL: control — afiliatul ne-sters: %', v_ctrl;
  end if;

  select count(*) into v_n from jsonb_array_elements(v_pay) e
   where e->>'affiliate_id' = '9a100000-0000-4000-8000-0000000000a2'
     and e->>'affiliate_email' is null
     and (e->>'affiliate_erased')::boolean is true
     and e->>'payee_iban' is null;
  if v_n is distinct from 3 then
    raise exception 'AP14 FAIL: % payout-uri ale afiliatului sters vizibile fondatorului (asteptat 3: draft + 2 anulate)', v_n;
  end if;
  if not exists (select 1 from jsonb_array_elements(v_pay) e
                  where e->>'payment_reference' = 'RF-AP6B-1' and e->>'status' = 'canceled') then
    raise exception 'AP14 FAIL: payout-ul terminal (anulat, cu referinta) nu mai e in lista fondatorului';
  end if;
  raise notice 'AP14 OK: afiliatul sters si payout-urile lui (inclusiv terminale) raman vizibile fondatorului, cu email NULL + marcaj';
end $$;

-- ── AP11: structură + suprafață ────────────────────────────────────────────
do $$
declare v_src text; v_er int; v_del int;
begin
  select p.prosrc into v_src from pg_proc p where p.oid = 'public.process_account_deletions()'::regprocedure;
  v_er  := position('public.erase_affiliate_identity_for_user(v_user.id)' in v_src);
  v_del := position('delete from auth.users where id = v_user.id' in v_src);
  if v_er = 0 or v_del = 0 or v_er > v_del then
    raise exception 'AP11 FAIL: detasarea afilierii nu e inaintea stergerii (erase=%, del=%)', v_er, v_del;
  end if;
  if position('pg_try_advisory_xact_lock' in v_src) = 0
     or position('for update skip locked' in v_src) = 0
     or position('archive_fiscal_receipts_for_user' in v_src) = 0 then
    raise exception 'AP11 FAIL: o siguranta din 282/284 s-a pierdut';
  end if;
  if has_function_privilege('authenticated', 'public.erase_affiliate_identity_for_user(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.affiliate_program_is_open()', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_set_affiliate_program_open(boolean)', 'EXECUTE') then
    raise exception 'AP11 FAIL: un helper intern / RPC de fondator e apelabil din afara';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('register_affiliate', 'admin_review_affiliate')) <> 2 then
    raise exception 'AP11 FAIL: semnaturi multiple pe register/review (PGRST203)';
  end if;
  raise notice 'AP11 OK: structura + suprafata';
end $$;

rollback;
