-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 043 — Customer feedback + Tips + Google Review + Fiscal receipt
-- ═══════════════════════════════════════════════════════════════
-- Adaugă:
--   1. Coloana orders.tips_amount + fiscal_receipt_requested_at
--   2. Coloana restaurants.google_place_id + google_review_url
--   3. Tabela order_feedback (3 tipuri: payment, service, food)
--   4. RPC submit_order_feedback() public (fără auth — clientul scanează QR)
--   5. RPC request_fiscal_receipt() public
--   6. Extindere get_order_public_status() să returneze tips + fiscal
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Coloane noi pe orders ─────────────────────────────────
alter table public.orders
  add column if not exists tips_amount numeric(10,2) not null default 0,
  add column if not exists fiscal_receipt_requested_at timestamptz;

-- Index pentru raport tips
create index if not exists orders_tips_paid_idx
  on public.orders (restaurant_id, paid_at)
  where tips_amount > 0 and status = 'paid';


-- ── 2. Coloane noi pe restaurants (Google review CTA) ───────
alter table public.restaurants
  add column if not exists google_place_id text,
  add column if not exists google_review_url text;

-- Helper: dacă google_place_id setat dar nu și URL, construiește URL standard
create or replace function public.compute_google_review_url(p_place_id text)
returns text
language sql
immutable
as $$
  select case
    when p_place_id is null or p_place_id = '' then null
    else 'https://search.google.com/local/writereview?placeid=' || p_place_id
  end;
$$;


-- ── 3. Tabela order_feedback ─────────────────────────────────
create table if not exists public.order_feedback (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  feedback_type   text not null check (feedback_type in ('payment', 'service', 'food')),
  rating          int  not null check (rating between 1 and 5),
  comment         text,
  created_at      timestamptz not null default now(),
  ip_address      inet,
  user_agent      text,
  -- Un singur feedback per (order, type) — re-submit overwrites prin upsert
  unique (order_id, feedback_type)
);

create index if not exists order_feedback_restaurant_idx
  on public.order_feedback (restaurant_id, created_at desc);

create index if not exists order_feedback_order_idx
  on public.order_feedback (order_id);

-- RLS — patronul vede doar feedback-ul propriilor restaurante
alter table public.order_feedback enable row level security;

drop policy if exists "order_feedback_select_own" on public.order_feedback;
create policy "order_feedback_select_own"
  on public.order_feedback for select
  using (
    restaurant_id in (
      select restaurant_id from public.restaurant_memberships
       where user_id = auth.uid()
         and role in ('owner', 'manager')
    )
  );

-- Insert / update / delete — DOAR prin RPC SECURITY DEFINER
revoke insert, update, delete on public.order_feedback from authenticated, anon;


