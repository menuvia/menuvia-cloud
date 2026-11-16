// Namespace `locations` — fila „Toate locațiile” (lotul L6b): LocationsTab cu
// introducerea, stările (încărcare, eroare, rezumat indisponibil, nicio
// locație), cardul fiecărui local (cifrele zilei, „Deschisă acum”,
// „Deschide”) și „Ultima comandă”, compusă de `formatLastOrderT`
// (lib/locations.ts — varianta românească `formatLastOrder` de acolo rămâne
// oracolul: „azi, 14:32” / „ieri, 23:10” / „31.10.2026, 12:05”).
// SURSA DE ADEVĂR: en/fr/de au tipul `Translation<typeof ro>`. Româna e
// BYTE-identică cu textele de dinainte.
// NU e aici (din `common`): „Reîncearcă”.
// NU se traduc (date): numele locațiilor, cifrele, suma încasărilor (bani,
// `fmtPrice` în RON ca azi), ora (în fusul în care serverul a judecat „azi”,
// `day_time_zone` — lotul G2b).
const ro = {
  intro:
    'Ziua de azi în fiecare locație pe care o administrezi. Cifrele se calculează la deschiderea ' +
    'ecranului.',
  err_open: 'Nu am putut deschide locația. Reîncearcă.',
  err_load: 'Nu am putut încărca locațiile. Reîncearcă.',
  unavailable:
    'Rezumatul locațiilor nu este încă disponibil. Poți comuta între locații din selectorul de ' +
    'restaurant din bara laterală.',
  empty: 'Nu am găsit nicio locație pe care o administrezi.',
  current: 'Deschisă acum',
  stat_ordersToday: 'Comenzi azi',
  stat_open: 'Deschise acum',
  stat_revenue: 'Încasări azi',
  stat_last: 'Ultima comandă',
  open: 'Deschide',
  open_aria: 'Deschide {name}',
  // `formatLastOrderT`: `{time}` = HH:mm, `{date}` = ziua (în română ZZ.LL.AAAA).
  last_none: 'Nicio comandă încă',
  last_today: 'azi, {time}',
  last_yesterday: 'ieri, {time}',
  last_date: '{date}, {time}',
}

export default ro
