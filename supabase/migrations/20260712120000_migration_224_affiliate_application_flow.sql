-- ═══════════════════════════════════════════════════════════════════
-- Migration 224: cereri de afiliere cu aprobare de fondator (interviu telefonic)
-- ─────────────────────────────────────────────────────────────────────
-- Până acum register_affiliate era self-serve INSTANT (status 'active' din
-- prima). Fondatorul vrea un pas de calificare: candidatul își depune cererea
-- (cu telefon + cum are de gând să recomande), fondatorul îl sună pentru o
-- discuție scurtă și abia apoi îl aprobă sau îl respinge, din FounderPage.
--
-- Arhitectura EXISTENTĂ face gate-ul aproape gratuit: TOATE căile de bani și
-- acces cer deja `affiliates.status = 'active'` —
--   • atribuirea pe cod (mig 097c: lookup `and status='active'`),
--   • comisionul la invoice.paid (mig 099: `v_aff.status <> 'active'` → skip),
--   • părintele la sub-afiliere (mig 097d/188: `and status='active'`),
--   • accesul de partener la restaurante (mig 187/193: `a.status='active'`).
-- Deci un afiliat 'pending'/'rejected' e INERT peste tot, fără nicio altă
-- modificare. Migrația doar: (1) adaugă stările în enum, (2) face cererea să
-- intre ca 'pending' cu telefon+notă, (3) dă fondatorului RPC-ul de decizie.
--
-- Lanțuri de redefinire atinse (semnături în comentarii, pentru viitor):
--   register_affiliate:   097d → 188 → 224 (SEMNĂTURĂ NOUĂ: text,text,text —
--                         cea veche (text) se DROP-uie ca la mig 091/223,
--                         altfel PostgREST dă "function is not unique")
--   admin_list_affiliates: 186 → 188 → 224 (+ phone/application_note/reviewed_at)
-- Afiliații EXISTENȚI rămân 'active' (grandfathered) — nu se atinge niciun rând.
-- ═══════════════════════════════════════════════════════════════════

-- TX1: valorile noi de enum. Trebuie COMMIT-uite înainte de a fi folosite în
-- corpuri de funcții/DEFAULT (restricția ALTER TYPE ... ADD VALUE) — de aceea
-- fișierul are DOUĂ tranzacții (rulat cu psql per-fișier, ca mig 120/121).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter type public.affiliate_status add value if not exists 'pending' before 'active';
alter type public.affiliate_status add value if not exists 'rejected';

commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- ── 1. Coloanele cererii ─────────────────────────────────────────────
-- Telefonul e obligatoriu la aplicare (interviul e telefonic); nota e ce
-- scrie candidatul despre cum va recomanda. reviewed_* = auditul deciziei.
alter table public.affiliates
  add column if not exists phone text
    check (phone is null or (length(btrim(phone)) between 5 and 32)),
  add column if not exists application_note text
    check (application_note is null or length(application_note) <= 1000),
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid;

-- NOTĂ: default-ul coloanei `status` rămâne 'active' INTENȚIONAT. Singura
-- cale de INSERT pentru utilizatori e register_affiliate (RLS blochează
-- scrierile directe), care setează 'pending' EXPLICIT. Schimbarea default-ului
-- ar rupe seed-urile superuser din testele permanente (tests/sql/affiliate_*)
-- fără niciun câștig de securitate real.

-- ── 2. register_affiliate — devine „depune cererea" ──────────────────
-- Copie fidelă din mig 188 cu 3 delte: (a) status 'pending' explicit,
-- (b) telefon obligatoriu + notă opțională, (c) răspunsul include status.
-- Semnătura veche (text) se drop-uiește explicit (anti overload PostgREST).
drop function if exists public.register_affiliate(text);

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

  return jsonb_build_object('ok', true, 'affiliate_id', v_aff_id,
    'referral_code', v_code, 'status', 'pending',
    'parent_affiliate_id', v_parent.id);
end$$;

revoke all on function public.register_affiliate(text, text, text) from public, anon;
grant execute on function public.register_affiliate(text, text, text) to authenticated;

comment on function public.register_affiliate(text, text, text) is
  $$Depune cererea de afiliere (status 'pending'): telefon obligatoriu (interviul
  de calificare e telefonic), notă opțională. Fondatorul decide prin
  admin_review_affiliate. Idempotent — un al doilea apel întoarce starea curentă.$$;

