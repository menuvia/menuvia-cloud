// Cablajul înscrierii (pachetul 7): ce nu poate fi dovedit fără a randa toată
// aplicația se păzește aici ca CLICHET pe sursă (tiparul signupCta.test.ts).
// Logica din spatele fiecărui punct are teste proprii (agentCode, authRedirect,
// postLogin, otp); aici se verifică doar că ele sunt FOLOSITE.
//
//   SW1  AuthPage trimite codul de agent în `user_metadata.agent_code` la signUp,
//        iar decizia (`resolveForSubmit`) se ia ÎNAINTE de signUp
//   SW2  câmpul/bannerul de cod există DOAR pe „Cont nou": hook-ul se activează
//        cu `mode === 'signup'`, iar ambele componente sunt condiționate de mod
//   SW3  ecranul „Verifică emailul" e ConfirmEmailCodeStep, iar acesta folosește
//        verifyOtp(type signup) + resend(type signup)
//   SW4  App.tsx: nicio redirecționare brută spre /auth de pe rute protejate —
//        trec prin authPathWithNext (altfel `?next=` nu se produce niciodată)
//   SW5  App.tsx: `?next=` se onorează ÎNAINTEA intențiilor, atât în efectul de
//        auto-redirect cât și în onSuccess; destinația pe rol vine din
//        loadPostLoginDestination în ambele
//   SW7  ieșirea din /auth după login = mereu replace, prin exitAuth: nicio
//        `navigate(` în onSuccess și nicio redirecționare brută în efect (un PUSH
//        din onSuccess lasă /auth în istoric — regresia prinsă de E2E 03)
//   SW6  codul de agent se citește din `user_metadata` doar de trigger-ul din
//        bază: clientul nu cheamă niciun RPC de atribuire la signup
//   SW8  linkul de confirmare (signUp ȘI „Retrimite") poartă `next` curent, validat:
//        confirmarea din email se deschide în ALT tab, fără `?next=` al tab-ului inițial
//   SW9  (lotul L8a) ambele înscrieri (AuthPage + InviteAcceptPage) pun limba ecranului
//        în `user_metadata.ui_lang` — singura sursă pentru limba șabloanelor Supabase
//        Auth (docs/AUTH_EMAIL_TEMPLATES.md). Mutația care pică: cheia scoasă din
//        oricare pagină.
//   SW10 (PostHog, R6) acordul „Performanță” dat nelogat în pagină trece la contul
//        NOU chiar după signUp, pe ramura contului nou (identități > 0): cu
//        confirmarea pornită nu urmează nicio autentificare în pagină, iar contul
//        deschis din link n-ar fi fost măsurat deloc. Logica: AN39 din
//        analytics.test.ts. Mutația care pică: apelul scos sau mutat în afara ramurii.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const read = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8')

const AUTH = read('src/pages/AuthPage.tsx')
const APP = read('src/App.tsx')
const CONFIRM = read('src/components/auth/ConfirmEmailCodeStep.tsx')
const INVITE = read('src/pages/InviteAcceptPage.tsx')

