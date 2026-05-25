# Menuvia Bridge — Specificație Tehnică Completă

**Versiune:** 1.0  
**Data:** 2026-05-07  
**Autor:** Pentru Radu (Menuvia)  
**Scope:** Driver Datecs (poți extinde la Activa/Tremol cu același pattern)

---

## 1. Scop și obiective

### 1.1 Problema rezolvată
Restaurantele care folosesc Menuvia + casă de marcat Datecs trebuie acum să tasteze MANUAL pe casa de marcat fiecare comandă. Bridge-ul elimină acest pas — softul Menuvia trimite automat bonul la casa de marcat când clientul plătește.

### 1.2 Beneficii pentru restaurant
- Elimină dubla muncă (ospătar nu mai tastează pe casă)
- Reduce greșelile (date corecte din comandă)
- Accelerează închiderea zilei
- Raport Z automat la oră fixă

### 1.3 Beneficii pentru tine
- Justifică pricing premium (399-499 lei/lună)
- Crește lock-in (clientul nu poate pleca ușor)
- Diferențiator vs Smarty Menu / MenuMaker (care n-au integrare casă)

---

## 2. Arhitectura completă

```
┌──────────────────────────────────┐
│  Menuvia Cloud (Supabase)        │
│  - orders                        │
│  - pending_receipts ← NEW table  │
│  - bridge_devices ← NEW table    │
└────────────┬─────────────────────┘
             │
             │ HTTPS REST (polling 5s)
             │ Auth: Bearer token per device
             │
┌────────────▼─────────────────────┐
│  PC LOCAL în restaurant          │
│  Menuvia Bridge (Node.js+Electron)│
│  - Polling /api/bridge/pending   │
│  - Driver Datecs                 │
│  - UI configurare + status       │
│  - Auto-update                   │
└────────────┬─────────────────────┘
             │
             │ USB-Serial (RS-232 over USB)
             │ Cablu: Prolific PL2303 sau FTDI
             │
┌────────────▼─────────────────────┐
│  Casa de marcat Datecs           │
│  (DP-25, DP-50, DP-150, FP-700)  │
│  - Memorie fiscală               │
│  - Conexiune ANAF (SIM/Ethernet) │
└──────────────────────────────────┘
```

---

## 3. Cerințe hardware

### 3.1 Pentru testare (tu, dezvoltator)
| Item | Cost estimat | Sursă |
|------|--------------|-------|
| Datecs DP-25 second-hand | 600-1.000 lei | OLX, Okazii |
| Cablu USB-Serial Prolific PL2303 | 30-50 lei | eMAG, Amazon |
| Hârtie termică 57mm × 50m × 5 role | 30 lei | eMAG |
| **TOTAL minim** | **~700-1.100 lei** | |

### 3.2 Pentru fiecare client
| Item | Cost estimat |
|------|--------------|
| Mini PC Intel NUC sau echivalent | 1.500-2.000 lei |
| ALTERNATIV: Raspberry Pi 5 + carcasă + alimentator | 600-800 lei |
| Cablu USB-Serial | 30-50 lei |
| **TOTAL per client** | **~700-2.100 lei** |

**Notă:** Multe restaurante au deja un PC pentru gestiune. Bridge-ul rulează acolo.

---

## 4. Stack tehnologic

### 4.1 Recomandare: Node.js + Electron

**De ce Node.js:**
- Tu deja știi JavaScript din Menuvia
- Librărie excelentă: `serialport` pentru USB-Serial
- Build cu Electron generează `.exe` Windows / `.dmg` macOS / `.AppImage` Linux

**Dependențe principale:**
```json
{
  "dependencies": {
    "serialport": "^12.0.0",      // USB-Serial communication
    "electron": "^28.0.0",         // Desktop app framework
    "axios": "^1.6.0",             // HTTPS pentru cloud sync
    "electron-updater": "^6.0.0",  // Auto-update
    "winston": "^3.11.0",          // Logging
    "node-machine-id": "^1.1.0"    // Identificare unică PC
  }
}
```

### 4.2 Alternativă: Python + PyInstaller

**De ce Python:**
- Multe exemple de drivere casă de marcat în Python
- Comunitate fiscală RO are mai multe exemple Python

**Dependențe:**
```
pyserial==3.5
PySide6==6.6.0  (pentru UI desktop)
requests==2.31.0
pyinstaller==6.3.0
```

