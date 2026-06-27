-- mig 112 — Fix securitate P0: 2 breșe de izolare multi-tenant
--
-- Găsite la auditul platformei. Ambele expun date ale ALTOR restaurante.
--
-- (A) MENU-1: view-urile product_profitability și ingredients_low_stock (mig 026)
--     au fost create FĂRĂ security_invoker → rulează cu privilegiile owner-ului
--     view-ului (BYPASSRLS) și IGNORĂ RLS-ul tabelelor de bază. Orice user
--     autentificat poate `select * from product_profitability` și citi cost_price/
--     profit/marjă/stoc ale ORICĂRUI restaurant. Exact clasa reparată de mig 008
--     pentru alte 6 view-uri (și impusă de aserția CI din mig 097). Aceste 2
--     view-uri din mig 026 (ulterior) au scăpat.
--     FIX: re-creează ambele cu security_invoker=true (respectă RLS-ul apelantului).
--
-- (B) CFG-1: policy-urile „qr_tokens: anon read active" și „tables: anon read via
--     qr" (mig 005) NU au clauză `to anon`, deci se aplică la PUBLIC (toate
--     rolurile, inclusiv authenticated) și fiind PERMISSIVE se combină prin OR cu
--     „members read". Cum mig 047 a grant-uit SELECT pe qr_tokens/tables către
--     authenticated, orice user autentificat citea token-ul QR (secretul bearer
--     tipărit) + mesele ORICĂRUI restaurant → enumerare + open_table_session pe
--     mese străine. Fluxul public real folosește RPC-uri SECURITY DEFINER
--     (resolve_qr_token, get_restaurant_by_slug, open_table_session), iar staff-ul
--     citește prin „members read" → policy-urile permisive nu sunt necesare nici
--     unui flux legitim.
--     FIX: scopează-le explicit `to anon` (inerte oricum — anon n-are grant pe
--     aceste tabele) ca să NU se mai aplice rolului authenticated.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── (A) View-uri cu security_invoker ─────────────────────────────────────────
create or replace view public.ingredients_low_stock with (security_invoker = true) as
select
  i.*,
  (i.min_stock_alert is not null and i.current_stock < i.min_stock_alert) as is_low
from public.ingredients i
where i.is_active = true;

create or replace view public.product_profitability with (security_invoker = true) as
select
  p.id as product_id,
  p.restaurant_id,
  p.name,
  p.price as sell_price,
  coalesce((
    select sum(r.quantity * i.cost_per_unit)
    from public.recipes r
    join public.ingredients i on i.id = r.ingredient_id
    where r.product_id = p.id
  ), 0) as cost_price,
  p.price - coalesce((
    select sum(r.quantity * i.cost_per_unit)
    from public.recipes r
    join public.ingredients i on i.id = r.ingredient_id
    where r.product_id = p.id
  ), 0) as profit_amount,
  case
    when p.price > 0 then
      ((p.price - coalesce((
        select sum(r.quantity * i.cost_per_unit)
        from public.recipes r
        join public.ingredients i on i.id = r.ingredient_id
        where r.product_id = p.id
      ), 0)) / p.price * 100)
    else 0
  end as margin_percent
from public.products p
where p.is_active = true;

-- ── (B) Policy-uri qr_tokens/tables scopate la anon ──────────────────────────
drop policy if exists "qr_tokens: anon read active" on public.qr_tokens;
create policy "qr_tokens: anon read active" on public.qr_tokens
  for select to anon
  using (is_active = true and (expires_at is null or expires_at > now()));

drop policy if exists "tables: anon read via qr" on public.tables;
create policy "tables: anon read via qr" on public.tables
  for select to anon
  using (exists (
    select 1 from public.qr_tokens qt
    where qt.table_id = tables.id and qt.is_active = true
  ));

-- ── Asserții ─────────────────────────────────────────────────────────────────
do $$
declare v_iv boolean; v_pp boolean;
begin
  -- security_invoker prezent pe ambele view-uri
  select 'security_invoker=true' = any(c.reloptions) into v_iv
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname='ingredients_low_stock';
  select 'security_invoker=true' = any(c.reloptions) into v_pp
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname='product_profitability';
  if not coalesce(v_iv,false) or not coalesce(v_pp,false) then
    raise exception 'mig 112: security_invoker lipsește pe view-uri (iv=% pp=%)', v_iv, v_pp;
  end if;
  -- policy-urile permisive nu mai vizează authenticated/public
  if exists (select 1 from pg_policies where schemaname='public' and tablename='qr_tokens'
       and policyname='qr_tokens: anon read active' and roles <> '{anon}') then
    raise exception 'mig 112: qr_tokens policy nu e scopată strict la anon';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='tables'
       and policyname='tables: anon read via qr' and roles <> '{anon}') then
    raise exception 'mig 112: tables policy nu e scopată strict la anon';
  end if;
  raise notice 'mig 112: izolare multi-tenant (views security_invoker + qr/tables anon-only) OK';
end $$;

commit;
