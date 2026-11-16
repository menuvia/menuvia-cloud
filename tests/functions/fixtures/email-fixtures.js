// tests/functions/fixtures/email-fixtures.js
// Datele de test ale emailurilor (lotul L8a): câte cel puțin un caz COMPLET
// pentru FIECARE kind din enum (fiecare cheie de contract completată, nume cu
// `&`, `<` și `'` ca escaparea să fie înghețată, instante ISO fixe) plus
// variante pe ramurile secundare. `mustRender` = ce TREBUIE să apară în
// ieșirea VECHE (anti-vacuitate: o fixtură care nu exersează câmpurile ar
// compara doar textele de rezervă).
//
// Nu e fișier de test (nu se potrivește pe globurile `node --test`).
'use strict'

const NOW = '2026-11-16T20:00:00Z'
const APP = 'https://app.example'

const REST = "Bistro & <Ana>'s"
const REST_E = 'Bistro &amp; &lt;Ana&gt;&#39;s'
const OWNER = "Ion & <Pop>'"
const OWNER_E = 'Ion &amp; &lt;Pop&gt;&#39;'
const CUST = "Maria & <Co>'"
const CUST_E = 'Maria &amp; &lt;Co&gt;&#39;'
const RID = '32700000-0000-4000-8000-0000000000a1'
const UID = '32700000-0000-4000-8000-0000000000b1'

// Rezervarea la 00:30 pe 17 noiembrie în București (22:30Z pe 16): „mâine”
// în București față de NOW, „astăzi” pe o gazdă UTC — defectul reparat.
const STARTS = '2026-11-16T22:30:00Z'

