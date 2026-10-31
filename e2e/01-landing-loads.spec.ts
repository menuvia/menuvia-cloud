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
    // „due to access control checks" e zgomot WebKit-only (documentat în spec
    // 06): apelurile RPC anon cu fallback (ex. get_affiliate_public_defaults
    // pe landing) sunt logate de Safari ca erori de consolă deși fluxul e BY
    // DESIGN — o rupere adevărată pică pe aserțiunile de conținut, nu aici.
    const critical = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('Manifest') &&
      !e.includes('service worker') &&
      !e.includes('access control checks')
    )
    expect(critical).toEqual([])
  })

  test('/recrutare landing page loads with hero + form', async ({ page }) => {
    await page.goto('/recrutare')
    await page.waitForLoadState('networkidle')

    // Hero heading present (h1: „…pentru cafeneaua ta.”)
    await expect(page.getByRole('heading', { level: 1, name: /cafeneaua ta/i })).toBeVisible()

    // Oferta pilot: din PILOT_DAYS (pricingCopy), nu „3 luni” scris de mână.
    await expect(page.getByRole('heading', { name: /primesc \d+ de zile gratuite/i })).toBeVisible()
    await expect(page.getByText(/3 luni/i)).toHaveCount(0)

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
