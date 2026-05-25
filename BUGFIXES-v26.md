# Bug Fixes — Menuvia v26

Acest document rezumă toate modificările făcute peste codebase-ul `menuvia-v14-patched`
pentru a adresa bugurile identificate în audit.

## 🚨 P0 — Bugurile critice reparate

### 1. QR menu public era blocat după migration-015
**Cauza:** `migration-015` a făcut `drop policy "restaurants: public read by slug"`,
iar `resolveQrToken` folosea un embed direct `restaurant:restaurants(*)` prin clientul
anon, care după drop returna `null` → toți clienții care scanau un QR primeau
"QR invalid".

**Fix:**
- `supabase/migration-022-bugfixes.sql` → RPC `resolve_qr_token(p_token text)`
  `SECURITY DEFINER` care returnează JSON cu token, table, restaurant și `orderingAllowed`.
- `src/lib/qr.ts` → `resolveQrToken` folosește acum RPC-ul în loc de embed.

### 2. Push notifications nu se salvau
**Cauza:** `usePushNotifications` făcea upsert fără `user_id`, dar coloana este
`NOT NULL` și RLS require `user_id = auth.uid()`.

**Fix:** `src/hooks/usePushNotifications.ts` → adaugă `user_id: user.id` în payload,
și în `unsubscribe` șterge scoped pe (`restaurant_id`, `user_id`).

### 3. Comenzile manuale (ospătar) picau cu UUID cast error
**Cauza:** `ManualOrderSheet.tsx` trimitea `idempotency_key: genKey()` (un string random
de 8 caractere), dar coloana `orders.idempotency_key` este `uuid`.

**Fix:** `src/components/ManualOrderSheet.tsx` → `idempotency_key: crypto.randomUUID()`.

### 4. OrderTracker nu se actualiza la clienții QR
**Cauza:** `OrderTracker` și `ActiveOrdersBanner` se abonau la `postgres_changes`
pe `orders`, dar RLS blochează anon SELECT → UPDATE-urile realtime nu ajungeau.
Statusul rămânea veșnic "Trimisă".

**Fix:**
- `supabase/migration-022-bugfixes.sql` → RPC `get_order_public_status(p_order_id)`
  returnează doar câmpurile publice (status + timestamps + total).
- `src/lib/orders.ts` → adaugă `getOrderPublicStatus`.
- `src/components/OrderTracker.tsx` → polling la 5s (se oprește la status terminal).

### 5. AI import — race permitea ocolirea cotei
**Cauza:** `ai-import.js` verifica `check_ai_import_quota` → apela Anthropic →
`log_ai_import`. Între check și log, N requests paralele treceau verificarea.

**Fix:**
- `supabase/migration-022-bugfixes.sql` → RPC `reserve_ai_import_slot`
  folosește `pg_advisory_xact_lock` per-user pentru a serializa cererile și
  rezervă slot-ul (INSERT în `ai_import_log`) atomic cu verificarea quotei.
- `netlify/functions/ai-import.js` → folosește noul RPC.

### 6. send-invite leak-uia emailuri cross-tenant
**Cauza:** verificarea `profiles.email` era globală + returna 409 "deja membru",
ceea ce permitea enumerare de emailuri din alte restaurante.

**Fix:** `netlify/functions/send-invite.js` → verifică DOAR membership-ul pe
restaurantul curent; dacă userul există dar nu e membru, tratează identic cu
un email necunoscut.

---

## ⚠️ P1 — Buguri semnificative reparate

### 7. UpgradeBanner arăta mereu 0/15
**Fix:** `src/pages/DashboardPage.tsx` → fetch real al count-ului produselor
(`.select('id', { count: 'exact', head: true })`) + pasează `planLimits.max_products`
dinamic.

### 8. Produsele cu `is_active=false` apăreau în QR menu
**Cauza:** `fetchMenuForRestaurant` filtra doar `is_draft=false` iar PublicMenuPage
filtra doar `is_active=true` → inconsistență.

**Fix:**
- `src/lib/qr.ts` → adaugă `.eq('is_active', true)` în `fetchMenuForRestaurant`.
- `src/pages/PublicMenuPage.tsx` → adaugă `.eq('is_draft', false)` pentru paritate.

### 9. KitchenPage — LED-ul "Conectat" era hardcoded mereu verde
**Fix:** `src/pages/KitchenPage.tsx` → abonare la un presence channel +
`setConnected(status === 'SUBSCRIBED')` pentru a reflecta starea reală.

### 10. ReportsTab — timezone hardcoded `+03:00` (greșit iarna)
**Cauza:** România este UTC+2 (EET) iarna și UTC+3 (EEST) doar vara.
Hardcoding-ul muta granițele zilei cu 1h.

**Fix:** `src/components/ReportsTab.tsx` → funcția nouă `romaniaDayBoundaryISO`
auto-detectează DST folosind `Intl`.

