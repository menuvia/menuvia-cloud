-- =============================================================================
-- Migration 320: editarea unei comenzi nu mai mută bani și extra-uri între
-- linii (lotul O3a, audit nov 2026 STAFF-OPT-4/5/6, OPT-7, OPT-15)
-- =============================================================================
-- `update_order_items` (313) face DELETE + re-INSERT pe toate liniile și le
-- re-validează și re-prețuiește pe TOATE la catalogul de azi. Trei consecințe
-- dovedite de audit:
--   (1) extra-urile unei linii se „păstrau” căutând prima linie veche cu același
--       produs, în ordinea id-urilor — uuid-uri ALEATOARE. Cu două linii
--       „Burger” (una cu bacon), bacon-ul sărea pe linia cu cantitatea 3, iar
--       o linie nouă moștenea extra-ul unei linii șterse: total mai mare decât
--       „Subtotal nou”, iar bonul și factura încasau diferența;
--   (2) o linie NESCHIMBATĂ trecea la prețul de azi (cafeaua comandată la 10
--       lei devenea 12 după ce patronul schimba prețul), fără niciun avertisment;
--   (3) o linie neschimbată pica dacă între timp o opțiune a ei devenise
--       indisponibilă sau produsul fusese scos din meniu — ospătarul nu mai
--       putea adăuga o apă la masă fără să șteargă pizza oaspetelui.
--
-- Contractul nou (decizia fondatorului: „preț de azi, limită 20”):
--   - fiecare linie trimisă de client poate purta `source_item_id` = id-ul
--     liniei din comandă din care provine. Atunci extra-urile vin de pe ACEA
--     linie (nu din euristica pe produs), iar o linie cu aceleași opțiuni și
--     extra-uri își PĂSTREAZĂ prețul unitar, opțiunile și extra-urile din
--     instantaneu, fără re-validare pe disponibilitatea de azi;
--   - unitățile ADĂUGATE peste cantitatea veche se taxează la prețul de azi și
--     se validează pe catalogul de azi; dacă prețul diferă, ele devin o linie
--     separată (o linie are un singur preț unitar), altfel se contopesc;
--   - o linie fără `source_item_id` e NOUĂ: validare completă, prețul de azi,
--     extra-uri DOAR din `extra_ids`;
--   - un produs devenit indisponibil (epuizat, scos, ciornă) rămâne pe comandă
--     până la cantitatea deja comandată (regula 313, lărgită de la epuizat la
--     toate trei — trigger-ul 130 primește aceeași scutire prin GUC);
--   - cantitatea pe linie: 1–20 (ca create_order), hint `invalid_quantity`.
-- Compatibilitate: un client care NU trimite niciun `source_item_id` (versiunea
-- dinainte) primește comportamentul de până acum (euristica pe produs, prețul
-- de azi), ca deploy-ul să meargă în orice ordine.
--
-- Invariantele lanțului 079…192→313 rămân toate: autentificare, lock `for
-- update`, lock optimist (40001), rol owner/manager/waiter, stări terminale,
-- blocare pe plăți parțiale, 1–100 linii, duplicate_options / invalid options /
-- too_many_in_group / missing_required_group, extra-uri validate și deduplicate,
-- re-evaluarea Happy Hour, `_refresh_order_totals`, rezumatul de audit,
-- `menuvia.skip_item_audit`, forma răspunsului, aceeași semnătură.
-- =============================================================================

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── 1. Trigger-ul 130: scutirea liniei păstrate acoperă toate indisponibilele ─
create or replace function public.reject_unavailable_order_item()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prod record;
  v_keep boolean;
