# PLAN RĂMAS — tot ce mai e de făcut (16 sept 2026)

> **Documentul de lucru curent.** `PLAN_0_TO_HERO.md` rămâne DIRECȚIA, `AUDIT_V3_2026-09.md` rămâne RAPORTUL; aici e LISTA, cu owner pe fiecare rând (cod / fondator / terț / decizie) și cu verificarea care poate eșua la fiecare pas. Se actualizează la fiecare item închis, altfel devine documentația care minte.

## Context

Cererea: „Spune-mi TOT ce trebuie să mai facem, fă tot planul."

De ce acum: lanțul de migrații e aplicat integral pe producție (repo = prod = **mig 278**), PR #261 e merged, auditul v3 a închis 30 din 38 de constatări. Ce rămâne NU mai e în principal cod — e operare, cont, bani și decizii. `docs/PLAN_0_TO_HERO.md` (9 aug) rămâne corect ca DIRECȚIE, dar după 5 săptămâni **niciun bloc de fondator nu e bifat**, tabelul lui de date e stale, iar regula lui §4 („nu se mai scrie cod nou până la Faza 3") a fost încălcată de 47 de commit-uri și 21 de migrații — inclusiv de mine.

Cum a fost construit: (1) starea live verificată azi prin Supabase/Netlify/GitHub, nu din memorie; (2) o măturare cu 6 agenți read-only (audit v3, plan-master, reziduuri în cod, checklist-uri docs, CI/ops, scoping cod) → **161 de itemi bruți**; (3) verificare adversarială cu două lentile per item — a rulat pe 26 de itemi (53 de verdicte) înainte ca limita de sesiune să oprească restul; pe ceilalți am făcut eu triajul cu faptele live. Un singur item s-a dovedit deja închis (BLOC-0.1). (4) trei decizii luate de fondator în sesiune.

Rezultatul: o listă cu owner pe fiecare rând (**cod / fondator / terț / decizie**), în ordinea în care contează, cu verificarea care poate eșua la fiecare pas, și cu ce execut eu din repo imediat după aprobare.

## Starea live a producției (verificată 16 sept 2026)

