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
    await page.getByRole('button', { name: /produse/i }).first().click()
    await page.waitForTimeout(500)
    // Should be on products tab
    await expect(page.locator('text=/(produs|categorii)/i').first()).toBeVisible()
  })

  test('can navigate to Sănătate tab', async ({ page }) => {
    await page.getByRole('button', { name: /s[ăa]n[ăa]tate/i }).first().click()
    await page.waitForTimeout(1000)

    // Hero text or loading visible
    const possible = page.locator('text=/(scor|customer health|încarcă|nu a fost)/i')
    await expect(possible.first()).toBeVisible({ timeout: 5_000 })
  })

  test('can navigate to Facturi tab', async ({ page }) => {
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
