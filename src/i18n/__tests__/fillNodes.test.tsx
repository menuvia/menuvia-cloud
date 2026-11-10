// Textul tradus cu linkuri în interior (lotul L2a).
//   FN1  locurile devin elementele date, în ordinea din text, iar textul dintre
//        ele rămâne exact (româna de dinainte: „Am citit și accept Termenii și …").
//   FN2  ordinea cuvintelor e a LIMBII: germana pune verbul după linkuri —
//        mutația care pică: o propoziție tăiată fix „prefix + link + și + link".
//   FN3  un loc fără element rămâne VIZIBIL (`{x}`), un text fără locuri trece neatins.
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { fillNodes } from '../fillNodes'

const links = { terms: <a href="/termeni">Termenii</a>, privacy: <a href="/confidentialitate">Politica</a> }

describe('fillNodes', () => {
  it('FN1 elemente în ordine, textul dintre ele exact', () => {
    const { container } = render(<p>{fillNodes('Am citit și accept {terms} și {privacy}', links)}</p>)
    expect(container.textContent).toBe('Am citit și accept Termenii și Politica')
    expect([...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '/termeni',
      '/confidentialitate',
    ])
  })

  it('FN2 ordinea limbii (germana: verbul la final)', () => {
    const { container } = render(
      <p>{fillNodes('Ich habe die {terms} und die {privacy} gelesen und akzeptiere sie.', links)}</p>,
    )
    expect(container.textContent).toBe('Ich habe die Termenii und die Politica gelesen und akzeptiere sie.')
    expect(container.querySelectorAll('a')).toHaveLength(2)
  })

  it('FN3 loc fără element = vizibil; fără locuri = neatins', () => {
    expect(fillNodes('a {lipsa} b', links)).toEqual(['a ', '{lipsa}', ' b'])
    expect(fillNodes('fără locuri', links)).toEqual(['fără locuri'])
  })
})
