-- =============================================================================
-- Mig 308: reacceptarea contractului de agent / șef de vânzări
-- =============================================================================
-- Contextul (mig 304): contractul rețelei e publicat de fondator ca PERECHE
-- `{version, text_hash}`, iar acceptarea (versiune, sha256 al textului afișat,
-- CUI) se face O SINGURĂ DATĂ, la răscumpărarea invitației. `get_sales_network`
-- calcula deja `needs_acceptance`, dar:
--   (1) NU exista nicio cale prin care un membru să accepte o versiune NOUĂ:
--       singurul scriitor al lui `affiliate_contract_acceptances` era
--       `sales_invite_redeem`, iar invitația se consumă o dată. Flag-ul ar fi
--       rămas `true` pe veci după prima republicare (reziduul consemnat în #313);
--   (2) flag-ul compara doar VERSIUNEA: o republicare a ALTUI text sub aceeași
--       versiune (permisă de `admin_set_sales_contract_version`; IN25 o folosește)
--       nu cerea nicio reacceptare, deși hash-ul acceptat nu mai era al textului
--       publicat;
--   (3) flag-ul era `true` și pentru afiliații VECHI (programul public, fără
--       `sales_role`), care nu au ce accepta.
--
-- Ce face:
--   §1 `accept_sales_contract(p_contract_version, p_contract_hash)` — DEFINER
--      `public, pg_temp`, EXECUTE doar `authenticated`. Aceleași verificări de
--      contract, în ACEEAȘI ordine, ca răscumpărarea (nepublicat → versiune →
--      hash non-hex → hash ≠ publicat). Doar membrii rețelei (`sales_role` setat,
--      `not_an_affiliate` altfel), ne-închiși și ne-șterși (`account_closed`; un cont
--      SUSPENDAT poate accepta — acceptarea e dovadă, nu acordă nimic). Rândul
--      afiliatului e blocat `for update` (două acceptări simultane se
--      serializează, a doua vede rândul primei și întoarce `already`). Idempotent
--      pe perechea (versiune, hash) a ULTIMEI acceptări. Rândul nou e APPEND-ONLY
--      (trigger-ul din 304 rămâne), cu `invitation_id` NULL și CUI-ul ULTIMEI
--      acceptări — reacceptarea nu e o cale de a schimba CUI-ul (unicitatea lui,
--      IN22, se verifică la răscumpărare; o schimbare de CUI e act de fondator).
--      Rate limit 10/15 min per utilizator, ca răscumpărarea.
--   §2 `get_sales_network()` — copie VERBATIM a definiției din 304, cu exact trei
--      schimbări: citește și `text_hash` al ultimei acceptări, `needs_acceptance`
--      se calculează pe PERECHE și doar pentru membrii rețelei, iar
--      `current_text_hash` refolosește aceeași valoare. Forma răspunsului e
--      NESCHIMBATĂ (IN15 o îngheață).
--
-- NU gate-uiește nimic pe acceptarea la zi (invitații, comisioane, plăți): ce
-- se întâmplă cu un membru care nu acceptă o versiune nouă e decizie de fondator
-- (consemnată în CLAUDE.md). Teste KA1–KA9 în tests/sql/auto/308_*.
-- =============================================================================

begin;

-- ── §1. accept_sales_contract ────────────────────────────────────────────────
create or replace function public.accept_sales_contract(
  p_contract_version text,
  p_contract_hash    text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_version  text;
  v_hash     text;
  v_pub_hash text;
  v_me       public.affiliates%rowtype;
  v_last     public.affiliate_contract_acceptances%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if not public.check_rate_limit('accept_sales_contract', v_uid::text, 10, 15) then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  -- Contractul: aceleași motive, în aceeași ordine, ca sales_invite_redeem (304).
  v_version := public.sales_contract_published_version();
  if v_version is null then
    return jsonb_build_object('ok', false, 'reason', 'contract_not_published');
  end if;
  if btrim(coalesce(p_contract_version, '')) <> v_version then
    return jsonb_build_object('ok', false, 'reason', 'contract_version_mismatch');
  end if;
  v_hash := lower(btrim(coalesce(p_contract_hash, '')));
  if v_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'reason', 'contract_hash_invalid');
  end if;
  v_pub_hash := public.sales_contract_published_hash();
  if v_pub_hash is null or v_hash <> v_pub_hash then
    return jsonb_build_object('ok', false, 'reason', 'contract_hash_mismatch');
  end if;

  -- Membrul rețelei, blocat: acceptările simultane se serializează, iar o
  -- închidere concurentă (admin_set_affiliate_status ia același rând) e așteptată.
  select * into v_me from public.affiliates where profile_id = v_uid for update;
  if not found or v_me.sales_role is null then
    return jsonb_build_object('ok', false, 'reason', 'not_an_affiliate');
  end if;
  -- Fail-closed pe stare: doar active / suspended (un suspendat poate accepta —
  -- acceptarea e dovadă, nu redă nimic); `closed` e terminal (tombstone GDPR).
  if v_me.status not in ('active', 'suspended') or v_me.erased_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'account_closed');
  end if;

  select * into v_last
    from public.affiliate_contract_acceptances
   where affiliate_id = v_me.id
   order by accepted_at desc, id desc
   limit 1;
  if not found then
    -- Nu se poate întâmpla prin fluxurile din 304 (rolul se dă DOAR la
    -- răscumpărare, în același pas cu prima acceptare). Fail-closed: fără CUI
    -- declarat nu fabricăm o dovadă.
    return jsonb_build_object('ok', false, 'reason', 'no_prior_acceptance');
  end if;

  if v_last.contract_version = v_version and v_last.text_hash = v_hash then
    return jsonb_build_object('ok', true, 'already', true,
      'version', v_version, 'accepted_at', v_last.accepted_at);
  end if;

  insert into public.affiliate_contract_acceptances
    (affiliate_id, kind, contract_version, text_hash, declared_cui, invitation_id)
  values
    (v_me.id, v_me.sales_role, v_version, v_hash, v_last.declared_cui, null)
  returning * into v_last;

  return jsonb_build_object('ok', true, 'already', false,
    'version', v_version, 'accepted_at', v_last.accepted_at);
