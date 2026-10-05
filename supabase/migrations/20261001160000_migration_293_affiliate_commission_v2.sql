-- mig 293 — Afiliere v2: COMISIONUL (decizia fondatorului, docs/AFFILIATE_PROGRAM.md §3.2)
-- ─────────────────────────────────────────────────────────────────────────────
-- Lanțuri: process_affiliate_invoice_paid 097b→099→**293** (aceeași semnătură de
-- 10 argumente → create or replace), process_affiliate_refund 099→**293**
-- (aceeași semnătură). capture_affiliate_attribution (100) NU se atinge:
-- instantaneul procentelor se pune printr-un trigger BEFORE INSERT pe tabelă,
-- deci acoperă ORICE scriitor de atribuiri, prezent sau viitor.
--
-- (1) Comision pe TOATE planurile plătite (starter/growth/pro/enterprise).
--     Gate-ul din 099 (doar pro/enterprise) era etichetat „regula de aur", dar
--     regula de aur privește feature-urile care ating plăți/bon fiscal, nu
--     comisionul agentului — decizie EXPLICITĂ de fondator (D2). `free`, plan
--     necunoscut/NULL și facturile de 0 lei rămân sărite (fail-closed).
--
-- (2) Setup-ul devine CÂȘTIGAT abia la a DOUA factură plătită (amount_paid > 0)
--     pe atribuire. Ledger-ul e WORM (097: UPDATE/DELETE interzise), deci nu
--     există „setup neplătibil care devine plătibil": prima factură se
--     CONSEMNEAZĂ pe atribuire (`first_paid_*`), iar rândul `setup` se scrie la
--     a doua factură — cu baza primei facturi (net de refund-urile ei de până
--     atunci), cu stripe_event_id / stripe_invoice_id ALE PRIMEI facturi (deci
--     clawback-ul unui refund ulterior pe prima factură îl găsește, iar cascada
--     lui nu se ciocnește de cascada recurring-ului din același eveniment pe
--     `uq_affiliate_ledger_event_leg`). Hold-urile rămân 60 (setup) / 14
--     (recurring) zile. Un rând care NU există nu poate fi plătit, deci
--     v_affiliate_payable / batch-ul de payout / dashboard-ul nu se ating.
--     Un client care pleacă după prima lună lasă setup-ul NEscris.
--
-- (3) Procentele sunt INSTANTANEU pe atribuire (`snap_*`), completate la
--     creare (trigger) sau la primul comision (fallback), backfill = valorile
--     curente. Înainte, `admin_apply_defaults_to_all_affiliates` (188) și
--     `admin_set_affiliate_commission` (188) rescriau RETROACTIV comisionul
--     tuturor clienților deja aduși. Acum se aplică doar atribuirilor NOI.
--
-- (4) Clawback: fiecare storno e limitat la RESTUL disponibil al comisionului
--     (credit + stornările lui existente), sub lacăt pe atribuire → refund
--     parțial + dispută (sau două refund-uri concurente) nu depășesc 100%.
--     Proporția se calculează pe BAZA comisionului (`base_cents`), nu pe
--     charge — pentru setup-ul cu bază netă de refund-uri anterioare, charge-ul
--     ar sub-storna. Webhook-ul trimite acum `dispute.amount` ca bază a
--     disputei (nu `charge.amount`). Un refund pe PRIMA factură înainte de a
--     doua se consemnează în `first_paid_refunds` (jsonb pe refund_id →
--     idempotent la reluarea listei de refund-uri) și scade baza setup-ului;
--     același refund reluat DUPĂ scrierea setup-ului nu se mai stornează o
--     dată (e deja în bază).
--
-- (5) Două facturi în aceeași period_month (ciclu + prorata la upgrade):
--     `on conflict (stripe_event_id, leg)` nu acoperea
--     `uq_affiliate_ledger_recurring_period` (097) → excepție → webhook 500 →
--     retry ~3 zile. Acum `on conflict do nothing` FĂRĂ țintă: a doua factură
--     din lună nu primește recurring (skip `period_already_credited`). Plafonul
--     de 12 se numără SUB pg_advisory_xact_lock per atribuire (două facturi
--     concurente nu mai pot trece amândouă de plafon).
--
-- (6) `set_affiliate_attribution_status(uuid, text, text)` — DEFINER, doar
--     service_role: o atribuire NE-terminală → canceled/refunded/expired, motiv
--     obligatoriu, rând în audit_log. Webhook-ul îl cheamă DOAR la sfârșitul
--     abonamentului (`customer.subscription.deleted` → `canceled`). NU la
--     refund total / dispută pierdută / plată eșuată terminal pe UNA dintre
--     facturi: terminal nu se mai poate reactiva, deci un refund de bunăvoință
--     pe o lună ar fi stins TOATE comisioanele viitoare ale unui client care
--     rămâne abonat (recenzie pe #286) — banii acelei facturi se recuperează
--     prin clawback, iar abonamentul care chiar se încheie ajunge oricum în
--     `subscription.deleted` (inclusiv după dunning-ul eșuat). Poarta din 193
--     (`has_partner_access` exclude stările terminale) devine VIE: până acum
--     nicio atribuire nu ieșea vreodată din `active`.
--
-- Idempotența la nivel de FACTURĂ (nou): o factură deja comisionată pe
-- atribuire (rând setup/recurring cu același invoice sau event) întoarce
-- `replay`. Fără ea, după ce setup-ul se scrie cu event-ul PRIMEI facturi, o
-- reluare a acelui event ar fi intrat pe ramura recurring cu cheia
-- (event, 'recurring') liberă → comision dublu.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Coloane noi pe affiliate_attributions
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.affiliate_attributions
  add column if not exists snap_setup_bps            int,
  add column if not exists snap_recurring_bps        int,
  add column if not exists snap_cascade_bps          int,
  add column if not exists snap_recurring_cap_months int,
  add column if not exists commission_snapshot_at    timestamptz,
  add column if not exists first_paid_invoice_id     text,
  add column if not exists first_paid_event_id       text,
  add column if not exists first_paid_amount_cents   bigint,
  add column if not exists first_paid_currency       public.affiliate_currency,
  add column if not exists first_paid_event_created_at timestamptz,
  add column if not exists first_paid_refunds        jsonb not null default '{}'::jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint
                  where conname = 'affiliate_attributions_snap_bps_check') then
    alter table public.affiliate_attributions
      add constraint affiliate_attributions_snap_bps_check check (
            (snap_setup_bps     is null or snap_setup_bps     between 0 and 10000)
        and (snap_recurring_bps is null or snap_recurring_bps between 0 and 10000)
        and (snap_cascade_bps   is null or snap_cascade_bps   between 0 and 10000)
        and (snap_recurring_cap_months is null or snap_recurring_cap_months between 0 and 120));
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'affiliate_attributions_first_paid_check') then
    alter table public.affiliate_attributions
      add constraint affiliate_attributions_first_paid_check check (
            (first_paid_amount_cents is null or first_paid_amount_cents > 0)
        and jsonb_typeof(first_paid_refunds) = 'object');
  end if;
