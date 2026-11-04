// Ordinea produselor dintr-o categorie (lotul O5b, audit nov 2026 MENU-10).
//   OR1  ↑/↓ mută local, „Salvează ordinea” trimite lista nouă o dată;
//        neschimbată, salvarea e blocată.
//   OR2  salvarea refuzată lasă fereastra deschisă (ordinea aleasă nu se pierde).
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProductOrderModal } from '../ProductOrderModal'

const PRODUCTS = [
  { id: 'a', name: 'Ciorbă' },
  { id: 'b', name: 'Supă' },
  { id: 'c', name: 'Borș' },
]

describe('ProductOrderModal', () => {
  it('OR1 mută și salvează lista nouă', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => true)
    const onClose = vi.fn()
    render(<ProductOrderModal categoryName="Supe" products={PRODUCTS} onSave={onSave} onClose={onClose} />)
    const save = screen.getByRole('button', { name: 'Salvează ordinea' })
    expect(save).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Mută „Borș” mai sus' }))
    expect(within(screen.getByRole('list')).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('Ciorbă'),
      expect.stringContaining('Borș'),
      expect.stringContaining('Supă'),
    ])
    await user.click(save)
    expect(onSave).toHaveBeenCalledWith(['a', 'c', 'b'])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('OR2 refuzul lasă fereastra deschisă', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <ProductOrderModal categoryName="Supe" products={PRODUCTS} onSave={async () => false} onClose={onClose} />,
    )
    await user.click(screen.getByRole('button', { name: 'Mută „Ciorbă” mai jos' }))
    await user.click(screen.getByRole('button', { name: 'Salvează ordinea' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
