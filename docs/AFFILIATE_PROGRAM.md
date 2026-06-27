# Program de afiliere Menuvia — design + brief juridic

> Stare: **DRAFT pre-implementare.** Acest document e sursa de adevăr pentru
> modelul de afiliere și conține întrebările concrete pentru avocat și contabil.
> Nimic din partea financiară nu se implementează înainte de validarea juridică
> a secțiunilor 6–7.
>
> Provine din ~3 runde de audit adversarial (vezi istoricul de decizii la final).

## 0. Rezumat într-un paragraf

Un afiliat (persoană care recomandă Menuvia restaurantelor) primește comision pe
**abonamentul real plătit** de restaurantul adus: **30% setup** (o singură dată,
cu hold 60 zile) + **10% recurring lunar plafonat la 12 luni**. Dacă afiliatul
recrutează la rândul lui un alt afiliat, primește **2% din comisioanele acelui
sub-afiliat** (un singur nivel). Plata se face lunar, **doar către afiliați care
emit factură** (PFA/SRL) — fără persoane fizice neînregistrate. Comisionul curge
**exclusiv dintr-un abonament Menuvia activ și plătit**, niciodată din recrutare.

## 1. Reguli nenegociabile (aliniate cu CLAUDE.md)

1. **Bani = gate în RPC/RLS, nu UI.** Toate scrierile de comisioane/plăți trec
   prin RPC `SECURITY DEFINER` cu `search_path = public, pg_temp`, PUBLIC zero
   EXECUTE — aceeași convenție ca cele 7 RPC de lockdown (096A/B/C).
2. **Lockdown-ul 096 (REVOKE+RLS) NU protejează comisioanele**, fiindcă singura
   cale de scriere e webhook-ul sub `service_role` (BYPASSRLS + owner pe tabele).
   Singura barieră reală contra `service_role` e **CONSTRAINT TRIGGER** — ca în
   096C. Invariantele financiare se impun prin triggere care `RAISE`, nu prin RLS.
3. **Imutabilitate auditabilă, nu tăcută.** Ledger-ul de bani e append-only impus
   de trigger care `RAISE` pe UPDATE/DELETE — niciodată `do-instead-nothing`
   (filtrare tăcută, interzisă de CLAUDE.md la fel ca la `slug`).
4. **Comisionul curge doar din abonament real plătit (Plan 3).** Niciodată din
   recrutare per se, niciodată cu taxă de intrare pentru afiliat (anti-piramidal).

## 2. Modelul de comisioane (parametri ficși)

| Componentă | Valoare | Condiție |
|---|---|---|
| **Setup fee** | 30% din prima factură | one-time; **hold 60 zile**; clawback total dacă restaurantul face churn/refund în fereastră |
| **Recurring** | 10% lunar | **plafonat la 12 luni** per restaurant (nu pe viață) |
| **Cascade (sub-afiliat)** | 2% din comisioanele efectiv plătite ale sub-afiliatului | **1 singur nivel**; doar pe comisioane post-clawback |
| **Tier (Faza 2)** | 30/35/40% setup, 10/12/15% recurring | **forward-only** — se aplică doar restaurantelor aduse DUPĂ atingerea pragului; niciodată retroactiv |
| **Enterprise** | cap absolut €/restaurant | comisionul nu scalează liniar cu prețul mare |
| **Currency** | calcul intern RON | curs BNR lock la data facturii; plată în EUR; afiliatul suportă conversia |
| **Re-attribution** | același afiliat | dacă restaurantul revine la Plan 3 în < 90 zile |

### De ce cap 12 luni (nu pe viață)
- **Economic:** recurring pe viață = rentă perpetuă care comprimă marja exact când
  scalezi. Cap 12 luni reduce expunerea LTV de la ~13% la ~5%.
- **Legal:** plata recurentă nelimitată întărește riscul de reclasificare contract
  de muncă. Comisionul mărginit + performance-based ajută la apărare.
- **Notă juridică:** vezi §6 — clauza de plafonare 12 luni **nu** se scrie ca
  renunțare la un drept imperativ (ar fi nulă); se exprimă ca **durata
  contraprestației**, recital expres că remunerația 10%/12 luni constituie deja
  întreaga contraprestație pentru orice avantaj de clientelă adus.