**Recomandarea mea finală: Node.js + Electron.** Tu ai deja experiență JS, iar build-ul e mai stabil cross-platform.

---

## 5. Protocol Datecs — esențialul

### 5.1 Setări serial port
```
Baud rate:    9600
Data bits:    8
Parity:       None
Stop bits:    1
Flow control: None
```

### 5.2 Format pachet generic

```
<PREAMBLE> <LEN> <SEQ> <CMD> <DATA> <POSTAMBLE> <BCC>

Bytes:
  PREAMBLE  = 0x01
  LEN       = lungime totală (LEN+SEQ+CMD+DATA+POSTAMBLE) + 0x20
  SEQ       = număr secvență (0x20-0x7F, increment la fiecare comandă)
  CMD       = codul comenzii (vezi tabel)
  DATA      = parametri ASCII separați cu \t (TAB)
  POSTAMBLE = 0x05
  BCC       = checksum 4 bytes (suma DA-XOR pe LEN..POSTAMBLE)
```

### 5.3 Comenzi esențiale pentru bon

| Cod | Hex | Nume | Descriere |
|-----|-----|------|-----------|
| 38 | 0x26 | OPEN_RECEIPT | Deschide bon nou |
| 49 | 0x31 | SELL_ITEM | Vinde produs cu nume + preț + cota TVA |
| 51 | 0x33 | DISCOUNT | Aplică reducere/majorare |
| 53 | 0x35 | TOTAL | Calculează total bon |
| 56 | 0x38 | TENDER | Plată parțială (cash/card) |
| 69 | 0x45 | CLOSE_RECEIPT | Închide bon și printează |
| 91 | 0x5B | Z_REPORT | Raport Z (sfârșit zi) |
| 108 | 0x6C | STATUS | Citește status casă |

### 5.4 Cota TVA (vat_group)

| Grupa | Cota | Pentru |
|-------|------|--------|
| 1 | 9% | Mâncare, băuturi nealcoolice |
| 2 | 19% | Alcool, restaurante (în anumite cazuri) |
| 3 | 5% | Cazuri speciale |
| 4 | 0% | Scutit TVA |

**Important:** Cota TVA depinde de tipul produsului. Owner-ul restaurantului trebuie să o configureze per produs în Menuvia.

### 5.5 Exemplu flux complet bon

```
1. OPEN_RECEIPT
   → Casa: bon deschis, număr bon = 1234

2. SELL_ITEM "Pizza Margherita\t25.00\t1"
   → Casa: produs adăugat, TVA 9% = 2.06 lei

3. SELL_ITEM "Apă plată\t5.00\t1"
   → Casa: produs adăugat

4. TOTAL
   → Casa: TOTAL = 30.00 lei (din care TVA 9% = 2.48 lei)

5. TENDER "30.00\t1"  (1 = cash)
   → Casa: încasat 30.00 lei cash

6. CLOSE_RECEIPT
   → Casa: PRINTEAZĂ BON + scrie în memoria fiscală
```

---

## 6. Modificări necesare în Menuvia Cloud

### 6.1 Migration nouă: 026-bridge-integration.sql

