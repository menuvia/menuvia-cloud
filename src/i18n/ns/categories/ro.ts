// Namespace `categories` — fila Meniu → Categorii (lotul L5b): lista, modalul
// „Adaugă / Editează categorie” cu editorul MANUAL de traduceri și dialogul de
// ștergere cu mutarea produselor.
// SURSA DE ADEVĂR: en/fr/de au tipul `Translation<typeof ro>`. Româna e
// BYTE-identică cu textele de dinainte — inclusiv pluralele false („1
// categorii”, „20 produse”, „Mută cele 20 produse…”, fără „de”), „Se
// salvează…”/„Se șterge…” cu ellipsis. Un plural fals devine cheie PLURALĂ cu
// formele ro identice, ca franceza/germana să poată acorda.
// NU sunt aici (din `common`): „Anulează”, „Salvează”, „Șterge”; numele
// limbilor MENIULUI vin din `translations` (`menuLangName`, ca în L5a).
// NU se traduc (date): numele și emoji-ul categoriilor, textul italic scris de
// patron, traducerile lui, mesajul brut al erorii `useCategories` (doar
// rezerva „Eroare necunoscută”, ca în fila Produse).
const ro = {
  unknownError: 'Eroare necunoscută',
  count: { one: '{n} categorii', few: '{n} categorii', other: '{n} categorii' },
  add: 'Adaugă categorie',
  empty_title: 'Nicio categorie',
  empty_desc: 'Adaugă prima categorie ca să-ți organizezi meniul.',
  // `{count} produs{count !== 1 ? 'e' : ''}` — fără „de” la 20.
  productsCount: { one: '{n} produs', few: '{n} produse', other: '{n} produse' },
  moveUp: 'Mută mai sus',
  moveDown: 'Mută mai jos',
  editAria: 'Editează categorie',
  deleteAria: 'Șterge categorie',

  // ── Refuzurile serverului (în română `toUserMessage(err, rezerva)`) ──
  err_order: 'Ordinea nu a putut fi salvată.',
  err_save: 'Categoria nu a putut fi salvată.',
  err_move: 'Produsele nu au putut fi mutate.',
  err_delete: 'Nu s-a putut șterge categoria.',
  toast_added: 'Categorie adăugată',
  toast_updated: 'Actualizat',
  toast_deleted: 'Ștearsă',

  // ── Modalul de categorie ──
  modal_titleEdit: 'Editează categorie',
  modal_titleAdd: 'Adaugă categorie',
  field_name: 'Nume *',
  field_nameAria: 'Nume categorie',
  field_namePh: 'Feluri principale',
  field_emoji: 'Emoji',
  field_meta: 'Text italic sub titlu (opțional)',
  field_metaAria: 'Text italic sub titlu',
  field_metaPh: 'ex: Servit până la ora 13:00',
  field_metaHint: 'Afișat pe meniul public sub numele categoriei.',
  tr_title: 'Traduceri',
  tr_optional: '(opțional)',
  // {lang} = limba de BAZĂ a meniului (`menuLangName`; în română numele limbii
  // în limba ei — „English”, „Română” —, ca înainte).
  tr_desc:
    'Numele categoriei în limbile active ale meniului. Câmpurile lăsate goale afișează automat numele în {lang}.',
  tr_label: '{flag} Nume ({lang})',
  tr_aria: 'Nume ({lang})',
  saving: 'Se salvează…',
  saveError: 'Nu s-a putut salva categoria: {error}',

  // ── Ștergerea ──
  del_title: 'Șterge categorie',
  del_checking: 'Verific produsele categoriei…',
  del_empty: 'Categoria nu are produse.',
  // one = „produsul” (n = 1); restul cu numărul, fără „de” la 20.
  del_move: {
    one: 'Mută produsul acestei categorii în:',
    few: 'Mută cele {n} produse ale acestei categorii în:',
    other: 'Mută cele {n} produse ale acestei categorii în:',
  },
  del_moveAria: 'Mută produsele în',
  del_none: 'Nicio categorie (nu vor apărea în meniu)',
  del_noneNote: 'Fără categorie, produsele nu apar în meniul clienților până nu le alegi una.',
  deleting: 'Se șterge…',
}

export default ro