-- ── 3. admin_review_affiliate — decizia fondatorului ─────────────────
-- Aprobă ('active') sau respinge ('rejected') o cerere. Poate „repescui" și un
-- respins (aprobare ulterioară) — dar NU atinge suspended/closed (acelea sunt
-- stări operaționale, nu de calificare). Totul în platform_audit_log.
create or replace function public.admin_review_affiliate(
  p_affiliate_id uuid,
  p_approve      boolean
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_aff public.affiliates;
  v_new public.affiliate_status;
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

  v_new := case when p_approve then 'active'::public.affiliate_status
                else 'rejected'::public.affiliate_status end;

  update public.affiliates
     set status = v_new, reviewed_at = now(), reviewed_by = auth.uid()
   where id = p_affiliate_id;

  perform public.log_platform_action('founder', null, 'affiliate_reviewed',
    jsonb_build_object('affiliate_id', p_affiliate_id,
                       'old_status', v_aff.status, 'new_status', v_new));

  return jsonb_build_object('ok', true, 'status', v_new);
end$$;

revoke all on function public.admin_review_affiliate(uuid, boolean) from public, anon;
grant execute on function public.admin_review_affiliate(uuid, boolean) to authenticated;

comment on function public.admin_review_affiliate(uuid, boolean) is
  $$Founder-only: aprobă (→active) sau respinge (→rejected) o cerere de afiliere
  aflată în pending/rejected. Nu atinge suspended/closed. Audit în platform_audit_log.$$;

-- ── 4. admin_list_affiliates — copie fidelă din mig 188 + datele cererii ──
create or replace function public.admin_list_affiliates()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'affiliate_id',        a.id,
             'email',               p.email,
             'full_name',           p.full_name,
             'referral_code',       a.referral_code,
             'status',              a.status,
             'parent_affiliate_id', a.parent_affiliate_id,
             -- Datele cererii (mig 224) — pentru interviul telefonic.
             'phone',               a.phone,
             'application_note',    a.application_note,
             'reviewed_at',         a.reviewed_at,
             -- Comisioanele curente (mig 188) — editabile din FounderPage.
             'setup_bps',            a.setup_bps,
             'recurring_bps',        a.recurring_bps,
             'cascade_bps',          a.cascade_bps,
             'recurring_cap_months', a.recurring_cap_months,
             'balance_ron_cents', (
               select coalesce(sum(l.amount_cents), 0)
                 from public.affiliate_ledger l
                where l.affiliate_id = a.id and l.currency = 'RON'
             ),
             'restaurants', (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'restaurant_id', r.id,
                        'name',          r.name,
                        'slug',          r.slug,
                        'plan',          op.plan,
                        'is_active',     r.is_active
                      ) order by r.name), '[]'::jsonb)
                 from public.affiliate_attributions aa
                 join public.restaurants r on r.owner_id = aa.referred_profile_id
                 join public.profiles op on op.id = r.owner_id
                where aa.affiliate_id = a.id
             ),
             'created_at',          a.created_at
           ) order by (a.status = 'pending') desc, a.created_at)
      from public.affiliates a
      join public.profiles p on p.id = a.profile_id
  ), '[]'::jsonb);
end;
$$;

-- ── Asserții fail-closed ──────────────────────────────────────────
do $$
declare v_def text;
begin
  -- Enum-ul are stările de cerere.
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'affiliate_status' and e.enumlabel = 'pending'
  ) or not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'affiliate_status' and e.enumlabel = 'rejected'
  ) then
    raise exception 'ASSERT FAIL (mig 224): enum affiliate_status fără pending/rejected';
  end if;

  -- Semnătura veche register_affiliate(text) nu mai există (anti overload).
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'register_affiliate'
      and pg_get_function_identity_arguments(p.oid) = 'p_parent_referral_code text'
  ) then
    raise exception 'ASSERT FAIL (mig 224): overload-ul vechi register_affiliate(text) încă există';
  end if;

  -- Cererea intră ca pending, cu telefon obligatoriu.
  v_def := pg_get_functiondef('public.register_affiliate(text, text, text)'::regprocedure);
  if position('''pending''' in v_def) = 0 or position('phone_required' in v_def) = 0 then
    raise exception 'ASSERT FAIL (mig 224): register_affiliate nu creează cerere pending cu telefon';
  end if;

  -- Decizia e gate-uită pe founder și logată.
  v_def := pg_get_functiondef('public.admin_review_affiliate(uuid, boolean)'::regprocedure);
  if position('is_platform_admin' in v_def) = 0 or position('log_platform_action' in v_def) = 0 then
    raise exception 'ASSERT FAIL (mig 224): admin_review_affiliate fără gate/audit';
  end if;
  if has_function_privilege('anon', 'public.admin_review_affiliate(uuid, boolean)', 'execute') then
    raise exception 'ASSERT FAIL (mig 224): anon poate executa admin_review_affiliate';
  end if;

  -- Lista fondatorului expune datele cererii.
  v_def := pg_get_functiondef('public.admin_list_affiliates()'::regprocedure);
  if position('application_note' in v_def) = 0 or position('setup_bps' in v_def) = 0 then
    raise exception 'ASSERT FAIL (mig 224): admin_list_affiliates fără datele cererii/bps (regresie mig 188)';
  end if;
end $$;

commit;
