// =============================================================
// Menuvia — src/lib/accountRefusals.ts
// Două refuzuri ale serverului pe cardurile de cont din Setări (lotul L6b) care
// NU poartă hint (contractul cu serverul e hint-ul, convenția de la mig 290 —
// aceste RPC-uri sunt mai vechi și migrațiile aplicate nu se editează), deci se
// recunosc după ÎNCEPUTUL textului românesc pe care îl trimit:
//   - `request_account_deletion` (mig 042): „Aveți un abonament activ…”;
//   - `set_my_mfa_enforced` (mig 235): „Dezactivarea MFA cere o sesiune
//     verificată cu MFA (aal2)”.
// Se folosesc DOAR în celelalte limbi ale personalului (GdprCard / MfaCard):
// în română textul serverului rămâne afișat ca atare, prin `toUserMessage`.
// O recreare a RPC-ului cu hint ar trebui să înlocuiască potrivirea pe text.
// =============================================================

const ACTIVE_SUBSCRIPTION_PREFIX = 'Aveți un abonament activ'
const MFA_AAL2_PREFIX = 'Dezactivarea MFA cere o sesiune verificată'

function messageOf(err: unknown): string {
  if (typeof err === 'string') return err
  if (err == null || typeof err !== 'object') return ''
  const m = (err as { message?: unknown }).message
  return typeof m === 'string' ? m : ''
}

/** Ștergerea contului refuzată fiindcă abonamentul e încă activ (mig 042). */
export function isActiveSubscriptionRefusal(err: unknown): boolean {
  return messageOf(err).trim().startsWith(ACTIVE_SUBSCRIPTION_PREFIX)
}

/** Schimbarea MFA refuzată fiindcă sesiunea nu e aal2 (mig 235). */
export function isMfaAal2Refusal(err: unknown): boolean {
  return messageOf(err).trim().startsWith(MFA_AAL2_PREFIX)
}
