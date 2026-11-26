import type { Translation } from '../../core'
import type ro from './ro'

const en: Translation<typeof ro> = {
  loading_printer: 'Loading the printer…',
  intro_kitchen:
    'New orders print automatically in the kitchen, on a thermal printer, through Menuvia Bridge.',
  register_device: 'Register device',
  err_dismiss: 'Dismiss the error',
  err_load: 'Couldn’t load the devices',
  err_register: 'Couldn’t register the device',
  err_delete: 'Couldn’t delete the device',
  err_save: 'Couldn’t save',
  err_ticketRetry: 'Couldn’t resend the ticket',
  err_ticketCancel: 'Couldn’t cancel the ticket',

  devices_title: 'Devices',
  empty_title: 'You haven’t registered any device yet.',
  empty_desc:
    'Register a device to get the installation key for Menuvia Bridge (the PC connected to the kitchen printer).',
  empty_step1: 'Register the device here: you get the key and the config.json file.',
  empty_step2: 'Download and install Menuvia Bridge, with config.json in the same folder.',
  empty_step3: 'Run “Verificare conexiune (check)” from the Start menu.',
  last_seen: 'Last signal: {when}',
  rel_never: 'never',
  rel_now: 'just now',
  rel_min: '{n} min ago',
  rel_hours: '{n} h ago',
  rel_days: { one: '{n} day ago', other: '{n} days ago' },
  status_online: '● Online',
  status_offline: '○ Offline',
  status_onlineHint: 'Checked in within the last 3 minutes',
  status_offlineHint: 'No sign of life for more than 3 minutes — check the PC and the Menuvia Bridge program',
  kitchen_toggle: 'Kitchen tickets',
  delete_title: 'Delete this device?',
  delete_descKitchen: 'The installed Bridge will no longer be able to print kitchen tickets.',
  delete_confirm: 'Delete device',

  col_created: 'Created',
  col_order: 'Order',
  col_status: 'Status',
  col_details: 'Details',
  col_actions: 'Actions',
  st_pending: 'Waiting',
  st_sentPrinter: 'Sent to printer',
  st_success: '✓ Printed',
  st_error: '✗ Error',
  st_cancelled: 'Cancelled',
  retries: { one: '{n} attempt', other: '{n} attempts' },

  tickets_title: 'Kitchen tickets',
  tickets_desc:
    'New orders print automatically on the kitchen thermal printer, through the devices with “Kitchen tickets” turned on.',
  tickets_empty:
    'No tickets yet. Turn on “Kitchen tickets” on a device above — new orders will show up here.',
  reprint: 'Reprint',
  ticketCancel_title: 'Cancel this ticket?',
  ticketCancel_desc: 'It will no longer be printed in the kitchen.',
  ticketCancel_confirm: 'Cancel ticket',

  reg_titleDevice: 'Register a Bridge device',
  reg_name: 'Name *',
  reg_namePh: 'e.g. Kitchen PC',
  reg_defaultName: 'Kitchen PC',
  reg_infoKitchen:
    'After registering you get a unique installation key. You use it once, when installing Bridge on the PC connected to the kitchen printer. The key can only be recovered later by registering again.',
  reg_submit: 'Register',
  reg_busy: 'Registering…',

  key_titleDevice: 'Device registered',
  key_intro: 'Install Bridge in 3 steps:',
  step1_title: 'Download Menuvia Bridge',
  step1_descKitchen: 'The Windows installer, on the PC connected to the kitchen printer.',
  step1_download: 'Download the installer',
  step1_missing: 'The download link isn’t published yet — ask the Menuvia team for the installer.',
  step2_title: 'Download config.json',
  step2_desc:
    'Put it in the same folder as the installer before you run it: it holds the server address and the device key, so the setup picks them up by itself.',
  step2_kitchenNote: 'The setup will then only ask for the IP address of the thermal printer.',
  step2_download: 'Download config.json',
  step2_private: 'The file contains the key: keep it only on the Bridge PC.',
  step3_title: 'Run the check',
  step3_descKitchen:
    'From the Start menu: Menuvia Bridge → “Verificare conexiune (check)”. It must reach the Menuvia server and the printer; the device then shows here as “● Online”.',
  key_label: 'Installation key for Bridge:',
  key_copy: 'Copy key',
  key_copied: 'Copied ✓',
  key_copyFailed: 'Couldn’t copy automatically — select the key above and copy it by hand.',
  key_warning:
    'Save the key now (or download config.json). Once this window is closed it can’t be recovered. If you lose it, delete the device and register a new one.',
  key_done: 'I’ve saved the key',
}

export default en
