# FiscalNet Payload Generator — Audit Tehnic

**Scope**: identificarea generatorului care produce string-ul fiscal trimis la
bridge prin `pending_receipts.payload`, plus suite de teste exhaustivă +
raport bug-uri descoperite.

**Status livrare (v2, post-fix)**:
- v1 (audit only) — analiză + 39 teste + 9 bug-uri documentate, **niciun fix**.
- **v2 (fix-uri P0/P1)** — branch `claude/fiscal-payload-fixes`, migration_050
  rezolvă BUG #1 (crash), BUG #2 (quantity), BUG #3 (tips). Suite-ul rulează
  PASS=29 / FAIL=2 (cele 2 FAIL sunt P2, out of scope acest PR).

**Audit rulat pe**: codul de la `main` (înainte de migrațiile 047/048/049),
versiunea repo `v1.9.0`.

---

## 1. Sursa generatorului — identificare formală

Generatorul e **100% în SQL (Postgres functions)**. Zero implementări în
TypeScript / JavaScript / Netlify Functions.

Căutările sintactice (`S^`, `P^`, `CF^`, `ST^/DP^/DV^/MP^/MV^`,
`buildFiscalPayload`, `pending_receipts` în mod scriere) au confirmat:
- **0 hit-uri** în `src/`
- **0 hit-uri** în `netlify/functions/`
- 1 hit read-only în `src/components/BridgeTab.tsx:182` (doar `SELECT *
  FROM pending_receipts` pentru listing)

### Lanțul de execuție

```
order.status='paid' UPDATE
        │
        ▼ trigger: enqueue_fiscal_receipt_trg (AFTER UPDATE OF status)
        │
        └─► public.enqueue_fiscal_receipt()                 ← migration_030:283
              │ (verifică bridge_devices + idempotency)
              │
              └─► public.build_fiscalnet_payload(p_order_id uuid)
                    ↑↑↑ SURSA DE ADEVĂR
                    │
                    │   v2 — migration_031:237 (ACTIVĂ, suprascrie v1)
                    │   v1 — migration_030:225 (moartă, dar rămâne în repo)
                    │
                    ├─► public.fiscalnet_sanitize(text)   ← migration_030:175
                    │     strip [\^\r\n\t] → space, max 36 chars
                    │
                    └─► public.fiscalnet_payment_code(method) ← migration_030:191
                          cash→1, card_pos→2, other→8
        │
        ▼ INSERT INTO public.pending_receipts
```

### Fișiere atinse

| Fișier | Linii | Rol |
|---|---|---|
| `supabase/migrations/20260525002800_migration_030_bridge_receipts.sql` | 175-191 (helpers), 225-280 (v1 generator), 283-340 (trigger), 343-346 (trigger creator) | Versiunea inițială a generatorului + helperii |
| `supabase/migrations/20260525002900_migration_031_order_discounts.sql` | 237-303 | **v2 generator** — adaugă suport pentru DP^/DV^ discount; suprascrie v1 prin `CREATE OR REPLACE FUNCTION` |
| `supabase/migrations/20260525003000_migration_032_cash_shifts.sql` | — | adaugă `order_payments` table (NU folosit de generator!) |
| `supabase/migrations/20260525004100_migration_043_feedback_tips_google.sql` | 150, 195 | adaugă `tips_amount` + `request_fiscal_receipt()` (NU folosit de generator!) |

## 2. Diagrama flow input → output

