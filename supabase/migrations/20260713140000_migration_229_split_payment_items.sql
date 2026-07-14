-- ═══════════════════════════════════════════════════════════════════
-- Migration 229: split pe itemi peste plata online la masă
-- ─────────────────────────────────────────────────────────────────────
-- Fiecare client de la masă își plătește DOAR produsele lui, cu cardul,
-- din meniul QR. Design (v1):
--   • `table_payment_items` = claims per intent (snapshot nume/sumă, FĂRĂ FK
--     pe order_items — deliberat: editările de staff prin update_order_items
--     (lanț 079→192) șterg/recreează itemi; banii intră oricum în
--     order_payments din snapshot, iar supra-încasarea devine vizibilă la
--     reconciliere, ca F2/mig 211. NU „repara" cu ON DELETE CASCADE — ar
--     evapora tăcut claims-uri cu bani).
--   • RPC-uri noi service_role-only: `get_table_bill` (nota cu cantități
--     rămase) + `begin_split_payment` (claims → sumă server-side). Nume NOU,
--     NU overload pe begin_table_payment (capcana PostgREST).
--   • O SINGURĂ redefinire pe lanțul existent: settle_table_payment
--     (203→207→211→229) primește ramura kind='split' care inserează plățile
--     în order_payments (metodă nouă 'card_online') și marchează comanda
--     'paid' abia când suma plăților ≥ total → UN bon fiscal per comandă la
--     final, prin triggerul fiscal existent (mig 030). Ramura kind='table'
--     rămâne BYTE-IDENTICĂ cu mig 211 (F1/F2 intacte).
--   • begin_table_payment NU se redefinește: supersede-ul F3 (mig 211)
--     acoperă automat și intent-urile split (aceeași tabelă/sesiune).
--   • Discount-ul se împarte proporțional (factor = total/subtotal), cu
--     absorbția restului de rotunjire pe claim-ul care COMPLETEAZĂ comanda —
--     suma claims-urilor pe o comandă dă EXACT orders.total.
--   • Conflict între telefoane = refuz curat `items_already_claimed`
--     (claims ținute de plăți created/processing/failed/succeeded — 'failed'
--     e retryable, mig 207); eliberare prin cancel_table_payment + TTL 15 min
--     DOAR pe rândurile 'created' fără intent.
--   • Bon fiscal per PLĂTITOR = v2 (cere payload FiscalNet din subset +
--     idempotență pending_receipts per plată — lanțul 050→053 nu se atinge azi).
-- Regula de aur: gate dublu în RPC — online_payments ȘI split_bill (ambele
-- pro/enterprise) + modul opt-in + stripe_account_id + RON-only (mig 209).
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout      = '5s';
set local statement_timeout = '60s';

-- ── 1. table_payments.kind: 'table' (toată nota) vs 'split' (claims) ──
alter table public.table_payments
  add column if not exists kind text not null default 'table';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'table_payments_kind_check'
  ) then
    alter table public.table_payments
      add constraint table_payments_kind_check check (kind in ('table', 'split'));
  end if;
end $$;

-- ── 2. table_payment_items — claims per plată ────────────────────────
create table if not exists public.table_payment_items (
  id                    uuid primary key default gen_random_uuid(),
  payment_id            uuid not null references public.table_payments(id) on delete cascade,
  order_id              uuid not null references public.orders(id) on delete cascade,
  -- FĂRĂ FK pe order_items — vezi antetul (snapshot-ul de mai jos e sursa).
  order_item_id         uuid not null,
  product_name_snapshot text not null,
  quantity              smallint not null check (quantity > 0),
  amount                numeric(12,2) not null check (amount >= 0),
  created_at            timestamptz not null default now()
);

create index if not exists idx_tpi_payment on public.table_payment_items(payment_id);
create index if not exists idx_tpi_order on public.table_payment_items(order_id);
create index if not exists idx_tpi_order_item on public.table_payment_items(order_item_id);

alter table public.table_payment_items enable row level security;

drop policy if exists tpi_admin_read on public.table_payment_items;
create policy tpi_admin_read on public.table_payment_items
  for select to authenticated
  using (exists (
    select 1 from public.table_payments tp
    where tp.id = payment_id and public.is_admin(tp.restaurant_id)
  ));

revoke all on public.table_payment_items from public, anon, authenticated;
grant select on public.table_payment_items to authenticated;

