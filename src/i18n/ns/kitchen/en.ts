import type { Translation } from '../../core'
import type ro from './ro'

const en: Translation<typeof ro> = {
  header_backTitle: 'Back to the admin dashboard',
  header_back: 'Back to dashboard',
  title: 'Kitchen',
  titleWithName: 'Kitchen — {name}',
  selectRestaurant: 'Select the restaurant',
  soldOutAria: 'Sold-out items — mark what has run out',
  soldOut: 'Sold out',
  push_onAria: 'Notifications on — turn off',
  push_blockedAria: 'Notifications are blocked in the browser settings',
  push_enable: 'Turn on notifications for new orders',
  push_onTitle: 'Notifications on — click to turn off',
  push_blockedTitle: 'Notifications are blocked in the browser',
  push_on: 'On',
  push_blocked: 'Blocked',
  push_off: 'Notifications',
  conn_connected: 'Connected',
  conn_connecting: 'Connecting…',
  conn_disconnected: 'Disconnected',

  pushBanner_text: 'Turn on notifications to get alerts for new orders, even with the tab closed.',
  pushBanner_enabling: 'Turning on…',
  pushBanner_enable: 'Turn on →',
  sound_locked: 'The browser has muted the new-order sound until you tap the screen once.',
  sound_unlock: 'Turn on sound',
  list_truncated:
    'Only the {limit} most recent active orders are shown — finish older orders so the list shows everything.',
  sync_error: 'We couldn’t sync the orders. Check your connection and try again.',
  sync_dismiss: 'Dismiss the error message',

  col_new: 'New orders',
  col_preparing: 'Preparing',
  col_ready: 'Ready to serve',
  empty_title: 'No orders',
  empty_newHint: 'QR orders will show up here automatically.',

  src_qr: 'QR',
  src_waiter: 'Waiter',
  next_confirm: 'Confirm',
}

export default en
