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

Repo separat `menuvia-bridge` (Node.js):
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
