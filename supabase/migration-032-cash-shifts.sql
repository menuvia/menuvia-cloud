-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 032 — Gestiune fond casă (cash drawer) + închidere zi
-- ═══════════════════════════════════════════════════════════════
-- Funcționalitate:
--   1. Cash shift: o "tură" cu fond inițial, mișcări, închidere
--   2. Cash movements: depuneri / retrageri manuale în timpul turei
--   3. Închidere zi: rulează Raport Z pe casa de marcat + snapshot
--      diferență cash așteptat vs. numărat
--
-- Constraint: o singură tură deschisă per restaurant la un moment dat.
-- Pentru o cafenea mai mare cu 2-3 schimburi pe zi, vom extinde ulterior
-- la "sub-shifts" pe ospătar. Pentru v1: 1 tură = 1 zi de lucru.

-- ═══════════════════════════════════════════════════════════════
-- 1) MODIFICĂRI pending_receipts pentru comenzi non-order (Z, X)
-- ═══════════════════════════════════════════════════════════════
-- Raportul Z nu e legat de un order specific, e o comandă globală pe casă.
-- Facem order_id nullable + adăugăm command_type informativ.

alter table public.pending_receipts
  alter column order_id drop not null;

alter table public.pending_receipts
  add column if not exists command_type text not null default 'order'
    check (command_type in ('order', 'report_z', 'report_x', 'cash_in', 'cash_out'));

create index if not exists pending_receipts_command_type_idx
  on public.pending_receipts(command_type) where status in ('pending', 'sent');

comment on column public.pending_receipts.command_type is
  'Tip comandă: order=bon de vânzare (default), report_z/x=raport casă, cash_in/out=mișcare sertar pe casă.';

-- ═══════════════════════════════════════════════════════════════
-- 2) TABELA cash_shifts (ture)
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.cash_shifts (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,

  status          text not null default 'open'
                    check (status in ('open', 'closed')),

  -- Deschidere
  opened_at       timestamptz not null default now(),
  opened_by       uuid not null references auth.users(id) on delete set null,
  initial_float   numeric(10,2) not null check (initial_float >= 0),
  opening_notes   text,

  -- Închidere (umplute când status='closed')
  closed_at       timestamptz,
  closed_by       uuid references auth.users(id) on delete set null,
  counted_cash    numeric(10,2),    -- numărat fizic în sertar la închidere
  expected_cash   numeric(10,2),    -- calculat: float + plăți cash + mișcări
  cash_diff       numeric(10,2),    -- counted - expected (+ = surplus, - = lipsă)
  closing_notes   text,

  -- Raport Z trimis la FiscalNet
  z_receipt_id    uuid references public.pending_receipts(id) on delete set null,

  -- Snapshot la închidere (cached pentru audit/perf)
  summary_snapshot jsonb,

  created_at      timestamptz not null default now()
);

create index if not exists cash_shifts_restaurant_idx
  on public.cash_shifts(restaurant_id, status, opened_at desc);

-- Constraint: doar o tură deschisă per restaurant
create unique index if not exists cash_shifts_one_open_per_restaurant
  on public.cash_shifts(restaurant_id) where status = 'open';

comment on table public.cash_shifts is
  'Ture/zile de lucru. O tură = de la deschidere fond casă până la închidere zi (cu raport Z).';

-- RLS
alter table public.cash_shifts enable row level security;

create policy "cash_shifts: admin manage" on public.cash_shifts for all
  using (public.is_admin(restaurant_id))
  with check (public.is_admin(restaurant_id));

create policy "cash_shifts: members read" on public.cash_shifts for select
  using (public.is_member(restaurant_id));

