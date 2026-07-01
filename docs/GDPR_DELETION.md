# Ștergere cont vs. retenție fiscală — GDPR × Legea 82/1991

> Stare: **implementat (mig 179), DE CONFIRMAT CU AVOCAT/CONTABIL** înainte de a
> fi tratat ca definitiv legal. Acest document e sursa de adevăr pentru cum
> împăcăm dreptul la ștergere (GDPR Art. 17) cu obligația de retenție a
> documentelor contabile 10 ani (Legea 82/1991, art. 25).

## 0. Problema (finding HIGH din audit)

`process_account_deletions` (mig 042) șterge contul prin cascadă:

```
auth.users → profiles → restaurants → invoices
```

Pentru că `invoices.restaurant_id` are `ON DELETE CASCADE` (mig 041), ștergerea
restaurantului **ștergea și facturile fiscale emise**. Asta încalcă Legea
82/1991: documentele contabile (inclusiv facturile) trebuie păstrate **10 ani**.

Tensiune juridică clasică: **obligația legală de retenție PREVALEAZĂ asupra
dreptului la ștergere** (GDPR Art. 17(3)(b) — prelucrare necesară pentru
respectarea unei obligații legale). Nu putem șterge factura; dar putem (și
trebuie) să ștergem **datele personale** care nu sunt necesare fiscal.

## 1. Soluția: separă documentul fiscal de datele personale

Introducem tabela `public.retained_invoices` — un **snapshot al câmpurilor
strict fiscale** ale fiecărei facturi emise, care **NU e cascadat** de la
`auth.users` (nu are FK spre `restaurants`/`invoices`/`auth.users`). Când cascada
șterge `invoices`, snapshot-ul fiscal supraviețuiește.

### Ce se PĂSTREAZĂ (date fiscale / de business)

| Câmp | Sursă (`invoices` / `oblio_configs`) | De ce e păstrat |
|---|---|---|
| `original_invoice_id`, `original_restaurant_id` | `invoices.id`, `.restaurant_id` | trasabilitate audit ANAF |
| `company_cif`, `company_name` | `oblio_configs.company_cif/company_name` | identitate emitent (firmă) |
| `oblio_series`, `oblio_number` | `invoices.oblio_series/oblio_number` | serie + număr document fiscal |
| `total_with_vat`, `currency` | `invoices.total_with_vat/currency` | valoare + TVA inclus |
| `customer_cif`, `is_b2b` | `invoices.customer_cif/is_b2b` | CUI **firmă** client = dată de business, nu personală |
| `issued_at`, `original_created_at` | `invoices.issued_at/created_at` | datare fiscală |

> Notă: `invoices` NU stochează TVA-ul ca linie separată; totalul e
> `total_with_vat` (TVA inclus, `oblio_configs.vat_included`). Nu inventăm o
> coloană de TVA care nu există. Detalierea liniilor de TVA rămâne în Oblio/SPV
> (sursa fiscală externă).

### Ce se ANONIMIZEAZĂ / EXCLUDE (date personale)

- **NU** copiem `customer_name`, `customer_email`, `customer_phone`,
  `customer_address` pentru persoane fizice (B2C).
- `customer_label` = `[persoană fizică anonimizată]` la B2C, sau `CUI <cif>` la
  B2B (CUI = business, nu personal).
- Datele personale reziduale din coloane de audit (`created_by` etc.) sunt deja
  `SET NULL` prin FK-urile din mig 055.

## 2. Cele 3 politici (configurabile)

Politica activă se citește din `public.gdpr_deletion_config.policy` (single-row).
Default = `archive_anonymize`.

### `archive_anonymize` (DEFAULT, recomandat)

Pentru fiecare user peste fereastra de 30 zile cu facturi emise:
1. INSERT snapshot fiscal în `retained_invoices` (idempotent — dedup pe
   `original_invoice_id`).
2. `delete from auth.users` → cascada șterge datele personale + `invoices`
   originale. Snapshot-ul fiscal supraviețuiește.

**Rezultat:** date personale șterse (GDPR ✔) + factură fiscală păstrată 10 ani
(fisc ✔). Aceasta e opțiunea corectă legal by default.

### `block`

Dacă owner-ul are restaurante cu facturi emise → **NU șterge** contul. Setează
`profiles.deletion_blocked_reason` (loghează `raise notice`), lasă
`deletion_requested_at` intact, iar batch-ul sare peste conturile deja blocate.
Owner-ul trebuie să rezolve manual (transfer / închidere restaurant) prin
`privacy@menuvia.ro`.

