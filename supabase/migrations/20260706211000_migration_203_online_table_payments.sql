-- ═══════════════════════════════════════════════════════════════════
-- Migration 203: plata online la masă — Etapa 1 (design: docs/ONLINE_PAYMENT.md)
-- ─────────────────────────────────────────────────────────────────────
-- Regula de aur: banii ating bonul fiscal → Plan 3, gate ÎN RPC.
--   1. restaurants.stripe_account_id (Connect Standard; setat DOAR prin
--      funcția Netlify de onboarding, cu service_role — coloana NU primește
--      grant de UPDATE pentru authenticated).
--   2. Tabela table_payments (o plată = toată nota mesei; RLS: citire doar
--      admin de restaurant; scrieri EXCLUSIV prin RPC-urile de mai jos).
--   3. Seed plan_features['online_payments'] (pro/enterprise ON) + seed
--      platform_settings['online_payment_fee_bps'] (taxa Menuvia, default 0).
--   4. fiscalnet_payment_code: 'card_online' → 7 („Plata modernă";
--      ⚠️ de confirmat cu EconMedia la apelul din Faza 3 — o singură funcție
--      de schimbat dacă spun altceva).
--   5. RPC-uri SECURITY DEFINER, search_path=public,pg_temp, EXECUTE DOAR
--      service_role (le cheamă exclusiv funcțiile Netlify):
--        begin_table_payment(session, token) → sumă server-side + rând nou
--        attach_payment_intent(payment, intent) → leagă PaymentIntent-ul
--        settle_table_payment(intent, outcome) → idempotent; marchează
--          comenzile 'paid' cu payment_method='card_online' → triggerul
--          existent enqueue_fiscal_receipt duce bonul spre bridge.
-- Teste permanente: tests/sql/table_payment_assertions.sql (sql-verify.yml).
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ── 1. restaurants.stripe_account_id ─────────────────────────────────
alter table public.restaurants
  add column if not exists stripe_account_id text;

comment on column public.restaurants.stripe_account_id is
  $$Contul Stripe Connect (Standard) al restaurantului — acct_... Setat DOAR
prin funcția de onboarding (service_role). NU e în RESTAURANT_UPDATE_FIELDS
și NU are grant de UPDATE pentru authenticated (column-gating, ca slug).$$;