-- ═══════════════════════════════════════════════════════════════
-- 3) TABELA cash_movements (depuneri/retrageri manuale)
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.cash_movements (
  id              uuid primary key default gen_random_uuid(),
  shift_id        uuid not null references public.cash_shifts(id) on delete cascade,
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,

  -- amount > 0 = depunere (bani intră în sertar)
  -- amount < 0 = retragere (bani ies)
  amount          numeric(10,2) not null check (amount <> 0),
  type            text not null check (type in (
    'deposit',         -- depunere fond suplimentar (ex: schimb mărunțiș)
    'withdrawal',      -- retragere (ex: bani pentru cumpărături)
    'tip_payout',      -- bacșișuri scoase la final tură pentru ospătar
    'expense',         -- cheltuială plătită din sertar (ex: lapte de la magazin)
    'safe_deposit',    -- depunere la seif (scade din sertar)
    'correction'       -- corecție manuală (greșeală de numărare etc.)
  )),
  reason          text not null check (length(reason) > 0),

  performed_by    uuid references auth.users(id) on delete set null,
  performed_at    timestamptz not null default now(),

  -- Optional: trimitere și la casă (I^ sau O^ FiscalNet)
  sent_to_fiscal  boolean not null default false,
  fiscal_receipt_id uuid references public.pending_receipts(id) on delete set null
);

create index if not exists cash_movements_shift_idx
  on public.cash_movements(shift_id, performed_at);

comment on table public.cash_movements is
  'Mișcări manuale de cash în timpul turei: depuneri, retrageri, plăți cheltuieli din sertar.';

-- RLS
alter table public.cash_movements enable row level security;

create policy "cash_movements: admin manage" on public.cash_movements for all
  using (public.is_admin(restaurant_id))
  with check (public.is_admin(restaurant_id));

create policy "cash_movements: members read" on public.cash_movements for select
  using (public.is_member(restaurant_id));

