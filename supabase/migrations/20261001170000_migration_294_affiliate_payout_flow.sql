-- migration_294_affiliate_payout_flow.sql
-- =============================================================================
-- Payout-ul de afiliat se poate plăti CAP-COADĂ (plan RO, §1 Afiliați + PR 6).
--
-- ── Ce era rupt (verificat pe lanțul curent, nu presupus) ─────────────────────
--   1. Mașina de stări din 098/106 (draft → awaiting_invoice → invoice_matched
--      → processing → paid) NU avea niciun scriitor în afară de `admin_mark_
--      payout_paid` (186→193), care acceptă DOAR processing/on_hold. Rolurile
--      client n-au UPDATE pe `affiliate_payouts` (098 Sec 6), deci un draft
--      creat de batch rămânea draft PE VECI: nimeni nu-l putea duce mai departe.
--   2. `processing` cerea `wise_transfer_id` (106) — un BIGINT (098). Fără cont
--      Wise (azi: fără SRL, fără Wise) un payout nu putea ajunge niciodată în
--      processing, deci nici în paid. Un virament bancar obișnuit nu avea unde
--      să-și lase referința.
--   3. `admin_list_payouts` (186) nu întorcea nici IBAN-ul, nici CUI-ul, nici
--      beneficiarul: fondatorul ar fi plătit „în orb" (date pe care le are doar
--      afiliatul, prin RLS own-only, mig 103).
--   4. `upsert_payout_profile` (101→190) accepta orice șir de ≥15 caractere ca
--      IBAN și se putea schimba ORICÂND — inclusiv între „am inițiat transferul"
--      și „transferul a plecat", fără urmă. Un IBAN greșit = bani trimiși
--      altcuiva, nerecuperabili.
--   5. Batch-ul (`run_affiliate_payout_batch`, 098→106→107→183→190) rulează
--      DOAR din automation-cron.js, iar Netlify e mort (issue #250): fără o cale
--      manuală, niciun draft nu se creează vreodată.
--
-- ── Ce face migrația ─────────────────────────────────────────────────────────
--   A. Referință bancară GENERICĂ: `payment_method` ∈ {wise, bank_transfer,
--      other} + `payment_reference text`. `wise_transfer_id` (bigint, unic)
--      RĂMÂNE, completat doar pe metoda wise, cu conversia text→bigint VALIDATĂ
--      în corp (193: `coalesce(text, bigint_col)` nici nu se planează).
--   B. Trigger-ul de tranziții (106) generalizat: `processing` cere O referință
--      (wise SAU bancară); garda de no-revert din 098/106 se aplică pe ORICE
--      referință; referința/metoda sunt IMUABILE odată scrise (urma bancară a
--      unei plăți nu se rescrie).
--   C. Batch-ul (190) primește un lacăt SINGLE-FLIGHT (`pg_try_advisory_xact_
--      lock`, convenția mig 282) — acum are DOI apelanți (cron + butonul
--      fondatorului) — și eliberează gross-ul doar pentru failed FĂRĂ nicio
--      referință (oglinda generalizată a regulii PAYOUT-2 din 106).
--      MĂSURAT cu două sesiuni psql concurente pe replay (un afiliat cu 87000
--      plătibili; A ține tranzacția 3 s, B pornește la 1 s, perioade diferite):
--        CU lacăt:   A → created 1; B → {ok:false, reason:batch_in_progress},
--                    instant. Un singur draft de 87000.
--        FĂRĂ lacăt: A → created 1; B → created 1. DOUĂ draft-uri de 87000
--                    (2026-01 și 2026-02) pentru ACEIAȘI bani — 174000 angajați
--                    pe 87000 datorați (invariantul 106 ar opri abia a doua
--                    plată, la →paid, după ce factura a fost cerută).
--      Lacătul e RE-ENTRANT pe aceeași sesiune, deci suita PF nu-l poate proba
--      comportamental (PF11 îl verifică structural).
--   D. RPC-uri de FONDATOR pentru fiecare tranziție + rularea manuală a
--      batch-ului, toate DEFINER `public, pg_temp`, jsonb, grant DOAR
--      authenticated, gate `is_platform_admin()`, audit în `platform_audit_log`.
--   E. `admin_mark_payout_paid` (DROP + CREATE: parametrul își schimbă NUMELE,
--      `create or replace` nu poate) acceptă orice metodă cu referință.
--   F. `admin_list_payouts` întoarce profilul de plată (beneficiar, formă
--      juridică, CUI, IBAN) — doar fondatorului (gate-ul funcției; tabela
--      rămâne own-only). Întoarce jsonb, deci cheile noi nu schimbă tipul de
--      retur (fără DROP).
--   G. `upsert_payout_profile` (190): IBAN validat REAL (format ISO 13616 +
--      mod-97, lungimea RO = 24), normalizat (fără spații, majuscule),
--      BLOCAT cât există un payout deschis (hint stabil `payout_in_progress`),
--      audit la creare/modificare (fără IBAN-ul complet în jurnal).
--
-- ── Ce NU face, deliberat: batch-ul NU trece pe pg_cron ──────────────────────
-- Mutarea a fost evaluată și REFUZATĂ (rămâne în `pg_cron_janitor_denylist()`,
-- CJ4 neatins). Trei motive, fiecare suficient singur:
--   1. CJ7 (clichet de CLASĂ: niciun corp programat nu are aritmetică de ceas de
--      perete — pg_cron e evaluat în GMT). Perioada payout-ului E o lună
--      calendaristică românească: JS o calculează pe Europe/Bucharest, iar
--      corpul batch-ului validează `date_trunc('month', …)`. Un wrapper
--      programat ar trebui să calculeze luna Bucureștiului → CJ7 pică, pe drept;
--      ocolirea regex-ului (make_date/extract pe altă formă) ar fi exact
--      „ajustez testul ca să treacă". CJ6 nu admite nici forma lunară
--      (`M H D * *`), iar un job ZILNIC ar schimba semantica (draft-uri create
--      în mijlocul lunii, nu la început) — decizie de produs, nu de cod.
--   2. Notice-ul „N draft-uri necesită procesare" nu are canal SQL viu: Slack-ul
--      cere pg_net + secretul webhook-ului în bază; coada de email e consumată
--      tot de Netlify (mort), iar un `email_template_kind` nou cere o migrație
--      FĂRĂ tranzacție (ca 230/233/254) — alt fișier, alt număr.
--   3. Nu e nevoie ca payout-ul să fie plătibil: butonul „Rulează batch-ul"
--      din FounderPage (`admin_run_payout_batch`) + lacătul din C fac calea
--      manuală sigură AZI, cu Netlify mort sau viu.
--
-- ── TODO consemnat (NU în această migrație) ─────────────────────────────────
--   • Email către afiliat la modificarea IBAN-ului: cere valoare nouă în
--     `email_template_kind` → migrație FĂRĂ tranzacție + template în
--     process-email-queue.js (codul se deployează ÎNAINTEA migrației, ca la 254).
--
-- Teste: tests/sql/affiliate_payout_flow_assertions.sql (PF1–PF12).
-- =============================================================================

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ═════════════════════════════════════════════════════════════════════════════
-- A. Referința bancară generică
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.affiliate_payouts
  add column if not exists payment_method    text,
  add column if not exists payment_reference text;

alter table public.affiliate_payouts
  drop constraint if exists affiliate_payouts_payment_method_check;
alter table public.affiliate_payouts
  add constraint affiliate_payouts_payment_method_check
  check (payment_method is null or payment_method in ('wise', 'bank_transfer', 'other'));

alter table public.affiliate_payouts
  drop constraint if exists affiliate_payouts_payment_reference_check;
alter table public.affiliate_payouts
  add constraint affiliate_payouts_payment_reference_check
  check (payment_reference is null
         or (payment_reference = btrim(payment_reference)
             and length(payment_reference) between 1 and 200));

-- O referință wise/bancară folosită de DOUĂ payout-uri = semnal de dublă plată.
-- `other` (numerar, compensare) e text liber, deliberat fără unicitate.
create unique index if not exists affiliate_payouts_payment_reference_uniq
  on public.affiliate_payouts (payment_method, lower(payment_reference))
  where payment_reference is not null and payment_method in ('wise', 'bank_transfer');

comment on column public.affiliate_payouts.payment_method is
  'mig 294: wise | bank_transfer | other. Setat la intrarea în processing, IMUABIL după.';
comment on column public.affiliate_payouts.payment_reference is
  'mig 294: referința plății (id transfer Wise / nr. OP / alt document). Obligatorie pentru processing (sau wise_transfer_id pe rândurile vechi). IMUABILĂ odată scrisă.';

comment on table public.affiliate_payouts is
  'Batch de plată per afiliat/perioadă/monedă; debitul în ledger se scrie la paid (trg_affiliate_payout_settle, invariant anti-supraplată 106). '
  'MAȘINA DE STĂRI (trg_affiliate_payout_transition, 098→106→294; scriitori: RPC-urile de fondator din mig 294): '
  'draft --admin_payout_request_invoice--> awaiting_invoice --admin_payout_match_invoice(nr. factură)--> invoice_matched '
  '--admin_payout_start_transfer(metodă, referință)--> processing --admin_mark_payout_paid--> paid (TERMINAL). '
  'processing --admin_payout_hold--> on_hold; processing|on_hold --admin_payout_mark_failed--> failed; '
  'failed FĂRĂ referință --admin_payout_match_invoice--> invoice_matched (reîncercare); '
  'draft|awaiting_invoice|invoice_matched|failed --admin_payout_cancel(motiv[, banii întorși])--> canceled (TERMINAL, eliberează gross-ul; pe failed CU referință cere confirmarea întoarcerii banilor). '
  'Gross-ul rămâne ANGAJAT (batch-ul nu-l re-oferă) în toate stările în afară de canceled și failed FĂRĂ referință. '
  'Odată ce există o referință (wise_transfer_id sau payment_reference), payout-ul nu mai poate reveni într-o stare pre-transfer, iar referința nu se mai poate schimba.';

-- ═════════════════════════════════════════════════════════════════════════════
-- B. Trigger-ul de tranziții — copie a mig 106 + referința generică +
--    imuabilitatea referinței. Matricea e NESCHIMBATĂ.
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.fn_affiliate_payout_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_ok boolean := false;
begin
  -- mig 294: urma bancară a unei plăți nu se rescrie. Verificat ÎNAINTEA
  -- scurtăturii „status neschimbat", altfel un UPDATE fără schimbare de
  -- status ar putea înlocui referința unui payout deja plătit.
  if OLD.wise_transfer_id is not null
     and NEW.wise_transfer_id is distinct from OLD.wise_transfer_id then
    raise exception using errcode = 'check_violation',
      message = 'payout: wise_transfer_id e imuabil odată setat',
      hint    = 'payment_reference_immutable';
  end if;
  if OLD.payment_reference is not null
     and NEW.payment_reference is distinct from OLD.payment_reference then
    raise exception using errcode = 'check_violation',
      message = 'payout: referința plății e imuabilă odată setată',
      hint    = 'payment_reference_immutable';
  end if;
  if OLD.payment_method is not null
     and NEW.payment_method is distinct from OLD.payment_method then
    raise exception using errcode = 'check_violation',
      message = 'payout: metoda de plată e imuabilă odată setată',
      hint    = 'payment_reference_immutable';
  end if;

  if OLD.status = NEW.status then
    return NEW;  -- update non-status (ex. invoice_number) permis
  end if;

  v_ok := case OLD.status
    when 'draft'            then NEW.status in ('awaiting_invoice','canceled')
    when 'awaiting_invoice' then NEW.status in ('invoice_matched','canceled')
    when 'invoice_matched'  then NEW.status in ('processing','canceled')
    when 'processing'       then NEW.status in ('paid','failed','on_hold')
    when 'on_hold'          then NEW.status in ('paid','failed')
    when 'failed'           then NEW.status in ('invoice_matched','canceled')
    else false  -- paid / canceled = terminale
  end;

  if not v_ok then
    raise exception using errcode = 'check_violation',
      message = format('payout: tranziție invalidă %s → %s', OLD.status, NEW.status),
      hint    = 'invalid_payout_transition';
  end if;

  -- AFF-E2E-1 (106), generalizat în 294: processing cere o referință — id-ul
  -- transferului Wise SAU referința bancară generică. Fără ea, garda de
  -- no-revert de mai jos n-ar avea pe ce să se sprijine.
  if NEW.status = 'processing'
     and NEW.wise_transfer_id is null and NEW.payment_reference is null then
    raise exception using errcode = 'check_violation',
      message = 'payout: tranziția în processing necesită referința plății (wise_transfer_id sau payment_reference)',
      hint    = 'processing_requires_payment_reference';
  end if;

  -- Niciodată înapoi spre o stare pre-transfer odată ce există o referință.
  if (OLD.wise_transfer_id is not null or OLD.payment_reference is not null)
     and NEW.status in ('draft','awaiting_invoice','invoice_matched') then
    raise exception using errcode = 'check_violation',
      message = 'payout: nu se poate reveni la o stare pre-transfer după ce există o referință de plată',
      hint    = 'invalid_payout_transition';
  end if;

  NEW.updated_at := now();
  if NEW.status = 'paid' and NEW.paid_at is null then
    NEW.paid_at := now();
  end if;
  return NEW;
end$$;

-- Funcție de TRIGGER: neexecutabilă prin /rpc (clichet RP13, mig 279).
revoke all on function public.fn_affiliate_payout_transition() from public, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- C. Batch-ul — copie a mig 190 + lacăt single-flight + referința generică
--    în „angajat". Lanț 098→106→107→183→190→294.
-- ═════════════════════════════════════════════════════════════════════════════
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

  -- mig 294: SINGLE-FLIGHT (convenția mig 282). Batch-ul are acum DOI apelanți
  -- (automation-cron.js + butonul fondatorului). Calculul „plătibil = eligibil
  -- − angajat" e check-then-act: două rulări concurente pe PERIOADE diferite
  -- ar vedea amândouă același sold neangajat și ar crea două draft-uri pentru
  -- aceiași bani (unicitatea e per perioadă, nu per bani). A doua rulare iese
  -- imediat, fără să scrie nimic.
  if not pg_try_advisory_xact_lock(hashtext('affiliate_payout_batch')) then
    return jsonb_build_object('ok', false, 'reason', 'batch_in_progress',
                              'created', 0, 'skipped', 0,
                              'period', p_period_month, 'errors', '[]'::jsonb);
  end if;

  for r in select id from public.affiliates where status = 'active' loop
    -- O rulare per monedă cu sold plătibil (RON și/sau EUR).
    for cur in
      select distinct currency from public.v_affiliate_payable where affiliate_id = r.id
    loop
      -- Izolare eroare per (afiliat, monedă) (mig 183).
      begin
        select coalesce(sum(amount_cents), 0) into v_eligible
          from public.v_affiliate_payable where affiliate_id = r.id and currency = cur;

        -- Angajat: în zbor sau decontat. Se eliberează DOAR canceled și failed
        -- FĂRĂ nicio referință de plată (106 + 294: referința bancară generică
        -- înseamnă la fel de mult ca wise_transfer_id — banii pot fi plecat).
        select coalesce(sum(gross_cents), 0) into v_committed
          from public.affiliate_payouts
         where affiliate_id = r.id and currency = cur
           and (status in ('draft','awaiting_invoice','invoice_matched','processing','paid','on_hold')
                or (status = 'failed'
                    and (wise_transfer_id is not null or payment_reference is not null)));

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
  return jsonb_build_object('ok', (jsonb_array_length(v_errors) = 0),
                            'created', v_created, 'skipped', v_skipped,
                            'period', p_period_month, 'errors', v_errors);
end$$;

revoke all on function public.run_affiliate_payout_batch(date, bigint) from public, anon, authenticated;
grant execute on function public.run_affiliate_payout_batch(date, bigint) to service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- D0. Helper: validarea IBAN (ISO 13616: format + mod-97). Intern.
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.iban_is_valid(p_iban text)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_s   text;
  v_r   text;
  v_c   text;
  v_rem integer := 0;
  i     integer;
begin
  if p_iban is null then
    return false;
  end if;
  v_s := upper(regexp_replace(p_iban, '\s', '', 'g'));
  -- ISO 13616: țară (2 litere) + cifre de control (2) + BBAN alfanumeric.
  if v_s !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' then
    return false;
  end if;
  -- 00/01/99 nu sunt cifre de control valide (intervalul e 02–98).
  if substr(v_s, 3, 2) in ('00', '01', '99') then
    return false;
  end if;
  -- România: lungime FIXĂ 24 = RO + 2 cifre + 4 litere (banca) + 16 alfanumerice.
  if left(v_s, 2) = 'RO' and v_s !~ '^RO[0-9]{2}[A-Z]{4}[A-Z0-9]{16}$' then
    return false;
  end if;
  -- mod-97: primele 4 caractere la final, literele → 10..35, restul mod 97 = 1.
  -- Calculat incremental (numărul are până la ~70 de cifre).
  v_r := substr(v_s, 5) || left(v_s, 4);
  for i in 1 .. length(v_r) loop
    v_c := substr(v_r, i, 1);
    if v_c between '0' and '9' then
      v_rem := (v_rem * 10 + (ascii(v_c) - 48)) % 97;
    else
      v_rem := (v_rem * 100 + (ascii(v_c) - 55)) % 97;
    end if;
  end loop;
  return v_rem = 1;
end$$;

-- Helper intern (convenția mig 262): apelat doar din corpul DEFINER de mai jos.
revoke all on function public.iban_is_valid(text) from public, anon, authenticated, service_role;

comment on function public.iban_is_valid(text) is
  'mig 294: IBAN valid după ISO 13616 (format + cifre de control mod-97; RO = 24 caractere). Intern — doar upsert_payout_profile.';

-- ═════════════════════════════════════════════════════════════════════════════
-- G. upsert_payout_profile — copie a mig 190 + IBAN real + blocare + audit.
-- ═════════════════════════════════════════════════════════════════════════════
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
  v_aff_id  uuid;
  v_status  text;
  v_old     public.affiliate_payout_profile%rowtype;
  v_iban    text;
  v_cui     text;
  v_name    text;
  v_changed text[] := '{}';
begin
  if auth.uid() is null then
    raise exception using errcode = 'insufficient_privilege',
      message = 'upsert_payout_profile requires authentication';
  end if;

  -- mig 294: `for update` pe rândul afiliatului serializează scrierea profilului
  -- cu `admin_payout_start_transfer` (care ia același lacăt): IBAN-ul nu se
  -- poate schimba între „am citit IBAN-ul ca să inițiez plata" și „payout-ul e
  -- în processing" (de acolo încolo îl blochează verificarea de mai jos).
  select id, status into v_aff_id, v_status
    from public.affiliates where profile_id = auth.uid()
    for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_an_affiliate');
  end if;
  -- Gate pe status (mig 190, audit aff-101).
  if v_status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'affiliate_not_active');
  end if;

  if p_legal_form is null or p_legal_form not in ('pfa', 'srl', 'other') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_legal_form');
  end if;

  -- mig 294: normalizare (spațiile din gruparea „RO49 AAAA …" și majuscule),
  -- apoi validare REALĂ: format ISO 13616 + mod-97. Lungimea minimă de 15 din
  -- 101/190 accepta orice șir — un IBAN cu o cifră greșită trimitea banii
  -- altcuiva sau înapoi după zile.
  v_iban := upper(regexp_replace(coalesce(p_iban, ''), '\s', '', 'g'));
  if not public.iban_is_valid(v_iban) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_iban');
  end if;

  -- mig 294: IBAN-ul (și restul profilului de plată) e ÎNGHEȚAT cât există un
  -- payout deschis. `failed` NU blochează: e exact starea în care un IBAN
  -- greșit trebuie corectat ca payout-ul să fie reluat. `on_hold` blochează
  -- (bani posibil plecați, în reconciliere).
  if exists (
    select 1 from public.affiliate_payouts
     where affiliate_id = v_aff_id
       and status in ('draft', 'awaiting_invoice', 'invoice_matched', 'processing', 'on_hold')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'payout_in_progress');
  end if;

  v_cui  := nullif(btrim(p_cui), '');
  v_name := nullif(btrim(p_beneficiary_name), '');

  select * into v_old from public.affiliate_payout_profile where affiliate_id = v_aff_id;

  insert into public.affiliate_payout_profile
    (affiliate_id, legal_form, cui, iban, beneficiary_name)
  values
    (v_aff_id, p_legal_form, v_cui, v_iban, v_name)
  on conflict (affiliate_id) do update set
    legal_form       = excluded.legal_form,
    cui              = excluded.cui,
    iban             = excluded.iban,
    beneficiary_name = excluded.beneficiary_name,
    updated_at       = now();

  -- mig 294: audit. Jurnalul NU primește IBAN-ul complet (e citit de fondator,
  -- dar rămâne un jurnal) — doar ultimele 4 caractere, cât să se vadă că s-a
  -- schimbat și în ce.
  if v_old.affiliate_id is null then
    perform public.log_platform_action('affiliate', null, 'payout_profile_created',
      jsonb_build_object('affiliate_id', v_aff_id, 'legal_form', p_legal_form,
                         'iban_last4', right(v_iban, 4)));
  else
    if v_old.iban is distinct from v_iban then v_changed := array_append(v_changed, 'iban'); end if;
    if v_old.cui is distinct from v_cui then v_changed := array_append(v_changed, 'cui'); end if;
    if v_old.legal_form is distinct from p_legal_form then v_changed := array_append(v_changed, 'legal_form'); end if;
    if v_old.beneficiary_name is distinct from v_name then v_changed := array_append(v_changed, 'beneficiary_name'); end if;
    if cardinality(v_changed) > 0 then
      perform public.log_platform_action('affiliate', null, 'payout_profile_updated',
        jsonb_build_object('affiliate_id', v_aff_id, 'changed', to_jsonb(v_changed),
                           'iban_last4_old', right(v_old.iban, 4),
                           'iban_last4_new', right(v_iban, 4)));
    end if;
  end if;
  -- TODO (mig 294): email către afiliat la schimbarea IBAN-ului — cere un
  -- `email_template_kind` nou, deci o migrație FĂRĂ tranzacție (vezi antet).

  return jsonb_build_object('ok', true);
end$$;

revoke all on function public.upsert_payout_profile(text, text, text, text) from public, anon, service_role;
grant execute on function public.upsert_payout_profile(text, text, text, text) to authenticated;

comment on function public.upsert_payout_profile(text, text, text, text) is
  'Afiliatul își setează datele fiscale/bancare (PFA/SRL, CUI, IBAN). Scopat la auth.uid(), doar status=active (190). mig 294: IBAN validat ISO 13616 + mod-97, normalizat; blocat cât există un payout draft/awaiting_invoice/invoice_matched/processing/on_hold (reason payout_in_progress); audit în platform_audit_log.';

-- ═════════════════════════════════════════════════════════════════════════════
-- D. RPC-urile de fondator pentru tranziții.
--    Contract comun: non-fondator → excepție 42501 (hint not_platform_admin);
--    refuz de business → {ok:false, reason:<cod stabil>, error:<mesaj RO>,
--    status:<starea curentă>}; succes → {ok:true, status:<starea nouă>}.
--    Rândul se blochează (`for update`) înainte de verificarea stării, ca
--    două clicuri concurente să nu treacă amândouă de verificare.
-- ═════════════════════════════════════════════════════════════════════════════

-- D1. draft → awaiting_invoice (afiliatul e rugat să emită factura)
create or replace function public.admin_payout_request_invoice(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_p public.affiliate_payouts%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Acces interzis', hint = 'not_platform_admin';
  end if;
  select * into v_p from public.affiliate_payouts where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found', 'error', 'Payout inexistent.');
  end if;
  if v_p.status <> 'draft' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_transition', 'status', v_p.status,
      'error', format('Cererea de factură se face doar din ciornă (acum: %s).', v_p.status));
  end if;
  update public.affiliate_payouts set status = 'awaiting_invoice' where id = p_id;
  perform public.log_platform_action('founder', null, 'payout_request_invoice',
    jsonb_build_object('payout_id', p_id, 'from', v_p.status, 'to', 'awaiting_invoice'));
  return jsonb_build_object('ok', true, 'status', 'awaiting_invoice');
end$$;

-- D2. awaiting_invoice | failed(fără referință) → invoice_matched
create or replace function public.admin_payout_match_invoice(p_id uuid, p_invoice_number text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_p   public.affiliate_payouts%rowtype;
  v_inv text := nullif(btrim(p_invoice_number), '');
begin
  if not public.is_platform_admin() then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Acces interzis', hint = 'not_platform_admin';
  end if;
  if v_inv is null or length(v_inv) > 64 then
    return jsonb_build_object('ok', false, 'reason', 'invoice_number_required',
      'error', 'Numărul facturii afiliatului e obligatoriu (max. 64 de caractere).');
  end if;
  select * into v_p from public.affiliate_payouts where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found', 'error', 'Payout inexistent.');
  end if;
  -- `failed` intră aici doar FĂRĂ referință (nimic n-a plecat): cu referință,
  -- singura ieșire e anularea după reconciliere (106/294, garda din trigger).
  if not (v_p.status = 'awaiting_invoice'
          or (v_p.status = 'failed'
              and v_p.wise_transfer_id is null and v_p.payment_reference is null)) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_transition', 'status', v_p.status,
      'error', format('Factura se confirmă doar din „așteaptă factura" sau dintr-un eșec fără transfer (acum: %s).', v_p.status));
  end if;
  update public.affiliate_payouts
     set status = 'invoice_matched', invoice_number = v_inv, invoice_matched_at = now()
   where id = p_id;
  perform public.log_platform_action('founder', null, 'payout_match_invoice',
    jsonb_build_object('payout_id', p_id, 'from', v_p.status, 'to', 'invoice_matched',
                       'invoice_number', v_inv));
  return jsonb_build_object('ok', true, 'status', 'invoice_matched');
end$$;

-- D3. invoice_matched → processing (transferul a fost INIȚIAT, cu referință)
create or replace function public.admin_payout_start_transfer(
  p_id                uuid,
  p_payment_method    text,
  p_payment_reference text
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_p    public.affiliate_payouts%rowtype;
  v_ref  text := nullif(btrim(p_payment_reference), '');
  v_wise bigint;
  v_iban text;
begin
  if not public.is_platform_admin() then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Acces interzis', hint = 'not_platform_admin';
  end if;
  if p_payment_method is null or p_payment_method not in ('wise', 'bank_transfer', 'other') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payment_method',
      'error', 'Metoda de plată trebuie să fie wise, bank_transfer sau other.');
  end if;
  if v_ref is null or length(v_ref) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'payment_reference_required',
      'error', 'Referința plății e obligatorie (id transfer Wise / nr. OP / document).');
  end if;
  -- Wise: id-ul transferului e BIGINT (098). Conversie VALIDATĂ în corp —
  -- `coalesce(text, bigint_col)` nici nu se planează (bug-ul reparat în 193).
  if p_payment_method = 'wise' then
    if v_ref !~ '^\d{1,18}$' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_wise_transfer_id',
        'error', 'Pentru Wise, referința e id-ul numeric al transferului.');
    end if;
    v_wise := v_ref::bigint;
  end if;

  select * into v_p from public.affiliate_payouts where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found', 'error', 'Payout inexistent.');
  end if;
  if v_p.status <> 'invoice_matched' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_transition', 'status', v_p.status,
      'error', format('Transferul se inițiază doar după confirmarea facturii (acum: %s).', v_p.status));
  end if;

  -- Același lacăt ca upsert_payout_profile: profilul nu se poate schimba între
  -- citirea de aici și intrarea în processing (după care îl îngheață blocarea).
  perform 1 from public.affiliates where id = v_p.affiliate_id for update;
  select iban into v_iban from public.affiliate_payout_profile where affiliate_id = v_p.affiliate_id;
  if v_iban is null then
    return jsonb_build_object('ok', false, 'reason', 'payout_profile_missing',
      'error', 'Afiliatul nu are IBAN în profilul de plată — nu există unde trimite banii.');
  end if;

  begin
    update public.affiliate_payouts
       set status            = 'processing',
           payment_method    = p_payment_method,
           payment_reference = v_ref,
           wise_transfer_id  = coalesce(v_wise, wise_transfer_id)
     where id = p_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'payment_reference_taken',
      'error', 'Referința aceasta e deja folosită de alt payout — verifică să nu fie o plată dublă.');
  end;

  perform public.log_platform_action('founder', null, 'payout_start_transfer',
    jsonb_build_object('payout_id', p_id, 'from', v_p.status, 'to', 'processing',
                       'payment_method', p_payment_method, 'payment_reference', v_ref,
                       'iban_last4', right(v_iban, 4)));
  return jsonb_build_object('ok', true, 'status', 'processing');
