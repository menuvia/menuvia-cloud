# Politica de Cookies

> **⚠️ DRAFT pentru aviz avocat — NU e valabil juridic până la completarea entității și avizare.**
> Toate mențiunile despre operator folosesc placeholder-ul de mai jos și trebuie completate înainte de publicare.

**Operator:** `[MENUVIA S.R.L. — în curs de constituire, CUI: ___, sediu: ___]`
**Contact protecția datelor:** privacy@menuvia.ro
**Versiune:** DRAFT v1.0 — 4 august 2026
**Se aplică pentru:** menuvia.netlify.app (în curând menuvia.ro), inclusiv meniurile publice `/m/:slug`, paginile de comandă prin QR și panoul de administrare (dashboard).

---

## 1. Ce este acest document

Această politică explică ce cookie-uri și tehnologii similare (localStorage, sessionStorage) folosește platforma Menuvia, în ce scop, cât timp, și cum îți poți da sau retrage consimțământul. Este redactată în conformitate cu:

- **Regulamentul (UE) 2016/679 (GDPR)** — în special art. 6 și art. 7 (consimțământ);
- **Legea nr. 190/2018** privind măsuri de punere în aplicare a GDPR în România;
- **Legea nr. 506/2004** privind prelucrarea datelor cu caracter personal în sectorul comunicațiilor electronice (transpunerea Directivei ePrivacy) — temeiul obligației de consimțământ pentru cookie-urile care nu sunt strict necesare.

„Cookie-uri și tehnologii similare" înseamnă aici: cookie-uri HTTP propriu-zise, chei **localStorage** (persistă până la ștergere) și chei **sessionStorage** (se șterg automat la închiderea tab-ului). Le tratăm identic din perspectiva transparenței, chiar dacă tehnic diferă.

## 2. Principiul de bază: nimic neesențial fără consimțământ

Menuvia funcționează pe modelul **opt-in**:

- La prima vizită, un **banner de consimțământ** apare în partea de jos a paginii. Până nu faci o alegere, se folosesc **doar** tehnologiile strict necesare.
- Instrumentele de măsurare și monitorizare (**PostHog** — analytics, **Sentry** — monitorizare erori) **nu se încarcă deloc** în browser fără consimțământul tău pentru categoria „Performanță". Nu este vorba doar de blocarea trimiterii de date: codul acestor servicii nici măcar nu este descărcat până la acordul tău.
- Banner-ul oferă trei opțiuni echivalente ca accesibilitate: **„Acceptă toate"**, **„Doar necesare"** și **„Personalizează"** (comutatoare individuale pe categorii). Refuzul este la fel de simplu ca acceptarea.
- Alegerea ta este salvată local (cheia `menuvia_cookie_consent`), împreună cu un marcaj de timp, pentru a putea dovedi și respecta decizia ta.

**Menuvia nu folosește în prezent niciun cookie de marketing sau publicitate** (fără pixeli de remarketing, fără rețele publicitare, fără profilare în scop comercial).

## 3. Categoriile de cookie-uri și chei de stocare

### 3.1. Strict necesare (nu necesită consimțământ)

Acestea sunt indispensabile funcționării serviciului cerut de tine (autentificare, plasarea comenzii, plata la masă, atribuirea corectă în programul de afiliere). Temeiul: art. 4 alin. (6) din Legea 506/2004 (exceptare pentru stocarea strict necesară furnizării serviciului cerut expres de utilizator) și art. 6 alin. (1) lit. (b)/(f) GDPR.

