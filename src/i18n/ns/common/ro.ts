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
  items_count: { one: '{n} produs', few: '{n} produse', other: '{n} de produse' },
}

export default ro
