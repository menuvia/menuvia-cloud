# Analiză de concurență — iulie 2026

> Research cu 3 agenți în paralel (concurenți direcți RO, POS-uri/fiscal RO,
> benchmark internațional), pe surse web live. Limitare de metodă: o parte
> din site-uri au blocat fetch-ul direct — faptele marcate ⚠️ provin doar din
> snippet-uri indexate/presă și cer reverificare manuală. Menuvia de
> referință: 99/249/499 lei/lună, fără comision, self-serve.

## 1. Harta pieței (unde stăm)

### Concurenți direcți RO (meniu QR → comenzi)

| Cine | Preț | Ce au | Fiscal RO | Amenințare |
|---|---|---|---|---|
| **MeniuDigital.ro** (Cluj, 1.000+ localuri) | gratuit ≤30 produse; **~83 lei/lună** (anual) | comandă la masă, chemare ospătar, rezervări, traduceri, AI nutriție, ANPC-compliance | ✗ | 🔴 lider volum + SEO, sub Starter-ul nostru |
| **MENIVO** | free tier generos; plătit ⚠️ | AI nutriție/alergeni/traduceri DIN FREE, rezervări, comenzi 0% comision, landing/restaurant | ✗ | 🟡 comoditizează AI-ul de entry-level |
| **TapTasty** (Oradea, global) | nepublicat ⚠️ | app nativă branded, kiosk, QR ordering, loyalty, AI waiter, **integrare FiscalNet ca noi**, **reseller 50% comision** | ✓ (prin POS) | 🔴 rivalul direct nr. 1 pe fiscal + canal parteneri |
| **Horeka by Roweb** (2004, 100+ localuri, lanțuri) | nepublicat ⚠️ | comandă la masă, integrare cu 7 POS-uri, agregare Bolt, app fidelizare, review-uri | prin POS-ul integrat | 🟡 mid-market cu referințe |
| **Menoo** | free afișare; premium ⚠️ | AI extrage meniul din PDF (alergeni+nutriție), rezervări, room service | ✗ | 🟢 |
| coada lungă (meniudigitalqr, egrup, Poloniq, GreatFood, q-web…) | ascunse/mici | meniu static ± comandă prin **WhatsApp** (fără KDS/stări) | ✗ | 🟢 |

### POS-urile care coboară spre QR (atac din direcția opusă)

- **Ebriza** (POS cloud): conduce casele Datecs/Partner nativ, dar cere
  migrarea întregului POS. Prețuri nepublicate.
- **Freya/Sedona**: fiscalizare nativă, dar kit de mii de lei (FP-700 +
  Ingenico incluse la Self-Order), dealeri, instalare la fața locului.
- **GloriaFood** (Oradea, Oracle): gratuit nelimitat, cel mai self-serve din
  lume — dar **zero fiscalizare RO** (bon = re-marcare manuală).
- **SmartBill POS**: bridge pur la casele existente (Datecs/Activa/Tremol…)
  dar FĂRĂ meniu QR/self-ordering — validează tehnica, nu concurează produsul.

### Benchmark internațional (funcțiile „wow")

