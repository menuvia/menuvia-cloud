# Politica de Confidențialitate — Menuvia

> **⚠️ DRAFT pentru aviz avocat — NU e valabil juridic până la completarea entității și avizare.**
> Acest document este o versiune de lucru. Operatorul de date este **[MENUVIA S.R.L. — în curs de constituire, CUI: ___, sediu: ___]**. Toate mențiunile despre entitate, adresele de contact și duratele marcate „[de confirmat]" trebuie completate și avizate de un consultant juridic specializat înainte de publicare.

**Versiunea:** DRAFT v1.0 · **Data ultimei actualizări:** [___]
**Document întocmit în conformitate cu:** Regulamentul (UE) 2016/679 („GDPR", art. 13 și 14), Legea nr. 190/2018 privind măsuri de punere în aplicare a GDPR, Legea nr. 506/2004 privind prelucrarea datelor cu caracter personal în sectorul comunicațiilor electronice și, unde este cazul, OUG nr. 34/2014 privind drepturile consumatorilor.

---

## 1. Cine suntem și cum ne contactați

Platforma **Menuvia** (disponibilă la `menuvia.netlify.app`, în curând `menuvia.ro`, denumită în continuare „Platforma") este un serviciu software de tip SaaS pentru restaurante și cafenele din România, care oferă: meniu digital accesibil prin cod QR, preluare de comenzi la masă și pentru ridicare (pickup), rezervări de mese, program de fidelizare (loyalty), notificări prin e-mail și SMS, plăți online la masă și integrare cu sisteme de facturare și fiscalizare.

**Operator de date (în sensul art. 4 pct. 7 GDPR), pentru prelucrările descrise la secțiunea 3:**
**[MENUVIA S.R.L. — în curs de constituire, CUI: ___, sediu: ___]** (denumită în continuare „Menuvia", „noi").

**Contact pentru protecția datelor:**
- E-mail dedicat: **privacy@menuvia.ro** *(adresă pe domeniul viitor; până la activarea domeniului, folosiți alternativ **contact@menuvia.ro**)*
- Adresă poștală: **[sediu: ___]**

Nu am desemnat un responsabil cu protecția datelor (DPO), deoarece nu ne aflăm, la acest moment, în situațiile prevăzute de art. 37 GDPR. **[De confirmat cu avocatul la momentul avizării.]**

---

## 2. Rolurile noastre: operator vs. persoană împuternicită

Este important să înțelegeți că Menuvia acționează în **două calități diferite**, în funcție de datele prelucrate:

| Calitate | Pentru ce date | Cine răspunde față de dvs. |
|---|---|---|
| **Operator** (art. 4 pct. 7 GDPR) | Datele reprezentanților și personalului restaurantelor (conturi, facturare abonament), datele lead-urilor de pe paginile /recrutare și Codvia, datele afiliaților, datele vizitatorilor site-ului (cookie-uri, analytics) | Menuvia direct |
| **Persoană împuternicită** (art. 4 pct. 8 GDPR) | Datele **clienților finali ai restaurantelor** (rezervări, comenzi, loyalty, SMS-uri, plăți la masă) — prelucrate **în numele și pe seama restaurantului** la care ați făcut rezervarea/comanda | **Restaurantul** este operatorul; Menuvia prelucrează conform instrucțiunilor lui, în baza unui Acord de Prelucrare a Datelor (DPA, art. 28 GDPR) |

Dacă sunteți **client al unui restaurant** care folosește Menuvia, vă puteți exercita drepturile GDPR atât direct la restaurant (operatorul), cât și prin noi — vom transmite cererea restaurantului și îl vom asista în soluționare (vezi secțiunea 8). Prezenta politică vă este furnizată inclusiv în temeiul art. 14 GDPR, în măsura în care unele date ne parvin prin restaurant.

---

## 3. Ce date prelucrăm, în ce scop, pe ce temei și cât timp

### 3.1. Reprezentanții și personalul restaurantelor (clienți B2B)

Dacă vă creați un cont Menuvia (proprietar de restaurant, manager, ospătar, personal bucătărie):

| Date | Scop | Temei juridic | Durată |
|---|---|---|---|
| Adresă e-mail, parolă (stocată exclusiv criptografic — hash, prin sistemul de autentificare Supabase; nu avem acces la parola în clar), nume afișat | Crearea și administrarea contului, autentificare, recuperare parolă | Art. 6 (1) (b) GDPR — executarea contractului | Pe durata contului; ștergere la cererea dvs. (vezi 3.1.1) |
| Factor secundar de autentificare (TOTP/MFA), nivel de asigurare al sesiunii | Securitatea contului (opțională; obligatorie pentru administratorii platformei) | Art. 6 (1) (f) — interes legitim (securitate) | Pe durata contului |
| Rol în restaurant (owner/manager/ospătar/bucătărie), restaurantele la care aveți acces | Controlul accesului (autorizare) | Art. 6 (1) (b) | Pe durata calității de membru |
| Data și versiunea acceptării Termenilor și Condițiilor (`terms_accepted_at`, `terms_accepted_version`) | Dovada acceptării contractului (audit) | Art. 6 (1) (c) și (f) — obligație legală / interes legitim (probă) | Pe durata contului + termenul general de prescripție **[3 ani — de confirmat]** |
| Date de facturare abonament: plan ales, istoric plăți, identificator client Stripe; datele cardului sunt colectate și stocate **exclusiv de Stripe** — Menuvia nu vede și nu stochează numărul cardului | Facturarea abonamentului (planuri: gratuit / 99 / 249 / 499 lei/lună), gestionarea neplăților (e-mailuri de atenționare la eșec de plată și de confirmare la recuperare) | Art. 6 (1) (b) și (c) | Pe durata contractului; documentele fiscale — 10 ani (vezi 3.5) |
| Facturi fiscale emise pentru abonament (prin Oblio): denumire firmă, CUI, seria/numărul, valoare | Obligații fiscale și contabile | Art. 6 (1) (c) — Legea contabilității nr. 82/1991 | **10 ani** (vezi 3.5) |
| Jurnal de audit al acțiunilor în cont (modificări comenzi, plăți înregistrate etc.) | Securitate, trasabilitate, soluționarea disputelor | Art. 6 (1) (f) | Pe durata contului **[+ perioadă de arhivare — de confirmat]** |
| Evenimente de produs (ex. „comandă plasată", „abonament pornit"), asociate contului **doar dacă** ați consimțit la cookie-urile de performanță | Îmbunătățirea produsului (analytics PostHog) | Art. 6 (1) (a) — consimțământ | Până la retragerea consimțământului; la revocare, identitatea de analytics se șterge |

#### 3.1.1. Ștergerea contului
Puteți solicita ștergerea contului direct din aplicație sau prin e-mail. Ștergerea elimină datele personale ale contului (profil, e-mail, restaurante deținute), **cu excepția** datelor pe care avem obligația legală să le păstrăm: facturile fiscale emise supraviețuiesc într-o arhivă separată, **anonimizată pentru persoanele fizice** (vezi 3.5).

### 3.2. Clienții finali ai restaurantelor (rezervări, comenzi, loyalty)

Pentru aceste date, **operatorul este restaurantul** la care ați făcut rezervarea sau comanda; Menuvia acționează ca persoană împuternicită. Duratele finale de păstrare sunt stabilite de restaurant prin DPA; mai jos indicăm comportamentul implicit al Platformei.

**a) Meniul digital (scanarea codului QR)** — simpla consultare a meniului **nu necesită cont și nu colectează date personale**. Nu se încarcă instrumente de analiză sau de raportare a erorilor fără consimțământul dvs. explicit (vezi secțiunea 6).

**b) Comenzi la masă / pickup**

