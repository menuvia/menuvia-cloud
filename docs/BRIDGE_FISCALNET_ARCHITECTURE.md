# Bridge FiscalNet — Arhitectură integrare

> Document tehnic pentru integrarea cu casa de marcat prin FiscalNet (EconMedia).
> Versiunea finală: file-drop architecture, mult mai simplă decât protocol Datecs binar.

---

## 1. Cum funcționează FiscalNet

FiscalNet e un driver Windows (~80 MB RAM) care:
1. Stă rezident pe PC-ul de la casă, conectat serial/USB la casa de marcat.
2. Monitorizează un folder `Bonuri/` pe disk.
3. Când un fișier `.txt` apare în acel folder, îl interpretează ca bon, îl tipărește pe casă, scrie răspunsul în `Raspuns/`.
4. Suportă: Datecs, Activa, Tremol, Custom Q3X — același format pentru toate.

**Asta înseamnă pentru noi:** Bridge-ul Menuvia nu vorbește direct cu casa, ci doar cu FiscalNet. Toată complexitatea hardware (protocoale binare, porturi serial, retry pe erori hardware) e responsabilitatea FiscalNet.

---

## 2. Arhitectura Menuvia

```
┌─────────────────┐       ┌──────────────────┐       ┌─────────────────┐       ┌──────────┐
│   Menuvia       │       │   Supabase       │       │  Bridge local   │       │ FiscalNet│
│   (Dashboard)   │       │   (cloud)        │       │  (Node.js+tray) │       │ (driver) │
└────────┬────────┘       └────────┬─────────┘       └────────┬────────┘       └────┬─────┘
         │                         │                          │                     │
         │ Ospătar: "Plătește"     │                          │                     │
         ├────────────────────────►│                          │                     │
         │  order.status='paid'    │                          │                     │
         │                         │ Trigger:                 │                     │
         │                         │ enqueue_fiscal_receipt() │                     │
         │                         │ → INSERT pending_receipt │                     │
         │                         │                          │                     │
         │                         │◄─── poll (5-30s) ────────│                     │
         │                         │ bridge_get_pending()     │                     │
         │                         │ ────► [payload]          │                     │
         │                         │                          │                     │
         │                         │◄── claim ────────────────│                     │
         │                         │ status='sent'            │                     │
         │                         │                          │                     │
         │                         │                          │ Scrie               │
         │                         │                          ├─ <uuid>.txt ───────►│
         │                         │                          │  în Bonuri/         │
         │                         │                          │                     │ Tipărește bon
         │                         │                          │                     │ Scrie răspuns
         │                         │                          │ Citește             │ în Raspuns/
         │                         │                          │◄─ BONOK=1, NRBON ───│
         │                         │                          │                     │
         │                         │◄── confirm ──────────────│                     │
         │                         │ bridge_confirm_receipt() │                     │
         │                         │ status='success'         │                     │
         │                         │                          │                     │
         │ Realtime update         │                          │                     │
         │◄────────────────────────│                          │                     │
         │ "✓ Bon #123 tipărit"    │                          │                     │
```

---

## 3. Formatul de bon FiscalNet

Bridge-ul generează un fișier text simplu:

```
S^Cappuccino^1200^1000^buc^1^1
S^Croissant^800^1000^buc^1^1
ST^
P^2^2000
```

Citește:
- `S` = vânzare. Format: `S^NUME^PRET_BANI^CANT_MII^buc^GRUPA_TVA^GRUPA_DEP`
  - `1200` = 12.00 RON (în bani)
  - `1000` = 1.000 buc (în miimi)
  - `1` = grupa TVA pe casă (setată de instalator: 1=9%, 2=19%, etc.)
- `ST` = subtotal (opțional, pentru claritate)
- `P` = plată. Format: `P^METODA^TOTAL_BANI`
  - `2` = card (1=numerar, 2=card, 3=credit, 4=tichet masă, 8=alte)
  - `2000` = 20.00 RON

**Răspunsul** (în `Raspuns/<uuid>.txt`):
```
BONOK=1
NRBON=123
```
sau în caz de eroare:
```
BONOK=0
ERRCODE=PAPER_OUT
ERRINFO=Hârtia s-a terminat
```

---

