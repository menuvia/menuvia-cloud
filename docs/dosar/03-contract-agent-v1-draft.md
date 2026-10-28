# CONTRACT DE COLABORARE — AGENT DE VÂNZĂRI (prestări servicii de marketing și generare de clienți potențiali)

> **⚠️ DRAFT v1 pentru revizuire de către avocat — NU este sfat juridic și NU produce efecte până la avizare, completarea datelor societății și publicarea versiunii finale în aplicație.**
> Întocmit de echipa tehnică pe baza regulilor din cod și a deciziilor fondatorului (vezi `docs/dosar/04-fisa-decizii-D1-D15.md`). Notele `[NOTĂ AVOCAT: …]` sunt întrebări, nu soluții. Variantele între `[…]` sunt de decis. Contractul se acceptă în aplicație (click-accept), cu versiune și moment păstrate într-un istoric append-only.
> Contractul pentru șeful de vânzări este `03b-contract-sef-vanzari-v1-draft.md`.

**Versiunea contractului:** `agent-1.0-DRAFT` · **Data intrării în vigoare:** [___]

---

## 0. Părțile

**Prestatorul de servicii de marketing („Agentul”)** — persoană fizică autorizată sau societate, înregistrată în România, **cu CUI valid**:
Denumire / nume: [___] · CUI: [___] · Forma juridică: [PFA / SRL] · Sediu/domiciliu profesional: [___] · IBAN / cont Stripe Connect: [completat de Agent prin Stripe, nu în acest contract]
Reprezentat prin: [___]. Date de contact în aplicație: [email], [telefon].

**Beneficiarul („Menuvia”)** — **[DENUMIRE SRL]**, [CUI], [nr. ONRC], [SEDIU], reprezentată prin [ADMINISTRATOR].

*Datele Agentului se completează în aplicație la acceptare (CUI validat tehnic; verificarea la ANAF se face înainte de prima plată).*

## 1. Definiții

- **„Platforma”** — serviciul software Menuvia (meniu digital cu cod QR, comenzi, rezervări etc.), accesibil la [menuvia.ro].
- **„Client”** — restaurantul, cafeneaua sau alt local (persoană juridică sau PFA) care își creează un cont și încheie un abonament cu Menuvia.
- **„Abonament plătit”** — abonamentul la unul dintre planurile plătite ale Platformei (la data redactării: 99 / 249 / 499 lei pe lună; planul gratuit și perioada de probă nu sunt abonamente plătite).
- **„Atribuire”** — legătura dintre Client și Agent, stabilită conform art. 6.
- **„Factură plătită”** — factura Stripe a unui abonament, încasată efectiv de Menuvia (sumă > 0).
- **„Comision”** — remunerația Agentului calculată conform art. 5.
- **„Perioadă de reținere”** — intervalul în care un Comision nu poate fi plătit (art. 5.5).
- **„Cod de agent” / „link de agent”** — identificatorii personali ai Agentului, atribuiți de Platformă.

## 2. Obiectul contractului; natura relației

2.1. Agentul prestează **servicii independente de marketing și de generare de clienți potențiali** pentru Platformă: prezintă Platforma unor potențiali Clienți și le comunică codul/linkul de agent. Agentul poate oferi, la cererea Clientului, ajutor la configurarea meniului în limitele art. 9 (acces opt-in).

2.2. **Agentul nu reprezintă Menuvia, nu negociază, nu încheie și nu modifică contracte în numele Menuvia și nu încasează bani de la Clienți.** Clientul încheie abonamentul direct cu Menuvia, online, și plătește exclusiv prin Platformă (Stripe). Agentul nu are putere de angajare.

