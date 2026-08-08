# KIT DE AFILIAT MENUVIA

**Versiune: 7 august 2026 · Pentru uz intern (secțiunile 0, B, E) + trimis afiliaților (secțiunile A, C, D)**

Cinci piese, în ordinea în care le folosești:

| # | Piesa | Cui i-o dai | Când |
|---|---|---|---|
| **0** | Ce trebuie rezolvat înainte | doar ție | azi, înainte de primul telefon |
| **A** | Pagina de recrutare | candidatului (link `/afiliat` sau PDF) | la primul contact |
| **B** | Mesajul tău de abordare | doar ție (email + telefon) | la prospectare |
| **C** | Materialul afiliatului cu clienții lui | afiliatului aprobat | după aprobare |
| **D** | Regulile programului | afiliatului, în scris, înainte de aprobare | la aprobare |
| **E** | Primii 3 afiliați: profil + unde îi găsești | doar ție | săptămâna asta |

---

## 0. Ce trebuie rezolvat înainte să trimiți orice

Trei lucruri. Primul e blocant pe bani, celelalte două sunt de igienă.

### 0.1 🔴 BLOCANT — comisionul curge azi DOAR pe planul de 499 lei

În cod (`migration_099`, „regula de aur"), funcția care înregistrează comisionul are gate-ul:

```
if p_plan not in ('pro', 'enterprise') → skip 'not_plan3'
```

Adică: un restaurant care se abonează prin linkul unui afiliat pe **starter (99 lei)** sau **growth (249 lei)** generează **zero lei comision**. Atribuirea rămâne înregistrată (`pending`) și afiliatul primește acces de partener, dar ledgerul rămâne gol. Dacă restaurantul urcă mai târziu pe planul de 499, prima factură pe acel plan devine „factura de activare" și comisionul pornește retroactiv de acolo.

Ai două variante, alege una **înainte** de primul telefon:

- **Varianta 1 (recomandată).** Lărgești gate-ul la `starter`/`growth` printr-un fișier nou de migrație și abia apoi recrutezi. Planul de 499 e în pilot și nedemonstrat — un program de afiliere care plătește exclusiv pe el înseamnă, practic, un program care nu plătește nimic în septembrie. Motorul de vânzare realist al toamnei e planul de 99 și cel de 249.
- **Varianta 2.** Recrutezi acum și spui verbatim: *„comisionul automat curge azi pe planul de Fiscalizare; pentru Meniu Digital și Meniu + Comenzi îl plătesc manual, pe aceleași procente, până urc regula în sistem."* Onest, dar îți creează muncă manuală și o promisiune fără suport în cod — nu o face pentru mai mult de 2–3 afiliați.

**Până alegi: în toate materialele de mai jos, tabelele de comision au marcate cu `*` rândurile care depind de această decizie. Șterge-le sau lasă-le, conștient.**

### 0.2 Contractul

Programul plătește exclusiv pe factură de la PFA/SRL. Contractul-cadru e încă brief pentru avocat (`docs/AFFILIATE_PROGRAM.md` §6) — nesemnat, nevalidat. Nu e blocant pentru recrutare (prima plată vine oricum la 60+ zile după primul abonament), dar **e blocant pentru prima plată**. Trimite brieful avocatului în aceeași săptămână în care suni primul candidat.

Ce spui candidatului între timp: *„contractul îl semnăm înainte de primul comision plătibil; până atunci ai în scris procentele, holdul și regulile — nu-ți cer nimic în avans și nu-ți cer exclusivitate."*

### 0.3 Domeniul și emailul

Linkul de afiliere e `menuvia.ro/r/COD`. Dacă domeniul nu e încă propagat, linkurile din materiale trebuie să folosească domeniul curent (`menuvia.netlify.app`) — dar un afiliat serios se uită la domeniu. Cumpără `menuvia.ro` și verifică Resend (DKIM/SPF) înainte de campania de recrutare, altfel emailurile tale de abordare intră în spam exact la publicul care nu-ți dă a doua șansă.

### 0.4 Adevărul pe care îl spui fiecărui candidat, din prima

Nu îl ascunzi și nu îl scuzi. Îl folosești:

- **Zero clienți plătitori.** Produsul e live, în producție, dar programul comercial pornește acum. Cine intră acum intră ca partener de lansare, nu ca distribuitor într-o rețea validată.
- **Fiscalizarea (planul de 499) e pilot.** Puntea către casele de marcat există în cod, dar nu a tipărit încă un bon pe hardware real la un client. Nu se vinde ca funcțională.
- **Nu avem delivery, app nativă branded sau kiosk.** Dacă restaurantul vrea Glovo/Tazz într-un panou, nu suntem noi.

Un afiliat care fuge de aceste trei propoziții ți-ar fi făcut oricum probleme mai târziu, cu promisiuni pe care nu le acoperi.

---

# A. Pagina de recrutare — „Devino partener Menuvia"

> Text gata de folosit pe `/afiliat`, ca PDF de 2 pagini sau ca mesaj lung. Rândurile marcate `*` depind de decizia din 0.1.

## Ce e Menuvia

Un sistem românesc pentru restaurante: meniu digital pe QR, comenzi de la masă, rezervări online cu buton pe Google, ecran de bucătărie, fidelizare, rapoarte. Rulează în producție, se configurează în minute, fără hardware nou și fără comision pe comenzi sau pe cuverturi.

Prețuri publice, plătite lunar sau anual (~17% reducere la anual):

| Plan | Preț | Ce include, pe scurt |
|---|---|---|
| **Meniu Digital + Rezervări** | 99 lei/lună | meniu QR în 7 limbi, import meniu din poze cu AI, rezervări online + linkul pentru butonul de rezervare din Google, 100 SMS/lună |
| **Meniu + Comenzi** | 249 lei/lună | tot ce e mai sus + comenzi prin QR, ecran bucătărie, flux ospătar, pickup, Happy Hour, fidelizare, stocuri, rapoarte, 300 SMS |
| **Fiscalizare** *(pilot)* | 499 lei/lună | tot ce e mai sus + plăți în aplicație, plată online la masă, bon fiscal pe casa de marcat existentă, TVA, facturi Oblio |

Toate planurile au 30 de zile gratuite și migrare gratuită a meniului de la alt sistem.

## De ce ai deveni partener

Dacă lucrezi deja cu restaurante — le ții contabilitatea, le faci site-ul, le întreții casa de marcat, le vinzi marfă — ai ceva ce nu se cumpără cu bani de reclamă: **încrederea patronului și un motiv legitim să-l suni**. Programul de parteneriat transformă asta în venit recurent, fără să-ți schimbi meseria.

- **Nu vinzi hardware.** Nu ai stoc, nu ai livrare, nu ai instalare la fața locului. Trimiți un link.
- **Nu ai target și nu ai costuri.** Nu există taxă de intrare, kit plătit sau volum minim.
- **Nu ai exclusivitate impusă.** Poți recomanda în paralel orice altceva.
- **Vezi totul, live.** Ai panou propriu cu fiecare restaurant adus, fiecare comision generat, statusul plăților.
- **Ai acces de partener** pe dashboardul restaurantelor aduse prin tine — îi poți configura meniul și setările, dacă vrei să oferi și serviciul (patronul vede accesul și îl poate opri oricând).

## Cât câștigi

Trei componente. Toate se calculează pe **abonamentul real plătit**, niciodată pe simpla recrutare.

| Componentă | Cât | Detalii |
|---|---|---|
| **Activare** | **30%** din prima factură a restaurantului | o singură dată, per restaurant |
| **Recurent** | **10%** din fiecare factură lunară | timp de **12 luni** de la primul abonament |
| **Sub-parteneri** | **2%** din comisioanele partenerilor pe care îi aduci tu | un singur nivel |

Concret, per restaurant adus, la abonament lunar:

| Planul ales de restaurant | Activare (30%) | Recurent (10%/lună) | **Total, primul an** |
|---|---|---|---|
| Meniu Digital + Rezervări — 99 lei * | 29,70 lei | 9,90 lei × 12 = 118,80 lei | **148,50 lei** |
| Meniu + Comenzi — 249 lei * | 74,70 lei | 24,90 lei × 12 = 298,80 lei | **373,50 lei** |
| Fiscalizare — 499 lei | 149,70 lei | 49,90 lei × 12 = 598,80 lei | **748,50 lei** |

Dacă restaurantul alege plata anuală, comisionul de activare se calculează pe factura anuală integrală (ex.: Meniu + Comenzi anual = 2.496 lei factură → 748,80 lei comision de activare, plătit o dată).

Zece restaurante pe Meniu + Comenzi, aduse în toamnă, înseamnă ~3.700 lei în primul an. Nu e un salariu. E un venit lateral serios pentru cineva care oricum trece pe la 40 de localuri pe lună.

Sumele sunt bază fără TVA. Dacă ești plătitor de TVA, o adaugi pe factura ta.

## Cum funcționează, de la cerere la bani

**1. Depui cererea** pe `menuvia.ro/afiliat`. Durează un minut: telefon (obligatoriu) și o notă scurtă despre cum ai de gând să recomanzi.

**2. Te sun.** 10–15 minute. Nu e un interviu de angajare — vreau să știu cu cine lucrez, ce fel de localuri ai în jur și să-ți răspund la întrebări. Programul e cu aprobare tocmai ca să nu ajungă un link de afiliere aruncat în 200 de grupuri de Facebook.

**3. Primești acces.** Contul devine activ, primești linkul tău unic (`menuvia.ro/r/CODUL-TĂU`), codul QR aferent și panoul de partener.

**4. Recomanzi.** Trimiți linkul restaurantelor pe care le cunoști. Cine își face cont venind de pe linkul tău rămâne recomandarea ta **90 de zile**, chiar dacă se abonează abia peste câteva săptămâni.

**5. Se abonează → apare comisionul.** Automat, în panoul tău, la prima factură plătită.

**6. Perioada de siguranță.** Comisionul de activare devine plătibil după **60 de zile**, cel lunar după **14 zile**. E protecția anti-fraudă și anti-retur: dacă restaurantul cere banii înapoi în fereastra asta, comisionul se stornează. După ce trece holdul, banii sunt ai tăi.

**7. Plata.** În prima zi a lunii, sistemul generează automat lista de plată din soldul devenit plătibil. Emiți factura către Menuvia (de pe PFA sau SRL) și primești transferul. Prag minim **50 lei** — sub el, suma se reportează în luna următoare, nu se pierde.

## Panoul de partener

Cinci secțiuni, fără să ceri nimic nimănui:

- **Acasă** — câștiguri totale, confirmate, în hold, următoarea plată.
- **Restaurante** — fiecare local adus, planul lui, comisionul generat.
- **Sub-parteneri** — partenerii aduși de tine și câți clienți au adus.
- **Unelte** — linkul tău, codul QR descărcabil, datele tale de plată.
- **Ghid** — pași, mesaje gata scrise, răspunsuri la obiecții.

## Pentru agenții web și de marketing: white-label

Dacă ești agenție și vrei să-ți servești clienții de pe propriul domeniu: meniul public poate rula pe `menu.agentia-ta.ro`, cu **brandingul tău** în subsolul meniului, în locul badge-ului Menuvia. Se configurează o dată (tu adaugi un CNAME, eu setez brandul) și se aplică tuturor clienților tăi. Disponibil partenerilor activi, fără cost suplimentar.

## Ce trebuie să știi înainte să aplici (partea neplăcută, spusă din start)

- **Menuvia are zero clienți plătitori la data asta.** Produsul e live și funcțional, dar programul comercial pornește acum. Intri ca partener de lansare, nu într-o rețea validată. Dacă vrei un canal cu istoric, nu suntem noi — încă.
- **Fiscalizarea (planul de 499) e în pilot.** Puntea către casele de marcat există în produs, dar nu a fost demonstrată pe hardware la un client real. **Nu o vinde ca funcțională.** Vinzi meniul, comenzile și rezervările — care merg azi.
- **Nu avem delivery/agregatoare** (Glovo, Tazz, Bolt), **app nativă branded** sau **kiosk**. Dacă asta cere clientul, spune-i sincer că nu acoperim.
- **Plata se face doar pe factură**, de pe PFA sau SRL. Fără persoane fizice neînregistrate — nu din snobism, ci pentru că altfel eu devin plătitor de venit cu tot cortegiul de declarații.

## Aplici aici

`menuvia.ro/afiliat` → „Depune cererea". Te sun în maximum 48 de ore.

---

# B. Cum abordezi un potențial afiliat

## B.1 Emailul de prim contact

Trei reguli: subiect specific (nu „parteneriat"), primul paragraf despre **el**, o singură întrebare la final. Sub 180 de cuvinte.

### Varianta pentru contabil

```
Subiect: Pentru clienții tăi din HoReCa — 10% recurent, fără să vinzi nimic

Bună ziua, [Nume],

Am văzut că lucrați cu restaurante și cafenele din [oraș]. Vă scriu scurt.

Sunt Radu, am construit Menuvia — sistem românesc pentru restaurante:
meniu digital pe QR, comenzi de la masă și rezervări online cu buton pe
Google. 99, 249 sau 499 lei pe lună, fără comision pe comenzi sau pe
cuverturi.

Deschid programul de parteneri și caut 3 oameni care deja au încrederea
patronilor. Un contabil de HoReCa vorbește cu 30 de patroni pe lună; o
recomandare de la dvs. valorează mai mult decât orice reclamă pe care aș
plăti-o.

Cum arată: 30% din prima factură + 10% lunar timp de 12 luni, plătit pe
factura dvs. de PFA/SRL. Fără target, fără costuri, fără exclusivitate.

Ce nu vă ascund: Menuvia nu are încă clienți plătitori — programul
pornește acum. Partea de fiscalizare e în pilot și nu o prezint ca gata.

Merită 15 minute la telefon săptămâna asta?

Radu, fondator Menuvia
[telefon] · menuvia.ro
```

### Varianta pentru agenție web / freelancer

```
Subiect: [Agenție] — meniul digital al clienților voștri, pe domeniul vostru

Bună, [Nume],

Am văzut că ați făcut site-urile pentru [Restaurant 1] și [Restaurant 2].

Sunt Radu, fondatorul Menuvia — meniu digital pe QR cu comenzi de la masă
și rezervări online, sistem românesc, în producție. Deschid programul de
parteneri și pentru agenții funcționează diferit față de restul:

  • meniul public poate rula pe domeniul vostru (menu.agentia.ro), cu
    brandingul vostru în subsol, nu al meu — clientul vede agenția;
  • primiți acces de partener pe dashboardul fiecărui client adus, deci
    puteți vinde și configurarea/mentenanța ca serviciu al vostru;
  • 30% din prima factură + 10% lunar, 12 luni, pe factura voastră.

Onest: sunt pre-lansare, zero clienți plătitori, iar partea de fiscalizare
e pilot. Meniul, comenzile și rezervările merg azi și le puteți vedea live.

15 minute la telefon, joi sau vineri?

Radu · [telefon] · menuvia.ro
```

### Varianta pentru distribuitor / service de case de marcat

```
Subiect: Un venit recurent din localurile pe care le aveți deja în service

Bună ziua, [Nume],

Sunteți la [Firmă], serviceați case de marcat în [județ]. Treceți lunar
prin zeci de localuri cărora nu le vindeți nimic între revizii.

Sunt Radu, fondatorul Menuvia — meniu QR, comenzi de la masă și rezervări
online pentru restaurante. 99–499 lei/lună, fără hardware nou.

Propunerea: recomandați Menuvia localurilor pe care le aveți deja în
portofoliu și primiți 30% din prima factură + 10% lunar timp de 12 luni,
pe factura firmei. Nu aveți de livrat, instalat sau stocat nimic.

Două lucruri pe care vi le spun din start, ca să nu pierdem timp: sunt
pre-lansare, fără clienți plătitori; iar puntea noastră către casele de
marcat (bon fiscal direct din aplicație) e în pilot, nedemonstrată pe
hardware real. Nu vă cer să o vindeți. Vă cer să vindeți meniul și
comenzile — iar când pilotul fiscal e gata, sunteți primul om pe care îl
sun, pentru că voi aveți casele.

Un telefon de 15 minute săptămâna asta?

Radu · [telefon] · menuvia.ro
```

### Follow-up (la 4 zile, dacă nu răspunde)

```
Subiect: Re: [subiectul inițial]

Bună, [Nume] — revin scurt, poate a picat în alt folder.

Pe scurt: 30% din prima factură + 10% lunar timp de 12 luni, pentru
restaurantele pe care le recomandați. Fără costuri, fără target.

Dacă nu e pentru dvs., spuneți-mi doar „nu" și nu vă mai scriu.
Dacă e, aici e programul: menuvia.ro/afiliat

Radu
```

Un singur follow-up. Al doilea te scoate din agendă permanent.

## B.2 Scriptul telefonic (15 minute)

**Minutul 0–1 — deschidere.**
> „Bună ziua, [Nume], sunt Radu de la Menuvia, v-am scris pe email zilele trecute. Aveți două minute sau vă sun altă dată? … Perfect. V-am scris pentru programul de parteneri și vreau să vă spun în două fraze despre ce e vorba, apoi vă întreb dacă are sens pentru dvs."

**Minutul 1–3 — produsul, scurt.**
> „Menuvia e un sistem pentru restaurante: clientul scanează un QR pe masă, vede meniul în 7 limbi, poate comanda direct de acolo, comanda ajunge în bucătărie. Plus rezervări online cu linkul care intră în butonul de rezervare de pe Google. 99 de lei pe lună varianta cu meniu și rezervări, 249 cu comenzi. Fără comision pe comenzi și fără comision pe cuverturi, spre deosebire de TheFork."

**Minutul 3–5 — de ce el.**
> „Nu vă sun ca să vă vând mie ceva. Vă sun pentru că dvs. [țineți contabilitatea la / faceți site-urile pentru / serviceați casele de la] restaurante și vorbiți cu patronii ăia oricum. Eu pot să dau reclamă și să mă bată la ușă cu Facebook Ads, sau pot să lucrez cu trei oameni care sunt deja crezuți în piață. A doua variantă e mai ieftină pentru mine și mai profitabilă pentru dvs."

**Minutul 5–8 — banii, exact.**
> „30% din prima factură a fiecărui restaurant, o dată. Plus 10% din fiecare factură lunară, timp de 12 luni. La planul de 249, asta înseamnă vreo 373 de lei pe an per local. Aduceți zece în toamnă, sunt 3.700 de lei. Comisionul de activare e blocat 60 de zile, cel lunar 14, ca să nu plătesc pe cineva care cere banii înapoi în prima lună. După hold, se plătesc lunar, pe factura dvs. Fără target, fără costuri, fără exclusivitate."

**Minutul 8–11 — adevărul, spus înainte să întrebe.**
> „Trei lucruri pe care trebuie să le știți înainte să spuneți da. Unu: n-am încă niciun client plătitor. Produsul e live și îl puteți testa în cinci minute pe telefon, dar comercial pornesc acum — sunteți printre primii, cu tot ce înseamnă asta. Doi: partea de fiscalizare, planul de 499, e în pilot; puntea către casele de marcat există în cod, dar n-a tipărit încă un bon pe o casă reală la un client. Nu vreau să o vindeți ca fiind gata. Trei: nu avem delivery gen Glovo, nu avem aplicație nativă. Dacă un local vrea neapărat asta, îi spuneți sincer că nu suntem noi."

**Minutul 11–14 — întrebările tale.** (ascultă, nu vinde)
1. „Cu câte localuri lucrați acum, aproximativ?"
2. „Care dintre ele s-ar plânge de meniuri tipărite, de rezervări luate pe telefon sau de comenzi luate greu în terasă?"
3. „Aveți PFA sau SRL, ca să putem factura?"
4. „Ce v-ar face să nu recomandați ceva unui client de-al dvs.?" ← **cea mai importantă. Ascultă răspunsul; îți spune dacă omul are coloană.**

**Minutul 14–15 — închidere clară.**
> „Vă trimit acum pe email linkul de cerere și materialul de partener. Dacă îl citiți și vi se pare ok, depuneți cererea și vă activez contul azi sau mâine. Vă sun peste o săptămână să vedem cum a fost prima discuție cu un local. Sună bine?"

**Ce NU faci la telefon:** nu-l rogi să semneze nimic, nu-i ceri bani, nu îi promiți exclusivitate pe județ (dacă îți cere: „nu dau exclusivitate acum, dar primii parteneri au procente fixe garantate și prioritate la orice condiție mai bună apare"), nu inventezi clienți existenți.

## B.3 Mesaj scurt (WhatsApp / LinkedIn)

```
Bună, [Nume]. Sunt Radu, am făcut Menuvia — meniu digital cu comenzi la
masă și rezervări online pentru restaurante, sistem românesc.

Caut 3 parteneri care lucrează deja cu localuri și vor un venit recurent
din recomandări: 30% din prima factură + 10% lunar, 12 luni. Fără costuri
și fără target.

Sunt pre-lansare, fără clienți plătitori încă — v-o spun din start.
Merită 15 minute la telefon?
```

## B.4 Mesajul de refuz (când candidatul nu e potrivit)

Îl scrii scurt și fără explicații lungi. Un refuz prost făcut se întoarce ca recenzie.

```
Bună, [Nume],

Mulțumesc pentru cerere și pentru discuție. Deocamdată nu merg mai
departe cu ea — pornesc programul cu foarte puțini parteneri și mă
concentrez pe profilurile care lucrează zi de zi cu restaurante.

Rămâne deschisă pentru mai târziu; dacă situația se schimbă, scrieți-mi
și reluăm.

Numai bine,
Radu
```

---

# C. Materialul afiliatului: ce spune și ce trimite clienților lui

> Trimite-l afiliatului **după aprobare**, împreună cu linkul lui. E scris ca să fie citit de el, nu de tine.

## C.1 Pitchul de 30 de secunde

Nu începe cu produsul. Începe cu ce doare.

**Pentru un restaurant cu meniuri tipărite:**
> „Ai schimbat prețurile de curând? Reretipărirea meniurilor te costă de fiecare dată. Cu Menuvia pui un QR pe masă, clientul vede meniul pe telefon, în șapte limbi, iar tu schimbi un preț din telefon în zece secunde. 99 de lei pe lună și prima lună e gratuită. Îți trimit un link, te uiți pe telefon în două minute."

**Pentru un local care ia rezervări pe telefon:**
> „Câte rezervări pierzi când sună lumea și nu răspunde nimeni în tura de prânz? Menuvia îți dă o pagină de rezervări pe care o pui direct în butonul de rezervare de pe Google — clientul rezervă singur, primește confirmare pe SMS și un reminder înainte, iar tu primești email la fiecare rezervare nouă. Fără comision pe cuvert, spre deosebire de TheFork. 99 de lei pe lună, indiferent câte rezervări intră."

**Pentru o terasă / local cu personal puțin:**
> „Vara, pe terasă, cât așteaptă un client până vine ospătarul să ia comanda? Cu Menuvia scanează QR-ul de pe masă și comandă singur — comanda apare direct pe ecranul din bucătărie, cu masa identificată. Ospătarul duce mâncarea, nu aleargă după comenzi. 249 de lei pe lună, prima lună gratuită."

## C.2 Mesajul pe WhatsApp (cel care funcționează cel mai des)

```
Salut, [Nume]! Am dat peste ceva ce cred că ți-ar prinde bine la [local].

E un meniu digital pe QR — clientul scanează, vede meniul cu poze, în 7
limbi, și poate chiar să comande de la masă. E românesc, se pune în vreo
15 minute și îți încarci meniul făcând poze la cel actual (îl citește
singur, cu AI).

Uite un exemplu real, deschide-l pe telefon: [linkul tău]

Are 30 de zile gratuite. Dacă vrei, te ajut eu la configurare.
```

## C.3 Emailul către un restaurant

```
Subiect: Meniul de la [Local], pe telefonul clienților — vă arăt în 2 minute

Bună ziua, [Nume],

Vă scriu pentru că lucrez cu [Local] de ceva vreme și cred că ceva
recent vă prinde bine.

Menuvia e un sistem românesc care vă pune meniul pe un cod QR de pe masă:
clientul îl deschide pe telefon, îl vede cu poze, în șapte limbi
(util vara și la grupurile de turiști), iar dumneavoastră schimbați un
preț în zece secunde, fără să retipăriți nimic.

Mai face două lucruri care contează:
  • pagina de rezervări online pe care o puneți direct în butonul de
    rezervare de pe Google, cu confirmări și remindere pe SMS — fără
    comision pe cuvert;
  • comenzi luate de client direct de la masă, care ajung pe un ecran în
    bucătărie (pe planul mai mare).

Meniul se încarcă făcând poze la meniul actual — îl citește singur.

99 lei/lună varianta cu meniu și rezervări, 249 cu comenzi. 30 de zile
gratuite, se anulează cu un click.

Aici e linkul meu: [linkul tău]
Vă ajut eu cu primul pas, dacă vreți.

Cu stimă,
[Numele tău] · [telefon]
```

## C.4 Ce trimiți, concret

| Vrea să… | Trimite |
|---|---|
| vadă cum arată un meniu real | pagina de demo: `menuvia.ro/demo` (deschide-o pe telefon, nu pe laptop) |
| vadă pagina de rezervări | `menuvia.ro/rezervari` |
| vadă prețurile | `menuvia.ro/preturi` |
| **se înscrie** | **linkul tău: `menuvia.ro/r/CODUL-TĂU`** ← fără el nu primești comision |
| vrea suporturi fizice pentru QR | `codvia.ro` — stand PVC 29 lei, plexiglas 79, lemn gravat 129, NFC+QR 179. Comanda se confirmă telefonic, plata ramburs. *(Codvia nu generează comision de afiliere — e un serviciu pe care îl poți oferi clientului, nu o sursă de venit pentru tine.)* |

**Regula de aur a atribuirii:** dacă restaurantul își face cont **fără** să treacă prin linkul tău, nu primești nimic — nici retroactiv, nici pe bază de discuție. Trimite linkul tău, nu adresa site-ului.

## C.5 Demonstrația de 4 minute, pe telefonul tău

1. Deschizi `menuvia.ro/demo` — arăți meniul cu poze, categorii, alergeni. **15 secunde.**
2. Schimbi limba în engleză și în germană. („Vara, la terasă, asta e jumătate din masă.") **20 secunde.**
3. Adaugi un produs în coș, cu opțiuni (bine făcut / fără ceapă). **30 secunde.**
4. Arăți pagina de rezervări, cu alegerea mesei pe hartă. **40 secunde.**
5. Te oprești și întrebi: **„Care din astea ți-ar folosi luna asta?"** Apoi taci. Cine vorbește primul, pierde.

Nu arăți dashboardul, rapoartele, stocurile sau setările. Patronul nu cumpără panouri de control; cumpără o problemă rezolvată.

## C.6 Obiecții și răspunsuri

| Ce spune | Ce răspunzi |
|---|---|
| „Clienții mei sunt în vârstă, nu scanează QR." | „Nu scoți meniul tipărit. QR-ul e pentru cine îl vrea — de obicei turiștii și tinerii. Meniul tipărit rămâne pe masă." |
| „Am deja meniu digital / MeniuDigital." | „Bine. Întreabă-te doar dacă îți dă și rezervări cu buton pe Google, cu SMS-uri incluse, și dacă te lasă să treci la comenzi de la masă când vrei. Dacă da, rămâi cu ei — nu are rost să schimbi." |
| „Cât mă costă de fapt?" | „99, 249 sau 499 pe lună, în funcție de cât vrei. Fără comision pe comenzi, fără comision pe rezervări, fără hardware. Primele 30 de zile sunt gratuite." |
| „Îmi ia bonul fiscal / casa de marcat?" | **„Nu. Casa ta rămâne casa ta.** Partea care ar tipări bonul direct din aplicație e în pilot la ei, nu e gata — nu ți-o vând azi. Ce merge azi e meniul, rezervările și comenzile." |
| „Cine îmi bagă meniul în sistem?" | „Faci poze la meniul actual și îl citește singur, cu AI, până la 4 pagini odată. Ce iese strâmb, corectezi în 10 minute. Sau ți-l încarc eu." |
| „Am nevoie de internet bun în local?" | „Pentru clienți da, folosesc telefonul lor sau wifi-ul tău. Ospătarii au și mod offline pe planul cu comenzi." |
| „Dacă nu-mi place?" | „Anulezi cu un click, fără penalizări. Primele 30 de zile sunt gratuite oricum." |
| „Tu ce câștigi din asta?" | **Spune adevărul:** „Primesc comision dacă te abonezi. De-asta ți-am spus și ce nu face." Onestitatea aici închide mai multe vânzări decât orice argument. |
| „Câte restaurante folosesc deja?" | **„Puține — e un produs nou, românesc, tocmai a intrat pe piață.** De-asta ai 30 de zile gratuite și de-asta prinzi atenția fondatorului direct pe WhatsApp, ceea ce n-o să ai la un furnizor cu 1.000 de clienți." **Nu inventa cifre. Niciodată.** |

## C.7 Ce nu spui, niciodată

- ❌ „Îți înlocuiește casa de marcat" / „îți tipărește bonul fiscal" — pilotul fiscal **nu e demonstrat**. E cea mai gravă promisiune pe care o poți face; îl bagi pe patron în probleme cu ANAF și mă bagi pe mine în procese.
- ❌ „Sunt X sute de restaurante pe platformă" — nu sunt. Nu inventa cifre, nume de localuri sau testimoniale.
- ❌ „Merge și cu Glovo / Tazz / Bolt" — nu merge.
- ❌ „Îți dau eu discount" — prețurile sunt publice și fixe. Nu negociezi în numele Menuvia; dacă un lanț vrea ofertă specială, mi-l trimiți mie.
- ❌ Nu te prezenta ca angajat sau reprezentant Menuvia. Ești **partener** și recomanzi. Formula corectă: „lucrez cu ei ca partener".

---

# D. Regulile programului

> Se trimit în scris fiecărui afiliat **înainte** de aprobare. Ele nu înlocuiesc contractul de prestări servicii, care se semnează înainte de prima plată.

## D.1 Cum se atribuie un client

1. **Linkul.** Fiecare partener are un link unic: `menuvia.ro/r/COD`. Vizitatorul care intră pe el primește un marcaj în browser, valabil **90 de zile**. Dacă își face cont și se abonează în fereastra asta, atribuirea e a partenerului — automat, fără formular.
2. **Ce contează e contul care plătește**, nu restaurantul. Comisionul se leagă de contul (profilul) care ține abonamentul. Dacă un patron cu trei localuri plătește dintr-un singur cont, comisionul curge din acel abonament.
3. **Prima atribuire câștigă.** Dacă un client atinge două linkuri diferite, comisionul merge la primul partener înregistrat.
4. **Conturile deja existente sunt organice.** Dacă restaurantul avea deja cont Menuvia înainte să treacă prin linkul tău, atribuirea nu se face. Nu se rezolvă „prin discuție" — sistemul compară datele și decide singur.
5. **Fără auto-recomandare.** Dacă te abonezi tu însuți prin propriul link, comisionul e zero. Același lucru pentru conturi-paravan create pe numele altcuiva.
6. **Nicio atribuire retroactivă, manuală.** Nu există buton care să lege un restaurant de un partener după fapt. Trimite linkul tău. De fiecare dată.

## D.2 Ce se plătește

| | |
|---|---|
| **Activare** | 30% din prima factură plătită, o dată per restaurant |
| **Recurent** | 10% din fiecare factură lunară, maximum 12 luni per restaurant |
| **Sub-parteneri** | 2% din comisioanele efectiv plătite ale partenerilor aduși de tine, **un singur nivel** |
| **Bază de calcul** | factura efectiv **plătită**. Nu pe abonamente în trial, neplătite sau restante |
| **Monedă** | RON |
| **TVA** | sumele sunt bază fără TVA; dacă ești plătitor, o adaugi pe factura ta |

Notă onestă: comisionul automat curge azi pe planul de Fiscalizare (499 lei). *[Șterge propoziția asta după ce lărgești gate-ul — vezi secțiunea 0.1.]*

## D.3 Când se plătește

1. **Hold.** Comisionul de activare devine plătibil după **60 de zile**, cel recurent după **14 zile**. În fereastra asta, un retur sau o contestație la plată stornează comisionul integral.
2. **Draft lunar.** În prima zi a fiecărei luni, sistemul calculează automat soldul devenit plătibil și creează o propunere de plată.
3. **Factura.** Emiți factură către Menuvia (PFA sau SRL, e-Factura conform regulilor în vigoare) pe suma din propunere. Fără factură nu se face plata — nu e birocrație, e singura formă în care pot deconta legal cheltuiala.
4. **Transferul.** După confirmarea facturii, banii pleacă prin transfer bancar.
5. **Prag minim 50 lei.** Sub prag, soldul se reportează în luna următoare. Nu se pierde niciodată.
6. **Sold negativ** (dacă stornările depășesc comisioanele): se reportează, nu se cere înapoi în numerar.

## D.4 Ce ai voie

- ✅ Să recomanzi direct, față în față, pe telefon, pe WhatsApp, prin emailul tău, pe site-ul tău, în newsletterul tău.
- ✅ Să scrii articole, postări, recenzii pe social media — cu mențiunea că e o recomandare din care câștigi comision (cerută de lege).
- ✅ Să oferi tu servicii plătite în jurul Menuvia: configurare, încărcarea meniului, fotografie, mentenanță. Banii ăia sunt integral ai tăi și nu mă privesc.
- ✅ Să folosești logo-ul și materialele Menuvia în forma primită, nemodificate.
- ✅ Să recrutezi sub-parteneri și să câștigi 2% din comisioanele lor.
- ✅ Să folosești accesul de partener pe dashboardul restaurantelor aduse prin tine, **exclusiv** pentru a-i ajuta pe ei.

## D.5 Ce nu ai voie

- ❌ **Să te dai drept angajat, reprezentant sau distribuitor oficial Menuvia.** Ești partener și recomanzi.
- ❌ **Să negociezi prețuri, discounturi sau condiții** în numele Menuvia, sau să semnezi ceva în numele meu.
- ❌ **Să promiți funcții inexistente.** Cu majuscule: **fiscalizarea automată nu se vinde ca funcțională**, pentru că nu a fost demonstrată. La fel: delivery, app nativă, kiosk.
- ❌ **Să inventezi cifre, clienți, testimoniale sau referințe.**
- ❌ **Spam.** Fără emailuri sau SMS-uri în masă către liste cumpărate, fără mesaje repetate către cine a spus nu. GDPR e problema ta legală, nu a mea, dar reputația e a amândurora.
- ❌ **Licitare pe brand.** Fără reclame plătite pe cuvântul „Menuvia" sau variante apropiate; fără domenii, conturi de social media sau adrese de email care conțin „Menuvia" și pot fi confundate cu cele oficiale.
- ❌ **Auto-recomandare sau conturi-paravan** pentru a genera comision artificial.
- ❌ **Să folosești datele clienților** la care ai acces de partener (meniu, comenzi, clienți, cifre) în alt scop decât ajutarea acelui restaurant. Fără export, fără revânzare, fără liste. Patronul vede accesul tău și îl poate opri oricând, fără explicații.
- ❌ **Să ceri bani de la sub-parteneri** ca să intre în program, sau să le promiți „câștiguri din echipă". Comisionul curge **numai** dintr-un abonament real plătit, niciodată din recrutare. Regula asta nu e negociabilă și nu are excepții.

## D.6 Ce se întâmplă la încălcare

Prima abatere minoră: te sun și corectăm. Promisiunile false despre fiscalizare, spamul, conturile-paravan sau folosirea abuzivă a datelor clienților duc la **suspendarea contului**: atribuirile rămân, dar comisioanele aflate în hold se anulează și accesul de partener se retrage. Comisioanele deja plătibile și facturate se achită.

## D.7 Alte precizări

- **Fără exclusivitate**, în niciun sens: nici teritorială, nici de produs. Poți recomanda în paralel orice.
- **Fără costuri și fără target.** Nu există taxă de intrare, kit plătit sau volum minim.
- **Procentele pot fi modificate** pentru viitor, cu anunț prealabil. Comisioanele deja generate nu se modifică retroactiv, niciodată.
- **Contractul** de prestări servicii se semnează înainte de prima plată; el prevalează asupra acestui document.

---

# E. Primii 3 afiliați: pe cine vrei și unde îi găsești

Nu vrei 30 de afiliați. Vrei **3 care lucrează**. Un program de afiliere cu 30 de linkuri inactive arată identic cu unul cu zero și te costă timp de suport.

## Criteriile de calificare (toate 4, altfel refuză)

1. **Vorbește deja cu patroni de restaurant, lunar, dintr-un motiv care nu e vânzarea.**
2. **Are PFA sau SRL** — fără asta nu pot plăti legal.
3. **Nu are nevoie de Menuvia ca să-și plătească chiria.** Cine e disperat promite fiscalizare gata în prima săptămână.
4. **La întrebarea „ce te-ar face să nu recomanzi ceva unui client?" dă un răspuns cu substanță.** Cine spune „nimic, recomand orice" e exact omul care îți arde reputația în prima lună.

---

## Profil 1 — Contabilul / firma de contabilitate cu portofoliu HoReCa

**De ce e cel mai bun profil:** are exact relația care contează. Patronul îi arată cifrele reale, îl sună când are o problemă, îl crede când zice „ăsta merită". Are deja PFA/SRL și facturează fără să învețe nimic nou. Și, spre deosebire de un vânzător, nu are nimic de pierdut dacă recomandarea nu prinde — deci nu forțează, deci e crezut.

**Unde îi găsești, concret:**
- **Tabloul CECCAR** (`ceccar.ro`) — filtrezi pe județ, apoi cauți pe site-urile lor cuvântul „HoReCa" sau „restaurante". Cine îl are pe site s-a poziționat deliberat pe nișă și e ținta ta.
- **Grupurile de contabili de pe Facebook** (contabilitate, e-Factura, SAF-T, monitorul fiscal). Nu posta oferta în grup — citește cine răspunde competent la întrebări despre restaurante și scrie-i în privat.
- **Invers, prin restaurante:** întreabă orice patron pe care îl cunoști „cine îți ține contabilitatea?". Doi-trei patroni îți dau același nume — ăla e omul.
- **Seminarele de e-Factura / SAF-T** din orașul tău, organizate de CECCAR sau de firme de software fiscal. Sala e plină exact de profilul ăsta.
- **Furnizorii de software de contabilitate** (SmartBill, Saga) au liste publice de parteneri contabili pe județe.

**Ce îi spui specific:** „Nu-ți cer să vinzi. Îți cer să nu taci când un client se plânge de meniuri retipărite sau de rezervări pierdute. Primești 10% lunar timp de un an, pe factura ta, fără să faci nimic în plus."

**Semnal roșu:** contabilul care revinde deja 4 softuri diferite. E colecționar de comisioane, nu partener.

---

## Profil 2 — Agenția web/marketing sau freelancerul care face site-uri de restaurant

**De ce merge:** e singurul profil pentru care ai o ofertă pe care concurența n-o are — **white-label**. Meniul rulează pe `menu.agentia.ro`, cu brandul agenției în subsol. Pentru o agenție, asta nu e comision; e **produs nou în portofoliu**, cu marjă recurentă și fără cod de scris. În plus, primește acces de partener pe dashboardul fiecărui client, deci poate factura separat configurarea și mentenanța — banii ăia sunt integral ai lui.

**Unde îi găsești, concret:**
- **Metoda subsolului.** Deschizi Google Maps, cauți „restaurant [oraș]", intri pe 20 de site-uri și te uiți în subsol: „site realizat de X" / „web design Y". Aceleași 3–4 nume se repetă în orice oraș. Aia e lista ta, deja calificată — au dovada colaborării cu HoReCa pe pagina lor.
- **Cine administrează profilurile de Google Business** ale localurilor mari din oraș — de obicei aceeași agenție.
- **Grupuri de freelanceri români** (web design, WordPress, marketing digital) pe Facebook și Reddit; caută pe cine postează portofolii cu restaurante.
- **Fotografii culinari** din oraș (Instagram, hashtag pe oraș) — lucrează cu aceleași localuri și, de multe ori, sunt prieteni cu agenția care face site-ul. Doi la preț de unul.
- **Firmele care fac Google Ads pentru restaurante** — le găsești după cine apare ca agenție în cazurile de studiu locale.

**Ce îi spui specific:** „Îți dau un produs recurent pe care îl vinzi sub brandul tău, fără să scrii o linie de cod. Clientul vede agenția în subsolul meniului, nu pe mine. Tu iei comisionul plus ce factureze pentru configurare."

**Semnal roșu:** agenția care vrea white-label înainte să aducă primul client. Configurarea de domeniu se face **după** ce are măcar un local activ.

---

## Profil 3 — Distribuitorul / serviceul de case de marcat sau furnizorul HoReCa

**De ce merge:** intră fizic în local, lunar, și vorbește cu patronul, nu cu ospătarul. Are deja o listă de zeci-sute de localuri în portofoliu și nimic recurent să le vândă între revizii. Are firmă, facturează, știe piața.

**Unde îi găsești, concret:**
- **Lista aparatelor de marcat electronice fiscale autorizate**, publicată de ANAF — conține distribuitorii autorizați. De acolo mergi pe site-urile lor și cauți acoperirea pe județ.
- **Rețelele de dealeri ale producătorilor** — Datecs România, Activa, Tremol au liste de parteneri/service pe județe pe site-urile oficiale. Sunt exact casele pe care le suportă bridge-ul nostru, când pilotul va fi gata.
- **Căutare simplă:** „service case de marcat [oraș]", „aparate de marcat [județ]". Firmele mici, cu 2–5 tehnicieni, răspund la telefon; cele mari nu.
- **Distribuitorii de băuturi și de echipamente HoReCa** din zona ta — reprezentantul de vânzări trece prin 15 localuri pe zi. Îi găsești întrebând barmanii „cine vă aduce marfa?".
- **Târgurile HoReCa** (Expo HoReCa / GastroPan / Indagra) — o zi acolo, în perioada potrivită, îți dă mai multe contacte calificate decât o lună de emailuri.

**Ce îi spui specific:** „Ai deja localurile. Îți dau ceva de vândut între revizii, fără stoc și fără livrare." **Și imediat, în aceeași frază:** „Partea de bon fiscal din aplicație e în pilot și nu ți-o dau să o vinzi acum. Când e gata, tu ești primul om pe care îl sun — pentru că tu ai casele."

**Semnal roșu:** cine vrea să vândă din prima ziua planul de 499 pe promisiunea fiscalizării. Îl oprești acolo sau nu-l aprobi.

---

## Planul pe 30 de zile

| Săptămâna | Ce faci |
|---|---|
| **1** | Rezolvi 0.1 (gate-ul de plan) și 0.3 (domeniu + email). Construiești lista: 8 contabili, 8 agenții, 6 distribuitori/furnizori — cu nume, telefon, email și motivul concret pentru care i-ai ales. |
| **2** | Trimiți 22 de emailuri personalizate (nu bulk — fiecare cu o propoziție reală despre el). Un follow-up la 4 zile. Așteptare realistă: 4–6 răspunsuri, 3–4 telefoane. |
| **3** | Telefoanele. Aprobi **maximum 3**. Restul primesc mesajul de refuz din B.4 sau rămân pe listă. Trimiți kitul (secțiunile A, C, D) fiecăruia dintre cei 3. |
| **4** | Suni fiecare afiliat aprobat, o dată. O singură întrebare: **„cu cine ai vorbit și ce ți-a spus?"** Nu „câți ai adus". Dacă n-a vorbit cu nimeni în două săptămâni, n-o s-o facă nici în două luni — treci mai departe fără resentimente. |

**Cum arată succesul la 30 de zile:** 3 afiliați activi, fiecare cu 2–3 discuții reale purtate cu localuri, 1–2 conturi create prin linkuri. **Nu** venit. Venitul din canalul ăsta apare în noiembrie-decembrie, dacă recrutarea se face acum — exact la timp pentru fereastra septembrie-octombrie a restaurantelor permanente.

---

# Anexa 1 — Checklist de onboarding pentru un afiliat nou

După aprobarea în panoul de fondator:

- [ ] Îi confirmi aprobarea pe telefon sau WhatsApp (nu doar prin sistem).
- [ ] Îi trimiți pe email: linkul lui `menuvia.ro/r/COD`, secțiunile **A, C, D** din kitul ăsta, și linkul de demo.
- [ ] Îi ceri să-și completeze **datele de plată** în panou → „Unelte" → Date de plată. Fără ele, plata nu se poate face.
- [ ] Îi ceri să-și descarce **codul QR** din „Unelte" (util pe cărți de vizită, la standuri, la târguri).
- [ ] Îi spui explicit cele trei lucruri care nu se promit: fiscalizare funcțională, cifre inventate, delivery.
- [ ] Îi dai numărul tău de WhatsApp și îi spui că răspunzi în aceeași zi. Primii afiliați au nevoie de asta.
- [ ] Îți pui în calendar telefonul de la 2 săptămâni, cu întrebarea: „cu cine ai vorbit și ce ți-a spus?".

# Anexa 2 — Tabelul complet de comisioane

Plan lunar, per restaurant adus:

| Plan | Preț/lună | Activare 30% | Recurent 10%/lună | 12 luni recurent | **Total an 1** |
|---|---|---|---|---|---|
| Meniu Digital + Rezervări * | 99 lei | 29,70 | 9,90 | 118,80 | **148,50 lei** |
| Meniu + Comenzi * | 249 lei | 74,70 | 24,90 | 298,80 | **373,50 lei** |
| Fiscalizare | 499 lei | 149,70 | 49,90 | 598,80 | **748,50 lei** |

Plan anual (prima factură = anul întreg, cu ~17% reducere):

| Plan | Factură anuală | Activare 30% |
|---|---|---|
| Meniu Digital + Rezervări * | 996 lei | **298,80 lei** |
| Meniu + Comenzi * | 2.496 lei | **748,80 lei** |
| Fiscalizare | 4.980 lei | **1.494 lei** |

`*` — depinde de decizia din secțiunea 0.1. Sumele sunt bază fără TVA. Sub-partenerii aduc 2% din comisioanele efectiv plătite ale partenerului recrutat, pe un singur nivel.

**Notă doar pentru fondator:** la abonamentele anuale, comisionul de activare de 30% se aplică pe factura anuală integrală, cu hold de doar 60 de zile. La planul de 499 anual asta înseamnă 1.494 lei plătiți dintr-o dată. Decide dacă vrei un plafon per restaurant înainte să lansezi oferta anuală prin afiliați — parametrul de comision e editabil din panoul de fondator și se aplică imediat, dar nu retroactiv.
