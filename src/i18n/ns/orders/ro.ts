// Namespace `orders` — dialogurile de comandă COMUNE ecranelor de personal
// (lotul L4a): anularea (CancelOrderDialog), editarea (EditOrderSheet +
// `describeEditOrderError`), foaia de opțiuni (ModifierSheet), istoricul
// (OrderAuditSheet + `describeAuditEntry`), cardul „Gata de servit”
// (ReadyOrderCard), detaliile de ridicare (PickupDetails), cardul de comandă al
// ospătarului (OrderCard din WaiterOrderCard + pasul din `lib/waiterSteps`) și
// comanda manuală (WaiterEntry). SURSA DE ADEVĂR: en/fr/de au tipul
// `Translation<typeof ro>`. Româna e BYTE-identică cu textele de dinainte —
// inclusiv „Se trimite...” cu trei puncte și ghilimelele drepte din
// „Anulează" (textele de dinainte, păstrate ca atare).
// NU sunt aici: PayModal (același fișier cu OrderCard, ecran fiscal de Plan 3 —
// rămâne în română, lot separat) și „Reîncearcă” / „Editează” / „Șterge” /
// „Se încarcă…”, care vin din `common` (retry/edit/delete/loading). „Anulează”
// de pe card stă AICI, deliberat (`card_cancel`, nu `common.cancel`): în germană
// trebuie să fie „Stornieren”, butonul pe care îl numesc `edit_errEmpty` și
// `card_closeEarlyDesc`, nu „Abbrechen”. Numele produselor, opțiunilor și
// meselor sunt date: intră ca `{x}`.
const ro = {
  // ── Comune lotului ──
  // Suma rămâne formatată EXACT ca înainte (`toFixed(2)` + „lei”), nu prin
  // `fmt.money`: formatarea pe limba personalului e un lot separat (regula L3a).
  money: '{amount} lei',
  tableLabel: 'Masa {table}',
  noTable: 'Fără masă',
  soldOut: 'Epuizat',
  saving: 'Se salvează…',

  // ── Metodele de plată (lista plăților din dialogul de anulare) ──
  method_cash: 'Numerar',
  method_card_pos: 'Card (POS)',
  method_card_online: 'Card online',
  method_meal_voucher: 'Tichet de masă',
  method_other: 'Altă metodă',

  // ── Anularea comenzii (CancelOrderDialog) ──
  cancel_title: 'Anulează comanda',
  cancel_errGeneric:
    'Anularea a fost respinsă. Verifică rolul tău sau motivul comenzii și încearcă din nou.',
  cancel_blocked: 'Comanda are {amount} lei plăți încasate și nu poate fi anulată direct.',
  // Propoziție cu element înăuntru (fillNodes): {returned} e îngroșat.
  cancel_voidHelp:
    'Dacă banii au fost {returned}, stornează plățile (cu motiv, se înregistrează în audit) și comanda se anulează. Altfel finalizează prin plată.',
  cancel_voidHelpReturned: 'returnați clientului',
  cancel_voidOnline: '{refund} înainte de storno.',
  cancel_voidOnlineRefund: 'Plățile online se rambursează manual din Stripe',
  cancel_reasonVoid: 'Motiv (obligatoriu pentru stornare)',
  cancel_reasonServed: 'Motiv (obligatoriu — comanda a fost servită)',
  cancel_reasonOptional: 'Motiv (opțional)',
  cancel_reasonPlaceholder: 'Ex: clientul a anulat, produs nedisponibil…',
  cancel_dismiss: 'Renunță',
  cancel_voiding: 'Se stornează…',
  cancel_voidAndCancel: 'Stornează plățile și anulează',
  cancel_cancelling: 'Se anulează…',

  // ── Editarea comenzii (EditOrderSheet) ──
  edit_title: 'Editează comanda',
  edit_errMenuLoad: 'Nu s-a putut încărca meniul',
  edit_errEmpty:
    'Comanda trebuie să aibă cel puțin 1 produs. Pentru anulare folosește butonul „Anulează" din card.',
  edit_errOrphan:
    'Comanda conține produse șterse din meniu (marcate cu ⚠). Elimină-le sau roagă proprietarul să reactiveze produsul înainte de a salva.',
  edit_emptyCart: 'Niciun produs în comandă. Adaugă cel puțin unul sau anulează comanda.',
  edit_orphanTitle: 'Produs șters din meniu',
  edit_orphanHint: 'Produs șters din meniu — doar elimină',
  edit_addProduct: '+ Adaugă produs',
  edit_newSubtotal: 'Subtotal nou',
  edit_discountRecalc: '(reducerea de {amount} lei va fi recalculată)',
  edit_saveChanges: 'Salvează modificările',
  edit_pickProduct: 'Alege produs',
  edit_noProducts: 'Nicio categorie cu produse',

  // ── Refuzul salvării (describeEditOrderError, lib/orders.ts) ──
  edit_errNetwork: 'Fără conexiune — modificarea nu a fost salvată. Reîncearcă.',
  edit_errConcurrent:
    'Comanda a fost modificată între timp de altcineva. Închide și redeschide comanda, apoi reîncearcă.',
  // Doar în alte limbi: în română se afișează mesajul serverului, care numește
  // grupa și produsul (mig 191).
  edit_errOptionGroup:
    'Opțiunile alese nu respectă regulile unei grupe a produsului. Reverifică produsul și salvează din nou.',
  edit_errWhoNamed: 'Produsul „{name}”',
  edit_errWhoUnknown: 'Un produs din comandă',
  edit_errSoldOutNone:
    '{who} e epuizat și nu mai poate fi adăugat. Scoate-l din comandă și salvează din nou.',
  edit_errOffMenuNone:
    '{who} nu mai e în meniu și nu mai poate fi adăugat. Scoate-l din comandă și salvează din nou.',
  edit_errSoldOutSome:
    '{who} s-a epuizat între timp. {keep} Scade cantitatea sau scoate-l și salvează din nou.',
  edit_errOffMenuSome:
    '{who} nu mai e în meniu. {keep} Scade cantitatea sau scoate-l și salvează din nou.',
  edit_errKeepUpTo: 'Poți păstra cel mult cantitatea deja comandată ({n}).',
  edit_errKeepOnly: 'Poți păstra doar cantitatea deja comandată.',
  edit_errPartialPayments: 'Comanda are plăți înregistrate și nu mai poate fi editată.',
  edit_errTerminal: 'Comanda e deja finalizată și nu mai poate fi editată.',
  edit_errRole: 'Rolul tău nu permite editarea comenzii.',
  edit_errNotFound: 'Comanda nu mai există.',
  edit_errProductGone:
    'Un produs din comandă nu mai e disponibil în meniu. Elimină-l și salvează din nou.',
  edit_errOptionGone:
    'O opțiune aleasă nu mai e disponibilă. Reverifică produsul și salvează din nou.',
  edit_errQuantity: 'Cantitatea pe o linie trebuie să fie între 1 și {max}.',
  edit_errTooMany: 'Comanda poate avea cel mult 100 de produse.',
  edit_errGeneric: 'Modificarea nu a fost salvată. Reîncearcă.',

  // ── Foaia de opțiuni (ModifierSheet) ──
  mod_addToOrder: 'Adaugă în comandă — {amount} lei',
  mod_chooseExact: 'Alege exact {n}',
  mod_chooseBetween: 'Alege între {min} și {max}',
  mod_chooseAtLeast: 'Alege cel puțin {n}',
  mod_max: 'Maxim {n}',
  mod_extras: 'Extra',
  mod_quantity: 'Cantitate',
  mod_notesPlaceholder: 'Mențiuni (opțional)',
  mod_missing: 'Alege: {group}',

  // ── Istoricul comenzii (OrderAuditSheet + describeAuditEntry) ──
  audit_title: 'Istoric comandă',
  audit_errLoad: 'Eroare la încărcare',
  audit_empty: 'Niciun eveniment înregistrat încă pentru această comandă.',
  audit_system: 'sistem',
  audit_ev_created: 'A creat comanda',
  audit_ev_deleted: 'A șters comanda',
  audit_ev_confirmed: 'A confirmat comanda',
  audit_ev_preparing: 'A trimis la pregătire',
  audit_ev_ready: 'A marcat ca gata',
  audit_ev_served: 'A marcat ca servit',
  audit_ev_closed: 'A închis masa (fără bon fiscal)',
  audit_ev_paid: 'A încasat plata',
  audit_ev_cancelled: 'A anulat comanda',
  audit_ev_status: 'Status → {status}',
  audit_ev_discount: 'A modificat reducerea',
  audit_ev_total: 'A recalculat totalul',
  audit_ev_modified: 'A modificat comanda',
  audit_ev_itemsChanged: 'A modificat comanda ({items}{total})',
  // Româna păstrează „produse” pentru ORICE n (textul de dinainte, byte-identic);
  // celelalte limbi au formele lor reale.
  audit_itemsCount: {
    one: '{from} → {n} produse',
    few: '{from} → {n} produse',
    other: '{from} → {n} produse',
  },
  audit_itemsUnknown: 'produse',
  audit_totalPart: ' · total {amount} lei',
  audit_ev_itemAdded: 'A adăugat {product} × {qty}',
  audit_ev_itemDeleted: 'A șters {product} × {qty}',
  audit_productFallback: 'produs',
  audit_ev_itemModified: 'A modificat un produs',

  // ── „Gata de servit” (ReadyOrderCard) ──
  ready_serve: 'Servit',

  // ── Ridicarea (PickupDetails) — {time} e un element (ora, cifre tabulare) ──
  pickup_at: 'Ridicare la {time}',

  // ── Cardul de comandă al ospătarului (OrderCard) ──
  card_status_new: 'Nou',
  card_status_confirmed: 'Confirmat',
  card_status_preparing: 'În preparare',
  card_status_ready: 'Gata de servit',
  card_status_served: 'Servit',
  card_status_closed: 'Închis',
  card_status_paid: 'Plătit',
  card_status_cancelled: 'Anulat',
  card_srcPickup: 'Pickup',
  card_srcManual: 'Manual',
  card_late: 'întârziată',
  // {name} e un element (numele, îngroșat).
  card_takenBy: 'Preluat de: {name}',
  card_servedBy: 'Servit de: {name}',
  card_reprint: 'Retipărește la bucătărie',
  // Butonul de anulare de pe card: cheie proprie (nu `common.cancel`), ca
  // germana să spună „Stornieren”, nu „Abbrechen” (renunțarea la un dialog).
  card_cancel: 'Anulează',
  card_history: 'Vezi istoric',
  card_payFull: 'Plată integrală',
  card_payPartial: 'Plată parțială',
  card_closeOrder: 'Închide comanda',
  card_closeTable: 'Închide masa',
  card_cashRegisterNote: 'Plata și bonul se fac pe casa de marcat existentă',
  card_planChecking: 'Se verifică planul restaurantului — finalizarea comenzii revine imediat.',
  card_closeEarlyTitle: 'Închizi comanda înainte să fie servită?',
  card_closeEarlyDesc:
    'Comanda se marchează ca finalizată (se scade stocul și se acordă puncte de loialitate). Dacă n-a mai fost onorată, folosește „Anulează".',
  card_closeTableTitle: 'Închizi masa?',
  card_closeTableDesc: '{note} Plata și bonul se fac pe casa de marcat a localului.',
  card_closeTableUnknown:
    'Comenzile servite se închid; cele încă neservite (noi sau în preparare) se anulează.',
  card_closeTableAll: 'Se închid toate comenzile deschise ale acestei mese și sesiunea ei.',
  // Româna păstrează „runde … vor fi ANULATE” pentru orice n ≥ 2 (textul de
  // dinainte); n = 0 are textul lui (card_closeTableAll).
  card_closeTableUnserved: {
    one: 'Comenzile servite se închid; {n} rundă neservită (nouă sau în preparare) va fi ANULATĂ.',
    few: 'Comenzile servite se închid; {n} runde neservite (noi sau în preparare) vor fi ANULATE.',
    other: 'Comenzile servite se închid; {n} runde neservite (noi sau în preparare) vor fi ANULATE.',
  },

  // ── Pasul următor pe Planul 3 (lib/waiterSteps `labelKey`) — aceleași
  //    cuvinte ca Bucătăria și „Gata de servit” ──
  step_preparing: 'Marchează în pregătire',
  step_ready: 'Gata',
  step_served: 'Servit',

  // ── Comanda manuală a ospătarului (WaiterEntry) ──
  entry_errMenu: 'Nu s-a putut încărca meniul. Verifică conexiunea.',
  entry_errTables: 'Nu s-au putut încărca mesele. Verifică conexiunea.',
  entry_errStill: 'Încă nu merge. Verifică internetul.',
  // Doar în alte limbi: în română rămâne lanțul de dinainte (mesajul românesc
  // al serverului, apoi cheia oaspetelui `err_order_not_sent`).
  entry_errNotSent: 'Comanda nu a fost trimisă. Reîncearcă.',
  entry_errMissingGroup: 'Un produs din coș are o grupă de opțiuni obligatorie nealeasă.',
  entry_errSoldOut: 'Un produs din coș s-a epuizat între timp. Scoate-l și trimite din nou.',
  entry_errProductGone: 'Un produs din coș nu mai e în meniu. Scoate-l și trimite din nou.',
  entry_errOptions: 'O opțiune sau un extra din coș nu mai e disponibil. Adaugă produsul din nou.',
  entry_errQuantity: 'Cantitatea pe o linie trebuie să fie între 1 și {max}.',
  entry_errTooMany: 'Comanda are prea multe produse.',
  entry_errNotesTooLong: 'Mențiunile sunt prea lungi.',
  entry_errOrderingOff: 'Restaurantul nu primește comenzi acum.',
  entry_discardTitle: 'Renunți la comanda începută?',
  // Româna: „produs … se pierde” doar la 1, „produse … se pierd” altfel (textul
  // de dinainte, byte-identic pentru orice n).
  entry_discardDesc: {
    one: '{n} produs din coș se pierde. Comanda NU a fost trimisă la bucătărie.',
    few: '{n} produse din coș se pierd. Comanda NU a fost trimisă la bucătărie.',
    other: '{n} produse din coș se pierd. Comanda NU a fost trimisă la bucătărie.',
  },
  entry_discardConfirm: 'Renunță la comandă',
  entry_discardKeep: 'Continuă comanda',
  entry_selectTable: 'Selectează masa',
  entry_closeAria: 'Închide comanda nouă',
  entry_cartCount: 'Coș ({n})',
  entry_cart: 'Coș',
  entry_total: 'Total: {amount} lei',
  entry_notesPlaceholder: 'Mențiuni comandă (opțional)',
  entry_sending: 'Se trimite...',
  entry_send: 'Trimite comanda',
}

export default ro
