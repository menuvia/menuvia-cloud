import type { Translation } from '../../core'
import type ro from './ro'

// „Sie”, Schaltflächen im Infinitiv; „client” ist der „Gast”, „ospătar” die
// „Servicekraft” (wie `waiter`), „grup de opțiuni” die „Optionsgruppe” (wie
// `products`). Gedankenstrich „—”.
const de: Translation<typeof ro> = {
  intro: 'Optionsgruppen (z. B. Extra-Soße, Größe)',
  newGroup: 'Neue Gruppe',
  loadError: 'Die Optionsgruppen konnten nicht geladen werden.',
  empty_title: 'Keine Optionsgruppen',
  empty_desc: 'Fügen Sie die erste Gruppe hinzu, um bei Produkten Zusatzoptionen anzubieten (z. B. Größe, Toppings).',

  card_single: 'Einfachauswahl',
  card_multiple: 'Mehrfachauswahl',
  card_max: { one: 'max. {n} Option', other: 'max. {n} Optionen' },
  card_required: 'Pflicht',
  card_unused: 'Von keinem Produkt verwendet — Gäste sehen sie nicht',
  card_usedBy: { one: 'Von {n} Produkt verwendet', other: 'Von {n} Produkten verwendet' },
  card_tooFew: '⚠ Zu wenige verfügbare Optionen: Produkte mit dieser Gruppe können nicht bestellt werden.',
  card_pick: 'Produkte auswählen',
  card_deleteAria: 'Gruppe löschen',
  price_plus: '+{amount} lei',
  price_minus: '−{amount} lei',
  price_included: 'Inklusive',
  opt_markUnavailable: 'Als nicht verfügbar markieren',
  opt_markAvailable: 'Als verfügbar markieren',
  opt_available: 'Verfügbar',
  opt_unavailable: 'Nicht verfügbar',
  opt_deleteAria: 'Option löschen',
  opt_namePh: 'Name der Option',
  opt_nameAria: 'Name der neuen Option für die Gruppe {group}',
  opt_pricePh: '+lei',
  opt_priceAria: 'Aufpreis für die neue Option der Gruppe {group}',
  opt_add: 'Hinzufügen',

  pick_title: 'Produkte mit „{group}“',
  pick_desc: 'Haken Sie die Produkte an, bei denen Gast und Servicekraft aus dieser Gruppe wählen.',
  pick_search: 'Produkt suchen',
  pick_noProducts: 'Sie haben noch keine Produkte.',
  pick_noMatch: 'Kein Produkt gefunden.',
  pick_count: { one: '{n} Produkt ausgewählt', other: '{n} Produkte ausgewählt' },

  edit_title: 'Gruppe bearbeiten',
  field_name: 'Name *',
  field_namePh: 'Extra-Topping',
  field_type: 'Auswahlart',
  type_single: 'Eine Option',
  type_multiple: 'Mehrere Optionen',
  type_singleHint: 'Z. B. „Größe“ — der Gast wählt Klein ODER Mittel ODER Groß',
  type_multipleHint: 'Z. B. „Toppings“ — der Gast kann mehrere auf einmal wählen',
  field_max: 'Maximale Anzahl an Optionen',
  field_maxPh: 'Unbegrenzt',
  field_maxHint: 'Wie viele Optionen der Gast ankreuzen kann. Leer lassen für unbegrenzt.',
  field_required: 'Muss der Gast wählen?',
  req_yes: 'Ja, Pflicht',
  req_no: 'Nein, optional',
  req_yesHint: 'Der Gast kann das Produkt nicht in den Warenkorb legen, ohne etwas zu wählen',
  req_noHint: 'Der Gast kann diesen Abschnitt überspringen',
  tr_title: 'Übersetzungen',
  tr_groupFallback: 'Gruppe',
  saving: 'Wird gespeichert…',

  del_title: 'Gruppe „{name}“ löschen?',
  del_descOptions: {
    one: 'Ihre einzige Option wird ebenfalls endgültig gelöscht.',
    other: 'Ihre {n} Optionen werden ebenfalls endgültig gelöscht.',
  },
  del_descNone: 'Dies kann nicht rückgängig gemacht werden.',
  lastOff_title: 'Keine verfügbare Option in „{group}“?',
  lastOff_desc: {
    one: 'Die Gruppe ist Pflicht: Das Produkt, das sie verwendet, kann nicht mehr bestellt werden, bis Sie wieder eine Option als verfügbar markieren.',
    other:
      'Die Gruppe ist Pflicht: Die {n} Produkte, die sie verwenden, können nicht mehr bestellt werden, bis Sie wieder eine Option als verfügbar markieren.',
  },

  err_nameRequired: 'Der Name ist erforderlich',
  err_optionTr: 'Die Übersetzung der Option „{name}“ wurde nicht gespeichert.',
  err_pickSave: 'Die Produkte der Gruppe konnten nicht gespeichert werden.',
  hint_groupNotFound: 'Die Optionsgruppe existiert nicht mehr. Schließen Sie das Fenster und laden Sie die Seite neu.',
  hint_productNotFound: 'Ein angehaktes Produkt existiert nicht mehr. Schließen Sie das Fenster und laden Sie die Seite neu.',
  hint_duplicateProducts: 'Ein Produkt ist doppelt vorhanden. Schließen Sie das Fenster und öffnen Sie es erneut.',
}

export default de
