# RUNBOOK — Operare, Recovery & Protocol de absență (Menuvia)

> Playbook pentru operarea platformei când founderul **nu** e la tastatură.
> Scris pentru a fi urmat sub stres, de tine peste 3 luni sau de un coleg de încredere.
>
> **Regula #1 în incident:** nimic din runbook-ul ăsta nu atinge bani/bon fiscal fără
> să respecte Regula de aur (`CLAUDE.md`): plăți/bon/TVA = Plan 3, gate-uit în RPC/RLS.
> Comenzile SQL de mai jos rulează cu `service_role` (bypass RLS) — **rulează-le doar
> tu**, din Supabase SQL Editor pe proiectul **corect** (prod vs staging).

**Legendă maturitate:**
✅ implementat și verificat · ⚠️ implementat parțial / manual · 🔲 TODO (de făcut)

---

## 1. Toleranța la absență — „cât pot lipsi fără să crape nimic"

Sistemul e proiectat cu cozi idempotente și cron catch-up, deci **degradarea e
non-distructivă pe termen scurt**. Problemele reale apar doar la absențe lungi, pe
subsistemele care cer o **acțiune umană** (payout, conformitate GDPR, token-uri expirate).

| Orizont | Subsistem | Ce se întâmplă | Severitate |
|---|---|---|---|
| **≤ 1 zi** | Toate | Cozile (email, Oblio, lifecycle) se procesează singure. Cron-urile catch-up recuperează orice tick ratat. | ✅ OK — nu necesită intervenție |
| **~1 săptămână** | **Email** | Emailurile eșuate (>3 încercări) rămân `status='failed'` (dead-letter). Restul continuă. Impact: rapoarte / win-back / NPS netrimise punctual. | ⚠️ Degradare non-distructivă |
| | **Oblio** | Facturile care eșuează de 3× rămân blocate în coadă (`invoices` failed). Token-ul Oblio per-restaurant poate expira → backlog de facturi neemise. | ⚠️ Degradare — conformitate întârziată |
| | **Health scores** | Se recalculează la 30 min automat. Dacă `SLACK_WEBHOOK_URL` lipsește, alertele nu pleacă → scoruri „învechite" ca semnal, dar datele sunt corecte. | ⚠️ Degradare — pierzi vizibilitate churn |
| | **Stripe** | Webhook-urile se procesează în timp real; la eroare Stripe **reîncearcă automat** (până la ~3 zile). Rândurile rămân `failed` în `stripe_events` până reușesc. | ✅ Auto-recovery |
| **~30 zile** | **Payout afiliați** | Cron-ul creează **doar draft-uri** de payout (nu mișcă bani). Emiterea facturii afiliatului + transferul Wise sunt **manuale**. 30 zile fără tine = afiliați neplătiți. | 🔴 CRITIC — necesită acțiune umană |
| | **Ștergeri GDPR** | `process_account_deletions` rulează zilnic 03:30. Dacă cron-ul e oprit (build stricat, cont Netlify suspendat) → ștergeri restante = **risc de conformitate**. | 🔴 CRITIC — legal |
| | **Facturi Oblio** | Backlog acumulat + token expirat = facturi fiscale neemise la termen. | 🔴 CRITIC — fiscal |
| | **Email dead-letter** | Coada de `failed` crește; niciun mecanism auto nu le reia (necesită UPDATE manual). | 🔴 Acumulare |

**Concluzie:** poți lipsi liniștit **1–5 zile**. Peste ~1 săptămână, un delegat trebuie
să verifice `/health` + draft-urile de payout. Peste ~30 zile fără nimeni = risc fiscal/legal.

---

## 2. Joburi automate (schedule real din `netlify.toml`)

Toate joburile sunt **idempotente** (dedup pe cheie / claim atomic / `ON CONFLICT`).
Un tick ratat de Netlify nu produce dubluri și, în general, se recuperează la următorul tick.

| Job (funcție) | Schedule (cron) | Idempotent? | Catch-up? | Dacă lipsește un tick |
|---|---|---|---|---|
| `process-email-queue` | `*/5 * * * *` | ✅ (`claim_email_batch`, `FOR UPDATE SKIP LOCKED`) | ✅ (reia `queued`, backoff 10min×n) | Emailuri întârziate max 5 min; se reiau |
| `automation-cron` → lifecycle | `*/15 * * * *` (fiecare tick) | ✅ (`process_lifecycle_events`, `process_attempts<3`) | ✅ | Lifecycle events întârziate 15 min |
| `automation-cron` → health scores | la `HH:00` și `HH:30` | ✅ (`compute_health_scores`) | ✅ (recalcul complet la 30 min) | Scoruri vechi 30 min |
| `automation-cron` → sessions expire | orar (`minute<15`) | ✅ (`expire_inactive_sessions`, 3h) | ✅ | Mese QR blocate mai mult |
| `automation-cron` → rate-limit cleanup | zilnic `03:15` | ✅ (`cleanup_old_rate_limits`) | ⚠️ se reia a doua zi | Tabel rate-limits crește o zi |
| `automation-cron` → **GDPR deletions** | zilnic `03:30` | ✅ (`process_account_deletions`, batch 100) | ⚠️ se reia a doua zi | 🔴 Ștergeri restante (vezi §1) |
| `automation-cron` → **payout batch** | zile `1–2`, `hour<6` (fereastră largă) | ✅ (existence-check pe `period_month` + `ON CONFLICT`) | ✅ (fereastră de 2 zile) | Dacă tot ratează → **draft-uri necreate** luna asta |
| `automation-cron` → winback | zilnic `09:00` Buc | ✅ (`dedup_key` lunar) | ⚠️ o zi | Emailuri winback ratate ziua aia |
| `automation-cron` → NPS | zilnic `10:00` Buc | ✅ (`dedup_key` lifetime) | ⚠️ o zi | NPS ratat ziua aia (dar dedup lifetime → nu se pierde userul) |
| `automation-cron` → daily report | zilnic `08:00` Buc | ✅ (`dedup_key` = ziua) | ⚠️ o zi | Raport zilnic ratat |
| `automation-cron` → weekly report | Vineri `18:00` | ✅ (`dedup_key` = data) | ⚠️ o săptămână | Raport săptămânal ratat |
| `oblio-generator` | `*/15 * * * *` (regim de avarie aug 2026; era `*/2`) | ✅ (`bridge_oblio_get_queued` claim + retry ≤3) | ✅ | Facturi întârziate max 15 min |
| `send-reservation-reminders` | `*/30 * * * *` (regim de avarie; era `*/10`) | ✅ (claim + enqueue în `email_queue`) | ✅ | Reminder întârziat max 30 min |
| `send-health-slack-alerts` | `5,35 * * * *` (scorurile se calculează doar la :00/:30) | ✅ (`claim_pending_slack_alerts`, re-alert după 24h) | ✅ (reset pe POST eșuat) | Alertă Slack întârziată 30 min |
| `process-sms-queue` | `*/15 * * * *` (regim de avarie; la primul client SMS → `* * * * *`) | ✅ (claim atomic; SMSO fără Idempotency-Key → dublu-send rezidual) | ✅ | SMS întârziat max 15 min |

