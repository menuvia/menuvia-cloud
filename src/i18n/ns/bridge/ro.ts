// Namespace `bridge` — fila „Imprimantă bucătărie” / „Casă & tichete”
// (BridgeTab, lotul C7a): dispozitivele, înregistrarea, fereastra cu cheia și
// pașii de instalare (descarcă programul, descarcă config.json, rulează
// verificarea), tichetele de bucătărie.
// UNDE se traduce: DOAR pe Planul 2 (imprimanta din bucătărie, nefiscală —
// planul vândut și restaurantelor străine). Pe Planul 3 fila e ecran FISCAL și
// rămâne în română prin lege (lib/fiscalScreens.ts): BridgeTab cere
// namespace-ul cu `useT(bridgeNs, { lang: 'ro' })`, deci aceleași chei ies în
// română. Textele STRICT fiscale (bonurile, maparea TVA, contoarele „azi”,
// marca casei, „Bonul a ieșit”, variantele „casă de marcat” ale textelor de
// mai jos) NU sunt aici: rămân scrise în română în BridgeTab, numărate de SK5.
// SURSA DE ADEVĂR: en/fr/de au tipul `Translation<typeof ro>`. Româna e
// BYTE-identică cu textele de dinainte — „...” (trei puncte, nu „…”) pe
// stările în curs, ghilimeaua DREAPTĂ de închidere din „„Tichete bucătărie"”,
// pluralele FALSE („1 zile”, „1 încercări”: one = few = other), „● Online” /
// „○ Offline” cu simbolurile lor.
// NU sunt aici (din `common`): „Anulează”, „Închide”, „Șterge”, „Reîncearcă”,
// clasele de erori (`describeStaffError`).
// NU se traduc (date): numele dispozitivului, cheia, numărul comenzii, codul
// de eroare al imprimantei, numele din meniul Start al installer-ului
// („Verificare conexiune (check)” — installer-ul e în română).
const ro = {
  loading_printer: 'Se încarcă imprimanta...',
  intro_kitchen:
    'Comenzile noi se tipăresc automat în bucătărie, pe o imprimantă termică, prin Bridge-ul Menuvia.',
  register_device: 'Înregistrează dispozitiv',
  err_dismiss: 'Închide eroarea',
  err_load: 'Eroare la încărcare',
  err_register: 'Eroare la înregistrare',
  err_delete: 'Eroare la ștergere',
  err_save: 'Eroare la salvare',
  err_ticketRetry: 'Eroare la retrimitere tichet',
  err_ticketCancel: 'Eroare la anulare tichet',

  // ── Dispozitive ──
  devices_title: 'Dispozitive',
  empty_title: 'Nu ai înregistrat niciun dispozitiv.',
  empty_desc:
    'Înregistrează un dispozitiv ca să primești cheia de instalare pentru Bridge-ul Menuvia (PC-ul conectat la imprimanta din bucătărie).',
  empty_step1: 'Înregistrează dispozitivul aici: primești cheia și fișierul config.json.',
  empty_step2: 'Descarcă și instalează Menuvia Bridge, cu config.json în același folder.',
  empty_step3: 'Rulează „Verificare conexiune (check)" din meniul Start.',
  last_seen: 'Ultim semnal {when}',
  rel_never: 'niciodată',
  rel_now: 'acum',
  rel_min: '{n} min',
  rel_hours: '{n} h',
  rel_days: { one: '{n} zile', few: '{n} zile', other: '{n} zile' },
  status_online: '● Online',
  status_offline: '○ Offline',
  status_onlineHint: 'A dat semn de viață în ultimele 3 minute',
  status_offlineHint: 'Nu a mai dat semn de viață de peste 3 minute — verifică PC-ul și programul Menuvia Bridge',
  kitchen_toggle: 'Tichete bucătărie',
  delete_title: 'Ștergi acest dispozitiv?',
  delete_descKitchen: 'Bridge-ul instalat nu va mai putea tipări tichetele din bucătărie.',
  delete_confirm: 'Șterge dispozitivul',

  // ── Tabelele (tichete; pe Planul 3 și bonurile) ──
  col_created: 'Creat',
  col_order: 'Comandă',
  col_status: 'Status',
  col_details: 'Detalii',
  col_actions: 'Acțiuni',
  st_pending: 'În așteptare',
  st_sentPrinter: 'Trimis la imprimantă',
  st_success: '✓ Tipărit',
  st_error: '✗ Eroare',
  st_cancelled: 'Anulat',
  retries: { one: '{n} încercări', few: '{n} încercări', other: '{n} încercări' },

  // ── Tichete bucătărie ──
  tickets_title: 'Tichete bucătărie',
  tickets_desc:
    'Comenzile noi se tipăresc automat pe imprimanta termică din bucătărie, prin dispozitivele cu „Tichete bucătărie" activat.',
  tickets_empty:
    'Niciun tichet încă. Activează „Tichete bucătărie" pe un dispozitiv de mai sus — comenzile noi vor apărea aici.',
  reprint: 'Reprint',
  ticketCancel_title: 'Anulezi acest tichet?',
  ticketCancel_desc: 'Nu va mai fi tipărit în bucătărie.',
  ticketCancel_confirm: 'Anulează tichet',

  // ── Înregistrare ──
  reg_titleDevice: 'Înregistrează dispozitiv Bridge',
  reg_name: 'Nume *',
  reg_namePh: 'ex: PC bucătărie',
  reg_defaultName: 'PC bucătărie',
  reg_infoKitchen:
    'După înregistrare vei primi o cheie unică de instalare. O folosești o singură dată la instalarea Bridge-ului pe PC-ul conectat la imprimanta din bucătărie. Cheia poate fi recuperată mai târziu doar prin re-înregistrare.',
  reg_submit: 'Înregistrează',
  reg_busy: 'Se înregistrează...',

  // ── Fereastra cu cheia: instalarea în 3 pași ──
  key_titleDevice: 'Dispozitiv înregistrat',
  key_intro: 'Instalează Bridge-ul în 3 pași:',
  step1_title: 'Descarcă Menuvia Bridge',
  step1_descKitchen: 'Installer-ul pentru Windows, pe PC-ul conectat la imprimanta din bucătărie.',
  step1_download: 'Descarcă installer-ul',
  step1_missing: 'Linkul de descărcare nu e publicat încă — cere installer-ul echipei Menuvia.',
  step2_title: 'Descarcă config.json',
  step2_desc:
    'Pune-l în același folder cu installer-ul, înainte să-l rulezi: conține adresa serverului și cheia dispozitivului, deci configurarea le preia singură.',
  step2_kitchenNote: 'Configurarea îți mai cere doar adresa IP a imprimantei termice.',
  step2_download: 'Descarcă config.json',
  step2_private: 'Fișierul conține cheia: păstrează-l doar pe PC-ul cu Bridge-ul.',
  step3_title: 'Rulează verificarea',
  step3_descKitchen:
    'Din meniul Start: Menuvia Bridge → „Verificare conexiune (check)". Trebuie să vadă serverul Menuvia și imprimanta; apoi dispozitivul apare aici „● Online".',
  key_label: 'Cheia de instalare pentru Bridge:',
  key_copy: 'Copiază cheia',
  key_copied: 'Copiat ✓',
  key_copyFailed: 'Nu s-a putut copia automat — selectează cheia de mai sus și copiaz-o manual.',
  key_warning:
    'Salvează cheia acum (sau descarcă config.json). După închiderea acestei ferestre nu mai poate fi recuperată. Dacă o pierzi, șterge dispozitivul și înregistrează unul nou.',
  key_done: 'Am salvat cheia',
}

export default ro
