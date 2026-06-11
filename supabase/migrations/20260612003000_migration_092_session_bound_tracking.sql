-- Migration 092: Tracking public legat de sesiunea mesei (audit securitate)
-- ─────────────────────────────────────────────────────────────────────
-- Audit (2026-06-12): get_order_public_status și request_fiscal_receipt
-- erau accesibile anon DOAR cu UUID-ul comenzii:
--   • oricine cu UUID-ul vedea total / tips / paid_amount / payment_method
--   • oricine cu UUID-ul putea cere bon fiscal pe comanda altcuiva (WRITE)
-- UUID-ul e ne-ghicibil (122 biți), dar scapă prin canale laterale
-- (screenshot, history pe telefon partajat, breadcrumbs).
--
-- Design (varianta a din review): order_id + session_id valid = payload
-- complet; altfel payload MINIM {status, short_id}. Compatibil cu clienții
-- vechi din cache: p_session_id are default null → primesc minimul, UI-ul
-- lor afișează doar statusul (câmpurile de bani sunt deja guard-uite cu
-- typeof în OrderTracker).
--
-- Notă expirare: sesiunea se AUTO-închide când toate comenzile devin
-- terminale (mig 084). Validăm deci: sesiune 'open' SAU închisă de sub
-- 2 ore — altfel clientul ar pierde ecranul de plată/review exact în
-- momentul în care comanda devine 'paid'. După 2h, tracking-ul devine
-- minimal natural.
--
-- Comenzile FĂRĂ session_id (pickup, istoric pre-084): păstrează
-- comportamentul vechi (full pe UUID) — clientul de pickup nu are sesiune
-- de masă; suprafața de risc rămâne doar pe acest subset îngust.
-- ─────────────────────────────────────────────────────────────────────

-- Helper: sesiunea e validă pentru comanda dată?
create or replace function public._order_session_valid(p_order_id uuid, p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.orders o
    join public.table_sessions s on s.id = o.session_id
    where o.id = p_order_id
      and o.session_id = p_session_id
      and (
        s.status = 'open'
        or (s.closed_at is not null and s.closed_at > now() - interval '2 hours')
      )
  );
$$;

revoke all on function public._order_session_valid(uuid, uuid) from public;
-- doar intern (apelat din funcțiile SECURITY DEFINER de mai jos)

-- ── 1. get_order_public_status: full doar cu sesiune validă ──
-- Drop semnătura veche (1-arg): două overload-uri ar da
-- "function is not unique" la apelurile PostgREST cu un singur parametru.
drop function if exists public.get_order_public_status(uuid);

create or replace function public.get_order_public_status(
  p_order_id   uuid,
  p_session_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_order  record;
  v_full   boolean;
begin
  select o.id, o.status, o.total, o.tips_amount, o.paid_amount, o.payment_method,
         o.discount_amount, o.created_at, o.paid_at, o.served_at,
         o.fiscal_receipt_requested_at, o.session_id, o.restaurant_id
    into v_order
    from public.orders o
   where o.id = p_order_id;

  if v_order.id is null then
    return null;
  end if;

  -- Full payload: sesiune validă SAU comandă fără sesiune (pickup/legacy).
  v_full := v_order.session_id is null
            or (p_session_id is not null
                and public._order_session_valid(p_order_id, p_session_id));

  if not v_full then
    -- Payload MINIM: fără bani, fără timestamps, fără date operaționale.
    return jsonb_build_object(
      'id',       v_order.id,
      'short_id', substring(v_order.id::text, 1, 6),
      'status',   v_order.status
    );
  end if;

  return (
    select jsonb_build_object(
      'id',                  v_order.id,
      'short_id',            substring(v_order.id::text, 1, 6),
      'status',              v_order.status,
      'total',               v_order.total,
      'tips_amount',         v_order.tips_amount,
      'paid_amount',         v_order.paid_amount,
      'payment_method',      v_order.payment_method,
      'discount_amount',     v_order.discount_amount,
      'created_at',          v_order.created_at,
      'paid_at',             v_order.paid_at,
      'served_at',           v_order.served_at,
      'fiscal_receipt_requested_at', v_order.fiscal_receipt_requested_at,
      'restaurant', jsonb_build_object(
        'name',              r.name,
        'slug',              r.slug,
        'google_review_url', coalesce(r.google_review_url,
                               public.compute_google_review_url(r.google_place_id))
      )
    )
    from public.restaurants r
    where r.id = v_order.restaurant_id
  );
end;
$$;

revoke all on function public.get_order_public_status(uuid, uuid) from public;
grant execute on function public.get_order_public_status(uuid, uuid) to anon, authenticated;

-- ── 2. request_fiscal_receipt: WRITE-ul cere sesiune validă ──
drop function if exists public.request_fiscal_receipt(uuid);

create or replace function public.request_fiscal_receipt(
  p_order_id   uuid,
  p_session_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_status        text;
  v_already       timestamptz;
  v_session_id    uuid;
begin
  select restaurant_id, status, fiscal_receipt_requested_at, session_id
    into v_restaurant_id, v_status, v_already, v_session_id
    from public.orders
   where id = p_order_id;

  if v_restaurant_id is null then
    raise exception 'Comandă inexistentă';
  end if;

  -- ★ Gate sesiune (mig 092): doar clientul de la masă (sesiune validă)
  -- poate cere bonul. Comenzile fără sesiune (pickup/legacy) rămân pe
  -- comportamentul vechi.
  if v_session_id is not null
     and (p_session_id is null
          or not public._order_session_valid(p_order_id, p_session_id)) then
    raise exception 'Sesiunea mesei nu mai este validă.'
      using errcode = 'P0001', hint = 'session_required';
  end if;

  if v_status not in ('paid', 'served') then
    raise exception 'Bonul fiscal se poate cere doar după plată';
  end if;

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

  return jsonb_build_object(
    'success', true,
    'already_requested', false,
    'requested_at', now()
  );
end;
$$;

revoke all on function public.request_fiscal_receipt(uuid, uuid) from public;
grant execute on function public.request_fiscal_receipt(uuid, uuid) to anon, authenticated;
