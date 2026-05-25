# Menuvia — Production Build

## Conține

### Toate fix-urile P0/P1/P2 de la Emergent (BUGFIXES-v26.md):
1. QR menu public reparat (RPC `resolve_qr_token`)
2. Push notifications cu user_id corect
3. Comenzi manuale cu UUID idempotency
4. OrderTracker polling (RPC `get_order_public_status`)
5. AI import cu reservation atomică
6. Email enumeration fix în send-invite
7. UpgradeBanner cu count real
8. Filtrare produse inactive consistentă
9. Connection LED real în KitchenPage
10. Timezone DST-aware (EET/EEST)
11. Revenue: doar paid orders în reports
12. FloorPlanEditor key={id}
13. Push subscriptions cleanup pe endpoint
14. Rotate QR token tranzacțional (RPC `rotate_qr_token`)
15. React keys fix
16. Auth redirect trailing slash
17. Timer dinamic în WaiterOrderCard
18. Analytics views existente

### Plus 9 fix-uri suplimentare aplicate peste:
1. jsPDF upgrade 2.5.1 → 4.2.1 (CVE critical)
2. ProtectedRoute folosește activeRole din context
3. RestaurantContext catch loggat
4. AuthContext catch loggat
5. OrderTracker useRef pattern (skip LOCAL- orders)
6. QrMenuPage callWaiter loggat
7. TeamManager catches loggate
8. ActiveOrdersBanner skip terminal+LOCAL orders
9. PublicMenuPage Promise.all error checking
10. InviteAcceptPage catch loggat

### Plus Offline mode:
- IndexedDB queue prin idb-keyval
- Background Sync API
- Service Worker SYNC_NOW
- Banner offline + retry logic
- Sync auth-required handling

## Setup

1. Rulează în Supabase SQL Editor:
   - migrațiile 001 → 022 în ordine
2. Configurează env vars (vezi .env.example)
3. Deploy pe Netlify din Git
4. Activează Realtime pe `orders` și `waiter_calls`

## Status build
- TypeScript: 0 erori
- ESLint: 0 warnings
- Production build: 16s, success
