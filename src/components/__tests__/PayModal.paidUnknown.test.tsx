// PayModal cu suma deja încasată NECUNOSCUTĂ (lotul C2a). Înainte un eșec al
// citirii plăților dădea `alreadyPaid = 0`: ospătarul vedea totalul întreg ca
// rest, suma pornea pre-completată cu el, iar serverul respingea plata cu
// `overpayment` (mig 291). Acum `null` = necunoscută.
//
//   PMU1  citirea a EȘUAT (`null` + failed): alertă cu „Reîncearcă”,
//         „Confirmă plata” dezactivat și un click nu trimite nimic; butonul
//         cheamă reîncercarea. Control pozitiv: cu suma sosită (40), restul e
//         60, butonul e activ și pleacă 60. Mutația care pică: `alreadyPaid ?? 0`
//         tratat drept cunoscut (vechiul implicit 0).
//   PMU2  citirea e ÎN CURS (`null`, fără eșec): mesaj de așteptare, fără
//         „Reîncearcă”, fără preflight și FĂRĂ buton de reducere (cu bani
//         încasați serverul o refuză). Control pozitiv: cu 0 încasat butonul de
//         reducere apare. Mutația care pică: garda `alreadyPaid <= 0` (în JS
//         `null <= 0` e true — reducerea s-ar oferi pe necunoscut).
//   PMU4  suma TASTATĂ cât restul era necunoscut rămâne a ospătarului când
//         sosește suma încasată (65 tastat, 40 încasat pe 100 → câmpul rămâne
//         65, preflight-ul spune că depășește restul de 60, pleacă 65); câmpul
//         NEATINS urmează restul (60). Recenzie CodeRabbit pe #392. Mutația care
//         pică: efectul vechi `setAmount(grandTotal)` pe `[grandTotal]` (rescria
//         65 → 60 și trimitea 60 fără ca ospătarul s-o fi ales). Câmpul derivat
//         în randare închide și cadrul în care restul afișa 60 iar câmpul ținea
//         încă „100.00” (efectul rula DUPĂ commit) — fără efect, cadrul nu
//         există.
//   PMU5  un bacșiș SCHIMBAT re-sincronizează câmpul (comportamentul de
//         dinainte: 65 tastat + 10% → 66.00), iar un tap pe bacșișul deja ales
//         nu atinge suma tastată. Mutația care pică: `chooseTips` care nu mai
//         readuce câmpul la suma de plată.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PayModal } from '../WaiterOrderCard'
import { makeOrder } from './fixtures'

const ORDER = () => makeOrder({ status: 'served', total: 100 })
const confirmButton = () => screen.getByRole('button', { name: 'Confirmă plata' })

describe('PayModal — suma deja încasată necunoscută', () => {
  it('PMU1: citire eșuată → „Reîncearcă” și confirmare dezactivată; cu suma sosită, restul', () => {
    const onConfirm = vi.fn().mockResolvedValue({ ok: true })
    const onRetry = vi.fn()
    const view = render(
      <PayModal
        order={ORDER()}
        alreadyPaid={null}
        alreadyPaidFailed
        onRetryAlreadyPaid={onRetry}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      /Nu am putut citi plățile deja înregistrate pe comandă/,
    )
    expect(confirmButton()).toBeDisabled()
    fireEvent.click(confirmButton())
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }))
    expect(onRetry).toHaveBeenCalledTimes(1)

    // Control pozitiv: suma încasată a sosit — restul e 60, iar 60 pleacă.
    view.rerender(
      <PayModal
        order={ORDER()}
        alreadyPaid={40}
        onRetryAlreadyPaid={onRetry}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Rest de plată:')).toBeInTheDocument()
    expect(confirmButton()).toBeEnabled()
    fireEvent.click(confirmButton())
    expect(onConfirm).toHaveBeenCalledWith('cash', 60, 0)
  })

  it('PMU4: suma tastată rămâne când sosește restul; câmpul neatins urmează restul', () => {
    const onConfirm = vi.fn().mockResolvedValue({ ok: true })
    const view = render(
      <PayModal
        order={ORDER()}
        alreadyPaid={null}
        alreadyPaidFailed
        onRetryAlreadyPaid={() => {}}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    )
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '65' } })
    view.rerender(
      <PayModal order={ORDER()} alreadyPaid={40} onConfirm={onConfirm} onClose={() => {}} />,
    )
    expect(screen.getByRole('spinbutton')).toHaveValue(65)
    expect(screen.getByRole('status')).toHaveTextContent(/depășește restul/i)
    fireEvent.click(confirmButton())
    expect(onConfirm).toHaveBeenCalledWith('cash', 65, 0)
    view.unmount()

    // Control pozitiv: neatins, câmpul urmează restul sosit.
    const fresh = render(
      <PayModal order={ORDER()} alreadyPaid={null} onConfirm={onConfirm} onClose={() => {}} />,
    )
    expect(screen.getByRole('spinbutton')).toHaveValue(100)
    fresh.rerender(
      <PayModal order={ORDER()} alreadyPaid={40} onConfirm={onConfirm} onClose={() => {}} />,
    )
    expect(screen.getByRole('spinbutton')).toHaveValue(60)
    fireEvent.click(confirmButton())
    expect(onConfirm).toHaveBeenLastCalledWith('cash', 60, 0)
  })

  it('PMU5: bacșișul schimbat re-sincronizează câmpul; același bacșiș nu', () => {
    render(<PayModal order={ORDER()} alreadyPaid={40} onConfirm={vi.fn()} onClose={() => {}} />)
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '65' } })
    fireEvent.click(screen.getByRole('button', { name: 'Fără' }))
    expect(input).toHaveValue(65)
    fireEvent.click(screen.getByRole('button', { name: '10%' }))
    expect(input).toHaveValue(66)
  })

  it('PMU2: citire în curs → așteptare, fără preflight și fără reducere; cu 0 încasat reducerea apare', () => {
    const onDiscountClick = vi.fn()
    const view = render(
      <PayModal
        order={ORDER()}
        alreadyPaid={null}
        onConfirm={vi.fn()}
        onClose={() => {}}
        onDiscountClick={onDiscountClick}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Se citesc plățile deja înregistrate pe comandă…')
    expect(screen.queryByRole('button', { name: 'Reîncearcă' })).toBeNull()
    expect(confirmButton()).toBeDisabled()
    expect(screen.queryByRole('button', { name: /aplică reducere/i })).toBeNull()
    expect(screen.queryByRole('note')).toBeNull()
    // Preflight-ul tace: o sumă sub total nu primește avertisment pe necunoscut.
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '50' } })
    expect(screen.getAllByRole('status')).toHaveLength(1)

    // Control pozitiv: nimic încasat (cunoscut) → reducerea se oferă.
    view.rerender(
      <PayModal
        order={ORDER()}
        alreadyPaid={0}
        onConfirm={vi.fn()}
        onClose={() => {}}
        onDiscountClick={onDiscountClick}
      />,
    )
    expect(screen.getByRole('button', { name: /aplică reducere/i })).toBeEnabled()
    expect(confirmButton()).toBeEnabled()
  })
})
