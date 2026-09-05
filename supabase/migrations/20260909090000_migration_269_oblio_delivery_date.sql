-- migration_269_oblio_delivery_date.sql
-- =============================================================================
-- Audit v3 — rangul 14. Două goluri pe lanțul de facturare Oblio, ambele REALE
-- dar LATENTE: tabela `invoices` e GOALĂ în producție (zero facturi emise
-- vreodată), deci se plătesc la PRIMA factură reală, nu repară o pagubă în curs.
--
-- ── (A) `deliveryDate` e ziua EMITERII, nu ziua LIVRĂRII ─────────────────────
-- `composeOblioInvoice` (oblio-generator.js) punea `today` în TOATE cele trei
-- date: issueDate / dueDate / deliveryDate. Data livrării determină
-- EXIGIBILITATEA TVA, deci pe ea se așază factura într-o perioadă fiscală.
-- `bridge_oblio_get_queued` nici măcar nu întorcea `orders.paid_at`, deci
-- funcția n-avea de unde lua data reală.
--
-- Când se rupe:
--   • plată la 23:55, cron la 00:05 → livrarea cade în ZIUA următoare; la 31 ale
--     lunii cade în LUNA următoare → TVA declarat în perioada greșită;
--   • `failed_attempts < 3` + `next_attempt_at` → retry la ore distanță;
--   • mig 218/239: retry MANUAL al fondatorului după verificare la Oblio poate
--     fi la ZILE distanță — atunci deliveryDate e complet greșit.
--
-- `issueDate` NU se atinge (chiar e ziua emiterii) și nici `dueDate` (o dată
-- anterioară lui issueDate poate fi respinsă de Oblio). Se schimbă DOAR
-- deliveryDate, iar clientul îl formatează în Europe/Bucharest — o plată la
-- 00:30 EET e 22:30 UTC în ziua PRECEDENTĂ, deci un `toISOString()` ar muta
-- livrarea cu o zi înapoi exact la comenzile de noapte.
--
-- ── (B) Starea e-Factura se SCRIE, dar nu se citește nicăieri ────────────────
-- `invoices.oblio_einvoice` există din mig 041 și `bridge_oblio_mark_issued` îl
-- populează din răspunsul Oblio — dar `list_invoices_for_restaurant` nu-l
-- proiecta, tipul `Invoice` nu-l avea, iar InvoicesTab nu afișa nimic. Pe o
-- factură B2B, fondatorul nu putea ști dacă e-Factura a ajuns în SPV (obligație
-- legală din 2024). Nu erau date lipsă: erau date capturate și aruncate la UI.
--
-- Se proiectează `has_einvoice boolean`, NU XML-ul: un blob n-are ce căuta
-- într-o listă, iar pentru semnal e nevoie doar de prezență/absență.
--
-- AMBELE RPC-uri își schimbă tipul de RETURN, deci cer DROP + CREATE (un
-- `create or replace` nu poate schimba semnătura de ieșire). Fiecare are UN
-- SINGUR consumator, iar coloanele noi sunt adăugate la FINAL:
--   bridge_oblio_get_queued      → netlify/functions/oblio-generator.js
--   list_invoices_for_restaurant → src/lib/invoices.ts (`listInvoices`)
--
-- Teste permanente OB1–OB6: tests/sql/oblio_delivery_date_assertions.sql.
-- =============================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';

-- ─────────────────────────────────────────────────────────────────────────────
-- (A) bridge_oblio_get_queued — lanț 041→181→239→269
--     Adaugă `order_paid_at`. PĂSTREAZĂ TOATE invariantele lanțului:
--       • claim atomic `for update skip locked` (anti dublă-emitere)
--       • `status='generating'` + `generating_since = now()` (mig 239, altfel
--         `oblio_reclaim_stale_generating` n-are pe ce se baza)
--       • `failed_attempts < 3` și fereastra `next_attempt_at`
--       • join pe `oblio_configs.is_active`
--       • ordine FIFO pe `created_at`
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.bridge_oblio_get_queued(integer);