end $$;

comment on column public.affiliate_attributions.snap_setup_bps is
  'mig 293: instantaneul procentului de setup la crearea atribuirii (sau la primul comision). Calculul îl citește pe acesta, nu affiliates.setup_bps.';
comment on column public.affiliate_attributions.snap_cascade_bps is
  'mig 293: cascade_bps al PĂRINTELUI la crearea atribuirii (NULL = fără părinte atunci; se completează la primul comision cu cascadă).';
comment on column public.affiliate_attributions.first_paid_invoice_id is
  'mig 293: prima factură plătită (>0) pe atribuire. Setup-ul se scrie abia la a DOUA, cu baza acesteia.';
comment on column public.affiliate_attributions.first_paid_refunds is
  'mig 293: refund-urile PRIMEI facturi încasate înainte de scrierea setup-ului {refund_id: cents} — scad baza setup-ului; idempotent pe cheie.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Trigger: instantaneul procentelor la crearea atribuirii
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_affiliate_attribution_snapshot()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_aff record; v_parent_cascade int;
begin
  select a.setup_bps, a.recurring_bps, a.recurring_cap_months, a.parent_affiliate_id
    into v_aff
    from public.affiliates a where a.id = NEW.affiliate_id;
  if found then
    if v_aff.parent_affiliate_id is not null then
      select p.cascade_bps into v_parent_cascade
        from public.affiliates p where p.id = v_aff.parent_affiliate_id;
    end if;
    -- Completează DOAR ce lipsește: un scriitor care fixează explicit
    -- instantaneul (ex. un import) nu e suprascris.
    NEW.snap_setup_bps            := coalesce(NEW.snap_setup_bps, v_aff.setup_bps);
    NEW.snap_recurring_bps        := coalesce(NEW.snap_recurring_bps, v_aff.recurring_bps);
    NEW.snap_recurring_cap_months := coalesce(NEW.snap_recurring_cap_months, v_aff.recurring_cap_months);
    NEW.snap_cascade_bps          := coalesce(NEW.snap_cascade_bps, v_parent_cascade);
    NEW.commission_snapshot_at    := coalesce(NEW.commission_snapshot_at, now());
  end if;
  return NEW;
