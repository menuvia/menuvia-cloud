// Alergenii pe TOATE cardurile meniului oaspetelui (lotul C; decizia
// fondatorului: toți, ca pictograme, niciodată ascunși) + imaginile cardurilor.
//
//   AL1  allergenEntries: deduplicare, ordinea canonică din ALLERGENS, id-ul
//        necunoscut păstrat (la final, cu numele brut), gol → []. Mutația care
//        pică: filtrarea id-urilor necunoscute („nu știu ce e → nu arăt”).
//   AL2  cele patru carduri (+ cardul-poză fără imagine, care cade pe rândul
//        minimal): pictogramele apar, cu numele întregi în limba aleasă.
//        Mutația care pică: <AllergenIcons> scos de pe oricare card.
//   AL3  toți cei 14 alergeni → 14 pictograme, fără „+N”, și pe produs EPUIZAT.
//        Mutația care pică: `.slice(0, N)` pe listă (tiparul etichetelor).
//   AL4  produs fără alergeni → nimic (control: nu randăm o pastilă goală).
//   AL5  imagini: grila folosește thumb-ul _t (cu originalul ca fallback),
//        cardul-poză originalul; ProductCard are width/height intrinseci.
//        Mutația care pică: `src={product.image_url}` pe grilă.
//   AL6  numele ACCESIBIL al butonului-card conține alergenii, pe toate patru.
//        Grid și Photo au `aria-label` pe buton, care înlocuiește conținutul
//        (pictogramele nu ajung la cititorul de ecran) — mutația care pică:
//        `allergenListLabel` scos din aria-label-ul lui Grid sau Photo.
//   AL7  foaia produsului arată aceeași listă ca cardul, inclusiv id-ul
//        necunoscut. Mutația care pică: `if (!a) return null` readus.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import ProductCard from '../menu/ProductCard'
import ProductGridCard from '../menu/ProductGridCard'
import ProductPhotoCard from '../menu/ProductPhotoCard'
import ProductMinimalRow from '../menu/ProductMinimalRow'
import { allergenEntries } from '../../lib/allergens'
import ProductSheet from '../ProductSheet'
import { ALLERGENS } from '../../lib/constants'
import { getTheme, resolveTheme } from '../../lib/themes'
import { makeProduct } from './fixtures'
import type { Product } from '../../lib/qr'

const PUB = {
  bg: '#fff',
  surface: '#f5f5f5',
  text: '#111',
  text2: '#444',
  text3: '#777',
  border: '#ddd',
  borderStrong: '#bbb',
}

const IMG = 'https://x.supabase.co/storage/v1/object/public/product-images/r1/abc.webp'

const CARDS = [
  ['ProductCard', ProductCard],
  ['ProductGridCard', ProductGridCard],
  ['ProductPhotoCard', ProductPhotoCard],
  ['ProductMinimalRow', ProductMinimalRow],
] as const

function renderCard(Card: (typeof CARDS)[number][1], product: Product, lang = 'en') {
  return render(
    <Card
      product={product}
      onOpen={vi.fn()}
      onQuickAdd={vi.fn()}
      canAdd
      accent="#C8963C"
      PUB={PUB}
      theme={getTheme('cafe')}
      lang={lang}
    />,
  )
}

function chips(): HTMLElement[] {
  const group = screen.getByTestId('allergen-icons')
  return Array.from(group.querySelectorAll<HTMLElement>('[data-allergen]'))
}

