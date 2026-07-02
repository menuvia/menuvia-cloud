-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 190 — hardening afiliere (audit adversarial)
-- ═══════════════════════════════════════════════════════════════
-- Trei findings CONFIRMATE pe capitolul de afiliere:
--
--   1. aff-101 (HIGH) — `upsert_payout_profile` (ultima def. mig 101) NU
--      verifica `affiliates.status = 'active'`, spre deosebire de RPC-urile
--      surori din același capitol (097b/097c/097d) care toate gatekeep pe
--      status. Efect: un afiliat `suspended`/`closed` putea în continuare să
--      scrie/rescrie IBAN-ul folosit pentru transferul Wise.
--      FIX: recreăm funcția IDENTIC cu mig 101 + gate explicit pe status
--      (`ok:false, reason:'affiliate_not_active'`).
--
--   2. aff-183 (MEDIUM) — `run_affiliate_payout_batch` (ultima def. mig 183)
--      întorcea `'ok', true` HARDCODAT chiar dacă `v_errors` conținea eșecuri
--      per (afiliat, monedă) — un caller/monitor care verifică doar `ok`
--      credea că batch-ul lunar a rulat curat când de fapt un afiliat a fost
--      sărit. FIX: recreăm funcția IDENTIC cu mig 183, cu
--      `'ok', (jsonb_array_length(v_errors) = 0)`.
--
--   3. aff-097 (HIGH, DEJA REPARAT) — policy-urile „read own attributions"/
--      „read own ledger" din mig 097 foloseau `affiliate_visible_ids()`
--      (own + sub-afiliați) → un afiliat-părinte putea citi PII-ul
--      (stripe_customer_id/referred_profile_id) și comisioanele exacte ale
--      sub-afiliaților. Fixul REAL a fost aplicat deja în mig 104 (own-only,
--      profile_id = auth.uid()); mig 103 a reparat la fel payouts/payout_profile.
--      Aici doar RE-ASSERTĂM fail-closed că starea reparată persistă (nicio
--      migrație viitoare nu are voie să reintroducă leak-ul fără să pice CI-ul).
--
-- Convenție lockdown (CLAUDE.md): SECURITY DEFINER, `search_path = public,
-- pg_temp`, PUBLIC zero EXECUTE, revoke/grant IDENTICE cu ultima definiție.
-- Migrațiile aplicate (101/183/104) NU sunt editate — acesta e fișier nou.
-- Idempotent: `create or replace function` + asserții re-rulabile.
-- ═══════════════════════════════════════════════════════════════

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ 1. upsert_payout_profile — gate pe affiliates.status='active'  ║
-- ╚═══════════════════════════════════════════════════════════════╝
-- Copie fidelă a mig 101; singura schimbare: citim și `status` și respingem
-- explicit afiliații ne-activi ÎNAINTE de orice scriere pe datele bancare.

create or replace function public.upsert_payout_profile(
  p_legal_form       text,
  p_cui              text,
  p_iban             text,
  p_beneficiary_name text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_aff_id uuid;
  v_status text;
begin
  if auth.uid() is null then
    raise exception using errcode = 'insufficient_privilege',
      message = 'upsert_payout_profile requires authentication';
  end if;

  select id, status into v_aff_id, v_status
    from public.affiliates where profile_id = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_an_affiliate');
  end if;
  -- Gate pe status (mig 190, audit aff-101): un afiliat suspended/closed NU
  -- are voie să-și (re)scrie datele bancare/fiscale — aliniat cu RPC-urile
  -- surori (097b/097c/097d) care toate verifică status = 'active'.
  if v_status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'affiliate_not_active');
  end if;

  if p_legal_form is null or p_legal_form not in ('pfa', 'srl', 'other') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_legal_form');
  end if;
  -- IBAN-ul e obligatoriu ca să poată fi plătit; validare lejeră de format.
  if p_iban is null or length(btrim(p_iban)) < 15 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_iban');
  end if;

  insert into public.affiliate_payout_profile
    (affiliate_id, legal_form, cui, iban, beneficiary_name)
  values
    (v_aff_id, p_legal_form, nullif(btrim(p_cui), ''), btrim(p_iban), nullif(btrim(p_beneficiary_name), ''))
  on conflict (affiliate_id) do update set
    legal_form       = excluded.legal_form,
    cui              = excluded.cui,
    iban             = excluded.iban,
    beneficiary_name = excluded.beneficiary_name,
    updated_at       = now();

  return jsonb_build_object('ok', true);