end$$;

revoke all on function public.fn_affiliate_attribution_snapshot()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_affiliate_attribution_snapshot on public.affiliate_attributions;
create trigger trg_affiliate_attribution_snapshot
  before insert on public.affiliate_attributions
  for each row execute function public.fn_affiliate_attribution_snapshot();

-- Backfill = valorile CURENTE (cea mai bună informație: procentele din 188 nu
-- au istoric; producția are 0 afiliați la 28 sept 2026, deci e no-op acolo).
update public.affiliate_attributions aa
   set snap_setup_bps            = coalesce(aa.snap_setup_bps, a.setup_bps),
       snap_recurring_bps        = coalesce(aa.snap_recurring_bps, a.recurring_bps),
       snap_recurring_cap_months = coalesce(aa.snap_recurring_cap_months, a.recurring_cap_months),
       snap_cascade_bps          = coalesce(aa.snap_cascade_bps, p.cascade_bps),
       commission_snapshot_at    = coalesce(aa.commission_snapshot_at, now())
  from public.affiliates a
  left join public.affiliates p on p.id = a.parent_affiliate_id
 where a.id = aa.affiliate_id
   and (aa.snap_setup_bps is null or aa.snap_recurring_bps is null
        or aa.snap_recurring_cap_months is null or aa.commission_snapshot_at is null
        or (aa.snap_cascade_bps is null and p.id is not null));

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. process_affiliate_invoice_paid — stare finală (099 + v2)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.process_affiliate_invoice_paid(
  p_event_id               text,
  p_stripe_customer_id     text,
  p_stripe_subscription_id text,
  p_stripe_invoice_id      text,
  p_billing_reason         text,     -- doar informativ (audit)
  p_amount_paid_cents      bigint,
  p_currency               text,
  p_period_month           date,
  p_event_created_at       timestamptz,
  p_plan                   text       -- planul EFECTIV facturat (din price.id)
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_attr_id          uuid;
  v_attr             public.affiliate_attributions%rowtype;
  v_aff              public.affiliates%rowtype;
  v_parent           public.affiliates%rowtype;
  v_has_parent       boolean := false;
  v_currency         public.affiliate_currency;
  v_prev             record;
  v_setup_bps        int;
  v_recurring_bps    int;
  v_cap              int;
  v_cascade_bps      int;
  v_setup_exists     boolean;
  v_setup_base       bigint;
  v_setup_cents      bigint;
  v_setup_id         uuid;
  v_setup_hold       timestamptz;
  v_commission_cents bigint;
  v_ledger_id        uuid;
  v_hold_until       timestamptz;
  v_recurring_count  int;
  v_cascade_cents    bigint;
  v_setup_info       jsonb := null;
begin
  if p_amount_paid_cents is null or p_amount_paid_cents <= 0 then
    return jsonb_build_object('ok', true, 'skipped', 'zero_amount');
  end if;

  -- (1) Toate planurile PLĂTITE. Fail-closed: free / necunoscut / NULL → skip.
  if p_plan is null or p_plan not in ('starter', 'growth', 'pro', 'enterprise') then
    return jsonb_build_object('ok', true, 'skipped', 'not_paid_plan', 'plan', p_plan);
  end if;

  begin
    v_currency := p_currency::public.affiliate_currency;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'unsupported_currency', 'currency', p_currency);
  end;

  select id into v_attr_id
    from public.affiliate_attributions
   where stripe_customer_id = p_stripe_customer_id
     and status in ('pending', 'active')
   order by captured_at
   limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'skipped', 'no_attribution');
  end if;

  -- (5) Serializare per atribuire: plafonul de 12, „prima/a doua factură" și
  -- clawback-urile (aceeași cheie, process_affiliate_refund) văd o stare stabilă.
  perform pg_advisory_xact_lock(hashtextextended('menuvia.affiliate_attribution:' || v_attr_id::text, 0));

  select * into v_attr from public.affiliate_attributions where id = v_attr_id;
  if not found or v_attr.status not in ('pending', 'active') then
    return jsonb_build_object('ok', true, 'skipped', 'attribution_terminal');
  end if;

  select * into v_aff from public.affiliates where id = v_attr.affiliate_id;
  if not found or v_aff.status <> 'active' then
    return jsonb_build_object('ok', true, 'skipped', 'affiliate_inactive');
  end if;

  -- Idempotență la nivel de FACTURĂ / EVENIMENT (vezi antetul).
  select l.id, l.leg, l.amount_cents into v_prev
    from public.affiliate_ledger l
   where l.attribution_id = v_attr.id
     and l.leg in ('setup', 'recurring')
     and ((p_stripe_invoice_id is not null and l.stripe_invoice_id = p_stripe_invoice_id)
          or l.stripe_event_id = p_event_id)
   order by (l.leg = 'recurring') desc, l.created_at
   limit 1;
  if found then
    return jsonb_build_object('ok', true, 'replay', true, 'ledger_id', v_prev.id,
                              'leg', v_prev.leg, 'commission_cents', v_prev.amount_cents);
  end if;
  if v_attr.first_paid_invoice_id is not null
     and ((p_stripe_invoice_id is not null and v_attr.first_paid_invoice_id = p_stripe_invoice_id)
          or v_attr.first_paid_event_id = p_event_id) then
    return jsonb_build_object('ok', true, 'replay', true, 'deferred', 'setup_awaits_second_invoice',
                              'commission_cents', 0);
  end if;

  -- (3) Instantaneul procentelor (fallback = valorile curente, persistate acum).
  if v_aff.parent_affiliate_id is not null then
    select * into v_parent from public.affiliates where id = v_aff.parent_affiliate_id;
    v_has_parent := found;
  end if;
  v_setup_bps     := coalesce(v_attr.snap_setup_bps, v_aff.setup_bps);
  v_recurring_bps := coalesce(v_attr.snap_recurring_bps, v_aff.recurring_bps);
  v_cap           := coalesce(v_attr.snap_recurring_cap_months, v_aff.recurring_cap_months);
  v_cascade_bps   := coalesce(v_attr.snap_cascade_bps,
                              case when v_has_parent then v_parent.cascade_bps end);

  update public.affiliate_attributions
     set snap_setup_bps            = v_setup_bps,
         snap_recurring_bps        = v_recurring_bps,
         snap_recurring_cap_months = v_cap,
         snap_cascade_bps          = v_cascade_bps,
         commission_snapshot_at    = coalesce(commission_snapshot_at, now()),
         status                    = 'active',
         stripe_subscription_id    = coalesce(stripe_subscription_id, p_stripe_subscription_id)
   where id = v_attr.id
     and (snap_setup_bps is null or snap_recurring_bps is null
          or snap_recurring_cap_months is null
          or snap_cascade_bps is distinct from v_cascade_bps
          or status = 'pending' or stripe_subscription_id is null);

  select exists(select 1 from public.affiliate_ledger
                 where attribution_id = v_attr.id and leg = 'setup')
    into v_setup_exists;

  if not v_setup_exists then
    if v_attr.first_paid_invoice_id is null then
      -- (2) PRIMA factură plătită: se consemnează, nu se comisionează încă.
      update public.affiliate_attributions
         set first_paid_invoice_id       = coalesce(p_stripe_invoice_id, p_event_id),
             first_paid_event_id         = p_event_id,
             first_paid_amount_cents     = p_amount_paid_cents,
             first_paid_currency         = v_currency,
             first_paid_event_created_at = p_event_created_at
       where id = v_attr.id;
      return jsonb_build_object('ok', true, 'deferred', 'setup_awaits_second_invoice',
                                'leg', null, 'commission_cents', 0);
    end if;

    -- (2) A DOUA factură plătită: setup-ul pe baza primei (netă de refund-uri).
    v_setup_base := greatest(
      v_attr.first_paid_amount_cents
        - coalesce((select sum((e.value)::bigint)
                      from jsonb_each_text(v_attr.first_paid_refunds) e), 0),
      0);
    v_setup_cents := (v_setup_base * v_setup_bps) / 10000;
    v_setup_hold  := now() + interval '60 days';

    insert into public.affiliate_ledger
      (affiliate_id, attribution_id, leg, period_month, base_cents, commission_bps,
       amount_cents, currency, hold_until, stripe_event_id, stripe_invoice_id, stripe_event_created_at)
    values
      (v_aff.id, v_attr.id, 'setup', null, v_setup_base, v_setup_bps,
       v_setup_cents, coalesce(v_attr.first_paid_currency, v_currency), v_setup_hold,
       v_attr.first_paid_event_id, v_attr.first_paid_invoice_id,
       coalesce(v_attr.first_paid_event_created_at, p_event_created_at))
    on conflict do nothing
    returning id into v_setup_id;

    if v_setup_id is not null and v_has_parent and v_parent.status = 'active'
       and v_setup_cents > 0 and coalesce(v_cascade_bps, 0) > 0 then
      v_cascade_cents := (v_setup_cents * v_cascade_bps) / 10000;
      if v_cascade_cents > 0 then
        insert into public.affiliate_ledger
          (affiliate_id, attribution_id, source_ledger_id, leg, base_cents, commission_bps,
           amount_cents, currency, hold_until, stripe_event_id, stripe_invoice_id, stripe_event_created_at)
        values
          (v_parent.id, v_attr.id, v_setup_id, 'cascade', v_setup_cents, v_cascade_bps,
           v_cascade_cents, coalesce(v_attr.first_paid_currency, v_currency), v_setup_hold,
           v_attr.first_paid_event_id, v_attr.first_paid_invoice_id,
           coalesce(v_attr.first_paid_event_created_at, p_event_created_at))
        on conflict do nothing;
      end if;
    end if;

    v_setup_info := jsonb_build_object('setup_ledger_id', v_setup_id,
                                       'setup_commission_cents', v_setup_cents,
                                       'setup_base_cents', v_setup_base);
  end if;

  -- Recurring pe factura CURENTĂ (a doua și următoarele), plafonat sub lacăt.
  select count(*) into v_recurring_count
    from public.affiliate_ledger
   where attribution_id = v_attr.id and leg = 'recurring';
  if v_recurring_count >= v_cap then
    return jsonb_build_object('ok', true, 'skipped', 'recurring_cap_reached', 'cap', v_cap)
           || coalesce(v_setup_info, '{}'::jsonb);
  end if;

  v_commission_cents := (p_amount_paid_cents * v_recurring_bps) / 10000;
  v_hold_until       := now() + interval '14 days';

  -- (5) FĂRĂ țintă: acoperă și uq_affiliate_ledger_recurring_period (097),
  -- nu doar (stripe_event_id, leg).
  insert into public.affiliate_ledger
    (affiliate_id, attribution_id, leg, period_month, base_cents, commission_bps,
     amount_cents, currency, hold_until, stripe_event_id, stripe_invoice_id, stripe_event_created_at)
  values
    (v_aff.id, v_attr.id, 'recurring', p_period_month, p_amount_paid_cents, v_recurring_bps,
     v_commission_cents, v_currency, v_hold_until, p_event_id, p_stripe_invoice_id, p_event_created_at)
  on conflict do nothing
  returning id into v_ledger_id;

  if v_ledger_id is null then
    return jsonb_build_object('ok', true, 'skipped', 'period_already_credited',
                              'period_month', p_period_month)
           || coalesce(v_setup_info, '{}'::jsonb);
  end if;

  if v_has_parent and v_parent.status = 'active'
     and v_commission_cents > 0 and coalesce(v_cascade_bps, 0) > 0 then
    v_cascade_cents := (v_commission_cents * v_cascade_bps) / 10000;
    if v_cascade_cents > 0 then
      insert into public.affiliate_ledger
        (affiliate_id, attribution_id, source_ledger_id, leg, base_cents, commission_bps,
         amount_cents, currency, hold_until, stripe_event_id, stripe_invoice_id, stripe_event_created_at)
      values
        (v_parent.id, v_attr.id, v_ledger_id, 'cascade', v_commission_cents, v_cascade_bps,
         v_cascade_cents, v_currency, v_hold_until, p_event_id, p_stripe_invoice_id, p_event_created_at)
      on conflict do nothing;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'ledger_id', v_ledger_id, 'leg', 'recurring',
                            'commission_cents', v_commission_cents)
         || coalesce(v_setup_info, '{}'::jsonb);
