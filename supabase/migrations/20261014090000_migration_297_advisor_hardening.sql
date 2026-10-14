-- migration_297_advisor_hardening.sql
-- =============================================================================
-- Trei clase din advisor-ul Supabase de pe PRODUCȚIE (oct 2026), închise în
-- DATE și ținute de clichete permanente (`tests/sql/advisor_hardening_assertions.sql`,
-- AH1–AH6). Doar REVOKE / ALTER POLICY / CREATE INDEX — niciun DROP, deci
-- migrația e aplicabilă fără confirmare de operație distructivă.
--
-- ── §1. anon_security_definer_function_executable ──────────────────────────
-- Advisor-ul lista 47 de funcții SECURITY DEFINER apelabile de `anon` prin
-- /rest/v1/rpc. Fiecare a fost verificată (apelant real în src/, bridge/,
-- netlify/, politici RLS evaluate pentru anon, sau design anon documentat în
-- CLAUDE.md). Rezultat: 38 RĂMÂN anon (+ `rls_auto_enable`, funcție de
-- PLATFORMĂ, nu e în lanț, neatinsă — RP5), 9 pierd `anon`:
--
--   Staff-only (apelate DOAR din dashboard / WaiterPage, sesiune autentificată;
--   au gardă `auth.uid()` internă, deci revoke-ul e defense-in-depth):
--     adjust_stock_manual        — lib/stocks.ts (StocksTab)
--     receive_purchase_order     — lib/stocks.ts (NIR)
--     rotate_qr_token            — TablesManager / lib/orders.ts
--     save_floor_layout          — FloorPlanEditor
--     resolve_waiter_call        — WaiterPage
--     get_order_payments         — WaiterPage (Pay/Split/Cancel); oaspetele NU
--                                   o cheamă (plata online trece prin
--                                   table-payment.js, service_role)
--   Pe toate șase EXECUTE venea prin PUBLIC (`=X/postgres`), nu printr-un grant
--   direct lui anon — de aceea revoke-ul e `from public, anon`, iar
--   `authenticated` primește grant EXPLICIT (avea deja unul direct; îl scriem
--   ca intenția să fie în lanț, nu un accident al ACL-ului).
--
--   Helperi interni (singurii apelanți sunt DEFINER, care rulează ca owner):
--     check_qr_order_rate_limit      — doar trg_check_qr_order_rate_limit (090)
--     check_pickup_order_rate_limit  — doar create_order (191)
--   Erau ORACOLE pentru anon: a doua spunea dacă un număr de telefon a dat ≥3
--   comenzi pickup în 30 min la un local. Pierd și `authenticated`.
--
--   Fără niciun apelant:
--     check_availability — gândită în 086 pentru UI-ul public, dar ReservePage
--       folosește `get_tables_availability` (pe slug, 199/246); nimic din src/
--       n-o cheamă. Pierde `anon`; `authenticated` rămâne (în afara scopului).
--
-- ── §2. auth_rls_initplan (21 de politici) ─────────────────────────────────
-- `auth.uid()` scris direct într-o politică se re-evaluează PER RÂND; înfășurat
-- `(select auth.uid())` devine InitPlan, evaluat o dată per interogare.
-- Expresiile de mai jos sunt EXACT `pg_get_expr` al ultimei definiții din lanț,
-- cu singura substituție `auth.uid()` → `(select auth.uid())`; rolurile și
-- comanda nu se ating (ALTER POLICY schimbă doar USING/WITH CHECK). Asserția de
-- la final o DOVEDEȘTE: instantaneul de dinainte, cu substituția inversă, e
-- egal caracter cu caracter cu ce rămâne după — pe o bază unde o politică ar
-- fi derivat față de lanț, migrația pică în loc s-o rescrie tăcut.
--
-- ── §3. unindexed_foreign_keys ─────────────────────────────────────────────
-- 40 listate de advisor + 3 pe care advisor-ul le socotește acoperite de un
-- index PARȚIAL cu alt predicat (`loyalty_events.order_id` — `kind='earn'`;
-- `reservations.table_id` — status; `table_sessions.table_id` — `status='open'`,
-- iar FK-ul e ON DELETE CASCADE). Un index parțial ajută acțiunea FK-ului doar
-- dacă predicatul e implicat de `col = $1`, adică `col IS NOT NULL` — singurul
-- caz acceptat de clichet (`orders.qr_token_id`, 052, rămâne așa). Nume
-- `<tabelă>_<coloane>_fkey_idx`. Fără CONCURRENTLY (suntem în tranzacție;
-- tabelele au zeci–sute de rânduri pe prod).
-- =============================================================================

begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';
set local search_path = public, pg_temp;

-- ── §1. REVOKE ───────────────────────────────────────────────────────────────
revoke execute on function public.adjust_stock_manual(uuid, numeric, text) from public, anon;
grant  execute on function public.adjust_stock_manual(uuid, numeric, text) to authenticated;
revoke execute on function public.receive_purchase_order(uuid) from public, anon;
grant  execute on function public.receive_purchase_order(uuid) to authenticated;
revoke execute on function public.rotate_qr_token(uuid) from public, anon;
grant  execute on function public.rotate_qr_token(uuid) to authenticated;
revoke execute on function public.save_floor_layout(uuid, jsonb) from public, anon;
grant  execute on function public.save_floor_layout(uuid, jsonb) to authenticated;
revoke execute on function public.resolve_waiter_call(uuid) from public, anon;
grant  execute on function public.resolve_waiter_call(uuid) to authenticated;
revoke execute on function public.get_order_payments(uuid) from public, anon;
grant  execute on function public.get_order_payments(uuid) to authenticated;

revoke execute on function public.check_qr_order_rate_limit(uuid) from public, anon, authenticated;
revoke execute on function public.check_pickup_order_rate_limit(uuid, text) from public, anon, authenticated;

revoke execute on function public.check_availability(uuid, timestamptz, timestamptz, smallint, text) from public, anon;
grant  execute on function public.check_availability(uuid, timestamptz, timestamptz, smallint, text) to authenticated;

-- ── §2. Politici: instantaneu, ALTER, verificare ─────────────────────────────
create temp table _m297_policy_before on commit drop as
select pol.oid as pol_oid, c.relname::text as rel, pol.polname::text as pol,
       pg_get_expr(pol.polqual, pol.polrelid) as qual,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as wcheck
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
        coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) ~ 'auth\.uid\(\)';

alter policy "affiliate: read own attributions" on public.affiliate_attributions
  using ((affiliate_id IN ( SELECT a.id
   FROM affiliates a
  WHERE (a.profile_id = (select auth.uid())))));
alter policy "affiliate: read own ledger" on public.affiliate_ledger
  using ((affiliate_id IN ( SELECT a.id
   FROM affiliates a
  WHERE (a.profile_id = (select auth.uid())))));
alter policy "affiliate: read own payout profile" on public.affiliate_payout_profile
  using ((affiliate_id IN ( SELECT a.id
   FROM affiliates a
  WHERE (a.profile_id = (select auth.uid())))));
alter policy "affiliate: read own payouts" on public.affiliate_payouts
  using ((affiliate_id IN ( SELECT a.id
   FROM affiliates a
  WHERE (a.profile_id = (select auth.uid())))));
alter policy "affiliate: read own" on public.affiliates
  using ((profile_id = (select auth.uid())));
alter policy "ai_import_log: self read" on public.ai_import_log
  using (((select auth.uid()) = user_id));
alter policy audit_log_select_own_actions on public.audit_log
  using ((actor_id = (select auth.uid())));
alter policy audit_log_select_own_restaurant on public.audit_log
  using (((restaurant_id IS NOT NULL) AND (restaurant_id IN ( SELECT restaurant_memberships.restaurant_id
   FROM restaurant_memberships
  WHERE ((restaurant_memberships.user_id = (select auth.uid())) AND (restaurant_memberships.role = ANY (ARRAY['owner'::member_role, 'manager'::member_role])))))));
alter policy "email_queue: user reads own" on public.email_queue
  using ((user_id = (select auth.uid())));
alter policy "lifecycle_events: admin can read own" on public.lifecycle_events
  using (((user_id = (select auth.uid())) OR ((restaurant_id IS NOT NULL) AND is_admin(restaurant_id))));