-- ── 3. order_payments.method += 'card_online' ────────────────────────
-- CHECK-ul din mig 017 e inline (nume auto-generat, poate diferi între medii)
-- → drop dinamic + recreare cu nume explicit. add_partial_payment NU se
-- modifică: staff-ul NU are voie să înregistreze 'card_online' manual —
-- validarea lui in ('cash','card_pos','other') rămâne gate-ul.
do $$
declare v_con text;
begin
  select con.conname into v_con
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'order_payments'
    and con.contype = 'c'
    and exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid
        and a.attname = 'method'
        and a.attnum = any (con.conkey)
    );
  if v_con is null then
    raise exception 'mig 229: nu găsesc CHECK-ul pe order_payments.method';
  end if;
  execute format('alter table public.order_payments drop constraint %I', v_con);
end $$;

alter table public.order_payments
  add constraint order_payments_method_check
  check (method in ('cash', 'card_pos', 'other', 'card_online'));

-- ── 4. get_table_bill — nota cu cantitățile rămase (read-only) ───────
create or replace function public.get_table_bill(
  p_session_id uuid,
  p_token      text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sess     record;
  v_tok      record;
  v_currency text;
  v_account  text;
  v_orders   jsonb;
  v_stale    jsonb;
begin
  select id, restaurant_id, table_id, status
    into v_sess
    from public.table_sessions
   where id = p_session_id;
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

  perform public.enforce_feature_for_restaurant(v_sess.restaurant_id, 'online_payments');
  perform public.enforce_feature_for_restaurant(v_sess.restaurant_id, 'split_bill');
  if not public.is_module_enabled(v_sess.restaurant_id, 'online_payments') then
    raise exception 'Plata online nu este activată de restaurant.'
      using errcode = 'P0001', hint = 'module_disabled';
  end if;

  select upper(coalesce(currency, 'RON')), stripe_account_id
    into v_currency, v_account
    from public.restaurants where id = v_sess.restaurant_id;

  -- Intent-uri SPLIT stale (>15 min, neconfirmate): claims-urile unui telefon
  -- mort mid-flow. Funcția Netlify (action 'bill') le anulează la Stripe cu
  -- disciplina provably-dead ÎNAINTE să arate nota — altfel itemii rămân
  -- „revendicați" pe toată sesiunea. NU se eliberează aici, în SQL (intent-ul
  -- ar rămâne confirmabil → dublă încasare).
  select coalesce(jsonb_agg(stripe_payment_intent_id), '[]'::jsonb)
    into v_stale
    from public.table_payments
   where session_id = p_session_id
     and kind = 'split'
     and status in ('created', 'processing')
     and stripe_payment_intent_id is not null
     and created_at < now() - interval '15 minutes';

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',              o.id,
           'short_id',        upper(right(o.id::text, 6)),
           'total',           o.total,
           'subtotal',        s.subtotal,
           'discount_amount', coalesce(o.discount_amount, 0),
           -- locked = plăți parțiale de staff (cash/card_pos/other): comanda
           -- se încheie pe fluxul de staff, nu prin split (F1, mig 211).
           'locked', exists (
             select 1 from public.order_payments op
              where op.order_id = o.id and op.method <> 'card_online'
           ),
           'items', s.items
         ) order by o.created_at), '[]'::jsonb)
    into v_orders
    from public.orders o
    join lateral (
      select coalesce(sum(oi.item_total), 0) as subtotal,
             coalesce(jsonb_agg(jsonb_build_object(
               'id',            oi.id,
               'name',          oi.product_name_snapshot,
               'quantity',      oi.quantity,
               'item_total',    oi.item_total,
               'claimed_qty',   c.claimed,
               'remaining_qty', oi.quantity - c.claimed
             ) order by oi.id), '[]'::jsonb) as items
        from public.order_items oi
        join lateral (
          select coalesce(sum(tpi.quantity), 0)::int as claimed
            from public.table_payment_items tpi
            join public.table_payments tp on tp.id = tpi.payment_id
           where tpi.order_item_id = oi.id
             and tp.status in ('created', 'processing', 'failed', 'succeeded')
        ) c on true
       where oi.order_id = o.id
    ) s on true
   where o.session_id = p_session_id
     and o.status not in ('paid', 'cancelled', 'closed');

  return jsonb_build_object(
    'currency', v_currency,
    'orders', v_orders,
    'stale_split_intents', v_stale,
    'stripe_account_id', v_account
  );
end;
$$;

revoke all on function public.get_table_bill(uuid, text) from public, anon, authenticated;
grant execute on function public.get_table_bill(uuid, text) to service_role;

