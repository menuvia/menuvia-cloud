import type { Translation } from '../../core'
import type ro from './ro'

// masă = table ; zone = zone ; client = client ; « panou » = « espace » et
// « plan » = « formule » (comme `dashboard`/`home`) ; à emporter = ridicare.
const fr: Translation<typeof ro> = {
  saving: 'Enregistrement…',

  qr_genFailed: 'Le code QR n’a pas pu être généré',
  qr_alt: 'Code QR pour {label}',
  qr_altPlain: 'Code QR',

  addTable: 'Ajouter une table',
  editTable: 'Modifier la table',
  modal_name: 'Nom de la table *',
  modal_namePlaceholder: 'Table 1, Terrasse A…',
  modal_slug: 'Slug d’URL',
  modal_slugPlaceholder: 'table-1',
  modal_slugHint: 'Identifiant interne de la table — n’affecte pas les codes QR déjà imprimés',
  modal_seats: 'Places (facultatif)',
  modal_zone: 'Zone (facultatif)',
  modal_zonePlaceholder: 'Terrasse, Intérieur, Bar…',
  modal_zoneHint:
    'Les clients peuvent choisir la zone (ex. terrasse ou intérieur) lorsqu’ils réservent en ligne',
  modal_err_nameRequired: 'Le nom est obligatoire.',
  modal_err_duplicate: 'Une table avec cet identifiant existe déjà. Choisissez un autre nom ou slug.',
  modal_err_save: 'La table n’a pas pu être enregistrée. Vérifiez les données et réessayez.',

  general_title: 'QR général du menu',
  general_leadsTo: 'Ouvre {path} — {text}',
  general_png: 'PNG',
  copyLink: 'Copier le lien',
  linkCopied: 'Lien copié',
  general_copyFailed: 'Nous n’avons pas pu copier le lien',

  pk_flipbookNoOrders:
    'avec le style Flipbook, la page publique affiche le menu comme un livre, sans panier, donc les ' +
    'clients ne peuvent pas commander à emporter. Pour recevoir des commandes, choisissez un autre ' +
    'style dans Paramètres → Apparence du menu → Disposition des produits.',
  gm_tail: 'Idéal pour la vitrine, les flyers ou le comptoir.',
  gm_flipbook: 'les clients voient le menu ; {why} {tail}',
  gm_withPickup:
    'les clients voient le menu ; avec les commandes à emporter actives, ils peuvent aussi commander. {tail}',
  gm_plain: 'les clients voient le menu. {tail}',
  po_tail: 'Vous pouvez ajouter des tables à tout moment, si la situation change.',
  po_suspended:
    'Mode « à emporter uniquement » suspendu : votre formule n’inclut pas les commandes à emporter, ' +
    'donc votre espace affiche vos tables et vos réservations. Avec le QR général ci-dessus, les ' +
    'clients voient le menu, sans commande à emporter. Le réglage reste enregistré et revient ' +
    'lorsque vous passez à la formule {plan}.',
  po_head: 'Mode « à emporter uniquement » actif — vous n’avez pas besoin de tables.',
  po_flipbook: '{head} Imprimez le QR général ci-dessus. Attention : {why} {tail}',
  po_withPickup:
    '{head} Imprimez le QR général ci-dessus ; les clients commandent et récupèrent au comptoir. {tail}',
  po_plain: '{head} Imprimez le QR général ci-dessus. {tail}',

  summary: '{active} actives · {total} au total',
  pdf_title: 'Télécharger les codes QR au format PDF pour l’impression',
  pdf_button: 'Télécharger les QR',
  pdf_downloading: 'Téléchargement…',
  pdf_menuAria: 'Formats de téléchargement des QR',
  pdf_grid: 'Grille — 6 / page',
  pdf_gridHint: 'À coller sur les tables',
  pdf_tent: 'Cartes pliables',
  pdf_tentHint: '4 / page, type chevalet',
  pdf_poster: 'Affiche A4',
  pdf_posterHint: '1 grand QR / page',
  pdf_noActive: 'Aucune table active avec un QR',
  pdf_done: 'PDF téléchargé',
  pdf_failed: 'Le PDF n’a pas pu être généré. Réessayez.',
  pdf_noCards: 'Aucun QR à imprimer',

  domain_previewTitle:
    'Détail technique : VITE_APP_URL n’est pas défini — l’URL de prévisualisation est utilisée.',
  domain_mismatchTitle: 'Détail technique : le domaine actuel diffère de VITE_APP_URL.',
  domain_preview:
    'Attention : les codes QR générés maintenant contiendront une adresse de test temporaire, et non l’adresse définitive du menu. Ne les imprimez pas encore — contactez le support si vous avez besoin d’aide.',
  domain_mismatch:
    'Vous êtes sur une autre adresse que celle configurée pour le menu. Les codes QR générés utiliseront l’adresse configurée, et non l’adresse actuelle.',

  bulk_titleEmpty: 'Vous n’avez pas encore de tables configurées',
  bulk_title: 'Générez les codes QR de vos tables',
  bulk_descEmpty: 'Indiquez le nombre de tables, et Menuvia génère automatiquement les codes QR.',
  bulk_desc:
    'Dites-nous combien de tables vous avez, et Menuvia crée automatiquement un code QR pour chaque table.',
  bulk_placeholder: 'Combien de tables ? ex. 80',
  bulk_aria: 'Nombre de tables',
  bulk_busy: 'Génération…',
  bulk_btnEmpty: 'Générer les tables et les QR',
  bulk_btn: 'Générer les QR',
  bulk_footer: 'Vous pourrez modifier, désactiver ou régénérer n’importe quel QR plus tard.',
  bulk_countRequired: 'Indiquez le nombre de tables (ex. 80)',
  bulk_alreadyHave: {
    one: 'Vous avez déjà {n} table configurée',
    many: 'Vous avez déjà {n} de tables configurées',
    other: 'Vous avez déjà {n} tables configurées',
  },
  bulk_limit:
    'Votre formule permet jusqu’à {max} tables / QR. Pour davantage, vous pouvez passer à une formule supérieure.',
  bulk_created: {
    one: '{n} table créée, avec son propre QR',
    many: '{n} de tables créées, chacune avec son QR',
    other: '{n} tables créées, chacune avec son QR',
  },
  bulk_duplicate: 'Certaines tables existent déjà — actualisez la liste et réessayez.',
  bulk_failed: 'Les tables n’ont pas pu être générées. Réessayez.',

  load_error: 'Nous n’avons pas pu charger les tables',
  search_placeholder: 'Rechercher par nom…',
  search_aria: 'Rechercher une table par nom',
  zone_filterAria: 'Filtrer par zone',
  zone_all: 'Toutes les zones',
  noZone: 'Sans zone',
  noMatches: 'Aucune table ne correspond aux filtres.',
  seats: { one: '{n} place', many: '{n} de places', other: '{n} places' },
  inactive: 'Inactive',
  status_noQr: 'Pas de QR — appuyez sur « Générer le QR »',
  status_active: 'QR actif',
  status_disabled: 'QR désactivé',
  action_png: 'Télécharger le QR (PNG)',
  action_regenerate: 'Régénérer le QR',
  action_generate: 'Générer le QR',
  action_deactivate: 'Désactiver',
  action_activate: 'Activer',
  action_deactivateAria: 'Désactiver la table',
  action_activateAria: 'Activer la table',
  action_delete: 'Supprimer la table',

  toast_verifyFailed:
    'Nous n’avons pas pu vérifier les QR existants. Ceux déjà imprimés restent valables — réessayez.',
  toast_tokensFailed: 'Erreur lors de la génération des QR',
  toast_added: 'Table ajoutée',
  toast_updated: 'Table mise à jour',
  toast_saveFailed: 'Erreur lors de l’enregistrement',
  toast_deleteFailed: 'Erreur lors de la suppression',
  toast_deleted: 'Table supprimée',
  toast_deactivated: 'Table désactivée',
  toast_activated: 'Table activée',
  toast_updateFailed: 'Erreur lors de la mise à jour',
  toast_rotated: 'Nouveau QR généré',
  toast_rotateFailed: 'Erreur lors de la génération du QR',
  toast_pngDownloaded: 'QR téléchargé pour {name}',
  toast_downloadFailed: 'Erreur lors du téléchargement',
  toast_copyFailed: 'Le lien n’a pas pu être copié',

  rotate_aria: 'Régénérer le QR de {name}',
  rotate_title: 'Régénérer le QR — {name}',
  rotate_desc: 'L’ancien QR ne fonctionnera plus. Voulez-vous en générer un nouveau pour cette table ?',
  rotate_confirm: 'Régénérer',
  delete_desc: 'Tous les codes QR associés seront supprimés. Les commandes existantes ne sont pas affectées.',
}

export default fr
