-- ═══════════════════════════════════════════════════════════════════
-- Migration 230: payment_method += 'meal_voucher' (tichete de masă, E4b)
-- ─────────────────────────────────────────────────────────────────────
-- FIȘIER SEPARAT intenționat, FĂRĂ begin/commit: o valoare nouă de enum
-- nu poate fi FOLOSITĂ în aceeași tranzacție în care a fost adăugată
-- (restricție Postgres — același pattern ca mig 202/card_online).
-- Tot ce o folosește stă în mig 231.
--
-- Tichetele de masă (Edenred/Sodexo/Up) sunt o metodă de plată înregistrată
-- de STAFF la masă (spre deosebire de card_online, care vine doar prin
-- Stripe/settle). Pe bonul fiscal se mapează la codul FiscalNet 4
-- („tichet masă" — tabelul P din docs/BRIDGE_FISCALNET_ARCHITECTURE.md §3).
-- ═══════════════════════════════════════════════════════════════════

alter type public.payment_method add value if not exists 'meal_voucher';

comment on type public.payment_method is
  $$Metode de plată pe comandă. 'card_online' = plata din telefon (Stripe,
mig 202/203). 'meal_voucher' = tichete de masă înregistrate de staff
(mig 230/231) — pe bon se mapează prin fiscalnet_payment_code() (cod 4).$$;
