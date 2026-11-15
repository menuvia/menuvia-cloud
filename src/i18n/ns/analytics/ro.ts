// Namespace `analytics` — fila Statistici (lotul L7): AnalyticsTab cu
// intervalul (7/14/30 de zile), cele patru cifre de sus, graficele recharts
// (venit și comenzi pe zi, sursa comenzilor, metoda de plată, orele de vârf —
// titluri, etichetele seriilor din tooltip-uri, numele feliilor), tabelele
// „Top produse” și „Performanță ospătar” (antete + rezerva „Anonim”), starea
// goală, mesajul pentru restaurantele din afara României și eroarea de
// încărcare.
// SURSA DE ADEVĂR: en/fr/de au tipul `Translation<typeof ro>`. Româna e
// BYTE-identică cu textele de dinainte — pluralele FALSE rămân („Ultimele 30
// zile”, „30 zile” pe butoane: few = other = one), „Cash”/„Card” (cuvintele de
// azi, nu „Numerar”), „Cant.”, „· total istoric”.
// Gate-ul fiscal al view-urilor e în DATE (mig 263/267/296) — nimic aici nu-l
// atinge; mesajul „doar pentru restaurantele din România” se traduce (e o
// explicație, nu un document fiscal).
// NU e aici (din `common`): „Reîncearcă”, clasele de erori.
// NU se traduc (date): numele produselor și ale ospătarilor, sumele („lei”,
// `toFixed`, ca azi), orele de pe axa orelor de vârf („14:00”).
// Datele de pe axa zilelor se formatează în limba personalului
// (`staffLocale`; în română EXACT „ro-RO” ZZ.LL, ca înainte), în fusul de azi.
const ro = {
  err_load: 'Eroare la încărcarea statisticilor',
  country_unavailable:
    'Statisticile de încasări se bazează pe datele fiscale și sunt disponibile doar pentru restaurantele din ' +
    'România.',
  period_last: { one: 'Ultimele {n} zile', few: 'Ultimele {n} zile', other: 'Ultimele {n} zile' },
  range_days: { one: '{n} zile', few: '{n} zile', other: '{n} zile' },
  empty_title: 'Nicio comandă în perioada selectată',
  empty_desc: 'Schimbă intervalul de zile sau așteaptă primele comenzi.',
  stat_orders: 'Comenzi',
  stat_revenue: 'Venit',
  stat_avgTicket: 'Bon mediu',
  stat_qrRate: 'Rata QR',
  chart_revenue: 'Venit pe zi',
  chart_orders: 'Comenzi pe zi',
  // Numele seriei din tooltip-ul graficelor.
  series_revenue: 'Venit',
  series_orders: 'Comenzi',
  pie_source: 'Sursă comenzi',
  pie_method: 'Metodă plată',
  src_qr: 'QR',
  src_waiter: 'Ospătar',
  method_cash: 'Cash',
  method_card: 'Card',
  method_voucher: 'Tichete de masă',
  method_online: 'Card online',
  method_other: 'Alte metode',
  hourly_title: 'Ore de vârf',
  hourly_sub: '· ultimele 30 de zile',
  top_title: 'Top produse',
  sub_allTime: '· total istoric',
  col_product: 'Produs',
  col_qty: 'Cant.',
  col_orders: 'Comenzi',
  col_revenue: 'Venit',
  waiters_title: 'Performanță ospătar',
  col_waiter: 'Ospătar',
  col_entered: 'Introduse',
  col_served: 'Servite',
  anonymous: 'Anonim',
}

export default ro
