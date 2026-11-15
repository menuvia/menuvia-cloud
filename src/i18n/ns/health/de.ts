import type { Translation } from '../../core'
import type ro from './ro'

// Sie; „Verwaltungsbereich“ für das Panel des Restaurants, Gäste (nicht
// Kunden); der Pfad „Einstellungen → Kasse & Küchenbons“ und die
// Schaltfläche „Hilfe“ wie in `dashboard`; „Score“ (der) wie `home.score_title`
// („Speisekarten-Score“); Schaltflächen im Infinitiv.
const de: Translation<typeof ro> = {
  err_load: 'Der Score konnte nicht geladen werden',
  err_recompute: 'Der Score konnte nicht neu berechnet werden',
  err_cooldown: 'Der Score wurde gerade erst neu berechnet. Versuchen Sie es in einigen Minuten erneut.',
  loadFail_title: 'Wir konnten den Score nicht laden',
  loadFail_desc: 'Bei der Verbindung mit dem Server ist ein Fehler aufgetreten. Versuchen Sie es in einigen Augenblicken erneut.',
  none_title: 'Der Score wurde noch nicht berechnet',
  none_desc: 'Der Score wird alle 30 Minuten automatisch berechnet. Sie können jetzt eine manuelle Neuberechnung starten.',
  computing: 'Wird berechnet…',
  compute_now: 'Jetzt berechnen',
  eyebrow: 'Gesundheits-Score des Kontos',
  title: 'So steht Ihr Café da',
  last_recompute: 'Zuletzt berechnet: {ago}',
  recomputing: '⏳ Wird berechnet…',
  recompute: '↻ Neu berechnen',
  delta_vs_prev: '({delta} gegenüber dem vorherigen Score)',
  comp_title: 'Zusammensetzung des Scores',
  bar_login: 'Anmeldehäufigkeit',
  bar_orders: 'Bestellvolumen',
  bar_team: 'Team',
  bar_tickets: 'Stabilität',
  bar_engagement: 'Engagement',
  sugg_title: 'So können Sie den Score verbessern',
  how_title: 'So funktioniert der Score',
  how_fiscal:
    'Score 0–100, alle 30 Minuten neu berechnet, aus 5 Komponenten: Anmeldung (20), Bestellungen (30), Team ' +
    '(15), Stabilität der Kasse (20) und Nutzung der Funktionen (15).',
  how_nonFiscal:
    'Score 0–100, alle 30 Minuten neu berechnet, aus 4 Komponenten: Anmeldung, Bestellungen, Team und Nutzung ' +
    'der Funktionen.',
  ago_seconds: 'vor wenigen Sekunden',
  ago_minutes: { one: 'vor {n} Minute', other: 'vor {n} Minuten' },
  ago_hours: { one: 'vor {n} Stunde', other: 'vor {n} Stunden' },
  ago_days: { one: 'vor {n} Tag', other: 'vor {n} Tagen' },
  narr_critical:
    'Ihr Café zeigt besorgniserregende Anzeichen. Sehen Sie sich die Vorschläge unten an; wenn Sie nicht ' +
    'weiterkommen, nutzen Sie die Schaltfläche „Hilfe“.',
  narr_excellent:
    'Glückwunsch! Sie nutzen Menuvia voll aus. Machen Sie weiter so und empfehlen Sie die Plattform gern ' +
    'anderen Gastronomen.',
  narr_good:
    'Ein gesundes Konto, aber es gibt noch Verbesserungspotenzial. Nehmen Sie sich Zeit für 1–2 der ' +
    'Vorschläge unten.',
  narr_average:
    'Es gibt reichlich Möglichkeiten zur Optimierung. Beginnen Sie mit der Komponente mit dem niedrigsten Score.',
  narr_low: 'Die App wird unter ihren Möglichkeiten genutzt. Beginnen Sie mit der Komponente mit dem niedrigsten Score.',
  trend_rising: 'Steigend',
  trend_stable: 'Stabil',
  trend_declining: 'Fallend',
  trend_critical: 'Kritisch — erfordert Aufmerksamkeit',
  label_excellent: 'Ausgezeichnet',
  label_good: 'Gut',
  label_average: 'Mittel',
  label_weak: 'Schwach',
  label_critical: 'Kritisch',
  sc_login: 'Anmeldehäufigkeit',
  sg_loginNever:
    'Sie haben sich noch nie angemeldet — öffnen Sie den Verwaltungsbereich mindestens einmal am Tag, um die ' +
    'Bestellungen live zu sehen.',
  sg_loginDays: {
    one: 'Letzte Anmeldung: vor {n} Tag. Melden Sie sich mindestens 2–3 Mal pro Woche an.',
    other: 'Letzte Anmeldung: vor {n} Tagen. Melden Sie sich mindestens 2–3 Mal pro Woche an.',
  },
  sg_loginDaily: 'Melden Sie sich täglich an, um den maximalen Score zu erreichen.',
  sc_orders: 'Bestellvolumen',
  sg_ordersZero:
    'Diese Woche keine Bestellungen. Prüfen Sie, ob die QR-Speisekarte für Gäste erreichbar ist und der Service ' +
    'die Bestellungen erfasst.',
  sg_ordersDown:
    'Bestellungen rückläufig ({wk} gegenüber {prev} in der Vorwoche). Prüfen Sie Aktionen, Öffnungszeiten und Laufkundschaft.',
  sg_ordersGrow: 'Steigern Sie das Volumen weiter — Happy Hour, schnelle QR-Bestellungen, Gästebindung.',
  sc_team: 'Teamgröße',
  sg_teamSolo:
    'Sie sind allein im Konto. Laden Sie Service und Küche ein — die Produktivität steigt, wenn jeder ' +
    'eine feste Rolle hat.',
  sg_teamMore: {
    one: '{n} Mitglied. Laden Sie noch {more} weitere ein, um den maximalen Score zu erreichen.',
    other: '{n} Mitglieder. Laden Sie noch {more} weitere ein, um den maximalen Score zu erreichen.',
  },
  sc_tickets: 'Fehler der Fiskal-Bridge',
  sg_ticketsAlerts: {
    one: '{n} fehlerhafter Fiskalbeleg in den letzten 7 Tagen. Prüfen Sie Einstellungen → Kasse & Küchenbons — Kasse, Papier, Verbindung.',
    other:
      '{n} fehlerhafte Fiskalbelege in den letzten 7 Tagen. Prüfen Sie Einstellungen → Kasse & Küchenbons — Kasse, Papier, Verbindung.',
  },
  sg_ticketsOk: 'Das Fiskalsystem ist stabil. Weiter so.',
  sc_engagement: 'Nutzung der Funktionen',
  sg_engagementFiscal:
    'Aktivieren Sie weitere Module: Kassenschichten eröffnen, Happy Hour einrichten, Rezepte für die ' +
    'Bestandsverwaltung hinzufügen, die Fiskal-Bridge verbinden.',
  sg_engagement:
    'Aktivieren Sie weitere Module: Happy Hour einrichten, Rezepte für die Bestandsverwaltung hinzufügen, den ' +
    'Küchendrucker verbinden.',
}

export default de
