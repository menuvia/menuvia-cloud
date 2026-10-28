# 02 — Email către avocat (un singur pachet, D14)

> **Pentru cine e:** fondatorul. Copiezi blocul „Corpul emailului”, completezi `[...]`, atașezi fișierele din lista de mai jos și trimiți.
> **Când:** Ședința 1, pasul 1 (15 min împreună cu emailul către contabil, `01-email-contabil.md`).
> **Principiu:** un SINGUR pachet către avocat (D14), ca să plătești o singură dată revizuirea și ca textele să fie coerente între ele. Toate formulările sunt ÎNTREBĂRI: nu conțin concluzii juridice.
> **Important:** răspunsurile contabilului (TVA, autofacturare) schimbă clauzele din contract. Când le ai, trimite-le avocatului: întrebările 7–8 (TVA pe prețuri) și 17 (autofacturare) din emailul către contabil (vezi nota de la final).

## Ce faci, în ordine

1. Alegi un avocat cu experiență în **drept comercial + protecția datelor (GDPR) + contracte de colaborare/agenție**. Cere ofertă fixă pe pachet (nu pe oră), cu termen de predare.
2. Atașezi fișierele din tabelul de mai jos. **Toate sunt în repo**; exportă-le în PDF/Word dacă avocatul nu lucrează cu Markdown (spune-mi dacă vrei să le export eu).
3. Trimiți emailul. Spui explicit că **SRL-ul e în curs de constituire** (date definitive după Ședința 2) și că textele conțin placeholdere.
4. Când avocatul răspunde: copiezi răspunsurile **numerotate ca în email (1–31)** într-un singur mesaj către mine. Eu le pun în contractul v1, în pachetul 9 (Termeni/Confidențialitate/DPA/Cookies) și în pachetul 8 (invitații).

## Fișiere de atașat

| # | Fișier din repo | Ce conține | Stare |
|---|---|---|---|
| 1 | `docs/dosar/03-contract-agent-v1-draft.md` | Contract de colaborare agent (marketing / lead-generation) — DRAFT | scris pentru avocat |
| 2 | `docs/dosar/03b-contract-sef-vanzari-v1-draft.md` | Contract șef de vânzări (coordonator) — DRAFT | scris pentru avocat |
| 3 | `menuvia-pack/02-DRAFT-TERMENI.md` | Termeni și Condiții (clienți B2B: restaurantele) | DRAFT v0.1, are banner DRAFT |
| 4 | `menuvia-pack/03-DRAFT-CONFIDENTIALITATE.md` | Politica de Confidențialitate (art. 13/14 GDPR) | DRAFT v1.0, are banner DRAFT |
| 5 | `menuvia-pack/04-DRAFT-COOKIES.md` | Politica de cookie-uri și stocare locală | DRAFT, are banner DRAFT |
| 6 | `menuvia-pack/05-DRAFT-DPA.md` | Acord de prelucrare a datelor (art. 28 GDPR) cu restaurantul, cu Anexa 2 (sub-procesatori) | DRAFT, are banner DRAFT |
| 7 | `docs/AFFILIATE_PROGRAM.md` §4 și §5 | Subafiliați, liniile roșii anti-piramidă, întrebările juridice deja puse | Document intern, v2 |
| 8 | `docs/vanzare/AFILIATI_KIT.md` | Materialele de vânzare pentru agenți (ce vor citi agenții) | Intern |

**NU atașa** `menuvia-pack/06-DRAFT-CODVIA-COMENZI.md` (Codvia e în pauză; nu face parte din acest pachet) și nu atașa nimic cu chei, parole sau adrese de producție.

> **Atenție la o contradicție pe care o știm:** `docs/AFFILIATE_PROGRAM.md` §1.1 descrie încă unele reguli vechi (comision doar pe Plan 3, setup la prima factură). Codul de pe `main` face altceva (migrația 293: comision pe toate planurile plătite; setup scris la a DOUA factură plătită). Contractele din `docs/dosar/` urmează **codul**. Vezi `03-contract-agent-v1-draft.md`, art. 5 și Anexa 1.

## Subiect

```text
Subiect: Pachet juridic pentru lansarea Menuvia (SaaS B2B + rețea de agenți) — contracte, GDPR, termeni — ofertă și termen
```

## Corpul emailului

