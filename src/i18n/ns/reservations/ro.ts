// Namespace `reservations` — fila Rezervări a panoului (lotul L6a):
// ReservationsTab cu contorul intervalului, cardul „Butonul tău Google”,
// secțiunea „Neconfirmate / expirate” (mig 289), filtrele, lista pe zile,
// cardul rezervării (statusul, badge-ul de no-show, acțiunile, confirmările,
// mesajele de după acțiune) și setările rezervărilor. Plus etichetele de status
// citite de `reservationStatusLabelT` și contoarele lui `reservationCountT`
// (lib/reservationsLang.ts). Chunk propriu: fila e LENEȘĂ în DashboardPage.
// SURSA DE ADEVĂR: en/fr/de au tipul `Translation<typeof ro>`. Româna e
// BYTE-identică cu textele de dinainte — inclusiv ghilimeaua DREAPTĂ de
// închidere din „Debifează „Doar în așteptare" …” și din „Deții această
// companie?" (Google), ghilimelele drepte ale cererii speciale (`"…"`), „Se
// salvează...” cu trei puncte și pluralele FALSE ale badge-ului („1 no-show”).
// Contoarele `count_*`/`party` NU se aleg pe `Intl.PluralRules` în română: le
// alege `reservationCountT` cu regula veche a lui `plural()` (diferă de CLDR la
// 101, 201…: „101 de rezervări”), deci formele ro sunt exact cele de dinainte.
// Glosar (aliniat cu `waiter`/`dashboard`): rezervare = reservation /
// réservation / Reservierung; masă = table / table / Tisch; persoană = guest /
// personne / Person; zonă = area / zone / Bereich; no-show = No-show / Absent /
// No-Show; „așezat la masă” = seated / installée / platziert.
// NU sunt aici (din `common`): „Reîncearcă”, „Anulează” (butonul de renunțare
// din confirmări).
// NU se traduc (date): numele/telefonul/emailul oaspetelui, codul de
// confirmare, numele și zona mesei, zona cerută, cererea specială, statusurile
// din DB (se traduce doar AFIȘAREA lor), adresa linkului public.
const ro = {
  // ── Contoarele (regula veche în română, vezi antetul) ──
  count_inRange: {
    one: '{n} rezervare în interval',
    few: '{n} rezervări în interval',
    other: '{n} de rezervări în interval',
  },
  stale_title: {
    one: 'Neconfirmate / expirate: {n} rezervare din trecut',
    few: 'Neconfirmate / expirate: {n} rezervări din trecut',
    other: 'Neconfirmate / expirate: {n} de rezervări din trecut',
  },
  party: { one: '{n} persoană', few: '{n} persoane', other: '{n} de persoane' },

  // ── Statusurile (enum `reservation_status`; DATE în DB, traduse la afișare).
  //    În română EXACT `RESERVATION_STATUS_LABEL` din lib/reservations.ts. ──
  status_pending: 'În așteptare',
  status_confirmed: 'Confirmată',
  status_seated: 'La masă',
  status_completed: 'Finalizată',
  status_cancelled: 'Anulată',
  status_no_show: 'No-show',
  status_expired: 'Expirată',

  // ── Secțiunea „Neconfirmate / expirate” (mig 289) ──
  stale_aria: 'Rezervări neconfirmate sau expirate',
  stale_show: 'Arată',
  stale_hide: 'Ascunde',
  stale_desc:
    'Rezervări rămase fără răspuns (expirate automat după 2 ore) și confirmate nefinalizate de peste 48 de ore — nu depind de intervalul ales mai sus.',

  // ── Filtrele ──
  filter_today: 'Azi',
  filter_tomorrow: 'Mâine',
  filter_week: 'Săptămâna asta',
  filter_dateAria: 'Alege o zi anume',
  filter_pendingOnly: 'Doar în așteptare',
  refresh: 'Reîmprospătează',

  // ── Lista ──
  load_error: 'Nu am putut încărca rezervările.',
  empty_pendingTitle: 'Nicio rezervare în așteptare',
  empty_pendingDesc: 'Debifează „Doar în așteptare" ca să vezi toate rezervările din interval',
  empty_title: 'Nicio rezervare în intervalul ales',
  empty_desc: 'Schimbă filtrul de dată sau verifică setările',

  // ── Acțiunile, confirmările și mesajele de după ──
  act_confirm: 'Confirmă',
  act_seat: 'Așază la masă',
  act_complete: 'Finalizează',
  act_noShow: 'No-show',
  act_cancel: 'Anulează',
  confirm_cancelTitle: 'Anulezi rezervarea?',
  confirm_noShowTitle: 'Marchezi ca no-show?',
  confirm_desc: 'Acțiunea nu poate fi anulată din aplicație.',
  confirm_cancelLabel: 'Anulează rezervarea',
  confirm_noShowLabel: 'Marchează no-show',
  done_confirmed: 'Rezervare confirmată',
  done_seated: 'Clienții au fost așezați la masă',
  done_cancelled: 'Rezervare anulată',
  done_noShow: 'Rezervare marcată ca no-show',
  done_completed: 'Rezervare finalizată',
  err_update: 'Rezervarea nu a putut fi actualizată.',

  // ── Cardul rezervării ── (pluralele false ale badge-ului, ca înainte)
  noShow_title: {
    one: 'Acest număr de telefon are {n} no-show în istoric',
    few: 'Acest număr de telefon are {n} no-show în istoric',
    other: 'Acest număr de telefon are {n} no-show în istoric',
  },
  noShow_badge: { one: '⚠ {n} no-show', few: '⚠ {n} no-show', other: '⚠ {n} no-show' },
  zone_requested: 'zonă cerută: {zone}',
  special: '"{text}"',

  // ── „Butonul tău Google” ── ({site}/{edit}/{section}/{doc} = elemente
  //    evidențiate; „Editează profilul”/„Rezervări”/„Deții această companie?"
  //    sunt etichetele interfeței Google în limba respectivă)
  google_title: 'Butonul tău Google',
  google_copy: 'Copiază',
  google_copied: 'Copiat ✓',
  google_showSteps: 'Cum îl pun pe Google?',
  google_hideSteps: 'Ascunde pașii',
  google_step1:
    'Intră pe {site} cu contul care administrează profilul localului (dacă nu l-ai revendicat încă, apasă „Deții această companie?" pe fișa din Google).',
  google_step2: 'Alege profilul → {edit} → secțiunea {section} → adaugă linkul de mai sus.',
  google_step2Edit: 'Editează profilul',
  google_step2Section: 'Rezervări',
  google_step3: 'Salvează — în câteva zile, butonul de rezervare apare pe Google Search și Maps. Detalii: {doc}.',

  // ── Setările rezervărilor ──
  settings_title: 'Setări rezervări',
  settings_loadError: 'Nu am putut încărca setările de rezervări.',
  settings_saved: 'Setări salvate',
  settings_saveError: 'Rezervarea nu a putut fi salvată.',
  set_open: 'Ora deschidere',
  set_close: 'Ora închidere',
  set_slot: 'Interval slot (min)',
  set_duration: 'Durata rezervării (min)',
  set_minAdvance: 'Rezervare cu minim (ore înainte)',
  set_maxAdvance: 'Se poate rezerva cu maxim (zile înainte)',
  set_maxParty: 'Max persoane / rezervare',
  set_reminder: 'Reminder cu (ore înainte)',
  set_reminderNone: 'Fără',
  set_autoConfirm: 'Confirmare automată',
  set_on: 'Activat',
  set_off: 'Dezactivat',
  // Opțiunile select-urilor: „15 min” / „6h”.
  set_minutes: '{n} min',
  set_hours: '{n}h',
  saving: 'Se salvează...',
  save_settings: 'Salvează setări',
}

export default ro