comment on function public.get_table_bill(uuid, text) is
  $$Nota mesei pentru split pe itemi (mig 229): comenzile deschise ale sesiunii
cu cantitățile deja revendicate de alte plăți live. service_role-only (apelat
prin funcția Netlify table-payment, action 'bill').$$;

-- ── 5. begin_split_payment — claims → sumă server-side ───────────────
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
  --   • TOATE intent-urile full-table vii (o plată pe toată nota acoperă și
  --     itemii de aici);
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
     and status in ('created', 'processing')
     and stripe_payment_intent_id is not null
     and (
       kind = 'table'
       or (kind = 'split' and created_at < now() - interval '15 minutes')
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

revoke all on function public.begin_split_payment(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.begin_split_payment(uuid, text, jsonb) to service_role;

comment on function public.begin_split_payment(uuid, text, jsonb) is
  $$Split pe itemi (mig 229): claims validate sub lock-ul sesiunii, sumă
EXCLUSIV server-side (proporțional cu discount-ul + absorbția restului pe
claim-ul care completează comanda), conflict = items_already_claimed.
service_role-only.$$;

-- ── 6. settle_table_payment — lanț 203→207→211→229 ───────────────────
-- Corpul mig 211 VERBATIM + branch-ul kind='split' în ramura succeeded.
-- Ramura kind='table' (F1/F2, idempotență, failed retryable) NEATINSĂ.
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
  v_pay        record;
  v_oid        uuid;
  v_paid       integer := 0;
  v_skipped    integer := 0;
  v_partial    integer := 0;
  v_changed    integer := 0;
  v_ord        record;
  v_order      record;
  v_total_paid numeric;
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

  -- Idempotență: DOAR succeeded/canceled sunt terminale. 'failed' = "ultima
  -- încercare a eșuat" — PaymentIntent-ul e încă confirmabil (retry de card),
  -- deci un succeeded ulterior TREBUIE să treacă (mig 207).
  if v_pay.status in ('succeeded', 'canceled') then
    return jsonb_build_object('already_settled', true, 'status', v_pay.status);
  end if;
  if p_outcome = 'failed' and v_pay.status = 'failed' then
    -- Încercări eșuate repetate: doar împrospătăm eroarea, fără alt efect.
    update public.table_payments
       set error_info = coalesce(p_error_info, error_info), updated_at = now()
     where id = v_pay.id;
    return jsonb_build_object('already_settled', true, 'status', 'failed');
  end if;

  if p_outcome <> 'succeeded' then
    update public.table_payments
       set status = p_outcome, error_info = p_error_info, updated_at = now()
     where id = v_pay.id;
    return jsonb_build_object('status', p_outcome);
  end if;

  -- ── Ramura SPLIT (mig 229): banii intră în order_payments; comanda devine
  -- 'paid' abia când suma plăților ≥ total → UN bon fiscal, la final, prin
  -- triggerul existent (mig 030). Gate-ul de plan a trecut la begin (pro+).
  if v_pay.kind = 'split' then
    for v_ord in
      select tpi.order_id, sum(tpi.amount) as amt
        from public.table_payment_items tpi
       where tpi.payment_id = v_pay.id
       group by tpi.order_id
    loop
      -- Grup cu sumă zero (claims doar pe produse gratuite / absorbție după
      -- edit de staff): order_payments cere amount > 0 (mig 017) — un insert
      -- de 0 ar avorta TOT settle-ul (inclusiv comenzile plătite valid) și ar
      -- bloca webhook-ul Stripe în retry infinit. Comanda rămâne deschisă
      -- (se închide la ospătar — 0 lei de încasat).
      continue when v_ord.amt <= 0;

      select * into v_order
        from public.orders
       where id = v_ord.order_id
         for update;
      -- Comanda încheiată între begin și confirmare (staff a închis-o):
      -- banii AU venit — nu-i ascundem, notăm pentru verificare de refund.
      if v_order.status in ('paid', 'cancelled', 'closed') then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      -- Echivalentul F1 (mig 211) pentru split: begin a garantat că NU existau
      -- plăți de staff pe comandă, deci orice rând ne-card_online prezent acum
      -- a apărut în fereastra begin→confirmare (3DS poate dura minute). Banii
      -- online se înregistrează ORICUM (au fost încasați), dar suprapunerea se
      -- notează — reconciliere vizibilă, nu tăcere.
      if exists (
        select 1 from public.order_payments op
         where op.order_id = v_ord.order_id and op.method <> 'card_online'
      ) then
        v_changed := v_changed + 1;
      end if;
      insert into public.order_payments (order_id, amount, method, paid_by)
      values (v_ord.order_id, v_ord.amt, 'card_online', null);

      select coalesce(sum(amount), 0) into v_total_paid
        from public.order_payments
       where order_id = v_ord.order_id;
      if v_total_paid >= v_order.total then
        update public.orders
           set status         = 'paid',
               -- payment_method e ENUM: mix cash+online → 'other' (cod
               -- FiscalNet 8), integral online → 'card_online' (cod 7).
               payment_method = (case
                 when not exists (
                   select 1 from public.order_payments op
                    where op.order_id = v_ord.order_id
                      and op.method <> 'card_online'
                 ) then 'card_online'
                 else 'other'
               end)::public.payment_method,
               paid_amount    = v_total_paid,
               paid_at        = now()
         where id = v_ord.order_id;
        v_paid := v_paid + 1;
      else
        v_partial := v_partial + 1;
      end if;
    end loop;

    update public.table_payments
       set status = 'succeeded',
           error_info = null,
           settle_note = nullif(btrim(concat_ws(' ',
             case when v_skipped > 0 then format(
               '%s comenzi încheiate între timp — banii au fost încasați online, verifică refund.',
               v_skipped) end,
             case when v_partial > 0 then format(
               '%s comenzi plătite parțial prin split — restul se achită la masă.',
               v_partial) end,
             case when v_changed > 0 then format(
               '%s comenzi cu plăți de staff apărute între inițierea split-ului și confirmare — suma online se poate suprapune, verifică refund.',
               v_changed) end
           )), '')
     where id = v_pay.id;

    return jsonb_build_object(
      'status', 'succeeded',
      'kind', 'split',
      'orders_paid', v_paid,
      'orders_partial', v_partial,
      'orders_skipped', v_skipped,
      'orders_staff_race', v_changed
    );
  end if;

  -- F2 (vizibilitate): comenzile al căror total s-a schimbat față de
  -- snapshot-ul de la begin. Se marchează totuși plătite (banii AU fost
  -- încasați — clientul nu se taxează a doua oară), dar diferența se
  -- raportează în settle_note pentru reconciliere manuală.
  if v_pay.order_totals is not null then
    select count(*)::integer into v_changed
      from public.orders o
     where o.id = any(v_pay.order_ids)
       and o.status not in ('paid', 'cancelled', 'closed')
       and (v_pay.order_totals ? o.id::text)
       and o.total is distinct from (v_pay.order_totals->>o.id::text)::numeric;
  end if;

  -- Succes (inclusiv după una sau mai multe încercări eșuate): comenzile din
  -- snapshot devin 'paid' cu card_online — triggerul enqueue_fiscal_receipt
  -- (mig 030) preia bonul de aici.
  foreach v_oid in array v_pay.order_ids loop
    -- F1: plată parțială cash luată între begin și confirmare — comanda se
    -- încheie pe fluxul de staff (altfel am marca integral card_online peste
    -- banii deja luați cash). Notat mai jos; refund-ul e decizie umană.
    if exists (select 1 from public.order_payments op where op.order_id = v_oid)
       and exists (
         select 1 from public.orders o
          where o.id = v_oid
            and o.status not in ('paid', 'cancelled', 'closed')
       ) then
      v_partial := v_partial + 1;
      continue;
    end if;
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
         error_info = null,
         settle_note = nullif(btrim(concat_ws(' ',
           case when v_skipped > 0 then format(
             '%s comenzi sărite (plătite/anulate între timp) — verifică dacă e nevoie de refund parțial.',
             v_skipped) end,
           case when v_partial > 0 then format(
             '%s comenzi cu plăți parțiale (cash) sărite — se încheie la ospătar; suma încasată online le include, verifică refund.',
             v_partial) end,
           case when v_changed > 0 then format(
             '%s comenzi modificate după inițierea plății — suma încasată online e snapshot-ul de la begin, nu totalul curent; reconciliere manuală.',
             v_changed) end
         )), '')
   where id = v_pay.id;

  return jsonb_build_object(
    'status', 'succeeded',
    'orders_paid', v_paid,
    'orders_skipped', v_skipped,
    'orders_partial', v_partial,
    'orders_changed', v_changed
  );
end;
$$;

revoke all on function public.settle_table_payment(text, text, text) from public, anon, authenticated;
grant execute on function public.settle_table_payment(text, text, text) to service_role;

comment on function public.settle_table_payment(text, text, text) is
  $$Idempotent pe intent id; terminale = succeeded/canceled (mig 207). mig 211:
sare comenzile cu plăți parțiale (staff flow) și notează totalurile modificate
față de snapshot. mig 229: ramura kind='split' inserează plățile în
order_payments (card_online) și marchează 'paid' abia la acoperirea totalului.
succeeded → bonul pleacă din triggerul fiscal.$$;

-- ── Asserții fail-closed ─────────────────────────────────────────────
do $$
declare
  v_settle text;
  v_begin  text;
  v_split  text;
  v_app    text;
begin
  -- 1) order_payments acceptă card_online.
  if position('card_online' in pg_get_constraintdef(
       (select oid from pg_constraint where conname = 'order_payments_method_check'))) = 0 then
    raise exception 'ASSERT FAIL: order_payments nu acceptă card_online (mig 229)';
  end if;

  -- 2) settle: branch-ul split prezent, F1/F2 + terminalele NEREGRESATE.
  v_settle := pg_get_functiondef('public.settle_table_payment(text, text, text)'::regprocedure);
  if position('split' in v_settle) = 0
     or position('card_online' in v_settle) = 0
     or position('order_payments' in v_settle) = 0
     or position('order_totals' in v_settle) = 0
     or position($m$in ('succeeded', 'canceled')$m$ in v_settle) = 0 then
    raise exception 'ASSERT FAIL: settle_table_payment fără branch split sau cu F1/F2/terminale regresate (mig 229)';
  end if;

  -- 3) begin_split_payment: gate dublu + monedă + conflict.
  v_split := pg_get_functiondef('public.begin_split_payment(uuid, text, jsonb)'::regprocedure);
  if position('split_bill' in v_split) = 0
     or position('online_payments' in v_split) = 0
     or position('currency_not_supported' in v_split) = 0
     or position('items_already_claimed' in v_split) = 0 then
    raise exception 'ASSERT FAIL: begin_split_payment fără gate-uri complete (mig 229)';
  end if;

  -- 4) begin_table_payment NEATINS (supersede + snapshot încă acolo).
  v_begin := pg_get_functiondef('public.begin_table_payment(uuid, text)'::regprocedure);
  if position('superseded_intents' in v_begin) = 0
     or position('order_totals' in v_begin) = 0 then
    raise exception 'ASSERT FAIL: begin_table_payment a fost modificat (mig 229 nu are voie)';
  end if;

  -- 5) add_partial_payment NU acceptă card_online (staff-ul nu înregistrează
  -- plăți online manual).
  v_app := pg_get_functiondef('public.add_partial_payment(uuid, numeric, text)'::regprocedure);
  if position($m$('cash', 'card_pos', 'other')$m$ in v_app) = 0 then
    raise exception 'ASSERT FAIL: add_partial_payment pare modificat — validarea metodelor de staff lipsește';
  end if;

  -- 6) Privilegii: RPC-urile noi = service_role-only.
  if has_function_privilege('anon', 'public.begin_split_payment(uuid, text, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.begin_split_payment(uuid, text, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.get_table_bill(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.get_table_bill(uuid, text)', 'execute') then
    raise exception 'ASSERT FAIL: begin_split_payment/get_table_bill trebuie să fie service_role-only';
  end if;
  if not has_function_privilege('service_role', 'public.begin_split_payment(uuid, text, jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.get_table_bill(uuid, text)', 'execute') then
    raise exception 'ASSERT FAIL: service_role nu poate executa RPC-urile split';
  end if;

  -- 7) table_payment_items: RLS on, anon zero, authenticated doar SELECT.
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'table_payment_items' and c.relrowsecurity
  ) then
    raise exception 'ASSERT FAIL: table_payment_items fără RLS';
  end if;
  if has_table_privilege('anon', 'public.table_payment_items', 'select')
     or has_table_privilege('authenticated', 'public.table_payment_items', 'insert')
     or has_table_privilege('authenticated', 'public.table_payment_items', 'update')
     or has_table_privilege('authenticated', 'public.table_payment_items', 'delete') then
    raise exception 'ASSERT FAIL: privilegii prea largi pe table_payment_items';
  end if;

  -- 8) Regula de aur: split_bill activ DOAR pe pro/enterprise.
  if exists (select 1 from public.plan_features
             where feature = 'split_bill' and enabled and plan not in ('pro', 'enterprise')) then
    raise exception 'ASSERT FAIL: split_bill activ sub Plan 3';
  end if;
end $$;

commit;
