import type { Translation } from '../../core'
import type ro from './ro'

const fr: Translation<typeof ro> = {
  loading_printer: 'Chargement de l’imprimante…',
  intro_kitchen:
    'Les nouvelles commandes s’impriment automatiquement en cuisine, sur une imprimante thermique, via Menuvia Bridge.',
  register_device: 'Enregistrer un appareil',
  err_dismiss: 'Fermer le message d’erreur',
  err_load: 'Impossible de charger les appareils',
  err_register: 'Impossible d’enregistrer l’appareil',
  err_delete: 'Impossible de supprimer l’appareil',
  err_save: 'Impossible d’enregistrer',
  err_ticketRetry: 'Impossible de renvoyer le ticket',
  err_ticketCancel: 'Impossible d’annuler le ticket',

  devices_title: 'Appareils',
  empty_title: 'Vous n’avez encore enregistré aucun appareil.',
  empty_desc:
    'Enregistrez un appareil pour obtenir la clé d’installation de Menuvia Bridge (le PC relié à l’imprimante de la cuisine).',
  empty_step1: 'Enregistrez l’appareil ici : vous obtenez la clé et le fichier config.json.',
  empty_step2:
    'Téléchargez et installez Menuvia Bridge, avec config.json à côté du programme d’installation, dans un dossier nouveau et vide.',
  empty_step3:
    'Le programme d’installation démarre le Bridge à la fin ; vérifiez ensuite ici que l’appareil affiche toujours « ● En ligne » après 3 minutes.',
  last_seen: 'Dernier signal : {when}',
  rel_never: 'jamais',
  rel_now: 'à l’instant',
  rel_min: 'il y a {n} min',
  rel_hours: 'il y a {n} h',
  rel_days: { one: 'il y a {n} jour', many: 'il y a {n} jours', other: 'il y a {n} jours' },
  status_online: '● En ligne',
  status_offline: '○ Hors ligne',
  status_onlineHint: 'A donné signe de vie au cours des 3 dernières minutes',
  status_offlineHint:
    'Aucun signe de vie depuis plus de 3 minutes — vérifiez le PC et le programme Menuvia Bridge',
  kitchen_toggle: 'Tickets cuisine',
  delete_title: 'Supprimer cet appareil ?',
  delete_descKitchen: 'Le Bridge installé ne pourra plus imprimer les tickets de cuisine.',
  delete_confirm: 'Supprimer l’appareil',

  col_created: 'Créé',
  col_order: 'Commande',
  col_status: 'Statut',
  col_details: 'Détails',
  col_actions: 'Actions',
  st_pending: 'En attente',
  st_sentPrinter: 'Envoyé à l’imprimante',
  st_success: '✓ Imprimé',
  st_error: '✗ Erreur',
  st_cancelled: 'Annulé',
  retries: { one: '{n} tentative', many: '{n} tentatives', other: '{n} tentatives' },

  tickets_title: 'Tickets cuisine',
  tickets_desc:
    'Les nouvelles commandes s’impriment automatiquement sur l’imprimante thermique de la cuisine, via les appareils où « Tickets cuisine » est activé.',
  tickets_empty:
    'Aucun ticket pour l’instant. Activez « Tickets cuisine » sur un appareil ci-dessus : les nouvelles commandes apparaîtront ici.',
  reprint: 'Réimpression',
  ticketCancel_title: 'Annuler ce ticket ?',
  ticketCancel_desc: 'Il ne sera plus imprimé en cuisine.',
  ticketCancel_confirm: 'Annuler le ticket',

  reg_titleDevice: 'Enregistrer un appareil Bridge',
  reg_name: 'Nom *',
  reg_namePh: 'ex. : PC cuisine',
  reg_defaultName: 'PC cuisine',
  reg_infoKitchen:
    'Après l’enregistrement, vous recevrez une clé d’installation unique. Vous l’utilisez une seule fois, en installant le Bridge sur le PC relié à l’imprimante de la cuisine. La clé ne peut être récupérée plus tard qu’en enregistrant de nouveau l’appareil.',
  reg_submit: 'Enregistrer',
  reg_busy: 'Enregistrement…',

  key_titleDevice: 'Appareil enregistré',
  key_intro: 'Installez le Bridge en 3 étapes :',
  step1_title: 'Téléchargez Menuvia Bridge',
  step1_descKitchen: 'Le programme d’installation pour Windows, sur le PC relié à l’imprimante de la cuisine.',
  step1_download: 'Télécharger le programme d’installation',
  step1_missing:
    'Le lien de téléchargement n’est pas encore publié — demandez le programme d’installation à l’équipe Menuvia.',
  step2_title: 'Téléchargez config.json',
  step2_desc:
    'Placez-le à côté du programme d’installation, dans un dossier nouveau et vide, avant de le lancer : il contient l’adresse du serveur et la clé de l’appareil, la configuration les reprend donc toute seule. Supprimez les copies plus anciennes de config.json (le navigateur nomme la nouvelle « config (1).json »).',
  step2_tail:
    'Pendant la configuration, la clé n’apparaît que par sa fin, qui doit être {tail}. Si vous voyez une autre fin (par exemple, le Bridge était déjà installé et le programme d’installation garde la configuration existante), collez la clé ci-dessous à « Device secret ».',
  step2_kitchenNote: 'La configuration ne vous demandera plus que l’adresse IP de l’imprimante thermique.',
  step2_download: 'Télécharger config.json',
  step2_private: 'Le fichier contient la clé : gardez-le uniquement sur le PC du Bridge.',
  step3_title: 'Démarrez le Bridge et vérifiez',
  step3_descKitchen:
    'Le programme d’installation démarre le Bridge à la fin (sinon : menu Démarrer → Menuvia Bridge → « Pornește bridge-ul », ou redémarrez le PC). « Verificare conexiune (check) », dans le même menu, indique s’il joint le serveur Menuvia et l’imprimante. La preuve qu’il tourne : l’appareil affiche toujours « ● En ligne » ici après 3 minutes — la vérification seule ne l’allume que quelques minutes.',
  key_label: 'Clé d’installation du Bridge :',
  key_copy: 'Copier la clé',
  key_copied: 'Copiée ✓',
  key_copyFailed: 'Impossible de copier automatiquement — sélectionnez la clé ci-dessus et copiez-la à la main.',
  key_warning:
    'Enregistrez la clé maintenant (ou téléchargez config.json). Une fois cette fenêtre fermée, elle ne peut plus être récupérée. Si vous la perdez, supprimez l’appareil et enregistrez-en un nouveau.',
  key_done: 'J’ai enregistré la clé',
}

export default fr
