-- migration_267_payments_by_method.sql
-- =============================================================================
-- Audit v3 — rangul 10: defalcarea pe metodă de plată minte la SPLIT.
--
-- PREMISA, MĂSURATĂ PE PRODUCȚIE ÎNAINTE DE A SCRIE COD (4 sept 2026):
--
--   | Metodă   | Adevăr (order_payments) | Ce arătau rapoartele | Eroare  |
--   |----------|-------------------------|----------------------|---------|
--   | card_pos | 41.00                   | 0                    | −41.00  |
--   | cash     | 47.00                   | 0                    | −47.00  |
--   | other    | 0                       | 88.00                | +88.00  |
--
-- CAUZA: `orders.payment_method` e UN SINGUR enum per comandă. Când o comandă
-- se încasează din mai multe metode (split pe itemi mig 229, parțiale mig 017/
-- 111/231, online + rest cash), `advance_order` scrie `'other'` — corect ca
-- etichetă a comenzii, dar CATASTROFAL ca sursă pentru defalcare: TOȚI banii
-- dintr-un split dispar din cash/card/tichete și apar într-o găleată „Alte
-- metode" care nu se poate reconcilia cu nimic. Operatorul care numără sertarul
-- seara sau decontează tichetele cu Edenred nu are cifra reală.
--
-- Registrul `order_payments` ȘTIE adevărul (o linie per încasare, cu metodă).
-- Nimeni nu-l citea pentru rapoarte: ReportsTab bucketa pe `orders.payment_method`
-- în browser, iar AnalyticsTab pe coloanele pre-agregate din `v_daily_orders`,
-- care filtrau pe ACELAȘI enum. Două tab-uri, aceeași minciună.
--
-- CE FACE MIGRAȚIA
--   1. `v_order_payment_methods` — SURSA UNICĂ: o linie per (comandă, metodă),
--      cu suma reală. Două ramuri:
--        A. comenzi CU registru → `sum(order_payments.amount)` grupat pe metodă;
--        B. comenzi FĂRĂ registru → `orders.payment_method` + `paid_amount`.
--      Ramura B NU e opțională: în producție 23 din 25 de comenzi plătite nu au
--      niciun rând în `order_payments` (istoric dinaintea registrului). Un view
--      care ar citi doar registrul ar raporta 88 lei în loc de 1415.50.
--   2. `v_daily_payments_by_method` — agregatul zilnic pe `paid_at` (momentul
--      ÎNCASĂRII, ca ReportsTab), pentru defalcarea din rapoarte.
--   3. `v_daily_orders` (lanț 007→022→116→159→232→253→263→**267**) — cele cinci
--      coloane de metodă se derivă acum din sursa unică, nu din enum. NUMELE și
--      ORDINEA coloanelor rămân IDENTICE, deci AnalyticsTab (`select('*')`) se
--      repară fără nicio schimbare de frontend.
--
-- INVARIANTUL CARE ÎNCHIDE BUCLA: pentru orice zi/restaurant,
--   cash + card + voucher + online + other  ==  revenue.
-- E garantat de mig 264 (`paid_amount == sum(order_payments)` pe ramura cu
-- registru, cu toleranța de 0.01) și prin construcție pe ramura fără registru.
-- Fără el, defalcarea ar putea „pierde" bani exact ca înainte, doar altfel.
--
-- BACȘIȘUL nu apare nicăieri aici, deliberat: mig 262 l-a scos din `paid_amount`
-- ȘI din `order_payments` (trăiește doar în `orders.tips_amount`). Ambele ramuri
-- îl exclud, deci defalcarea rămâne pe banii bonului. (Decizia deschisă despre
-- bacșișul din sertar — `cash_collected_for_shift` — e separată și e a fondatorului.)
--
-- GATE FISCAL ca SEMI-JOIN pe toate cele trei view-uri, identic cu mig 263:
-- banii sunt Plan 3 (regula de aur), iar semi-join-ul a fost măsurat 43× mai
-- rapid decât predicatul per-rând. `security_invoker = true` peste tot (mig 125):
-- RLS-ul de pe `orders`/`order_payments` decide ce vede fiecare membru.
--
-- Teste permanente PM1–PM9: tests/sql/payments_by_method_assertions.sql.
-- =============================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. RLS pe `order_payments` — ALINIERE CU FUNELUL DE AUTORIZARE
--
-- Fără asta, tot restul migrației e inert exact pe ecranul fondatorului.
--
-- `orders: members read` folosește `public.is_member()`, care are DOUĂ escape-uri
-- (`or is_platform_admin()` mig 186, `or has_partner_access()` mig 187).
-- `order_payments: member read` (mig 017, nerevizuită de atunci) NU folosește
-- funelul: inline-ază un `exists` pe `restaurant_memberships` cu `rm.user_id =
-- auth.uid()`, deci cere o membership REALĂ și nu are niciun escape.
--
-- Sub `security_invoker = true` asimetria e fatală și TĂCUTĂ: un fondator în
-- mod founder-view (RestaurantContext injectează o membership SINTETICĂ, fără
-- rând în tabel) sau un partener VEDE comenzile, dar vede ZERO rânduri de
-- `order_payments`. Deci ramura A nu întoarce nimic, anti-join-ul din ramura B
-- devine adevărat pentru FIECARE comandă, iar view-ul degradează exact la
-- clasificarea pe `orders.payment_method` pe care migrația asta există ca s-o
-- omoare. Reprodus pe replay:
--     owner / waiter        → cash 47.00  card 41.00  alte  0.00
--     fondator / partener   → cash  0.00  card  0.00  alte 88.00
-- Totalurile reconciliază în ambele cazuri (88 = 88), deci NICIO asserție de
-- reconciliere nu poate prinde clasa asta — fondatorul ar fi văzut fix cifra
-- greșită pe singura suprafață unde auditează numerele clienților.
--
-- `to authenticated` explicit (disciplina mig 262): `anon` NU are SELECT pe
-- `order_payments`, deci nu se declanșează nici clasa de asserții din mig 264
-- (politică pe rolul PUBLIC care apelează funelul, pe un tabel citibil de anon).
-- Nu se expune nicio clasă nouă de date: fondatorul/partenerul citesc deja
-- `orders.paid_amount` prin aceleași escape-uri.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "order_payments: member read" on public.order_payments;
create policy "order_payments: member read"
  on public.order_payments
  for select
  to authenticated
  using (
    exists (
      select 1 from public.orders o
       where o.id = order_payments.order_id
         and public.is_member(o.restaurant_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SURSA UNICĂ: o linie per (comandă, metodă)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.v_order_payment_methods
with (security_invoker = true) as
  -- Ramura A — comenzi CU registru de plăți. Adevărul.
  select o.restaurant_id,
         o.id                     as order_id,
         o.status,
         o.created_at,
         o.paid_at,
         op.method::text          as method,
         sum(op.amount)::numeric  as amount,
         true                     as from_ledger
    from public.orders o
    join public.order_payments op on op.order_id = o.id
   where o.status <> 'cancelled'::order_status
     and o.restaurant_id in (select r.id from public.restaurants r
                              where public.restaurant_has_feature(r.id, 'fiscal_receipt'))
   group by o.restaurant_id, o.id, o.status, o.created_at, o.paid_at, op.method
  union all
  -- Ramura B — comenzi FĂRĂ registru (istoric). Enum-ul e singura sursă
  -- disponibilă, dar aici NU minte: fără split, metoda comenzii E metoda plății.
  --
  -- `coalesce(o.paid_amount, o.total)` NU e cosmetic: o comandă `paid` cu
  -- `paid_amount` NULL exista înainte de mig 264 (`mark_paid` accepta suma
  -- lipsă) și e producibilă ȘI AZI printr-un PATCH direct pe PostgREST sub
  -- politica `orders: admin all`. Cu guardul vechi (`paid_amount is not null`)
  -- o astfel de comandă nu apărea în NICIUNA dintre ramuri, deci dispărea din
  -- defalcare — dar ReportsTab o număra în venit (`paid_amount ?? total`), deci
  -- găleţile încetau să închidă cu titlul de deasupra lor. Bucketarea VECHE,
  -- client-side, partiționa exact aceeași valoare, deci închidea mereu: ar fi
  -- fost o REGRESIE introdusă chiar de fix. Găsit de echipa roșie, reprodus pe
  -- replay; în producție azi sunt 0 astfel de rânduri (deci latent, nu activ).
  select o.restaurant_id,
         o.id,
         o.status,
         o.created_at,
         o.paid_at,
         coalesce(o.payment_method::text, 'other'),
         coalesce(o.paid_amount, o.total)::numeric,
         false
    from public.orders o
   where o.status <> 'cancelled'::order_status
     and (o.paid_amount is not null or o.status = 'paid'::order_status)
     and not exists (select 1 from public.order_payments op where op.order_id = o.id)
     and o.restaurant_id in (select r.id from public.restaurants r
                              where public.restaurant_has_feature(r.id, 'fiscal_receipt'));

comment on view public.v_order_payment_methods is
  'mig 267: sursa UNICĂ pentru defalcarea pe metodă — o linie per (comandă, metodă). Ramura A din order_payments (adevărul la split), ramura B din orders.payment_method pentru comenzile fără registru. Gate fiscal + security_invoker.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Agregatul zilnic pe `paid_at` (ce consumă ReportsTab)
--    Ziua e ziua ÎNCASĂRII: o comandă deschisă ieri și plătită azi e venit de
--    azi. Aceeași convenție ca ReportsTab și `admin_monthly_benchmark` (mig 237).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.v_daily_payments_by_method
with (security_invoker = true) as
  select m.restaurant_id,
         (date_trunc('day', (m.paid_at at time zone 'Europe/Bucharest')))::date as day,
         coalesce(sum(m.amount) filter (where m.method = 'cash'), 0::numeric)         as cash_revenue,
         coalesce(sum(m.amount) filter (where m.method = 'card_pos'), 0::numeric)     as card_revenue,
         coalesce(sum(m.amount) filter (where m.method = 'meal_voucher'), 0::numeric) as voucher_revenue,
         coalesce(sum(m.amount) filter (where m.method = 'card_online'), 0::numeric)  as online_revenue,
         -- Tot ce nu e una din cele patru metode cunoscute. Cu găleata asta
         -- defalcarea ÎNCHIDE cu `total_revenue`, deci reconcilierea de seară
         -- e completă (aceeași disciplină ca `other_revenue` din mig 263).
         coalesce(sum(m.amount) filter (where m.method not in
                    ('cash','card_pos','meal_voucher','card_online')), 0::numeric)    as other_revenue,
         coalesce(sum(m.amount), 0::numeric)                                          as total_revenue
    from public.v_order_payment_methods m
   where m.status = 'paid'::order_status
     and m.paid_at is not null
   group by m.restaurant_id, (date_trunc('day', (m.paid_at at time zone 'Europe/Bucharest')))::date;

comment on view public.v_daily_payments_by_method is
  'mig 267: defalcarea zilnică pe metodă, din v_order_payment_methods. Ziua = ziua ÎNCASĂRII (paid_at, Europe/Bucharest), ca ReportsTab. Suma coloanelor == total_revenue prin construcție.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. v_daily_orders (lanț 007→022→116→159→232→253→263→267)
--    NUMELE și ORDINEA coloanelor rămân IDENTICE — AnalyticsTab face `select('*')`.
--    Se schimbă DOAR sursa celor cinci coloane de metodă: sursa unică, nu enum.
--    `revenue`, `total_orders`, `qr_orders`, `waiter_orders` sunt NEATINSE.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.v_daily_orders
with (security_invoker = true) as
  select o.restaurant_id,
     date_trunc('day'::text, (o.created_at AT TIME ZONE 'Europe/Bucharest'::text))::date AS day,
     count(*) AS total_orders,
     count(*) FILTER (WHERE o.source = 'qr'::order_source) AS qr_orders,
     count(*) FILTER (WHERE o.source = 'waiter'::order_source) AS waiter_orders,
     -- `revenue` se calculează din ACELEAȘI găleți, nu din `orders.paid_amount`:
     -- așa reconcilierea „cash+card+tichete+online+alte == revenue" devine o
     -- TAUTOLOGIE, nu o asserție care poate pica pe date anormale. Pentru datele
     -- conforme (mig 264: `paid_amount == sum(order_payments)`) valoarea e
     -- IDENTICĂ cu cea de dinainte — se schimbă doar pe rândurile pe care vechea
     -- formulă le lăsa nedistribuite, și acolo noua valoare e cea corectă.
     COALESCE(sum(pm.cash_amount + pm.card_amount + pm.voucher_amount
                  + pm.online_amount + pm.other_amount)
              FILTER (WHERE o.status = 'paid'::order_status), 0::numeric) AS revenue,
     -- Cele cinci găleți vin din SURSA UNICĂ (mig 267). Înainte filtrau pe
     -- `orders.payment_method`, deci orice comandă cu split (enum `'other'`)
     -- muta TOȚI banii în „Alte metode" — 88 lei clasificați greșit chiar și
     -- pe volumul mic din producție la data migrației.
     COALESCE(sum(pm.cash_amount)    FILTER (WHERE o.status = 'paid'::order_status), 0::numeric) AS cash_revenue,
     COALESCE(sum(pm.card_amount)    FILTER (WHERE o.status = 'paid'::order_status), 0::numeric) AS card_revenue,
     COALESCE(sum(pm.voucher_amount) FILTER (WHERE o.status = 'paid'::order_status), 0::numeric) AS voucher_revenue,
     COALESCE(sum(pm.online_amount)  FILTER (WHERE o.status = 'paid'::order_status), 0::numeric) AS online_revenue,
     COALESCE(sum(pm.other_amount)   FILTER (WHERE o.status = 'paid'::order_status), 0::numeric) AS other_revenue
    from public.orders o
    -- JOIN NEcorelat, deliberat: sursa unică se scanează O DATĂ și se
    -- hash-agregă pe comandă. Un `left join lateral` peste același view ar fi
    -- re-evaluat gate-ul fiscal și anti-join-ul din ramura B pentru FIECARE
    -- comandă — exact tiparul per-rând pe care mig 253/263 l-au scos (43× mai
    -- lent măsurat). Orice recreare păstrează forma asta.
    -- `restaurant_id` E OBLIGATORIU în select/group by ȘI în condiția de join.
    -- Fără el subquery-ul nu expune nicio coloană pe care planificatorul să
    -- împingă filtrul exterior, deci agregă TOT istoricul TUTUROR restaurantelor
    -- fiscale și abia apoi face hash join. Măsurat pe 100k comenzi, fereastră de
    -- 30 de zile pe UN restaurant: 86 ms (forma 263) → 1369 ms fără
    -- `restaurant_id` → 382 ms cu el; pe calea FONDATORULUI (nelimitat de RLS
    -- prin `is_platform_admin`) 83 ms → 6.6 s → 390 ms. Cu RLS ocolit complet,
    -- 9.3 ms → 228 ms → 42.5 ms, deci ~24× vine din FORMA join-ului, nu din
    -- costul funelului. Agregatele sunt neschimbate (`restaurant_id` e
    -- funcțional dependent de `order_id`), doar predicatul devine împingibil:
    -- subquery-ul scade de la 97.006 la 12.000 de rânduri agregate.
    left join (
      select m.restaurant_id, m.order_id,
             coalesce(sum(m.amount) filter (where m.method = 'cash'), 0::numeric)         as cash_amount,
             coalesce(sum(m.amount) filter (where m.method = 'card_pos'), 0::numeric)     as card_amount,
             coalesce(sum(m.amount) filter (where m.method = 'meal_voucher'), 0::numeric) as voucher_amount,
             coalesce(sum(m.amount) filter (where m.method = 'card_online'), 0::numeric)  as online_amount,
             coalesce(sum(m.amount) filter (where m.method not in
                        ('cash','card_pos','meal_voucher','card_online')), 0::numeric)    as other_amount
        from public.v_order_payment_methods m
       group by m.restaurant_id, m.order_id
    ) pm on pm.order_id = o.id and pm.restaurant_id = o.restaurant_id
   where o.status <> 'cancelled'::order_status
     and o.restaurant_id IN (SELECT r.id FROM public.restaurants r
                              WHERE public.restaurant_has_feature(r.id, 'fiscal_receipt'))
   group by o.restaurant_id, (date_trunc('day'::text, (o.created_at AT TIME ZONE 'Europe/Bucharest'::text))::date);

comment on view public.v_daily_orders is
  'mig 267: coloanele de metodă vin din v_order_payment_methods (registrul de plăți), nu din orders.payment_method — un split nu mai colapsează în „Alte metode". Nume + ordine de coloane NEATINSE (AnalyticsTab face select(*)).';

-- ─────────────────────────────────────────────────────────────────────────────
-- Grant-uri: paritate EXACTĂ cu v_daily_orders — doar `authenticated`.
-- Banii nu au ce căuta pe suprafața anon (regula de aur), iar RLS-ul de sub
-- security_invoker restrânge oricum la membrii restaurantului.
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on public.v_order_payment_methods   from anon;
revoke all on public.v_daily_payments_by_method from anon;
grant select on public.v_order_payment_methods    to authenticated;
grant select on public.v_daily_payments_by_method to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- Asserții fail-closed
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_def text; v_name text; v_cols text[]; v_expected text[];
  v_chk  text;
  v_bad  record;
begin
  -- (a) Cele trei view-uri există și sunt security_invoker (mig 125).
  foreach v_name in array array['v_order_payment_methods',
                                'v_daily_payments_by_method',
                                'v_daily_orders'] loop
    if to_regclass('public.' || v_name) is null then
      raise exception 'mig 267: view-ul % lipsește', v_name; end if;
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = v_name
         and 'security_invoker=true' = any(c.reloptions)) then
      raise exception 'mig 267: % NU e security_invoker (RLS-ul ar fi ocolit)', v_name; end if;

    -- (b) Gate fiscal prezent în toate trei (regula de aur: banii = Plan 3).
    v_def := lower(pg_get_viewdef(('public.' || v_name)::regclass, true));
    if v_name = 'v_daily_payments_by_method' then
      -- Îl moștenește din sursa unică; nu-l repetă.
      null;
    elsif position('restaurant_has_feature' in v_def) = 0 then
      raise exception 'mig 267: % a pierdut gate-ul fiscal', v_name; end if;
  end loop;

  -- (c) Sursa unică păstrează AMBELE ramuri. Fără ramura B (comenzi fără
  --     registru) defalcarea ar pierde 94% din venitul istoric — verificat pe
  --     producție: 23 din 25 de comenzi plătite nu au rânduri în order_payments.
  v_def := lower(pg_get_viewdef('public.v_order_payment_methods'::regclass, true));
  if position('union all' in v_def) = 0 then
    raise exception 'mig 267: v_order_payment_methods a pierdut UNION ALL (ramura de fallback)'; end if;
  if position('order_payments' in v_def) = 0 then
    raise exception 'mig 267: v_order_payment_methods nu mai citește order_payments (ramura A)'; end if;
  if position('payment_method' in v_def) = 0 then
    raise exception 'mig 267: v_order_payment_methods nu mai citește orders.payment_method (ramura B)'; end if;

  -- (d) v_daily_orders se hrănește din sursa unică, NU din enum-ul comenzii.
  --     Asta e regresia de păzit: revenirea la `payment_method = 'cash'` ca
  --     filtru readuce exact bug-ul de 88 lei.
  v_def := lower(pg_get_viewdef('public.v_daily_orders'::regclass, true));
  if position('v_order_payment_methods' in v_def) = 0 then
    raise exception 'mig 267: v_daily_orders nu mai citește sursa unică'; end if;
  if position('payment_method = ''cash''' in v_def) > 0
     or position('payment_method = ''card_pos''' in v_def) > 0 then
    raise exception 'mig 267: v_daily_orders bucketează iar pe orders.payment_method (split-urile cad în „Alte metode")'; end if;
  -- Forma NEcorelată: un `lateral` peste sursa unică readuce costul per-rând.
  if position('lateral' in v_def) > 0 then
    raise exception 'mig 267: v_daily_orders a primit un LATERAL peste sursa unică (cost per-rând, mig 253/263)'; end if;
  -- ...dar NEcorelat NU e suficient: fără `restaurant_id` în subquery ȘI în
  -- condiția de join, filtrul exterior nu se poate împinge și subquery-ul agregă
  -- TOATE restaurantele (măsurat: 6.6 s pe calea fondatorului la 100k comenzi).
  if position('pm.restaurant_id = o.restaurant_id' in v_def) = 0
     and position('pm.restaurant_id' in v_def) = 0 then
    raise exception 'mig 267: join-ul cu sursa unică nu mai poartă restaurant_id — filtrul nu se împinge, se agregă tot istoricul'; end if;

  -- (e) Contractul de coloane al lui v_daily_orders: AnalyticsTab face
  --     `select('*')`, deci NUMELE și ORDINEA sunt API public.
  select array_agg(a.attname::text order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = 'public.v_daily_orders'::regclass and a.attnum > 0 and not a.attisdropped;
  v_expected := array['restaurant_id','day','total_orders','qr_orders','waiter_orders',
                      'revenue','cash_revenue','card_revenue','voucher_revenue',
                      'online_revenue','other_revenue'];
  if v_cols is distinct from v_expected then
    raise exception 'mig 267: v_daily_orders și-a schimbat coloanele: % (așteptat %)', v_cols, v_expected; end if;

  -- (f) Suprafață: banii nu ajung la anon.
  foreach v_name in array array['v_order_payment_methods','v_daily_payments_by_method'] loop
    if has_table_privilege('anon', ('public.' || v_name)::regclass, 'SELECT') then
      raise exception 'mig 267: anon poate citi % (bani pe suprafața publică)', v_name; end if;
    if not has_table_privilege('authenticated', ('public.' || v_name)::regclass, 'SELECT') then
      raise exception 'mig 267: authenticated NU poate citi %', v_name; end if;
  end loop;

  -- (g) RECONCILIEREA, pe datele REALE din baza în care rulează migrația:
  --     cash + card + tichete + online + alte  ==  revenue, pentru fiecare
  --     zi/restaurant. Toleranță 0.01/comandă (plafoanele over/underpayment din
  --     mig 264 admit atâta), aproximată generos cu 0.01 * total_orders.
  --     În CI baza e goală, deci e vacuu-adevărată; pe producție e testul real.
  select * into v_bad from (
    select d.restaurant_id, d.day, d.revenue, d.total_orders,
           (d.cash_revenue + d.card_revenue + d.voucher_revenue
            + d.online_revenue + d.other_revenue) as breakdown
      from public.v_daily_orders d
  ) x
   where abs(x.breakdown - x.revenue) > 0.01 * greatest(x.total_orders, 1)
   limit 1;
  if found then
    raise exception 'mig 267: defalcarea nu închide cu venitul (restaurant %, ziua %): % vs %',
      v_bad.restaurant_id, v_bad.day, v_bad.breakdown, v_bad.revenue; end if;

  -- (h) CLICHET pe taxonomia de metode. Găleata `other_revenue` prinde tot ce
  --     nu e una din cele patru cunoscute, deci o METODĂ NOUĂ (a șasea) ar fi
  --     înghițită TĂCUT acolo — exact regresia CA-02/MF-12, care a cerut o dată
  --     bucket-ul `online_revenue`. Dacă enum-ul `payment_method` sau CHECK-ul
  --     de pe `order_payments.method` cresc, asta pică și forțează sweep-ul pe
  --     TOATE defalcările (ReportsTab StatCard+CSV+PDF, AnalyticsTab,
  --     CashRegisterTab, v_daily_orders, v_daily_payments_by_method).
  if (select array_agg(e::text order by e::text)
        from unnest(enum_range(null::payment_method)) e)
     is distinct from array['card_online','card_pos','cash','meal_voucher','other'] then
    raise exception 'mig 267: enum-ul payment_method s-a schimbat — adaugă găleata nouă în TOATE defalcările înainte'; end if;
  -- Ramura A bucketează pe `order_payments.method`, care e TEXT cu CHECK, NU pe
  -- enum. Un clichet care verifică doar enum-ul ratează exact metoda adăugată
  -- în CHECK (echipa roșie: comentariul promitea ambele, codul verifica una).
  select pg_get_constraintdef(c.oid) into v_chk
    from pg_constraint c
   where c.conrelid = 'public.order_payments'::regclass
     and c.contype = 'c' and c.conname = 'order_payments_method_check';
  if v_chk is null then
    raise exception 'mig 267: CHECK-ul order_payments_method_check lipsește'; end if;
  foreach v_name in array array['cash','card_pos','other','card_online','meal_voucher'] loop
    if position('''' || v_name || '''' in v_chk) = 0 then
      raise exception 'mig 267: metoda „%” a dispărut din order_payments_method_check', v_name; end if;
  end loop;
  if (length(v_chk) - length(replace(v_chk, '::text', ''))) / 6 <> 5 then
    raise exception 'mig 267: order_payments.method are altceva decât 5 metode (%) — adaugă găleata nouă în TOATE defalcările înainte', v_chk; end if;

  -- Politica de citire a registrului TREBUIE să treacă prin funel (`is_member`),
  -- altfel fondatorul/partenerul văd zero plăți și view-ul cade tăcut pe enum.
  select pg_get_expr(p.polqual, p.polrelid) into v_chk
    from pg_policy p
   where p.polrelid = 'public.order_payments'::regclass
     and p.polname = 'order_payments: member read';
  if v_chk is null then
    raise exception 'mig 267: politica de citire pe order_payments lipsește'; end if;
  if position('is_member' in v_chk) = 0 then
    raise exception 'mig 267: order_payments nu mai trece prin funel — fondatorul/partenerul văd defalcarea VECHE (greșită)'; end if;

  raise notice 'mig 267: sursa unică pe metode OK (3 view-uri, contract de coloane intact, defalcarea închide)';
end $$;

commit;
