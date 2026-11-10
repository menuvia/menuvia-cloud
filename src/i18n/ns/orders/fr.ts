import type { Translation } from '../../core'
import type ro from './ro'

const fr: Translation<typeof ro> = {
  money: '{amount} lei',
  tableLabel: 'Table {table}',
  noTable: 'Sans table',
  soldOut: 'Épuisé',
  saving: 'Enregistrement…',

  method_cash: 'Espèces',
  method_card_pos: 'Carte (TPE)',
  method_card_online: 'Carte en ligne',
  method_meal_voucher: 'Titre-restaurant',
  method_other: 'Autre moyen',

  cancel_title: 'Annuler la commande',
  cancel_errGeneric:
    'L’annulation a été refusée. Vérifiez votre rôle ou le motif d’annulation, puis réessayez.',
  cancel_blocked:
    'La commande a {amount} lei de paiements encaissés et ne peut pas être annulée directement.',
  cancel_voidHelp:
    'Si l’argent a été {returned}, annulez les paiements (avec un motif, enregistré dans l’historique d’audit) et la commande est annulée. Sinon, finalisez-la par un paiement.',
  cancel_voidHelpReturned: 'rendu au client',
  cancel_voidOnline: '{refund} avant d’annuler les paiements.',
  cancel_voidOnlineRefund: 'Les paiements en ligne se remboursent manuellement depuis Stripe',
  cancel_reasonVoid: 'Motif (obligatoire pour annuler les paiements)',
  cancel_reasonServed: 'Motif (obligatoire — la commande a été servie)',
  cancel_reasonOptional: 'Motif (facultatif)',
  cancel_reasonPlaceholder: 'Ex. : le client a annulé, produit indisponible…',
  cancel_dismiss: 'Retour',
  cancel_voiding: 'Annulation des paiements…',
  cancel_voidAndCancel: 'Annuler paiements et commande',
  cancel_cancelling: 'Annulation…',

  cancelRej_overPayments:
    'La commande a des paiements encaissés et ne peut pas être annulée. Finalisez-la par un paiement.',
  cancelRej_reasonRequired: 'Le motif est obligatoire pour annuler une commande servie.',
  cancelRej_voidReasonRequired: 'Le motif est obligatoire pour annuler un paiement.',
  cancelRej_role:
    'Votre rôle ne permet pas cette action (seuls le propriétaire ou un manager peuvent annuler les paiements ou la commande).',
  cancelRej_terminal: 'La commande est déjà finalisée et ne peut plus être annulée.',
  cancelRej_network: 'Pas de connexion — l’annulation n’a pas été envoyée. Réessayez.',

  actionError_dismiss: 'Fermer le message',

  edit_title: 'Modifier la commande',
  edit_errMenuLoad: 'Le menu n’a pas pu être chargé',
  edit_errEmpty:
    'La commande doit contenir au moins 1 produit. Pour l’annuler, utilisez le bouton « Annuler » sur la fiche de la commande.',
  edit_errOrphan:
    'La commande contient des produits supprimés du menu (marqués ⚠). Retirez-les ou demandez au propriétaire de réactiver le produit avant d’enregistrer.',
  edit_emptyCart: 'Aucun produit dans la commande. Ajoutez-en au moins un ou annulez la commande.',
  edit_orphanTitle: 'Produit supprimé du menu',
  edit_orphanHint: 'Produit supprimé du menu — à retirer uniquement',
  edit_addProduct: '+ Ajouter un produit',
  edit_newSubtotal: 'Nouveau sous-total',
  edit_discountRecalc: '(la remise de {amount} lei sera recalculée)',
  edit_saveChanges: 'Enregistrer les modifications',
  edit_pickProduct: 'Choisir un produit',
  edit_noProducts: 'Aucune catégorie avec des produits',

  edit_errNetwork: 'Pas de connexion — la modification n’a pas été enregistrée. Réessayez.',
  edit_errConcurrent:
    'Quelqu’un d’autre a modifié la commande entre-temps. Fermez puis rouvrez la commande, et réessayez.',
  edit_errOptionGroup:
    'Les options choisies ne respectent pas les règles d’un groupe d’options du produit. Vérifiez le produit et enregistrez à nouveau.',
  edit_errWhoNamed: 'Le produit « {name} »',
  edit_errWhoUnknown: 'Un produit de la commande',
  edit_errSoldOutNone:
    '{who} est épuisé et ne peut plus être ajouté. Retirez-le de la commande et enregistrez à nouveau.',
  edit_errOffMenuNone:
    '{who} n’est plus au menu et ne peut plus être ajouté. Retirez-le de la commande et enregistrez à nouveau.',
  edit_errSoldOutSome:
    '{who} est désormais épuisé. {keep} Réduisez la quantité ou retirez-le, puis enregistrez à nouveau.',
  edit_errOffMenuSome:
    '{who} n’est plus au menu. {keep} Réduisez la quantité ou retirez-le, puis enregistrez à nouveau.',
  edit_errKeepUpTo: 'Vous pouvez garder au maximum la quantité déjà commandée ({n}).',
  edit_errKeepOnly: 'Vous pouvez seulement garder la quantité déjà commandée.',
  edit_errPartialPayments: 'La commande a des paiements enregistrés et ne peut plus être modifiée.',
  edit_errTerminal: 'La commande est déjà finalisée et ne peut plus être modifiée.',
  edit_errRole: 'Votre rôle ne permet pas de modifier la commande.',
  edit_errNotFound: 'La commande n’existe plus.',
  edit_errProductGone:
    'Un produit de la commande n’est plus disponible au menu. Retirez-le et enregistrez à nouveau.',
  edit_errOptionGone:
    'Une option choisie n’est plus disponible. Vérifiez le produit et enregistrez à nouveau.',
  edit_errQuantity: 'La quantité d’une ligne doit être comprise entre 1 et {max}.',
  edit_errTooMany: 'Une commande peut contenir au maximum 100 produits.',
  edit_errGeneric: 'La modification n’a pas été enregistrée. Réessayez.',

  mod_addToOrder: 'Ajouter à la commande — {amount} lei',
  mod_chooseExact: 'Choisissez exactement {n}',
  mod_chooseBetween: 'Choisissez entre {min} et {max}',
  mod_chooseAtLeast: 'Choisissez au moins {n}',
  mod_max: '{n} au maximum',
  mod_extras: 'Suppléments',
  mod_quantity: 'Quantité',
  mod_notesPlaceholder: 'Remarques (facultatif)',
  mod_missing: 'À choisir : {group}',

  audit_title: 'Historique de la commande',
  audit_errLoad: 'Erreur de chargement',
  audit_empty: 'Aucun événement enregistré pour cette commande pour l’instant.',
  audit_system: 'système',
  audit_ev_created: 'A créé la commande',
  audit_ev_deleted: 'A supprimé la commande',
  audit_ev_confirmed: 'A confirmé la commande',
  audit_ev_preparing: 'A envoyé en préparation',
  audit_ev_ready: 'A marqué comme prête',
  audit_ev_served: 'A marqué comme servie',
  audit_ev_closed: 'A clôturé la table (sans ticket fiscal)',
  audit_ev_paid: 'A encaissé le paiement',
  audit_ev_cancelled: 'A annulé la commande',
  audit_ev_status: 'Statut → {status}',
  audit_ev_discount: 'A modifié la remise',
  audit_ev_total: 'A recalculé le total',
  audit_ev_modified: 'A modifié la commande',
  audit_ev_itemsChanged: 'A modifié la commande ({items}{total})',
  audit_itemsCount: {
    one: '{from} → {n} produit',
    many: '{from} → {n} de produits',
    other: '{from} → {n} produits',
  },
  audit_itemsUnknown: 'produits',
  audit_totalPart: ' · total {amount} lei',
  audit_ev_itemAdded: 'A ajouté {product} × {qty}',
  audit_ev_itemDeleted: 'A retiré {product} × {qty}',
  audit_productFallback: 'produit',
  audit_ev_itemModified: 'A modifié un produit',

  ready_serve: 'Servie',

  pickup_at: 'À emporter pour {time}',

  card_status_new: 'Nouvelle',
  card_status_confirmed: 'Confirmée',
  card_status_preparing: 'En préparation',
  card_status_ready: 'Prête à servir',
  card_status_served: 'Servie',
  card_status_closed: 'Clôturée',
  card_status_paid: 'Payée',
  card_status_cancelled: 'Annulée',
  card_srcPickup: 'À emporter',
  card_srcManual: 'Manuelle',
  card_late: 'en retard',
  card_takenBy: 'Prise par : {name}',
  card_servedBy: 'Servie par : {name}',
  card_reprint: 'Réimprimer en cuisine',
  card_cancel: 'Annuler',
  card_history: 'Voir l’historique',
  card_payFull: 'Paiement intégral',
  card_payPartial: 'Paiement partiel',
  card_closeOrder: 'Clôturer la commande',
  card_closeTable: 'Clôturer la table',
  card_cashRegisterNote: 'Le paiement et le ticket se font sur votre caisse habituelle',
  card_planChecking:
    'Vérification de la formule du restaurant — la finalisation de la commande revient dans un instant.',
  card_closeEarlyTitle: 'Clôturer la commande avant qu’elle soit servie ?',
  card_closeEarlyDesc:
    'La commande est marquée comme finalisée (le stock est déduit et des points de fidélité sont attribués). Si elle n’a pas été honorée, utilisez « Annuler ».',
  card_closeTableTitle: 'Clôturer la table ?',
  card_closeTableDesc: '{note} Le paiement et le ticket se font sur la caisse de l’établissement.',
  card_closeTableUnknown:
    'Les commandes servies sont clôturées ; celles pas encore servies (nouvelles ou en préparation) sont annulées.',
  card_closeTableAll: 'Toutes les commandes ouvertes de cette table et sa session seront clôturées.',
  card_closeTableUnserved: {
    one: 'Les commandes servies sont clôturées ; {n} tournée non servie (nouvelle ou en préparation) sera ANNULÉE.',
    many: 'Les commandes servies sont clôturées ; {n} de tournées non servies (nouvelles ou en préparation) seront ANNULÉES.',
    other:
      'Les commandes servies sont clôturées ; {n} tournées non servies (nouvelles ou en préparation) seront ANNULÉES.',
  },

  step_preparing: 'Passer en préparation',
  step_ready: 'Prête',
  step_served: 'Servie',

  entry_errMenu: 'Le menu n’a pas pu être chargé. Vérifiez la connexion.',
  entry_errTables: 'Les tables n’ont pas pu être chargées. Vérifiez la connexion.',
  entry_errStill: 'Toujours pas. Vérifiez votre accès à Internet.',
  entry_errNotSent: 'La commande n’a pas été envoyée. Réessayez.',
  entry_errMissingGroup:
    'Un produit du panier a un groupe d’options obligatoire sans choix.',
  entry_errSoldOut: 'Un produit du panier est désormais épuisé. Retirez-le et renvoyez la commande.',
  entry_errProductGone: 'Un produit du panier n’est plus au menu. Retirez-le et renvoyez la commande.',
  entry_errOptions:
    'Une option ou un supplément du panier n’est plus disponible. Ajoutez à nouveau le produit.',
  entry_errQuantity: 'La quantité d’une ligne doit être comprise entre 1 et {max}.',
  entry_errTooMany: 'La commande contient trop de produits.',
  entry_errNotesTooLong: 'Les remarques sont trop longues.',
  entry_errOrderingOff: 'Le restaurant ne prend pas de commandes pour le moment.',
  entry_discardTitle: 'Abandonner la commande en cours ?',
  entry_discardDesc: {
    one: '{n} produit du panier sera perdu. La commande n’a PAS été envoyée en cuisine.',
    many: '{n} de produits du panier seront perdus. La commande n’a PAS été envoyée en cuisine.',
    other: '{n} produits du panier seront perdus. La commande n’a PAS été envoyée en cuisine.',
  },
  entry_discardConfirm: 'Abandonner la commande',
  entry_discardKeep: 'Continuer la commande',
  entry_selectTable: 'Choisir la table',
  entry_closeAria: 'Fermer la nouvelle commande',
  entry_cartCount: 'Panier ({n})',
  entry_cart: 'Panier',
  entry_total: 'Total : {amount} lei',
  entry_notesPlaceholder: 'Remarques sur la commande (facultatif)',
  entry_sending: 'Envoi…',
  entry_send: 'Envoyer la commande',
}

export default fr
