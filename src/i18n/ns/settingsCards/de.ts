import type { Translation } from '../../core'
import type ro from './ro'

// Sie; Gast (nicht Kunde); Standort (wie `dashboard.nav_locatii`); Tarif (wie
// `home`); Treueprogramm (wie `waiter.loyalty_*`); Schaltflächen im Infinitiv.
const de: Translation<typeof ro> = {
  loy_title: 'Treueprogramm — Punkte und Prämien',
  loy_desc:
    'Gäste sammeln bei jeder Bestellung über die QR-Speisekarte Punkte und erhalten eine Prämie, wenn ' +
    'sie die Schwelle erreichen. Die Punkte landen auf einer digitalen Karte im Telefon des Gastes — ' +
    'optional mit seiner Telefonnummer verknüpft (verschlüsselt gespeichert, als Hash).',
  loy_locked: 'Verfügbar ab dem Tarif {plan} — Punkte gibt es für QR-Bestellungen.',
  loy_enableTitle: 'Treueprogramm in der QR-Speisekarte aktivieren',
  loy_enableDesc:
    'Gäste sehen die Punktekarte in der Speisekarte; das Servicepersonal löst Prämien auf seiner Seite ' +
    'über den Kartencode ein.',
  loy_toggle: 'Treueprogramm in der QR-Speisekarte',
  loy_enabled: 'Treueprogramm aktiviert',
  loy_disabled: 'Treueprogramm deaktiviert',
  loy_loadError:
    'Wir konnten das gespeicherte Treueprogramm nicht lesen. Damit wir es nicht mit den Standardwerten ' +
    'überschreiben, ist das Speichern gesperrt, bis wir es lesen können.',
  loy_ppl: 'Punkte pro ausgegebenem Leu',
  loy_threshold: 'Schwelle für die Prämie (Punkte)',
  loy_reward: 'Prämie (was der Gast an der Schwelle erhält)',
  loy_rewardPlaceholder: 'Z. B. ein Dessert aufs Haus',
  loy_notSaved:
    'Das Programm ist noch nicht gespeichert: Tippen Sie auf „Speichern“, damit das Treueprogramm in der Speisekarte startet.',
  loy_err_ppl: 'Die Punkte pro Leu müssen zwischen 0,1 und 100 liegen.',
  loy_err_threshold: 'Die Schwelle muss zwischen 1 und 100.000 Punkten liegen.',
  loy_err_reward: 'Beschreiben Sie die Prämie (max. 200 Zeichen).',
  err_save: 'Speichern fehlgeschlagen',

  sms_title: 'SMS-Benachrichtigungen an Gäste',
  sms_desc:
    'Der Gast erhält eine SMS, wenn die Reservierung bestätigt wird und wenn die Abholbestellung fertig ' +
    'ist. Nur rumänische Mobilnummern; die Nachrichten sind rein transaktional (kein Marketing).',
  sms_locked:
    'Verfügbar in den kostenpflichtigen Tarifen — jeder Tarif enthält eine Anzahl SMS pro Monat.',
  sms_enableTitle: 'SMS aktivieren',
  sms_enableDesc:
    'Reservierungsbestätigung + „Ihre Bestellung ist fertig“ bei Abholung. Sie stoppen automatisch, wenn ' +
    'Sie das monatliche Limit des Tarifs erreichen.',
  sms_toggle: 'SMS an Gäste',
  sms_enabled: 'SMS wurden aktiviert',
  sms_disabled: 'SMS wurden deaktiviert',
  sms_usage: 'Diesen Monat: {count}',
  sms_usageCap: '{used} / {cap} SMS',
  sms_usageNoCap: '{used} SMS',
  sms_capReached: '— Limit erreicht; geht nächsten Monat weiter',

  mfa_title: 'Bestätigung in zwei Schritten (MFA)',
  mfa_active: 'Aktiv',
  mfa_inactive: 'Inaktiv',
  mfa_desc:
    'Schützen Sie das Konto mit einem Code aus einer Authentifizierungs-App (Google Authenticator, ' +
    '1Password, Aegis). Dringend empfohlen für Konten mit Plattformzugriff.',
  mfa_qrAlt: 'QR-Code für die Authentifizierungs-App',
  mfa_scan:
    'Scannen Sie den QR-Code mit der Authentifizierungs-App und geben Sie dann den 6-stelligen Code ein.',
  mfa_manual: 'Scannen nicht möglich? Geben Sie den Schlüssel manuell ein: {key}',
  mfa_codeAria: 'Bestätigungscode aus der App',
  mfa_verifying: 'Wird geprüft…',
  mfa_confirmEnable: 'Bestätigen und aktivieren',
  mfa_dismiss: 'Abbrechen',
  mfa_confirmWithCode: 'Mit dem Code aus der App bestätigen:',
  mfa_disable: 'MFA deaktivieren',
  mfa_disableStart: 'MFA deaktivieren…',
  mfa_reactivate: 'MFA wieder aktivieren',
  mfa_enable: 'MFA aktivieren',
  mfa_preparing: 'Wird vorbereitet…',
  mfa_enabledToast: 'MFA aktiviert — das Konto verlangt ab jetzt den Code aus der App',
  mfa_disabledToast: 'MFA deaktiviert',
  mfa_reactivatedToast: 'MFA wieder aktiviert — das Konto verlangt ab jetzt den Code aus der App',
  mfa_err_load: 'Wir konnten den MFA-Status nicht laden',
  mfa_err_start: 'Wir konnten die MFA-Aktivierung nicht starten',
  mfa_err_badCode:
    'Falscher oder abgelaufener Code. Versuchen Sie es mit dem aktuellen Code aus der App erneut.',
  mfa_err_verify: 'Die Prüfung ist fehlgeschlagen',
  mfa_err_disable: 'Die Deaktivierung ist fehlgeschlagen',
  mfa_err_reactivate: 'Die erneute Aktivierung ist fehlgeschlagen',
  mfa_err_aal2: 'Zum Deaktivieren der MFA ist eine mit MFA bestätigte Sitzung (aal2) nötig',

  gdpr_title: 'Meine Daten (DSGVO)',
  gdpr_desc:
    'Sie können eine Kopie Ihrer Kontodaten herunterladen oder die Löschung des Kontos beantragen. ' +
    'Details in der {policy}.',
  gdpr_policy: 'Datenschutzerklärung',
  gdpr_preparing: 'Wird vorbereitet…',
  gdpr_export: '⬇ Meine Daten exportieren (JSON)',
  gdpr_cancelling: 'Wird storniert…',
  gdpr_cancelDeletion: '↩ Geplante Löschung abbrechen',
  gdpr_sending: 'Wird gesendet…',
  gdpr_delete: 'Konto löschen',
  gdpr_pendingNote:
    '⚠️ Die Löschung des Kontos ist geplant (30 Tage nach dem Antrag). Bis dahin funktioniert das Konto ' +
    'normal und Sie können sie hier jederzeit abbrechen.',
  gdpr_exported: 'Der Export wurde heruntergeladen.',
  gdpr_err_export: 'Der Export ist fehlgeschlagen. Bitte erneut versuchen.',
  gdpr_confirmTitle: 'Konto löschen?',
  gdpr_confirmDesc:
    'Das Konto und Ihre Daten (Restaurants, Speisekarten, Mitglieder) werden nach 30 Tagen endgültig ' +
    'gelöscht. In dieser Zeit können Sie es sich hier noch anders überlegen. Steuerrechnungen bleiben ' +
    'gemäß Gesetz archiviert (10 Jahre).',
  gdpr_confirmOk: 'Löschung planen',
  gdpr_scheduledFor: 'Die Löschung ist für den {date} geplant.',
  gdpr_scheduled: 'Die Löschung des Kontos wurde geplant (30 Tage).',
  gdpr_err_request: 'Der Löschantrag ist fehlgeschlagen.',
  gdpr_cancelled: 'Der Löschantrag wurde zurückgezogen. Das Konto bleibt aktiv.',
  gdpr_err_cancel: 'Der Abbruch ist fehlgeschlagen. Bitte erneut versuchen.',
  gdpr_err_activeSub:
    'Sie haben ein aktives Abonnement. Kündigen Sie es im Stripe-Portal, bevor Sie das Konto löschen.',
  gdpr_cookiesDesc:
    'Nutzungsstatistik (PostHog) und Fehlerberichte (Sentry) laufen nur mit der Zustimmung, die Sie im ' +
    'Cookie-Banner in diesem Browser gegeben haben. Sie können sie jederzeit ändern oder widerrufen.',
  gdpr_cookies: 'Cookie-Einstellungen öffnen',

  loc_title: 'Standorte',
  loc_desc:
    'Sie haben mehrere Lokale? Fügen Sie einen neuen Standort hinzu — er startet leer, mit eigener ' +
    'Speisekarte und eigenen Tischen. Wie viele Standorte möglich sind, hängt vom Tarif des Kontos ab.',
  loc_add: 'Standort hinzufügen',
  loc_dialogDesc:
    'Der neue Standort startet leer: Danach fügen Sie seine Produkte, Tische und sein Team hinzu. Das ' +
    'Restaurant, das Sie gerade verwalten, bleibt unverändert.',
  loc_name: 'Name des Standorts',
  loc_err_nameRequired: 'Geben Sie den Namen des Standorts ein.',
  loc_reload: 'Neu laden',
  loc_create: 'Standort anlegen',
  loc_uncertain:
    'Wir wissen nicht sicher, ob der Standort angelegt wurde — laden Sie die Seite neu und prüfen Sie die Liste.',
  loc_err_limit:
    'Der aktuelle Tarif erlaubt keinen weiteren Standort. Für mehr Standorte ist ein höherer Tarif nötig.',
  loc_err_create: 'Der Standort konnte nicht angelegt werden. Bitte erneut versuchen.',
}

export default de