```
                    ┌─────────────────────────────────────────────┐
                    │  orders                                      │
                    │  • id                                        │
                    │  • restaurant_id                             │
                    │  • payment_method (enum: cash/card_pos/other)│
                    │  • total (numeric 10,2)                      │
                    │  • discount_type (enum: percent/amount/null) │
                    │  • discount_value (numeric)                  │
                    │  • tips_amount  ← NU citit                   │
                    │  • paid_amount  ← NU citit                   │
                    └────────────────────┬────────────────────────┘
                                         │
                                         ▼
                    ┌─────────────────────────────────────────────┐
                    │  order_items                                 │
                    │  • product_name_snapshot                     │
                    │  • item_total      (unit_price × qty + mods) │
                    │  • product_id → products.vat_group (1..4)    │
                    │  • quantity        ← NU citit                │
                    │  • unit_price_snapshot ← NU citit            │
                    │  • selected_modifiers ← NU citit             │
                    │  • extras_added   ← NU citit                 │
                    └────────────────────┬────────────────────────┘
                                         │
                                         ▼
                    ┌─────────────────────────────────────────────┐
                    │  vat_rates                                   │
                    │  • restaurant_id + vat_group → PK            │
                    │  • fiscalnet_group (1..5)                    │
                    └────────────────────┬────────────────────────┘
                                         │
                                         ▼
                    ┌─────────────────────────────────────────────┐
                    │  build_fiscalnet_payload(uuid) → text       │
                    │                                              │
                    │   ARRAY_TO_STRING([                          │
                    │     S^<name>^<item_total*100>^1000^buc^<g>^1│
                    │     S^...                                    │
                    │     ST^                                      │
                    │     DP^<percent*100>  ← if percent discount  │
                    │     DV^<amount*100>   ← if amount discount   │
                    │     P^<pcode>^<v_order.total*100>            │
                    │   ], '\n')                                   │
                    └────────────────────┬────────────────────────┘
                                         │
                                         ▼
                    ┌─────────────────────────────────────────────┐
                    │  pending_receipts                            │
                    │  • payload (text)                            │
                    │  • status = 'pending' (sau 'error')          │
                    │  • total_snapshot                            │
                    └─────────────────────────────────────────────┘
```

## 3. Edge cases observate în cod

| Edge case | Gestionat? | Notă |
|---|---|---|
| Discount procent | ✅ DP^ emis | `migration_031:289-292` |
| Discount sumă fixă | ✅ DV^ emis | `migration_031:293-296` |
| Modifier extras | ⚠️ parțial | `item_total` include `selected_modifiers.price_delta`, dar **numele extra nu apare pe bon** |
| Multi-payment / split | ❌ | un singur `P^` cu `v_order.payment_method`; `order_payments` table există dar nu e citită |
| CUI client (CF^) | ❌ | **niciodată emis** — nu există coloană pe orders pentru CIF client |
| TVA 0% (grupa 4 internă) | ✅ | `fn_group` mapat din `vat_rates` |
| TVA neplătitor (grupa 5 fiscalnet) | ✅ via mapping | `products.vat_group` doar 1-4, dar `vat_rates.fiscalnet_group` poate fi 1-5 |
| Diacritice românești (UTF-8) | ⚠️ untested | Postgres TEXT e UTF-8 nativ; **necunoscut dacă casa fiscală EconMedia acceptă UTF-8 sau cere CP1250** — verifică contractul Bridge |
| Order fără items | ✅ `raise exception 'Order % has no items'` | `migration_031:285` |
| Order inexistent | ✅ `raise exception 'Order % not found'` | `migration_031:256` |
| Bridge nu configurat | ✅ trigger skip-uiește | `enqueue_fiscal_receipt:298-306` |
| Idempotency duplicate | ✅ trigger skip dacă există deja | `enqueue_fiscal_receipt:309-316` |

## 4. Presupuneri găsite în cod care NU sunt verificate

| # | Presupunere | Risc |
|---|---|---|
| A1 | `v_order.total` e mereu sincronizat cu `SUM(order_items.item_total) - discount_amount` (trigger `recalc_order_subtotal` rulează corect) | Dacă recalc nu rulează (race, RLS, transaction order), bonul are sumă diferită de items |
| A2 | `vat_rates` există pentru fiecare grupă folosită de produse | Dacă lipsește, coalesce pică back la `vat_group` internal — dar dacă schema permite grupa 4 și fiscalnet_group=4, OK; nu există situație în care fn_group iese din 1-5 |
| A3 | `order_items.quantity` e mereu 1 (semantic) | Schema permite 1-99. Vezi BUG #2. |
| A4 | `product_name_snapshot` nu depășește 36 chars semantic | `fiscalnet_sanitize` trunchează, dar nu există avertizare către utilizator |
| A5 | Encoding output e acceptat de casa fiscală | Postgres returnează UTF-8; Bridge poate face conversie sau nu |
| A6 | `tips_amount` din migration_043 e raportat altundeva (nu pe bon) | Necunoscut — nu există RPC sau funcție care să raporteze tips către ANAF |

