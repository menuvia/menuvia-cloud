# MENUVIA — PLANUL PE 10 SĂPTĂMÂNI (15 iulie → 22 septembrie 2026)

> Scris pe starea reală din 15 iulie: codul e la mig 229 (PR #188, totul verde,
> review-uit adversarial), prod DB la mig 214, frontend-ul de prod din 30 iunie,
> GitHub Actions mort pe cotă. Diagnosticul din PLAN_10 rămâne valabil:
> **codul e la ~9, livrarea la ~2, și un singur om e pe drumul critic.**
> De aceea planul e ordonat brutal: întâi LIVREZI ce există, abia apoi construim.
>
> Legendă: 🤖 = Claude (autonom) · 👤 = fondator (acțiune umană, majoritatea minute)
> Regula moștenită din PLAN_10: o săptămână e „done" doar când criteriul ei trece.
> Itemii blocați pe om se notează și nu blochează restul.

## Rezumatul pe un ecran

| Săpt. | Tema | Criteriul de acceptare |
|---|---|---|
| 1 | **Livrarea** | Un client vede main-ul live; prod DB la mig 229 |
| 2 | Fundație ops + finalul polish-ului | Sentry+uptime+restore dovedite; #168 închis |
| 3 | Pilot fiscal | Bon fiscal REAL tipărit dintr-o comandă Menuvia |
| 4 | Banii live | O plată online la masă + un split REAL pe test mode → live |
| 5 | Primii clienți plătitori | ≥3 localuri active, ≥1 afiliat activ |
| 6 | E4a — Diaspora | /en live + onboarding EN; primul lead non-RO |
| 7 | E4b — Tichete de masă | Tripleta demo-abilă (bon + tichet bucătărie + tichet masă) |
| 8 | Scale QA + durificare | E2E blocking, k6 pe prod-like, MFA, storno |
| 9 | E5 seed — Agenții | White-label v1 + benchmark v1; 1-2 agenții pilot |
| 10 | Re-audit + planul Q4 | Scorecard ≥9/10 pe medie; backlog Q4 scris |

---

## Săptămâna 1 (15–21 iul) — „LIVRAREA" — totul e deja construit, doar se publică

Ținta: capitolul 1 din scorecard (2/10) urcă la 8. Zero cod nou pe drumul critic.

- 👤 **(5 min)** Reconectează MCP-ul Supabase + spune „aplică migrațiile pe prod"
  → 🤖 aplic **mig 215→229** (validate local 42/42; 224 în două tranzacții),
  verific markerii + advisors după fiecare pas.
- 👤 **(30 min)** Pașii din `docs/GHID_FONDATOR.md`: deblocare cotă GitHub Actions,
  VPS după `docs/VPS_RUNBOOK.md` (sau top-up Netlify — oricare, dar UNA), DNS.
- 👤 **(5 min)** Env-uri: `PLATFORM_OPENAI_KEY`, `STRIPE_PUBLISHABLE_KEY`,
  leaked-password ON în Supabase Auth.
- 👤 **(10 min)** Review + **merge PR #188** (draft → ready; totul e verde și
  review-uit; squash).
- 🤖 Deploy-ul frontend pe main + verificarea live a markerilor (rezervări,
  founder, tichete, split) + smoke test pe /m, /q, dashboard.
- ✔️ **Criteriu: un client oarecare deschide menuvia și vede versiunea de main;
  AI-ul răspunde pe un cont nou; prod DB răspunde cu mig 229.**

## Săptămâna 2 (22–28 iul) — Fundație de operare + închiderea polish-ului

Ținta: cap. 2 (observabilitate) la 8; task #168 închis.

- 🤖 Termin valul #168: loturile 2b (FounderPage, QrMenuPage, ProductSheet,
  Comparație, Dashboard, HappyHour, VatReport) + 3 (restul ~40 de fișiere mici),
  cu aceeași disciplină verify-then-fix + review la final.
