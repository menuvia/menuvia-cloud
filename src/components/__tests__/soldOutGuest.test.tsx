// „Epuizat” pe meniul oaspetelui (mig 313, lotul B): badge consecvent și
// adăugarea blocată pe TOATE suprafețele — cele patru carduri de produs, foaia
// de produs și coșul.
//
//   SG1  cele patru carduri (Card / Grid / Photo / MinimalRow), produs epuizat:
//        textul „Epuizat” în limba aleasă, butonul „Adaugă …” lipsește, iar un
//        click pe card nu deschide foaia. Control: același produs disponibil
//        are butonul și deschide foaia. Mutația care pică: `canAdd && !isSoldOut`
//        → `canAdd` pe oricare card, `disabled={isSoldOut}` scos, sau `lang`
//        netransmis de ProductPhotoCard rândului minimal (fără imagine): badge-ul
//        cădea pe „Epuizat” în română pe un meniu în engleză (reparat în 313).
//   SG2  ProductSheet cu produs epuizat: butonul principal spune „Epuizat” și e
//        dezactivat, onAdd nu e chemat. Control: disponibil → „Adaugă în coș”.
//        Mutația care pică: `!soldOut &&` scos din `canAdd`.
//   SG3  coșul cu o linie epuizată (după reîmprospătarea meniului): badge pe
//        linie, „+” dezactivat, trimiterea blocată + anunțul. Control: aceeași
//        linie cu produsul disponibil → CTA activ, fără anunț. Mutația care
//        pică: `soldOutInCart === 0` scos din `canSubmit`.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ProductCard from '../menu/ProductCard'
import ProductGridCard from '../menu/ProductGridCard'
import ProductPhotoCard from '../menu/ProductPhotoCard'
import ProductMinimalRow from '../menu/ProductMinimalRow'
import ProductSheet from '../ProductSheet'
import QrCartSheet, { type QrCartSheetProps } from '../QrCartSheet'
import { getTheme, resolveTheme } from '../../lib/themes'
import { lineTotal } from '../../lib/orders'
import { makeCartItem, makeCategory, makeProduct } from './fixtures'

const PUB = {
  bg: '#fff',
  surface: '#f5f5f5',
  text: '#111',
  text2: '#444',
  text3: '#777',
  border: '#ddd',
  borderStrong: '#bbb',
}

const CARDS = [
  ['ProductCard', ProductCard],
  ['ProductGridCard', ProductGridCard],
  ['ProductPhotoCard', ProductPhotoCard],
  ['ProductMinimalRow', ProductMinimalRow],
] as const

describe('meniul oaspetelui — produs epuizat', () => {
  it.each(CARDS)('SG1 %s: badge în limba aleasă, fără „Adaugă”, fără foaie', (_name, Card) => {
    const onOpen = vi.fn()
    const onQuickAdd = vi.fn()
    const sold = makeProduct({ name: 'Supă', is_sold_out: true })
    const { unmount } = render(
      <Card
        product={sold}
        onOpen={onOpen}
        onQuickAdd={onQuickAdd}
        canAdd
        accent="#C8963C"
        PUB={PUB}
        theme={getTheme('cafe')}
        lang="en"
      />,
    )
    expect(screen.getAllByText('Sold out').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Add Supă' })).toBeNull()
    for (const b of screen.getAllByRole('button')) fireEvent.click(b)
    expect(onOpen).not.toHaveBeenCalled()
    expect(onQuickAdd).not.toHaveBeenCalled()
    unmount()

    // Control: disponibil → butonul există, iar cardul deschide foaia.
    const ok = makeProduct({ name: 'Supă', is_sold_out: false })
    render(
      <Card
        product={ok}
        onOpen={onOpen}
        onQuickAdd={onQuickAdd}
        canAdd
        accent="#C8963C"
        PUB={PUB}
        theme={getTheme('cafe')}
        lang="en"
      />,
    )
    expect(screen.queryByText('Sold out')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add Supă' }))
    expect(onQuickAdd).toHaveBeenCalledTimes(1)
  })

  it('SG2 ProductSheet: „Epuizat”, dezactivat, onAdd nechemat; control disponibil', () => {
    const onAdd = vi.fn()
    const { unmount } = render(
      <ProductSheet
        product={makeProduct({ name: 'Supă', is_sold_out: true })}
        accent="#C8963C"
        theme={resolveTheme(null)}
        onAdd={onAdd}
        onClose={vi.fn()}
      />,
    )
    const cta = screen.getByRole('button', { name: /^Epuizat$/ })
    expect(cta).toBeDisabled()
    fireEvent.click(cta)
    expect(onAdd).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /adaugă în coș/i })).toBeNull()
    unmount()

    render(
      <ProductSheet
        product={makeProduct({ name: 'Supă', is_sold_out: false })}
        accent="#C8963C"
        theme={resolveTheme(null)}
        onAdd={onAdd}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /adaugă în coș/i })).toBeEnabled()
  })

  it('SG3 coșul: linie epuizată → badge, „+” blocat, trimitere blocată + anunț', () => {
    const renderCart = (soldOut: boolean) => {
      const cart = [makeCartItem({ product_id: 'p-supa', product_name_snapshot: 'Supă' })]
      const props: QrCartSheetProps = {
        cart,
        cartTotal: cart.reduce((s, i) => s + lineTotal(i), 0),
        notes: '',
        submitting: false,
        submitError: null,
        categories: [
          makeCategory({
            products: [makeProduct({ id: 'p-supa', name: 'Supă', is_sold_out: soldOut })],
          }),
        ],
        checkoutSuggestionSettings: null,
        PUB,
        accent: '#C8963C',
        accentGradient: 'linear-gradient(#C8963C,#C8963C)',
        onClose: vi.fn(),
        onNotesChange: vi.fn(),
        onUpdateQty: vi.fn(),
        onRemove: vi.fn(),
        onLineTotal: lineTotal,
        onSubmit: vi.fn(),
        onOpenProduct: vi.fn(),
        onAddToCart: vi.fn(),
      }
      return { props, ...render(<QrCartSheet {...props} />) }
    }

    const sold = renderCart(true)
    expect(screen.getByText('Epuizat')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /crește cantitatea/i })).toBeDisabled()
    const cta = screen.getByRole('button', { name: /trimite comanda/i })
    expect(cta).toBeDisabled()
    fireEvent.click(cta)
    expect(sold.props.onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/s-au epuizat\. Scoate-le/)).toBeInTheDocument()
    // Scoaterea liniei rămâne posibilă.
    expect(screen.getByRole('button', { name: /elimină supă/i })).toBeEnabled()
    sold.unmount()

    renderCart(false)
    expect(screen.queryByText('Epuizat')).toBeNull()
    expect(screen.getByRole('button', { name: /crește cantitatea/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /trimite comanda/i })).toBeEnabled()
    expect(screen.queryByText(/s-au epuizat\. Scoate-le/)).toBeNull()
  })
})