### Break-even (orientativ, €29/lună Plan 3)
- COGS estimat/restaurant: Stripe ~3% + infra + suport ≈ €4.87/lună → marjă brută ~€24.
- Comision recurring + cascade: €3.48/lună = ~14% MRR (cu cap 12 luni, expunere mărginită).
- Setup 30% = €8.70 one-time; **hold 60 zile** elimină plata pe churn-ul precoce.
- **Pragul roșu:** la tier 15% recurring + lifetime, marja netă post-impozit scădea
  sub 10% = neviabil. Cap-ul 12 luni e protecția structurală.

## 3. Atribuire (decizia centrală a auditului)

**Problema:** Stripe e ancorat pe `profiles` (1 customer/subscription UNIQUE per
user), iar planul e un scalar pe profil care „fanează" la toate restaurantele
owner-ului via `get_restaurant_features`. La momentul checkout-ului, `restaurant_id`
nici nu există încă.

**Decizie fazată:**
- **MVP = atribuire profile-bound** (afiliat → profil al userului care cumpără).
  Suficient pentru lansare cu primii afiliați + payout manual.
- **Restaurant-level billing = backlog (Faza 5)** — `restaurant_subscriptions` +
  rescriere `get_restaurant_features`. Necesar doar când apare un owner
  multi-restaurant ca vector de fraudă SAU vrei cascade/recurring per-restaurant.

**Mecanică MVP:**
1. `menuvia.ro/r/:cod` → setează cookie 90 zile + capturează `referral_code`.
2. La signup/checkout, `stripe-checkout.js` pune `referral_code` în
   `subscription_data.metadata` (supraviețuiește pe subscription, citibil în
   `invoice.paid`) → **elimină race-ul orphan** (invoice.paid înainte de
   checkout.session.completed).
3. La primul `invoice.paid` cu `billing_reason='subscription_create'` → setup fee.
4. La `subscription_cycle` → recurring (max 12).

**Risc rezidual MVP:** owner multi-restaurant cumpără prin link afiliat → comision
pe 1, dar entitlement deblochează gratis toate N. Mitigare: la lansare, limitezi
afiliații la owneri single-restaurant SAU cap manual.

## 4. Anti-fraud (ce e implementabil ACUM)

Semnalele de device fingerprint / IP **nu există** în `table_sessions` (mig 084) —
un scoring 0-100 ar fi „teatru hrănit cu zerouri". Anti-fraud-ul real disponibil
azi este **economic**, nu comportamental:

| Gate | Regulă | Sursă de date |
|---|---|---|
| **Self-referral** | `referred_profile_id == affiliate.profile_id` → comision 0 | profile==profile (determinist, fără CUI/IBAN) |
| **Setup pe activitate reală** | setup plătibil doar după ≥ N comenzi de la ≥ M sesiuni/device-uri QR distincte + ≥1 plată non-owner în 2 luni | `orders`, `qr_scans` (existente) |
| **Incrementality** | `profiles.created_at < affiliate_touch.created_at` → organic, exclus | `affiliate_touches` (timestamp) |
| **Hold / rolling reserve** | setup hold 60 zile; rezervă 20% pe recurring până la fereastra de chargeback | ledger |
| **Cap 12 luni** | invariant în schemă (partial unique / trigger count pe billing_period) | ledger |

CUI/IBAN/card-fingerprint graph + Stripe Connect = backlog (review-only), doar când
apare fraudă de volum și există entitate + politică de retenție (GDPR).

## 5. Payouts (doar entități care facturează)

**Decizie:** **zero afiliați persoană fizică neînregistrată.** Doar PFA/SRL care
emit factură. Motiv: dacă plătești PF cu reținere 10% la sursă, **Menuvia devine
plătitor de venit** → D100 lunar + D205 anual + răspundere ANAF = job de
contabilitate full-time pentru un solo-dev. Cerând factură, responsabilitatea
fiscală trece integral la afiliat; Menuvia plătește o factură ca orice furnizor.

