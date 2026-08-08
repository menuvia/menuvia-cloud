# PACHETUL DE LANSARE CODVIA
### Suporturi QR fizice — fișe tehnice, marje, texte de vânzare, canale, plan de start
**Versiunea:** 1.0 · **Data:** 7 august 2026 · **Pentru:** fondator (execuție solo)

---

## 0. Unde suntem cu adevărat (citește înainte de orice)

Ce **există deja în cod** și funcționează:

- `/codvia` — landing + catalog cu cele 4 produse + formular de comandă (`src/pages/CodviaPage.tsx`).
- `codvia-order.js` — funcția Netlify care validează comanda, aplică rate-limit (5/oră/IP), salvează lead-ul în `recrutare_leads` cu `source='codvia_order'` și trimite email fondatorului. **Catalogul cu prețuri e sursă de adevăr pe server** — clientul trimite doar cheia produsului.
- Cârligul reciproc: Dashboard Menuvia → Acasă → „Suporturi QR fizice" deschide `/codvia?slug=<slug-ul localului>`, deci comanda vine cu QR-ul REAL al meniului deja completat.
- Modelul v1, deliberat: **fără plată online**. Comandă → email → confirmare telefonică în 24h → ramburs sau transfer.

Ce **NU există** și nu trebuie promis nimănui:

- Nu există furnizor de producție contractat. Nu există mostre. Nu există niciun produs livrat.
- Nu există `codvia_orders` ca tabelă proprie, nu există plată online, nu există generare automată de PDF de print cu QR-ul meniului (toate sunt v2 în `docs/CODVIA.md`).
- Nu există entitate juridică constituită — draft-ul de Termeni de vânzare (`menuvia-pack/06-DRAFT-CODVIA-COMENZI.md`) e blocat pe asta și e marcat explicit „NU e valabil juridic".
- **Costurile de producție din acest document sunt IPOTEZE**, nu oferte. Sunt marcate ca atare peste tot. Prima ofertă reală de la tipografie le înlocuiește.
- Zero clienți plătitori pe Menuvia, zero comenzi Codvia. Fondator solo.

Rolul real al Codvia, ca să nu ne mințim singuri: **e în primul rând canal de achiziție pentru Menuvia și abia în al doilea rând linie de venit.** Fiecare colet livrat duce un insert în mâna unui proprietar de local. Ăsta e activul. Marja pe plastic e bonusul.

---

## PARTEA A — Fișe tehnice pentru tipografie / gravator

### A.0. Reguli care se aplică la TOATE cele 4 produse

Astea sunt regulile pe care le trimiți furnizorului o dată și nu le mai negociezi. Dacă un furnizor le contestă, nu e furnizorul potrivit.

**Codul QR — specificații nenegociabile:**

| Parametru | Cerință | De ce |
|---|---|---|
| Dimensiune minimă modul QR | **35 × 35 mm** print, **45 × 45 mm** gravat | Sub 30 mm, telefoanele vechi și lumina slabă de restaurant seara ratează scanarea |
| Quiet zone (marginea albă din jur) | minim **4 module** pe toate laturile | Fără ea, o mare parte din scannere refuză codul, indiferent cât de bine e tipărit |
| Nivel de corecție a erorii | **Q (25%)** dacă are logo în centru, **M (15%)** dacă nu | Logo-ul „mănâncă" module; cu M și logo, codul devine fragil la zgârieturi |
| Contrast | **întunecat pe deschis**, minim 40% diferență de luminanță | QR-ul inversat (alb pe negru) e refuzat de o parte din scannere native |
| Culoare | negru 100% K sau culoarea de brand **doar dacă e suficient de închisă** | Un QR auriu pe lemn deschis nu scanează. Nu accepta „arată premium" ca argument |
| Suprafață transparentă (plexi) | **strat alb de fundal obligatoriu sub QR** (white underprint) | Un QR tipărit direct pe plexiglas transparent, cu masa de lemn dedesubt, are contrast aproape zero. Ăsta e defectul #1 la standurile ieftine de pe piață |
| Finisaj | **mat**, nu lucios, pe zona QR | Lumina caldă din local se reflectă în lac lucios și albește codul exact în unghiul în care scanezi |
| Fișier livrat | PDF vectorial, QR ca **vector**, nu ca imagine rasterizată | Un QR JPEG mărit are muchii moi → rată de scanare mai mică. Cere-i furnizorului să confirme că nu-l rasterizează |

**Link-ul din QR — decizie de arhitectură, nu de design:**

QR-ul tipărit e permanent. Link-ul din el trebuie să fie unul pe care îl controlezi și care nu se schimbă niciodată. Regula pentru Codvia:

- Client cu Menuvia → QR-ul duce la **`menuvia.ro/m/<slug>`**. Slug-ul e stabil (se schimbă doar prin RPC controlat), meniul din spate se poate rescrie oricând fără să retipărești nimic. Ăsta e argumentul de vânzare, nu un detaliu tehnic.
- Client fără Menuvia (salon, cabinet, nuntă, recenzii Google) → QR-ul duce **direct la link-ul lui** (Google review link, Booksy, site).
  **Nu inventa un shortener Codvia acum.** Un `codvia.ro/r/xxx` ar fi elegant, dar nu există în cod, iar dacă domeniul cade sau nu-l reînnoiești, toate plăcuțele vândute mor. Redirect-ul propriu e o decizie de v2, cu un plan de continuitate scris. Până atunci: link direct, asumat.

**Ambalaj — identic la toate produsele:**
- Cutie de carton ondulat pe măsură (nu plic), folie cu bule pentru plexi/lemn.
- În fiecare colet: **insert A6 (față/verso)** + **card de mulțumire A7** (textele la Partea D).
- Sticker Codvia pe exteriorul cutiei — coletul e primul contact cu brandul.

**Test de acceptanță — se aplică fiecărei mostre și fiecărui lot:**
1. **Scanare la 40 cm** cu 3 telefoane diferite, dintre care unul vechi (≥ 4 ani), din camera nativă.
2. **Scanare la lumină slabă** (~50 lux, adică seara într-un local cu lumină caldă) — cel mai realist test.
3. **Scanare în unghi de 45°** — clientul nu se apleacă drept deasupra.
4. **Test de grăsime**: șterge cu o lavetă cu ulei, apoi cu șervețel umed. Printul trebuie să rămână.
5. **Test de zgâriere**: unghia și cheia, 10 treceri. Se vede?
6. **Test de stabilitate**: împinge ușor cu degetul din lateral. Cade?
7. **Test de căldură**: 2 ore la 50 °C (mașina, vara). PVC-ul subțire se curbează — de aici cerința de grosime.

---

### A.1. Stand PVC + sticker QR — 29 lei

