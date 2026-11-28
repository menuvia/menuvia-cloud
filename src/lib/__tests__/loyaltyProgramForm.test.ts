// Partea pură a programului de fidelizare din formularul Setărilor (lotul C7c,
// lib/loyaltyProgramForm.ts). (Prefixul KQ: verificat cu grep în src/, tests/,
// e2e/, supabase/, docs și CLAUDE.md, nefolosit înainte.)
//   KQ1  validarea e cea de dinainte a cardului: puncte pe leu în (0, 100] (cu
//        virgulă zecimală), prag 1–100.000, recompensă ne-goală de cel mult 200
//        de caractere, scrisă TĂIATĂ. Mutația care pică: plaja pragului mutată
//        (`thr < 0`) sau recompensa netăiată. Control pozitiv: valorile
//        implicite trec.
//   KQ2  pagina scrie programul DOAR pe `ready` (fail-closed: o citire eșuată
//        ar suprascrie pragul real cu cele implicite), când omul l-a schimbat,
//        sau când modulul e pornit dar programul n-a fost salvat niciodată
//        (fără rând, fidelizarea nu pornește — `fn_loyalty_active`, mig 226).
//        Mutațiile care pică: verificarea `ready` scoasă (ramura „error" +
//        modul pornit ar scrie valorile implicite) și ramura „fără rând" scoasă
//        (programul nu s-ar mai crea niciodată din „Salvează" de sus).
//   KQ3  egalitatea compară toate cele trei câmpuri (mutația: un câmp uitat →
//        o modificare doar a recompensei n-ar mai fi „nesalvată").
import { describe, it, expect } from 'vitest'
import {
  loyaltyNeedsSave,
  loyaltyValuesEqual,
  parseLoyaltyValues,
  type LoyaltyValues,
} from '../loyaltyProgramForm'

const DEFAULTS: LoyaltyValues = { pointsPerLeu: '1', threshold: '100', reward: 'Un desert din partea casei' }

describe('loyaltyProgramForm', () => {
  it('KQ1: validarea programului', () => {
    expect(parseLoyaltyValues(DEFAULTS)).toEqual({
      ok: true,
      fields: { points_per_leu: 1, reward_threshold: 100, reward_description: 'Un desert din partea casei' },
    })
    expect(parseLoyaltyValues({ ...DEFAULTS, pointsPerLeu: '0,5', reward: '  O cafea  ' })).toEqual({
      ok: true,
      fields: { points_per_leu: 0.5, reward_threshold: 100, reward_description: 'O cafea' },
    })
    const err = (v: Partial<LoyaltyValues>) => {
      const r = parseLoyaltyValues({ ...DEFAULTS, ...v })
      return r.ok ? null : r.error
    }
    expect(err({ pointsPerLeu: '0' })).toBe('loy_err_ppl')
    expect(err({ pointsPerLeu: '101' })).toBe('loy_err_ppl')
    expect(err({ pointsPerLeu: '' })).toBe('loy_err_ppl')
    expect(err({ threshold: '0' })).toBe('loy_err_threshold')
    expect(err({ threshold: '100001' })).toBe('loy_err_threshold')
    expect(err({ threshold: '' })).toBe('loy_err_threshold')
    expect(err({ reward: '   ' })).toBe('loy_err_reward')
    expect(err({ reward: 'x'.repeat(201) })).toBe('loy_err_reward')
    expect(err({ reward: 'x'.repeat(200) })).toBeNull()
  })

  it('KQ2: când scrie pagina programul', () => {
    const at = (loadState: 'idle' | 'loading' | 'ready' | 'error', dirty: boolean, exists: boolean) => ({
      loadState,
      dirty,
      exists,
    })
    // Fail-closed: în afara lui `ready` nu se scrie nimic, nici cu modulul pornit.
    for (const s of ['idle', 'loading', 'error'] as const) {
      expect(loyaltyNeedsSave(at(s, true, false), true), s).toBe(false)
      expect(loyaltyNeedsSave(at(s, false, false), true), s).toBe(false)
    }
    // Modificat de om.
    expect(loyaltyNeedsSave(at('ready', true, true), false)).toBe(true)
    // Salvat și neatins: nimic de scris.
    expect(loyaltyNeedsSave(at('ready', false, true), true)).toBe(false)
    // Modulul pornit, programul niciodată salvat: „Salvează" îl creează.
    expect(loyaltyNeedsSave(at('ready', false, false), true)).toBe(true)
    // Control: modulul oprit și neatins — nu se creează nimic de capul lui.
    expect(loyaltyNeedsSave(at('ready', false, false), false)).toBe(false)
  })

  it('KQ3: egalitatea pe toate câmpurile', () => {
    expect(loyaltyValuesEqual(DEFAULTS, { ...DEFAULTS })).toBe(true)
    expect(loyaltyValuesEqual(DEFAULTS, { ...DEFAULTS, pointsPerLeu: '2' })).toBe(false)
    expect(loyaltyValuesEqual(DEFAULTS, { ...DEFAULTS, threshold: '250' })).toBe(false)
    expect(loyaltyValuesEqual(DEFAULTS, { ...DEFAULTS, reward: 'O cafea' })).toBe(false)
  })
})
