// src/i18n/elapsed.ts — vârsta unei comenzi în limba personalului (lotul L4b).
// Calculul e UNUL singur (`elapsedParts`, lib/utils); aici doar unitățile se
// traduc, din `common` (elapsed_s / elapsed_m / elapsed_hm). În română ieșirea
// e EXACT textul de dinainte al lui `elapsed()` („30s”, „5m”, „1h 30m”);
// `elapsed()` a fost șters în lotul L4c, când Bucătăria a trecut pe `elapsedT`.
// Fără import la runtime din namespace: traducătorul vine de la apelant.
import { elapsedParts } from '../lib/utils'
import type { Translator } from './core'
import type commonRo from './ns/common/ro'

export function elapsedT(createdAt: string, tc: Translator<typeof commonRo>): string {
  const p = elapsedParts(createdAt)
  if (p.unit === 's') return tc.t('elapsed_s', { n: p.n })
  if (p.unit === 'm') return tc.t('elapsed_m', { n: p.n })
  return tc.t('elapsed_hm', { h: p.h, m: p.m })
}
