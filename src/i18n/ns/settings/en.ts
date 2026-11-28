import type { Translation } from '../../core'
import type ro from './ro'

// guest (not customer); pickup = pickup; “dashboard” for the restaurant’s
// panel; plan names stay the commercial ones (PLAN_LABELS). The path
// “Settings → Menu appearance → Product layout” matches `tables`.
const en: Translation<typeof ro> = {
  save_busy: 'Saving…',
  unsaved: 'You have unsaved changes',
  toast_saved: 'Saved',
  toast_uploadFailed: 'Upload failed',
  slug_taken: 'Slug unavailable: “{slug}” is already in use',
  err_slug: 'Couldn’t change the slug.',
  slug_confirmTitle: 'Change the menu address to {next}?',
  slug_confirmDesc:
    'The old address {old} will stop working: the general QR code you’ve already printed (window, ' +
    'flyers), links on Instagram, Google or flyers, the reservation page and the cancellation links ' +
    'already sent to guests will lead to a page that doesn’t exist. Table QR codes keep working. ' +
    'After saving, download the new general QR code from Tables & QR codes.',
  slug_confirmOk: 'Change address',
  err_save: 'Couldn’t save',

  info_title: 'Main details',
  info_name: 'Restaurant name *',
  info_namePh: 'La Bella Trattoria',
  info_tagline: 'Tagline',
  info_taglinePh: 'Authentic cuisine',
  info_city: 'City',
  info_cityPh: 'Brighton',
  info_address: 'Address',
  info_addressPh: '12 North Street',
  info_phone: 'Phone',
  info_phonePh: '+44 xxxx xxxxxx',
  info_hours: 'Note about opening hours (optional)',
  info_hoursPh: 'E.g. Closed on public holidays',
  info_hoursHint:
    'Shown at the bottom of the menu, next to the address. The daily hours and the open indicator come ' +
    'from “Detailed opening hours” below.',
  info_description: 'Description',
  info_descriptionPh: 'About the restaurant…',

  country_title: 'Restaurant country',
  country_descRo: 'In-app payments, fiscal receipts and the VAT report are only available for restaurants in Romania.',
  country_desc: 'The country where the venue operates.',
  country_ownerOnly: 'Only the restaurant owner can change the country.',
  tz_title: 'Time zone',
  tz_desc: 'Opening hours, pickup times and reservation times are calculated in this time zone.',
  tz_aria: 'Restaurant time zone',

  hours_title: 'Detailed opening hours',
  hours_desc: 'Used for the “OPEN NOW” indicator and the “Today 08:00–23:00” text on the public menu.',
  hours_copyMonday: 'Copy Monday → all',
  hours_open: 'Open',
  hours_opensLabel: 'Opens',
  hours_closesLabel: 'Closes',
  hours_openAria: '{day} opening time',
  hours_closeAria: '{day} closing time',
  hours_confirmTitle: 'Overwrite the Tuesday–Sunday hours with Monday’s?',
  hours_confirmDesc: 'This can’t be undone.',
  hours_confirmOk: 'Overwrite',
  day_mon: 'Monday',
  day_tue: 'Tuesday',
  day_wed: 'Wednesday',
  day_thu: 'Thursday',
  day_fri: 'Friday',
  day_sat: 'Saturday',
  day_sun: 'Sunday',

  logo_title: 'Logo',
  logo_desc: 'Square logo. Optional, used as an avatar / future favicon.',
  logo_alt: 'Logo',
  logo_upload: 'Upload logo',
  logo_remove: 'Remove logo',
  uploading: 'Uploading…',
  cover_title: 'Cover image',
  cover_desc:
    'Shown at the top of the public menu. Recommended: 16:9 format, >1200px wide. ' +
    'If there isn’t one, we use a gradient generated from your theme.',
  cover_alt: 'Cover',
  cover_none: 'No image — active theme gradient',
  cover_upload: 'Upload image',

  amen_title: 'Amenities',
  amen_desc: 'Shown as pills at the top of the public menu.',
  amenity_wifi: 'WiFi',
  amenity_vegan_options: 'Vegan options',
  amenity_outdoor_seating: 'Terrace',
  amenity_parking: 'Parking',
  amenity_cards: 'Card payments',
  amenity_reservations: 'Reservations',
  amenity_pet_friendly: 'Pet friendly',

  wifi_title: 'WiFi password (optional)',
  wifi_desc: 'Shown in the menu in plain text. Leave it empty if you don’t want to publish it.',
  wifi_label: 'WiFi password',
  wifi_ph: 'e.g. tinctura2024',
  social_title: 'Social media',
  social_website: 'Website',
  google_title: 'Google Reviews (automatic reviews)',
  google_descPay:
    'Once the guest has paid and answered the feedback questions, we show them a “Write a review on ' +
    'Google” button that takes them straight to your business page. The button appears for every guest, ' +
    'whatever their rating — Google doesn’t allow showing the link only to happy guests.',
  google_desc:
    'Once the guest has answered the feedback questions, we show them a “Write a review on Google” ' +
    'button that takes them straight to your business page. The button appears for every guest, ' +
    'whatever their rating — Google doesn’t allow showing the link only to happy guests.',
  google_placeId: 'Google Place ID',
  google_help: 'Find your Place ID here: {link}. Search for your venue’s name and copy the ID (it starts with “ChIJ…”).',
  google_finder: 'Place ID Finder',
  google_configured: 'Configured',
  google_preview: 'URL preview: {link}',

  preview_title: 'Preview',
  preview_desc: 'This is how your guests see the menu — it updates as you make changes.',
  url_title: 'Menu URL',
  url_slugLabel: 'Menu address (slug)',
  url_slugPh: 'slug-url',
  url_slugHint:
    'Changing the address stops the general QR code you’ve already printed and the links you’ve ' +
    'published (Instagram, Google, reservations). Table QR codes aren’t affected.',
  accent_title: 'Accent colour',
  accent_aria: 'Accent colour {name}',
  accent_C8963C: 'Gold',
  accent_E05555: 'Red',
  accent_4CAF6E: 'Green',
  accent_5B8DEF: 'Blue',
  accent_9B72CF: 'Purple',
  accent_E07B45: 'Orange',
  accent_3ABFBF: 'Turquoise',
  theme_title: 'QR menu theme',
  theme_desc: 'Choose the visual style of your menu. It applies instantly to the page your guests see.',
  theme_bg: 'Background',
  theme_accent: 'Accent',
  theme_surface: 'Surface',
  theme_note: 'After saving, guests will see the new theme the next time the menu loads.',
  theme_cafe_name: 'Editorial coral',
  theme_cafe_desc: 'Warm cream + coral. Editorial, welcoming, italic serif type.',
  theme_pizzeria_name: 'Italian pizzeria',
  theme_pizzeria_desc: 'Red + white + green. Cheerful, energetic, Italian-style fonts.',
  'theme_fine-dining_name': 'Fine dining',
  'theme_fine-dining_desc': 'Black + elegant gold. Sophisticated, minimalist, classic serif.',
  theme_pub_name: 'Pub & Bar',
  theme_pub_desc: 'Dark green + amber. Robust, masculine, industrial fonts.',
  theme_mexican_name: 'Mexican / Fast food',
  theme_mexican_desc: 'Bright colours — red + yellow. Cheerful, energetic, eye-catching.',
  theme_asian_name: 'Asian & Sushi',
  theme_asian_desc: 'Minimalist white + Japanese red. Clean, orderly, timeless.',
  theme_healthy_name: 'Healthy & Vegan',
  theme_healthy_desc: 'Green + natural cream. Clean, fresh, rounded fonts.',
  theme_mediterranean_name: 'Mediterranean',
  theme_mediterranean_desc: 'Santorini blue + white. Airy, bright, holiday feel.',
  layout_title: 'Product layout',
  layout_desc: 'How products are arranged on the page your guests see. Applies to the digital menu and the QR menu.',
  layout_list: 'List',
  layout_listDesc: 'Small photo + text. Classic and compact.',
  layout_grid: 'Photo gallery',
  layout_gridDesc: 'Large photos, 2 columns. The most visual.',
  layout_minimal: 'Elegant minimal',
  layout_minimalDesc: 'Text, no photos. Editorial feel, classic and fast.',
  layout_photo: 'Photo first',
  layout_photoDesc: 'Large photos with the name and price on the photo. Tap the photo for details and options.',
  layout_flipbook: 'Flipbook (PDF/pages)',
  layout_flipbookDesc: 'The menu pages as images, leafed through like a book.',
  fb_pagesTitle: 'Menu pages ({n}/{max})',
  fb_help:
    'Have your menu as a PDF? Export the pages as images (or take photos of them) and upload them ' +
    'here — or use the AI import in Products to turn it into an interactive menu.',
  fb_pageAlt: 'Page {n}',
  fb_moveUp: 'Move page {n} up',
  fb_moveDown: 'Move page {n} down',
  fb_remove: 'Delete page {n}',
  fb_empty: 'No pages yet. Until you upload pages, guests see the menu in the “List” style.',
  fb_upload: 'Upload pages (you can select several)',
  fb_orderNote:
    'With Flipbook, guests see the menu like a book — ordering from the menu isn’t available in this ' +
    'style; calling the waiter still works.',
  fb_full: 'Maximum {max} pages — delete one to add another',
  fb_partial: {
    one: 'Maximum {max} pages — uploading only the first one',
    other: 'Maximum {max} pages — uploading only the first {n}',
  },
  fb_added: {
    one: '{n} page added — don’t forget to save',
    other: '{n} pages added — don’t forget to save',
  },
  el_title: 'Menu elements',
  el_desc: 'Choose what guests see on the menu. Everything is on by default.',
  el_cover: 'Cover',
  el_coverDesc: 'The cover image at the top. When it’s off, a gradient is shown.',
  el_tagline: 'Tagline',
  el_taglineDesc: 'The restaurant’s tagline, shown under the name.',
  el_status: 'Open / closed status',
  el_statusDesc: 'The pill that shows whether the restaurant is open right now.',
  el_amenities: 'WiFi & Vegan',
  el_amenitiesDesc: 'Pills for the WiFi and vegan options amenities.',
  el_social: 'Social',
  el_socialDesc: 'Pills with Instagram, TikTok, Facebook and website links.',
  branding_title: '“Made with Menuvia” badge',
  branding_desc: 'The discreet link at the bottom of the public menu. On your plan you can hide it.',
  branding_toggle: 'Show the “Made with Menuvia” badge',
  langs_title: 'Menu languages',
  langs_desc: 'The language your menu is written in, and the extra languages guests can view it in.',
  langs_base: 'Original menu language',
  langs_baseHelp:
    'The language you wrote the product names and descriptions in. Translations are added for the other languages.',
  cur_title: 'Menu currency',
  cur_descPay:
    'The currency in which prices are shown on the public menu and the QR menu. Your Menuvia subscription and fiscal receipts aren’t affected.',
  cur_desc: 'The currency in which prices are shown on the public menu and the QR menu. Your Menuvia subscription isn’t affected.',
  cur_ron: 'RON (lei)',

  mod_title: 'Optional modules',
  mod_desc:
    'Turn on only what you need. Disabled modules are blocked on the server — neither guests nor staff ' +
    'can create data in them.',
  mod_resv: 'Reservations',
  mod_resvDesc:
    'Lets guests book tables from the public menu. You confirm and manage them in the dashboard, under Reservations.',
  mod_resvOn: 'Reservations module turned on',
  mod_resvOff: 'Reservations module turned off',
  pickup_title: 'Pickup orders (click-and-collect)',
  pickup_toggle: 'Pickup orders',
  pickupOnly_title: '“Pickup only” mode (no tables)',
  pickup_lead: 'Minimum prep time (min)',
  pickup_leadAria: 'Minimum prep time (minutes)',
  pickup_slot: 'Slot interval (min)',
  pickup_slotAria: 'Slot interval (minutes)',
  pickup_open: 'Opening',
  pickup_openAria: 'Pickup opening time',
  pickup_close: 'Closing',
  pickup_closeAria: 'Pickup closing time',
  pickup_errTime: 'Choose a full time (e.g. 09:00).',
  pickup_errMinutes: 'Enter a number of minutes between {min} and {max}.',
  pickup_errSave: 'Check the times and minutes under “{card}” before saving.',
  pickup_instr: 'Instructions for guests (optional)',
  pickup_instrPh: 'E.g. Call when you arrive, side entrance',
  pickup_kitchenNote:
    'Pickup orders appear on the Kitchen screen with the {badge} badge. The guest’s name and pickup time are visible.',
  pickup_badge: '📦 Pickup',
  pk_lead: 'Pickup orders from the restaurant, from your public page',
  pk_flipbookTail: '. Note: {why}',
  pk_flipbookNoOrders:
    'with the Flipbook style the public page shows the menu like a book, with no cart, so guests ' +
    'can’t order for pickup. To take orders, choose another style in Settings → Menu appearance → ' +
    'Product layout.',
  pk_activeLead: 'With pickup on, guests can order from your public page',
  pk_activeTail: ' without scanning a QR code and pick up straight from the restaurant. Cash payment at pickup.',
  pk_plainTail: '.',
  po_suspended: 'On your plan this mode doesn’t apply: without pickup orders, the dashboard shows your tables and reservations.',
  po_desc:
    'For a food truck / counter: hides the Floor plan and Reservations from the dashboard. ' +
    'The general QR in Tables & QR codes becomes your main QR.',
  sugg_title: 'Cart suggestions',
  sugg_desc:
    'Automatically suggests products from categories missing from the cart (e.g. a guest ordered a main course but no dessert).',
  sugg_msgLabel: 'Message shown',
  sugg_msgAria: 'Message shown with the suggestions',
  sugg_msgPh: '🍰 Before you send… would you like anything else?',
  vat_title: 'VAT rates',
  vat_desc:
    'The 4 VAT groups used in your restaurant. Change the percentage when the state changes the rates — ' +
    'products keep their group automatically.',

  plan_title: 'Current plan',
  plan_failed: 'We couldn’t check the plan',
  plan_checking: 'Checking…',
  signOut: 'Sign out',
}

export default en
