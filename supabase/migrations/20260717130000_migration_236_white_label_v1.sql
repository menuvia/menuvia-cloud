-- mig 236 — white-label v1: domeniu + branding de agenție pe meniul public
-- ─────────────────────────────────────────────────────────────────────
-- Săptămâna 9 din PLAN_10_SAPTAMANI (E5): agențiile (afiliați activi) își pot
-- servi clienții de pe PROPRIUL domeniu (CNAME → Netlify servește același
-- bundle), iar meniul public afișează brandingul agenției în locul badge-ului
-- „Meniu digital creat cu Menuvia".
--
--   • Coloane noi pe `affiliates`: brand_domain (unic, lowercase),
--     brand_name, brand_logo_url. Scrierea DOAR prin RPC founder
--     (UPDATE direct pe affiliates e revocat din mig 097).
--   • `admin_set_affiliate_branding` — founder-only, normalizează + validează
--     domeniul, audit prin log_platform_action.
--   • `resolve_agency_branding(p_domain)` — RPC public anon (pattern
--     get_restaurant_by_slug mig 219): whitelist STRICT de 2 câmpuri
--     (brand_name, brand_logo_url), DOAR afiliați cu status='active' —
--     pending/suspended/closed/rejected nu răspund (aceeași disciplină ca
--     has_partner_access, mig 193/224).
--   • `admin_list_affiliates` — lanț 186→188→224→236: copia exactă a mig 224
--     + cele 3 câmpuri de branding (FounderPage le editează).
--
-- Pașii MANUALI de CNAME (founder, o dată per agenție) sunt în
-- docs/WHITE_LABEL.md — Netlify domain alias + DNS; frontend-ul detectează
-- hostname-ul non-Menuvia la runtime și cheamă resolve_agency_branding.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── A. Coloanele de branding ─────────────────────────────────────────
alter table public.affiliates
  add column if not exists brand_domain   text,
  add column if not exists brand_name     text,
  add column if not exists brand_logo_url text;

-- Un domeniu = o singură agenție (case-insensitive).
create unique index if not exists idx_affiliates_brand_domain
  on public.affiliates (lower(brand_domain))
  where brand_domain is not null;

comment on column public.affiliates.brand_domain is
  'White-label v1 (mig 236): hostname-ul agenției (CNAME spre Netlify). Meniul public de pe acest domeniu afișează brand_name/brand_logo_url în loc de badge-ul Menuvia. Doar afiliații ACTIVE răspund la resolve_agency_branding.';

-- ── B. admin_set_affiliate_branding — founder-only + audit ───────────
create or replace function public.admin_set_affiliate_branding(
  p_affiliate_id uuid,
  p_domain       text,
  p_name         text,
  p_logo_url     text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_domain text;
  v_old    record;
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis';
  end if;

  select id, brand_domain, brand_name, brand_logo_url
    into v_old
    from public.affiliates where id = p_affiliate_id;
  if v_old.id is null then
    return jsonb_build_object('ok', false, 'error', 'affiliate_not_found');
  end if;

  -- Normalizare + validare domeniu: lowercase, fără protocol/cale, format
  -- hostname. NULL/gol = ștergerea brandingului de domeniu.
  v_domain := nullif(lower(btrim(coalesce(p_domain, ''))), '');
  if v_domain is not null then
    v_domain := regexp_replace(v_domain, '^https?://', '');
    v_domain := split_part(v_domain, '/', 1);
    if v_domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then
      return jsonb_build_object('ok', false, 'error', 'invalid_domain');
    end if;
    -- Domeniile platformei nu pot fi „revendicate" de o agenție.
    if v_domain = 'menuvia.ro' or v_domain like '%.menuvia.ro'
       or v_domain like '%.netlify.app' then
      return jsonb_build_object('ok', false, 'error', 'reserved_domain');
    end if;
  end if;

  begin
    update public.affiliates
       set brand_domain   = v_domain,
           brand_name     = nullif(btrim(coalesce(p_name, '')), ''),
           brand_logo_url = nullif(btrim(coalesce(p_logo_url, '')), '')
     where id = p_affiliate_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'domain_taken');
  end;

  perform public.log_platform_action(
    'founder', null, 'affiliate_branding_set',
    jsonb_build_object(
      'affiliate_id', p_affiliate_id,
      'old', jsonb_build_object('domain', v_old.brand_domain, 'name', v_old.brand_name),
      'new', jsonb_build_object('domain', v_domain, 'name', nullif(btrim(coalesce(p_name, '')), ''))
    )
  );

  return jsonb_build_object('ok', true, 'brand_domain', v_domain);
