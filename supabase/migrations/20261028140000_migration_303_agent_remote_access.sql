-- mig 303 — Agentul lucrează de la distanță (pachetul 10): „Agentul tău Menuvia”
-- ─────────────────────────────────────────────────────────────────────────────
-- Patronul își vede agentul atribuit și îi poate da acces la meniu dintr-un
-- singur loc (cardul de pe Acasă / Setări), pe ORICE plan, fără să aștepte o
-- cerere. Trei piese în DATE, toate NOI (nicio funcție existentă nu își
-- schimbă semnătura sau corpul — fără PGRST203, fără risc pe lanțurile 286):
--
--   1. `owner_grant_partner_access(uuid)` — acordarea PROACTIVĂ a accesului de
--      către owner. `grant_partner_access` (286) rămâne neatinsă: aprobă DOAR
--      o cerere a agentului (PO2(d) o ține). Diferența față de ea: nu cere
--      `partner_access_requested_at`. Restul e IDENTIC: DOAR ownerul REAL
--      (`partner_consent_principal` — nici manager, nici fondator), atribuire
--      ne-terminală, plus afiliatul trebuie să fie `active` (altfel
--      `has_partner_access` ar fi oricum fals: butonul ar minți). FĂRĂ gate de
--      plan: nu există niciunul în 286, iar suprafața acoperită de agent e
--      doar meniul + mesele/QR (politicile dedicate din 286) — regula de aur
--      (bani + bon = Plan 3) rămâne intactă: agentul NU are acces la orders,
--      order_payments, pending_receipts, invoices, oblio_configs, cash_*,
--      reservations (clichetul PO1–PO10 + AR5 din suita nouă).
--   2. `get_my_agent(p_restaurant uuid)` — lista albă DEFINER pentru cardul
--      „Agentul tău”. Gate: `is_admin(p_restaurant)` (altfel 42501, la fel
--      pentru restaurant inexistent — niciun oracol de existență). Întoarce
--      EXACT: has_agent, attribution_id, agent_name, contact_shared, phone,
--      email, access_state, can_manage. Telefonul și emailul ies DOAR când
--      agentul a bifat `affiliates.contact_sharing` ȘI apelantul e ownerul real
--      (un manager vede numele și starea, nu contactul agentului — consimțământul
--      agentului e „către patron”). Fără agent atribuit / atribuire terminală
--      (canceled, refunded, expired) / afiliat neactiv → `{"has_agent": false}`
--      și nimic altceva: patronii veniți singuri nu văd nimic nou. Zero secrete:
--      nu iese codul de referral, comisioanele, IBAN/CUI, Stripe, token-uri.
--   3. Email către patron la fiecare cerere NOUĂ de acces (`partner_access_requested`,
--      enum din 299; șablonul există deja în process-email-queue.js): trigger
--      AFTER UPDATE OF partner_access_requested_at pe `affiliate_attributions`,
--      exception-wrapped (ca SMS-urile 228 / rezervările 255 — un eșec de
--      enqueue NU avortează NICIODATĂ cererea agentului), dedup pe
--      (atribuire, momentul cererii) — o nouă cerere după revocare e un email
--      nou, o re-intrare nu. FĂRĂ recreare a lui `request_partner_access`.
--
-- Coloana `affiliates.contact_sharing` (consimțământul agentului ca patronul să-i
-- vadă contactul) e definită și de mig 302 (rețeaua pe invitații, #305, încă
-- nemerge-uită) cu EXACT aceeași formă; aici `add column if not exists` o face
-- idempotentă în ORICE ordine de aplicare. Setter-ul (`set_my_contact_sharing`)
-- vine din 302 — 303 nu depinde de el: fără 302, coloana rămâne `false` și
-- contactul nu iese niciodată (fail-closed).
--
-- Teste: AR1–AR8 `tests/sql/auto/303_agent_remote_access.sql`.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── 1. Consimțământul agentului pentru contact (oglindă 302) ──────────────────
alter table public.affiliates
  add column if not exists contact_sharing    boolean not null default false,
  add column if not exists contact_sharing_at timestamptz;

