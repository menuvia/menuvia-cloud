-- Migration 330: hint pe refuzurile fără hint ale cardurilor de cont (lotul L8d)
--
-- Problema: personalul vede erorile în limba lui prin `describeStaffError`
-- (src/i18n/staffErrors.ts), al cărui contract cu serverul e HINT-ul
-- (convenția de la mig 290; de la 323 încolo orice `raise` nou poartă hint).
-- Două RPC-uri chemate din Setări → Cont n-aveau NICIUN hint, deci clientul
-- (lotul L6b, src/lib/accountRefusals.ts) le recunoștea după ÎNCEPUTUL textului
-- românesc — o potrivire pe text care se rupe la prima reformulare:
--   • `request_account_deletion()` (042, GdprCard): „Aveți un abonament activ…”;
--   • `set_my_mfa_enforced(boolean)` (235, MfaCard): „Dezactivarea MFA cere o
--     sesiune verificată cu MFA (aal2)” — clichetul anti-downgrade.
--
-- Ce face: recreează AMBELE funcții VERBATIM din definiția vie (o singură
-- definiție fiecare: 042, respectiv 235 — nicio migrație ulterioară nu le-a
-- recreat; 262 a pus `pg_temp` prin ALTER pe prima) și adaugă `hint` pe FIECARE
-- `raise`, cu ACELAȘI mesaj și ACELAȘI ERRCODE (P0001 implicit — niciun `raise`
-- n-avea errcode). Hint-ul e contractul:
--   request_account_deletion: `auth_required`, `active_subscription`;
--   set_my_mfa_enforced:      `auth_required`, `invalid_parameter`,
--                             `mfa_aal2_required`.
-- `create or replace` cu ACEEAȘI semnătură, FĂRĂ DROP: ACL-ul viu se păstrează
-- (inclusiv grant-urile de platformă ale lui service_role, neatinse aici);
-- `set search_path = public, pg_temp` e scris EXPLICIT fiindcă `create or
-- replace` rescrie `proconfig` (altfel pg_temp-ul pus de 262 prin ALTER s-ar
-- pierde tăcut pe 042). Revoke/grant re-afirmate per rol: PUBLIC și anon fără
-- EXECUTE, authenticated cu EXECUTE (clientul le cheamă).
--
-- Invariante păstrate (asertate mai jos, fail-closed, și permanent în
-- tests/sql/auto/330_staff_error_hints.sql):
--   request_account_deletion: DEFINER `public, pg_temp`; verificarea
--     abonamentului activ (plan ≠ free + `stripe_subscription_id`) ÎNAINTEA
--     scrierii; marcajul `deletion_requested_at = now()`; numărarea facturilor
--     arhivate tolerantă la `undefined_table`; răspunsul jsonb neschimbat;
--   set_my_mfa_enforced: DEFINER `public, pg_temp`; clichetul anti-downgrade
--     (`not p_enforced and fn_session_aal() <> 'aal2'` → refuz) ÎNAINTEA
--     UPDATE-ului; activarea liberă; răspunsul jsonb neschimbat.
--
-- Toleranță: un client vechi nu citește hint-ul (afișează mesajul, identic);
-- un client nou pe o bază fără 330 cade pe potrivirea pe text (păstrată în
-- accountRefusals.ts ca rezervă). Ordinea de deploy e liberă.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── 1. request_account_deletion (042 → 330) ─────────────────────────────────
create or replace function public.request_account_deletion()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_has_active_subscription boolean;
  v_invoices_kept integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Autentificare necesară'
      using hint = 'auth_required';
  end if;

  -- Verifică abonament activ — anulare obligatorie prin Stripe Portal întâi
  select coalesce(
    (plan is not null and plan != 'free' and stripe_subscription_id is not null),
    false
  )
    into v_has_active_subscription
    from public.profiles where id = v_user_id;

  if v_has_active_subscription then
    raise exception 'Aveți un abonament activ. Anulați-l prin Portal Stripe înainte de a șterge contul.'
      using hint = 'active_subscription';
  end if;

  -- Marchez pentru ștergere (cron-ul efectuează la D+30)
  update public.profiles
    set deletion_requested_at = now()
   where id = v_user_id;

  -- Număr facturi care rămân arhivate (10 ani conform Legii 82/1991)
  begin
    select count(*) into v_invoices_kept
      from public.invoices i
      join public.restaurants r on r.id = i.restaurant_id
     where r.owner_id = v_user_id;
  exception when undefined_table then
    v_invoices_kept := 0;
  end;

  return jsonb_build_object(
    'success',                true,
    'deletion_scheduled_at',  (now() + interval '30 days'),
    'invoices_archived',      v_invoices_kept,
    'message',                'Contul va fi șters în 30 zile. Pentru anulare, scrieți la privacy@menuvia.ro.'
  );
end;
$$;

revoke all on function public.request_account_deletion() from public, anon;
grant execute on function public.request_account_deletion() to authenticated;

