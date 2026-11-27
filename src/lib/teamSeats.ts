// ─────────────────────────────────────────────────────────────
// teamSeats.ts — locurile din echipă (lotul C7b)
// ─────────────────────────────────────────────────────────────
// Limita de membri a planului (`max_team_members`, mig 131/290) se impune în
// DATE la `accept_invite` și numără TOȚI membrii, owner-ul inclus. Fila Echipă
// arăta doar „N membri”, fără limită, iar patronul putea trimite invitații
// peste ea: invitatul își făcea cont ca să primească o eroare. Contorul de aici
// e oglinda verificării din `send-invite.js` (membri + invitațiile în așteptare
// cu adrese DISTINCTE), care respinge cu 409 `team_member_limit`. Serverul
// rămâne autoritatea: un plan necunoscut lasă formularul deschis.
//
// Planul aparține RESTAURANTULUI: limita vine din `useFeatures(restaurantId)`
// (regula 3), nu din `profile.plan`. Se citește `limit` BRUT, ca în trigger
// (care ignoră `enabled`); `getLimit` ar întoarce 0 pe un feature oprit.
import type { RestaurantFeatures } from './features'

// Peste acest plafon limita e „practic nelimitată” (pro = 1000, enterprise =
// null) și contorul nu se afișează — serverul o impune oricum.
const DISPLAY_MAX = 1000

export type TeamSeats =
  /** Planul sau lista nu sunt (încă) cunoscute → fără contor; serverul decide. */
  | { kind: 'unknown' }
  /** Fără limită (sau una ≥ 1000) → fără contor, formularul rămâne deschis. */
  | { kind: 'unlimited' }
  /** `used` = membri + invitații în așteptare; `full` = nu mai încape nimeni. */
  | { kind: 'limited'; used: number; limit: number; full: boolean }

const normalizeEmail = (e: string): string => e.trim().toLowerCase()

/**
 * Locurile din echipă. `membersCount` = `null` cât timp lista n-a fost
 * încărcată (contorul nu are voie să spună „0 din 10” înaintea ei).
 * `pendingEmails` = adresele invitațiilor în așteptare; o adresă cu două
 * rânduri (retrimitere) ocupă UN loc.
 */
export function teamSeats(
  features: RestaurantFeatures | null,
  membersCount: number | null,
  pendingEmails: readonly string[],
): TeamSeats {
  const entry = features?.features?.max_team_members
  if (!entry || membersCount === null) return { kind: 'unknown' }
  const limit: unknown = entry.limit
  if (limit === null) return { kind: 'unlimited' }
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0) return { kind: 'unknown' }
  if (limit >= DISPLAY_MAX) return { kind: 'unlimited' }
  const pending = new Set(pendingEmails.map(normalizeEmail).filter((e) => e !== ''))
  const used = membersCount + pending.size
  return { kind: 'limited', used, limit, full: used >= limit }
}

/**
 * Adresa tastată are deja o invitație în așteptare? Atunci trimiterea o
 * ÎNLOCUIEȘTE (nu ocupă un loc nou) — serverul n-o blochează, deci
 * retrimiterea rămâne posibilă și cu echipa completă sau peste limită.
 */
export function isPendingInviteEmail(pendingEmails: readonly string[], email: string): boolean {
  const e = normalizeEmail(email)
  return e !== '' && pendingEmails.some((p) => normalizeEmail(p) === e)
}

/**
 * Trimiterea către `email` e oprită de locuri? DOAR cu echipa plină ȘI o
 * adresă fără invitație în așteptare. Retrimiterea nu se oprește NICIODATĂ,
 * nici când echipa e PESTE limită (`used > limit`: invitații dinainte de C7b,
 * downgrade, doi manageri simultan) — înlocuiește un loc, nu adaugă unul.
 * Oglinda EXACTĂ a lui `teamSeatsFull` din send-invite.js (INV19).
 */
export function inviteSeatBlocked(
  seats: TeamSeats,
  pendingEmails: readonly string[],
  email: string,
): boolean {
  if (seats.kind !== 'limited' || !seats.full) return false
  return !isPendingInviteEmail(pendingEmails, email)
}