```sql
-- ── Bridge devices (1 per restaurant + casă de marcat) ──────

create table bridge_devices (
  id              uuid primary key default uuid_generate_v4(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  device_name     text not null,
  device_token    text not null unique,  -- pentru auth bridge → cloud
  driver_type     text not null check (driver_type in ('datecs', 'activa', 'tremol')),
  driver_config   jsonb,  -- ex: {"port": "COM3", "baud": 9600}
  is_active       boolean not null default true,
  last_seen_at    timestamptz,
  created_at      timestamptz default now()
);

create index idx_bridge_devices_restaurant on bridge_devices(restaurant_id);

alter table bridge_devices enable row level security;
create policy "bridge: admin manage" on bridge_devices for all
  using (public.is_admin(restaurant_id));

-- ── Pending receipts queue ──────────────────────────────────

create table pending_receipts (
  id              uuid primary key default uuid_generate_v4(),
  restaurant_id   uuid not null references restaurants(id),
  order_id        uuid not null references orders(id),
  device_id       uuid references bridge_devices(id),
  status          text not null default 'pending'
                  check (status in ('pending', 'sent_to_bridge', 'printed', 'failed')),
  payload         jsonb not null,
  attempts        smallint not null default 0,
  error_message   text,
  created_at      timestamptz default now(),
  sent_at         timestamptz,
  printed_at      timestamptz,
  failed_at       timestamptz
);

create index idx_pending_receipts_status on pending_receipts(restaurant_id, status, created_at);

alter table pending_receipts enable row level security;
create policy "receipts: admin read" on pending_receipts for select
  using (public.is_admin(restaurant_id));

-- ── VAT group per product ──────────────────────────────────

alter table products
  add column if not exists vat_group smallint not null default 1
  check (vat_group between 1 and 4);

comment on column products.vat_group is
  '1=9% mâncare, 2=19% alcool, 3=5% special, 4=0% scutit';

-- ── Add to print queue (auto on payment) ───────────────────

create or replace function add_to_print_queue(p_order_id uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  v_receipt_id uuid;
  v_payload jsonb;
  v_restaurant_id uuid;
begin
  select restaurant_id into v_restaurant_id from orders where id = p_order_id;
  
  -- Verifică dacă restaurantul are bridge activ
  if not exists (select 1 from bridge_devices 
                 where restaurant_id = v_restaurant_id and is_active = true) then
    return null;  -- No bridge configured, skip
  end if;

  -- Build payload
  select jsonb_build_object(
    'order_id',       o.id,
    'short_id',       o.short_id,
    'created_at',     o.created_at,
    'payment_method', o.payment_method,
    'total',          o.total,
    'paid_amount',    o.paid_amount,
    'items', (
      select jsonb_agg(jsonb_build_object(
        'name',      oi.product_name_snapshot,
        'quantity',  oi.quantity,
        'unit_price', oi.unit_price_snapshot,
        'total',     oi.item_total,
        'vat_group', coalesce(p.vat_group, 1),
        'modifiers', oi.selected_modifiers,
        'extras',    oi.extras_added
      ))
      from order_items oi
      left join products p on p.id = oi.product_id
      where oi.order_id = o.id
    )
  ) into v_payload
  from orders o
  where o.id = p_order_id;

  insert into pending_receipts (restaurant_id, order_id, status, payload)
  values (v_restaurant_id, p_order_id, 'pending', v_payload)
  returning id into v_receipt_id;

  return v_receipt_id;
end;
$$;

-- ── Trigger automat la plată ────────────────────────────────

create or replace function trigger_print_on_paid()
returns trigger
language plpgsql
as $$
begin
  if NEW.status = 'paid' and (OLD.status is null or OLD.status != 'paid') then
    perform add_to_print_queue(NEW.id);
  end if;
  return NEW;
end;
$$;

create trigger order_paid_print_trigger
  after update of status on orders
  for each row execute function trigger_print_on_paid();
```

### 6.2 Edge functions pentru Bridge

**`netlify/functions/bridge-pending.ts`** — bridge cere comenzi noi

```typescript
import { createClient } from '@supabase/supabase-js'
import type { Handler } from '@netlify/functions'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  // Auth: verifică token bridge
  const token = event.headers.authorization?.replace('Bearer ', '')
  if (!token) return { statusCode: 401, body: 'Unauthorized' }

  const { data: device } = await supabase
    .from('bridge_devices')
    .select('id, restaurant_id')
    .eq('device_token', token)
    .eq('is_active', true)
    .single()

  if (!device) return { statusCode: 401, body: 'Invalid token' }

  // Update last_seen
  await supabase
    .from('bridge_devices')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', device.id)

  // Get pending receipts
  const { data: receipts } = await supabase
    .from('pending_receipts')
    .select('*')
    .eq('restaurant_id', device.restaurant_id)
    .eq('status', 'pending')
    .order('created_at')
    .limit(10)

  if (!receipts || receipts.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ receipts: [] }) }
  }

  // Mark as sent_to_bridge (atomic)
  await supabase
    .from('pending_receipts')
    .update({ 
      status: 'sent_to_bridge', 
      sent_at: new Date().toISOString(),
      device_id: device.id
    })
    .in('id', receipts.map(r => r.id))

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ receipts })
  }
}
```

**`netlify/functions/bridge-confirm.ts`** — bridge confirmă printare

