-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION 301 — Codul de agent la ÎNSCRIERE, nu la checkout (pachetul 7 / PR-5a)
-- ═══════════════════════════════════════════════════════════════════════════
-- Defectul: atribuirea agentului trăia DOAR în `capture_affiliate_attribution`
-- (097c→100), chemată de `stripe-checkout.js` cu codul din cookie-ul `mv_ref`.
-- Deci (1) merge doar dacă patronul folosește ACELAȘI browser de la link până la
-- plată (confirmarea emailului se deschide adesea pe alt dispozitiv) și (2) un
-- restaurant care rămâne pe planul gratuit nu e atribuit NICIODATĂ — agentul
-- care l-a înscris nu primește nimic, nici măcar legătura cu el. Înscrierea
-- asistată (agentul stă lângă patron) nu are cookie deloc.
--
-- Ce face migrația (lanț nou, nu recreează nimic din fluxul de checkout):
--   (1) `fn_attribute_signup_agent_code()` + `trg_profiles_agent_code_attribution`
--       — trigger AFTER INSERT pe `public.profiles` (NU pe `auth.users`: nu
--       concurează crearea profilului din `handle_new_user`). Citește
--       `auth.users.raw_user_meta_data->>'agent_code'` (pus de `signUp`) și
--       creează atribuirea `pending` dacă: codul (sau vanity-ul) există, afiliatul
--       e `active`, nu e propriul cont, contul nou nu e el însuși afiliat și nu
--       există deja o atribuire. PRIMUL CÂȘTIGĂ — autoritatea rămâne indexul unic
--       pe `referred_profile_id` (`on conflict do nothing`). Un cod greșit,
--       malformat sau un metadata de formă neașteptată NU blochează înscrierea;
--       tot corpul e exception-wrapped (`raise warning`): o eroare aici nu
--       avortează NICIODATĂ crearea contului.
--   (2) `claim_agent_code(p_code)` — pentru conturile deja create (patronul care
--       își amintește de agent după înscriere). DEFINER, doar `authenticated`.
--       Condiții de CONT (independente de cod, deci fără oracol): cont ≤ fereastra
--       de revendicare (D10, o singură constantă: `agent_code_claim_window_days()`),
--       nicio factură plătită, nicio atribuire existentă, nu un afiliat. Abia
--       APOI se rezolvă codul — orice cod necunoscut/inactiv/propriu primește
--       ACELAȘI răspuns (`invalid_code`). Rate limit 5/15 min per utilizator.
--   (3) LEGĂTURA CU CLIENTUL STRIPE (AC3). Comisionul e căutat după
--       `affiliate_attributions.stripe_customer_id` (mig 293, `process_affiliate_
--       invoice_paid`). O atribuire creată la înscriere nu are client Stripe încă;
--       iar `capture_affiliate_attribution` (100) face `on conflict do nothing`,
--       deci la checkout NU o completează → comisionul ar fi dat `no_attribution`
--       TĂCUT pentru tot ce a adus un agent prin acest drum. Trigger separat
--       `trg_profiles_attribution_stripe_link` (AFTER UPDATE OF stripe_customer_id
--       pe profiles): completează clientul pe atribuirea profilului, DOAR cât e
--       NULL (nu suprascrie un client deja legat). Același wrapper `raise warning`
--       — scrierea clientului Stripe pe profil (checkout/webhook) nu are voie să
--       pice din cauza afilierii. Cazul în care profilul AVEA deja client la
--       momentul atribuirii (revendicare, sau inserare directă) e copiat de
--       funcțiile care creează atribuirea.
--   (4) Coduri dictabile: `new_agent_referral_code()` — 7 caractere din alfabetul
--       `abcdefghjkmnpqrstuvwxyz23456789` (fără 0/o/1/i/l). `register_affiliate`
--       (lanț 097d→188→224→243→295→301, ACEEAȘI semnătură) îl folosește în locul
--       `substr(md5(...), 1, 8)`. Codurile EXISTENTE nu se ating (zero afiliați pe
--       producție la scrierea acestei migrații, dar principiul rămâne: un cod
--       dat deja nu se rescrie). Rămâne VALID pentru `^[a-z0-9]{6,32}$`.
--
-- Ce NU se schimbă: semnăturile `capture_affiliate_attribution` / `resolve_
-- referral_code` / `process_affiliate_invoice_paid`; politicile RLS; accesul
-- agentului la restaurant (`has_partner_access` cere `owner_consented_at`,
-- mig 286 — o atribuire NU dă acces la date); comisionul (instantaneul bps
-- vine din `fn_affiliate_attribution_snapshot`, 293, BEFORE INSERT).
--
-- ⚠ Lanț de refăcut: orice migrație VIITOARE care recreează `register_affiliate`
-- pornește de AICI (301), nu de la 295 — altfel codurile noi revin la 8 hex.
-- Asserția de la final și testul AC12 pică dacă apelul către
-- `new_agent_referral_code()` dispare din corp.
--
-- Funcțiile noi: `security definer`, `search_path = public, pg_temp`, revoke
-- EXPLICIT per rol (default privileges din Supabase re-acordă EXECUTE); funcțiile
-- de trigger fără EXECUTE pentru niciun rol client (clichet RP13).
-- ═══════════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ───────────────────────────────────────────────────────────────────────────
-- §1. Constanta ferestrei de revendicare (D10) — UN singur loc
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.agent_code_claim_window_days()
returns integer
language sql immutable
set search_path = public, pg_temp
as $$ select 14 $$;

