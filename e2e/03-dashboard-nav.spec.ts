// e2e/03-dashboard-nav.spec.ts
// Test navigation prin tab-urile dashboard-ului ca admin authenticated.
// Requires E2E_EMAIL + E2E_PASSWORD env vars cu un cont real (owner).
import { test, expect } from '@playwright/test'
import { login, waitForDashboard, requireCreds, TEST_EMAIL, TEST_PASSWORD } from './helpers'

test.describe('Dashboard admin navigation', () => {
  test.skip(!requireCreds(), 'Requires E2E_EMAIL + E2E_PASSWORD env vars')

  test.beforeEach(async ({ page }) => {
    await login(page, TEST_EMAIL, TEST_PASSWORD)
    await waitForDashboard(page)
  })

  test('can navigate to Produse tab', async ({ page }) => {
    // exact: /produse/i nimerea PRIMUL buton din DOM — pasul de checklist
    // „Adaugă produse (completat)" de pe Acasă (dezactivat → click blocat).
    // Tab-ul de nav se numește exact „Produse" (desktop și mobil).
    await page.getByRole('button', { name: 'Produse', exact: true }).first().click()
    await page.waitForTimeout(500)
    // Should be on products tab
    await expect(page.locator('text=/(produs|categorii)/i').first()).toBeVisible()
  })

  test('can navigate to Statistici tab', async ({ page }) => {
    // Tab-ul „Sănătate" NU mai există în nav (health scores au devenit
    // founder-only) — testăm în schimb „Statistici" (grupul „Rapoarte",
    // minTier 3 — ownerul E2E e enterprise), păstrând acoperirea pe
    // navigarea prin grupuri.
    await page.getByRole('button', { name: /rapoarte/i }).first().click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: /statistici/i }).first().click()
    await page.waitForTimeout(1000)

    // Conținutul tabului sau empty state-ul lui
    const possible = page.locator('text=/(top produse|comenzi pe|nicio comandă|statistici)/i')
    await expect(possible.first()).toBeVisible({ timeout: 5_000 })
  })

  test('can navigate to Facturi tab', async ({ page }) => {
    // „Facturi" stă sub grupul „Rapoarte" — îl deschidem întâi.
    await page.getByRole('button', { name: /rapoarte/i }).first().click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: /facturi/i }).first().click()
    await page.waitForTimeout(1000)

    // Empty state or list visible
    const possible = page.locator('text=/(factur|oblio|configur)/i')
    await expect(possible.first()).toBeVisible({ timeout: 5_000 })
  })

  test('back button does not redirect to /auth (FE-001 fix)', async ({ page }) => {
    // We're already on /dashboard after login
    expect(page.url()).toContain('/dashboard')

    // Navigate to another tab (changes URL or just state — either way)
    await page.getByRole('button', { name: /set[ăa]ri|set[aă]ri/i }).first().click().catch(() => {})
    await page.waitForTimeout(500)

    // Press back
    await page.goBack()
    await page.waitForTimeout(1000)

    // Should NOT have been redirected to /auth (the bug we fixed)
    expect(page.url()).not.toContain('/auth')
  })
})
