# Demo: site pentru agenții imobiliare

Un singur fișier, `index.html`. Nu cere instalare, cont sau server. Se deschide pe telefon sau pe laptop și arată unei agenții, în 5 minute, cum ar arăta site-ul ei dacă n-ar mai pierde nicio cerere.

Agenția din demo („Agenție Imobiliară”), anunțurile și prețurile sunt fictive. Prețurile pe zone sunt orientative, calibrate pe medianele publice din octombrie 2026 (București ≈ 2.190 €/mp, Cluj ≈ 3.500 €/mp).

## Ce problemă rezolvă fiecare bucată

| Problema agenției | Ce arată demo-ul | Ce vinzi de fapt |
|---|---|---|
| Cereri pierdute seara și în weekend. Cine răspunde primul ia clientul | Asistent 24/7 care răspunde pe loc și cere numărul | Asistent pe site + WhatsApp |
| Clientul nu știe să folosească filtrele | Căutare în limbaj liber („2 camere lângă metrou sub 210.000 €”) cu „Am înțeles: …” | Căutare inteligentă |
| Greu de obținut proprietăți în exclusivitate | Evaluator „Cât valorează locuința ta”: preț pe loc, apoi cererea de evaluare la fața locului | Magnet de proprietari (cea mai valoroasă cerere) |
| Telefoane dus-întors pentru programări, vizionări ratate | Programare din calendar + întrebarea „cum plătești” + reminder | Programări automate + calificare |
| „Vă sun când apare ceva” și apoi uităm | Alertă: „afli primul, înainte de portaluri” | Listă de cumpărători care se reactivează singură |
| Agentul află târziu și fără context | Notificarea „Cerere nouă” + panoul agentului cu tot contextul | Notificări + CRM simplu |
| Patronul nu vede ce aduce site-ul | Contoare: cereri azi, vizionări, comision potențial | Raport de rezultate |

## Cele trei moduri (bara de sus)

- **Site**: ce vede clientul agenției.
- **Panoul agentului**: cererile intră în timp real, cu ce s-a făcut automat (mesaj WhatsApp pregătit, reminder, etichetă CRM).
- **Mod prezentare**: telefonul cu site-ul în stânga, panoul agentului în dreapta. Pentru share-screen pe Zoom/Meet sau pentru laptop la o întâlnire. Completezi o cerere în telefon și cererea apare în dreapta în aceeași secundă.

Funcționează și pe telefonul prospectului, fără share-screen: după orice formular trimis apare notificarea „Așa primește agentul fiecare cerere”, cu buton spre panou.

## Personalizare în 10 secunde

Butonul **Personalizează** din bara de sus: numele agenției pe care o suni, orașul (București, Cluj-Napoca, Timișoara, Iași, Brașov), culoarea, telefonul și numele agentului. Anunțurile, zonele, prețurile, harta și exemplele se schimbă după oraș. Setarea se păstrează în browserul tău.

După ce publici pagina, poți trimite direct un link personalizat (îl copiezi tot din „Personalizează”):

```
https://demo-ul-tau.netlify.app/?agentie=Imobiliare%20Popescu&oras=cluj&culoare=bleumarin
```

Culori: `brad`, `bleumarin`, `bordo`, `grafit`, `petrol`.

## Înainte de primul apel

1. Deschide `index.html` și schimbă `const STUDIO = 'Studio Automatizări'` cu numele agenției tale. Apare discret în subsol: „Realizat de …”.
2. Publică pagina, ca să ai un link de trimis pe WhatsApp. Cel mai simplu: intri pe app.netlify.com/drop și tragi folderul acesta. Primești un link `ceva.netlify.app`, pe care îl poți redenumi.
3. Opțional, pentru efectul cel mai puternic: notificare **reală** pe telefonul tău. Instalezi aplicația gratuită ntfy, te abonezi la un topic inventat (lung, greu de ghicit, de ex. `agentie-demo-7f3k9q2`) și pui același nume în `const NTFY_TOPIC = ''`. Când prospectul trimite un formular, telefonul tău sună în timp ce sunteți la telefon. Ce scrie prospectul pleacă la serverul ntfy.sh, deci cere-i să folosească date de test.
4. Apasă o dată **Golește cererile de test** din panoul agentului, ca să pornești curat.

## Scenariul de 5 minute

