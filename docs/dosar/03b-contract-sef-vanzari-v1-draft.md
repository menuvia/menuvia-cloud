# CONTRACT DE COLABORARE — ȘEF DE VÂNZĂRI (coordonator)

> **⚠️ DRAFT v1 pentru revizuire de către avocat — NU este sfat juridic și NU produce efecte până la avizare, completarea datelor societății și publicarea versiunii finale în aplicație.**
> Contractul Șefului de vânzări **completează** Contractul de Agent (`03-contract-agent-v1-draft.md`, versiunea `agent-1.0-DRAFT`). Aici sunt scrise **doar diferențele**. Clauzele comune (părțile, natura relației independente, interdicțiile, comisionul propriu, atribuirea, plata, fiscalitatea, confidențialitatea, încetarea, răspunderea, dispozițiile finale) sunt cele din art. 0–12 ale Contractului de Agent și **se aplică Șefului în integralitate**, prin trimitere, pentru ciornă. În versiunea finală, contractul se tipărește integral (un singur document de acceptat în aplicație).
> Notele `[NOTĂ AVOCAT: …]` sunt întrebări. Variantele între `[…]` sunt de decis.

**Versiunea contractului:** `sef-1.0-DRAFT` · **Data intrării în vigoare:** [___]

---

## 0. Părțile

**Șeful de vânzări („Șeful”)** — PFA sau societate, rezidentă fiscal în România, **cu CUI valid**: Denumire / nume: [___] · CUI: [___] · Forma juridică: [PFA / SRL] · Sediu: [___] · Date de contact în aplicație: [email], [telefon].
**Menuvia** — **[DENUMIRE SRL]**, [CUI], [nr. ONRC], [SEDIU], reprezentată prin [ADMINISTRATOR].

## 1. Definiții suplimentare

- **„Agent al Șefului”** — Agentul invitat de Șef și care a acceptat Contractul de Agent prin invitația acestuia.
- **„Echipa Șefului”** — totalitatea Agenților Șefului. **Echipa are un singur nivel**: un Agent nu poate avea el însuși alți agenți sub el; această limită este impusă tehnic în baza de date a Platformei.
- **„Bonus de coordonare”** — remunerația Șefului din art. 3.

## 2. Obiectul; natura relației; accesul pe invitație

2.1. Șeful prestează, în mod independent, servicii de **coordonare comercială și suport** pentru Agenții din echipa lui: îi invită, îi îndrumă, le oferă gratuit materiale și pregătire și răspunde întrebărilor lor despre vânzarea Platformei. Șeful poate vinde și el direct (ca Agent, cu Comision propriu, conform Contractului de Agent).
2.2. **Natura relației** este cea din art. 2.2–2.4 din Contractul de Agent: independent, fără exclusivitate, fără program, fără angajare; **Șeful nu este angajatul Menuvia și nu are angajați ai Menuvia în subordine**. Agenții Șefului nu sunt angajații Șefului în baza acestui contract.
2.3. **Accesul se face doar pe invitația Menuvia.** Nu există înscriere publică. Invitația este personală, de unică folosință și expiră în [14] zile. Menuvia alege Șefii.
2.4. **Șeful nu primește nicio remunerație pentru simpla recrutare.** Bonusul de coordonare se naște **numai** din Facturi plătite ale unor Clienți reali aduși de Agenții lui (art. 3).

## 3. Bonusul de coordonare

3.1. **Cota: 20%** din **Comisionul fiecărui Agent al Șefului**, calculat pe fiecare rând de Comision (activare și recurent) al Agentului, la momentul scrierii lui.
3.2. **Cine plătește:** Bonusul este plătit **de Menuvia, în plus** față de Comisionul Agentului; **NU se scade din Comisionul Agentului**. Agentul își primește integral Comisionul.
3.3. **Condiții:** Bonusul se acordă doar dacă (a) Comisionul Agentului există (adică are la bază Facturi plătite reale), (b) Agentul este activ și Atribuirea valabilă, (c) Șeful este activ și are contractul acceptat și CUI validat.
3.4. **Reținere și retragere:** Bonusul are **aceeași perioadă de reținere** ca Comisionul de la care provine (60 zile pentru activare, 14 zile pentru recurent) și se **retrage proporțional** când Comisionul respectiv se retrage (rambursare sau dispută pierdută, art. 5.6 din Contractul de Agent).
3.5. **Rotunjire:** în jos la ban pe fiecare rând de Bonus.
3.6. **Exemple (informativ; fără garanție de venit), pe un Client adus de un Agent al Șefului:**

