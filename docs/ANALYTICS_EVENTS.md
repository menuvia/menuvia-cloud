# Catalogul evenimentelor de analytics (PostHog)

Sursa unică a numelor e uniunea `AppEvent` din `src/lib/analytics.ts`. Orice nume
din uniune are cel puțin un emițător real (clichetul AE1 din
`src/lib/__tests__/analyticsEvents.test.ts`), orice emițător trimite doar un
obiect literal fără chei PII (AE2), iar tabelul de mai jos e EGAL cu codul (AE7:
aceleași evenimente și, pe fiecare, exact cheile din coloana „Proprietăți”). Un
eveniment nou se adaugă în ACELAȘI PR în uniune, în locul din cod unde serverul a
confirmat acțiunea și în tabel — altfel CI-ul pică.

## Unde ajung datele și ce NU ajunge

- Proiectul PostHog **356135**, regiunea **UE** (`https://eu.i.posthog.com`). Cheia
  `phc_` e publică prin construcție și stă DOAR în
  `[context.production.environment]` din `netlify.toml` și în pasul de build din
  `.github/workflows/deploy-vps.yml` (clichetul PE1–PE8 din
  `tests/functions/posthog-env.test.js`). `[build.environment]` și fiecare context
  care nu e producția (deploy preview, branch deploy, `develop`, `dev`) setează
  EXPLICIT `VITE_POSTHOG_KEY = ""`: valoarea din fișier bate UI-ul Netlify doar
  acolo unde fișierul setează cheia, deci altfel o cheie pusă în UI „pe toate
  contextele” ar fi ajuns în preview-uri (PE3). Niciun alt workflow nu setează
  `VITE_POSTHOG_*`, nici din `vars`/`secrets` (PE7), iar un token `phc_` real nu
  apare în niciun alt fișier comis (PE5, pe `git ls-files`). CI, E2E și local
  rulează fără cheie, deci fără analytics.
- Nimic nu se descarcă fără consimțământul „Performanță” din bannerul de cookie-uri:
  `posthog-js` se importă dinamic abia la acord. Fără loturi (`request_batching:
  false`, AN3): fiecare eveniment pleacă în momentul capturii, deci după o
  retragere nu mai rămâne în SDK niciun lot care să plece la timer sau la
  închiderea paginii (AN28); fără comprimare (`disable_compression: true`, AN3):
  gzip-ul asincron al SDK-ului pornea cererea abia după comprimare, fără să
  reverifice acordul; `before_send` aruncă oricum orice eveniment cât
  captura nu e pornită de modul. Revocarea face `reset(true)` și apoi
  `opt_out_capturing()`, în ordinea asta (testul AN8 explică de ce), ori de câte
  ori instanța TRĂIEȘTE în pagină, nu doar cu captura pornită aici (un `doInit`
  din alt tab șterge refuzul comun, iar SDK-ul de aici ar trece singur pe
  captură, AN31), iar cheile `ph_*` se șterg din localStorage și sessionStorage, inclusiv `$device_id` — și
  când PostHog nu e încărcat în pagină (AN17). Rămâne cel mult refuzul SDK-ului
  (`ph_menuvia_consent`, fără niciun identificator): cât instanța trăiește în
  pagină SDK-ul îl RECITEȘTE, deci nu se poate șterge, iar în browser stă până la
  acordul următor, când `doInit` îl șterge înainte de `init` (AN16). Rămâne și când
  revocarea vine dintr-un tab FĂRĂ PostHog: un tab vecin poate avea o instanță vie.
- **Acordul schimbat într-un alt tab** se aude și aici: `consent-updated` nu trece
  între tab-uri, deci ascultăm `storage` și verificăm acordul înaintea oricărui apel
  care poate atinge SDK-ul (`setAnalyticsUser`, `track`, `setAnalyticsContext`,
  `markAnalyticsInternalUser`). Fără asta, tab-ul vecin trimitea în continuare, iar
  ieșirea din cont — propagată de Supabase în toate tab-urile — făcea `reset()`, care
  ȘTERGE refuzul comun și repornea captura (AN23/AN24). O ACORDARE în alt tab
  pornește (sau reia) captura și aici — prin `storage` sau, dacă evenimentul s-a
  pierdut, la primul `track()` (AN30). **Generația acordului** = înregistrarea
  bannerului exact cum e scrisă (`timestamp` diferă la fiecare salvare), reținută
  la pornirea capturii: dacă alt tab a salvat din nou acordul (retragere urmată de
  reacordare, sau doar o salvare nouă), `before_send` aruncă imediat orice
  eveniment (și pe cele proprii ale SDK-ului: page view, page leave, care altfel ar
  pleca pe identitatea de dinainte), iar la apelul sau evenimentul `storage` următor tab-ul face
  `reset(true)` (identitate ȘI `$device_id` noi) și repornește captura (AN29). O
  salvare nouă în ACELAȘI tab adoptă generația fără reset.