-- ═══════════════════════════════════════════════════════════════
-- 4) HELPER: cash_collected_for_shift(shift_id)
-- ═══════════════════════════════════════════════════════════════
-- Calculează cash încasat din comenzi în intervalul shift-ului.
-- Acoperă ambele cazuri:
--   (a) plată simplă: orders.payment_method='cash' + orders.paid_amount
--   (b) plată split: order_payments unde method='cash'
--
-- Plățile split sunt distincte (orders.payment_method poate fi 'other'
-- când e mix), deci NU le contăm pe ambele.
create or replace function public.cash_collected_for_shift(p_shift_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift        record;
  v_simple_cash  numeric(10,2);
  v_split_cash   numeric(10,2);
  v_end_at       timestamptz;
begin
  select restaurant_id, opened_at, closed_at, status
    into v_shift
    from public.cash_shifts
   where id = p_shift_id;

  if not found then return 0; end if;

  -- Pentru tura încă deschisă, end = NOW(); altfel closed_at
  v_end_at := coalesce(v_shift.closed_at, now());

  -- Plăți simple în cash (comenzi fără split)
  select coalesce(sum(o.paid_amount), 0)
    into v_simple_cash
    from public.orders o
   where o.restaurant_id = v_shift.restaurant_id
     and o.status = 'paid'
     and o.payment_method = 'cash'
     and o.paid_at between v_shift.opened_at and v_end_at
     and not exists (select 1 from public.order_payments op where op.order_id = o.id);

  -- Plăți cash din split bills
  select coalesce(sum(op.amount), 0)
    into v_split_cash
    from public.order_payments op
    join public.orders o on o.id = op.order_id
   where o.restaurant_id = v_shift.restaurant_id
     and op.method = 'cash'
     and op.created_at between v_shift.opened_at and v_end_at;

  return v_simple_cash + v_split_cash;
end;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 5) HELPER: cash_expected(shift_id)
-- ═══════════════════════════════════════════════════════════════
create or replace function public.cash_expected(p_shift_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_float      numeric(10,2);
  v_cash       numeric(10,2);
  v_movements  numeric(10,2);
begin
  select initial_float into v_float
    from public.cash_shifts where id = p_shift_id;

  if not found then return 0; end if;

  v_cash := public.cash_collected_for_shift(p_shift_id);

  select coalesce(sum(amount), 0)
    into v_movements
    from public.cash_movements
   where shift_id = p_shift_id;

  return v_float + v_cash + v_movements;
end;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 6) RPC: open_shift — admin/manager deschide tură nouă
-- ═══════════════════════════════════════════════════════════════
create or replace function public.open_shift(
  p_restaurant_id  uuid,
  p_initial_float  numeric,
  p_notes          text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift_id uuid;
begin
  if not public.is_admin(p_restaurant_id) then
    raise exception 'Only owners/managers can open shifts';
  end if;

  if p_initial_float is null or p_initial_float < 0 then
    raise exception 'Initial float must be >= 0';
  end if;

  -- Există deja o tură deschisă?
  if exists (
    select 1 from public.cash_shifts
    where restaurant_id = p_restaurant_id and status = 'open'
  ) then
    raise exception 'Există deja o tură deschisă. Închide-o înainte să deschizi alta.';
  end if;

  insert into public.cash_shifts (
    restaurant_id, opened_by, initial_float, opening_notes
  ) values (
    p_restaurant_id, auth.uid(), p_initial_float, nullif(trim(coalesce(p_notes, '')), '')
  ) returning id into v_shift_id;

  return v_shift_id;
end;
$$;

revoke all on function public.open_shift(uuid, numeric, text) from public;
grant execute on function public.open_shift(uuid, numeric, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 7) RPC: add_cash_movement — depunere/retragere manuală
-- ═══════════════════════════════════════════════════════════════
create or replace function public.add_cash_movement(
  p_restaurant_id  uuid,
  p_amount         numeric,
  p_type           text,
  p_reason         text,
  p_send_to_fiscal boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift_id   uuid;
  v_movement_id uuid;
  v_receipt_id uuid;
  v_payload    text;
begin
  if not public.is_admin(p_restaurant_id) then
    raise exception 'Only owners/managers can record cash movements';
  end if;

  if p_amount is null or p_amount = 0 then
    raise exception 'Amount must be non-zero (pozitiv=depunere, negativ=retragere)';
  end if;

  if p_type not in ('deposit', 'withdrawal', 'tip_payout', 'expense', 'safe_deposit', 'correction') then
    raise exception 'Invalid movement type: %', p_type;
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Reason is required';
  end if;

  -- Sanity check semn vs tip
  if p_type in ('deposit') and p_amount < 0 then
    raise exception 'Deposit must have positive amount';
  end if;
  if p_type in ('withdrawal', 'expense', 'safe_deposit', 'tip_payout') and p_amount > 0 then
    raise exception 'Withdrawal/expense/safe_deposit/tip_payout must have negative amount';
  end if;

  -- Găsește tura deschisă
  select id into v_shift_id
    from public.cash_shifts
   where restaurant_id = p_restaurant_id and status = 'open';

  if not found then
    raise exception 'Nu există tură deschisă. Deschide-o întâi.';
  end if;

  insert into public.cash_movements (
    shift_id, restaurant_id, amount, type, reason, performed_by
  ) values (
    v_shift_id, p_restaurant_id, p_amount, p_type, trim(p_reason), auth.uid()
  ) returning id into v_movement_id;

  -- Opțional: trimite și la casa de marcat (I^ pentru depunere, O^ pentru retragere)
  if p_send_to_fiscal then
    if exists (select 1 from public.bridge_devices where restaurant_id = p_restaurant_id) then
      if p_amount > 0 then
        v_payload := format('I^%s', round(p_amount * 100)::bigint);
      else
        v_payload := format('O^%s', round(abs(p_amount) * 100)::bigint);
      end if;

      insert into public.pending_receipts (
        restaurant_id, order_id, payload, total_snapshot, command_type
      ) values (
        p_restaurant_id, null, v_payload, abs(p_amount),
        case when p_amount > 0 then 'cash_in' else 'cash_out' end
      ) returning id into v_receipt_id;

      update public.cash_movements
         set sent_to_fiscal = true,
             fiscal_receipt_id = v_receipt_id
       where id = v_movement_id;
    end if;
  end if;

  return v_movement_id;
end;
$$;

revoke all on function public.add_cash_movement(uuid, numeric, text, text, boolean) from public;
grant execute on function public.add_cash_movement(uuid, numeric, text, text, boolean) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 8) RPC: get_current_shift — returnează tura deschisă (sau null)
-- ═══════════════════════════════════════════════════════════════
create or replace function public.get_current_shift(p_restaurant_id uuid)
returns table (
  id            uuid,
  opened_at     timestamptz,
  opened_by     uuid,
  initial_float numeric,
  cash_collected numeric,
  cash_movements_total numeric,
  cash_expected numeric,
  movement_count bigint,
  order_count   bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift_id uuid;
begin
  if not public.is_member(p_restaurant_id) then
    raise exception 'Not a member of this restaurant';
  end if;

  select s.id into v_shift_id
    from public.cash_shifts s
   where s.restaurant_id = p_restaurant_id and s.status = 'open'
   limit 1;

  if v_shift_id is null then
    return;
  end if;

  return query
    select
      s.id,
      s.opened_at,
      s.opened_by,
      s.initial_float,
      public.cash_collected_for_shift(s.id) as cash_collected,
      (select coalesce(sum(amount), 0) from public.cash_movements where shift_id = s.id) as cash_movements_total,
      public.cash_expected(s.id) as cash_expected,
      (select count(*) from public.cash_movements where shift_id = s.id) as movement_count,
      (select count(*) from public.orders o
         where o.restaurant_id = p_restaurant_id
           and o.status = 'paid'
           and o.paid_at >= s.opened_at) as order_count
    from public.cash_shifts s
    where s.id = v_shift_id;
end;
$$;

revoke all on function public.get_current_shift(uuid) from public;
grant execute on function public.get_current_shift(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 9) RPC: get_shift_summary — sumar complet pentru închidere
-- ═══════════════════════════════════════════════════════════════
create or replace function public.get_shift_summary(p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift          record;
  v_end_at         timestamptz;
  v_orders_summary record;
  v_payments       jsonb;
  v_movements      jsonb;
begin
  select * into v_shift from public.cash_shifts where id = p_shift_id;
  if not found then return null; end if;

  if not public.is_member(v_shift.restaurant_id) then
    raise exception 'Not a member';
  end if;

  v_end_at := coalesce(v_shift.closed_at, now());

  -- Sumar comenzi
  select
    coalesce(count(*), 0) as order_count,
    coalesce(sum(o.total + coalesce(o.discount_amount, 0)), 0) as gross_total,
    coalesce(sum(coalesce(o.discount_amount, 0)), 0) as discount_total,
    coalesce(sum(o.total), 0) as net_total
    into v_orders_summary
    from public.orders o
   where o.restaurant_id = v_shift.restaurant_id
     and o.status = 'paid'
     and o.paid_at between v_shift.opened_at and v_end_at;

  -- Plăți pe metodă (cash / card / other) — unifică simple + split
  select coalesce(jsonb_object_agg(method, total), '{}'::jsonb)
    into v_payments
    from (
      select method, sum(amount) as total
        from (
          -- Simple-pay (fără split): un singur method per order
          select coalesce(o.payment_method::text, 'other') as method,
                 o.paid_amount as amount
            from public.orders o
           where o.restaurant_id = v_shift.restaurant_id
             and o.status = 'paid'
             and o.paid_at between v_shift.opened_at and v_end_at
             and o.paid_amount is not null
             and not exists (select 1 from public.order_payments op where op.order_id = o.id)
          union all
          -- Split bills: fiecare plată parțială
          select op.method, op.amount
            from public.order_payments op
            join public.orders o on o.id = op.order_id
           where o.restaurant_id = v_shift.restaurant_id
             and op.created_at between v_shift.opened_at and v_end_at
        ) all_payments
       group by method
    ) merged;

  -- Movements detaliate
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', m.id, 'amount', m.amount, 'type', m.type,
      'reason', m.reason, 'performed_at', m.performed_at,
      'sent_to_fiscal', m.sent_to_fiscal
    ) order by m.performed_at
  ), '[]'::jsonb)
    into v_movements
    from public.cash_movements m
   where m.shift_id = p_shift_id;

  return jsonb_build_object(
    'shift_id',         v_shift.id,
    'status',           v_shift.status,
    'opened_at',        v_shift.opened_at,
    'closed_at',        v_shift.closed_at,
    'initial_float',    v_shift.initial_float,
    'orders', jsonb_build_object(
      'count',          v_orders_summary.order_count,
      'gross_total',    v_orders_summary.gross_total,
      'discount_total', v_orders_summary.discount_total,
      'net_total',      v_orders_summary.net_total
    ),
    'payments_by_method', v_payments,
    'cash_collected',     public.cash_collected_for_shift(p_shift_id),
    'cash_movements',     v_movements,
    'cash_movements_total', (select coalesce(sum(amount), 0) from public.cash_movements where shift_id = p_shift_id),
    'cash_expected',      public.cash_expected(p_shift_id),
    'counted_cash',       v_shift.counted_cash,
    'cash_diff',          v_shift.cash_diff
  );
