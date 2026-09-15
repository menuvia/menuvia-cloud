-- migration_276_oblio_receipt_mention.sql
-- =============================================================================
-- Audit v3 — RES-18, jumătatea rămasă DESCHISĂ după mig 269: factura Oblio nu
-- purta NICIO mențiune a bonului fiscal aferent.
--
-- De ce contează: pe Plan 3 fiecare încasare produce un bon fiscal (mig 133/259),
-- iar o factură B2B emisă ULTERIOR pentru aceeași vânzare trebuie să trimită la
-- bon (numărul + ziua tipăririi) — altfel la un control documentele emise din
-- Menuvia nu se leagă între ele, iar aceeași vânzare apare de două ori în
-- evidență (bon + factură) fără puntea care spune că e UNA. `internalNote`
-- purta doar `order:<id>`: un identificator intern, invizibil pe document.
--
-- De unde vine numărul: `bon_number` există într-o SINGURĂ coloană din toată
-- baza — `pending_receipts.bon_number` (mig 275 a înghețat asta: tabela e coada
-- fiscală + JURNAL și nu se șterge cât timp restaurantul există); `orders` NU
-- are coloană de bon. Deci claim-ul de facturi citește de acolo rândul
-- `status = 'success'` al comenzii — cel mai recent după `completed_at`, apoi
-- `created_at`. `bridge_confirm_receipt` (045) cere bon_number la success, deci
-- un success fără bon nu există; filtrul `bon_number is not null` e defensiv.
-- Un rând `error`/`cancelled` mai NOU decât success-ul nu contează: bonul a
-- fost tipărit (OB7 acoperă exact ordinea asta).
--
-- Lanț `bridge_oblio_get_queued`: 041→181→239→269→**276**. Semnătura de
-- INTRARE e neschimbată (integer); tipul de RETURN se schimbă → DROP + CREATE
-- (un `create or replace` nu poate schimba coloanele întoarse). UN singur
-- consumator (netlify/functions/oblio-generator.js), coloanele noi sunt la
-- FINAL: `receipt_bon_number text`, `receipt_completed_at timestamptz`. TOATE
-- invariantele lanțului sunt PĂSTRATE: claim atomic `for update skip locked`,
-- `generating_since` (239), `failed_attempts < 3`, fereastra `next_attempt_at`,
-- `oc.is_active`, FIFO pe `created_at`, `order_paid_at` (269).
--
-- Clientul (oblio-generator.js) scrie mențiunea TIPĂRITĂ `mentions` =
-- „Factura emisă în baza bonului fiscal nr. X din DD.MM.YYYY" (ziua ROMÂNEASCĂ
-- a tipăririi — aceeași capcană de fus ca deliveryDate, mig 269 — și FĂRĂ
-- fallback pe „azi" când data lipsește) și `internalNote` = `order:<id>; bon:X`.
-- Fără bon → payload-ul de dinainte, byte-identic. Ordinea de deploy e LIBERĂ:
-- pe o DB fără 276 coloanele lipsesc din rând → fără mențiune; pe un client
-- vechi cu DB nouă coloanele în plus se ignoră.
--
-- Teste permanente: OB7–OB8 în tests/sql/oblio_delivery_date_assertions.sql;
-- OM1–OM4 în tests/functions/oblio-generator.test.js.
-- =============================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';

drop function if exists public.bridge_oblio_get_queued(integer);

