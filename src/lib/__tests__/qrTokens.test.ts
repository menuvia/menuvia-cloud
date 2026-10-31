// Un token QR nou se creează DOAR pentru mesele dovedit fără token activ
// (code-health-qr-token-unknown-rotates). Un token nou activ dezactivează QR-ul
// deja tipărit al mesei (trigger mig 119), deci „nu știu” nu are voie să devină
// „lipsește”.
//
//   QT1  citire reușită → exact mesele fără token activ, în ordinea primită
//   QT2  citire PICATĂ (eroare) sau fără date → null: nu se generează nimic.
//        Mutația care pică: `(existing ?? []).map(...)` din codul vechi, care
//        dădea TOATE mesele ca „lipsă” și rotea tăcut QR-urile tipărite.
import { describe, it, expect } from 'vitest'
import { tablesMissingActiveToken } from '../qrTokens'

describe('tablesMissingActiveToken', () => {
  it('QT1 doar mesele fără token activ', () => {
    const data = [{ table_id: 'b' }]
    expect(tablesMissingActiveToken(['a', 'b', 'c'], { data, error: null })).toEqual(['a', 'c'])
    expect(tablesMissingActiveToken(['a'], { data: [{ table_id: 'a' }], error: null })).toEqual([])
    expect(tablesMissingActiveToken(['a', 'b'], { data: [], error: null })).toEqual(['a', 'b'])
  })

  it('QT2 citire picată sau fără date → null, nu „toate lipsesc”', () => {
    expect(
      tablesMissingActiveToken(['a', 'b'], { data: null, error: { message: 'boom' } }),
    ).toBeNull()
    expect(
      tablesMissingActiveToken(['a', 'b'], { data: [], error: { message: 'boom' } }),
    ).toBeNull()
    expect(tablesMissingActiveToken(['a', 'b'], { data: null, error: null })).toBeNull()
  })
})