-- ── 2. owner_grant_partner_access — ownerul acordă accesul PROACTIV ───────────
create or replace function public.owner_grant_partner_access(p_attribution_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_aa  public.affiliate_attributions%rowtype;
  v_aff public.affiliates%rowtype;
  v_rid uuid;
begin
  select * into v_aa from public.affiliate_attributions where id = p_attribution_id for update;
  -- `is not true`, nu `not …`: pe o atribuire cu profilul șters (referred NULL,
  -- mig 295) funcția întoarce NULL, iar `not NULL` ar lăsa verificarea să treacă.
  if not found
     or public.partner_consent_principal(v_aa.referred_profile_id) is not true then
    raise exception 'Acces interzis';
  end if;

  if v_aa.status in ('canceled', 'refunded', 'expired') then
    return jsonb_build_object('ok', false, 'error', 'Atribuirea nu mai este activă.');
  end if;

  select * into v_aff from public.affiliates where id = v_aa.affiliate_id;
  if not found or v_aff.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'Agentul nu mai este activ.');
  end if;

  -- Deja acordat și nerevocat: idempotent, fără a doua urmă în audit.
  if v_aa.owner_consented_at is not null and v_aa.partner_access_revoked_at is null then
    return jsonb_build_object('ok', true, 'state', 'granted');
  end if;

  update public.affiliate_attributions
     set owner_consented_at = clock_timestamp(),
         partner_access_revoked_at = null
   where id = p_attribution_id;

  select r.id into v_rid from public.restaurants r
   where r.owner_id = v_aa.referred_profile_id order by r.created_at limit 1;
  perform public.log_platform_action('owner', v_rid, 'owner_grant_partner_access',
    jsonb_build_object('attribution_id', p_attribution_id));
  return jsonb_build_object('ok', true, 'state', 'granted');
end;
$$;

