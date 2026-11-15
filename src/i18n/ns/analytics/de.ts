import type { Translation } from '../../core'
import type ro from './ro'

// Sie; Umsatz = venit, Durchschnittsbon = bon mediu; „Servicekraft“ für den
// Kellner (wie `kitchen.src_waiter`); die Zahlungsarten wie `orders.method_*`
// / `waiter.split_listVoucher`.
const de: Translation<typeof ro> = {
  err_load: 'Die Statistiken konnten nicht geladen werden',
  country_unavailable:
    'Die Umsatzstatistiken beruhen auf den Fiskaldaten und sind nur für Restaurants in Rumänien verfügbar.',
  period_last: { one: 'Letzter {n} Tag', other: 'Letzte {n} Tage' },
  range_days: { one: '{n} Tag', other: '{n} Tage' },
  empty_title: 'Keine Bestellungen im gewählten Zeitraum',
  empty_desc: 'Ändern Sie den Zeitraum oder warten Sie auf die ersten Bestellungen.',
  stat_orders: 'Bestellungen',
  stat_revenue: 'Umsatz',
  stat_avgTicket: 'Durchschnittsbon',
  stat_qrRate: 'QR-Anteil',
  chart_revenue: 'Umsatz pro Tag',
  chart_orders: 'Bestellungen pro Tag',
  series_revenue: 'Umsatz',
  series_orders: 'Bestellungen',
  pie_source: 'Herkunft der Bestellungen',
  pie_method: 'Zahlungsart',
  src_qr: 'QR',
  src_waiter: 'Servicekraft',
  method_cash: 'Bar',
  method_card: 'Karte',
  method_voucher: 'Essensgutscheine',
  method_online: 'Online-Karte',
  method_other: 'Andere Zahlungsarten',
  hourly_title: 'Stoßzeiten',
  hourly_sub: '· letzte 30 Tage',
  top_title: 'Top-Produkte',
  sub_allTime: '· gesamter Zeitraum',
  col_product: 'Produkt',
  col_qty: 'Menge',
  col_orders: 'Bestellungen',
  col_revenue: 'Umsatz',
  waiters_title: 'Leistung pro Servicekraft',
  col_waiter: 'Servicekraft',
  col_entered: 'Erfasst',
  col_served: 'Serviert',
  anonymous: 'Anonym',
}

export default de
