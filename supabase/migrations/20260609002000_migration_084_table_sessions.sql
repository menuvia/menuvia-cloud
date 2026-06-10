-- Migration 084: Poarta B — table_sessions + open_table_session + guard în create_order
-- ─────────────────────────────────────────────────────────────────────
-- Spec §4: "Separă identitatea stabilă de sesiunea efemeră."
--   • Token tipărit = identitatea permanentă (nu se schimbă)
--   • Sesiune = grupul care stă acum la masă (se deschide la ocupare,
--     se închide la plată/închidere, expiră la inactivitate)
--
-- Implementare:
--   1. Tabela table_sessions + index UNIQUE „o sesiune open/masă"
--   2. RPC open_table_session(token_text) — pas separat la scanare
--   3. Coloana orders.session_id (nullable, FK)
--   4. Guard în create_order pentru source='qr': verifică sesiunea open
--   5. Trigger auto-close sesiune când toate comenzile sunt terminale
--   6. Funcție de cleanup pentru sesiuni expirate (apelabilă din cron)
-- ─────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════
-- 1. Tabela table_sessions
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.table_sessions (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants(id)  on delete cascade,
  table_id         uuid not null references public.tables(id)       on delete cascade,
  status           text not null default 'open'
                     check (status in ('open', 'closed', 'expired')),
  opened_at        timestamptz not null default now(),
  closed_at        timestamptz,
  last_activity_at timestamptz not null default now()
);

-- O singură sesiune 'open' per masă la un moment dat (constraint principal)
create unique index if not exists table_sessions_one_open_per_table
  on public.table_sessions(table_id)
  where status = 'open';

create index if not exists table_sessions_restaurant_idx
  on public.table_sessions(restaurant_id, status);
create index if not exists table_sessions_opened_idx
  on public.table_sessions(opened_at desc);

comment on table public.table_sessions is
  'Sesiune de masă (grupul curent). Token QR e stabil; sesiunea se deschide la scanare și se închide la plată/close.';

-- ═══════════════════════════════════════════════════════════════
-- 2. orders.session_id — FK opțional (waiter/pickup nu au sesiune)
-- ═══════════════════════════════════════════════════════════════
do $$ begin
  alter table public.orders
    add column session_id uuid references public.table_sessions(id) on delete set null;
exception when duplicate_column then null;
end $$;

create index if not exists orders_session_id_idx on public.orders(session_id);

-- ═══════════════════════════════════════════════════════════════
-- 3. RLS pe table_sessions
-- ═══════════════════════════════════════════════════════════════
alter table public.table_sessions enable row level security;

-- Membrii restaurantului văd sesiunile restaurantului lor
drop policy if exists "table_sessions: staff select" on public.table_sessions;
create policy "table_sessions: staff select"
  on public.table_sessions for select
  to authenticated
  using (
    exists (
      select 1 from public.restaurant_memberships rm
      where rm.restaurant_id = table_sessions.restaurant_id
        and rm.user_id = auth.uid()
    )
  );

-- FĂRĂ policy de SELECT pentru anon: clientul primește session_id din
-- open_table_session (SECURITY DEFINER) și nu are nevoie să citească tabela.
-- Un policy `using (status='open')` ar permite enumerarea tuturor sesiunilor
-- deschise (ocuparea meselor + id-uri) de către oricine.
drop policy if exists "table_sessions: anon read own" on public.table_sessions;

