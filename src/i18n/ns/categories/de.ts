import type { Translation } from '../../core'
import type ro from './ro'

// „Sie”, Schaltflächen im Infinitiv; das Menü ist die „Speisekarte”
// (wie `products`), „client” ist der „Gast”.
const de: Translation<typeof ro> = {
  unknownError: 'Unbekannter Fehler',
  count: { one: '{n} Kategorie', other: '{n} Kategorien' },
  add: 'Kategorie hinzufügen',
  empty_title: 'Keine Kategorien',
  empty_desc: 'Fügen Sie die erste Kategorie hinzu, um Ihre Speisekarte zu gliedern.',
  productsCount: { one: '{n} Produkt', other: '{n} Produkte' },
  moveUp: 'Nach oben verschieben',
  moveDown: 'Nach unten verschieben',
  editAria: 'Kategorie bearbeiten',
  deleteAria: 'Kategorie löschen',

  err_order: 'Die Reihenfolge konnte nicht gespeichert werden.',
  err_save: 'Die Kategorie konnte nicht gespeichert werden.',
  err_move: 'Die Produkte konnten nicht verschoben werden.',
  err_delete: 'Die Kategorie konnte nicht gelöscht werden.',
  toast_added: 'Kategorie hinzugefügt',
  toast_updated: 'Aktualisiert',
  toast_deleted: 'Gelöscht',

  modal_titleEdit: 'Kategorie bearbeiten',
  modal_titleAdd: 'Kategorie hinzufügen',
  field_name: 'Name *',
  field_nameAria: 'Name der Kategorie',
  field_namePh: 'Hauptgerichte',
  field_emoji: 'Emoji',
  field_meta: 'Kursiver Text unter dem Titel (optional)',
  field_metaAria: 'Kursiver Text unter dem Titel',
  field_metaPh: 'z. B. Serviert bis 13:00 Uhr',
  field_metaHint: 'Wird auf der öffentlichen Speisekarte unter dem Kategorienamen angezeigt.',
  tr_title: 'Übersetzungen',
  tr_optional: '(optional)',
  tr_desc:
    'Der Kategoriename in den aktiven Sprachen der Speisekarte. Leer gelassene Felder zeigen automatisch den Namen auf {lang}.',
  tr_label: '{flag} Name ({lang})',
  tr_aria: 'Name ({lang})',
  saving: 'Wird gespeichert…',
  saveError: 'Die Kategorie konnte nicht gespeichert werden: {error}',

  del_title: 'Kategorie löschen',
  del_checking: 'Produkte der Kategorie werden geprüft…',
  del_empty: 'Die Kategorie hat keine Produkte.',
  del_move: {
    one: 'Das Produkt dieser Kategorie verschieben nach:',
    other: 'Die {n} Produkte dieser Kategorie verschieben nach:',
  },
  del_moveAria: 'Produkte verschieben nach',
  del_none: 'Keine Kategorie (sie erscheinen nicht auf der Speisekarte)',
  del_noneNote:
    'Ohne Kategorie erscheinen die Produkte nicht auf der Speisekarte der Gäste, bis Sie ihnen eine zuweisen.',
  deleting: 'Wird gelöscht…',
}

export default de
