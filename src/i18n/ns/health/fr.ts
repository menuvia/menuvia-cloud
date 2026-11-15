import type { Translation } from '../../core'
import type ro from './ro'

// vous ; « espace » pour le panneau du restaurant ; les clients (convives) ;
// le chemin « Paramètres → Caisse & tickets » et le bouton « Aide » comme dans
// `dashboard`. Le « serveur » est le serveur du restaurant.
const fr: Translation<typeof ro> = {
  err_load: 'Impossible de charger le score',
  err_recompute: 'Impossible de recalculer le score',
  err_cooldown: 'Le score a été recalculé récemment. Réessayez dans quelques minutes.',
  loadFail_title: 'Nous n’avons pas pu charger le score',
  loadFail_desc: 'Une erreur s’est produite lors de la communication avec le système. Réessayez dans quelques instants.',
  none_title: 'Le score n’a pas encore été calculé',
  none_desc: 'Le score est calculé automatiquement toutes les 30 minutes. Vous pouvez lancer un recalcul manuel maintenant.',
  computing: 'Calcul en cours…',
  compute_now: 'Calculer maintenant',
  eyebrow: 'Score de santé du compte',
  title: 'Où en est votre café',
  last_recompute: 'Dernier recalcul : {ago}',
  recomputing: '⏳ Calcul…',
  recompute: '↻ Recalculer',
  delta_vs_prev: '({delta} par rapport au score précédent)',
  comp_title: 'Composition du score',
  bar_login: 'Fréquence de connexion',
  bar_orders: 'Volume de commandes',
  bar_team: 'Équipe',
  bar_tickets: 'Stabilité',
  bar_engagement: 'Engagement',
  sugg_title: 'Ce que vous pouvez faire pour améliorer le score',
  how_title: 'Comment fonctionne le score',
  how_fiscal:
    'Score de 0 à 100, recalculé toutes les 30 minutes, à partir de 5 composantes : connexion (20), commandes ' +
    '(30), équipe (15), stabilité de la caisse enregistreuse (20) et utilisation des fonctionnalités (15).',
  how_nonFiscal:
    'Score de 0 à 100, recalculé toutes les 30 minutes, à partir de 4 composantes : connexion, commandes, équipe ' +
    'et utilisation des fonctionnalités.',
  ago_seconds: 'il y a quelques secondes',
  ago_minutes: { one: 'il y a {n} minute', many: 'il y a {n} de minutes', other: 'il y a {n} minutes' },
  ago_hours: { one: 'il y a {n} heure', many: 'il y a {n} d’heures', other: 'il y a {n} heures' },
  ago_days: { one: 'il y a {n} jour', many: 'il y a {n} de jours', other: 'il y a {n} jours' },
  narr_critical:
    'Votre café montre des signes inquiétants. Consultez les suggestions ci-dessous ; si vous êtes bloqué, ' +
    'utilisez le bouton « Aide ».',
  narr_excellent:
    'Félicitations ! Vous utilisez Menuvia à son plein potentiel. Continuez ainsi et pensez à recommander la ' +
    'plateforme à d’autres restaurateurs.',
  narr_good:
    'Compte en bonne santé, mais il reste des points à améliorer. Prenez le temps de suivre 1 ou 2 des ' +
    'suggestions ci-dessous.',
  narr_average:
    'Les possibilités d’optimisation sont nombreuses. Commencez par la composante dont le score est le plus bas.',
  narr_low: 'L’application est sous-utilisée. Commencez par la composante dont le score est le plus bas.',
  trend_rising: 'En hausse',
  trend_stable: 'Stable',
  trend_declining: 'En baisse',
  trend_critical: 'Critique — demande votre attention',
  label_excellent: 'Excellent',
  label_good: 'Bon',
  label_average: 'Moyen',
  label_weak: 'Faible',
  label_critical: 'Critique',
  sc_login: 'Fréquence de connexion',
  sg_loginNever:
    'Vous ne vous êtes jamais connecté — ouvrez votre espace au moins une fois par jour pour voir les commandes en direct.',
  sg_loginDays: {
    one: 'Dernière connexion : il y a {n} jour. Connectez-vous au moins 2 à 3 fois par semaine.',
    many: 'Dernière connexion : il y a {n} de jours. Connectez-vous au moins 2 à 3 fois par semaine.',
    other: 'Dernière connexion : il y a {n} jours. Connectez-vous au moins 2 à 3 fois par semaine.',
  },
  sg_loginDaily: 'Connectez-vous chaque jour pour obtenir le score maximal.',
  sc_orders: 'Volume de commandes',
  sg_ordersZero:
    'Aucune commande cette semaine. Vérifiez que le menu QR est accessible aux clients et que les serveurs ' +
    'saisissent les commandes.',
  sg_ordersDown:
    'Commandes en baisse ({wk} contre {prev} la semaine dernière). Vérifiez les promotions, les horaires, la fréquentation.',
  sg_ordersGrow: 'Continuez à augmenter le volume — Happy Hour, commandes QR rapides, fidélisation des clients.',
  sc_team: 'Taille de l’équipe',
  sg_teamSolo:
    'Vous êtes seul dans le compte. Invitez vos serveurs et la cuisine — la productivité augmente quand chacun ' +
    'a son rôle.',
  sg_teamMore: {
    one: '{n} membre. Invitez-en encore {more} pour obtenir le score maximal.',
    many: '{n} de membres. Invitez-en encore {more} pour obtenir le score maximal.',
    other: '{n} membres. Invitez-en encore {more} pour obtenir le score maximal.',
  },
  sc_tickets: 'Erreurs du Bridge fiscal',
  sg_ticketsAlerts: {
    one: '{n} ticket fiscal en erreur au cours des 7 derniers jours. Vérifiez Paramètres → Caisse & tickets — la caisse, le papier, la connexion.',
    many: '{n} de tickets fiscaux en erreur au cours des 7 derniers jours. Vérifiez Paramètres → Caisse & tickets — la caisse, le papier, la connexion.',
    other:
      '{n} tickets fiscaux en erreur au cours des 7 derniers jours. Vérifiez Paramètres → Caisse & tickets — la caisse, le papier, la connexion.',
  },
  sg_ticketsOk: 'Système fiscal stable. Continuez ainsi.',
  sc_engagement: 'Utilisation des fonctionnalités',
  sg_engagementFiscal:
    'Activez davantage de modules : ouvrez des sessions de caisse, configurez la Happy Hour, ajoutez des ' +
    'recettes pour la gestion des stocks, connectez le Bridge fiscal.',
  sg_engagement:
    'Activez davantage de modules : configurez la Happy Hour, ajoutez des recettes pour la gestion des stocks, ' +
    'connectez l’imprimante de la cuisine.',
}

export default fr
