-- ═══════════════════════════════════════════════════════════════════
-- Migration 231: tichete de masă — fluxul complet peste enum-ul din mig 230
-- ─────────────────────────────────────────────────────────────────────
-- Completează tripleta unică pe piața RO: bon fiscal (mig 030) + tichet de
-- bucătărie (mig 227) + TICHET DE MASĂ (aici). Trei piese, în lanțurile lor:
--   1. order_payments.method acceptă 'meal_voucher' (CHECK-ul numit explicit
--      din mig 229 — drop simplu pe nume, nu mai e cel auto-generat din 017).
--   2. add_partial_payment (lanț 017→111→231): staff-ul poate înregistra
--      tichete de masă; card_online RĂMÂNE respins (plățile online vin DOAR
--      prin Stripe/settle — asserție păstrată din mig 229). Gate-urile din
--      mig 111 (rol owner/manager/waiter + fiscal_receipt/Plan 3) rămân
--      NEATINSE — tichetele sunt bani, regula de aur se aplică integral.
--   3. fiscalnet_payment_code (lanț 030→...→203→231): 'meal_voucher' → 4
--      („tichet masă", tabelul P documentat în BRIDGE_FISCALNET_ARCHITECTURE
--      §3: 1=numerar, 2=card, 3=credit, 4=tichet masă, 8=alte). De
--      re-confirmat cu EconMedia la telefonul din pilot, ca și codul 7.
--
-- Notă legală (v1, responsabilitatea staffului, microcopy în UI): tichetele
-- de masă acoperă legal doar produse alimentare (fără alcool/tutun) — nu
-- impunem filtrarea pe produs în v1 (ar cere clasificarea întregului meniu).
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── 1. order_payments.method += 'meal_voucher' ───────────────────────
alter table public.order_payments drop constraint order_payments_method_check;
alter table public.order_payments
  add constraint order_payments_method_check
  check (method in ('cash', 'card_pos', 'other', 'card_online', 'meal_voucher'));

-- ── 2. add_partial_payment — lanț 017→111→231 ────────────────────────
-- Copie EXACTĂ a corpului din mig 111, cu un singur rând schimbat: lista
-- metodelor acceptate de staff include 'meal_voucher' (card_online NU).
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

grant execute on function public.add_partial_payment(uuid, numeric, text) to authenticated;

-- ── 3. fiscalnet_payment_code — lanț 030→...→203→231 ─────────────────
-- Corp identic cu mig 203 + rândul meal_voucher → 4.
create or replace function public.fiscalnet_payment_code(p_method public.payment_method)
returns smallint
language sql immutable
set search_path = public
as $$
  select case p_method
    when 'cash'         then 1::smallint
    when 'card_pos'     then 2::smallint
    when 'meal_voucher' then 4::smallint
    when 'card_online'  then 7::smallint
    when 'other'        then 8::smallint
    else 1::smallint  -- fallback numerar
  end;
$$;

-- ── Asserții fail-closed ─────────────────────────────────────────────
do $$
declare v_src text;
begin
  -- 1) CHECK-ul acceptă meal_voucher (și încă include card_online).
  select pg_get_constraintdef(oid) into v_src
    from pg_constraint where conname = 'order_payments_method_check';
  if position('meal_voucher' in v_src) = 0 or position('card_online' in v_src) = 0 then
    raise exception 'mig 231: order_payments_method_check incomplet';
  end if;

  -- 2) add_partial_payment: acceptă meal_voucher, respinge ÎN CONTINUARE
  -- card_online (staff-ul nu înregistrează plăți online manual — mig 229),
  -- și păstrează AMBELE gate-uri din mig 111 (rol + fiscal_receipt).
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'add_partial_payment';
  if position($m$('cash', 'card_pos', 'other', 'meal_voucher')$m$ in v_src) = 0 then
    raise exception 'mig 231: add_partial_payment nu acceptă meal_voucher';
  end if;
  if position($m$'card_online'$m$ in v_src) > 0 then
    raise exception 'mig 231: add_partial_payment a primit card_online — interzis (mig 229)';
  end if;
  if position('fiscal_receipt' in v_src) = 0
     or position($m$role in ('owner', 'manager', 'waiter')$m$ in v_src) = 0 then
    raise exception 'mig 231: gate-urile din mig 111 au regresat în add_partial_payment';
  end if;

  -- 3) Maparea fiscală: 4 = tichet masă; 7/1 neregresate.
  if public.fiscalnet_payment_code('meal_voucher'::public.payment_method) <> 4 then
    raise exception 'mig 231: meal_voucher nu e mapat la codul FiscalNet 4';
  end if;
  if public.fiscalnet_payment_code('card_online'::public.payment_method) <> 7
     or public.fiscalnet_payment_code('cash'::public.payment_method) <> 1 then
    raise exception 'mig 231: mapările existente au regresat';
  end if;
end $$;

commit;
