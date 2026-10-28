# 01 — Email către firma de contabilitate

> **Pentru cine e:** fondatorul. Copiezi blocul de mai jos (de la „Subiect” până la semnătură), completezi `[...]` și trimiți.
> **Când:** Ședința 1, pasul 1 (15 min împreună cu emailul către avocat, `02-email-avocat.md`).
> **Ce NU conține:** concluzii fiscale. Totul e formulat ca ÎNTREBARE; răspunsurile le dă contabilul, iar tu mi le trimiți ca să le pun în cod și în texte.
> **De ce acum:** firma (SRL) e pe drumul critic al banilor: fără ea nu există cont bancar, Stripe LIVE, facturi Menuvia și plăți către agenți (`PLAN_optimizat` §0.1, pct. 1).

## Ce faci, în ordine

1. Alegi 1–2 firme de contabilitate (cere ofertă la ambele dacă poți; răspunsurile la întrebările de mai jos te ajută să le compari).
2. Trimiți emailul de mai jos. **Atașezi:** nimic obligatoriu. Opțional, linkul către pagina de prețuri după ce îl ai.
3. Întrebi explicit dacă firma colaborează cu un furnizor de **semnătură electronică calificată** (ONRC și SPV o cer). Dacă da, comanzi prin ei; dacă nu, comanzi tu de la un furnizor calificat (vezi `05-ghid-ședința-1.md`, pasul 1c).
4. Răspunsurile pe care ți le dă contabilul: le copiezi într-un singur mesaj către mine, **cu aceleași numere ca în email (1–28)**. Cu ele deblochez: baza comisionului, textul de TVA de pe pagina de prețuri, autofacturarea (cod), seria Oblio, pachetul 9 (Legal-final) și pachetul 13 (Plăți automate).

## Subiect

```text
Subiect: Înființare SRL + contabilitate pentru un SaaS (Menuvia) — ofertă și câteva întrebări de principiu
```

## Corpul emailului

