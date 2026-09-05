-- migration_268_daily_payments_rpc.sql
-- =============================================================================
-- Reziduul de PERFORMANȚĂ al mig 267, găsit de echipa roșie DUPĂ merge și
-- măsurat independent înainte de a scrie codul ăsta.
--
-- PROBLEMA: `v_daily_payments_by_method` grupează pe o EXPRESIE
-- (`date_trunc('day', paid_at at time zone 'Europe/Bucharest')::date`), iar
-- ReportsTab filtrează pe acea cheie calculată (`day >= ... and day <= ...`).
-- Un predicat pe o coloană derivată NU e sargabil: planificatorul nu poate
-- folosi niciun index pe `paid_at`, deci agregă TOT istoricul restaurantului și
-- abia apoi aruncă ce nu intră în fereastră. Indexul construit exact pentru asta
-- — `orders (restaurant_id, paid_at) WHERE status='paid'` (mig 244) — rămâne
-- nefolosit.
--
-- MĂSURAT pe cluster propriu (80.053 comenzi, 8 restaurante, 400 de zile de
-- istoric, fereastră de 30 de zile pe UN restaurant):
--
--   forma actuală (filtru pe `day`):
--     Bitmap Index Scan on orders_restaurant_created_idx → actual rows=10000
--     (tot istoricul restaurantului), 1466 shared hits, 10,159 ms
--   forma sargabilă (filtru pe `paid_at`):
--     Bitmap Index Scan on orders_paid_at_idx → actual rows=600
--     (exact fereastra cerută), 1,244 ms
--
-- 8,2× la volumul ăsta — dar factorul nu e miezul. PANTA e: forma veche crește
-- cu istoricul TOTAL, cea nouă cu fereastra CERUTĂ. La 10× date, prima e 10×
-- mai lentă, a doua neschimbată. Pe producție (53 de comenzi) AMBELE dau Seq
-- Scan — tabelul e prea mic pentru orice index — de aceea măsurarea s-a făcut
-- pe date seed, nu pe prod: un EXPLAIN pe prod ar fi „dovedit" fals că nu e nimic.
--
-- SECURITY INVOKER deliberat (aceeași logică ca `get_database_size`, mig 266):
-- `v_order_payment_methods` e deja security_invoker ȘI poartă gate-ul fiscal
-- (semi-join pe `restaurant_has_feature`), deci RLS-ul de pe orders/
-- order_payments se aplică natural prin ea. DEFINER ar fi escaladare inutilă ȘI
-- m-ar obliga să re-implementez gate-ul aici — adică exact tiparul care a produs
-- gate-ul mort din 267.
--
-- View-ul `v_daily_payments_by_method` RĂMÂNE: e util pentru interogări ad-hoc
-- și pentru orice consumator care nu are un interval. RPC-ul e calea rapidă,
-- nu un înlocuitor.
--
-- PARAMETRI NULL / INTERVAL INVERSAT: RPC-ul intoarce ZERO randuri, nu o eroare.
-- E semantica SQL normala (orice comparatie cu NULL da NULL, deci randul e
-- exclus) si e IDENTICA cu ce face view-ul filtrat pe `day`, deci nu introduce
-- o divergenta. Nu se ridica exceptie DELIBERAT: `raise` ar cere plpgsql, iar
-- asta pierde inlining-ul functiilor SQL si schimba calea de executie — adica
-- exact planul pe care migratia asta il repara si l-a masurat. Consecinta e
-- caracterizata de DP7, ca o schimbare viitoare sa fie o decizie, nu un accident.
-- Apelantul (ReportsTab) trimite mereu date validate din `periodRange`.
--
-- Teste permanente DP1–DP7: tests/sql/daily_payments_rpc_assertions.sql.
-- =============================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';

