import type { Translation } from '../../core'
import type ro from './ro'

const de: Translation<typeof ro> = {
  loading_printer: 'Drucker wird geladen…',
  intro_kitchen:
    'Neue Bestellungen werden automatisch in der Küche gedruckt, auf einem Thermodrucker, über Menuvia Bridge.',
  register_device: 'Gerät registrieren',
  err_dismiss: 'Fehlermeldung schließen',
  err_load: 'Die Geräte konnten nicht geladen werden',
  err_register: 'Das Gerät konnte nicht registriert werden',
  err_delete: 'Das Gerät konnte nicht gelöscht werden',
  err_save: 'Konnte nicht gespeichert werden',
  err_ticketRetry: 'Der Bon konnte nicht erneut gesendet werden',
  err_ticketCancel: 'Der Bon konnte nicht storniert werden',

  devices_title: 'Geräte',
  empty_title: 'Sie haben noch kein Gerät registriert.',
  empty_desc:
    'Registrieren Sie ein Gerät, um den Installationsschlüssel für Menuvia Bridge zu erhalten (den PC, der mit dem Küchendrucker verbunden ist).',
  empty_step1: 'Registrieren Sie das Gerät hier: Sie erhalten den Schlüssel und die Datei config.json.',
  empty_step2:
    'Laden Sie Menuvia Bridge herunter und installieren Sie es, mit config.json neben dem Installationsprogramm, in einem neuen, leeren Ordner.',
  empty_step3:
    'Das Installationsprogramm startet die Bridge am Ende; prüfen Sie dann hier, ob das Gerät auch nach 3 Minuten noch „● Online“ anzeigt.',
  last_seen: 'Letztes Signal: {when}',
  rel_never: 'nie',
  rel_now: 'gerade eben',
  rel_min: 'vor {n} Min.',
  rel_hours: 'vor {n} Std.',
  rel_days: { one: 'vor {n} Tag', other: 'vor {n} Tagen' },
  status_online: '● Online',
  status_offline: '○ Offline',
  status_onlineHint: 'Hat sich in den letzten 3 Minuten gemeldet',
  status_offlineHint:
    'Seit mehr als 3 Minuten kein Lebenszeichen — prüfen Sie den PC und das Programm Menuvia Bridge',
  kitchen_toggle: 'Küchenbons',
  delete_title: 'Dieses Gerät löschen?',
  delete_descKitchen: 'Die installierte Bridge kann dann keine Küchenbons mehr drucken.',
  delete_confirm: 'Gerät löschen',

  col_created: 'Erstellt',
  col_order: 'Bestellung',
  col_status: 'Status',
  col_details: 'Details',
  col_actions: 'Aktionen',
  st_pending: 'Wartend',
  st_sentPrinter: 'An den Drucker gesendet',
  st_success: '✓ Gedruckt',
  st_error: '✗ Fehler',
  st_cancelled: 'Storniert',
  retries: { one: '{n} Versuch', other: '{n} Versuche' },

  tickets_title: 'Küchenbons',
  tickets_desc:
    'Neue Bestellungen werden automatisch auf dem Thermodrucker in der Küche gedruckt, über die Geräte, bei denen „Küchenbons“ aktiviert ist.',
  tickets_empty:
    'Noch keine Bons. Aktivieren Sie „Küchenbons“ bei einem Gerät oben — neue Bestellungen erscheinen dann hier.',
  reprint: 'Nachdruck',
  ticketCancel_title: 'Diesen Bon stornieren?',
  ticketCancel_desc: 'Er wird in der Küche nicht mehr gedruckt.',
  ticketCancel_confirm: 'Bon stornieren',

  reg_titleDevice: 'Bridge-Gerät registrieren',
  reg_name: 'Name *',
  reg_namePh: 'z. B. Küchen-PC',
  reg_defaultName: 'Küchen-PC',
  reg_infoKitchen:
    'Nach der Registrierung erhalten Sie einen einmaligen Installationsschlüssel. Sie verwenden ihn einmal, bei der Installation der Bridge auf dem PC, der mit dem Küchendrucker verbunden ist. Der Schlüssel lässt sich später nur durch eine erneute Registrierung wiederherstellen.',
  reg_submit: 'Registrieren',
  reg_busy: 'Wird registriert…',

  key_titleDevice: 'Gerät registriert',
  key_intro: 'Installieren Sie die Bridge in 3 Schritten:',
  step1_title: 'Menuvia Bridge herunterladen',
  step1_descKitchen: 'Das Windows-Installationsprogramm, auf dem PC, der mit dem Küchendrucker verbunden ist.',
  step1_download: 'Installationsprogramm herunterladen',
  step1_missing:
    'Der Download-Link ist noch nicht veröffentlicht — fragen Sie das Menuvia-Team nach dem Installationsprogramm.',
  step2_title: 'config.json herunterladen',
  step2_desc:
    'Legen Sie die Datei vor dem Start neben das Installationsprogramm, in einen neuen, leeren Ordner: Sie enthält die Serveradresse und den Geräteschlüssel, die Einrichtung übernimmt beides also selbst. Löschen Sie ältere Kopien von config.json (der Browser nennt die neue „config (1).json“).',
  step2_tail:
    'Bei der Einrichtung wird der Schlüssel nur mit seinem Ende angezeigt, und das muss {tail} sein. Sehen Sie ein anderes Ende (etwa weil die Bridge schon installiert war und das Installationsprogramm die bestehende Einrichtung behält), fügen Sie den Schlüssel unten bei „Device secret“ ein.',
  step2_kitchenNote: 'Die Einrichtung fragt dann nur noch nach der IP-Adresse des Thermodruckers.',
  step2_download: 'config.json herunterladen',
  step2_private: 'Die Datei enthält den Schlüssel: Bewahren Sie sie nur auf dem Bridge-PC auf.',
  step3_title: 'Bridge starten und prüfen',
  step3_descKitchen:
    'Das Installationsprogramm startet die Bridge am Ende (sonst: Startmenü → Menuvia Bridge → „Pornește bridge-ul“, oder starten Sie den PC neu). „Verificare conexiune (check)“ im selben Menü zeigt, ob sie den Menuvia-Server und den Drucker erreicht. Der Beweis, dass sie läuft: Das Gerät zeigt hier auch nach 3 Minuten noch „● Online“ — die Prüfung allein lässt es nur einige Minuten lang grün erscheinen.',
  key_label: 'Installationsschlüssel für die Bridge:',
  key_copy: 'Schlüssel kopieren',
  key_copied: 'Kopiert ✓',
  key_copyFailed:
    'Automatisches Kopieren nicht möglich — markieren Sie den Schlüssel oben und kopieren Sie ihn von Hand.',
  key_warning:
    'Speichern Sie den Schlüssel jetzt (oder laden Sie config.json herunter). Nach dem Schließen dieses Fensters lässt er sich nicht wiederherstellen. Wenn Sie ihn verlieren, löschen Sie das Gerät und registrieren Sie ein neues.',
  key_done: 'Ich habe den Schlüssel gespeichert',
}

export default de
