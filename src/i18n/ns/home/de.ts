import type { Translation } from '../../core'
import type ro from './ro'

// „Agent” e „Berater”, ca în `auth` (agentul de vânzări Menuvia).
const de: Translation<typeof ro> = {
  welcome_title: 'Willkommen, {name}',
  welcome_description:
    'Richten Sie Ihr Restaurant ein, prüfen Sie Ihre QR-Codes und behalten Sie die heutige Aktivität im Blick.',

  metric_ordersToday: 'Bestellungen heute',
  metric_ordersTodayHint: 'ohne stornierte',
  metric_loadFailedHint: 'konnte nicht geladen werden',
  metric_activeProducts: 'Aktive Produkte',
  metric_activeQrs: 'Aktive QR-Codes',
  metric_pickupQrHint: 'Allgemeiner QR-Code (nur Abholung)',
  metric_scannableTablesHint: 'scannbare Tische',
  metric_occupiedTables: 'Jetzt belegte Tische',
  metric_openOrdersHint: 'mit offenen Bestellungen',
  metric_revenueToday: 'Einnahmen heute',
  metric_revenueHint: 'heute erfasste Zahlungen',
  metric_tipsToday: 'Trinkgeld heute',
  metric_tipsHint: 'nur zur Information, nicht in den Einnahmen enthalten',
  metric_setup: 'Einrichtung',
  metric_setupDoneHint: 'alles erledigt ✓',
  metric_setupStepsHint: 'Schritte erledigt',
  metrics_someFailed: 'Einige Zahlen konnten nicht geladen werden.',

  setup_title: 'Restaurant einrichten',
  setup_progress: '{done}/{total} Schritte erledigt',
  setup_progressAria: 'Fortschritt der Einrichtung',
  setup_addProducts: 'Produkte hinzufügen',
  setup_createCategories: 'Kategorien anlegen',
  setup_generateTableQrs: 'QR-Codes für die Tische erstellen',
  setup_checkPublicMenu: 'Öffentliche Speisekarte prüfen',
  setup_inviteTeam: 'Team einladen',
  setup_firstOrderPickup:
    'Erste Testbestellung — öffnen Sie die öffentliche Speisekarte und bestellen Sie',
  setup_firstOrderTable:
    'Erste Testbestellung — öffnen Sie den QR-Code eines Tisches und bestellen Sie',
  setup_itemDoneAria: '{label} (erledigt)',
  setup_itemUnknownAria: '{label} (Status unbekannt)',

  score_title: 'Speisekarten-Score',
  score_loading: 'Score wird geladen...',

  quick_title: 'Schnellaktionen',
  quick_addProduct: 'Produkt hinzufügen',
  quick_generateQrs: 'QR-Codes erstellen',
  quick_qrStands: 'QR-Aufsteller',
  quick_viewPublicMenu: 'Öffentliche Speisekarte ansehen',
  quick_viewOrders: 'Bestellungen ansehen',
  quick_inviteWaiter: 'Servicekraft einladen',

  sub_title: 'Abonnement & Abrechnung',
  sub_yourPlan: 'Ihr Tarif: {name}. ',
  sub_manageHint:
    'Aktualisieren Sie Ihre Karte, wechseln Sie den Tarif oder laden Sie Ihre Rechnungen herunter.',
  sub_noCustomer:
    'Ihr Konto hat kein per Karte bezahltes Abonnement, daher gibt es hier nichts zu verwalten. Tarife und Preise finden Sie auf der Tarifseite.',
  sub_portalFallback:
    'Das Abrechnungsportal konnte nicht geöffnet werden. Versuchen Sie es in einigen Augenblicken erneut.',
  sub_seePlans: 'Tarife ansehen',
  sub_opening: 'Wird geöffnet…',
  sub_manage: 'Abonnement verwalten',
  sub_errUnavailable: 'Das Abrechnungsportal ist derzeit nicht verfügbar.',
  sub_errRateLimited: 'Zu viele Versuche. Versuchen Sie es in einigen Minuten erneut.',
  sub_errSession: 'Ihre Sitzung ist abgelaufen. Melden Sie sich erneut an.',
  sub_errService: 'Der Dienst ist vorübergehend nicht verfügbar. Versuchen Sie es erneut.',

  // Der Tarifname „Fiscalizare” wird nicht übersetzt (Handelsname).
  ck_subscriptionExists:
    'Sie haben bereits ein aktives Abonnement. Den Tarif wechseln Sie im Abrechnungsportal.',
  ck_planRequiresQuote:
    'Der Tarif Fiscalizare wird auf Angebot freigeschaltet, zusammen mit der Installation an Ihrer Registrierkasse. Fordern Sie ein Angebot an.',
  ck_subscriptionLookupFailed:
    'Wir konnten Ihre bestehenden Abonnements nicht prüfen. Versuchen Sie es in einigen Augenblicken erneut.',
  ck_createFailed: 'Wir konnten die Zahlung nicht starten. Versuchen Sie es in einigen Augenblicken erneut.',
  ck_network:
    'Wir konnten den Zahlungsserver nicht erreichen. Prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.',
  ck_auth: 'Ihre Sitzung ist abgelaufen. Melden Sie sich erneut an und starten Sie die Aktivierung neu.',
  ck_rateLimited: 'Zu viele Versuche. Versuchen Sie es in einigen Minuten erneut.',
  ck_unavailable: 'Der Dienst ist vorübergehend nicht verfügbar. Versuchen Sie es in einigen Augenblicken erneut.',
  ck_notConfigured:
    'Die Online-Zahlung ist derzeit nicht verfügbar. Kontaktieren Sie uns, dann schalten wir Ihren Tarif manuell frei.',
  ck_planUnavailable:
    'Der gewählte Tarif kann gerade nicht freigeschaltet werden. Schreiben Sie uns, dann schalten wir ihn für Sie frei.',
  ck_unknown:
    'Wir konnten die Zahlung nicht starten. Versuchen Sie es erneut; wenn es wieder passiert, schreiben Sie uns eine E-Mail.',

  upsell_regionLabel: 'Angebot: {title}',
  upsell_orderingLead: 'Ihre Gäste bestellen selbst, und die Küche erhält die Bestellung sofort.',
  upsell_orderingBenefit1: 'Bestellungen am Tisch per QR-Code',
  upsell_orderingBenefit2: 'Küchenbildschirm für neue Bestellungen',
  upsell_orderingBenefit3: 'Bestellungen zur Abholung',
  upsell_paymentsTitle: 'Bezahlen am Tisch',
  upsell_paymentsLead: 'Im Tarif {plan}.',
  upsell_paymentsBenefit1: 'Gäste bezahlen mit dem Smartphone',
  upsell_paymentsBenefit2: 'Der Fiskalbeleg wird automatisch ausgestellt',
  upsell_paymentsBenefit3: 'Einnahmen und MwSt. erscheinen automatisch in den Berichten',
  upsell_seePlan: 'Tarif ansehen',

  planUnknown_text:
    'Der Tarif des Restaurants konnte nicht geladen werden. Bis er geladen ist, bleiben einige Bereiche ausgeblendet.',

  agent_heading: 'Ihr Menuvia-Berater',
  agent_defaultName: 'Vertriebsberater',
  agent_scope:
    'Der Berater sieht und bearbeitet NUR die Speisekarte (Kategorien, Produkte, Optionen) und die Tische mit ihren QR-Codes. ' +
    'Er sieht KEINE Bestellungen, Einnahmen, Reservierungen, Steuerdaten, Einstellungen und nicht das Team. ' +
    'Ihr Abonnement bleibt davon unberührt, und Sie können den Zugriff jederzeit entziehen.',
  agent_accessGranted: 'Zugriff erteilt',
  agent_accessRequested: 'Der Berater hat Zugriff angefragt',
  agent_accessRevoked: 'Zugriff entzogen',
  agent_accessNone: 'Kein Zugriff',
  agent_ownerOnly:
    'Nur der Inhaber des Restaurants kann dem Berater Zugriff erteilen oder entziehen.',
  agent_grant: 'Berater Zugriff erteilen',
  agent_grantOk: 'Der Berater hat jetzt Zugriff auf die Speisekarte',
  agent_decline: 'Anfrage ablehnen',
  agent_declineOk: 'Die Anfrage des Beraters wurde abgelehnt',
  agent_revoke: 'Zugriff entziehen',
  agent_revokeOk: 'Der Zugriff des Beraters wurde entzogen',
  agent_revokeConfirmTitle: 'Dem Berater den Zugriff entziehen?',
  agent_revokeConfirmText:
    'Der Berater kann die Speisekarte und die Tische dann nicht mehr sehen oder bearbeiten. Sie können ihm jederzeit wieder Zugriff geben.',
}

export default de