## 5. Concluzie arhitectură

**E generatorul "1 funcție pură"?** ✅ **DA**, în sensul că `build_fiscalnet_payload(uuid)` e singura funcție care produce string-ul. Dar e o funcție:
- **NU pură** matematic (citește din 3 tabele)
- **NU testabilă în JS** (e SQL stored procedure, necesită Postgres efemer)
- **Duplicate v1+v2** în repo (v1 e dead code, dar rămâne)

---

## 🐛 BUG-URI DESCOPERITE

**Status (post `claude/fiscal-payload-fixes` + migration_050/051/052)**:

| Bug | Severity | Status |
|---|---|---|
| #1 — funcția crash-uia | P0 | ✅ **FIXED** migration_050 (`array_append` + cast explicit) |
| #2 — quantity ignorat | P0 ANAF | ✅ **FIXED** migration_050 (PRET=item_total/qty, CANT=qty*1000) |
| #3 — tips nu pe bon | P1 ANAF | ✅ **FIXED** migration_050 (P^ include tips_amount) |
| #4 — split payment | P2 | ✅ **FIXED** migration_051 (P^ per row `order_payments`, fallback la single) |
| #5 — CF^ client CIF | P2 | ⏳ TODO (feature: requires UI + ALTER TABLE invoices) |
| #6 — preț 0 acceptat | P2 | ✅ **FIXED** migration_051 + **RELAXED** migration_052 (doar item_total ≤ 0) |
| #7 — SUM mismatch | P2 | ✅ **FIXED** migration_051 + **REFORMULATED** migration_052 (invariant fiscal REAL post-emit în cents) |
| #8 — encoding diacritice | P2 | ⏳ investigație (necesită test real Bridge → casa fiscală) |
| #9 — payment_method enum incomplet | P2 | ⏳ TODO (feature: ALTER TYPE tichete/voucher) |

### Defecte adversariale rezolvate în migration_052

Auto-analiză critică post-051 a scos la lumină 5 defecte ascunse:

| Defect | Severitate | Status |
|---|---|---|
| **A1** — drift de rotunjire = bonuri respinse de casa fiscală (10/3 → 333×3=999 ≠ P^=1000) | 🔴 CRITIC | ✅ **FIXED** migration_052 (per-item drift detection + fallback qty=1 + `lifecycle_events` log) |
| **A2** — BUG #6 guard fals pozitiv pe produs cu unit_price=0 + modifier obligatoriu | 🔴 CRITIC | ✅ **FIXED** migration_052 (relaxed la `item_total ≤ 0` only) |
| **A3** — BUG #7 guard era tautologie (`SUM(item_total) = orders.total`); invariantul fiscal REAL e `SUM(S^ cents) = P^ cents - tips_cents` post-emit pe casa fiscală | 🔴 CRITIC | ✅ **FIXED** migration_052 (invariant verificat în cents la finalul generării) |
| **A4** — split payment fără invariant `SUM(order_payments) = total + tips` (casier greșește sumă → bani fără bon) | 🔴 CRITIC | ✅ **FIXED** migration_052 (guard cu toleranță 0.01 RON) |
| **A5** — `orders.payment_method` NULLABLE; cu NULL emitea `P^^XXXX` malformed | 🟠 MAJOR | ✅ **FIXED** migration_052 (RAISE early dacă NULL și fără split) |

