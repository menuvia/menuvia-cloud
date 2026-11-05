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
  err_network: 'Keine Verbindung. Prüfe deine Internetverbindung und versuche es erneut.',
  err_permission: 'Du hast keine Berechtigung für diese Aktion.',
  err_not_found: 'Dieses Element existiert nicht mehr oder du hast keinen Zugriff darauf.',
  err_duplicate: 'Ein Element mit diesen Daten existiert bereits.',
  err_forbidden: 'Diese Aktion ist für deine Rolle nicht erlaubt.',
  items_count: { one: '{n} Produkt', other: '{n} Produkte' },
}

export default de
