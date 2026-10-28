-- ═══════════════════════════════════════════════════════════════════
-- Migration 292: bani pe Planul 3 — (BF-4) comanda `paid` e imuabilă pentru
-- rolurile client; (BF-1) plata online „toată masa" nu mai poate fi încasată
-- de două ori.
-- ─────────────────────────────────────────────────────────────────────
-- BF-4. Politica `orders: admin all` (mig 013) lasă un admin să facă PATCH
--   direct pe o comandă. `trg_orders_cancel_ledger_gate` (270) verifică DOAR
--   registrul `order_payments`, iar `mark_paid` FĂRĂ plăți parțiale scrie doar
--   `paid_amount` (registrul rămâne GOL) → `paid → cancelled` trecea, iar
--   `cash_collected_for_shift` și `v_order_payment_methods` scădeau pentru o
--   comandă deja bonată. Aceeași cale rescria `paid_amount`, `payment_method`,
--   `total`, `discount_*`, `tips_amount`, `paid_at` pe o comandă fiscalizată.
--   Aceeași politică permite și DELETE: ștergerea unei comenzi `paid`
--   cascada `order_payments` → banii dispăreau din rapoarte și din sertar.
--   Fix în DATE: trigger BEFORE UPDATE OR DELETE ROW pe `orders` — cât timp
--   `old.status = 'paid'`, `anon`/`authenticated` nu pot schimba niciuna din
--   coloanele de BANI și nu pot ȘTERGE rândul. Funcția e NE-definer DELIBERAT
--   (trebuie să vadă rolul apelantului — ca
--   `fn_pending_receipts_block_client_repend`, 270): din
--   `advance_order`/`settle_table_payment`/triggerele DEFINER `current_user`
--   e owner-ul funcției (postgres), deci fluxurile legitime trec (anonimizarea
--   GDPR pe `customer_name/phone`, loyalty, stoc, `request_fiscal_receipt`;
--   NU și paid → closed pe Plan 3 — acolo respinge deja
--   `trg_orders_closed_fiscal_gate`, mig 264, pe ORICE rol). Ștergerea GDPR a
--   contului (`process_account_deletions`, cascada din `auth.users`) rulează
--   ca postgres — acțiunile RI se execută cu identitatea proprietarului
--   tabelei — deci nu e atinsă. Coloanele de identitate și
--   `fiscal_receipt_requested_at` NU sunt protejate.
--
-- BF-1. `begin_table_payment` (211) și `begin_split_payment` (229) puneau în
--   `superseded_intents` doar rândurile `created/processing`. Un intent
--   `failed` rămâne CONFIRMABIL (mig 207: Stripe permite alt card în același
--   Payment Element), dar nu era anulat la Stripe: B plătea toată masa
--   (comenzile → paid), A reîncerca cu alt card și plătea încă o dată;
--   settle-ul lui A vedea comenzile deja plătite (skip) → bani dubli, refund
--   manual. Fix minimal: `failed` CU intent atașat intră în `v_superseded`
--   (în begin_table_payment pentru toate rândurile; în begin_split_payment
--   doar pentru `kind = 'table'` — split-urile ALTORA rămân pe regula
--   curentă: stale > 15 min). Funcția Netlify le anulează la Stripe cu
--   disciplina provably-dead, apoi settle `canceled` (tranziția failed →
--   canceled e permisă de settle, mig 207).
--   Ambele funcții: corpul ULTIMEI definiții (211 / 229) verbatim, cu o
--   singură modificare (predicatul de status al supersede-ului).
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- ── 1. BF-4: trigger în DATE ─────────────────────────────────────────
create or replace function public.fn_orders_paid_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_col text;
begin
  if tg_op = 'DELETE' then
    if old.status = 'paid' and current_user in ('anon', 'authenticated') then
      raise exception 'Comanda este plătită și bonată — nu se poate șterge prin DELETE direct (registrul de plăți ar dispărea din rapoarte și din sertar)'
        using errcode = 'P0001', hint = 'paid_order_immutable';
    end if;
    return old;
  end if;

  if old.status = 'paid' and current_user in ('anon', 'authenticated') then
    v_col := case
      when new.status          is distinct from old.status          then 'status'
      when new.paid_amount     is distinct from old.paid_amount     then 'paid_amount'
      when new.payment_method  is distinct from old.payment_method  then 'payment_method'
      when new.total           is distinct from old.total           then 'total'
      when new.discount_type   is distinct from old.discount_type   then 'discount_type'
      when new.discount_value  is distinct from old.discount_value  then 'discount_value'
      when new.discount_amount is distinct from old.discount_amount then 'discount_amount'
      when new.tips_amount     is distinct from old.tips_amount     then 'tips_amount'
      when new.paid_at         is distinct from old.paid_at         then 'paid_at'
      else null
    end;
    if v_col is not null then
      raise exception 'Comanda este plătită și bonată — câmpul % nu se mai poate modifica prin UPDATE direct (folosește fluxul de închidere/stornare)', v_col
        using errcode = 'P0001', hint = 'paid_order_immutable';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.fn_orders_paid_immutable() from public, anon, authenticated, service_role;

