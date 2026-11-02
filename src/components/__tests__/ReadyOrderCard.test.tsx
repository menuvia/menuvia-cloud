// Cardul „Gata de servit" al ospătarului: „Servit" dezactivat cât acțiunea e
// în curs (anti dublu-tap) și refuzul serverului afișat SUB card, în română —
// nu în bannerul de sus al paginii, unde nu se vedea a cărei comenzi era.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReadyOrderCard } from '../ReadyOrderCard'
import { makeOrder } from './fixtures'

describe('ReadyOrderCard', () => {
  it('RC1 control: „Servit" trimite comanda', async () => {
    const order = makeOrder({ id: 'r1', status: 'ready' })
    const onServe = vi.fn()
    render(<ReadyOrderCard order={order} onServe={onServe} />)
    await userEvent.click(screen.getByRole('button', { name: 'Servit' }))
    expect(onServe).toHaveBeenCalledWith(order)
  })

  it('RC2 pending → buton dezactivat „Se salvează…", fără al doilea onServe', async () => {
    // Mutație: scoate `disabled={pending}` → al doilea tap trimite din nou.
    const onServe = vi.fn()
    render(<ReadyOrderCard order={makeOrder({ status: 'ready' })} onServe={onServe} pending />)
    const btn = screen.getByRole('button', { name: 'Se salvează…' })
    expect(btn).toBeDisabled()
    await userEvent.click(btn)
    expect(onServe).not.toHaveBeenCalled()
  })

  it('RC3 refuzul stă sub card și se poate închide', async () => {
    const onDismissError = vi.fn()
    render(
      <ReadyOrderCard
        order={makeOrder({ id: 'r9', status: 'ready' })}
        onServe={vi.fn()}
        actionError="Comanda s-a schimbat între timp — probabil a mutat-o deja un coleg."
        onDismissError={onDismissError}
      />,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/s-a schimbat între timp/)
    await userEvent.click(within(alert).getByRole('button', { name: 'Închide mesajul' }))
    expect(onDismissError).toHaveBeenCalledWith('r9')
  })
})