end$$;

-- Re-grant defensiv, identic cu mig 101 (create or replace păstrează ACL-ul,
-- dar re-aplicăm explicit ca migrația să fie corectă și standalone).
revoke all on function public.upsert_payout_profile(text, text, text, text) from public, anon;
grant execute on function public.upsert_payout_profile(text, text, text, text) to authenticated;

comment on function public.upsert_payout_profile(text, text, text, text) is
  'Afiliatul își setează datele fiscale/bancare (PFA/SRL, CUI, IBAN). Scopat la auth.uid(), doar status=active (mig 190).';

-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ 2. run_affiliate_payout_batch — ok reflectă v_errors           ║
-- ╚═══════════════════════════════════════════════════════════════╝
-- Copie fidelă a mig 183 (care la rândul ei e mig 107 + izolare erori);
-- singura schimbare: `'ok'` nu mai e hardcodat `true`, ci
-- `(jsonb_array_length(v_errors) = 0)` — un monitor care verifică doar `ok`
-- vede acum corect un batch cu eșecuri parțiale.

create or replace function public.run_affiliate_payout_batch(
  p_period_month date,
  p_min_cents    bigint default 5000
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  r           record;
  cur         public.affiliate_currency;
  v_eligible  bigint;
  v_committed bigint;
  v_payable   bigint;
  v_created   int := 0;
  v_skipped   int := 0;
  v_errors    jsonb := '[]'::jsonb;
begin
  if p_period_month <> date_trunc('month', p_period_month)::date then
    raise exception 'period_month trebuie să fie prima zi a lunii';
  end if;

  for r in select id from public.affiliates where status = 'active' loop
    -- O rulare per monedă cu sold plătibil (RON și/sau EUR).
    for cur in
      select distinct currency from public.v_affiliate_payable where affiliate_id = r.id
    loop
      -- Izolare eroare per (afiliat, monedă) (mig 183): o eroare la UN afiliat
      -- NU oprește tot batch-ul lunar de payout pentru restul afiliaților.
      begin
        select coalesce(sum(amount_cents), 0) into v_eligible
          from public.v_affiliate_payable where affiliate_id = r.id and currency = cur;

        -- Angajat: în zbor sau decontat; eliberăm doar canceled și failed FĂRĂ transfer.
        select coalesce(sum(gross_cents), 0) into v_committed
          from public.affiliate_payouts
         where affiliate_id = r.id and currency = cur
           and (status in ('draft','awaiting_invoice','invoice_matched','processing','paid','on_hold')
                or (status = 'failed' and wise_transfer_id is not null));

        v_payable := v_eligible - v_committed;

        if v_payable < p_min_cents then
          v_skipped := v_skipped + 1;
          continue;
        end if;

        insert into public.affiliate_payouts (affiliate_id, period_month, currency, gross_cents, status)
        values (r.id, p_period_month, cur, v_payable, 'draft')
        on conflict (affiliate_id, period_month, currency) do nothing;

        if found then v_created := v_created + 1; else v_skipped := v_skipped + 1; end if;
      exception when others then
        -- Izolare (mig 183): un singur afiliat+monedă eșuat NU oprește restul
        -- batch-ului. Se loghează și se acumulează în rezultatul jsonb pentru
        -- reconciliere/reîncercare manuală.
        v_skipped := v_skipped + 1;
        v_errors := v_errors || jsonb_build_object(
          'affiliate_id', r.id,
          'currency',     cur,
          'sqlstate',     sqlstate,
          'error',        sqlerrm
        );
        raise warning
          'run_affiliate_payout_batch: eroare la afiliat % monedă % — sărit (%: %)',
          r.id, cur, sqlstate, sqlerrm;
      end;
    end loop;
  end loop;

  -- ok = batch-ul a rulat FĂRĂ eșecuri parțiale (mig 190, audit aff-183).
  -- Înainte era hardcodat true chiar și cu erori acumulate în v_errors.
  return jsonb_build_object('ok', (jsonb_array_length(v_errors) = 0),
                            'created', v_created, 'skipped', v_skipped,
                            'period', p_period_month, 'errors', v_errors);
end$$;

-- Re-grant defensiv, identic cu mig 107/183: doar service_role (cron).
revoke all on function public.run_affiliate_payout_batch(date, bigint) from public, anon, authenticated;
grant execute on function public.run_affiliate_payout_batch(date, bigint) to service_role;

-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ 3. Asserții fail-closed                                        ║
-- ╚═══════════════════════════════════════════════════════════════╝

do $$
declare
  v_def  text;
  v_qual text;
begin
  -- (a) upsert_payout_profile: există, SECURITY DEFINER, gate-ul pe status
  --     e efectiv PREZENT în corpul funcției.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'upsert_payout_profile' and p.prosecdef;
  if v_def is null then
    raise exception 'mig 190: upsert_payout_profile missing/not SECURITY DEFINER';
  end if;
  if position('affiliate_not_active' in v_def) = 0
     or position('<> ''active''' in v_def) = 0 then
    raise exception 'mig 190: upsert_payout_profile nu gate-uiește pe status=active (aff-101)';
  end if;

  -- (b) run_affiliate_payout_batch: există, SECURITY DEFINER, `ok` e dinamic
  --     (derivat din v_errors), nu hardcodat true.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'run_affiliate_payout_batch' and p.prosecdef;
  if v_def is null then
    raise exception 'mig 190: run_affiliate_payout_batch missing/not SECURITY DEFINER';
  end if;
  if position('jsonb_array_length(v_errors) = 0' in v_def) = 0 then
    raise exception 'mig 190: run_affiliate_payout_batch are ok hardcodat (aff-183)';
  end if;
  if position('''ok'', true' in v_def) > 0 then
    raise exception 'mig 190: run_affiliate_payout_batch încă întoarce ok=true hardcodat (aff-183)';
  end if;

  -- (c) aff-097: leak-ul „părinte vede rândurile sub-afiliatului" pe
  --     attributions/ledger a fost DEJA reparat în mig 104 (own-only).
  --     Re-assertăm aici că starea reparată persistă — fail-closed dacă o
  --     migrație viitoare reintroduce affiliate_visible_ids() pe aceste tabele.
  select qual into v_qual from pg_policies
   where schemaname = 'public' and tablename = 'affiliate_attributions'
     and policyname = 'affiliate: read own attributions';
  if v_qual is null then
    raise exception 'mig 190: policy attributions lipsește (aff-097)';
  end if;
  if position('affiliate_visible_ids' in v_qual) > 0 then
    raise exception 'mig 190: attributions folosește din nou affiliate_visible_ids (leak, aff-097)';
  end if;

  select qual into v_qual from pg_policies
   where schemaname = 'public' and tablename = 'affiliate_ledger'
     and policyname = 'affiliate: read own ledger';
  if v_qual is null then
    raise exception 'mig 190: policy ledger lipsește (aff-097)';
  end if;
  if position('affiliate_visible_ids' in v_qual) > 0 then
    raise exception 'mig 190: ledger folosește din nou affiliate_visible_ids (leak, aff-097)';
  end if;

  raise notice 'mig 190: affiliate hardening OK (aff-101 + aff-183 fixate, aff-097 re-assertat own-only)';
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════
-- FINAL: comportament nou
--   • upsert_payout_profile: afiliat suspended/closed → {ok:false,
--     reason:'affiliate_not_active'} — nu mai poate schimba IBAN-ul.
--   • run_affiliate_payout_batch: `ok` e true DOAR dacă v_errors e gol;
--     restul semanticii (created/skipped/errors, izolare per element,
--     calcule mig 107) rămâne identică.
--   • RLS attributions/ledger: own-only (mig 104) re-assertat fail-closed.
-- ═══════════════════════════════════════════════════════════════
