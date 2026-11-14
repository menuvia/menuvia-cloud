import type { Translation } from '../../core'
import type ro from './ro'

// table = table; zone = area (as `waiter.resv_zone`); guest (not customer);
// pickup = pickup; “dashboard” for the restaurant’s panel.
const en: Translation<typeof ro> = {
  saving: 'Saving…',

  qr_genFailed: 'The QR code couldn’t be generated',
  qr_alt: 'QR code for {label}',
  qr_altPlain: 'QR code',

  addTable: 'Add table',
  editTable: 'Edit table',
  modal_name: 'Table name *',
  modal_namePlaceholder: 'Table 1, Terrace A…',
  modal_slug: 'URL slug',
  modal_slugPlaceholder: 'table-1',
  modal_slugHint: 'Internal identifier of the table — it doesn’t affect QR codes already printed',
  modal_seats: 'Seats (optional)',
  modal_zone: 'Area (optional)',
  modal_zonePlaceholder: 'Terrace, Indoors, Bar…',
  modal_zoneHint: 'Guests can choose the area (e.g. Terrace vs Indoors) when they book online',
  modal_err_nameRequired: 'The name is required.',
  modal_err_duplicate: 'A table with this identifier already exists. Choose another name or slug.',
  modal_err_save: 'The table couldn’t be saved. Check the details and try again.',

  general_title: 'General menu QR',
  general_leadsTo: 'Opens {path} — {text}',
  general_png: 'PNG',
  copyLink: 'Copy link',
  linkCopied: 'Link copied',
  general_copyFailed: 'We couldn’t copy the link',

  pk_flipbookNoOrders:
    'with the Flipbook style the public page shows the menu like a book, with no cart, so guests ' +
    'can’t order for pickup. To take orders, choose another style in Settings → Menu appearance → ' +
    'Product layout.',
  gm_tail: 'Good for the shop window, flyers or the counter.',
  gm_flipbook: 'guests see the menu; {why} {tail}',
  gm_withPickup: 'guests see the menu; with pickup orders active they can also order. {tail}',
  gm_plain: 'guests see the menu. {tail}',
  po_tail: 'You can add tables at any time if things change.',
  po_suspended:
    '“Pickup only” mode suspended: your plan doesn’t include pickup orders, so the dashboard ' +
    'shows your tables and reservations. Through the general QR above, guests see the menu, ' +
    'without ordering for pickup. The setting stays saved and comes back when you move to the ' +
    '{plan} plan.',
  po_head: '“Pickup only” mode on — you don’t need tables.',
  po_flipbook: '{head} Print the general QR above. Note: {why} {tail}',
  po_withPickup: '{head} Print the general QR above; guests order and pick up at the counter. {tail}',
  po_plain: '{head} Print the general QR above. {tail}',

  summary: '{active} active · {total} in total',
  pdf_title: 'Download the QR codes as a PDF for printing',
  pdf_button: 'Download QR codes',
  pdf_downloading: 'Downloading…',
  pdf_menuAria: 'QR download formats',
  pdf_grid: 'Grid — 6 / page',
  pdf_gridHint: 'For sticking on tables',
  pdf_tent: 'Folding cards',
  pdf_tentHint: '4 / page, tent style',
  pdf_poster: 'A4 poster',
  pdf_posterHint: '1 large QR / page',
  pdf_noActive: 'No active table with a QR code',
  pdf_done: 'PDF downloaded',
  pdf_failed: 'The PDF couldn’t be generated. Try again.',
  pdf_noCards: 'No QR codes to print',

  domain_previewTitle: 'Technical detail: VITE_APP_URL is not set — the preview URL is being used.',
  domain_mismatchTitle: 'Technical detail: the current domain differs from VITE_APP_URL.',
  domain_preview:
    'Heads up: QR codes generated now will contain a temporary test address, not the final address of your menu. Don’t print them yet — contact support if you need help.',
  domain_mismatch:
    'You’re on a different address from the one configured for your menu. Generated QR codes will use the configured address, not the current one.',

  bulk_titleEmpty: 'You don’t have any tables set up yet',
  bulk_title: 'Generate the QR codes for your tables',
  bulk_descEmpty: 'Enter the number of tables and Menuvia generates the QR codes for you automatically.',
  bulk_desc: 'Tell us how many tables you have and Menuvia automatically creates a QR code for each table.',
  bulk_placeholder: 'How many tables? e.g. 80',
  bulk_aria: 'Number of tables',
  bulk_busy: 'Generating…',
  bulk_btnEmpty: 'Generate tables and QR codes',
  bulk_btn: 'Generate QR codes',
  bulk_footer: 'You can edit, deactivate or regenerate any QR code later.',
  bulk_countRequired: 'Enter the number of tables (e.g. 80)',
  bulk_alreadyHave: {
    one: 'You already have {n} table set up',
    other: 'You already have {n} tables set up',
  },
  bulk_limit: 'Your plan allows up to {max} tables / QR codes. For more, you can upgrade.',
  bulk_created: {
    one: '{n} table created, with its own QR code',
    other: '{n} tables created, each with its own QR code',
  },
  bulk_duplicate: 'Some tables already exist — refresh the list and try again.',
  bulk_failed: 'The tables couldn’t be generated. Try again.',

  load_error: 'We couldn’t load the tables',
  search_placeholder: 'Search by name…',
  search_aria: 'Search tables by name',
  zone_filterAria: 'Filter by area',
  zone_all: 'All areas',
  noZone: 'No area',
  noMatches: 'No table matches the filters.',
  seats: { one: '{n} seat', other: '{n} seats' },
  inactive: 'Inactive',
  status_noQr: 'No QR code — tap “Generate QR”',
  status_active: 'QR active',
  status_disabled: 'QR deactivated',
  action_png: 'Download QR (PNG)',
  action_regenerate: 'Regenerate QR',
  action_generate: 'Generate QR',
  action_deactivate: 'Deactivate',
  action_activate: 'Activate',
  action_deactivateAria: 'Deactivate table',
  action_activateAria: 'Activate table',
  action_delete: 'Delete table',

  toast_verifyFailed: 'We couldn’t check the existing QR codes. The printed ones stay valid — try again.',
  toast_tokensFailed: 'Error generating the QR codes',
  toast_added: 'Table added',
  toast_updated: 'Table updated',
  toast_saveFailed: 'Error saving',
  toast_deleteFailed: 'Error deleting',
  toast_deleted: 'Table deleted',
  toast_deactivated: 'Table deactivated',
  toast_activated: 'Table activated',
  toast_updateFailed: 'Error updating',
  toast_rotated: 'New QR code generated',
  toast_rotateFailed: 'Error generating the QR code',
  toast_pngDownloaded: 'QR code downloaded for {name}',
  toast_downloadFailed: 'Error downloading',
  toast_copyFailed: 'The link couldn’t be copied',

  rotate_aria: 'Regenerate QR for {name}',
  rotate_title: 'Regenerate QR — {name}',
  rotate_desc: 'The old QR code will stop working. Do you want to generate a new one for this table?',
  rotate_confirm: 'Regenerate',
  delete_desc: 'All associated QR codes will be deleted. Existing orders are not affected.',
}

export default en
