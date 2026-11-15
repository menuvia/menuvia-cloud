import type { Translation } from '../../core'
import type ro from './ro'

// « Vous », espaces ordinaires avant : ? ! et dans « » ; „client” e „client”,
// „ospătar” e „serveur” (comme `waiter`), „grup de opțiuni” e „groupe
// d’options” (comme `products`).
const fr: Translation<typeof ro> = {
  intro: 'Groupes d’options (ex. : Sauce en plus, Taille)',
  newGroup: 'Nouveau groupe',
  loadError: 'Impossible de charger les groupes d’options.',
  empty_title: 'Aucun groupe d’options',
  empty_desc: 'Ajoutez un premier groupe pour proposer des options sur les produits (ex. : Taille, Garnitures).',

  card_single: 'Choix unique',
  card_multiple: 'Choix multiple',
  card_max: { one: 'max {n} option', many: 'max {n} d’options', other: 'max {n} options' },
  card_required: 'Obligatoire',
  card_unused: 'Aucun produit ne l’utilise — les clients ne le voient pas',
  card_usedBy: { one: 'Utilisé par {n} produit', many: 'Utilisé par {n} de produits', other: 'Utilisé par {n} produits' },
  card_tooFew: '⚠ Trop peu d’options disponibles : les produits avec ce groupe ne peuvent pas être commandés.',
  card_pick: 'Choisir les produits',
  card_deleteAria: 'Supprimer le groupe',
  price_plus: '+{amount} lei',
  price_minus: '−{amount} lei',
  price_included: 'Inclus',
  opt_markUnavailable: 'Marquer indisponible',
  opt_markAvailable: 'Marquer disponible',
  opt_available: 'Disponible',
  opt_unavailable: 'Indisponible',
  opt_deleteAria: 'Supprimer l’option',
  opt_namePh: 'Nom de l’option',
  opt_nameAria: 'Nom de la nouvelle option du groupe {group}',
  opt_pricePh: '+lei',
  opt_priceAria: 'Supplément de prix pour la nouvelle option du groupe {group}',
  opt_add: 'Ajouter',

  pick_title: 'Les produits avec « {group} »',
  pick_desc: 'Cochez les produits pour lesquels le client et le serveur choisissent dans ce groupe.',
  pick_search: 'Rechercher un produit',
  pick_noProducts: 'Vous n’avez pas encore de produits.',
  pick_noMatch: 'Aucun produit trouvé.',
  pick_count: {
    one: '{n} produit sélectionné',
    many: '{n} de produits sélectionnés',
    other: '{n} produits sélectionnés',
  },

  edit_title: 'Modifier le groupe',
  field_name: 'Nom *',
  field_namePh: 'Garniture en plus',
  field_type: 'Type de sélection',
  type_single: 'Une seule option',
  type_multiple: 'Plusieurs options',
  type_singleHint: 'Ex. : « Taille » — le client choisit Petite OU Moyenne OU Grande',
  type_multipleHint: 'Ex. : « Garnitures » — le client peut en choisir plusieurs à la fois',
  field_max: 'Nombre maximal d’options',
  field_maxPh: 'Illimité',
  field_maxHint: 'Combien d’options le client peut cocher. Laissez vide pour illimité.',
  field_required: 'Le client doit-il choisir ?',
  req_yes: 'Oui, obligatoire',
  req_no: 'Non, facultatif',
  req_yesHint: 'Le client ne peut pas ajouter le produit au panier sans choisir quelque chose',
  req_noHint: 'Le client peut passer cette section',
  tr_title: 'Traductions',
  tr_groupFallback: 'Groupe',
  saving: 'Enregistrement…',

  del_title: 'Supprimer le groupe « {name} » ?',
  del_descOptions: {
    one: 'Son unique option sera aussi supprimée définitivement.',
    many: 'Ses {n} d’options seront aussi supprimées définitivement.',
    other: 'Ses {n} options seront aussi supprimées définitivement.',
  },
  del_descNone: 'Cette action est irréversible.',
  lastOff_title: 'Aucune option disponible dans « {group} » ?',
  lastOff_desc: {
    one: 'Le groupe est obligatoire : le produit qui l’utilise ne pourra plus être commandé tant que vous ne marquez pas à nouveau une option disponible.',
    many: 'Le groupe est obligatoire : les {n} de produits qui l’utilisent ne pourront plus être commandés tant que vous ne marquez pas à nouveau une option disponible.',
    other:
      'Le groupe est obligatoire : les {n} produits qui l’utilisent ne pourront plus être commandés tant que vous ne marquez pas à nouveau une option disponible.',
  },

  err_nameRequired: 'Le nom est obligatoire',
  err_optionTr: 'La traduction de l’option « {name} » n’a pas été enregistrée.',
  err_pickSave: 'Impossible d’enregistrer les produits du groupe.',
  hint_groupNotFound: 'Le groupe d’options n’existe plus. Fermez la fenêtre et rechargez la page.',
  hint_productNotFound: 'Un produit coché n’existe plus. Fermez la fenêtre et rechargez la page.',
  hint_duplicateProducts: 'Un produit apparaît deux fois. Fermez la fenêtre et rouvrez-la.',
}

export default fr
