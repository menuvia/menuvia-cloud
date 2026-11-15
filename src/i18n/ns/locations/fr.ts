import type { Translation } from '../../core'
import type ro from './ro'

// vous ; établissement (comme `dashboard.nav_locatii`).
const fr: Translation<typeof ro> = {
  intro:
    'La journée en cours dans chaque établissement que vous gérez. Les chiffres sont calculés à ' +
    'l’ouverture de l’écran.',
  err_open: 'Nous n’avons pas pu ouvrir l’établissement. Réessayez.',
  err_load: 'Nous n’avons pas pu charger les établissements. Réessayez.',
  unavailable:
    'Le récapitulatif des établissements n’est pas encore disponible. Vous pouvez passer d’un ' +
    'établissement à l’autre depuis le sélecteur de restaurant de la barre latérale.',
  empty: 'Nous n’avons trouvé aucun établissement que vous gérez.',
  current: 'Établissement affiché',
  stat_ordersToday: 'Commandes du jour',
  stat_open: 'Commandes en cours',
  stat_revenue: 'Encaissements du jour',
  stat_last: 'Dernière commande',
  open: 'Ouvrir',
  open_aria: 'Ouvrir {name}',
  last_none: 'Aucune commande pour l’instant',
  last_today: 'aujourd’hui, {time}',
  last_yesterday: 'hier, {time}',
  last_date: '{date}, {time}',
}

export default fr