end;
$$;

revoke all on function public.get_shift_summary(uuid) from public;
grant execute on function public.get_shift_summary(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 10) RPC: close_shift — închide tură + trimite Raport Z la casă
-- ═══════════════════════════════════════════════════════════════
create or replace function public.close_shift(
  p_shift_id     uuid,
  p_counted_cash numeric,
  p_notes        text default null,
  p_send_z       boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift     record;
  v_expected  numeric(10,2);
  v_diff      numeric(10,2);
  v_z_receipt_id uuid;
  v_summary   jsonb;
begin
  select * into v_shift from public.cash_shifts where id = p_shift_id for update;
  if not found then
    raise exception 'Shift % not found', p_shift_id;
  end if;

  if not public.is_admin(v_shift.restaurant_id) then
    raise exception 'Only owners/managers can close shifts';
  end if;

  if v_shift.status = 'closed' then
    raise exception 'Shift already closed at %', v_shift.closed_at;
  end if;

  if p_counted_cash is null or p_counted_cash < 0 then
    raise exception 'Counted cash must be >= 0';
  end if;

  -- Calculează expected și diff
  v_expected := public.cash_expected(p_shift_id);
  v_diff := p_counted_cash - v_expected;

  -- Snapshot summary ÎNAINTE de a marca închis (în timp ce datele sunt valide)
  v_summary := public.get_shift_summary(p_shift_id);

  -- Trimite Raport Z la casă (dacă vrei)
  if p_send_z and exists (select 1 from public.bridge_devices where restaurant_id = v_shift.restaurant_id) then
    insert into public.pending_receipts (
      restaurant_id, order_id, payload, total_snapshot, command_type
    ) values (
      v_shift.restaurant_id, null, 'Z^', 0, 'report_z'
    ) returning id into v_z_receipt_id;
  end if;

  -- Marchează tura ca închisă
  update public.cash_shifts
     set status         = 'closed',
         closed_at      = now(),
         closed_by      = auth.uid(),
         counted_cash   = p_counted_cash,
         expected_cash  = v_expected,
         cash_diff      = v_diff,
         closing_notes  = nullif(trim(coalesce(p_notes, '')), ''),
         z_receipt_id   = v_z_receipt_id,
         summary_snapshot = v_summary
   where id = p_shift_id;

  return jsonb_build_object(
    'shift_id',      p_shift_id,
    'closed_at',     now(),
    'expected_cash', v_expected,
    'counted_cash',  p_counted_cash,
    'cash_diff',     v_diff,
    'z_sent',        v_z_receipt_id is not null,
    'z_receipt_id',  v_z_receipt_id,
    'summary',       v_summary
  );
end;
$$;

revoke all on function public.close_shift(uuid, numeric, text, boolean) from public;
grant execute on function public.close_shift(uuid, numeric, text, boolean) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 11) RPC: list_recent_shifts — pentru history view
-- ═══════════════════════════════════════════════════════════════
create or replace function public.list_recent_shifts(
  p_restaurant_id uuid,
  p_limit         int default 30
)
returns table (
  id              uuid,
  status          text,
  opened_at       timestamptz,
  closed_at       timestamptz,
  initial_float   numeric,
  expected_cash   numeric,
  counted_cash    numeric,
  cash_diff       numeric,
  order_count     bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_member(p_restaurant_id) then
    raise exception 'Not a member';
  end if;

  return query
    select
      s.id, s.status, s.opened_at, s.closed_at,
      s.initial_float, s.expected_cash, s.counted_cash, s.cash_diff,
      (select count(*) from public.orders o
         where o.restaurant_id = p_restaurant_id
           and o.status = 'paid'
           and o.paid_at >= s.opened_at
           and (s.closed_at is null or o.paid_at <= s.closed_at)) as order_count
    from public.cash_shifts s
    where s.restaurant_id = p_restaurant_id
    order by s.opened_at desc
    limit greatest(1, least(p_limit, 100));
end;
$$;

revoke all on function public.list_recent_shifts(uuid, int) from public;
grant execute on function public.list_recent_shifts(uuid, int) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 12) Permisiuni grant
-- ═══════════════════════════════════════════════════════════════
grant select, insert, update, delete on public.cash_shifts    to authenticated;
grant select, insert, update, delete on public.cash_movements to authenticated;
