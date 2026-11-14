// Namespace `tables` — fila Mese & QR (lotul L6a): TablesManager cu lista
// meselor, token-urile QR (generare, rotire, descărcare PNG, copierea
// linkului), generarea rapidă „Câte mese ai?”, căutarea și filtrul pe zonă,
// QR-ul meniului general, descărcarea PDF-ului (meniul de formate și
// mesajele lui), avertismentul de domeniu, modalul mesei și cele două
// confirmări (regenerare, ștergere), plus textele despre ridicare de pe acest
// ecran, compuse de `pickupCopyT` (`generalMenuQrText` / `pickupOnlyEmptyStateText`)
// (lib/pickupCopy.ts — variantele românești de acolo rămân oracolul). Chunk
// propriu: fila e LENEȘĂ în DashboardPage, deci namespace-ul se încarcă doar
// cu ea.
// SURSA DE ADEVĂR: en/fr/de au tipul `Translation<typeof ro>`. Româna e
// BYTE-identică cu textele de dinainte — pluralele false („Ai deja 1 mese
// configurate”, „1 mese create, fiecare cu QR-ul ei”, „1 locuri”), „...” cu
// trei puncte („Se salvează...”, „Se descarcă...”, „Se generează...”,
// placeholderele), ghilimeaua DREAPTĂ de închidere din „„Generează QR"” și
// „„doar ridicare"”, cele două formulări diferite ale eșecului de copiere
// („Nu am putut copia linkul” pe QR-ul general, „Nu s-a putut copia linkul”
// pe rândul mesei). Un plural fals devine cheie PLURALĂ cu formele ro
// identice, ca franceza/germana să poată acorda.
// Textul TIPĂRIT pe cardurile QR NU e aici: cardul e pentru OASPETE și
// urmează limba de bază a meniului (lib/qrCopy.ts, tabelă pură în 7 limbi).
// NU sunt aici (din `common`): „Anulează”, „Salvează”, „Șterge”, „Reîncearcă”.
// NU se traduc (date): numele meselor și zonele, slug-urile, numele
// restaurantului, hostul de brand, numele de fișier ale descărcărilor și
// numele COMERCIALE ale planurilor (`PLAN_LABELS`, nume proprii).
// Numele și slug-ul mesei CREATE de generarea rapidă (`Masa N` / `masa-N`)
// NU sunt aici: sunt DATE (`lib/tableSlug.ts`), în română în orice limbă a
// personalului — numele apare pe cardul QR tipărit (limba MENIULUI) și în
// meniul oaspetelui.
const ro = {
  saving: 'Se salvează...',

  // ── QR-ul unei mese (imaginea mică de pe rând) ──
  qr_genFailed: 'Codul QR nu a putut fi generat',
  qr_alt: 'Cod QR pentru {label}',
  qr_altPlain: 'Cod QR',

  // ── Modalul mesei (adăugare / editare) ──
  addTable: 'Adaugă masă',
  editTable: 'Editează masă',
  modal_name: 'Nume masă *',
  modal_namePlaceholder: 'Masa 1, Terasa A...',
  modal_slug: 'Slug URL',
  modal_slugPlaceholder: 'masa-1',
  modal_slugHint: 'Identificator intern al mesei — nu afectează QR-urile deja printate',
  modal_seats: 'Locuri (opțional)',
  modal_zone: 'Zonă (opțional)',
  modal_zonePlaceholder: 'Terasa, Interior, Bar...',
  modal_zoneHint: 'Clienții pot alege zona (ex. Terasă vs Interior) când fac o rezervare online',
  modal_err_nameRequired: 'Numele este obligatoriu.',
  modal_err_duplicate: 'Există deja o masă cu acest identificator. Alege alt nume sau slug.',
  modal_err_save: 'Nu s-a putut salva masa. Verifică datele și încearcă din nou.',

  // ── QR-ul meniului general (/m/:slug) ──
  general_title: 'QR meniu general',
  // „Duce la /m/slug — <text>”: `{path}` e linkul colorat (element), `{text}`
  // vine din `pickupCopyT(...).generalMenuQrText`.
  general_leadsTo: 'Duce la {path} — {text}',
  general_png: 'PNG',
  copyLink: 'Copiază link',
  linkCopied: 'Link copiat',
  general_copyFailed: 'Nu am putut copia linkul',

  // ── Textele despre ridicare (lib/pickupCopy.ts, variantele `…T`) ──
  // Motivul flipbook, o singură formulare pentru QR-ul general și pentru
  // empty state-ul „doar ridicare” (PY1).
  pk_flipbookNoOrders:
    'pe stilul Flipbook pagina publică arată meniul ca pe o carte, fără coș, deci clienții ' +
    'nu pot comanda pentru ridicare. Pentru comenzi, alege alt stil din Setări → Aspect meniu → ' +
    'Așezarea produselor.',
  gm_tail: 'Bun pentru vitrină, flyere sau tejghea.',
  gm_flipbook: 'clienții văd meniul; {why} {tail}',
  gm_withPickup: 'clienții văd meniul; cu comenzile pentru ridicare active pot și comanda. {tail}',
  gm_plain: 'clienții văd meniul. {tail}',
  po_tail: 'Poți adăuga mese oricând, dacă situația se schimbă.',
  po_suspended:
    'Mod „doar ridicare" suspendat: planul tău nu include comenzile pentru ridicare, deci ' +
    'panoul îți arată mesele și rezervările. Prin QR-ul general de mai sus, clienții văd ' +
    'meniul, fără comanda pentru ridicare. Setarea rămâne salvată și revine la trecerea pe ' +
    'planul {plan}.',
  po_head: 'Mod „doar ridicare" activ — nu ai nevoie de mese.',
  po_flipbook: '{head} Printează QR-ul general de mai sus. Atenție: {why} {tail}',
  po_withPickup: '{head} Printează QR-ul general de mai sus; clienții comandă și ridică de la tejghea. {tail}',
  po_plain: '{head} Printează QR-ul general de mai sus. {tail}',

  // ── Antetul filei și descărcarea PDF-ului ──
  summary: '{active} active · {total} total',
  pdf_title: 'Descarcă QR-urile în format PDF pentru print',
  pdf_button: 'Descarcă QR-uri',
  pdf_downloading: 'Se descarcă...',
  pdf_menuAria: 'Formate de descărcare QR',
  pdf_grid: 'Grilă — 6 / pagină',
  pdf_gridHint: 'Pentru lipit pe mese',
  pdf_tent: 'Carduri pliabile',
  pdf_tentHint: '4 / pagină, tip cort',
  pdf_poster: 'Poster A4',
  pdf_posterHint: '1 QR mare / pagină',
  pdf_noActive: 'Nicio masă activă cu QR',
  pdf_done: 'PDF descărcat',
  pdf_failed: 'PDF-ul nu a putut fi generat. Reîncearcă.',
  // Refuzul `downloadQrPdf` fără carduri (hint `qr_pdf_no_cards`, lib/qrPdf.ts);
  // în română ajunge pe ecran mesajul erorii, identic cu acesta.
  pdf_noCards: 'Niciun QR de tipărit',

  // ── Avertismentul de domeniu (VITE_APP_URL) ──
  domain_previewTitle: 'Detaliu tehnic: VITE_APP_URL nu e setat — se folosește URL-ul de preview.',
  domain_mismatchTitle: 'Detaliu tehnic: domeniul curent diferă de VITE_APP_URL.',
  domain_preview:
    'Atenție: QR-urile generate acum vor conține o adresă temporară de test, nu adresa finală a meniului. Nu le printa încă — contactează suportul dacă ai nevoie de ajutor.',
  domain_mismatch:
    'Ești pe o altă adresă decât cea configurată pentru meniu. QR-urile generate vor folosi adresa configurată, nu pe cea curentă.',

  // ── Generarea rapidă „Câte mese ai?” ──
  bulk_titleEmpty: 'Nu ai mese configurate încă',
  bulk_title: 'Generează QR-urile pentru mese',
  bulk_descEmpty: 'Adaugă numărul de mese, iar Menuvia îți generează automat QR-urile.',
  bulk_desc: 'Spune-ne câte mese ai, iar Menuvia creează automat QR-urile pentru fiecare masă.',
  bulk_placeholder: 'Câte mese? ex. 80',
  bulk_aria: 'Numărul de mese',
  bulk_busy: 'Se generează...',
  bulk_btnEmpty: 'Generează mese și QR-uri',
  bulk_btn: 'Generează QR-uri',
  bulk_footer: 'Poți edita, dezactiva sau regenera orice QR mai târziu.',
  bulk_countRequired: 'Introdu numărul de mese (ex. 80)',
  bulk_alreadyHave: {
    one: 'Ai deja {n} mese configurate',
    few: 'Ai deja {n} mese configurate',
    other: 'Ai deja {n} mese configurate',
  },
  bulk_limit: 'Planul tău permite până la {max} mese / QR-uri. Pentru mai multe, poți face upgrade.',
  bulk_created: {
    one: '{n} mese create, fiecare cu QR-ul ei',
    few: '{n} mese create, fiecare cu QR-ul ei',
    other: '{n} mese create, fiecare cu QR-ul ei',
  },
  bulk_duplicate: 'Unele mese există deja — reîmprospătează lista și încearcă din nou.',
  bulk_failed: 'Nu s-au putut genera mesele. Încearcă din nou.',

  // ── Lista meselor ──
  load_error: 'Nu s-au putut încărca mesele',
  search_placeholder: 'Caută după nume...',
  search_aria: 'Caută masă după nume',
  zone_filterAria: 'Filtrează după zonă',
  zone_all: 'Toate zonele',
  noZone: 'Fără zonă',
  noMatches: 'Nicio masă nu corespunde filtrelor.',
  seats: { one: '{n} locuri', few: '{n} locuri', other: '{n} locuri' },
  inactive: 'Inactiv',
  status_noQr: 'Fără QR — apasă „Generează QR"',
  status_active: 'QR activ',
  status_disabled: 'QR dezactivat',
  action_png: 'Descarcă QR (PNG)',
  action_regenerate: 'Regenerează QR',
  action_generate: 'Generează QR',
  action_deactivate: 'Dezactivează',
  action_activate: 'Activează',
  action_deactivateAria: 'Dezactivează masă',
  action_activateAria: 'Activează masă',
  action_delete: 'Șterge masă',

  // ── Toast-urile acțiunilor ──
  toast_verifyFailed: 'Nu am putut verifica QR-urile existente. Cele tipărite rămân valabile — reîncearcă.',
  toast_tokensFailed: 'Eroare la generarea QR-urilor',
  toast_added: 'Masă adăugată',
  toast_updated: 'Masă actualizată',
  toast_saveFailed: 'Eroare la salvare',
  toast_deleteFailed: 'Eroare la ștergere',
  toast_deleted: 'Masă ștearsă',
  toast_deactivated: 'Masă dezactivată',
  toast_activated: 'Masă activată',
  toast_updateFailed: 'Eroare la actualizare',
  toast_rotated: 'QR nou generat',
  toast_rotateFailed: 'Eroare la generarea QR-ului',
  toast_pngDownloaded: 'QR descărcat pentru {name}',
  toast_downloadFailed: 'Eroare la descărcare',
  toast_copyFailed: 'Nu s-a putut copia linkul',

  // ── Confirmările (regenerare, ștergere) ──
  rotate_aria: 'Regenerează QR pentru {name}',
  rotate_title: 'Regenerează QR — {name}',
  rotate_desc: 'QR-ul vechi nu va mai funcționa. Vrei să generezi unul nou pentru această masă?',
  rotate_confirm: 'Regenerează',
  delete_desc: 'Toate codurile QR asociate vor fi șterse. Comenzile existente nu sunt afectate.',
}

export default ro