- **Paginile oaspeților nu trimit NIMIC**: meniul QR (`/q/`), meniul public (`/m/`)
  și rezervarea publică (`/rezervare/`). Acolo Menuvia e persoana împuternicită a
  restaurantului, iar DPA-ul publicat (`menuvia-pack/05-DRAFT-DPA.md` §3.4 + Anexa 2)
  nu cunoaște PostHog. PostHog nu se încarcă dacă pagina de intrare e una dintre
  ele (AN19) — pornirea sărită se reîncearcă la fiecare schimbare de rută din SPA
  (`ROUTE_CHANGE_EVENT`), deci Înapoi spre o pagină Menuvia îl poate porni, cu
  aceeași gardă de oaspete (AN33). `before_send` aruncă orice eveniment cu calea
  lor (navigarea din panou, de ex. „Previzualizează meniu”, AN4) și scoate de pe
  evenimentele paginilor eligibile câmpurile pe care SDK-ul le DERIVĂ dintr-o
  pagină de oaspete: tot grupul `$prev_pageview_*` când pagina anterioară e de
  oaspete, `$session_entry_*` când sesiunea a intrat pe una, `$initial_*` când
  prima vizită a fost pe una — în proprietăți, `$set` și `$set_once` —, plus copia
  FĂRĂ prefix a intrării în sesiune pe care posthog-js 1.440 o pune în `$set_once`
  (`$current_url`, `$pathname`, `$host`, `$referrer`, `utm_*`…; acolo rămân doar
  cheile `$initial_*`); între pagini eligibile grupurile rămân (AN25). O
  proveniență de pe o pagină de oaspete (`$referrer`, `$session_entry_referrer`,
  `$initial_referrer` și domeniile lor — un link obișnuit din meniu sau din
  rezervare spre site trimite adresa întreagă, aceeași origine) devine `$direct`;
  una externă rămâne neatinsă (AN37). Linkul „Menuvia” de pe rezervare are în plus
  `rel="noreferrer"`, ca badge-ul de pe meniuri. Clichetul AE6 interzice `track()` și ORICE
  formă de import al analytics (static, dinamic, `require`, reexport) în fișierele
  fluxului oaspetelui, iar `order_placed` pleacă doar pentru comenzile ospătarului
  (OA1–OA3). Ca să măsori oaspeții e nevoie ÎNTÂI de decizia fondatorului și a
  avocatului: PostHog trecut în Anexa 2 a DPA cu notificarea de 30 de zile din
  §7.2, o excepție explicită în §3.4, politica de confidențialitate completată
  (§2, §3.2) și spus deschis că evenimentele se corelează între restaurante prin
  `$device_id`.
- Oprite explicit în `POSTHOG_PRIVACY_CONFIG`: autocapture, rage clicks, dead
  clicks, heatmap-uri, înregistrarea sesiunilor, captura consolei, captura
  excepțiilor (erorile le raportează Sentry), web vitals, surveys, product tours,
  conversations, web experiments, site apps, încărcarea de scripturi externe și
  configurarea de la distanță / feature flags (`advanced_disable_flags`). Un
  comutator din proiectul PostHog nu poate porni niciunul dintre ele.
- Proiectul are, la 18 nov 2026, `capture_console_log_opt_in` și
  `capture_performance_opt_in` PORNITE. Clientul le ignoră (configurarea de la
  distanță e tăiată și ambele sunt oprite local), dar comutatoarele merită stinse
  și în proiect, ca să nu inducă în eroare pe cine citește setările.
- IP-ul: opțiunea `ip` a SDK-ului nu mai are efect în posthog-js 1.440. IP-ul îl
  elimină PROIECTUL (`anonymize_ips = true`, verificat la 18 nov 2026). Dacă cineva
  stinge setarea, politica („adresa IP nu este stocată”) devine falsă.