| Plan | Comision Agent (setup + 12 recurente) | Bonus Șef 20% |
|---|---:|---:|
| Meniu Digital + Rezervări (99 lei) | 148,50 lei | 29,70 lei |
| Meniu + Comenzi (249 lei) | 373,50 lei | 74,70 lei |
| Fiscalizare (499 lei) | 748,50 lei | 149,70 lei |

(Costul total pentru Menuvia = Comisionul Agentului + Bonusul Șefului = 120% din Comisionul Agentului; ≈ 13,8% din venitul primelor 13 luni de abonament plătit.)

3.7. **Procentele sunt înghețate pe fiecare Client la momentul Atribuirii**; o modificare ulterioară a cotei se aplică doar Clienților noi, cu preaviz de [30] zile.
[Notă tehnică: în cod, cota bonusului (`cascade_bps`) este azi 200 (2%); decizia fondatorului este 2000 (20%), schimbată în pachetul 8 doar dacă valoarea e încă 200 — vezi `04-fisa-decizii-D1-D15.md`, D8 și nota de acolo.]

3.8. Bonusul se plătește **lunar**, cu aceleași reguli de prag minim, plată (Stripe Connect Express) și facturare (autofactură sau factură) ca în art. 7 din Contractul de Agent.
[NOTĂ AVOCAT: structura bonusului de 20% din comisionul agentului, plătit de Menuvia, doar din vânzări reale — formularea clauzei din perspectiva Legii 363/2007 și a Directivei 2005/29/CE; vezi întrebările 14–18 din `02-email-avocat.md`.]

## 4. Invitarea și gestionarea Agenților

4.1. Șeful **invitează Agenți** prin aplicație, cu link personal de unică folosință. **Invitația Șefului ține loc de aprobare** a Agentului; Agentul nu devine activ decât după ce **acceptă Contractul de Agent** și declară CUI-ul.
4.2. Șeful invită **doar PFA sau societăți cu CUI, rezidente în România**, și doar persoane care au fost informate corect despre natura colaborării (independent, fără salariu, fără taxe).
4.3. **Șeful poate retrage o invitație neacceptată. Șeful NU poate suspenda, concedia sau penaliza un Agent**, nu poate bloca un Comision și nu poate modifica procentele; **suspendarea aparține exclusiv Menuvia** (art. 10.3 din Contractul de Agent). Șeful poate semnala în scris către Menuvia o suspiciune de încălcare.
4.4. Șeful **nu percepe nicio taxă** Agenților săi (intrare, instruire, kit, „asigurare”, abonament, oricare alt nume) și **nu condiționează** vreun beneficiu de plata unei sume sau de recrutarea altora. Toate materialele sunt gratuite.
4.5. Șeful **nu promite** Agenților câștiguri garantate, venit pasiv sau câștiguri din „construirea echipei”; folosește doar calculele oficiale și exemplele cu mențiunea de non-garanție (Anexa 2 din Contractul de Agent).
4.6. Șeful răspunde față de Menuvia pentru **conduita proprie** în coordonare. Răspunderea pentru fapte ale Agenților rămâne a Agenților. [NOTĂ AVOCAT: este acceptabilă o obligație a Șefului de „supraveghere rezonabilă” sau de a semnala abaterile? Ce nu trebuie să scriem ca să nu sugerăm subordonare (risc de reclasificare)?]
4.7. Șeful nu poate invita ca Agenți persoane care sunt deja Agenți ai altui Șef sau care au fost excluse de Menuvia.

## 5. Date personale; vizibilitate; GDPR

