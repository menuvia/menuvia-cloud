# 05 — Ghid Ședința 1 (28 oct 2026, ~100 min): pas cu pas

> **Legendă:** 👤 = **doar tu** poți face (contul, plata, identitatea sau secretul sunt ale tale). 🤖 = **face AI-ul**, după tine sau prin conectori. ⛔ = **NU face asta**.
> **Nu inventez adrese de dashboard.** Descriu căile de meniu generic („Settings → Environments”); numele din interfețe se mai schimbă, deci dacă un nume nu seamănă, caută cel mai apropiat și întreabă-mă. Singurele linkuri directe sunt cele care există deja în repo (`docs/GHID_FONDATOR.md`).
> **Numele variabilelor și ale secretelor sunt exacte** (verificate pe `main` în `.github/workflows/*.yml`, `netlify/functions/*.js`, `docs/VPS_RUNBOOK.md` și `docs/RUNBOOK.md` §5). Copiază-le caracter cu caracter.
> **Nu lipi niciodată o valoare secretă în acest fișier, în commit-uri sau în PR-uri.** Secretele se pun doar în câmpurile consolelor de mai jos (sau mi le dai în chat, acolo unde scrie explicit).

## Înainte să începi (5 min, o dată)

- Un **manager de parole** (1Password, Bitwarden etc.) deschis. Tot ce e „secret” de mai jos se salvează acolo.
- Un telefon cu o **aplicație de autentificare** (Google Authenticator, 1Password, Aegis).
- Verifică, uitându-te în Netlify → Deploys, că **publicarea automată e oprită** („Auto publishing” oprit / „locked deploy”). Am pus-o înainte de Ședința 1 prin conector. ⛔ **Dacă nu e oprită, nu pune niciuna dintre cheile din pasul 9; spune-mi mai întâi.** Motiv: orice merge pe `main` ar publica un build cu cheile puse și ar porni serverul înaintea migrației 300 (alerta „[INTERN]” ar pleca la patron).

## Ordinea (cu corespondența față de numerotarea din plan)

| Pasul din ghid | Ce faci | Nr. în plan (§0.2) | Min | De ce în acest loc |
|---|---|:---:|---:|---|
| **1** | Emailuri contabil + avocat + semnătură calificată | 1 | 15 | Așteptarea e de partea lor; pornește ceasul primul |
| **2** | Domeniul `menuvia.ro` + serverele de nume | 3 | 12 | Propagarea DNS durează; cere timp înainte de Resend |
| **3** | GitHub: environment `production` + secrete | 2 | 12 | Independent; faci în timp ce se propagă DNS |
| **4** | Supabase: trecerea pe **Pro** + organizația „menuvia-test” | 6 (prima parte) | 6 | Protecția parolelor compromise cere Pro |
| **5** | Stripe (TEST) + Connect | 9 | 15 | Independent; cheile TEST merg pe canal separat |
| **6** | OpenAI | 8 | 5 | Independent |
| **7** | Resend + DMARC + redirecționare email | 4 | 12 | Cere DNS-ul propagat |
| **8** | Supabase Auth: leaked-password, SMTP, șablon, URL-uri | 6 (a doua parte) | 8 | Cere cheia Resend din pasul 7 |
| **9** | Netlify: variabile (doar `production`) | 5 | 4 | Cere cheile din pașii 3b, 7, 8 și 6 |
| **10** | UptimeRobot | 10 | 3 | Cere domeniul |
| **11** | MFA + 2FA | 7 | 10 | Poate fi oricând; îl bifezi la final |
| **12** | „Da” la D1–D15 + șefii | 11 | 3 | Vezi `04-fisa-decizii-D1-D15.md` |

Ordinea din ghid diferă de numerotarea din plan doar din cauza dependențelor (DNS → Resend → SMTP → Netlify).

**Total:** ~105 min. Pașii 4, 5, 6 pot sta în așteptare (propagare DNS, verificare Resend); nu sta cu ochii pe ei.

---

