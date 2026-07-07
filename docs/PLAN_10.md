# PLAN 10/10 — scorecard critic + drumul strict până la 10

> RE-AUDIT 6 iulie seara (al 2-lea): dovezi la minut — prod Supabase la mig 204
> (202–204 aplicate prin MCP pe 6 iulie seara, 0 erori advisor; markerii verificați), frontend prod TOT din 30 iunie
> (deploy publicat 6a4429…, seria veche), GitHub Actions MORT din 12:28 UTC
> (cotă/limită — 8 push-uri fără niciun run), PR #188 cu 12 commit-uri verzi pe
> Netlify. Notele sunt starea de AZI SEARA, cu producția așa cum o vede un client.

## Scorecard (critic, starea de azi)

| # | Capitol | Notă | Ce e OK / ce NU / ce e GREȘIT |
|---|---------|------|-------------------------------|
| 1 | **Infra / deploy / hosting** | **2/10** → | GREȘIT: clientul vede și azi versiunea din 30 iunie — 7 zile de lucru nelivrate. NOU AZI: și CI-ul a murit (cota Actions, blocare tăcută). OK: pachetul VPS + GHID_FONDATOR reduc TOT blocajul la ~20 min de acțiune umană. Nota nu urcă până nu vede un client main-ul. |
| 2 | **Observabilitate / reziliență** | **5/10** = | OK: /health, alerte Slack, backup nightly scriptat, RUNBOOK, verify-migrations-local (azi). NU: Sentry DSN nesetat (cod gata), zero uptime extern, restore netestat pe server real. GREȘIT (proces): moartea cotei Actions nu a alertat pe nimeni — exact tipul de orbire pe care F1 trebuie s-o închidă. |
| 3 | **Testare / QA** | **4→7/10** | OK AZI: primul E2E verde din istoria repo-ului + ~25 teste componente pe fluxurile de bani + TP1-TP6 pe plata online + k6 one-click + harness SQL local (echivalență cu CI dovedită). NU: totul e paralizat de cota Actions — testele există dar nu RULEAZĂ pe push; E2E încă ne-blocking; k6 niciodată executat. |
| 4 | **Securitate / RLS / lockdown** | **9/10** = | OK: 0 erori advisor, convenția lockdown respectată și de noile RPC-uri de plată (service_role-only, sumă server-side). NU: leaked-password OFF (1 click, la tine), fără MFA pe conturile de platformă. |
| 5 | **Fiscalizare (bridge)** | **7/10** = | OK: cloud + bridge + 51+14 teste, format confirmat pe webtest, card_online mapat (cod 7, de confirmat EconMedia). NU: .exe nebuildat (cerea Actions/Windows), casă demo netestată, bacșiș OUG 8/2023 + storno așteaptă spec-ul EconMedia. Blocat pe telefonul tău. |
| 6 | **Plăți / Stripe / abonamente** | **7→8,5/10** | OK AZI: plata online la masă COMPLETĂ în cod (SQL+funcții+client+Setări, teste verzi) — cel mai mare gap de produs închis; dunning s-a dovedit deja construit (scorecard-ul vechi era GREȘIT aici). NU: nelive — cere Connect activat + 2 env + test e2e pe test mode; tichetele de masă = Etapa 3. |
| 7 | **Comenzi / QR / waiter / kitchen** | **8/10** = | OK: matur, realtime, idempotență testată acum și în vitest. NU: fără imprimare tichete bucătărie (cerință frecventă, MASTER_PLAN #6), comportament sub load real necunoscut (k6 nerulat). |
| 8 | **Meniu public (client)** | **8→8,5/10** | GREȘIT în scorecard-ul vechi: pipeline-ul de imagini EXISTĂ (webp 0.85 + max 1200px pe ambele căi de upload) — verificat azi. NU: SEO real pe /m/:slug cere prerender/SSR (meta client-side nu ajută crawlerele) — decizie de design separată. |
| 9 | **Dashboard / UX admin** | **8→8,5/10** | OK AZI: checklist-ul de activare dus până la „prima comandă de test" (măsurat real; bifa falsă eliminată). NU: a11y sistematic (keyboard nav) neverificat; AuthPage a avut labels rupte până ieri — semn că mai există. |
| 10 | **AI** | **6/10** = | GREȘIT (nelivrat, nu nescris): platforma AI completă dar moartă în prod — PLATFORM_OPENAI_KEY tot nesetat. E în GHID pasul 1c; 2 minute după VPS. |
| 11 | **Afiliere / founder ops** | **8/10** = | OK: sistem complet, comisioane live. NU: Wise faza 2 manuală, fără pagini legale dedicate programului. |
| 12 | **Rezervări** | **8/10** = | OK: hartă, wrap-around, remindere. NU: no-show (penalizare/depozit), confirmare SMS. |

**Media: ~7,0/10 (de la ~6,5 azi-dimineață).** Diagnosticul actualizat: **codul a urcat
spre 9; livrarea a rămas la 2 — și e un singur om pe drumul critic.** Tot ce desparte
7,0 de ~9 sunt acțiuni de minute, nu săptămâni: cota Actions (1 min), pașii din
GHID_FONDATOR (20 min), Connect+env (5 min), telefonul EconMedia. Codul nou fără
livrare = inventar, nu valoare.

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