-- ═══════════════════════════════════════════════════════════════
-- 4. RPC open_table_session(token_text) — pas la scanarea QR-ului
-- ═══════════════════════════════════════════════════════════════
-- Spec: "Deschiderea sesiunii e un pas separat, la scanare.
--         create_order doar verifică. NU crea sesiunea în create_order
--         (altfel gardul e iluzoriu)."
--
-- Returns: { session_id, table_id, restaurant_id, status, opened_at }
-- Idempotent: dacă există deja o sesiune open → o returnează.
-- Dacă sesiunea e closed/expired → creează una nouă (slate curat).
create or replace function public.open_table_session(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qr          public.qr_tokens%rowtype;
  v_session_id  uuid;
  v_opened_at   timestamptz;
begin
  -- Validare token
  select * into v_qr
  from public.qr_tokens
  where token = p_token
    and is_active = true
    and (expires_at is null or expires_at > now());

  if not found then
    raise exception 'QR invalid sau expirat. Scanează din nou codul QR al mesei.'
      using errcode = 'P0001', hint = 'invalid_qr_token';
  end if;

  -- Verifică că restaurantul e activ
  if not exists (
    select 1 from public.restaurants
    where id = v_qr.restaurant_id and is_active = true
  ) then
    raise exception 'Restaurantul este momentan închis.'
      using errcode = 'P0001', hint = 'restaurant_inactive';
  end if;

  -- Returnează sesiunea open existentă dacă există (idempotent)
  select id, opened_at into v_session_id, v_opened_at
  from public.table_sessions
  where table_id = v_qr.table_id
    and status = 'open';

  if v_session_id is not null then
    -- Actualizează last_activity_at (keepalive)
    update public.table_sessions
      set last_activity_at = now()
    where id = v_session_id;

    return jsonb_build_object(
      'session_id',    v_session_id,
      'table_id',      v_qr.table_id,
      'restaurant_id', v_qr.restaurant_id,
      'status',        'open',
      'opened_at',     v_opened_at,
      'is_new',        false
    );
  end if;

  -- Creează sesiune nouă. Dacă un scan concurent a câștigat cursa (unique
  -- partial index pe table_id WHERE status='open'), recitim sesiunea open
  -- existentă → idempotent chiar sub concurență.
  begin
    insert into public.table_sessions (restaurant_id, table_id)
    values (v_qr.restaurant_id, v_qr.table_id)
    returning id, opened_at into v_session_id, v_opened_at;
  exception
    when unique_violation then
      select id, opened_at into v_session_id, v_opened_at
      from public.table_sessions
      where table_id = v_qr.table_id and status = 'open';
      -- Fereastră rară: sesiunea câștigătoare a fost închisă/ștearsă între
      -- conflict și recitire. Mai bine eroare explicită decât session_id null.
      if v_session_id is null then
        raise exception 'Nu am putut deschide sesiunea mesei. Scanează din nou codul QR.'
          using errcode = 'P0001', hint = 'session_open_race';
      end if;
  end;

  return jsonb_build_object(
    'session_id',    v_session_id,
    'table_id',      v_qr.table_id,
    'restaurant_id', v_qr.restaurant_id,
    'status',        'open',
    'opened_at',     v_opened_at,
    'is_new',        true
  );
end;
$$;

revoke all on function public.open_table_session(text) from public;
grant execute on function public.open_table_session(text) to anon, authenticated;

comment on function public.open_table_session is
  'Deschide sau returnează sesiunea curentă a mesei. Apelat la scanarea QR-ului, NU în create_order.';

-- ═══════════════════════════════════════════════════════════════
-- 5. Actualizare create_order: verifică sesiunea pentru source='qr'
-- ═══════════════════════════════════════════════════════════════
-- Spec §4.3: "create_order doar verifică; NU creează sesiunea"
-- Recitim funcția completă cu guard adăugat.
-- Notă: adăugăm p_session_id ca parametru opțional (backward compat:
--   null → skip check pentru tranziția graduală; non-null → verifică).
--   Frontend-ul nou trimite session_id; cel vechi (fără update) nu pică.
do $$
begin
  -- Adaugă coloana session_id la orders dacă nu există (deja făcut sus,
  -- dar create_or_replace mai jos o referențiază)
  null;
end$$;

create or replace function public.create_order(
  p_restaurant_id   uuid,
  p_source          text,
  p_table_id        uuid,
  p_qr_token_id     uuid,
  p_notes           text,
  p_items           jsonb,
  p_idempotency_key uuid      default null,
  p_pickup_time     timestamptz default null,
  p_customer_name   text      default null,
  p_customer_phone  text      default null,
  p_session_id      uuid      default null  -- NOU: trimis de frontend după open_table_session
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id       uuid;
  v_existing_id    uuid;
  v_existing_total numeric;
  v_existing_status text;
  v_existing_created timestamptz;
  v_short_id       text;
  v_total          numeric := 0;
  v_item           jsonb;
  v_product        record;
  v_extras_total   numeric;
  v_extras_json    jsonb;
  v_options_total  numeric;
  v_options_json   jsonb;
  v_options_count_expected int;
  v_options_count_found    int;
  v_unit_price     numeric;
  v_item_qty       smallint;
  v_item_total     numeric;
  v_item_notes     text;
  v_upsell_source  text;
  v_item_count     int;
  v_qr_token       record;
  v_effective_table_id uuid;
  v_pickup_settings jsonb;
  v_pickup_enabled  boolean;
  v_min_lead_min    int;
  v_user_id         uuid;
  v_created_by      uuid;
  v_clean_notes     text;
  v_session         record;
begin
  -- ─── IDEMPOTENCY ─────────────────────────────────────────────
  if p_idempotency_key is not null then
    select id, total, status, created_at
      into v_existing_id, v_existing_total, v_existing_status, v_existing_created
      from public.orders
     where restaurant_id = p_restaurant_id
       and idempotency_key = p_idempotency_key
     limit 1;

    if v_existing_id is not null then
      return jsonb_build_object(
        'id',         v_existing_id,
        'short_id',   upper(right(v_existing_id::text, 6)),
        'status',     v_existing_status,
        'total',      v_existing_total,
        'created_at', v_existing_created
      );
    end if;
  end if;

  -- ─── SOURCE VALIDATION ───────────────────────────────────────
  if p_source not in ('qr', 'waiter', 'pickup') then
    raise exception 'Invalid source: %', p_source
      using errcode = 'P0001', hint = 'invalid_source';
  end if;

  -- ─── ITEMS BASIC VALIDATION ──────────────────────────────────
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Order must have at least one item'
      using errcode = 'P0001', hint = 'no_items';
  end if;

  v_item_count := jsonb_array_length(p_items);
  if v_item_count > 30 then
    raise exception 'Order has too many lines: % (max 30)', v_item_count
      using errcode = 'P0001', hint = 'too_many_items';
  end if;

  -- ─── SOURCE-SPECIFIC VALIDATIONS ─────────────────────────────
  if p_source = 'qr' then
    if p_qr_token_id is null then
      raise exception 'QR orders require p_qr_token_id'
        using errcode = 'P0001', hint = 'missing_qr_token';
    end if;

    select * into v_qr_token
    from public.qr_tokens
    where id = p_qr_token_id
      and restaurant_id = p_restaurant_id
      and is_active = true
      and (expires_at is null or expires_at > now());

    if not found then
      raise exception 'QR token invalid sau expirat'
        using errcode = 'P0001', hint = 'invalid_qr_token';
    end if;

    v_effective_table_id := v_qr_token.table_id;

    -- ── GUARD SESIUNE (Spec §4.3) ────────────────────────────
    -- Dacă frontend-ul trimite session_id → verificăm că sesiunea e
    -- open și aparține acestei mese. Dacă nu e trimis → skip (compat).
    if p_session_id is not null then
      select * into v_session
      from public.table_sessions
      where id = p_session_id
        and table_id = v_qr_token.table_id
        and status = 'open';

      if not found then
        raise exception 'Masa a fost închisă sau sesiunea a expirat. Scanează din nou QR-ul ca să începi o comandă nouă.'
          using errcode = 'P0001', hint = 'session_closed';
      end if;

      -- Actualizează last_activity_at
      update public.table_sessions
        set last_activity_at = now()
      where id = p_session_id;
    end if;

  elsif p_source = 'waiter' then
    v_user_id := auth.uid();
    if v_user_id is null then
      raise exception 'Waiter orders require authentication'
        using errcode = 'P0001', hint = 'auth_required';
    end if;

    if not exists (
      select 1 from public.restaurant_memberships
      where restaurant_id = p_restaurant_id
        and user_id = v_user_id
        and role in ('owner', 'manager', 'waiter')
    ) then
      raise exception 'Nu ești autorizat să creezi comenzi pentru acest restaurant'
        using errcode = 'P0001', hint = 'unauthorized';
    end if;

    v_created_by := v_user_id;
    v_effective_table_id := p_table_id;

  elsif p_source = 'pickup' then
    if p_customer_name is null or length(trim(p_customer_name)) = 0 then
      raise exception 'Pickup orders require customer name'
        using errcode = 'P0001', hint = 'missing_customer_name';
    end if;

    select rs.pickup_enabled
    into v_pickup_enabled
    from public.restaurant_settings rs
    where rs.restaurant_id = p_restaurant_id;

    -- Blocăm explicit doar când pickup e dezactivat (false). Lipsa rândului
    -- de settings (null) păstrează comportamentul anterior (permis).
    if v_pickup_enabled is false then
      raise exception 'Comenzile pickup sunt dezactivate pentru acest restaurant.'
        using errcode = 'P0001', hint = 'pickup_disabled';
    end if;

    perform public.check_pickup_order_rate_limit(p_restaurant_id, p_customer_phone);

    v_effective_table_id := null;
  end if;

  -- ─── NOTES SANITIZATION ──────────────────────────────────────
  v_clean_notes := nullif(trim(coalesce(p_notes, '')), '');
  if v_clean_notes is not null and length(v_clean_notes) > 500 then
    raise exception 'Notes too long (max 500 chars)'
      using errcode = 'P0001', hint = 'notes_too_long';
  end if;

  -- ─── ITEMS PROCESSING ────────────────────────────────────────
  v_order_id := gen_random_uuid();

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_qty := coalesce((v_item->>'quantity')::smallint, 1);
    if v_item_qty < 1 or v_item_qty > 20 then
      raise exception 'Invalid quantity: % (must be 1-20)', v_item_qty
        using errcode = 'P0001', hint = 'invalid_quantity';
    end if;

    select id, price, is_active, restaurant_id, name
    into v_product
    from public.products
    where id = (v_item->>'product_id')::uuid;

    if not found then
      raise exception 'Product not found: %', v_item->>'product_id'
        using errcode = 'P0001', hint = 'product_not_found';
    end if;
    if v_product.restaurant_id != p_restaurant_id then
      raise exception 'Product % does not belong to this restaurant', v_product.id
        using errcode = 'P0001', hint = 'product_wrong_restaurant';
    end if;
    if not v_product.is_active then
      raise exception 'Product "%" is not available', v_product.name
        using errcode = 'P0001', hint = 'product_inactive';
    end if;

    v_unit_price := v_product.price;

    -- Modifier options validation
    v_options_total := 0;
    v_options_json  := '[]'::jsonb;
    if v_item ? 'option_ids' and jsonb_array_length(v_item->'option_ids') > 0 then
      v_options_count_expected := jsonb_array_length(v_item->'option_ids');
      select
        count(*),
        coalesce(sum(mo.price_delta), 0),
        coalesce(jsonb_agg(jsonb_build_object(
          'group_id',    mg.id,
          'group_name',  mg.name,
          'option_id',   mo.id,
          'option_name', mo.name,
          'price_delta', mo.price_delta
        )), '[]'::jsonb)
      into v_options_count_found, v_options_total, v_options_json
      from jsonb_array_elements_text(v_item->'option_ids') opt_id
      join public.modifier_options mo on mo.id = opt_id::uuid
      join public.modifier_groups mg  on mg.id = mo.modifier_group_id
      join public.product_modifier_groups pmg on pmg.modifier_group_id = mg.id
      where pmg.product_id = v_product.id
        and mo.is_available = true
        and mg.restaurant_id = p_restaurant_id;

      if v_options_count_found != v_options_count_expected then
        raise exception 'Invalid or unavailable modifier options for product "%"', v_product.name
          using errcode = 'P0001', hint = 'invalid_options';
      end if;
    end if;

    -- Extras validation
    v_extras_total := 0;
    v_extras_json  := '[]'::jsonb;
    if v_item ? 'extra_ids' and jsonb_array_length(v_item->'extra_ids') > 0 then
      select
        coalesce(sum(pe.price), 0),
        coalesce(jsonb_agg(jsonb_build_object(
          'extra_id',   pe.id,
          'extra_name', pe.name,
          'price',      pe.price
        )), '[]'::jsonb)
      into v_extras_total, v_extras_json
      from jsonb_array_elements_text(v_item->'extra_ids') eid
      join public.product_extras pe on pe.id = eid::uuid
      where pe.product_id = v_product.id
        and pe.restaurant_id = p_restaurant_id
        and pe.is_available = true;
    end if;

    v_item_notes := nullif(trim(coalesce(v_item->>'notes', '')), '');
    if v_item_notes is not null and length(v_item_notes) > 300 then
      raise exception 'Item notes too long (max 300 chars)'
        using errcode = 'P0001', hint = 'item_notes_too_long';
    end if;

    v_item_total := (v_unit_price + v_options_total + v_extras_total) * v_item_qty;
    v_total      := v_total + v_item_total;

    insert into public.order_items (
      order_id, product_id, product_name_snapshot, unit_price_snapshot,
      quantity, item_total, selected_modifiers, selected_extras, notes
    ) values (
      v_order_id, v_product.id, v_product.name, v_unit_price,
      v_item_qty, v_item_total, v_options_json, v_extras_json, v_item_notes
    );
  end loop;

  -- ─── UPSELL SOURCE ───────────────────────────────────────────
  v_upsell_source := nullif(trim(coalesce(p_notes, '')), '');

  -- ─── INSERT ORDER ─────────────────────────────────────────────
  insert into public.orders (
    id,
    restaurant_id, table_id, qr_token_id, source, status,
    total, notes, idempotency_key,
    pickup_time, customer_name, customer_phone,
    created_by, session_id
  ) values (
    v_order_id,
    p_restaurant_id, v_effective_table_id, p_qr_token_id,
    p_source::public.order_source, 'new',
    v_total, v_clean_notes, p_idempotency_key,
    p_pickup_time, p_customer_name, p_customer_phone,
    v_created_by,
    case when p_source = 'qr' then p_session_id else null end
  );

  -- Happy hour auto-apply (doar QR și pickup — mig 077 logica)
  if p_source in ('qr', 'pickup') then
    perform public._apply_happy_hour_auto(v_order_id);
  end if;

  v_short_id := upper(right(v_order_id::text, 6));

  return jsonb_build_object(
    'id',         v_order_id,
    'short_id',   v_short_id,
    'status',     'new',
    'total',      v_total,
    'created_at', now()
  );
end;
$$;

revoke all on function public.create_order(uuid, text, uuid, uuid, text, jsonb, uuid, timestamptz, text, text, uuid) from public;
grant execute on function public.create_order(uuid, text, uuid, uuid, text, jsonb, uuid, timestamptz, text, text, uuid) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 6. Auto-close sesiune când toate comenzile din sesiune sunt terminale
-- ═══════════════════════════════════════════════════════════════
create or replace function public.maybe_close_session_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_open_orders integer;
begin
  -- Interesează doar schimbările de status spre terminal
  if new.status not in ('paid', 'cancelled') then
    return new;
  end if;
  if new.session_id is null then
    return new;
  end if;

  v_session_id := new.session_id;

  -- Numără comenzile ne-terminale din sesiune
  select count(*) into v_open_orders
  from public.orders
  where session_id = v_session_id
    and status not in ('paid', 'cancelled')
    and id <> new.id;  -- excludem rândul curent (nu e încă committed)

  if v_open_orders = 0 then
    update public.table_sessions
      set status    = 'closed',
          closed_at = now()
    where id = v_session_id
      and status = 'open';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_maybe_close_session on public.orders;
create trigger trg_maybe_close_session
  after update of status on public.orders
  for each row execute function public.maybe_close_session_fn();

-- ═══════════════════════════════════════════════════════════════
-- 7. close_table_session(session_id) — buton manual pentru staff
-- ═══════════════════════════════════════════════════════════════
create or replace function public.close_table_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.table_sessions%rowtype;
  v_role    text;
begin
  select * into v_session
  from public.table_sessions where id = p_session_id;

  if not found then
    raise exception 'Sesiunea nu a fost găsită';
  end if;

  select role::text into v_role
  from public.restaurant_memberships
  where restaurant_id = v_session.restaurant_id
    and user_id = auth.uid();

  if v_role not in ('owner', 'manager', 'waiter') then
    raise exception 'Nu ești autorizat să închizi această sesiune';
  end if;

  update public.table_sessions
    set status    = 'closed',
        closed_at = now()
  where id = p_session_id
    and status = 'open';
end;
$$;

revoke all on function public.close_table_session(uuid) from public;
grant execute on function public.close_table_session(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 8. expire_inactive_sessions() — apelabilă din cron (pg_cron sau Edge Function)
-- ═══════════════════════════════════════════════════════════════
-- Spec §4.4: "Cron (infrastructura există) expiră sesiunile inactive > ~3h"
create or replace function public.expire_inactive_sessions(p_inactive_hours int default 3)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.table_sessions
    set status    = 'expired',
        closed_at = now()
  where status = 'open'
    and last_activity_at < now() - (p_inactive_hours || ' hours')::interval;

  -- count(*) nu e permis în RETURNING (per-row); folosim ROW_COUNT.
  get diagnostics v_count = row_count;

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.expire_inactive_sessions(int) from public;
grant execute on function public.expire_inactive_sessions(int) to service_role;

comment on function public.expire_inactive_sessions is
  'Expiră sesiunile inactive. Rulează din pg_cron sau Supabase Edge Function (cron schedule).';
