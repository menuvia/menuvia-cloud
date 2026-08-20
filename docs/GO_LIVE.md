# GO_LIVE — planul complet de lansare (starea verificată: 28 iulie 2026)

> ⚠️ **SUPERSEDED (20 aug 2026):** planul de execuție UNIC și curent e
> [`PLAN_0_TO_HERO.md`](PLAN_0_TO_HERO.md) — ancorat în datele reale de
> producție. Documentul de mai jos rămâne DOAR context istoric; nu executa
> pași de aici fără să verifici întâi acolo.

> Documentul de EXECUȚIE: de la starea de azi până la producție live + pragurile
> de scalare, cu numere măsurate. Direcția de produs rămâne în `MASTER_PLAN.md`;
> calendarul lung în `PLAN_10_SAPTAMANI.md` (scris la mig 229/prod 214 — depășit
> ca stare, valabil ca direcție). Legendă: 🤖 = Claude (la un cuvânt) · 👤 = fondator.

---

## 0. Starea EXACTĂ (dovezi, nu impresii)

**Cod** — branch `claude/git-repo-issue-VoAxY` @ `bd74def`, PR #188 (draft).
Toate commit-urile cu preview Netlify verde. Validare: replay complet al celor
253 de migrații pe PG16 local = **72 PASS / 0 FAIL**; 6 runde de optimizare +
4 runde de review adversarial pe propriul output — toate findings-urile închise.

**Prod DB** (Supabase `swjcptdylfmpvopdepqf`) — la **mig 251**, verificat
independent post-aplicare (7/7 verificări de catalog). Două migrații validate
așteaptă autorizarea explicită:
- **252** — idempotență DB-enforced pe deducerea de stoc + backfill istoric
  (backfill măsurat empiric: **2,2 s pe 129k comenzi terminale**, sub timeout-ul
  de 120 s → sigur).
- **253** — gate fiscal ca semi-join în cele 4 view-uri de analytics
  (**43×/15×/4× măsurat**) + meniu QR cu plan liniar (ieșire **byte-identică**,
  verificată pe meniuri de 150 și 1200 de produse).

**Frontend prod** — NEdeployat: producția servește încă seria din 30 iunie.
**Ăsta e decalajul principal.** Trei bug-uri critice găsite și reparate în
sesiune ar fi lovit utilizatorii la primul deploy fără fix-uri:
1. „Intră pe cont" (fondator/partener) era mort — cheia localStorage era ștearsă
   la fiecare încărcare la rece; ownerii multi-restaurant pierdeau selecția la
   fiecare refresh.
2. Stocul pe planul growth nu se deducea NICIODATĂ (comenzile growth se termină
   în `closed`, nu `paid`) — mig 250.
3. Emailul de dunning se pierdea definitiv la un blip de DB (webhook ACK 200 →
   Stripe nu retrimitea) → churn involuntar.

**Neverificat încă** (blocat de mediu, nu de muncă):
- Env-urile reale din Netlify (MCP-ul a dat 502) — lista necesară e în §1 pasul 3.
- Advisors de performanță pe prod (Supabase MCP jos) — de rulat la reconectare.
- **Niciun test uman în browser** pe seria nouă — totul e validat static +
  replay + review, nu prin click-uri. De aceea Faza 1 începe cu testul manual.

---

## FAZA 0 — 🤖 la un cuvânt (~2 min)

Spui **„aplică 252 și 253 pe prod"** → aplic ambele prin MCP + verific markerii
post-aplicare (ca la 215→251). Risc minim: 252 e aditiv + backfill măsurat;
253 e doar recreare de view-uri/funcție, instant, semantică identică.
Ordinea DB-înainte-de-frontend e deja respectată: schema e compatibilă înapoi
cu frontend-ul vechi (dovedit — prod rulează de zile întregi pe 251 cu
frontend-ul din 30 iunie).

## FAZA 1 — 👤 Go-live (~45 min, ORDINEA CONTEAZĂ)

1. **Test manual pe preview** (10 min) — `deploy-preview-188--menuvia.netlify.app`:
   - login → dashboard se încarcă; comută între restaurante dacă ai mai multe
     (selecția trebuie să SUPRAVIEȚUIASCĂ unui refresh — bug reparat);
   - `/founder` → „Intră pe cont" pe un restaurant → bannerul de mod fondator
     apare și rămâne după refresh (bug reparat — cel mai important de văzut);
   - meniul QR pe telefon (`/m/:slug`) + o comandă de test.
2. **Supabase Auth → Leaked password protection = ON** (1 min, dashboard
   Supabase → Authentication → Providers → Password).
3. **Netlify env** (5 min): adaugă `PLATFORM_OPENAI_KEY` (cheia OpenAI a
   platformei — fără ea AI-ul răspunde cu eroare clară, nu tăcut). Verifică în
   trecere că restul din `.env.example` există deja în Netlify.
4. **Merge PR #188** (squash) → `main` → build + deploy de producție Netlify
   (5 min). Abia acum frontend-ul nou devine live.