revoke all on function public.agent_code_claim_window_days()
  from public, anon, authenticated, service_role;

comment on function public.agent_code_claim_window_days() is
  'D10: câte zile după crearea contului poate patronul să-și revendice agentul (claim_agent_code). SINGURA sursă a numărului; clientul nu are o copie.';

-- ───────────────────────────────────────────────────────────────────────────
-- §2. Generatorul de coduri NOI de agent (dictabile)
--     31 de simboluri: a-z fără i, l, o (23) + cifrele 2-9 (8). 7 poziții =
--     ~2,75e10 combinații. Octeții vin din pozițiile NEfixe ale unui uuid v4
--     (6 = versiune, 8 = variantă sunt excluși): 0-5 și 10.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.new_agent_referral_code()
returns text
language plpgsql volatile
set search_path = public, pg_temp
as $$
declare
  v_alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_pos      constant int[] := array[0, 1, 2, 3, 4, 5, 10];
  v_bytes    bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  v_out      text := '';
  i          int;
begin
  for i in 1..7 loop
    v_out := v_out || substr(v_alphabet, (get_byte(v_bytes, v_pos[i]) % 31) + 1, 1);
  end loop;
  return v_out;
end;
$$;

revoke all on function public.new_agent_referral_code()
  from public, anon, authenticated, service_role;

comment on function public.new_agent_referral_code() is
  'mig 301: cod NOU de agent, 7 caractere din abcdefghjkmnpqrstuvwxyz23456789 (fără 0/o/1/i/l — se dictează la telefon). Codurile existente nu se rescriu.';

-- ───────────────────────────────────────────────────────────────────────────
-- §3. register_affiliate — copie VERBATIM din 295 + UN delta: generatorul
--     (același semnătură; revoke/grant/comment identice cu 295).
-- ───────────────────────────────────────────────────────────────────────────
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

  -- Generează un referral_code unic (mig 301: 7 caractere DICTABILE, fără
  -- 0/o/1/i/l — vezi new_agent_referral_code; rămâne ^[a-z0-9]{6,32}$). Retry pe
  -- coliziune. Codul există de la cerere, dar e INERT până la aprobare
  -- (atribuirea din mig 097c / 301 caută doar afiliați 'active').
  loop
    v_try := v_try + 1;
    v_code := public.new_agent_referral_code();
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
  mig 295: cu programul închis (affiliate_program_open) → program_closed.
  mig 301: codul nou e dictabil (new_agent_referral_code, 7 caractere).$$;

-- ───────────────────────────────────────────────────────────────────────────
-- §4. Trigger AFTER INSERT pe profiles — atribuirea la înscriere
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.fn_attribute_signup_agent_code()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_meta jsonb;
  v_code text;
  v_aff  public.affiliates%rowtype;
