# PLAN 10/10 — scorecard critic + drumul strict până la 10

> Generat pe dovezi: 2 audituri la scară (194 + 378 agenți, medii 6.13 → 6.0 pe unități
> slabe), audit de zone (66 agenți, „healthy"), starea reală prod (6 iulie 2026: DB la
> mig 201 ✓, frontend prod ÎNGHEȚAT pe #76 din cauza creditelor Netlify), verificări
> punctuale în repo. Notele de mai jos NU sunt medii istorice — sunt starea de AZI,
> cu producția așa cum o vede un client.

## Scorecard (critic, starea de azi)

| # | Capitol | Notă | De ce nu e 10 (dovezi) |
|---|---------|------|------------------------|
| 1 | **Infra / deploy / hosting** | **2/10** | Producția e înghețată pe #76 (30 iun) — ~100 PR-uri nelivrate clienților. Creditele Netlify epuizate → deploy prod suspendat. Fără domeniu propriu (menuvia.netlify.app). Un singur host, fără plan B. |
| 2 | **Observabilitate / reziliență** | **5/10** | `/health` + alerte Slack + RUNBOOK există (Val 1), DAR: error-tracking FE există (Sentry lazy în main.tsx, în spatele VITE_SENTRY_DSN + consent) însă DSN-ul nu e setat → efectiv oprit; pe funcții/backend zero, zero uptime-monitor extern, zero dead-man's switch activ, zero backup propriu al DB (doar Supabase intern). |
| 3 | **Testare / QA** | **4/10** | 11 fișiere de teste unit pe tot FE. E2E cronic roșu în CI (secrets lipsă) = practic NU există E2E. Excelent doar pe fiscal-SQL (51 teste) și bridge (14). Zero load-testing pe meniul public (calea cea mai fierbinte). |
| 4 | **Securitate / RLS / lockdown** | **9/10** | Advisor: 0 erori. Convenția lockdown matură (96A/B/C, gate-uri fiscale server-side, search_path peste tot). Rămân: leaked-password protection OFF în Supabase Auth, fără MFA pe conturile de platformă (Netlify arată mfa_enabled:false). |
| 5 | **Fiscalizare (bridge FiscalNet)** | **7/10** | Cloud complet + 51 teste; pilot bridge scris + 14/14 verde; format confirmat pe webtest. Lipsesc: test pe casă demo reală, .exe/installer nebuildat, bacșiș pe bon (OUG 8/2023) nedefinit, flux storno inexistent. |
| 6 | **Plăți / Stripe / abonamente** | **7/10** | Webhook + checkout hardening trecute prin 3 valuri de fix. Lipsesc: plata ONLINE la masă (clientul nu poate plăti din telefon — gap de produs mare pentru Plan 3), dunning (recuperare plăți eșuate) doar bazic. |
| 7 | **Comenzi / QR / waiter / kitchen** | **8/10** | Matur: realtime, idempotență rotită, Stadiu mese (grilă+hartă), audit istoric. Rămân: robustețe offline parțială, fără imprimare tichete bucătărie, necunoscut sub load real. |
| 8 | **Meniu public (client)** | **8/10** | Redesign complet, 7 limbi, teme, flipbook, pass de perf. Rămân: fără pipeline de optimizare imagini (upload-urile merg raw din Supabase Storage — LCP suferă la poze mari), SEO pe meniurile publice minimal. |
| 9 | **Dashboard / UX admin** | **8/10** | 7 zone lustruite + Setări restructurate + founder mode. Rămân: onboarding-ul de ACTIVARE (primele 10 min ale unui restaurant nou) e simplu, nu ghidat; a11y-ul complet (keyboard nav) neverificat sistematic. |
| 10 | **AI** | **6/10** | Arhitectură bună (proxy, metering, cote, credite) DAR moartă în prod: `PLATFORM_OPENAI_KEY` nesetat → un cont nou primește eroare. Feature construit ≠ feature livrat. |
| 11 | **Afiliere / founder ops** | **8/10** | Sistem complet (comisioane live, sub-afiliați, payout state-machine, founder dashboard). Rămân: faza 2 Wise manuală, fără pagini legale dedicate programului. |
| 12 | **Rezervări** | **8/10** | Hartă „ca la cinema", wrap-around, remindere, rate-limit. Rămân: gestiune no-show (penalizare/depozit), confirmare SMS. |

**Media ponderată: ~6.5/10.** Diagnosticul dur și onest: **codul e la 8, operarea e la 3.**
Diferența până la 10 NU se închide scriind mai mult cod de feature — se închide cu
livrare (hosting), plase de siguranță (monitoring/QA) și 3 goluri de produs.

---

## PLANUL STRICT (îl urmez în ordine; nu sar faze)

Regulă: o fază e „done" doar când TOATE criteriile ei de acceptare trec. Nu încep faza
următoare cu faza curentă roșie (excepție: itemii blocați pe acțiune umană se notează și
se merge mai departe).

### FAZA 0 — Deblocare livrare (acum → 72h) — ținta: cap. 1 la 6
- [x] **Decizie hosting**: VPS (decis 6 iulie). Pachetul deploy/ e complet; rămân pașii din docs/VPS_RUNBOOK.md (server + env + secrets + DNS).
- [x] **PR #182 merged** (6 iulie, squash 8f6bd37) — TOATE check-urile verzi, inclusiv Playwright E2E (prima dată în istoria proiectului).
- [ ] `PLATFORM_OPENAI_KEY` setat în env-ul de producție. (USER — 2 min)
- [ ] Supabase Auth → leaked password protection ON. (USER — 1 min)
- [ ] Frontend-ul nou public pentru clienți (prin oricare din căile de hosting). (EU+USER)
- ✔️ Criteriu: un client pe menuvia vede versiunea de main; AI-ul răspunde pe un cont nou.

### FAZA 1 — Fundație de operare (săpt. 1) — ținta: cap. 1→8, cap. 2→8
- [ ] Pachet VPS în repo: `deploy/` cu shim Node pentru `/.netlify/functions/*` (handler-e NESCHIMBATE), node-cron pe aceleași intervale, Caddy (HTTPS auto), systemd, GH Action build+rsync. (EU)
- [ ] Domeniu propriu (menuvia.ro) + Netlify vechi = redirect (protejează QR-urile tipărite). (USER cumpără/pointează, EU config)
- [ ] Error tracking: FE există (Sentry lazy) — USER: cont Sentry + VITE_SENTRY_DSN la build. Backend: shim-ul VPS raportează erorile funcțiilor/cron în Slack (livrat). (parțial EU ✓)
- [ ] Uptime monitor extern pe `/health` + dead-man's switch pe cron-uri (healthchecks.io free). (EU + USER cont)
- [ ] Backup DB propriu: pg_dump nightly → storage extern + test de restore DOCUMENTAT. (EU)
- ✔️ Criteriu: o eroare aruncată intenționat în FE apare în Sentry; oprirea health-ului alertează în <10 min; un restore de test reușește.

### FAZA 2 — QA la standard (săpt. 2) — ținta: cap. 3→8
- [x] E2E VERZI în CI (6 iulie, 8 iterații): Supabase local ermetic + 202 migrații/PR + seed; primul run verde. Rămâne: 2-3 rulări stabile → promovare la gate BLOCKING. (EU)
- [x] Teste componente pe fluxurile de bani (6 iulie, ~25 teste): ModifierSheet (matematica CTA + min/max server-parity), WaiterEntry (payload create_order + idempotency stabil la retry + validare fără retry), EditOrderSheet (option_ids + baselineTotal + dirty guard + orfani), QrCartSheet (total CTA + steppers + recomandări + quick-add interzis pe grupuri obligatorii); cheile de idempotență QR extrase în lib/orders + testate direct. (EU)
- [ ] Load test k6 pe meniul public (100 concurrent, p95 < 1s) + fix ce iese. (EU)
- ✔️ Criteriu: CI-ul pică dacă un flux de comandă se strică; raport k6 în repo.

### FAZA 3 — Pilot fiscal real (săpt. 2–3, paralel cu F2) — ținta: cap. 5→9
- [ ] Build .exe + installer (mașină Windows sau CI cu runner Windows). (EU scripturi / USER rulează)
- [ ] Test pe FiscalNet v2 demo → apoi casă reală; confirmă idempotency + `ST^` + diacritice. (USER cu ghidajul meu)
- [ ] Bacșiș pe bon per OUG 8/2023 (linia exactă din spec EconMedia) + flux storno minim. (EU, după răspuns EconMedia)
- [ ] Pricing EconMedia + 1 local pilot LIVE. (USER: 0772 179 309)
- ✔️ Criteriu: un bon fiscal REAL tipărit dintr-o comandă Menuvia la un local pilot.

### FAZA 4 — Golurile de produs pentru 10 (săpt. 3–5)
- [ ] **Plata online la masă** (Stripe PaymentIntent, Plan 3, gate server-side, bonul fiscal rămâne pe casă). Cel mai mare gap vs. competiție. (EU) — **COMPLET IN COD** (6 iulie, 3 valuri): design docs/ONLINE_PAYMENT.md; mig 202/203/204 + teste TP1-TP6 (verzi local, 205 migratii + 37/37); functii Netlify (table-payment cu suma server-side, stripe-connect onboarding, stripe-connect-webhook cu dedup + settle idempotent); PayTableSheet in QR (js.stripe.com, zero dependente noi) + OnlinePaymentsCard in Setari. Ramas pe USER: activare Connect in Stripe + STRIPE_PUBLISHABLE_KEY/STRIPE_CONNECT_WEBHOOK_SECRET in env + un test end-to-end pe test mode.
- [ ] **Loyalty v1** — design scris (6 iulie, docs/LOYALTY.md): schema events + wallets, acumulare pe trigger-ul de paid, redeem staff-only. BLOCAT pe 2 decizii de fondator: identitatea clientului (hibrid telefon+card anonim?) si planul minim (growth+ vs pro+). Implementarea = 1 val dupa raspuns. (EU+USER)
- [x] **Onboarding de activare** (6 iulie): checklist-ul „Setup restaurant” din HomeTab exista deja (pasi masurabili + navigare); completat cu pasul de ACTIVARE lipsa — „Prima comanda de test” (count real pe orders, inlocuieste o bifa permanenta falsa). (EU)
- [x] Dunning (verificat 6 iulie — EXISTA deja, scorecard-ul îl subevalua): `invoice.payment_failed` → lifecycle event → email `payment_failed` prin coadă (mig 039/180); `past_due` ține planul viu pe durata retry-urilor Stripe (grace corect în webhook). Rămas opțional (nu blochează): escaladare la zi 3/7 + activarea Smart Retries din dashboard-ul Stripe (setare, nu cod — USER 1 min). (EU)
- ✔️ Criteriu: un client nou ajunge singur de la signup la prima comandă test în <15 min; un client la masă poate plăti din telefon.

### FAZA 5 — Finisaj 10/10 (săpt. 5–6)
- [x] Pipeline imagini — verificat 6 iulie: EXISTA deja pe ambele cai de upload (ProductsTab + SettingsTab: canvas resize max 1200px + webp 0.85); scorecard-ul era depasit. Ramasa doar verificarea LCP pe prod dupa deploy (5 min, dupa VPS). (EU)
- [ ] SEO meniuri publice (meta, OG, sitemap per restaurant). (EU)
- [ ] Pagini legale complete (ToS, Privacy, program afiliere) verificate. (EU draft, USER avocat)
- [ ] MFA pe toate conturile de platformă (Supabase, Netlify/VPS, GitHub, Stripe). (USER)
- [ ] Re-audit final pe toate capitolele; fiecare sub 9 primește un val de fix dedicat. (EU)
- ✔️ Criteriu global 10/10: toate capitolele ≥9, media ≥9.5, un pilot fiscal live, zero blocaje de livrare.

## Dependențe pe USER (singurele; restul le duc eu)
1. Decizia hosting + (dacă VPS) cont Hetzner ~4€/lună.
2. `PLATFORM_OPENAI_KEY` + leaked-password ON + MFA-uri.
3. Conturi gratuite: Sentry, healthchecks.io.
4. Telefon EconMedia (pricing + trial) + rulat installer-ul pe PC-ul casei.
5. Domeniul (dacă nu există deja menuvia.ro).