## Pasul 1 — Emailurile către contabil și avocat + semnătura electronică calificată (15 min) — 👤

1. 👤 Deschide `01-email-contabil.md` și `02-email-avocat.md`. Completează `[...]` (nume, telefon, email) și trimite fiecare din emailul tău. Atașează la avocat fișierele din tabelul din `02-email-avocat.md`.
2. 👤 În emailul către contabil e întrebarea 5 despre semnătura calificată. **Dacă firma are un furnizor partener, comanzi prin ea.** Dacă nu, comanzi singur de la un furnizor de servicii de încredere calificat din România (verifică pe lista oficială a furnizorilor calificați; compară prețul, cu identificare video la distanță, valabilitate 1–3 ani).
   - Ai nevoie de: actul de identitate, telefon, email, uneori o poză cu actul. Activarea durează 1–3 zile.
   - Cere varianta pe care o acceptă **ONRC** și **SPV** (ANAF).
   - Păstrează PIN-ul și codul de revocare în managerul de parole.
3. 🤖 Când vin răspunsurile, mi le dai numerotate. Eu le pun în cod, în contract și în pagina de prețuri.

**Rezultat:** contabilul și avocatul au pachetul; semnătura calificată e comandată.

---

## Pasul 2 — Domeniul `menuvia.ro` și serverele de nume pe Netlify (12 min) — 👤

> Decizia D3: `menuvia.ro` pe numele tău. `.com` e luat (`menuvia.com` nu e al tău); nu-l cumpăra și nu-l folosi în nicio setare.

1. 👤 Alege un **registrar acreditat pentru domenii .ro** (lista acreditaților e publicată de administratorul domeniului .ro). Cumpără `menuvia.ro`, **reînnoire automată** pe perioada maximă permisă. Datele de titular sunt ale tale acum; la înființarea SRL-ului cerem registrarului procedura de schimbare a titularului (întreabă acum ce costă).
2. 👤 În Netlify: la nivel de echipă, **Domains** (sau Site configuration → Domain management) → **Add or register domain** / **Add a domain you already own** → scrii `menuvia.ro` → alegi **Use Netlify DNS** (setezi Netlify ca DNS).
3. 👤 Netlify îți arată **4 nameservere**. Copiază-le **exact**. La registrar, schimbă serverele de nume ale domeniului (secțiunea „Nameservers” / „DNS”) pe cele 4 de la Netlify. Salvează.
4. 👤 În site-ul Menuvia din Netlify → **Domain management** → **Add a domain alias** / **Add custom domain**: `menuvia.ro` ca domeniu principal; `www.menuvia.ro` ca alias care redirecționează. Lasă Netlify să emită certificatul HTTPS (Let’s Encrypt) când DNS-ul e propagat (minute–ore).
5. 🤖 Ce fac după: setez `APP_URL`/`VITE_APP_URL` și schimb `HEALTH_URL` din `health-watch.yml` pe `https://menuvia.ro/health`; verific că `https://menuvia.ro` răspunde pe HTTPS **înainte** de orice republicare.
6. ⛔ Nu pune `menuvia.com` în Netlify, Supabase, Resend sau Stripe. Codul încă are referințe la `.com` (neutralizate în pachetul 5), dar tu nu le configura nicăieri.

**Rezultat:** QR-urile pot fi tipărite pe domeniul final. Azi `netlify.toml` setează deja `VITE_APP_URL = https://menuvia.ro` în contextul production, iar funcțiile Netlify nu citesc acea valoare la runtime (au fallback-uri per funcție în `netlify/functions/lib/appUrl.js`).

---

## Pasul 3 — GitHub: environment `production` + secrete (12 min) — 👤

**Ce deblochează:** backup zilnic criptat, repetiția pe copie (`dry_run`), aplicarea automată a migrațiilor, diagnosticul din `health-watch`.

### 3a. Environment `production`

