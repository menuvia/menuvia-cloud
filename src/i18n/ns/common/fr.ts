import type { Translation } from '../../core'
import type ro from './ro'

const fr: Translation<typeof ro> = {
  save: 'Enregistrer',
  cancel: 'Annuler',
  close: 'Fermer',
  retry: 'Réessayer',
  delete: 'Supprimer',
  edit: 'Modifier',
  back: 'Retour',
  loading: 'Chargement…',
  autoSaveHint: '· enregistré automatiquement',
  err_generic: 'L’action n’a pas pu être effectuée. Réessayez.',
  err_network: 'Pas de connexion. Vérifiez votre accès à Internet et réessayez.',
  err_permission: 'Vous n’avez pas les droits pour cette action.',
  err_not_found: 'Cet élément n’existe plus ou vous n’y avez pas accès.',
  err_duplicate: 'Un élément avec ces données existe déjà.',
  err_forbidden: 'Action non autorisée pour votre rôle.',
  items_count: { one: '{n} produit', many: '{n} de produits', other: '{n} produits' },
}

export default fr