2.3. **Relația nu este contract de muncă și nu este contract de agenție comercială.** Agentul este independent: își stabilește singur programul, metodele și resursele; **nu are obligație de exclusivitate** (poate promova și alte produse, cu excepția concurenților direcți ai Menuvia pentru același Client, în cazul unui conflict de interese declarat) și **nu are obligația unui număr minim de vânzări**. Fiecare parte suportă propriile costuri. Agentul răspunde de propriile obligații fiscale și sociale.
[NOTĂ AVOCAT: confirmați încadrarea (prestări servicii de marketing/lead-generation, art. 1851 și art. 1349 Cod civil) față de agenția comercială (art. 2072+). Ce clauze/practici ar duce la reclasificare, inclusiv în contract de muncă (art. 7 Cod fiscal)? Este potrivit „fără exclusivitate”?]

2.4. **Agentul nu primește Comision pentru simpla recrutare** de alți agenți sau pentru propriul abonament. Comisionul se naște **numai** din Facturi plătite ale unor Clienți reali atribuiți (art. 5).

## 3. Cine poate fi Agent; acceptarea contractului

3.1. Poate fi Agent doar o **persoană fizică autorizată (PFA) sau o societate**, rezidentă fiscal în România, **cu CUI**. [La lansare: doar neplătitori de TVA — vezi art. 8.5.] Persoanele fizice neînregistrate nu pot fi Agenți.
3.2. Accesul se face **numai pe invitație** (art. 3.3); programul public de înscriere este închis.
3.3. Agentul este invitat de un **șef de vânzări** ales de Menuvia (contract 03b). Invitația este personală, de unică folosință și expiră în [14] zile. Menuvia poate refuza sau retrage o invitație neacceptată, fără motivare.
3.4. **Acceptarea contractului se face în aplicație** (click-accept): Agentul citește versiunea afișată, declară CUI-ul și forma juridică și apasă „Accept”. Platforma păstrează, într-un **istoric care nu se șterge niciodată (append-only)**, pentru fiecare acceptare: versiunea contractului, **hash-ul documentului complet, așa cum a fost afișat** (inclusiv versiunile exacte ale Anexelor 1–3 și ale Politicii de Confidențialitate încorporate prin art. 12.5), momentul (UTC), contul, CUI-ul declarat [, IP-ul și user-agent-ul]. Acceptarea electronică produce efecte echivalente semnăturii.
[NOTĂ AVOCAT: e suficient click-accept fără semnătură electronică calificată pentru un contract B2B de acest tip? Ce date de probă cereți să păstrăm?]
3.5. **Fără contract acceptat și fără CUI validat nu se plătește niciun Comision.** La o versiune nouă a contractului, Agentul trebuie să accepte din nou; până la acceptare, Comisioanele noi se acumulează, dar nu se plătesc.

## 4. Fără taxe; conduită interzisă

4.1. **Nu se percepe nicio taxă de intrare, de instruire, de „kit” sau de participare.** Materialele puse la dispoziție de Menuvia sunt gratuite. Agentul nu are voie să perceapă astfel de taxe altor persoane în legătură cu Platforma.
4.2. **Interdicții** (încălcarea lor este încălcare gravă):
a) declarații false sau înșelătoare către potențiali Clienți: „garantat”, „venit sigur”, „fără obligații”, funcții care nu există în Platformă sau nu sunt disponibile pe planul vândut, promisiuni de reduceri neautorizate, afirmații despre aprobări fiscale pe care Menuvia nu le-a primit;
b) crearea de conturi fictive, restaurante inexistente sau abonamente făcute doar pentru a genera Comision; plata abonamentului unui Client din banii proprii ai Agentului sau ai persoanelor din jurul său pentru a obține Comision;
c) **abonarea propriului local/conturi proprii** (sau ale unor persoane afiliate) cu scopul de a obține Comision; Agentul nu primește Comision pentru propriul abonament;
d) accesul, copierea sau folosirea datelor unui Client în afara scopului din art. 9; accesul fără aprobarea expresă a patronului;
e) comunicări comerciale nesolicitate prin canale neconforme cu legea (Legea nr. 506/2004), colectarea de date personale fără temei;
f) prezentarea drept angajat al Menuvia; folosirea mărcii Menuvia în afara materialelor oferite;
g) condiționarea vreunui beneficiu de plata unei sume de către alt agent sau de recrutarea altora;
h) orice conduită care ar fi de natură să atragă calificarea programului drept practică comercială incorectă sau „sistem piramidal”.
4.3. Agentul se obligă să respecte legislația aplicabilă (protecția consumatorilor, publicitate, GDPR) și să utilizeze doar materialele/mesajele aprobate de Menuvia sau echivalente, fără a inventa afirmații despre produs.