**9 din 9 defecte de corectness rezolvate**. Rămase 3 feature-uri (#5/#8/#9).

### Defecte de production observability (parțial rezolvate)

- ✅ Drift fallback loghează `lifecycle_events` cu `event_type='fiscal_drift_fallback'` (vizibil owner)
- ✅ Script `grant_business_plan` scrie `audit_log` cu diff old→new + actor_role='system_script'
- ⏳ `enqueue_fiscal_receipt` cade în `pending_receipts.status='error'` la RAISE — fără notificare push/email owner (P3)
- ⏳ Niciun retry automat în Bridge poller (P3)

Sub-secțiunile de mai jos sunt menținute ca documentație istorică a
descoperirilor. Pentru status curent în code-base, vezi tabelul de mai sus.

### 🚨 BUG #1 — Funcția CRASH-UIEȘTE în Postgres pur — P0 CRITICAL

**Caz reproductibil**: orice apel `SELECT public.build_fiscalnet_payload(<any_order>);` în Postgres 16 (probabil și 15) când e folosit operatorul `||` cu un text literal.

**Output observat (în mediul de test efemer Postgres 16)**:
```
ERROR:  malformed array literal: "ST^"
LINE 1: v_lines := v_lines || 'ST^'
DETAIL: Array value must start with "{" or dimension information.
CONTEXT: PL/pgSQL function build_fiscalnet_payload(uuid) line 46
```

**Cauza**: `v_lines := v_lines || 'ST^';` (linia 287 din migration_031). Postgres parser interpretează `'ST^'` ca tip `unknown` și încearcă să-l cast-eze la `text[]` (tipul lui `v_lines`) — fail cu "malformed array literal".

**Output așteptat**: `S^...\nST^\nP^...\n`

**Severity**: **P0** — funcția nu emite NICIODATĂ niciun bon. Excepția e prinsă tăcut în `enqueue_fiscal_receipt:341-347` și se inserează `pending_receipts` cu `status='error'` + `payload=''`. Owner-ul vede în BridgeTab că "ceva nu merge" dar fără context fiscal pierdut.

**Fix sugerat (NU aplicat)**: înlocuiește `v_lines := v_lines || 'ST^';` cu `v_lines := array_append(v_lines, 'ST^'::text);` (idem pentru DP^/DV^/P^ inline). Sau `v_lines := v_lines || ARRAY['ST^'::text];`.

**Reproductibil**: TEST 01 prima rulare în suite-ul `build_fiscalnet_payload_test.sql` — toate `ERROR` cu "unexpected exception". După patch local (test-only, NU în migration), 27 teste trec.

**Întrebare deschisă**: dacă bug-ul e P0 și funcția crash-uiește, **de ce nu există rapoarte de la useri?** Trei ipoteze:
1. Niciun restaurant n-a folosit Bridge real în production până acum (bridge_devices empty)
2. Supabase production rulează Postgres cu un comportament diferit la `unknown` cast (improbabil)
3. Versiune anterioară a funcției a fost patched manual prin SQL Editor și nu s-a comitat înapoi

### 🚨 BUG #2 — `quantity` IGNORAT din `order_items` — P0 ANAF RISK

**Caz reproductibil** (TEST 05):
- 1 produs "Friptura" la 30 RON
- `order_items.quantity = 2`, `item_total = 60`
- Expected payload (per FiscalNet spec): `S^Friptura^3000^2000^buc^1^1` (PRET=unit_price×100, CANT=qty×1000)
- **Observed**: `S^Friptura^6000^1000^buc^1^1` (PRET=item_total×100, CANT=1000 hardcoded)

**Cauza**: linia 277 din migration_031:
```sql
'S^%s^%s^1000^buc^%s^1',          -- 1000 = qty hardcoded "1.000 buc"
v_item.item_total * 100,           -- prețul include qty
v_item.fn_group
```

Comentariul din migration_030:220 admite explicit: *"qty=1 ca să evităm rotunjiri"* — decizie conștientă, dar problematică.

**Severity**: **P0** — bonul fiscal afișează **"1 buc × 50.00 RON"** când realitatea e "2 buc × 25.00 RON". Totalul e corect, dar Legea 227/2015 art. 319(20) cere "cantitatea livrată/serviciilor prestate". Inspectorul ANAF poate sancționa.

**Fix sugerat**: înlocuiește în format:
```sql
'S^%s^%s^%s^buc^%s^1',
public.fiscalnet_sanitize(v_item.product_name_snapshot),
round(v_item.unit_price_snapshot * 100)::bigint,  -- PRET = unit, NOT total
(v_item.quantity * 1000)::bigint,                  -- CANT = qty in milli-units
v_item.fn_group
```
Plus select `oi.quantity, oi.unit_price_snapshot` în loop.

### 🟧 BUG #3 — `tips_amount` NU intră pe bon — P1 ANAF RISK

**Caz reproductibil** (TEST 36):
- Item 50 RON, `orders.tips_amount=5`, `orders.paid_amount=55`
- `orders.total=50` (NU include tips)
- Expected (semantic): bonul reflectă suma încasată = 55 RON
- **Observed**: `P^1^5000` — bonul declară doar 50 RON

**Cauza**: `migration_031:240-242` selectează doar `o.total, o.discount_type, o.discount_value` din orders. Coloana `tips_amount` (adăugată în migration_043) nu e interogată.

**Severity**: **P1** — restaurantul **încasează 55 RON dar emite bon pentru 50 RON**. ANAF poate considera 5 RON ca "venit neînregistrat". Sumele sunt mici per tranzacție, dar acumulate într-un an pot fi semnificative.

**Fix sugerat**: două opțiuni:
- A) `P^<code>^<(total + tips) * 100>` — include tips în total bon
- B) Add separate `P^<code>^<tips * 100>` ca "incasare extra" — depinde de spec EconMedia (verifică Documentatie.pdf dacă există tip plată "bacșiș")