1. 👤 Repo `menuvia-cloud` → **Settings** → **Environments** → **New environment** → nume exact `production`.
2. 👤 La **Deployment branches and tags** → **Selected branches and tags** → **Add deployment branch or tag rule** → `main`.
3. 👤 **Required reviewers: lasă gol** (fără aprobatori; decizia din plan).
4. 👤 Mai jos, **Environment secrets** → **Add environment secret** de două ori:

| Nume (exact) | Valoare | Cum o obții |
|---|---|---|
| `SUPABASE_DB_URL` | URI-ul **Session pooler** | Supabase → proiectul de producție → **Connect** → **Session pooler** → copiezi URI-ul și înlocuiești `[YOUR-PASSWORD]` cu parola bazei. ⛔ **Nu folosi hostul direct `db.*.supabase.co`**: pe runnerii GitHub (fără IPv6) dă timeout (`db-backup.yml`). Dacă nu mai ai parola bazei, spune-mi înainte să o resetezi. |
| `BACKUP_PASSPHRASE` | parolă **lungă și aleatoare** (≥ 32 caractere) | O generezi în managerul de parole. **O păstrezi DOAR acolo.** Dacă o pierzi, backup-urile criptate nu se mai pot deschide niciodată. |

### 3b. `HEALTH_DIAG_TOKEN` — ca secret de **repository**, nu de environment

> **Atenție (cod vs. plan):** planul îl pune în environment-ul `production`, dar `.github/workflows/health-watch.yml` îl citește ca `secrets.HEALTH_DIAG_TOKEN` și **nu declară `environment:`**, deci un secret din environment nu e vizibil acolo. Pe `main` îl citește tot ca secret de repository (`docs/RUNBOOK.md` §4.1: „GitHub → Settings → Secrets → Actions → `HEALTH_DIAG_TOKEN`”). **Îl pui ca secret de repository.** (Alternativ, pachetul 1 poate muta și health-watch pe environment; până atunci repository.)

1. 👤 **Settings** → **Secrets and variables** → **Actions** → tab **Repository secrets** → **New repository secret**: nume `HEALTH_DIAG_TOKEN`.
2. 👤 Valoarea: un șir aleator lung. **O primești de la mine în chat** (sau o generezi: `openssl rand -hex 32`). **Aceeași valoare** o pui și în Netlify (pasul 9). Dacă nu coincid, health-watch dă eroare: „HEALTH_DIAG_TOKEN din GitHub nu coincide cu cel din env-ul Netlify”.

> **Până la pachetul 1** workflow-ul `DB Backup` de pe `main` citește `SUPABASE_DB_URL` și `BACKUP_PASSPHRASE` ca secrete de **repository** (nu declară `environment:`). Pachetul 1 (ne-mergeuit încă) îl mută pe `environment: production`. Deci primul backup „real” poate rula abia după pachetul 1; dacă îl pornești înainte, vei vedea „Backup IMPOSIBIL: secrets lipsă” — e normal.

### 3c. După tine
- 🤖 Verific primul backup (rulează singur la 02:30 UTC; un `Run workflow` manual e posibil doar de la tine: **Actions** → **DB Backup** → **Run workflow**) și rulez `dry_run`: restaurare pe Postgres efemer + aplicarea migrațiilor pe copie + porțile. ⛔ Nu mă baza pe `workflow_dispatch` de la mine: dispatch-ul e blocat pentru agent.

---

## Pasul 4 — Supabase: trecerea pe **Pro** + organizația „menuvia-test” (6 min) — 👤

> **Întâi Pro, apoi restul.** Protecția contra parolelor compromise e funcție Pro (pasul 8). Pe Free nu există backup Supabase, iar proiectul se pune în pauză după 7 zile fără activitate.