| Nume | Tip | Scop | Durată |
|---|---|---|---|
| `menuvia_cookie_consent` | localStorage | Reține alegerea ta privind cookie-urile (categorii acceptate + data alegerii). Fără ea, banner-ul ar reapărea la fiecare vizită. | Până la ștergere manuală sau schimbarea preferințelor |
| `sb-…-auth-token` (Supabase) | localStorage | Sesiunea de autentificare pentru conturile de restaurant/staff (dashboard). Nu se setează pentru clienții care doar scanează meniul. | Până la delogare / expirarea sesiunii |
| `mv_ref` | Cookie propriu (first-party, `SameSite=Lax`, `Secure` pe HTTPS) | Reține codul de recomandare când ajungi pe site printr-un link de afiliat (`/r/:cod`), pentru atribuirea corectă a comisionului la abonare. Cookie funcțional de atribuire, **nu** de tracking publicitar: nu urmărește navigarea, nu se partajează cu rețele de publicitate. | **90 de zile** |
| `mv_vid` | Cookie propriu (first-party, `SameSite=Lax`, `Secure` pe HTTPS) | Identificator anonim de vizitator (UUID generat aleator în browser), folosit exclusiv pentru a corela vizita pe linkul de afiliat cu o eventuală abonare ulterioară (validarea atribuirii). Nu este legat de nume, e-mail sau alt identificator direct. | **90 de zile** |
| `menuvia_active_restaurant` | localStorage | Reține ce restaurant ai selectat în dashboard (pentru conturile cu acces la mai multe localuri). Doar utilizatori autentificați. | Până la delogare / ștergere |
| `menuvia_idem:<token>` | sessionStorage | Cheie de idempotență a comenzii prin QR: împiedică trimiterea dublă a aceleiași comenzi la un refresh sau „back" pe telefon. | Până la închiderea tab-ului |
| `menuvia_split_pid_<sesiune>` | sessionStorage | La plata online la masă cu notă împărțită: reține intenția de plată în curs, ca să nu se creeze plăți duplicate dacă reîncarci pagina. | Până la închiderea tab-ului |
| `menuvia.plan_intent` | sessionStorage | Reține planul de abonament ales pe pagina de prețuri, ca să fii dus direct la checkout după autentificare. | Până la închiderea tab-ului |
| `menuvia.afiliat_intent` | sessionStorage | Reține intenția de înscriere în programul de afiliere pe durata fluxului de autentificare. | Până la închiderea tab-ului |
| `menuvia_onboarding_preset` | localStorage | Reține tipul de local ales la configurarea inițială a contului (preset de onboarding). | Până la finalizarea onboarding-ului / ștergere |
| `menuvia_founder_view`, `menuvia_founder_view_from` | localStorage | Chei interne de administrare a platformei (mod de vizualizare pentru echipa Menuvia și partenerii agenție). Nu se setează pentru clienți sau restaurante. | Până la ieșirea din modul respectiv |

### 3.2. Performanță / măsurare (necesită consimțământ)

Se activează **numai** dacă bifezi „Performanță" în banner. Temeiul: consimțământul tău (art. 6 alin. (1) lit. (a) GDPR).

| Serviciu | Ce stochează | Scop | Durată | Destinatar |
|---|---|---|---|---|
| **PostHog** (analytics) | Chei `ph_*` în **localStorage** (configurat deliberat să nu folosească cookie-uri) | Statistici de utilizare a produsului (ex. pagini vizitate, pași de onboarding finalizați). Configurare orientată spre minimizare: **IP-ul nu este transmis**, profilurile se creează doar pentru utilizatori autentificați (nu pentru vizitatori anonimi), înregistrarea sesiunilor (session recording) este **dezactivată**, capturarea automată a click-urilor este dezactivată, iar semnalul „Do Not Track" din browser este **respectat**. Date procesate pe serverele PostHog din **UE** (eu.i.posthog.com). | Până la retragerea consimțământului / ștergerea datelor din browser | PostHog (UE) |
| **Sentry** (monitorizare erori) | Nu setează cookie-uri de tracking; transmite rapoarte de eroare tehnică | Detectarea și repararea erorilor aplicației. Configurat cu `sendDefaultPii: false` și filtre înainte de transmitere: se elimină query string-urile din URL-uri (pot conține token-uri), antetele `Authorization` și `Cookie`, precum și câmpurile e-mail/telefon din contextul erorii. Datele pot fi procesate pe servere Sentry din **SUA** — transfer în temeiul clauzelor contractuale standard / mecanismelor de adecvare aplicabile (de confirmat la avizare, împreună cu DPA-ul Sentry). | Sesiune | Sentry (SUA) |

La **retragerea** consimțământului de performanță: PostHog este oprit (`opt_out`) și identitatea locală este ștearsă (`reset`); Sentry nu mai este inițializat la următoarea încărcare a paginii.

### 3.3. Funcționale (necesită consimțământ)

Categoria „Funcționale" din banner acoperă facilități de confort care nu sunt indispensabile serviciului de bază: **notificări push** (prin service worker-ul aplicației), temă și preferințe avansate de interfață. Dacă nu bifezi această categorie, aceste facilități rămân dezactivate, iar restul platformei funcționează normal.

*Notă tehnică: service worker-ul aplicației (`/sw.js`) se înregistrează pentru infrastructura de notificări, dar abonarea efectivă la notificări push cere atât consimțământul din banner, cât și permisiunea explicită separată a browserului.*

### 3.4. Marketing / publicitate