alter policy order_feedback_select_own on public.order_feedback
  using ((restaurant_id IN ( SELECT restaurant_memberships.restaurant_id
   FROM restaurant_memberships
  WHERE ((restaurant_memberships.user_id = (select auth.uid())) AND (restaurant_memberships.role = ANY (ARRAY['owner'::member_role, 'manager'::member_role]))))));
alter policy profiles_self_select on public.profiles
  using (((select auth.uid()) = id));
alter policy profiles_self_update on public.profiles
  using (((select auth.uid()) = id))
  with check (((select auth.uid()) = id));
alter policy "push_subs: user manage own" on public.push_subscriptions
  using (((user_id = (select auth.uid())) AND is_member(restaurant_id)))
  with check (((user_id = (select auth.uid())) AND is_member(restaurant_id)));
alter policy reservation_settings_admin on public.reservation_settings
  using ((EXISTS ( SELECT 1
   FROM restaurant_memberships m
  WHERE ((m.restaurant_id = reservation_settings.restaurant_id) AND (m.user_id = (select auth.uid())) AND (m.role = ANY (ARRAY['owner'::member_role, 'manager'::member_role]))))))
  with check ((EXISTS ( SELECT 1
   FROM restaurant_memberships m
  WHERE ((m.restaurant_id = reservation_settings.restaurant_id) AND (m.user_id = (select auth.uid())) AND (m.role = ANY (ARRAY['owner'::member_role, 'manager'::member_role]))))));
alter policy reservations_admin on public.reservations
  using ((EXISTS ( SELECT 1
   FROM restaurant_memberships m
  WHERE ((m.restaurant_id = reservations.restaurant_id) AND (m.user_id = (select auth.uid())) AND (m.role = ANY (ARRAY['owner'::member_role, 'manager'::member_role]))))))
  with check ((EXISTS ( SELECT 1
   FROM restaurant_memberships m
  WHERE ((m.restaurant_id = reservations.restaurant_id) AND (m.user_id = (select auth.uid())) AND (m.role = ANY (ARRAY['owner'::member_role, 'manager'::member_role]))))));
alter policy reservations_waiter_read on public.reservations
  using ((EXISTS ( SELECT 1
   FROM restaurant_memberships m
  WHERE ((m.restaurant_id = reservations.restaurant_id) AND (m.user_id = (select auth.uid())) AND (m.role = 'waiter'::member_role)))));
alter policy reservations_waiter_update on public.reservations
  using (((EXISTS ( SELECT 1
   FROM restaurant_memberships m
  WHERE ((m.restaurant_id = reservations.restaurant_id) AND (m.user_id = (select auth.uid())) AND (m.role = 'waiter'::member_role)))) AND (status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'seated'::text]))))
  with check (((EXISTS ( SELECT 1
   FROM restaurant_memberships m
  WHERE ((m.restaurant_id = reservations.restaurant_id) AND (m.user_id = (select auth.uid())) AND (m.role = 'waiter'::member_role)))) AND (status = ANY (ARRAY['seated'::text, 'no_show'::text, 'completed'::text, 'confirmed'::text]))));
alter policy modules_admin_write on public.restaurant_modules
  using (((EXISTS ( SELECT 1
   FROM restaurant_memberships m
  WHERE ((m.restaurant_id = restaurant_modules.restaurant_id) AND (m.user_id = (select auth.uid())) AND (m.role = ANY (ARRAY['owner'::member_role, 'manager'::member_role]))))) OR (EXISTS ( SELECT 1
   FROM restaurants r
  WHERE ((r.id = restaurant_modules.restaurant_id) AND (r.owner_id = (select auth.uid())))))))
  with check (((EXISTS ( SELECT 1
   FROM restaurant_memberships m
  WHERE ((m.restaurant_id = restaurant_modules.restaurant_id) AND (m.user_id = (select auth.uid())) AND (m.role = ANY (ARRAY['owner'::member_role, 'manager'::member_role]))))) OR (EXISTS ( SELECT 1
   FROM restaurants r
  WHERE ((r.id = restaurant_modules.restaurant_id) AND (r.owner_id = (select auth.uid())))))));
alter policy "table_sessions: staff select" on public.table_sessions
  using ((EXISTS ( SELECT 1
   FROM restaurant_memberships rm
  WHERE ((rm.restaurant_id = table_sessions.restaurant_id) AND (rm.user_id = (select auth.uid()))))));
