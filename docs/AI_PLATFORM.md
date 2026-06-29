# Platforma AI (chatbot + import meniu + consum fondator)

Backend-ul AI a fost adăugat în migrațiile **168** + **169** și funcțiile
Netlify `ai-config`, `ai-proxy`, `ai-credits-checkout` (+ branch nou în
`stripe-webhook`). Acest document descrie configurarea operațională.

## Variabile de mediu (Netlify)

| Variabilă | Necesar pentru | Notă |
|---|---|---|
| `AI_CONFIG_SECRET` | `ai-config`, `ai-proxy` | Secret pentru criptarea AES-256-GCM a cheilor BYO. Generează cu `openssl rand -hex 32`. **Fără el, funcțiile întorc „Server config error".** |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | toate | deja setate |
| `STRIPE_SECRET_KEY` | `ai-credits-checkout` | deja setat |

> ⚠️ După adăugarea/schimbarea unei variabile de mediu, e necesar un **redeploy**
> ca funcțiile să o preia.

## Model BYO (Bring Your Own)

Fiecare restaurant își alege furnizorul și cheia în **Setări → Asistent AI**:
- `openai`, `anthropic`, `gemini`, sau `custom` (orice endpoint OpenAI-compatible).
- Cheia se trimite o singură dată (HTTPS), se criptează server-side cu
  `AI_CONFIG_SECRET` și se stochează DOAR ca ciphertext în
  `ai_provider_configs.api_key_encrypted` (ne-citibilă de client — revoke
  column-level în mig 168). Răspunsul către client întoarce doar o mască.

## Metering + cotă hibridă

- `ai_usage` — log per apel (tokens in/out, cost estimat, feature).
- `ai_quota` — cotă lunară inclusă (`included_tokens`, ajustabilă de fondator) +
  `credit_balance` (top-up cumpărat, nu expiră). Consum: întâi incluși, apoi credite.
- `ai_record_usage` scade cota DOAR la apeluri reușite.

## Top-up credite (Stripe)

- `ai-credits-checkout` creează un Checkout Session (plată unică, RON, `price_data`
  inline — nu sunt necesare price-uri Stripe noi).
- La plată, `stripe-webhook` (branch `checkout.session.completed`, mode=payment,
  metadata.type=`ai_credits`) apelează `ai_add_credits_for_event` — fulfilment
  **idempotent** per session Stripe (mig 169), anti dublu-credit la retry.

## Admin fondator

- `profiles.is_platform_admin` (seed pe georgeradu119@gmail.com).
- `admin_ai_overview()` + `admin_set_ai_limit()` gate-uite strict pe
  `is_platform_admin()`.
- UI: **Setări → Consum AI (fondator)**, vizibil doar pentru platform admin.
