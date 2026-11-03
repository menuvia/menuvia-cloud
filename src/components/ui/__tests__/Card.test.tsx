// Card — un singur radius și un singur padding, din token-uri (lotul V):
//   CA1  raza și padding-ul vin din token-uri, oricare ar fi varianta
//        (mutația: props-urile vechi `padding`/`radius` readuse).
//   CA2  `style` NU poate reintroduce o a doua rază sau alt padding (se aplică
//        după el), dar rămâne pentru layout (mutația: `...style` mutat la final).
//   CA3  `flush` = fără padding (liste cu padding pe rând).
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Card } from '../Card'

describe('Card', () => {
  it('CA1: radius și padding din token-uri pe toate variantele', () => {
    for (const v of ['flat', 'raised', 'inset'] as const) {
      const { unmount } = render(<Card variant={v}>{v}</Card>)
      const el = screen.getByText(v)
      expect(el.style.borderRadius).toBe('var(--radius-lg)')
      expect(el.style.padding).toBe('var(--space-5)')
      unmount()
    }
  })

  it('CA2: style e pentru layout, nu pentru o a doua rază', () => {
    render(
      <Card style={{ borderRadius: 4, padding: 2, display: 'flex', minHeight: 156 }}>
        conținut
      </Card>,
    )
    const el = screen.getByText('conținut')
    expect(el.style.borderRadius).toBe('var(--radius-lg)')
    expect(el.style.padding).toBe('var(--space-5)')
    expect(el.style.display).toBe('flex')
    expect(el.style.minHeight).toBe('156px')
  })

  it('CA3: flush scoate padding-ul', () => {
    render(<Card flush>listă</Card>)
    expect(screen.getByText('listă').style.padding).toMatch(/^0(px)?$/)
  })
})
