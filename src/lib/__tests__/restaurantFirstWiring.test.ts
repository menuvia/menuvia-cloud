// „Începe gratuit” nu mai duce în Stripe înainte să existe restaurantul
// (ux-owner-checkout-before-restaurant). Decizia are teste proprii (RQ1–RQ5 în
// postLogin*.test.ts); aici, ca CLICHET pe sursă (tiparul signupWiring.test.ts),
// se verifică doar că App.tsx chiar o FOLOSEȘTE pe ambele drumuri de ieșire din
// /auth și că finalul onboarding-ului onorează intenția păstrată.
//
//   RQ6  efectul de auto-redirect și onSuccess: cu intenție de plan, destinația
//        vine din loadPlanIntentDestination — nu `exitAuth(intentDest)` (care
//        trimitea patronul fără restaurant direct pe /pricing → Stripe). Mutația
//        care pică: revenirea oricăruia dintre cele două drumuri la exitAuth(intentDest).
//   RQ7  OnboardingPage.onComplete navighează prin planIntentDestination (intenția
//        aleasă înainte de cont devine checkout ABIA acum), cu /dashboard ca rezervă;
//        mutația „navigate('/dashboard') fix” pică.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const APP = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

describe('întâi restaurantul, apoi planul — cablaj', () => {
  it('RQ6 ambele ieșiri din /auth trec prin loadPlanIntentDestination', () => {
    expect(APP).not.toContain('exitAuth(intentDest)')
    const effect = APP.slice(
      APP.indexOf('autoRedirectedRef.current = true'),
      APP.indexOf('// Reset auto-redirect flag'),
    )
    const effectIntent = effect.slice(effect.indexOf('planIntentDestination('))
    expect(effectIntent).toMatch(
      /if \(intentDest\) \{\s*void loadPlanIntentDestination\(user\.id\)/,
    )
    const onSuccess = APP.slice(
      APP.indexOf('<AuthPage'),
      APP.indexOf('// ── Authenticated: landing'),
    )
    const onSuccessIntent = onSuccess.slice(onSuccess.indexOf('if (intentDest) {'))
    expect(onSuccessIntent.slice(0, 400)).toContain('loadPlanIntentDestination(uid)')
  })

  it('RQ7 finalul onboarding-ului onorează intenția de plan', () => {
    const at = APP.indexOf('<OnboardingPage')
    expect(at).toBeGreaterThan(-1)
    const block = APP.slice(at, APP.indexOf('/>', at))
    expect(block).toMatch(
      /navigate\(planIntentDestination\(user\.email \?\? null\) \?\? '\/dashboard'\)/,
    )
    expect(block).toContain('pendingPlan={readPlanIntent(user.email ?? null)}')
  })
})