| Funcție | Cine | La noi |
|---|---|---|
| Pay-at-table fără app + **split pe item/loc/sumă** | sunday, Qerko | ✗ (plata online e „în dezvoltare") |
| **Tips digitale** de la client (+40% vs terminal) | sunday, Qerko, me&u | parțial (doar flow ospătar are tips_amount) |
| **Review funnel Google post-plată** (5× recenzii) + răspuns AI | sunday | ✗ |
| **AI upsell la checkout** (regenerat zilnic pe trend) | me&u, Bopple | ✗ (avem AI chatbot + istoric — fundația există) |
| Traducere automată meniu (99 limbi) | Choice QR | ✗ (i18n static ro/en) |
| **Loyalty legat de plată** (puncte automate) | Qerko, me&u, Orda | ✗ (doar ModuleKey placeholder) |
| Agregator delivery (Glovo/Wolt/Bolt) dintr-un panou | Choice QR | ✗ |
| Tab deschis + batching comenzi pe masă | me&u | parțial (sesiuni de masă există) |
| Feedback privat post-plată (interceptezi înainte de Google) | Qerko, sunday | parțial (submit_order_feedback există!) |
| Carduri de masă (Edenred) în flow-ul QR | doar Qerko (CZ) | ✗ — echivalent RO: Edenred/Pluxee/Up |

Pricing-ul pieței s-a bifurcat: abonament pur (Choice QR ~15 USD, Menu Tiger
17–46 USD) vs. tranzacțional pur (Qerko 1,35%, Bopple 0,8–1,8%, sunday).

## 2. Verdictul: unde suntem PESTE ei deja

1. **Fluxul comandă→bon fiscal în aceeași platformă, pe casa EXISTENTĂ a
   localului** — unic față de tot segmentul QR-first (toți ori ignoră bonul,
   ori îl delegă unui POS terț); față de POS-uri câștigăm pe cost total
   (zero hardware, zero migrare). Singurul cu același bridge: TapTasty.
2. **Preț public + self-serve** — în TOT segmentul cu fiscalizare, nimeni nu
   are prețuri pe site. 99/249/499 afișat = avantaj de conversie direct.
3. **Pipeline real de comenzi** (sesiuni de masă, KDS, stări, ospătari
   offline) vs. „comanda pe WhatsApp" a jucătorilor ieftini.
4. **Infrastructura de afiliere cu comisioane live + payouts** — doar
   TapTasty are program public (reseller 50%); restul, nimic.
5. **AI end-to-end** (chatbot cu acțiuni confirmabile, import meniu din
   poze, nutriție, activ implicit fără chei) — MENIVO/Menoo au bucăți, dar
   nu asistent operațional în dashboard.
6. Hartă sală live + rezervări + comenzi în același produs — combinație pe
   care n-o are nimeni din listă (nici internațional).

## 3. Backlog „peste ei" — prioritizat pe ROI/efort

### Val A — quick wins (S), săptămâna asta
1. **Review funnel Google post-comandă** — la închiderea sesiunii de masă,
   ecran „Cum a fost?" → nota ≥4 → deep-link recenzie Google (avem
   `google_review_url` + `submit_order_feedback` cu sesiune!); nota <4 →
   feedback privat către owner (pattern-ul Qerko de interceptare). Cel mai
   mare ROI/efort din întreaga analiză.
