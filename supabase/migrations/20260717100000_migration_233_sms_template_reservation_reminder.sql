-- mig 233 — enum sms_template_kind: + 'reservation_reminder'
-- ─────────────────────────────────────────────────────────────────────
-- Reminder-ele de rezervare (mig 057) merg azi DOAR pe email — dar
-- majoritatea rezervărilor telefonice n-au email, deci exact clienții cu
-- risc de no-show nu primesc nimic. Mig 234 lărgește claim-ul la telefon
-- mobil RO (prin coada SMS din mig 228); valoarea de enum de aici e
-- template-ul acelui SMS (corpul e în process-sms-queue.js).
--
-- ATENȚIE: fișier FĂRĂ begin/commit, intenționat (pattern mig 202/230):
-- ALTER TYPE ... ADD VALUE nu poate rula în aceeași tranzacție cu
-- utilizările valorii noi (mig 234). Asserția de conținut e în mig 234.

alter type public.sms_template_kind add value if not exists 'reservation_reminder';

comment on type public.sms_template_kind is
  'Template-uri SMS tranzacționale (mig 228; corpurile în process-sms-queue.js). reservation_confirmed = confirmare rezervare; pickup_ready = comanda gata; reservation_reminder (mig 233) = reminder pre-sosire, enqueue prin claim_reservation_reminders (lanț 057→234).';
