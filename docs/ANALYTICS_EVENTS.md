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
  `.github/workflows/deploy-vps.yml` (clichetul PE1–PE6 din
  `tests/functions/posthog-env.test.js`). Deploy preview, branch deploy, `develop`,
  CI, E2E și local rulează FĂRĂ cheie, deci fără analytics.
- Nimic nu se descarcă fără consimțământul „Performanță” din bannerul de cookie-uri:
  `posthog-js` se importă dinamic abia la acord. Revocarea face `reset(true)` și apoi
  `opt_out_capturing()`, în ordinea asta (testul AN8 explică de ce), iar cheile
  `ph_*` se șterg din localStorage și sessionStorage, inclusiv `$device_id` — și
  când PostHog nu e încărcat în pagină (AN17). Rămâne cel mult refuzul SDK-ului
  (`ph_menuvia_consent`, fără niciun identificator): cât instanța trăiește în
  pagină SDK-ul îl RECITEȘTE, deci nu se poate șterge, iar în browser stă până la
  acordul următor, când `doInit` îl șterge înainte de `init` (AN16). Rămâne și când
  revocarea vine dintr-un tab FĂRĂ PostHog: un tab vecin poate avea o instanță vie.
- **Revocarea dintr-un alt tab** se aude și aici: `consent-updated` nu trece între
  tab-uri, deci ascultăm `storage` și verificăm acordul înaintea oricărui apel care
  poate atinge SDK-ul (`setAnalyticsUser`, `track`, `setAnalyticsContext`,
  `markAnalyticsInternalUser`). Fără asta, tab-ul vecin trimitea în continuare, iar
  ieșirea din cont — propagată de Supabase în toate tab-urile — făcea `reset()`, care
  ȘTERGE refuzul comun și repornea captura (AN23/AN24).
- **Paginile oaspeților nu trimit NIMIC**: meniul QR (`/q/`), meniul public (`/m/`)
  și rezervarea publică (`/rezervare/`). Acolo Menuvia e persoana împuternicită a
  restaurantului, iar DPA-ul publicat (`menuvia-pack/05-DRAFT-DPA.md` §3.4 + Anexa 2)
  nu cunoaște PostHog. PostHog nu se încarcă dacă pagina de intrare e una dintre
  ele (AN19), iar `before_send` aruncă orice eveniment cu calea lor (navigarea din
  panou, AN4); clichetul AE6 interzice `track()` și importul analytics în fișierele
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
  `setup_intent*`) trec prin `scrubTokenPathsDeep` în `before_send`.

## Identitatea

- **Oaspeții** (meniul QR, `/m/:slug`, rezervarea publică): niciun eveniment (mai sus).
- **Personalul** e pseudonim: `identify(user.id)` cu id-ul intern (UUID), fără
  e-mail, nume sau telefon trimise de noi. Profilul din PostHog mai poartă ce
  adaugă SDK-ul la identificare (`$set_once`: prima pagină și sursa primei vizite,
  cu UTM-urile ei) și proprietățile tehnice pe care PostHog le preia implicit din
  evenimente (de ex. browserul și sistemul de operare, `$initial_browser`) — dar
  nicio localizare după IP (GeoIP oprit, mai sus).
- **Acordul e al CONTULUI, nu al tabletei** (`ph_menuvia_consent_uid`):
  consimțământul se dă per browser, dar `identify` se face DOAR pentru contul care
  l-a dat — cel logat în momentul acordului sau, dacă nu era nimeni logat, primul
  cont care se autentifică în aceeași pagină (nu și după o reîncărcare). Pe o
  tabletă partajată, contul următor NU e asociat: evenimentele lui rămân fără
  profil până când își dă propriul acord din „Setări cookies” (AN18). Pentru un
  cont nou, fluxul normal (bannerul acceptat pe landing, apoi înregistrarea în
  aceeași pagină) leagă acordul de cont.
- PostHog pornește abia după ce `AuthContext` a răspuns (primul `setAnalyticsUser`):
  o sesiune încă nerezolvată (refresh de token pe rețea, tableta ospătarului
  dimineața) nu mai arată „nimeni logat”, deci contul încă logat nu primește
  `reset()` la pornire, iar identitatea se aplică înaintea primului eveniment (AN15).
- Ieșirea din cont și schimbarea contului fac `reset(true)`: identitate ȘI
  `$device_id` noi, ca nici profilul, nici dispozitivul vechi să nu primească
  evenimentele celui nou (AN7). Marcajul `ph_menuvia_identity_owner` (localStorage)
  ține minte sub ce cont a fost folosită identitatea SDK-ului; dacă la pornire
  contul logat e altul (sau nu e niciunul), se face `reset(true)` (AN11).