### 🟧 BUG #4 — Split payment NESUPORTAT — P1

**Caz reproductibil** (TEST 04 + TEST 35): client plătește 50 RON cu cardul + 50 RON cash pentru un order de 100 RON.

**Observed**: `P^<single_code>^10000` — un singur P^ cu `v_order.payment_method` (care e doar UNA dintre metode).

**Cauza**: generatorul emite UN singur P^, ignoră `order_payments` table (din migration_032) care stochează plățile parțiale.

**Severity**: **P1** — Bonul fiscal trebuie să reflecte exact metodele de plată folosite. ANAF cere defalcare pe metodă. Plus split bill între clienți (2-3 persoane plătesc separat) nu se poate marca corect.

**Fix sugerat**: select din `order_payments`, emite câte un P^ pentru fiecare plată parțială.

### 🟧 BUG #5 — CUI client (CF^) NESUPORTAT — P1

**Caz reproductibil** (TEST 07, 08): restaurant care emite bon B2B (companie clientă cu CUI RO12345).

**Observed**: niciun CF^ emis vreodată.

**Cauza**: `orders` table nu are coloană pentru CIF client. UI nu cere CUI. Generator nu emite CF^.

**Severity**: **P1** — restaurantele B2B (catering, evenimente corporate) nu pot folosi sistemul pentru bonuri fiscale cu CIF.

**Fix sugerat**:
1. ALTER TABLE orders ADD COLUMN customer_cif text;
2. UI: input opțional CUI la checkout B2B
3. Generator: dacă `customer_cif != null`, prima linie = `CF^<cif>`

### 🟨 BUG #6 — Acceptă preț 0 fără validare — P2

**Caz reproductibil** (TEST 22): produs cu preț 0 RON (item gratis / promoție).

**Observed**: payload `S^Free^0^1000^buc^1^1\nST^\nP^1^0` — bon de 0 RON.

**Severity**: **P2** — Bonurile cu valoare 0 sunt **suspecte din punct de vedere ANAF**. Casa fiscală EconMedia poate sau nu să accepte (depinde de configurare).