**Flow:**
```
Cron lunar → draft → awaiting_invoice → invoice_matched → processing → paid | failed | on_hold
```
- `invoice_matched` = factura inbound confirmată (prin **Oblio**, integrarea
  existentă mig 041 — NU client SPV bespoke) pe `(cui_emitent, total, perioadă)`.
- Niciun buton UI nu sare peste `invoice_matched` — gate în RPC `SECURITY DEFINER`.
- **Idempotency payout:** `customerTransactionId` = UUID **persistat în DB**
  (`gen_random_uuid()`), nu derivat în cod. Wise e **două call-uri** (create
  transfer + fund) cu idempotency diferită → state machine pe 2 faze +
  **reconciliere-prin-GET înainte de orice resubmit**. Niciodată re-trimitere oarbă.
- Min payout €25, **carry-forward** (legal — datorie nestinsă, nu anulată).
- Sold negativ (clawback > comision): carry-forward + cap de pierdere; nu urmărești
  afiliatul pentru cash.
- Provider: **Wise Business** (CSV manual la început → API la scalare). NU Stripe
  Connect (nu rezolvă povara fiscală RO, cere KYC per-afiliat).

## 6. 🔴 BRIEF AVOCAT — întrebări exacte

> Riscul **#1 existențial = reclasificarea în contract de muncă** (nu indemnizația
> de clientelă, care e secundară). Niciun fix de cod nu-l atinge; mitigarea e
> contractuală + operațională.

1. **Tip de contract.** Confirmă: **contract de prestări servicii de
   marketing/lead-generation** (NCC art. 1851/1349), NU contract de agenție
   (NCC art. 2072+). Verifică formularea care RUPE elementele agenției:
   afiliatul **nu negociază, nu semnează în numele Menuvia**, restaurantul
   contractează direct cu Menuvia.

2. **Indemnizație de clientelă (NCC 2082-2095).** E un drept imperativ, renunțarea
   anticipată e nulă. Întrebare: confirmă că o **clauză de plafonare la 12 luni**
   ar fi nulă (renunțare parțială anticipată) și că apărarea corectă e (a) ruperea
   elementelor de agenție pe fond + (b) recital expres că remunerația 10%/12 luni
   constituie deja **întreaga contraprestație** pentru orice avantaj de clientelă.

3. **Reclasificare contract de muncă (art. 7 CF).** Cum structurăm comisionul ca
   **performance-based pe conversie reală** (nu plată fixă lunară) ca să rămânem
   > 4/7 criterii de independență? Ce clauze de **non-exclusivitate reală** (fără
   program impus, fără instrucțiuni, afiliatul are mai mulți clienți) sunt necesare?

4. **PFA vs SRL — nuanță inversă.** Confirmă: **PFA ocazional = risc minim** de
   agenție (NCC 2072 exclude prestația ocazională); **SRL dedicat volum mare =
   candidatul REAL** la recalificare/agenție. Cum tratăm contractual afiliatul SRL
   cu volum mare și exclusivitate de facto?

5. **Anti-piramidal (Legea 363/2007 + Directiva 2005/29/CE, ECJ 4finance C-515/12).**
   Confirmă că modelul 2% / 1 nivel pe abonament real e safe. Lista „NICIODATĂ":
   fără comision pe simpla recrutare, fără taxă de intrare/kit afiliat, fără
   recompensă condiționată de abonarea proprie a afiliatului, fără >1 nivel
   nelegat de vânzare reală, fără „câștiguri garantate din echipă".

6. **Cross-border.** Limităm afiliații la **rezidenți fiscali RO** până construim
   fluxul reverse-charge pentru nerezidenți? (decizie de scop pentru lansare)

7. **GDPR.** DPA cu afiliații (CUI/IBAN), registru de prelucrări, temei = executare
   contract + obligație legală; retenție fiscală (5-10 ani) prevalează asupra
   dreptului la ștergere — confirmă formularea.

## 7. 🟡 BRIEF CONTABIL — întrebări exacte

1. **TVA pe comision.** Comisionul afiliatului PFA/SRL plătitor de TVA poartă
   **21% B2B servicii** (Legea 141/2025: standard 21%, redus unic 11% din
   1 aug 2025) — cost real care trebuie bugetat peste cei ~14% MRR. Comisionul
   afiliatului = **bază fără TVA**, TVA-ul afiliatului = linie derivată. Confirmă.
