import type { Translation } from '../../core'
import type ro from './ro'

// „Sie”, Schaltflächen im Infinitiv; Reservierung, Tisch, Person (wie
// `waiter.resv_party`), Bereich, No-Show, „așezat” = platziert. Die
// Google-Bezeichnungen sind die der deutschen Google-Oberfläche.
const de: Translation<typeof ro> = {
  count_inRange: { one: '{n} Reservierung im Zeitraum', other: '{n} Reservierungen im Zeitraum' },
  stale_title: {
    one: 'Unbestätigt / abgelaufen: {n} vergangene Reservierung',
    other: 'Unbestätigt / abgelaufen: {n} vergangene Reservierungen',
  },
  party: { one: '{n} Person', other: '{n} Personen' },

  status_pending: 'Ausstehend',
  status_confirmed: 'Bestätigt',
  status_seated: 'Platziert',
  status_completed: 'Abgeschlossen',
  status_cancelled: 'Storniert',
  status_no_show: 'No-Show',
  status_expired: 'Abgelaufen',

  stale_aria: 'Unbestätigte oder abgelaufene Reservierungen',
  stale_show: 'Anzeigen',
  stale_hide: 'Ausblenden',
  stale_desc:
    'Unbeantwortete Reservierungen (nach 2 Stunden automatisch abgelaufen) und bestätigte, seit über 48 Stunden nicht abgeschlossene — unabhängig vom oben gewählten Zeitraum.',

  filter_today: 'Heute',
  filter_tomorrow: 'Morgen',
  filter_week: 'Diese Woche',
  filter_dateAria: 'Bestimmten Tag wählen',
  filter_pendingOnly: 'Nur ausstehende',
  refresh: 'Aktualisieren',

  load_error: 'Die Reservierungen konnten nicht geladen werden.',
  empty_pendingTitle: 'Keine ausstehenden Reservierungen',
  empty_pendingDesc: 'Entfernen Sie den Haken bei „Nur ausstehende“, um alle Reservierungen im Zeitraum zu sehen',
  empty_title: 'Keine Reservierungen im gewählten Zeitraum',
  empty_desc: 'Ändern Sie den Datumsfilter oder prüfen Sie die Einstellungen',

  act_confirm: 'Bestätigen',
  act_seat: 'Platzieren',
  act_complete: 'Abschließen',
  act_noShow: 'No-Show',
  act_cancel: 'Stornieren',
  confirm_cancelTitle: 'Reservierung stornieren?',
  confirm_noShowTitle: 'Als No-Show markieren?',
  confirm_desc: 'Diese Aktion kann in der App nicht rückgängig gemacht werden.',
  confirm_cancelLabel: 'Reservierung stornieren',
  confirm_noShowLabel: 'Als No-Show markieren',
  done_confirmed: 'Reservierung bestätigt',
  done_seated: 'Die Gäste wurden platziert',
  done_cancelled: 'Reservierung storniert',
  done_noShow: 'Reservierung als No-Show markiert',
  done_completed: 'Reservierung abgeschlossen',
  err_update: 'Die Reservierung konnte nicht aktualisiert werden.',

  noShow_title: {
    one: 'Diese Telefonnummer hat {n} No-Show im Verlauf',
    other: 'Diese Telefonnummer hat {n} No-Shows im Verlauf',
  },
  noShow_badge: { one: '⚠ {n} No-Show', other: '⚠ {n} No-Shows' },
  zone_requested: 'gewünschter Bereich: {zone}',
  special: '„{text}“',

  google_title: 'Ihr Google-Button',
  google_copy: 'Kopieren',
  google_copied: 'Kopiert ✓',
  google_showSteps: 'Wie füge ich ihn bei Google hinzu?',
  google_hideSteps: 'Schritte ausblenden',
  google_step1:
    'Öffnen Sie {site} mit dem Konto, das das Profil des Lokals verwaltet (falls Sie es noch nicht beansprucht haben, tippen Sie im Google-Eintrag auf „Inhaber dieses Unternehmens?“).',
  google_step2: 'Profil wählen → {edit} → Abschnitt {section} → den Link oben hinzufügen.',
  google_step2Edit: 'Profil bearbeiten',
  google_step2Section: 'Reservierungen',
  google_step3:
    'Speichern — innerhalb weniger Tage erscheint der Reservierungsbutton in der Google-Suche und in Maps. Details: {doc}.',

  settings_title: 'Reservierungseinstellungen',
  settings_loadError: 'Die Reservierungseinstellungen konnten nicht geladen werden.',
  settings_saved: 'Einstellungen gespeichert',
  settings_saveError: 'Die Einstellungen konnten nicht gespeichert werden.',
  set_open: 'Öffnungszeit',
  set_close: 'Schließzeit',
  set_slot: 'Zeitfenster-Intervall (Min.)',
  set_duration: 'Reservierungsdauer (Min.)',
  set_minAdvance: 'Mindestvorlauf der Reservierung (Stunden)',
  set_maxAdvance: 'Maximaler Vorlauf der Reservierung (Tage)',
  set_maxParty: 'Max. Personen / Reservierung',
  set_reminder: 'Erinnerung (Stunden vorher)',
  set_reminderNone: 'Keine',
  set_autoConfirm: 'Automatische Bestätigung',
  set_on: 'Aktiviert',
  set_off: 'Deaktiviert',
  set_minutes: '{n} Min.',
  set_hours: '{n} Std.',
  saving: 'Wird gespeichert…',
  save_settings: 'Einstellungen speichern',
}

export default de