## 5. Comision

5.1. **Cine plătește.** Comisionul este plătit de Menuvia, exclusiv din **sumele efectiv încasate** de la Clienții atribuiți Agentului. Nu există Comision pe Clienți pe planul gratuit, pe perioada de probă (fără factură plătită) sau pe facturi de 0 lei.

5.2. **Planuri.** Comisionul se aplică Abonamentelor plătite pe toate planurile plătite ale Platformei.
[Notă tehnică: mig 293 aplică comision pe starter/growth/pro/enterprise. Planul „Fiscalizare” se contractează pe bază de ofertă (decizia D4), nu prin checkout public: [de clarificat cu fondatorul cum se comisionează un abonament contractat manual — probabil după ce abonamentul este facturat prin Stripe].]

5.3. **Cotele (la data intrării în vigoare, înghețate pe fiecare Client la momentul Atribuirii):**
a) **Comision de activare („setup”): 30%** din suma **primei Facturi plătite** a Clientului (neta de eventualele rambursări ale acelei facturi). **Se câștigă și se înregistrează abia la a DOUA Factură plătită** a aceluiași Client. Se plătește **o singură dată** pe Atribuire (reabonarea aceluiași Client nu generează un al doilea comision de activare). **Reabonare după închiderea Atribuirii (art. 6.3):** nu se creează o Atribuire nouă și nu se reia Comisionul recurent pe Atribuirea închisă; Facturile plătite ulterior nu generează Comision, decât dacă Clientul este atribuit din nou printr-o Atribuire nouă, valabilă conform art. 4, caz în care contorul de 12 Facturi și Comisionul de activare pornesc de la zero doar dacă Menuvia confirmă în scris. [NOTĂ AVOCAT: confirmați regula.]
b) **Comision recurent: 10%** din fiecare Factură plătită, începând cu **a doua** Factură plătită, **pentru maximum 12 Facturi plătite** (în total 12 Comisioane recurente, indiferent de calendar). După a 12-a, Comisionul recurent încetează pentru Clientul respectiv.
c) Nu se calculează Comision recurent pe o a doua factură din aceeași lună calendaristică (ex. factură de ajustare la schimbarea planului). **Numărare:** o factură de ajustare care este a doua Factură plătită declanșează Comisionul de activare, dar NU consumă un loc din plafonul de 12 Facturi recurente; contorul de 12 avansează doar cu Facturile plătite care generează Comision recurent.
d) Suma se calculează pe **baza**: [suma efectiv încasată de Menuvia, fără TVA dacă Menuvia este plătitor de TVA — formulare de aliniat cu decizia contabilului, D13]. Fiecare rând de Comision se **rotunjește în jos la ban**.

5.4. **Exemple (pentru informare; fără garanție de venit):**

| Plan | Preț lunar | Setup (30%, scris la factura 2) | Recurent (10%) pe factură | Total pe un Client în primele 13 facturi (setup + 12 recurente) |
|---|---:|---:|---:|---:|
| Meniu Digital + Rezervări | 99 lei | 29,70 | 9,90 | 148,50 lei |
| Meniu + Comenzi | 249 lei | 74,70 | 24,90 | 373,50 lei |
| Fiscalizare | 499 lei | 149,70 | 49,90 | 748,50 lei |

Primul Comision devine plătibil **abia după** a doua factură plătită **și** expirarea perioadei de reținere (60 de zile pentru activare, 14 pentru recurent), deci de regulă la câteva luni după începutul perioadei de probă a Clientului. Un Client care renunță după prima factură **nu generează** Comision de activare.

5.5. **Perioade de reținere.** Comisionul de activare se reține **60 de zile**; Comisionul recurent **14 zile**, de la data scrierii lui. Reținerea **nu înseamnă garanție**: art. 5.6 se aplică și după expirarea ei.