> **Sursa unică a schedule-urilor e `netlify.toml`** (o citește și shim-ul VPS).
> Tabelul de mai sus se actualizează în ACELAȘI commit cu orice schimbare acolo —
> un runbook care minte pe cron-uri se citește exact în timpul incidentului.

> **Notă catch-up payout:** fereastra largă (zilele 1–2 ale lunii, înainte de 06:00) +
> `existence-check` pe `period_month` garantează că batch-ul rulează o **singură** dată
> pe lună, dar tolerează ticks ratate. Dacă Netlify e down toată fereastra → §3.1.

---

## 3. Playbook de recovery (comenzi concrete)

> Rulează din **Supabase → SQL Editor** (rol `postgres`/service, bypass RLS).
> Verifică de **două ori** că ești pe proiectul **prod**, nu staging.

### 3.1 Payout afiliați ratat

Cron-ul creează **doar draft-uri** (nu mișcă bani). Semnătură reală (mig 107):

```sql
-- run_affiliate_payout_batch(p_period_month date, p_min_cents bigint default 5000)
-- period_month TREBUIE să fie prima zi a lunii; min = 5000 cents (50 RON/EUR) prag payout.
-- Buclează peste RON și EUR per afiliat, ON CONFLICT (affiliate_id, period_month, currency).

select public.run_affiliate_payout_batch('2026-07-01', 5000);
-- → { "ok": true, "created": N, "skipped": M, "period": "2026-07-01" }
```

Idempotent: re-rularea cu aceeași lună **nu** dublează draft-uri. Verifică rezultatul:

```sql
select affiliate_id, period_month, currency, gross_cents, status
from public.affiliate_payouts
where period_month = '2026-07-01'
order by created_at desc;
```

**⚠️ Transferul efectiv e MANUAL** (nu există automatizare Wise în cod). Fluxul de stări:
`draft → awaiting_invoice → invoice_matched → processing (wise_transfer_id setat) → paid`.
Tranzițiile sunt gate-uite de trigger (nu poți sări stări; nu poți reveni sub `processing`
odată ce există `wise_transfer_id`). Emiterea facturii afiliatului + transferul Wise le faci
manual, apoi actualizezi statusul. **Nu forța `session_replication_role`.**

### 3.2 Email dead-letter (reia emailurile eșuate)

Un email trece `status='failed'` după 3 încercări (`failed_attempts >= 3`). Pentru a-l relua,
resetează contorul și repune-l în coadă — worker-ul de la `*/5` îl reia:

```sql
-- Inspectează întâi ce e blocat și de ce
select id, template_kind, recipient_email, failed_attempts, last_error, scheduled_for
from public.email_queue
where status = 'failed'
order by scheduled_for desc
limit 50;

-- Reia (ex. doar rapoartele, ultimele 3 zile). AJUSTEAZĂ filtrul înainte de a rula.
update public.email_queue
set status = 'queued',
    failed_attempts = 0,
    last_error = null,
    scheduled_for = now()
where status = 'failed'
  and template_kind in ('daily_report', 'weekly_report')
  and created_at > now() - interval '3 days';
```

> ⚠️ Nu reseta orbește TOATĂ coada `failed` dacă `last_error` arată `Unknown template`
> (bug de cod, nu tranzitoriu) — l-ai relua în același eșec. Rezolvă cauza întâi.

### 3.3 Reprocesare lifecycle events

Un event lifecycle e abandonat după 3 încercări (`process_attempts >= 3`). Semnătură reală
(mig 039): `process_lifecycle_events(p_batch_size int default 50)`.

```sql
-- Forțează o rulare imediată (fără să aștepți cron-ul de 15 min)
select public.process_lifecycle_events(1000);  -- batch mare pentru catch-up

-- Dacă vrei să RE-încerci events blocate pe attempts>=3 (după ce ai fixat cauza):
update public.lifecycle_events
set process_attempts = 0, process_error = null
where processed_at is null and process_attempts >= 3;
-- apoi rulează din nou process_lifecycle_events(1000);
```

### 3.4 Oblio backlog / token expirat

Facturile eșuează după 3 retry-uri (`bridge_oblio_mark_failed`). Cauze frecvente:
credențiale Oblio expirate/greșite (per-restaurant, stocate criptat în DB — **nu** în env),
sau `test_mode` greșit.

```sql
-- 1. Vezi ce e blocat și motivul
select id, order_id, status, retry_count, last_error, updated_at
from public.invoices
where status = 'failed'
order by updated_at desc
limit 50;
```

- Dacă `last_error` conține **401 / Unauthorized** → token/credențiale expirate.
  Restaurantul trebuie să-și reintroducă cheia Oblio din UI (se re-criptează). Funcția
  reface automat token-ul la următoarea rulare (cache-ul de token e per-invocare).
