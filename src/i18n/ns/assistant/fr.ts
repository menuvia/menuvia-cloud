import type { Translation } from '../../core'
import type ro from './ro'

// vous ; assistant IA (comme `dashboard.nav_ai`) ; épuisé / disponible comme
// `products`. Les textes `err_ai*` sont EXACTEMENT ceux de `imports`.
const fr: Translation<typeof ro> = {
  fab_open: 'Ouvrir l’assistant IA',
  title: 'Assistant IA',
  intro:
    'Bonjour ! Je suis votre assistant. Je peux répondre à vos questions et proposer des modifications du menu QR.',
  intro_try: 'Essayez : {ex1} ou {ex2}.',
  intro_ex1: '« Ajouter une pizza Margherita à 32 lei »',
  intro_ex2: '« Marquer le tiramisu comme épuisé »',
  typing: 'L’assistant écrit…',
  input_placeholder: 'Écrivez un message…',
  send_aria: 'Envoyer le message',
  no_reply: '(pas de réponse)',
  err_chat: 'Erreur de l’assistant IA.',
  err_aiQuota: 'L’assistant IA a reçu trop de demandes ou le quota est épuisé. Réessayez plus tard.',
  err_aiSession: 'Votre session a expiré. Reconnectez-vous.',
  err_aiForbidden: 'Vous n’avez pas le droit d’utiliser l’assistant IA pour ce restaurant.',
  err_aiUnavailable: 'L’assistant IA n’est pas disponible pour ce restaurant en ce moment.',
  err_aiBusy: 'L’assistant IA n’a pas pu répondre. Réessayez dans quelques instants.',
  action_create_product: 'Ajouter un produit',
  action_update_product: 'Modifier le produit',
  action_toggle_sold_out: 'Disponibilité du produit',
  action_create_category: 'Ajouter une catégorie',
  status_applied: '· appliqué ✓',
  status_rejected: '· refusé',
  status_error: '· erreur',
  field_name: 'Nom',
  field_price: 'Prix (lei)',
  field_emoji: 'Emoji',
  field_category: 'Catégorie',
  no_category: '(sans catégorie)',
  field_categoryName: 'Nom de la catégorie',
  soldOut_sentence: 'Marquer {product} comme {state}.',
  product_quoted: '« {name} »',
  state_soldOut: 'ÉPUISÉ',
  state_available: 'DISPONIBLE',
  product_label: 'Produit : {name}',
  confirm: 'Confirmer',
  reject: 'Refuser',
}

export default fr
