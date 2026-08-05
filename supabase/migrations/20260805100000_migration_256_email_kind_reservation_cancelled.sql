-- Migration 256: email_template_kind += 'reservation_cancelled'
--
-- Perechea lui mig 254: la anularea PUBLICĂ a unei rezervări (RPC-ul din mig
-- 257), owner-ul primește email — altfel anularea ar recrea exact paradoxul
-- închis de mig 255 (clientul își anulează masa, localul nu află și ține
-- masa blocată degeaba). Anularea din DASHBOARD nu trimite email (owner-ul
-- și-a făcut singur acțiunea — ar fi zgomot); de-asta enqueue-ul stă în RPC,
-- nu într-un trigger pe UPDATE.
--
-- Fișier FĂRĂ tranzacție (ca mig 230/233/254): valoarea nouă de enum nu poate
-- fi folosită în aceeași tranzacție în care a fost adăugată.

alter type public.email_template_kind add value if not exists 'reservation_cancelled';