end;
$$;

revoke all on function public.accept_sales_contract(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.accept_sales_contract(text, text) to authenticated;

comment on function public.accept_sales_contract(text, text) is
  'mig 308: un membru al rețelei de vânzări acceptă versiunea PUBLICATĂ a contractului (versiune + sha256 al textului afișat). Append-only, idempotent pe pereche, CUI-ul ultimei acceptări.';

-- ── §2. get_sales_network — needs_acceptance pe (versiune, hash) ─────────────
create or replace function public.get_sales_network()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_current  text := public.sales_contract_published_version();
  v_me       public.affiliates%rowtype;
  v_acc_ver  text;
  v_acc_at   timestamptz;
  v_acc_hash text;                                   -- mig 308
  v_pub_hash text := public.sales_contract_published_hash();   -- mig 308
  v_head_row public.affiliates%rowtype;
  v_head_p   public.profiles%rowtype;
  v_head     jsonb := null;
  v_team     jsonb := '[]'::jsonb;
  v_invites  jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select * into v_me from public.affiliates where profile_id = v_uid;
  if not found then
    return jsonb_build_object('ok', true, 'role', null, 'status', null,
      'affiliate_id', null, 'contact_sharing', false,
      'contract', jsonb_build_object('current_version', v_current,
        'accepted_version', null, 'accepted_at', null, 'needs_acceptance', false,
        'current_text_hash', public.sales_contract_published_hash()),
      'head', null, 'team', '[]'::jsonb, 'open_invites', '[]'::jsonb,
      'limits', jsonb_build_object('open_invites_max', public.sales_open_invites_max(),
                                   'invite_ttl_days', public.sales_invite_ttl_days()));
  end if;

  select ca.contract_version, ca.accepted_at, ca.text_hash into v_acc_ver, v_acc_at, v_acc_hash
    from public.affiliate_contract_acceptances ca
   where ca.affiliate_id = v_me.id
   order by ca.accepted_at desc, ca.id desc limit 1;

  -- Agentul: cardul șefului (contact doar cu consimțământul ȘEFULUI).
  if v_me.sales_role = 'agent' and v_me.parent_affiliate_id is not null then
    select * into v_head_row from public.affiliates where id = v_me.parent_affiliate_id;
    if found then
      select * into v_head_p from public.profiles where id = v_head_row.profile_id;
      v_head := jsonb_build_object(
        'affiliate_id',   v_head_row.id,
        'status',         v_head_row.status,
        'contact_shared', (v_head_row.contact_sharing and v_head_row.erased_at is null),
        'name',  case when v_head_row.contact_sharing and v_head_row.erased_at is null then v_head_p.full_name end,
        'phone', case when v_head_row.contact_sharing and v_head_row.erased_at is null then v_head_row.phone end,
        'email', case when v_head_row.contact_sharing and v_head_row.erased_at is null then v_head_p.email end);
    end if;
  end if;

  -- Șeful ACTIV: recruții lui DIRECȚI + invitațiile deschise (fără token/hash).
  if v_me.sales_role = 'head' and v_me.status = 'active' then
    select coalesce(jsonb_agg(t.j order by t.ord), '[]'::jsonb) into v_team
      from (
        select row_number() over (order by a.created_at, a.id) as ord,
               jsonb_build_object(
                 'affiliate_id',   a.id,
                 'ordinal',        row_number() over (order by a.created_at, a.id),
                 'status',         a.status,
                 'joined_at',      a.created_at,
                 'contact_shared', (a.contact_sharing and a.erased_at is null),
                 'name',  case when a.contact_sharing and a.erased_at is null then p.full_name end,
                 'phone', case when a.contact_sharing and a.erased_at is null then a.phone end,
                 'email', case when a.contact_sharing and a.erased_at is null then p.email end,
                 'clients_total',  (select count(*) from public.affiliate_attributions aa
                                     where aa.affiliate_id = a.id),
                 'clients_active', (select count(*) from public.affiliate_attributions aa
                                     where aa.affiliate_id = a.id and aa.status = 'active'),
                 'agent_earned_ron_cents', coalesce((
                     select sum(l.amount_cents) from public.affiliate_ledger l
                      where l.affiliate_id = a.id and l.currency = 'RON'
                        and l.leg in ('setup', 'recurring', 'clawback')), 0),
                 'head_bonus_ron_cents', coalesce((
                     select sum(l.amount_cents) from public.affiliate_ledger l
                      where l.affiliate_id = v_me.id and l.currency = 'RON'
                        and l.leg in ('cascade', 'clawback')
                        and l.attribution_id in (select aa.id from public.affiliate_attributions aa
                                                  where aa.affiliate_id = a.id)), 0),
                 'last_sale_at', (select max(l.created_at) from public.affiliate_ledger l
                                   where l.affiliate_id = a.id and l.leg in ('setup', 'recurring'))
               ) as j
          from public.affiliates a
          left join public.profiles p on p.id = a.profile_id
         where a.parent_affiliate_id = v_me.id and a.sales_role = 'agent'
      ) t;

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', i.id, 'note', i.note,
             'created_at', i.created_at, 'expires_at', i.expires_at)
           order by i.created_at desc, i.id), '[]'::jsonb) into v_invites
      from public.affiliate_invitations i
     where i.invited_by_affiliate_id = v_me.id and i.kind = 'agent'
       and i.used_at is null and i.revoked_at is null
       and i.expires_at > clock_timestamp();
  end if;

  return jsonb_build_object(
    'ok', true,
    'role', v_me.sales_role,
    'status', v_me.status,
    'affiliate_id', v_me.id,
    'contact_sharing', v_me.contact_sharing,
    'contract', jsonb_build_object(
      'current_version',  v_current,
      'accepted_version', v_acc_ver,
      'accepted_at',      v_acc_at,
      -- mig 308: pe PERECHEA (versiune, hash) și doar pentru membrii rețelei.
      -- Înainte: doar pe versiune (o republicare a ALTUI text sub aceeași
      -- versiune nu cerea nimic) și „true" și pentru afiliații vechi fără rol,
      -- care nu au ce accepta (accept_sales_contract → not_an_affiliate).
      'needs_acceptance', (v_me.sales_role is not null and v_current is not null
                           and (v_acc_ver is distinct from v_current
                                or v_acc_hash is distinct from v_pub_hash)),
      'current_text_hash', v_pub_hash),
    'head', v_head,
    'team', v_team,
    'open_invites', v_invites,
    'limits', jsonb_build_object('open_invites_max', public.sales_open_invites_max(),
                                 'invite_ttl_days', public.sales_invite_ttl_days()));
