import type { Translation } from '../../core'
import type ro from './ro'

// vous ; client (côté menu, comme `tables.gm_*`) ; établissement (comme
// `dashboard.nav_locatii`) ; fidélité (comme `waiter.loyalty_*`) ; menu QR.
const fr: Translation<typeof ro> = {
  loy_title: 'Fidélité — points et récompenses',
  loy_desc:
    'Les clients gagnent des points à chaque commande passée depuis le menu QR et une récompense quand ' +
    'ils atteignent le seuil. Les points vont sur une carte numérique dans le téléphone du client — ' +
    'éventuellement liée à son numéro de téléphone (stocké chiffré, sous forme de hash).',
  loy_locked:
    'Disponible à partir de la formule {plan} — les points sont attribués sur les commandes QR.',
  loy_enableTitle: 'Activer la fidélité dans le menu QR',
  loy_enableDesc:
    'Les clients voient la carte de points dans le menu ; les serveurs échangent les récompenses depuis ' +
    'leur page, avec le code de la carte.',
  loy_toggle: 'La fidélité dans le menu QR',
  loy_enabled: 'Fidélité activée',
  loy_disabled: 'Fidélité désactivée',
  loy_loadError:
    'Nous n’avons pas pu lire le programme de fidélité enregistré. Pour ne pas l’écraser avec les valeurs ' +
    'par défaut, l’enregistrement est bloqué jusqu’à ce que nous puissions le lire.',
  loy_ppl: 'Points par leu dépensé',
  loy_threshold: 'Seuil de récompense (points)',
  loy_reward: 'Récompense (ce que reçoit le client au seuil)',
  loy_rewardPlaceholder: 'Ex. : un dessert offert par la maison',
  loy_notSaved:
    'Le programme n’est pas encore enregistré : appuyez sur « Enregistrer » pour que la fidélité démarre dans le menu.',
  loy_err_ppl: 'Les points par leu doivent être compris entre 0,1 et 100.',
  loy_err_threshold: 'Le seuil doit être compris entre 1 et 100 000 points.',
  loy_err_reward: 'Décrivez la récompense (200 caractères max.).',
  err_save: 'Échec de l’enregistrement',

  sms_title: 'Notifications SMS aux clients',
  sms_desc:
    'Le client reçoit un SMS à la confirmation de la réservation et quand la commande à emporter est ' +
    'prête. Uniquement pour les numéros de mobile roumains ; les messages sont strictement ' +
    'transactionnels (pas de marketing).',
  sms_locked:
    'Disponible sur les formules payantes — chaque formule inclut un nombre de SMS par mois.',
  sms_enableTitle: 'Activer les SMS',
  sms_enableDesc:
    'Confirmation de réservation + « votre commande est prête » pour les commandes à emporter. Ils ' +
    's’arrêtent automatiquement quand vous atteignez le plafond mensuel de la formule.',
  sms_toggle: 'SMS aux clients',
  sms_enabled: 'Les SMS ont été activés',
  sms_disabled: 'Les SMS ont été désactivés',
  sms_usage: 'Ce mois-ci : {count}',
  sms_usageCap: '{used} / {cap} SMS',
  sms_usageNoCap: '{used} SMS',
  sms_capReached: '— plafond atteint ; reprise le mois prochain',

  mfa_title: 'Authentification en deux étapes (MFA)',
  mfa_active: 'Activée',
  mfa_inactive: 'Désactivée',
  mfa_desc:
    'Protégez le compte avec un code généré par une application d’authentification (Google ' +
    'Authenticator, 1Password, Aegis). Fortement recommandé pour les comptes ayant un accès plateforme.',
  mfa_qrAlt: 'Code QR pour l’application d’authentification',
  mfa_scan:
    'Scannez le code QR avec l’application d’authentification, puis saisissez le code à 6 chiffres généré.',
  mfa_manual: 'Impossible de scanner ? Saisissez la clé manuellement : {key}',
  mfa_codeAria: 'Code de vérification de l’application',
  mfa_verifying: 'Vérification…',
  mfa_confirmEnable: 'Confirmer et activer',
  mfa_dismiss: 'Annuler',
  mfa_confirmWithCode: 'Confirmez avec le code de l’application :',
  mfa_disable: 'Désactiver la MFA',
  mfa_disableStart: 'Désactiver la MFA…',
  mfa_reactivate: 'Réactiver la MFA',
  mfa_enable: 'Activer la MFA',
  mfa_preparing: 'Préparation…',
  mfa_enabledToast: 'MFA activée — le compte demande désormais le code de l’application',
  mfa_disabledToast: 'MFA désactivée',
  mfa_reactivatedToast: 'MFA réactivée — le compte demande désormais le code de l’application',
  mfa_err_load: 'Nous n’avons pas pu charger l’état de la MFA',
  mfa_err_start: 'Nous n’avons pas pu lancer l’activation de la MFA',
  mfa_err_badCode: 'Code incorrect ou expiré. Réessayez avec le code actuel de l’application.',
  mfa_err_verify: 'La vérification a échoué',
  mfa_err_disable: 'La désactivation a échoué',
  mfa_err_reactivate: 'La réactivation a échoué',
  mfa_err_aal2: 'La désactivation de la MFA nécessite une session vérifiée par MFA (aal2)',

  gdpr_title: 'Mes données (RGPD)',
  gdpr_desc:
    'Vous pouvez télécharger une copie des données de votre compte ou demander la suppression du compte. ' +
    'Détails dans la {policy}.',
  gdpr_policy: 'Politique de confidentialité',
  gdpr_preparing: 'Préparation…',
  gdpr_export: '⬇ Exporter mes données (JSON)',
  gdpr_cancelling: 'Annulation…',
  gdpr_cancelDeletion: '↩ Annuler la suppression programmée',
  gdpr_sending: 'Envoi…',
  gdpr_delete: 'Supprimer le compte',
  gdpr_pendingNote:
    '⚠️ La suppression du compte est programmée (30 jours après la demande). D’ici là, le compte ' +
    'fonctionne normalement et vous pouvez annuler à tout moment depuis cette page.',
  gdpr_exported: 'L’export a été téléchargé.',
  gdpr_err_export: 'L’export a échoué. Réessayez.',
  gdpr_confirmTitle: 'Supprimer le compte ?',
  gdpr_confirmDesc:
    'Le compte et vos données (restaurants, menus, membres) seront définitivement supprimés après 30 jours. ' +
    'Pendant cette période, vous pouvez changer d’avis depuis cette page. Les factures fiscales restent ' +
    'archivées conformément à la loi (10 ans).',
  gdpr_confirmOk: 'Programmer la suppression',
  gdpr_scheduledFor: 'La suppression est programmée pour le {date}.',
  gdpr_scheduled: 'La suppression du compte a été programmée (30 jours).',
  gdpr_err_request: 'La demande de suppression a échoué.',
  gdpr_cancelled: 'La demande de suppression a été annulée. Le compte reste actif.',
  gdpr_err_cancel: 'L’annulation a échoué. Réessayez.',
  gdpr_err_activeSub:
    'Vous avez un abonnement actif. Résiliez-le via le portail Stripe avant de supprimer le compte.',
  gdpr_cookiesDesc:
    'Les statistiques d’utilisation (PostHog) et le signalement des erreurs (Sentry) ne fonctionnent qu’avec ' +
    'l’accord donné dans le bandeau des cookies, sur ce navigateur. Vous pouvez le modifier ou le retirer à tout moment.',
  gdpr_cookies: 'Paramètres des cookies',

  loc_title: 'Établissements',
  loc_desc:
    'Vous avez plusieurs établissements ? Ajoutez-en un nouveau — il démarre vide, avec son propre menu ' +
    'et ses tables. Le nombre d’établissements possibles dépend de la formule du compte.',
  loc_add: 'Ajouter un établissement',
  loc_dialogDesc:
    'Le nouvel établissement démarre vide : vous ajoutez ensuite ses produits, ses tables et son équipe. ' +
    'Le restaurant que vous gérez actuellement reste inchangé.',
  loc_name: 'Nom de l’établissement',
  loc_err_nameRequired: 'Saisissez le nom de l’établissement.',
  loc_reload: 'Recharger',
  loc_create: 'Créer l’établissement',
  loc_uncertain:
    'Nous ne savons pas avec certitude si l’établissement a été créé — rechargez la page et vérifiez la liste.',
  loc_err_limit:
    'La formule actuelle ne permet pas un établissement de plus. Pour davantage d’établissements, une formule ' +
    'supérieure est nécessaire.',
  loc_err_create: 'L’établissement n’a pas pu être créé. Réessayez.',
}

export default fr