5.6. **Retragere (clawback).** Dacă un Client primește **rambursare** (totală/parțială) sau Menuvia **pierde o dispută de card** privind o Factură plătită, Comisionul aferent se retrage **proporțional** cu suma rambursată/contestată, indiferent dacă perioada de reținere a expirat. Retragerea se face prin compensare cu Comisioanele viitoare; un sold negativ rămâne de recuperat de la Agent și se compensează cu plățile următoare [sau se solicită restituirea]. **Simpla anulare a abonamentului, fără rambursare, nu retrage Comisioane deja câștigate.**
[NOTĂ AVOCAT: este acceptabilă compensarea unilaterală între profesioniști? Ce se întâmplă cu soldul negativ al unui Agent care încetează colaborarea?]

5.7. **Procentele pot fi modificate de Menuvia cu preaviz de [30] zile**, notificat în aplicație și pe email; modificarea se aplică **numai Clienților noi atribuiți după data intrării în vigoare**; Clienții deja atribuiți își păstrează procentele înghețate la Atribuire.
5.8. **Nu există alt venit** de la Menuvia: nu se plătesc avansuri, salarii, rate de achiziție sau alte sume.
5.9. [Clauză privind indemnizația de clientelă — de formulat de avocat. Intenția comercială: plafonul de 12 Facturi plătite este durata convenită a contraprestației.]
[NOTĂ AVOCAT: indemnizația de clientelă (art. 2082–2095 Cod civil), dacă ar fi considerată aplicabilă. Plafonul de 12 facturi comisionate: cum îl scriem ca durată a contraprestației, cu considerent expres, nu ca renunțare? Sunt necesare clauze suplimentare?]

## 6. Atribuirea Clienților

6.1. Un Client se atribuie **unui singur Agent**. Regula este: **primul link de agent sau primul cod de agent validat câștigă**; în caz de concurs între mai mulți agenți, **decizia sistemului Platformei este finală** și nu poate fi contestată, cu excepția **erorii tehnice dovedite**.
6.2. **Codul de agent poate fi introdus doar la crearea contului sau în primele [14] zile de la creare**, doar pe un cont **nou**, fără plată anterioară și fără o altă Atribuire, și **nu pe un cont al Agentului însuși**.
6.3. Atribuirea se închide automat când abonamentul Clientului se încheie definitiv (anulare la sfârșitul abonamentului). O rambursare pe o singură factură nu închide Atribuirea; Comisionul acelei facturi se retrage conform art. 5.6.
6.4. Clienții veniți singuri, fără link sau cod, nu sunt repartizați unui Agent.
6.5. Menuvia poate refuza sau anula o Atribuire pe baza unei suspiciuni rezonabile de încălcare a art. 4 (inclusiv conturi create doar pentru Comision), cu notificare.
[Notă tehnică: regulile din art. 6.2 sunt cele decise (D10) și se implementează în pachetul 7; până atunci Atribuirea se face la momentul plății prin cookie-ul de link (90 zile), după regula „first-wins”. Parametrii (14 zile) se află într-o anexă tehnică și pot fi modificați cu preaviz.]

## 7. Plata Comisioanelor