```text
Bună ziua,

Mă numesc [NUME PRENUME] și vreau să înființez un SRL pentru un produs software (SaaS) numit Menuvia: meniu digital cu cod QR, comenzi și rezervări pentru restaurante din România. Produsul e deja funcțional; vindem abonamente lunare prin Stripe și printr-o rețea de agenți de vânzări (persoane autorizate sau societăți, plătiți cu comision). Aș vrea să colaborăm pentru înființare și contabilitate curentă și am câteva întrebări de principiu, ca să facem lucrurile corect de la început. Nu vă cer răspunsuri definitive pe toate dintr-un email: dacă unele cer o discuție, propuneți-mi o oră.

CONTEXT (pe scurt)
- Activitate: licențiere/furnizare de software ca serviciu, doar B2B (clienții sunt restaurante/cafenele, persoane juridice sau PFA din România).
- Prețuri lunare listate: 99 lei, 249 lei și 499 lei (trei planuri). Plata se face cu cardul, prin Stripe, recurent. Există și o perioadă de probă gratuită de 30 de zile.
- Facturarea clienților: vrem ca facturile Menuvia către abonați să fie emise prin Oblio (cont pe firma Menuvia), cu transmitere automată în SPV (e-Factura).
- Rețeaua de vânzări: agenți independenți (doar PFA sau SRL, cu CUI) primesc comision din încasările reale ale clienților aduși (30% o singură dată + 10% pe 12 facturi lunare). Un „șef de vânzări” primește un bonus de 20% din comisionul agenților lui, plătit de Menuvia, nu scăzut din comisionul agentului. Plata comisioanelor se face lunar, automat, prin Stripe Connect (conturi Express).
- Volum la început: foarte mic (zero clienți plătitori acum; câteva zeci în primul an, estimare).

A. ÎNFIINȚARE ȘI SEDIU
1. Puteți prelua înființarea completă (denumire, ONRC, act constitutiv, sediu social, încadrare CAEN, cont bancar)? Ce taxe externe apar (ONRC, notar dacă e cazul, spațiu pentru sediu) și ce onorariu este al dumneavoastră?
2. Ce coduri CAEN propuneți pentru activitatea principală? (Noi ne gândim la 5829, 6201 sau 6311 — confirmați sau corectați.) Dacă vom vinde ulterior și bunuri fizice online (suporturi QR), ce CAEN secundar adăugăm încă de la înființare ca să nu modificăm actele?
3. Opțiuni pentru sediul social (la domiciliul meu / spațiu închiriat / sediu virtual): care e varianta uzuală și ce implică (contract de comodat/închiriere, costuri anuale)?
4. Administrator unic, asociat unic (eu) — e suficient pentru început? Ce capital social minim recomandați?
5. Semnătura electronică calificată: o puteți comanda prin dumneavoastră (furnizor partener) sau recomandați un furnizor? Eu am nevoie de ea pentru ONRC, pentru SPV și pentru semnarea actelor la distanță, cu identificare video. Cât durează, de obicei, de la comandă la activare?

B. REGIM FISCAL ȘI TVA
6. Impozitare: microîntreprindere sau impozit pe profit pentru primul an? De ce (plafoane, condiții)? Există vreo condiție legată de obiectul de activitate sau de asociatul unic?
7. TVA — neplătitor, dacă suntem eligibili: la un SRL nou, putem rămâne neplătitor de TVA (sub plafonul de scutire, art. 310 Cod fiscal) până depășim plafonul? Ce plafon se aplică acum (în notele noastre apare 395.000 lei — vă rog să îl confirmați sau să îl corectați)? Când devine obligatorie înregistrarea în scopuri de TVA și ce facem la depășire (termene, efect asupra prețurilor)?
8. PREȚURILE: dacă rămânem neplătitori de TVA, 99/249/499 lei sunt prețuri FINALE (clientul plătește exact atât, nu adăugăm TVA)? Dacă devenim plătitori, ce se întâmplă cu prețurile deja vândute pe site (reducem venitul net sau creștem prețul pentru clienții noi/existenți)? Ce text recomandați pe pagina de prețuri (de ex. „TVA neinclus / inclus”, „prețuri finale, neplătitor de TVA”)?
9. Abonamente cu perioadă de probă gratuită (30 de zile, fără card): există vreo implicație fiscală/contabilă pentru perioada gratuită (de ex. venit zero, nicio factură)?
10. Dacă vom avea clienți din alte state UE (mai târziu): ce trebuie să știm acum despre TVA la servicii B2B/B2C către UE (OSS, taxare inversă), ca să nu închidem nicio ușă la înființare? (Doar informativ, nu e urgent.)

C. FACTURAREA ABONAȚILOR (Oblio, SPV)
11. Putem folosi Oblio pe contul firmei Menuvia: seria propusă „MNV” (numerotare continuă), cu bifa de transmitere automată în SPV (e-Factura)? Cine face configurarea inițială (dumneavoastră sau eu), și aveți nevoie de împuternicire SPV din partea mea? Care e procedura și cât durează?
12. Până la ~10 abonați, aș vrea ca dumneavoastră să emiteți facturile pentru abonați pe baza notificării de plată din Stripe (încasare lunară), în termenul legal de transmitere în SPV. Acceptați acest model? Cât costă (per factură sau în pachetul lunar)? Din ce număr de facturi pe lună devine rentabilă automatizarea (emitere automată din Oblio la plată)?
13. Stripe trimite clienților un email de „chitanță/receipt” la fiecare plată. E acceptabil, sau trebuie să îl denumim altfel (să nu fie confundat cu factura fiscală) ori să îl dezactivăm?
14. Ce date de la client sunt necesare pe factură pentru B2B (CUI, adresă, denumire) și ce facem cu un client PFA sau fără CUI? (Noi colectăm CUI și adresa la plata cu Stripe.)

D. COMISIOANELE AGENȚILOR (partea cea mai importantă)
15. Baza de calcul: comisionul se calculează la suma efectiv încasată de la client. Dacă nu suntem plătitori de TVA, suma încasată e și baza netă. Dacă devenim plătitori, recomandați să calculăm comisionul la suma FĂRĂ TVA? Cum documentăm această bază ca să fie deductibilă?
16. Deductibilitate: ce documente trebuie să existe pentru ca un comision plătit unui agent să fie cheltuială deductibilă (contract, factură/autofactură, dovada că agentul a adus clientul: cod → client → factură plătită)? Ce păstrăm și cât timp?
17. AUTOFACTURARE (art. 319 alin. 18 Cod fiscal): ca să nu ceară fiecare agent o factură lunară, Menuvia ar emite factura în numele și pe contul agentului, pe baza unui acord prealabil și a unei proceduri de acceptare a facturilor. Întrebări concrete: (a) este permisă în situația noastră? (b) ce trebuie să conțină acordul prealabil dintre noi și agent (o clauză în contractul de agent e suficientă?) și ce procedură de acceptare considerați acceptabilă (de ex. click în aplicație lunar / acceptare tacită după un termen)? (c) factura se transmite în e-Factura de către noi, cu tipul de factură 389 (autofactură) — confirmați? (d) Oblio permite emiterea unor autofacturi (serie separată?) sau cum le emitem practic? (e) Care e termenul de transmitere în SPV? (f) Ce se întâmplă dacă agentul nu acceptă sau contestă o autofactură? Dacă răspunsul e NU sau „nu recomandăm”, voi construi alternativa: agentul încarcă el factura în aplicație, iar dumneavoastră o reconciliați din SPV.
18. Reconcilierea din SPV: dacă agenții își emit facturile ei, factura B2B ajunge oricum în SPV către Menuvia. Puteți să reconciliați lunar facturile agenților din SPV cu lista de comisioane pe care v-o dau eu (CSV)? Ce format vă ajută?
19. Agenți plătitori de TVA: dacă un agent e înregistrat în scopuri de TVA, factura lui include TVA (21%). Transferul către el trebuie să fie egal cu totalul facturii, dar noi am calcula doar comisionul. Recomandați să acceptăm la lansare DOAR agenți neplătitori de TVA (și să adăugăm cazul plătitorilor mai târziu)? Dacă îi acceptăm, ce bugetăm pentru TVA (dacă noi nu suntem plătitori, TVA-ul facturat de agent devine cost real)?
20. Persoane fizice neînregistrate: vrem să plătim DOAR PFA/SRL cu CUI (pe bază de factură/autofactură). Confirmați că, în acest caz, nu avem obligații de reținere la sursă și declarații de tipul D100 (impozit reținut) sau D205 (declarația informativă anuală) pentru aceste plăți? Dar dacă un agent PFA are sistem de normă de venit sau e microîntreprindere — contează pentru noi?
21. Agenți nerezidenți fiscali: pornim DOAR cu rezidenți fiscali din România. E corect că evităm astfel taxarea inversă și alte obligații?

E. STRIPE ȘI BANCĂ
22. Încasările de la clienți intră în contul Stripe al societății și Stripe le virează în contul bancar (noi vrem plăți lunare, nu zilnice, ca soldul Stripe să acopere comisioanele agenților). Cum se înregistrează contabil: încasarea, comisionul Stripe (factura de la Stripe Payments Europe — cum se tratează TVA: taxare inversă?), virarea către bancă?
23. Transferurile către agenți se fac din soldul Stripe al platformei, direct în conturile Stripe Express ale agenților (care se retrag apoi în banca lor). Contabil, cum se tratează aceste plăți (cheltuială cu comisioane, cu plata prin intermediar de plată)? Se schimbă ceva față de un virament bancar normal? Cine emite documentul justificativ (factura agentului / autofactura)?
24. Costul Stripe pentru conturile Express ale agenților (taxă lunară per cont activ + comision pe transfer) îl suportă Menuvia. Cum se înregistrează și se deduce?
25. Ce ne cereți pentru Stripe LIVE (CUI, certificat constatator, act constitutiv, extras de cont IBAN, buletinul asociatului)? Aș vrea ca dumneavoastră să aveți acces DOAR de citire în Stripe, cu notificare email la fiecare plată — e suficient pentru lucrul dumneavoastră lunar? Ce rapoarte vă trebuie lunar (export plăți, facturi emise, comisioane plătite)?

F. CONFORMITATE ȘI COSTURI
26. Alte obligații de care ar trebui să știm de la început: registrul de evidență (casa de marcat nu e necesară la plăți online prin Stripe? confirmați), raportări către ANAF, DAC7 (platforme digitale), ONRC (beneficiar real), GDPR/ANSPDCP. Dacă ceva nu se aplică, spuneți-ne în scris.
27. Estimarea costului ANUAL, defalcat: onorariu de înființare, onorariu lunar de contabilitate (în funcție de numărul de facturi/documente pe lună: ~0–20 / ~20–100 / peste 100), bilanț anual, depunerea declarațiilor, consultanță punctuală, sediu social, semnătura electronică (reînnoire). Ce NU e inclus în abonamentul lunar?
28. Termene: cât durează de la semnarea contractului cu dumneavoastră până avem CUI, cont bancar și acces SPV? Ce pași îmi revin mie și ce documente trebuie să vă dau?

Mulțumesc! Dacă e mai simplu, pot face o discuție de 30 de minute în [ZILE/ORE POSIBILE]. Pot semna actele la distanță, cu semnătura electronică calificată.

Cu stimă,
[NUME PRENUME]
[TELEFON] · [EMAIL]
```