end$$;

-- D4. processing → on_hold (rezultat ambiguu, reconciliere manuală)
create or replace function public.admin_payout_hold(p_id uuid, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_p      public.affiliate_payouts%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if not public.is_platform_admin() then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Acces interzis', hint = 'not_platform_admin';
  end if;
  if v_reason is null or length(v_reason) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'reason_required',
      'error', 'Motivul e obligatoriu.');
  end if;
  select * into v_p from public.affiliate_payouts where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found', 'error', 'Payout inexistent.');
  end if;
  if v_p.status <> 'processing' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_transition', 'status', v_p.status,
      'error', format('Se pune în verificare doar un payout în procesare (acum: %s).', v_p.status));
  end if;
  update public.affiliate_payouts set status = 'on_hold', failure_reason = v_reason where id = p_id;
  perform public.log_platform_action('founder', null, 'payout_hold',
    jsonb_build_object('payout_id', p_id, 'from', v_p.status, 'to', 'on_hold', 'reason', v_reason));
  return jsonb_build_object('ok', true, 'status', 'on_hold');
end$$;

-- D5. processing | on_hold → failed
create or replace function public.admin_payout_mark_failed(p_id uuid, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_p      public.affiliate_payouts%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if not public.is_platform_admin() then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Acces interzis', hint = 'not_platform_admin';
  end if;
  if v_reason is null or length(v_reason) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'reason_required',
      'error', 'Motivul e obligatoriu.');
  end if;
  select * into v_p from public.affiliate_payouts where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found', 'error', 'Payout inexistent.');
  end if;
  if v_p.status not in ('processing', 'on_hold') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_transition', 'status', v_p.status,
      'error', format('Eșecul se marchează doar pe un payout în procesare sau în verificare (acum: %s).', v_p.status));
  end if;
  update public.affiliate_payouts set status = 'failed', failure_reason = v_reason where id = p_id;
  perform public.log_platform_action('founder', null, 'payout_mark_failed',
    jsonb_build_object('payout_id', p_id, 'from', v_p.status, 'to', 'failed', 'reason', v_reason));
  return jsonb_build_object('ok', true, 'status', 'failed');