7.1. **Plata se face lunar**, automat, în prima parte a lunii pentru luna anterioară, pentru Comisioanele a căror perioadă de reținere a expirat.
7.2. **Prag minim.** Plata se face doar dacă suma disponibilă depășește un prag minim de [**45 lei**] (stocat în baza de date a Platformei); sub prag, suma se **reportează** în luna următoare. Pragul poate fi modificat de Menuvia cu preaviz de [30] zile.
[Notă tehnică: în cod, pragul este azi de 50 lei (mig 294, parametrul `p_min_cents`); decizia fondatorului este 45 lei, ținut în baza de date — o schimbare din pachetul 13.]
7.3. **Metoda: Stripe Connect Express.** Agentul își deschide, o singură dată, un cont Stripe Express (Stripe îi verifică identitatea și contul bancar). Menuvia nu stochează IBAN-ul în baza proprie. **Plata nu se face până când contul Stripe nu este activ.** Contul Express se cere la apariția primului Comision înregistrat (nu la primul plătibil), pentru ca verificarea să nu întârzie plata.
7.4. **Rezervă:** până la activarea Stripe Connect sau ca metodă de rezervă, Menuvia poate plăti prin **virament bancar** în contul declarat de Agent, cu aceleași condiții.
7.5. **Răcire:** transferul se face după un interval de [48] ore de la pregătirea plății, pentru a permite corecturi.
7.6. **Facturare — [VARIANTA A: autofactură / VARIANTA B: factura Agentului]** (alegerea depinde de răspunsul contabilului și al avocatului):
 **A.** Prin prezentul contract Agentul își dă **acordul prealabil** ca Menuvia să emită, în numele și pe contul Agentului, **autofacturi** pentru Comisioanele datorate (art. 319 alin. 18 Cod fiscal), transmise în sistemul RO e-Factura (tip factură 389). **Procedura de acceptare:** Agentul primește lunar, în aplicație și pe email, extrasul Comisioanelor și autofactura; o poate **accepta sau contesta în [5] zile**; **lipsa contestării în termen valorează acceptare** [sau acceptare expresă — de decis]. Agentul se obligă să declare veniturile și să își îndeplinească obligațiile fiscale; dacă devine plătitor de TVA, notifică Menuvia imediat (art. 8.5).
 **B.** Agentul emite și încarcă în aplicație factura pentru suma indicată, **înainte** de plată; factura trebuie să existe și în e-Factura; suma facturată trebuie să coincidă cu extrasul.
[NOTĂ AVOCAT: formulați clauza de autofacturare (acord prealabil + procedură de acceptare + contestare). Este valabilă acceptarea tacită între profesioniști?]
7.7. **Suma plătită = suma din extras**, minus retrageri (art. 5.6). Menuvia nu răspunde de comisioanele bancare sau Stripe percepute Agentului de către terți pentru retragerea banilor din contul lui Stripe. Costul contului Express (taxa Stripe per cont activ/transfer) este suportat de Menuvia.
7.8. Toate sumele sunt în **lei (RON)**. Impozitele și contribuțiile Agentului sunt în sarcina Agentului. Menuvia nu reține impozit la sursă pentru plăți către PFA/SRL facturate.
[NOTĂ AVOCAT/CONTABIL: confirmați lipsa obligațiilor de reținere (D100/D205) pentru plăți către PFA/SRL cu factură/autofactură.]

## 8. Fiscalitate; TVA; verificări

8.1. Agentul declară că este înregistrat în România cu activitate care permite prestarea serviciilor de marketing și că datele declarate (CUI, formă juridică, status TVA) sunt corecte; le actualizează imediat la schimbare.
8.2. Menuvia poate verifica CUI-ul și statusul TVA la ANAF înainte de prima plată și periodic.
8.3. Fără CUI valid sau cu contract neacceptat, plata se **suspendă** (nu se pierde) până la remediere.
8.4. Menuvia nu garantează tratamentul fiscal al veniturilor Agentului.
8.5. **TVA.** La lansare sunt acceptați doar Agenți **neplătitori de TVA**. Dacă Agentul devine plătitor de TVA, trebuie să notifice Menuvia; plata Comisionului pentru plătitori de TVA se face după ce Menuvia și Agentul convin asupra tratamentului TVA (suma facturată include TVA), sau relația poate fi încetată.
[NOTĂ AVOCAT/CONTABIL: formularea corectă pentru agenții plătitori de TVA la lansare. Se exclud, sau se acceptă cu TVA în plus?]

## 9. Confidențialitate și protecția datelor; acces opt-in la un restaurant

9.1. **Confidențialitate.** Agentul păstrează confidențialitatea informațiilor neprezentate public despre Platformă, despre cote, despre alți Clienți și Agenți și despre orice date la care are acces în cadrul colaborării, în timpul contractului și [3] ani după încetare.