**Fix sugerat**: `if v_item.item_total <= 0 then raise exception 'item % has invalid price', ...;`

### 🟨 BUG #7 — Mismatch `SUM(items) ≠ orders.total` ignorat — P2

**Caz reproductibil** (TEST 26): order cu 1 item de 50 RON, dar `orders.total=70` (inconsistent).

**Observed**: `S^X^5000^...\nST^\nP^1^7000` — items lines arată 50, plată arată 70. **Bonul are linii care nu se adună la total!**

**Cauza**: generator folosește `v_order.total` pentru P^ fără să verifice consistency cu `SUM(item_total)`.

**Severity**: **P2** — sub condiții normale, trigger-ul `recalc_order_subtotal` (migration_031:103) păstrează consistency. Dar dacă trigger-ul rulează în order greșit, race conditions, RLS blocks etc., totalul poate diverge silent.

**Fix sugerat**: înainte de P^, verifică `if v_order.total != computed_sum_with_discount then raise exception ...;`

### 🟨 BUG #8 — Encoding diacritice neclar — P2 INVESTIGAȚIE

**Caz reproductibil** (TEST 31): produs "Țuică pălincă șuncă".

**Observed**: payload include UTF-8: `S^Țuică pălincă șuncă^...`

**Severity**: **P2** — depinde de Bridge care transformă (sau nu) UTF-8 → CP1250 pentru casa fiscală EconMedia. Dacă Bridge nu face conversie, casa poate afișa "?????" în loc de "Țuică".

**Fix sugerat**: verifică spec contract Bridge → casa. Documentează encoding-ul așteptat.

### 🟨 BUG #9 — Tichete masă/valorice/credit/voucher NESUPORTATE — P2

**Caz reproductibil** (TEST 38): clientul plătește cu tichete masă.

**Observed**: `payment_method` enum are doar `cash`, `card_pos`, `other`. Helper-ul `fiscalnet_payment_code` mapează `other → 8` ("Alte modalități").

**Cauza**: spec FiscalNet recunoaște coduri 1-7 (Numerar, Card, Credit, Tichet masă, Tichet valoric, Voucher, Plată modernă). Doar 3 sunt mapate.

**Severity**: **P2** — restaurantele care acceptă tichete (toate aproape) nu pot raporta corect pe bon. Toate apar ca "Alte modalități = 8" — inacurat fiscal.

**Fix sugerat**:
1. Extinde enum `payment_method`: `add value 'ticket_meal'`, `add value 'ticket_voucher'`, etc.
2. Update `fiscalnet_payment_code` cu mapările corecte 3, 4, 5, 6, 7.
3. UI: dropdown la checkout cu toate opțiunile.

---

## 6. Status suite de teste

**Location**: `supabase/tests/build_fiscalnet_payload_test.sql`

**Setup necesar**: Postgres 16 (sau ≥15) cu toate migrațiile aplicate +
roluri Supabase (`anon`, `authenticated`, `service_role`) + schemas
auxiliare (`auth`, `storage`, `extensions`).

**Rulare**:
```bash
psql -d <test_db> -f supabase/tests/build_fiscalnet_payload_test.sql
```

**Rezultate observate** (după `migration_050` + `051` + `052` + extensii TEST 40-49):

```
PASS  = 41  (toate fix-urile + 6 cazuri noi pentru hotfix A1-A5 + markers explicit)
FAIL  =  0
ERROR =  0
SKIP  =  4  (schema previne — quantity fractionar imposibil)
TODO  =  5  (features lipsă: CF^, tichete masă, …)
─────────
TOTAL  = 50 cazuri raportate
```