-- ── 4. RPC: submit_order_feedback (public, anon-callable) ────
create or replace function public.submit_order_feedback(
  p_order_id      uuid,
  p_feedback_type text,
  p_rating        int,
  p_comment       text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_order_status  text;
  v_age_hours     numeric;
begin
  -- Validări inputs
  if p_feedback_type not in ('payment', 'service', 'food') then
    raise exception 'Tip feedback invalid';
  end if;
  if p_rating < 1 or p_rating > 5 then
    raise exception 'Rating invalid (1-5)';
  end if;

  -- Anti-spam: feedback acceptat doar pe comenzi reale, recente (< 24h),
  -- și care au ajuns la status served sau paid
  select restaurant_id, status,
         extract(epoch from (now() - created_at)) / 3600
    into v_restaurant_id, v_order_status, v_age_hours
    from public.orders
   where id = p_order_id;

  if v_restaurant_id is null then
    raise exception 'Comandă inexistentă';
  end if;
  if v_age_hours > 24 then
    raise exception 'Comandă prea veche pentru feedback';
  end if;
  if v_order_status not in ('served', 'paid') then
    raise exception 'Feedback acceptat doar după servire';
  end if;

  -- Trim comment
  if p_comment is not null then
    p_comment := nullif(trim(p_comment), '');
    if length(p_comment) > 500 then
      p_comment := substring(p_comment, 1, 500);
    end if;
  end if;

  -- Upsert (re-submit overwrites)
  insert into public.order_feedback
    (order_id, restaurant_id, feedback_type, rating, comment)
  values
    (p_order_id, v_restaurant_id, p_feedback_type, p_rating, p_comment)
  on conflict (order_id, feedback_type)
  do update set
    rating     = excluded.rating,
    comment    = excluded.comment,
    created_at = now();
end;
$$;

revoke all on function public.submit_order_feedback(uuid, text, int, text) from public;
grant execute on function public.submit_order_feedback(uuid, text, int, text) to anon, authenticated;


-- ── 5. RPC: request_fiscal_receipt (public, anon-callable) ───
create or replace function public.request_fiscal_receipt(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_status        text;
  v_already       timestamptz;
begin
  select restaurant_id, status, fiscal_receipt_requested_at
    into v_restaurant_id, v_status, v_already
    from public.orders
   where id = p_order_id;

  if v_restaurant_id is null then
    raise exception 'Comandă inexistentă';
  end if;
  if v_status not in ('paid', 'served') then
    raise exception 'Bonul fiscal se poate cere doar după plată';
  end if;

  -- Idempotent: dacă deja cerut, returnăm timpul existent
  if v_already is not null then
    return jsonb_build_object(
      'success', true,
      'already_requested', true,
      'requested_at', v_already
    );
  end if;

  update public.orders
    set fiscal_receipt_requested_at = now()
   where id = p_order_id;

  -- Aici se poate trigger Supabase Realtime →
  -- ospătarul/casierul primește notificare imediată
  -- Notificarea e gestionată de subscription la `orders` în WaiterPage

  return jsonb_build_object(
    'success', true,
    'already_requested', false,
    'requested_at', now()
  );
end;
$$;

revoke all on function public.request_fiscal_receipt(uuid) from public;
grant execute on function public.request_fiscal_receipt(uuid) to anon, authenticated;


-- ── 6. Extindere get_order_public_status() ───────────────────
-- Returnează acum și tips_amount + fiscal_receipt_requested_at + restaurant info
-- ca să poată afișa toate datele în PaymentConfirmedScreen.
create or replace function public.get_order_public_status(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'id',                  o.id,
    'short_id',            substring(o.id::text, 1, 6),
    'status',              o.status,
    'total',               o.total,
    'tips_amount',         o.tips_amount,
    'paid_amount',         o.paid_amount,
    'payment_method',      o.payment_method,
    'discount_amount',     o.discount_amount,
    'created_at',          o.created_at,
    'paid_at',             o.paid_at,
    'served_at',           o.served_at,
    'fiscal_receipt_requested_at', o.fiscal_receipt_requested_at,
    'restaurant', jsonb_build_object(
      'name',              r.name,
      'slug',              r.slug,
      'google_review_url', coalesce(r.google_review_url, public.compute_google_review_url(r.google_place_id))
    )
  ) into v_result
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  where o.id = p_order_id;

  return v_result;
end;
$$;

revoke all on function public.get_order_public_status(uuid) from public;
grant execute on function public.get_order_public_status(uuid) to anon, authenticated;


-- ── 7. View agregare feedback per restaurant (pentru dashboard) ──
create or replace view public.v_restaurant_feedback_summary as
select
  f.restaurant_id,
  f.feedback_type,
  count(*)                         as total_responses,
  avg(f.rating)::numeric(3,2)      as avg_rating,
  count(*) filter (where rating >= 4) as positive_count,
  count(*) filter (where rating <= 2) as negative_count,
  count(*) filter (where comment is not null) as with_comments,
  max(f.created_at)                as last_feedback_at
from public.order_feedback f
group by f.restaurant_id, f.feedback_type;

-- Permisiuni view: doar membri restaurant
grant select on public.v_restaurant_feedback_summary to authenticated;


-- ── 8. Extindere advance_order pentru a accepta tips_amount ──
-- Wrapper care păstrează signatura existentă + adaugă tips opțional.
-- Vechea funcție rămâne neschimbată; doar adăugăm un nou overload.
create or replace function public.advance_order(
  p_order_id        uuid,
  p_action          text,
  p_payment_method  text default null,
  p_paid_amount     numeric default null,
  p_tips_amount     numeric default null,
  p_cancel_reason   text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Comandă inexistentă';
  end if;

  -- Verificare permisiune via membership
  if not exists (
    select 1 from public.restaurant_memberships
     where user_id = auth.uid()
       and restaurant_id = v_order.restaurant_id
  ) then
    raise exception 'Acces interzis';
  end if;

  case p_action
    when 'confirm' then
      update public.orders set status='confirmed', confirmed_at=now() where id=p_order_id;
    when 'start_preparing' then
      update public.orders set status='preparing', preparing_at=now() where id=p_order_id;
    when 'mark_ready' then
      update public.orders set status='ready', ready_at=now() where id=p_order_id;
    when 'mark_served' then
      update public.orders set status='served', served_at=now(), served_by=auth.uid() where id=p_order_id;
    when 'mark_paid' then
      update public.orders
         set status='paid',
             paid_at=now(),
             paid_by=auth.uid(),
             payment_method=coalesce(p_payment_method::payment_method, payment_method),
             paid_amount=coalesce(p_paid_amount, paid_amount),
             tips_amount=coalesce(p_tips_amount, tips_amount)
       where id=p_order_id;
    when 'cancel' then
      update public.orders
         set status='cancelled',
             cancelled_at=now(),
             cancel_reason=coalesce(p_cancel_reason, cancel_reason)
       where id=p_order_id;
    else
      raise exception 'Acțiune necunoscută: %', p_action;
  end case;
end;
$$;

revoke all on function public.advance_order(uuid, text, text, numeric, numeric, text) from public;
grant execute on function public.advance_order(uuid, text, text, numeric, numeric, text) to authenticated;

