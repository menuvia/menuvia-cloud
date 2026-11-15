import type { Translation } from '../../core'
import type ro from './ro'

// Sie; Team (wie `dashboard.nav_echipa`); Rollen wie `invite.role*`;
// Schaltflächen im Infinitiv.
const de: Translation<typeof ro> = {
  role_owner: 'Inhaber',
  role_manager: 'Manager',
  role_waiter: 'Service',
  role_kitchen: 'Küche',

  members_count: {
    one: '{n} Mitglied · Einladungen laufen nach 7 Tagen ab',
    other: '{n} Mitglieder · Einladungen laufen nach 7 Tagen ab',
  },
  founder_note:
    'Im Gründermodus sehen Sie das Team, aber Einladungen verschickt nur der Inhaber oder der Manager ' +
    'des Restaurants, aus dem eigenen Konto.',
  invite_title: 'Neues Mitglied einladen',
  email: 'E-Mail',
  email_placeholder: 'max@restaurant.de',
  role: 'Rolle',
  sending: 'Wird gesendet…',
  send: 'Einladung senden',
  inv_sent: 'Einladung an {email} gesendet',
  inv_revoked: 'Einladung zurückgezogen',
  err_revoke: 'Zurückziehen fehlgeschlagen',
  member_removed: 'Mitglied entfernt',
  err_remove: 'Entfernen fehlgeschlagen',
  owner_forbidden: 'Die Beförderung zum Inhaber ist nicht erlaubt',
  role_updated: 'Rolle aktualisiert',
  err_role: 'Aktualisieren der Rolle fehlgeschlagen',
  err_load: 'Das Team konnte nicht geladen werden',

  inv_err_send: 'Senden fehlgeschlagen',
  inv_err_network: 'Verbindungsfehler. Prüfen Sie Ihre Internetverbindung.',
  inv_err_server_config:
    'Einladungen sind auf dem Server derzeit nicht aktiviert. Versuchen Sie es später.',
  inv_err_email_not_configured:
    'Der E-Mail-Versand ist derzeit nicht aktiviert. Schreiben Sie uns, wir helfen Ihnen.',
  inv_err_missing_fields: 'Füllen Sie die E-Mail-Adresse und die Rolle aus.',
  inv_err_invalid_email: 'Die E-Mail-Adresse ist ungültig.',
  inv_err_invalid_role: 'Die gewählte Rolle gibt es nicht. Wählen Sie Manager, Service oder Küche.',
  inv_err_auth_invalid: 'Ihre Sitzung ist abgelaufen. Melden Sie sich erneut an.',
  inv_err_forbidden: 'Nur der Inhaber oder der Manager kann Einladungen senden.',
  inv_err_rate_limit_unavailable:
    'Wir konnten das Einladungslimit nicht prüfen. Versuchen Sie es in einigen Augenblicken erneut.',
  inv_err_rate_limited:
    'Sie haben in den letzten 24 Stunden zu viele Einladungen gesendet. Versuchen Sie es morgen erneut ' +
    'oder wenden Sie sich an den Support.',
  inv_err_already_member: 'Dieser Benutzer ist bereits Mitglied.',
  inv_err_invite_create_failed:
    'Wir konnten die Einladung nicht erstellen. Bitte erneut versuchen.',
  inv_err_email_send_uncertain:
    'Wir konnten den Versand der E-Mail nicht bestätigen. Die Einladung erscheint in der Liste; wenn sie ' +
    'nicht innerhalb weniger Minuten ankommt, senden Sie sie erneut.',
  inv_err_email_send_failed:
    'Die Einladungs-E-Mail konnte nicht gesendet werden. Bitte erneut versuchen.',

  pending_title: 'Ausstehende Einladungen ({n})',
  pending_meta: '{role} · läuft am {date} ab',
  current_title: 'Aktuelle Mitglieder ({n})',
  empty_title: 'Noch keine Mitglieder',
  empty_desc: 'Laden Sie Ihre Kollegen ein, um das Restaurant gemeinsam zu führen.',
  user_fallback: 'Benutzer',
  self: 'Sie',
  role_aria: 'Rolle von {name}',
  remove_aria: '{name} aus dem Team entfernen',
  remove_title: 'Aus dem Team entfernen',
  remove_confirm: 'Möchten Sie {name} wirklich entfernen?',
  remove: 'Entfernen',
}

export default de
