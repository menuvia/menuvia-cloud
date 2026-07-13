-- ═══════════════════════════════════════════════════════════════════
-- Migration 226: Loyalty v1 — puncte per comandă + prag → recompensă
-- ─────────────────────────────────────────────────────────────────────
-- Design: docs/LOYALTY.md (EXPANSION E2). Deciziile de produs (propuse
-- autonom, confirmabile de fondator din mers):
--   1. IDENTITATE = hibrid A+B: card anonim în browser (anon_id din
--      localStorage) + telefon OPȚIONAL care „upgrade-ază" wallet-ul anonim.
--      Telefonul NU se stochează brut: doar md5 pe numărul normalizat
--      (pseudonimizare — GDPR-light; ștergerea restaurantului cascadează).
--   2. PLAN MINIM = growth (loyalty nu atinge bani/bon → nu cere Plan 3).
--      Gate dublu: modulul `loyalty` (opt-in, mig 086) + plan_features.
--
-- Fluxul: clientul QR vede cardul de puncte (get_loyalty_state) → după
-- createOrder, clientul leagă comanda de wallet (loyalty_attach_order) →
-- la PRIMA tranziție terminală de succes trigger-ul acordă
-- floor(total × points_per_leu) puncte → la prag, clientul arată codul
-- scurt al cardului, iar staff-ul răscumpără (redeem_loyalty_reward).
--
-- ATENȚIE tranziția de earn: pe growth (planul minim al loyalty-ului!)
-- comenzile NU ajung niciodată 'paid' — regula de aur gate-uiește 'paid'
-- pe fiscal_receipt (Plan 3, enforce_paid_status_gate); fluxul growth se
-- termină în 'closed' (mig 085). De aceea earn = intrarea în ('paid','closed'),
-- cu indexul parțial unic pe order_id ca garanție de UN singur earn chiar
-- dacă o comandă pro trece prin ambele (paid → closed).
--
-- Sursa de adevăr = loyalty_events (append-only); wallets.points e agregat
-- întreținut de aceleași funcții DEFINER (nu există scriere directă).
-- V2+ (explicit AMÂNATE): puncte pe produs, niveluri, expirare, cupoane.
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ── 1. Tabele ─────────────────────────────────────────────────────
create table if not exists public.loyalty_programs (
  restaurant_id       uuid primary key references public.restaurants(id) on delete cascade,
  points_per_leu      numeric(6,2) not null default 1
                      check (points_per_leu > 0 and points_per_leu <= 100),
  reward_threshold    int not null default 100
                      check (reward_threshold between 1 and 100000),
  reward_description  text not null default 'Un desert din partea casei'
                      check (length(reward_description) between 1 and 200),
  is_active           boolean not null default true,
  updated_at          timestamptz not null default now()
);

