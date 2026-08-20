# MENUVIA — MASTER PLAN (planul complet de viitor)

> ⚠️ **SUPERSEDED (20 aug 2026):** planul de execuție UNIC și curent e
> [`PLAN_0_TO_HERO.md`](PLAN_0_TO_HERO.md) — ancorat în datele reale de
> producție. Documentul de mai jos rămâne DOAR context istoric; nu executa
> pași de aici fără să verifici întâi acolo.

> Documentul-mamă: produs + tehnic + fiscal + infra + business + bani + riscuri + KPI.
> Se citește împreună cu: `PLAN_10.md` (calitate, faze cu criterii), `COMPETITIE.md`
> (piața), `EXPANSION.md` (creștere: axe + valuri E1–E6), `ARCHITECTURE.md` (sistemul),
> `BRIDGE_FISCALNET_ARCHITECTURE.md` (fiscal).
> Actualizat: 12 iulie 2026. Orice schimbare de direcție se scrie AICI, nu în chat.

---

## 0. Viziune și poziționare (neschimbate, validate de analiza de piață)

**Menuvia = sistemul de operare al restaurantului mic-mediu din România**, construit pe
propoziția pe care NIMENI din piață nu o spune: **„Păstrezi casa de marcat și POS-ul pe
care le ai."** (bridge FiscalNet → bonul iese din casa LOR, fără hardware nou).

Ladder-ul comercial (anti-MeniuDigital, anti-POS-uri):
1. **Meniu Digital** (free/starter) — intrare ieftină, self-serve, competitiv cu 83 lei/lună.
2. **Meniu + Comenzi** (growth) — comenzi QR + ospătar + bucătărie, upgrade in-product.
3. **Fiscalizare** (pro/enterprise) — bani + bon fiscal + rapoarte; regula de aur: totul
   gate-uit server-side.

Diferențiatorii deja LIVE în cod: fiscalizare pe casa existentă (unic), rezervare cu
alegerea mesei pe hartă (unic), meniu în 7 limbi, AI (import meniu foto, descrieri,
upsell), review-funnel Google, program de afiliere cu sub-afiliați, founder dashboard.

---

## 1. Starea de azi (rezumat scorecard — detalii în PLAN_10.md)

**Codul ~9, operarea ~3** (12 iulie). Săptămâna 6–12 iulie a închis: audit total
(13 module backend + 28 pagini UI, ~150 findings reparate, scoruri 7–8.5), dunning
cap-coadă + billing portal Stripe, lanțul plății online la masă (mig 202–211, TP1–12),
meniul QR pe 1 RTT (mig 212), leak-uri închise (mig 217/219), migrații până la 222
(215–222 validate local, DE APLICAT pe prod la reconectarea MCP). Frânele rămase sunt
DOAR operaționale: (1) producția neaccesibilă public (FAZA 0), (2) E2E/QA (FAZA 2),
(3) pilotul FiscalNet nepornit pe casă reală (FAZA 3). Direcția de creștere:
`EXPANSION.md` (valurile E1–E6 rulează în paralel cu PLAN_10 F1–F3).

---

## 2. ROADMAP — orizontul complet

### ACUM (iulie 2026) — „Livrează și stabilizează" = PLAN_10 Fazele 0–3
Sursa de adevăr cu criterii de acceptare: `PLAN_10.md`. Pe scurt:
- **F0 Deblocare** (72h): hosting decis (recomandat VPS Hetzner ~4€), main LIVE public,
  `PLATFORM_OPENAI_KEY`, leaked-password ON, merge #182.
- **F1 Fundație ops** (săpt. 1): `deploy/` VPS (shim `/.netlify/functions/*` cu handler-e
  neschimbate + node-cron + Caddy + GH Actions), domeniu propriu + Netlify=redirect
  (protejează QR-urile tipărite), Sentry, uptime + dead-man's, backup cu restore testat.
- **F2 QA** (săpt. 2): E2E verzi în CI (Supabase local seeded), teste pe fluxurile de
  bani, k6 pe meniul public.
- **F3 Pilot fiscal REAL** (săpt. 2–3): .exe + installer, casă demo → casă reală,
  bacșiș pe bon (OUG 8/2023), storno minim, **primul bon real la un local pilot**.

### URMEAZĂ (aug–sept 2026) — „Produsul de 10 + primii clienți plătitori"
= PLAN_10 Fazele 4–5 + backlog competiție rămas:

