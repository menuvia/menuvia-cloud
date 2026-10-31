// Comutatorul „Consimțământ de contact” din panoul de vânzări (pachetul 8b-2).
//
//   CC1  oprit → click cheamă onChange(true); pornit → click cheamă onChange(false)
//        (mutația `onChange(true)` fix sau `onChange(shared)` pică)
//   CC2  starea afișată e a SERVERULUI: fără rerandare cu `shared` nou, comutatorul NU
//        se mută singur (mutația cu stare optimistă locală pică)
//   CC3  refuz (eroare întoarsă) → mesajul apare, comutatorul rămâne pe poziția reală
//   CC4  textul numește patronii restaurantelor aduse, nu doar rețeaua
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ContactConsentSection from '../afiliat/ContactConsentSection'
import { SalesNetworkError } from '../../lib/salesNetwork'

vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))

describe('ContactConsentSection', () => {
  it('CC1 + CC2: cheamă setContactSharing cu valoarea opusă și reflectă serverul', async () => {
    const onChange = vi.fn<(share: boolean) => Promise<SalesNetworkError | null>>(async () => null)
    const { rerender } = render(
      <ContactConsentSection role="agent" shared={false} onChange={onChange} />,
    )
    const sw = screen.getByRole('switch', { name: 'Arată datele mele de contact' })
    expect(sw).toHaveAttribute('aria-checked', 'false')

    await userEvent.click(sw)
    expect(onChange).toHaveBeenCalledWith(true)
    await waitFor(() => expect(screen.getByRole('switch')).not.toBeDisabled())
    // Serverul n-a confirmat încă (părintele n-a rerandat): poziția rămâne cea reală.
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')

    rerender(<ContactConsentSection role="agent" shared={true} onChange={onChange} />)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenLastCalledWith(false)
  })

  it('CC3: refuzul serverului apare, comutatorul nu se mută', async () => {
    const onChange = vi.fn<(share: boolean) => Promise<SalesNetworkError | null>>(
      async () => new SalesNetworkError('network'),
    )
    render(<ContactConsentSection role="head" shared={false} onChange={onChange} />)
    await userEvent.click(screen.getByRole('switch'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Nu am putut contacta serverul/)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  })

  it('CC4: textul spune că văd și patronii, legat de comutator', () => {
    render(<ContactConsentSection role="head" shared={false} onChange={vi.fn(async () => null)} />)
    const sw = screen.getByRole('switch')
    const desc =
      document.getElementById(sw.getAttribute('aria-describedby') ?? '')?.textContent ?? ''
    expect(desc).toMatch(/proprietarul fiecărui restaurant adus de tine/)
    expect(desc).toMatch(/agenții din echipa ta/)
    expect(desc).toMatch(/Poți opri oricând/)
  })
})
