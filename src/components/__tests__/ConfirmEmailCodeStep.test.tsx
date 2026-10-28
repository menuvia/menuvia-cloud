// Ecranul „Verifică emailul" cu cod de 6 cifre în același tab (S1).
//
//   CE1  cooldown-ul de 60 s e VIZIBIL: „Retrimite peste 60 s" dezactivat, apoi
//        numără înapoi și devine „Retrimite emailul" activ
//   CE2  cod incomplet → mesaj, FĂRĂ apel la server
//   CE3  cod bun → verifyOtp({email, token, type:'signup'}); sesiunea apare →
//        onVerified(email). „123 456" lipit devine 123456
//   CE4  cod greșit/expirat → mesaj românesc (nu engleza GoTrue), fără onVerified
//   CE5  răspuns fără sesiune și fără eroare NU e succes
//   CE6  „Retrimite" după cooldown → resend cu aceeași destinație ca linkul de
//        signup; cooldown-ul repornește, codul vechi se șterge
//   CE7  cât cooldown-ul e activ, „Retrimite" nu cheamă serverul
//   CE8  rate-limit la retrimitere → mesaj + cooldown repornit
//   CE9  textele merg și în engleză
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

const { verifyOtpMock, resendMock } = vi.hoisted(() => ({
  verifyOtpMock: vi.fn(),
  resendMock: vi.fn(),
}))
vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { verifyOtp: verifyOtpMock, resend: resendMock } },
}))

import ConfirmEmailCodeStep from '../auth/ConfirmEmailCodeStep'

const EMAIL = 'ana@bistro.ro'
const REDIRECT = 'https://menuvia.ro/auth?plan=growth'

function setup(lang: 'ro' | 'en' = 'ro') {
  const onVerified = vi.fn()
  const onBack = vi.fn()
  render(
    <ConfirmEmailCodeStep
      email={EMAIL}
      lang={lang}
      redirectTo={REDIRECT}
      onVerified={onVerified}
      onBack={onBack}
    />,
  )
  return { onVerified, onBack }
}

function typeCode(value: string) {
  fireEvent.change(screen.getByLabelText(/cod din email|code from the email/i), {
    target: { value },
  })
}

async function submitCode() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /confirmă codul|confirm code/i }))
  })
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  verifyOtpMock.mockReset()
  resendMock.mockReset().mockResolvedValue({ data: {}, error: null })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('ConfirmEmailCodeStep', () => {
  it('CE1 cooldown-ul de 60 s e vizibil și se termină', async () => {
    setup()
    const btn = screen.getByRole('button', { name: /retrimite/i })
    expect(btn).toBeDisabled()
    expect(btn).toHaveTextContent('Retrimite peste 60 s')
    await advance(1000)
    expect(screen.getByRole('button', { name: /retrimite/i })).toHaveTextContent('Retrimite peste 59 s')
    await advance(58_000)
    expect(screen.getByRole('button', { name: /retrimite/i })).toHaveTextContent('Retrimite peste 1 s')
    await advance(1000)
    const ready = screen.getByRole('button', { name: /retrimite/i })
    expect(ready).toBeEnabled()
    expect(ready).toHaveTextContent('Retrimite emailul')
  })

  it('CE2 cod incomplet → mesaj, fără apel', async () => {
    const { onVerified } = setup()
    typeCode('123')
    await submitCode()
    expect(screen.getByRole('alert')).toHaveTextContent(/cele 6 cifre/i)
    expect(verifyOtpMock).not.toHaveBeenCalled()
    expect(onVerified).not.toHaveBeenCalled()
  })

  it('CE3 cod bun → verifyOtp(type signup) și onVerified', async () => {
    verifyOtpMock.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null })
    const { onVerified } = setup()
    typeCode('123 456')
    expect(screen.getByLabelText(/cod din email/i)).toHaveValue('123456')
    await submitCode()
    expect(verifyOtpMock).toHaveBeenCalledWith({ email: EMAIL, token: '123456', type: 'signup' })
    expect(onVerified).toHaveBeenCalledWith(EMAIL)
  })

  it('CE4 cod greșit/expirat → mesaj românesc, fără onVerified', async () => {
    verifyOtpMock.mockResolvedValue({
      data: { session: null },
      error: { code: 'otp_expired', message: 'Token has expired or is invalid', status: 403 },
    })
    const { onVerified } = setup()
    typeCode('654321')
    await submitCode()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/greșit sau a expirat/i)
    expect(alert).not.toHaveTextContent(/Token has expired/i)
    expect(onVerified).not.toHaveBeenCalled()
  })

  it('CE5 fără eroare dar și fără sesiune → nu e succes', async () => {
    verifyOtpMock.mockResolvedValue({ data: { session: null }, error: null })
    const { onVerified } = setup()
    typeCode('123456')
    await submitCode()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(onVerified).not.toHaveBeenCalled()
  })

  it('CE6 retrimite după cooldown → resend cu aceeași destinație; cooldown repornit', async () => {
    setup()
    typeCode('12')
    await advance(60_000)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /retrimite emailul/i }))
    })
    expect(resendMock).toHaveBeenCalledWith({
      type: 'signup',
      email: EMAIL,
      options: { emailRedirectTo: REDIRECT },
    })
    expect(screen.getByRole('status')).toHaveTextContent(/email nou/i)
    expect(screen.getByLabelText(/cod din email/i)).toHaveValue('')
    expect(screen.getByRole('button', { name: /retrimite/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /retrimite/i })).toHaveTextContent('Retrimite peste 60 s')
  })

  it('CE7 în cooldown, „Retrimite" nu cheamă serverul', async () => {
    setup()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /retrimite/i }))
    })
    expect(resendMock).not.toHaveBeenCalled()
  })

  it('CE8 rate-limit la retrimitere → mesaj și cooldown repornit', async () => {
    resendMock.mockResolvedValue({
      data: null,
      error: { code: 'over_email_send_rate_limit', message: 'email rate limit exceeded', status: 429 },
    })
    setup()
    await advance(60_000)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /retrimite emailul/i }))
    })
    expect(screen.getByRole('alert')).toHaveTextContent(/prea multe coduri/i)
    expect(screen.getByRole('button', { name: /retrimite/i })).toBeDisabled()
  })

  it('CE9 textele merg și în engleză', async () => {
    verifyOtpMock.mockResolvedValue({
      data: { session: null },
      error: { code: 'otp_expired', message: 'Token has expired or is invalid' },
    })
    setup('en')
    expect(screen.getByRole('heading')).toHaveTextContent('Check your email')
    expect(screen.getByRole('button', { name: /resend in 60 s/i })).toBeDisabled()
    typeCode('123456')
    await submitCode()
    expect(screen.getByRole('alert')).toHaveTextContent(/wrong or has expired/i)
  })

  it('CE10 „Înapoi la autentificare" cheamă onBack', () => {
    const { onBack } = setup()
    fireEvent.click(screen.getByRole('button', { name: /înapoi la autentificare/i }))
    expect(onBack).toHaveBeenCalled()
  })
})