1. 👤 Supabase → organizația cu proiectul de producție → **Billing** (sau **Organization settings → Billing**) → **Change plan** → **Pro** (~25 $/lună).
2. 👤 Lasă **Spend cap pornit** (plafonul de cheltuieli): nimic peste cost fix fără acordul tău.
3. 👤 Creează o **organizație separată, Free**, numită `menuvia-test` (Organization switcher → New organization → plan Free). Nu faci nimic în ea; **proiectul de test îl creez eu** prin conector, cu cost 0.
4. 🤖 Ce fac după: proiectul gratuit pentru mediul TEST în organizația `menuvia-test` + branch deploy Netlify `stripe-test`. Cheile TEST merg **doar** acolo.

---

## Pasul 5 — Stripe: cont, profil Connect, chei TEST (15 min) — 👤

> Decizia D2: lucrez cu cheile **TEST**, în mediul TEST. **Cheile TEST nu ajung niciodată în producție**: cu ele, oricine ar lua Planul 3 cu cardul de test 4242. **LIVE se face în Ședința 3**, pe SRL, nu acum.

1. 👤 Creezi contul Stripe cu țara **România** (email-ul tău, parolă din manager). Activezi 2FA (pasul 11). Rămâi pe **mod test**; nu ți se cere activarea LIVE acum.
2. 👤 Activezi **Connect**: Dashboard → **Connect** → **Get started** (sau „Settings → Connect”). Completezi chestionarul de **profil de platformă**: Menuvia e o *platformă* care (a) plătește agenții de vânzări (conturi **Express**, cu verificare de identitate și IBAN făcută de Stripe) și (b) permite restaurantelor să încaseze plăți la masă (conturi **Standard**).
   - **Tipul de cont nu se alege global**: Express/Standard se stabilește la crearea fiecărui cont din cod. Dacă interfața îți cere să alegi „un singur tip”, spune-mi ce vezi, nu bifa la întâmplare.
   - Costul Express (~2 €/lună per cont activ plătit în luna respectivă + ~0,25% + ~0,10 € per plată) e estimarea din plan; **se confirmă în contul tău**.
3. 👤 **Developers** → **API keys** (în modul test): copiază
   - **Secret key** `sk_test_…` → în variabila `STRIPE_SECRET_KEY`;
   - **Publishable key** `pk_test_…` → în variabila `STRIPE_PUBLISHABLE_KEY`.
   Mi le dai **în chat, o singură dată** (sunt chei TEST). ⛔ **Nu le pune în Netlify, contextul `production`.** Eu le pun doar în branch deploy-ul `stripe-test`.
4. 🤖 Ce fac după, în mediul TEST (nu în producție): cele 4 prețuri (`STRIPE_STARTER_PRICE_ID`, `STRIPE_GROWTH_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_ENTERPRISE_PRICE_ID`), endpoint-urile de webhook create **prin API** cu `api_version=2023-10-16` (`STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` — le pun eu, marcate secret), Customer Portal, Test Clock-ul pentru trial și un transfer Express de test.
   > Procedura de webhook: `docs/GHID_FONDATOR.md` PASUL 5. Nu le crea din Dashboard (versiunea evenimentelor se alege la creare și nu se mai poate schimba).

**Rezultat:** poți testa trial, comisioane și transferuri fără bani reali.

---

## Pasul 6 — OpenAI (5 min) — 👤

1. 👤 Cont OpenAI (platform) → **Billing** → încarcă un **credit preplătit** mic și setează un **plafon lunar de 50 $** (**Usage limits**/„Budget”), ca în D5.
2. 👤 **API keys** → **Create new secret key** (numește-o `menuvia-prod`) → copiază cheia o singură dată.
3. 👤 Cheia merge în Netlify, contextul `production`, ca **`PLATFORM_OPENAI_KEY`** (pasul 9). `/health` arată `config.ai_platform:true` când e setată (alternativ `PLATFORM_ANTHROPIC_KEY`; nu e nevoie de ambele).

---

## Pasul 7 — Resend: domeniul, DNS, DMARC, cheia + redirecționare email (12 min) — 👤

> **Ordinea contează:** verifici domeniul în Resend, **apoi** creezi cheia și o pui în Netlify. Cu cheia setată înainte de verificare, emailurile din coadă cad definitiv pe `failed` (T4 din plan).