alter policy "wta: waiter read own" on public.waiter_table_assignments
  using ((user_id = (select auth.uid())));

-- ── §3. Indexuri pe FK-uri ───────────────────────────────────────────────────
create index if not exists affiliate_ledger_payout_id_fkey_idx on public.affiliate_ledger (payout_id);
create index if not exists affiliate_ledger_reverses_ledger_id_fkey_idx on public.affiliate_ledger (reverses_ledger_id);
create index if not exists affiliate_ledger_source_ledger_id_fkey_idx on public.affiliate_ledger (source_ledger_id);
create index if not exists affiliate_touches_referred_profile_id_fkey_idx on public.affiliate_touches (referred_profile_id);
create index if not exists affiliates_parent_affiliate_id_fkey_idx on public.affiliates (parent_affiliate_id);
create index if not exists ai_credit_purchases_restaurant_id_fkey_idx on public.ai_credit_purchases (restaurant_id);
create index if not exists ai_import_log_restaurant_id_fkey_idx on public.ai_import_log (restaurant_id);
create index if not exists cash_movements_fiscal_receipt_id_fkey_idx on public.cash_movements (fiscal_receipt_id);
create index if not exists cash_movements_performed_by_fkey_idx on public.cash_movements (performed_by);
create index if not exists cash_movements_restaurant_id_fkey_idx on public.cash_movements (restaurant_id);
create index if not exists cash_shifts_closed_by_fkey_idx on public.cash_shifts (closed_by);
create index if not exists cash_shifts_opened_by_fkey_idx on public.cash_shifts (opened_by);
create index if not exists cash_shifts_z_receipt_id_fkey_idx on public.cash_shifts (z_receipt_id);
create index if not exists happy_hour_rules_category_id_fkey_idx on public.happy_hour_rules (category_id);
create index if not exists happy_hour_rules_created_by_fkey_idx on public.happy_hour_rules (created_by);
create index if not exists happy_hour_rules_product_id_fkey_idx on public.happy_hour_rules (product_id);
create index if not exists invite_tokens_invited_by_fkey_idx on public.invite_tokens (invited_by);
create index if not exists invoices_created_by_fkey_idx on public.invoices (created_by);
create index if not exists kitchen_tickets_bridge_device_id_fkey_idx on public.kitchen_tickets (bridge_device_id);
create index if not exists loyalty_events_order_id_fkey_idx on public.loyalty_events (order_id);
create index if not exists order_payments_paid_by_fkey_idx on public.order_payments (paid_by);
create index if not exists orders_discount_applied_by_fkey_idx on public.orders (discount_applied_by);
create index if not exists orders_loyalty_wallet_id_fkey_idx on public.orders (loyalty_wallet_id);
create index if not exists orders_paid_by_fkey_idx on public.orders (paid_by);
create index if not exists orders_served_by_fkey_idx on public.orders (served_by);
create index if not exists page_views_product_id_fkey_idx on public.page_views (product_id);
create index if not exists page_views_restaurant_id_fkey_idx on public.page_views (restaurant_id);
create index if not exists pending_receipts_bridge_device_id_fkey_idx on public.pending_receipts (bridge_device_id);
create index if not exists platform_audit_log_actor_user_id_fkey_idx on public.platform_audit_log (actor_user_id);
create index if not exists product_pairings_paired_product_id_fkey_idx on public.product_pairings (paired_product_id);
create index if not exists products_category_id_fkey_idx on public.products (category_id);
create index if not exists purchase_order_items_ingredient_id_fkey_idx on public.purchase_order_items (ingredient_id);
create index if not exists purchase_orders_created_by_fkey_idx on public.purchase_orders (created_by);
create index if not exists purchase_orders_supplier_id_fkey_idx on public.purchase_orders (supplier_id);
create index if not exists qr_scans_restaurant_id_fkey_idx on public.qr_scans (restaurant_id);
create index if not exists reservations_table_id_fkey_idx on public.reservations (table_id);
create index if not exists restaurant_memberships_invited_by_fkey_idx on public.restaurant_memberships (invited_by);
create index if not exists restaurant_modules_configured_by_fkey_idx on public.restaurant_modules (configured_by);
create index if not exists stock_movements_created_by_fkey_idx on public.stock_movements (created_by);
create index if not exists stripe_events_user_id_fkey_idx on public.stripe_events (user_id);
create index if not exists table_sessions_table_id_fkey_idx on public.table_sessions (table_id);
create index if not exists waiter_table_assignments_assigned_by_fkey_idx on public.waiter_table_assignments (assigned_by);
create index if not exists waiter_table_assignments_table_id_fkey_idx on public.waiter_table_assignments (table_id);

