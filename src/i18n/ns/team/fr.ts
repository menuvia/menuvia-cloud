import type { Translation } from '../../core'
import type ro from './ro'

// vous ; équipe (comme `dashboard.nav_echipa`) ; rôles comme `invite.role*`.
// « serveur » est le RÔLE (ospătar) : l’ordinateur est « le système » (comme
// `waiter.offline_reason_other`), jamais « le serveur ».
const fr: Translation<typeof ro> = {
  role_owner: 'Propriétaire',
  role_manager: 'Manager',
  role_waiter: 'Serveur',
  role_kitchen: 'Cuisine',

  members_count: {
    one: '{n} membre · Les invitations expirent sous 7 jours',
    many: '{n} de membres · Les invitations expirent sous 7 jours',
    other: '{n} membres · Les invitations expirent sous 7 jours',
  },
  seats_count: 'Places occupées : {used} sur {limit} (membres et invitations en attente)',
  seats_full:
    'Toutes les places de l’équipe sont occupées. Pour inviter une nouvelle personne, retirez un ' +
    'membre ou annulez une invitation en attente ; vous pouvez renvoyer une invitation déjà en ' +
    'attente. Pour plus de places, une formule supérieure est nécessaire.',
  founder_note:
    'En mode fondateur, vous voyez l’équipe, mais seuls le propriétaire ou le manager du restaurant ' +
    'envoient les invitations, depuis leur propre compte.',
  invite_title: 'Inviter un nouveau membre',
  email: 'E-mail',
  email_placeholder: 'jean@restaurant.fr',
  role: 'Rôle',
  sending: 'Envoi…',
  send: 'Envoyer l’invitation',
  inv_sent: 'Invitation envoyée à {email}',
  inv_revoked: 'Invitation annulée',
  err_revoke: 'Échec de l’annulation',
  member_removed: 'Membre retiré',
  err_remove: 'Échec du retrait',
  owner_forbidden: 'La promotion au rôle de propriétaire n’est pas autorisée',
  role_updated: 'Rôle mis à jour',
  err_role: 'Échec de la mise à jour du rôle',
  err_load: 'Impossible de charger l’équipe',

  inv_err_send: 'Échec de l’envoi',
  inv_err_network: 'Erreur de connexion. Vérifiez votre connexion internet.',
  inv_err_server_config:
    'Les invitations ne sont pas activées dans le système pour le moment. Réessayez plus tard.',
  inv_err_email_not_configured:
    'L’envoi d’e-mails n’est pas activé pour le moment. Écrivez-nous et nous vous aiderons.',
  inv_err_missing_fields: 'Renseignez l’adresse e-mail et le rôle.',
  inv_err_invalid_email: 'L’adresse e-mail n’est pas valide.',
  inv_err_invalid_role: 'Le rôle choisi n’existe pas. Choisissez Manager, Serveur ou Cuisine.',
  inv_err_auth_invalid: 'Votre session a expiré. Reconnectez-vous.',
  inv_err_forbidden: 'Seuls le propriétaire ou le manager peuvent envoyer des invitations.',
  inv_err_rate_limit_unavailable:
    'Nous n’avons pas pu vérifier la limite d’invitations. Réessayez dans quelques instants.',
  inv_err_rate_limited:
    'Vous avez envoyé trop d’invitations au cours des dernières 24 heures. Réessayez demain ou ' +
    'contactez le support.',
  inv_err_already_member: 'Cet utilisateur est déjà membre.',
  inv_err_invite_create_failed: 'Nous n’avons pas pu créer l’invitation. Réessayez.',
  inv_err_email_send_uncertain:
    'Nous n’avons pas pu confirmer l’envoi de l’e-mail. L’invitation apparaît dans la liste ; si elle ' +
    'n’arrive pas d’ici quelques minutes, renvoyez-la.',
  inv_err_email_send_failed: 'L’e-mail d’invitation n’a pas pu être envoyé. Réessayez.',
  inv_err_team_member_limit:
    'Toutes les places de l’équipe sont occupées (membres et invitations en attente). Retirez un ' +
    'membre ou annulez une invitation pour libérer une place.',

  pending_title: 'Invitations en attente ({n})',
  pending_meta: '{role} · expire le {date}',
  current_title: 'Membres actuels ({n})',
  empty_title: 'Aucun membre pour l’instant',
  empty_desc: 'Invitez vos collègues pour gérer le restaurant ensemble.',
  user_fallback: 'Utilisateur',
  self: 'Vous',
  role_aria: 'Rôle de {name}',
  remove_aria: 'Retirer {name} de l’équipe',
  remove_title: 'Retirer de l’équipe',
  remove_confirm: 'Voulez-vous vraiment retirer {name} ?',
  remove: 'Retirer',
}

export default fr