-- ── 3. get_my_agent — lista albă pentru cardul „Agentul tău” ──────────────────
create or replace function public.get_my_agent(p_restaurant uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_owner  uuid;
  v_manage boolean;
  v_row    record;
begin
  -- Același 42501 pentru „nu ești admin” și „restaurantul nu există”.
  if auth.uid() is null or p_restaurant is null or not public.is_admin(p_restaurant) then
    raise exception 'Acces interzis' using errcode = '42501';
  end if;

  select r.owner_id into v_owner from public.restaurants r where r.id = p_restaurant;
  v_manage := v_owner is not null and auth.uid() = v_owner;

  select aa.id as attribution_id,
         nullif(btrim(p.full_name), '') as agent_name,
         a.contact_sharing,
         a.phone,
         p.email,
         public.partner_access_state(
           aa.partner_access_requested_at,
           aa.owner_consented_at,
           aa.partner_access_revoked_at) as access_state
    into v_row
    from public.affiliate_attributions aa
    join public.affiliates a on a.id = aa.affiliate_id
    left join public.profiles p on p.id = a.profile_id
   where aa.referred_profile_id = v_owner
     and aa.status not in ('canceled', 'refunded', 'expired')
     and a.status = 'active'
     and a.erased_at is null;

  if not found then
    return jsonb_build_object('has_agent', false);
  end if;

  return jsonb_build_object(
    'has_agent',      true,
    'attribution_id', v_row.attribution_id,
    'agent_name',     v_row.agent_name,
    'contact_shared', v_row.contact_sharing,
    'phone',          case when v_manage and v_row.contact_sharing then v_row.phone end,
    'email',          case when v_manage and v_row.contact_sharing then v_row.email end,
    'access_state',   v_row.access_state,
    'can_manage',     v_manage
  );
end;
$$;

-- ── 4. Email către patron la cerere nouă de acces (exception-wrapped) ─────────
create or replace function public.trg_email_on_partner_access_requested()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_email text;
  v_owner_name  text;
  v_agent_name  text;
  v_rest_name   text;
begin
  begin
    select p.email, p.full_name into v_owner_email, v_owner_name
      from public.profiles p where p.id = new.referred_profile_id;
    -- Fără destinatar nu avem unde trimite: skip tăcut (cererea rămâne vizibilă
    -- în card; un profil fără email nu are voie să blocheze cererea).
    if v_owner_email is null then
      return null;
    end if;

    select nullif(btrim(ap.full_name), '') into v_agent_name
      from public.affiliates a
      left join public.profiles ap on ap.id = a.profile_id
     where a.id = new.affiliate_id;

    select r.name into v_rest_name
      from public.restaurants r
     where r.owner_id = new.referred_profile_id
     order by r.created_at limit 1;

    perform public.enqueue_email(
      v_owner_email,
      'partner_access_requested'::public.email_template_kind,
      jsonb_build_object(
        'agent_display_name', v_agent_name,
        'restaurant_name',    v_rest_name,
        'owner_name',         v_owner_name,
        -- Cardul „Agentul tău” trăiește pe Acasă (tab-ul implicit).
        'approve_url',        '/dashboard'
      ),
      new.referred_profile_id,
      v_owner_name,
      null,
      -- O cerere NOUĂ (după revocare) are alt moment → email nou; aceeași
      -- cerere re-scrisă → dedup.
      'partner_access_req:' || new.id::text || ':'
        || floor(extract(epoch from new.partner_access_requested_at) * 1000)::bigint::text
    );
  exception when others then
    -- Un eșec de notificare NU avortează cererea agentului (aceeași disciplină
    -- ca triggerele 228/255).
    raise warning 'email cerere acces partener % a esuat: %', new.id, sqlerrm;
  end;
  return null; -- AFTER trigger
end;
$$;

drop trigger if exists trg_email_partner_access_requested on public.affiliate_attributions;
create trigger trg_email_partner_access_requested
  after update of partner_access_requested_at on public.affiliate_attributions
  for each row
  when (new.partner_access_requested_at is not null
        and new.partner_access_requested_at is distinct from old.partner_access_requested_at)
  execute function public.trg_email_on_partner_access_requested();

-- ── 5. Grant-uri: EXPLICIT per rol (default privileges re-acordă EXECUTE) ─────
revoke all on function public.owner_grant_partner_access(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_my_agent(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.trg_email_on_partner_access_requested()
  from public, anon, authenticated, service_role;
grant execute on function public.owner_grant_partner_access(uuid) to authenticated;
grant execute on function public.get_my_agent(uuid) to authenticated;

-- ── 6. Asserții fail-closed ───────────────────────────────────────────────────
do $$
declare
  v_fn  text;
  v_def text;
begin
  -- Existență + DEFINER + search_path (cu pg_temp).
  foreach v_fn in array array[
    'public.owner_grant_partner_access(uuid)',
    'public.get_my_agent(uuid)',
    'public.trg_email_on_partner_access_requested()'
  ] loop
    if not exists (
      select 1 from pg_proc p
       where p.oid = v_fn::regprocedure
         and p.prosecdef
         and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                      where c = 'search_path=public, pg_temp')
    ) then
      raise exception 'mig 303: % lipsește sau nu e DEFINER cu search_path = public, pg_temp', v_fn;
    end if;
  end loop;

  -- Fără semnături duble (anti PGRST203).
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
        and proname = 'get_my_agent') <> 1
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
           and proname = 'owner_grant_partner_access') <> 1 then
    raise exception 'mig 303: semnături duble pe get_my_agent / owner_grant_partner_access';
  end if;

  -- Grant-uri: doar authenticated pe cele două RPC-uri; trigger-ul pe nimeni.
  foreach v_fn in array array['public.owner_grant_partner_access(uuid)', 'public.get_my_agent(uuid)'] loop
    if has_function_privilege('anon', v_fn::regprocedure, 'execute')
       or has_function_privilege('service_role', v_fn::regprocedure, 'execute')
       or not has_function_privilege('authenticated', v_fn::regprocedure, 'execute') then
      raise exception 'mig 303: grant-uri greșite pe % (doar authenticated)', v_fn;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.trg_email_on_partner_access_requested()'::regprocedure, 'execute')
     or has_function_privilege('authenticated', 'public.trg_email_on_partner_access_requested()'::regprocedure, 'execute')
     or has_function_privilege('service_role', 'public.trg_email_on_partner_access_requested()'::regprocedure, 'execute') then
    raise exception 'mig 303: funcția de trigger e executabilă de un rol client (RP13)';
  end if;

  -- Trigger-ul: AFTER (tgtype & 2 = 0), ROW (& 1), UPDATE (& 16), cu WHEN.
  if not exists (
    select 1 from pg_trigger t
     where t.tgname = 'trg_email_partner_access_requested'
       and t.tgrelid = 'public.affiliate_attributions'::regclass
       and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 0 and (t.tgtype & 16) = 16
       and t.tgqual is not null
  ) then
    raise exception 'mig 303: trigger-ul trg_email_partner_access_requested lipsește sau are altă formă';
  end if;
  if not exists (
    select 1 from pg_enum e join pg_type ty on ty.oid = e.enumtypid
     where ty.typname = 'email_template_kind' and e.enumlabel = 'partner_access_requested'
  ) then
    raise exception 'mig 303: enum-ul partner_access_requested lipsește (mig 299)';
  end if;
  -- Exception-wrapper-ul e obligatoriu: fără el, un blip pe email_queue ar
  -- avorta cererea agentului.
  v_def := pg_get_functiondef('public.trg_email_on_partner_access_requested()'::regprocedure);
  if v_def !~* 'when\s+others' then
    raise exception 'mig 303: trigger-ul de notificare nu mai e exception-wrapped';
  end if;

  -- Lista albă: get_my_agent nu poate proiecta secrete.
  v_def := pg_get_functiondef('public.get_my_agent(uuid)'::regprocedure);
  if v_def ~* '(referral_code|payout_profile|iban|stripe_|_bps|device_secret|api_secret)' then
    raise exception 'mig 303: get_my_agent referă o coloană secretă';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'affiliates'
       and column_name = 'contact_sharing' and data_type = 'boolean'
       and is_nullable = 'NO' and column_default = 'false'
  ) then
    raise exception 'mig 303: affiliates.contact_sharing lipsește sau are altă formă';
  end if;
end $$;

commit;