| Fapt | Valoare |
|---|---|
| Utilizatori | **7** (1 nou din 9 aug; 2 neconfirmați); ultimul signup **31 aug** |
| Termeni acceptați | **0 / 7** (PR #261 consemnează de acum; retroactiv nu se poate) |
| Restaurante | 6 — pescaria-malta e **starter fără Stripe** (plan setat manual), 2 enterprise ale fondatorului, 3 free |
| Comenzi | 30 total, **1 în 30 de zile** (31 aug, contul fondatorului) |
| Stripe clienți / abonamente / evenimente | **0 / 0 / 0** |
| Facturi Oblio / bridge devices / afiliați | **0 / 0 / 0** |
| Rezervări | 22 total, **0 în 30 de zile** |
| Coada de email | **4 în așteptare, 0 trimise VREODATĂ**, cea mai veche de 38 de zile |
| Janitoarele pg_cron (mig 274) | toate 8 `succeeded` ✅ — singura automatizare vie |
| MFA pe conturile de platformă | **0 / 2** |
| Baza | 22 MB / 500 MB; `audit_log` 541 rânduri |
| `qr_scans` / `page_views` | 0 / 0 (RPC-urile nu sunt chemate de nimeni) |
| **Netlify deploy PUBLICAT** | **`6a9584cb` din 31 aug** — tot ce e pe main din 31 aug NU e live; plan Free; fără domeniu propriu |
| `/health` | **503** `{db:"down", config:{resend,slack,stripe,ai_platform:false}}` — funcțiile rulează fără env |
| `health-watch.yml` | roșu la fiecare rulare (290 rulări) |
| `db-backup.yml` | roșu la „Verifică secrets" (42 rulări) — **zero backup-uri, vreodată** |
| Supabase advisors | leaked-password protection **OFF**; 41/75 funcții de TRIGGER executabile prin `/rpc` de anon/authenticated (30 DEFINER); 21 politici `auth_rls_initplan`, 85 `multiple_permissive_policies`, 40 FK neindexate, 44 indexuri nefolosite |
| PR-uri deschise | **7**: Dependabot #255/#254/#253 (CI verde), **#249 stripe 14→22 MAJOR**, #83 actions/checkout; **#11 onboarding banner (mai, 207 linii, NU e depășit ca idee — dashboard-ul n-are niciun banner)**, #14 badge (mort: `useActiveOrders` nu mai există) |
| Issue deschis | #250 — **integral valabil** |

## Deciziile luate de fondator în această sesiune

1. **Bacșiș cash în sertar (RES-02)**: *fără preferință* → rămâne DESCHISĂ; codul nu se atinge. Recomandarea mea consemnată: linie separată, sertar net.
2. **Retenție PII oaspeți (RES-33)**: **12 luni** → devine cod (secțiunea B3).
3. **Retenție `audit_log`**: **păstrăm tot** → închis; rămâne în denylist pg_cron.

---

## A. Ce blochează TOT — fondator, ~1 zi de lucru, în ordinea asta

Fiecare pas se termină cu o verificare care poate eșua. Nimic nu e „gata" fără ea.

| # | Acțiune | Verificare | Deblochează |
|---|---|---|---|
| A1 | **Issue #250**: Netlify → Environment variables (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, cele 4 `STRIPE_*_PRICE_ID`, `AI_CONFIG_SECRET`, `HEALTH_DIAG_TOKEN`, `PLATFORM_OPENAI_KEY`, `SLACK_WEBHOOK_URL`; lista corectă e `docs/VPS_RUNBOOK.md:28-78`, NU `.env.example` — vezi B0) + **publică ultimul build de main** (sau VPS-ul din `deploy/`, `docs/VPS_RUNBOOK.md`). ATENȚIE: ghidul spune `WEBHOOK_SECRET`, codul citește **`STRIPE_WEBHOOK_SECRET`** (DOC-1) | `curl -H "x-health-diag: $TOKEN" https://menuvia.netlify.app/health` → `status:ok`, `config.*: true`; `health-watch` verde singur; cele 4 emailuri din coadă pleacă la primul tick | emailuri, SMS, Oblio, rapoarte, payout afiliați, importul AI, tot ce e server-side |
| A2 | **UptimeRobot** gratuit pe `/health` la 5 min (BLOC-0.4/DOC-17) | primești email de test la oprire | detectarea următorului „cron mort 7 zile" |
| A3 | **Backup** (RES-06/BLOC-2.5): GitHub Secrets `SUPABASE_DB_URL` (Session pooler, IPv4) + `BACKUP_PASSPHRASE` → `workflow_dispatch` → descarcă artefactul → **restore de probă** pe un proiect gol prin `RUNBOOK §6.2` cu poarta `tests/sql/privilege_regime_assertions.sql` (§6.3) | `db-backup` verde + artefact; poarta RP1–RP12 trece pe baza restaurată | RPO azi = tot istoricul |
| A4 | **TOTP** pe ambele conturi platform admin (Setări → Cont → MfaCard) + `set_my_mfa_enforced(true)` (RES-17) | login-ul cere codul; `profiles.mfa_enforced = true` pe ambele | singura cale spre datele tuturor tenanților nu mai e doar-cu-parolă |
| A5 | Supabase → Auth → **Leaked password protection ON** (BLOC-2.3, advisor WARN) | advisor-ul nu mai raportează | igienă auth |
| A6 | **Domeniu**: cumpără menuvia.ro (+ codvia.ro), Netlify primary, **Resend → Domains → verified** (DKIM/SPF/DMARC), OSIM/EUIPO 5 min (BLOC-1) | `https://menuvia.ro` încarcă; Resend `Verified`; o rezervare de test → email în inbox (BLOC-3.2) | QR-uri tipărite, emailuri cu identitate, reset parolă, SEO, Codvia |
| A7 | **Escrow** pentru secretele nerecuperabile (`AI_CONFIG_SECRET`, `VAPID_PRIVATE_KEY`, `BACKUP_PASSPHRASE`) într-un manager de parole | poți enumera unde e fiecare | fără el, pierderea contului Netlify = pierderea permanentă a cheilor |
| A8 | **Scriptul de recuperare TVA pe orfani** (`scripts/recover_orphan_vat_snapshots.sql`, RUNBOOK §3.6, DOC-15): previzualizare, apoi aplicare cu `set menuvia.recover_apply='on'` într-o fereastră fără trafic (ia SHARE ROW EXCLUSIVE pe `order_items`) | previzualizarea raportează 16 linii / 447 lei; aplicarea scrie exact atât | raportul TVA al singurului local enterprise raportează azi grupe greșite |
| A9 | **Stripe Dashboard**: Customer Portal ON (OPS-7), verifică versiunea API a endpoint-urilor de webhook (OPS-8), activează Connect (DOC-20) | `stripe-portal` nu mai dă `portal_unavailable`; versiunea notată în RUNBOOK | dunning CTA, comisioane afiliați, plata la masă |
| A10 | **BLOC 3 — testul uman** pe telefonul tău: QR → comandă → Bucătărie; rezervare → email; anulare cu cod; import AI din poză; `/founder` | fiecare rând bifat cu dovadă | poarta FAZA 0 |

**În paralel, cu lead-time lung (BLOC 4)**: SRL la ONRC → cont bancar → Stripe pe firmă (**4 price ID-uri**, nu unul — `stripe-checkout.js:40` face fail-fast pe toate) → SPV/e-Factura + Oblio → avocat pe cele 5 draft-uri din `menuvia-pack/`. **Fără SRL nu se încasează legal primul leu.**

Apoi **FAZA 1 (cel mai mare ROI)**: sună-i pe cei 4 utilizatori reali din iunie–iulie. **FAZA 2**: un singur local pilot.

---

## B. Ce fac eu din repo (cod), în ordinea asta

Regula §4 se respectă: B0–B2 sunt adevăr în documentație, vizibilitate a defectelor și igienă — excepțiile permise. B3 e decis de fondator. B4–B6 sunt feature-uri noi și **rămân după deciziile din C**, nu înainte.

### B0 — PR „documentație care nu mai minte" (S, ~3h, zero cod de produs)

Tiparul pe care CLAUDE.md îl consemnează de trei ori; azi există în 12 locuri:

- `docs/AUDIT_V3_2026-09.md`: RES-35 ✅ (#261); „Aplicarea mig 263 pe prod" ✅ (lanțul e la 278); pașii 8, 9, 10, 11, 13 ✅ (mig 265/264/267/#251/lot); pasul 12 = „alarmă livrată, subțiere ÎNCHISĂ ca decizie: păstrăm tot".
- `docs/GHID_FONDATOR.md:82,132`: **`WEBHOOK_SECRET` → `STRIPE_WEBHOOK_SECRET`** (critical — ghidul pe care îl urmezi la A1 garantează un webhook mort); „5 variabile obligatorii" → lista reală cu fail-fast (6 în stripe-webhook + price ID-uri); monitorul de uptime pe hostul corect.
- `.env.example`: lipsesc 8 variabile vii (`PLATFORM_OPENAI_KEY`, `PLATFORM_ANTHROPIC_KEY`, `AI_CONFIG_SECRET`, …), conține una moartă — se aliniază cu `docs/VPS_RUNBOOK.md:28-78`.
- `docs/RUNBOOK.md`: §3.4 spune oblio la `*/2`, `netlify.toml` are `*/15`; §2 declară netlify.toml „sursa unică a schedule-urilor" și ignoră cele 8 joburi pg_cron; §4.1 spune că health-watch alertează pe `config.*` — nu trimite antetul (vezi B1).
- `docs/PLAN_0_TO_HERO.md`: §0 re-ancorat pe tabelul de mai sus; adaugă #250 în BLOC 0; 3.6 („nimic nu șterge din email_queue" e fals din mig 274); cifrele din §4; căile fără `docs/`; dependența 0.3→1.1.
- `DEPLOYMENT_GUIDE.md` (Node 18, Anthropic ca provider), `README.md` („Stripe Tax", Anthropic), `docs/VPS_RUNBOOK.md` (Node 20 → 22 în pasul copy/paste; `CRON_TRIGGER_KEY`), `docs/E2E_SETUP.md` + `STAGING_CHECKLIST.md` (cer staging pentru o problemă rezolvată; testează facturarea anuală ștearsă), `docs/LOYALTY.md` (spune „neimplementat", mig 226 există), `GO_LIVE.md` referențiat ca activ deși e superseded.
- CLAUDE.md: bullet nou cu deciziile luate (audit_log, retenție 12 luni) și cu capcana `WEBHOOK_SECRET`.

### B1 — PR „defectele devin vizibile" (S, ~4h)

- `health-watch.yml` trimite `x-health-diag` cu secretul `HEALTH_DIAG_TOKEN` și alertează pe `config.*` (OPS-15) — azi RUNBOOK afirmă că o face, dar nu o face; fără asta o cheie revocată e invizibilă.
- **Pinnează `apiVersion`** în toate cele 9 instanțieri `new Stripe(...)` din `netlify/functions/` (OPS-8, jumătatea de cod): un payload cu formă nouă trece semnătura și sare tăcut ramura de comision.
- `sql-verify.yml` pe `postgres:17` (OPS-17): poarta care „prinde bug-uri înainte de Supabase real" rulează pe PG 15, prod e PG 17.
- Migrație **279**: `revoke execute` pe toate cele 41 de funcții de TRIGGER de la `anon`/`authenticated` + clichet de CLASĂ în `tests/sql/privilege_regime_assertions.sql` (nicio funcție `returns trigger` executabilă de roluri client). Inofensiv la runtime azi, dar e suprafață expusă prin PostgREST și advisor WARN.
- CSP: adaugă `report-to`/`report-uri` (OPS-16) — azi Report-Only fără destinație = violările nu ajung nicăieri. Trecerea la enforce rămâne decizie (C).
- `netlify/functions/health.js`: comentariul pragurilor de backlog descrie schedule-uri inexistente (OPS-24).

### B2 — Igienă PR-uri (S, ~2h)

- Merge pe verde, re-citind review-urile înainte: #255, #254, #253, #83.
- **#249 stripe 14→22**: NU se merge-uiește orb — PR propriu care combină bump-ul cu pin-ul de `apiVersion` din B1, rulat prin `tests/functions/` (stripe-webhook/table-payment) + review pe schimbările de tip (`subscriptions.list` e non-async etc.).
- Închide #14 (mort). **#11 onboarding banner**: nu se merge-uiește (bază din mai, `DashboardPage.tsx` are 1.797 linii acum) — se **re-implementează** ca item B4c dacă decizi (e singurul cod care atacă direct locul morții din PLAN §1).

### B3 — Retenție PII oaspeți, 12 luni (M, ~1 zi) — **LIVRAT** (mig 280)

Migrație **280** + `tests/sql/guest_retention_assertions.sql`:
- Inventarul real (SCOPE-33.1): `reservations` (customer_name/phone/email, special_requests), `orders` pickup (customer_name/phone), `sms_queue`, `email_queue` (recipient_*), `order_feedback` (**ip_address + user_agent — nu apar în politica publicată**), loyalty (doar hash).
- Pseudonimizare, NU ștergere: rândurile tranzacționale rămân (obligație fiscală), PII-ul devine `NULL`/`'[anonimizat]'` la **12 luni** de la `starts_at`/`paid_at`; cozile SMS/email: purge pe rândurile terminale la 90 de zile; `order_feedback.ip_address/user_agent`: 30 de zile. *Ultimele două sunt propunerile mele — spui dacă vrei altfel.*
- Janitor pe pg_cron conform contractului mig 274 (manifest, minut etalat, `safety_marker`, control pozitiv JL1, **NU în același job cu ceva ce atinge `auth.users`**), cu fixtură care contrazice fiecare predicat, mutații dovedite.
- Textul politicii (`menuvia-pack/03-DRAFT-CONFIDENTIALITATE.md` §3.2, randat pe `/legal`) actualizat cu numerele reale.

**Ce s-a livrat efectiv, cu abaterile de la planul de mai sus:**
- Cozile email/SMS **NU se șterg**, se pseudonimizează: `email_queue.dedup_key` are index UNIC și E mecanismul anti-dublare, deci un DELETE ar permite un al doilea email REAL către un om. Rândul rămâne exclusiv ca jeton tehnic.
- S-a adăugat `qr_scans.user_agent` la fereastra de 30 de zile (aceeași clasă tehnică; nu era în inventarul inițial).
- S-a adăugat pasul care lipsea din plan și fără de care restul e teatru: **mascarea celor două chei de PII în `audit_log`**. `orders` are trigger de audit FOR EACH ROW, deci istoricul conținea deja numele/telefonul, iar UPDATE-ul de anonimizare ar mai fi scris o copie proaspătă. Niciun rând nu se șterge (retenția `audit_log` rămâne ÎNCHISĂ).
- **GR10 e clichet de CLASĂ**: o tabelă viitoare cu o coloană de identitate face CI roșu până primește ori acoperire, ori o scutire cu motiv.
- 12 mutații verificate că pică (inclusiv două găuri găsite ASTFEL în propriile mele asserții: `x <> 'valoare'` e NULL când mutația pune NULL, deci nu se declanșează; și fixtura nu avea niciun rând care să intre în predicat FĂRĂ nume).
- Pe prod: ZERO rânduri depășesc vreuna dintre ferestre (prima comandă e din 2 iunie 2026), deci aplicarea e un NO-OP dovedit.

### B4 — Feature-uri, DUPĂ deciziile din C (nu înainte)

- **B4a RES-28 i18n pe fluxul tranzacțional** (M–L, 2–3 zile): 9 componente de pe fluxul de plată nu primesc deloc `lang` (QrCartSheet, PayTableSheet, SplitBillSheet, OrderTracker, PickupCheckoutSheet, ReservationSheet, PaymentConfirmedScreen…); există **două sisteme i18n paralele** (`publicMenuStrings.ts` 7 limbi prop-drilled vs. `i18n.ts` 2 limbi pe localStorage, folosit de ecranul de plată confirmată). Cere decizia C4. ~110 chei noi × 7 limbi → `publicMenuStrings.ts` se triplează; rămâne în chunk-urile lazy, se măsoară `npm run build`. SMS-urile rămân RO fără diacritice.
- **B4b RES-37 „eliberează masa"** (S–M, ~4h): `closeSessionOrders` există cu zero apelanți; panoul „Stadiu mese" e vizibil doar pe Plan 3, dar butonul e util pe Plan 2 → cere decizia C5; `session_id` se derivă din `orders[].session_id` (0 RTT) cu fallback; pe Plan 3 e aproape mereu no-op (gate-ul fiscal). Plasa există deja: `expire_inactive_sessions` la 3h pe pg_cron.
- **B4c Onboarding banner** (S, ~4h, re-implementare #11): „Adaugă produse / Creează mese cu QR" persistent pe dashboard, per restaurant, auto-ascuns când ambele sunt făcute.

### B5 — Reziduuri de cod, mici, oricând (S fiecare)

Stare la 19 sept 2026: **patru din cinci închise**; singurul rămas e RESID-17, care e blocat pe o decizie de fondator (C6).

- ✅ **RESID-15** — cheia de idempotență QR pe fabrica comună. Scopul s-a dovedit mai mare: `lib/pwa.ts` avea aceeași clasă de defect, iar consecința nu era „cheia se pierde" ci ecran de eroare în locul MENIULUI (ambele accese erau în inițializatoare de `useState`, sub singurul `ErrorBoundary`, care înfășoară tot arborele). PR #267.
- ⏳ **RESID-17**: `process_account_deletions` pe pg_cron cu advisory lock + `for update skip locked` + `order by` — azi ștergerile GDPR la D+30 **nu rulează** cât Netlify e mort. Rămâne pe decizia C6 (cale IREVERSIBILĂ).
- ✅ **OPS-14** — varianta MICĂ, deliberat: `TICK_MINUTES` + `tickSlot()` în `automation-cron.js` și un clichet (`tests/functions/automation-cron-schedule.test.js`) care cere ca orarul din `netlify.toml` să fie `*/TICK_MINUTES`. Refactorul pe claim în DB e REFUZAT motivat: joburile rămase acolo sunt exact denylist-ul pg_cron din mig 274, sunt money-adjacent, iar consumatorul lor e mort până la issue #250 — s-ar face fără nicio cale de verificare în teren.
- ✅ **RESID-28** — `hide_branding` se gate-uiește acum la CITIRE (mig 281), nu doar la scriere. Motivul cu care mig 225 îl declarase ne-critic („beneficiul dispare oricum din UI") era FALS: beneficiul e badge-ul ascuns pe meniul PUBLIC, iar proiecțiile anon nu verificau planul. Bonus găsit de fixtura suitei: gate-ul de scriere din 225 era ORB la INSERT.
- ✅ **RESID-32** — ramura „rând mort" din `ReservationSheet` are test de RANDARE (RS-A/RS-B/RS-C), nu doar de decizie.
- ⛔ **RESID-34** — ÎNCHIS ca reziduu INERENT, fără cod: FiscalNet nu întoarce momentul tipăririi, deci `claimed_at` e cea mai bună sursă care există. Orice alternativă ar fi o presupunere cu aparență de precizie într-un document fiscal. Mutat în lista de reziduuri consemnate din `CLAUDE.md`.

---

## C. Decizii care mai sunt ale tale (blochează cod sau strategie)

| # | Decizie | Recomandarea mea |
|---|---|---|
| C1 | **RES-11 funnel**: `free` nu poate primi comandă QR (`plan_features` `order_qr=false`) și trialul cere card → nimeni nu ajunge la platforma reparată | Trial real 30 de zile pe limitele growth (incl. `order_qr`) SAU `payment_method_collection:'if_required'`; decide DUPĂ apelurile din FAZA 1 |
| C2 | **PLANDOC-2**: regula §4 a fost încălcată 5 săptămâni | Reafirm-o explicit: după B0–B3, cod nou doar pe excepții, până la primul client plătitor |
| C3 | **Bacșiș în sertar** (fără preferință azi) | Linie separată, sertar net |
| C4 | **RES-28.3**: un singur sistem i18n pe fluxul oaspetelui | (A) totul pe `PUBLIC_MENU_STRINGS` 7 limbi cu `lang` prop; `i18n.ts` rămâne doar pentru dashboard |
| C5 | **RES-37.1**: unde stă „eliberează masa" | În vederea LISTĂ a WaiterPage (grupat per masă), ca să ajungă la Plan 2 |
| C6 | **RESID-17**: ștergerile GDPR pe pg_cron (cale ireversibilă) | Da, cu advisory lock — altfel Art. 17 e oprit de facto |
| C7 | **OPS-12**: arhivă fiscală 10 ani (artefactele GitHub țin 30 de zile, VPS 14) | Sink extern S3-compatibil, lunar; decizie de cont |
| C8 | Preț starter 99 vs ~83 la concurent (AUDIT-NOCOMMIT-7) | După FAZA 1 |
| C9 | CSP enforce (azi Report-Only cu `unsafe-inline`) | După 2 săptămâni cu `report-to` (B1) fără violări |
| C10 | RESID-14: `record_qr_scan`/`record_page_view` — le conectezi sau le ștergi cu teste cu tot | Conectează `record_qr_scan` (1 linie în QrMenuPage) — e singura măsură de activare pe QR |
| C11 | SCOPE-33.4: flux de ștergere pentru OASPEȚI (fără cont) | Proces manual prin privacy@menuvia.ro, scris explicit în politică |
| C12 | OPS-13: pragurile de revenire ale cron-urilor rărite („la primul client plătitor") sunt doar comentarii | Le legi de A1: când ai primul abonament, `*/15`→`*/5` pe oblio |

## D. Ce depinde de un terț

- **EconMedia** (FAZA 5): 11 checkbox-uri nebifate în `BRIDGE_FISCALNET_ARCHITECTURE.md`; un telefon închide 4 necunoscute: codurile de plată **7 (card_online) / 4 (tichete)**, `ST^`, `Idempotency-Key` onorat de BonLocal, diacritice CP1250; **bacșișul pe bon** (OUG 8/2023, RES-21) cere specificația lor.
- **Oblio** (RES-19): transmiterea în SPV e la ei; `has_einvoice` = prezența XML-ului, nu starea ANAF.
- **Resend** (A6), **Stripe review** pentru Connect (A9), **OSIM/EUIPO**.
- **Avocat/contabil**: 6 întrebări GDPR (`docs/GDPR_DELETION.md:139-147`), 7 pe afiliere, 5 draft-uri din `menuvia-pack/`, facturarea comisionului de platformă și a abonamentelor SaaS (RES-30 — nemodelată nicăieri).

## E. Reziduuri consemnate deliberat — nu se redeschid fără motiv nou

Bon stornat la casă fără reprezentare; legătura bon↔factură doar la Oblio; refund Stripe manual la `void_order_payment`; pinning IP în ai-proxy (cere `undici`); `authenticated` cu INSERT pe `pending_receipts` (limitat de mig 278); dublu-send SMSO; retry după schimbare legală de cotă; TOCTOU pe cota AI; bon per plătitor la split = v2; Codvia v2; advisor `auth_rls_initplan`/`multiple_permissive_policies`/FK neindexate (performanță — irelevante la 30 de comenzi, se reevaluează la 500/zi); Prettier non-blocking; Lighthouse advisory.

## F. Ordinea și porțile

1. **Azi, în paralel**: tu A1–A2 (~1h); eu B0 + B1 + B2 (trei PR-uri, merge pe verde cu re-citirea review-urilor). **Poartă**: `/health` 200, health-watch verde, 4 emailuri `sent`.
2. **Zilele 1–2**: tu A3–A9; eu B3 (retenție). **Poartă**: artefact de backup + restore de probă trecut prin RP1–RP12; MFA 2/2; Resend Verified.
3. **Ziua 3**: A10 + FAZA 1 (cele 4 apeluri) → decizia C1.
4. **Apoi**: C4/C5 → B4a/B4b/B4c doar dacă pilotul le cere (turiști → B4a; Plan 2 → B4b; onboarding nou → B4c). Restul din C după FAZA 1.
5. **Săptămânile 2–4**: FAZA 2 (un local), BLOC 4 în paralel; FAZA 3 = primul leu ridică interdicția §4.

Plafonul rămâne cel din audit: codul te duce la ~7,5; **ultimele 1,5 puncte și primele 2 puncte de VALOARE sunt în A, nu în B**.

## Verificare (pentru ce execut eu)

- B0: `git grep -nw "WEBHOOK_SECRET" docs/GHID_FONDATOR.md` întoarce EXACT cele două note de dezambiguizare („NU `WEBHOOK_SECRET`" — celula din tabelul de la PASUL 1c și paranteza de la PASUL 5), nicio celulă/instrucțiune care să-l ceară ca secret Stripe; `git grep -n "RES-35\|mig 263 pe prod" docs/AUDIT_V3_2026-09.md` arată ✅; `.env.example` conține fiecare variabilă din `grep -ho "process.env.[A-Z_]*" netlify/functions/*.js deploy/server.js | sort -u`.
- B1: `health-watch.yml` cu `-H "x-health-diag"`; `grep -o "apiVersion: STRIPE_API_VERSION" netlify/functions/*.js | wc -l` = 9 (total, nu per fișier); `sql-verify.yml` cu `postgres:17` și lanțul verde; mig 279 + clichet: `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prorettype='trigger'::regtype and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))` = 0 (AMBELE roluri client); test verificat că PICĂ fără migrație.
- B2: CI verde pe fiecare PR; `cd tests/functions && npm test` verde pe bump-ul stripe.
- B3: replay local `bash scripts/verify-migrations-local.sh`; fixtura cu un rând la 11 luni (neatins) și unul la 13 luni (anonimizat); `get_cron_janitor_health()` listează jobul; mutația „fără filtrul de 12 luni" pică.
- Nicio migrație nu se aplică pe prod fără merge + `apply_migration` cu copia fără tranzacție, apoi verificarea catalogului pe prod.
