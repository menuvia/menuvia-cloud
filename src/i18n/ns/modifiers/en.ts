import type { Translation } from '../../core'
import type ro from './ro'

// „client” is the „guest”; „grup de opțiuni” = „option group”.
const en: Translation<typeof ro> = {
  intro: 'Option groups (e.g. Extra sauce, Size)',
  newGroup: 'New group',
  loadError: 'We couldn’t load the option groups.',
  empty_title: 'No option groups',
  empty_desc: 'Add your first group to offer extra options on products (e.g. Size, Toppings).',

  card_single: 'Single choice',
  card_multiple: 'Multiple choice',
  card_max: { one: 'max {n} option', other: 'max {n} options' },
  card_required: 'Required',
  card_unused: 'Not used by any product — guests don’t see it',
  card_usedBy: { one: 'Used by {n} product', other: 'Used by {n} products' },
  card_tooFew: '⚠ Too few options available: products with this group can’t be ordered.',
  card_pick: 'Choose products',
  card_deleteAria: 'Delete group',
  price_plus: '+{amount} lei',
  price_minus: '−{amount} lei',
  price_included: 'Included',
  opt_markUnavailable: 'Mark unavailable',
  opt_markAvailable: 'Mark available',
  opt_available: 'Available',
  opt_unavailable: 'Unavailable',
  opt_deleteAria: 'Delete option',
  opt_namePh: 'Option name',
  opt_nameAria: 'New option name for the group {group}',
  opt_pricePh: '+lei',
  opt_priceAria: 'Extra price for the new option in the group {group}',
  opt_add: 'Add',

  pick_title: 'Products with “{group}”',
  pick_desc: 'Tick the products where the guest and the waiter choose from this group.',
  pick_search: 'Search product',
  pick_noProducts: 'You have no products yet.',
  pick_noMatch: 'No products found.',
  pick_count: { one: '{n} product selected', other: '{n} products selected' },

  edit_title: 'Edit group',
  field_name: 'Name *',
  field_namePh: 'Extra topping',
  field_type: 'Selection type',
  type_single: 'One option',
  type_multiple: 'Several options',
  type_singleHint: 'E.g. “Size” — the guest chooses Small OR Medium OR Large',
  type_multipleHint: 'E.g. “Toppings” — the guest can choose several at once',
  field_max: 'Maximum number of options',
  field_maxPh: 'Unlimited',
  field_maxHint: 'How many options the guest can tick. Leave empty for unlimited.',
  field_required: 'Must the guest choose?',
  req_yes: 'Yes, required',
  req_no: 'No, optional',
  req_yesHint: 'The guest can’t add the product to the cart without choosing something',
  req_noHint: 'The guest can skip this section',
  tr_title: 'Translations',
  tr_groupFallback: 'Group',
  saving: 'Saving…',

  del_title: 'Delete the group “{name}”?',
  del_descOptions: {
    one: 'Its only option will also be deleted permanently.',
    other: 'Its {n} options will also be deleted permanently.',
  },
  del_descNone: 'This can’t be undone.',
  lastOff_title: 'No options available in “{group}”?',
  lastOff_desc: {
    one: 'The group is required: the product that uses it can’t be ordered until you mark an option available again.',
    other:
      'The group is required: the {n} products that use it can’t be ordered until you mark an option available again.',
  },

  err_nameRequired: 'The name is required',
  err_optionTr: 'The translation of the option “{name}” wasn’t saved.',
  err_pickSave: 'We couldn’t save the group’s products.',
  hint_groupNotFound: 'The option group no longer exists. Close the window and reload the page.',
  hint_productNotFound: 'A ticked product no longer exists. Close the window and reload the page.',
  hint_duplicateProducts: 'A product appears twice. Close the window and open it again.',
}

export default en
