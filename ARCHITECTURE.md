# Menuvia — Harta sistemului (1 pagină)

> Scopul acestui document: să-ți recuperezi modelul mental în 5 minute,
> nu să documenteze fiecare detaliu. Detaliile stau în cod și în `docs/`.

## Ce este

SaaS pentru restaurante din România: meniu digital QR → comenzi de la masă →
(în pilot) fiscalizare. React + TypeScript + Supabase (Postgres/RLS/RPC) + Netlify.

## Regula de aur (decizia comercială centrală)

**Bani + bon fiscal = Plan 3, fără excepții.**

| Tier | Nume comercial | Intern (DB/Stripe) | Ce primește clientul |
|---|---|---|---|
| 1 | 📖 Meniu Digital | `free` (demo), `starter` | meniu QR citibil, design, analytics simple |
| 2 | 🛎 Meniu + Comenzi | `growth` | comenzi de la masă, KDS, ospătari, rapoarte **operaționale**; plata pe casa existentă a localului — comanda se „închide" (`closed`), nu se „plătește" |
| 3 | 🧾 Fiscalizare | `pro`, `enterprise` | plăți în aplicație, bon fiscal (bridge FiscalNet: Datecs/Activa/Tremol), TVA, casă & tură, facturi Oblio |

Sursa de adevăr în cod: `src/lib/features.ts` (`planTier()`), server-side `plan_features` + RPC `get_restaurant_features`.
**Planul aparține restaurantului (owner-ului), nu user-ului** — staff-ul își ia tier-ul prin `useFeatures(restaurantId)`.

## Gating: Porțile A–D (enforcement SERVER-side; UI doar ascunde)

- **Gate A** (mig 083): `create_order` refuză ordering pe planuri fără `order_qr`.
- **Gate B** (mig 084 + fix 088): comanda QR cere sesiune de masă validă (`table_sessions`, token, expirare).
- **Gate C** (mig 085/087): lifecycle `served → closed` (închidere NON-fiscală, Plan 2) gated pe feature `table_lifecycle`; `paid` rămâne exclusiv Plan 3.
- **Gate D** (mig 086): module opționale per restaurant (`restaurant_modules`, ex. rezervări) — tab-urile dispar când modulul e OFF.

## Fluxul central: comanda QR

```
Client scanează QR (masă) → QrMenuPage → start_table_session (token)
  → create_order RPC (validări: sesiune, plan, stoc, limite)
  → KDS (KitchenPage): new → confirmed → preparing → ready
  → WaiterPage: served → [Plan 2] closed | [Plan 3] paid (PayModal, split, tips)
  → [Plan 3 + modul online_payments] clientul plătește DIN TELEFON: PayTableSheet
    → fn table-payment (suma DOAR server-side, begin_table_payment)
    → Stripe pe contul CONECTAT al localului → webhook Connect → settle_table_payment
    → orders paid (card_online) → același trigger fiscal → bonul iese pe casă
Toate tranzițiile prin RPC advance_order (roluri + stare + plan verificate în DB).
```

## Unde stă ce (src/)

| Strat | Locație | Notă |
|---|---|---|
| Rute | `App.tsx` | DOAR routing (parsePath + View union); paginile de marketing au fost extrase |
| Marketing | `pages/{Landing,Pricing,AfiliatIntro}Page.tsx` + `components/marketing/` + `lib/marketing.ts` | paleta `MKT` (nu `D`); MarketingHeader/Footer, PhoneFrame (randează meniul REAL), Reveal |
| Pagini | `pages/` | Dashboard (grupuri filtrate pe tier), Waiter, Kitchen, QrMenu, PublicMenu, Auth, Onboarding, Recrutare, **FounderPage** (/founder), **AfiliatPage** (/afiliat, logat) |
| Tab-uri dashboard | `components/*Tab.tsx` | lazy-loaded (jsPDF/recharts doar la click) |
| Logica de date | `lib/` | `orders.ts` (RPC wrappers), `features.ts` (plan gating), `offlineSync.ts` (ospătari offline), `founder.ts` (RPC-uri admin_* + mecanica founder-view), `ai.ts` |
| State | `contexts/` (Auth, Restaurant) + `hooks/` | `useOrders` = realtime + polling fallback + optimistic advance; RestaurantContext injectează membership sintetic 'manager' în mod founder/partener |