end$$;

revoke all on function public.process_affiliate_invoice_paid(
  text, text, text, text, text, bigint, text, date, timestamptz, text
) from public, anon, authenticated, service_role;
grant execute on function public.process_affiliate_invoice_paid(
  text, text, text, text, text, bigint, text, date, timestamptz, text
) to service_role;

comment on function public.process_affiliate_invoice_paid(
  text, text, text, text, text, bigint, text, date, timestamptz, text
) is
  'mig 293: comision la invoice.paid pe TOATE planurile plătite; setup câștigat la a DOUA factură plătită (baza = prima, netă de refund-uri); procente din instantaneul atribuirii; recurring plafonat sub lacăt per atribuire; a doua factură din aceeași lună = skip (on conflict fără țintă).';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. process_affiliate_refund — stare finală (099 + rest disponibil)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.process_affiliate_refund(
  p_event_id            text,
  p_stripe_invoice_id   text,
  p_charge_amount_cents bigint,
  p_refund_id           text,
  p_refund_amount_cents bigint,
  p_event_created_at    timestamptz
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_orig      record;
  v_casc      record;
  v_attr      public.affiliate_attributions%rowtype;
  v_denom     bigint;
  v_remaining bigint;
  v_claw      bigint;
  v_claw_id   uuid;
  v_count     int := 0;
  v_any       boolean := false;
  v_pre       int := 0;
begin
  if p_charge_amount_cents is null or p_charge_amount_cents <= 0
     or p_refund_amount_cents is null or p_refund_amount_cents <= 0
     or p_stripe_invoice_id is null or p_refund_id is null then
    return jsonb_build_object('ok', true, 'skipped', 'bad_input');
  end if;

  for v_orig in
    select * from public.affiliate_ledger
     where stripe_invoice_id = p_stripe_invoice_id
       and leg in ('setup', 'recurring')
       and amount_cents > 0
     order by created_at, id
  loop
    v_any := true;
    v_claw_id := null;
    perform pg_advisory_xact_lock(hashtextextended(
      'menuvia.affiliate_attribution:' || coalesce(v_orig.attribution_id, v_orig.id)::text, 0));

    -- Refund-ul primei facturi încasat ÎNAINTE de scrierea setup-ului e deja
    -- scăzut din baza setup-ului (first_paid_refunds) — reluarea lui de către
    -- refunds.list la un refund ulterior nu se mai stornează o dată.
    if v_orig.leg = 'setup' and v_orig.attribution_id is not null then
      select * into v_attr from public.affiliate_attributions where id = v_orig.attribution_id;
      if found and v_attr.first_paid_invoice_id = p_stripe_invoice_id
         and v_attr.first_paid_refunds ? p_refund_id then
        continue;
      end if;
    end if;

    -- Proporția pe BAZA comisionului (fallback charge pentru rânduri fără bază).
    v_denom := coalesce(nullif(v_orig.base_cents, 0), p_charge_amount_cents);

    -- (4) Limitat la RESTUL disponibil (credit + stornările lui existente).
    select v_orig.amount_cents + coalesce(sum(r.amount_cents), 0) into v_remaining
      from public.affiliate_ledger r where r.reverses_ledger_id = v_orig.id;
    v_claw := least(v_remaining, (v_orig.amount_cents * p_refund_amount_cents) / v_denom);

    if v_claw > 0 then
      -- stripe_event_id rămâne NULL pe clawback (099): idempotency = (refund_id, reversat).
      insert into public.affiliate_ledger
        (affiliate_id, attribution_id, reverses_ledger_id, leg, base_cents, amount_cents,
         currency, hold_until, stripe_invoice_id, stripe_refund_id, stripe_event_created_at)
      values
        (v_orig.affiliate_id, v_orig.attribution_id, v_orig.id, 'clawback', 0, -v_claw,
         v_orig.currency, now(), p_stripe_invoice_id, p_refund_id, p_event_created_at)
      on conflict (stripe_refund_id, reverses_ledger_id)
        where leg = 'clawback' and stripe_refund_id is not null do nothing
      returning id into v_claw_id;
      if v_claw_id is not null then v_count := v_count + 1; end if;
    end if;

    -- Cascada părintelui, cu același plafon pe restul ei.
    for v_casc in
      select * from public.affiliate_ledger
       where source_ledger_id = v_orig.id and leg = 'cascade' and amount_cents > 0
    loop
      select v_casc.amount_cents + coalesce(sum(r.amount_cents), 0) into v_remaining
        from public.affiliate_ledger r where r.reverses_ledger_id = v_casc.id;
      v_claw := least(v_remaining, (v_casc.amount_cents * p_refund_amount_cents) / v_denom);
      if v_claw > 0 then
        insert into public.affiliate_ledger
          (affiliate_id, attribution_id, reverses_ledger_id, source_ledger_id, leg, base_cents,
           amount_cents, currency, hold_until, stripe_invoice_id, stripe_refund_id, stripe_event_created_at)
        values
          (v_casc.affiliate_id, v_casc.attribution_id, v_casc.id, v_claw_id, 'clawback', 0,
           -v_claw, v_casc.currency, now(), p_stripe_invoice_id, p_refund_id, p_event_created_at)
        on conflict (stripe_refund_id, reverses_ledger_id)
          where leg = 'clawback' and stripe_refund_id is not null do nothing;
      end if;
    end loop;
  end loop;

  -- Refund pe PRIMA factură, înainte ca setup-ul să existe: scade baza setup-ului.
  if not v_any then
    for v_attr in
      select * from public.affiliate_attributions
       where first_paid_invoice_id = p_stripe_invoice_id
    loop
      perform pg_advisory_xact_lock(hashtextextended(
        'menuvia.affiliate_attribution:' || v_attr.id::text, 0));
      if not exists (select 1 from public.affiliate_ledger
                      where attribution_id = v_attr.id and leg = 'setup') then
        update public.affiliate_attributions
           set first_paid_refunds = first_paid_refunds
                 || jsonb_build_object(p_refund_id, p_refund_amount_cents)
         where id = v_attr.id
           and not (first_paid_refunds ? p_refund_id);
        v_pre := v_pre + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'clawed_back', v_count, 'refund_id', p_refund_id,
                            'pre_setup_recorded', v_pre);