### 7a. Resend

1. 👤 Cont Resend → **Domains** → **Add Domain** → `menuvia.ro`. Alege **regiunea UE**, dacă e oferită.
2. 👤 Resend îți arată înregistrările DNS (SPF, DKIM și un MX pentru subdomeniul de retur). **Adaugi fiecare** în Netlify DNS: Domains → `menuvia.ro` → **DNS settings** → **Add new record** (tip, nume, valoare, exact cum afișează Resend). Apoi **Verify** în Resend.
3. 👤 **DMARC** (un TXT în Netlify DNS): nume `_dmarc`, valoare de pornire:
   ```text
   v=DMARC1; p=none; rua=mailto:radu@menuvia.ro
   ```
   (începe cu `p=none` — doar rapoarte; îl întărim după 2–4 săptămâni, cu tine.)
4. 👤 **API Keys** → **Create API Key**, permisiune **Sending access**, doar domeniul `menuvia.ro`. **Creează DOUĂ chei separate**, ca să poți revoca una fără să o strici pe cealaltă:
   - `menuvia-netlify` → variabila `RESEND_API_KEY` (pasul 9);
   - `menuvia-supabase-smtp` → parola SMTP din Supabase (pasul 8).
5. ℹ️ Planul gratuit Resend are o limită zilnică de emailuri; planul (§0.5) trece pe Pro peste ~60 emailuri/zi la vârf sau 2.000/lună.

### 7b. Adresele de email care apar în aplicație

Din cod (`netlify/functions/lib/appUrl.js`, `menuvia-pack/`): `hello@` (expeditor implicit), `radu@` (Reply-To pe toate emailurile; destinatarul `founder_alert`), `noreply@`, `pilot@`, `contact@`, `privacy@`. Planul mai menționează `support@` (nu apare încă în cod). **Catch-all `*@menuvia.ro` → Gmail-ul tău** le acoperă pe toate.

1. 👤 Alege un serviciu de **redirecționare cu MX** compatibil cu Netlify DNS (ex. ImprovMX sau ForwardEmail; sau redirecționarea oferită de registrar). Verifică în contul lor că planul gratuit permite **adresă universală (catch-all/wildcard)**.
2. 👤 Adaugi domeniul `menuvia.ro` la serviciu; el îți dă 2 înregistrări **MX** (și uneori un TXT SPF) pe domeniul rădăcină. Le adaugi în Netlify DNS. ⚠️ Un domeniu poate avea **un singur** SPF TXT pe rădăcină: dacă serviciul cere unul, îl combini, nu adăuga al doilea. (SPF-ul Resend e pe subdomeniul lui, deci nu intră în conflict.)
3. 👤 Creezi alias-ul `*` (toate) → adresa ta Gmail. Testează trimițând un email la `test-orice@menuvia.ro`.
4. 🤖 Verific că domeniul e „Verified” în Resend și că un email de test pleacă. Anulez cele 4 emailuri vechi din coadă **înainte** de republicare.

---

## Pasul 8 — Supabase: parole compromise, SMTP, șablon, URL-uri (8 min) — 👤

> Căi generice în dashboard-ul Supabase al proiectului de producție (în `docs/GHID_FONDATOR.md` PASUL 4 există și un link direct pentru pagina Auth providers).

1. 👤 **Leaked password protection**: Authentication → Providers (secțiunea parolă) / **Attack protection** → pornește **Leaked password protection** → Save. (Cere Pro, făcut la pasul 4.)
2. 👤 **SMTP prin Resend**: Authentication → **Emails** → **SMTP Settings** (sau Project settings → Authentication → SMTP) → **Enable custom SMTP**:
   - Sender email: `noreply@menuvia.ro`; Sender name: `Menuvia`
   - Host: `smtp.resend.com`; Port: `465`
   - Username: `resend`
   - Password: cheia `menuvia-supabase-smtp` din pasul 7
   (valorile Resend: verifică în documentația lor SMTP dacă s-au schimbat).
