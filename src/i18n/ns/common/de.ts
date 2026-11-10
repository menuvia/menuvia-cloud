import type { Translation } from '../../core'
import type ro from './ro'

const de: Translation<typeof ro> = {
  save: 'Speichern',
  cancel: 'Abbrechen',
  close: 'Schließen',
  retry: 'Erneut versuchen',
  delete: 'Löschen',
  edit: 'Bearbeiten',
  back: 'Zurück',
  loading: 'Wird geladen…',
  autoSaveHint: '· wird automatisch gespeichert',
  err_generic: 'Die Aktion konnte nicht abgeschlossen werden. Bitte erneut versuchen.',
  err_network: 'Keine Verbindung. Prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.',
  err_permission: 'Sie haben keine Berechtigung für diese Aktion.',
  err_not_found: 'Dieses Element existiert nicht mehr oder Sie haben keinen Zugriff darauf.',
  err_duplicate: 'Ein Element mit diesen Daten existiert bereits.',
  err_forbidden: 'Diese Aktion ist für Ihre Rolle nicht erlaubt.',
  elapsed_s: '{n} s',
  elapsed_m: '{n} Min.',
  elapsed_hm: '{h} Std. {m} Min.',
  signOut: 'Abmelden',
  signOut_busy: 'Wird abgemeldet…',
  signOut_confirmTitle: 'Abmelden?',
  signOut_confirmDesc: 'Auf diesem Gerät müssen Sie sich erneut anmelden.',
  signOut_failed: 'Abmelden fehlgeschlagen. Versuchen Sie es erneut.',
  lang_title: 'Sprache der Oberfläche',
  lang_saving: 'Wird gespeichert…',
  lang_saveFailed: 'Die Sprache konnte nicht gespeichert werden. Versuchen Sie es erneut.',
  lang_columnMissing:
    'Die Sprache kann noch nicht in Ihrem Konto gespeichert werden: Der Server hat das letzte Update noch nicht erhalten. Der Verwaltungsbereich bleibt in der aktuellen Sprache.',
  lang_columnMissingShort:
    'Die Sprache kann noch nicht gespeichert werden: Der Server hat das letzte Update noch nicht erhalten.',
  lang_name_ro: 'Română',
  lang_name_en: 'English',
  lang_name_fr: 'Français',
  lang_name_de: 'Deutsch',
  items_count: { one: '{n} Produkt', other: '{n} Produkte' },
}

export default de
