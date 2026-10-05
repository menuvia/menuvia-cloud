-- migration_295_affiliate_program_gdpr.sql
-- =============================================================================
-- Programul de afiliere: poartă de deschidere, panou cu cifre NETE, rezolvarea
-- vanity_slug și ștergerea GDPR a afiliaților / conturilor atribuite.
--
-- ── §1. Flag `affiliate_program_open` (platform_settings, mig 188) ──────────
-- Programul e ÎNGHEȚAT până la deciziile de lansare, dar `/afiliat` primea
-- cereri și le promitea un apel „în 1–2 zile". Poarta stă în DATE, nu doar în
-- UI: `register_affiliate` (lanț 097d→188→224→243→295) respinge cererile noi cu
-- `program_closed`, iar `admin_review_affiliate` (224→295, SEMNĂTURĂ NOUĂ
-- `(uuid, boolean, boolean)` — DROP+CREATE, anti PGRST203) aprobă doar cu
-- programul deschis SAU cu override EXPLICIT al fondatorului (consemnat în
-- audit). Respingerea rămâne liberă. Default FALSE (închis) — fail-closed:
-- doar valoarea JSON `true` deschide (o valoare stricată = închis).
-- Citirea publică: `get_affiliate_program_status()` — whitelist de UN câmp
-- (`open`), ca `get_affiliate_public_defaults` (189). Scrierea: fondatorul,
-- prin `admin_set_affiliate_program_open(boolean)`, cu audit.
--
-- ── §2. Panou cu cifre NETE (`get_affiliate_dashboard`, lanț 097d→110→174→
--        188→295; tipul de retur rămâne jsonb → create or replace) ─────────
-- Chei NOI, adăugate la FINAL (cele vechi neatinse — clientul vechi merge):
--   earnings.net_earned_cents   = Σ per credit max(credit + stornări, 0),
--                                 inclusiv creditele încă în hold
--   earnings.pending_net_cents  = aceeași sumă, doar creditele în hold
--   earnings.in_progress_cents  = payout-uri angajate dar neplătite
--   earnings.available_cents    = max(confirmat − angajat, 0), cu ACEEAȘI
--                                 formulă ca run_affiliate_payout_batch (190)
--   earnings.min_payout_cents   = 5000 (pragul batch-ului)
--   next_batch_date             = ziua reală a următoarei rulări (oglinda
--                                 ferestrei Job 3b din automation-cron.js)
--   program_open (ramura ne-afiliat)
-- Identitate verificabilă: net_earned = confirmed + pending_net.
--
-- ── §3. Link de referral: `resolve_referral_code(text)` ─────────────────────
-- `vanity_slug` (097:66-67) există din 097 dar NU era rezolvat nicăieri: toate
-- căutările (097c, 100, 108, 261) compară doar `referral_code`. RPC anon nou,
-- plafon global 600/15 min (ca preview_referral 261), întoarce codul CANONIC
-- doar pentru afiliați `active`. `record_affiliate_touch` și
-- `capture_affiliate_attribution` rămân NEATINSE: clientul le trimite codul
-- canonic.
--
-- ── §4. GDPR: `ON DELETE RESTRICT` pe profil blocau Art. 17 TĂCUT ───────────
-- `affiliates.profile_id` și `affiliate_attributions.referred_profile_id` sunt
-- `references profiles on delete restrict` (097:62-63, :90-91). Cascada
-- auth.users → profiles pica, iar `process_account_deletions` (283/284) prindea
-- eroarea în handler-ul per-user și REÎNCERCA LA INFINIT — contul unui afiliat
-- sau al unui owner adus de un afiliat NU se ștergea niciodată.
-- Fix: DETAȘARE înaintea `delete from auth.users`, prin
-- `erase_affiliate_identity_for_user(uuid)` (intern):
--   • afiliatul devine `closed`, `profile_id` NULL, PII golite (telefon, notă,
--     vanity, branding 236; în payout_profile CUI/IBAN/beneficiar), `erased_at`;
--   • atribuirea pierde `referred_profile_id` (tombstone `referred_erased_at`),
--     iar una ne-terminală devine `canceled` (comision oprit, 099);
--   • ledger-ul (WORM, 097) și payout-urile se PĂSTREAZĂ — legate de afiliat,
--     nu de profil; evidență fiscală.
-- Coloanele devin nullable, cu CHECK `profile IS NOT NULL OR erased_at IS NOT
-- NULL` — NULL e posibil DOAR prin ștergere. FK-urile rămân RESTRICT (o
-- ștergere pe altă cale decât procesul GDPR rămâne refuzată).
-- `process_account_deletions` (lanț 042→179→183→282→284→295): copie VERBATIM
-- din 284 + UN apel, imediat înaintea ștergerii, în aceeași subtranzacție
-- per-user (un eșec al ștergerii derulează și detașarea).
--
-- Teste: AP1–AP12 `tests/sql/affiliate_program_gdpr_assertions.sql`.
-- =============================================================================

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ═══════════════════════════════════════════════════════════════════════════
-- §1. Flag affiliate_program_open
-- ═══════════════════════════════════════════════════════════════════════════

