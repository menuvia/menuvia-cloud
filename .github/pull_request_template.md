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
- [ ] Am adăugat migrație nouă, cu numărul următor disponibil (`<14 cifre>_migration_NNN_nume.sql`) și manifestul regenerat (`node scripts/gen-schema-manifest.mjs`)
- [ ] Migration verifier (sql-verify.yml) a trecut local
- [ ] Migrația e idempotentă (poate fi rulată de 2 ori fără să strice)
- [ ] Schemele NU au schimbat ENUM-uri existente fără `ALTER TYPE ... ADD VALUE`
- [ ] ⚠️ **Ordinea de deploy**: migrațiile se aplică pe prod de workflow-ul
      `apply-prod-migrations` (după CI verde pe `main`; procedura în
      `docs/RUNBOOK.md` §6.5), NU din SQL Editor. Dacă frontend-ul sau o funcție
      cere migrația deja aplicată (RPC/coloană nouă fără fallback PGRST202), am
      notat în descriere ordinea și ce se întâmplă în fereastra dintre ele.

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