describe('alergenii pe cardurile oaspetelui', () => {
  it('AL1 allergenEntries: ordine canonică, fără duplicate, necunoscutul păstrat', () => {
    const e = allergenEntries(['lapte', ' gluten ', 'xyz', 'lapte', ''], 'en')
    expect(e.map((x) => x.id)).toEqual(['gluten', 'lapte', 'xyz'])
    expect(e.map((x) => x.label)).toEqual(['Gluten', 'Milk', 'xyz'])
    // Două necunoscute: după cele cunoscute, în ordinea în care au venit.
    expect(allergenEntries(['zzz', 'oua', 'aaa'], 'ro').map((x) => x.id)).toEqual(['oua', 'zzz', 'aaa'])
    expect(allergenEntries([], 'ro')).toEqual([])
    expect(allergenEntries(null, 'ro')).toEqual([])
  })

  it.each(CARDS)('AL2 %s: pictogramele apar, cu numele în limba aleasă', (_n, Card) => {
    renderCard(Card, makeProduct({ name: 'Plăcintă', image_url: IMG, allergens: ['lapte', 'gluten'] }))
    const group = screen.getByRole('img', { name: 'Allergens: Gluten, Milk' })
    expect(group).toHaveAttribute('title', 'Allergens: Gluten, Milk')
    expect(chips().map((c) => c.dataset.allergen)).toEqual(['gluten', 'lapte'])
  })

  it('AL2b cardul-poză FĂRĂ imagine (cade pe rândul minimal) le arată la fel', () => {
    renderCard(ProductPhotoCard, makeProduct({ image_url: null, allergens: ['oua'] }), 'ro')
    expect(screen.getByRole('img', { name: 'Alergeni: Ouă' })).toBeInTheDocument()
  })

  it.each(CARDS)('AL3 %s: toți cei 14, fără „+N”, și pe produs epuizat', (_n, Card) => {
    const all = ALLERGENS.map((a) => a.id)
    renderCard(Card, makeProduct({ image_url: IMG, allergens: [...all], is_sold_out: true }))
    expect(chips()).toHaveLength(14)
    const group = screen.getByTestId('allergen-icons')
    expect(within(group).queryByText(/^\+\d+$/)).toBeNull()
  })

  it.each(CARDS)('AL4 %s: fără alergeni → nicio pastilă', (_n, Card) => {
    renderCard(Card, makeProduct({ image_url: IMG, allergens: [] }))
    expect(screen.queryByTestId('allergen-icons')).toBeNull()
  })

  it('AL5 imagini: thumb pe grilă, original pe cardul-poză, dimensiuni intrinseci', () => {
    const p = makeProduct({ name: 'Supă', image_url: IMG })
    const grid = renderCard(ProductGridCard, p)
    const gridImg = grid.container.querySelector('img')
    expect(gridImg?.getAttribute('src')).toBe(IMG.replace('.webp', '_t.webp'))
    expect(gridImg?.getAttribute('width')).toBe('320')
    expect(gridImg?.getAttribute('height')).toBe('240')
    grid.unmount()

    const photo = renderCard(ProductPhotoCard, p)
    const photoImg = photo.container.querySelector('img')
    expect(photoImg?.getAttribute('src')).toBe(IMG)
    expect(photoImg?.getAttribute('width')).toBe('1200')
    photo.unmount()

    const card = renderCard(ProductCard, p)
    const cardImg = card.container.querySelector('img')
    expect(cardImg?.getAttribute('src')).toBe(IMG.replace('.webp', '_t.webp'))
    expect(cardImg?.getAttribute('width')).toBe('88')
    expect(cardImg?.getAttribute('height')).toBe('88')
  })

  // Recenzie CodeRabbit pe #340: AL5 verifica doar `src`-ul inițial. Mutația
  // care pică: `fallbackSrc` scos de pe GridThumbnail (imaginile fără `_t` ar
  // ajunge direct pe monogramă în loc de original).
  it('AL5b grilă: la eroarea thumb-ului, imaginea cade pe original', () => {
    const grid = renderCard(ProductGridCard, makeProduct({ image_url: IMG }))
    fireEvent.error(grid.container.querySelector('img') as HTMLImageElement)
    expect(grid.container.querySelector('img')?.getAttribute('src')).toBe(IMG)
  })

  it.each(CARDS)('AL6 %s: butonul-card își anunță alergenii cititorului de ecran', (_n, Card) => {
    renderCard(Card, makeProduct({ name: 'Plăcintă', image_url: IMG, allergens: ['lapte', 'gluten'] }))
    expect(screen.getByRole('button', { name: /Allergens: Gluten, Milk/ })).toBeInTheDocument()
  })

  it('AL7 foaia produsului: aceeași listă ca pe card, cu id-ul necunoscut', () => {
    render(
      <ProductSheet
        product={makeProduct({ name: 'Supă', allergens: ['xyz', 'lapte', 'gluten'] })}
        accent="#C8963C"
        theme={resolveTheme(null)}
        onAdd={vi.fn()}
        onClose={vi.fn()}
        lang="en"
      />,
    )
    const toggle = screen.getByRole('button', { name: 'More info' })
    if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle)
    const ids = Array.from(document.querySelectorAll<HTMLElement>('[data-allergen]')).map(
      (el) => el.dataset.allergen,
    )
    expect(ids).toEqual(['gluten', 'lapte', 'xyz'])
    expect(document.querySelector('[data-allergen="xyz"]')?.textContent).toContain('xyz')
  })
})