## Notă pentru fondator: ce înseamnă răspunsurile (nu trimite această secțiune)

| Întrebare | Ce schimbă în produs / documente | Cine folosește răspunsul |
|---|---|---|
| 7–8 (TVA, prețuri finale) | Textul de pe pagina de prețuri și din Termeni; baza comisionului (D13, D4 din plan) | Pachetul 9 (Legal-final), `src/lib/pricingCopy.ts` |
| 11–14 (Oblio, facturi abonați) | Seria „MNV” și transmiterea în SPV; cine emite facturile abonaților până la 10 abonați (D12) | Config. Oblio; PR-12 (amânat) |
| 15–16 (baza comisionului) | O linie în calculul comisionului (`amount_paid` vs fără TVA) | Pachetul 13 |
| 17–18 (autofacturare) | **DA** → agenții nu mai încarcă factura (Menuvia o emite în numele lor); **NU** → rămâne fluxul „agentul încarcă factura” din PR-8 | Pachetul 13, contractul de agent (clauza de autofacturare, vezi `03-contract-agent-v1-draft.md`) |
| 19–21 (TVA agenți, persoane fizice, nerezidenți) | Cine are voie să se înscrie (la lansare: doar PFA/SRL cu CUI, neplătitori de TVA, rezidenți RO) | Contract, pachetul 8 (CUI obligatoriu) și 13 |
| 22–25 (Stripe, bancă) | Setările Stripe LIVE din Ședința 3; accesul contabilului | Ședința 3 |
| 27 (cost anual) | Intră în fișa de decizii (`04-fisa-decizii-D1-D15.md`) | Tu |

## Ce știm din cod și e bine să nu promiți contabilului din greșeală

- **Comisioanele, azi în cod** (`supabase/migrations/…293`, `…294`): comision pe TOATE planurile plătite (starter/growth/pro/enterprise); setup 30% pe baza PRIMEI facturi plătite, dar **scris abia la a doua factură plătită** (hold 60 zile); recurent 10% pe 12 facturi (hold 14 zile); baza = `amount_paid` al facturii Stripe. La refund/dispută pierdută comisionul se retrage proporțional.
- **Pragul minim de plată în cod azi: 50 lei** (`p_min_cents default 5000`, mig 294). Planul spune 45 lei, ținut în baza de date: e o schimbare din pachetul 13; până atunci e 50.
- **Plata automată prin Stripe NU există încă** (pachetul 13). Azi plata e manuală, iar `legal_form` acceptă încă și „other” (scos în pachetul 13/8).
- **Facturile Menuvia către abonați**: nimic din cod nu le emite (PR-12 amânat până la ≥10 abonați sau până o cere contabilul).