- **Locația**: proiectul are transformarea **GeoIP** PORNITĂ (creată automat odată
  cu proiectul, 18 nov 2026), care scrie orașul, codul poștal și coordonatele pe
  eveniment și pe persoană — iar `anonymize_ips` NU o oprește (IP-ul e folosit
  înainte să fie eliminat). Clientul pune `$geoip_disable: true` pe FIECARE
  eveniment, în `before_send` (AN4), deci transformarea iese fără să scrie nimic.
  Dacă flagul dispare din cod, politica („nu este folosită pentru localizare”)
  devine falsă. Act de fondator, ca a doua plasă: dezactivează transformarea
  „GeoIP” în proiect (transformările din pipeline-ul de date).
- Fragmentul URL (`#access_token=…`) nu se capturează (`disable_capture_url_hashes`),
  id-urile de click publicitar se maschează (`mask_personal_data_properties`), iar
  token-urile din căi (`/q/`, `/invite/`, `/echipa/`, `/sef-vanzari/`) și parametrii
  de revenire din Stripe (`payment_intent_client_secret`, `payment_intent`,
  `setup_intent*`, recunoscuți și cu numele percent-codificat, TS13) trec prin
  `scrubTokenPathsDeep` în `before_send` (cablajul îl țin AN3/AN4).
- Valorile de campanie (`utm_*`) pleacă doar ca IDENTIFICATORI: tăiate, cu litere
  mici, `^[a-z0-9][a-z0-9._-]{0,63}$`, fără 9+ cifre la rând (numărate și peste
  `.`/`-`/`_` dintre ele: `0722-123-456` e un telefon, `2026-11-22` nu) — orice
  altceva (un e-mail, un text cu spațiu, un telefon) se ARUNCĂ, nu se trunchiază.
  Un nume scris FĂRĂ spațiu (`ion.popescu`) arată ca un identificator și trece: nu
  se poate deosebi de o valoare de campanie. Regula se
  aplică și peste ce adaugă SDK-ul (`utm_*` de sesiune, `$session_entry_utm_*`,
  `$initial_utm_*`, în proprietăți, `$set` și `$set_once`), iar din orice URL cu
  query (`$current_url`, `$referrer`, `$initial_current_url`…) se scot parametrii
  `utm_*` respinși, restul URL-ului rămânând identic (AN26).

## Identitatea

- **Oaspeții** (meniul QR, `/m/:slug`, rezervarea publică): niciun eveniment (mai sus).
- **Personalul** e pseudonim: `identify(user.id)` cu id-ul intern (UUID), fără
  e-mail, nume sau telefon trimise de noi. Profilul din PostHog mai poartă ce
  adaugă SDK-ul la identificare (`$set_once`: prima pagină și sursa primei vizite,
  cu UTM-urile ei doar ca identificatori, și nimic din ele dacă prima vizită a fost
  pe o pagină de oaspete) și proprietățile tehnice pe care PostHog le preia implicit din
  evenimente (de ex. browserul și sistemul de operare, `$initial_browser`) — dar
  nicio localizare după IP (GeoIP oprit, mai sus).
- **Acordul e al CONTULUI, nu al tabletei** (`ph_menuvia_consent_uid`):
  consimțământul se dă per browser, dar un cont LOGAT e capturat (și identificat)
  DOAR dacă el l-a dat — cel logat în momentul acordului sau, dacă nu era nimeni
  logat, primul cont care se autentifică sau se CREEAZĂ în aceeași pagină (nu și
  după o reîncărcare) (AN18). Contul creat preia acordul chiar la `signUp`
  (`bindPendingConsentToAccount`, din AuthPage): cu confirmarea emailului pornită
  nu urmează nicio autentificare în pagină, iar contul se deschide din link într-un
  document NOU, unde un acord nelegat nu mai poate fi preluat (AN39, SW10). Pe o
  tabletă partajată, contul următor **nu e capturat
  deloc**, nici anonim: `track()` nu pune nimic în coadă, `before_send` aruncă și
  evenimentele SDK-ului, `identify` nu se face (AN32) — până când își dă propriul
  acord din „Setări cookies”. Vizitatorii nelogați sunt capturați anonim pe acordul
  browserului. Pentru un cont nou, fluxul normal (bannerul acceptat pe landing,
  apoi înregistrarea în aceeași pagină) leagă acordul de cont, și cu confirmarea
  emailului pornită.
