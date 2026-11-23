// Namespace `reports` — fila Vânzări / Rapoarte (lotul L7): ReportsTab cu
// perioada (butoanele, intervalul personalizat, eticheta perioadei), cifrele
// (comenzi, venituri, bon mediu, defalcarea pe metode de plată pe Planul 3),
// QR vs ospătar, graficul de venituri zilnice, top produse, vânzările pe oră /
// pe ospătar / pe categorie, starea goală, erorile, plus EXPORTURILE (CSV și
// PDF), compuse de lib/reportsExport.ts — antetele, titlurile secțiunilor și
// numele fișierelor urmează limba personalului (cine descarcă fișierul îl
// citește), iar în română sunt EXACT cele de dinainte (oracolul din
// reportsLang.test.ts e exportul vechi, copiat verbatim).
// SURSA DE ADEVĂR: en/fr/de au tipul `Translation<typeof ro>`. Româna e
// BYTE-identică — „Se generează...” cu trei puncte, „—” în titlul CSV,
// „  |  ” (două spații) în liniile PDF, „(lei)” în antetele CSV. Pluralele
// false de azi („Top 1 produse”, „QR: 1 comenzi”) devin chei PLURALE cu
// formele ro identice, ca celelalte limbi să poată acorda.
// Termenul legal „raport Z” (nota de subsol, ecran + PDF) se TRADUCE cu
// termenul local echivalent (Z report / rapport Z / Z-Bericht): e o notă
// pentru personal, nu un document fiscal; documentele fiscale (raportul TVA,
// bonul, casa, facturile) stau în alte ecrane, neatinse.
// Textele `pdf_*` folosesc DOAR caractere Latin-1 în en/fr/de (fonturile
// standard jsPDF; `patchPdfDiacritics` transliterează doar româna) — deci
// apostroful și ghilimelele lor sunt ASCII (reportsLang.test.ts YA9).
// NU sunt aici (din `common`): „Reîncearcă” și clasele de erori.
// NU se traduc (date): numele produselor, ospătarilor și categoriilor, sumele
// (`toFixed` + „lei”, ca azi), procentele, ora „14h”/„14:00”.
const ro = {
  // ── Perioada ──
  period_today: 'Azi',
  period_week: 'Ultimele 7 zile',
  period_month: 'Ultimele 30 zile',
  // Intervalul personalizat: `{from}`/`{to}` = zi + lună scurtă (+ an la final).
  period_range: '{from} – {to}',
  btn_today: 'Azi',
  btn_week: '7 zile',
  btn_month: '30 zile',
  btn_custom: 'Alt interval',
  date_from: 'De la data',
  date_to: 'Până la data',
  // ── Exporturile (butoane, stări) ──
  export_csv: 'Export CSV',
  export_pdf: 'Export PDF',
  export_pdfTitle: 'PDF: sumar și top produse. Pentru toate secțiunile folosește Export CSV.',
  export_generating: 'Se generează...',
  err_pdf: 'Nu s-a putut genera PDF-ul. Reîncearcă.',
  // Rezerva lui `describeStaffError` la încărcarea raportului.
  err_load: 'Eroare la încărcarea raportului',
  // ── Starea goală + nota Planului 1/2 ──
  empty_title: 'Nicio comandă în această perioadă.',
  empty_desc: 'Schimbă perioada selectată pentru a vedea datele de vânzări.',
  ops_note: 'Evidența comenzilor: cantități și produse, fără sume.',
  // ── Cifrele (cardurile) ──
  stat_orders: 'Comenzi',
  stat_revenue: 'Venituri',
  stat_avgTicket: 'Bon mediu',
  stat_cash: 'Cash',
  stat_card: 'Card',
  stat_voucher: 'Tichete de masă',
  stat_online: 'Card online',
  stat_other: 'Alte metode',
  src_qr: 'Comenzi QR',
  src_waiter: 'Comenzi ospătar',
  pct_ofTotal: '{pct}% din total',
  // ── Graficele ──
  chart_dailyTitle: 'Venituri zilnice',
  chart_revenue: 'Venituri',
  chart_orders: 'Comenzi',
  // ── Top produse ──
  top_title: { one: 'Top {n} produse', few: 'Top {n} produse', other: 'Top {n} produse' },
  top_sub: 'după cantitate comandată',
  col_product: 'Produs',
  col_qty: 'Buc.',
  col_revenue: 'Venituri',
  col_avgPrice: 'Preț mediu',
  // ── Vânzări pe oră / ospătar / categorie ──
  hourly_title: 'Vânzări pe oră',
  hourly_desc: 'Când vinde localul. Identifică peak hours.',
  waiter_title: 'Vânzări pe ospătar',
  waiter_desc: 'Atribuire prin servit → plătit → creat.',
  col_waiter: 'Ospătar',
  col_orders: 'Comenzi',
  col_avgTicket: 'Bon mediu',
  col_discounts: 'Reduceri',
  cat_title: 'Vânzări pe categorie',
  cat_desc: 'Ce mănâncă mai mult clienții. Reducerile NU se împart proporțional.',
  cat_items: '· {n} buc.',
  // Nota de subsol (ecran, Planul 3) — și ultima linie din PDF (`pdf_disclaimer`).
  disclaimer: 'Document operațional intern. Nu înlocuiește raportul Z fiscal al casei de marcat.',
  // ── Exportul CSV (lib/reportsExport.ts) ──
  csv_title: 'Raport Menuvia — {label}',
  csv_summary: '# Sumar',
  csv_top: '# Top produse',
  csv_waiters: '# Vânzări pe ospătar',
  csv_categories: '# Vânzări pe categorie',
  csv_hourly: '# Vânzări pe oră',
  csvh_orders: 'Comenzi',
  csvh_revenue: 'Venituri (lei)',
  csvh_avgTicket: 'Bon mediu (lei)',
  csvh_cash: 'Cash (lei)',
  csvh_card: 'Card (lei)',
  csvh_voucher: 'Tichete de masă (lei)',
  csvh_online: 'Card online (lei)',
  csvh_other: 'Alte metode (lei)',
  csvh_qrOrders: 'Comenzi QR',
  csvh_waiterOrders: 'Comenzi ospătar',
  csvh_product: 'Produs',
  csvh_quantity: 'Cantitate',
  csvh_avgPrice: 'Preț mediu (lei)',
  csvh_waiter: 'Ospătar',
  csvh_discounts: 'Reduceri aplicate (lei)',
  csvh_category: 'Categorie',
  // Rândurile-santinelă ale rapoartelor pe ospătar/categorie: serverul (mig
  // 122) le întoarce DEJA în română, deci în română se afișează textul lui
  // (`waiterRowLabel`/`categoryRowLabel`, lib/reportsExport.ts); cheile de aici
  // servesc celelalte limbi (identice cu textul serverului, pentru paritate).
  row_waiterQr: 'Comenzi QR (fără ospătar)',
  row_waiterUnknown: 'Necunoscut',
  row_noCategory: 'Fără categorie',
  csvh_itemsSold: 'Bucăți vândute',
  csvh_pctTotal: '% din total',
  csvh_hour: 'Ora',
  // `{slug}` = eticheta perioadei, redusă la [a-z0-9-].
  csv_file: 'raport-menuvia-{slug}.csv',
  // ── Exportul PDF (lib/reportsExport.ts) ──
  pdf_title: 'Raport Menuvia',
  pdf_summary: 'Sumar',
  pdf_totalOrders: 'Total comenzi: {n}',
  pdf_revenueLine: 'Venituri: {revenue} lei  |  Bon mediu: {avg} lei',
  pdf_methodsLine:
    'Cash: {cash} lei  |  Card: {card} lei  |  Tichete: {voucher} lei  |  Online: {online} lei  |  Alte: {other} lei',
  pdf_sourcesLine: 'QR: {qr}  |  Ospătar manual: {waiter}',
  pdf_orders: { one: '{n} comenzi', few: '{n} comenzi', other: '{n} comenzi' },
  pdf_top: 'Top Produse',
  pdf_colProduct: 'Produs',
  pdf_colQty: 'Buc.',
  pdf_colRevenue: 'Venituri',
  pdf_disclaimer: 'Document operațional intern. Nu înlocuiește raportul Z fiscal al casei de marcat.',
  // `{range}` = AAAA-LL-ZZ sau AAAA-LL-ZZ-AAAA-LL-ZZ.
  pdf_file: 'Raport-Menuvia-{range}.pdf',
}

export default ro