create table if not exists public.loyalty_wallets (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  -- md5 pe telefonul normalizat (doar cifre) — niciodată numărul brut.
  phone_hash    text check (phone_hash is null or phone_hash ~ '^[0-9a-f]{32}$'),
  -- ID anonim generat de browser (localStorage) — cardul digital.
  anon_id       text check (anon_id is null or anon_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  -- Codul scurt pe care clientul îl arată staff-ului la recompensă.
  short_code    text not null check (short_code ~ '^[A-Z0-9]{6}$'),
  points        int not null default 0 check (points >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (phone_hash is not null or anon_id is not null)
);
create unique index if not exists uq_loyalty_wallet_phone
  on public.loyalty_wallets(restaurant_id, phone_hash) where phone_hash is not null;
create unique index if not exists uq_loyalty_wallet_anon
  on public.loyalty_wallets(restaurant_id, anon_id) where anon_id is not null;
create unique index if not exists uq_loyalty_wallet_code
  on public.loyalty_wallets(restaurant_id, short_code);

create table if not exists public.loyalty_events (
  id         uuid primary key default gen_random_uuid(),
  wallet_id  uuid not null references public.loyalty_wallets(id) on delete cascade,
  order_id   uuid references public.orders(id) on delete set null,
  delta      int not null check (delta <> 0),
  kind       text not null check (kind in ('earn', 'redeem')),
  created_at timestamptz not null default now()
);
-- O comandă acordă puncte O SINGURĂ DATĂ (anti dublu-earn pe retrigger).
create unique index if not exists uq_loyalty_earn_per_order
  on public.loyalty_events(order_id) where kind = 'earn';
create index if not exists idx_loyalty_events_wallet
  on public.loyalty_events(wallet_id, created_at desc);

alter table public.orders
  add column if not exists loyalty_wallet_id uuid
  references public.loyalty_wallets(id) on delete set null;

-- ── 2. RLS: staff citește, NIMENI nu scrie direct (totul prin DEFINER) ──
alter table public.loyalty_programs enable row level security;
alter table public.loyalty_wallets  enable row level security;
alter table public.loyalty_events   enable row level security;

drop policy if exists "loyalty_programs admin all" on public.loyalty_programs;
create policy "loyalty_programs admin all" on public.loyalty_programs
  for all using (public.is_admin(restaurant_id)) with check (public.is_admin(restaurant_id));
drop policy if exists "loyalty_programs member read" on public.loyalty_programs;
create policy "loyalty_programs member read" on public.loyalty_programs
  for select using (public.is_member(restaurant_id));

drop policy if exists "loyalty_wallets member read" on public.loyalty_wallets;
create policy "loyalty_wallets member read" on public.loyalty_wallets
  for select using (public.is_member(restaurant_id));

drop policy if exists "loyalty_events member read" on public.loyalty_events;
create policy "loyalty_events member read" on public.loyalty_events
  for select using (exists (
    select 1 from public.loyalty_wallets w
    where w.id = wallet_id and public.is_member(w.restaurant_id)
  ));

grant select on public.loyalty_programs, public.loyalty_wallets, public.loyalty_events
  to authenticated;
grant insert, update, delete on public.loyalty_programs to authenticated; -- RLS: doar admin
revoke insert, update, delete on public.loyalty_wallets, public.loyalty_events
  from anon, authenticated;

-- ── 3. Gate de plan: loyalty = growth+ (NU cere Plan 3 — nu atinge bani/bon) ──
insert into public.plan_features (plan, feature, enabled, limit_value) values
  ('free',       'loyalty', false, null),
  ('starter',    'loyalty', false, null),
  ('growth',     'loyalty', true,  null),
  ('pro',        'loyalty', true,  null),
  ('enterprise', 'loyalty', true,  null)
on conflict (plan, feature) do update set enabled = excluded.enabled;

-- ── 4a. Helper: hash-ul telefonului, cu normalizare RO ─────────────
-- „+40 712 345 678", „0040712345678" și „0712345678" sunt ACELAȘI număr —
-- fără normalizare, clientul își pierdea punctele când formatul diferă
-- între vizite. Sursă unică pentru get_loyalty_state + loyalty_attach_order.
create or replace function public.fn_loyalty_phone_hash(p_phone text)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select case
    when length(d.digits) between 8 and 15 then md5(d.digits)
  end
  from (
    select case
      -- 0040712345678 → 0712345678 ; 40712345678 → 0712345678
      when raw like '0040%'                        then '0' || substr(raw, 5)
      when raw like '40%' and length(raw) = 11     then '0' || substr(raw, 3)
      else raw
    end as digits
    from (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as raw) r
  ) d
$$;
revoke all on function public.fn_loyalty_phone_hash(text) from public, anon, authenticated;

-- ── 4b. Helper intern: gate-ul complet (modul + plan + program activ) ──
create or replace function public.fn_loyalty_active(p_restaurant_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.is_module_enabled(p_restaurant_id, 'loyalty')
     and public.restaurant_has_feature(p_restaurant_id, 'loyalty')
     and exists (
       select 1 from public.loyalty_programs
       where restaurant_id = p_restaurant_id and is_active
     )
$$;
revoke all on function public.fn_loyalty_active(uuid) from public, anon, authenticated;

-- ── 5. get_loyalty_state — starea cardului pentru clientul QR (anon) ──
create or replace function public.get_loyalty_state(
  p_qr_token_id uuid,
  p_anon_id     text default null,
  p_phone       text default null
) returns jsonb
language plpgsql stable security definer
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

-- ── 6. loyalty_attach_order — leagă o comandă proaspătă de wallet (anon) ──
-- Chemat de client imediat după createOrder. Creează/upgrade-ază wallet-ul.
create or replace function public.loyalty_attach_order(
  p_order_id    uuid,
  p_qr_token_id uuid,
  p_anon_id     text default null,
  p_phone       text default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_token   record;
  v_order   record;
  v_hash    text;
  v_wallet  public.loyalty_wallets;
  v_code    text;
  v_try     int := 0;
begin
  select qt.restaurant_id into v_token
  from public.qr_tokens qt
  where qt.id = p_qr_token_id and qt.is_active = true;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_token');
  end if;

  if not public.fn_loyalty_active(v_token.restaurant_id) then
    return jsonb_build_object('ok', false, 'reason', 'loyalty_disabled');
  end if;

  -- Comanda trebuie să fie a restaurantului tokenului, proaspătă și nelegată.
  -- (Fereastra de 4h limitează abuzul pe order_id-uri ghicite/vechi.)
  select id, restaurant_id, status, loyalty_wallet_id, created_at
    into v_order from public.orders where id = p_order_id;
  if not found or v_order.restaurant_id <> v_token.restaurant_id then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;
  if v_order.loyalty_wallet_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_attached');
  end if;
  if v_order.created_at < now() - interval '4 hours'
     or v_order.status in ('cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'order_not_eligible');
  end if;

  -- Cheile de identitate: măcar una validă (telefonul normalizat RO — vezi 4a).
  v_hash := public.fn_loyalty_phone_hash(p_phone);
  if v_hash is null and (p_anon_id is null or p_anon_id !~ '^[A-Za-z0-9_-]{8,64}$') then
    return jsonb_build_object('ok', false, 'reason', 'identity_required');
  end if;

  -- Rezoluția wallet-ului (telefonul are prioritate; upgrade-ază cardul anonim).
  if v_hash is not null then
    select * into v_wallet from public.loyalty_wallets
     where restaurant_id = v_token.restaurant_id and phone_hash = v_hash;
    if v_wallet.id is null and p_anon_id is not null then
      -- „upgrade": cardul anonim primește telefonul (punctele se păstrează).
      update public.loyalty_wallets
         set phone_hash = v_hash, updated_at = now()
       where restaurant_id = v_token.restaurant_id and anon_id = p_anon_id
         and phone_hash is null
      returning * into v_wallet;
    end if;
  else
    select * into v_wallet from public.loyalty_wallets
     where restaurant_id = v_token.restaurant_id and anon_id = p_anon_id;
  end if;

  if v_wallet.id is null then
    -- Wallet nou, cu cod scurt unic per restaurant (retry pe coliziune).
    loop
      v_try := v_try + 1;
      v_code := upper(substr(md5(gen_random_uuid()::text), 1, 6));
      exit when not exists (
        select 1 from public.loyalty_wallets
        where restaurant_id = v_token.restaurant_id and short_code = v_code
      );
      if v_try > 10 then
        raise exception 'loyalty_attach_order: could not generate short_code';
      end if;
    end loop;
    begin
      insert into public.loyalty_wallets (restaurant_id, phone_hash, anon_id, short_code)
      values (v_token.restaurant_id, v_hash, nullif(p_anon_id, ''), v_code)
      returning * into v_wallet;
    exception when unique_violation then
      -- Cursă pe aceeași cheie (dublu-tap): refolosim wallet-ul câștigător.
      select * into v_wallet from public.loyalty_wallets
       where restaurant_id = v_token.restaurant_id
         and ((v_hash is not null and phone_hash = v_hash)
           or (p_anon_id is not null and anon_id = p_anon_id))
       limit 1;
      if v_wallet.id is null then raise; end if;
    end;
  end if;

  update public.orders set loyalty_wallet_id = v_wallet.id
   where id = p_order_id and loyalty_wallet_id is null;

  return jsonb_build_object('ok', true, 'points', v_wallet.points,
    'short_code', v_wallet.short_code);
end$$;

revoke all on function public.loyalty_attach_order(uuid, uuid, text, text) from public;
grant execute on function public.loyalty_attach_order(uuid, uuid, text, text) to anon, authenticated;

-- ── 7. Trigger de acumulare la prima tranziție terminală de succes ──
-- ('paid' pe pro/enterprise, 'closed' pe growth — vezi antetul migrației).
create or replace function public.fn_loyalty_earn()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_prog  public.loyalty_programs;
  v_pts   int;
begin
  if new.status not in ('paid', 'closed')
     or coalesce(old.status, 'new'::public.order_status) in ('paid', 'closed')
     or new.loyalty_wallet_id is null then
    return null;
  end if;
  if not public.fn_loyalty_active(new.restaurant_id) then
    return null;
  end if;
  select * into v_prog from public.loyalty_programs
   where restaurant_id = new.restaurant_id;

  v_pts := floor(coalesce(new.total, 0) * v_prog.points_per_leu);
  if v_pts <= 0 then
    return null;
  end if;

  -- Indexul parțial unic pe (order_id) where kind='earn' face inserul
  -- idempotent — retrigger-ul (ex. UPDATE repetat pe paid) nu dublează.
  insert into public.loyalty_events (wallet_id, order_id, delta, kind)
  values (new.loyalty_wallet_id, new.id, v_pts, 'earn')
  on conflict (order_id) where kind = 'earn' do nothing;
  if found then
    update public.loyalty_wallets
       set points = points + v_pts, updated_at = now()
     where id = new.loyalty_wallet_id;
  end if;
  return null;
end$$;

drop trigger if exists trg_loyalty_earn on public.orders;
create trigger trg_loyalty_earn
  after update of status on public.orders
  for each row execute function public.fn_loyalty_earn();

-- ── 8. redeem_loyalty_reward — staff-only, pe codul scurt al cardului ──
create or replace function public.redeem_loyalty_reward(
  p_restaurant_id uuid,
  p_code          text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_prog   public.loyalty_programs;
  v_wallet public.loyalty_wallets;
begin
  if not public.is_member(p_restaurant_id) then
    raise exception 'Acces interzis';
  end if;
  select * into v_prog from public.loyalty_programs
   where restaurant_id = p_restaurant_id and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'program_inactive');
  end if;

  select * into v_wallet from public.loyalty_wallets
   where restaurant_id = p_restaurant_id
     and short_code = upper(btrim(coalesce(p_code, '')))
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_wallet.points < v_prog.reward_threshold then
    return jsonb_build_object('ok', false, 'reason', 'not_enough_points',
      'points', v_wallet.points, 'threshold', v_prog.reward_threshold);
  end if;

  insert into public.loyalty_events (wallet_id, delta, kind)
  values (v_wallet.id, -v_prog.reward_threshold, 'redeem');
  update public.loyalty_wallets
     set points = points - v_prog.reward_threshold, updated_at = now()
   where id = v_wallet.id;

  return jsonb_build_object('ok', true,
    'reward_description', v_prog.reward_description,
    'points_left', v_wallet.points - v_prog.reward_threshold);
end$$;

revoke all on function public.redeem_loyalty_reward(uuid, text) from public, anon;
grant execute on function public.redeem_loyalty_reward(uuid, text) to authenticated;

comment on function public.redeem_loyalty_reward(uuid, text) is
  $$Staff-only (is_member): răscumpără recompensa pe codul scurt al cardului.
  Scade pragul din puncte + loghează în loyalty_events (append-only).$$;

-- ── Asserții fail-closed ──────────────────────────────────────────
do $$
declare v_def text;
begin
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='loyalty_wallets') then
    raise exception 'ASSERT FAIL (mig 226): tabelele loyalty lipsesc';
  end if;
  if exists (
    select 1 from pg_tables t
    where t.schemaname='public'
      and t.tablename in ('loyalty_programs','loyalty_wallets','loyalty_events')
      and not exists (
        select 1 from pg_class c
        where c.relname = t.tablename and c.relrowsecurity
      )
  ) then
    raise exception 'ASSERT FAIL (mig 226): RLS oprit pe o tabelă loyalty';
  end if;
  -- Regula de plan: loyalty OFF sub growth.
  if exists (
    select 1 from public.plan_features
    where feature='loyalty' and plan in ('free','starter') and enabled
  ) then
    raise exception 'ASSERT FAIL (mig 226): loyalty activ sub growth';
  end if;
  -- anon poate citi starea și atașa comanda, dar NU poate răscumpăra.
  if not has_function_privilege('anon', 'public.get_loyalty_state(uuid, text, text)', 'execute') then
    raise exception 'ASSERT FAIL (mig 226): get_loyalty_state trebuie apelabil de anon';
  end if;
  if has_function_privilege('anon', 'public.redeem_loyalty_reward(uuid, text)', 'execute') then
    raise exception 'ASSERT FAIL (mig 226): anon poate răscumpăra recompense!';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_loyalty_earn' and tgrelid = 'public.orders'::regclass
  ) then
    raise exception 'ASSERT FAIL (mig 226): trigger-ul de earn lipsește';
  end if;
  v_def := pg_get_functiondef('public.fn_loyalty_earn()'::regprocedure);
  if position('fn_loyalty_active' in v_def) = 0 or position('on conflict' in v_def) = 0 then
    raise exception 'ASSERT FAIL (mig 226): earn fără gate/idempotență';
  end if;
  v_def := pg_get_functiondef('public.redeem_loyalty_reward(uuid, text)'::regprocedure);
  if position('is_member' in v_def) = 0 then
    raise exception 'ASSERT FAIL (mig 226): redeem fără gate de membru';
  end if;
end $$;

commit;