- După ce cauza e rezolvată, repune facturile în coadă pentru re-emitere:

```sql
-- Re-declanșează procesarea (oblio-generator rulează la */2 min și le va prelua)
update public.invoices
set status = 'queued', retry_count = 0, last_error = null
where status = 'failed'
  and last_error ilike '%401%';   -- filtrează la cazul confirmat
```

> 🔲 **De confirmat:** numele exact al coloanelor `retry_count` / `updated_at` din tabela
> `invoices` (verifică `migration_041_oblio_invoices.sql` înainte de UPDATE în prod).

### 3.5 Health scores învechite

Recalculul complet rulează la 30 min (`compute_health_scores`). Pentru un singur restaurant
(semnătură reală, mig 040/178): `recompute_health_for_restaurant(p_restaurant_id uuid)`.

```sql
-- Recalcul global imediat (toate restaurantele)
select public.compute_health_scores();

-- Recalcul pentru un restaurant anume (cooldown pe recompute manual — mig 178)
select public.recompute_health_for_restaurant('00000000-0000-0000-0000-000000000000'::uuid);
```

Dacă alertele Slack nu pleacă deși scoruri critice există: verifică `SLACK_WEBHOOK_URL`
(§5). Fără el, `send-health-slack-alerts` face **exit silent 200 fără să atingă DB**
(design corect — nu marchează `slack_alerted_at` degeaba).

---

### 3.6 Recuperarea cotei TVA pentru liniile cu produs șters (o singură dată, după mig 272)

Mig 272 a pus pe fiecare linie de comandă grupa și cota TVA **de la vânzare**. Backfill-ul
ei a putut face asta doar pentru liniile care mai au un produs: cele al căror produs fusese
**șters înainte** de migrație au `product_id` NULL (FK `on delete set null`) și rămân fără
snapshot, deci raportul TVA le pune pe toate în **grupa 1**, la cota curentă a grupei 1.

Grupa lor e recuperabilă din jurnalul de audit: orice scriere pe `products` lasă
`old_data`/`new_data` complete (numele + `vat_group`). Potrivirea se face pe
(restaurant, `product_name_snapshot`) — `order_items` nu are rânduri de audit pentru ele,
deci numele de la vânzare e singura punte. Se citește **tot istoricul** numelui, nu doar
rândul de ștergere: un produs reclasificat înainte de a fi șters ar face ca ștergerea să
raporteze o grupă pe care vânzarea nu a avut-o.

Se rulează în **doi pași**: întâi previzualizarea (doar raportează, nu scrie nimic și nu ia
niciun lacăt de scriere), apoi aplicarea. Nu rula scriptul într-o sesiune interactivă cu
`begin` … `commit` ca să te uiți între timp: aplicarea ia `SHARE ROW EXCLUSIVE` pe
`order_items`, care blochează INSERT/UPDATE/DELETE, adică **crearea de comenzi pe toată
platforma**, cât timp tranzacția e deschisă.

```bash
cd <rădăcina repo-ului>

# 1. Previzualizare — comportamentul IMPLICIT. Câte linii s-ar recupera, câte sunt
#    ambigue, câte fără potrivire. Nu scrie nimic, nu blochează pe nimeni.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/recover_orphan_vat_snapshots.sql

# 2. Aplicare — trebuie cerută EXPLICIT. O singură tranzacție, COMMIT automat la
#    succes, ROLLBACK la eroare.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "set menuvia.recover_apply = 'on'" \
  -1 -f scripts/recover_orphan_vat_snapshots.sql
```

Cifrele din pasul 1 vin din exact aceeași logică ca scrierea din pasul 2 (nu dintr-un raport
scris separat, care ar putea diverge tăcut), iar pasul 2 verifică la final că a scris exact
câte linii anunțase — dacă nu, dă eroare și nu comite.

Steagul e **fail-closed**: fără el se previzualizează. Dacă îi greșești numele sau valoarea,
scriptul fie previzualizează, fie dă eroare — niciodată nu scrie „din greșeală". Postgres
acceptă tăcut orice `set prefix.nume`, deci un typo nu s-ar vedea altfel.

Scriptul raportează câte linii a recuperat, câte a **sărit ca ambigue** și câte au rămas
fără potrivire. Ambiguu = numele a purtat vreodată în acel restaurant grupe TVA diferite:
produse distincte cu același nume, același produs reclasificat înainte de ștergere, sau un
produs încă VIU care poartă azi acel nume cu altă grupă. În toate cazurile linia rămâne cum
e — într-un jurnal fiscal nu se ghicește. E idempotent: atinge doar liniile cu `vat_group_snapshot`
NULL, deci se poate rula din nou fără efect.

