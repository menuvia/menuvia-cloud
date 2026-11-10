import type { Translation } from '../../core'
import type ro from './ro'

const fr: Translation<typeof ro> = {
  header_backTitle: 'Retour à l’espace d’administration',
  header_back: 'Retour à mon espace',
  title: 'Cuisine',
  titleWithName: 'Cuisine — {name}',
  selectRestaurant: 'Choisir le restaurant',
  soldOutAria: 'Produits épuisés — indiquez ce qui est terminé',
  soldOut: 'Épuisés',
  push_onAria: 'Notifications activées — désactiver',
  push_blockedAria: 'Les notifications sont bloquées dans les réglages du navigateur',
  push_enable: 'Activer les notifications des nouvelles commandes',
  push_onTitle: 'Notifications activées — cliquez pour les désactiver',
  push_blockedTitle: 'Les notifications sont bloquées dans le navigateur',
  push_on: 'Activées',
  push_blocked: 'Bloquées',
  push_off: 'Notifications',
  conn_connected: 'Connecté',
  conn_connecting: 'Connexion…',
  conn_disconnected: 'Déconnecté',

  pushBanner_text:
    'Activez les notifications pour être alerté des nouvelles commandes, même lorsque l’onglet est fermé.',
  pushBanner_enabling: 'Activation…',
  pushBanner_enable: 'Activer →',
  sound_locked:
    'Le son des nouvelles commandes est coupé par le navigateur jusqu’à ce que vous touchiez l’écran une fois.',
  sound_unlock: 'Activer le son',
  list_truncated:
    'Seules les {limit} commandes actives les plus récentes sont affichées — finalisez les anciennes commandes pour que la liste soit complète.',
  sync_error: 'Impossible de synchroniser les commandes. Vérifiez la connexion et réessayez.',
  sync_dismiss: 'Fermer le message d’erreur',

  col_new: 'Nouvelles commandes',
  col_preparing: 'En préparation',
  col_ready: 'Prêtes à servir',
  empty_title: 'Aucune commande',
  empty_newHint: 'Les commandes passées par QR apparaîtront ici automatiquement.',

  src_qr: 'QR',
  src_waiter: 'Serveur',
  next_confirm: 'Confirmer',
}

export default fr