create function public.bridge_oblio_get_queued(p_limit integer default 10)
returns table (
  invoice_id        uuid,
  restaurant_id     uuid,
  order_id          uuid,
  customer_name     text,
  customer_cif      text,
  customer_address  text,
  customer_email    text,
  customer_phone    text,
  is_b2b            boolean,
  total_with_vat    numeric,
  api_email         text,
  api_secret        text,
  company_cif       text,
  company_name      text,
  default_series    text,
  vat_included      boolean,
  send_email        boolean,
  test_mode         boolean,
  order_paid_at     timestamptz
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
    -- Ziua LIVRĂRII, pentru exigibilitatea TVA. NULL rămâne legitim (comandă
    -- fără paid_at) — clientul cade atunci pe ziua curentă, ca înainte.
    o.paid_at as order_paid_at
  from claimed c
  join public.oblio_configs oc on oc.restaurant_id = c.restaurant_id and oc.is_active
  left join public.orders o on o.id = c.order_id;
$function$;

revoke all on function public.bridge_oblio_get_queued(integer) from public, anon, authenticated;
grant execute on function public.bridge_oblio_get_queued(integer) to service_role;

comment on function public.bridge_oblio_get_queued(integer) is
  'mig 269 (lant 041→181→239→269): claim FIFO de facturi + `order_paid_at` pentru deliveryDate (exigibilitatea TVA se aseaza pe ziua LIVRARII, nu pe cea a emiterii).';

-- ─────────────────────────────────────────────────────────────────────────────
-- (B) list_invoices_for_restaurant — + has_einvoice
--     Gate `is_admin` PĂSTRAT, DEFINER păstrat, ordinea coloanelor vechi
--     NEATINSĂ, coloana nouă la FINAL (clientul face cast, nu validare).
--     NU se proiectează XML-ul `oblio_einvoice` — doar prezența lui.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.list_invoices_for_restaurant(uuid, integer, integer);

create function public.list_invoices_for_restaurant(
  p_restaurant_id uuid,
  p_limit         integer default 50,
  p_offset        integer default 0
)
returns table (
  id             uuid,
  order_id       uuid,
  customer_name  text,
  customer_cif   text,
  is_b2b         boolean,
  total_with_vat numeric,
  oblio_series   text,
  oblio_number   text,
  oblio_link     text,
  status         invoice_status,
  last_error     text,
  issued_at      timestamptz,
  created_at     timestamptz,
  has_einvoice   boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    i.id, i.order_id, i.customer_name, i.customer_cif, i.is_b2b,
    i.total_with_vat, i.oblio_series, i.oblio_number, i.oblio_link,
    i.status, i.last_error, i.issued_at, i.created_at,
    (i.oblio_einvoice is not null and i.oblio_einvoice <> '') as has_einvoice
  from public.invoices i
  where i.restaurant_id = p_restaurant_id
    and public.is_admin(p_restaurant_id)
  order by i.created_at desc
  limit p_limit offset p_offset;
$function$;

revoke all on function public.list_invoices_for_restaurant(uuid, integer, integer) from public, anon;
grant execute on function public.list_invoices_for_restaurant(uuid, integer, integer) to authenticated;

comment on function public.list_invoices_for_restaurant(uuid, integer, integer) is
  'mig 269: + has_einvoice (prezenta XML-ului e-Factura, NU continutul). Gate is_admin pastrat. Coloanele vechi in ordinea veche, cea noua la final.';

-- ═════════════════════════════════════════════════════════════════════════════
-- Asserții fail-closed
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare v_src text; v_cols text[]; v_sig text;
begin
  -- (a) bridge_oblio_get_queued: coloana nouă + TOATE invariantele lanțului.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bridge_oblio_get_queued';
  if v_src is null then
    raise exception 'mig 269: bridge_oblio_get_queued lipseste'; end if;
  foreach v_sig in array array['order_paid_at', 'for update skip locked',
                               'generating_since', 'failed_attempts < 3',
                               'next_attempt_at', 'oc.is_active',
                               'order by i.created_at asc'] loop
    if position(v_sig in v_src) = 0 then
      raise exception 'mig 269: bridge_oblio_get_queued a pierdut invariantul "%"', v_sig; end if;
  end loop;
  if position('security definer' in lower(v_src)) = 0 then
    raise exception 'mig 269: bridge_oblio_get_queued nu mai e DEFINER'; end if;
  if has_function_privilege('authenticated', 'public.bridge_oblio_get_queued(integer)', 'EXECUTE') then
    raise exception 'mig 269: authenticated poate executa claim-ul de facturi (doar service_role)'; end if;
  if not has_function_privilege('service_role', 'public.bridge_oblio_get_queued(integer)', 'EXECUTE') then
    raise exception 'mig 269: service_role NU poate executa claim-ul'; end if;

  -- (b) list_invoices_for_restaurant: contract de coloane + gate + NU expune XML.
  --     Coloanele unui `returns table` NU stau in pg_type/pg_attribute:
  --     `prorettype` e `record`, fara typrelid compozit. Numele sunt parametri
  --     OUT, in `proargnames` filtrat pe `proargmodes = 't'`. Varianta gresita
  --     intoarce NULL — deci asertia pica, nu trece tacut (verificat: chiar a
  --     picat la primul replay).
  select array_agg(u.nm order by u.ord) into v_cols
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace,
    lateral unnest(p.proargnames, p.proargmodes) with ordinality as u(nm, md, ord)
   where n.nspname = 'public' and p.proname = 'list_invoices_for_restaurant'
     and u.md = 't';
  if v_cols is distinct from array['id','order_id','customer_name','customer_cif','is_b2b',
                                   'total_with_vat','oblio_series','oblio_number','oblio_link',
                                   'status','last_error','issued_at','created_at','has_einvoice'] then
    raise exception 'mig 269: contractul de coloane al lui list_invoices_for_restaurant s-a schimbat: %', v_cols; end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'list_invoices_for_restaurant';
  if position('is_admin' in v_src) = 0 then
    raise exception 'mig 269: list_invoices_for_restaurant a pierdut gate-ul is_admin'; end if;
  -- XML-ul NU se proiecteaza: doar prezenta lui. `oblio_einvoice` apare o
  -- singura data, in expresia `is not null` care produce has_einvoice.
  if position('i.oblio_einvoice as' in v_src) > 0 or position('i.oblio_einvoice,' in v_src) > 0 then
    raise exception 'mig 269: XML-ul e-Factura e proiectat in lista (blob inutil pe fir)'; end if;
  if has_function_privilege('anon', 'public.list_invoices_for_restaurant(uuid, integer, integer)', 'EXECUTE') then
    raise exception 'mig 269: anon poate lista facturi'; end if;

  raise notice 'mig 269: deliveryDate din paid_at + has_einvoice OK';
end $$;

commit;