3. 👤 **Rate limits**: Authentication → **Rate Limits** → ridică limita de emailuri pe oră la un nivel care nu blochează înscrierile (cu SMTP propriu valoarea implicită e mică). Spune-mi valoarea pe care o pui.
4. 👤 **Șablon „Confirm signup”**: Authentication → **Emails** → **Email Templates** → **Confirm signup**. Păstrează și **linkul** (build-ul vechi încă îl folosește), și **codul de 6 cifre**. Adaugă în corp:
   ```html
   <h2>Confirmă-ți contul Menuvia</h2>
   <p>Introdu acest cod în aplicație:</p>
   <p style="font-size:28px;letter-spacing:6px;font-weight:700">{{ .Token }}</p>
   <p>Sau apasă linkul:</p>
   <p><a href="{{ .ConfirmationURL }}">Confirmă adresa de email</a></p>
   <p>Dacă nu ai creat tu un cont, ignoră acest email.</p>
   ```
   Subiect sugerat: `Codul tău Menuvia: {{ .Token }}`. Lasă **lungimea codului OTP la 6**. Ecranul de introducere a codului vine în pachetul 7; până atunci merge linkul.
5. 👤 **URL Configuration** (Authentication → URL Configuration):
   - **Site URL:** `https://menuvia.ro`
   - **Redirect URLs:** `https://menuvia.ro/**` și domeniul Netlify actual `https://menuvia.netlify.app/**` (și `https://www.menuvia.ro/**` dacă folosești `www` pe aplicație).
   - ⛔ **Niciodată `menuvia.com`.** Fără `localhost` pe producție.
6. 👤 Verifică că **Confirm email** rămâne **pornit**.
7. 🤖 Ce fac după: testez un cont nou (email de confirmare ajunge, linkul și codul funcționează), verific că `terms_accepted_at` se consemnează.

---

## Pasul 9 — Netlify: variabile de mediu, DOAR contextul `production` (4 min) — 👤 + 🤖

> **Unde:** Site configuration → **Environment variables** → **Add a variable**. La fiecare: bifează **Contains secret values** pentru secrete; **Scopes**: Functions (și Builds doar dacă e nevoie); **Deploy contexts**: **Production** (nu „All”, nu branch deploys, nu deploy previews).
> Valorile intră în vigoare la **următorul deploy**. Cât publicarea automată e oprită, serverul nu pornește; **republicarea o fac eu** când sunt îndeplinite condițiile (vezi finalul).

### 👤 Variabilele tale (secrete)

| Variabilă (exact) | Secret? | Valoare / de unde | Folosită de |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | **DA** | Supabase → Project settings → **API Keys** → cheia **`service_role`** (⛔ nu `anon`/publishable). Dacă dashboard-ul îți arată doar noul tip „secret key”, spune-mi înainte să-l folosești. | toate funcțiile |
| `HEALTH_DIAG_TOKEN` | **DA** | aceeași valoare ca secretul GitHub din pasul 3b | `health.js` (`x-health-diag`) |
| `RESEND_API_KEY` | **DA** | cheia `menuvia-netlify` din pasul 7 (**doar după ce domeniul e „Verified”**) | `process-email-queue.js` |
| `PLATFORM_OPENAI_KEY` | **DA** | cheia din pasul 6 | `ai-proxy`, `ai-generate-image` |

### 🤖 Variabilele pe care le pun eu (ne-secrete sau generate)

`SUPABASE_URL` (URL-ul proiectului de producție), `APP_URL` și `VITE_APP_URL` = `https://menuvia.ro` (doar după ce domeniul răspunde pe HTTPS), `EMAIL_FROM` / `EMAIL_REPLY_TO` (au fallback `hello@menuvia.ro` / `radu@menuvia.ro`; le verific), `DB_SIZE_LIMIT_BYTES` (opțional; implicit 500 MB), `AI_CONFIG_SECRET` (cheia de criptare a cheilor AI per restaurant; ≥ 32 caractere; **dacă există deja, o las neschimbată**: schimbarea ar face ilizibile cheile salvate), `WEBHOOK_SECRET` (secretul INTERN pentru `send-push`/`welcome-email`; **nu e** secretul Stripe).

