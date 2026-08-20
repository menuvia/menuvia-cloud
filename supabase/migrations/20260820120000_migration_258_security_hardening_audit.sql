-- migration_258_security_hardening_audit.sql
-- =============================================================================
-- Întărire de securitate + corectitudine bani, din auditul critic de platformă
-- (aug 2026). Trei modificări chirurgicale, fiecare cu aserție fail-closed:
--
--   1. add_partial_payment (lanț 017→111→231→258): PLAFON DE SUPRA-ÎNCASARE.
--      RPC-ul accepta orice sumă → un typo de staff (5000 în loc de 50.00)
--      scria paid_amount=5000 și umfla tăcut v_daily_orders/ReportsTab/TVA.
--      advance_order avea deja guard-ul (mig 214/243); aici aducem PARITATEA:
--      suma cumulată nu poate depăși totalul comenzii (+0.01 toleranță).
--      NIMIC alt invariant nu se atinge (whitelist metodă incl. meal_voucher,
--      card_online respins, gate fiscal, gate rol, cast enum payment_method).
--
--   2. get_loyalty_state (mig 226→258): RATE-LIMIT ANTI-ENUMERARE. RPC anon
--      accepta ORICE telefon și dezvăluia dacă e înrolat + soldul de puncte,
--      fără plafon → enumerare de clienți per restaurant. Adăugăm un plafon
--      generos per qr_token (40 interogări / 5 min) — imperceptibil pentru un
--      client real (o singură verificare), letal pentru un scanner de telefoane.
--      Peste plafon: răspuns care NU distinge înrolat de neînrolat.
--
--   3. security_ownership_remediations (mig 096a→258): RLS DENY-ALL explicit.
--      Tabela de audit al remedierilor de ownership se baza EXCLUSIV pe revoke
--      de privilegii (RLS era OFF). Un GRANT viitor accidental ar fi expus-o
--      fără nicio plasă. Enable RLS fără politici = deny-all pentru orice rol
--      ne-bypass (owner-ul tabelei/service_role trec în continuare — DEFINER-ele
--      de remediere și scriptul de remediere rulează ca postgres/service_role).
--
-- Rezolvat empiric în timpul auditului (NU necesită cod, dar acoperit de test în
-- security_hardening_258_assertions.sql SH3): un `authenticated` NU poate ridica
-- profiles.is_platform_admin — mig 096a revocă UPDATE-ul global și re-acordă DOAR
-- 4 coloane (full_name, terms_accepted_at, terms_accepted_version,
-- deletion_requested_at); is_platform_admin nu e în set → UPDATE respins cu
-- SQLSTATE 42501. Testul SH3 îngheață acest invariant contra unei re-lărgiri
-- accidentale a grantului într-o migrație viitoare.
-- =============================================================================

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. add_partial_payment — lanț 017→111→231→258 (+ plafon supra-încasare)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.add_partial_payment(
  p_order_id      uuid,
  p_amount        numeric,
  p_method        text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order       record;
  v_prev_paid   numeric;
  v_total_paid  numeric;
  v_payment_id  uuid;
begin
  if p_method not in ('cash', 'card_pos', 'other', 'meal_voucher') then
    raise exception 'Metodă de plată invalidă.';
  end if;

  if p_amount <= 0 then
    raise exception 'Suma trebuie să fie pozitivă.';
  end if;

  select o.id, o.restaurant_id, o.total, o.status
  into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Comandă negăsită.';
  end if;

  if v_order.status != 'served' then
    raise exception 'Comanda trebuie să fie în status "servit" pentru plată.';
  end if;

  -- Autorizare: membru CU rol de încasare (NU kitchen) — aliniat cu mark_paid.
  if not exists (
    select 1 from public.restaurant_memberships
    where restaurant_id = v_order.restaurant_id
      and user_id = auth.uid()
      and role in ('owner', 'manager', 'waiter')
  ) then
    raise exception 'Nu ai dreptul să încasezi plăți pentru acest restaurant.'
      using hint = 'insufficient_role';
  end if;

  -- Regula de aur: încasarea de bani = bon fiscal = Plan 3. Gate pe feature.
  perform public.enforce_feature_for_restaurant(v_order.restaurant_id, 'fiscal_receipt');

  -- PLAFON DE SUPRA-ÎNCASARE (mig 258, paritate cu advance_order mig 214/243):
  -- suma cumulată nu poate depăși totalul comenzii. Fără el, un typo de staff
  -- (5000 în loc de 50.00) trecea și corupea tăcut paid_amount/rapoartele/TVA.
  -- Toleranță de 0.01 pentru rotunjiri; bacșișul nu trece prin acest RPC (mig 223).
  select coalesce(sum(amount), 0) into v_prev_paid
  from public.order_payments
  where order_id = p_order_id;

  if v_prev_paid + p_amount > v_order.total + 0.01 then
    raise exception 'Suma încasată (% deja + % acum) depășește totalul comenzii (%).',
      v_prev_paid, p_amount, v_order.total
      using errcode = 'P0001', hint = 'overpayment';
  end if;

  insert into public.order_payments (order_id, amount, method, paid_by)
  values (p_order_id, p_amount, p_method, auth.uid())
  returning id into v_payment_id;

  select coalesce(sum(amount), 0) into v_total_paid
  from public.order_payments
  where order_id = p_order_id;

  if v_total_paid >= v_order.total then
    update public.orders
    set status = 'paid',
        paid_at = now(),
        paid_by = auth.uid(),
        -- payment_method e enum public.payment_method — castăm explicit (originalul
        -- din mig 017 atribuia text → eroare la calea „fully paid", bug latent reparat aici).
        payment_method = case
          when (select count(distinct method) from public.order_payments where order_id = p_order_id) = 1
          then p_method::public.payment_method
          else 'other'::public.payment_method
        end,
        paid_amount = v_total_paid
    where id = p_order_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'payment_id', v_payment_id,
    'total_paid', v_total_paid,
    'remaining', greatest(v_order.total - v_total_paid, 0),
    'fully_paid', v_total_paid >= v_order.total
  );
end;
$$;

revoke all on function public.add_partial_payment(uuid, numeric, text) from public;
grant execute on function public.add_partial_payment(uuid, numeric, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. get_loyalty_state — lanț 226→258 (+ rate-limit anti-enumerare)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_loyalty_state(
  p_qr_token_id uuid,
  p_anon_id     text default null,
  p_phone       text default null
) returns jsonb
-- VOLATILE (mig 258): înainte era STABLE, dar rate-limit-ul scrie în
-- function_rate_limits prin check_rate_limit → funcția are acum efect secundar.
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_token   record;
  v_prog    public.loyalty_programs;
  v_wallet  public.loyalty_wallets;
  v_hash    text;
begin
  select qt.restaurant_id into v_token
  from public.qr_tokens qt
  where qt.id = p_qr_token_id and qt.is_active = true;
  if not found then
    return jsonb_build_object('enabled', false);
  end if;

  if not public.fn_loyalty_active(v_token.restaurant_id) then
    return jsonb_build_object('enabled', false);
  end if;

  -- RATE-LIMIT ANTI-ENUMERARE (mig 258): un scanner care variază p_phone pe
  -- ACELAȘI token (singurul pe care-l are după scanare) ar enumera clienții
  -- înrolați + soldurile. Plafon 40 interogări / 5 min per token — o verificare
  -- reală de client trece lejer. STABLE permite scriere în funcția SECURITY
  -- DEFINER (check_rate_limit e VOLATILE, dar apelul e permis din corp).
  -- Peste plafon: răspuns care NU distinge înrolat de neînrolat (fără short_code/puncte).
  if not public.check_rate_limit('get_loyalty_state', p_qr_token_id::text, 40, 5) then
    return jsonb_build_object('enabled', true, 'rate_limited', true);
  end if;

  select * into v_prog from public.loyalty_programs
   where restaurant_id = v_token.restaurant_id;

  -- Wallet-ul: telefonul (dacă e valid) are prioritate, altfel cardul anonim.
  v_hash := public.fn_loyalty_phone_hash(p_phone);
  if v_hash is not null then
    select * into v_wallet from public.loyalty_wallets
     where restaurant_id = v_token.restaurant_id and phone_hash = v_hash;
  end if;
  if v_wallet.id is null and p_anon_id is not null then
    select * into v_wallet from public.loyalty_wallets
     where restaurant_id = v_token.restaurant_id and anon_id = p_anon_id;
  end if;

  return jsonb_build_object(
    'enabled', true,
    'points_per_leu', v_prog.points_per_leu,
    'reward_threshold', v_prog.reward_threshold,
    'reward_description', v_prog.reward_description,
    'points', coalesce(v_wallet.points, 0),
    'short_code', v_wallet.short_code,
    'reward_available', coalesce(v_wallet.points, 0) >= v_prog.reward_threshold
  );
end$$;

revoke all on function public.get_loyalty_state(uuid, text, text) from public;
grant execute on function public.get_loyalty_state(uuid, text, text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. security_ownership_remediations — RLS deny-all (defense-in-depth)
-- ─────────────────────────────────────────────────────────────────────────────
-- Fără politici = deny-all pentru orice rol ne-bypass. Owner-ul tabelei
-- (postgres) și service_role (BYPASSRLS) trec în continuare, deci DEFINER-ele
-- de remediere și scripts/apply_ownership_remediation.sql rămân neafectate.
alter table public.security_ownership_remediations enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- Aserții fail-closed (o migrație care pierde un invariant pică la replay în CI)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_src text;
begin
  -- 1. add_partial_payment: plafonul + TOATE gate-urile păstrate.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'add_partial_payment';
  if v_src is null then raise exception 'mig 258: add_partial_payment lipsește'; end if;
  if position('overpayment' in v_src) = 0 then
    raise exception 'mig 258: plafonul de supra-încasare lipsește din add_partial_payment'; end if;
  if position('meal_voucher' in v_src) = 0 then
    raise exception 'mig 258: whitelist-ul meal_voucher (mig 231) a regresat'; end if;
  if position('card_online' in v_src) <> 0 then
    raise exception 'mig 258: card_online a apărut în add_partial_payment (interzis, mig 229)'; end if;
  if position('fiscal_receipt' in v_src) = 0 then
    raise exception 'mig 258: gate-ul fiscal (mig 111) a regresat'; end if;
  if position('insufficient_role' in v_src) = 0 then
    raise exception 'mig 258: gate-ul de rol (mig 111) a regresat'; end if;

  -- 2. get_loyalty_state: rate-limit prezent, grant anon păstrat.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_loyalty_state';
  if position('check_rate_limit' in v_src) = 0 then
    raise exception 'mig 258: rate-limit-ul anti-enumerare lipsește din get_loyalty_state'; end if;
  if not has_function_privilege('anon', 'public.get_loyalty_state(uuid, text, text)', 'execute') then
    raise exception 'mig 258: get_loyalty_state trebuie să rămână apelabil de anon'; end if;

  -- 3. RLS pe tabela de remedieri de ownership.
  if not exists (
    select 1 from pg_class where relname = 'security_ownership_remediations' and relrowsecurity
  ) then
    raise exception 'mig 258: RLS nu e activat pe security_ownership_remediations'; end if;

  -- 4. Invariantul #1 din audit: authenticated NU poate UPDATA is_platform_admin.
  --    (Verificare de configurație — grantul de coloană NU include flag-ul;
  --     comportamentul runtime e acoperit de SH3 în suita de teste.)
  if has_column_privilege('authenticated', 'public.profiles', 'is_platform_admin', 'update') then
    raise exception 'mig 258: authenticated poate UPDATA is_platform_admin — escaladare de privilegii!'; end if;
end $$;

commit;