```typescript
export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405 }

  const token = event.headers.authorization?.replace('Bearer ', '')
  const { data: device } = await supabase
    .from('bridge_devices')
    .select('id')
    .eq('device_token', token)
    .single()
  if (!device) return { statusCode: 401 }

  const { receipt_id, status, error_message } = JSON.parse(event.body!)

  if (!['printed', 'failed'].includes(status)) {
    return { statusCode: 400, body: 'Invalid status' }
  }

  await supabase.from('pending_receipts').update({
    status,
    [status === 'printed' ? 'printed_at' : 'failed_at']: new Date().toISOString(),
    error_message: error_message || null,
    attempts: supabase.rpc('increment_attempts', { receipt_id })
  }).eq('id', receipt_id)

  return { statusCode: 200, body: 'OK' }
}
```

### 6.3 UI nou în Dashboard

Tab nou „📟 Casă de marcat" în Settings cu:
- Status bridge (online/offline, last_seen_at)
- Buton „Generează token nou bridge"
- Listă bonuri printate azi
- Listă bonuri failed (cu retry)
- Configurare driver_config (port COM, etc.)

---

## 7. Bridge App — structura fișierelor

```
menuvia-bridge/
├── package.json
├── electron-builder.json     # Config build .exe / .dmg
├── src/
│   ├── main.js               # Electron main process
│   ├── preload.js            # Preload script (IPC)
│   ├── ui/
│   │   ├── index.html        # UI configurare
│   │   ├── style.css
│   │   └── renderer.js       # UI logic
│   ├── drivers/
│   │   ├── base.js           # Driver abstract base class
│   │   ├── datecs.js         # Driver Datecs (~800 linii)
│   │   ├── activa.js         # Future
│   │   └── tremol.js         # Future
│   ├── core/
│   │   ├── config.js         # Config local (electron-store)
│   │   ├── cloud-sync.js     # Polling cloud + confirm
│   │   ├── receipt-builder.js # Convertește payload în comenzi
│   │   ├── logger.js         # Winston logging
│   │   └── auto-update.js    # electron-updater
│   └── tests/
│       ├── datecs.test.js
│       └── receipt-builder.test.js
├── assets/
│   ├── icon.png
│   └── tray-icon.png
└── build/
    └── (generated installers)
```

---

## 8. Driver Datecs — implementare detaliată

### 8.1 Base class

```javascript
// src/drivers/base.js
class BaseDriver {
  constructor(config) {
    this.config = config
    this.connected = false
  }

  async connect() { throw new Error('Implement in subclass') }
  async disconnect() { throw new Error('Implement in subclass') }
  async printReceipt(payload) { throw new Error('Implement in subclass') }
  async generateZReport() { throw new Error('Implement in subclass') }
  async getStatus() { throw new Error('Implement in subclass') }
}

module.exports = BaseDriver
```

### 8.2 Datecs driver complet