2. **Deductibilitate.** Ce documentație cere ANAF ca să nu conteste cheltuiala cu
   comisionul: contract + factură (e-Factura/SPV) + dovada conversiei (cod afiliat
   → restaurant → abonament activ)?
3. **e-Factura.** Confirmă data exactă a obligativității B2B pentru facturile
   inbound afiliat → Menuvia și ce înseamnă „validare" din partea Menuvia
   (confirmare în SPV pe CUI destinatar, nu garantarea emiterii altcuiva).
4. **Provizion indemnizație clientelă.** Modelăm ca **parametru în raportarea
   existentă** (rată provizion × comision trailing-12m al afiliaților peste prag),
   NU tabel/RPC nou. Confirmă tratamentul contabil.
5. **Plafon TVA.** Confirmă plafonul de scutire 2026 (395.000 RON, OG 22/2025) și
   pragul la care un afiliat PFA devine plătitor (impact pe +21% comision).

## 8. Plan de implementare (faze)

| Fază | Conținut | Stare |
|---|---|---|
| **0** | Hardening webhook (idempotență durabilă + `invoice.paid` + payload complet) | ✅ |
| **1** | Fundația contabilă: ledger append-only (WORM) + cents/currency + RPC comision (097/097B) | ✅ |
| **2** | Atribuire profile-bound + anti-fraud economic (097C); checkout/webhook wiring; `/r/:cod` | ✅ |
| **3** | UI panou afiliat: 4 tab-uri, dashboard RPC (097D), `useAffiliate`, `/afiliat`, QR | ✅ |
| **4** | Legal + TVA: contract avocat (brief mai jos); seed VAT 11/21 implementat (mig 102) | brief gata; cod ✅ |
| **5** | Payouts: schema + state machine + batch RPC (098). **Plată manuală** până la Wise sandbox | ✅ schema; Wise = backlog |
| **P0** | Corectitudine financiară: clawback refund/dispute + setup pe prima factură reală + gate Plan 3 pe `price.id` (mig 099) | ✅ |
| **P1** | Incrementality reală (touch server-side, mig 100) + cron payout catch-up + teste SQL în CI | ✅ |
| **P2** | Recrutare sub-afiliați (parent_code în UI) + date de plată afiliat (`upsert_payout_profile`, mig 101) + seed VAT 11/21 (mig 102) | ✅ |
| **6** | Doar dacă scalează: `restaurant_subscriptions`, Wise automat, Stripe Connect, fraud-graph CUI/IBAN | backlog |

## 10. Runbook payout (MVP manual)

Cron-ul (`automation-cron.js`, ziua 1 a lunii la 04:00) cheamă
`run_affiliate_payout_batch` care creează **DOAR draft-uri** din soldul plătibil
(`eligibil − în-zbor`). Nu mișcă bani. Operatorul avansează manual fiecare draft:

1. **Review draft** — verifică suma (`affiliate_payouts.gross_cents`) și soldul afiliatului.
2. `draft → awaiting_invoice` — cere afiliatului factura (PFA/SRL, e-Factura/SPV).
3. `awaiting_invoice → invoice_matched` — după ce factura e confirmată (Oblio/SPV),
   setează `invoice_number`.
4. `invoice_matched → processing` — trimite banii prin Wise (UI/CSV), setează `wise_transfer_id`.
5. `processing → paid` — la confirmarea Wise. **Triggerul inserează automat debitul
   în ledger** (decontare WORM-compatibilă); balanța afiliatului scade.
   - `processing → failed` (IBAN invalid) → soldul redevine plătibil luna următoare.
   - `processing → on_hold` (ambiguu) → reconciliere manuală.

Invariante impuse de DB (mig 098):
- tranziții ilegale respinse (state machine trigger);
- niciun revert spre stări pre-transfer după ce există `wise_transfer_id` (anti dublă-plată);
- `paid`/`canceled` = terminale;
- idempotency: un singur batch per (afiliat, perioadă); `wise_customer_txn_id` = UUID persistat.

