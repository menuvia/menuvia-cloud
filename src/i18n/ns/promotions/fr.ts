import type { Translation } from '../../core'
import type ro from './ro'

// « Vous », espaces ordinaires avant : ? ! et dans « » ; „reducere” e
// „remise” (comme `payments`), „ospătar” e „serveur”.
const fr: Translation<typeof ro> = {
  loading: 'Chargement des règles…',
  intro_payAtTable:
    'Règles automatiques de remise par plage horaire et par jour de la semaine. Le serveur verra un bouton « Appliquer la promotion » au paiement si une règle est active.',
  intro_auto:
    'Règles automatiques de remise par plage horaire et par jour de la semaine. La remise s’applique d’elle-même aux commandes du menu QR et à celles à emporter, tant que la règle est active.',
  newRule: 'Nouvelle règle',
  closeError: 'Fermer l’erreur',
  activeNow: { one: 'ACTIVE MAINTENANT', many: 'ACTIVES MAINTENANT ({n})', other: 'ACTIVES MAINTENANT ({n})' },
  value_pct: '{value} %',
  value_amount: '{value} lei',
  empty_title: 'Aucune règle pour l’instant',
  empty_payAtTable:
    'Créez une première règle (ex. : « Happy Hour 17 h–19 h, −20 % sur tout ») et le système proposera automatiquement la remise au paiement pendant cette plage.',
  empty_auto:
    'Créez une première règle (ex. : « Happy Hour 17 h–19 h, −20 % sur tout ») et la remise s’appliquera d’elle-même aux commandes du menu pendant cette plage.',
  firstRule: 'Première règle',

  days_all: 'Tous les jours',
  scope_all: 'Sur tout',
  status_active: 'ACTIVE',
  status_off: 'DÉSACTIVÉE',
  card_offPct: '−{value} %',
  card_offAmount: '−{value} lei',
  card_cap: '(max {amount} lei)',
  stop: 'Désactiver',
  start: 'Activer',
  deleteAria: 'Supprimer la règle {name}',

  day_1: 'Di',
  day_2: 'Lu',
  day_3: 'Ma',
  day_4: 'Me',
  day_5: 'Je',
  day_6: 'Ve',
  day_7: 'Sa',

  edit_title: 'Modifier la règle',
  field_name: 'Nom *',
  field_namePh: 'ex. : Happy Hour 17 h–19 h',
  field_from: 'De',
  field_to: 'À',
  field_days: 'Jours de la semaine (vide = tous)',
  days_reset: 'Réinitialiser',
  field_scope: 'S’applique à',
  scope_category: 'Catégorie',
  scope_product: 'Produit',
  pick_category: '— Choisir une catégorie —',
  pick_product: '— Choisir un produit —',
  field_discount: 'Remise',
  type_pct: 'Pourcentage (%)',
  type_amount: 'Montant fixe (lei)',
  field_value: 'Valeur',
  field_valueAria: 'Valeur de la remise',
  field_cap: 'Plafond maximal (lei, facultatif)',
  field_capPh: 'Max lei (facultatif)',
  field_capAria: 'Plafond maximal en lei, facultatif',
  field_active: 'Règle active immédiatement',
  saveChanges: 'Enregistrer les modifications',
  create: 'Créer la règle',
  err_name: 'Le nom est obligatoire',
  err_value: 'La valeur de la remise doit être positive',
  err_pctMax: 'Le pourcentage ne peut pas dépasser 100',
  err_category: 'Choisissez une catégorie',
  err_product: 'Choisissez un produit',
  err_save: 'Erreur lors de l’enregistrement',

  del_title: 'Supprimer la règle ?',
  del_question: 'Voulez-vous supprimer {name} ? Cette action est irréversible.',
}

export default fr
