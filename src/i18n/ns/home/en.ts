import type { Translation } from '../../core'
import type ro from './ro'

const en: Translation<typeof ro> = {
  welcome_title: 'Welcome, {name}',
  welcome_description:
    'Set up your restaurant, check your QR codes and keep track of today’s activity.',

  metric_ordersToday: 'Orders today',
  metric_ordersTodayHint: 'excluding cancelled ones',
  metric_loadFailedHint: 'couldn’t be loaded',
  metric_activeProducts: 'Active products',
  metric_activeQrs: 'Active QR codes',
  metric_pickupQrHint: 'General QR (pickup only)',
  metric_scannableTablesHint: 'scannable tables',
  metric_occupiedTables: 'Tables occupied now',
  metric_openOrdersHint: 'with open orders',
  metric_revenueToday: 'Revenue today',
  metric_revenueHint: 'payments recorded today',
  metric_tipsToday: 'Tips today',
  metric_tipsHint: 'for information, not included in revenue',
  metric_setup: 'Setup',
  metric_setupDoneHint: 'all done ✓',
  metric_setupStepsHint: 'steps completed',
  metrics_someFailed: 'Some figures couldn’t be loaded.',

  setup_title: 'Restaurant setup',
  setup_progress: '{done}/{total} steps completed',
  setup_progressAria: 'Setup progress',
  setup_addProducts: 'Add products',
  setup_createCategories: 'Create categories',
  setup_generateTableQrs: 'Generate QR codes for your tables',
  setup_checkPublicMenu: 'Check the public menu',
  setup_inviteTeam: 'Invite your team',
  setup_firstOrderPickup: 'First test order — open the public menu and place an order',
  setup_firstOrderTable: 'First test order — open a table’s QR code and place an order',
  setup_itemDoneAria: '{label} (done)',
  setup_itemUnknownAria: '{label} (status unknown)',

  score_title: 'Menu score',
  score_loading: 'Loading the score...',

  quick_title: 'Quick actions',
  quick_addProduct: 'Add product',
  quick_generateQrs: 'Generate QR codes',
  quick_qrStands: 'Physical QR stands',
  quick_viewPublicMenu: 'View public menu',
  quick_viewOrders: 'View orders',
  quick_inviteWaiter: 'Invite a waiter',

  sub_title: 'Subscription & billing',
  sub_yourPlan: 'Your plan: {name}. ',
  sub_manageHint: 'Update your card, change your plan or download your invoices.',
  sub_noCustomer:
    'Your account has no subscription paid by card, so there’s nothing to manage here. Plans and prices are on the plans page.',
  sub_portalFallback: 'We couldn’t open the billing portal. Try again in a few moments.',
  sub_seePlans: 'See plans',
  sub_opening: 'Opening…',
  sub_manage: 'Manage subscription',

  upsell_regionLabel: 'Offer: {title}',
  upsell_orderingLead: 'Guests order on their own and the kitchen gets the order right away.',
  upsell_orderingBenefit1: 'Table orders via QR code',
  upsell_orderingBenefit2: 'Kitchen screen for new orders',
  upsell_orderingBenefit3: 'Pickup orders',
  upsell_paymentsTitle: 'Pay at the table',
  upsell_paymentsLead: 'On the {plan} plan.',
  upsell_paymentsBenefit1: 'Guests pay from their phone',
  upsell_paymentsBenefit2: 'The fiscal receipt is issued automatically',
  upsell_paymentsBenefit3: 'Revenue and VAT show up in your reports automatically',
  upsell_seePlan: 'See plan',

  planUnknown_text:
    'We couldn’t load the restaurant’s plan. Until it loads, some sections stay hidden.',

  agent_heading: 'Your Menuvia agent',
  agent_defaultName: 'Sales agent',
  agent_scope:
    'The agent can see and edit ONLY the menu (categories, products, options) and the tables with their QR codes. ' +
    'They do NOT see orders, payments, reservations, fiscal data, settings or the team. ' +
    'It doesn’t affect your subscription, and you can revoke access at any time.',
  agent_accessGranted: 'Access granted',
  agent_accessRequested: 'The agent has requested access',
  agent_accessRevoked: 'Access revoked',
  agent_accessNone: 'No access',
  agent_ownerOnly: 'Only the restaurant owner can grant or revoke the agent’s access.',
  agent_grant: 'Give the agent access',
  agent_grantOk: 'The agent now has access to the menu',
  agent_decline: 'Decline request',
  agent_declineOk: 'The agent’s request was declined',
  agent_revoke: 'Revoke access',
  agent_revokeOk: 'The agent’s access was revoked',
  agent_revokeConfirmTitle: 'Revoke the agent’s access?',
  agent_revokeConfirmText:
    'The agent will no longer be able to see or edit the menu and the tables. You can give them access again at any time.',
}

export default en
