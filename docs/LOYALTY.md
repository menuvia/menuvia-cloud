# Loyalty v1 — design (înainte de orice migrație)

> PLAN_10 F4 / MASTER_PLAN „URMEAZĂ" #3: „puncte per comandă + prag → recompensă;
> simplu, pe module". Modulul `loyalty` există deja în whitelist (mig 086) și în
> `ModuleKey` (frontend) — infrastructura de toggle e gratis.

## Problema care blochează implementarea directă: IDENTITATEA

Clienții QR sunt ANONIMI (fără cont, fără login). Punctele cer să recunoști
clientul între vizite. Opțiunile, cu trade-off-urile lor:

| Opțiune | Cum funcționează | Pro | Contra |
|---|---|---|---|
| **A. Telefon la comandă** | La checkout QR, câmp opțional „telefonul tău pentru puncte" → punctele se acumulează pe număr | Zero front nou; funcționează la orice masă/dispozitiv | Frecție la checkout; GDPR (numere de telefon = date personale → consimțământ + retenție); validare inexistentă (typo/număr străin) |
| **B. Card de puncte în browser** | ID anonim persistent în localStorage → „cardul tău digital" cu QR propriu, scanabil de ospătar la recompensă | Zero date personale; zero frecție | Se pierde la schimbarea telefonului/browserului; nu unifică vizitele de pe device-uri diferite |
| **C. Cont ușor (magic link)** | Client opt-in cu email → cont Supabase real | Robust, cross-device, deschide și marketing | Cea mai mare frecție; email la masă = drop-off mare |

**Recomandare v1: A + B hibrid** — punctele se scriu pe `loyalty_wallets`
(cheie: telefon normalizat SAU anon id din localStorage; telefonul „upgrade-ază"
wallet-ul anonim la prima introducere). GDPR: consimțământ explicit la câmpul de
telefon + ștergere în fluxul existent de GDPR (mig 042/179).

## Schema v1 (schiță — de validat la implementare)

- `loyalty_programs` (per restaurant, prin modul): `points_per_leu numeric`,
  `reward_threshold int`, `reward_description text`, `is_active`.
- `loyalty_wallets`: `restaurant_id`, `phone_hash text null`, `anon_id text null`,
  `points int`, constrângere: cel puțin una din chei; index unic per restaurant+cheie.
- `loyalty_events` (append-only): `wallet_id`, `order_id`, `delta int`, `kind
  ('earn'|'redeem')` — sursă de adevăr, points = agregat.
- Acumulare: trigger pe `orders` → tranziția `paid` (aceeași ca fiscal/receipt)
  adaugă `floor(total × points_per_leu)` dacă wallet-ul e legat de comandă.
  Legarea: `orders.loyalty_wallet_id` setat la create_order (parametru nou, opțional).
- Redeem: RPC staff-only (`redeem_loyalty_reward`) — scade pragul, loghează.
- Gates: modul `loyalty` (opt-in) + plan (propunere: growth+, NU cere Plan 3 —
  nu atinge bani/bon; de confirmat cu fondatorul dacă vrea să fie diferențiator
  de plan mai sus).

## De decis cu fondatorul înainte de implementare (2 întrebări)

1. **Identitate**: mergem pe hibridul A+B (telefon opțional + card anonim)?
2. **Plan minim**: loyalty de la Growth în sus, sau doar Pro/Enterprise?

## Ce NU intră în v1

Puncte pe produs specific, niveluri (bronze/silver/gold), expirare puncte,
cupoane procentuale — toate sunt v2+, schema de events le permite ulterior.