```javascript
// src/drivers/datecs.js
const { SerialPort } = require('serialport')
const BaseDriver = require('./base')

const PREAMBLE = 0x01
const POSTAMBLE = 0x05
const TERMINATOR = 0x03

class DatecsDriver extends BaseDriver {
  constructor(config) {
    super(config)
    this.port = null
    this.sequenceNumber = 0x20
    this.responseBuffer = Buffer.alloc(0)
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.port = new SerialPort({
        path: this.config.port,        // ex: 'COM3' or '/dev/ttyUSB0'
        baudRate: this.config.baud || 9600,
        dataBits: 8,
        parity: 'none',
        stopBits: 1,
        autoOpen: true
      }, (err) => {
        if (err) return reject(err)
        this.port.on('data', (data) => {
          this.responseBuffer = Buffer.concat([this.responseBuffer, data])
        })
        this.connected = true
        resolve()
      })
    })
  }

  async disconnect() {
    if (this.port) {
      return new Promise((resolve) => {
        this.port.close(() => {
          this.connected = false
          resolve()
        })
      })
    }
  }

  // Increment seq number (wraps 0x20 - 0x7F)
  nextSequence() {
    this.sequenceNumber++
    if (this.sequenceNumber > 0x7F) this.sequenceNumber = 0x20
    return this.sequenceNumber
  }

  // Build packet conform protocol Datecs
  buildPacket(cmd, dataBuffer) {
    const seq = this.nextSequence()
    const dataLen = dataBuffer.length
    const totalLen = dataLen + 0x20 + 4  // SEQ + CMD + DATA + POSTAMBLE
    const len = totalLen + 0x20

    const body = Buffer.concat([
      Buffer.from([len, seq, cmd]),
      dataBuffer,
      Buffer.from([POSTAMBLE])
    ])

    // BCC = 4 ASCII bytes representing checksum
    let sum = 0
    for (const b of body) sum += b
    const bcc = sum.toString(16).toUpperCase().padStart(4, '0')
    const bccBuf = Buffer.from(bcc.split('').map(c => c.charCodeAt(0)))

    return Buffer.concat([
      Buffer.from([PREAMBLE]),
      body,
      bccBuf,
      Buffer.from([TERMINATOR])
    ])
  }

  // Parse response from device
  parseResponse(buffer) {
    // Find PREAMBLE
    const start = buffer.indexOf(PREAMBLE)
    if (start === -1) return null

    // Find TERMINATOR
    const end = buffer.indexOf(TERMINATOR, start)
    if (end === -1) return null

    const packet = buffer.slice(start, end + 1)
    
    // Extract: STATUS bytes + DATA
    // Datecs response: 0x01 LEN SEQ CMD STATUS_BYTES POSTAMBLE DATA TERM BCC
    // Status bytes: 6 bytes (S0..S5) describing device state
    
    const len = packet[1]
    const seq = packet[2]
    const cmd = packet[3]
    const dataStart = 4 + 6  // skip STATUS bytes
    const dataEnd = packet.indexOf(POSTAMBLE, dataStart)
    const data = packet.slice(dataStart, dataEnd).toString('ascii')

    // Parse status bytes for errors
    const statusBytes = packet.slice(4, 10)
    const errorCode = this.parseErrorCode(statusBytes)

    return { cmd, data, statusBytes, errorCode, raw: packet }
  }

  parseErrorCode(statusBytes) {
    // Decode error from status bytes (per Datecs protocol)
    // S0 bit 5 = general error, S1 bit 0 = printer error, etc.
    const s0 = statusBytes[0] - 0x80
    if (s0 & 0x20) return 'GENERAL_ERROR'
    
    const s1 = statusBytes[1] - 0x80
    if (s1 & 0x01) return 'OUT_OF_PAPER'
    if (s1 & 0x02) return 'PRINTER_ERROR'
    
    // ... more checks
    return null
  }

  async sendCommand(cmd, data = Buffer.alloc(0), timeoutMs = 5000) {
    if (!this.connected) throw new Error('Driver not connected')

    this.responseBuffer = Buffer.alloc(0)
    const packet = this.buildPacket(cmd, data)
    this.port.write(packet)

    // Wait for response with timeout
    const startTime = Date.now()
    while (Date.now() - startTime < timeoutMs) {
      const response = this.parseResponse(this.responseBuffer)
      if (response) {
        if (response.errorCode) {
          throw new Error(`Datecs error: ${response.errorCode}`)
        }
        return response
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }

    throw new Error('Datecs command timeout')
  }

  // ── High-level methods ────────────────────────────────────

  async openReceipt(operatorCode = '1', operatorPassword = '0000') {
    const data = Buffer.from(`${operatorCode},${operatorPassword},,`)
    return this.sendCommand(0x30, data)  // 0x30 = OPEN_FISCAL_RECEIPT
  }

  async sellItem(name, price, vatGroup, quantity = 1) {
    // Format: NAME\tTAB\tPRICE\tTAB\tVAT_GROUP\tTAB\tQTY
    // Vat groups: 1=А (9%), 2=Б (19%), 3=В (5%), 4=Г (0%)
    const vatLetter = ['А', 'Б', 'В', 'Г'][vatGroup - 1]
    const data = Buffer.from(
      `${name}\t${vatLetter}${price.toFixed(2)}*${quantity.toFixed(3)}`
    )
    return this.sendCommand(0x31, data)
  }

  async total() {
    return this.sendCommand(0x35, Buffer.from(''))
  }

  async tender(amount, paymentType = 'cash') {
    // Payment types: P = cash, P1 = card, P2 = voucher, etc.
    const typeCode = { cash: 'P', card: 'P1', voucher: 'P2' }[paymentType] || 'P'
    const data = Buffer.from(`\t${typeCode}${amount.toFixed(2)}`)
    return this.sendCommand(0x35, data)
  }

  async closeReceipt() {
    return this.sendCommand(0x38, Buffer.alloc(0))
  }

  async cancelReceipt() {
    return this.sendCommand(0x39, Buffer.alloc(0))
  }

  // ── Reports ───────────────────────────────────────────────

  async generateZReport() {
    return this.sendCommand(0x5B, Buffer.from('1'))  // 1 = Z report
  }

  async generateXReport() {
    return this.sendCommand(0x5B, Buffer.from('2'))  // 2 = X report
  }

  async getStatus() {
    return this.sendCommand(0x4A, Buffer.alloc(0))  // GET_STATUS
  }

  async getDateTime() {
    return this.sendCommand(0x3E, Buffer.alloc(0))
  }

  // ── Full receipt printing flow ─────────────────────────────

  async printReceipt(payload) {
    try {
      // 1. Open receipt
      await this.openReceipt()

      // 2. Add items
      for (const item of payload.items) {
        await this.sellItem(
          item.name,
          item.unit_price,
          item.vat_group || 1,
          item.quantity
        )

        // Add modifiers as separate lines (or as price modifiers)
        for (const mod of item.modifiers || []) {
          if (mod.price_delta > 0) {
            await this.sellItem(
              `  + ${mod.option_name}`,
              mod.price_delta,
              item.vat_group || 1,
              1
            )
          }
        }

        // Add extras
        for (const extra of item.extras || []) {
          await this.sellItem(
            `  + ${extra.name}`,
            extra.price,
            item.vat_group || 1,
            1
          )
        }
      }

      // 3. Total
      await this.total()

      // 4. Tender (payment)
      const paymentType = payload.payment_method === 'card' ? 'card' : 'cash'
      await this.tender(payload.total, paymentType)

      // 5. Close receipt (printează)
      await this.closeReceipt()

      return { success: true }
    } catch (err) {
      // Try to cancel receipt if something failed
      try { await this.cancelReceipt() } catch (e) {}
      throw err
    }
  }
}

module.exports = DatecsDriver
```