| Date | Scop | Temei (al restaurantului) | Observații |
|---|---|---|---|
| Conținutul comenzii, numărul mesei / sesiunea de masă, notele lăsate de dvs. | Preluarea și onorarea comenzii | Art. 6 (1) (b) | Comanda QR necesită o sesiune activă de masă; nu vă cerem numele |
| Număr de telefon (opțional, la comenzile pickup) | Notificare prin SMS când comanda e gata („comanda dvs. e gata de ridicare") | Art. 6 (1) (b) | SMS trimis prin SMSO.ro doar către numere mobile din România, doar dacă restaurantul are modulul SMS activ |

**c) Rezervări de mese**

| Date | Scop | Temei (al restaurantului) | Observații |
|---|---|---|---|
| Nume, **număr de telefon (stocat în clar)**, e-mail (opțional), numărul de persoane, data/ora, preferințe (masă, note) | Gestionarea rezervării, confirmare, memento (reminder) prin e-mail sau SMS | Art. 6 (1) (b) | Telefonul este necesar în clar pentru ca restaurantul să vă poată contacta și pentru trimiterea confirmării/memento-ului |
| Evidența neprezentărilor (no-show), calculată pe **ultimele 9 cifre ale numărului de telefon** | Protejarea restaurantului împotriva rezervărilor abandonate repetat | Art. 6 (1) (f) — interes legitim al restaurantului | Marcarea automată a neprezentării se aplică doar rezervărilor confirmate, într-o fereastră de 48 de ore |
| Limitare de frecvență (rate-limit) pe numărul de telefon | Prevenirea abuzurilor (rezervări automate/spam) | Art. 6 (1) (f) | |

