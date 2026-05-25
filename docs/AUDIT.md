# Audit Pre-Lansare — Menuvia

**Scope:** verificare securitate, permisiuni și consistență pentru toate
migrațiile 030-034 (Bridge FiscalNet, Discount-uri, Cash Shifts, Rapoarte,
Quick Setup).

**Data audit:** mai 2026 (înainte de primul client live).

---

## Sumar executiv

| Severitate | Probleme găsite | Rezolvate |
|---|---|---|
| 🔴 Critică  | 2 | 2 (în migration 035 + DashboardPage gate) |
| 🟡 Medie    | 3 | 2 rezolvate, 1 documentată pentru v1.1 |
| 🟢 Mică     | 4 | 0 (toate pentru v1.1 cleanup) |

**Status:** ✅ **Apt pentru lansare cu primul client pilot** după aplicarea
migration-035.

---

## 🔴 Probleme critice (rezolvate)

### 1. `bridge_mark_stale_as_error()` permitea apel de oricine

**Înainte:**
```sql
grant execute on function public.bridge_mark_stale_as_error() to authenticated;
```

**Risc:** orice user logat (chiar și waiter) putea apela funcția pentru a marca
bonurile fiscale în status `sent` (deci trimise deja la casă, în așteptare de
confirmare) ca `error`. Asta declanșa retry automat → **dublu print Raport Z**
sau **dublu print bon fiscal** = încălcare ANAF + neconcordanță contabilă.

**Fix (migration 035):**
```sql
revoke execute on function public.bridge_mark_stale_as_error() from authenticated;
-- Rămâne callable doar de service_role (cron Supabase).
```

**Status:** ✅ Fixat în migration 035.

**Acțiune required la deploy:** programează un cron job în Supabase (pg_cron
sau Edge Function scheduled) care apelează funcția la fiecare 5 minute:
```sql
select cron.schedule(
  'bridge-mark-stale',
  '*/5 * * * *',
  $$ select public.bridge_mark_stale_as_error(); $$
);
```

---

### 2. DashboardPage nu avea role gate

**Înainte:** un waiter care tasta manual `/dashboard` în URL ajungea în
dashboard-ul de admin și vedea tab-uri precum "Casă & Tură", "Setup Asistent",
"Raport TVA", "Gestiune". La click pe acțiuni primea "Not admin" de la RPC,
dar putea citi liber datele afișate (lista produselor cu cost, rapoarte etc.).

**Risc:** scurgere de informație confidențială (cost ingrediente, salarii
implicite din raport per ospătar) către personalul de execuție.

**Fix (DashboardPage.tsx):**
- Adăugat flag `adminOnly` pe fiecare item NAV
- Folosit `useRestaurantCtx().activeRole` pentru a determina rolul curent
- Filtrare prin `visibleNav = NAV.filter(n => !n.adminOnly || isAdminRole)`
- Auto-redirect la "Produse" dacă user-ul cumva nimerește pe un tab admin

**Tab-uri vizibile pentru toți (waiter+kitchen):**
Produse · Categorii · Modificatori · Mese · Hartă

**Tab-uri admin-only:**
Setup Asistent · Analytics · Rapoarte · Echipă · Ture · Gestiune · Raport TVA
· Casă & Tură · Casă marcat · Setări

**Status:** ✅ Fixat în DashboardPage.tsx.

---

## 🟡 Probleme medii

### 3. `report_by_waiter` expunea date salariale între colegi (rezolvat)

**Înainte:** orice membru (inclusiv waiter) putea apela `report_by_waiter` și
vedea cât a vândut fiecare ospătar — chiar dacă tab-ul nu era accesibil în UI,
RPC-ul era apelabil direct din JS console. Asta crea posibilitate comparație
sentiment competitiv între ospătari ("Andrei a făcut de 2x cât mine").

**Fix (migration 035):**
```sql
-- Schimbat din is_member → is_admin
if not public.is_admin(p_restaurant_id) then
  raise exception 'Only owners/managers can view waiter sales reports';
end if;
```

**Status:** ✅ Fixat în migration 035.

