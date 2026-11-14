import type { Translation } from '../../core'
import type ro from './ro'

// „Sie”, Schaltflächen im Infinitiv; das Menü ist die „Speisekarte”, „plan”
// ist „Tarif”, KI statt AI. Die Sprachen der Speisekarte heißen wie im Satz
// („auf Deutsch”).
const de: Translation<typeof ro> = {
  menuLang_ro: 'Rumänisch',
  menuLang_en: 'Englisch',
  menuLang_de: 'Deutsch',
  menuLang_fr: 'Französisch',
  menuLang_it: 'Italienisch',
  menuLang_hu: 'Ungarisch',
  menuLang_es: 'Spanisch',

  field_name: 'Name',
  field_description: 'Beschreibung',
  field_meta_text: 'Untertitel',
  fieldIn: '{field} ({lang})',
  fieldAria: '{field} auf {lang} für „{name}“',
  aiMark: '✨ automatisch übersetzt — bitte prüfen',
  toReview: '{n} zu prüfen',

  row_saved: '✓ Gespeichert',
  row_confirm: 'Bestätigen',
  row_fromGroup: 'aus der Gruppe „{group}“',

  pt_title: 'Übersetzungen',
  pt_optional: '(optional)',
  pt_langsCount: '{done}/{total} Sprachen',
  pt_intro:
    'Name und Beschreibung in anderen Sprachen. Das Original oben ({base}) bleibt die Grundlage — leer gelassene Felder zeigen automatisch das Original.',
  pt_auto: '✨ Automatisch übersetzen',
  pt_allDone: 'Alle Sprachen haben bereits Name und Beschreibung.',
  pt_autoHint: 'Füllt nur die leeren Felder aus; Ihr Text bleibt.',
  pt_reviewed: 'Als geprüft markieren',
  pt_namePlaceholder: 'Produktname',
  pt_descPlaceholder: 'Produktbeschreibung',
  pt_noNew: 'Keine neuen Übersetzungen erhalten. Versuchen Sie es erneut.',
  pt_filled: {
    one: '{n} Feld ausgefüllt — prüfen Sie es und tippen Sie dann auf „Speichern“.',
    other: '{n} Felder ausgefüllt — prüfen Sie sie und tippen Sie dann auf „Speichern“.',
  },
  pt_aiFailed: 'Die automatische Übersetzung ist fehlgeschlagen. Versuchen Sie es erneut.',

  ex_toggle: 'Übersetzungen {done}/{total}',
  ex_hint: 'Wird sofort gespeichert, getrennt von „Speichern“.',
  ex_save: 'Übersetzungen speichern',
  ex_saved: 'Die Übersetzungen des Extras wurden gespeichert.',
  ex_failed: 'Die Übersetzungen des Extras wurden nicht gespeichert.',

  kind_category: 'Kategorie',
  kind_product: 'Produkt',
  kind_group: 'Optionsgruppe',
  kind_option: 'Option',
  kind_extra: 'Extra',
  sec_categories: 'Kategorien',
  sec_products: 'Produkte',
  sec_options: 'Optionen',
  sec_extras: 'Extras',
  tab_onlyBase: 'Die Speisekarte gibt es nur auf {lang}',
  tab_pickLangsAdmin:
    'Wählen Sie weitere Sprachen unter Einstellungen → Aussehen der Speisekarte → Sprachen der Speisekarte.',
  tab_pickLangsOwner: 'Der Inhaber wählt die Sprachen der Speisekarte in den Einstellungen.',
  tab_pickLangs: 'Sprachen wählen',
  tab_loadFailed: 'Die Speisekarte konnte nicht geladen werden.',
  tab_noProducts: 'Die Speisekarte hat noch keine für Gäste sichtbaren Produkte.',
  tab_intro:
    'Die Speisekarte ist auf {base} verfasst (Ausgangssprache). Hier ergänzen und prüfen Sie die Übersetzungen für die Sprachen, die Gästen angeboten werden.',
  tab_langGroup: 'Sprache der Übersetzung',
  tab_missing: { one: '{n} fehlt', other: '{n} fehlen' },
  tab_complete: '✓ vollständig',
  tab_progress: {
    one: '{done} von {n} Text übersetzt ({pct} %)',
    other: '{done} von {n} Texten übersetzt ({pct} %)',
  },
  tab_guestsSee: 'Gäste sehen die Speisekarte auf {lang}',
  tab_guestsDont: 'Gäste sehen diese Sprache noch nicht: Übersetzen Sie mindestens eine Kategorie oder ein Produkt',
  tab_aiMissing: '✨ Fehlendes automatisch übersetzen ({n})',
  tab_preview: 'Vorschau auf {lang}',
  tab_appearsAfter: 'Sie erscheint für Gäste nach der ersten Übersetzung einer Kategorie oder eines Produkts.',
  tab_flipbook: 'Beim Flipbook-Stil sehen Gäste die hochgeladenen Seiten, nicht die Texte.',
  tab_planUnknown:
    'Wir wissen noch nicht, ob der Tarif Optionen und Extras enthält, deshalb werden sie hier nicht gezählt.',
  tab_truncated:
    'Die Speisekarte hat mindestens {n} Produkte oder Kategorien. Dieser Bildschirm sieht nur die ersten {n} und kann daher nicht sagen, dass alles übersetzt ist.',
  tab_completeAll: 'Die Speisekarte ist vollständig auf {lang} übersetzt.',
  tab_filterGroup: 'Welche Zeilen angezeigt werden',
  tab_fMissing: 'Fehlend ({n})',
  tab_fReview: 'Zu prüfen ({n})',
  tab_fAll: 'Alle',
  tab_searchLabel: 'Im Original und in der Übersetzung suchen',
  tab_searchPlaceholder: 'Suchen…',
  tab_optLoading: 'Optionen und Extras werden geladen…',
  tab_optError: 'Optionen und Extras: {error}',
  tab_optLoadFailed: 'Die Optionen und Extras konnten nicht gelesen werden.',
  tab_noMatch: 'Keine Zeile passt zur Suche.',
  tab_nothingReview: 'Auf {lang} gibt es nichts zu prüfen.',
  tab_nothing: 'Hier gibt es nichts anzuzeigen.',
  tab_showMore: '{n} weitere anzeigen',
  tab_unsaved: {
    one: 'Sie haben {n} nicht gespeicherte Zeile',
    other: 'Sie haben {n} nicht gespeicherte Zeilen',
  },
  tab_saveAll: 'Alle speichern',
  tab_saveFailed: 'Die Übersetzung wurde nicht gespeichert. Versuchen Sie es erneut.',
  tab_confirmFailed: 'Die Übersetzung konnte nicht bestätigt werden. Versuchen Sie es erneut.',
  tab_aiTitle: '✨ Automatische Übersetzungen',

  err_notInMenu: 'Dieses Element ist nicht mehr auf der Speisekarte.',
  err_aiQuota: 'Der KI-Assistent hat zu viele Anfragen erhalten oder das Kontingent ist aufgebraucht. Versuchen Sie es später erneut.',
  err_aiSession: 'Ihre Sitzung ist abgelaufen. Melden Sie sich erneut an.',
  err_aiForbidden: 'Sie dürfen den KI-Assistenten für dieses Restaurant nicht verwenden.',
  err_aiUnavailable: 'Der KI-Assistent ist für dieses Restaurant gerade nicht verfügbar.',
  err_aiBusy: 'Der KI-Assistent konnte gerade nicht antworten. Versuchen Sie es in einigen Augenblicken erneut.',
}

export default de