- 👤 **(15 min)** Cont Sentry (`VITE_SENTRY_DSN`) + cont healthchecks.io.
- 🤖 Cablez uptime-ul extern pe `/health` + dead-man's switch pe cron-uri;
  rulez și DOCUMENTEZ un restore de backup pe un server curat.
- 🤖 E2E promovat la gate BLOCKING după 3 rulări verzi consecutive.
- ✔️ Criteriu: o eroare aruncată intenționat apare în Sentry; oprirea /health
  alertează în <10 min; restore-ul dovedit; CI blochează un flux de comandă stricat.

## Săptămâna 3 (29 iul–4 aug) — Pilotul fiscal (F3) — săptămâna telefonului

Ținta: cap. 5 (fiscalizare) la 9. Aproape totul e pe acțiunile tale — eu pregătesc tot.

- 👤 **Telefonul la EconMedia (0772 179 309)** — agenda completă într-un singur apel:
  pricing FiscalNet, confirmarea codului de plată 7 (`card_online`), linia de bacșiș
  per OUG 8/2023, fluxul de storno, întrebarea informativă despre note nefiscale.
- 🤖 Scripturile de build .exe + installer (rulezi pe un Windows); ghid pas-cu-pas.
- 👤 Test pe FiscalNet demo → casă reală (cu ghidajul meu live).
- 🤖 Implementez bacșișul pe bon + storno minim imediat ce vine spec-ul EconMedia.
- 🤖 În paralel: k6 pe meniul public (100 concurrent, p95 < 1s) + fix ce iese.
- ✔️ **Criteriu: un bon fiscal REAL, tipărit dintr-o comandă Menuvia.**

## Săptămâna 4 (5–11 aug) — Banii live (tot ce e „complet în cod" devine „live")

- 👤 **(10 min)** Stripe: activare Connect + Customer Portal;
  `STRIPE_CONNECT_WEBHOOK_SECRET` în env.
- 🤖+👤 Test end-to-end pe test mode: plata pe toată masa, split pe itemi
  (2 telefoane), anulare, refund-flow — apoi live la localul pilot.
- 👤 **(15 min)** Cont SMSO.ro → `SMSO_API_KEY`; 🤖 verific parsarea răspunsului
  real și pornesc SMS-urile la pilot.
- 👤 Imprimantă termică (~200 lei, Ethernet 9100) la pilot; 🤖 config bridge kitchen.
- ✔️ Criteriu: la localul pilot funcționează LIVE: plată online + split + bon
  automat + tichet bucătărie + SMS pickup.

## Săptămâna 5 (12–18 aug) — Primii clienți plătitori + afilierea pornită

- 👤 Onboarding 3–5 localuri (pipeline-ul tău + pagina /recrutare); interviul cu
  afiliata pe care o ai deja → aprobare din /founder.
- 🤖 Stau pe feedback-ul real: fiecare fricțiune raportată = fix în <48h
  (canalul: tu îmi scrii, eu împing). Health scores + alertele deja veghează.
- 🤖 Onboarding-ul măsurat: raport din founder pe funnel-ul de activare
  (cont → meniu → QR pe masă → prima comandă) + fix-uri pe unde se rupe.
- ✔️ Criteriu: ≥3 restaurante cu comenzi reale săptămâna asta; ≥1 afiliat activ
  cu link distribuit; MRR > 0.

## Săptămâna 6 (19–25 aug) — E4a: Diaspora (EN)

- 🤖 Landing EN (`/en`) + onboarding în engleză (meniul public e deja
  multilingv pe 7 limbi — lipsea doar suprafața de vânzare).
- 🤖 SEO programatic v2: pagini pe orașe + verticale (cafenele/pizzerii/food
  truck) pe șablonul deja construit (/case-de-marcat).
- 👤 Postări în 2–3 grupuri de diaspora (ES/IT/DE) cu link-ul EN.
- ✔️ Criteriu: /en live + primul lead non-RO în formular.

