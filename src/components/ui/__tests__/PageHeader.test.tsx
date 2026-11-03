// PageHeader — antetul unic de pagină din panou (lotul V, nov 2026):
//   PH1  titlul e un heading de nivelul cerut (h2 implicit, h1 pe titlul
//        paginii din panou), cu ACELAȘI stil la ambele niveluri (mutația: un
//        stil separat pentru h1 → două tipografii de titlu).
//   PH2  descrierea și acțiunile apar doar când sunt date (mutația: un <p> gol
//        randat mereu, care adaugă spațiu sub fiecare titlu).
//   PH3  containerul NU e <header>: în afara lui <main> ar deveni reperul
//        „banner" al paginii (mutația: `<header>` ca rădăcină).
//   PH4  `compact` (antetele Bucătărie / Ospătar, recenzia #336): titlul mai
//        mic (`--text-lg`), pe UN rând cu ellipsis (`nowrap` + `overflow:
//        hidden` + `text-overflow: ellipsis`), fără `overflow-wrap: anywhere`,
//        blocul de titlu cu `min-width: 0`, textul întreg în `title`. Control:
//        varianta implicită NU taie titlul. Mutația care pică: `compact`
//        ignorat (titlul de 24px care se rupe pe trei rânduri la 375px).
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

  it('PH4: varianta compactă taie titlul pe un rând, cea implicită nu', () => {
    const long = 'Bucătărie — Restaurantul cu un nume foarte, foarte lung'
    const { unmount } = render(<PageHeader as="h1" title={long} />)
    const normal = screen.getByRole('heading', { level: 1, name: long })
    expect(normal.style.whiteSpace).not.toBe('nowrap')
    expect(normal.style.textOverflow).not.toBe('ellipsis')
    expect(normal).not.toHaveAttribute('title')
    unmount()

    render(<PageHeader as="h1" compact title={long} />)
    const h1 = screen.getByRole('heading', { level: 1, name: long })
    expect(h1.style.whiteSpace).toBe('nowrap')
    expect(h1.style.overflow).toBe('hidden')
    expect(h1.style.textOverflow).toBe('ellipsis')
    expect(h1.style.overflowWrap).not.toBe('anywhere')
    expect(h1.style.fontSize).toBe('var(--text-lg, 1.125rem)')
    expect(h1).toHaveAttribute('title', long)
    expect((h1.parentElement as HTMLElement).style.minWidth).toBe('0px')
  })
})