## Migrațiile (204) — grupate pe „de ce", nu pe număr

| Grup | Migrații | Povestea |
|---|---|---|
| Fundație | base, 001–008 | tabele, RLS inițial, create_order v1 |
| Hardening securitate | 011–015, 035, 046–048, 056 | audituri repetate: REVOKE-uri, advisory locks, rewrite create_order |
| Feature-uri operare | 016–024 (waiter calls, split bill, floor plan, push, alergeni), 057–058 (rezervări), 036+077 (happy hour) | creșterea produsului |
| Fiscal & bani | 027–033 (TVA, bridge, discounts, cash shifts, rapoarte), 041 (Oblio), 050–053 (4 runde fix fiscal payload), 045, 109 (TVA 2025), 150, 158–159 (gate fiscal pe venit/facturi) | cel mai patch-uit domeniu — normal, e cel mai sensibil |
| Growth/ops intern | 037 (leads), 039–040, 060–061 (alerting, winback), 044 (audit log), 042 (GDPR), 179 (retenție fiscală 10 ani la ștergere cont) | nu ating produsul de la masă |
| Taxonomie planuri | 062, 068, 071, 028, 089 | nașterea plan_features; 089 aliniază DB cu `lib/plans.ts` |
| Quality pass comenzi | 059, 063–066, 069, 072–076, 078–082 | bug-uri reale găsite în folosință: race-uri, RLS pe rezervări, optimistic lock |
| **Porțile A–D (monetizare)** | **083–088** | gating server-side pe plan; 088 repară 5 bug-uri din 084 care blocau comanda QR |
| Securitate QR + sesiuni | 090–092, 094 | rate limit, „cere nota", tracking legat de sesiune, 5 fix-uri P0 |
| **Authorization lockdown** | **096A → 096B → 096C** | închidere P0 owner-membership: model cu 2 invariante + REVOKE-by-default + 7 RPC SECURITY DEFINER (vezi mai jos). |
| **Afiliere + payouts** | **097(a–d), 098–108, 110** | affiliates/attributions/touches + `affiliate_ledger` WORM (bani în cents, bps); comisioane pe `invoice.paid` (mig 099, citește bps LIVE din rândul afiliatului); payouts cu state machine + settle trigger (098); Wise 2-faze; incrementality touch server-side |
| Hardening Plan 1+2 | 111–143 | 2 runde de audit adversarial: gate-leak fiscal universal (124, 133), izolare multi-tenant, `security_invoker` pe views |
| Rescriere create_order | 145–157 | 145 = ultima definiție create_order (fără twin); guards: FOR UPDATE, slug case-insensitive, tenancy pe category/happy-hour |
| **Platforma AI** | **168–171, 185** | `profiles.is_platform_admin` + ai_provider_configs/ai_usage/ai_quota; BYO key criptat; credite Stripe idempotente; 185 = idempotență metering pe request_id |
| Reziliență/observabilitate | 160–167, 172–184 | audituri notate: email queue atomic-claim + reclaim, backoff Oblio, health hardening, fix coloană rapoarte (180: `oi.unit_price`→`item_total`), dedup guard update_order_items (184) |
| **Founder + partener + comisioane** | **186–190, 193** | vezi secțiunea de mai jos |
| Min/max opțiuni per grup | 191–192 + `tests/sql/order_group_min_assertions.sql` | minimul per grup impus server-side în create_order/update_order_items (hint `missing_required_group`) |
| Igienă advisors | 194 | search_path pe 14 funcții vechi + fără listarea publică a bucket-ului product-images |
| Founder self-heal + feedback | 195–196 | trigger `trg_seed_platform_admin` (platform admins auto pe emailuri fondatoare) + `submit_order_feedback` |
| **Meniu multilingv** | **197** | `products/categories.translations` (jsonb) + `restaurants.menu_languages`; grant column-level pe coloana nouă (restaurants e column-gated); traducerile manuale + fallback la original |
| Perf meniu public | 198 | index compozit `categories(restaurant_id, display_order)` — cea mai fierbinte cale QR/public |
| **Plata online la masă** | **202–204** + `tests/sql/table_payment_assertions.sql` | enum `card_online` (→ cod FiscalNet 7), `table_payments`, RPC-uri service_role-only (begin/attach/settle — suma DOAR server-side, settle idempotent), `set_restaurant_stripe_account`; design în `docs/ONLINE_PAYMENT.md` |
| **Rezervare cu hartă („ca la cinema")** | **199–201** | `get_public_floor_plan` + `get_tables_availability` (gate modul mig 200) + `create_reservation_public` 10-arg cu `p_table_id` race-safe (199) și wrap-around program peste miezul nopții (201). Lanț 151→199→201, fără twin. |

## Founder + acces partener + comisioane (186–190, 193)

- **Funelul central de autorizare** e trio-ul `is_admin`/`is_member`/`my_role` (096a) — TOATE RLS-urile și RPC-urile trec prin el. A fost extins de exact DOUĂ ori: `or is_platform_admin()` (186, fondatorul vede tot) și `or has_partner_access()` (187, afiliatul intră pe restaurantele referite). Orice modificare viitoare aici e o schimbare de rază de acces pe TOATĂ platforma — tratează ca atare.
- **`has_partner_access`** (187, înăsprit în 193): afiliat `active` + atribuire ne-terminală (NU `canceled/refunded/expired`) + `partner_access_revoked_at is null`. Ownerul poate revoca din tabul Echipă (`revoke_affiliate_access`); accesul cade AUTOMAT când abonamentul referitului moare.
- **Mod founder/partener (frontend)**: `enterFounderView(id, origin)` scrie `menuvia_founder_view` (+ `_from`) în localStorage → RestaurantContext injectează membership sintetic 'manager' DOAR dacă SELECT-ul RLS pe restaurants trece → banner „⚡ Mod fondator / 🤝 Mod partener" în DashboardPage; ieșirea/„Panou fondator" curăță cheile. Vizitele se auditează prin `log_partner_visit`.
- **13 RPC-uri `admin_*`** (186) + `platform_audit_log`: overview KPI, listă restaurante (+ schimbare plan, care e per-OWNER — un owner cu N restaurante le schimbă pe toate), retry email/facturi, payouts mark-paid, arbore afiliați, audit. Toate gate `is_platform_admin()`, toate logate.
- **Comisioane** (188–189): `platform_settings` (key/value jsonb, founder-only) ține `affiliate_commission_defaults`; fondatorul le editează global sau per afiliat (`admin_set_affiliate_commission`, „aplică la toți"); `register_affiliate` inserează bps-urile din settings; `get_affiliate_public_defaults` (anon) expune DOAR setup/recurring/cap pe pagina publică /afiliat — niciodată cascade.

## Authorization lockdown (096A/B/C)

Modelul cu DOUĂ invariante coexistente, ambele necesare:

- `trg_restaurants_owner_id_immutable` (BEFORE UPDATE pe `restaurants`, 096A): blochează modificarea `owner_id`. Fără el, o tranzacție ar putea pivota owner_id ca să „alinieze" un membership compromis.
- `trg_enforce_owner_membership_invariant` (CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED pe `restaurant_memberships`, 096C): la COMMIT, fiecare restaurant are exact 1 owner membership aliniat cu `restaurants.owner_id`. Permite tranzitul intra-tx; respinge stările finale rupte. Înlocuiește guardul tranzitoriu per-statement `trg_block_owner_membership_mutation` din 096A (care a fost drop-uit în 096C).

Regimul de privilegii (096B):
- REVOKE INSERT/UPDATE/DELETE pe `restaurants`/`restaurant_memberships`/`invite_tokens` pentru PUBLIC/anon/authenticated.
- `restaurants` păstrează UPDATE column-level pe whitelist 21 coloane (sursa de adevăr: `RESTAURANT_UPDATE_FIELDS` în `src/lib/sanitize.ts`). `slug` și `owner_id` sunt deliberat excluse.
- Mutațiile pe memberships/invites/slug merg exclusiv prin RPC SECURITY DEFINER.

7 RPC pe această suprafață (toate returnează `jsonb`, `search_path = public, pg_temp`, PUBLIC zero EXECUTE): `preview_invite`, `accept_invite`, `create_restaurant`, `change_member_role`, `remove_member`, `revoke_invite`, `change_restaurant_slug`.

Schema `archive.invite_tokens_owner_history` (096C): append-only, zero privilegii pentru roluri aplicație. Conține istoricul owner-invite arhivat pre-`VALIDATE CONSTRAINT invite_tokens_role_not_owner`.

Workflow `sql-verify.yml` are gate-uri phase-aware (mutuabil exclusive):
- phase-1A (A1–A8) când 096A există dar 096B/096C nu.
- final-state (F1–F9) când 096B există dar 096C nu.
- phase-1C (G1–G8) când 096C există.

Pre-flight pentru deploy 096C în prod: `psql -f scripts/preflight_096c.sql` (read-only, exit=0 când e safe).

Lecția lanțurilor „fix-for-fix" (050→053, 084→088): domeniile fiscal și ordering
se schimbă DOAR cu testul de migrații din CI (job „Apply all migrations", Gate B+ assertions).

## Datorii cunoscute (de atacat separat, nu „rescriere")

1. **Frontend-ul de PROD e în urmă (actualizat 2026-07-04)** — DB-ul de producție e LA ZI (migrațiile 172–195 aplicate pe 3 iulie + 197–201 pe 4 iulie + 202–204 (plata online) pe 6 iulie prin MCP, cu markeri verificați: `products.translations`, `create_reservation_public` 10-arg + wrap-around, gate modul pe RPC-urile de hartă), dar frontend-ul de prod e ÎNCĂ din 30 iunie: build-urile de producție Netlify NU se declanșează la push pe main. **Nimic din valurile UX/corectitudine/multilingv/rezervări-cu-hartă din 4 iulie (#154–#166) nu e vizibil live până la deploy.** Fix: Trigger deploy pe main + deblocarea auto-build-urilor. De setat și: `PLATFORM_OPENAI_KEY` în Netlify env (AI implicit) + Supabase Auth → leaked password protection (advisor).
2. **E2E roșu cronic în CI** — lipsesc secrets + staging. Setup complet documentat pas-cu-pas în `docs/E2E_SETUP.md` (~15 min, testele-s deja defensive și read-only). Până la fix, Playwright e zgomot ignorat.
3. **Numerotare migrații cu găuri** (009-010, 067, 070, 139, 144 lipsă) — istoric, inofensiv, nu „repara".
4. **`admin_set_restaurant_plan` e per-owner** — planul stă pe `profiles.plan` al ownerului; schimbarea pentru un restaurant le schimbă pe toate ale aceluiași owner. Rezolvarea definitivă = `restaurant_subscriptions` — design complet, gata de execuție, în `docs/RESTAURANT_SUBSCRIPTIONS.md` (3 faze, Faza 0 fără schimbare de comportament).

## Cum rulezi / verifici

- Dev: `npm run dev` · Teste: `npm run test` · E2E local: `npm run test:e2e`
- SQL fără CI: `bash scripts/verify-migrations-local.sh` (replay complet + asserțiile din sql-verify.yml pe Postgres 16 efemer) · Load test: Actions → „k6 Load Test" → Run workflow.
- Migrații noi: fișier nou în `supabase/migrations/` (NU edita migrații aplicate) → CI le aplică pe Postgres efemer → apoi manual în Supabase SQL Editor, în ordine.
- Orice feature cu bani: întreabă întâi „e tier 3?" — dacă da, gate în RPC, nu doar în UI.
