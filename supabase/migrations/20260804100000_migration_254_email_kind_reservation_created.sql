-- Migration 254: email_template_kind += 'reservation_created'
--
-- Auditul pe capitole (aug 2026) a găsit paradoxul auto-confirmării: TOATĂ
-- infrastructura de notificări (SMS mig 228, email queue mig 039, remindere
-- mig 057/215) curge exclusiv CĂTRE client — restaurantul nu află în niciun
-- fel de o rezervare nouă decât dacă are dashboard-ul deschis pe tabul
-- Rezervări (realtime). Cu auto_confirm=true (default mig 057), clientul
-- primește „confirmat" și vine la o masă despre care nimeni nu știe.
--
-- Acest fișier adaugă DOAR valoarea de enum, FĂRĂ tranzacție (ca mig 230/233):
-- o valoare nouă de enum nu poate fi folosită în aceeași tranzacție în care a
-- fost adăugată — trigger-ul care o folosește vine separat, în mig 255.

alter type public.email_template_kind add value if not exists 'reservation_created';
