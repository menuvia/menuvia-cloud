// „Înscrie un restaurant” din panoul de vânzări (components/afiliat/EnrollSection.tsx,
// pachetul 8b-2).
//
//   EN1  codul agentului e afișat mare, iar „Copiază linkul” copiază linkul /r/<cod>
//        (mutația care copiază codul în locul linkului pică)
//   EN2  tap pe QR → ecran plin (dialog), Escape îl închide
//        (mutația fără ecran plin / fără Escape pică)
//   EN3  „Arată demo” duce pe ruta publică /demo (existentă), nu pe un URL inventat
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,QR') },
}))

import EnrollSection from '../afiliat/EnrollSection'

function toast() {
  return { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), dismiss: vi.fn() }
}

describe('EnrollSection', () => {
  it('EN1: codul mare și „Copiază linkul” copiază linkul de recomandare', async () => {
    const user = userEvent.setup()
    const t = toast()
    render(<EnrollSection code="k7mxq2p" clientsCount={0} toast={t} />)
    expect(screen.getByTestId('agent-code')).toHaveTextContent('k7mxq2p')
    await user.click(screen.getByRole('button', { name: 'Copiază linkul' }))
    await waitFor(() => expect(t.success).toHaveBeenCalledWith('Link copiat'))
    expect(await navigator.clipboard.readText()).toMatch(/\/r\/k7mxq2p$/)
  })

  it('EN2: QR-ul se deschide pe tot ecranul și se închide cu Escape', async () => {
    const user = userEvent.setup()
    render(<EnrollSection code="k7mxq2p" clientsCount={2} toast={toast()} />)
    await user.click(
      await screen.findByRole('button', { name: 'Deschide codul QR pe tot ecranul' }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Codul QR al linkului tău' })
    expect(dialog.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,QR')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await user.click(screen.getByRole('button', { name: 'Arată codul QR' }))
    await user.click(screen.getByRole('button', { name: 'Închide' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('EN3: „Arată demo” duce pe /demo', () => {
    render(<EnrollSection code="k7mxq2p" clientsCount={0} toast={toast()} />)
    expect(screen.getByRole('link', { name: 'Arată demo' })).toHaveAttribute('href', '/demo')
  })
})
