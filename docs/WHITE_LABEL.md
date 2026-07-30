# White-label v1 — meniul public pe domeniul agenției

Val E5 (săptămâna 9, PLAN_10_SAPTAMANI). Agențiile web/marketing care revând
Menuvia (afiliați activi) își pot servi clienții de pe **propriul domeniu**,
cu **brandingul lor** în subsolul meniului public, în locul badge-ului
„Meniu digital creat cu Menuvia".

## Cum funcționează (arhitectură)

- Netlify servește **același bundle** pe orice domeniu atașat site-ului —
  nu există build per agenție. Decizia de branding se ia la **runtime**, pe
  `window.location.hostname` (`src/lib/whiteLabel.ts`).
- Pe un hostname care nu e al platformei (menuvia.ro / *.menuvia.ro /
  *.netlify.app / localhost / VITE_APP_URL), meniul public cheamă RPC-ul anon
  `resolve_agency_branding(hostname)` (mig 236):
  - dacă domeniul aparține unui afiliat **activ** → subsolul afișează
    `Meniu digital de {brand_name}` + logo, **fără link spre Menuvia**;
  - altfel (domeniu necunoscut, afiliat suspendat/pending, eroare de rețea,
    migrație neaplicată) → fallback tăcut la badge-ul Menuvia.
- RPC-ul expune DOAR `brand_name` și `brand_logo_url` (whitelist cu asserție
  fail-closed — niciodată referral_code/comisioane/profile_id).
- `hide_branding` (Plan 2+, mig 225) rămâne deasupra: dacă restaurantul și-a
  ascuns brandingul, nu apare nici Menuvia, nici agenția.

## Pașii de configurare (founder, o dată per agenție)

1. **FounderPage → Afiliați → Configurează (White-label)**: setează domeniul
   (ex. `menu.agentia.ro`), numele afișat și URL-ul logo-ului. Validări
   server-side: format hostname, domeniile Menuvia sunt rezervate, un domeniu
   nu poate fi folosit de două agenții.
2. **Netlify → Domain management → Add domain alias**: adaugă exact același
   domeniu pe site-ul menuvia. (Fără pasul ăsta, domeniul nu servește nimic.)
3. **Agenția, în DNS-ul ei**: `CNAME menu.agentia.ro → menuvia.netlify.app`
   (sau apex prin ALIAS/ANAME). Certificatul TLS îl emite Netlify automat
   după propagare.
4. Verificare: `https://menu.agentia.ro/m/<slug-client>` afișează meniul cu
   „Meniu digital de {agenție}" în subsol.

## Limite cunoscute (v1)

- Domeniul agenției servește TOT site-ul (inclusiv landing/dashboard) — v1
  schimbă doar brandingul meniului public (`/m/:slug`, `/q/:token`), care e
  singura suprafață pe care o văd clienții finali. Rutele de marketing pe
  domeniul agenției rămân Menuvia (acceptat v1; separarea per-rută = v2).
- Logo-ul e un URL extern furnizat de founder (nu upload) — v2 poate folosi
  storage-ul Supabase.
- SEO: domeniul agenției nu are sitemap propriu; canonical-urile rămân pe
  domeniul principal.

## Teste

`tests/sql/white_label_benchmark_assertions.sql` (WB1–WB5, în CI): normalizare
+ validare domeniu, rezervate, resolve doar pe activi, unicitate, benchmark.