9.2. **Datele Agentului.** Menuvia este operator pentru datele Agentului (nume, contact, CUI, istoric Comisioane, date de plată) și le prelucrează pentru executarea contractului, obligații legale (evidență fiscală 10 ani) și interese legitime (prevenirea fraudei). Detalii: Politica de Confidențialitate. La cererea de ștergere, identitatea Agentului este detașată și pseudonimizată; evidența financiară se păstrează conform legii.

9.3. **Acces opt-in la un restaurant (mig 286).** Agentul poate cere accesul la contul unui Client atribuit; **numai patronul îl poate acorda și îl poate revoca oricând**. Accesul acoperă **exclusiv**: meniul (categorii, produse, extra-uri, asocieri, modificatori), mesele și codurile QR și citirea cotelor de TVA și a datelor de bază ale restaurantului. **Agentul NU are acces la**: comenzi, plăți, rezervări, datele clienților finali ai restaurantului, date fiscale/bon fiscal/facturi, setări, echipă, integrări sau jurnale.

9.4. **Agentul ca persoană autorizată.** Pentru orice date personale la care ar putea ajunge accidental în cadrul accesului din art. 9.3, Agentul acționează **sub autoritatea și instrucțiunile restaurantului (operator) și ale Menuvia**, ca persoană autorizată (art. 29 GDPR): folosește accesul doar pentru configurarea meniului la cererea patronului, nu copiază și nu extrage date, nu le folosește în alt scop, notifică imediat Menuvia despre orice incident, șterge orice copie la încetarea accesului și rămâne obligat la confidențialitate și după încetare.
[NOTĂ AVOCAT: calitatea Agentului față de restaurant (persoană autorizată art. 29, sub-împuternicit art. 28(4), altceva?) și clauza de confidențialitate din 9.1/9.4. Este nevoie de un acord separat de prelucrare cu Agentul?]

9.5. **Datele de contact afișate.** Prin acceptarea acestui contract, Agentul consimte ca **numele și numărul lui de telefon** să fie afișate: (a) **patronului Clienților atribuiți lui**, ca să îl poată contacta pentru ajutor; (b) **șefului de vânzări** al Agentului, împreună cu performanța agregată. Agentul poate **retrage consimțământul oricând** din aplicație; retragerea nu afectează legalitatea prelucrării anterioare. [Notă tehnică: funcția `set_my_contact_sharing` și afișarea condiționată se implementează în pachetele 8 și 10.]
[NOTĂ AVOCAT: temeiul (consimțământ vs. executarea contractului/interes legitim) și textul de informare din ecranul de acceptare.]

9.6. Agentul nu transmite către Menuvia date personale ale unor terți decât în măsura necesară (de ex. contactul unui potențial Client, cu temei).

## 10. Durată; suspendare; încetare

10.1. **Durată nedeterminată.** Oricare parte poate înceta contractul cu **preaviz de [15] zile**, notificat în aplicație/email.
10.2. **Încetare imediată** de către Menuvia pentru încălcarea art. 4 sau a art. 9, fraudă sau pierderea calității de PFA/SRL cu CUI.
10.3. **Suspendare (D9).** Menuvia poate **suspenda** Agentul (inclusiv blocarea Atribuirilor noi și a accesului din art. 9) pe durata verificării unei suspiciuni rezonabile. **La suspendare:** Comisioanele **deja câștigate** (cele înregistrate până la data suspendării) rămân datorate și **se plătesc** la termenele normale, **cu rezerva art. 5.6**; **Comisioanele viitoare se opresc**. Agentul este notificat cu motivul și poate răspunde în [5] zile. **Anularea Comisioanelor pentru fraudă dovedită** este o excepție decisă individual, cu motivare scrisă. **Șefii de vânzări nu pot suspenda Agenți.**
10.4. **La încetare fără culpă a Agentului**, Comisioanele deja câștigate se plătesc ca la art. 7. Pentru Clienții deja atribuiți: [VARIANTA A: Comisionul recurent continuă până la plafonul de 12 facturi / VARIANTA B: Comisionul recurent încetează la data încetării contractului].
[NOTĂ AVOCAT: care variantă este sigură (indemnizație de clientelă, echitate)?]
10.5. La încetare, Agentul încetează orice acces la conturile Clienților și șterge datele primite (art. 9.4).

