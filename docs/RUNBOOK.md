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

## 4. Monitorizare

### 4.1 Endpoint `/health` ✅ (implementat — `netlify/functions/health.js`)

Expus la `/.netlify/functions/health` și rutat frumos la **`/health`** (redirect în
`netlify.toml`, înaintea catch-all-ului SPA).

```bash
curl -s https://menuvia.ro/health | jq
```

Răspuns (`checks` are TREI sonde: `db`, `cron`, `storage`):
- `200 { status:"ok", checks:{db:"ok", cron:"ok", storage:"ok"}, config, ts }` — totul în parametri.
- `503 { status:"degraded", checks:{db:"down"}, ... }` — DB căzut **sau** env de bază lipsă.
- `503 ... checks:{cron:"stale"}` — automatizarea nu a mai rulat de >2h (incidentul 2–9 aug 2026).
- `503 ... checks:{storage:"critical"}` — baza e la ≥90% din plafon. La ≥80% e
  `storage:"warn"` cu **200** (preaviz, nu alertă). Când baza atinge plafonul,
  Postgres trece în READ-ONLY: nu se mai acceptă comenzi la NICIUN restaurant.
- `checks:{storage:"unknown"}` — sonda nu a putut fi citită (RPC neaplicat, permisiune
  lipsă). NU influențează codul de status; dacă persistă cu `db:"ok"`, alarma de
  stocare e MOARTĂ — vezi `get_database_size()` (mig 266).

**Diagnosticul de stocare cere token.** `/health` e public, deci implicit întoarce
doar severitatea. Cu `HEALTH_DIAG_TOKEN` setat:

```bash
curl -s -H "x-health-diag: $HEALTH_DIAG_TOKEN" https://menuvia.ro/health | jq .storage_detail
# { bytes, pretty, limit_bytes, used_pct, top_tables: [primele 5, descrescător] }
```

Fără token nu există `storage_detail` deloc (fail-closed) — de aceea se setează
ÎNAINTE de incident, nu în timpul lui. Tokenul se trimite **numai prin antet**:
`?diag=<token>` e respins deliberat (CWE-598 — un secret în URL ajunge în logurile
de request, în configul monitorului și în istoricul de shell).

`config` = booleeni de **prezență** a secretelor (niciodată valori):
`resend`, `slack`, `stripe`, `ai_platform`. Dacă un secret a fost revocat/lipsește, îl vezi
`false` aici — util pentru „de ce nu pleacă emailurile" fără să scurgi secrete.

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

**Test rapid post-deploy:** `curl -s https://menuvia.ro/health | jq .config` — toți booleenii
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

### Recomandări (TODO) 🔲
- **Export extern periodic** (independent de Supabase): `pg_dump` săptămânal (sau prin
  Supabase scheduled backup export) într-un storage separat (S3/GCS) — protejează împotriva
  pierderii **contului** Supabase, nu doar a datelor.
- **Verifică PITR e ON** pe proiectul de producție (nu doar daily).
- **Test de restore** cel puțin o dată: restaurează într-un proiect nou și confirmă că
  aplicația pornește. Un backup netestat nu e backup.
- **Runbook de restore** documentat separat (pași concreți de restore + re-pointare env).

---

## 7. Protocol de absență — checklist înainte de o absență lungă

Rulează **înainte** de a pleca (>1 săptămână). Durează ~15 min.

- [ ] **`/health` verde**: `curl -s https://menuvia.ro/health | jq` → `status:"ok"`,
      toți `config.*` critici `true`.
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