- PostHog pornește abia după ce `AuthContext` a răspuns (primul `setAnalyticsUser`):
  o sesiune încă nerezolvată (refresh de token pe rețea, tableta ospătarului
  dimineața) nu mai arată „nimeni logat”, deci contul încă logat nu primește
  `reset()` la pornire, iar identitatea se aplică înaintea primului eveniment (AN15).
  „Nimeni logat” se publică DOAR pe un `getSession()` reușit fără sesiune sau pe
  `SIGNED_OUT`: un `getSession()` cu `error` (refresh de token căzut) lasă
  analytics nerezolvat până la evenimentul de autentificare următor. AuthContext
  dă atunci semnalul `setAnalyticsAuthUnresolved()`: ce se emite DE ACUM aparține
  ecranului fără cont, deci contul care se autentifică apoi (alt om, pe aceeași
  tabletă) nu preia din coadă evenimentele de dinainte drept ale lui (AN38, AA1–AA3).
- Ieșirea din cont și schimbarea contului fac `reset(true)`: identitate ȘI
  `$device_id` noi, ca nici profilul, nici dispozitivul vechi să nu primească
  evenimentele celui nou (AN7). Marcajul `ph_menuvia_identity_owner` (localStorage)
  ține minte sub ce cont a fost folosită identitatea SDK-ului; dacă la pornire
  contul logat e altul (sau nu e niciunul), se face `reset(true)` (AN11).
- **Fondatorul** primește `$internal_or_test_user` (`setInternalOrTestUser`) când
  `DashboardPage` confirmă `is_platform_admin` — DOAR dacă e identificat, adică
  dacă acordul din acel browser e al contului lui (acceptă bannerul logat, sau o
  dată „Setări cookies” → Salvează pe fiecare dispozitiv). Altfel traficul lui nu
  pleacă deloc (AN32), deci nici nemarcat. Proiectul are deja un
  filtru de conturi de test (o cohortă), dar bifa lui NU e implicită
  (`test_account_filters_default_checked = null` la 18 nov 2026): în Project
  settings → „Internal & test accounts” verifică că filtrul acoperă
  `$internal_or_test_user` și bifează-l implicit, altfel traficul fondatorului
  rămâne în grafice.

## Proprietățile de pe fiecare eveniment

