import type { Translation } from '../../core'
import type ro from './ro'

// Sie; Standort (wie `dashboard.nav_locatii`); Schaltflächen im Infinitiv.
const de: Translation<typeof ro> = {
  intro:
    'Der heutige Tag an jedem Standort, den Sie verwalten. Die Zahlen werden beim Öffnen des ' +
    'Bildschirms berechnet.',
  err_open: 'Wir konnten den Standort nicht öffnen. Bitte erneut versuchen.',
  err_load: 'Wir konnten die Standorte nicht laden. Bitte erneut versuchen.',
  unavailable:
    'Die Übersicht der Standorte ist noch nicht verfügbar. Sie können in der Seitenleiste über die ' +
    'Restaurantauswahl zwischen den Standorten wechseln.',
  empty: 'Wir haben keinen Standort gefunden, den Sie verwalten.',
  current: 'Aktuell ausgewählt',
  stat_ordersToday: 'Bestellungen heute',
  stat_open: 'Offene Bestellungen',
  stat_revenue: 'Einnahmen heute',
  stat_last: 'Letzte Bestellung',
  open: 'Öffnen',
  open_aria: '{name} öffnen',
  last_none: 'Noch keine Bestellung',
  last_today: 'heute, {time}',
  last_yesterday: 'gestern, {time}',
  last_date: '{date}, {time}',
}

export default de
