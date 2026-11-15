import type { Translation } from '../../core'
import type ro from './ro'

// revenue (as `home`), average ticket, waiter (as `kitchen.src_waiter`); the
// payment methods as `orders.method_*` / `payments.pay_method_meal_voucher`.
const en: Translation<typeof ro> = {
  err_load: 'Couldn’t load the statistics',
  country_unavailable:
    'Revenue statistics are based on fiscal data and are only available for restaurants in Romania.',
  period_last: { one: 'Last {n} day', other: 'Last {n} days' },
  range_days: { one: '{n} day', other: '{n} days' },
  empty_title: 'No orders in the selected period',
  empty_desc: 'Change the date range or wait for the first orders.',
  stat_orders: 'Orders',
  stat_revenue: 'Revenue',
  stat_avgTicket: 'Average ticket',
  stat_qrRate: 'QR rate',
  chart_revenue: 'Revenue per day',
  chart_orders: 'Orders per day',
  series_revenue: 'Revenue',
  series_orders: 'Orders',
  pie_source: 'Order source',
  pie_method: 'Payment method',
  src_qr: 'QR',
  src_waiter: 'Waiter',
  method_cash: 'Cash',
  method_card: 'Card',
  method_voucher: 'Meal vouchers',
  method_online: 'Online card',
  method_other: 'Other methods',
  hourly_title: 'Peak hours',
  hourly_sub: '· last 30 days',
  top_title: 'Top products',
  sub_allTime: '· all time',
  col_product: 'Product',
  col_qty: 'Qty',
  col_orders: 'Orders',
  col_revenue: 'Revenue',
  waiters_title: 'Waiter performance',
  col_waiter: 'Waiter',
  col_entered: 'Entered',
  col_served: 'Served',
  anonymous: 'Anonymous',
}

export default en