-- ── 2. Tabela table_payments ─────────────────────────────────────────
create table if not exists public.table_payments (
  id                       uuid primary key default gen_random_uuid(),
  restaurant_id            uuid not null references public.restaurants(id) on delete cascade,
  session_id               uuid not null references public.table_sessions(id) on delete cascade,
  order_ids                uuid[] not null,
  amount                   numeric(12,2) not null check (amount > 0),
  currency                 text not null default 'RON',
  application_fee          numeric(12,2) not null default 0 check (application_fee >= 0),
  stripe_payment_intent_id text unique,
  status                   text not null default 'created'
    check (status in ('created','processing','succeeded','failed','canceled')),
  error_info               text,
  settle_note              text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists table_payments_session_idx
  on public.table_payments(session_id, created_at desc);
create index if not exists table_payments_restaurant_idx
  on public.table_payments(restaurant_id, created_at desc);

alter table public.table_payments enable row level security;

-- Citire: adminul restaurantului (owner/manager prin is_admin; founderul și
-- partenerii moștenesc prin extensiile is_admin din mig 186/187).
drop policy if exists table_payments_admin_read on public.table_payments;
create policy table_payments_admin_read
  on public.table_payments for select
  using (public.is_admin(restaurant_id));

-- Default privileges (Supabase) dau CRUD complet la anon/authenticated pe
-- tabelele noi — le tăiem întâi pe TOATE, apoi dăm înapoi doar SELECT.
revoke all on public.table_payments from public, anon, authenticated;
grant select on public.table_payments to authenticated;
-- Fără INSERT/UPDATE/DELETE pentru nimeni: scrierile trec prin RPC-urile
-- SECURITY DEFINER de mai jos (owner postgres ocolește RLS).

-- ── 3. Seeds: plan gate + taxa platformei ────────────────────────────
insert into public.plan_features (plan, feature, enabled, limit_value) values
  ('free',       'online_payments', false, null),
  ('starter',    'online_payments', false, null),
  ('growth',     'online_payments', false, null),
  ('pro',        'online_payments', true,  null),
  ('enterprise', 'online_payments', true,  null)
on conflict (plan, feature) do update set enabled = excluded.enabled;

-- Taxa Menuvia pe tranzacție (bps). Default 0 — fondatorul o setează când
-- decide pricing-ul tranzacțional (<135 bps per MASTER_PLAN §5).
insert into public.platform_settings (key, value)
values ('online_payment_fee_bps', '{"bps":0}'::jsonb)
on conflict (key) do nothing;

-- ── 4. fiscalnet_payment_code: card_online → 7 (Plata modernă) ───────
-- 1=Numerar, 2=Card(POS fizic), 3=Credit, 4=Tichet masă, 5=Tichet valoric,
-- 6=Voucher, 7=Plata modernă (online/app), 8=Alte modalități.
create or replace function public.fiscalnet_payment_code(p_method public.payment_method)
returns smallint
language sql immutable
set search_path = public
as $$
  select case p_method
    when 'cash'        then 1::smallint
    when 'card_pos'    then 2::smallint
    when 'card_online' then 7::smallint
    when 'other'       then 8::smallint
    else 1::smallint  -- fallback numerar
  end;
$$;

-- ── 5a. begin_table_payment ──────────────────────────────────────────
create or replace function public.begin_table_payment(
  p_session_id uuid,
  p_token      text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sess       record;
  v_tok        record;
  v_account    text;
  v_amount     numeric := 0;
  v_order_ids  uuid[];
  v_fee_bps    integer := 0;
  v_fee        numeric := 0;
  v_payment_id uuid;
begin
  -- Sesiune deschisă (lock: două begin-uri concurente pe aceeași masă se
  -- serializează; fiecare produce propriul rând — Stripe deduplică pe intent).
  select id, restaurant_id, table_id, status
    into v_sess
    from public.table_sessions
   where id = p_session_id
     for update;
  if not found or v_sess.status <> 'open' then
    raise exception 'Sesiunea de masă nu este deschisă.'
      using errcode = 'P0001', hint = 'invalid_session';
  end if;

  -- Token-ul QR trebuie să aparțină ACELEIAȘI mese (dovada că plătitorul
  -- chiar e la masă, nu ghicește session id-uri).
  select table_id, restaurant_id
    into v_tok
    from public.qr_tokens
   where token = p_token
     and is_active;
  if not found
     or v_tok.table_id <> v_sess.table_id
     or v_tok.restaurant_id <> v_sess.restaurant_id then
    raise exception 'Cod QR invalid pentru această masă.'
      using errcode = 'P0001', hint = 'invalid_token';
  end if;

  -- Cele 3 gate-uri (toate server-side): plan → opt-in local → cont conectat.
  perform public.enforce_feature_for_restaurant(v_sess.restaurant_id, 'online_payments');
  if not public.is_module_enabled(v_sess.restaurant_id, 'online_payments') then
    raise exception 'Plata online nu este activată de restaurant.'
      using errcode = 'P0001', hint = 'module_disabled';
  end if;
  select stripe_account_id into v_account
    from public.restaurants where id = v_sess.restaurant_id;
  if v_account is null then
    raise exception 'Restaurantul nu are contul de plăți conectat.'
      using errcode = 'P0001', hint = 'not_connected';
  end if;

  -- Suma se calculează AICI (niciodată din client): comenzile sesiunii care
  -- nu sunt plătite/anulate/închise și nu au deja plăți parțiale pornite
  -- (acelea se termină pe fluxul de staff, altfel am dubla încasarea).
  select coalesce(array_agg(o.id), '{}'), coalesce(sum(o.total), 0)
    into v_order_ids, v_amount
    from public.orders o
   where o.session_id = p_session_id
     and o.status not in ('paid', 'cancelled', 'closed')
     and not exists (
       select 1 from public.order_payments op where op.order_id = o.id
     );
  if coalesce(array_length(v_order_ids, 1), 0) = 0 or v_amount <= 0 then
    raise exception 'Nu există comenzi de plătit pe această masă.'
      using errcode = 'P0001', hint = 'nothing_to_pay';
  end if;

  select coalesce((value->>'bps')::integer, 0)
    into v_fee_bps
    from public.platform_settings
   where key = 'online_payment_fee_bps';
  v_fee := round(v_amount * coalesce(v_fee_bps, 0) / 10000.0, 2);

  insert into public.table_payments (restaurant_id, session_id, order_ids, amount, application_fee)
  values (v_sess.restaurant_id, p_session_id, v_order_ids, v_amount, v_fee)
  returning id into v_payment_id;

  return jsonb_build_object(
    'payment_id',        v_payment_id,
    'amount',            v_amount,
    'currency',          'RON',
    'application_fee',   v_fee,
    'order_ids',         to_jsonb(v_order_ids),
    'stripe_account_id', v_account
  );
end;
$$;

-- ── 5b. attach_payment_intent ────────────────────────────────────────
create or replace function public.attach_payment_intent(
  p_payment_id uuid,
  p_intent_id  text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_intent_id is null or length(btrim(p_intent_id)) = 0 then
    raise exception 'PaymentIntent id lipsă.'
      using errcode = 'P0001', hint = 'invalid_intent';
  end if;

  update public.table_payments
     set stripe_payment_intent_id = p_intent_id,
         status = 'processing',
         updated_at = now()
   where id = p_payment_id
     and status = 'created'
     and (stripe_payment_intent_id is null or stripe_payment_intent_id = p_intent_id);

  if not found then
    raise exception 'Plată inexistentă sau deja procesată.'
      using errcode = 'P0001', hint = 'invalid_payment';
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ── 5c. settle_table_payment ─────────────────────────────────────────
-- Idempotent pe intent id (webhook-urile Stripe se pot repeta). Comenzile
-- plătite/anulate ÎNTRE begin și settle sunt sărite + notate în settle_note
-- (refund parțial = manual în Etapa 1 — documentat în docs/ONLINE_PAYMENT.md).
create or replace function public.settle_table_payment(
  p_intent_id  text,
  p_outcome    text,
  p_error_info text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pay     record;
  v_oid     uuid;
  v_paid    integer := 0;
  v_skipped integer := 0;
begin
  if p_outcome not in ('succeeded', 'failed', 'canceled') then
    raise exception 'Outcome invalid: %', p_outcome
      using errcode = 'P0001', hint = 'invalid_outcome';
  end if;

  select * into v_pay
    from public.table_payments
   where stripe_payment_intent_id = p_intent_id
     for update;
  if not found then
    raise exception 'Plată necunoscută pentru intent %.', p_intent_id
      using errcode = 'P0001', hint = 'unknown_intent';
  end if;

  -- Idempotență: stările terminale nu se rescriu.
  if v_pay.status in ('succeeded', 'failed', 'canceled') then
    return jsonb_build_object('already_settled', true, 'status', v_pay.status);
  end if;

  if p_outcome <> 'succeeded' then
    update public.table_payments
       set status = p_outcome, error_info = p_error_info, updated_at = now()
     where id = v_pay.id;
    return jsonb_build_object('status', p_outcome);
  end if;

  -- Succes: fiecare comandă din snapshot devine 'paid' cu card_online —
  -- triggerul enqueue_fiscal_receipt (mig 030) preia bonul de aici.
  foreach v_oid in array v_pay.order_ids loop
    update public.orders
       set status         = 'paid',
           payment_method = 'card_online',
           paid_amount    = total,
           paid_at        = now()
     where id = v_oid
       and status not in ('paid', 'cancelled', 'closed');
    if found then
      v_paid := v_paid + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  update public.table_payments
     set status = 'succeeded',
         settle_note = case
           when v_skipped > 0 then format(
             '%s comenzi sărite (plătite/anulate între timp) — verifică dacă e nevoie de refund parțial.',
             v_skipped)
           else null
         end,
         updated_at = now()
   where id = v_pay.id;

  return jsonb_build_object('status', 'succeeded', 'orders_paid', v_paid, 'orders_skipped', v_skipped);
end;
$$;

-- ── 6. Privilegii: DOAR service_role (apelate exclusiv din funcțiile Netlify)
revoke all on function public.begin_table_payment(uuid, text) from public, anon, authenticated;
revoke all on function public.attach_payment_intent(uuid, text) from public, anon, authenticated;
revoke all on function public.settle_table_payment(text, text, text) from public, anon, authenticated;
grant execute on function public.begin_table_payment(uuid, text) to service_role;
grant execute on function public.attach_payment_intent(uuid, text) to service_role;
grant execute on function public.settle_table_payment(text, text, text) to service_role;

comment on function public.begin_table_payment(uuid, text) is
  $$Etapa 1 plata online (mig 203). Sumă server-side pe sesiune + rând nou în
table_payments. Gate-uri: plan online_payments + modul + cont Stripe conectat.
EXECUTE doar service_role.$$;
comment on function public.settle_table_payment(text, text, text) is
  $$Idempotent pe intent id. succeeded → orders paid cu card_online (triggerul
fiscal existent preia bonul). Comenzi plătite între timp → sărite + settle_note.$$;

-- ── 7. Asserții fail-closed ──────────────────────────────────────────
do $$
declare
  v_cnt integer;
begin
  -- Enum-ul are card_online, iar maparea fiscală e 7 (Plata modernă).
  if public.fiscalnet_payment_code('card_online'::public.payment_method) <> 7 then
    raise exception 'ASSERT FAIL: card_online trebuie mapat la codul FiscalNet 7';
  end if;

  -- RLS activ pe table_payments.
  if not exists (
    select 1 from pg_class
    where oid = 'public.table_payments'::regclass and relrowsecurity
  ) then
    raise exception 'ASSERT FAIL: table_payments fără RLS';
  end if;

  -- anon: zero privilegii pe tabelă.
  select count(*) into v_cnt
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'table_payments'
     and grantee = 'anon';
  if v_cnt > 0 then
    raise exception 'ASSERT FAIL: anon are privilegii pe table_payments';
  end if;

  -- authenticated: DOAR select.
  select count(*) into v_cnt
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'table_payments'
     and grantee = 'authenticated' and privilege_type <> 'SELECT';
  if v_cnt > 0 then
    raise exception 'ASSERT FAIL: authenticated are mai mult decât SELECT pe table_payments';
  end if;

  -- RPC-urile: anon + authenticated NU au EXECUTE (doar service_role).
  if has_function_privilege('anon', 'public.begin_table_payment(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.begin_table_payment(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.settle_table_payment(text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.settle_table_payment(text, text, text)', 'execute')
     or has_function_privilege('anon', 'public.attach_payment_intent(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.attach_payment_intent(uuid, text)', 'execute') then
    raise exception 'ASSERT FAIL: RPC-urile de plată online trebuie să fie service_role-only';
  end if;
  if not has_function_privilege('service_role', 'public.begin_table_payment(uuid, text)', 'execute') then
    raise exception 'ASSERT FAIL: service_role fără EXECUTE pe begin_table_payment';
  end if;

  -- Regula de aur în plan_features: online_payments OFF sub pro.
  select count(*) into v_cnt
    from public.plan_features
   where feature = 'online_payments'
     and ((plan in ('free','starter','growth') and enabled)
          or (plan in ('pro','enterprise') and not enabled));
  if v_cnt > 0 then
    raise exception 'ASSERT FAIL: seed-ul plan_features[online_payments] încalcă regula de aur';
  end if;

  -- Gate-ul de plan e chemat efectiv în begin_table_payment.
  if position('enforce_feature_for_restaurant' in pg_get_functiondef('public.begin_table_payment(uuid, text)'::regprocedure)) = 0 then
    raise exception 'ASSERT FAIL: begin_table_payment nu cheamă enforce_feature_for_restaurant';
  end if;
end $$;

commit;