5.1. **Ce vede Șeful:** numele și numărul de telefon al Agenților lui (cu consimțământul fiecărui Agent, art. 9.5 din Contractul de Agent), starea lor (invitat, activ, suspendat), numărul de Clienți atribuiți și Comisioanele/Bonusul **agregate**. **Șeful nu vede** datele Clienților finali ai restaurantelor, datele de plată ale Agenților, IBAN-ul sau contul lor Stripe.
5.2. **Ce vede Agentul despre Șef:** numele și contactul Șefului (cu consimțământul Șefului, dat prin acest contract).
5.3. **Consimțământ (Șef):** Șeful consimte ca **numele și telefonul lui** să fie afișate Agenților lui și, după caz, patronilor Clienților atribuiți lui direct sau echipei lui; poate retrage consimțământul din aplicație.
5.4. **Acces la restaurante:** Șeful **nu** are, prin acest contract, acces la conturile Clienților Agenților lui. Accesul opt-in (art. 9.3–9.4 din Contractul de Agent) este al Agentului atribuit și se acordă doar de patron.
5.5. Confidențialitatea și art. 29 GDPR se aplică Șefului ca Agentului (art. 9.1, 9.4). **Datele Agenților** primite de Șef (nume, telefon) pot fi folosite **doar** pentru coordonare și nu pot fi transmise unor terți.
5.6. Menuvia este operator pentru datele Șefilor și ale Agenților. Pentru ștergere se aplică art. 9.2 din Contractul de Agent.
[NOTĂ AVOCAT: Șeful devine operator autonom pentru datele de contact ale Agenților pe care le primește? Cum formulăm limitele?]

## 6. Durată; suspendare; încetare (diferențe)

6.1. Durata, preavizul ([15] zile), încetarea imediată și suspendarea sunt cele din art. 10 din Contractul de Agent.
6.2. **La suspendarea sau încetarea Șefului:** Bonusurile **deja câștigate** se plătesc la termenele normale (cu retragerile aplicabile); **Bonusurile viitoare se opresc**. **Agenții Șefului nu își pierd Comisioanele** și nu sunt suspendați automat; Menuvia îi poate **realoca** unui alt Șef sau îi poate trata ca Agenți direcți, cu notificare. Atribuirile Clienților rămân ale Agenților.
6.3. Bonusul **nu continuă** automat pe Clienții Agenților după încetarea contractului Șefului, decât dacă părțile convin altfel [VARIANTA A: se oprește / VARIANTA B: continuă până la plafonul de 12 facturi pentru Clienții atribuiți înainte de încetare]. [NOTĂ AVOCAT: aceeași chestiune ca la art. 10.4 din Contractul de Agent.]

## 7. Interdicții (suplimentare)

7.1. Pe lângă art. 4 din Contractul de Agent, sunt interzise: (a) orice taxă sau cost impus Agenților; (b) recrutarea prin promisiuni de venit din „echipă”; (c) presiunea asupra Agenților de a se abona la Platformă ei înșiși; (d) crearea de „Agenți fictivi” pentru a crește Bonusul; (e) utilizarea datelor Agenților pentru alte produse sau scopuri; (f) orice mecanism prin care Șeful ar primi sume pentru recrutare, nu pentru vânzări reale.
7.2. Încălcarea gravă atrage suspendarea sau încetarea imediată și poate duce la anularea Bonusurilor aferente (fraudă dovedită, art. 10.3 din Contractul de Agent).

## 8. Dispoziții finale

Se aplică art. 12 din Contractul de Agent (drept român, notificări, cesiune, limba) și acceptarea în aplicație cu versiune și hash păstrate în istoricul append-only (art. 3.4 din Contractul de Agent), împreună cu CUI-ul declarat. **Acceptarea contractului de Șef este condiție a invitațiilor**: nu se pot trimite invitații de Agent cât timp nu există o versiune publicată a Contractului de Agent.

---

## Anexa 1 — Parametri tehnici (informativ, modificabili cu preaviz)

| Parametru | Valoare la lansare | Sursa în cod / plan |
|---|---|---|
| Nivele | 2 (Șef → Agenți); impus în date | `trg_affiliate_depth1`, mig 097 |
| Bonus de coordonare | 20% din Comisionul Agentului, plătit de Menuvia peste Comision | `cascade_bps`; 200 azi → 2000 în pachetul 8 |
| Reținere/retragere Bonus | ca Comisionul sursă | mig 099, 293 |
| Invitația de Șef / de Agent | de unică folosință, expiră în [14] zile, token stocat ca hash | plan pachet 8 |
| Aprobare Agent | invitația Șefului ține loc | plan D8 |
| Suspendare | doar Menuvia | plan D9 |