-- ── Asserții fail-closed ─────────────────────────────────────────────────────
-- Copia PERMANENTĂ a clichetelor e în tests/sql/advisor_hardening_assertions.sql
-- (rulează la fiecare CI, pe starea FINALĂ a lanțului); aici se evaluează o
-- singură dată, la aplicare — singurul moment în care rulează pe PRODUCȚIE.
do $$
declare
  v_sig  text;
  v_bad  text;
  r      record;
  v_allow constant text[] := array[
    -- bridge (cheia anon + device_secret; bridge/menuvia-bridge.js)
    'bridge_claim_receipt(text,uuid)',
    'bridge_claim_ticket(text,uuid)',
    'bridge_confirm_receipt(text,uuid,boolean,text,text,text)',
    'bridge_confirm_ticket(text,uuid,boolean,text,text)',
    'bridge_get_pending(text)',
    'bridge_get_pending(text,integer)',
    'bridge_get_pending_tickets(text,integer)',
    'bridge_heartbeat(text)',
    'bridge_validate_device(text)',
    -- meniul public / QR / pickup (oaspete fără cont)
    'call_waiter(uuid,text,numeric)',
    'create_order(uuid,text,uuid,uuid,text,jsonb,uuid,timestamp with time zone,text,text,uuid)',
    'get_loyalty_state(uuid,text,text)',
    'get_menu_by_slug(text)',
    'get_menu_for_restaurant(uuid)',
    'get_order_public_status(uuid,uuid)',
    'get_restaurant_by_slug(text)',
    'loyalty_attach_order(uuid,uuid,text,text)',
    'open_table_session(text)',
    'public_happy_hour_now(uuid)',
    'record_page_view(uuid,uuid)',
    'record_qr_scan(uuid,uuid)',
    'request_fiscal_receipt(uuid,uuid)',
    'resolve_qr_menu(text)',
    'resolve_qr_token(text)',
    'submit_order_feedback(uuid,text,integer,text,uuid)',
    -- evaluate în politici RLS pe rolul anon (products/categories/modifier_*/reservation_settings)
    'is_module_enabled(uuid,text)',
    'is_restaurant_active(uuid)',
    'modifier_group_is_published(uuid)',
    -- rezervări publice
    'cancel_reservation_by_code(text,text)',
    'create_reservation_public(text,text,text,smallint,timestamp with time zone,text,text,smallint,text,uuid,uuid)',
    'get_public_floor_plan(text)',
    'get_tables_availability(text,timestamp with time zone,timestamp with time zone,smallint)',
    -- afiliere / white-label / invitații (vizitator nelogat)
    'get_affiliate_program_status()',
    'get_affiliate_public_defaults()',
    'preview_invite(text)',
    'preview_referral(text)',
    'record_affiliate_touch(text,text)',
    'resolve_agency_branding(text)',
    'resolve_referral_code(text)'];
  v_actual text[];
  v_expect text[];