| Proprietate | Valori | De ce |
|---|---|---|
| `app_env` | `production` (din `VITE_APP_ENV`) | Separă orice eveniment ajuns din alt mediu |
| `site` | `ro` / `com` (`browserSite()`) | Piața: .com vinde doar Planurile 1–2 |
| `restaurant_id` | UUID-ul localului activ în panou | Atribuirea pe locație (un owner cu mai multe localuri), ca la evenimentele care îl poartă explicit |
| `plan_tier` | `1` / `2` / `3`, `null` cât planul localului ACTIV nu e cunoscut | Planul 1 față de 2/3 — din `planTier()` pe `useFeatures` (regula 3), NU `profile.plan` |
| `staff_role` | `owner` / `manager` / `waiter` / `kitchen` / `partner` | Proprietarii separat de ospătari și bucătari |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` | din URL-ul paginii de INTRARE, doar identificatori | Canalul de achiziție (mai jos) |

DOAR `app_env` și `site` sunt super-proprietăți (`register`). Contextul panoului
(`restaurant_id`, `plan_tier`, `staff_role`) și campania paginii de intrare stau în
MEMORIA modulului și le atașează `before_send` fiecărui eveniment — NU se
persistă în SDK: o încărcare nouă fără panou (/pricing, /waiter, /kitchen,
/founder) nu mai moștenește localul de data trecută, iar o intrare directă nu mai
moștenește campania veche. Cheile pe care le persista versiunea anterioară
(contextul și cele cinci `utm_*`) se scot (`unregister`) la fiecare pornire a
capturii (AN20/AN21). Contextul îl setează `DashboardPage` (`setAnalyticsContext`)
și îl scoate la ieșirea din panou; `plan_tier` rămâne `null` până când planul
citit e chiar al localului selectat — după o comutare, prima randare încă are
planul localului vechi (DA1). Un `restaurant_id` dat EXPLICIT de apelant
(`shift_*`, `invoice_requested`, `order_placed`) bate contextul. Un eveniment din
coadă pleacă cu contextul de la EMITERE, nu cu cel de la golire (AN27).
`$geoip_disable` nu e super-proprietate: îl pune `before_send` pe fiecare
eveniment.

**Canalul de achiziție.** `navigate()` din App păstrează doar calea, deci o
navigare de dinaintea acordului scotea `utm_*` din URL înainte ca PostHog să
pornească. `main.tsx` ține, la boot, parametrii `utm_*` ai paginii de intrare în
MEMORIE (nu în storage, nu pleacă fără acord), doar ca identificatori, și îi pune
pe evenimentele ACELUI document (AN21). Pe o pagină de intrare a oaspeților nu se
reține nimic. Codul de afiliat NU intră în analytics: cookie-urile `mv_ref` /
`mv_vid` servesc, conform politicii de cookie-uri, EXCLUSIV atribuirii
comisionului, iar atribuirea însăși stă în bază (`affiliate_attributions`,
`affiliate_touches`), mai exactă decât orice eșantion. `$referrer` vine din
`document.referrer`, pe care navigarea din SPA nu-l schimbă.

Proprietățile standard ale SDK-ului (`$current_url` curățat, `$browser`, `$os`,
`$device_type`, `$browser_language`) vin de la PostHog.

## Page view-uri

`capture_pageview: 'history_change'`: page view-ul inițial plus unul la fiecare
schimbare de CALE din SPA (`navigate()` din `App.tsx` face `pushState`, iar SDK-ul
îl interceptează și deduplică pe pathname), în afara paginilor oaspeților.
Schimbările de query (`?tab=`) nu produc page view-uri — modulul folosit din panou
îl spune `dashboard_tab_viewed`. `$pageleave` e pornit.

## Ce se poate citi din PostHog și ce NU

Toate evenimentele sunt un **EȘANTION cu consimțământ**, nu un număr: pleacă doar
din browserele care au bifat „Performanță” (minus Do Not Track și blocantele de
reclame), iar dintre conturile logate doar de la cele al căror acord e legat de
ele (mai sus). Sunt bune pentru **rate și pâlnii** (din cei care încep onboarding-ul, câți
îl termină; din cei care văd upsell-ul, câți apasă), NU pentru volume.

- **Volumul de comenzi, pe local și pe zi** (și „prima comandă de oaspete a
  restaurantului X”): din bază — `orders` grupat pe `restaurant_id` și pe ziua
  locală, sau `v_daily_orders`. Comenzile oaspeților nici nu ajung în PostHog.
- **Scanările QR**: `qr_scans` (mig 283).
- **Rezervările publice și plata la masă**: `reservations`, `table_payments`.
- **Abonamentele și activările Planului 3**: `profiles.plan` / evenimentele Stripe
  din bază; Planul 3 îl activează fondatorul (`admin_set_restaurant_plan`).
- **Retenția pe local**: din bază (comenzi pe zi per `restaurant_id`); retenția pe
  CONT din PostHog doar pentru conturile identificate (acordul lor).

## Evenimentele de afacere

Regula: evenimentele de REZULTAT se emit doar după ce serverul a confirmat
acțiunea, nu la click. Excepțiile sunt evenimentele de INTENȚIE: cele două ale
upsell-ului, cererea de ofertă și tab-ul văzut în panou. În coloana „Proprietăți”,
între backtick-uri stau DOAR cheile (AE7 le compară cu codul); valorile se scriu
în paranteză, fără backtick-uri.

| Eveniment | Când | Unde | Proprietăți | Întrebarea de afacere |
|---|---|---|---|---|
| `signup_completed` | `signUp` a creat un cont NOU (un e-mail deja înregistrat și confirmat întoarce un user fără identități, fără eroare — nu se numără) | `src/pages/AuthPage.tsx` | `email_confirmation_required`, `plan_intent` | Ce parte din vizitatori își face cont, cu ce plan în minte? |
| `login_completed` | parola acceptată și: codul MFA verificat (mfa true), sau verificarea de asigurare a răspuns fără eroare că nu urmează niciun pas MFA (mfa false); dacă verificarea pică sau aruncă, omul intră, dar nu se trimite nimic (LA1–LA5) | `src/pages/AuthPage.tsx` | `mfa` | Cât de des se intră cu parola și câte conturi folosesc MFA? (Sesiunea persistă, deci NU măsoară revenirile: acelea se văd din page view-urile conturilor identificate.) |
| `onboarding_started` | ecranul de onboarding montat | `src/pages/OnboardingPage.tsx` | — | Câte conturi noi încep configurarea? |
| `onboarding_step_completed` | un pas încheiat sau sărit | `src/pages/OnboardingPage.tsx` | `step`, `skipped` | La ce pas se pierd oamenii? |
| `onboarding_completed` | ecranul final („Gata”, restaurantul deja creat) închis | `src/pages/OnboardingPage.tsx` | — | Rata de activare: cont → restaurant configurat |
| `product_created` | produsul salvat | `src/components/ProductsTab.tsx`, `OnboardingPage.tsx` | `ui_source` (products_tab / onboarding — ecranul, nu un canal) | Cât de repede se construiește meniul, și din ce ecran? |
| `product_imported_ai` | importul AI salvat | `ProductsTab.tsx`, `OnboardingPage.tsx` | `count`, `ui_source` | Cât din meniu vine prin import AI? |
| `order_placed` | DOAR comanda PERSONALULUI (ospătar) întoarsă de `create_order`; QR și ridicarea nu (paginile oaspeților), nici coada offline | `src/lib/orders.ts` (`createOrder`) | `restaurant_id`, `item_count`, `line_count` | Folosesc ospătarii comenzile în Menuvia, la ce local? (Volumul total — din bază.) |
| `checkout_started` | `stripe-checkout` a întors sesiunea Stripe (trimis imediat, pagina pleacă; cu PostHog încă neîncărcat, predat documentului următor din același tab — AN34/AN35) | `src/App.tsx` | `plan` | Câți pornesc plata unui abonament? |
| `subscription_started` | profilul are planul cumpărat (scris de webhook), la întoarcerea din Stripe, ȘI tab-ul a plecat spre Stripe pentru acest plan, cu acest cont, în ultimele 24 h (marcajul `ph_menuvia_checkout_redirect`, scris doar cu acord, consumat la citire — un reload sau un semn de carte pe URL-ul de succes nu mai numără, CR18–CR25); include trialul fără card. E un semnal de PÂLNIE din client: înregistrarea autoritară e `lifecycle_events.subscription_started`, scrisă de webhook. Marcajul rămâne și după `?checkout=cancelled` (Înapoi în sesiunea Stripe încă deschisă trebuie să se numere, CR23), deci rest consemnat: un cont cu plan MANUAL egal cu cel cumpărat care anulează și deschide în aceeași filă, în 24 h, un URL de succes salvat se numără o dată | `src/hooks/useCheckoutReturn.ts` | `plan` | Conversia checkout → abonament |
| `plan_upsell_viewed` | cardul unic de upsell afișat (proprietar, Acasă) | `src/components/_dashboard/PlanUpsellCard.tsx` | `target` (ordering / payments) | Câți proprietari văd oferta planului următor? |
| `plan_upsell_clicked` | „Vezi planul” apăsat | `PlanUpsellCard.tsx` | `target` | Pâlnia upsell. Pentru ordering (Planul 2): → `checkout_started` → `subscription_started`. Pentru payments (Planul 3, doar prin ofertă): → `plan_quote_requested`; activarea — din bază |
| `plan_quote_requested` | „Cere ofertă” apăsat pe pagina de prețuri (link mailto, trimis imediat; predat documentului următor ca `checkout_started`) | `src/pages/PricingPage.tsx` | `plan` | Câți cer oferta pentru Fiscalizare? |
| `dashboard_tab_viewed` | tab-ul efectiv RANDAT în panou (la intrare și la fiecare schimbare); un tab cerut dar refuzat de plan, sau încă în așteptarea planului, nu se numără (DA2–DA4) | `src/pages/DashboardPage.tsx` | `tab` | Ce module se folosesc, pe nivel de plan (`plan_tier`) și rol (`staff_role`)? |
| `shift_opened` | `open_shift` a reușit | `src/components/CashRegisterTab.tsx` | `restaurant_id` | Folosesc localurile casa de marcat în Menuvia? |
| `shift_closed` | `close_shift` a reușit; localul e al TUREI închise, nu cel selectat după o comutare (CRS1–CRS3) | `CashRegisterTab.tsx` | `restaurant_id`, `z_sent` | Câte ture se închid cu raport Z trimis? |
| `invoice_requested` | `enqueue_invoice_for_order` a acceptat cererea (emiterea Oblio e asincronă) | `src/components/IssueInvoiceModal.tsx` | `restaurant_id`, `b2b` | Câte facturi cer localurile, câte B2B? |
| `export_data_requested` | exportul GDPR descărcat | `src/components/GdprCard.tsx` | — | Cât de des se exercită dreptul de acces? |
| `account_deletion_requested` | `request_account_deletion` a programat ștergerea | `GdprCard.tsx` | — | Semnal de pierdere a clientului |

Ce NU poartă niciun eveniment: e-mail, nume, telefon, note, adrese, CUI, coduri de
confirmare, token-uri, coduri de afiliat, sumele de casă ale unei ture (ar fi o
măsură a angajatului care a închis-o) și orice obiect întreg (comandă, restaurant,
utilizator).

## Scoase din uniune

`reservation_created`, `table_payment_started`, `table_payment_succeeded` (se
emiteau de pe telefonul OASPETELUI — paginile oaspeților nu trimit nimic, vezi mai
sus; volumele lor sunt în bază), `app_loaded` (dublura page view-ului inițial),
`signup_started` (nu e o acțiune confirmată de server), `order_status_changed`
(volum mare, fără întrebare de afacere în spate), `subscription_cancelled`
(anularea se face în portalul Stripe, nu există un punct pe client),
`feature_blocked_by_plan` (înlocuit de `plan_upsell_viewed`/`plan_upsell_clicked`,
componenta unică de upsell), `support_link_clicked` (un click, nu un rezultat),
`invoice_generated` (redenumit `invoice_requested`: clientul confirmă doar intrarea
în coadă).

## Cum verifici în producție

1. Pe producție, logat cu contul de fondator, deschide „Setări cookies” și salvează
   cu „Performanță” bifat (acordul se leagă de cont). Butonul stă în panou, în
   Setări → Abonament & cont (cardul „Datele mele (GDPR)”, doar proprietar/manager),
   și în subsolul paginilor legale (`/cookies`, `/confidentialitate`…). Browserul de
   test trebuie să fie FĂRĂ Do Not Track / Global Privacy Control (Brave le trimite
   implicit) și fără blocant de reclame care listează `posthog.com` — altfel, corect,
   nu pleacă nimic și pasul 2 pare o integrare stricată.
2. În PostHog → Activity → Live events trebuie să apară `$pageview` cu `site`,
   `app_env = production` și `$geoip_disable = true`, iar în panou și
   `restaurant_id`, `plan_tier`, `staff_role`; fără niciun `$autocapture`,
   `$snapshot` sau `$exception`.
3. `$identify` cu distinct id = UUID-ul contului; pe persoană, fără e-mail, nume și
   fără proprietăți `$geoip_*`.
4. **Intrarea directă**: într-un tab nou, deschide `/m/<slug>` al unui restaurant:
   în DevTools → Network nu apare nicio cerere spre `eu.i.posthog.com` (PostHog nici
   nu se descarcă), iar în Live events nu apare NIMIC.
5. **Tranziția în ACELAȘI document** (pasul 4 nu o acoperă: acolo PostHog nici nu
   pornește): în panou, cu `$pageview`-ul tău deja vizibil în Live events, apasă
   „Previzualizează meniu” (navigare SPA spre `/m/<slug>`, aceeași filă). În Live
   events nu apare niciun eveniment cu `$pathname` `/m/…`. Revino cu Înapoi în
   panou: noul `$pageview` NU are `$prev_pageview_pathname` = `/m/…` (grupul
   `$prev_pageview_*` lipsește cu totul — AN25). Repetă, dar închide fila cât ești
   pe meniu: nu apare niciun `$pageleave` cu calea `/m/…`.
6. Debifează „Performanță”: nu mai apare nimic, nici `$pageleave`; în localStorage
   nu mai rămâne nicio cheie `ph_*` în afară de `ph_menuvia_consent`.

## Reziduuri consemnate

- La ștergerea contului (Art. 17), persoana din PostHog NU se șterge automat.
  Evenimentele rămân legate de UUID-ul intern, care NU dispare din bază: supraviețuiește
  în instantaneele din `audit_log` (retenția e „păstrăm tot”; mig 307 consemnează
  exact asta), deci evenimentele sunt date PSEUDONIME, nu anonime. Ștergerea din
  PostHog se face la cerere, manual, în termenul de o lună (art. 12 GDPR) — politica
  spune asta. Automatizarea cere o cheie personală PostHog pe server și un apel din
  `process_account_deletions`: neimplementată.
- Acordul pentru statistici e per browser, iar un cont LOGAT care nu e al
  acordului nu e capturat deloc (AN32) — fail-closed. Consecința: conturile al
  căror acord nu e legat de ele NU se măsoară până nu salvează din nou din „Setări
  cookies”: acordul dat înainte de integrare (pentru Sentry — cine îl dăduse nu se
  poate afla, iar a-l lega de primul cont care intră ar fi o presupunere pe o
  tabletă partajată; reafișarea bannerului pentru conturile logate cere o versiune
  a acordului în `cookieConsent.ts`, decizie separată), acordul dat nelogat urmat de
  o reîncărcare înaintea autentificării sau a înregistrării (și un vizitator care
  acceptase la o vizită anterioară și își face cont azi), acordul altui cont de pe
  aceeași tabletă. Un acord dat de altcineva înaintea primei autentificări sau
  înregistrări din aceeași pagină se leagă de acel prim cont — fereastra e doar
  pagina curentă.
- Ospătarul și bucătarul n-au acces la Setări, deci „Setări cookies” e pentru ei
  doar în subsolul paginilor legale (`/cookies`), din același browser; ecranele
  `/waiter` și `/kitchen` nu au încă butonul.
- `signup_completed` pentru un e-mail existent dar NECONFIRMAT: GoTrue întoarce userul
  real (cu identități) și retrimite confirmarea, deci se numără a doua oară.
- Comenzile ospătarului salvate OFFLINE (IndexedDB) și sincronizate mai târziu nu
  emit `order_placed`.
- Un eveniment emis înainte ca PostHog să se încarce așteaptă în coadă (cel mult
  20) doar dacă acordul e deja dat; fără acord nu se păstrează și nu se trimite
  niciodată retroactiv. Fiecare intrare ține contul, contextul, generația acordului
  și momentul emiterii; la golire pleacă doar pe același cont și sub același acord,
  cu contextul de atunci (AN27).
- **Predarea spre documentul următor** (`sendInstantly`: `checkout_started`,
  `plan_quote_requested`): dacă PostHog nu e încă pornit, evenimentul se scrie și
  în sessionStorage `ph_menuvia_handoff` (cel mult 20; prefixul `ph_` îl face parte
  din urmele șterse la revocare). Următoarea pornire a capturii din același tab îl
  citește și îl șterge o singură dată și îl trimite doar pe același cont, sub
  aceeași generație a acordului, la cel mult 24 h (5 min toleranță de ceas), cu
  momentul original (AN34/AN35). Redirectul nu e niciodată blocat. Un tab DUPLICAT
  copiază sessionStorage-ul, deci ar putea retrimite o predare încă necitită.
- **Marcajul redirectului spre Stripe** (`ph_menuvia_checkout_redirect`,
  sessionStorage): `noteCheckoutRedirect(plan)` din App.tsx îl scrie chiar înainte
  de redirect, cu planul, contul și momentul, DOAR cu acordul „Performanță” (nu
  pleacă nicăieri, dar servește doar statisticii), iar `takeCheckoutRedirect` îl
  citește și îl șterge la întoarcere (AN36, CR18–CR25). Prefixul `ph_` îl face
  parte din urmele șterse la retragere; politica de cookies îl listează în 04 §3.2
  (PostHog), nu printre cele strict necesare. Un acord dat abia la întoarcere nu
  numără abonamentul (marcajul lipsește).
- O cerere PORNITĂ înainte de retragere care eșuează (înainte sau după retragere)
  intră în coada de reîncercare a SDK-ului (RetryQueue), care o retrimite fără să
  reverifice acordul; golirea cozii cere API intern al SDK-ului. Fereastra e doar a
  cererilor deja pornite: nimic capturat după retragere nu mai trece de `before_send`.
- O salvare nouă a acordului în ALT tab, chiar fără retragere, schimbă identitatea
  SDK a acestui tab (fail-closed, deliberat: tab-ul nu poate deosebi o salvare
  simplă de o retragere urmată de reacordare).
- Pe o pagină a cărei sesiune `getSession()` a eșuat (promisiune respinsă sau
  `error`), PostHog nu pornește până la evenimentul de autentificare următor
  (identitatea rămâne necunoscută) — fail-closed, rar. Evenimentele emise între timp
  (ecranul arată „nimeni logat”) pleacă doar dacă răspunsul următor e tot „nimeni
  logat”; un cont care se autentifică le aruncă (AN38).