const CASES = {
  welcome: [{ label: 'full', data: { owner_name: OWNER } }],
  onboarding_no_products: [{ label: 'full', data: { owner_name: OWNER } }],
  trial_ending_3d: [{ label: 'full', data: { owner_name: OWNER } }],
  payment_failed: [
    { label: 'full', data: { owner_name: OWNER, attempt: 2 } },
    { label: 'placeholder name', data: { owner_name: 'Stimate patron' } },
  ],
  health_score_alert: [
    {
      label: 'full',
      data: { restaurant_id: RID, owner_name: OWNER, score: 31, trend: 'critical', orders_this_week: 4, last_login: '2026-11-10' },
    },
  ],
  milestone_100_orders: [{ label: 'full', data: { owner_name: OWNER } }],
  milestone_1000_orders: [{ label: 'full', data: { owner_name: OWNER } }],
  weekly_report: [
    {
      label: 'full',
      data: {
        restaurant_id: RID,
        restaurant_name: REST,
        owner_name: OWNER,
        period_start: '2026-11-08T22:00:00Z',
        period_end: '2026-11-15T22:00:00Z',
        revenue: 12345.5,
        revenue_prev: 10000,
        revenue_change_pct: 23.5,
        orders: 87,
        avg_ticket: 141.9,
        busiest_hour: 20,
        top_products: [
          { name: "Ciorbă & <pâine>'", units_sold: 42, revenue: 1260 },
          { name: 'Papanași', units_sold: 30, revenue: 900.5 },
        ],
      },
    },
    {
      label: 'down, no products',
      data: {
        period_start: '2026-11-08T22:00:00Z',
        period_end: '2026-11-15T22:00:00Z',
        revenue: 100,
        revenue_change_pct: -12,
        orders: 2,
        avg_ticket: 50,
        busiest_hour: null,
        top_products: [],
      },
    },
    { label: 'no comparison', data: { revenue: 0, revenue_change_pct: null, orders: 1 } },
  ],
  daily_report: [
    {
      label: 'full',
      data: {
        restaurant_id: RID,
        restaurant_name: REST,
        owner_name: OWNER,
        day: '2026-11-15',
        period_start: '2026-11-14T22:00:00Z',
        period_end: '2026-11-15T22:00:00Z',
        revenue: 2345.75,
        revenue_prev: 2000,
        revenue_change_pct: 17.3,
        orders: 21,
        avg_ticket: 111.7,
        busiest_hour: 13,
        top_products: [{ name: "Ciorbă & <pâine>'", units_sold: 9, revenue: 270 }],
      },
    },
    { label: 'down', data: { day: '2026-11-15', revenue: 10, revenue_change_pct: -40, orders: 1, top_products: [] } },
  ],
  milestone_first_month: [{ label: 'full', data: { owner_name: OWNER, total: 87.5 } }],
  reservation_reminder: [
    {
      label: 'full',
      data: {
        restaurant_id: RID,
        customer_name: CUST,
        restaurant_name: REST,
        restaurant_phone: '+40 722 & 111',
        starts_at: STARTS,
        party_size: 4,
        confirmation_code: 'AB<12>CD',
      },
    },
    {
      label: 'no phone, far date',
      data: { customer_name: CUST, restaurant_name: REST, starts_at: '2026-11-20T18:00:00Z', party_size: 2, confirmation_code: 'X1' },
    },
    { label: 'past', data: { customer_name: CUST, restaurant_name: REST, starts_at: '2026-11-15T18:00:00Z', party_size: 2 } },
  ],
  reservation_created: [
    {
      label: 'confirmed',
      data: {
        restaurant_id: RID,
        restaurant_name: REST,
        customer_name: CUST,
        customer_phone: '+40722000111',
        party_size: 4,
        starts_at: STARTS,
        status: 'confirmed',
        source: 'public',
        special_requests: "Fără gluten & <alune>\nla geam'",
        confirmation_code: 'AB12CD34',
      },
    },
    {
      label: 'pending, no notes',
      data: { restaurant_name: REST, customer_name: CUST, customer_phone: '0722', party_size: 2, starts_at: STARTS, status: 'pending' },
    },
  ],
  reservation_cancelled: [
    {
      label: 'full',
      data: { restaurant_id: RID, restaurant_name: REST, customer_name: CUST, customer_phone: '+40722000111', party_size: 3, starts_at: STARTS },
    },
  ],
  win_back_7d: [
    { label: 'full', data: { owner_name: OWNER, restaurant_name: REST, days_since_last_order: 9, last_order_at: '2026-11-07T12:00:00Z' } },
    { label: 'sql placeholder', data: { owner_name: 'Stimate patron', restaurant_name: REST, days_since_last_order: 9 } },
  ],
  win_back_30d: [
    { label: 'full', data: { owner_name: OWNER, restaurant_name: REST, days_since_last_order: 31, last_order_at: '2026-10-16T12:00:00Z' } },
  ],
  nps_survey: [
    { label: 'full', data: { owner_name: OWNER, restaurant_name: REST, days_since_signup: 61, user_id: UID } },
    { label: 'sql placeholder', data: { owner_name: 'Stimate utilizator', restaurant_name: 'Menuvia', user_id: UID } },
  ],
  onboarding_no_orders: [{ label: 'full', data: { owner_name: OWNER } }],
  trial_ending_1d: [{ label: 'full', data: { owner_name: OWNER } }],
  payment_recovered: [{ label: 'full', data: { owner_name: OWNER } }],
  subscription_cancelled: [{ label: 'full', data: { owner_name: OWNER, restaurant_name: REST } }],
  monthly_recap: [{ label: 'full', data: { owner_name: OWNER, restaurant_name: REST, revenue: 5432.1, orders: 210 } }],
  invoice_ready: [{ label: 'full', data: { owner_name: OWNER, amount: 249 } }],
  agent_client_at_risk: [
    { label: 'full', data: { restaurant_name: REST, city: 'Cluj & <N>', score: 31, trend: 'critical', agent_name: OWNER, panel_url: '/afiliat?x=1' } },
  ],
  affiliate_new_client: [
    { label: 'full', data: { restaurant_name: REST, source: 'agent_code', agent_name: OWNER, panel_url: '/afiliat' } },
  ],
  partner_access_requested: [
    { label: 'full', data: { agent_display_name: "Agent & <X>'", restaurant_name: REST, owner_name: OWNER, approve_url: '/dashboard' } },
    { label: 'anonymous', data: { owner_name: '' } },
  ],
  affiliate_payout_statement: [
    {
      label: 'full',
      data: {
        period: '2026-10',
        amount_cents: 24900,
        currency: 'RON',
        invoice_required: true,
        menuvia_billing: { company_name: 'MENUVIA & <SRL>', cui: 'RO1', address: 'Str. X' },
        due_hint: 'până pe 10',
        affiliate_name: OWNER,
        upload_url: '/afiliat',
        panel_url: '/afiliat',
      },
    },
  ],
  affiliate_payout_sent: [
    { label: 'full', data: { amount_cents: 24900, currency: 'RON', period: '2026-10', transfer_reference: 'tr_<1>', affiliate_name: OWNER, panel_url: '/afiliat' } },
  ],
  affiliate_payout_blocked: [
    { label: 'full', data: { amount_cents: 24900, currency: 'RON', period: '2026-10', reason_code: 'invoice_missing', affiliate_name: OWNER, action_url: '/afiliat' } },
  ],
  founder_weekly_digest: [
    {
      label: 'full',
      data: {
        week: '2026-W46',
        needs_you: [{ kind: 'k', label: 'Plăți & <x>', count: 2, url: '/founder' }],
        network: { heads: 2, agents: 5, pending_old: 1 },
        sales: { new_attributions: 3, first_paid: 1, attributed_mrr_cents: 24900, organic_mrr_cents: 0 },
        money: { accrued_cents: 100, clawback_cents: 0, payable_cents: 100, payouts_by_status: { paid: 1 } },
        risks: [{ kind: 'r', label: 'Risc', count: 1 }],
        system: { emails_failed: 0, stripe_events_failed: 1 },
      },
    },
  ],
  founder_alert: [
    { label: 'full', data: { kind: 'payout_on_hold', title: 'Plată & <blocată>', details: 'a\nb', occurred_at: '2026-09-04T21:30:00Z', action_url: '/founder' } },
  ],
  custom: [
    { label: 'body', data: { subject: 'Subiect & <x>', body: "Text & <y>'" } },
    { label: 'html', data: { subject: 'S', html: '<p>gata</p>' } },
  ],
}

