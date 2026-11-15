import type { Translation } from '../../core'
import type ro from './ro'

// AI assistant (as `dashboard.nav_ai`); the menu is the “menu”, sold out /
// available as `products`. The `err_ai*` texts are EXACTLY those of `imports`.
const en: Translation<typeof ro> = {
  fab_open: 'Open the AI assistant',
  title: 'AI assistant',
  intro: 'Hi! I’m your assistant. I can answer questions and suggest changes to the QR menu.',
  intro_try: 'Try: {ex1} or {ex2}.',
  intro_ex1: '“Add a Margherita pizza for 32 lei”',
  intro_ex2: '“Mark Tiramisu as sold out”',
  typing: 'The assistant is typing…',
  input_placeholder: 'Write a message…',
  send_aria: 'Send the message',
  no_reply: '(no reply)',
  err_chat: 'The AI assistant ran into an error.',
  err_aiQuota: 'The AI assistant received too many requests or the quota is used up. Try again later.',
  err_aiSession: 'Your session has expired. Sign in again.',
  err_aiForbidden: 'You don’t have permission to use the AI assistant for this restaurant.',
  err_aiUnavailable: 'The AI assistant isn’t available for this restaurant right now.',
  err_aiBusy: 'The AI assistant couldn’t respond right now. Try again in a few moments.',
  action_create_product: 'Add product',
  action_update_product: 'Edit product',
  action_toggle_sold_out: 'Product availability',
  action_create_category: 'Add category',
  status_applied: '· applied ✓',
  status_rejected: '· rejected',
  status_error: '· error',
  field_name: 'Name',
  field_price: 'Price (lei)',
  field_emoji: 'Emoji',
  field_category: 'Category',
  no_category: '(no category)',
  field_categoryName: 'Category name',
  soldOut_sentence: 'Mark {product} as {state}.',
  product_quoted: '“{name}”',
  state_soldOut: 'SOLD OUT',
  state_available: 'AVAILABLE',
  product_label: 'Product: {name}',
  confirm: 'Confirm',
  reject: 'Reject',
}

export default en
