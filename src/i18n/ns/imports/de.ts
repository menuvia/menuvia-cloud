import type { Translation } from '../../core'
import type ro from './ro'

// „Sie”, Schaltflächen im Infinitiv; „AI” ist „KI”, das Menü ist die
// „Speisekarte”, „plan” ist „Tarif” (wie `products`), „draft” ist der
// „Entwurf” des Imports. Gedankenstrich „—”.
const de: Translation<typeof ro> = {
  money: '{amount} lei',
  done: 'Fertig',

  err_aiQuota:
    'Der KI-Assistent hat zu viele Anfragen erhalten oder das Kontingent ist aufgebraucht. Versuchen Sie es später erneut.',
  err_aiSession: 'Ihre Sitzung ist abgelaufen. Melden Sie sich erneut an.',
  err_aiForbidden: 'Sie dürfen den KI-Assistenten für dieses Restaurant nicht verwenden.',
  err_aiUnavailable: 'Der KI-Assistent ist für dieses Restaurant gerade nicht verfügbar.',
  err_aiBusy: 'Der KI-Assistent konnte gerade nicht antworten. Versuchen Sie es in einigen Augenblicken erneut.',

  ai_title: '📸 Speisekarte aus Fotos importieren',
  ai_tooMany:
    'Sie können höchstens {max} Fotos auf einmal hochladen. Importieren Sie die restlichen Seiten in einer zweiten Runde — die Produkte werden hinzugefügt, nicht ersetzt.',
  ai_unsupported:
    'Eine Datei hat ein nicht unterstütztes Format (z. B. HEIC). Exportieren Sie sie als JPEG/PNG oder machen Sie einen Screenshot der Speisekarte.',
  ai_tooLarge: 'Die Fotos sind selbst komprimiert zu groß. Versuchen Sie es mit weniger Seiten auf einmal.',
  ai_noneFound: 'Auf den Fotos wurden keine Produkte gefunden. Versuchen Sie es mit schärferen Fotos.',
  ai_errProcess: 'Fehler beim Verarbeiten der Fotos.',
  ai_errFileRead: 'Die Datei konnte nicht gelesen werden.',
  ai_errServerLimit:
    'Es wurde nichts gespeichert. {message} Entfernen Sie Häkchen bei einigen Produkten oder wechseln Sie zu einem höheren Tarif.',
  ai_limitReached: 'Sie haben das Produktlimit Ihres Tarifs erreicht.',
  ai_fallbackLead: 'Sie können auch ohne KI weitermachen:',
  ai_fallbackCsv: 'Aus CSV importieren',
  ai_fallbackManual: 'Produkte manuell hinzufügen',
  ai_resume: {
    one: 'Sie haben einen begonnenen Import: {n} erkanntes Produkt, noch nicht gespeichert. Setzen Sie ihn fort oder verwerfen Sie ihn.',
    other:
      'Sie haben einen begonnenen Import: {n} erkannte Produkte, noch nicht gespeichert. Setzen Sie ihn fort oder verwerfen Sie ihn.',
  },
  ai_resumeBtn: 'Import fortsetzen',
  ai_discardBtn: 'Entwurf verwerfen',
  ai_discardTitle: 'Entwurf verwerfen?',
  ai_discardDesc: {
    one: 'Das erkannte, noch nicht gespeicherte Produkt geht endgültig verloren.',
    other: 'Die {n} erkannten, noch nicht gespeicherten Produkte gehen endgültig verloren.',
  },
  ai_uploadIntro:
    'Fotografieren Sie die Speisekarte oder laden Sie bis zu {max} scharfe Fotos ihrer Seiten hoch. Die KI erkennt die Produkte und die Rubriken, danach prüfen und korrigieren Sie alles vor dem Speichern.',
  ai_processing: 'Wird verarbeitet…',
  ai_pickPhotos: 'Fotos auswählen',
  ai_found: {
    one: '{n} Produkt gefunden. Stimmt alles?',
    other: '{n} Produkte gefunden. Stimmt alles?',
  },
  ai_reviewHint: 'Korrigieren Sie, was falsch ist, entfernen Sie Häkchen bei dem, was Sie nicht möchten, und speichern Sie dann.',
  ai_reviewNewSections: 'Mit ➕ markierte Rubriken werden beim Speichern automatisch angelegt.',
  ai_limitFull:
    'Sie haben das Produktlimit Ihres Tarifs erreicht — Sie können keine neuen Produkte hinzufügen. Es wurde nichts gespeichert. Wechseln Sie zu einem höheren Tarif oder löschen Sie vorhandene Produkte.',
  ai_limitAllowed: {
    one: 'Ihr Tarif erlaubt noch {n} Produkt, Sie haben {selected} ausgewählt.',
    other: 'Ihr Tarif erlaubt noch {n} Produkte, Sie haben {selected} ausgewählt.',
  },
  ai_limitUntick: {
    one: 'Entfernen Sie das Häkchen bei {n} Produkt oder wechseln Sie zu einem höheren Tarif. Es wurde noch nichts gespeichert.',
    other:
      'Entfernen Sie die Häkchen bei {n} Produkten oder wechseln Sie zu einem höheren Tarif. Es wurde noch nichts gespeichert.',
  },
  ai_keepWithin: {
    one: 'Erstes Produkt behalten, der Rest bleibt im Entwurf',
    other: 'Erste {n} Produkte behalten, der Rest bleibt im Entwurf',
  },
  ai_namePh: 'Produktname',
  ai_descPh: 'Beschreibung (optional)',
  ai_noCategory: 'Ohne Kategorie',
  ai_newCategory: '➕ {name} (neu)',
  ai_doneSaved: { one: '{n} Produkt gespeichert', other: '{n} Produkte gespeichert' },
  ai_doneIssues: { one: '{n} Problem', other: '{n} Probleme' },
  ai_doneSavedWithIssues: '{saved}, {issues}',
  ai_doneAdded: { one: '{n} Produkt hinzugefügt!', other: '{n} Produkte hinzugefügt!' },
  ai_doneWhere: 'Sie finden sie im Tab Produkte.',
  ai_leftInDraft: {
    one: '{n} Produkt ist noch ungespeichert im Entwurf. Öffnen Sie den Import erneut und tippen Sie auf „Import fortsetzen“.',
    other:
      '{n} Produkte sind noch ungespeichert im Entwurf. Öffnen Sie den Import erneut und tippen Sie auf „Import fortsetzen“.',
  },
  ai_deferred: {
    one: 'Ein Produkt passte nicht mehr in Ihren aktuellen Tarif. Sie speichern es aus dem Entwurf, nachdem Sie zu einem höheren Tarif gewechselt haben.',
    other:
      '{n} Produkte passten nicht mehr in Ihren aktuellen Tarif. Sie speichern sie aus dem Entwurf, nachdem Sie zu einem höheren Tarif gewechselt haben.',
  },
  ai_issueCategory: 'Kategorie „{name}“: konnte nicht angelegt werden (ihre Produkte kommen ohne Kategorie hinzu)',
  ai_issueLimit: 'das Produktlimit des Tarifs wurde erreicht — die restlichen Produkte wurden nicht gespeichert',
  ai_issueProduct: '{name}: konnte nicht gespeichert werden',
  ai_unnamedProduct: 'Produkt ohne Namen',
  ai_saving: 'Wird gespeichert…',
  ai_saveN: { one: '{n} Produkt speichern', other: '{n} Produkte speichern' },

  bulk_title: '✨ Mit KI für die Speisekarte erstellen',
  bulk_intro:
    'Ich ergänze automatisch, was in der Speisekarte fehlt. Alles, was ich erstelle, wird mit „✨ von KI erstellt — bitte prüfen“ markiert, damit Sie es leicht korrigieren können.',
  bulk_images: 'Bilder ({n} ohne Bild)',
  bulk_imagesNote:
    'Funktioniert mit dem Standardanbieter (OpenAI) oder mit Gemini. Mit Claude oder einem eigenen Anbieter werden die Bilder übersprungen, mit einer einzigen Meldung.',
  bulk_nutrition: 'Nährwerte ({n} ohne Werte)',
  bulk_translateIn: {
    one: 'Übersetzungen in {n} Sprache ({todo} zu übersetzen)',
    other: 'Übersetzungen in {n} Sprachen ({todo} zu übersetzen)',
  },
  bulk_trNoteFull:
    'Übersetzt die Namen, Beschreibungen, Optionen und Extras in die Sprachen, die unter Einstellungen → Aussehen der Speisekarte → Sprachen der Speisekarte gewählt sind. Ergänzt nur, was fehlt (überschreibt keine von Hand bearbeiteten Übersetzungen), und markiert die neuen Texte mit „zu prüfen“.',
  bulk_trNoteNames:
    'Übersetzt den Namen + die Beschreibung in die Sprachen, die unter Einstellungen → Aussehen der Speisekarte → Sprachen der Speisekarte gewählt sind. Ergänzt nur, was fehlt (überschreibt keine von Hand bearbeiteten Übersetzungen), und markiert die neuen Texte mit „zu prüfen“.',
  bulk_quotaTitle: 'KI-Kontingent aufgebraucht',
  bulk_doneTitle: 'Fertig!',
  bulk_sumNutrition: { one: '{n} Satz Nährwerte', other: '{n} Sätze Nährwerte' },
  bulk_sumImages: { one: '{n} Bild erstellt', other: '{n} Bilder erstellt' },
  bulk_sumProducts: { one: '{n} Produkt', other: '{n} Produkte' },
  bulk_sumCategories: { one: '{n} Kategorie', other: '{n} Kategorien' },
  bulk_sumOptions: { one: '{n} Option oder Extra', other: '{n} Optionen und Extras' },
  bulk_sumTranslated: '{items} übersetzt',
  bulk_buyCredits: 'Kaufen Sie Guthaben unter Einstellungen → KI-Assistent, um fortzufahren.',
  bulk_reviewAll: '✨ Alles Erstellte ist mit „bitte prüfen“ markiert — korrigieren Sie es im jeweiligen Produkt.',
  bulk_textsTranslated: {
    one: '✨ {n} Text übersetzt — als „zu prüfen“ markiert.',
    other: '✨ {n} Texte übersetzt — als „zu prüfen“ markiert.',
  },
  bulk_openTranslations: 'Übersetzungen prüfen',
  bulk_generating: 'Wird erstellt…',
  bulk_generateFor: { one: 'Für {n} Produkt erstellen', other: 'Für {n} Produkte erstellen' },
  bulk_generateTranslations: 'Übersetzungen erstellen',
  bulk_translating: 'Übersetze {kind} ({n})…',
  bulk_kind_categories: 'Kategorien',
  bulk_kind_products: 'Produkte',
  bulk_kind_groups: 'Optionsgruppen',
  bulk_kind_options: 'Optionen',
  bulk_kind_extras: 'Extras',
  bulk_row_categories: 'Kategorie',
  bulk_row_products: 'Übersetzung',
  bulk_row_groups: 'Gruppe',
  bulk_row_options: 'Option',
  bulk_row_extras: 'Extra',
  bulk_row_nutrition: 'Nährwerte',
  bulk_row_image: 'Bild',
  bulk_errTrStopped: 'Übersetzungen abgebrochen: {reason}',
  bulk_errTrBatch: 'Übersetzung der {kind}: {reason}',
  bulk_errRow: '{name} ({row}): {reason}',
  bulk_errNutritionStopped: 'Erstellung der Nährwerte abgebrochen: {reason} Die übrigen Produkte wurden übersprungen.',
  bulk_errImagesStopped: 'Bilderstellung abgebrochen: {reason} Die übrigen Produkte wurden übersprungen.',
  bulk_errGeneric: 'Fehler beim Erstellen.',
  bulk_errNoImages:
    'Bilder lassen sich nur mit OpenAI oder Gemini erstellen. Wechseln Sie den Anbieter unter Einstellungen → KI-Assistent.',

  csv_title: '📥 Produkte aus CSV importieren',
  csv_subtitle: 'Praktisch für den schnellen Umzug aus einer anderen Software (SmartBill, Octopus, eine selbst gepflegte Excel-Datei).',
  csv_formatTitle: 'Erwartetes Format (CSV mit Kopfzeile):',
  csv_columnsLabel: 'Spalten:',
  csv_columnsNote:
    '{columns} {name}, {category} und {price} sind Pflicht. Fehlende Kategorien werden automatisch angelegt.',
  csv_vatNote: 'MwSt. = 1-4 (Standard 1).',
  csv_downloadTemplate: '📄 CSV-Vorlage herunterladen',
  csv_templateFile: 'menuvia-produkte-vorlage.csv',
  csv_uploadFile: '📁 CSV-Datei hochladen',
  csv_pasteLead: 'Oder fügen Sie die CSV direkt ein:',
  csv_detected: { one: '{count} Zeile erkannt:', other: '{count} Zeilen erkannt:' },
  csv_valid: { one: '{n} gültig', other: '{n} gültig' },
  csv_invalid: { one: '{n} mit Fehlern', other: '{n} mit Fehlern' },
  csv_preview: 'Vorschau →',
  csv_willCreate: { one: '{count} Produkt wird angelegt.', other: '{count} Produkte werden angelegt.' },
  csv_newCategories: {
    one: 'Außerdem wird {count} neue Kategorie angelegt:',
    other: 'Außerdem werden {count} neue Kategorien angelegt:',
  },
  csv_skipped: {
    one: '⚠ {n} Zeile wird übersprungen (sie enthält Fehler).',
    other: '⚠ {n} Zeilen werden übersprungen (sie enthalten Fehler).',
  },
  csv_colStatus: 'Status',
  csv_colName: 'Name',
  csv_colCategory: 'Kategorie',
  csv_colPrice: 'Preis',
  csv_colVat: 'MwSt.',
  csv_limitFull:
    'Sie haben das Produktlimit Ihres Tarifs erreicht — der Import kann keine neuen Produkte hinzufügen. Löschen Sie Produkte oder wechseln Sie zu einem größeren Tarif.',
  csv_slots: {
    one: '{lead} — dieses wird importiert, {rest} außen vor.',
    other: '{lead} — die ersten {n} werden importiert, {rest} außen vor.',
  },
  csv_slotsLead: {
    one: 'Ihr Tarif hat noch Platz für {count} Produkt',
    other: 'Ihr Tarif hat noch Platz für {count} Produkte',
  },
  csv_slotsRest: { one: '{n} Zeile bleibt', other: '{n} Zeilen bleiben' },
  csv_back: '← Zurück',
  csv_importN: { one: '{n} Produkt importieren →', other: '{n} Produkte importieren →' },
  csv_progress: 'Import läuft… {pct} %',
  csv_imported: { one: '{n} Produkt importiert!', other: '{n} Produkte importiert!' },
  csv_rowMissingName: 'Name fehlt',
  csv_rowMissingCategory: 'Kategorie fehlt',
  csv_rowMissingPrice: 'Preis fehlt',
  csv_rowBadPrice: 'Preis nicht lesbar („{raw}“)',
  csv_rowNegativePrice: 'negativer Preis',
  csv_rowBadVat: 'MwSt. muss 1-4 sein',
  csv_rowNameTooLong: 'Name zu lang (>100)',
  csv_errBaseline:
    'Die vorhandene Speisekarte konnte nicht gelesen werden, daher wurde der Import nicht gestartet (es wurde nichts hinzugefügt). Versuchen Sie es erneut.',
  csv_errVerifyProducts:
    'Es konnte nicht geprüft werden, was bereits importiert wurde, daher wurde der Import nicht fortgesetzt (damit keine Produkte doppelt entstehen). Versuchen Sie es erneut.',
  csv_errVerifyCategories:
    'Die bereits angelegten Kategorien konnten nicht geprüft werden, daher wurde der Import nicht fortgesetzt (damit keine Kategorien doppelt entstehen). Versuchen Sie es erneut.',
  csv_errCategory: 'Fehler bei der Kategorie „{name}“: {reason}',
  csv_errBatch: 'Fehler in Stapel {index}: {reason}',
  csv_errUnknown: 'Unbekannter Fehler beim Import',
  csv_hintProductLimit: 'Sie haben das Produktlimit Ihres Tarifs erreicht.',
  csv_head_name: 'Name',
  csv_head_category: 'Kategorie',
  csv_head_price: 'Preis',
  csv_head_emoji: 'Emoji',
  csv_head_description: 'Beschreibung',
  csv_head_vat: 'MwSt',
  csv_templateRows:
    'Espresso,Kaffee,8.00,☕,Reiner italienischer Kaffee,1\nCappuccino,Kaffee,14.00,☕,Mit Milchschaum,1\nLatte Macchiato,Kaffee,16.00,🥛,,1\nLimonade,Kalte Getränke,14.00,🍋,Mit frischer Minze,1\nCheesecake,Desserts,16.00,🍰,Mit Waldbeeren,1',
  csv_exampleRows: 'Espresso,Kaffee,8.00,☕,,1\nLatte,Kaffee,14.00,🥛,Mit Milch,1',
}

export default de
