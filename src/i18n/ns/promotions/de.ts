import type { Translation } from '../../core'
import type ro from './ro'

// „Sie”, Schaltflächen im Infinitiv; „reducere” ist der „Rabatt” (wie
// `payments`), „ospătar” die „Servicekraft”. Gedankenstrich „—”.
const de: Translation<typeof ro> = {
  loading: 'Regeln werden geladen…',
  intro_payAtTable:
    'Automatische Rabattregeln nach Uhrzeit und Wochentag. Die Servicekraft sieht beim Bezahlen eine Schaltfläche „Aktion anwenden“, wenn eine Regel aktiv ist.',
  intro_auto:
    'Automatische Rabattregeln nach Uhrzeit und Wochentag. Der Rabatt gilt automatisch für Bestellungen über das QR-Menü und für Abholbestellungen, solange die Regel aktiv ist.',
  newRule: 'Neue Regel',
  closeError: 'Fehler schließen',
  activeNow: { one: 'JETZT AKTIV', other: 'JETZT AKTIV ({n})' },
  value_pct: '{value} %',
  value_amount: '{value} lei',
  empty_title: 'Noch keine Regeln',
  empty_payAtTable:
    'Legen Sie die erste Regel an (z. B. „Happy Hour 17–19 Uhr, −20 % auf alles“), und das System schlägt den Rabatt in diesem Zeitraum beim Bezahlen automatisch vor.',
  empty_auto:
    'Legen Sie die erste Regel an (z. B. „Happy Hour 17–19 Uhr, −20 % auf alles“), und der Rabatt gilt in diesem Zeitraum automatisch für Bestellungen über die Speisekarte.',
  firstRule: 'Erste Regel',

  days_all: 'Alle Tage',
  scope_all: 'Auf alles',
  status_active: 'AKTIV',
  status_off: 'AUS',
  card_offPct: '−{value} %',
  card_offAmount: '−{value} lei',
  card_cap: '(max. {amount} lei)',
  stop: 'Ausschalten',
  start: 'Einschalten',
  deleteAria: 'Regel {name} löschen',

  day_1: 'So',
  day_2: 'Mo',
  day_3: 'Di',
  day_4: 'Mi',
  day_5: 'Do',
  day_6: 'Fr',
  day_7: 'Sa',

  edit_title: 'Regel bearbeiten',
  field_name: 'Name *',
  field_namePh: 'z. B. Happy Hour 17–19 Uhr',
  field_from: 'Von',
  field_to: 'Bis',
  field_days: 'Wochentage (leer = alle)',
  days_reset: 'Zurücksetzen',
  field_scope: 'Gilt für',
  scope_category: 'Kategorie',
  scope_product: 'Produkt',
  pick_category: '— Kategorie auswählen —',
  pick_product: '— Produkt auswählen —',
  field_discount: 'Rabatt',
  type_pct: 'Prozent (%)',
  type_amount: 'Fester Betrag (lei)',
  field_value: 'Wert',
  field_valueAria: 'Rabattwert',
  field_cap: 'Höchstbetrag (lei, optional)',
  field_capPh: 'Max. lei (optional)',
  field_capAria: 'Höchstbetrag in lei, optional',
  field_active: 'Regel sofort aktiv',
  saveChanges: 'Änderungen speichern',
  create: 'Regel anlegen',
  err_name: 'Der Name ist erforderlich',
  err_value: 'Der Rabattwert muss positiv sein',
  err_pctMax: 'Höchstens 100 %',
  err_category: 'Wählen Sie eine Kategorie',
  err_product: 'Wählen Sie ein Produkt',
  err_save: 'Fehler beim Speichern',

  del_title: 'Regel löschen?',
  del_question: 'Möchten Sie {name} löschen? Dies kann nicht rückgängig gemacht werden.',
}

export default de
