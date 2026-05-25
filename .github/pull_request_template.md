<!--
PR Template Menuvia — completează ce e relevant, șterge restul.
Pentru schimbări mici, păstrează doar primele 2 secțiuni.
-->

## Ce face acest PR

<!-- O frază clară: "Adaugă feature X" / "Repară bug Y" / "Refactor Z" -->

## Tip

- [ ] Bug fix (nu schimbă API)
- [ ] Feature nou (compatibil cu cod existent)
- [ ] Breaking change (necesită migrație / coordonare cu bridge)
- [ ] Refactor / cleanup (fără schimbare comportament)
- [ ] Documentație / configurări CI
- [ ] Performance
- [ ] Securitate

## Migrații SQL

- [ ] Nu am modificat `supabase/`
- [ ] Am adăugat migrație nouă, numele e următorul disponibil (migration-XXX-...)
- [ ] Migration verifier (sql-verify.yml) a trecut local
- [ ] Migrația e idempotentă (poate fi rulată de 2 ori fără să strice)
- [ ] Schemele NU au schimbat ENUM-uri existente fără `ALTER TYPE ... ADD VALUE`

## Testare

<!-- Cum ai verificat că merge? -->

- [ ] Unit tests adăugate / actualizate
- [ ] Am rulat `npm run check-all` local
- [ ] E2E (Playwright) testat manual / via CI

## Cum testez review-erul

<!-- 1-3 pași concreti pentru reproducere -->

## Risc

- [ ] Low — schimbare izolată, fără impact dincolo
- [ ] Medium — atinge zonă des folosită (orders, fiscal)
- [ ] High — atinge zonă critică (auth, RLS, plăți, bridge contract)

## Pentru bridge (dacă PR atinge contractul)

- [ ] Nu afectează bridge
- [ ] Atinge contract — am verificat compatibilitate cu bridge v0.6.0+
- [ ] Necesită bridge update — versiune minimă: `_______`

## Checklist final

- [ ] CI a trecut (lint, typecheck, tests, build)
- [ ] Nu am împins secrete (API keys, tokens, parole)
- [ ] Nu am împins fișiere mari (>1MB) fără motiv
- [ ] Documentația / README actualizată dacă e nevoie
