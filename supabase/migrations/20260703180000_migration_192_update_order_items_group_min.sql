-- mig 192 — update_order_items: minim pe grup server-side (paritate create_order, mig 191)
-- ─────────────────────────────────────────────────────────────────────
-- mig 191 a închis pe calea de CREARE (create_order) gap-ul de minim pe grup
-- (min_select / is_required) și a documentat explicit ruda de pe calea de EDITARE:
-- `update_order_items` (ultima definiție: mig 184) validează la editarea comenzii
-- doar PLAFONUL `max_select` per grup (oglinda fix #9), NU și minimul. Un ospătar
-- care editează o comandă existentă putea coborî un grup obligatoriu sub minim
-- (sau îl putea goli complet), persistând o combinație pe care calea de creare o
-- respinge — preț și producție în bucătărie afectate. UI-ul nu e o barieră
-- (regula din CLAUDE.md: gate-urile se pun în RPC/RLS, nu doar în UI).
--
-- Această migrație RECREEAZĂ update_order_items — copie FIDELĂ a corpului din
-- mig 184 — cu UN singur delta: după validarea existentă a opțiunilor (dedup
-- mig 184 + plafon pe grup, oglinda fix #9), pentru FIECARE grup de modificatori
-- al produsului editat (ACEEAȘI semantică precum guard-ul din mig 191):
--   • dacă `is_required` sau `min_select > 0` → numărul de opțiuni selectate ȘI
--     disponibile din grup trebuie să fie >= greatest(min_select, 1 dacă is_required),
--     plafonat la 1 pe selection_type='single' (plafonul pe grup impune oricum ≤1
--     acolo; paritate cu clientul — modifierGroupMin din src/lib/qr.ts);
--   • plafonul superior (max_select) e DEJA gate-uit (mig 146/184) — neatins.
-- La încălcare: exception RO + hint mașină-citibil 'missing_required_group'
-- (același hint ca în create_order/mig 191 — clientul tratează ambele căi la fel).
--
-- De ce nu ajunge validarea existentă: query-urile pe v_option_ids văd DOAR
-- grupurile din care s-a selectat ceva — un grup obligatoriu complet gol nu apare
-- deloc acolo, deci nu putea fi prins. Verificăm pornind de la
-- product_modifier_groups, ca grupurile goale să fie văzute (identic mig 191).
--
-- Pereche sincronizată? update_order_items NU are un „geamăn" pe modelul
-- advance_order (mig 085/087) — lanțul definițiilor e 079 → 080 → 081 → 082 →
-- 146 → 184 (verificat cu grep pe `create or replace function
-- public.update_order_items`), iar mig 184 e ULTIMA. Ruda de pe calea de CREARE
-- e create_order (mig 145 → 191), care are deja acest guard — mig 192 aduce
-- paritatea pe editare.
--
-- Semnătura, security definer, `search_path = public, pg_temp` și grants
-- (DOAR authenticated; anon NU) rămân IDENTICE cu mig 184; asserțiile
-- fail-closed de mai jos le verifică pe toate. Mig 184 NU e editată — acesta e
-- fișier nou. Idempotent: `create or replace function`.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

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
begin
  if v_caller_uid is null then
    raise exception 'update_order_items: authentication required';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'update_order_items: order % not found', p_order_id;
  end if;
  v_old_total := v_order.total;

  -- ============================================================
  -- OPTIMISTIC LOCK: comanda nu s-a schimbat de la deschiderea sheet-ului
  -- ============================================================
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

  -- Stari terminale: include 'closed' (nota deja decontata pe casa externa). Altfel un waiter
  -- ar putea edita prin RPC direct produsele/totalul unei comenzi inchise dupa decontare,
  -- divergand evidenta de bonul extern emis. advance_order blocheaza deja re-tranzitia din closed.
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

  -- ── M1 (mig 146): snapshot extras existente ÎNAINTE de delete, pentru păstrare ──
  -- pe item-urile care nu trimit 'extra_ids'. Ordinea (by id) = ordinea de inserare.
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
    if v_item_qty is null or v_item_qty < 1 or v_item_qty > 99 then
      raise exception 'update_order_items: invalid quantity (1-99)';
    end if;

    select id, restaurant_id, name, price, is_active
    into v_product
    from public.products
    where id = (v_item ->> 'product_id')::uuid;

    if not found then
      raise exception 'update_order_items: product % not found', v_item ->> 'product_id';
    end if;
    if v_product.restaurant_id <> v_order.restaurant_id then
      raise exception 'update_order_items: product does not belong to this restaurant';
    end if;
    if not v_product.is_active then
      raise exception 'update_order_items: product "%" is inactive', v_product.name;
    end if;

    v_unit_price := v_product.price;

    v_option_ids := array(
      select (x)::uuid
      from jsonb_array_elements_text(coalesce(v_item -> 'option_ids', '[]'::jsonb)) as x
    );

    v_options_delta := 0;
    v_options_json  := '[]'::jsonb;

    if array_length(v_option_ids, 1) > 0 then
      -- ── FIX (mig 184, anti-furt — paritate cu create_order #1, mig 145): respinge
      -- option_ids DUPLICATE pe inputul brut, ÎNAINTE de orice join. Fără acest guard,
      -- editarea unei comenzi rămânea pe o cale de validare diferită de create_order
      -- (uuid[] + `= any()`, fără eroarea specifică `duplicate_options`) pentru aceeași
      -- clasă de bug deja reparată la creare. Verificăm pe valorile brute din JSON,
      -- exact ca guard-ul de mai jos pentru extra_ids (#2, mig 146).
      if array_length(v_option_ids, 1) <> (
           select count(distinct t.v)
           from jsonb_array_elements_text(v_item -> 'option_ids') as t(v)
         ) then
        raise exception 'update_order_items: option_ids duplicate pentru produsul "%"', v_product.name
          using errcode = 'P0001', hint = 'duplicate_options';
      end if;

      select count(*) into v_valid_count
      from public.modifier_options mo
      join public.modifier_groups mg on mg.id = mo.modifier_group_id
      join public.product_modifier_groups pmg on pmg.modifier_group_id = mg.id
      where mo.id = any(v_option_ids)
        and mo.is_available = true
        and pmg.product_id = v_product.id
        and mg.restaurant_id = v_order.restaurant_id;

      if v_valid_count <> array_length(v_option_ids, 1) then
        raise exception 'update_order_items: invalid options for product "%"', v_product.name;
      end if;

      -- Plafon de selecție pe grup — oglindă create_order (#9): editarea nu poate
      -- persista o combinație pe care calea de creare o respinge (max_select; single => 1).
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

    -- ── FIX (mig 192): MINIM pe grup — server-side (paritate create_order, mig 191).
    -- Verificăm TOATE grupurile produsului (un grup fără nicio selecție nu apare
    -- în query-urile pe v_option_ids de mai sus, deci validarea existentă nu-l
    -- vede). Regula (identică mig 191; paritate cu clientul — modifierGroupMin
    -- din src/lib/qr.ts):
    --   • minim efectiv = greatest(min_select, 1 dacă is_required), plafonat la 1
    --     pe selection_type='single' (plafonul pe grup impune oricum ≤1 acolo);
    --   • se numără doar opțiunile selectate ȘI disponibile din grup;
    --   • duplicatele au fost deja respinse (guard mig 184), iar `= any(uuid[])`
    --     nu multiplică rândurile, deci count(*) e corect;
    --   • max_select e deja gate-uit de plafonul pe grup (mig 146/184) — neatins.
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

    -- ── EXTRAS (mig 146, #2) ────────────────────────────────────────
    v_extras_delta := 0;
    v_extras_json  := '[]'::jsonb;

    if v_item ? 'extra_ids' then
      -- (a) client trimite explicit extra_ids
      if jsonb_array_length(coalesce(v_item -> 'extra_ids', '[]'::jsonb)) > 0 then
        -- dedup pe input brut (anti dublă-numărare, paritate cu create_order #1)
        if jsonb_array_length(v_item -> 'extra_ids') <> (
             select count(distinct t.v)
             from jsonb_array_elements_text(v_item -> 'extra_ids') as t(v)
           ) then
          raise exception 'update_order_items: extra_ids duplicate pentru produsul "%"', v_product.name;
        end if;

        select
          coalesce(sum(pe.price), 0),
          coalesce(jsonb_agg(jsonb_build_object(
            'extra_id',   pe.id,
            'extra_name', pe.name,
            'price',      pe.price
          )), '[]'::jsonb),
          count(*)
        into v_extras_delta, v_extras_json, v_extras_count
        from jsonb_array_elements_text(v_item -> 'extra_ids') eid
        join public.product_extras pe on pe.id = eid::uuid
        where pe.product_id = v_product.id
          and pe.is_available = true;

        if v_extras_count <> jsonb_array_length(v_item -> 'extra_ids') then
          raise exception 'update_order_items: extras invalide/indisponibile pentru produsul "%"', v_product.name;
        end if;
      end if;
      -- (c) extra_ids prezent dar gol → extras golite explicit (rămân []/0)
    else
      -- (b) M1: item fără 'extra_ids' → păstrăm extras existente pentru acest product_id
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

    v_item_total := (v_unit_price + v_options_delta + v_extras_delta) * v_item_qty;
    v_item_notes := nullif(trim(coalesce(v_item ->> 'notes', '')), '');

    insert into public.order_items (
      order_id, product_id, product_name_snapshot, unit_price_snapshot,
      quantity, item_total, selected_modifiers, extras_added, notes
    )
    values (
      p_order_id, v_product.id, v_product.name, v_unit_price,
      v_item_qty, v_item_total, v_options_json, v_extras_json, v_item_notes
    );
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

revoke all on function public.update_order_items(uuid, jsonb, numeric) from public;
grant execute on function public.update_order_items(uuid, jsonb, numeric) to authenticated;

-- ── Asserții fail-closed (tiparul mig 191) ───────────────────────────────────
do $$
declare
  v_oid       oid;
  v_src       text;
  v_args      text;
  v_overloads int;
  v_secdef    boolean;
  v_config    text[];
begin
  select count(*) into v_overloads
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'update_order_items';
  if v_overloads <> 1 then
    raise exception 'mig 192: update_order_items trebuie să aibă EXACT 1 overload (găsite: %)', v_overloads;
  end if;

  select p.oid, pg_get_functiondef(p.oid), pg_get_function_identity_arguments(p.oid), p.prosecdef, p.proconfig
    into v_oid, v_src, v_args, v_secdef, v_config
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'update_order_items';

  -- Semnătura NESCHIMBATĂ față de mig 184 (3-arg).
  if v_args <> 'p_order_id uuid, p_items jsonb, p_expected_total numeric' then
    raise exception 'mig 192: semnătura update_order_items s-a schimbat: %', v_args;
  end if;

  if not v_secdef then
    raise exception 'mig 192: update_order_items trebuie să rămână SECURITY DEFINER';
  end if;

  -- search_path pinuit (convenția lockdown, identic mig 184).
  if not (v_config @> array['search_path=public, pg_temp']) then
    raise exception 'mig 192: search_path=public, pg_temp lipsește (proconfig: %)', v_config;
  end if;

  -- Validarea nouă e prezentă în corpul funcției.
  if position('missing_required_group' in v_src) = 0 then
    raise exception 'mig 192: guard-ul de minim pe grup (missing_required_group) lipsește'; end if;
  if position('min_select' in v_src) = 0 then
    raise exception 'mig 192: corpul funcției nu referă min_select'; end if;

  -- Fix-urile din mig 146/184 sunt PĂSTRATE (copie fidelă).
  if position('duplicate_options' in v_src) = 0 then
    raise exception 'mig 192: guard-ul dedup pe option_ids (mig 184) a dispărut'; end if;
  if position('too_many_in_group' in v_src) = 0 then
    raise exception 'mig 192: plafonul pe grup (mig 146) a dispărut'; end if;
  if position('product_extras' in v_src) = 0 then
    raise exception 'mig 192: procesarea extras (mig 146, #2) a dispărut'; end if;
  if position('v_preserved' in v_src) = 0 then
    raise exception 'mig 192: păstrarea extras (M1, mig 146) a dispărut'; end if;
  if position('cannot edit terminal state' in v_src) = 0 then
    raise exception 'mig 192: gate-ul de stări terminale (paid/cancelled/closed) a dispărut'; end if;
  if position('40001' in v_src) = 0 then
    raise exception 'mig 192: optimistic lock-ul (errcode 40001, mig 082) a dispărut'; end if;

  -- Grants re-aplicate: DOAR authenticated poate executa (identic mig 184).
  if not has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception 'mig 192: authenticated nu mai poate executa update_order_items'; end if;
  if has_function_privilege('anon', v_oid, 'execute') then
    raise exception 'mig 192: anon NU trebuie să poată executa update_order_items'; end if;

  raise notice 'mig 192: update_order_items — minim pe grup (missing_required_group) + fix-urile 146/184 păstrate OK';
end $$;

commit;
