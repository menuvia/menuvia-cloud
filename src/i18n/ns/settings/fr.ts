import type { Translation } from '../../core'
import type ro from './ro'

// vous ; client (le convive du restaurant) ; à emporter = ridicare ; « espace »
// pour le panneau du restaurant ; formule = plan (les noms commerciaux restent
// ceux de PLAN_LABELS). Le chemin « Paramètres → Apparence du menu →
// Disposition des produits » est celui de `tables`.
const fr: Translation<typeof ro> = {
  save_busy: 'Enregistrement…',
  unsaved: 'Vous avez des modifications non enregistrées',
  toast_saved: 'Enregistré',
  toast_uploadFailed: 'Échec de l’envoi',
  slug_taken: 'Slug indisponible : « {slug} » est déjà utilisé',
  err_slug: 'Impossible de modifier le slug.',
  err_save: 'Échec de l’enregistrement',

  info_title: 'Informations principales',
  info_name: 'Nom du restaurant *',
  info_namePh: 'La Bella Trattoria',
  info_tagline: 'Slogan',
  info_taglinePh: 'Cuisine authentique',
  info_city: 'Ville',
  info_cityPh: 'Lyon',
  info_phone: 'Téléphone',
  info_phonePh: '+33 x xx xx xx xx',
  info_hours: 'Horaires',
  info_hoursPh: 'Lun–Dim : 12:00–23:00',
  info_description: 'Description',
  info_descriptionPh: 'À propos du restaurant…',

  country_title: 'Pays du restaurant',
  country_descRo:
    'Les paiements dans l’application, le ticket fiscal et le rapport de TVA ne sont disponibles que pour les restaurants en Roumanie.',
  country_desc: 'Le pays où se trouve l’établissement.',
  country_ownerOnly: 'Seul le propriétaire du restaurant peut modifier le pays.',
  tz_title: 'Fuseau horaire',
  tz_desc: 'Les heures d’ouverture, des commandes à emporter et des réservations sont calculées dans ce fuseau.',
  tz_aria: 'Fuseau horaire du restaurant',

  hours_title: 'Horaires détaillés',
  hours_desc: 'Utilisés pour l’indicateur « OUVERT MAINTENANT » et le texte « Aujourd’hui 08:00–23:00 » du menu public.',
  hours_copyMonday: 'Copier lundi → tous',
  hours_open: 'Ouvert',
  hours_opensLabel: 'Ouverture',
  hours_closesLabel: 'Fermeture',
  hours_openAria: '{day} ouverture',
  hours_closeAria: '{day} fermeture',
  hours_confirmTitle: 'Remplacer les horaires du mardi au dimanche par ceux du lundi ?',
  hours_confirmDesc: 'Cette action est irréversible.',
  hours_confirmOk: 'Remplacer',
  day_mon: 'Lundi',
  day_tue: 'Mardi',
  day_wed: 'Mercredi',
  day_thu: 'Jeudi',
  day_fri: 'Vendredi',
  day_sat: 'Samedi',
  day_sun: 'Dimanche',

  logo_title: 'Logo',
  logo_desc: 'Logo carré. Facultatif, utilisé comme avatar / futur favicon.',
  logo_alt: 'Logo',
  logo_upload: 'Importer le logo',
  logo_remove: 'Supprimer le logo',
  uploading: 'Envoi…',
  cover_title: 'Image de couverture',
  cover_desc:
    'Affichée en haut du menu public. Recommandé : format 16:9, largeur >1200 px. ' +
    'Sans image, nous utilisons un dégradé généré à partir de votre thème.',
  cover_alt: 'Couverture',
  cover_none: 'Pas d’image — dégradé du thème actif',
  cover_upload: 'Importer une image',

  amen_title: 'Équipements',
  amen_desc: 'Affichés sous forme de pastilles en haut du menu public.',
  amenity_wifi: 'WiFi',
  amenity_vegan_options: 'Options végétaliennes',
  amenity_outdoor_seating: 'Terrasse',
  amenity_parking: 'Parking',
  amenity_cards: 'Carte bancaire',
  amenity_reservations: 'Réservations',
  amenity_pet_friendly: 'Animaux acceptés',

  wifi_title: 'Mot de passe WiFi (facultatif)',
  wifi_desc: 'Affiché en clair dans le menu. Laissez vide si vous ne voulez pas le publier.',
  wifi_label: 'Mot de passe WiFi',
  wifi_ph: 'ex. : tinctura2024',
  social_title: 'Réseaux sociaux',
  social_website: 'Site web',
  google_title: 'Avis Google (avis automatiques)',
  google_descPay:
    'Une fois que le client a payé et répondu aux questions de feedback, nous lui affichons un bouton ' +
    '« Écrire un avis sur Google » qui le mène directement à votre fiche d’établissement. Le bouton ' +
    'apparaît pour tous les clients, quelle que soit leur note — Google ne permet pas de montrer le ' +
    'lien uniquement aux clients satisfaits.',
  google_desc:
    'Une fois que le client a répondu aux questions de feedback, nous lui affichons un bouton « Écrire ' +
    'un avis sur Google » qui le mène directement à votre fiche d’établissement. Le bouton apparaît ' +
    'pour tous les clients, quelle que soit leur note — Google ne permet pas de montrer le lien ' +
    'uniquement aux clients satisfaits.',
  google_placeId: 'Google Place ID',
  google_help:
    'Trouvez votre Place ID ici : {link}. Cherchez le nom de votre établissement et copiez l’ID (il commence par « ChIJ… »).',
  google_finder: 'Place ID Finder',
  google_configured: 'Configuré',
  google_preview: 'Aperçu de l’URL : {link}',

  preview_title: 'Aperçu',
  preview_desc: 'Voici le menu tel que le voient vos clients — il se met à jour au fil de vos modifications.',
  url_title: 'URL du menu',
  url_slugLabel: 'Adresse du menu (slug)',
  url_slugPh: 'slug-url',
  accent_title: 'Couleur d’accent',
  accent_aria: 'Couleur d’accent {name}',
  accent_C8963C: 'Or',
  accent_E05555: 'Rouge',
  accent_4CAF6E: 'Vert',
  accent_5B8DEF: 'Bleu',
  accent_9B72CF: 'Violet',
  accent_E07B45: 'Orange',
  accent_3ABFBF: 'Turquoise',
  theme_title: 'Thème du menu QR',
  theme_desc: 'Choisissez le style visuel de votre menu. Il s’applique immédiatement à la page que voient vos clients.',
  theme_bg: 'Arrière-plan',
  theme_accent: 'Accent',
  theme_surface: 'Surface',
  theme_note: 'Après l’enregistrement, les clients verront le nouveau thème au prochain chargement du menu.',
  theme_cafe_name: 'Corail éditorial',
  theme_cafe_desc: 'Crème chaude + corail. Éditorial, accueillant, typographie serif italique.',
  theme_pizzeria_name: 'Pizzeria italienne',
  theme_pizzeria_desc: 'Rouge + blanc + vert. Joyeux, énergique, polices à l’italienne.',
  'theme_fine-dining_name': 'Gastronomique',
  'theme_fine-dining_desc': 'Noir + or élégant. Raffiné, minimaliste, serif classique.',
  theme_pub_name: 'Pub & Bar',
  theme_pub_desc: 'Vert foncé + ambre. Robuste, masculin, polices industrielles.',
  theme_mexican_name: 'Mexicain / Fast-food',
  theme_mexican_desc: 'Couleurs vives — rouge + jaune. Joyeux, énergique, accrocheur.',
  theme_asian_name: 'Asiatique & sushi',
  theme_asian_desc: 'Blanc minimaliste + rouge japonais. Net, ordonné, intemporel.',
  theme_healthy_name: 'Healthy & végan',
  theme_healthy_desc: 'Vert + crème naturel. Net, frais, polices arrondies.',
  theme_mediterranean_name: 'Méditerranéen',
  theme_mediterranean_desc: 'Bleu + blanc de Santorin. Aéré, lumineux, vacances.',
  layout_title: 'Disposition des produits',
  layout_desc:
    'La façon dont les produits sont disposés sur la page que voient vos clients. S’applique au menu digital et au menu QR.',
  layout_list: 'Liste',
  layout_listDesc: 'Petite photo + texte. Classique et compact.',
  layout_grid: 'Galerie photo',
  layout_gridDesc: 'Grandes photos, 2 colonnes. Le plus visuel.',
  layout_minimal: 'Minimal élégant',
  layout_minimalDesc: 'Texte, sans photos. Ambiance éditoriale, classique et rapide.',
  layout_photo: 'Photo d’abord',
  layout_photoDesc: 'Grandes photos avec le nom et le prix sur la photo. Touchez la photo pour les détails et les options.',
  layout_flipbook: 'Flipbook (PDF/pages)',
  layout_flipbookDesc: 'Les pages du menu en images, à feuilleter comme un livre.',
  fb_pagesTitle: 'Pages du menu ({n}/{max})',
  fb_help:
    'Votre menu est en PDF ? Exportez les pages en images (ou prenez-les en photo) et importez-les ' +
    'ici — ou utilisez l’import IA dans Produits pour le transformer en menu interactif.',
  fb_pageAlt: 'Page {n}',
  fb_moveUp: 'Monter la page {n}',
  fb_moveDown: 'Descendre la page {n}',
  fb_remove: 'Supprimer la page {n}',
  fb_empty: 'Aucune page pour l’instant. Tant que vous n’importez pas de pages, les clients voient le menu avec le style « Liste ».',
  fb_upload: 'Importer des pages (sélection multiple possible)',
  fb_orderNote:
    'Avec Flipbook, les clients voient le menu comme un livre — la commande depuis le menu n’est pas ' +
    'disponible avec ce style ; l’appel du serveur reste possible.',
  fb_full: '{max} pages maximum — supprimez-en une pour en ajouter une autre',
  fb_partial: {
    one: '{max} pages maximum — seule la première est importée',
    many: '{max} pages maximum — seules les {n} premières sont importées',
    other: '{max} pages maximum — seules les {n} premières sont importées',
  },
  fb_added: {
    one: '{n} page ajoutée — n’oubliez pas d’enregistrer',
    many: '{n} de pages ajoutées — n’oubliez pas d’enregistrer',
    other: '{n} pages ajoutées — n’oubliez pas d’enregistrer',
  },
  el_title: 'Éléments du menu',
  el_desc: 'Choisissez ce que les clients voient sur le menu. Tout est activé par défaut.',
  el_cover: 'Couverture',
  el_coverDesc: 'L’image de couverture en haut. Désactivée, un dégradé s’affiche.',
  el_tagline: 'Slogan',
  el_taglineDesc: 'Le slogan du restaurant, affiché sous le nom.',
  el_status: 'Statut ouvert / fermé',
  el_statusDesc: 'La pastille qui indique si le restaurant est ouvert en ce moment.',
  el_amenities: 'WiFi & végan',
  el_amenitiesDesc: 'Pastilles pour le WiFi et les options végétaliennes.',
  el_social: 'Réseaux sociaux',
  el_socialDesc: 'Pastilles avec les liens Instagram, TikTok, Facebook et site web.',
  branding_title: 'Badge « Créé avec Menuvia »',
  branding_desc: 'Le lien discret en bas du menu public. Votre formule vous permet de le masquer.',
  branding_toggle: 'Afficher le badge « Créé avec Menuvia »',
  langs_title: 'Langues du menu',
  langs_desc: 'La langue dans laquelle le menu est rédigé et les langues supplémentaires dans lesquelles les clients peuvent le consulter.',
  langs_base: 'Langue d’origine du menu',
  langs_baseHelp:
    'La langue dans laquelle vous avez rédigé les noms et les descriptions des produits. Les traductions s’ajoutent pour les autres langues.',
  cur_title: 'Devise du menu',
  cur_descPay:
    'La devise dans laquelle les prix s’affichent sur le menu public et le menu QR. L’abonnement Menuvia et la fiscalisation ne sont pas concernés.',
  cur_desc: 'La devise dans laquelle les prix s’affichent sur le menu public et le menu QR. L’abonnement Menuvia n’est pas concerné.',
  cur_ron: 'RON (lei)',

  mod_title: 'Modules optionnels',
  mod_desc:
    'Activez uniquement ce dont vous avez besoin. Les modules désactivés sont bloqués par le système — ni ' +
    'les clients ni l’équipe ne peuvent y créer de données.',
  mod_resv: 'Réservations',
  mod_resvDesc:
    'Permet aux clients de réserver des tables depuis le menu public. Vous les confirmez et les gérez depuis l’espace, dans Réservations.',
  mod_resvOn: 'Module Réservations activé',
  mod_resvOff: 'Module Réservations désactivé',
  pickup_title: 'Commandes à emporter (click-and-collect)',
  pickup_toggle: 'Commandes à emporter',
  pickupOnly_title: 'Mode « à emporter uniquement » (sans tables)',
  pickup_lead: 'Préparation minimum (min)',
  pickup_leadAria: 'Préparation minimum (minutes)',
  pickup_slot: 'Intervalle des créneaux (min)',
  pickup_slotAria: 'Intervalle des créneaux (minutes)',
  pickup_open: 'Ouverture',
  pickup_openAria: 'Ouverture des commandes à emporter',
  pickup_close: 'Fermeture',
  pickup_closeAria: 'Fermeture des commandes à emporter',
  pickup_instr: 'Instructions pour les clients (facultatif)',
  pickup_instrPh: 'Ex. : Appelez à votre arrivée, entrée sur le côté',
  pickup_kitchenNote:
    'Les commandes à emporter apparaissent sur l’écran Cuisine avec le badge {badge}. Le nom du client et l’heure de retrait sont visibles.',
  pickup_badge: '📦 À emporter',
  pk_lead: 'Commandes à emporter au restaurant, depuis votre page publique',
  pk_flipbookTail: '. Attention : {why}',
  pk_flipbookNoOrders:
    'avec le style Flipbook, la page publique affiche le menu comme un livre, sans panier, donc les ' +
    'clients ne peuvent pas commander à emporter. Pour recevoir des commandes, choisissez un autre ' +
    'style dans Paramètres → Apparence du menu → Disposition des produits.',
  pk_activeLead: 'Avec la vente à emporter activée, les clients peuvent commander depuis votre page publique',
  pk_activeTail: ' sans scanner de QR et récupérer directement au restaurant. Paiement en espèces au retrait.',
  pk_plainTail: '.',
  po_suspended:
    'Avec votre formule, ce mode ne s’applique pas : sans commandes à emporter, l’espace affiche vos tables et vos réservations.',
  po_desc:
    'Pour un food truck / comptoir : masque le Plan de salle et les Réservations de l’espace. ' +
    'Le QR général de Tables & codes QR devient votre QR principal.',
  sugg_title: 'Suggestions au panier',
  sugg_desc:
    'Suggère automatiquement des produits des catégories absentes du panier (ex. : un client a pris un plat principal mais pas de dessert).',
  sugg_msgLabel: 'Message affiché',
  sugg_msgAria: 'Message affiché avec les suggestions',
  sugg_msgPh: '🍰 Avant d’envoyer… vous désirez autre chose ?',
  vat_title: 'Taux de TVA',
  vat_desc:
    'Les 4 groupes de TVA utilisés dans votre restaurant. Modifiez le pourcentage quand l’État change les taux — ' +
    'les produits conservent automatiquement leur groupe.',

  plan_title: 'Formule actuelle',
  plan_failed: 'Impossible de vérifier la formule',
  plan_checking: 'Vérification…',
  signOut: 'Se déconnecter',
}

export default fr
