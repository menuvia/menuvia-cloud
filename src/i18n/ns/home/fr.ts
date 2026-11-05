import type { Translation } from '../../core'
import type ro from './ro'

const fr: Translation<typeof ro> = {
  welcome_title: 'Bienvenue, {name}',
  welcome_description:
    'Configurez votre restaurant, vérifiez vos codes QR et suivez l’activité du jour.',

  metric_ordersToday: 'Commandes du jour',
  metric_ordersTodayHint: 'hors commandes annulées',
  metric_loadFailedHint: 'chargement impossible',
  metric_activeProducts: 'Produits actifs',
  metric_activeQrs: 'Codes QR actifs',
  metric_pickupQrHint: 'QR général (à emporter uniquement)',
  metric_scannableTablesHint: 'tables scannables',
  metric_occupiedTables: 'Tables occupées',
  metric_openOrdersHint: 'avec des commandes en cours',
  metric_revenueToday: 'Encaissements du jour',
  metric_revenueHint: 'paiements enregistrés aujourd’hui',
  metric_tipsToday: 'Pourboires du jour',
  metric_tipsHint: 'à titre indicatif, non inclus dans les encaissements',
  metric_setup: 'Configuration',
  metric_setupDoneHint: 'tout est prêt ✓',
  metric_setupStepsHint: 'étapes terminées',
  metrics_someFailed: 'Certains chiffres n’ont pas pu être chargés.',

  setup_title: 'Configuration du restaurant',
  setup_progress: '{done}/{total} étapes terminées',
  setup_progressAria: 'Progression de la configuration',
  setup_addProducts: 'Ajouter des produits',
  setup_createCategories: 'Créer des catégories',
  setup_generateTableQrs: 'Générer les codes QR des tables',
  setup_checkPublicMenu: 'Vérifier le menu public',
  setup_inviteTeam: 'Inviter l’équipe',
  setup_firstOrderPickup: 'Première commande test — ouvrez le menu public et commandez',
  setup_firstOrderTable: 'Première commande test — ouvrez le code QR d’une table et commandez',
  setup_itemDoneAria: '{label} (terminé)',
  setup_itemUnknownAria: '{label} (état inconnu)',

  score_title: 'Score du menu',
  score_loading: 'Chargement du score...',

  quick_title: 'Actions rapides',
  quick_addProduct: 'Ajouter un produit',
  quick_generateQrs: 'Générer des codes QR',
  quick_qrStands: 'Supports QR physiques',
  quick_viewPublicMenu: 'Voir le menu public',
  quick_viewOrders: 'Voir les commandes',
  quick_inviteWaiter: 'Inviter un serveur',

  sub_title: 'Abonnement et facturation',
  sub_yourPlan: 'Votre formule : {name}. ',
  sub_manageHint: 'Mettez à jour votre carte, changez de formule ou téléchargez vos factures.',
  sub_noCustomer:
    'Votre compte n’a pas d’abonnement payé par carte : il n’y a donc rien à gérer ici. Les formules et les tarifs se trouvent sur la page des formules.',
  sub_portalFallback:
    'Nous n’avons pas pu ouvrir le portail de facturation. Réessayez dans quelques instants.',
  sub_seePlans: 'Voir les formules',
  sub_opening: 'Ouverture…',
  sub_manage: 'Gérer l’abonnement',

  upsell_regionLabel: 'Offre : {title}',
  upsell_orderingLead:
    'Vos clients commandent eux-mêmes et la cuisine reçoit la commande immédiatement.',
  upsell_orderingBenefit1: 'Commandes à table, par code QR',
  upsell_orderingBenefit2: 'Écran de cuisine pour les nouvelles commandes',
  upsell_orderingBenefit3: 'Commandes à emporter',
  upsell_paymentsTitle: 'Paiement à table',
  upsell_paymentsLead: 'Avec la formule {plan}.',
  upsell_paymentsBenefit1: 'Le client paie depuis son téléphone',
  upsell_paymentsBenefit2: 'Le ticket fiscal est émis automatiquement',
  upsell_paymentsBenefit3:
    'Les encaissements et la TVA apparaissent automatiquement dans les rapports',
  upsell_seePlan: 'Voir la formule',

  planUnknown_text:
    'Nous n’avons pas pu charger la formule du restaurant. En attendant, certaines sections restent masquées.',

  agent_heading: 'Votre agent Menuvia',
  agent_defaultName: 'Agent commercial',
  agent_scope:
    'L’agent voit et peut modifier UNIQUEMENT le menu (catégories, produits, options) et les tables avec leurs codes QR. ' +
    'Il ne voit PAS les commandes, les encaissements, les réservations, les données fiscales, les paramètres ni l’équipe. ' +
    'Cela n’affecte pas votre abonnement, et vous pouvez retirer cet accès à tout moment.',
  agent_accessGranted: 'Accès accordé',
  agent_accessRequested: 'L’agent a demandé l’accès',
  agent_accessRevoked: 'Accès retiré',
  agent_accessNone: 'Aucun accès',
  agent_ownerOnly:
    'Seul le propriétaire du restaurant peut accorder ou retirer l’accès de l’agent.',
  agent_grant: 'Autoriser l’accès de l’agent',
  agent_grantOk: 'L’agent a désormais accès au menu',
  agent_decline: 'Refuser la demande',
  agent_declineOk: 'La demande de l’agent a été refusée',
  agent_revoke: 'Retirer l’accès',
  agent_revokeOk: 'L’accès de l’agent a été retiré',
  agent_revokeConfirmTitle: 'Retirer l’accès de l’agent ?',
  agent_revokeConfirmText:
    'L’agent ne pourra plus voir ni modifier le menu et les tables. Vous pourrez lui redonner l’accès à tout moment.',
}

export default fr
