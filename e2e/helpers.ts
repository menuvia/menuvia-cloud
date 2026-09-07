// e2e/helpers.ts
// Shared utilities for Playwright tests.
import { type Page, type TestInfo, expect } from '@playwright/test'

/**
 * Test credentials. Pe Netlify CI, set ca env vars din secrets.
 * Trebuie să fie un user real în Supabase (gen "qa@menuvia.ro" cu un cont owner).
 * Local: export E2E_EMAIL="..." E2E_PASSWORD="..." înainte de npm run test:e2e
 */
export const TEST_EMAIL    = process.env.E2E_EMAIL    || 'qa@menuvia.ro'
export const TEST_PASSWORD = process.env.E2E_PASSWORD || 'TestPassword123!'

/**
 * Pregătește pagina ÎNAINTE de prima navigare: consimțământul de cookie-uri
 * + suprimarea cardurilor PWA (instalare / actualizare). Toate trei sunt
 * `role="dialog"` fixate JOS, peste bara de navigare mobilă a dashboard-ului,
 * și interceptează click-urile. Cardul de instalare apare la 30 s după
 * `beforeinstallprompt`, cel de actualizare când există un SW în așteptare —
 * deci fără pre-setare un test devenea roșu în funcție de CÂT durează, nu de
 * ce verifică (03-dashboard-nav „Facturi" pe mobile-safari, sept 2026).
 * addInitScript rulează la fiecare document nou, deci și sessionStorage e
 * setat la timp. Cheile sunt cele din lib/pwa.ts + components/PWAPrompt.tsx.
 */
export async function prepPage(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'menuvia_cookie_consent',
      JSON.stringify({ necessary: true, analytics: false, marketing: false, timestamp: Date.now() }),
    )
    window.localStorage.setItem('pwa-install-dismissed', '1')
    window.sessionStorage.setItem('pwa-update-snoozed', '1')
  })
}

/**
 * La eșec, scrie în log textul tuturor `role="dialog"` deschise. Playwright
 * spune DOAR „<div role=dialog> intercepts pointer events" — adică CEVA
 * acoperă ținta, nu CE (cookie banner, card PWA, modal) — iar artefactele cu
 * snapshot-ul ARIA nu sunt mereu accesibile din afara runner-ului.
 * Folosire: `test.afterEach(dumpOverlaysOnFailure)`.
 */
export async function dumpOverlaysOnFailure({ page }: { page: Page }, testInfo: TestInfo) {
  if (testInfo.status === testInfo.expectedStatus) return
  const texts = await page
    .getByRole('dialog')
    .allInnerTexts()
    .catch(() => [] as string[])
  if (texts.length > 0) {
    console.log(`[e2e] dialoguri deschise la eșec (${testInfo.title}): ${JSON.stringify(texts)}`)
  }
}

/** Login flow — folosit ca pre-condition în multe teste. */
export async function login(page: Page, email = TEST_EMAIL, password = TEST_PASSWORD) {
  await prepPage(page)
  await page.goto('/auth')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/parol/i).fill(password)
  await page.getByRole('button', { name: /(intră|login|conectare)/i }).click()

  // Wait for redirect to dashboard / kitchen / waiter.
  // 15s: pe mobile-safari (WebKit emulat în CI) primul login depășea uneori 10s.
  await page.waitForURL(/\/(dashboard|kitchen|waiter)/, { timeout: 15_000 })
}

/** Sign out din interfața dashboard. */
export async function logout(page: Page) {
  await page.goto('/dashboard')
  await page.getByRole('button', { name: /set[ăa]ri/i }).first().click().catch(() => {})
  await page.getByRole('button', { name: /(ieș|deconect|sign out)/i }).first().click()
  await page.waitForURL(/\/(auth|$)/, { timeout: 5_000 })
}

/** Așteaptă ca dashboard-ul să fie încărcat (admin view). */
export async function waitForDashboard(page: Page) {
  await expect(page).toHaveURL(/\/dashboard/)
  // Așteaptă un element vizibil din dashboard
  await page.waitForLoadState('networkidle', { timeout: 10_000 })
}

/** Skip-uri condiționale pentru env-uri unde credentials lipsesc. */
export function requireCreds() {
  if (!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD) {
    // Warn dar nu blochează CI — secretele E2E_EMAIL/E2E_PASSWORD trebuie
    // configurate în GitHub Actions repo secrets pentru a rula tot E2E suite.
    // Până atunci, suite-ul skip-uiește testele care depind de auth.
    if (process.env.CI && !process.env.E2E_EMAIL) {
      console.warn(
        '[e2e] E2E_EMAIL not set in CI — skipping auth-dependent tests. ' +
        'Set secrets în GitHub repo settings → Secrets and variables → Actions.',
      )
    }
    return false
  }
  return true
}
