// e2e/helpers.ts
// Shared utilities for Playwright tests.
import { type Page, expect } from '@playwright/test'

/**
 * Test credentials. Pe Netlify CI, set ca env vars din secrets.
 * Trebuie să fie un user real în Supabase (gen "qa@menuvia.ro" cu un cont owner).
 * Local: export E2E_EMAIL="..." E2E_PASSWORD="..." înainte de npm run test:e2e
 */
export const TEST_EMAIL    = process.env.E2E_EMAIL    || 'qa@menuvia.ro'
export const TEST_PASSWORD = process.env.E2E_PASSWORD || 'TestPassword123!'

/** Login flow — folosit ca pre-condition în multe teste. */
export async function login(page: Page, email = TEST_EMAIL, password = TEST_PASSWORD) {
  await page.goto('/auth')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/parol/i).fill(password)
  await page.getByRole('button', { name: /(intră|login|conectare)/i }).click()

  // Wait for redirect to dashboard / kitchen / waiter
  await page.waitForURL(/\/(dashboard|kitchen|waiter)/, { timeout: 10_000 })
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
