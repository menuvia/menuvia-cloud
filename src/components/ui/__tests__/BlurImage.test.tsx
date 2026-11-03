// BlurImage — căderea pe original și pe monogramă.
//   BI1  fallback DISTINCT: prima eroare trece pe original, a doua pe monogramă.
//   BI2  fallback IDENTIC cu sursa (imagine fără thumb): prima eroare trece
//        direct pe monogramă, nu rămâne pe skeleton. Mutația care pică:
//        `if (fallbackSrc && !useFallback)` (recenzie CodeRabbit pe #340).
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BlurImage } from '../BlurImage'

const THUMB = 'https://x/product-images/a_t.webp'
const ORIG = 'https://x/product-images/a.webp'

describe('BlurImage — fallback', () => {
  it('BI1 fallback distinct: original, apoi monogramă', () => {
    const { container } = render(<BlurImage src={THUMB} fallbackSrc={ORIG} alt="Supă" skeleton />)
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toBe(THUMB)
    fireEvent.error(img as HTMLImageElement)
    expect(container.querySelector('img')?.getAttribute('src')).toBe(ORIG)
    fireEvent.error(container.querySelector('img') as HTMLImageElement)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByRole('img', { name: 'Supă' })).toHaveTextContent('S')
  })

  it('BI2 fallback identic cu sursa: direct pe monogramă', () => {
    const { container } = render(<BlurImage src={ORIG} fallbackSrc={ORIG} alt="Supă" skeleton />)
    fireEvent.error(container.querySelector('img') as HTMLImageElement)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByRole('img', { name: 'Supă' })).toHaveTextContent('S')
    expect(container.querySelector('.skeleton')).toBeNull()
  })
})