-- ── 2. set_my_mfa_enforced (235 → 330) ──────────────────────────────────────
create or replace function public.set_my_mfa_enforced(p_enforced boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Autentificare necesară'
      using hint = 'auth_required';
  end if;
  if p_enforced is null then
    raise exception 'Parametru invalid'
      using hint = 'invalid_parameter';
  end if;

  -- Clichetul anti-downgrade: OFF doar dintr-o sesiune care a trecut MFA.
  if not p_enforced and public.fn_session_aal() <> 'aal2' then
    raise exception 'Dezactivarea MFA cere o sesiune verificată cu MFA (aal2)'
      using hint = 'mfa_aal2_required';
  end if;

  update public.profiles set mfa_enforced = p_enforced where id = v_uid;

  return jsonb_build_object('ok', true, 'mfa_enforced', p_enforced);
end;
$$;

revoke all on function public.set_my_mfa_enforced(boolean) from public, anon;
grant execute on function public.set_my_mfa_enforced(boolean) to authenticated;

-- ── Asserții fail-closed ────────────────────────────────────────────────────
do $$
declare
  r          record;
  v_src      text;
  v_raises   int;
  v_hinted   int;
begin
  for r in
    select * from (values
      ('request_account_deletion', 'public.request_account_deletion()',
       array['auth_required', 'active_subscription'],
       array['stripe_subscription_id is not null', 'set deletion_requested_at = now()', 'when undefined_table']),
      ('set_my_mfa_enforced', 'public.set_my_mfa_enforced(boolean)',
       array['auth_required', 'invalid_parameter', 'mfa_aal2_required'],
       array['not p_enforced and public.fn_session_aal() <> ''aal2''', 'update public.profiles set mfa_enforced = p_enforced'])
    ) as t(name, sig, hints, invariants)
  loop
    -- O singură semnătură (fără overload lăsat în urmă).
    if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = r.name) <> 1 then
      raise exception 'mig 330: % are mai multe semnături', r.name;
    end if;
    -- DEFINER + search_path cu pg_temp.
    if not (select p.prosecdef from pg_proc p where p.oid = r.sig::regprocedure) then
      raise exception 'mig 330: % nu mai e SECURITY DEFINER', r.name;
    end if;
    if not exists (select 1 from pg_proc p, unnest(p.proconfig) c
                    where p.oid = r.sig::regprocedure and c = 'search_path=public, pg_temp') then
      raise exception 'mig 330: % fără search_path = public, pg_temp', r.name;
    end if;
    -- Fiecare `raise exception` are hint, iar fiecare hint e în corp.
    v_src := (select p.prosrc from pg_proc p where p.oid = r.sig::regprocedure);
    v_raises := (select count(*) from regexp_matches(v_src, 'raise\s+exception', 'gi'));
    v_hinted := (select count(*) from regexp_matches(v_src, 'raise\s+exception[^;]*using\s+hint\s*=', 'gi'));
    if v_raises = 0 or v_raises <> v_hinted then
      raise exception 'mig 330: % are % raise, dintre care % cu hint', r.name, v_raises, v_hinted;
    end if;
    for i in 1 .. array_length(r.hints, 1) loop
      if position('hint = ''' || r.hints[i] || '''' in v_src) = 0 then
        raise exception 'mig 330: % fără hint-ul %', r.name, r.hints[i];
      end if;
    end loop;
    -- Invariantele moștenite (042 / 235).
    for i in 1 .. array_length(r.invariants, 1) loop
      if position(r.invariants[i] in v_src) = 0 then
        raise exception 'mig 330: % a pierdut invariantul „%”', r.name, r.invariants[i];
      end if;
    end loop;
    -- ACL: anon / PUBLIC fără EXECUTE, authenticated cu EXECUTE.
    if has_function_privilege('anon', r.sig, 'execute') then
      raise exception 'mig 330: % executabil de anon', r.name;
    end if;
    if not has_function_privilege('authenticated', r.sig, 'execute') then
      raise exception 'mig 330: % nu mai e executabil de authenticated', r.name;
    end if;
    if exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                where p.oid = r.sig::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception 'mig 330: % are EXECUTE pentru PUBLIC', r.name;
    end if;
  end loop;

  -- Clichetul anti-downgrade stă ÎNAINTEA UPDATE-ului (ordinea din 235).
  v_src := (select p.prosrc from pg_proc p where p.oid = 'public.set_my_mfa_enforced(boolean)'::regprocedure);
  if position('fn_session_aal() <> ''aal2''' in v_src) > position('update public.profiles' in v_src) then
    raise exception 'mig 330: clichetul aal2 nu mai precedă UPDATE-ul';
  end if;
  -- Verificarea abonamentului precedă marcajul de ștergere (ordinea din 042).
  -- Ancora e LITERALUL hint-ului, nu `active_subscription` gol: acela apare
  -- întâi în DECLARE (`v_has_active_subscription`), deci comparația ar fi
  -- trecut mereu, oricât de jos ar fi coborât `raise`-ul.
  v_src := (select p.prosrc from pg_proc p where p.oid = 'public.request_account_deletion()'::regprocedure);
  if position('hint = ''active_subscription''' in v_src) = 0
     or position('set deletion_requested_at' in v_src) = 0
     or position('hint = ''active_subscription''' in v_src) > position('set deletion_requested_at' in v_src) then
    raise exception 'mig 330: refuzul abonamentului activ nu mai precedă marcajul';
  end if;

  raise notice 'mig 330: hint pe refuzurile cardurilor de cont (request_account_deletion, set_my_mfa_enforced) OK';
end $$;

commit;