**Stare la 11 sept 2026 (înainte de rulare):** 16 din 53 de linii de comandă sunt orfane,
447,00 lei, toate pe comenzi `paid`, la un singur restaurant `enterprise` — deci intră în
raportul TVA. Una dintre potriviri („Vin pahar", 36,00 lei) era grupa **2**, raportată azi
ca grupa 1; restul chiar erau grupa 1.

Pentru comenzile de acum înainte problema nu mai există: trigger-ul din mig 272 scrie
snapshot-ul la inserarea liniei, deci ștergerea produsului nu mai pierde grupa.

---

## 4. Monitorizare

### 4.1 Endpoint `/health` ✅ (implementat — `netlify/functions/health.js`)

Expus la `/.netlify/functions/health` și rutat frumos la **`/health`** (redirect în
`netlify.toml`, înaintea catch-all-ului SPA).

```bash
curl -s https://menuvia.ro/health | jq
```

Răspunsul PUBLIC are EXACT trei chei — `status`, `checks`, `ts` — iar `checks` are ȘASE
sonde: `db`, `cron`, `storage`, `schema`, `queues`, `pgcron` (forma e înghețată de testul HL8;
orice câmp nou scurs public pică CI-ul):
- `200 { status:"ok", checks:{db:"ok", cron:"ok", storage:"ok", schema:"ok", queues:"ok", pgcron:"ok"}, ts }` — totul în parametri.
- `checks:{pgcron:…}` (mig 274, audit v3 RES-04/RES-09) — AL DOILEA planificator, cel din
  BAZĂ (pg_cron), care duce janitoarele fiscale (bonuri agățate în `sent`, facturi Oblio
  blocate în `generating`, tichete, sesiuni de masă, no-show, rate limits). E o sondă
  DIFERITĂ de `cron`, care măsoară planificatorul NETLIFY prin `customer_health_scores`
  (`compute_health_scores` rămâne deliberat pe Netlify ca dead-man's switch — mutat pe
  pg_cron, alarma ar deveni verde cu Netlify mort). Valori: `drift` (**503**: manifestul
  `public.pg_cron_janitor_manifest` nu coincide cu `cron.job` — job lipsă, dezactivat, orar
  sau comandă schimbate, job-stafie cu prefixul `menuvia_janitor_`), `stale` (**503**: ultima
  REUȘITĂ a unui job e mai veche decât `max_age_s`-ul lui, sau jobul n-a reușit niciodată de
  când e programat — singurul detector automat pentru „worker-ul pg_cron nu se conectează"),
  `failing` (200 + warning în health-watch: ultima rulare a eșuat, dar mai e o reușită în
  fereastră), `warming` (200: programat de curând, nicio reușită încă — normal în primele ore
  după mig 274), `absent` (200 + warning: extensia a DISPĂRUT deși migrația a instalat-o —
  re-activează pg_cron din Dashboard → Database → Extensions și re-aplică mig 274, e
  re-rulabilă), `unknown` (RPC neaplicat sau contract rupt; nu schimbă codul). Istoricul
  real: `select * from cron.job_run_details order by runid desc limit 50;`. Detaliul per job
  (`pgcron_detail`) cere token.
- `checks:{schema:"behind"}` cu **200** (mig 271, audit v3 RES-08) — repo-ul are migrații pe
  care ledger-ul producției NU le are („am reparat, dar nu apără"). Nu e 503 (deploy-ul
  înaintea migrației e un tranzit legitim), dar `health-watch.yml` pică ROȘU pe el la fiecare
  30 min până le aplici. Lista exactă: `curl -H x-health-diag … | jq .schema_detail`.
  Sonda compară NUMELE migrațiilor (manifestul `netlify/functions/schema-manifest.json`,
  regenerat cu `node scripts/gen-schema-manifest.mjs`; testul SM1 pică dacă adaugi o migrație
  fără să-l regenerezi) cu `supabase_migrations.schema_migrations.name` — NU `version`, care
  pe prod e timestamp-ul aplicării prin MCP.
- `503 ... checks:{queues:"stale"}` (mig 271, RES-32) — o coadă de PLATFORMĂ are muncă
  scadentă neridicată peste prag: email 30 min, SMS 60, facturi Oblio 60, remindere 120.
  Prinde și clasa „funcția rulează, întoarce 200 și nu face nimic" (cheie lipsă, PGRST202),
  pe care un heartbeat per job n-o vede. `queues:"warn"` cu **200** = bonuri/tichete
  `pending` >15 min la un restaurant (bridge-ul LUI e oprit — alarma per-tenant e bannerul
  mig 265, nu un 503 de platformă). `queue_detail` (numărători + vârste) cere token.
- `503 { status:"degraded", checks:{db:"down"}, ... }` — DB căzut **sau** env de bază lipsă.
- `503 ... checks:{cron:"stale"}` — automatizarea nu a mai rulat de >2h (incidentul 2–9 aug 2026).
- `503 ... checks:{storage:"critical"}` — baza e la ≥90% din plafon. La ≥80% e
  `storage:"warn"` cu **200** (preaviz, nu alertă). Când baza atinge plafonul,
  Postgres trece în READ-ONLY: nu se mai acceptă comenzi la NICIUN restaurant.
- `checks:{storage|schema|queues|pgcron:"unknown"}` — sonda nu a putut fi citită (RPC neaplicat,
  permisiune lipsă). NU influențează codul de status; dacă persistă cu `db:"ok"` DUPĂ ce
  migrația respectivă (266/271/274) e aplicată, sonda e MOARTĂ — `health-watch.yml` avertizează.
  `health-watch.yml` citește și raportează TOATE sondele ÎNAINTE de a ieși pe non-200 (altfel,
  pe un 503, semnalele per sondă ar fi îngropate sub „a întors 503" — cod mort până în sept 2026).

**Diagnosticul complet cere token.** `/health` e public, deci implicit întoarce DOAR
severitatea (public = severitate, cu token = cifre — audit v3 RES-38). Cu `HEALTH_DIAG_TOKEN`
setat, antetul `x-health-diag` adaugă `config`, `cron_last_run`, `storage_detail`,
`schema_detail`, `queue_detail` și `pgcron_detail`:

```bash
curl -s -H "x-health-diag: $HEALTH_DIAG_TOKEN" https://menuvia.ro/health | jq '{config, cron_last_run, storage_detail, schema_detail, queue_detail, pgcron_detail}'
# storage_detail: { bytes, pretty, limit_bytes, used_pct, top_tables: [primele 5] }
# schema_detail:  { expected_latest, db_latest, ledger_count, missing: [nume de migrații] }
# queue_detail:   { cron: { email|sms|invoices|reminders: {waiting, oldest_age_s}, slack_alerts: {waiting} },
#                   bridge: { receipts|tickets: {waiting, oldest_age_s} } }
# pgcron_detail:  { available, run_details_rows, unexpected: [stafii], jobs: [{ job_name, scheduled, active,
#                   schedule_ok, last_status, last_run_age_s, last_success_age_s, since_scheduled_s, max_age_s }] }
```

Fără token nu există NICIUN câmp de diagnostic (fail-closed, nici măcar `config`) — de aceea
se setează ÎNAINTE de incident, nu în timpul lui. Tokenul se trimite **numai prin antet**:
`?diag=<token>` e respins deliberat (CWE-598 — un secret în URL ajunge în logurile de
request, în configul monitorului și în istoricul de shell).

`config` = booleeni de **prezență** a secretelor (niciodată valori): `resend`, `slack`,
`stripe`, `ai_platform`. Dacă un secret a fost revocat/lipsește, îl vezi `false` aici — util
pentru „de ce nu pleacă emailurile" fără să scurgi secrete. E sub token fiindcă starea
integrărilor (Resend/Slack morți) spune unui străin că nimeni nu va afla de un incident;
UptimeRobot Free nu trimite antete custom, deci alerta pe `config.*` se face din
`health-watch.yml` (cu secret) sau manual.

### 4.2 Alerte Slack ✅

- `SLACK_WEBHOOK_URL` setat → `send-health-slack-alerts` postează restaurantele critice
  (Block Kit, re-alert după 24h) + `automation-cron` postează 🔴 la eșec de sub-job și
  🟡 la semnale de acțiune (ex. draft-uri payout create).
- Fără webhook → **no-op silent** peste tot (nu crapă nimic, dar **ești orb**).

### 4.3 Uptime monitor extern (recomandare) 🔲

Endpoint-ul `/health` e un **dead-man's-switch**: valorează doar dacă cineva îl lovește
din exterior. Founderul trebuie să configureze un monitor extern:

- **UptimeRobot / BetterStack / Pingdom** → GET `https://menuvia.ro/health` la 1–5 min.
- Alertă pe **status ≠ 200** (prinde `503 degraded`) **și** pe timeout.
- Ideal: parsează JSON și alertează dacă vreun `config.*` devine `false` neașteptat.
- Canal de alertă **independent de Slack** (SMS / email / push) — dacă pică infra, Slack
  s-ar putea să nu ajungă.

---

## 5. Env vars critice — checklist

Setate în **Netlify → Site settings → Environment variables** (per context: production /
staging). Prod și staging au proiecte Supabase **separate** — nu le amesteca.

| Env var | Folosit de | Ce se rupe dacă lipsește |
|---|---|---|
| `SUPABASE_URL` (`VITE_SUPABASE_URL` fallback) | Toate funcțiile | 🔴 Total: funcțiile întorc 500 „Missing env" |
| `SUPABASE_SERVICE_ROLE_KEY` | Toate funcțiile | 🔴 Total: idem |
| `RESEND_API_KEY` | `process-email-queue` | ⚠️ **Silent**: funcția întoarce 200 „No Resend key; skipped" — **niciun email nu pleacă**, coada crește. `/health` → `config.resend:false`. |
| `SLACK_WEBHOOK_URL` | health-alerts, automation-cron | ⚠️ **Silent**: nicio alertă (health, cron fail). Ești orb. `config.slack:false`. |
| `STRIPE_SECRET_KEY` | stripe-webhook, checkout | 🔴 Webhook 500 → Stripe reîncearcă; plăți/upgrade blocate. |
| `STRIPE_WEBHOOK_SECRET` | stripe-webhook | 🔴 Semnătura eșuează (400) → **toate** webhook-urile respinse. |
| `STRIPE_STARTER_PRICE_ID` / `_GROWTH_` / `_PRO_` / `_ENTERPRISE_PRICE_ID` | stripe-webhook | 🔴 **Fail-fast** (500): fără ele, mapping plan ar downgrada tăcut abonamente plătite. Cerute explicit. |
| `PLATFORM_OPENAI_KEY` **sau** `PLATFORM_ANTHROPIC_KEY` | ai-proxy, ai-generate | ⚠️ Feature-urile AzoAI (import/generare) nu merg. `config.ai_platform:false`. |
| `OBLIO_*` | — | ℹ️ **NU în env**: credențialele Oblio sunt **per-restaurant**, stocate criptat în DB. Nu există env global Oblio. |
| `AI_CONFIG_SECRET` | ai-config | 🔴 Cheia AES-256-GCM pentru credențialele AI per-restaurant. Lipsă/`<32` chars → `ai-config` 500; fără ea **nu se pot cripta/decripta** cheile AI salvate. |
| `EMAIL_FROM` / `EMAIL_REPLY_TO` / `APP_URL` | process-email-queue | ℹ️ Au fallback-uri (`hello@menuvia.ro`, `radu@menuvia.ro`, URL). Nu crapă, dar verifică-le pe prod. |

**Test rapid post-deploy:** `curl -s -H "x-health-diag: $HEALTH_DIAG_TOKEN" https://menuvia.ro/health | jq .config` — toți booleenii
critici trebuie `true` pe production.

---

## 6. Backup & Disaster Recovery

### Ce știm (implementat) ✅
- **Supabase managed backups**: Postgres gestionat de Supabase are backup-uri automate
  (PITR / daily) în funcție de planul proiectului. Verifică nivelul real în
  **Supabase → Database → Backups**.
- **Idempotență ca DR aplicativ**: cozile + `stripe_events` (dedup pe `event_id`) fac ca o
  re-procesare / re-rulare de cron după un incident să **nu** dubleze efecte.
- **Stripe ca sursă de adevăr financiar**: chiar dacă pierzi stări locale de abonament,
  Stripe reemite webhook-urile; planul se poate reconstitui din `price.id` facturat.

### RPO / RTO (de confirmat pe planul curent Supabase) 🔲
| Metric | Valoare | Notă |
|---|---|---|
| **RPO** (cât date poți pierde) | 🔲 depinde de plan | PITR (dacă activ) → secunde/minute; daily-only → până la 24h |
| **RTO** (cât durează restore) | 🔲 depinde de plan | Restore Supabase → minute–ore; confirmă în consolă |

### 6.1 Ce cară și ce NU cară un dump (măsurat pe replay la mig 273, nu presupus)

| Artefact | `--schema-only` | `--data-only` | `pg_dumpall --roles-only` |
|---|---|---|---|
| GRANT / REVOKE pe obiecte | 340 / 230 | 0 / 0 | — |
| CREATE POLICY | 114 | 0 | — |
| ENABLE ROW LEVEL SECURITY | 76 | 0 | — |
| ALTER DEFAULT PRIVILEGES | 2 | 0 | — |
| OWNER TO | 407 | 0 | — |
| CREATE TRIGGER | 84 | 0 | — |
| setval pe secvențe | 0 | 1 (`audit_log_id_seq`) | — |
| **CREATE/ALTER ROLE (inclusiv `service_role` BYPASSRLS)** | **0** | **0** | da |

Trei concluzii care contrazic intuiția:

1. **Un `pg_dump` NORMAL cară regimul de privilegii.** Restaurat într-o bază goală, RW1 și
   G1–G5 trec și `security_invoker` supraviețuiește. Regimul se pierde din **FLAGS**, nu
   din dump/restore.
2. **Defectul era în comenzile NOASTRE (audit v3 RES-07).** Ambele scripturi de backup ale
   repo-ului treceau `--no-privileges` (iar `deploy/backup-db.sh` și `--schema=public`).
   Restaurat din acel artefact: 114 politici și RLS pe toate tabelele intacte, dar 0 GRANT
   și 0 REVOKE → `proacl` devine NULL, EXECUTE-ul implicit al lui PUBLIC revine, și **anon
   poate apela `accept_invite`, `change_restaurant_slug`, `build_fiscalnet_payload`**.
   Simultan, `authenticated` pierde SELECT pe `restaurants`, deci aplicația e moartă la
   primul login: o cădere ZGOMOTOASĂ peste o escaladare TĂCUTĂ la nivel de funcție.
   Flag-urile sunt scoase; dacă folosești un backup mai VECHI, presupune că e golit și
   lasă replay-ul lanțului să refacă ACL-urile. `--no-owner` e un NO-OP măsurat pe `-Fc`.
   `--schema=public` lăsa `auth.users` GOL, iar `profiles.id` și
   `restaurant_memberships.user_id` sunt FK `ON DELETE CASCADE` către el → fiecare profil
   și fiecare membership respins la restore, restaurantele orfane.
3. **Ce NU se poate restaura din NICIUN dump** — verifică manual:
   - **Rolurile** (`anon`/`authenticated`/`service_role`) și atributele lor, inclusiv
     `service_role BYPASSRLS`. Pe un proiect Supabase nou vin cu proiectul; RP1 le verifică.
   - **Event trigger-ul `ensure_rls` + `public.rls_auto_enable()`**: obiect de PLATFORMĂ,
     NU e în lanț, NU e în repo, NU e membru de extensie. Dacă proiectul nou nu îl are,
     RLS-ul nu se mai pornește automat pe tabele NOI și **nu poate fi recreat de operator**
     (`CREATE EVENT TRIGGER` cere superuser, iar `postgres` pe prod are `rolsuper=false`) →
     tichet la Supabase.
   - **Default-ACL-urile cu grantor `supabase_admin`** (pe prod dau `anon` arwdDxtm pe
     tabelele viitoare). Cele ale APLICAȚIEI (grantor `postgres`, mig 047) se refac din
     replay și sunt verificate de RP8; backstop-ul pentru cele de platformă e RP2 (RLS pe
     fiecare tabel).
   - **pg_cron** (mig 274): extensia se instalează la replay-ul lanțului, iar joburile
     se programează din manifest; `cron.job_run_details` (istoricul) nu se restaurează —
     nici nu trebuie. După restore, `/health` → `checks.pgcron` trece prin `warming`
     până la primele reușite.

### 6.2 Procedura de restore (proiect Supabase nou)

Forma e **replay al lanțului → `--data-only` → poartă**, NU `pg_restore` al unui dump
complet. Motivele sunt concrete: ACL-urile vin din **migrații revizuite**, nu din starea în
care a driftat prod; și e singurul mod în care moștenești jumătatea de PLATFORMĂ a
regimului (§6.1 punctul 3), pe care un `pg_restore` al unui dump complet o pierde definitiv.

```bash
export NEW_DB_URL="postgresql://postgres:...@db.<proj>.supabase.co:5432/postgres"
cd /path/to/menuvia-cloud        # checkout la COMITUL lanțului din dump
```

1. **Proiect nou**, aceeași regiune. Notează noile `SUPABASE_URL` / chei. NU re-pointa
   încă env-ul.
2. **Replay-ul lanțului cu `psql`, nu cu runner-ul CLI** (mig 120/121 au meta-comenzi
   `\set` pe care CLI-ul nu le știe — de asta și CI-ul folosește psql):
   ```bash
   for m in $(ls supabase/migrations/*.sql | sort -V); do
     psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 -f "$m" || { echo "PICAT: $m"; exit 1; }
   done
   ```
   **Dacă o migrație pică pe o asserție de PRIVILEGII** (default-uri mai largi pe un proiect
   proaspăt decât pe prod), aplică pre-curățarea — aceeași ca bootstrap-ul din `ci.yml` —
   și reia de la migrația care a picat:
   ```sql
   alter default privileges for role postgres in schema public
     revoke insert, update, delete, references, truncate, trigger on tables from service_role;
   alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
   alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
   ```
   Mig 047 reacordă mai târziu, explicit, ce trebuie (RP8 verifică starea finală).
   NEVERIFICAT dacă un proiect hosted nou are nevoie de pasul ăsta — de asta e
   condiționat, nu obligatoriu.
3. **Golește rândurile semănate de LANȚ**, ÎNAINTE de COPY. Un COPY din pg_dump care
   lovește o cheie duplicată **abandonează TOT tabelul**, deci baza ar păstra TĂCUT
   valorile migrației:
   ```sql
   truncate public.plan_features, public.plan_limits,
            public.platform_settings, public.gdpr_deletion_config,
            public.pg_cron_janitor_manifest;
   delete from storage.buckets;   -- sau exclude schema storage din dump-ul de date
   ```
   Contează pentru `platform_settings`: default-urile de comision al afiliaților
   (mig 188/099) se citesc LIVE și sunt editabile de fondator. Azi e latent
   (`plan_features` e byte-identic prod vs. replay), dar prima editare s-ar pierde.
   `pg_cron_janitor_manifest` se re-populează cu `select public.pg_cron_apply_manifest();`
   după încărcare (sau re-aplicând mig 274, care e re-rulabilă).
4. **Dezactivează triggerele NE-INTERNE, PE NUME**, într-un bloc care reactivează pe
   calea de EROARE (aceeași disciplină ca `scripts/recover_orphan_vat_snapshots.sql`, și
   pentru același motiv măsurat: 84 din 89 lăsate stinse e invizibil). `--disable-triggers`
   și `session_replication_role='replica'` sunt INDISPONIBILE pe Supabase gestionat: ambele
   cer superuser (`DISABLE TRIGGER ALL` → „permission denied: RI_ConstraintTrigger… is a
   system trigger"; GUC-ul are context `superuser`). Un PROPRIETAR de tabel ne-superuser
   POATE dezactiva triggere NUMITE, inclusiv constraint triggers (verificat pe replay).
   ```bash
   psql "$NEW_DB_URL" -tA -c "
     select format('alter table %I.%I disable trigger %I;', n.nspname, c.relname, t.tgname)
       from pg_trigger t join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where not t.tgisinternal order by 1;" > /tmp/disable.sql
   sed 's/ disable trigger / enable trigger /' /tmp/disable.sql > /tmp/enable.sql
   psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 -f /tmp/disable.sql
   ```
   Lista **trebuie** să includă `on_auth_user_created` (altfel `handle_new_user` fabrică
   profile la încărcarea `auth.users`, COPY-ul real pe `profiles` avortează pe cheie
   duplicată și TOATE planurile rămân `free` — măsurat) și triggerele **`audit_*`**
   (altfel COPY-ul pe `audit_log` avortează și jurnalul FISCAL se termină cu rândurile
   care descriu restore-ul, în locul celor reale).
5. **`auth.users` ÎNAINTE de `public`**: `profiles.id` și `restaurant_memberships.user_id`
   sunt FK `ON DELETE CASCADE` către `auth.users(id)`. Un dump `--data-only` pe toată baza
   le ordonează singur; dacă restaurezi selectiv, `auth` primul.
6. **Încarcă datele cu `ON_ERROR_STOP`**: `psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 -f data_only.sql`.
   Fără el psql iese **0** peste COPY-uri avortate (măsurat: 19) și rămâi cu
   `restaurants=0 / orders=0` pe o bază „restaurată".
7. **REACTIVEAZĂ triggerele**: `psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 -f /tmp/enable.sql`.
   Nu te baza pe memorie — pasul 9 (RP7) verifică.
8. **Paritate de DATE** (poarta verifică regimul, nu datele): numără
   `restaurants / orders / order_items / profiles / restaurant_memberships / audit_log /
   pending_receipts` și **distribuția planurilor** (`select plan, count(*) from
   public.profiles group by 1`) — `free` peste tot e semnătura încărcării cu triggerele
   pornite. Secvențe: `public` are EXACT una și `--data-only` cară `setval`-ul; confirmă cu
   `select last_value >= (select max(id) from public.audit_log) from public.audit_log_id_seq;`
   Invariant pe care un restore îl lasă LATENT rupt (`restaurants.owner_id` NU are FK către
   `auth.users`, iar `trg_enforce_owner_membership_invariant` e constraint trigger — se
   declanșează DOAR la mutație):
   ```sql
   select r.id, r.slug from public.restaurants r
    where (select count(*) from public.restaurant_memberships m
            where m.restaurant_id = r.id and m.role = 'owner'
              and m.user_id = r.owner_id) <> 1;   -- TREBUIE 0 rânduri
   ```
9. **POARTA (§6.3) — obligatorie, blocantă.** Abia dacă iese 0, re-pointează env-ul.
10. **Re-pointare + verificări externe**: `SUPABASE_URL` / chei / `DB_URL` în Netlify sau
    `/etc/menuvia/env` (VPS), endpoint-ul de webhook Stripe, apoi
    `curl -s -H "x-health-diag: $HEALTH_DIAG_TOKEN" .../health | jq` — `checks.schema`
    trebuie `ok`, nu `behind`; `checks.pgcron` trece de la `warming` la `ok` după primele
    reușite. Dacă poarta arată că `rls_auto_enable()` lipsește, deschide tichet la Supabase
    (§6.1 punctul 3).

### 6.3 Poarta de verificare (go/no-go)

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/privilege_regime_assertions.sql
echo "exit=$?"     # 0 = GO. Orice altceva = NO-GO.
```

100% READ-ONLY (catalog + `set role` + SELECT), rulabilă pe producție în paralel cu trafic,
și rulează NECONDIȚIONAT în CI la fiecare replay — deci nu se poate învechi fără să facă
build-ul roșu. Rulează-o ca owner-ul bazei (pe Supabase: `postgres`, care e membru în
anon/authenticated/service_role): RP1 e FAIL-CLOSED dacă nu poate lua rolurile, fiindcă
atunci nu poate verifica RLS-ul. Dacă pică pe RP3 („ancoră anti-vacuitate"), backup-ul era
golit de `--no-privileges` — reia de la pasul 2 cu un artefact corect; NU „repara" acordând
privilegii larg. RP12 cere rânduri în `restaurants` — pe un restore `--schema-only` pică
zgomotos, corect: regimul RLS nu se poate dovedi fără date.

### 6.4 Ce NU e automatizat, deliberat 🔲
- **RES-06 rămâne deschis, decizie de fondator**: azi nu există niciun backup funcțional
  (`db-backup.yml` e inert fără secrets, Supabase Free). Secțiunea asta face procedura
  CORECTĂ și DOVEDITĂ pentru momentul în care armezi backup-urile — nu înlocuiește armarea.
- **Export extern periodic + PITR ON**: rămân recomandări (protejează contra pierderii
  CONTULUI Supabase, nu doar a datelor).
- **Test de restore programat**: cere un al doilea proiect Supabase (cost). Până atunci,
  poarta §6.3 e ce transformă un restore manual dintr-o speranță într-o verificare.

---

## 7. Protocol de absență — checklist înainte de o absență lungă

Rulează **înainte** de a pleca (>1 săptămână). Durează ~15 min.

- [ ] **`/health` verde**: `curl -s -H "x-health-diag: $HEALTH_DIAG_TOKEN" https://menuvia.ro/health | jq`
      → `status:"ok"`, toți `config.*` critici `true` (fără antet corpul PUBLIC e doar
      `{status, checks, ts}` — `config` nu apare, deci comanda n-ar verifica nimic).
- [ ] **Uptime monitor extern activ** (§4.3), cu alertă pe SMS/email — **nu doar Slack**.
- [ ] **Coada email curată**: `select status, count(*) from public.email_queue group by 1;`
      — dacă `failed` e mare, rezolvă înainte (§3.2).
- [ ] **Oblio backlog gol**: `select count(*) from public.invoices where status='failed';`
      — dacă >0, rezolvă token/credențiale (§3.4).
- [ ] **Draft-uri payout**: dacă absența acoperă **ziua 1–2 a lunii**, deleagă rularea
      manuală a payout-ului (§3.1) **și** emiterea facturilor/transferurilor Wise, sau
      procesează-le înainte de plecare. Cron-ul creează doar draft-uri — restul e manual.
- [ ] **GDPR deletions rulează**: verifică în logs Netlify că `automation-cron` a rulat
      job-ul de 03:30 recent (ștergeri restante = risc legal).
- [ ] **Env vars intacte**: niciun secret pe cale de expirare (chei API Resend/Stripe/AI).
- [ ] **Deploy stabil**: fără build eșuat pe `main` (un build stricat = **toate** cron-urile
      moarte). Verifică ultimul deploy Netlify e verde.
- [ ] **Backup confirmat**: ultimul backup Supabase e recent; PITR ON pe prod (§6).
- [ ] **Delegat briefat**: cineva de încredere are acces la Supabase + Netlify + Stripe și
      a citit §3 (recovery) și §4 (monitorizare).

---

### Referințe cod (sursa de adevăr)
- Cron schedules: `netlify.toml`
- Funcții: `netlify/functions/{automation-cron,process-email-queue,oblio-generator,send-health-slack-alerts,stripe-webhook,health}.js`
- RPC payout: `supabase/migrations/…_migration_107_affiliate_payout_multicurrency.sql` (și 098/106)
- RPC lifecycle: `…_migration_039_automation.sql`
- RPC health: `…_migration_040_health_ui.sql`, `…_migration_178_health_manual_recompute_cooldown.sql`
- Email queue claim: `…_migration_162_email_queue_atomic_claim.sql`, `…_migration_167_email_queue_reclaim_stale.sql`
- GDPR: `…_migration_042_gdpr_rpcs.sql`, `…_migration_055_fix_user_delete_cascade.sql`
- Oblio: `…_migration_041_oblio_invoices.sql`

---

## ⚠️ Incident 2–9 august 2026: cron mort 7 zile, nesesizat

**Ce s-a întâmplat.** `automation-cron` a încetat să ruleze pe **2 august, 19:30 UTC**
(ultima scriere în `customer_health_scores`, job care rulează la 30 de minute).
Descoperit abia pe 9 august, prin interogarea directă a bazei de producție.

**Ce a fost mort 7 zile** — toate joburile programate: procesarea cozii de
emailuri, coada SMS, generarea facturilor Oblio, reminderele de rezervare,
marcarea no-show, evenimentele de lifecycle (dunning), alertele Slack.

**De ce nimeni n-a aflat — cauza structurală.** Singurul watchdog
(`send-health-slack-alerts`) e EL ÎNSUȘI o funcție programată: o cădere de cron
îl omoară exact pe el. **Monitorul trăia în interiorul lucrului monitorizat.**
Secundar: `SLACK_WEBHOOK_URL` probabil nesetat, deci canalul de alertă era oricum mut.

**Impact real:** zero (0 clienți, 0 comenzi în 30 de zile). **Impact dacă
exista un client:** facturile lui fiscale nu s-ar fi generat, tăcut.

**Diagnostic (verificat):** RPC-ul `compute_health_scores()` chemat direct pe
prod funcționează perfect (5 rânduri) → **nu e problemă de DB, ci de execuție a
cron-ului Netlify** (cont Free). Cauza exactă pe partea Netlify NU a fost
determinată din afară — de verificat în dashboard.

**Fix aplicat în cod.** `/health` verifică acum ȘI prospețimea cron-ului
(`cron: ok | stale | unknown`, prag 2h) și întoarce **503** când e `stale`.
Un monitor extern (UptimeRobot) care lovește `/health` prinde de acum automat
o cădere de cron — monitorizare din AFARĂ, nu dinăuntru.

### Ce trebuie făcut manual (fondator)

1. **Netlify → Functions → Logs** pe `automation-cron`: vezi de ce s-a oprit
   (limită de plan Free? eroare la boot? funcție dezactivată?).
2. Dacă e limită de invocări: cron-urile consumă ~50k invocări/lună la trafic
   zero (vezi GO_LIVE Faza 4) → fie plan plătit, fie mutarea cron-urilor pe
   VPS-ul din `deploy/` (shim-ul e gata), fie rărirea lor.
3. **UptimeRobot** (gratuit, 5 min) pe `https://<domeniu>/health` — de acum
   alertează și la cron mort, nu doar la DB căzut.
4. `SLACK_WEBHOOK_URL` în env — al doilea canal de alertă.
5. Verifică `lifecycle_events`: 3 evenimente din **iunie** sunt încă
   neprocesate (`processed_at is null`) — breșă separată, mai veche decât
   incidentul de cron.