### 8.3 Cloud sync logic

```javascript
// src/core/cloud-sync.js
const axios = require('axios')
const logger = require('./logger')

class CloudSync {
  constructor(driver, config) {
    this.driver = driver
    this.config = config
    this.running = false
    this.pollInterval = 5000
  }

  async start() {
    this.running = true
    while (this.running) {
      try {
        await this.pollOnce()
      } catch (err) {
        logger.error('Poll error:', err)
      }
      await new Promise(r => setTimeout(r, this.pollInterval))
    }
  }

  stop() {
    this.running = false
  }

  async pollOnce() {
    const res = await axios.get(
      `${this.config.cloudUrl}/api/bridge/pending`,
      {
        headers: { Authorization: `Bearer ${this.config.deviceToken}` },
        timeout: 10000
      }
    )

    const receipts = res.data.receipts || []
    if (receipts.length === 0) return

    logger.info(`Received ${receipts.length} pending receipts`)

    for (const receipt of receipts) {
      await this.processReceipt(receipt)
    }
  }

  async processReceipt(receipt) {
    try {
      logger.info(`Printing receipt ${receipt.id}`)
      await this.driver.printReceipt(receipt.payload)
      
      // Confirm success
      await axios.post(
        `${this.config.cloudUrl}/api/bridge/confirm`,
        { receipt_id: receipt.id, status: 'printed' },
        { headers: { Authorization: `Bearer ${this.config.deviceToken}` } }
      )
      
      logger.info(`Receipt ${receipt.id} printed successfully`)
    } catch (err) {
      logger.error(`Failed to print ${receipt.id}:`, err)
      
      // Report failure
      await axios.post(
        `${this.config.cloudUrl}/api/bridge/confirm`,
        { receipt_id: receipt.id, status: 'failed', error_message: err.message },
        { headers: { Authorization: `Bearer ${this.config.deviceToken}` } }
      ).catch(e => logger.error('Failed to report failure:', e))
    }
  }
}

module.exports = CloudSync
```

### 8.4 UI Electron — Renderer

Configurare simplă pentru owner:

- Dropdown port COM (auto-detect cu `SerialPort.list()`)
- Input device token (din Menuvia Dashboard)
- Buton „Test conexiune"
- Buton „Test print"
- Status indicator (verde/roșu)
- Log live (ultimele 50 acțiuni)
- Auto-start cu Windows (toggle)

---

## 9. Plan de implementare — timeline

