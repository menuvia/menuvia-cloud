// Teste pe gate-ul de PAUZĂ al comenzilor Codvia, pe partea de PAGINĂ.
// Serverul (codvia-order.js, teste CO1–CO5) e sursa unică; pagina doar citește
// starea prin GET și e TRISTATE:
//   CV1  `open:false` → mesajul de pauză ÎN LOCUL formularului (nu mai cerem
//        cuiva să completeze un formular pe care serverul îl va refuza)
//   CV2  `open:true`  → formularul (control pozitiv — fără el, CV1 ar trece și
//        cu formularul șters de tot)
//   CV3  rețea căzută → `null` = necunoscut → formularul RĂMÂNE, serverul decide
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import CodviaPage from '../CodviaPage'

function stubFetch(impl: () => Promise<unknown>) {
  const fn = vi.fn(impl)
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CodviaPage — comenzi în pauză', () => {
  it('CV1: open:false → mesaj de pauză, fără formular', async () => {
    const fetchMock = stubFetch(async () => ({ ok: true, json: async () => ({ open: false }) }))
    render(<CodviaPage navigate={() => {}} />)
    expect(await screen.findByText('Comenzile sunt în pauză')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Ion Popescu')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('codvia-order'), { method: 'GET' })
  })

  it('CV2 (control pozitiv): open:true → formularul', async () => {
    const fetchMock = stubFetch(async () => ({ ok: true, json: async () => ({ open: true }) }))
    render(<CodviaPage navigate={() => {}} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.getByPlaceholderText('Ion Popescu')).toBeInTheDocument()
    expect(screen.queryByText('Comenzile sunt în pauză')).not.toBeInTheDocument()
  })

  it('CV3: rețea căzută → formularul rămâne (necunoscut ≠ închis)', async () => {
    const fetchMock = stubFetch(async () => {
      throw new TypeError('Failed to fetch')
    })
    render(<CodviaPage navigate={() => {}} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.getByPlaceholderText('Ion Popescu')).toBeInTheDocument()
    expect(screen.queryByText('Comenzile sunt în pauză')).not.toBeInTheDocument()
  })
})
