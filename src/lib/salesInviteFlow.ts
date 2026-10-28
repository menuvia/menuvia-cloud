// src/lib/salesInviteFlow.ts
// Decizii PURE ale paginii de răscumpărare a invitațiilor de rețea
// (pages/SalesInviteRedeemPage.tsx): calea de întoarcere după înscriere și
// validarea câmpurilor. Separate de pagină ca să fie testabile fără DOM.
import { safeNextPath } from './authRedirect'
import {
  SALES_FAILURE_MESSAGES,
  isInviteTokenShape,
  normalizeRoCui,
  type SalesRole,
} from './salesNetwork'

/** Calea FĂRĂ token la care e înlocuit URL-ul după citirea tokenului. */
export const INVITE_BASE_PATH: Readonly<Record<SalesRole, string>> = {
  head: '/sef-vanzari',
  agent: '/echipa',
}

/**
 * Calea spre înscriere care readuce omul pe invitație după login, sau `null`
 * dacă tokenul nu are forma unui token (nu punem gunoi într-un `?next=`) ori
 * calea nu trece de validarea open-redirect (`safeNextPath`).
 */
export function signupPathForInvite(kind: SalesRole, token: string): string | null {
  if (!isInviteTokenShape(token)) return null
  const next = safeNextPath(`${INVITE_BASE_PATH[kind]}/${token.trim()}`)
  if (next === null) return null
  return `/auth?mode=signup&lang=ro&next=${encodeURIComponent(next)}`
}

export interface InviteFieldsCheck {
  ok: boolean
  phone: string
  /** CUI normalizat (doar cifre), sau `null` dacă e invalid. */
  cui: string | null
  phoneError: string | null
  cuiError: string | null
}

/** Oglinda UX a validărilor de pe server (telefon 5–32 caractere, CUI cu cifră de control). */
export function checkInviteFields(phoneRaw: string, cuiRaw: string): InviteFieldsCheck {
  const phone = phoneRaw.trim()
  const phoneBad = phone.length < 5 || phone.length > 32
  const cui = normalizeRoCui(cuiRaw)
  return {
    ok: !phoneBad && cui !== null,
    phone,
    cui,
    phoneError: phoneBad ? SALES_FAILURE_MESSAGES.phone_required : null,
    cuiError: cui === null ? SALES_FAILURE_MESSAGES.cui_invalid : null,
  }
}
