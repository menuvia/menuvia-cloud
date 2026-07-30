# MENUVIA — PLANUL DE EXPANSIUNE (orizontul de creștere maximă)

> Se citește DUPĂ `MASTER_PLAN.md` (direcția) și `PLAN_10.md` (calitatea, fazele 0–5).
> Acest document răspunde la o singură întrebare: **cum ne extindem cât mai mult**,
> pe ce axe, în ce ordine și cu ce active DEJA construite. Actualizat: 12 iulie 2026.

---

## 0. De unde plecăm (starea reală, post-audit total)

Codul a fost auditat cap-coadă în iulie (13 module backend + 28 de pagini UI,
verificare adversarială): **~150 de findings reparate**, scoruri 7–8.5/10 pe module.
Ce e DEJA construit și subestimat ca activ de expansiune:

| Activ în cod | Folosit azi | Potențial de expansiune |
|---|---|---|
| Bridge FiscalNet („păstrezi casa") | pilot nepornit | șanțul întregii piețe RO |
| Plata online la masă (mig 202–211, TP1–12) | nelansat | venit tranzacțional |
| Program afiliere + sub-afiliați + comisioane live | 0 afiliați activi | canalul principal de vânzare |
| Meniu în 7 limbi + traducere AI | pasiv | litoral/turism + CEE |
| Rezervare cu harta sălii („ca la cinema") | live | unic în piață — nefolosit în marketing |
| Review-funnel Google | live | buclă virală de achiziție |
| SEO pe /m/:slug (JSON-LD, mig 212/217/219) | live | achiziție organică programatică |
| AI (import foto, descrieri, upsell, nutriție) | live | diferențiator self-serve |
| Founder dashboard + platform_settings | live | operare la scară fără cod nou |
| Dunning + billing portal (mig 216, stripe-portal) | live | retenție venit automată |

**Singura precondiție hard a TOT ce urmează: PLAN_10 FAZA 0** (hosting live public,
migrațiile 215–222 pe prod, PLATFORM_OPENAI_KEY, Customer portal Stripe). Expansiunea
fără produs public accesibil = zero. Restul fazelor 1–3 (ops/QA/pilot fiscal) rulează
în paralel cu valurile E de mai jos.

---

## 1. Cele șase axe de expansiune

### AXA 1 — Produs: de la „meniu cu comenzi" la „sistemul de operare al localului"
Fiecare treaptă crește ARPU sau retenția, în ordinea ROI/efort:

1. **Tips digitale în flow-ul QR** (S) — serverul are `tips_amount`; doar UI. Pregătește
   plata online și e venit emoțional pentru personal (argument de vânzare către staff).
2. **Lansarea plății online la masă** (S ca lansare — CODUL EXISTĂ, mig 202–211):
   activare Stripe Connect + modul opt-in + primul local. Componenta tranzacțională
   (<1,35%) = primul venit care scalează cu volumul clienților, nu cu numărul lor.
3. **Loyalty v1** (M) — puncte per comandă + prag → recompensă; flag-ul există.
   Taie argumentul TapTasty/Qerko; crește frecvența vizitelor clienților finali.
4. **Split pe item + bon per plătitor** (M) — peste plata online; „tripleta" cu
   tichete de masă (Edenred/Pluxee/Up, L) pe care nimeni din RO nu o are.
5. **Imprimare tichete bucătărie** (M) — ESC/POS prin ACELAȘI bridge local; cerință
   frecventă, reuse de arhitectură, întărește lock-in-ul pe bridge.
6. **Dynamic pricing pe stoc + ore moarte** (L, Q4) — happy hour + stocuri + AI există;
   „meniul care se optimizează singur" — nimeni din benchmark nu o are.

### AXA 2 — Verticale: același cod, segmente noi (efort aproape zero pe produs)
Menuvia e construit pentru „restaurant", dar codul nu știe asta:

- **Hoteluri & pensiuni — room service prin QR** (S): camera = „masă", QR pe noptieră.
  Fluxul existent qr→bucătărie merge NESCHIMBAT. Piață: mii de pensiuni RO fără nicio
  soluție; pitch: „room service fără recepție". Necesită doar copy dedicat + 1 pagină
  landing verticală.
- **Beach bars / terase sezoniere** (S): argumentul e viteza (comanzi de pe șezlong)
  + meniul în 7 limbi (litoral = turiști). Sezonalitate = vânzare concentrată
  (aprilie–mai), preț sezonier posibil din `platform_settings`.
- **Cafenele specialty** (S): programul pilot (/recrutare) le țintește deja; loyalty
  v1 e cârligul (cafeaua = frecvență zilnică).
- **Food trucks & festivaluri** (M): pickup-ul există (order_source 'pickup'); lipsește
  doar modul „fără mese" (QR unic, nu per masă) — o setare, nu o arhitectură.
- **Cantine & corporate catering** (M, mai târziu): comenzi programate + meniu al zilei;
  de evaluat doar la cerere.

**Regula verticalelor**: nu construim NIMIC specific până nu avem 1 client pilot din
verticală; construim doar pagina de landing + pitch-ul (cost ~zero, semnal de cerere).

### AXA 3 — Geografie: RO adânc → diaspora → CEE
1. **RO orașe secundare** (acum): prin afiliați locali (contabili/agenții) — programul
   e construit; orașele mici n-au fost atinse de nimeni (MeniuDigital vinde self-serve
   fără prezență locală).
2. **Diaspora** (Q4): restaurante românești din ES/IT/DE/UK — meniul e deja în limbile
   lor, plata online merge (Stripe e global), fiscalizarea NU se exportă (bridge=RO) →
   se vinde Plan 1–2. Canal: grupurile de diaspora, cost de achiziție mic.
3. **CEE — BG/HU/MD** (2027, doar cu semnal): produsul e multi-limbă și multi-monedă
   (mig 205/206); fiscalizarea per țară = proiect separat per țară (nu ne asumăm acum).
   MD e cel mai ieftin test (limba română, piață nedeservită).

**Ce blochează geografia azi**: nimic tehnic. Doar F0 + marketing.

### AXA 4 — Canale de achiziție (de la 0 la mașinărie)
1. **Activarea REALĂ a afilierii** (prioritatea #1 de business): programul e complet
   (comisioane live, sub-afiliați, payout batch, dashboard) dar are 0 afiliați activi.
   Țintă: 3 contabili/agenții HoReCa activate manual de founder în 30 de zile.
   Argumentul pentru ei: venit recurent din clienții pe care DEJA îi deservesc.
2. **Parteneriat EconMedia/distribuitori de case de marcat** (unic posibil pentru noi):
   ei vând casa, noi venim „peste" — lista publică de case compatibile FiscalNet devine
   pagină de co-marketing. Distribuitorii devin afiliați cu cascade.
3. **SEO programatic** (S, autonom): /m/:slug e deja indexabil cu JSON-LD; adăugăm
   directoare publice „Restaurante cu meniu digital în {oraș}" generate din datele
   existente (opt-in) + pagini compare per competitor. Cost zero, compunere lungă.
4. **Review-funnel ca buclă virală**: fiecare recenzie Google generată de Menuvia
   crește vizibilitatea localului → localul recomandă Menuvia. De adăugat „Powered by
   Menuvia" discret pe meniul public (setare opt-out pe Plan 3).
5. **White-label pentru reselleri** (M, Q4): agențiile web locale vând sub brandul lor;
   scalează canalul de afiliere existent. Tehnic: temă + domeniu custom pe meniul
   public (CNAME) — mare parte există prin theme_settings.
6. **Studiul de caz video al pilotului fiscal** — argumentul pe care concurența nu-l
   poate mima; deblocat de PLAN_10 F3.

### AXA 5 — Monetizare: mai multe motoare de venit
| Motor | Stare | Când |
|---|---|---|
| Abonamente (ladder 3 trepte) | live | acum — ținta 30 plătitori T4 |
| Tranzacțional plăți online (<1,35%) | cod gata, nelansat | E2 |
| Tips (comision 0 la lansare → opțional mic) | server gata | E1 |
| SMS tranzacționale (cost+markup, doar plătit) | de construit (S) | E3 |
| White-label (licență lunară per agenție) | parțial | Q4 |
| Hardware bundle (imprimantă bucătărie la revânzare) | de evaluat | doar la cerere |
| API public pentru integratori (tier separat) | de construit (L) | 2027 |

### AXA 6 — Șanțul de date (defensibilitate pe termen lung)
Cu >30 de restaurante active, datele devin produs:
- **Benchmark anonim per oraș/categorie** („bonul mediu în Cluj: X lei") — în founder
  dashboard întâi, apoi ca raport pentru clienți (retenție Plan 3).
- **AI-ul antrenat pe co-occurrence real** (upsell-ul există) devine mai bun cu fiecare
  comandă — avantaj cumulativ pe care un competitor nou nu-l poate cumpăra.
- Regulă: totul agregat și anonim; nimic per-restaurant nu părăsește contul lui.

---

## 2. Valurile de execuție (E1–E6)

> Convenție: 🤖 = pot construi/livra autonom (cod, pe branch, CI verde);
> 👤 = cere founder (conturi, bani, relații, decizii legale).

### E1 — „Aprinde motoarele" (imediat, paralel cu PLAN_10 F0–F1)
- 👤 **F0 complet** (hosting live, migrații 215–222 pe prod, chei, portal Stripe) — deblochează TOT.
- 🤖 **Tips digitale în QR** (S) — UI peste `tips_amount` existent.
- 🤖 **Pagini verticale**: /hoteluri (room service), /terase, /cafenele — landing-uri
  din componentele de marketing existente (S fiecare).
- 🤖 **„Powered by Menuvia"** discret pe meniul public (opt-out Plan 3) — buclă virală (S).
- 👤 **Activarea a 3 afiliați reali** (contabili/agenții HoReCa) — primul canal.
- Criteriu de ieșire: produs public live + primii 3 afiliați + tips în producție.

### E2 — „Primul venit tranzacțional" (după F3/pilot fiscal)
- 👤🤖 **Lansarea plății online la masă**: founder = cont Stripe Connect + env
  (STRIPE_CONNECT_WEBHOOK_SECRET etc.); eu = ultimele verificări + UI de onboarding
  al restaurantului pe Connect. Primul local: pilotul fiscal (are deja încredere).
- 🤖 **Loyalty v1** (M) — cele 2 decizii de produs din docs/LOYALTY.md le propun eu cu
  default-uri, founder confirmă din mers.
- 🤖 **SEO programatic v1**: directoare pe oraș + pagina „case de marcat compatibile" (S–M).
- 👤 **Studiu de caz video pilot** + pagina de comparație extinsă.
- Criteriu: ≥1 restaurant procesează plăți online; ≥10 plătitori total.

### E3 — „Lățime de produs" (sept–oct)
- 🤖 **Imprimare tichete bucătărie** prin bridge (M) — reuse FiscalNet.
- 🤖 **Split pe item + bon per plătitor** (M) — peste plata online.
- 🤖 **SMS tranzacționale** (S) — confirmare rezervare/comandă gata, doar planuri plătite.
- 🤖 **Modul „fără mese"** pentru food trucks/pickup-only (S).
- 👤 **Parteneriat EconMedia/distribuitori** — co-marketing pe lista de case.
- Criteriu: 30 plătitori, ≥5 pe Plan 3, ≥2 verticale cu câte 1 client.

### E4 — „Geografie" (Q4)
- 🤖 **Landing EN/diaspora** + onboarding în EN (produsul e deja multi-limbă).
- 👤 **Campanie diaspora** (grupuri, 2–3 restaurante pilot ES/IT/DE).
- 🤖 **Tichete de masă** (L) — completează tripleta unică RO.
- Criteriu: primul client în afara RO; tripleta demo-abilă.

### E5 — „Scalarea canalului" (Q4–Q1 2027)
- 🤖 **White-label v1** (CNAME + temă + logo agenție pe meniul public) (M–L).
- 🤖 **Benchmark de date v1** în founder dashboard, apoi raport lunar per client (M).
- 👤 **5 agenții reseller active**.
- Criteriu: ≥20% din clienții noi vin prin parteneri.

### E6 — „Șanțul" (2027, doar cu semnal de cerere dovedit)
- Dynamic pricing (L) · Agregator delivery (L) · API public + webhooks (L) ·
  Multi-locație UI agregat (M) · MD/CEE pilot.

---

## 3. Ce NU facem (la fel de important)
- Nu construim features de verticală fără client pilot din verticală.
- Nu intrăm pe delivery/agregatoare fără cerere dovedită (regula din MASTER_PLAN).
- Nu exportăm fiscalizarea în afara RO (bridge-ul e RO-specific by design).
- Nu concurăm pe hardware cu POS-urile — șanțul rămâne „păstrezi casa".
- Nu adăugăm al 4-lea plan de preț — ladder-ul de 3 trepte rămâne.

## 4. KPI-urile expansiunii (peste cele din MASTER_PLAN §7)
- **Achiziție**: clienți noi/lună pe canal (afiliere vs direct vs SEO vs parteneri).
- **Expansiune venit**: % venit tranzacțional din total (țintă: 20% în 6 luni de la E2).
- **Verticale**: nr. verticale cu ≥1 client plătitor.
- **Viralitate**: nr. restaurante venite prin „Powered by Menuvia" / review-funnel.
- **Geografie**: MRR în afara RO.

## 5. Cadență
Fiecare item 🤖 = PR mic + CI verde + criterii de acceptare scrise în task înainte de
cod. Fiecare val se închide cu re-audit pe modulele atinse (pattern-ul sweep-urilor din
iulie). Direcția se schimbă doar în MASTER_PLAN.md; acest doc ține execuția expansiunii.