```text
Bună ziua,

Mă numesc [NUME PRENUME], sunt fondatorul Menuvia, un produs software (SaaS) pentru restaurante din România: meniu digital cu cod QR, comenzi și rezervări. Societatea [DENUMIRE SRL] este în curs de constituire (CUI/sediu urmează în ~2–3 săptămâni; în texte apar placeholdere). Aș vrea să vă propun un SINGUR pachet de revizuire, cu ofertă fixă și termen, care să acopere: contractele pentru rețeaua noastră de vânzări, verificarea structurii din perspectiva practicilor comerciale (anti-„piramidă”), GDPR pentru rolul agenților și textele juridice ale platformei. Atașez ciornele noastre (marcate DRAFT) și mai jos vă pun întrebări concrete. Nu vă cer să rescrieți totul: vă rog să marcați ce trebuie schimbat și să propuneți formulări.

CE ESTE PRODUSUL (în 5 rânduri)
- Platformă web pentru restaurante, vândută pe abonament lunar (99 / 249 / 499 lei), doar B2B (clienții sunt restaurante, PFA sau societăți din România).
- Date personale prelucrate: conturi de patron/personal (Menuvia = operator); date ale clienților finali ai restaurantelor (rezervări, comenzi, loyalty cu telefon pseudonimizat) — aici Menuvia este persoană împuternicită, iar restaurantul operator (DPA).
- Plăți: abonamentele de 99 și 249 lei prin Stripe Checkout (planul de 499 lei e în pilot, fără checkout self-serve); plata online la masă prin Stripe Connect (doar pe un plan, cu modulul activ). Plata comisioanelor către agenți este azi manuală (Wise); plata automată prin Stripe Connect Express este PLANIFICATĂ.
- Infrastructură: Supabase (baza de date), Netlify (găzduire), Resend (email), SMSO.ro (SMS), Oblio (facturi), Stripe (plăți), Sentry/PostHog (doar cu consimțământ), furnizori AI (OpenAI, Anthropic, Google Gemini) pentru funcții AI opționale ale restaurantului.
- Vindem prin noi și printr-o rețea de agenți independenți (doar PFA/SRL cu CUI), cu două niveluri: „agent” și „șef de vânzări” (coordonator).

PACHETUL CERUT
(a) Contract pentru agent și contract pentru șef de vânzări (ciorne atașate), cu acceptare în aplicație.
(b) Opinie pe structura de comisionare din perspectiva Legii 363/2007 (practici comerciale incorecte, inclusiv „sistem piramidal”), Directivei 2005/29/CE și jurisprudenței CJUE (4finance, C-515/12).
(c) GDPR: rolul agentului cu acces limitat la datele unui restaurant; consimțământ pentru afișarea datelor de contact între agent, șef și patron; lista de sub-procesatori.
(d) Textele platformei, în română, finale: Termeni și Condiții, Confidențialitate, DPA, cookie-uri.
(e) Regula de atribuire a clienților („primul link sau cod câștigă”) și dovada acceptării Termenilor.

A. CONTRACTE (agent și șef de vânzări)
1. Natura contractului: am gândit relația ca prestări servicii de marketing / generare de clienți potențiali (lead-generation), NU contract de agenție comercială și NU contract de muncă: agentul nu negociază, nu semnează, nu primește bani de la client; clientul contractează direct cu noi, online, prin Stripe. Sunteți de acord cu această încadrare? Ce elemente din clauze sau din practică ar putea duce la reclasificare (contract de muncă sau agenție)? Ce adăugați/scoateți (non-exclusivitate, lipsa programului impus, folosirea resurselor proprii, lipsa unui target obligatoriu)?
2. Indemnizația de clientelă (art. 2082–2095 Cod civil): dacă încadrarea ar fi totuși de agenție, plafonul nostru de 12 facturi lunare comisionate (după care comisionul se oprește) poate fi prezentat ca durată a contraprestației (cu un considerent explicit), nu ca renunțare? Ce formulare recomandați?
3. Doar PFA sau SRL, cu CUI obligatoriu: e suficient CUI-ul validat de noi la acceptarea contractului, sau cereți și alte verificări (certificat constatator, status TVA)? Ce facem cu un PFA ocazional versus o societate cu volum mare de vânzări sau cu exclusivitate de facto? Ce clauze reduc riscul de recalificare?
4. Prag minim de plată: plățile se fac lunar, automat, prin Stripe Connect (cont Express al agentului), doar dacă soldul disponibil depășește un prag minim (45 lei la lansare), iar suma sub prag se reportează în luna următoare. Pragul va putea fi modificat cu preaviz. Ce preaviz minim e rezonabil și ce clauză de modificare unilaterală este permisă între profesioniști?
5. Schimbarea contractului: preaviz de [30] zile pentru modificări ale cotelor sau pragului; modificările se aplică doar clienților NOI atribuiți după data intrării în vigoare (procentele sunt „înghețate” pe fiecare client la atribuire). E suficient, sau cereți acceptare expresă?
6. Încetare: durată nedeterminată, încetare cu preaviz de [15] zile, încetare imediată pentru încălcări grave. La încetare fără culpă, ce se întâmplă cu comisionul pentru clienții deja aduși — continuă până la plafonul de 12 facturi sau se oprește? Am pus ambele variante între paranteze; care e cea sigură juridic?
7. Suspendare (D9): putem suspenda un agent pentru suspiciune de încălcare; la suspendare, comisioanele DEJA câștigate (după perioadele de reținere) se plătesc, iar cele viitoare se opresc; anularea pentru fraudă dovedită este excepție. Este echilibrat? Ce garanții procedurale trebuie scrise (notificare, termen de răspuns, drept la explicații)?
8. Fără taxă de intrare, fără kit plătit, fără recompensă pentru propriul abonament al agentului, fără comision pentru simpla recrutare: am pus aceste interdicții ca clauze contractuale și ca texte în aplicație. Mai adăugați ceva (de ex. interzicerea „garantării” de câștiguri, a taxelor de „instruire”, a vânzării de materiale către agenți)?
9. Răspunderea: limitarea răspunderii Menuvia (nicio garanție de venit; indisponibilități ale platformei; modificări de preț), răspunderea agentului pentru declarații false făcute clienților. Ce plafon și ce clauze penale sunt valabile între profesioniști?
10. Clauza de recuperare (clawback): comisionul se retrage proporțional dacă clientul primește rambursare sau pierdem o dispută de card. Nu se retrage la simpla anulare a abonamentului fără rambursare. Poate retragerea să se facă prin compensare cu plățile viitoare? Ce se întâmplă cu soldul negativ al unui agent care încetează colaborarea?
11. Autofacturarea comisioanelor (art. 319 alin. 18 Cod fiscal): Menuvia emite lunar, în numele agentului, factura de comision (tip e-Factura 389), pe baza unui acord prealabil și a unei proceduri de acceptare (contabilul confirmă separat aspectele fiscale). Ce clauză contractuală cuprinde acordul prealabil, procedura de acceptare/contestare și termenul? Ce formulare protejează agentul și pe noi dacă agentul nu răspunde?
12. Drept aplicabil: dreptul român. Instanța competentă: [SEDIUL SRL]. Mediere prealabilă opțională? Clauză compromisorie? Ce recomandați?
13. Acceptare în aplicație (click-accept): agentul/șeful acceptă contractul într-un ecran dedicat, cu versiunea contractului și momentul acceptării păstrate într-un istoric care nu se șterge niciodată (append-only), alături de CUI-ul declarat. Este suficientă o acceptare electronică fără semnătură electronică calificată? Ce date trebuie salvate ca dovadă (versiune, hash al textului, IP, user-agent, data, contul)?

B. ANTI-PIRAMIDĂ (structura cu două niveluri)
14. Structura: șeful de vânzări este INVITAT de noi (nu se înscrie liber); șeful își invită agenții, iar agenții intră doar cu linkul lui. Baza de date permite exact un nivel sub șef (un agent nu poate avea sub el alți agenți). Șeful primește un bonus de 20% din comisionul agenților lui (plătit de Menuvia, NU scăzut din comisionul agentului), calculat doar din vânzări reale (abonamente plătite de clienți finali). Nu există taxă de intrare, nu se plătește nimic pentru recrutare în sine. Intră această structură sub „sistem piramidal” (Anexa 1 pct. 14 din Legea 363/2007 și Anexa I pct. 14 din Directiva 2005/29/CE)? Care sunt cei mai importanți factori de risc, în opinia dumneavoastră, și ce schimbăm?
15. Liniile roșii pe care le-am pus ca regulă internă (necondiționate): fără taxă de intrare/kit plătit; plată doar din vânzări reale către clienți finali; nicio recompensă condiționată de abonarea proprie a agentului; niciun nivel fără legătură cu o vânzare reală; fără „câștiguri garantate din echipă”. Sunt suficiente? Dacă nu, ce lipsește?
16. Alternativa „coordonator”: bonusul coordonatorului ca override pe vânzările echipei lui, nu pe recrutare. Ați formula-o diferit? Cât de mult contează denumirea („șef de vânzări”, „coordonator”) față de mecanismul de plată?
17. Materiale de promovare: ce mesaje către potențialii agenți sunt interzise (de ex. „venit pasiv”, „construiește-ți echipa”)? Putem arăta calculatoare de câștig? În ce condiții (declarații de non-garanție, exemple)?
18. Este nevoie de notificări sau avize (ANPC, ONRC, alte autorități) pentru un astfel de program?

C. GDPR
19. Acces limitat al agentului la un restaurant: dacă patronul aprobă (opt-in, revocabil oricând), agentul vede și configurează DOAR meniul și mesele/codurile QR ale restaurantului (nu vede comenzi, rezervări, date ale clienților finali, date fiscale, setări sau echipă). Ce calitate are agentul în raport cu restaurantul (operator): persoană autorizată să prelucreze sub autoritatea operatorului (art. 29 GDPR), sub-împuternicit al Menuvia (art. 28 alin. 4) sau altceva? Ce clauză de confidențialitate și ce obligații (acces doar pentru configurare, fără copiere, fără utilizare în alte scopuri, restituire la încetare) recomandați?
20. Consimțământul pentru afișarea datelor de contact: patronul vede numele și telefonul agentului care l-a adus; șeful vede numele și telefonul agenților lui. Pe ce temei facem asta (consimțământ, interes legitim, executarea contractului) și ce text de informare/consimțământ punem în ecranul de acceptare al contractului? Poate agentul retrage consimțământul și ce se întâmplă atunci cu relația?
21. Datele agenților: nume, telefon, email, CUI, denumire, IBAN (tratat de Stripe, nu stocat de noi), istoricul comisioanelor. Retenție: evidența fiscală 10 ani; la cererea de ștergere (Art. 17) detașăm identitatea și păstrăm doar ledger-ul/payout-urile pentru evidență. Este acest model acceptabil? Pe ce temei le păstrăm?
22. Rolurile: pentru datele agenților și ale lead-urilor Menuvia este operator. Pentru datele clienților finali ai restaurantelor (rezervări, comenzi) Menuvia este persoană împuternicită prin DPA. Confirmați structura și că DPA-ul din pachet o acoperă corect?
23. Lista de sub-procesatori: în Anexa 2 a DPA sunt Supabase, Netlify, Stripe, Resend, SMSO.ro, Oblio, FiscalNet/EconMedia, Sentry (doar cu consimțământ) și OpenAI. În cod mai apar: PostHog (analytics, doar cu consimțământ, găzduire UE), Anthropic și Google Gemini (funcții AI opționale, cheia platformei sau a restaurantului), serviciile de push ale browserelor (notificări push), Google Fonts (fonturi încărcate din CDN-ul Google pe toate paginile — urmează să le găzduim noi) și GitHub (backup criptat al bazei de date). Care dintre acestea trebuie trecute ca sub-procesatori, care ca operatori separați, și cum formulăm lista și mecanismul de obiecție? Ce garanții de transfer (SCC / DPF) cereți să verificăm pentru fiecare? (Regiunea proiectului Supabase: [UE — de confirmat].)
24. Notificarea încălcărilor de securitate (art. 33) și responsabilul cu protecția datelor: confirmați că nu este necesar DPO? Ce procedură internă de notificare cereți?

D. PAGINILE OASPEȚILOR, COOKIE-URI, TELEMETRIE
25. Vrem ca paginile pe care intră clienții finali (meniul din QR, pagina /m/<restaurant>, rezervări) să nu afișeze NICIUN banner de cookie-uri, folosind doar stocare locală strict necesară (ex. coșul de comandă, cheia de dedublare a comenzii, sesiunea mesei, limba aleasă) și nicio unealtă de analytics terță parte. Telemetria noastră pe aceste pagini ar fi proprie (erori și metrici de performanță) și fără date de identificare (fără IP stocat, fără identificator persistent). Este această abordare conformă cu Legea 506/2004 și cu GDPR? Ce trebuie să scriem în politica de cookie-uri și de confidențialitate ca să fie corect, și ce NU avem voie să stocăm fără consimțământ?
26. Pe aceleași pagini colectăm azi: numărul scanărilor de QR (cu user-agent, păstrat 30 de zile, apoi anonimizat) și, la recenzii/feedback, adresa IP și user-agent (păstrate 30 de zile). Sunt datele „personale” în sensul GDPR? Ce temei și ce informare cereți? Merită să renunțăm la colectarea IP-ului la feedback?
27. Banner-ul de cookie-uri rămâne pe paginile restaurantelor (dashboard) și pe site-ul de prezentare, cu analytics (PostHog) și monitorizare (Sentry) doar cu acord. Este structura (necesare / performanță / funcționale) corectă?

E. TERMENI, CONFIDENȚIALITATE, DPA, ATRIBUIRE, DOVADA ACCEPTĂRII
28. Termenii (B2B): vă rog să verificați clauzele de răspundere, SLA/„best effort”, încetare, rezilierea la neplată, perioada de probă de 30 de zile (fără card), modulul de fiscalizare (clientul rămâne responsabil de casa de marcat și de legislația fiscală), prețurile fără/cu TVA (contabilul confirmă regimul), schimbarea prețurilor cu preaviz.
29. Atribuirea clienților la agenți: regula „primul link sau cod câștigă, iar decizia sistemului este finală”; codul de agent se poate introduce doar pe conturi noi (în primele 14 zile, fără plată anterioară, fără altă atribuire, nu pe propriul cont). Sunt aceste reguli opozabile agenților prin contract? Cum scriem excluderea contestațiilor (exceptând eroarea tehnică dovedită)?
30. Dovada acceptării Termenilor: azi păstrăm o singură dată (prima acceptare) versiunea și data pe profil. Vrem un istoric versionat, care nu se șterge niciodată, cu fiecare acceptare (versiune, moment, hash al textului, IP/user-agent). E suficient pentru art. 7 alin. (1) GDPR și pentru probă într-un litigiu? Ce cereți să salvăm în plus?
31. Finalizare: după aviz, ce pași vă revin pentru a considera textele „finale” (eliminarea banner-ului DRAFT, semnătura, data intrării în vigoare, arhivarea versiunii)? Textele în engleză NU sunt necesare acum; le vom cere într-o fază ulterioară, dacă vom vinde în afara României.

OFERTĂ ȘI TERMEN
- Vă rog o ofertă fixă pentru pachetul de mai sus, cu termen de predare. Intenționez să lansez rețeaua după ce contractele sunt finale (prima plată către agenți va avea loc la câteva luni de la primele vânzări, deci avem puțin timp, dar nu zero).
- Dacă pachetul trebuie împărțit pe etape, propuneți ordinea: eu aș începe cu contractele (A–B) și GDPR (C), apoi textele platformei (D–E).
- Datele societății le voi trimite imediat ce le am: [DENUMIRE SRL], [CUI], [NR. ONRC], [SEDIU], [ADMINISTRATOR].

Mulțumesc!
[NUME PRENUME]
[TELEFON] · [EMAIL]
```