**Notă:** `report_by_hour` și `report_by_category` rămân disponibile membrilor
(nu expun date individuale).

---

### 4. `pending_receipts` reține date indefinit (rezolvat)

**Înainte:** tabela `pending_receipts` acumula toate bonurile fiscale (chiar și
cele `completed`) fără să fie șterse vreodată. La 1000 comenzi/zi × 365 zile =
365k rânduri/an per restaurant. La 100 clienți = 36.5M rânduri.

**Fix (migration 035):** funcție `pending_receipts_cleanup_old()` (cron-only)
care șterge bonurile `completed` mai vechi de 90 zile. Bonurile `error` /
`cancelled` rămân pentru audit.

**Acțiune required la deploy:** programează:
```sql
select cron.schedule(
  'pending-receipts-cleanup',
  '0 3 * * 0',  -- duminică 3 AM
  $$ select public.pending_receipts_cleanup_old(); $$
);
```

**Status:** ✅ Fixat în migration 035.

---

### 5. Bridge device_secret e singurul mecanism de autentificare bridge ⏳

**Constatare:** funcțiile `bridge_heartbeat`, `bridge_get_pending`,
`bridge_claim_receipt`, `bridge_confirm_receipt` se autentifică doar prin
`p_device_secret` (token text de 64 chars). Dacă un atacator obține token-ul:
- Poate citi toate payload-urile pending (detalii comenzi, produse, prețuri)
- Poate confirma fals că bonurile s-au tipărit (orders.status devine "fiscal_sent"
  fără ca în realitate să fi ieșit ceva la imprimantă)

**Mitigation curentă:**
- Secret e 64 chars hex random generat de `bridge_register`
- Vizibil în UI doar pentru admin (la prima înregistrare, apoi mascat)
- Stocat doar local pe HDD-ul Bridge-ului în config.json
- Nu e niciodată trimis în client web

**Status:** ⚠ Acceptabil pentru v1 (modelul ‘shared secret’ e standard pentru
device-to-cloud comm). Recomandat pentru v1.1:
- Add rotation: `bridge_rotate_secret(device_id)` apelabil de admin
- Add audit log: tabela `bridge_audit` care înregistrează fiecare apel cu IP
  și user-agent
- Add rate-limiting: max 1000 calls/min per device

---

## 🟢 Probleme mici (pentru v1.1)

### 6. Migrațiile nu sunt complet idempotente

Statements `create policy "..."` și `create trigger "..."` crapă la re-rulare
("policy already exists"). Nu e blocker dacă DB e fresh, dar îngreunează
re-deploy.

**Recomandat v1.1:** wrap fiecare policy/trigger cu:
```sql
drop policy if exists "..." on table_name;
create policy "..." on table_name ...;
```

### 7. Reduceri NU se împart proporțional pe categorii TVA

Documentat în migration 031. Dacă un client are 10 RON reducere pe o comandă
cu produse pe TVA 9% și TVA 19%, raportul `vat_report_daily` o atribuie 100%
unei singure categorii.

**Impact:** mic, pentru contabili manuali (sumele apar oricum bine la nivel
de total).

### 8. Sertarele orfane (cash_shifts fără closer)

Dacă serverul Supabase pică în timpul unui `close_shift`, shift-ul rămâne
`status='open'` și a doua zi nu se poate deschide unul nou (unique constraint).

**Workaround manual v1:** owner anulează manual din SQL. **v1.1:** add RPC
`force_close_shift(shift_id)` cu audit log.

### 9. CSV export nu validează caractere speciale

`toCsv` escapează `, " \n \r` dar nu BOM-UCS2 sau UTF-16. Excel pe macOS poate
deschide greșit. Doar Windows Excel testat.

---

## End-to-end test scenarios (manual)

După aplicarea migrațiilor 030-035, testează acest flow complet:

### Test 1: Onboarding → primă vânzare → închidere zi

1. **Signup** → `/auth` → email+password → confirm
2. **OnboardingPage** rulează (4 pași): nume, primul produs, primă masă, gata
3. **Dashboard → Setup Asistent** (🪄):
   - Tip local: alege "Cafenea" → "✓ 4 categorii, 15 produse"
   - TVA: alege "Mâncare 9% + Alcool 19%" → "✓ 2 cote configurate"
   - Mese: 8 mese în 2 zone → "✓ 16 mese"
   - Echipă: skip (lucrezi singur)
