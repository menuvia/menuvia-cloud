import type { Translation } from '../../core'
import type ro from './ro'

// vous ; chiffre d’affaires = venit, ticket moyen = bon mediu ; « serveur » =
// le serveur du restaurant (comme `kitchen.src_waiter`) ; les moyens de
// paiement comme `orders.method_*` / `payments.pay_method_meal_voucher`.
const fr: Translation<typeof ro> = {
  err_load: 'Impossible de charger les statistiques',
  country_unavailable:
    'Les statistiques d’encaissement reposent sur les données fiscales et ne sont disponibles que pour les ' +
    'restaurants situés en Roumanie.',
  period_last: { one: '{n} dernier jour', many: '{n} de derniers jours', other: '{n} derniers jours' },
  range_days: { one: '{n} jour', many: '{n} de jours', other: '{n} jours' },
  empty_title: 'Aucune commande sur la période sélectionnée',
  empty_desc: 'Modifiez la période ou attendez les premières commandes.',
  stat_orders: 'Commandes',
  stat_revenue: 'Chiffre d’affaires',
  stat_avgTicket: 'Ticket moyen',
  stat_qrRate: 'Taux QR',
  chart_revenue: 'Chiffre d’affaires par jour',
  chart_orders: 'Commandes par jour',
  series_revenue: 'Chiffre d’affaires',
  series_orders: 'Commandes',
  pie_source: 'Origine des commandes',
  pie_method: 'Moyen de paiement',
  src_qr: 'QR',
  src_waiter: 'Serveur',
  method_cash: 'Espèces',
  method_card: 'Carte',
  method_voucher: 'Titres-restaurant',
  method_online: 'Carte en ligne',
  method_other: 'Autres moyens',
  hourly_title: 'Heures de pointe',
  hourly_sub: '· 30 derniers jours',
  top_title: 'Meilleurs produits',
  sub_allTime: '· depuis le début',
  col_product: 'Produit',
  col_qty: 'Qté',
  col_orders: 'Commandes',
  col_revenue: 'Chiffre d’affaires',
  waiters_title: 'Performance des serveurs',
  col_waiter: 'Serveur',
  col_entered: 'Saisies',
  col_served: 'Servies',
  anonymous: 'Anonyme',
}

export default fr