**Nu folosim.** Nu există cookie-uri de publicitate, remarketing sau profilare comercială pe platformă. Dacă acest lucru se va schimba, politica va fi actualizată în prealabil, iar categoria va apărea în banner ca opțiune separată, dezactivată implicit.

## 4. Cum îți dai și îți retragi consimțământul

**Acordare.** La prima vizită, banner-ul „Cookies" îți oferă: *Acceptă toate*, *Doar necesare* sau *Personalizează* (alegi categoriile individual). Nicio categorie opțională nu este pre-bifată.

**Retragere / modificare — oricând, la fel de ușor ca acordarea:**

1. Apasă linkul **„Setări cookies"** din subsolul paginilor — banner-ul se redeschide cu preferințele tale curente, pe care le poți modifica și salva. Debifarea categoriei „Performanță" oprește imediat PostHog și șterge identitatea locală de analytics.
2. Alternativ, poți șterge datele site-ului din setările browserului (cookies + „date site" / stocare locală). La următoarea vizită, banner-ul va reapărea ca la prima utilizare.

Retragerea consimțământului nu afectează legalitatea prelucrărilor efectuate înainte de retragere (art. 7 alin. (3) GDPR).

**Setări de browser.** Poți configura browserul să blocheze sau să șteargă cookie-urile în general (Chrome, Firefox, Safari, Edge au instrucțiuni dedicate în paginile lor de asistență). Blocarea tehnologiilor strict necesare poate face imposibilă autentificarea sau plasarea comenzilor.

## 5. Ce NU facem prin cookie-uri

- Nu vindem și nu închiriem date obținute prin cookie-uri.
- Nu folosim cookie-uri terțe de publicitate și nu construim profiluri publicitare.
- Nu urmărim vizitatorii anonimi ai meniurilor publice cu instrumente de analytics fără consimțământ — meniul QR se încarcă fără niciun script de măsurare până la acordul tău.
- Cookie-urile de afiliere (`mv_ref`, `mv_vid`) nu urmăresc navigarea ta pe alte site-uri și nu sunt partajate cu terți în scop de marketing; servesc exclusiv atribuirii interne a comisionului către afiliatul care te-a recomandat.

## 6. Date personale prelucrate prin alte mijloace

Cookie-urile nu sunt singura formă de prelucrare de date pe platformă (ex.: rezervări cu număr de telefon, program de fidelizare cu telefon stocat exclusiv sub formă de hash ireversibil, facturi fiscale păstrate 10 ani conform Legii contabilității nr. 82/1991, formulare de contact/recrutare). Aceste prelucrări sunt descrise în **Politica de Confidențialitate** — documentul de față acoperă strict tehnologiile de stocare din browser.

## 7. Destinatari și transferuri

Singurele terțe părți care pot primi date prin tehnologiile descrise aici, și numai cu consimțământul tău, sunt:

- **PostHog** — analytics, găzduire **UE**;
- **Sentry** — monitorizare erori, găzduire **SUA** (transfer internațional; garanții: clauze contractuale standard / mecanism de adecvare — *de confirmat la avizare*).

Celelalte servicii ale platformei (Supabase, Netlify, Stripe, Resend, SMSO.ro, Oblio, FiscalNet, OpenAI prin proxy propriu) nu setează cookie-uri de tracking prin site-ul Menuvia; rolul lor este descris în Politica de Confidențialitate și în DPA.

## 8. Drepturile tale și plângeri

Ai drepturile prevăzute de GDPR (acces, rectificare, ștergere, restricționare, opoziție, portabilitate, retragerea consimțământului). Cereri: **privacy@menuvia.ro**.

Ai dreptul să depui o plângere la **Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP)** — [www.dataprotection.ro](https://www.dataprotection.ro), B-dul G-ral Gheorghe Magheru 28-30, București.

## 9. Modificări ale politicii

Putem actualiza această politică atunci când adăugăm sau eliminăm tehnologii de stocare. Versiunea curentă și data ei apar în antet. Pentru modificări care introduc categorii noi ce necesită consimțământ, banner-ul îți va cere din nou acordul.

---

*`[MENUVIA S.R.L. — în curs de constituire, CUI: ___, sediu: ___]` — document DRAFT, generat pentru aviz juridic. A nu se publica înainte de: (1) completarea datelor entității; (2) confirmarea mecanismului de transfer pentru Sentry (SUA); (3) verificarea finală a listei de chei de stocare față de codul deployat; (4) avizarea de către un avocat specializat în protecția datelor.*
