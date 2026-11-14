import type { Translation } from '../../core'
import type ro from './ro'

// „reducere” = „discount” (as `payments`), „ospătar” = „waiter”.
const en: Translation<typeof ro> = {
  loading: 'Loading the rules…',
  intro_payAtTable:
    'Automatic discount rules by time of day and day of the week. The waiter will see an “Apply promotion” button at payment if a rule is active.',
  intro_auto:
    'Automatic discount rules by time of day and day of the week. The discount applies by itself to QR menu orders and pickup orders while the rule is active.',
  newRule: 'New rule',
  closeError: 'Close the error',
  activeNow: { one: 'ACTIVE NOW', other: 'ACTIVE NOW ({n})' },
  value_pct: '{value}%',
  value_amount: '{value} lei',
  empty_title: 'No rules yet',
  empty_payAtTable:
    'Create your first rule (e.g. “Happy Hour 5–7 pm, −20% on everything”) and the system will automatically suggest the discount at payment during that time.',
  empty_auto:
    'Create your first rule (e.g. “Happy Hour 5–7 pm, −20% on everything”) and the discount applies by itself to menu orders during that time.',
  firstRule: 'First rule',

  days_all: 'Every day',
  scope_all: 'Everything',
  status_active: 'ACTIVE',
  status_off: 'OFF',
  card_offPct: '−{value}%',
  card_offAmount: '−{value} lei',
  card_cap: '(max {amount} lei)',
  stop: 'Turn off',
  start: 'Turn on',
  deleteAria: 'Delete the rule {name}',

  day_1: 'Su',
  day_2: 'Mo',
  day_3: 'Tu',
  day_4: 'We',
  day_5: 'Th',
  day_6: 'Fr',
  day_7: 'Sa',

  edit_title: 'Edit rule',
  field_name: 'Name *',
  field_namePh: 'e.g. Happy Hour 5–7 pm',
  field_from: 'From',
  field_to: 'Until',
  field_days: 'Days of the week (empty = all)',
  days_reset: 'Reset',
  field_scope: 'Applies to',
  scope_category: 'Category',
  scope_product: 'Product',
  pick_category: '— Select a category —',
  pick_product: '— Select a product —',
  field_discount: 'Discount',
  type_pct: 'Percentage (%)',
  type_amount: 'Fixed amount (lei)',
  field_value: 'Value',
  field_valueAria: 'Discount value',
  field_cap: 'Maximum cap (lei, optional)',
  field_capPh: 'Max lei (optional)',
  field_capAria: 'Maximum cap in lei, optional',
  field_active: 'Rule active immediately',
  saveChanges: 'Save changes',
  create: 'Create rule',
  err_name: 'The name is required',
  err_value: 'The discount value must be positive',
  err_pctMax: 'The percentage can’t exceed 100',
  err_category: 'Select a category',
  err_product: 'Select a product',
  err_save: 'Error while saving',

  del_title: 'Delete the rule?',
  del_question: 'Do you want to delete {name}? This can’t be undone.',
}

export default en