drop trigger if exists trg_orders_paid_immutable on public.orders;
create trigger trg_orders_paid_immutable
  before update or delete on public.orders
  for each row
  execute function public.fn_orders_paid_immutable();

comment on function public.fn_orders_paid_immutable() is
  'mig 292 (BF-4): backstop in DATE — anon/authenticated nu pot rescrie campurile de bani ale unei comenzi paid prin UPDATE direct si nici nu o pot sterge (orders: admin all). NE-definer deliberat: current_user din RPC-urile DEFINER e owner-ul, deci advance_order/settle/loyalty/GDPR trec.';

-- ── 2. BF-1: begin_table_payment (corp = mig 211 + failed în supersede) ───
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
  v_currency   text;
  v_amount     numeric := 0;
  v_order_ids  uuid[];
  v_totals     jsonb;
  v_superseded jsonb;
  v_fee_bps    integer := 0;
  v_fee        numeric := 0;
  v_payment_id uuid;
begin
  -- Sesiune deschisă (lock: begin-urile concurente pe aceeași masă se
  -- serializează pe rândul sesiunii — supersede-ul de mai jos e race-safe).
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
  select stripe_account_id, upper(coalesce(currency, 'RON'))
    into v_account, v_currency
    from public.restaurants where id = v_sess.restaurant_id;
  if v_account is null then
    raise exception 'Restaurantul nu are contul de plăți conectat.'
      using errcode = 'P0001', hint = 'not_connected';
  end if;

  -- Gate de monedă (mig 209): bonul fiscal e RON-only → plata online la fel.
  if v_currency <> 'RON' then
    raise exception 'Plata online e disponibilă doar pentru meniuri în lei (RON).'
      using errcode = 'P0001', hint = 'currency_not_supported';
  end if;

  -- Suma se calculează AICI (niciodată din client): comenzile sesiunii care
  -- nu sunt plătite/anulate/închise și nu au deja plăți parțiale pornite
  -- (acelea se termină pe fluxul de staff, altfel am dubla încasarea).
  -- + snapshot-ul per comandă (F2).
  select coalesce(array_agg(o.id), '{}'),
         coalesce(sum(o.total), 0),
         coalesce(jsonb_object_agg(o.id::text, o.total), '{}'::jsonb)
    into v_order_ids, v_amount, v_totals
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

  -- F3: un singur intent live per sesiune. Rândurile 'created' fără intent
  -- (attach eșuat / sheet abandonat) nu au nimic la Stripe — anulate direct.
  update public.table_payments
     set status = 'canceled',
         settle_note = 'Înlocuit de o plată nouă (fără intent atașat).',
         updated_at = now()
   where session_id = p_session_id
     and status = 'created'
     and stripe_payment_intent_id is null;

  -- Intent-urile vii rămân NEATINSE aici (dacă unul a reușit între timp,
  -- webhook-ul lui trebuie să mai găsească rândul 'processing' ca să marcheze
  -- comenzile). Funcția Netlify le anulează la Stripe și abia apoi settle-ază.
  -- BF-1 (mig 292): și 'failed' CU intent — ultima încercare a eșuat, dar
  -- PaymentIntent-ul e încă confirmabil (alt card în același Payment Element,
  -- mig 207); lăsat în viață, plătea a doua oară peste nota achitată de altcineva.
  select coalesce(jsonb_agg(stripe_payment_intent_id), '[]'::jsonb)
    into v_superseded
    from public.table_payments
   where session_id = p_session_id
     and status in ('created', 'processing', 'failed')
     and stripe_payment_intent_id is not null;

  insert into public.table_payments
    (restaurant_id, session_id, order_ids, amount, currency, application_fee, order_totals)
  values
    (v_sess.restaurant_id, p_session_id, v_order_ids, v_amount, v_currency, v_fee, v_totals)
  returning id into v_payment_id;

  return jsonb_build_object(
    'payment_id',         v_payment_id,
    'amount',             v_amount,
    'currency',           v_currency,
    'application_fee',    v_fee,
    'order_ids',          to_jsonb(v_order_ids),
    'stripe_account_id',  v_account,
    'superseded_intents', v_superseded
  );
