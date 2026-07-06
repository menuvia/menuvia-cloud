# Plata online la masă — design (Etapa 1)

> PLAN_10 Faza 4 / MASTER_PLAN „URMEAZĂ" #2. Regula de aur se aplică integral:
> banii ating bonul fiscal → **Plan 3 (pro/enterprise), gate în RPC**, nu în UI.
> Banii intră prin Stripe, **bonul iese TOT pe casa localului** (fluxul existent
> `order.paid` → `pending_receipts` → bridge FiscalNet rămâne neschimbat).

## Decizii (Etapa 1)

| Decizie | Alegere | De ce |
|---|---|---|
| Modelul Stripe | **Connect Standard, direct charges** pe contul restaurantului + `application_fee_amount` pentru Menuvia | Banii ajung direct la local (nu tranzitează Menuvia — zero risc de fonduri ținute); taxa platformei (<1,35%, sub Qerko — MASTER_PLAN §5) se configurează în `platform_settings.online_payment_fee_bps` (founder-only, default 0) |
| Granularitate | **Toată nota mesei** (comenzile neplătite ale sesiunii) | Split pe item + bon per plătitor = Etapa 2 |
| Gate-uri (toate server-side, în RPC) | 1. `plan_features['online_payments']` (doar pro/enterprise) · 2. modulul `online_payments` activat de restaurant (`restaurant_modules`, default OFF) · 3. `restaurants.stripe_account_id` conectat | Trei chei independente: planul (plătește), voința localului (opt-in), capabilitatea tehnică (cont Stripe) |
| Metoda pe bon | enum `payment_method` + valoarea **`card_online`** → cod FiscalNet **7 („Plata modernă")** | 2=Card e cardul fizic la POS; 7 e codul pentru plăți online/app. ⚠️ De confirmat cu EconMedia la apelul din Faza 3 — maparea stă într-o singură funcție (`fiscalnet_payment_code`) |
| Client (QR) | Stripe **Payment Element** încărcat din `js.stripe.com/v3` prin script tag dinamic | `@stripe/stripe-js` din npm e doar un loader pentru același script; evităm atingerea `package-lock.json` |

## Fluxul banilor (Etapa 1)

1. Clientul (sesiune QR deschisă) apasă „Plătește masa" în `QrCartSheet`
   (prop-ul `onPayTable` există deja).
2. Frontend → `POST /.netlify/functions/table-payment` `{token, session_id}`.
3. Funcția (service role) → RPC **`begin_table_payment`**: validează sesiunea +
   token-ul (aceeași masă), aplică cele 3 gate-uri, calculează SERVER-SIDE suma
   comenzilor neplătite ale sesiunii (fără cele cu plăți parțiale deja pornite),
   scrie rândul `table_payments(status='created')`.
4. Funcția creează PaymentIntent pe contul CONECTAT (direct charge,
   `application_fee_amount`, `Idempotency-Key = payment_id`) → RPC
   **`attach_payment_intent`** → întoarce `client_secret` clientului.
5. Clientul confirmă în Payment Element.
6. Webhook-ul de **Connect** (`payment_intent.succeeded` / `payment_failed`) →
   RPC **`settle_table_payment`** (idempotent pe intent id): marchează comenzile
   `paid` cu `payment_method='card_online'` → triggerul existent
   `enqueue_fiscal_receipt` bagă bonul în `pending_receipts` → bridge-ul tipărește.
7. Comenzi plătite cash/anulate ÎNTRE begin și settle → sărite + `settle_note`
   pe rândul de plată (refund parțial = operațiune manuală, documentată; Etapa 2
   o automatizează).

## Migrații

- **mig 202** — `alter type payment_method add value 'card_online'` (fișier
  separat: valoarea nouă nu poate fi FOLOSITĂ în aceeași tranzacție).
- **mig 203** — `restaurants.stripe_account_id`, tabela `table_payments` (RLS:
  citire doar admin de restaurant; scrieri EXCLUSIV prin RPC-urile de mai jos),
  seed `plan_features['online_payments']` (pro/enterprise ON), seed
  `platform_settings['online_payment_fee_bps']={"bps":0}`, redefinire
  `fiscalnet_payment_code` (+card_online→7), RPC-urile `begin_table_payment` /
  `attach_payment_intent` / `settle_table_payment` — toate SECURITY DEFINER,
  `search_path=public,pg_temp`, EXECUTE **doar service_role** (le cheamă exclusiv
  funcțiile Netlify), asserții fail-closed. Teste permanente:
  `tests/sql/table_payment_assertions.sql` (wired în sql-verify.yml).

## Straturi de protecție existente pe care ne așezăm

- Tranziția `orders.status → 'paid'` e DEJA gate-uită pe plan fiscal
  (orders_paid_gate) — settle-ul definer trece doar pe planuri cu fiscal.
- `trg_maybe_close_session` închide sesiunea când totul e plătit — nimic de făcut.
- `enqueue_fiscal_receipt` sare curat dacă localul n-are bridge (fără queue orfan).

## Stadiul implementării (6 iulie 2026)

- ✅ **Val 1 (SQL)**: mig 202/203/204 + `tests/sql/table_payment_assertions.sql`.
- ✅ **Val 2 (funcții)**: `table-payment.js` (create-intent), `stripe-connect.js`
  (onboarding + status), `stripe-connect-webhook.js` (endpoint separat de
  Connect, dedup pe `stripe_events` + settle idempotent).
- ✅ **Val 3 (client)**: `lib/payments.ts` (loader js.stripe.com + tipuri
  minimale, fără `any`), `PayTableSheet.tsx` (Payment Element pe tokenii temei),
  wiring în `QrMenuPage` (butonul devine „Plătește online" DOAR când modulul
  e activ — altfel rămâne fallback-ul „cere nota"), `OnlinePaymentsCard.tsx`
  în Setări → Comenzi (conectare Stripe + toggle modul, gated pe planTier ≥ 3).
- ⏳ Rămas: test end-to-end pe Stripe test mode (după activarea Connect de
  către fondator) + Etapa 2/3 de mai jos.

## Acțiuni fondator (o singură dată, când activăm)

- Stripe Dashboard → activează **Connect** pe contul platformei (review Stripe).
- Adaugă în env (VPS/Netlify): `STRIPE_CONNECT_WEBHOOK_SECRET` (endpoint separat
  pentru evenimentele conturilor conectate).

## Etapele 2–3 (nu în acest val)

- **Etapa 2**: split pe item + bon per plătitor (`table_payments.order_ids`
  devine `items jsonb`; bonuri parțiale per plătitor pe casă).
- **Etapa 3**: tichete de masă Edenred/Pluxee/Up (`P^4`/`P^5` există în spec
  FiscalNet; enum-ul primește valorile la momentul respectiv).