### 11. ReportsTab — venitul includea comenzi neplătite
**Fix:** `src/components/ReportsTab.tsx` → filtrează `status === 'paid'`
pentru metrics de venit. Count-ul de comenzi rămâne pe toate (non-cancelled).

### 12. FloorPlanEditor nu se re-încarca la schimbare restaurant
**Fix:** `src/pages/DashboardPage.tsx` → adaugă `key={restaurant.id}` pe
`<FloorPlanEditor>` pentru remount la schimbarea restaurantului.
De asemenea, tipul `FloorLayout` este acum export-at din componentă pentru
a elimina cast-ul `as any`.

### 13. send-push nu ștergea subscripțiile expirate (410/404)
**Cauza:** `.eq('subscription', subscription)` pe JSONB cu obiect nu face match
în Postgrest → delete-ul nu ștergea nimic, subscripțiile moarte se acumulau.

**Fix:**
- `supabase/migration-022-bugfixes.sql` → adaugă coloana generată `endpoint text`
  pe `push_subscriptions` + index.
- `netlify/functions/send-push.js` → `delete().eq('endpoint', subscription.endpoint)`.

### 14. TablesManager.rotateToken — race putea lăsa masa fără QR
**Cauza:** UPDATE (dezactivare) + INSERT separat; dacă INSERT-ul pica, masa
rămânea fără token activ.

**Fix:**
- `supabase/migration-022-bugfixes.sql` → RPC tranzacțional `rotate_qr_token`.
- `src/components/TablesManager.tsx` → folosește RPC-ul.

### 15. React warning: fragment fără key în UpgradeModal
**Fix:** `src/pages/DashboardPage.tsx` → `<React.Fragment key={row.label}>`
în loc de `<>`.

---

## 🟡 P2 — Îmbunătățiri minore incluse

### 16. AuthPage — `VITE_APP_URL` cu trailing slash → `//reset-password`
**Fix:** `src/pages/AuthPage.tsx` → strip trailing slash înainte de concat.

### 17. WaiterOrderCard — timer-ul `elapsed()` era înghețat (înregistrat o dată)
**Fix:** `src/components/WaiterOrderCard.tsx` → hook `useElapsed` cu interval 15s.

### 18. AnalyticsTab — views lipsă
**Fix:** `supabase/migration-022-bugfixes.sql` → `v_daily_orders`,
`v_product_performance`, `v_waiter_performance`, `v_hourly_distribution`
(cu calcule în `Europe/Bucharest`).

---

## 📋 Ordine de deployment

1. **Rulează în Supabase** (SQL Editor):
   ```
   supabase/migration-022-bugfixes.sql
   ```
   Această migrație este **idempotentă** (folosește `create or replace`, `if not exists`).

2. **Deploy frontend + functions** la Netlify (branch `main` sau direct prin CLI).

3. **Environment variables** — nu sunt necesare modificări; toate variabilele
   rămân ca în `DEPLOYMENT_GUIDE.md`.

4. **Verificare post-deploy:**
   - Scanează un QR de la masă → meniul ar trebui să apară (fix #1).
   - Trimite o comandă manuală din WaiterPage → trebuie să reușească (fix #3).
   - Dashboard → UpgradeBanner arată count real (fix #7).
   - Reports → verifică că venitul nu include comenzi în preparare (fix #11).
   - Kitchen → LED-ul "Conectat" reflectă realitatea (fix #9).

---

## 🗂 Fișiere modificate

```
supabase/migration-022-bugfixes.sql        [NEW]
src/lib/qr.ts                              (resolveQrToken → RPC, is_active filter)
src/lib/orders.ts                          (getOrderPublicStatus, rotateQrToken)
src/hooks/usePushNotifications.ts          (user_id în upsert)
src/components/OrderTracker.tsx            (polling în loc de realtime)
src/components/ManualOrderSheet.tsx        (idempotency_key UUID)
src/components/ReportsTab.tsx              (timezone + venit paid only)
src/components/TablesManager.tsx           (rotate_qr_token RPC)
src/components/FloorPlanEditor.tsx         (export FloorLayout type)
src/components/WaiterOrderCard.tsx         (useElapsed hook)
src/pages/DashboardPage.tsx                (productCount real, key={id}, Fragment)
src/pages/KitchenPage.tsx                  (connected state real)
src/pages/PublicMenuPage.tsx               (is_draft filter)
src/pages/AuthPage.tsx                     (strip trailing slash)
netlify/functions/ai-import.js             (reserve_ai_import_slot RPC)
netlify/functions/send-push.js             (delete by endpoint)
netlify/functions/send-invite.js           (scoped membership check)
```

## ✅ Verificări efectuate

- `npx tsc --noEmit` → 0 erori
- `npx eslint src/**/*.{ts,tsx} --max-warnings=0` → 0 warnings
- `npx vite build` → success (9.43s)