describe('înscrierea — cablaj', () => {
  it('SW1 agent_code intră în metadata la signUp, după decizia resolveForSubmit', () => {
    const resolveAt = AUTH.indexOf('agentCode.resolveForSubmit()')
    const signUpAt = AUTH.indexOf('supabase.auth.signUp(')
    expect(resolveAt, 'resolveForSubmit lipsește').toBeGreaterThan(-1)
    expect(signUpAt, 'signUp lipsește').toBeGreaterThan(-1)
    expect(resolveAt).toBeLessThan(signUpAt)
    expect(AUTH).toMatch(/agent_code:\s*agent\.code/)
    // o decizie negativă oprește formularul înainte de signUp
    expect(AUTH.slice(resolveAt, signUpAt)).toMatch(/if \(!agent\.ok\)[\s\S]*return/)
  })

  it('SW2 câmpul și bannerul apar doar pe „Cont nou"', () => {
    expect(AUTH).toContain("useSignupAgentCode(mode === 'signup')")
    expect(AUTH).toMatch(/mode === 'signup' && agentCode\.verifiedLinkCode/)
    expect(AUTH).toMatch(/mode === 'signup' && \(!agentCode\.verifiedLinkCode/)
  })

  it('SW3 „Verifică emailul" = cod de 6 cifre + Retrimite', () => {
    expect(AUTH).toMatch(/<ConfirmEmailCodeStep\s/)
    expect(CONFIRM).toMatch(/auth\.verifyOtp\(\{[^}]*type: 'signup'[^}]*\}\)/)
    expect(CONFIRM).toMatch(/auth\.resend\(\{\s*type: 'signup'/)
    expect(CONFIRM).toContain('emailRedirectTo: redirectTo')
  })

  it('SW4 nicio redirecționare brută spre /auth în App.tsx', () => {
    expect(APP).not.toMatch(/(navigate|replace)\(\s*['"`]\/auth['"`]\s*\)/)
    expect(APP).toContain('authPathWithNext(')
  })

  it('SW5 `next` înaintea intențiilor; destinația pe rol din postLogin', () => {
    // efectul de auto-redirect
    const effect = APP.slice(APP.indexOf('autoRedirectedRef.current = true'), APP.indexOf('// Reset auto-redirect flag'))
    expect(effect.indexOf('nextFromSearch(')).toBeGreaterThan(-1)
    expect(effect.indexOf('nextFromSearch(')).toBeLessThan(effect.indexOf('menuvia.afiliat_intent'))
    expect(effect.indexOf('nextFromSearch(')).toBeLessThan(effect.indexOf('planIntentDestination('))
    expect(effect).toContain('loadPostLoginDestination(user.id)')
    // onSuccess din AuthPage
    const onSuccess = APP.slice(APP.indexOf('<AuthPage'), APP.indexOf('// ── Authenticated: landing'))
    expect(onSuccess.indexOf('nextFromSearch(')).toBeGreaterThan(-1)
    expect(onSuccess.indexOf('nextFromSearch(')).toBeLessThan(onSuccess.indexOf('planIntentDestination('))
    expect(onSuccess).toContain('loadPostLoginDestination(uid)')
    // rolurile nu se mai citesc într-un al doilea loc
    expect(APP).not.toContain('getUserRoles')
  })

  it('SW6 clientul nu cheamă RPC de atribuire la signUp (o face trigger-ul din bază)', () => {
    expect(AUTH).not.toMatch(/capture_affiliate_attribution|claim_agent_code/)
    expect(read('src/hooks/useSignupAgentCode.ts')).not.toMatch(/capture_affiliate_attribution|claim_agent_code/)
  })

  it('SW7 ieșirea din /auth: replace prin exitAuth, niciun navigate în onSuccess', () => {
    const onSuccess = APP.slice(APP.indexOf('<AuthPage'), APP.indexOf('// ── Authenticated: landing'))
    expect(onSuccess).not.toMatch(/\bnavigate\(/)
    expect(onSuccess.match(/exitAuth\(/g)?.length ?? 0).toBeGreaterThan(3)
    const effect = APP.slice(APP.indexOf('autoRedirectedRef.current = true'), APP.indexOf('// Reset auto-redirect flag'))
    expect(effect).not.toMatch(/\breplace\(/)
    expect(effect).not.toMatch(/\bnavigate\(/)
    expect(effect.match(/exitAuth\(/g)?.length ?? 0).toBeGreaterThan(3)
    expect(APP).toContain("from './lib/postLoginRedirect'")
  })

  it('SW8 linkul de confirmare (signUp + Retrimite) poartă `next` curent', () => {
    // Mutația „confirmRedirectUrl fără next” trimite contul nou venit dintr-o
    // invitație de rețea (/auth?next=/sef-vanzari/…), la confirmarea din email
    // (tab NOU, fără `?next=`), pe onboarding-ul de restaurant. Logica (validare,
    // parametri) are teste proprii în planIntent.test.ts (PI17).
    const at = AUTH.indexOf('const confirmRedirectUrl = (): string =>')
    expect(at, 'confirmRedirectUrl lipsește').toBeGreaterThan(-1)
    const end = AUTH.indexOf('const handle = async', at)
    expect(end).toBeGreaterThan(at)
    expect(AUTH.slice(at, end)).toMatch(
      /authRedirectUrl\([\s\S]*planIntent,\s*nextFromSearch\(window\.location\.search\),?\s*\)/,
    )
    expect(AUTH).toContain("import { nextFromSearch } from '../lib/authRedirect'")
    // ambele drumuri spre email folosesc ACELAȘI URL
    expect(AUTH).toContain('emailRedirectTo: confirmRedirectUrl()')
    expect(AUTH).toContain('redirectTo={confirmRedirectUrl()}')
  })

  it('SW9 limba ecranului ajunge în user_metadata.ui_lang la ambele înscrieri', () => {
    // Fereastra apelului: de la `supabase.auth.signUp(` până la `emailRedirectTo`
    // (AuthPage) / sfârșitul obiectului de opțiuni (InviteAcceptPage).
    const authAt = AUTH.indexOf('supabase.auth.signUp(')
    const authCall = AUTH.slice(authAt, AUTH.indexOf('emailRedirectTo:', authAt))
    expect(authCall).toMatch(/data:\s*\{[^}]*ui_lang:\s*lang\b/)
    expect(AUTH).toMatch(/const \{ t, lang \} = useT\(authNs\)/)
    const invAt = INVITE.indexOf('supabase.auth.signUp(')
    expect(invAt, 'signUp lipsește din InviteAcceptPage').toBeGreaterThan(-1)
    const invCall = INVITE.slice(invAt, INVITE.indexOf('})', invAt))
    expect(invCall).toMatch(/data:\s*\{[^}]*ui_lang:\s*uiLang\b/)
    expect(INVITE).toMatch(/const \{ lang: uiLang \} = useUiLang\(\)/)
  })

  it('SW10 acordul nelegat trece la contul nou, pe ramura contului nou', () => {
    const at = AUTH.indexOf('if ((data.user?.identities?.length ?? 0) > 0) {')
    expect(at, 'ramura contului nou lipsește').toBeGreaterThan(-1)
    const end = AUTH.indexOf("track('signup_completed'", at)
    expect(end, 'signup_completed lipsește din ramură').toBeGreaterThan(at)
    expect(AUTH.slice(at, end)).toMatch(/bindPendingConsentToAccount\(data\.user\.id\)/)
    expect(AUTH).toMatch(/import \{[^}]*\bbindPendingConsentToAccount\b[^}]*\} from '\.\.\/lib\/analytics'/)
  })
})