### Automatizare Wise (backlog, NEACTIVAT)
Înainte de a automatiza pașii 4-5, **validează în sandbox Wise**:
(a) idempotența `POST /transfers/{id}/payments` (fund-step) pe `transfer_id`;
(b) comportamentul la reutilizarea `customerTransactionId` după X ore (TTL nepublicat).
Designul cere **2 faze** (create transfer + fund) cu **reconciliere-prin-GET înainte de
orice resubmit** — niciodată re-trimitere oarbă. Vezi auditul E7/D7.

## 9. Istoric decizii (de ce arată așa)

- **Decizia #1 (doar PFA/SRL):** elimină withholding, D100/D205, CNP din DB,
  povară fiscală — converge din auditul legal + payouts.
- **Decizia #2 (cap 12 luni):** protecție economică (rentă perpetuă) + legală
  (reclasificare).
- **Decizia #3 (atribuire profile-bound MVP):** atribuirea pe `restaurant_id` e
  structural imposibilă la checkout (Stripe legat de profil, restaurant_id nu
  există încă) — amânată la Faza 5.
- **Răsturnări de audit:** (a) indemnizația de clientelă degradată de la „cel mai
  grav risc" la risc de coadă; (b) `vat.ts` e deja data-driven, nu hardcodat —
  fix-ul real e seed 11/21, nu rescriere; (c) gate-ul payout e prin Oblio
  existent, nu client SPV bespoke; (d) idempotency Wise cere 2-faze +
  reconciliere-prin-GET, nu o singură cheie.
- **Decizia #4 (RLS own-only pe date sensibile, mig 103 + 104):** review-ul
  adversarial a prins o clasă de leak — policy-urile de SELECT pe
  `affiliate_payout_profile`, `affiliate_payouts` (mig 103) și apoi
  `affiliate_attributions`, `affiliate_ledger` (mig 104) refoloseau
  `affiliate_visible_ids()` (own + sub-afiliați), expunând către părinte prin
  orice client PostgREST: IBAN/CUI + sumele de plată, dar și `stripe_customer_id`/
  `referred_profile_id` (PII-ul clienților downline-ului) și ledger-ul (venitul
  exact al sub-afiliatului). Comentariul din mig 097 recunoștea că aceste coloane
  sunt sensibile, dar se baza pe „frontend-ul nu le citește" — nu o barieră reală.
  Fix: SELECT restrâns la `profile_id = auth.uid()`. Dashboard-ul (SECURITY
  DEFINER) expune deja exact cât trebuie pentru downline (doar `attributions_count`
  agregat) ocolind RLS → zero impact UI. `affiliate_visible_ids()` rămâne pe
  `affiliates` (enumerarea sub-afiliaților — fără PII). Regresie acoperită de
  `tests/sql/affiliate_payout_rls_assertions.sql` (RLS1–RLS6, rulează ca rol
  authenticated; cu control negativ verificat).
- **Decizia #5 (audit expert end-to-end → corectitudine plăți, mig 105/106 + webhook):**
  Audit pe 10 zone cu verificare adversarială → 1 P0 + mai multe P1 financiare, reparate:
  (a) **PAYOUT-1** (P0) — decontarea insera `-gross` la →paid fără re-validare, deci un
  clawback între draft și plată ducea la cash pe comision stornat → mig 106 impune
  invariantul `eligibil_net ≥ deja_plătit + gross`; (b) **AFF-LEDGER-1** — setup fără
  unicitate pe atribuire → dublă plată 30% la race → mig 105 index parțial unic; (c)
  **PAYOUT-2/AFF-E2E-1** — payout 'failed' cu transfer inițiat elibera gross-ul și
  'processing' se putea atinge fără `wise_transfer_id` → mig 106 impune `wise_transfer_id`
  la processing și păstrează gross-ul angajat pentru on_hold + failed-cu-transfer
  (eliberare doar prin →canceled); (d) **STRIPE-1** — eșecul clawback-ului era înghițit
  → acum setează processingError → 500 → Stripe retrimite (idempotent); (e) **STRIPE-2** —
  `invoice.lines[0]` ≠ linia de subscription la proration → selecție explicită prin
  `PLAN_BY_PRICE`. RLS-ul a ieșit curat. Regresii: PO7b/PO8/PO9 + AF9.
