// Namespace `waiter` — ECRANUL OSPĂTARULUI (lotul L4b): pagina /waiter
// (antetul, bannerele de conexiune / offline / plan, rezervările zilei,
// apelurile, lista grupată pe mese, plata parțială, fidelizarea), panoul
// „Stadiu mese” (TableStatusBoard + BoardTableCard + TableStatusMap, inclusiv
// etichetele celor 5 stări ale mesei), alocarea meselor pe ospătari
// (WaiterAssignments, în panou) și confirmarea „comanda a fost trimisă”
// (`describeWaiterOrderSent`, lib/orders.ts). SURSA DE ADEVĂR: en/fr/de au
// tipul `Translation<typeof ro>`. Româna e BYTE-identică cu textele de
// dinainte — inclusiv „Se încarcă...” și „Se procesează...” cu trei puncte,
// „bacșiș propus” și ghilimelele „…" ale cererilor speciale.
// NU sunt aici: PayModal / DiscountModal / `describePayRejection` (namespace-ul
// `payments`, partea a doua a lotului), dialogurile comune de comandă
// (`orders`), „Reîncearcă” / „Închide” (din `common`). Numele meselor,
// produselor, ospătarilor, recompenselor și ale restaurantului sunt date:
// intră ca `{x}`. Banii rămân formatați EXACT ca înainte (`toFixed` + „lei”),
// nu prin `fmt.money` (regula L3a); orele rezervărilor și ale apelurilor
// rămân în formatul de dinainte (`ro-RO`), lot separat.
const ro = {
  // ── Comune ecranului ──
  money: '{amount} lei',
  noTable: 'Fără masă',
  // Locurile unei mese (cardul din „Stadiu mese” și butonul din alocări).
  // Româna: „loc.” pentru orice n (abrevierea de dinainte).
  seats: { one: '{n} loc.', few: '{n} loc.', other: '{n} loc.' },
  loading: 'Se încarcă...',

  // ── Antetul ──
  header_backTitle: 'Înapoi la panoul de administrare',
  header_back: 'Înapoi la panou',
  header_titleAdmin: 'Comenzi live',
  header_titleWaiter: 'Ospătar',
  header_conn_connected: 'Live conectat',
  header_conn_connecting: 'Se conectează…',
  header_conn_disconnected: 'Deconectat — se face refresh automat la 30s',
  // Româna: „masă alocată” doar la 1, „mese alocate” altfel (textul de dinainte).
  header_assigned: {
    one: '{n} masă alocată · Comenzile tale',
    few: '{n} mese alocate · Comenzile tale',
    other: '{n} mese alocate · Comenzile tale',
  },
  header_adminView: 'Vizualizare admin · vezi tot live',
  header_selectRestaurant: 'Selectează restaurantul activ',
  header_soldOutAria: 'Produse epuizate — marchează ce s-a terminat',
  header_soldOut: 'Epuizate',
  header_newOrder: 'Comandă nouă',
  // Avertismentul de la „Ieși din cont” cât există comenzi doar pe telefon.
  header_signOutPending: {
    one: 'Ai {n} comandă salvată doar pe acest telefon, încă netrimise.',
    few: 'Ai {n} comenzi salvate doar pe acest telefon, încă netrimise.',
    other: 'Ai {n} comenzi salvate doar pe acest telefon, încă netrimise.',
  },

  // ── Coada offline ──
  offline_mode:
    'Mod Offline — Comenzile se salvează pe telefon și pleacă singure când revine conexiunea.',
  offline_authRequired:
    'Sesiunea a expirat — comenzile salvate pe telefon NU pleacă până te reconectezi.',
  offline_syncing: 'Se trimit comenzile salvate pe telefon (reîncercare automată).',
  offline_pending: {
    one: '{n} comandă în așteptare',
    few: '{n} comenzi în așteptare',
    other: '{n} comenzi în așteptare',
  },
  offline_dropped:
    'O comandă offline nu a putut fi trimisă și a fost anulată ({reason}). Reintrodu-o manual.',
  offline_dismissAria: 'Închide avertismentul',

  // ── Bannere de listă ──
  list_truncated:
    'Se afișează doar cele mai noi {limit} comenzi deschise — finalizează sau anulează comenzile vechi ca lista să fie completă.',
  list_loadError:
    'Nu am putut încărca comenzile. Verifică conexiunea — lista se reîmprospătează automat.',
  plan_loadError:
    'Nu am putut încărca planul restaurantului — plata și închiderea comenzilor sunt indisponibile.',

  // ── Comutatorul de vedere (Plan 3) ──
  view_aria: 'Vedere comenzi',
  view_list: 'Listă comenzi',
  view_tables: 'Stadiu mese',

  // ── Rezervările zilei ──
  resv_title: 'Rezervări azi ({n})',
  resv_seated: 'AȘEZAT',
  resv_confirmed: 'CONFIRMAT',
  resv_pending: 'ÎN AȘTEPTARE',
  // Româna: „persoană” doar la 1 (textul de dinainte, fără „de”).
  resv_party: { one: '{n} persoană', few: '{n} persoane', other: '{n} persoane' },
  resv_atTable: 'Masa {table}',
  resv_noTable: 'fără masă',
  resv_zone: 'Cere zona: {zone}',
  resv_special: '„{text}"',
  resv_pickTable: 'Alege masă…',
  resv_seatTitle: 'Marchează ca așezat',
  resv_pickFirst: 'Alege întâi o masă',
  resv_seat: 'Așezat',
  resv_noShow: 'No-show',
  resv_noShowConfirm: 'Marchezi ca no-show?',
  resv_tablesError: 'Nu am putut încărca lista meselor: {error}',
  resv_tablesErrorFallback: 'Nu am putut încărca mesele.',

  // ── Secțiunile listei ──
  section_ready: 'Gata de servit',
  section_calls: 'Apeluri ospătar',
  section_open: 'Toate comenzile deschise',
  // Româna păstrează „comenzi” fără „de” pentru orice n ≥ 2 (textul de dinainte).
  group_orders: { one: '{n} comandă', few: '{n} comenzi', other: '{n} comenzi' },
  empty_open: 'Nicio comandă deschisă',

  // ── Apelurile de la masă ──
  call_billAria: 'Cere nota',
  call_waiterAria: 'Apel ospătar',
  call_unknownTable: 'Masă necunoscută',
  call_billBadge: 'CERE NOTA',
  call_tip: '· bacșiș propus {amount} lei',
  call_take: 'Preiau',

  // ── Toast-urile paginii ──
  reprint_ok: 'Tichetul a fost pus în coada bucătăriei.',
  reprint_noPrinter: 'Nu e conectată nicio imprimantă de bucătărie (Setări → Bridge).',
  reprint_err: 'Tichetul nu a putut fi retipărit. Reîncearcă.',
  closeTable_already: 'Masa era deja închisă.',
  closeTable_done: 'Masa a fost închisă ({orders}).',
  closeTable_doneCancelled: 'Masa a fost închisă ({orders}, {rounds}).',
  closeTable_orders: { one: '{n} comandă', few: '{n} comenzi', other: '{n} comenzi' },
  closeTable_rounds: {
    one: '{n} rundă neservită anulată',
    few: '{n} runde neservite anulate',
    other: '{n} runde neservite anulate',
  },
  closeTable_err: 'Masa nu a putut fi închisă. Reîncearcă.',
  // Refuzurile de business ale lui `close_session_orders` (mig 288), aplicate
  // DOAR în afara românei — în română se afișează mesajul serverului ca atare.
  closeTable_errFiscal:
    'Pe planul cu fiscalizare fiecare notă se finalizează prin plată (bon fiscal) înainte de închiderea mesei.',
  closeTable_errPayments:
    'Masa are o comandă neservită cu plăți încasate: stornează plata sau finalizează comanda înainte de a închide masa.',
  // `describeWaiterOrderSent` (lib/orders.ts) — {id} e numărul scurt.
  sent_local:
    'Fără conexiune: comanda #{id} e salvată DOAR pe acest telefon. Pleacă singură la bucătărie când revine internetul — ține aplicația deschisă.',
  sent_ok: 'Comanda #{id} a fost trimisă la bucătărie.',

  // ── Plata parțială (modalul paginii) ──
  split_title: 'Plată parțială',
  split_table: 'Masa: {table}',
  split_recorded: 'Plăți înregistrate:',
  split_listCash: 'Cash',
  split_listCard: 'Card',
  split_listVoucher: 'Tichete de masă',
  split_listOther: 'Altul',
  split_btnCash: 'Cash',
  split_btnCard: 'Card',
  split_btnVoucher: 'Tichete',
  split_btnOther: 'Altul',
  split_remaining: 'Rămas:',
  split_amountLabel: 'Suma (lei)',
  split_processing: 'Se procesează...',
  split_add: 'Adaugă plata',
  // În română: mesajul serverului ca atare (textul de dinainte); în altă
  // limbă un text românesc al serverului NU se arată (ecran amestecat), deci
  // cade pe clasa erorii sau pe `split_errGeneric`.
  split_errWithMsg: 'Plata nu a fost înregistrată: {msg}. Verifică și reîncearcă.',
  split_errUnknown: 'Eroare necunoscută',
  split_errGeneric: 'Plata nu a fost înregistrată. Verifică și reîncearcă.',
  split_errOverpayment: 'Suma depășește restul de plată. Verifică suma și reîncearcă.',

  // ── Fidelizarea (LoyaltyRedeem) ──
  loyalty_button: 'Fidelizare — cod client',
  loyalty_placeholder: 'Ex: A1B2C3',
  loyalty_aria: 'Codul de fidelizare al clientului',
  loyalty_checking: 'Se verifică…',
  loyalty_redeem: 'Răscumpără',
  loyalty_ok: 'Recompensă: {reward}. Puncte rămase: {points}.',
  loyalty_notEnough: 'Puncte insuficiente: {points} din {threshold} necesare.',
  loyalty_notFound: 'Cod negăsit — verifică-l cu clientul.',
  loyalty_inactive: 'Programul de fidelizare nu e activ.',
  loyalty_err: 'Nu am putut verifica codul. Încearcă din nou.',

  // ── Panoul „Stadiu mese” — cele 5 stări ale mesei (ordinea = prioritatea) ──
  state_bill: 'Cere nota',
  state_calling: 'Cheamă ospătar',
  state_ready: 'De servit',
  state_occupied: 'Ocupată',
  state_free: 'Liberă',
  // „de 45 min” / „de 1h 20m” / „de 2h” — de cât timp e deschisă masa.
  board_openMin: 'de {n} min',
  board_openH: 'de {h}h',
  board_openHM: 'de {h}h {m}m',
  board_rounds: { one: '{n} rundă', few: '{n} runde', other: '{n} runde' },
  board_addToTable: 'Adaugă la masă',
  board_hide: 'Ascunde',
  board_show: 'Vezi ({n})',
  board_noOrders: 'Nicio comandă deschisă',
  board_openOrder: 'Deschide comandă',
  board_emptyTitle: 'Nicio masă configurată',
  board_emptyDesc: 'Adaugă mese în „Mese & QR” ca să vezi stadiul lor aici.',
  board_attention: 'Cer atenție',
  board_occupied: 'Ocupate',
  board_free: 'Libere',
  board_modeAria: 'Mod afișare mese',
  board_grid: 'Grilă',
  board_map: 'Hartă',
  board_tapHint: 'Atinge o masă pe hartă ca să vezi detaliile.',
  map_aria: 'Harta sălii — stadiul meselor',

  // ── Alocarea meselor pe ospătari (WaiterAssignments, în panou) ──
  role_owner: 'Proprietar',
  role_manager: 'Manager',
  role_waiter: 'Ospătar',
  role_kitchen: 'Bucătărie',
  assign_loadError: 'Eroare la încărcare',
  assign_tableRemoved: 'Masă eliminată',
  assign_tableAssigned: 'Masă alocată',
  assign_clearTitle: 'Ștergi toate alocările acestui ospătar?',
  assign_clearDesc: 'Ospătarul va vedea toate comenzile restaurantului, nu doar mesele lui.',
  assign_clearConfirm: 'Șterge alocările',
  assign_cleared: 'Alocări eliminate — ospătarul vede toate mesele',
  assign_allAssigned: 'Toate mesele alocate',
  assign_intro: 'Alocă mesele pe ospătari — fiecare ospătar vede pe telefon doar comenzile lui',
  // Propoziții cu element înăuntru (fillNodes): {label} e îngroșat.
  assign_legendNone: '{label} — ospătarul vede toate comenzile (comportament implicit).',
  assign_legendNoneLabel: 'Fără alocare',
  assign_legendSome: '{label} — ospătarul vede DOAR comenzile de la mesele lui alocate.',
  assign_legendSomeLabel: 'Cu alocare',
  assign_emptyTitle: 'Niciun ospătar adăugat.',
  assign_emptyDesc: 'Adaugă membri din {where}.',
  assign_emptyWhere: 'Setări → Echipă',
  // Româna păstrează „mese alocate” pentru ORICE n, inclusiv 1 (textul de
  // dinainte, byte-identic); celelalte limbi au formele lor reale.
  assign_count: { one: '{n} mese alocate', few: '{n} mese alocate', other: '{n} mese alocate' },
  assign_all: 'Toate mesele (nicio alocare)',
  assign_clearAll: 'Șterge toate',
  assign_assignAll: 'Toate mesele',
  assign_hint: 'Click pe masă pentru a aloca / dealoca',
  assign_noTables: 'Nicio masă activă.',
}

export default ro