**Când o alegi:** dacă vrei intervenție umană obligatorie înainte de orice
ștergere care atinge documente fiscale. Dezavantaj: cererea GDPR rămâne
neonorată până la acțiune manuală — **de confirmat cu avocatul** că e acceptabil
(termenul GDPR de 1 lună + prelungiri).

### `transfer_tombstone`

1. Snapshot fiscal (ca `archive_anonymize`).
2. Marchează restaurantele owner-ului ca orfane:
   `restaurants.is_tombstoned = true` + `tombstoned_at` + `tombstoned_reason`.
3. `raise notice` că transferul REAL de owner necesită remediere manuală.
4. Continuă ștergerea contului (datele personale se șterg; snapshot-ul fiscal
   supraviețuiește).

**CAVEAT `owner_id` imuabil:** `restaurants.owner_id` e blocat la UPDATE de
`trg_restaurants_owner_id_immutable` (lockdown, CLAUDE.md). Un transfer REAL de
proprietar **NU se poate face din acest RPC** și **NU dezactivăm trigger-e de
lockdown din RPC**. Singura cale autorizată de transfer efectiv de owner e
`scripts/apply_ownership_remediation.sql` (procedură manuală, sub lock strict).
Deci `transfer_tombstone` = snapshot + marcaj + notificare, cu transferul de
owner lăsat explicit pentru remediere manuală. Practic e un `archive_anonymize`
plus semnalizarea că restaurantul a rămas fără owner.

## 3. Convenții tehnice respectate

- `retained_invoices` și `gdpr_deletion_config`: RLS activat, **fără policy
  permisivă** (default deny) + `revoke all ... from public, anon, authenticated`.
  Acces doar service_role (BYPASSRLS). Retenția legală nu e citibilă de clienți.
- RPC-uri `SECURITY DEFINER`, `set search_path = public, pg_temp`,
  `revoke ... from public, anon, authenticated`, fără grant către `authenticated`
  (sunt de cron/service_role) — aliniat cu convenția lockdown 096.
- Idempotent: `create table if not exists`, `create or replace`, `add column if
  not exists`, `on conflict do nothing`, dedup unic pe `original_invoice_id`.
- Batch 100/tick păstrat. Semnătura `process_account_deletions()` neschimbată.

## 4. 🔴 TODO — de confirmat cu avocat / contabil

1. **Temei retenție.** Confirmă că retenția facturilor 10 ani (Legea 82/1991,
   art. 25) e temeiul corect pentru excepția Art. 17(3)(b) GDPR și că 10 ani e
   termenul aplicabil (nu 5) pentru facturile emise via restaurant.
2. **Set minim de câmpuri fiscale.** Confirmă că lista din §1 (serie, număr,
   total cu TVA, CUI firmă, dată) e **suficientă și necesară** pentru o factură
   păstrată, fără a reține date personale în plus. Are nevoie ANAF de mai mult
   (ex. denumire client persoană fizică)? Dacă da, trebuie pseudonimizat, nu
   anonimizat — **decizie juridică**.
3. **`customer_cif` la B2C.** Confirmă că un CUI e întotdeauna de firmă (business)
   și nu poate fi CNP-ul unei persoane fizice în datele noastre. Dacă unele
   facturi B2C conțin CNP în `customer_cif`, acela e dată personală și trebuie
   exclus/hash-uit.
4. **Politica `block` vs. termenul GDPR.** Confirmă dacă blocarea nedefinită a
   unei cereri de ștergere (până la acțiune manuală) e conformă cu termenul de
   răspuns GDPR sau dacă trebuie un fallback automat la `archive_anonymize` după
   X zile.
5. **Tombstone + owner șters.** Confirmă tratamentul unui restaurant care rămâne
   „orfan" (owner șters, dar entitate juridică activă cu facturi): cine e
   responsabil de retenție după ștergerea persoanei fizice owner? (probabil
   firma, nu persoana — de clarificat.)
6. **Retenție a snapshot-ului însuși.** După 10 ani, `retained_invoices` ar
   trebui curățat (nu e implementat un cron de purge — backlog, doar după
   confirmare juridică a termenului exact per document).

## 5. Fișiere

- Migrație: `supabase/migrations/20260630190000_migration_179_gdpr_fiscal_retention.sql`
- RPC atins: `public.process_account_deletions` (redefinit; original în mig 042)
- Tabele noi: `public.retained_invoices`, `public.gdpr_deletion_config`
- Coloane noi: `restaurants.is_tombstoned/tombstoned_at/tombstoned_reason`,
  `profiles.deletion_blocked_reason`
- Transfer real owner (manual): `scripts/apply_ownership_remediation.sql`
