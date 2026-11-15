import type { Translation } from '../../core'
import type ro from './ro'

// « Vous », espaces ordinaires avant : ? ! et dans « » ; réservation, table,
// personne (comme `waiter.resv_party`), zone ; « no-show » = « absent »
// (comme `waiter.resv_noShow`) ; « așezat » = « installée ». Les libellés de
// Google sont ceux de son interface française.
const fr: Translation<typeof ro> = {
  count_inRange: {
    one: '{n} réservation sur la période',
    many: '{n} de réservations sur la période',
    other: '{n} réservations sur la période',
  },
  stale_title: {
    one: 'Non confirmées / expirées : {n} réservation passée',
    many: 'Non confirmées / expirées : {n} de réservations passées',
    other: 'Non confirmées / expirées : {n} réservations passées',
  },
  party: { one: '{n} personne', many: '{n} de personnes', other: '{n} personnes' },

  status_pending: 'En attente',
  status_confirmed: 'Confirmée',
  status_seated: 'Installée',
  status_completed: 'Terminée',
  status_cancelled: 'Annulée',
  status_no_show: 'Absent',
  status_expired: 'Expirée',

  stale_aria: 'Réservations non confirmées ou expirées',
  stale_show: 'Afficher',
  stale_hide: 'Masquer',
  stale_desc:
    'Réservations restées sans réponse (expirées automatiquement au bout de 2 heures) et réservations confirmées non clôturées depuis plus de 48 heures — elles ne dépendent pas de la période choisie plus haut.',

  filter_today: 'Aujourd’hui',
  filter_tomorrow: 'Demain',
  filter_week: 'Cette semaine',
  filter_dateAria: 'Choisir un jour précis',
  filter_pendingOnly: 'En attente uniquement',
  refresh: 'Actualiser',

  load_error: 'Impossible de charger les réservations.',
  empty_pendingTitle: 'Aucune réservation en attente',
  empty_pendingDesc: 'Décochez « En attente uniquement » pour voir toutes les réservations de la période',
  empty_title: 'Aucune réservation sur la période choisie',
  empty_desc: 'Changez le filtre de date ou vérifiez les réglages',

  act_confirm: 'Confirmer',
  act_seat: 'Installer à table',
  act_complete: 'Terminer',
  act_noShow: 'Absent',
  act_cancel: 'Annuler',
  confirm_cancelTitle: 'Annuler la réservation ?',
  confirm_noShowTitle: 'Marquer comme absent (no-show) ?',
  confirm_desc: 'Cette action ne peut pas être annulée depuis l’application.',
  confirm_cancelLabel: 'Annuler la réservation',
  confirm_noShowLabel: 'Marquer absent',
  done_confirmed: 'Réservation confirmée',
  done_seated: 'Les clients ont été installés à table',
  done_cancelled: 'Réservation annulée',
  done_noShow: 'Réservation marquée comme absente (no-show)',
  done_completed: 'Réservation terminée',
  err_update: 'La réservation n’a pas pu être mise à jour.',

  noShow_title: {
    one: 'Ce numéro de téléphone compte {n} absence dans l’historique',
    many: 'Ce numéro de téléphone compte {n} d’absences dans l’historique',
    other: 'Ce numéro de téléphone compte {n} absences dans l’historique',
  },
  noShow_badge: { one: '⚠ {n} absence', many: '⚠ {n} d’absences', other: '⚠ {n} absences' },
  zone_requested: 'zone demandée : {zone}',
  special: '« {text} »',

  google_title: 'Votre bouton Google',
  google_copy: 'Copier',
  google_copied: 'Copié ✓',
  google_showSteps: 'Comment l’ajouter sur Google ?',
  google_hideSteps: 'Masquer les étapes',
  google_step1:
    'Rendez-vous sur {site} avec le compte qui gère la fiche de l’établissement (si vous ne l’avez pas encore revendiquée, touchez « Vous êtes le propriétaire de cet établissement ? » sur la fiche Google).',
  google_step2: 'Choisissez la fiche → {edit} → la section {section} → ajoutez le lien ci-dessus.',
  google_step2Edit: 'Modifier le profil',
  google_step2Section: 'Réservations',
  google_step3:
    'Enregistrez — en quelques jours, le bouton de réservation apparaît dans la recherche Google et sur Maps. Détails : {doc}.',

  settings_title: 'Réglages des réservations',
  settings_loadError: 'Impossible de charger les réglages des réservations.',
  settings_saved: 'Réglages enregistrés',
  settings_saveError: 'Les réglages n’ont pas pu être enregistrés.',
  set_open: 'Heure d’ouverture',
  set_close: 'Heure de fermeture',
  set_slot: 'Intervalle des créneaux (min)',
  set_duration: 'Durée de la réservation (min)',
  set_minAdvance: 'Délai minimum de réservation (heures)',
  set_maxAdvance: 'Délai maximum de réservation (jours)',
  set_maxParty: 'Personnes max / réservation',
  set_reminder: 'Rappel (heures avant)',
  set_reminderNone: 'Aucun',
  set_autoConfirm: 'Confirmation automatique',
  set_on: 'Activée',
  set_off: 'Désactivée',
  set_minutes: '{n} min',
  set_hours: '{n} h',
  saving: 'Enregistrement…',
  save_settings: 'Enregistrer les réglages',
}

export default fr
