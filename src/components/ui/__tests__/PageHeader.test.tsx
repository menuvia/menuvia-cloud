// PageHeader — antetul unic de pagină din panou (lotul V, nov 2026):
//   PH1  titlul e un heading de nivelul cerut (h2 implicit, h1 pe titlul
//        paginii din panou), cu ACELAȘI stil la ambele niveluri (mutația: un
//        stil separat pentru h1 → două tipografii de titlu).
//   PH2  descrierea și acțiunile apar doar când sunt date (mutația: un <p> gol
//        randat mereu, care adaugă spațiu sub fiecare titlu).
//   PH3  containerul NU e <header>: în afara lui <main> ar deveni reperul
//        „banner" al paginii (mutația: `<header>` ca rădăcină).
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageHeader } from '../PageHeader'

describe('PageHeader', () => {
  it('PH1: nivelul semantic se alege, stilul titlului e unul singur', () => {
    const { unmount } = render(<PageHeader title="Produse" />)
    const h2 = screen.getByRole('heading', { level: 2, name: 'Produse' })
    const h2Style = h2.getAttribute('style')
    unmount()
    render(<PageHeader as="h1" title="Produse" />)
    const h1 = screen.getByRole('heading', { level: 1, name: 'Produse' })
    expect(h1.getAttribute('style')).toBe(h2Style)
  })

  it('PH2: descrierea și acțiunile doar când există', () => {
    const { container, rerender } = render(<PageHeader title="Mese & QR" />)
    expect(container.querySelector('p')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    rerender(
      <PageHeader
        title="Mese & QR"
        description="Câte un cod pentru fiecare masă."
        actions={<button type="button">Adaugă masă</button>}
      />,
    )
    expect(screen.getByText('Câte un cod pentru fiecare masă.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adaugă masă' })).toBeInTheDocument()
  })

  it('PH3: fără reper „banner"', () => {
    render(<PageHeader title="Bucătărie" />)
    expect(screen.queryByRole('banner')).toBeNull()
  })
})