### ⛔ Ce NU pui în `production` acum

`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` și cele 4 `STRIPE_*_PRICE_ID` — **cheile TEST merg doar în `stripe-test`**; cele LIVE vin la Ședința 3.
Netlify nu are nevoie de `SLACK_WEBHOOK_URL` (Slack rămâne oprit, D4). Lista completă canonică: blocul `/etc/menuvia/env` din `docs/VPS_RUNBOOK.md` și tabelul din `docs/RUNBOOK.md` §5.

> **Ce vei vedea în health-watch până la Ședința 3 (nu e o greșeală de-a ta):** `.github/workflows/health-watch.yml` pică cu `::error::` pe fiecare `config.<x>: false` când `/health` dă 200 cu token. Cât Stripe LIVE și Slack lipsesc, `config.stripe` și `config.slack` vor fi `false`, deci alarma poate rămâne roșie. Nu o repar eu în pachetul acesta (workflow-urile nu intră în dosar); o adaug la pachetul 3 (apelurile spre Slack mutate pe `founder_alert`) sau o ajustez la cerere.

---

## Pasul 10 — UptimeRobot pe `/health` (3 min) — 👤

1. 👤 Cont UptimeRobot (gratuit) → **Add New Monitor**.
2. 👤 **Monitor Type:** HTTP(s). **URL:** `https://menuvia.ro/health` (rutat la funcția `health` prin `netlify.toml`). **Interval:** 5 minute. **Alert contact:** emailul tău (+ aplicația push, dacă vrei).
3. ℹ️ Endpoint-ul răspunde la HEAD și GET; dă **200** când totul e sănătos și **503** când baza sau o sondă critică e căzută. Până când AI-ul republică, va arăta **DOWN** — e normal; poți pune pauză.
4. 🤖 Când UptimeRobot e verificat, șterg `health-watch.yml` (stopgap).

---

## Pasul 11 — MFA și 2FA (10 min) — 👤

### 11a. MFA în Menuvia (conturile fondatorului)
Pe **ambele conturi de fondator din Menuvia** (cele care au acces la FounderPage):
1. Autentifică-te în Menuvia → **Setări** → secțiunea **Cont** → cardul **„Autentificare în doi pași (MFA)”** → **Activează MFA**.
2. Scanează codul QR cu aplicația de autentificare; **salvează în managerul de parole și cheia text afișată sub QR** (pe aceasta o poți re-introduce pe alt telefon).
3. Introdu codul de 6 cifre → apare „MFA activat”. Din acest moment contul cere codul din aplicație.
> ⚠️ Dacă pierzi telefonul și nu ai cheia text salvată, resetarea cere intervenție în baza de date. Salvează cheia **înainte** să închizi fereastra.

### 11b. 2FA pe conturile care țin cheile
Activează autentificarea în doi pași (aplicație TOTP sau cheie hardware, nu SMS dacă ai de ales) pe: **ambele Gmail**, **GitHub**, **Netlify**, **Supabase**, **Stripe**, **Resend**, **registrarul de domenii**, plus OpenAI și UptimeRobot dacă oferă. Salvează codurile de recuperare în managerul de parole.

---

## Pasul 12 — „Da” la D1–D15 + șefii (3 min) — 👤

1. 👤 Completezi `04-fisa-decizii-D1-D15.md` (DA/NU pe fiecare rând).
2. 👤 Îmi dai **numele primilor 2–3 șefi de vânzări** (oameni care vând ei înșiși din prima zi). Ei sunt invitați abia în Ședința 3, după repetiția generală în TEST.

---

## Ce face AI-ul după Ședința 1 (în ordinea asta; nu aștepți nimic de la tine până la Ședința 2)

