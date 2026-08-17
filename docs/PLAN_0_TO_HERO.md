# PLAN 0 → HERO

> **Documentul unic de execuție.** Scris 9 august 2026, ancorat în date REALE
> din baza de producție (nu în impresii). Înlocuiește ca punct de intrare
> `GO_LIVE.md` (rămâne valabil ca detaliu tehnic) și `GHID_FONDATOR.md`
> (rămâne valabil ca listă de pași). Ce e aici e ordinea și **de ce**.

---

## 0. Ce spun datele de producție (9 august 2026)

### Funelul REAL — mini-pilotul din iunie-iulie pe care nimeni nu l-a analizat

| Utilizator | Signup | Restaurant | Produse | Mese | Comenzi |
|---|---|---|---|---|---|
| cocioabamaria55 | 7 iun | ❌ nu a creat | 0 | 0 | 0 |
| alexandru1112 | 11 iun | ❌ nu a creat | 0 | 0 | 0 |
| xsuperalex1717 | 11 iun | Pescaria Malta | **0** | 3 | 0 |
| graducelsius04 | 4 iul | Benino | 15 | 3 | **0** |

**Patru oameni reali au încercat produsul. Toți patru au murit în onboarding.
Nimeni nu a plasat vreodată o comandă.** Cele 28 de comenzi din DB sunt de pe
restaurantul de test al fondatorului.

Locul exact al morții: **introducerea meniului**. Un user a ajuns la 3 mese cu
0 produse; celălalt a pus 15 produse și s-a oprit înainte de prima comandă.

### Restul stării, verificat

| Fapt | Valoare |
|---|---|
| Clienți plătitori | **0** — zero `stripe_customer_id`, zero abonamente. Stripe n-a procesat NICIODATĂ nimic |
| Comenzi în ultimele 30 de zile | **0** |
| `email_queue` | **0 rânduri în toată istoria** (nimic nu șterge din ea) |
| `automation-cron` | **mort din 2 august 19:30** — 7 zile de automatizare tăcută |
| Termeni acceptați | 0 utilizatori |
| MFA pe conturile de platform admin | **dezactivat** (acces total pe toți tenanții, doar cu parolă) |
| Migrații / suite de teste | 257 / 57 SQL + 20 UI — toate verzi |

---

## 1. Diagnosticul central (o frază)

**Nu ai o problemă de produs și nici (încă) una de achiziție — ai o problemă
de ACTIVARE și de OPERARE: patru oameni au intrat singuri și au murit toți la
pasul „introdu meniul", exact pasul pe care importul AI din poze îl elimină —
iar importul AI nu a funcționat niciodată în producție, pentru că îi lipsește
cheia din env.**

Corolarul dur: fiecare oră investită în cod nou a mărit un activ care avea deja
răspunsul la propria problemă, dar cu răspunsul oprit din buton.

---

## 2. Cum punem TOTUL activ, optim (ordinea contează)

Regula de aur: **fiecare bloc se termină cu o verificare care poate eșua.**
Nimic nu se consideră „gata" fără dovadă.

### BLOC 0 — Repară ce e mort (azi, ~1 oră) 🔴

| Pas | Acțiune | Verificare |
|---|---|---|
| 0.1 | Merge PR #203 (`/health` detectează cron mort) | deploy verde |
| 0.2 | **Netlify → Functions → Logs → `automation-cron`**: de ce s-a oprit pe 2 aug. Suspect principal: limita planului Free | vezi cauza scrisă |
| 0.3 | Repară (plan plătit / rărește cron-urile / mută pe VPS — shim-ul din `deploy/` e gata) | `menuvia.ro/health` → **200** cu `cron: "ok"` |
| 0.4 | **UptimeRobot** gratuit pe `/health`, la 5 min | primești email de test la oprire |

> Fără blocul ăsta, tot ce urmează e construit pe nisip: emailurile nu pleacă,
> facturile nu se generează, reminderele nu se trimit — tăcut.

