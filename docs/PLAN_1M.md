# PLAN 0 → 1.000.000 € — realist, pe cifrele Menuvia

> Scris 6 iulie 2026. Curs folosit: 1 € ≈ 5 lei. Prețuri reale din `lib/plans.ts`:
> Starter 99 / Growth 249 / Pro 499 lei/lună (83/208/415 la anual).
> „1 milion" are 3 sensuri diferite — planul le atinge în ordinea asta:
> **€1M evaluare** (an 2) → **€1M venit cumulat** (an 3–4) → **€1M ARR** (an 4).

## 0. Matematica de bază (de ce e greu și de ce e posibil)

- €1M ARR = **5.000.000 lei/an = ~417.000 lei MRR**.
- Mix realist de planuri la maturitate (50% Starter / 35% Growth / 15% Pro,
  cu discount anual) → abonament mediu **~180 lei/lună/client**.
- **Plățile online schimbă jocul**: la taxa de 1% (100 bps, sub Qerko), un local
  care procesează 20.000 lei/lună prin telefon aduce +200 lei/lună — cât încă
  un abonament. Cu 25–30% din clienți procesând volum real, ARPU blended urcă
  la **~200–220 lei/lună**.
- Deci €1M ARR ≈ **~2.000–2.100 clienți plătitori** (sau mai puțini cu
  penetrare mai bună pe payments). Piața HoReCa RO: ~45.000 de unități active,
  din care realist adresabile digital ~15–20.000 → ținta = **10–14% din piața
  adresabilă**. Ambițios, dar în zona unui lider de categorie — nu fantezie.
- Churn-ul e variabila care omoară sau salvează totul: la 2%/lună, pentru a
  SUSȚINE 2.000 de clienți trebuie înlocuiți ~40/lună doar pe churn.

## 1. FAZA A — „Există?" (iul–sep 2026) · ținta: 10 plătitori + 1 pilot fiscal

Platforma e construită (PLAN_10 la ~7/10, codul la 9). Faza A = livrare + dovadă.

- Livrare: VPS live (GHID_FONDATOR, ~20 min), CI deblocat, merge #188.
- **Pilotul fiscal** (telefon EconMedia → casă demo → 1 local real): comanda din
  telefon → bonul iese din casa localului. Filmat = argumentul pe care NIMENI
  din RO nu-l poate copia repede.
- Primii 10 plătitori: manual, față în față, localuri din oraș + 2–3 afiliați
  reali activați (contabili HoReCa — programul de comisioane E construit:
  30% setup + 10%/lună 12 luni).
- Cifre: MRR ~1.500–2.500 lei. Irelevant financiar; relevant = **retenția**.
- ✔️ GATE A: ≥8/10 rămân plătitori după 60 zile și folosesc produsul
  săptămânal. Dacă nu → problema e produs/piață, NU vânzări; STOP scalare,
  interviuri, fix, repetă.

## 2. FAZA B — „Se repetă?" (oct 2026 – mar 2027) · ținta: 100 plătitori

- Canale, în ordinea randamentului:
  1. **Afiliere** (construită deja): 10–15 contabili/agenții active × 3–6
     clienți/an fiecare. Comisionul face matematica singur.
  2. **Founder-led sales**: 10–15 demo-uri/lună, închidere ~30% → 3–5/lună.
  3. **Bucla organică**: fiecare meniu QR văzut de sute de clienți/lună —
     „Powered by Menuvia" discret pe meniu + pagina de comparație publică.
- Studiul de caz video al pilotului = arma principală de vânzare.
- Cifre: 100 plătitori × ~150 lei mediu = **~15.000 lei MRR (€36k ARR)**.
  Costuri: infra <150 lei + comisioane ~15% → tot profitabil pe unitate.
- ✔️ GATE B: churn <3%/lună · activare (semnup→prima comandă) >50% ·
  CAC recuperat în <6 luni. Fără astea, 100→1.000 doar multiplică găurile.

## 3. FAZA C — „Motorul" (apr 2027 – mar 2028) · ținta: 450 plătitori + payments live

- **Pornirea motorului tranzacțional**: plata online la masă (deja construită)
  activată agresiv pe Plan 3 + bacșiș digital + `online_payment_fee_bps`
  setat la 100–135. La 30% adopție reală, +€40–60k ARR peste abonamente.
