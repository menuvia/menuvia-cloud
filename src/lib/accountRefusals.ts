// =============================================================
// Menuvia — src/lib/accountRefusals.ts
// Două refuzuri ale serverului pe cardurile de cont din Setări (lotul L6b) care
// NU purtau hint până la mig 330 (contractul cu serverul e hint-ul, convenția de
// la mig 290 — RPC-urile erau mai vechi și migrațiile aplicate nu se editează),
// deci se recunoșteau după ÎNCEPUTUL textului românesc pe care îl trimit:
//   - `request_account_deletion` (mig 042): „Aveți un abonament activ…”;
//   - `set_my_mfa_enforced` (mig 235): „Dezactivarea MFA cere o sesiune
//     verificată cu MFA (aal2)”.
// Se folosesc DOAR în celelalte limbi ale personalului (GdprCard / MfaCard):
// în română textul serverului rămâne afișat ca atare, prin `toUserMessage`.
//
// Lotul L8d (mig 330): ambele RPC-uri au fost recreate VERBATIM cu hint pe
// fiecare `raise` — `active_subscription` și `mfa_aal2_required` sunt acum
// contractul și se verifică ÎNTÂI. Potrivirea pe începutul textului RĂMÂNE ca
// rezervă: clientul se poate deploya înaintea migrației (o bază fără 330 nu
// trimite hint), iar mesajul e ACELAȘI pe ambele.
// =============================================================

const ACTIVE_SUBSCRIPTION_HINT = 'active_subscription'
const MFA_AAL2_HINT = 'mfa_aal2_required'
const ACTIVE_SUBSCRIPTION_PREFIX = 'Aveți un abonament activ'
const MFA_AAL2_PREFIX = 'Dezactivarea MFA cere o sesiune verificată'

function hintOf(err: unknown): string {
  if (err == null || typeof err !== 'object') return ''
  const h = (err as { hint?: unknown }).hint
  return typeof h === 'string' ? h : ''
}

function messageOf(err: unknown): string {
  if (typeof err === 'string') return err
  if (err == null || typeof err !== 'object') return ''
  const m = (err as { message?: unknown }).message
  return typeof m === 'string' ? m : ''
}

/** Ștergerea contului refuzată fiindcă abonamentul e încă activ (mig 042 → 330). */
export function isActiveSubscriptionRefusal(err: unknown): boolean {
  return hintOf(err) === ACTIVE_SUBSCRIPTION_HINT || messageOf(err).trim().startsWith(ACTIVE_SUBSCRIPTION_PREFIX)
}

/** Schimbarea MFA refuzată fiindcă sesiunea nu e aal2 (mig 235 → 330). */
export function isMfaAal2Refusal(err: unknown): boolean {
  return hintOf(err) === MFA_AAL2_HINT || messageOf(err).trim().startsWith(MFA_AAL2_PREFIX)
}
