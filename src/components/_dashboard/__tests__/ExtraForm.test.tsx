// Formularul „extra nou” din fișa produsului (lotul C4a). Înainte prețul era
// `type="number"` + `parseFloat`: pe o tastatură românească „4,50” lăsa câmpul
// GOL pentru browser, iar „+ Adaugă” rămânea dezactivat fără nicio explicație.
// (Prefixul XF: verificat cu grep în src/, tests/, e2e/, supabase/, docs/ și
// CLAUDE.md, nefolosit înainte.)
//   XF1  „4,50” pleacă 4.5 (câmpul e text cu tastatură zecimală), iar
//        formularul se golește. Mutația care pică: `type="number"` readus (jsdom
//        golește „4,50”, ca browserul) sau `parseFloat` readus pe „4,50” (→ 4).
//   XF2  prețul gol nu mai lasă butonul mort: „+ Adaugă” e activ cu numele
//        completat și spune ce lipsește; control: „0” e un preț ales (extra
//        gratuit) și pleacă 0. Mutația care pică: `disabled` legat iar de
//        prețul gol sau golul transformat în 0 tăcut.
//   XF3  „-5” → „nu poate fi negativ”, „abc” → „nu e un număr valid”, cu
//        aria-invalid + aria-describedby pe câmp; tastarea șterge eroarea.
//        Mutația care pică: `if (isNaN(p) || p < 0) return` (refuz tăcut) readus.
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExtraForm } from '../ExtraForm'

const price = () => screen.getByRole('textbox', { name: 'Preț extra (lei)' })
const nameBox = () => screen.getByRole('textbox', { name: 'Nume extra' })
const addBtn = () => screen.getByRole('button', { name: '+ Adaugă' })

describe('ExtraForm (lotul C4a)', () => {
  it('XF1 prețul cu virgulă', async () => {
    const onAdd = vi.fn()
    const user = userEvent.setup()
    render(<ExtraForm onAdd={onAdd} />)
    expect(price()).toHaveAttribute('inputmode', 'decimal')
    expect(screen.getByRole('textbox', { name: 'Emoji extra' })).toBeInTheDocument()
    await user.type(nameBox(), 'Brânză')
    await user.type(price(), '4,50')
    await user.click(addBtn())
    expect(onAdd).toHaveBeenCalledWith('Brânză', 4.5, '')
    expect(nameBox()).toHaveValue('')
    expect(price()).toHaveValue('')
  })

  it('XF2 prețul gol spune ce lipsește; „0” e ales explicit', async () => {
    const onAdd = vi.fn()
    const user = userEvent.setup()
    render(<ExtraForm onAdd={onAdd} />)
    expect(addBtn()).toBeDisabled()
    await user.type(nameBox(), 'Ceapă')
    expect(addBtn()).toBeEnabled()
    await user.click(addBtn())
    expect(screen.getByRole('alert')).toHaveTextContent('Completează prețul (0 dacă e gratuit)')
    expect(onAdd).not.toHaveBeenCalled()

    await user.type(price(), '0')
    expect(screen.queryByRole('alert')).toBeNull()
    await user.click(addBtn())
    expect(onAdd).toHaveBeenCalledWith('Ceapă', 0, '')
  })

  it('XF3 negativ și fără formă de număr: mesaj lângă câmp', async () => {
    const onAdd = vi.fn()
    const user = userEvent.setup()
    render(<ExtraForm onAdd={onAdd} />)
    await user.type(nameBox(), 'Bacon')
    await user.type(price(), '-5')
    await user.click(addBtn())
    let alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Prețul nu poate fi negativ')
    expect(price()).toHaveAttribute('aria-invalid', 'true')
    expect(price()).toHaveAttribute('aria-describedby', alert.id)

    await user.clear(price())
    expect(screen.queryByRole('alert')).toBeNull()
    await user.type(price(), 'abc')
    await user.click(addBtn())
    alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Prețul nu e un număr valid (ex. 12,50)')
    expect(onAdd).not.toHaveBeenCalled()
  })
})
