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
- ✅ **mig 207 (fix review advers)**: `failed` NU mai e terminal în settle —
  Stripe emite `payment_failed` la fiecare încercare eșuată, iar intent-ul
  rămâne confirmabil; fără fix, retry-ul reușit de card lăsa comenzile
  nemarcate deși banii erau încasați. Test permanent TP7 (failed→succeeded
  settle-ază; failed întârziat nu regresează succeeded).
- ✅ **Val 2 (funcții)**: `table-payment.js` (create-intent), `stripe-connect.js`
  (onboarding + status), `stripe-connect-webhook.js` (endpoint separat de
  Connect, dedup pe `stripe_events` + settle idempotent).
- ✅ **Val 3 (client)**: `lib/payments.ts` (loader js.stripe.com + tipuri
  minimale, fără `any`), `PayTableSheet.tsx` (Payment Element pe tokenii temei),
  wiring în `QrMenuPage` (butonul devine „Plătește online" DOAR când modulul
  e activ — altfel rămâne fallback-ul „cere nota"), `OnlinePaymentsCard.tsx`
  în Setări → Comenzi (conectare Stripe + toggle modul, gated pe planTier ≥ 3).
- ✅ **mig 208 (opt-out client)**: `cancel_table_payment` (service_role-only,
  validare sesiune+token ca la begin) + acțiunea `cancel` în `table-payment.js`
  (Stripe cancel ÎNTÂI — dacă plata a reușit între timp, clientul vede „plătit",
  nu „anulat" — apoi settle('canceled')). Client: butonul secundar
  „Renunț — plătesc la ospătar" în `PayTableSheet` (fazele ready/error) →
  anulează intent-ul și cheamă nota la ospătar (`handleRequestBill`). Fără
  anulare, un tap întârziat pe „Plătește" putea încasa banii DUPĂ cash. Teste
  permanente TP8 (token străin respins, no-intent, re-begin după cancel,
  succeeded ne-anulabil).
- ✅ **mig 209 (gate de monedă)**: mig 205 a permis meniuri în EUR/HUF/…, dar
  begin întorcea 'RON' hardcodat și intent-ul se crea în 'ron' — un meniu în
  EUR ar fi încasat 12 RON pentru €12. Acum: monedă ≠ RON → respins fail-closed
  cu `currency_not_supported` (bonul fiscal e RON-only); funcția Netlify citește
  `begin.currency` în loc să hardcodeze. Test permanent TP9.
- ✅ **mig 211 (3 fixuri de bani, review advers)**: (F1) plata parțială cash
  luată între begin și settle → comanda e SĂRITĂ la settle + notată (înainte
  se marca integral card_online = dublă încasare tăcută); (F2) begin salvează
  snapshot-ul totalurilor per comandă în `order_totals`, settle notează
  diferențele (edit de staff în timpul plății = reconciliere vizibilă);
  (F3) un singur intent live per sesiune — begin întoarce
  `superseded_intents`, funcția Netlify le anulează la Stripe înainte de
  intent-ul nou; dacă unul a REUȘIT între timp, plata nouă se anulează și
  clientul află că nota e plătită (două telefoane la aceeași masă nu mai pot
  plăti amândouă toată nota). + F4-F8: reset `tablePaid` la rundă nouă,
  detecție `succeeded` explicită la cancel (nu regex pe unexpected_state),
  bucket separat de rate-limit pentru cancel, „plătit" în client doar pe
  `paymentIntent.status === 'succeeded'`. Teste permanente TP10–TP12.
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

## Split pe itemi (v1, mig 229)

Fiecare client își plătește DOAR produsele lui, cu cardul, din meniul QR:

```
Client → QrCartSheet „Împarte nota" → SplitBillSheet (fetch action 'bill')
  → selecție itemi (remaining_qty) → PayTableSheet cu claims
  → table-payment.js action 'create' + body.items → begin_split_payment
      (lock sesiune → gate online_payments+split_bill+RON → claims validate
       → sumă proporțională cu discountul + absorbția restului de rotunjire
       → supersede intent-urile FULL-table → rând table_payments kind='split'
       → rânduri table_payment_items cu snapshot)
  → Stripe confirm → webhook → settle_table_payment (lanț 203→207→211→229)
      ramura kind='split': INSERT order_payments (method='card_online') per
      comandă; comanda devine 'paid' abia când sum(order_payments) ≥ total
      → UN bon fiscal per comandă, prin triggerul existent (mig 030).
```

Decizii cheie (detalii în antetul mig 229):
- **UN bon per comandă la final** — bon per PLĂTITOR e v2 (cere payload
  FiscalNet din subset de itemi + `pending_receipts.payment_id` + idempotență
  per plată, adică o rescriere a lanțului fiscal 050→053; v1 e 100% corectă
  fiscal: un bon cu totalul real, cod P 7 integral online / 8 mix).
- **Conflict de claims** = refuz curat `items_already_claimed`; claims ținute
  de plăți `created/processing/failed/succeeded` ('failed' e retryable, mig
  207). Eliberare: cancel_table_payment (cancel-on-close din UI + pid în
  sessionStorage) + TTL 15 min DOAR pe rândurile `created` fără intent.
  Rezidual: un `processing` stale (telefon dispărut mid-confirm) se rezolvă
  la ospătar — NU adăuga supersede automat pe split-urile altora (fereastră
  de dublă încasare).
- **`table_payment_items` fără FK pe order_items** — editările de staff
  (update_order_items) șterg/recreează itemi; banii intră oricum în
  order_payments din snapshot, iar `paid_amount > total` devine vizibil la
  reconciliere (aceeași clasă de onestitate ca F2/mig 211).