1. **Deschiderea (30 s).** „Am pregătit un site demonstrativ pentru agenții din [oraș]. Vă trimit linkul pe WhatsApp, îl deschideți cât vorbim?” Cererea e mică, iar el face primul pas.
2. **Căutarea (60 s).** Îl rogi să scrie ce ar scrie un client, cu cuvintele lui. Momentul WOW e bara „Am înțeles: 2 camere · sub 210.000 € · lângă metrou”.
3. **Proprietarul (60 s).** „Vindeți și proprietăți în exclusivitate? Apăsați pe Evaluare.” În 30 de secunde vede un interval de preț. „Fiecare proprietar care face asta e o cerere de mandat.”
4. **Cererea care nu se pierde (60 s).** Îl rogi să programeze o vizionare cu numele lui. Apare notificarea. „Asta ar primi agentul dvs., cu tot ce trebuie, inclusiv dacă clientul are credit aprobat.”
5. **Panoul (60 s).** Panoul agentului, apoi „Mesaj WhatsApp”: mesajul e deja scris. Apoi contorul „comision potențial”.
6. **Întrebarea de diagnostic.** „Acum, la dvs., ce se întâmplă cu un mesaj primit sâmbătă la 22:00?” Lasă-l să răspundă. Răspunsul lui e argumentul tău.

## Scriptul apelului

> „Bună ziua, sunt [nume]. Lucrez cu agenții imobiliare pe partea de cereri care se pierd: mesaje fără răspuns seara, proprietari care cer o evaluare și nu-i sună nimeni. Am făcut un demo pentru agenții din [oraș] și aș vrea să vi-l arăt în 5 minute. Aveți acum 5 minute sau vă sun la o oră mai bună?”

Dacă spune da: trimiți linkul și urmezi scenariul de mai sus. Dacă spune „trimiteți-mi pe mail”: „Sigur. E un site pe care îl încercați pe telefon, durează 3 minute. Vi-l trimit pe WhatsApp și vă sun mâine la 11 să vă spun ce să apăsați. Vă convine?”

Închiderea, după demo:

> „Pot să-l fac pe numele și cu anunțurile dvs. reale în 7 zile. Primele 30 de zile le facem ca pilot: dacă nu vă aduce cereri noi, nu continuăm. Pornim?”

### Obiecții frecvente

- **„Avem deja site.”** „Perfect. Întrebarea nu e dacă aveți site, ci ce se întâmplă cu o cerere primită la 22:00. Pot conecta asistentul și notificările la site-ul existent.”
- **„Clienții vin de pe imobiliare.ro / Storia.”** „Exact. Acolo sunteți lângă alți 50 de agenți. Alerta și evaluatorul aduc clienți care sunt doar ai dvs.”
- **„E scump.”** „Un singur mandat de exclusivitate în plus pe lună acoperă abonamentul pe un an. Câte evaluări cerute online ați primit luna trecută?”
- **„Nu am timp acum.”** „Tocmai de asta: totul merge singur. Dvs. doar primiți cererea pe telefon.”

## Oferta (ipoteză de testat pe primele 10 apeluri)

- **Setup:** site personalizat + asistent + notificări + evaluator, între 2.500 și 5.000 lei, o singură dată.
- **Abonament:** 300–600 lei/lună pentru găzduire, mentenanță, automatizări și raport lunar.
- **Pilot 30 de zile:** reduce riscul perceput. Măsoară cererile primite, ca discuția de continuare să pornească de la cifre.

Notează după fiecare apel ce obiecție a apărut și la ce preț s-a oprit discuția. După 10 apeluri ai prețul real.

## Ce e simulat și ce e real

- **Asistentul** e pe reguli locale, fără AI și fără costuri. Înțelege camere, buget, zonă, transport, parcare, închiriere vs. vânzare, rata, vizionări, evaluări și cererea de apel. Varianta vândută poate folosi un AI real.
- **Mesajele WhatsApp, reminderele și CRM-ul** sunt arătate, nu trimise. Pagina o spune explicit, sub fiecare formular. Butonul „Deschide în WhatsApp” din panou deschide totuși WhatsApp cu mesajul pregătit, pentru numerele introduse de tine.
- **Fotografiile** vin de pe Unsplash (licență gratuită). Fără internet apare o ilustrație în locul lor.
- **Datele** rămân doar în browserul în care completezi (localStorage). Nimic nu pleacă nicăieri, cu excepția ntfy, dacă îl activezi.

## Când vinzi varianta reală

- Pentru notificări automate pe WhatsApp: WhatsApp Business API, printr-un furnizor sau prin Make/n8n.
- Politică de confidențialitate și bifă de acord pe formulare (GDPR). Agenția e operatorul datelor, tu ești persoana împuternicită, deci ai nevoie de un contract de prelucrare.
- Fotografiile și logo-ul agenției le folosești doar cu acordul ei. Demo-ul are `noindex`, ca să nu apară în Google.