## 4. Componentele din migration 030

### Tabele
- **`bridge_devices`** — case înregistrate (1+ per restaurant). Conține `device_secret` UUID care e folosit de Bridge pentru autentificare.
- **`pending_receipts`** — queue bonuri. Status: `pending → sent → success` sau `error`.

### Coloană nouă pe `vat_rates`
- **`fiscalnet_group`** (smallint 1-5) — maparea între grupa TVA internă (1-4) și grupa de pe casă (1-5).

### Funcții & RPC-uri
| Nume                            | Cine apelează | Ce face                                                          |
|---------------------------------|---------------|------------------------------------------------------------------|
| `build_fiscalnet_payload(order)`| Trigger       | Generează stringul .txt FiscalNet pentru un order                |
| `enqueue_fiscal_receipt()`      | Trigger       | La `order.paid` → INSERT pending_receipt                         |
| `bridge_register()`             | Dashboard     | Admin generează device + secret nou                              |
| `bridge_heartbeat()`            | Bridge        | Anunță "sunt online", returnează `restaurant_id`                 |
| `bridge_get_pending()`          | Bridge        | Ridică maxim 10 bonuri pending                                   |
| `bridge_claim_receipt()`        | Bridge        | Marchează ca `sent` (after scriere fișier reușită)               |
| `bridge_confirm_receipt()`      | Bridge        | Raportează rezultatul final (success / error)                    |
| `bridge_retry_receipt()`        | Admin         | Resetează un bon `error` înapoi la `pending`                     |
| `bridge_cancel_receipt()`       | Admin         | Anulează un bon `pending` sau `error`                            |
| `bridge_mark_stale_as_error()`  | Cron          | Marchează ca `error` bonurile `sent` mai vechi de 10 min         |

---

## 5. Edge cases acoperite

| Situație                            | Cum o tratează                                                            |
|-------------------------------------|---------------------------------------------------------------------------|
| Hârtia s-a terminat                 | FiscalNet returnează BONOK=0 → bridge_confirm cu error → buton Retry      |
| Casa offline / cablu deconectat     | Bridge nu primește răspuns 30s → confirm cu error → Retry                 |
| Bridge crăpat după claim            | `bridge_mark_stale_as_error()` rulează periodic, marchează ca error       |
| Internet pică                       | Bridge are SQLite local (de adăugat), retrimite când revine               |
| Bonuri duplicate                    | Idempotency prin nume fișier (= UUID receipt_id)                          |
| Restaurant fără bridge configurat   | Trigger detectează lipsa de `bridge_devices` → NU generează queue orphan  |
| Order trecut de 2× prin `paid`      | Trigger detectează `pending_receipt` existent → skip                      |

---

## 6. Bridge local — TODO (Zona 2)

> **Update pilot:** codul de pornire trăiește acum în folderul **`bridge/`** din acest
> repo (nu într-un repo separat, deocamdată) — zero dependențe runtime (Node 20+ built-ins),
> transport **API primar / fișiere fallback** (vezi §8). În modul API nu mai e nevoie de
> `chokidar`/watcher. Împachetarea `.exe` + installer rămâne post-pilot.

Plan original (repo separat `menuvia-bridge`, Node.js):
- **Stack:** Node 18+, `chokidar` (file watcher), `better-sqlite3` (retry queue), `node-windows` (tray icon)
- **Build:** `pkg` → single .exe ~30-40 MB
- **Installer:** Inno Setup → .exe simplu cu auto-start Windows
- **Configurare:** prompt la prima rulare pentru device_secret + path FiscalNet
- **Heartbeat:** la 30s
- **Polling:** la 5s pentru pending receipts
- **Realtime (v2):** Supabase Realtime subscribe pe `pending_receipts` pentru reacție instant

Pași de instalare la client:
1. Owner intră în Dashboard → tab "Casă de marcat" → "+ Înregistrează casă"
2. Primește device_secret (UUID lung)
3. Descarcă `menuvia-bridge-setup.exe` de pe menuvia.ro/download
4. Rulează installer, paste device_secret
5. Bridge rulează în tray, conectează automat la FiscalNet folder

---

## 7. Cost și timeline