// Conținutul care TREBUIE să apară (escapat) în ieșirea veche a cazului `full`
// (primul caz) al fiecărui kind — subiect + html.
const MUST_RENDER = {
  welcome: [OWNER_E],
  onboarding_no_products: [OWNER_E],
  trial_ending_3d: [OWNER_E],
  payment_failed: [OWNER_E, '(încercarea 2)'],
  health_score_alert: [OWNER_E, RID, '31/100'],
  milestone_100_orders: [OWNER_E],
  milestone_1000_orders: [OWNER_E],
  weekly_report: ['12345.5 lei', '12.345,50 lei', '23.5%', '87', '141,90 lei', '20:00 – 21:00', 'Ciorbă &amp; &lt;pâine&gt;&#39;', '42 buc', '1.260,00 lei', '900,50 lei'],
  daily_report: ['2.345,75 lei', '(21 comenzi)', REST_E, '17.3%', '111,70 lei', '13:00 – 14:00', '9 buc', '270,00 lei', 'noiembrie'],
  milestone_first_month: [OWNER_E, '87.5 lei'],
  reservation_reminder: [CUST_E, REST_E, '+40 722 &amp; 111', '4', 'AB&lt;12&gt;CD', 'noiembrie'],
  reservation_created: [REST_E, CUST_E, '+40722000111', 'noiembrie', '00:30', 'Fără gluten &amp; &lt;alune&gt;\nla geam&#39;', 'confirmată automat'],
  reservation_cancelled: [REST_E, CUST_E, '+40722000111', '00:30', '3 pers.'],
  win_back_7d: [OWNER_E, REST_E, '9 zile'],
  win_back_30d: [OWNER_E, REST_E, '31 zile'],
  nps_survey: [OWNER_E, REST_E, UID],
  onboarding_no_orders: [OWNER_E],
  trial_ending_1d: [OWNER_E],
  payment_recovered: [OWNER_E],
  subscription_cancelled: [OWNER_E, REST_E],
  monthly_recap: [OWNER_E, REST_E, '5.432,10 lei', '210'],
  invoice_ready: [OWNER_E, '249,00 lei'],
  agent_client_at_risk: [REST_E, 'Cluj &amp; &lt;N&gt;', OWNER_E, '31/100'],
  affiliate_new_client: [REST_E, OWNER_E],
  partner_access_requested: ['Agent &amp; &lt;X&gt;&#39;', REST_E, OWNER_E],
  affiliate_payout_statement: ['MENUVIA &amp; &lt;SRL&gt;', 'octombrie 2026', '249,00 lei', OWNER_E],
  affiliate_payout_sent: ['tr_&lt;1&gt;', '249,00 lei', OWNER_E],
  affiliate_payout_blocked: ['249,00 lei', OWNER_E],
  founder_weekly_digest: ['Plăți &amp; &lt;x&gt;', 'săptămâna 46'],
  founder_alert: ['Plată &amp; &lt;blocată&gt;', '5 septembrie'],
  custom: ['Text &amp; &lt;y&gt;&#39;'],
}