- **Fondatorul** primește `$internal_or_test_user` (`setInternalOrTestUser`) când
  `DashboardPage` confirmă `is_platform_admin` — DOAR dacă e identificat, adică
  dacă acordul din acel browser e al contului lui (acceptă bannerul logat, sau o
  dată „Setări cookies” → Salvează pe fiecare dispozitiv). Proiectul are deja un
  filtru de conturi de test (o cohortă), dar bifa lui NU e implicită
  (`test_account_filters_default_checked = null` la 18 nov 2026): în Project
  settings → „Internal & test accounts” verifică că filtrul acoperă
  `$internal_or_test_user` și bifează-l implicit, altfel traficul fondatorului
  rămâne în grafice.

## Super-proprietăți (pe fiecare eveniment)

| Proprietate | Valori | De ce |
|---|---|---|
| `app_env` | `production` (din `VITE_APP_ENV`) | Separă orice eveniment ajuns din alt mediu |
| `site` | `ro` / `com` (`browserSite()`) | Piața: .com vinde doar Planurile 1–2 |
| `restaurant_id` | UUID-ul localului activ în panou | Atribuirea pe locație (un owner cu mai multe localuri), ca la evenimentele care îl poartă explicit |
| `plan_tier` | `1` / `2` / `3`, `null` cât planul nu e cunoscut | Planul 1 față de 2/3 — din `planTier()` pe `useFeatures` (regula 3), NU `profile.plan` |
| `staff_role` | `owner` / `manager` / `waiter` / `kitchen` / `partner` | Proprietarii separat de ospătari și bucătari |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` | din URL-ul paginii de INTRARE | Canalul de achiziție (mai jos) |

Cele trei de context le setează `DashboardPage` (`setAnalyticsContext`) și le scoate
la ieșirea din panou; după un `reset(true)` se pun la loc (AN20). `$geoip_disable`
nu e super-proprietate: îl pune `before_send` pe fiecare eveniment.

**Canalul de achiziție.** `navigate()` din App păstrează doar calea, deci o
navigare de dinaintea acordului scotea `utm_*` din URL înainte ca PostHog să
pornească. `main.tsx` ține, la boot, parametrii `utm_*` ai paginii de intrare în
MEMORIE (nu în storage, nu pleacă fără acord), iar captura îi înregistrează o dată,
la pornire (AN21). Codul de afiliat NU intră în analytics: cookie-urile `mv_ref` /
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
reclame). Sunt bune pentru **rate și pâlnii** (din cei care încep onboarding-ul, câți
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
| `login_completed` | parola acceptată (și MFA, dacă e cazul) | `src/pages/AuthPage.tsx` | `mfa` | Cât de des se intră cu parola și câte conturi folosesc MFA? (Sesiunea persistă, deci NU măsoară revenirile: acelea se văd din page view-urile conturilor identificate.) |
| `onboarding_started` | ecranul de onboarding montat | `src/pages/OnboardingPage.tsx` | — | Câte conturi noi încep configurarea? |
| `onboarding_step_completed` | un pas încheiat sau sărit | `src/pages/OnboardingPage.tsx` | `step`, `skipped` | La ce pas se pierd oamenii? |
| `onboarding_completed` | ecranul final („Gata”, restaurantul deja creat) închis | `src/pages/OnboardingPage.tsx` | — | Rata de activare: cont → restaurant configurat |
| `product_created` | produsul salvat | `src/components/ProductsTab.tsx`, `OnboardingPage.tsx` | `ui_source` (products_tab / onboarding — ecranul, nu un canal) | Cât de repede se construiește meniul, și din ce ecran? |
| `product_imported_ai` | importul AI salvat | `ProductsTab.tsx`, `OnboardingPage.tsx` | `count`, `ui_source` | Cât din meniu vine prin import AI? |
| `order_placed` | DOAR comanda PERSONALULUI (ospătar) întoarsă de `create_order`; QR și ridicarea nu (paginile oaspeților), nici coada offline | `src/lib/orders.ts` (`createOrder`) | `restaurant_id`, `item_count`, `line_count` | Folosesc ospătarii comenzile în Menuvia, la ce local? (Volumul total — din bază.) |
| `checkout_started` | `stripe-checkout` a întors sesiunea Stripe (trimis imediat, pagina pleacă) | `src/App.tsx` | `plan` | Câți pornesc plata unui abonament? |
| `subscription_started` | profilul are planul cumpărat (scris de webhook), la întoarcerea din Stripe; include trialul fără card | `src/hooks/useCheckoutReturn.ts` | `plan` | Conversia checkout → abonament |
| `plan_upsell_viewed` | cardul unic de upsell afișat (proprietar, Acasă) | `src/components/_dashboard/PlanUpsellCard.tsx` | `target` (ordering / payments) | Câți proprietari văd oferta planului următor? |
| `plan_upsell_clicked` | „Vezi planul” apăsat | `PlanUpsellCard.tsx` | `target` | Pâlnia upsell. Pentru ordering (Planul 2): → `checkout_started` → `subscription_started`. Pentru payments (Planul 3, doar prin ofertă): → `plan_quote_requested`; activarea — din bază |
| `plan_quote_requested` | „Cere ofertă” apăsat pe pagina de prețuri (link mailto, trimis imediat) | `src/pages/PricingPage.tsx` | `plan` | Câți cer oferta pentru Fiscalizare? |
| `dashboard_tab_viewed` | tab-ul afișat în panou (la intrare și la fiecare schimbare) | `src/pages/DashboardPage.tsx` | `tab` | Ce module se folosesc, pe nivel de plan (`plan_tier`) și rol (`staff_role`)? |
| `shift_opened` | `open_shift` a reușit | `src/components/CashRegisterTab.tsx` | `restaurant_id` | Folosesc localurile casa de marcat în Menuvia? |
| `shift_closed` | `close_shift` a reușit | `CashRegisterTab.tsx` | `restaurant_id`, `z_sent` | Câte ture se închid cu raport Z trimis? |
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
   cu „Performanță” bifat (acordul se leagă de cont). Butonul stă DOAR în subsolul
   paginilor legale (`/cookies`, `/confidentialitate`…), nu în panou. Browserul de
   test trebuie să fie FĂRĂ Do Not Track / Global Privacy Control (Brave le trimite
   implicit) și fără blocant de reclame care listează `posthog.com` — altfel, corect,
   nu pleacă nimic și pasul 2 pare o integrare stricată.
2. În PostHog → Activity → Live events trebuie să apară `$pageview` cu `site`,
   `app_env = production` și `$geoip_disable = true`, iar în panou și
   `restaurant_id`, `plan_tier`, `staff_role`; fără niciun `$autocapture`,
   `$snapshot` sau `$exception`.
3. `$identify` cu distinct id = UUID-ul contului; pe persoană, fără e-mail, nume și
   fără proprietăți `$geoip_*`.
4. În același browser, deschide `/m/<slug>` al unui restaurant: nu apare NIMIC.
5. Debifează „Performanță”: nu mai apare nimic, nici `$pageleave`; în localStorage
   nu mai rămâne nicio cheie `ph_*` în afară de `ph_menuvia_consent`.

## Reziduuri consemnate

- La ștergerea contului (Art. 17), persoana din PostHog NU se șterge automat.
  Evenimentele rămân legate de UUID-ul intern, care NU dispare din bază: supraviețuiește
  în instantaneele din `audit_log` (retenția e „păstrăm tot”; mig 307 consemnează
  exact asta), deci evenimentele sunt date PSEUDONIME, nu anonime. Ștergerea din
  PostHog se face la cerere, manual, în termenul de o lună (art. 12 GDPR) — politica
  spune asta. Automatizarea cere o cheie personală PostHog pe server și un apel din
  `process_account_deletions`: neimplementată.
- Acordul pentru statistici e per browser: pe un dispozitiv partajat, conturile
  care nu și-au dat acordul produc tot evenimente, dar FĂRĂ profil și fără
  identificatorul contului. NU sunt însă anonime: ca orice eveniment din panou,
  poartă `restaurant_id` și `staff_role` (iar `order_placed`, `shift_*`,
  `invoice_requested` au localul și explicit), deci la un local cu un singur cont de
  proprietar sunt practic atribuibile — politica (03 §3.1) spune asta. Un acord dat
  de altcineva înaintea primei autentificări din aceeași pagină se leagă de acel
  prim cont — fereastra e doar pagina curentă.
- Conturile care acceptaseră bannerul ÎNAINTE de integrare (pentru Sentry) nu au
  acordul legat de cont: rămân neasociate (fără profil, ca mai sus) până la o
  salvare din „Setări cookies”.
- `signup_completed` pentru un e-mail existent dar NECONFIRMAT: GoTrue întoarce userul
  real (cu identități) și retrimite confirmarea, deci se numără a doua oară.
- Comenzile ospătarului salvate OFFLINE (IndexedDB) și sincronizate mai târziu nu
  emit `order_placed`.
- Un eveniment emis înainte ca PostHog să se încarce așteaptă în coadă (cel mult
  20) doar dacă acordul e deja dat; fără acord nu se păstrează și nu se trimite
  niciodată retroactiv.
- Pe o pagină a cărei sesiune `getSession()` a eșuat (promisiune respinsă), PostHog
  nu pornește deloc (identitatea rămâne necunoscută) — fail-closed, rar.
