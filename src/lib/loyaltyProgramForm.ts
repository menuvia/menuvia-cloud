// ─────────────────────────────────────────────────────────────
// loyaltyProgramForm — partea PURĂ a programului de fidelizare din Setări
// (lotul C7c). Câmpurile programului (puncte pe leu, prag, recompensă) intră în
// formularul paginii: un singur „Salvează", iar paza de modificări nesalvate a
// panoului le acoperă. Înainte, cardul avea „Salvează programul" propriu și o
// stare locală pe care pagina n-o vedea: „Salvează" de sus spunea „Salvat"
// fără să le fi salvat, iar ieșirea din filă le pierdea fără nicio întrebare.
// Validarea e cea de dinainte a cardului (aceleași plaje, aceleași chei).
// ─────────────────────────────────────────────────────────────

/** Valorile din câmpuri, ca text (exact ce a tastat omul). */
export interface LoyaltyValues {
  pointsPerLeu: string
  threshold: string
  reward: string
}

/** Cheile erorilor de validare (namespace `settingsCards`). */
export type LoyaltyFieldError = 'loy_err_ppl' | 'loy_err_threshold' | 'loy_err_reward'

/** Rândul scris în `loyalty_programs` (fără restaurant și marcaje). */
export interface LoyaltyProgramFields {
  points_per_leu: number
  reward_threshold: number
  reward_description: string
}

export type LoyaltyParse =
  | { ok: true; fields: LoyaltyProgramFields }
  | { ok: false; error: LoyaltyFieldError }

/** Recompensa are cel mult 200 de caractere (cardul taie la tastare). */
export const LOYALTY_REWARD_MAX = 200

export function parseLoyaltyValues(v: LoyaltyValues): LoyaltyParse {
  const ppl = parseFloat(v.pointsPerLeu.replace(',', '.'))
  const thr = parseInt(v.threshold, 10)
  if (!Number.isFinite(ppl) || ppl <= 0 || ppl > 100) return { ok: false, error: 'loy_err_ppl' }
  if (!Number.isFinite(thr) || thr < 1 || thr > 100000) return { ok: false, error: 'loy_err_threshold' }
  if (v.reward.trim().length === 0 || v.reward.length > LOYALTY_REWARD_MAX)
    return { ok: false, error: 'loy_err_reward' }
  return {
    ok: true,
    fields: { points_per_leu: ppl, reward_threshold: thr, reward_description: v.reward.trim() },
  }
}

export function loyaltyValuesEqual(a: LoyaltyValues, b: LoyaltyValues): boolean {
  return a.pointsPerLeu === b.pointsPerLeu && a.threshold === b.threshold && a.reward === b.reward
}

export type LoyaltyLoadState = 'idle' | 'loading' | 'ready' | 'error'

/**
 * Pagina trebuie să scrie programul la „Salvează":
 *  - FAIL-CLOSED pe citire: doar pe `ready` (altfel un upsert ar suprascrie
 *    pragul și recompensa reale ale localului cu valorile implicite);
 *  - când omul a schimbat câmpurile (`dirty`);
 *  - SAU când programul n-a fost salvat niciodată și crearea e permisă
 *    (`createAllowed`: modulul e pornit ȘI cardul cu nota „Programul nu e
 *    salvat încă” e pe ecran): fidelizarea cere un rând activ în
 *    `loyalty_programs` (`fn_loyalty_active`, mig 226). Înainte, rândul se
 *    crea apăsând „Salvează programul" pe valorile implicite; fără ramura asta,
 *    „Salvează" de sus nu l-ar crea niciodată. Din altă secțiune NU (recenzia
 *    lotului C7c): un „Salvează” pentru telefon ar fi pornit, nevăzut, o
 *    recompensă pentru oaspeți pe care n-a aprobat-o nimeni pe acel ecran.
 */
export function loyaltyNeedsSave(
  state: { loadState: LoyaltyLoadState; dirty: boolean; exists: boolean },
  createAllowed: boolean,
): boolean {
  if (state.loadState !== 'ready') return false
  return state.dirty || (!state.exists && createAllowed)
}