**Produs (ordinea strictă, după ROI/efort):**
1. **Tips digitale în flow-ul QR** (Val A/3 — serverul are `tips_amount`, lipsește doar
   UI-ul; pregătește plata online). S.
2. **Plata online la masă** (Val C/8 — inima lui „URMEAZĂ"): Stripe PaymentIntent,
   Plan 3, gate server-side; bonul fiscal rămâne pe casă (bridge). Etapa 2: split pe
   item + bon per plătitor. Etapa 3: tichete de masă (Edenred/Pluxee/Up) — tripleta pe
   care nimeni din RO nu o are. L, împărțit în 3 sub-livrări.
3. **Loyalty v1** (Val B/7 — flag-ul `loyalty` există): puncte per comandă + prag →
   recompensă; anti-TapTasty/Qerko pe retenție. M.
4. **Onboarding de activare**: checklist ghidat „meniu → masă+QR → prima comandă test"
   în <15 min, cu AI-import ca accelerator. M.
5. **Dunning** (recuperare plăți eșuate abonament) + emailuri lifecycle. S.
6. **Imprimare tichete bucătărie** (ESC/POS pe imprimantă termică, prin același bridge
   local — reuse arhitectură FiscalNet). M. — cerință frecventă în localuri reale.
7. **Gestiune no-show rezervări** (confirmare + penalizare/depozit opțional). S–M.

**Business (paralel cu produsul):**
- **Pilotul → studiu de caz video**: comanda din telefon → bonul iese din casa
  localului. Argumentul pe care concurența nu-l poate mima. Publicat pe landing.
- **Pagina de comparație** „Menuvia vs MeniuDigital vs GloriaFood vs POS-uri" + lista
  caselor compatibile FiscalNet (există poziționarea din #157/#178/#179 — de extins în
  pagină dedicată).
- **Primii 10 clienți plătitori**: canale — (a) programul de afiliere (e construit!
  activează 2–3 afiliați reali din HoReCa/contabili), (b) outreach direct pe localuri
  cu meniu QR competitor (upgrade pitch: „același preț, dar cu bon fiscal"),
  (c) pilotul fiscal ca ancoră de PR local.
- **Suport**: WhatsApp cu fondatorul (deja promis pe landing) + RUNBOOK intern; SLA
  informal <4h în orele de restaurant.

### MAI TÂRZIU (Q4 2026+) — „Scalare și șanț competitiv" (decizii de business, nu se
încep fără semnal de cerere)
- **Dynamic pricing** pe stoc + ore moarte (Val C/9): „meniul care se optimizează
  singur" — fundația (happy hour + stocuri + AI) există. Nimeni din benchmark nu o are.
- **Agregator delivery** Tazz/Glovo/Bolt Food (Val C/10) — DOAR la cerere reală
  dovedită; Choice QR e dovada că se poate ca SaaS mic.
- **Multi-locație** (grupuri/francize: un cont, N restaurante, rapoarte agregate) —
  deschide segmentul TapTasty; azi modelul e 1 owner → N restaurante deja, lipsește
  UI-ul agregat.
- **API public + webhooks** pentru integratori (POS-uri, contabilitate) — transformă
  „păstrezi casa" în „păstrezi tot ecosistemul".
- **White-label pentru reselleri** (agenții web locale vând Menuvia sub brandul lor) —
  scalează exact canalul de afiliere existent.
- **SMS-uri tranzacționale** (confirmare rezervare / comandă gata) — cost per unitate,
  doar pe planuri plătite.
- Infra la scară: când >50 restaurante active, re-evaluare Supabase plan + VPS→2 noduri
  (analiza A1–A10 există în istoricul de taskuri).

---

## 3. Planul fiscal (drumul complet al banilor pe bon)

1. **Acum**: pilot FiscalNet (PLAN_10 F3) — bon din comanda Menuvia pe casa localului.
2. **+Bacșiș pe bon** (OUG 8/2023) — după spec-ul exact EconMedia.
3. **+Storno** — anulare bon cu documentare (flux minim, apoi complet).
4. **+Plata online la masă** — banii intră prin Stripe, bonul iese TOT pe casă
   (arhitectura există: `order.paid` → `pending_receipts` → bridge). Regula de aur
   rămâne: orice atinge bani+bon = Plan 3, gate în RPC/RLS.
5. **+Tichete de masă** — Edenred/Pluxee/Up ca metode de plată (P^4/P^5 pe bon există
   deja în spec FiscalNet; azi enum-ul de payment_method nu le are — migrație nouă).
6. **e-Factura / SAF-T**: Oblio acoperă facturile; monitorizăm obligațiile ANAF 2026–27
   pentru raportări noi (risc de reglementare — vezi §6).

## 4. Planul de infrastructură (țintă: cost fix, zero surprize)

- **Țintă imediată**: VPS Hetzner CX22 (~4€/lună) cu pachetul `deploy/` (F1): static +
  shim funcții + cron + Caddy + GH Actions; Supabase rămâne cloud (free tier ajunge
  pentru <20 restaurante active; upgrade la Pro 25$/lună când realtime/storage cer).
- **Domeniu**: menuvia.ro (sau existent) = URL-ul public canonic; menuvia.netlify.app
  rămâne redirect pe termen nelimitat (QR-uri tipărite).
- **Buget lunar total la lansare**: VPS 4€ + domeniu ~1€ + Supabase 0–25$ + Resend 0
  (free tier) + Stripe (procent) + Sentry/healthchecks 0 (free) ≈ **5–30€/lună**.
- **Scalare**: la >50 restaurante — al 2-lea nod sau upgrade CX32; la >200 — separare
  funcții/static + LB (decizie atunci, nu acum).

## 5. Planul de business & bani (asumpții de validat cu primii clienți)

- **Pricing**: rămâne ladder-ul public — competitiv la intrare cu MeniuDigital
  (~83 lei/lună), valoarea mare pe Plan 3 (Fiscalizare). La plata online: componentă
  tranzacțională mică (<1,35% — sub Qerko) DOAR pe volumul procesat online.
- **Ținte 2026**: T3: 1 pilot fiscal live + 10 plătitori; T4: 30 plătitori, din care
  5 pe Plan 3. (La ~100 lei ARPU mediu → ~3.000 lei MRR la 30; break-even pe infra
  e la ~1 client.)
- **Canal principal**: afiliere (comisioane live: setup + recurring + cascade) —
  activează contabili/agenții care deja deservesc HoReCa; ei aduc încrederea locală.
- **Anti-churn**: onboarding <15 min + review-funnel (valoare vizibilă din prima
  săptămână: recenzii Google) + loyalty (valoare pentru clienții finali).

## 6. Riscuri (top 5) și contramăsuri

| Risc | Impact | Contramăsură |
|---|---|---|
| Dependența de un singur om (fondator) | ops îngheață la absență | RUNBOOK + alerte + dead-man's (F1); documentația e deja bună |
| Reglementare fiscală (ANAF schimbă reguli) | rework pe bon/raportare | bridge-ul izolează formatul într-un singur loc; EconMedia ține pasul cu driverele |
| Casă incompatibilă la clienți | pierdere deal Plan 3 | lista publică de case compatibile FiscalNet + fallback „doar meniu+comenzi" |
| Free-tier-uri care dispar (Supabase/Resend) | cost surpriză | buget de upgrade calculat (§4); export/backup propriu (F1) |
| POS-urile coboară agresiv spre QR (Ebriza/Freya) | presiune pe preț | șanțul = „păstrezi casa" + viteza de livrare; nu concurăm pe hardware |

## 7. KPI-uri de urmărit (dashboard founder — majoritatea există deja)

- **Activare**: % conturi noi care ajung la prima comandă test în 24h (țintă >40%).
- **Retenție**: restaurante active săptămânal / total plătitori (țintă >85%).
- **Fiscal**: bonuri tipărite/zi pe pilot; rata de eroare bridge (<1%).
- **Venit**: MRR, churn lunar (<5%), % Plan 3 din total.
- **Sănătate**: uptime /health (>99.5%), erori Sentry/săpt., p95 meniu public (<1s).

## 8. Cadența de lucru (cum se execută planul ăsta)

- **Sursa de adevăr**: PLAN_10.md pentru calitate (fazele 0–5, în ordine strictă);
  MASTER_PLAN.md (acest doc) pentru direcție. Chat-ul decide, documentul reține.
- **Ritm**: fiecare livrare = PR mic + CI verde + merge; migrații = fișier nou, aplicate
  pe prod prin canalul stabilit (MCP/SQL Editor) ÎNAINTE de deploy-ul FE care le cere.
- **Re-audit**: la finalul fiecărei faze din PLAN_10, re-notez capitolele atinse;
  scorecard-ul se actualizează în PLAN_10.md.
- **Regulile nenegociabile rămân**: bani+bon=Plan 3 server-side; migrațiile aplicate nu
  se editează; TS strict fără `any`; UI română; planul aparține restaurantului.
