// e2e/02-auth-flow.spec.ts
// Test login: form vizibil + login cu credentiale invalide eșuează grațios.
import { test, expect } from '@playwright/test'

test.describe('Authentication', () => {
  test('/auth shows login form', async ({ page }) => {
    await page.goto('/auth')
    await page.waitForLoadState('networkidle')

    // Email + password inputs visible
    const emailInput    = page.getByLabel(/email/i)
    const passwordInput = page.getByLabel(/parol/i)
    await expect(emailInput).toBeVisible()
    await expect(passwordInput).toBeVisible()

    // Submit button
    await expect(page.getByRole('button', { name: /(intră|login|conectare|continuă)/i }).first())
      .toBeVisible()
  })

  test('invalid credentials show error', async ({ page }) => {
    await page.goto('/auth')
    await page.waitForLoadState('networkidle')

    await page.getByLabel(/email/i).fill('nu-exist@menuvia.ro')
    await page.getByLabel(/parol/i).fill('wrongpassword123')
    await page.getByRole('button', { name: /(intră|login|conectare|continuă)/i }).first().click()

    // Should show an error message and stay on /auth
    await expect(page.locator('text=/(invalid|incorect|gre[șs]i|nu am|wrong)/i').first())
      .toBeVisible({ timeout: 8_000 })

    // URL should still be /auth
    await expect(page).toHaveURL(/\/auth/)
  })

  test('protected routes redirect to /auth when unauthenticated', async ({ page, context }) => {
    // Clean cookies
    await context.clearCookies()

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    // Should be redirected to auth or show auth UI
    const url = page.url()
    const isOnAuth = url.includes('/auth') || url === new URL('/', url).toString()
    if (!isOnAuth) {
      // Maybe shows login modal — check for email input visible
      await expect(page.getByLabel(/email/i)).toBeVisible({ timeout: 5_000 })
    }
  })
})
