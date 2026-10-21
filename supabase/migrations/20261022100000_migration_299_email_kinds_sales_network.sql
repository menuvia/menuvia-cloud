-- Migration 299: email_template_kind += 9 tipuri pentru rețeaua de vânzări
--
-- Rețeaua de vânzări (șefi de vânzări = afiliați FĂRĂ părinte; agenți de
-- vânzări = afiliați CU părinte; pentru patron, „Agentul tău Menuvia") are
-- azi ZERO emailuri: fiecare semnal (cerere nouă, decizie, client nou, plată,
-- factură de cerut, client în pericol, raportul fondatorului) fie nu există,
-- fie pleacă spre Slack, care nu e configurat. Producătorii vin în PR-urile
-- următoare (mig 300 = alerta de client în pericol către agent; restul cu
-- fluxurile lor); aici intră DOAR valorile de enum, iar șabloanele lor intră
-- în ACELAȘI PR, în netlify/functions/process-email-queue.js (contractul
-- `template_data` al fiecăruia e documentat lângă șablon).
--
--   agent_client_at_risk            → agentul: un client al lui are scorul de
--                                     sănătate critic (înlocuiește, pentru
--                                     agent, alerta INTERNĂ health_score_alert,
--                                     care pleca greșit către PATRON — mig 300)
--   affiliate_application_received  → șeful: o cerere nouă de agent în echipă
--   affiliate_application_decided   → solicitantul: cererea a fost decisă
--   affiliate_new_client            → agentul: un restaurant nou atribuit lui
--   partner_access_requested        → patronul: agentul cere acces la meniu
--   affiliate_invoice_requested     → afiliatul: încarcă factura pentru plată
--   affiliate_payout_sent           → afiliatul: transferul a plecat
--   affiliate_payout_blocked        → afiliatul: plata e blocată (acțiune)
--   founder_weekly_digest           → fondatorul: raportul de luni
--
-- Fișier FĂRĂ tranzacție (ca mig 230/233/254/256): o valoare nouă de enum nu
-- poate fi folosită în aceeași tranzacție în care a fost adăugată, iar
-- funcția care o folosește (compute_health_scores, mig 300) vine separat.
-- `if not exists` face fișierul re-rulabil.
--
-- Ordinea de deploy e liberă: un worker care nu cunoaște încă un tip lasă
-- rândul în coadă 24h (process-email-queue.js, ramura „Unknown template"),
-- iar până la producătorii din PR-urile următoare nimic nu scrie aceste
-- tipuri. Testul EK1 (tests/functions/email-kinds.test.js) cere ca FIECARE
-- valoare din enum să aibă șablon — o valoare nouă fără șablon face CI roșu.

alter type public.email_template_kind add value if not exists 'agent_client_at_risk';
alter type public.email_template_kind add value if not exists 'affiliate_application_received';
alter type public.email_template_kind add value if not exists 'affiliate_application_decided';
alter type public.email_template_kind add value if not exists 'affiliate_new_client';
alter type public.email_template_kind add value if not exists 'partner_access_requested';
alter type public.email_template_kind add value if not exists 'affiliate_invoice_requested';
alter type public.email_template_kind add value if not exists 'affiliate_payout_sent';
alter type public.email_template_kind add value if not exists 'affiliate_payout_blocked';
alter type public.email_template_kind add value if not exists 'founder_weekly_digest';