### Săptămâna 1-2: Setup și cercetare
- Cumpărat Datecs second-hand
- Instalare driver USB-Serial pe PC
- Test conexiune cu HyperTerminal/PuTTY (comenzi manuale)
- Citire documentație protocol (~30 ore)

### Săptămâna 3-5: Driver Datecs
- Implementare BaseDriver
- Implementare DatecsDriver (toate comenzile esențiale)
- Tests unitare cu mock SerialPort
- Tests cu hardware real (10-20 bonuri test)

### Săptămâna 6-7: Cloud integration
- Migration 026 (DB tables)
- Edge functions (bridge-pending, bridge-confirm)
- UI Dashboard (tab Casă de marcat, generare token)
- Trigger automat la order paid

### Săptămâna 8-9: Electron app
- UI Electron pentru bridge
- Auto-update mechanism
- Logging robust
- Build instalator Windows (.exe)

### Săptămâna 10: Testare end-to-end
- Test 100 bonuri în 1 zi
- Test recovery la deconectare cablu
- Test recovery la cădere internet
- Test la închidere zi (raport Z)

### Săptămâna 11-12: Pilot client
- Vizita fizică la primul client
- Instalare + configurare
- Stand-by 1 săptămână pentru bug-uri

**Total: 3 luni dezvoltare full-time** (sau 5-6 luni part-time).

---

## 10. Resurse și referințe

### Documentație Datecs
- Site oficial: https://www.datecs.bg
- Manual ECR: caută „Datecs ECR Programmer Manual" PDF
- Forum tehnic: există grupuri pe Facebook „Case de marcat România" cu programatori

### Librării utile
- `serialport`: https://serialport.io/docs/
- `electron-builder`: https://www.electron.build/
- `winston`: https://github.com/winstonjs/winston

### Comunitate
- StackOverflow tag: `[fiscal-printer]`, `[datecs]`
- GitHub: caută „datecs ecr driver" (există implementări open-source bulgărești)

### Resurse legale
- Hotărâre 479/2003 — case de marcat în România
- OUG 28/1999 — privind aparatele de marcat
- Site ANAF: https://www.anaf.ro — secțiunea „Case de marcat"

---

## 11. Riscuri și mitigări

| Risc | Probabilitate | Impact | Mitigare |
|------|---------------|--------|----------|
| Datecs schimbă protocol în firmware nou | Mică | Mare | Versionează driver-ul, testează la upgrade firmware |
| Internet pică în restaurant | Mare | Mediu | Bridge păstrează coadă locală, sincronizează când revine net |
| Casa rămâne fără hârtie | Mare | Mic | Detectează status, alert client, retry |
| Cablu USB se desface | Medie | Mediu | Detect connection loss, alert, auto-reconnect |
| Owner uită să închidă bonul (Z report) | Mică | Mare | Auto-Z la oră fixă (configurabil) |
| Bug în soft pierde un bon | Mică | FOARTE Mare | Logging extensiv, replay queue, audit trail |

---

## 12. Pricing și model business

### Pentru clientul final
- **Setup la cheie:** 1.500 - 2.500 lei
  - Vine Radu, instalează bridge, configurează, testează
  - Include 1 mini PC dacă nu au (extra 1.500 lei)
- **Lunar:** +200 lei pe abonament Pro
  - Ex: Pro 199 + Bridge 200 = 399 lei/lună

### Cost tău per client
- Hardware (PC dacă e nevoie): 600-1.500 lei
- Timpul tău (instalare + test 1 zi): ~500 lei dacă ar fi în piața liberă
- Suport ongoing: ~50 lei/lună (ocazional)

**Margin per client: ~70% pe lunar, ~50% pe one-time**

---

## 13. Checklist final înainte de a începe

- [ ] Am cumpărat Datecs DP-25 sau DP-50 second-hand
- [ ] Am cablu USB-Serial Prolific PL2303
- [ ] Am hârtie termică
- [ ] Am descărcat documentația protocol Datecs (PDF)
- [ ] Am citit părțile esențiale (~10 comenzi)
- [ ] Am instalat Node.js + Electron pe PC
- [ ] Am testat conexiune Datecs cu HyperTerminal (comandă manuală)
- [ ] Am cont GitHub repo dedicat: `menuvia-bridge`
- [ ] Am buget timp: 3 luni full-time sau 5-6 luni part-time

**Când toate sunt bifate, ești gata să începi.**

---

**Sfârșit document.**
