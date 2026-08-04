# ACORD DE PRELUCRARE A DATELOR CU CARACTER PERSONAL (DPA)

> **⚠️ DRAFT pentru aviz avocat — NU este valabil juridic până la completarea entității operatoare și avizare.**
> Toate mențiunile `[MENUVIA S.R.L. — în curs de constituire, CUI: ___, sediu: ___]` sunt placeholder și trebuie înlocuite cu datele reale ale societății după constituire. Documentul trebuie revizuit de un avocat specializat în protecția datelor înainte de utilizare.

**încheiat în temeiul art. 28 din Regulamentul (UE) 2016/679 („GDPR") și al Legii nr. 190/2018**

Versiunea: DRAFT v0.1 — [data] · Documentul face parte integrantă din Termenii și Condițiile serviciului Menuvia și se aplică automat oricărui restaurant care utilizează platforma.

---

## 1. Părțile

**1.1. Operatorul de date** („**Operatorul**" / „**Restaurantul**"):
Entitatea juridică (restaurant, cafenea, bar sau alt local HoReCa) care își creează cont pe platforma Menuvia și acceptă Termenii și Condițiile, identificată prin datele de facturare completate în contul său. Restaurantul determină scopurile și mijloacele prelucrării datelor clienților săi finali.

**1.2. Persoana împuternicită de operator** („**Persoana împuternicită**" / „**Menuvia**"):
`[MENUVIA S.R.L. — în curs de constituire, CUI: ___, sediu: ___]`, furnizorul platformei SaaS Menuvia (meniu digital QR, comenzi la masă și pickup, rezervări, program de fidelitate, notificări tranzacționale, fiscalizare), disponibilă la adresa menuvia.netlify.app (urmând menuvia.ro) și pe domeniile white-label ale partenerilor.

**1.3.** Prezentul Acord („**DPA**") reglementează prelucrarea de către Menuvia, în numele și pe seama Restaurantului, a datelor cu caracter personal ale **clienților finali** ai Restaurantului. Pentru datele contului Restaurantului însuși (utilizatori staff, date de facturare a abonamentului, date de afiliere), Menuvia acționează ca **operator independent**, conform Politicii de confidențialitate Menuvia — acele prelucrări nu fac obiectul prezentului DPA.

---

## 2. Definiții

Termenii „date cu caracter personal", „prelucrare", „operator", „persoană împuternicită", „persoană vizată", „încălcare a securității datelor" au înțelesul din art. 4 GDPR. „**Subprocesator**" înseamnă orice persoană împuternicită ulterioară angajată de Menuvia pentru prelucrări în numele Restaurantului. „**Platforma**" înseamnă serviciile software Menuvia, inclusiv funcțiile serverless, baza de date, aplicația bridge locală de tipărire/fiscalizare și interfețele web.

---

## 3. Obiectul, durata, natura și scopul prelucrării (art. 28 alin. (3) GDPR)

**3.1. Obiectul prelucrării.** Furnizarea Platformei către Restaurant, respectiv: preluarea și gestionarea comenzilor (QR la masă, pickup, introduse de ospătar), gestionarea rezervărilor de mese (inclusiv hartă a sălii și reamintiri), programul de fidelitate, trimiterea de notificări tranzacționale prin e-mail și SMS către clienții finali, plăți online la masă (prin Stripe Connect, pe planurile care includ funcția), emiterea de bonuri fiscale și facturi (pe planul cu fiscalizare) și rapoartele operaționale aferente.

**3.2. Durata.** Pe durata contractului de servicii dintre Restaurant și Menuvia (abonamentul activ, indiferent de plan), plus perioada de ștergere/returnare prevăzută la art. 12, sub rezerva obligațiilor legale de păstrare (art. 12.4).

**3.3. Natura prelucrării.** Colectare, stocare, structurare, consultare, transmitere către subprocesatori autorizați (e-mail/SMS/plăți/fiscalizare), pseudonimizare (hash de telefon pentru fidelitate), ștergere.

**3.4. Scopul prelucrării.** Exclusiv executarea serviciilor descrise la art. 3.1, conform instrucțiunilor documentate ale Restaurantului. Menuvia nu prelucrează datele clienților finali în scopuri proprii (marketing propriu, profilare, vânzare de date) și nu le combină între restaurante-client diferite; izolarea între chiriași (tenant isolation) este impusă tehnic la nivelul bazei de date (Anexa 3).

**3.5. Tipurile de date și categoriile de persoane vizate** sunt detaliate în **Anexa 1**.

---

## 4. Instrucțiuni documentate

**4.1.** Menuvia prelucrează datele clienților finali **numai pe baza instrucțiunilor documentate ale Restaurantului**. Instrucțiunile inițiale sunt prezentul DPA, Termenii și Condițiile și configurările efectuate de Restaurant în Platformă (activarea/dezactivarea modulelor: rezervări, notificări SMS, plăți online, fidelitate; limbile meniului; textele notificărilor etc.). Utilizarea funcțiilor Platformei conform documentației constituie instrucțiune documentată.

**4.2.** Prin excepție, Menuvia poate prelucra datele dacă o obligă dreptul Uniunii sau dreptul român; în acest caz informează Restaurantul înainte de prelucrare, cu excepția situației în care legea interzice informarea din motive importante de interes public.

**4.3.** Menuvia informează imediat Restaurantul dacă, în opinia sa, o instrucțiune încalcă GDPR, Legea nr. 190/2018 sau alte dispoziții privind protecția datelor, și poate suspenda executarea instrucțiunii respective până la clarificare.

**4.4.** Restaurantul garantează că dispune de un temei legal valabil pentru prelucrările pe care le instrumentează prin Platformă (executarea contractului cu clientul pentru comenzi/rezervări; consimțământ sau interes legitim pentru fidelitate, conform propriei analize) și că își informează clienții finali conform art. 13–14 GDPR. Menuvia pune la dispoziție în Platformă textele-suport (pagina de confidențialitate a meniului public), dar responsabilitatea informării aparține Restaurantului în calitate de operator.

---

## 5. Confidențialitate

**5.1.** Menuvia se asigură că persoanele autorizate să prelucreze datele (angajați, colaboratori) s-au angajat la confidențialitate sau au o obligație statutară adecvată de confidențialitate, care supraviețuiește încetării raportului cu Menuvia.

**5.2.** Accesul personalului Menuvia la datele de producție este limitat la strictul necesar (principiul necesității de a cunoaște), iar accesul administrativ de platformă este protejat prin autentificare multi-factor (Anexa 3, pct. 4).

---

## 6. Securitatea prelucrării (art. 32 GDPR)

**6.1.** Menuvia implementează și menține măsurile tehnice și organizatorice descrise în **Anexa 3**, incluzând cel puțin: izolare între chiriași impusă la nivel de bază de date prin Row Level Security (RLS) și funcții de acces controlat, criptarea datelor în tranzit (TLS/HTTPS pe toate suprafețele), autentificare multi-factor obligatorie pentru administratorii de platformă, jurnalizare de audit a operațiunilor sensibile, pseudonimizarea numerelor de telefon din programul de fidelitate și minimizarea expunerii datelor pe suprafețele publice.

**6.2.** Menuvia poate actualiza măsurile de securitate, cu condiția ca modificările să nu reducă nivelul general de protecție.

**6.3.** Restaurantul rămâne responsabil pentru securitatea de partea sa: gestionarea conturilor de staff și a rolurilor (owner/manager/waiter/kitchen), confidențialitatea parolelor, securitatea dispozitivelor proprii (inclusiv a dispozitivului local pe care rulează aplicația bridge de tipărire/fiscalizare și a secretului de dispozitiv aferent) și configurarea corectă a modulelor.

---

## 7. Subprocesatori

**7.1. Autorizare generală.** Restaurantul autorizează în mod general angajarea subprocesatorilor din **Anexa 2**. Menuvia impune fiecărui subprocesator, prin contract, obligații de protecție a datelor cel puțin echivalente cu cele din prezentul DPA (art. 28 alin. (4) GDPR) și rămâne pe deplin răspunzătoare față de Restaurant pentru îndeplinirea obligațiilor de către subprocesatori.

**7.2. Mecanism de obiecție.** Menuvia notifică Restaurantul (prin e-mail la adresa de cont și/sau notificare în Platformă) cu cel puțin **30 de zile** înainte de adăugarea sau înlocuirea unui subprocesator care prelucrează date ale clienților finali. Restaurantul poate obiecta în scris, motivat, în acest termen. În caz de obiecție, părțile caută cu bună-credință o soluție (de ex. dezactivarea modulului afectat); dacă nu se găsește o soluție rezonabilă în 30 de zile de la obiecție, Restaurantul poate rezilia contractul pentru serviciile afectate, fără penalități, cu rambursarea pro-rata a sumelor plătite în avans pentru perioada neexecutată.

**7.3. Transferuri în afara SEE.** Anumiți subprocesatori prelucrează date în afara Spațiului Economic European (marcați în Anexa 2). Pentru aceste transferuri, Menuvia se asigură că există garanții adecvate conform cap. V GDPR: decizie de adecvare (inclusiv EU-U.S. Data Privacy Framework, unde subprocesatorul este certificat) și/sau Clauze Contractuale Standard (Decizia (UE) 2021/914), cu măsuri suplimentare unde este cazul. La cerere, Menuvia pune la dispoziția Restaurantului informații despre mecanismul de transfer aplicabil fiecărui subprocesator.

---

## 8. Asistență pentru drepturile persoanelor vizate (art. 28 alin. (3) lit. e))

**8.1.** Ținând seama de natura prelucrării, Menuvia asistă Restaurantul, prin măsuri tehnice și organizatorice adecvate, în îndeplinirea obligației de a răspunde cererilor persoanelor vizate (acces, rectificare, ștergere, restricționare, portabilitate, opoziție).

**8.2.** Platforma oferă instrumente self-service pentru operațiunile uzuale: consultarea și editarea rezervărilor și comenzilor, funcții dedicate GDPR pentru export și ștergere (implementate ca proceduri controlate în baza de date), precum și mecanisme de dezabonare/oprire a notificărilor. Pentru cereri care nu pot fi soluționate self-service, Menuvia răspunde solicitărilor rezonabile ale Restaurantului în cel mult **10 zile lucrătoare**, astfel încât Restaurantul să se poată încadra în termenul de o lună din art. 12 GDPR.

**8.3.** Dacă o persoană vizată se adresează direct Menuvia cu o cerere privind date prelucrate în numele unui Restaurant, Menuvia redirecționează cererea către Restaurant fără întârzieri nejustificate și nu răspunde pe fond decât la instrucțiunea Restaurantului sau dacă legea o impune.

---

## 9. Notificarea încălcărilor de securitate (art. 28 alin. (3) lit. f), art. 33 GDPR)

**9.1.** Menuvia notifică Restaurantul **fără întârzieri nejustificate și, în orice caz, în cel mult 48 de ore** de la momentul în care a luat cunoștință de o încălcare a securității datelor care afectează datele clienților finali prelucrate în numele Restaurantului, astfel încât Restaurantul să își poată îndeplini obligația de notificare a ANSPDCP **în termen de 72 de ore** (art. 33 GDPR) și, dacă este cazul, de informare a persoanelor vizate (art. 34 GDPR).

**9.2.** Notificarea include, în măsura în care informațiile sunt disponibile (și poate fi completată ulterior, etapizat): natura încălcării, categoriile și numărul aproximativ de persoane vizate și de înregistrări afectate, consecințele probabile, măsurile luate sau propuse și un punct de contact.

**9.3.** Menuvia documentează încălcările și cooperează rezonabil cu Restaurantul și cu ANSPDCP la investigare și remediere. Notificarea unei încălcări nu constituie o recunoaștere a vreunei culpe.

---

## 10. Asistență DPIA și consultare prealabilă (art. 28 alin. (3) lit. f))

Menuvia asistă Restaurantul, în mod rezonabil și ținând seama de informațiile de care dispune, la realizarea evaluărilor de impact asupra protecției datelor (art. 35 GDPR) și la consultarea prealabilă a ANSPDCP (art. 36 GDPR), în măsura în care acestea privesc prelucrările din Platformă, inclusiv prin furnizarea descrierilor de arhitectură și a măsurilor de securitate din Anexa 3.

---

## 11. Audituri și demonstrarea conformității (art. 28 alin. (3) lit. h))

**11.1.** Menuvia pune la dispoziția Restaurantului informațiile necesare pentru a demonstra respectarea obligațiilor din art. 28 GDPR: prezentul DPA cu anexele sale, descrierea măsurilor de securitate, lista subprocesatorilor și, unde există, rapoarte/certificări de audit ale infrastructurii subprocesatorilor (de ex. rapoarte SOC 2 ale furnizorilor de găzduire).

**11.2.** Restaurantul (sau un auditor independent mandatat, care nu este concurent al Menuvia și este ținut de confidențialitate) poate efectua audituri **rezonabile**: cel mult o dată pe an (suplimentar, după o încălcare de securitate care l-a afectat sau la cererea motivată a unei autorități), cu notificare prealabilă de cel puțin 30 de zile, în timpul programului de lucru, fără a perturba operațiunile și fără acces la datele altor restaurante-client. Auditul se desfășoară în primul rând pe bază de documentație și interviuri; accesul la sisteme se acordă doar în măsura strict necesară și cu respectarea securității celorlalți clienți. Costurile auditului sunt suportate de Restaurant, cu excepția cazului în care auditul relevă încălcări semnificative ale prezentului DPA de către Menuvia.

---

## 12. Ștergerea și returnarea datelor la încetare (art. 28 alin. (3) lit. g))

**12.1.** La încetarea serviciilor, Restaurantul poate opta, în termen de **30 de zile**, pentru: (a) **returnarea** datelor clienților finali într-un format structurat, uzual și prelucrabil automat (export CSV/JSON din Platformă sau la cerere), și/sau (b) **ștergerea** acestora.

**12.2.** În lipsa unei opțiuni exprimate în termenul de la 12.1, Menuvia șterge datele clienților finali prelucrate în numele Restaurantului în cel mult **90 de zile** de la încetare, inclusiv din copiile de siguranță, pe măsura rotației acestora conform ciclului de backup.

**12.3.** Menuvia certifică ștergerea, la cererea scrisă a Restaurantului.

**12.4. Excepție legală — documente fiscale.** Prin derogare, documentele financiar-contabile și fiscale (facturi, registrele aferente bonurilor fiscale emise prin Platformă) se păstrează pe durata impusă de lege — **10 ani**, conform Legii contabilității nr. 82/1991 și legislației fiscale — perioadă în care Menuvia le prelucrează exclusiv pentru conformare legală, cu acces restricționat. Această retenție este implementată în Platformă ca regulă de sistem (datele fiscale sunt exceptate de la ștergerea GDPR pe durata legală de păstrare).

---

## 13. Răspundere, legea aplicabilă, diverse

**13.1.** Răspunderea părților este supusă regimului din art. 82 GDPR și limitărilor de răspundere din Termenii și Condițiile Menuvia, în măsura permisă de lege; nicio limitare nu se aplică obligațiilor care, potrivit legii, nu pot fi limitate.

**13.2.** Prezentul DPA este guvernat de legea română. GDPR, Legea nr. 190/2018 și, unde e cazul pentru comerțul electronic și drepturile consumatorilor, OUG nr. 34/2014, prevalează asupra oricărei clauze contrare.

**13.3.** În caz de conflict între DPA și Termenii și Condițiile, prevederile DPA prevalează în privința protecției datelor.

**13.4.** DPA intră în vigoare la acceptarea Termenilor și Condițiilor de către Restaurant (momentul și versiunea acceptării sunt jurnalizate în Platformă) și încetează odată cu finalizarea obligațiilor din art. 12.

---

# ANEXA 1 — Descrierea prelucrării

## A. Categorii de persoane vizate
- **Clienții finali ai Restaurantului**: persoane care scanează meniul QR, plasează comenzi (la masă / pickup), fac rezervări, participă la programul de fidelitate, primesc notificări tranzacționale sau plătesc online la masă.

## B. Categorii de date cu caracter personal

| Flux | Date prelucrate | Observații |
|---|---|---|
| **Rezervări** | nume client, **număr de telefon (în clar)**, e-mail (opțional), data/ora, numărul de persoane, masa, mențiuni, statusul rezervării (inclusiv no-show) | telefonul e obligatoriu; istoricul de no-show se agregă pe o cheie derivată din numărul de telefon |
| **Comenzi** | conținutul comenzii, masa/sesiunea de masă, metoda de plată, telefon pentru pickup (dacă e furnizat pentru notificarea „comanda e gata"), mențiuni ale clientului | comanda QR nu cere cont de client |
| **Fidelitate (loyalty)** | **hash al numărului de telefon** (md5 pe numărul normalizat în format RO), punctele acumulate, istoricul de acordare | pseudonimizare by-design: numărul în clar nu se stochează în tabela de fidelitate |
| **Notificări tranzacționale** | e-mail (confirmări/reamintiri rezervare, notificare către restaurant), număr de telefon mobil RO (SMS: confirmare rezervare, reamintire, „comanda de pickup e gata") | cozile de e-mail/SMS păstrează destinatarul și statusul livrării |
| **Plăți online la masă** | sumă, referința comenzii/sesiunii de masă, identificatorii tranzacției Stripe | datele de card sunt prelucrate exclusiv de Stripe (Menuvia nu vede numărul cardului) |
| **Documente fiscale** | datele impuse de legislația fiscală pe bon/factură | retenție legală 10 ani (art. 12.4) |
| **Jurnal tehnic** | jurnalele de audit ale operațiunilor pe comenzi/membri, jurnalele serverless (IP tehnic, user-agent) pe durată scurtă | pentru securitate și diagnoză |

*Notă:* datele candidaților/lead-urilor din formularul de recrutare/contact (nume, telefon, e-mail, IP, user-agent, adresa de livrare pentru comenzile Codvia) sunt prelucrate de Menuvia ca **operator independent** și nu intră sub acest DPA.

## C. Date sensibile
Platforma **nu este destinată** prelucrării de categorii speciale de date (art. 9 GDPR). Restaurantul se obligă să nu instrumenteze prin câmpurile libere (mențiuni, note) colectarea de date sensibile; câmpurile de mențiuni pot conține incidental preferințe alimentare furnizate voluntar de client (de ex. alergii), pe care Restaurantul le folosește exclusiv pentru executarea comenzii/rezervării.

## D. Operațiuni de prelucrare
Colectare prin interfețele publice (meniu QR, pagina /m/:slug, widget rezervări), stocare în baza de date, transmitere către subprocesatorii din Anexa 2 strict pentru funcția respectivă (e-mail, SMS, plăți, fiscalizare), pseudonimizare (fidelitate), agregare pentru rapoartele Restaurantului, ștergere.

---

# ANEXA 2 — Lista subprocesatorilor autorizați

Subprocesatori care prelucrează date ale **clienților finali** în numele Restaurantului:

| # | Subprocesator | Rol în Platformă | Țara / locația prelucrării | Transfer în afara SEE |
|---|---|---|---|---|
| 1 | **Supabase, Inc.** | bază de date, autentificare, API (infrastructura principală de stocare) | SUA (societate); **regiunea de găzduire a proiectului: [de confirmat — UE]** | de confirmat după fixarea regiunii; SCC/DPF unde e cazul |
| 2 | **Netlify, Inc.** | găzduire aplicație web + funcții serverless (procesarea cererilor, cozi e-mail/SMS, webhook-uri) | SUA (CDN global) | **Da** — SCC/DPF |
| 3 | **Stripe** (Stripe Payments Europe Ltd. / Stripe, Inc.) | plăți online la masă prin Stripe Connect (pe planurile cu plăți online) | Irlanda / SUA | parțial — mecanismele Stripe (SCC/DPF); pentru propriile obligații (KYC, antifraudă) Stripe acționează ca operator independent |
| 4 | **Resend** (Resend, Inc.) | trimitere e-mail tranzacțional către clienți (confirmări/reamintiri rezervare) și către Restaurant | SUA | **Da** — SCC/DPF |
| 5 | **SMSO.ro** | trimitere SMS tranzacțional (confirmare/reamintire rezervare, pickup gata) | **România** | Nu |
| 6 | **Oblio** (Oblio Software) | emitere facturi (planul cu fiscalizare) | **România** | Nu |
| 7 | **FiscalNet / EconMedia** | tipărirea bonului fiscal pe casa de marcat a Restaurantului (aplicație bridge locală) | **România** — prelucrare locală, pe echipamentul Restaurantului | Nu |

Furnizori auxiliari, cu expunere limitată sau condiționată la date ale clienților finali:

| # | Furnizor | Rol | Țara | Observații |
|---|---|---|---|---|
| 8 | **Sentry** (Functional Software, Inc.) | monitorizare erori aplicație | SUA | se încarcă **doar cu consimțământul** vizitatorului (banner cookie); datele sunt filtrate de PII înainte de transmitere; SCC/DPF |
| 9 | **OpenAI** (prin proxy-ul AI Menuvia) | funcții AI pentru Restaurant (import meniu, generare descrieri) | SUA | prelucrează **conținutul meniului**, nu date ale clienților finali; menționat pentru transparență; SCC/DPF |

*Notă:* lista actualizată a subprocesatorilor este publicată în Platformă / pe pagina legală Menuvia; modificările urmează mecanismul de obiecție din art. 7.2.

---

# ANEXA 3 — Măsuri tehnice și organizatorice (art. 32 GDPR)

1. **Izolare între chiriași (tenant isolation).** Politici Row Level Security (RLS) active pe tabelele cu date, astfel încât fiecare restaurant își accesează exclusiv propriile date; mutațiile sensibile trec prin proceduri stocate controlate (SECURITY DEFINER cu `search_path` fixat și drepturi de execuție restrânse), cu invarianți de autorizare verificați la nivel de tranzacție (de ex. invariantul de owner unic pe membership-uri, imutabilitatea owner-ului).

2. **Minimizarea expunerii publice.** Proiecțiile publice (meniul pe QR/slug) expun liste albe stricte de câmpuri; secretele (parola WiFi, token-urile QR) nu sunt returnate pe suprafețele anonime; vizibilitatea produselor/opțiunilor este filtrată explicit server-side.

3. **Criptare în tranzit.** Tot traficul client–Platformă și Platformă–subprocesatori se face prin TLS/HTTPS. Criptarea în repaus este asigurată la nivelul infrastructurii de găzduire a bazei de date.

4. **Control acces și MFA.** Roluri granulare pentru staff (owner/manager/waiter/kitchen) cu drepturi diferențiate impuse în baza de date; **autentificare multi-factor (TOTP) pentru administratorii de platformă**, cu clichet anti-dezactivare (renunțarea la MFA cere o sesiune deja autentificată MFA); dispozitivele bridge (imprimare/fiscalizare) se autentifică cu secret de dispozitiv, iar secretul nu este vizibil personalului non-admin al Restaurantului.

5. **Pseudonimizare.** Numerele de telefon din programul de fidelitate se stochează exclusiv ca hash pe numărul normalizat; cheile de recidivă no-show folosesc o derivare a numărului, nu numărul asociat identității de fidelitate.

6. **Jurnalizare și audit.** Jurnal de audit pentru operațiunile pe comenzi și pe membri; jurnalizarea versiunii și momentului acceptării termenilor; istoricul modificărilor de schemă este versionat (migrații imuabile, testate automat înainte de aplicare).

7. **Protecție împotriva abuzului.** Limitare de rată pe fluxurile publice (rezervări), validări server-side ale sumelor și tranzițiilor de stare (plăți calculate exclusiv server-side, protecții anti-dublă încasare/dublă scădere), idempotență pe comenzi și pe e-mailurile tranzacționale.

8. **Consimțământ pentru instrumente opționale.** Instrumentele de monitorizare (Sentry) și analitice se încarcă doar după consimțământul vizitatorului, prin mecanismul de consimțământ al Platformei; datele transmise sunt filtrate de PII.

9. **Continuitate și backup.** Copii de siguranță ale bazei de date la nivelul furnizorului de infrastructură, cu rotație; procese de re-preluare a joburilor eșuate (cozi de e-mail/SMS/fiscalizare) proiectate să nu piardă și să nu dubleze notificări sau documente fiscale.

10. **Dezvoltare sigură.** Verificări automate obligatorii înainte de livrare (typecheck, lint, teste, replay complet al migrațiilor cu aserțiuni pe fluxurile critice, inclusiv aserțiuni anti-regresie pe politicile de securitate).

---

## Semnături

| | **Operator (Restaurantul)** | **Persoana împuternicită (Menuvia)** |
|---|---|---|
| Entitate | _________________________ | `[MENUVIA S.R.L. — în curs de constituire, CUI: ___, sediu: ___]` |
| Reprezentant | _________________________ | _________________________ |
| Funcție | _________________________ | _________________________ |
| Data | _________________________ | _________________________ |
| Semnătura | _________________________ | _________________________ |

*Pentru contractarea online, acceptarea Termenilor și Condițiilor (care încorporează prezentul DPA) ține loc de semnătură, iar momentul și versiunea acceptării sunt înregistrate în Platformă.*
