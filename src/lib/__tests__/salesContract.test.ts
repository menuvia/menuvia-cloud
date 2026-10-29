// Textele contractului de rețea, pe versiune (lib/salesContract.ts).
//
//   CT1  versiune lipsă / necunoscută / nume de membru moștenit („constructor”,
//        „__proto__”) → null: fail-closed, nu un text găsit din întâmplare
import { describe, it, expect } from 'vitest'
import { contractTextFor } from '../salesContract'

describe('contractTextFor', () => {
  it('CT1: fără text → null, inclusiv pe membri moșteniți ai obiectului', () => {
    expect(contractTextFor(null)).toBeNull()
    expect(contractTextFor('999.0')).toBeNull()
    // Mutația `return SALES_CONTRACT_TEXTS[version] ?? null` (fără hasOwnProperty
    // și fără verificarea de tip) întoarce aici funcția Object / prototipul — un
    // „text” inventat, pe care pagina l-ar fi hash-uit și afișat.
    for (const inherited of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(contractTextFor(inherited), inherited).toBeNull()
    }
  })
})
