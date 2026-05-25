# Menuvia v1.6.0 — Customer-Facing UX Parity

**Obiectiv:** închidere a celor mai mari găuri UX vs ialoc.ro pentru flow-ul client final
de pe telefon (post-comandă → plată → feedback → Google review).

## ✨ Features noi

### 1. Plată confirmată screen (animat)

Când statusul comenzii devine `paid`, clientul vede:

- ✅ **Animație checkmark SVG** cu cerc + linii flotante (cubic-bezier spring)
- ✅ Mesaj clar "Plată confirmată!" + sub-text "Personalul știe deja"
- ✅ Sumar detaliat: Subtotal / Bacșiș / Total
- ✅ Buton "Am nevoie de bonul fiscal" (declanșează RPC)
- ✅ Powered by Menuvia branding

**Fișier:** `src/components/PaymentConfirmedScreen.tsx`

### 2. Feedback widget rotativ (3 întrebări)

Apare în mijlocul screen-ului de plată confirmată:

1. **Cum a fost experiența de plată?** → 👍 / 👎 binar
2. **Cum a fost servirea?** → 5 stele
3. **Cum a fost mâncarea?** → 5 stele

Pe 👎 la întrebarea 1 → textarea pentru feedback negativ privat (nu blochează flow-ul).
Toate răspunsurile se salvează în tabela `order_feedback` via RPC public.

### 3. Google Review CTA

Apare AUTOMAT după ce clientul completează feedback-ul ȘI media ratingurilor ≥ 4.

- Buton cu logo Google color
- Deep link la `search.google.com/local/writereview?placeid={place_id}`
- Setabil din Dashboard → Setări → Google Reviews
- Patronul își ia recenziile organic, nu cere personal

**Asta e cea mai mare diferență de monetizare** vs ialoc.

### 4. Tips integrate în PayModal

Ospătarul când marchează comanda ca plătită vede acum:

- Selector compact: **Fără / 5% / 10% / 15% / Custom**
- Tips se adaugă la `paid_amount` automat
- Câmp tips_amount salvat separat în DB pentru raport
- Index PostgreSQL pe `(restaurant_id, paid_at) WHERE tips_amount > 0`

### 5. "Am nevoie de bonul fiscal"

Buton accesibil clientului post-plată. Apelează RPC `request_fiscal_receipt()`:

- Setează `orders.fiscal_receipt_requested_at = now()`
- Idempotent (al doilea click nu duplică)
- Notificare ajunge la ospătar prin Realtime subscribe (existing)
- **Critical pentru OG 28/1999** (dreptul clientului de a cere bon)

### 6. Multi-language RO/EN

Biblioteca proprie minimală în `src/lib/i18n.ts`:

- 35+ string-uri traduse (paid screen + feedback + tracker + menu)
- Detection automat: URL `?lang=` → localStorage → navigator.language → 'ro'
- Persistență în localStorage, sync cross-tab prin storage events
- LanguageSwitcher component (top-right, light/dark variant)
- Zero dependency externă (3KB total)

## 🗄️ Migrația 043

`supabase/migration-043-feedback-tips-google.sql`:

1. `orders.tips_amount` + `orders.fiscal_receipt_requested_at`
2. `restaurants.google_place_id` + `restaurants.google_review_url`
3. **Tabela `order_feedback`** (3 tipuri: payment/service/food) + RLS
4. **RPC `submit_order_feedback`** (anon-callable, anti-spam la 24h + status check)
5. **RPC `request_fiscal_receipt`** (idempotent)
6. **RPC `get_order_public_status`** extins cu tips + restaurant info
7. **Vizualizare `v_restaurant_feedback_summary`** pentru dashboard agregat
8. **RPC `advance_order`** extins cu `p_tips_amount`

## 🧪 Verificare

```bash
npm install
npm run test          # → 90 passed (era 86, +4 pe tips/google CTA logic)
npm run typecheck     # → zero erori
npm run build         # → production bundle OK
```

## 📋 De aplicat manual

1. **Rulează `migration-043-feedback-tips-google.sql`** pe Supabase production
2. **Configurează Google Place ID** pentru fiecare restaurant pilot:
   - Dashboard → Setări → secțiunea "⭐ Google Reviews"
   - Caută localul pe https://developers.google.com/maps/documentation/places/web-service/place-id
   - Copy ID-ul (ChIJ...) și lipește
3. **Test E2E:** scanează QR → comandă → marchează ca paid → vezi noul screen

## 🎯 Impact așteptat

**Demo către patron:**
- Înainte: arăți QR + meniu + "după plătesc la casă" → comparat cu ialoc, pierdeai
- Acum: arăți același flow + screenul postplată + feedback + Google review CTA
- Argument: "Asta îți crește review-urile Google cu 200-300% în 6 luni"

**Monetizare patron:**
- Tips colectate digital, contabilizate separat → ospătarii fac presiune să recomande Menuvia
- Google Reviews automatizate → moat marketing
- Feedback negativ ajunge la patron, nu în public → control reputație

## ⚠️ Ce NU am implementat (intenționat)

- **Plata online efectivă prin Stripe** la masă — necesită Stripe Connect setup, KYC patron, BNR considerații. Plan separat luna 2.
- **Widget rezervare** — e feature mare pentru bistros/restaurante, mai puțin pentru cafenele. Plan luna 2-3.
- **Branded illustrations** — vine după design system + Tailwind migration.

Astea rămân pe roadmap separat.
