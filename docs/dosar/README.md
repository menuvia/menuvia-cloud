# Dosarul fondatorului (pachetul 4) — ce trimiți, ce faci, în ce ordine

> **Stare:** 28 oct 2026. Pregătit de AI din planul `PLAN_optimizat` §0.2 (Ședința 1, 2a, 2, 3) și §0.3 pachetul 4. **Doar documente**: niciun cod, nicio migrație, niciun workflow modificat.
> **Nu e sfat juridic sau fiscal.** Emailurile pun ÎNTREBĂRI; contractele sunt DRAFT pentru avocat. Răspunsurile contabilului și ale avocatului le primește AI-ul de la tine și le pune în cod și în texte.
> **Regulă:** nicio valoare secretă nu se scrie în acest director. Secretele se pun doar în consolele indicate în `05-ghid-sedinta-1.md`.

## Ce conține directorul

| Fișier | Ce e | Când îl folosești |
|---|---|---|
| [`01-email-contabil.md`](01-email-contabil.md) | Emailul către firma de contabilitate: SRL, TVA, Oblio, autofacturare, Stripe, cost anual (28 de întrebări numerotate) | Ședința 1, pasul 1 |
| [`02-email-avocat.md`](02-email-avocat.md) | Emailul către avocat, **un singur pachet** (D14): contracte, anti-piramidă, GDPR, texte juridice, atribuire, dovada acceptării (31 de întrebări numerotate) + lista de atașamente | Ședința 1, pasul 1 |
| [`03-contract-agent-v1-draft.md`](03-contract-agent-v1-draft.md) | Ciorna contractului de agent (DRAFT) | Atașament la avocat |
| [`03b-contract-sef-vanzari-v1-draft.md`](03b-contract-sef-vanzari-v1-draft.md) | Ciorna contractului de șef de vânzări (DRAFT; doar diferențele față de agent) | Atașament la avocat |
| [`04-fisa-decizii-D1-D15.md`](04-fisa-decizii-D1-D15.md) | Fișa D1–D15: decizie, varianta recomandată, ce se întâmplă dacă răspunzi NU | Ședința 1, pasul 12 |
| [`05-ghid-sedinta-1.md`](05-ghid-sedinta-1.md) | Ghid pas cu pas pentru Ședința 1: căi de meniu, nume exacte de variabile/secrete, ce faci tu și ce face AI-ul | În timpul Ședinței 1 |

## Înainte de Ședința 1

- [ ] 🤖 Emailurile, ciorna contractului, fișa D1–D15 și textele de copiat (acest director) — **gata**.
- [ ] 🤖 **Publicarea automată blocată în Netlify** („Stop auto publishing”), prin conector, **înaintea** oricărei chei puse de tine. Verifică în Netlify → Deploys că e oprită (ghid, „Înainte să începi”).
- [ ] 👤 Ai un manager de parole, o aplicație de autentificare pe telefon și ~100 de minute nestingherite.

## Ședința 1 — 28 oct (~100 min): tot ce nu cere firmă

Ordinea de mai jos e cea din ghid (are în vedere dependențele DNS → Resend → SMTP → Netlify). Detaliile click cu click sunt în [`05-ghid-sedinta-1.md`](05-ghid-sedinta-1.md).

