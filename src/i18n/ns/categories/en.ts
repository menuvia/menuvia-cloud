import type { Translation } from '../../core'
import type ro from './ro'

// „client” is the „guest”; category = category.
const en: Translation<typeof ro> = {
  unknownError: 'Unknown error',
  count: { one: '{n} category', other: '{n} categories' },
  add: 'Add category',
  empty_title: 'No categories',
  empty_desc: 'Add your first category to organise your menu.',
  productsCount: { one: '{n} product', other: '{n} products' },
  moveUp: 'Move up',
  moveDown: 'Move down',
  editAria: 'Edit category',
  deleteAria: 'Delete category',

  err_order: 'We couldn’t save the sort order.',
  err_save: 'The category couldn’t be saved.',
  err_move: 'The products couldn’t be moved.',
  err_delete: 'The category couldn’t be deleted.',
  toast_added: 'Category added',
  toast_updated: 'Updated',
  toast_deleted: 'Deleted',

  modal_titleEdit: 'Edit category',
  modal_titleAdd: 'Add category',
  field_name: 'Name *',
  field_nameAria: 'Category name',
  field_namePh: 'Main courses',
  field_emoji: 'Emoji',
  field_meta: 'Italic text under the title (optional)',
  field_metaAria: 'Italic text under the title',
  field_metaPh: 'e.g. Served until 1:00 pm',
  field_metaHint: 'Shown on the public menu under the category name.',
  tr_title: 'Translations',
  tr_optional: '(optional)',
  tr_desc:
    'The category name in the menu’s active languages. Fields left empty automatically show the name in {lang}.',
  tr_label: '{flag} Name ({lang})',
  tr_aria: 'Name ({lang})',
  saving: 'Saving…',
  saveError: 'The category couldn’t be saved: {error}',

  del_title: 'Delete category',
  del_checking: 'Checking the category’s products…',
  del_empty: 'The category has no products.',
  del_move: {
    one: 'Move this category’s product to:',
    other: 'Move this category’s {n} products to:',
  },
  del_moveAria: 'Move the products to',
  del_none: 'No category (they won’t appear on the menu)',
  del_noneNote: 'Without a category, the products don’t appear on the guest menu until you choose one for them.',
  deleting: 'Deleting…',
}

export default en