5. **Smoke pe producție** — checklist-ul din Faza 2 (15 min).

De ce ordinea asta: env-urile ÎNAINTE de merge (funcțiile noi găsesc cheile la
primul boot); testul manual ÎNAINTE de merge (singura verificare umană a seriei).

## FAZA 2 — Verificare post-deploy (👤 15 min, 🤖 la cerere)

| Deschizi | Trebuie să vezi |
|---|---|
| `/` și `/en` | landing-ul nou (nu seria din 30 iunie); `/en` cu `lang="en"` |
| `/m/:slug` pe telefon | meniul se încarcă într-un singur request de meniu (mig 245) |
| QR la masă → comandă | comanda ajunge în Bucătărie/Ospătar în timp real |
| Dashboard → Statistici | se încarcă instant (semi-join 253, dacă ai aplicat Faza 0) |
| Dashboard → Rezervări | tabul există (era ascuns în seria veche) |
| `/founder` | vezi tot; „Intră pe cont" funcționează + banner persistent |
| Setări → Asistent AI | toggle simplu; un mesaj în chatbot primește răspuns (cheia din Faza 1.3) |

🤖 după deploy, la un cuvânt: rulez advisors (securitate + performanță) pe prod
și verific logurile funcțiilor prin MCP când e conectat.

## FAZA 3 — Cloudflare Pages (opțional, când vrei — ~15 min)

Frontend static pe CDN edge gratuit; funcțiile + cron-urile RĂMÂN pe Netlify,
proxate transparent. Codul e gata (`src/lib/fn.ts` + `functions/_fn/[[name]].js`);
pașii click-cu-click + checklist + **rollback DNS instant** în
`docs/CLOUDFLARE_PAGES.md`. Beneficiu: taie costul de bandwidth Netlify și
accelerează scanările QR pe 4G. Nu bloca lansarea pe asta — e pasul de după.

## FAZA 4 — Praguri de scalare (numere MĂSURATE, nu intuiții)

Măsurat în lab (PG16, 198k comenzi / 250k itemi / 1200 produse / 50 tenanți),
după mig 253:

| Cale fierbinte | Timp măsurat | Observație |
|---|---|---|
| Meniu QR (150 produse — realist) | **22 ms** | 275 ms abia la 1200 produse (~5 MB jsonb) |
| Rate-limit comandă QR | **0,045 ms** | index parțial mig 244, confirmat folosit |
| Disponibilitate mese (hartă rezervări) | **0,068 ms** | Index Only Scan (mig 246) |
| Statistici (AnalyticsTab) | **50 ms** | era 2.170 ms înainte de 253 |
| Top produse | **150 ms** | era ~2.300 ms |
| Raport TVA | **450 ms** | rezidualul e CTE-ul de subtotaluri; raport on-demand — acceptat |
| Rapoarte interval / venit | **7,8 / 4,7 ms** | indexuri mig 244 confirmate |

**Concluzia:** arhitectura actuală (Supabase Cloud + Netlify) ține lejer
**~50 de tenanți cu până la ~100k comenzi fiecare** fără nicio schimbare.
Declanșatoare de schimbare (nu înainte):
- **VPS Hetzner pentru funcții/cron** (shim-ul din `deploy/` e gata, ~€8/lună):
  când factura de funcții Netlify depășește ~€10/lună sau cron-urile intră în
  throttling. Mutarea = o variabilă de env (`NETLIFY_FN_ORIGIN`), vezi
  `VPS_RUNBOOK.md`.
- **Supabase Pro** (~$25/lună): de la PRIMUL client plătitor — backup-ul PITR e
  asigurarea datelor fiscale (retenție 10 ani). DB-ul NU se self-hostează.
- **Raport TVA sub 100 ms** / **meniu >1000 produse** (paginare produs-level):
  doar dacă un tenant real atinge ~50k+ comenzi, respectiv ~1000+ produse —
  ambele sunt schimbări structurale, documentate aici ca să nu fie re-analizate.

## FAZA 5 — Produs, după livrare

Direcția rămâne cea din `MASTER_PLAN.md` + `PLAN_10_SAPTAMANI.md`: pilot fiscal
real (bridge .exe + casă demo, `BRIDGE_FISCALNET_ARCHITECTURE.md`), E2E verzi în
CI, k6, apoi valurile de creștere din `EXPANSION.md`. Nimic de aici nu blochează
și nu e blocat de Fazele 0–3.

---

## Anexă — asumpții rămase și cum se închid

1. **Env-urile Netlify** — presupun că cele din seria veche există; se verifică
   în Faza 1.3 (2 min în dashboard).
2. **Fluxurile în browser** — validate doar static/replay/review; se închid în
   Faza 1.1 (10 min de click-uri).
3. **GitHub Actions** — istoric mort pe cotă (PLAN_10); preview-urile Netlify au
   ținut loc de CI pe TS. La merge, dacă Actions e viu, „Apply all migrations"
   mai rulează o dată gratuit; dacă nu, replay-ul local (72 PASS) e acoperirea.