| ✓ | Pas | Ce faci (👤) | Min | Ce deblochează |
|---|---|---|---:|---|
| ☐ | **1** | Trimiți cele 2 emailuri (`01`, `02`) + comanzi **semnătura electronică calificată**, cu identificare video | 15 | SRL-ul, banca, contractul, SPV-ul |
| ☐ | **2** | Cumperi `menuvia.ro` pe numele tău (registrar .ro, reînnoire automată) și pui serverele de nume pe Netlify DNS | 12 | QR-urile pe domeniul final |
| ☐ | **3** | GitHub → Environment `production` (doar `main`, fără aprobatori): `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE`; secret de repository: `HEALTH_DIAG_TOKEN` | 12 | Backup zilnic; repetiția pe copie; migrații automate; diagnostic în health-watch |
| ☐ | **4** | Supabase: **Pro** (cu spend cap) + organizație Free „menuvia-test” | 6 | Backup Supabase; protecția parolelor; loc pentru mediul TEST |
| ☐ | **5** | Stripe (România) + Connect; îmi dai `sk_test` / `pk_test` — **doar TEST** | 15 | Prețuri, webhook-uri, portal, Test Clock în mediul TEST |
| ☐ | **6** | OpenAI: credit preplătit + plafon 50 $/lună; cheia pentru `PLATFORM_OPENAI_KEY` | 5 | Importul AI al meniului |
| ☐ | **7** | Resend: domeniu, DNS, DMARC, două chei + redirecționare catch-all `*@menuvia.ro` → Gmail | 12 | Emailurile pleacă și răspunsurile ajung la tine |
| ☐ | **8** | Supabase Auth: leaked-password, SMTP Resend, șablon cu link + `{{ .Token }}`, URL-uri (fără `.com`) | 8 | Codul de 6 cifre; confirmarea ajunge în inbox |
| ☐ | **9** | Netlify, doar `production`: `SUPABASE_SERVICE_ROLE_KEY`, `HEALTH_DIAG_TOKEN`, `RESEND_API_KEY`, `PLATFORM_OPENAI_KEY` (secret) | 4 | Serverul, când AI-ul republică |
| ☐ | **10** | UptimeRobot pe `https://menuvia.ro/health` | 3 | Alarmă din afară |
| ☐ | **11** | MFA în Menuvia (2 conturi) + 2FA pe Gmail ×2, GitHub, Netlify, Supabase, Stripe, Resend, registrar | 10 | Conturile care țin cheile sunt protejate |
| ☐ | **12** | „Da” la D1–D15 + numele primilor 2–3 șefi | 3 | Tot restul |

### Copy-paste rapid (valorile exacte, fără secrete)

```text
# GitHub — Environment `production` (Environment secrets)
SUPABASE_DB_URL        = <URI Session pooler din Supabase → Connect>
BACKUP_PASSPHRASE      = <parolă lungă, doar în managerul de parole>

# GitHub — Repository secrets
HEALTH_DIAG_TOKEN      = <primit de la AI sau: openssl rand -hex 32>   # aceeași valoare și în Netlify

# Netlify — Environment variables, scope Functions, context Production only
SUPABASE_SERVICE_ROLE_KEY = <cheia service_role>      # secret
HEALTH_DIAG_TOKEN         = <aceeași valoare>         # secret
RESEND_API_KEY            = <cheia menuvia-netlify>   # secret, doar după ce domeniul e Verified
PLATFORM_OPENAI_KEY       = <cheia OpenAI>            # secret

# NU în Netlify production acum
STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET,
STRIPE_CONNECT_WEBHOOK_SECRET, STRIPE_*_PRICE_ID   # TEST doar în `stripe-test`; LIVE în Ședința 3
```

```text
# Netlify DNS — DMARC (TXT)
Nume:    _dmarc
Valoare: v=DMARC1; p=none; rua=mailto:radu@menuvia.ro
```

```text
# Supabase → Auth → SMTP (Resend)
Sender email: noreply@menuvia.ro      Sender name: Menuvia
Host: smtp.resend.com                 Port: 465
Username: resend                      Password: <cheia menuvia-supabase-smtp>

# Supabase → Auth → URL Configuration
Site URL:       https://menuvia.ro
Redirect URLs:  https://menuvia.ro/**   https://menuvia.netlify.app/**
(NICIODATĂ menuvia.com)
```

## Ce face AI-ul după Ședința 1 (nu cere nimic de la tine)

1. Mediul TEST (Supabase gratuit în „menuvia-test” + branch deploy Netlify `stripe-test`, cu cheile TEST).
2. Primul backup verificat + `dry_run` (restaurare pe copie + aplicarea 289–300 + porțile).
3. Cele 4 emailuri vechi din coadă, **anulate înainte** de pornirea serverului.
4. Publicarea deblocată **doar** când: 299 și 300 sunt pe producție, coada veche e anulată, domeniul e verificat în Resend și `https://menuvia.ro` răspunde pe HTTPS.
5. `/health` = 200 verificat.
6. Verificarea mărcii „Menuvia” (EUIPO/OSIM), înainte de orice QR nou tipărit.
7. Verificare: echipa Netlify e pe credite? (D6)

## Așteptare (săpt. 1–3): ce ai de făcut

| Moment | Ce faci | Min |
|---|---|---:|
| **Pasul 2a** — contabilul trimite actele | 👤 Semnezi actele constitutive cu semnătura calificată (de la distanță) | ~10 |
| **Răspunsurile** contabilului / avocatului | 👤 Mi le dai **numerotate**, într-un singur mesaj (contabil: 1–28; avocat: 1–31) | 5 |