end;
$$;

revoke all on function public.get_sales_network() from public, anon, authenticated, service_role;
grant execute on function public.get_sales_network() to authenticated;

-- ── Asserții fail-closed ─────────────────────────────────────────────────────
do $$
declare
  v_def text;
  v_n   int;
begin
  -- (a) o singură semnătură pentru fiecare funcție (anti PGRST203)
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'accept_sales_contract';
  if v_n <> 1 then raise exception 'mig 308: accept_sales_contract are % semnături', v_n; end if;

  -- (b) DEFINER + pg_temp pe ambele
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('accept_sales_contract', 'get_sales_network')
                and (not p.prosecdef
                     or not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
                                     where c like 'search_path=%pg_temp%'))) then
    raise exception 'mig 308: accept_sales_contract / get_sales_network fără DEFINER + pg_temp';
  end if;

  -- (c) EXECUTE: doar authenticated (privilegiu EFECTIV, nu text de ACL)
  if has_function_privilege('anon', 'public.accept_sales_contract(text, text)', 'execute')
     or has_function_privilege('service_role', 'public.accept_sales_contract(text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.accept_sales_contract(text, text)', 'execute') then
    raise exception 'mig 308: privilegiile accept_sales_contract nu sunt doar authenticated';
  end if;

  -- (d) clauzele care fac corectitudinea, ancorate pe COD (nu pe comentarii)
  select pg_get_functiondef('public.accept_sales_contract(text, text)'::regprocedure) into v_def;
  if v_def !~ 'from public\.affiliates where profile_id = v_uid for update;'
     or position('check_rate_limit(''accept_sales_contract''' in v_def) = 0
     or v_def !~ 'v_last\.contract_version = v_version and v_last\.text_hash = v_hash' then
    raise exception 'mig 308: accept_sales_contract a pierdut for update / rate limit / idempotența pe pereche';
  end if;

  -- (e) needs_acceptance pe PERECHE și doar pentru membrii rețelei
  select pg_get_functiondef('public.get_sales_network()'::regprocedure) into v_def;
  if v_def !~ 'v_me\.sales_role is not null and v_current is not null'
     or v_def !~ 'or v_acc_hash is distinct from v_pub_hash' then
    raise exception 'mig 308: get_sales_network nu calculează needs_acceptance pe (versiune, hash)';
  end if;
end $$;

commit;