begin
  if new.product_id is null then
    return new;  -- linie ad-hoc fara produs (FK permite); nimic de validat
  end if;

  select is_active, is_draft, is_sold_out, name
    into v_prod
  from public.products
  where id = new.product_id;

  if not found then
    return new;  -- FK-ul se ocupa de inexistenta; nu dublam eroarea
  end if;

  -- mig 313 → 320: linia PĂSTRATĂ de update_order_items (cantitatea deja
  -- comandată, verificată acolo) trece; GUC-ul e pus doar de acel RPC.
  v_keep := coalesce(current_setting('menuvia.sold_out_keep_order', true), '') = new.order_id::text;

  if v_prod.is_draft and not v_keep then
    raise exception 'Produsul "%" este ciornă și nu poate fi comandat', v_prod.name
      using errcode = 'P0001', hint = 'product_draft';
  end if;
  if v_prod.is_sold_out and not v_keep then
    raise exception 'Produsul "%" este epuizat', v_prod.name
      using errcode = 'P0001', hint = 'product_sold_out';
  end if;
  if not v_prod.is_active and not v_keep then
    raise exception 'Produsul "%" nu este disponibil', v_prod.name
      using errcode = 'P0001', hint = 'product_inactive';
  end if;

  return new;
end;
$$;

revoke all on function public.reject_unavailable_order_item() from public, anon, authenticated, service_role;