**d) Program de fidelizare (loyalty)**

Dacă alegeți să participați la programul de fidelizare al unui restaurant, furnizați numărul de telefon ca identificator. **Important — cum protejăm numărul:** numărul dvs. de telefon **nu se stochează în clar** în evidența de puncte. Platforma îl normalizează (formatele +40 / 0040 / 07xx sunt aduse la aceeași formă) și stochează exclusiv o **amprentă criptografică (hash MD5) a numărului normalizat**. Punctele se acordă și se verifică prin compararea amprentelor, astfel încât evidența de fidelizare nu conține numere de telefon lizibile. *(Notă de transparență: hash-ul unui număr de telefon este considerat, în sens GDPR, tot dată pseudonimizată — nu anonimă — motiv pentru care îl tratăm ca dată personală și îl includem în cererile de acces/ștergere.)*

**e) Plata online la masă (doar restaurantele pe planurile cu fiscalizare)**

Plata cu cardul la masă se procesează prin **Stripe Connect**: banii ajung direct în contul Stripe al restaurantului. Datele cardului sunt colectate exclusiv de Stripe, în pagina/elementele Stripe — Menuvia nu vede și nu stochează numărul cardului. Platforma reține doar starea plății (inițiată/reușită/anulată), suma și asocierea cu comanda, în scop de reconciliere și anti-dublă-încasare. Bonul fiscal se emite local, la casa de marcat a restaurantului (FiscalNet/EconMedia).

**f) Feedback și bacșiș (tips)** — dacă lăsați feedback sau bacșiș prin Platformă, se rețin conținutul feedback-ului și valoarea bacșișului, asociate comenzii.

### 3.3. Lead-uri de pe pagina /recrutare și comenzile Codvia

Dacă completați formularul de contact de pe pagina de recrutare parteneri sau plasați o comandă de materiale Codvia (ex. suporturi QR pre-tipărite), Menuvia este **operator** și prelucrează:

| Date | Sursă | Scop | Temei | Durată |
|---|---|---|---|---|
| Nume, denumirea localului, oraș, telefon, e-mail, mesaj | Formular /recrutare | Contactarea dvs. pentru prezentarea serviciului (demo), la cererea dvs. | Art. 6 (1) (b) — demersuri precontractuale la cererea persoanei vizate | **[12 luni de la ultimul contact — de confirmat cu avocatul]**; lead-urile marcate spam se șterg |
| Nume, telefon, e-mail, **adresa de livrare**, produsul comandat | Formular comandă Codvia | Onorarea comenzii de materiale (confirmare telefonică, livrare, plată ramburs/transfer) | Art. 6 (1) (b) | Pe durata onorării comenzii + documentele contabile aferente 10 ani (3.5) |
| Adresă IP, identificator de browser (user-agent) | Colectate automat la trimitere | Prevenirea abuzului (limitare la maximum 5 trimiteri/oră per IP), securitate | Art. 6 (1) (f) — interes legitim | Împreună cu lead-ul |
| Notițe interne de urmărire (status: nou/contactat/demo/convertit/respins) | Create de noi | Organizarea procesului de vânzare | Art. 6 (1) (f) | Împreună cu lead-ul |

Datele din aceste formulare ne sunt transmise și pe e-mail (prin Resend) către fondator, pentru procesare operativă.

### 3.4. Afiliați și vizitatori veniți prin link de afiliat

**a) Candidați și afiliați (program de recomandare):** la înscriere colectăm nume, e-mail, **telefon (obligatoriu)** și nota de aplicare; cererea este aprobată sau respinsă manual. Pentru afiliații activi prelucrăm evidența atribuirilor, a comisioanelor și datele necesare plății comisioanelor (inclusiv identificatorul transferului Wise). Temei: art. 6 (1) (b) — contractul de afiliere; documentele financiare — art. 6 (1) (c), 10 ani. Datele fiecărui afiliat îi sunt vizibile **doar lui** (nu și afiliaților „părinte" din rețea).

**b) Vizitatori veniți printr-un link de afiliat (`/r/cod`):** setăm două cookie-uri **funcționale** (nu de publicitate):
- `mv_ref` — codul afiliatului care v-a recomandat; valabil **90 de zile**;
- `mv_vid` — un identificator aleatoriu de vizitator (UUID), folosit exclusiv pentru a corela vizita pe linkul de afiliat cu o eventuală achiziție ulterioară (validarea atribuirii comisionului).