## Săptămâna 7 (26 aug–1 sept) — E4b: Tichete de masă (tripleta unică)

- 🤖 Design + implementare: acceptarea tichetelor de masă (Edenred/Sodexo/Up) ca
  metodă de plată în fluxul de staff + maparea fiscală corectă pe bon (după
  spec-ul EconMedia din săpt. 3). Efort L — săptămâna întreagă, cu review
  adversarial la final (pattern-ul E3).
- ✔️ Criteriu: demo cap-coadă cu tripleta pe casa pilot: bon fiscal + tichet de
  bucătărie + plată cu tichet de masă. **Nimeni pe piața RO nu are toate trei.**

## Săptămâna 8 (2–8 sept) — Scale QA + durificare (ce a arătat realitatea)

- 🤖 k6 pe profilul REAL de trafic de la pilot (nu sintetic) + fix-urile de perf.
- 🤖 MFA pe conturile de platformă (founder/admin) + rate-limit review.
- 🤖 Storno complet (inclusiv Oblio HIGH-2/HIGH-3 din task #167 — acum există
  sandbox-ul de la pilot) + no-show pe rezervări (SMS-ul există din mig 228).
- ✔️ Criteriu: raport k6 în repo cu p95 sub țintă pe date reale; storno testat
  pe casa demo; scorecard cap. 3 și 12 la ≥8.

## Săptămâna 9 (9–15 sept) — E5 seed: canalul de agenții

- 🤖 White-label v1: CNAME + logo agenție pe meniul public (M–L).
- 🤖 Benchmark v1 în founder → raport lunar per client („localul tău vs. media").
- 👤 1–2 agenții web/marketing pilot ca reselleri (comisioanele de afiliat
  există deja — e doar vânzare).
- ✔️ Criteriu: un meniu servit de pe domeniul unei agenții; primul raport
  benchmark trimis unui client real.

## Săptămâna 10 (16–22 sept) — Re-audit total + planul Q4

- 🤖 Re-auditez tot sistemul cu workflow-ul notat (pattern-ul celor 194+378 de
  agenți) — ținta: media scorecard **≥9/10**, cu dovezi la minut.
- 🤖 Curăț backlog-ul rămas + rescriu MASTER_PLAN/EXPANSION pe realitatea
  post-lansare (cifre reale de la clienți, nu asumpții).
- 👤 Decizia Q4 cu date: cât apeși pe diaspora vs. agenții vs. adâncime RO.
- ✔️ Criteriu: scorecard nou publicat; planul Q4 scris pe cifre reale.

---

## KPI-urile celor 10 săptămâni (se citesc din /founder)

| KPI | Săpt. 5 | Săpt. 10 |
|---|---|---|
| Restaurante active (comenzi reale/săpt.) | 3–5 | 10–15 |
| MRR | > 0 | ≥ 2.000 lei |
| Bonuri fiscale reale emise | primele | rutină zilnică la ≥3 localuri |
| Afiliați activi | 1 | 3–5 (+1–2 agenții) |
| Uptime /health | monitorizat | ≥99,9% pe 30 zile |
| Scorecard mediu | ~7,5 | **≥9,0** |

## Cele 3 riscuri care pot strica planul (și contramăsurile)

1. **Săptămâna 1 nu se întâmplă** (livrarea depinde 100% de ~50 de minute ale
   tale). Contramăsură: totul e redus la pași de minute în GHID_FONDATOR; orice
   zi de întârziere împinge TOT planul — e singurul item cu adevărat critic.
2. **EconMedia întârzie** (blochează săpt. 3 și parțial 7). Contramăsură:
   agenda completă într-un singur telefon; tot ce nu depinde de ei merge înainte
   (k6, .exe, SMS, plăți online).
3. **Feedback-ul primilor clienți contrazice planul** (săpt. 5). Contramăsură:
   asta nu e risc, e scopul — săptămânile 6–9 se REORDONEAZĂ după ce cer
   clienții plătitori; doar criteriile de acceptare rămân fixe.
