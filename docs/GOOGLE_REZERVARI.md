# GOOGLE_REZERVARI — butonul de rezervare pe profilul Google

> Ecosistemul „caută pe Google → rezervă prin Menuvia", treapta 1 din 3.
> Produsul comercial: „Menuvia Rezervări" (Start = free + modulul reservations;
> Automate = starter 99 lei — niciun plan intern nou, regulile din CLAUDE.md/
> EXPANSION.md respectate). Landing: `/rezervari`.

## Ce există în cod (acest PR)

- **`/r/:slug`** (`src/pages/ReservePage.tsx`) — pagina publică de rezervare
  de sine stătătoare: tema restaurantului, ReservationSheet deschis din prima
  (hartă + sloturi + create_reservation_public), link spre meniu, „Powered by
  Menuvia". Modulul OFF → submit-ul respinge cu mesajul prietenos existent.
  ĂSTA e linkul care intră în Google Business Profile.
- **`/rezervari`** (`RezervariPage.tsx`) — landing-ul produsului: pitch
  anti-comision (0% per cuvert), cele două fețe comerciale (Start 0 lei /
  Automate 99 lei), CTA cu preset de onboarding.
- **Preset onboarding** (`lib/onboardingPreset.ts`, TTL 24h, consum unic):
  CTA-ul de pe /rezervari → localStorage → după `create_restaurant`,
  OnboardingPage activează `set_restaurant_module('reservations', true)` +
  `reservation_settings.auto_confirm = true` (best-effort; rândul de settings
  există din trigger-ul mig 057).
- **Card „Butonul tău Google"** în tab-ul Rezervări: linkul `/r/:slug` +
  copiere + pașii GBP inline + upsell SMS pe planul free (bannerul apare doar
  după ce features s-au încărcat cu succes — fără flash pe blip de rețea).
- **JSON-LD**: `acceptsReservations: /r/:slug` în schema.org Restaurant de pe
  /m/:slug (useMenuSeo).
- **Etichete**: starter = „Meniu Digital + Rezervări" în PLAN_LABELS +
  PLAN_NAMES + plans.ts (cele 3 locuri sincronizate).

## Pașii pentru restaurant (copy-ul din cardul din dashboard)

1. Intră pe **business.google.com** cu contul care administrează profilul
   localului. Dacă profilul nu e revendicat: caută localul pe Google →
   „Deții această companie?" → urmează verificarea.
2. Alege profilul → **Editează profilul** → secțiunea **Rezervări** → adaugă
   linkul din dashboard (`https://<domeniu>/r/<slug>`).
3. Salvează. Butonul apare pe Google Search și Maps de obicei în câteva zile.

Observație: pe fișele unde Google afișează agregatoare (TheFork etc.), linkul
propriu apare la „Rezervări" ca link al comerciantului — tot vizibil, dar
poziționarea exactă o decide Google.

## Treptele următoare (contextul strategic)

- **Treapta 2 — SEO**: sitemap cu /m/:slug + /r/:slug după domeniul propriu,
  Search Console, directoare pe oraș (EXPANSION.md, axa 4).
- **Treapta 3 — Reserve with Google (end-to-end)**: parteneriat oficial prin
  Actions Center (feed-uri merchants/services/availability + booking server).
  Primitivele există (`get_tables_availability`, `create_reservation_public`);
  se aplică DOAR cu masă critică (~15–20 de localuri cu rezervări active) —
  treptele 1–2 construiesc exact acest portofoliu.

## Operațional

- Modulul `reservations` e default OFF: pentru clienții existenți care vor
  butonul Google, activarea modulului devine pas standard (Setări → Module).
- KPI-uri de urmărit din prima: nr. rezervări cu sursă publică per local,
  rata de no-show pe conturile FĂRĂ SMS (muniție de vânzare pentru Automate),
  conversia free→starter pe cohortele venite prin /rezervari.
