// Limba ecranului de autentificare (lotul L2a): textele vin din namespace-ul
// `auth`, limba din `FunnelLangProvider`.
//   AL1  fără nimic: română, textele de dinainte (control).
//   AL2  `?lang=en`: engleză, iar alegerea devine preferința dispozitivului
//        (`menuvia_ui_lang`) — omul rămâne în engleză și pe ecranul următor.
//   AL3  `?lang=de`: rămâne română. Franceza și germana au dicționare, dar
//        apar abia odată cu panoul (`FUNNEL_LANGS`). Mutația care pică:
//        `FUNNEL_LANGS = STAFF_LANGS` (patron înscris în germană, panou român).
//   AL4  eroarea GoTrue CUNOSCUTĂ e tradusă în limba omului („Wrong email or
//        password."); una NECUNOSCUTĂ: în engleză textul GoTrue (spune mai mult),
//        în română mesajul generic, nu engleza brută.
import { Suspense } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const { signInMock } = vi.hoisted(() => ({ signInMock: vi.fn() }))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: signInMock,
      signUp: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      mfa: { getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({ data: null }) },
    },
  },
}))
vi.mock('../../hooks/useSignupAgentCode', () => ({
  useSignupAgentCode: () => ({
    resolveForSubmit: async () => ({ ok: true, code: null }),
    verifiedLinkCode: null,
    dismissed: false,
    dismissLink: () => undefined,
    fieldOpen: false,
    openField: () => undefined,
    typed: '',
    setTyped: () => undefined,
    problem: null,
  }),
}))
vi.mock('../../lib/analytics', () => ({ track: vi.fn() }))
// AuthPage preîncarcă panoul la evaluarea modulului; aici n-are ce căuta.
vi.mock('../DashboardPage', () => ({ default: () => null }))

import AuthPage from '../AuthPage'
import { preloadNamespace } from '../../i18n/core'
import { authNs } from '../../i18n/ns/auth'
import { UI_LANG_STORAGE_KEY } from '../../i18n/langs'

beforeAll(async () => {
  await preloadNamespace(authNs, 'en')
})

afterEach(() => {
  window.history.replaceState({}, '', '/')
  localStorage.clear()
  signInMock.mockReset()
})

function renderAt(path: string) {
  window.history.replaceState({}, '', path)
  return render(
    <Suspense fallback={<div>…</div>}>
      <AuthPage onSuccess={() => undefined} />
    </Suspense>,
  )
}

async function signIn(button: string) {
  fireEvent.change(document.getElementById('auth-email') as HTMLInputElement, {
    target: { value: 'ana@bistro.ro' },
  })
  fireEvent.change(document.getElementById('auth-password') as HTMLInputElement, {
    target: { value: 'parola-buna-1' },
  })
  fireEvent.click(screen.getByRole('button', { name: button }))
}

describe('AuthPage — limba', () => {
  it('AL1 control: fără nimic, româna de dinainte', () => {
    renderAt('/auth')
    expect(screen.getByRole('heading', { name: 'Bun venit înapoi' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Intră în cont' })).toBeInTheDocument()
    expect(localStorage.getItem(UI_LANG_STORAGE_KEY)).toBeNull()
  })

  it('AL2 ?lang=en: engleză, iar alegerea rămâne pe dispozitiv', async () => {
    renderAt('/auth?lang=en')
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(localStorage.getItem(UI_LANG_STORAGE_KEY)).toBe('en')
  })

  it('AL3 ?lang=de: rămâne română până se activează germana pentru personal', () => {
    renderAt('/auth?lang=de')
    expect(screen.getByRole('heading', { name: 'Bun venit înapoi' })).toBeInTheDocument()
    expect(localStorage.getItem(UI_LANG_STORAGE_KEY)).toBeNull()
  })

  it('AL4 erorile GoTrue: cunoscute traduse, necunoscute după limbă', async () => {
    signInMock.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    const en = renderAt('/auth?lang=en')
    await screen.findByRole('heading', { name: 'Welcome back' })
    await signIn('Sign in')
    expect(await screen.findByText('Wrong email or password.')).toBeInTheDocument()

    signInMock.mockResolvedValue({ error: { message: 'Database error granting user' } })
    await signIn('Sign in')
    expect(await screen.findByText('Database error granting user')).toBeInTheDocument()
    en.unmount()
    localStorage.clear()

    renderAt('/auth')
    await signIn('Intră în cont')
    expect(
      await screen.findByText('Nu am putut procesa cererea. Verifică datele și reîncearcă.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Database error granting user')).not.toBeInTheDocument()
  })
})