begin
  -- Tot corpul într-un bloc cu handler: o eroare AICI (metadata ciudat, un
  -- trigger viitor pe affiliate_attributions care aruncă, deadlock) nu are voie
  -- să avorteze crearea contului. Contul fără atribuire e mereu mai bun decât
  -- niciun cont; atribuirea se poate revendica ulterior (claim_agent_code).
  begin
    select u.raw_user_meta_data into v_meta
      from auth.users u where u.id = NEW.id;
    if v_meta is null or jsonb_typeof(v_meta) <> 'object' then
      return NEW;
    end if;
    -- Doar un STRING e un cod: un număr/obiect/array din metadata se ignoră.
    if jsonb_typeof(v_meta -> 'agent_code') is distinct from 'string' then
      return NEW;
    end if;

    v_code := lower(btrim(v_meta ->> 'agent_code'));
    -- Forma acceptată = cea de la resolve_referral_code (cod 097 SAU vanity 097).
    if v_code !~ '^[a-z0-9-]{2,40}$' then
      return NEW;
    end if;

    -- Doar afiliați ACTIVI (pending/rejected/suspended/closed sunt INERȚI);
    -- codul exact are prioritate față de un vanity cu aceeași formă.
    select a.* into v_aff
      from public.affiliates a
     where a.status = 'active'
       and (a.referral_code = v_code or a.vanity_slug = v_code)
     order by (a.referral_code = v_code) desc
     limit 1;
    if not found then
      return NEW;
    end if;

    -- Nu pe sine și nu un afiliat ca client. (La INSERT pe profiles niciuna nu
    -- se poate întâmpla încă — afiliatul are FK spre profil —, dar gărzile
    -- rămân: trigger-ul nu are voie să depindă de o ordine pe care n-o verifică.)
    if v_aff.profile_id = NEW.id
       or exists (select 1 from public.affiliates x where x.profile_id = NEW.id) then
      return NEW;
    end if;

    -- PRIMUL CÂȘTIGĂ: indexul unic pe referred_profile_id e autoritatea.
    insert into public.affiliate_attributions
      (affiliate_id, referred_profile_id, stripe_customer_id, status, source)
    values
      (v_aff.id, NEW.id, NEW.stripe_customer_id, 'pending', 'signup_agent_code')
    on conflict (referred_profile_id) do nothing;
  exception when others then
    raise warning 'fn_attribute_signup_agent_code: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  return NEW;
end;
$$;

revoke all on function public.fn_attribute_signup_agent_code()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_profiles_agent_code_attribution on public.profiles;
create trigger trg_profiles_agent_code_attribution
  after insert on public.profiles
  for each row execute function public.fn_attribute_signup_agent_code();

comment on function public.fn_attribute_signup_agent_code() is
  'mig 301: atribuire pending la înscriere din user_metadata.agent_code. Exception-wrapped (raise warning): nu avortează niciodată crearea contului. Primul câștigă (index unic).';

-- ───────────────────────────────────────────────────────────────────────────
-- §5. Legătura cu clientul Stripe (AC3)
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.fn_link_attribution_stripe_customer()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  begin
    -- Doar cât clientul lipsește (un client deja legat nu se suprascrie) și doar
    -- pe atribuiri care mai pot produce comision (aceeași mulțime ca
    -- process_affiliate_invoice_paid, 293: pending/active).
    update public.affiliate_attributions
       set stripe_customer_id = NEW.stripe_customer_id
     where referred_profile_id = NEW.id
       and stripe_customer_id is null
       and status in ('pending', 'active');
  exception when others then
    raise warning 'fn_link_attribution_stripe_customer: % (SQLSTATE %)', sqlerrm, sqlstate;
  end;
  return NEW;
end;
$$;

revoke all on function public.fn_link_attribution_stripe_customer()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_profiles_attribution_stripe_link on public.profiles;
create trigger trg_profiles_attribution_stripe_link
  after update of stripe_customer_id on public.profiles
  for each row
  when (NEW.stripe_customer_id is not null
        and NEW.stripe_customer_id is distinct from OLD.stripe_customer_id)
  execute function public.fn_link_attribution_stripe_customer();

comment on function public.fn_link_attribution_stripe_customer() is
  'mig 301 (AC3): completează affiliate_attributions.stripe_customer_id când profilul primește clientul Stripe. Fără el, comisionul (căutat după client, 293) ar da no_attribution pe atribuirile create la înscriere.';

