# Scorecard re-audit — săptămâna 10 (19 iul 2026)

Re-audit notat al întregului sistem cu workflow-ul de agenți (inventar →
notare 6 axe → verificare adversarială → agregare), pe modelul auditului din
iunie 2026. **59 de unități auditabile** pe 11 capitole, fiecare notată pe
{corectitudine, reziliență-la-absență, securitate, observabilitate,
simplitate, premium}; notele sub 6 sau findings-urile „high" au trecut prin
verificator adversarial.

## Media globală

| | Iunie 2026 (baseline) | **Iulie 2026 (săpt. 10)** |
|---|---|---|
| Medie globală | **6.13** / 10 | **≈ 8.05** / 10 |

Salt de **+1.9 puncte** după cele 5 valuri de fix-uri (audit1–2 + UX + bug-waves)
și expansiunile E1–E5, fiecare cu review adversarial. Ținta declarată era ≥9;
rezultatul real e 8.05 — solid, dar cu un cap de capitole încă în zona 7.5.

## Capitole (worst-first)

| Capitol | Iunie | **Iulie** | Δ |
|---|---|---|---|
| reziliență-observabilitate-DR | 5.70 | **7.46** | +1.8 |
| meniu-client | 6.50 | **7.56** | +1.1 |
| dashboard | 6.35 | **7.75** | +1.4 |
| fiscal-oblio | 5.65 | **7.79** | +2.1 |
| ai-proxy-metering | 6.56 | **7.81** | +1.3 |
| expansion-E1–E5 | — (nou) | **8.01** | — |
| automatizare-cron | 4.65 | **8.15** | +3.5 |
| comenzi-qr-waiter | 6.35 | **8.29** | +1.9 |
| plăți-stripe | 5.63 | **8.48** | +2.9 |
| afiliați-payout | 6.37 | **8.60** | +2.2 |
| securitate-RLS | 7.12 | **8.63** | +1.5 |

Capitolul cel mai slab la baseline (automatizare-cron, 4.65) e acum al 4-lea
cel mai bun (8.15) — efectul direct al valurilor de reziliență (alerting,
dead-letter, reclaim, catch-up). Cele mai slabe rămase sunt suprafețele de
**observabilitate/DR** (backup offsite lipsă, erori de load înghițite în UI) și
**finisajul de meniu/dashboard** (stări de eroare tăcute, câteva teste unitare
lipsă) — niciuna nu e o gaură de bani sau securitate.

## Findings confirmate (declanșabile)

### Reparate în acest val (săpt. 10)
- **[HIGH] Billing Portal inaccesibil pe planul starter** — cardul „Abonament &
  facturare" era gate-uit pe `tier ≥ 2`, dar starter (plan plătit, 99 lei/lună)
  e `tier = 1`; CTA-ul din emailul de dunning („Actualizează metoda de plată →")
  ducea într-un dead-end → downgrade evitabil + churn. **Fix:** gate pe orice
  plan plătit (`tier ≥ 1`). `HomeTab.tsx`.
- **[MEDIUM] Bucla de dunning moartă de la al 2-lea episod** — dedup-key-ul
  `pmt_fail:user:attempt` se repeta identic la a doua expirare de card
  (attempt-urile reîncep de la 1) → `on conflict do nothing` înghițea toate
  emailurile de plată eșuată. **Fix:** cheia include acum `invoice_id`, ca la
  `payment_recovered`. `mig 220` (neaplicată, editată în loc).
- **[MEDIUM] Invitațiile bulk din Setup Asistent → 401** — `quickSetup.sendInvite`
  chema `send-invite` fără header-ul `Authorization: Bearer`, deci toate
  invitațiile din wizard picau; plus tipul de rol includea `admin` (respins 400).
  **Fix:** header cu `access_token` din sesiune + tip de rol restrâns.
  `quickSetup.ts`.

### Reparate în valurile Q4 (post-scorecard)
- **Q4-1** (mig —): 6 erori de UI înghițite tăcut acum vizibile (useFeatures,
  useRestaurantModules, OnlinePaymentsCard, PartnerAccessList, WaiterPage poll,
  stripe-portal/checkout) + fix integritate script replay (18 teste
  catalog_drift sărite tăcut → 46→64 teste).
- **Q4-2** (mig 238/239): raport TVA aplică discount-ul (supradeclarare TVA
  reparată) + recuperarea facturilor Oblio blocate în `generating`.
- **Q4-3** (mig 240): `orders.table_id` UPDATE cross-tenant închis +
  `device_secret` RLS restrâns la admin.
- **Q4-4** (mig 241): ziua de serviciu pe program peste miezul nopții
  (sloturile post-miezul-nopții nu mai sunt fals respinse).
- **Q4-5** (mig 242): email zombie `queued`→`failed` la plafon + ai-import
  refund pe eșec de rețea + Stripe Connect deauthorized curăță contul mort.
- **Q4-6** (fără migrație): notele de reconciliere `settle_note` sunt acum
  VIZIBILE — card „Reconciliere plăți online" în tabul Încasări
  (CashRegisterTab), citit prin politica RLS `table_payments_admin_read`
  existentă (mig 203); apare doar când există observații.
- **Q4-7** (fără migrație): sloturile pickup suportă programul peste miezul
  nopții (extras `lib/pickupSlots.ts`, doctrina mig 201 — un food truck
  18:00–02:00 nu mai era fals „închis" toată seara) + teste unitare noi pe
  helperii puri (`pickupSlots.test.ts`, `i18nMenu.test.ts`).

### Rămase (backlog Q4 — MEDIUM/LOW, niciuna bani/securitate)
- Gate-ul de atribuire terminală din mig 193 e cod mort (niciun producător
  setează starea) — inert, de curățat sau conectat.
- Backup DB fără copie offsite (trăiește pe același VPS) — risc DR documentat în
  RUNBOOK, dar neautomatizat (decizie de infrastructură + secrete VPS = founder).
- MFA platform fără backup codes — lockout permanent posibil dacă se pierde
  factorul TOTP.
- ~13 findings LOW rămase (ex. rezidii de rate-limit anon-callable) — toate
  documentate, niciuna pe calea de bani/securitate. Testele pe helperi puri și
  sloturile pickup peste miezul nopții au fost închise ca Q4-7.

## Metodă

Workflow `reaudit-total` (3 rulări, întrerupte de limite de sesiune, reluate cu
`resumeFromRunId` + fallback pe Sonnet pe unitățile rămase — cache-ul a păstrat
notele deja produse). ~5,9M tokeni de subagenți. Datele brute per-unitate în
`journal.jsonl` al run-ului `wf_26681aba-6f4`.

## Concluzie

Codul e la **~8/10** — de la 6.13, printr-un an de valuri disciplinate (fiecare
cu teste permanente + review adversarial). Rămâne un cap de finisaj pe
observabilitate/DR și pe stările de eroare din UI; niciun finding rămas nu
atinge banii sau securitatea. Următorul prag (≥9) cere: backup offsite
automatizat, sweep pe stările de eroare tăcute din UI (un val „fără catch mut" —
livrat ca Q4-1), și suprafețele founder-side lipsă (retry factură owner;
settle_note vizibil — livrat ca Q4-6).
