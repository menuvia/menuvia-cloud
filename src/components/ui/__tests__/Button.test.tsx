// Primitiva Button — sursa unică a butoanelor de acțiune din panou (lotul V,
// nov 2026). Ce păzesc, cu mutația care pică fiecare test:
//   BU1  cele patru variante și cele două mărimi ajung în clasele din
//        button.css (mutația: o variantă nouă/redenumită fără clasă).
//   BU2  `type="button"` implicit — într-un <form> un buton fără tip ar trimite
//        formularul (mutația: scoți `type = 'button'` din destructurare).
//   BU3  `disabled` NU declanșează `onClick` (mutația: `disabled` ne-transmis).
//   BU4  `loading` dezactivează butonul (fără dublu-submit), pune `aria-busy`, iar
//        spinner-ul e ascuns de cititorul de ecran: numele rămâne textul
//        butonului (mutația: spinner-ul fără `aria-hidden` → numele devine
//        „Se încarcă Salvează").
//   BU5  `ref` ajunge pe <button> (declanșatoarele de meniu își readuc focusul
//        pe el) și `style` rămâne pentru layout.
import { createRef, type FormEvent } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '../Button'

describe('Button', () => {
  it('BU1: variantele și mărimile au clasele lor', () => {
    const variants = ['primary', 'secondary', 'ghost', 'danger'] as const
    for (const v of variants) {
      const { unmount } = render(<Button variant={v}>{v}</Button>)
      const b = screen.getByRole('button', { name: v })
      expect(b).toHaveClass('btn', `btn--${v}`, 'btn--md')
      unmount()
    }
    render(<Button size="sm">mic</Button>)
    expect(screen.getByRole('button', { name: 'mic' })).toHaveClass('btn--primary', 'btn--sm')
  })

  it('BU2: type="button" implicit, suprascriibil', () => {
    const onSubmit = vi.fn((e: FormEvent) => e.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Button>Implicit</Button>
        <Button type="submit">Trimite</Button>
      </form>,
    )
    expect(screen.getByRole('button', { name: 'Implicit' })).toHaveAttribute('type', 'button')
    expect(screen.getByRole('button', { name: 'Trimite' })).toHaveAttribute('type', 'submit')
  })

  it('BU3: disabled nu declanșează onClick', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const { rerender } = render(
      <Button disabled onClick={onClick}>
        Salvează
      </Button>,
    )
    const b = screen.getByRole('button', { name: 'Salvează' })
    expect(b).toBeDisabled()
    await user.click(b)
    expect(onClick).not.toHaveBeenCalled()
    // Control pozitiv: activ → click-ul ajunge.
    rerender(<Button onClick={onClick}>Salvează</Button>)
    await user.click(screen.getByRole('button', { name: 'Salvează' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('BU4: loading dezactivează, pune aria-busy și păstrează numele', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick} icon={<span data-testid="icon" />}>
        Salvează
      </Button>,
    )
    const b = screen.getByRole('button', { name: 'Salvează' })
    expect(b).toBeDisabled()
    expect(b).toHaveAttribute('aria-busy', 'true')
    // Iconița e înlocuită de spinner pe durata încărcării.
    expect(screen.queryByTestId('icon')).toBeNull()
    await user.click(b)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('BU5: ref pe <button>, style pentru layout', () => {
    const ref = createRef<HTMLButtonElement>()
    render(
      <Button ref={ref} variant="secondary" style={{ flex: 1 }}>
        Importă
      </Button>,
    )
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Importă' }))
    expect(ref.current?.style.flex).toBe('1')
    expect(ref.current).not.toHaveAttribute('aria-busy')
  })
})
