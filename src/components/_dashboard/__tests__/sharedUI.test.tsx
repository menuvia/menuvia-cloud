// Controalele comune ale panoului (Produse / Categorii / Modificatori / Setări)
// după auditul a11y din oct 2026. Ce păzesc, cu mutația care pică fiecare test:
//   SU1  Modal e un dialog REAL: role="dialog", aria-modal, numele = titlul,
//        focusul intră în dialog la deschidere (mutația: div-ul vechi fără rol).
//   SU2  Escape și butonul „Închide" închid (mutația: FocusTrap fără onEscape).
//   SU3  Tab-ul rămâne în dialog (mutația: modal fără <FocusTrap />, focusul
//        ajunge pe butonul din pagina de dedesubt).
//   SU4  Toggle e un comutator cu nume și stare; `disabled` blochează schimbarea
//        (mutația: <button> fără role/aria-checked/aria-label).
//   SU5  Inp / Sel au nume accesibil (mutația: fără aria-label).
//   SU6  Toast: confirmările ajung într-o regiune `status`, erorile într-una
//        `assertive`, ambele montate ÎNAINTE de primul mesaj (mutația: div-urile
//        vechi, fără regiuni live).
//   SU7  stilul comun al câmpurilor nu mai stinge inelul de focus.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal, Toggle, Inp, Sel, Toast, useToast, inp } from '../sharedUI'

describe('Modal', () => {
  it('SU1: e dialog cu nume, aria-modal și focus mutat înăuntru', async () => {
    render(
      <Modal title="Editează produs" onClose={() => {}}>
        <p>Conținut</p>
      </Modal>,
    )
    const dialog = await screen.findByRole('dialog', { name: 'Editează produs' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    // FocusTrap mută focusul în dialog (pe container), nu-l lasă pe <body>.
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('SU2: Escape și butonul „Închide" cheamă onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal title="Adaugă categorie" onClose={onClose}>
        <p>Conținut</p>
      </Modal>,
    )
    await screen.findByRole('dialog', { name: 'Adaugă categorie' })
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Închide' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('SU3: Tab ciclează doar prin elementele dialogului', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button type="button">Afară</button>
        <Modal title="Șterge produs" onClose={() => {}}>
          <button type="button">Șterge</button>
        </Modal>
      </>,
    )
    const dialog = await screen.findByRole('dialog', { name: 'Șterge produs' })
    const close = within(dialog).getByRole('button', { name: 'Închide' })
    const del = within(dialog).getByRole('button', { name: 'Șterge' })

    await user.tab()
    expect(close).toHaveFocus()
    await user.tab()
    expect(del).toHaveFocus()
    // De pe ultimul element, Tab revine pe primul din dialog — nu pe „Afară".
    await user.tab()
    expect(close).toHaveFocus()
    await user.tab({ shift: true })
    expect(del).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Afară' })).not.toHaveFocus()
  })
})

describe('Toggle', () => {
  it('SU4: comutator cu nume și stare; disabled nu schimbă nimic', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(
      <Toggle label="Comenzi pentru ridicare" value={false} onChange={onChange} />,
    )
    const sw = screen.getByRole('switch', { name: 'Comenzi pentru ridicare' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    await user.click(sw)
    expect(onChange).toHaveBeenCalledWith(true)

    rerender(<Toggle label="Comenzi pentru ridicare" value onChange={onChange} />)
    expect(screen.getByRole('switch', { name: 'Comenzi pentru ridicare' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    onChange.mockClear()
    rerender(<Toggle label="Comenzi pentru ridicare" value={false} onChange={onChange} disabled />)
    const locked = screen.getByRole('switch', { name: 'Comenzi pentru ridicare' })
    expect(locked).toBeDisabled()
    await user.click(locked)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('Inp / Sel', () => {
  it('SU5: câmpurile au nume accesibil', async () => {
    const user = userEvent.setup()
    const onName = vi.fn()
    const onCat = vi.fn()
    render(
      <>
        <Inp label="Nume produs" value="" onChange={onName} placeholder="Spaghete" />
        <Sel label="Categorie" value="" onChange={onCat}>
          <option value="">Fără categorie</option>
          <option value="c1">Deserturi</option>
        </Sel>
      </>,
    )
    await user.type(screen.getByRole('textbox', { name: 'Nume produs' }), 'A')
    expect(onName).toHaveBeenCalledWith('A')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Categorie' }), 'c1')
    expect(onCat).toHaveBeenCalledWith('c1')
  })
})

function ToastHarness() {
  const { toasts, toast } = useToast()
  return (
    <>
      <button type="button" onClick={() => toast('Produs adăugat')}>
        succes
      </button>
      <button type="button" onClick={() => toast('Nu s-a putut salva', 'error')}>
        eroare
      </button>
      <Toast toasts={toasts} />
    </>
  )
}

describe('Toast', () => {
  it('SU6: mesajele ajung în regiuni live montate dinainte', async () => {
    const user = userEvent.setup()
    const { container } = render(<ToastHarness />)
    // Regiunile există înaintea primului mesaj (altfel nu toate cititoarele
    // de ecran anunță conținutul apărut odată cu ele).
    const status = screen.getByRole('status')
    const assertive = container.querySelector('[aria-live="assertive"]')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(assertive).not.toBeNull()
    expect(status).toBeEmptyDOMElement()

    await user.click(screen.getByRole('button', { name: 'succes' }))
    expect(within(status).getByText('Produs adăugat')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'eroare' }))
    expect(assertive).toHaveTextContent('Nu s-a putut salva')
    expect(status).not.toHaveTextContent('Nu s-a putut salva')
  })
})

describe('stilul câmpurilor', () => {
  it('SU7: `inp` nu mai conține outline (inline ar bate :focus-visible)', () => {
    expect('outline' in inp).toBe(false)
  })
})