end$$;

-- D6. draft | awaiting_invoice | invoice_matched | failed → canceled
--
-- Un `failed` CU referință bancară (wise_transfer_id / payment_reference) e
-- un transfer care A PLECAT și a fost declarat eșuat — banii pot fi ajuns
-- totuși la afiliat, sau pot fi încă în drum înapoi. Anularea ELIBEREAZĂ
-- gross-ul (batch-ul nu mai socotește angajat un `canceled`), deci o anulare
-- „pe încredere" urmată de batch = PLATĂ DUBLĂ. Pe ramura asta anularea cere
-- confirmarea EXPLICITĂ `p_money_returned = true` (fondatorul a verificat în
-- extras că banii NU au ajuns / s-au întors), altfel `money_return_unconfirmed`.
-- Confirmarea se consemnează în audit. Pe celelalte stări parametrul e ignorat
-- (nimic n-a plecat). Parametrul e ULTIMUL, cu default → un client vechi care
-- trimite doar (p_id, p_reason) rămâne valid pe stările fără referință.
-- O SINGURĂ semnătură (anti PGRST203): DROP pe forma cu 2 argumente, dacă a
-- apucat să existe pe o bază de lucru.
drop function if exists public.admin_payout_cancel(uuid, text);

create or replace function public.admin_payout_cancel(
  p_id             uuid,
  p_reason         text,
  p_money_returned boolean default false
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_p       public.affiliate_payouts%rowtype;
  v_reason  text := nullif(btrim(p_reason), '');
  v_has_ref boolean;
begin
  if not public.is_platform_admin() then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Acces interzis', hint = 'not_platform_admin';
  end if;
  if v_reason is null or length(v_reason) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'reason_required',
      'error', 'Motivul anulării e obligatoriu (pe un eșec cu transfer: confirmarea că banii NU au plecat).');
  end if;
  select * into v_p from public.affiliate_payouts where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found', 'error', 'Payout inexistent.');
  end if;
  if v_p.status not in ('draft', 'awaiting_invoice', 'invoice_matched', 'failed') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_transition', 'status', v_p.status,
      'error', format('Payout-ul nu se mai poate anula (acum: %s).', v_p.status));
  end if;
  v_has_ref := (v_p.wise_transfer_id is not null or v_p.payment_reference is not null);
  -- Banii au plecat cândva: anularea îi eliberează pentru batch → plata dublă
  -- dacă au ajuns totuși. Doar cu confirmarea explicită a întoarcerii lor.
  if v_p.status = 'failed' and v_has_ref and p_money_returned is not true then
    return jsonb_build_object('ok', false, 'reason', 'money_return_unconfirmed', 'status', v_p.status,
      'error', 'Transferul acestui payout a plecat (are referință bancară). Anularea eliberează suma pentru o plată nouă — confirmă întâi în extras că banii NU au ajuns la afiliat sau s-au întors în cont.');
  end if;
  update public.affiliate_payouts set status = 'canceled', failure_reason = v_reason where id = p_id;
  perform public.log_platform_action('founder', null, 'payout_cancel',
    jsonb_build_object('payout_id', p_id, 'from', v_p.status, 'to', 'canceled', 'reason', v_reason,
                       'had_payment_reference', v_has_ref,
                       'money_returned_confirmed', coalesce(p_money_returned, false)));
  return jsonb_build_object('ok', true, 'status', 'canceled');
