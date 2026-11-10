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
  items_count: { one: '{n} item', other: '{n} items' },
}

export default en