end;
$$;

revoke all on function public.begin_table_payment(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.begin_table_payment(uuid, text) to service_role;

comment on function public.begin_table_payment(uuid, text) is
  $$Inițiază plata online a mesei (mig 203 → 209 gate monedă → 211 supersede +
snapshot → 292 supersede și pe 'failed' cu intent): sumă EXCLUSIV server-side,
un singur intent confirmabil per sesiune, snapshot-ul totalurilor per comandă
pentru reconcilierea din settle. service_role-only.$$;

-- ── 3. BF-1: begin_split_payment (corp = mig 229 + failed pe kind='table') ─
create or replace function public.begin_split_payment(
  p_session_id uuid,
  p_token      text,
  p_claims     jsonb
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
  v_currency   text;
  v_claim      jsonb;
  v_item_id    uuid;
  v_qty        integer;
  v_row        record;
  v_ord        record;
  v_amount     numeric := 0;
  v_order_ids  uuid[];
  v_superseded jsonb;
  v_fee_bps    integer := 0;
  v_fee        numeric := 0;
  v_payment_id uuid;
begin
  -- Validarea formei claims-urilor (înainte de orice lock).
  if p_claims is null or jsonb_typeof(p_claims) <> 'array'
     or jsonb_array_length(p_claims) < 1 or jsonb_array_length(p_claims) > 60 then
    raise exception 'Selecție invalidă.'
      using errcode = 'P0001', hint = 'invalid_items';
  end if;

  -- Sesiune deschisă + LOCK (serializează cu TOATE begin-urile pe sesiune —
  -- race-safety-ul claims-urilor stă pe acest lock).
  select id, restaurant_id, table_id, status
    into v_sess
    from public.table_sessions
   where id = p_session_id
     for update;
  if not found or v_sess.status <> 'open' then
    raise exception 'Sesiunea de masă nu este deschisă.'
      using errcode = 'P0001', hint = 'invalid_session';
  end if;

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

  -- Gate dublu de plan (regula de aur) + modul + cont + monedă (mig 209).
  perform public.enforce_feature_for_restaurant(v_sess.restaurant_id, 'online_payments');
  perform public.enforce_feature_for_restaurant(v_sess.restaurant_id, 'split_bill');
  if not public.is_module_enabled(v_sess.restaurant_id, 'online_payments') then
    raise exception 'Plata online nu este activată de restaurant.'
      using errcode = 'P0001', hint = 'module_disabled';
  end if;
  select stripe_account_id, upper(coalesce(currency, 'RON'))
    into v_account, v_currency
    from public.restaurants where id = v_sess.restaurant_id;
  if v_account is null then
    raise exception 'Restaurantul nu are contul de plăți conectat.'
      using errcode = 'P0001', hint = 'not_connected';
  end if;
  if v_currency <> 'RON' then
    raise exception 'Plata online e disponibilă doar pentru meniuri în lei (RON).'
      using errcode = 'P0001', hint = 'currency_not_supported';
  end if;

  -- TTL: selecții abandonate (sheet închis fără attach) — 15 min, DOAR
  -- rândurile 'created' fără intent (nimic la Stripe de anulat).
  update public.table_payments
     set status = 'canceled',
         settle_note = 'Selecție abandonată (expirată).',
         updated_at = now()
   where session_id = p_session_id
     and kind = 'split'
     and status = 'created'
     and stripe_payment_intent_id is null
     and created_at < now() - interval '15 minutes';

  -- Staging: claims-urile validate + sumele brute.
  drop table if exists pg_temp._split_claims;
  create temp table _split_claims (
    order_item_id uuid primary key,
    qty           integer not null,
    order_id      uuid not null,
    name          text not null,
    item_qty      integer not null,
    item_total    numeric not null,
    order_total   numeric not null,
    raw_amount    numeric not null default 0,
    final_amount  numeric not null default 0
  ) on commit drop;

  for v_claim in select * from jsonb_array_elements(p_claims) loop
    if jsonb_typeof(v_claim) <> 'object'
       or not (v_claim ? 'order_item_id') or not (v_claim ? 'quantity') then
      raise exception 'Selecție invalidă.'
        using errcode = 'P0001', hint = 'invalid_items';
    end if;
    begin
      v_item_id := (v_claim->>'order_item_id')::uuid;
      v_qty     := (v_claim->>'quantity')::integer;
    exception when others then
      raise exception 'Selecție invalidă.'
        using errcode = 'P0001', hint = 'invalid_items';
    end;
    if v_qty is null or v_qty < 1 or v_qty > 99 then
      raise exception 'Selecție invalidă.'
        using errcode = 'P0001', hint = 'invalid_items';
    end if;

    -- Itemul trebuie să fie al unei comenzi DESCHISE din ACEASTĂ sesiune,
    -- fără plăți parțiale de staff (acelea se încheie la ospătar — F1).
    select oi.id, oi.order_id, oi.quantity as item_qty, oi.item_total,
           oi.product_name_snapshot, o.total as order_total
      into v_row
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
     where oi.id = v_item_id
       and o.session_id = p_session_id
       and o.status not in ('paid', 'cancelled', 'closed')
       and not exists (
         select 1 from public.order_payments op
          where op.order_id = o.id and op.method <> 'card_online'
       );
    if not found then
      raise exception 'Selecție invalidă.'
        using errcode = 'P0001', hint = 'invalid_items';
    end if;

    -- Duplicat în request → pk violation ar fi criptică; refuz explicit.
    if exists (select 1 from pg_temp._split_claims where order_item_id = v_item_id) then
      raise exception 'Selecție invalidă.'
        using errcode = 'P0001', hint = 'invalid_items';
    end if;

    -- Cantitatea rămasă = item.quantity − claims vii (created/processing/
    -- failed/succeeded; 'failed' e retryable, mig 207 — nu se eliberează).
    if v_qty > v_row.item_qty - coalesce((
      select sum(tpi.quantity)::int
        from public.table_payment_items tpi
        join public.table_payments tp on tp.id = tpi.payment_id
       where tpi.order_item_id = v_item_id
         and tp.status in ('created', 'processing', 'failed', 'succeeded')
    ), 0) then
      raise exception 'Produse deja revendicate de altă plată.'
        using errcode = 'P0001', hint = 'items_already_claimed';
    end if;

    insert into pg_temp._split_claims
      (order_item_id, qty, order_id, name, item_qty, item_total, order_total)
    values
      (v_item_id, v_qty, v_row.order_id, v_row.product_name_snapshot,
       v_row.item_qty, v_row.item_total, v_row.order_total);
  end loop;

  -- Sume: proporțional cu discount-ul comenzii (factor = total/subtotal).
  update pg_temp._split_claims c
     set raw_amount = coalesce(round(
           c.item_total * c.qty / c.item_qty
           * c.order_total / nullif(s.order_subtotal, 0), 2), 0),
         final_amount = coalesce(round(
           c.item_total * c.qty / c.item_qty
           * c.order_total / nullif(s.order_subtotal, 0), 2), 0)
    from (
      select oi.order_id, sum(oi.item_total) as order_subtotal
        from public.order_items oi
       where oi.order_id in (select distinct order_id from pg_temp._split_claims)
       group by oi.order_id
    ) s
   where s.order_id = c.order_id;

  -- Absorbția restului de rotunjire: dacă acest request COMPLETEAZĂ toate
  -- cantitățile unei comenzi, ultimul claim al comenzii primește exact
  -- diferența până la orders.total (suma claims == total, fără rest).
  for v_ord in select distinct order_id from pg_temp._split_claims loop
    if not exists (
      select 1 from public.order_items oi
       where oi.order_id = v_ord.order_id
         and oi.quantity > coalesce((
           select sum(tpi.quantity)::int
             from public.table_payment_items tpi
             join public.table_payments tp on tp.id = tpi.payment_id
            where tpi.order_item_id = oi.id
              and tp.status in ('created', 'processing', 'failed', 'succeeded')
         ), 0) + coalesce((
           select c.qty from pg_temp._split_claims c where c.order_item_id = oi.id
         ), 0)
    ) then
      update pg_temp._split_claims c
         set final_amount = greatest(0,
               (select order_total from pg_temp._split_claims
                 where order_id = v_ord.order_id limit 1)
               - coalesce((
                   select sum(tpi.amount)
                     from public.table_payment_items tpi
                     join public.table_payments tp on tp.id = tpi.payment_id
                    where tpi.order_id = v_ord.order_id
                      and tp.status in ('created', 'processing', 'failed', 'succeeded')
                 ), 0)
               - coalesce((
                   select sum(c2.raw_amount) from pg_temp._split_claims c2
                    where c2.order_id = v_ord.order_id
                      and c2.order_item_id <> c.order_item_id
                 ), 0))
       where c.order_item_id = (
         select c3.order_item_id from pg_temp._split_claims c3
          where c3.order_id = v_ord.order_id
          order by c3.order_item_id desc limit 1
       );
    end if;
  end loop;

  select coalesce(sum(final_amount), 0),
         coalesce(array_agg(distinct order_id), '{}')
    into v_amount, v_order_ids
    from pg_temp._split_claims;
  if v_amount <= 0 then
    raise exception 'Nu există nimic de plătit în selecție.'
      using errcode = 'P0001', hint = 'nothing_to_pay';
  end if;

  select coalesce((value->>'bps')::integer, 0)
    into v_fee_bps
    from public.platform_settings
   where key = 'online_payment_fee_bps';
  v_fee := round(v_amount * coalesce(v_fee_bps, 0) / 10000.0, 2);

  -- Supersede DOAR pe kind='table' (o plată pe TOATĂ nota acoperă și itemii
  -- selectați aici). Rândurile split ale ALTOR telefoane rămân neatinse —
  -- anularea lor oarbă ar deschide fereastră de dublă încasare.
  update public.table_payments
     set status = 'canceled',
         settle_note = 'Înlocuit de un split pe itemi (fără intent atașat).',
         updated_at = now()
   where session_id = p_session_id
     and kind = 'table'
     and status = 'created'
     and stripe_payment_intent_id is null;

  -- Spre anulare la Stripe (bucla provably-dead din funcția Netlify):
  --   • TOATE intent-urile full-table confirmabile (o plată pe toată nota
  --     acoperă și itemii de aici) — BF-1 (mig 292): și cele 'failed' cu
  --     intent, care rămân confirmabile (alt card, mig 207);
  --   • intent-urile SPLIT stale (>15 min, neconfirmate) — un telefon mort
  --     mid-flow și-ar ține altfel claims-urile pe toată sesiunea (TTL-ul de
  --     mai sus acoperă doar rândurile FĂRĂ intent). Split-urile RECENTE ale
  --     altora rămân neatinse (pot fi mid-confirm — fereastră de dublă
  --     încasare). Dacă un intent stale nu poate fi dovedit mort la Stripe,
  --     funcția Netlify refuză plata nouă — fail-closed, ca la mig 211/F3.
  select coalesce(jsonb_agg(stripe_payment_intent_id), '[]'::jsonb)
    into v_superseded
    from public.table_payments
   where session_id = p_session_id
     and stripe_payment_intent_id is not null
     and (
       (kind = 'table' and status in ('created', 'processing', 'failed'))
       or (kind = 'split' and status in ('created', 'processing')
           and created_at < now() - interval '15 minutes')
     );

  insert into public.table_payments
    (restaurant_id, session_id, order_ids, amount, currency, application_fee, kind)
  values
    (v_sess.restaurant_id, p_session_id, v_order_ids, v_amount, v_currency, v_fee, 'split')
  returning id into v_payment_id;

  insert into public.table_payment_items
    (payment_id, order_id, order_item_id, product_name_snapshot, quantity, amount)
  select v_payment_id, order_id, order_item_id, name, qty, final_amount
    from pg_temp._split_claims;

  return jsonb_build_object(
    'payment_id',         v_payment_id,
    'amount',             v_amount,
    'currency',           v_currency,
    'application_fee',    v_fee,
    'order_ids',          to_jsonb(v_order_ids),
    'stripe_account_id',  v_account,
    'superseded_intents', v_superseded
  );
end;
$$;

revoke all on function public.begin_split_payment(uuid, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.begin_split_payment(uuid, text, jsonb) to service_role;

comment on function public.begin_split_payment(uuid, text, jsonb) is
  $$Split pe itemi (mig 229 → 292): claims validate sub lock-ul sesiunii, sumă
EXCLUSIV server-side (proporțional cu discount-ul + absorbția restului pe
claim-ul care completează comanda), conflict = items_already_claimed; supersede
și pe intent-urile full-table 'failed' (BF-1). service_role-only.$$;

-- ═════════════════════════════════════════════════════════════════════
-- Asserții fail-closed
-- ═════════════════════════════════════════════════════════════════════
do $$
declare v_tgtype smallint; v_src text;
begin
  -- BF-4: trigger BEFORE UPDATE OR DELETE ROW
  -- (tgtype 27 = ROW 1 + BEFORE 2 + DELETE 8 + UPDATE 16),
  -- NU `update of` (nu are cum să ghicească ce coloană atinge un PATCH).
  select tgtype into v_tgtype from pg_trigger
   where tgname = 'trg_orders_paid_immutable'
     and tgrelid = 'public.orders'::regclass and not tgisinternal;
  if v_tgtype is distinct from 27 then
    raise exception 'mig 292: trg_orders_paid_immutable trebuie sa fie BEFORE UPDATE OR DELETE FOR EACH ROW (tgtype=27), gasit %', v_tgtype;
  end if;
  if exists (select 1 from pg_trigger t where t.tgname = 'trg_orders_paid_immutable'
              and t.tgattr::text <> '') then
    raise exception 'mig 292: trg_orders_paid_immutable nu are voie sa aiba lista UPDATE OF';
  end if;
  -- NE-definer: trebuie sa vada rolul apelantului.
  if (select prosecdef from pg_proc where oid = 'public.fn_orders_paid_immutable()'::regprocedure) then
    raise exception 'mig 292: fn_orders_paid_immutable trebuie sa fie NE-definer';
  end if;
  if has_function_privilege('anon', 'public.fn_orders_paid_immutable()', 'execute')
     or has_function_privilege('authenticated', 'public.fn_orders_paid_immutable()', 'execute') then
    raise exception 'mig 292: fn_orders_paid_immutable nu are voie sa fie executabila de roluri client (RP13)';
  end if;

  -- BF-1: supersede-ul include 'failed', in AMBELE functii.
  select pg_get_functiondef('public.begin_table_payment(uuid, text)'::regprocedure) into v_src;
  if position($s$status in ('created', 'processing', 'failed')$s$ in v_src) = 0 then
    raise exception 'mig 292: begin_table_payment fara failed in supersede';
  end if;
  select pg_get_functiondef('public.begin_split_payment(uuid, text, jsonb)'::regprocedure) into v_src;
  if position($s$(kind = 'table' and status in ('created', 'processing', 'failed'))$s$ in v_src) = 0 then
    raise exception 'mig 292: begin_split_payment fara failed pe kind=table in supersede';
  end if;

  -- Invariantele mostenite (211 / 209 / 229) + ACL service_role-only.
  select pg_get_functiondef('public.begin_table_payment(uuid, text)'::regprocedure) into v_src;
  if position('currency_not_supported' in v_src) = 0
     or position('order_totals' in v_src) = 0
     or position('online_payments' in v_src) = 0
     or position('stripe_account_id' in v_src) = 0
     or position('order_payments' in v_src) = 0 then
    raise exception 'mig 292: begin_table_payment a pierdut un invariant (209/211)';
  end if;
  select pg_get_functiondef('public.begin_split_payment(uuid, text, jsonb)'::regprocedure) into v_src;
  if position('currency_not_supported' in v_src) = 0
     or position('split_bill' in v_src) = 0
     or position('items_already_claimed' in v_src) = 0
     or position('interval ''15 minutes''' in v_src) = 0 then
    raise exception 'mig 292: begin_split_payment a pierdut un invariant (229)';
  end if;
  if has_function_privilege('anon', 'public.begin_table_payment(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.begin_table_payment(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.begin_split_payment(uuid, text, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.begin_split_payment(uuid, text, jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.begin_table_payment(uuid, text)', 'execute')
     or not has_function_privilege('service_role', 'public.begin_split_payment(uuid, text, jsonb)', 'execute') then
    raise exception 'mig 292: begin_table_payment/begin_split_payment trebuie sa ramana service_role-only';
  end if;
end $$;

commit;