-- Seed idempotent: ÎNCHIS. NU suprascrie o decizie deja luată de fondator.
insert into public.platform_settings (key, value)
values ('affiliate_program_open', 'false'::jsonb)
on conflict (key) do nothing;

-- Sursa UNICĂ a regulii. Doar `true` JSON deschide; lipsa rândului, `"true"`
-- string, null sau orice altceva = închis (fail-closed).
create or replace function public.affiliate_program_is_open()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select value = 'true'::jsonb from public.platform_settings
      where key = 'affiliate_program_open'),
    false)
$$;

-- Helper intern: apelat doar din RPC-uri DEFINER (proprietar postgres).
revoke all on function public.affiliate_program_is_open()
  from public, anon, authenticated, service_role;

-- Citirea publică: whitelist de UN câmp.
create or replace function public.get_affiliate_program_status()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('open', public.affiliate_program_is_open())
$$;

revoke all on function public.get_affiliate_program_status()
  from public, anon, authenticated, service_role;
grant execute on function public.get_affiliate_program_status() to anon, authenticated;

comment on function public.get_affiliate_program_status() is
  'mig 295: starea programului de afiliere (doar {open}). Public — /afiliat afișează „se redeschide" când e închis.';

-- Comutatorul fondatorului (audit old/new).
create or replace function public.admin_set_affiliate_program_open(p_open boolean)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_old boolean;
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;
  if p_open is null then
    return jsonb_build_object('ok', false, 'error', 'Valoare lipsă');
  end if;

  v_old := public.affiliate_program_is_open();

  insert into public.platform_settings (key, value, updated_at)
  values ('affiliate_program_open', to_jsonb(p_open), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

  perform public.log_platform_action('founder', null, 'set_affiliate_program_open',
    jsonb_build_object('old', v_old, 'new', p_open));

  return jsonb_build_object('ok', true, 'open', p_open);
end;
$$;

revoke all on function public.admin_set_affiliate_program_open(boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_set_affiliate_program_open(boolean) to authenticated;

-- register_affiliate — copie VERBATIM din 243 + UN delta: după ramura
-- idempotentă (cine a aplicat deja își vede starea) și înaintea oricărei
-- validări, programul închis respinge cererea nouă cu `program_closed`.
create or replace function public.register_affiliate(
  p_parent_referral_code text default null,
  p_phone                text default null,
  p_note                 text default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_existing public.affiliates;
  v_parent  public.affiliates;
  v_code    text;
  v_aff_id  uuid;
  v_try     int := 0;
  v_defaults jsonb;
  v_phone   text;
  v_note    text;
begin
  if v_uid is null then
    raise exception using errcode = 'insufficient_privilege',
      message = 'register_affiliate requires authentication';
  end if;

  -- Idempotent: dacă userul are deja o cerere/cont, întoarce-i starea.
  select * into v_existing from public.affiliates where profile_id = v_uid;
  if found then
    return jsonb_build_object('ok', true, 'already', true,
      'affiliate_id', v_existing.id, 'referral_code', v_existing.referral_code,
      'status', v_existing.status);
  end if;

  -- mig 295: programul ÎNCHIS nu primește cereri noi (poarta în DATE).
  if not public.affiliate_program_is_open() then
    return jsonb_build_object('ok', false, 'reason', 'program_closed');
  end if;

  -- Telefonul e obligatoriu: interviul de calificare e telefonic.
  v_phone := btrim(coalesce(p_phone, ''));
  if length(v_phone) < 5 or length(v_phone) > 32 then
    return jsonb_build_object('ok', false, 'reason', 'phone_required');
  end if;
  v_note := nullif(left(btrim(coalesce(p_note, '')), 1000), '');

  -- Parent opțional (sub-afiliere). Trebuie să existe, să fie ACTIV și ≠ self.
  if p_parent_referral_code is not null and btrim(p_parent_referral_code) <> '' then
    select * into v_parent from public.affiliates
     where referral_code = lower(btrim(p_parent_referral_code)) and status = 'active';
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'parent_not_found');
    end if;
    if v_parent.profile_id = v_uid then
      return jsonb_build_object('ok', false, 'reason', 'parent_is_self');
    end if;
  end if;

  -- Generează un referral_code unic (8 hex = ^[a-z0-9]{6,32}$). Retry pe coliziune.
  -- Codul există de la cerere, dar e INERT până la aprobare (atribuirea din
  -- mig 097c caută doar afiliați 'active').
  loop
    v_try := v_try + 1;
    v_code := substr(md5(gen_random_uuid()::text), 1, 8);
    exit when not exists (select 1 from public.affiliates where referral_code = v_code);
    if v_try > 10 then
      raise exception 'register_affiliate: could not generate unique referral_code';
    end if;
  end loop;

  -- Comisioanele de start = defaulturile setate de fondator (mig 188).
  select value into v_defaults from public.platform_settings
   where key = 'affiliate_commission_defaults';

  -- mig 243: cursă dublu-submit (pre-check-ul de mai sus poate rata un INSERT
  -- concurent) → handler unique_violation cu răspuns IDEMPOTENT, același
  -- pattern ca create_restaurant (mig 221). Un 23505 brut ajungea la client.
  begin
    insert into public.affiliates
      (profile_id, referral_code, parent_affiliate_id, status, phone, application_note,
       setup_bps, recurring_bps, cascade_bps, recurring_cap_months)
    values
      (v_uid, v_code, v_parent.id, 'pending', v_phone, v_note,
       coalesce((v_defaults->>'setup_bps')::int, 3000),
       coalesce((v_defaults->>'recurring_bps')::int, 1000),
       coalesce((v_defaults->>'cascade_bps')::int, 200),
       coalesce((v_defaults->>'recurring_cap_months')::int, 12))
    returning id into v_aff_id;
  exception when unique_violation then
    select * into v_existing from public.affiliates where profile_id = v_uid;
    if found then
      return jsonb_build_object('ok', true, 'already', true,
        'affiliate_id', v_existing.id, 'referral_code', v_existing.referral_code,
        'status', v_existing.status);
    end if;
    -- Nu era cursa pe profil (ex. coliziune improbabilă pe referral_code
    -- strecurată între check și insert) — propagă, clientul poate reîncerca.
    raise;
  end;

  return jsonb_build_object('ok', true, 'affiliate_id', v_aff_id,
    'referral_code', v_code, 'status', 'pending',
    'parent_affiliate_id', v_parent.id);
end$$;

revoke all on function public.register_affiliate(text, text, text)
  from public, anon, service_role;
grant execute on function public.register_affiliate(text, text, text) to authenticated;

comment on function public.register_affiliate(text, text, text) is
  $$Depune cererea de afiliere (status 'pending'): telefon obligatoriu (interviul
  de calificare e telefonic), notă opțională. Fondatorul decide prin
  admin_review_affiliate. Idempotent — un al doilea apel întoarce starea curentă,
  inclusiv sub cursă de dublu-submit (handler unique_violation, mig 243).
  mig 295: cu programul închis (affiliate_program_open) → program_closed.$$;

-- admin_review_affiliate — 224 + override. Semnătură NOUĂ → DROP + CREATE
-- (o a doua semnătură ar da PGRST203 la orice apel, ca register_affiliate 224).
drop function if exists public.admin_review_affiliate(uuid, boolean);

create or replace function public.admin_review_affiliate(
  p_affiliate_id uuid,
  p_approve      boolean,
  p_override     boolean default false
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_aff public.affiliates;
  v_new public.affiliate_status;
  v_open boolean;
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;

  select * into v_aff from public.affiliates where id = p_affiliate_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_aff.status not in ('pending', 'rejected') then
    return jsonb_build_object('ok', false, 'reason', 'not_reviewable',
      'status', v_aff.status);
  end if;

  -- mig 295: APROBAREA cere programul deschis SAU override explicit.
  -- Respingerea e liberă (închiderea programului nu are voie să lase cereri
  -- agățate fără răspuns).
  v_open := public.affiliate_program_is_open();
  if p_approve and not v_open and not coalesce(p_override, false) then
    return jsonb_build_object('ok', false, 'reason', 'program_closed');
  end if;

  v_new := case when p_approve then 'active'::public.affiliate_status
                else 'rejected'::public.affiliate_status end;

  update public.affiliates
     set status = v_new, reviewed_at = now(), reviewed_by = auth.uid()
   where id = p_affiliate_id;

  perform public.log_platform_action('founder', null, 'affiliate_reviewed',
    jsonb_build_object('affiliate_id', p_affiliate_id,
                       'old_status', v_aff.status, 'new_status', v_new,
                       'program_open', v_open,
                       'override', (p_approve and not v_open)));

  return jsonb_build_object('ok', true, 'status', v_new);
end$$;

revoke all on function public.admin_review_affiliate(uuid, boolean, boolean)
  from public, anon, service_role;
grant execute on function public.admin_review_affiliate(uuid, boolean, boolean) to authenticated;

comment on function public.admin_review_affiliate(uuid, boolean, boolean) is
  $$Founder-only: aprobă (→active) sau respinge (→rejected) o cerere pending/rejected.
  mig 295: aprobarea cere programul deschis sau p_override=true (consemnat în audit).$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- §1. Asserții fail-closed
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare v_src text;
begin
  if not exists (select 1 from public.platform_settings where key = 'affiliate_program_open') then
    raise exception 'mig 295: seed-ul affiliate_program_open lipsește';
  end if;

  -- register_affiliate: invariantele 224/243 + gate-ul nou.
  v_src := pg_get_functiondef('public.register_affiliate(text, text, text)'::regprocedure);
  if position('unique_violation' in v_src) = 0 or position('phone_required' in v_src) = 0
     or position('''pending''' in v_src) = 0 or position('platform_settings' in v_src) = 0
     or position('status = ''active''' in v_src) = 0
     or position('affiliate_program_is_open' in v_src) = 0
     or position('pg_temp' in v_src) = 0 then
    raise exception 'mig 295: register_affiliate a pierdut un invariant (243/224/188) sau gate-ul de program';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'register_affiliate') <> 1 then
    raise exception 'mig 295: register_affiliate are mai multe semnături (PGRST203)';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'admin_review_affiliate') <> 1 then
    raise exception 'mig 295: admin_review_affiliate are mai multe semnături (PGRST203)';
  end if;
  v_src := pg_get_functiondef('public.admin_review_affiliate(uuid, boolean, boolean)'::regprocedure);
  if position('is_platform_admin' in v_src) = 0 or position('log_platform_action' in v_src) = 0
     or position('affiliate_program_is_open' in v_src) = 0 then
    raise exception 'mig 295: admin_review_affiliate fără gate/audit/flag';
  end if;

  -- Suprafață.
  if not has_function_privilege('anon', 'public.get_affiliate_program_status()', 'EXECUTE') then
    raise exception 'mig 295: anon nu poate citi starea programului';
  end if;
  if has_function_privilege('anon', 'public.affiliate_program_is_open()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.affiliate_program_is_open()', 'EXECUTE') then
    raise exception 'mig 295: helperul intern e apelabil de roluri client';
  end if;
  if has_function_privilege('anon', 'public.admin_set_affiliate_program_open(boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_review_affiliate(uuid, boolean, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.register_affiliate(text, text, text)', 'EXECUTE') then
    raise exception 'mig 295: anon poate executa un RPC de afiliere';
  end if;
  if has_table_privilege('anon', 'public.platform_settings', 'SELECT') then
    raise exception 'mig 295: anon poate citi platform_settings direct';
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- §2. get_affiliate_dashboard — copie VERBATIM din 188 + chei NOI la final
--     (earnings.*net*/available/in_progress/min_payout, next_batch_date,
--     program_open pe ramura ne-afiliat). Tipul de retur rămâne jsonb.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.get_affiliate_dashboard()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_aff     public.affiliates;
  v_result  jsonb;
  v_defaults jsonb;
  -- mig 295: cifrele nete
  v_confirmed   bigint;
  v_pending_net bigint;
  v_committed   bigint;
  v_in_progress bigint;
  v_now_ro      timestamp;
  v_period      date;
  v_next_batch  date;
begin
  if v_uid is null then
    raise exception using errcode = 'insufficient_privilege',
      message = 'get_affiliate_dashboard requires authentication';
  end if;

  select * into v_aff from public.affiliates where profile_id = v_uid;
  if not found then
    -- Ne-afiliat: includem defaulturile de comision (mig 188) ca onboarding-ul
    -- să afișeze procentele REALE pe care le-ar primi, nu text generic.
    select value into v_defaults from public.platform_settings
     where key = 'affiliate_commission_defaults';
    return jsonb_build_object('ok', true, 'is_affiliate', false,
      'defaults', jsonb_build_object(
        'setup_bps',            coalesce((v_defaults->>'setup_bps')::int, 3000),
        'recurring_bps',        coalesce((v_defaults->>'recurring_bps')::int, 1000),
        'recurring_cap_months', coalesce((v_defaults->>'recurring_cap_months')::int, 12)
      ),
      -- mig 295: /afiliat nu afișează formularul când programul e închis.
      'program_open', public.affiliate_program_is_open());
  end if;

  -- ── mig 295: cifre NETE (RON, ca restul panoului) ──────────────────────
  -- Confirmat = sursa batch-ului (v_affiliate_payable, 099: net per credit,
  -- trecut de hold, net > 0).
  select coalesce(sum(amount_cents), 0) into v_confirmed
    from public.v_affiliate_payable
   where affiliate_id = v_aff.id and currency = 'RON';

  -- În așteptare NET: creditele încă în hold, fiecare MINUS stornările lui
  -- (clawback-ul poate veni înainte de expirarea hold-ului), plafonat la 0 ca
  -- în v_affiliate_payable.
  select coalesce(sum(greatest(
           l.amount_cents + coalesce((
             select sum(r.amount_cents) from public.affiliate_ledger r
              where r.reverses_ledger_id = l.id
           ), 0), 0)), 0)
    into v_pending_net
    from public.affiliate_ledger l
   where l.affiliate_id = v_aff.id
     and l.leg in ('setup', 'recurring', 'cascade')
     and l.amount_cents > 0
     and l.hold_until > now()
     and l.currency = 'RON';

  -- Angajat = EXACT predicatul din run_affiliate_payout_batch (190): în zbor
  -- sau decontat; eliberate doar canceled și failed FĂRĂ transfer.
  select coalesce(sum(gross_cents), 0) into v_committed
    from public.affiliate_payouts
   where affiliate_id = v_aff.id and currency = 'RON'
     and (status in ('draft','awaiting_invoice','invoice_matched','processing','paid','on_hold')
          or (status = 'failed' and wise_transfer_id is not null));

  select coalesce(sum(gross_cents), 0) into v_in_progress
    from public.affiliate_payouts
   where affiliate_id = v_aff.id and currency = 'RON'
     and (status in ('draft','awaiting_invoice','invoice_matched','processing','on_hold')
          or (status = 'failed' and wise_transfer_id is not null));

  -- Următoarea rulare REALĂ a batch-ului: oglinda Job 3b din automation-cron.js
  -- (zilele 1–2 ale lunii, ora < 06:00 București, o singură rulare pe perioadă
  -- — existența oricărui rând pentru perioadă o oprește).
  v_now_ro := now() at time zone 'Europe/Bucharest';
  v_period := date_trunc('month', v_now_ro)::date;
  if extract(day from v_now_ro) <= 2 and extract(hour from v_now_ro) < 6
     and not exists (select 1 from public.affiliate_payouts where period_month = v_period) then
    v_next_batch := v_now_ro::date;
  else
    v_next_batch := (v_period + interval '1 month')::date;
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'is_affiliate', true,
    'affiliate', jsonb_build_object(
      'id', v_aff.id,
      'referral_code', v_aff.referral_code,
      'vanity_slug', v_aff.vanity_slug,
      'status', v_aff.status,
      'setup_bps', v_aff.setup_bps,
      'recurring_bps', v_aff.recurring_bps,
      'cascade_bps', v_aff.cascade_bps,
      'recurring_cap_months', v_aff.recurring_cap_months,
      'created_at', v_aff.created_at
    ),

    -- Restaurantele aduse: nume + oraș (din restaurants pe owner_id = profil
    -- referit), status atribuire, comision cumulat. Fără date PII ale owner-ului.
    'restaurants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'attribution_id', aa.id,
        'status', aa.status,
        'captured_at', aa.captured_at,
        'restaurant_names', coalesce((
          select jsonb_agg(r.name order by r.name)
            from public.restaurants r where r.owner_id = aa.referred_profile_id
        ), '[]'::jsonb),
        'city', (
          select r.city from public.restaurants r
           where r.owner_id = aa.referred_profile_id order by r.name limit 1
        ),
        -- Doar comisionul RON: eticheta e RON și batch-ul de payout e RON,
        -- deci un rând EUR (mig 107) NU trebuie adunat aici (fix cross-currency).
        'commission_cents', coalesce((
          select sum(l.amount_cents) from public.affiliate_ledger l
           where l.attribution_id = aa.id and l.amount_cents > 0
             and l.currency = 'RON'
        ), 0)
      ) order by aa.captured_at desc)
        from public.affiliate_attributions aa
       where aa.affiliate_id = v_aff.id
    ), '[]'::jsonb),

    -- Sub-afiliații direcți: cod, status, câte conturi au adus, cota mea cascade.
    'sub_affiliates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'referral_code', sa.referral_code,
        'status', sa.status,
        'joined_at', sa.created_at,
        'attributions_count', (
          select count(*) from public.affiliate_attributions x where x.affiliate_id = sa.id
        )
      ) order by sa.created_at desc)
        from public.affiliates sa
       where sa.parent_affiliate_id = v_aff.id
    ), '[]'::jsonb),

    -- Câștiguri (doar ledger-ul propriu; cota de cascade e deja un rând pe
    -- affiliate_id = self). Toate în RON (MVP) — vezi filtrul currency='RON'
    -- de mai jos: eticheta și batch-ul de payout sunt RON, deci sumele NU
    -- trebuie să amestece EUR (fix AFF-E2E-2).
    'earnings', jsonb_build_object(
      'currency', 'RON',
      -- total brut câștigat (pozitive setup/recurring/cascade)
      'total_cents', coalesce((
        select sum(amount_cents) from public.affiliate_ledger
         where affiliate_id = v_aff.id and amount_cents > 0
           and leg in ('setup','recurring','cascade')
           and currency = 'RON'
      ), 0),
      -- confirmat (payable acum): trecut de hold, ne-stornat
      'confirmed_cents', v_confirmed,
      -- în așteptare (hold încă activ) — BRUT, păstrat pentru clientul vechi
      'pending_cents', coalesce((
        select sum(amount_cents) from public.affiliate_ledger
         where affiliate_id = v_aff.id and amount_cents > 0
           and leg in ('setup','recurring','cascade') and hold_until > now()
           and currency = 'RON'
      ), 0),
      -- plătit (rânduri de payout, negative)
      'paid_cents', coalesce((
        select -sum(amount_cents) from public.affiliate_ledger
         where affiliate_id = v_aff.id and leg = 'payout'
           and currency = 'RON'
      ), 0),
      -- stornat (clawback)
      'clawed_back_cents', coalesce((
        select -sum(amount_cents) from public.affiliate_ledger
         where affiliate_id = v_aff.id and leg = 'clawback'
           and currency = 'RON'
      ), 0),
      -- ── mig 295: cifrele NETE (chei noi, la final) ─────────────────────
      -- net câștigat = confirmat + în așteptare net (identitate, AP6)
      'net_earned_cents',  v_confirmed + v_pending_net,
      'pending_net_cents', v_pending_net,
      -- payout-uri create dar încă neplătite (draft → on_hold)
      'in_progress_cents', v_in_progress,
      -- disponibil pentru următorul batch = confirmat − angajat (190)
      'available_cents',   greatest(v_confirmed - v_committed, 0),
      'min_payout_cents',  5000
    ),

    -- Următoarea plată estimată: cel mai apropiat hold care expiră.
    -- Doar holdurile RON: batch-ul de payout rulează în RON, deci un hold EUR
    -- (mig 107) nu trebuie prezentat ca „următoarea plată" RON (fix cross-currency).
    'next_payout_at', (
      select min(hold_until) from public.affiliate_ledger
       where affiliate_id = v_aff.id and amount_cents > 0
         and leg in ('setup','recurring','cascade') and hold_until > now()
         and currency = 'RON'
    ),
    -- mig 295: ziua reală a următoarei rulări a batch-ului de plăți.
    'next_batch_date', v_next_batch
  );

  return v_result;
end$$;

revoke all on function public.get_affiliate_dashboard() from public, anon, service_role;
grant execute on function public.get_affiliate_dashboard() to authenticated;

do $$
declare v_src text;
begin
  v_src := pg_get_functiondef('public.get_affiliate_dashboard()'::regprocedure);
  if position('l.currency = ''RON''' in v_src) = 0 or position('''defaults''' in v_src) = 0 then
    raise exception 'mig 295: get_affiliate_dashboard a pierdut fixul RON (174) sau defaults (188)';
  end if;
  if position('net_earned_cents' in v_src) = 0 or position('available_cents' in v_src) = 0
     or position('next_batch_date' in v_src) = 0 or position('reverses_ledger_id' in v_src) = 0 then
    raise exception 'mig 295: get_affiliate_dashboard fără cifrele nete';
  end if;
  if has_function_privilege('anon', 'public.get_affiliate_dashboard()', 'EXECUTE') then
    raise exception 'mig 295: anon poate citi panoul de afiliat';
  end if;
end $$;

commit;