begin
  -- §1. cele 9 revocări + cine își păstrează accesul
  foreach v_sig in array array[
    'public.adjust_stock_manual(uuid,numeric,text)', 'public.receive_purchase_order(uuid)',
    'public.rotate_qr_token(uuid)', 'public.save_floor_layout(uuid,jsonb)',
    'public.resolve_waiter_call(uuid)', 'public.get_order_payments(uuid)',
    'public.check_availability(uuid,timestamptz,timestamptz,smallint,text)'] loop
    if has_function_privilege('anon', v_sig::regprocedure, 'execute') then
      raise exception 'mig 297: % e încă executabilă de anon', v_sig; end if;
    if not has_function_privilege('authenticated', v_sig::regprocedure, 'execute') then
      raise exception 'mig 297: authenticated a pierdut %', v_sig; end if;
  end loop;
  foreach v_sig in array array[
    'public.check_qr_order_rate_limit(uuid)', 'public.check_pickup_order_rate_limit(uuid,text)'] loop
    if has_function_privilege('anon', v_sig::regprocedure, 'execute')
       or has_function_privilege('authenticated', v_sig::regprocedure, 'execute') then
      raise exception 'mig 297: helperul intern % e încă apelabil de un rol client', v_sig; end if;
  end loop;

  -- §1. clasa: DEFINER din public apelabile de anon == allowlist
  -- (`rls_auto_enable` = event-trigger de platformă, există doar pe prod, RP5)
  select coalesce(array_agg(x order by x collate "C"), '{}') into v_actual from (
    select (p.proname || '(' || array_to_string(array(
              select format_type(t.typ, null) from unnest(p.proargtypes::oid[]) with ordinality t(typ, ord)
               order by t.ord), ',') || ')')::text as x
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and has_function_privilege('anon', p.oid, 'execute')
       and p.proname <> 'rls_auto_enable') s;
  select array_agg(x order by x collate "C") into v_expect from unnest(v_allow) x;
  if v_actual is distinct from v_expect then
    raise exception 'mig 297: setul DEFINER anon a derivat. în plus: %; lipsă: %',
      (select array_agg(a) from unnest(v_actual) a where a <> all (v_expect)),
      (select array_agg(e) from unnest(v_expect) e where e <> all (v_actual));
  end if;

  -- §2. fiecare politică rescrisă are EXACT logica de dinainte
  for r in select b.*, pg_get_expr(pol.polqual, pol.polrelid) as q2,
                  pg_get_expr(pol.polwithcheck, pol.polrelid) as w2
             from _m297_policy_before b join pg_policy pol on pol.oid = b.pol_oid loop
    if replace(r.q2, '( SELECT auth.uid() AS uid)', 'auth.uid()') is distinct from r.qual
       or replace(r.w2, '( SELECT auth.uid() AS uid)', 'auth.uid()') is distinct from r.wcheck then
      raise exception 'mig 297: politica "%" pe % și-a schimbat logica (înainte: % / %; după: % / %)',
        r.pol, r.rel, r.qual, r.wcheck, r.q2, r.w2;
    end if;
  end loop;
  if (select count(*) from _m297_policy_before) < 21 then
    raise exception 'mig 297: așteptate ≥21 politici cu auth.uid() direct, găsite % (lanțul a derivat?)',
      (select count(*) from _m297_policy_before);
  end if;

  -- §2. clasa: nicio politică din public nu mai cheamă auth.*() / current_setting() ne-înfășurat
  select string_agg(format('%s.%s', c.relname, pol.polname), ', ') into v_bad
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and regexp_replace(regexp_replace(
           coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
           coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''),
           '\( SELECT auth\.[a-z_]+\(\) AS [a-z_]+\)', '', 'g'),
           '\( SELECT current_setting\([^()]*\) AS [a-z_]+\)', '', 'g')
         ~ '(\mauth\.[a-z_]+\(|\mcurrent_setting\()';
  if v_bad is not null then
    raise exception 'mig 297: politici cu auth.*()/current_setting() ne-înfășurat: %', v_bad;
  end if;

  -- §3. clasa: niciun FK din public fără index care îl acoperă (coloanele
  -- FK-ului = primele coloane ale indexului; parțial doar cu `col IS NOT NULL`)
  select string_agg(c.conname, ', ') into v_bad
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace
   where c.contype = 'f' and n.nspname = 'public'
     and not exists (
       select 1 from pg_index i
        where i.indrelid = c.conrelid and i.indisvalid
          and (select array_agg(i.indkey[g]) from generate_series(0, cardinality(c.conkey) - 1) g) @> c.conkey
          and (select array_agg(i.indkey[g]) from generate_series(0, cardinality(c.conkey) - 1) g) <@ c.conkey
          and (i.indpred is null
               or (cardinality(c.conkey) = 1
                   and pg_get_expr(i.indpred, i.indrelid) = format('(%I IS NOT NULL)',
                         (select attname from pg_attribute where attrelid = c.conrelid and attnum = c.conkey[1])))));
  if v_bad is not null then
    raise exception 'mig 297: FK-uri fără index acoperitor: %', v_bad;
  end if;
end $$;

commit;