create or replace function public.get_daily_payments_by_method(
  p_restaurant_id uuid,
  p_from          date,
  p_to            date
)
returns table (
  day             date,
  cash_revenue    numeric,
  card_revenue    numeric,
  voucher_revenue numeric,
  online_revenue  numeric,
  other_revenue   numeric,
  total_revenue   numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select (date_trunc('day', (m.paid_at at time zone 'Europe/Bucharest')))::date as day,
         coalesce(sum(m.amount) filter (where m.method = 'cash'), 0::numeric)         as cash_revenue,
         coalesce(sum(m.amount) filter (where m.method = 'card_pos'), 0::numeric)     as card_revenue,
         coalesce(sum(m.amount) filter (where m.method = 'meal_voucher'), 0::numeric) as voucher_revenue,
         coalesce(sum(m.amount) filter (where m.method = 'card_online'), 0::numeric)  as online_revenue,
         coalesce(sum(m.amount) filter (where m.method not in
                    ('cash','card_pos','meal_voucher','card_online')), 0::numeric)    as other_revenue,
         coalesce(sum(m.amount), 0::numeric)                                          as total_revenue
    from public.v_order_payment_methods m
   where m.restaurant_id = p_restaurant_id
     and m.status = 'paid'::order_status
     -- SARGABIL: interval pe `paid_at`, nu pe cheia de GROUP BY calculată.
     -- Jumătate-deschis la dreapta (`< p_to + 1 zi`), ca ultima secundă a
     -- ultimei zile să intre fără să depindem de precizia timestamp-ului.
     and m.paid_at >= (p_from::timestamp at time zone 'Europe/Bucharest')
     and m.paid_at <  ((p_to + 1)::timestamp at time zone 'Europe/Bucharest')
   group by 1;
$$;

comment on function public.get_daily_payments_by_method(uuid, date, date) is
  'mig 268: defalcarea zilnica pe metoda pentru un interval, cu filtru SARGABIL pe paid_at (view-ul filtreaza pe cheia de GROUP BY calculata → niciun index folosibil). INVOKER: RLS + gate fiscal vin din v_order_payment_methods.';

revoke all on function public.get_daily_payments_by_method(uuid, date, date) from public, anon;
grant execute on function public.get_daily_payments_by_method(uuid, date, date) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- Asserții fail-closed
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare v_oid oid; v_secdef boolean; v_cfg text; v_src text;
begin
  select p.oid, p.prosecdef, array_to_string(p.proconfig, ','), pg_get_functiondef(p.oid)
    into v_oid, v_secdef, v_cfg, v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_daily_payments_by_method';
  if v_oid is null then
    raise exception 'mig 268: get_daily_payments_by_method lipseste'; end if;

  -- (a) INVOKER, nu DEFINER: gate-ul fiscal si RLS vin din sursa unica. Un
  --     DEFINER ar trebui sa le re-implementeze aici — exact tiparul care a
  --     produs gate-ul MORT reparat in 267.
  if v_secdef then
    raise exception 'mig 268: RPC-ul a devenit SECURITY DEFINER — ar ocoli RLS-ul si gate-ul fiscal mostenite din v_order_payment_methods'; end if;

  -- (b) Igiena de search_path (mig 194/262).
  if v_cfg is null or position('pg_temp' in v_cfg) = 0 then
    raise exception 'mig 268: RPC fara pg_temp in search_path'; end if;

  -- (c) Suprafata: banii nu ajung la anon.
  if has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception 'mig 268: anon poate executa RPC-ul de bani'; end if;
  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'mig 268: authenticated NU poate executa RPC-ul'; end if;

  -- (d) Derivarea din sursa unica — daca o pierde, pierde SI gate-ul fiscal.
  if position('v_order_payment_methods' in v_src) = 0 then
    raise exception 'mig 268: RPC-ul nu mai deriva din v_order_payment_methods (si-ar pierde gate-ul fiscal)'; end if;

  -- (e) MOTIVUL EXISTENTEI acestui RPC: filtrul e SARGABIL, pe `paid_at`.
  --     Daca o recreare viitoare filtreaza iar pe cheia de GROUP BY calculata,
  --     RPC-ul devine identic cu view-ul si nu mai are rost.
  if position('m.paid_at >=' in v_src) = 0 or position('m.paid_at <' in v_src) = 0 then
    raise exception 'mig 268: filtrul nu mai e pe paid_at — predicatul redevine nesargabil si indexul din mig 244 ramane nefolosit'; end if;
  if position('date_trunc' in v_src) > 0 and position('date_trunc(''day'', (m.paid_at' in v_src) = 0 then
    raise exception 'mig 268: forma zilei s-a schimbat — trebuie sa ramana identica cu v_daily_payments_by_method'; end if;

  raise notice 'mig 268: get_daily_payments_by_method OK (INVOKER, sargabil pe paid_at, authenticated exclusiv)';
end $$;

commit;