create function public.bridge_oblio_get_queued(p_limit integer default 10)
returns table (
  invoice_id           uuid,
  restaurant_id        uuid,
  order_id             uuid,
  customer_name        text,
  customer_cif         text,
  customer_address     text,
  customer_email       text,
  customer_phone       text,
  is_b2b               boolean,
  total_with_vat       numeric,
  api_email            text,
  api_secret           text,
  company_cif          text,
  company_name         text,
  default_series       text,
  vat_included         boolean,
  send_email           boolean,
  test_mode            boolean,
  order_paid_at        timestamptz,
  receipt_bon_number   text,
  receipt_completed_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $function$
  with claimed as (
    update public.invoices
       set status = 'generating',
           generating_since = now()
     where id in (
       select i.id
       from public.invoices i
       join public.oblio_configs oc
         on oc.restaurant_id = i.restaurant_id
        and oc.is_active = true
       where i.status = 'queued'
         and i.failed_attempts < 3
         and (i.next_attempt_at is null or i.next_attempt_at <= now())
       order by i.created_at asc
       limit p_limit
       for update skip locked
     )
    returning *
  )
  select
    c.id as invoice_id,
    c.restaurant_id, c.order_id,
    c.customer_name, c.customer_cif, c.customer_address, c.customer_email, c.customer_phone,
    c.is_b2b, c.total_with_vat,
    oc.api_email, oc.api_secret, oc.company_cif, oc.company_name,
    oc.default_series, oc.vat_included, oc.send_email, oc.test_mode,
    -- Ziua LIVRĂRII, pentru exigibilitatea TVA (mig 269). NULL rămâne legitim
    -- (comandă fără paid_at) — clientul cade atunci pe ziua curentă, ca înainte.
    o.paid_at as order_paid_at,
    -- Bonul fiscal al comenzii (mig 276): rândul `success` cel mai recent din
    -- pending_receipts — singurul loc din bază care poartă bon_number.
    pr.bon_number   as receipt_bon_number,
    pr.completed_at as receipt_completed_at
  from claimed c
  join public.oblio_configs oc on oc.restaurant_id = c.restaurant_id and oc.is_active
  left join public.orders o on o.id = c.order_id
  left join lateral (
    select r.bon_number, r.completed_at
      from public.pending_receipts r
     where r.order_id = c.order_id
       and r.status = 'success'
       and r.bon_number is not null
     order by r.completed_at desc nulls last, r.created_at desc
     limit 1
  ) pr on true;
$function$;

-- Explicit per rol: pe Supabase default privileges dau EXECUTE direct (mig 274).
revoke all on function public.bridge_oblio_get_queued(integer) from public, anon, authenticated;
grant execute on function public.bridge_oblio_get_queued(integer) to service_role;

comment on function public.bridge_oblio_get_queued(integer) is
  'mig 276 (lant 041→181→239→269→276): claim FIFO de facturi + order_paid_at (deliveryDate, mig 269) + bonul fiscal al comenzii (receipt_bon_number / receipt_completed_at din pending_receipts status=success, cel mai recent) pentru mentiunea TIPARITA pe factura. Coloanele noi sunt la FINAL; singurul consumator e oblio-generator.js.';

-- ═════════════════════════════════════════════════════════════════════════════
-- Verificări ONE-SHOT (poziția 276 din lanț). Permanentele: OB7–OB8.
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare v_src text; v_cols text[]; v_sig text; v_n int;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bridge_oblio_get_queued';
  if v_n <> 1 then
    raise exception 'mig 276: bridge_oblio_get_queued are % semnaturi (asteptat 1 — PGRST203 la orice apel)', v_n; end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bridge_oblio_get_queued';
  foreach v_sig in array array['order_paid_at', 'for update skip locked',
                               'generating_since', 'failed_attempts < 3',
                               'next_attempt_at', 'oc.is_active',
                               'order by i.created_at asc',
                               'public.pending_receipts', 'r.status = ''success''',
                               'r.bon_number is not null',
                               'order by r.completed_at desc nulls last, r.created_at desc'] loop
    if position(v_sig in v_src) = 0 then
      raise exception 'mig 276: bridge_oblio_get_queued a pierdut invariantul "%"', v_sig; end if;
  end loop;
  if position('security definer' in lower(v_src)) = 0 then
    raise exception 'mig 276: bridge_oblio_get_queued nu mai e DEFINER'; end if;

  -- Coloanele unui `returns table` sunt parametri OUT (proargmodes = 't'),
  -- NU pg_attribute (capcana de catalog din mig 269).
  select array_agg(u.nm order by u.ord) into v_cols
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
    lateral unnest(p.proargnames, p.proargmodes) with ordinality as u(nm, md, ord)
   where n.nspname = 'public' and p.proname = 'bridge_oblio_get_queued' and u.md = 't';
  if array_length(v_cols, 1) <> 21
     or v_cols[1]  is distinct from 'invoice_id'
     or v_cols[19] is distinct from 'order_paid_at'
     or v_cols[20] is distinct from 'receipt_bon_number'
     or v_cols[21] is distinct from 'receipt_completed_at' then
    raise exception 'mig 276: contractul de coloane al claim-ului s-a schimbat: %', v_cols; end if;

  if has_function_privilege('authenticated', 'public.bridge_oblio_get_queued(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.bridge_oblio_get_queued(integer)', 'EXECUTE') then
    raise exception 'mig 276: un rol client poate executa claim-ul de facturi (doar service_role)'; end if;
  if not has_function_privilege('service_role', 'public.bridge_oblio_get_queued(integer)', 'EXECUTE') then
    raise exception 'mig 276: service_role NU poate executa claim-ul'; end if;

  raise notice 'MIG276 OK: claim-ul poarta bonul fiscal (permanentele: OB7-OB8, OM1-OM4)';
end $$;

commit;
