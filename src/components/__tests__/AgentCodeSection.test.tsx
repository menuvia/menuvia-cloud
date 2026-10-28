// Bannerul „Ai venit prin agentul tău Menuvia" și câmpul de cod tastat (mig 301).
//
//   AU1  bannerul spune de unde vine atribuirea și are „Nu e agentul meu"
//   AU2  câmpul e ÎNCHIS implicit: doar linkul „Am un cod de agent", niciun input —
//        patronii veniți singuri nu văd niciun câmp
//   AU3  după „Am un cod de agent" apare inputul; ce se scrie ajunge în onChange
//   AU4  mesajele de problemă (formă / inexistent) sunt anunțate ca alertă
//   AU5  fără problemă, ajutorul e neutru (nu alertă)
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentCodeBanner, AgentCodeField } from '../auth/AgentCodeSection'

describe('AgentCodeBanner', () => {
  it('AU1 text + „Nu e agentul meu"', () => {
    const onDismiss = vi.fn()
    render(<AgentCodeBanner lang="ro" onDismiss={onDismiss} />)
    expect(screen.getByText('Ai venit prin agentul tău Menuvia')).toBeInTheDocument()
    expect(screen.getByText(/decât dacă îi dai tu acordul/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /nu e agentul meu/i }))
    expect(onDismiss).toHaveBeenCalled()
  })
})

describe('AgentCodeField', () => {
  const base = { lang: 'ro' as const, value: '', onChange: vi.fn(), onOpen: vi.fn(), problem: null }

  it('AU2 închis: doar linkul, niciun input', () => {
    render(<AgentCodeField {...base} open={false} />)
    expect(screen.getByRole('button', { name: /am un cod de agent/i })).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('AU3 deschis: input cu etichetă; scrisul ajunge în onChange; linkul cheamă onOpen', () => {
    const onOpen = vi.fn()
    const onChange = vi.fn()
    const { rerender } = render(<AgentCodeField {...base} onOpen={onOpen} open={false} />)
    fireEvent.click(screen.getByRole('button', { name: /am un cod de agent/i }))
    expect(onOpen).toHaveBeenCalled()
    rerender(<AgentCodeField {...base} onChange={onChange} open />)
    fireEvent.change(screen.getByLabelText('Codul agentului'), { target: { value: 'k7m2xq9' } })
    expect(onChange).toHaveBeenCalledWith('k7m2xq9')
    expect(screen.queryByRole('button', { name: /am un cod de agent/i })).not.toBeInTheDocument()
  })

  it('AU4 problemele sunt alerte', () => {
    const { rerender } = render(<AgentCodeField {...base} open problem="shape" />)
    expect(screen.getByRole('alert')).toHaveTextContent(/doar litere, cifre și cratimă/i)
    rerender(<AgentCodeField {...base} open problem="unknown" />)
    expect(screen.getByRole('alert')).toHaveTextContent(/nu găsim acest cod/i)
    expect(screen.getByLabelText('Codul agentului')).toHaveAttribute('aria-invalid', 'true')
  })

  it('AU5 fără problemă: ajutor neutru, fără alertă', () => {
    render(<AgentCodeField {...base} open />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText(/poți lăsa câmpul gol/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Codul agentului')).toHaveAttribute('aria-invalid', 'false')
  })
})
