# Analiză critică Menuvia — raport complet pe capitole

> **Scop:** evaluare dură, exclusiv pe aspectele negative, cu note pe capitole și dovezi `file:line`.
> **Metodă:** 3 audituri automate independente (2× securitate/RLS pe migrații, 1× arhitectură frontend) + metrici culese direct din repo + verificări țintite. Auditurile de business/perf/ops/UX au fost planificate dar au lovit limita de sesiune — capitolele respective sunt acoperite din verificări directe, marcate ca atare.
> **Data:** 2026-06-14. Branch: `main` (după PR #40–#42).
> **Notare:** 1–10, unde 10 = fără probleme. Penalizează exclusiv negativul, conform cererii. Un produs „care merge" poate primi 3–5 dacă datoria tehnică/structurală e mare.

---

## Verdict global

| Capitol | Notă |
|---|---|
| 1. Testare | **2.0** |
| 2. Accesibilitate | **2.5** |
| 3. State & data layer | **3.0** |
| 4. Proces & mentenabilitate | **3.0** |
| 5. Arhitectură frontend | **3.5** |
| 6. Securitate (RPC/RLS) | **4.0** |
| 7. Stabilitate schemă DB | **4.0** |
| 8. Performanță & scalabilitate | **5.0** |
| 9. Produs & business | **5.0** |
| 10. Cod & type-safety | **5.5** |
| 11. Observabilitate & ops | **6.0** |
| **MEDIE PONDERATĂ** | **≈ 3.9 / 10** |

**Teza centrală:** Menuvia e un MVP funcțional, surprinzător de matur pe câteva fronturi (webhook Stripe, bridge fiscal, fluxul QR end-to-end), dar stă pe o **fundație frontend nementenabilă** și pe o **schemă patch-uită agresiv**, iar cele două reguli de business „nenegociabile" (regula de aur fiscală + poarta de sesiune QR) sunt **ocolibile prin RPC** din cauza unei boli sistemice: *„adaug o migrație nouă în loc să închid semnătura veche"*. Riscul real nu e „nu funcționează" — e **„nu poate fi schimbat în siguranță de altcineva decât autorul" + „expune legal exact promisiunea pe care o vinde"**.

---

## 1. Testare — **2.0 / 10** (cel mai slab capitol)

- **CRITIC — 7 fișiere de test pentru ~50.000 LOC** (~1.5% din linii), **toate în `src/lib/` și `src/schemas/`**. Zero teste pe componente/pagini (74 fișiere).
- **CRITIC — `createOrder` (calea banilor) complet netestat.** `src/lib/orders.ts:231` conține fast-path online, fallback offline (`navigator.onLine`), `TypeError('network-error')`, `savePendingOrder` — adică exact logica fragilă. `src/lib/__tests__/orders.test.ts:3` importă doar `orderSubtotal` + `describeAuditEntry` (2 formatare pure). `advanceOrderStatus`, `applyOrderDiscount`, `addPartialPayment`, `requestFiscalReceipt` — 0 teste.
- **CRITIC — regula de aur n-are niciun test.** Niciun test pe `lib/plans.ts`, `lib/features.ts` (`planTier()`), `hooks/useFeatures.ts`. Singura regulă „nenegociabilă" (bani+bon=Plan 3) nu e protejată client-side contra regresiilor.
- **CRITIC — zero teste de componentă.** Cele 6 god-components (App, ProductsTab, StocksTab, PublicMenuPage, WaiterPage, QrMenuPage) — toate suprafețe UX critice — 0 acoperire.
- **MARE — `lib/` e majoritar netestat:** `qr.ts` (fetch meniu public + `socialUrl`), `offlineSync.ts` (coadă de sincronizare — corectitudine critică), `invoices.ts`, `happyHour.ts`, `cashShifts.ts`, `health.ts`.
- **MARE — Playwright E2E e „green-washing".** `.github/workflows/ci.yml:86` `continue-on-error: true` → E2E cronic roșu nu blochează niciodată merge-ul; nimeni nu-l privește. Verde fals.

## 2. Accesibilitate — **2.5 / 10**

- **CRITIC — interacțiunea principală a clientului e un `<div onClick>` inaccesibil la tastatură.** `src/pages/QrMenuPage.tsx:621` — fiecare card de produs e `<div onClick={() => setActiveProduct(product)}>` cu `cursor:pointer` + animație doar pe mouse (`onMouseDown`/`onMouseUp`). Fără `role`, `tabIndex`, `onKeyDown`. Utilizatorii de tastatură/screen-reader **nu pot deschide un produs** pe pagina de comandă.
- **CRITIC — `role`/`tabIndex`/`onKeyDown` = 0** pe ambele pagini publice (QrMenuPage + PublicMenuPage). Din 31 `onClick`, 19 pe elemente non-button. Modalele se închid doar prin click pe backdrop — fără Escape, fără focus trap (`QrMenuPage.tsx:1024`).
- **MARE — 10 `<img>`, toate fără `alt`.** Imaginile de produs/meniu n-au alternativă text.
- **MARE — doar 44 atribute `aria-*`** în 74 fișiere. Butoanele icon-only (Cheamă ospătarul / Cere nota, `QrMenuPage.tsx:899,930`) n-au label accesibil.

## 3. State & data layer — **3.0 / 10**

- **CRITIC — React Query instalat, montat, NEFOLOSIT.** `QueryClientProvider` activ (`App.tsx:2276`), `queryClient.ts` configurat 100+ linii, dar `useQuery`/`useMutation` apar de **0 ori** în `src/components`+`src/pages`. Singurul consumator (`useOrdersQuery.ts`) nu e importat nicăieri. Greutate de bundle + semnal arhitectural fals.
- **CRITIC — componentele intră direct în Supabase.** 19 apeluri `supabase.from(...)` în componente/pagini vs doar 8 în `lib/` — stratul de date e ocolit mai des decât folosit. Worst: `ModifiersTab` 5, `TablesManager` 4, `OnboardingPage` 3. Fără graniță de repository; erorile RLS/business sunt tratate ad-hoc.
- **MARE — singurul „state management" sunt 2 Context-uri subțiri + `useEffect(fetch)` peste tot.** 9 `eslint-disable react-hooks/exhaustive-deps` pe effect-uri de fetch (`StocksTab:361,939,1121`, `ReportsTab:291`, `VatReportTab:61`, `DashboardPage:635`, `TeamManager:148`, `useFeatures:39`, `useRestaurantModules:64`) — fiecare un bug latent de stale-data.

## 4. Proces & mentenabilitate — **3.0 / 10**

- **CRITIC — bus factor = 1.** Istoric git: **124/154 commit-uri „Claude", 21 fondator, 9 unknown**. Produsul e construit ~80% de AI, cu review uman independent subțire. Dacă pleacă unica persoană care înțelege întregul, nimeni nu poate prelua în siguranță.
- **MARE — PR-uri mergeuite cu CI roșu.** PR #40 a intrat în main cu typecheck rupt (6 erori TS) → a fost nevoie de PR #41 de reparație. Branch protection nu forțează verde; disciplina de merge e fragilă.
- **MARE — migrații aplicate MANUAL în prod.** Per CLAUDE.md, fondatorul rulează cele 92 de migrații copy-paste în Supabase SQL Editor. Fără runner automat → risc de divergență schemă-prod vs repo, fără rollback, fără audit al stării reale.
- **MEDIU — `docs/` parțial nesincronizat:** `AUDIT.md`, `ITER10-CHANGELOG.md` reflectă stadii vechi.

## 5. Arhitectură frontend — **3.5 / 10**

- **CRITIC — god-components extreme.** `App.tsx` 2292 linii înghesuie router + auth guard + `LandingPage` (645 linii) + `PricingPage` (1098 linii) + 404 + hook checkout — ≥6 responsabilități. `ProductsTab.tsx` 2012 (din care `ProductModal` ~1200 linii face upload storage + fetch VAT + extras/pairings/recipes + calcul margine + 159 `style={{}}` inline). `StocksTab` 1976, `PublicMenuPage` 1852, `WaiterPage` 1366, `DashboardPage` 1259. Niciun fișier mare nu e orchestrator subțire.
- **CRITIC — design system mort.** `src/components/ui/` (17 componente: Modal, Button, Card…) e folosit aproape deloc (**Modal: 0 importuri**, Card: 1, Button: 2), shadow-uit de un al doilea kit `_dashboard/sharedUI` (cel folosit efectiv). Două sisteme întreținute, zero folosit consecvent.
- **MARE — 2.782 blocuri `style={{}}`** inline, zero reuse (`borderRadius:` de 675 ori); **357 culori hex hardcodate** în ciuda token-urilor `D` (worst: OrderTracker 32, App 32, QrMenuPage 31). Schimbare de brand = find-replace în 357 locuri.
- **MARE — duplicare:** backdrop de modal copy-paste în **34 fișiere**; `whatsappUrl` reimplementat (`App.tsx:64`) pe lângă `socialUrl`; `formatPrice` reinventat ca `${x.toFixed(2)} lei` în zeci de locuri; toast în 2 implementări.

## 6. Securitate (RPC/RLS) — **4.0 / 10**

> Webhook Stripe (`netlify/functions/stripe-webhook.js`) e **exemplar**: signature verification, idempotență via `stripe_events`, 500-pe-eroare-DB pentru retry, downgrade pe cancel. Bridge fiscal: `device_secret` 256-bit, scoping corect pe `restaurant_id`. **Dar** suprafața de RPC anonim are găuri reale, două critice.

- **🔴 CRITIC — bypass complet al porții de sesiune QR (mig 088).** Supraîncărcarea veche `create_order` cu **10 argumente** (mig 046, fără `p_session_id`) **nu a fost niciodată DROP-uită**. Mig 084/088 a creat o semnătură nouă cu 11-arg — dar în Postgres semnătură diferită = funcție diferită. Cea veche e tot `granted to anon` și n-are guard de sesiune pe ramura `qr`. Anon poate apela direct versiunea 10-arg și ocolește mig 088. **Fix:** `drop function if exists public.create_order(uuid,text,uuid,uuid,text,jsonb,uuid,timestamptz,text,text)`.
- **🔴 CRITIC — regula de aur ocolibilă în `advance_order`.** Branch-ul `mark_paid` (mig 085:170-189, oglindit 087:189-208) setează `status='paid'` (stare fiscală terminală, rezervată Plan 3) **fără niciun gate de plan**. Comentariul admite „gate fiscal e separat (Gate E follow-up)" = nu există. Un restaurant `free`/`starter` poate marca o comandă ca `paid` (bon fiscal). Încalcă direct singura regulă nenegociabilă. **Fix:** `perform enforce_feature_for_restaurant(v_order.restaurant_id, 'fiscal_receipt')` la începutul branch-ului (helper-ul există deja, folosit pe `close_order`).
- **🔴 CRITIC — backbone-ul RLS fără `search_path`.** `my_role()`, `is_admin()`, `is_member()` (mig 005:17/28/40) sunt SECURITY DEFINER **fără `set search_path`** și niciodată redefinite → vii în schema finală. Sunt fundamentul tuturor politicilor RLS. **Fix:** `set search_path = public, pg_temp`.
- **🟠 MARE — `submit_order_feedback` (mig 043:82) anon, fără sesiune,** cu `on conflict do update` → cine ghicește un UUID de comandă suprascrie feedback-ul oricărui restaurant. Mig 092 a pus session-gate pe tracking/bon dar a uitat ăsta.
- **🟠 MARE — `mark_paid` acceptă sume negative** (`p_paid_amount`/`p_tips_amount`) fără validare de semn → venituri/bacșișuri corupte.
- **🟡 MEDIU — `invite_tokens` `USING(true)`** (mig 007:131) expune `email`/`role`/`token` la anon (enumerare PII + bearer token). `restaurants public read` (mig 013:142) întoarce **toate** restaurantele active (enumerare tenant). `record_page_view`/`record_qr_scan` fără rate-limit și fără validare cross-tenant.
- **🟡 MEDIU — `call_waiter`** verifică doar `is_active`, nu `expires_at`; rate-limit-ul se redeschide la rezolvare → spam prin alternarea `waiter`/`bill`.
- **🟡 MEDIU — `owner_plan`, `log_ai_import`, `check_ai_import_quota`, `bootstrap_restaurant_owner`** (mig 013/004) — încă fără `search_path`.

## 7. Stabilitate schemă DB — **4.0 / 10**

- **MARE — 17 din 92 migrații sunt explicit „fix/hotfix/hardening/bugfix" (~18%).** Fiscal payload-ul singur a avut 4 runde (050→053); `create_order` rescris de ≥3 ori; RLS reparat în 005/008/013/056. Domeniul cu bani e cel mai instabil.
- **MARE — boala sistemică „semnătură nouă în loc de fix".** Cele 2 bypass-uri critice (§6) și `advance_order` duplicat în 085+087 (orice schimbare oglindită manual) sunt aceeași cauză: funcții vechi rămase vii lângă cele noi.
- **MEDIU — numerotare vs timestamp divergente.** Mig 003 are timestamp `20260525000300`, dar și 092 e `2026...` — ordonarea după nume ≠ după timestamp; capcană documentată chiar în CLAUDE.md.
- **MEDIU — 3 surse de adevăr pentru limitele de plan:** `plans.ts` (TS) + `usePlanLimits.ts` (fallback) + DB `plan_features`/`plan_limits`, sincronizate manual (mig 089). Drift garantat în timp.

## 8. Performanță & scalabilitate — **5.0 / 10** *(verificat direct)*

- **MARE — polling în loc de realtime peste tot.** `setInterval` la 6s (banner comenzi), 10s (kitchen), 15s. Pe un restaurant aglomerat cu N mese deschise, fiecare client + dashboard-ul polează → încărcare DB liniară cu traficul, inutil. Realtime Supabase e folosit parțial, dar polling-ul domină.
- **MARE — `qrcode` import static, fără code-split.** `TablesManager.tsx:10` `import QRCode from 'qrcode'` — nu e în `manualChunks` (vite.config doar recharts+jspdf), deci intră eager în chunk-ul tab-ului. (jspdf e corect lazy via `await import`.)
- **MARE — `recharts` import static** în `ReportsTab.tsx:16` + `AnalyticsTab.tsx:18`. E în `manualChunks` (chunk separat), dar tot se încarcă la intrarea pe tab, nu la nevoie (fără `React.lazy` pe componenta de grafic).
- **MEDIU — liste fără virtualizare.** Un meniu la limita planului (1000 produse) se randează integral inline în QrMenuPage — pe mobil/4G, jank garantat.
- **POZITIV (anti-fals-pozitiv):** încărcarea meniului public NU e N+1 — `fetchMenuForRestaurant` (`lib/qr.ts:292`) batch-uiește 5 query-uri fixe indiferent de catalog. E singura cale de date scrisă corect.

## 9. Produs & business — **5.0 / 10** *(verificat direct)*

- **MARE — planul care justifică toată complexitatea (Fiscalizare, 499 lei) nu se vinde self-serve.** `plans.ts` + CTA-ul din PricingPage: `pro` = pilot WhatsApp, fără checkout Stripe. Venitul recurent real azi e **99–249 lei** (Meniu Digital / Meniu + Comenzi), iar planurile cu comenzi **nici nu procesează plăți in-app** — banii rămân pe casa existentă. Întreaga miză fiscală/ANAF (bridge FiscalNet, Oblio, TVA) e construită pentru un tier care încă nu e vandabil.
- **MEDIU — „Scor meniu" promite altceva decât livrează.** E health-score de cont (login/comenzi/echipă din `lib/health`), nu audit de conținut al meniului (poze/alergeni/prețuri lipsă). Marketat ca „cât de bine vinde meniul tău".
- **MEDIU — feature bloat.** ~15 domenii (meniu, comenzi, kitchen, waiter, stocuri, rețete, TVA, casă, facturi, rezervări, happy hour, floor plan, health, AI import, multilingv) pentru un produs care vinde „adaugi meniul → QR → comenzi". Rezervările sunt ascunse în MVP; multe tab-uri sunt half-baked pentru un singur fondator de întreținut.
- **MEDIU — conformitate RO 2024-2026 neadresată vizibil:** e-Factura/e-TVA obligatorii — produsul vinde „fiscalizare" dar fără dovadă că acoperă obligațiile ANAF curente (doar bridge hardware pilot).

## 10. Cod & type-safety — **5.5 / 10**

- **MARE — 12 funcții Netlify, toate `.js`** (`netlify/functions/*.js`) — zero type-safety exact pe stratul cu bani (Stripe) și fiscal (Oblio). O greșeală de câmp în webhook nu e prinsă la build.
- **MEDIU — 22 `any`/`ts-ignore`/`eslint-disable`** în `src/` — puține relativ, dar pe căi sensibile.
- **MEDIU — 37 blocuri `catch` care înghit erori** (`} catch {`) — multe legitime (private-mode localStorage), dar diluează semnalul real al eșecurilor.
- **POZITIV:** TS strict activ, fără secrete în `src/`, REVOKE-uri intenționate înainte de GRANT.

## 11. Observabilitate & ops — **6.0 / 10** *(verificat direct)*

- **POZITIV:** Sentry wired (`main.tsx:19`, defer post-paint), scheduled functions reale (`netlify.toml`: email queue 5min, automation-cron 15min, oblio-generator 2min) → cron-ul GDPR și cozile chiar rulează.
- **MEDIU — observabilitate doar pe frontend.** Funcțiile Netlify loghează cu `console.log`; fără logging structurat/alerting dincolo de o funcție Slack de health. Un webhook eșuat silențios în prod e invizibil până la reclamație.
- **MEDIU — fără strategie de DR pe schemă** (vezi §4): migrații manuale, fără snapshot/rollback documentat.

---

## Plan de remediere prioritizat

### P0 — înainte de orice client real plătitor (toate SQL, ~2-3 ore)
O singură migrație **094** + assertion-uri CI pentru fiecare:
1. **Gate fiscal pe `mark_paid`** în `advance_order` (mig 085 întâi, oglindit în 087) — închide regula de aur.
2. **DROP `create_order` 10-arg** — închide bypass-ul porții de sesiune QR.
3. **Validare semn** pe `p_paid_amount`/`p_tips_amount`.
4. **`set search_path`** pe `is_admin`/`is_member`/`my_role` (+ `owner_plan`).
5. **Session-gate pe `submit_order_feedback`**.

### P1 — plasă de siguranță (1-2 zile)
6. Teste unitare pe `createOrder` (happy + offline + business-error) și `planTier()` / feature-gate per tier.
7. `revoke select on invite_tokens/bridge_devices from anon`; `restaurants` public read → RPC by-slug.

### P2 — mentenabilitate (1-2 săptămâni, reduce bus factor)
8. Sparge `App.tsx` (extrage `LandingPage`, `PricingPage`, `AppRouter`) și `ProductsTab` (`ProductModal` → sub-componente + `lib/products.ts`).
9. Decide React Query: adoptă-l real SAU șterge-l + `queryClient.ts` + `useOrdersQuery.ts` + kit-ul `ui/` mort.
10. Accesibilitate pagina QR client: `<div onClick>` → `<button>`, `alt`, Escape + focus trap pe modale.

### P3 — strategic
11. Decide soarta tier-ului Fiscalizare: dacă e pilot, scoate-l din funnel-ul principal; dacă e produsul real, prioritizează plăți in-app + conformitate ANAF e-Factura.
12. Realtime în loc de polling; virtualizare liste; `qrcode`/`recharts` lazy.

---

## Anexă — metrici & metodologie

- **~49.986 LOC** frontend (74 fișiere componente/pagini). Top: App 2292, ProductsTab 2012, StocksTab 1976, PublicMenuPage 1852.
- **92 migrații** SQL; 17 explicit de tip fix/hotfix/hardening.
- **7 fișiere test unitar** (toate `lib/`/`schemas/`) + 6 spec E2E (continue-on-error).
- **22** `any`/`ts-ignore`/`eslint-disable`; **37** `catch` goale; **8** TODO/FIXME.
- **154 commit-uri**: 124 Claude / 21 fondator / 9 unknown.
- **12 funcții Netlify** `.js`.
- Surse: 2 audituri securitate/RLS independente pe migrații, 1 audit arhitectură frontend, verificări directe pentru perf/business/ops. Auditurile dedicate de UX/perf/ops/business au lovit limita de sesiune — acele capitole sunt din verificare directă, mai puțin exhaustive decât securitatea/frontend-ul.