// ── Fixturi ASCII pentru EL2 (fără diacritice, fără cuvinte românești) ──────
// Valorile lor sunt EXCLUSE din căutarea resturilor românești.
const ASCII = {
  rest: 'Zorba Grill',
  owner: 'Anna Smith',
  cust: 'Paul Weber',
  agent: 'Mark Jones',
  phone: '+40722111222',
  code: 'AB12CD34',
}
const ASCII_CASES = {
  payment_failed: { owner_name: ASCII.owner, attempt: 2 },
  payment_recovered: { owner_name: ASCII.owner },
  milestone_first_month: { owner_name: ASCII.owner, total: 87.5 },
  milestone_100_orders: { owner_name: ASCII.owner },
  milestone_1000_orders: { owner_name: ASCII.owner },
  weekly_report: {
    restaurant_name: ASCII.rest,
    period_start: '2026-11-08T22:00:00Z',
    period_end: '2026-11-15T22:00:00Z',
    revenue: 12345.5,
    revenue_change_pct: 23.5,
    orders: 87,
    avg_ticket: 141.9,
    busiest_hour: 20,
    top_products: [{ name: 'Burger', units_sold: 42, revenue: 1260 }],
  },
  daily_report: {
    restaurant_name: ASCII.rest,
    day: '2026-11-15',
    revenue: 2345.75,
    revenue_change_pct: -17.3,
    orders: 21,
    avg_ticket: 111.7,
    busiest_hour: 13,
    top_products: [{ name: 'Burger', units_sold: 9, revenue: 270 }],
  },
  reservation_created: {
    restaurant_name: ASCII.rest,
    customer_name: ASCII.cust,
    customer_phone: ASCII.phone,
    party_size: 4,
    starts_at: STARTS,
    status: 'confirmed',
    special_requests: 'Window seat',
  },
  reservation_cancelled: { restaurant_name: ASCII.rest, customer_name: ASCII.cust, customer_phone: ASCII.phone, party_size: 3, starts_at: STARTS },
  win_back_7d: { owner_name: ASCII.owner, restaurant_name: ASCII.rest, days_since_last_order: 9 },
  win_back_30d: { owner_name: ASCII.owner, restaurant_name: ASCII.rest, days_since_last_order: 31 },
  nps_survey: { owner_name: ASCII.owner, restaurant_name: ASCII.rest, user_id: UID },
  partner_access_requested: { agent_display_name: ASCII.agent, restaurant_name: ASCII.rest, owner_name: ASCII.owner },
  reservation_reminder: {
    customer_name: ASCII.cust,
    restaurant_name: ASCII.rest,
    restaurant_phone: ASCII.phone,
    starts_at: STARTS,
    party_size: 4,
    confirmation_code: ASCII.code,
  },
}
// A doua variantă (ramurile secundare), tot ASCII.
const ASCII_CASES_ALT = {
  reservation_created: { restaurant_name: ASCII.rest, customer_name: ASCII.cust, customer_phone: ASCII.phone, party_size: 2, starts_at: STARTS, status: 'pending' },
  partner_access_requested: {},
  weekly_report: { period_start: '2026-11-08T22:00:00Z', period_end: '2026-11-15T22:00:00Z', revenue: 0, revenue_change_pct: null, orders: 1 },
  reservation_reminder: { restaurant_name: ASCII.rest, starts_at: '2026-11-20T18:00:00Z' },
}
// A treia variantă: ramurile FĂRĂ nume (rezerva SQL „Stimate patron” sau gol)
// și raportul zilnic fără comparație — ramurile pe care EL2 trebuie să le
// randeze și în en/fr/de (altfel un șir românesc lăsat acolo trece).
const ASCII_CASES_ANON = {
  payment_failed: { owner_name: 'Stimate patron', attempt: 2 },
  payment_recovered: { owner_name: '' },
  milestone_first_month: { owner_name: '', total: 87.5 },
  milestone_100_orders: { owner_name: 'Stimate patron' },
  milestone_1000_orders: { owner_name: '' },
  daily_report: { restaurant_name: ASCII.rest, day: '2026-11-15', revenue: 10, revenue_change_pct: null, orders: 1, top_products: [] },
  win_back_7d: { owner_name: 'Stimate patron', restaurant_name: ASCII.rest, days_since_last_order: 9 },
  win_back_30d: { owner_name: '', restaurant_name: ASCII.rest, days_since_last_order: 31 },
  nps_survey: { owner_name: 'Stimate utilizator', restaurant_name: ASCII.rest, user_id: UID },
}

// Al doilea moment al ceasului, în fereastra 22:00–24:00Z: în București e deja
// 17 noiembrie (00:30), pe UTC încă 16 — partea „ACUM” a comparației
// astăzi/mâine din reminder. Cu NOW (20:00Z) ambele calendare dau aceeași zi,
// deci o comparație pe calendarul UTC ar trece nevăzută.
const NOW_LATE = '2026-11-16T22:30:00Z'
const STARTS_LATE = '2026-11-17T18:00:00Z'

module.exports = {
  NOW_LATE,
  STARTS_LATE,
  ASCII_CASES_ANON,
  NOW,
  APP,
  STARTS,
  RID,
  UID,
  CASES,
  MUST_RENDER,
  ASCII,
  ASCII_CASES,
  ASCII_CASES_ALT,
}