end$$;

revoke all on function public.process_affiliate_refund(text, text, bigint, text, bigint, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.process_affiliate_refund(text, text, bigint, text, bigint, timestamptz)
  to service_role;

comment on function public.process_affiliate_refund(text, text, bigint, text, bigint, timestamptz) is
  'mig 293: clawback proporțional pe baza comisionului, limitat la RESTUL disponibil (refund parțial + dispută ≤ 100%), sub lacăt per atribuire; refund pe prima factură înaintea setup-ului scade baza setup-ului.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. set_affiliate_attribution_status — ieșirea din `active` (poarta 193 vie)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.set_affiliate_attribution_status(
  p_referred_profile_id uuid,
  p_status              text,
  p_reason              text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.affiliate_attributions%rowtype;
  v_new public.affiliate_attributions%rowtype;
begin
  if p_status is null or p_status not in ('canceled', 'refunded', 'expired') then
    raise exception 'Status de atribuire nepermis: %', p_status
      using errcode = '22023', hint = 'invalid_attribution_status';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Motivul schimbării de status e obligatoriu'
      using errcode = '22023', hint = 'reason_required';
  end if;

  select * into v_old from public.affiliate_attributions
   where referred_profile_id = p_referred_profile_id
   for update;
  if not found then
    return jsonb_build_object('ok', true, 'skipped', 'no_attribution');
  end if;
  -- Terminal rămâne terminal (idempotent la reluarea webhook-ului).
  if v_old.status in ('canceled', 'refunded', 'expired') then
    return jsonb_build_object('ok', true, 'skipped', 'already_terminal',
                              'status', v_old.status, 'attribution_id', v_old.id);
  end if;

  update public.affiliate_attributions
     set status = p_status::public.attribution_status
   where id = v_old.id
  returning * into v_new;

  insert into public.audit_log
    (actor_id, actor_role, table_name, operation, row_id, restaurant_id,
     old_data, new_data, changed_keys)
  values
    (auth.uid(), coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user::text),
     'affiliate_attributions', 'UPDATE', v_old.id::text, null,
     to_jsonb(v_old), to_jsonb(v_new) || jsonb_build_object('status_reason', btrim(p_reason)),
     array['status']);

  return jsonb_build_object('ok', true, 'attribution_id', v_old.id,
                            'from', v_old.status, 'to', v_new.status);