### BLOC 1 — Identitatea (azi, ~2 ore, ~200 lei) 🔴

| Pas | Acțiune | Verificare |
|---|---|---|
| 1.1 | Cumpără **menuvia.ro** + **codvia.ro** (registrar RO, ~50 lei/an fiecare) | domeniile apar în contul tău |
| 1.2 | Netlify → Domain management → adaugă ambele, `menuvia.ro` = **primary** | `https://menuvia.ro` încarcă site-ul |
| 1.3 | **Resend → Domains → menuvia.ro** → pune DKIM/SPF/DMARC în DNS | status **Verified** în Resend |
| 1.4 | Verificare OSIM/EUIPO pe „Menuvia" și „Codvia" (5 min, înainte de tipărituri) | fără conflict evident |

> Un singur activ (domeniul) deblochează simultan: emailurile de rezervare,
> dunning-ul, comenzile Codvia, resetarea de parolă, QR-urile tipărite, SEO-ul
> și canalul GDPR. E cea mai mare pârghie din tot planul.

### BLOC 2 — Cheile și securitatea (azi, ~30 min) 🔴

| Pas | Acțiune | Verificare |
|---|---|---|
| 2.1 | **`PLATFORM_OPENAI_KEY`** în Netlify env ← *deblochează importul AI = fix-ul pentru leak-ul de activare* | import real dintr-o poză → produse extrase |
| 2.2 | `SLACK_WEBHOOK_URL` în env | alertă de test în Slack |
| 2.3 | Supabase → Auth → **Leaked password protection ON** | toggle verde |
| 2.4 | **TOTP pe ambele conturi de platform admin** (Setări → Cont → MfaCard) | login cere codul |
| 2.5 | GitHub Secrets: `SUPABASE_DB_URL` (Session pooler, IPv4) + `BACKUP_PASSPHRASE` | workflow `db-backup` verde |

### BLOC 3 — Dovada că merge (mâine, ~3 ore) 🟠

Prima validare umană din istoria produsului. Fă-le pe telefonul tău real.

| Pas | Test | Dovadă |
|---|---|---|
| 3.1 | Scan QR → meniu → comandă cu opțiuni → apare pe Bucătărie | comanda vizibilă live |
| 3.2 | Rezervare pe `menuvia.ro/rezervare/testc` | **primești emailul de rezervare nouă în inbox** |
| 3.3 | Anulează rezervarea cu codul din email | status `cancelled` + email „masa s-a eliberat" |
| 3.4 | Import AI dintr-o poză reală de meniu (4 pagini) | produse + categorii create |
| 3.5 | `/founder` → „Intră pe cont" + refresh | bannerul persistă |
| 3.6 | Verifică în DB: `select status, count(*) from email_queue group by 1` | apar rânduri **`sent`** |

> Dacă 3.2 sau 3.6 eșuează, blocul 1 nu e cu adevărat terminat.

### BLOC 4 — Legal & încasare (pornit ACUM, gata în săptămâni) 🟠

Are cel mai lung lead-time din tot planul — de aceea începe în paralel, nu după.

1. **SRL** la ONRC (~5 zile lucrătoare, <1.000 lei) → cont bancar
2. **Stripe pe firmă** (CUI + IBAN) → primul price ID live
3. **SPV / e-Factura** ANAF + cont **Oblio**
4. Avocat pe cele 5 draft-uri din `menuvia-pack/` (există, îi dai date de firmă)

> Fără SRL nu poți încasa legal primul leu. Codul de facturare e gata și
> netestat — se testează cu prima plată reală, nu înainte.

---

## 3. Planul 0 → HERO

### FAZA 0 — „Sistemul e viu și demonstrabil" (zilele 1–2)
Blocurile 0–3 de mai sus.
**Poarta de trecere:** `/health` = 200 `cron: ok` · un email real primit în
inbox · un import AI reușit · un test uman complet bifat.
❌ Nu treci mai departe fără toate patru.