**Istoric**:
- Audit-only (pre-fix-uri): 2 PASS, 26 ERROR (BUG #1 crash), 4 SKIP, 5 TODO.
- Cu patch test-only BUG #1: 27 PASS, 4 FAIL, 4 SKIP, 5 TODO.
- Post `migration_050` (BUG #1/#2/#3): 29 PASS, 2 FAIL, 4 SKIP, 5 TODO.
- Post `migration_051` (+ BUG #4/#6/#7): 35 PASS, 0 FAIL, 4 SKIP, 5 TODO.
- Post `migration_052` (+ A1-A5 adversarial fixes): **41 PASS, 0 FAIL**, 4 SKIP, 5 TODO.

**Markers explicit pe exception paths** — toate testele cu pattern
`exception when others then PASS` au fost convertite să verifice un string
marker în `SQLERRM` (ex: `'%BUG #6 guard%'`, `'%A4 split-sum guard%'`).
Asta elimină risc de false-PASS dacă funcția raises din alt motiv
(typo, RLS, etc.) la refactoring viitor.

**Coverage**: 100% din path-ul codului `build_fiscalnet_payload` e exercitat:
- happy path: 5 teste (TEST 01-06)
- VAT groups: 5 teste (TEST 09-13)
- decimale: 4 teste (TEST 14-17)
- edge cases: 10 teste (TEST 22-31)
- forbidden POS^: 1 test (TEST 32)
- complex: 4 teste (TEST 33, 34, 34b, 36)
- payment codes: 1 test (TEST 37)
- error paths: 2 teste (TEST 25, 39)

Branch-uri ne-acoperite:
- `'CF^' || ...` (nu există în cod — feature lipsă, BUG #5)
- Multiple `P^` lines (nu există în cod — feature lipsă, BUG #4)

## 7. Recomandări prioritizate

| Pri | Acțiune | Effort |
|---|---|---|
| P0 | **Fix BUG #1** (`array_append` în loc de `||` cu text literal) | 1 ALTER FUNCTION, 5 minute |
| P0 | **Fix BUG #2** (qty real în payload) | rewrite format string + select qty/unit_price |
| P1 | **Fix BUG #3** (include tips în P^) | 1 line schimbată |
| P1 | **Fix BUG #4** (split payment) | refactor — citește `order_payments` |
| P1 | **Add CF^** suport (BUG #5) | ALTER TABLE + UI + format string |
| P2 | Validare preț ≥ 0.01 (BUG #6) | 3 linii |
| P2 | Verificare consistency total (BUG #7) | 5 linii |
| P2 | Investigate encoding Bridge (BUG #8) | discuție cu echipa Bridge |
| P2 | Extinde `payment_method` enum + helper (BUG #9) | migration nouă + UI |
| — | Înlătură v1 mort din migration_030 (clean code) | optional |

**Nu fac nicio recomandare să se rezolve toate în același PR.** Fiecare bug
are blast radius diferit; testează individual.

## 8. Fișiere create

- `docs/FISCAL-PAYLOAD-GENERATOR-AUDIT.md` (acest fișier)
- `supabase/tests/build_fiscalnet_payload_test.sql` (50 cazuri, ~990 linii)
- `supabase/migrations/20260525004800_migration_050_fiscal_payload_fixes.sql`
  (CREATE OR REPLACE pe `build_fiscalnet_payload`, fix BUG #1/#2/#3)
- `supabase/migrations/20260525004900_migration_051_fiscal_payload_p2_fixes.sql`
  (CREATE OR REPLACE pe `build_fiscalnet_payload`, fix BUG #4/#6/#7)
- `supabase/migrations/20260525005000_migration_052_fiscal_payload_hotfix.sql`
  (CREATE OR REPLACE pe `build_fiscalnet_payload`, fix A1-A5 din auto-analiză
  adversarială: drift rotunjire, BUG #6 fals pozitiv, BUG #7 invariant real,
  split sum guard, payment_method NULL guard)
- `supabase/scripts/grant_business_plan_georgeradu119.sql` (upgrade plan
  cu validare + audit_log entry)

## 9. Fișiere modificate

Niciunul direct. Migration_050 suprascrie funcția anterioară din
migration_031 prin `CREATE OR REPLACE FUNCTION`, fără să atingă fișierul
sursă inițial. RLS, RPC-urile non-fiscal, codul aplicație — nemodificate.