2. **Pagina de comparație pe site** („Menuvia vs. MeniuDigital vs. GloriaFood
   vs. POS-uri") cu mesajul unic: *„Păstrezi casa de marcat pe care o ai."*
   + lista caselor compatibile FiscalNet. Nimeni nu spune propoziția asta.
3. **Tips digitale în flow-ul QR client** — serverul are deja `tips_amount`
   + `tip_payout`; lipsește doar UI-ul (pregătește terenul pentru plăți).

### Val B — medium (M), luna asta
4. **AI upsell la checkout** în `QrCartSheet` — co-occurrence din istoricul
   comenzilor + happy hour + stoc (infrastructura AI există).
5. **Traducere automată a meniului** — coloane jsonb de traduceri + pipeline
   AI (batching peste importul existent); contracarează MeniuDigital/MENIVO
   și e critică pe litoral/centre turistice.
6. **Rezervare cu alegerea mesei pe hartă + pre-comandă** („ca la cinema") —
   recombinare de active existente unic în piață, nimeni nu o are.
7. **Loyalty simplu** (puncte per comandă, flag-ul `loyalty` există) — taie
   argumentul TapTasty/Qerko la retenție.

### Val C — strategic (L), cu decizie de business
8. **Plata online la masă** (Stripe/Netopia) cu **split pe item + bon fiscal
   per plătitor + tichete de masă (Edenred/Pluxee/Up)** — tripleta pe care
   NIMENI nu o are (Qerko a validat voucherele în CZ); gate Plan 3, regula
   de aur. La lansare: componentă tranzacțională mică (<1,35% al Qerko).
9. **Dynamic pricing pe stoc + ore moarte** — „meniul care se optimizează
   singur"; nimeni din benchmark nu face preț dinamic (me&u face doar
   poziționare). Avem happy hour + stocuri + AI = fundația completă.
10. **Agregator delivery RO** (Tazz/Glovo/Bolt Food) — doar când există
    cerere reală; Choice QR e dovada că se poate ca SaaS mic.

## 4. Poziționare (de aplicat pe landing/pricing)

- Mesaj central nou: **„Păstrezi casa de marcat și POS-ul pe care le ai."**
- Publică pilotul FiscalNet ca probă vizuală (video: comanda din telefon →
  bonul iese din casa localului) — argumentul pe care concurența nu-l poate
  mima fără hardware nou.
- Ladder explicit anti-MeniuDigital: intrare ieftină la meniu (competitiv cu
  83 lei/lună) → upgrade in-product la comenzi → fiscalizare Plan 3.
- Tratează TapTasty ca rival direct: câștigăm pe self-serve + preț public +
  coada lungă; ei vând consultativ spre clienți mari.

## 5. Surse

RO direct: [MeniuDigital.ro](https://www.meniudigital.ro/) ·
[MENIVO](https://menivo.io/) · [TapTasty — integrations FiscalNet](https://www.taptasty.com/integrations/) ·
[TapTasty resellers](https://www.taptasty.com/resellers/) ·
[Horeka Quick](https://horeka.ro/horeka-quick-meniu-digital-inteligent-comanda-de-la-masa/) ·
[Horeka integrări POS](https://horeka.ro/integrari-pos/) · [Menoo](https://parteneri.menoo.ro/en/digital-menu) ·
[Poloniq](https://www.poloniq.ro/meniu-digital/) · [Great Food](https://www.greatfood.ro/meniu-digital-inteligent-comanda-de-la-masa/)
POS/fiscal: [Ebriza prețuri](https://web.ebriza.com/ro/preturi) ·
[Datecs despre Ebriza](https://www.datecs.ro/ebriza.html) ·
[Freya soluții](https://freyapos.ro/solutii/) · [Freya Self-Order (Sedona)](https://www.aparaturafiscala.ro/software-pentru-horeca-saloane-infrumusetare-cabinete-medicale/15580-freya-self-order-abonament-lunar.html) ·
[GloriaFood pricing](https://www.gloriafood.com/pricing) · [SmartBill POS — case compatibile](https://ajutorpos.smartbill.ro/article/649-ce-este-smartbill-pos) ·
[FiscalNet doc](https://driverfiscal.ro/wp-content/uploads/2024/04/Documentatie-FiscalNet.pdf)
Internațional: [me&u](https://www.meandu.com/us) · [me&u smart suggestions](https://help.meandu.com/hc/en-us/articles/6539938631183-What-is-the-smart-suggestions-feature) ·
[sunday](https://sundayapp.com/) · [sunday split checks](https://sundayapp.com/sunday-split-checks-any-way-they-want/) ·
[sunday reputation](https://sundayapp.com/online-reputation/) · [sunday Series B (Forbes)](https://www.forbes.com/sites/sindhyavalloppillil/2025/11/13/sundays-21m-series-b-and-the-global-race-to-transform-restaurant-payments/) ·
[Choice QR pricing](https://choiceqr.com/us/pricing-choice-qr) · [Choice QR × Glovo](https://choiceqr.com/integration-with-glovo/) ·
[Qerko](https://www.qerko.com/eng/home) · [Qerko pricing](https://www.qerko.com/eng/pricing) ·
[Bopple pricing](https://www.bopple.com/pricing) · [Orda](https://www.getorda.com/) ·
[Curate instant apps](https://www.restaurantbusinessonline.com/technology/restaurant-app-you-dont-have-download-investors-say-sign-me)

---

## Actualizare — august 2026 (corectează secțiunile de mai sus)

> Documentul de mai sus e din iulie și a rămas în urmă față de cod. Auditul
> din august a cerut explicit re-alinierea — fără ea, prioritizările viitoare
> ar realoca efort pe lucruri DEJA livrate.

**Livrate între timp (iulie–august), marcate mai sus ca lipsă:**
- **Split pe itemi + tichete de masă** (mig 229–231) — „tripleta" pe care
  n-o are nimeni din tabel.
- **Tips-intent la cererea notei** (mig 223) + plata online la masă completă.
- **Loyalty v1** (mig 226) — taie argumentul TapTasty/Qerko.
- **Traduceri în 7 limbi** cu AI + chrome pe limba aleasă (mig 197+).
- **Rezervări complete**: hartă „ca la cinema", auto-confirmare race-safe,
  no-show automat, remindere email/SMS, **notificare owner la rezervare
  nouă** (mig 254/255) și pagina publică `/rezervare/:slug` pentru butonul
  Google Business — direct competitiv cu rezervările MeniuDigital.
- **Import AI multi-poză cu categorii** — 4 pagini de meniu într-un apel.
- **Produse noi**: „Menuvia Rezervări" (wedge 0% comision, Start gratuit
  nelimitat / Automate 99 lei) și **Codvia** (suporturi QR fizice, /codvia) —
  niciun concurent din tabel nu vinde standul cu QR-ul meniului pre-tipărit.

**Rămase reale (nu le nega în pitch):** fără delivery/agregatoare
(Glovo/Tazz/Bolt — Horeka și Choice QR au), fără app nativă branded și kiosk
(TapTasty), pilotul fiscal încă nepornit (badge-ul „Pilot" pe planul de 499
e o promisiune până la primul bon tipărit pe casă reală).

**Unghiul de vânzare actualizat**: MeniuDigital vinde meniu cu rezervări la
~83 lei; noi vindem la 99 lei meniul + rezervările CU buton pe Google, SMS-uri
incluse și drum spre comenzi/fiscalizare — iar la 0 lei dăm rezervări
nelimitate fără comision, ceea ce nici TheFork, nici MeniuDigital nu oferă.