### FAZA 1 — „Autopsia mini-pilotului" (ziua 3, ~2 ore) ⭐ *cel mai mare ROI din plan*

Sună-i pe cei **4 oameni reali** care au încercat produsul în iunie–iulie.
Nu ca să le vinzi. Ca să afli de ce s-au oprit.

- `cocioabamaria55` și `alexandru1112` — s-au înscris și **nici n-au creat un
  restaurant**. Întrebarea: ce te-a oprit în primele 5 minute?
- `xsuperalex1717` (Pescaria Malta) — a pus 3 mese, **zero produse**.
  Întrebarea: cât ai încercat să introduci meniul până ai renunțat?
- `graducelsius04` (Benino) — 15 produse, 3 mese, **zero comenzi**.
  Întrebarea: ce ar fi trebuit să se întâmple ca să pui QR-ul pe masă?

**De ce e cea mai valoroasă acțiune din tot documentul:** sunt singurele date
de utilizator real pe care le ai vreodată avut, sunt gratuite, iar răspunsurile
îți spun dacă ipoteza mea (moartea la introducerea meniului) e corectă. Dacă e,
importul AI activat în Blocul 2 e chiar remediul — și îl poți re-invita pe
fiecare dintre ei să încerce din nou, în 10 minute, cu poza meniului.

### FAZA 2 — „Primul local viu" (zilele 4–14)
- Alege **UN** local unde cunoști patronul. Nu doi.
- Instalezi cu `docs/vanzare/PILOT_PLAYBOOK.md` (45 min la fața locului)
- QR-uri pe mese (Codvia sau print local), meniu importat din poze cu AI
- Rămâi în local prima seară de funcționare
- **Poarta:** 10 comenzi reale de la clienți străini + patronul spune „e ok"

### FAZA 3 — „Primul leu" (zilele 15–30)
- SRL-ul e gata → Stripe live → pilotul devine **plătitor** (starter 99 lei)
- Butonul de rezervare pe profilul lui Google (`docs/GOOGLE_REZERVARI.md`)
- Ceri testimonialul + 3 poze reale din local
- **Poarta:** 1 client plătitor + 1 studiu de caz cu poze
- *Abia acum ai voie să vinzi la necunoscuți — ai o dovadă.*

### FAZA 4 — „Repetabil" (luna 2)
- Outreach cu materialele din `docs/vanzare/` pe 50 de localuri
- Primii **3 afiliați** (`AFILIATI_KIT.md`) — canalul care vinde când dormi
- Codvia: mostre de la tipografie, primele comenzi
- **Poarta:** 5 clienți plătitori, dintre care ≥1 venit prin afiliat

### FAZA 5 — „Motorul" (lunile 3–6)
- Pilot fiscal cu EconMedia → primul bon real → planul de 499 lei devine vandabil
- SEO: Search Console + directoare pe oraș
- Reserve with Google (cere ~15–20 de localuri cu rezervări active)
- **Poarta:** 20–30 de clienți, MRR 3.000–6.000 lei

---

## 4. Regula care contează mai mult decât planul

> **Nu se mai scrie cod nou până la Faza 3.**

Ai 257 de migrații, 202 PR-uri și 35 de documente pentru zero clienți. Codul e
la nota 8+; dovada că funcționează e la 3. Singurele excepții permise până la
primul client plătitor:
1. bug-uri găsite de utilizatori REALI,
2. cod care face vizibilă o defecțiune (ca fix-ul de `/health`).

Orice altceva mărește suprafața pe care un singur om trebuie s-o întrețină,
fără să miște acul.

---

## 5. Ordinea de citit a documentelor

1. **Acesta** — ordinea și de ce
2. `docs/vanzare/README.md` → pitch, obiecții, outreach, playbook pilot
3. `GHID_FONDATOR.md` → pașii tehnici, la detaliu
4. `RUNBOOK.md` → ce faci când se strică ceva (+ postmortemul cron 2–9 aug)
5. `GO_LIVE.md` / `EXPANSION.md` → context tehnic și direcție pe termen lung
