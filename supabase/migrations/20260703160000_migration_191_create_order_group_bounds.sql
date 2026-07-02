-- mig 191 — create_order: minim pe grup server-side (min_select / is_required)
-- ─────────────────────────────────────────────────────────────────────
-- Ultima definiție a lui create_order e mig 145 (20260628021000). Acolo, decizia
-- explicită (comentariul fix #9) a fost: „min_select/is_required rămân validate pe
-- UI (nu blochează server-side)". Auditul round-4 (product-sheet / ModifierSheet) a
-- arătat că asta lasă serverul fără NICIO barieră pe minim: un client care ocolește
-- UI-ul poate trimite comenzi cu grupuri obligatorii goale sau sub `min_select`,
-- afectând prețul și producția în bucătărie. UI-ul nu e o barieră (regula din
-- CLAUDE.md: gate-urile se pun în RPC/RLS, nu doar în UI).
--
-- Această migrație RECREEAZĂ create_order — copie VERBATIM a corpului din mig 145 —
-- cu UN singur delta: după validarea existentă a opțiunilor (fix #1 dedup + fix #9
-- plafon max/single), pentru FIECARE grup de modificatori al produsului comandat:
--   • dacă `is_required` sau `min_select > 0` → numărul de opțiuni selectate ȘI
--     disponibile din grup trebuie să fie >= greatest(min_select, 1 dacă is_required),
--     plafonat la 1 pe selection_type='single' (fix #9 impune oricum ≤1 acolo;
--     paritate cu clientul — modifierGroupMin din src/lib/qr.ts);
--   • plafonul superior (max_select) e DEJA gate-uit de fix #9 (mig 145) — neatins.
-- La încălcare: exception RO + hint mașină-citibil 'missing_required_group'
-- (pattern-ul de erori existent al funcției).
--
-- De ce nu ajunge validarea existentă: join-ul pe option_ids vede DOAR grupurile
-- din care s-a selectat ceva — un grup obligatoriu complet gol nu apare deloc în
-- join, deci nu putea fi prins acolo. Verificăm pornind de la product_modifier_groups.
--
-- Pereche sincronizată? create_order NU are un „geamăn" pe modelul advance_order
-- (mig 085/087) — singura definiție vie e cea de aici (mig 145 → 191). Ruda de pe
-- calea de EDITARE e update_order_items (ultima def. mig 184), care are plafonul
-- max (paritate fix #9) dar NU minimul — gap cunoscut, documentat, în afara acestei
-- migrații (editarea unei comenzi deja validate e o suprafață separată).
--
-- Semnătura, security definer, search_path și grants (anon+authenticated) rămân
-- IDENTICE cu mig 145; asserțiile fail-closed de mai jos le verifică pe toate.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

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
  p_session_id      uuid      default null
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
  v_group_name      text;
  v_group_min       int;
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

    -- ── GUARD SESIUNE (Spec §4.3 — Plan 2 STRICT, mig 088) ───
    if p_session_id is null then
      raise exception 'Sesiunea mesei lipsește. Scanează din nou QR-ul ca să începi o comandă.'
        using errcode = 'P0001', hint = 'session_required';
    end if;

    select * into v_session
    from public.table_sessions
    where id = p_session_id
      and table_id = v_qr_token.table_id
      and status = 'open';

    if not found then
      raise exception 'Masa a fost închisă sau sesiunea a expirat. Scanează din nou QR-ul ca să începi o comandă nouă.'
        using errcode = 'P0001', hint = 'session_closed';
    end if;

    update public.table_sessions
      set last_activity_at = now()
    where id = p_session_id;

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

    if not public.is_valid_phone(p_customer_phone) then
      raise exception 'Pickup orders require valid customer_phone (7-15 digits)'
        using errcode = 'P0001', hint = 'invalid_customer_phone';
    end if;

    select pickup_settings into v_pickup_settings
    from public.restaurants
    where id = p_restaurant_id;

    v_pickup_enabled := coalesce((v_pickup_settings ->> 'enabled')::boolean, false);
    if not v_pickup_enabled then
      raise exception 'Comenzile pickup sunt dezactivate pentru acest restaurant.'
        using errcode = 'P0001', hint = 'pickup_disabled';
    end if;

    if p_pickup_time is null then
      raise exception 'Pickup orders require pickup_time'
        using errcode = 'P0001', hint = 'missing_pickup_time';
    end if;

    v_min_lead_min := coalesce((v_pickup_settings ->> 'min_lead_time_minutes')::int, 20);

    if p_pickup_time < now() + make_interval(mins => v_min_lead_min) then
      raise exception 'Pickup time too soon. Minimum lead time: % minutes', v_min_lead_min
        using errcode = 'P0001', hint = 'pickup_time_too_soon';
    end if;

    if p_pickup_time > now() + interval '24 hours' then
      raise exception 'Pickup time too far in future (max 24h)'
        using errcode = 'P0001', hint = 'pickup_time_too_far';
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

  -- ─── INSERT ORDER ─────────────────────────────────────────────
  begin
    insert into public.orders (
      id,
      restaurant_id, table_id, qr_token_id, source, status,
      total, notes, idempotency_key,
      pickup_time, customer_name, customer_phone,
      created_by, session_id
    ) values (
      v_order_id,
      p_restaurant_id, v_effective_table_id,
      case when p_source = 'qr' then p_qr_token_id else null end,
      p_source::public.order_source, 'new',
      0, v_clean_notes, p_idempotency_key,
      p_pickup_time, p_customer_name, p_customer_phone,
      v_created_by,
      case when p_source = 'qr' then p_session_id else null end
    );
  exception
    when unique_violation then
      select id, total, status, created_at
        into v_existing_id, v_existing_total, v_existing_status, v_existing_created
        from public.orders
       where restaurant_id = p_restaurant_id
         and idempotency_key = p_idempotency_key
       limit 1;

      if v_existing_id is null then
        raise;
      end if;

      return jsonb_build_object(
        'id',         v_existing_id,
        'short_id',   upper(right(v_existing_id::text, 6)),
        'status',     v_existing_status,
        'total',      v_existing_total,
        'created_at', v_existing_created
      );
  end;

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

      -- ── FIX #1 (mig 145, anti-furt): respinge option_ids DUPLICATE pe inputul brut.
      -- Fără asta, o opțiune repetată face join valid de N ori la același rând →
      -- sum(price_delta) numărat de N ori; cu price_delta negativ → total scăzut artificial.
      -- Verificăm ÎNAINTE de join, pe valorile brute.
      if v_options_count_expected <> (
           select count(distinct t.v)
           from jsonb_array_elements_text(v_item->'option_ids') as t(v)
         ) then
        raise exception 'Opțiuni modificatoare duplicate pentru produsul "%"', v_product.name
          using errcode = 'P0001', hint = 'duplicate_options';
      end if;

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

      -- ── FIX #9 (mig 145, integritate selecție): plafon pe grup. count per modifier_group
      -- nu poate depăși max_select; selection_type='single' impune ≤1. NULL max_select =
      -- nelimitat (trebuie să TREACĂ).
      if exists (
        select 1
        from jsonb_array_elements_text(v_item->'option_ids') opt_id
        join public.modifier_options mo on mo.id = opt_id::uuid
        join public.modifier_groups mg  on mg.id = mo.modifier_group_id
        join public.product_modifier_groups pmg on pmg.modifier_group_id = mg.id
        where pmg.product_id = v_product.id
          and mo.is_available = true
          and mg.restaurant_id = p_restaurant_id
        group by mg.id, mg.selection_type, mg.max_select
        having count(*) > coalesce(
                 case when mg.selection_type = 'single' then 1 else mg.max_select end,
                 2147483647)
      ) then
        raise exception 'Prea multe opțiuni selectate într-un grup pentru produsul "%"', v_product.name
          using errcode = 'P0001', hint = 'too_many_in_group';
      end if;
    end if;

    -- ── FIX (mig 191): MINIM pe grup — server-side. Verificăm TOATE grupurile
    -- produsului (un grup fără nicio selecție nu apare în join-ul pe option_ids
    -- de mai sus, deci validarea existentă nu-l vede). Regula (paritate cu
    -- clientul — modifierGroupMin din src/lib/qr.ts):
    --   • minim efectiv = greatest(min_select, 1 dacă is_required), plafonat la 1
    --     pe selection_type='single' (fix #9 impune oricum ≤1 acolo);
    --   • se numără doar opțiunile selectate ȘI disponibile din grup;
    --   • duplicatele au fost deja respinse (fix #1), deci count(*) e corect;
    --   • max_select e deja gate-uit de fix #9 (mig 145) mai sus — neatins.
    select mg.name,
           least(
             greatest(mg.min_select, case when mg.is_required then 1 else 0 end),
             case when mg.selection_type = 'single' then 1 else 32767 end
           )::int
      into v_group_name, v_group_min
      from public.product_modifier_groups pmg
      join public.modifier_groups mg on mg.id = pmg.modifier_group_id
      left join lateral (
        select count(*) as cnt
          from jsonb_array_elements_text(coalesce(v_item->'option_ids', '[]'::jsonb)) opt_id
          join public.modifier_options mo on mo.id = opt_id::uuid
         where mo.modifier_group_id = mg.id
           and mo.is_available = true
      ) sel on true
     where pmg.product_id = v_product.id
       and mg.restaurant_id = p_restaurant_id
       and (mg.is_required or mg.min_select > 0)
       and sel.cnt < least(
             greatest(mg.min_select, case when mg.is_required then 1 else 0 end),
             case when mg.selection_type = 'single' then 1 else 32767 end
           )
     order by pmg.display_order, mg.name
     limit 1;

    if v_group_name is not null then
      raise exception 'Grupul "%" pentru produsul "%" cere cel puțin % %',
        v_group_name, v_product.name, v_group_min,
        case when v_group_min = 1 then 'opțiune selectată' else 'opțiuni selectate' end
        using errcode = 'P0001', hint = 'missing_required_group';
    end if;

    -- Extras validation
    v_extras_total := 0;
    v_extras_json  := '[]'::jsonb;
    if v_item ? 'extra_ids' and jsonb_array_length(v_item->'extra_ids') > 0 then
      -- dedup extra_ids pe input brut (anti dublă-numărare, paritate cu update_order_items
      -- și cu dedup-ul de option_ids de mai sus). Un extra repetat ar însuma prețul de N ori.
      if jsonb_array_length(v_item->'extra_ids') <> (
           select count(distinct t.v)
           from jsonb_array_elements_text(v_item->'extra_ids') as t(v)
         ) then
        raise exception 'Extra-uri duplicate pentru produsul "%"', v_product.name
          using errcode = 'P0001', hint = 'duplicate_extras';
      end if;

      -- ── FIX #3 (mig 145): tenancy via pe.product_id = v_product.id (produsul deja
      -- validat să aparțină restaurantului). product_extras NU are coloana restaurant_id
      -- → predicatul vechi rupea orice comandă cu extras.
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
      quantity, item_total, selected_modifiers, extras_added, notes
    ) values (
      v_order_id, v_product.id, v_product.name, v_unit_price,
      v_item_qty, v_item_total, v_options_json, v_extras_json, v_item_notes
    );
  end loop;

  update public.orders set total = v_total where id = v_order_id;

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

-- ── Asserții fail-closed ─────────────────────────────────────────────────────
do $$
declare
  v_oid       oid;
  v_src       text;
  v_args      text;
  v_overloads int;
  v_secdef    boolean;
begin
  select count(*) into v_overloads
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_order';
  if v_overloads <> 1 then
    raise exception 'mig 191: create_order trebuie să aibă EXACT 1 overload (găsite: %)', v_overloads;
  end if;

  select p.oid, pg_get_functiondef(p.oid), pg_get_function_identity_arguments(p.oid), p.prosecdef
    into v_oid, v_src, v_args, v_secdef
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_order';

  -- Semnătura NESCHIMBATĂ față de mig 145 (11-arg).
  if v_args <> 'p_restaurant_id uuid, p_source text, p_table_id uuid, p_qr_token_id uuid, '
            || 'p_notes text, p_items jsonb, p_idempotency_key uuid, '
            || 'p_pickup_time timestamp with time zone, p_customer_name text, '
            || 'p_customer_phone text, p_session_id uuid' then
    raise exception 'mig 191: semnătura create_order s-a schimbat: %', v_args;
  end if;

  if not v_secdef then
    raise exception 'mig 191: create_order trebuie să rămână SECURITY DEFINER';
  end if;

  -- Validarea nouă e prezentă în corpul funcției.
  if position('missing_required_group' in v_src) = 0 then
    raise exception 'mig 191: guard-ul de minim pe grup (missing_required_group) lipsește'; end if;
  if position('min_select' in v_src) = 0 then
    raise exception 'mig 191: corpul funcției nu referă min_select'; end if;

  -- Fix-urile din mig 145 sunt PĂSTRATE (copie fidelă).
  if position('duplicate_options' in v_src) = 0 then
    raise exception 'mig 191: fix #1 (duplicate_options, mig 145) a dispărut'; end if;
  if position('too_many_in_group' in v_src) = 0 then
    raise exception 'mig 191: fix #9 (too_many_in_group, mig 145) a dispărut'; end if;
  if position('duplicate_extras' in v_src) = 0 then
    raise exception 'mig 191: dedup-ul de extras (mig 145) a dispărut'; end if;
  if position('pe.restaurant_id' in v_src) > 0 then
    raise exception 'mig 191: regresie fix #3 (mig 145) — pe.restaurant_id referit din nou'; end if;

  -- Grants re-aplicate: anon + authenticated pot executa.
  if not has_function_privilege('anon', v_oid, 'execute') then
    raise exception 'mig 191: anon nu mai poate executa create_order'; end if;
  if not has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception 'mig 191: authenticated nu mai poate executa create_order'; end if;

  raise notice 'mig 191: create_order — minim pe grup (missing_required_group) + fix-urile 145 păstrate OK';
end $$;

commit;