Temei: art. 6 (1) (f) — interesul legitim de a atribui corect comisioanele; aceste cookie-uri sunt strict necesare fluxului de afiliere și nu urmăresc navigarea dvs. în alte scopuri. Detalii complete în **Politica de Cookies**.

### 3.5. Retenția documentelor fiscale — 10 ani (excepție de la dreptul la ștergere)

Conform **Legii contabilității nr. 82/1991**, documentele financiar-contabile (facturile fiscale emise) se păstrează **10 ani**. Această obligație legală **prevalează** asupra dreptului la ștergere (art. 17 alin. (3) lit. (b) GDPR).

Cum am implementat concret acest echilibru: la ștergerea unui cont, datele personale se șterg, iar facturile emise sunt copiate într-o arhivă fiscală separată care reține **exclusiv câmpurile fiscale** (serie, număr, total, TVA, moneda, data emiterii, CUI-ul firmei — dată de business, nu personală). Pentru clienții persoane fizice, numele, e-mailul și telefonul **nu se păstrează** în arhivă — înregistrarea este marcată „[persoană fizică anonimizată]".

---

## 4. Destinatari și subprocesatori

Nu vindem și nu închiriem date personale. Datele sunt accesate doar de personalul autorizat și de următorii furnizori (persoane împuternicite / subîmputernicite), fiecare strict pentru rolul indicat:

