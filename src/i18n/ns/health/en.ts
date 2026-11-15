import type { Translation } from '../../core'
import type ro from './ro'

// “dashboard” for the panel, guests (not customers); the path “Settings → Cash
// register & tickets” and the “Help” button as in `dashboard`.
const en: Translation<typeof ro> = {
  err_load: 'Couldn’t load the score',
  err_recompute: 'Couldn’t recalculate the score',
  err_cooldown: 'The score was recalculated recently. Try again in a few minutes.',
  loadFail_title: 'We couldn’t load the score',
  loadFail_desc: 'Something went wrong while talking to the server. Try again in a few moments.',
  none_title: 'The score hasn’t been calculated yet',
  none_desc: 'The score is calculated automatically every 30 minutes. You can start a manual recalculation now.',
  computing: 'Calculating…',
  compute_now: 'Calculate now',
  eyebrow: 'Account health score',
  title: 'How your café is doing',
  last_recompute: 'Last recalculated: {ago}',
  recomputing: '⏳ Calculating…',
  recompute: '↻ Recalculate',
  delta_vs_prev: '({delta} vs. the previous score)',
  comp_title: 'Score breakdown',
  bar_login: 'Login frequency',
  bar_orders: 'Order volume',
  bar_team: 'Team',
  bar_tickets: 'Stability',
  bar_engagement: 'Engagement',
  sugg_title: 'What you can do to raise the score',
  how_title: 'How the score works',
  how_fiscal:
    'Score 0–100, recalculated every 30 minutes, from 5 components: login (20), orders (30), team (15), ' +
    'cash register stability (20) and feature use (15).',
  how_nonFiscal:
    'Score 0–100, recalculated every 30 minutes, from 4 components: login, orders, team and feature use.',
  ago_seconds: 'a few seconds ago',
  ago_minutes: { one: '{n} minute ago', other: '{n} minutes ago' },
  ago_hours: { one: '{n} hour ago', other: '{n} hours ago' },
  ago_days: { one: '{n} day ago', other: '{n} days ago' },
  narr_critical:
    'Your café is showing worrying signs. Check the suggestions below; if you’re stuck, use the “Help” button.',
  narr_excellent:
    'Congratulations! You’re using Menuvia to its full potential. Keep it up, and consider recommending the ' +
    'platform to other owners.',
  narr_good:
    'A healthy account, but there’s still room to improve. Make time for 1–2 of the suggestions below.',
  narr_average:
    'There are plenty of opportunities to optimise. Start with the component that has the lowest score.',
  narr_low: 'The app is used below its potential. Start with the component that has the lowest score.',
  trend_rising: 'Rising',
  trend_stable: 'Stable',
  trend_declining: 'Declining',
  trend_critical: 'Critical — needs attention',
  label_excellent: 'Excellent',
  label_good: 'Good',
  label_average: 'Average',
  label_weak: 'Weak',
  label_critical: 'Critical',
  sc_login: 'Login frequency',
  sg_loginNever: 'You’ve never signed in — open the dashboard at least once a day to see live orders.',
  sg_loginDays: {
    one: 'Last sign-in: {n} day ago. Sign in at least 2–3 times a week.',
    other: 'Last sign-in: {n} days ago. Sign in at least 2–3 times a week.',
  },
  sg_loginDaily: 'Sign in every day for the maximum score.',
  sc_orders: 'Order volume',
  sg_ordersZero:
    'Zero orders this week. Check that the QR menu is reachable for guests and that waiters are entering the orders.',
  sg_ordersDown: 'Orders are falling ({wk} vs {prev} last week). Check your promotions, opening hours and footfall.',
  sg_ordersGrow: 'Keep growing the volume — Happy Hour, quick QR orders, guest loyalty.',
  sc_team: 'Team size',
  sg_teamSolo:
    'You’re the only one in the account. Invite your waiters and kitchen — productivity grows when everyone has ' +
    'a dedicated role.',
  sg_teamMore: {
    one: '{n} member. Invite {more} more for the maximum score.',
    other: '{n} members. Invite {more} more for the maximum score.',
  },
  sc_tickets: 'Fiscal Bridge errors',
  sg_ticketsAlerts: {
    one: '{n} receipt failed in the last 7 days. Check Settings → Cash register & tickets — the cash register, paper, connection.',
    other:
      '{n} receipts failed in the last 7 days. Check Settings → Cash register & tickets — the cash register, paper, connection.',
  },
  sg_ticketsOk: 'The fiscal system is stable. Keep it up.',
  sc_engagement: 'Feature use',
  sg_engagementFiscal:
    'Turn on more modules: open cash shifts, set up Happy Hour, add recipes for stock management, connect the ' +
    'fiscal Bridge.',
  sg_engagement:
    'Turn on more modules: set up Happy Hour, add recipes for stock management, connect the kitchen printer.',
}

export default en