end$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- E. admin_mark_payout_paid — lanț 186→193→294. DROP + CREATE: parametrul
--    `p_wise_transfer_id` devine `p_payment_reference` (un `create or replace`
--    nu poate redenumi un parametru). Aceleași TIPURI (uuid, text), deci nici
--    o a doua semnătură, nici PGRST203.
-- ═════════════════════════════════════════════════════════════════════════════
drop function if exists public.admin_mark_payout_paid(uuid, text);

create function public.admin_mark_payout_paid(
  p_id                uuid,
  p_payment_reference text default null
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_p    public.affiliate_payouts%rowtype;
  v_ref  text := nullif(btrim(p_payment_reference), '');
  v_hint text;
  v_msg  text;
begin
  if not public.is_platform_admin() then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Acces interzis', hint = 'not_platform_admin';
  end if;

  select * into v_p from public.affiliate_payouts where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found', 'error', 'Payout inexistent.');
  end if;
  if v_p.status not in ('processing', 'on_hold') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_transition', 'status', v_p.status,
      'error', format('Se marchează plătit doar din procesare sau verificare (acum: %s).', v_p.status));
  end if;
  -- Orice metodă, cu referință. processing o cere deja (trigger-ul B), deci aici
  -- e o centură pentru rândurile vechi; parametrul e o CONFIRMARE: dacă e dat,
  -- trebuie să coincidă cu referința existentă (nu o rescrie — e imuabilă).
  if v_p.payment_reference is null and v_p.wise_transfer_id is null then
    return jsonb_build_object('ok', false, 'reason', 'payment_reference_required',
      'error', 'Payout-ul nu are referință de plată.');
  end if;
  if v_ref is not null
     and v_ref is distinct from coalesce(v_p.payment_reference, v_p.wise_transfer_id::text) then
    return jsonb_build_object('ok', false, 'reason', 'reference_mismatch',
      'error', 'Referința dată nu coincide cu cea a transferului inițiat.');
  end if;

  begin
    update public.affiliate_payouts
       set status = 'paid',
           payment_reference = coalesce(payment_reference, wise_transfer_id::text)
     where id = p_id;
  exception when check_violation then
    -- Invariantul anti-supraplată (106): clawback după draft → plata blocată.
    get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text;
    return jsonb_build_object('ok', false, 'reason', coalesce(v_hint, 'check_violation'),
      'status', v_p.status, 'error', v_msg);
  end;

  perform public.log_platform_action('founder', null, 'mark_payout_paid',
    jsonb_build_object('payout_id', p_id, 'from', v_p.status, 'to', 'paid',
                       'payment_method', v_p.payment_method,
                       'payment_reference', coalesce(v_p.payment_reference, v_p.wise_transfer_id::text)));
  return jsonb_build_object('ok', true, 'status', 'paid');
