import type { Translation } from '../../core'
import type ro from './ro'

// « Vous », espaces ordinaires avant : ? ! et dans « ». Les langues du menu
// sont en minuscules, comme dans une phrase (« en allemand ») ; en début de
// pastille ou de titre, `menuLangTitle` met la majuscule. „Extra” e
// „supplément” (ca `products`/`orders`).
const fr: Translation<typeof ro> = {
  menuLang_ro: 'roumain',
  menuLang_en: 'anglais',
  menuLang_de: 'allemand',
  menuLang_fr: 'français',
  menuLang_it: 'italien',
  menuLang_hu: 'hongrois',
  menuLang_es: 'espagnol',

  field_name: 'Nom',
  field_description: 'Description',
  field_meta_text: 'Sous-titre',
  fieldIn: '{field} ({lang})',
  fieldAria: '{field} en {lang} pour « {name} »',
  aiMark: '✨ traduit automatiquement — à vérifier',
  toReview: '{n} à vérifier',

  row_saved: '✓ Enregistré',
  row_confirm: 'Confirmer',
  row_fromGroup: 'du groupe « {group} »',

  pt_title: 'Traductions',
  pt_optional: '(facultatif)',
  pt_langsCount: '{done}/{total} langues',
  pt_intro:
    'Le nom et la description dans d’autres langues. L’original ci-dessus ({base}) reste la base — les champs laissés vides affichent automatiquement l’original.',
  pt_auto: '✨ Traduire automatiquement',
  pt_allDone: 'Toutes les langues ont déjà un nom et une description.',
  pt_autoHint: 'Ne remplit que les champs vides ; votre texte reste.',
  pt_reviewed: 'Marquer comme vérifié',
  pt_namePlaceholder: 'Nom du produit',
  pt_descPlaceholder: 'Description du produit',
  pt_noNew: 'Aucune nouvelle traduction reçue. Réessayez.',
  pt_filled: {
    one: '{n} champ rempli — vérifiez-le, puis cliquez sur Enregistrer.',
    many: '{n} de champs remplis — vérifiez-les, puis cliquez sur Enregistrer.',
    other: '{n} champs remplis — vérifiez-les, puis cliquez sur Enregistrer.',
  },
  pt_aiFailed: 'La traduction automatique a échoué. Réessayez.',

  ex_toggle: 'Traductions {done}/{total}',
  ex_hint: 'S’enregistre tout de suite, séparément de « Enregistrer ».',
  ex_save: 'Enregistrer les traductions',
  ex_saved: 'Les traductions du supplément ont été enregistrées.',
  ex_failed: 'Les traductions du supplément n’ont pas été enregistrées.',

  kind_category: 'Catégorie',
  kind_product: 'Produit',
  kind_group: 'Groupe d’options',
  kind_option: 'Option',
  kind_extra: 'Supplément',
  sec_categories: 'Catégories',
  sec_products: 'Produits',
  sec_options: 'Options',
  sec_extras: 'Suppléments',
  tab_onlyBase: 'Le menu n’est proposé qu’en {lang}',
  tab_pickLangsAdmin: 'Choisissez d’autres langues dans Paramètres → Apparence du menu → Langues du menu.',
  tab_pickLangsOwner: 'Le propriétaire choisit les langues du menu dans Paramètres.',
  tab_pickLangs: 'Choisir les langues',
  tab_loadFailed: 'Impossible de charger le menu.',
  tab_noProducts: 'Le menu n’a pas encore de produits visibles par les clients.',
  tab_intro:
    'Le menu est rédigé en {base} (langue de base). Ici, vous complétez et vérifiez les traductions pour les langues proposées aux clients.',
  tab_langGroup: 'Langue de la traduction',
  tab_missing: { one: '{n} manquant', many: '{n} de manquants', other: '{n} manquants' },
  tab_complete: '✓ complet',
  tab_progress: {
    one: '{done} sur {n} texte traduit ({pct} %)',
    many: '{done} sur {n} de textes traduits ({pct} %)',
    other: '{done} sur {n} textes traduits ({pct} %)',
  },
  tab_guestsSee: 'Les clients voient le menu en {lang}',
  tab_guestsDont: 'Les clients ne voient pas encore cette langue : traduisez au moins une catégorie ou un produit',
  tab_aiMissing: '✨ Traduire automatiquement ce qui manque ({n})',
  tab_preview: 'Prévisualiser en {lang}',
  tab_appearsAfter: 'Elle apparaît aux clients après la première traduction d’une catégorie ou d’un produit.',
  tab_flipbook: 'Avec le style Flipbook, le client voit les pages importées, pas les textes.',
  tab_planUnknown:
    'Nous ne savons pas encore si la formule inclut les options et les suppléments, ils ne sont donc pas comptés ici.',
  tab_truncated:
    'Le menu compte au moins {n} produits ou catégories. Cet écran ne voit que les {n} premiers, il ne peut donc pas dire que tout est traduit.',
  tab_completeAll: 'Le menu est entièrement traduit en {lang}.',
  tab_filterGroup: 'Lignes à afficher',
  tab_fMissing: 'Manquants ({n})',
  tab_fReview: 'À vérifier ({n})',
  tab_fAll: 'Tous',
  tab_searchLabel: 'Rechercher dans l’original et dans la traduction',
  tab_searchPlaceholder: 'Rechercher…',
  tab_optLoading: 'Chargement des options et des suppléments…',
  tab_optError: 'Options et suppléments : {error}',
  tab_optLoadFailed: 'Impossible de lire les options et les suppléments.',
  tab_noMatch: 'Aucune ligne ne correspond à la recherche.',
  tab_nothingReview: 'Rien à vérifier en {lang}.',
  tab_nothing: 'Rien à afficher ici.',
  tab_showMore: 'Afficher {n} de plus',
  tab_unsaved: {
    one: 'Vous avez {n} ligne non enregistrée',
    many: 'Vous avez {n} de lignes non enregistrées',
    other: 'Vous avez {n} lignes non enregistrées',
  },
  tab_saveAll: 'Tout enregistrer',
  tab_saveFailed: 'La traduction n’a pas été enregistrée. Réessayez.',
  tab_confirmFailed: 'Impossible de confirmer la traduction. Réessayez.',
  tab_aiTitle: '✨ Traductions automatiques',

  err_notInMenu: 'Cet élément n’est plus dans le menu.',
  err_aiQuota: 'L’assistant IA a reçu trop de demandes ou le quota est épuisé. Réessayez plus tard.',
  err_aiSession: 'Votre session a expiré. Reconnectez-vous.',
  err_aiForbidden: 'Vous n’avez pas le droit d’utiliser l’assistant IA pour ce restaurant.',
  err_aiUnavailable: 'L’assistant IA n’est pas disponible pour ce restaurant en ce moment.',
  err_aiBusy: 'L’assistant IA n’a pas pu répondre. Réessayez dans quelques instants.',
}

export default fr
