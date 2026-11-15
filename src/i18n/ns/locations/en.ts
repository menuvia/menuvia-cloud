import type { Translation } from '../../core'
import type ro from './ro'

// location = location (as `dashboard.nav_locatii`).
const en: Translation<typeof ro> = {
  intro: 'Today in every location you manage. The figures are calculated when you open the screen.',
  err_open: 'We couldn’t open the location. Try again.',
  err_load: 'We couldn’t load the locations. Try again.',
  unavailable:
    'The locations summary isn’t available yet. You can switch between locations from the restaurant ' +
    'picker in the sidebar.',
  empty: 'We didn’t find any location that you manage.',
  current: 'Currently selected',
  stat_ordersToday: 'Orders today',
  stat_open: 'Open orders',
  stat_revenue: 'Takings today',
  stat_last: 'Last order',
  open: 'Open',
  open_aria: 'Open {name}',
  last_none: 'No orders yet',
  last_today: 'today, {time}',
  last_yesterday: 'yesterday, {time}',
  last_date: '{date}, {time}',
}

export default en