- **Canalul-cheie al fazei: dealerii de case de marcat.** Rețeaua EconMedia și
  distribuitorii FiscalNet vând case în fiecare zi către exact clientul nostru
  — un parteneriat white-label/revenue-share („casa + meniul digital care
  scoate bonul singur") = singurul canal care poate aduce zeci de clienți/lună
  fără angajați. Negocierea începe la telefonul din Faza A.
  - Plan B dacă nu iese: agențiile de web-design local (fac site-uri de
    restaurante; Menuvia = upsell la comision prin programul de afiliere).
- Prima angajare (luna ~12–15): **1 om vânzări+suport** (~4.500 lei net),
  plătit din marjă, nu din speranță.
- Cifre: 450 × ~185 lei blended + payments = **~90–100.000 lei MRR
  (~€230–250k ARR)**. Break-even REAL (cu salariul fondatorului) la ~250
  de clienți, atins pe parcursul fazei.
- 🏁 **BORNA 1: €1M EVALUARE** — SaaS profitabil cu creștere >100%/an se
  evaluează la 4–6× ARR → se atinge aici, la ~€200–250k ARR.
- ✔️ GATE C: NRR >100% (expansiunea pe payments compensează churn-ul) ·
  ≥1 canal non-founder aduce >40% din clienții noi.

## 4. FAZA D — „Scala" (apr 2028 – iun 2029) · ținta: 1.200 plătitori

- Echipă 4–5: 2 vânzări, 1 suport/CS, 1 dev (fondatorul iese din operațional).
- **Axa de expansiune (DECISĂ de fondator, 6 iulie): INTERNAȚIONAL cu
  planurile 1–2** — vezi secțiunea dedicată de mai jos. Verticalele RO
  (hoteluri, lanțuri mici) rămân plan B dacă tracțiunea internațională întârzie.
- Cifre: 1.200 × ~210 lei blended = **~250.000 lei MRR (~€600k ARR)**.
- 🏁 **BORNA 2: €1M VENIT CUMULAT** se trece în această fază.
- ✔️ GATE D: churn <2%/lună · marja brută >80% cu echipa plătită.

## 5. FAZA E — „Milionul" (iul 2029 – dec 2030) · ținta: 2.000–2.500 plătitori

- Continuarea D + efectul compus al buclei organice (mii de meniuri active =
  cel mai mare canal de marketing gratuit din piață).
- **~417.000 lei MRR = 🏁 BORNA 3: €1M ARR.** Echipă 6–8, marjă >80%,
  profitabil — adică opționalitate: crești mai departe, ridici capital de
  accelerare SAU vinzi (la 4–6× ARR = exit €4–6M).

## 5bis. Pista internațională — planurile 1–2 (decizie fondator, 6 iulie 2026)

**Teza**: fiscalizarea e șanțul din RO, dar și lanțul — planurile 1–2
(Meniu Digital + Meniu & Comenzi) NU ating bonul fiscal, deci călătoresc fără
nicio integrare locală. Meniul client e DEJA în 7 limbi (ro/en/de/fr/it/hu/es).
Modelul devine **two-track**: RO full-stack (ARPU mare, șanț fiscal) +
internațional self-serve pe planurile 1–2 (volum, product-led).

### Ce mai lipsește tehnic (audit făcut, 6 iulie)

| Barieră | Stare | Efort |
|---|---|---|
| **Moneda** (era „lei" hardcodat în 9 fișiere client) | ✅ fundația LIVRATĂ (mig 205 activează `restaurants.currency` (exista din mig 007, era moartă) cu whitelist RON/EUR/HUF/BGN/MDL/USD/GBP; mig 206 o expune pe QR + `lib/currency.ts` cu fmtPrice + teste); rămâne firul prin cele ~35 de afișări | S (1 val) |
| **Dashboard-ul e doar în RO** | cea mai mare barieră — ownerul din Budapesta nu poate folosi un dashboard românesc | M–L: dicționar T() ca la meniu, START cu EN (acceptat internațional), apoi limbi locale pe tracțiune |
| Stripe multi-currency | price ID-uri EUR (19€/49€ — aceleași cifre ca piața) + checkout locale | S |
| Marketing site EN + domeniu .com | landing-ul e deja componentizat (MKT) | S–M |
| Legal EN (ToS/Privacy) | GDPR e deja EU-wide în produs | S (draft eu, avocat tu) |
| Onboarding self-serve | checklist-ul de activare livrat azi + AI menu import (foto→meniu) = diferențiatorul cheie la distanță | ✅ există |

### Ordinea piețelor (cost de intrare crescător)

1. **Moldova** — limba română, zero cost de i18n, MDL în mig 205; piață mică
   dar GRATIS: pornește imediat după livrarea RO.
2. **Self-serve global în EN** (accent UK/IE/expat-heavy EU) — product-led:
   SEO + AI-import + free tier; fără vânzător local. Cere dashboard EN.
3. **O țară vecină țintită** (HU sau BG — ambele limbi deja în meniul client,
   ambele monede în mig 205) — abia după ce self-serve-ul EN dovedește
   conversia; eventual cu un afiliat local (programul de comisioane există).

### Ce schimbă în matematica milionului

- TAM-ul sare de la ~20k la sute de mii de localuri → cei ~2.000 de clienți
  nu mai cer 10–14% dintr-o singură piață, ci ~5% RO + coadă lungă intl.
- ARPU intl planurile 1–2: 19€/49€ ≈ echivalent cu 99/249 lei — mixul blended
  NU scade; churn-ul self-serve e mai mare (4–5%/lună) — compensat de CAC
  aproape zero pe canalul product-led.
- Realist: internaționalul ajunge **20–40% din baza de clienți în anii 3–4**
  și scurtează drumul la €1M ARR cu ~6–12 luni în scenariul optimist.

## 6. Scenarii oneste

| Scenariu | Ce se întâmplă | Rezultat |
|---|---|---|
| **Pesimist (~40% șanse)** | Gate A sau B pică: retenția slabă / vânzarea nu se repetă peste 100–150 de clienți | Business de ~300–500k lei ARR, profitabil ca lifestyle sau pivot (white-label pentru un distribuitor) — NU e €1M, dar nu e nici zero |
| **Realist (~45%)** | Gate-urile trec, dealerii SAU afilierea funcționează | €1M evaluare în an 2 · €1M cumulat în an 3–4 · **€1M ARR în ~4–4,5 ani (2030)** |
| **Optimist (~15%)** | Parteneriatul cu dealerii de case explodează + payments adoptat >50% | €1M ARR în 2,5–3 ani; discuții de achiziție de la un POS/vertical SaaS european |

## 7. Riscurile care pot rupe planul (și contramăsuri)

1. **Un singur om pe drumul critic** — s-a văzut azi (2 cote de furnizor moarte
   tăcut). Contramăsură: F1 din PLAN_10 (monitoring + alerte pe billing-ul
   furnizorilor) + prima angajare devreme.
2. **Execuția comercială ≠ execuția tehnică.** Codul e la 9; vânzarea e la 0.
   Următoarele 6 luni se câștigă cu telefoane și vizite în localuri, nu cu
   feature-uri. Regula: după Faza A, **max 30% din timpul fondatorului pe produs**.
3. **Dependența FiscalNet/EconMedia** (pricing, licențe) — negociază volum
   devreme; păstrează arhitectura bridge agnostică (alt driver = alt adapter).
4. **Reglementare** (e-Factura B2C, SAF-T) — monitorizată în MASTER_PLAN §6;
   poate fi și OPORTUNITATE (fiecare val de reglementare vinde fiscalizare).
5. **Un competitor cu bani** (Qerko intră în RO / GloriaFood face fiscalizare)
   — șanțul = integrarea fiscală + rețeaua de dealeri + prețul; viteza contează.

## 8. Ce fac EU vs. ce faci TU (următoarele 90 de zile)

- **EU**: țin platforma la 10/10 (PLAN_10), construiesc ce cere funnel-ul
  (pagina de comparație publică, materiale de vânzare, onboarding <15 min,
  loyalty după decizii), automatizez tot ce se poate automatiza.
- **TU** (nimeni altcineva nu poate): cele 25 min de livrare (Actions + GHID) ·
  telefonul EconMedia (pilot + deschiderea discuției de canal dealer) ·
  primele 10 vânzări față în față · activarea a 2–3 afiliați reali.

> Sinteza brutală: drumul la €1M nu e blocat de tehnologie — platforma există
> și e peste ce are piața RO. E blocat de: livrare (minute), un pilot care
> tipărește un bon (o săptămână) și un fondator care vinde (12 luni). Planul
> de mai sus doar pune cifre pe această ordine.
