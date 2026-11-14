// Namespace `kitchen` — ecranul Bucătăriei (KitchenPage, lotul L4c): antetul
// (înapoi la panou, titlul, „Epuizate”, notificările, starea conexiunii),
// bannerele (notificări, sunet blocat, listă trunchiată, eroare de
// sincronizare), coloanele tabloului și cardul de comandă. SURSA DE ADEVĂR:
// en/fr/de au tipul `Translation<typeof ro>`. Româna e BYTE-identică cu
// textele de dinainte — inclusiv „Se conectează...” și „Se activează...” cu
// trei puncte (textele de dinainte, fiecare cum era).
// NU sunt aici (vin din `orders`, aceleași cuvinte ca la ospătar): „Fără
// masă” (`noTable`), „Pickup” (`card_srcPickup`), „Se salvează…” (`saving`),
// „Marchează în pregătire” / „Gata” (`step_preparing` / `step_ready`), nota de
// refuz și panoul „Epuizate”; vârsta comenzii vine din `common` (`elapsedT`).
// Numele meselor, produselor și restaurantului sunt date: intră ca `{x}`.
const ro = {
  // ── Antetul ──
  header_backTitle: 'Înapoi la panoul de administrare',
  header_back: 'Înapoi la panou',
  title: 'Bucătărie',
  titleWithName: 'Bucătărie — {name}',
  selectRestaurant: 'Selectează restaurantul',
  soldOutAria: 'Produse epuizate — marchează ce s-a terminat',
  soldOut: 'Epuizate',
  // Butonul de notificări: numele accesibil, titlul (tooltip) și eticheta
  // vizibilă („Blocate” se vede și pe touch — title-ul nu apare pe tabletă).
  push_onAria: 'Notificări active — dezactivează',
  push_blockedAria: 'Notificările sunt blocate din setările browserului',
  push_enable: 'Activează notificările pentru comenzi noi',
  push_onTitle: 'Notificări active — click pentru a dezactiva',
  push_blockedTitle: 'Notificările sunt blocate în browser',
  push_on: 'Activ',
  push_blocked: 'Blocate',
  push_off: 'Notificări',
  conn_connected: 'Conectat',
  conn_connecting: 'Se conectează...',
  conn_disconnected: 'Deconectat',

  // ── Bannerele ──
  pushBanner_text:
    'Activează notificările ca să primești alerte pentru comenzi noi, chiar și cu tab-ul închis.',
  pushBanner_enabling: 'Se activează...',
  pushBanner_enable: 'Activează →',
  sound_locked: 'Sunetul pentru comenzile noi e oprit de browser până atingi ecranul o dată.',
  sound_unlock: 'Pornește sunetul',
  // {limit} = STAFF_ORDERS_FETCH_LIMIT (o constantă, deci fără plural).
  list_truncated:
    'Se afișează doar cele mai noi {limit} comenzi active — finalizează comenzile vechi ca lista să fie completă.',
  // Urmat de detaliul tehnic al erorii, în paranteză (date, netradus).
  sync_error: 'Nu am putut sincroniza comenzile. Verifică conexiunea și reîncearcă.',
  sync_dismiss: 'Închide mesajul de eroare',

  // ── Coloanele tabloului (new+confirmed / preparing / ready) ──
  col_new: 'Comenzi noi',
  col_preparing: 'În pregătire',
  col_ready: 'Gata de servit',
  empty_title: 'Nicio comandă',
  empty_newHint: 'Comenzile prin QR vor apărea aici automat.',

  // ── Cardul de comandă ──
  src_qr: 'QR',
  src_waiter: 'Ospătar',
  next_confirm: 'Confirmă',
}

export default ro
