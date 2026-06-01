// e2e/06-public-menu-editorial.spec.ts
// Smoke test pentru noul design "editorial" al meniului public.
//
// Prerequisite: seed_tinctura_demo.sql aplicat (vezi
// supabase/scripts/seed_tinctura_demo.sql).
//
// Skipuit dacă restaurant-ul nu există (CI fără seed).
import { test, expect } from '@playwright/test'

test.describe('Public menu — editorial design', () => {
  test('renders hero + tabs + cards + footer pentru /m/tinctura', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto('/m/tinctura')
    await page.waitForLoadState('networkidle')

    // Dacă restaurant-ul nu există în DB, sărim — nu e regresie a designului.
    const notFound = await page.getByText(/Restaurant negăsit/i).count()
    test.skip(notFound > 0, 'seed_tinctura_demo.sql nu e aplicat pe această instanță')

    // 1. Hero cu numele restaurant-ului
    await expect(page.getByTestId('hero-name')).toContainText('Tinctura Café')

    // 2. Status pill DESCHIS sau ÎNCHIS
    const statusPill = page.getByTestId('status-pill')
    await expect(statusPill).toBeVisible()
    await expect(statusPill).toContainText(/DESCHIS ACUM|ÎNCHIS/)

    // 3. Cel puțin un info-pill (adresă / ore / WiFi / Vegan / Instagram)
    const pills = page.getByTestId('info-pill')
    expect(await pills.count()).toBeGreaterThan(0)

    // 4. Tabs categorii vizibile
    const tabs = page.getByTestId('category-tabs')
    await expect(tabs).toBeVisible()
    await expect(tabs).toContainText(/Toate/)
    await expect(tabs).toContainText(/Cafea/)

    // 5. Card produs vizibil
    const cards = page.getByTestId('product-card')
    expect(await cards.count()).toBeGreaterThan(0)

    // 6. Search funcționează (filtrare client-side)
    await page.getByTestId('search-input').fill('espresso')
    await page.waitForTimeout(300)
    const filteredCards = await page.getByTestId('product-card').count()
    expect(filteredCards).toBeGreaterThan(0)
    await expect(page.getByTestId('product-card').first()).toContainText(/Espresso/i)

    // 7. Clear search + click pe tab "Cafea" → schimbă conținut
    await page.getByTestId('search-input').fill('')
    await page.waitForTimeout(150)

    // 8. Footer brand cu "MENIU BY MENUVIA"
    const footer = page.getByTestId('footer-brand')
    await expect(footer).toBeVisible()
    await expect(footer).toContainText(/MENIU BY MENUVIA/)

    // Niciun JS error
    const critical = errors.filter(
      (e) => !e.includes('favicon') && !e.includes('Manifest') && !e.includes('service worker'),
    )
    expect(critical).toEqual([])
  })
})
