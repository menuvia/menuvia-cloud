# AUTONOMY_ARCHITECTURE — structura stack-ului autonom (self-hosted)

> Ținta: Menuvia rulează **integral pe infrastructură proprie**, cu excepția a trei
> lucruri pe care e irațional să le construim singuri — procesarea cardului (Stripe),
> casa de marcat fiscală (reglementat) și modelele AI de vârf. Restul îl deținem.
>
> Acest document e **structura țintă**. Nu înlocuiește `VPS_RUNBOOK.md` (pasul „VPS,
> dar tot Supabase Cloud") — îl continuă: pasul „VPS + baza de date proprie". Analiza
> de fezabilitate e deja făcută (task-urile A1–A10, sinteza PM+Reviewer).

---

## 0. Cele trei straturi de independență (unde suntem)

Menuvia are trei dependențe de infrastructură, atacabile independent:

| Strat | Azi | Deja deținut? |
|---|---|---|
| **Hosting + funcții + cron** | Netlify | ✅ `deploy/server.js` (shim VPS) + `Caddyfile` + systemd |
| **Fiscalizare (bon)** | Casă prin FiscalNet | ✅ `bridge/` (orchestrarea e cod al nostru) |
| **Date (DB + Auth + Realtime + Storage)** | Supabase **Cloud** | ⏳ **acest document** — self-host |

Primul strat e livrat (rulezi frontendul + cele 20 de funcții pe un Hetzner CX22 la
~4 €/lună). Al doilea e livrat (bridge-ul fiscal). **Al treilea — baza de date — e
ultima piesă de internalizat**, și cea mai valoroasă: elimină singurul furnizor
lunar variabil rămas și îți dă control total pe date.

---

## 1. Nodul autonom — ce rulează pe VPS

Un singur server (sau doi, la scară — vezi §6). Toate procesele sub `systemd`,
expuse prin Caddy cu HTTPS automat.

```
                          Internet (clienți QR, staff, founder)
                                        │  HTTPS :443
                          ┌─────────────▼─────────────┐
                          │   Caddy (reverse proxy)    │  HTTPS auto (Let's Encrypt)
                          │   deploy/Caddyfile         │  paritate headers Netlify
                          └──┬──────────┬──────────┬───┘
              /assets, SPA   │          │          │  /.netlify/functions/*
              /* → index     │          │          │  /health
           ┌────────────────▼──┐   ┌────▼────────┐ │   ┌──────────────────────┐
           │ Static (Vite dist)│   │ PostgREST   │◄┼───│ Node functions shim  │
           │ /srv/menuvia/dist │   │ :3000       │ │   │ deploy/server.js :8788│
           └───────────────────┘   │ (REST + RLS)│ │   │ (funcțiile Netlify +  │
                                    └──────┬──────┘ │   │  cron din netlify.toml)│
           ┌───────────────────┐          │        │   └───────────┬───────────┘
           │ GoTrue (Auth)     │◄─────────┤        │               │ service_role
           │ :9999             │          │        │               │
           └────────┬──────────┘          │        │               │
                    │              ┌───────▼────────▼───────────────▼──────┐
           ┌────────▼──────────┐   │        PostgreSQL 17                   │
           │ Realtime          │◄──│  (RLS, migrațiile menuvia-cloud,       │
           │ :4000 (WebSocket) │   │   toate RPC-urile SECURITY DEFINER)    │
           └───────────────────┘   └───────────────┬───────────────────────┘
           ┌───────────────────┐                   │
           │ Storage (imagini) │◄──────────────────┘   backup nightly → obiect off-site
           │ MinIO/S3 :9000    │                        (deploy/backup-db.sh, extins)
           └───────────────────┘

   Extern (linia roșie, intenționat):  Stripe · casa fiscală (prin bridge) · modele AI
```

### Componente și porturi

| Serviciu | Rol | Port intern | Sursă | Înlocuiește din Supabase Cloud |
|---|---|---|---|---|
| **Caddy** | Reverse proxy + HTTPS + static | 443/80 | `deploy/Caddyfile` (există) | edge-ul Netlify |
| **Static Vite** | Frontendul (SPA) | — (fișiere) | `npm run build` → `/srv/menuvia/dist` | Netlify CDN |
| **Node functions shim** | Cele 20 de funcții + cron | 8788 | `deploy/server.js` (există) | Netlify Functions |
| **PostgreSQL 17** | Baza de date + RLS + RPC | 5432 (local) | pachet oficial PGDG | Supabase DB |
| **PostgREST** | API REST auto din schema PG | 3000 | binar oficial | Supabase REST (`supabase-js` REST) |
| **GoTrue** | Autentificare (JWT, email/parolă) | 9999 | binar oficial Supabase | Supabase Auth |
| **Realtime** | WebSocket pe `postgres_changes` | 4000 | binar oficial Supabase | Supabase Realtime |
| **Storage** | Imagini produse/logo | 9000 | MinIO (S3-compatibil) | Supabase Storage |

> **De ce merge fără rescriere:** `supabase-js` din frontend vorbește exact protocoalele
> de mai sus (REST via PostgREST, Auth via GoTrue, WebSocket via Realtime). Schimbi DOAR
> `VITE_SUPABASE_URL` să pointeze la domeniul propriu; codul aplicației rămâne neatins.
> Toate componentele self-host sunt **aceleași binare open-source** pe care le rulează și
> Supabase Cloud — nu reimplementăm nimic, doar le găzduim.

---

## 2. Fluxul de date (un request tipic)

**Comandă QR (cel mai fierbinte flux):**
1. Clientul deschide `/q/:token` → Caddy servește SPA-ul static.
2. `supabase-js` cheamă `get_menu_for_restaurant` → PostgREST (`:3000`) → Postgres (RPC SECURITY DEFINER, RLS aplicat).
3. Realtime (`:4000`) împinge comenzile noi spre Bucătărie/Ospătar prin WebSocket.
4. `create_order` → PostgREST → Postgres; triggerul `enqueue_fiscal_receipt` pune bonul în coadă.
5. Bridge-ul fiscal (pe PC-ul de la casă) preia din coadă → casa de marcat.

**Plata online la masă (linia roșie):**
1. `table-payment.js` (shim, `:8788`, `service_role`) → RPC `begin_table_payment` (Postgres).
2. → Stripe Connect (extern, inevitabil) → webhook → shim → `settle_table_payment`.

Nimic din fluxul de operare zilnică nu iese din nod, cu excepția plății cu cardul.

---

## 3. Env — o singură schimbare de „adresă"

Structura de env rămâne identică; se schimbă doar **unde** pointează:

```ini
# ── Azi (VPS + Supabase Cloud) ──
VITE_SUPABASE_URL=https://swjcptdylfmpvopdepqf.supabase.co
SUPABASE_URL=https://swjcptdylfmpvopdepqf.supabase.co

# ── Autonom (self-host) ──
VITE_SUPABASE_URL=https://api.menuvia.ro      # Caddy → GoTrue/PostgREST/Realtime
SUPABASE_URL=http://127.0.0.1                  # funcțiile lovesc local, fără hairpin
SUPABASE_SERVICE_ROLE_KEY=<JWT semnat cu secretul propriu>
SUPABASE_ANON_KEY=<JWT anon semnat cu același secret>
GOTRUE_JWT_SECRET=<secret propriu>             # tot ce semnează/verifică JWT-uri
```

`service_role` și `anon` sunt doar JWT-uri semnate cu `GOTRUE_JWT_SECRET`; le generezi
o dată. Restul funcțiilor (Stripe, Resend, AI, bridge) folosesc aceleași env-uri ca azi.

---

## 4. Backup & recuperare (RPO/RTO reale)

Independența de date înseamnă că **backup-ul devine responsabilitatea noastră** — nu mai
e „magia Supabase". Deja avem scheletul (`deploy/backup-db.sh` + `menuvia-backup.timer`).

| Element | Mecanism | Țintă |
|---|---|---|
| **Dump logic nightly** | `pg_dump` (client PG17 deja instalat) → obiect off-site (R2/B2) | RPO ≤ 24h |
| **WAL archiving** (recomandat) | `wal-g`/`pgBackRest` → obiect off-site | RPO ≤ 5 min |
| **Imagini (Storage)** | replicare bucket MinIO → obiect off-site | RPO ≤ 24h |
| **Restore testat** | script de restaurare pe un VPS efemer, lunar | RTO cunoscut, nu presupus |

Regula de aur ops: **un backup netestat nu e backup.** Restore-ul lunar pe server efemer
e non-negociabil (e deja în task #159, FAZA 1).

---

## 5. Securitate (ce se schimbă când deții DB-ul)

- **Postgres NU e expus public** — ascultă doar pe `127.0.0.1`; accesul vine exclusiv prin
  PostgREST/GoTrue/Realtime (care aplică RLS/JWT) sau prin funcțiile `service_role` locale.
- **RLS rămâne linia de apărare** — exact aceleași politici și RPC-uri SECURITY DEFINER din
  migrații; lockdown-ul (096A/B/C, search_path, revoke PUBLIC) e independent de host.
- **Firewall**: doar 443/80 (Caddy) + 22 (SSH cu cheie) deschise. Restul porturilor — local.
- **Secretele** în `/etc/menuvia/env` (chmod 600), niciodată în git.
- **HTTPS** automat prin Caddy (Let's Encrypt), cu HSTS preload (paritate `Caddyfile` actual).

---

## 6. Praguri de scalare (când crește un nod)

Un singur Hetzner CX22 (2 vCPU / 4 GB) duce confortabil zeci de restaurante active.
Punctele de despărțire, în ordine:

1. **DB pe nod dedicat** — când CPU/IO pe Postgres devine gâtuit; app + DB pe două servere.
2. **Read-replica** — pentru rapoarte/analytics grele, fără să atingi calea de scriere.
3. **PgBouncer** — pooling de conexiuni când numărul de funcții concurente crește.
4. **Realtime separat** — WebSocket-urile scalează diferit de REST; le muți pe nodul lor.

Până la aceste praguri, verticalul (un server mai mare) e mai ieftin și mai simplu decât
orizontalul. Nu optimiza pentru scară pe care n-o ai încă.

---

## 7. Linia roșie — ce NU internalizăm (și de ce)

| Extern | De ce rămâne | Ce deținem totuși |
|---|---|---|
| **Stripe** (card) | Procesarea cardului cere licență de procesator + PCI-DSS. Costul/riscul depășesc orice câștig. | Toată logica de plan/comision/settle e a noastră; Stripe e doar „țeava" de card. |
| **Casa de marcat** | Hardware reglementat legal (ANAF). Nu se emulează. | **Bridge-ul** — orchestrarea bonului spre casă e cod al nostru. |
| **Modele AI de vârf** | Vision/traduceri de calitate = comoditate globală, self-host ineficient. | Abstracția de furnizor + metering; task-urile simple pot merge pe model self-host. |

Acestea nu sunt slăbiciuni — sunt **granițele raționale** ale oricărei platforme SaaS.
Facturarea (Oblio) și emailul (Resend) SUNT internalizabile (ANAF direct / SMTP propriu) și
sunt trecute în roadmap, dar au prioritate mai mică decât baza de date.

---

## 8. Ordinea de migrare (referință rapidă)

Fundația e livrată; ce urmează, în ordinea valoare/efort:

1. **[FĂCUT]** Shim VPS pentru funcții + cron (`deploy/`), bridge fiscal (`bridge/`).
2. **Self-host stack date** — Postgres + PostgREST + GoTrue + Realtime + MinIO pe VPS;
   replay migrațiile; migrează datele; comută `VITE_SUPABASE_URL`. *Cel mai mare câștig.*
3. **Backup propriu robust** — WAL archiving + restore testat lunar (task #159).
4. **Email propriu** — SMTP self-host sau portabilitate pe orice provider.
5. **ANAF e-Factura direct** — scoți Oblio din lanț (o funcție de rescris + certificat).
6. **Observabilitate proprie** — GlitchTip (self-host Sentry); alerte pe email propriu.

Detaliile pas-cu-pas ale pasului 2 (cutover, rollback, paritate GoTrue/Realtime) sunt în
analiza A1–A10; un runbook operațional dedicat se scrie când decizi să pornești migrarea.

---

*Sursă: `deploy/` (server.js, Caddyfile, setup-vps.sh, backup-db.sh), `bridge/`, migrațiile
`supabase/migrations/`, analiza A1–A10. Complementar cu `VPS_RUNBOOK.md` (pasul anterior) și
`RUNBOOK.md` / `MASTER_PLAN.md`.*
