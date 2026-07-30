-- ═══════════════════════════════════════════════════════════════════
-- Migration 202: payment_method += 'card_online' (plata online la masă)
-- ─────────────────────────────────────────────────────────────────────
-- FIȘIER SEPARAT intenționat, FĂRĂ begin/commit: o valoare nouă de enum
-- nu poate fi FOLOSITĂ în aceeași tranzacție în care a fost adăugată
-- (restricție Postgres). Tot ce o folosește stă în mig 203.
-- Design: docs/ONLINE_PAYMENT.md.
-- ═══════════════════════════════════════════════════════════════════

alter type public.payment_method add value if not exists 'card_online';

comment on type public.payment_method is
  $$Metode de plată pe comandă. 'card_online' = plata din telefon (Stripe,
mig 202/203) — pe bonul fiscal se mapează prin fiscalnet_payment_code().$$;