-- ───────────────────────────────────────────────────────────────────────────
-- §6. claim_agent_code — pentru conturile deja create
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.claim_agent_code(p_code text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_profile record;
  v_in      text := lower(btrim(coalesce(p_code, '')));
  v_aff     public.affiliates%rowtype;
  v_attr_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  -- Plafon PER UTILIZATOR, ÎNAINTEA oricărei căutări: ghicitul de coduri e
  -- mărginit indiferent de răspuns.
  if not public.check_rate_limit('claim_agent_code', v_uid::text, 5, 15) then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  select p.id, p.created_at, p.stripe_customer_id into v_profile
    from public.profiles p where p.id = v_uid;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible', 'detail', 'no_profile');
  end if;

  -- Condițiile de CONT vin ÎNAINTEA codului și nu depind de el: un răspuns
  -- diferit „cod bun, dar cont neeligibil" ar fi un oracol de coduri valide.
  if exists (select 1 from public.affiliate_attributions aa where aa.referred_profile_id = v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible', 'detail', 'already_attributed');
  end if;
  if exists (select 1 from public.affiliates a where a.profile_id = v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible', 'detail', 'is_affiliate');
  end if;
  if v_profile.created_at < now() - make_interval(days => public.agent_code_claim_window_days()) then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible', 'detail', 'account_too_old');
  end if;
  -- „Nicio factură plătită" = nicio factură Stripe cu bani reali (>0; trialul
  -- emite `invoice.paid` de 0 lei la pornire, ECOSISTEM §3). Sursa e evenimentul
  -- de ciclu de viață scris de webhook la fiecare invoice.paid.
  if exists (
       select 1 from public.lifecycle_events le
        where le.user_id = v_uid
          and le.event_type = 'invoice_paid'
          and coalesce(nullif(le.event_data ->> 'amount_paid', '')::numeric, 0) > 0) then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible', 'detail', 'already_paying');
  end if;

  -- Codul: ACELAȘI răspuns pentru formă greșită, necunoscut, inactiv sau propriu.
  if v_in !~ '^[a-z0-9-]{2,40}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;
  select a.* into v_aff
    from public.affiliates a
   where a.status = 'active'
     and (a.referral_code = v_in or a.vanity_slug = v_in)
   order by (a.referral_code = v_in) desc
   limit 1;
  if not found or v_aff.profile_id = v_uid then
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;

  insert into public.affiliate_attributions
    (affiliate_id, referred_profile_id, stripe_customer_id, status, source)
  values
    (v_aff.id, v_uid, v_profile.stripe_customer_id, 'pending', 'claim_agent_code')
  on conflict (referred_profile_id) do nothing
  returning id into v_attr_id;

  if v_attr_id is null then
    -- Cursă: o atribuire a apărut între verificare și insert (primul câștigă).
    return jsonb_build_object('ok', false, 'reason', 'not_eligible', 'detail', 'already_attributed');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.claim_agent_code(text)
  from public, anon, service_role;
grant execute on function public.claim_agent_code(text) to authenticated;

comment on function public.claim_agent_code(text) is
  'mig 301: revendicarea agentului de către un cont deja creat. Cont ≤ agent_code_claim_window_days() (D10), fără factură plătită, fără atribuire, nu afiliat; cod invalid/inactiv/propriu = același invalid_code (anti-oracol); rate limit 5/15 min per utilizator.';

-- ───────────────────────────────────────────────────────────────────────────
-- §7. Asserții fail-closed
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  v_src text;
  i     int;
  v_cod text;
begin
  -- (a) o singură semnătură pe fiecare funcție atinsă (anti PGRST203)
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'register_affiliate') <> 1 then
    raise exception 'mig 301: register_affiliate are mai multe semnături (PGRST203)';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'claim_agent_code') <> 1 then
    raise exception 'mig 301: claim_agent_code are mai multe semnături';
  end if;

  -- (b) register_affiliate: TOATE invariantele 224/243/295 + generatorul nou
  v_src := pg_get_functiondef('public.register_affiliate(text, text, text)'::regprocedure);
  if position('unique_violation' in v_src) = 0 or position('phone_required' in v_src) = 0
     or position('''pending''' in v_src) = 0 or position('platform_settings' in v_src) = 0
     or position('status = ''active''' in v_src) = 0
     or position('affiliate_program_is_open' in v_src) = 0
     or position('pg_temp' in v_src) = 0 then
    raise exception 'mig 301: register_affiliate a pierdut un invariant (243/224/188/295)';
  end if;
  if position('new_agent_referral_code' in v_src) = 0 or position('md5(' in v_src) > 0 then
    raise exception 'mig 301: register_affiliate nu folosește generatorul dictabil (sau mai are md5)';
  end if;

  -- (c) generatorul: 7 caractere, doar alfabetul dictabil, valid pentru CHECK-ul 097
  for i in 1..300 loop
    v_cod := public.new_agent_referral_code();
    if length(v_cod) <> 7 or v_cod !~ '^[abcdefghjkmnpqrstuvwxyz2-9]{7}$'
       or v_cod !~ '^[a-z0-9]{6,32}$' then
      raise exception 'mig 301: new_agent_referral_code a produs un cod nevalid: %', v_cod;
    end if;
  end loop;

  -- (d) constanta ferestrei: 14 (D10)
  if public.agent_code_claim_window_days() <> 14 then
    raise exception 'mig 301: fereastra de revendicare ≠ 14 zile (D10)';
  end if;

  -- (e) convenția: DEFINER cu search_path = public, pg_temp, pe toate funcțiile noi
  if exists (
       select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('fn_attribute_signup_agent_code', 'fn_link_attribution_stripe_customer',
                            'claim_agent_code', 'new_agent_referral_code', 'agent_code_claim_window_days')
          and not (coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=public, pg_temp%'))
  then
    raise exception 'mig 301: o funcție nouă fără search_path = public, pg_temp';
  end if;

  -- (f) privilegii: claim doar authenticated; triggerele și helperii la NIMENI
  if has_function_privilege('anon', 'public.claim_agent_code(text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.claim_agent_code(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.claim_agent_code(text)', 'EXECUTE') then
    raise exception 'mig 301: claim_agent_code trebuie apelabilă DOAR de authenticated';
  end if;
  foreach v_cod in array array[
    'public.fn_attribute_signup_agent_code()', 'public.fn_link_attribution_stripe_customer()',
    'public.new_agent_referral_code()', 'public.agent_code_claim_window_days()'] loop
    if has_function_privilege('anon', v_cod::regprocedure, 'EXECUTE')
       or has_function_privilege('authenticated', v_cod::regprocedure, 'EXECUTE')
       or has_function_privilege('service_role', v_cod::regprocedure, 'EXECUTE') then
      raise exception 'mig 301: % nu trebuie apelabilă de niciun rol client', v_cod;
    end if;
  end loop;

  -- (g) triggerele: AFTER INSERT ROW pe profiles (tgtype 5) și AFTER UPDATE OF ROW (17)
  if not exists (select 1 from pg_trigger
                  where tgname = 'trg_profiles_agent_code_attribution'
                    and tgrelid = 'public.profiles'::regclass and tgtype = 5 and not tgisinternal) then
    raise exception 'mig 301: trg_profiles_agent_code_attribution lipsește sau nu e AFTER INSERT ROW';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgname = 'trg_profiles_attribution_stripe_link'
                    and tgrelid = 'public.profiles'::regclass and tgtype = 17 and not tgisinternal) then
    raise exception 'mig 301: trg_profiles_attribution_stripe_link lipsește sau nu e AFTER UPDATE ROW';
  end if;

  -- (h) wrapper-ul exception din ambele funcții de trigger
  v_src := pg_get_functiondef('public.fn_attribute_signup_agent_code()'::regprocedure);
  if position('exception when others' in v_src) = 0 or position('raise warning' in v_src) = 0 then
    raise exception 'mig 301: fn_attribute_signup_agent_code fără exception-wrapper';
  end if;
  v_src := pg_get_functiondef('public.fn_link_attribution_stripe_customer()'::regprocedure);
  if position('exception when others' in v_src) = 0 or position('raise warning' in v_src) = 0 then
    raise exception 'mig 301: fn_link_attribution_stripe_customer fără exception-wrapper';
  end if;

  raise notice 'mig 301: atribuirea la înscriere, claim_agent_code, legătura Stripe și codurile dictabile OK';
end $$;

commit;
