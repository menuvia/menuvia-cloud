// Namespace `common` — acțiuni și erori comune tuturor ecranelor personalului.
// SURSA DE ADEVĂR: en/fr/de au tipul `Translation<typeof ro>`.
// Erorile `err_*` sunt EXACT textele din `lib/userMessages.ts` (testul SE5):
// în română `describeStaffError` = `toUserMessage`, deci nu au voie să difere.
const ro = {
  save: 'Salvează',
  cancel: 'Anulează',
  close: 'Închide',
  retry: 'Reîncearcă',
  delete: 'Șterge',
  edit: 'Editează',
  back: 'Înapoi',
  loading: 'Se încarcă…',
  // Marcajul de pe cardurile ale căror comutatoare scriu imediat (sharedUI, lotul R2).
  autoSaveHint: '· se salvează automat',
  err_generic: 'Acțiunea nu a putut fi finalizată. Reîncearcă.',
  err_network: 'Fără conexiune. Verifică internetul și reîncearcă.',
  err_permission: 'Nu ai drepturi pentru această acțiune.',
  err_not_found: 'Elementul nu mai există sau nu ai acces la el.',
  err_duplicate: 'Există deja un element cu aceste date.',
  err_forbidden: 'Acțiune nepermisă pentru rolul tău.',
  // Vârsta unei comenzi (`elapsedT`, src/i18n/elapsed.ts) — în română EXACT
  // textele de dinainte ale lui `elapsed()` (șters în L4c): „30s”, „5m”, „1h 30m”.
  elapsed_s: '{n}s',
  elapsed_m: '{n}m',
  elapsed_hm: '{h}h {m}m',
  // ── „Ieși din cont” (SignOutButton — Panou, Ospătar, Bucătărie; lotul L4c) ──
  signOut: 'Ieși din cont',
  signOut_busy: 'Se iese…',
  signOut_confirmTitle: 'Ieși din cont?',
  signOut_confirmDesc: 'Pe acest dispozitiv va trebui să te autentifici din nou.',
  signOut_failed: 'Nu am putut ieși din cont. Reîncearcă.',
  // ── Comutatorul de limbă (UiLanguageCard în Setări + varianta compactă
  //    UiLanguageSelect din antetul Ospătarului/Bucătăriei, lotul L4c; mutate
  //    din `dashboard` ca Ospătarul și Bucătăria să nu încarce panoul) ──
  lang_title: 'Limba interfeței',
  lang_saving: 'Se salvează…',
  lang_saveFailed: 'Limba nu s-a putut salva. Reîncearcă.',
  // 42703: coloana `profiles.ui_language` (mig 323) lipsește — clientul a
  // ajuns înaintea migrației.
  lang_columnMissing:
    'Limba nu se poate salva încă în cont: serverul nu are ultima actualizare. Panoul rămâne în limba de acum.',
  // Varianta SCURTĂ a lui 42703 pentru comutatorul compact din antetul
  // Ospătarului/Bucătăriei: acolo nu e niciun panou, iar sub select e loc puțin.
  lang_columnMissingShort: 'Limba nu se poate salva încă: serverul nu are ultima actualizare.',
  // Fiecare limbă în limba EI, identic în toate cele patru fișiere.
  lang_name_ro: 'Română',
  lang_name_en: 'English',
  lang_name_fr: 'Français',
  lang_name_de: 'Deutsch',
  items_count: { one: '{n} produs', few: '{n} produse', other: '{n} de produse' },
}

export default ro