end$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- D7. Rularea MANUALĂ a batch-ului (Netlify mort ⇒ altfel niciun draft).
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.admin_run_payout_batch(p_period_month date)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_res jsonb;
begin
  if not public.is_platform_admin() then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Acces interzis', hint = 'not_platform_admin';
  end if;
  if p_period_month is null or p_period_month <> date_trunc('month', p_period_month)::date then
    return jsonb_build_object('ok', false, 'reason', 'invalid_period',
      'error', 'Perioada trebuie să fie prima zi a unei luni.');
  end if;
  -- O perioadă din viitor ar eticheta greșit banii de azi (aceeași lună ca JS:
  -- Europe/Bucharest).
  if p_period_month > date_trunc('month', now() at time zone 'Europe/Bucharest')::date then
    return jsonb_build_object('ok', false, 'reason', 'future_period',
      'error', 'Perioada nu poate fi în viitor.');
  end if;

  v_res := public.run_affiliate_payout_batch(p_period_month);

  perform public.log_platform_action('founder', null, 'run_payout_batch',
    jsonb_build_object('period', p_period_month, 'result', v_res));
  return v_res;
end$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- F. admin_list_payouts — 186 + referința generică + profilul de plată.
--    Întoarce jsonb: cheile noi nu schimbă tipul de retur (fără DROP).
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.admin_list_payouts()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  -- mig 294: același contract de refuz ca RPC-urile de tranziție (42501 +
  -- hint stabil), nu P0001 generic — lista poartă acum IBAN-uri.
  if not public.is_platform_admin() then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Acces interzis', hint = 'not_platform_admin';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',                 ap.id,
             'affiliate_id',       ap.affiliate_id,
             'affiliate_email',    p.email,
             'status',             ap.status,
             'gross_cents',        ap.gross_cents,
             'currency',           ap.currency,
             'invoice_number',     ap.invoice_number,
             'wise_transfer_id',   ap.wise_transfer_id,
             'failure_reason',     ap.failure_reason,
             'paid_at',            ap.paid_at,
             'created_at',         ap.created_at,
             -- mig 294 (la FINAL): ciclul de plată + profilul de plată.
             'period_month',       ap.period_month,
             'invoice_matched_at', ap.invoice_matched_at,
             'payment_method',     ap.payment_method,
             'payment_reference',  coalesce(ap.payment_reference, ap.wise_transfer_id::text),
             'updated_at',         ap.updated_at,
             'payee_name',         pp.beneficiary_name,
             'payee_legal_form',   pp.legal_form,
             'payee_cui',          pp.cui,
             'payee_iban',         pp.iban,
             'payee_profile_updated_at', pp.updated_at
           ) order by ap.created_at desc)
      from public.affiliate_payouts ap
      join public.affiliates a on a.id = ap.affiliate_id
      join public.profiles  p on p.id = a.profile_id
      left join public.affiliate_payout_profile pp on pp.affiliate_id = ap.affiliate_id
  ), '[]'::jsonb);
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Privilegii — EXPLICIT per rol (default privileges Supabase re-acordă EXECUTE
-- pe funcțiile NOI lui service_role/anon/authenticated).
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare fn text;
begin
  foreach fn in array array[
    'admin_payout_request_invoice(uuid)',
    'admin_payout_match_invoice(uuid, text)',
    'admin_payout_start_transfer(uuid, text, text)',
    'admin_payout_hold(uuid, text)',
    'admin_payout_mark_failed(uuid, text)',
    'admin_payout_cancel(uuid, text, boolean)',
    'admin_mark_payout_paid(uuid, text)',
    'admin_run_payout_batch(date)',
    'admin_list_payouts()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

comment on function public.admin_mark_payout_paid(uuid, text) is
  'mig 294 (lanț 186→193→294): processing|on_hold → paid, orice metodă cu referință; p_payment_reference e o confirmare (trebuie să coincidă). Gate is_platform_admin, audit.';
comment on function public.admin_run_payout_batch(date) is
  'mig 294: rularea MANUALĂ a run_affiliate_payout_batch de către fondator (Netlify mort ⇒ singura cale). Idempotent per (afiliat, perioadă, monedă) + lacăt single-flight în batch.';

-- ═════════════════════════════════════════════════════════════════════════════
-- Asserții fail-closed (centură la aplicare; acoperirea permanentă e PF1–PF12)
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_src text;
  fn    text;
  v_n   int;
begin
  -- Fiecare RPC de fondator: DEFINER, pg_temp, gate în corp, fără EXECUTE
  -- pentru anon/service_role, cu EXECUTE pentru authenticated.
  foreach fn in array array[
    'admin_payout_request_invoice(uuid)',
    'admin_payout_match_invoice(uuid, text)',
    'admin_payout_start_transfer(uuid, text, text)',
    'admin_payout_hold(uuid, text)',
    'admin_payout_mark_failed(uuid, text)',
    'admin_payout_cancel(uuid, text, boolean)',
    'admin_mark_payout_paid(uuid, text)',
    'admin_run_payout_batch(date)',
    'admin_list_payouts()'
  ] loop
    select p.prosrc into v_src from pg_proc p
     where p.oid = to_regprocedure('public.' || fn) and p.prosecdef
       and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%pg_temp%');
    if v_src is null then
      raise exception 'mig 294: % lipsește / nu e DEFINER cu pg_temp', fn; end if;
    if position('is_platform_admin()' in v_src) = 0 then
      raise exception 'mig 294: % nu are gate-ul is_platform_admin', fn; end if;
    if has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
       or has_function_privilege('service_role', 'public.' || fn, 'EXECUTE')
       or not has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE') then
      raise exception 'mig 294: grant-uri greșite pe %', fn; end if;
  end loop;

  -- O SINGURĂ semnătură pentru admin_mark_payout_paid (anti PGRST203).
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_mark_payout_paid';
  if v_n <> 1 then
    raise exception 'mig 294: admin_mark_payout_paid are % semnături (se aștepta 1)', v_n; end if;
  select p.prosrc into v_src from pg_proc p
   where p.oid = 'public.admin_mark_payout_paid(uuid, text)'::regprocedure;
  if v_src ~ 'coalesce\(p_' then
    raise exception 'mig 294: admin_mark_payout_paid conține coalesce pe un parametru text (clasa bug-ului din 193)'; end if;

  -- O SINGURĂ semnătură pentru admin_payout_cancel (anti PGRST203) + garda
  -- anti plată-dublă pe failed-cu-referință.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_payout_cancel';
  if v_n <> 1 then
    raise exception 'mig 294: admin_payout_cancel are % semnături (se aștepta 1)', v_n; end if;
  select p.prosrc into v_src from pg_proc p
   where p.oid = 'public.admin_payout_cancel(uuid, text, boolean)'::regprocedure;
  if position('money_return_unconfirmed' in v_src) = 0
     or position('p_money_returned is not true' in v_src) = 0 then
    raise exception 'mig 294: admin_payout_cancel a pierdut garda money_return_unconfirmed'; end if;

  -- Trigger-ul: referința generică + imuabilitatea.
  select p.prosrc into v_src from pg_proc p
   where p.oid = 'public.fn_affiliate_payout_transition()'::regprocedure;
  if position('processing_requires_payment_reference' in v_src) = 0
     or position('payment_reference_immutable' in v_src) = 0
     or position('invalid_payout_transition' in v_src) = 0 then
    raise exception 'mig 294: trigger-ul de tranziții a pierdut o gardă'; end if;
  if has_function_privilege('anon', 'public.fn_affiliate_payout_transition()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.fn_affiliate_payout_transition()', 'EXECUTE') then
    raise exception 'mig 294: funcția de trigger e apelabilă prin /rpc (RP13)'; end if;

  -- Batch-ul: invariantele moștenite (106/107/183/190) + lacătul.
  select p.prosrc into v_src from pg_proc p
   where p.oid = 'public.run_affiliate_payout_batch(date, bigint)'::regprocedure;
  if position('pg_try_advisory_xact_lock' in v_src) = 0
     or position('jsonb_array_length(v_errors) = 0' in v_src) = 0
     or position('on conflict (affiliate_id, period_month, currency) do nothing' in v_src) = 0
     or position('payment_reference is not null' in v_src) = 0
     or position('exception when others then' in v_src) = 0 then
    raise exception 'mig 294: run_affiliate_payout_batch a pierdut un invariant (lacăt / ok dinamic / idempotență / angajare / izolare)'; end if;
  if has_function_privilege('authenticated', 'public.run_affiliate_payout_batch(date, bigint)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.run_affiliate_payout_batch(date, bigint)', 'EXECUTE') then
    raise exception 'mig 294: grant-urile batch-ului s-au schimbat'; end if;

  -- Batch-ul RĂMÂNE în denylist-ul pg_cron (vezi antet) — CJ4 neatins.
  if not exists (select 1 from public.pg_cron_janitor_denylist() where fn_name = 'run_affiliate_payout_batch') then
    raise exception 'mig 294: run_affiliate_payout_batch a ieșit din denylist fără mutarea pe pg_cron'; end if;

  -- upsert_payout_profile: gate-urile vechi + cele noi.
  select p.prosrc into v_src from pg_proc p
   where p.oid = 'public.upsert_payout_profile(text, text, text, text)'::regprocedure;
  if position('affiliate_not_active' in v_src) = 0
     or position('iban_is_valid' in v_src) = 0
     or position('payout_in_progress' in v_src) = 0
     or position('log_platform_action' in v_src) = 0 then
    raise exception 'mig 294: upsert_payout_profile a pierdut un gate (status 190 / IBAN / blocare / audit)'; end if;

  -- IBAN: control pozitiv ȘI negativ pe helper.
  if not public.iban_is_valid('RO49AAAA1B31007593840000')
     or not public.iban_is_valid('DE89 3704 0044 0532 0130 00')
     or public.iban_is_valid('RO49BBBB1B31007593840000')
     or public.iban_is_valid('RO49AAAA1B3100759384000') then
    raise exception 'mig 294: iban_is_valid dă rezultate greșite pe vectorii de control'; end if;
  if has_function_privilege('anon', 'public.iban_is_valid(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.iban_is_valid(text)', 'EXECUTE') then
    raise exception 'mig 294: helper-ul iban_is_valid e apelabil de un rol client'; end if;

  raise notice 'mig 294: fluxul de payout cap-coadă OK';
end $$;

commit;