-- ── 2. update_order_items ────────────────────────────────────────────────────
create or replace function public.update_order_items(
  p_order_id       uuid,
  p_items          jsonb,
  p_expected_total numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_uid    uuid := auth.uid();
  v_order         public.orders%rowtype;
  v_role          text;
  v_item          jsonb;
  v_product       record;
  v_option_ids    uuid[];
  v_extra_ids     uuid[];
  v_valid_count   integer;
  v_unit_price    numeric(10,2);
  v_options_delta numeric(10,2);
  v_options_json  jsonb;
  v_extras_delta  numeric(10,2);
  v_extras_json   jsonb;
  v_extras_count  integer;
  v_preserved     jsonb;
  v_used          boolean[];
  v_pcount        integer;
  v_idx           integer;
  v_match_idx     integer;
  v_item_total    numeric(10,2);
  v_item_qty      integer;
  v_item_notes    text;
  v_payments_sum  numeric(10,2);
  v_items_count   integer;
  v_was_happy_hour boolean := false;
  v_hh_rule       record;
  v_hh_subtotal   numeric(10,2);
  v_hh_discount   numeric(10,2);
  v_hh_best_disc  numeric(10,2) := 0;
  v_hh_best_name  text;
  v_new_subtotal  numeric(10,2);
  v_old_items     jsonb;
  v_new_items     jsonb;
  v_old_total     numeric(10,2);
  v_group_name    text;
  v_group_min     int;
  v_old_qty       jsonb;
  v_kept_qty      jsonb := '{}'::jsonb;
  v_old_n         integer;
  v_new_n         integer;
  -- mig 320: liniile vechi după id, modul strict și instantaneul liniei-sursă.
  v_old_lines     jsonb;
  v_strict        boolean;
  v_src           jsonb;
  v_src_ids       uuid[] := '{}';
  v_same_config   boolean;
  v_unavailable   boolean;
  v_kept_part     integer;
  v_new_part      integer;
  v_k_unit        numeric(10,2);
  v_k_opts_json   jsonb;
  v_k_opts_delta  numeric(10,2);
  v_k_extras_json jsonb;
  v_k_extras_delta numeric(10,2);
begin
  if v_caller_uid is null then
    raise exception 'update_order_items: authentication required';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'update_order_items: order % not found', p_order_id;
  end if;
  v_old_total := v_order.total;

  -- OPTIMISTIC LOCK: comanda nu s-a schimbat de la deschiderea sheet-ului
  if p_expected_total is not null and v_order.total <> p_expected_total then
    raise exception
      'update_order_items: comanda a fost modificată între timp (total %, așteptat %). Redeschide comanda și încearcă din nou.',
      v_order.total, p_expected_total
      using errcode = '40001';
  end if;

  select role::text into v_role
  from public.restaurant_memberships
  where restaurant_id = v_order.restaurant_id
    and user_id = v_caller_uid;

  if v_role is null then
    raise exception 'update_order_items: caller is not a member of this restaurant';
  end if;
  if v_role not in ('owner', 'manager', 'waiter') then
    raise exception 'update_order_items: role % cannot edit orders', v_role;
  end if;

  if v_order.status in ('paid', 'cancelled', 'closed') then
    raise exception 'update_order_items: order is % — cannot edit terminal state', v_order.status;
  end if;

  select coalesce(sum(amount), 0) into v_payments_sum
  from public.order_payments
  where order_id = p_order_id;
  if v_payments_sum > 0 then
    raise exception
      'update_order_items: order has partial payments (% lei). Anulează plățile întâi.',
      v_payments_sum;
  end if;

  v_items_count := jsonb_array_length(coalesce(p_items, '[]'::jsonb));
  if v_items_count = 0 then
    raise exception 'update_order_items: items array empty. Pentru anulare folosește advance_order(cancel).';
  end if;
  if v_items_count > 100 then
    raise exception 'update_order_items: too many items (max 100)';
  end if;

  v_was_happy_hour := v_order.discount_reason is not null
    and v_order.discount_reason like '%Happy Hour%';

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', product_name_snapshot,
           'qty',  quantity,
           'total', item_total
         ) order by product_name_snapshot), '[]'::jsonb)
    into v_old_items
    from public.order_items where order_id = p_order_id;

  -- mig 313: cât era DEJA comandat din fiecare produs (sumă pe produs).
  select coalesce(jsonb_object_agg(s.product_id::text, s.q), '{}'::jsonb)
    into v_old_qty
    from (select product_id, sum(quantity)::int as q
            from public.order_items
           where order_id = p_order_id and product_id is not null
           group by product_id) s;

  -- mig 320: liniile vechi DUPĂ ID (instantaneul complet, înainte de DELETE).
  select coalesce(jsonb_object_agg(id::text, jsonb_build_object(
           'product_id',          product_id,
           'quantity',            quantity,
           'unit_price_snapshot', unit_price_snapshot,
           'selected_modifiers',  coalesce(selected_modifiers, '[]'::jsonb),
           'extras_added',        coalesce(extras_added, '[]'::jsonb))), '{}'::jsonb)
    into v_old_lines
    from public.order_items where order_id = p_order_id;

  -- Modul strict = clientul nou (cel puțin o linie cu source_item_id).
  select exists (
    select 1 from jsonb_array_elements(p_items) x where x ? 'source_item_id'
  ) into v_strict;

  -- M1 (mig 146) — DOAR pentru clientul vechi: extra-urile păstrate pe produs.
  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', product_id,
           'extras',     coalesce(extras_added, '[]'::jsonb)
         ) order by id), '[]'::jsonb)
    into v_preserved
    from public.order_items where order_id = p_order_id;
  v_pcount := jsonb_array_length(v_preserved);
  v_used   := array_fill(false, array[greatest(v_pcount, 1)]);

  perform set_config('menuvia.skip_item_audit', 'on', true);

  delete from public.order_items where order_id = p_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_qty := (v_item ->> 'quantity')::integer;
    if v_item_qty is null or v_item_qty < 1 or v_item_qty > 20 then
      raise exception 'update_order_items: invalid quantity (1-20)'
        using errcode = 'P0001', hint = 'invalid_quantity';
    end if;

    select id, restaurant_id, name, price, is_active, is_sold_out, is_draft
    into v_product
    from public.products
    where id = (v_item ->> 'product_id')::uuid;

    if not found then
      raise exception 'update_order_items: product % not found', v_item ->> 'product_id'
        using errcode = 'P0001', hint = 'product_not_found';
    end if;
    if v_product.restaurant_id <> v_order.restaurant_id then
      raise exception 'update_order_items: product does not belong to this restaurant';
    end if;

    -- ── Linia-sursă (mig 320) ──────────────────────────────────────────────
    v_src := null;
    if v_item ? 'source_item_id' and nullif(v_item ->> 'source_item_id', '') is not null then
      v_src := v_old_lines -> (v_item ->> 'source_item_id');
      if v_src is null or (v_src ->> 'product_id') is distinct from v_product.id::text then
        raise exception 'update_order_items: linia sursă nu aparține comenzii sau produsului "%"', v_product.name
          using errcode = 'P0001', hint = 'invalid_source_item';
      end if;
      if (v_item ->> 'source_item_id')::uuid = any (v_src_ids) then
        raise exception 'update_order_items: linia sursă apare de două ori'
          using errcode = 'P0001', hint = 'invalid_source_item';
      end if;
      v_src_ids := v_src_ids || (v_item ->> 'source_item_id')::uuid;
    end if;

    -- ── Produs indisponibil: rămâne DOAR cantitatea deja comandată (313 → 320:
    -- epuizat, scos din meniu sau ciornă).
    v_unavailable := v_product.is_sold_out is true or not v_product.is_active or v_product.is_draft is true;
    if v_unavailable then
      v_old_n := coalesce((v_old_qty ->> v_product.id::text)::int, 0);
      v_new_n := coalesce((v_kept_qty ->> v_product.id::text)::int, 0) + v_item_qty;
      if v_new_n > v_old_n then
        if v_product.is_sold_out is true then
          raise exception 'update_order_items: produsul "%" este epuizat — poți păstra cel mult cantitatea deja comandată (%)',
            v_product.name, v_old_n
            using errcode = 'P0001', hint = 'product_sold_out';
        else
          raise exception 'update_order_items: produsul "%" nu mai e în meniu — poți păstra cel mult cantitatea deja comandată (%)',
            v_product.name, v_old_n
            using errcode = 'P0001', hint = 'product_inactive';
        end if;
      end if;
      v_kept_qty := jsonb_set(v_kept_qty, array[v_product.id::text], to_jsonb(v_new_n));
    end if;

    v_option_ids := array(
      select (x)::uuid
      from jsonb_array_elements_text(coalesce(v_item -> 'option_ids', '[]'::jsonb)) as x
    );
    if array_length(v_option_ids, 1) <> (
         select count(distinct t.v)
         from jsonb_array_elements_text(coalesce(v_item -> 'option_ids', '[]'::jsonb)) as t(v)
       ) then
      raise exception 'update_order_items: option_ids duplicate pentru produsul "%"', v_product.name
        using errcode = 'P0001', hint = 'duplicate_options';
    end if;

    -- Extra-urile cerute: explicit (`extra_ids`), altfel ale liniei-sursă.
    if v_item ? 'extra_ids' then
      v_extra_ids := array(
        select (x)::uuid from jsonb_array_elements_text(coalesce(v_item -> 'extra_ids', '[]'::jsonb)) as x
      );
      if coalesce(array_length(v_extra_ids, 1), 0) <> (
           select count(distinct t.v)
           from jsonb_array_elements_text(coalesce(v_item -> 'extra_ids', '[]'::jsonb)) as t(v)
         ) then
        raise exception 'update_order_items: extra_ids duplicate pentru produsul "%"', v_product.name
          using errcode = 'P0001', hint = 'duplicate_extras';
      end if;
    elsif v_src is not null then
      v_extra_ids := array(
        select (coalesce(e ->> 'extra_id', e ->> 'id'))::uuid
          from jsonb_array_elements(v_src -> 'extras_added') e
         where coalesce(e ->> 'extra_id', e ->> 'id') is not null
      );
    else
      v_extra_ids := null;  -- clientul vechi / linie nouă fără extra_ids
    end if;

    -- Aceeași configurație ca linia-sursă = aceleași opțiuni ȘI aceleași extra-uri.
    v_same_config := v_src is not null
      and (select coalesce(array_agg(x order by x), '{}') from unnest(v_option_ids) x)
          = (select coalesce(array_agg((m ->> 'option_id')::uuid order by (m ->> 'option_id')::uuid), '{}')
               from jsonb_array_elements(v_src -> 'selected_modifiers') m)
      and (select coalesce(array_agg(x order by x), '{}') from unnest(coalesce(v_extra_ids, '{}')) x)
          = (select coalesce(array_agg((coalesce(e ->> 'extra_id', e ->> 'id'))::uuid
                                       order by (coalesce(e ->> 'extra_id', e ->> 'id'))::uuid), '{}')
               from jsonb_array_elements(v_src -> 'extras_added') e
              where coalesce(e ->> 'extra_id', e ->> 'id') is not null);

    v_kept_part := 0;
    v_new_part  := v_item_qty;
    if v_same_config then
      v_kept_part := least(v_item_qty, (v_src ->> 'quantity')::int);
      v_new_part  := v_item_qty - v_kept_part;
      -- Partea păstrată: prețul, opțiunile și extra-urile din instantaneu.
      v_k_unit        := (v_src ->> 'unit_price_snapshot')::numeric;
      v_k_opts_json   := v_src -> 'selected_modifiers';
      v_k_extras_json := v_src -> 'extras_added';
      select coalesce(sum((m ->> 'price_delta')::numeric), 0) into v_k_opts_delta
        from jsonb_array_elements(v_k_opts_json) m;
      select coalesce(sum((e ->> 'price')::numeric), 0) into v_k_extras_delta
        from jsonb_array_elements(v_k_extras_json) e;
    end if;

    -- ── Partea NOUĂ (linie nouă, configurație schimbată sau unități adăugate):
    -- validare completă pe catalogul de azi, la prețul de azi.
    v_unit_price    := v_product.price;
    v_options_delta := 0;
    v_options_json  := '[]'::jsonb;
    v_extras_delta  := 0;
    v_extras_json   := '[]'::jsonb;
    if v_new_part > 0 then
      if array_length(v_option_ids, 1) > 0 then
        select count(*) into v_valid_count
        from public.modifier_options mo
        join public.modifier_groups mg on mg.id = mo.modifier_group_id
        join public.product_modifier_groups pmg on pmg.modifier_group_id = mg.id
        where mo.id = any(v_option_ids)
          and mo.is_available = true
          and pmg.product_id = v_product.id
          and mg.restaurant_id = v_order.restaurant_id;

        if v_valid_count <> array_length(v_option_ids, 1) then
          raise exception 'update_order_items: invalid options for product "%"', v_product.name
            using errcode = 'P0001', hint = 'invalid_options';
        end if;

        if exists (
          select 1
          from public.modifier_options mo
          join public.modifier_groups mg on mg.id = mo.modifier_group_id
          join public.product_modifier_groups pmg on pmg.modifier_group_id = mg.id
          where mo.id = any(v_option_ids)
            and mo.is_available = true
            and pmg.product_id = v_product.id
            and mg.restaurant_id = v_order.restaurant_id
          group by mg.id, mg.selection_type, mg.max_select
          having count(*) > coalesce(
                   case when mg.selection_type = 'single' then 1 else mg.max_select end,
                   2147483647)
        ) then
          raise exception 'update_order_items: prea multe opțiuni selectate într-un grup pentru produsul "%"', v_product.name
            using errcode = 'P0001', hint = 'too_many_in_group';
        end if;

        select
          coalesce(sum(mo.price_delta), 0),
          coalesce(jsonb_agg(jsonb_build_object(
            'group_id',    mg.id,
            'group_name',  mg.name,
            'option_id',   mo.id,
            'option_name', mo.name,
            'price_delta', mo.price_delta
          )), '[]'::jsonb)
        into v_options_delta, v_options_json
        from public.modifier_options mo
        join public.modifier_groups mg on mg.id = mo.modifier_group_id
        where mo.id = any(v_option_ids);
      end if;

      -- MINIM pe grup (mig 192), paritate create_order.
      v_group_name := null;
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
            from public.modifier_options mo
           where mo.modifier_group_id = mg.id
             and mo.id = any(v_option_ids)
             and mo.is_available = true
        ) sel on true
       where pmg.product_id = v_product.id
         and mg.restaurant_id = v_order.restaurant_id
         and (mg.is_required or mg.min_select > 0)
         and sel.cnt < least(
               greatest(mg.min_select, case when mg.is_required then 1 else 0 end),
               case when mg.selection_type = 'single' then 1 else 32767 end
             )
       order by pmg.display_order, mg.name
       limit 1;

      if v_group_name is not null then
        raise exception 'update_order_items: grupul "%" pentru produsul "%" cere cel puțin % %',
          v_group_name, v_product.name, v_group_min,
          case when v_group_min = 1 then 'opțiune selectată' else 'opțiuni selectate' end
          using errcode = 'P0001', hint = 'missing_required_group';
      end if;

      if v_extra_ids is not null then
        -- (a) extra-uri cerute explicit sau ale liniei-sursă: validate azi.
        if coalesce(array_length(v_extra_ids, 1), 0) > 0 then
          select
            coalesce(sum(pe.price), 0),
            coalesce(jsonb_agg(jsonb_build_object(
              'extra_id',   pe.id,
              'extra_name', pe.name,
              'price',      pe.price
            )), '[]'::jsonb),
            count(*)
          into v_extras_delta, v_extras_json, v_extras_count
          from unnest(v_extra_ids) eid
          join public.product_extras pe on pe.id = eid
          where pe.product_id = v_product.id
            and pe.is_available = true;

          if v_extras_count <> array_length(v_extra_ids, 1) then
            raise exception 'update_order_items: extras invalide/indisponibile pentru produsul "%"', v_product.name
              using errcode = 'P0001', hint = 'invalid_extras';
          end if;
        end if;
      elsif not v_strict then
        -- (b) M1, DOAR clientul vechi: extra-urile păstrate pe produs.
        v_match_idx := null;
        if v_pcount > 0 then
          for v_idx in 0 .. v_pcount - 1 loop
            if not v_used[v_idx + 1]
               and (v_preserved -> v_idx ->> 'product_id')::uuid = v_product.id then
              v_match_idx := v_idx;
              exit;
            end if;
          end loop;
        end if;
        if v_match_idx is not null then
          v_used[v_match_idx + 1] := true;
          v_extras_json := v_preserved -> v_match_idx -> 'extras';
          select coalesce(sum((e ->> 'price')::numeric), 0)
            into v_extras_delta
            from jsonb_array_elements(v_extras_json) e;
        end if;
      end if;
      -- (c) modul strict, linie nouă fără extra_ids → fără extra-uri.
    end if;

    v_item_notes := nullif(trim(coalesce(v_item ->> 'notes', '')), '');

    -- Partea nouă are același preț unitar ca cea păstrată → o singură linie.
    if v_kept_part > 0 and v_new_part > 0
       and v_k_unit + v_k_opts_delta + v_k_extras_delta = v_unit_price + v_options_delta + v_extras_delta then
      v_kept_part := v_kept_part + v_new_part;
      v_new_part  := 0;
    end if;

    -- GUC-ul pentru trigger-ul 130: DOAR pe linia unui produs indisponibil
    -- (cantitatea a fost verificată mai sus), golit imediat după.
    perform set_config('menuvia.sold_out_keep_order',
                       case when v_unavailable then p_order_id::text else '' end,
                       true);

    if v_kept_part > 0 then
      insert into public.order_items (
        order_id, product_id, product_name_snapshot, unit_price_snapshot,
        quantity, item_total, selected_modifiers, extras_added, notes
      )
      values (
        p_order_id, v_product.id, v_product.name, v_k_unit,
        v_kept_part, (v_k_unit + v_k_opts_delta + v_k_extras_delta) * v_kept_part,
        v_k_opts_json, v_k_extras_json, v_item_notes
      );
    end if;
    if v_new_part > 0 then
      v_item_total := (v_unit_price + v_options_delta + v_extras_delta) * v_new_part;
      insert into public.order_items (
        order_id, product_id, product_name_snapshot, unit_price_snapshot,
        quantity, item_total, selected_modifiers, extras_added, notes
      )
      values (
        p_order_id, v_product.id, v_product.name, v_unit_price,
        v_new_part, v_item_total, v_options_json, v_extras_json, v_item_notes
      );
    end if;

    perform set_config('menuvia.sold_out_keep_order', '', true);
  end loop;

  if v_was_happy_hour then
    select coalesce(sum(item_total), 0) into v_new_subtotal
    from public.order_items where order_id = p_order_id;

    for v_hh_rule in
      select * from public.public_happy_hour_now(v_order.restaurant_id)
    loop
      if v_hh_rule.scope = 'all' then
        v_hh_subtotal := v_new_subtotal;
      elsif v_hh_rule.scope = 'category' then
        select coalesce(sum(oi.item_total), 0) into v_hh_subtotal
          from public.order_items oi
          join public.products p on p.id = oi.product_id
         where oi.order_id = p_order_id and p.category_id = v_hh_rule.category_id;
      elsif v_hh_rule.scope = 'product' then
        select coalesce(sum(oi.item_total), 0) into v_hh_subtotal
          from public.order_items oi
         where oi.order_id = p_order_id and oi.product_id = v_hh_rule.product_id;
      else
        v_hh_subtotal := 0;
      end if;

      if v_hh_subtotal <= 0 then continue; end if;

      if v_hh_rule.discount_type = 'percent' then
        v_hh_discount := round(v_hh_subtotal * v_hh_rule.discount_value / 100, 2);
      else
        v_hh_discount := least(v_hh_rule.discount_value, v_hh_subtotal);
      end if;

      if v_hh_rule.max_discount is not null and v_hh_discount > v_hh_rule.max_discount then
        v_hh_discount := v_hh_rule.max_discount;
      end if;

      if v_hh_discount > v_hh_best_disc then
        v_hh_best_disc := v_hh_discount;
        v_hh_best_name := v_hh_rule.name;
      end if;
    end loop;

    update public.orders
       set discount_type   = case when v_hh_best_disc > 0 then 'amount'::public.order_discount_type else null end,
           discount_value  = case when v_hh_best_disc > 0 then v_hh_best_disc else null end,
           discount_reason = case
             when v_hh_best_disc > 0 then '🎉 Happy Hour: ' || coalesce(v_hh_best_name, '')
             else null
           end
     where id = p_order_id;
  end if;

  perform public._refresh_order_totals(p_order_id);

  select * into v_order from public.orders where id = p_order_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', product_name_snapshot,
           'qty',  quantity,
           'total', item_total
         ) order by product_name_snapshot), '[]'::jsonb)
    into v_new_items
    from public.order_items where order_id = p_order_id;

  begin
    insert into public.audit_log (
      actor_id, actor_role, table_name, operation, row_id,
      restaurant_id, old_data, new_data, changed_keys
    ) values (
      v_caller_uid,
      coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user),
      'order_items', 'UPDATE', p_order_id::text,
      v_order.restaurant_id,
      jsonb_build_object('items', v_old_items, 'total', v_old_total),
      jsonb_build_object('items', v_new_items, 'total', v_order.total),
      array['items', 'total']
    );
  exception when others then
    raise warning 'update_order_items: audit summary insert failed: %', sqlerrm;
  end;

  return jsonb_build_object(
    'id',              v_order.id,
    'total',           v_order.total,
    'discount_amount', v_order.discount_amount,
    'items_count',     v_items_count
  );