## 11. Răspundere

11.1. Menuvia nu garantează venituri, număr de Clienți sau disponibilitate neîntreruptă a Platformei; poate modifica sau întrerupe funcții, planuri sau prețuri, fără ca aceasta să atragă răspunderea ei față de Agent, cu excepția Comisioanelor deja câștigate.
11.2. Răspunderea Menuvia față de Agent este limitată la valoarea Comisioanelor datorate și neplătite, [în limita legii].
11.3. Agentul răspunde pentru prejudiciile cauzate Menuvia sau Clienților prin încălcarea art. 4 sau art. 9, inclusiv declarații false.
[NOTĂ AVOCAT: plafoane și clauze penale valabile între profesioniști.]

## 12. Dispoziții finale

12.1. **Drept aplicabil: dreptul român.** Litigiile se soluționează amiabil, iar în caz contrar de instanța competentă de la sediul Menuvia ([SEDIU]). [Mediere prealabilă opțională — de decis.]
12.2. **Modificări:** orice modificare se notifică în aplicație cu preaviz de [30] zile; continuarea după intrarea în vigoare nu înlocuiește acceptarea expresă a versiunii noi (art. 3.5).
12.3. **Notificări:** în aplicație și la emailul din cont; considerate primite la trimitere.
12.4. **Cesiunea:** Agentul nu poate ceda contractul fără acordul scris al Menuvia.
12.5. **Integralitate:** contractul include Anexele 1–3 și Politica de Confidențialitate.
12.6. **Limba:** română.

---

## Anexa 1 — Parametri tehnici ținuți în aplicație (informativ, modificabili cu preaviz)

| Parametru | Valoare la lansare | Sursa în cod |
|---|---|---|
| Comision activare | 30% din prima factură plătită, scris la factura 2, reținere 60 zile | mig 293 |
| Comision recurent | 10% × maxim 12 facturi, reținere 14 zile | mig 293, `recurring_cap_months` 12 (mig 097) |
| Prag minim de plată | [45] lei (azi în cod 50 lei) | mig 294 `p_min_cents`; plan pachet 13 |
| Fereastra codului de agent | [14] zile de la crearea contului | plan D10, pachet 7 |
| Răcire înainte de transfer | [48] ore | plan D10, pachet 13 |
| Retragere la rambursare/dispută | proporțional, indiferent de reținere | mig 099/293 |
| Rotunjire | în jos la ban, pe fiecare rând | mig 099 |
| Moneda | RON | mig 107 |

## Anexa 2 — Reguli de conduită în mesajele către potențiali Clienți (rezumat)

**DA:** prezentarea corectă a planurilor și prețurilor listate; menționarea perioadei de probă gratuite și a condițiilor ei; explicarea clară că abonamentul se încheie direct cu Menuvia; recomandarea de a verifica funcțiile pe pagina de prețuri.
**NU:** „garantat/fără risc/venit pasiv”; funcții inexistente (de ex. plăți online sau bon fiscal pe un plan care nu le include); promisiuni de reduceri; presiune pe termene; colectarea datelor de card; modificarea contului Clientului fără aprobarea lui.

## Anexa 3 — Informare GDPR pentru Agent (rezumat; textul complet în Politica de Confidențialitate)

Operator: [DENUMIRE SRL]. Scopuri: executarea contractului, plata Comisioanelor, obligații fiscale (10 ani), prevenirea fraudei, comunicări operaționale. Destinatari: Stripe (plăți), Oblio (facturare) [dacă autofactură], furnizori de infrastructură (Supabase, Netlify, Resend). Drepturile: acces, rectificare, ștergere (cu excepția evidenței fiscale), restricționare, opoziție, portabilitate, retragerea consimțământului pentru afișarea datelor de contact. Contact: privacy@menuvia.ro.
