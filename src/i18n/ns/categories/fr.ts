import type { Translation } from '../../core'
import type ro from './ro'

// « Vous », espaces ordinaires avant : ? ! ; „client” e „client” (le menu
// des clients, comme `products`).
const fr: Translation<typeof ro> = {
  unknownError: 'Erreur inconnue',
  count: { one: '{n} catégorie', many: '{n} de catégories', other: '{n} catégories' },
  add: 'Ajouter une catégorie',
  empty_title: 'Aucune catégorie',
  empty_desc: 'Ajoutez une première catégorie pour organiser votre menu.',
  productsCount: { one: '{n} produit', many: '{n} de produits', other: '{n} produits' },
  moveUp: 'Monter',
  moveDown: 'Descendre',
  editAria: 'Modifier la catégorie',
  deleteAria: 'Supprimer la catégorie',

  err_order: 'L’ordre des catégories n’a pas pu être enregistré.',
  err_save: 'La catégorie n’a pas pu être enregistrée.',
  err_move: 'Les produits n’ont pas pu être déplacés.',
  err_delete: 'Impossible de supprimer la catégorie.',
  toast_added: 'Catégorie ajoutée',
  toast_updated: 'Mis à jour',
  toast_deleted: 'Supprimée',

  modal_titleEdit: 'Modifier la catégorie',
  modal_titleAdd: 'Ajouter une catégorie',
  field_name: 'Nom *',
  field_nameAria: 'Nom de la catégorie',
  field_namePh: 'Plats principaux',
  field_emoji: 'Emoji',
  field_meta: 'Texte en italique sous le titre (facultatif)',
  field_metaAria: 'Texte en italique sous le titre',
  field_metaPh: 'ex. : Servi jusqu’à 13 h',
  field_metaHint: 'Affiché sur le menu public sous le nom de la catégorie.',
  tr_title: 'Traductions',
  tr_optional: '(facultatif)',
  tr_desc:
    'Le nom de la catégorie dans les langues actives du menu. Les champs laissés vides affichent automatiquement le nom en {lang}.',
  tr_label: '{flag} Nom ({lang})',
  tr_aria: 'Nom ({lang})',
  saving: 'Enregistrement…',
  saveError: 'La catégorie n’a pas pu être enregistrée : {error}',

  del_title: 'Supprimer la catégorie',
  del_checking: 'Vérification des produits de la catégorie…',
  del_empty: 'La catégorie n’a aucun produit.',
  del_move: {
    one: 'Déplacer le produit de cette catégorie vers :',
    many: 'Déplacer les {n} de produits de cette catégorie vers :',
    other: 'Déplacer les {n} produits de cette catégorie vers :',
  },
  del_moveAria: 'Déplacer les produits vers',
  del_none: 'Aucune catégorie (ils n’apparaîtront pas dans le menu)',
  del_noneNote:
    'Sans catégorie, les produits n’apparaissent pas dans le menu des clients tant que vous ne leur en choisissez pas une.',
  deleting: 'Suppression…',
}

export default fr
