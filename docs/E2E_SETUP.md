# E2E verde în CI — setup staging (o singură dată, ~15 minute)

> Starea azi: jobul „Playwright E2E" e roșu cronic pentru că build-ul din CI
> primește un Supabase placeholder. Testele sunt deja scrise defensiv
> (skip grațios fără secrets, skip pe `/m/tinctura` fără seed) și sunt
> **read-only** — auth-flow încearcă doar credențiale invalide, security-rls
> doar citește. Lipsesc exact 2 lucruri: o instanță de staging și 4 secrets.

## Pasul 1 — Proiect Supabase de staging

Creează un proiect NOU în organizația existentă (Dashboard → New project,
ex. `menuvia-staging`, regiunea eu-central-1). Pe planul free ai 2 proiecte
incluse — al doilea e gratuit.

> Variantă rapidă: cere-i asistentului „creează staging-ul E2E" — poate face
> singur proiectul (cu confirmarea costului), aplica migrațiile și seed-ul
> prin MCP; rămâne să setezi doar secrets-urile din pasul 4.

## Pasul 2 — Migrațiile (toate, în ordine)

Pe staging NU există nimic — se aplică tot lanțul din `supabase/migrations/`
(base_schema → migration_195), în ordine. Cel mai simplu, local:

```bash
# connection string din Dashboard → Project Settings → Database
export DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres'
cd supabase/migrations
for f in $(ls *.sql | sort -V); do
  echo "== $f"; psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || break
done
```

(Toate migrațiile sunt idempotente — re-rularea e sigură.)

## Pasul 3 — Seed + cont QA

```bash
psql "$DATABASE_URL" -f supabase/scripts/seed_tinctura_demo.sql
```

Apoi creează contul de test: deschide aplicația pointată la staging (sau
Dashboard → Authentication → Add user) cu un email/parolă dedicate, ex.
`qa@menuvia.ro` / o parolă generată. Contul nu are nevoie de niciun
restaurant — testele autentificate verifică doar navigarea și RLS-ul.

⚠️ `seed_tinctura_demo.sql` e DOAR pentru staging/dev — nu-l rula pe
producție (creează restaurantul demo `tinctura`).

## Pasul 4 — GitHub secrets

Repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Valoare |
|---|---|
| `VITE_SUPABASE_URL` | URL-ul proiectului de STAGING (`https://<ref>.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | anon key-ul de STAGING (Project Settings → API) |
| `E2E_EMAIL` | emailul contului QA din pasul 3 |
| `E2E_PASSWORD` | parola contului QA |

## Pasul 5 — Verificare

Re-rulează jobul „Playwright E2E" pe orice PR (Actions → re-run). Verde =
datoria #2 din ARCHITECTURE.md e închisă; de atunci un E2E roșu e regresie
REALĂ, nu zgomot.

## Întreținere

- Migrațiile noi se aplică și pe staging (aceeași buclă din pasul 2 —
  idempotența face catch-up-ul banal).
- Dacă staging-ul free adoarme din inactivitate (pauză după ~1 săptămână),
  Dashboard → Restore; E2E-ul rulează la fiecare PR, deci în ritm normal de
  dezvoltare nu adoarme.
