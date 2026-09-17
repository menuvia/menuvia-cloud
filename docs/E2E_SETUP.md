# E2E în CI — istoric (SUPERSEDED, aug 2026)

> Jobul „Playwright E2E" din `.github/workflows/ci.yml` e **ERMETIC** și verde pe
> main din august 2026: `supabase start` local (fără auto-migrații) → pre-curățarea
> default privileges pe `service_role` → migrațiile aplicate cu `psql` → user E2E prin
> GoTrue admin → `supabase/scripts/seed_tinctura_demo.sql`. **Zero secrets, zero
> proiect de staging.** Sursa de adevăr pentru rulare e workflow-ul însuși + bullet-ul
> „Jobul E2E din ci.yml e ERMETIC" din `CLAUDE.md`.

Acest document descria (iunie 2026) o problemă rezolvată de atunci: jobul era roșu
cronic fiindcă build-ul primea un Supabase placeholder, iar propunerea era un proiect
de staging + 4 secrets. Propunerea NU a fost adoptată — abordarea ermetică o face
inutilă — și instrucțiunile ei au fost scoase de aici ca să nu mai poată fi urmate
din greșeală (măturarea din 16 sept 2026, DOC-8). Rămâne doar ca urmă istorică.