| | |
|---|---|
| **Cheia în cod** | `stand_pvc` |
| **Material** | PVC expandat (Forex/Simopor) **alb, 3 mm** — NU PVC rigid 0,5–1 mm (se curbează la căldură și cade de pe masă) |
| **Format** | Stand tip „L" (bază + spate), placă frontală **100 × 150 mm**, bază **100 × 60 mm**, unghi 15–20° față de verticală |
| **Alternativă acceptabilă** | Format „cort" (tent card) plian, 100 × 150 mm, două fețe identice — mai ieftin, dar mai instabil pe masă cu față de masă textilă |
| **Tipar** | **Print UV direct pe PVC**, 4+0 (o față) sau 4+4 dacă vrei ambele fețe, **finisaj mat** |
| **Prelucrare** | Tăiere pe contur (CNC sau cutter plotter), muchii curățate, fără bavuri |
| **Ce se tipărește** | QR **40 × 40 mm** centrat sus · text scurt deasupra („Scanează meniul" / textul clientului) · numele localului · jos, discret: `codvia.ro` (corp 6 pt, gri) |
| **Toleranțe** | ± 1 mm la tăiere, ± 0,2 mm registru de culoare |
| **Ce ceri la mostră** | 2 bucăți: una cu QR pe fond alb, una cu QR pe fond de culoare închisă a clientului (test de contrast). Plus o bucată **necurățată pe muchii**, ca să vezi ce iese când nu se finisează |
| **Capcana specifică** | PVC-ul de 3 mm expandat e poros pe muchie și se murdărește. Întreabă dacă fac **muchie sigilată** sau lac pe cant. Dacă nu, treci pe 3 mm PVC rigid (mai scump, mai curat) |

**Întrebări de pus furnizorului:**
1. Prețul e pe bucată la print UV direct sau aplicați folie printată pe PVC? (Folia se dezlipește în 6 luni pe masă ștearsă zilnic — vrei print direct.)
2. Ce grosime de strat alb puneți sub culoare? Se vede PVC-ul prin negru?
3. Aveți tăiere pe contur inclusă sau se facturează separat pe metru liniar?
4. Care e cantitatea minimă la care prețul de bucată se stabilizează?
5. Câte bucăți intră pe o placă standard (de obicei 3000 × 2000 mm)? Prețul poate fi discutat **pe placă**, nu pe bucată — asta e pârghia reală.
6. Timp de execuție la 10 buc? La 100 buc? Livrați sau ridic eu?
7. Puteți primi PDF gata de producție (vector, bleed 3 mm, contur pe strat separat) fără cost de DTP?

---

### A.2. Stand plexiglas premium — 79 lei

| | |
|---|---|
| **Cheia în cod** | `stand_plexi` |
| **Material** | **Plexiglas (PMMA) turnat, transparent, 4–5 mm.** Turnat („cast"), nu extrudat — extrudatul topește muchia la laser și iese lăptos |
| **Format** | Stand tip „L" dintr-o bucată, îndoit la cald: frontal **100 × 150 mm**, bază **100 × 70 mm**. Alternativ: 2 piese (frontal + suport greu) |
| **Prelucrare** | **Tăiere laser**, muchii **lustruite la flacără** (flame polish) — asta face diferența dintre 79 lei și 29 lei la privire |
| **Tipar** | **Print UV pe VERSO (reverse print), cu strat alb dedesubt.** Ordinea straturilor: culoare → alb opac → (privitorul se uită prin plexi). Printul e protejat de plexi, nu se zgârie niciodată |
| **Ce se tipărește** | QR **40 × 40 mm** pe câmp alb opac · numele/logo-ul localului · 1 rând de text („Scanează pentru meniu" sau textul clientului) · `codvia.ro` discret jos |
| **Toleranțe** | ± 0,5 mm la tăiere laser, unghi de îndoire ± 2° |
| **Ce ceri la mostră** | **Obligatoriu 2 variante: una cu strat alb sub QR, una fără.** Pune-le pe o masă de lemn închis și încearcă să le scanezi seara. Diferența e brutală și e argumentul tău în toate discuțiile ulterioare. Plus: o mostră cu muchie nelustruită vs. lustruită |
| **Capcana specifică** | „Print UV pe plexi" fără strat alb = produs nescanabil pe masă închisă. Nu presupune că știu — cere-le explicit „white underprint 100%" în ofertă, scris |

**Întrebări de pus furnizorului:**
1. Plexiglasul e turnat sau extrudat? (Dacă răspunsul e „e la fel", schimbă furnizorul.)
2. Faceți strat alb la print UV? În câte treceri? Se vede masa prin el?
3. Îndoirea la cald e la voi sau subcontractată? (Dacă e subcontractată, termenul se dublează.)
4. Lustruirea muchiilor e inclusă în preț sau opțiune?
5. Pelicula de protecție rămâne pe produs până la ambalare? (Dacă o scot devreme, primești produse zgâriate.)
6. La ce cantitate mă puteți grupa cu alte lucrări pe aceeași placă („nesting")? Ce preț îmi dați pe m² de material?
7. Ce nivel de rebut acceptați și cine îl suportă? (La laser + îndoire, 3–5% e normal — trebuie să fie al lor, nu al meu.)

---

### A.3. Placă lemn gravat — 129 lei

| | |
|---|---|
| **Cheia în cod** | `placa_lemn` |
| **Material** | **Lemn masiv: fag, stejar sau nuc, 12–18 mm.** Nu MDF placat, nu plywood — se vede pe cant și distruge percepția de premium la 129 lei |
| **Format** | Placă **90 × 140 mm**, colțuri rotunjite R5, cu **tăietură de sprijin** la 15° în bază (stă singură) SAU cu picior separat din același lemn |
| **Prelucrare** | Gravură laser, adâncime **0,5–1 mm**, urmată de **șlefuire fină + ulei natural sau lac mat**. Uleiul se aplică DUPĂ gravură |
| **Ce se gravează** | QR **45 × 45 mm** (mai mare decât la print — gravura are contrast mai mic) · logo-ul clientului · numele localului · text scurt |
| **Contrast** | Cere **test de scanare pe fiecare esență**. Fagul deschis + gravură arsă = contrast bun. Nucul închis = contrast slab, QR-ul poate deveni nescanabil. **Regula: pe lemn închis, QR-ul se face invers — se gravează FONDUL, nu modulele** (rămân modulele închise pe fond ars deschis) sau se umple gravura cu vopsea |
| **Toleranțe** | ± 0,5 mm la tăiere, variație naturală de fibră acceptată (e argument de vânzare, nu defect) |
| **Ce ceri la mostră** | **Câte o mostră din FIECARE esență pe care o oferi**, cu același QR. Scanează-le pe toate seara. Elimină din catalog esențele care nu trec testul — nu le vinde cu „poate merge". Plus: o mostră neuleiată vs. uleiată (uleiul închide lemnul și scade contrastul cu 1–2 trepte) |
| **Capcana specifică** | Gravura pe lemn **fumează** — rămâne o aură maro în jurul modulelor care „îngrașă" QR-ul optic. Cere să se sufle/aspire în timpul gravurii și să se șteargă cu alcool înainte de uleiere |

**Întrebări de pus furnizorului:**
1. Ce esențe aveți pe stoc constant? (Nu vreau să promit stejar și să primesc „s-a terminat".)
2. Lemnul e uscat tehnic? La ce umiditate? (Peste 12% se torsionează în 2 luni pe o masă caldă.)
3. Gravați și apoi finisați, sau invers? (Corect: gravură → curățare → finisaj.)
4. Care e timpul-mașină pe bucată? (La laser, ăsta e costul real — de aici înțelegi de ce discountul de volum e mic.)
5. Puteți face umplere de gravură cu vopsea/rășină pe esențele închise? Cu ce cost în plus?
6. Aveți certificat de proveniență lemn? (Contează la clienții corporate și la pensiunile care se laudă cu „eco".)
7. Ce preț îmi dați dacă vă trimit 20 de fișiere diferite într-o singură comandă (20 de clienți, 1 buc fiecare) vs. 20 identice? (Diferența îți spune dacă poți face fulfilment „one-off" sau doar loturi.)

---

### A.4. NFC + QR combo — 179 lei

| | |
|---|---|
| **Cheia în cod** | `nfc_combo` |
| **Cip** | **NTAG213** (144 bytes — suficient pentru un URL) sau **NTAG215** (504 bytes, dacă vrei rezervă). Antenă **25–30 mm** diametru — sub 20 mm scade distanța de citire sub 1 cm și clientul crede că e stricat |
| **Suport** | Două variante — decide-te la o singură: **(a)** plexi 5 mm cu cipul lipit pe verso, sub print opac; **(b)** lemn 15 mm cu freză pe verso, cipul îngropat și acoperit cu fetru |
| **Recomandarea mea** | Varianta (b) pe lemn — la 179 lei clientul se așteaptă la greutate în mână. Plexi-ul la 179 lei se simte ca plexi-ul la 79 lei cu un sticker în plus |
| **Format** | Ca la A.3 (90 × 140 mm) sau disc Ø 90 mm |
| **Ce se tipărește/gravează** | QR 45 × 45 mm + **simbolul NFC** + text obligatoriu: **„Atinge sau scanează"** (fără el, 80% dintre oameni nu știu ce e) |
| **Programare** | URL record (NDEF), scris de tine sau de furnizor. **NU bloca definitiv cipul (lock) la prima serie** — dacă ai greșit un link, o serie întreagă e la gunoi. Blochează doar când procesul e rodat |
| **Ce ceri la mostră** | 1 buc programată cu un link de test. Verifică: distanța de citire cu **iPhone** (antena e sus, în spate) și cu **Android** (antena e la mijloc) · citirea prin husă groasă · citirea **așezat pe masă de metal** (dacă local are mese metalice, ai nevoie de strat ferrite — întreabă dacă îl pun) |
| **Capcana specifică** | Metalul din apropiere ucide NFC-ul. Dacă vinzi la un local cu mese metalice fără strat ferrite, primești retur. Întreabă furnizorul dacă poate lipi folie ferrite între cip și suport — costă ~1–2 lei și îți salvează comenzi |

**Întrebări de pus furnizorului:**
1. Ce cip exact folosiți? Vreau NTAG213 sau 215, nu „compatibil NFC".
2. Programarea e inclusă sau o fac eu? Dacă e la voi, cum îmi confirmați că fiecare bucată e scrisă corect? (Cere **verificare 100%**, nu prin sondaj — un cip nescris = colet retur.)
3. Puneți folie ferrite? Cu ce cost?
4. Cipul e garantat câți ani? Ce se întâmplă la umiditate?
5. Care e prețul cipului separat, ca să știu ce plătesc pentru montaj?
6. Puteți livra cipurile neprogramate ca să le scriu eu? (Dacă da, câștigi flexibilitate: schimbi link-ul până în ultima clipă.)

---

### A.5. Cum negociezi prețul la volum — mecanica, nu tonul

**Regula de bază: nu toate produsele scad la fel cu volumul, pentru că nu au aceeași structură de cost.**

| Produs | Structura costului | Scădere așteptată 10 buc → 100 buc |
|---|---|---|
| PVC (print UV) | **setup mare** (pregătire mașină, plăci) + marginal mic | **−40% … −55%** — cere agresiv |
| Plexi (laser + print) | setup mediu + timp-mașină mediu | **−25% … −35%** |
| Lemn (gravură laser) | **timp-mașină dominant** (fiecare bucată se gravează separat) | **−15% … −25%** — nu insista peste, nu are de unde |
| NFC combo | cost material fix (cipul) + manoperă | **−15% … −20%** (cipul scade doar la mii de bucăți) |

Dacă un furnizor îți oferă −50% la lemn gravat, ori tăia din calitate, ori prețul de la 10 buc era umflat. Ambele sunt informații.

**Cele 8 mișcări care chiar mută prețul:**

1. **Cere GRILA, nu discountul.** Prima cerere nu e „îmi faci mai ieftin?", ci „dă-mi prețul la 10 / 25 / 50 / 100 / 250 / 500 buc". Grila îți arată unde e pragul lor real și de unde încolo nu mai are rost să comanzi mai mult.
2. **Separă setup-ul de bucată.** „Cât e setup-ul și cât e bucata?" Dacă setup-ul e 150 lei, îl plătești **o dată** și ceri explicit **preț de re-comandă din același fișier, fără setup**. La al doilea client cu același design, ai deja avantaj.
3. **Livrează fișier gata de producție.** PDF vectorial, CMYK, bleed 3 mm, contur pe strat separat, fonturi convertite în curbe. Scoate DTP-ul din factură — de obicei 10–20%.
4. **Cere preț pe m² de material, nu pe bucată.** La laser și CNC, costul real e suprafața de placă folosită. Dacă negociezi pe m² și grupezi comenzi de la mai mulți clienți pe aceeași placă („nesting"), câștigi 15–25% fără ca furnizorul să piardă nimic. Ăsta e cel mai subestimat levier.
5. **Plătește pe loc, cere reducerea.** „Plătesc integral la ridicare, cash sau transfer în ziua facturii — ce preț îmi dai?" 5–8% e uzual. Ca firmă nouă, fără istoric, asta e singura ta monedă de negociere.
6. **Angajament pe orizont, nu pe comandă.** „Estimez 40–60 buc/lună din septembrie. Îmi ții prețul de la treapta 50 pentru 6 luni, chiar dacă o lună comand 20?" Fixezi prețul fără să-ți asumi stoc. **Nu inventa cifre pe care nu le poți susține** — dacă spui 200/lună și livrezi 15, arzi relația.
7. **Al doilea furnizor e levierul, tonul rămâne calm.** Cere ofertă de la **minimum 3**. Nu le spui niciodată „X mi-a dat mai ieftin" ca amenințare; spui „am o ofertă la Y lei pe treapta de 50 — puteți intra în zona aia?". Diferența dintre cele două formulări e diferența dintre un furnizor care te ajută la o urgență și unul care nu-ți răspunde la telefon.
8. **Nu cere discount la prima comandă.** Prima comandă e mică și le ocupă mașina. Cere în schimb: **mostre gratuite sau la preț de cost**, termen exact în scris, și grila de preț. Discountul îl ceri la a treia comandă, când ai istoric — atunci are greutate.

**Ce NU negociezi niciodată:** grosimea materialului, stratul alb sub QR, lustruirea muchiilor, verificarea 100% a cipurilor NFC. Astea sunt specificația. Dacă prețul nu iese cu ele, iese cu alt furnizor.

---

## PARTEA B — Calculul marjei și pragurile

> ⚠️ **Toate costurile de mai jos sunt IPOTEZE de lucru**, construite din prețuri publice de piață pentru materiale și manoperă. Nu sunt oferte. Primul lucru pe care îl faci după ce primești cele 3 oferte e să înlocuiești coloana „Cost estimat" cu numere reale. Până atunci, tratează marjele ca pe o schiță, nu ca pe un buget.

### B.1. Cost pe bucată (ipoteză, la o serie de ~50 buc)

| Produs | Preț listă | Cost estimat/buc | Marjă brută/buc | Marjă % |
|---|---|---|---|---|
| Stand PVC | 29 lei | 7–11 lei | ~19 lei | ~66% |
| Stand plexi | 79 lei | 24–32 lei | ~51 lei | ~64% |
| Placă lemn | 129 lei | 38–52 lei | ~84 lei | ~65% |
| NFC combo | 179 lei | 45–65 lei | ~124 lei | ~69% |

Marjele arată sănătos. **Dar marja pe bucată nu e marja pe comandă** — și acolo se ascunde capcana.

### B.2. Costul pe COMANDĂ (partea care te poate face să pierzi bani)

| Element | Cost estimat |
|---|---|
| Ambalaj (cutie + folie + insert A6 + card A7 + sticker) | ~6 lei |
| Curier cu ramburs, colet mic | ~20–25 lei |
| Comision ramburs (încasare + virare) | ~3–6 lei |
| Timp propriu (confirmare telefonică, fișier, comandă la furnizor, urmărire) | **~30–45 min/comandă** |
| **Total costuri de comandă, fără produs** | **~30–37 lei + timpul tău** |

### B.3. Scenarii reale

| Comandă | Venit | Cost produs | Cost comandă | **Marjă brută** | Verdict |
|---|---|---|---|---|---|
| 1 × PVC | 29 lei | 9 | 33 | **−13 lei** | ❌ Pierzi bani și o oră |
| 4 × PVC | 116 lei | 36 | 33 | **+47 lei** | ⚠️ Marginal — nu merită o oră |
| 4 × plexi | 316 lei | 112 | 33 | **+171 lei** | ✅ Comanda-țintă |
| 10 × plexi | 790 lei | 260 | 35 | **+495 lei** | ✅ Foarte bună |
| 20 × PVC | 580 lei | 160 | 38 | **+382 lei** | ✅ Local mediu, echipat complet |
| 2 × lemn | 258 lei | 90 | 33 | **+135 lei** | ✅ Bună |
| 1 × NFC combo | 179 lei | 55 | 33 | **+91 lei** | ✅ Bună chiar și la 1 buc |
| 30 × PVC (recenzii Google, lanț) | 870 lei | 210 (preț de volum) | 40 | **+620 lei** | ✅ Cea mai bună formă |

### B.4. Cele patru praguri

**Pragul 1 — să nu pierzi bani: valoarea minimă a comenzii = 99 lei.**
Sub 99 lei, transportul mănâncă marja. Regula operațională, de pus pe pagină și de spus la telefon:
> „Livrare gratuită de la 149 lei. Sub această sumă, transportul e 25 lei."

Asta rezolvă și comanda de 1 × PVC (29 + 25 = 54 lei, marjă +12 lei — mică dar pozitivă), și îi dă clientului un motiv concret să comande 4 în loc de 1. **Nu refuza comenzile mici — fă-le să se plătească singure.** Fiecare colet livrat e un insert Menuvia în mâna unui patron, iar asta valorează mai mult decât 13 lei.

**Pragul 2 — să merite timpul: 250 lei/comandă.**
La ~171 lei marjă pentru ~40 minute, ești pe la 250 lei/oră echivalent. Sub asta, timpul tău e mai bine folosit sunând restaurante pentru Menuvia. De aici decurge o regulă de vânzare: **împinge întotdeauna spre plexi (79) și spre cantități de 4+**, nu spre PVC × 1.

**Pragul 3 — să aibă sens ca linie de business: 15 comenzi/lună.**
15 comenzi × ~170 lei marjă medie ≈ **2.500 lei/lună marjă brută**, la ~10 ore de muncă. Asta e pragul de la care Codvia își plătește existența ca activitate separată. Sub el, e un canal de marketing cu buget aproape zero — ceea ce e perfect acceptabil în primele 3 luni, dar trebuie numit așa.

**Pragul 4 — să cumperi stoc în avans: 30 buc/lună din același SKU, 2 luni la rând.**
Până atunci, **zero stoc** — comanzi la furnizor doar după confirmarea telefonică. Singura excepție: **20 de standuri PVC cu QR generic de recenzii Google**, cumpărate în avans (~200 lei) ca să poți livra a doua zi și să ai ce arăta la vizite. Un demo pe care îl ții în mână vinde de zece ori mai bine decât o poză.

### B.5. Numărul care contează cu adevărat

Un client Menuvia pe planul **starter (99 lei/lună)** face **1.188 lei/an**. Pe **growth (249 lei/lună)** face aproape 3.000 lei/an.

Dacă din 20 de colete Codvia livrate **unul singur** se transformă în abonament starter, canalul a produs 1.188 lei de venit recurent — mai mult decât marja totală pe cele 20 de colete. **De aceea insertul din colet nu e un detaliu de ambalaj, ci produsul principal.**

Concluzia practică: **acceptă marjă subțire pe Codvia cât timp fluxul spre Menuvia e viu.** Ce nu accepți niciodată: să livrezi în pierdere de cash. Pragul 1 e sacru.

### B.6. Costuri de pornire (o singură dată)

| Element | Cost |
|---|---|
| Domeniu codvia.ro (registrar românesc) | ~50 lei/an |
| Mostre de la 3 furnizori (dacă nu sunt gratuite) | 300–600 lei |
| Ambalaje, primul lot (50 cutii + folie) | ~250 lei |
| Tipar inserturi + carduri de mulțumire (500 buc A6 + 500 A7) | ~250 lei |
| Stoc demo (20 × PVC recenzii Google) | ~200 lei |
| **Total pornire** | **~1.100–1.400 lei** |

Se recuperează din ~8 comenzi de dimensiune medie.

---

## PARTEA C — Textele de vânzare

> Notă: descrierile scurte de mai jos sunt gândite ca înlocuitor pentru cele din `PRODUCTS` (`src/pages/CodviaPage.tsx`). Dacă le pui în cod, atenție la capcana cunoscută: un `"` drept într-un atribut JSX sparge build-ul — folosește `attr={'...'}` sau backtick.

### C.1. Stand PVC + sticker QR — 29 lei

**Scurt (catalog, 1 rând):**
> Suportul care intră în orice buget. Rezistent, ușor de șters, gata de pus pe masă.

**Lung (pagina de produs):**

> **Cel mai simplu mod de a scoate meniul de pe hârtie.**
>
> Placă de PVC de 3 mm, tăiată în formă de „L", cu codul tău QR tipărit UV direct în material — nu sticker lipit care se dezlipește după două luni de șters cu lavetă.
>
> Se șterge cu orice, nu se decolorează, nu se curbează în vitrina bătută de soare. Stă drept pe masă și nu cade când îl atinge cineva cu cotul.
>
> QR-ul e tipărit la 40 mm și testat să scaneze **seara, la lumină de local, de la 40 de centimetri, cu un telefon vechi** — pentru că ăsta e testul real, nu cel din birou la lumină de zi.
>
> **Se potrivește pentru:** mese de restaurant, terase, bar, recepția unui salon, sala de așteptare.
> **Recomandare:** câte unul pe masă. La 10 mese, 10 bucăți.
>
> Dacă ai meniu Menuvia, QR-ul vine deja legat de meniul tău — schimbi prețurile în telefon, standul rămâne pe masă neschimbat.

---

### C.2. Stand plexiglas premium — 79 lei

**Scurt:**
> Plexiglas tăiat la laser, muchii lustruite, print protejat pe verso. Arată ca într-un local scump, pentru că așa se face în localurile scumpe.

**Lung:**

> **Diferența se vede de la doi metri.**
>
> Plexiglas turnat de 4 mm, tăiat la laser și îndoit la cald dintr-o singură bucată. Muchiile sunt **lustruite la flacără** — nu tăiate și lăsate mate. E detaliul pe care nu-l observă nimeni conștient, dar pe care îl simte toată lumea.
>
> Printul e făcut **pe spatele plăcii**, cu strat alb opac dedesubt. Două consecințe practice:
> - **cerneala nu se poate zgâria niciodată** — e sub 4 mm de plexi;
> - **QR-ul scanează pe orice masă**, inclusiv pe lemn închis. Standurile transparente ieftine, tipărite fără strat alb, pierd contrastul pe masă închisă și clientul rămâne cu telefonul în mână, încercând. Al nostru nu face asta.
>
> Se curăță cu o lavetă umedă. Rezistă la grăsime, la alcool sanitar, la o mie de mâini pe zi.
>
> **Se potrivește pentru:** restaurante cu pretenții, cafenele de specialitate, hoteluri, cabinete, orice loc unde obiectele de pe masă comunică ceva despre preț.
> **Recomandare:** câte unul pe masă. E produsul pe care îl aleg cei mai mulți.

---

### C.3. Placă lemn gravat — 129 lei

**Scurt:**
> Lemn masiv gravat laser, cu logo-ul tău. Pentru localurile care nu vor să arate ca toate celelalte.

**Lung:**

> **Un obiect, nu un accesoriu.**
>
> Lemn masiv — fag, stejar sau nuc, la alegere — de 15 mm, gravat la laser cu logo-ul tău și cu codul QR. Finisat cu ulei natural, cu colțurile rotunjite, cu o tăietură în bază care îl ține drept fără picior de plastic.
>
> Fiecare placă are fibra ei. Nu sunt identice și nu încercăm să fie — de asta le cumpără lumea.
>
> **Ce facem diferit:** testăm scanarea pe fiecare esență în parte, seara, la lumină slabă. Pe lemnul închis, un QR gravat normal are contrast prea mic și nu scanează — de aceea pe nuc gravăm invers, fondul în loc de module. Nu vindem plăci frumoase care nu funcționează.
>
> **Se potrivește pentru:** bistrouri, crame, pensiuni, localuri cu bucătărie de autor, cabane, terase cu identitate puternică.
> **Recomandare:** 2–4 bucăți la puncte-cheie (recepție, bar, masa de la geam) plus PVC sau plexi pe restul meselor. Nu ai nevoie de lemn pe toate cele 30 de mese — ai nevoie de lemn acolo unde se uită lumea și unde se fac pozele.

---

### C.4. NFC + QR combo — 179 lei

**Scurt:**
> Atinge sau scanează. Cip NFC sub gravură, plus QR clasic pentru cine nu are NFC — merge cu toată lumea.

**Lung:**

> **Cel mai scurt drum dintre client și meniul tău: atingi telefonul de placă.**
>
> Sub placa gravată e un cip NFC (NTAG213/215), programat cu link-ul tău. Clientul apropie telefonul — se deschide meniul. Fără aplicație, fără cameră, fără să caute lumină. Pe telefoanele moderne durează sub o secundă.
>
> Pentru cine are telefon fără NFC sau cu NFC oprit, **QR-ul clasic e tipărit alături**, cu textul „Atinge sau scanează". Nimeni nu rămâne blocat.
>
> **Ce contează tehnic, ca să nu ai surprize:**
> - verificăm fiecare cip înainte de expediere, bucată cu bucată — nu prin sondaj;
> - dacă ai mese metalice, punem strat izolator între cip și suport (metalul strică NFC-ul; standurile ieftine ignoră asta și clientul crede că e defect);
> - nu blocăm cipul definitiv, ca să putem reprograma link-ul dacă se schimbă ceva.
>
> **Se potrivește pentru:** localuri de fine dining, hoteluri, showroom-uri, cabinete, standuri de târg, orice loc unde experiența trebuie să fie fără frecare.
> **Recomandare:** 1–4 bucăți, ca element de vârf. E produsul care se ține minte.

---

### C.5. Trei texte scurte care rezolvă cele mai frecvente obiecții

**„Și dacă îmi schimb meniul / prețurile?"**
> QR-ul e legat de o pagină, nu de un fișier. Schimbi ce vrei în pagină, standul de pe masă rămâne același. De asta recomandăm ca link-ul să fie unul stabil, pe care îl controlezi.

**„E scump 79 de lei pentru o bucată de plastic."**
> Comparativ: un meniu tipărit pe hârtie plastifiată costă 15–25 lei bucata și se reface la fiecare schimbare de preț. Standul se face o dată. La a doua modificare de meniu, e deja mai ieftin.

**„Am deja QR-uri printate acasă."**
> Merg, cât timp merg. Diferența e la scanare seara, la lumină slabă, și la ce comunică o hârtie lipită cu scotch față de o placă. Dacă îți merg bine, nu schimba nimic — ia o bucată de test și compară pe aceeași masă.

---

## PARTEA D — Insertul din colet și cardul de mulțumire

### D.1. Insert A6 (105 × 148 mm), 300 g mat, față/verso

**Baza vine din `docs/CODVIA.md` (textul deja aprobat) — mai jos e versiunea extinsă, gata de tipar.**

---

#### FAȚA

> ### Acest QR poate mai mult.
>
> Standul pe care tocmai l-ai scos din cutie poate deschide orice pagină.
> Dacă vrei ca acea pagină să fie un **meniu adevărat**, avem unul.
>
> **Menuvia** — meniu digital cu:
> - comenzi la masă direct de pe telefonul clientului
> - rezervări online, cu buton pe Google
> - meniul în 7 limbi (RO · EN · DE · FR · IT · HU · ES)
> - import din **poza meniului tău** — îl faci în câteva minute, nu în două zile
>
> **De la 99 lei/lună. Fără comision pe comenzi.**
>
> **menuvia.ro** · cod: `CODVIA`

---

#### VERSO

> ### Mulțumim că ai comandat de la Codvia.
>
> **Ai grijă de suport:** șterge-l cu o lavetă umedă. Fără alcool concentrat pe lemn.
>
> **QR-ul nu scanează?** Sună-ne. Îl înlocuim.
> Un cod care nu se citește nu e un capriciu — e un produs care nu-și face treaba.
>
> **Vrei încă o serie, alt model sau alt link?**
> Comanzi în 2 minute pe **codvia.ro** sau ne scrii direct.
>
> ---
>
> **Codvia** — suporturi QR fizice
> codvia.ro · pilot@menuvia.ro · [telefon]
>
> *Codvia face parte din familia Menuvia.*

**Specificații de tipar:** A6, 300 g carton mat, 4+4, fără lac lucios (se citește mai greu și se vede amprenta). Tiraj de start: **500 buc** (~150–200 lei). Nu tipări 2.000 — textul se va schimba după primii 20 de clienți.

---

### D.2. Card de mulțumire A7 (74 × 105 mm), 350 g

Ăsta e separat de insert și e **scris de mână** cât timp ai sub 20 de comenzi/lună. Cardul tipărit e ignorat; cel scris de mână se pune pe casa de marcat și se ține minte. Când volumul nu-ți mai permite, treci la varianta tipărită de mai jos.

**Varianta scrisă de mână (recomandată acum) — șablon:**

> [Nume],
>
> Mulțumesc pentru comandă. Am verificat personal fiecare bucată — toate scanează.
>
> Dacă ceva nu e în regulă, sună-mă direct: [telefon]. Răspund eu.
>
> Radu

Trei rânduri, pix negru, nimic special. Ideea nu e caligrafia, e faptul că **există un om în spate și îi știi numărul de telefon.** La un business cu zero clienți plătitori, ăsta e singurul avantaj competitiv pe care îl ai față de orice magazin mai mare.

**Varianta tipărită (față), pentru când volumul crește:**

> **Verificat bucată cu bucată.**
>
> Fiecare suport din acest colet a fost testat la scanare înainte să plece.
>
> Dacă ceva nu e în regulă — orice — scrie-ne la pilot@menuvia.ro sau sună la [telefon].
> Rezolvăm, nu discutăm.
>
> **Codvia** · codvia.ro

**Verso (opțional, doar la comenzile de peste 300 lei):**

> **Recomandă-ne și primești.**
> Trimite-ne un local care comandă de la noi și primești **20% reducere** la următoarea ta comandă. Ne spui numele la telefon, atât.

> ⚠️ Nu tipări nimic despre program de afiliere Menuvia pe cardurile Codvia încă. Programul există în produs (cerere → aprobare → comisioane live), dar are **0 afiliați activi** — nu construi comunicare pe o mașinărie pe care n-ai testat-o cu un om real.

---

## PARTEA E — Cele 5 canale de vânzare în afara restaurantelor Menuvia

Ordinea de mai jos e ordinea în care le-aș ataca: de la cel mai ușor de vândut la cel mai greu.

---

### E.1. QR de recenzii Google — cel mai ușor de vândut din toate

**De ce funcționează:** e singurul produs Codvia cu ROI evident, imediat și explicabil în 15 secunde. Nu vinzi un obiect, vinzi mai multe stele pe Google. Se aplică la **orice** business cu locație fizică — restaurante, saloane, service auto, cabinete, magazine, spălătorii, ateliere. Piața e de zece ori mai mare decât HoReCa.

**Mesajul:**
> „Câte recenzii ai pe Google? Și câți clienți mulțumiți pleacă fără să lase una?
>
> Diferența nu e că nu vor. E că nimeni nu deschide Google, caută localul și scrie o recenzie de pe telefon din proprie inițiativă. Dar dacă ai pe tejghea o plăcuță pe care scrie «Ne-a plăcut? 10 secunde» și clientul scanează, ajunge direct în fereastra de scris recenzia. Sare peste toți pașii.
>
> Îți fac una cu link-ul tău de recenzii, gata de pus. 29 de lei pentru PVC, 79 pentru plexiglas. Dacă în două luni n-ai mai multe recenzii, ai pierdut 29 de lei. Dacă ai, ai urcat în căutări."

**Cum îl operezi:** ai nevoie de **link-ul de recenzii Google al clientului** (Google Business Profile → „Cere recenzii" → link scurt de forma `g.page/r/...`). Îl obții tu, în 2 minute, din profilul lui public. Faptul că i-l scoți tu, pe loc, cu telefonul în mână, e jumătate din vânzare.

**Produsul-momeală:** ține 20 de standuri PVC în mașină. Vinzi pe loc, livrezi pe loc, încasezi pe loc. Fără curier, fără ramburs, marjă completă.

**Ce NU spui niciodată:** că le garantezi recenzii pozitive sau că poți filtra recenziile proaste. E împotriva regulilor Google și te scoate din joc. Vinzi **volum și viteză**, nu selecție.

---

### E.2. Saloane de înfrumusețare, frizerii, barbershop-uri

**De ce funcționează:** densitate mare pe km pătrat, decizie într-o singură persoană (patroana/patronul), buget mic dar rapid, și o obsesie reală pentru cum arată locul. Plus: se uită unii la alții — dacă intri într-un salon dintr-o zonă, îl vezi în celelalte trei într-o lună.

**Mesajul:**
> „La voi clientul stă 40 de minute pe scaun cu telefonul în mână. Ce vede pe măsuță?
>
> O plăcuță cu QR care deschide ce vrei tu: programările online (Booksy, site-ul vostru), Instagramul cu lucrări, sau pagina de recenzii. Trei plăcuțe — la recepție, la scaun, la oglindă.
>
> Cea de plexiglas cu muchii lustruite arată ca la voi în salon, nu ca la o benzinărie. 79 de lei bucata."

**Ce NU vinzi aici:** Menuvia. Un salon nu are nevoie de meniu digital cu comenzi la masă. Dacă încerci să legi produsele, pierzi credibilitatea la ambele. **Codvia stă singur pe acest canal** — și e în regulă, pentru că are marjă bună și volum.

**Produsul potrivit:** plexi (79) și lemn (129). Salonul nu cumpără PVC de 29 — nu se potrivește cu ce vrea să comunice. Aici **nu împinge produsul ieftin**.

**Unde îi găsești:** pe jos, într-o zonă de 15 minute de mers. Google Maps → „salon" → filtrezi pe cele cu poze bune (au buget) și sub 30 de recenzii (au nevoie de recenzii → dublă vânzare cu E.1).

---

### E.3. Pensiuni, cabane, apartamente în regim hotelier

**De ce funcționează:** **e singurul canal din cele cinci unde Codvia și Menuvia se vând împreună, natural.** O pensiune are și mic dejun (meniu), și camere (informații pentru oaspeți), și nevoie de rezervări. Valoarea comenzii e cea mai mare — o pensiune de 12 camere cumpără 12–15 bucăți dintr-un foc.

**Mesajul:**
> „Câte întrebări primești pe zi de la oaspeți? Parola de Wi-Fi, la ce oră e micul dejun, unde se poate mânca în zonă, cum ajung la [obiectivul local].
>
> O plăcuță de lemn gravat în fiecare cameră, cu QR-ul care deschide o pagină cu toate răspunsurile. Oaspetele nu mai sună la recepție la 11 noaptea.
>
> Și dacă vrei, pagina aia poate fi meniul micului dejun, în șapte limbi — că ai oaspeți germani și unguri, nu doar români. Plus rezervări online. Dar putem începe doar cu plăcuțele, fără nimic altceva."

**De ce merge finalul ăla:** oferi ieșirea. Pensiunea cumpără 12 plăcuțe de lemn (1.548 lei, marjă ~950 lei) fără să se angajeze la nimic software. Apoi, dacă i-a plăcut cum ai lucrat, discuția despre Menuvia starter la 99 lei/lună vine singură — și vine de la **un furnizor care a livrat deja**, nu de la un necunoscut care sună.

**Sezonalitatea contează:** pensiunile de munte se pregătesc în **septembrie–octombrie** pentru sezonul de iarnă. E exact fereastra în care ești. Cele de la mare sunt goale acum și n-au buget până în primăvară — **nu pierde timp cu litoralul în august**.

**Produsul potrivit:** lemn gravat (129) — se potrivește estetic cu 90% dintre pensiunile românești. Volum: 8–20 buc/comandă.

---

### E.4. Cabinete — medicale, stomatologice, veterinare, kinetoterapie

**De ce funcționează:** sala de așteptare e cel mai bun spațiu publicitar din România și e complet nefolosit. Bugete mai mari decât la saloane. Decizie rapidă (medicul e patronul). Și au o problemă reală: **recenziile Google contează enorm în alegerea unui medic**, iar majoritatea cabinetelor bune au 12 recenzii și cabinetele proaste au 80.

**Mesajul:**
> „Pacientul stă 20 de minute în sala de așteptare, cu telefonul în mână. Cinci minute după ce iese mulțumit, uită să scrie ceva.
>
> O plăcuță pe măsuța din sala de așteptare, cu QR: recenzia pe Google, formularul de programare online, sau instrucțiunile post-procedură (ca să nu mai sune la cabinet să întrebe ce au voie să mănânce).
>
> Plexiglas, curat, se dezinfectează cu orice. 79 de lei. Sau lemn, dacă vreți ceva mai cald — 129."

**Atenție reală, nu de formă:** un cabinet nu pune pe masă un obiect care arată ieftin. **PVC-ul de 29 lei nu se vinde aici.** Și nu folosi cuvântul „marketing" în discuție — folosește „pacienții găsesc mai ușor informația".

**Unghi suplimentar:** cabinetele veterinare sunt cele mai deschise dintre toate (proprietarii de animale lasă recenzii ușor) și au cel mai mic filtru de decizie.

---

### E.5. Evenimente și nunți — organizatori, fotografi, saloane de evenimente

**De ce funcționează:** valoarea per comandă e cea mai mare din toate cinci (10–30 buc), iar clientul nu se uită la preț — la o nuntă de 40.000 lei, 20 de plăcuțe de 79 lei nu se discută. Plus: **e canal B2B2C** — un organizator de evenimente sau un fotograf care lucrează cu tine îți aduce 15 nunți pe an, nu una.

**Mesajul (către organizator / fotograf / salon, NU către miri):**
> „Ce faci cu pozele de la invitați? Toată lumea filmează, nimeni nu ți le trimite, și mirii rămân cu 200 de poze din 3.000.
>
> Câte o plăcuță pe fiecare masă, cu QR: invitații scanează și încarcă direct în albumul comun. Sau scanează și văd meniul serii, planul de așezare, playlistul unde pot cere melodii.
>
> Plăcuțele se gravează cu numele mirilor și data. După nuntă, mirii le păstrează — sunt obiecte, nu decor de unică folosință.
>
> Pentru tine: le pui în pachetul tău, cu prețul tău. Eu îți dau prețul de volum și le livrez direct la eveniment."

**Cum îl operezi:** nu vinzi la miri (ciclu lung, decizie emoțională, 1 comandă și gata). Vinzi la **cei 5–10 organizatori și fotografi dintr-un oraș**, care fac 20–40 de evenimente pe an fiecare. Le dai preț de volum (treapta de 100 buc) și îi lași să adauge marja lor.

**Produsul potrivit:** lemn gravat cu nume și dată (129 lei listă, preț partener ~90). Sau NFC combo pentru evenimente corporate (179), unde bugetul e și mai relaxat.

**Sezonalitate:** sezonul de nunți în România e **mai–octombrie**. În august prinzi finalul sezonului curent — deci discuția cu organizatorii e pentru **2027**, nu pentru acum. Nu e canal de venit imediat, e canal de semințe. Fă 5 conversații în septembrie și lasă-le să crească.

---

### E.6. Tabelul de decizie

| Canal | Produs principal | Comandă tipică | Marjă brută estimată | Ciclu de vânzare | Se leagă cu Menuvia? |
|---|---|---|---|---|---|
| Recenzii Google | PVC / plexi | 1–3 buc | 20–120 lei | **minute** | Nu (și e ok) |
| Saloane | Plexi | 3 buc | ~150 lei | 1–2 vizite | Nu |
| Pensiuni | Lemn | 8–20 buc | 600–1.600 lei | 1–3 săpt. | **Da, puternic** |
| Cabinete | Plexi / lemn | 2–4 buc | 100–330 lei | 1–2 vizite | Nu |
| Evenimente | Lemn / NFC | 10–30 buc, prin partener | 900–2.500 lei | luni (sezon 2027) | Nu |

---

## PARTEA F — Primele 10 acțiuni de lansare, în ordine

> Contextul temporal: e **7 august**. Fereastra HoReCa reală e **septembrie–octombrie**. Ai ~6 săptămâni ca să ajungi la 1 septembrie cu mostre în mână, prețuri validate și un proces care funcționează. Nu încerca să vinzi în august la restaurante — jumătate sunt în concediu, cealaltă jumătate e sufocată de sezon.

---

### 1. Verifică marca și cumpără domeniul — ziua 1, 1 oră
Caută **„Codvia"** pe **OSIM** și **EUIPO** înainte de orice tipăritură. Costul unei erori aici e tot ce tipărești de acum încolo.
Apoi cumpără **codvia.ro** de la un registrar românesc (~50 lei/an — **NU** prin Vercel, unde e la ~$111). Opțional codvia.shop ca redirect.
**Rezultat:** ai voie să pui numele pe un obiect fizic.

### 2. Leagă domeniul de site — ziua 1, 30 minute
În Netlify → Domain management → adaugă `codvia.ro` ca **domain alias** pe site-ul menuvia. Același bundle servește ambele domenii; `/codvia` e punctul de intrare. Redirect-ul `/` → `/codvia` pe hostname `codvia.ro` se adaugă ulterior (pattern-ul din `lib/whiteLabel.ts` sau `netlify.toml`).
Verifică apoi că **`codvia.ro` e deja în `ALLOWED_ORIGINS`** din `codvia-order.js` (este) și că formularul chiar trimite de pe noul domeniu — un CORS greșit înseamnă comenzi pierdute tăcut.
**Rezultat:** cineva care aude „codvia.ro" ajunge undeva.

### 3. Cere oferte de la 3+3 furnizori — zilele 2–3, 3 ore
Trei tipografii cu print UV / laser pentru **PVC + plexi**, trei gravatori pentru **lemn + NFC**. Caută-i în orașul tău („print UV", „debitare laser plexiglas", „gravură laser lemn").
Trimite-le **exact briefurile din Partea A** (vezi și Anexa 1 — mesajul gata de copiat). Cere **grila 10/25/50/100/250/500**, setup separat de bucată, termen la 10 și la 100 buc.
**Rezultat:** știi prețurile reale și înlocuiești ipotezele din Partea B.

### 4. Comandă mostre din toate cele 4 produse — zilele 3–5, cost 300–600 lei
De la cei 2 furnizori care au răspuns cel mai bine. Insistă pe:
- plexi **cu și fără strat alb** sub QR (comparația care îți dă argumentul de vânzare);
- lemn în **toate esențele** pe care vrei să le oferi;
- NFC programat cu un link de test.
Când sosesc, rulează **integral testul de acceptanță din A.0** (cele 7 puncte) și notează rezultatele într-un tabel. **Elimină din catalog orice variantă care pică testul de scanare seara.**
**Rezultat:** ai produse pe care le poți garanta, nu pe care le speri.

### 5. Recalculează prețurile cu cifre reale — ziua 6, 1 oră
Înlocuiește coloana „Cost estimat" din B.1. Verifică dacă marjele țin.
Dacă un preț de listă nu mai are sens, **schimbă-l în ambele locuri**: `PRODUCTS` din `codvia-order.js` (sursa de adevăr, server) **și** `PRODUCTS` din `CodviaPage.tsx` (oglinda de afișare). Sunt două locuri, iar dezalinierea lor înseamnă că îi arăți clientului un preț și îți trimiți pe email altul.
Confirmă și **pragul 1**: pune pe pagină „Livrare gratuită de la 149 lei, sub — 25 lei transport".
**Rezultat:** prețurile sunt profitabile, nu doar plauzibile.

### 6. Fotografiază mostrele — ziua 7, 3 ore, cost 0
Cea mai mare pârghie de conversie din tot pachetul, și e gratuită. Pentru fiecare produs:
- o poză **pe o masă reală de restaurant** (nu pe fundal alb);
- o poză **în mână**, pentru scară;
- o poză **seara, la lumină caldă**, cu telefonul care scanează — asta demonstrează afirmația din copy;
- un video vertical de 8 secunde: mâna scanează, meniul se deschide pe telefon.
Telefonul e suficient. Lumina naturală de la fereastră, ora 10 dimineața.
**Rezultat:** înlocuiești ilustrațiile cu dovezi. Un magazin fără poze de produs real nu vinde.

### 7. Rezolvă partea juridică — zilele 7–14, în paralel
Nu poți încasa bani legal fără entitate. Draft-ul de Termeni de vânzare (`menuvia-pack/06-DRAFT-CODVIA-COMENZI.md`) e blocat exact pe asta și e marcat explicit ca neavizat. Ce trebuie:
- entitatea constituită, CUI, sediu, IBAN, telefon — completate în toate locurile marcate `[…]`;
- decis regimul TVA (plătitor / neplătitor art. 310);
- decis costul livrării și adresa de retur;
- avizarea documentului de un avocat pe protecția consumatorului (**secțiunea 7.2 — excepția de retragere pentru produse personalizate — e cea mai importantă și trebuie formulată corect**);
- link-urile ANPC/SAL în footer-ul paginii `/codvia`.
Rulează în paralel cu 3–6; nu bloca mostrele pe avocat, dar **nu încasa primul leu înainte de finalizare**.
**Rezultat:** poți vinde fără să te uiți peste umăr.

### 8. Tipărește ambalajul și inserturile — zilele 12–15, cost ~500 lei
500 × insert A6 (textele din D.1), 500 × card A7 (D.2), 50 de cutii, folie, stickere Codvia.
**Nu tipări mai mult.** Textul se schimbă după primii 20 de clienți — garantat.
Scrie de mână cardurile pe măsură ce livrezi, cât timp ești sub 20 de comenzi/lună.
**Rezultat:** primul colet poate pleca.

### 9. Prima vânzare reală: 20 de uși, produsul „recenzii Google" — zilele 15–20
Ăsta e testul care contează. Ia **20 de standuri PVC** cumpărate în avans (~200 lei), pune-le în mașină, și intră în 20 de locuri pe jos, într-o zonă compactă: saloane, cabinete, cafenele, service-uri.
Pitch-ul e cel din E.1, durează 30 de secunde, iar demonstrația e obiectul din mână.
**Ce măsori, nu ce simți:** din 20 de intrări — câte conversații, câte comenzi, care produs, care obiecție a apărut de cel puțin 3 ori.
Obiecția repetată de 3 ori nu e o obiecție, e o problemă de produs sau de preț. Corecteaz-o înainte să scalezi.
**Rezultat:** știi dacă Codvia se vinde sau doar sună bine în document. Ăsta e singurul lucru pe care documentul ăsta nu ți-l poate spune.

### 10. Conectează-l la Menuvia și pornește motorul — zilele 20–30
Abia acum, cu produse dovedite și cu un proces care merge:
- verifică fluxul complet **dashboard → „Suporturi QR fizice" → `/codvia?slug=` → comandă cu slug pre-completat** (există în cod, dar testează-l tu ca și cum ai fi client);
- adaugă pe `/codvia` pozele reale de la pasul 6 și cele două praguri de livrare;
- **du primele 10 colete personal**, dacă sunt în oraș. Fiecare livrare e o conversație de 10 minute cu un patron care tocmai a plătit — cea mai bună calificare de lead pe care o poți avea gratis;
- de la 1 septembrie, când se întorc restaurantele din concediu, atacă pensiunile (E.3) — sunt canalul care leagă cele două produse și are cea mai mare valoare pe comandă.

**Ce NU faci în primele 30 de zile:** plată online, tabelă `codvia_orders`, generare automată de PDF cu QR, branding separat pe hostname, program de afiliere Codvia. Toate sunt în `docs/CODVIA.md` ca v2 și **acolo rămân până când ai semnal de cerere.** Un magazin cu Stripe integrat și zero comenzi e cod mort scump.

---

## Anexa 1 — Mesajul de trimis furnizorilor (copiază și trimite)

> Bună ziua,
>
> Vreau să produc suporturi de masă cu cod QR pentru localuri, saloane și cabinete. Lansez acum, deci volumele de început sunt mici (10–50 buc/lună), dar caut un furnizor pe termen lung, nu o comandă unică.
>
> **Ce am nevoie:**
>
> **1. Stand PVC** — PVC expandat alb 3 mm, format „L", frontal 100 × 150 mm + bază 100 × 60 mm, print UV direct 4+0 mat, tăiere pe contur, muchii curățate.
>
> **2. Stand plexiglas** — PMMA turnat transparent 4 mm, tăiere laser, îndoire la cald dintr-o bucată (frontal 100 × 150 + bază 100 × 70), muchii lustruite la flacără, **print UV pe verso cu strat alb opac 100%** (esențial — codul QR trebuie să aibă contrast pe masă închisă).
>
> **3. Placă lemn gravat** — lemn masiv fag/stejar/nuc 15 mm, 90 × 140 mm, colțuri R5, gravură laser 0,5–1 mm, tăietură de sprijin la 15°, finisaj ulei natural.
>
> **4. NFC + QR** — ca produsul 3, cu locaș frezat pe verso pentru cip NTAG213/215 (antenă 25–30 mm), acoperit.
>
> **Ce vă rog să-mi trimiteți:**
> - preț pe bucată la **10 / 25 / 50 / 100 / 250 / 500 buc**, cu **setup-ul separat de preț**;
> - preț de **re-comandă din același fișier** (fără setup nou);
> - termen de execuție la 10 buc și la 100 buc;
> - dacă puteți factura **pe m² de material** la produsele tăiate laser (grupez comenzi de la mai mulți clienți pe aceeași placă);
> - preț pentru **1–2 mostre** din fiecare produs.
>
> Trimit fișierele **gata de producție** (PDF vectorial, CMYK, bleed 3 mm, contur pe strat separat, fonturi în curbe) — deci fără cost de prepress din partea dvs.
>
> Mulțumesc,
> [nume] · [telefon] · codvia.ro

---

## Anexa 2 — Fișă de recepție mostră (bifează la fiecare mostră primită)

| Test | PVC | Plexi | Lemn | NFC |
|---|---|---|---|---|
| Scanează la 40 cm, telefon nou | ☐ | ☐ | ☐ | ☐ |
| Scanează la 40 cm, telefon vechi (4+ ani) | ☐ | ☐ | ☐ | ☐ |
| Scanează **seara, lumină caldă slabă** | ☐ | ☐ | ☐ | ☐ |
| Scanează în unghi 45° | ☐ | ☐ | ☐ | ☐ |
| Scanează **pe masă de lemn închis** | ☐ | ☐ | ☐ | ☐ |
| Rezistă la lavetă cu ulei + șervețel umed | ☐ | ☐ | ☐ | ☐ |
| Rezistă la 10 zgârieturi cu unghia/cheia | ☐ | ☐ | ☐ | ☐ |
| Stă drept la împingere laterală ușoară | ☐ | ☐ | ☐ | ☐ |
| Nu se curbează la 2h × 50 °C | ☐ | ☐ | ☐ | ☐ |
| Muchii curate, fără bavuri | ☐ | ☐ | ☐ | ☐ |
| NFC citit cu iPhone | — | — | — | ☐ |
| NFC citit cu Android | — | — | — | ☐ |
| NFC citit pe suprafață metalică | — | — | — | ☐ |

**Regula de decizie:** o mostră care pică **testul de scanare seara** sau **testul pe masă închisă** nu intră în catalog, indiferent cât de bine arată. Un suport QR care nu scanează nu e un produs cu un defect — e un produs care nu există.

---

*Document intern Codvia · v1.0 · 7 august 2026. Costurile de producție sunt ipoteze de lucru și se înlocuiesc cu ofertele reale după pasul 3. Nu conține referințe, testimoniale sau cifre de clienți — nu avem încă.*
