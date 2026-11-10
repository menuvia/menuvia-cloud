import type { Translation } from '../../core'
import type ro from './ro'

const de: Translation<typeof ro> = {
  header_backTitle: 'Zurück zum Verwaltungsbereich',
  header_back: 'Zum Verwaltungsbereich',
  title: 'Küche',
  titleWithName: 'Küche — {name}',
  selectRestaurant: 'Restaurant auswählen',
  soldOutAria: 'Ausverkaufte Produkte — markieren, was nicht mehr verfügbar ist',
  soldOut: 'Ausverkauft',
  push_onAria: 'Benachrichtigungen aktiv — deaktivieren',
  push_blockedAria: 'Benachrichtigungen sind in den Browsereinstellungen blockiert',
  push_enable: 'Benachrichtigungen für neue Bestellungen aktivieren',
  push_onTitle: 'Benachrichtigungen aktiv — zum Deaktivieren klicken',
  push_blockedTitle: 'Benachrichtigungen sind im Browser blockiert',
  push_on: 'Aktiv',
  push_blocked: 'Blockiert',
  push_off: 'Benachrichtigungen',
  conn_connected: 'Verbunden',
  conn_connecting: 'Verbindung wird hergestellt…',
  conn_disconnected: 'Getrennt',

  pushBanner_text:
    'Aktivieren Sie Benachrichtigungen, um bei neuen Bestellungen informiert zu werden — auch bei geschlossenem Tab.',
  pushBanner_enabling: 'Wird aktiviert…',
  pushBanner_enable: 'Aktivieren →',
  sound_locked:
    'Der Ton für neue Bestellungen ist vom Browser stummgeschaltet, bis Sie einmal auf den Bildschirm tippen.',
  sound_unlock: 'Ton einschalten',
  list_truncated:
    'Es werden nur die {limit} neuesten aktiven Bestellungen angezeigt — schließen Sie alte Bestellungen ab, damit die Liste vollständig ist.',
  sync_error:
    'Die Bestellungen konnten nicht synchronisiert werden. Prüfen Sie die Verbindung und versuchen Sie es erneut.',
  sync_dismiss: 'Fehlermeldung schließen',

  col_new: 'Neue Bestellungen',
  col_preparing: 'In Zubereitung',
  col_ready: 'Bereit zum Servieren',
  empty_title: 'Keine Bestellungen',
  empty_newHint: 'Bestellungen per QR erscheinen hier automatisch.',

  src_qr: 'QR',
  src_waiter: 'Servicekraft',
  next_confirm: 'Bestätigen',
}

export default de