end$$;

revoke all on function public.set_affiliate_attribution_status(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.set_affiliate_attribution_status(uuid, text, text)
  to service_role;

comment on function public.set_affiliate_attribution_status(uuid, text, text) is
  'mig 293: atribuire ne-terminală → canceled/refunded/expired (doar service_role, motiv obligatoriu, audit_log). Apelat din stripe-webhook DOAR la customer.subscription.deleted (canceled) — NU la refund/dispută/plată eșuată pe o singură factură (terminal e ireversibil; acolo lucrează clawback-ul). Face vie poarta din has_partner_access (193).';

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Comentarii pe RPC-urile de fondator (188, NErecreate)
-- ═══════════════════════════════════════════════════════════════════════════
comment on function public.admin_set_affiliate_commission(uuid, int, int, int, int) is
  'mig 293: schimbă procentele afiliatului DOAR pentru atribuirile NOI — calculul citește instantaneul de pe atribuire (snap_*), fixat la crearea ei. Clienții deja aduși păstrează procentele de la atribuire.';
comment on function public.admin_apply_defaults_to_all_affiliates() is
  'mig 293: aplică defaulturile pe rândurile affiliates; efect DOAR pe atribuirile NOI (instantaneu snap_* pe atribuire). Nu mai rescrie retroactiv comisionul clienților deja aduși.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Asserții fail-closed
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare v_src text; v_n int;
begin
  -- 7a. Gate pe planuri plătite: toate patru, fără vechiul gate Plan 3.
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'process_affiliate_invoice_paid' and p.pronargs = 10;
  if v_src is null then raise exception 'mig 293: process_affiliate_invoice_paid(10) lipsește'; end if;
  if v_src not like '%''starter'', ''growth'', ''pro'', ''enterprise''%' then
    raise exception 'mig 293: gate-ul pe planuri plătite lipsește'; end if;
  if v_src like '%not_plan3%' then
    raise exception 'mig 293: gate-ul vechi Plan 3 a rămas'; end if;
  -- 7b. Lacăt per atribuire + on conflict FĂRĂ țintă pe recurring.
  if v_src not like '%pg_advisory_xact_lock%' then
    raise exception 'mig 293: lacătul per atribuire lipsește'; end if;
  if v_src like '%on conflict (stripe_event_id, leg)%' then
    raise exception 'mig 293: on conflict cu țintă (event, leg) a rămas — nu acoperă unicitatea lunară'; end if;
  -- 7c. Clawback limitat la rest.
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'process_affiliate_refund';
  if v_src not like '%least(v_remaining%' then
    raise exception 'mig 293: clawback-ul nu e limitat la rest'; end if;
  -- 7d. Doar o semnătură per RPC (anti PGRST203).
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('process_affiliate_invoice_paid', 'process_affiliate_refund',
                       'set_affiliate_attribution_status');
  if v_n <> 3 then raise exception 'mig 293: % semnături (așteptat 3)', v_n; end if;
  -- 7e. Suprafața: doar service_role; trigger-ul neexecutabil de roluri client.
  if has_function_privilege('authenticated', 'public.set_affiliate_attribution_status(uuid, text, text)', 'execute')
     or has_function_privilege('anon', 'public.set_affiliate_attribution_status(uuid, text, text)', 'execute')
     or not has_function_privilege('service_role', 'public.set_affiliate_attribution_status(uuid, text, text)', 'execute') then
    raise exception 'mig 293: set_affiliate_attribution_status trebuie să fie doar service_role'; end if;
  if has_function_privilege('authenticated', 'public.fn_affiliate_attribution_snapshot()', 'execute')
     or has_function_privilege('anon', 'public.fn_affiliate_attribution_snapshot()', 'execute') then
    raise exception 'mig 293: funcția de trigger e executabilă de roluri client (RP13)'; end if;
  -- 7f. Trigger BEFORE INSERT ROW (tgtype 7 exact).
  if not exists (select 1 from pg_trigger where tgname = 'trg_affiliate_attribution_snapshot'
                    and tgrelid = 'public.affiliate_attributions'::regclass and tgtype = 7) then
    raise exception 'mig 293: trg_affiliate_attribution_snapshot lipsește sau nu e BEFORE INSERT ROW'; end if;
  -- 7g. Backfill complet.
  if exists (select 1 from public.affiliate_attributions
              where snap_setup_bps is null or snap_recurring_bps is null
                 or snap_recurring_cap_months is null) then
    raise exception 'mig 293: backfill instantaneu incomplet'; end if;
  raise notice 'mig 293: affiliate commission v2 OK';
end $$;

commit;
