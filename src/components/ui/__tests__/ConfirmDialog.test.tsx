// Tastatura în dialogul de confirmare (audit a11y oct 2026). Ce păzesc:
//   CD1  Enter cu focusul pe „Anulează" ANULEAZĂ — înainte, ascultătorul global
//        de pe `window` primea keydown-ul înaintea click-ului nativ al butonului
//        și confirma acțiunea distructivă. Pică pe codul vechi (rezultatul era
//        `true`), adică pe mutația „reintrodu `else if (e.key === 'Enter')
//        close(true)` în ascultătorul global".
//   CD2  control pozitiv: Enter cu focusul pe confirmare (autoFocus) confirmă —
//        fără el, CD1 ar trece și cu un dialog care nu mai reacționează deloc.
//   CD3  Escape anulează (trece acum prin capcana de focus, nu prin `window`).
//   CD4  Escape pe confirmarea deschisă PESTE un alt dialog o închide doar pe
//        ea — mutația „onEscape fără verificarea vârfului stivei" închide ambele.
//   CD5  `lang` dat de apelant (ecranele fiscale în română pe un panou în altă
//        limbă, lib/fiscalScreens.ts) se pune pe DIALOG — portalat în
//        `document.body`, nu moștenește limba ecranului; etichetele IMPLICITE
//        (în limba cromului) își declară limba lor; fără `lang`, dialogul nu
//        primește atribut (control). Mutația care pică: `lang={state.lang}`
//        scos de pe dialog.
import { describe, it, expect } from 'vitest'
import { render, screen, waitFor, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmRoot } from '../ConfirmDialog'
import { confirm } from '../confirm'
import { FocusTrap } from '../FocusTrap'

function ask(): { result: () => boolean | undefined } {
  let value: boolean | undefined
  act(() => {
    void confirm({
      title: 'Ștergi produsul?',
      confirmLabel: 'Șterge',
      destructive: true,
    }).then((v) => {
      value = v
    })
  })
  return { result: () => value }
}

describe('ConfirmDialog — tastatura', () => {
  it('CD1: Enter cu focusul pe „Anulează" anulează, nu confirmă', async () => {
    const user = userEvent.setup()
    render(<ConfirmRoot />)
    const pending = ask()
    const dialog = await screen.findByRole('dialog', { name: 'Ștergi produsul?' })
    const cancel = within(dialog).getByRole('button', { name: 'Anulează' })
    act(() => cancel.focus())
    expect(cancel).toHaveFocus()

    await user.keyboard('{Enter}')

    await waitFor(() => expect(pending.result()).toBe(false))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('CD2: Enter cu focusul pe confirmare confirmă', async () => {
    const user = userEvent.setup()
    render(<ConfirmRoot />)
    const pending = ask()
    const dialog = await screen.findByRole('dialog', { name: 'Ștergi produsul?' })
    const confirmBtn = within(dialog).getByRole('button', { name: 'Șterge' })
    await waitFor(() => expect(confirmBtn).toHaveFocus())

    await user.keyboard('{Enter}')

    await waitFor(() => expect(pending.result()).toBe(true))
  })

  it('CD3: Escape anulează', async () => {
    const user = userEvent.setup()
    render(<ConfirmRoot />)
    const pending = ask()
    await screen.findByRole('dialog', { name: 'Ștergi produsul?' })

    await user.keyboard('{Escape}')

    await waitFor(() => expect(pending.result()).toBe(false))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('CD4: Escape închide doar confirmarea deschisă peste alt dialog', async () => {
    const user = userEvent.setup()
    let outerClosed = 0
    render(
      <>
        <div role="dialog" aria-modal="true" aria-label="Produs">
          <FocusTrap
            onEscape={() => {
              outerClosed += 1
            }}
          />
          <button type="button">Salvează</button>
        </div>
        <ConfirmRoot />
      </>,
    )
    const pending = ask()
    await screen.findByRole('dialog', { name: 'Ștergi produsul?' })

    await user.keyboard('{Escape}')

    await waitFor(() => expect(pending.result()).toBe(false))
    expect(outerClosed).toBe(0)
    // Control pozitiv: rămas singur, dialogul de dedesubt răspunde la Escape.
    await user.keyboard('{Escape}')
    expect(outerClosed).toBe(1)
  })

  it('CD5 limba declarată de apelant stă pe dialog; etichetele implicite își păstrează limba', async () => {
    document.documentElement.setAttribute('lang', 'en')
    try {
      render(<ConfirmRoot />)
      act(() => {
        void confirm({ title: 'Anulezi acest bon?', confirmLabel: 'Anulează bon', lang: 'ro' })
      })
      const dlg = await screen.findByRole('dialog', { name: 'Anulezi acest bon?' })
      expect(dlg).toHaveAttribute('lang', 'ro')
      // „Cancel” implicit (cromul în engleză) își declară engleza în dialogul românesc.
      const cancel = within(dlg).getByRole('button', { name: 'Cancel' })
      expect(cancel.querySelector('span')).toHaveAttribute('lang', 'en')
      await userEvent.setup().click(cancel)
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

      // Control: fără `lang`, dialogul nu primește atribut.
      act(() => {
        void confirm({ title: 'Ștergi produsul?' })
      })
      const plain = await screen.findByRole('dialog', { name: 'Ștergi produsul?' })
      expect(plain).not.toHaveAttribute('lang')
    } finally {
      document.documentElement.setAttribute('lang', 'ro')
    }
  })
})
