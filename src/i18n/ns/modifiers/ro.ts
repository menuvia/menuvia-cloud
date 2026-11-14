// Namespace `modifiers` — fila Meniu → Opțiuni (lotul L5b): lista grupurilor
// de opțiuni cu opțiunile lor, dialogul „Grup nou / Editează grup” (cu
// traducerile numelor), „Alege produsele”, confirmările și refuzurile.
// SURSA DE ADEVĂR: en/fr/de au tipul `Translation<typeof ro>`. Româna e
// BYTE-identică cu textele de dinainte — inclusiv pluralele false („Se șterg
// definitiv și cele 1 opțiuni ale lui.”, „Folosit de 20 produse”, „20 produse
// alese”, fără „de”), ghilimelele DREPTE din exemple (`Ex: "Mărime" — …`) și
// cea de închidere din `Ștergi grupul „X"?`, „Se salvează...” cu trei puncte.
// Un plural fals devine cheie PLURALĂ cu formele ro identice.
// NU sunt aici (din `common`): „Anulează”, „Salvează”, „Șterge”, „Editează”,
// „Reîncearcă”; numele limbilor MENIULUI vin din `translations`
// (`menuLangName`, ca în L5a).
// NU se traduc (date): numele grupurilor, opțiunilor și produselor,
// traducerile scrise de patron, sumele (`toLocaleString('ro-RO')` + „lei”, ca
// înainte — banii nu intră în lotul L5b).
const ro = {
  intro: 'Grupuri de opțiuni (ex: Extra sos, Mărime)',
  newGroup: 'Grup nou',
  loadError: 'Nu am putut încărca grupurile de opțiuni.',
  empty_title: 'Niciun grup de opțiuni',
  empty_desc: 'Adaugă primul grup ca să oferi extra-opțiuni la produse (ex: Mărime, Topping-uri).',

  // ── Cardul grupului ──
  card_single: 'Selecție unică',
  card_multiple: 'Selecție multiplă',
  // Plafonul: „ · max {n} opțiune/opțiuni” — separatorul „ · ” stă în cod.
  card_max: { one: 'max {n} opțiune', few: 'max {n} opțiuni', other: 'max {n} opțiuni' },
  card_required: 'Obligatoriu',
  card_unused: 'Nu e folosit de niciun produs — clienții nu îl văd',
  card_usedBy: { one: 'Folosit de {n} produs', few: 'Folosit de {n} produse', other: 'Folosit de {n} produse' },
  card_tooFew: '⚠ Prea puține opțiuni disponibile: produsele cu acest grup nu se pot comanda.',
  card_pick: 'Alege produsele',
  card_deleteAria: 'Șterge grup',
  // Sumele: numărul formatat ca înainte (ro-RO), „lei” în toate limbile.
  price_plus: '+{amount} lei',
  price_minus: '−{amount} lei',
  price_included: 'Inclus',
  opt_markUnavailable: 'Marchează indisponibil',
  opt_markAvailable: 'Marchează disponibil',
  opt_available: 'Disponibil',
  opt_unavailable: 'Indisponibil',
  opt_deleteAria: 'Șterge opțiune',
  opt_namePh: 'Nume opțiune',
  opt_nameAria: 'Nume opțiune nouă pentru grupul {group}',
  opt_pricePh: '+lei',
  opt_priceAria: 'Preț suplimentar pentru opțiunea nouă din grupul {group}',
  opt_add: 'Adaugă',

  // ── „Alege produsele” ──
  pick_title: 'Produsele cu „{group}”',
  pick_desc: 'Bifează produsele la care clientul și ospătarul aleg din acest grup.',
  pick_search: 'Caută produs',
  pick_noProducts: 'Nu ai încă produse.',
  pick_noMatch: 'Niciun produs găsit.',
  pick_count: { one: '{n} produs ales', few: '{n} produse alese', other: '{n} produse alese' },

  // ── Dialogul grupului ──
  edit_title: 'Editează grup',
  field_name: 'Nume *',
  field_namePh: 'Extra topping',
  field_type: 'Tip selecție',
  type_single: 'O singură opțiune',
  type_multiple: 'Mai multe opțiuni',
  type_singleHint: 'Ex: "Mărime" — client alege Mică SAU Medie SAU Mare',
  type_multipleHint: 'Ex: "Topping-uri" — client poate alege mai multe deodată',
  field_max: 'Număr maxim de opțiuni',
  field_maxPh: 'Nelimitat',
  field_maxHint: 'Câte opțiuni poate bifa clientul. Lasă gol pentru nelimitat.',
  field_required: 'Trebuie clientul să aleagă?',
  req_yes: 'Da, obligatoriu',
  req_no: 'Nu, opțional',
  req_yesHint: 'Clientul nu poate adăuga produsul în coș fără să aleagă ceva',
  req_noHint: 'Clientul poate sări peste această secțiune',
  tr_title: 'Traduceri',
  // Eticheta rândului grupului când numele e încă gol.
  tr_groupFallback: 'Grup',
  saving: 'Se salvează...',

  // ── Confirmările ──
  del_title: 'Ștergi grupul „{name}"?',
  del_descOptions: {
    one: 'Se șterg definitiv și cele {n} opțiuni ale lui.',
    few: 'Se șterg definitiv și cele {n} opțiuni ale lui.',
    other: 'Se șterg definitiv și cele {n} opțiuni ale lui.',
  },
  del_descNone: 'Acțiunea nu poate fi anulată.',
  lastOff_title: 'Nicio opțiune disponibilă în „{group}”?',
  lastOff_desc: {
    one: 'Grupul e obligatoriu: cele {n} produs care îl folosește nu se va mai putea comanda până marchezi din nou o opțiune disponibilă.',
    few: 'Grupul e obligatoriu: cele {n} produse care îl folosesc nu se vor mai putea comanda până marchezi din nou o opțiune disponibilă.',
    other:
      'Grupul e obligatoriu: cele {n} produse care îl folosesc nu se vor mai putea comanda până marchezi din nou o opțiune disponibilă.',
  },

  // ── Validarea și refuzurile (în română `toUserMessage(err, rezerva)`) ──
  err_nameRequired: 'Numele e obligatoriu',
  err_optionTr: 'Traducerea opțiunii „{name}” nu a fost salvată.',
  err_pickSave: 'Nu am putut salva produsele grupului.',
  // Hint-urile `set_modifier_group_products` (mig 319) — DOAR în altă limbă
  // decât româna (în română rămâne textul serverului, ca înainte).
  hint_groupNotFound: 'Grupul de opțiuni nu mai există. Închide fereastra și reîncarcă pagina.',
  hint_productNotFound: 'Un produs bifat nu mai există. Închide fereastra și reîncarcă pagina.',
  hint_duplicateProducts: 'Un produs apare de două ori. Închide fereastra și redeschide-o.',
}

export default ro
