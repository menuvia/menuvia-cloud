// Caseta comună „linkul se vede o singură dată” (SalesNetworkPanel + TeamSection).
//   OL1  „Copiază” scrie EXACT linkul în clipboard și anunță succesul ca status
//   OL2  copierea refuzată de browser → mesaj de eroare ca alert (nu „copiat”)
//   OL3  verbul de anulare e al locului (retragi / revoci), iar „ascunde-l”
//        cheamă onHide — linkul dispare doar prin părinte
//   OL4  un link NOU în aceeași casetă (invitație creată fără „ascunde-l”) nu
//        moștenește „Link copiat.” al celui vechi — în clipboard e tot cel vechi
//        (mutația care leagă mesajul doar de casetă, nu de link, pică)
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OneTimeLinkBox from '../OneTimeLinkBox'

const LINK = 'https://menuvia.netlify.app/echipa/tok_abc'

describe('OneTimeLinkBox', () => {
  it('OL1: copiază linkul exact și anunță succesul', async () => {
    const user = userEvent.setup()
    render(<OneTimeLinkBox link={LINK} revokeVerb="retragi" onHide={() => undefined} />)
    expect(screen.getByLabelText('Link invitație')).toHaveValue(LINK)
    await user.click(screen.getByRole('button', { name: 'Copiază' }))
    expect(await navigator.clipboard.readText()).toBe(LINK)
    expect(await screen.findByRole('status')).toHaveTextContent('Link copiat.')
  })

  it('OL2: copierea refuzată → alert, fără „copiat”', async () => {
    const user = userEvent.setup()
    render(<OneTimeLinkBox link={LINK} revokeVerb="revoci" onHide={() => undefined} />)
    // După setup(), userEvent a pus propriul clipboard; îl înlocuim cu unul care refuză.
    const original = navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    })
    try {
      await user.click(screen.getByRole('button', { name: 'Copiază' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(/copiază-l manual/i)
      expect(screen.queryByText('Link copiat.')).toBeNull()
    } finally {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: original })
    }
  })

  it('OL3: verbul locului și „ascunde-l” prin părinte', async () => {
    const user = userEvent.setup()
    const onHide = vi.fn()
    const { rerender } = render(<OneTimeLinkBox link={LINK} revokeVerb="retragi" onHide={onHide} />)
    expect(screen.getByText(/poți doar să retragi invitația/)).toBeInTheDocument()
    rerender(<OneTimeLinkBox link={LINK} revokeVerb="revoci" onHide={onHide} />)
    expect(screen.getByText(/poți doar să revoci invitația/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /am salvat linkul, ascunde-l/i }))
    expect(onHide).toHaveBeenCalledTimes(1)
  })

  it('OL4: linkul nou nu moștenește mesajul de copiere al celui vechi', async () => {
    const user = userEvent.setup()
    const OTHER = 'https://menuvia.netlify.app/echipa/tok_xyz'
    const { rerender } = render(<OneTimeLinkBox link={LINK} revokeVerb="retragi" onHide={() => undefined} />)
    await user.click(screen.getByRole('button', { name: 'Copiază' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Link copiat.')
    rerender(<OneTimeLinkBox link={OTHER} revokeVerb="retragi" onHide={() => undefined} />)
    expect(screen.getByLabelText('Link invitație')).toHaveValue(OTHER)
    expect(screen.queryByText('Link copiat.')).toBeNull()
    // Control pozitiv: copierea linkului nou își are propriul mesaj.
    await user.click(screen.getByRole('button', { name: 'Copiază' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Link copiat.')
    expect(await navigator.clipboard.readText()).toBe(OTHER)
  })
})