4. **Dashboard → Casă & Tură** (💰):
   - Click "Deschide tură" → 100 lei fond → OK
5. **/waiter**:
   - Selectează masă → adaugă 2x Espresso + 1x Cheesecake → trimite
   - Plătește în cash → confirmare
6. **Dashboard → Rapoarte** (📋):
   - Verifică: 1 comandă, ~30 RON revenue, top produs Espresso ×2
   - Export CSV → deschide în Excel → verifică diacritice corecte
7. **Dashboard → Casă & Tură**:
   - Mișcare cash: cheltuială 20 RON "lapte" → OK
   - Așteptat în sertar: 100 + 30 − 20 = **110 RON**
   - Numără manual sertar (în test: introdu 110.50 RON)
   - Click "Închide tură" → diferență +0.50 RON (surplus mic ok)
   - Bifează "Trimite Z" → close → verifică tab Casă marcat
8. **Dashboard → Casă marcat** (📟):
   - Vezi un nou rând pending cu `command_type='report_z'`
   - În mock mode: simulează "success" → status devine "completed"

**Rezultat așteptat:** toate trec fără eroare. Casa de marcat fizică
tipărește Raport Z (în prod cu bridge real).

### Test 2: Waiter role gate

1. **Signup** ca alt user (waiter@test.com)
2. **Manager invită** acest user ca waiter
3. **Login** ca waiter → ar trebui să fie auto-redirectat la `/waiter`
4. **Tastează manual** `/dashboard` în URL
5. **Verifică:** vede doar tab-urile non-admin (Produse, Categorii, Modificatori,
   Mese, Hartă). NU vede: Setup Asistent, Rapoarte, Casă & Tură, Gestiune etc.
6. **Verifică direct RPC** din browser console:
   ```js
   await supabase.rpc('report_by_waiter', { p_restaurant_id: '...', p_from: ..., p_to: ... })
   ```
   Răspuns: `Only owners/managers can view waiter sales reports` ✓

### Test 3: Idempotență migrare 034 (Quick Setup)

1. Login ca admin cu restaurant care **NU are** categorii.
2. Setup Asistent → Tip local "Cafenea" → aplică → "✓ 4 categorii"
3. Setup Asistent → Tip local "Bar" → ar trebui să spună "skipped: categories_exist"
4. Click "Adaugă peste (forțat)" → "✓ 5 categorii noi" → total 9 categorii

### Test 4: Bridge end-to-end cu mock

1. Pornește bridge local în mock mode (vezi bridge README)
2. Dashboard → Casă marcat → click "Înregistrează nou dispozitiv"
3. Copiază device_secret în bridge config.json
4. Bridge bate heartbeat la fiecare 30s (verifică log)
5. La waiter, plătește o comandă → trigger inserează în pending_receipts
6. Bridge ridică în max 5s, "tipărește" (mock), confirmă cu BONOK=1
7. Verifică în UI: order trecut pe "fiscal_sent" cu NRBON populat

---

## Concluzie

Codul e **gata de pilot cu primul client** după:

- ✅ Aplicare migrations 030 → 035 în ordine pe Supabase staging
- ✅ Configurare cron jobs pentru `bridge_mark_stale_as_error` (5 min) și
  `pending_receipts_cleanup_old` (săptămânal)
- ✅ Test manual al celor 4 scenarii E2E de mai sus
- ⏳ Pentru v1.1: idempotență migrări, audit log Bridge, reducere proporțională
  pe TVA

**Următoarele acțiuni recomandate (în ordine):**

1. Apply toate migrations 030-035 pe Supabase staging
2. Rulează cele 4 teste E2E manual
3. Programează cron-urile (vezi instrucțiuni mai sus)
4. Recrutează primul client pilot (cafenea cu 1 angajat — flow simplu)
5. Iterație 6 ulterioară: autocomplete furnizori/produse + e-Factura B2B