| Furnizor | Rol | Ce date atinge | Sediu / transfer în afara SEE |
|---|---|---|---|
| **Supabase** | Baza de date, autentificare, API | Toate datele Platformei (găzduire) | Proiect găzduit în regiune UE **[regiunea exactă: ___ — de confirmat]**; entitatea Supabase Inc. este din SUA — garanții: clauze contractuale standard (SCC) **[de verificat DPA Supabase]** |
| **Netlify** | Găzduire site + funcții serverless (API-uri de plată, e-mail, SMS, cron) | Datele care tranzitează funcțiile (comenzi, lead-uri, plăți) | SUA — SCC / EU-U.S. Data Privacy Framework **[de verificat]** |
| **Stripe** | Plata abonamentelor Menuvia + Stripe Connect pentru plățile la masă ale restaurantelor | Date de plată (colectate direct de Stripe), identificatori de client | Stripe Payments Europe Ltd. (Irlanda); transferuri intra-grup către SUA cu SCC/DPF |
| **Resend** | Trimitere e-mail tranzacțional (confirmări rezervare, memento-uri, notificări de plată, lead-uri) | Adrese e-mail, conținutul mesajelor | SUA — SCC **[de verificat]** |
| **SMSO.ro** | Trimitere SMS tranzacțional (confirmare rezervare, memento, „comanda e gata") | Numere de telefon mobile RO, textul SMS-ului | România (SEE) |
| **OpenAI** (prin proxy-ul propriu al Platformei) | Funcții AI pentru restaurante: import de meniu din fotografii/fișiere, generare descrieri de produse | **Doar conținutul meniului** (denumiri de produse, prețuri, descrieri) — **nu date personale ale clienților finali** | SUA — SCC/DPF **[de verificat]** |
| **Sentry** | Raportarea erorilor tehnice ale aplicației | Rapoarte de eroare tehnice; **activat exclusiv cu consimțământul dvs.** pentru cookie-uri de performanță; configurat să nu trimită IP, cookie-uri sau anteturi de autentificare, iar adresele URL sunt curățate de parametri | SUA — SCC/DPF **[de verificat]** |
| **PostHog** | Statistici de utilizare a produsului | Evenimente de utilizare; **activat exclusiv cu consimțământul** pentru cookie-uri de performanță; găzduire **PostHog Cloud EU**, fără transmiterea adresei IP, fără înregistrare de sesiune, persistență fără cookie-uri | SEE (cloud UE) |
| **Oblio** | Emiterea facturilor fiscale (pentru abonamente și, ca serviciu, pentru restaurante) | Date de facturare (denumire, CUI, valori) | România (SEE) |
| **FiscalNet / EconMedia** | Emiterea bonului fiscal la casa de marcat a restaurantului | Date de bon (produse, valori, metoda de plată) — rulează **local**, la restaurant | România (SEE) |
| **Wise** | Plata comisioanelor către afiliați | Date de plată ale afiliaților | **[entitate/transfer — de confirmat]** |

Alte categorii de destinatari: autorități publice (ANAF, ANSPDCP, instanțe) — doar la cerere legală; consultanți profesionali (contabil, avocat) — sub obligație de confidențialitate.

Restaurantele-client primesc lista actualizată a subprocesatorilor prin DPA; modificările listei se notifică conform DPA.

---

## 5. Transferuri în afara Spațiului Economic European

Ca regulă, datele sunt stocate în SEE. Transferuri către SUA pot avea loc pentru: **Sentry** și **PostHog-fallback nu** *(PostHog folosește cloud-ul UE)*, **Sentry** (doar cu consimțământ, cu date minimizate), **OpenAI** (doar conținut de meniu, nu date personale ale clienților finali), **Netlify**, **Resend**, **Stripe** (intra-grup) și, după caz, **Supabase Inc.** (suport/administrare). Pentru fiecare, ne bazăm pe: decizia de adecvare **EU-U.S. Data Privacy Framework** (unde furnizorul e certificat) și/sau **Clauzele Contractuale Standard** (art. 46 (2) (c) GDPR), cu măsuri suplimentare de minimizare descrise mai sus. **[Lista certificărilor DPF ale fiecărui furnizor — de verificat la data avizării.]** Puteți solicita o copie a garanțiilor la privacy@menuvia.ro.

---

## 6. Cookie-uri, stocare locală și instrumente de măsurare

Folosim un mecanism de consimțământ pe trei categorii (banner-ul de cookie-uri, reafișabil oricând din „Setări cookies" în subsolul paginii):

- **Strict necesare** (nu necesită consimțământ): sesiunea de autentificare (Supabase), preferința de consimțământ (`menuvia_cookie_consent`, în localStorage, cu data alegerii), cookie-urile funcționale de afiliere `mv_ref` (90 zile) și `mv_vid` (vezi 3.4 b), cheia de idempotență a comenzii QR (previne dublarea comenzii la reîncărcarea paginii).
- **Performanță** (doar cu consimțământ): PostHog (statistici produs, fără IP, fără cookie-uri — persistență în localStorage) și Sentry (raportare erori, cu filtrarea datelor sensibile). **Niciun script de măsurare nu se încarcă înainte de acordul dvs.**; retragerea acordului oprește colectarea și șterge identitatea de analytics.
- **Funcționale** (doar cu consimțământ): preferințe de interfață.

Respectăm semnalul „Do Not Track" al browserului pentru analytics. Detalii complete, pe durate și denumiri: **Politica de Cookies**.

---

## 7. Cât timp păstrăm datele — recapitulare

| Categorie | Durată |
|---|---|
| Cont B2B și date de profil | Pe durata contului; ștergere la cerere (cu excepțiile legale) |
| Facturi fiscale (abonamente, Codvia) | **10 ani** — Legea 82/1991 (arhivă anonimizată pentru persoane fizice) |
| Dovada acceptării Termenilor | Durata contului + prescripție **[de confirmat]** |
| Rezervări, comenzi, loyalty (date ale clienților finali) | Conform instrucțiunilor restaurantului-operator (DPA); la încetarea contractului restaurantului, datele se șterg sau se returnează conform DPA |
| Lead-uri /recrutare | **[12 luni de la ultimul contact — de confirmat]** |
| Comenzi Codvia | Onorarea comenzii + obligații contabile (10 ani pentru documente) |
| Cookie afiliere `mv_ref` | 90 de zile |
| Consimțământ cookie-uri | Până la modificarea alegerii de către dvs. |
| Jurnale de audit și securitate | **[durată — de confirmat]** |

---

## 8. Drepturile dumneavoastră

În temeiul GDPR, aveți următoarele drepturi:

1. **Dreptul de acces** (art. 15) — să aflați ce date prelucrăm despre dvs. și să primiți o copie;
2. **Dreptul la rectificare** (art. 16) — corectarea datelor inexacte;
3. **Dreptul la ștergere** („dreptul de a fi uitat", art. 17) — cu excepțiile legale (ex. retenția fiscală de 10 ani, secțiunea 3.5);
4. **Dreptul la restricționarea prelucrării** (art. 18);
5. **Dreptul la portabilitatea datelor** (art. 20) — pentru datele prelucrate pe temei de contract sau consimțământ;
6. **Dreptul la opoziție** (art. 21) — față de prelucrările întemeiate pe interes legitim;
7. **Dreptul de a vă retrage consimțământul** oricând (art. 7 (3)) — de ex. din banner-ul de cookie-uri — fără a afecta legalitatea prelucrării anterioare;
8. **Dreptul de a nu face obiectul unei decizii bazate exclusiv pe prelucrare automată** cu efecte juridice (art. 22) — Platforma nu ia astfel de decizii; marcarea automată a neprezentării la rezervări este o evidență operațională a restaurantului, nu o decizie cu efect juridic asupra dvs., și poate fi contestată la restaurant;
9. **Dreptul de a depune plângere** la autoritatea de supraveghere.

**Cum le exercitați:**
- prin e-mail la **privacy@menuvia.ro** *(până la activarea domeniului menuvia.ro, scrieți alternativ la **contact@menuvia.ro**)*;
- pentru titularii de cont: ștergerea contului se poate solicita direct din aplicație (Setări → Cont);
- dacă sunteți **client final al unui restaurant**, vă recomandăm să vă adresați întâi restaurantului (operatorul datelor dvs.); puteți însă trimite cererea și către noi — o vom redirecționa restaurantului și îl vom asista tehnic în soluționare (căutarea în rezervări/loyalty se poate face inclusiv după numărul de telefon).

Răspundem în cel mult **o lună** (prelungibil cu două luni pentru cereri complexe, cu informarea dvs.). Pentru verificarea identității vă putem cere informații suplimentare rezonabile. Cererile sunt gratuite, cu excepția celor vădit nefondate sau excesive (art. 12 (5) GDPR).

**Autoritatea de supraveghere:** Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP) — B-dul G-ral Gheorghe Magheru 28-30, Sector 1, București — [www.dataprotection.ro](https://www.dataprotection.ro).

---

## 9. Securitatea datelor

Aplicăm măsuri tehnice și organizatorice adecvate (art. 32 GDPR), printre care:

- criptarea datelor în tranzit (TLS/HTTPS) și izolarea datelor fiecărui restaurant la nivel de bază de date (politici Row Level Security, aplicate server-side, nu doar în interfață);
- parole stocate exclusiv sub formă de hash; autentificare cu doi factori (TOTP) disponibilă pentru toate conturile și **impusă** administratorilor platformei;
- principiul privilegiului minim: personalul restaurantului vede doar datele restaurantului său, în limita rolului; funcțiile sensibile sunt accesibile doar prin proceduri server-side dedicate, cu jurnalizare de audit;
- minimizarea datelor prin proiectare: telefonul din programul loyalty se stochează doar ca amprentă criptografică; meniul public nu expune date sensibile (ex. parole Wi-Fi); instrumentele de măsurare nu se încarcă fără consimțământ și nu transmit IP-ul;
- proceduri de notificare a încălcărilor de securitate: notificăm ANSPDCP în 72 de ore și persoanele vizate conform art. 33–34 GDPR; restaurantele-operator sunt notificate conform DPA.

---

## 10. Datele minorilor

Platforma se adresează profesioniștilor (B2B) și publicului general al restaurantelor. Nu ne adresăm intenționat minorilor sub 16 ani și nu le solicităm date. Un minor poate consulta meniul digital fără a furniza date personale.

---

## 11. Modificări ale acestei politici

Putem actualiza periodic această politică (ex. la adăugarea unui subprocesator sau a unei funcționalități). Versiunea curentă și data actualizării sunt afișate în antet. Pentru modificări semnificative, titularii de cont vor fi notificați prin e-mail sau în aplicație, iar restaurantele-operator conform DPA.

---

## 12. Documente conexe

- **Termeni și Condiții** — relația contractuală B2B;
- **Politica de Cookies** — lista completă a cookie-urilor și tehnologiilor similare;
- **Acordul de Prelucrare a Datelor (DPA)** — anexa art. 28 GDPR pentru restaurantele-client.

---

> **⚠️ REAMINTIRE DRAFT:** Documentul de mai sus este un proiect de lucru. Înainte de publicare trebuie: (1) completată identitatea operatorului **[MENUVIA S.R.L. — în curs de constituire, CUI: ___, sediu: ___]**; (2) confirmate toate duratele și mențiunile marcate „[de confirmat]"; (3) verificate certificările DPF/SCC ale fiecărui furnizor la zi; (4) obținut avizul consultantului juridic specializat în protecția datelor.
