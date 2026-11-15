import type { Translation } from '../../core'
import type ro from './ro'

// reservation = reservation; table = table; „persoană” = guest (as
// `waiter.resv_party`); zone = area; „așezat” = seated. Google’s own labels
// are the ones of its English interface.
const en: Translation<typeof ro> = {
  count_inRange: { one: '{n} reservation in this period', other: '{n} reservations in this period' },
  stale_title: {
    one: 'Unconfirmed / expired: {n} past reservation',
    other: 'Unconfirmed / expired: {n} past reservations',
  },
  party: { one: '{n} guest', other: '{n} guests' },

  status_pending: 'Pending',
  status_confirmed: 'Confirmed',
  status_seated: 'Seated',
  status_completed: 'Completed',
  status_cancelled: 'Cancelled',
  status_no_show: 'No-show',
  status_expired: 'Expired',

  stale_aria: 'Unconfirmed or expired reservations',
  stale_show: 'Show',
  stale_hide: 'Hide',
  stale_desc:
    'Reservations left unanswered (expired automatically after 2 hours) and confirmed ones not closed for more than 48 hours — they don’t depend on the period chosen above.',

  filter_today: 'Today',
  filter_tomorrow: 'Tomorrow',
  filter_week: 'This week',
  filter_dateAria: 'Pick a specific day',
  filter_pendingOnly: 'Pending only',
  refresh: 'Refresh',

  load_error: 'We couldn’t load the reservations.',
  empty_pendingTitle: 'No pending reservations',
  empty_pendingDesc: 'Untick “Pending only” to see all the reservations in this period',
  empty_title: 'No reservations in the chosen period',
  empty_desc: 'Change the date filter or check the settings',

  act_confirm: 'Confirm',
  act_seat: 'Seat at a table',
  act_complete: 'Complete',
  act_noShow: 'No-show',
  act_cancel: 'Cancel',
  confirm_cancelTitle: 'Cancel the reservation?',
  confirm_noShowTitle: 'Mark as a no-show?',
  confirm_desc: 'This can’t be undone from the app.',
  confirm_cancelLabel: 'Cancel the reservation',
  confirm_noShowLabel: 'Mark as no-show',
  done_confirmed: 'Reservation confirmed',
  done_seated: 'The guests have been seated',
  done_cancelled: 'Reservation cancelled',
  done_noShow: 'Reservation marked as a no-show',
  done_completed: 'Reservation completed',
  err_update: 'The reservation couldn’t be updated.',

  noShow_title: {
    one: 'This phone number has {n} no-show on record',
    other: 'This phone number has {n} no-shows on record',
  },
  noShow_badge: { one: '⚠ {n} no-show', other: '⚠ {n} no-shows' },
  zone_requested: 'requested area: {zone}',
  special: '“{text}”',

  google_title: 'Your Google button',
  google_copy: 'Copy',
  google_copied: 'Copied ✓',
  google_showSteps: 'How do I add it to Google?',
  google_hideSteps: 'Hide the steps',
  google_step1:
    'Go to {site} with the account that manages the venue’s profile (if you haven’t claimed it yet, tap “Own this business?” on its Google listing).',
  google_step2: 'Choose the profile → {edit} → the {section} section → add the link above.',
  google_step2Edit: 'Edit profile',
  google_step2Section: 'Reservations',
  google_step3: 'Save — within a few days, the booking button shows up on Google Search and Maps. Details: {doc}.',

  settings_title: 'Reservation settings',
  settings_loadError: 'We couldn’t load the reservation settings.',
  settings_saved: 'Settings saved',
  settings_saveError: 'The settings couldn’t be saved.',
  set_open: 'Opening time',
  set_close: 'Closing time',
  set_slot: 'Slot interval (min)',
  set_duration: 'Reservation length (min)',
  set_minAdvance: 'Book at least (hours ahead)',
  set_maxAdvance: 'Book at most (days ahead)',
  set_maxParty: 'Max guests / reservation',
  set_reminder: 'Reminder (hours before)',
  set_reminderNone: 'None',
  set_autoConfirm: 'Automatic confirmation',
  set_on: 'On',
  set_off: 'Off',
  set_minutes: '{n} min',
  set_hours: '{n}h',
  saving: 'Saving…',
  save_settings: 'Save settings',
}

export default en