## Ședința 2 — când ai CUI-ul (~săpt. 2–3, ~40 min)

- [ ] 👤 Contul bancar (15 min).
- [ ] 👤 Împuternicirea SPV pentru contabil (15 min).
- [ ] 👤 Îmi dai **CUI-ul, nr. ONRC și sediul**, plus răspunsurile contabilului și ale avocatului (5 min). De aici AI-ul completează datele de facturare din ANAF și pachetul 9 (texte juridice finale).
- [ ] 👤 Cere registrarului procedura de transfer al titularului `menuvia.ro` de pe numele tău pe SRL.

## Ședința 3 — IBAN activ + avocatul a predat + pachetul 9 publicat (~săpt. 4–6, ~45 min)

- [ ] 👤 Stripe **LIVE** pe MENUVIA SRL: verificarea identității, IBAN, Connect activat în LIVE, plăți către bancă **lunar, pe 20** (20 min).
- [ ] 👤 `sk_live` în Netlify, doar `production`; plus o cheie restricționată temporară, fără drept pe încasări/transferuri/plăți, ca AI-ul să configureze contul live (prețuri, webhook-uri, portal). Secretul webhook-ului îl pune AI-ul. Cheia temporară o ștergi la final (7 min).
- [ ] 👤 Acces **doar de citire** în Stripe pentru contabil, cu notificare la fiecare plată (3 min).
- [ ] 👤 De 3 ori „Invită șef” → „Trimite” (10 min) — **doar după** repetiția generală din TEST (pașii 1–6 din §7) și după contractul v1 publicat.

## După lansare

T9 = un „da” al tău, după ce primul ciclu live a rulat în **mod de probă** (plăți calculate, nimic transferat) și cifrele au ieșit corecte (~martie–mai 2027). Recurent: ≤ 10 min pe săptămână, nimic lunar, ~30 min pe an pentru bilanț.

## Diferențe față de plan, găsite la verificarea codului (urmez codul)

| # | Plan | Cod pe `main` | Ce am făcut |
|---|---|---|---|
| 1 | `HEALTH_DIAG_TOKEN` în environment-ul `production` (Ședința 1, pasul 2) | `health-watch.yml` citește `secrets.HEALTH_DIAG_TOKEN` fără `environment:` → un secret din environment nu e vizibil | În ghid: **secret de repository** (`05`, pasul 3b) |
| 2 | Backup și migrații automate cu secrete din environment | `db-backup.yml` de pe `main` citește secrete de **repository**; pachetul 1 (ne-mergeuit) îl mută pe `environment: production` | Notat în ghid: primul backup „real” rulează după pachetul 1 |
| 3 | Pragul minim de plată 45 lei | Codul are 50 lei (`p_min_cents default 5000`, mig 294) | Contractele cer 45 lei „ținut în baza de date”, cu notă tehnică (pachetul 13) |
| 4 | D9: la suspendare se plătesc comisioanele câștigate | Batch-ul plătește doar afiliați `active` (mig 294); nu există RPC de suspendare | Contractul scrie D9; nota în fișă (pachetele 8 și 13) |
| 5 | Bonus șef 20% | `cascade_bps` = 200 (2%) azi | Contractul 03b scrie 20%; schimbarea e în pachetul 8 |
| 6 | `docs/AFFILIATE_PROGRAM.md` §1.1: comision doar pe Plan 3, setup la prima factură | Mig 293: comision pe toate planurile plătite; setup scris la a DOUA factură | Contractele urmează codul (mig 293) |
| 7 | Slack oprit (D4) | `health-watch.yml` pică roșu pe fiecare `config.<x>: false` (inclusiv `slack`, `stripe`) când `/health` dă 200 cu token | Notat în ghid, pasul 9; nu modific workflow-uri |
| 8 | Lista sub-procesatorilor din DPA | Codul mai folosește PostHog, Anthropic, Google Gemini, Google Fonts; Twilio NU e folosit (doar un comentariu de config Supabase) | Întrebarea 23 din emailul către avocat |

## Întrebări deschise pentru tine

1. Numele primilor 2–3 șefi de vânzări (pasul 12).
2. Ce registrar .ro preferi? (nu aleg eu; ghidul e generic.)
3. Vrei să export contractele și emailurile în PDF/Word pentru avocat și contabil?
4. Ai acordul scris al unui patron pentru demo-ul public (D15)? Dacă nu, spune-mi și demo-ul se amână.
