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

// ── Ecranul fondatorului (components/founder/SalesNetworkPanel.tsx) ───────────

/** Linkul de invitație: `<baza publică>/sef-vanzari/<token>` (agent: `/echipa/`). */
export function buildInviteLink(kind: SalesRole, token: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${INVITE_BASE_PATH[kind]}/${token}`
}

export type ContractVersionCheck = { ok: true; version: string } | { ok: false; message: string }

/**
 * Oglinda locală a regulilor serverului pentru versiunea de contract
 * (`admin_set_sales_contract_version`): serverul rămâne autoritatea, dar o
 * versiune DRAFT sau cu caractere interzise primește mesaj imediat.
 */
export function checkContractVersionInput(raw: string): ContractVersionCheck {
  const version = raw.trim()
  if (version === '') return { ok: false, message: 'Scrie versiunea contractului (ex. 1.0).' }
  if (/draft/i.test(version)) return { ok: false, message: SALES_FAILURE_MESSAGES.draft_version }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(version))
    return { ok: false, message: SALES_FAILURE_MESSAGES.invalid_version }
  return { ok: true, version }
}

/** Etichetele stărilor unui cont din rețea, în ordinea afișării. */
type SettableStatus = 'active' | 'suspended' | 'closed'

export const AFFILIATE_STATUS_OPTIONS: readonly { value: SettableStatus; label: string }[] = [
  { value: 'active', label: 'Activ' },
  { value: 'suspended', label: 'Suspendat' },
  { value: 'closed', label: 'Închis' },
]

/**
 * Stările în care poate fi mutat un cont, în oglinda serverului: `closed` e
 * terminal, iar starea curentă nu se „schimbă” în ea însăși. Orice altă stare
 * (pending / rejected = cereri din programul public) → nimic de oferit aici.
 */
export function nextStatusesFor(current: string): SettableStatus[] {
  if (current === 'active') return ['suspended', 'closed']
  if (current === 'suspended') return ['active', 'closed']
  return []
}

export interface NetworkListRow {
  affiliateId: string
  status: string
  parentAffiliateId: string | null
  name: string
}

interface NetworkSourceRow {
  affiliate_id: string
  status: string
  parent_affiliate_id: string | null
  full_name: string | null
  email: string | null
  referral_code: string
  erased_at?: string | null
}

/**
 * Lista „Rețeaua”: doar conturi în active / suspended / closed (cererile
 * pending / rejected se decid din lista de cereri), șefii (fără părinte)
 * înaintea agenților lor. Rolul se deduce din `parent_affiliate_id`.
 */
export function networkRows(rows: readonly NetworkSourceRow[]): NetworkListRow[] {
  const inNetwork = rows.filter(
    (r) => r.status === 'active' || r.status === 'suspended' || r.status === 'closed',
  )
  const toRow = (r: NetworkSourceRow): NetworkListRow => ({
    affiliateId: r.affiliate_id,
    status: r.status,
    parentAffiliateId: r.parent_affiliate_id,
    name: r.erased_at ? '(cont șters)' : r.full_name || r.email || r.referral_code,
  })
  const heads = inNetwork.filter((r) => r.parent_affiliate_id === null)
  const out: NetworkListRow[] = []
  for (const h of heads) {
    out.push(toRow(h))
    for (const a of inNetwork.filter((r) => r.parent_affiliate_id === h.affiliate_id))
      out.push(toRow(a))
  }
  // Agenți al căror șef nu e în listă (șef închis / filtrat): nu-i pierdem.
  for (const a of inNetwork.filter(
    (r) =>
      r.parent_affiliate_id !== null &&
      !heads.some((h) => h.affiliate_id === r.parent_affiliate_id),
  ))
    out.push(toRow(a))
  return out
}