end;
$$;

-- ── Asserții fail-closed ─────────────────────────────────────────────────────
do $$
declare v_src text; v_cfg text;
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'update_order_items') <> 1 then
    raise exception 'mig 320: update_order_items trebuie să aibă O singură semnătură';
  end if;
  select p.prosrc, array_to_string(p.proconfig, ',') into v_src, v_cfg
    from pg_proc p where p.oid = 'public.update_order_items(uuid, jsonb, numeric)'::regprocedure;
  if v_src !~ 'source_item_id' or v_src !~ 'v_same_config' or v_src !~ 'not v_strict' then
    raise exception 'mig 320: update_order_items nu are contractul liniei-sursă';
  end if;
  if v_src !~ 'for update' or v_src !~ '40001' or v_src !~ 'missing_required_group'
     or v_src !~ 'too_many_in_group' or v_src !~ 'duplicate_options' or v_src !~ 'skip_item_audit'
     or v_src !~ '_refresh_order_totals' or v_src !~ 'public_happy_hour_now' or v_src !~ 'partial payments' then
    raise exception 'mig 320: update_order_items a pierdut un invariant al lanțului 079…313';
  end if;
  if coalesce(v_cfg, '') !~ 'search_path=public, ?pg_temp' then
    raise exception 'mig 320: search_path = %', v_cfg;
  end if;
  if (select prosrc from pg_proc where oid = 'public.reject_unavailable_order_item()'::regprocedure)
     !~ 'v_keep' then
    raise exception 'mig 320: trigger-ul 130 nu are scutirea liniei păstrate';
  end if;
end $$;

commit;
