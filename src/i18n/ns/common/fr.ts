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
  elapsed_s: '{n} s',
  elapsed_m: '{n} min',
  elapsed_hm: '{h} h {m} min',
  signOut: 'Se déconnecter',
  signOut_busy: 'Déconnexion…',
  signOut_confirmTitle: 'Se déconnecter ?',
  signOut_confirmDesc: 'Vous devrez vous reconnecter sur cet appareil.',
  signOut_failed: 'Impossible de se déconnecter. Réessayez.',
  lang_title: 'Langue de l’interface',
  lang_saving: 'Enregistrement…',
  lang_saveFailed: 'Impossible d’enregistrer la langue. Réessayez.',
  lang_columnMissing:
    'La langue ne peut pas encore être enregistrée dans votre compte : le serveur n’a pas reçu la dernière mise à jour. Votre espace reste dans la langue actuelle.',
  lang_columnMissingShort:
    'La langue ne peut pas encore être enregistrée : le serveur n’a pas reçu la dernière mise à jour.',
  lang_name_ro: 'Română',
  lang_name_en: 'English',
  lang_name_fr: 'Français',
  lang_name_de: 'Deutsch',
  items_count: { one: '{n} produit', many: '{n} de produits', other: '{n} produits' },
}

export default fr
