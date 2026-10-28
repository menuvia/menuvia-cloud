// PhoneInput (PH-4): prefixul de țară e VIZIBIL și implicit +40, nu ghicit
// din limba browserului (românii în en-US ar primi +1 — bug-ul invers).
import { describe, it, expect, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PhoneInput from '../PhoneInput'
import { DEFAULT_CALLING_CODE } from '../../lib/phone'

function H({ lang = 'ro' }: { lang?: string }) {
  const [cc, setCc] = useState<string>(DEFAULT_CALLING_CODE)
  const [n, setN] = useState('')
  return (
    <PhoneInput
      cc={cc}
      national={n}
      onCcChange={setCc}
      onNationalChange={setN}
      lang={lang}
      placeholder="Telefon"
      inputStyle={{}}
      hintColor="#777"
    />
  )
}

afterEach(() => {
  Reflect.deleteProperty(window.navigator, 'language')
  Reflect.deleteProperty(window.navigator, 'languages')
})

describe('PhoneInput (PH-4)', () => {
  it('PI1 implicitul e +40 chiar pe un browser în en-US', () => {
    Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true })
    Object.defineProperty(window.navigator, 'languages', { value: ['en-US'], configurable: true })
    render(<H lang="en" />)
    const sel = screen.getByRole('combobox', { name: /country code/i })
    expect(sel).toHaveValue('40')
    expect(within(sel).getAllByRole('option')[0]).toHaveTextContent('RO +40')
  })

  it('PI2 un număr tastat cu „+” dezactivează selectul (altfel +40 vizibil ar minți)', async () => {
    render(<H />)
    const input = screen.getByPlaceholderText('Telefon')
    const sel = screen.getByRole('combobox', { name: /prefixul țării/i })
    await userEvent.type(input, '+46')
    expect(sel).toBeDisabled()
    await userEvent.clear(input)
    await userEvent.type(input, '0722')
    expect(sel).not.toBeDisabled()
  })

  it('PI3 opțiunea liberă există, iar indicația e în limba meniului și legată de câmp', () => {
    render(<H lang="de" />)
    const sel = screen.getByRole('combobox', { name: /ländervorwahl/i })
    const opts = within(sel).getAllByRole('option')
    const last = opts[opts.length - 1]
    expect(last).toHaveValue('')
    expect(last).toHaveTextContent('Andere +…')
    const hint = screen.getByText(/Ländervorwahl oder gib/)
    expect(screen.getByPlaceholderText('Telefon')).toHaveAttribute('aria-describedby', hint.id)
  })
})