- **Cloud-side (Zona 1):** ✅ FĂCUT — migration 030 + BridgeTab UI
- **Bridge local (Zona 2):** ~3 zile lucru (mai puțin decât 4-5 zile estimat inițial, datorită file-drop)
- **Testing cu Mock FiscalNet:** ~2 zile (Bridge cu simulator în loc de FiscalNet real)
- **Pilot client real:** după ce Fiscalnet confirmă pricing și activăm un trial

Cost FiscalNet pentru client: **de aflat** — Radu sună la 0772 179 309.

---

## 8. Transportul API (BonLocal) + pilotul — addendum

> Adăugat după materialele oficiale FiscalNet (email EconMedia + `Documentatie.pdf` +
> screenshot „BonLocal Post"). Codul pilot: folderul `bridge/` din acest repo.

### 8.1 Două transporturi, ACELEAȘI comenzi

FiscalNet expune două căi pentru **exact același format** de comandă (`S^…`, `P^…`,
`CF^…`, `DP^/DV^`, `ST^`):

| Transport | Cum | Răspuns |
|-----------|-----|---------|
| **Fișiere** | scrii `Bonuri/<id>.txt` (linii unite cu CRLF) | citești `Raspuns/<id>.txt` (`BONOK=1\nNRBON=…`) |
| **API HTTP** (BonLocal) | `POST /api/receipt`, body = **array JSON de linii** | sincron, în corpul răspunsului |

Endpoint (confirmat pe `webtest.driverfiscal.ro`): driver-ul local expune `/api/receipt`
(lowercase) pe două porturi — **HTTP `http://localhost:65400/api/receipt`** (plain, fără
dependență de cert) și **HTTPS `https://localhost.driverfiscal.ro:65401/api/receipt`**.
Bridge-ul folosește implicit HTTP pe 65400 (localhost, evită trust-ul certului TLS).

**Consecință cheie:** payload-ul generat de cloud (`pending_receipts.payload`, text cu
linii `\n`) alimentează AMBELE transporturi fără nicio modificare în cloud — bridge-ul
doar alege: `payload.split('\n')` → fișier (join CRLF) sau array JSON (POST). Alegerea
trăiește 100% în bridge-ul local.

### 8.2 Decizie: API primar, fișiere fallback

Recomandat **API**:
- **sincron** — `BONOK`/`NRBON` vin în răspunsul HTTP → fără polling pe `Raspuns/`, fără
  fereastra „sent" blocat (`bridge_mark_stale_as_error` rămâne doar plasă de siguranță);
- **fără race pe filesystem** (fișiere pe jumătate scrise, permisiuni pe folder, antivirus);
- **bridge mai simplu** — fără watcher; doar `poll Supabase → POST localhost → confirm`.

**Integrare directă fără driver: NU** pentru pilot. EconMedia însuși: „a fost suficient
pentru 99% din integratori". Direct = protocol binar per-model (Datecs/Activa/Tremol) pe
serial — exact complexitatea pe care driver-ul o scoate din cârcă.

### 8.3 Formatul comenzii `S^` — sursa de adevăr

Generatorul din cloud (validat de 51 de teste în
`supabase/tests/build_fiscalnet_payload_test.sql`, per `Documentatie.pdf`) emite:

```
S^DENUMIRE^PRET_BANI^CANT_MII^UM^GRTVA^GRDEP
```

Exemplu: `S^Cafea^800^1000^buc^1^1` = Cafea, 8.00 RON, 1.000 buc, grupa TVA 1, dep 1.

✅ **CONFIRMAT pe `webtest.driverfiscal.ro` (FiscalNet Dev Console).** Sample-ul oficial de
body al consolei:

```json
["S^ARTICOL TEST1^100^1000^buc^1^1", "S^ARTICOL TEST2^100^1000^buc^1^1",
 "S^ARTICOL TEST3^100^1000^buc^1^1", "S^ARTICOL TEST4^100^1000^buc^1^1", "P^2^400"]
```

Ordinea `S^…^GRTVA^GRDEP` (aici `^1^1`) e **identică** cu ce produce generatorul din cloud.
**Fără inversare de coloane** — blocantul „TVA greșit pe bon" e închis. Codul de trimitere
al consolei (`sendReceipt()`) e byte-pentru-byte același pattern ca `bridge/lib/fiscalnet.js`
(POST array de string-uri, `AbortController` + timeout, `clearTimeout` în `finally` cu corpul
citit ÎN fereastra de timeout).

Observație minoră: sample-ul consolei NU include o linie `ST^` (subtotal); generatorul nostru
o emite. `ST^` e opțional per spec (`Documentatie.pdf` §3) — de bifat pe casa demo că e
acceptat, nu respins.

### 8.4 Parserul de răspuns (bridge)

`bridge/lib/fiscalnet.js` normalizează orice răspuns la
`{ success, bonNumber, errorCode, errorInfo }` și acceptă **atât JSON cât și text**:
- JSON: `BONOK`/`NRBON`/`ERRCODE`/`ERRINFO` **și** aliasuri (`success`/`receiptNumber`/
  `errorCode`/`message`) — case-insensitive;
- text: `BONOK=1\nNRBON=…` (ca la transportul pe fișiere).

Astfel pilotul merge chiar dacă schema exactă a răspunsului API diferă ușor de screenshot;
aliasurile efective se fixează după testul pe `webtest.driverfiscal.ro`.

### 8.5 Idempotență = anti bon fiscal DUBLU (regulă de siguranță)

Un bon fiscal tipărit de două ori pe aceeași comandă e ilegal. Punctul de risc e
**timeout-după-tipărire**: casa tipărește bonul, dar răspunsul nu ajunge la bridge (rețea /
casă care atârnă). Bridge-ul marchează `error`, owner-ul dă „Reîncearcă" → a doua tipărire.

Protecția pe cele două transporturi:
- **Fișiere:** idempotență prin **numele fișierului** = `receipt_id`. Un fișier re-scris cu
  același nume e ignorat de FiscalNet (dedup nativ). ✅ sigur la retry.
- **API:** bridge-ul trimite header-ul **`Idempotency-Key: <receipt_id>`** la fiecare POST.
  ⚠️ **DE CONFIRMAT** că API-ul BonLocal onorează acest header (sau echivalentul din
  `Documentatie.pdf`). **Până la confirmare:** un `API_UNREACHABLE`/`HTTP_5xx`/timeout pe
  API **NU** e sigur de re-trimis automat — owner-ul verifică fizic casa înainte de
  „Reîncearcă". De aceea bridge-ul NU face retry automat pe erori de rețea (decizie
  intenționată: mai bine un bon marcat greșit „error" + verificare umană, decât un bon dublu).

Reguli deja aplicate în cod: bridge-ul nu marchează NICIODATĂ `success` fără un `BONOK=1`
explicit (orice eșec de transport → `error`, retry uman); claim-ul e atomic (`pending→sent`),
deci două bridge-uri nu ridică același bon.

### 8.6 Checklist pilot

- [x] **Ordinea `S^…^GRTVA^GRDEP` confirmată** pe `webtest.driverfiscal.ro` — identică cu generatorul (§8.3). ✅
- [ ] **Cloud la zi pe prod** — migrațiile bridge/fiscal (030→053 + gate 124/133/149/150/158/159) aplicate.
- [ ] **Înregistrează o casă de test** din Dashboard → primești `device_secret`.
- [ ] **Rulează `--check` (doctor)** — `node bridge/menuvia-bridge.js --check` verifică config + Supabase + FiscalNet fără să tipărească.
- [ ] **Rulează bridge-ul cu mock-ul** (`node bridge/mock-fiscalnet.js` + `node bridge/menuvia-bridge.js`) — flux complet pending→success.
- [ ] **Schema răspunsului real** — pe casa demo, notează câmpurile efective de succes/eroare (parser-ul acceptă deja `BONOK/NRBON` text + JSON cu aliasuri, dar de fixat exact).
- [ ] **`ST^` acceptat** — sample-ul consolei nu-l are; de confirmat că nu e respins (§8.3).
- [ ] **Idempotența API** — că `Idempotency-Key` (sau echivalentul) e onorat de BonLocal (§8.5); altfel retry pe timeout = verificare umană.
- [ ] **HTTPS local (dacă folosești 65401)** — certul trebuie trust-uit de sistem, altfel `fetch` pică înainte să atingă API-ul (§8.3). Recomandat HTTP local pe 65400.
- [ ] **Encoding diacritice** — dacă ies „?", trece pe CP1250 (`iconv-lite`, dep nouă).
- [ ] **Casă reală** — după ce EconMedia confirmă pricing + activăm un trial la un local.
- [ ] **Împachetare** — `pkg` + installer Windows cu auto-start (post-pilot).


## 9. Tichete de bucătărie (mig 227) — canal NEfiscal prin același bridge

Din iulie 2026 bridge-ul deservește DOUĂ cozi complet separate:

| | Bonuri fiscale (`pending_receipts`) | Tichete bucătărie (`kitchen_tickets`) |
|---|---|---|
| Natura | document fiscal (bani) | hârtie informativă pentru bucătar |
| Plan | Plan 3 (`fiscal_receipt`, pro/enterprise) | Plan 2+ (`kitchen_tickets`, growth+) |
| Declanșator | comanda intră în `paid` | comanda e CREATĂ (INSERT, trigger DEFERRED la COMMIT) |
| Ținta | FiscalNet (API BonLocal / file-drop) | imprimantă termică ESC/POS (TCP 9100) sau folder de spool |
| Retry | PERICULOS (bon dublu) — ambiguu = terminal | INOFENSIV (hârtie dublă) — retry liber |
| Eșec | blochează încasarea, alertă | `raise warning`, comanda NU e afectată |

Componente:

- **DB (mig 227)**: `kitchen_tickets` (RLS: membri read-only; mutații DOAR prin RPC-uri),
  `build_kitchen_ticket_payload` (text gata de tipărit: MASA/PICKUP/OSPĂTAR, produse cu
  opțiuni+extras+note, oră Europe/Bucharest), `enqueue_kitchen_ticket` (CONSTRAINT TRIGGER
  DEFERRABLE INITIALLY DEFERRED pe `orders`, catch-all — nu avortează comanda),
  `bridge_get_pending_tickets`/`bridge_claim_ticket`/`bridge_confirm_ticket` (auth pe
  `device_secret` + `prints_kitchen_receipts=true`), `kitchen_ticket_retry`/`_cancel`
  (is_admin), `kitchen_ticket_reprint` (is_member), `kitchen_tickets_mark_stale`
  (service_role; `sent`>10min → `BRIDGE_TIMEOUT`; purge terminale >30 zile — chemat orar
  din `automation-cron.js`).
- **Gate device dual**: `bridge_register` (lanț 030→133→227) și
  `enforce_bridge_device_fiscal_gate` (mig 149, lărgit în 227) acceptă acum
  `fiscal_receipt` **SAU** `kitchen_tickets` — un local growth poate înregistra un device
  DOAR pentru bucătărie. Orice recreare a lor păstrează dual-gate-ul.
- **Bridge**: `bridge/lib/kitchenPrinter.js` — `printTicket()` nu aruncă niciodată;
  mod `tcp` = ESC/POS RAW pe 9100 (init + text transliterat RO→ASCII + feed + cut;
  9100 e fire-and-forget, „success" = socket scris complet, fără ACK de la imprimantă)
  sau mod `file` = scriere atomică `.tmp→rename` `<ticket_id>.txt` (CRLF). Config în
  secțiunea `kitchen` din `config.json` (env: `KITCHEN_*`); `processKitchenOnce` rulează
  în aceeași buclă de poll ca fiscalul; doctor-ul (`--check`) are pasul 4 pentru
  imprimantă. Teste: `bridge/test/kitchenPrinter.test.js` (node:test, zero deps).
- **Dashboard**: tab-ul „Casă & tichete" e vizibil de la tier 2; pe tier 2 secțiunile
  fiscale (stats, coada de bonuri, mapare TVA) sunt ascunse și înlocuite cu un upsell
  compact; per device există toggle „Tichete bucătărie" (`prints_kitchen_receipts`).

Întrebare deschisă (EconMedia, informațional — designul NU depinde de răspuns): dacă
FiscalNet/BonLocal poate tipări și note NEfiscale pe casa fiscală, am putea oferi
tichetele și fără imprimantă termică separată; până atunci canalul termic dedicat
rămâne implementarea de referință.