end;
$$;

revoke all on function public.admin_set_affiliate_branding(uuid, text, text, text) from public;
revoke all on function public.admin_set_affiliate_branding(uuid, text, text, text) from anon, service_role;
grant execute on function public.admin_set_affiliate_branding(uuid, text, text, text) to authenticated;

-- ── C. resolve_agency_branding — public anon, whitelist strict ───────
-- DOAR 2 câmpuri publice. Niciodată referral_code / bps / profile_id.
create or replace function public.resolve_agency_branding(p_domain text)
returns table (brand_name text, brand_logo_url text)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select a.brand_name, a.brand_logo_url
    from public.affiliates a
   where a.brand_domain is not null
     and lower(a.brand_domain) = lower(btrim(coalesce(p_domain, '')))
     and a.status = 'active'
   limit 1;
$$;

revoke all on function public.resolve_agency_branding(text) from public;
grant execute on function public.resolve_agency_branding(text) to anon, authenticated;

-- ── D. admin_list_affiliates — lanț 186→188→224→236 ──────────────────
-- Copia exactă a mig 224 + cele 3 câmpuri de branding.
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
             -- White-label (mig 236) — editabil din FounderPage.
             'brand_domain',        a.brand_domain,
             'brand_name',          a.brand_name,
             'brand_logo_url',      a.brand_logo_url,
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

revoke all on function public.admin_list_affiliates() from public;
revoke all on function public.admin_list_affiliates() from anon, service_role;
grant execute on function public.admin_list_affiliates() to authenticated;

-- ── Asserții fail-closed ─────────────────────────────────────────────
do $$
declare v_def text;
begin
  -- resolve: anon are EXECUTE, dar definiția NU expune nimic sensibil
  if not has_function_privilege('anon', 'public.resolve_agency_branding(text)', 'execute') then
    raise exception 'mig 236: resolve_agency_branding fără grant anon';
  end if;
  v_def := pg_get_functiondef('public.resolve_agency_branding(text)'::regprocedure);
  if v_def ilike '%referral_code%' or v_def ilike '%_bps%' or v_def ilike '%profile_id%' then
    raise exception 'mig 236: resolve_agency_branding expune câmpuri sensibile';
  end if;
  if v_def not ilike '%''active''%' then
    raise exception 'mig 236: resolve_agency_branding fără filtrul status=active';
  end if;

  -- admin RPC-urile au gate-ul founder
  v_def := pg_get_functiondef('public.admin_set_affiliate_branding(uuid, text, text, text)'::regprocedure);
  if v_def not ilike '%is_platform_admin%' then
    raise exception 'mig 236: admin_set_affiliate_branding fără gate founder';
  end if;
  v_def := pg_get_functiondef('public.admin_list_affiliates()'::regprocedure);
  if v_def not ilike '%is_platform_admin%' or v_def not ilike '%brand_domain%' then
    raise exception 'mig 236: admin_list_affiliates fără gate sau fără branding';
  end if;
  if has_function_privilege('anon', 'public.admin_set_affiliate_branding(uuid, text, text, text)', 'execute') then
    raise exception 'mig 236: admin_set_affiliate_branding accesibil anon';
  end if;

  -- unicitatea domeniului
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'idx_affiliates_brand_domain'
  ) then
    raise exception 'mig 236: indexul unic pe brand_domain lipsește';
  end if;

  raise notice 'mig 236: white-label v1 (branding agenție) OK';
end $$;

commit;