1. 🤖 Creez **mediul TEST**: proiect Supabase gratuit în `menuvia-test` + branch deploy Netlify `stripe-test`, cu cheile TEST doar în contextul lui.
2. 🤖 Verific **primul backup** și rulez **`dry_run`**: restaurare + aplicarea migrațiilor 289–300 pe copie + porțile.
3. 🤖 **Anulez cele 4 emailuri vechi din coadă**, *înainte* ca serverul să pornească.
4. 🤖 **Deblochez publicarea** doar când toate sunt îndeplinite: migrațiile 299 și 300 sunt pe producție, coada veche e anulată, domeniul e verificat în Resend și `https://menuvia.ro` răspunde pe HTTPS.
5. 🤖 Verific **`/health` = 200** (cu `x-health-diag`: `config.*`, `schema`, `queues`, `pgcron`).
6. 🤖 Verific disponibilitatea mărcii „Menuvia” (EUIPO/OSIM), înainte de orice QR nou tipărit.
7. 🤖 Verific dacă echipa Netlify e pe credite (vezi D6).

## Pasul 2a (de la distanță, ~10 min): semnarea actelor constitutive

Când contabilul trimite actele, 👤 le semnezi cu **semnătura electronică calificată**. Atât.

## Capcane (citește o dată)

| Capcană | Ce să faci |
|---|---|
| Cheile puse în Netlify cât publicarea e încă automată | Verifică „Auto publishing” oprit **înainte** de pasul 9 |
| `HEALTH_DIAG_TOKEN` în environment, nu în repository | Pune-l ca **repository secret** (health-watch nu are `environment:`) |
| `SUPABASE_DB_URL` cu hostul direct | Doar **Session pooler** (IPv6) |
| `BACKUP_PASSPHRASE` pierdută | Backup-urile nu se mai pot deschide; păstrează-o în manager |
| Resend: cheia în Netlify înainte de verificarea domeniului | Emailurile cad pe `failed` definitiv; verifică întâi |
| Un al doilea SPF TXT pe rădăcină | Combină înregistrările; un domeniu = un singur SPF |
| Cheile Stripe TEST în `production` | Niciodată; doar în `stripe-test` |
| `menuvia.com` în Supabase/Resend/Stripe/Netlify | Niciodată; domeniul e al altcuiva |
| Supabase Free | Fără backup, pauză după 7 zile, fără protecție parole → treci pe Pro la pasul 4 |
| MFA fără cheia text salvată | Salvează cheia sub QR înainte de a închide |

## Fișa de bifat (la sfârșitul Ședinței 1)

- [ ] Emailuri trimise (contabil, avocat); semnătura calificată comandată
- [ ] `menuvia.ro` cumpărat; NS pe Netlify; HTTPS emis
- [ ] GitHub: environment `production` (main, fără aprobatori) + `SUPABASE_DB_URL` + `BACKUP_PASSPHRASE`; repository secret `HEALTH_DIAG_TOKEN`
- [ ] Supabase pe Pro, spend cap pornit; organizația `menuvia-test` (Free)
- [ ] Stripe: cont RO, Connect pornit, `sk_test`/`pk_test` date mie (NU în producție)
- [ ] OpenAI: credit + plafon 50 $/lună; cheia în `PLATFORM_OPENAI_KEY`
- [ ] Resend: domeniu Verified, DMARC `p=none`, două chei; catch-all `*@menuvia.ro` → Gmail testat
- [ ] Supabase Auth: leaked password, SMTP Resend, șablon cu link + `{{ .Token }}`, Site URL + Redirect URLs (fără `.com`), rate limit
- [ ] Netlify `production`: `SUPABASE_SERVICE_ROLE_KEY`, `HEALTH_DIAG_TOKEN`, `RESEND_API_KEY`, `PLATFORM_OPENAI_KEY` (secret)
- [ ] UptimeRobot pe `/health`
- [ ] MFA în Menuvia (2 conturi) + 2FA pe toate conturile
- [ ] Fișa D1–D15 + numele șefilor trimise
