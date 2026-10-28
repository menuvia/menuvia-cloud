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
//   SW6  codul de agent se citește din `user_metadata` doar de trigger-ul din
//        bază: clientul nu cheamă niciun RPC de atribuire la signup
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const read = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8')

const AUTH = read('src/pages/AuthPage.tsx')
const APP = read('src/App.tsx')
const CONFIRM = read('src/components/auth/ConfirmEmailCodeStep.tsx')

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
})
