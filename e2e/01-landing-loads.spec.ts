// e2e/01-landing-loads.spec.ts
// Smoke test: pagina principală + landing recrutare se încarcă fără erori JS.
import { test, expect } from '@playwright/test'

test.describe('Public pages load', () => {
  test('homepage / renders without JS errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Title must be set
    await expect(page).toHaveTitle(/Menuvia/i)

    // No critical JS errors (filter known noisy warnings)
    const critical = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('Manifest') &&
      !e.includes('service worker')
    )
    expect(critical).toEqual([])
  })

  test('/recrutare landing page loads with hero + form', async ({ page }) => {
    await page.goto('/recrutare')
    await page.waitForLoadState('networkidle')

    // Hero heading present
    await expect(page.getByRole('heading', { name: /cafenelele tale|cafenele/i }).first())
      .toBeVisible()

    // Pilot CTA visible
    await expect(page.getByText(/program pilot|3 luni gratuit/i).first()).toBeVisible()

    // Form fields present
    await expect(page.locator('input[placeholder*="Andrei"], input[placeholder*="nume"], input[type="text"]').first())
      .toBeVisible()
  })

  test('/recrutare form validation', async ({ page }) => {
    await page.goto('/recrutare')
    await page.waitForLoadState('networkidle')

    // Try to submit empty form
    const submitBtn = page.getByRole('button', { name: /trimite|aplică/i }).last()
    await submitBtn.click()

    // Should show validation error
    await expect(page.getByText(/obligator/i).first()).toBeVisible({ timeout: 3_000 })
  })
})
