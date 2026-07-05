# Menuvia Bridge (pilot FiscalNet)

Proces local care leagă **coada fiscală din Supabase** de **casa de marcat**, prin
driver-ul **FiscalNet** (EconMedia). Rulează pe PC-ul de la casă (Windows, de obicei),
lângă FiscalNet.

- **Zero dependențe runtime** — doar Node 20+ (`fetch`, `http`, `fs` built-in). Nu e
  nevoie de `npm install` pentru pilot.
- **Două transporturi**, aceleași comenzi FiscalNet:
  - `api` (recomandat) — `POST http://localhost:65400/api/Receipt` cu un array JSON de
    linii `^`-delimitate; răspuns sincron `BONOK`/`NRBON`.
  - `file` (fallback) — scrie `Bonuri/<id>.txt`, citește `Raspuns/<id>.txt`.
- **Izolat de aplicația web**: e în afara `src/`, în JS pur → nu intră în
  typecheck/lint/test/build-ul din `menuvia-cloud`.

> Cloud-ul (generatorul de bon `build_fiscalnet_payload`, coada `pending_receipts`,
> RPC-urile bridge, gate-ul Plan 3) e deja construit și testat — vezi
> `docs/BRIDGE_FISCALNET_ARCHITECTURE.md`. Bridge-ul ăsta e „Zona 2".

## Cum funcționează (fluxul unui bon)

```
order.status = 'paid'  ──►  trigger enqueue_fiscal_receipt  ──►  pending_receipts (payload gata)
                                                                         │
        ┌────────────────────────────────────────────────────────────────┘
        ▼
  bridge_get_pending ─► bridge_claim_receipt (pending→sent, atomic)
        │
        ▼  sendReceipt()
   FiscalNet (API sau fișier) ─► tipărește bon ─► BONOK=1 / NRBON=123
        │
        ▼
  bridge_confirm_receipt(success, NRBON)  ─►  status='success'  ─►  realtime în dashboard
```

Claim-ul e **atomic** (`bridge_claim_receipt` schimbă statusul doar dacă e încă
`pending`), deci două bridge-uri pe același restaurant nu tipăresc bonul de două ori.

## Configurare

Copiază `config.example.json` → `config.json` și completează:

| Cheie              | Ce e                                                            |
|--------------------|----------------------------------------------------------------|
| `supabaseUrl`      | URL-ul proiectului Supabase                                    |
| `supabaseAnonKey`  | cheia **anon public** (RPC-urile bridge au `grant to anon`)    |
| `deviceSecret`     | din Dashboard → „Casă de marcat" → „Înregistrează casă"        |
| `fiscalnet.mode`   | `api` (recomandat) sau `file`                                  |
| `fiscalnet.apiUrl` | implicit `http://localhost:65400/api/Receipt`                  |
| `fiscalnet.bonuriDir` / `raspunsDir` | doar în mod `file`                           |

Toate se pot da și prin variabile de mediu (`SUPABASE_URL`, `DEVICE_SECRET`,
`FISCALNET_MODE`, `FISCALNET_API_URL`, …) — au prioritate peste `config.json`.

## Rulare

```bash
# 1. (pentru test, fără casă reală) pornește simulatorul FiscalNet
node mock-fiscalnet.js          # ascultă pe http://localhost:65400/api/Receipt

# 2. pornește bridge-ul
node menuvia-bridge.js
```

Autentificarea securizează totul prin `device_secret` verificat server-side; anon key
singură nu poate scrie în coada fiscală (RLS + gate Plan 3 în mig 133).

## Testare fără hardware

`mock-fiscalnet.js` imită API-ul BonLocal:
- linie `FAIL_PAPER` în payload → `BONOK=0 / PAPER_OUT`;
- linie `FAIL_OFFLINE` → nu răspunde (simulează casă moartă → timeout);
- altfel → `BONOK=1` cu `NRBON` incremental;
- `?format=text` → răspuns text (`BONOK=1\nNRBON=…`), ca la transportul pe fișiere.

Teste de fum (ambele transporturi + mapări de eroare):

```bash
node --test test/fiscalnet.test.js
```

## Ce mai trebuie ÎNAINTE de un pilot real

Vezi checklist-ul din `docs/BRIDGE_FISCALNET_ARCHITECTURE.md` §8. Pe scurt:
1. **Confirmă pe `https://webtest.driverfiscal.ro/`** formatul exact al comenzii `S^`
   (ordinea `GRTVA` vs `GRDEP`) și schema răspunsului API — parser-ul acceptă deja
   JSON și text, dar mapările de câmpuri trebuie confirmate contra `Documentatie.pdf`.
2. **Encoding diacritice** — dacă pe casă ies „?", trece pe CP1250 (cere `iconv-lite`).
3. **Împachetare** — `pkg`/installer Windows + auto-start (post-pilot).