## Notă pentru fondator: legătura cu contabilul (nu trimite această secțiune)

- Întrebarea **11** (autofacturare) și **4** (prag) depind de răspunsul contabilului. Dacă contabilul răspunde NU la autofacturare, scoatem clauza 11 din contract (rămâne alternativa: agentul încarcă factura).
- Întrebarea **28** (TVA pe prețuri): textul final depinde de regimul de TVA decis de contabil.
- Întrebarea **3** (CUI/TVA agent): la lansare primim doar agenți PFA/SRL neplătitori de TVA, dacă contabilul confirmă (D13).

## Faptele din repo pe care se bazează întrebările (verificate pe `main` la commit-ul `6f6afcf5d58660f61dac1d223e4a0d2c9fb1e9c1`; după acel commit faptele se pot schimba)

| Fapt | Unde |
|---|---|
| Programul public de afiliere e ÎNCHIS (`affiliate_program_open=false`); rețeaua merge doar pe invitații (decizia D8) | mig 295; `docs/AFFILIATE_PROGRAM.md` |
| Adâncime impusă în date: părintele nu poate avea părinte; un afiliat cu copii nu poate primi părinte | mig 097 (trigger de adâncime) |
| Cascada (bonus șef) azi: `cascade_bps` = 200 (2%); planul îl urcă la 2000 (20%) în pachetul 8 | mig 099; plan §0.3 |
| Acces partener opt-in, doar meniu + mese/QR; nu vede comenzi, rezervări, date fiscale, setări, echipă | mig 286 |
| Ștergere GDPR a afiliatului: detașare + pseudonimizare, ledger păstrat | mig 295 |
| Termenii se consemnează o singură dată (`coalesce`) — istoricul append-only vine în pachetul 9 | mig 042 (`record_terms_acceptance`); `src/lib/terms.ts` (`TERMS_VERSION = '1.0'`) |
| `qr_scans.user_agent` și identificatorii tehnici din feedback: păstrați 30 de zile | mig 280 |
| Sub-procesatori în cod: Supabase, Netlify, Stripe, Resend, SMSO, Oblio (apeluri `oblio.eu`), Sentry, PostHog (`eu.i.posthog.com`), OpenAI, Anthropic, Google Gemini; Google Fonts încărcat din `index.html`. **Twilio NU este folosit** (apare doar într-un comentariu de config Supabase) | `netlify/functions/*`, `src/lib/analytics.ts`, `index.html`, `supabase/config.toml` |
