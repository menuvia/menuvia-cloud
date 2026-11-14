import type { Translation } from '../../core'
import type ro from './ro'

const en: Translation<typeof ro> = {
  save: 'Save',
  cancel: 'Cancel',
  close: 'Close',
  retry: 'Try again',
  delete: 'Delete',
  edit: 'Edit',
  back: 'Back',
  loading: 'Loading…',
  autoSaveHint: '· saved automatically',
  err_generic: 'The action could not be completed. Please try again.',
  err_network: 'No connection. Check your internet and try again.',
  err_permission: 'You don’t have permission for this action.',
  err_not_found: 'This item no longer exists or you don’t have access to it.',
  err_duplicate: 'An item with these details already exists.',
  err_forbidden: 'This action isn’t allowed for your role.',
  elapsed_s: '{n}s',
  elapsed_m: '{n}m',
  elapsed_hm: '{h}h {m}m',
  signOut: 'Sign out',
  signOut_busy: 'Signing out…',
  signOut_confirmTitle: 'Sign out?',
  signOut_confirmDesc: 'You’ll need to sign in again on this device.',
  signOut_failed: 'Couldn’t sign out. Please try again.',
  lang_title: 'Interface language',
  lang_saving: 'Saving…',
  lang_saveFailed: 'The language couldn’t be saved. Please try again.',
  lang_columnMissing:
    'The language can’t be saved to your account yet: the server hasn’t received the latest update. The dashboard stays in its current language.',
  lang_columnMissingShort: 'The language can’t be saved yet: the server hasn’t received the latest update.',
  lang_name_ro: 'Română',
  lang_name_en: 'English',
  lang_name_fr: 'Français',
  lang_name_de: 'Deutsch',
  items_count: { one: '{n} item', other: '{n} items' },
}

export default en
